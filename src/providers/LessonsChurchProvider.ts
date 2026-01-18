import {
  ContentProviderConfig,
  ContentProviderAuthData,
  ContentItem,
  ContentFolder,
  ContentFile,
  ProviderLogos,
} from '../interfaces';
import { ContentProvider } from '../ContentProvider';

/**
 * Lessons.church content provider.
 *
 * Five-tier hierarchy (no authentication required):
 * - Level 0: Programs → Folders
 * - Level 1: Studies → Folders
 * - Level 2: Lessons → Folders
 * - Level 3: Venues → Folders (selecting fetches playlist)
 * - Level 4: Playlist Messages → Files
 */
export class LessonsChurchProvider extends ContentProvider {
  readonly id = 'lessonschurch';
  readonly name = 'Lessons.church';

  readonly logos: ProviderLogos = {
    light: 'https://lessons.church/images/logo.png',
    dark: 'https://lessons.church/images/logo-dark.png',
  };

  readonly config: ContentProviderConfig = {
    id: 'lessonschurch',
    name: 'Lessons.church',
    apiBase: 'https://api.lessons.church',
    // No OAuth needed - public API
    oauthBase: '',
    clientId: '',
    scopes: [],
    endpoints: {
      programs: '/programs/public',
      studies: (programId: string) => `/studies/public/program/${programId}`,
      lessons: (studyId: string) => `/lessons/public/study/${studyId}`,
      venues: (lessonId: string) => `/venues/public/lesson/${lessonId}`,
      playlist: (venueId: string) => `/venues/playlist/${venueId}`,
    },
  };

  /**
   * This provider doesn't require authentication.
   */
  override requiresAuth(): boolean {
    return false;
  }

  /**
   * Override to make anonymous requests (no auth headers needed).
   */
  protected override async apiRequest<T>(path: string): Promise<T | null> {
    try {
      const url = `${this.config.apiBase}${path}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Get root content (programs as folders).
   */
  async getRootContents(): Promise<ContentItem[]> {
    const path = this.config.endpoints.programs as string;
    const response = await this.apiRequest<Record<string, unknown>[]>(path);
    if (!response) return [];

    const programs = Array.isArray(response) ? response : [];

    return programs.map((p) => ({
      type: 'folder' as const,
      id: p.id as string,
      title: p.name as string,
      image: p.image as string | undefined,
      providerData: {
        level: 'studies',
        programId: p.id,
      },
    }));
  }

  /**
   * Get folder contents based on navigation level.
   * @param folder - The folder to get contents for
   * @param _auth - Not used (public API)
   * @param resolution - Optional resolution for playlist (720 or 1080)
   */
  async getFolderContents(
    folder: ContentFolder,
    _auth?: ContentProviderAuthData | null,
    resolution?: number
  ): Promise<ContentItem[]> {
    const level = folder.providerData?.level;

    switch (level) {
      case 'studies':
        return this.getStudies(folder);
      case 'lessons':
        return this.getLessons(folder);
      case 'venues':
        return this.getVenues(folder);
      case 'playlist':
        return this.getPlaylistFiles(folder, resolution);
      default:
        return [];
    }
  }

  /**
   * Fetch studies for a program.
   */
  private async getStudies(folder: ContentFolder): Promise<ContentItem[]> {
    const programId = folder.providerData?.programId as string | undefined;
    if (!programId) return [];

    const pathFn = this.config.endpoints.studies as (id: string) => string;
    const path = pathFn(programId);
    const response = await this.apiRequest<Record<string, unknown>[]>(path);
    if (!response) return [];

    const studies = Array.isArray(response) ? response : [];

    return studies.map((s) => ({
      type: 'folder' as const,
      id: s.id as string,
      title: s.name as string,
      image: s.image as string | undefined,
      providerData: {
        level: 'lessons',
        studyId: s.id,
      },
    }));
  }

  /**
   * Fetch lessons for a study.
   */
  private async getLessons(folder: ContentFolder): Promise<ContentItem[]> {
    const studyId = folder.providerData?.studyId as string | undefined;
    if (!studyId) return [];

    const pathFn = this.config.endpoints.lessons as (id: string) => string;
    const path = pathFn(studyId);
    const response = await this.apiRequest<Record<string, unknown>[]>(path);
    if (!response) return [];

    const lessons = Array.isArray(response) ? response : [];

    return lessons.map((l) => ({
      type: 'folder' as const,
      id: l.id as string,
      title: (l.name || l.title) as string,
      image: l.image as string | undefined,
      providerData: {
        level: 'venues',
        lessonId: l.id,
        lessonImage: l.image,
      },
    }));
  }

  /**
   * Fetch venues for a lesson.
   */
  private async getVenues(folder: ContentFolder): Promise<ContentItem[]> {
    const lessonId = folder.providerData?.lessonId as string | undefined;
    if (!lessonId) return [];

    const pathFn = this.config.endpoints.venues as (id: string) => string;
    const path = pathFn(lessonId);
    const response = await this.apiRequest<Record<string, unknown>[]>(path);
    if (!response) return [];

    const venues = Array.isArray(response) ? response : [];

    return venues.map((v) => ({
      type: 'folder' as const,
      id: v.id as string,
      title: v.name as string,
      image: folder.providerData?.lessonImage as string | undefined,
      providerData: {
        level: 'playlist',
        venueId: v.id,
      },
    }));
  }

  /**
   * Fetch playlist files for a venue.
   * @param folder - The venue folder
   * @param resolution - Optional resolution (720 or 1080)
   */
  private async getPlaylistFiles(folder: ContentFolder, resolution?: number): Promise<ContentItem[]> {
    const venueId = folder.providerData?.venueId as string | undefined;
    if (!venueId) return [];

    let path = `/venues/playlist/${venueId}`;
    if (resolution) {
      path += `?resolution=${resolution}`;
    }

    const response = await this.apiRequest<Record<string, unknown>>(path);
    if (!response) return [];

    const files: ContentFile[] = [];

    // Playlist contains messages, each message contains files
    const messages = (response.messages || []) as Record<string, unknown>[];
    for (const msg of messages) {
      const msgFiles = (msg.files || []) as Record<string, unknown>[];
      for (const f of msgFiles) {
        if (!f.url) continue;

        const url = f.url as string;
        const isVideo =
          f.fileType === 'video' ||
          url.includes('.mp4') ||
          url.includes('.webm') ||
          url.includes('.m3u8');

        files.push({
          type: 'file',
          id: f.id as string,
          title: (f.name || msg.name) as string,
          mediaType: isVideo ? 'video' : 'image',
          thumbnail: response.lessonImage as string | undefined,
          url,
          providerData: {
            seconds: f.seconds,
            loop: f.loop,
            loopVideo: f.loopVideo,
          },
        });
      }
    }

    return files;
  }
}
