---
name: carta-explore-data
description: >
  Query and explore investors data in the Carta data warehouse. Use when asked about
  fund metrics, NAV, TVPI, DPI, LP data, portfolio financials, journal entries,
  cash flow statements, balance sheets, cap table data, share classes, ownership
  percentages, or any financial reporting question.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - Read(${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/nav.md)
  - Read(${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/cash-flows.md)
  - Read(${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/balance-sheet.md)
  - Read(${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/cap-table.md)
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Explore Data

Query the Carta data warehouse for investors data — NAV, performance metrics, cash flow statements, balance sheets, portfolio financials, and more.

## When to Use

- "What companies do we have in our portfolio?"
- "List our investments"
- "Show me all our portfolio companies"
- "What's the current NAV for [Fund]?"
- "Show me TVPI and DPI for all funds"
- "List all LP investors in [Fund] with their contributions"
- "What journal entries were posted for [Fund] last quarter?"
- "Which portfolio companies have the highest MOIC?"
- "Show me total contributions and distributions for each LP"
- "What are the fund metrics as of Q4 2024?"
- "Show me all cash flows this quarter — LP contributions, distributions, management fees, and fund expenses"
- "What were our LP contributions and distributions last year?"
- "Build me a balance sheet for Fund III as of December 31"
- "Show me assets, liabilities, and partners' capital for our funds"
- "Show me the cap table for [Company]"
- "What's our ownership in [Portfolio Company]?"
- "What share classes does [Company] have?"
- "What's our fully diluted stake in [Company]?"

## Prerequisites

The user must have the Carta MCP server connected. If this is the first query in the session:

1. Call `list_contexts` to see which firms are accessible
2. Call `set_context` with the target `firm_id` if needed
3. For **cap table queries** — confirm the corporation ID before running. If the user names a portfolio company, resolve its `CORPORATION_ID` from `ALLOCATIONS` first (see Step 1 table below)

## Step 1 — Identify the Query Domain

Use this table to pick the right context file before running any query:

| User is asking about | Context file to read | Primary table / tool |
|---|---|---|
| **Available investments or list of portfolio companies** | — | `fetch("fa:list:portfolio_companies", {})` — **always start here** |
| Current NAV, TVPI, DPI, MOIC, cumulative LP contributions/distributions | `nav.md` | `MONTHLY_NAV_CALCULATIONS` |
| Cash flows in a period (contributions, distributions, fees, expenses) | `cash-flows.md` | `JOURNAL_ENTRIES` grouped by `event_type` |
| Balance sheet (assets, liabilities, partners' capital) | `balance-sheet.md` | `JOURNAL_ENTRIES` summed by `account_type` |
| Cap table — share classes, ownership %, firm stake for a portfolio company | `cap-table.md` | `SUMMARY_CAP_TABLE` (firm context required) |
| Portfolio companies, FMV, MOIC per investment (metrics) | Query `AGGREGATE_INVESTMENTS` directly | `AGGREGATE_INVESTMENTS` |
| Benchmark percentile rankings vs peers | Use `carta-investors:carta-performance-benchmarks` | `TEMPORAL_FUND_COHORT_BENCHMARKS` |
| Fund list, entity type (Fund vs SPV) | Query `ALLOCATIONS` directly | `ALLOCATIONS` |

## Step 2 — Load the Context File

Read the matching file from the skill directory:

- `${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/nav.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/cash-flows.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/balance-sheet.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/cap-table.md`

The file contains the SQL query, column reference, and presentation rules for that domain. Follow them exactly.

> **Cap table prerequisite check** — before loading `cap-table.md`, verify:
> 1. The MCP context is set to a **firm** (not a fund or LP). Call `list_contexts` if unsure.
> 2. A `CORPORATION_ID` is available. If the user named a company, resolve it:
>    ```sql
>    SELECT DISTINCT corporation_id, company_name
>    FROM FUND_ADMIN.ALLOCATIONS
>    WHERE LOWER(company_name) LIKE '%<user-supplied name>%'
>    LIMIT 10
>    ```
>    If multiple matches are found, use `AskUserQuestion` to confirm which one before continuing.

## Step 3 — Execute the Query

Use the MCP commands in sequence:

1. **Browse tables:** `fetch("dwh:list:tables", {"schema": "FUND_ADMIN"})`
2. **Inspect schema:** `fetch("dwh:get:table_schema", {"table_name": "<TABLE>", "schema": "FUND_ADMIN"})`
3. **Run the query:** `fetch("dwh:execute:query", {"sql": "..."})`

## General Query Rules

- **Portfolio company listing** — call `fetch("fa:list:portfolio_companies", {})` to list available investments; do NOT use `ALLOCATIONS` or `AGGREGATE_INVESTMENTS` for this purpose
- **Always include LIMIT** — default `LIMIT 200`; use 50–500 for aggregations
- **Only SELECT** — no INSERT, UPDATE, DELETE, or DDL
- **Date fields** — `effective_date` for `JOURNAL_ENTRIES`; `month_end_date` for `MONTHLY_NAV_CALCULATIONS`
- **Deduplication** — for `MONTHLY_NAV_CALCULATIONS`, use `QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY last_refreshed_at DESC) = 1`
- **ALLOCATIONS has multiple rows per fund** — always `GROUP BY fund_uuid` with `MAX(fund_name)` when using it for fund metadata

