# Fetch budget capability

Pulls the budget for a management company directly from Carta via the
`fa:list:budgets` MCP command and lays it out as a single budget tab in
Excel. Only **management companies** carry budgets in Carta — funds and
SPVs do not — so the entity picker always lists the ManCo first.

Gates 0, 0.5, 0.75, and the Router Gate ran in SKILL.md — per its Forbidden narration rule, none of them produced any text output on success. This file picks up at Gate 1.

**Telemetry:** on entry, set `<CAPABILITY> = fetch-budget`. Every MCP call in this flow tags `_instrumentation.skills = ["carta-manco", "<CAPABILITY>"]`. Re-fire the beacon (`set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco", "fetch-budget"]})`) if you arrived here via a next-step menu rather than the Router Gate.

---

## Cash-only fast path (check before Gate 1)

If the prompt is specifically about cash balance, not the budget as a
whole — "add cash balance", "update cash balance", "refresh the cash
balance", "add the beginning cash balance" — set
`<CASH_ONLY_REQUEST> = true`. This skips the full P&L re-fetch when
there's already a budget tab to attach cash to:

1. Run Gate 1's **tab-detection heuristic only** — skip its chooser entirely.
   - **Exactly one existing budget tab found:** lock `<DESTINATION>` = that tab, write mode = `update-in-place`. Skip the rest of Gate 1.
   - **Multiple tabs found:** ask which one via `AskUserQuestion` — tab names only, no "add a new tab" option (a cash-only request has nothing to add a new tab for). Lock `<DESTINATION>`, write mode = `update-in-place`.
   - **No existing tab found:** the fast path doesn't apply — there's no budget yet to attach cash to. Fall through to the normal Gate 1 flow below and treat this as an ordinary fetch-budget run (Gate 4's full fetch is required to populate a new tab). Gate 4.5's opt-in question is still skipped — the user already said "yes" by asking for cash balance in the first place.
2. **Skip Gate 2's picker.** Resolve `<ENTITY_ID>` / `<ENTITY_UUID>` / `<FIRM_UUID>` via `cash-balance.md`'s own entity-resolution fallback (matching the workbook's A1 entity name) instead of running the full picker.
3. **Skip Gate 3.** Derive `<BUDGET_YEAR>` and `<START_DATE>` from the existing tab's month-column headers (row 6) instead of asking — the fast path refreshes the existing period, it doesn't collect a new one.
4. **Skip Gate 4 entirely.** No `fa:list:budgets` calls — the P&L rows are untouched.
5. **Proceed straight to Gate 4.5** — its opt-in question is skipped per its own rule (the prompt already asked for cash balance) — then Gate 5 and Gate 6's cash-only branches (see below).

If `<CASH_ONLY_REQUEST>` is not set (a normal budget pull), ignore this section entirely and start at Gate 1.

---

## Gate 1 — Where to write

Branches by `<RUNTIME>`. Before showing any chooser, **scan the
destination for an existing budget tab** — if one is found, lead with
"update in place" instead of defaulting to a new tab.

### Budget-tab detection heuristic

A sheet counts as an "existing budget tab" when **either** is true:

1. The sheet name contains `Budget` (case-insensitive), e.g. `Budget FY2026`, `2026 Budget`, `MgmtCo Budget`.
2. The sheet's header block contains the word `Account` in a label column AND at least 6 month-like headers (`Jan`, `Jan 2026`, `2026-01`, etc.) in the same row.

Stop at the first match — the user can always pick another tab via the "choose a different tab" branch.

**If `<RUNTIME>` is `excel-addin`:**

1. Use the add-in's workbook-introspection tool to list sheet names + the first ~10 rows of each.
2. Apply the heuristic. Store any matches as `<EXISTING_BUDGET_TABS>`.
3. For each matched tab, **read its full content now** (all rows, not just the first 10) and store it as `<EXISTING_TAB_DATA[tab_name]>`. Gate 5's update-in-place matching uses this cached read — no second workbook read is needed later.

**If `<RUNTIME>` is `local-file`:**

Only scan if the user already supplied a workbook path in their prompt (otherwise defer detection to the file they pick next).

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" "<PATH>"
```

Apply the same heuristic to the JSON output. For each matched tab, store its full content (all rows) from the `read_workbook.py` output as `<EXISTING_TAB_DATA[tab_name]>`.

### Chooser

**If `<EXISTING_BUDGET_TABS>` is non-empty:**

Use `AskUserQuestion`:

> I see a budget tab already in your workbook (**`<existing tab name>`**). Want me to update it with Carta's data, or write the budget somewhere else?

| # | Option | What happens |
|---|---|---|
| 1 | **Update `<existing tab name>` in place** ← recommended | Refreshes the budget values on the existing tab — same accounts, same row positions; **no new tab is created**. |
| 2 | **Add a new tab** | Creates `Budget FY<year>` alongside the existing tab. |
| 3 | **Pick a different existing tab to update** | Lists all sheets in the workbook and asks which one. |
| 4 | **Cancel** | Stops the skill. |

**Update-in-place semantics** (option 1): Use `<EXISTING_TAB_DATA[tab_name]>` already read — **do not re-read the workbook**. For each matched (`gl_code` or `account_name`) row, write the new monthly budget values into the existing month cells. Treat `is_formula: true` cells as **load-bearing** — subtotal / NOI rows are never overwritten. For Carta budget rows that don't match any existing row, surface them in Gate 5 — let the user decide whether to insert or skip. Refresh source note in **A3** (italic): `Source: Carta Fund Admin (refreshed <ISO date>)`.

**If `<EXISTING_BUDGET_TABS>` is empty:**

**Excel add-in — empty-workbook shortcut**: if the active workbook has one sheet, `maxRows == 0`, no other tabs, skip the chooser. Announce the rename in one sentence — *"I'll use the empty workbook you have open and rename `Sheet1` to `Budget FY<year>`."* — then proceed.

Otherwise, use `AskUserQuestion`:

**Excel add-in:**
> Where should I put the Carta budget?
- **"Add a new tab to the open workbook (recommended)"** — creates tab named `Budget FY<year>`.
- **"Overwrite an existing tab in the open workbook"** — asks which tab and confirms before overwriting.
- **"Create a brand new workbook"** — writes to a fresh file.

**Local-file:**
> Where should I write the budget file?
- **"Create a new .xlsx (recommended)"** — ask for the destination path.
- **"Add a new sheet to an existing .xlsx"** — ask for the file path; the sheet name defaults to `Budget FY<year>`. After loading, re-run the budget-tab detection — if the loaded file has an existing budget tab, jump back to the "update in place" chooser above.

Store `<DESTINATION>` for Gates 5–7.

---

## Gate 2 — Pick the entity (ManCo first)

**Critical:** in Carta, only **management companies** carry budgets. Funds and SPVs return empty from `fa:list:budgets`.

**Call `read_skill(file_path="references/entity-picker.md")` before proceeding.** Do not reconstruct the picker logic from memory. Summary of the rule:

1. Call `call_tool({"name": "fa__list__entities", "arguments": {}, "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-manco", "<CAPABILITY>"]}})` against the active firm.
2. Identify ManCo(s) by name suffix / type field — anything matching `(LLC|Management|Mgmt|ManCo|Capital, LLC)` AND with no `Fund` / `Partners` / `SPV` qualifier.
3. Build the picker so the ManCo is the **first** option (with `← recommended`), then other entities below it, then a final option "None of these — let me type the name".
4. Confirm with `AskUserQuestion`.

If the user already named the entity in their prompt and it resolves to exactly one ManCo, skip the picker. Otherwise always ask.

If a non-ManCo is picked, warn before fetching:

> "Heads up — only management companies carry a budget in Carta. If I pull `<entity>`, the result will likely be empty. Want me to pick the ManCo instead?"

**Done when:** `<ENTITY_NAME>`, `<ENTITY_UUID>`, and `<ENTITY_ID>` are locked. `<ENTITY_ID>` (the integer Fund PK, not the UUID) is needed for Gate 4.5's cash-balance fetch.

---

## Gate 3 — Period picker

In **one** `AskUserQuestion` call, ask for the period the prompt didn't already specify. Offer smart defaults based on **today's date** — compute year, half, and quarter labels dynamically.

> What period should I pull the budget for?

| # | Label | Date range |
|---|---|---|
| 1 ← recommended | **Full year `<CURRENT_YEAR>`** | Jan 1 – Dec 31, `<CURRENT_YEAR>` |
| 2 | **H1 `<CURRENT_YEAR>`** (Jan – Jun) | Jan 1 – Jun 30, `<CURRENT_YEAR>` |
| 3 | **H2 `<CURRENT_YEAR>`** (Jul – Dec) | Jul 1 – Dec 31, `<CURRENT_YEAR>` |
| 4 | **`<CURRENT_QUARTER>` `<CURRENT_YEAR>`** | (computed from today's date) |
| 5 | **Custom range** — I'll specify start / end month | — |

Always compute current quarter label and year dynamically from today's date. Drop H1 row once current month is past June. Show prior year as option only if the user mentioned it.

If the prompt already specified a year or range, store it directly and skip the question.

Store `<BUDGET_YEAR>`, `<START_DATE>` (`<YEAR>-<MM>-01`), `<END_DATE>` (last day of `<end_month>`).

**No tag breakdown available.** The budget data from Carta (`fa:list:budgets`) contains no reporting dimension — it returns one amount per account per month. If the user asks for budget broken down by department / tag, tell them in one sentence and offer to route them to `create-budget` (slice-by-tag mode) via `AskUserQuestion` — never a bare numbered list.

---

## Gate 4 — Fetch budget from Carta

**Call `read_skill(file_path="references/fetch-budget-data.md")` before issuing any MCP calls.** Do not reconstruct the fetch contract from memory. Summary:

- Issue **one `call_tool({"name": "fa__list__budgets", ...})` call per month** for every month in the requested window. For a full-year pull this is exactly twelve calls — issue all twelve in one parallel batch. Do **not** try a single annual or quarterly window first.

**Verbatim call template — do not omit `fund_uuid`:**

```
call_tool({"name": "fa__list__budgets", "arguments": {
  "fund_uuid":  "<ENTITY_UUID>",
  "start_date": "<YYYY-MM-01>",
  "end_date":   "<YYYY-MM-{28|29|30|31}>",
  "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-manco", "<CAPABILITY>"]}
}})
```

- Pivot the row list `{account_id, account_name, account_type, amount, start_date}` into a `{account_type → account_name → {month: amount}}` map. Sum if multiple postings hit the same month + account.
- Sort accounts by `account_type` ascending.

**Section mapping** (by leading digit of `account_type`):

| Prefix | Section |
|---|---|
| `4xxx` | Income |
| `5xxx` / `6xxx` / `7xxx` / `8xxx` | Expenses |
| `1xxx` | Investments / Other |
| anything else | Other |

If the fetched dataset is empty, stop and tell the user plainly — common causes: entity isn't a ManCo, or no budget loaded in Carta yet for that year.

---

## Gate 4.5 — Fetch beginning cash balance from Carta (opt-in)

Cash balance is an add-on to the budget pull, not the point of it — ask
before fetching rather than including it silently.

**If the prompt already said one way or the other** (e.g. "include the
cash balance", "don't worry about cash", "no cash balance needed"),
skip the question and use that. Otherwise ask via `AskUserQuestion`:

> Would you like me to include the entity's beginning cash balance in this budget?

- `question`: `"Include beginning cash balance?"`
- `header`: `"Cash balance"`
- `multiSelect`: `false`
- `options`:
  1. **Yes, include it** ← recommended — *description:* "Pulls the live GL cash balance from Carta as of the period start, plus a month-by-month projected cash balance based on each month's budgeted net."
  2. **No, skip it** — *description:* "Build the budget without a cash balance row or cash forecast."

**If "No, skip it":** set `<CASH_BALANCE>` unavailable and skip straight to Gate 5 — no MCP call, no further mention of cash balance anywhere in Gates 5–7.

**If "Yes, include it":** call `read_skill(file_path="references/cash-balance.md")` before issuing the call — do not reconstruct the fetch contract from memory. Then call `fa:get:cash-balance` with `firm_uuid=<FIRM_UUID>`, `entity_ids=[<ENTITY_ID>]`, `as_of_date=<START_DATE>` (the budget period's start date, not today). This runs after Gate 4's budget fetch, not before — a failure here must never block the budget rows already fetched.

- If the result is `available: false` (per `cash-balance.md`'s empty-result handling): proceed without a cash balance row. Do not synthesize $0, and do not halt the rest of Gate 5–7. Tell the user in one sentence that no cash balance data was found for this entity, so "yes" isn't silently downgraded to "no" without their knowledge.
- If `available: true`: store `<CASH_BALANCE>` (totals_by_currency, accounts, has_stale_accounts) for Gate 5's preview and Gate 6's layout.

---

## Gate 5 — Pre-build review (approval gate)

Branches by the Gate 1 write mode (`new-tab`, `overwrite-tab`, `new-workbook`, or `update-in-place`).

### Mode A — fresh write

Present a plain-English preview before any write:

> **Ready to write Carta's 2026 budget for `Example Capital, LLC` — please review.**
>
> - **Source:** Carta Fund Admin (live)
> - **Entity:** Example Capital, LLC (ManCo)
> - **Period:** Jan 2026 – Dec 2026
> - **Income accounts:** 1
> - **Expense accounts:** 47
> - **Sheet to write:** `Budget FY2026` in `<DESTINATION>`
> - **Projected FY totals:** Income **<CCY>13,788,809** · Expenses **<CCY>8,530,121** · Net Operating Income **<CCY>5,258,689**
> - **Beginning cash balance:** **<CCY>950,000** as of Jan 1, 2026 · **Projected cash at year-end:** **<CCY>6,208,689** *(both lines only if `<CASH_BALANCE>` is available — omit entirely otherwise, do not show $0)*

**Multi-currency example** — when `<CASH_BALANCE>.totals_by_currency` has more than one entry, list each currency on its own line instead of the single line above:
> - **Beginning cash balance (USD):** **$950,000** as of Jan 1, 2026 · **Projected at year-end:** **$6,208,689**
> - **Beginning cash balance (EUR):** **€210,000** as of Jan 1, 2026 · **Projected at year-end:** **€340,500**

If `<CASH_BALANCE>.has_stale_accounts` is true, add the staleness caveat sentence from `cash-balance.md` immediately below the bullet list — one sentence, plain English, no raw field names.

### Mode B (cash-only) — refresh cash rows in place

Skip the P&L matched/missing-from-sheet diffing entirely — Gate 4 didn't run under `<CASH_ONLY_REQUEST>`, so there's nothing to diff. Preview shows only the cash rows (one pair per currency — see the multi-currency branch in Gate 6's layout — if `<CASH_BALANCE>.totals_by_currency` has more than one entry):

> Ready to refresh the cash balance in `Budget FY2026` for Example Capital, LLC.
>
> - **Beginning cash balance:** *(existing value if the row is already there)* → **<CCY>950,000** as of Jan 1, 2026
> - **Projected cash at year-end:** *(existing value if present)* → **<CCY>6,208,689**

If the rows don't exist on the tab yet, say so plainly instead of showing an arrow-diff: *"These rows don't exist yet on this tab — I'll add them below Net Operating Income."* If `<CASH_BALANCE>.has_stale_accounts` is true, add the staleness caveat sentence from `cash-balance.md` immediately below. Proceed to the same approval menu below ("Approve refreshing in place?").

### Mode B (full budget) — update existing tab in place

Run the match step first and classify every row:
- **Matched rows** — items where the existing tab's account matches a Carta budget row. These will be refreshed.
- **Carta rows missing from the sheet** — present in Carta but no matching row in the tab. Insert decision deferred to the user.
- **Sheet rows missing from Carta** — present in the tab but not in Carta's response. The skill does **not** touch these.

Preview shape: show matched count, cells to update, Carta rows missing from sheet, sheet rows missing from Carta — with a sample-row table for each category.

If there are Carta rows missing from the sheet, ask via `AskUserQuestion` whether to **insert** them or **skip** them this run.

If `<CASH_BALANCE>` is available: note in the preview whether the Beginning cash balance and Projected cash balance rows already exist on the tab (refresh in place) or are new (insert at the end, below Net Operating Income — same as any other missing-from-sheet row, ask before inserting). If `<CASH_BALANCE>` is unavailable, leave any existing rows of either name untouched — do not overwrite them with a blank.

### Approval menu (both modes)

Output the preview above as a normal conversation message. Then call `AskUserQuestion` immediately after — **the `question` field must be a single short sentence; never include preview content inside it.**

- `question`: `"Approve writing this budget?"` (Mode A) / `"Approve refreshing in place?"` (Mode B)
- `header`: `"Approval"`
- `multiSelect`: `false`
- `options`:
  1. **Approve and write the budget** ← recommended (Mode A) / **Approve and refresh in place** ← recommended (Mode B)
  2. **Edit — change the entity, year, or destination**
  3. **Cancel**

**Hard rule: no workbook-write tool runs before this gate's `AskUserQuestion` returns the user's explicit "Approve and write" choice.**

---

## Gate 6 — Write and brand the workbook

### Approval-recorded check (run FIRST)

Before calling any workbook-write tool, confirm the most recent `AskUserQuestion` answer literally includes `"Approve and write"` or `"Approve and refresh"`. If not — stop, run Gate 5, wait.

### Gate 6 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

- **Call 1:** cell values, formulas, formatting, column widths, cell comments. One `execute_office_js`. Return.
- **Call 2:** logo on the tab via the verbatim brand block (from `branding-and-header.md`).
- **Call 3 (verification):** load shape names, confirm `CartaLogo` exists.

**Before any write**, call `read_skill(file_path="references/branding-and-header.md")`. Do not reconstruct the brand block or header band from memory.

### Mode B (cash-only) — refresh cash rows in place

Applies Gate 5's `### Mode B (cash-only)` preview directly:
1. **Refresh the Beginning cash balance and Projected cash balance rows** (one pair per currency — see the multi-currency branch below) if matching rows exist on the tab — see layout below for their formulas. If the rows don't exist yet, insert them per Gate 5's decision (at the end, below Net Operating Income).
2. **Refresh source note in A3** (italic, size 10): `Source: Carta Fund Admin (refreshed <ISO date>)`.
3. **Never create a new tab, and never touch any other row on the sheet** — no P&L cells, no subtotals, nothing outside the cash rows and A3.

