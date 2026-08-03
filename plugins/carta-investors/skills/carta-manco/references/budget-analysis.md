# Budget analysis capability (pacing / budget vs actuals)

Pacing and variance analysis on top of an existing budget. Two sub-references:

- [`pacing-overview.md`](pacing-overview.md) — sheet-wide pacing & variance.
- [`drill-down-line.md`](drill-down-line.md) — month-by-month + top journal entries for one line.

Gates 0, 0.5, and the Router Gate ran in SKILL.md. This file picks up at Step 1.

**Telemetry:** on entry, set `<CAPABILITY> = budget-analysis`. Every MCP call in this flow tags `_instrumentation.skills = ["carta-manco", "<CAPABILITY>"]`. Re-fire the beacon (`set_context(firm_id=<ENTITY_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco", "budget-analysis"]})`) if you arrived here via a next-step menu rather than the Router Gate.

---

## Step 1 — Where to write the analysis

Branches by `<RUNTIME>`.

**If `<RUNTIME>` is `excel-addin`:**

**Empty-workbook shortcut**: if the active workbook has one sheet, `maxRows == 0`, no other tabs, skip the chooser. Announce the rename in one sentence and proceed (unless user asked for chat-only output).

> Where should I write the analysis?

- **"Update the open workbook — new tab `Budget vs Actuals`"** (recommended).
- **"Update the open workbook — alongside the existing budget tab"** (adds columns).
- **"Just summarize in chat — don't write to the sheet"**.

**If `<RUNTIME>` is `local-file`:**

> Where should the analysis go?

- **"Add a `Budget vs Actuals` sheet to the same file"** (recommended).
- **"Write a separate `<budget>-vs-actuals.xlsx` file alongside the original"**.
- **"Just summarize in chat — don't write anything"**.

The "chat-only" option matters for the drill-down case where the user just wants a quick answer.

---

## Step 2 — Intent routing

**Call `read_skill` for the matched reference immediately — do not reconstruct the analysis spec from memory:**

| Phrase | Call |
|---|---|
| "compare", "pacing", "on track", "variance", "how are we doing" | `read_skill(file_path="references/pacing-overview.md")` |
| "why are we over on <X>", "drill into <X>", "what drove <X>", "largest entries", "which months", "what's behind" | `read_skill(file_path="references/drill-down-line.md")` |

---

## Step 3 — Read the budget from the workbook

**If `<RUNTIME>` is `excel-addin`:** use the add-in's read tools.

**If `<RUNTIME>` is `local-file`:**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" "<BUDGET_PATH>" --sheet "<BUDGET_SHEET>"
```

In both modes: identify the budget tab (ask if ambiguous), parse line items, sections, and the budget column(s). Identify any existing YTD column so the analysis can fill it rather than duplicate.

---

## Step 4 — Pull YTD actuals

Use [`references/get-actuals.md`](get-actuals.md) as the canonical source. `<period_start>` = first day of budget year, `<period_end>` = today (or last completed month — ask).

In parallel, call `read_skill(file_path="references/vendor-actuals.md")` and run the vendor actuals query with the same period bounds — loads `<VENDOR_ACTUALS>` into session context.

---

## Step 5 — Compute pacing metrics

For each line:

- `actual_ytd` = sum of monthly actuals to date.
- `budget_ytd` = sum of monthly budget through same period.
- `% of annual consumed` = `actual_ytd / annual_budget`.
- `% of year elapsed` = `months_elapsed / 12` — single source of truth.
- `projected run-rate` = `actual_ytd / months_elapsed * 12`.
- `pacing flag` =
  - `OK` if within ±10% of expected pace,
  - `Over` if >10% above pace,
  - `Under` if >10% below pace,
  - `New activity, no budget` if `actual_ytd > 0` and `annual_budget = 0`.

---

## Step 6 — Pre-build review (approval gate, only if writing cells)

Render two preview tables — overview (≤6 cols) and pacing detail. Splitting keeps each table scannable.

**Overview:**

| Section | Line Item | Annual Budget | YTD Actual | % Consumed | Flag |
|---|---|---|---|---|---|

**Pacing detail** (one row per flagged line — drop the OK rows):

| Line Item | YTD Budget | Variance | Run-Rate | Projected Year-End |
|---|---|---|---|---|

Output the preview tables above as a normal conversation message. Then call `AskUserQuestion` immediately after:

- `question`: `"Approve writing this analysis?"`
- `header`: `"Approval"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Approve and write the analysis"` / `description`: `"Writes the pacing analysis to a new tab. ← recommended"`
  2. `label`: `"Edit — change the period end, scope, or threshold"`
  3. `label`: `"Cancel"`

Wait for OK before writing. Skipped entirely in chat-only mode.

**Hard rule: no workbook-write tool runs before this step's `AskUserQuestion` returns the user's explicit "Approve and write the analysis" choice.**

---

## Step 7 — Write and brand the tabs (skipped in chat-only mode)

### Approval-recorded check (run FIRST)

Before calling any workbook-write tool, confirm the most recent `AskUserQuestion` answer literally includes `"Approve and write the analysis"`.

