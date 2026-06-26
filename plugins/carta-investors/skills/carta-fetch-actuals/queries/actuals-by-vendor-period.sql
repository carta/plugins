-- Actuals aggregated by vendor and period only (no GL code breakdown).
-- Used by:
--   • carta-budget-actuals Layout H (vendor-only tab)
--
-- Substitutions (never hardcode):
--   <journal_entries_table>  — resolved via dwh:list:tables at Gate 0
--   <entity_name>            — exact FUND_NAME value from Gate 3
--   <period_trunc>           — YEAR | QUARTER | MONTH per Gate 3a aggregation choice
--   <period_start>           — first day of the selected period (YYYY-MM-DD)
--   <period_end>             — last day of the selected period (YYYY-MM-DD)
--
-- Hard rules (same as actuals-by-account-vendor-period.sql):
--   - FUND_NAME = exact match, never FIRM_NAME ILIKE
--   - EFFECTIVE_DATE (books date), not POSTED_DATE
--   - Revenue (4xxx) sign-flipped via CASE; expenses kept as-is
--   - ACCOUNT_TYPE >= '4000' restricts to P&L; balance sheet excluded
--   - Reversals preserved as negative postings
--   - COALESCE(VENDOR_NAME, 'No vendor') — NULL vendors roll into the
--     No vendor section; do NOT run a separate query for untagged rows

SELECT
    COALESCE(VENDOR_NAME, 'No vendor')                               AS vendor_name,
    DATE_TRUNC('<period_trunc>', EFFECTIVE_DATE)                    AS period,
    SUM(CASE WHEN LEFT(ACCOUNT_TYPE, 1) = '4' THEN -AMOUNT
             ELSE AMOUNT END)                                       AS signed_amount
FROM <journal_entries_table>
WHERE FUND_NAME = '<entity_name>'
  AND ACCOUNT_TYPE >= '4000'
  AND EFFECTIVE_DATE BETWEEN '<period_start>' AND '<period_end>'
GROUP BY 1, 2
ORDER BY
    -- Named vendors first (alphabetically), No vendor last
    CASE WHEN VENDOR_NAME IS NULL THEN 1 ELSE 0 END,
    vendor_name,
    period;
