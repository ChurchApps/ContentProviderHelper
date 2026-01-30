import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, ProviderCapabilities, Instructions, InstructionItem, IProvider, AuthType } from '../../interfaces';
import { createFolder, createFile } from '../../utils';
import highVoltageData from './data.json';

interface LessonFileJson {
  type: string;
  id: string;
  title: string;
  mediaType: string;
  url: string;
}

interface LessonFolder {
  id: string;
  name: string;
  image: string;
  files: LessonFileJson[];
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

  async browse(folder?: ContentFolder | null, _auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!folder) {
      // Return top-level collection folders (Elementary, Preschool)
      return this.data.collections
        .filter(collection => collection.folders.length > 0)
        .map(collection => createFolder(
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
      const lessonData = folder.providerData?.lessonData as LessonFolder;
      if (lessonData?.files) {
        return lessonData.files.map(file => createFile(
          file.id,
          file.title,
          file.url,
          { mediaType: file.mediaType as 'video' | 'image' }
        ));
      }
      return [];
    }

    return [];
  }

  async getPresentations(folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const level = folder.providerData?.level;

    // Handle leaf folders (e.g., from plan association) - look up lesson by ID
    if (folder.isLeaf) {
      const lessonId = folder.providerData?.venueId as string || folder.id;
      const found = this.findLessonById(lessonId);
      if (!found) return null;

      const lessonData = found.lesson;
      const files: ContentFile[] = lessonData.files.map(file => ({
        type: 'file' as const,
        id: file.id,
        title: file.title,
        mediaType: file.mediaType as 'video' | 'image',
        url: file.url,
        image: lessonData.image
      }));

      const presentation: PlanPresentation = {
        id: lessonData.id,
        name: lessonData.name,
        actionType: 'play',
        files
      };

      return {
        id: lessonData.id,
        name: lessonData.name,
        image: lessonData.image,
        sections: [{
          id: 'main',
          name: 'Content',
          presentations: [presentation]
        }],
        allFiles: files
      };
    }

    // For study level, create a plan with lessons as sections
    if (level === 'study') {
      const studyData = folder.providerData?.studyData as StudyFolder;
      if (!studyData) return null;

      const allFiles: ContentFile[] = [];
      const sections: PlanSection[] = studyData.lessons.map(lesson => {
        const files: ContentFile[] = lesson.files.map(file => {
          const contentFile: ContentFile = {
            type: 'file',
            id: file.id,
            title: file.title,
            mediaType: file.mediaType as 'video' | 'image',
            url: file.url,
            image: lesson.image
          };
          allFiles.push(contentFile);
          return contentFile;
        });

        const presentation: PlanPresentation = {
          id: lesson.id,
          name: lesson.name,
          actionType: 'play',
          files
        };

        return {
          id: lesson.id,
          name: lesson.name,
          presentations: [presentation]
        };
      });

      return {
        id: studyData.id,
        name: studyData.name,
        description: studyData.description,
        image: studyData.image,
        sections,
        allFiles
      };
    }

    // For lesson level, create a simple plan with one section
    if (level === 'lesson') {
      const lessonData = folder.providerData?.lessonData as LessonFolder;
      if (!lessonData?.files) return null;

      const files: ContentFile[] = lessonData.files.map(file => ({
        type: 'file' as const,
        id: file.id,
        title: file.title,
        mediaType: file.mediaType as 'video' | 'image',
        url: file.url,
        image: lessonData.image
      }));

      const presentation: PlanPresentation = {
        id: lessonData.id,
        name: lessonData.name,
        actionType: 'play',
        files
      };

      return {
        id: lessonData.id,
        name: lessonData.name,
        image: lessonData.image,
        sections: [{
          id: 'main',
          name: 'Content',
          presentations: [presentation]
        }],
        allFiles: files
      };
    }

    return null;
  }

  async getPlaylist(folder: ContentFolder, _auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const level = folder.providerData?.level;

    // Handle leaf folders (e.g., from plan association) - look up lesson by ID
    if (folder.isLeaf && level !== 'lesson' && level !== 'study') {
      const lessonId = folder.providerData?.venueId as string || folder.id;
      const found = this.findLessonById(lessonId);
      if (!found) return null;

      const lessonData = found.lesson;
      return lessonData.files.map(file => ({
        type: 'file' as const,
        id: file.id,
        title: file.title,
        mediaType: file.mediaType as 'video' | 'image',
        url: file.url,
        image: lessonData.image
      }));
    }

    // For lesson level, return the files directly
    if (level === 'lesson') {
      const lessonData = folder.providerData?.lessonData as LessonFolder;
      if (!lessonData?.files) return null;

      return lessonData.files.map(file => ({
        type: 'file' as const,
        id: file.id,
        title: file.title,
        mediaType: file.mediaType as 'video' | 'image',
        url: file.url,
        image: lessonData.image
      }));
    }

    // For study level, return all files from all lessons
    if (level === 'study') {
      const studyData = folder.providerData?.studyData as StudyFolder;
      if (!studyData) return null;

      const allFiles: ContentFile[] = [];
      for (const lesson of studyData.lessons) {
        for (const file of lesson.files) {
          allFiles.push({
            type: 'file',
            id: file.id,
            title: file.title,
            mediaType: file.mediaType as 'video' | 'image',
            url: file.url,
            image: lesson.image
          });
        }
      }
      return allFiles;
    }

    return null;
  }

  private findLessonById(lessonId: string): { lesson: LessonFolder; studyName: string } | null {
    for (const collection of this.data.collections) {
      for (const study of collection.folders) {
        for (const lesson of study.lessons) {
          if (lesson.id === lessonId) {
            return { lesson, studyName: study.name };
          }
        }
      }
    }
    return null;
  }

  async getExpandedInstructions(folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const level = folder.providerData?.level;

    // Handle leaf folders (e.g., from plan association) - look up lesson by ID
    if (folder.isLeaf && level !== 'lesson' && level !== 'study') {
      const lessonId = folder.providerData?.venueId as string || folder.id;
      const found = this.findLessonById(lessonId);
      if (!found) return null;

      const { lesson: lessonData, studyName } = found;
      const headerLabel = `${studyName} - ${lessonData.name}`;

      const fileItems: InstructionItem[] = lessonData.files.map(file => ({
        id: file.id,
        itemType: 'file',
        label: file.title,
        embedUrl: file.url
      }));

      return {
        venueName: lessonData.name,
        items: [{
          id: lessonData.id,
          itemType: 'header',
          label: headerLabel,
          children: [{
            id: 'main',
            itemType: 'section',
            label: 'Content',
            children: [{
              id: lessonData.id + '-action',
              itemType: 'action',
              label: lessonData.name,
              description: 'play',
              children: fileItems
            }]
          }]
        }]
      };
    }

    if (level === 'lesson') {
      const lessonData = folder.providerData?.lessonData as LessonFolder;
      const studyName = folder.providerData?.studyName as string;
      if (!lessonData?.files) return null;

      const headerLabel = studyName ? `${studyName} - ${lessonData.name}` : lessonData.name;

      const fileItems: InstructionItem[] = lessonData.files.map(file => ({
        id: file.id,
        itemType: 'file',
        label: file.title,
        embedUrl: file.url
      }));

      return {
        venueName: lessonData.name,
        items: [{
          id: lessonData.id,
          itemType: 'header',
          label: headerLabel,
          children: [{
            id: 'main',
            itemType: 'section',
            label: 'Content',
            children: [{
              id: lessonData.id + '-action',
              itemType: 'action',
              label: lessonData.name,
              description: 'play',
              children: fileItems
            }]
          }]
        }]
      };
    }

    if (level === 'study') {
      const studyData = folder.providerData?.studyData as StudyFolder;
      if (!studyData) return null;

      const lessonItems: InstructionItem[] = studyData.lessons.map(lesson => {
        const fileItems: InstructionItem[] = lesson.files.map(file => ({
          id: file.id,
          itemType: 'file',
          label: file.title,
          embedUrl: file.url
        }));

        return {
          id: lesson.id,
          itemType: 'action',
          label: lesson.name,
          description: 'play',
          children: fileItems
        };
      });

      return {
        venueName: studyData.name,
        items: [{
          id: studyData.id,
          itemType: 'header',
          label: studyData.name,
          children: [{
            id: 'main',
            itemType: 'section',
            label: 'Content',
            children: lessonItems
          }]
        }]
      };
    }

    return null;
  }

  private getStudyFolders(collectionName: string): ContentItem[] {
    const collection = this.data.collections.find(c => c.name === collectionName);
    if (!collection) return [];

    return collection.folders.map(study => createFolder(
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
    return study.lessons.map(lesson => createFolder(
      lesson.id,
      lesson.name,
      lesson.image || undefined,
      {
        level: 'lesson',
        studyId: study.id,
        studyName: study.name,
        lessonData: lesson
      },
      true  // isLeaf: Mark as leaf so venue choice modal appears
    ));
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
