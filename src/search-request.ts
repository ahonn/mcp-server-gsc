import type { SearchAnalytics, WithDates } from './schemas.js';
import { ToolInputError } from './tool-errors.js';

interface SearchFilter {
  dimension: string;
  operator: string;
  expression: string;
}

/** Translates validated tool arguments into a Search Analytics request body. */
export function buildSearchRequest(args: WithDates<SearchAnalytics>) {
  const hasHour = args.dimensions?.includes('hour') ?? false;
  if (hasHour && args.dataState && args.dataState !== 'hourly_all') {
    throw new ToolInputError('The hour dimension requires dataState "hourly_all"');
  }
  if (args.dataState === 'hourly_all' && !hasHour) {
    throw new ToolInputError('dataState "hourly_all" requires the hour dimension');
  }
  if (args.brandedClassificationFilter && (args.queryFilter || args.regexFilter)) {
    throw new ToolInputError('brandedClassificationFilter cannot be combined with a query filter');
  }

  const filters: SearchFilter[] = [];
  if (args.pageFilter) {
    filters.push({ dimension: 'page', operator: args.filterOperator, expression: args.pageFilter });
  }
  if (args.queryFilter) {
    filters.push({ dimension: 'query', operator: args.filterOperator, expression: args.queryFilter });
  }
  if (args.regexFilter) {
    filters.push({ dimension: 'query', operator: 'includingRegex', expression: args.regexFilter });
  }
  // Google supports only "equals" semantics for these enumerated dimensions.
  if (args.countryFilter) {
    filters.push({ dimension: 'country', operator: 'equals', expression: args.countryFilter });
  }
  if (args.deviceFilter) {
    filters.push({ dimension: 'device', operator: 'equals', expression: args.deviceFilter });
  }
  if (args.searchAppearanceFilter) {
    filters.push({
      dimension: 'searchAppearance',
      operator: 'equals',
      expression: args.searchAppearanceFilter,
    });
  }
  if (args.brandedClassificationFilter) {
    filters.push({
      dimension: 'brandedClassification',
      operator: 'equals',
      expression: args.brandedClassificationFilter,
    });
  }

  return {
    startDate: args.startDate,
    endDate: args.endDate,
    dimensions: args.dimensions,
    type: args.type,
    aggregationType: args.aggregationType,
    dataState: args.dataState ?? (hasHour ? 'hourly_all' : undefined),
    rowLimit: args.rowLimit,
    startRow: args.startRow,
    ...(filters.length > 0 ? { dimensionFilterGroups: [{ groupType: 'and', filters }] } : {}),
  };
}

/** Google gives no total row count, so a full page means more rows may exist. */
export function paginationInfo(startRow: number, rowLimit: number, returned: number) {
  const hasMore = returned === rowLimit;
  return {
    startRow,
    rowLimit,
    returned,
    hasMore,
    nextStartRow: hasMore ? startRow + returned : null,
  };
}
