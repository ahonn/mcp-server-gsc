#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  defaultTokenPath,
  resolveCredentials,
  runAuthCommand,
  savedTokenScope,
} from './oauth-login.js';
import { READ_WRITE_SCOPE } from './search-console.js';
import { createServer } from './server.js';

async function runServer() {
  const explicitCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credentials = resolveCredentials(explicitCredentials);
  if (!credentials) {
    console.error(
      'No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or run: mcp-server-gsc auth login --client-secret <file>',
    );
    process.exit(1);
  }

  const allowWrite = process.env.GSC_ALLOW_WRITE === 'true';
  if (
    allowWrite &&
    !explicitCredentials &&
    (await savedTokenScope(defaultTokenPath())) !== READ_WRITE_SCOPE
  ) {
    console.error('The saved login is read-only. Run auth login with --write to use write tools.');
  }

  const server = createServer(credentials, { allowWrite });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Google Search Console MCP Server running on stdio');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'auth') {
    process.exitCode = await runAuthCommand(args);
    return;
  }
  await runServer();
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
