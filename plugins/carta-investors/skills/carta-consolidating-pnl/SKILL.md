---
name: carta-consolidating-pnl
model: opus
description: 'Generate a firm-wide consolidating P&L (Income Statement) for ALL entities under a firm for a given month — produces TWO Excel tabs: a detailed "P&L- with comments" tab (Month + YTD blocks of Actual/Budget/Variance/%) and a one-page executive "Summary P&L" tab formula-linked to the detail. Sourced from Carta MCP. TRIGGER on requests like "consolidating P&L for [firm] for [month]", "P&L for all entities of [firm]", "firm-wide income statement", or "P&L with executive summary". DO NOT TRIGGER for single-entity P&L, balance sheet (carta-consolidating-balance-sheet), new budgets (carta-create-budget), pulling Carta-stored budgets (carta-fetch-budget), refreshing actuals (carta-budget-actuals), pacing (carta-budget-vs-actuals), or what-if (carta-budget-scenarios).'
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
  - Read
  - AskUserQuestion
---

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN base v0.1.0]

# Consolidating P&L (detail + executive summary)

Generates a firm-wide consolidating Income Statement for a single month, as
**two linked tabs**:

1. A **detail tab** (`P&L - <FIRM-SHORT> <MMM-YY>`) matching the
   "P&L- with comments" format, with Month and YTD blocks of Actual /
   Budget / Variance / %.
2. A **Summary P&L** tab at sheet position 0 — a one-page executive
   summary that rolls the detail up into a small set of category lines,
   formula-linked back to the detail.

The data is pulled live from Carta's DWH via the Carta MCP connector —
nothing is embedded in the skill.

This skill runs primarily inside the **Claude for Excel** add-in. The
audience is an accountant working in their workbook, not an engineer
running CLI commands.

## UX Rules

This skill ships as a standalone Claude for Excel skill — the global `carta-skill-ux-rules` SessionStart hook covers currency formatting, status vocabulary, no-UUID display, and plain-English speech. Skill-specific deviations:

- **Citation links** to Excel ranges use the citation form: `[B1:Q72](<citation:P&L - Acme Mar-26!B1:Q72>)`.
- **No environment URLs.** This skill builds Excel output, not Carta web links — the BASE_URL rule from the global hook does not apply.

## Environment detection (Claude for Excel)

This skill does **not** call `carta auth-status` — that command isn't
available inside the Excel add-in. Instead, the active Carta environment
is detected at Gate 0 from the connected MCP server's prefix
(`mcp__claude_ai_Carta_<Env>__fetch`).

## When to use

Trigger on any request shaped like:

- "(Consolidating) P&L for `<FIRM>` for `<MONTH>`" — with or without "with executive summary"
- "P&L for all entities of `<FIRM>`" / "firm-wide income statement"
- Any ask to replicate the "P&L- with comments" + Summary P&L pair for another firm/period

Do **NOT** use this skill for:

- **Single-entity P&L** — use the single-entity P&L workflow (this skill always rolls up across every entity)
- **Balance Sheet** requests — use `carta-consolidating-balance-sheet`
- **Multi-period trend** analysis or **per-entity side-by-side columns** — clarify before building; this skill produces ONE consolidated Actual column per period

## Inputs to collect

Before running, confirm with the user:

1. **Firm name** — must match a firm reachable from the active Carta MCP
   context (resolved fuzzily). Example: `Acme Ventures`.
2. **Month** — format as `YYYY-MM` (e.g. `2026-03` for March 2026). Used
   for both the month block and the YTD-through-month block.

If the user gave both in the request, proceed without re-asking.

---

## Gate 0: Identify the Carta MCP environment

1. Call `refresh_mcp_connectors`. Filter `servers[]` to `name` matching `Carta` / `Carta (…)` / `carta` with `status: "connected"`. Drop `failed`.
2. For each connected, probe both prefix forms in parallel: `mcp__claude_ai_Carta__welcome` and `mcp__carta__welcome`. First success = `<SERVER>`.
3. **Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every command is gated.

If none connected, list `failed` connectors and stop. If multiple, default to `Carta` (production).

---

## Gate 1: Resolve firm

1. `fetch(command="contexts:list", params={"firm_name": "<FIRM>"})`. Multiple matches → `AskUserQuestion`. Wait for confirmation.
2. `set_context(firm_id=<uuid>)`. Prefer granular tools when exposed.

**DWH param-name traps:** `dwh:execute:query` takes `sql:` not `query:`. `dwh:get:table_schema` takes `table_name:` not `table:`. `format` accepts `"ndjson"` / `"markdown"`, not `"csv"`.

**Do NOT call `fa:list:entities`** — firm-wide consolidation aggregates via SQL.

---

## Gate 2: Pull the two period blocks

The schema and sign conventions for the Carta DWH journal-entries
table are documented in `references/schema.md`. Load that file now
and apply its rules.

Compute the period boundaries:

- `month_start` = first day of the month
- `month_end` = last day of the month
- `ytd_start` = `<YYYY>-01-01`

