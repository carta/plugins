---
name: carta-form-adv
description: Fetch Form ADV Part 1A filing data — regulatory AUM, Schedule D §7.B.(1) per-fund detail, beneficial owner breakdown, asset class composition, and annual capital activity. Use when asked about Form ADV, regulatory AUM, Schedule D, Form PF Section 1, SEC filing data, or private fund disclosures.
version: 1.0.0
model: sonnet
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__Claude_Preview__preview_start
  - mcp__Claude_Preview__preview_list
  - mcp__Claude_Preview__preview_eval
  - AskUserQuestion
  - Bash(uv run *)
  - Bash(python3 *)
  - Write
  - Read
---

<!-- Part of the official Carta AI Agent Plugin -->

# Form ADV Part 1A — Comprehensive Filing Data

Fetch data to populate SEC Form ADV Part 1A for investment advisers managing private funds (LP structures, SPVs). Covers Items 5.D, 5.F, 5.H, 7.B, Schedule D §7.B.(1) per-fund detail, and Schedule D §5.K.(1) SMA asset categories — at the level of detail needed for an IARD filing.

---

## When to Use

- "Pull our Form ADV data for 2025"
- "What's our regulatory AUM as of December 2024?"
- "Show me Schedule D §7.B.(1) data for our annual filing"
- "What's our total discretionary AUM and account count?"
- "What percentage of our investors are non-US persons?"
- "What's the beneficial owner breakdown across our funds?"
- "What do I need for Form PF Section 1?"
- "What's our total AUM / investor count across all funds?"
- "Give me the asset class composition of our portfolio"
- "What's our annual subscription and distribution activity?"

---

## Form ADV Coverage

### Data Carta Can Provide

| Form ADV Item | What Is Reported | Source Table(s) |
|---|---|---|
| **Item 5.D** | Client type = Pooled Investment Vehicles; AUM per fund + firm total | JOURNAL_ENTRIES |
| **Item 5.F(1)** | Discretionary regulatory AUM (dollar amount) | JOURNAL_ENTRIES |
| **Item 5.F(2)** | Non-discretionary AUM (typically $0 for pure fund managers) | Computed |
| **Item 5.F(3)** | Total regulatory AUM + number of accounts | JOURNAL_ENTRIES + FUNDS |
| **Item 5.H** | Approximate % of regulatory AUM from non-US clients | PARTNER_DATA |
| **Item 7.B** | Firm advises private funds (YES) | FUNDS |
| **Sched D §7.B.(1)** | Per-fund: legal structure, formation date, entity type, fund type classification | FUNDS |
| **Sched D §7.B.(1)** | Per-fund: gross assets, NAV, unfunded commitments, LOC/borrowings | JOURNAL_ENTRIES + MONTHLY_NAV_CALCULATIONS |
| **Sched D §7.B.(1)** | Per-fund: total # beneficial owners (LP + GP count) | AGGREGATE_FUND_METRICS |
| **Sched D §7.B.(1)** | Per-fund: % beneficial owners who are US vs. non-US persons | PARTNER_DATA |
| **Sched D §7.B.(1)** | Per-fund: beneficial owner type breakdown (individuals vs. entities) | PARTNER_DATA |
| **Sched D §7.B.(1)** | Per-fund: annual subscriptions + annual distributions | MONTHLY_NAV_CALCULATIONS |
| **Sched D §7.B.(1)** | Per-fund: inception-to-date contributions + distributions (LP/GP split) | MONTHLY_NAV_CALCULATIONS |
| **Sched D §7.B.(1)** | Per-fund: total committed capital, LP vs. GP split | MONTHLY_NAV_CALCULATIONS + PARTNER_DATA |
| **Sched D §5.K.(1)** | SMA asset category breakdown (public equity, private equity, pooled vehicles, crypto, options, other) | AGGREGATE_INVESTMENTS |

### Items NOT Available from Carta DW — Must Be Entered Manually in IARD

The following must be completed directly in the IARD filing system. Carta cannot populate these:

**Item 5 (Employees & Services):**
- 5.A: Total number of employees (full-time + part-time)
- 5.B: Employees performing investment advisory functions
- 5.C: Types of compensation arrangements (checkboxes)
- 5.E: % of regulatory AUM using performance-based fees
- 5.G: Types of advisory services provided (checkboxes)
- 5.J: Whether you sponsor wrap fee programs

**Schedule D §7.B.(1) Per-Fund Manual Fields:**
- Legal name of fund (confirm vs. display name; may differ)
- Private Fund Identification Number (from IARD generator)
- Whether adviser is primary adviser for the fund
- Other advisers / sub-advisers (if applicable)
- Fiscal year end month
- Whether fund is currently open to new investors (Y/N)
- Minimum investment amount
- Auditor name, city, country, PCAOB registration number
- Frequency of asset valuation
- Who performs the valuation (internal / third-party administrator)
- Whether custodian is a related person
- Whether fund relies on 3(c)(1) or 3(c)(7) exemption
- Form D file number (021 number from SEC EDGAR)
- Side pocket arrangement (Y/N)
- Gate on investor redemptions (Y/N)
- Fund-of-funds (Y/N) / whether fund invests in other hedge funds

**Items 6–12 (Other Disclosures):**
- Item 6: Other business activities
- Item 7.A: Affiliated advisers and broker-dealers
- Item 8: Participation or interest in client transactions
- Item 9: Custody details (custodian name, address, sweep arrangements)
- Item 10: Control persons
- Item 11: Disclosure information (regulatory/criminal history)
- Schedules A & B: Direct and indirect ownership of the adviser

---

## Prerequisites

- The user must have the Carta MCP server connected
- A `reporting_date` is required (YYYY-MM-DD) — **ask the user if not provided** (use YYYY-12-31 for annual filings)
- If this is the first query, call `list_contexts` then `set_context` to establish the firm context before running any query

