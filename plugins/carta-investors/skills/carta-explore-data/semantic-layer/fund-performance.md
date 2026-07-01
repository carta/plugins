# Fund Performance Metrics

Query fund-level performance metrics: IRR, DPI, TVPI, RVPI, MOIC, NAV, cost basis, and expense breakdowns.

## Fund System Check (run first when fund system is unknown)

Before running any DWH query, check whether the named fund belongs to Fund Forecasting (Tactyc)
rather than the Carta Web / Fund Admin data warehouse.

## Gate 0 — Unnamed Fund Queries ("List my funds", "What funds do I manage?")

When the user has **not named a specific fund**, skip Gate 1 (which requires a fund name for `search=`)
and use the DWH directly to determine whether this firm has funds in Carta Web / Fund Admin:

```sql
SELECT
    fund_name,
    entity_type_name,
    vintage_year,
    fund_size,
    ending_total_nav
FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY fund_uuid
    ORDER BY month_end_date DESC, last_refreshed_at DESC
) = 1
ORDER BY ending_total_nav DESC NULLS LAST
LIMIT 50
```

**If the query returns funds → show them** using the Presentation rules at the bottom of this file.
The firm's funds are in Carta Web / Fund Admin — skip Gates 1 and 2 entirely.

**If the query returns empty results** → the firm may have funds registered but no month-end
close yet (newly onboarded). Before redirecting, run a secondary existence check against
`ALLOCATIONS`, which is populated at fund creation and does not require a close:

```sql
SELECT DISTINCT fund_name, fund_uuid
FROM FUND_ADMIN.ALLOCATIONS
WHERE fund_uuid IS NOT NULL
GROUP BY fund_uuid, fund_name
LIMIT 10
```

- **`ALLOCATIONS` returns funds** → the firm has DWH funds but no performance data yet. Show
  the fund list from `ALLOCATIONS` and note that performance metrics will appear after the
  first month-end close.
- **`ALLOCATIONS` also returns empty** → this firm has no funds in Carta Web / Fund Admin at
  all. Redirect the user:
  > No funds found in the Carta Web / Fund Admin data warehouse for your firm context.
  > Your funds may live in Fund Forecasting (Tactyc) — type `/carta-fund-forecasting` to list your Fund Forecasting funds.

Do not run any further DWH queries. The explore-data skill's work is done.

**Skip Gate 0 when:** a specific fund name is mentioned → proceed to Gate 1 below.

**Skip Gate 1 when:** the user has already confirmed the fund is in Carta Web / Fund Admin
in this session, or when the query does not name a specific fund (handled by Gate 0 above).

**Gate 1 — Look up the fund in Fund Forecasting**

```
call_tool({"name": "fund_forecasting__list__funds", "arguments": {"search": "<distinctive word(s) from fund name>"}})
```

Tips: use only distinctive words — omit "Fund", "Capital", fund numbers. For "La Garita Fund II",
use `search=la garita`. If the call returns an error (access denied, feature not enabled, not
found) → the fund is not in Fund Forecasting. Proceed to the DWH queries below. Do not inform
the user of the error.

**Gate 2 — Route based on result**

**No match** (`total = 0` or empty results array)
→ Fund is in Carta Web / Fund Admin. Continue with the DWH queries below.

**Clear match** (one obvious result matching the named fund)
→ Stop. Redirect the user:
> Found **[fund name]** in Fund Forecasting (Tactyc). This fund's data lives in the Fund
> Forecasting domain, not in the Carta Web / Fund Admin data warehouse. To get [the requested
> metric], use the Fund Forecasting skill — type `/carta-fund-forecasting` to continue with
> the same question.

Do not run any DWH query. The explore-data skill's work is done.

**Ambiguous** (multiple candidates, or `cartaId` field links the match to a Carta Web fund)
→ Use `AskUserQuestion`:
> I found a fund named **[fund name]** in Fund Forecasting (Tactyc). Is this the fund you mean,
> or are you asking about a fund in Carta Web / Fund Admin?
> - **Fund Forecasting (Tactyc)** — performance metrics from the forecasting model
> - **Carta Web / Fund Admin** — accounting data from the data warehouse

Based on the user's answer: redirect to `carta-fund-forecasting` OR continue with DWH queries.

**Limit:** one `call_tool` call maximum — do not call `list:funds` without `search=`, and do
not pre-fetch fund details. Once routed in a session, do not re-run this check for follow-up
questions about the same fund.

## Gate 3 — DWH Querying Instructions (only when fund is NOT in Fund Forecasting)

> For *current NAV and cumulative LP contributions*, `MONTHLY_NAV_CALCULATIONS` (see `nav.md`) is also valid.
> `AGGREGATE_FUND_METRICS` is preferred when you need IRR, DPI, TVPI, expense detail, or dry powder.

