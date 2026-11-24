import { z } from 'zod';
import {
  comparePeriods,
  detectContentDecay,
  detectQuickWins,
  detectTrafficDrops,
  findCannibalization,
  findCtrOpportunities,
  resolveComparison,
  rollingWindows,
  splitBrandedQueries,
  toMetrics,
  type GscRow,
} from './analysis.js';
import { pacedMap } from './paced-map.js';
import {
  BatchUrlInspectSchema,
  BrandSplitSchema,
  CannibalizationSchema,
  ComparePeriodsSchema,
  ContentDecaySchema,
  CtrOpportunitiesSchema,
  DeleteSitemapSchema,
  EnhancedSearchAnalyticsSchema,
  GetSitemapSchema,
  IndexInspectSchema,
  ListSitemapsSchema,
  ListSitesSchema,
  MultiSiteOverviewSchema,
  QuickWinsDetectionSchema,
  SearchAnalyticsSchema,
  SiteSchema,
  SubmitSitemapSchema,
  TrafficDropsSchema,
} from './schemas.js';
import type { SearchConsoleService } from './search-console.js';
import { buildSearchRequest, paginationInfo } from './search-request.js';

export type SearchConsoleClient = Pick<
  SearchConsoleService,
  | 'searchAnalytics'
  | 'queryAllRows'
  | 'enhancedSearchAnalytics'
  | 'listSites'
  | 'listSitemaps'
  | 'getSitemap'
  | 'submitSitemap'
  | 'deleteSitemap'
  | 'addSite'
  | 'deleteSite'
  | 'indexInspect'
>;

interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  annotations: ToolAnnotations;
  /** Write tools run only when the server was started with write access. */
  write: boolean;
  run(args: unknown, gsc: SearchConsoleClient): Promise<unknown>;
}

const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

function readTool<S extends z.ZodType>(definition: {
  name: string;
  description: string;
  schema: S;
  run(args: z.output<S>, gsc: SearchConsoleClient): Promise<unknown>;
}): ToolDefinition {
  return {
    ...definition,
    annotations: READ_ANNOTATIONS,
    write: false,
    run: (args, gsc) => definition.run(definition.schema.parse(args), gsc),
  };
}

function writeTool<S extends z.ZodType>(definition: {
  name: string;
  description: string;
  schema: S;
  destructive: boolean;
  run(args: z.output<S>, gsc: SearchConsoleClient): Promise<unknown>;
}): ToolDefinition {
  const { destructive, ...rest } = definition;
  return {
    ...rest,
    annotations: {
      readOnlyHint: false,
      destructiveHint: destructive,
      idempotentHint: true,
      openWorldHint: true,
    },
    write: true,
    run: (args, gsc) => definition.run(definition.schema.parse(args), gsc),
  };
}

const totalsFor = async (
  gsc: SearchConsoleClient,
  siteUrl: string,
  range: { startDate: string; endDate: string },
  type?: string,
): Promise<GscRow | undefined> => {
  const response = await gsc.searchAnalytics(siteUrl, { ...range, type }, { exactSite: true });
  return response.data.rows?.[0];
};

const QUOTA_STATUS = 429;

type InspectionResult =
  | {
      inspectionUrl: string;
      status: 'ok';
      verdict: string | null;
      coverageState: string | null;
      robotsTxtState: string | null;
      indexingState: string | null;
      pageFetchState: string | null;
      lastCrawlTime: string | null;
      googleCanonical: string | null;
      userCanonical: string | null;
    }
  | { inspectionUrl: string; status: 'error' | 'skipped'; error: string };

