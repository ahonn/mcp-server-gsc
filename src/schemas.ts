import { z } from 'zod';

// ============================================================================
// Constants & Enums
// ============================================================================

/**
 * Valid dimensions for Search Analytics queries
 * @see https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */
export const VALID_DIMENSIONS = [
  'query',
  'page',
  'country',
  'device',
  'searchAppearance',
  'date',
  'hour',
] as const;

/**
 * Valid search types
 * @see https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */
export const VALID_SEARCH_TYPES = [
  'web',
  'image',
  'video',
  'news',
  'discover',
  'googleNews',
] as const;

/**
 * Valid aggregation types
 */
export const VALID_AGGREGATION_TYPES = [
  'auto',
  'byNewsShowcasePanel',
  'byProperty',
  'byPage',
] as const;

/**
 * Valid filter operators
 */
export const VALID_FILTER_OPERATORS = [
  'equals',
  'contains',
  'notEquals',
  'notContains',
  'includingRegex',
  'excludingRegex',
] as const;

/**
 * Valid device types
 */
export const VALID_DEVICE_TYPES = ['DESKTOP', 'MOBILE', 'TABLET'] as const;

/**
 * Valid data states for freshness control
 * @see https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */
export const VALID_DATA_STATES = ['all', 'final'] as const;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Date format regex for YYYY-MM-DD
 */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a comma-separated list of dimensions
 */
const validateDimensions = (val: string): boolean => {
  const dims = val.split(',').map(d => d.trim());
  return dims.every(d => VALID_DIMENSIONS.includes(d as typeof VALID_DIMENSIONS[number]));
};

// ============================================================================
// Base Schemas
// ============================================================================

export const GSCBaseSchema = z.object({
  siteUrl: z
    .string()
    .min(1)
    .describe(
      'The site URL as defined in Search Console. Example: sc-domain:example.com (for domain properties) or https://www.example.com/ (for URL-prefix properties)',
    ),
});

// ============================================================================
// Search Analytics Schemas
// ============================================================================

export const SearchAnalyticsSchema = GSCBaseSchema.extend({
  startDate: z
    .string()
    .regex(DATE_REGEX, 'Must be in YYYY-MM-DD format')
    .describe('Start date in YYYY-MM-DD format (Pacific Time)'),
  endDate: z
    .string()
    .regex(DATE_REGEX, 'Must be in YYYY-MM-DD format')
    .describe('End date in YYYY-MM-DD format (Pacific Time)'),
  dimensions: z
    .string()
    .refine(validateDimensions, {
      message: `Invalid dimensions. Valid values: ${VALID_DIMENSIONS.join(', ')}`,
    })
    .optional()
    .describe(
      `Comma-separated list of dimensions: ${VALID_DIMENSIONS.join(', ')}`,
    ),
  type: z
    .enum(VALID_SEARCH_TYPES)
    .optional()
    .describe('Search type filter'),
  aggregationType: z
    .enum(VALID_AGGREGATION_TYPES)
    .optional()
    .describe('How to aggregate results'),
  rowLimit: z
    .number()
    .int()
    .min(1)
    .max(25000)
    .default(1000)
    .describe('Maximum rows to return (1-25,000, default: 1,000)'),
  startRow: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Zero-based row offset for pagination'),
  dataState: z
    .enum(VALID_DATA_STATES)
    .default('final')
    .describe('Data freshness: "all" includes fresh unfinalized data, "final" for finalized only'),
  pageFilter: z
    .string()
    .optional()
    .describe('Filter by page URL (use with filterOperator)'),
  queryFilter: z
    .string()
    .optional()
    .describe('Filter by search query (use with filterOperator)'),
  countryFilter: z
    .string()
    .length(3)
    .optional()
    .describe('Filter by country (ISO 3166-1 alpha-3 code, e.g., USA, DEU, CHN)'),
  deviceFilter: z
    .enum(VALID_DEVICE_TYPES)
    .optional()
    .describe('Filter by device type'),
  filterOperator: z
    .enum(VALID_FILTER_OPERATORS)
    .default('equals')
    .describe('Operator for page/query filters'),
});

// ============================================================================
// Quick Wins Detection Schemas
// ============================================================================