**Single query, both periods at once, summed across all entities under the
firm:**

```sql
SELECT
  ACCOUNT_TYPE,
  ACCOUNT_NAME,
  SUM(CASE WHEN EFFECTIVE_DATE BETWEEN '<month_start>' AND '<month_end>' THEN AMOUNT ELSE 0 END) AS MONTH_AMT,
  SUM(CASE WHEN EFFECTIVE_DATE BETWEEN '<ytd_start>'   AND '<month_end>' THEN AMOUNT ELSE 0 END) AS YTD_AMT
FROM <journal_entries_table>
WHERE FIRM_ID = '<firm_uuid>'
  AND ACCOUNT_TYPE >= '4000'
  AND EFFECTIVE_DATE BETWEEN '<ytd_start>' AND '<month_end>'
GROUP BY 1, 2
HAVING SUM(CASE WHEN EFFECTIVE_DATE BETWEEN '<ytd_start>' AND '<month_end>' THEN AMOUNT ELSE 0 END) <> 0
ORDER BY 1, 2
```

### DWH result formatting

Queries > 50 rows: request `format: "ndjson"`, bucket into a blob. Don't paste large results — triggers `context_snip`. Use `"markdown"` only for ≤50-row previews.

Run via `fetch(command="dwh:execute:query", params={"sql": "..."})`.
SELECT-only.

**Critical**: no `FUND_NAME` filter. The GROUP BY on `ACCOUNT_TYPE,
ACCOUNT_NAME` automatically rolls up the same COA account across every
entity into a single row.

**The `HAVING ... <> 0` clause filters out accounts with no YTD actuals.**
That's correct for this stage — but **do not** treat that filtered set as
the final row list for the workbook. If a budget is loaded in Gate 4b,
accounts with budget but zero actuals must still appear as rows (with `-`
or `0` in the Actual columns). The row-set merge happens at the start of
Gate 6 — see "Row set: union of actuals + budget" there.

**Done when:** the period dataset is loaded — Month + YTD amounts for every
P&L account with non-zero YTD activity, aggregated firm-wide.

---

## Gate 3: Classify and assign to sections

Classify by leading digit of `ACCOUNT_TYPE`, per `references/schema.md`:

- `4xxx` → **Revenue** — multiply `MONTH_AMT` and `YTD_AMT` by `-1` for
  positive display (credits stored as negative)
- `5xxx` – `9xxx` → **Expenses** — keep as-is (debits stored as positive)

Then load `references/section-map.md` and apply its keyword table to assign
each expense account to a section. Order matters — **first match wins**.
Sort within each section by `ACCOUNT_TYPE` ascending.

Revenue forms its own section — do NOT run revenue accounts through the
expense map. Revenue subtotal label is `Investment Income`.

`Other` is the catch-all and is always included even if empty.

**Note:** this gate only classifies accounts that have non-zero actuals.
Budget-only accounts (loaded in Gate 4b) are classified separately using
the same rules at the start of Gate 6, then merged into the row set.

**Done when:** every non-zero actuals account is in exactly one section.

---

## Gate 4: Pre-build review

Before touching the user's workbook, show a plain-English preview so the
accountant can sanity-check the build and edit if anything looks off. This
is the pre-flight checkpoint — no Excel changes happen until the user
explicitly confirms.

Present a short, scannable summary:

> **Ready to build the P&L — please review.**
>
> - **Firm:** Acme Ventures
> - **Period:** March 2026 (Month + YTD through Mar 31, 2026)
> - **Scope:** firm-wide consolidating across all entities
> - **Revenue accounts:** 4 (Bank interest, Monitoring income,
>   Flow-through distributions, Unrealized gains)
> - **Expense accounts:** 32, grouped into Human Capital, Contractor
>   Expenses, Occupancy & Office, Professional Services, Travel &
>   Marketing, Technology & Data, Other
> - **Sheets to write:**
>     - `P&L - Acme Mar-26` (detail)
>     - `Summary P&L` (executive summary, first tab)
>
> Note: if you pull from a budget source below, accounts that have a
> budget but no actuals this period will also be added as rows (with
> `$0` actuals) — final count may be slightly higher than the
> totals above.

If any expense accounts landed in `Other`, surface them here:

> ⚠ **3 accounts landed in `Other`:** "Carried interest expense",
> "Foreign exchange", "Misc operating". Confirm or adjust the section
> mapping before building.

Then ask with `AskUserQuestion`:

```
1 - Build both tabs  ← recommended
2 - Build the detail tab only (no Summary)
3 - Change the firm or period
4 - Cancel
```

Handle each branch:

- **1 — Build both tabs** → proceed to the budget source question below.
- **2 — Detail only** → drop the Summary build from the plan; proceed
  to the budget source question below. Gates 5–6 run only, then Gate 8
  verifies the detail alone and omits the Summary tie-out.
- **3 — Change firm or period** → return to Inputs, re-run Gates 1–3,
  then present this review again.
