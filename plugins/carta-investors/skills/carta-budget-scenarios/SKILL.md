---
name: carta-budget-scenarios
model: opus
description: 'Model what-if scenarios on an existing budget workbook in Excel — trims (headcount reductions, revenue shocks, cost rebalances) and growth (new fund raises, expansion hires). Builds side-by-side scenario columns (or a Scenarios tab) with base + 1/2/3 and a cash-impact summary, one marked recommended. Five references — headcount-reduction, revenue-shock, cost-rebalance, new-fund-raise, expansion-hire. Runs in Claude for Excel and Claude Code / Cowork. TRIGGER on model / simulate / compare scenarios — trim ("cut headcount 10%", "model 15% revenue shortfall") and growth ("raise a new $500M fund", "hire 5 FTEs in 2027"). Pre-build review before write. DO NOT TRIGGER for new budgets (carta-create-budget), pulling Carta-stored budgets (carta-fetch-budget), refreshing actuals (carta-budget-actuals), pacing (carta-budget-vs-actuals), P&L (carta-consolidating-pnl), or balance sheet (carta-consolidating-balance-sheet).'
allowed-tools:
  # MCP connector discovery (Claude for Excel runtime tool — used first in Step 0)
  - refresh_mcp_connectors
  # Production
  - mcp__claude_ai_Carta__fetch
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__set_context
  # Carta-installer naming (lowercase)
  - mcp__carta_production__fetch
  - mcp__carta_production__welcome
  - mcp__carta_production__set_context
  # Local / legacy fallback
  - mcp__carta__fetch
  - mcp__carta__welcome
  - mcp__carta__set_context
  - AskUserQuestion
  - Read
  - Write
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py *)
---

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN base v0.1.0]

# Budget scenarios

What-if modelling on top of an existing budget. Five scenario references grouped into trim and growth, plus a shared helper:

**Trim:**

- [`references/headcount-reduction.md`](references/headcount-reduction.md) — reduce headcount by a target %.
- [`references/revenue-shock.md`](references/revenue-shock.md) — apply a haircut to revenue.
- [`references/cost-rebalance.md`](references/cost-rebalance.md) — open-ended, user states a cash goal.

**Growth:**

- [`references/new-fund-raise.md`](references/new-fund-raise.md) — model fee revenue uplift from closing a new fund.
- [`references/expansion-hire.md`](references/expansion-hire.md) — add N new FTEs at a stated comp band.

**Shared helper** (used by Step 4):

- [`references/get-actuals.md`](references/get-actuals.md) — canonical YTD-actuals query, so scenarios are grounded in real spend rather than just budget assumptions.

Growth references can stack with each other when the user mentions multiple
levers in one prompt (e.g. "raise a $500M fund AND hire 5 FTEs") — see the
"Stacking" section in each growth reference.

## UX Rules

Audience is an accountant in Excel. Plain English only. Never surface MCP
identifiers, DWH column names, UUIDs, raw JSON, SQL, or step labels.
Currency: `$X,XXX` positive, `($X,XXX)` negative, totals bolded.
Differences are absolute. Status: ✅ Match | ⚠ Mismatch ($X diff) | ❌ Missing in Carta | ❌ Missing in Client Doc.

**Closing summary link** is a workbook citation (`<citation:Sheet!Range>`) in
Claude for Excel mode, and a `file://` path in Claude Code / Cowork mode.

**Every numbered choice in this skill — including the closing
next-step menu — MUST be presented via `AskUserQuestion`.** Never
render options as a bare code-fenced markdown list. The
`AskUserQuestion` tool is in `allowed-tools`; use it. Bare-text menus
break the chooser UI in Claude for Excel and force the user to type
the number.

## When to use

Trim:

- "What if we cut headcount 10%?"
- "Model a 15% revenue shortfall"
- "Show me 3 trim options"
- "Propose 3 ways to preserve $500k of cash"
- "Compare two budget scenarios"
- "What happens if travel doubles?"

Growth:

- "What if we raise a new $500M fund?"
- "Model the P&L impact of Fund V closing in Q1"
- "Show revenue uplift from a $300M / $500M / $750M close"
- "Model hiring 5 FTEs in 2027"
- "Compare a 3 / 5 / 7 hire ramp"
- "How does next year's P&L look if we raise a new fund AND hire 5 FTEs?"

## DO NOT use this skill for

