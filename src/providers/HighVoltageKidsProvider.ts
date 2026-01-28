import { ContentProviderConfig, ContentProviderAuthData, ContentItem, ContentFolder, ProviderLogos, Plan, ProviderCapabilities, AuthType } from '../interfaces';
import { ContentProvider } from '../ContentProvider';

interface SeriesInfo {
  id: string;
  title: string;
  url: string;
  image?: string;
  category: string;
}

interface LessonInfo {
  id: string;
  title: string;
  url: string;
  image?: string;
  seriesId: string;
}

interface FileInfo {
  id: string;
  title: string;
  url: string;
  mediaType: 'video' | 'image';
  fileType?: string;
}

interface CacheData {
  seriesMap: Map<string, SeriesInfo[]>;
  lessonsMap: Map<string, LessonInfo[]>;
  filesMap: Map<string, FileInfo[]>;
  timestamp: number;
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

  // iMember360 Remote Authentication security code
  // This must be provided by the site owner from iMember360 Settings → Security → Security Codes
  private readonly I4W_SECURITY_CODE = ''; // TODO: Get from site owner

  private cache: CacheData | null = null;
  private readonly CACHE_TTL = 1000 * 60 * 60; // 1 hour

  override requiresAuth(): boolean {
    return true;
  }

  override getAuthTypes(): AuthType[] {
    return ['form_login'];
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

  /**
   * Get browser-like headers for HTTP requests
   */
  private getBrowserHeaders(options?: { referer?: string }): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };

    if (options?.referer) {
      headers['Referer'] = options.referer;
    }

