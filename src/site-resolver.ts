import { ToolInputError } from './tool-errors.js';

const MAX_LISTED_PROPERTIES = 10;

function parseInput(input: string): { url: URL; hasScheme: boolean } | null {
  const hasScheme = /^https?:\/\//i.test(input);
  try {
    return { url: new URL(hasScheme ? input : `https://${input}`), hasScheme };
  } catch {
    return null;
  }
}

function domainProperty(host: string, properties: string[]): string | null {
  const matches = properties
    .filter((property) => property.startsWith('sc-domain:'))
    .filter((property) => {
      const domain = property.slice('sc-domain:'.length).toLowerCase();
      return host === domain || host.endsWith(`.${domain}`);
    });
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

function prefixProperty(
  url: URL,
  properties: string[],
  options: { hasScheme: boolean; host: string },
): string | null {
  const matches = properties.flatMap((property) => {
    if (property.startsWith('sc-domain:')) return [];
    let prefix: URL;
    try {
      prefix = new URL(property);
    } catch {
      return [];
    }
    if (prefix.hostname.toLowerCase() !== options.host) return [];
    if (options.hasScheme && prefix.protocol !== url.protocol) return [];
    const base = prefix.pathname.endsWith('/') ? prefix.pathname : `${prefix.pathname}/`;
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    return path.startsWith(base) ? [{ property, length: base.length }] : [];
  });
  return matches.sort((a, b) => b.length - a.length)[0]?.property ?? null;
}

/** Matches a property, bare domain, or page URL to one property the account can access. */
export function matchProperty(input: string, properties: string[]): string | null {
  const value = input.trim();
  if (properties.includes(value)) return value;
  if (properties.includes(`${value}/`)) return `${value}/`;
  if (value.startsWith('sc-domain:')) return null;

  const parsed = parseInput(value);
  if (!parsed) return null;
  const host = parsed.url.hostname.toLowerCase();
  const prefix = () => prefixProperty(parsed.url, properties, { hasScheme: parsed.hasScheme, host });
  const domain = () => domainProperty(host, properties);

  // A bare domain names the whole site. A URL names a location, so the closest prefix wins.
  const isBareDomain = !parsed.hasScheme && parsed.url.pathname === '/';
  const match = isBareDomain ? (domain() ?? prefix()) : (prefix() ?? domain());
  if (match || parsed.hasScheme || host.startsWith('www.')) return match;
  return prefixProperty(parsed.url, properties, { hasScheme: false, host: `www.${host}` });
}

export function noPropertyMessage(input: string, properties: string[]): string {
  const listed = properties.slice(0, MAX_LISTED_PROPERTIES).join(', ') || 'none';
  const more =
    properties.length > MAX_LISTED_PROPERTIES
      ? ` and ${properties.length - MAX_LISTED_PROPERTIES} more`
      : '';
  return `No Search Console property matches "${input}". Available properties: ${listed}${more}. Use one of them as siteUrl.`;
}

export async function resolveSiteUrl(
  input: string,
  listProperties: () => Promise<string[]>,
): Promise<string> {
  const value = input.trim();
  // A domain property is already canonical, so it needs no lookup.
  if (value.startsWith('sc-domain:')) return value;
  const properties = await listProperties();
  const match = matchProperty(value, properties);
  if (!match) throw new ToolInputError(noPropertyMessage(value, properties));
  return match;
}
