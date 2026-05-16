---
name: carta-portfolio-query
description: Raw cap-table data across multiple portfolio companies — stakeholders, grants, instruments, and valuations rendered as tables for comparison or audit. Returns the underlying records, not computed statistics or risk alerts.
when_to_use: >-
  Use when asked to pull cross-company cap-table data, compare cap tables
  across companies, list stakeholders across the portfolio, break down
  data across all companies, render side-by-side tabular cross-company
  views, or audit any cap-table records spanning every portfolio company.
  Covers raw stakeholder lists, raw grant data, raw SAFE listings, and
  raw note listings spanning multiple companies. For statistical
  benchmarks (median, average, typical, range), prefer a portfolio-
  benchmarks skill. For time-based red flags (expiring valuations,
  maturing notes, low option pools), prefer a portfolio-alerts skill. For
  a single company's specialist data, prefer the matching single-purpose
  skill. For Excel/spreadsheet exports of a single company's data,
  prefer a reporting skill.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__carta__cap_table_chart
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Portfolio Query

Fetch and present cap table data for a single company or across multiple companies.

## Using `cap_table_chart` alongside this skill

For single-company cap table overview/summary/snapshot requests, use the `cap_table_chart` MCP tool directly — it renders an interactive stacked bar chart in desktop clients (Cowork) or an ASCII chart in terminal clients (Claude Code):

```
cap_table_chart(corporation_id=<id>)
```

