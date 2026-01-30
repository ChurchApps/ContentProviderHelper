import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, Instructions, ProviderCapabilities, DeviceAuthorizationResponse, DeviceFlowPollResult, IProvider, AuthType } from '../../interfaces';
import { ApiHelper } from '../../helpers';
import { B1PlanItem } from './types';
import * as auth from './auth';
import { fetchMinistries, fetchPlanTypes, fetchPlans, fetchVenueFeed, API_BASE } from './api';
import { ministryToFolder, planTypeToFolder, planToFolder, planItemToPresentation, planItemToInstruction, getFilesFromVenueFeed } from './converters';

export class B1ChurchProvider implements IProvider {
  private readonly apiHelper = new ApiHelper();

  private async apiRequest<T>(path: string, authData?: ContentProviderAuthData | null): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, authData);
  }
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
    clientId: '',
    scopes: ['plans'],
    supportsDeviceFlow: true,
    deviceAuthEndpoint: '/device/authorize',
    endpoints: {
      planItems: (churchId: string, planId: string) => `/planItems/presenter/${churchId}/${planId}`
    }
  };

  private appBase = 'https://admin.b1.church';

  readonly requiresAuth = true;
  readonly authTypes: AuthType[] = ['oauth_pkce', 'device_flow'];
  readonly capabilities: ProviderCapabilities = {
    browse: true,
    presentations: true,
    playlist: true,
    instructions: true,
    expandedInstructions: true,
    mediaLicensing: false
  };

  async buildAuthUrl(_codeVerifier: string, redirectUri: string, state?: string): Promise<{ url: string; challengeMethod: string }> {
    return auth.buildB1AuthUrl(this.config, this.appBase, redirectUri, state);
  }

  async exchangeCodeForTokensWithSecret(code: string, redirectUri: string, clientSecret: string): Promise<ContentProviderAuthData | null> {
    return auth.exchangeCodeForTokensWithSecret(this.config, code, redirectUri, clientSecret);
  }

  async refreshTokenWithSecret(authData: ContentProviderAuthData, clientSecret: string): Promise<ContentProviderAuthData | null> {
    return auth.refreshTokenWithSecret(this.config, authData, clientSecret);
  }

  async initiateDeviceFlow(): Promise<DeviceAuthorizationResponse | null> {
    return auth.initiateDeviceFlow(this.config);
  }

  async pollDeviceFlowToken(deviceCode: string): Promise<DeviceFlowPollResult> {
    return auth.pollDeviceFlowToken(this.config, deviceCode);
  }

  async browse(folder?: ContentFolder | null, authData?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!folder) {
      const ministries = await fetchMinistries(authData);
      return ministries.map(ministryToFolder);
    }

    const level = folder.providerData?.level;

    if (level === 'ministry') {
      const ministryId = folder.providerData?.ministryId as string;
      if (!ministryId) return [];
      const planTypes = await fetchPlanTypes(ministryId, authData);
      return planTypes.map(pt => planTypeToFolder(pt, ministryId));
    }

    if (level === 'planType') {
      const planTypeId = folder.providerData?.planTypeId as string;
      if (!planTypeId) return [];
      const plans = await fetchPlans(planTypeId, authData);
      return plans.map(planToFolder);
    }

    return [];
  }

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

  async getPlaylist(folder: ContentFolder, authData?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
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
        if ((itemType === 'lessonSection' || itemType === 'section' ||
             itemType === 'lessonAction' || itemType === 'action' ||
             itemType === 'lessonAddOn' || itemType === 'addon') && venueFeed) {
          const itemFiles = getFilesFromVenueFeed(venueFeed, itemType, child.relatedId);
          files.push(...itemFiles);
        }
      }
    }

    return files;
  }
}
