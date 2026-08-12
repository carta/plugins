# Budget scenarios capability

What-if modeling on top of an existing budget. Five scenario sub-references grouped into trim and growth, plus a shared helper:

**Trim:**
- [`headcount-reduction.md`](headcount-reduction.md) — reduce headcount by a target %.
- [`revenue-shock.md`](revenue-shock.md) — apply a haircut to revenue.
- [`cost-rebalance.md`](cost-rebalance.md) — open-ended, user states a cash goal.

**Growth:**
- [`new-fund-raise.md`](new-fund-raise.md) — model fee revenue uplift from closing a new fund.
- [`expansion-hire.md`](expansion-hire.md) — add N new FTEs at a stated comp band.

**Shared helper** (used by Step 4):
- [`get-actuals.md`](get-actuals.md) — canonical YTD-actuals query, so scenarios are grounded in real spend.

Growth references can stack with each other when the user mentions multiple levers in one prompt — see the "Stacking" section in each growth reference.

Gates 0, 0.5, 0.75, and the Router Gate ran in SKILL.md — per its Forbidden narration rule, none of them produced any text output on success. This file picks up at Step 1.

**Telemetry:** on entry, set `<CAPABILITY> = budget-scenarios`. Every MCP call in this flow tags `_instrumentation.skills = ["carta-manco", "<CAPABILITY>"]`. Re-fire the beacon (`set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco", "budget-scenarios"]})`) if you arrived here via a next-step menu rather than the Router Gate.

---

## Step 1 — Where should the scenarios live

Branches by `<RUNTIME>`.

**If `<RUNTIME>` is `excel-addin`:**

**Empty-workbook shortcut**: if the active workbook has one sheet, `maxRows == 0`, no other tabs, skip the chooser. Announce the rename in one sentence and proceed.

> Where should the scenarios live?

- **"Add scenario columns next to the existing budget"** (recommended for ≤3 scenarios).
- **"Create a new `Scenarios` tab"** (recommended for >3 scenarios or wide pivots).
- **"Clone the workbook — leave the original untouched"**.

**If `<RUNTIME>` is `local-file`:**

> Where should the scenarios live?

- **"Add a `Scenarios` sheet to the same file"** (recommended).
- **"Write a separate `<budget>-scenarios.xlsx` file alongside the original"** (preserves the original).

Store `<DESTINATION>`.

---

## Step 2 — Intent routing

| Phrase | Reference |
|---|---|
| "cut headcount", "reduce salaries", "team reduction", "trim staffing", "headcount X%" | `read_skill(file_path="references/headcount-reduction.md")` |
| "revenue shortfall", "revenue haircut", "if revenue drops", "demand shock" | `read_skill(file_path="references/revenue-shock.md")` |
| "preserve $X cash", "hit a cash target", "free up cash", "propose ways to reduce spend" | `read_skill(file_path="references/cost-rebalance.md")` |
| "raise a new fund", "Fund <N> closing", "new fund raise", "AUM uplift", "management fee impact of a new fund" | `read_skill(file_path="references/new-fund-raise.md")` |
| "hire N FTEs", "add headcount", "expand the team", "hire ramp", "model new hires" | `read_skill(file_path="references/expansion-hire.md")` |

**Multi-lever prompts.** If the user names more than one of the above in a single prompt (e.g. "raise a $500M fund AND hire 5 FTEs"), route to every matching reference. Combine their outputs into composed scenarios — each scenario column reflects the joint effect of all selected levers.

**Immediately call `read_skill` for every matched reference — do not reconstruct scenario logic from memory.**

---

## Step 3 — Parameter gate (batched)

Reference-specific. Generally include:

- **Number of scenarios** (default 3).
- **Target %** or **target dollar amount**.
- **Scope** — all lines vs a section (e.g. only Personnel, only Operating Expenses).
- **Distribution rule** when applicable (across-the-board, junior-heavy, senior-heavy, etc.).

---

## Step 4 — Read the base budget + YTD actuals

**If `<RUNTIME>` is `excel-addin`:** use the add-in's read tools.