### Mode B (full budget) — update existing tab in place

Applies Gate 5's `### Mode B (full budget)` preview directly:
1. **Refresh matched cells** — `write_cell` / add-in equivalent for every (existing row × month) pair. Hardcoded numbers, never formulas. Preserve all other cells.
2. **Skip every formula cell** (`is_formula: true`).
3. **Insert any approved missing-from-sheet rows** above the right section subtotal. After insertion, rewrite affected section subtotal `=SUM(...)` formulas.
4. **Refresh the Beginning cash balance and Projected cash balance rows** (one pair per currency — see the multi-currency branch below) if `<CASH_BALANCE>` is available and matching rows exist — see layout below for their formulas. If `<CASH_BALANCE>` is available but the rows don't exist yet, insert them per Gate 5's decision (at the end, below Net Operating Income). If `<CASH_BALANCE>` is unavailable, leave any existing rows as-is.
5. **Refresh source note in A3** (italic, size 10): `Source: Carta Fund Admin (refreshed <ISO date>)`.
6. **Never create a new tab** in update-in-place mode.

### Mode A — fresh write layout

4-row metadata band per `branding-and-header.md`:

| Row | Content |
|---|---|
| A1 | `<ENTITY_NAME>` — bold, size 10 |
| A2 | `<BUDGET_YEAR> Budget (from Carta Fund Admin)` — bold, size 10 |
| A3 | `Source: Carta Fund Admin · fa:list:budgets` — italic, size 10 |
| A4 | `Amounts in <resolved_currency>` — italic, size 10 |
| Row 5 | blank |
| Row 6 | Column headers: `Account | Jan <year> | … | Dec <year> | FY <year> Total` — bold, white-on-black, centered |

