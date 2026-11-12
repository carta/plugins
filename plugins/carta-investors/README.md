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
| `carta-fund-performance` | Fund performance page, and chat answers comparing a fund against peer benchmark cohorts |
| `carta-fund-forecasting` | Read-only Carta Fund Forecasting (formerly Tactyc) — list funds, fund-wide KPIs (TVPI, DPI, IRR, MOIC, NAV, reserves), performance tables, and per-investment analytics. |
| `carta-loan-dashboard` | Loan portfolio dashboard as a live Cowork artifact — KPI tiles (commitments, drawn, outstanding, scheduled payments) and every active loan, with a side panel per loan for terms, key dates, payments and draws. Refreshes from Carta each time it is opened. Invoke with "show my loans" or "loan dashboard". |
| `carta-lp-dashboard` | LP portfolio dashboard as a live Cowork artifact — fund allocations by firm, capital activity, NAV and quarterly fund performance, with TVPI, DPI and RVPI, for LPs viewing their own Carta portfolio. Its Documents tab and a document finder cover the LP's own K-1s, capital call and distribution notices, financial statements, PCAPs, subscription agreements and side letters, with an optional zip download (desktop / CLI). Refreshes from Carta each time it is opened. Invoke with "show my LP dashboard", "get my K-1s for 2023" or "show my capital call notices". |
| `carta-partner-rollforward` | Partner rollforward as a live Cowork artifact, firm-wide by default and filterable by fund or fund family — the in-app Partner Rollforward across funds, a month-by-month partners' capital walk with carried interest accrued broken out, a one-LP capital account statement by allocation bucket for audit confirmations, and a commitment / funded / unfunded rollforward for capital calls. Invoke with "partner rollforward" or "partners' capital rollforward". |
| `carta-nda-dashboard` | NDA insights dashboard — provision frequency, governing law, NDAs expiring in the next two years, counterparties under an active non-solicit, no-contact or non-circumvention restriction, and every counterparty, in sortable, filterable tabs. Invoke with "NDA dashboard" or "who can't we solicit right now". |
| `carta-manco-reporting` | Interactive management-company reporting dashboard — a local React app over live ManCo financials with P&L drill-down, Budget vs Actuals, management fee income by fund, expense breakdowns, and journal-entry detail. Invoke with a firm name, e.g. "ManCo reporting for Demo Capital". |
| `carta-credit-card-reconciliation` | Open a fund's Credit Card Companion page beside the chat; list or summarize its credit card transactions; stage, discard or book a split across funds/accounts for one, from chat. Internal-only (ManCo team). |
| `deal-group-wf-health` | Read-only dashboard of waterfall health across a firm's deal groups (pass any firm/org id) — model assignment (stranded/none), ownership-link defects, orphaned models, and whether recent runs reached every entity. Internal-only. |
| `carta-deal-group-redactor` | Redact a deal group's entity map in Carta's view by chatting — group, rename or hide entities, hide ownership %, add a title and footer — then export the PDF from the view. Internal-only. |
| `carta-deal-group-audit-log` | Export one Excel audit log of security changes across every company in one or more deal groups of a firm for a date range, covering the companies the firm holds through its funds that granted it detailed cap table and company viewer access. Firm users pick from their firms; Carta staff give a firm ID. Internal-only. |
| `carta-start-audit` | Open a fund audit engagement: pick the fund and audit year once and see how many documents sit in each of the seven audit areas. Internal-only. |
| `carta-audit-readiness` | Check whether a fund's audit documents are complete and ready, area by area. Lists only; never downloads. Internal-only. |
| `carta-download-audit-documents` | Download a fund's audit documents as one zip per audit area, across several funds at once, with a searchable contents page. Internal-only. |
| `carta-new-audit-documents` | Report which audit documents are new, changed or gone since the last check of the same fund, year and area. Internal-only. |
| `carta-build-audit-home` | Build, rebuild or open Carta Audit Home, a live page listing every fund an auditor can audit with readiness by area, what's new and downloads. Internal-only. |
| `firm-bulk-entity-update` | Takes a firm's monthly change file for its deal groups' firm-controlled entities, checks every row against Carta and shows a read-only review, asking each deal group's open items in the chat instead of one entity at a time. Writes nothing to Carta before a deal group is confirmed, and then only the new forecast book an entity needs. Internal-only. |
| `staff-ilevel-data-collection-import` | Carta staff only. Import a firm's iLevel KPI history from the warehouse into the same firm's Data Collection in a sandbox or test Carta, then check the figures ValTool reads. Chat-driven, with Carta's own financials page open in the browser pane. Never writes to production. Internal-only. |

**ManCo reporting sends Carta a copy of your own budget reports.** `carta-manco-reporting` sends Carta a private copy of the Budget vs Actuals reports you imported, so the hosted ManCo app can show them; only you can see the copy. It does this only when you ask Claude to push your reports to the hosted app, choose **Sync to hosted app** on a report in the dashboard, or run `build_manco_datadir.py` without `--no-sync-sweep` (which starts a background sync after the build). It sends only reports that changed since the last push.

### KYC

