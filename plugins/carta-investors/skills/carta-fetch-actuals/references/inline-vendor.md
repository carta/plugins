# Reference: Layout G — vendor rows inline on existing actuals tab

Loaded by `carta-fetch-actuals/SKILL.md` Gate 2.7 when the user asked to add
vendor breakdown directly to an existing actuals tab (not a new tab).

The existing tab is rebuilt in place: vendor sub-rows are inserted under each
account, and account rows become formula subtotals of their vendor children.

---

## When to use

User is on an existing actuals tab and asked to "break by vendor", "add vendor
rows", "show vendors under each account", or similar. The active tab name
typically contains "Actuals".

## When NOT to use

- User wants a standalone vendor pivot tab → use Layout F (`vendor-view.md`).
- No existing actuals tab is open → offer Layout F instead.

---

## Vendor data source

Use `<VENDOR_ACTUALS>` loaded at Gate 5 (from `vendor-actuals.md`). If it is
not yet in context (Gate 5 was skipped for this layout path), run the vendor
actuals query now using `<ENTITY_NAME>`, `<PERIOD_START>`, `<PERIOD_END>`.

---

## Layout spec

### Structure (per account)

```
  Account row (bold, subtotal formula)      ← was the data row; now a SUM of vendor children
    Vendor row 1 (indented, data)
    Vendor row 2 (indented, data)
    Vendor row N — No vendor last (indented, data)
```

- **Account row** — label unchanged (e.g. `Taxes (7070)`). Values become
  `=SUM(<col><first_vendor_row>:<col><last_vendor_row>)` per column — same column only,
  never a running left-to-right range. Bold.
- **Vendor rows** — label indented four spaces: `    <vendor_name>`. Hardcoded
  monthly amounts from `<VENDOR_ACTUALS>`; blank for future months; `0` for past
  months with no activity. Annual total `=SUM(B<row>:M<row>)`. Plain format.
- **Vendor order:** named vendors alphabetically, `No vendor` always last.
- **Collapsible grouping:** apply `group(Excel.GroupOption.byRows)` to each
  vendor row (detected by the four-space indent in column A) unless `<VENDOR_GROUPING>` is `none`.
  After grouping, call `sheet.showOutlineLevels(1, undefined)` when `collapsed`,
  `sheet.showOutlineLevels(2, undefined)` when `expanded`, or skip `showOutlineLevels` for `none`.

### Section totals and NOI

Rebuild `Total Income`, `Total Expenses`, and `Net Operating Income` rows using
the account subtotal rows as inputs — not the individual vendor rows:

```javascript
// Total Income: sum across all income account subtotal rows
=<col><acct_row_1>+<col><acct_row_2>+...

// Total Expenses: same pattern for expense account subtotal rows

// Net Operating Income
=<col><total_income_row>-<col><total_expenses_row>
```

---

## Write sequence (excel-addin runtime)

### Step 1 — Read the existing tab

Before clearing anything, read the full used range to capture:
- Section headers (INCOME, EXPENSES) and their row numbers
- Account labels and current row positions
- Column count (months + Total)

### Step 2 — Clear and rebuild (rows 7+, keep header band rows 1–5)

Clear rows 7 onward. Rebuild section-by-section using the account order from
Step 1, inserting vendor rows under each account from `<VENDOR_ACTUALS>`.

```javascript
// Clear data section only — never touch rows 1–6
const clearRange = sheet.getUsedRange();
clearRange.load(["rowIndex", "rowCount"]);
await context.sync();
const lastUsedRow = clearRange.rowIndex + clearRange.rowCount;
sheet.getRange(`7:${lastUsedRow}`).clear(Excel.ClearApplyTo.all);
await context.sync();
```

### Step 3 — Apply format

Use the locale-specific currency token — `[$$-en-US]` for USD (use matching token for other currencies). Never use bare `$`, `_($*`, or quoted `"$"` — Excel strips quotes from stored format strings, leaving a bare `$` that renders as the system currency.

