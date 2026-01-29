import { ContentItem, ContentFile, FeedVenueInterface, PlanPresentation, InstructionItem } from '../../interfaces';
import { detectMediaType } from '../../utils';
import { B1Ministry, B1PlanType, B1Plan, B1PlanItem, ArrangementKeyResponse } from './types';
import { fetchArrangementKey } from './api';

/**
 * Convert a B1Ministry to a content folder item.
 */
export function ministryToFolder(ministry: B1Ministry): ContentItem {
  return {
    type: 'folder' as const,
    id: ministry.id,
    title: ministry.name,
    image: ministry.photoUrl,
    providerData: {
      level: 'ministry',
      ministryId: ministry.id,
      churchId: ministry.churchId
    }
  };
}

/**
 * Convert a B1PlanType to a content folder item.
 */
export function planTypeToFolder(planType: B1PlanType, ministryId: string): ContentItem {
  return {
    type: 'folder' as const,
    id: planType.id,
    title: planType.name,
    providerData: {
      level: 'planType',
      planTypeId: planType.id,
      ministryId: ministryId,
      churchId: planType.churchId
    }
  };
}

/**
 * Convert a B1Plan to a content folder item.
 */
export function planToFolder(plan: B1Plan): ContentItem {
  return {
    type: 'folder' as const,
    id: plan.id,
    title: plan.name,
    providerData: {
      isLeaf: true,
      level: 'plan',
      planId: plan.id,
      planTypeId: plan.planTypeId,
      ministryId: plan.ministryId,
      churchId: plan.churchId,
      serviceDate: plan.serviceDate,
      contentType: plan.contentType,
      contentId: plan.contentId
    }
  };
}

/**
 * Convert a B1PlanItem section to a content folder.
 */
export function sectionToFolder(section: B1PlanItem): ContentItem {
  return {
    type: 'folder' as const,
    id: section.id,
    title: section.label || 'Section',
    providerData: {
      level: 'section',
      itemType: 'section',
      description: section.description,
      seconds: section.seconds
    }
  };
}

/**
 * Convert a B1PlanItem to a ContentItem.
 */
export function planItemToContentItem(
  item: B1PlanItem,
  venueId: string | undefined
): ContentItem | null {
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

/**
 * Convert a B1PlanItem to a PlanPresentation.
 */
export async function planItemToPresentation(
  item: B1PlanItem,
  venueFeed: FeedVenueInterface | null
): Promise<PlanPresentation | null> {
  const itemType = item.itemType;

  if (itemType === 'arrangementKey' && item.churchId && item.relatedId) {
    const songData = await fetchArrangementKey(item.churchId, item.relatedId);
    if (songData) {
      return arrangementToPresentation(item, songData);
    }
  }

  if ((itemType === 'lessonSection' || itemType === 'lessonAction' || itemType === 'lessonAddOn') && venueFeed) {
    const files = getFilesFromVenueFeed(venueFeed, itemType, item.relatedId);
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

/**
 * Convert arrangement data to a presentation.
 */
function arrangementToPresentation(item: B1PlanItem, songData: ArrangementKeyResponse): PlanPresentation {
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

/**
 * Extract files from venue feed based on item type and related ID.
 */
export function getFilesFromVenueFeed(
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
            files.push(...convertFeedFiles(action.files || [], venueFeed.lessonImage));
          }
        }
        break;
      }
    }
  } else if (itemType === 'lessonAction') {
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

/**
 * Convert feed files to ContentFile array.
 */
export function convertFeedFiles(
  feedFiles: Array<{ id?: string; name?: string; url?: string; streamUrl?: string; seconds?: number; fileType?: string }>,
  thumbnailImage?: string
): ContentFile[] {
  return feedFiles
    .filter(f => f.url)
    .map(f => ({
      type: 'file' as const,
      id: f.id || '',
      title: f.name || '',
      mediaType: detectMediaType(f.url || '', f.fileType),
      image: thumbnailImage,
      url: f.url || '',
      providerData: { seconds: f.seconds, streamUrl: f.streamUrl }
    }));
}

/**
 * Convert B1PlanItem to InstructionItem recursively.
 */
export function planItemToInstruction(item: B1PlanItem): InstructionItem {
  return {
    id: item.id,
    itemType: item.itemType,
    relatedId: item.relatedId,
    label: item.label,
    description: item.description,
    seconds: item.seconds,
    children: item.children?.map(planItemToInstruction)
  };
}