| Skill | Description |
|-------|-------------|
| `carta-kyc-dashboard-companion` | For a GP: work the firm's LP KYC (AML) dashboard from chat. Lists each LP's KYC status, counts PEP, adverse media, sanctions and high-risk jurisdiction flags, and builds KYC reports. For one LP it reads status notes, invitations and the review checklist, and gives a download link for their KYC documents (never read or repeated). After you confirm, it invites LPs, reminds the ones who have not finished, reopens a task, archives or restores rows, adds a participant, reassigns a task to another contact, and prefills an LP's form from documents you share. It never submits an LP's form. Needs Partners + Fund Admin on the fund, or firm admin. Internal-only. |

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

## Command hooks and the compiled binary

The plugin runs these command hooks, listed in `hooks/hooks.json`. They run on your
machine when Claude Code fires the event, and none of them blocks or changes a call except where noted.

| Event | What runs | What it does |
|-------|-----------|--------------|
| SessionStart | `hooks/dispatch.sh inject-context` | Adds the instruction to load a Carta skill before a Carta tool call. |
| SessionStart | `hooks/dispatch.sh prune-session-data` | Deletes session files older than 24 hours from two folders: `CLAUDE_PLUGIN_DATA/sessions` (when that variable is set) and the shared session folder (`CARTA_SESSION_STATE_DIR`, or `carta-instrumentation` in the system temp folder), which other Carta plugins also use. |
| SessionStart, PostModelSwitch | `hooks/dispatch.sh capture-model`, `capture-model-switch` | Records the active Claude model in a per-session file in the shared session folder (`CARTA_SESSION_STATE_DIR`, or `carta-instrumentation` in the system temp folder). |
| PreToolUse (Skill) | `hooks/dispatch.sh capture-active-skill` | Records which of this plugin's skills were loaded: the name in `CLAUDE_PLUGIN_DATA/sessions`, the latest one in the shared session folder. Makes no decision. |
| PreToolUse (Carta MCP) | `hooks/dispatch.sh inject-instrumentation` | Adds a usage record (`_instrumentation_v2`) to Carta MCP calls. Outside the `default`, `acceptEdits`, `dontAsk` and `bypassPermissions` permission modes it changes nothing. |
| PreToolUse (Carta MCP `call_tool`) | `node scripts/hooks/guard-own-sync-push.js` | Denies a budget-report push that differs from the plan `own_sync.py` wrote; otherwise prints nothing. |
| UserPromptSubmit | `hooks/dispatch.sh capture-slash-skill` | Records skills you invoke with a slash command, in the same two places. |
| PostToolUse (Carta MCP `execute_query`) | `node scripts/hooks/warn-empty-query.js` | Tells Claude when a query returned no rows. |

`dispatch.sh` runs a compiled Go program from `hooks/bin/` (one file per platform), which a code scan cannot
read. Its source is in `hooks/src/`, it uses only the Go standard library, and the build is reproducible.
To check the binaries against the hashes in `hooks/bin/SHA256SUMS`, run `sh hooks/src/verify-checksums.sh`. To
rebuild them from source and compare, run `GOTOOLCHAIN=go$(cat hooks/src/.go-version) sh hooks/src/build.sh --check`, which needs the Go version in `hooks/src/.go-version` (details in `hooks/bin/SOURCE.md`).
The hooks read no credentials. `hooks/README.md` gives each hook's exact output.

## Credentials

The plugin does not read tokens, API keys or other credentials from your machine. Carta MCP calls go
through the Carta connector, which you authorise in Claude.
Elsewhere, "token" in the plugin's files means design tokens (colors and spacing), parser tokens, or the
access key of a dashboard that runs on your own machine (`127.0.0.1`): a random key generated locally, stored
in that firm's local data folder and carried as `?t=` in the dashboard's link. It is not a Carta credential and
is never sent to Carta.

**ManCo reporting starts your own `claude` CLI.** Sharing a report from the ManCo dashboard
(`carta-manco-reporting`), and the dashboard's chat, run a headless `claude` session (Claude Code) as a child
process of the dashboard's local server. The child inherits your environment, which is how it finds your own
Claude and Carta sign-in; the plugin reads no credential from it and sends none anywhere. The sharing session
may call only `welcome` and `call_tool` on the Carta MCP connectors known for your Carta environment
(production or sandbox), with every other Carta connector denied. It has Bash and file-write tools denied, and a
hook checks each `call_tool` against the one command it was started for. The chat session may read and edit only
the dashboard's own view-source folder, and read the data files its views display. The skill also:
- looks for the `claude` CLI (an explicit override, your PATH, the usual install locations, and the Claude Code
  session running the skill) and never installs it. If none is found, sharing and chat tell you how to install it
  yourself with Anthropic's official installer;
- when you try to share and no Carta connector is registered for that CLI, runs `claude mcp add --transport http
  <carta_prod or carta_sandbox> <Carta MCP URL> --scope user` once. This writes a connector entry to your user
  Claude configuration; you still sign in to it yourself.

## Data & Privacy

This plugin collects telemetry to improve reliability and performance. Data collected includes session context, model configuration, and plugin activity. See [Carta's Privacy Policy](https://carta.com/legal/privacy/privacy-policy/) for details.