- **4 — Cancel** → stop the skill cleanly.

**Loop until the user picks a build option or cancels.** Never write to
Excel based on inferred intent.

**Do not** surface internal field names (`ACCOUNT_TYPE`, `MONTH_AMT`,
`EFFECTIVE_DATE`) or UUIDs in this review — translate to plain accountant
language.

**Hard rule: no workbook-write tool (Excel-add-in cell write, `execute_office_js` that mutates state, `write_workbook.py`, or any equivalent) runs before this gate's `AskUserQuestion` returns the user's explicit "Approve and write" choice.** If you find yourself about to call a workbook-write tool without that approval recorded, stop and run this gate first. This is not negotiable — silently writing without approval breaks user trust.

### Budget source question (batched with the build chooser)

Ask the build chooser and the budget-source chooser **in a single
`AskUserQuestion` call** with both questions in the `questions` array.
This saves a user round trip — the chooser UI in Claude for Excel
renders two stacked dropdowns from one call. Do NOT make two separate
`AskUserQuestion` calls for these.

If the user picks "Cancel" on question 1, ignore their answer to
question 2 and stop the skill cleanly — the budget-source answer is only
acted on when the build choice is option 1 or 2.

Framing for the second question:

> **Where should I get the Budget figures?**

| # | Option | What happens |
|---|---|---|
| 1 | **Pull from Carta** ← recommended | Fetches the ManCo budget live from Carta before building. |
| 2 | **Import from an Excel file** | Asks for a file path; reads the file now. |
| 3 | **Import from another tab in this workbook** | Deferred — picked up in Gate 5 once the workbook is identified. |
| 4 | **Leave Budget blank** | Columns E + N stay empty; Variance / % will render `n/a`. |

Mark `← recommended` based on context — Carta by default; Skip if the
user's prompt explicitly excluded budget (e.g. "build without budget").

Record the budget source choice. Proceed to Gate 4b.

**Done when:** the user has confirmed the build, with their chosen
firm/period locked in, the Summary-tab opt-in/opt-out recorded, and
the budget source choice recorded.

---

## Gate 4b: Fetch budget data

Fetch the budget rows now — before any Excel writes — so Gate 6 can
write Budget columns E + N in the same pass as the detail build.

### Option 1 — Pull from Carta

Read [`references/budget-fetch.md`](references/budget-fetch.md) now and
follow Part A (entity picker) + Part B (fetch). Then return here with the
budget rows in the output shape that file documents.

**Narrow the date window in the `fa:list:budgets` call** — pass `start_date = <ytd_start>` and `end_date = <month_end>` (the same YTD window Gate 2 uses). An un-narrowed call returns the full annual budget (~44KB for a typical ManCo), which forces an extra round-trip through `code_execution` and burns context. The YTD-window response is small enough to handle inline.

Source label: `Carta Fund Admin (live) — <ManCo name>`.
Set `scope = "single-entity"`, `entity_name = "<ManCo name>"` — the
single-entity-vs-firm-wide flag in `fill-budget-columns.md` step 1 will
fire because this P&L is firm-wide consolidating.

After the budget rows are loaded, call `context_snip` on the raw `fa:list:budgets` response — you only need the normalized `{gl_code, account_name, month_budget, ytd_budget}` rows downstream.

### Option 2 — Excel file

Ask the user for the budget workbook via `AskUserQuestion`. In Claude for
Excel, the user attaches the file to the conversation; use the add-in's
file-read capability to load it. Don't shell out to Python — this skill
runs entirely inside the Excel add-in.

Parse the loaded workbook for budget rows. Header-detection heuristic:
the first row whose columns include both an account-code-like value
(numeric string) AND a month-like header (`Jan`, `Jan 2026`, `2026-01`)
is the header row. Read data rows beneath it.

Pivot to the same shape `budget-fetch.md` documents at the bottom:
`rows: [{gl_code, account_name, month_budget, ytd_budget}, ...]`.

Source label: `Imported from <filename>`. Set `scope = "single-entity"`
if the file's title block names a single entity; otherwise ask the user
which scope applies.

### Option 3 — Another tab in this workbook

Defer: record `budget_source = "workbook_tab"` and proceed to Gate 5.
Gate 5 will list the open workbook's tabs and ask which one holds the
budget. Then parse and store the rows before Gate 6 writes.

### Option 4 — Skip

No fetch. Set `budget_source = "skip"` and proceed to Gate 5.

**Done when:** budget rows are loaded in memory (or `skip` is recorded)
and `source_label` is set for Gate 8's report.

---

## Gate 5: Decide the output destination

This skill is designed to run inside the **Claude for Excel** add-in.
Before writing anything, decide whether to write into the user's currently
open workbook or to create a new one.

1. **Check for an active workbook.** Use the Excel add-in's
   "active workbook" / "current workbook" tool (whatever name the add-in
   exposes at runtime) to see if there is a workbook open in front of the
   user.
