import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/remote.js';

const env = { GOOGLE_CREDENTIALS: '{"type":"service_account"}', MCP_API_TOKEN: 'secret-token' };

for (const [path, expected] of [
  ['/', /Why it asks for Google access/],
  ['/privacy', /Limited Use requirements/],
] as const) {
  test(`${path} is public and has security headers`, async () => {
    const response = await app.request(path, {}, env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

    const body = await response.text();
    assert.match(body, expected);
    assert.doesNotMatch(body, /secret-token|service_account/);
    assert.doesNotMatch(body, /<script/i);
  });
}

test('public pages do not open the MCP endpoint', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  assert.equal((await app.request('/mcp', { method: 'POST', headers, body }, env)).status, 401);
  assert.equal(
    (await app.request('/mcp', { method: 'POST', headers, body }, { GOOGLE_CREDENTIALS: '{}' })).status,
    500,
  );
});
