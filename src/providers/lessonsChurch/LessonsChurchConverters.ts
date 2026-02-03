import { ContentFile, FeedVenueInterface, Plan, PlanSection, PlanPresentation, InstructionItem, VenueActionsResponseInterface } from "../../interfaces";
import { detectMediaType } from "../../utils";
import { estimateImageDuration } from "../../durationUtils";
import { apiRequest, API_BASE } from "./LessonsChurchApi";

export function normalizeItemType(type?: string): string | undefined {
  if (type === "lessonSection") return "section";
  if (type === "lessonAction") return "action";
  if (type === "lessonAddOn") return "addon";
  return type;
}

export function getEmbedUrl(itemType?: string, relatedId?: string): string | undefined {
  if (!relatedId) return undefined;

  const baseUrl = "https://lessons.church";
  switch (itemType) {
    case "action": return `${baseUrl}/embed/action/${relatedId}`;
    case "addon": return `${baseUrl}/embed/addon/${relatedId}`;
    case "section": return `${baseUrl}/embed/section/${relatedId}`;
    default: return undefined;
  }
}

export function convertVenueToPlan(venue: FeedVenueInterface): Plan {
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

        const contentFile: ContentFile = { type: "file", id: file.id || "", title: file.name || "", mediaType: detectMediaType(file.url, file.fileType), image: venue.lessonImage, url: file.url, embedUrl, seconds: file.seconds, streamUrl: file.streamUrl };

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

export async function convertAddOnToFile(addOn: Record<string, unknown>): Promise<ContentFile | null> {
  const apiPath = `/addOns/public/${addOn.id as string}`;
  const detail = await apiRequest<Record<string, unknown>>(apiPath);
  if (!detail) return null;

  let url = "";
  let mediaType: "video" | "image" = "video";
  let seconds = (addOn.seconds as number) || 10;

  const video = detail.video as Record<string, unknown> | undefined;
  const file = detail.file as Record<string, unknown> | undefined;

  if (video) {
    url = `${API_BASE}/externalVideos/download/${video.id}`;
    seconds = (video.seconds as number) || seconds;
  } else if (file) {
    url = file.contentPath as string;
    const fileType = file.fileType as string | undefined;
    mediaType = fileType?.startsWith("video/") ? "video" : "image";
  } else {
    return null;
  }

  return { type: "file", id: addOn.id as string, title: addOn.name as string, mediaType, image: addOn.image as string | undefined, url, embedUrl: `https://lessons.church/embed/addon/${addOn.id}`, seconds, loopVideo: ((video as Record<string, unknown> | undefined)?.loopVideo as boolean) || false };
}

export function buildSectionActionsMap(actionsResponse: VenueActionsResponseInterface | null): Map<string, InstructionItem[]> {
  const sectionActionsMap = new Map<string, InstructionItem[]>();
  if (actionsResponse?.sections) {
    for (const section of actionsResponse.sections) {
      if (section.id && section.actions) {
        sectionActionsMap.set(section.id, section.actions.map(action => {
          const embedUrl = getEmbedUrl("action", action.id);
          const seconds = action.seconds ?? estimateImageDuration();
          return { id: action.id, itemType: "action", relatedId: action.id, label: action.name, description: action.actionType, seconds, children: [{ id: action.id + "-file", itemType: "file", label: action.name, seconds, embedUrl }] };
        }));
      }
    }
  }
  return sectionActionsMap;
}

export function processInstructionItem(item: Record<string, unknown>, sectionActionsMap: Map<string, InstructionItem[]>): InstructionItem {
  const relatedId = item.relatedId as string | undefined;
  const itemType = normalizeItemType(item.itemType as string | undefined);
  const children = item.children as Record<string, unknown>[] | undefined;

  let processedChildren: InstructionItem[] | undefined;

  if (children) {
    processedChildren = children.map(child => {
      const childRelatedId = child.relatedId as string | undefined;
      const childItemType = normalizeItemType(child.itemType as string | undefined);
      if (childRelatedId && sectionActionsMap.has(childRelatedId)) {
        return { id: child.id as string | undefined, itemType: childItemType, relatedId: childRelatedId, label: child.label as string | undefined, description: child.description as string | undefined, seconds: child.seconds as number | undefined, children: sectionActionsMap.get(childRelatedId), embedUrl: getEmbedUrl(childItemType, childRelatedId) };
      }
      return processInstructionItem(child, sectionActionsMap);
    });
  }

  return { id: item.id as string | undefined, itemType, relatedId, label: item.label as string | undefined, description: item.description as string | undefined, seconds: item.seconds as number | undefined, children: processedChildren, embedUrl: getEmbedUrl(itemType, relatedId) };
}
