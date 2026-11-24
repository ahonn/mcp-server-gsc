import { z } from 'zod';

const DIMENSIONS = [
  'query',
  'page',
  'country',
  'device',
  'date',
  'hour',
  'searchAppearance',
  'brandedClassification',
] as const;

const SEARCH_TYPES = [
  'web',
  'image',
  'video',
  'news',
  'discover',
  'googleNews',
  'webMultimodal',
] as const;

const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format');

const SearchTypeSchema = z
  .enum(SEARCH_TYPES)
  .optional()
  .describe(
    'Search type: web (default), image, video, news, discover, googleNews, or webMultimodal. Google does not allow grouping webMultimodal by query',
  );

const MaxRowsSchema = z
  .number()
  .int()
  .min(1)
  .max(100000)
  .default(25000)
  .describe('Maximum rows to read from Google for the analysis. The server pages through results.');

const LimitSchema = z.number().int().min(1).max(500).default(50).describe('Maximum items to return');

export const GSCBaseSchema = z.object({
  siteUrl: z
    .string()
    .describe(
      'A Search Console property, bare domain, or page URL. Examples: sc-domain:example.com, https://www.example.com/, example.com',
    ),
});

const DateRangeShape = {
  startDate: DateSchema.optional().describe(
    'Start date in YYYY-MM-DD format, Pacific Time. Defaults from days and endDate',
  ),
  endDate: DateSchema.optional().describe(
    'End date in YYYY-MM-DD format, Pacific Time. Defaults to the latest day with final data',
  ),
  days: z
    .number()
    .int()
    .min(1)
    .max(480)
    .optional()
    .describe('Length of the range when startDate is omitted. Defaults to 28'),
};

const DateRangeSchema = GSCBaseSchema.extend(DateRangeShape);

const ComparisonRangeShape = {
  previousStartDate: DateSchema.optional().describe(
    'Start of the comparison period. Defaults to the period of equal length before startDate',
  ),
  previousEndDate: DateSchema.optional().describe(
    'End of the comparison period. Set it together with previousStartDate',
  ),
};

export const SearchAnalyticsSchema = DateRangeSchema.extend({
  dimensions: z
    .string()
    .transform((val) => val.split(',').map((d) => d.trim()))
    .refine((val) => val.every((d) => (DIMENSIONS as readonly string[]).includes(d)), {
      message: `Dimensions must be from: ${DIMENSIONS.join(', ')}`,
    })
    .optional()
    .describe(`Comma-separated list of dimensions: ${DIMENSIONS.join(', ')}`),
  type: SearchTypeSchema,
  aggregationType: z
    .enum(['auto', 'byNewsShowcasePanel', 'byProperty', 'byPage'])
    .optional()
    .describe('Type of aggregation, such as auto, byNewsShowcasePanel, byProperty, byPage'),
  dataState: z
    .enum(['final', 'all', 'hourly_all'])
    .optional()
    .describe(
      'Data freshness. final (Google default) has finalized data, all adds fresh data, hourly_all is for the hour dimension. The hour dimension selects hourly_all automatically',
    ),
  rowLimit: z
    .number()
    .int()
    .min(1)
    .max(25000)
    .default(100)
    .describe('Maximum rows in this response (1 to 25,000). Use startRow to read more'),
  startRow: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Zero-based row offset. Use pagination.nextStartRow from the previous response'),
  responseFormat: z
    .enum(['tsv', 'json'])
    .default('tsv')
    .describe('tsv uses far less context. Use json only when a program must parse the rows'),
  pageFilter: z.string().optional().describe('Filter by page URL. Use with filterOperator.'),
  queryFilter: z.string().optional().describe('Filter by query string. Use with filterOperator.'),
  countryFilter: z.string().optional().describe('Filter by a country using ISO 3166-1 alpha-3 code (e.g., USA, CHN).'),
  deviceFilter: z.enum(['DESKTOP', 'MOBILE', 'TABLET']).optional().describe('Filter by device type.'),
  searchAppearanceFilter: z
    .string()
    .optional()
    .describe('Filter by a search appearance value. Group by searchAppearance to list valid values.'),
  brandedClassificationFilter: z
    .string()
    .optional()
    .describe(
      'Filter by a brandedClassification value. Group by brandedClassification to list valid values. Cannot be combined with a query filter.',
    ),
  filterOperator: z
    .enum(['equals', 'contains', 'notEquals', 'notContains', 'includingRegex', 'excludingRegex'])
    .default('equals')
    .describe('Operator for pageFilter and queryFilter. Defaults to "equals".'),
  regexFilter: z
    .string()
    .optional()
    .describe('RE2 regular expression that queries must match. Added to the other filters.'),
});