2. **Decide the destination using this matrix** — there are three cases,
   not two. The empty-workbook case is the one most often mishandled:

   | Case | Trigger | Action |
   |---|---|---|
   | **A. No workbook open** | Add-in reports no active workbook | Create a new workbook silently. Tell the user in one sentence that you created `P&L - <FIRM-SHORT> <MMM-YY>.xlsx` because nothing was open. |
   | **B. Empty workbook open** | One sheet, `maxRows == 0`, no data, no other tabs (e.g. a fresh `Book1.xlsx` / `Sheet1`) | Use it without asking. **Announce the rename** in one sentence before writing: *"I'll use the empty workbook you have open and rename `Sheet1` to `P&L - <FIRM-SHORT> <MMM-YY>`."* No `AskUserQuestion` is required for the empty case — asking adds friction with no decision to make. |
   | **C. Non-empty workbook open** | Any sheet has data, OR more than one sheet exists | **Must ask via `AskUserQuestion`** before any write. Phrase concretely: *"You have `<workbook>.xlsx` open with N tabs. May I add `P&L - <FIRM-SHORT> <MMM-YY>` and `Summary P&L` to it?"* Options: `Yes, add tabs here` / `No, create a new workbook` / `Cancel`. |

   If the new sheet name would collide with an existing tab (case C),
   append a numeric suffix (`… Mar-26 (2)`) and mention the rename to the
   user in Gate 8's report. Truncate to Excel's 31-character limit
   **after** suffixing.

3. **If the user cancels** or denies edit permission for the active
   workbook **and** picks "Cancel": stop the skill cleanly. Don't fall
   back silently to creating a new file.

**The hard rule from Gate 4 still applies** — no workbook-write tool runs
before this gate has either (a) returned an explicit "Yes" answer for case
C, or (b) explicitly announced the rename for case B / new workbook for
case A. Case B removes the dialog but does NOT remove the announcement.

Lock the chosen `<destination workbook>` and the two target sheet names
(`P&L - <FIRM-SHORT> <MMM-YY>` for the detail, and `Summary P&L` for the
executive summary) and use them through Gates 6, 7, and 8.

**If `budget_source = "workbook_tab"` (deferred from Gate 4b):**
List the open workbook's tabs and use `AskUserQuestion` to ask which
one holds the budget. Same header heuristic as Gate 4b option 2. Parse
and store the rows now, before Gate 6 writes.
Source label: `Imported from tab "<TAB_NAME>" in this workbook`.
Ask the user about scope (`single-entity` vs `firm-wide`).

**Done when:** the destination workbook + both target sheet names are known
and the user has explicitly consented to any edit to a pre-existing
workbook.

---

## Gate 6: Build and brand the detail P&L tab

### Approval-recorded check (run FIRST, before any write tool)

Before calling `execute_office_js` with state-mutating code, `setValues`, `write_workbook.py`, or any other workbook-write tool, look back at your tool history. Find the most recent `AskUserQuestion` you sent. Does its answer literally include `"Approve and write"` (or the build-chooser option that maps to "Build it")? If NO, Gate 4 did not pass — send the Gate 4 approval menu now and wait for the explicit answer.

**Do not interpret upstream answers as approval.** A budget-source response from the batched chooser, a firm-pick answer, or any prior `AskUserQuestion` whose answer is not literally a build-approval choice does NOT clear this gate.

### Gate 6 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

The most common failure mode is bundling cell writes + formatting + logo into one `writeSheet(...)` function — the model writes the cells, returns, and forgets the logo. **Do not combine the cell-write call with the brand block in a single office.js block.**

- **Call 1:** cell values, formulas, formatting, headers, borders. One `execute_office_js`. Return.
- **Call 2:** logo on the detail tab via the verbatim brand block below.
- **Call 3 (verification, LAST in Gate 6):** load shape names on the detail tab, confirm `CartaLogo` exists.

Returning from Call 1 does NOT finish Gate 6. The verification call must appear in your tool history before Gate 7.

Read `references/formatting.md` AND [`references/branding-and-header.md`](references/branding-and-header.md) now and apply both verbatim. `branding-and-header.md` reserves rows 1–4 for the firm/title/source/context band and places the Carta logo at **column D** (per-skill override for carta-consolidating-pnl), rows 1–3 height. `formatting.md` documents the +4 row shift this introduces — all data row numbers downstream are offset accordingly.

### Brand block — run AFTER the cell writes (DO NOT SKIP)

The detail tab is not "built" until it carries a `CartaLogo` shape. Use the verbatim brand block from [`references/branding-and-header.md`](references/branding-and-header.md), substituting `<TAB_NAME>` = `<DETAIL_TAB_NAME>`. Per-skill override: logo anchors at **column D** (D1:D3). Asset access via `blobs.getText("assets/powered_by_carta.b64.txt")` — NOT `Read`.

**Brand-verification call (REQUIRED, observable).** Run this as a **separate** `execute_office_js` call before proceeding to Gate 7:

