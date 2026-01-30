import { ContentProviderAuthData, ContentProviderConfig } from '../interfaces';

export class OAuthHelper {
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

  async buildAuthUrl(config: ContentProviderConfig, codeVerifier: string, redirectUri: string, state?: string): Promise<{ url: string; challengeMethod: string }> {
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state || ''
    });
    return { url: `${config.oauthBase}/authorize?${params.toString()}`, challengeMethod: 'S256' };
  }

  async exchangeCodeForTokens(config: ContentProviderConfig, providerId: string, code: string, codeVerifier: string, redirectUri: string): Promise<ContentProviderAuthData | null> {
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: codeVerifier
      });

      const tokenUrl = `${config.oauthBase}/token`;
      console.log(`${providerId} token exchange request to: ${tokenUrl}`);
      console.log(`  - client_id: ${config.clientId}`);
      console.log(`  - redirect_uri: ${redirectUri}`);
      console.log(`  - code: ${code.substring(0, 10)}...`);

      const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });

      console.log(`${providerId} token response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${providerId} token exchange failed: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json();
      console.log(`${providerId} token exchange successful, got access_token: ${!!data.access_token}`);
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || config.scopes.join(' ')
      };
    } catch (error) {
      console.error(`${providerId} token exchange error:`, error);
      return null;
    }
  }
}
