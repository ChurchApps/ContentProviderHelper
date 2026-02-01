import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, Instructions, ProviderCapabilities, DeviceAuthorizationResponse, DeviceFlowPollResult, IProvider, AuthType, InstructionItem } from "../../interfaces";
import { parsePath } from "../../pathUtils";
import { navigateToPath } from "../../instructionPathUtils";
import { ApiHelper } from "../../helpers";
import { B1PlanItem } from "./types";
import * as auth from "./auth";
import { fetchMinistries, fetchPlanTypes, fetchPlans, fetchVenueFeed, fetchFromProviderProxy, API_BASE } from "./api";
import { ministryToFolder, planTypeToFolder, planToFolder, planItemToPresentation, planItemToInstruction, getFilesFromVenueFeed } from "./converters";

function isExternalProviderItem(item: B1PlanItem): boolean {
  // An item is external if it has a non-b1church providerId and a providerPath
  if (!item.providerId || item.providerId === "b1church") return false;
  // If providerPath is set, it needs proxy expansion regardless of itemType
  if (item.providerPath) return true;
  // Otherwise check for provider-prefixed itemType (legacy support)
  const itemType = item.itemType || "";
  return itemType.startsWith("provider");
}

export class B1ChurchProvider implements IProvider {
  private readonly apiHelper = new ApiHelper();

  private async apiRequest<T>(path: string, authData?: ContentProviderAuthData | null): Promise<T | null> {
    return this.apiHelper.apiRequest<T>(this.config, this.id, path, authData);
  }
  readonly id = "b1church";
  readonly name = "B1.Church";

  readonly logos: ProviderLogos = { light: "https://b1.church/b1-church-logo.png", dark: "https://b1.church/b1-church-logo.png" };

  readonly config: ContentProviderConfig = { id: "b1church", name: "B1.Church", apiBase: `${API_BASE}/doing`, oauthBase: `${API_BASE}/membership/oauth`, clientId: "nsowldn58dk", scopes: ["plans"], supportsDeviceFlow: true, deviceAuthEndpoint: "/device/authorize", endpoints: { planItems: (churchId: string, planId: string) => `/planFeed/presenter/${churchId}/${planId}` } };

  private appBase = "http://localhost:3101"; // TODO: revert to https://admin.b1.church

  readonly requiresAuth = true;
  readonly authTypes: AuthType[] = ["oauth_pkce", "device_flow"];
  readonly capabilities: ProviderCapabilities = { browse: true, presentations: true, playlist: true, instructions: true, mediaLicensing: false };

  async buildAuthUrl(codeVerifier: string, redirectUri: string, state?: string): Promise<{ url: string; challengeMethod: string }> {
    return auth.buildB1AuthUrl(this.config, this.appBase, redirectUri, codeVerifier, state);
  }

