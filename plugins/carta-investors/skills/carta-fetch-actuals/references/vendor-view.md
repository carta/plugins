# Reference: Layout F — vendor-view actuals tab

Loaded by `carta-fetch-actuals/SKILL.md` Gate 2.6 and Gate 7 when the user chose
**Layout F** and the entity has vendor-tagged journal data.

---

## Output shape

A new tab named **`<PERIOD_LABEL> Actuals by Vendor`** (e.g. `2026 Actuals by Vendor`,
`Q2 2026 Actuals by Vendor`). One tab per run.

**Months are columns. Vendors are rows.** This mirrors the standard actuals tab layout
(months across the top) with vendor groupings as the row dimension.

### Two-row header (period band → month headers)

```
Row 6 (period band):  |                  | ←——————————— 2026 ———————————→ |
Row 7 (col headers):  | Vendor / Account | Jan  | Feb  | … | Dec  | Total |
Row 8+ data:          | Justworks        |      |      |   |      |       |  ← vendor header
                      |   7130 · Payroll | $10k | $10k | … |      | $60k  |  ← GL row (indented)
                      | Justworks Total  | $10k | $10k | … |      | $60k  |  ← subtotal
```

- **Row 6 — period band**: label (`2026`, `Q1 2026`, `Jan 2026`) written into B6, then merge B6 across all month + Total columns. Bold, white-on-black, centered.
- **Row 7 — column headers**: `Vendor / Account` in A7; month labels in B7:M7 (`Jan 2026` … `Dec 2026` for monthly, `Q1 2026` … for quarterly, `2026` for annual); `<PERIOD_LABEL> Total` in the last column. Bold, light gray fill (`#D3D3D3`). **Apply `numberFormat = [["@"...]]` to B7:M7 before writing month labels** — prevents date coercion.
- **Data rows start at row 8.**

### Row structure (per vendor)

1. **Vendor header row** — vendor name in column A, bold, `#F2F2F2` fill, no amounts.
2. **GL account rows** — `  <gl_code> · <account_name>` indented two spaces. Monthly amounts from the query; blank for future periods; `0` for past periods with no activity. Annual total: `=SUM(B<row>:M<row>)`. Collapsible (Gate 3b).
3. **Vendor subtotal row** — `<Vendor> Total`, bold, thin top border, `=SUM(...)` per column (same-column range from first to last GL row for that vendor).
4. Blank row between vendor sections.

Named vendors sorted alphabetically; `No vendor` always last. **Grand Total row** at the bottom: sums all vendor subtotal rows per column; double bottom border.

---

## Metadata band (rows 1–4)

Same 4-row band as all other budget skills (`branding-and-header.md`):

| Row | Cell | Content |
|---|---|---|
| 1 | A1 | Entity name |
| 2 | A2 | Tab title, e.g. `2026 Actuals by Vendor` |
| 3 | A3 | `Source: Carta DWH (actuals pulled <ISO date>)` (italic, size 10) |
| 4 | A4 | `Amounts in <resolved_currency>` (italic, size 10) |
| 5 | A5 | blank |

Data headers start at row 6 (period band), row 7 (vendor header); data at row 8+.

---

## SQL

See [`../queries/actuals-by-account-vendor-period.sql`](../queries/actuals-by-account-vendor-period.sql).

Substitute `<entity_name>`, `<period_trunc>` (`YEAR` / `QUARTER` / `MONTH`),
`<period_start>`, `<period_end>`. `COALESCE(VENDOR_NAME, 'No vendor')` in the
SELECT means a single query returns both named-vendor and untagged rows — do
NOT run a second query for `VENDOR_NAME IS NULL` entries.

All existing hard rules apply unchanged:
- `FUND_NAME = '<entity_name>'` entity scoping (never `FIRM_NAME ILIKE`)
- `EFFECTIVE_DATE` (books date), not `POSTED_DATE`
- Revenue (`4xxx`) sign-flipped; expenses kept as-is
- `ACCOUNT_TYPE >= '4000'` — P&L only, no balance sheet
- Reversals preserved as negative postings

---

## Building the data structure

After the query returns rows shaped `(vendor_name, gl_code, account_name, period, signed_amount)`, build in memory:

