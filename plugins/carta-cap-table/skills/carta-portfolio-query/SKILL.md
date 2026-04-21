---
name: carta-portfolio-query
description: Query cap table data across multiple companies, or fetch detailed per-company data (stakeholders, grants, SAFEs, 409A). Use for portfolio-wide analysis, comparing companies, finding patterns, or when detailed tabular data is needed beyond a visual summary.
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

## Routing — Visual Summary vs. Detailed Data

**For single-company cap table overview/summary/snapshot requests, use the `cap_table_chart` MCP tool directly.** It renders an interactive stacked bar chart in desktop clients (Cowork) or an ASCII chart in terminal clients (Claude Code).

```
cap_table_chart(corporation_id=<id>)
```

**Route to `cap_table_chart` when the user asks for:**
- Cap table overview, summary, or snapshot
- Ownership distribution or breakdown (visual)
- Share class breakdown or equity structure
- Fully diluted share counts or amount raised by share class
- Board deck equity overview

**After `cap_table_chart` renders, do NOT repeat its data.** The chart already shows share classes, FD shares, ownership %, amount raised, and the stacked bars. Do not render the `_terminal_fallback` from the tool response — it is a terminal fallback and the visual chart already covers this. Instead, add only a brief commentary (2-3 sentences max) highlighting anything notable — e.g. unusually large option pool, concentrated ownership, or missing share classes. Do not restate numbers the chart already displays.

**Stay in this skill (use `fetch` below) when:**
- Multi-company queries or portfolio-wide comparisons
- Detailed stakeholder listings or specific holder data
- Specific data points (409A, SAFEs, grants, convertible notes)
- The user explicitly asks for tables or raw numbers

## When to Use

- "Show me cap tables for all my portfolio companies"
- "Which companies have SAFEs outstanding?"
- "Compare option pool sizes across my portfolio"
- "Show me detailed grant data for Acme Corp"

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

> **Detail mode**: The gateway now defaults all list commands to `detail=summary` automatically. You do not need to pass `"detail": "summary"` or `"summary": "true"` — summary mode is the default. Summary returns aggregate data (count, totals, type/status breakdowns) and is orders of magnitude faster for companies with 1,000+ grants. For individual grant-level records (e.g. searching by name, paginating through results), pass `"detail": "full"` with `"page_size": "25"`. See the "Search grants by name" row above for an example.

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

### Step 3 — Fetch Data

Loop through each corporation, calling the relevant command per company.

### Step 4 — Aggregate and Present

Aggregate and present the results.

### Single-Company Presentation

**Present in this exact order — do not skip any step:**

1. **Summary line**: total outstanding shares, total fully diluted shares, total cash raised
2. **Share class table**: share class name, outstanding shares, outstanding %, FD shares, FD %, cash raised
3. **Option pool**: authorized vs issued/outstanding, available shares and %
4. **Top stakeholders table**: name, outstanding shares, outstanding %, FD %, cash raised
5. **ASCII bar chart** — REQUIRED, always render this, no exceptions

**Bar chart — MANDATORY. You MUST render this after the tables. Do not skip it.**

Use the stakeholder data to render an ASCII ownership bar chart. Steps:
1. Collect each stakeholder's fully diluted % (or outstanding % if FD not available)
2. Find the max value — that stakeholder gets 40 █ blocks
3. All others: `bar_width = round(pct / max_pct * 40)`, minimum 1 block
4. Left-align labels in a fixed-width column (pad to the longest label length + 2 spaces)
5. Immediately after the label padding, place the █ blocks — no spaces between label and blocks
6. After the blocks, one space then the percentage

Example output (you MUST produce something like this):
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
2. For each corporation_id:
   fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})
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
2. For each corporation_id:
   fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})
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

- Portfolio data reflects point-in-time API calls, not a single atomic snapshot
- Companies with restricted permissions may have incomplete data
- Rate limit: maximum 20 companies per invocation — don't call 50+ companies at once; ask the user to narrow down if the list is large
- Only `corporation_pk` accounts work with company-level commands (cap table, grants, SAFEs, valuations). `organization_pk` accounts are portfolios/firms.
- Some companies may return errors (permissions, setup state) — skip them gracefully and note which ones failed
