import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, Instructions, InstructionItem, ProviderCapabilities, FeedVenueInterface } from '../interfaces';
import { ContentProvider } from '../ContentProvider';
import { detectMediaType } from '../utils';

interface B1Plan {
  id: string;
  churchId: string;
  name: string;
  serviceDate: string;
  contentType?: string;
  contentId?: string;
}

interface B1PlanItem {
  id: string;
  label?: string;
  description?: string;
  seconds?: number;
  itemType?: string;
  relatedId?: string;
  churchId?: string;
  children?: B1PlanItem[];
}

interface ArrangementKeyResponse {
  arrangementKey?: {
    id: string;
    keySignature?: string;
  };
  arrangement?: {
    id: string;
    name?: string;
    lyrics?: string;
  };
  song?: {
    id: string;
    dateAdded?: string;
    notes?: string;
  };
  songDetail?: {
    title?: string;
    artist?: string;
    seconds?: number;
    keySignature?: string;
  };
}

export class B1ChurchProvider extends ContentProvider {
  readonly id = 'b1church';
  readonly name = 'B1.Church';

  readonly logos: ProviderLogos = {
    light: 'https://b1.church/b1-church-logo.png',
    dark: 'https://b1.church/b1-church-logo.png'
  };

  readonly config: ContentProviderConfig = {
    id: 'b1church',
    name: 'B1.Church',
    apiBase: 'https://api.churchapps.org/doing',
    oauthBase: 'https://api.churchapps.org/membership/oauth',
    clientId: '', // Consumer must provide client_id
    scopes: ['plans'],
    endpoints: {
      plans: '/plans/presenter',
      planItems: (churchId: string, planId: string) => `/planItems/presenter/${churchId}/${planId}`,
      arrangementKey: (churchId: string, arrangementId: string) => `/arrangementKeys/presenter/${churchId}/${arrangementId}`,
      venueFeed: (venueId: string) => `/venues/public/feed/${venueId}`
    }
  };

  // B1.Church uses standard OAuth (not PKCE) - requires client_secret
  private appBase = 'https://admin.b1.church';