- **Building a new budget** — use `carta-create-budget`.
- **Refreshing actuals on an existing budget** — use `carta-budget-actuals`.
- **Pacing / variance / "how are we doing"** — use `carta-budget-vs-actuals`.
- **P&L / income statement requests** — use `carta-consolidating-pnl`.

---

## Step 0 — Carta MCP environment + resolve firm

1. Call `refresh_mcp_connectors`. Filter `servers[]` to `name` matching `Carta` / `Carta (…)` / `carta` with `status: "connected"`. Drop `failed`.
2. For each connected, probe both prefix forms in parallel: `mcp__claude_ai_Carta__welcome` and `mcp__carta__welcome`. First success = `<SERVER>`.
3. **Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every command is gated.

If none connected, list `failed` connectors and stop. If multiple, default to `Carta` (production).

**Resolve firm:** if user named one → `fetch(command="contexts:list", params={"firm_name": "<entity>"})` → disambiguate via `AskUserQuestion` if multiple → `set_context(firm_id=<uuid>)`.

**DWH param-name traps:** `dwh:execute:query` takes `sql:` not `query:`. `dwh:get:table_schema` takes `table_name:` not `table:`. `format` accepts `"ndjson"` / `"markdown"`, not `"csv"`.

If no firm was named, defer to Step 3.

## Step 0.5 — Detect runtime

Set `<RUNTIME>` to `excel-addin` (open workbook) or `local-file` (user-supplied path). If unclear, ask via `AskUserQuestion`.

## Step 1 — Where should the scenarios live

Branches by `<RUNTIME>`.

**If `<RUNTIME>` is `excel-addin`:**

**Empty-workbook shortcut**: if the active workbook has one sheet, `maxRows == 0`, no other tabs (typically a fresh `Book1.xlsx`/`Sheet1`), skip the chooser. Announce the rename in one sentence — *"I'll use the empty workbook you have open and rename `Sheet1` to `Scenarios`."* — then proceed. The chooser only exists to protect non-empty state.

> Where should the scenarios live?

- **"Add scenario columns next to the existing budget"** (recommended for ≤3 scenarios).
- **"Create a new `Scenarios` tab"** (recommended for >3 scenarios or wide pivots).
- **"Clone the workbook — leave the original untouched"**.

**If `<RUNTIME>` is `local-file`:**

> Where should the scenarios live?

- **"Add a `Scenarios` sheet to the same file"** (recommended).
- **"Write a separate `<budget>-scenarios.xlsx` file alongside the original"** (preserves the original).

Store `<DESTINATION>` (open workbook + tab in add-in mode, or `.xlsx`
path + sheet name in local-file mode).

## Step 2 — Intent routing

| Phrase | Reference |
|---|---|
| "cut headcount", "reduce salaries", "team reduction", "trim staffing", "headcount X%" | [`headcount-reduction.md`](references/headcount-reduction.md) |
| "revenue shortfall", "revenue haircut", "if revenue drops", "demand shock" | [`revenue-shock.md`](references/revenue-shock.md) |
| "preserve $X cash", "hit a cash target", "free up cash", "propose ways to reduce spend" | [`cost-rebalance.md`](references/cost-rebalance.md) |
| "raise a new fund", "Fund <N> closing", "new fund raise", "AUM uplift", "management fee impact of a new fund" | [`new-fund-raise.md`](references/new-fund-raise.md) |
| "hire N FTEs", "add headcount", "expand the team", "hire ramp", "model new hires" | [`expansion-hire.md`](references/expansion-hire.md) |

**Multi-lever prompts.** If the user names more than one of the above in a
single prompt (e.g. "raise a $500M fund AND hire 5 FTEs"), route to every
matching reference. Combine their outputs into composed scenarios — each
scenario column reflects the joint effect of all selected levers, and the
cash-impact summary breaks out each leg (e.g. `New-Fund Fees`, `New Personnel`,
`Net`). Do NOT run the references serially as separate outputs.

## Step 3 — Parameter gate (batched)

Reference-specific. Generally include:

- **Number of scenarios** (default 3).
- **Target %** or **target dollar amount**.
- **Scope** — all lines vs a section (e.g. only Personnel, only Operating Expenses).
- **Distribution rule** when applicable (across-the-board, junior-heavy, senior-heavy, etc.).

## Step 4 — Read the base budget + YTD actuals

**If `<RUNTIME>` is `excel-addin`:** use the add-in's read tools.