function errorStatus(error: unknown): number | undefined {
  const candidate = error as { status?: number; code?: number | string; response?: { status?: number } };
  const status = candidate.response?.status ?? candidate.status ?? candidate.code;
  return typeof status === 'number' ? status : undefined;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const TOOLS: ToolDefinition[] = [
  readTool({
    name: 'list_sites',
    description: 'List all sites in Google Search Console',
    schema: ListSitesSchema,
    run: async (_args, gsc) => (await gsc.listSites()).data,
  }),
  readTool({
    name: 'search_analytics',
    description:
      'Get search performance data. Supports hourly data, fresh data, filters, and pagination through startRow',
    schema: SearchAnalyticsSchema,
    run: async (args, gsc) => {
      const response = await gsc.searchAnalytics(args.siteUrl, buildSearchRequest(args));
      return {
        ...response.data,
        pagination: paginationInfo(args.startRow, args.rowLimit, response.data.rows?.length ?? 0),
      };
    },
  }),
  readTool({
    name: 'enhanced_search_analytics',
    description: 'Search analytics with all search_analytics options and optional quick wins detection',
    schema: EnhancedSearchAnalyticsSchema,
    run: async (args, gsc) => {
      const response = await gsc.enhancedSearchAnalytics(args.siteUrl, buildSearchRequest(args), {
        regexFilterApplied: Boolean(args.regexFilter),
        enableQuickWins: args.enableQuickWins,
        quickWinsThresholds: args.quickWinsThresholds,
      });
      return {
        ...response.data,
        pagination: paginationInfo(args.startRow, args.rowLimit, response.data.rows?.length ?? 0),
      };
    },
  }),
  readTool({
    name: 'detect_quick_wins',
    description: 'Find queries that rank close to the top but have a low CTR',
    schema: QuickWinsDetectionSchema,
    run: async (args, gsc) => {
      const response = await gsc.searchAnalytics(args.siteUrl, {
        startDate: args.startDate,
        endDate: args.endDate,
        dimensions: ['query', 'page'],
        rowLimit: 25000,
      });
      if (!response.data.rows) {
        return { message: 'No data available for quick wins analysis' };
      }
      const thresholds = {
        minImpressions: args.minImpressions,
        maxCtr: args.maxCtr,
        positionRangeMin: args.positionRangeMin,
        positionRangeMax: args.positionRangeMax,
      };
      const quickWins = detectQuickWins(response.data.rows, thresholds);
      return {
        quickWins,
        totalOpportunities: quickWins.length,
        thresholds,
        analysis: 'Quick wins detection completed',
      };
    },
  }),
  readTool({
    name: 'compare_periods',
    description: 'Compare two date ranges by query, page, country, or device, with totals and top movers',
    schema: ComparePeriodsSchema,
    run: async (args, gsc) => {
      const current = { startDate: args.startDate, endDate: args.endDate };
      const previous = resolveComparison(args);
      const body = { dimensions: [args.dimension], type: args.type };
      const [currentRows, previousRows, currentTotals, previousTotals] = await Promise.all([
        gsc.queryAllRows(args.siteUrl, { ...current, ...body }, args.maxRows),
        gsc.queryAllRows(args.siteUrl, { ...previous, ...body }, args.maxRows),
        totalsFor(gsc, args.siteUrl, current, args.type),
        totalsFor(gsc, args.siteUrl, previous, args.type),
      ]);
      const truncated = {
        current: currentRows.length >= args.maxRows,
        previous: previousRows.length >= args.maxRows,
      };
      return {
        current: { ...current, totals: toMetrics(currentTotals) },
        previous: { ...previous, totals: toMetrics(previousTotals) },
        dimension: args.dimension,
        dataTruncated: truncated.current || truncated.previous,
        ...comparePeriods(currentRows, previousRows, args.limit, truncated),
      };
    },
  }),
  readTool({
    name: 'detect_traffic_drops',
    description:
      'Find pages that lost clicks between two periods and classify the likely cause: ranking, impressions, CTR, or visibility',
    schema: TrafficDropsSchema,
    run: async (args, gsc) => {
      const current = { startDate: args.startDate, endDate: args.endDate };
      const previous = resolveComparison(args);
      const body = { dimensions: ['page'], type: args.type };
      const [currentRows, previousRows] = await Promise.all([
        gsc.queryAllRows(args.siteUrl, { ...current, ...body }, args.maxRows),
        gsc.queryAllRows(args.siteUrl, { ...previous, ...body }, args.maxRows),
      ]);
      const currentTruncated = currentRows.length >= args.maxRows;
      return {
        current,
        previous,
        dataTruncated: currentTruncated || previousRows.length >= args.maxRows,
        ...detectTrafficDrops(currentRows, previousRows, { ...args, currentTruncated }),
      };
    },
  }),
  readTool({
    name: 'detect_content_decay',
    description: 'Find pages whose clicks fell in every one of several consecutive time windows',
    schema: ContentDecaySchema,
    run: async (args, gsc) => {
      const windows = rollingWindows(args.endDate, args.periodDays, args.periods);
      const rows = await Promise.all(
        windows.map((window) =>
          gsc.queryAllRows(
            args.siteUrl,
            { ...window, dimensions: ['page'], type: args.type },
            args.maxRows,
          ),
        ),
      );
      const truncatedWindows = rows.map((windowRows) => windowRows.length >= args.maxRows);
      return {
        windows,
        dataTruncated: truncatedWindows.some(Boolean),
        ...detectContentDecay(rows, { ...args, truncatedWindows }),
      };
    },
  }),
  readTool({
    name: 'find_cannibalization',
    description: 'Find queries where several pages of the site compete for impressions',
    schema: CannibalizationSchema,
    run: async (args, gsc) => {
      const rows = await gsc.queryAllRows(
        args.siteUrl,
        {
          startDate: args.startDate,
          endDate: args.endDate,
          dimensions: ['query', 'page'],
          type: args.type,
        },
        args.maxRows,
      );
      return {
        rowsAnalyzed: rows.length,
        dataTruncated: rows.length >= args.maxRows,
        ...findCannibalization(rows, args),
      };
    },
  }),
  readTool({
    name: 'find_ctr_opportunities',
    description: "Find query and page pairs whose CTR is below this site's median CTR at the same position",
    schema: CtrOpportunitiesSchema,
    run: async (args, gsc) => {
      const rows = await gsc.queryAllRows(
        args.siteUrl,
        {
          startDate: args.startDate,
          endDate: args.endDate,
          dimensions: ['query', 'page'],
          type: args.type,
        },
        args.maxRows,
      );
      return {
        rowsAnalyzed: rows.length,
        dataTruncated: rows.length >= args.maxRows,
        ...findCtrOpportunities(rows, args),
      };
    },
  }),
  readTool({
    name: 'brand_split',
    description: 'Split query traffic into branded and non-branded segments using your brand terms',
    schema: BrandSplitSchema,
    run: async (args, gsc) => {
      const range = { startDate: args.startDate, endDate: args.endDate };
      const [rows, totals] = await Promise.all([
        gsc.queryAllRows(args.siteUrl, { ...range, dimensions: ['query'], type: args.type }, args.maxRows),
        totalsFor(gsc, args.siteUrl, range, args.type),
      ]);
      return {
        ...range,
        dataTruncated: rows.length >= args.maxRows,
        propertyTotals: toMetrics(totals),
        ...splitBrandedQueries(rows, args.brandTerms, totals, args.topQueries),
      };
    },
  }),
  readTool({
    name: 'multi_site_overview',
    description: 'Compare clicks, impressions, CTR, and position across all or selected properties',
    schema: MultiSiteOverviewSchema,
    run: async (args, gsc) => {
      const current = { startDate: args.startDate, endDate: args.endDate };
      const previous = resolveComparison(args);
      const siteUrls =
        args.siteUrls ??
        ((await gsc.listSites()).data.siteEntry ?? []).flatMap((site) => site.siteUrl ?? []);

      const sites = await pacedMap(
        siteUrls,
        { concurrency: 3, minIntervalMs: 100 },
        async (siteUrl) => {
          try {
            const [now, before] = await Promise.all([
              totalsFor(gsc, siteUrl, current, args.type),
              totalsFor(gsc, siteUrl, previous, args.type),
            ]);
            const nowMetrics = toMetrics(now);
            const beforeMetrics = toMetrics(before);
            return {
              siteUrl,
              current: nowMetrics,
              previous: beforeMetrics,
              clicksChange: nowMetrics.clicks - beforeMetrics.clicks,
              impressionsChange: nowMetrics.impressions - beforeMetrics.impressions,
            };
          } catch (error) {
            return { siteUrl, error: errorMessage(error) };
          }
        },
        (siteUrl) => ({ siteUrl, error: 'Skipped' }),
      );

      // Do not sum metrics: a domain property and its URL-prefix properties overlap.
      return {
        current,
        previous,
        summary: {
          sites: sites.length,
          failed: sites.filter((site) => !('current' in site)).length,
        },
        sites: [...sites].sort((a, b) => (b.current?.clicks ?? -1) - (a.current?.clicks ?? -1)),
      };
    },
  }),
  readTool({
    name: 'index_inspect',
    description: 'Inspect a URL to see if it is indexed or can be indexed',
    schema: IndexInspectSchema,
    run: async (args, gsc) =>
      (
        await gsc.indexInspect({
          siteUrl: args.siteUrl,
          inspectionUrl: args.inspectionUrl,
          languageCode: args.languageCode,
        })
      ).data,
  }),
  readTool({
    name: 'batch_url_inspect',
    description:
      'Inspect up to 100 URLs with rate limiting. Returns index status per URL, a verdict summary, and partial results if the quota runs out',
    schema: BatchUrlInspectSchema,
    run: async (args, gsc) => {
      let quotaExceeded = false;
      const inspectionUrls = [...new Set(args.inspectionUrls)];
      // 120 ms between calls stays below Google's limit of 600 inspections per minute.
      const results = await pacedMap<string, InspectionResult>(
        inspectionUrls,
        { concurrency: 5, minIntervalMs: 120, shouldStop: () => quotaExceeded },
        async (inspectionUrl) => {
          try {
            const response = await gsc.indexInspect({
              siteUrl: args.siteUrl,
              inspectionUrl,
              languageCode: args.languageCode,
            });
            const status = response.data.inspectionResult?.indexStatusResult;
            return {
              inspectionUrl,
              status: 'ok',
              verdict: status?.verdict ?? null,
              coverageState: status?.coverageState ?? null,
              robotsTxtState: status?.robotsTxtState ?? null,
              indexingState: status?.indexingState ?? null,
              pageFetchState: status?.pageFetchState ?? null,
              lastCrawlTime: status?.lastCrawlTime ?? null,
              googleCanonical: status?.googleCanonical ?? null,
              userCanonical: status?.userCanonical ?? null,
            };
          } catch (error) {
            if (errorStatus(error) === QUOTA_STATUS) quotaExceeded = true;
            return { inspectionUrl, status: 'error', error: errorMessage(error) };
          }
        },
        (inspectionUrl) => ({
          inspectionUrl,
          status: 'skipped',
          error: 'Skipped because Google reported a quota error',
        }),
      );

      const verdicts: Record<string, number> = {};
      for (const result of results) {
        if (result.status === 'ok') {
          const verdict = result.verdict ?? 'UNKNOWN';
          verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
        }
      }
      return {
        summary: {
          requested: inspectionUrls.length,
          inspected: results.filter((result) => result.status === 'ok').length,
          failed: results.filter((result) => result.status === 'error').length,
          skipped: results.filter((result) => result.status === 'skipped').length,
          quotaExceeded,
          verdicts,
        },
        results,
      };
    },
  }),
  readTool({
    name: 'list_sitemaps',
    description: 'List sitemaps for a site in Google Search Console',
    schema: ListSitemapsSchema,
    run: async (args, gsc) =>
      (await gsc.listSitemaps({ siteUrl: args.siteUrl, sitemapIndex: args.sitemapIndex })).data,
  }),
  readTool({
    name: 'get_sitemap',
    description: 'Get a sitemap for a site in Google Search Console',
    schema: GetSitemapSchema,
    run: async (args, gsc) =>
      (await gsc.getSitemap({ siteUrl: args.siteUrl, feedpath: args.feedpath })).data,
  }),
  writeTool({
    name: 'submit_sitemap',
    description:
      'Submit a sitemap for a site in Google Search Console. Google fetches it again right away. Needs GSC_ALLOW_WRITE=true',
    schema: SubmitSitemapSchema,
    destructive: false,
    run: async (args, gsc) => {
      await gsc.submitSitemap({ siteUrl: args.siteUrl, feedpath: args.feedpath });
      // Google answers an empty body on success, so say what happened.
      return { submitted: true, siteUrl: args.siteUrl, feedpath: args.feedpath };
    },
  }),
  writeTool({
    name: 'delete_sitemap',
    description:
      'Remove a sitemap from a site in Google Search Console. The URLs in it stay indexed. Needs GSC_ALLOW_WRITE=true',
    schema: DeleteSitemapSchema,
    destructive: true,
    run: async (args, gsc) => {
      await gsc.deleteSitemap({ siteUrl: args.siteUrl, feedpath: args.feedpath });
      return { deleted: true, siteUrl: args.siteUrl, feedpath: args.feedpath };
    },
  }),
  writeTool({
    name: 'add_site',
    description:
      'Add a site to the set of sites in Google Search Console. It still has to be verified before data shows up. Needs GSC_ALLOW_WRITE=true',
    schema: SiteSchema,
    destructive: false,
    run: async (args, gsc) => {
      await gsc.addSite(args.siteUrl);
      return { added: true, siteUrl: args.siteUrl };
    },
  }),
  writeTool({
    name: 'delete_site',
    description:
      "Remove a site from this account's set of sites in Google Search Console. Needs GSC_ALLOW_WRITE=true",
    schema: SiteSchema,
    destructive: true,
    run: async (args, gsc) => {
      await gsc.deleteSite(args.siteUrl);
      return { deleted: true, siteUrl: args.siteUrl };
    },
  }),
];
