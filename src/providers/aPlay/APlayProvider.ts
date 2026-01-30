import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities, MediaLicenseResult, IProvider, AuthType } from '../../interfaces';
import { detectMediaType } from '../../utils';
import { ApiHelper } from '../../helpers';

export class APlayProvider implements IProvider {
  private readonly apiHelper = new ApiHelper();

  private async apiRequest<T>(path: string, auth?: ContentProviderAuthData | null): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, auth);
  }
  readonly id = 'aplay';
  readonly name = 'APlay';

  readonly logos: ProviderLogos = {
    light: 'https://www.joinamazing.com/_assets/v11/3ba846c5afd7e73d27bc4d87b63d423e7ae2dc73.svg',
    dark: 'https://www.joinamazing.com/_assets/v11/3ba846c5afd7e73d27bc4d87b63d423e7ae2dc73.svg'
  };

  readonly config: ContentProviderConfig = {
    id: 'aplay',
    name: 'APlay',
    apiBase: 'https://api-prod.amazingkids.app',
    oauthBase: 'https://api.joinamazing.com/prod/aims/oauth',
    clientId: 'xFJFq7yNYuXXXMx0YBiQ',
    scopes: ['openid', 'profile', 'email'],
    endpoints: {
      modules: '/prod/curriculum/modules',
      productLibraries: (productId: string) => `/prod/curriculum/modules/products/${productId}/libraries`,
      libraryMedia: (libraryId: string) => `/prod/creators/libraries/${libraryId}/media`
    }
  };

  readonly requiresAuth = true;
  readonly authTypes: AuthType[] = ['oauth_pkce'];
  readonly capabilities: ProviderCapabilities = {
    browse: true,
    presentations: true,
    playlist: false,
    instructions: false,
    expandedInstructions: false,
    mediaLicensing: true
  };

  async browse(folder?: ContentFolder | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    console.log(`APlay browse called with folder:`, folder ? { id: folder.id, level: folder.providerData?.level } : 'null');
    console.log(`APlay browse auth present:`, !!auth);

    if (!folder) {
      console.log(`APlay fetching modules from: ${this.config.endpoints.modules}`);
      const response = await this.apiRequest<Record<string, unknown>>(this.config.endpoints.modules as string, auth);
      console.log(`APlay modules response:`, response ? 'received' : 'null');
      if (!response) return [];

      const modules = (response.data || response.modules || response) as Record<string, unknown>[];
      console.log(`APlay modules count:`, Array.isArray(modules) ? modules.length : 'not an array');
      if (!Array.isArray(modules)) return [];

      const items: ContentItem[] = [];

      for (const m of modules) {
        if (m.isLocked) continue;

        const allProducts = (m.products as Record<string, unknown>[]) || [];
        const products = allProducts.filter((p) => !p.isHidden);

        if (products.length === 0) {
          items.push({
            type: 'folder',
            id: (m.id || m.moduleId) as string,
            title: (m.title || m.name) as string,
            image: m.image as string | undefined,
            providerData: { level: 'libraries', productId: m.id || m.moduleId }
          });
        } else if (products.length === 1) {
          const product = products[0];
          items.push({
            type: 'folder',
            id: (product.productId || product.id) as string,
            title: (m.title || m.name) as string,
            image: (m.image || product.image) as string | undefined,
            providerData: { level: 'libraries', productId: product.productId || product.id }
          });
        } else {
          items.push({
            type: 'folder',
            id: (m.id || m.moduleId) as string,
            title: (m.title || m.name) as string,
            image: m.image as string | undefined,
            providerData: {
              level: 'products',
              products: products.map((p) => ({ id: p.productId || p.id, title: p.title || p.name, image: p.image }))
            }
          });
        }
      }

      return items;
    }

    const level = folder.providerData?.level;
    switch (level) {
      case 'products': return this.getProductFolders(folder);
      case 'libraries': return this.getLibraryFolders(folder, auth);
      case 'media': return this.getMediaFiles(folder, auth);
      default: return [];
    }
  }

  private getProductFolders(folder: ContentFolder): ContentItem[] {
    const products = (folder.providerData?.products as Record<string, unknown>[]) || [];
    return products.map((p) => ({
      type: 'folder' as const,
      id: p.id as string,
      title: p.title as string,
      image: p.image as string | undefined,
      providerData: { level: 'libraries', productId: p.id }
    }));
  }

  private async getLibraryFolders(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const productId = folder.providerData?.productId as string | undefined;
    console.log(`APlay getLibraryFolders called with productId:`, productId);
    if (!productId) return [];

    const pathFn = this.config.endpoints.productLibraries as (id: string) => string;
    const path = pathFn(productId);
    console.log(`APlay fetching libraries from: ${path}`);
    const response = await this.apiRequest<Record<string, unknown>>(path, auth);
    console.log(`APlay libraries response:`, response ? 'received' : 'null');
    if (!response) return [];

    const libraries = (response.data || response.libraries || response) as Record<string, unknown>[];
    console.log(`APlay libraries count:`, Array.isArray(libraries) ? libraries.length : 'not an array');
    if (!Array.isArray(libraries)) return [];

    return libraries.map((l) => ({
      type: 'folder' as const,
      id: (l.libraryId || l.id) as string,
      title: (l.title || l.name) as string,
      image: l.image as string | undefined,
      providerData: { level: 'media', libraryId: l.libraryId || l.id }
    }));
  }

  private async getMediaFiles(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const libraryId = folder.providerData?.libraryId as string | undefined;
    console.log(`APlay getMediaFiles called with libraryId:`, libraryId);
    if (!libraryId) return [];

    const pathFn = this.config.endpoints.libraryMedia as (id: string) => string;
    const path = pathFn(libraryId);
    console.log(`APlay fetching media from: ${path}`);
    const response = await this.apiRequest<Record<string, unknown>>(path, auth);
    console.log(`APlay media response:`, response ? 'received' : 'null');
    if (!response) return [];

    const mediaItems = (response.data || response.media || response) as Record<string, unknown>[];
    if (!Array.isArray(mediaItems)) return [];

    const files: ContentFile[] = [];

    for (const item of mediaItems) {
      const mediaType = (item.mediaType as string)?.toLowerCase();
      let url = '';
      let thumbnail = ((item.thumbnail as Record<string, unknown>)?.src || '') as string;
      let muxPlaybackId: string | undefined;

      const video = item.video as Record<string, unknown> | undefined;
      const image = item.image as Record<string, unknown> | undefined;

      if (mediaType === 'video' && video) {
        muxPlaybackId = video.muxPlaybackId as string | undefined;
        if (muxPlaybackId) {
          url = `https://stream.mux.com/${muxPlaybackId}/capped-1080p.mp4`;
        } else {
          url = (video.muxStreamingUrl || video.url || '') as string;
        }
        thumbnail = thumbnail || (video.thumbnailUrl as string) || '';
      } else if (mediaType === 'image' || image) {
        url = (image?.src || item.url || '') as string;
        thumbnail = thumbnail || (image?.src as string) || '';
      } else {
        url = (item.url || item.src || '') as string;
        thumbnail = thumbnail || (item.thumbnailUrl as string) || '';
      }

      if (!url) continue;

      const detectedMediaType = detectMediaType(url, mediaType);

      const fileId = (item.mediaId || item.id) as string;
      files.push({
        type: 'file',
        id: fileId,
        title: (item.title || item.name || item.fileName || '') as string,
        mediaType: detectedMediaType,
        image: thumbnail,
        url,
        muxPlaybackId,
        mediaId: fileId
      });
    }

    return files;
  }

  async getPresentations(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const libraryId = folder.providerData?.libraryId as string | undefined;
    if (!libraryId) return null;

    const files = await this.getMediaFiles(folder, auth) as ContentFile[];
    if (files.length === 0) return null;

    const presentations: PlanPresentation[] = files.map(f => ({
      id: f.id,
      name: f.title,
      actionType: 'play' as const,
      files: [f]
    }));

    return {
      id: libraryId,
      name: folder.title,
      image: folder.image,
      sections: [{
        id: `section-${libraryId}`,
        name: folder.title || 'Library',
        presentations
      }],
      allFiles: files
    };
  }

  async checkMediaLicense(mediaId: string, auth?: ContentProviderAuthData | null): Promise<MediaLicenseResult | null> {
    if (!auth) return null;

    try {
      const url = `${this.config.apiBase}/prod/reports/media/license-check`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.access_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ mediaIds: [mediaId] })
      });

      if (!response.ok) return null;

      const data = await response.json();
      const licenseData = Array.isArray(data) ? data : data.data || [];
      const result = licenseData.find((item: Record<string, unknown>) => item.mediaId === mediaId);

      if (result?.isLicensed) {
        const pingbackUrl = `${this.config.apiBase}/prod/reports/media/${mediaId}/stream-count?source=aplay-pro`;
        return {
          mediaId,
          status: 'valid',
          message: 'Media is licensed for playback',
          expiresAt: result.expiresAt as string | number | undefined
        };
      }

      return {
        mediaId,
        status: 'not_licensed',
        message: 'Media is not licensed'
      };
    } catch {
      return {
        mediaId,
        status: 'unknown',
        message: 'Unable to verify license status'
      };
    }
  }

}
