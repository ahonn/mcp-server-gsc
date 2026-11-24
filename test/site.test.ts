import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import {
  canonicalOrigin,
  createRemoteApp,
  handleMcpRequest,
  isOAuthConfigured,
  parseAllowedEmails,
  readGoogleIdentity,
  type RemoteAppDependencies,
  type RemoteEnv,
} from '../src/remote-app.js';

class FakeAuthorizationError extends Error {
  description = 'expired';
  redirectTo?: string;
}

const dependencies: RemoteAppDependencies = {
  isAuthorizationError: (error): error is FakeAuthorizationError => error instanceof FakeAuthorizationError,
  authorizationErrorRedirect: (request, code, description) => {
    const url = new URL(request.redirectUri);
    url.searchParams.set('error', code);
    if (description) url.searchParams.set('error_description', description);
    return url.toString();
  },
};
const app = createRemoteApp(dependencies);

const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const validClaims = {
  iss: 'https://accounts.google.com',
  aud: 'google-client',
  exp: Math.floor(Date.now() / 1000) + 300,
  nonce: 'nonce-1',
  sub: 'sub-1',
  email: 'Owner@Example.com',
  email_verified: true,
};

function fakeOAuth(overrides: Partial<OAuthHelpers> = {}) {
  const request = { redirectUri: 'http://127.0.0.1:9999/cb', scope: ['gsc'], clientId: 'c' };
  const calls: { completed?: { userId: string; props: unknown }; upstream?: unknown } = {};
  const helpers = {
    parseAuthRequest: async () => request,
    describeConsent: async () => ({
      clientName: '<img src=x onerror=alert(1)>',
      redirectUri: request.redirectUri,
      redirectHost: '127.0.0.1',
      redirectIsLoopback: true,
      scope: ['gsc'],
    }),
    beginConsent: async () => ({ handle: 'handle-1', headers: new Headers({ 'X-Frame-Options': 'DENY' }) }),
    approveConsent: async () => ({ request, headers: new Headers() }),
    denyConsent: async () => ({
      request,
      redirectTo: `${request.redirectUri}?error=access_denied`,
      headers: new Headers({ Location: `${request.redirectUri}?error=access_denied` }),
    }),
    beginUpstream: async (_request: unknown, options: { data: unknown; headers: Headers }) => {
      calls.upstream = options.data;
      return { state: 'state-1', headers: options.headers };
    },
    finishUpstream: async () => ({
      request,
      data: { verifier: 'verifier-1', nonce: 'nonce-1' },
      headers: new Headers(),
    }),
    completeAuthorization: async (options: { userId: string; props: unknown }) => {
      // Matches the validation in @cloudflare/workers-oauth-provider.
      if (!options.userId || options.userId.includes(':')) throw new TypeError('invalid userId');
      calls.completed = options;
      return { redirectTo: `${request.redirectUri}?code=mcp-code` };
    },
    ...overrides,
  };
  return { helpers: helpers as unknown as OAuthHelpers, calls };
}

const envWith = (oauth: OAuthHelpers): RemoteEnv => ({
  GOOGLE_OAUTH_CLIENT_ID: 'google-client',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
  ALLOWED_EMAILS: 'owner@example.com, other@example.com',
  OAUTH_KV: {},
  PUBLIC_URL: 'https://gsc.example.com',
  OAUTH_PROVIDER: oauth,
});

