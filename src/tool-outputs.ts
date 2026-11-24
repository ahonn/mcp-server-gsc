import { z } from 'zod';

/**
 * Output contracts for the analysis tools. They name the fields that clients can
 * rely on and stay shallow, because each schema also costs context in tools/list.
 */

const Metrics = z.object({
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});

const DateRange = z.looseObject({ startDate: z.string(), endDate: z.string() });
const PeriodTotals = z.looseObject({ startDate: z.string(), endDate: z.string(), totals: Metrics });
const Items = z.array(z.looseObject({}));

export const QuickWinsOutput = z.object({
  startDate: z.string(),
  endDate: z.string(),
  rowsAnalyzed: z.number(),
  dataTruncated: z.boolean(),
  thresholds: z.looseObject({}),
  totalOpportunities: z.number(),
  quickWins: Items,
});

export const ComparePeriodsOutput = z.object({
  current: PeriodTotals,
  previous: PeriodTotals,
  dimension: z.string(),
  dataTruncated: z.boolean(),
  summary: z.object({
    compared: z.number(),
    new: z.number(),
    lost: z.number(),
    unknownDueToTruncation: z.number(),
  }),
  topGainers: Items,
  topLosers: Items,
});

export const TrafficDropsOutput = z.object({
  current: DateRange,
  previous: DateRange,
  dataTruncated: z.boolean(),
  totalDrops: z.number(),
  unknownDueToTruncation: z.number(),
  causes: z.record(z.string(), z.number()),
  drops: Items,
});

export const ContentDecayOutput = z.object({
  windows: z.array(DateRange),
  dataTruncated: z.boolean(),
  totalDecaying: z.number(),
  unknownDueToTruncation: z.number(),
  pages: Items,
});

export const CannibalizationOutput = z.object({
  rowsAnalyzed: z.number(),
  dataTruncated: z.boolean(),
  totalConflicts: z.number(),
  conflicts: Items,
});

export const CtrOpportunitiesOutput = z.object({
  rowsAnalyzed: z.number(),
  dataTruncated: z.boolean(),
  benchmarkMethod: z.string(),
  totalOpportunities: z.number(),
  opportunities: Items,
});

const BrandSegment = z.looseObject({
  queries: z.number(),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  clickShare: z.number(),
});

export const BrandSplitOutput = z.object({
  startDate: z.string(),
  endDate: z.string(),
  dataTruncated: z.boolean(),
  propertyTotals: Metrics,
  branded: BrandSegment,
  nonBranded: BrandSegment,
  unattributed: z.looseObject({ clicks: z.number(), impressions: z.number() }),
});

export const MultiSiteOutput = z.object({
  current: DateRange,
  previous: DateRange,
  summary: z.object({ sites: z.number(), failed: z.number() }),
  sites: z.array(z.looseObject({ siteUrl: z.string() })),
});

const InspectionSummary = z.object({
  requested: z.number(),
  inspected: z.number(),
  failed: z.number(),
  skipped: z.number(),
  quotaExceeded: z.boolean(),
  verdicts: z.record(z.string(), z.number()),
});

export const BatchInspectOutput = z.object({
  summary: InspectionSummary,
  results: z.array(z.looseObject({ inspectionUrl: z.string(), status: z.string() })),
});

export const DiagnoseSiteOutput = z.object({
  current: PeriodTotals,
  previous: PeriodTotals,
  dataTruncated: z.boolean(),
  summary: z.object({
    clicksChange: z.number(),
    clicksChangePct: z.number().nullable(),
    impressionsChange: z.number(),
    pagesDropped: z.number(),
    pagesDecaying: z.number(),
    indexIssues: z.number(),
    sitemapErrors: z.number().nullable(),
  }),
  trafficDrops: z.looseObject({ causes: z.record(z.string(), z.number()), top: Items }),
  contentDecay: z.looseObject({ windows: z.array(DateRange), top: Items }),
  indexing: z.looseObject({ summary: InspectionSummary, issues: Items }),
  sitemaps: z
    .object({ count: z.number(), errors: z.number(), warnings: z.number() })
    .nullable(),
  warnings: z.array(z.string()),
});
