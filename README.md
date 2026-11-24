# Google Search Console MCP Server

A Model Context Protocol (MCP) server providing comprehensive access to Google Search Console data with enhanced analytics capabilities.

## Features

- **Enhanced Search Analytics**: Retrieve up to 25,000 rows of performance data
- **Advanced Filtering**: Support for regex patterns and multiple filter operators
- **Quick Wins Detection**: Automatically identify optimization opportunities
- **Rich Dimensions**: Query, page, country, device, and search appearance analysis
- **Flexible Date Ranges**: Customizable reporting periods with historical data access

### Sponsored by

<a href="https://macuse.app?ref=mcp-server-gsc">
    <img src="https://macuse.app/logo-pill.png" width="200" alt="macuse.app">
</a>

[macuse.app](https://macuse.app) is a native macOS application that gives your AI superpowers by integrating AI assistants with macOS apps like Calendar, Mail, and Notes, plus universal UI control for any application. Supports Claude Desktop, Cursor, and Raycast with one-click setup. Privacy-first, runs locally.

## Prerequisites

- Node.js 18 or later
- Google Cloud Project with Search Console API enabled
- Service Account credentials with Search Console access

## Installation

```bash
npm install mcp-server-gsc
```

## Authentication Setup

To obtain Google Search Console API credentials:

1. Visit the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the API:

- Go to "APIs & Services" > "Library"
- Search for and enable ["Search Console API"](https://console.cloud.google.com/marketplace/product/google/searchconsole.googleapis.com)

4. Create credentials:

- Navigate to ["APIs & Services" > "Credentials"](https://console.cloud.google.com/apis/credentials)
- Click "Create Credentials" > "Service Account"
- Fill in the service account details
- Create a new key in JSON format
- The credentials file (.json) will download automatically

5. Grant access:

- Open Search Console
- Add the service account email (format: name@project.iam.gserviceaccount.com) as a property administrator

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

By default the server asks Google for the read-only scope (`webmasters.readonly`), so it can't change anything in Search Console. To let it submit sitemaps and manage sites, set `GSC_ALLOW_WRITE=true`:

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

The server then requests the `webmasters` scope. The service account needs Full or Owner permission on the property; a Restricted user can only read. For the remote server, set `GSC_ALLOW_WRITE` to `true` as a Worker variable.

Without the flag, `submit_sitemap`, `delete_sitemap`, `add_site` and `delete_site` return an error that says how to turn them on. Before this change `submit_sitemap` was listed but always failed with "Insufficient Permission", because the server only ever had the read-only scope.

"Request indexing" from the URL Inspection page is not part of the Search Console API, so no tool here can do it. The URL Inspection API (`index_inspect`) only reads.

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

## Available Tools

### search_analytics

Get comprehensive search performance data from Google Search Console with enhanced analytics capabilities.

**Required Parameters:**

- `siteUrl`: Site URL (format: `http://www.example.com/` or `sc-domain:example.com`)
- `startDate`: Start date (YYYY-MM-DD)
- `endDate`: End date (YYYY-MM-DD)

**Optional Parameters:**

- `dimensions`: Comma-separated list (`query`, `page`, `country`, `device`, `searchAppearance`, `date`)
- `type`: Search type (`web`, `image`, `video`, `news`, `discover`, `googleNews`)
- `aggregationType`: Aggregation method (`auto`, `byNewsShowcasePanel`, `byProperty`, `byPage`)
- `rowLimit`: Maximum rows to return (default: 1000, max: 25000)
- `dataState`: Data freshness (`all` or `final`, default: `final`)

**Filter Parameters:**

- `pageFilter`: Filter by page URL (supports regex with `regex:` prefix)
- `queryFilter`: Filter by search query (supports regex with `regex:` prefix)
- `countryFilter`: Filter by country ISO 3166-1 alpha-3 code (e.g., `USA`, `CHN`)
- `deviceFilter`: Filter by device type (`DESKTOP`, `MOBILE`, `TABLET`)
- `searchAppearanceFilter`: Filter by search feature (e.g., `AMP_BLUE_LINK`, `AMP_TOP_STORIES`)
- `filterOperator`: Operator for filters (`equals`, `contains`, `notEquals`, `notContains`, `includingRegex`, `excludingRegex`)

**Quick Wins Detection:**

- `detectQuickWins`: Enable automatic detection of optimization opportunities (default: `false`)
- `quickWinsConfig`: Configuration for quick wins detection:
  - `positionRange`: Position range to consider (default: `[4, 20]`)
  - `minImpressions`: Minimum impressions threshold (default: `100`)
  - `minCtr`: Minimum CTR percentage (default: `1`)

**Example - Basic Query:**

```json
{
  "siteUrl": "https://example.com",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "dimensions": "query,page",
  "rowLimit": 5000
}
```

**Example - Advanced Filtering with Regex:**

```json
{
  "siteUrl": "https://example.com",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "dimensions": "page,query",
  "queryFilter": "regex:(AI|machine learning|ML)",
  "filterOperator": "includingRegex",
  "deviceFilter": "MOBILE",
  "rowLimit": 10000
}
```

**Example - Quick Wins Detection:**

```json
{
  "siteUrl": "https://example.com",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "dimensions": "query,page",
  "detectQuickWins": true,
  "quickWinsConfig": {
    "positionRange": [4, 15],
    "minImpressions": 500,
    "minCtr": 2
  }
}
```

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

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.
