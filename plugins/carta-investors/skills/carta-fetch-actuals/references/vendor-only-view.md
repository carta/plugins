# Reference: Layout H — vendor-only tab (no GL breakdown)

Loaded by `carta-fetch-actuals/SKILL.md` Gate 2.8 and Gate 7 when the user
chose **Layout H** and the entity has vendor-tagged journal data.

Layout H is the lightweight vendor view: **one row per vendor, no GL account
sub-rows.** It answers "how much did we spend with each vendor over this period?"
without the account-level detail that Layout F provides. No row grouping is
needed — there are no collapsible sub-rows.

---

## Output shape

A new tab named **`<PERIOD_LABEL> Vendors`** (e.g. `2026 Vendors`,
`Q2 2026 Vendors`). One tab per run.

**Periods are columns. Vendors are rows.**

### Two-row header (period band → column headers)

```
Row 6 (period band):  |         | ←——————————— 2026 ———————————→ |
Row 7 (col headers):  | Vendor  | Jan  | Feb  | … | Dec  | Total |
Row 8+ data:          | Justworks | $10k | $10k | … | $0  | $60k  |
                      | Rippling  | $5k  | $5k  | … | $0  | $30k  |
                      | No vendor  | $2k  | $0   | … | $0  | $2k   |
                      | Grand Total | $17k | $15k | … | $0 | $92k |
```

- **Row 6 — period band**: label (`2026`, `Q1 2026`, `Jan 2026`) written into B6,
  then merge B6 across all period + Total columns. Bold, white-on-black, centered.
- **Row 7 — column headers**: `Vendor` in A7; period labels in B7 onward (same
  format as Layout F: `Jan 2026` / `Q1 2026` / `2026` depending on `<AGGREGATION>`);
  `<PERIOD_LABEL> Total` in the last column. Bold, light gray fill (`#D3D3D3`).
  **Apply `numberFormat = [["@"...]]` to the period-label range before writing labels**
  — prevents date coercion.
- **Data rows start at row 8.**

### Row structure

1. **Vendor rows** — vendor name in column A. Amounts for each period; blank for
   future periods; `0` for past periods with no activity. Annual total:
   `=SUM(B<row>:<last_period_col><row>)`.
2. A blank row after the last named vendor, before `No vendor`.
3. **No vendor row** — only present when `<HAS_UNTAGGED>` is true. Same format as
   vendor rows.
4. **Grand Total row** — `Grand Total` in column A. `=SUM(...)` per column across
   all vendor rows (including No vendor). Bold, thin top border, double bottom border.

Named vendors sorted alphabetically; `No vendor` always last (before Grand Total).

---

## Metadata band (rows 1–4)

Same 4-row band as all other budget skills (`branding-and-header.md`):

| Row | Cell | Content |
|---|---|---|
| 1 | A1 | Entity name |
| 2 | A2 | Tab title, e.g. `2026 Vendors` |
| 3 | A3 | `Source: Carta DWH (actuals pulled <ISO date>)` (italic, size 10) |
| 4 | A4 | `Amounts in <resolved_currency>` (italic, size 10) |
| 5 | A5 | blank |

Data headers start at row 6 (period band), row 7 (column headers); data at row 8+.

---

## SQL

See [`../queries/actuals-by-vendor-period.sql`](../queries/actuals-by-vendor-period.sql).

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

After the query returns rows shaped `(vendor_name, period, signed_amount)`, build in memory:

```
data[vendor_name] = { periods: { "YYYY-MM": signed_amount } }
```

- **Vendors**: named vendors sorted alphabetically, `No vendor` always last.
- **Periods (columns)**: determined by `<AGGREGATION>` from Gate 3a — month labels
  for MONTH, quarter labels for QUARTER, year label for YEAR.

---

## Cardinality guard

Same as Layout F — columns are fixed by `<AGGREGATION>`, never exceed 13. No
user question is needed.

| Aggregation | Max columns |
|---|---|
| MONTH | 13 (Jan–Dec + Total) |
| QUARTER | 5 (Q1–Q4 + Total) |
| YEAR | 2 (Year + Total) |

---

## Writing the workbook (excel-addin runtime)

Same three-call sequence as all other Carta budgeting skills:

- **Call 1** — cell data (sheet create + header + data rows + grand total +
  column widths + recalc + autofit).
- **Call 2** — Carta logo brand block (verbatim from SKILL.md — never paraphrase).
- **Call 3** — combined currency + branding verification.

### Call 1 structure