**If `<RUNTIME>` is `local-file`:**

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" \
  "<BUDGET_PATH>" --sheet "<BUDGET_SHEET>"
```

Pull YTD actuals via
[`references/get-actuals.md`](references/get-actuals.md)
so scenarios are grounded in real spend rather than just budget
assumptions.

The helper runs the **ManCo pre-flight sanity check**. **Halt** if it fails.

**Always render the pre-flight outcome as user-visible prose, even when the dataset is clean.** The context engine may compress the underlying tool call into a snip summary, which means the user has no visibility into whether this safety gate ran. Surface one sentence:

> "Checked N accounts for fund-level leak indicators (Interest expense, Audit fees, LOC fees, Realized/Unrealized gains, Management fees on expense side, Dead deal). None found — safe to proceed."

If leaks ARE found, the existing halt-and-ask-user language already runs. Never silently pass this gate.

## Step 5 — Generate scenarios

Each reference computes its own scenarios. Outputs are always
**relative to the base budget** as live formulas where possible
— so the user can edit inputs and see scenarios recalculate.

- **Trim references** scale existing lines: `=Base!H12 * 0.9` for a 10% trim.
- **Growth references** add new rows whose scenario columns reference
  user-editable named inputs at the top of the Scenarios tab: e.g.
  `=fund_size * fee_rate * months_after_close / 12`. Never hardcode the
  fund size, fee rate, hire count, or comp band — those must be editable
  cells so the user can flex them post-build.

## Step 6 — Pre-build review (approval gate)

Preview table:

| Section | Line Item | Base | Scenario 1 | Scenario 2 | Scenario 3 | Recommended Δ |
|---|---|---|---|---|---|---|
| Personnel | Salaries | $4,200,000 | $3,780,000 | $3,360,000 | $2,940,000 | ($420,000) |

(Sample row shows the format — currency with `$`, negatives in parentheses, totals would be bolded. Column header is `Recommended Δ` regardless of trim vs growth — the value is the absolute change for the recommended scenario.)

Plus a **cash-impact summary** block at the bottom of the preview. Columns
depend on the reference(s) that ran:

- Trim references: `Scenario | Annual Spend Δ | Projected Cash at Year-End | NOI Δ`
- Growth references: see the cash-impact-summary table in each growth reference (the columns name the specific lever — `New-Fund Fees Y1`, `New Personnel Y1`, etc.).
- Multi-lever (stacked) prompts: include one column per leg PLUS a `Net` column showing the combined effect.

Then offer the approval menu **via a single `AskUserQuestion` call** — never as a bare code-fenced markdown list (bare-text menus break the chooser UI in Claude for Excel and force the user to type the number). Render with these three options:

1. **Approve and write the scenarios** ← recommended
2. **Edit — change the target %, scenario count, or scope**
3. **Cancel**

The `← recommended` marker goes inside the `description` field of option 1, not as a suffix on the `label`.

Wait for explicit OK.

**Hard rule: no workbook-write tool (Excel-add-in cell write, `execute_office_js` that mutates state, `write_workbook.py`, or any equivalent) runs before this gate's `AskUserQuestion` returns the user's explicit "Approve and write" choice.** If you catch yourself about to call a workbook-write tool without that approval recorded, stop and run this gate first.

## Step 7 — Write and brand the tabs

### Approval-recorded check (run FIRST, before any write tool)

Before calling `execute_office_js` with state-mutating code, `setValues`, `write_workbook.py`, or any other workbook-write tool, look back at your tool history. Find the most recent `AskUserQuestion` you sent. Does its answer literally include `"Approve and write the scenarios"`? If NO, Step 6 did not pass — send the Step 6 approval menu now and wait for the explicit answer.

**Do not interpret upstream answers as approval.** A parameter response, a routing answer, or any prior `AskUserQuestion` whose answer is not literally `"Approve and write the scenarios"` does NOT clear this gate.

### Step 7 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

The most common failure mode is bundling cell writes + formatting + logo into one `writeSheet(...)` function — the model writes the cells, returns, and forgets the logo. **Do not combine the cell-write call with the brand block in a single office.js block.**

- **Call 1:** cell values, formulas, formatting. One `execute_office_js`. Return.
- **Call 2 (per tab touched):** logo via the verbatim brand block from `branding-and-header.md`.
- **Call N (verification, LAST):** load shape names on every tab touched, confirm `CartaLogo` exists.

Returning from Call 1 does NOT finish Step 7. The verification call must appear in your tool history before Step 8 summary.

**Before writing**, read [`references/branding-and-header.md`](references/branding-and-header.md). It defines the reserved 4-row metadata band (B1 firm / B2 descriptive title like `"2026 Budget · Senior-heavy trim scenario"` / B3 source / B4 other context), the Carta logo placement (column C, rows 1–3 height), the `blobs.getText("assets/...")` asset-loading pattern for Excel add-in (NOT `Read`), and the cell-comment pattern for any low-confidence flag. If the existing Budget tab does not already have the 4-row band, add it as part of this write (shift data via `sheet.getRange("1:5").insert(...)`).

**If `<RUNTIME>` is `excel-addin`:** use the add-in's cell-write tools.
Either side-by-side columns next to the existing budget, or a new
`Scenarios` tab with a header section explaining each scenario's
assumptions. After cell writes, brand every tab the skill touched —
both the existing Budget tab (if a header band was inserted) and any
new `Scenarios` tab — using the verbatim brand block in
`branding-and-header.md`.

**If `<RUNTIME>` is `local-file`:**

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py" --stdin <<'JSON'
{
  "workbook_path": "<DESTINATION>",
  "operations": [ ... ]
}
JSON
```

