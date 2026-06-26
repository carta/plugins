# Reference: add a peer `<year> Actuals` tab (Layout B)

Adds `<year> Actuals` alongside the existing `Budget FY<year>` — mirrors the `<prior_year> Actuals` tab from `carta-create-budget`. Budget tab untouched.

## When to use

User picked Layout B in `add-actuals` Gate 2. Triggers: "add separate `<year> Actuals` tab", "track this year's actuals on its own tab", or keeping Budget clean for pacing via `carta-budget-analysis`.

## When NOT to use

- Interleaved B/A/V per month → [`add-actuals-columns.md`](add-actuals-columns.md).
- Cells exist, just stale → [`refresh-existing.md`](refresh-existing.md).
- Only next single month → [`add-period.md`](add-period.md).

## Workflow

### 1. Read existing structure

`excel-addin`: add-in's read tools. `local-file`: `uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" "<PATH>"`.

Capture row labels + section headers from `Budget FY<year>`. If a `<prior_year> Actuals` tab exists, use its layout as template; else fall back to Budget tab layout.

### 2. Pull actuals

Via [`get-actuals.md`](get-actuals.md). `<period_start>` = first day of year. `<period_end>` = today / last completed month (ask).

### 3. Match accounts

Name first, GL code tiebreaker.
- **Matched** → go into new tab.
- **DWH-only** → activity but no Budget row. Surface in preview, ask whether to include (default yes — Actuals should be complete).

### 4. Build new tab payload

Tab name: `<year> Actuals`. Position: immediately after Budget tab.

Header rows: A1 firm / A2 `<year> Actuals` / A4 `Amounts in <resolved_currency>` (see [`branding-and-header.md`](branding-and-header.md) for full 4-row band, column-A override).

Row 6 column headers: `Account | Jan <year> | … | Dec <year> | <year> Total`. Bold, white-on-black.

**Header text format trap:** before writing month labels ("Jan 2026", "Dec 2026") to row 6, apply `numberFormat = [["@"]]` (text format) to the range B6:M6 first, then write the values. Without this, Excel coerces "Jan 2026" → date serial 46023.

Data rows:
- Same section order as Budget tab.
- One row per matched account, sorted by `gl_code`.
- Actual = hardcoded from `get-actuals.md`. `0` for no activity; **blank** for future months.
- Annual total: `=SUM(B<row>:M<row>)`.
- Subtotal per section: bold, top thin border. **Formula per column: `=SUM(<col><first_row>:<col><last_row>)` — same column only.** Never expand the range leftward from B: column C subtotal must be `=SUM(C<first>:C<last>)`, not `=SUM(B<first>:C<last>)`. The running-range trap produces cumulative totals instead of per-column sums.

Bottom rows: `Total Income` / blank / `Total Expenses` / blank / `Net Operating Income` (= Income - Expenses), per column. Use `=<col><income_subtotal_row>` and `=<col><expense_subtotal_row>` (not new SUM ranges) so the summary rows trace directly to their section subtotals.

**Formatting:** locale-specific currency token — `[$$-en-US]#,##0.00_);([$$-en-US]#,##0.00);"-"` for USD (use matching token for other currencies). Never use bare `$`, `_($*`, or quoted `"$"` — Excel strips quotes from stored format strings, leaving a bare `$` that renders as the system currency. State currency in cell A4: `Amounts in <resolved_currency>`. No freeze panes. `autofit_columns` on B:N (fixed widths < 16pt show `####`). Column A fixed ~30.

### 5. Approval gate

Preview: Section | Line | Jan | Feb | … | YTD Total. Plus count: "N line items × M months filled; future months left blank." Surface DWH-only accounts separately if any.

### 6. Write

Don't touch the Budget tab. Only `create_sheet` + `write_*` on the new `<year> Actuals` tab.

### 7. Summary

> "Added `<year> Actuals` alongside `Budget FY<year>` and `<prior_year> Actuals`. Jan through `<last month>` populated; future months left blank. N DWH-only accounts included (or held back)."

Parent SKILL.md handles post-action menu — `carta-budget-analysis` will now compare Budget vs `<year> Actuals` directly.
