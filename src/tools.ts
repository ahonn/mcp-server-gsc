import { z } from 'zod';
import {
  comparePeriods,
  detectContentDecay,
  detectQuickWins,
  detectTrafficDrops,
  findCannibalization,
  findCtrOpportunities,
  rangeDays,
  resolveComparison,
  rollingWindows,
  shiftDate,
  splitBrandedQueries,
  todayPacific,
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
  DiagnoseSiteSchema,
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
  type WithDates,
} from './schemas.js';
import { rowsToTsv, TextResult } from './response-format.js';
import type { SearchConsoleService } from './search-console.js';
import { buildSearchRequest, paginationInfo } from './search-request.js';
import { resolveSiteUrl } from './site-resolver.js';
import { ToolInputError } from './tool-errors.js';
import {
  BatchInspectOutput,
  BrandSplitOutput,
  CannibalizationOutput,
  ComparePeriodsOutput,
  ContentDecayOutput,
  CtrOpportunitiesOutput,
  DiagnoseSiteOutput,
  MultiSiteOutput,
  QuickWinsOutput,
  TrafficDropsOutput,
} from './tool-outputs.js';

export type SearchConsoleClient = Pick<
  SearchConsoleService,
  | 'searchAnalytics'
  | 'queryAllRows'
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

export interface ToolContext {
  /** Present only when the client asked for progress notifications. */
  reportProgress?: (progress: number, total: number, message: string) => void;
}

/** Facts about how a request was resolved. Every read response includes them. */
export type ResponseMeta = Record<string, unknown>;

type ReadContext = ToolContext & { meta: ResponseMeta };
type DateMode = 'range' | 'end';

// Dates older than this are final, so they need no freshness lookup.
const FINAL_DATA_AGE_DAYS = 5;
const DEFAULT_DATA_LAG_DAYS = 3;
const DEFAULT_RANGE_DAYS = 28;
const DEFAULT_HOURLY_RANGE_DAYS = 2;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  schema: z.ZodType;
  /** When set, the server also returns the result as structuredContent. */
  outputSchema?: z.ZodType;
  annotations: ToolAnnotations;
  /** Write tools are listed and run only when the server has write access. */
  write: boolean;
  run(args: unknown, gsc: SearchConsoleClient, context?: ToolContext): Promise<unknown>;
}

const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

async function latestFinalDate(
  gsc: SearchConsoleClient,
  siteUrl: string,
  today: string,
  type?: string,
): Promise<string | null> {
  try {
    const response = await gsc.searchAnalytics(siteUrl, {
      startDate: shiftDate(today, -10),
      endDate: today,
      dimensions: ['date'],
      dataState: 'final',
      type,
      rowLimit: 20,
    });
    const dates = (response.data.rows ?? []).flatMap((row) => row.keys?.[0] ?? []).sort();
    return dates.at(-1) ?? null;
  } catch {
    // Freshness is advisory. The main query reports any real access error.
    return null;
  }
}

async function resolveDates(args: Record<string, any>, gsc: SearchConsoleClient, mode: DateMode) {
  if (mode === 'range' && args.startDate && args.days !== undefined) {
    throw new ToolInputError('Set startDate or days, not both.');
  }
  const today = todayPacific();
  const hasHour = Array.isArray(args.dimensions) && args.dimensions.includes('hour');
  const dataState: string = args.dataState ?? (hasHour ? 'hourly_all' : 'final');
  const recentEnd = !args.endDate || args.endDate > shiftDate(today, -FINAL_DATA_AGE_DAYS);
  const dataThrough =
    args.siteUrl && recentEnd ? await latestFinalDate(gsc, args.siteUrl, today, args.type) : null;

  const endDate: string =
    args.endDate ??
    (dataState === 'final' ? (dataThrough ?? shiftDate(today, -DEFAULT_DATA_LAG_DAYS)) : today);
  const meta: ResponseMeta = { endDate, dataState, dataThrough };
  if (dataState === 'final' && dataThrough && endDate > dataThrough) {
    meta.warning = `endDate is after the latest final data (${dataThrough}), so recent days may be missing.`;
  }
  if (mode === 'end') return { dates: { endDate }, meta };

  const days = args.days ?? (hasHour ? DEFAULT_HOURLY_RANGE_DAYS : DEFAULT_RANGE_DAYS);
  const startDate: string = args.startDate ?? shiftDate(endDate, -(days - 1));
  rangeDays(startDate, endDate);
  return { dates: { startDate, endDate }, meta: { startDate, ...meta } };
}

