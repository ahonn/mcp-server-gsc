import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { pacedMap } from '../src/paced-map.js';
import { PROMPTS, renderPrompt } from '../src/prompts.js';
import { SearchAnalyticsSchema } from '../src/schemas.js';
import { SearchConsoleService } from '../src/search-console.js';
import { buildSearchRequest, paginationInfo } from '../src/search-request.js';
import { createServer } from '../src/server.js';
import { TOOLS, type SearchConsoleClient } from '../src/tools.js';

async function connect(client: Partial<SearchConsoleClient>, allowWrite = false) {
  const server = createServer('{}', { allowWrite, client: client as SearchConsoleClient });
  const mcpClient = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

const parseResult = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((result.content as Array<{ text: string }>)[0].text);

const baseArgs = { siteUrl: 'sc-domain:example.com', startDate: '2026-03-01', endDate: '2026-03-02' };

test('buildSearchRequest selects hourly_all for the hour dimension', () => {
  const body = buildSearchRequest(SearchAnalyticsSchema.parse({ ...baseArgs, dimensions: 'hour,page' }));
  assert.equal(body.dataState, 'hourly_all');
  assert.deepEqual(body.dimensions, ['hour', 'page']);
});

test('buildSearchRequest rejects invalid hourly combinations', () => {
  assert.throws(() =>
    buildSearchRequest(SearchAnalyticsSchema.parse({ ...baseArgs, dimensions: 'hour', dataState: 'final' })),
  );
  assert.throws(() =>
    buildSearchRequest(SearchAnalyticsSchema.parse({ ...baseArgs, dimensions: 'page', dataState: 'hourly_all' })),
  );
});

test('buildSearchRequest sends all filters in one group', () => {
  const body = buildSearchRequest(
    SearchAnalyticsSchema.parse({
      ...baseArgs,
      type: 'webMultimodal',
      startRow: 500,
      pageFilter: '/blog/',
      filterOperator: 'contains',
      regexFilter: 'a|b',
      searchAppearanceFilter: 'VIDEO',
    }),
  );
  assert.equal(body.type, 'webMultimodal');
  assert.equal(body.startRow, 500);
  assert.deepEqual(
    body.dimensionFilterGroups?.[0].filters.map((filter) => [filter.dimension, filter.operator]),
    [
      ['page', 'contains'],
      ['query', 'includingRegex'],
      ['searchAppearance', 'equals'],
    ],
  );
});

test('buildSearchRequest rejects a branded filter with a query filter', () => {
  assert.throws(() =>
    buildSearchRequest(
      SearchAnalyticsSchema.parse({ ...baseArgs, brandedClassificationFilter: 'BRANDED', queryFilter: 'x' }),
    ),
  );
});

test('paginationInfo reports the next offset only after a full page', () => {
  assert.equal(paginationInfo(100, 50, 50).nextStartRow, 150);
  assert.equal(paginationInfo(100, 50, 20).nextStartRow, null);
});

test('queryAllRows continues after a short page and stops on an empty page', async () => {
  const service = new SearchConsoleService('{"type":"service_account"}');
  const offsets: number[] = [];
  const exactSite: unknown[] = [];
  const pageSizes = new Map([
    [0, 25000],
    [25000, 10],
    [25010, 5],
  ]);
  service.searchAnalytics = (async (
    _site: string,
    body: { startRow: number },
    options: { exactSite?: boolean },
  ) => {
    offsets.push(body.startRow);
    exactSite.push(options.exactSite);
    const size = pageSizes.get(body.startRow) ?? 0;
    return { data: { rows: Array.from({ length: size }, () => ({ clicks: 1 })) } };
  }) as unknown as typeof service.searchAnalytics;

  const rows = await service.queryAllRows('https://example.com/', {}, 60000);
  assert.equal(rows.length, 25015);
  assert.deepEqual(offsets, [0, 25000, 25010, 25015]);
  assert.ok(exactSite.every(Boolean));
});

test('queryAllRows does not read beyond maxRows', async () => {
  const service = new SearchConsoleService('{"type":"service_account"}');
  service.searchAnalytics = (async (_site: string, body: { rowLimit: number }) => ({
    data: { rows: Array.from({ length: body.rowLimit }, () => ({ clicks: 1 })) },
  })) as unknown as typeof service.searchAnalytics;
  assert.equal((await service.queryAllRows('sc-domain:example.com', {}, 30000)).length, 30000);
});

test('pacedMap keeps input order and honors the concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  const results = await pacedMap(
    [1, 2, 3, 4, 5, 6],
    { concurrency: 2, minIntervalMs: 1 },
    async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
    () => -1,
  );
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2);
});

