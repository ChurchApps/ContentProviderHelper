import { ContentProviderAuthData, ContentProviderConfig, ContentItem, ContentFolder, DeviceAuthorizationResponse, DeviceFlowPollResult, ProviderLogos, AuthType, Plan } from './interfaces';

export abstract class ContentProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly logos: ProviderLogos;
  abstract readonly config: ContentProviderConfig;

  abstract getRootContents(auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;
  abstract getFolderContents(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;
  abstract getPlanContents(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Plan | null>;

  requiresAuth(): boolean {
    return !!this.config.clientId;
  }

  getAuthTypes(): AuthType[] {
    if (!this.requiresAuth()) return ['none'];
    const types: AuthType[] = ['oauth_pkce'];
    if (this.supportsDeviceFlow()) types.push('device_flow');
    return types;
  }

  isAuthValid(auth: ContentProviderAuthData | null | undefined): boolean {
    if (!auth) return false;
    return !this.isTokenExpired(auth);
  }

  isTokenExpired(auth: ContentProviderAuthData): boolean {
    if (!auth.created_at || !auth.expires_in) return true;
    const expiresAt = (auth.created_at + auth.expires_in) * 1000;
    return Date.now() > expiresAt - 5 * 60 * 1000;
  }

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

  supportsDeviceFlow(): boolean {
    return !!this.config.supportsDeviceFlow && !!this.config.deviceAuthEndpoint;
  }

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

  calculatePollDelay(baseInterval: number = 5, slowDownCount: number = 0): number {
    return (baseInterval + slowDownCount * 5) * 1000;
  }

  protected createAuthHeaders(auth: ContentProviderAuthData | null | undefined): Record<string, string> | null {
    if (!auth) return null;
    return { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' };
  }

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
}
