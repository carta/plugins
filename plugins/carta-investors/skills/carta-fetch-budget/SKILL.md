---
name: carta-fetch-budget
model: opus
description: 'Pull a ManCo budget from Carta and write it to an Excel workbook with monthly amounts and subtotals. TRIGGER: pull/fetch/import/sync Carta budget for a ManCo. NOT: new budgets, actuals refresh, pacing, scenarios, P&L, balance sheet.'
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
[PATTERN base v0.1.0]

# Fetch Carta budget

Pulls the budget for a management company directly from Carta via the
`fa:list:budgets` MCP command and lays it out as a single budget tab in
Excel. Only **management companies** carry budgets in Carta — funds and
SPVs do not — so the entity picker always lists the ManCo first.

## UX Rules

Inlined here because the Carta CLI session-start hook does not run inside
Claude for Excel. Audience is an accountant.

- **Plain English only.** Never surface MCP server identifiers, command
  names (`fa:list:budgets`), UUIDs, raw JSON, or gate labels.
- **Currency formatting:** positive `$X,XXX`, negatives `($X,XXX)`, totals
  bolded `**$X,XXX**`. Always `$`. The `[$$-en-US]` locale token in the workbook locks the display
  to USD regardless of the user's Excel locale.
- **Closing summary link** is a workbook citation
  (`<citation:Sheet!Range>`) in Claude for Excel mode, and a `file://`
  path in Claude Code / Cowork mode. Never both.
- **Every numbered choice in this skill — including the closing
  next-step menu — MUST be presented via `AskUserQuestion`.** Never
  render the options as a bare code-fenced markdown list. The
  `AskUserQuestion` tool is in `allowed-tools`; use it.

## When to use

Trigger this skill when the user asks for any of the following:

- "Pull `<ManCo>`'s `<year>` budget from Carta"
- "Fetch the budget for `<ManCo>` from Carta MCP"
- "Import our 2026 budget"
- "Sync the ManCo budget"
- "Bring Carta's budget into this sheet"
- Any request to get the *Carta-stored* budget into a workbook

## DO NOT use this skill for

- **Building a new budget from prior-year actuals** — use `carta-create-budget`.
- **Refreshing actuals against an existing budget** — use `carta-budget-actuals`.
- **Pacing / variance / "are we on track"** — use `carta-budget-vs-actuals`.
- **What-if scenarios** — use `carta-budget-scenarios`.
- **P&L / income statement** — use `carta-consolidating-pnl`. (If the user is
  building a P&L and wants the Budget columns filled with Carta data,
  `carta-consolidating-pnl` already integrates this skill's fetch logic in its
  Gate 9 — do not duplicate the workflow.)

---

## Gate 0 — Carta MCP environment + resolve firm

1. Call `refresh_mcp_connectors`. Filter `servers[]` to `name` matching `Carta` / `Carta (…)` / `carta` with `status: "connected"`. Drop `failed`.
2. For each connected, probe both prefix forms in parallel: `mcp__claude_ai_Carta__welcome` and `mcp__carta__welcome`. First success = `<SERVER>`.
3. **Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every command is gated.

If none connected, list `failed` connectors and stop. If multiple, default to `Carta` (production).

**Resolve firm:** if user named one → `fetch(command="contexts:list", params={"firm_name": "<firm>"})` → disambiguate via `AskUserQuestion` if multiple → `set_context(firm_id=<uuid>)`. Prefer granular tools when exposed.

**DWH param-name traps:** `dwh:execute:query` takes `sql:` not `query:`. `dwh:get:table_schema` takes `table_name:` not `table:`. `format` accepts `"ndjson"` / `"markdown"`, not `"csv"`.

If no firm was named, defer to Gate 2.

---

## Gate 0.5 — Detect runtime

This skill runs in **two runtimes**. Detect which one applies before
asking where to write:

1. **Claude for Excel** — the user is working inside the Excel add-in.
   Cell reads and writes happen through the add-in's runtime-injected
   workbook tools.
2. **Claude Code / Cowork (local file)** — the user is working at the
   command line or in Cowork against `.xlsx` files on disk.

See `carta-create-budget/SKILL.md` Gate 0.5 for the heuristic. If unclear, ask
via `AskUserQuestion`. Store `<RUNTIME>` (`excel-addin` or `local-file`).

