import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ProviderLogos, Plan, ProviderCapabilities } from '../../interfaces';
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
      presentations: false,
      playlist: false,
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

  async getPresentations(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
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
        videoData: video
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
