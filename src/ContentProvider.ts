import { ContentProviderAuthData, ContentProviderConfig, ContentItem, ContentFolder, ContentFile, DeviceAuthorizationResponse, DeviceFlowPollResult, ProviderLogos, AuthType, Plan, Instructions, ProviderCapabilities, MediaLicenseResult } from './interfaces';
import { detectMediaType } from './utils';
import * as Converters from './FormatConverters';

export abstract class ContentProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly logos: ProviderLogos;
  abstract readonly config: ContentProviderConfig;

  abstract browse(folder?: ContentFolder | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;

  abstract getPresentations(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Plan | null>;

  async getPlaylist(folder: ContentFolder, auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const caps = this.getCapabilities();
    if (caps.presentations) {
      const plan = await this.getPresentations(folder, auth);
      if (plan) return Converters.presentationsToPlaylist(plan);
    }
    return null;
  }

  async getInstructions(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const caps = this.getCapabilities();

    if (caps.expandedInstructions) {
      const expanded = await this.getExpandedInstructions(folder, auth);
      if (expanded) return Converters.collapseInstructions(expanded);
    }

    if (caps.presentations) {
      const plan = await this.getPresentations(folder, auth);
      if (plan) return Converters.presentationsToInstructions(plan);
    }

    return null;
  }

  async getExpandedInstructions(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const caps = this.getCapabilities();

    if (caps.presentations) {
      const plan = await this.getPresentations(folder, auth);
      if (plan) return Converters.presentationsToExpandedInstructions(plan);
    }

    return null;
  }

  requiresAuth(): boolean {
    return !!this.config.clientId;
  }

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

  checkMediaLicense(_mediaId: string, _auth?: ContentProviderAuthData | null): Promise<MediaLicenseResult | null> {
    return Promise.resolve(null);
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
    return Date.now() > expiresAt - 5 * 60 * 1000; // 5-minute buffer
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

  async buildAuthUrl(codeVerifier: string, redirectUri: string, state?: string): Promise<{ url: string; challengeMethod: string }> {
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state || this.id
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

      const tokenUrl = `${this.config.oauthBase}/token`;
      console.log(`${this.id} token exchange request to: ${tokenUrl}`);
      console.log(`  - client_id: ${this.config.clientId}`);
      console.log(`  - redirect_uri: ${redirectUri}`);
      console.log(`  - code: ${code.substring(0, 10)}...`);

      const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });

      console.log(`${this.id} token response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${this.id} token exchange failed: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json();
      console.log(`${this.id} token exchange successful, got access_token: ${!!data.access_token}`);
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || this.config.scopes.join(' ')
      };
    } catch (error) {
      console.error(`${this.id} token exchange error:`, error);
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

      console.log(`${this.id} API request: ${method} ${url}`);
      console.log(`${this.id} API auth present: ${!!auth}`);

      const options: RequestInit = { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) };
      const response = await fetch(url, options);

      console.log(`${this.id} API response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${this.id} API request failed: ${response.status} - ${errorText}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error(`${this.id} API request error:`, error);
      return null;
    }
  }

  protected createFolder(id: string, title: string, image?: string, providerData?: Record<string, unknown>): ContentFolder {
    return { type: 'folder', id, title, image, providerData };
  }

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