---

## Gate 1 — Where to write

Branches by `<RUNTIME>`. Before showing any chooser, **scan the
destination for an existing budget tab** — if one is found, lead with
"update in place" instead of defaulting to a new tab.

### Budget-tab detection heuristic

A sheet counts as an "existing budget tab" when **either** is true:

1. The sheet name contains `Budget` (case-insensitive), e.g.
   `Budget FY2026`, `2026 Budget`, `MgmtCo Budget`.
2. The sheet's header block contains the word `Account` in a label
   column AND at least 6 month-like headers (`Jan`, `Jan 2026`,
   `2026-01`, etc.) in the same row.

Stop at the first match — the user can always pick another tab via the
"choose a different tab" branch.

**If `<RUNTIME>` is `excel-addin`:**

1. Use the add-in's workbook-introspection tool to list sheet names + the
   first ~10 rows of each.
2. Apply the heuristic. Store any matches as `<EXISTING_BUDGET_TABS>`.

**If `<RUNTIME>` is `local-file`:**

Only scan if the user already supplied a workbook path in their prompt
(otherwise there's nothing to scan yet — defer detection to the file
they pick next).

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" \
  "<PATH>"
```

Apply the same heuristic to the JSON output.

### Chooser

**If `<EXISTING_BUDGET_TABS>` is non-empty (excel-addin or local-file with a path):**

Use `AskUserQuestion`:

> I see a budget tab already in your workbook
> (**`<existing tab name>`**). Want me to update it with Carta's data,
> or write the budget somewhere else?

| # | Option | What happens |
|---|---|---|
| 1 | **Update `<existing tab name>` in place** ← recommended | Refreshes the budget values on the existing tab — same accounts, same row positions; **no new tab is created**. |
| 2 | **Add a new tab** | Creates `Budget FY<year>` alongside the existing tab. |
| 3 | **Pick a different existing tab to update** | Lists all sheets in the workbook and asks which one. |
| 4 | **Cancel** | Stops the skill. |

If multiple existing budget tabs are found, list up to 3 of them as
option 1a / 1b / 1c (inside the same `AskUserQuestion` call) — never
silently pick one.

**Update-in-place semantics** (option 1):

- Read the existing tab via the runtime's read tool. Identify the
  label column (the column that holds account names) and the month
  columns. Treat any cell where `is_formula: true` as **load-bearing**
  — subtotal / Net Operating Income / FY-total rows stay formula-driven
  and are **never overwritten**.
- For each matched (`gl_code` or `account_name`) row already in the
  sheet, write the new monthly budget values into the existing month
  cells. The tab's row positions, section headers, formulas, and
  formatting all stay put.
- For Carta budget rows that don't match any existing row in the sheet,
  surface them in the pre-build review (Gate 5) — let the user decide
  whether to insert new rows or skip. **Never silently insert** into an
  existing budget tab without confirmation.
- Refresh the source note in **B3** (italic) to
  `Source: Carta Fund Admin (refreshed <ISO date>)` so the user can see
  when the values were last pulled.

**If `<EXISTING_BUDGET_TABS>` is empty:**

**Excel add-in runtime — empty-workbook shortcut**: if the active workbook has one sheet, `maxRows == 0`, no other tabs (typically a fresh `Book1.xlsx`/`Sheet1`), skip the chooser. Announce the rename in one sentence — *"I'll use the empty workbook you have open and rename `Sheet1` to `Budget FY<year>`."* — then proceed. The chooser only exists to protect non-empty state.

Otherwise, use `AskUserQuestion` with the default options:

**Excel add-in runtime:**

> Where should I put the Carta budget?

- **"Add a new tab to the open workbook (recommended)"** — Claude creates a tab named `Budget FY<year>`.
- **"Overwrite an existing tab in the open workbook"** — Claude asks which tab and confirms before overwriting. (Used when the user knows there's a budget tab but the heuristic missed it.)
- **"Create a brand new workbook"** — Claude writes to a fresh file.

**Local-file runtime:**

> Where should I write the budget file?

- **"Create a new .xlsx (recommended)"** — ask for the destination path.
- **"Add a new sheet to an existing .xlsx"** — ask for the file path; the sheet name defaults to `Budget FY<year>`. After loading, re-run the budget-tab detection — if the loaded file has an existing budget tab, jump back to the "update in place" chooser above.

If the user gave a path in the original prompt, skip the choice and use that path (but still run the detection on it).

Store `<DESTINATION>` for Gates 5–7.

---

## Gate 2 — Pick the entity (ManCo first)

**Critical:** in Carta, only **management companies** carry budgets. Funds
and SPVs return empty from `fa:list:budgets`.

**Call `read_skill(file_path="references/entity-picker.md")` before proceeding.** Do not reconstruct the picker logic from memory. Summary of the rule:

1. Call `fetch(command="fa:list:entities")` against the active firm.
2. Identify the ManCo(s) by name suffix / type field — anything matching
   `(LLC|Management|Mgmt|ManCo|Capital, LLC)` AND with no `Fund` /
   `Partners` / `SPV` qualifier.
3. Build the picker so the ManCo is the **first** option (with
   `← recommended`), then other entities below it, then a final option
   "None of these — let me type the name".
4. Confirm with `AskUserQuestion`.

If the user already named the entity in their prompt and it resolves to
exactly one ManCo, skip the picker. Otherwise always ask.

If a non-ManCo is picked, warn before fetching:

> "Heads up — only management companies carry a budget in Carta. If I
> pull `<entity>`, the result will likely be empty. Want me to pick the
> ManCo instead?"

**Done when:** `<ENTITY_NAME>` and `<ENTITY_UUID>` are locked.

---

## Gate 3 — Period picker

In **one** `AskUserQuestion` call, ask for the period the prompt didn't
already specify. Offer smart defaults based on **today's date** —
compute year, half, and quarter labels dynamically, never copy the
example values below.

> What period should I pull the budget for?

*Example shape — rendered with today's date = May 2026. Substitute `<CURRENT_YEAR>` and `<CURRENT_QUARTER>` at runtime.*

| # | Label | Date range |
|---|---|---|
| 1 ← recommended | **Full year `<CURRENT_YEAR>`** | Jan 1 – Dec 31, `<CURRENT_YEAR>` |
| 2 | **H1 `<CURRENT_YEAR>`** (Jan – Jun) | Jan 1 – Jun 30, `<CURRENT_YEAR>` |
| 3 | **H2 `<CURRENT_YEAR>`** (Jul – Dec) | Jul 1 – Dec 31, `<CURRENT_YEAR>` |
| 4 | **`<CURRENT_QUARTER>` `<CURRENT_YEAR>`** | (computed from today's date) |
| 5 | **Custom range** — I'll specify start / end month | — |

Always compute the current quarter label and year dynamically from
today's date — never hardcode Q2 / 2026 / etc. Drop the H1 row once
the current month is past June (H1 is fully in the past then — fold
it into "Custom range"). Show the prior year as an option only if the
user mentioned it in their prompt.

If the prompt already specified a year or range (e.g. "2026 budget",
"H1"), store it directly and skip the question.

Store `<BUDGET_YEAR>`, `<START_DATE>` (`<YEAR>-<MM>-01`), `<END_DATE>`
(last day of `<end_month>`).

**No tag breakdown available.** The budget data from Carta (`fa:list:budgets`)
contains no reporting dimension — it returns one amount per account per
month. If the user asks for budget broken down by department, project
code, or any other tag, tell them in one sentence — *"Carta's stored budget
isn't broken down by tag, so I can only return flat monthly totals."* — and
offer to route them to a different skill **via `AskUserQuestion`** (never a
bare numbered list — see the UX Rules at the top of this skill).

Call `AskUserQuestion` with these exact parameters:

- `question`: `"Carta's stored budget has no tag dimension. How should I continue?"`
- `header`: `"Tag breakdown"`
- `multiSelect`: `false`
- `options`:
  - `label`: `"Continue with the flat budget pull"` — `description`: `"No tag dimension; returns one amount per account per month."`
  - `label`: `"Build a new tag-sliced budget from journal actuals instead"` — `description`: `"← recommended for tag breakdowns. Hands off to carta-create-budget's slice-by-tag mode; uses last year's actuals as the seed."`

If the user picks option 2, hand off via `Skill('carta-investors:carta-create-budget')`
with the slice-by-tag routing — that skill's `slice-by-tag` mode is the
canonical way to produce a budget broken down by reporting tag.

The `← recommended` marker goes inside the `description` field of option 2, not as a suffix on the `label`. Bare-text numbered lists break the chooser UI in Claude for Excel and force the user to type the number — same rule as every other choice in this skill.

---

## Gate 4 — Fetch budget from Carta

**Call `read_skill(file_path="references/fetch-budget-data.md")` before issuing any MCP calls.** Do not reconstruct the fetch contract from memory. Summary of the contract:

- Issue **one `fetch(command="fa:list:budgets", ...)` call per month** for
  every month in the requested window. For a full-year pull this is
  exactly twelve calls (Jan 1–31, Feb 1–28/29, …, Dec 1–31). Run them in
  parallel batches of 5–6 and merge the row lists. Do **not** try a
  single annual or quarterly window first — the MCP response truncates
  past ~40 KB and every wider window the user has been observed needing
  has hit that cap.

**Verbatim call template — do not omit `fund_uuid`.** The MCP rejects
the call with `"missing required params: ['fund_uuid']"` if the param
isn't passed. `<ENTITY_UUID>` is the UUID locked at the end of Gate 2.

```
fetch(command="fa:list:budgets", params={
  "fund_uuid":  "<ENTITY_UUID>",
  "start_date": "<YYYY-MM-01>",
  "end_date":   "<YYYY-MM-{28|29|30|31}>"
})
```

The param is named `fund_uuid` for historical reasons but it accepts any
entity UUID returned by `fa:list:entities`. Pass the ManCo UUID Gate 2
resolved — never an empty value, never a name, never skip the param.

- Pivot the row list `{account_id, account_name, account_type, amount,
  start_date}` into a `{account_type → account_name → {month: amount}}`
  map. Sum if multiple postings hit the same month + account.
- Sort accounts by `account_type` ascending.

**Section mapping** (by leading digit of `account_type`, same convention
as the other budgeting skills):

| Prefix | Section |
|---|---|
| `4xxx` | Income |
| `5xxx` / `6xxx` / `7xxx` / `8xxx` | Expenses |
| `1xxx` | Investments / Other |
| anything else | Other |

If the fetched dataset is empty (no rows): stop and tell the user
plainly — "I didn't find any budget rows in Carta for `<ENTITY>` for
`<BUDGET_YEAR>`. Common causes: the entity isn't a ManCo, or no budget
has been loaded into Carta yet for that year." Offer to retry against a
different entity or year.

**Done when:** the budget dataset is loaded into the
`account_type → account_name → {month: amount}` map and tagged by
section.

---

## Gate 5 — Pre-build review (approval gate)

Branches by the Gate 1 write mode (`new-tab`, `overwrite-tab`,
`new-workbook`, or `update-in-place`).

### Mode A — fresh write (`new-tab`, `overwrite-tab`, `new-workbook`)

Present a plain-English preview before any write:

> **Ready to write Carta's 2026 budget for `Example Capital, LLC` —
> please review.**
>
> - **Source:** Carta Fund Admin (live)
> - **Entity:** Example Capital, LLC (ManCo)
> - **Period:** Jan 2026 – Dec 2026
> - **Income accounts:** 1
> - **Expense accounts:** 47
> - **Sheet to write:** `Budget FY2026` in `<DESTINATION>`
> - **Projected FY totals:** Income **$13,788,809** · Expenses
>   **$8,530,121** · Net Operating Income **$5,258,689**

### Mode B — update existing tab in place (`update-in-place`)

Run the match step first (see Gate 1's "Update-in-place semantics") and
classify every row:

- **Matched rows** — line items where the existing tab's account
  (label-column value or column-A GL code) matches a Carta budget row.
  These will be refreshed in place.
- **Carta rows missing from the sheet** — present in Carta but no
  matching row in the existing tab. Insert decision deferred to the
  user.
- **Sheet rows missing from Carta** — present in the existing tab but
  not in Carta's response. The skill does **not** touch these; surface
  them so the user knows what's untouched.

Preview shape:

> **Ready to refresh `Budget FY2026` in your open workbook with Carta's
> 2026 budget for `Example Capital, LLC`.**
>
> - **Source:** Carta Fund Admin (refreshed live)
> - **Existing tab:** `Budget FY2026`
> - **Existing rows to refresh:** 41 line items
> - **Cells to update:** ~492 monthly amounts (excluding formula
>   subtotals)
> - **Carta rows missing from your sheet:** 6 line items (would be
>   inserted if you approve)
> - **Sheet rows missing from Carta:** 2 line items (will be left
>   untouched)
>
> | Line item | Old monthly avg | New monthly avg | Source |
> |---|---:|---:|---|
> | Software (7005) | **$23,000** | **$25,000** | Carta refresh |
> | … | … | … | … |
>
> | Account in Carta but missing from your sheet | Section | Projected FY |
> |---|---|---:|
> | Leased employee — guaranteed payments (7051) | Operating Expenses | **$2,675,004** |
> | Investor relations — events (7203) | Operating Expenses | **$12,504** |

If there are Carta rows missing from the sheet, ask via
`AskUserQuestion` whether to **insert** them (above the right section
subtotal, per the same logic as
[`references/fill-budget-columns.md`](references/fill-budget-columns.md) step 4) or
**skip** them this run.

### Approval menu (both modes)

After showing the preview (and resolving any missing-row decisions),
offer via `AskUserQuestion`:

1. **Approve and write the budget** ← recommended (Mode A) / **Approve and refresh in place** ← recommended (Mode B)
2. **Edit — change the entity, year, or destination**
3. **Cancel**

If Edit, return to the right gate. Wait for explicit OK before writing.

**Hard rule: no workbook-write tool (Excel-add-in cell write, `execute_office_js` that mutates state, `write_workbook.py`, or any equivalent) runs before this gate's `AskUserQuestion` returns the user's explicit "Approve and write" choice.** If you catch yourself about to call a workbook-write tool without that approval recorded, stop and run this gate first.

---

## Gate 6 — Write and brand the workbook

### Approval-recorded check (run FIRST, before any write tool)

Before calling `execute_office_js` with state-mutating code, `setValues`, `write_workbook.py`, or any other workbook-write tool, look back at your tool history. Find the most recent `AskUserQuestion` you sent. Does its answer literally include `"Approve and write"` or `"Approve and refresh"`? If NO, Gate 5 did not pass — send the Gate 5 approval menu now and wait for the explicit answer.

**Do not interpret upstream answers as approval.** A Gate 2 entity-pick response, a Gate 3 year-range answer, or any prior `AskUserQuestion` whose answer is not literally `"Approve and write"` / `"Approve and refresh"` does NOT clear this gate. Approval is the answer to the specific Gate 5 question — nothing else counts.

### Gate 6 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

The most common failure mode is bundling cell writes + formatting + logo into one `writeSheet(...)` function — the model writes the cells, returns, and forgets the logo. **Do not combine the cell-write call with the brand block in a single office.js block.**

- **Call 1:** cell values, formulas, formatting, column widths, cell comments. One `execute_office_js`. Return.
- **Call 2:** logo on the tab via the verbatim brand block (`sheet.shapes.addImage(...)`).
- **Call 3 (verification):** load shape names, confirm `CartaLogo` exists.

Returning from Call 1 does NOT finish Gate 6. The verification call must come last and must appear in your tool history.

Branches by the Gate 1 write mode. **Before any write**, call `read_skill(file_path="references/branding-and-header.md")`. Do not reconstruct the brand block or header band from memory — the file must be in your context before you generate any `execute_office_js` or `write_workbook.py` code. It defines the reserved 4-row metadata band (B1 entity / B2 descriptive title like `"2026 Budget (from Carta Fund Admin)"` / B3 source / B4 other context), Carta logo placement (column E, rows 1–3 height), the `blobs.getText("assets/...")` asset-loading pattern for Excel add-in (NOT `Read`), and the cell-comment pattern for any flagged rows. The tab is not "written" until it carries a `CartaLogo` shape.

### Mode B — update existing tab in place

This is the **no-new-tab** path. Apply the matched changes from Gate 5
directly to the existing tab:

1. **Refresh matched cells:** `write_cell` (or the add-in equivalent)
   for every (existing row × month) pair where Carta returned a value.
   Hardcoded numbers, never formulas. Preserve every other cell on the
   tab — labels, GL codes, section headers, formula subtotals, FY total
   formulas, formatting.
2. **Skip every formula cell** flagged in the read step
   (`is_formula: true`). The tab's `=SUM(...)` subtotals, Total Income,
   Total Expenses, and Net Operating Income re-evaluate automatically.
3. **Insert any approved missing-from-sheet rows** above the right
   section subtotal, per
   [`references/fill-budget-columns.md`](references/fill-budget-columns.md) step 4.
   After insertion, **rewrite** the affected section subtotal
   `=SUM(...)` formulas so the new rows are included. Match the
   formatting of neighboring rows (currency format, font, no fill).
4. **Refresh the source note in B3** (italic, size 10):
   `Source: Carta Fund Admin (refreshed <ISO date>)`.
5. **Never create a new tab.** If the chosen tab can't be updated for
   any reason (locked sheet, wrong layout, etc.), surface the error and
   stop — do not silently fall back to creating `Budget FY<year>`.

Skip the layout section below — the tab already has its layout. Jump
to Gate 7.

### Mode A — fresh write (`new-tab`, `overwrite-tab`, `new-workbook`)

Layout (4-row metadata band per `branding-and-header.md`):

| Row | Content |
|---|---|
| B1 | `<ENTITY_NAME>` — bold, size 10 |
| B2 | `<BUDGET_YEAR> Budget (from Carta Fund Admin)` — bold, size 10 |
| B3 | `Source: Carta Fund Admin · fa:list:budgets` — italic, size 10 |
| B4 | `Amounts in USD` — italic, size 10 |
| Row 5 | blank — breathing room between header band and column headers |
| Row 6 | Column headers (column A is a blank spacer; headers begin in column B): `Account \| Jan <year> \| Feb <year> \| … \| Dec <year> \| FY <year> Total` — bold, white-on-black, centered. No GL-code / "Account #" column. |

Body — for each section (Income → Expenses → Other), in this order:

1. Bold + underlined section header row in column B (e.g. `Income`,
   `Operating Expenses`, `Other`). No cell borders.
2. One row per GL account in the section, sorted by `account_type`.
   Column A is left blank (spacer), column B = `account_name`,
   columns C..N = monthly amounts (hardcoded numbers). The GL code
   (`account_type`) is used only to sort and section the rows — it is
   **not** written as a column.
3. Subtotal row at end of section — bold, top thin border,
   `=SUM(<section_range>)` per monthly column and for column O.

After the last section:

- **`Total Income`** — bold, top thin border, sums all Income subtotals.
- Blank row.
- **`Total Expenses`** — bold, top thin + bottom medium border, sums all
  Expense subtotals.
- Blank row.
- **`Net Operating Income`** — bold, top thin + bottom medium border,
  `=<Total Income> - <Total Expenses>` per monthly column and for column O.
  Set `numFmt="@"` on the column-B label if it contains a slash.

Column O = `=SUM(C<row>:N<row>)` for every account, subtotal, and total row.

**Currency format** (every numeric cell):
`_([$$-en-US]* #,##0.00_);_([$$-en-US]* (#,##0.00);_([$$-en-US]* "-"??_);_(@_)`.
A bare `$` or `"$"` is never allowed — it renders in system locale on
non-US installs.

**Recalc + column widths (excel-addin):** the **last statements in the cell-write `execute_office_js` block**, in this order — never a separate call:

```javascript
context.application.calculationMode = Excel.CalculationMode.automatic;
context.workbook.application.calculate(Excel.CalculationType.full);  // else =SUM cells stay 0 → render as "-" until edit+Enter
sheet.getRange("B:O").format.autofitColumns();                       // size labels + amounts to REAL values (after recalc → no ####)
await context.sync();
```

Force the recalc **before** the autofit: without it the `=SUM(...)` subtotals / Total / NOI cells sit at 0 and the accounting format shows `-` (the user then has to edit+Enter each one); and autofitting before the recalc sizes the amount columns to the dash, so the real figures overflow as `####`. In local-file mode, add an `autofit_columns` op over `B:O`. Column A is a fixed spacer (`sheet.getRange("A:A").format.columnWidth = 90`). Do **not** call `freeze_panes`.

**Column-width anti-pattern:** Do NOT call `autofitColumns()` on a header-only range like `C1:O1` — header rows are often empty at write time, leaving the amount columns too narrow for 5+ digit currency (`####`). Always autofit the full label+amount span (`B:O`) after the data is written. Full recipe: `carta-create-budget/references/from-prior-actuals.md` §6.

**If `<RUNTIME>` is `excel-addin`:** write via the Excel add-in's
runtime cell-write tools, applying the same number format.

**If `<RUNTIME>` is `local-file`:** build a JSON operations payload and
apply it:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py" --stdin <<'JSON'
{
  "workbook_path": "<DESTINATION>",
  "create_if_missing": true,
  "operations": [ ... ]
}
JSON
```

### Branding verification (REQUIRED, observable, excel-addin only)

After running the brand block from `branding-and-header.md`, run this verification as a **separate** `execute_office_js` call before proceeding to Gate 7:

```javascript
const tabs = ["<TAB_NAME_WRITTEN_THIS_RUN>"];  // substitute the actual tab name(s)
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name");
  await context.sync();
  result[tabName] = sheet.shapes.items.map(s => s.name);
}
return result;
```

The result must show `CartaLogo` in every tab's shape list. If any tab returns `[]` or its shape list lacks `CartaLogo`, you have skipped the brand block for that tab — re-run it and re-verify. **Do not start Gate 7 summary text until this verification returns `CartaLogo` on every tab.** The verification call is observable evidence; without it in your tool history, Gate 6 is not complete.

---

## Gate 7 — Summary + next steps

**Gate 7 precondition (DO NOT SKIP).** Before sending the summary text below, scan your tool history. Three anchors MUST be present in that order:

1. An `AskUserQuestion` whose answer included `"Approve and write"` or `"Approve and refresh"` — Gate 5 approval.
2. A `sheet.shapes.addImage(base64)` call for the tab the skill wrote/modified — Gate 6 branding.
3. The branding-verification `execute_office_js` whose result showed `CartaLogo` on the tab — Gate 6 verification.

If any anchor is missing, you have skipped a gate. **Do NOT write "Carta logo placed at..." in the summary when no `shapes.addImage` call appears in your tool history — that's hallucinating completion.** STOP, go back, run the missing gate, then return here.

One or two sentences confirming what got written. Wording branches on
the Gate 1 write mode.

### Mode A — fresh write

**If `<RUNTIME>` is `excel-addin`:**

> Wrote [Budget FY2026](<citation:Budget FY2026!A1:O80>) for **Example
> Capital, LLC** — 1 income account, 47 expense accounts, source Carta
> Fund Admin (live). FY total: Income **$13,788,809** · Expenses
> **$8,530,121** · Net Operating Income **$5,258,689**.

**If `<RUNTIME>` is `local-file`:**

> Wrote `Budget FY2026` for **Example Capital, LLC** to
> `file:///path/to/budget.xlsx` — 1 income account, 47 expense accounts,
> source Carta Fund Admin (live). FY total: Income **$13,788,809** ·
> Expenses **$8,530,121** · Net Operating Income **$5,258,689**.

