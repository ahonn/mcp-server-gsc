# Google Search Console MCP Server

A Model Context Protocol (MCP) server for querying, comparing, and diagnosing Google Search Console data.

## Features

- **Full Search Analytics access**: Query data with pagination, fresh data, hourly data, and all Search Console dimensions.
- **Period comparison**: Compare two date ranges by page, query, country, or device.
- **SEO diagnostics**: Find traffic drops, content decay, keyword cannibalization, CTR gaps, and quick wins.
- **Brand analysis**: Split traffic into branded and non-branded segments.
- **Multi-site overview**: Compare all Search Console properties in one call.
- **Batch URL inspection**: Inspect up to 100 URLs with rate limiting and partial results.
- **Guided workflows**: Use MCP prompts for a weekly report, a traffic-drop diagnosis, and an indexing audit.
- **Safe by default**: The server is read-only until you set `GSC_ALLOW_WRITE=true`.

### Sponsored by

<a href="https://macuse.app?ref=mcp-server-gsc">
    <img src="https://macuse.app/logo-pill.png" width="200" alt="macuse.app">
</a>

[macuse.app](https://macuse.app) is a native macOS application that gives your AI superpowers by integrating AI assistants with macOS apps like Calendar, Mail, and Notes, plus universal UI control for any application. Supports Claude Desktop, Cursor, and Raycast with one-click setup. Privacy-first, runs locally.

## Prerequisites

- Node.js 18 or later
- A Google Cloud project with the Search Console API enabled
- A Google account or service account with access to a Search Console property

## Installation

```bash
npm install mcp-server-gsc
```

## Authentication Setup

Select one method. If you set `GOOGLE_APPLICATION_CREDENTIALS`, the server uses that file. If you do not set it, the server uses the saved OAuth login.

First, enable the API:

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project or select a project.
3. Enable the [Search Console API](https://console.cloud.google.com/marketplace/product/google/searchconsole.googleapis.com).

### Option A: OAuth login

Use this method to access the properties of your own Google account.

1. Open [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth client ID** of type **Desktop app**.
3. Download the client JSON file.
4. Run the login command:

   ```bash
   npx mcp-server-gsc auth login --client-secret /path/to/client_secret.json
   ```

5. Approve the access in the browser.

The server saves the login to `~/.config/mcp-server-gsc/oauth-token.json` with file mode `600`.

To use write tools, add `--write` to the login command. To see the login state, run `npx mcp-server-gsc auth status`. To remove the saved login, run `npx mcp-server-gsc auth logout`.

### Option B: Service account

Use this method for automation, shared use, and remote deployment.

1. Open [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials).
2. Create a **Service Account**.
3. Create a key in JSON format and download it.
4. Open Search Console and add the service account email (`name@project.iam.gserviceaccount.com`) as a user of the property.

Select **Restricted** for read-only use. Select **Full** to use write tools.

## Usage

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["-y", "mcp-server-gsc"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/credentials.json"
      }
    }
  }
}
```

If you use OAuth login, remove the `env` block.

### MCP Bundle (`.mcpb`)

To build a one-click bundle for clients that support MCPB, run:

```bash
pnpm run pack:mcpb
```

The command writes `release/mcp-server-gsc-<version>.mcpb`. The client asks for the credentials file during installation.

### Codex Configuration

Add the server to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project. Use an absolute path for the credentials file.

```toml
[mcp_servers.gsc]
command = "npx"
args = ["-y", "mcp-server-gsc"]

[mcp_servers.gsc.env]
GOOGLE_APPLICATION_CREDENTIALS = "/path/to/credentials.json"
```

### Write access (optional)

By default the server asks Google for the read-only scope (`webmasters.readonly`), so it cannot change anything in Search Console. To let it submit sitemaps and manage sites, set `GSC_ALLOW_WRITE=true`:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["-y", "mcp-server-gsc"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/credentials.json",
        "GSC_ALLOW_WRITE": "true"
      }
    }
  }
}
```

The server then requests the `webmasters` scope. The account needs Full or Owner permission on the property. For the remote server, set `GSC_ALLOW_WRITE` to `true` as a Worker variable.