## ⚠️ Common Mistakes in This Domain

| ❌ Wrong | ✅ Correct | Note |
|---|---|---|
| `FUND_METRICS` / `FUND_PERFORMANCE` / `FUND_PERFORMANCE_SUMMARY` | `FUND_ADMIN.AGGREGATE_FUND_METRICS` | wrong table names |
| `NET_IRR` | `net_lp_irr` (LP net IRR) or `deal_irr` (gross) | use `net_lp_irr` for LP-level IRR |
| `TVPI` / `NET_TVPI` | `total_tvpi` | |
| `DPI` | `lp_dpi` | use `total_dpi` for `MONTHLY_NAV_CALCULATIONS` (see `nav.md`) |
| `VINTAGE` | `vintage_year` | |
| `FUND_SIZE` | `fund_size` | verify with `dwh__get__table_schema` |
| `FUND_ID` | `fund_uuid` (VARCHAR) | integer fund_id is internal only |
| Querying `AGGREGATE_FUND_METRICS` for a specific past date/quarter-end | Query `TEMPORAL_FUND_COHORT_BENCHMARKS` instead | `AGGREGATE_FUND_METRICS` only retains the latest monthly refresh — zero rows for a past date does not mean the data doesn't exist |

## Common Aliases (table name aliases — use `AGGREGATE_FUND_METRICS` instead)

`FUND_PERFORMANCE`, `FUND_METRICS`, `FUND_SUMMARY`, `FUND_QUARTERLY_PERFORMANCE`, `FUND_INVESTMENTS`, `FUND_PERFORMANCE_METRICS`, `FUND_PERFORMANCE_METRICS_HISTORY`, `PERFORMANCE`

> For deal-level IRR specifically, use `TEMPORAL_DEAL_IRR` instead.

## Table: AGGREGATE_FUND_METRICS

Each row is a month-end snapshot per fund. Use `QUALIFY ROW_NUMBER()` to get the latest row per fund.

**This table only ever holds the latest monthly refresh — it is NOT a historical archive.** A
query for a specific past `month_end_date` (e.g. last quarter-end) returning zero rows does
**not** mean the historical data doesn't exist — it means the wrong table was queried. For any
"as of [past date]" or "as of last quarter-end" IRR/TVPI/DPI/MOIC request, use
`TEMPORAL_FUND_COHORT_BENCHMARKS` instead — see Query 2 below.

| Column | Description |
|--------|-------------|
| `fund_name` | Fund display name |
| `firm_name` | Name of the management firm |
| `month_end_date` | Snapshot date |
| `vintage_year` | Calendar year of first capital call — use for cohort analysis |
| `entity_type_name` | Legal structure (e.g. `Fund`, `SPV`) |
| `ending_total_nav` | Ending NAV for both GPs and LPs |
| `ending_lp_nav` | Ending NAV for LPs |
| `total_tvpi` | Total Value to Paid-In (LPs + GPs) |
| `lp_tvpi` | TVPI for LPs only |
| `lp_dpi` | LP Distributions to Paid-In |
| `total_rvpi` | Residual Value to Paid-In |
| `total_moic` | Multiple on Invested Capital |
| `deal_irr` | Gross deal-level IRR (%) — NULL when not computable |
| `net_lp_irr` | Net LP IRR (%) — NULL when not computable |
| `fund_size` | Total committed capital across all LPs and GPs |
| `dry_powder` | Remaining capital available (`fund_size − cost − opx − mgmt_fees`) |
| `perc_capital_remaining` | % of fund size not yet deployed |
| `total_cost_of_investments` | Aggregate cost basis of all investments |
| `total_investments_at_fair_value` | Current FMV of remaining investments |
| `total_unrealized_gain_loss` | Unrealized gain/loss on current holdings |
| `total_cap_contribution` | Total capital contributed by all partners |
| `total_lp_cap_contribution` | LP capital contributed to date |
| `total_distribution` | Total distributions paid to all partners |
| `total_lp_distribution` | LP distributions paid to date |
| `total_mgmt_fees` | Total management fees paid |
| `total_opx` | Total operating expenses excluding management fees |
| `fund_uuid` | Unique fund identifier (foreign key) |
| `is_eligible_fund` | `TRUE` if fund meets benchmark inclusion criteria |
| `is_administered_by_carta` | `TRUE` if fund has Carta fund admin access |

### IRR disambiguation

| Use case | Column | Notes |
|----------|--------|-------|
| Fund-level gross IRR (current/latest) | `deal_irr` | On `AGGREGATE_FUND_METRICS` |
| Fund-level net LP IRR (current/latest) | `net_lp_irr` | On `AGGREGATE_FUND_METRICS` |
| Fund-level gross or net LP IRR as of a past date/quarter-end | `deal_irr`, `net_lp_irr` | On `TEMPORAL_FUND_COHORT_BENCHMARKS` — see Query 2 |
| Deal-level IRR (per investment) | — | Use `TEMPORAL_DEAL_IRR` table instead |