### Mode B — update existing tab in place

**If `<RUNTIME>` is `excel-addin`:**

> Refreshed [Budget FY2026](<citation:Budget FY2026!A1:O80>) in place
> with Carta's 2026 budget for **Example Capital, LLC** — **492** cells
> updated across **41** line items, **6** new rows inserted (Operating
> Expenses), **2** sheet rows left untouched (no Carta budget for those
> accounts). Refreshed FY total: Income **$13,788,809** · Expenses
> **$8,530,121** · Net Operating Income **$5,258,689**.

**If `<RUNTIME>` is `local-file`:**

> Refreshed `Budget FY2026` in
> `file:///path/to/budget.xlsx` with Carta's 2026 budget for **Example
> Capital, LLC** — **492** cells updated, **6** new rows inserted, **2**
> sheet rows left untouched. Refreshed FY total: Income **$13,788,809**
> · Expenses **$8,530,121** · Net Operating Income **$5,258,689**.

**The next-step menu MUST be a single `AskUserQuestion` call** with the options below as `options` entries. Never render them as a numbered markdown list, a bulleted list, or inline prose — bare-text menus break the chooser UI in Claude for Excel and force the user to type the number. The `← recommended` marker goes inside the `description` field of one option, not as a suffix on the `label`.

1. **Build the P&L with this budget pre-filled (carta-consolidating-pnl)** ← recommended
2. **Refresh actuals against this budget (carta-budget-actuals)**
3. **Run a pacing analysis (carta-budget-vs-actuals)**
4. **I'm done**