Body — for each section (Income → Expenses → Other), starting at row 7:
1. Bold + underlined section header row.
2. One row per GL account, sorted by `account_type`. Column A = `account_name`, columns B..M = monthly amounts (hardcoded numbers).
3. Subtotal row at end of section — bold, top thin border, `=SUM(<section_range>)` per monthly column and for column N.

After the last section: **`Total Income`** · blank row · **`Total Expenses`** · blank row · **`Net Operating Income`** (`=<Total Income> - <Total Expenses>`).

Column N = `=SUM(B<row>:M<row>)` for every account, subtotal, and total row — with the two exceptions below.

### Beginning cash balance + Projected cash balance (only if `<CASH_BALANCE>` is available)

Placed at the **end of the table**, below Net Operating Income — not near the header, and not part of the P&L body above. Omit both rows entirely when `<CASH_BALANCE>` is unavailable; never write $0.

**Multi-currency branch — check this before writing anything.** `<CASH_BALANCE>.totals_by_currency` is an **array** — a ManCo can have bank accounts in more than one currency.

- **Exactly one entry:** write a single `Beginning cash balance` row and a single `Projected cash balance` row, as described below.
- **More than one entry:** write one pair of rows **per currency**, labeled with the currency code: `Beginning cash balance (USD)` / `Projected cash balance (USD)`, `Beginning cash balance (EUR)` / `Projected cash balance (EUR)`, etc. Each pair uses only that currency's accounts and `total_balance`. **Never sum or blend values across currencies into one row** — same never-blend rule `cash-balance.md` already requires for the fetch itself.

