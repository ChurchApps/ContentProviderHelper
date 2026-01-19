import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, Instructions, ProviderCapabilities } from '../interfaces';
import { ContentProvider } from '../ContentProvider';

interface PCOServiceType {
  id: string;
  type: string;
  attributes: {
    name: string;
  };
}

interface PCOPlan {
  id: string;
  type: string;
  attributes: {
    title?: string;
    sort_date: string;
    created_at: string;
    items_count: number;
  };
}

interface PCOPlanItem {
  id: string;
  type: string;
  attributes: {
    item_type: string;
    title?: string;
    description?: string;
    length?: number;
  };
  relationships?: {
    song?: { data?: { id: string } };
    arrangement?: { data?: { id: string } };
  };
}

interface PCOSong {
  id: string;
  attributes: {
    title?: string;
    author?: string;
    copyright?: string;
    ccli_number?: string;
  };
}

interface PCOArrangement {
  id: string;
  attributes: {
    name?: string;
    chord_chart_key?: string;
    bpm?: number;
    sequence?: string[];
  };
}

interface PCOSection {
  label: string;
  lyrics: string;
}

interface PCOAttachment {
  id: string;
  attributes: {
    filename: string;
    content_type?: string;
    url?: string;
  };
}

export class PlanningCenterProvider extends ContentProvider {
  readonly id = 'planningcenter';
  readonly name = 'Planning Center';

  readonly logos: ProviderLogos = {
    light: 'https://cdn.brandfetch.io/idyVAJYz2b/w/400/h/400/theme/dark/icon.jpeg',
    dark: 'https://cdn.brandfetch.io/idyVAJYz2b/w/400/h/400/theme/dark/icon.jpeg'
  };

  // Planning Center uses OAuth 2.0 with PKCE (handled by base ContentProvider class)
  readonly config: ContentProviderConfig = {
    id: 'planningcenter',
    name: 'Planning Center',
    apiBase: 'https://api.planningcenteronline.com',
    oauthBase: 'https://api.planningcenteronline.com/oauth',
    clientId: '', // Consumer must provide client_id
    scopes: ['services'],
    endpoints: {
      serviceTypes: '/services/v2/service_types',
      plans: (serviceTypeId: string) => `/services/v2/service_types/${serviceTypeId}/plans`,
      planItems: (serviceTypeId: string, planId: string) => `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items`,
      song: (itemId: string) => `/services/v2/songs/${itemId}`,
      arrangement: (songId: string, arrangementId: string) => `/services/v2/songs/${songId}/arrangements/${arrangementId}`,
      arrangementSections: (songId: string, arrangementId: string) => `/services/v2/songs/${songId}/arrangements/${arrangementId}/sections`,
      media: (mediaId: string) => `/services/v2/media/${mediaId}`,
      mediaAttachments: (mediaId: string) => `/services/v2/media/${mediaId}/attachments`
    }
  };

  private readonly ONE_WEEK_MS = 604800000;

  override requiresAuth(): boolean {
    return true;
  }

  override getCapabilities(): ProviderCapabilities {
    return {
      browse: true,
      presentations: true,
      instructions: false,
      expandedInstructions: false
    };
  }

  async getRootContents(auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const response = await this.apiRequest<{ data: PCOServiceType[] }>(
      this.config.endpoints.serviceTypes as string,
      auth
    );

    if (!response?.data) return [];

    return response.data.map((serviceType) => ({
      type: 'folder' as const,
      id: serviceType.id,
      title: serviceType.attributes.name,
      providerData: {
        level: 'serviceType',
        serviceTypeId: serviceType.id
      }
    }));
  }

  async getFolderContents(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const level = folder.providerData?.level;

    switch (level) {
      case 'serviceType':
        return this.getPlans(folder, auth);
      case 'plan':
        return this.getPlanItems(folder, auth);
      default:
        return [];
    }
  }

