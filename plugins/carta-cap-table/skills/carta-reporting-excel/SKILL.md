---
name: carta-reporting-excel
description: >-
  Internal subskill for carta-reporting. Exports Carta report data to a branded
  Excel file. Invoked by carta-reporting or carta-reporting-markdown when the user requests Excel output. Also the entry point
  when the main skill receives a message starting with "Generate Carta Excel —"
  (the artifact prompt bar payload).
model: sonnet
allowed-tools:
  - mcp__carta__call_tool
  - Bash(find * -name "report_processor.py"*)
  - Bash(find ~ -name "report_processor.py"*)
  - Bash(find * -name "excel_exporter.py"*)
  - Bash(find ~ -name "excel_exporter.py"*)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run*)
---

# Excel Export

**Context expected from the calling skill (must be in session before this skill is invoked):**
- `user_report_pk` — needed to check for the cached report file and to fetch a fresh download URL if the file is absent
- `corporation_id` — needed for `call_tool({"name": "reporting__get__download_url", ...})`
- Column config — either parsed from the artifact prompt bar payload (Claude Desktop) or confirmed during the Customization Checkpoint in `carta-reporting-markdown` (Claude Code)
- Corporation legal name, `as_of_date`, user full name — used as `--title`, `--as-of-date`, `--generated-by` args to `excel_exporter.py`

## Column source (Claude Desktop — artifact prompt bar)

When the user pastes an **artifact prompt bar payload**, it arrives as a complete instruction starting with `Generate Carta Excel —`:

```
Generate Carta Excel —
Corporation: Meetly, Inc. (ID: 7)
Columns:
  Equity Grants: columns: Grant ID, Award Type, Exercise Price; sorted by: Grant Date desc
  Vesting Schedule: columns: Grant ID, Vest Date, Shares Vested; totals: Shares Vested sum
```

Use the `Corporation:` line to confirm which company the export is for. Each indented line under `Columns:` is one sheet tab. This is always **one Excel file** with one tab per sheet. Parse each sheet line and pass all sheets to `report_processor.py` in a single run using the per-sheet `sheets` dict format. No further questions needed.

**The column list from the artifact is authoritative; do not merge with or override it from the earlier conversation.**

**Parsing segment fields into `report_processor.py` config:**

| Prompt bar field | `report_processor.py` per-sheet key |
|---|---|
| `columns: A, B, C` | `"columns": ["A", "B", "C"]` |
| `sorted by: Col asc` | `"sort": [{"column": "Col", "direction": "asc"}]` |
| `totals: Col sum, Col2 avg` | `"aggregations": {"type": "summary", "columns": {"Col": "sum", "Col2": "avg"}}` |

**`totals:` must become `aggregations`** — this is the only way Excel formulas (`=SUM(...)`, `=AVERAGE(...)`) are generated. If `aggregations` is omitted, any total rows in the output are hardcoded API values, not live formulas.

If the user asks for Excel without pasting a payload, ask: "Click the **Excel export** bar at the bottom of the artifact to select it, copy and paste it here — I'll generate the Excel with exactly those columns."

## Column source (Claude Code)

Use the column list confirmed during the Customization Checkpoint (resolved in `carta-reporting-markdown`).

## Running the export

Check if `/tmp/carta_report_<user_report_pk>.json` is available (use `user_report_pk` from this session):
- **File ready** → pass it as `"local_file"` to `report_processor.py`.
- **Not ready** → call `call_tool({"name": "reporting__get__download_url", "arguments": { user_report_pk, corporation_id }})` to get a fresh presigned URL and pass it as `"download_url"` instead.

**Always pipe through `report_processor.py` → `excel_exporter.py`, regardless of data size or complexity.** Never write Excel files directly with openpyxl or any other library — the scripts handle Carta branding (logo, header, fonts, number formats) that will be missing from any ad-hoc implementation. This applies even when the dataset is small (e.g. 3 rows) or when sheets need to be combined.

For combining sheets into one tab, use `merge_sheets` in the `report_processor.py` call.

Pass all sheets in one run using the `sheets` dict. Pipe into `excel_exporter.py`. Reuse the cached `_report_processor_path` if the parent session resolved it (it may be unset on the fresh `Generate Carta Excel —` prompt-bar path — the `find` fallback handles that):

```bash
UV_PYTHON_DOWNLOADS=never uv run "${_report_processor_path:-$(find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1)}" <<'EOF' | \
    UV_PYTHON_DOWNLOADS=never uv run "$(find ~ -name "excel_exporter.py" -path "*/carta-reporting-excel/scripts/*" 2>/dev/null | head -1)" \
        --title "Securities Ledger Report" \
        --as-of-date 2024-01-15 \
        --generated-by "Jane Doe" \
        --output ./{report-slug}.xlsx
{
  "local_file": "<path or use download_url if file not ready>",
  "sheets": {
    "Equity Grants":    {"columns": ["Grant ID", "Award Type", "Exercise Price"],
                         "aggregations": {"type": "summary", "columns": {"Exercise Price": "sum"}}},
    "Vesting Schedule": {"columns": ["Grant ID", "Vest Date", "Shares Vested"],
                         "sort": [{"column": "Vest Date", "direction": "asc"}]}
  }
}
EOF
```

The script prints the absolute output path on success. Present it as a clickable link: `computer://<absolute-path>` (e.g. `computer:///Users/jane/meetly-equity-grants.xlsx`). Tell the user their file is ready to open, then offer next steps:

- **Run another report** — for a different company or report type
- **Customize this export** — adjust filters, columns, or formulas
- **Change the date range or filters** — re-run with different parameters

## Carta Excel Formatting Conventions

| Element | Value |
|---|---|
| Header background | `#c6ebf4` |
| Header font | Arial 12pt bold, `#2f3943` |
| Logo | `<skill_base_dir>/assets/Carta_Logo.png`, cell A2, 120×50px |
| Title | Cell B2, Arial 16pt bold |
| Subtitle | Cell B3, Arial 10pt, `#666666` — `"As of MMM d, yyyy • Generated with Claude AI by {user} at MMM d, yyyy h:mm:ss AM/PM TZ • Date format: MMM D, YYYY"` |
| Header row | Row 5 with auto-filter; freeze panes at A6; data starts at row 6 |

Column type → number format: `money` → `$#,##0.00` · `percentage` → `0.00%` · `integer` → `#,##0` · `date` → `mmm d, yyyy` · `decimal` → `#,##0.0000`

Column widths: string/date → **35**, number types → **18**.
