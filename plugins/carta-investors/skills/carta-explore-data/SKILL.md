---
name: carta-explore-data
description: >
  Query and explore investors data in the Carta data warehouse. Use when asked about
  fund metrics, NAV, TVPI, DPI, IRR, LP data, portfolio financials, journal entries,
  cash flow statements, balance sheets, cap table data, share classes, ownership
  percentages, shareholders, shareholder list, who owns a company, stakeholders,
  equity holders, 409a valuations, fair market value, portfolio company KPIs, revenue,
  investments, cost basis, MOIC, or any financial reporting question.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - Read(${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/*)
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Explore Data

Query the Carta data warehouse for investors data — NAV, performance metrics, cash flow statements, balance sheets, portfolio financials, and more.

## When to Use

| Common Questions | Semantic File |
|---|---|
| "What companies do we have in our portfolio?"<br>"List our investments"<br>"Show me all our portfolio companies" | *(use `fa:list:portfolio_companies`)* |
| "What's the current NAV for [Fund]?"<br>"Show me TVPI and DPI for all funds"<br>"Show me total contributions and distributions for each LP" | `nav.md` |
| "What's the IRR for [Fund]?"<br>"Show me fund performance metrics"<br>"What are the fund metrics as of Q4 2024?" | `fund-performance.md` |
| "What journal entries were posted for [Fund] last quarter?"<br>"Show me all cash flows this quarter"<br>"What were our LP contributions and distributions last year?"<br>"List all LP investors in [Fund] with their contributions" | `cash-flows.md` |
| "Build me a balance sheet for Fund III as of December 31"<br>"Show me assets, liabilities, and partners' capital for our funds" | `balance-sheet.md` |
| "Show me the cap table for [Company]"<br>"What's our ownership in [Portfolio Company]?"<br>"What share classes does [Company] have?"<br>"What's our fully diluted stake in [Company]?"<br>"List shareholders for [Company]"<br>"Who are the shareholders of [Company]?"<br>"Show me the shareholder list"<br>"Who owns [Company]?" | `cap-table.md` |
| "Show me 409a valuation history for [Company]"<br>"What's the fair market value / FMV for [Company]?" | `valuations.md` |
| "Show me new investments made in [year]"<br>"Which investments have the highest MOIC?"<br>"Which portfolio companies have the highest MOIC?" | `investments.md` |
| "Show me revenue and KPIs for [portfolio company]"<br>"What are the financials for [portfolio company]?" | `company-financials.md` |

## Prerequisites

The user must have the Carta MCP server connected. If this is the first query in the session:

1. Call `list_contexts` to see which firms are accessible
2. Call `set_context` with the target `firm_id` if needed
3. For **cap table queries** — confirm the corporation ID before running. If the user names a portfolio company, resolve its `CORPORATION_ID` from `ALLOCATIONS` first (see Step 1 table below)

## Step 0 — Fetch portfolio companies (MANDATORY GATE)

> **Prerequisite:** Complete the session setup above (`list_contexts` / `set_context`) before this step. `fa:list:portfolio_companies` requires an active firm context and will return an empty list if none is set.

**After setting context**, always fetch the list of portfolio companies the user has access to:

```
fetch("fa:list:portfolio_companies", {})
```

This call is required even if the user named a specific company — it establishes which companies are accessible in the current firm context and provides the `corporation_id` values needed for cap table queries. Do not skip this step.

- If the result is empty, tell the user their firm context may not be set correctly and call `list_contexts` to diagnose.
- If the user asked about a specific company, use the result to resolve the exact `corporation_id` for that company before continuing to Step 2.

## Step 1 — Identify the Query Domain

Use this table to pick the right context file before running any query:

| User is asking about | Context file to read | Primary table / tool |
|---|---|---|
| **Available investments or list of portfolio companies** | — | `fetch("fa:list:portfolio_companies", {})` (already run in Step 0) |
| Current NAV, TVPI, DPI, MOIC, cumulative LP contributions/distributions | `nav.md` | `MONTHLY_NAV_CALCULATIONS` |
| Fund performance — IRR, DPI, TVPI, dry powder, expense breakdown | `fund-performance.md` | `AGGREGATE_FUND_METRICS` |
| Cash flows in a period (contributions, distributions, fees, expenses) | `cash-flows.md` | `JOURNAL_ENTRIES` grouped by `event_type` |
| Balance sheet (assets, liabilities, partners' capital) | `balance-sheet.md` | `JOURNAL_ENTRIES` summed by `account_type` |
| Cap table — share classes, ownership %, shareholders, stakeholders, equity holders, who owns a company | `cap-table.md` | `SUMMARY_CAP_TABLE` (firm context required) |
| 409a valuations, fair market value, FMV, common stock price | `valuations.md` | `IRC409A_VALUE` |
| Investments — cost basis, FMV, MOIC, activity by year, unrealized gain/loss | `investments.md` | `AGGREGATE_INVESTMENTS` |
| Portfolio company financials — revenue, ARR, headcount, KPIs | `company-financials.md` | `COMPANY_FINANCIALS` |
| Benchmark percentile rankings vs peers | Use `carta-investors:carta-performance-benchmarks` | `TEMPORAL_FUND_COHORT_BENCHMARKS` |
| Fund list, entity type (Fund vs SPV) | Query `ALLOCATIONS` directly | `ALLOCATIONS` |

## Step 2 — Load the Context File

Read the matching file from `${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/<domain>.md`:

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

- **Always include LIMIT** — default `LIMIT 200`; use 50–500 for aggregations
- **Only SELECT** — no INSERT, UPDATE, DELETE, or DDL
- **Do not query `INFORMATION_SCHEMA`** — it is not supported in this data warehouse; use the semantic layer files and `fetch("dwh:list:tables", ...)` / `fetch("dwh:get:table_schema", ...)` instead
- **Date fields** — `effective_date` for `JOURNAL_ENTRIES`; `month_end_date` for `MONTHLY_NAV_CALCULATIONS`; `investment_date` for `AGGREGATE_INVESTMENTS`
- **Deduplication** — for `MONTHLY_NAV_CALCULATIONS` and `AGGREGATE_FUND_METRICS`, use `QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY last_refreshed_at DESC) = 1`
- **ALLOCATIONS has multiple rows per fund** — always `GROUP BY fund_uuid` with `MAX(fund_name)` when using it for fund metadata
