import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, ProviderCapabilities, IProvider, AuthType } from "../../interfaces";
import { detectMediaType } from "../../utils";
import { parsePath } from "../../pathUtils";
import { ApiHelper } from "../../helpers";
import { PCOServiceType, PCOPlan, PCOPlanItem, PCOSong, PCOArrangement, PCOSection, PCOAttachment } from "./PlanningCenterInterfaces";

/**
 * PlanningCenter Provider
 *
 * Path structure:
 *   /serviceTypes                            -> list service types
 *   /serviceTypes/{serviceTypeId}            -> list plans
 *   /serviceTypes/{serviceTypeId}/{planId}   -> plan items (leaf)
 */
export class PlanningCenterProvider implements IProvider {
  private readonly apiHelper = new ApiHelper();

  private async apiRequest<T>(path: string, auth?: ContentProviderAuthData | null): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, auth);
  }

  readonly id = "planningcenter";
  readonly name = "Planning Center";

  readonly logos: ProviderLogos = { light: "https://www.planningcenter.com/icons/icon-512x512.png", dark: "https://www.planningcenter.com/icons/icon-512x512.png" };

  readonly config: ContentProviderConfig = { id: "planningcenter", name: "Planning Center", apiBase: "https://api.planningcenteronline.com", oauthBase: "https://api.planningcenteronline.com/oauth", clientId: "", scopes: ["services"], endpoints: { serviceTypes: "/services/v2/service_types", plans: (serviceTypeId: string) => `/services/v2/service_types/${serviceTypeId}/plans`, planItems: (serviceTypeId: string, planId: string) => `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items`, song: (itemId: string) => `/services/v2/songs/${itemId}`, arrangement: (songId: string, arrangementId: string) => `/services/v2/songs/${songId}/arrangements/${arrangementId}`, arrangementSections: (songId: string, arrangementId: string) => `/services/v2/songs/${songId}/arrangements/${arrangementId}/sections`, media: (mediaId: string) => `/services/v2/media/${mediaId}`, mediaAttachments: (mediaId: string) => `/services/v2/media/${mediaId}/attachments` } };

  private readonly ONE_WEEK_MS = 604800000;

  readonly requiresAuth = true;
  readonly authTypes: AuthType[] = ["oauth_pkce"];
  readonly capabilities: ProviderCapabilities = { browse: true, presentations: true, playlist: false, instructions: false, mediaLicensing: false };

  async browse(path?: string | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);

    if (depth === 0) {
      return [{
        type: "folder" as const,
        id: "serviceTypes-root",
        title: "Service Types",
        path: "/serviceTypes"
      }];
    }

    const root = segments[0];
    if (root !== "serviceTypes") return [];

    // /serviceTypes -> list all service types
    if (depth === 1) {
      return this.getServiceTypes(auth);
    }

    // /serviceTypes/{serviceTypeId} -> list plans
    if (depth === 2) {
      const serviceTypeId = segments[1];
      return this.getPlans(serviceTypeId, path!, auth);
    }

    // /serviceTypes/{serviceTypeId}/{planId} -> plan items
    if (depth === 3) {
      const serviceTypeId = segments[1];
      const planId = segments[2];
      return this.getPlanItems(serviceTypeId, planId, auth);
    }

    return [];
  }

  private async getServiceTypes(auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const response = await this.apiRequest<{ data: PCOServiceType[] }>(
      this.config.endpoints.serviceTypes as string,
      auth
    );

    if (!response?.data) return [];

    return response.data.map((serviceType) => ({
      type: "folder" as const,
      id: serviceType.id,
      title: serviceType.attributes.name,
      path: `/serviceTypes/${serviceType.id}`
    }));
  }

  private async getPlans(serviceTypeId: string, currentPath: string, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const pathFn = this.config.endpoints.plans as (id: string) => string;
    const response = await this.apiRequest<{ data: PCOPlan[] }>(
      `${pathFn(serviceTypeId)}?filter=future&order=sort_date`,
      auth
    );

    if (!response?.data) return [];

    const now = Date.now();
    const filteredPlans = response.data.filter((plan) => {
      if (plan.attributes.items_count === 0) return false;
      const planDate = new Date(plan.attributes.sort_date).getTime();
      return planDate < now + this.ONE_WEEK_MS;
    });

    return filteredPlans.map((plan) => ({
      type: "folder" as const,
      id: plan.id,
      title: plan.attributes.title || this.formatDate(plan.attributes.sort_date),
      isLeaf: true,
      path: `${currentPath}/${plan.id}`,
      providerData: { sortDate: plan.attributes.sort_date }
    }));
  }

  private async getPlanItems(serviceTypeId: string, planId: string, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const pathFn = this.config.endpoints.planItems as (stId: string, pId: string) => string;
    const response = await this.apiRequest<{ data: PCOPlanItem[] }>(
      `${pathFn(serviceTypeId, planId)}?per_page=100`,
      auth
    );

    if (!response?.data) return [];

    return response.data.map((item) => ({ type: "file" as const, id: item.id, title: item.attributes.title || "", mediaType: "image" as const, url: "", providerData: { itemType: item.attributes.item_type, description: item.attributes.description, length: item.attributes.length, songId: item.relationships?.song?.data?.id, arrangementId: item.relationships?.arrangement?.data?.id } }));
  }

  async getPresentations(path: string, auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 3 || segments[0] !== "serviceTypes") return null;

    const serviceTypeId = segments[1];
    const planId = segments[2];

    const pathFn = this.config.endpoints.planItems as (stId: string, pId: string) => string;
    const response = await this.apiRequest<{ data: PCOPlanItem[] }>(
      `${pathFn(serviceTypeId, planId)}?per_page=100`,
      auth
    );

    if (!response?.data) return null;

    // Get plan title
    const plans = await this.getPlans(serviceTypeId, `/serviceTypes/${serviceTypeId}`, auth);
    const plan = plans.find(p => p.id === planId);
    const planTitle = plan?.title || "Plan";

    const sections: PlanSection[] = [];
    const allFiles: ContentFile[] = [];
    let currentSection: PlanSection | null = null;

    for (const item of response.data) {
      const itemType = item.attributes.item_type;

      if (itemType === "header") {
        if (currentSection && currentSection.presentations.length > 0) sections.push(currentSection);
        currentSection = { id: item.id, name: item.attributes.title || "Section", presentations: [] };
        continue;
      }

      if (!currentSection) {
        currentSection = { id: `default-${planId}`, name: "Service", presentations: [] };
      }

      const presentation = await this.convertToPresentation(item, auth);
      if (presentation) {
        currentSection.presentations.push(presentation);
        allFiles.push(...presentation.files);
      }
    }

    if (currentSection && currentSection.presentations.length > 0) {
      sections.push(currentSection);
    }

    return { id: planId, name: planTitle as string, sections, allFiles };
  }

  private async convertToPresentation(item: PCOPlanItem, auth?: ContentProviderAuthData | null): Promise<PlanPresentation | null> {
    const itemType = item.attributes.item_type;

    if (itemType === "song") {
      return this.convertSongToPresentation(item, auth);
    }

    if (itemType === "media") {
      return this.convertMediaToPresentation(item, auth);
    }

    if (itemType === "item") {
      return { id: item.id, name: item.attributes.title || "", actionType: "other", files: [], providerData: { itemType: "item", description: item.attributes.description, length: item.attributes.length } } as PlanPresentation;
    }

    return null;
  }

  private async convertSongToPresentation(item: PCOPlanItem, auth?: ContentProviderAuthData | null): Promise<PlanPresentation | null> {
    const songId = item.relationships?.song?.data?.id;
    const arrangementId = item.relationships?.arrangement?.data?.id;

    if (!songId) {
      return { id: item.id, name: item.attributes.title || "Song", actionType: "other", files: [], providerData: { itemType: "song" } } as PlanPresentation;
    }

    const songFn = this.config.endpoints.song as (id: string) => string;
    const songResponse = await this.apiRequest<{ data: PCOSong }>(songFn(songId), auth);

    let arrangement: PCOArrangement | null = null;
    let sections: PCOSection[] = [];

    if (arrangementId) {
      const arrangementFn = this.config.endpoints.arrangement as (sId: string, aId: string) => string;
      const arrangementResponse = await this.apiRequest<{ data: PCOArrangement }>(
        arrangementFn(songId, arrangementId),
        auth
      );
      arrangement = arrangementResponse?.data || null;

      const sectionsFn = this.config.endpoints.arrangementSections as (sId: string, aId: string) => string;
      const sectionsResponse = await this.apiRequest<{ data: { attributes: { sections: PCOSection[] } }[] }>(
        sectionsFn(songId, arrangementId),
        auth
      );
      sections = sectionsResponse?.data?.[0]?.attributes?.sections || [];
    }

    const song = songResponse?.data;
    const title = song?.attributes?.title || item.attributes.title || "Song";

    return { id: item.id, name: title, actionType: "other", files: [], providerData: { itemType: "song", title, author: song?.attributes?.author, copyright: song?.attributes?.copyright, ccliNumber: song?.attributes?.ccli_number, arrangementName: arrangement?.attributes?.name, keySignature: arrangement?.attributes?.chord_chart_key, bpm: arrangement?.attributes?.bpm, sequence: arrangement?.attributes?.sequence, sections: sections.map(s => ({ label: s.label, lyrics: s.lyrics })), length: item.attributes.length } } as PlanPresentation;
  }

  private async convertMediaToPresentation(item: PCOPlanItem, auth?: ContentProviderAuthData | null): Promise<PlanPresentation | null> {
    const files: ContentFile[] = [];

    const mediaFn = this.config.endpoints.media as (id: string) => string;
    const mediaAttachmentsFn = this.config.endpoints.mediaAttachments as (id: string) => string;

    const mediaResponse = await this.apiRequest<{ data: { id: string; attributes: { title?: string; length?: number } } }>(
      mediaFn(item.id),
      auth
    );

    if (mediaResponse?.data) {
      const attachmentsResponse = await this.apiRequest<{ data: PCOAttachment[] }>(
        mediaAttachmentsFn(mediaResponse.data.id),
        auth
      );

      for (const attachment of attachmentsResponse?.data || []) {
        const url = attachment.attributes.url;
        if (!url) continue;

        const contentType = attachment.attributes.content_type;
        const explicitType = contentType?.startsWith("video/") ? "video" : undefined;

        files.push({ type: "file", id: attachment.id, title: attachment.attributes.filename, mediaType: detectMediaType(url, explicitType), url });
      }
    }

    return { id: item.id, name: item.attributes.title || "Media", actionType: "play", files, providerData: { itemType: "media", length: item.attributes.length } } as PlanPresentation;
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toISOString().slice(0, 10);
  }
}
