import { google, searchconsole_v1, webmasters_v3 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

type SearchanalyticsQueryRequest =
  webmasters_v3.Params$Resource$Searchanalytics$Query['requestBody'];
type ListSitemapsRequest = webmasters_v3.Params$Resource$Sitemaps$List;
type GetSitemapRequest = webmasters_v3.Params$Resource$Sitemaps$Get;
type SubmitSitemapRequest = webmasters_v3.Params$Resource$Sitemaps$Submit;
type IndexInspectRequest =
  searchconsole_v1.Params$Resource$Urlinspection$Index$Inspect['requestBody'];

export class SearchConsoleService {
  private auth: GoogleAuth;

  constructor(credentials: string) {
    this.auth = new google.auth.GoogleAuth({
      keyFile: credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
  }

  private async getWebmasters() {
    const authClient = await this.auth.getClient();
    return google.webmasters({
      version: 'v3',
      auth: authClient,
    } as webmasters_v3.Options);
  }

  private async getSearchConsole() {
    const authClient = await this.auth.getClient();
    return google.searchconsole({
      version: 'v1',
      auth: authClient,
    } as searchconsole_v1.Options);
  }

  private normalizeUrl(url: string): string {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return `sc-domain:${parsedUrl.hostname}`;
    }
    return `https://${url}`;
  }

  private async handlePermissionError<T>(
    operation: () => Promise<T>,
    fallbackOperation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes('permission')) {
        return await fallbackOperation();
      }
      throw err;
    }
  }

  async searchAnalytics(siteUrl: string, requestBody: SearchanalyticsQueryRequest) {
    const webmasters = await this.getWebmasters();
    return this.handlePermissionError(
      () => webmasters.searchanalytics.query({ siteUrl, requestBody }),
      () => webmasters.searchanalytics.query({ siteUrl: this.normalizeUrl(siteUrl), requestBody }),
    );
  }

  /**
   * Enhanced Search Analytics with advanced features
   * - Supports up to 25,000 rows (vs 1,000 default)
   * - Regex filtering capabilities
   * - Quick wins detection
   */
  async enhancedSearchAnalytics(
    siteUrl: string, 
    requestBody: SearchanalyticsQueryRequest,
    options: {
      regexFilter?: string;
      enableQuickWins?: boolean;
      quickWinsThresholds?: {
        minImpressions?: number;
        maxCtr?: number;
        positionRangeMin?: number;
        positionRangeMax?: number;
      };
    } = {}
  ) {
    // Ensure requestBody is defined
    if (!requestBody) {
      throw new Error('Request body is required');
    }

    // Apply regex filter if provided
    if (options.regexFilter && requestBody.dimensions?.includes('query')) {
      requestBody.dimensionFilterGroups = [
        ...(requestBody.dimensionFilterGroups || []),
        {
          groupType: 'and',
          filters: [{
            dimension: 'query',
            operator: 'includingRegex',
            expression: options.regexFilter
          }]
        }
      ];
    }

    // Execute enhanced search analytics
    const result = await this.searchAnalytics(siteUrl, requestBody);
    
    // Apply quick wins detection if enabled
    if (options.enableQuickWins && result.data.rows) {
      const quickWins = this.detectQuickWins(result.data.rows, options.quickWinsThresholds);
      return {
        ...result,
        data: {
          ...result.data,
          quickWins: quickWins,
          enhancedFeatures: {
            regexFilterApplied: !!options.regexFilter,
            quickWinsEnabled: true,
            rowLimit: requestBody.rowLimit || 1000
          }
        }
      };
    }

    return result;
  }

  /**
   * Automatic Quick Wins Detection
   * Identifies SEO optimization opportunities
   */
  private detectQuickWins(
    rows: any[], 
    thresholds: {
      minImpressions?: number;
      maxCtr?: number;
      positionRangeMin?: number;
      positionRangeMax?: number;
    } = {}
  ) {
    const {
      minImpressions = 50,
      maxCtr = 2.0,
      positionRangeMin = 4,
      positionRangeMax = 10
    } = thresholds;

    return rows
      .filter(row => {
        const impressions = row.impressions || 0;
        const ctr = (row.ctr || 0) * 100;
        const position = row.position || 0;

        return impressions >= minImpressions &&
               ctr <= maxCtr &&
               position >= positionRangeMin &&
               position <= positionRangeMax;
      })
      .map(row => {
        const impressions = row.impressions || 0;
        const currentClicks = row.clicks || 0;
        const currentCtr = (row.ctr || 0) * 100;
        const position = row.position || 0;

        // Calculate potential with 5% target CTR
        const targetCtr = 5.0;
        const potentialClicks = Math.round((impressions * targetCtr) / 100);
        const additionalClicks = Math.max(0, potentialClicks - currentClicks);

        return {
          query: row.keys?.[0] || 'N/A',
          page: row.keys?.[1] || 'N/A',
          currentPosition: Number(position.toFixed(1)),
          impressions: impressions,
          currentClicks: currentClicks,
          currentCtr: Number(currentCtr.toFixed(2)),
          potentialClicks: potentialClicks,
          additionalClicks: additionalClicks,
          opportunity: additionalClicks > 0 ? 'High' : 'Low',
          optimizationNote: `Move from position ${position.toFixed(1)} to improve CTR`
        };
      })
      .sort((a, b) => b.additionalClicks - a.additionalClicks);
  }

  async listSites() {
    const webmasters = await this.getWebmasters();
    return webmasters.sites.list();
  }

  async listSitemaps(requestBody: ListSitemapsRequest) {
    const webmasters = await this.getWebmasters();
    return this.handlePermissionError(
      () => webmasters.sitemaps.list(requestBody),
      () =>
        webmasters.sitemaps.list({
          ...requestBody,
          siteUrl: this.normalizeUrl(requestBody.siteUrl!),
        }),
    );
  }

  async getSitemap(requestBody: GetSitemapRequest) {
    const webmasters = await this.getWebmasters();
    return this.handlePermissionError(
      () => webmasters.sitemaps.get(requestBody),
      () =>
        webmasters.sitemaps.get({
          ...requestBody,
          siteUrl: this.normalizeUrl(requestBody.siteUrl!),
        }),
    );
  }

  async submitSitemap(requestBody: SubmitSitemapRequest) {
    const webmasters = await this.getWebmasters();
    return this.handlePermissionError(
      () => webmasters.sitemaps.submit(requestBody),
      () =>
        webmasters.sitemaps.submit({
          ...requestBody,
          siteUrl: this.normalizeUrl(requestBody.siteUrl!),
        }),
    );
  }

  async indexInspect(requestBody: IndexInspectRequest) {
    const searchConsole = await this.getSearchConsole();
    return searchConsole.urlInspection.index.inspect({ requestBody });
  }
}
