import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, Instructions } from '../interfaces';
import { ContentProvider } from '../ContentProvider';

export class SignPresenterProvider extends ContentProvider {
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

  async getRootContents(auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
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

  async getFolderContents(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
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
      const isVideo = msg.mediaType === 'video' || url.includes('.mp4') || url.includes('.webm') || url.includes('.m3u8');

      files.push({
        type: 'file',
        id: msg.id as string,
        title: msg.name as string,
        mediaType: isVideo ? 'video' : 'image',
        thumbnail: (msg.thumbnail || msg.image) as string | undefined,
        url
      });
    }

    return files;
  }

  async getPresentations(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    return null;
  }

  async getInstructions(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    return null;
  }
}