---

## Data Retrieval

Run **two queries** using `fetch("dwh:execute:query", {"sql": "..."})`. Execute Query 1 first, then Query 2.

---

### Source Tables

| Table | Purpose |
|---|---|
| `FUND_ADMIN.FUNDS` | Fund metadata: entity type, legal structure, vintage/formation date, investment strategy, fund size, firm |
| `FUND_ADMIN.JOURNAL_ENTRIES` | Balance sheet: cash, cost of investment, unrealized G/L, other assets, borrowings (all account types) |
| `FUND_ADMIN.MONTHLY_NAV_CALCULATIONS` | NAV (LP/GP split), unfunded commitments, cumulative and annual contributions/distributions |
| `FUND_ADMIN.AGGREGATE_FUND_METRICS` | LP and GP investor counts (current snapshot) |
| `FUND_ADMIN.AGGREGATE_INVESTMENTS` | Active portfolio companies, asset class flags (public, private equity, crypto, options, pooled vehicles, other) |
| `FUND_ADMIN.PARTNER_DATA` | Investor demographics: country (US/non-US), entity type, commitment size, NAV per partner |

### Key Fields Mapping

| Output Field | Source | Account Type / Column | Form ADV Use |
|---|---|---|---|
| Cash | JOURNAL_ENTRIES | account_type 1000–1099 | Sched D §7.B.(1): gross assets |
| Cost of Investment | JOURNAL_ENTRIES | account_type 1100 | Sched D §7.B.(1): FMV (cost basis) |
| Unrealized G/L | JOURNAL_ENTRIES | account_type 1101 | Sched D §7.B.(1): FMV (unrealized) |
| Other Assets | JOURNAL_ENTRIES | account_type 1200–1899 | Sched D §7.B.(1): gross assets |
| Total Borrowings | JOURNAL_ENTRIES | account_type 2000–2999 (negated) | Sched D §7.B.(1): borrowings |
| Unfunded Commitments | MONTHLY_NAV_CALCULATIONS | GREATEST(commitment − contributions, 0) | Regulatory AUM addback |
| Regulatory AUM | Computed | Gross Assets + Unfunded Commitments | Item 5.D, 5.F |
| Net Asset Value | MONTHLY_NAV_CALCULATIONS | ending_total_nav | Sched D §7.B.(1): NAV; Form PF |
| # Beneficial Owners | AGGREGATE_FUND_METRICS | count_lps + count_gps | Sched D §7.B.(1) Q.13 |
| % Non-US Persons | PARTNER_DATA | country not in US list | Sched D §7.B.(1) Q.14 |
| Fund Formation Date | FUNDS | vintage_date | Sched D §7.B.(1) Q.6 |
| Legal Structure | FUNDS | legal_structure | Sched D §7.B.(1) organizational form |
| Fund Type | FUNDS | investment_strategy_code | Sched D §7.B.(1) fund type classification |

### Important: Date Field

Use `effective_date` (accounting date) from `JOURNAL_ENTRIES`. The datashare table already filters to posted, non-deleted entries — **do not** add an additional `posted_date <= reporting_date` filter, as it will exclude valid backdated entries and misalign with the Carta balance sheet.

---

### Query 1 — Regulatory AUM, Fund Detail, and Capital Activity

Produces per-fund Schedule D §7.B.(1) rows and a firm-level Item 5.D/5.F rollup.

