export const STEMS = {
  funds: `SELECT DISTINCT fund_uuid, fund_name, entity_type_name
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE is_firm_rollup = FALSE
  AND entity_type_name NOT ILIKE '%SPV%'
ORDER BY entity_type_name, fund_name, fund_uuid`,

  financials: `SELECT legal_name, name, mnemonic, report_type, unit_type, currency,
       float_value, string_value, period_end, period_start, frequency, as_of_date,
       instance_id
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE instance_type = 'Actual'
  AND (float_value IS NOT NULL OR (string_value IS NOT NULL AND string_value <> ''))
  AND as_of_date <= CURRENT_DATE
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY legal_name, COALESCE(mnemonic, name),
                 COALESCE(frequency, ''), period_end
    ORDER BY as_of_date DESC NULLS LAST, instance_id DESC) = 1
ORDER BY legal_name, COALESCE(mnemonic, name), COALESCE(frequency, ''), period_end`,

  forecasts: `SELECT legal_name, name, mnemonic, unit_type, currency,
       as_of_date, period_end, float_value, is_latest, instance_id
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE instance_type = 'Estimate' AND float_value IS NOT NULL
ORDER BY legal_name, name, mnemonic, period_end, as_of_date,
         unit_type, currency, float_value, is_latest, instance_id`,

  holdings: `SELECT issuer_name, fund_uuid, asset_name, asset_class_type, count_remaining_shares,
       remaining_value, remaining_value_per_share, latest_fmv_effective_date,
       total_cost, total_proceeds, total_unrealized_gain_loss, investment_date, tags_json,
       is_active_investment, is_option_or_warrant_asset, is_public_asset,
       fund_investment_key
FROM FUND_ADMIN.AGGREGATE_INVESTMENTS
WHERE fund_uuid IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
ORDER BY issuer_name, fund_uuid, asset_name, asset_class_type, fund_investment_key`,

  holdings_history: `SELECT issuer_name, fund_uuid, asset_name, asset_class_type, effective_date,
       next_effective_date, is_current_state,
       count_remaining_shares, remaining_value, remaining_value_per_share,
       total_cost, total_unrealized_gain_loss, total_proceeds,
       is_option_or_warrant_asset, _pk
FROM FUND_ADMIN.AGGREGATE_INVESTMENTS_HISTORY
WHERE fund_uuid IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
ORDER BY issuer_name, fund_uuid, asset_name, asset_class_type,
         effective_date, next_effective_date, _pk`,

  deal_irr: `SELECT issuer_name, fund_uuid, deal_irr, performance_quarter_end_date
FROM FUND_ADMIN.TEMPORAL_DEAL_IRR
WHERE fund_uuid IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
QUALIFY ROW_NUMBER() OVER (PARTITION BY issuer_name, fund_uuid
                           ORDER BY performance_quarter_end_date DESC, deal_irr DESC)=1
ORDER BY issuer_name, fund_uuid`,

  fdshares: `WITH own AS (
  SELECT CORPORATION_ID, FUND_ID, AS_OF_DATE, FULLY_DILUTED, OWNERSHIP_QUANTITY,
         TRY_TO_NUMBER(PERCENTAGE, 38, 18) AS own_pct
  FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP
  WHERE FUND_ID IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
    AND FULLY_DILUTED > 1000 AND IS_PRO_FORMA = FALSE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_ID, FUND_ID ORDER BY AS_OF_DATE DESC)=1
),
fin AS (
  SELECT corporation_id, investment_name, round, post_money_valuation,
         COALESCE(closing_date, raised_date) AS round_date
  FROM FUND_ADMIN.FINANCING_HISTORY
  QUALIFY ROW_NUMBER() OVER (PARTITION BY corporation_id ORDER BY COALESCE(closing_date, raised_date) DESC NULLS LAST)=1
)
SELECT o.CORPORATION_ID AS corporation_id, f.investment_name AS name,
       o.FUND_ID AS fund_id, o.own_pct, o.OWNERSHIP_QUANTITY AS own_qty,
       o.FULLY_DILUTED AS fd_shares, o.AS_OF_DATE AS as_of,
       f.round, f.post_money_valuation AS post_money, f.round_date
FROM own o
JOIN fin f ON o.CORPORATION_ID = f.corporation_id
WHERE f.investment_name IS NOT NULL
ORDER BY corporation_id, fund_id`,

  capstack: `WITH corp AS (
  SELECT corporation_uuid, corporation_name
  FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2
  WHERE corporation_uuid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY corporation_uuid ORDER BY last_refreshed_at DESC) = 1
)
SELECT s.legal_name, COALESCE(c.corporation_name, s.legal_name) AS corp_name,
       s.corporation_id, s.security_class_id, s.security_class_name,
       s.security_class_type, s.security_class_type_detailed, s.as_converted_shareclass_name,
       s.outstanding_shares, s.fully_diluted_quantity, s.authorized_shares,
       s.fully_diluted_ownership, s.plan_size, s.shares_available_under_plan,
       s.weighted_average_exercise_price, s.original_issue_price, s.conversion_ratio,
       s.conversion_price, s.seniority, s.multiplier, s.participating_preferred,
       s.preference_cap, s.dividend_coupon, s.dividend_type, s.dividend_accrual,
       s.is_compounding, s.earliest_issue_date, s.as_of_date,
       s.cash_raised:USD::NUMBER AS cash_raised_usd,
       s.principal:USD::NUMBER   AS principal_usd,
       s.interest:USD::NUMBER    AS interest_usd
FROM FUND_ADMIN.SUMMARY_CAP_TABLE s
LEFT JOIN corp c ON c.corporation_uuid = s.corporation_id
QUALIFY ROW_NUMBER() OVER (PARTITION BY s.corporation_id, s.security_class_id
                           ORDER BY s.as_of_date DESC) = 1
ORDER BY corporation_id, security_class_id`,
};

export const DATASETS = [
  { key: "kpis", label: "Operating KPIs", stems: ["financials"] },
  { key: "forecasts", label: "Forecasts", stems: ["forecasts"] },
  { key: "holdings", label: "Holdings & returns", stems: ["holdings", "holdings_history", "deal_irr"] },
  { key: "ownership", label: "Ownership & cap tables", stems: ["fdshares", "capstack", "funds"] },
];