```javascript
// 1. Delete and recreate the tab (idempotent re-runs)
const sheets = context.workbook.worksheets;
sheets.load("items/name");
await context.sync();
const existing = sheets.items.find(s => s.name === "<PERIOD_LABEL> Vendors");
if (existing) existing.delete();
await context.sync();
const sheet = sheets.add("<PERIOD_LABEL> Vendors");
await context.sync();

// 2. Metadata band (rows 1–4) — column A
sheet.getRange("A1").values = [["<ENTITY_NAME>"]];
sheet.getRange("A2").values = [["<PERIOD_LABEL> Vendors"]];
sheet.getRange("A3").values = [["Source: Carta DWH (actuals pulled <ISO_DATE>)"]];
sheet.getRange("A4").values = [["Amounts in <RESOLVED_CURRENCY>"]];
// Bold A1:A2, italic A3:A4, size 10 all

// 3. Period band (row 6) — write <PERIOD_LABEL> into B6, merge B6 across all
//    period + Total columns. Bold, white-on-black, centered.

// 4. Column headers (row 7) — "Vendor" in A7, period labels in B7 onward,
//    "<PERIOD_LABEL> Total" in last column. Bold, #D3D3D3 fill, centered.
//    Apply numberFormat=[["@"...]] to period-label cells before writing labels.

// 5. Data rows (row 8+):
//    - One row per named vendor (alphabetical), then No vendor (if any), then Grand Total.
//    - Vendor name in A; currency-formatted amounts in period columns; SUM formula in Total col.
//    - Grand Total row: bold, thin top border, double bottom border.

// 6. Column widths
sheet.getRange("A:A").format.columnWidth = 220;  // vendor name column
// Amount columns: autofit after recalc

// 7. Recalc + autofit (MUST be last, in this order)
context.workbook.application.calculate(Excel.CalculationType.full);
sheet.getRange("A:Z").format.autofitColumns();
await context.sync();
```

**Period-band merge (row 6):** write the period label into B6 first, then merge B6
across all period + Total columns. Do not write into merged cells after the merge.

**Column headers (row 7):** apply `numberFormat = [["@", ...]]` to the period-label
range before writing labels to prevent date coercion.

**Vendor rows:** column A holds the vendor name (no indentation). Columns B onward:
currency format `[$$-en-US]#,##0.00_);([$$-en-US]#,##0.00);"-"` for USD (use the
matching locale token for other currencies — never use bare `$` or `_($*`).
Blank for future periods; `0` for past periods with no activity.

**Total column formula:** `=SUM(B<row>:<last_period_col><row>)` per vendor row.

**Grand Total formula:** `=SUM(<col><first_vendor_row>:<col><last_vendor_or_untagged_row>)` per
column — sum all vendor rows including No vendor. Bold, thin top border, double bottom border.

---

## Writing the workbook (local-file runtime)

Use `create_sheet`, `write_cell`, `write_range`, `merge_cells`, `set_bold`, `set_format`,
`set_column_width` (vendor col), `autofit_columns` (data cols) operations via
`write_workbook.py`.

**Idempotency guard:** before `create_sheet`, issue a `delete_sheet` op targeting
`"<PERIOD_LABEL> Vendors"`. If the sheet does not exist, `write_workbook.py`
ignores the delete silently — so always include it.

Always issue a `write_cell` for the period label **before** the `merge_cells` op.

**Do NOT include `freeze_panes`** — same rule as all other Carta budgeting skills.

---

## Sparse-history flag

After building the pivot, count distinct periods per `vendor_name`. If **< 6**
distinct periods, flag `low-confidence — sparse history`. Surface the count in
the Gate 6 preview and add a cell comment on the written row.

---

## Inferred vendors (only when Gate 5.5 ran and was approved)

When `<INFERRED_VENDORS>` carries approved memo→vendor mappings, the amounts are
already folded into the pivot at Gate 5.5 Step 5. The only Layout H addition is a
**cell comment** on each vendor row whose total includes an inferred amount
(column A of that vendor's data row):

```javascript
sheet.comments.add("A<vendor_row>", "Includes <amount_with_currency> inferred from memo(s) — e.g. \"<sample_memo>\". Not vendor-tagged in the ledger.", "Plain");
await context.sync();
```

`<amount_with_currency>` MUST be formatted per the fund's resolved currency
(e.g. `1,240 EUR` / `1,240 USD`) — never a bare number and never a hardcoded `$`.

Comment only — no fill / font color / border (same rule as the sparse-history
flag). The residual `No vendor` row (if any entries stayed untagged) renders
normally; if it emptied out, omit it.

---

## No row grouping

Layout H has no GL sub-rows and therefore no collapse/expand grouping. Gate 3b is
skipped entirely for this layout. Do not apply `sheet.getRange(...).group()` to any
rows.