```
data[vendor_name][gl_code] = { account_name, months: { "YYYY-MM": signed_amount } }
```

- **Vendors**: named vendors sorted alphabetically, `No vendor` always last.
- **GL accounts within a vendor**: sorted by `gl_code` ascending.
- **Periods (columns)**: determined by `<AGGREGATION>` from Gate 3a — month labels for MONTH, quarter labels for QUARTER, year label for YEAR.

---

## Cardinality guard

Layout F uses months (or quarters/years) as columns — the column count is fixed by `<AGGREGATION>` and never exceeds 13 (12 months + Total). No user question is needed regardless of how many vendors the entity has. Vendors are rows, so vendor count does not affect column width.

| Aggregation | Max columns |
|---|---|
| MONTH | 13 (Jan–Dec + Total) |
| QUARTER | 5 (Q1–Q4 + Total) |
| YEAR | 2 (Year + Total) |

All three are well within Excel's display limits — no wide/long pivot decision is needed.

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
const existing = sheets.items.find(s => s.name === "<PERIOD_LABEL> Actuals by Vendor");
if (existing) existing.delete();
await context.sync();
const sheet = sheets.add("<PERIOD_LABEL> Actuals by Vendor");
await context.sync();

// 2. Metadata band (rows 1–4) — column A
sheet.getRange("A1").values = [["<ENTITY_NAME>"]];
sheet.getRange("A2").values = [["<PERIOD_LABEL> Actuals by Vendor"]];
sheet.getRange("A3").values = [["Source: Carta DWH (actuals pulled <ISO_DATE>)"]];
sheet.getRange("A4").values = [["Amounts in <RESOLVED_CURRENCY>"]];
// Bold A1:A2, italic A3:A4, size 10 all

// 3. Period band (row 6) — write <PERIOD_LABEL> into B6, merge B6 across all month + Total columns
//    Bold, white-on-black, centered

// 4. Column headers (row 7) — "Vendor / Account" in A7, month labels in B7:M7, "<PERIOD_LABEL> Total" in last column
//    Bold, light gray fill (#D3D3D3), centered; apply numberFormat=[["@"...]] to B7:M7 before writing labels

// 5. Data rows (row 8+) — per vendor section:
//    - Vendor header row: bold, #F2F2F2 fill
//    - Account rows: "  <gl_code> · <account_name>", currency format B:Z
//    - Subtotal row: bold, thin top border, =SUM(...) per column
//    After all vendor sections: Grand Total row, double bottom border

// 6. Column widths
sheet.getRange("A:A").format.columnWidth = 260;  // account label column
// Amount columns: autofit after recalc

// 7. Recalc + autofit (MUST be last, in this order)
context.workbook.application.calculate(Excel.CalculationType.full);
sheet.getRange("A:Z").format.autofitColumns();  // widen range to last amount column
await context.sync();
```

**Period-band merge (row 6):** write the period label into B6 (`sheet.getRange("B6").values = [["2026"]]`), then merge B6 across all month + Total columns (`sheet.getRange("B6:<last_col>6").merge(true)`). Do not write into merged cells after the merge.

**Column headers (row 7):** apply `numberFormat = [["@", ...]]` to B7:M7 first, then write month labels. This prevents Excel from coercing "Jan 2026" → date serial 46023.

**Vendor header row:** column A only, bold, `#F2F2F2` fill, no amount format.

**GL account rows:** column A indented two spaces (`"  7130 · Payroll"`). Columns B onward: currency format `[$$-en-US]#,##0.00_);([$$-en-US]#,##0.00);"-"` for USD (use the matching locale token for other currencies — never use bare `$` or `_($*` which render the system currency symbol). Blank for future periods; `0` for past periods with no activity.

**Subtotal formulas:** `=SUM(<col><first_gl_row>:<col><last_gl_row>)` per column — same column only, never a cumulative left-to-right range. Bold, thin top border.

**Grand Total formulas:** `=<col><subtotal1>+<col><subtotal2>+...` per column. Bold, thin top border, double bottom border.

---

## Writing the workbook (local-file runtime)

Use `create_sheet`, `write_cell`, `write_range`, `merge_cells`, `set_bold`, `set_format`,
`set_column_width` (account col), `autofit_columns` (data cols) operations via
`write_workbook.py`.

