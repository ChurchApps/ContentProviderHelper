import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities, MediaLicenseResult, IProvider, AuthType } from "../../interfaces";
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
  readonly capabilities: ProviderCapabilities = { browse: true, presentations: true, playlist: false, instructions: false, mediaLicensing: true };

  async browse(path?: string | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);
    console.log("APlay browse called with path:", path, "depth:", depth);

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
    console.log(`APlay fetching modules from: ${this.config.endpoints.modules}`);
    const response = await this.apiRequest<Record<string, unknown>>(this.config.endpoints.modules as string, auth);
    console.log("APlay modules response:", response ? "received" : "null");
    if (!response) return [];

    const modules = (response.data || response.modules || response) as Record<string, unknown>[];
    console.log("APlay modules count:", Array.isArray(modules) ? modules.length : "not an array");
    if (!Array.isArray(modules)) return [];

    const items: ContentItem[] = [];

    for (const m of modules) {
      if (m.isLocked) continue;

      const moduleId = (m.id || m.moduleId) as string;
      const moduleTitle = (m.title || m.name) as string;
      const moduleImage = m.image as string | undefined;

      const allProducts = (m.products as Record<string, unknown>[]) || [];
      const products = allProducts.filter((p) => !p.isHidden);

      if (products.length === 0) {
        // No products - go directly to libraries
        items.push({
          type: "folder" as const,
          id: moduleId,
          title: moduleTitle,
          image: moduleImage,
          path: `/modules/${moduleId}`,
          providerData: { productCount: 0 }
        });
      } else if (products.length === 1) {
        // Single product - skip products level, go to libraries
        const product = products[0];
        items.push({
          type: "folder" as const,
          id: (product.productId || product.id) as string,
          title: moduleTitle,
          image: (moduleImage || product.image) as string | undefined,
          path: `/modules/${moduleId}`,
          providerData: { productCount: 1, productId: product.productId || product.id }
        });
      } else {
        // Multiple products - show products level
        items.push({
          type: "folder" as const,
          id: moduleId,
          title: moduleTitle,
          image: moduleImage,
          path: `/modules/${moduleId}`,
          providerData: {
            productCount: products.length,
            products: products.map((p) => ({
              id: p.productId || p.id,
              title: p.title || p.name,
              image: p.image
            }))
          }
        });
      }
    }

    return items;
  }

  private async getModuleContent(moduleId: string, currentPath: string, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    // Get module info to determine product count
    const modules = await this.getModules(auth);
    const module = modules.find(m => m.id === moduleId || (m.providerData as Record<string, unknown>)?.productId === moduleId);

    if (!module) return [];

    const providerData = module.providerData as Record<string, unknown> | undefined;
    const productCount = providerData?.productCount as number || 0;

    if (productCount === 0 || productCount === 1) {
      // Direct to libraries
      const productId = (providerData?.productId || moduleId) as string;
      return this.getLibraryFolders(productId, `${currentPath}/libraries`, auth);
    } else {
      // Show products
      const products = (providerData?.products || []) as Record<string, unknown>[];
      return products.map((p) => ({
        type: "folder" as const,
        id: p.id as string,
        title: p.title as string,
        image: p.image as string | undefined,
        path: `${currentPath}/products/${p.id}`
      }));
    }
  }

  private async getLibraryFolders(productId: string, currentPath: string, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    console.log("APlay getLibraryFolders called with productId:", productId);

    const pathFn = this.config.endpoints.productLibraries as (id: string) => string;
    const apiPath = pathFn(productId);
    console.log(`APlay fetching libraries from: ${apiPath}`);
    const response = await this.apiRequest<Record<string, unknown>>(apiPath, auth);
    console.log("APlay libraries response:", response ? "received" : "null");
    if (!response) return [];

    const libraries = (response.data || response.libraries || response) as Record<string, unknown>[];
    console.log("APlay libraries count:", Array.isArray(libraries) ? libraries.length : "not an array");
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
    console.log("APlay getMediaFiles called with libraryId:", libraryId);

    const pathFn = this.config.endpoints.libraryMedia as (id: string) => string;
    const apiPath = pathFn(libraryId);
    console.log(`APlay fetching media from: ${apiPath}`);
    const response = await this.apiRequest<Record<string, unknown>>(apiPath, auth);
    console.log("APlay media response:", response ? "received" : "null");
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
