import { google, searchconsole_v1, webmasters_v3 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { detectQuickWins, type GscRow } from './analysis.js';

// The API replaced `searchType` with `type`, but the generated client types lack it.
export type SearchanalyticsQueryRequest = webmasters_v3.Schema$SearchAnalyticsQueryRequest & {
  type?: string;
};
type ListSitemapsRequest = webmasters_v3.Params$Resource$Sitemaps$List;
type GetSitemapRequest = webmasters_v3.Params$Resource$Sitemaps$Get;
type SubmitSitemapRequest = webmasters_v3.Params$Resource$Sitemaps$Submit;
type DeleteSitemapRequest = webmasters_v3.Params$Resource$Sitemaps$Delete;
type IndexInspectRequest =
  searchconsole_v1.Params$Resource$Urlinspection$Index$Inspect['requestBody'];

export const READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const READ_WRITE_SCOPE = 'https://www.googleapis.com/auth/webmasters';

const MAX_ROWS_PER_REQUEST = 25000;

// These POST endpoints only read data, so they are safe to retry.
const READ_RETRY_OPTIONS = {
  retry: true,
  retryConfig: {
    retry: 3,
    noResponseRetries: 2,
    httpMethodsToRetry: ['GET', 'POST'],
    statusCodesToRetry: [
      [429, 429],
      [500, 599],
    ],
  },
};

export interface SearchConsoleOptions {
  /**
   * Request the read/write scope instead of the read-only one. Needed for
   * submit_sitemap, delete_sitemap, add_site and delete_site. Off by default.
   */
  allowWrite?: boolean;
}

/** Returns the domain property for a URL-prefix site, or null if none applies. */
function toDomainProperty(siteUrl: string | null | undefined): string | null {
  if (!siteUrl || siteUrl.startsWith('sc-domain:')) return null;
  try {
    const { protocol, hostname } = new URL(siteUrl);
    return protocol === 'http:' || protocol === 'https:' ? `sc-domain:${hostname}` : null;
  } catch {
    return null;
  }
}

export class SearchConsoleService {
  private auth: GoogleAuth;

  constructor(credentials: string, options: SearchConsoleOptions = {}) {
    const scopes = [options.allowWrite ? READ_WRITE_SCOPE : READONLY_SCOPE];
    const isJsonString = credentials.trimStart().startsWith('{');
    if (isJsonString) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(credentials);
      } catch {
        throw new Error('Invalid credentials: failed to parse JSON');
      }
      this.auth = new google.auth.GoogleAuth({
        credentials: parsed,
        scopes,
      });
    } else {
      this.auth = new google.auth.GoogleAuth({
        keyFile: credentials,
        scopes,
      });
    }
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

  /**
   * Retries a read on the matching domain property after a permission error.
   * Write methods must not use this: the fallback targets a different property
   * than the one the caller named.
   */
  private async readWithSiteFallback<T>(
    siteUrl: string | null | undefined,
    read: (site: string | null | undefined) => Promise<T>,
  ): Promise<T> {
    try {
      return await read(siteUrl);
    } catch (err) {
      const fallback = toDomainProperty(siteUrl);
      if (fallback && err instanceof Error && err.message.toLowerCase().includes('permission')) {
        return await read(fallback);
      }
      throw err;
    }
  }

  async searchAnalytics(
    siteUrl: string,
    requestBody: SearchanalyticsQueryRequest,
    options: { exactSite?: boolean } = {},
  ) {
    const webmasters = await this.getWebmasters();
    const query = (site: string | null | undefined) =>
      webmasters.searchanalytics.query({ siteUrl: site!, requestBody }, READ_RETRY_OPTIONS);
    // A domain property covers more URLs than a prefix, so analysis must not switch to it.
    return options.exactSite ? query(siteUrl) : this.readWithSiteFallback(siteUrl, query);
  }

  /** Pages through results until Google returns an empty page or maxRows is reached. */
  async queryAllRows(
    siteUrl: string,
    requestBody: SearchanalyticsQueryRequest,
    maxRows: number,
  ): Promise<GscRow[]> {
    const rows: GscRow[] = [];
    while (rows.length < maxRows) {
      const rowLimit = Math.min(MAX_ROWS_PER_REQUEST, maxRows - rows.length);
      const response = await this.searchAnalytics(
        siteUrl,
        { ...requestBody, rowLimit, startRow: rows.length },
        { exactSite: true },
      );
      const page = response.data.rows ?? [];
      // Google documents an empty page as the end. A short page does not prove it.
      if (page.length === 0) break;
      rows.push(...page);
    }
    return rows;
  }

  /**
   * Enhanced Search Analytics with advanced features
   * - Supports up to 25,000 rows (vs 1,000 default)
   * - Quick wins detection
   */
  async enhancedSearchAnalytics(
    siteUrl: string,
    requestBody: SearchanalyticsQueryRequest,
    options: {
      regexFilterApplied?: boolean;
      enableQuickWins?: boolean;
      quickWinsThresholds?: {
        minImpressions?: number;
        maxCtr?: number;
        positionRangeMin?: number;
        positionRangeMax?: number;
      };
    } = {},
  ) {
    if (!requestBody) {
      throw new Error('Request body is required');
    }

    const result = await this.searchAnalytics(siteUrl, requestBody);

    if (options.enableQuickWins && result.data.rows) {
      return {
        ...result,
        data: {
          ...result.data,
          quickWins: detectQuickWins(result.data.rows, options.quickWinsThresholds),
          enhancedFeatures: {
            regexFilterApplied: !!options.regexFilterApplied,
            quickWinsEnabled: true,
            rowLimit: requestBody.rowLimit || 1000,
          },
        },
      };
    }

    return result;
  }

  async listSites() {
    const webmasters = await this.getWebmasters();
    return webmasters.sites.list();
  }

  async listSitemaps(requestBody: ListSitemapsRequest) {
    const webmasters = await this.getWebmasters();
    return this.readWithSiteFallback(requestBody.siteUrl, (site) =>
      webmasters.sitemaps.list({ ...requestBody, siteUrl: site ?? undefined }),
    );
  }

  async getSitemap(requestBody: GetSitemapRequest) {
    const webmasters = await this.getWebmasters();
    return this.readWithSiteFallback(requestBody.siteUrl, (site) =>
      webmasters.sitemaps.get({ ...requestBody, siteUrl: site ?? undefined }),
    );
  }

  async submitSitemap(requestBody: SubmitSitemapRequest) {
    const webmasters = await this.getWebmasters();
    return webmasters.sitemaps.submit(requestBody);
  }

  async deleteSitemap(requestBody: DeleteSitemapRequest) {
    const webmasters = await this.getWebmasters();
    return webmasters.sitemaps.delete(requestBody);
  }

  async addSite(siteUrl: string) {
    const webmasters = await this.getWebmasters();
    return webmasters.sites.add({ siteUrl });
  }

  async deleteSite(siteUrl: string) {
    const webmasters = await this.getWebmasters();
    return webmasters.sites.delete({ siteUrl });
  }

  async indexInspect(requestBody: IndexInspectRequest) {
    const searchConsole = await this.getSearchConsole();
    return searchConsole.urlInspection.index.inspect({ requestBody }, READ_RETRY_OPTIONS);
  }
}
