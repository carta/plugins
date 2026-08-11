# Reference: Layout I — sub-account drill-down actuals tab

Loaded by `carta-manco/SKILL.md` Gate 2.9 and Gate 7 when the user chose
**Layout I** and the entity has sub-account-tagged journal data.

**Scope note:** unlike every other Layout in this file, Layout I covers the
**full chart of accounts**, not just P&L (`ACCOUNT_TYPE >= 4000`). Live
testing showed sub-account tagging is used almost entirely on capital/
contributed-capital accounts, not income/expense lines — a P&L-only filter
would hide nearly all real sub-account activity. See
[`../queries/actuals-by-account-subaccount-period.sql`](../queries/actuals-by-account-subaccount-period.sql)
for the full rationale.

---

## Output shape

A new tab named **`<PERIOD_LABEL> Sub-Account Drill-Down`** (e.g. `2026 Sub-Account Drill-Down`,
`Q2 2026 Sub-Account Drill-Down`). One tab per run.

**Excel sheet names cap at 31 characters** — `worksheets.add(...)` throws `InvalidArgument` past
that, and a multi-month `<PERIOD_LABEL>` (e.g. `Dec 2025 - Jan 2026`) blows past it once
` Sub-Account Drill-Down` is appended. Before calling `sheets.add`, build the name and truncate
deterministically if it's over 31 chars:
1. Abbreviate each month to 3 letters + 2-digit year (`Dec 2025` → `Dec25`, `Jan 2026` → `Jan26`),
   join a range with a hyphen (`Dec25-Jan26`).
2. Shorten the suffix to `Sub-Acct Drilldown` (drops to 19 chars from 24).
3. If still over 31 chars (only possible for a long custom period label), hard-truncate
   `<PERIOD_LABEL>` to fit, keeping the full suffix — the suffix identifies the tab's *kind*,
   the label is the part a viewer can infer from context (row 2's title cell is unabbreviated).
Use the same abbreviation everywhere this run touches the name: `sheets.add`, the `existing`
lookup before it, and A2's title cell can stay unabbreviated (A2 has no length limit).

**Months are columns. GL accounts are the outer grouping, sub-accounts are indented child
rows beneath their one parent account.** This is deliberately NOT the vendor-view (Layout F)
shape — a vendor can span many different GL accounts, so vendor-view nests GL-account-inside-
vendor. A sub-account can't span accounts (it belongs to exactly one parent account by
construction), so the natural, correct nesting is the other way round: sub-account-inside-
GL-account. This mirrors how sub-accounts are presented in Carta's own chart-of-accounts UI.

Five section bands, in this fixed order — **Assets / Investments, Liabilities, Partners'
Capital, Income, Expenses** — each ending in a section subtotal row (see `queries/actuals-by-
account-subaccount-period.sql`'s `section` column, derived from the leading GL digit: `1xxx`,
`2xxx`, `3xxx`, `4xxx`, `5xxx`/`6xxx`/`7xxx`). Skip a section band entirely if it has zero
accounts with activity in the period — don't render an empty band with just a subtotal of
zero.

### Header (period band → month headers)

```
Row 6 (period band):  |                              | ←——————————— 2026 ———————————→ |
Row 7 (col headers):  | Section / Account / Sub-Acct  | Jan  | Feb  | … | Dec  | Total |
Row 8   (section band): PARTNERS' CAPITAL
Row 9   (account header): 3000 · Contributed capital - LP
Row 10  (sub-acct, indented): No Sub-Account                    | $7,984,066 | | … | | $7,984,066 |
Row 11  (sub-acct, indented): Special Contributions             | ($7,984,066) | | … | | ($7,984,066) |
Row 12  (account subtotal): 3000 Total                          | –          | | … | | –          |
Row 13  (account header): 3008 · Contribution - mgt fees offset - LP
Row 14  (sub-acct, indented): No Sub-Account
Row 15  (sub-acct, indented): Management Fees Credit - Special Contributions
Row 16  (sub-acct, indented): Management Fees Credit - Transaction Fees
Row 17  (account subtotal): 3008 Total
...
Row N   (section subtotal): Subtotal — PARTNERS' CAPITAL
                             (blank row)
Row N+2 (section band): INCOME
...
```

