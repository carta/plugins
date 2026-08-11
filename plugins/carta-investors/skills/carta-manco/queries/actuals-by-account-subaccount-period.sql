-- Chart-of-accounts drill-down: every GL account with activity in the window,
-- broken into its sub-accounts (plus a "No Sub-Account" row for the untagged
-- portion), aggregated by period.
-- Used by: carta-manco fetch-actuals Layout I (sub-account-view tab) —
-- <period_trunc> from Gate 3a.
--
-- Substitutions (never hardcode):
--   <journal_entries_table>  — resolved via dwh:list:tables at Gate 0
--   <entity_name>            — exact FUND_NAME value from Gate 3
--   <period_trunc>           — YEAR | QUARTER | MONTH per Gate 3a aggregation choice
--   <period_start> / <period_end> — selected period bounds (YYYY-MM-DD)
--
-- Deliberate divergence from the other actuals-by-account-*.sql files in this
-- directory: NO `ACCOUNT_TYPE >= '4000'` filter. Every other layout in this
-- skill is P&L-only because you budget income/expenses, not capital calls.
-- But live testing on real fund data
-- showed sub-account tagging is used almost entirely on accounts BELOW 4000
-- (contributed capital, management-fee-credit offsets against capital) — a
-- P&L-only filter here would hide nearly all real sub-account activity. This
-- query intentionally covers the full chart of accounts.
--
-- Hard rules that DO still apply (same as actuals-by-account-month.sql):
--   - FUND_NAME = exact match, never FIRM_NAME ILIKE
--   - EFFECTIVE_DATE (books date), not POSTED_DATE
--   - Revenue (4xxx) sign-flipped via CASE; every other section keeps the
--     ledger's raw sign (capital/liability accounts have their own natural
--     credit/debit convention — don't invent a second flip for them)
--   - Reversals preserved as negative postings
--   - COALESCE(SUB_ACCOUNT_NAME, 'No Sub-Account') — an account with zero
--     sub-account-tagged lines produces exactly one 'No Sub-Account' row
--     (equal to that account's full total); an account with some tagged
--     activity produces a 'No Sub-Account' row for the untagged remainder
--     PLUS one row per distinct named sub-account. Do NOT run a separate
--     query for untagged rows.
--
-- SUB_ACCOUNT_TYPE is NOT a category/dimension column (unlike REPORTING_TAGS)
-- — live schema inspection confirmed it's actually the formatted sub-account
-- number (e.g. "7070.001"), one value per SUB_ACCOUNT_NAME. Selected below
-- (as sub_account_code, via MAX() rather than a GROUP BY column — it's a
-- lookup value, constant per name, but MAX() is cheap insurance against a
-- data-quality edge case producing a NULL alongside a real code for the same
-- name) so sub-account-view.md can render it in the row label without a
-- second query.
--
-- Section mapping (leading GL digit) — extends the budget-only mapping in
-- from-prior-actuals.md (which never needs a capital bucket) to the full COA:
--   1xxx           -> Assets / Investments
--   2xxx           -> Liabilities
--   3xxx           -> Partners' Capital
--   4xxx           -> Income
--   5xxx/6xxx/7xxx -> Expenses
-- Computed here so the skill doesn't have to re-derive it in JS/Python from a
-- raw GL code; sort order below matches the family-band order this maps to.

WITH agg AS (
    SELECT
        ACCOUNT_TYPE                                                      AS gl_code,
        ACCOUNT_NAME                                                      AS account_name,
        COALESCE(SUB_ACCOUNT_NAME, 'No Sub-Account')                      AS sub_account_name,
        MAX(SUB_ACCOUNT_TYPE)                                             AS sub_account_code,
        DATE_TRUNC('<period_trunc>', EFFECTIVE_DATE)                      AS period,
        SUM(CASE WHEN LEFT(ACCOUNT_TYPE, 1) = '4' THEN -AMOUNT
                 ELSE AMOUNT END)                                         AS signed_amount
    FROM <journal_entries_table>
    WHERE FUND_NAME = '<entity_name>'
      AND EFFECTIVE_DATE BETWEEN '<period_start>' AND '<period_end>'
    GROUP BY 1, 2, 3, 5
)
SELECT
    CASE
        WHEN TRY_TO_NUMBER(gl_code) >= 1000 AND TRY_TO_NUMBER(gl_code) < 2000 THEN 'Assets / Investments'
        WHEN TRY_TO_NUMBER(gl_code) >= 2000 AND TRY_TO_NUMBER(gl_code) < 3000 THEN 'Liabilities'
        WHEN TRY_TO_NUMBER(gl_code) >= 3000 AND TRY_TO_NUMBER(gl_code) < 4000 THEN 'Partners'' Capital'
        WHEN TRY_TO_NUMBER(gl_code) >= 4000 AND TRY_TO_NUMBER(gl_code) < 5000 THEN 'Income'
        WHEN TRY_TO_NUMBER(gl_code) >= 5000 AND TRY_TO_NUMBER(gl_code) < 8000 THEN 'Expenses'
        ELSE 'Other'
    END                                                                    AS section,
    gl_code,
    account_name,
    sub_account_name,
    sub_account_code,
    period,
    signed_amount
FROM agg
ORDER BY
    CASE section
        WHEN 'Assets / Investments' THEN 1
        WHEN 'Liabilities'          THEN 2
        WHEN 'Partners'' Capital'   THEN 3
        WHEN 'Income'               THEN 4
        WHEN 'Expenses'             THEN 5
        ELSE 6
    END,
    TRY_TO_NUMBER(gl_code),
    -- No Sub-Account first within an account (it's the "base"/untagged
    -- amount, and often the only row), named sub-accounts after,
    -- alphabetically. This is a hint only — the pivot-building step in
    -- sub-account-view.md re-sorts in memory and is the actual source of
    -- truth for row order.
    CASE WHEN sub_account_name = 'No Sub-Account' THEN 0 ELSE 1 END,
    sub_account_name,
    period;