**Idempotency guard:** before `create_sheet`, issue a `delete_sheet` op targeting
`"<PERIOD_LABEL> Actuals by Vendor"`. If the sheet does not exist, `write_workbook.py`
ignores the delete silently — so always include it. Without this guard, a second run
will raise `ValueError: Cannot merge cells that overlap existing merged cells` from
the prior run's period-band merges.

Always issue a `write_cell` for a period label **before** the `merge_cells` op for that
same range — the merge clears trailing cells, but the first cell's value is already written.

**Do NOT include `freeze_panes`** — same rule as all other Carta budgeting skills.

---

## Sparse-history flag

After building the pivot, count distinct periods per `(vendor_name, account_name)` pair. If **< 6** distinct periods, flag `low-confidence — sparse history`. Surface the count in the Gate 6 preview and add a cell comment on the written row (per `branding-and-header.md` §"Cell-comment pattern").

---

## Inferred vendors (only when Gate 5.5 ran and was approved)

When `<INFERRED_VENDORS>` carries approved memo→vendor mappings, the amounts are
already folded into the pivot at Gate 5.5 Step 5 — no extra query or write path.
The only Layout F addition is a **cell comment** on each vendor whose total
includes an inferred amount:

- **Existing vendor that received an inferred amount:** comment on the vendor
  header row's column-A cell.
- **New vendor created purely from memos:** comment on that vendor's header-row
  column-A cell.

```javascript
sheet.comments.add("A<vendor_header_row>", "Includes <amount_with_currency> inferred from memo(s) — e.g. \"<sample_memo>\". Not vendor-tagged in the ledger.", "Plain");
await context.sync();
```

`<amount_with_currency>` MUST be formatted per the fund's resolved currency
(e.g. `1,240 EUR` / `1,240 USD`) — never a bare number and never a hardcoded `$`.

Comment only — no fill / font color / border (same rule as the sparse-history
flag). Add these comments in the same `execute_office_js` call as the
sparse-history comments. The residual `No vendor` section (if any entries stayed
untagged) renders normally; if it emptied out, omit it.

---

## Collapse/expand grouping (optional, excel-addin runtime only)

Run this as a **4th `execute_office_js` call** — after the three required calls (cell write → logo brand → combined verification) all pass. Only run when `<VENDOR_GROUPING>` is `collapsed` or `expanded` (set at Gate 3b). Skip entirely for local-file runtime.

**Detection strategy:** GL account rows have two leading spaces in column A (`"  7130 · Payroll"`). Vendor header rows, subtotal rows, and the Grand Total row do not — do NOT group them. The indent is always exactly two spaces as written in Call 1.

```javascript
const sheet = context.workbook.worksheets.getItem("<PERIOD_LABEL> Actuals by Vendor");
const usedRange = sheet.getUsedRange();
usedRange.load("values, rowIndex, rowCount");
await context.sync();

// Collect GL account rows — those with two leading spaces in column A
const glRows = [];
for (let i = 0; i < usedRange.values.length; i++) {
  const cellVal = usedRange.values[i][0];
  if (typeof cellVal === "string" && cellVal.startsWith("  ")) {
    glRows.push(usedRange.rowIndex + i + 1); // convert to 1-based row number
  }
}

// Group each GL row (Excel automatically merges contiguous rows into one group)
for (const rowNum of glRows) {
  sheet.getRange(`${rowNum}:${rowNum}`).group(Excel.GroupOption.byRows);
}
await context.sync();

// Set the default visibility state
if ("<VENDOR_GROUPING>" === "collapsed") {
  sheet.showOutlineLevels(1, undefined);  // hides GL rows; only vendor headers visible
} else {
  sheet.showOutlineLevels(2, undefined);  // all rows visible; +/- controls available
}
await context.sync();

return { grouped: glRows.length, state: "<VENDOR_GROUPING>" };
```

Substitute `<PERIOD_LABEL>` (e.g. `"2026"`, `"Q2 2026"`) and `<VENDOR_GROUPING>` (`"collapsed"` or `"expanded"`) before running.

After this call the user sees **+/−** toggles on the sheet's left margin. The **1/2** outline-level buttons in the top-left corner expand or collapse all vendor sections at once.
