/** Public pages for the Google OAuth consent screen. The content is static. */

const REPOSITORY_URL = 'https://github.com/ahonn/mcp-server-gsc';
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
const POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy';
const PERMISSIONS_URL = 'https://myaccount.google.com/permissions';
const EFFECTIVE_DATE = 'November 24, 2026';

export const PAGE_SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const STYLES = `
:root {
  color-scheme: light dark;
  --background: #fbfbf9;
  --text: #20211f;
  --muted: #62645f;
  --line: #dfe0da;
  --link: #1f5fbf;
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: #171816;
    --text: #ececE8;
    --muted: #a7a9a2;
    --line: #363833;
    --link: #8ab8ff;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--background);
  color: var(--text);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { width: min(100%, 720px); margin: 0 auto; padding: 56px 20px 40px; }
nav { display: flex; gap: 20px; margin-bottom: 48px; font-size: 14px; }
h1 { margin: 0 0 12px; font-size: clamp(30px, 7vw, 42px); line-height: 1.15; }
h2 { margin: 36px 0 8px; font-size: 20px; line-height: 1.3; }
p, ul { margin: 0 0 14px; }
ul { padding-left: 22px; }
a { color: var(--link); }
code { font-size: 0.92em; overflow-wrap: anywhere; }
.lead { color: var(--muted); font-size: 18px; }
footer {
  margin-top: 48px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 14px;
}
`;

function page(title: string, description: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<style>${STYLES}</style>
</head>
<body>
<main>
<nav aria-label="Main"><a href="/">Home</a><a href="/privacy">Privacy</a><a href="${REPOSITORY_URL}">GitHub</a></nav>
${body}
<footer>mcp-server-gsc is an independent open source project. It is not affiliated with or endorsed by Google.</footer>
</main>
</body>
</html>
`;
}

export const HOME_PAGE = page(
  'mcp-server-gsc',
  'An open source MCP server for Google Search Console data.',
  `<h1>mcp-server-gsc</h1>
<p class="lead">An open source Model Context Protocol (MCP) server that lets your AI client work with your Google Search Console data.</p>

<h2>What it does</h2>
<ul>
<li>Queries search performance data, such as clicks, impressions, CTR, and position.</li>
<li>Compares periods and finds traffic drops, content decay, and CTR opportunities.</li>
<li>Inspects the index status of URLs and reads sitemaps.</li>
<li>Submits or removes sitemaps and properties only if you turn on write access.</li>
</ul>

<h2>Why it asks for Google access</h2>
<p>The app uses the <code>webmasters.readonly</code> scope to read the Search Console properties that your account can access. It requests the <code>webmasters</code> scope only if you run the login command with <code>--write</code>.</p>

<h2>Get started</h2>
<p>Read the <a href="${REPOSITORY_URL}#readme">setup guide</a>. To learn how the app handles your data, read the <a href="/privacy">privacy policy</a>.</p>`,
);

export const PRIVACY_PAGE = page(
  'Privacy Policy - mcp-server-gsc',
  'How mcp-server-gsc handles Google Search Console data.',
  `<h1>Privacy Policy</h1>
<p class="lead">Effective ${EFFECTIVE_DATE}</p>
<p>This policy applies to mcp-server-gsc, an open source MCP server maintained by Yuexun Jiang.</p>

<h2>Data the app accesses</h2>
<p>When you authorize the app, it can access this Google Search Console data for your properties:</p>
<ul>
<li>The list of properties and your permission level.</li>
<li>Search performance data, including queries, pages, countries, devices, clicks, impressions, CTR, and position.</li>
<li>URL inspection results and sitemap information.</li>
</ul>
<p>The app does not request your Google password. It does not request access to Gmail, Drive, or other Google products.</p>

<h2>How the app uses data</h2>
<p>The app uses this data only to perform the tool calls that you or your MCP client request. It returns the results to that MCP client.</p>
<p>Your MCP client can send the results to its AI provider. The privacy terms of that client and provider apply to that processing.</p>

<h2>Where data is stored</h2>
<ul>
<li><strong>Local use:</strong> OAuth login saves a refresh token and OAuth client details in a file on your computer. The app does not send this file to the maintainer.</li>
<li><strong>Remote deployment:</strong> The Cloudflare Worker processes each request in memory and has no database. Its operator stores the service account credential and bearer token as Cloudflare secrets.</li>
<li><strong>Logs:</strong> The server writes error details to its runtime log. For a remote deployment, Cloudflare processes that log.</li>
</ul>
<p>The app does not store Search Console results.</p>

<h2>Sharing</h2>
<p>The maintainer does not sell Google user data. The maintainer does not use it for advertising or to train AI models. The app sends data only to Google, to the MCP client that made the request, and to the infrastructure that runs your deployment.</p>

<h2>Google API Services</h2>
<p>The use and transfer of information received from Google APIs to any other app will adhere to the <a href="${POLICY_URL}">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

<h2>Your choices</h2>
<ul>
<li>To remove a local login, run <code>mcp-server-gsc auth logout</code>.</li>
<li>To revoke access, open your <a href="${PERMISSIONS_URL}">Google Account permissions</a>.</li>
<li>To remove a service account, delete its user entry in Search Console.</li>
</ul>

<h2>Changes</h2>
<p>If this policy changes, this page will show the new effective date.</p>

<h2>Contact</h2>
<p>For privacy questions, open an issue on <a href="${ISSUES_URL}">GitHub</a>. Do not include credentials or private data in an issue.</p>`,
);
