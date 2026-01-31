import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, FeedVenueInterface, Instructions, InstructionItem, VenueActionsResponseInterface, ProviderCapabilities, IProvider, AuthType } from "../../interfaces";
import { detectMediaType } from "../../utils";
import { parsePath, getSegment } from "../../pathUtils";
import { estimateImageDuration } from "../../durationUtils";

/**
 * LessonsChurch Provider
 *
 * Path structure:
 *   /lessons                                            -> programs
 *   /lessons/{programId}                                -> studies
 *   /lessons/{programId}/{studyId}                      -> lessons
 *   /lessons/{programId}/{studyId}/{lessonId}           -> venues
 *   /lessons/{programId}/{studyId}/{lessonId}/{venueId} -> playlist files
 *
 *   /addons                                             -> categories
 *   /addons/{category}                                  -> add-on files
 */
export class LessonsChurchProvider implements IProvider {
  readonly id = "lessonschurch";
  readonly name = "Lessons.church";

  readonly logos: ProviderLogos = { light: "https://lessons.church/images/logo.png", dark: "https://lessons.church/images/logo-dark.png" };

  readonly config: ContentProviderConfig = { id: "lessonschurch", name: "Lessons.church", apiBase: "https://api.lessons.church", oauthBase: "", clientId: "", scopes: [], endpoints: { programs: "/programs/public", studies: (programId: string) => `/studies/public/program/${programId}`, lessons: (studyId: string) => `/lessons/public/study/${studyId}`, venues: (lessonId: string) => `/venues/public/lesson/${lessonId}`, playlist: (venueId: string) => `/venues/playlist/${venueId}`, feed: (venueId: string) => `/venues/public/feed/${venueId}`, addOns: "/addOns/public", addOnDetail: (id: string) => `/addOns/public/${id}` } };

  readonly requiresAuth = false;
  readonly authTypes: AuthType[] = ["none"];
  readonly capabilities: ProviderCapabilities = { browse: true, presentations: true, playlist: true, instructions: true, expandedInstructions: true, mediaLicensing: false };

  async getPlaylist(path: string, _auth?: ContentProviderAuthData | null, resolution?: number): Promise<ContentFile[] | null> {
    const venueId = getSegment(path, 4); // /lessons/{0}/{1}/{2}/{3}/{4=venueId}
    if (!venueId) return null;

    let apiPath = `/venues/playlist/${venueId}`;
    if (resolution) apiPath += `?resolution=${resolution}`;

    const response = await this.apiRequest<Record<string, unknown>>(apiPath);
    if (!response) return null;

    const files: ContentFile[] = [];
    const messages = (response.messages || []) as Record<string, unknown>[];

    let fileIndex = 0;
    for (const msg of messages) {
      const msgFiles = (msg.files || []) as Record<string, unknown>[];
      for (let i = 0; i < msgFiles.length; i++) {
        const f = msgFiles[i];
        if (!f.url) continue;

        const url = f.url as string;
        const fileId = (f.id as string) || `playlist-${fileIndex++}`;

        files.push({ type: "file", id: fileId, title: (f.name || msg.name) as string, mediaType: detectMediaType(url, f.fileType as string | undefined), image: response.lessonImage as string | undefined, url, providerData: { seconds: f.seconds, loop: f.loop, loopVideo: f.loopVideo } });
      }
    }

    return files;
  }