Mark one scenario `← recommended` in the cash-impact summary based on
whichever best meets the user's goal (least painful trim that hits the
target, smoothest NOI impact, etc.).

### Branding verification (REQUIRED, observable, excel-addin only)

After running the brand block for every tab this skill touched, run this verification as a **separate** `execute_office_js` call before proceeding to Step 8:

```javascript
const tabs = [/* "Scenarios", "Budget 2026", ... — substitute the actual tab names touched */];
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name");
  await context.sync();
  result[tabName] = sheet.shapes.items.map(s => s.name);
}
return result;
```

The result must show `CartaLogo` in every tab's shape list. If any tab lacks `CartaLogo`, re-run the brand block for that tab and re-verify. **Do not start Step 8 summary text until this verification returns `CartaLogo` on every tab.**

## Step 8 — Summary + next steps

**Step 8 precondition (DO NOT SKIP).** Before sending the summary text below, scan your tool history. Three anchors MUST be present in that order:

1. An `AskUserQuestion` whose answer included `"Approve and write the scenarios"` — Step 6 approval.
2. A `sheet.shapes.addImage(base64)` call for **each** tab the skill touched — Step 7 branding.
3. The branding-verification `execute_office_js` whose result showed `CartaLogo` on every tab — Step 7 verification.

If any anchor is missing, STOP, go back, and run the missing gate. **Do NOT write "Carta logo placed at..." in the summary when no `shapes.addImage` call appears in your tool history.**

Open the summary with a verb that matches the reference(s) that ran:

- Trim references → "Modeled 3 trim options…"
- `new-fund-raise` → "Modeled the fund-raise impact at 3 close sizes…"
- `expansion-hire` → "Modeled 3 hire-ramp scenarios…"
- Multi-lever (stacked) → "Modeled the combined impact of a new fund + N hires across 3 scenarios…"

**If `<RUNTIME>` is `excel-addin`:**

> Modeled 3 trim options for Example MgmtCo. **Scenario 2** (Senior-heavy
> reduction) preserves **$487,000** of cash at year-end with the smallest
> impact on Q1 momentum — recommended. Full breakdown on
> [Scenarios](<citation:Scenarios!A1:H40>).

**If `<RUNTIME>` is `local-file`:**

> Modeled 3 trim options for Example MgmtCo. **Scenario 2** (Senior-heavy
> reduction) preserves **$487,000** of cash at year-end — recommended.
> Full breakdown written to `Scenarios` in
> `file:///path/to/<budget-workbook>.xlsx`.

**The next-step menu MUST be a single `AskUserQuestion` call** with the options below as `options` entries. Never render them as a numbered markdown list, a bulleted list, or inline prose — bare-text menus break the chooser UI in Claude for Excel and force the user to type the number. The `← recommended` marker goes inside the `description` field of one option, not as a suffix on the `label`.

1. **Model a different scenario type (revenue shock, cost rebalance, new-fund raise, expansion hire)** ← recommended
2. **Drill into one of the scenarios — show me the impacted lines**
3. **Run a fresh pacing analysis using the recommended scenario as the new baseline**
4. **I'm done**