```sql
WITH
constants AS (
    SELECT LAST_DAY('{reporting_date}'::DATE) AS reporting_date
),

funds AS (
    SELECT
        f.fund_uuid,
        f.fund_name,
        f.entity_type_name,
        f.legal_structure,
        f.vintage_date,
        f.vintage_year,
        f.investment_strategy_code,
        f.fund_size                    AS total_fund_commitment,
        f.fund_family_name,
        f.firm_name,
        f.firm_id,
        c.reporting_date
    FROM FUND_ADMIN.FUNDS f
    CROSS JOIN constants c
    WHERE f.entity_type_name IN ('Fund', 'SPV')
      AND f.is_onboarding = FALSE
),

je_balances AS (
    SELECT
        j.fund_uuid,
        SUM(CASE WHEN j.account_type BETWEEN 1000 AND 1099 THEN j.amount ELSE 0 END)  AS cash,
        SUM(CASE WHEN j.account_type = 1100                THEN j.amount ELSE 0 END)  AS cost_of_investment,
        SUM(CASE WHEN j.account_type = 1101                THEN j.amount ELSE 0 END)  AS unrealized_gl,
        SUM(CASE WHEN j.account_type BETWEEN 1200 AND 1899 THEN j.amount ELSE 0 END)  AS other_assets,
       -SUM(CASE WHEN j.account_type BETWEEN 2000 AND 2999 THEN j.amount ELSE 0 END)  AS total_borrowings
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
        n.cumulative_lp_distributions,
        n.cumulative_gp_distributions,
        GREATEST(n.cumulative_commitment_amount - n.cumulative_total_contributions, 0) AS unfunded_commitments,
        n.total_tvpi,
        n.total_moic,
        n.total_dpi,
        n.lp_tvpi,
        n.lp_dpi,
        n.lp_moic
    FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS n
    INNER JOIN funds f ON n.fund_uuid = f.fund_uuid
    WHERE n.is_firm_rollup = FALSE
      AND n.month_end_date = f.reporting_date
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.fund_uuid ORDER BY n.last_refreshed_at DESC) = 1
),

annual_activity AS (
    SELECT
        n.fund_uuid,
        SUM(n.total_contributions)  AS annual_subscriptions,
        SUM(n.total_distributions)  AS annual_distributions,
        SUM(n.lp_contributions)     AS annual_lp_subscriptions,
        SUM(n.lp_distributions)     AS annual_lp_distributions,
        SUM(n.gp_contributions)     AS annual_gp_subscriptions,
        SUM(n.gp_distributions)     AS annual_gp_distributions
    FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS n
    INNER JOIN funds f ON n.fund_uuid = f.fund_uuid
    WHERE n.is_firm_rollup = FALSE
      AND n.month_end_date BETWEEN DATE_TRUNC('year', f.reporting_date) AND f.reporting_date
    GROUP BY n.fund_uuid
),

-- Point-in-time investor counts: join PARTNER_MONTHLY_NAV_CALCULATIONS (point-in-time membership)
-- to PARTNER_DATA (LP/GP classification). Partners present in the monthly calc at the exact
-- reporting month-end are counted as active at that date.
-- Falls back to AGGREGATE_FUND_METRICS (current snapshot) for funds with no NAV calc that month.
investor_counts_pit AS (
    SELECT
        pmn.fund_uuid,
        COUNT(DISTINCT pmn.partner_id) FILTER (WHERE pd.is_limited_partner) AS count_lps,
        COUNT(DISTINCT pmn.partner_id) FILTER (WHERE pd.is_general_partner) AS count_gps,
        TRUE                                                                 AS is_point_in_time
    FROM FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS pmn
    INNER JOIN funds f  ON pmn.fund_uuid = f.fund_uuid
    LEFT  JOIN FUND_ADMIN.PARTNER_DATA pd
           ON pmn.fund_uuid  = pd.fund_uuid
          AND pmn.partner_id = pd.partner_id
    WHERE pmn.month_end_date = f.reporting_date
    GROUP BY pmn.fund_uuid
),

investor_counts_snapshot AS (
    SELECT
        m.fund_uuid,
        m.count_lps,
        m.count_gps,
        FALSE AS is_point_in_time
    FROM FUND_ADMIN.AGGREGATE_FUND_METRICS m
    INNER JOIN funds f ON m.fund_uuid = f.fund_uuid
    QUALIFY ROW_NUMBER() OVER (PARTITION BY m.fund_uuid ORDER BY m.last_refreshed_at DESC) = 1
),

investor_counts AS (
    SELECT fund_uuid, count_lps, count_gps, is_point_in_time
    FROM investor_counts_pit
    UNION ALL
    -- Only include snapshot row if no point-in-time row exists for that fund
    SELECT s.fund_uuid, s.count_lps, s.count_gps, s.is_point_in_time
    FROM investor_counts_snapshot s
    WHERE NOT EXISTS (SELECT 1 FROM investor_counts_pit p WHERE p.fund_uuid = s.fund_uuid)
),

portfolio_summary AS (
    SELECT
        ai.fund_uuid,
        COUNT(DISTINCT ai.general_ledger_issuer_id)
            FILTER (WHERE ai.is_active_investment)                                              AS active_portfolio_companies,
        -- Asset type composition for Schedule D §5.K.(1) SMA reporting
        SUM(CASE WHEN ai.is_active_investment AND ai.is_public_asset
            THEN ai.remaining_value ELSE 0 END)                                                AS fmv_exchange_traded_equity,
        SUM(CASE WHEN ai.is_active_investment
            AND NOT ai.is_public_asset AND ai.is_ownership_interest_asset
            AND NOT ai.is_investment_in_fund
            THEN ai.remaining_value ELSE 0 END)                                                AS fmv_private_equity,
        SUM(CASE WHEN ai.is_active_investment AND ai.is_investment_in_fund
            THEN ai.remaining_value ELSE 0 END)                                                AS fmv_pooled_investment_vehicles,
        SUM(CASE WHEN ai.is_active_investment AND ai.is_crypto_asset
            THEN ai.remaining_value ELSE 0 END)                                                AS fmv_digital_assets,
        SUM(CASE WHEN ai.is_active_investment AND ai.is_option_or_warrant_asset
            THEN ai.remaining_value ELSE 0 END)                                                AS fmv_options_and_warrants,
        SUM(CASE WHEN ai.is_active_investment AND ai.is_alternative_or_other_asset
            AND NOT ai.is_crypto_asset
            THEN ai.remaining_value ELSE 0 END)                                                AS fmv_other_alternatives,
        SUM(CASE WHEN ai.is_active_investment
            THEN ai.remaining_value ELSE 0 END)                                                AS total_active_fmv
    FROM FUND_ADMIN.AGGREGATE_INVESTMENTS ai
    INNER JOIN funds f ON ai.fund_uuid = f.fund_uuid
    GROUP BY ai.fund_uuid
),

-- Combine per-fund results
fund_detail AS (
    SELECT
        '7.B.(1) Fund Detail'                                                           AS form_adv_section,
        f.fund_name,
        f.entity_type_name                                                              AS entity_type,
        f.legal_structure,
        f.vintage_date                                                                  AS formation_date,
        f.vintage_year,
        f.fund_family_name,
        f.investment_strategy_code,
        CASE
            WHEN f.investment_strategy_code = 'DIRECT_VENTURE' THEN 'Venture Capital Fund'
            WHEN f.investment_strategy_code = 'DIRECT_PE'      THEN 'Private Equity Fund'
            WHEN f.investment_strategy_code = 'REAL_ESTATE'    THEN 'Real Estate Fund'
            WHEN f.investment_strategy_code = 'FUND_OF_FUNDS'  THEN 'Other Private Fund (Fund of Funds)'
            ELSE 'Other Private Fund'
        END                                                                             AS fund_type_classification,
        -- Balance sheet / gross assets
        ROUND(je.cost_of_investment + je.unrealized_gl, 2)                              AS fair_market_value,
        ROUND(je.cash, 2)                                                               AS cash,
        ROUND(je.other_assets, 2)                                                       AS other_assets,
        ROUND(je.cost_of_investment + je.unrealized_gl + je.cash + je.other_assets, 2) AS total_gross_assets,
        ROUND(je.total_borrowings, 2)                                                   AS total_borrowings_outstanding,
        -- Regulatory AUM
        ROUND(nav.unfunded_commitments, 2)                                              AS unfunded_commitments,
        ROUND(
            je.cost_of_investment + je.unrealized_gl + je.cash + je.other_assets
            + nav.unfunded_commitments, 2)                                              AS regulatory_aum,
        -- NAV (Form PF and ADV §7.B.(1))
        ROUND(nav.ending_total_nav, 2)                                                  AS net_asset_value,
        ROUND(nav.ending_lp_nav, 2)                                                     AS lp_nav,
        ROUND(nav.ending_gp_nav, 2)                                                     AS gp_nav,
        ROUND(nav.ending_total_nav + nav.unfunded_commitments, 2)                       AS net_aum_form_pf,
        -- Capital activity — annual (Sched D §7.B.(1))
        ROUND(act.annual_subscriptions, 2)                                              AS annual_subscriptions,
        ROUND(act.annual_distributions, 2)                                              AS annual_distributions,
        ROUND(act.annual_lp_subscriptions, 2)                                           AS annual_lp_subscriptions,
        ROUND(act.annual_lp_distributions, 2)                                           AS annual_lp_distributions,
        ROUND(act.annual_gp_subscriptions, 2)                                           AS annual_gp_subscriptions,
        ROUND(act.annual_gp_distributions, 2)                                           AS annual_gp_distributions,
        -- Capital activity — inception-to-date
        ROUND(nav.cumulative_commitment_amount, 2)                                      AS total_committed_capital,
        ROUND(nav.cumulative_total_contributions, 2)                                    AS contributions_since_inception,
        ROUND(nav.cumulative_lp_contributions, 2)                                       AS lp_contributions_since_inception,
        ROUND(nav.cumulative_gp_contributions, 2)                                       AS gp_contributions_since_inception,
        ROUND(nav.cumulative_total_distributions, 2)                                    AS distributions_since_inception,
        ROUND(nav.cumulative_lp_distributions, 2)                                       AS lp_distributions_since_inception,
        -- Investor counts (Sched D §7.B.(1) Q.13: # beneficial owners)
        -- is_point_in_time = TRUE means count is as of reporting_date; FALSE = current snapshot fallback
        COALESCE(lp.count_lps, 0)                                                       AS beneficial_owners_lp,
        COALESCE(lp.count_gps, 0)                                                       AS beneficial_owners_gp,
        COALESCE(lp.count_lps, 0) + COALESCE(lp.count_gps, 0)                          AS total_beneficial_owners,
        COALESCE(lp.is_point_in_time, FALSE)                                            AS investor_count_is_point_in_time,
        -- Portfolio composition
        COALESCE(ps.active_portfolio_companies, 0)                                      AS active_portfolio_companies,
        ROUND(ps.fmv_exchange_traded_equity, 2)                                         AS fmv_exchange_traded_equity,
        ROUND(ps.fmv_private_equity, 2)                                                 AS fmv_private_equity,
        ROUND(ps.fmv_pooled_investment_vehicles, 2)                                     AS fmv_pooled_investment_vehicles,
        ROUND(ps.fmv_digital_assets, 2)                                                 AS fmv_digital_assets,
        ROUND(ps.fmv_options_and_warrants, 2)                                           AS fmv_options_and_warrants,
        ROUND(ps.fmv_other_alternatives, 2)                                             AS fmv_other_alternatives,
        ROUND(ps.total_active_fmv, 2)                                                   AS total_active_fmv,
        -- Performance
        ROUND(nav.total_dpi, 4)                                                         AS total_dpi,
        ROUND(nav.total_tvpi, 4)                                                        AS total_tvpi,
        ROUND(nav.total_moic, 4)                                                        AS total_moic,
        ROUND(nav.lp_dpi, 4)                                                            AS lp_dpi,
        ROUND(nav.lp_tvpi, 4)                                                           AS lp_tvpi
    FROM funds f
    LEFT JOIN je_balances       je  ON f.fund_uuid = je.fund_uuid
    LEFT JOIN nav_data          nav ON f.fund_uuid = nav.fund_uuid
    LEFT JOIN annual_activity   act ON f.fund_uuid = act.fund_uuid
    LEFT JOIN investor_counts   lp  ON f.fund_uuid = lp.fund_uuid
    LEFT JOIN portfolio_summary ps  ON f.fund_uuid = ps.fund_uuid
),

-- Firm-level rollup for Item 5.D and 5.F
firm_rollup AS (
    SELECT
        '5.D./5.F. Firm Rollup'                                                         AS form_adv_section,
        MAX(f.firm_name)                                                                AS fund_name,
        'ALL FUNDS'                                                                     AS entity_type,
        NULL                                                                            AS legal_structure,
        NULL                                                                            AS formation_date,
        NULL                                                                            AS vintage_year,
        NULL                                                                            AS fund_family_name,
        NULL                                                                            AS investment_strategy_code,
        NULL                                                                            AS fund_type_classification,
        ROUND(SUM(je.cost_of_investment + je.unrealized_gl), 2)                         AS fair_market_value,
        ROUND(SUM(je.cash), 2)                                                          AS cash,
        ROUND(SUM(je.other_assets), 2)                                                  AS other_assets,
        ROUND(SUM(je.cost_of_investment + je.unrealized_gl + je.cash + je.other_assets), 2)  AS total_gross_assets,
        ROUND(SUM(je.total_borrowings), 2)                                              AS total_borrowings_outstanding,
        ROUND(SUM(nav.unfunded_commitments), 2)                                         AS unfunded_commitments,
        -- Item 5.F: Total Regulatory AUM
        ROUND(SUM(je.cost_of_investment + je.unrealized_gl + je.cash + je.other_assets
            + nav.unfunded_commitments), 2)                                             AS regulatory_aum,
        ROUND(SUM(nav.ending_total_nav), 2)                                             AS net_asset_value,
        ROUND(SUM(nav.ending_lp_nav), 2)                                                AS lp_nav,
        ROUND(SUM(nav.ending_gp_nav), 2)                                                AS gp_nav,
        ROUND(SUM(nav.ending_total_nav + nav.unfunded_commitments), 2)                  AS net_aum_form_pf,
        ROUND(SUM(act.annual_subscriptions), 2)                                         AS annual_subscriptions,
        ROUND(SUM(act.annual_distributions), 2)                                         AS annual_distributions,
        ROUND(SUM(act.annual_lp_subscriptions), 2)                                      AS annual_lp_subscriptions,
        ROUND(SUM(act.annual_lp_distributions), 2)                                      AS annual_lp_distributions,
        ROUND(SUM(act.annual_gp_subscriptions), 2)                                      AS annual_gp_subscriptions,
        ROUND(SUM(act.annual_gp_distributions), 2)                                      AS annual_gp_distributions,
        ROUND(SUM(nav.cumulative_commitment_amount), 2)                                 AS total_committed_capital,
        ROUND(SUM(nav.cumulative_total_contributions), 2)                               AS contributions_since_inception,
        ROUND(SUM(nav.cumulative_lp_contributions), 2)                                  AS lp_contributions_since_inception,
        ROUND(SUM(nav.cumulative_gp_contributions), 2)                                  AS gp_contributions_since_inception,
        ROUND(SUM(nav.cumulative_total_distributions), 2)                               AS distributions_since_inception,
        ROUND(SUM(nav.cumulative_lp_distributions), 2)                                  AS lp_distributions_since_inception,
        SUM(COALESCE(lp.count_lps, 0))                                                  AS beneficial_owners_lp,
        SUM(COALESCE(lp.count_gps, 0))                                                  AS beneficial_owners_gp,
        SUM(COALESCE(lp.count_lps, 0) + COALESCE(lp.count_gps, 0))                     AS total_beneficial_owners,
        BOOL_AND(COALESCE(lp.is_point_in_time, FALSE))                                  AS investor_count_is_point_in_time,
        SUM(COALESCE(ps.active_portfolio_companies, 0))                                 AS active_portfolio_companies,
        ROUND(SUM(ps.fmv_exchange_traded_equity), 2)                                    AS fmv_exchange_traded_equity,
        ROUND(SUM(ps.fmv_private_equity), 2)                                            AS fmv_private_equity,
        ROUND(SUM(ps.fmv_pooled_investment_vehicles), 2)                                AS fmv_pooled_investment_vehicles,
        ROUND(SUM(ps.fmv_digital_assets), 2)                                            AS fmv_digital_assets,
        ROUND(SUM(ps.fmv_options_and_warrants), 2)                                      AS fmv_options_and_warrants,
        ROUND(SUM(ps.fmv_other_alternatives), 2)                                        AS fmv_other_alternatives,
        ROUND(SUM(ps.total_active_fmv), 2)                                              AS total_active_fmv,
        NULL                                                                            AS total_dpi,
        NULL                                                                            AS total_tvpi,
        NULL                                                                            AS total_moic,
        NULL                                                                            AS lp_dpi,
        NULL                                                                            AS lp_tvpi
    FROM funds f
    LEFT JOIN je_balances       je  ON f.fund_uuid = je.fund_uuid
    LEFT JOIN nav_data          nav ON f.fund_uuid = nav.fund_uuid
    LEFT JOIN annual_activity   act ON f.fund_uuid = act.fund_uuid
    LEFT JOIN investor_counts   lp  ON f.fund_uuid = lp.fund_uuid
    LEFT JOIN portfolio_summary ps  ON f.fund_uuid = ps.fund_uuid
)

SELECT * FROM fund_detail
UNION ALL
SELECT * FROM firm_rollup
ORDER BY form_adv_section DESC, fund_name
```

