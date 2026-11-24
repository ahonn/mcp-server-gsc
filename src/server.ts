import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  GetSitemapSchema,
  IndexInspectSchema,
  ListSitemapsSchema,
  SearchAnalyticsSchema,
  EnhancedSearchAnalyticsSchema,
  QuickWinsDetectionSchema,
  SubmitSitemapSchema,
  DeleteSitemapSchema,
  SiteSchema,
} from './schemas.js';
import { z } from 'zod';
import { SearchConsoleService } from './search-console.js';

export interface ServerOptions {
  /**
   * Allow tools that change Search Console (submit or delete a sitemap, add or
   * remove a site). When false, the server asks Google for the read-only scope
   * and these tools return an error explaining how to turn them on.
   */
  allowWrite?: boolean;
}

const WRITE_TOOLS = new Set(['submit_sitemap', 'delete_sitemap', 'add_site', 'delete_site']);

const WRITE_DISABLED_MESSAGE =
  'This tool changes Search Console and is turned off. Set GSC_ALLOW_WRITE=true to allow it. ' +
  'The service account also needs Full or Owner permission on the property.';

export function createServer(credentials: string, options: ServerOptions = {}): Server {
  const allowWrite = options.allowWrite ?? false;
  if (!credentials) {
    throw new Error('credentials parameter is required');
  }

  const server = new Server(
    {
      name: 'mcp-server-gsc',
      version: '0.3.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_sites',
          description: 'List all sites in Google Search Console',
          inputSchema: zodToJsonSchema(z.object({})),
        },
        {
          name: 'search_analytics',
          description: 'Get search performance data from Google Search Console',
          inputSchema: zodToJsonSchema(SearchAnalyticsSchema),
        },
        {
          name: 'enhanced_search_analytics',
          description: 'Enhanced search analytics with up to 25,000 rows, regex filters, and quick wins detection',
          inputSchema: zodToJsonSchema(EnhancedSearchAnalyticsSchema),
        },
        {
          name: 'detect_quick_wins',
          description: 'Automatically detect SEO quick wins and optimization opportunities',
          inputSchema: zodToJsonSchema(QuickWinsDetectionSchema),
        },
        {
          name: 'index_inspect',
          description: 'Inspect a URL to see if it is indexed or can be indexed',
          inputSchema: zodToJsonSchema(IndexInspectSchema),
        },
        {
          name: 'list_sitemaps',
          description: 'List sitemaps for a site in Google Search Console',
          inputSchema: zodToJsonSchema(ListSitemapsSchema),
        },
        {
          name: 'get_sitemap',
          description: 'Get a sitemap for a site in Google Search Console',
          inputSchema: zodToJsonSchema(GetSitemapSchema),
        },
        {
          name: 'submit_sitemap',
          description:
            'Submit a sitemap for a site in Google Search Console. Google fetches it again right away. Needs GSC_ALLOW_WRITE=true',
          inputSchema: zodToJsonSchema(SubmitSitemapSchema),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        {
          name: 'delete_sitemap',
          description:
            'Remove a sitemap from a site in Google Search Console. The URLs in it stay indexed. Needs GSC_ALLOW_WRITE=true',
          inputSchema: zodToJsonSchema(DeleteSitemapSchema),
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        },
        {
          name: 'add_site',
          description:
            'Add a site to the set of sites in Google Search Console. It still has to be verified before data shows up. Needs GSC_ALLOW_WRITE=true',
          inputSchema: zodToJsonSchema(SiteSchema),
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        },
        {
          name: 'delete_site',
          description:
            "Remove a site from this account's set of sites in Google Search Console. Needs GSC_ALLOW_WRITE=true",
          inputSchema: zodToJsonSchema(SiteSchema),
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (!request.params.arguments) {
        throw new Error('Arguments are required');
      }

      if (WRITE_TOOLS.has(request.params.name) && !allowWrite) {
        throw new Error(WRITE_DISABLED_MESSAGE);
      }

      const searchConsole = new SearchConsoleService(credentials, { allowWrite });

      switch (request.params.name) {
        case 'enhanced_search_analytics': {
          const args = EnhancedSearchAnalyticsSchema.parse(request.params.arguments);
          const siteUrl = args.siteUrl;

          // Build enhanced request body
          const requestBody: any = {
            startDate: args.startDate,
            endDate: args.endDate,
            dimensions: args.dimensions,
            searchType: args.type,
            aggregationType: args.aggregationType,
            rowLimit: args.rowLimit, // Up to 25,000!
          };

          // Build filters (including regex support)
          const filters = [];
          if (args.pageFilter) {
            filters.push({
              dimension: 'page',
              operator: args.filterOperator,
              expression: args.pageFilter,
            });
          }
          if (args.queryFilter) {
            filters.push({
              dimension: 'query',
              operator: args.filterOperator,
              expression: args.queryFilter,
            });
          }
          if (args.countryFilter) {
            filters.push({
              dimension: 'country',
              operator: 'equals',
              expression: args.countryFilter,
            });
          }
          if (args.deviceFilter) {
            filters.push({
              dimension: 'device',
              operator: 'equals',
              expression: args.deviceFilter,
            });
          }

          if (filters.length > 0) {
            requestBody.dimensionFilterGroups = [{ groupType: 'and', filters }];
          }

          // Call enhanced search analytics
          const enhancedOptions = {
            regexFilter: args.regexFilter,
            enableQuickWins: args.enableQuickWins,
            quickWinsThresholds: args.quickWinsThresholds,
          };

          const response = await searchConsole.enhancedSearchAnalytics(siteUrl, requestBody, enhancedOptions);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'detect_quick_wins': {
          const args = QuickWinsDetectionSchema.parse(request.params.arguments);

          // First get search analytics data
          const requestBody: any = {
            startDate: args.startDate,
            endDate: args.endDate,
            dimensions: ['query', 'page'],
            rowLimit: 25000, // Maximum for comprehensive analysis
          };

          const searchResponse = await searchConsole.searchAnalytics(args.siteUrl, requestBody);

          if (!searchResponse.data.rows) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ message: 'No data available for quick wins analysis' }, null, 2),
                },
              ],
            };
          }

          // Apply quick wins detection
          const quickWinsOptions = {
            enableQuickWins: true,
            quickWinsThresholds: {
              minImpressions: args.minImpressions,
              maxCtr: args.maxCtr,
              positionRangeMin: args.positionRangeMin,
              positionRangeMax: args.positionRangeMax,
            },
          };

          const enhancedResult = await searchConsole.enhancedSearchAnalytics(
            args.siteUrl,
            requestBody,
            quickWinsOptions
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  quickWins: (enhancedResult.data as any).quickWins,
                  totalOpportunities: (enhancedResult.data as any).quickWins?.length || 0,
                  thresholds: quickWinsOptions.quickWinsThresholds,
                  analysis: 'Quick wins detection completed'
                }, null, 2),
              },
            ],
          };
        }

        case 'search_analytics': {
          const args = SearchAnalyticsSchema.parse(request.params.arguments);
          const siteUrl = args.siteUrl;

          // --- 动态构建请求体 ---
          const requestBody: any = {
            startDate: args.startDate,
            endDate: args.endDate,
            dimensions: args.dimensions,
            searchType: args.type,
            aggregationType: args.aggregationType,
            rowLimit: args.rowLimit,
          };

          const filters = [];
          if (args.pageFilter) {
            filters.push({
              dimension: 'page',
              operator: args.filterOperator,
              expression: args.pageFilter,
            });
          }
          if (args.queryFilter) {
            filters.push({
              dimension: 'query',
              operator: args.filterOperator,
              expression: args.queryFilter,
            });
          }
          if (args.countryFilter) {
              filters.push({
                dimension: 'country',
                operator: 'equals', // Country filter only supports 'equals'
                expression: args.countryFilter,
              });
          }
          if (args.deviceFilter) {
              filters.push({
                dimension: 'device',
                operator: 'equals', // Device filter only supports 'equals'
                expression: args.deviceFilter,
              });
          }

          if (filters.length > 0) {
            requestBody.dimensionFilterGroups = [{ filters }];
          }
          // --- 构建结束 ---

          const response = await searchConsole.searchAnalytics(siteUrl, requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'list_sites': {
          const response = await searchConsole.listSites();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'index_inspect': {
          const args = IndexInspectSchema.parse(request.params.arguments);
          const requestBody = {
            siteUrl: args.siteUrl,
            inspectionUrl: args.inspectionUrl,
            languageCode: args.languageCode,
          };
          const response = await searchConsole.indexInspect(requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'list_sitemaps': {
          const args = ListSitemapsSchema.parse(request.params.arguments);
          const requestBody = {
            siteUrl: args.siteUrl,
            sitemapIndex: args.sitemapIndex,
          };
          const response = await searchConsole.listSitemaps(requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'get_sitemap': {
          const args = GetSitemapSchema.parse(request.params.arguments);
          const requestBody = {
            siteUrl: args.siteUrl,
            feedpath: args.feedpath,
          };
          const response = await searchConsole.getSitemap(requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'submit_sitemap': {
          const args = SubmitSitemapSchema.parse(request.params.arguments);
          const requestBody = {
            siteUrl: args.siteUrl,
            feedpath: args.feedpath,
          };
          await searchConsole.submitSitemap(requestBody);
          // Google answers an empty body on success, so say what happened.
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ submitted: true, siteUrl: args.siteUrl, feedpath: args.feedpath }, null, 2),
              },
            ],
          };
        }

        case 'delete_sitemap': {
          const args = DeleteSitemapSchema.parse(request.params.arguments);
          await searchConsole.deleteSitemap({ siteUrl: args.siteUrl, feedpath: args.feedpath });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ deleted: true, siteUrl: args.siteUrl, feedpath: args.feedpath }, null, 2),
              },
            ],
          };
        }

        case 'add_site': {
          const args = SiteSchema.parse(request.params.arguments);
          await searchConsole.addSite(args.siteUrl);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ added: true, siteUrl: args.siteUrl }, null, 2),
              },
            ],
          };
        }

        case 'delete_site': {
          const args = SiteSchema.parse(request.params.arguments);
          await searchConsole.deleteSite(args.siteUrl);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ deleted: true, siteUrl: args.siteUrl }, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        );
      }
      throw error;
    }
  });

  return server;
}
