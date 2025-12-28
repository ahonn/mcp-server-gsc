import { google, searchconsole_v1, webmasters_v3 } from 'googleapis';
import { GoogleAuth, AuthClient } from 'google-auth-library';
import { QuickWinsThresholds } from './schemas.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Row data from Search Analytics API response
 */
export interface SearchAnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

/**
 * Quick win opportunity identified from search data
 */
export interface QuickWin {
  query: string;
  page: string;
  currentPosition: number;
  impressions: number;
  currentClicks: number;
  currentCtr: number;
  potentialClicks: number;
  additionalClicks: number;
  estimatedValue: number;
  opportunity: 'High' | 'Medium' | 'Low';
  recommendation: string;
}

/**
 * Enhanced search analytics response with quick wins
 */
export interface EnhancedSearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: string;
  quickWins?: QuickWin[];
  metadata?: {
    regexFilterApplied: boolean;
    quickWinsEnabled: boolean;
    rowLimit: number;
    totalRows: number;
  };
}

/**
 * Options for enhanced search analytics
 */
export interface EnhancedSearchAnalyticsOptions {
  regexFilter?: string;
  enableQuickWins?: boolean;
  quickWinsThresholds?: Partial<QuickWinsThresholds>;
}

type SearchAnalyticsQueryRequest = webmasters_v3.Params$Resource$Searchanalytics$Query['requestBody'];
type ListSitemapsRequest = webmasters_v3.Params$Resource$Sitemaps$List;
type GetSitemapRequest = webmasters_v3.Params$Resource$Sitemaps$Get;
type SubmitSitemapRequest = webmasters_v3.Params$Resource$Sitemaps$Submit;
type DeleteSitemapRequest = webmasters_v3.Params$Resource$Sitemaps$Delete;
type IndexInspectRequest = searchconsole_v1.Params$Resource$Urlinspection$Index$Inspect['requestBody'];

// ============================================================================
// Service Class
// ============================================================================

/**
 * Service for interacting with Google Search Console API
 *
 * Features:
 * - Caches auth client for performance
 * - Supports both readonly and write operations
 * - Automatic URL normalization with fallback
 * - Quick wins detection algorithm
 *
 * @see https://developers.google.com/webmaster-tools/v1/api_reference_index
 */
export class SearchConsoleService {
  private auth: GoogleAuth;
  private cachedAuthClient: AuthClient | null = null;
  private readonly hasWriteAccess: boolean;

  /**
   * Creates a new SearchConsoleService instance
   *
   * @param credentials - Path to the service account JSON key file
   * @param writeAccess - If true, uses full webmasters scope; otherwise readonly
   */
  constructor(credentials: string, writeAccess: boolean = true) {
    this.hasWriteAccess = writeAccess;

    // Use full scope if write access is needed, otherwise readonly
    // @see https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
    const scopes = writeAccess
      ? ['https://www.googleapis.com/auth/webmasters']
      : ['https://www.googleapis.com/auth/webmasters.readonly'];

    this.auth = new google.auth.GoogleAuth({
      keyFile: credentials,
      scopes,
    });
  }

  /**
   * Gets cached auth client or creates new one
   */
  private async getAuthClient(): Promise<AuthClient> {
    if (!this.cachedAuthClient) {
      this.cachedAuthClient = await this.auth.getClient() as AuthClient;
    }
    return this.cachedAuthClient;
  }

  /**
   * Gets webmasters v3 API client (cached)
   */
  private async getWebmasters(): Promise<webmasters_v3.Webmasters> {
    const authClient = await this.getAuthClient();
    return google.webmasters({
      version: 'v3',
      auth: authClient,
    } as webmasters_v3.Options);
  }

  /**
   * Gets searchconsole v1 API client (cached)
   */
  private async getSearchConsole(): Promise<searchconsole_v1.Searchconsole> {
    const authClient = await this.getAuthClient();
    return google.searchconsole({
      version: 'v1',
      auth: authClient,
    } as searchconsole_v1.Options);
  }

  /**
   * Normalizes URL to sc-domain format for fallback
   * Handles both regular URLs and existing sc-domain format
   */
  private normalizeUrl(url: string): string {
    // Already in sc-domain format
    if (url.startsWith('sc-domain:')) {
      return url;
    }

    try {
      const parsedUrl = new URL(url);
      return `sc-domain:${parsedUrl.hostname}`;
    } catch {
      // If URL parsing fails, assume it's a domain and prefix with sc-domain
      return `sc-domain:${url.replace(/^https?:\/\//, '').split('/')[0]}`;
    }
  }

