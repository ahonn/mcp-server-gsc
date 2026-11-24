import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { StreamableHTTPTransport } from '@hono/mcp';
import { createServer } from './server.js';
import { HOME_PAGE, PAGE_SECURITY_HEADERS, PRIVACY_PAGE } from './site.js';

type Bindings = {
  GOOGLE_CREDENTIALS: string;
  MCP_API_TOKEN?: string;
  CORS_ORIGIN?: string;
  GSC_ALLOW_WRITE?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/mcp', async (c, next) => {
  const origin = c.env.CORS_ORIGIN || '*';
  return cors({ origin })(c, next);
});

app.use('/mcp', async (c, next) => {
  const token = c.env.MCP_API_TOKEN;
  // Fail closed: the service account's Search Console data must never be public.
  if (!token) {
    return c.json({ error: 'MCP_API_TOKEN secret is not configured' }, 500);
  }
  return bearerAuth({ token })(c as unknown as Context, next);
});

app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/', (c) => c.html(HOME_PAGE, 200, PAGE_SECURITY_HEADERS));
app.get('/privacy', (c) => c.html(PRIVACY_PAGE, 200, PAGE_SECURITY_HEADERS));

app.all('/mcp', async (c) => {
  if (!c.env.GOOGLE_CREDENTIALS) {
    return c.json({ error: 'GOOGLE_CREDENTIALS secret is not configured' }, 500);
  }

  const server = createServer(c.env.GOOGLE_CREDENTIALS, {
    allowWrite: c.env.GSC_ALLOW_WRITE === 'true',
  });
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });

  transport.onclose = () => {
    server.close().catch(() => {});
  };

  await server.connect(transport);
  return transport.handleRequest(c);
});

export default app;