async function prepareRead(parsed: unknown, gsc: SearchConsoleClient, mode?: DateMode) {
  const args = { ...(parsed as Record<string, any>) };
  const meta: ResponseMeta = {};
  if (typeof args.siteUrl === 'string') {
    const requested = args.siteUrl;
    args.siteUrl = await resolveSiteUrl(requested, async () =>
      ((await gsc.listSites()).data.siteEntry ?? []).flatMap((site) => site.siteUrl ?? []),
    );
    meta.siteUrl = args.siteUrl;
    if (args.siteUrl !== requested) meta.requestedSiteUrl = requested;
  }
  if (mode) {
    const resolved = await resolveDates(args, gsc, mode);
    Object.assign(args, resolved.dates);
    Object.assign(meta, resolved.meta);
    delete args.days;
  }
  return { args, meta };
}

function withMeta(result: unknown, meta: ResponseMeta): unknown {
  if (result instanceof TextResult || Object.keys(meta).length === 0) return result;
  const body = result as Record<string, unknown>;
  return { ...body, meta: { ...meta, ...(body.meta as ResponseMeta | undefined) } };
}

function buildRead<S extends z.ZodType, A>(
  definition: {
    name: string;
    title: string;
    description: string;
    schema: S;
    outputSchema?: z.ZodType;
    run(args: A, gsc: SearchConsoleClient, context: ReadContext): Promise<unknown>;
  },
  mode?: DateMode,
): ToolDefinition {
  return {
    ...definition,
    annotations: READ_ANNOTATIONS,
    write: false,
    run: async (args, gsc, context) => {
      const prepared = await prepareRead(definition.schema.parse(args), gsc, mode);
      const result = await definition.run(prepared.args as A, gsc, {
        ...context,
        meta: prepared.meta,
      });
      return withMeta(result, prepared.meta);
    },
  };
}

type ReadDefinition<S extends z.ZodType, A> = {
  name: string;
  title: string;
  description: string;
  schema: S;
  outputSchema?: z.ZodType;
  run(args: A, gsc: SearchConsoleClient, context: ReadContext): Promise<unknown>;
};

const readTool = <S extends z.ZodType>(definition: ReadDefinition<S, z.output<S>>) =>
  buildRead(definition);

/** A read tool whose date range is resolved before it runs. */
const rangeTool = <S extends z.ZodType>(definition: ReadDefinition<S, WithDates<z.output<S>>>) =>
  buildRead(definition, 'range');

/** A read tool that needs only a resolved end date. */
const endDateTool = <S extends z.ZodType>(
  definition: ReadDefinition<S, Omit<z.output<S>, 'endDate'> & { endDate: string }>,
) => buildRead(definition, 'end');