  /**
   * Wraps an operation with automatic fallback to normalized URL on permission error
   */
  private async withPermissionFallback<T>(
    operation: () => Promise<T>,
    fallbackOperation: () => Promise<T>,
    context: string,
  ): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message.toLowerCase() : '';

      if (errorMessage.includes('permission') || errorMessage.includes('403')) {
        console.error(`[GSC] Permission error in ${context}, trying normalized URL...`);
        return await fallbackOperation();
      }

      // Re-throw with context
      throw new Error(`[GSC] ${context} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ==========================================================================
  // Search Analytics
  // ==========================================================================

  /**
   * Queries search analytics data
   * @see https://developers.google.com/webmaster-tools/v1/searchanalytics/query
   */
  async searchAnalytics(siteUrl: string, requestBody: SearchAnalyticsQueryRequest) {
    const webmasters = await this.getWebmasters();

    return this.withPermissionFallback(
      () => webmasters.searchanalytics.query({ siteUrl, requestBody }),
      () => webmasters.searchanalytics.query({
        siteUrl: this.normalizeUrl(siteUrl),
        requestBody
      }),
      'searchAnalytics',
    );
  }

  /**
   * Enhanced search analytics with regex filtering and quick wins detection
   *
   * Features:
   * - Supports up to 25,000 rows (vs 1,000 default)
   * - Regex filtering on query dimension
   * - Automatic quick wins detection
   */
  async enhancedSearchAnalytics(
    siteUrl: string,
    requestBody: SearchAnalyticsQueryRequest,
    options: EnhancedSearchAnalyticsOptions = {},
  ): Promise<{ data: EnhancedSearchAnalyticsResponse }> {
    if (!requestBody) {
      throw new Error('Request body is required');
    }

    // Clone request body to avoid mutation
    const enhancedRequestBody = { ...requestBody };

    // Apply regex filter if provided and query dimension is included
    if (options.regexFilter && enhancedRequestBody.dimensions?.includes('query')) {
      enhancedRequestBody.dimensionFilterGroups = [
        ...(enhancedRequestBody.dimensionFilterGroups || []),
        {
          groupType: 'and',
          filters: [{
            dimension: 'query',
            operator: 'includingRegex',
            expression: options.regexFilter,
          }],
        },
      ];
    }

    // Execute search analytics query
    const result = await this.searchAnalytics(siteUrl, enhancedRequestBody);
    const rows = (result.data.rows || []) as SearchAnalyticsRow[];

    // Build enhanced response
    const enhancedResponse: EnhancedSearchAnalyticsResponse = {
      rows,
      responseAggregationType: result.data.responseAggregationType ?? undefined,
      metadata: {
        regexFilterApplied: !!options.regexFilter,
        quickWinsEnabled: !!options.enableQuickWins,
        rowLimit: enhancedRequestBody.rowLimit || 1000,
        totalRows: rows.length,
      },
    };

    // Apply quick wins detection if enabled
    if (options.enableQuickWins && rows.length > 0) {
      enhancedResponse.quickWins = this.detectQuickWins(rows, options.quickWinsThresholds);
    }

    return { data: enhancedResponse };
  }

  /**
   * Detects SEO quick wins from search analytics data
   *
   * Identifies queries with:
   * - High impressions but low CTR
   * - Position between 4-10 (page 1 but not top 3)
   * - Potential for improvement with optimization
   */
  private detectQuickWins(
    rows: SearchAnalyticsRow[],
    thresholds: Partial<QuickWinsThresholds> = {},
  ): QuickWin[] {
    const {
      minImpressions = 50,
      maxCtr = 2.0,
      positionRangeMin = 4,
      positionRangeMax = 10,
      targetCtr = 5.0,
      estimatedClickValue = 1.0,
      conversionRate = 0.03,
    } = thresholds;

    return rows
      .filter((row): row is SearchAnalyticsRow & Required<Pick<SearchAnalyticsRow, 'impressions' | 'ctr' | 'position'>> => {
        const impressions = row.impressions ?? 0;
        const ctr = (row.ctr ?? 0) * 100; // Convert to percentage
        const position = row.position ?? 0;

        return (
          impressions >= minImpressions &&
          ctr <= maxCtr &&
          position >= positionRangeMin &&
          position <= positionRangeMax
        );
      })
      .map((row): QuickWin => {
        const impressions = row.impressions;
        const currentClicks = row.clicks ?? 0;
        const currentCtr = row.ctr * 100;
        const position = row.position;

        // Calculate potential with target CTR
        const potentialClicks = Math.round((impressions * targetCtr) / 100);
        const additionalClicks = Math.max(0, potentialClicks - currentClicks);

        // Calculate estimated value using clickValue and conversion rate
        const estimatedValue = Number((additionalClicks * estimatedClickValue * (1 + conversionRate)).toFixed(2));

        // Determine opportunity level based on additional clicks potential
        let opportunity: 'High' | 'Medium' | 'Low';
        if (additionalClicks >= 100) {
          opportunity = 'High';
        } else if (additionalClicks >= 25) {
          opportunity = 'Medium';
        } else {
          opportunity = 'Low';
        }

        // Generate actionable recommendation
        const recommendation = this.generateRecommendation(position, currentCtr, impressions);

        return {
          query: row.keys?.[0] ?? 'N/A',
          page: row.keys?.[1] ?? 'N/A',
          currentPosition: Number(position.toFixed(1)),
          impressions,
          currentClicks,
          currentCtr: Number(currentCtr.toFixed(2)),
          potentialClicks,
          additionalClicks,
          estimatedValue,
          opportunity,
          recommendation,
        };
      })
      .sort((a, b) => b.additionalClicks - a.additionalClicks);
  }

  /**
   * Generates actionable recommendation based on metrics
   */
  private generateRecommendation(position: number, ctr: number, impressions: number): string {
    const recommendations: string[] = [];

    if (position >= 4 && position <= 6) {
      recommendations.push('Improve content depth and relevance to reach top 3');
    } else if (position > 6 && position <= 10) {
      recommendations.push('Focus on on-page SEO and internal linking');
    }

    if (ctr < 1) {
      recommendations.push('Optimize title tag and meta description for higher CTR');
    }

    if (impressions >= 1000) {
      recommendations.push('High-volume keyword - prioritize optimization');
    }

    return recommendations.length > 0
      ? recommendations.join('. ')
      : 'Review content for optimization opportunities';
  }

  // ==========================================================================
  // Sites
  // ==========================================================================

  /**
   * Lists all sites accessible by the authenticated user
   */
  async listSites() {
    const webmasters = await this.getWebmasters();
    return webmasters.sites.list();
  }

  // ==========================================================================
  // Sitemaps
  // ==========================================================================

  /**
   * Lists sitemaps for a site
   */
  async listSitemaps(request: ListSitemapsRequest) {
    const webmasters = await this.getWebmasters();

    return this.withPermissionFallback(
      () => webmasters.sitemaps.list(request),
      () => webmasters.sitemaps.list({
        ...request,
        siteUrl: this.normalizeUrl(request.siteUrl!),
      }),
      'listSitemaps',
    );
  }

  /**
   * Gets details for a specific sitemap
   */
  async getSitemap(request: GetSitemapRequest) {
    const webmasters = await this.getWebmasters();

    return this.withPermissionFallback(
      () => webmasters.sitemaps.get(request),
      () => webmasters.sitemaps.get({
        ...request,
        siteUrl: this.normalizeUrl(request.siteUrl!),
      }),
      'getSitemap',
    );
  }

  /**
   * Submits a sitemap for a site
   *
   * NOTE: Requires write access (webmasters scope, not readonly)
   */
  async submitSitemap(request: SubmitSitemapRequest) {
    if (!this.hasWriteAccess) {
      throw new Error('Write access required to submit sitemaps. Initialize service with writeAccess: true');
    }

    const webmasters = await this.getWebmasters();

    return this.withPermissionFallback(
      () => webmasters.sitemaps.submit(request),
      () => webmasters.sitemaps.submit({
        ...request,
        siteUrl: this.normalizeUrl(request.siteUrl!),
      }),
      'submitSitemap',
    );
  }

  /**
   * Deletes a sitemap from a site
   *
   * NOTE: Requires write access (webmasters scope, not readonly)
   */
  async deleteSitemap(request: DeleteSitemapRequest) {
    if (!this.hasWriteAccess) {
      throw new Error('Write access required to delete sitemaps. Initialize service with writeAccess: true');
    }

    const webmasters = await this.getWebmasters();

    return this.withPermissionFallback(
      () => webmasters.sitemaps.delete(request),
      () => webmasters.sitemaps.delete({
        ...request,
        siteUrl: this.normalizeUrl(request.siteUrl!),
      }),
      'deleteSitemap',
    );
  }

  // ==========================================================================
  // URL Inspection
  // ==========================================================================

  /**
   * Inspects a URL for indexing status
   *
   * @see https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
   */
  async indexInspect(requestBody: IndexInspectRequest) {
    const searchConsole = await this.getSearchConsole();

    try {
      return await searchConsole.urlInspection.index.inspect({ requestBody });
    } catch (err) {
      throw new Error(`[GSC] indexInspect failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
