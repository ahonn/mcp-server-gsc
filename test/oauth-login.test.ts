import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { GoogleAuth, UserRefreshClient } from 'google-auth-library';
import { login, readClientSecret, resolveCredentials } from '../src/oauth-login.js';
import { READ_WRITE_SCOPE, READONLY_SCOPE } from '../src/search-console.js';

let directory: string;
let clientSecretPath: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gsc-oauth-'));
  clientSecretPath = join(directory, 'client.json');
  await writeFile(
    clientSecretPath,
    JSON.stringify({ installed: { client_id: 'client-id', client_secret: 'client-secret' } }),
  );
});

after(() => rm(directory, { recursive: true, force: true }));

function fakeClient(calls: { scope?: unknown; verifier?: string; redirect?: string }, refreshToken?: string) {
  let redirectUri = '';
  return {
    createClient: (config: { redirectUri: string }) => {
      redirectUri = config.redirectUri;
      return {
        generateCodeVerifierAsync: async () => ({ codeVerifier: 'verifier', codeChallenge: 'challenge' }),
        generateAuthUrl: (options: { scope: unknown; state: string }) => {
          calls.scope = options.scope;
          return `${redirectUri}?state=${options.state}`;
        },
        getToken: async (options: { codeVerifier: string; redirect_uri: string }) => {
          calls.verifier = options.codeVerifier;
          calls.redirect = options.redirect_uri;
          return { tokens: { refresh_token: refreshToken } };
        },
      } as never;
    },
  };
}

test('login rejects a forged state and saves a private credential', async () => {
  const tokenPath = join(directory, 'nested', 'token.json');
  const calls: { scope?: unknown; verifier?: string; redirect?: string } = {};
  let forgedStatus = 0;

  const result = await login({
    clientSecretPath,
    tokenPath,
    ...fakeClient(calls, 'refresh-token'),
    openUrl: (url) => {
      void (async () => {
        const forged = new URL(url);
        forged.searchParams.set('state', 'forged');
        forged.searchParams.set('code', 'bad');
        forgedStatus = (await fetch(forged)).status;
        const real = new URL(url);
        real.searchParams.set('code', 'good');
        await fetch(real);
      })();
    },
  });

  assert.equal(forgedStatus, 400);
  assert.equal(result.scope, READONLY_SCOPE);
  assert.deepEqual(calls.scope, [READONLY_SCOPE]);
  assert.equal(calls.verifier, 'verifier');
  assert.match(calls.redirect ?? '', /^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);

  const saved = JSON.parse(await readFile(tokenPath, 'utf8'));
  assert.equal(saved.type, 'authorized_user');
  assert.equal(saved.refresh_token, 'refresh-token');
  if (process.platform !== 'win32') {
    assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
  }

  const client = await new GoogleAuth({ keyFile: tokenPath, scopes: [READONLY_SCOPE] }).getClient();
  assert.ok(client instanceof UserRefreshClient);
});

test('login survives a malformed local request', async () => {
  const result = await login({
    clientSecretPath,
    tokenPath: join(directory, 'malformed.json'),
    ...fakeClient({}, 'refresh-token'),
    openUrl: (url) => {
      void (async () => {
        const target = new URL(url);
        await new Promise<void>((resolve, reject) => {
          const socket = connect(Number(target.port), '127.0.0.1', () => {
            socket.write('GET // HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
          });
          socket.on('data', () => {});
          socket.on('close', () => resolve());
          socket.on('error', reject);
        });
        target.searchParams.set('code', 'good');
        await fetch(target);
      })();
    },
  });
  assert.equal(result.scope, READONLY_SCOPE);
});

test('login requests the write scope only with --write', async () => {
  const calls: { scope?: unknown } = {};
  const result = await login({
    clientSecretPath,
    tokenPath: join(directory, 'write.json'),
    write: true,
    ...fakeClient(calls, 'refresh-token'),
    openUrl: (url) => {
      const callback = new URL(url);
      callback.searchParams.set('code', 'good');
      void fetch(callback);
    },
  });
  assert.equal(result.scope, READ_WRITE_SCOPE);
  assert.deepEqual(calls.scope, [READ_WRITE_SCOPE]);
});

test('login fails when Google returns no refresh token', async () => {
  await assert.rejects(
    login({
      clientSecretPath,
      tokenPath: join(directory, 'none.json'),
      ...fakeClient({}),
      openUrl: (url) => {
        const callback = new URL(url);
        callback.searchParams.set('code', 'good');
        void fetch(callback);
      },
    }),
    /refresh token/,
  );
});

test('login reports a denied consent', async () => {
  await assert.rejects(
    login({
      clientSecretPath,
      tokenPath: join(directory, 'denied.json'),
      ...fakeClient({}),
      openUrl: (url) => {
        const callback = new URL(url);
        callback.searchParams.set('error', 'access_denied');
        void fetch(callback);
      },
    }),
    /access_denied/,
  );
});

test('readClientSecret rejects a non-desktop OAuth client', async () => {
  const webClient = join(directory, 'web.json');
  await writeFile(webClient, JSON.stringify({ web: { client_id: 'a', client_secret: 'b' } }));
  await assert.rejects(readClientSecret(webClient), /Desktop app/);
});

test('resolveCredentials prefers explicit credentials', async () => {
  const tokenPath = join(directory, 'saved.json');
  assert.equal(resolveCredentials(undefined, tokenPath), undefined);
  await writeFile(tokenPath, '{}');
  assert.equal(resolveCredentials(undefined, tokenPath), tokenPath);
  assert.equal(resolveCredentials('/explicit.json', tokenPath), '/explicit.json');
});