async function callback(claims: Record<string, unknown>, query = 'code=google-code&state=state-1') {
  const { helpers, calls } = fakeOAuth();
  const originalFetch = globalThis.fetch;
  let tokenBody = '';
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    tokenBody = String(init.body);
    return Response.json({ id_token: jwt(claims), access_token: 'google-access' });
  }) as typeof fetch;
  try {
    const response = await app.request(`https://gsc.example.com/callback?${query}`, {}, envWith(helpers));
    return { response, calls, tokenBody };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const [path, expected] of [
  ['/', /Why it asks for Google access/],
  ['/privacy', /Limited Use requirements/],
] as const) {
  test(`${path} is public and has security headers`, async () => {
    const response = await app.request(path, {}, { GOOGLE_CREDENTIALS: 'secret-value' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const body = await response.text();
    assert.match(body, expected);
    assert.doesNotMatch(body, /secret-value/);
    assert.doesNotMatch(body, /<script/i);
  });
}

test('/mcp fails closed when OAuth is not configured', async () => {
  const response = await app.request('/mcp', { method: 'POST' }, { GOOGLE_CREDENTIALS: '{}' });
  assert.equal(response.status, 500);
  assert.equal(isOAuthConfigured({ GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b', OAUTH_KV: {}, ALLOWED_EMAILS: ' , ' }), false);
});

test('parseAllowedEmails normalizes entries', () => {
  assert.deepEqual([...parseAllowedEmails(' A@Example.com, ,b@example.com ')], ['a@example.com', 'b@example.com']);
});

test('canonicalOrigin prefers PUBLIC_URL', () => {
  assert.equal(canonicalOrigin({ PUBLIC_URL: 'https://gsc.example.com/' }, 'https://x.workers.dev/mcp'), 'https://gsc.example.com');
  assert.equal(canonicalOrigin({}, 'https://x.workers.dev/mcp'), 'https://x.workers.dev');
});

test('consent page escapes client data and forbids framing', async () => {
  const { helpers } = fakeOAuth();
  const response = await app.request('https://gsc.example.com/authorize?client_id=c', {}, envWith(helpers));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(body, /<img src=x/);
  assert.match(body, /registered itself/);
  assert.match(body, /app on your computer/);
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
});

test('approval redirects to Google with PKCE, state, and nonce', async () => {
  const { helpers, calls } = fakeOAuth();
  const response = await app.request(
    'https://gsc.example.com/authorize',
    { method: 'POST', body: new URLSearchParams({ handle: 'handle-1', decision: 'approve' }) },
    envWith(helpers),
  );
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('scope'), 'openid email');
  assert.equal(location.searchParams.get('state'), 'state-1');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://gsc.example.com/callback');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.searchParams.get('nonce'), (calls.upstream as { nonce: string }).nonce);
  assert.notEqual(location.searchParams.get('code_challenge'), (calls.upstream as { verifier: string }).verifier);
});

test('denial returns access_denied to the client', async () => {
  const { helpers } = fakeOAuth();
  const response = await app.request(
    'https://gsc.example.com/authorize',
    { method: 'POST', body: new URLSearchParams({ handle: 'handle-1', decision: 'deny' }) },
    envWith(helpers),
  );
  assert.match(response.headers.get('location') ?? '', /error=access_denied/);
});

test('an expired consent renders locally', async () => {
  const { helpers } = fakeOAuth({
    approveConsent: async () => {
      throw new FakeAuthorizationError();
    },
  });
  const response = await app.request(
    'https://gsc.example.com/authorize',
    { method: 'POST', body: new URLSearchParams({ handle: 'x', decision: 'approve' }) },
    envWith(helpers),
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
});

test('callback completes authorization for an allowed email', async () => {
  const { response, calls, tokenBody } = await callback(validClaims);
  assert.match(response.headers.get('location') ?? '', /code=mcp-code/);
  assert.equal(calls.completed?.userId, 'google-sub-1');
  assert.deepEqual(calls.completed?.props, { email: 'owner@example.com' });
  assert.match(tokenBody, /code_verifier=verifier-1/);
  assert.doesNotMatch(JSON.stringify(calls.completed), /google-access/);
});

test('callback rejects an email outside the allowlist', async () => {
  const { response, calls } = await callback({ ...validClaims, email: 'stranger@example.com' });
  assert.match(response.headers.get('location') ?? '', /error=access_denied/);
  assert.equal(calls.completed, undefined);
});

for (const [name, change] of [
  ['audience', { aud: 'other-client' }],
  ['issuer', { iss: 'https://evil.example' }],
  ['nonce', { nonce: 'other' }],
  ['expiry', { exp: 1 }],
  ['email verification', { email_verified: false }],
] as const) {
  test(`callback rejects an invalid ${name}`, async () => {
    const { response, calls } = await callback({ ...validClaims, ...change });
    assert.match(response.headers.get('location') ?? '', /error=access_denied/);
    assert.equal(calls.completed, undefined);
  });
}

test('callback handles a Google error without exchanging a code', async () => {
  const { response, calls, tokenBody } = await callback(validClaims, 'error=access_denied&state=state-1');
  assert.match(response.headers.get('location') ?? '', /error=access_denied/);
  assert.equal(tokenBody, '');
  assert.equal(calls.completed, undefined);
});

test('readGoogleIdentity decodes UTF-8 claims', () => {
  const identity = readGoogleIdentity(jwt({ ...validClaims, name: '测试' }), {
    clientId: 'google-client',
    nonce: 'nonce-1',
  });
  assert.equal(identity.email, 'owner@example.com');
});

test('MCP requests recheck the allowlist', async () => {
  const request = () =>
    new Request('https://gsc.example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
  const env = { GOOGLE_CREDENTIALS: '{"type":"service_account"}', ALLOWED_EMAILS: 'owner@example.com' };
  assert.equal((await handleMcpRequest(request(), env, { email: 'removed@example.com' })).status, 403);
  assert.equal((await handleMcpRequest(request(), env, undefined)).status, 403);
  assert.equal((await handleMcpRequest(request(), env, { email: 'owner@example.com' })).status, 200);
});
