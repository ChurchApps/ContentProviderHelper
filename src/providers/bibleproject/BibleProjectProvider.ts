import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFile, ProviderLogos, Plan, PlanPresentation, ProviderCapabilities, IProvider, AuthType, Instructions, InstructionItem } from "../../interfaces";
import { createFile } from "../../utils";
import { parsePath } from "../../pathUtils";
import bibleProjectData from "./data.json";
import { BibleProjectData } from "./BibleProjectInterfaces";

/**
 * BibleProject Provider
 *
 * Path structure:
 *   /                              -> list collections
 *   /{collectionSlug}              -> list videos in collection
 *   /{collectionSlug}/{videoId}    -> single video
 */
export class BibleProjectProvider implements IProvider {
  readonly id = "bibleproject";
  readonly name = "The Bible Project";

  readonly logos: ProviderLogos = {
    light: "https://static.bibleproject.com/bp-web-components/v0.25.0/bibleproject-logo-mark.svg",
    dark: "https://static.bibleproject.com/bp-web-components/v0.25.0/bibleproject-logo-mark.svg"
  };

  readonly config: ContentProviderConfig = {
    id: "bibleproject",
    name: "The Bible Project",
    apiBase: "https://bibleproject.com",
    oauthBase: "",
    clientId: "",
    scopes: [],
    endpoints: {
      downloads: "/downloads/"
    }
  };

  private data: BibleProjectData = bibleProjectData;

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

    // /{collectionSlug} -> list videos in collection
    if (depth === 1) {
      const collectionSlug = segments[0];
      return this.getLessonFolders(collectionSlug, path!);
    }

    // /{collectionSlug}/{videoId} -> single video file
    if (depth === 2) {
      const collectionSlug = segments[0];
      const videoId = segments[1];
      return this.getVideoFile(collectionSlug, videoId);
    }

    return [];
  }

  private getCollections(): ContentItem[] {
    return this.data.collections
      .filter(collection => collection.videos.length > 0)
      .map(collection => ({
        type: "folder" as const,
        id: this.slugify(collection.name),
        title: collection.name,
        image: collection.image || undefined,
        path: `/${this.slugify(collection.name)}`
      }));
  }

  private getLessonFolders(collectionSlug: string, currentPath: string): ContentItem[] {
    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return [];

    return collection.videos.map(video => ({
      type: "folder" as const,
      id: video.id,
      title: video.title,
      image: video.thumbnailUrl,
      isLeaf: true,
      path: `${currentPath}/${video.id}`
    }));
  }

  private getVideoFile(collectionSlug: string, videoId: string): ContentItem[] {
    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return [];

    const video = collection.videos.find(v => v.id === videoId);
    if (!video) return [];

    return [createFile(video.id, video.title, video.videoUrl, { mediaType: "video", muxPlaybackId: video.muxPlaybackId })];
  }

  async getPresentations(path: string, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 1) return null;

    const collectionSlug = segments[0];
    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return null;

    // For collection level (depth 1), create a plan with all videos
    if (depth === 1) {
      const allFiles: ContentFile[] = [];
      const presentations: PlanPresentation[] = collection.videos.map(video => {
        const file: ContentFile = { type: "file", id: video.id, title: video.title, mediaType: "video", url: video.videoUrl, image: video.thumbnailUrl, muxPlaybackId: video.muxPlaybackId };
        allFiles.push(file);
        return { id: video.id, name: video.title, actionType: "play" as const, files: [file] };
      });

      return { id: this.slugify(collection.name), name: collection.name, image: collection.image || undefined, sections: [{ id: "videos", name: "Videos", presentations }], allFiles };
    }

    // For video level (depth 2, single video), create a simple plan
    if (depth === 2) {
      const videoId = segments[1];
      const video = collection.videos.find(v => v.id === videoId);
      if (!video) return null;

      const file: ContentFile = { type: "file", id: video.id, title: video.title, mediaType: "video", url: video.videoUrl, image: video.thumbnailUrl, muxPlaybackId: video.muxPlaybackId };
      return { id: video.id, name: video.title, image: video.thumbnailUrl, sections: [{ id: "main", name: "Content", presentations: [{ id: video.id, name: video.title, actionType: "play", files: [file] }] }], allFiles: [file] };
    }

    return null;
  }

  async getPlaylist(path: string, _auth?: ContentProviderAuthData | null, _resolution?: number): Promise<ContentFile[] | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 1) return null;

    const collectionSlug = segments[0];
    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return null;

    // For collection level, return all videos
    if (depth === 1) {
      return collection.videos.map(video => ({ type: "file" as const, id: video.id, title: video.title, mediaType: "video" as const, url: video.videoUrl, image: video.thumbnailUrl, muxPlaybackId: video.muxPlaybackId }));
    }

    // For video level, return the single video
    if (depth === 2) {
      const videoId = segments[1];
      const video = collection.videos.find(v => v.id === videoId);
      if (!video) return null;
      return [{ type: "file", id: video.id, title: video.title, mediaType: "video", url: video.videoUrl, image: video.thumbnailUrl, muxPlaybackId: video.muxPlaybackId }];
    }

    return null;
  }

  async getInstructions(path: string, _auth?: ContentProviderAuthData | null): Promise<Instructions | null> {
    const { segments, depth } = parsePath(path);

    if (depth < 1) return null;

    const collectionSlug = segments[0];
    const collection = this.data.collections.find(c => this.slugify(c.name) === collectionSlug);
    if (!collection) return null;

    // For collection level (depth 1), create instructions with all videos
    if (depth === 1) {
      const fileItems: InstructionItem[] = collection.videos.map(video => ({
        id: video.id,
        itemType: "file",
        label: video.title,
        embedUrl: video.videoUrl
      }));

      return {
        venueName: collection.name,
        items: [{
          id: this.slugify(collection.name),
          itemType: "section",
          label: "Videos",
          children: fileItems
        }]
      };
    }

    // For video level (depth 2), create instructions for single video
    if (depth === 2) {
      const videoId = segments[1];
      const video = collection.videos.find(v => v.id === videoId);
      if (!video) return null;

      return {
        venueName: video.title,
        items: [{
          id: "main",
          itemType: "section",
          label: "Content",
          children: [{
            id: video.id,
            itemType: "file",
            label: video.title,
            embedUrl: video.videoUrl
          }]
        }]
      };
    }

    return null;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  supportsDeviceFlow(): boolean {
    return false;
  }
}
