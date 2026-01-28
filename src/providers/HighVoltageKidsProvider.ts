import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ProviderLogos, Plan, ProviderCapabilities } from '../interfaces';
import { ContentProvider } from '../ContentProvider';
import highVoltageData from './highvoltage/data.json';

interface LessonFolder {
  id: string;
  name: string;
  image: string;
  files: unknown[];
}

interface StudyFolder {
  id: string;
  name: string;
  image: string;
  description: string;
  url: string;
  lessonCount: number;
  lessons: LessonFolder[];
}

interface Collection {
  name: string;
  folders: StudyFolder[];
}

interface HighVoltageData {
  collections: Collection[];
}

export class HighVoltageKidsProvider extends ContentProvider {
  readonly id = 'highvoltagekids';
  readonly name = 'High Voltage Kids';

  readonly logos: ProviderLogos = {
    light: 'https://highvoltagekids.com/wp-content/uploads/2023/10/logo-300x300-1.webp',
    dark: 'https://highvoltagekids.com/wp-content/uploads/2023/10/logo-300x300-1.webp'
  };

  readonly config: ContentProviderConfig = {
    id: 'highvoltagekids',
    name: 'High Voltage Kids',
    apiBase: 'https://highvoltagekids.com',
    oauthBase: '',
    clientId: '',
    scopes: [],
    endpoints: {
      downloads: '/membership-downloads/'
    }
  };

  private data: HighVoltageData = highVoltageData;

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
      // Return top-level collection folders (Elementary, Preschool)
      return this.data.collections
        .filter(collection => collection.folders.length > 0)
        .map(collection => this.createFolder(
          this.slugify(collection.name),
          collection.name,
          undefined,
          { level: 'collection', collectionName: collection.name }
        ));
    }

    const level = folder.providerData?.level;
    const collectionName = folder.providerData?.collectionName as string;

    if (level === 'collection') {
      // Return study folders for this collection (Elementary or Preschool)
      return this.getStudyFolders(collectionName);
    }

    if (level === 'study') {
      // Return lesson folders for this study
      const studyData = folder.providerData?.studyData as StudyFolder;
      if (studyData) {
        return this.getLessonFolders(studyData);
      }
      return [];
    }

    if (level === 'lesson') {
      // Return files for this lesson (empty for now)
      return [];
    }

    return [];
  }

  async getPresentations(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    return null;
  }

  private getStudyFolders(collectionName: string): ContentItem[] {
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return [];

    return collection.folders.map(study => this.createFolder(
      study.id,
      study.name,
      study.image || undefined,
      {
        level: 'study',
        collectionName,
        studyData: study
      }
    ));
  }

  private getLessonFolders(study: StudyFolder): ContentItem[] {
    return study.lessons.map(lesson => this.createFolder(
      lesson.id,
      lesson.name,
      lesson.image || undefined,
      {
        level: 'lesson',
        studyId: study.id,
        lessonData: lesson
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
