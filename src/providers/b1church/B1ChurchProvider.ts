import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, Instructions, ProviderCapabilities, DeviceAuthorizationResponse, DeviceFlowPollResult, IProvider, AuthType } from "../../interfaces";
import { parsePath } from "../../pathUtils";
import { ApiHelper } from "../../helpers";
import { B1PlanItem } from "./types";
import * as auth from "./auth";
import { fetchMinistries, fetchPlanTypes, fetchPlans, fetchVenueFeed, API_BASE } from "./api";
import { ministryToFolder, planTypeToFolder, planToFolder, planItemToPresentation, planItemToInstruction, getFilesFromVenueFeed } from "./converters";

export class B1ChurchProvider implements IProvider {
  private readonly apiHelper = new ApiHelper();

  private async apiRequest<T>(path: string, authData?: ContentProviderAuthData | null): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, authData);
  }
  readonly id = "b1church";
  readonly name = "B1.Church";

  readonly logos: ProviderLogos = { light: "https://b1.church/b1-church-logo.png", dark: "https://b1.church/b1-church-logo.png" };

  readonly config: ContentProviderConfig = { id: "b1church", name: "B1.Church", apiBase: `${API_BASE}/doing`, oauthBase: `${API_BASE}/membership/oauth`, clientId: "nsowldn58dk", scopes: ["plans"], supportsDeviceFlow: true, deviceAuthEndpoint: "/device/authorize", endpoints: { planItems: (churchId: string, planId: string) => `/planItems/presenter/${churchId}/${planId}` } };

  private appBase = "https://admin.b1.church";

  readonly requiresAuth = true;
  readonly authTypes: AuthType[] = ["oauth_pkce", "device_flow"];
  readonly capabilities: ProviderCapabilities = { browse: true, presentations: true, playlist: true, instructions: true, expandedInstructions: true, mediaLicensing: false };

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

  async browse(path?: string | null, authData?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);

    if (depth === 0) {
      return [{
        type: "folder" as const,
        id: "ministries-root",
        title: "Ministries",
        path: "/ministries"
      }];
    }

    const root = segments[0];
    if (root !== "ministries") return [];

    // /ministries -> list all ministries
    if (depth === 1) {
      const ministries = await fetchMinistries(authData);
      return ministries.map(m => {
        const folder = ministryToFolder(m);
        const ministryId = (folder.providerData as Record<string, unknown>)?.ministryId || folder.id;
        return { ...folder, path: `/ministries/${ministryId}` };
      });
    }

    // /ministries/{ministryId} -> list plan types
    if (depth === 2) {
      const ministryId = segments[1];
      const planTypes = await fetchPlanTypes(ministryId, authData);
      return planTypes.map(pt => {
        const folder = planTypeToFolder(pt, ministryId);
        const planTypeId = (folder.providerData as Record<string, unknown>)?.planTypeId || folder.id;
        return { ...folder, path: `/ministries/${ministryId}/${planTypeId}` };
      });
    }

    // /ministries/{ministryId}/{planTypeId} -> list plans
    if (depth === 3) {
      const ministryId = segments[1];
      const planTypeId = segments[2];
      const plans = await fetchPlans(planTypeId, authData);
      return plans.map(p => {
        const folder = planToFolder(p);
        const planId = (folder.providerData as Record<string, unknown>)?.planId || folder.id;
        return {
          ...folder,
          isLeaf: true,
          path: `/ministries/${ministryId}/${planTypeId}/${planId}`
        };
      });
    }

    return [];
  }

  async getPresentations(path: string, authData?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 4 || segments[0] !== "ministries") return null;

    const planId = segments[3];
    const planTypeId = segments[2];

    // Need to fetch plan details to get churchId and contentId
    const plans = await fetchPlans(planTypeId, authData);
    const planFolder = plans.find(p => {
      const folder = planToFolder(p);
      return (folder.providerData as Record<string, unknown>)?.planId === planId || folder.id === planId;
    });
    if (!planFolder) return null;

    const folder = planToFolder(planFolder);
    const providerData = folder.providerData as Record<string, unknown>;
    const churchId = providerData?.churchId as string;
    const venueId = providerData?.contentId as string | undefined;
    const planTitle = folder.title || "Plan";

    if (!churchId) return null;

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
        sections.push({ id: sectionItem.id, name: sectionItem.label || "Section", presentations });
      }
    }

    return { id: planId, name: planTitle, sections, allFiles };
  }

  async getInstructions(path: string, authData?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 4 || segments[0] !== "ministries") return null;

    const planId = segments[3];
    const planTypeId = segments[2];

    // Need to fetch plan details to get churchId
    const plans = await fetchPlans(planTypeId, authData);
    const planFolder = plans.find(p => {
      const folder = planToFolder(p);
      return (folder.providerData as Record<string, unknown>)?.planId === planId || folder.id === planId;
    });
    if (!planFolder) return null;

    const folder = planToFolder(planFolder);
    const providerData = folder.providerData as Record<string, unknown>;
    const churchId = providerData?.churchId as string;
    const planTitle = folder.title || "Plan";

    if (!churchId) return null;

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);
    if (!planItems || !Array.isArray(planItems)) return null;

    return { venueName: planTitle, items: planItems.map(planItemToInstruction) };
  }

  async getPlaylist(path: string, authData?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 4 || segments[0] !== "ministries") return [];

    const planId = segments[3];
    const planTypeId = segments[2];

    // Need to fetch plan details to get churchId and contentId
    const plans = await fetchPlans(planTypeId, authData);
    const planFolder = plans.find(p => {
      const folder = planToFolder(p);
      return (folder.providerData as Record<string, unknown>)?.planId === planId || folder.id === planId;
    });
    if (!planFolder) return [];

    const folder = planToFolder(planFolder);
    const providerData = folder.providerData as Record<string, unknown>;
    const churchId = providerData?.churchId as string;
    const venueId = providerData?.contentId as string | undefined;

    if (!churchId) return [];

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);
    if (!planItems || !Array.isArray(planItems)) return [];

    const venueFeed = venueId ? await fetchVenueFeed(venueId) : null;
    const files: ContentFile[] = [];

    for (const sectionItem of planItems) {
      for (const child of sectionItem.children || []) {
        const itemType = child.itemType;
        if ((itemType === "lessonSection" || itemType === "section" ||
             itemType === "lessonAction" || itemType === "action" ||
             itemType === "lessonAddOn" || itemType === "addon") && venueFeed) {
          const itemFiles = getFilesFromVenueFeed(venueFeed, itemType, child.relatedId);
          files.push(...itemFiles);
        }
      }
    }

    return files;
  }
}
