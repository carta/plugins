# Create budget capability

Entry point for building a new budget. Routes to one of several sub-references based on user intent:

- [`from-prior-actuals.md`](from-prior-actuals.md) — build from last year's actuals (default).
- [`from-template.md`](from-template.md) — fill in a Carta template.
- [`from-recommendation.md`](from-recommendation.md) — add a line not in the Chart of Accounts.
- [`slice-by-tag.md`](slice-by-tag.md) — build a budget broken down by reporting tag / department.
- [`budget-by-subaccount.md`](budget-by-subaccount.md) — build a budget with sub-account rows nested under their parent account, for accounts that have sub-account activity.
- [`reorganize-categories.md`](reorganize-categories.md) — group / categorize existing budget line items into sections with subtotals.
- [`inflation-buffer.md`](inflation-buffer.md) — apply an inflation / contingency buffer to budget expenses.

Gates 0, 0.5, 0.75, and the Router Gate ran in SKILL.md — per its Forbidden narration rule, none of them produced any text output on success. This file picks up at Gate 1.

**Telemetry:** on entry, set `<CAPABILITY> = create-budget`. Every MCP call in this flow tags `_instrumentation.skills = ["carta-manco", "<CAPABILITY>"]`. Re-fire the beacon (`set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco", "create-budget"]})`) if you arrived here via a next-step menu rather than the Router Gate.

---

## Gate 1 — Where to write

Branches by `<RUNTIME>`.

**If `<RUNTIME>` is `excel-addin`:**

**Empty-workbook shortcut**: if the active workbook has one sheet, `maxRows == 0`, no other tabs, skip the chooser. Announce the rename in one sentence — *"I'll use the empty workbook you have open and rename `Sheet1` to `Budget <year>`."* — then proceed.

Otherwise, use `AskUserQuestion`:

> Where should I put the new budget?

- **"Update the open workbook — new tab (recommended)"** — Claude creates a tab named `Budget <year>`.
- **"Update the open workbook — overwrite an existing tab"** — Claude asks which tab and confirms before overwriting.
- **"Create a brand new workbook"** — Claude writes to a fresh file.

If the user has no workbook open at all, default to "brand new workbook" without asking.

**If `<RUNTIME>` is `local-file`:**

> Where should I write the budget file?

- **"Create a new .xlsx (recommended)"** — ask for the destination path and folder.
- **"Modify an existing .xlsx"** — ask for the file path; the skill will add a new sheet inside it (default name `Budget <year>`).

If the user gave a path in the original prompt, skip the choice and use that path.

**Done when:** the write destination is locked. Store `<DESTINATION>`.

---

## Gate 2 — Batched parameter gate

In **one** `AskUserQuestion` call, ask for every parameter the prompt didn't already specify:

- **Firm + entity** — if Gate 0's `contexts:list` was ambiguous or the user didn't name one.
- **`budget_year`** — required, e.g. 2026.
- **`prior_year`** — default `budget_year − 1`.
- **Window** — `start_month` / `end_month`, default 01 / 12.
- **Frequency** — `monthly` (default) | `quarterly` | `annually`.
- **Accounts** — `all enabled` (default) or a list of GL codes.
- **`account_lookback_years`** — default 3.
- **Sheet name** — default `Budget <budget_year>`.

If a sheet with that name already exists, ask whether to overwrite or append a suffix.

---

## Gate 3 — Route to the right sub-reference

**Call `read_skill` with the matching `file_path` before doing anything else.** Do not reconstruct the layout or query logic from memory.

| Phrase in user's prompt | Call |
|---|---|
| "from last year's actuals", "based on prior actuals", "from prior actuals", no qualifier | `read_skill(file_path="references/from-prior-actuals.md")` |
| "use the template", "fill in this template", "Carta template" | `read_skill(file_path="references/from-template.md")` |
| "add a line for <something not in CoA>", "I expect to spend $X on <new category>" | `read_skill(file_path="references/from-recommendation.md")` |
| "by department", "by reporting tag", "sliced by <dimension>" | `read_skill(file_path="references/slice-by-tag.md")` |
| "by sub-account", "sub-account budget", "GL sub-account" | `read_skill(file_path="references/budget-by-subaccount.md")` |
| "group / categorize / organize line items into categories", "add category subtotals" | `read_skill(file_path="references/reorganize-categories.md")` |
| "add a 5% inflation buffer", "apply a contingency buffer", "pad expenses by X%" | `read_skill(file_path="references/inflation-buffer.md")` |

