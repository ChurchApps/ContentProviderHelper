import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities, MediaLicenseResult, IProvider, AuthType, Instructions, InstructionItem } from "../../interfaces";
import { detectMediaType } from "../../utils";
import { parsePath } from "../../pathUtils";
import { ApiHelper } from "../../helpers";

/**
 * APlay Provider
 *
 * Path structure (variable depth based on module products):
 *   /modules                                              -> list modules
 *   /modules/{moduleId}                                   -> list products OR libraries (depends on module)
 *   /modules/{moduleId}/products/{productId}              -> list libraries (if module has multiple products)
 *   /modules/{moduleId}/products/{productId}/{libraryId}  -> media files
 *   /modules/{moduleId}/libraries/{libraryId}             -> media files (if module has 0-1 products)
 */
export class APlayProvider implements IProvider {
  private readonly apiHelper = new ApiHelper();

  private async apiRequest<T>(path: string, auth?: ContentProviderAuthData | null): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, auth);
  }
  readonly id = "aplay";
  readonly name = "APlay";

  readonly logos: ProviderLogos = { light: "https://www.joinamazing.com/_assets/v11/3ba846c5afd7e73d27bc4d87b63d423e7ae2dc73.svg", dark: "https://www.joinamazing.com/_assets/v11/3ba846c5afd7e73d27bc4d87b63d423e7ae2dc73.svg" };

  readonly config: ContentProviderConfig = { id: "aplay", name: "APlay", apiBase: "https://api-prod.amazingkids.app", oauthBase: "https://api.joinamazing.com/prod/aims/oauth", clientId: "xFJFq7yNYuXXXMx0YBiQ", scopes: ["openid", "profile", "email"], endpoints: { modules: "/prod/curriculum/modules", productLibraries: (productId: string) => `/prod/curriculum/modules/products/${productId}/libraries`, libraryMedia: (libraryId: string) => `/prod/creators/libraries/${libraryId}/media` } };

  readonly requiresAuth = true;
  readonly authTypes: AuthType[] = ["oauth_pkce"];
  readonly capabilities: ProviderCapabilities = { browse: true, presentations: true, playlist: true, instructions: true, mediaLicensing: true };

  async browse(path?: string | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);

    if (depth === 0) {
      return [{
        type: "folder" as const,
        id: "modules-root",
        title: "Modules",
        path: "/modules"
      }];
    }

    const root = segments[0];
    if (root !== "modules") return [];

    // /modules -> list all modules
    if (depth === 1) {
      return this.getModules(auth);
    }

    // /modules/{moduleId} -> module content (products or libraries)
    if (depth === 2) {
      const moduleId = segments[1];
      return this.getModuleContent(moduleId, path!, auth);
    }

    // /modules/{moduleId}/products/{productId} -> libraries for product
    if (depth === 4 && segments[2] === "products") {
      const productId = segments[3];
      return this.getLibraryFolders(productId, path!, auth);
    }

    // /modules/{moduleId}/products/{productId}/{libraryId} -> media files
    if (depth === 5 && segments[2] === "products") {
      const libraryId = segments[4];
      return this.getMediaFiles(libraryId, auth);
    }

    // /modules/{moduleId}/libraries/{libraryId} -> media files (direct path)
    if (depth === 4 && segments[2] === "libraries") {
      const libraryId = segments[3];
      return this.getMediaFiles(libraryId, auth);
    }

    return [];
  }

  private async getModules(auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const response = await this.apiRequest<Record<string, unknown>>(this.config.endpoints.modules as string, auth);
    if (!response) return [];

    const modules = (response.data || response.modules || response) as Record<string, unknown>[];
    if (!Array.isArray(modules)) return [];

    const items: ContentItem[] = [];

    for (const m of modules) {
      if (m.isLocked) continue;

      const moduleId = (m.id || m.moduleId) as string;
      const moduleTitle = (m.title || m.name) as string;
      const moduleImage = m.image as string | undefined;

      // All modules get the same folder structure - product handling is done in getModuleContent
      items.push({
        type: "folder" as const,
        id: moduleId,
        title: moduleTitle,
        image: moduleImage,
        path: `/modules/${moduleId}`
      });
    }

    return items;
  }

  private async getModuleContent(moduleId: string, currentPath: string, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    // Fetch modules API directly to get product info
    const response = await this.apiRequest<Record<string, unknown>>(this.config.endpoints.modules as string, auth);
    if (!response) return [];

    const modules = (response.data || response.modules || response) as Record<string, unknown>[];
    if (!Array.isArray(modules)) return [];

    const module = modules.find(m => (m.id || m.moduleId) === moduleId);
    if (!module) return [];

    const allProducts = (module.products as Record<string, unknown>[]) || [];
    const products = allProducts.filter((p) => !p.isHidden);

    if (products.length === 0) {
      // No products - use moduleId as productId for libraries
      return this.getLibraryFolders(moduleId, `${currentPath}/libraries`, auth);
    } else if (products.length === 1) {
      // Single product - go directly to libraries
      const productId = (products[0].productId || products[0].id) as string;
      return this.getLibraryFolders(productId, `${currentPath}/libraries`, auth);
    } else {
      // Multiple products - show products list
      return products.map((p) => ({
        type: "folder" as const,
        id: (p.productId || p.id) as string,
        title: (p.title || p.name) as string,
        image: p.image as string | undefined,
        path: `${currentPath}/products/${p.productId || p.id}`
      }));
    }
  }

  private async getLibraryFolders(productId: string, currentPath: string, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const pathFn = this.config.endpoints.productLibraries as (id: string) => string;
    const apiPath = pathFn(productId);
    const response = await this.apiRequest<Record<string, unknown>>(apiPath, auth);
    if (!response) return [];

    const libraries = (response.data || response.libraries || response) as Record<string, unknown>[];
    if (!Array.isArray(libraries)) return [];

    return libraries.map((l) => ({
      type: "folder" as const,
      id: (l.libraryId || l.id) as string,
      title: (l.title || l.name) as string,
      image: l.image as string | undefined,
      isLeaf: true,
      path: `${currentPath}/${l.libraryId || l.id}`
    }));
  }

  private async getMediaFiles(libraryId: string, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const pathFn = this.config.endpoints.libraryMedia as (id: string) => string;
    const apiPath = pathFn(libraryId);
    const response = await this.apiRequest<Record<string, unknown>>(apiPath, auth);
    if (!response) return [];

    const mediaItems = (response.data || response.media || response) as Record<string, unknown>[];
    if (!Array.isArray(mediaItems)) return [];

    const files: ContentFile[] = [];

    for (const item of mediaItems) {
      const mediaType = (item.mediaType as string)?.toLowerCase();
      let url = "";
      let thumbnail = ((item.thumbnail as Record<string, unknown>)?.src || "") as string;
      let muxPlaybackId: string | undefined;

      const video = item.video as Record<string, unknown> | undefined;
      const image = item.image as Record<string, unknown> | undefined;

      if (mediaType === "video" && video) {
        muxPlaybackId = video.muxPlaybackId as string | undefined;
        if (muxPlaybackId) {
          url = `https://stream.mux.com/${muxPlaybackId}/capped-1080p.mp4`;
        } else {
          url = (video.muxStreamingUrl || video.url || "") as string;
        }
        thumbnail = thumbnail || (video.thumbnailUrl as string) || "";
      } else if (mediaType === "image" || image) {
        url = (image?.src || item.url || "") as string;
        thumbnail = thumbnail || (image?.src as string) || "";
      } else {
        url = (item.url || item.src || "") as string;
        thumbnail = thumbnail || (item.thumbnailUrl as string) || "";
      }

      if (!url) continue;

      const detectedMediaType = detectMediaType(url, mediaType);

      const fileId = (item.mediaId || item.id) as string;
      files.push({ type: "file", id: fileId, title: (item.title || item.name || item.fileName || "") as string, mediaType: detectedMediaType, image: thumbnail, url, muxPlaybackId, mediaId: fileId });
    }

    return files;
  }

  async getPresentations(path: string, auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 4 || segments[0] !== "modules") return null;

    let libraryId: string;
    const title = "Library";

    // /modules/{moduleId}/products/{productId}/{libraryId}
    if (segments[2] === "products" && depth === 5) {
      libraryId = segments[4];
    }
    // /modules/{moduleId}/libraries/{libraryId}
    else if (segments[2] === "libraries" && depth === 4) {
      libraryId = segments[3];
    } else {
      return null;
    }

    const files = await this.getMediaFiles(libraryId, auth) as ContentFile[];
    if (files.length === 0) return null;

    const presentations: PlanPresentation[] = files.map(f => ({ id: f.id, name: f.title, actionType: "play" as const, files: [f] }));
    return { id: libraryId, name: title, sections: [{ id: `section-${libraryId}`, name: title, presentations }], allFiles: files };
  }

  async getPlaylist(path: string, auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 4 || segments[0] !== "modules") return null;

    let libraryId: string;

    // /modules/{moduleId}/products/{productId}/{libraryId}
    if (segments[2] === "products" && depth === 5) {
      libraryId = segments[4];
    }
    // /modules/{moduleId}/libraries/{libraryId}
    else if (segments[2] === "libraries" && depth === 4) {
      libraryId = segments[3];
    } else {
      return null;
    }

    const files = await this.getMediaFiles(libraryId, auth) as ContentFile[];
    return files.length > 0 ? files : null;
  }

  async getInstructions(path: string, auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 4 || segments[0] !== "modules") return null;

    let libraryId: string;

    // /modules/{moduleId}/products/{productId}/{libraryId}
    if (segments[2] === "products" && depth === 5) {
      libraryId = segments[4];
    }
    // /modules/{moduleId}/libraries/{libraryId}
    else if (segments[2] === "libraries" && depth === 4) {
      libraryId = segments[3];
    } else {
      return null;
    }

    const files = await this.getMediaFiles(libraryId, auth) as ContentFile[];
    if (files.length === 0) return null;

    const fileItems: InstructionItem[] = files.map(file => ({
      id: file.id,
      itemType: "file",
      label: file.title,
      embedUrl: file.url
    }));

    return {
      venueName: "Library",
      items: [{
        id: `section-${libraryId}`,
        itemType: "section",
        label: "Content",
        children: fileItems
      }]
    };
  }

  async checkMediaLicense(mediaId: string, auth?: ContentProviderAuthData | null): Promise<MediaLicenseResult | null> {
    if (!auth) return null;

    try {
      const url = `${this.config.apiBase}/prod/reports/media/license-check`;
      const response = await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${auth.access_token}`, "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ mediaIds: [mediaId] }) });

      if (!response.ok) return null;

      const data = await response.json();
      const licenseData = Array.isArray(data) ? data : data.data || [];
      const result = licenseData.find((item: Record<string, unknown>) => item.mediaId === mediaId);

      if (result?.isLicensed) {
        return { mediaId, status: "valid", message: "Media is licensed for playback", expiresAt: result.expiresAt as string | number | undefined };
      }
      return { mediaId, status: "not_licensed", message: "Media is not licensed" };
    } catch {
      return { mediaId, status: "unknown", message: "Unable to verify license status" };
    }
  }
}
