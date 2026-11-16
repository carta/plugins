# Portfolio Company Financials & KPIs

Query financial metrics and KPIs reported by portfolio companies — revenue, ARR, headcount, burn rate, and other operational data.

> For *investment cost basis and FMV*, use `AGGREGATE_INVESTMENTS` (see `investments.md`).
> `COMPANY_FINANCIALS` contains metrics **reported by the company**, not fund-level investment figures.

## Read them directly first: `portfolio_holding__list__metrics`

Investors mix KPIs and statement lines in one ask ("burn, headcount and revenue for all my portcos"). One read answers any mix, for one company, a list or every holding, in seconds, with the figures the company page shows. Use it before Step 1 of the skill (`dwh__execute__question`) and before any SQL below:

```
read_tool({"name": "portfolio_holding__list__metrics", "arguments": {"owner_id": <firm_carta_id>, "metrics": "burn, headcount, revenue", "companies": "all"}})
```

- `owner_id` is the active firm's integer `carta_id` from `list_contexts`, not its `firm_id` UUID.
- `metrics` takes the user's own words (revenue, EBITDA, gross profit, net income, burn, runway, headcount, cash, ARR, MRR) or the firm's name for a custom KPI. Pass them as the user said them. A word in `not_found` or `ambiguous` in the answer: ask the user which metric they mean, offering the names it returns. Do not guess one.
- `companies` takes company names or `all`. `fund_names` (for example `"Fund II"`) narrows to one fund's companies.
- `period_end` (`YYYY-MM-DD`, e.g. `2026-06-30` for Q2 2026) reads one period, and `periods` the latest N. `frequency` defaults to `QUARTER`. `include_forecast: "true"` adds the budget beside the actuals.
- "Who hasn't reported Q2?": read the metric with `period_end` and answer from `missing`, which lists the companies with no figure for that period.
- Each company's figures carry its `currency`. Never add or average amounts across currencies.

Fall back to the `COMPANY_FINANCIALS` SQL below only when:
- the read answers `Unknown tool`, because it isn't on for this user;
- it fails for every company;
- the question needs warehouse-only fields: `source_type`, the submission history (`as_of_date`), or a join with investment figures from `investments.md`.

## Common Aliases

`PORTFOLIO_COMPANY_KPIS`, `PORTCO_FINANCIALS`, `COMPANY_KPIS`, `PORTCO_KPIS`, `PORTFOLIO_COMPANY_FINANCIALS`, `HEADCOUNT`, `METRICS`, `PORTCO_METRICS`

## Table: COMPANY_FINANCIALS

Each row is a single metric data point for a portfolio company at a given period. The table is in a long/unpivoted format — one row per metric per period.

| Column | Description |
|--------|-------------|
| `legal_name` | Legal name of the portfolio company — use to filter by company |
| `firm_name` | Name of the management firm |
| `as_of_date` | Date the data was collected |
| `period_start` | Start date of the reporting period |
| `period_end` | End date of the reporting period — **use `period_end`, not `period_end_date`** |
| `frequency` | Period frequency: `ANN` (annual), `QTR` (quarterly), `MON` (monthly), `SA` (semi-annual) |
| `name` | Human-readable metric name (e.g. "Revenue", "ARR", "Headcount") |
| `mnemonic` | Short code for the metric — use for programmatic filtering |
| `report_type` | `P&L`, `Cash Flow`, `Balance Sheet`, or `KPI` |
| `float_value` | Numeric value of the metric |
| `string_value` | String value when metric cannot be represented as a number |
| `unit_type` | `Dollar`, `Percentage`, `Ratio`, `Number` |
| `currency` | Currency of the metric (e.g. `USD`) |
| `instance_type` | `Actual` or `Estimate` |
| `source_type` | Data source: `Direct Import`, `Xero`, `Excel Import`, `Codat Import` |
| `agg_method` | Aggregation method: `Sum`, `Average`, `Max`, `Min` |
| `corporation_id` | Carta corporation UUID (NULL for LLCs) |
| `entity_type` | `CORP` for corporations, `LLC` for LLCs |

### Latest submission per data point

A company can resubmit the same metric for the same period, so the table can hold several rows per data point. To keep only the latest, add this `QUALIFY` (newest `as_of_date`, then highest `instance_id`):

```sql
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY firm_id, COALESCE(corporation_id, llc_entity_id, general_ledger_issuer_id),
                 period_end, mnemonic, frequency, report_type, instance_type
    ORDER BY DATE(as_of_date) DESC, instance_id DESC
) = 1
```

> **Tip**: Run the discovery query below first to see which metrics are available for a given company.

### Discovery Query — Available Metrics for a Company

```sql
SELECT DISTINCT name, mnemonic, report_type, unit_type, frequency
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE LOWER(legal_name) ILIKE '%{company_name}%'
ORDER BY report_type, name
LIMIT 100
```

## Query 1 — Latest KPIs for a Portfolio Company

```sql
SELECT
    legal_name,
    period_start,
    period_end,
    frequency,
    name            AS metric,
    float_value     AS value,
    unit_type,
    currency,
    instance_type
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE LOWER(legal_name) ILIKE '%{company_name}%'
  AND instance_type = 'Actual'
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY firm_id, COALESCE(corporation_id, llc_entity_id, general_ledger_issuer_id),
                 period_end, mnemonic, frequency, report_type, instance_type
    ORDER BY DATE(as_of_date) DESC, instance_id DESC
) = 1
ORDER BY period_end DESC, report_type, name
LIMIT 100
```

## Query 2 — Revenue Trend Over Time

```sql
SELECT
    legal_name,
    period_start,
    period_end,
    float_value     AS revenue,
    currency,
    frequency,
    instance_type
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE LOWER(legal_name) ILIKE '%{company_name}%'
  AND LOWER(name) ILIKE '%revenue%'
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY firm_id, COALESCE(corporation_id, llc_entity_id, general_ledger_issuer_id),
                 period_end, mnemonic, frequency, report_type, instance_type
    ORDER BY DATE(as_of_date) DESC, instance_id DESC
) = 1
ORDER BY period_end DESC
LIMIT 50
```

## Query 3 — Top Companies by a Metric (e.g. Revenue)

```sql
WITH latest AS (
    SELECT *
    FROM FUND_ADMIN.COMPANY_FINANCIALS
    WHERE LOWER(name) ILIKE '%{metric_name}%'
      AND instance_type = 'Actual'
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY firm_id, COALESCE(corporation_id, llc_entity_id, general_ledger_issuer_id),
                     period_end, mnemonic, frequency, report_type, instance_type
        ORDER BY DATE(as_of_date) DESC, instance_id DESC
    ) = 1
)
SELECT
    legal_name,
    firm_name,
    period_end      AS as_of,
    float_value     AS metric_value,
    unit_type,
    currency
FROM latest
WHERE float_value IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY legal_name
    ORDER BY float_value DESC
) = 1
ORDER BY float_value DESC NULLS LAST
LIMIT 50
```

## Presentation

1. **Lead with the company and period** — "Here are the latest financials for [Company] as of [period_end]"
2. **Group by `report_type`** — P&L / Cash Flow / Balance Sheet / KPI sections
3. **Format numbers by `unit_type`** — `Dollar` → `$X,XXX`; `Percentage` → `X.X%`; `Number` → `X,XXX`
4. **Flag estimates** — note when `instance_type = 'Estimate'`
5. **Use Carta voice** — "your portfolio company reported", not "query results"
