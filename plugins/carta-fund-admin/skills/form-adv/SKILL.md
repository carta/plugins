---
name: form-adv
description: Fetch Form ADV Schedule D regulatory data and firm rollup for fund-level reporting. Use when asked about Form ADV, regulatory AUM, Schedule D, Form PF Section 1, or annual filing data.
---

# Form ADV Schedule D Data

Fetch Form ADV Schedule D §7.B.(1) regulatory data for each Fund and SPV, plus an Item 5.D. firm-level rollup.

## When to Use

- "Pull our Form ADV data for 2025"
- "What's our regulatory AUM as of December 2024?"
- "Show me Schedule D data for last year's filing"
- "What do I need for Form PF Section 1?"
- "What's our total AUM across all funds?"

## Prerequisites

- The user must have the Carta MCP server connected
- A `reporting_date` is required (YYYY-MM-DD format, e.g. "2025-12-31") — **ask if not provided**
- If this is the first query, call `list_contexts` and `set_context` to set the firm

## Data Retrieval

Run a single query using `fetch("dwh:execute:query", {"sql": "..."})` that joins across five datasets to produce the full Form ADV view. The query produces two sections: per-fund detail and a firm rollup.

### Source Tables

| Table | Purpose |
|-------|---------|
| `FUND_ADMIN.ALLOCATIONS` | Fund list — Fund and SPV entity types only |
| `FUND_ADMIN.JOURNAL_ENTRIES` | Balance sheet: cash, cost of investment, unrealized G/L, other assets, LOC |
| `FUND_ADMIN.MONTHLY_NAV_CALCULATIONS` | NAV, commitments, distributions (inception + annual), DPI/TVPI/MOIC |
| `FUND_ADMIN.AGGREGATE_FUND_METRICS` | LP/GP investor counts (current snapshot) |
| `FUND_ADMIN.AGGREGATE_INVESTMENTS` | Active portfolio company count |

### Key Fields

| Output Field | Source | Notes |
|---|---|---|
| Fair Market Value | Journal Entries | cost_of_investment + unrealized_gl |
| Cash | Journal Entries | Account types 1000–1099 |
| Other Assets | Journal Entries | Account types 1200–1899 |
| Total Gross Assets | Computed | FMV + Cash + Other Assets |
| LOC / Borrowings | Journal Entries | Accounts 2000 + 2001, negated (liabilities are credit) |
| Unfunded Commitments | NAV Calculations | GREATEST(commitment - contributions, 0) |
| Regulatory AUM | Computed | Total Gross Assets + Unfunded Commitments |
| Net Asset Value | NAV Calculations | ending_total_nav |
| Net AUM (Form PF) | Computed | NAV + Unfunded Commitments |
| Annual Subscriptions | NAV Calculations | SUM of monthly contributions in reporting year |
| Annual Distributions | NAV Calculations | SUM of monthly distributions in reporting year |
| LP/GP Investor Counts | Aggregate Fund Metrics | Current snapshot, latest row per fund |
| Portfolio Company Count | Aggregate Investments | Active investments only |
| DPI / TVPI / MOIC | NAV Calculations | At reporting date |

### Important: Date Field

Use `effective_date` (accounting date) from journal entries. Do NOT filter on `posted_date` — it can drop valid entries and cause mismatches against the Carta balance sheet.

### SQL Query

Execute this query with `fetch("dwh:execute:query", ...)`, substituting the user's reporting date:

```sql
WITH
constants AS (
    SELECT LAST_DAY('{reporting_date}'::DATE) AS reporting_date
),
funds AS (
    SELECT
        a.fund_uuid,
        MAX(a.fund_name) AS fund_name,
        MAX(a.entity_type_name) AS entity_type_name,
        MAX(a.firm_name) AS firm_name,
        c.reporting_date
    FROM FUND_ADMIN.ALLOCATIONS a
    CROSS JOIN constants c
    WHERE a.entity_type_name IN ('Fund', 'SPV')
    GROUP BY a.fund_uuid, c.reporting_date
),
je_balances AS (
    SELECT
        j.fund_uuid,
        SUM(CASE WHEN j.account_type BETWEEN 1000 AND 1099 THEN j.amount ELSE 0 END) AS cash,
        SUM(CASE WHEN j.account_type = 1100 THEN j.amount ELSE 0 END) AS cost_of_investment,
        SUM(CASE WHEN j.account_type = 1101 THEN j.amount ELSE 0 END) AS unrealized_gl,
        SUM(CASE WHEN j.account_type BETWEEN 1200 AND 1899 THEN j.amount ELSE 0 END) AS other_assets,
       -SUM(CASE WHEN j.account_type IN (2000, 2001) THEN j.amount ELSE 0 END) AS loc_outstanding
    FROM FUND_ADMIN.JOURNAL_ENTRIES j
    INNER JOIN funds f ON j.fund_uuid = f.fund_uuid
    WHERE j.effective_date <= f.reporting_date
    GROUP BY j.fund_uuid
),
nav_data AS (
    SELECT
        n.fund_uuid,
        n.ending_total_nav,
        n.ending_lp_nav,
        n.ending_gp_nav,
        n.cumulative_commitment_amount,
        n.cumulative_total_contributions,
        n.cumulative_lp_contributions,
        n.cumulative_gp_contributions,
        n.cumulative_total_distributions,
        GREATEST(n.cumulative_commitment_amount - n.cumulative_total_contributions, 0) AS unfunded_commitments,
        n.total_tvpi,
        n.total_moic,
        n.total_dpi
    FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS n
    INNER JOIN funds f ON n.fund_uuid = f.fund_uuid
    WHERE n.is_firm_rollup = FALSE
      AND n.month_end_date = f.reporting_date
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.fund_uuid ORDER BY n.last_refreshed_at DESC) = 1
),
annual_activity AS (
    SELECT
        n.fund_uuid,
        SUM(n.total_contributions) AS annual_subscriptions,
        SUM(n.total_distributions) AS annual_distributions
    FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS n
    INNER JOIN funds f ON n.fund_uuid = f.fund_uuid
    WHERE n.is_firm_rollup = FALSE
      AND n.month_end_date BETWEEN DATE_TRUNC('year', f.reporting_date) AND f.reporting_date
    GROUP BY n.fund_uuid
),
lp_counts AS (
    SELECT
        m.fund_uuid,
        m.count_lps,
        m.count_gps
    FROM FUND_ADMIN.AGGREGATE_FUND_METRICS m
    INNER JOIN funds f ON m.fund_uuid = f.fund_uuid
    QUALIFY ROW_NUMBER() OVER (PARTITION BY m.fund_uuid ORDER BY m.last_refreshed_at DESC) = 1
),
portfolio_summary AS (
    SELECT
        ai.fund_uuid,
        COUNT(DISTINCT ai.issuer_name) AS active_portfolio_companies
    FROM FUND_ADMIN.AGGREGATE_INVESTMENTS ai
    INNER JOIN funds f ON ai.fund_uuid = f.fund_uuid
    WHERE ai.is_active_investment = TRUE
    GROUP BY ai.fund_uuid
)

SELECT
    '7.B.(1) Fund Detail' AS form_adv_section,
    f.fund_name,
    f.entity_type_name AS entity_type,
    ROUND(je.cost_of_investment + je.unrealized_gl, 2) AS fair_market_value,
    ROUND(je.cash, 2) AS cash,
    ROUND(je.other_assets, 2) AS other_assets,
    ROUND(je.cost_of_investment + je.unrealized_gl + je.cash + je.other_assets, 2) AS total_gross_assets,
    ROUND(je.loc_outstanding, 2) AS loc_borrowings_outstanding,
    ROUND(nav.unfunded_commitments, 2) AS unfunded_commitments,
    ROUND(je.cost_of_investment + je.unrealized_gl + je.cash + je.other_assets + nav.unfunded_commitments, 2) AS regulatory_aum,
    ROUND(nav.ending_total_nav, 2) AS net_asset_value,
    ROUND(nav.ending_lp_nav, 2) AS lp_nav,
    ROUND(nav.ending_gp_nav, 2) AS gp_nav,
    ROUND(nav.ending_total_nav + nav.unfunded_commitments, 2) AS net_aum_form_pf,
    ROUND(nav.cumulative_commitment_amount, 2) AS total_committed_capital,
    ROUND(act.annual_subscriptions, 2) AS annual_subscriptions,
    ROUND(act.annual_distributions, 2) AS annual_distributions,
    ROUND(nav.cumulative_total_distributions, 2) AS total_distributions_since_inception,
    lp.count_lps AS number_of_lp_investors,
    lp.count_gps AS number_of_gp_investors,
    ps.active_portfolio_companies,
    ROUND(nav.total_dpi, 4) AS dpi,
    ROUND(nav.total_tvpi, 4) AS tvpi,
    ROUND(nav.total_moic, 4) AS moic
FROM funds f
LEFT JOIN je_balances je ON f.fund_uuid = je.fund_uuid
LEFT JOIN nav_data nav ON f.fund_uuid = nav.fund_uuid
LEFT JOIN annual_activity act ON f.fund_uuid = act.fund_uuid
LEFT JOIN lp_counts lp ON f.fund_uuid = lp.fund_uuid
LEFT JOIN portfolio_summary ps ON f.fund_uuid = ps.fund_uuid

UNION ALL

SELECT
    '5.D. Firm Rollup',
    MAX(f.firm_name),
    'ALL FUNDS',
    ROUND(SUM(je.cost_of_investment + je.unrealized_gl), 2),
    ROUND(SUM(je.cash), 2),
    ROUND(SUM(je.other_assets), 2),
    ROUND(SUM(je.cost_of_investment + je.unrealized_gl + je.cash + je.other_assets), 2),
    ROUND(SUM(je.loc_outstanding), 2),
    ROUND(SUM(nav.unfunded_commitments), 2),
    ROUND(SUM(je.cost_of_investment + je.unrealized_gl + je.cash + je.other_assets + nav.unfunded_commitments), 2),
    ROUND(SUM(nav.ending_total_nav), 2),
    ROUND(SUM(nav.ending_lp_nav), 2),
    ROUND(SUM(nav.ending_gp_nav), 2),
    ROUND(SUM(nav.ending_total_nav + nav.unfunded_commitments), 2),
    ROUND(SUM(nav.cumulative_commitment_amount), 2),
    ROUND(SUM(act.annual_subscriptions), 2),
    ROUND(SUM(act.annual_distributions), 2),
    ROUND(SUM(nav.cumulative_total_distributions), 2),
    SUM(lp.count_lps),
    SUM(lp.count_gps),
    SUM(ps.active_portfolio_companies),
    NULL, NULL, NULL
FROM funds f
LEFT JOIN je_balances je ON f.fund_uuid = je.fund_uuid
LEFT JOIN nav_data nav ON f.fund_uuid = nav.fund_uuid
LEFT JOIN annual_activity act ON f.fund_uuid = act.fund_uuid
LEFT JOIN lp_counts lp ON f.fund_uuid = lp.fund_uuid
LEFT JOIN portfolio_summary ps ON f.fund_uuid = ps.fund_uuid

ORDER BY form_adv_section DESC, fund_name
```

