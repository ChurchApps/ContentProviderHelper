/**
 * OAuth token data returned after successful authentication.
 */
export interface ContentProviderAuthData {
  /** The access token for API requests */
  access_token: string;
  /** The refresh token for obtaining new access tokens */
  refresh_token: string;
  /** Token type, typically "Bearer" */
  token_type: string;
  /** Unix timestamp (seconds) when the token was created */
  created_at: number;
  /** Token lifetime in seconds */
  expires_in: number;
  /** Space-separated list of granted scopes */
  scope: string;
}

/**
 * Configuration for a content provider's API and OAuth settings.
 */
export interface ContentProviderConfig {
  /** Unique identifier for the provider */
  id: string;
  /** Display name of the provider */
  name: string;
  /** Base URL for API requests */
  apiBase: string;
  /** Base URL for OAuth endpoints */
  oauthBase: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth scopes to request */
  scopes: string[];
  /** Whether the provider supports device flow authentication */
  supportsDeviceFlow?: boolean;
  /** Endpoint path for device authorization (relative to oauthBase) */
  deviceAuthEndpoint?: string;
  /** API endpoint paths - can be static strings or functions that generate paths */
  endpoints: Record<string, string | ((...args: string[]) => string)>;
}

/**
 * Response from the device authorization endpoint (RFC 8628).
 */
export interface DeviceAuthorizationResponse {
  /** Device verification code for polling */
  device_code: string;
  /** User code to display for manual entry */
  user_code: string;
  /** URL where user should authenticate */
  verification_uri: string;
  /** Complete URL with user code pre-filled */
  verification_uri_complete?: string;
  /** Seconds until the codes expire */
  expires_in: number;
  /** Minimum polling interval in seconds */
  interval?: number;
}

/**
 * Current state of a device flow authentication process.
 */
export interface DeviceFlowState {
  /**
   * Current status of the device flow.
   * - `loading`: Initiating device flow
   * - `awaiting_user`: Waiting for user to authenticate
   * - `polling`: Polling for token
   * - `success`: Authentication completed
   * - `error`: An error occurred
   * - `expired`: Device code expired
   */
  status: 'loading' | 'awaiting_user' | 'polling' | 'success' | 'error' | 'expired';
  /** Device authorization response data */
  deviceAuth?: DeviceAuthorizationResponse;
  /** Error message if status is 'error' */
  error?: string;
  /** Number of poll attempts made */
  pollCount?: number;
}

/**
 * Authentication type supported by a provider.
 * - `none`: No authentication required (public API)
 * - `oauth_pkce`: OAuth 2.0 with PKCE
 * - `device_flow`: OAuth 2.0 Device Authorization Flow (RFC 8628)
 */
export type AuthType = 'none' | 'oauth_pkce' | 'device_flow';

/**
 * Provider logo URLs for light and dark themes.
 */
export interface ProviderLogos {
  /** Logo URL for light theme backgrounds */
  light: string;
  /** Logo URL for dark theme backgrounds */
  dark: string;
}

/**
 * Information about a content provider.
 */
export interface ProviderInfo {
  /** Unique identifier for the provider */
  id: string;
  /** Display name of the provider */
  name: string;
  /** Provider logos */
  logos: ProviderLogos;
  /** Whether the provider is fully implemented */
  implemented: boolean;
  /** Whether the provider requires authentication */
  requiresAuth: boolean;
  /** Supported authentication types */
  authTypes: AuthType[];
  /** Provider capabilities */
  capabilities: ProviderCapabilities;
}

/**
 * A folder in the content hierarchy. Can be navigated into to retrieve child items.
 */
export interface ContentFolder {
  /** Discriminator for type narrowing. Always `'folder'` */
  type: 'folder';
  /** Unique identifier for this folder */
  id: string;
  /** Display title */
  title: string;
  /** Optional thumbnail/cover image URL */
  image?: string;
  /** Provider-specific data for navigation (e.g., level, parentId) */
  providerData?: Record<string, unknown>;
}

/**
 * A playable media file (video or image).
 */
export interface ContentFile {
  /** Discriminator for type narrowing. Always `'file'` */
  type: 'file';
  /** Unique identifier for this file */
  id: string;
  /** Display title */
  title: string;
  /**
   * Media type of the file.
   * - `video`: Video content (.mp4, .webm, .m3u8, etc.)
   * - `image`: Image content (.jpg, .png, etc.)
   */
  mediaType: 'video' | 'image';
  /** Optional preview/cover image URL */
  image?: string;
  /** URL to the media file */
  url: string;
  /**
   * Optional URL for embedded preview/player.
   * - For iframe-based providers (e.g., Lessons.church): an embed URL
   * - For direct media providers: same as url, or omitted to use url directly
   */
  embedUrl?: string;
  /** Mux playback ID for Mux-hosted videos */
  muxPlaybackId?: string;
  /** Decryption key for encrypted media (provider-specific) */
  decryptionKey?: string;
  /** Provider-specific media ID for tracking/licensing */
  mediaId?: string;
  /** URL to ping after 30+ seconds of playback (licensing requirement) */
  pingbackUrl?: string;
  /** Provider-specific data (e.g., duration, loop settings) */
  providerData?: Record<string, unknown>;
}