Everything below describes the layout for **one currency's pair of rows** — repeat once per currency when `<CASH_BALANCE>.totals_by_currency` has more than one entry.

| Row | Content |
|---|---|
| blank | separates this block from Net Operating Income |
| **Beginning cash balance** (append `(<CCY>)` per row when multi-currency) | bold, column A label |
| **Projected cash balance** (append `(<CCY>)` per row when multi-currency) | bold, column A label |

Both rows run across every month — a beginning balance and an ending
balance per month, like a standard cash-flow rollforward. Only the very
first cell is hardcoded; every other cell is a live formula:

**Beginning cash balance row:**
- Column B (first month): the fetched value, hardcoded number — the
  only hardcoded cell in either row. Add a cell comment on this cell:
  `As of <as_of_date from cash-balance.md>`. If
  `<CASH_BALANCE>.has_stale_accounts` is true, append to that same
  comment: `Includes a manual account that may be out of date.`
- Column C onward: `= <Projected cash balance, prior column>` — each
  month's beginning balance is simply last month's ending balance.
  Never hardcode these; never re-fetch per month.
- Column N (FY total): no formula — a rollforward has no single "FY
  total" for a beginning balance (column B already shows the year's
  opening figure).

**Projected cash balance row** — each month's ending balance, live
formulas referencing the Beginning cash balance row and the Net
Operating Income row, never hardcoded:

- Every column (B onward): `= <Beginning cash balance, same column> + <Net Operating Income, same column>`
- Column N (FY total): `= <Projected cash balance, column M>` — the year-end figure, i.e. December's ending balance. **Not** `=SUM(...)` — summing monthly balances double-counts every month's carried-forward cash.

Neither row is ever included in any section subtotal, Total Income, Total Expenses, or Net Operating Income range — they sit below the P&L, not inside it.

**Recalc + column widths (excel-addin, Call 1 last statements):**
```javascript
context.application.calculationMode = Excel.CalculationMode.automatic;
context.workbook.application.calculate(Excel.CalculationType.full);
sheet.getRange("A:A").format.columnWidth = 180;
sheet.getRange("B:N").format.autofitColumns();
await context.sync();
```

Do NOT call `freeze_panes`. Do not autofit a header-only range.

**If `<RUNTIME>` is `local-file`:**
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

After the brand block runs, run this verification as a **separate** `execute_office_js` call before Gate 7:

```javascript
const tabs = ["<TAB_NAME_WRITTEN_THIS_RUN>"];
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name");
  await context.sync();
  result[tabName] = sheet.shapes.items.map(s => s.name);
}
return result;
```

The result must show `CartaLogo` in every tab's shape list. If any tab lacks `CartaLogo`, re-run the brand block and re-verify. **Do not start Gate 7 summary text until this verification returns `CartaLogo` on every tab.**