---

### Query 2 — Investor Demographics (US / Non-US Breakdown)

Produces per-fund investor counts, US vs. non-US breakdown, and owner type distribution for Schedule D §7.B.(1) Questions 14–16. Run after Query 1.

> **Note:** `partner_country` values are user-entered in Carta; country detection uses common US codes but may miss variants. Always spot-check a sample of partners. Partners with no country on file are counted as "unknown" — confirm data completeness before filing.

```sql
WITH us_country_codes AS (
    SELECT column1 AS country_code
    FROM (VALUES
        ('US'), ('USA'), ('UNITED STATES'), ('UNITED STATES OF AMERICA'),
        ('U.S.'), ('U.S.A.'), ('UNITED STATES OF AMERICA (USA)')
    ) t(country_code)
)
SELECT
    pd.fund_name,
    pd.fund_uuid,

    -- Total active investors
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_limited_partner AND pd.is_active)                           AS lp_investors,
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_general_partner AND pd.is_active)                           AS gp_investors,
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_active)                                                     AS total_active_investors,

    -- US vs. Non-US investor counts (approximation via country field)
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_limited_partner AND pd.is_active
            AND UPPER(TRIM(pd.partner_country)) IN (SELECT country_code FROM us_country_codes)) AS us_lp_investors,
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_limited_partner AND pd.is_active
            AND UPPER(TRIM(pd.partner_country)) NOT IN (SELECT country_code FROM us_country_codes)
            AND pd.partner_country IS NOT NULL)                                         AS non_us_lp_investors,
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_limited_partner AND pd.is_active
            AND pd.partner_country IS NULL)                                             AS lp_investors_no_country_on_file,

    -- US vs. Non-US as percentage of LP count
    ROUND(
        COUNT(DISTINCT pd.partner_id)
            FILTER (WHERE pd.is_limited_partner AND pd.is_active
                AND UPPER(TRIM(pd.partner_country)) NOT IN (SELECT country_code FROM us_country_codes)
                AND pd.partner_country IS NOT NULL)
        * 100.0
        / NULLIF(COUNT(DISTINCT pd.partner_id)
            FILTER (WHERE pd.is_limited_partner AND pd.is_active
                AND pd.partner_country IS NOT NULL), 0),
    1)                                                                                  AS pct_non_us_lp_investors,

    -- NAV by US vs. Non-US (for item 5.H: % of regulatory AUM from non-US clients)
    ROUND(SUM(CASE
        WHEN pd.is_limited_partner AND pd.is_active
            AND UPPER(TRIM(pd.partner_country)) NOT IN (SELECT country_code FROM us_country_codes)
            AND pd.partner_country IS NOT NULL
        THEN pd.total_net_asset_balance ELSE 0 END), 2)                                AS non_us_lp_nav,
    ROUND(SUM(CASE
        WHEN pd.is_limited_partner AND pd.is_active
        THEN pd.total_net_asset_balance ELSE 0 END), 2)                                AS total_lp_nav,
    ROUND(
        SUM(CASE
            WHEN pd.is_limited_partner AND pd.is_active
                AND UPPER(TRIM(pd.partner_country)) NOT IN (SELECT country_code FROM us_country_codes)
                AND pd.partner_country IS NOT NULL
            THEN pd.total_net_asset_balance ELSE 0 END)
        * 100.0
        / NULLIF(SUM(CASE
            WHEN pd.is_limited_partner AND pd.is_active
                AND pd.partner_country IS NOT NULL
            THEN pd.total_net_asset_balance ELSE 0 END), 0),
    1)                                                                                  AS pct_non_us_lp_nav,

    -- Investor entity type breakdown (for Sched D §7.B.(1) owner type %)
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_active
            AND UPPER(pd.partner_entity_type) LIKE '%INDIVIDUAL%')                     AS individual_investors,
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_active
            AND (UPPER(pd.partner_entity_type) LIKE '%TRUST%'
              OR UPPER(pd.partner_entity_type) LIKE '%FOUNDATION%'
              OR UPPER(pd.partner_entity_type) LIKE '%ENDOWMENT%'))                    AS trust_foundation_investors,
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_active
            AND (UPPER(pd.partner_entity_type) LIKE '%LLC%'
              OR UPPER(pd.partner_entity_type) LIKE '%CORP%'
              OR UPPER(pd.partner_entity_type) LIKE '%CORPORATION%'
              OR UPPER(pd.partner_entity_type) LIKE '%INC%'))                          AS corporate_investors,
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_active
            AND (UPPER(pd.partner_entity_type) LIKE '%PENSION%'
              OR UPPER(pd.partner_entity_type) LIKE '%RETIREMENT%'
              OR UPPER(pd.partner_entity_type) LIKE '%401%'
              OR UPPER(pd.partner_entity_type) LIKE '%ERISA%'))                        AS pension_plan_investors,
    COUNT(DISTINCT pd.partner_id)
        FILTER (WHERE pd.is_active
            AND (UPPER(pd.partner_entity_type) LIKE '%FUND%'
              OR UPPER(pd.partner_entity_type) LIKE '%LP%'
              OR UPPER(pd.partner_entity_type) LIKE '%FUND OF FUNDS%'))                AS fund_investors,

    -- Capital commitment totals
    ROUND(SUM(CASE WHEN pd.is_limited_partner AND pd.is_active
        THEN pd.total_capital_commitment_amount_current ELSE 0 END), 2)                AS total_lp_committed,
    ROUND(SUM(CASE WHEN pd.is_general_partner AND pd.is_active
        THEN pd.total_capital_commitment_amount_current ELSE 0 END), 2)                AS total_gp_committed,
    ROUND(SUM(CASE WHEN pd.is_active
        THEN pd.total_capital_commitment_amount_current ELSE 0 END), 2)                AS total_committed_all_partners,

    -- GP commitment as % of total (indicates GP skin in the game)
    ROUND(
        SUM(CASE WHEN pd.is_general_partner AND pd.is_active
            THEN pd.total_capital_commitment_amount_current ELSE 0 END)
        * 100.0
        / NULLIF(SUM(CASE WHEN pd.is_active
            THEN pd.total_capital_commitment_amount_current ELSE 0 END), 0),
    1)                                                                                  AS pct_gp_commitment

FROM FUND_ADMIN.PARTNER_DATA pd
GROUP BY pd.fund_name, pd.fund_uuid
ORDER BY pd.fund_name
```

