import { ContentProviderAuthData, ContentProviderConfig, ContentItem, ContentFolder, ContentFile, DeviceAuthorizationResponse, DeviceFlowPollResult, ProviderLogos, AuthType, Plan, Instructions, ProviderCapabilities, MediaLicenseResult } from './interfaces';
import { detectMediaType } from './utils';

/**
 * Abstract base class for content providers.
 * Extend this class to create a custom provider.
 *
 * ## Main Methods (for consumers)
 *
 * ### Content Browsing
 * - `browse(folder?, auth?)` - Browse content hierarchy (root if no folder, or folder contents)
 *
 * ### Structured Data
 * - `getPresentations(folder, auth?)` - Get structured plan with sections and presentations
 * - `getInstructions(folder, auth?)` - Get instruction/run sheet data
 * - `getExpandedInstructions(folder, auth?)` - Get expanded instructions with actions
 *
 * ### Provider Info
 * - `requiresAuth()` - Whether authentication is needed
 * - `getCapabilities()` - What features the provider supports
 * - `getAuthTypes()` - Supported authentication methods
 *
 * ### Authentication (OAuth 2.0 PKCE)
 * - `buildAuthUrl(codeVerifier, redirectUri)` - Build OAuth authorization URL
 * - `exchangeCodeForTokens(code, codeVerifier, redirectUri)` - Exchange code for tokens
 * - `refreshToken(auth)` - Refresh an expired access token
 * - `isAuthValid(auth)` - Check if auth data is still valid
 *
 * ### Device Flow Authentication (RFC 8628)
 * - `supportsDeviceFlow()` - Whether device flow is supported
 * - `initiateDeviceFlow()` - Start device authorization
 * - `pollDeviceFlowToken(deviceCode)` - Poll for token after user authorizes
 */
export abstract class ContentProvider {
  /** Unique identifier for the provider (e.g., 'lessonschurch', 'aplay') */
  abstract readonly id: string;
  /** Display name of the provider */
  abstract readonly name: string;
  /** Provider logos for light and dark themes */
  abstract readonly logos: ProviderLogos;
  /** Provider configuration including API endpoints and OAuth settings */
  abstract readonly config: ContentProviderConfig;