---

## Gate 7 — Summary + next steps

**Gate 7 precondition (DO NOT SKIP).** Before sending the summary text, confirm three anchors are present in your tool history:
1. An `AskUserQuestion` whose answer included `"Approve and write"` or `"Approve and refresh"` — Gate 5 approval.
2. A `sheet.shapes.addImage(base64)` call for the tab the skill wrote — Gate 6 branding.
3. The branding-verification `execute_office_js` showing `CartaLogo` on the tab — Gate 6 verification.

If any anchor is missing, STOP, go back, run the missing gate.

One or two sentences confirming what got written:

**Mode A (excel-addin):** > Wrote [Budget FY2026](<citation:Budget FY2026!A1:N80>) for **Example Capital, LLC** — 1 income account, 47 expense accounts, source Carta Fund Admin (live). FY total: Income **<CCY>13,788,809** · Expenses **<CCY>8,530,121** · NOI **<CCY>5,258,689**. Beginning cash balance **<CCY>950,000** (as of Jan 1, 2026), projected to **<CCY>6,208,689** by year-end.

**Mode B (excel-addin):** > Refreshed [Budget FY2026](<citation:Budget FY2026!A1:N80>) in place with Carta's 2026 budget for **Example Capital, LLC** — **492** cells updated across **41** line items, beginning cash balance refreshed to **<CCY>950,000** (projected year-end: **<CCY>6,208,689**).

