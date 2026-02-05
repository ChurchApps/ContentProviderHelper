import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, Instructions, ProviderCapabilities, DeviceAuthorizationResponse, DeviceFlowPollResult, IProvider, AuthType, InstructionItem } from "../../interfaces";
import { parsePath } from "../../pathUtils";
import { navigateToPath } from "../../instructionPathUtils";
import { ApiHelper } from "../../helpers";
import { B1PlanItem } from "./B1ChurchTypes";
import * as B1ChurchAuth from "./B1ChurchAuth";
import { fetchMinistries, fetchPlanTypes, fetchPlans, fetchVenueFeed, fetchVenueActions, fetchFromProviderProxy, API_BASE } from "./B1ChurchApi";
import { ministryToFolder, planTypeToFolder, planToFolder, planItemToPresentation, planItemToInstruction, getFilesFromVenueFeed, getFileFromProviderFileItem, buildSectionActionsMap } from "./B1ChurchConverters";

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

  private appBase = "https://admin.b1.church";

  readonly requiresAuth = true;
  readonly authTypes: AuthType[] = ["oauth_pkce", "device_flow"];
  readonly capabilities: ProviderCapabilities = { browse: true, presentations: true, playlist: true, instructions: true, mediaLicensing: false };

  async buildAuthUrl(codeVerifier: string, redirectUri: string, state?: string): Promise<{ url: string; challengeMethod: string }> {
    return B1ChurchAuth.buildB1AuthUrl(this.config, this.appBase, redirectUri, codeVerifier, state);
  }

  async exchangeCodeForTokensWithPKCE(code: string, redirectUri: string, codeVerifier: string): Promise<ContentProviderAuthData | null> {
    return B1ChurchAuth.exchangeCodeForTokensWithPKCE(this.config, code, redirectUri, codeVerifier);
  }

  async exchangeCodeForTokensWithSecret(code: string, redirectUri: string, clientSecret: string): Promise<ContentProviderAuthData | null> {
    return B1ChurchAuth.exchangeCodeForTokensWithSecret(this.config, code, redirectUri, clientSecret);
  }

  async refreshTokenWithSecret(authData: ContentProviderAuthData, clientSecret: string): Promise<ContentProviderAuthData | null> {
    return B1ChurchAuth.refreshTokenWithSecret(this.config, authData, clientSecret);
  }

  async initiateDeviceFlow(): Promise<DeviceAuthorizationResponse | null> {
    return B1ChurchAuth.initiateDeviceFlow(this.config);
  }

  async pollDeviceFlowToken(deviceCode: string): Promise<DeviceFlowPollResult> {
    return B1ChurchAuth.pollDeviceFlowToken(this.config, deviceCode);
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

    // Cache external plan/instructions by providerPath to avoid duplicate calls
    const externalPlanCache = new Map<string, Plan | null>();
    const externalInstructionsCache = new Map<string, Instructions | null>();

    for (const sectionItem of planItems) {
      const presentations: PlanPresentation[] = [];

      for (const child of sectionItem.children || []) {
        // Try external provider resolution first (cached, uses providerContentPath)
        if (isExternalProviderItem(child) && child.providerId && child.providerPath) {
          const cacheKey = `${child.providerId}:${child.providerPath}`;

          let externalPlan = externalPlanCache.get(cacheKey);
          if (externalPlan === undefined) {
            externalPlan = await fetchFromProviderProxy(
              "getPresentations",
              ministryId,
              child.providerId,
              child.providerPath,
              authData
            );
            externalPlanCache.set(cacheKey, externalPlan);
          }

          if (externalPlan) {
            if (child.providerContentPath) {
              // Fetch instructions to enable path-based lookup (with caching)
              let externalInstructions = externalInstructionsCache.get(cacheKey);
              if (externalInstructions === undefined) {
                externalInstructions = await fetchFromProviderProxy(
                  "getInstructions",
                  ministryId,
                  child.providerId,
                  child.providerPath,
                  authData
                );
                externalInstructionsCache.set(cacheKey, externalInstructions);
              }
              // Find and use only the specific presentation
              const matchingPresentation = this.findPresentationByPath(externalPlan, externalInstructions, child.providerContentPath);
              if (matchingPresentation) {
                presentations.push(matchingPresentation);
                if (Array.isArray(matchingPresentation.files)) {
                  allFiles.push(...matchingPresentation.files);
                }
              }
            } else {
              // Add all presentations from the external plan
              for (const section of externalPlan.sections || []) {
                if (Array.isArray(section.presentations)) {
                  presentations.push(...section.presentations);
                }
              }
              if (Array.isArray(externalPlan.allFiles)) {
                allFiles.push(...externalPlan.allFiles);
              }
            }
          }
        } else {
          // Handle internal items (venue feed sections, link-based files, etc.)
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

    // Need to fetch plan details to get churchId and contentId
    const plans = await fetchPlans(planTypeId, authData);
    const planFolder = plans.find(p => p.id === planId);
    if (!planFolder) return null;

    console.log("[B1Church getInstructions] planFolder:", JSON.stringify(planFolder, null, 2));

    const churchId = planFolder.churchId;
    const venueId = planFolder.contentId;
    const planTitle = planFolder.name || "Plan";

    console.log("[B1Church getInstructions] churchId:", churchId, "venueId:", venueId);

    if (!churchId) return null;

    const pathFn = this.config.endpoints.planItems as (churchId: string, planId: string) => string;
    const planItems = await this.apiRequest<B1PlanItem[]>(pathFn(churchId, planId), authData);

    console.log("[B1Church getInstructions] planItems count:", planItems?.length || 0);
    console.log("[B1Church getInstructions] planItems:", JSON.stringify(planItems, null, 2));

    // If no planItems but plan has associated provider content, fetch from that provider
    if ((!planItems || planItems.length === 0) && planFolder.providerId && planFolder.providerPlanId) {
      console.log("[B1Church getInstructions] No planItems, fetching from external provider:", planFolder.providerId);
      const externalInstructions = await fetchFromProviderProxy(
        "getInstructions",
        ministryId,
        planFolder.providerId,
        planFolder.providerPlanId,
        authData
      );
      if (externalInstructions) {
        return { name: planTitle, items: externalInstructions.items };
      }
    }

    if (!planItems || !Array.isArray(planItems)) return null;

    // Fetch venue actions to expand section items
    let sectionActionsMap = new Map<string, import("../../interfaces").InstructionItem[]>();
    if (venueId) {
      console.log("[B1Church getInstructions] Fetching venue actions for venueId:", venueId);
      const venueActions = await fetchVenueActions(venueId);
      console.log("[B1Church getInstructions] venueActions response:", JSON.stringify(venueActions, null, 2));
      sectionActionsMap = buildSectionActionsMap(venueActions);
      console.log("[B1Church getInstructions] sectionActionsMap keys:", Array.from(sectionActionsMap.keys()));
    } else {
      console.log("[B1Church getInstructions] No venueId - planFolder.contentId is:", planFolder.contentId);
    }

    // Process items, handling external providers
    const processedItems = await this.processInstructionItems(planItems, ministryId, authData, sectionActionsMap);
    return { name: planTitle, items: processedItems };
  }

  private async processInstructionItems(
    items: B1PlanItem[],
    ministryId: string,
    authData?: ContentProviderAuthData | null,
    sectionActionsMap?: Map<string, import("../../interfaces").InstructionItem[]>
  ): Promise<import("../../interfaces").InstructionItem[]> {
    const result: import("../../interfaces").InstructionItem[] = [];

    console.log("[B1Church processInstructionItems] Processing", items.length, "items. sectionActionsMap size:", sectionActionsMap?.size || 0);

    for (const item of items) {
      console.log("[B1Church processInstructionItems] Item:", item.id, "type:", item.itemType, "relatedId:", item.relatedId, "hasChildren:", !!item.children?.length);

      // Convert the item first
      const instructionItem = planItemToInstruction(item);

      // Check if this is a section that can be expanded from the local sectionActionsMap
      const itemType = item.itemType;
      const isSectionType = itemType === "section" || itemType === "lessonSection" || itemType === "providerSection";
      const canExpandLocally = isSectionType && sectionActionsMap && item.relatedId && sectionActionsMap.has(item.relatedId);

      // Check if children contain sections that can be expanded locally
      const hasLocallyExpandableChildren = item.children && item.children.length > 0 && sectionActionsMap && sectionActionsMap.size > 0 &&
        item.children.some(child => {
          const childType = child.itemType;
          return (childType === "section" || childType === "lessonSection" || childType === "providerSection") &&
                 child.relatedId && sectionActionsMap.has(child.relatedId);
        });

      if (canExpandLocally && item.relatedId) {
        // Expand section items with actions from sectionActionsMap
        console.log("[B1Church processInstructionItems] Section item! relatedId:", item.relatedId);
        const sectionActions = sectionActionsMap!.get(item.relatedId);
        console.log("[B1Church processInstructionItems] Found actions:", sectionActions ? sectionActions.length : "NONE");
        if (sectionActions) {
          instructionItem.children = sectionActions;
        }
      } else if ((itemType === "providerFile" || itemType === "providerPresentation") && item.link) {
        // providerFile/providerPresentation items with a link are already complete - use the link as embedUrl
        // The embedUrl is already set by planItemToInstruction, no children needed
        console.log("[B1Church processInstructionItems] Provider item with direct link - using:", item.link);
      } else if (hasLocallyExpandableChildren) {
        // Recurse into children that can be expanded locally (don't fetch from external)
        console.log("[B1Church processInstructionItems] Has locally expandable children, recursing into", item.children!.length, "children");
        instructionItem.children = await this.processInstructionItems(item.children!, ministryId, authData, sectionActionsMap);
      } else if (isExternalProviderItem(item) && item.providerId && item.providerPath) {
        console.log("[B1Church processInstructionItems] External provider item - fetching from:", item.providerId, item.providerPath);
        // Fetch expanded instructions from external provider
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
        console.log("[B1Church processInstructionItems] Recursing into", item.children.length, "children");
        instructionItem.children = await this.processInstructionItems(item.children, ministryId, authData, sectionActionsMap);
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

    // Cache external plan/instructions by providerPath to avoid duplicate calls
    const externalPlanCache = new Map<string, Plan | null>();
    const externalInstructionsCache = new Map<string, Instructions | null>();
    const externalPlaylistCache = new Map<string, ContentFile[] | null>();

    for (const sectionItem of planItems) {
      for (const child of sectionItem.children || []) {
        const childItemType = child.itemType;

        // Check if this is a section that can be expanded from the local venue feed
        const isSectionType = childItemType === "section" || childItemType === "lessonSection" || childItemType === "providerSection";
        const canExpandLocally = isSectionType && venueFeed && child.relatedId;

        // Try external provider resolution first (cached, uses providerContentPath)
        if (isExternalProviderItem(child) && child.providerId && child.providerPath) {
          const cacheKey = `${child.providerId}:${child.providerPath}`;

          if (child.providerContentPath) {
            // Fetch presentations and instructions for path-based lookup (with caching)
            let externalPlan = externalPlanCache.get(cacheKey);
            if (externalPlan === undefined) {
              externalPlan = await fetchFromProviderProxy(
                "getPresentations",
                ministryId,
                child.providerId,
                child.providerPath,
                authData
              );
              externalPlanCache.set(cacheKey, externalPlan);
            }

            let externalInstructions = externalInstructionsCache.get(cacheKey);
            if (externalInstructions === undefined) {
              externalInstructions = await fetchFromProviderProxy(
                "getInstructions",
                ministryId,
                child.providerId,
                child.providerPath,
                authData
              );
              externalInstructionsCache.set(cacheKey, externalInstructions);
            }

            if (externalPlan) {
              const matchingPresentation = this.findPresentationByPath(externalPlan, externalInstructions, child.providerContentPath);
              if (matchingPresentation?.files && Array.isArray(matchingPresentation.files)) {
                files.push(...matchingPresentation.files);
              }
            }
          } else {
            // No specific content path - get all files (with caching)
            let externalFiles = externalPlaylistCache.get(cacheKey);
            if (externalFiles === undefined) {
              externalFiles = await fetchFromProviderProxy(
                "getPlaylist",
                ministryId,
                child.providerId,
                child.providerPath,
                authData,
                resolution
              );
              externalPlaylistCache.set(cacheKey, externalFiles);
            }
            if (Array.isArray(externalFiles)) {
              files.push(...externalFiles);
            }
          }
        } else if (canExpandLocally) {
          // Get files from venue feed for section items
          const itemFiles = getFilesFromVenueFeed(venueFeed, childItemType!, child.relatedId);
          files.push(...itemFiles);
        } else if ((childItemType === "providerFile" || childItemType === "providerPresentation") && child.link) {
          // Fallback: use stored link when no provider info available
          const file = getFileFromProviderFileItem(child);
          if (file) files.push(file);
        } else if (venueFeed && (childItemType === "lessonAction" || childItemType === "action" ||
               childItemType === "lessonAddOn" || childItemType === "addon")) {
          // Handle action items from venue feed
          const itemFiles = getFilesFromVenueFeed(venueFeed, childItemType, child.relatedId);
          files.push(...itemFiles);
        }
      }
    }

    return files;
  }

  supportsDeviceFlow(): boolean {
    return !!this.config.supportsDeviceFlow;
  }
}