## How to Present

Separate the results into fund detail rows (`form_adv_section = '7.B.(1) Fund Detail'`) and the firm rollup row (`form_adv_section = '5.D. Firm Rollup'`).

### Section 1 — Schedule D §7.B.(1) Fund-Level Detail

| Fund | Type | Fair Market Value | Cash | Other Assets | Total Gross Assets | Unfunded Commitments | Regulatory AUM | NAV | LOC Outstanding |
|---|---|---|---|---|---|---|---|---|---|
| Fund I | Fund | $50,000,000 | $5,000,000 | $1,000,000 | $56,000,000 | $20,000,000 | $76,000,000 | $48,000,000 | $0 |

### Section 2 — Capital Activity & Investor Counts

| Fund | LP Investors | GP Investors | Portfolio Cos | Annual Subscriptions | Annual Distributions | Total Distributions (Inception) | Total Committed | Unfunded |
|---|---|---|---|---|---|---|---|---|

### Section 3 — Performance Metrics (only for funds with NAV data)

| Fund | NAV | LP NAV | GP NAV | Net AUM (Form PF) | DPI | TVPI | MOIC |
|---|---|---|---|---|---|---|---|

### Section 4 — Item 5.D. Firm Rollup

| | Amount |
|---|---|
| Fair Market Value | $X |
| Cash | $X |
| Other Assets | $X |
| Total Gross Assets | $X |
| Unfunded Commitments | $X |
| **Total Regulatory AUM (Form ADV)** | **$X** |
| Net Asset Value | $X |
| Net AUM (Form PF) | $X |

### Formatting

- Format currency as `$X,XXX,XXX` with no decimals
- Format multiples as `X.XXx` (e.g. `1.85x`)
- Use `—` for null values
- End with: *Data as of {reporting_date} · Balance sheet uses effective_date (accounting date) · NAV from monthly calculations*

## Voice Guidelines

- Say "your regulatory AUM" or "your Form ADV data" — not "query results" or "database data"
- Frame errors as "I wasn't able to retrieve that data" — not technical details
- FMV and NAV are different: FMV = investment portfolio only; NAV includes cash and other assets minus liabilities

## Best Effort

- **Computed:** firm rollup totals, presentation formatting
- **Authoritative:** all per-fund data values come directly from the Carta data warehouse
