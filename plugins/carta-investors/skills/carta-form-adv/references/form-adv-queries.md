# Form ADV — Source Tables, Field Mappings & SQL Queries

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

Produces per-fund Schedule D §7.B.(1) rows. Substitute `{reporting_date}` with the user's reporting date (YYYY-MM-DD) before executing.

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
        pmn.fund_id AS fund_uuid,
        COUNT(DISTINCT CASE WHEN pd.is_limited_partner THEN pmn.partner_id END) AS count_lps,
        COUNT(DISTINCT CASE WHEN pd.is_general_partner THEN pmn.partner_id END) AS count_gps,
        TRUE                                                                 AS is_point_in_time
    FROM FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS pmn
    INNER JOIN funds f  ON pmn.fund_id = f.fund_uuid
    LEFT  JOIN FUND_ADMIN.PARTNER_DATA pd
           ON pmn.fund_id    = pd.fund_uuid
          AND pmn.partner_id = pd.partner_id
    WHERE pmn.month_end_date = f.reporting_date
    GROUP BY pmn.fund_id
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
        COUNT(DISTINCT CASE WHEN ai.is_active_investment THEN ai.general_ledger_issuer_id END) AS active_portfolio_companies,
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
)

SELECT * FROM fund_detail
ORDER BY fund_name
```

---

### Query 2 — Investor Demographics (US / Non-US Breakdown)

Produces per-fund investor counts, US vs. non-US breakdown, and owner type distribution for Schedule D §7.B.(1) Questions 14–16. Run after Query 1.

> **Note:** `partner_country` values are user-entered in Carta; country detection uses common US codes but may miss variants. Always spot-check a sample of partners. Partners with no country on file are counted as "unknown" — confirm data completeness before filing.

```sql
SELECT
    pd.fund_name,
    pd.fund_uuid,

    -- Total active investors
    COUNT(DISTINCT CASE WHEN pd.is_limited_partner AND pd.is_active
        THEN pd.partner_id END)                                                         AS lp_investors,
    COUNT(DISTINCT CASE WHEN pd.is_general_partner AND pd.is_active
        THEN pd.partner_id END)                                                         AS gp_investors,
    COUNT(DISTINCT CASE WHEN pd.is_active
        THEN pd.partner_id END)                                                         AS total_active_investors,

    -- US vs. Non-US investor counts (approximation via country field)
    COUNT(DISTINCT CASE WHEN pd.is_limited_partner AND pd.is_active
        AND UPPER(TRIM(pd.partner_country)) IN (
            'US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA',
            'U.S.', 'U.S.A.', 'UNITED STATES OF AMERICA (USA)')
        THEN pd.partner_id END)                                                         AS us_lp_investors,
    COUNT(DISTINCT CASE WHEN pd.is_limited_partner AND pd.is_active
        AND UPPER(TRIM(pd.partner_country)) NOT IN (
            'US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA',
            'U.S.', 'U.S.A.', 'UNITED STATES OF AMERICA (USA)')
        AND pd.partner_country IS NOT NULL
        THEN pd.partner_id END)                                                         AS non_us_lp_investors,
    COUNT(DISTINCT CASE WHEN pd.is_limited_partner AND pd.is_active
        AND pd.partner_country IS NULL
        THEN pd.partner_id END)                                                         AS lp_investors_no_country_on_file,

    -- US vs. Non-US as percentage of LP count
    ROUND(
        COUNT(DISTINCT CASE WHEN pd.is_limited_partner AND pd.is_active
            AND UPPER(TRIM(pd.partner_country)) NOT IN (
                'US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA',
                'U.S.', 'U.S.A.', 'UNITED STATES OF AMERICA (USA)')
            AND pd.partner_country IS NOT NULL
            THEN pd.partner_id END)
        * 100.0
        / NULLIF(COUNT(DISTINCT CASE WHEN pd.is_limited_partner AND pd.is_active
            AND pd.partner_country IS NOT NULL
            THEN pd.partner_id END), 0),
    1)                                                                                  AS pct_non_us_lp_investors,

    -- NAV by US vs. Non-US (for item 5.H: % of regulatory AUM from non-US clients)
    ROUND(SUM(CASE
        WHEN pd.is_limited_partner AND pd.is_active
            AND UPPER(TRIM(pd.partner_country)) NOT IN (
                'US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA',
                'U.S.', 'U.S.A.', 'UNITED STATES OF AMERICA (USA)')
            AND pd.partner_country IS NOT NULL
        THEN pd.total_net_asset_balance ELSE 0 END), 2)                                AS non_us_lp_nav,
    ROUND(SUM(CASE
        WHEN pd.is_limited_partner AND pd.is_active
        THEN pd.total_net_asset_balance ELSE 0 END), 2)                                AS total_lp_nav,
    ROUND(
        SUM(CASE
            WHEN pd.is_limited_partner AND pd.is_active
                AND UPPER(TRIM(pd.partner_country)) NOT IN (
                    'US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA',
                    'U.S.', 'U.S.A.', 'UNITED STATES OF AMERICA (USA)')
                AND pd.partner_country IS NOT NULL
            THEN pd.total_net_asset_balance ELSE 0 END)
        * 100.0
        / NULLIF(SUM(CASE
            WHEN pd.is_limited_partner AND pd.is_active
                AND pd.partner_country IS NOT NULL
            THEN pd.total_net_asset_balance ELSE 0 END), 0),
    1)                                                                                  AS pct_non_us_lp_nav,

    -- Investor entity type breakdown (for Sched D §7.B.(1) owner type %)
    COUNT(DISTINCT CASE WHEN pd.is_active
        AND UPPER(pd.partner_entity_type) LIKE '%INDIVIDUAL%'
        THEN pd.partner_id END)                                                         AS individual_investors,
    COUNT(DISTINCT CASE WHEN pd.is_active
        AND (UPPER(pd.partner_entity_type) LIKE '%TRUST%'
          OR UPPER(pd.partner_entity_type) LIKE '%FOUNDATION%'
          OR UPPER(pd.partner_entity_type) LIKE '%ENDOWMENT%')
        THEN pd.partner_id END)                                                         AS trust_foundation_investors,
    COUNT(DISTINCT CASE WHEN pd.is_active
        AND (UPPER(pd.partner_entity_type) LIKE '%LLC%'
          OR UPPER(pd.partner_entity_type) LIKE '%CORP%'
          OR UPPER(pd.partner_entity_type) LIKE '%CORPORATION%'
          OR UPPER(pd.partner_entity_type) LIKE '%INC%')
        THEN pd.partner_id END)                                                         AS corporate_investors,
    COUNT(DISTINCT CASE WHEN pd.is_active
        AND (UPPER(pd.partner_entity_type) LIKE '%PENSION%'
          OR UPPER(pd.partner_entity_type) LIKE '%RETIREMENT%'
          OR UPPER(pd.partner_entity_type) LIKE '%401%'
          OR UPPER(pd.partner_entity_type) LIKE '%ERISA%')
        THEN pd.partner_id END)                                                         AS pension_plan_investors,
    COUNT(DISTINCT CASE WHEN pd.is_active
        AND (UPPER(pd.partner_entity_type) LIKE '%FUND%'
          OR UPPER(pd.partner_entity_type) LIKE '%LP%'
          OR UPPER(pd.partner_entity_type) LIKE '%FUND OF FUNDS%')
        THEN pd.partner_id END)                                                         AS fund_investors,

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
