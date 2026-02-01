import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities, IProvider, AuthType } from "../../interfaces";
import { detectMediaType } from "../../utils";
import { parsePath } from "../../pathUtils";
import { ApiHelper } from "../../helpers";

/**
 * SignPresenter Provider
 *
 * Path structure:
 *   /playlists                    -> list playlists
 *   /playlists/{playlistId}       -> list messages (files)
 */
export class SignPresenterProvider implements IProvider {
  private readonly apiHelper = new ApiHelper();

  private async apiRequest<T>(path: string, auth?: ContentProviderAuthData | null): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, auth);
  }
  readonly id = "signpresenter";
  readonly name = "SignPresenter";

  readonly logos: ProviderLogos = { light: "https://signpresenter.com/files/shared/images/logo.png", dark: "https://signpresenter.com/files/shared/images/logo.png" };

  readonly config: ContentProviderConfig = { id: "signpresenter", name: "SignPresenter", apiBase: "https://api.signpresenter.com", oauthBase: "https://api.signpresenter.com/oauth", clientId: "lessonsscreen-tv", scopes: ["openid", "profile", "content"], supportsDeviceFlow: true, deviceAuthEndpoint: "/device/authorize", endpoints: { playlists: "/content/playlists", messages: (playlistId: string) => `/content/playlists/${playlistId}/messages` } };

  readonly requiresAuth = true;
  readonly authTypes: AuthType[] = ["oauth_pkce", "device_flow"];
  readonly capabilities: ProviderCapabilities = { browse: true, presentations: true, playlist: false, instructions: false, mediaLicensing: false };

  async browse(path?: string | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);

    if (depth === 0) {
      return [{
        type: "folder" as const,
        id: "playlists-root",
        title: "Playlists",
        path: "/playlists"
      }];
    }

    const root = segments[0];
    if (root !== "playlists") return [];

    // /playlists -> list all playlists
    if (depth === 1) {
      return this.getPlaylists(auth);
    }

    // /playlists/{playlistId} -> list messages
    if (depth === 2) {
      const playlistId = segments[1];
      return this.getMessages(playlistId, auth);
    }

    return [];
  }

  private async getPlaylists(auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const apiPath = this.config.endpoints.playlists as string;
    const response = await this.apiRequest<unknown>(apiPath, auth);
    if (!response) return [];

    const playlists = Array.isArray(response)
      ? response
      : ((response as Record<string, unknown>).data || (response as Record<string, unknown>).playlists || []) as Record<string, unknown>[];

    if (!Array.isArray(playlists)) return [];

    return playlists.map((p) => ({
      type: "folder" as const,
      id: p.id as string,
      title: p.name as string,
      image: p.image as string | undefined,
      path: `/playlists/${p.id}`
    }));
  }

  private async getMessages(playlistId: string, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const pathFn = this.config.endpoints.messages as (id: string) => string;
    const response = await this.apiRequest<unknown>(pathFn(playlistId), auth);
    if (!response) return [];

    const messages = Array.isArray(response)
      ? response
      : ((response as Record<string, unknown>).data || (response as Record<string, unknown>).messages || []) as Record<string, unknown>[];

    if (!Array.isArray(messages)) return [];

    const files: ContentFile[] = [];

    for (const msg of messages) {
      if (!msg.url) continue;

      const url = msg.url as string;
      const seconds = msg.seconds as number | undefined;

      files.push({ type: "file", id: msg.id as string, title: msg.name as string, mediaType: detectMediaType(url, msg.mediaType as string | undefined), image: (msg.thumbnail || msg.image) as string | undefined, url, embedUrl: url, providerData: seconds !== undefined ? { seconds } : undefined });
    }

    return files;
  }

  async getPresentations(path: string, auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 2 || segments[0] !== "playlists") return null;

    const playlistId = segments[1];
    const files = await this.getMessages(playlistId, auth) as ContentFile[];
    if (files.length === 0) return null;

    // Get playlist info for title
    const playlists = await this.getPlaylists(auth);
    const playlist = playlists.find(p => p.id === playlistId);
    const title = playlist?.title || "Playlist";
    const image = (playlist as Record<string, unknown> | undefined)?.image as string | undefined;

    const presentations: PlanPresentation[] = files.map(f => ({ id: f.id, name: f.title, actionType: "play" as const, files: [f] }));
    return { id: playlistId, name: title as string, image, sections: [{ id: `section-${playlistId}`, name: title as string, presentations }], allFiles: files };
  }
}
