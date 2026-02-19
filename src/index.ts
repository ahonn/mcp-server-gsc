#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function runServer() {
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentials) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS environment variable is required');
    process.exit(1);
  }

  const server = createServer(credentials);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Search Console MCP Server running on stdio');
}

runServer().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