Do not ask the user which mode — infer from their original prompt. Follow the loaded file. The last two operate on an **existing** budget tab in the workbook — skip the prior-actuals fetch when the budget is already present.

---

## Gate 5 — Pre-build review (approval gate)

Present the proposed budget as a preview table — **one row per account, no collapsing sections.**

| Section | Line Item | GL Code | Prior-Year Total | Proposed Budget Total | Source |
|---|---|---|---|---|---|

Source values: `DWH actual` / `trailing-avg` / `fallback-zero` / `user-supplied` / `low-confidence — sparse history`.

If any rows are flagged `low-confidence — sparse history`, call them out above the table:

> ⚠ **N line items have less than 6 months of history in the lookback window** — their proposed amounts are best-effort. Review these before approving.

Output the preview table above as a normal conversation message. Then call `AskUserQuestion` immediately after:

- `question`: `"Approve writing this budget?"`
- `header`: `"Approval"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Approve and write the budget"` / `description`: `"Writes the budget to the destination chosen in Gate 1. ← recommended"`
  2. `label`: `"Edit — change a parameter (year / window / accounts / sheet name)"`
  3. `label`: `"Cancel"`

If the user picks Edit, return to Gate 2 with their feedback. Wait for explicit approval before writing.

**Hard rule: no workbook-write tool runs before this gate's `AskUserQuestion` returns the user's explicit "Approve and write" choice.**

---

## Gate 6 — Write and brand the workbook (two tabs, no Provenance)

### Approval-recorded check (run FIRST)

Before calling any workbook-write tool, confirm the most recent `AskUserQuestion` answer literally includes `"Approve and write"`. **Restructure paths** (`reorganize-categories.md`, `inflation-buffer.md`) collect their own input first, then present a standard Gate 5 review — the `"Approve and write"` from that review is what clears this check.

Writes **two tabs** — `Budget <budget_year>` (primary, hardcoded budget values) and `<prior_year> Actuals` (reference, hardcoded actuals). **No Provenance tab.**

**Before writing a single cell, call both of these in the same message (parallel reads):**
1. `read_skill(file_path="references/from-prior-actuals.md")` — layout, header band, column widths, section order, summary rows.
2. `read_skill(file_path="references/branding-and-header.md")` — verbatim brand block JS and cell-comment API.

Do not reconstruct either spec from memory.

### If `<RUNTIME>` is `excel-addin`

**Gate 6 requires AT LEAST four separate `execute_office_js` calls:**

- **Call 1 (Step 6a):** cell values, formulas, formatting, column widths, cell comments. One `execute_office_js`. Return.
- **Call 2 (Step 6b, tab 1):** logo on `Budget <budget_year>` via the verbatim brand block from `branding-and-header.md`.
- **Call 3 (Step 6b, tab 2):** logo on `<prior_year> Actuals` via the same brand block.
- **Call 4 (Step 6c):** verification — load shape names on both tabs, confirm `CartaLogo` exists.

For each `low-confidence — sparse history` account, attach a cell comment to the column-A label cell — see `branding-and-header.md` for the verbatim `sheet.comments.add(...)` pattern.

**Step 6c verification block:**
```javascript
const tabs = ["Budget <budget_year>", "<prior_year> Actuals"];
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name");
  await context.sync();
  result[tabName] = sheet.shapes.items.map(s => s.name);
}
return result;
```

The result must show `CartaLogo` in every tab's shape list. **Do not start Gate 7 summary text until this verification returns `CartaLogo` on every tab.**

### If `<RUNTIME>` is `local-file`

