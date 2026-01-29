import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, Instructions, ProviderCapabilities, DeviceAuthorizationResponse, DeviceFlowPollResult } from '../../interfaces';
import { ContentProvider } from '../../ContentProvider';
import { B1PlanItem } from './types';
import * as auth from './auth';
import { fetchMinistries, fetchPlanTypes, fetchPlans, fetchVenueFeed, API_BASE } from './api';
import { ministryToFolder, planTypeToFolder, planToFolder, planItemToPresentation, planItemToInstruction, getFilesFromVenueFeed } from './converters';

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
    apiBase: `${API_BASE}/doing`,
    oauthBase: `${API_BASE}/membership/oauth`,
    clientId: '', // Consumer must provide client_id
    scopes: ['plans'],
    supportsDeviceFlow: true,
    deviceAuthEndpoint: '/device/authorize',
    endpoints: {
      planItems: (churchId: string, planId: string) => `/planItems/presenter/${churchId}/${planId}`
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
      playlist: true,
      instructions: true,
      expandedInstructions: true,
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

  /**
   * Browse content hierarchy:
   * - Root: List of ministries (groups with "ministry" tag)
   * - Ministry: List of plan types
   * - PlanType: List of plans (leaf nodes)
   *
   * Plans are leaf nodes - use getPresentations(), getPlaylist(), getInstructions()
   * to get plan content.
   */
  async browse(folder?: ContentFolder | null, authData?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!folder) {
      // Root level: show ministries
      const ministries = await fetchMinistries(authData);
      return ministries.map(ministryToFolder);
    }

    const level = folder.providerData?.level;

    if (level === 'ministry') {
      // Ministry level: show plan types
      const ministryId = folder.providerData?.ministryId as string;
      if (!ministryId) return [];
      const planTypes = await fetchPlanTypes(ministryId, authData);
      return planTypes.map(pt => planTypeToFolder(pt, ministryId));
    }

    if (level === 'planType') {
      // Plan type level: show plans (leaf nodes)
      const planTypeId = folder.providerData?.planTypeId as string;
      if (!planTypeId) return [];
      const plans = await fetchPlans(planTypeId, authData);
      return plans.map(planToFolder);
    }

    // Plans are leaf nodes - no further browsing
    return [];
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

  // ============================================================
  // Playlist
  // ============================================================

  async getPlaylist(folder: ContentFolder, authData?: ContentProviderAuthData | null): Promise<ContentFile[]> {
    const level = folder.providerData?.level;
    if (level !== 'plan') return [];

    const planId = folder.providerData?.planId as string;
    const churchId = folder.providerData?.churchId as string;
    const venueId = folder.providerData?.contentId as string | undefined;
    if (!planId || !churchId) return [];

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);
    if (!planItems || !Array.isArray(planItems)) return [];

    const venueFeed = venueId ? await fetchVenueFeed(venueId) : null;
    const files: ContentFile[] = [];

    for (const sectionItem of planItems) {
      for (const child of sectionItem.children || []) {
        const itemType = child.itemType;
        if ((itemType === 'lessonSection' || itemType === 'lessonAction' || itemType === 'lessonAddOn') && venueFeed) {
          const itemFiles = getFilesFromVenueFeed(venueFeed, itemType, child.relatedId);
          files.push(...itemFiles);
        }
      }
    }

    return files;
  }
}
