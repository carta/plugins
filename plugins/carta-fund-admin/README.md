# Carta Fund Admin

Claude Code plugin that gives Claude access to Carta Fund Admin data.

## How it works

This plugin provides **skills** that teach Claude how to query fund metrics, regulatory reporting, performance benchmarks, and more via the Carta MCP server at `https://mcp.app.carta.com/mcp`.

## Installation

Install from the marketplace via `/plugin`, or add the Carta MCP server manually:

```bash
claude mcp add --transport http carta https://mcp.app.carta.com/mcp
claude plugin marketplace add carta/plugins
claude plugin install carta-fund-admin
```

After installing, restart Claude Code and run `/mcp` to complete OAuth authentication.

### Try it out

- "What datasets are available in Carta?"
- "Show me NAV and TVPI for all my funds"
- "Pull our Form ADV data for 2025"
- "How does Fund I compare to its benchmark?"
- "What journal entries were posted last quarter?"

## Skills

| Skill | Description |
|-------|-------------|
| `explore-data` | Query and explore fund admin data — NAV, partners, investments, accounting |
| `form-adv` | Form ADV Schedule D regulatory data and firm rollup |
| `performance-benchmarks` | Compare fund performance against peer benchmark cohorts |
| `download-tearsheet` | Generate tearsheet PDFs for one or more portfolio companies — single PDF preview or bulk ZIP download |

## MCP Commands

All data access goes through the `fetch()` and `discover()` gateway tools. Available commands:

| Command | Description |
|---------|-------------|
| `dwh:list:tables` | Browse available datasets with descriptions and record counts |
| `dwh:get:table_schema` | Get column names, types, and descriptions for a specific table |
| `dwh:execute:query` | Run a read-only SELECT query against the data warehouse |
| `fund:list:tearsheet_templates` | List available tearsheet templates for your firm |
| `fund:list:portfolio_companies` | List portfolio companies for tearsheet generation |
| `fund:get:tearsheet_preview` | Generate a PDF tearsheet preview for one portfolio company |
| `fund:mutate:start_tearsheet_download` | Start bulk tearsheet PDF generation |
| `fund:get:tearsheet_download_status` | Check bulk tearsheet download status |

Session management tools (called directly, not via `fetch()`):

| Tool | Description |
|------|-------------|
| `list_contexts` | See which firms you have access to |
| `set_context` | Switch to a different firm |