---

## How to Present

Organize results into **six sections**. The section headers map directly to Form ADV Part 1A items.

---

### Section A — Item 5.F: Regulatory AUM Summary (use the Firm Rollup row)

Present the single-firm rollup as the top-level regulatory AUM disclosure. All fund manager AUM is classified as **discretionary**.

| Item 5.F | Amount | # Accounts |
|---|---|---|
| Discretionary regulatory AUM | `[regulatory_aum]` | `[count of fund rows]` |
| Non-discretionary regulatory AUM | $0 | 0 |
| **Total Regulatory AUM** | **`[regulatory_aum]`** | **`[total funds]`** |

- Client type (Item 5.D): 100% Pooled Investment Vehicles (other than registered investment companies or BDCs)
- Number of clients (Item 5.D): `[total funds]` private funds

---

### Section B — Item 5.H: Non-US Client AUM (use Query 2 results)

Aggregate across all funds:

| | Count | % of LP Investors | Approx. % of LP NAV |
|---|---|---|---|
| US persons | `[us_lp_investors summed]` | X% | X% |
| Non-US persons | `[non_us_lp_investors summed]` | `[pct_non_us_lp_investors]`% | `[pct_non_us_lp_nav]`% |
| Country not on file | `[lp_investors_no_country_on_file summed]` | — | — |