```javascript
const sheet = context.workbook.worksheets.getItem("<DETAIL_TAB_NAME>");
sheet.shapes.load("items/name");
await context.sync();
return sheet.shapes.items.map(s => s.name);
```

The result must include `"CartaLogo"`. If it does not, re-run the brand block above for this tab and re-verify. **Do not proceed to Gate 7 until this verification returns `CartaLogo`.** The verification call is observable evidence; without it in your tool history, Gate 6 branding is not complete.

### Column map (use exactly — do NOT add columns the skill doesn't ask for)


| Col | Month block (rows ≥ 6) | YTD block (mirror) |
|---|---|---|
| **A** | (blank, narrow margin) | — |
| **B** | Account label / section header / subtotal label | — |
| **C** | **5pt spacer** — NO Acct # / GL Code column. Leave empty. | — |
| **D** | Month Actual (raw $) | — |
| **E** | Month Budget | — |
| **F** | (spacer) | — |
| **G** | `=D{row}-E{row}` (Variance) | — |
| **H** | `=IF(E{row}>0, IF(G{row}/E{row}>1000,"1000+%",G{row}/E{row}), "n/a")` | — |
| **I** | (spacer) | — |
| **J** | Month Comments — blank in data rows | — |
| **K** | (spacer) | — |
| **L** | — | (blank) |
| **M** | — | YTD Actual |
| **N** | — | YTD Budget |
| **O** | — | (spacer) |
| **P** | — | `=M{row}-N{row}` |
| **Q** | — | `=IF(N{row}>0, IF(P{row}/N{row}>1000,"1000+%",P{row}/N{row}),"n/a")` |
| **S** | — | YTD Comments — blank |

Header bands: `D4:H4` merged + centered, content = `<MMM-YY>`. `M4:Q4` merged + centered, content = `YTD <MMM-YY>`. Both bold, white-on-black.

Row 5 headers: `D5/M5=Actual`, `E5/N5=Budget`, `G5/P5=Variance`, `H5/Q5=%`. `J4=<MMM-YY> Comments`, `S4=YTD Comments`. Bold, centered.

### Number formats — paste these literal strings, do not paraphrase

Paste these EXACT strings; never rewrite them from memory. Excel number-format strings are easy to mangle.

| Use for | Format string |
|---|---|
| Currency cells (D, E, G, M, N, P + subtotals + totals) | `_-[$$-en-US]* #,##0.00_-;_-[$$-en-US]* (#,##0.00);_-[$$-en-US]* "-"??_-;_-@_-` |
| Variance cells if you want no $ symbol (optional) | `_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)` |
| Percent cells (H, Q) | `0.0%;(0.0%)` (right-aligned) |

**The `[$$-en-US]` locale token is mandatory** — a bare `$` or `"$"` resolves to system currency on non-US locales (renders as `R$` on pt-BR, `£` on en-GB). The negatives section (after the first `;`) MUST keep the parens form `(#,##0.00)` — leading-minus is wrong and will be flagged immediately.

Section order is fixed (Revenue → Human Capital → Contractor → Occupancy →
Professional Services → Travel & Marketing → Technology & Data → Other),
documented in `references/section-map.md`. One blank row between sections.

### Row set: union of actuals + budget (do this BEFORE writing any rows)

The row set is **not** "everything Gate 2 returned". It is the **union**
of (a) accounts with non-zero actuals from Gate 2 and (b) accounts with
non-zero budget from Gate 4b. Dropping budget-only rows forces a full
rebuild the moment the user notices the gap.

If `budget_source != "skip"`:

1. Build an actuals-account set from Gate 2's result: `{(gl_code, account_name)}`.
2. Build a budget-account set from Gate 4b's `budget_rows` where Month or
   YTD budget is non-zero: `{(gl_code, account_name)}`.
3. Compute the union. For each account, record:
   - `month_actual`, `ytd_actual` — from Gate 2's row, or `null` if budget-only
   - `month_budget`, `ytd_budget` — matched from Gate 4b per the GL-code → exact-name → prefix-name precedence in `references/fill-budget-columns.md` step 2
4. Classify every account using the same Gate 3 rules. Budget-only
   accounts go through the same section map.
5. Sort within each section by `ACCOUNT_TYPE` / `gl_code` ascending.

Render every account in the union. For budget-only rows, write `0`
(hardcoded) — NOT a blank — into the Actual columns D and M. A literal
`0` keeps the Variance formula meaningful (`Budget - 0 = Budget gap`)
and signals "we checked, no actuals" rather than "data missing".

If `budget_source == "skip"`: render only the actuals row set from Gate 2.

This union step replaces the post-build "insert missing budget rows"
flow in `fill-budget-columns.md` step 4 for the Carta / file / tab cases.
That step now applies only as a fallback when budget data was unavailable
at Gate 6 time.

### Formatting checklist — must land on the first pass

Every item below must be applied during Gate 6, not patched in afterward. A first build missing any of these triggers a "fix the format" follow-up turn that costs more tokens than getting it right once.