### Step 7 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

- **Call 1:** cell values, formulas, formatting, conditional formats.
- **Call 2 (per tab touched):** logo via the verbatim brand block from `branding-and-header.md`.
- **Call N (verification, LAST):** load shape names + currency format on every tab touched.

**Before any write**, call both in the same message (parallel reads):
1. `read_skill(file_path="references/branding-and-header.md")`
2. `read_skill(file_path="references/<reference-from-step-2>.md")`

Do not reconstruct either spec from memory.

**If `<RUNTIME>` is `local-file`:**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py" --stdin <<'JSON'
{
  "workbook_path": "<DESTINATION>",
  "operations": [ ... ]
}
JSON
```

Include `add_image` (one per new tab) and `set_comment` ops in the same payload.

All numerical columns should be live formulas where possible.

### Branding verification (REQUIRED, observable, excel-addin only)

After running the brand block for every tab touched, run this verification as a **separate** `execute_office_js` call:

```javascript
const tabs = [/* substitute actual tab names touched this run */];
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name");
  const cell = sheet.getRange("<sample_amount_cell>");
  cell.load("numberFormat");
  await context.sync();
  result[tabName] = {
    shapes:      sheet.shapes.items.map(s => s.name),
    logoFound:   sheet.shapes.items.some(s => s.name === "CartaLogo"),
    numberFormat: cell.numberFormat[0][0],
    currencyOk:  cell.numberFormat[0][0].includes("[$"),
  };
}
return result;
```

Per-tab pass criteria — ALL must be true: `logoFound === true`, `currencyOk === true`.

**Do not start Step 8 summary text until every tab passes both criteria.**

**`Range.getImage()` is forbidden.** The shape name check IS the verification.

---

## Step 8 — Summary + next steps

**Step 8 precondition (DO NOT SKIP, non-chat-only modes).** Confirm three anchors in your tool history:
1. An `AskUserQuestion` whose answer included `"Approve and write the analysis"` — Step 6 approval.
2. A `sheet.shapes.addImage(base64)` call for **each** tab touched — Step 7 branding.
3. The branding-verification showing `logoFound: true` and `currencyOk: true` on every tab — Step 7 verification.

Chat-only mode skips all three — the summary IS the deliverable.

**excel-addin:** > Pacing summary: 12 lines on plan, 3 over (Travel +28%, Legal +14%, AI Tooling new activity not budgeted), 2 under (Audit −22%, Tax Prep −18%). Run-rate forecast lands **<CCY>42,000 over** annual operating budget. Full table on [Budget vs Actuals](<citation:Budget vs Actuals!A1:M40>).

**local-file:** > Pacing summary: 12 lines on plan, 3 over, 2 under. Run-rate forecast lands **<CCY>42,000 over** annual operating budget. Full table written to `Budget vs Actuals` in `file:///path/to/<budget-workbook>.xlsx`.

**chat-only:** render the full pacing table inline.

**Next-step menu** (via `AskUserQuestion`):
- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Drill into a specific line item to understand the variance"` / `description`: `"← recommended. Month-by-month breakdown + top journal entries."`
  2. `label`: `"Model a what-if scenario"` / `description`: `"Cost rebalance, headcount cut, etc."`
  3. `label`: `"Refresh the underlying actuals first, then re-run"` / `description`: `"Sync actuals if the data looks stale."`
  4. `label`: `"I'm done"` / `description`: `""`

**When the user selects an option, immediately load the matching reference via `read_skill(file_path="references/<file>.md")` and follow it from its Gate 1 BEFORE doing any work.** Context (`<SERVER>`, `<ENTITY_NAME>`, `<ENTITY_UUID>`, `<RUNTIME>`, `<HAS_MANCO>`) is already warm — do **not** re-run Gate 0 / 0.75 and do **not** re-enter via an external `Skill()` call.

| Option | Reference to load |
|---|---|
| 1 — Drill into line item | `read_skill(file_path="references/drill-down-line.md")` |
| 2 — What-if scenario | `read_skill(file_path="references/budget-scenarios.md")` |
| 3 — Refresh actuals | `read_skill(file_path="references/fetch-actuals.md")` |
| 4 — Done | No invocation; close cleanly |

---

## Hard rules (budget-analysis specific)

- Reads from DWH; never writes to DWH. Spreadsheet writes go through the approval gate.
- Local-file mode: prefer **adding a sheet** to the same file over a separate file.
- **Buffer-aware variance basis.** If the budget tab carries an inflation/contingency buffer, pacing variances are measured against the buffered figure — state this in the output and offer to compare against the raw budget.
- **Recalc + column widths (excel-addin, Call 1 last statements):**
  ```javascript
  context.application.calculationMode = Excel.CalculationMode.automatic;
  context.workbook.application.calculate(Excel.CalculationType.full);
  sheet.getRange("A:A").format.columnWidth = 160;
  sheet.getRange("B:B").format.columnWidth = 220;
  sheet.getRange("C:<last_col>").format.autofitColumns();
  await context.sync();
  ```
  Fixed widths for label columns A and B; autofit only numeric columns.