> Tell the user: "The % of regulatory AUM attributable to non-US clients for Item 5.H is approximately **X%** based on LP NAV. You should verify this against subscription agreements if precision is needed for your filing."

---

### Section C — Schedule D §7.B.(1): Per-Fund Detail

One table row per fund (exclude the Firm Rollup row). Present two sub-tables:

**C1 — Balance Sheet & Regulatory AUM**

| Fund | Type | Legal Structure | Formation Date | FMV | Cash | Other Assets | Gross Assets | Borrowings | Unfunded Commitments | **Regulatory AUM** | NAV |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [fund_name] | [fund_type_classification] | [legal_structure] | [formation_date] | $X | $X | $X | $X | $X | $X | **$X** | $X |

**C2 — Beneficial Owners & Capital Activity**

| Fund | # LP Investors | # GP Investors | Total Beneficial Owners | Annual Subscriptions | Annual Distributions | Committed Capital | Contributions (ITD) | Distributions (ITD) |
|---|---|---|---|---|---|---|---|---|
| [fund_name] | X | X | X | $X | $X | $X | $X | $X |

---

### Section D — Schedule D §7.B.(1): Per-Fund Beneficial Owner Demographics (use Query 2)

Per fund, present the owner breakdown needed for Questions 14–16 of §7.B.(1):