- **Header bands merged and centered** — `D4:H4` (Month) and `M4:Q4`
  (YTD), both merged + horizontally centered.
- **Blue for input, black for formula** — Actual columns D and M and
  Budget columns E and N on every data row use font color `#0000FF`.
  Formulas (G, H, P, Q, subtotals, totals) stay default black.
- **Subtotal rows** (one per section, plus `Total expenses (pre-tax)`
  and `Net Income`) — bold, top thin border on B–H and L–Q.
- **`Total expenses (pre-tax)`** — bold, top **medium** border on B–H
  and L–Q.
- **`Net Income /(loss), pre tax`** — bold, top medium border + bottom
  **double** border on B–H and L–Q. Plus `numFmt="@"` on the column-B
  label so Excel doesn't reinterpret the slash.
- **Account label indent** — column B on every data row gets
  `indentLevel = 1` so section headers stand out.
- **Do NOT freeze panes.** This skill follows the Carta budgeting
  plugin-wide convention of no frozen rows or columns — even on a long
  P&L.
- **Header row 5 bottom border** — thin border under `B5:H5`, `L5:Q5`,
  `J5`, `S5`.

`references/formatting.md` remains the source of truth for cell coordinates and number formats.

### Sheet-write hard rules

- **Two-row header for any month-bucketed table.** This skill's layout
  already uses this pattern (month band on row 4, sub-headers on row 5).
  Never collapse the two into a single row — every subsequent merge will
  destroy the sub-headers.
- **`range.merge(true)` discards values in trailing cells.** Never merge
  cells whose contents you still need. To add a header row above
  existing sub-headers, **insert a new row first**
  (`sheet.getRange("4:4").insert(...)`) and write the merged labels into
  the inserted row — do not merge over a row that already holds sub-headers.
- **Month-label date-serial trap.** Excel auto-coerces strings like
  `"Jan 2026"` or `"Mar-26"` into a date serial (e.g. `46023`), rendering
  as a bare integer unless formatted. Either prefix with apostrophe
  (`"'Mar-26"`) to force text, set `numFmt = "@"` on the cell **before**
  writing the string, or write a real date with
  `numberFormat: "mmm yyyy"` in the same write.

### Other reminders

- Budget match precedence: GL code → exact name → prefix name (per `references/fill-budget-columns.md`). Write matched values into E and N inline during this build.
- Comments columns (J, S) stay blank in data rows.
- Totals are `=SUM(...)`; Variance is `=Actual - Budget`; Net Income is `=Revenue subtotal - Total expenses`.

**Capture cell references before moving on.** Gate 7 needs these — record
them in a small map you can address by name:

- The row number of the **Human Capital subtotal** (`Total Human Capital`)
- The row number of the **Total expenses (pre-tax)** row
- The row number of **each Revenue account**, keyed by `ACCOUNT_NAME`
  (case-insensitive)

These all stay constant between the Month and YTD blocks — the same row
is `D` in Month and `M` in YTD.

**Done when:** the detail sheet exists with both period blocks, all
sections, all subtotals, total expenses, and net income — all driven by
formulas; Budget and Comments columns blank; the row-reference map is
captured.

After the detail tab is written and read-back has confirmed the row map, call `context_snip` on the large `execute_office_js` write payloads from this gate — Gate 7 only needs the row-reference map you captured, not the full row arrays.

---

## Gate 7: Build and brand the Summary P&L tab

Read `references/summary-tab.md` AND [`references/branding-and-header.md`](references/branding-and-header.md) now and apply both verbatim. The Summary tab follows the same 4-row metadata band as the detail tab — rows 1–4 reserved for firm/title/source/context, and the Carta logo at column D anchored to D1 with height = rows 1–3. If `summary-tab.md`'s legacy layout puts the Executive Summary title on B2 with a larger font, keep it on B2 but trim the font down so it still fits inside the 4-row band (or move auxiliary text to B3/B4).

### Brand block — run AFTER the cell writes (DO NOT SKIP)

The Summary tab is not "built" until it carries a `CartaLogo` shape. Use the verbatim brand block from [`references/branding-and-header.md`](references/branding-and-header.md), substituting `<TAB_NAME>` = `<SUMMARY_TAB_NAME>`. Column D anchor (D1:D3) — same per-skill override as the detail tab.

**Brand-verification call (REQUIRED, observable).** Run this as a **separate** `execute_office_js` call before moving to Gate 8:

```javascript
const sheet = context.workbook.worksheets.getItem("<SUMMARY_TAB_NAME>");
sheet.shapes.load("items/name");
await context.sync();
return sheet.shapes.items.map(s => s.name);
```

The result must include `"CartaLogo"`. If not, re-run the Summary brand block and re-verify.

`summary-tab.md` covers sheet name, position (index 0 — first tab), header rows, the
Month and YTD blocks, the keyword buckets for revenue, the cross-sheet
formula contract back to the detail, number formats, borders, and column
widths.

