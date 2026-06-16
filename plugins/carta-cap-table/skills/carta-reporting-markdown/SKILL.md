---
name: carta-reporting-markdown
description: >-
  Internal subskill for carta-reporting. Drives the full Claude Code interaction:
  schema preview, customization checkpoint, transform config (filtering, sorting,
  formulas, aggregations), output preview, and hand-off to carta-reporting-excel.
  Invoked by carta-reporting (Claude Code path) after the preview file lands.
  Not for direct user invocation.
model: sonnet
allowed-tools:
  - AskUserQuestion
  - Bash(find * -name "report_processor.py"*)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run*)
  - Skill(carta-cap-table:carta-reporting-excel)
---

# Transform Configuration

Called from `carta-reporting` step 4d (Claude Code / MARKDOWN path). Use values resolved earlier in this session: data file path, `corporation_id`, `user_report_pk`.

## Schema Preview

Run `report_processor.py` on the data file with no transforms to extract column names and types:

```bash
UV_PYTHON_DOWNLOADS=never uv run "$(find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1)" <<'EOF'
{
  "local_file": "<preview or full report file path>"
}
EOF
```

Lead with a brief result summary (e.g. "Here's your Securities Ledger report — loading full data in the background."), then present the column inventory.

**Column inventory format** — numbered list, grouped by category. Example for a 28-column report:

```
**All 28 columns:**

Identity
  1 — Stakeholder Name (text)    2 — Grant ID (text)    3 — Equity Plan (text)

Grant details
  4 — Grant Date (date)    5 — Grant Type (text)    6 — Exercise Price (money)
  7 — Expiration Date (date)

Share counts
  8 — Shares Issued (integer)    9 — Shares Vested (integer)
 10 — Shares Unvested (integer)   11 — Shares Cancelled (integer)
...
```

Grouping heuristics (apply in order; unmatched → "Other"):
- **Identity**: names contain Stakeholder, Name, ID, Email, Type, Plan, Grant
- **Dates**: type = `date`
- **Share counts**: type = `integer`, name contains Share, Quantity, Count, Units
- **Money**: type = `money`
- **Percentages**: type = `percentage`

---

## Customization Checkpoint

One `AskUserQuestion` covering columns, filters, sort, and format. Content adapts based on what the original prompt already specified.

**When the prompt specified details:**

> Here's what I'll apply based on your request:
> - **Columns:** Stakeholder Name, Grant Date, Shares Issued, Vested %
> - **Filter:** Vested % > 50%
> - **Sort:** Grant Date descending
>
> Reply **Continue with these settings** to proceed, or adjust anything. You can also add: formula columns (% of total, running sum, ratio, delta), or aggregations (totals row, group-by).

**When the prompt was vague:**

> What would you like to customize? Reply **all columns, no filters** to get the full dataset as-is, or specify any of:
> - **Columns** — which to include
> - **Filters** — e.g. "Vested % > 50", "Grant Date after 2024-01-01", "Name contains Smith"
> - **Sort** — e.g. "Grant Date newest first", "Shares Issued descending"
> - **Formulas** — % of total, running sum, ratio (A ÷ B), delta (row-over-row change)
> - **Aggregations** — totals row or group-by rollup

### Column name validation

Before building the config, check every column name and filter target the user mentioned against the actual column names from the schema preview. The user's terminology often differs from the report's column names (e.g. "Department" → "Cost Center", "Employee" → "Stakeholder Name", "Vest %" → "Vested %").

**Matching rules (apply in order):**
1. Case-insensitive exact match → use it silently.
2. One actual column name contains the user's term, or the user's term contains an actual column name (e.g. "vest percentage" ↔ "Vested %") → use it silently.
3. No confident match → flag it in the checkpoint question.

**When a term can't be matched**, surface it in the checkpoint with candidates:

> ⚠ **"Department"** wasn't found in this report. Closest text columns: **Cost Center**, **Equity Plan**, **Grant Type**. Which did you mean, or should I skip this filter?

Show at most 3 candidates, ranked by edit distance / word overlap. If the unmatched term was a filter target, do not add it to the config until the user resolves it.

Apply this check to: explicit column selections, filter column names, sort column names, and formula source columns.

### Column selection for wide reports (> 10 columns)

Always pre-select key identifier columns (Stakeholder Name, Grant ID, or equivalent) plus any columns explicitly named in the prompt. State what's pre-selected in the checkpoint:

> **Columns pre-selected:** 1 — Stakeholder Name, 2 — Grant ID, 6 — Exercise Price
> Reply **all** for all 28 columns, add by number (e.g. **+8, 12, 13**), enter a keyword to filter (e.g. **vesting**), or confirm the pre-selection with **yes**.

If the user replies with a keyword, call `AskUserQuestion` once more showing only matching columns and ask them to confirm or add more by number. This is the only case where a second checkpoint question is allowed.

---

## Filtering Rules

All filtering is handled by `report_processor.py` — do not apply filters in Claude's memory.

Translate user requests to filter objects:

| User request | Filter object |
|---|---|
| "vested % > 50" | `{"column": "Vested %", "op": ">", "value": 0.5}` |
| "grant date after 2024-01-01" | `{"column": "Grant Date", "op": ">", "value": "2024-01-01"}` |
| "name contains Smith" | `{"column": "Stakeholder Name", "op": "contains", "value": "Smith"}` |
| "ownership above 5%" | `{"column": "Fully Diluted %", "op": ">", "value": 0.05}` |

Supported ops: `>` `<` `>=` `<=` `=` `!=` `contains`

Pass percentage values as decimals when the column type is `percentage` (e.g. 50% → `0.5`).

When a filter removes all rows from a sheet, the script returns 0 rows — skip that sheet and note it in the summary.

---

## Column Selection

All column selection is handled by `report_processor.py`. Pass column names in the desired display order; the script preserves that order.

Always include key identifier columns (Stakeholder Name, Grant ID, or equivalent) even if the user didn't explicitly request them.

---

## Sorting

Translate user requests to sort objects:

| User request | Sort object |
|---|---|
| "newest first" | `{"column": "Grant Date", "direction": "desc"}` |
| "largest first" | `{"column": "Shares Issued", "direction": "desc"}` |
| "alphabetical" | `{"column": "Stakeholder Name", "direction": "asc"}` |

Multi-key: pass multiple objects in priority order (first = primary sort key).

---

## Formula Columns

Formula computation is handled by `report_processor.py`. Formulas are applied after column selection — they can only reference columns that are included in the output.

### Scope boundary

Formulas are for **mechanical transforms** on values already present in the report data — arithmetic that any spreadsheet could do without knowing anything about equity rules. The four supported ops:

| Op | Description | Required fields |
|---|---|---|
| `pct_of_total` | Each row as % of the column's grand total | `column` |
| `running_sum` | Cumulative total down the column (current sort order) | `column` |
| `ratio` | numerator ÷ denominator | `numerator`, `denominator` |
| `delta` | Row-over-row difference (current sort order) | `column` |

If a user asks for a value that requires understanding cap structure, equity rights, or ownership math, **direct them to the Carta report that already contains it**:

> "That calculation involves equity rules that I can't safely compute from the raw data. Carta's **[Report Name]** report already has it — want me to pull that one instead?"

Example:
```json
[
  {"name": "% of Total Shares", "op": "pct_of_total", "column": "Shares Issued"},
  {"name": "Cumulative Shares",  "op": "running_sum",  "column": "Shares Issued"}
]
```

---

## Aggregations

Aggregation is handled by `report_processor.py`.

**Summary row** — appends one totals row at the bottom; first column reads "Total":
```json
{"type": "summary", "columns": {"Shares Issued": "sum", "Vested %": "avg"}}
```

**Group-by** — collapses rows by a key column, one row per unique value:
```json
{"type": "group_by", "group_by": "Stakeholder Name",
 "columns": {"Shares Issued": "sum", "Grant Count": "count"}}
```

Supported ops: `sum` `avg` `min` `max` `count`

---

## Script: report_processor.py

See **Script Reference** in `carta-reporting` for the full API (all fields, multi-sheet, merge, output format).

Always check `stats` after running:
- `missing_columns` non-empty → list available column names from `data[sheet].columns` and ask the user which they meant, then re-run with the corrected name
- `skipped_formulas` non-empty → tell the user which formulas couldn't run (usually the source column wasn't included in the selection)
- `filtered_row_count` = 0 → no rows matched; offer to relax the filter or change `as_of_date`
- `displayed_row_count` < `filtered_row_count` → preview is active; re-run without `preview` for full results

---

## Output Preview

After the Customization Checkpoint, check if `/tmp/carta_report_<user_report_pk>.json` exists. If ready, use it as `local_file`. If not, poll every 5 s up to 5 more attempts.

Run the script with `"preview": 5`:

```bash
UV_PYTHON_DOWNLOADS=never uv run "$(find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1)" <<'EOF'
{
  "local_file": "<path>",
  "columns": [...],
  "filters": [...],
  "sort": [...],
  "preview": 5
}
EOF
```

Show first 5 rows of each processed sheet as a markdown table. Above each table write: `N of M rows matched · K columns`.

Ask:

> Does this look right?
> 1. **Generate full report** — all rows as a markdown table
> 2. **Excel** — download as .xlsx
> 3. Describe any change to filters, columns, or sorting — I'll update just that field and re-run the preview without restarting the whole checkpoint.

If the user requests a change, update only the affected config field and re-run the preview — do not restart the customization checkpoint.

If the user chooses **Excel**, invoke `Skill(carta-cap-table:carta-reporting-excel)`.

---

## Presentation

- **One table per sheet** — label with the sheet name as a heading.
- **Summary line above each table** — e.g. "89 of 212 grants matched (Vested % > 50%)."
- **Money columns** — format as `$1,234.56`.
- **Percentage columns** — format as `12.34%` (script stores as decimal; multiply × 100 for display).
- **Date columns** — format as `MMM D, YYYY` (e.g. `May 3, 2026`) — the Carta brand standard.
- If multiple sheets are returned and only one has data after filtering, hide the empty sheets.