**Call `AskUserQuestion` with these exact parameters:**

- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`: the four `label` + `description` pairs above (place `← recommended` in the `description` field of the recommended option, NOT in the `label`)

**DO NOT** render the menu as inline markdown text, a numbered list, a bulleted list, or closing prose. If your response is about to contain `1. ...`, `2. ...`, `3. ...`, `4. ...` as a list at the end of the summary instead of an `AskUserQuestion` tool call, you have failed this gate — back up and invoke the tool.

Mark option 1 `← recommended` after the first scenario set; option 3
if the user is exploring "what would the new pacing look like".

**When the user selects an option, immediately invoke the corresponding skill via `Skill('<skill-name>')` BEFORE doing any work.** Do not freelance the output — load the downstream skill's SKILL.md so its gates, layout spec, branding rules, and approval flow apply. Routing:

| Option | Skill to invoke |
|---|---|
| 1 — Model a different scenario type | `Skill('carta-investors:carta-budget-scenarios')` re-entry with the new scenario type |
| 2 — Drill into one of the scenarios | Stay in this skill — render the impacted-lines breakdown inline |
| 3 — Run a fresh pacing analysis using the scenario as baseline | `Skill('carta-investors:carta-budget-vs-actuals')` |
| 4 — I'm done | No invocation; close cleanly |

---

### DWH result formatting

Queries > 50 rows: request `format: "ndjson"`, bucket into a blob. Don't paste large results — triggers `context_snip`. Use `"markdown"` only for ≤50-row previews.

## Hard rules

- All scenario values are **live formulas** referencing the base budget — never hardcoded duplicates.
- Recommended scenario needs a one-sentence rationale in the cash-impact summary.
- Local-file: openpyxl preserves formulas; scenarios use `='Budget 2026'!H12 * 0.9` syntax (single quotes around sheet names with spaces).
- **Scenario labels are mechanistic, not sentiment-based.** Use `Across-the-board` / `Junior-heavy` / `$300M close` / `Base + Fund V`. **Never** `Bull / Base / Bear`, `Optimistic / Pessimistic`, `Best case / Worst case` — describe what changed, not how to feel.
- **Two-row header for month-bucketed tables.** Row N = merged month label. Row N+1 = sub-headers. Never write both into the same row — subsequent merges destroy sub-headers.
- `range.merge(true)` discards trailing cells. Insert a new row first.
- **Month-label date-serial trap:** prefix with `'` or use `numberFormat: "mmm yyyy"` on a real date.
- **Border syntax (Office.js):** `style = "Continuous"`, then `weight = "Thin"`. Never `style: "Thin"`.
- **Branding standards — follow [`references/branding-and-header.md`](references/branding-and-header.md)** for every tab. Rows 1–4 reserved, logo at column C, `blobs.getText("assets/...")` for asset access.

---

## Error handling

Never auto-retry. Always surface the failure and let the user decide.

- **No Carta MCP connected** → "Open Settings → Connectors, enable Carta, retry."
- **Headcount-reduction: no personnel lines** → echo closest matches (Salaries/Wages/Bonuses/Benefits), ask user which to include.
- **Revenue-shock: no revenue rows** → surface sections found, ask which lines are revenue.
- **Cost-rebalance: no cash cell/tab** → ask user for current cash.
- **New-fund-raise: no Income section** → echo closest section labels, ask where to add `Mgmt Fee — <Fund>`.
- **New-fund-raise: non-numeric fund size** → ask for the specific dollar figure(s).
- **Expansion-hire: no Personnel section** → fall back to `headcount-reduction.md` GL patterns, confirm placement.
- **Expansion-hire: loadings unclear** → default payroll tax 8% / benefits 20% / bonus 15%, show defaults so user can override.
- **User uses sentiment labels** (Bull/Base/Bear) → acknowledge, label scenarios mechanistically in output (`$300M close`, `$500M close`). Never carry sentiment into the workbook.
- **ManCo pre-flight fires (Step 4)** → halt, ask for exact ManCo entity name.
- **Recommended scenario doesn't hit target** → surface gap, ask whether to widen lever set.
- **Auth error** → ask user to reconnect Carta. Do not auto-retry.
- **Connector connected, tool calls fail (`McpAuthError`)** → prefix mismatch, NOT auth. Re-run `refresh_mcp_connectors`, probe matching prefix's `welcome`. Never tell user to re-auth without verifying.
