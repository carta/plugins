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
- "Build a 2026 budget for [company] from last year's actuals"
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
| `carta-fund-forecasting` | Read-only Carta Fund Forecasting (formerly Tactyc) — list funds, fund-wide KPIs (TVPI, DPI, IRR, MOIC, NAV, reserves), performance tables, and per-investment analytics. |
| `carta-loan-dashboard` | Loan portfolio dashboard as a live Cowork artifact — KPI tiles (commitments, drawn, outstanding, scheduled payments) and every active loan, with a side panel per loan for terms, key dates, payments and draws. Refreshes from Carta each time it is opened. Invoke with "show my loans" or "loan dashboard". |
| `carta-lp-dashboard` | LP portfolio dashboard as a live Cowork artifact — fund allocations by firm, capital activity, NAV and quarterly fund performance, with TVPI, DPI and RVPI, for LPs viewing their own Carta portfolio. Refreshes from Carta each time it is opened. Invoke with "show my LP dashboard" or "LP portfolio dashboard". |
| `carta-lp-documents` | Finds an LP's own documents across all their portfolios and fund commitments — K-1s, capital call and distribution notices, financial statements, PCAPs, subscription agreements and side letters — in a live Cowork document browser, with an optional zip download (desktop / CLI). For LPs only; a GP asking for what their fund sent its LPs is pointed to their Carta account manager or Carta Support. Invoke with "get my K-1s for 2023" or "show my capital call notices". |
| `carta-partner-rollforward` | Partner rollforward as a live Cowork artifact, firm-wide by default and filterable by fund or fund family — the in-app Partner Rollforward across funds, a month-by-month partners' capital walk with carried interest accrued broken out, a one-LP capital account statement by allocation bucket for audit confirmations, and a commitment / funded / unfunded rollforward for capital calls. Invoke with "partner rollforward" or "partners' capital rollforward". |
| `carta-nda-dashboard` | NDA insights dashboard — provision frequency, governing law, NDAs expiring in the next two years, counterparties under an active non-solicit, no-contact or non-circumvention restriction, and every counterparty, in sortable, filterable tabs. Invoke with "NDA dashboard" or "who can't we solicit right now". |
| `carta-manco-reporting` | Interactive management-company reporting dashboard — a local React app over live ManCo financials with P&L drill-down, Budget vs Actuals, management fee income by fund, expense breakdowns, and journal-entry detail. Invoke with a firm name, e.g. "ManCo reporting for Demo Capital". |
| `deal-group-wf-health` | Read-only dashboard of waterfall health across a firm's deal groups (pass any firm/org id) — model assignment (stranded/none), ownership-link defects, orphaned models, and whether recent runs reached every entity. Internal-only. |
| `carta-deal-group-redactor` | Redact a deal group's entity map in Carta's view by chatting — group, rename or hide entities, hide ownership %, add a title and footer — then export the PDF from the view. Internal-only. |
| `firm-bulk-entity-update` | Not implemented yet. Will carry a firm's monthly change file for a deal group's firm-controlled entities through one cycle — ingest, resolve, review, write, true-up — instead of one entity at a time. Internal-only. |

### Budgeting (Excel)

Skills that produce accountant-ready Excel workbooks. They run inside **Claude for Excel** (output lands in the open workbook) or **Claude Code / Cowork** (output lands in a local `.xlsx` file).

| Skill | Description |
|-------|-------------|
| `carta-manco` | Unified ManCo budgeting skill — fetch a stored budget, build a new one from prior-year actuals, refresh actuals against a budget, analyze pacing/variance, or model what-if scenarios (headcount cuts, revenue shocks, new fund raises, expansion hires). |
| `carta-consolidating-financial-reports` | Build multi-entity consolidating financial reports across all entities for a given period — P&L (with a one-page executive Summary), Balance Sheet (Assets / Liabilities / Equity), and Trial Balance — individually or all three together. |

For Claude for Excel, enable the Carta connector in **Settings → Connectors** in your claude.ai workspace.

### Fund modeling & portfolio analytics

| Skill | Description |
|-------|-------------|
| `carta-fund-modeling` | Launch an interactive local console to reprice portfolio companies, model exits, and plan reserves for an entire firm — fund modeling React app with Overview, Companies, LP Returns, GP Economics, Reserves, Reports, and Plan New Fund (beta) tabs. Invoke with a firm name, e.g. "fund modeling for Demo Capital". |
| `carta-portfolio-analytics-app` | Launch an interactive local console for a firm's portfolio-company analytics — every operating KPI the portcos report into Data Collection, plus valuation, cap tables, risk and benchmarking from Fund Admin. Eleven tabs: Overview, Dashboard, Review, Portfolio, Compare, Forecast, Risk, a Company page (with PDF tearsheet), Val. Multiples, Formulas & covenants, Explore. Invoke with a firm name, e.g. "portfolio analytics for Acme Ventures". |

## MCP Tools

The Carta MCP server exposes these data warehouse tools:

| Tool | Description |
|------|-------------|
| `list_tables` | Browse available datasets with descriptions and record counts |
| `describe_table` | Get column names, types, and descriptions for a specific table |
| `execute_query` | Run a read-only SELECT query against the data warehouse |
| `list_contexts` | See which firms you have access to |
| `set_context` | Switch to a different firm |

## Data & Privacy

This plugin collects telemetry to improve reliability and performance. Data collected includes session context, model configuration, and plugin activity. See [Carta's Privacy Policy](https://carta.com/legal/privacy/privacy-policy/) for details.
