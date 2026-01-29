import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities } from '../../interfaces';
import { ContentProvider } from '../../ContentProvider';
import bibleProjectData from './data.json';

interface BibleProjectVideo {
  id: string;
  title: string;
  filename: string;
  muxPlaybackId: string;
  videoUrl: string;
  thumbnailUrl?: string;
}

interface BibleProjectCollection {
  name: string;
  image: string | null;
  videos: BibleProjectVideo[];
}

interface BibleProjectData {
  collections: BibleProjectCollection[];
}

export class BibleProjectProvider extends ContentProvider {
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

  override requiresAuth(): boolean {
    return false;
  }

  override getCapabilities(): ProviderCapabilities {
    return {
      browse: true,
      presentations: true,  // Has collections with videos
      playlist: true,       // Can return flat list of videos
      instructions: false,
      expandedInstructions: false,
      mediaLicensing: false
    };
  }

  async browse(folder?: ContentFolder | null, _auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!folder) {
      // Return top-level collection folders
      return this.data.collections
        .filter(collection => collection.videos.length > 0)
        .map(collection => this.createFolder(
          this.slugify(collection.name),
          collection.name,
          collection.image || undefined,
          { level: 'collection', collectionName: collection.name }
        ));
    }

    const level = folder.providerData?.level;
    const collectionName = folder.providerData?.collectionName as string;

    if (level === 'collection') {
      // Return lesson folders (one per video) for all collections
      return this.getLessonFolders(collectionName);
    }

    if (level === 'lesson') {
      // Return the single video for this lesson
      const videoData = folder.providerData?.videoData as BibleProjectVideo;
      if (videoData) {
        return [this.createFile(
          videoData.id,
          videoData.title,
          videoData.videoUrl,
          {
            mediaType: 'video',
            muxPlaybackId: videoData.muxPlaybackId
          }
        )];
      }
      return [];
    }

    return [];
  }

  async getPresentations(folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const level = folder.providerData?.level;

    // For collection level, create a plan with all videos as presentations
    if (level === 'collection') {
      const collectionName = folder.providerData?.collectionName as string;
      const collection = this.data.collections.find(c => c.name === collectionName);
      if (!collection) return null;

      const allFiles: ContentFile[] = [];
      const presentations: PlanPresentation[] = collection.videos.map(video => {
        const file: ContentFile = {
          type: 'file',
          id: video.id,
          title: video.title,
          mediaType: 'video',
          url: video.videoUrl,
          image: video.thumbnailUrl,
          muxPlaybackId: video.muxPlaybackId
        };
        allFiles.push(file);

        return {
          id: video.id,
          name: video.title,
          actionType: 'play' as const,
          files: [file]
        };
      });

      return {
        id: this.slugify(collection.name),
        name: collection.name,
        image: collection.image || undefined,
        sections: [{
          id: 'videos',
          name: 'Videos',
          presentations
        }],
        allFiles
      };
    }

    // For lesson level (single video), create a simple plan
    if (level === 'lesson') {
      const videoData = folder.providerData?.videoData as BibleProjectVideo;
      if (!videoData) return null;

      const file: ContentFile = {
        type: 'file',
        id: videoData.id,
        title: videoData.title,
        mediaType: 'video',
        url: videoData.videoUrl,
        image: videoData.thumbnailUrl,
        muxPlaybackId: videoData.muxPlaybackId
      };

      return {
        id: videoData.id,
        name: videoData.title,
        image: videoData.thumbnailUrl,
        sections: [{
          id: 'main',
          name: 'Content',
          presentations: [{
            id: videoData.id,
            name: videoData.title,
            actionType: 'play',
            files: [file]
          }]
        }],
        allFiles: [file]
      };
    }

    return null;
  }

  override async getPlaylist(folder: ContentFolder, _auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const level = folder.providerData?.level;

    // For collection level, return all videos
    if (level === 'collection') {
      const collectionName = folder.providerData?.collectionName as string;
      const collection = this.data.collections.find(c => c.name === collectionName);
      if (!collection) return null;

      return collection.videos.map(video => ({
        type: 'file' as const,
        id: video.id,
        title: video.title,
        mediaType: 'video' as const,
        url: video.videoUrl,
        image: video.thumbnailUrl,
        muxPlaybackId: video.muxPlaybackId
      }));
    }

    // For lesson level, return the single video
    if (level === 'lesson') {
      const videoData = folder.providerData?.videoData as BibleProjectVideo;
      if (!videoData) return null;

      return [{
        type: 'file',
        id: videoData.id,
        title: videoData.title,
        mediaType: 'video',
        url: videoData.videoUrl,
        image: videoData.thumbnailUrl,
        muxPlaybackId: videoData.muxPlaybackId
      }];
    }

    return null;
  }

  private getLessonFolders(collectionName: string): ContentItem[] {
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return [];

    return collection.videos.map(video => this.createFolder(
      video.id,
      video.title,
      video.thumbnailUrl,
      {
        level: 'lesson',
        collectionName,
        videoData: video,
        isLeaf: true  // Mark as leaf so venue choice modal appears
      }
    ));
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