    return headers;
  }

  /**
   * Perform login via iMember360 Remote Authentication API.
   * This requires the site owner to enable Remote Authentication and provide a security code.
   */
  async performLogin(username: string, password: string): Promise<ContentProviderAuthData | null> {
    try {
      console.log(`${this.id}: Attempting iMember360 remote auth for ${username}`);

      if (!this.I4W_SECURITY_CODE) {
        console.error(`${this.id}: iMember360 security code not configured. Contact the site owner.`);
        return null;
      }

      // Build the remote auth URL
      // Email addresses with + need to be URL-encoded as %2B
      const encodedUser = encodeURIComponent(username);
      const encodedPass = encodeURIComponent(password);
      const authUrl = `${this.config.apiBase}/?i4w_auth=${this.I4W_SECURITY_CODE}&user=${encodedUser}&pass=${encodedPass}&json=1`;

      console.log(`${this.id}: Calling iMember360 remote auth...`);

      const response = await fetch(authUrl, {
        method: 'GET',
        headers: this.getBrowserHeaders(),
        credentials: 'include'
      } as any);

      console.log(`${this.id}: Remote auth response status: ${response.status}`);

      if (!response.ok) {
        console.error(`${this.id}: Remote auth failed with status ${response.status}`);
        return null;
      }

      const responseText = await response.text();
      console.log(`${this.id}: Remote auth response: ${responseText.substring(0, 500)}`);

      // Try to parse as JSON
      let userData: Record<string, unknown> | null = null;
      try {
        userData = JSON.parse(responseText);
      } catch {
        // Response might be PHP serialized or indicate failure
        console.error(`${this.id}: Failed to parse response as JSON`);

        // Check for common error indicators
        if (responseText.includes('error') || responseText.includes('invalid') || responseText.includes('denied')) {
          console.error(`${this.id}: Authentication denied`);
          return null;
        }

        // If it's not JSON and not an error, it might be serialized PHP - try to extract basic info
        if (responseText.includes('Email') || responseText.includes('email')) {
          console.log(`${this.id}: Response appears to contain user data (non-JSON format)`);
          userData = { authenticated: true };
        }
      }

      if (!userData) {
        console.error(`${this.id}: No user data returned`);
        return null;
      }

      // Check for authentication failure indicators in the response
      if (userData.error || userData.success === false || userData.authenticated === false) {
        console.error(`${this.id}: Authentication failed:`, userData.error || 'Invalid credentials');
        return null;
      }

      console.log(`${this.id}: Remote auth successful!`);

      // Extract user tags if available (for determining content access)
      const userTags = userData.Tags || userData.tags || userData.ContactTags || [];
      console.log(`${this.id}: User tags:`, Array.isArray(userTags) ? userTags.length : 'none');

      // Store user data and tags in the auth token for later use
      const authData: ContentProviderAuthData = {
        access_token: JSON.stringify({
          authenticated: true,
          email: username,
          tags: userTags,
          userData: userData
        }),
        refresh_token: '',
        token_type: 'i4w_remote',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: 86400 * 30, // 30 days
        scope: ''
      };

      return authData;
    } catch (error) {
      console.error(`${this.id}: Remote auth error:`, error);
      return null;
    }
  }

  /**
   * Fetch a page. With iMember360 remote auth, we don't have session cookies,
   * so we rely on the membership-downloads page being publicly accessible
   * but showing different content based on tags (which we validate during login).
   *
   * Note: If the site requires cookie-based access to the downloads page,
   * the site owner may need to set up auto-login links or we may need to
   * reconsider the approach.
   */
  private async fetchWithAuth(url: string, auth: ContentProviderAuthData): Promise<string | null> {
    try {
      // Parse auth data to check if user is authenticated
      let authInfo: { authenticated?: boolean } = {};
      try {
        authInfo = JSON.parse(auth.access_token);
      } catch {
        // Not JSON, might be old format
      }

      if (!authInfo.authenticated) {
        console.log(`${this.id}: User not authenticated`);
        return null;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: this.getBrowserHeaders({ referer: this.config.apiBase }),
        credentials: 'include'
      } as any);

      // Check for Cloudflare errors
      if (response.status >= 520 && response.status <= 530) {
        console.error(`${this.id}: Cloudflare error fetching ${url}: ${response.status}`);
        return null;
      }

      // Check for auth expiration (redirect to login)
      const location = response.headers.get('location');
      if (location && location.includes('login')) {
        console.log(`${this.id}: Redirected to login - may need auto-login`);
        return null;
      }

      if (!response.ok && response.status !== 302) {
        console.error(`${this.id}: HTTP ${response.status} for ${url}`);
        return null;
      }

      return await response.text();
    } catch (error) {
      console.error(`${this.id}: Fetch error for ${url}:`, error);
      return null;
    }
  }

  async browse(folder?: ContentFolder | null, auth?: ContentProviderAuthData | null): Promise<ContentItem[]> {
    if (!auth) {
      console.log(`${this.id}: No auth provided, returning empty`);
      return [];
    }

    if (!folder) {
      // Root level - fetch and parse the membership-downloads page
      return this.getMembershipDownloadsContent(auth);
    }

    const level = folder.providerData?.level;
    switch (level) {
      case 'root':
        // Same as no folder - browse membership downloads
        return this.getMembershipDownloadsContent(auth);
      case 'category':
        return this.getSeriesForCategory(folder, auth);
      case 'series':
        return this.getLessonsForSeries(folder, auth);
      case 'lesson':
        return this.getFilesForLesson(folder, auth);
      default:
        // If we have a URL, try to parse it as a content page
        if (folder.providerData?.url) {
          return this.parseContentPage(folder, auth);
        }
        return [];
    }
  }

  /**
   * Fetch and parse the membership-downloads page to get the content structure
   */
  private async getMembershipDownloadsContent(auth: ContentProviderAuthData): Promise<ContentItem[]> {
    const url = `${this.config.apiBase}/membership-downloads/`;
    console.log(`${this.id}: Fetching membership downloads from ${url}`);

    const html = await this.fetchWithAuth(url, auth);
    if (!html) {
      console.log(`${this.id}: No HTML returned for membership-downloads`);
      return [];
    }

    console.log(`${this.id}: Got ${html.length} chars from membership-downloads`);

    // Check if this is a 404 or access denied page
    if (html.includes('404 Page') || html.includes('Page not found') || html.includes('do not access')) {
      console.log(`${this.id}: Membership downloads returned 404 or access denied`);
      return [];
    }

    // Parse the page content - look for links to content sections
    return this.parseMembershipDownloadsPage(html);
  }

  /**
   * Parse the membership downloads page to extract content links
   */
  private parseMembershipDownloadsPage(html: string): ContentItem[] {
    const items: ContentItem[] = [];
    const seen = new Set<string>();

    // Look for content links on the membership downloads page
    // These could be links to series, lessons, or download categories
    const patterns = [
      // Links with descriptive text
      /<a[^>]*href="([^"]*highvoltagekids\.com[^"]*)"[^>]*>[\s\S]*?<(?:h[1-6]|span|div)[^>]*>([^<]+)/gi,
      // Links with title attributes
      /<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"/gi,
      // Links followed by text
      /<a[^>]*href="([^"]+)"[^>]*>([^<]{3,100})</gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        let title = (match[2] || '').trim();

        // Clean up title
        title = title.replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-').replace(/\s+/g, ' ');

        if (!title || title.length < 3 || title.length > 100) continue;
        if (seen.has(url)) continue;

        // Skip non-content links
        if (url.includes('cart') || url.includes('checkout') || url.includes('account') ||
            url.includes('login') || url.includes('wp-admin') || url.includes('feed') ||
            url.includes('.css') || url.includes('.js') || url.includes('mailto:') ||
            url.includes('facebook') || url.includes('twitter') || url.includes('instagram')) continue;

        // Only include links that look like content
        const lowerUrl = url.toLowerCase();
        const lowerTitle = title.toLowerCase();
        if (lowerUrl.includes('download') || lowerUrl.includes('lesson') || lowerUrl.includes('series') ||
            lowerUrl.includes('power-pack') || lowerUrl.includes('curriculum') ||
            lowerTitle.includes('download') || lowerTitle.includes('lesson') || lowerTitle.includes('series') ||
            lowerTitle.includes('pack') || lowerTitle.includes('elementary') || lowerTitle.includes('preschool')) {

          seen.add(url);
          const fullUrl = url.startsWith('http') ? url : `${this.config.apiBase}${url}`;

          items.push(this.createFolder(
            this.slugify(title),
            title,
            undefined,
            { level: 'category', url: fullUrl }
          ));
        }
      }
    }

    console.log(`${this.id}: Parsed ${items.length} items from membership-downloads page`);
    return items;
  }

  /**
   * Parse a generic content page (for drilling down into content)
   */
  private async parseContentPage(folder: ContentFolder, auth: ContentProviderAuthData): Promise<ContentItem[]> {
    const url = folder.providerData?.url as string;
    if (!url) return [];

    console.log(`${this.id}: Parsing content page ${url}`);

    const html = await this.fetchWithAuth(url, auth);
    if (!html) return [];

    // Look for downloadable files first
    const files = this.parseFilesFromHtml(html);
    if (files.length > 0) {
      console.log(`${this.id}: Found ${files.length} files on page`);
      return files.map(f => this.createFile(f.id, f.title, f.url, { mediaType: f.mediaType }));
    }

    // Look for sub-pages/folders
    const subItems = this.parseMembershipDownloadsPage(html);
    if (subItems.length > 0) {
      console.log(`${this.id}: Found ${subItems.length} sub-items on page`);
      return subItems;
    }

    return [];
  }

  private getRootCategories(): ContentItem[] {
    // Return a single root that points to the membership-downloads page
    // The actual categories will be parsed from that page
    return [
      this.createFolder('membership-downloads', 'Membership Downloads', undefined, {
        level: 'root',
        url: `${this.config.apiBase}/membership-downloads/`
      })
    ];
  }

  private async getSeriesForCategory(folder: ContentFolder, auth: ContentProviderAuthData): Promise<ContentItem[]> {
    const category = folder.providerData?.category as string;
    const url = folder.providerData?.url as string || `${this.config.apiBase}/membership-downloads/`;

    // Check cache first
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      const cached = this.cache.seriesMap.get(category);
      if (cached) {
        return cached.map(series => this.createFolder(
          series.id,
          series.title,
          series.image,
          { level: 'series', seriesId: series.id, url: series.url, category }
        ));
      }
    }

    const html = await this.fetchWithAuth(url, auth);
    if (!html) return [];

    const series = this.parseSeriesFromHtml(html, category);

    // Update cache
    if (!this.cache) {
      this.cache = {
        seriesMap: new Map(),
        lessonsMap: new Map(),
        filesMap: new Map(),
        timestamp: Date.now()
      };
    }
    this.cache.seriesMap.set(category, series);
    this.cache.timestamp = Date.now();

    return series.map(s => this.createFolder(
      s.id,
      s.title,
      s.image,
      { level: 'series', seriesId: s.id, url: s.url, category }
    ));
  }

  private parseSeriesFromHtml(html: string, category: string): SeriesInfo[] {
    const series: SeriesInfo[] = [];
    const seen = new Set<string>();

    // WooCommerce product patterns
    const patterns = [
      // WooCommerce product with title in h2/h3
      /<li[^>]*class="[^"]*product[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*\/product\/[^"]*)"[^>]*>[\s\S]*?<(?:h2|h3)[^>]*class="[^"]*woocommerce-loop-product__title[^"]*"[^>]*>([^<]+)/gi,
      // Product links with image and title
      /<a[^>]*href="([^"]*\/product\/[^"]*)"[^>]*>[\s\S]*?<img[^>]*>[\s\S]*?<(?:h2|h3|span)[^>]*>([^<]+)/gi,
      // Standard product link patterns
      /<a[^>]*href="([^"]*\/product\/[^"]*)"[^>]*title="([^"]+)"/gi,
      // Product with data attributes
      /<a[^>]*data-product[^>]*href="([^"]+)"[^>]*>[\s\S]*?<(?:h2|h3|span)[^>]*>([^<]+)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        let title = (match[2] || '').trim();

        // Clean up title
        title = title.replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-');

        if (!title || title.length < 3) continue;
        if (seen.has(url)) continue;

        // Skip cart/checkout/account links
        if (url.includes('cart') || url.includes('checkout') || url.includes('account')) continue;

        seen.add(url);
        series.push({
          id: this.slugify(title),
          title: title,
          url: url.startsWith('http') ? url : `${this.config.apiBase}${url}`,
          category
        });
      }
    }

    // Also try to extract from JSON-LD structured data if present
    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (const jsonScript of jsonLdMatch) {
        try {
          const jsonContent = jsonScript.replace(/<script[^>]*>|<\/script>/gi, '');
          const data = JSON.parse(jsonContent);
          if (data['@type'] === 'ItemList' && data.itemListElement) {
            for (const item of data.itemListElement) {
              if (item.url && item.name && !seen.has(item.url)) {
                seen.add(item.url);
                series.push({
                  id: this.slugify(item.name),
                  title: item.name,
                  url: item.url,
                  image: item.image,
                  category
                });
              }
            }
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }

    // Extract images for series that don't have them
    for (const s of series) {
      if (!s.image) {
        // Look for image near the product link
        const escapedUrl = s.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const imgPatterns = [
          new RegExp(`<a[^>]*href="${escapedUrl}"[^>]*>[\\s\\S]*?<img[^>]*src="([^"]+)"`, 'i'),
          new RegExp(`<img[^>]*src="([^"]+)"[^>]*>[\\s\\S]*?<a[^>]*href="${escapedUrl}"`, 'i'),
        ];
        for (const imgPattern of imgPatterns) {
          const imgMatch = html.match(imgPattern);
          if (imgMatch) {
            s.image = imgMatch[1];
            break;
          }
        }
      }
    }

    console.log(`${this.id}: Parsed ${series.length} series from HTML`);
    return series;
  }

  private async getLessonsForSeries(folder: ContentFolder, auth: ContentProviderAuthData): Promise<ContentItem[]> {
    const seriesId = folder.providerData?.seriesId as string;
    const url = folder.providerData?.url as string;

    if (!url) return [];

    console.log(`${this.id}: Getting lessons for series ${seriesId} from ${url}`);

    // Check cache
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      const cached = this.cache.lessonsMap.get(seriesId);
      if (cached) {
        return cached.map(lesson => this.createFolder(
          lesson.id,
          lesson.title,
          lesson.image,
          { level: 'lesson', lessonId: lesson.id, url: lesson.url, seriesId }
        ));
      }
    }

    const html = await this.fetchWithAuth(url, auth);
    if (!html) {
      console.log(`${this.id}: No HTML returned for ${url}`);
      return [];
    }

    console.log(`${this.id}: Got HTML (${html.length} chars) for ${url}`);

    // For debugging - check if this is a product page or a download page
    const isProductPage = html.includes('product-type') || html.includes('single-product');
    const hasDownloadLinks = html.includes('.mp4') || html.includes('.mov') || html.includes('/download/');
    console.log(`${this.id}: isProductPage: ${isProductPage}, hasDownloadLinks: ${hasDownloadLinks}`);

    // If this is a product page with direct download links, return files instead of lessons
    if (isProductPage && hasDownloadLinks) {
      console.log(`${this.id}: Product page has downloads, extracting files directly`);
      const files = this.parseFilesFromHtml(html);
      if (files.length > 0) {
        return files.map(f => this.createFile(
          f.id,
          f.title,
          f.url,
          { mediaType: f.mediaType }
        ));
      }
    }

    const lessons = this.parseLessonsFromHtml(html, seriesId);

    // Update cache
    if (this.cache) {
      this.cache.lessonsMap.set(seriesId, lessons);
    }

    return lessons.map(l => this.createFolder(
      l.id,
      l.title,
      l.image,
      { level: 'lesson', lessonId: l.id, url: l.url, seriesId }
    ));
  }

  private parseLessonsFromHtml(html: string, seriesId: string): LessonInfo[] {
    const lessons: LessonInfo[] = [];
    const seen = new Set<string>();

    // Look for lesson/week links
    const patterns = [
      // Lesson links
      /<a[^>]*href="([^"]*)"[^>]*>[\s\S]*?(?:Lesson|Week)\s*(\d+)[^<]*/gi,
      // Numbered items
      /<a[^>]*href="([^"]*download[^"]*)"[^>]*>[\s\S]*?(\d+[^<]{0,30})</gi,
      // Any download links with titles
      /<a[^>]*href="([^"]*)"[^>]*class="[^"]*download[^"]*"[^>]*>([^<]+)</gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        let title = match[2]?.trim() || '';

        if (seen.has(url) || !url) continue;

        // Clean up title
        if (/^\d+$/.test(title)) {
          title = `Lesson ${title}`;
        }

        if (title.length < 2) continue;

        seen.add(url);
        lessons.push({
          id: this.slugify(title) || `lesson-${lessons.length + 1}`,
          title: title,
          url: url.startsWith('http') ? url : `${this.config.apiBase}${url}`,
          seriesId
        });
      }
    }

    // If no lessons found, try to find direct download files
    if (lessons.length === 0) {
      const files = this.parseFilesFromHtml(html);
      // Group files as a single "lesson"
      if (files.length > 0) {
        lessons.push({
          id: 'all-files',
          title: 'All Files',
          url: '', // Files are already parsed
          seriesId
        });
      }
    }

    return lessons;
  }

  private async getFilesForLesson(folder: ContentFolder, auth: ContentProviderAuthData): Promise<ContentItem[]> {
    const lessonId = folder.providerData?.lessonId as string;
    const url = folder.providerData?.url as string;

    if (!url) return [];

    // Check cache
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      const cached = this.cache.filesMap.get(lessonId);
      if (cached) {
        return cached.map(file => this.createFile(
          file.id,
          file.title,
          file.url,
          { mediaType: file.mediaType }
        ));
      }
    }

    const html = await this.fetchWithAuth(url, auth);
    if (!html) return [];

    const files = this.parseFilesFromHtml(html);

    // Update cache
    if (this.cache) {
      this.cache.filesMap.set(lessonId, files);
    }

    return files.map(f => this.createFile(
      f.id,
      f.title,
      f.url,
      { mediaType: f.mediaType }
    ));
  }

  private parseFilesFromHtml(html: string): FileInfo[] {
    const files: FileInfo[] = [];
    const seen = new Set<string>();

    // Video file patterns
    const videoPatterns = [
      /href="([^"]*\.(mp4|mov|m4v|webm))"[^>]*>([^<]*)/gi,
      /src="([^"]*\.(mp4|mov|m4v|webm))"/gi,
      // Vimeo embeds
      /(?:player\.)?vimeo\.com\/(?:video\/)?(\d+)/gi
    ];

    // Download link patterns (may include ZIPs with videos)
    const downloadPatterns = [
      /href="([^"]*download[^"]*\.(mp4|mov|zip|pdf))"[^>]*>([^<]*)/gi,
      /href="([^"]*\.(?:mp4|mov|zip|pdf))"[^>]*>([^<]*)/gi
    ];

    // Image patterns
    const imagePatterns = [
      /href="([^"]*\.(jpg|jpeg|png|gif|webp))"[^>]*>([^<]*)/gi
    ];

    // Extract videos
    for (const pattern of videoPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        const ext = match[2]?.toLowerCase();
        let title = match[3]?.trim() || this.extractFilename(url);

        if (seen.has(url)) continue;
        seen.add(url);

        // Handle Vimeo
        if (url.match(/^\d+$/)) {
          files.push({
            id: `vimeo-${url}`,
            title: `Video ${url}`,
            url: `https://player.vimeo.com/video/${url}`,
            mediaType: 'video',
            fileType: 'vimeo'
          });
          continue;
        }

        files.push({
          id: this.slugify(title) || `video-${files.length}`,
          title: title || 'Video',
          url: url.startsWith('http') ? url : `${this.config.apiBase}${url}`,
          mediaType: 'video',
          fileType: ext
        });
      }
    }

    // Extract downloads
    for (const pattern of downloadPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        const ext = match[2]?.toLowerCase();
        let title = match[3]?.trim() || this.extractFilename(url);

        if (seen.has(url)) continue;
        seen.add(url);

        // Determine media type
        const mediaType: 'video' | 'image' = ['mp4', 'mov', 'm4v', 'webm'].includes(ext) ? 'video' : 'image';

        files.push({
          id: this.slugify(title) || `file-${files.length}`,
          title: title || 'Download',
          url: url.startsWith('http') ? url : `${this.config.apiBase}${url}`,
          mediaType,
          fileType: ext
        });
      }
    }

    // Extract images
    for (const pattern of imagePatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        let title = match[3]?.trim() || this.extractFilename(url);

        if (seen.has(url)) continue;
        seen.add(url);

        files.push({
          id: this.slugify(title) || `image-${files.length}`,
          title: title || 'Image',
          url: url.startsWith('http') ? url : `${this.config.apiBase}${url}`,
          mediaType: 'image',
          fileType: match[2]?.toLowerCase()
        });
      }
    }

    return files;
  }

  private extractFilename(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').pop() || '';
      return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    } catch {
      return url.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async getPresentations(_folder: ContentFolder, _auth?: ContentProviderAuthData | null): Promise<Plan | null> {
    return null;
  }
}