Build a **single JSON operations payload** that writes the cells AND adds the logo on both tabs in one shot:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py" --stdin <<'JSON'
{
  "workbook_path": "<DESTINATION>",
  "create_if_missing": true,
  "operations": [
    /* …all cell-write ops for Budget <budget_year> and <prior_year> Actuals… */
    {
      "op": "add_image",
      "sheet": "Budget <budget_year>",
      "path": "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco/assets/powered_by_carta.png",
      "anchor": "E1",
      "rows": 3
    },
    {
      "op": "add_image",
      "sheet": "<prior_year> Actuals",
      "path": "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco/assets/powered_by_carta.png",
      "anchor": "E1",
      "rows": 3
    }
  ]
}
JSON
```

**Hardcoded vs formula cells (both runtimes):** Budget values are hardcoded numbers. Subtotals, Total Income, Total Expenses, Net Operating Income use `=SUM(...)` formulas so totals recompute when the user edits a budget cell.

**Done when:** both tabs are populated AND both carry a `CartaLogo` shape (Excel) or an `add_image` op with `status: "ok"` (local-file).

---

## Gate 7 — Summary + next steps

**Gate 7 precondition (DO NOT SKIP).** Before sending the summary text, confirm three anchors are present in your tool history:
1. An `AskUserQuestion` whose answer included `"Approve and write"` — Gate 5 approval.
2. A `sheet.shapes.addImage(base64)` call for **each** tab the skill wrote — Gate 6b branding.
3. The Step 6c verification showing `CartaLogo` on every tab — Gate 6c verification.

**Restructure-path carve-out.** The categorize-line-items and inflation-buffer paths modify an existing already-branded tab — require only anchor 1. Skip anchors 2 and 3 for these paths.

One or two sentences confirming what got written, with a clickable link to the result.

**Flag negative-NOI months in the summary.** If any monthly Net Income figure in the written sheet is negative, surface the count:
> "⚠ N of 12 months show negative NOI in this projection — review the lumpy revenue/expense lines before locking the budget."

**Next-step menu** (via `AskUserQuestion`):
- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Refresh actuals against this budget once new postings land"` / `description`: `"← recommended. Add actual figures to the budget workbook."`
  2. `label`: `"Run a pacing analysis"` / `description`: `"Compare YTD actuals against the budget."`
  3. `label`: `"Model a what-if scenario"` / `description`: `"Apply headcount cuts, revenue shocks, or other scenarios."`
  4. `label`: `"I'm done"` / `description`: `""`

**When the user selects an option, immediately load the matching reference via `read_skill(file_path="references/<file>.md")` and follow it from its Gate 1 BEFORE doing any work.** Context (`<SERVER>`, `<ENTITY_NAME>`, `<ENTITY_UUID>`, `<RUNTIME>`, `<HAS_MANCO>`) is already warm — do **not** re-run Gate 0 / 0.75 and do **not** re-enter via an external `Skill()` call.

| Option | Reference to load |
|---|---|
| 1 — Refresh actuals | `read_skill(file_path="references/fetch-actuals.md")` |
| 2 — Pacing analysis | `read_skill(file_path="references/budget-analysis.md")` |
| 3 — What-if scenario | `read_skill(file_path="references/budget-scenarios.md")` |
| 4 — Done | No invocation; close cleanly |

---

## Hard rules (create-budget specific)

- **DWH queries:** `call_tool({"name": "dwh__execute__query", ...})` — filter by `FUND_NAME = '<entity>'`. Use `AMOUNT` (not the base-currency variant). Sign-flip revenue: `CASE WHEN LEFT(ACCOUNT_TYPE,1) = '4' THEN -AMOUNT ELSE AMOUNT END`. Preserve reversals as-is.
- **Budget values are hardcoded numbers.** Subtotals, Total Income, Total Expenses, NOI use `=SUM(...)` formulas.
- **Low-confidence rows are flagged with cell comments only** — no fill, font color, border, or italic.
- **Both tabs MUST carry a `CartaLogo` shape before Gate 7 summary runs.** Use the bundled assets in this skill's `assets/` — never link to another plugin's assets.
- In local-file mode, never silently overwrite an existing `.xlsx` — surface the "sheet exists" status to the user.
