import type { ConsentDescription, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { StreamableHTTPTransport } from '@hono/mcp';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createServer } from './server.js';
import { HOME_PAGE, PAGE_SECURITY_HEADERS, PRIVACY_PAGE, renderPage } from './site.js';

export const OAUTH_SCOPE = 'gsc';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

// The form action is left open because the approval redirects to Google and a denial
// redirects to the MCP client, and browsers apply form-action to those redirects.
const CONSENT_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";

export interface RemoteEnv {
  GOOGLE_CREDENTIALS?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  ALLOWED_EMAILS?: string;
  /** Canonical origin, such as https://gsc.example.com. Defaults to the request origin. */
  PUBLIC_URL?: string;
  OAUTH_KV?: unknown;
  CORS_ORIGIN?: string;
  GSC_ALLOW_WRITE?: string;
  /** Injected by OAuthProvider. */
  OAUTH_PROVIDER?: OAuthHelpers;
}

export interface McpProps {
  email: string;
}

interface AuthorizationFailure {
  description: string;
  redirectTo?: string;
}

/** The library imports `cloudflare:workers`, so the Worker entry point supplies these values. */
export interface RemoteAppDependencies {
  isAuthorizationError(error: unknown): error is AuthorizationFailure;
  authorizationErrorRedirect(
    request: { redirectUri: string; state?: string; issuer?: string },
    code: 'access_denied' | 'server_error',
    description?: string,
  ): string;
}

interface UpstreamData {
  verifier: string;
  nonce: string;
}

export function isOAuthConfigured(env: RemoteEnv): boolean {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.OAUTH_KV &&
      parseAllowedEmails(env.ALLOWED_EMAILS).size > 0,
  );
}

export function parseAllowedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canonicalOrigin(env: RemoteEnv, requestUrl: string): string {
  return env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : new URL(requestUrl).origin;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomToken = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * Validates the claims of an ID token received directly from Google's token endpoint.
 * TLS on that request authenticates the issuer, as OpenID Connect Core 3.1.3.7 allows.
 */
export function readGoogleIdentity(
  idToken: string,
  expected: { clientId: string; nonce: string; now?: number },
): { subject: string; email: string } {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('Malformed ID token');
  const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const claims = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
  ) as {
    iss?: string;
    aud?: string;
    exp?: number;
    nonce?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
  };

  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) throw new Error('Invalid ID token issuer');
  if (claims.aud !== expected.clientId) throw new Error('Invalid ID token audience');
  if (!claims.exp || claims.exp * 1000 <= (expected.now ?? Date.now())) {
    throw new Error('Expired ID token');
  }
  if (claims.nonce !== expected.nonce) throw new Error('Invalid ID token nonce');
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new Error('Email is not verified');
  }
  if (!claims.sub || !claims.email) throw new Error('Incomplete ID token');
  return { subject: claims.sub, email: claims.email.toLowerCase() };
}

function consentPage(details: ConsentDescription, handle: string): string {
  const name = escapeHtml(details.clientName);
  const source = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : 'This app registered itself, so its name is not verified.';
  const loopbackWarning = details.redirectIsLoopback
    ? '<p><strong>Access goes to an app on your computer.</strong> Continue only if you just started this sign-in.</p>'
    : '';
  return renderPage(
    'Authorize access - mcp-server-gsc',
    'Authorize an MCP client.',
    `<h1>Allow ${name}?</h1>
<p class="lead">This app wants to use the Search Console tools on this server.</p>
<p>${source} Access goes to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${loopbackWarning}
<p>Next, you sign in with Google. Only allowed email addresses can continue.</p>
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<p class="actions"><button name="decision" value="approve">Continue with Google</button> <button name="decision" value="deny">Deny</button></p>
</form>`,
  );
}

