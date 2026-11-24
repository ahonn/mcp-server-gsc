import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { PROMPTS, renderPrompt } from './prompts.js';
import { SearchConsoleService } from './search-console.js';
import { TOOLS, type SearchConsoleClient } from './tools.js';

export interface ServerOptions {
  /**
   * Allow tools that change Search Console (submit or delete a sitemap, add or
   * remove a site). When false, the server asks Google for the read-only scope
   * and these tools return an error explaining how to turn them on.
   */
  allowWrite?: boolean;
  /** Replaces the Google client. Tests use this to avoid network calls. */
  client?: SearchConsoleClient;
}

const WRITE_DISABLED_MESSAGE =
  'This tool changes Search Console and is turned off. Set GSC_ALLOW_WRITE=true to allow it. ' +
  'The account also needs Full or Owner permission on the property.';

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
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      // Clients send tool input, so publish the schema before transforms and defaults.
      inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }) as {
        type: 'object';
        [key: string]: unknown;
      },
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map(({ name, title, description, arguments: promptArguments }) => ({
      name,
      title,
      description,
      arguments: promptArguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) =>
    renderPrompt(request.params.name, request.params.arguments),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const tool = TOOLS.find((candidate) => candidate.name === request.params.name);
      if (!tool) {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }
      if (tool.write && !allowWrite) {
        throw new Error(WRITE_DISABLED_MESSAGE);
      }

      const client = options.client ?? new SearchConsoleService(credentials, { allowWrite });
      // MCP allows a call without arguments, for example list_sites.
      const result = await tool.run(request.params.arguments ?? {}, client);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid arguments: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        );
      }
      throw error;
    }
  });

  return server;
}
