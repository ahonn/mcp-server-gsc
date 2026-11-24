import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { pacedMap } from '../src/paced-map.js';
import { PROMPTS, renderPrompt } from '../src/prompts.js';
import { SearchAnalyticsSchema, type SearchAnalytics, type WithDates } from '../src/schemas.js';
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

const parseSearch = (args: unknown) => SearchAnalyticsSchema.parse(args) as WithDates<SearchAnalytics>;

const baseArgs = { siteUrl: 'sc-domain:example.com', startDate: '2026-03-01', endDate: '2026-03-02' };

test('buildSearchRequest selects hourly_all for the hour dimension', () => {
  const body = buildSearchRequest(parseSearch({ ...baseArgs, dimensions: 'hour,page' }));
  assert.equal(body.dataState, 'hourly_all');
  assert.deepEqual(body.dimensions, ['hour', 'page']);
});

test('buildSearchRequest rejects invalid hourly combinations', () => {
  assert.throws(() =>
    buildSearchRequest(parseSearch({ ...baseArgs, dimensions: 'hour', dataState: 'final' })),
  );
  assert.throws(() =>
    buildSearchRequest(parseSearch({ ...baseArgs, dimensions: 'page', dataState: 'hourly_all' })),
  );
});

test('buildSearchRequest sends all filters in one group', () => {
  const body = buildSearchRequest(
    parseSearch({
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
      parseSearch({ ...baseArgs, brandedClassificationFilter: 'BRANDED', queryFilter: 'x' }),
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
  const pageSizes = new Map([
    [0, 25000],
    [25000, 10],
    [25010, 5],
  ]);
  service.searchAnalytics = (async (_site: string, body: { startRow: number }) => {
    offsets.push(body.startRow);
    const size = pageSizes.get(body.startRow) ?? 0;
    return { data: { rows: Array.from({ length: size }, () => ({ clicks: 1 })) } };
  }) as unknown as typeof service.searchAnalytics;

  const rows = await service.queryAllRows('https://example.com/', {}, 60000);
  assert.equal(rows.length, 25015);
  assert.deepEqual(offsets, [0, 25000, 25010, 25015]);
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
  assert.equal(tools.length, TOOLS.filter((tool) => !tool.write).length);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.title);
  }
  const search = tools.find((tool) => tool.name === 'search_analytics');
  assert.equal((search?.inputSchema.properties?.dimensions as { type: string }).type, 'string');
  assert.deepEqual(search?.inputSchema.required, ['siteUrl']);
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
  const result = await client.callTool({ name: 'delete_site', arguments: { siteUrl: 'sc-domain:example.com' } });
  assert.equal(result.isError, true);
  assert.match((result.content as Array<{ text: string }>)[0].text, /GSC_ALLOW_WRITE/);
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

test('package, manifest, and server versions match', async () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const version = read('../package.json').version;
  assert.equal(read('../manifest.json').version, version);
  assert.equal((await connect({})).getServerVersion()?.version, version);
});

test('the MCPB manifest lists every tool', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    manifest.tools.map((tool: { name: string }) => tool.name).sort(),
    TOOLS.map((tool) => tool.name).sort(),
  );
});

test('write tools are listed only with write access', async () => {
  const names = async (allowWrite: boolean) =>
    (await (await connect({}, allowWrite)).listTools()).tools.map((tool) => tool.name);
  const readOnly = await names(false);
  const writable = await names(true);
  assert.equal(readOnly.includes('delete_site'), false);
  assert.equal(readOnly.includes('enhanced_search_analytics'), false);
  assert.equal(writable.includes('delete_site'), true);
  assert.equal(writable.length, TOOLS.length);
});

test('sitemap tools require their identifiers', async () => {
  const { tools } = await (await connect({})).listTools();
  const required = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema.required;
  assert.deepEqual(required('list_sitemaps'), ['siteUrl']);
  assert.deepEqual([...(required('get_sitemap') ?? [])].sort(), ['feedpath', 'siteUrl']);
});