  /**
   * Browse the content hierarchy. If folder is null/undefined, returns root-level items.
   * If folder is provided, returns items within that folder.
   * @param folder - Optional folder to browse into (null/undefined for root)
   * @param auth - Optional authentication data
   * @returns Array of content items (folders and/or files)
   */
  abstract browse(folder?: ContentFolder | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;

  /**
   * Get a structured plan with sections and presentations for a folder.
   * @param folder - The folder to get presentations for (typically a venue or playlist)
   * @param auth - Optional authentication data
   * @returns Plan object with sections, presentations, and files, or null if not supported
   */
  abstract getPresentations(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Plan | null>;

  /**
   * Get a flat list of media files (playlist) for a folder.
   * Override in subclass if the provider supports playlists.
   * @param _folder - The folder to get playlist for (typically a venue or playlist folder)
   * @param _auth - Optional authentication data
   * @param _resolution - Optional resolution hint for video quality
   * @returns Array of ContentFile objects, or null if not supported
   */
  getPlaylist(_folder: ContentFolder, _auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    return Promise.resolve(null);
  }

  /**
   * Get instruction/run sheet data for a folder.
   * Override in subclass if the provider supports instructions.
   * @param _folder - The folder to get instructions for
   * @param _auth - Optional authentication data
   * @returns Instructions object, or null if not supported
   */
  getInstructions(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    return Promise.resolve(null);
  }

  /**
   * Get expanded instruction data with actions for a folder.
   * Override in subclass if the provider supports expanded instructions.
   * @param _folder - The folder to get expanded instructions for
   * @param _auth - Optional authentication data
   * @returns Instructions object with expanded action data, or null if not supported
   */
  getExpandedInstructions(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    return Promise.resolve(null);
  }

  /**
   * Check if this provider requires authentication.
   * @returns true if authentication is required
   */
  requiresAuth(): boolean {
    return !!this.config.clientId;
  }

  /**
   * Get the capabilities supported by this provider.
   * Override in subclass to indicate supported features.
   * @returns ProviderCapabilities object
   */
  getCapabilities(): ProviderCapabilities {
    return {
      browse: true,
      presentations: false,
      playlist: false,
      instructions: false,
      expandedInstructions: false,
      mediaLicensing: false
    };
  }

  /**
   * Check the license status for a specific media item.
   * Override in subclass if the provider requires license validation.
   * @param _mediaId - The media ID to check
   * @param _auth - Optional authentication data
   * @returns MediaLicenseResult object, or null if not supported
   */
  checkMediaLicense(_mediaId: string, _auth?: ContentProviderAuthData | null): Promise<MediaLicenseResult | null> {
    return Promise.resolve(null);
  }

  /**
   * Get the authentication types supported by this provider.
   * @returns Array of supported AuthType values ('none', 'oauth_pkce', 'device_flow')
   */
  getAuthTypes(): AuthType[] {
    if (!this.requiresAuth()) return ['none'];
    const types: AuthType[] = ['oauth_pkce'];
    if (this.supportsDeviceFlow()) types.push('device_flow');
    return types;
  }

  /**
   * Check if the provided auth data is still valid (not expired).
   * @param auth - Authentication data to validate
   * @returns true if auth is valid and not expired
   */
  isAuthValid(auth: ContentProviderAuthData | null | undefined): boolean {
    if (!auth) return false;
    return !this.isTokenExpired(auth);
  }

  /**
   * Check if a token is expired (with 5-minute buffer).
   * @param auth - Authentication data to check
   * @returns true if token is expired or will expire within 5 minutes
   */
  isTokenExpired(auth: ContentProviderAuthData): boolean {
    if (!auth.created_at || !auth.expires_in) return true;
    const expiresAt = (auth.created_at + auth.expires_in) * 1000;
    return Date.now() > expiresAt - 5 * 60 * 1000;
  }

  /**
   * Generate a random code verifier for PKCE.
   * @returns A 64-character random string
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
   * Generate a code challenge from a code verifier using SHA-256.
   * @param verifier - The code verifier string
   * @returns Base64url-encoded SHA-256 hash of the verifier
   */
  async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);

    let binary = '';
    for (let i = 0; i < hashArray.length; i++) {
      binary += String.fromCharCode(hashArray[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Build the OAuth authorization URL for PKCE flow.
   * @param codeVerifier - The code verifier (store this for token exchange)
   * @param redirectUri - The redirect URI to return to after authorization
   * @returns Object with authorization URL and challenge method
   */
  async buildAuthUrl(codeVerifier: string, redirectUri: string): Promise<{ url: string; challengeMethod: string }> {
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: this.id
    });
    return { url: `${this.config.oauthBase}/authorize?${params.toString()}`, challengeMethod: 'S256' };
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   * @param code - The authorization code from the callback
   * @param codeVerifier - The original code verifier used to generate the challenge
   * @param redirectUri - The redirect URI (must match the one used in buildAuthUrl)
   * @returns Authentication data, or null if exchange failed
   */
  async exchangeCodeForTokens(code: string, codeVerifier: string, redirectUri: string): Promise<ContentProviderAuthData | null> {
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.config.clientId,
        code_verifier: codeVerifier
      });

      const response = await fetch(`${this.config.oauthBase}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      if (!response.ok) return null;

      const data = await response.json();
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || this.config.scopes.join(' ')
      };
    } catch {
      return null;
    }
  }

  /**
   * Refresh an expired access token using the refresh token.
   * @param auth - The current authentication data (must include refresh_token)
   * @returns New authentication data, or null if refresh failed
   */
  async refreshToken(auth: ContentProviderAuthData): Promise<ContentProviderAuthData | null> {
    if (!auth.refresh_token) return null;

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        client_id: this.config.clientId
      });

      const response = await fetch(`${this.config.oauthBase}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      if (!response.ok) return null;

      const data = await response.json();
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || auth.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || auth.scope
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if this provider supports device flow authentication.
   * @returns true if device flow is supported
   */
  supportsDeviceFlow(): boolean {
    return !!this.config.supportsDeviceFlow && !!this.config.deviceAuthEndpoint;
  }

  /**
   * Initiate the device authorization flow (RFC 8628).
   * @returns Device authorization response with user_code and verification_uri, or null if not supported
   */
  async initiateDeviceFlow(): Promise<DeviceAuthorizationResponse | null> {
    if (!this.supportsDeviceFlow()) return null;

    try {
      const params = new URLSearchParams({ client_id: this.config.clientId, scope: this.config.scopes.join(' ') });
      const response = await fetch(`${this.config.oauthBase}${this.config.deviceAuthEndpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Poll for a token after user has authorized the device.
   * @param deviceCode - The device_code from initiateDeviceFlow response
   * @returns Auth data if successful, error object if pending/slow_down, or null if failed/expired
   */
  async pollDeviceFlowToken(deviceCode: string): Promise<DeviceFlowPollResult> {
    try {
      const params = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: this.config.clientId
      });

      const response = await fetch(`${this.config.oauthBase}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });

      if (response.ok) {
        const data = await response.json();
        return {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          token_type: data.token_type || 'Bearer',
          created_at: Math.floor(Date.now() / 1000),
          expires_in: data.expires_in,
          scope: data.scope || this.config.scopes.join(' ')
        };
      }

      const errorData = await response.json();
      switch (errorData.error) {
        case 'authorization_pending': return { error: 'authorization_pending' };
        case 'slow_down': return { error: 'slow_down', shouldSlowDown: true };
        case 'expired_token': return null;
        case 'access_denied': return null;
        default: return null;
      }
    } catch {
      return { error: 'network_error' };
    }
  }

  /**
   * Calculate the delay between device flow poll attempts.
   * @param baseInterval - Base interval in seconds (default: 5)
   * @param slowDownCount - Number of slow_down responses received
   * @returns Delay in milliseconds
   */
  calculatePollDelay(baseInterval: number = 5, slowDownCount: number = 0): number {
    return (baseInterval + slowDownCount * 5) * 1000;
  }

  /**
   * Create authorization headers for API requests.
   * @param auth - Authentication data
   * @returns Headers object with Authorization header, or null if no auth
   */
  protected createAuthHeaders(auth: ContentProviderAuthData | null | undefined): Record<string, string> | null {
    if (!auth) return null;
    return { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' };
  }

  /**
   * Make an authenticated API request.
   * @param path - API endpoint path (appended to config.apiBase)
   * @param auth - Optional authentication data
   * @param method - HTTP method (default: 'GET')
   * @param body - Optional request body (for POST requests)
   * @returns Parsed JSON response, or null if request failed
   */
  protected async apiRequest<T>(path: string, auth?: ContentProviderAuthData | null, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T | null> {
    try {
      const url = `${this.config.apiBase}${path}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (auth) headers['Authorization'] = `Bearer ${auth.access_token}`;
      if (body) headers['Content-Type'] = 'application/json';

      const options: RequestInit = { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) };
      const response = await fetch(url, options);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Helper to create a ContentFolder object.
   * @param id - Unique identifier
   * @param title - Display title
   * @param image - Optional image URL
   * @param providerData - Optional provider-specific data
   * @returns ContentFolder object
   */
  protected createFolder(id: string, title: string, image?: string, providerData?: Record<string, unknown>): ContentFolder {
    return { type: 'folder', id, title, image, providerData };
  }

  /**
   * Helper to create a ContentFile object with automatic media type detection.
   * @param id - Unique identifier
   * @param title - Display title
   * @param url - Media URL
   * @param options - Optional properties (mediaType, image, muxPlaybackId, providerData)
   * @returns ContentFile object
   */
  protected createFile(id: string, title: string, url: string, options?: {
    mediaType?: 'video' | 'image';
    image?: string;
    muxPlaybackId?: string;
    providerData?: Record<string, unknown>;
  }): ContentFile {
    return {
      type: 'file',
      id,
      title,
      url,
      mediaType: options?.mediaType ?? detectMediaType(url),
      image: options?.image,
      muxPlaybackId: options?.muxPlaybackId,
      providerData: options?.providerData
    };
  }
}
