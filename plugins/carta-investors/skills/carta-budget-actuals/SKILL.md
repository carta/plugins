---
name: carta-budget-actuals
model: opus
description: 'Update actuals on an existing budget workbook in Excel. Four layouts — interleave Budget/Actual/Variance per month, add a separate Actuals tab, refresh stale cells in place, or extend by one period. Asks user which layout. Sources actuals from the Carta MCP, strict FUND_NAME scoping. Runs in Claude for Excel and Claude Code / Cowork. TRIGGER on requests to refresh / update / sync actuals, add a year''s actuals, interleave Budget/Actual/Variance columns (layout operation), add an actuals tab, or extend by one period ("refresh the actuals", "add 2026 actuals by month", "add an actuals tab"). Pre-build review before write. DO NOT TRIGGER for variance analysis or pacing questions ("how are we pacing", "variance by month") — use carta-budget-vs-actuals. Also DO NOT TRIGGER for new budgets (carta-create-budget), pulling Carta-stored budgets (carta-fetch-budget), what-if (carta-budget-scenarios), P&L (carta-consolidating-pnl), or balance sheet (carta-consolidating-balance-sheet).'
allowed-tools:
  # MCP connector discovery (Claude for Excel runtime tool — used first in Gate 0)
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

# Budget actuals

Entry point for updating actuals in an existing budget. Five references:

- [`references/add-actuals-columns.md`](references/add-actuals-columns.md) — **Layout A**: interleave Budget / Actual / Variance per month on the Budget tab (recommended for active tracking).
- [`references/add-actuals-tab.md`](references/add-actuals-tab.md) — **Layout B**: add a peer `<year> Actuals` tab alongside the Budget tab.
- [`references/refresh-existing.md`](references/refresh-existing.md) — **Layout C**: overwrite stale actuals cells in columns that already exist.
- [`references/add-period.md`](references/add-period.md) — **Layout D**: append the single next month/quarter column.
- [`references/get-actuals.md`](references/get-actuals.md) — internal helper, the canonical actuals-query routine.

## UX Rules

Audience is an accountant in Excel. Plain English only. Never surface MCP
identifiers, DWH column names, UUIDs, raw JSON, SQL, or gate labels.
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

- "Refresh the actuals on my budget"
- "Pull the latest actuals into the open budget"
- "Update my budget with March numbers"
- "The actuals are stale — sync them"
- "Add next month's column to the budget"
- "Extend the budget through April"

## DO NOT use this skill for

- **Building a new budget from scratch** — use `carta-create-budget`.
- **Pulling the Carta-stored ManCo budget** — use `carta-fetch-budget`.
- **Pacing / YTD vs budget / variance / "are we on track"** — use `carta-budget-vs-actuals`.
- **What-if scenarios** — use `carta-budget-scenarios`.
- **P&L / income statement requests** — use `carta-consolidating-pnl`.
- **Balance sheet requests** — use `carta-consolidating-balance-sheet`.

---

## Gate 0 — Carta MCP environment + resolve firm

1. Call `refresh_mcp_connectors`. Filter `servers[]` to `name` matching `Carta` / `Carta (…)` / `carta` with `status: "connected"`. Drop `failed`.
2. For each connected, probe both prefix forms in parallel: `mcp__claude_ai_Carta__welcome` and `mcp__carta__welcome`. First success = `<SERVER>`.
3. **Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every command is gated.

If none connected, list `failed` connectors and stop. If multiple, default to `Carta` (production).

**Resolve firm:** if user named one → `fetch(command="contexts:list", params={"firm_name": "<entity>"})` → disambiguate via `AskUserQuestion` if multiple → `set_context(firm_id=<uuid>)`.

**DWH param-name traps:** `dwh:execute:query` takes `sql:` not `query:`. `dwh:get:table_schema` takes `table_name:` not `table:`. `format` accepts `"ndjson"` / `"markdown"`, not `"csv"`.

If no firm was named, defer to Gate 3.

---

## Gate 0.5 — Detect runtime

Detect whether this is **Claude for Excel** (workbook is open in the
add-in) or **Claude Code / Cowork** (working with a `.xlsx` file on
disk). See `carta-create-budget/SKILL.md` Gate 0.5 for the heuristic — same
rule applies here.

If unclear, ask the user via `AskUserQuestion`:

> "How are you working with the budget — inside Excel via Claude for
> Excel, or as a local .xlsx file (Claude Code / Cowork)?"

