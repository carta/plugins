---
name: carta-budget-actuals
model: opus
description: 'Refresh actuals in an existing Excel budget workbook from Carta MCP. TRIGGER: refresh/sync/add actuals, interleave Budget/Actual/Variance, tag-view by department/cost center. NOT: pacing, new budgets, fetch-budget, scenarios, P&L, balance sheet.'
version: 1.0.0
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
[PATTERN menus-and-flows v0.0.7]
[PATTERN base v0.1.0]

# Budget actuals

Entry point for updating actuals in an existing budget. Six references:

- [`references/add-actuals-columns.md`](references/add-actuals-columns.md) — **Layout A**: interleave Budget / Actual / Variance per month on the Budget tab (recommended for active tracking).
- [`references/add-actuals-tab.md`](references/add-actuals-tab.md) — **Layout B**: add a peer `<year> Actuals` tab alongside the Budget tab.
- [`references/refresh-existing.md`](references/refresh-existing.md) — **Layout C**: overwrite stale actuals cells in columns that already exist.
- [`references/add-period.md`](references/add-period.md) — **Layout D**: append the single next month/quarter column.
- [`references/tag-view.md`](references/tag-view.md) — **Layout E**: new tab with actuals sliced by reporting dimension (department, project code, class, etc.) and a two-row period / tag header. Only offered when the entity has tagged journal data.
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
| 5 | **Build a tag-view tab — actuals sliced by reporting dimension** (department, project code, class, etc.) | [`tag-view.md`](references/tag-view.md) — only offered when the entity has tagged data; see Gate 2.5 |

Use the user's prompt only as a *hint* for which option to highlight —
never as authority to skip the question:

| Phrase in the prompt | Hint |
|---|---|
| "interleave", "Budget / Actual / Variance", "variance by month", "add `<year>` actuals" (no other clue) | Option 1 (also the default `← recommended`) |
| "add a tab", "track on its own tab", "separate actuals tab" | Option 2 |
| "refresh", "the actuals are stale", "pull latest", "sync" | Option 3 |
| "add next month", "extend through `<month>`", "next period" | Option 4 |
| "by department", "by tag", "by cost center", "split by", "broken down by", "by reporting tag", "by project code" | Option 5 |

**Option 5 availability**: always show Layout E in the chooser. If the user
picks it and Gate 2.5 finds no tag data on the entity, tell them in one sentence
and fall back to Layout A automatically. Do not pre-filter the chooser — the
entity name needed for the probe is not available until Gate 3.

The user's pick locks the reference to load for the rest of the
workflow. **Immediately call `read_skill` for the chosen layout — do not reconstruct from memory:**

| Layout chosen | Call |
|---|---|
| Option 1 — Interleave columns | `read_skill(file_path="references/add-actuals-columns.md")` |
| Option 2 — Add actuals tab | `read_skill(file_path="references/add-actuals-tab.md")` |
| Option 3 — Refresh existing | `read_skill(file_path="references/refresh-existing.md")` |
| Option 4 — Add single period | `read_skill(file_path="references/add-period.md")` |

> **Why we always ask:** the same prompt — "add 2026 actuals by month"
> — can mean Option 1, 2, or 3 depending on the user's intent and the
> current state of their workbook. Guessing wrong and rebuilding costs
> the user a corrective prompt. Asking once costs one click. **Choose
> the click.**

---

## Gate 2.5 — Tag-category discovery (Layout E path only)

**Skip this gate entirely unless the user chose Layout E at Gate 2.**