- **Row 6 — period band**: label (`2026`, `Q1 2026`, `Jan 2026`) written into B6, merged across all month + Total columns. Bold, white-on-black, centered.
- **Row 7 — column headers**: `Section / Account / Sub-Account` in A7; month labels in B7:M7; `<PERIOD_LABEL> Total` in the last column. Bold, light gray fill (`#D3D3D3`). **Apply `numberFormat = [["@"...]]` to B7:M7 before writing month labels** — prevents date coercion.
- **Data rows start at row 8.**

### Row structure

1. **Section band row** — section name in column A only (e.g. `PARTNERS' CAPITAL`), bold, blue-tinted fill (`#DCE6F1`), no amounts. One per non-empty section, in the fixed order above.
2. **Account header row** — `<gl_code> · <account_name>` in column A, bold, `#F2F2F2` fill, no amounts. One per GL account with any activity in the period, in `gl_code` ascending order within its section.
3. **Sub-account rows (indented two spaces)** — `  No Sub-Account` always first, then named sub-accounts alphabetically, labeled `  <sub_account_code> · <sub_account_name>` when the query returned a code (e.g. `  7070.001 · Airfare`) — mirrors the account header's `<gl_code> · <account_name>` convention and gives the accountant the exact ledger identifier, not just a display name. `No Sub-Account` never has a code — leave it bare. Monthly amounts from the query; blank for future periods; `0` for past periods with no activity. Annual total: `=SUM(B<row>:M<row>)`. Collapsible (Gate 3b) — these are the rows that group/ungroup.
4. **Account subtotal row** — `<gl_code> Total`, bold, thin top border, `=SUM(...)` per column spanning that account's sub-account rows. **Only emit this row when the account has 2+ sub-account rows** (i.e. it actually has named-sub-account activity, not just a single `No Sub-Account` row) — otherwise it would be a pure duplicate of the one row above it. When an account is skipped, its single `No Sub-Account` row IS the account total.
5. **Section subtotal row** — `Subtotal — <SECTION NAME>`, bold, thin top border, double-line accent, `=SUM(...)` of every account-level amount in that section (sum the account subtotal rows where present, otherwise the lone `No Sub-Account` row).
6. Blank row between sections.

**Grand Total row** at the very bottom: sums all five section subtotals per column; double bottom border.

---

## Metadata band (rows 1–4)

Same 4-row band as all other budget skills (`branding-and-header.md`):

| Row | Cell | Content |
|---|---|---|
| 1 | A1 | Entity name |
| 2 | A2 | Tab title, e.g. `2026 Sub-Account Drill-Down` |
| 3 | A3 | `Source: Carta DWH (actuals pulled <ISO date>)` (italic, size 10) |
| 4 | A4 | `Amounts in <resolved_currency>` (italic, size 10) |
| 5 | A5 | blank |

Data headers start at row 6 (period band), row 7 (column headers); data at row 8+.

---

## SQL

See [`../queries/actuals-by-account-subaccount-period.sql`](../queries/actuals-by-account-subaccount-period.sql).

