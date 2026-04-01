---
name: explore-data
description: Query and explore fund admin data in the Carta data warehouse. Use when asked about fund metrics, NAV, LP data, portfolio financials, journal entries, investments, or any general data warehouse query.
---

# Explore Data

Query the Carta data warehouse for fund admin data — NAV, partner data, portfolio financials, journal entries, investments, and more.

## When to Use

- "What's the current NAV for [Fund]?"
- "Show me TVPI for all funds"
- "List all LP investors in [Fund] with their contributions"
- "What journal entries were posted for [Fund] last quarter?"
- "Which portfolio companies have the highest MOIC?"
- "Show me total contributions and distributions for each LP"
- "What are the fund metrics as of Q4 2024?"

## Prerequisites

The user must have the Carta MCP server connected. If this is their first query in the session:

1. Call `list_contexts` to see which firms are accessible
2. Call `set_context` with the target `firm_id` if needed

## How to Query

Use the three MCP commands in sequence:

1. **Find the right table:** `fetch("dwh:list:tables", {"schema": "FUND_ADMIN"})` — browse available datasets
2. **Understand the schema:** `fetch("dwh:get:table_schema", {"table_name": "<TABLE>", "schema": "FUND_ADMIN"})` — get column details
3. **Run the query:** `fetch("dwh:execute:query", {"sql": "SELECT ... FROM FUND_ADMIN.<TABLE> WHERE ... LIMIT 1000"})` — fetch results

## Common Datasets

| Table | Use For |
|-------|---------|
| `MONTHLY_NAV_CALCULATIONS` | NAV, commitments, distributions, DPI/TVPI/MOIC per fund per month |
| `AGGREGATE_FUND_METRICS` | LP/GP investor counts, fund-level summary metrics |
| `AGGREGATE_INVESTMENTS` | Portfolio company list, active investments, cost basis, FMV |
| `JOURNAL_ENTRIES` | Balance sheet data — cash, cost of investment, unrealized G/L, liabilities |
| `ALLOCATIONS` | Fund list with entity types (Fund, SPV), fund names, firm info |
| `TEMPORAL_FUND_COHORT_BENCHMARKS` | Performance benchmarks by vintage year, AUM bucket, percentiles |

## Query Guidelines

- **Always include LIMIT** — default to `LIMIT 1000` unless the user asks for more
- **Only SELECT** — no INSERT, UPDATE, DELETE, or DDL. The MCP validates this server-side
- **Date fields** — use `effective_date` for accounting dates, `month_end_date` for NAV periods
- **Deduplication** — some tables have multiple rows per entity; use `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY last_refreshed_at DESC) = 1` when needed

## Presentation

1. **Lead with a summary** — "Your firm has 5 funds with a combined NAV of $X"
2. **Format as tables** — use markdown tables with clear column headers
3. **Format currency** — use `$X,XXX` for amounts, `X.XXx` for multiples
4. **Flag notable items** — low NAV, negative performance, missing data
5. **Use Carta voice** — say "your funds" not "query results"; say "your NAV" not "MONTHLY_NAV_CALCULATIONS data"

## Example: Fund NAV Summary

```sql
SELECT
    n.fund_name,
    n.month_end_date,
    n.ending_total_nav,
    n.total_tvpi,
    n.total_dpi,
    n.total_moic
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS n
WHERE n.is_firm_rollup = FALSE
QUALIFY ROW_NUMBER() OVER (PARTITION BY n.fund_uuid ORDER BY n.month_end_date DESC, n.last_refreshed_at DESC) = 1
ORDER BY n.ending_total_nav DESC
LIMIT 50
```

| Fund | As Of | NAV | TVPI | DPI | MOIC |
|------|-------|-----|------|-----|------|
| Fund I | 2024-12-31 | $150,000,000 | 1.85x | 0.42x | 1.85x |

## Example: LP Contributions by Fund

```sql
SELECT
    fund_name,
    SUM(cumulative_lp_contributions) AS total_lp_contributions,
    SUM(cumulative_total_distributions) AS total_distributions,
    COUNT(DISTINCT fund_uuid) AS fund_count
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE is_firm_rollup = FALSE
  AND month_end_date = (SELECT MAX(month_end_date) FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS)
GROUP BY fund_name
ORDER BY total_lp_contributions DESC
LIMIT 50
```

## Best Effort

- **Computed:** summaries, aggregations, and trend analysis derived by Claude from query results
- **Authoritative:** raw data values returned directly from the Carta data warehouse