export const IndexInspectSchema = GSCBaseSchema.extend({
  inspectionUrl: z
    .string()
    .describe(
      'The fully-qualified URL to inspect. Must be under the property specified in "siteUrl"',
    ),
  languageCode: z
    .string()
    .optional()
    .default('en-US')
    .describe(
      'An IETF BCP-47 language code representing the language of the requested translated issue messages, such as "en-US" or "de-CH". Default is "en-US"',
    ),
});

export const BatchUrlInspectSchema = GSCBaseSchema.extend({
  inspectionUrls: z
    .array(z.string())
    .min(1)
    .max(100)
    .describe('1 to 100 fully-qualified URLs under the property. Google allows 2,000 inspections per site per day.'),
  languageCode: z.string().default('en-US').describe('IETF BCP-47 language code for issue messages'),
});

export const ListSitemapsSchema = z.object({
  sitemapIndex: z
    .string()
    .optional()
    .describe(
      "A URL of a site's sitemap index. For example: http://www.example.com/sitemapindex.xml",
    ),
  siteUrl: z
    .string()
    .describe("A Search Console property, bare domain, or page URL"),
});

export const GetSitemapSchema = z.object({
  feedpath: z
    .string()
    .describe('The URL of the actual sitemap. For example: http://www.example.com/sitemap.xml'),
  siteUrl: z
    .string()
    .describe("A Search Console property, bare domain, or page URL"),
});

export const SubmitSitemapSchema = z.object({
  feedpath: z
    .string()
    .describe('The URL of the sitemap to add. For example: http://www.example.com/sitemap.xml'),
  siteUrl: z
    .string()
    .describe("The site's URL, including protocol. For example: http://www.example.com/"),
});

export const DeleteSitemapSchema = z.object({
  feedpath: z
    .string()
    .describe('The URL of the sitemap to remove. For example: http://www.example.com/sitemap.xml'),
  siteUrl: z
    .string()
    .describe("The site's URL, including protocol. For example: http://www.example.com/"),
});

export const SiteSchema = z.object({
  siteUrl: z
    .string()
    .describe(
      'The site URL as defined in Search Console. Example: sc-domain:example.com (for domain resources) or http://www.example.com/ (for site prefix resources)',
    ),
});

export const ListSitesSchema = z.object({});

export const QuickWinsDetectionSchema = DateRangeSchema.extend({
  type: SearchTypeSchema,
  minImpressions: z.number().min(0).default(50).describe('Minimum impressions for a query and page pair'),
  maxCtr: z
    .number()
    .min(0)
    .max(1)
    .default(0.02)
    .describe('Maximum CTR as a fraction, the same unit as Search Console rows. 0.02 means 2%'),
  positionRangeMin: z.number().min(1).default(4).describe('Best position to include'),
  positionRangeMax: z.number().min(1).default(10).describe('Worst position to include'),
  targetCtr: z
    .number()
    .gt(0)
    .max(1)
    .default(0.05)
    .describe('Assumed CTR as a fraction for the click estimate. It is a scenario, not a forecast'),
  limit: LimitSchema,
  maxRows: MaxRowsSchema,
});