Use the row-reference map captured at the end of Gate 6 to resolve every
formula on the Summary tab. **Never hardcode a number** — every Actual /
Budget cell on the Summary is a cross-sheet formula pointing at the detail
tab, so refreshing the detail updates the summary automatically.

Reminders from `references/summary-tab.md`:

- Sheet position is index 0 — the Summary appears **before** the detail
  in tab order.
- Quoted sheet names in cross-sheet formulas:
  `='P&L - <FIRM-SHORT> <MMM-YY>'!D<row>` (single quotes required
  because the tab name contains spaces).
- Empty buckets (Monitoring/Interest, Tax/Other, or Unrealized) get a
  literal `0` so `Investment Income`'s `SUM` still evaluates — and they
  must be surfaced in Gate 8's report.
- Use the same `[$$-en-US]` locale token here as on the detail tab —
  arguably more important on the Summary, which is the tab most likely
  to be screenshotted.

**Done when:** Summary P&L tab exists at position 0, every amount on it
is a formula referencing the detail tab (no hardcoded values), Net Income
reconciles to the detail for both Month and YTD.

---

## Gate 8: Verify and report

**Gate 8 precondition (DO NOT SKIP).** Before sending the report text below, scan your tool history. Three anchors MUST be present in that order:

1. An `AskUserQuestion` whose answer included `"Approve and write"` (or the Gate 4 "Build it" approval) — approval gate.
2. A `sheet.shapes.addImage(base64)` call for the detail tab — and one for the Summary tab if Gate 4 included Summary — Gate 6/7 branding.
3. The branding-verification `execute_office_js` whose result included `"CartaLogo"` for every tab — Gate 6/7 verification.

If any anchor is missing, you have skipped a gate. **Do NOT report tie-out success in the build summary when no `shapes.addImage` call appears in your tool history.** STOP, go back, run the missing gate, then return here.

After writing the detail tab (and the Summary tab, if Gate 4 included it):

1. Read back the `Net Income` row Actual columns on the **detail** (D and
   M). Verify each equals `Revenue subtotal − Total expenses`.
2. If Summary was built: read back the `Net Income` row on the **Summary**
   (C15 for Month, C28 for YTD). Verify each equals the detail's Net
   Income — Month against detail D, YTD against detail M.
3. If `budget_source = "skip"`: confirm Budget (E, N) are empty for
   detail data rows. If budget was filled: verify at least one Budget
   cell in column E is non-empty and no Budget value is written to a
   Comments column (J, S).
4. **Row-set check** (if budget was filled): sample a few budget-only
   accounts from Gate 4b that had zero actuals — they MUST appear as
   rows on the detail tab with `0` in columns D and M and their budget
   value in E and N. If any are missing, you skipped the union step at
   the start of Gate 6 — go back and fix it before reporting tie-out.
5. **Formatting spot-check** — read back a known subtotal row (e.g. the
   Human Capital subtotal) and verify it has: bold font, top thin
   border, and the column-B label is left-aligned (not indented).
   Read back the `Net Income` row and verify it has: bold font, top
   medium border, bottom double border. If either fails, the Gate 6
   formatting checklist didn't land — re-apply before claiming done.

**Report structure:**

Lead with a one-line confirmation, then a **Key tie-outs** block, then
the detail. Status vocabulary: ✅ Match, ⚠ Mismatch ($X diff).

> The P&L is ready in `<workbook>.xlsx` — [Summary P&L](<citation:Summary P&L!B1:F30>) and [P&L - <FIRM-SHORT> <MMM-YY>](<citation:P&L - <FIRM-SHORT> <MMM-YY>!B1:Q72>).

(**Substitute `<FIRM-SHORT>` and `<MMM-YY>` with the resolved values before rendering the citation link** — leaving the angle-bracket placeholders in the URL produces a broken link.)
>
> **Key tie-outs (Summary ties to detail):** Net Income (Month) + Net Income (YTD) + Investment Income (Month) + Total expenses (Month). Render as the shared 5-column shape: `Line item | Detail | Summary | Difference | Status`, totals bold, `$0` for matches.
>
> Follow with the standard "**N** items checked. **M** matched, **X** mismatched" line, then a one-paragraph build summary: account counts, sections populated, budget source label, "Comments columns are blank — fill them in as you go."

If the Summary tab was skipped (Gate 4 option 2), omit the Summary rows
from the Key tie-outs and note "Summary tab not built (detail only)."

**Flag negative-NOI months in the summary.** If any monthly Net Income figure in the written sheet is negative, surface the count:

> "⚠ N of 12 months show negative NOI in this projection — review the lumpy revenue/expense lines before locking the budget."

Don't bury this in a table. The user needs to see it in prose so they can decide whether to revise before sending the workbook downstream.

**Surface unclassified items** in a follow-up block (always shown, even
when the lists are empty — empty is signal):