Without the flag, the server does not list `submit_sitemap`, `delete_sitemap`, `add_site`, and `delete_site`. A direct call returns an error that says how to turn them on.

"Request indexing" from the URL Inspection page is not part of the Search Console API, so no tool here can do it. The URL Inspection API only reads.

### Remote Deployment (Cloudflare Workers)

The remote server uses OAuth. MCP clients sign in with Google, and only email addresses in `ALLOWED_EMAILS` can connect. All allowed users share the Search Console access of one service account. If OAuth is not fully configured, `/mcp` returns HTTP 500 and does not serve Search Console data.

1. In Google Cloud, create an **OAuth client ID** of type **Web application**.
2. Add `https://<your-domain>/callback` as an authorized redirect URI.
3. Set the Worker secrets:

   ```bash
   wrangler secret put GOOGLE_CREDENTIALS          # Service account JSON
   wrangler secret put GOOGLE_OAUTH_CLIENT_ID
   wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
   wrangler secret put ALLOWED_EMAILS              # alice@example.com,bob@example.com
   wrangler secret put PUBLIC_URL                  # https://<your-domain>
   ```

4. Deploy the Worker. Wrangler creates the `OAUTH_KV` namespace on the first deployment:

   ```bash
   pnpm run deploy
   ```

5. Add `https://<your-domain>/mcp` to your MCP client and complete the sign-in.

Example for Claude Code:

```bash
claude mcp add --scope user --transport http gsc https://<your-domain>/mcp
```

Then run `/mcp` in Claude Code and select the server to sign in.

Example for Codex:

```toml
[mcp_servers.gsc]
url = "https://<your-domain>/mcp"
```

Then run `codex mcp login gsc`.

To end a user's access at once, remove the email address from `ALLOWED_EMAILS`.

The Worker also serves a public home page at `/` and a privacy policy at `/privacy`. These pages contain no Search Console data.

## Available Tools

### Search data

| Tool | What it does |
|---|---|
| `search_analytics` | Queries performance data with filters and pagination |
| `compare_periods` | Compares two date ranges and lists the top gainers and losers |
| `multi_site_overview` | Compares totals across all or selected properties |

#### `search_analytics` parameters

**Required:**

- `siteUrl`: A property (`sc-domain:example.com`, `https://example.com/`), a bare domain, or a page URL. The response shows the resolved property in `meta.siteUrl`.

**Optional:**

- `startDate`: Start date (`YYYY-MM-DD`, Pacific Time)
- `endDate`: End date. Defaults to the latest day with final data
- `days`: Range length when `startDate` is omitted (default: 28)

- `dimensions`: Comma-separated list of `query`, `page`, `country`, `device`, `date`, `hour`, `searchAppearance`, `brandedClassification`
- `type`: `web`, `image`, `video`, `news`, `discover`, `googleNews`, `webMultimodal`
- `aggregationType`: `auto`, `byNewsShowcasePanel`, `byProperty`, `byPage`
- `dataState`: `final`, `all`, `hourly_all`
- `rowLimit`: Rows in this response (default: 100, max: 25000)
- `startRow`: Zero-based row offset (default: 0)
- `responseFormat`: `tsv` (default) or `json`

**Filters:**

- `pageFilter`: Page URL expression
- `queryFilter`: Query expression
- `filterOperator`: Operator for `pageFilter` and `queryFilter`: `equals`, `contains`, `notEquals`, `notContains`, `includingRegex`, `excludingRegex`
- `regexFilter`: RE2 expression that queries must match
- `countryFilter`: ISO 3166-1 alpha-3 country code, such as `USA`
- `deviceFilter`: `DESKTOP`, `MOBILE`, `TABLET`
- `searchAppearanceFilter`: A value from the `searchAppearance` dimension
- `brandedClassificationFilter`: `BRANDED` or `NON_BRANDED`. You cannot combine it with a query filter

**Limits from Google:**

- The `hour` dimension uses `hourly_all`. The server selects it for you.
- Google returns up to 10 days of hourly data.
- `webMultimodal` cannot be grouped by `query`.