  /**
   * Build the authorization URL for B1.Church OAuth flow.
   * Note: B1.Church uses standard OAuth with client_secret, not PKCE.
   */
  override async buildAuthUrl(_codeVerifier: string, redirectUri: string): Promise<{ url: string; challengeMethod: string }> {
    const oauthParams = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' ')
    });
    const returnUrl = `/oauth?${oauthParams.toString()}`;
    const url = `${this.appBase}/login?returnUrl=${encodeURIComponent(returnUrl)}`;
    return { url, challengeMethod: 'none' };
  }

  /**
   * Exchange authorization code for tokens.
   * Note: B1.Church requires client_secret in the token request.
   */
  async exchangeCodeForTokensWithSecret(
    code: string,
    redirectUri: string,
    clientSecret: string
  ): Promise<ContentProviderAuthData | null> {
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.config.clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      });

      const response = await fetch(`${this.config.oauthBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) return null;

      const data = await response.json();
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || this.config.scopes.join(' ')
      };
    } catch {
      return null;
    }
  }

  /**
   * Refresh token with client_secret.
   */
  async refreshTokenWithSecret(
    auth: ContentProviderAuthData,
    clientSecret: string
  ): Promise<ContentProviderAuthData | null> {
    if (!auth.refresh_token) return null;

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        client_id: this.config.clientId,
        client_secret: clientSecret
      });

      const response = await fetch(`${this.config.oauthBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) return null;

      const data = await response.json();
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token || auth.refresh_token,
        token_type: data.token_type || 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: data.expires_in,
        scope: data.scope || auth.scope
      };
    } catch {
      return null;
    }
  }

  private lessonsApiBase = 'https://api.lessons.church';
  private contentApiBase = 'https://contentapi.churchapps.org';

  override requiresAuth(): boolean {
    return true;
  }

  override getCapabilities(): ProviderCapabilities {
    return {
      browse: true,
      presentations: true,
      playlist: false,
      instructions: true,
      expandedInstructions: false
    };
  }

  async browse(folder?: ContentFolder | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!folder) {
      const response = await this.apiRequest<B1Plan[]>(this.config.endpoints.plans as string, auth);
      if (!response || !Array.isArray(response)) return [];

      return response.map((plan) => ({
        type: 'folder' as const,
        id: plan.id,
        title: plan.name,
        providerData: {
          level: 'plan',
          planId: plan.id,
          churchId: plan.churchId,
          serviceDate: plan.serviceDate,
          contentType: plan.contentType,
          contentId: plan.contentId
        }
      }));
    }

    const level = folder.providerData?.level;
    if (level !== 'plan') return [];

    const planId = folder.providerData?.planId as string;
    const churchId = folder.providerData?.churchId as string;
    if (!planId || !churchId) return [];

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), auth);

    if (!planItems || !Array.isArray(planItems)) return [];

    const items: ContentItem[] = [];

    for (const section of planItems) {
      items.push({
        type: 'folder' as const,
        id: section.id,
        title: section.label || 'Section',
        providerData: {
          level: 'section',
          itemType: 'section',
          description: section.description,
          seconds: section.seconds
        }
      });

      for (const child of section.children || []) {
        const item = await this.convertPlanItemToContentItem(child, folder.providerData?.contentId as string | undefined, auth);
        if (item) items.push(item);
      }
    }

    return items;
  }

  private async convertPlanItemToContentItem(
    item: B1PlanItem,
    venueId: string | undefined,
    auth?: ContentProviderAuthData | null
  ): Promise<ContentItem | null> {
    const itemType = item.itemType;

    if (itemType === 'arrangementKey' && item.churchId && item.relatedId) {
      return {
        type: 'file' as const,
        id: item.id,
        title: item.label || 'Song',
        mediaType: 'image' as const,
        url: '',
        providerData: {
          itemType: 'arrangementKey',
          churchId: item.churchId,
          relatedId: item.relatedId,
          seconds: item.seconds
        }
      };
    }

    if ((itemType === 'lessonSection' || itemType === 'lessonAction' || itemType === 'lessonAddOn') && item.relatedId) {
      return {
        type: 'file' as const,
        id: item.id,
        title: item.label || 'Lesson Content',
        mediaType: 'video' as const,
        url: '',
        providerData: {
          itemType,
          relatedId: item.relatedId,
          venueId,
          seconds: item.seconds
        }
      };
    }

    if (itemType === 'item' || itemType === 'header') {
      return {
        type: 'file' as const,
        id: item.id,
        title: item.label || '',
        mediaType: 'image' as const,
        url: '',
        providerData: {
          itemType,
          description: item.description,
          seconds: item.seconds
        }
      };
    }

    return null;
  }

  async getPresentations(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const level = folder.providerData?.level;
    if (level !== 'plan') return null;

    const planId = folder.providerData?.planId as string;
    const churchId = folder.providerData?.churchId as string;
    const venueId = folder.providerData?.contentId as string | undefined;

    if (!planId || !churchId) return null;

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), auth);

    if (!planItems || !Array.isArray(planItems)) return null;

    let venueFeed: FeedVenueInterface | null = null;
    if (venueId) {
      venueFeed = await this.fetchVenueFeed(venueId);
    }

    const sections: PlanSection[] = [];
    const allFiles: ContentFile[] = [];

    for (const sectionItem of planItems) {
      const presentations: PlanPresentation[] = [];

      for (const child of sectionItem.children || []) {
        const presentation = await this.convertToPresentation(child, venueFeed, auth);
        if (presentation) {
          presentations.push(presentation);
          allFiles.push(...presentation.files);
        }
      }

      if (presentations.length > 0 || sectionItem.label) {
        sections.push({
          id: sectionItem.id,
          name: sectionItem.label || 'Section',
          presentations
        });
      }
    }

    return {
      id: planId,
      name: folder.title,
      sections,
      allFiles
    };
  }

  private async convertToPresentation(
    item: B1PlanItem,
    venueFeed: FeedVenueInterface | null,
    auth?: ContentProviderAuthData | null
  ): Promise<PlanPresentation | null> {
    const itemType = item.itemType;

    if (itemType === 'arrangementKey' && item.churchId && item.relatedId) {
      const songData = await this.fetchArrangementKey(item.churchId, item.relatedId);
      if (songData) {
        const title = songData.songDetail?.title || item.label || 'Song';
        return {
          id: item.id,
          name: title,
          actionType: 'other',
          files: [],
          providerData: {
            itemType: 'song',
            title,
            artist: songData.songDetail?.artist,
            lyrics: songData.arrangement?.lyrics,
            keySignature: songData.arrangementKey?.keySignature,
            arrangementName: songData.arrangement?.name,
            seconds: songData.songDetail?.seconds || item.seconds
          }
        } as PlanPresentation;
      }
    }

    if ((itemType === 'lessonSection' || itemType === 'lessonAction' || itemType === 'lessonAddOn') && venueFeed) {
      const files = this.getFilesFromVenueFeed(venueFeed, itemType, item.relatedId);
      if (files.length > 0) {
        return {
          id: item.id,
          name: item.label || 'Lesson Content',
          actionType: itemType === 'lessonAddOn' ? 'add-on' : 'play',
          files
        };
      }
    }

    if (itemType === 'item' || itemType === 'header') {
      return {
        id: item.id,
        name: item.label || '',
        actionType: 'other',
        files: [],
        providerData: {
          itemType,
          description: item.description,
          seconds: item.seconds
        }
      } as PlanPresentation;
    }

    return null;
  }

  private getFilesFromVenueFeed(
    venueFeed: FeedVenueInterface,
    itemType: string,
    relatedId?: string
  ): ContentFile[] {
    const files: ContentFile[] = [];

    if (!relatedId) return files;

    if (itemType === 'lessonSection') {
      for (const section of venueFeed.sections || []) {
        if (section.id === relatedId) {
          for (const action of section.actions || []) {
            const actionType = action.actionType?.toLowerCase();
            if (actionType === 'play' || actionType === 'add-on') {
              files.push(...this.convertFeedFiles(action.files || [], venueFeed.lessonImage));
            }
          }
          break;
        }
      }
    } else if (itemType === 'lessonAction') {
      for (const section of venueFeed.sections || []) {
        for (const action of section.actions || []) {
          if (action.id === relatedId) {
            files.push(...this.convertFeedFiles(action.files || [], venueFeed.lessonImage));
            break;
          }
        }
      }
    }

    return files;
  }

  private convertFeedFiles(feedFiles: Array<{ id?: string; name?: string; url?: string; streamUrl?: string; seconds?: number; fileType?: string }>, thumbnail?: string): ContentFile[] {
    return feedFiles
      .filter(f => f.url)
      .map(f => ({
        type: 'file' as const,
        id: f.id || '',
        title: f.name || '',
        mediaType: detectMediaType(f.url || '', f.fileType),
        thumbnail,
        url: f.url || '',
        providerData: { seconds: f.seconds, streamUrl: f.streamUrl }
      }));
  }

  private async fetchVenueFeed(venueId: string): Promise<FeedVenueInterface | null> {
    try {
      const url = `${this.lessonsApiBase}/venues/public/feed/${venueId}`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  private async fetchArrangementKey(churchId: string, arrangementId: string): Promise<ArrangementKeyResponse | null> {
    try {
      const url = `${this.contentApiBase}/arrangementKeys/presenter/${churchId}/${arrangementId}`;
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async getInstructions(folder: ContentFolder, auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const level = folder.providerData?.level;
    if (level !== 'plan') return null;

    const planId = folder.providerData?.planId as string;
    const churchId = folder.providerData?.churchId as string;
    if (!planId || !churchId) return null;

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), auth);

    if (!planItems || !Array.isArray(planItems)) return null;

    const processItem = (item: B1PlanItem): InstructionItem => ({
      id: item.id,
      itemType: item.itemType,
      relatedId: item.relatedId,
      label: item.label,
      description: item.description,
      seconds: item.seconds,
      children: item.children?.map(processItem)
    });

    return {
      venueName: folder.title,
      items: planItems.map(processItem)
    };
  }

}
