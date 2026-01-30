import { ContentFolder, ContentFile } from './interfaces';

export function detectMediaType(url: string, explicitType?: string): 'video' | 'image' {
  if (explicitType === 'video') return 'video';
  const videoPatterns = ['.mp4', '.webm', '.m3u8', '.mov', 'stream.mux.com'];
  return videoPatterns.some(p => url.includes(p)) ? 'video' : 'image';
}

export function createFolder(id: string, title: string, image?: string, providerData?: Record<string, unknown>, isLeaf?: boolean): ContentFolder {
  return { type: 'folder', id, title, image, isLeaf, providerData };
}

export function createFile(id: string, title: string, url: string, options?: { mediaType?: 'video' | 'image'; image?: string; muxPlaybackId?: string; providerData?: Record<string, unknown>; }): ContentFile {
  return { type: 'file', id, title, url, mediaType: options?.mediaType ?? detectMediaType(url), image: options?.image, muxPlaybackId: options?.muxPlaybackId, providerData: options?.providerData };
}