function writeTool<S extends z.ZodType>(definition: {
  name: string;
  title: string;
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
  const response = await gsc.searchAnalytics(siteUrl, { ...range, type });
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

async function inspectUrls(
  gsc: SearchConsoleClient,
  siteUrl: string,
  urls: string[],
  languageCode: string,
  context?: ToolContext,
) {
  let quotaExceeded = false;
  let completed = 0;
  const inspectionUrls = [...new Set(urls)];
  const finish = (result: InspectionResult) => {
    completed += 1;
    context?.reportProgress?.(completed, inspectionUrls.length, `Inspected ${completed} of ${inspectionUrls.length} URLs`);
    return result;
  };

  // 120 ms between calls stays below Google's limit of 600 inspections per minute.
  const results = await pacedMap<string, InspectionResult>(
    inspectionUrls,
    { concurrency: 5, minIntervalMs: 120, shouldStop: () => quotaExceeded },
    async (inspectionUrl) => {
      try {
        const response = await gsc.indexInspect({ siteUrl, inspectionUrl, languageCode });
        const status = response.data.inspectionResult?.indexStatusResult;
        return finish({
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
        });
      } catch (error) {
        if (errorStatus(error) === QUOTA_STATUS) quotaExceeded = true;
        return finish({ inspectionUrl, status: 'error', error: errorMessage(error) });
      }
    },
    (inspectionUrl) =>
      finish({
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
}

export const TOOLS: ToolDefinition[] = [
  readTool({
    name: 'list_sites',
    title: 'List Sites',
    description: 'List all sites in Google Search Console',
    schema: ListSitesSchema,
    run: async (_args, gsc) => (await gsc.listSites()).data,
  }),
  rangeTool({
    name: 'search_analytics',
    title: 'Search Analytics',
    description:
      'Get search performance rows. Dates are optional and default to the last 28 days of final data. Returns compact TSV with a # meta line. Supports hourly data, fresh data, filters, and pagination through startRow',
    schema: SearchAnalyticsSchema,
    run: async (args, gsc, context) => {
      const response = await gsc.searchAnalytics(args.siteUrl, buildSearchRequest(args));
      const rows = response.data.rows ?? [];
      const metadata = response.data as { metadata?: { first_incomplete_date?: string; first_incomplete_hour?: string } };
      const meta = {
        ...context.meta,
        ...paginationInfo(args.startRow, args.rowLimit, rows.length),
        ...(metadata.metadata?.first_incomplete_date
          ? { firstIncompleteDate: metadata.metadata.first_incomplete_date }
          : {}),
        ...(metadata.metadata?.first_incomplete_hour
          ? { firstIncompleteHour: metadata.metadata.first_incomplete_hour }
          : {}),
      };
      if (args.responseFormat === 'tsv') {
        return new TextResult(rowsToTsv(rows, args.dimensions ?? [], meta));
      }
      return { meta, rows, responseAggregationType: response.data.responseAggregationType };
    },
  }),
  rangeTool({
    name: 'detect_quick_wins',
    title: 'Detect Quick Wins',
    description: 'Find query and page pairs that rank close to the top but have a low CTR',
    schema: QuickWinsDetectionSchema,
    outputSchema: QuickWinsOutput,
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
        startDate: args.startDate,
        endDate: args.endDate,
        rowsAnalyzed: rows.length,
        dataTruncated: rows.length >= args.maxRows,
        thresholds: {
          minImpressions: args.minImpressions,
          maxCtr: args.maxCtr,
          positionRangeMin: args.positionRangeMin,
          positionRangeMax: args.positionRangeMax,
          targetCtr: args.targetCtr,
        },
        ...detectQuickWins(rows, args),
      };
    },
  }),
  rangeTool({
    name: 'compare_periods',
    title: 'Compare Periods',
    description: 'Compare two date ranges by query, page, country, or device, with totals and top movers',
    schema: ComparePeriodsSchema,
    outputSchema: ComparePeriodsOutput,
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
  rangeTool({
    name: 'detect_traffic_drops',
    title: 'Detect Traffic Drops',
    description:
      'Find pages that lost clicks between two periods and classify the likely cause: ranking, impressions, CTR, or visibility',
    schema: TrafficDropsSchema,
    outputSchema: TrafficDropsOutput,
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
  endDateTool({
    name: 'detect_content_decay',
    title: 'Detect Content Decay',
    description: 'Find pages whose clicks fell in every one of several consecutive time windows',
    schema: ContentDecaySchema,
    outputSchema: ContentDecayOutput,
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
  rangeTool({
    name: 'find_cannibalization',
    title: 'Find Keyword Cannibalization',
    description: 'Find queries where several pages of the site compete for impressions',
    schema: CannibalizationSchema,
    outputSchema: CannibalizationOutput,
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
  rangeTool({
    name: 'find_ctr_opportunities',
    title: 'Find CTR Opportunities',
    description: "Find query and page pairs whose CTR is below this site's median CTR at the same position",
    schema: CtrOpportunitiesSchema,
    outputSchema: CtrOpportunitiesOutput,
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
  rangeTool({
    name: 'brand_split',
    title: 'Branded Traffic Split',
    description: 'Split query traffic into branded and non-branded segments using your brand terms',
    schema: BrandSplitSchema,
    outputSchema: BrandSplitOutput,
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
  rangeTool({
    name: 'diagnose_site',
    title: 'Diagnose Site',
    description:
      'Run one site diagnosis: period totals, dropped pages with likely causes, content decay, URL Inspection for the top dropped pages, and sitemap errors. Use it first for a broad "what changed" question',
    schema: DiagnoseSiteSchema,
    outputSchema: DiagnoseSiteOutput,
    run: async (args, gsc, context) => {
      const current = { startDate: args.startDate, endDate: args.endDate };
      const previous = resolveComparison(args);
      const body = { dimensions: ['page'], type: args.type };
      const periodDays = Math.min(90, Math.max(7, rangeDays(args.startDate, args.endDate)));
      const windows = rollingWindows(args.endDate, periodDays, 3);
      const [currentRows, previousRows, currentTotals, previousTotals, windowRows] = await Promise.all([
        gsc.queryAllRows(args.siteUrl, { ...current, ...body }, args.maxRows),
        gsc.queryAllRows(args.siteUrl, { ...previous, ...body }, args.maxRows),
        totalsFor(gsc, args.siteUrl, current, args.type),
        totalsFor(gsc, args.siteUrl, previous, args.type),
        Promise.all(
          windows.map((window) => gsc.queryAllRows(args.siteUrl, { ...window, ...body }, args.maxRows)),
        ),
      ]);

      const currentTruncated = currentRows.length >= args.maxRows;
      const truncatedWindows = windowRows.map((rows) => rows.length >= args.maxRows);
      const drops = detectTrafficDrops(currentRows, previousRows, {
        minPreviousClicks: 10,
        minDropPct: 20,
        limit: Math.max(args.limit, args.inspectLimit),
        currentTruncated,
      });
      const decay = detectContentDecay(windowRows, {
        minPeakClicks: 20,
        minDeclinePct: 20,
        limit: args.limit,
        truncatedWindows,
      });

      // A failed secondary check must not hide the traffic diagnosis.
      const warnings: string[] = [];
      const inspection = await inspectUrls(
        gsc,
        args.siteUrl,
        drops.drops.slice(0, args.inspectLimit).map((drop) => drop.page),
        'en-US',
        context,
      );
      if (inspection.summary.failed > 0) {
        warnings.push(`${inspection.summary.failed} URL inspections failed`);
      }
      if (inspection.summary.quotaExceeded) warnings.push('URL Inspection quota was exceeded');

      let sitemaps: { count: number; errors: number; warnings: number } | null = null;
      try {
        const entries = (await gsc.listSitemaps({ siteUrl: args.siteUrl })).data.sitemap ?? [];
        sitemaps = {
          count: entries.length,
          errors: entries.reduce((sum, entry) => sum + Number(entry.errors ?? 0), 0),
          warnings: entries.reduce((sum, entry) => sum + Number(entry.warnings ?? 0), 0),
        };
      } catch (error) {
        warnings.push(`Sitemap check failed: ${errorMessage(error)}`);
      }

      const nowTotals = toMetrics(currentTotals);
      const beforeTotals = toMetrics(previousTotals);
      const issues = inspection.results.filter(
        (result) => result.status !== 'ok' || result.verdict !== 'PASS',
      );
      return {
        current: { ...current, totals: nowTotals },
        previous: { ...previous, totals: beforeTotals },
        dataTruncated:
          currentTruncated || previousRows.length >= args.maxRows || truncatedWindows.some(Boolean),
        summary: {
          clicksChange: nowTotals.clicks - beforeTotals.clicks,
          clicksChangePct: beforeTotals.clicks
            ? Number((((nowTotals.clicks - beforeTotals.clicks) / beforeTotals.clicks) * 100).toFixed(1))
            : null,
          impressionsChange: nowTotals.impressions - beforeTotals.impressions,
          pagesDropped: drops.totalDrops,
          pagesDecaying: decay.totalDecaying,
          indexIssues: issues.length,
          sitemapErrors: sitemaps?.errors ?? null,
        },
        trafficDrops: {
          total: drops.totalDrops,
          unknownDueToTruncation: drops.unknownDueToTruncation,
          causes: drops.causes,
          top: drops.drops.slice(0, args.limit),
        },
        contentDecay: {
          windows,
          total: decay.totalDecaying,
          unknownDueToTruncation: decay.unknownDueToTruncation,
          top: decay.pages,
        },
        indexing: { summary: inspection.summary, issues },
        sitemaps,
        warnings,
      };
    },
  }),
  rangeTool({
    name: 'multi_site_overview',
    title: 'Multi-Site Overview',
    description: 'Compare clicks, impressions, CTR, and position across all or selected properties',
    schema: MultiSiteOverviewSchema,
    outputSchema: MultiSiteOutput,
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
    title: 'Inspect URL',
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
    title: 'Batch Inspect URLs',
    description:
      'Inspect up to 100 URLs with rate limiting. Returns index status per URL, a verdict summary, and partial results if the quota runs out',
    schema: BatchUrlInspectSchema,
    outputSchema: BatchInspectOutput,
    run: (args, gsc, context) =>
      inspectUrls(gsc, args.siteUrl, args.inspectionUrls, args.languageCode, context),
  }),
  readTool({
    name: 'list_sitemaps',
    title: 'List Sitemaps',
    description: 'List sitemaps for a site in Google Search Console',
    schema: ListSitemapsSchema,
    run: async (args, gsc) =>
      (await gsc.listSitemaps({ siteUrl: args.siteUrl, sitemapIndex: args.sitemapIndex })).data,
  }),
  readTool({
    name: 'get_sitemap',
    title: 'Get Sitemap',
    description: 'Get a sitemap for a site in Google Search Console',
    schema: GetSitemapSchema,
    run: async (args, gsc) =>
      (await gsc.getSitemap({ siteUrl: args.siteUrl, feedpath: args.feedpath })).data,
  }),
  writeTool({
    name: 'submit_sitemap',
    title: 'Submit Sitemap',
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
    title: 'Delete Sitemap',
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
    title: 'Add Site',
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
    title: 'Delete Site',
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
