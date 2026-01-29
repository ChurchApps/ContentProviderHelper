import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, Instructions, ProviderCapabilities, DeviceAuthorizationResponse, DeviceFlowPollResult } from '../../interfaces';
import { ContentProvider } from '../../ContentProvider';
import { B1Plan, B1PlanItem } from './types';
import * as auth from './auth';
import { fetchVenueFeed } from './api';
import { planToFolder, sectionToFolder, planItemToContentItem, planItemToPresentation, planItemToInstruction } from './converters';

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
    supportsDeviceFlow: true,
    deviceAuthEndpoint: '/device/authorize',
    endpoints: {
      plans: '/plans/presenter',
      planItems: (churchId: string, planId: string) => `/planItems/presenter/${churchId}/${planId}`,
      arrangementKey: (churchId: string, arrangementId: string) => `/arrangementKeys/presenter/${churchId}/${arrangementId}`,
      venueFeed: (venueId: string) => `/venues/public/feed/${venueId}`
    }
  };

  private appBase = 'https://admin.b1.church';

  // ============================================================
  // Provider Info
  // ============================================================

  override requiresAuth(): boolean {
    return true;
  }

  override getCapabilities(): ProviderCapabilities {
    return {
      browse: true,
      presentations: true,
      playlist: false,
      instructions: true,
      expandedInstructions: false,
      mediaLicensing: false
    };
  }

  // ============================================================
  // Authentication
  // ============================================================

  override async buildAuthUrl(_codeVerifier: string, redirectUri: string, state?: string): Promise<{ url: string; challengeMethod: string }> {
    return auth.buildB1AuthUrl(this.config, this.appBase, redirectUri, state);
  }

  async exchangeCodeForTokensWithSecret(code: string, redirectUri: string, clientSecret: string): Promise<ContentProviderAuthData | null> {
    return auth.exchangeCodeForTokensWithSecret(this.config, code, redirectUri, clientSecret);
  }

  async refreshTokenWithSecret(authData: ContentProviderAuthData, clientSecret: string): Promise<ContentProviderAuthData | null> {
    return auth.refreshTokenWithSecret(this.config, authData, clientSecret);
  }

  override async initiateDeviceFlow(): Promise<DeviceAuthorizationResponse | null> {
    return auth.initiateDeviceFlow(this.config);
  }

  override async pollDeviceFlowToken(deviceCode: string): Promise<DeviceFlowPollResult> {
    return auth.pollDeviceFlowToken(this.config, deviceCode);
  }

  // ============================================================
  // Content Browsing
  // ============================================================

  async browse(folder?: ContentFolder | null, authData?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!folder) {
      const plans = await this.apiRequest<B1Plan[]>(this.config.endpoints.plans as string, authData);
      if (!plans || !Array.isArray(plans)) return [];
      return plans.map(planToFolder);
    }

    const level = folder.providerData?.level;
    if (level !== 'plan') return [];

    const planId = folder.providerData?.planId as string;
    const churchId = folder.providerData?.churchId as string;
    if (!planId || !churchId) return [];

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);
    if (!planItems || !Array.isArray(planItems)) return [];

    const items: ContentItem[] = [];
    const venueId = folder.providerData?.contentId as string | undefined;

    for (const section of planItems) {
      items.push(sectionToFolder(section));
      for (const child of section.children || []) {
        const item = planItemToContentItem(child, venueId);
        if (item) items.push(item);
      }
    }

    return items;
  }

  // ============================================================
  // Presentations
  // ============================================================

  async getPresentations(folder: ContentFolder, authData?: ContentProviderAuthData | null): Promise<Plan | null> {
    const level = folder.providerData?.level;
    if (level !== 'plan') return null;

    const planId = folder.providerData?.planId as string;
    const churchId = folder.providerData?.churchId as string;
    const venueId = folder.providerData?.contentId as string | undefined;
    if (!planId || !churchId) return null;

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);
    if (!planItems || !Array.isArray(planItems)) return null;

    const venueFeed = venueId ? await fetchVenueFeed(venueId) : null;

    const sections: PlanSection[] = [];
    const allFiles: ContentFile[] = [];

    for (const sectionItem of planItems) {
      const presentations: PlanPresentation[] = [];

      for (const child of sectionItem.children || []) {
        const presentation = await planItemToPresentation(child, venueFeed);
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

    return { id: planId, name: folder.title, sections, allFiles };
  }

  // ============================================================
  // Instructions
  // ============================================================

  async getInstructions(folder: ContentFolder, authData?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const level = folder.providerData?.level;
    if (level !== 'plan') return null;

    const planId = folder.providerData?.planId as string;
    const churchId = folder.providerData?.churchId as string;
    if (!planId || !churchId) return null;

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);
    if (!planItems || !Array.isArray(planItems)) return null;

    return {
      venueName: folder.title,
      items: planItems.map(planItemToInstruction)
    };
  }
}