  private async getPlans(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const serviceTypeId = folder.providerData?.serviceTypeId as string;
    if (!serviceTypeId) return [];

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
      type: 'folder' as const,
      id: plan.id,
      title: plan.attributes.title || this.formatDate(plan.attributes.sort_date),
      providerData: {
        level: 'plan',
        serviceTypeId,
        planId: plan.id,
        sortDate: plan.attributes.sort_date
      }
    }));
  }

  private async getPlanItems(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const serviceTypeId = folder.providerData?.serviceTypeId as string;
    const planId = folder.providerData?.planId as string;
    if (!serviceTypeId || !planId) return [];

    const pathFn = this.config.endpoints.planItems as (stId: string, pId: string) => string;
    const response = await this.apiRequest<{ data: PCOPlanItem[] }>(
      `${pathFn(serviceTypeId, planId)}?per_page=100`,
      auth
    );

    if (!response?.data) return [];

    return response.data.map((item) => ({
      type: 'file' as const,
      id: item.id,
      title: item.attributes.title || '',
      mediaType: 'image' as const,
      url: '',
      providerData: {
        itemType: item.attributes.item_type,
        description: item.attributes.description,
        length: item.attributes.length,
        songId: item.relationships?.song?.data?.id,
        arrangementId: item.relationships?.arrangement?.data?.id
      }
    }));
  }

  async getPresentations(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const level = folder.providerData?.level;
    if (level !== 'plan') return null;

    const serviceTypeId = folder.providerData?.serviceTypeId as string;
    const planId = folder.providerData?.planId as string;
    if (!serviceTypeId || !planId) return null;

    const pathFn = this.config.endpoints.planItems as (stId: string, pId: string) => string;
    const response = await this.apiRequest<{ data: PCOPlanItem[] }>(
      `${pathFn(serviceTypeId, planId)}?per_page=100`,
      auth
    );

    if (!response?.data) return null;

    const sections: PlanSection[] = [];
    const allFiles: ContentFile[] = [];
    let currentSection: PlanSection | null = null;

    for (const item of response.data) {
      const itemType = item.attributes.item_type;

      if (itemType === 'header') {
        if (currentSection && currentSection.presentations.length > 0) {
          sections.push(currentSection);
        }
        currentSection = {
          id: item.id,
          name: item.attributes.title || 'Section',
          presentations: []
        };
        continue;
      }

      if (!currentSection) {
        currentSection = {
          id: `default-${planId}`,
          name: 'Service',
          presentations: []
        };
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

    return {
      id: planId,
      name: folder.title,
      sections,
      allFiles
    };
  }

  private async convertToPresentation(
    item: PCOPlanItem,
    auth?: ContentProviderAuthData | null
  ): Promise<PlanPresentation | null> {
    const itemType = item.attributes.item_type;

    if (itemType === 'song') {
      return this.convertSongToPresentation(item, auth);
    }

    if (itemType === 'media') {
      return this.convertMediaToPresentation(item, auth);
    }

    if (itemType === 'item') {
      return {
        id: item.id,
        name: item.attributes.title || '',
        actionType: 'other',
        files: [],
        providerData: {
          itemType: 'item',
          description: item.attributes.description,
          length: item.attributes.length
        }
      } as PlanPresentation;
    }

    return null;
  }

  private async convertSongToPresentation(
    item: PCOPlanItem,
    auth?: ContentProviderAuthData | null
  ): Promise<PlanPresentation | null> {
    const songId = item.relationships?.song?.data?.id;
    const arrangementId = item.relationships?.arrangement?.data?.id;

    if (!songId) {
      return {
        id: item.id,
        name: item.attributes.title || 'Song',
        actionType: 'other',
        files: [],
        providerData: { itemType: 'song' }
      } as PlanPresentation;
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
    const title = song?.attributes?.title || item.attributes.title || 'Song';

    return {
      id: item.id,
      name: title,
      actionType: 'other',
      files: [],
      providerData: {
        itemType: 'song',
        title,
        author: song?.attributes?.author,
        copyright: song?.attributes?.copyright,
        ccliNumber: song?.attributes?.ccli_number,
        arrangementName: arrangement?.attributes?.name,
        keySignature: arrangement?.attributes?.chord_chart_key,
        bpm: arrangement?.attributes?.bpm,
        sequence: arrangement?.attributes?.sequence,
        sections: sections.map(s => ({ label: s.label, lyrics: s.lyrics })),
        length: item.attributes.length
      }
    } as PlanPresentation;
  }

  private async convertMediaToPresentation(
    item: PCOPlanItem,
    auth?: ContentProviderAuthData | null
  ): Promise<PlanPresentation | null> {
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

        const isVideo = attachment.attributes.content_type?.startsWith('video/') ||
          url.includes('.mp4') ||
          url.includes('.mov') ||
          url.includes('.webm');

        files.push({
          type: 'file',
          id: attachment.id,
          title: attachment.attributes.filename,
          mediaType: isVideo ? 'video' : 'image',
          url
        });
      }
    }

    return {
      id: item.id,
      name: item.attributes.title || 'Media',
      actionType: 'play',
      files,
      providerData: {
        itemType: 'media',
        length: item.attributes.length
      }
    } as PlanPresentation;
  }

  async getInstructions(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    return null;
  }

  async getExpandedInstructions(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    return null;
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toISOString().slice(0, 10);
  }
}
