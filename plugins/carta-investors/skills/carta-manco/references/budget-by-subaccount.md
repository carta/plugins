# Reference: build a budget from prior-year actuals, sliced by sub-account

## When to use

Routed from `create-budget.md` Gate 3 on "by sub-account" phrasing — a **separate row** from
"by department" / "by reporting tag" / "sliced by `<dimension>`", which still route to
`slice-by-tag.md`. Sub-account is not a tag: it belongs to exactly one parent account (unlike
a reporting tag, which can vary independently across many accounts), so it needs its own
account-outer/sub-account-inner shape, not `slice-by-tag.md`'s per-dimension column-block
pivot. Don't route sub-account requests through `slice-by-tag.md`.

## Relationship to `from-prior-actuals.md`

This file is a **delta**, not a replacement. Same source, sign convention, section mapping,
sparse-history flag, approval gate, Tab 2 (reference actuals), currency/number formatting, and
column-width recipe as [`from-prior-actuals.md`](from-prior-actuals.md) — **read that file too
and follow it except where this file says otherwise.** This file only covers: the sub-account
discovery step, and how Tab 1/Tab 2's rows differ for accounts that have sub-account activity.

---

## Step 1 — Sub-account discovery (P&L-scoped, before building the chart of accounts)

**Silent probe — no user-facing output**, same shape as `fetch-actuals.md` Gate 2.9, but
scoped to P&L this time (`TRY_TO_NUMBER(ACCOUNT_TYPE) >= 4000`) since you can't budget capital
accounts:

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT
            COUNT_IF(SUB_ACCOUNT_NAME IS NOT NULL) AS tagged_rows,
            COUNT(DISTINCT CASE WHEN SUB_ACCOUNT_NAME IS NOT NULL THEN ACCOUNT_TYPE END) AS accounts_with_subaccounts
          FROM <journal_entries_table>
          WHERE FUND_NAME = '<entity_name>'
            AND TRY_TO_NUMBER(ACCOUNT_TYPE) >= 4000
            AND EFFECTIVE_DATE >= '<lookback_start_year>-01-01'",
  "format": "markdown",
  "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-manco", "<CAPABILITY>"]}
}})
```

`ACCOUNT_TYPE` is stored as a string. `ACCOUNT_TYPE >= '4000'` compares lexically, not
numerically — safe by coincidence when every code in the chart happens to be 4 digits, wrong
the moment one isn't (a 3-digit code like `'500'` lexically compares as `>= '4000'` since `'5'
> '4'` at the first character, even though `500 < 4000` numerically). Always wrap the column in
`TRY_TO_NUMBER(...)` before comparing it to a numeric literal.

(Snowflake's `FILTER (WHERE …)` clause on aggregates is not supported in this environment —
validated live and confirmed it throws a syntax error. Use the `CASE WHEN … THEN <col> END`
form inside `COUNT(DISTINCT …)` instead, as above.)

- `tagged_rows == 0` → no P&L sub-account activity at all. Tell the user in one sentence —
  *"This entity doesn't have sub-account-tagged P&L activity, so I'll build a standard
  account-level budget instead."* — and fall through to plain `from-prior-actuals.md` behavior
  (every account gets a single row; skip the rest of this file entirely).
- `tagged_rows > 0` → store the flagged account list (`<SUBACCOUNT_ACCOUNTS>`) for Step 2. Only
  these specific accounts get sub-account rows in Tab 1/Tab 2 — every other account keeps
  `from-prior-actuals.md`'s normal single-row shape. Continue to Step 2.

Expect this to be a small subset of accounts, or `tagged_rows == 0` outright, on most
entities — sub-account tagging is sparse and, per live testing, skews toward capital
accounts far more than P&L. Don't treat a small or empty result as an error.

---

## Step 2 — Monthly activity by sub-account

Reuse [`../queries/actuals-by-account-subaccount-period.sql`](../queries/actuals-by-account-subaccount-period.sql)
— the same query `sub-account-view.md` (Layout I) uses — rather than writing a new one.
Substitute `<period_trunc> = MONTH`, `<period_start> = '<prior_year>-01-01'`,
`<period_end> = '<prior_year>-12-31'`. That query computes `section` per row; **keep only
rows where `section IN ('Income', 'Expenses')`** — discard `Assets / Investments`,
`Liabilities`, and `Partners' Capital` rows, since budgets are P&L-only.

For accounts **not** in `<SUBACCOUNT_ACCOUNTS>`, use
[`../queries/prior-year-monthly-activity.sql`](../queries/prior-year-monthly-activity.sql)
exactly as `from-prior-actuals.md` §2 describes — don't re-fetch data you already have a flat
query for. This means two query calls total, same as `from-prior-actuals.md`'s q1 (chart of
accounts) + q2 (monthly activity), plus this file's sub-account variant of q2 for the flagged
accounts only.

---

## Step 3 — Proposed amount per (account, sub-account, month)

Same "first match wins" rule as `from-prior-actuals.md` §4 (mgmt-fee schedule → prior-year
actual for the same calendar month → zero default), just also keyed by sub-account for the
`<SUBACCOUNT_ACCOUNTS>` rows. `No Sub-Account` is projected the same way as any named
sub-account — it's just another row, not a special case.

