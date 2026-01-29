import { ContentProviderAuthData, ContentProviderConfig, DeviceAuthorizationResponse, DeviceFlowPollResult } from '../../interfaces';

export function buildB1AuthUrl(
  config: ContentProviderConfig,
  appBase: string,
  redirectUri: string,
  state?: string
): { url: string; challengeMethod: string } {
  const oauthParams = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' ')
  });

  if (state) {
    oauthParams.set('state', state);
  }

  const returnUrl = `/oauth?${oauthParams.toString()}`;
  const url = `${appBase}/login?returnUrl=${encodeURIComponent(returnUrl)}`;
  return { url, challengeMethod: 'none' };
}

export async function exchangeCodeForTokensWithSecret(
  config: ContentProviderConfig,
  code: string,
  redirectUri: string,
  clientSecret: string
): Promise<ContentProviderAuthData | null> {
  try {
    const params = {
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    };

    const tokenUrl = `${config.oauthBase}/token`;
    console.log(`B1Church token exchange request to: ${tokenUrl}`);
    console.log(`  - client_id: ${config.clientId}`);
    console.log(`  - redirect_uri: ${redirectUri}`);
    console.log(`  - code: ${code.substring(0, 10)}...`);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    console.log(`B1Church token response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`B1Church token exchange failed: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log(`B1Church token exchange successful, got access_token: ${!!data.access_token}`);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || 'Bearer',
      created_at: Math.floor(Date.now() / 1000),
      expires_in: data.expires_in,
      scope: data.scope || config.scopes.join(' ')
    };
  } catch (error) {
    console.error('B1Church token exchange error:', error);
    return null;
  }
}

export async function refreshTokenWithSecret(
  config: ContentProviderConfig,
  auth: ContentProviderAuthData,
  clientSecret: string
): Promise<ContentProviderAuthData | null> {
  if (!auth.refresh_token) return null;

  try {
    const params = {
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token,
      client_id: config.clientId,
      client_secret: clientSecret
    };

    const response = await fetch(`${config.oauthBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

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

export async function initiateDeviceFlow(
  config: ContentProviderConfig
): Promise<DeviceAuthorizationResponse | null> {
  if (!config.supportsDeviceFlow || !config.deviceAuthEndpoint) return null;

  try {
    const response = await fetch(`${config.oauthBase}${config.deviceAuthEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        scope: config.scopes.join(' ')
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`B1Church device authorize failed: ${response.status} - ${errorText}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('B1Church device flow initiation error:', error);
    return null;
  }
}

export async function pollDeviceFlowToken(
  config: ContentProviderConfig,
  deviceCode: string
): Promise<DeviceFlowPollResult> {
  try {
    const response = await fetch(`${config.oauthBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: config.clientId
      })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || config.scopes.join(' ')
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
