# Google Search Console MCP Server

A Model Context Protocol (MCP) server providing comprehensive access to Google Search Console data with enhanced analytics capabilities.

## Features

- **Enhanced Search Analytics**: Retrieve up to 25,000 rows of performance data
- **Advanced Filtering**: Support for regex patterns and multiple filter operators
- **Quick Wins Detection**: Automatically identify optimization opportunities
- **Rich Dimensions**: Query, page, country, device, and search appearance analysis
- **Flexible Date Ranges**: Customizable reporting periods with historical data access

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

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.