  async exchangeCodeForTokensWithPKCE(code: string, redirectUri: string, codeVerifier: string): Promise<ContentProviderAuthData | null> {
    return auth.exchangeCodeForTokensWithPKCE(this.config, code, redirectUri, codeVerifier);
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
        return { ...folder, path: `/ministries/${m.id}` };
      });
    }

    // /ministries/{ministryId} -> list plan types
    if (depth === 2) {
      const ministryId = segments[1];
      const planTypes = await fetchPlanTypes(ministryId, authData);
      return planTypes.map(pt => {
        const folder = planTypeToFolder(pt);
        return { ...folder, path: `/ministries/${ministryId}/${pt.id}` };
      });
    }

    // /ministries/{ministryId}/{planTypeId} -> list plans
    if (depth === 3) {
      const ministryId = segments[1];
      const planTypeId = segments[2];
      const plans = await fetchPlans(planTypeId, authData);
      return plans.map(p => {
        const folder = planToFolder(p);
        return {
          ...folder,
          isLeaf: true,
          path: `/ministries/${ministryId}/${planTypeId}/${p.id}`
        };
      });
    }

    return [];
  }

  async getPresentations(path: string, authData?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 4 || segments[0] !== "ministries") return null;

    const ministryId = segments[1];
    const planId = segments[3];
    const planTypeId = segments[2];

    // Need to fetch plan details to get churchId and contentId
    const plans = await fetchPlans(planTypeId, authData);
    const planFolder = plans.find(p => p.id === planId);
    if (!planFolder) return null;

    const churchId = planFolder.churchId;
    const venueId = planFolder.contentId;
    const planTitle = planFolder.name || "Plan";

    if (!churchId) return null;

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);

    // If no planItems but plan has associated provider content, fetch from that provider
    if ((!planItems || planItems.length === 0) && planFolder.providerId && planFolder.providerPlanId) {
      const externalPlan = await fetchFromProviderProxy(
        "getPresentations",
        ministryId,
        planFolder.providerId,
        planFolder.providerPlanId,
        authData
      );
      if (externalPlan) {
        return { id: planId, name: planTitle, sections: externalPlan.sections, allFiles: externalPlan.allFiles };
      }
    }

    if (!planItems || !Array.isArray(planItems)) return null;

    const venueFeed = venueId ? await fetchVenueFeed(venueId) : null;

    const sections: PlanSection[] = [];
    const allFiles: ContentFile[] = [];

    for (const sectionItem of planItems) {
      const presentations: PlanPresentation[] = [];

      for (const child of sectionItem.children || []) {
        // Handle external provider items via proxy
        if (isExternalProviderItem(child) && child.providerId && child.providerPath) {
          const externalPlan = await fetchFromProviderProxy(
            "getPresentations",
            ministryId,
            child.providerId,
            child.providerPath,
            authData
          );
          if (externalPlan) {
            if (child.providerContentPath) {
              // Fetch instructions to enable path-based lookup
              const externalInstructions = await fetchFromProviderProxy(
                "getInstructions",
                ministryId,
                child.providerId,
                child.providerPath,
                authData
              );
              // Find and use only the specific presentation
              const matchingPresentation = this.findPresentationByPath(externalPlan, externalInstructions, child.providerContentPath);
              if (matchingPresentation) {
                presentations.push(matchingPresentation);
                allFiles.push(...matchingPresentation.files);
              }
            } else {
              // Add all presentations from the external plan
              for (const section of externalPlan.sections) {
                presentations.push(...section.presentations);
              }
              allFiles.push(...externalPlan.allFiles);
            }
          }
        } else {
          // Handle internal items as before
          const presentation = await planItemToPresentation(child, venueFeed);
          if (presentation) {
            presentations.push(presentation);
            allFiles.push(...presentation.files);
          }
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

    const ministryId = segments[1];
    const planId = segments[3];
    const planTypeId = segments[2];

    // Need to fetch plan details to get churchId
    const plans = await fetchPlans(planTypeId, authData);
    const planFolder = plans.find(p => p.id === planId);
    if (!planFolder) return null;

    const churchId = planFolder.churchId;
    const planTitle = planFolder.name || "Plan";

    if (!churchId) return null;

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);

    // If no planItems but plan has associated provider content, fetch from that provider
    if ((!planItems || planItems.length === 0) && planFolder.providerId && planFolder.providerPlanId) {
      const externalInstructions = await fetchFromProviderProxy(
        "getInstructions",
        ministryId,
        planFolder.providerId,
        planFolder.providerPlanId,
        authData
      );
      if (externalInstructions) {
        return { venueName: planTitle, items: externalInstructions.items };
      }
    }

    if (!planItems || !Array.isArray(planItems)) return null;

    // Process items, handling external providers
    const processedItems = await this.processInstructionItems(planItems, ministryId, authData);
    return { venueName: planTitle, items: processedItems };
  }

  private async processInstructionItems(
    items: B1PlanItem[],
    ministryId: string,
    authData?: ContentProviderAuthData | null
  ): Promise<import("../../interfaces").InstructionItem[]> {
    const result: import("../../interfaces").InstructionItem[] = [];

    for (const item of items) {
      // Convert the item first
      const instructionItem = planItemToInstruction(item);

      if (isExternalProviderItem(item) && item.providerId && item.providerPath) {
        // Fetch expanded instructions from external provider
        console.log("Processing external item:", item.providerId, item.providerPath, item.providerContentPath);
        const externalInstructions = await fetchFromProviderProxy(
          "getInstructions",
          ministryId,
          item.providerId,
          item.providerPath,
          authData
        );
        if (externalInstructions) {
          // If providerContentPath is set, find and use only that specific item's children
          if (item.providerContentPath) {
            const matchingItem = this.findItemByPath(externalInstructions, item.providerContentPath);
            if (matchingItem?.children) {
              instructionItem.children = matchingItem.children;
            }
          } else {
            // Use all items from external provider as children
            instructionItem.children = externalInstructions.items;
          }
        }
      } else if (item.children && item.children.length > 0) {
        // Recursively process children for internal items
        instructionItem.children = await this.processInstructionItems(item.children, ministryId, authData);
      }

      result.push(instructionItem);
    }

    return result;
  }

  private findItemByPath(instructions: Instructions | null, path?: string): InstructionItem | null {
    if (!path || !instructions) return null;
    return navigateToPath(instructions, path);
  }

  private findPresentationByPath(plan: Plan, instructions: Instructions | null, path?: string): PlanPresentation | null {
    if (!path || !instructions) return null;
    const item = navigateToPath(instructions, path);
    if (!item?.relatedId && !item?.id) return null;
    const presentationId = item.relatedId || item.id;
    for (const section of plan.sections) {
      for (const presentation of section.presentations) {
        if (presentation.id === presentationId) return presentation;
      }
    }
    return null;
  }

  async getPlaylist(path: string, authData?: ContentProviderAuthData | null, resolution?: number): Promise<ContentFile[] | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 4 || segments[0] !== "ministries") return [];

    const ministryId = segments[1];
    const planId = segments[3];
    const planTypeId = segments[2];

    // Need to fetch plan details to get churchId and contentId
    const plans = await fetchPlans(planTypeId, authData);
    const planFolder = plans.find(p => p.id === planId);
    if (!planFolder) return [];

    const churchId = planFolder.churchId;
    const venueId = planFolder.contentId;

    if (!churchId) return [];

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);

    // If no planItems but plan has associated provider content, fetch from that provider
    if ((!planItems || planItems.length === 0) && planFolder.providerId && planFolder.providerPlanId) {
      const externalFiles = await fetchFromProviderProxy(
        "getPlaylist",
        ministryId,
        planFolder.providerId,
        planFolder.providerPlanId,
        authData,
        resolution
      );
      return externalFiles || [];
    }

    if (!planItems || !Array.isArray(planItems)) return [];

    const venueFeed = venueId ? await fetchVenueFeed(venueId) : null;
    const files: ContentFile[] = [];

    for (const sectionItem of planItems) {
      for (const child of sectionItem.children || []) {
        // Handle external provider items via proxy
        if (isExternalProviderItem(child) && child.providerId && child.providerPath) {
          if (child.providerContentPath) {
            // Fetch presentations and instructions for path-based lookup
            const externalPlan = await fetchFromProviderProxy(
              "getPresentations",
              ministryId,
              child.providerId,
              child.providerPath,
              authData
            );
            const externalInstructions = await fetchFromProviderProxy(
              "getInstructions",
              ministryId,
              child.providerId,
              child.providerPath,
              authData
            );
            if (externalPlan) {
              const matchingPresentation = this.findPresentationByPath(externalPlan, externalInstructions, child.providerContentPath);
              if (matchingPresentation) {
                files.push(...matchingPresentation.files);
              }
            }
          } else {
            // No specific content ID - get all files
            const externalFiles = await fetchFromProviderProxy(
              "getPlaylist",
              ministryId,
              child.providerId,
              child.providerPath,
              authData,
              resolution
            );
            if (externalFiles) {
              files.push(...externalFiles);
            }
          }
        } else {
          // Handle internal items as before
          const itemType = child.itemType;
          if ((itemType === "lessonSection" || itemType === "section" ||
               itemType === "lessonAction" || itemType === "action" ||
               itemType === "lessonAddOn" || itemType === "addon") && venueFeed) {
            const itemFiles = getFilesFromVenueFeed(venueFeed, itemType, child.relatedId);
            files.push(...itemFiles);
          }
        }
      }
    }

    return files;
  }
}
