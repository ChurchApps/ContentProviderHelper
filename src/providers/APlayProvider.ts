import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities } from '../interfaces';
import { ContentProvider } from '../ContentProvider';
import { detectMediaType } from '../utils';

export class APlayProvider extends ContentProvider {
  readonly id = 'aplay';
  readonly name = 'APlay';

  readonly logos: ProviderLogos = {
    light: 'https://joinaplay.com/hs-fs/hubfs/APlay_Logo_Horizontal_Jungle%20Green.png?width=400&height=122&name=APlay_Logo_Horizontal_Jungle%20Green.png',
    dark: 'https://joinaplay.com/hs-fs/hubfs/APlay_Logo_Horizontal_Jungle%20Green.png?width=400&height=122&name=APlay_Logo_Horizontal_Jungle%20Green.png'
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

  override getCapabilities(): ProviderCapabilities {
    return {
      browse: true,
      presentations: true,
      playlist: false,
      instructions: false,
      expandedInstructions: false
    };
  }

  async browse(folder?: ContentFolder | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!folder) {
      const response = await this.apiRequest<Record<string, unknown>>(this.config.endpoints.modules as string, auth);
      if (!response) return [];

      const modules = (response.data || response.modules || response) as Record<string, unknown>[];
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
    if (!productId) return [];

    const pathFn = this.config.endpoints.productLibraries as (id: string) => string;
    const response = await this.apiRequest<Record<string, unknown>>(pathFn(productId), auth);
    if (!response) return [];

    const libraries = (response.data || response.libraries || response) as Record<string, unknown>[];
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
    if (!libraryId) return [];

    const pathFn = this.config.endpoints.libraryMedia as (id: string) => string;
    const response = await this.apiRequest<Record<string, unknown>>(pathFn(libraryId), auth);
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

      files.push({
        type: 'file',
        id: (item.mediaId || item.id) as string,
        title: (item.title || item.name || item.fileName || '') as string,
        mediaType: detectedMediaType,
        thumbnail,
        url,
        muxPlaybackId
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

}