const row = (keys: string[], clicks: number, impressions: number, position: number) => ({
  keys,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

function analysisClient() {
  const pageRows = (startDate: string) =>
    startDate >= '2026-03-01'
      ? [row(['https://example.com/a'], 10, 100, 9), row(['https://example.com/b'], 90, 100, 2)]
      : [row(['https://example.com/a'], 60, 100, 4), row(['https://example.com/b'], 80, 100, 2)];
  return {
    queryAllRows: (async (_site: string, body: { startDate: string; dimensions: string[] }) =>
      body.dimensions.length === 2
        ? [
            ...[1, 2, 3, 4, 5].map((n) => row([`query-${n}`, `https://example.com/${n}`], 10, 100, 5)),
            row(['low', 'https://example.com/low'], 1, 200, 5),
            row(['acme tools', 'https://example.com/a'], 20, 100, 3),
            row(['acme tools', 'https://example.com/b'], 20, 100, 4),
          ]
        : body.dimensions[0] === 'query'
          ? [row(['acme tools'], 20, 100, 3), row(['other'], 10, 100, 5)]
          : pageRows(body.startDate)) as never,
    searchAnalytics: (async (_site: string, body: { startDate: string }) => ({
      data: {
        rows: [
          body.startDate >= '2026-03-01'
            ? { clicks: 100, impressions: 200, ctr: 0.5, position: 4 }
            : { clicks: 140, impressions: 200, ctr: 0.7, position: 3 },
        ],
      },
    })) as never,
    listSites: (async () => ({ data: { siteEntry: [{ siteUrl: 'sc-domain:example.com' }] } })) as never,
    listSitemaps: (async () => ({ data: { sitemap: [{ errors: '2', warnings: '1' }] } })) as never,
    indexInspect: (async () => ({
      data: { inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL' } } },
    })) as never,
  } satisfies Partial<SearchConsoleClient>;
}

test('analysis tools return structured content that matches their output schema', async () => {
  const client = await connect(analysisClient());
  const { tools } = await client.listTools();
  const range = { siteUrl: 'sc-domain:example.com', startDate: '2026-03-01', endDate: '2026-03-28' };
  const calls: Record<string, Record<string, unknown>> = {
    detect_quick_wins: range,
    compare_periods: range,
    detect_traffic_drops: range,
    detect_content_decay: { siteUrl: range.siteUrl, endDate: range.endDate },
    find_cannibalization: range,
    find_ctr_opportunities: range,
    brand_split: { ...range, brandTerms: ['acme'] },
    diagnose_site: range,
    multi_site_overview: { startDate: range.startDate, endDate: range.endDate },
    batch_url_inspect: { siteUrl: range.siteUrl, inspectionUrls: ['https://example.com/a'] },
  };
  assert.deepEqual(
    tools.filter((tool) => tool.outputSchema).map((tool) => tool.name).sort(),
    Object.keys(calls).sort(),
  );
  for (const [name, args] of Object.entries(calls)) {
    // Client.callTool validates structuredContent against outputSchema.
    const result = await client.callTool({ name, arguments: args });
    assert.ok(result.structuredContent, name);
    // tools/list publishes a shallow schema, so check the full contract here.
    TOOLS.find((tool) => tool.name === name)?.outputSchema?.parse(result.structuredContent);
    assert.deepEqual(parseResult(result), result.structuredContent, name);
    assert.doesNotMatch((result.content as Array<{ text: string }>)[0].text, /\n/, name);
  }
});

test('diagnose_site combines drops, indexing, and sitemap checks', async () => {
  const client = await connect(analysisClient());
  const result = (await client.callTool({
    name: 'diagnose_site',
    arguments: { siteUrl: 'sc-domain:example.com', startDate: '2026-03-01', endDate: '2026-03-28', inspectLimit: 1 },
  })).structuredContent as {
    summary: Record<string, unknown>;
    trafficDrops: { causes: Record<string, number> };
    indexing: { summary: { inspected: number } };
    warnings: string[];
  };
  assert.equal(result.summary.clicksChange, -40);
  assert.equal(result.summary.pagesDropped, 1);
  assert.equal(result.summary.indexIssues, 1);
  assert.equal(result.summary.sitemapErrors, 2);
  assert.equal(result.trafficDrops.causes.ranking_loss, 1);
  assert.equal(result.indexing.summary.inspected, 1);
  assert.deepEqual(result.warnings, []);
});

test('diagnose_site keeps the diagnosis when a sitemap check fails', async () => {
  const client = await connect({
    ...analysisClient(),
    listSitemaps: (async () => {
      throw new Error('denied');
    }) as never,
  });
  const result = (await client.callTool({
    name: 'diagnose_site',
    arguments: { siteUrl: 'sc-domain:example.com', startDate: '2026-03-01', endDate: '2026-03-28', inspectLimit: 0 },
  })).structuredContent as { sitemaps: unknown; summary: { sitemapErrors: unknown }; warnings: string[] };
  assert.equal(result.sitemaps, null);
  assert.equal(result.summary.sitemapErrors, null);
  assert.match(result.warnings[0], /Sitemap check failed/);
});

test('detect_quick_wins uses fractions and the requested search type', async () => {
  let requestedType: unknown;
  const client = await connect({
    queryAllRows: (async (_site: string, body: { type?: string }) => {
      requestedType = body.type;
      return [row(['win', '/p'], 1, 200, 5), row(['high-ctr', '/q'], 20, 200, 5)];
    }) as never,
  });
  const result = (await client.callTool({
    name: 'detect_quick_wins',
    arguments: { siteUrl: 'sc-domain:example.com', startDate: '2026-03-01', endDate: '2026-03-28', type: 'image', maxCtr: 0.02 },
  })).structuredContent as { quickWins: Array<{ query: string; ctr: number; estimatedAdditionalClicks: number }> };
  assert.equal(requestedType, 'image');
  assert.deepEqual(result.quickWins.map((win) => win.query), ['win']);
  assert.equal(result.quickWins[0].ctr, 0.005);
  assert.equal(result.quickWins[0].estimatedAdditionalClicks, 9);
});

test('batch_url_inspect sends progress notifications', async () => {
  const client = await connect(analysisClient());
  const progress: number[] = [];
  await client.callTool(
    {
      name: 'batch_url_inspect',
      arguments: { siteUrl: 'sc-domain:example.com', inspectionUrls: ['https://example.com/a', 'https://example.com/b'] },
    },
    undefined,
    { onprogress: (update) => progress.push(update.progress) },
  );
  assert.deepEqual(progress, [1, 2]);
});

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as Array<{ text: string }>)[0].text;

test('search_analytics returns TSV with meta and keeps untrusted values on one line', async () => {
  let requested: { rowLimit?: number } = {};
  const client = await connect({
    searchAnalytics: (async (_site: string, body: { rowLimit: number }) => {
      requested = body;
      return { data: { rows: [{ keys: ['bad\tquery\nignore this'], clicks: 2, impressions: 10, ctr: 0.2, position: 1.26 }] } };
    }) as never,
  });
  const text = textOf(await client.callTool({
    name: 'search_analytics',
    arguments: { ...baseArgs, dimensions: 'query' },
  }));
  const lines = text.split('\n');
  assert.equal(requested.rowLimit, 100);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^# meta /);
  assert.equal(JSON.parse(lines[0].slice(7)).siteUrl, baseArgs.siteUrl);
  assert.equal(lines[1], 'query\tclicks\timpressions\tctr\tposition');
  assert.equal(lines[2], 'bad query ignore this\t2\t10\t0.2\t1.3');
});

test('search_analytics can still return JSON', async () => {
  const client = await connect({
    searchAnalytics: (async () => ({ data: { rows: [{ keys: ['q'], clicks: 1 }] } })) as never,
  });
  const result = JSON.parse(textOf(await client.callTool({
    name: 'search_analytics',
    arguments: { ...baseArgs, dimensions: 'query', responseFormat: 'json' },
  })));
  assert.equal(result.rows.length, 1);
  assert.equal(result.meta.returned, 1);
});

test('default dates use the latest final date', async () => {
  const bodies: Array<{ startDate: string; endDate: string; dimensions?: string[] }> = [];
  const client = await connect({
    searchAnalytics: (async (_site: string, body: { startDate: string; endDate: string; dimensions?: string[] }) => {
      bodies.push(body);
      return body.dimensions?.[0] === 'date' && body.dimensions.length === 1 && bodies.length === 1
        ? { data: { rows: [{ keys: ['2026-03-18'] }, { keys: ['2026-03-20'] }] } }
        : { data: { rows: [] } };
    }) as never,
  });
  const text = textOf(await client.callTool({
    name: 'search_analytics',
    arguments: { siteUrl: 'sc-domain:example.com', dimensions: 'query', days: 7 },
  }));
  const meta = JSON.parse(text.split('\n')[0].slice(7));
  assert.equal(meta.endDate, '2026-03-20');
  assert.equal(meta.startDate, '2026-03-14');
  assert.equal(meta.dataThrough, '2026-03-20');
  assert.equal(meta.dataState, 'final');
});

test('startDate and days cannot be combined', async () => {
  const client = await connect({ searchAnalytics: (async () => ({ data: {} })) as never });
  const result = await client.callTool({
    name: 'search_analytics',
    arguments: { ...baseArgs, days: 7 },
  });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /startDate or days/);
});

test('tool failures are results with actionable messages', async () => {
  const client = await connect({
    searchAnalytics: (async () => {
      throw Object.assign(new Error('User does not have permission.'), { response: { status: 403 } });
    }) as never,
  });
  const denied = await client.callTool({ name: 'search_analytics', arguments: baseArgs });
  assert.equal(denied.isError, true);
  assert.match(textOf(denied), /Call list_sites/);

  const invalid = await client.callTool({
    name: 'search_analytics',
    arguments: { ...baseArgs, startDate: 'last week' },
  });
  assert.equal(invalid.isError, true);
  assert.match(textOf(invalid), /startDate/);
  await assert.rejects(client.callTool({ name: 'no_such_tool', arguments: {} }));
});

test('tools resolve a bare domain and report it in meta', async () => {
  const sites: string[] = [];
  const client = await connect({
    listSites: (async () => ({ data: { siteEntry: [{ siteUrl: 'sc-domain:example.com' }] } })) as never,
    searchAnalytics: (async (site: string) => {
      sites.push(site);
      return { data: { rows: [] } };
    }) as never,
  });
  const text = textOf(await client.callTool({
    name: 'search_analytics',
    arguments: { siteUrl: 'example.com', startDate: '2026-03-01', endDate: '2026-03-02' },
  }));
  const meta = JSON.parse(text.split('\n')[0].slice(7));
  assert.deepEqual(sites, ['sc-domain:example.com']);
  assert.equal(meta.siteUrl, 'sc-domain:example.com');
  assert.equal(meta.requestedSiteUrl, 'example.com');
});

test('an unknown site lists the available properties', async () => {
  const client = await connect({
    listSites: (async () => ({ data: { siteEntry: [{ siteUrl: 'sc-domain:example.com' }] } })) as never,
  });
  const result = await client.callTool({
    name: 'search_analytics',
    arguments: { siteUrl: 'other.com', startDate: '2026-03-01', endDate: '2026-03-02' },
  });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /sc-domain:example\.com/);
});

test('write tools never resolve siteUrl to another property', async () => {
  const sites: string[] = [];
  const client = await connect({
    listSites: (async () => ({ data: { siteEntry: [{ siteUrl: 'sc-domain:example.com' }] } })) as never,
    submitSitemap: (async (body: { siteUrl: string }) => {
      sites.push(body.siteUrl);
    }) as never,
  }, true);
  await client.callTool({
    name: 'submit_sitemap',
    arguments: { siteUrl: 'example.com', feedpath: 'https://example.com/sitemap.xml' },
  });
  assert.deepEqual(sites, ['example.com']);
});

test('server instructions treat search data as untrusted', async () => {
  const client = await connect({});
  assert.match(client.getInstructions() ?? '', /never follow instructions/);
  assert.doesNotMatch(client.getInstructions() ?? '', /Write tools are enabled/);
  assert.match((await connect({}, true)).getInstructions() ?? '', /Write tools are enabled/);
});