export const ComparePeriodsSchema = DateRangeSchema.extend({
  ...ComparisonRangeShape,
  dimension: z
    .enum(['query', 'page', 'country', 'device'])
    .default('page')
    .describe('Dimension to compare'),
  type: SearchTypeSchema,
  limit: LimitSchema,
  maxRows: MaxRowsSchema,
});

export const TrafficDropsSchema = DateRangeSchema.extend({
  ...ComparisonRangeShape,
  type: SearchTypeSchema,
  minPreviousClicks: z.number().min(0).default(10).describe('Ignore pages below this click count in the previous period'),
  minDropPct: z.number().min(0).max(100).default(20).describe('Minimum click decline in percent'),
  limit: LimitSchema,
  maxRows: MaxRowsSchema,
});

export const ContentDecaySchema = GSCBaseSchema.extend({
  endDate: DateSchema.optional().describe(
    'Last date of the newest window in YYYY-MM-DD format. Defaults to the latest day with final data',
  ),
  periodDays: z.number().int().min(7).max(90).default(28).describe('Length of each window in days'),
  periods: z.number().int().min(3).max(6).default(3).describe('Number of consecutive windows'),
  type: SearchTypeSchema,
  minPeakClicks: z.number().min(0).default(20).describe('Minimum clicks in the oldest window'),
  minDeclinePct: z.number().min(0).max(100).default(20).describe('Minimum total click decline in percent'),
  limit: LimitSchema,
  maxRows: MaxRowsSchema,
});

export const CannibalizationSchema = DateRangeSchema.extend({
  type: SearchTypeSchema,
  minQueryImpressions: z.number().min(0).default(100).describe('Minimum total impressions for a query'),
  minPageShare: z
    .number()
    .min(0)
    .max(1)
    .default(0.1)
    .describe('Minimum share of the query impressions for a page to count as competing (0 to 1)'),
  limit: LimitSchema,
  maxRows: MaxRowsSchema,
});

export const CtrOpportunitiesSchema = DateRangeSchema.extend({
  type: SearchTypeSchema,
  minImpressions: z.number().min(0).default(100).describe('Minimum impressions for a query and page pair'),
  maxPosition: z.number().int().min(1).max(100).default(20).describe('Ignore rows ranked below this position'),
  minCtrGapPct: z
    .number()
    .min(0)
    .max(100)
    .default(30)
    .describe('Minimum CTR shortfall against the median CTR of the same position on this site, in percent'),
  limit: LimitSchema,
  maxRows: MaxRowsSchema,
});

export const BrandSplitSchema = DateRangeSchema.extend({
  brandTerms: z
    .array(z.string().trim().min(1))
    .min(1)
    .describe('Brand terms. A query is branded if it contains one of them, ignoring case'),
  type: SearchTypeSchema,
  topQueries: z.number().int().min(0).max(100).default(10).describe('Top queries to return for each segment'),
  maxRows: MaxRowsSchema,
});

export const DiagnoseSiteSchema = DateRangeSchema.extend({
  ...ComparisonRangeShape,
  type: SearchTypeSchema,
  limit: z.number().int().min(1).max(50).default(10).describe('Maximum items in each result list'),
  inspectLimit: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(5)
    .describe('Top dropped pages to check with URL Inspection. Each check uses daily quota'),
  maxRows: MaxRowsSchema,
});

export const MultiSiteOverviewSchema = z.object({
  ...DateRangeShape,
  ...ComparisonRangeShape,
  siteUrls: z
    .array(z.string())
    .min(1)
    .max(100)
    .optional()
    .describe('Properties to include. Defaults to all properties the account can access'),
  type: SearchTypeSchema,
});

export type SearchAnalytics = z.infer<typeof SearchAnalyticsSchema>;
export type WithDates<T> = Omit<T, 'startDate' | 'endDate' | 'days'> & {
  startDate: string;
  endDate: string;
};
export type QuickWinsDetection = z.infer<typeof QuickWinsDetectionSchema>;
export type IndexInspect = z.infer<typeof IndexInspectSchema>;
