import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { READ_WRITE_SCOPE, READONLY_SCOPE } from './search-console.js';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_PATH = '/oauth2callback';

export function defaultTokenPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'mcp-server-gsc', 'oauth-token.json');
}

/** Uses the saved login only when no explicit credentials are configured. */
export function resolveCredentials(
  explicit: string | undefined,
  tokenPath: string = defaultTokenPath(),
): string | undefined {
  if (explicit) return explicit;
  return existsSync(tokenPath) ? tokenPath : undefined;
}

export async function readClientSecret(path: string) {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as {
    installed?: { client_id?: string; client_secret?: string };
  };
  const clientId = parsed.installed?.client_id;
  const clientSecret = parsed.installed?.client_secret;
  if (!clientId || !clientSecret) {
    throw new Error('Expected an OAuth client JSON file of type "Desktop app"');
  }
  return { clientId, clientSecret };
}

async function writePrivateJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  const child = spawn(command as string, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

const listen = (server: Server) =>
  new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

export interface LoginOptions {
  clientSecretPath: string;
  tokenPath?: string;
  write?: boolean;
  openUrl?: (url: string) => void;
  /** Replaces the Google OAuth client. Tests use this to avoid network calls. */
  createClient?: (config: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }) => Pick<OAuth2Client, 'generateAuthUrl' | 'generateCodeVerifierAsync' | 'getToken'>;
  timeoutMs?: number;
}

/** Runs the OAuth loopback flow with PKCE and saves an authorized_user credential. */
export async function login(options: LoginOptions): Promise<{ tokenPath: string; scope: string }> {
  const { clientId, clientSecret } = await readClientSecret(options.clientSecretPath);
  const tokenPath = options.tokenPath ?? defaultTokenPath();
  const scope = options.write ? READ_WRITE_SCOPE : READONLY_SCOPE;
  const state = randomBytes(24).toString('hex');

  let finish!: (code: string) => void;
  let fail!: (error: Error) => void;
  const codeReceived = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  const callbackServer = createServer((request, response) => {
    const respond = (status: number, message: string) => {
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(message);
    };
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://127.0.0.1');
    } catch {
      // A malformed request from another local process must not end the login.
      return respond(400, 'Bad request');
    }
    if (url.pathname !== CALLBACK_PATH) return respond(404, 'Not found');
    // Ignore forged requests and keep waiting for the real redirect.
    if (url.searchParams.get('state') !== state) return respond(400, 'Invalid state');

    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (error || !code) {
      respond(400, 'Login failed. Return to the terminal.');
      return fail(new Error(`Google login failed: ${error ?? 'missing code'}`));
    }
    respond(200, 'Login complete. You can close this window.');
    finish(code);
  });

  const timer = setTimeout(
    () => fail(new Error('Timed out while waiting for the Google login')),
    options.timeoutMs ?? LOGIN_TIMEOUT_MS,
  );

  try {
    const port = await listen(callbackServer);
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const client =
      options.createClient?.({ clientId, clientSecret, redirectUri }) ??
      new OAuth2Client({ clientId, clientSecret, redirectUri });
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [scope],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });

    console.error(`Open this URL to sign in:\n${authUrl}\n`);
    (options.openUrl ?? openBrowser)(authUrl);

    const code = await codeReceived;
    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token. Run the login again.');
    }
    await writePrivateJson(tokenPath, {
      type: 'authorized_user',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      gsc_scope: scope,
    });
    return { tokenPath, scope };
  } finally {
    clearTimeout(timer);
    callbackServer.closeAllConnections?.();
    callbackServer.close();
  }
}

export async function savedTokenScope(tokenPath: string): Promise<string | undefined> {
  try {
    return (JSON.parse(await readFile(tokenPath, 'utf8')) as { gsc_scope?: string }).gsc_scope;
  } catch {
    return undefined;
  }
}

const USAGE = `Usage:
  mcp-server-gsc auth login --client-secret <file> [--write]
  mcp-server-gsc auth status
  mcp-server-gsc auth logout`;

/** Handles `mcp-server-gsc auth ...` and returns the process exit code. */
export async function runAuthCommand(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  const tokenPath = defaultTokenPath();

  if (command === 'login') {
    const secretIndex = rest.indexOf('--client-secret');
    const clientSecretPath =
      (secretIndex >= 0 ? rest[secretIndex + 1] : undefined) ?? process.env.GSC_OAUTH_CLIENT_FILE;
    if (!clientSecretPath) {
      console.error(USAGE);
      return 1;
    }
    const result = await login({ clientSecretPath, write: rest.includes('--write') });
    console.error(`Saved login to ${result.tokenPath}\nScope: ${result.scope}`);
    return 0;
  }
  if (command === 'status') {
    if (!existsSync(tokenPath)) {
      console.error('Not logged in');
      return 1;
    }
    console.error(`Logged in: ${tokenPath}\nScope: ${(await savedTokenScope(tokenPath)) ?? 'unknown'}`);
    return 0;
  }
  if (command === 'logout') {
    await rm(tokenPath, { force: true });
    console.error('Removed the saved login. To revoke access, use https://myaccount.google.com/permissions');
    return 0;
  }
  console.error(USAGE);
  return 1;
}