**Call `AskUserQuestion` with these exact parameters:**

- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`: the four `label` + `description` pairs above (place `← recommended` in the `description` field of the recommended option, NOT in the `label`)

**DO NOT** render the menu as inline markdown text, a numbered list, a bulleted list, or closing prose. If your response is about to contain `1. ...`, `2. ...`, `3. ...`, `4. ...` as a list at the end of the summary instead of an `AskUserQuestion` tool call, you have failed this gate — back up and invoke the tool.

**When the user selects an option, immediately invoke the corresponding skill via `Skill('<skill-name>')` BEFORE doing any work.** Do not freelance the output — load the downstream skill's SKILL.md so its gates, layout spec, branding rules, and approval flow apply. Routing:

| Option | Skill to invoke |
|---|---|
| 1 — Build the P&L with this budget pre-filled | `Skill('carta-investors:carta-consolidating-pnl')` |
| 2 — Refresh actuals against this budget | `Skill('carta-investors:carta-budget-actuals')` |
| 3 — Run a pacing analysis | `Skill('carta-investors:carta-budget-vs-actuals')` |
| 4 — I'm done | No invocation; close cleanly |

---

## Hard rules

- **Never call `fa:list:budgets` without `fund_uuid`** — MCP rejects with `"missing required params: ['fund_uuid']"`. Pass `<ENTITY_UUID>` (locked at end of Gate 2) as `params["fund_uuid"]`.
- **Never invent budget rows** or extrapolate beyond what `fa:list:budgets` returned.
- **Never apply a buffer percentage** — Carta budget is source of truth. (Buffered budgets are `carta-create-budget`.)
- **Currency format:** `[$$-en-US]` locale token. Bare `$` renders in system locale — never use it.
- **Do not freeze panes.** Do not write a Provenance tab — B3 source note is the audit trail.
- In local-file mode, never silently overwrite — helper returns "sheet exists" status; surface it.
- **Two-row header for month-bucketed tables.** Row N = merged month label. Row N+1 = sub-headers. Never write both into same row — subsequent merges destroy sub-headers.
- `range.merge(true)` discards trailing cells. Insert a new row first.
- **Month-label date-serial trap:** prefix with `'` or use `numberFormat: "mmm yyyy"` on a real date.
- **Border syntax (Office.js):** `style = "Continuous"` then `weight = "Thin"`. Never `style: "Thin"`.
- **Branding standards — follow [`references/branding-and-header.md`](references/branding-and-header.md)** for every tab. Rows 1–4 reserved, logo at column E, `blobs.getText("assets/...")` for asset access.