```javascript
// USD (most common):
sheet.getRange(`B7:N${lastRow}`).numberFormat =
  Array(lastRow - 6).fill(Array(13).fill('<CCY_TOKEN>#,##0.00_);(<CCY_TOKEN>#,##0.00);"-"')); // <CCY_TOKEN>: [$$-en-US] USD | [$€-x-euro2] EUR | [$£-en-GB] GBP | [$CA$-en-CA] CAD
```

### Step 4 — Group vendor rows and collapse

```javascript
// Collect vendor rows — those with four leading spaces in column A
const usedRange = sheet.getUsedRange();
usedRange.load(["values", "rowIndex"]);
await context.sync();

const vendorRows = [];
for (let i = 0; i < usedRange.values.length; i++) {
  const cellVal = usedRange.values[i][0];
  if (typeof cellVal === "string" && cellVal.startsWith("    ")) {
    vendorRows.push(usedRange.rowIndex + i + 1); // 1-based row number
  }
}

// Group rows (skip entirely when <VENDOR_GROUPING> == "none")
if ("<VENDOR_GROUPING>" !== "none") {
  for (const rowNum of vendorRows) {
    sheet.getRange(`${rowNum}:${rowNum}`).group(Excel.GroupOption.byRows);
  }
  await context.sync();
  // collapsed → hide vendor rows on open; expanded → show all rows on open
  if ("<VENDOR_GROUPING>" === "collapsed") {
    sheet.showOutlineLevels(1, undefined);
  } else {
    sheet.showOutlineLevels(2, undefined);
  }
  await context.sync();
}
```

### Step 5 — Recalc + autofit

```javascript
context.application.calculationMode = Excel.CalculationMode.automatic;
context.workbook.application.calculate(Excel.CalculationType.full);
sheet.getRange("A:N").format.autofitColumns();
await context.sync();
```

---

## Writing the workbook (local-file runtime)

Use `write_cell`, `write_range`, `set_bold`, `set_format`, `merge_cells` (none
needed here), `set_column_width` ops via `write_workbook.py`. No `freeze_panes`.

---

## Inferred vendors (only when Gate 5.5 ran and was approved)

When `<INFERRED_VENDORS>` carries approved memo→vendor mappings, the amounts are
already folded into `<VENDOR_ACTUALS>` at Gate 5.5 Step 5 — an inferred amount
lands on the existing vendor sub-row under its account, or creates a new vendor
sub-row (four-space indent, alphabetical among named vendors). The only Layout G
addition is a **cell comment** on column A of each vendor sub-row that received
an inferred amount:

```javascript
sheet.comments.add("A<vendor_row>", "Includes <amount_with_currency> inferred from memo(s) — e.g. \"<sample_memo>\". Not vendor-tagged in the ledger.", "Plain");
await context.sync();
```

`<amount_with_currency>` MUST be formatted per the fund's resolved currency
(e.g. `1,240 EUR` / `1,240 USD`) — never a bare number and never a hardcoded `$`.

Comment only — no fill / font color / border. The residual `No vendor` sub-row
under any account (if entries stayed untagged) renders normally; if it emptied
out for an account, omit it there. Grouping (Step 4) still detects vendor rows by
the four-space indent, so inferred rows collapse/expand like any other.

---

## Approval gate (Gate 6)

Preview table before writing:

| Account | Vendors found | Total |
|---|---|---|
| Taxes (7070) | KY Dept of Revenue, CA FTB, No vendor | $X,XXX |
| … | … | … |

Summarise: "N accounts will have vendor rows inserted. Vendor detail rows will
be collapsed by default." If Gate 5.5 ran, add the inferred-vendor group
described in SKILL.md Gate 6.

---

## Summary (Gate 8)

> Rebuilt [<tab_name>](<citation:<tab_name>!A1>) with vendor rows nested under
> each account — N accounts, M vendor rows total. Vendor detail collapsed by
> default; click **+** on the left margin to expand any account.
