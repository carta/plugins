# Shared reference: producing an Excel workbook outside Claude for Excel

Used by the consolidating-report skills (`carta-consolidating-pnl`,
`carta-consolidating-balance-sheet`, `carta-consolidating-trial-balance`). Each
one writes Excel output, and each runs on four surfaces. This file owns the
mechanics that don't differ between reports; the report keeps its own content and
layout rules.

## Why this file exists

These skills were written for the Claude for Excel add-in and originally spoke
only Office.js. On any other surface there is no add-in, no "active workbook"
tool, and no `execute_office_js` — so a report that only knows the add-in path
reaches its output step, finds nothing it can call, and stops. From the user's
side that looks like the skill ran and did nothing at all.

Run the runtime gate below **before** any query, so the failure surfaces as a
question rather than as silence.

## Runtime gate — set `<RUNTIME>` and `<TARGET_FILE>`

Set `<RUNTIME>`:

| Value | Surfaces | Signals |
|---|---|---|
| `excel-addin` | Claude for Excel | Excel add-in tools are available in the conversation; or the user refers to "this workbook", "the open spreadsheet", or a tab, with no file path. |
| `local-file` | Cowork, Claude desktop app, Claude Code | The user gave a file path, attached a file, or asked to "create a new file"; or no Excel add-in tools are available. |

If genuinely ambiguous, ask once via `AskUserQuestion`: *"Are you working in Excel
through Claude for Excel, or with a local .xlsx file?"* Don't guess — guessing
`excel-addin` on a local surface is the failure this gate exists to prevent.

**If `excel-addin`:** set `<TARGET_FILE> = null` and use the report's own
open-workbook destination matrix (no workbook / empty workbook / non-empty
workbook). Nothing else here applies.

**If `local-file`:** resolve `<TARGET_FILE>`:

1. **User attached a spreadsheet or named a path** → set `<TARGET_FILE>` to it and
   confirm it exists:
   ```bash
   test -f "<TARGET_FILE>" && echo exists || echo missing
   ```
   If missing, say so and ask for the correct path. Do **not** silently create a
   new file at that name — the user believes they have a workbook there.
2. **Nothing attached** → set `<TARGET_FILE> = null` and say this once, before any
   query runs:

   > No spreadsheet attached, so I'll build this as a new `.xlsx` file and give
   > you the path when it's done. If you'd rather I add these tabs to an existing
   > workbook, attach it or give me the file path.

   Don't stop for an answer — proceed. The user can redirect.

State this up front rather than at the end. A user who wanted tabs added to their
existing model does not want to discover a stray new file after the build.

## Destination — `local-file` runtime

### `<TARGET_FILE>` is set

1. Read the existing sheets and their column-B content:
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" "<TARGET_FILE>"
   ```
2. Run the report's own **COA label detection** against this output instead of
   Office.js reads: a sheet is a **COA-label match** if ≥ 5 account labels from
   the report's dataset appear in its column B. An **exact-name match** is a sheet
   whose name equals the report's proposed tab name.
3. Ask via `AskUserQuestion`, mirroring the add-in branch:
   - match found → *"Update the existing `<matched_sheet>` tab"* (recommended) /
     *"Create new tabs instead"* / *"Cancel"*
   - no match → *"May I add `<proposed tabs>` to `<TARGET_FILE>`?"* → *"Add the
     tabs"* / *"Write to a new file instead"* / *"Cancel"*
4. On a name collision when creating new tabs, append a numeric suffix
   (`… (2)`) and truncate to Excel's 31-character limit **after** suffixing.

### `<TARGET_FILE>` is null

Write a new workbook named after the report, sanitized for the filesystem (no
`/`, no `&`). Put it in the user's working directory unless they named somewhere
else. Do **not** ask which directory — the notice above already said a new file is
coming, and the report's closing summary gives the resolved path.

No separate create step is needed: `write_workbook.py` creates the file when the
payload sets `"create_if_missing": true`.

## Writing — the payload, not Office.js

Build the operations payload as JSON, then apply it in one call:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py" <payload_json_path>
```

The payload shape and the full operation list are documented in the script's own
header — read it rather than guessing op names.

Translate the report's Office.js instructions into operations. Keep every
content decision (column map, number formats, section order, formulas, header
text) exactly as the report specifies:

| Office.js instruction (`excel-addin`) | `local-file` equivalent |
|---|---|
| `execute_office_js` with `setValues` | `write_range` / `write_cell` |
| Formula assignment | `write_formula`, or `fill_formula_horizontal` / `fill_formula_vertical` to translate across a row or down a column |
| `range.merge(true)` for header bands | `merge_cells` |
| `numberFormat` assignment | `set_format` |
| Bold font | `set_bold` |
| Column widths | `autofit_columns` (preferred) or `set_column_width` |
| Shape insertion for the Carta logo | `add_image`, anchored at the cell the report's branding reference names and sized to the same row band |
| New tab | `create_sheet` (honour the report's `position`) |
| Cell comment | `set_comment` |
| Borders (`style = "Continuous"`, `weight = "Thin"`) | **not supported** — omit borders in this runtime |
| Three separate `execute_office_js` calls | one payload; the multi-call split is an add-in requirement only |

**Number-format strings are identical across runtimes.** Paste the same
locale-specific currency token (`[$$-en-US]` USD, `[$€-x-euro2]` EUR,
`[$£-en-GB]` GBP, `[$CA$-en-CA]` CAD) and never a bare `$` or `_($*` — Excel
substitutes the system symbol otherwise.

**Borders are the one real capability gap.** Where a report uses borders to carry
meaning — a subtotal underline, `Net Income`'s double bottom border — bold and
spacing still land, so the sheet is correct and readable, just visually plainer.
Don't fake borders with underscore characters, and don't skip the report's
verification step because borders are absent.

## Verification — `local-file` runtime

Where the report requires an Office.js readback, re-read the written file
instead:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" "<written_path>"
```

Confirm, at minimum:

- every expected sheet exists, with the expected name and position
- the currency number format on the amount range contains a `[$…-…]` locale
  token
- the logo image is present, if the report brands its output
- the report's own tie-out figures match what it computed

A write that returned success is not proof the content is right — the readback is
what closes the report's verification gate.

## Closing summary — `local-file` runtime

`<citation:Sheet!Range>` links do not resolve outside Claude for Excel. Give the
real path and name the tabs:

> The report is ready at `/Users/you/Acme-Financials.xlsx` — two new tabs,
> `Summary P&L` and `P&L - Acme Jan-Jun 26`. Open it in Excel to review.

Rules:

- State the **absolute** path, never a relative one.
- Say plainly whether you created the file or added tabs to an existing one.
- Never emit a `<citation:…>` link in this runtime.
- If borders were omitted, don't mention it unless the user asks about
  formatting — it's a rendering detail, not a data caveat.