const messagePage = (title: string, message: string, status: number) =>
  new Response(
    renderPage(`${title} - mcp-server-gsc`, title, `<h1>${title}</h1><p>${escapeHtml(message)}</p>`),
    {
      status,
      headers: { ...PAGE_SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
    },
  );

function redirect(location: string, headers = new Headers()) {
  headers.set('Location', location);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
}

export function createRemoteApp(dependencies: RemoteAppDependencies) {
  const app = new Hono<{ Bindings: RemoteEnv }>();

  const guarded = async (run: () => Promise<Response>) => {
    try {
      return await run();
    } catch (error) {
      if (dependencies.isAuthorizationError(error)) {
        if (error.redirectTo) return redirect(error.redirectTo);
        return messagePage('Sign-in failed', error.description, 400);
      }
      throw error;
    }
  };

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/', (c) => c.html(HOME_PAGE, 200, PAGE_SECURITY_HEADERS));
  app.get('/privacy', (c) => c.html(PRIVACY_PAGE, 200, PAGE_SECURITY_HEADERS));

  // OAuthProvider handles /mcp when OAuth is configured. This route fails closed otherwise.
  app.all('/mcp', (c) => c.json({ error: 'OAuth is not configured' }, 500));

  app.get('/authorize', (c) =>
    guarded(async () => {
      const oauth = c.env.OAUTH_PROVIDER!;
      const request = await oauth.parseAuthRequest(c.req.raw);
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      consent.headers.set('Content-Security-Policy', CONSENT_CSP);
      consent.headers.set('Referrer-Policy', 'no-referrer');
      consent.headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(consentPage(details, consent.handle), { headers: consent.headers });
    }),
  );

  app.post('/authorize', (c) =>
    guarded(async () => {
      const oauth = c.env.OAUTH_PROVIDER!;
      const form = await c.req.raw.clone().formData();
      const handle = String(form.get('handle') ?? '');

      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(c.req.raw, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }

      const approved = await oauth.approveConsent(c.req.raw, handle, { scope: [OAUTH_SCOPE] });
      const data: UpstreamData = { verifier: randomToken(), nonce: randomToken() };
      const { state, headers } = await oauth.beginUpstream(approved.request, {
        data,
        headers: approved.headers,
      });
      const target = new URL(GOOGLE_AUTHORIZE_URL);
      target.search = new URLSearchParams({
        client_id: c.env.GOOGLE_OAUTH_CLIENT_ID!,
        redirect_uri: `${canonicalOrigin(c.env, c.req.url)}/callback`,
        response_type: 'code',
        scope: 'openid email',
        state,
        nonce: data.nonce,
        code_challenge: await codeChallenge(data.verifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return redirect(target.toString(), headers);
    }),
  );

  app.get('/callback', (c) =>
    guarded(async () => {
      const oauth = c.env.OAUTH_PROVIDER!;
      const { request, data, headers } = await oauth.finishUpstream<UpstreamData>(c.req.raw);
      const url = new URL(c.req.url);
      const code = url.searchParams.get('code');
      if (url.searchParams.get('error') || !code) {
        return redirect(dependencies.authorizationErrorRedirect(request, 'access_denied'), headers);
      }

      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: c.env.GOOGLE_OAUTH_CLIENT_ID!,
          client_secret: c.env.GOOGLE_OAUTH_CLIENT_SECRET!,
          code,
          code_verifier: data.verifier,
          grant_type: 'authorization_code',
          redirect_uri: `${canonicalOrigin(c.env, c.req.url)}/callback`,
        }),
      });
      if (!tokenResponse.ok) {
        return redirect(
          dependencies.authorizationErrorRedirect(request, 'server_error', 'Google sign-in failed'),
          headers,
        );
      }

      // The Google tokens are not stored. Only the verified identity is kept.
      const { id_token: idToken } = (await tokenResponse.json()) as { id_token?: string };
      let identity: { subject: string; email: string };
      try {
        if (!idToken) throw new Error('Missing ID token');
        identity = readGoogleIdentity(idToken, {
          clientId: c.env.GOOGLE_OAUTH_CLIENT_ID!,
          nonce: data.nonce,
        });
      } catch {
        return redirect(
          dependencies.authorizationErrorRedirect(request, 'access_denied', 'Invalid Google identity'),
          headers,
        );
      }

      if (!parseAllowedEmails(c.env.ALLOWED_EMAILS).has(identity.email)) {
        return redirect(
          dependencies.authorizationErrorRedirect(request, 'access_denied', 'This account is not allowed'),
          headers,
        );
      }

      const props: McpProps = { email: identity.email };
      const { redirectTo } = await oauth.completeAuthorization({
        request,
        userId: `google:${identity.subject}`,
        metadata: {},
        scope: request.scope,
        props,
      });
      return redirect(redirectTo, headers);
    }),
  );

  return app;
}

const mcpApp = new Hono<{ Bindings: RemoteEnv }>();

mcpApp.use('/mcp', async (c, next) => {
  const origin = c.env.CORS_ORIGIN || '*';
  return cors({ origin })(c, next);
});

mcpApp.all('/mcp', async (c) => {
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

/** Checks the allowlist on each call, so removing an email takes effect at once. */
export function handleMcpRequest(request: Request, env: RemoteEnv, props: McpProps | undefined) {
  if (!props?.email || !parseAllowedEmails(env.ALLOWED_EMAILS).has(props.email.toLowerCase())) {
    return Response.json({ error: 'This account is not allowed' }, { status: 403 });
  }
  return mcpApp.fetch(request, env);
}