---

## Error handling

Never auto-retry. Always surface the failure and let the user decide.

- **No Carta MCP connected** → "Open Settings → Connectors, enable Carta, retry."
- **`contexts:list` returns no firm** → echo name, ask for spelling. Don't silently near-match.
- **`fa:list:entities` returns no ManCo** → surface full entity list, let user pick. Flag that picked entity may not have a budget.
- **`fa:list:budgets` returns empty** → "No budget rows in Carta for `<entity>` `<year>`. Likely the entity isn't a ManCo, or no budget loaded yet." Offer retry.
- **Monthly response truncates mid-stream** → surface to user. Monthly windows are smallest sensible slice. Don't auto-fall-back to per-account.
- **Workbook already has a budget tab (Gate 1)** → lead with "Update in place"; never silently create a second tab.
- **Update-in-place: unparseable layout** → ask user to confirm label column + month mappings. If they decline, fall back to "Add new tab" — never silently overwrite an unknown layout.
- **Update-in-place: hardcoded subtotals (not `=SUM`)** → refresh lines, ask whether to recompute subtotals. Default to leaving alone if no reply.
- **Local-file: unreadable path / openpyxl error** → echo path, ask for a valid `.xlsx`.
- **Auth error** → ask user to reconnect Carta. Do not auto-retry.
- **Connector connected, tool calls fail (`McpAuthError`)** → prefix mismatch, NOT auth. Re-run `refresh_mcp_connectors`, probe matching prefix's `welcome`. Never tell user to re-auth without verifying.
