/** Deterministic analysis over Search Analytics rows. No function here calls Google. */

export interface GscRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

export interface Metrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const DAY_MS = 86_400_000;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export function toMetrics(row: GscRow | undefined | null): Metrics {
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: round(row?.ctr ?? 0, 4),
    position: round(row?.position ?? 0, 1),
  };
}

function parseDate(date: string): number {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: ${date}`);
  }
  return time;
}

export function shiftDate(date: string, days: number): string {
  return new Date(parseDate(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Search Console reports dates in Pacific Time. */
export function todayPacific(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Returns the number of days in an inclusive date range. */
export function rangeDays(startDate: string, endDate: string): number {
  const days = (parseDate(endDate) - parseDate(startDate)) / DAY_MS + 1;
  if (days < 1) throw new Error('startDate must not be after endDate');
  return days;
}

/** Returns the period of equal length that ends the day before startDate. */
export function previousPeriod(startDate: string, endDate: string): DateRange {
  const days = rangeDays(startDate, endDate);
  return { startDate: shiftDate(startDate, -days), endDate: shiftDate(startDate, -1) };
}

export function resolveComparison(args: {
  startDate: string;
  endDate: string;
  previousStartDate?: string;
  previousEndDate?: string;
}): DateRange {
  if (Boolean(args.previousStartDate) !== Boolean(args.previousEndDate)) {
    throw new Error('Set previousStartDate and previousEndDate together');
  }
  const current = previousPeriod(args.startDate, args.endDate);
  if (!args.previousStartDate || !args.previousEndDate) return current;
  previousPeriod(args.previousStartDate, args.previousEndDate);
  return { startDate: args.previousStartDate, endDate: args.previousEndDate };
}

/** Returns consecutive windows from oldest to newest. */
export function rollingWindows(endDate: string, periodDays: number, periods: number): DateRange[] {
  return Array.from({ length: periods }, (_, index) => {
    const windowEnd = shiftDate(endDate, -(periods - 1 - index) * periodDays);
    return { startDate: shiftDate(windowEnd, -(periodDays - 1)), endDate: windowEnd };
  });
}

function byFirstKey(rows: GscRow[]): Map<string, Metrics> {
  const map = new Map<string, Metrics>();
  for (const row of rows) {
    const key = row.keys?.[0];
    if (key !== undefined) map.set(key, toMetrics(row));
  }
  return map;
}

const percentChange = (current: number, previous: number) =>
  previous === 0 ? null : round(((current - previous) / previous) * 100, 1);

/**
 * When a period reached maxRows, a key missing from it may still have traffic.
 * Such keys are counted as unknown instead of being reported as new or lost.
 */
export function comparePeriods(
  currentRows: GscRow[],
  previousRows: GscRow[],
  limit: number,
  truncated: { current: boolean; previous: boolean } = { current: false, previous: false },
) {
  const current = byFirstKey(currentRows);
  const previous = byFirstKey(previousRows);
  const keys = [...new Set([...current.keys(), ...previous.keys()])];
  const comparable = keys.filter(
    (key) => (current.has(key) || !truncated.current) && (previous.has(key) || !truncated.previous),
  );
  const items = comparable.map((key) => {
    const now = current.get(key) ?? null;
    const before = previous.get(key) ?? null;
    return {
      key,
      current: now,
      previous: before,
      clicksChange: (now?.clicks ?? 0) - (before?.clicks ?? 0),
      clicksChangePct: percentChange(now?.clicks ?? 0, before?.clicks ?? 0),
      impressionsChange: (now?.impressions ?? 0) - (before?.impressions ?? 0),
      positionChange: now && before ? round(now.position - before.position, 1) : null,
    };
  });

  return {
    summary: {
      compared: items.length,
      new: items.filter((item) => !item.previous).length,
      lost: items.filter((item) => !item.current).length,
      unknownDueToTruncation: keys.length - comparable.length,
    },
    topGainers: items
      .filter((item) => item.clicksChange > 0)
      .sort((a, b) => b.clicksChange - a.clicksChange)
      .slice(0, limit),
    topLosers: items
      .filter((item) => item.clicksChange < 0)
      .sort((a, b) => a.clicksChange - b.clicksChange)
      .slice(0, limit),
  };
}

export type DropCause =
  | 'no_longer_visible'
  | 'ranking_loss'
  | 'impressions_loss'
  | 'ctr_loss'
  | 'mixed';

/** Uses unrounded values so that display rounding cannot change a classification. */
function classifyDrop(now: GscRow | undefined, before: GscRow): DropCause {
  const nowImpressions = now?.impressions ?? 0;
  const beforeImpressions = before.impressions ?? 0;
  const beforeCtr = before.ctr ?? 0;
  if (!now || nowImpressions === 0) return 'no_longer_visible';
  // A larger position value is a worse rank.
  if ((now.position ?? 0) - (before.position ?? 0) >= 1) return 'ranking_loss';
  if (beforeImpressions > 0 && nowImpressions <= beforeImpressions * 0.8) return 'impressions_loss';
  if (beforeCtr > 0 && (now.ctr ?? 0) <= beforeCtr * 0.8) return 'ctr_loss';
  return 'mixed';
}

function rowsByFirstKey(rows: GscRow[]): Map<string, GscRow> {
  const map = new Map<string, GscRow>();
  for (const row of rows) {
    const key = row.keys?.[0];
    if (key !== undefined) map.set(key, row);
  }
  return map;
}

export function detectTrafficDrops(
  currentRows: GscRow[],
  previousRows: GscRow[],
  options: {
    minPreviousClicks: number;
    minDropPct: number;
    limit: number;
    /** The current period reached maxRows, so a missing page may still have traffic. */
    currentTruncated?: boolean;
  },
) {
  const current = rowsByFirstKey(currentRows);
  let unknownDueToTruncation = 0;
  const drops = [...rowsByFirstKey(previousRows)]
    .filter(([, before]) => (before.clicks ?? 0) >= options.minPreviousClicks && (before.clicks ?? 0) > 0)
    .flatMap(([page, before]) => {
      const now = current.get(page);
      if (!now && options.currentTruncated) {
        unknownDueToTruncation += 1;
        return [];
      }
      const clicksBefore = before.clicks ?? 0;
      const clicksNow = now?.clicks ?? 0;
      const dropPct = ((clicksBefore - clicksNow) / clicksBefore) * 100;
      if (clicksNow >= clicksBefore || dropPct < options.minDropPct) return [];
      return [
        {
          page,
          likelyCause: classifyDrop(now, before),
          clicksLost: clicksBefore - clicksNow,
          dropPct: round(dropPct, 1),
          current: now ? toMetrics(now) : null,
          previous: toMetrics(before),
        },
      ];
    })
    .sort((a, b) => b.clicksLost - a.clicksLost);

  const causes: Partial<Record<DropCause, number>> = {};
  for (const drop of drops) causes[drop.likelyCause] = (causes[drop.likelyCause] ?? 0) + 1;
  return {
    totalDrops: drops.length,
    unknownDueToTruncation,
    causes,
    drops: drops.slice(0, options.limit),
  };
}

/** A page decays when clicks fall in every window. `windows` runs oldest to newest. */
export function detectContentDecay(
  windows: GscRow[][],
  options: {
    minPeakClicks: number;
    minDeclinePct: number;
    limit: number;
    /** Per window: it reached maxRows, so a missing page may still have traffic. */
    truncatedWindows?: boolean[];
  },
) {
  const series = windows.map(byFirstKey);
  let unknownDueToTruncation = 0;
  const decaying = [...(series[0]?.entries() ?? [])].flatMap(([page, first]) => {
    if (first.clicks < options.minPeakClicks || first.clicks === 0) return [];
    if (series.some((window, index) => !window.has(page) && options.truncatedWindows?.[index])) {
      unknownDueToTruncation += 1;
      return [];
    }
    const clicks = series.map((window) => window.get(page)?.clicks ?? 0);
    if (!clicks.every((value, index) => index === 0 || value < clicks[index - 1])) return [];
    const last = clicks[clicks.length - 1];
    const declinePct = ((first.clicks - last) / first.clicks) * 100;
    if (declinePct < options.minDeclinePct) return [];
    return [
      {
        page,
        clicksByWindow: clicks,
        positionByWindow: series.map((window) => window.get(page)?.position ?? null),
        clicksLost: first.clicks - last,
        declinePct: round(declinePct, 1),
      },
    ];
  });
  decaying.sort((a, b) => b.clicksLost - a.clicksLost);
  return {
    totalDecaying: decaying.length,
    unknownDueToTruncation,
    pages: decaying.slice(0, options.limit),
  };
}

/** Rows must use the dimensions [query, page]. */
export function findCannibalization(
  rows: GscRow[],
  options: { minQueryImpressions: number; minPageShare: number; limit: number },
) {
  const queries = new Map<string, GscRow[]>();
  for (const row of rows) {
    const query = row.keys?.[0];
    if (query === undefined || row.keys?.[1] === undefined) continue;
    queries.set(query, [...(queries.get(query) ?? []), row]);
  }

  const conflicts = [...queries].flatMap(([query, queryRows]) => {
    const impressions = queryRows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
    if (impressions === 0 || impressions < options.minQueryImpressions) return [];
    const pages = queryRows
      .filter((row) => (row.impressions ?? 0) / impressions >= options.minPageShare)
      .map((row) => ({
        page: row.keys![1],
        ...toMetrics(row),
        impressionShare: round((row.impressions ?? 0) / impressions, 3),
      }))
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
    if (pages.length < 2) return [];
    return [
      {
        query,
        impressions,
        clicks: queryRows.reduce((sum, row) => sum + (row.clicks ?? 0), 0),
        competingPages: pages.length,
        primaryPage: pages[0].page,
        pages,
      },
    ];
  });

  conflicts.sort((a, b) => b.impressions - a.impressions);
  return { totalConflicts: conflicts.length, conflicts: conflicts.slice(0, options.limit) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Benchmarks each row against this site's own median CTR at the same rounded position. */
export function findCtrOpportunities(
  rows: GscRow[],
  options: { minImpressions: number; maxPosition: number; minCtrGapPct: number; limit: number },
) {
  const MIN_BUCKET_SIZE = 5;
  const eligible = rows.filter(
    (row) =>
      (row.impressions ?? 0) >= options.minImpressions &&
      (row.impressions ?? 0) > 0 &&
      (row.position ?? 0) >= 1 &&
      (row.position ?? 0) <= options.maxPosition,
  );

  const buckets = new Map<number, number[]>();
  for (const row of eligible) {
    const bucket = Math.round(row.position!);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), row.ctr ?? 0]);
  }
  const benchmarks = new Map(
    [...buckets]
      .filter(([, values]) => values.length >= MIN_BUCKET_SIZE)
      .map(([bucket, values]) => [bucket, median(values)]),
  );

  const opportunities = eligible.flatMap((row) => {
    const benchmark = benchmarks.get(Math.round(row.position!));
    const ctr = row.ctr ?? 0;
    if (!benchmark || ctr > benchmark * (1 - options.minCtrGapPct / 100)) return [];
    return [
      {
        query: row.keys?.[0] ?? null,
        page: row.keys?.[1] ?? null,
        ...toMetrics(row),
        benchmarkCtr: round(benchmark, 4),
        estimatedMissedClicks: Math.round((row.impressions ?? 0) * (benchmark - ctr)),
      },
    ];
  });
  opportunities.sort((a, b) => b.estimatedMissedClicks - a.estimatedMissedClicks);

  return {
    benchmarkMethod: `Median CTR per rounded position on this site, using buckets with at least ${MIN_BUCKET_SIZE} rows`,
    totalOpportunities: opportunities.length,
    opportunities: opportunities.slice(0, options.limit),
  };
}

/** Google omits anonymized queries from query rows, so property totals can exceed the sum. */
export function splitBrandedQueries(
  rows: GscRow[],
  brandTerms: string[],
  propertyTotals: GscRow | undefined,
  topQueries: number,
) {
  const terms = brandTerms.map((term) => term.toLowerCase());
  const segments = { branded: [] as GscRow[], nonBranded: [] as GscRow[] };
  for (const row of rows) {
    const query = row.keys?.[0]?.toLowerCase() ?? '';
    (terms.some((term) => query.includes(term)) ? segments.branded : segments.nonBranded).push(row);
  }

  const sum = (segment: GscRow[], field: 'clicks' | 'impressions') =>
    segment.reduce((total, row) => total + (row[field] ?? 0), 0);
  const attributedClicks = sum(rows, 'clicks');
  const attributedImpressions = sum(rows, 'impressions');
  const summarize = (segment: GscRow[]) => {
    const clicks = sum(segment, 'clicks');
    const impressions = sum(segment, 'impressions');
    return {
      queries: segment.length,
      clicks,
      impressions,
      ctr: impressions ? round(clicks / impressions, 4) : 0,
      clickShare: attributedClicks ? round(clicks / attributedClicks, 3) : 0,
      topQueries: [...segment]
        .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
        .slice(0, topQueries)
        .map((row) => ({ query: row.keys?.[0], ...toMetrics(row) })),
    };
  };

  return {
    branded: summarize(segments.branded),
    nonBranded: summarize(segments.nonBranded),
    unattributed: {
      clicks: Math.max(0, (propertyTotals?.clicks ?? attributedClicks) - attributedClicks),
      impressions: Math.max(0, (propertyTotals?.impressions ?? attributedImpressions) - attributedImpressions),
      note: 'Traffic from anonymized queries or queries beyond maxRows. It cannot be classified.',
    },
  };
}

/** Rows must use the dimensions [query, page]. CTR values are fractions, as in Google's API. */
export function detectQuickWins(
  rows: GscRow[],
  options: {
    minImpressions: number;
    maxCtr: number;
    positionRangeMin: number;
    positionRangeMax: number;
    targetCtr: number;
    limit: number;
  },
) {
  if (options.positionRangeMin > options.positionRangeMax) {
    throw new Error('positionRangeMin must not be greater than positionRangeMax');
  }

  const quickWins = rows
    .filter((row) => {
      const position = row.position ?? 0;
      return (
        (row.impressions ?? 0) >= options.minImpressions &&
        (row.ctr ?? 0) <= options.maxCtr &&
        position >= options.positionRangeMin &&
        position <= options.positionRangeMax
      );
    })
    .map((row) => {
      const clicksAtTarget = Math.round((row.impressions ?? 0) * options.targetCtr);
      return {
        query: row.keys?.[0] ?? null,
        page: row.keys?.[1] ?? null,
        ...toMetrics(row),
        estimatedClicksAtTarget: clicksAtTarget,
        estimatedAdditionalClicks: Math.max(0, clicksAtTarget - (row.clicks ?? 0)),
      };
    })
    .sort((a, b) => b.estimatedAdditionalClicks - a.estimatedAdditionalClicks);

  return { totalOpportunities: quickWins.length, quickWins: quickWins.slice(0, options.limit) };
}