| Fund | US LP Investors | Non-US LP Investors | Unknown Country | % Non-US (by count) | % Non-US (by NAV) | Individual Investors | Corporate/LLC | Trust/Foundation | Pension/Retirement | Fund Investors |
|---|---|---|---|---|---|---|---|---|---|---|
| [fund_name] | X | X | X | X% | X% | X | X | X | X | X |

For each fund, compute the owner type percentages:
- **% owned by individuals/HNW** = `individual_investors / total_active_investors * 100`
- **% owned by funds** = `fund_investors / total_active_investors * 100`
- **% owned by pension plans** = `pension_plan_investors / total_active_investors * 100`
- Remaining categories: present as headcount for the user to convert to % using total_beneficial_owners

---

### Section E — Schedule D §5.K.(1): SMA Asset Category Breakdown

> **Note:** Schedule D §5.K relates to separately managed accounts, not private funds. For advisers whose entire AUM is in private funds (no separately managed accounts), this section is N/A — tell the user. If the firm also manages SMAs, use the portfolio data below as a reference for the types of assets held.

From the Firm Rollup row, present asset composition:

| Asset Category (Form ADV §5.K.(1)) | FMV | % of Total Active FMV |
|---|---|---|
| Exchange-Traded Equity (U.S. and non-U.S.) | `[fmv_exchange_traded_equity]` | X% |
| Private Equity (non-public ownership interests) | `[fmv_private_equity]` | X% |
| Securities issued by other pooled investment vehicles | `[fmv_pooled_investment_vehicles]` | X% |
| Options and warrants | `[fmv_options_and_warrants]` | X% |
| Digital assets / cryptocurrency | `[fmv_digital_assets]` | X% |
| Other alternatives | `[fmv_other_alternatives]` | X% |
| **Total Active Investment FMV** | **`[total_active_fmv]`** | **100%** |

---

### Section F — Item 5.F / NAV: Performance & Form PF Reference

| Fund | NAV | LP NAV | GP NAV | Net AUM (Form PF) | DPI | TVPI | LP TVPI |
|---|---|---|---|---|---|---|---|

---

## Interactive Filing Guide

<!-- Design note: output format evolution
     v1: PDF (reportlab) + Excel (openpyxl) generators. Both required runtime `pip install`
     fallbacks that silently fail on Windows (sys.executable points to a uv-managed shim
     without a writable pip environment) and required users to navigate to a /tmp file path.

     v2 (current): HTML artifact as the primary output — zero Python dependencies, opens
     automatically in Claude Desktop's preview panel, works identically on macOS and Windows.
     Blue/orange badge system (Carta-filled vs. must-enter-in-IARD) is interactive in HTML.

     Excel is back (v2.1): form_adv_excel_generator.py uses PEP 723 inline metadata so
     `uv run` resolves openpyxl automatically — no pip fallback needed. Generated alongside
     the HTML artifact for users who prefer a spreadsheet they can annotate offline.
-->

After presenting the markdown output, automatically generate an interactive Form ADV filing guide as a self-contained HTML artifact.
Tell the user: *"Building your Form ADV interactive filing guide..."*

### Step 1 — Build the data file

Extract values from Query 1 and Query 2. Use the `Write` tool to create `{TMPDIR}/form_adv_data.json` where `TMPDIR` is the system temp directory (`/tmp` on macOS/Linux, `%TEMP%` on Windows — resolve with `python3 -c "import tempfile; print(tempfile.gettempdir())"`):

```json
{
  "firm_name": "<firm display name>",
  "reporting_date": "<YYYY-MM-DD>",
  "firm_rollup": {
    "<all columns from the firm rollup row where form_adv_section = '5.D./5.F. Firm Rollup'>"
  },
  "funds": [
    { "<all columns from each fund detail row where form_adv_section = '7.B.(1) Fund Detail'>" }
  ],
  "investor_demographics": {
    "<fund_uuid>": { "<all columns from Query 2 for that fund>" }
  }
}
```

Use actual query result values — no placeholders.

### Step 2 — Generate the artifact

```bash
TMPDIR=$(python3 -c "import tempfile; print(tempfile.gettempdir())")
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/generate_form_adv_artifact.py \
  --data "${TMPDIR}/form_adv_data.json" \
  --title "<FirmName> — Form ADV <Year>" \
  --out "${TMPDIR}/FormADV_<FirmName>_<Year>.html"
```

### Step 3 — Generate Excel filing reference

Run immediately after Step 2 (reuses the same JSON data file):