  private async apiRequest<T>(path: string): Promise<T | null> {
    try {
      const url = `${this.config.apiBase}${path}`;
      const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async browse(path?: string | null, _auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);
    console.log("[LessonsChurchProvider.browse] path:", path, "depth:", depth, "segments:", segments);

    if (depth === 0) {
      return [
        { type: "folder" as const, id: "lessons-root", title: "Lessons", path: "/lessons" },
        { type: "folder" as const, id: "addons-root", title: "Add-Ons", path: "/addons" }
      ];
    }

    const root = segments[0];
    if (root === "lessons") return this.browseLessons(path!, segments);
    if (root === "addons") return this.browseAddOns(path!, segments);
    return [];
  }

  private async browseLessons(currentPath: string, segments: string[]): Promise<ContentItem[]> {
    const depth = segments.length;

    // /lessons -> programs
    if (depth === 1) return this.getPrograms();
    // /lessons/{programId} -> studies
    if (depth === 2) return this.getStudies(segments[1], currentPath);
    // /lessons/{programId}/{studyId} -> lessons
    if (depth === 3) return this.getLessons(segments[2], currentPath);
    // /lessons/{programId}/{studyId}/{lessonId} -> venues
    if (depth === 4) return this.getVenues(segments[3], currentPath);
    // /lessons/{programId}/{studyId}/{lessonId}/{venueId} -> playlist files
    if (depth === 5) return this.getPlaylistFiles(segments[4]);

    return [];
  }

  private async getPrograms(): Promise<ContentItem[]> {
    const apiPath = this.config.endpoints.programs as string;
    const response = await this.apiRequest<Record<string, unknown>[]>(apiPath);
    if (!response) return [];

    const programs = Array.isArray(response) ? response : [];
    return programs.map((p) => ({
      type: "folder" as const,
      id: p.id as string,
      title: p.name as string,
      image: p.image as string | undefined,
      path: `/lessons/${p.id}`
    }));
  }

  private async getStudies(programId: string, currentPath: string): Promise<ContentItem[]> {
    const pathFn = this.config.endpoints.studies as (id: string) => string;
    const response = await this.apiRequest<Record<string, unknown>[]>(pathFn(programId));
    if (!response) return [];

    const studies = Array.isArray(response) ? response : [];
    return studies.map((s) => ({
      type: "folder" as const,
      id: s.id as string,
      title: s.name as string,
      image: s.image as string | undefined,
      path: `${currentPath}/${s.id}`
    }));
  }

  private async getLessons(studyId: string, currentPath: string): Promise<ContentItem[]> {
    const pathFn = this.config.endpoints.lessons as (id: string) => string;
    const response = await this.apiRequest<Record<string, unknown>[]>(pathFn(studyId));
    if (!response) return [];

    const lessons = Array.isArray(response) ? response : [];
    return lessons.map((l) => ({
      type: "folder" as const,
      id: l.id as string,
      title: (l.name || l.title) as string,
      image: l.image as string | undefined,
      path: `${currentPath}/${l.id}`,
      providerData: { lessonImage: l.image } // Keep for display on venues
    }));
  }

  private async getVenues(lessonId: string, currentPath: string): Promise<ContentItem[]> {
    const pathFn = this.config.endpoints.venues as (id: string) => string;
    const response = await this.apiRequest<Record<string, unknown>[]>(pathFn(lessonId));
    if (!response) return [];

    // Fetch lesson details for image
    const lessonResponse = await this.apiRequest<Record<string, unknown>>(`/lessons/public/${lessonId}`);
    const lessonImage = lessonResponse?.image as string | undefined;

    const venues = Array.isArray(response) ? response : [];
    const result = venues.map((v) => ({
      type: "folder" as const,
      id: v.id as string,
      title: v.name as string,
      image: lessonImage,
      isLeaf: true,
      path: `${currentPath}/${v.id}`
    }));
    console.log("[LessonsChurchProvider.getVenues] returning:", result.map(r => ({ id: r.id, title: r.title, isLeaf: r.isLeaf })));
    return result;
  }

  private async getPlaylistFiles(venueId: string): Promise<ContentItem[]> {
    const files = await this.getPlaylist(`/lessons/_/_/_/${venueId}`, null);
    return files || [];
  }

  private async browseAddOns(_currentPath: string, segments: string[]): Promise<ContentItem[]> {
    const depth = segments.length;

    // /addons -> categories
    if (depth === 1) return this.getAddOnCategories();
    // /addons/{category} -> add-on files
    if (depth === 2) return this.getAddOnsByCategory(segments[1]);

    return [];
  }

  private async getAddOnCategories(): Promise<ContentItem[]> {
    const apiPath = this.config.endpoints.addOns as string;
    const response = await this.apiRequest<Record<string, unknown>[]>(apiPath);
    if (!response) return [];

    const addOns = Array.isArray(response) ? response : [];
    const categories = Array.from(new Set(addOns.map((a) => a.category as string).filter(Boolean)));

    return categories.sort().map((category) => ({
      type: "folder" as const,
      id: `category-${category}`,
      title: category,
      path: `/addons/${encodeURIComponent(category)}`
    }));
  }

  private async getAddOnsByCategory(category: string): Promise<ContentItem[]> {
    const decodedCategory = decodeURIComponent(category);

    // Fetch add-ons fresh each time
    const apiPath = this.config.endpoints.addOns as string;
    const response = await this.apiRequest<Record<string, unknown>[]>(apiPath);
    if (!response) return [];

    const allAddOns = Array.isArray(response) ? response : [];
    const filtered = allAddOns.filter((a) => a.category === decodedCategory);

    const files: ContentFile[] = [];
    for (const addOn of filtered) {
      const file = await this.convertAddOnToFile(addOn);
      if (file) files.push(file);
    }
    return files;
  }

  private async convertAddOnToFile(addOn: Record<string, unknown>): Promise<ContentFile | null> {
    const pathFn = this.config.endpoints.addOnDetail as (id: string) => string;
    const apiPath = pathFn(addOn.id as string);
    const detail = await this.apiRequest<Record<string, unknown>>(apiPath);
    if (!detail) return null;

    let url = "";
    let mediaType: "video" | "image" = "video";
    let seconds = (addOn.seconds as number) || 10;

    const video = detail.video as Record<string, unknown> | undefined;
    const file = detail.file as Record<string, unknown> | undefined;

    if (video) {
      url = `${this.config.apiBase}/externalVideos/download/${video.id}`;
      seconds = (video.seconds as number) || seconds;
    } else if (file) {
      url = file.contentPath as string;
      const fileType = file.fileType as string | undefined;
      mediaType = fileType?.startsWith("video/") ? "video" : "image";
    } else {
      return null;
    }

    return { type: "file", id: addOn.id as string, title: addOn.name as string, mediaType, image: addOn.image as string | undefined, url, embedUrl: `https://lessons.church/embed/addon/${addOn.id}`, providerData: { seconds, loopVideo: (video as Record<string, unknown> | undefined)?.loopVideo || false } };
  }

  async getPresentations(path: string, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const venueId = getSegment(path, 4); // /lessons/{0}/{1}/{2}/{3}/{4=venueId}
    if (!venueId) return null;

    const apiPath = `/venues/public/feed/${venueId}`;
    const venueData = await this.apiRequest<FeedVenueInterface>(apiPath);
    if (!venueData) return null;

    return this.convertVenueToPlan(venueData);
  }

  async getInstructions(path: string, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const venueId = getSegment(path, 4);
    if (!venueId) return null;

    const response = await this.apiRequest<{ venueName?: string; items?: Record<string, unknown>[] }>(`/venues/public/planItems/${venueId}`);
    if (!response) return null;

    const processItem = (item: Record<string, unknown>): InstructionItem => {
      const itemType = this.normalizeItemType(item.itemType as string | undefined);
      const relatedId = item.relatedId as string | undefined;
      return { id: item.id as string | undefined, itemType, relatedId, label: item.label as string | undefined, description: item.description as string | undefined, seconds: item.seconds as number | undefined, children: (item.children as Record<string, unknown>[] | undefined)?.map(processItem), embedUrl: this.getEmbedUrl(itemType, relatedId) };
    };
    return { venueName: response.venueName, items: (response.items || []).map(processItem) };
  }

  async getExpandedInstructions(path: string, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const venueId = getSegment(path, 4);
    if (!venueId) return null;

    const [planItemsResponse, actionsResponse] = await Promise.all([
      this.apiRequest<{ venueName?: string; items?: Record<string, unknown>[] }>(`/venues/public/planItems/${venueId}`),
      this.apiRequest<VenueActionsResponseInterface>(`/venues/public/actions/${venueId}`)
    ]);

    if (!planItemsResponse) return null;

    const sectionActionsMap = new Map<string, InstructionItem[]>();
    if (actionsResponse?.sections) {
      for (const section of actionsResponse.sections) {
        if (section.id && section.actions) {
          sectionActionsMap.set(section.id, section.actions.map(action => {
            const embedUrl = this.getEmbedUrl("action", action.id);
            const seconds = action.seconds ?? estimateImageDuration();
            return { id: action.id, itemType: "action", relatedId: action.id, label: action.name, description: action.actionType, seconds, children: [{ id: action.id + "-file", itemType: "file", label: action.name, seconds, embedUrl }] };
          }));
        }
      }
    }

    const processItem = (item: Record<string, unknown>): InstructionItem => {
      const relatedId = item.relatedId as string | undefined;
      const itemType = this.normalizeItemType(item.itemType as string | undefined);
      const children = item.children as Record<string, unknown>[] | undefined;

      let processedChildren: InstructionItem[] | undefined;

      if (children) {
        processedChildren = children.map(child => {
          const childRelatedId = child.relatedId as string | undefined;
          const childItemType = this.normalizeItemType(child.itemType as string | undefined);
          if (childRelatedId && sectionActionsMap.has(childRelatedId)) {
            return { id: child.id as string | undefined, itemType: childItemType, relatedId: childRelatedId, label: child.label as string | undefined, description: child.description as string | undefined, seconds: child.seconds as number | undefined, children: sectionActionsMap.get(childRelatedId), embedUrl: this.getEmbedUrl(childItemType, childRelatedId) };
          }
          return processItem(child);
        });
      }

      return { id: item.id as string | undefined, itemType, relatedId, label: item.label as string | undefined, description: item.description as string | undefined, seconds: item.seconds as number | undefined, children: processedChildren, embedUrl: this.getEmbedUrl(itemType, relatedId) };
    };

    return { venueName: planItemsResponse.venueName, items: (planItemsResponse.items || []).map(processItem) };
  }

  private normalizeItemType(type?: string): string | undefined {
    if (type === "lessonSection") return "section";
    if (type === "lessonAction") return "action";
    if (type === "lessonAddOn") return "addon";
    return type;
  }

  private getEmbedUrl(itemType?: string, relatedId?: string): string | undefined {
    if (!relatedId) return undefined;

    const baseUrl = "https://lessons.church";
    switch (itemType) {
      case "action": return `${baseUrl}/embed/action/${relatedId}`;
      case "addon": return `${baseUrl}/embed/addon/${relatedId}`;
      case "section": return `${baseUrl}/embed/section/${relatedId}`;
      default: return undefined;
    }
  }

  private convertVenueToPlan(venue: FeedVenueInterface): Plan {
    const sections: PlanSection[] = [];
    const allFiles: ContentFile[] = [];

    for (const section of venue.sections || []) {
      const presentations: PlanPresentation[] = [];

      for (const action of section.actions || []) {
        const actionType = (action.actionType?.toLowerCase() || "other") as "play" | "add-on" | "other";
        if (actionType !== "play" && actionType !== "add-on") continue;

        const files: ContentFile[] = [];

        for (const file of action.files || []) {
          if (!file.url) continue;

          const embedUrl = action.id ? `https://lessons.church/embed/action/${action.id}` : undefined;

          const contentFile: ContentFile = { type: "file", id: file.id || "", title: file.name || "", mediaType: detectMediaType(file.url, file.fileType), image: venue.lessonImage, url: file.url, embedUrl, providerData: { seconds: file.seconds, streamUrl: file.streamUrl } };

          files.push(contentFile);
          allFiles.push(contentFile);
        }

        if (files.length > 0) {
          presentations.push({ id: action.id || "", name: action.content || section.name || "Untitled", actionType, files });
        }
      }

      if (presentations.length > 0) {
        sections.push({ id: section.id || "", name: section.name || "Untitled Section", presentations });
      }
    }

    return { id: venue.id || "", name: venue.lessonName || venue.name || "Plan", description: venue.lessonDescription, image: venue.lessonImage, sections, allFiles };
  }
}