Store `<RUNTIME>` (`excel-addin` or `local-file`) for Gates 1, 4, 7, 8.

---

## Gate 1 — Where to write

Branches by `<RUNTIME>`.

**If `<RUNTIME>` is `excel-addin`:**

**Empty-workbook shortcut**: if the active workbook has one sheet, `maxRows == 0`, no other tabs (typically a fresh `Book1.xlsx`/`Sheet1`), skip the chooser. Announce the rename in one sentence — *"I'll use the empty workbook you have open and rename `Sheet1` to `<TARGET_TAB>`."* — then proceed. The chooser only exists to protect non-empty state; an empty workbook has none. The chooser still applies whenever there is data or more than one tab.

> Where should I write the updates?

- **"Update the open workbook directly — recommended"** (modify in place).
- **"Update the open workbook in a new tab"** (preserves the original).
- **"Create a brand new workbook with the updated data"**.

If user picks "update directly", confirm **which tab** explicitly. If
multiple tabs look like budgets, ask which one.

**If `<RUNTIME>` is `local-file`:**

> Where is the budget file, and where should the updated version land?

- **"Modify the file in place — recommended"** — ask for the path.
- **"Write a new file alongside the original"** — ask for the path; new file gets a `-updated` suffix by default.

If the user gave a path in the original prompt, skip the choice. Store
`<DESTINATION>` (open workbook + tab in add-in mode, or `.xlsx` path +
sheet name in local-file mode).

---

## Gate 2 — Choose the layout (always ask)

Four layouts are valid for putting actuals into a workbook, and the
same prompt can plausibly mean any of them. **Always ask the user**
how the actuals should appear — never assume from the prompt's
phrasing alone.

Use `AskUserQuestion`:

> How should the actuals appear in the workbook?

| # | Option | Reference loaded |
|---|---|---|
| 1 | **Interleave Budget / Actual / Variance columns per month** on the Budget tab ← recommended | [`add-actuals-columns.md`](references/add-actuals-columns.md) |
| 2 | **Add a separate `<year> Actuals` tab** alongside the Budget tab | [`add-actuals-tab.md`](references/add-actuals-tab.md) |
| 3 | **Refresh existing Budget / Actual / Variance cells** (the cells are there, just stale) | [`refresh-existing.md`](references/refresh-existing.md) |
| 4 | **Add only the next single period column** | [`add-period.md`](references/add-period.md) |

Use the user's prompt only as a *hint* for which option to highlight —
never as authority to skip the question:

| Phrase in the prompt | Hint |
|---|---|
| "interleave", "Budget / Actual / Variance", "variance by month", "add `<year>` actuals" (no other clue) | Option 1 (also the default `← recommended`) |
| "add a tab", "track on its own tab", "separate actuals tab" | Option 2 |
| "refresh", "the actuals are stale", "pull latest", "sync" | Option 3 |
| "add next month", "extend through `<month>`", "next period" | Option 4 |

The user's pick locks the reference to load for the rest of the
workflow.

> **Why we always ask:** the same prompt — "add 2026 actuals by month"
> — can mean Option 1, 2, or 3 depending on the user's intent and the
> current state of their workbook. Guessing wrong and rebuilding costs
> the user a corrective prompt. Asking once costs one click. **Choose
> the click.**

---

## Gate 3 — Batched parameter gate

In one `AskUserQuestion`:

- **Entity** — confirm `FUND_NAME` value before any query.
- **Period range** — what months/quarters to refresh, or what new period to add.
- **Match strategy** — `name first then GL code` (default) vs `GL code only`.

---

## Gate 4 — Read the existing budget

**If `<RUNTIME>` is `excel-addin`:**

Use the Excel add-in's runtime read tools to inspect the budget tab —
header row, line-item rows, actuals/budget columns, formula rows.

**If `<RUNTIME>` is `local-file`:**

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" \
  "<DESTINATION_PATH>" --sheet "<BUDGET_SHEET>"
