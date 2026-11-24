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

Without the flag, `submit_sitemap`, `delete_sitemap`, `add_site`, and `delete_site` return an error that says how to turn them on.

"Request indexing" from the URL Inspection page is not part of the Search Console API, so no tool here can do it. The URL Inspection API only reads.

### Remote Deployment (Cloudflare Workers)

The remote server requires a bearer token. If `MCP_API_TOKEN` is not set, `/mcp` returns HTTP 500 and does not serve Search Console data.

1. Set the service account secret:

   ```bash
   wrangler secret put GOOGLE_CREDENTIALS
   ```

2. Set the bearer token secret:

   ```bash
   wrangler secret put MCP_API_TOKEN
   ```

3. Deploy the Worker:

   ```bash
   pnpm run deploy
   ```

4. Configure each client to send `Authorization: Bearer <token>` to `https://<your-worker>.workers.dev/mcp`.

The Worker also serves a public home page at `/` and a privacy policy at `/privacy`. These pages do not need the bearer token and contain no Search Console data.

## Available Tools

### Search data

| Tool | What it does |
|---|---|
| `search_analytics` | Queries performance data with filters and pagination |
| `enhanced_search_analytics` | Runs the same query and can add quick wins |
| `compare_periods` | Compares two date ranges and lists the top gainers and losers |
| `multi_site_overview` | Compares totals across all or selected properties |

#### `search_analytics` parameters

**Required:**

- `siteUrl`: Property, such as `https://example.com/` or `sc-domain:example.com`
- `startDate`: Start date (`YYYY-MM-DD`)
- `endDate`: End date (`YYYY-MM-DD`)

**Optional:**

- `dimensions`: Comma-separated list of `query`, `page`, `country`, `device`, `date`, `hour`, `searchAppearance`, `brandedClassification`
- `type`: `web`, `image`, `video`, `news`, `discover`, `googleNews`, `webMultimodal`
- `aggregationType`: `auto`, `byNewsShowcasePanel`, `byProperty`, `byPage`
- `dataState`: `final`, `all`, `hourly_all`
- `rowLimit`: Rows in this response (default: 1000, max: 25000)
- `startRow`: Zero-based row offset (default: 0)

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

If `pagination.hasMore` is `true`, send `pagination.nextStartRow` as `startRow`:

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

These tools run fixed calculations on your Search Console data. They do not use a model or third-party benchmarks.

| Tool | What it finds |
|---|---|
| `detect_quick_wins` | Queries in positions 4 to 10 with a low CTR |
| `detect_traffic_drops` | Pages that lost clicks, with a likely cause |
| `detect_content_decay` | Pages whose clicks fell in each consecutive window |
| `find_cannibalization` | Queries where several pages compete for impressions |
| `find_ctr_opportunities` | Query and page pairs below the site's median CTR at the same position |
| `brand_split` | Branded and non-branded traffic, using your brand terms |

Google does not report anonymized queries in query rows, so query-level totals can be lower than property totals. `brand_split` reports the difference as `unattributed`.

If a tool reads `maxRows` rows, it sets `dataTruncated` to `true`. A page or query that is missing from truncated data is counted in `unknownDueToTruncation`. It is not reported as lost. To include more rows, increase `maxRows`.

These tools analyze the exact property in `siteUrl`. They do not fall back to a domain property. `multi_site_overview` does not add metrics across properties, because a domain property and its URL-prefix properties can overlap.

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
| `batch_url_inspect` | Inspects up to 100 URLs. It stops and returns partial results if Google reports a quota error |

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

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.