## Query 1 — Fund Performance Summary (latest snapshot)

```sql
SELECT
    fund_name,
    firm_name,
    month_end_date          AS as_of,
    vintage_year,
    entity_type_name,
    ending_total_nav,
    total_tvpi,
    lp_dpi,
    total_moic,
    net_lp_irr,
    deal_irr,
    fund_size,
    dry_powder,
    perc_capital_remaining,
    total_cost_of_investments,
    total_unrealized_gain_loss
FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY fund_uuid
    ORDER BY month_end_date DESC, last_refreshed_at DESC
) = 1
ORDER BY ending_total_nav DESC NULLS LAST
LIMIT 50
```

## Query 2 — Fund Performance As Of a Historical Date

Use this query whenever the user asks for IRR, TVPI, DPI, or MOIC **as of a specific past date**
(e.g. "as of 6/30/2026", "as of last quarter-end", "at the end of Q2"). Do **not** query
`AGGREGATE_FUND_METRICS` with a past `month_end_date` filter — it only has the latest refresh.

**`performance_quarter_start_date` despite its name holds the LAST day of the quarter (quarter-end
— e.g. `2026-06-30` for Q2 2026), not the first day.** It is a direct alias of the underlying
`month_end_date` column, filtered to quarter-end rows only. When a user says "as of 6/30/2026",
pass `2026-06-30` literally — do NOT convert it to the quarter's opening date (`2026-04-01`); doing
so will silently return zero rows, the exact failure this query exists to fix.

```sql
SELECT
    fund_name,
    performance_quarter_start_date AS as_of,
    net_lp_irr,
    deal_irr,
    net_irr,
    tvpi,
    dpi,
    lp_dpi,
    lp_tvpi,
    moic
FROM FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS
WHERE fund_name ILIKE '%{fund_name}%'
  AND performance_quarter_start_date = '{as_of_quarter_end_date}'
ORDER BY fund_name
LIMIT 50
```

Caveats:
- **Quarter-end grain only** — one row per fund per quarter-end (last day of Mar/Jun/Sep/Dec), not
  every month-end, and the stored date value IS that quarter-end day despite the column's
  `_start_date` suffix (see above). If the user asks for a non-quarter-end date, use the nearest
  prior quarter-end and say so.
- **Only benchmark-eligible funds appear here** — funds need a resolved `vintage_year`,
  `fund_aum_bucket`, and `entity_type_name`. If a fund is missing, say so explicitly rather than
  concluding no historical data exists at all.
- **Column names differ slightly from `AGGREGATE_FUND_METRICS`**: this table also has `net_irr`
  (fund-level net IRR combining LPs and GPs — distinct from both `deal_irr` and `net_lp_irr`).
  `deal_irr` and `net_lp_irr` mean the same thing as on `AGGREGATE_FUND_METRICS`.
- For peer/percentile benchmark comparisons (not just the fund's own historical values), this
  table also has percentile columns (`dpi_5`...`dpi_95`, `net_lp_irr_5th`...`net_lp_irr_95th`,
  etc.) — for that use case prefer `carta-investors:carta-performance-benchmarks`.

## Query 3 — Fund Performance Trend Over Time

```sql
SELECT
    fund_name,
    month_end_date,
    ending_total_nav,
    total_tvpi,
    lp_dpi,
    net_lp_irr,
    total_cost_of_investments,
    total_distribution
FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
WHERE fund_name ILIKE '%{fund_name}%'
ORDER BY fund_name, month_end_date
LIMIT 200
```

## Query 4 — Expense Breakdown by Fund

```sql
SELECT
    fund_name,
    month_end_date          AS as_of,
    total_mgmt_fees,
    total_opx,
    cost_fa_fees,
    cost_legal_fees,
    cost_tax_prep_fees,
    cost_audit_fees,
    cost_other_professional_fees,
    perc_mgmt_fees_to_fundsize,
    perc_opx_to_contributions
FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY fund_uuid
    ORDER BY month_end_date DESC, last_refreshed_at DESC
) = 1
ORDER BY total_mgmt_fees DESC NULLS LAST
LIMIT 50
```

## Presentation

1. **Lead with a summary** — "Your firm has N funds with a combined NAV of $X and weighted net IRR of Y%"
2. **Format as a table** — Fund Name | NAV | TVPI | DPI | Net IRR | Vintage
3. **Currency** — `$X,XXX`; multiples — `X.XXx`; IRR — `X.X%`
4. **Flag nulls** — show `—` for IRR when NULL (not enough data to compute)
5. **Use Carta voice** — "your fund's IRR", not "query results"