> **Accounts in `Other` (review section mapping):**
> - Carried interest expense
> - Foreign exchange
> - Misc operating
>
> **Empty Summary buckets** (no matching revenue accounts — extend the
> keyword list if you want these populated):
> - Tax & Other Distributions
> - Unrealized Gains or (Losses)

After reporting tie-outs and unclassified items, **route into Gate 9**
to run the budget merge (if budget data was pre-fetched) and close with
the post-action menu. Do **not** render a final post-action menu here —
Gate 9 owns the closing menu.

**Done when:** tab(s) exist, Key tie-outs reported with status, unclassified
accounts and empty Summary buckets surfaced.

---

## Gate 9 — Budget tie-out and post-action menu

Budget data was fetched in Gate 4b and written during Gate 6. This gate
finalises the budget merge (completing any steps Gate 6 couldn't do
inline) and closes with the post-action menu.

### If `budget_source` is Carta / file / tab (budget data pre-fetched)

Load [`references/fill-budget-columns.md`](references/fill-budget-columns.md)
inline and run the steps that were **not** already handled during Gate 6:

- ~~Insert missing budget rows above the right section subtotal (step 4)~~
  — already handled by Gate 6's row-set union. Run step 4 only as a
  fallback if you discover budget-only rows missing from the detail tab
  (which should not happen if Gate 6 was followed; Gate 8 step 4 catches
  this).
- Rewrite section subtotal `=SUM(...)` ranges (step 5) — only needed if
  step 4 had to insert rows after the fact.
- Fill remaining blanks with `0` so Variance/% resolve (step 6) —
  applies to actuals-only rows where no budget match was found.
- Source note in B3, italic (step 7)
- Tie-out check on Revenue / Total Expense / Net Income vs Budget (step 8)
- Report (step 9)

### If `budget_source = "skip"`

Tell the user in one sentence that Budget columns are blank and Variance
/ % will render `n/a` until they fill them in.

### Post-action menu

Surface the closing menu via `AskUserQuestion`:

**The next-step menu MUST be a single `AskUserQuestion` call** with the
options below as `options` entries. Never render them as a numbered
markdown list, a bulleted list, or inline prose — bare-text menus break
the chooser UI in Claude for Excel and force the user to type the
number. The `← recommended` marker goes inside the `description` field
of one option, not as a suffix on the `label`.

1. **Build the Balance Sheet for the same firm and period** ← recommended
2. **Build the P&L for a different period**
3. **Adjust the section mapping for `Other` accounts**
4. **I'm done**

**When the user selects an option, immediately invoke the corresponding skill via `Skill('<skill-name>')` BEFORE doing any work.** Do not freelance the output — load the downstream skill's SKILL.md so its gates, layout spec, branding rules, and approval flow apply. Routing:

| Option | Skill to invoke |
|---|---|
| 1 — Build the Balance Sheet | `Skill('carta-investors:carta-consolidating-balance-sheet')` |
| 2 — Build the P&L for a different period | `Skill('carta-investors:carta-consolidating-pnl')` re-entry with the new period |
| 3 — Adjust the section mapping | Stay in this skill — re-run from Gate 5 with the user's revised mapping |
| 4 — I'm done | No invocation; close cleanly |

**Done when:** Budget tie-out reported (or skip noted), post-action menu
rendered.

---

## Schema discovery

Source: the Carta DWH journal-entries table. If column names are needed, look up the table via the Carta MCP DWH schema command once at Gate 0.

## Error handling

Never auto-retry. Surface failures, let the user decide.

- **No Carta MCP connected** → "Open Settings → Connectors, enable Carta, retry." List any `failed` Carta entries.
- **`contexts:list` returns no firm** → echo name, ask for spelling.
- **`contexts:list` returns multiple** → `AskUserQuestion`.
- **DWH query returns 0 rows** → "No P&L activity for this firm through `<MMM YYYY>`. Check period or posting status."
- **DWH timeout** → tell user it's slow, offer retry.
- **Summary Net Income ≠ Detail Net Income** → surface as `⚠ Mismatch ($X)`, offer to rebuild Summary.
- **Revenue accounts in unmatched Summary buckets** → surface empty buckets, ask whether to extend keyword list or accept zeros.
- **Auth error** → ask user to reconnect Carta.

---

## Do NOT

- **Don't rename accounts** — `ACCOUNT_NAME` verbatim; section assignment is display-only.
- **Don't fabricate Comments** — J and S stay blank in data rows.
- **Don't hardcode numbers on Summary** — every Actual/Budget cell is a cross-sheet formula.
- **Don't claim success without re-reading both tabs in Gate 8** — tie-out is a read-back.
- **Don't add columns the skill doesn't ask for** (no Acct # / GL Code column — column C is a 5pt spacer).
- **Account label = `account_name` only.** Never `"4160 Management fee income"` or any variation. GL code is internal-only.
- **Do NOT freeze panes** on either tab.
- **Don't skip branding** — Gate 8 must not run until both tabs carry `CartaLogo` on column D. See [`references/branding-and-header.md`](references/branding-and-header.md).