```

Parse the resulting JSON to identify the same structure (headers,
line items, formula rows). Treat any cell where `is_formula: true` as
load-bearing — never overwrite it.

---

## Gate 5 — Load actuals + ManCo pre-flight

Always call through [`references/get-actuals.md`](references/get-actuals.md).
Never write inline SQL outside that file.

The helper runs the **ManCo pre-flight sanity check** as part of its
output. If it fires, halt and tell the user (plain English) — see
`references/get-actuals.md` for the message wording.

**Always render the pre-flight outcome as user-visible prose, even when the dataset is clean.** The context engine may compress the underlying tool call into a snip summary, which means the user has no visibility into whether this safety gate ran. Surface one sentence:

> "Checked N accounts for fund-level leak indicators (Interest expense, Audit fees, LOC fees, Realized/Unrealized gains, Management fees on expense side, Dead deal). None found — safe to proceed."

If leaks ARE found, the existing halt-and-ask-user language already runs. Never silently pass this gate.

---

## Gate 6 — Pre-build review (approval gate)

Preview table grouped by:

- **Existing rows updated** — Line Item | Old Value | New Value | Source.
- **Cells zeroed** — Line Item | Old Value | Reason ("no activity in period").
- **New rows to insert** — Account | Section | Position | Value | Source.
- **GL accounts found in DWH with no row in the sheet** — Account | Total in period.

If any rows carry the `low-confidence — sparse history` flag (account
has < 6 months of activity in the lookback window), surface the count
above the table.

Then offer the approval menu **via a single `AskUserQuestion` call** — never as a bare code-fenced markdown list (bare-text menus break the chooser UI in Claude for Excel and force the user to type the number). Render with these three options:

1. **Approve and apply the updates** ← recommended
2. **Edit — change the period range, match strategy, or scope**
3. **Cancel**

The `← recommended` marker goes inside the `description` field of option 1, not as a suffix on the `label`.

Wait for explicit OK before writing.

**Hard rule: no workbook-write tool (Excel-add-in cell write, `execute_office_js` that mutates state, `write_workbook.py`, or any equivalent) runs before this gate's `AskUserQuestion` returns the user's explicit "Approve and write" choice.** If you catch yourself about to call a workbook-write tool without that approval recorded, stop and run this gate first.

---

## Gate 7 — Write the changes (preserving formulas) AND brand the tabs

### Approval-recorded check (run FIRST, before any write tool)

Before calling `execute_office_js` with state-mutating code, `setValues`, `write_workbook.py`, or any other workbook-write tool, look back at your tool history. Find the most recent `AskUserQuestion` you sent. Does its answer literally include `"Approve and apply the updates"`? If NO, Gate 6 did not pass — send the Gate 6 approval menu now and wait for the explicit answer.

**Do not interpret upstream answers as approval.** A Gate 2 layout response, a Gate 3 period-range answer, or any prior `AskUserQuestion` whose answer is not literally `"Approve and apply the updates"` does NOT clear this gate.

### Gate 7 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

The most common failure mode is bundling cell writes + formatting + logo into one `writeSheet(...)` function — the model writes the cells, returns, and forgets the logo. **Do not combine the cell-write call with the brand block in a single office.js block.**

- **Call 1:** apply the cell updates from the approved payload. One `execute_office_js`. Return.
- **Call 2 (per tab touched):** logo via the verbatim brand block from `branding-and-header.md` (`sheet.shapes.addImage(...)`).
- **Call N (verification, LAST):** load shape names on every tab touched, confirm `CartaLogo` exists.

Returning from Call 1 does NOT finish Gate 7. The verification call must appear in your tool history before Gate 8 summary.

Only touch the cells the user approved. Do not edit formulas elsewhere
in the sheet (subtotals are formula-driven and will auto-update).

**Before writing**, read [`references/branding-and-header.md`](references/branding-and-header.md). It defines:

- The reserved 4-row metadata band (A1–A4 + blank A5) that every tab must carry — per-skill override (this skill uses column A so the band left-edges with the account-label column underneath). If the existing budget tab doesn't have it, add it as part of this write (shift the data down to row 6+ first via `sheet.getRange("1:5").insert(...)` in Excel add-in mode, or via prepended row writes in local-file mode).
- The Carta logo placement (column D, rows 1–3 height — per-skill override, not column C) — apply to every tab this skill touches, including the actuals tab(s) it adds.
- The blobs.getText asset-loading pattern for Excel add-in mode (NOT `Read`).
- The cell-comment pattern for any sparse-history / low-confidence flag.

**If `<RUNTIME>` is `excel-addin`:** before the first sheet write, load
`references/add-actuals-columns.md` §5 ("Build the rebuild payload") and
apply its header / column / format spec verbatim — especially the two-row
header (row N = merged month labels, row N+1 = `Budget` / `Actual` /
`Variance` sub-headers — spelled out in full, never abbreviated). Then
use the add-in's cell-write tools to execute the payload.

**If `<RUNTIME>` is `local-file`:** build an operations payload and
apply it:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py" --stdin <<'JSON'
{
  "workbook_path": "<DESTINATION_PATH>",
  "operations": [ ... ]
}
JSON
```

