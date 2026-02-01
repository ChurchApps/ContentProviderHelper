export interface ContentProviderAuthData {
  access_token: string;
  refresh_token: string;
  token_type: string;
  created_at: number;
  expires_in: number;
  scope: string;
}

export interface ContentProviderConfig {
  id: string;
  name: string;
  apiBase: string;
  oauthBase: string;
  clientId: string;
  scopes: string[];
  supportsDeviceFlow?: boolean;
  deviceAuthEndpoint?: string;
  endpoints: Record<string, string | ((...args: string[]) => string)>;
}

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export interface DeviceFlowState {
  status: "loading" | "awaiting_user" | "polling" | "success" | "error" | "expired";
  deviceAuth?: DeviceAuthorizationResponse;
  error?: string;
  pollCount?: number;
}

export type AuthType = "none" | "oauth_pkce" | "device_flow" | "form_login";

export interface ProviderLogos {
  light: string;
  dark: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  logos: ProviderLogos;
  implemented: boolean;
  requiresAuth: boolean;
  authTypes: AuthType[];
  capabilities: ProviderCapabilities;
}

export interface ContentFolder {
  type: "folder";
  id: string;
  title: string;
  image?: string;
  isLeaf?: boolean;
  path: string;
  providerData?: Record<string, unknown>;
}

export interface ContentFile {
  type: "file";
  id: string;
  title: string;
  mediaType: "video" | "image";
  image?: string;
  url: string;
  embedUrl?: string;
  muxPlaybackId?: string;
  decryptionKey?: string;
  mediaId?: string;
  pingbackUrl?: string;
  providerData?: Record<string, unknown>;
}

export type ContentItem = ContentFolder | ContentFile;

export function isContentFolder(item: ContentItem): item is ContentFolder {
  return item.type === "folder";
}

export function isContentFile(item: ContentItem): item is ContentFile {
  return item.type === "file";
}

export type DeviceFlowPollResult =
  | ContentProviderAuthData
  | { error: string; shouldSlowDown?: boolean }
  | null;

export interface PlanPresentation {
  id: string;
  name: string;
  actionType: "play" | "add-on" | "other";
  files: ContentFile[];
}

export interface PlanSection {
  id: string;
  name: string;
  presentations: PlanPresentation[];
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  image?: string;
  sections: PlanSection[];
  allFiles: ContentFile[];
}

export interface FeedFileInterface {
  id?: string;
  name?: string;
  url?: string;
  streamUrl?: string;
  seconds?: number;
  fileType?: string;
}

export interface FeedActionInterface {
  id?: string;
  actionType?: string;
  content?: string;
  files?: FeedFileInterface[];
}

export interface FeedSectionInterface {
  id?: string;
  name?: string;
  actions?: FeedActionInterface[];
}

export interface FeedVenueInterface {
  id?: string;
  lessonId?: string;
  name?: string;
  lessonName?: string;
  lessonDescription?: string;
  lessonImage?: string;
  sections?: FeedSectionInterface[];
}

export interface InstructionItem {
  id?: string;
  itemType?: string;
  relatedId?: string;
  label?: string;
  description?: string;
  seconds?: number;
  children?: InstructionItem[];
  embedUrl?: string;
}

export interface Instructions {
  venueName?: string;
  items: InstructionItem[];
}

export interface VenueActionInterface {
  id?: string;
  name?: string;
  actionType?: string;
  seconds?: number;
}

export interface VenueSectionActionsInterface {
  id?: string;
  name?: string;
  actions?: VenueActionInterface[];
}

export interface VenueActionsResponseInterface {
  venueName?: string;
  sections?: VenueSectionActionsInterface[];
}

export interface ProviderCapabilities {
  browse: boolean;
  presentations: boolean;
  playlist: boolean;
  instructions: boolean;
  mediaLicensing: boolean;
}

export type MediaLicenseStatus = "valid" | "expired" | "not_licensed" | "unknown";

export interface MediaLicenseResult {
  mediaId: string;
  status: MediaLicenseStatus;
  message?: string;
  expiresAt?: string | number;
}

/**
 * Core provider interface - all providers should implement this
 */
export interface IProvider {
  // Identity (required)
  readonly id: string;
  readonly name: string;
  readonly logos: ProviderLogos;
  readonly config: ContentProviderConfig;

  // Metadata (required)
  readonly requiresAuth: boolean;
  readonly capabilities: ProviderCapabilities;
  readonly authTypes: AuthType[];

  // Core methods (required)
  browse(path?: string | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;
  getPresentations(path: string, auth?: ContentProviderAuthData | null): Promise<Plan | null>;

  // Optional methods - providers can implement these if they have custom logic
  getPlaylist?(path: string, auth?: ContentProviderAuthData | null, resolution?: number): Promise<ContentFile[] | null>;
  getInstructions?(path: string, auth?: ContentProviderAuthData | null): Promise<Instructions | null>;
  checkMediaLicense?(mediaId: string, auth?: ContentProviderAuthData | null): Promise<MediaLicenseResult | null>;
}

/**
 * @deprecated Use IProvider instead. This interface will be removed in a future version.
 */
export interface IContentProvider {
  // Identity
  readonly id: string;
  readonly name: string;
  readonly logos: ProviderLogos;
  readonly config: ContentProviderConfig;

  // Content browsing
  browse(path?: string | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;
  getPresentations(path: string, auth?: ContentProviderAuthData | null): Promise<Plan | null>;

  // Content retrieval
  getPlaylist(path: string, auth?: ContentProviderAuthData | null, resolution?: number): Promise<ContentFile[] | null>;
  getInstructions(path: string, auth?: ContentProviderAuthData | null): Promise<Instructions | null>;

  // Capability & auth detection
  requiresAuth(): boolean;
  getCapabilities(): ProviderCapabilities;

  // Media licensing
  checkMediaLicense(mediaId: string, auth?: ContentProviderAuthData | null): Promise<MediaLicenseResult | null>;
}

/**
 * @deprecated Use auth helpers directly (OAuthHelper, DeviceFlowHelper, TokenHelper) with provider.config.
 * This interface will be removed in a future version.
 */
export interface IAuthProvider {
  getAuthTypes(): AuthType[];
  isAuthValid(auth: ContentProviderAuthData | null | undefined): boolean;
  isTokenExpired(auth: ContentProviderAuthData): boolean;
  refreshToken(auth: ContentProviderAuthData): Promise<ContentProviderAuthData | null>;

  // OAuth PKCE
  generateCodeVerifier(): string;
  generateCodeChallenge(verifier: string): Promise<string>;
  buildAuthUrl(codeVerifier: string, redirectUri: string, state?: string): Promise<{ url: string; challengeMethod: string }>;
  exchangeCodeForTokens(code: string, codeVerifier: string, redirectUri: string): Promise<ContentProviderAuthData | null>;

  // Device flow
  supportsDeviceFlow(): boolean;
  initiateDeviceFlow(): Promise<DeviceAuthorizationResponse | null>;
  pollDeviceFlowToken(deviceCode: string): Promise<DeviceFlowPollResult>;
  calculatePollDelay(baseInterval?: number, slowDownCount?: number): number;
}