**If `<RUNTIME>` is `local-file`:**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" "<BUDGET_PATH>" --sheet "<BUDGET_SHEET>"
```

Pull YTD actuals via [`get-actuals.md`](get-actuals.md) so scenarios are grounded in real spend rather than just budget assumptions.

---

## Step 5 — Generate scenarios

Each reference computes its own scenarios. Outputs are always **relative to the base budget** as live formulas:

- **Trim references** scale existing lines: `=Base!H12 * 0.9` for a 10% trim.
- **Growth references** add new rows whose scenario columns reference user-editable named inputs at the top of the Scenarios tab — e.g. `=fund_size * fee_rate * months_after_close / 12`. Never hardcode the fund size, fee rate, hire count, or comp band.

---

## Step 6 — Pre-build review (approval gate)

Preview table:

| Section | Line Item | Base | Scenario 1 | Scenario 2 | Scenario 3 | Recommended Δ |
|---|---|---|---|---|---|---|

Plus a **cash-impact summary** block at the bottom of the preview:
- Trim references: `Scenario | Annual Spend Δ | Projected Cash at Year-End | NOI Δ`
- Growth references: columns name the specific lever (e.g. `New-Fund Fees Y1`, `New Personnel Y1`)
- Multi-lever (stacked): one column per leg PLUS a `Net` column

Output the preview and cash-impact summary above as a normal conversation message. Then call `AskUserQuestion` immediately after:

- `question`: `"Approve writing these scenarios?"`
- `header`: `"Approval"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Approve and write the scenarios"` / `description`: `"Writes the scenario columns to the destination chosen in Step 1. ← recommended"`
  2. `label`: `"Edit — change the target %, scenario count, or scope"`
  3. `label`: `"Cancel"`

**Hard rule: no workbook-write tool runs before this step's `AskUserQuestion` returns the user's explicit "Approve and write the scenarios" choice.**

---

## Step 7 — Write and brand the tabs

### Approval-recorded check (run FIRST)

Before calling any workbook-write tool, confirm the most recent `AskUserQuestion` answer literally includes `"Approve and write the scenarios"`.

### Step 7 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

- **Call 1:** cell values, formulas, formatting.
- **Call 1.5 (blob pre-flight, REQUIRED before logo):** verify the asset store is populated:
  ```javascript
  const keys = blobs.keys();
  return { blobKeys: keys };
  ```
  If `blobKeys` is empty (`[]`), **stop immediately** — do NOT attempt the brand block. Surface this message:
  > "The Carta logo asset isn't loaded yet in this session. Please close the skill panel, wait a moment, then reopen it and try again. The scenario data has been written — only the branding step is pending."
  Do not silently skip branding. Do not mark the branding step as complete. Do not write Step 8 summary text.
- **Call 2 (per tab touched):** logo via the verbatim brand block from `branding-and-header.md`. Only run after Call 1.5 confirms `blobKeys` is non-empty.
- **Call N (verification, LAST):** load shape names on every tab touched, confirm `CartaLogo` exists.

**Before any write**, call both in the same message (parallel reads):
1. `read_skill(file_path="references/branding-and-header.md")`
2. `read_skill(file_path="references/<scenario-reference-from-step-2>.md")` — one per reference for multi-lever prompts.

Do not reconstruct either spec from memory. If the existing Budget tab does not already have the 4-row band, add it as part of this write (shift data via `sheet.getRange("1:5").insert(...)`).

**If `<RUNTIME>` is `excel-addin`:** use the add-in's cell-write tools. Either side-by-side columns next to the existing budget, or a new `Scenarios` tab. After cell writes, brand every tab the skill touched — both the existing Budget tab (if a header band was inserted) and any new `Scenarios` tab.

