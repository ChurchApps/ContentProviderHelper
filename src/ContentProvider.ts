import {
  ContentProviderAuthData,
  ContentProviderConfig,
  ContentItem,
  ContentFolder,
  DeviceAuthorizationResponse,
  DeviceFlowPollResult,
} from './interfaces';

/**
 * Abstract base class for content providers.
 * Each provider (APlay, SignPresenter, etc.) extends this class and implements
 * the abstract methods to translate their domain concepts into folders and files.
 *
 * This implementation is stateless - auth data is passed as parameters rather
 * than stored internally, making it suitable for both client and server usage.
 */
export abstract class ContentProvider {
  /** Unique identifier for this provider */
  abstract readonly id: string;

  /** Display name for this provider */
  abstract readonly name: string;

  /** Provider configuration (API endpoints, OAuth settings, etc.) */
  abstract readonly config: ContentProviderConfig;

  /**
   * Get the root-level content items (typically top-level folders).
   * Called when the user first enters the provider's content browser.
   * @param auth - Authentication data (optional for public APIs)
   */
  abstract getRootContents(auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;

  /**
   * Get the contents of a folder.
   * Can return a mix of folders and files.
   * @param folder - The folder to get contents for
   * @param auth - Authentication data (optional for public APIs)
   */
  abstract getFolderContents(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;

  // ============= AUTH HELPER METHODS =============

  /**
   * Check if this provider requires authentication.
   * Override in subclasses for public APIs.
   */
  requiresAuth(): boolean {
    return !!this.config.clientId;
  }

  /**
   * Check if auth data is still valid (not expired).
   */
  isAuthValid(auth: ContentProviderAuthData | null | undefined): boolean {
    if (!auth) return false;
    return !this.isTokenExpired(auth);
  }

  /**
   * Check if token is expired.
   */
  isTokenExpired(auth: ContentProviderAuthData): boolean {
    if (!auth.created_at || !auth.expires_in) return true;
    const expiresAt = (auth.created_at + auth.expires_in) * 1000;
    // Consider expired 5 minutes before actual expiry for safety
    return Date.now() > expiresAt - 5 * 60 * 1000;
  }

  // ============= PKCE METHODS =============

  /**
   * PKCE: Generate code verifier (43-128 characters).
   */
  generateCodeVerifier(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const length = 64;
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(array[i] % chars.length);
    }
    return result;
  }

  /**
   * PKCE: Generate code challenge from verifier using SHA256.
   */
  async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);

    // Convert to base64
    let binary = '';
    for (let i = 0; i < hashArray.length; i++) {
      binary += String.fromCharCode(hashArray[i]);
    }
    const base64 = btoa(binary);

    // Convert base64 to base64url (URL-safe, no padding)
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Build OAuth authorization URL.
   */
  async buildAuthUrl(codeVerifier: string): Promise<{ url: string; challengeMethod: string }> {
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: this.id, // Use providerId as state for callback routing
    });

    return {
      url: `${this.config.oauthBase}/authorize?${params.toString()}`,
      challengeMethod: 'S256',
    };
  }

  /**
   * Exchange authorization code for tokens.
   * @returns Auth data (caller should store this) or null on failure
   */
  async exchangeCodeForTokens(
    code: string,
    codeVerifier: string
  ): Promise<ContentProviderAuthData | null> {
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId,
        code_verifier: codeVerifier,
      });

      const response = await fetch(`${this.config.oauthBase}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const authData: ContentProviderAuthData = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || this.config.scopes.join(' '),
      };

      return authData;
    } catch {
      return null;
    }
  }

  /**
   * Refresh access token.
   * @returns New auth data (caller should store this) or null on failure
   */
  async refreshToken(auth: ContentProviderAuthData): Promise<ContentProviderAuthData | null> {
    if (!auth.refresh_token) return null;

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        client_id: this.config.clientId,
      });

      const response = await fetch(`${this.config.oauthBase}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const authData: ContentProviderAuthData = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || auth.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || auth.scope,
      };

      return authData;
    } catch {
      return null;
    }
  }

  // ============= DEVICE FLOW METHODS (RFC 8628) =============

  /**
   * Check if this provider supports Device Flow.
   */
  supportsDeviceFlow(): boolean {
    return !!this.config.supportsDeviceFlow && !!this.config.deviceAuthEndpoint;
  }

  /**
   * Initiate Device Authorization Flow.
   */
  async initiateDeviceFlow(): Promise<DeviceAuthorizationResponse | null> {
    if (!this.supportsDeviceFlow()) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        client_id: this.config.clientId,
        scope: this.config.scopes.join(' '),
      });

      const response = await fetch(
        `${this.config.oauthBase}${this.config.deviceAuthEndpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      );

      if (!response.ok) {
        return null;
      }

      const data: DeviceAuthorizationResponse = await response.json();
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Poll for Device Flow token.
   * @returns Auth data on success, error object if pending/slow_down, null on failure
   */
  async pollDeviceFlowToken(deviceCode: string): Promise<DeviceFlowPollResult> {
    try {
      const params = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: this.config.clientId,
      });

      const response = await fetch(`${this.config.oauthBase}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (response.ok) {
        // Success - user authorized
        const data = await response.json();
        const authData: ContentProviderAuthData = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          token_type: data.token_type || 'Bearer',
          created_at: Math.floor(Date.now() / 1000),
          expires_in: data.expires_in,
          scope: data.scope || this.config.scopes.join(' '),
        };

        return authData;
      }

      // Handle error responses
      const errorData = await response.json();

      switch (errorData.error) {
        case 'authorization_pending':
          return { error: 'authorization_pending' };
        case 'slow_down':
          return { error: 'slow_down', shouldSlowDown: true };
        case 'expired_token':
          return null;
        case 'access_denied':
          return null;
        default:
          return null;
      }
    } catch {
      return { error: 'network_error' };
    }
  }

  /**
   * Calculate poll delay based on interval and slow_down responses.
   */
  calculatePollDelay(baseInterval: number = 5, slowDownCount: number = 0): number {
    // RFC 8628: Add 5 seconds for each slow_down response
    return (baseInterval + slowDownCount * 5) * 1000;
  }

  // ============= API REQUEST HELPER =============

  /**
   * Create authorization headers for API requests.
   * @param auth - Current auth data
   * @returns Headers object or null if auth is invalid
   */
  protected createAuthHeaders(auth: ContentProviderAuthData | null | undefined): Record<string, string> | null {
    if (!auth) return null;

    return {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'application/json',
    };
  }

  /**
   * Generic API request helper.
   * @param path - API path (appended to apiBase)
   * @param auth - Authentication data (optional for public APIs)
   * @param method - HTTP method
   * @param body - Request body (for POST/PUT)
   */
  protected async apiRequest<T>(
    path: string,
    auth?: ContentProviderAuthData | null,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown
  ): Promise<T | null> {
    try {
      const url = `${this.config.apiBase}${path}`;
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };

      // Add auth headers if auth is provided
      if (auth) {
        headers['Authorization'] = `Bearer ${auth.access_token}`;
      }

      // Add content-type for body
      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      const options: RequestInit = {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      };

      const response = await fetch(url, options);
      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }
}
