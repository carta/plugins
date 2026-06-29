# NAV & Performance Metrics

Query current NAV, TVPI, DPI, MOIC, and cumulative LP contribution totals per fund.

> For *period* cash flows (e.g. "how much did LPs contribute this quarter?"), use `cash-flows.md` instead —
> `MONTHLY_NAV_CALCULATIONS` stores **cumulative** totals, not period activity.
>
> For **IRR** (internal rate of return), use `AGGREGATE_FUND_METRICS` (see `fund-performance.md`) —
> `MONTHLY_NAV_CALCULATIONS` does not contain IRR. Do not attempt to compute IRR from this table.

## ⚠️ Common Mistakes in This Domain

| ❌ Wrong column | ✅ Correct column | Note |
|---|---|---|
| `LP_NAV` | `ending_lp_nav` | |
| `TOTAL_NAV` | `ending_total_nav` | |
| `TVPI` / `NET_TVPI` | `total_tvpi` | |
| `DPI` | `total_dpi` | |
| `COMMITTED_CAPITAL` / `TOTAL_COMMITMENTS` | `cumulative_commitment_amount` | |
| `NET_IRR` / `IRR` | **not in this table** — use `AGGREGATE_FUND_METRICS.net_lp_irr` | `MONTHLY_NAV_CALCULATIONS` has no IRR column |
| `NAV_HISTORY` / `FUND_NAV` | `MONTHLY_NAV_CALCULATIONS` (schema-qualified) | wrong table name |

## Table: MONTHLY_NAV_CALCULATIONS

Each row is a month-end snapshot per fund. Use `QUALIFY ROW_NUMBER()` to get the latest row per fund.

| Column | Description |
|--------|-------------|
| `fund_name` | Fund display name |
| `month_end_date` | Snapshot date |
| `ending_total_nav` | Net asset value at month end |
| `total_tvpi` | Total Value to Paid-In multiple |
| `total_dpi` | Distributions to Paid-In multiple |
| `total_moic` | Multiple on Invested Capital |
| `cumulative_lp_contributions` | Total LP capital called to date |
| `cumulative_total_distributions` | Total distributions paid to date |
| `cumulative_commitment_amount` | Total committed capital |
| `is_firm_rollup` | `TRUE` for firm-level aggregates — always filter to `FALSE` for per-fund rows |

## Query 1 — Current NAV with TVPI and DPI by Fund

```sql
SELECT
    fund_name,
    month_end_date          AS as_of,
    ending_total_nav,
    total_tvpi,
    total_dpi,
    total_moic,
    cumulative_lp_contributions,
    cumulative_total_distributions,
    cumulative_commitment_amount
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE is_firm_rollup = FALSE
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY fund_uuid
    ORDER BY month_end_date DESC, last_refreshed_at DESC
) = 1
ORDER BY ending_total_nav DESC
LIMIT 50
```

## Query 2 — LP Contributions and Distributions by Fund

```sql
SELECT
    fund_name,
    SUM(cumulative_lp_contributions)    AS total_lp_contributions,
    SUM(cumulative_total_distributions) AS total_distributions,
    COUNT(DISTINCT fund_uuid)            AS fund_count
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE is_firm_rollup = FALSE
  AND month_end_date = (SELECT MAX(month_end_date) FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS)
GROUP BY fund_name
ORDER BY total_lp_contributions DESC
LIMIT 50
```

## Presentation

1. **Lead with a summary** — "Your firm has 5 funds with a combined NAV of $X"
2. **Format as tables** with clear column headers
3. **Currency** — `$X,XXX`; multiples — `X.XXx`
4. **Flag notable items** — low NAV, negative performance, missing data
5. **Use Carta voice** — "your funds", "your NAV", not "query results"
