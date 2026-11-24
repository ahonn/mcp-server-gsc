import {
  AuthorizationError,
  OAuthProvider,
  authorizationErrorRedirect,
} from '@cloudflare/workers-oauth-provider';
import type { ExecutionContext } from 'hono';
import {
  OAUTH_SCOPE,
  canonicalOrigin,
  createRemoteApp,
  handleMcpRequest,
  isOAuthConfigured,
  type McpProps,
  type RemoteEnv,
} from './remote-app.js';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const app = createRemoteApp({
  isAuthorizationError: (error): error is AuthorizationError => error instanceof AuthorizationError,
  authorizationErrorRedirect,
});

const defaultHandler = {
  fetch: (request: Request, env: RemoteEnv, ctx: ExecutionContext) => app.fetch(request, env, ctx),
};

const apiHandler = {
  fetch: (request: Request, env: RemoteEnv, ctx: ExecutionContext & { props?: McpProps }) =>
    handleMcpRequest(request, env, ctx.props),
};

// The token audience depends on the deployment origin, which is known only from env.
const providers = new Map<string, OAuthProvider<RemoteEnv>>();

function providerFor(origin: string) {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<RemoteEnv>({
      apiRoute: '/mcp',
      apiHandler: apiHandler as never,
      defaultHandler: defaultHandler as never,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: [OAUTH_SCOPE],
      requiredScopes: [OAUTH_SCOPE],
      accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        bearer_methods_supported: ['header'],
        resource_name: 'Google Search Console MCP Server',
      },
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch(request: Request, env: RemoteEnv, ctx: ExecutionContext) {
    if (!isOAuthConfigured(env)) return app.fetch(request, env, ctx);
    return providerFor(canonicalOrigin(env, request.url)).fetch(request, env as never, ctx as never);
  },
};
