import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ProviderLogos, Plan, ProviderCapabilities } from '../interfaces';
import { ContentProvider } from '../ContentProvider';

interface BibleProjectVideo {
  id: string;
  title: string;
  videoUrl: string;
  muxPlaybackId: string;
  thumbnailUrl?: string;
}

interface CacheData {
  collections: Map<string, BibleProjectVideo[]>;
  timestamp: number;
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

  private cache: CacheData | null = null;
  private readonly CACHE_TTL = 1000 * 60 * 60; // 1 hour

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
    const collections = await this.ensureDataLoaded();

    if (!folder) {
      // Return top-level collection folders
      // Filter out "Sermon on the Mount Visual Commentaries" (it's a subfolder) and empty collections
      const topLevelCollections = Array.from(collections.keys()).filter(
        name => name !== 'Sermon on the Mount Visual Commentaries' && (collections.get(name)?.length ?? 0) > 0
      );

      return topLevelCollections.map(name => this.createFolder(
        this.slugify(name),
        name,
        this.getCollectionImage(name),
        { level: 'collection', collectionName: name }
      ));
    }

    const level = folder.providerData?.level;
    const collectionName = folder.providerData?.collectionName as string;

    if (level === 'collection') {
      // Handle Sermon on the Mount special case (two sub-folders)
      if (collectionName === 'Sermon on the Mount') {
        return [
          this.createFolder('sotm-videos', 'Videos', this.getCollectionImage('Sermon on the Mount'), {
            level: 'videos',
            collectionName: 'Sermon on the Mount'
          }),
          this.createFolder('sotm-visual', 'Visual Commentaries', this.getCollectionImage('Sermon on the Mount Visual Commentaries'), {
            level: 'videos',
            collectionName: 'Sermon on the Mount Visual Commentaries'
          })
        ];
      }

      // Return lesson folders (one per video) for all collections
      return this.getLessonFolders(collections, collectionName);
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
            image: videoData.thumbnailUrl,
            muxPlaybackId: videoData.muxPlaybackId
          }
        )];
      }
      return [];
    }

    if (level === 'videos') {
      // Sermon on the Mount sub-folders also use lesson folders
      return this.getLessonFolders(collections, collectionName);
    }

    return [];
  }

  async getPresentations(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    return null;
  }

  private async ensureDataLoaded(): Promise<Map<string, BibleProjectVideo[]>> {
    const now = Date.now();
    if (this.cache && (now - this.cache.timestamp) < this.CACHE_TTL) {
      return this.cache.collections;
    }

    const html = await this.fetchDownloadsPage();
    const collections = this.parseVideosFromHtml(html);

    this.cache = {
      collections,
      timestamp: now
    };

    return collections;
  }

  private async fetchDownloadsPage(): Promise<string> {
    try {
      const response = await fetch('https://bibleproject.com/downloads/', {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; ContentProviderHelper/1.0)'
        }
      });

      if (!response.ok) {
        console.error(`BibleProject: Failed to fetch downloads page: ${response.status}`);
        return '';
      }

      return await response.text();
    } catch (error) {
      console.error('BibleProject: Error fetching downloads page:', error);
      return '';
    }
  }

  private parseVideosFromHtml(html: string): Map<string, BibleProjectVideo[]> {
    const collections = new Map<string, BibleProjectVideo[]>();

    if (!html) {
      console.log('BibleProject: No HTML content received');
      return collections;
    }

    console.log(`BibleProject: Received HTML content, length: ${html.length}`);

    // Define collection patterns to search for
    const collectionPatterns = [
      { name: 'Old Testament Overviews', pattern: /Old Testament Overviews/i },
      { name: 'New Testament Overviews', pattern: /New Testament Overviews/i },
      { name: 'Biblical Themes', pattern: /Biblical Themes/i },
      { name: 'Sermon on the Mount', pattern: /Sermon on the Mount(?! Visual)/i },
      { name: 'Sermon on the Mount Visual Commentaries', pattern: /Sermon on the Mount Visual Commentaries/i },
      { name: 'How to Read the Bible', pattern: /How to Read the Bible/i },
      { name: 'Insights', pattern: /Insights/i },
      { name: 'Spiritual Beings', pattern: /Spiritual Beings/i },
      { name: 'Royal Priesthood', pattern: /Royal Priesthood/i },
      { name: 'Creation', pattern: /Creation/i },
      { name: 'Character of God', pattern: /Character of God/i },
      { name: 'Word Studies', pattern: /Word Studies/i },
      { name: 'Advent', pattern: /Advent/i },
      { name: 'Luke-Acts', pattern: /Luke-Acts/i },
      { name: 'Wisdom', pattern: /Wisdom/i },
      { name: 'The Shema', pattern: /The Shema|Shema/i },
      { name: 'Torah', pattern: /Torah/i },
      { name: 'Deuterocanon', pattern: /Deuterocanon|Apocrypha/i },
      { name: 'Family of God', pattern: /Family of God/i },
      { name: 'Heaven and Earth', pattern: /Heaven and Earth/i },
      { name: 'Paradigm', pattern: /Paradigm/i }
    ];

    // Initialize collections
    for (const col of collectionPatterns) {
      collections.set(col.name, []);
    }

    // Try multiple regex patterns to handle different HTML encodings
    // Pattern handles both & and &amp; for the separator
    const patterns = [
      // Pattern 1: &amp; separator (HTML entity)
      /href="\/d\/\?url=(https%3A%2F%2Fstream\.mux\.com%2F([A-Za-z0-9]+)%2Fhigh\.mp4)[^"]*&amp;filename=([^"]+)\.mp4"/g,
      // Pattern 2: & separator (plain)
      /href="\/d\/\?url=(https%3A%2F%2Fstream\.mux\.com%2F([A-Za-z0-9]+)%2Fhigh\.mp4)[^"]*&filename=([^"]+)\.mp4"/g,
      // Pattern 3: More flexible - any mux URL pattern
      /href="[^"]*url=(https%3A%2F%2Fstream\.mux\.com%2F([A-Za-z0-9]+)[^"]*high\.mp4)[^"]*filename=([^"&]+)\.mp4"/g,
      // Pattern 4: Direct mux URLs (not encoded)
      /href="[^"]*(https:\/\/stream\.mux\.com\/([A-Za-z0-9]+)\/high\.mp4)[^"]*"/g
    ];

    // Try each pattern until we find videos
    for (const linkRegex of patterns) {
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        const matchIndex = match.index;
        const encodedUrl = match[1];
        const muxId = match[2];
        const filename = match[3] || muxId; // fallback to muxId if no filename

        // Decode the URL
        const videoUrl = decodeURIComponent(encodedUrl);
        const title = this.filenameToTitle(filename);
        const id = `bp-${muxId.substring(0, 8)}`;

        // Find poster/thumbnail URL near this video link (within next 500 chars)
        const thumbnailUrl = this.findPosterUrl(html, matchIndex);

        // Categorize based on filename
        const collectionName = this.categorizeByFilename(filename.toLowerCase());
        const videos = collections.get(collectionName) || [];

        if (!videos.some(v => v.muxPlaybackId === muxId)) {
          videos.push({
            id,
            title,
            videoUrl,
            muxPlaybackId: muxId,
            thumbnailUrl
          });
          collections.set(collectionName, videos);
        }
      }

      if (this.getTotalVideoCount(collections) > 0) {
        console.log(`BibleProject: Found ${this.getTotalVideoCount(collections)} videos using pattern`);
        break;
      }
    }

    // If still no videos, log for debugging
    if (this.getTotalVideoCount(collections) === 0) {
      console.log('BibleProject: No videos found with standard patterns, trying fallback');
      // Check if we can find any mux references at all
      const muxCheck = html.match(/stream\.mux\.com/g);
      console.log(`BibleProject: Found ${muxCheck?.length || 0} mux.com references in HTML`);

      // Try a very permissive pattern
      const permissivePattern = /stream\.mux\.com[/%]([A-Za-z0-9]+)/g;
      let match;
      const foundIds = new Set<string>();
      while ((match = permissivePattern.exec(html)) !== null) {
        foundIds.add(match[1]);
      }
      console.log(`BibleProject: Found ${foundIds.size} unique Mux IDs with permissive pattern`);

      // Extract videos using permissive approach
      for (const muxId of foundIds) {
        if (muxId.length < 10) continue; // Skip very short IDs

        const videoUrl = `https://stream.mux.com/${muxId}/high.mp4`;
        const id = `bp-${muxId.substring(0, 8)}`;

        // Try to find associated filename and position in HTML
        const muxPattern = new RegExp(`${muxId}[^"]*filename=([^"&]+)\\.mp4`, 'i');
        const filenameMatch = html.match(muxPattern);
        const filename = filenameMatch ? filenameMatch[1] : muxId;
        const title = this.filenameToTitle(filename);

        // Find position of this mux ID to search for nearby poster
        const muxPosition = html.indexOf(muxId);
        const thumbnailUrl = muxPosition >= 0 ? this.findPosterUrl(html, muxPosition) : undefined;

        const collectionName = this.categorizeByFilename(filename.toLowerCase());
        const videos = collections.get(collectionName) || [];

        if (!videos.some(v => v.muxPlaybackId === muxId)) {
          videos.push({
            id,
            title,
            videoUrl,
            muxPlaybackId: muxId,
            thumbnailUrl
          });
          collections.set(collectionName, videos);
        }
      }
    }

    console.log(`BibleProject: Final video count: ${this.getTotalVideoCount(collections)}`);
    for (const [name, videos] of collections) {
      if (videos.length > 0) {
        console.log(`BibleProject: ${name}: ${videos.length} videos`);
      }
    }

    return collections;
  }

  private findPosterUrl(html: string, startPosition: number): string | undefined {
    // Look for CloudFront poster URL within the next 1000 characters after the video link
    // Poster URLs are on d1bsmz3sdihplr.cloudfront.net/media/Posters Download/ or Posters%20Download
    const searchWindow = html.substring(startPosition, startPosition + 1000);

    // Try multiple patterns for poster URLs
    const posterPatterns = [
      // URL-encoded space
      /href="(https:\/\/d1bsmz3sdihplr\.cloudfront\.net\/media\/Posters%20Download\/[^"]+\.jpg)"/i,
      // Regular space (might be in some HTML)
      /href="(https:\/\/d1bsmz3sdihplr\.cloudfront\.net\/media\/Posters Download\/[^"]+\.jpg)"/i,
      // Any cloudfront image
      /(https:\/\/d1bsmz3sdihplr\.cloudfront\.net\/media\/[^"]+\.jpg)/i,
      // ImageKit thumbnail as fallback
      /(https:\/\/ik\.imagekit\.io\/bpweb1[^"'\s]+\.jpg)/i
    ];

    for (const pattern of posterPatterns) {
      const match = searchWindow.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  private categorizeByFilename(filename: string): string {
    // Sermon on the Mount (check first due to specificity)
    if (filename.includes('sotm') || filename.includes('sermon-on-the-mount') || filename.includes('beatitudes')) {
      if (filename.includes('visual') || filename.includes('vc-')) {
        return 'Sermon on the Mount Visual Commentaries';
      }
      return 'Sermon on the Mount';
    }

    // How to Read the Bible
    if (filename.includes('how-to-read') || filename.includes('httr') || filename.includes('literary-styles') ||
        filename.includes('plot') || filename.includes('setting') || filename.includes('character-in-biblical') ||
        filename.includes('design-patterns') || filename.includes('metaphor') || filename.includes('poetry')) {
      return 'How to Read the Bible';
    }

    // Luke-Acts (check before NT to avoid conflicts)
    if (filename.includes('luke-acts') || filename.includes('lukeacts')) {
      return 'Luke-Acts';
    }

    // Spiritual Beings
    if (filename.includes('spiritual-beings') || filename.includes('angels') || filename.includes('cherubim') ||
        filename.includes('seraphim') || filename.includes('divine-council') || filename.includes('satan') ||
        filename.includes('demons') || filename.includes('the-satan')) {
      return 'Spiritual Beings';
    }

    // Royal Priesthood
    if (filename.includes('royal-priesthood') || filename.includes('priest')) {
      return 'Royal Priesthood';
    }

    // Creation
    if (filename.includes('creation') && !filename.includes('new-creation')) {
      return 'Creation';
    }

    // Character of God
    if (filename.includes('character-of-god') || filename.includes('slow-to-anger') ||
        filename.includes('compassionate') || filename.includes('gracious')) {
      return 'Character of God';
    }

    // Word Studies
    if (filename.includes('word-study') || filename.includes('word-studies')) {
      return 'Word Studies';
    }

    // Advent
    if (filename.includes('advent')) {
      return 'Advent';
    }

    // Wisdom Series
    if (filename.includes('wisdom-series') || (filename.includes('wisdom') && !filename.includes('proverbs'))) {
      return 'Wisdom';
    }

    // The Shema
    if (filename.includes('shema')) {
      return 'The Shema';
    }

    // Torah Series
    if (filename.includes('torah-series') || filename.includes('torah')) {
      return 'Torah';
    }

    // Deuterocanon / Apocrypha
    if (filename.includes('deuterocanon') || filename.includes('apocrypha') || filename.includes('tobit') ||
        filename.includes('judith') || filename.includes('maccabees') || filename.includes('sirach') ||
        filename.includes('baruch') || filename.includes('wisdom-of-solomon')) {
      return 'Deuterocanon';
    }

    // Family of God
    if (filename.includes('family-of-god') || filename.includes('son-of-god') || filename.includes('image-of-god')) {
      return 'Family of God';
    }

    // Heaven and Earth
    if (filename.includes('heaven-and-earth') || filename.includes('heaven-earth')) {
      return 'Heaven and Earth';
    }

    // Paradigm
    if (filename.includes('paradigm')) {
      return 'Paradigm';
    }

    // Old Testament Overviews
    if (filename.includes('ot-') || filename.includes('genesis') || filename.includes('exodus') ||
        filename.includes('leviticus') || filename.includes('numbers') || filename.includes('deuteronomy') ||
        filename.includes('joshua') || filename.includes('judges') || filename.includes('ruth') ||
        filename.includes('samuel') || filename.includes('kings') || filename.includes('chronicles') ||
        filename.includes('ezra') || filename.includes('nehemiah') || filename.includes('esther') ||
        filename.includes('job') || filename.includes('psalm') || filename.includes('proverbs') ||
        filename.includes('ecclesiastes') || filename.includes('song-of') || filename.includes('isaiah') ||
        filename.includes('jeremiah') || filename.includes('lamentations') || filename.includes('ezekiel') ||
        filename.includes('daniel') || filename.includes('hosea') || filename.includes('joel') ||
        filename.includes('amos') || filename.includes('obadiah') || filename.includes('jonah') ||
        filename.includes('micah') || filename.includes('nahum') || filename.includes('habakkuk') ||
        filename.includes('zephaniah') || filename.includes('haggai') || filename.includes('zechariah') ||
        filename.includes('malachi')) {
      return 'Old Testament Overviews';
    }

    // New Testament Overviews
    if (filename.includes('nt-') || filename.includes('matthew') || filename.includes('mark') ||
        filename.includes('luke') || filename.includes('john') || filename.includes('acts') ||
        filename.includes('romans') || filename.includes('corinthians') || filename.includes('galatians') ||
        filename.includes('ephesians') || filename.includes('philippians') || filename.includes('colossians') ||
        filename.includes('thessalonians') || filename.includes('timothy') || filename.includes('titus') ||
        filename.includes('philemon') || filename.includes('hebrews') || filename.includes('james') ||
        filename.includes('peter') || filename.includes('jude') || filename.includes('revelation')) {
      return 'New Testament Overviews';
    }

    // Default to Biblical Themes
    return 'Biblical Themes';
  }

  private filenameToTitle(filename: string): string {
    // Convert filename like "genesis-1-11" to "Genesis 1-11"
    return filename
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  private getTotalVideoCount(collections: Map<string, BibleProjectVideo[]>): number {
    let total = 0;
    for (const videos of collections.values()) {
      total += videos.length;
    }
    return total;
  }

  private getLessonFolders(
    collections: Map<string, BibleProjectVideo[]>,
    collectionName: string
  ): ContentItem[] {
    const videos = collections.get(collectionName) || [];

    return videos.map(video => this.createFolder(
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

  private getCollectionImage(collectionName: string): string | undefined {
    const images: Record<string, string> = {
      'Old Testament Overviews': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/old-testament-overviews/tr:q-65,w-300/ot-overviews_16.9.jpg',
      'New Testament Overviews': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/new-testament-overviews/tr:q-65,w-300/nt-overviews_16.9.jpg',
      'Biblical Themes': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/themes/tr:q-65,w-300/themes_16.9.jpg',
      'Sermon on the Mount': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/sermon-on-the-mount/tr:q-65,w-300/sotm_16.9.jpg',
      'Sermon on the Mount Visual Commentaries': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/sermon-on-the-mount-visual-commentaries/tr:q-65,w-300/sotm-vc_16.9.jpg',
      'How to Read the Bible': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/how-to-read-the-bible/tr:q-65,w-300/httr_16.9.jpg',
      'Insights': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/insights/tr:q-65,w-300/insights_16.9.jpg',
      'Spiritual Beings': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/spiritual-beings/tr:q-65,w-300/spiritual-beings_16.9.jpg',
      'Royal Priesthood': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/royal-priesthood/tr:q-65,w-300/royal-priesthood_16.9.jpg',
      'Creation': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/creation/tr:q-65,w-300/creation_16.9.jpg',
      'Character of God': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/character-of-god/tr:q-65,w-300/character-of-god_16.9.jpg',
      'Word Studies': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/word-studies/tr:q-65,w-300/word-studies_16.9.jpg',
      'Advent': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/advent/tr:q-65,w-300/advent_16.9.jpg',
      'Luke-Acts': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/luke-acts/tr:q-65,w-300/luke-acts_16.9.jpg',
      'Wisdom': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/wisdom/tr:q-65,w-300/wisdom_16.9.jpg',
      'The Shema': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/shema/tr:q-65,w-300/shema_16.9.jpg',
      'Torah': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/torah/tr:q-65,w-300/torah_16.9.jpg',
      'Deuterocanon': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/deuterocanon/tr:q-65,w-300/deuterocanon_16.9.jpg',
      'Family of God': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/family-of-god/tr:q-65,w-300/family-of-god_16.9.jpg',
      'Heaven and Earth': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/heaven-and-earth/tr:q-65,w-300/heaven-and-earth_16.9.jpg',
      'Paradigm': 'https://ik.imagekit.io/bpweb1/web/media/video-collection-images/paradigm/tr:q-65,w-300/paradigm_16.9.jpg'
    };
    return images[collectionName];
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