Substitute `<entity_name>`, `<period_trunc>` (`YEAR` / `QUARTER` / `MONTH`), `<period_start>`,
`<period_end>`. Returns `(section, gl_code, account_name, sub_account_name,
sub_account_code, period, signed_amount)`. `sub_account_code` is `NULL` for the `No
Sub-Account` row and the ledger's formatted sub-account number (e.g. `"7070.001"`) for every
named sub-account — carry it through to the row label (see Row structure #3). `COALESCE
(SUB_ACCOUNT_NAME, 'No Sub-Account')` means a single query returns every account's activity
whether or not it has sub-account tagging — do NOT run a second query for accounts with no
sub-account data, and do NOT filter accounts out just because they only produce a `No
Sub-Account` row.

Hard rules that still apply:
- `FUND_NAME = '<entity_name>'` entity scoping (never `FIRM_NAME ILIKE`)
- `EFFECTIVE_DATE` (books date), not `POSTED_DATE`
- Revenue (`4xxx`) sign-flipped; every other section keeps the ledger's raw sign
- Reversals preserved as negative postings

**No `ACCOUNT_TYPE >= '4000'` filter** — this is the one layout in this skill that
intentionally covers the full COA. See the query file's header comment for why.

---

## Building the data structure

After the query returns rows, build in memory:

```
data[section][gl_code] = {
  account_name,
  sub_accounts: {
    "No Sub-Account": { code: null, months: { "YYYY-MM": signed_amount } },
    "<named sub-account>": { code: "<sub_account_code>", months: { "YYYY-MM": signed_amount } },
    ...
  }
}
```

- **Sections**: fixed order — Assets / Investments, Liabilities, Partners' Capital, Income, Expenses. Omit a section entirely if it has no accounts with activity.
- **Accounts within a section**: sorted by `gl_code` ascending.
- **Sub-accounts within an account**: `No Sub-Account` always first, named sub-accounts alphabetically after.
- **Periods (columns)**: determined by `<AGGREGATION>` from Gate 3a — month labels for MONTH, quarter labels for QUARTER, year label for YEAR.

This in-memory sort is the actual source of row order in the written tab — the SQL's `ORDER BY` is a pagination aid only, not a display guarantee (confirmed empirically: `dwh:execute:query`'s row order does not reliably follow its own `ORDER BY` once results paginate).

---

## Cardinality guard

Layout I uses months (or quarters/years) as columns — the column count is fixed by `<AGGREGATION>` and never exceeds 13 (12 months + Total). No user question is needed regardless of how many accounts or sub-accounts the entity has.

| Aggregation | Max columns |
|---|---|
| MONTH | 13 (Jan–Dec + Total) |
| QUARTER | 5 (Q1–Q4 + Total) |
| YEAR | 2 (Year + Total) |

---

## Writing the workbook (excel-addin runtime)

Follow the same three-call sequence as all other Carta budgeting skills:

- **Call 1** — cell data (sheet create + header + data rows + subtotals + grand total + column widths + recalc + autofit).
- **Call 2** — Carta logo brand block (verbatim from SKILL.md — never paraphrase).
- **Call 3** — combined currency + branding verification.

### Call 1 structure

```javascript
// 1. Delete and recreate the tab (idempotent re-runs)
const sheets = context.workbook.worksheets;
sheets.load("items/name");
await context.sync();
const existing = sheets.items.find(s => s.name === "<PERIOD_LABEL> Sub-Account Drill-Down");
if (existing) existing.delete();
await context.sync();
const sheet = sheets.add("<PERIOD_LABEL> Sub-Account Drill-Down");
await context.sync();

// 2. Metadata band (rows 1–4) — column A
sheet.getRange("A1").values = [["<ENTITY_NAME>"]];
sheet.getRange("A2").values = [["<PERIOD_LABEL> Sub-Account Drill-Down"]];
sheet.getRange("A3").values = [["Source: Carta DWH (actuals pulled <ISO_DATE>)"]];
sheet.getRange("A4").values = [["Amounts in <RESOLVED_CURRENCY>"]];
// Bold A1:A2, italic A3:A4, size 10 all

// 3. Period band (row 6) — write <PERIOD_LABEL> into B6, merge B6 across all month + Total columns
//    Bold, white-on-black, centered

// 4. Column headers (row 7) — "Section / Account / Sub-Account" in A7, month labels in B7:M7, "<PERIOD_LABEL> Total" in last column
//    Bold, light gray fill (#D3D3D3), centered; apply numberFormat=[["@"...]] to B7:M7 before writing labels

// 5. Data rows (row 8+) — per section, per account:
//    - Section band row: bold, #DCE6F1 fill, column A only
//    - Account header row: bold, #F2F2F2 fill, no amount format
//    - Sub-account rows: "  <sub_account_code> · <sub_account_name>" (or "  No Sub-Account")
//      indented two spaces, currency format B:Z — explicitly format.fill.clear() + bold=false,
//      don't just skip setting fill (see Fill-bleed trap below)
//    - Account subtotal row (only if 2+ sub-account rows): format.fill.clear() first, then
//      bold, thin top border, =SUM(...)
//    - Section subtotal row (after each section's last account): format.fill.clear() first,
//      then bold, thin top border
// After all sections: Grand Total row, double bottom border (keeps its own #DCE6F1 fill —
// clear-then-set, don't rely on it already being unset)

// 6. Column widths
sheet.getRange("A:A").format.columnWidth = 280;  // section/account/sub-account label column
// Amount columns: autofit after recalc

// 7. Recalc + autofit (MUST be last, in this order)
context.workbook.application.calculate(Excel.CalculationType.full);
sheet.getRange("A:Z").format.autofitColumns();
await context.sync();
```

**Period-band merge (row 6):** write the period label into B6, then merge B6 across all month + Total columns. Do not write into merged cells after the merge.

**Column headers (row 7):** apply `numberFormat = [["@", ...]]` to B7:M7 first, then write month labels — prevents Excel from coercing "Jan 2026" → date serial 46023.

**Section band row:** column A only, bold, `#DCE6F1` fill, no amount format, no indent.

**Account header row:** column A only, bold, `#F2F2F2` fill, no amount format, no indent.

**Sub-account rows:** column A indented two spaces, labeled `"  <sub_account_code> · <sub_account_name>"` when the query returned a code, else `"  No Sub-Account"` bare (e.g. `"  7070.001 · Special Contributions"`). Columns B onward: currency format built from `<RESOLVED_CURRENCY>` — never bare `$` or `_($*`, and never fall back to USD for non-USD funds. Pick the format string by currency:
- USD: `[$$-en-US]#,##0.00_);([$$-en-US]#,##0.00);"-"`
- EUR: `[$€-407]#,##0.00_);([$€-407]#,##0.00);"-"`
- GBP: `[$£-809]#,##0.00_);([$£-809]#,##0.00);"-"`
- Other currencies: same pattern with that currency's locale token — never bare `$` or `_($*`.

Blank for future periods; `0` for past periods with no activity.

**Account subtotal formulas:** `=SUM(<col><first_subacct_row>:<col><last_subacct_row>)` per column. Bold, thin top border. Omit entirely when the account has only one (`No Sub-Account`) row.

**Section subtotal formulas:** sum every account-level amount in the section (the account subtotal row where one exists, otherwise the account's lone `No Sub-Account` row) per column. Bold, thin top border.

**Fill-bleed trap.** Account-header fill (`#F2F2F2`) reliably bleeds onto the sub-account and
subtotal rows beneath it if you only set fill on the rows that need color and leave the rest
untouched — reproduced on every tab built this way, not a one-off. Leaving a row's fill unset
is not the same as it rendering unfilled. For every row type that should have **no** background
color (sub-account rows, account subtotal rows, section subtotal rows), call
`format.fill.clear()` explicitly in the same pass that writes the row — don't just omit the
`fill.color =` assignment. The Grand Total row is the one exception: it wants `#DCE6F1`, so
clear first, then set it, rather than assuming it's already clean.

**Grand Total formulas:** sum the five section subtotal rows per column. Bold, thin top border, double bottom border.

---

## Writing the workbook (local-file runtime)

Use `create_sheet`, `write_cell`, `write_range`, `merge_cells`, `set_bold`, `set_format`,
`set_column_width` (label col), `autofit_columns` (data cols) operations via `write_workbook.py`.

**Idempotency guard:** before `create_sheet`, issue a `delete_sheet` op targeting
`"<PERIOD_LABEL> Sub-Account Drill-Down"`. If the sheet does not exist, `write_workbook.py`
ignores the delete silently — so always include it.

**Do NOT include `freeze_panes`** — same rule as all other Carta budgeting skills.

---

## Collapse/expand grouping (optional, excel-addin runtime only)

Run this as a **4th `execute_office_js` call** — after the three required calls (cell write → logo brand → combined verification) all pass. Only run when `<SUBACCOUNT_GROUPING>` is `collapsed` or `expanded` (set at Gate 3b). Skip entirely for local-file runtime.

**Detection strategy:** sub-account rows have two leading spaces in column A (`"  No Sub-Account"`, `"  Special Contributions"`). Section band rows, account header rows, subtotal rows, and the Grand Total row do not — do NOT group them. The indent is always exactly two spaces as written in Call 1.

```javascript
const sheet = context.workbook.worksheets.getItem("<PERIOD_LABEL> Sub-Account Drill-Down");
const usedRange = sheet.getUsedRange();
usedRange.load("values, rowIndex, rowCount");
await context.sync();

// Collect sub-account rows — those with two leading spaces in column A
const subAcctRows = [];
for (let i = 0; i < usedRange.values.length; i++) {
  const cellVal = usedRange.values[i][0];
  if (typeof cellVal === "string" && cellVal.startsWith("  ")) {
    subAcctRows.push(usedRange.rowIndex + i + 1); // convert to 1-based row number
  }
}

// Group each sub-account row (Excel automatically merges contiguous rows into one group)
for (const rowNum of subAcctRows) {
  sheet.getRange(`${rowNum}:${rowNum}`).group(Excel.GroupOption.byRows);
}
await context.sync();

// Set the default visibility state
if ("<SUBACCOUNT_GROUPING>" === "collapsed") {
  sheet.showOutlineLevels(1, undefined);  // hides sub-account rows; only account headers visible
} else {
  sheet.showOutlineLevels(2, undefined);  // all rows visible; +/- controls available
}
await context.sync();

return { grouped: subAcctRows.length, state: "<SUBACCOUNT_GROUPING>" };
```

Substitute `<PERIOD_LABEL>` and `<SUBACCOUNT_GROUPING>` (`"collapsed"` or `"expanded"`) before running.

After this call the user sees **+/−** toggles on the sheet's left margin. The **1/2** outline-level buttons in the top-left corner expand or collapse every account's sub-account rows at once.

---

## Sparse-history flag

After building the pivot, count distinct periods per `(gl_code, sub_account_name)` pair. If **< 6** distinct periods, flag `low-confidence — sparse history`. Surface the count in the Gate 6 preview. In practice, expect this flag on most sub-account rows — the feature is new and sparsely used, so short histories are the norm, not an anomaly to chase down.

## Negative or swinging "No Sub-Account" row

If an account's `No Sub-Account` row moves sharply — especially a large negative — in a
period where its named sub-accounts newly appear or grow, this is very likely a
reclassification: someone moved historical spend that used to sit untagged into the newly
created sub-accounts, posting the offset against the untagged row rather than restating prior
periods. Confirmed live on accounts where sub-account tagging started mid-year — the account
**total** stayed correct throughout, only the `No Sub-Account` split moved. Before flagging
this to the user as a data anomaly:
- Check whether the account's sub-account rows gained new names or a jump in activity in the
  same period the `No Sub-Account` row swung.
- If so, say so plainly and point at the account total, not the individual row — e.g. "`No
  Sub-Account` reads negative in `<month>` because that month's reclass moved untagged spend
  into the new named sub-accounts; `<gl_code> Total` for that month is unaffected and is the
  number to read."
- Don't silently adjust the row — the raw figure is correct, only its interpretation needs the
  caveat. A cell comment on the row (per the Cell-comment pattern in `branding-and-header.md`)
  is the right place for this, not a fill/color change.
