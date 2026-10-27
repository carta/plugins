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
  - mcp__carta__read_tool
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - Bash(sleep 5)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_processor.py" *)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting-excel/scripts/excel_exporter.py" *)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.101.3</carta-plugin>

# Excel Export

**Context expected from the calling skill (must be in session before this skill is invoked):**
- `user_report_pk` — needed to check for the cached report file and to fetch a fresh download URL if the file is absent
- `corporation_id` — needed for `read_tool({"name": "reporting__get__download_url", ...})`
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

**No scope context on this path.** Entering fresh from the prompt bar, this skill cannot know
whether the account is share-class-scoped, so it cannot label a percentage column for the scope or
name the in-scope classes — the same limitation as `label_overrides`. The numbers are correct and
already scoped; only the labelling is generic. Do not describe any total as company-wide.

## Column source (Claude Code)

Use the column list confirmed during the Customization Checkpoint (resolved in `carta-reporting-markdown`).

## Running the export

Hand the user the generated `.xlsx` file itself. Never give them a Carta web link to the report: it makes them sign in to Carta. If the file cannot be delivered, the presigned `download_url` works without signing in but expires, so say so.


Check if `carta-reporting/carta_report_<user_report_pk>.json` is available (use `user_report_pk` from this session):
- **File ready** → pass it as `"local_file"` to `report_processor.py`.
- **Not ready** → call `read_tool({"name": "reporting__get__report_status", "arguments": { user_report_pk }})` first (no `corporation_id`). Only when it is `complete`, call `read_tool({"name": "reporting__get__download_url", "arguments": { user_report_pk, corporation_id }})` to get a fresh presigned URL and pass it as `"download_url"` instead. While it is `pending`, poll every 5 s up to 20 attempts. On `error` or `failed`, tell the user the report failed. On `not_found` or a timeout, say the report is not available and offer to regenerate it. If `download_url` itself returns `not_found`, check `report_status` once more: if `complete`, call `download_url` once more; if `pending`, resume polling within the attempts left. Never call `download_url` more than twice; if the second call fails, say the report is not available and offer to regenerate it. Never give the user the `url` that `report_status` returns: it is a Carta web page that needs a sign-in.

**Always run `report_processor.py` then `excel_exporter.py`, regardless of data size or complexity.** Never write Excel files directly with openpyxl or any other library — the scripts handle Carta branding (logo, header, fonts, number formats) that will be missing from any ad-hoc implementation. This applies even when the dataset is small (e.g. 3 rows) or when sheets need to be combined.

For combining sheets into one tab, use `merge_sheets` in the `report_processor.py` call.

Pass all sheets in one run using the `sheets` dict. Two commands, each run on its own, on one line: a heredoc, a pipe or a chained command needs approval every time. Never search for the scripts.

1. `Write` `carta-reporting/config.json` (in the working directory) with the config:

```json
{
  "local_file": "<path or use download_url if file not ready>",
  "sheets": {
    "Equity Grants":    {"columns": ["Grant ID", "Award Type", "Exercise Price"],
                         "aggregations": {"type": "summary", "columns": {"Exercise Price": "sum"}}},
    "Vesting Schedule": {"columns": ["Grant ID", "Vest Date", "Shares Vested"],
                         "sort": [{"column": "Vest Date", "direction": "asc"}]}
  }
}
```

2. Process it into `carta-reporting/result.json`:

```bash
UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_processor.py" --config "carta-reporting/config.json" --out "carta-reporting/result.json"
```

3. Check `carta-reporting/result.json` before exporting: if its `warnings` is non-empty, or any sheet's `stats` has `schema_warnings`, tell the user which sheet was left out and why (wording: the `warnings.*` rows of the Error Handling table in `carta-reporting`), then export what is there. Never present a workbook with a missing sheet or merged rows as complete.

4. Export the workbook:

```bash
UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting-excel/scripts/excel_exporter.py" --input "carta-reporting/result.json" --title "Securities Ledger Report" --as-of-date "2024-01-15" --generated-by "Jane Doe" --output "./{report-slug}.xlsx"
```

`excel_exporter.py` prints the absolute output path on success. Present it as a clickable link: `computer://<absolute-path>` (e.g. `computer:///Users/jane/meetly-equity-grants.xlsx`). Tell the user their file is ready to open, then offer next steps:

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