**If `<RUNTIME>` is `local-file`:**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py" --stdin <<'JSON'
{
  "workbook_path": "<DESTINATION>",
  "operations": [ ... ]
}
JSON
```

Mark one scenario `← recommended` in the cash-impact summary based on whichever best meets the user's goal.

### Branding verification (REQUIRED, observable, excel-addin only)

After running the brand block for every tab touched, run this verification as a **separate** `execute_office_js` call:

```javascript
const tabs = [/* substitute actual tab names touched */];
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name");
  await context.sync();
  result[tabName] = sheet.shapes.items.map(s => s.name);
}
return result;
```

The result must show `CartaLogo` in every tab's shape list. **Do not start Step 8 summary text until this verification returns `CartaLogo` on every tab.**

**Never silently skip branding.** If verification returns `[]` or empty, that means the brand block failed — do NOT proceed.

---

## Step 8 — Summary + next steps

**Step 8 precondition (DO NOT SKIP).** Confirm three anchors are present in your tool history:
1. An `AskUserQuestion` whose answer included `"Approve and write the scenarios"` — Step 6 approval.
2. A `sheet.shapes.addImage(base64)` call for **each** tab touched — Step 7 branding.
3. The branding-verification showing `CartaLogo` on every tab — Step 7 verification.

Open the summary with a verb that matches the reference(s) that ran:
- Trim → "Modeled 3 trim options…"
- `new-fund-raise` → "Modeled the fund-raise impact at 3 close sizes…"
- `expansion-hire` → "Modeled 3 hire-ramp scenarios…"
- Multi-lever → "Modeled the combined impact of a new fund + N hires across 3 scenarios…"

**excel-addin:** > Modeled 3 trim options for Example MgmtCo. **Scenario 2** (Senior-heavy reduction) preserves **$487,000** of cash at year-end with the smallest impact on Q1 momentum — recommended. Full breakdown on [Scenarios](<citation:Scenarios!A1:H40>).

**local-file:** > Modeled 3 trim options for Example MgmtCo. **Scenario 2** (Senior-heavy reduction) preserves **$487,000** of cash at year-end — recommended. Full breakdown written to `Scenarios` in `file:///path/to/<budget-workbook>.xlsx`.

**Next-step menu** (via `AskUserQuestion`):
- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Model a different scenario type"` / `description`: `"← recommended. Revenue shock, cost rebalance, new-fund raise, expansion hire."`
  2. `label`: `"Drill into one of the scenarios"` / `description`: `"Show the impacted lines in detail."`
  3. `label`: `"Run a fresh pacing analysis using the recommended scenario as the new baseline"` / `description`: `""`
  4. `label`: `"I'm done"` / `description`: `""`

**When the user selects an option, immediately load the matching reference via `read_skill(file_path="references/<file>.md")` and follow it from its Gate 1 BEFORE doing any work.** Context (`<SERVER>`, `<ENTITY_NAME>`, `<ENTITY_UUID>`, `<RUNTIME>`, `<HAS_MANCO>`) is already warm — do **not** re-run Gate 0 / 0.75 and do **not** re-enter via an external `Skill()` call.

| Option | What to invoke |
|---|---|
| 1 — Model a different scenario type | `read_skill(file_path="references/budget-scenarios.md")` (re-read this reference, pick the new scenario type) |
| 2 — Drill into one of the scenarios | Stay in this reference — render the impacted-lines breakdown inline |
| 3 — Run pacing analysis using scenario as baseline | `read_skill(file_path="references/budget-analysis.md")` |
| 4 — Done | No invocation; close cleanly |

---

## Hard rules (budget-scenarios specific)

- All scenario values are **live formulas** referencing the base budget — never hardcoded duplicates.
- Recommended scenario needs a one-sentence rationale in the cash-impact summary.
- Local-file: openpyxl preserves formulas; scenarios use `='Budget 2026'!H12 * 0.9` syntax (single quotes around sheet names with spaces).
- **Scenario labels are mechanistic, not sentiment-based.** Use `Across-the-board` / `Junior-heavy` / `$300M close` / `Base + Fund V`. **Never** `Bull / Base / Bear`, `Optimistic / Pessimistic`, `Best case / Worst case`.
- **Label/header text beginning with `+`, `=`, `-`, or `@` parses as a formula.** Prefix such text with a leading `'` (or a space), including Δ-delta and `+ Δ` scenario column headers.
- **Set `Worksheet.position` in a separate `context.sync()`, never in the same statement as `worksheets.add()`.** Create and activate first: `const sh = sheets.add(name); sh.activate(); await context.sync();`.
- **Recalc + column widths (excel-addin, Call 1 last statements):**
  ```javascript
  context.workbook.application.calculationMode = Excel.CalculationMode.automatic;
  context.workbook.application.calculate(Excel.CalculationType.full);
  sheet.getRange("A:A").format.columnWidth = 120;
  sheet.getRange("B:B").format.columnWidth = 180;
  sheet.getRange("C:<last_col>").format.autofitColumns();
  await context.sync();
  ```
  Fixed widths for label columns; autofit only numeric columns. Recalc before autofit — scenario formulas stay at 0 without the forced recalc.
