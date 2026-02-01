import { ContentProviderAuthData, ContentProviderConfig, ContentItem, ContentFolder, ContentFile, DeviceAuthorizationResponse, DeviceFlowPollResult, ProviderLogos, AuthType, Plan, Instructions, ProviderCapabilities, MediaLicenseResult, IContentProvider, IAuthProvider } from "./interfaces";
import { detectMediaType } from "./utils";
import * as Converters from "./FormatConverters";
import { OAuthHelper, TokenHelper, DeviceFlowHelper, ApiHelper } from "./helpers";

/**
 * @deprecated Use IProvider interface instead. Providers should implement IProvider directly
 * and use helper classes (OAuthHelper, TokenHelper, DeviceFlowHelper, ApiHelper) via composition.
 * This class will be removed in a future version.
 */
export abstract class ContentProvider implements IContentProvider, IAuthProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly logos: ProviderLogos;
  abstract readonly config: ContentProviderConfig;

  protected readonly oauthHelper = new OAuthHelper();
  protected readonly tokenHelper = new TokenHelper();
  protected readonly deviceFlowHelper = new DeviceFlowHelper();
  protected readonly apiHelper = new ApiHelper();

  abstract browse(path?: string | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]>;

  abstract getPresentations(path: string, auth?: ContentProviderAuthData | null): Promise<Plan | null>;

  async getPlaylist(path: string, auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const caps = this.getCapabilities();
    if (caps.presentations) {
      const plan = await this.getPresentations(path, auth);
      if (plan) return Converters.presentationsToPlaylist(plan);
    }
    return null;
  }

  async getInstructions(path: string, auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const caps = this.getCapabilities();

    if (caps.presentations) {
      const plan = await this.getPresentations(path, auth);
      if (plan) return Converters.presentationsToExpandedInstructions(plan);
    }

    return null;
  }

  requiresAuth(): boolean {
    return !!this.config.clientId;
  }

  getCapabilities(): ProviderCapabilities {
    return { browse: true, presentations: false, playlist: false, instructions: false, mediaLicensing: false };
  }

  checkMediaLicense(_mediaId: string, _auth?: ContentProviderAuthData | null): Promise<MediaLicenseResult | null> {
    return Promise.resolve(null);
  }

  getAuthTypes(): AuthType[] {
    if (!this.requiresAuth()) return ["none"];
    const types: AuthType[] = ["oauth_pkce"];
    if (this.supportsDeviceFlow()) types.push("device_flow");
    return types;
  }

  // Token management - delegated to TokenHelper
  isAuthValid(auth: ContentProviderAuthData | null | undefined): boolean {
    return this.tokenHelper.isAuthValid(auth);
  }

  isTokenExpired(auth: ContentProviderAuthData): boolean {
    return this.tokenHelper.isTokenExpired(auth);
  }

  async refreshToken(auth: ContentProviderAuthData): Promise<ContentProviderAuthData | null> {
    return this.tokenHelper.refreshToken(this.config, auth);
  }

  // OAuth PKCE - delegated to OAuthHelper
  generateCodeVerifier(): string {
    return this.oauthHelper.generateCodeVerifier();
  }

  async generateCodeChallenge(verifier: string): Promise<string> {
    return this.oauthHelper.generateCodeChallenge(verifier);
  }

  async buildAuthUrl(codeVerifier: string, redirectUri: string, state?: string): Promise<{ url: string; challengeMethod: string }> {
    return this.oauthHelper.buildAuthUrl(this.config, codeVerifier, redirectUri, state || this.id);
  }

  async exchangeCodeForTokens(code: string, codeVerifier: string, redirectUri: string): Promise<ContentProviderAuthData | null> {
    return this.oauthHelper.exchangeCodeForTokens(this.config, this.id, code, codeVerifier, redirectUri);
  }

  // Device flow - delegated to DeviceFlowHelper
  supportsDeviceFlow(): boolean {
    return this.deviceFlowHelper.supportsDeviceFlow(this.config);
  }

  async initiateDeviceFlow(): Promise<DeviceAuthorizationResponse | null> {
    return this.deviceFlowHelper.initiateDeviceFlow(this.config);
  }

  async pollDeviceFlowToken(deviceCode: string): Promise<DeviceFlowPollResult> {
    return this.deviceFlowHelper.pollDeviceFlowToken(this.config, deviceCode);
  }

  calculatePollDelay(baseInterval: number = 5, slowDownCount: number = 0): number {
    return this.deviceFlowHelper.calculatePollDelay(baseInterval, slowDownCount);
  }

  // API requests - delegated to ApiHelper
  protected createAuthHeaders(auth: ContentProviderAuthData | null | undefined): Record<string, string> | null {
    return this.apiHelper.createAuthHeaders(auth);
  }

  protected async apiRequest<T>(path: string, auth?: ContentProviderAuthData | null, method: "GET" | "POST" = "GET", body?: unknown): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, auth, method, body);
  }

  // Content factories
  protected createFolder(id: string, title: string, path: string, image?: string, isLeaf?: boolean): ContentFolder {
    return { type: "folder", id, title, path, image, isLeaf };
  }

  protected createFile(id: string, title: string, url: string, options?: { mediaType?: "video" | "image"; image?: string; muxPlaybackId?: string; seconds?: number; loop?: boolean; loopVideo?: boolean; streamUrl?: string; }): ContentFile {
    return { type: "file", id, title, url, mediaType: options?.mediaType ?? detectMediaType(url), image: options?.image, muxPlaybackId: options?.muxPlaybackId, seconds: options?.seconds, loop: options?.loop, loopVideo: options?.loopVideo, streamUrl: options?.streamUrl };
  }
}
