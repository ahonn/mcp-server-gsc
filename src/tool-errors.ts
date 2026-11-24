import { z } from 'zod';

const MAX_DETAIL_LENGTH = 400;

/** An error in tool input that the model can fix by changing its arguments. */
export class ToolInputError extends Error {}

function statusOf(error: unknown): number | undefined {
  const candidate = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  const status = candidate?.response?.status ?? candidate?.status ?? candidate?.code;
  return typeof status === 'number' ? status : undefined;
}

/** Converts a tool failure into a message that tells the model what to do next. */
export function toolErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ');
    return `Invalid arguments: ${issues}. Fix these arguments and call the tool again.`;
  }
  if (error instanceof ToolInputError) return error.message;

  const detail = (error instanceof Error ? error.message : String(error)).slice(0, MAX_DETAIL_LENGTH);
  const status = statusOf(error);
  if (status === 400) {
    return `Google rejected the request: ${detail} Change the dimensions, filters, type, or dates and try again.`;
  }
  if (status === 401) {
    return `Google authentication failed: ${detail} The server credentials need attention. Retrying will not help.`;
  }
  if (status === 403) {
    return `Access denied: ${detail} Call list_sites and use a property this account can access.`;
  }
  if (status === 404) return `Not found: ${detail} Check the siteUrl, sitemap, or inspected URL.`;
  if (status === 429) {
    return `Google quota or rate limit reached: ${detail} Wait before retrying, or request fewer rows or URLs.`;
  }
  if (status !== undefined && status >= 500) {
    return `Google service error (${status}): ${detail} Try again later.`;
  }
  return `Tool failed: ${detail}`;
}
