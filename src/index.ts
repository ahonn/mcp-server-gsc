#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
// @ts-ignore
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  GetSitemapSchema,
  IndexInspectSchema,
  ListSitemapsSchema,
  SearchAnalyticsSchema,
  EnhancedSearchAnalyticsSchema,
  QuickWinsDetectionSchema,
  SubmitSitemapSchema,
} from './schemas.js';
import { z } from 'zod';
import { SearchConsoleService } from './search-console.js';

const server = new Server(
  {
    name: 'gsc-mcp-server-enhanced',
    version: '0.2.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  },
);

const GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS environment variable is required');
  process.exit(1);
}

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
        description: 'Submit a sitemap for a site in Google Search Console',
        inputSchema: zodToJsonSchema(SubmitSitemapSchema),
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (!request.params.arguments) {
      throw new Error('Arguments are required');
    }

    const searchConsole = new SearchConsoleService(GOOGLE_APPLICATION_CREDENTIALS);

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
        const response = await searchConsole.submitSitemap(requestBody);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
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

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Search Console MCP Server running on stdio');
}

runServer().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});