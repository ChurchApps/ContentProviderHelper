import {
  ContentProviderConfig,
  ContentProviderAuthData,
  ContentItem,
  ContentFolder,
  ContentFile,
} from '../interfaces';
import { ContentProvider } from '../ContentProvider';

/**
 * APlay content provider (Amazing Kids).
 *
 * Hierarchy mapping:
 * - Level 0: Modules → Folders
 * - Level 1: Products → Folders (nested in module response)
 * - Level 2: Libraries → Folders (fetched via API)
 * - Level 3: Media → Files (fetched via API)
 */
export class APlayProvider extends ContentProvider {
  readonly id = 'aplay';
  readonly name = 'APlay';

  readonly config: ContentProviderConfig = {
    id: 'aplay',
    name: 'APlay',
    apiBase: 'https://api-prod.amazingkids.app',
    oauthBase: 'https://api.joinamazing.com/prod/aims/oauth',
    clientId: 'xFJFq7yNYuXXXMx0YBiQ',
    scopes: ['openid', 'profile', 'email'],
    endpoints: {
      modules: '/prod/curriculum/modules',
      productLibraries: (productId: string) =>
        `/prod/curriculum/modules/products/${productId}/libraries`,
      libraryMedia: (libraryId: string) =>
        `/prod/creators/libraries/${libraryId}/media`,
    },
  };

  /**
   * Get root content (modules with their products as nested folders).
   */
  async getRootContents(auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const response = await this.apiRequest<Record<string, unknown>>(
      this.config.endpoints.modules as string,
      auth
    );
    if (!response) return [];

    const modules = (response.data || response.modules || response) as Record<string, unknown>[];
    if (!Array.isArray(modules)) return [];

    const items: ContentItem[] = [];

    for (const m of modules) {
      if (m.isLocked) continue;

      const allProducts = (m.products as Record<string, unknown>[]) || [];
      const products = allProducts.filter((p) => !p.isHidden);

      if (products.length === 0) {
        // Module with no products - treat as a folder that goes directly to libraries
        items.push({
          type: 'folder',
          id: (m.id || m.moduleId) as string,
          title: (m.title || m.name) as string,
          image: m.image as string | undefined,
          providerData: {
            level: 'libraries',
            productId: m.id || m.moduleId,
          },
        });
      } else if (products.length === 1) {
        // Single product - skip to libraries level
        const product = products[0];
        items.push({
          type: 'folder',
          id: (product.productId || product.id) as string,
          title: (m.title || m.name) as string, // Use module title
          image: (m.image || product.image) as string | undefined,
          providerData: {
            level: 'libraries',
            productId: product.productId || product.id,
          },
        });
      } else {
        // Multiple products - create a module folder containing product folders
        items.push({
          type: 'folder',
          id: (m.id || m.moduleId) as string,
          title: (m.title || m.name) as string,
          image: m.image as string | undefined,
          providerData: {
            level: 'products',
            products: products.map((p) => ({
              id: p.productId || p.id,
              title: p.title || p.name,
              image: p.image,
            })),
          },
        });
      }
    }

    return items;
  }

  /**
   * Get folder contents based on the folder's level.
   */
  async getFolderContents(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const level = folder.providerData?.level;

    switch (level) {
      case 'products':
        return this.getProductFolders(folder);
      case 'libraries':
        return this.getLibraryFolders(folder, auth);
      case 'media':
        return this.getMediaFiles(folder, auth);
      default:
        return [];
    }
  }

  /**
   * Get product folders from providerData (already fetched with modules).
   */
  private getProductFolders(folder: ContentFolder): ContentItem[] {
    const products = (folder.providerData?.products as Record<string, unknown>[]) || [];

    return products.map((p) => ({
      type: 'folder' as const,
      id: p.id as string,
      title: p.title as string,
      image: p.image as string | undefined,
      providerData: {
        level: 'libraries',
        productId: p.id,
      },
    }));
  }

  /**
   * Fetch libraries for a product from the API.
   */
  private async getLibraryFolders(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const productId = folder.providerData?.productId as string | undefined;
    if (!productId) return [];

    const pathFn = this.config.endpoints.productLibraries as (id: string) => string;
    const path = pathFn(productId);
    const response = await this.apiRequest<Record<string, unknown>>(path, auth);

    if (!response) return [];

    const libraries = (response.data || response.libraries || response) as Record<string, unknown>[];
    if (!Array.isArray(libraries)) return [];

    return libraries.map((l) => ({
      type: 'folder' as const,
      id: (l.libraryId || l.id) as string,
      title: (l.title || l.name) as string,
      image: l.image as string | undefined,
      providerData: {
        level: 'media',
        libraryId: l.libraryId || l.id,
      },
    }));
  }

  /**
   * Fetch media files for a library from the API.
   */
  private async getMediaFiles(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const libraryId = folder.providerData?.libraryId as string | undefined;
    if (!libraryId) return [];

    const pathFn = this.config.endpoints.libraryMedia as (id: string) => string;
    const path = pathFn(libraryId);
    const response = await this.apiRequest<Record<string, unknown>>(path, auth);

    if (!response) return [];

    const mediaItems = (response.data || response.media || response) as Record<string, unknown>[];
    if (!Array.isArray(mediaItems)) return [];

    const files: ContentFile[] = [];

    for (const item of mediaItems) {
      const mediaType = (item.mediaType as string)?.toLowerCase();

      // Extract URL based on media type
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

      const isVideo =
        mediaType === 'video' ||
        url.includes('.mp4') ||
        url.includes('.m3u8') ||
        url.includes('stream.mux.com');

      files.push({
        type: 'file',
        id: (item.mediaId || item.id) as string,
        title: (item.title || item.name || item.fileName || '') as string,
        mediaType: isVideo ? 'video' : 'image',
        thumbnail,
        url,
        muxPlaybackId,
      });
    }

    return files;
  }
}
