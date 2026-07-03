-- Line-grain memos for NULL-vendor P&L postings, for optional memo-based
-- vendor inference (SKILL.md Gate 5.5). ONLY run this when the user has
-- explicitly opted into inference — never as part of the default flow.
--
-- The standard vendor queries (actuals-by-vendor-period.sql,
-- actuals-by-account-vendor-period.sql) aggregate memos away. This query
-- pulls the memo text back for the 'No vendor' bucket so the memo can be
-- read to infer a likely vendor.
--
-- Substitutions (never hardcode):
--   <journal_entries_table>  — resolved via dwh:list:tables at Gate 0
--   <memo_column>            — the memo/description column on the journal-
--                              entries table. Resolve the exact name via the
--                              DWH schema lookup at Gate 0 (candidates:
--                              MEMO, DESCRIPTION, LINE_MEMO, NARRATIVE).
--                              If no memo-like column exists, Gate 5.5 tells
--                              the user in one sentence and skips inference.
--   <entity_name>            — exact FUND_NAME value from Gate 3
--   <period_trunc>           — YEAR | QUARTER | MONTH per Gate 3a aggregation
--   <period_start>           — first day of the selected period (YYYY-MM-DD)
--   <period_end>             — last day of the selected period (YYYY-MM-DD)
--
-- Hard rules (same as actuals-by-account-vendor-period.sql):
--   - FUND_NAME = exact match, never FIRM_NAME ILIKE
--   - EFFECTIVE_DATE (books date), not POSTED_DATE
--   - Revenue (4xxx) sign-flipped via CASE; expenses kept as-is
--   - ACCOUNT_TYPE >= '4000' restricts to P&L; balance sheet excluded
--   - Reversals preserved as negative postings
--   - VENDOR_NAME IS NULL — this query targets ONLY the untagged bucket

SELECT
    <memo_column>                                                  AS memo,
    ACCOUNT_TYPE                                                   AS gl_code,
    ACCOUNT_NAME                                                   AS account_name,
    DATE_TRUNC('<period_trunc>', EFFECTIVE_DATE)                   AS period,
    SUM(CASE WHEN LEFT(ACCOUNT_TYPE, 1) = '4' THEN -AMOUNT
             ELSE AMOUNT END)                                      AS signed_amount
FROM <journal_entries_table>
WHERE FUND_NAME = '<entity_name>'
  AND VENDOR_NAME IS NULL
  AND ACCOUNT_TYPE >= '4000'
  AND EFFECTIVE_DATE BETWEEN '<period_start>' AND '<period_end>'
GROUP BY 1, 2, 3, 4
ORDER BY account_name, memo, period;