**Silent probe — no user-facing output.** Layout E shows **all firm tag categories side by side** under each period band — no "which dimension?" picker. The probe's job is to discover the firm's tag taxonomy from `REPORTING_TAGS_JSON` (or fall back to the flat `REPORTING_TAGS` column when only that's populated).

### Probe 1 — Detect the JSON-vs-flat path

```
fetch(command="dwh:execute:query", params={
  "sql": "SELECT
            COUNT_IF(REPORTING_TAGS_JSON IS NOT NULL) AS json_rows,
            COUNT_IF(REPORTING_TAGS IS NOT NULL)      AS flat_rows
          FROM <journal_entries_table>
          WHERE FUND_NAME = '<entity_name>'
            AND EFFECTIVE_DATE >= DATEADD('year', -1, CURRENT_DATE)",
  "format": "markdown"
})
```

- `json_rows > 0` → **JSON path**. Continue to Probe 2.
- `json_rows == 0 AND flat_rows > 0` → **flat path**. Skip Probe 2 — there is exactly one synthetic category labeled `Reporting Tag`. Set `<CATEGORIES> = ["Reporting Tag"]` and continue to Probe 3 (cardinality).
- Both zero → no tag data on this entity. Tell the user in one plain-English sentence — *"Your journal data doesn't have any reporting tags, so I'll build a flat actuals view instead."* — and fall back to **Layout A**.

### Probe 2 — Discover categories (JSON path only)

```
fetch(command="dwh:execute:query", params={
  "sql": "SELECT DISTINCT f.key::TEXT AS category
          FROM <journal_entries_table>,
               LATERAL FLATTEN(input => REPORTING_TAGS_JSON) f
          WHERE FUND_NAME = '<entity_name>'
            AND REPORTING_TAGS_JSON IS NOT NULL
            AND EFFECTIVE_DATE >= DATEADD('year', -1, CURRENT_DATE)
          ORDER BY 1",
  "format": "markdown"
})
```

Store the returned keys as `<CATEGORIES>` (sorted list — e.g. `["Department", "Function", "Geography"]`).

### Probe 3 — Cardinality per category

Run **one** query that returns the value count per category (used to drive the wide vs long decision):

**JSON path:**
```
fetch(command="dwh:execute:query", params={
  "sql": "SELECT f.key::TEXT AS category, COUNT(DISTINCT f.value::TEXT) AS n_values
          FROM <journal_entries_table>,
               LATERAL FLATTEN(input => REPORTING_TAGS_JSON) f
          WHERE FUND_NAME = '<entity_name>'
            AND REPORTING_TAGS_JSON IS NOT NULL
            AND EFFECTIVE_DATE >= DATEADD('year', -1, CURRENT_DATE)
          GROUP BY 1
          ORDER BY 1",
  "format": "markdown"
})
```

**Flat path:**
```
fetch(command="dwh:execute:query", params={
  "sql": "SELECT 'Reporting Tag' AS category, COUNT(DISTINCT REPORTING_TAGS) AS n_values
          FROM <journal_entries_table>
          WHERE FUND_NAME = '<entity_name>'
            AND REPORTING_TAGS IS NOT NULL
            AND EFFECTIVE_DATE >= DATEADD('year', -1, CURRENT_DATE)",
  "format": "markdown"
})
```

Store as `<CARDINALITY>` (map of `category → n_values`). Compute the **total column count**:

```
total_columns = sum(n_values for each category) + len(<CATEGORIES>)
```

The `+ len(<CATEGORIES>)` term covers the per-category Total columns. If the run uses Quarter or Month aggregation across multiple period blocks, multiply by the number of period blocks for the layout decision.

### Wide vs long decision

The authoritative thresholds live in [`references/tag-view.md`](references/tag-view.md) §"Cardinality guard" — `≤ 24` wide / `25–36` ask / `> 36` long. Keep that file as the single source of truth; the inline cutoffs below mirror it for runtime convenience and must move together if the table changes.

If `total_columns > 24` (single period) or `total_columns × n_period_blocks > 24` (multi-period), ask via `AskUserQuestion`:

> The tag-view tab would have `<N>` columns across `<C>` categories. With that many, should I build a wide table (one column per tag per category per period) or a long table (one row per tag per account)?

- **Wide — one column per tag** ← recommended for ≤ 36
- **Long — one row per tag per account**

Store `<TAG_LAYOUT>` (`wide` | `long`). Default `wide` for ≤ 24 (no question asked); default `long` for `> 36` (no question asked).

---

## Gate 3 — Batched parameter gate

In one `AskUserQuestion`, confirm every parameter the prompt didn't already specify.

**Entity:** confirm `<ENTITY_NAME>` — the exact `FUND_NAME` value used in DWH queries. If the user named one at Gate 0, pre-fill it and only ask if it's ambiguous.

**Period:** offer smart defaults based on today's date (currently May 2026):

> What period should I pull actuals for?

| # | Label | Date range |
|---|---|---|
| 1 ← recommended | **Full year 2026** | Jan 1 – Dec 31, 2026 |
| 2 | **YTD 2026** (Jan – May) | Jan 1 – May 31, 2026 |
| 3 | **Q2 2026** (Apr – Jun, in progress) | Apr 1 – Jun 30, 2026 |
| 4 | **Full year 2025** | Jan 1 – Dec 31, 2025 |
| 5 | **Custom range** — I'll specify start / end month | — |

Adapt `← recommended` and visible options to context: YTD if the user said
"latest"; full year if they said "2026 actuals"; prior year if they said "2025".
Always compute the current quarter's label dynamically from today's date — do
not hardcode Q2.

If the prompt already specified a period (e.g. "Q1 2026", "full year 2025"),
store it directly and skip the period question.

Store `<PERIOD_START>` (first day, `YYYY-MM-DD`) and `<PERIOD_END>` (last day).

**Match strategy** (Layouts A–D only): `name first then GL code` (default) vs `GL code only`. Omit for Layout E (no existing-sheet matching needed — Layout E always writes a new tab).

Store `<ENTITY_NAME>`, `<PERIOD_START>`, `<PERIOD_END>`, `<MATCH_STRATEGY>` (Layouts A–D).

### Gate 3a — Aggregation level (Layout E only)

**Skip this sub-gate for Layouts A–D** — aggregation is always monthly there. Set `<AGGREGATION> = MONTH` and continue.

**For Layout E, this MUST be a separate `AskUserQuestion` call** — do not bundle with the period question above, and do not infer the answer from the period range. A YTD period (e.g. Jan–May) does not mean "Quarter"; a full-year period does not mean "Year". The user picks the period independently from the aggregation.

> Aggregate tag columns by:

| # | Label |
|---|---|
| 1 ← recommended | **Year** — one period block per year |
| 2 | **Quarter** — one block per quarter |
| 3 | **Month** — one block per month |

Store `<AGGREGATION>` (`YEAR` | `QUARTER` | `MONTH`).

**Hard rule:** if you find yourself building a tag-view with multiple period blocks (e.g. Q1+Q2) without an `AskUserQuestion` whose answer literally selected one of the three options above, you skipped this gate. Stop and ask before proceeding to Gate 4.

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

**Layout E:** use the category-grouped query from
[`references/tag-view.md`](references/tag-view.md) §SQL. Pick the **JSON path**
when Gate 2.5 detected `REPORTING_TAGS_JSON` rows; the **flat path** when only
`REPORTING_TAGS` was populated. Substitute `<period_trunc>` from `<AGGREGATION>`,
`<period_start>` from `<PERIOD_START>`, `<period_end>` from `<PERIOD_END>`, and
`<entity_name>` from `<ENTITY_NAME>`. The JSON path discovers `<CATEGORIES>`
inside the query via `LATERAL FLATTEN` — do not parameterize the category list
into the SQL. All other rules below apply unchanged.

**Layouts A–D:** always call through [`references/get-actuals.md`](references/get-actuals.md).
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

### Gate 7 requires AT LEAST four separate `execute_office_js` calls (excel-addin runtime)

The most common failure mode is bundling cell writes + formatting + logo + verification into one `writeSheet(...)` function — the model writes the cells, returns, hardcodes the logo height, and the user gets a misaligned logo they have to resize manually. **Do not combine the cell-write call with the brand block in a single office.js block.**

- **Call 1:** apply the cell updates from the approved payload. One `execute_office_js`. Return.
- **Call 2:** currency-format readback (see below). Return.
- **Call 3 (per tab touched):** logo via the verbatim brand block (paste from below — DO NOT paraphrase, DO NOT hardcode the height, DO NOT anchor to a single cell).
- **Call N (verification, LAST):** load shape geometry + E1:E3 range geometry on every tab touched, confirm `CartaLogo` exists AND its height equals the row-band height.

Returning from Call 1 does NOT finish Gate 7. The verification call must appear in your tool history before Gate 8 summary.

### Verbatim brand block — paste this, do not improvise

The single most common logo regression is hardcoding `shape.height = 48` (or any other pixel value) instead of using the actual E1:E3 row-band height. Excel's row heights depend on font sizes set during Call 1, so the band height can vary tab-to-tab. The model that hardcodes 48 produces a logo that either spills past row 3 or sits inside row 1 — the user then has to resize manually. **Paste this block verbatim per tab; substitute only `<TAB_NAME>`:**

```javascript
const base64 = blobs.getText("assets/powered_by_carta.b64.txt").trim();

const sheet = context.workbook.worksheets.getItem("<TAB_NAME>");
const shapes = sheet.shapes;
shapes.load("items/name");
await context.sync();

// De-dup: remove any prior CartaLogo so re-runs don't stack shapes.
for (const s of shapes.items) {
  if (s.name === "CartaLogo") s.delete();
}
await context.sync();

// Anchor to the FULL row band E1:E3 — never a single cell.
const rows = sheet.getRange("E1:E3");
rows.load(["left", "top", "height"]);
await context.sync();

const image = sheet.shapes.addImage(base64);
image.name = "CartaLogo";

image.load(["width", "height"]);
await context.sync();
const ratio = image.width / image.height;

image.lockAspectRatio = false;
image.height = rows.height;        // ← match actual row-band height, never a pixel literal
image.width  = rows.height * ratio;
image.left   = rows.left;
image.top    = rows.top;
image.lockAspectRatio = true;
await context.sync();
```

**Forbidden patterns (these reproduce the manual-resize bug):**

- `image.height = 48` (or any number literal) — height MUST come from `rows.height`.
- `sheet.getRange("E1")` instead of `sheet.getRange("E1:E3")` — single-cell anchor loses the band height.
- Skipping the de-dup loop — re-runs stack a second `CartaLogo` shape on top of the first.
- Skipping `image.lockAspectRatio = false` before sizing — Excel resists width changes if locked.

Only touch the cells the user approved. Do not edit formulas elsewhere
in the sheet (subtotals are formula-driven and will auto-update).

**Before any write**, call both of these in the same message (parallel reads):

1. `read_skill(file_path="references/branding-and-header.md")` — 4-row metadata band, logo placement, `blobs.getText` asset pattern, cell-comment API.
2. `read_skill(file_path="references/<layout-from-gate-2>.md")` — the layout file chosen in Gate 2 (e.g. `add-actuals-columns.md` for Layout A).

Do not reconstruct either spec from memory. Both files must be in your context before generating any `execute_office_js` or `write_workbook.py` code. The `branding-and-header.md` file defines:

- The reserved 4-row metadata band (A1–A4 + blank A5) that every tab must carry — per-skill override (this skill uses column A so the band left-edges with the account-label column underneath). If the existing budget tab doesn't have it, add it as part of this write (shift the data down to row 6+ first via `sheet.getRange("1:5").insert(...)` in Excel add-in mode, or via prepended row writes in local-file mode).
- The Carta logo placement (column E, rows 1–3 height) — apply to every tab this skill touches, including the actuals tab(s) it adds.
- The blobs.getText asset-loading pattern for Excel add-in mode (NOT `Read`).
- The cell-comment pattern for any sparse-history / low-confidence flag.

**If `<RUNTIME>` is `excel-addin`:**

- **Layouts A–D:** load `references/add-actuals-columns.md` §5 ("Build the rebuild payload") and apply its header / column / format spec verbatim — especially the two-row header (row N = merged month labels, row N+1 = `Budget` / `Actual` / `Variance` sub-headers — spelled out in full, never abbreviated). Then use the add-in's cell-write tools to execute the payload.
- **Layout E:** load [`references/tag-view.md`](references/tag-view.md) §"Writing the workbook (excel-addin runtime)" and follow it verbatim — 3-row period/category/tag header, `range.merge(true)` for period and category bands. **Do NOT freeze panes** — same rule as Layouts A–D and the rest of the Carta budgeting skills.

**If `<RUNTIME>` is `local-file`:** build an operations payload and apply it:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py" --stdin <<'JSON'
{
  "workbook_path": "<DESTINATION_PATH>",
  "operations": [ ... ]
}
JSON
```

- **Layouts A–D:** use only `write_cell` / `write_formula` / `set_format` operations. Avoid `create_sheet` and `write_range` here — those are for `carta-create-budget`.
- **Layout E:** use `create_sheet`, `write_cell`, `write_range`, `merge_cells`, `set_bold`, `set_format`, `set_column_width` (Account col), `autofit_columns` (data cols) per [`references/tag-view.md`](references/tag-view.md) §"Writing the workbook (local-file runtime)". Always issue `write_cell` for a period label **before** the `merge_cells` op for that same range. **Do NOT include `freeze_panes`** — same rule as Layouts A–D and the rest of the Carta budgeting skills.

### Currency-format verification (REQUIRED, observable, excel-addin only)

Excel renders bare `$` against the workbook's locale — `R$` on pt-BR, `£` on en-GB, `¥` on ja-JP. The `[$$-en-US]` locale token locks the display to USD regardless. Even though every reference mandates the locale-prefixed format, models routinely emit bare `$` when generating the office.js inline. This check is the only thing that catches the regression before the user sees R$.

After the cell-write call (and before branding), run this readback as a **separate** `execute_office_js` call:

```javascript
const tabs = [/* tab names touched this run */];
const samples = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  // Pick one amount cell — the first numeric data cell typically lives at C7 (Layout E) or B8 (Layouts A-D).
  // Substitute the actual address from the payload you just wrote.
  const cell = sheet.getRange("<sample_amount_cell>");
  cell.load("numberFormat");
  await context.sync();
  samples[tabName] = cell.numberFormat[0][0];
}
return samples;
```

Each value MUST contain the literal substring `[$$-en-US]`. If any tab's sample format is `_($* #,##0...`, `$#,##0`, `"$"#,##0`, or anything else without `[$$-en-US]`, the format is wrong — Excel will render currency in the user's local symbol. **Halt, re-apply the format to the full amount range on that tab, and re-verify.**

```javascript
// Re-format if verification failed
const fmt = "_([$$-en-US]* #,##0.00_);_([$$-en-US]* (#,##0.00);_([$$-en-US]* \"-\"??_);_(@_)";
sheet.getRange("<full_amount_range>").numberFormat = [[fmt]];
```

Do not proceed to branding until every sampled cell returns a format string containing `[$$-en-US]`.

### Branding verification (REQUIRED, observable, excel-addin only)

After running the brand block for every tab this skill touched, run this verification as a **separate** `execute_office_js` call before proceeding to Gate 8. The check goes beyond confirming the shape exists — it also confirms the logo was **sized to the E1:E3 row band**, not a hardcoded pixel value:

```javascript
const tabs = [/* "Budget 2026", "2026 Actuals", ... — substitute the actual tab names touched this run */];
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name,items/height,items/left,items/top");
  const rows = sheet.getRange("E1:E3");
  rows.load(["height", "left"]);
  await context.sync();

  const logo = sheet.shapes.items.find(s => s.name === "CartaLogo");
  result[tabName] = {
    found:           !!logo,
    shapeHeight:     logo ? logo.height : null,
    rowBandHeight:   rows.height,
    heightMatchesBand: logo ? Math.abs(logo.height - rows.height) < 2 : false,
    shapeLeft:       logo ? logo.left : null,
    rowBandLeft:     rows.left,
    leftMatchesBand: logo ? Math.abs(logo.left - rows.left) < 2 : false,
  };
}
return result;
```

Per-tab pass criteria — ALL must be true:

- `found === true` (`CartaLogo` exists on the tab)
- `heightMatchesBand === true` (logo height equals `E1:E3` row-band height ±2pt — proves no pixel literal)
- `leftMatchesBand === true` (logo anchors at column E's left edge ±2pt — proves correct `getRange("E1:E3")` anchor)

If any tab returns `found: false`, the brand block was skipped — re-run it. If `heightMatchesBand` is `false`, the brand block was paraphrased with a hardcoded height (e.g. `shape.height = 48`) — delete the existing `CartaLogo` shape and re-run the verbatim brand block above. If `leftMatchesBand` is `false`, the brand block anchored to a single cell like `E1` instead of `E1:E3` — same fix.

**Do not start Gate 8 summary text until every tab's verification result shows `found: true && heightMatchesBand: true && leftMatchesBand: true`.** The verification call is observable evidence; without it in your tool history with passing checks, Gate 7 is not complete.

---

## Gate 8 — Summary + next steps

**Gate 8 precondition (DO NOT SKIP).** Before sending the summary text below, scan your tool history. Four anchors MUST be present in this order (excel-addin runtime):

1. An `AskUserQuestion` whose answer included `"Approve and apply the updates"` — Gate 6 approval.
2. The currency-format-verification `execute_office_js` whose result returned a `numberFormat` string containing `[$$-en-US]` for every tab touched — Gate 7 currency check.
3. A `sheet.shapes.addImage(base64)` call for **each** tab the skill touched (one per tab) — Gate 7 branding.
4. The branding-verification `execute_office_js` whose result showed `CartaLogo` on every tab — Gate 7 branding verification.

If any anchor is missing, you have skipped a gate. **Do NOT write "Carta logo placed at..." in the summary when no `shapes.addImage` call appears in your tool history — that's hallucinating completion.** STOP, go back, run the missing gate, then return here.

**Layouts A–D — If `<RUNTIME>` is `excel-addin`:**

> Refreshed 23 lines on [Budget 2026](<citation:Budget 2026!A1:Z80>)
> (Example MgmtCo). 2 lines zeroed (Audit, Tax Prep — no Q1 activity).
> 1 new account inserted under Operating Expenses (AI Tooling).
> 2 suspicious-zero flags — Salaries and Leased-employee payments
> dropped to $0; could be posting lag.

**Layouts A–D — If `<RUNTIME>` is `local-file`:**

> Refreshed 23 lines on `Budget 2026` in
> `file:///path/to/<budget-workbook>.xlsx` (Example MgmtCo). 2 lines zeroed (Audit, Tax Prep — no Q1 activity). 1 new
> account inserted (AI Tooling, Operating Expenses). 2 suspicious-zero
> flags — Salaries and Leased-employee payments.

**Layout E — If `<RUNTIME>` is `excel-addin`:**

> Created [2026 Actuals by Department](<citation:2026 Actuals by Department!A1>) (Example MgmtCo) — 23 accounts × 4 department values (Engineering, Marketing, G&A, Untagged), annual aggregation. 1 account flagged low-confidence (sparse history). Carta logo placed at E1.
>
> Substitute the period block phrasing to match `<AGGREGATION>` from Gate 3a: "annual aggregation" for `YEAR`, "across 4 quarters" / "across Q1+Q2" for `QUARTER`, "across 12 months" / "across Jan–May" for `MONTH`.

**Layout E — If `<RUNTIME>` is `local-file`:**

> Created `2026 Actuals by Department` tab in `file:///path/to/<budget-workbook>.xlsx` (Example MgmtCo) — 23 accounts × 4 department values, annual aggregation. 1 account flagged low-confidence (sparse history). Adjust the period phrasing to match `<AGGREGATION>` (see excel-addin example above).

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
- **Recalc + column widths:** the last statements in the cell-write `execute_office_js` block (Call 1), in this order — never a separate call: restore automatic calc → `context.workbook.application.calculate(Excel.CalculationType.full)` → `sheet.getRange("A:AO").format.autofitColumns()` (widen the range to the last amount column) → `context.sync()`. **Recalc before autofit:** without the forced recalc the `=SUM(...)` / variance / NOI cells stay at 0 and the accounting format shows `-` (forcing the user to edit+Enter each one); autofitting before the recalc sizes the amount columns to the dash so real figures overflow as `####`. Never autofit a header-only range.
- **Branding standards — follow [`references/branding-and-header.md`](references/branding-and-header.md)** for every tab. Per-skill overrides: metadata band in column A (not B), logo at column E. Asset access via `blobs.getText("assets/...")`.

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
