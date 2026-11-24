import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  comparePeriods,
  detectContentDecay,
  detectTrafficDrops,
  findCannibalization,
  findCtrOpportunities,
  previousPeriod,
  resolveComparison,
  rollingWindows,
  splitBrandedQueries,
} from '../src/analysis.js';

const row = (keys: string[], clicks: number, impressions: number, position = 5) => ({
  keys,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

test('previousPeriod returns the equal-length range before the start date', () => {
  assert.deepEqual(previousPeriod('2026-03-01', '2026-03-07'), {
    startDate: '2026-02-22',
    endDate: '2026-02-28',
  });
  assert.throws(() => previousPeriod('2026-03-07', '2026-03-01'));
  assert.throws(() => previousPeriod('2026-02-31', '2026-03-01'));
});

test('resolveComparison requires both custom dates', () => {
  assert.throws(() =>
    resolveComparison({ startDate: '2026-03-01', endDate: '2026-03-07', previousStartDate: '2026-01-01' }),
  );
});

test('rollingWindows returns contiguous windows from oldest to newest', () => {
  assert.deepEqual(rollingWindows('2026-03-28', 7, 3), [
    { startDate: '2026-03-08', endDate: '2026-03-14' },
    { startDate: '2026-03-15', endDate: '2026-03-21' },
    { startDate: '2026-03-22', endDate: '2026-03-28' },
  ]);
});

test('comparePeriods reports gainers, losers, new, and lost keys', () => {
  const result = comparePeriods(
    [row(['/up'], 20, 100), row(['/new'], 5, 10), row(['/down'], 1, 50)],
    [row(['/up'], 10, 100), row(['/down'], 9, 50), row(['/lost'], 3, 10)],
    10,
  );
  assert.deepEqual(result.summary, { compared: 4, new: 1, lost: 1, unknownDueToTruncation: 0 });
  assert.equal(result.topGainers[0].key, '/up');
  assert.equal(result.topLosers[0].key, '/down');
  assert.equal(result.topGainers.find((item) => item.key === '/new')?.clicksChangePct, null);
});

test('detectTrafficDrops classifies the likely cause', () => {
  const result = detectTrafficDrops(
    [
      row(['/rank'], 5, 100, 9),
      row(['/impressions'], 5, 50, 5),
      row(['/ctr'], 5, 100, 5),
      row(['/small'], 1, 10, 5),
    ],
    [
      row(['/rank'], 20, 100, 5),
      row(['/impressions'], 20, 100, 5),
      row(['/ctr'], 20, 100, 5),
      row(['/gone'], 20, 100, 5),
      row(['/small'], 2, 10, 5),
    ],
    { minPreviousClicks: 10, minDropPct: 20, limit: 10 },
  );
  const causes = Object.fromEntries(result.drops.map((drop) => [drop.page, drop.likelyCause]));
  assert.deepEqual(causes, {
    '/gone': 'no_longer_visible',
    '/rank': 'ranking_loss',
    '/impressions': 'impressions_loss',
    '/ctr': 'ctr_loss',
  });
});

test('truncated data does not report missing keys as lost', () => {
  const compared = comparePeriods([row(['/a'], 5, 10)], [row(['/a'], 4, 10), row(['/b'], 90, 100)], 10, {
    current: true,
    previous: false,
  });
  assert.equal(compared.summary.lost, 0);
  assert.equal(compared.summary.unknownDueToTruncation, 1);
  assert.equal(compared.topLosers.length, 0);

  const drops = detectTrafficDrops([row(['/a'], 5, 10)], [row(['/b'], 90, 100)], {
    minPreviousClicks: 10,
    minDropPct: 20,
    limit: 10,
    currentTruncated: true,
  });
  assert.equal(drops.totalDrops, 0);
  assert.equal(drops.unknownDueToTruncation, 1);

  const decay = detectContentDecay([[row(['/b'], 90, 100)], [row(['/b'], 60, 100)], [row(['/a'], 5, 10)]], {
    minPeakClicks: 20,
    minDeclinePct: 20,
    limit: 10,
    truncatedWindows: [false, false, true],
  });
  assert.equal(decay.totalDecaying, 0);
  assert.equal(decay.unknownDueToTruncation, 1);
});

test('thresholds use unrounded values', () => {
  const drops = detectTrafficDrops(
    [{ keys: ['/p'], clicks: 5, impressions: 100, ctr: 0.05, position: 4.95 }],
    [{ keys: ['/p'], clicks: 10, impressions: 100, ctr: 0.1, position: 4.04 }],
    { minPreviousClicks: 1, minDropPct: 20, limit: 10 },
  );
  assert.equal(drops.drops[0].likelyCause, 'ctr_loss');

  const conflicts = findCannibalization(
    [row(['q', '/a'], 1, 9004), row(['q', '/b'], 1, 996)],
    { minQueryImpressions: 1, minPageShare: 0.1, limit: 10 },
  );
  assert.equal(conflicts.totalConflicts, 0);
});

test('detectContentDecay requires a decline in every window', () => {
  const result = detectContentDecay(
    [
      [row(['/decay'], 100, 1000), row(['/spike'], 100, 1000), row(['/tiny'], 3, 10)],
      [row(['/decay'], 70, 1000), row(['/spike'], 50, 1000), row(['/tiny'], 2, 10)],
      [row(['/decay'], 40, 1000), row(['/spike'], 80, 1000), row(['/tiny'], 1, 10)],
    ],
    { minPeakClicks: 20, minDeclinePct: 20, limit: 10 },
  );
  assert.deepEqual(result.pages.map((page) => page.page), ['/decay']);
  assert.deepEqual(result.pages[0].clicksByWindow, [100, 70, 40]);
  assert.equal(result.pages[0].declinePct, 60);
});

test('findCannibalization ignores pages below the impression share', () => {
  const result = findCannibalization(
    [
      row(['seo', '/a'], 10, 600),
      row(['seo', '/b'], 20, 380),
      row(['seo', '/c'], 0, 20),
      row(['solo', '/a'], 10, 500),
    ],
    { minQueryImpressions: 100, minPageShare: 0.1, limit: 10 },
  );
  assert.equal(result.totalConflicts, 1);
  assert.equal(result.conflicts[0].primaryPage, '/b');
  assert.deepEqual(result.conflicts[0].pages.map((page) => page.page), ['/b', '/a']);
});

test('findCtrOpportunities uses the median CTR of the same position', () => {
  const rows = [10, 10, 10, 10, 1].map((clicks, index) =>
    row([`query-${index}`, `/page-${index}`], clicks, 100, 3),
  );
  const result = findCtrOpportunities(rows, {
    minImpressions: 100,
    maxPosition: 20,
    minCtrGapPct: 30,
    limit: 10,
  });
  assert.equal(result.totalOpportunities, 1);
  assert.equal(result.opportunities[0].query, 'query-4');
  assert.equal(result.opportunities[0].estimatedMissedClicks, 9);
});

test('findCtrOpportunities skips positions with too few rows', () => {
  const result = findCtrOpportunities([row(['q', '/p'], 0, 1000, 2)], {
    minImpressions: 100,
    maxPosition: 20,
    minCtrGapPct: 30,
    limit: 10,
  });
  assert.equal(result.totalOpportunities, 0);
});

test('splitBrandedQueries reports traffic that cannot be classified', () => {
  const result = splitBrandedQueries(
    [row(['Acme pricing'], 30, 100), row(['seo tools'], 10, 100)],
    ['acme'],
    { clicks: 50, impressions: 260 },
    5,
  );
  assert.equal(result.branded.clicks, 30);
  assert.equal(result.nonBranded.clicks, 10);
  assert.equal(result.branded.clickShare, 0.75);
  assert.equal(result.unattributed.clicks, 10);
  assert.equal(result.unattributed.impressions, 60);
});
