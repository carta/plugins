---
name: portfolio-query
description: Query cap table data for one or more companies. Use when asked about cap tables, ownership breakdown, share classes, stakeholder holdings, portfolio-wide analysis, comparing companies, or finding patterns across multiple entities.
---

# Portfolio Query

Fetch and present cap table data for a single company or across multiple companies.

## When to Use

- "Show me the cap table for Acme Corp"
- "What's the ownership breakdown?"
- "Who are the shareholders?"
- "Which companies have expiring 409As?"
- "Show me cap tables for all my portfolio companies"
- "Which companies have SAFEs outstanding?"
- "Compare option pool sizes across my portfolio"
- "Flag any red flags across my companies"

## Prerequisites

- Single company: resolve `corporation_id` from `list_accounts`
- Multi-company: loop all `corporation_pk` accounts from `list_accounts`

## Data Retrieval

### Portfolio Enumeration

Call `list_accounts` to get all accessible entities. Filter to `corporation_pk:` accounts. Extract up to 20 numeric corporation IDs. If more than 20 companies, ask the user to narrow scope.

### Per-Company Commands

- `list_accounts` — get all accessible entities
- Then per-company commands depending on the query (see reference below)

#### Command Reference

| Data | Command |
|---|---|
| 409A valuations | `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` |
| SAFEs & convertible notes | `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` |
| Pro-forma models | `fetch("cap_table:get:pro_forma_models", {"corporation_id": corporation_id})` |
| Cap table by share class | `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` |
| Option grants | `fetch("cap_table:list:grants", {"corporation_id": corporation_id})` |

### Single-Company Cap Table

For a single company, fetch both views and present with a bar chart:

```
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})
fetch("cap_table:get:cap_table_by_stakeholder", {"corporation_id": corporation_id})
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
Trigger the AI computation gate (see interaction-reference §6.2) before outputting any cross-company analysis or health assessments.

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