test('tools/list publishes an object input schema for every tool', async () => {
  const client = await connect({});
  const { tools } = await client.listTools();
  assert.equal(tools.length, TOOLS.length);
  for (const tool of tools) assert.equal(tool.inputSchema.type, 'object');
  const search = tools.find((tool) => tool.name === 'search_analytics');
  assert.equal((search?.inputSchema.properties?.dimensions as { type: string }).type, 'string');
  assert.deepEqual(search?.inputSchema.required, ['siteUrl', 'startDate', 'endDate']);
});

test('list_sites works without arguments', async () => {
  const client = await connect({
    listSites: (async () => ({ data: { siteEntry: [{ siteUrl: 'sc-domain:example.com' }] } })) as never,
  });
  const result = parseResult(await client.callTool({ name: 'list_sites' }));
  assert.equal(result.siteEntry.length, 1);
});

test('write tools stay blocked without write access', async () => {
  let called = false;
  const client = await connect({
    deleteSite: (async () => {
      called = true;
    }) as never,
  });
  await assert.rejects(client.callTool({ name: 'delete_site', arguments: { siteUrl: 'sc-domain:example.com' } }));
  assert.equal(called, false);
});

test('batch_url_inspect stops after a quota error and keeps partial results', async () => {
  let calls = 0;
  const client = await connect({
    indexInspect: (async ({ inspectionUrl }: { inspectionUrl: string }) => {
      calls += 1;
      if (inspectionUrl.endsWith('/2')) {
        throw Object.assign(new Error('quota'), { response: { status: 429 } });
      }
      return { data: { inspectionResult: { indexStatusResult: { verdict: 'PASS' } } } };
    }) as never,
  });
  const urls = Array.from({ length: 30 }, (_, index) => `https://example.com/${index + 1}`);
  const result = parseResult(
    await client.callTool({
      name: 'batch_url_inspect',
      arguments: { siteUrl: 'sc-domain:example.com', inspectionUrls: urls },
    }),
  );
  assert.equal(result.summary.quotaExceeded, true);
  assert.ok(result.summary.skipped > 0);
  assert.ok(calls < urls.length);
  assert.equal(result.results.length, urls.length);
});

test('multi_site_overview reports one failed property without failing the call', async () => {
  const client = await connect({
    listSites: (async () => ({
      data: { siteEntry: [{ siteUrl: 'sc-domain:ok.com' }, { siteUrl: 'sc-domain:bad.com' }] },
    })) as never,
    searchAnalytics: (async (siteUrl: string) => {
      if (siteUrl.includes('bad')) throw new Error('denied');
      return { data: { rows: [{ clicks: 5, impressions: 50, ctr: 0.1, position: 3 }] } };
    }) as never,
  });
  const result = parseResult(
    await client.callTool({
      name: 'multi_site_overview',
      arguments: { startDate: '2026-03-08', endDate: '2026-03-14' },
    }),
  );
  assert.deepEqual(result.summary, { sites: 2, failed: 1 });
  assert.equal(result.totals, undefined);
  assert.equal(result.sites[0].siteUrl, 'sc-domain:ok.com');
});

test('prompts render with dates that account for the data delay', async () => {
  const client = await connect({});
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((prompt) => prompt.name), PROMPTS.map((prompt) => prompt.name));

  const rendered = renderPrompt(
    'weekly_seo_report',
    { siteUrl: 'sc-domain:example.com', brandTerms: 'acme, acme app' },
    new Date('2026-03-20T12:00:00Z'),
  );
  const text = rendered.messages[0].content.text;
  assert.match(text, /2026-03-11 to 2026-03-17/);
  assert.match(text, /2026-03-04 to 2026-03-10/);
  assert.match(text, /\["acme","acme app"\]/);
  assert.throws(() => renderPrompt('weekly_seo_report', {}));
  assert.throws(() => renderPrompt('diagnose_traffic_drop', { siteUrl: 'x', days: '0' }));
});

test('the MCPB manifest lists every tool', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    manifest.tools.map((tool: { name: string }) => tool.name).sort(),
    TOOLS.map((tool) => tool.name).sort(),
  );
});
