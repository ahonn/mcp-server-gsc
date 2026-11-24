import type { GscRow } from './analysis.js';

/** A tool result that is already formatted for the model. */
export class TextResult {
  constructor(readonly text: string) {}
}

// Query and page values come from searchers and websites. Keep each row on one line.
const cell = (value: string) => value.replace(/[\t\r\n\u2028\u2029]+/g, ' ');

export function rowsToTsv(rows: GscRow[], dimensions: string[], meta: Record<string, unknown>): string {
  const header = [...dimensions, 'clicks', 'impressions', 'ctr', 'position'].join('\t');
  const lines = rows.map((row) =>
    [
      ...dimensions.map((_, index) => cell(row.keys?.[index] ?? '')),
      row.clicks ?? 0,
      row.impressions ?? 0,
      Number((row.ctr ?? 0).toFixed(4)),
      Number((row.position ?? 0).toFixed(1)),
    ].join('\t'),
  );
  return [`# meta ${JSON.stringify(meta)}`, header, ...lines].join('\n');
}
