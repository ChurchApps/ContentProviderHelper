/**
 * Authentication data stored for a provider.
 */
export interface ContentProviderAuthData {
  access_token: string;
  refresh_token: string;
  token_type: string;
  created_at: number;
  expires_in: number;
  scope: string;
}

/**
 * Configuration for a content provider.
 */
export interface ContentProviderConfig {
  id: string;
  name: string;
  apiBase: string;
  oauthBase: string;
  clientId: string;
  scopes: string[];
  /** Device Flow support (RFC 8628) */
  supportsDeviceFlow?: boolean;
  deviceAuthEndpoint?: string;
  /** API endpoint mappings - provider-specific paths */
  endpoints: Record<string, string | ((id: string) => string)>;
}

/**
 * Device Authorization Response (RFC 8628 Section 3.2)
 */
export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

/**
 * Device Flow UI state
 */
export interface DeviceFlowState {
  status: 'loading' | 'awaiting_user' | 'polling' | 'success' | 'error' | 'expired';
  deviceAuth?: DeviceAuthorizationResponse;
  error?: string;
  pollCount?: number;
}

/**
 * Authentication types supported by a provider.
 */
export type AuthType = 'none' | 'oauth_pkce' | 'device_flow';

/**
 * Logo URLs for a provider (light and dark themes).
 */
export interface ProviderLogos {
  /** Logo URL for light theme backgrounds */
  light: string;
  /** Logo URL for dark theme backgrounds */
  dark: string;
}

/**
 * Information about a provider for listing purposes.
 */
export interface ProviderInfo {
  id: string;
  name: string;
  /** Logo URLs for light and dark themes */
  logos: ProviderLogos;
  /** Whether the provider requires authentication */
  requiresAuth: boolean;
  /** List of supported authentication types */
  authTypes: AuthType[];
}

/**
 * A folder in the content hierarchy.
 * Can contain other folders or files.
 */
export interface ContentFolder {
  type: 'folder';
  id: string;
  title: string;
  image?: string;
  /** Provider-specific data needed to fetch children (opaque to app) */
  providerData?: Record<string, unknown>;
}

/**
 * A playable file (video or image).
 */
export interface ContentFile {
  type: 'file';
  id: string;
  title: string;
  mediaType: 'video' | 'image';
  thumbnail?: string;
  url: string;
  muxPlaybackId?: string;
  /** Provider-specific data (opaque to app) */
  providerData?: Record<string, unknown>;
}

/**
 * Union type for items that can appear in a folder listing.
 */
export type ContentItem = ContentFolder | ContentFile;

/**
 * Type guard to check if an item is a folder.
 */
export function isContentFolder(item: ContentItem): item is ContentFolder {
  return item.type === 'folder';
}

/**
 * Type guard to check if an item is a file.
 */
export function isContentFile(item: ContentItem): item is ContentFile {
  return item.type === 'file';
}

/**
 * Result from Device Flow polling.
 */
export type DeviceFlowPollResult =
  | ContentProviderAuthData
  | { error: string; shouldSlowDown?: boolean }
  | null;
