import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities, IProvider, AuthType } from '../../interfaces';
import { createFile } from '../../utils';
import { parsePath } from '../../pathUtils';
import bibleProjectData from './data.json';
import { BibleProjectData } from './BibleProjectInterfaces';

/**
 * BibleProject Provider
 *
 * Path structure:
 *   /collections                              -> list collections
 *   /collections/{collectionName}             -> list videos in collection
 *   /collections/{collectionName}/{videoId}   -> single video
 */
export class BibleProjectProvider implements IProvider {
  readonly id = 'bibleproject';
  readonly name = 'The Bible Project';

  readonly logos: ProviderLogos = {
    light: 'https://static.bibleproject.com/bp-web-components/v0.25.0/bibleproject-logo-mark.svg',
    dark: 'https://static.bibleproject.com/bp-web-components/v0.25.0/bibleproject-logo-mark.svg'
  };

  readonly config: ContentProviderConfig = {
    id: 'bibleproject',
    name: 'The Bible Project',
    apiBase: 'https://bibleproject.com',
    oauthBase: '',
    clientId: '',
    scopes: [],
    endpoints: {
      downloads: '/downloads/'
    }
  };

  private data: BibleProjectData = bibleProjectData;

  readonly requiresAuth = false;
  readonly authTypes: AuthType[] = ['none'];
  readonly capabilities: ProviderCapabilities = {
    browse: true,
    presentations: true,
    playlist: true,
    instructions: false,
    expandedInstructions: false,
    mediaLicensing: false
  };

  async browse(path?: string | null, _auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);

    if (depth === 0) {
      // Return top-level collections folder
      return [{
        type: 'folder' as const,
        id: 'collections-root',
        title: 'Collections',
        path: '/collections'
      }];
    }

    const root = segments[0];
    if (root !== 'collections') return [];

    // /collections -> list all collections
    if (depth === 1) {
      return this.getCollections();
    }

    // /collections/{collectionName} -> list videos in collection
    if (depth === 2) {
      const collectionName = decodeURIComponent(segments[1]);
      return this.getLessonFolders(collectionName, path!);
    }

    // /collections/{collectionName}/{videoId} -> single video file
    if (depth === 3) {
      const collectionName = decodeURIComponent(segments[1]);
      const videoId = segments[2];
      return this.getVideoFile(collectionName, videoId);
    }

    return [];
  }

  private getCollections(): ContentItem[] {
    return this.data.collections
      .filter(collection => collection.videos.length > 0)
      .map(collection => ({
        type: 'folder' as const,
        id: this.slugify(collection.name),
        title: collection.name,
        image: collection.image || undefined,
        path: `/collections/${encodeURIComponent(collection.name)}`
      }));
  }

  private getLessonFolders(collectionName: string, currentPath: string): ContentItem[] {
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return [];

    return collection.videos.map(video => ({
      type: 'folder' as const,
      id: video.id,
      title: video.title,
      image: video.thumbnailUrl,
      isLeaf: true,
      path: `${currentPath}/${video.id}`,
      providerData: { videoData: video }
    }));
  }

  private getVideoFile(collectionName: string, videoId: string): ContentItem[] {
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return [];

    const video = collection.videos.find(v => v.id === videoId);
    if (!video) return [];

    return [createFile(video.id, video.title, video.videoUrl, { mediaType: 'video', muxPlaybackId: video.muxPlaybackId })];
  }

  async getPresentations(path: string, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 2 || segments[0] !== 'collections') return null;

    const collectionName = decodeURIComponent(segments[1]);
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return null;

    // For collection level (depth 2), create a plan with all videos
    if (depth === 2) {
      const allFiles: ContentFile[] = [];
      const presentations: PlanPresentation[] = collection.videos.map(video => {
        const file: ContentFile = { type: 'file', id: video.id, title: video.title, mediaType: 'video', url: video.videoUrl, image: video.thumbnailUrl, muxPlaybackId: video.muxPlaybackId };
        allFiles.push(file);
        return { id: video.id, name: video.title, actionType: 'play' as const, files: [file] };
      });

      return { id: this.slugify(collection.name), name: collection.name, image: collection.image || undefined, sections: [{ id: 'videos', name: 'Videos', presentations }], allFiles };
    }

    // For lesson level (depth 3, single video), create a simple plan
    if (depth === 3) {
      const videoId = segments[2];
      const video = collection.videos.find(v => v.id === videoId);
      if (!video) return null;

      const file: ContentFile = { type: 'file', id: video.id, title: video.title, mediaType: 'video', url: video.videoUrl, image: video.thumbnailUrl, muxPlaybackId: video.muxPlaybackId };
      return { id: video.id, name: video.title, image: video.thumbnailUrl, sections: [{ id: 'main', name: 'Content', presentations: [{ id: video.id, name: video.title, actionType: 'play', files: [file] }] }], allFiles: [file] };
    }

    return null;
  }

  async getPlaylist(path: string, _auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 2 || segments[0] !== 'collections') return null;

    const collectionName = decodeURIComponent(segments[1]);
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return null;

    // For collection level, return all videos
    if (depth === 2) {
      return collection.videos.map(video => ({ type: 'file' as const, id: video.id, title: video.title, mediaType: 'video' as const, url: video.videoUrl, image: video.thumbnailUrl, muxPlaybackId: video.muxPlaybackId }));
    }

    // For lesson level, return the single video
    if (depth === 3) {
      const videoId = segments[2];
      const video = collection.videos.find(v => v.id === videoId);
      if (!video) return null;
      return [{ type: 'file', id: video.id, title: video.title, mediaType: 'video', url: video.videoUrl, image: video.thumbnailUrl, muxPlaybackId: video.muxPlaybackId }];
    }

    return null;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