**Cash-only fast path (excel-addin):** > Refreshed the cash balance in [Budget FY2026](<citation:Budget FY2026!A1:N80>) for **Example Capital, LLC** — beginning cash **<CCY>950,000** (as of Jan 1, 2026), projected year-end **<CCY>6,208,689**. The rest of the budget was untouched.

**Multi-currency example (excel-addin):** > Refreshed the cash balance in [Budget FY2026](<citation:Budget FY2026!A1:N80>) for **Example Capital, LLC** — USD beginning cash **$950,000**, projected year-end **$6,208,689**; EUR beginning cash **€210,000**, projected year-end **€340,500**. The rest of the budget was untouched.

Omit the cash-balance clause from either full-budget sentence entirely when `<CASH_BALANCE>` was unavailable or the user opted out in Gate 4.5 — never state a balance that wasn't fetched. When there are multiple currencies, name every one — never report just the first.

**Next-step menu** (via `AskUserQuestion`):
- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Build the P&L with this budget pre-filled"` / `description`: `"← recommended. Hands off to the consolidating P&L skill."`
  2. `label`: `"Refresh actuals against this budget"` / `description`: `"Add or update actual figures in the budget workbook."`
  3. `label`: `"Run a pacing analysis"` / `description`: `"Compare YTD actuals against the budget."`
  4. `label`: `"I'm done"` / `description`: `""`

**When the user selects an option, act on it BEFORE doing any work.** For budgeting follow-ups, load the matching reference via `read_skill(file_path="references/<file>.md")` and follow it from its Gate 1 — context is already warm, so do **not** re-run Gate 0 / 0.75 or re-enter via an external `Skill()` call. The consolidating P&L lives in a separate skill, so it is the one external invocation.

| Option | What to invoke |
|---|---|
| 1 — Build the P&L | `Skill('carta-investors:carta-consolidating-pnl')` (external — consolidating, not budgeting) |
| 2 — Refresh actuals | `read_skill(file_path="references/fetch-actuals.md")` |
| 3 — Pacing analysis | `read_skill(file_path="references/budget-analysis.md")` |
| 4 — Done | No invocation; close cleanly |

---

## Hard rules (fetch-budget specific)

- **Never call `fa:list:budgets` without `fund_uuid`** — MCP rejects with `"missing required params: ['fund_uuid']"`.
- **Never invent budget rows** or extrapolate beyond what `fa:list:budgets` returned.
- **Never apply a buffer percentage** — Carta budget is source of truth.
- **Cash balance is opt-in (Gate 4.5) — never fetch or write it without asking first**, unless the user's prompt already answered the question.
- **Never write a $0 or invented beginning cash balance.** If `fa:get:cash-balance` returns `available: false`, omit both rows — see `cash-balance.md`'s empty-result handling.
- **Beginning cash balance and Projected cash balance are never part of a section subtotal, Total Income, Total Expenses, or NOI formula** — they sit below the P&L, not inside it.
- **Projected cash balance's column-N (FY total) is December's value, never `=SUM(...)`** — summing twelve rolling balances double-counts every carried-forward month.
- **Both cash rows live at the end of the table, below Net Operating Income** — never at the top, and never inside the Income/Expenses/Other body.
- **Never blend multiple currencies into one cash balance figure.** If `<CASH_BALANCE>.totals_by_currency` has more than one entry, write one labeled pair of rows per currency — never pick the first entry and drop the rest.
- **`<CASH_ONLY_REQUEST>` skips Gates 2–4 entirely when an existing budget tab is found** — never re-fetch the full P&L for a cash-balance-only ask.
- **Set `Worksheet.position` in a separate `context.sync()`, never in the same statement as `worksheets.add()`.** Create and activate first: `const sh = sheets.add(name); sh.activate(); await context.sync();`.
- In local-file mode, never silently overwrite — surface "sheet exists" status to the user.