```bash
TMPDIR=$(python3 -c "import tempfile; print(tempfile.gettempdir())")
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/form_adv_excel_generator.py \
  --data "${TMPDIR}/form_adv_data.json" \
  --title "<FirmName> — Form ADV <Year>" \
  --out "${TMPDIR}/FormADV_<FirmName>_<Year>.xlsx"
```

Tell the user the file path:
> *"Your Form ADV Excel filing reference has been saved to `{TMPDIR}/FormADV_<FirmName>_<Year>.xlsx`. Open it in Excel or Google Sheets. Blue cells are pre-filled from Carta — orange cells must be entered manually in IARD. The **Manual Fields** sheet lists every field requiring manual entry, organized by ADV item."*

### Step 4 — Open in preview panel (Claude Desktop)

1. **Read** `.claude/launch.json` if it exists (parse it, keep existing configs). If absent, start with `{"version":"0.0.1","configurations":[]}`.

2. **Upsert** this configuration (add or replace any entry whose `name` starts with `carta-form-adv-`):

```json
{
  "name": "carta-form-adv-<firm_slug>",
  "runtimeExecutable": "uv",
  "runtimeArgs": [
    "run", "python",
    "${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/preview_server.py"
  ],
  "autoPort": true
}
```

3. **Write** the merged config back to `.claude/launch.json`.

4. Call `preview_start` — Claude Desktop spawns the server and opens the panel.

5. Call `preview_list` — find the entry whose name matches `carta-form-adv-<firm_slug>`. Extract `port` and `serverId`.

6. Call `preview_eval` with `serverId` and:
```javascript
window.location.href = 'http://localhost:<port>/FormADV_<FirmName>_<Year>.html';
```

Tell the user:

> *"Your Form ADV interactive filing guide is open in the preview panel. It has three tabs: Firm Overview (Items 5.D, 5.F, 5.H), Per-Fund Detail (Schedule D §7.B.(1) for each fund, expandable), and an IARD Checklist. Blue badges are pre-filled from Carta — orange badges need to be entered manually in IARD. Use **Print / Save PDF** in the top right to export a PDF copy for your records."*

**Fallback (non-Desktop):** If `preview_start` is unavailable, tell the user the file path to open in their browser:
> *"Your filing guide has been saved to `{TMPDIR}/FormADV_<FirmName>_<Year>.html`. Open this file in your browser to view it. Use File → Print → Save as PDF to export."*


---

## Formatting Rules

- Currency: `$X,XXX,XXX` with no decimal places (e.g., `$48,250,000`)
- Percentages: `X.X%` (one decimal)
- Multiples: `X.XXx` (e.g., `1.85x`)
- Dates: `YYYY-MM-DD`
- Use `—` for null values
- For each fund, note whether `investor_count_is_point_in_time` is TRUE or FALSE. If TRUE, say "as of {reporting_date}". If FALSE, say "current snapshot (NAV not calculated for {reporting_date} — verify against subscription register)".
- Show `investment_strategy_code` alongside `fund_type_classification` so users can see exactly what Carta has on file.
- End every response with: *Data as of {reporting_date} · Balance sheet uses effective_date (accounting date) · Verify legal names, fiscal year ends, and IARD fund IDs before filing*

---

## Data Caveats — Communicate These to the User

1. **Investor counts** — when `investor_count_is_point_in_time = TRUE`, counts are as of the exact reporting date (from `PARTNER_MONTHLY_NAV_CALCULATIONS`). When FALSE, the NAV calculation for that month hasn't been run and counts are a current snapshot from `AGGREGATE_FUND_METRICS` — tell the user to verify against their subscription register for those funds only.

2. **Non-US determination is approximate.** It is based on the `partner_country` field in Carta, which relies on data entry. Partners with no country on file are excluded from the US/non-US calculation. Confirm completeness before using for Item 5.H.

3. **Fund type classification** — show both `investment_strategy_code` (what Carta has on file) and `fund_type_classification` (the mapped SEC label). The final SEC classification is a legal determination that must be confirmed against fund documents — a fund labeled `DIRECT_VENTURE` in Carta may not qualify for the VC exemption under the Advisers Act.

4. **Formation date is the GL-based vintage date**, calculated from first journal entry activity. Verify against your fund's actual formation documents (certificate of formation, LP agreement).

5. **NAV data requires a calculation to exist** for the exact reporting date month-end. If a fund's NAV has not been calculated for that date, those fields will show null (`—`). This is not an error — the fund's NAV simply hasn't been run yet.

6. **Regulatory AUM uses the balance sheet method** (gross assets + unfunded commitments). This follows the SEC's instructions for private fund advisers. It is not the same as NAV, which is the preferred method for Form PF Net AUM.

7. **Borrowings cover all account types 2000–2999**, which is broader than the prior skill's 2000–2001 range. This provides a more complete picture of fund liabilities for gross asset disclosure.

8. **Legal names of funds** may differ from the display names in Carta. Always verify the exact legal entity name against the fund's certificate of formation before entering in IARD.

---

## Voice Guidelines

- Say "your regulatory AUM" or "Form ADV data" — not "query results" or "database output"
- Frame data gaps as "I wasn't able to retrieve that for [fund name]" — not technical details
- FMV ≠ NAV: explain proactively: "FMV reflects only the investment portfolio (cost + unrealized G/L). NAV is broader and includes cash, other assets, and liabilities."
- Regulatory AUM ≠ NAV: "For Form ADV, regulatory AUM adds unfunded commitments to gross assets — it will always exceed NAV."
- Always remind users that the manual fields listed above must be completed directly in IARD before submitting

---

## Best Effort

- **Computed from Carta data:** all financial figures, investor counts, ownership percentages, annual activity, asset class composition
- **Authoritative sources:** all per-fund data values come directly from the Carta fund administration data warehouse
- **Not available from Carta:** employee counts, compensation arrangements, legal/regulatory history, affiliated person details, auditor information, custody arrangements, ownership of the adviser (Schedules A/B)
