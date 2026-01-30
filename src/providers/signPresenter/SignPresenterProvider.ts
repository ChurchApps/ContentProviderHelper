import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities, IProvider, AuthType } from '../../interfaces';
import { detectMediaType } from '../../utils';
import { ApiHelper } from '../../helpers';

export class SignPresenterProvider implements IProvider {
  private readonly apiHelper = new ApiHelper();

  private async apiRequest<T>(path: string, auth?: ContentProviderAuthData | null): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, auth);
  }
  readonly id = 'signpresenter';
  readonly name = 'SignPresenter';

  readonly logos: ProviderLogos = {
    light: 'https://signpresenter.com/files/shared/images/logo.png',
    dark: 'https://signpresenter.com/files/shared/images/logo.png'
  };

  readonly config: ContentProviderConfig = {
    id: 'signpresenter',
    name: 'SignPresenter',
    apiBase: 'https://api.signpresenter.com',
    oauthBase: 'https://api.signpresenter.com/oauth',
    clientId: 'lessonsscreen-tv',
    scopes: ['openid', 'profile', 'content'],
    supportsDeviceFlow: true,
    deviceAuthEndpoint: '/device/authorize',
    endpoints: {
      playlists: '/content/playlists',
      messages: (playlistId: string) => `/content/playlists/${playlistId}/messages`
    }
  };

  requiresAuth(): boolean {
    return true;
  }

  getAuthTypes(): AuthType[] {
    return ['oauth_pkce', 'device_flow'];
  }

  getCapabilities(): ProviderCapabilities {
    return {
      browse: true,
      presentations: true,
      playlist: false,
      instructions: false,
      expandedInstructions: false,
      mediaLicensing: false
    };
  }

  async browse(folder?: ContentFolder | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!folder) {
      const path = this.config.endpoints.playlists as string;
      const response = await this.apiRequest<unknown>(path, auth);
      if (!response) return [];

      const playlists = Array.isArray(response)
        ? response
        : ((response as Record<string, unknown>).data || (response as Record<string, unknown>).playlists || []) as Record<string, unknown>[];

      if (!Array.isArray(playlists)) return [];

      return playlists.map((p) => ({
        type: 'folder' as const,
        id: p.id as string,
        title: p.name as string,
        image: p.image as string | undefined,
        providerData: { level: 'messages', playlistId: p.id }
      }));
    }

    const level = folder.providerData?.level;
    if (level === 'messages') return this.getMessages(folder, auth);
    return [];
  }

  private async getMessages(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const playlistId = folder.providerData?.playlistId as string | undefined;
    if (!playlistId) return [];

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

      files.push({
        type: 'file',
        id: msg.id as string,
        title: msg.name as string,
        mediaType: detectMediaType(url, msg.mediaType as string | undefined),
        image: (msg.thumbnail || msg.image) as string | undefined,
        url,
        // For direct media providers, embedUrl is the media URL itself
        embedUrl: url,
        providerData: seconds !== undefined ? { seconds } : undefined
      });
    }

    return files;
  }

  async getPresentations(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const playlistId = folder.providerData?.playlistId as string | undefined;
    if (!playlistId) return null;

    const files = await this.getMessages(folder, auth) as ContentFile[];
    if (files.length === 0) return null;

    const presentations: PlanPresentation[] = files.map(f => ({
      id: f.id,
      name: f.title,
      actionType: 'play' as const,
      files: [f]
    }));

    return {
      id: playlistId,
      name: folder.title,
      image: folder.image,
      sections: [{
        id: `section-${playlistId}`,
        name: folder.title || 'Playlist',
        presentations
      }],
      allFiles: files
    };
  }

}
