import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanSection, PlanPresentation, ProviderCapabilities, Instructions, InstructionItem, IProvider, AuthType } from "../../interfaces";
import { createFile } from "../../utils";
import { parsePath } from "../../pathUtils";
import { estimateDuration } from "../../durationUtils";
import highVoltageData from "./data.json";
import { HighVoltageData, LessonFileJson } from "./HighVoltageKidsInterfaces";

/**
 * HighVoltageKids Provider
 *
 * Path structure:
 *   /                                          -> list collections (Elementary, Preschool)
 *   /{collectionSlug}                          -> list studies
 *   /{collectionSlug}/{studyId}                -> list lessons
 *   /{collectionSlug}/{studyId}/{lessonId}     -> lesson files (leaf)
 */
export class HighVoltageKidsProvider implements IProvider {
  readonly id = "highvoltagekids";
  readonly name = "High Voltage Kids";

  readonly logos: ProviderLogos = {
    light: "https://highvoltagekids.com/wp-content/uploads/2023/10/logo-300x300-1.webp",
    dark: "https://highvoltagekids.com/wp-content/uploads/2023/10/logo-300x300-1.webp"
  };

  readonly config: ContentProviderConfig = {
    id: "highvoltagekids",
    name: "High Voltage Kids",
    apiBase: "https://highvoltagekids.com",
    oauthBase: "",
    clientId: "",
    scopes: [],
    endpoints: {
      downloads: "/membership-downloads/"
    }
  };

  private data: HighVoltageData = highVoltageData;

  readonly requiresAuth = false;
  readonly authTypes: AuthType[] = ["none"];
  readonly capabilities: ProviderCapabilities = {
    browse: true,
    presentations: true,
    playlist: true,
    instructions: true,
    mediaLicensing: false
  };

  async browse(path?: string | null, _auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    const { segments, depth } = parsePath(path);

    // / -> list all collections
    if (depth === 0) {
      return this.getCollections();
    }

    // /{collectionSlug} -> list studies
    if (depth === 1) {
      const collectionSlug = segments[0];
      return this.getStudyFolders(collectionSlug, path!);
    }

    // /{collectionSlug}/{studyId} -> list lessons
    if (depth === 2) {
      const collectionSlug = segments[0];
      const studyId = segments[1];
      return this.getLessonFolders(collectionSlug, studyId, path!);
    }

    // /{collectionSlug}/{studyId}/{lessonId} -> lesson files
    if (depth === 3) {
      const collectionSlug = segments[0];
      const studyId = segments[1];
      const lessonId = segments[2];
      return this.getLessonFiles(collectionSlug, studyId, lessonId);
    }

    return [];
  }

  private getCollections(): ContentItem[] {
    return this.data.collections
      .filter(collection => collection.folders.length > 0)
      .map(collection => ({
        type: "folder" as const,
        id: this.slugify(collection.name),
        title: collection.name,
        path: `/${this.slugify(collection.name)}`
      }));
  }

  private getStudyFolders(collectionSlug: string, currentPath: string): ContentItem[] {
    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return [];

    return collection.folders.map(study => ({
      type: "folder" as const,
      id: study.id,
      title: study.name,
      image: study.image || undefined,
      path: `${currentPath}/${study.id}`
    }));
  }

  private getLessonFolders(collectionSlug: string, studyId: string, currentPath: string): ContentItem[] {
    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return [];

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return [];

    return study.lessons.map(lesson => ({
      type: "folder" as const,
      id: lesson.id,
      title: lesson.name,
      image: lesson.image || undefined,
      isLeaf: true,
      path: `${currentPath}/${lesson.id}`
    }));
  }

  private getLessonFiles(collectionSlug: string, studyId: string, lessonId: string): ContentItem[] {
    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return [];

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return [];

    const lesson = study.lessons.find(l => l.id === lessonId);
    if (!lesson?.files) return [];

    return lesson.files.map(file => createFile(file.id, file.title, file.url, { mediaType: file.mediaType as "video" | "image" }));
  }

  async getPresentations(path: string, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 2) return null;

    const collectionSlug = segments[0];
    const studyId = segments[1];

    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return null;

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return null;

    // For study level (depth 2), create a plan with lessons as sections
    if (depth === 2) {
      const allFiles: ContentFile[] = [];
      const sections: PlanSection[] = study.lessons.map(lesson => {
        const files: ContentFile[] = lesson.files.map(file => {
          const contentFile: ContentFile = { type: "file", id: file.id, title: file.title, mediaType: file.mediaType as "video" | "image", url: file.url, image: lesson.image };
          allFiles.push(contentFile);
          return contentFile;
        });
        const presentation: PlanPresentation = { id: lesson.id, name: lesson.name, actionType: "play", files };
        return { id: lesson.id, name: lesson.name, presentations: [presentation] };
      });

      return { id: study.id, name: study.name, description: study.description, image: study.image, sections, allFiles };
    }