export const QuickWinsThresholdsSchema = z.object({
  minImpressions: z
    .number()
    .int()
    .min(1)
    .default(50)
    .describe('Minimum impressions threshold'),
  maxCtr: z
    .number()
    .min(0)
    .max(100)
    .default(2.0)
    .describe('Maximum CTR percentage (0-100)'),
  positionRangeMin: z
    .number()
    .min(1)
    .max(100)
    .default(4)
    .describe('Minimum position (1-100)'),
  positionRangeMax: z
    .number()
    .min(1)
    .max(100)
    .default(10)
    .describe('Maximum position (1-100)'),
  targetCtr: z
    .number()
    .min(0)
    .max(100)
    .default(5.0)
    .describe('Target CTR percentage for potential calculation'),
  estimatedClickValue: z
    .number()
    .min(0)
    .default(1.0)
    .describe('Estimated value per click ($)'),
  conversionRate: z
    .number()
    .min(0)
    .max(1)
    .default(0.03)
    .describe('Estimated conversion rate (0-1)'),
});

export const QuickWinsDetectionSchema = GSCBaseSchema.extend({
  startDate: z
    .string()
    .regex(DATE_REGEX, 'Must be in YYYY-MM-DD format')
    .describe('Start date in YYYY-MM-DD format'),
  endDate: z
    .string()
    .regex(DATE_REGEX, 'Must be in YYYY-MM-DD format')
    .describe('End date in YYYY-MM-DD format'),
}).merge(QuickWinsThresholdsSchema);

export const EnhancedSearchAnalyticsSchema = SearchAnalyticsSchema.extend({
  regexFilter: z
    .string()
    .optional()
    .describe('Additional regex filter for query dimension'),
  enableQuickWins: z
    .boolean()
    .default(false)
    .describe('Enable automatic quick wins detection'),
  quickWinsThresholds: QuickWinsThresholdsSchema.optional()
    .describe('Custom thresholds for quick wins detection'),
});

// ============================================================================
// URL Inspection Schema
// ============================================================================

export const IndexInspectSchema = GSCBaseSchema.extend({
  inspectionUrl: z
    .string()
    .url('Must be a valid URL')
    .describe('The fully-qualified URL to inspect'),
  languageCode: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Must be an IETF BCP-47 language code')
    .default('en-US')
    .describe('Language code for translated messages (e.g., "en-US", "de-CH")'),
});

// ============================================================================
// Sitemap Schemas
// ============================================================================

export const ListSitemapsSchema = z.object({
  siteUrl: z
    .string()
    .min(1)
    .describe("The site's URL, including protocol (e.g., https://www.example.com/)"),
  sitemapIndex: z
    .string()
    .url()
    .optional()
    .describe("Optional sitemap index URL to filter results"),
});

export const GetSitemapSchema = z.object({
  siteUrl: z
    .string()
    .min(1)
    .describe("The site's URL, including protocol"),
  feedpath: z
    .string()
    .url('Must be a valid URL')
    .describe('The URL of the sitemap to retrieve'),
});

export const SubmitSitemapSchema = z.object({
  siteUrl: z
    .string()
    .min(1)
    .describe("The site's URL, including protocol"),
  feedpath: z
    .string()
    .url('Must be a valid URL')
    .describe('The URL of the sitemap to submit'),
});

export const DeleteSitemapSchema = z.object({
  siteUrl: z
    .string()
    .min(1)
    .describe("The site's URL, including protocol"),
  feedpath: z
    .string()
    .url('Must be a valid URL')
    .describe('The URL of the sitemap to delete'),
});

// ============================================================================
// Type Exports
// ============================================================================

export type SearchAnalytics = z.infer<typeof SearchAnalyticsSchema>;
export type EnhancedSearchAnalytics = z.infer<typeof EnhancedSearchAnalyticsSchema>;
export type QuickWinsDetection = z.infer<typeof QuickWinsDetectionSchema>;
export type QuickWinsThresholds = z.infer<typeof QuickWinsThresholdsSchema>;
export type IndexInspect = z.infer<typeof IndexInspectSchema>;
export type ListSitemaps = z.infer<typeof ListSitemapsSchema>;
export type GetSitemap = z.infer<typeof GetSitemapSchema>;
export type SubmitSitemap = z.infer<typeof SubmitSitemapSchema>;
export type DeleteSitemap = z.infer<typeof DeleteSitemapSchema>;
