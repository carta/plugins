# Carta Investors

Claude Code plugin that gives Claude access to Carta Investors data.

## How it works

This plugin provides **skills** that teach Claude how to query fund metrics, regulatory reporting, performance benchmarks, and more via the Carta MCP server at `https://mcp.app.carta.com/mcp`.

## Installation

Install from the marketplace via `/plugin`, or add the Carta MCP server manually:

```bash
claude mcp add --transport http carta https://mcp.app.carta.com/mcp
claude plugin marketplace add carta/plugins
claude plugin install carta-investors
```

After installing, restart Claude Code and run `/mcp` to complete OAuth authentication.

### Try it out

- "What datasets are available in Carta?"
- "Show me NAV and TVPI for all my funds"
- "Pull our Form ADV data for 2025"
- "How does Fund I compare to its benchmark?"
- "What journal entries were posted last quarter?"
- "Build a 2026 budget for Delta-v Capital from last year's actuals"
- "How are we pacing against the budget this year?"
- "Consolidating P&L for Krakatoa Ventures for March"

## Skills

### Reporting & data

| Skill | Description |
|-------|-------------|
| `carta-explore-data` | Query and explore investors data — NAV, partners, investments, accounting |
| `carta-form-adv` | Form ADV Schedule D regulatory data and firm rollup |
| `carta-performance-benchmarks` | Compare fund performance against peer benchmark cohorts |
| `carta-download-tearsheet` | Generate tearsheet PDFs for one or more portcos — single PDF preview or bulk ZIP download |
| `carta-fund-forecasting` | Read-only Carta Fund Forecasting (formerly Tactyc) — list funds, fund-wide KPIs (TVPI, DPI, IRR, MOIC, NAV, reserves), performance tables, and per-investment analytics. Internal-only. |

### Budgeting (Excel)

Skills that produce accountant-ready Excel workbooks. They run inside **Claude for Excel** (output lands in the open workbook) or **Claude Code / Cowork** (output lands in a local `.xlsx` file).

| Skill | Description |
|-------|-------------|
| `carta-create-budget` | Build a new fund or ManCo budget workbook from Carta prior-year actuals. Routes to from-prior-actuals (default), from-template, from-recommendation, or slice-by-tag. |
| `carta-fetch-budget` | Pull a ManCo budget already stored in Carta and write it to an Excel workbook. |
| `carta-fetch-actuals` | Refresh actuals on an existing budget — four layouts (interleave Budget/Actual/Variance, separate Actuals tab, refresh in place, extend by one period). |
| `carta-budget-analysis` | Compare YTD actuals against an existing budget and analyze pacing — % consumed, run-rate projection, off-plan flags. Supports chat-only output. |
| `carta-budget-scenarios` | Model what-if scenarios on an existing budget — trim (headcount, revenue shocks, cost rebalance) and growth (new fund raises, expansion hires). |
| `carta-consolidating-pnl` | Generate a firm-wide consolidating P&L across all entities for a given month — detailed "P&L- with comments" tab plus a one-page executive Summary P&L. |
| `carta-consolidating-balance-sheet` | Generate a consolidating Balance Sheet across all entities for a given month — side-by-side layout with Assets / Liabilities / Equity. |

For Claude for Excel, enable the Carta connector in **Settings → Connectors** in your claude.ai workspace.

## MCP Tools

The Carta MCP server exposes these data warehouse tools:

| Tool | Description |
|------|-------------|
| `list_tables` | Browse available datasets with descriptions and record counts |
| `describe_table` | Get column names, types, and descriptions for a specific table |
| `execute_query` | Run a read-only SELECT query against the data warehouse |
| `list_contexts` | See which firms you have access to |
| `set_context` | Switch to a different firm |