    // For lesson level (depth 3), create a simple plan with one section
    if (depth === 3) {
      const lessonId = segments[2];
      const lesson = study.lessons.find(l => l.id === lessonId);
      if (!lesson?.files) return null;

      const files: ContentFile[] = lesson.files.map(file => ({ type: "file" as const, id: file.id, title: file.title, mediaType: file.mediaType as "video" | "image", url: file.url, image: lesson.image }));
      const presentation: PlanPresentation = { id: lesson.id, name: lesson.name, actionType: "play", files };
      return { id: lesson.id, name: lesson.name, image: lesson.image, sections: [{ id: "main", name: "Content", presentations: [presentation] }], allFiles: files };
    }

    return null;
  }

  async getPlaylist(path: string, _auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 2) return null;

    const collectionSlug = segments[0];
    const studyId = segments[1];

    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return null;

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return null;

    // For study level, return all files from all lessons
    if (depth === 2) {
      const allFiles: ContentFile[] = [];
      for (const lesson of study.lessons) {
        for (const file of lesson.files) {
          allFiles.push({ type: "file", id: file.id, title: file.title, mediaType: file.mediaType as "video" | "image", url: file.url, image: lesson.image });
        }
      }
      return allFiles;
    }

    // For lesson level, return the files directly
    if (depth === 3) {
      const lessonId = segments[2];
      const lesson = study.lessons.find(l => l.id === lessonId);
      if (!lesson?.files) return null;
      return lesson.files.map(file => ({ type: "file" as const, id: file.id, title: file.title, mediaType: file.mediaType as "video" | "image", url: file.url, image: lesson.image }));
    }

    return null;
  }

  async getInstructions(path: string, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 2) return null;

    const collectionSlug = segments[0];
    const studyId = segments[1];

    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return null;

    const study = collection.folders.find(s => s.id === studyId);
    if (!study) return null;

    // For study level
    if (depth === 2) {
      const lessonItems: InstructionItem[] = study.lessons.map(lesson => {
        const fileItems: InstructionItem[] = lesson.files.map(file => {
          const seconds = estimateDuration(file.mediaType as "video" | "image");
          return { id: file.id, itemType: "file", label: file.title, seconds, embedUrl: file.url };
        });
        return { id: lesson.id, itemType: "action", label: lesson.name, description: "play", children: fileItems };
      });

      return { venueName: study.name, items: [{ id: study.id, itemType: "header", label: study.name, children: [{ id: "main", itemType: "section", label: "Content", children: lessonItems }] }] };
    }

    // For lesson level
    if (depth === 3) {
      const lessonId = segments[2];
      const lesson = study.lessons.find(l => l.id === lessonId);
      if (!lesson?.files) return null;

      const headerLabel = `${study.name} - ${lesson.name}`;
      const actionItems = this.groupFilesIntoActions(lesson.files);
      return { venueName: lesson.name, items: [{ id: lesson.id, itemType: "header", label: headerLabel, children: [{ id: "main", itemType: "section", label: lesson.name, children: actionItems }] }] };
    }

    return null;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private groupFilesIntoActions(files: LessonFileJson[]): InstructionItem[] {
    // Group only consecutive files with the same base name
    const actionItems: InstructionItem[] = [];
    let currentGroup: LessonFileJson[] = [];
    let currentBaseName: string | null = null;

    const flushGroup = () => {
      if (currentGroup.length === 0) return;
      const children: InstructionItem[] = currentGroup.map(file => {
        const seconds = estimateDuration(file.mediaType as "video" | "image");
        return {
          id: file.id,
          itemType: "file" as const,
          label: file.title,
          seconds,
          embedUrl: file.url
        };
      });
      // Use base name as label only if multiple files were grouped
      const label = (currentGroup.length > 1 && currentBaseName) ? currentBaseName : currentGroup[0].title;
      actionItems.push({
        id: currentGroup[0].id + "-action",
        itemType: "action",
        label,
        description: "play",
        children
      });
      currentGroup = [];
      currentBaseName = null;
    };

    for (const file of files) {
      const baseName = this.getBaseName(file.title);
      const isNumbered = baseName !== file.title;

      if (isNumbered && baseName === currentBaseName) {
        // Continue the current group
        currentGroup.push(file);
      } else {
        // Flush previous group and start a new one
        flushGroup();
        currentGroup = [file];
        currentBaseName = isNumbered ? baseName : null;
      }
    }
    flushGroup();

    return actionItems;
  }

  private getBaseName(title: string): string {
    // Remove trailing number (e.g., "Call to Action - Point 1" -> "Call to Action - Point")
    const match = title.match(/^(.+?)\s*\d+$/);
    return match ? match[1].trim() : title;
  }
}