The sparse-history confidence flag (`from-prior-actuals.md` §4a) applies per `(account,
sub-account)` pair for flagged accounts, not per account — a sub-account with under 6 months
of history gets its own low-confidence comment even if its parent account overall has plenty.

If a flagged account's `No Sub-Account` row swings sharply (especially negative) in a month
where its named sub-accounts newly appear, see `sub-account-view.md`'s "Negative or swinging
'No Sub-Account' row" section — the same reclassification pattern applies here, and copying a
reclass month's figures verbatim into next year's budget produces a nonsensical line (a
negative expense budget). Flag it via cell comment rather than silently adjusting the number.

---

## Step 4 — Tab 1 (`Budget <budget_year>`) row structure

Follow `from-prior-actuals.md` §5 for section header rows, section subtotals, Total Income /
Total Expenses / Net Operating Income, and the two-tab structure. The only difference is how
an account in `<SUBACCOUNT_ACCOUNTS>` renders:

1. **Account header row** — `<gl_code> · <account_name>`, bold, `#F2F2F2` fill, no amounts.
   Same convention as `sub-account-view.md`.
2. **Sub-account rows (indented two spaces)** — `  No Sub-Account` first, then named
   sub-accounts alphabetically, labeled `  <sub_account_code> · <sub_account_name>` when the
   query returned a code — same code-in-label convention as `sub-account-view.md`, `No
   Sub-Account` stays bare. Hardcoded budget values (prior-year actual for that month, per
   `from-prior-actuals.md` §4 — no buffer-% multiplier). Annual total: `=SUM(B<row>:M<row>)`.
   Explicitly `format.fill.clear()` these rows (and the account/section subtotal rows below) —
   don't just leave fill unset. See `sub-account-view.md`'s Fill-bleed trap: the account
   header's `#F2F2F2` reliably bleeds onto the rows beneath it otherwise.
3. **Account subtotal row** — `<gl_code> Total`, bold, thin top border, `=SUM(...)` spanning
   its sub-account rows. **Only emit when the account has 2+ sub-account rows** — same
   "don't duplicate a lone row" rule as `sub-account-view.md`. When omitted, the account's one
   `No Sub-Account` row already **is** the section-subtotal input for that account.

Every account **not** in `<SUBACCOUNT_ACCOUNTS>` keeps `from-prior-actuals.md`'s plain
single-row-per-account shape, unchanged, in the same section block.

## Tab 2 (`<prior_year> Actuals`) — same nesting, for a reason

Mirror the identical account-header / sub-account-row / account-subtotal structure on Tab 2,
using hardcoded prior-year actuals instead of proposed budget values. Keeping both tabs
row-for-row identical in shape (not just Tab 1) is what lets `fetch-actuals.md`'s later
refresh/interleave flows auto-detect and match sub-account rows correctly — see the next
section.

**"Row-for-row identical" includes the sparse-history comments, not just the row shape.** The
§4a/§3 confidence flag is a property of the underlying `(account, sub-account)` history, not of
whether you're looking at it through the Budget or Actuals lens — so build Tab 2 from the exact
same per-row sparse/not-sparse determination Tab 1 used, not a second, independent pass that
can silently diverge from it. Don't write Tab 2 from a separate code path that happens to omit
the comment step — if you're not sharing a helper function between the two tab builds, that's
the mechanism most likely to drop it on one tab and not the other.

---

## Why this budget can't round-trip through Carta at sub-account granularity

`create-budget` never writes to Carta's budget API — everything here lands in the Excel
workbook only, same as every other `create-budget` path. That's not a new limitation
introduced by sub-account slicing. But be aware: `fa:list:budgets` (the API `fetch-budget`
pulls from) has no sub-account field at all, so if the user later asks to "pull the Carta
budget" for this entity, whatever comes back will be account-level only — it will not
reproduce this workbook's sub-account rows. That's expected, not a bug to chase.

---

## Read this before touching a sub-account-sliced budget later

A budget built by this path has sub-account-level rows for the accounts in
`<SUBACCOUNT_ACCOUNTS>`. `fetch-actuals.md` Gate 4 auto-detects those rows (same two-space
indent convention as `sub-account-view.md`) when reading an existing budget tab, and Gate 5
pulls sub-account-level actuals for exactly those accounts instead of the flat query — see
`fetch-actuals.md` Gate 4/5 for the mechanics. Don't hand-roll a separate matching scheme
here; it's handled centrally so Layouts A–D stay consistent with how this file wrote the tab.

---

## Hard rules (budget-by-subaccount specific)

- P&L only — same `TRY_TO_NUMBER(ACCOUNT_TYPE) >= 4000` scope as all budget creation. Never
  budget capital accounts.
- Never invent sub-account names — only ones Step 1's discovery query actually returned.
- `No Sub-Account` is always the first row within a flagged account, matching
  `sub-account-view.md`'s convention.
- Budget values are hardcoded numbers, exactly like `from-prior-actuals.md` — sub-account
  rows are not formulas referencing anything outside the sheet.