**Example: Filter with a regular expression**

```json
{
  "siteUrl": "https://example.com/",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31",
  "dimensions": "page,query",
  "regexFilter": "(AI|machine learning|ML)",
  "deviceFilter": "MOBILE",
  "rowLimit": 10000
}
```

**Example: Read the next page**

If `hasMore` in the `# meta` line is `true`, send `nextStartRow` as `startRow`:

```json
{
  "siteUrl": "https://example.com/",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31",
  "dimensions": "query",
  "rowLimit": 25000,
  "startRow": 25000
}
```

### SEO analysis

These tools run fixed calculations on your Search Console data. They do not use a model or third-party benchmarks. The analysis tools and `batch_url_inspect` also return `structuredContent` that matches their `outputSchema`.

| Tool | What it finds |
|---|---|
| `diagnose_site` | One-call diagnosis of traffic changes, drops, decay, top-page indexing, and sitemap errors |
| `detect_quick_wins` | Query and page pairs in positions 4 to 10 with a low CTR. `maxCtr` and `targetCtr` are fractions, so `0.02` means 2% |
| `detect_traffic_drops` | Pages that lost clicks, with a likely cause |
| `detect_content_decay` | Pages whose clicks fell in each consecutive window |
| `find_cannibalization` | Queries where several pages compete for impressions |
| `find_ctr_opportunities` | Query and page pairs below the site's median CTR at the same position |
| `brand_split` | Branded and non-branded traffic, using your brand terms |

Google does not report anonymized queries in query rows, so query-level totals can be lower than property totals. `brand_split` reports the difference as `unattributed`.

If a tool reads `maxRows` rows, it sets `dataTruncated` to `true`. A page or query that is missing from truncated data is counted in `unknownDueToTruncation`. It is not reported as lost. To include more rows, increase `maxRows`.

Tools use the property that `siteUrl` resolves to and report it in `meta.siteUrl`. A failed tool call returns `isError: true` with a message that says how to fix it. `multi_site_overview` does not add metrics across properties, because a domain property and its URL-prefix properties can overlap.

**Example: Find traffic drops**

```json
{
  "siteUrl": "sc-domain:example.com",
  "startDate": "2026-02-01",
  "endDate": "2026-02-28",
  "minDropPct": 25,
  "limit": 20
}
```

### Indexing

| Tool | What it does |
|---|---|
| `index_inspect` | Inspects one URL |
| `batch_url_inspect` | Inspects up to 100 URLs and sends MCP progress notifications. It stops and returns partial results if Google reports a quota error |

Google allows 2,000 inspections per site per day and 600 per minute.

### Sitemap and site tools

| Tool | What it does | Needs write access |
|---|---|---|
| `list_sitemaps` | Lists the sitemaps of a property, with last submit and download time | No |
| `get_sitemap` | Shows one sitemap | No |
| `submit_sitemap` | Submits a sitemap. Google fetches it again within seconds | Yes |
| `delete_sitemap` | Removes a sitemap from the property. Its URLs stay indexed | Yes |
| `list_sites` | Lists the properties the account can see, with its permission level | No |
| `add_site` | Adds a property. It still has to be verified | Yes |
| `delete_site` | Removes a property from the account | Yes |

## Prompts

| Prompt | Arguments | Result |
|---|---|---|
| `weekly_seo_report` | `siteUrl`, optional `brandTerms` | A weekly report with changes, risks, and actions |
| `diagnose_traffic_drop` | `siteUrl`, optional `days` | Likely causes of a traffic change, with evidence |
| `indexing_audit` | `siteUrl`, optional `urls` | Index status, canonical, robots, and sitemap issues |

## Development

```bash
pnpm install
pnpm run build
pnpm test
```

### Release

Releases use npm trusted publishing, so the repository stores no npm token.

1. Update the version in `package.json`, `package-lock.json`, `manifest.json`, and `src/server.ts`.
2. Add the version to `CHANGELOG.md`.
3. Push a tag such as `v0.4.0`.

The `Release` workflow tests the package, publishes it to npm with provenance, and creates a GitHub release with the `.mcpb` bundle.

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.
