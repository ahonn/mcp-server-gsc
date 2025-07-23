[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/ahonn-mcp-server-gsc-badge.png)](https://mseep.ai/app/ahonn-mcp-server-gsc)

# Google Search Console MCP Server
[![smithery badge](https://smithery.ai/badge/mcp-server-gsc)](https://smithery.ai/server/mcp-server-gsc)

A Model Context Protocol (MCP) server providing access to Google Search Console.

### Sponsored by

<a href="https://macuse.app">
    <img src="https://macuse.app/logo.png" width="100" alt="Macuse">
</a>

## Features

- Search analytics data retrieval with dimensions support
- Rich data analysis with customizable reporting periods

## Prerequisites

- Node.js 18 or later
- Google Cloud Project with Search Console API enabled
- Service Account credentials with Search Console access

## Installation

### Installing via Smithery

To install Google Search Console for Claude Desktop automatically via [Smithery](https://smithery.ai/server/mcp-server-gsc):

```bash
npx -y @smithery/cli install mcp-server-gsc --client claude
```

### Manual Installation
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

Get search performance data from Google Search Console with customizable parameters:

**Required Parameters:**

- `siteUrl`: Site URL (format: `http://www.example.com/` or `sc-domain:example.com`)
- `startDate`: Start date (YYYY-MM-DD)
- `endDate`: End date (YYYY-MM-DD)

**Optional Parameters:**

- `dimensions`: Comma-separated list (`query,page,country,device,searchAppearance`)
- `type`: Search type (`web`, `image`, `video`, `news`)
- `aggregationType`: Aggregation method (`auto`, `byNewsShowcasePanel`, `byProperty`, `byPage`)
- `rowLimit`: Maximum rows to return (default: 1000)

**New Filter Parameters:**

- `pageFilter`: Filter results by a specific page URL.
- `queryFilter`: Filter results by a specific query string.
- `countryFilter`: Filter by a country using ISO 3166-1 alpha-3 code (e.g., `USA`, `CHN`).
- `deviceFilter`: Filter by device type (`DESKTOP`, `MOBILE`, `TABLET`).
- `filterOperator`: The operator for `pageFilter` and `queryFilter`. Can be `equals`, `contains`, `notEquals`, or `notContains`. Defaults to `equals`.


Example with Filters:

```json
{
  "siteUrl": "https://example.com",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "dimensions": "page,query",
  "queryFilter": "ai assistant",
  "filterOperator": "contains",
  "deviceFilter": "MOBILE"
}
```

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.
