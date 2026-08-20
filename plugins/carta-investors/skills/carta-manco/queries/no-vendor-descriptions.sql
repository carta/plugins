-- Entry descriptions for NULL-vendor P&L postings, for optional
-- description-based vendor inference (Gate 5.5 in references/fetch-actuals.md).
-- ONLY run this when the user has explicitly opted into inference — never as
-- part of the default flow.
--
-- The standard vendor queries (actuals-by-vendor-period.sql,
-- actuals-by-account-vendor-period.sql) aggregate the description away. This
-- query pulls it back for the 'No vendor' bucket so it can be read to infer a
-- likely vendor.
--
-- A user may well call this the memo. In Carta that word names other records —
-- a bank transaction's memo, a payment obligation's memo — so answer in the
-- product's own vocabulary: journal entries carry a description, and
-- JOURNAL_ENTRY_DESCRIPTION is it. The value comes off the journal header, so
-- every line of one journal repeats it.
--
-- Substitutions (never hardcode):
--   <journal_entries_table>  — resolved via dwh:list:tables at Gate 0
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
--   - JOURNAL_ENTRY_DESCRIPTION is the entry's own text. ACCOUNT_DESCRIPTION
--     describes the GL account and reads the same on every entry that ever
--     hit it, so inferring a vendor from it names the wrong party on all of
--     them at once. Never substitute one for the other.

SELECT
    JOURNAL_ENTRY_DESCRIPTION                                      AS description,
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
ORDER BY account_name, description, period;
