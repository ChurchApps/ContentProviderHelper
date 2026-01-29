export function detectMediaType(url: string, explicitType?: string): 'video' | 'image' {
  if (explicitType === 'video') return 'video';
  const videoPatterns = ['.mp4', '.webm', '.m3u8', '.mov', 'stream.mux.com'];
  return videoPatterns.some(p => url.includes(p)) ? 'video' : 'image';
}
