# Changelog

## 0.4.0 - 2026-11-24

### Breaking changes

- The remote server now uses OAuth. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `ALLOWED_EMAILS`, and `PUBLIC_URL`, and bind `OAUTH_KV`. The server no longer accepts `MCP_API_TOKEN`.
- If OAuth is not fully configured, the remote `/mcp` endpoint returns HTTP 500.
- `enhanced_search_analytics` is removed. Use `search_analytics` for rows and `detect_quick_wins` for opportunities.
- `search_analytics` returns TSV by default. Set `responseFormat` to `json` to get JSON.
- The default `rowLimit` of `search_analytics` changes from 1000 to 100.
- `detect_quick_wins` has a new response shape. Its `maxCtr` and `targetCtr` values are fractions, so `0.02` means 2%.
- `list_sitemaps` requires `siteUrl`. `get_sitemap` requires `siteUrl` and `feedpath`.
- Tool failures are returned as results with `isError: true`.
- Reads no longer retry on a domain property after a permission error. Tools resolve `siteUrl` first and report the property in `meta.siteUrl`.
- Write tools are hidden unless `GSC_ALLOW_WRITE=true`.

### Added

- Analysis tools: `compare_periods`, `detect_traffic_drops`, `detect_content_decay`, `find_cannibalization`, `find_ctr_opportunities`, `brand_split`, `multi_site_overview`, and `diagnose_site`.
- `batch_url_inspect` with rate limiting, partial results, and progress notifications.
- Local OAuth login with `mcp-server-gsc auth login`.
- Optional write tools: `delete_sitemap`, `add_site`, and `delete_site`.
- Search Analytics pagination, fresh data, hourly data, `brandedClassification`, `webMultimodal`, and search appearance filters.
- Optional dates. By default, tools use the last 28 days of final data.
- Response metadata, tool titles, structured output for analysis tools, MCP prompts, and server instructions.
- An MCPB build with `pnpm run pack:mcpb`.
- A public home page and privacy policy for remote deployments.

### Fixed

- The server no longer advertises the `resources` capability.
- `list_sites` works without arguments.
- `regexFilter` now applies to `search_analytics`.
- Sitemap writes no longer retry on a different property.

### Security

- Upgraded MCP dependencies and moved to Zod 4.
- The remote `/mcp` endpoint no longer allows unauthenticated access.

### Not verified with a real account

- `delete_sitemap`, `add_site`, and `delete_site`.