/**
 * A content item - either a folder or a file.
 */
export type ContentItem = ContentFolder | ContentFile;

/**
 * Type guard to check if a ContentItem is a ContentFolder.
 */
export function isContentFolder(item: ContentItem): item is ContentFolder {
  return item.type === 'folder';
}

/**
 * Type guard to check if a ContentItem is a ContentFile.
 */
export function isContentFile(item: ContentItem): item is ContentFile {
  return item.type === 'file';
}

/**
 * Result from polling the device flow token endpoint.
 * - `ContentProviderAuthData`: Authentication succeeded
 * - `{ error, shouldSlowDown }`: Still pending or should slow down
 * - `null`: Authentication failed or expired
 */
export type DeviceFlowPollResult =
  | ContentProviderAuthData
  | { error: string; shouldSlowDown?: boolean }
  | null;

/**
 * A presentation within a plan section (e.g., a song, video, or activity).
 */
export interface PlanPresentation {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /**
   * Type of action/presentation.
   * - `play`: Main playable content
   * - `add-on`: Supplementary content
   * - `other`: Non-playable item (song lyrics, notes, etc.)
   */
  actionType: 'play' | 'add-on' | 'other';
  /** Media files associated with this presentation */
  files: ContentFile[];
}

/**
 * A section within a plan containing multiple presentations.
 */
export interface PlanSection {
  /** Unique identifier */
  id: string;
  /** Section name (e.g., "Worship", "Message", "Closing") */
  name: string;
  /** Presentations within this section */
  presentations: PlanPresentation[];
}

/**
 * A complete plan/service with sections and presentations.
 * Returned by `getPresentations()`.
 */
export interface Plan {
  /** Unique identifier */
  id: string;
  /** Plan name */
  name: string;
  /** Optional description */
  description?: string;
  /** Optional cover image URL */
  image?: string;
  /** Ordered sections in the plan */
  sections: PlanSection[];
  /** Flat list of all files in the plan */
  allFiles: ContentFile[];
}

/**
 * A file within a venue feed.
 */
export interface FeedFileInterface {
  id?: string;
  name?: string;
  url?: string;
  streamUrl?: string;
  seconds?: number;
  fileType?: string;
}

/**
 * An action within a venue feed section.
 */
export interface FeedActionInterface {
  id?: string;
  actionType?: string;
  content?: string;
  files?: FeedFileInterface[];
}

/**
 * A section within a venue feed.
 */
export interface FeedSectionInterface {
  id?: string;
  name?: string;
  actions?: FeedActionInterface[];
}

/**
 * Complete venue feed data from Lessons.church API.
 */
export interface FeedVenueInterface {
  id?: string;
  lessonId?: string;
  name?: string;
  lessonName?: string;
  lessonDescription?: string;
  lessonImage?: string;
  sections?: FeedSectionInterface[];
}

/**
 * An item in the instruction hierarchy.
 */
export interface InstructionItem {
  /** Unique identifier */
  id?: string;
  /** Type of instruction item */
  itemType?: string;
  /** ID of related content */
  relatedId?: string;
  /** Display label */
  label?: string;
  /** Description or notes */
  description?: string;
  /** Duration in seconds */
  seconds?: number;
  /** Child instruction items */
  children?: InstructionItem[];
  /** URL for embedded content viewer */
  embedUrl?: string;
}

/**
 * Instructions/run sheet for a venue.
 * Returned by `getInstructions()` and `getExpandedInstructions()`.
 */
export interface Instructions {
  /** Name of the venue */
  venueName?: string;
  /** Hierarchical list of instruction items */
  items: InstructionItem[];
}

/**
 * An action within a venue section.
 */
export interface VenueActionInterface {
  id?: string;
  name?: string;
  actionType?: string;
  seconds?: number;
}

/**
 * A section with its actions.
 */
export interface VenueSectionActionsInterface {
  id?: string;
  name?: string;
  actions?: VenueActionInterface[];
}

/**
 * Response containing venue actions organized by section.
 */
export interface VenueActionsResponseInterface {
  venueName?: string;
  sections?: VenueSectionActionsInterface[];
}

/**
 * Capabilities supported by a content provider.
 */
export interface ProviderCapabilities {
  /** Whether the provider supports browsing content hierarchy */
  browse: boolean;
  /** Whether `getPresentations()` returns structured plan data */
  presentations: boolean;
  /** Whether `getPlaylist()` returns a flat list of media files */
  playlist: boolean;
  /** Whether `getInstructions()` returns instruction data */
  instructions: boolean;
  /** Whether `getExpandedInstructions()` returns expanded instruction data */
  expandedInstructions: boolean;
  /** Whether `checkMediaLicense()` returns license information */
  mediaLicensing: boolean;
}

/**
 * License status for media content.
 */
export type MediaLicenseStatus = 'valid' | 'expired' | 'not_licensed' | 'unknown';

/**
 * Response from `checkMediaLicense()`.
 */
export interface MediaLicenseResult {
  /** The media ID that was checked */
  mediaId: string;
  /** Current license status */
  status: MediaLicenseStatus;
  /** Human-readable message about the license */
  message?: string;
  /** When the license expires (ISO 8601 string or Unix timestamp) */
  expiresAt?: string | number;
}
