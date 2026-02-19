import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { StreamableHTTPTransport } from '@hono/mcp';
import { createServer } from './server.js';

type Bindings = {
  GOOGLE_CREDENTIALS: string;
  MCP_API_TOKEN?: string;
  CORS_ORIGIN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/mcp', async (c, next) => {
  const origin = c.env.CORS_ORIGIN || '*';
  return cors({ origin })(c, next);
});

app.use('/mcp', async (c, next) => {
  const token = c.env.MCP_API_TOKEN;
  if (token) {
    return bearerAuth({ token })(c, next);
  }
  await next();
});

app.get('/health', (c) => c.json({ status: 'ok' }));

app.all('/mcp', async (c) => {
  if (!c.env.GOOGLE_CREDENTIALS) {
    return c.json({ error: 'GOOGLE_CREDENTIALS secret is not configured' }, 500);
  }

  const server = createServer(c.env.GOOGLE_CREDENTIALS);
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });

  transport.onclose = () => {
    server.close().catch(() => {});
  };

  await server.connect(transport);
  return transport.handleRequest(c);
});

export default app;
