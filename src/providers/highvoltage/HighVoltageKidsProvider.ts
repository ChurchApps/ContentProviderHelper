import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, ProviderCapabilities, Instructions, InstructionItem, IProvider, AuthType } from '../../interfaces';
import { createFile } from '../../utils';
import { parsePath } from '../../pathUtils';
import highVoltageData from './data.json';
import { HighVoltageData } from './HighVoltageKidsInterfaces';

/**
 * HighVoltageKids Provider
 *
 * Path structure:
 *   /collections                                       -> list collections (Elementary, Preschool)
 *   /collections/{collectionName}                      -> list studies
 *   /collections/{collectionName}/{studyId}            -> list lessons
 *   /collections/{collectionName}/{studyId}/{lessonId} -> lesson files (leaf)
 */
export class HighVoltageKidsProvider implements IProvider {
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

  readonly requiresAuth = false;
  readonly authTypes: AuthType[] = ['none'];
  readonly capabilities: ProviderCapabilities = {
    browse: true,
    presentations: true,
    playlist: true,
    instructions: false,
    expandedInstructions: true,
    mediaLicensing: false
  };

  async browse(path?: string | null, _auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);

    if (depth === 0) {
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

    // /collections/{collectionName} -> list studies
    if (depth === 2) {
      const collectionName = decodeURIComponent(segments[1]);
      return this.getStudyFolders(collectionName, path!);
    }

    // /collections/{collectionName}/{studyId} -> list lessons
    if (depth === 3) {
      const collectionName = decodeURIComponent(segments[1]);
      const studyId = segments[2];
      return this.getLessonFolders(collectionName, studyId, path!);
    }

    // /collections/{collectionName}/{studyId}/{lessonId} -> lesson files
    if (depth === 4) {
      const collectionName = decodeURIComponent(segments[1]);
      const studyId = segments[2];
      const lessonId = segments[3];
      return this.getLessonFiles(collectionName, studyId, lessonId);
    }

    return [];
  }

  private getCollections(): ContentItem[] {
    return this.data.collections
      .filter(collection => collection.folders.length > 0)
      .map(collection => ({
        type: 'folder' as const,
        id: this.slugify(collection.name),
        title: collection.name,
        path: `/collections/${encodeURIComponent(collection.name)}`
      }));
  }

  private getStudyFolders(collectionName: string, currentPath: string): ContentItem[] {
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return [];

    return collection.folders.map(study => ({
      type: 'folder' as const,
      id: study.id,
      title: study.name,
      image: study.image || undefined,
      path: `${currentPath}/${study.id}`,
      providerData: { studyData: study }
    }));
  }

  private getLessonFolders(collectionName: string, studyId: string, currentPath: string): ContentItem[] {
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return [];

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return [];

    return study.lessons.map(lesson => ({
      type: 'folder' as const,
      id: lesson.id,
      title: lesson.name,
      image: lesson.image || undefined,
      isLeaf: true,
      path: `${currentPath}/${lesson.id}`,
      providerData: { lessonData: lesson, studyName: study.name }
    }));
  }

  private getLessonFiles(collectionName: string, studyId: string, lessonId: string): ContentItem[] {
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return [];

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return [];

    const lesson = study.lessons.find(l => l.id === lessonId);
    if (!lesson?.files) return [];

    return lesson.files.map(file => createFile(file.id, file.title, file.url, { mediaType: file.mediaType as 'video' | 'image' }));
  }

  async getPresentations(path: string, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 3 || segments[0] !== 'collections') return null;

    const collectionName = decodeURIComponent(segments[1]);
    const studyId = segments[2];

    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return null;

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return null;

    // For study level (depth 3), create a plan with lessons as sections
    if (depth === 3) {
      const allFiles: ContentFile[] = [];
      const sections: PlanSection[] = study.lessons.map(lesson => {
        const files: ContentFile[] = lesson.files.map(file => {
          const contentFile: ContentFile = { type: 'file', id: file.id, title: file.title, mediaType: file.mediaType as 'video' | 'image', url: file.url, image: lesson.image };
          allFiles.push(contentFile);
          return contentFile;
        });
        const presentation: PlanPresentation = { id: lesson.id, name: lesson.name, actionType: 'play', files };
        return { id: lesson.id, name: lesson.name, presentations: [presentation] };
      });

      return { id: study.id, name: study.name, description: study.description, image: study.image, sections, allFiles };
    }

    // For lesson level (depth 4), create a simple plan with one section
    if (depth === 4) {
      const lessonId = segments[3];
      const lesson = study.lessons.find(l => l.id === lessonId);
      if (!lesson?.files) return null;

      const files: ContentFile[] = lesson.files.map(file => ({ type: 'file' as const, id: file.id, title: file.title, mediaType: file.mediaType as 'video' | 'image', url: file.url, image: lesson.image }));
      const presentation: PlanPresentation = { id: lesson.id, name: lesson.name, actionType: 'play', files };
      return { id: lesson.id, name: lesson.name, image: lesson.image, sections: [{ id: 'main', name: 'Content', presentations: [presentation] }], allFiles: files };
    }

    return null;
  }

  async getPlaylist(path: string, _auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 3 || segments[0] !== 'collections') return null;

    const collectionName = decodeURIComponent(segments[1]);
    const studyId = segments[2];

    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return null;

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return null;

    // For study level, return all files from all lessons
    if (depth === 3) {
      const allFiles: ContentFile[] = [];
      for (const lesson of study.lessons) {
        for (const file of lesson.files) {
          allFiles.push({ type: 'file', id: file.id, title: file.title, mediaType: file.mediaType as 'video' | 'image', url: file.url, image: lesson.image });
        }
      }
      return allFiles;
    }

    // For lesson level, return the files directly
    if (depth === 4) {
      const lessonId = segments[3];
      const lesson = study.lessons.find(l => l.id === lessonId);
      if (!lesson?.files) return null;
      return lesson.files.map(file => ({ type: 'file' as const, id: file.id, title: file.title, mediaType: file.mediaType as 'video' | 'image', url: file.url, image: lesson.image }));
    }

    return null;
  }

  async getExpandedInstructions(path: string, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 3 || segments[0] !== 'collections') return null;

    const collectionName = decodeURIComponent(segments[1]);
    const studyId = segments[2];

    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return null;

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return null;

    // For study level
    if (depth === 3) {
      const lessonItems: InstructionItem[] = study.lessons.map(lesson => {
        const fileItems: InstructionItem[] = lesson.files.map(file => ({ id: file.id, itemType: 'file', label: file.title, embedUrl: file.url }));
        return { id: lesson.id, itemType: 'action', label: lesson.name, description: 'play', children: fileItems };
      });

      return { venueName: study.name, items: [{ id: study.id, itemType: 'header', label: study.name, children: [{ id: 'main', itemType: 'section', label: 'Content', children: lessonItems }] }] };
    }

    // For lesson level
    if (depth === 4) {
      const lessonId = segments[3];
      const lesson = study.lessons.find(l => l.id === lessonId);
      if (!lesson?.files) return null;

      const headerLabel = `${study.name} - ${lesson.name}`;
      const fileItems: InstructionItem[] = lesson.files.map(file => ({ id: file.id, itemType: 'file', label: file.title, embedUrl: file.url }));
      return { venueName: lesson.name, items: [{ id: lesson.id, itemType: 'header', label: headerLabel, children: [{ id: 'main', itemType: 'section', label: 'Content', children: [{ id: lesson.id + '-action', itemType: 'action', label: lesson.name, description: 'play', children: fileItems }] }] }] };
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
