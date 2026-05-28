# Reference: build a budget from prior-year actuals

## Workflow

### 1. Discovery — one call

`fetch("dwh:list:tables")`. Identify the Carta DWH journal-entries table. Optionally `dwh:get:table_schema` once. **Don't probe other tables.**

### 2. Queries

Use the canonical SQL in [`../queries/chart-of-accounts.sql`](../queries/chart-of-accounts.sql) and [`../queries/prior-year-monthly-activity.sql`](../queries/prior-year-monthly-activity.sql). Substitute `<entity_name>`, `<prior_year>`, `<lookback_start_year>` before calling `fetch("dwh:execute:query", {"sql": "…"})`.

- **q1 chart of accounts** (wide window) — distinct GL codes (`ACCOUNT_TYPE`) + names (`ACCOUNT_NAME`) that posted activity in lookback.
- **q2 monthly activity** (narrow window) — sum of signed amounts grouped by `(ACCOUNT_TYPE, MONTH)` for the prior year.
- **q3 mgmt-fee schedule** — optional, fund entities only.

### 3. Section mapping (by leading GL digit)

| Prefix | Section |
|---|---|
| `4xxx` | Income |
| `5xxx` / `6xxx` / `7xxx` | Expenses |
| `1xxx` | Investments / Other |

Order: **Income → Expenses → Investments → Other → Net Operating Income**.

### 4. Proposed amount per (account, month) — first match wins

1. q3 mgmt-fee schedule if present and account is a mgmt-fee account.
2. q2 prior-year actual for the same calendar month.
3. Zero default.

### 4a. Sparse-history confidence flag

For each account, count distinct months with non-zero activity. If **< 6**, mark Source = `low-confidence — sparse history`. The flag surfaces in:
- Gate 5 preview (Source column + count callout above the table).
- Written workbook — cell comment on the column-B label cell (NOT fill/color/border). Body: *"Less than 6 months of activity in `<prior_year>`. Best-effort projection — review before locking the budget."*

Rows still get a proposed value (zero if no months matched).

### 5. Layout — two tabs

**Tab 1: `Budget FY<budget_year>` (primary).** 4-row header band per [`branding-and-header.md`](branding-and-header.md) (B1 firm / B2 `<year> Budget (based on <prior_year> actuals)` / B3 source / B4 `Amounts in USD`). Row 6 column headers: `Account | Jan <year> | Feb <year> | … | Dec <year> | <year> Total`. Bold, white-on-black.

Data rows:
- Bold + underlined section header row per section.
- One row per GL account, sorted by `gl_code`. Label = `account_name`.
- Budget values = **hardcoded numbers** (= prior-year actual for that month). No buffer-% multiplier.
- Section subtotal row: bold, top thin border, `=SUM(<section_range>)` per column.
- Annual total column per line: `=SUM(B<row>:M<row>)`.

Bottom rows:
- `Total Income` — bold, top thin border, `=SUM(<income subtotals>)`.
- (blank)
- `Total Expenses` — bold, top thin / bottom medium, `=SUM(<expense subtotals>)`.
- (blank)
- `Net Operating Income` — bold, top thin / bottom medium, `=<Total Income> - <Total Expenses>` per column. `numFmt="@"` on the label if it has a slash.

**Do not** freeze panes. **Do not** hide a GL-code column. **Do not** add a buffer-% cell.

**Tab 2: `<prior_year> Actuals` (reference, same shape).** Same 4-row header band (B2 = `<prior_year> Actuals (source data)`). Same section blocks, same accounts. Values = hardcoded prior-year actuals from the DWH.

### 6. Number format & column widths

Currency: `_([$$-en-US]* #,##0.00_);_([$$-en-US]* (#,##0.00);_([$$-en-US]* "-"??_);_(@_)`. Never a bare `$`. Percent (if used): `0.0%;(0.0%)`.

Column widths: column A = 12 (spacer), B = 30 (account labels), C:O = autofit. **Anti-pattern:** `autofitColumns()` on a header-only range. Use `sh.getUsedRange().format.autofitColumns()` after data is written, or target `C7:N80`.

If using `set_column_width` in local-file mode, set monthly columns to min 14pt before autofit so sparse tabs don't render `####`.