Use only `write_cell` / `write_formula` / `set_format` operations.
Avoid `create_sheet` and `write_range` here — those are for `carta-create-budget`.

### Branding verification (REQUIRED, observable, excel-addin only)

After running the brand block for every tab this skill touched, run this verification as a **separate** `execute_office_js` call before proceeding to Gate 8:

```javascript
const tabs = [/* "Budget 2026", "2026 Actuals", ... — substitute the actual tab names touched this run */];
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name");
  await context.sync();
  result[tabName] = sheet.shapes.items.map(s => s.name);
}
return result;
```

The result must show `CartaLogo` in every tab's shape list. If any tab returns `[]` or its shape list lacks `CartaLogo`, you have skipped the brand block for that tab — re-run it and re-verify. **Do not start Gate 8 summary text until this verification returns `CartaLogo` on every tab.** The verification call is observable evidence; without it in your tool history, Gate 7 is not complete.

---

## Gate 8 — Summary + next steps

**Gate 8 precondition (DO NOT SKIP).** Before sending the summary text below, scan your tool history. Three anchors MUST be present in that order:

1. An `AskUserQuestion` whose answer included `"Approve and apply the updates"` — Gate 6 approval.
2. A `sheet.shapes.addImage(base64)` call for **each** tab the skill touched (one per tab) — Gate 7 branding.
3. The branding-verification `execute_office_js` whose result showed `CartaLogo` on every tab — Gate 7 verification.

If any anchor is missing, you have skipped a gate. **Do NOT write "Carta logo placed at..." in the summary when no `shapes.addImage` call appears in your tool history — that's hallucinating completion.** STOP, go back, run the missing gate, then return here.

**If `<RUNTIME>` is `excel-addin`:**

> Refreshed 23 lines on [Budget 2026](<citation:Budget 2026!A1:Z80>)
> (Example MgmtCo). 2 lines zeroed (Audit, Tax Prep — no Q1 activity).
> 1 new account inserted under Operating Expenses (AI Tooling).
> 2 suspicious-zero flags — Salaries and Leased-employee payments
> dropped to $0; could be posting lag.

**If `<RUNTIME>` is `local-file`:**

> Refreshed 23 lines on `Budget 2026` in
> `file:///path/to/<budget-workbook>.xlsx` (Example MgmtCo). 2 lines zeroed (Audit, Tax Prep — no Q1 activity). 1 new
> account inserted (AI Tooling, Operating Expenses). 2 suspicious-zero
> flags — Salaries and Leased-employee payments.

**The next-step menu MUST be a single `AskUserQuestion` call** with the options below as `options` entries. Never render them as a numbered markdown list, a bulleted list, or inline prose — bare-text menus break the chooser UI in Claude for Excel and force the user to type the number. The `← recommended` marker goes inside the `description` field of one option, not as a suffix on the `label`.

1. **Run a pacing analysis (Budget vs Actuals)** ← recommended
2. **Drill into a specific line item (largest entries / month-by-month)**
3. **Model a what-if scenario on this budget**
4. **I'm done**

**Call `AskUserQuestion` with these exact parameters:**

- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`: the four `label` + `description` pairs above (place `← recommended` in the `description` field of the recommended option, NOT in the `label`)

**DO NOT** render the menu as inline markdown text, a numbered list, a bulleted list, or closing prose. If your response is about to contain `1. ...`, `2. ...`, `3. ...`, `4. ...` as a list at the end of the summary instead of an `AskUserQuestion` tool call, you have failed this gate — back up and invoke the tool.

Mark `← recommended` based on context — option 1 by default after a refresh; option 2 if the user previously asked about a specific line.

**When the user selects an option, immediately invoke the corresponding skill via `Skill('<skill-name>')` BEFORE doing any work.** Do not freelance the output — load the downstream skill's SKILL.md so its gates, layout spec, branding rules, and approval flow apply. Routing:

| Option | Skill to invoke |
|---|---|
| 1 — Run a pacing analysis | `Skill('carta-investors:carta-budget-vs-actuals')` |
| 2 — Drill into a specific line item | `Skill('carta-investors:carta-budget-vs-actuals')` with the `drill-down-line` reference |
| 3 — Model a what-if scenario | `Skill('carta-investors:carta-budget-scenarios')` |
| 4 — I'm done | No invocation; close cleanly |

---

### DWH result formatting

Queries > 50 rows: request `format: "ndjson"`, bucket into a blob. Don't paste large results — triggers `context_snip`. Use `"markdown"` only for ≤50-row previews.

## Hard rules

- Same DWH primitives as `carta-create-budget` — Carta DWH journal-entries table only, no external-DWH fallback, `FUND_NAME` scoping, `AMOUNT` (not the base-currency variant), sign flip, preserve reversals. ManCo pre-flight mandatory before any write — see `references/get-actuals.md`.
- Local-file: never overwrite cells flagged as formulas in `read_workbook.py` output. Subtotals / NOI keep their `=SUM(...)` semantics.
- **Two-row header is mandatory** for month-bucketed tables. Row N = merged month label per `Budget`/`Actual`/`Variance` triplet. Row N+1 = sub-headers spelled out in full (`Budget`, `Actual`, `Variance`). **Never abbreviate to `B`/`A`/`V`**. Never write both into the same row — subsequent merges destroy sub-headers.
- `range.merge(true)` discards trailing cell values. Insert a new row first.
- **Month-label date-serial trap:** prefix with `'` or use `numberFormat: "mmm yyyy"` on a real date.
- **Currency format:** `_([$$-en-US]* #,##0.00_);_([$$-en-US]* (#,##0.00);_([$$-en-US]* "-"??_);_(@_)`. Apply to data range after the data write.
- **Border syntax (Office.js):** `style = "Continuous"`, then `weight = "Thin"`. Never `style: "Thin"`.
- **Column-width anti-pattern:** never `autofitColumns()` on a header-only range. Use `sh.getUsedRange().format.autofitColumns()` after data is written.
- **Branding standards — follow [`references/branding-and-header.md`](references/branding-and-header.md)** for every tab. Per-skill overrides: metadata band in column A (not B), logo at column D (not C). Asset access via `blobs.getText("assets/...")`.

---

## Schema discovery

The skill queries the Carta DWH journal-entries table. If column
names are needed, look up the table via the Carta MCP DWH schema
command once at Gate 0 — production schema is canonical. Don't embed
column listings inline; the DWH contract can drift.

## Error handling

| Symptom | Likely cause | What to tell the user |
|---|---|---|
| No Carta MCP server found | The Carta connector isn't enabled in this session | "I can't see your Carta connector. Open **Settings → Connectors** in Claude, enable Carta, then ask me again." |
| Sheet has no recognisable header row | The budget layout uses non-date column headers | Surface what the headers look like and ask the user which row is the header and which columns are actuals. |
| `low-confidence — sparse history` flagged on many rows | Entity is new or sparsely posted | Surface the count in the preview and let the user decide whether to proceed. Don't auto-suppress. |
| ManCo pre-flight check fires (Gate 5) | Fund-level GL leaked into the ManCo query | "I'm stopping before writing because fund-level accounts showed up in the management-company result. Please confirm the exact entity name." |
| Multiple budget tabs in the workbook | Ambiguous "the budget" | Ask the user which tab to update; do not silently pick one. |
| Cell the skill wants to write is a formula | Subtotal / NOI row | Surface the row and confirm; never silently overwrite a formula. |
| Local-file mode: file path is missing or unreadable | Wrong path supplied | Echo the path back and ask for the correct one. |
| Query times out | DWH load | Tell the user it's slow and offer to retry — never auto-retry. |
| Auth / permission error from the MCP | Carta session expired or lacks DWH access | Ask the user to reconnect Carta in Settings → Connectors. |
| Connector shows as connected, but tool calls fail with `McpAuthError` or "tool not available" | The MCP server's tool prefix doesn't match what this skill's `allowed-tools` enumerates. Re-auth is not the fix — see Gate 0 troubleshooting note below the table. | "I'm reconnecting to your Carta workspace — one moment." |

**Connector-mismatch troubleshooting (operator-facing, not user-facing).** Re-run `refresh_mcp_connectors` to confirm which Carta connector is actually connected, then probe the matching prefix's `welcome` per the Gate 0 mapping. Never tell the user to re-auth without verifying the prefix mismatch first.

Never auto-retry a failed query.