`cap_table_chart` also accepts `as_of_date` for point-in-time snapshots (see [Point-in-time snapshots](#point-in-time-snapshots) below).

**After `cap_table_chart` renders, do NOT duplicate its content.** The tool returns two things: a `chart_data` object rendered as an interactive stacked bar chart in MCP App clients (Claude Desktop, Cowork), and a `_terminal_fallback` ASCII string for terminal clients (Claude Code) where the interactive view can't render.

What you MUST NOT do in any client:

- Emit a **markdown-style share class table** (pipe-delimited headers with alignment rows) on top of the chart. This is the core duplication regression — in MCP App clients, the user sees the chart AND a redundant table stacked underneath; in terminal, it competes with the ASCII fallback. Just don't.
- Restate summary numbers the chart already shows (total outstanding, total FD, total raised) as bullet points or highlighted bold lines.
- Render stakeholder or option-pool tables in text — those are for the fallback/detailed path below, not when you've routed to the chart.

What terminal clients DO need: either the tool's `_terminal_fallback` surfaced verbatim, or a brief ASCII bar chart of equivalent shape. Pick one, once. Don't do both.

Your text response alongside `cap_table_chart` should be **2–3 sentences of commentary** highlighting something notable — e.g. unusually large option pool, concentrated ownership, zero-outstanding classes — plus an optional single-sentence next-step offer. In MCP App clients that's the whole response. In terminal clients, prefix it with the one ASCII rendering.

## Prerequisites

- Single company: resolve `corporation_id` from `list_accounts`
- Multi-company: loop all `corporation_pk` accounts from `list_accounts`

## Data Retrieval

### Portfolio Enumeration

Call `list_accounts` to get all accessible entities. Filter to `corporation_pk:` accounts. Extract up to 20 numeric corporation IDs. If more than 20 companies, ask the user to narrow scope.

### Per-Company Commands

Call the relevant command for each company depending on the query:

#### Command Reference

| Data | Command |
|---|---|
| 409A valuations | `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` |
| SAFEs & convertible notes | `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` |
| Cap table by share class | `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` |
| Option grants | `fetch("cap_table:list:grants", {"corporation_id": corporation_id})` |
| RSU grants | `fetch("cap_table:list:rsus", {"corporation_id": corporation_id})` |
| SAR grants | `fetch("cap_table:list:sars", {"corporation_id": corporation_id})` |
| CBU grants | `fetch("cap_table:list:cbus", {"corporation_id": corporation_id})` |
| Search grants by name | `fetch("cap_table:list:grants", {"corporation_id": corporation_id, "detail": "full", "search": "Jane Doe"})` |
| Top N holders by shares | `fetch("cap_table:list:rsus", {"corporation_id": corporation_id, "ordering": "-quantity", "page_size": "20"})` |

> **Detail mode**: The gateway now defaults all list commands to `detail=summary` automatically. You do not need to pass `"detail": "summary"` or `"summary": "true"` — summary mode is the default. Summary returns aggregate data (count, totals, type/status breakdowns) and is orders of magnitude faster for companies with 1,000+ grants. For individual grant-level records (e.g. searching by name, paginating through results), pass `"detail": "full"` with `"page_size": "25"`. See the "Search grants by name" row above for an example.

> **Ordering & top-N queries**: Grant/RSU/SAR/CBU list commands support server-side `ordering`. Use `-quantity` for descending (top holders), `quantity` for ascending. Combine with `page_size` to get only the top N records without fetching everything. **Always use ordering+page_size for "top N" or "largest" queries** — never fetch all records and sort client-side, especially for companies with 1,000+ grants. Available ordering fields: `quantity`, `remaining_shares`, `exercised_shares`, `issue_date`, `stakeholder_name`, `grant_number`.

### Narrowing per-stakeholder holdings

`cap_table:get:cap_table_by_stakeholder` accepts optional server-side filters that narrow the response — useful when querying a single security type across the portfolio:

- `security_type`: e.g. `"CERTIFICATE"`, `"OPTION_GRANT"`, `"WARRANT"`, `"CONVERTIBLE"`
- `share_class_id`: numeric ID from `cap_table:get:rights_and_preferences`
- `so_type`: option sub-type, e.g. `"ISO"`, `"NSO"`, `"RSU"`

Prefer these over fetching everything and post-filtering whenever the comparison is scoped to one security shape.

### Point-in-time snapshots

`cap_table:get:cap_table_by_share_class`, `cap_table:get:cap_table_by_stakeholder`, and the `cap_table_chart` tool accept an optional `as_of_date` param. When provided, they return the cap table as of that date instead of live data. Pass ISO (`YYYY-MM-DD`) or `MM/DD/YYYY`:

```
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id, "as_of_date": "2026-03-31"})
cap_table_chart(corporation_id=<id>, as_of_date="2026-03-31")
```

Use `as_of_date` whenever the user's question is anchored to a specific date ("as of Q1 close", "on 3/31", "at fiscal year end"). If the user doesn't specify a date, omit the param — the API defaults to today.

Limitations: future dates are accepted only for companies enrolled in future-dated cap tables; dates before incorporation are rejected. Other cap-table commands (grants, SAFEs, convertibles, 409A, rounds) do **not** yet support `as_of_date` — live data only for those.

### Single-Company Detailed View

When the user needs detailed tabular data beyond the visual summary (e.g. stakeholder-level holdings, specific share counts), fetch both views:

```
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})
fetch("cap_table:get:cap_table_by_stakeholder", {"corporation_id": corporation_id, "detail": "full"})
```

## Key Fields

From `list_accounts`:
- `id`: format `corporation_pk:<id>` — extract the number for company-level commands
- `accountType`: `"company"` accounts work with all commands; `"portfolio"` and `"investment firm"` are organizations, not companies
- `name`: company display name

## Workflow

### Step 1 — Get Accounts

Call `list_accounts` to get all accessible entities.

### Step 2 — Filter Accounts

Filter to the relevant account type (`company`, `fund`, `investment firm`, `law firm`, `portfolio`). Extract `corporation_id` from each account's `id` field (strip the `corporation_pk:` or `organization_pk:` prefix).

### Step 3 — Fetch Data (parallel)

Issue ALL fetch calls for ALL companies **in a single response** — do NOT loop company-by-company. The `fetch` tool has `readOnlyHint=true`, so parallel calls execute concurrently.

For example, to compare option pools across 5 companies, issue all 5 fetch calls at once:

```
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": 1})
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": 2})
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": 3})
... (all companies)
```

### Step 4 — Aggregate and Present

Aggregate and present the results.

### Single-Company Presentation

**DO NOT use this section if you called `cap_table_chart`.** The MCP App tool renders its own visual (interactive in desktop clients, ASCII `_terminal_fallback` in terminal clients) — your job is then limited to 2–3 sentences of commentary, per the Routing section above. Re-rendering tables and bar charts on top of the chart tool's output produces duplicate, clashing content in the user's view.

**Use this section only when:**
- The user explicitly asked for detailed raw numbers / tables / specific share counts that the chart doesn't expose, OR
- `cap_table_chart` is unavailable in the current client (rare — the tool provides its own terminal fallback), OR
- The request is multi-company (per-company chart calls are too noisy; a cross-company table is clearer).

In those cases only, present in this order:

1. **Summary line**: total outstanding shares, total fully diluted shares, total cash raised
2. **Share class table**: share class name, outstanding shares, outstanding %, FD shares, FD %, cash raised
3. **Option pool**: authorized vs issued/outstanding, available shares and %
4. **Top stakeholders table**: name, outstanding shares, outstanding %, FD %, cash raised
5. **ASCII bar chart** (fallback only — `cap_table_chart` already renders a better one when called)

ASCII bar chart recipe (fallback only):
1. Collect each stakeholder's fully diluted % (or outstanding % if FD not available)
2. Find the max value — that stakeholder gets 40 █ blocks
3. All others: `bar_width = round(pct / max_pct * 40)`, minimum 1 block
4. Left-align labels in a fixed-width column (pad to the longest label length + 2 spaces)
5. Immediately after the label padding, place the █ blocks — no spaces between label and blocks
6. After the blocks, one space then the percentage

Example:
```
Ownership (Fully Diluted)

Option Pool          ████████████████████████████████████████  71.8%
Lead Investor        ████████                                   7.8%
Founder A            ████                                       4.0%
Founder B            ████                                       3.9%
Other Investor       ███                                        2.6%
Others               ████                                       9.9%
```

### Example: Find Expiring 409As

```
1. list_accounts → get all corporation_pk accounts
2. Issue ALL fetch calls in a single response (parallel):
   fetch("cap_table:get:409a_valuations", {"corporation_id": 1})
   fetch("cap_table:get:409a_valuations", {"corporation_id": 2})
   ... (all companies at once)
3. For each result, check if the most recent expiration_date is within 90 days of today
4. Present:
```

| Company | Current FMV | Effective | Expires | Days Left |
|---------|------------|-----------|---------|-----------|
| Acme Corp | $12.61 | Apr 25, 2024 | Apr 24, 2025 | 37 |
| Beta Inc | $5.00 | Jan 15, 2024 | Jan 14, 2025 | EXPIRED |

### Example: Portfolio Option Pool Health

```
1. list_accounts → get all corporation_pk accounts
2. Issue ALL fetch calls in a single response (parallel):
   fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": 1})
   fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": 2})
   ... (all companies at once)
3. Extract option plan available_ownership percentage
4. Flag companies with available pool < 5%
```

## Gates

**Required inputs**: None — portfolio enumeration is automatic.

**AI computation**: Yes — cross-company comparisons, red flag detection, and health assessments are AI-derived when querying multiple companies.
Trigger the AI computation gate (see carta-interaction-reference §6.2) before outputting any cross-company analysis or health assessments.

**Subagent prohibition**: Not applicable.

## Presentation

**Format**: Tables with company names; single-company queries include an ASCII bar chart (see Workflow).

**BLUF lead**: For single-company: lead with total outstanding shares, fully diluted count, and total cash raised. For multi-company: lead with count summary ("3 of 12 companies need attention").

**Sort order**: Multi-company results sorted by urgency/severity (most critical first). Single-company tables sorted by FD % descending.

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

- Always show company name alongside the data
- Group results: "needs attention" vs "healthy"
- Include a count summary: "3 of 12 companies need attention"

## Caveats

- Portfolio data reflects separate API calls per company, not a single atomic snapshot. Even with `as_of_date`, each company's fetch is independent — state can diverge if data changes mid-loop.
- Companies with restricted permissions may have incomplete data
- Rate limit: maximum 20 companies per invocation — don't call 50+ companies at once; ask the user to narrow down if the list is large
- Only `corporation_pk` accounts work with company-level commands (cap table, grants, SAFEs, valuations). `organization_pk` accounts are portfolios/firms.
- Some companies may return errors (permissions, setup state) — skip them gracefully and note which ones failed
