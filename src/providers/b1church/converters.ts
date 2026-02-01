import { ContentItem, ContentFile, FeedVenueInterface, PlanPresentation, InstructionItem } from "../../interfaces";
import { detectMediaType } from "../../utils";
import { B1Ministry, B1PlanType, B1Plan, B1PlanItem, ArrangementKeyResponse } from "./types";
import { fetchArrangementKey } from "./api";

export function ministryToFolder(ministry: B1Ministry): ContentItem {
  return { type: "folder" as const, id: ministry.id, title: ministry.name, path: "", image: ministry.photoUrl };
}

export function planTypeToFolder(planType: B1PlanType): ContentItem {
  return { type: "folder" as const, id: planType.id, title: planType.name, path: "" };
}

export function planToFolder(plan: B1Plan): ContentItem {
  return { type: "folder" as const, id: plan.id, title: plan.name, path: "", isLeaf: true };
}

export function sectionToFolder(section: B1PlanItem): ContentItem {
  return { type: "folder" as const, id: section.id, title: section.label || "Section", path: "" };
}

export async function planItemToPresentation(item: B1PlanItem, venueFeed: FeedVenueInterface | null): Promise<PlanPresentation | null> {
  const itemType = item.itemType;

  if (itemType === "arrangementKey" && item.churchId && item.relatedId) {
    const songData = await fetchArrangementKey(item.churchId, item.relatedId);
    if (songData) return arrangementToPresentation(item, songData);
  }

  if ((itemType === "lessonSection" || itemType === "section" || itemType === "lessonAction" || itemType === "action" || itemType === "lessonAddOn" || itemType === "addon") && venueFeed) {
    const files = getFilesFromVenueFeed(venueFeed, itemType, item.relatedId);
    if (files.length > 0) return { id: item.id, name: item.label || "Lesson Content", actionType: (itemType === "lessonAddOn" || itemType === "addon") ? "add-on" : "play", files };
  }

  if (itemType === "item" || itemType === "header") {
    return { id: item.id, name: item.label || "", actionType: "other", files: [], providerData: { itemType, description: item.description, seconds: item.seconds } } as PlanPresentation;
  }

  return null;
}

function arrangementToPresentation(item: B1PlanItem, songData: ArrangementKeyResponse): PlanPresentation {
  const title = songData.songDetail?.title || item.label || "Song";
  return { id: item.id, name: title, actionType: "other", files: [], providerData: { itemType: "song", title, artist: songData.songDetail?.artist, lyrics: songData.arrangement?.lyrics, keySignature: songData.arrangementKey?.keySignature, arrangementName: songData.arrangement?.name, seconds: songData.songDetail?.seconds || item.seconds } } as PlanPresentation;
}

export function getFilesFromVenueFeed(venueFeed: FeedVenueInterface, itemType: string, relatedId?: string): ContentFile[] {
  const files: ContentFile[] = [];

  if (!relatedId) return files;

  if (itemType === "lessonSection" || itemType === "section") {
    for (const section of venueFeed.sections || []) {
      if (section.id === relatedId) {
        for (const action of section.actions || []) {
          const actionType = action.actionType?.toLowerCase();
          if (actionType === "play" || actionType === "add-on") {
            files.push(...convertFeedFiles(action.files || [], venueFeed.lessonImage));
          }
        }
        break;
      }
    }
  } else if (itemType === "lessonAction" || itemType === "action") {
    for (const section of venueFeed.sections || []) {
      for (const action of section.actions || []) {
        if (action.id === relatedId) {
          files.push(...convertFeedFiles(action.files || [], venueFeed.lessonImage));
          break;
        }
      }
    }
  }

  return files;
}

export function convertFeedFiles(feedFiles: Array<{ id?: string; name?: string; url?: string; streamUrl?: string; seconds?: number; fileType?: string }>, thumbnailImage?: string): ContentFile[] {
  return feedFiles.filter(f => f.url).map(f => ({ type: "file" as const, id: f.id || "", title: f.name || "", mediaType: detectMediaType(f.url || "", f.fileType), image: thumbnailImage, url: f.url || "", seconds: f.seconds, streamUrl: f.streamUrl }));
}

export function planItemToInstruction(item: B1PlanItem): InstructionItem {
  // Convert B1 API itemTypes to standardized short names
  let itemType: string | undefined = item.itemType;
  switch (item.itemType) {
    case "lessonSection": itemType = "section"; break;
    case "lessonAction": itemType = "action"; break;
    case "lessonAddOn": itemType = "addon"; break;
  }

  return { id: item.id, itemType, relatedId: item.relatedId, label: item.label, description: item.description, seconds: item.seconds, children: item.children?.map(planItemToInstruction) };
}

/**
 * Generate default plan items from a venue feed when no plan items exist.
 * Creates a structure with one header containing all venue sections as children.
 */
export function venueFeedToDefaultPlanItems(venueFeed: FeedVenueInterface): B1PlanItem[] {
  const headerItem: B1PlanItem = {
    id: "default-header",
    label: venueFeed.lessonName || venueFeed.name || "Lesson",
    itemType: "header",
    children: []
  };

  for (const section of venueFeed.sections || []) {
    const sectionItem: B1PlanItem = {
      id: section.id || `section-${headerItem.children!.length}`,
      label: section.name || "Section",
      itemType: "section",
      relatedId: section.id,
      children: []
    };

    for (const action of section.actions || []) {
      const actionType = action.actionType?.toLowerCase();
      // Only include play and add-on actions
      if (actionType === "play" || actionType === "add-on") {
        const actionItem: B1PlanItem = {
          id: action.id || `action-${sectionItem.children!.length}`,
          label: action.content || "Action",
          itemType: actionType === "add-on" ? "addon" : "action",
          relatedId: action.id
        };
        sectionItem.children!.push(actionItem);
      }
    }

    // Only add sections that have actions
    if (sectionItem.children!.length > 0) {
      headerItem.children!.push(sectionItem);
    }
  }

  return headerItem.children!.length > 0 ? [headerItem] : [];
}
