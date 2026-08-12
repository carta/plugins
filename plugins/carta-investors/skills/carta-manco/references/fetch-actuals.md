# Fetch actuals capability

Entry point for updating actuals in an existing budget. Nine layout sub-references:

- [`add-actuals-columns.md`](add-actuals-columns.md) — **Layout A**: interleave Budget / Actual / Variance per month on the Budget tab (recommended for active tracking).
- [`add-actuals-tab.md`](add-actuals-tab.md) — **Layout B**: add a peer `<year> Actuals` tab alongside the Budget tab.
- [`refresh-existing.md`](refresh-existing.md) — **Layout C**: overwrite stale actuals cells in columns that already exist.
- [`add-period.md`](add-period.md) — **Layout D**: append the single next month/quarter column.
- [`tag-view.md`](tag-view.md) — **Layout E**: new tab with actuals sliced by reporting dimension (department, project code, class, etc.).
- [`vendor-view.md`](vendor-view.md) — **Layout F**: new tab with actuals sliced by vendor, with per-vendor subtotals.
- [`inline-vendor.md`](inline-vendor.md) — **Layout G**: vendor sub-rows added inline to the current actuals tab.
- [`vendor-only-view.md`](vendor-only-view.md) — **Layout H**: new tab with one row per vendor across a timeline — no GL account sub-rows.
- [`sub-account-view.md`](sub-account-view.md) — **Layout I**: new tab with a sub-account drill-down across the full chart of accounts (not just P&L), GL account as the outer grouping with its sub-accounts nested beneath.

Shared helper: [`get-actuals.md`](get-actuals.md) — canonical actuals-query routine.

Gates 0, 0.5, 0.75, and the Router Gate ran in SKILL.md — per its Forbidden narration rule, none of them produced any text output on success. This file picks up at Gate 1.

**Telemetry:** on entry, set `<CAPABILITY> = fetch-actuals`. Every MCP call in this flow tags `_instrumentation.skills = ["carta-manco", "<CAPABILITY>"]`. Re-fire the beacon (`set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco", "fetch-actuals"]})`) if you arrived here via a next-step menu rather than the Router Gate.

---

## Gate 1 — Where to write

Branches by `<RUNTIME>`.

**If `<RUNTIME>` is `excel-addin`:**

**Empty-workbook shortcut**: if the active workbook has one sheet, `maxRows == 0`, no other tabs, skip the chooser. Announce the rename in one sentence and proceed.

> Where should I write the updates?

- **"Update the open workbook directly — recommended"** (modify in place).
- **"Update the open workbook in a new tab"** (preserves the original).
- **"Create a brand new workbook with the updated data"**.

If user picks "update directly", confirm **which tab** explicitly. If multiple tabs look like budgets, ask which one.

**If `<RUNTIME>` is `local-file`:**

> Where is the budget file, and where should the updated version land?

- **"Modify the file in place — recommended"** — ask for the path.
- **"Write a new file alongside the original"** — ask for the path; new file gets a `-updated` suffix by default.

If the user gave a path in the original prompt, skip the choice. Store `<DESTINATION>`.

---

## Gate 2 — Choose the layout (always ask)

**Always ask the user** how the actuals should appear — never assume from the prompt's phrasing alone.

Use `AskUserQuestion`:

> How should the actuals appear in the workbook?

| # | Option | Reference loaded |
|---|---|---|
| 1 | **Interleave Budget / Actual / Variance columns per month** on the Budget tab ← recommended | `read_skill(file_path="references/add-actuals-columns.md")` |
| 2 | **Add a separate `<year> Actuals` tab** alongside the Budget tab | `read_skill(file_path="references/add-actuals-tab.md")` |
| 3 | **Refresh existing Budget / Actual / Variance cells** (the cells are there, just stale) | `read_skill(file_path="references/refresh-existing.md")` |
| 4 | **Add only the next single period column** | `read_skill(file_path="references/add-period.md")` |
| 5 | **Build a tag-view tab — actuals sliced by reporting dimension** | `read_skill(file_path="references/tag-view.md")` |
| 6 | **Build a vendor-view tab — actuals sliced by vendor, with GL account detail** | `read_skill(file_path="references/vendor-view.md")` |
| 7 | **Add vendor rows inline to the current actuals tab** | `read_skill(file_path="references/inline-vendor.md")` — only offered when the active sheet is already an actuals tab |
| 8 | **Build a vendor summary tab — one row per vendor across a timeline, no GL detail** | `read_skill(file_path="references/vendor-only-view.md")` |
| 9 | **Build a sub-account drill-down tab — every GL account (full chart, not just P&L) broken into its sub-accounts** | `read_skill(file_path="references/sub-account-view.md")` |

Use the user's prompt as a *hint* for which option to highlight — never as authority to skip the question:

| Phrase in the prompt | Hint |
|---|---|
| "interleave", "Budget / Actual / Variance", "variance by month" | Option 1 (default `← recommended`) |
| "add a tab", "separate actuals tab" | Option 2 |
| "refresh", "the actuals are stale", "pull latest", "sync" | Option 3 |
| "add next month", "extend through `<month>`", "next period" | Option 4 |
| "by department", "by tag", "by cost center", "broken down by" | Option 5 |
| "by vendor", "vendor view", "vendor breakdown" — **and the active tab is already an actuals tab** | Offer Options 6 and 7 together; 7 ← recommended |
| "by vendor", "vendor view" — **no actuals tab open** | Option 6 |
| "vendor summary", "vendor spend over time", "just vendors" | Option 8 |
| "by sub-account", "sub-account view", "sub-account breakdown", "GL sub-account" | Option 9 |

**Option 5 availability:** always show in chooser; if Gate 2.5 finds no tag data, fall back to Layout A.
**Option 6/8 availability:** always show in chooser; if Gate 2.6/2.8 finds no vendor data, fall back to Layout A.
**Option 7 availability:** only show when the active sheet is already an actuals tab.
**Option 9 availability:** always show in chooser; if Gate 2.9 finds no sub-account data, fall back to Layout A. Expect this fallback to trigger often — sub-account is a sparse, opt-in GL feature.

**Immediately call `read_skill` for the chosen layout** — do not reconstruct from memory.

---

## Gate 2.5 — Tag-category discovery (Layout E path only)

**Skip unless the user chose Layout E at Gate 2.**

**Silent probe — no user-facing output.** Detect JSON vs flat tag path:

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT
            COUNT_IF(REPORTING_TAGS_JSON IS NOT NULL) AS json_rows,
            COUNT_IF(REPORTING_TAGS IS NOT NULL)      AS flat_rows
          FROM <journal_entries_table>
          WHERE FUND_NAME = '<entity_name>'
            AND EFFECTIVE_DATE >= DATEADD('year', -1, CURRENT_DATE)",
  "format": "markdown",
  "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-manco", "<CAPABILITY>"]}
}})
```

- `json_rows > 0` → **JSON path**. Skip Probe 2 — go to Probe 3.
- `json_rows == 0 AND flat_rows > 0` → **flat path**. Set `<CATEGORIES> = ["Reporting Tag"]`.
- Both zero → no tag data. Tell the user in one sentence and fall back to **Layout A**.

Probe 3 — cardinality per category (see `tag-view.md` §"Cardinality guard" for wide vs long thresholds).

---

## Gate 2.6 — Vendor-data discovery (Layout F path only)

**Skip unless the user chose Layout F at Gate 2.**

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT
            COUNT_IF(VENDOR_NAME IS NOT NULL) AS tagged_rows,
            COUNT_IF(VENDOR_NAME IS NULL)     AS untagged_rows,
            COUNT(DISTINCT VENDOR_NAME)       AS distinct_vendors
          FROM <journal_entries_table>
          WHERE FUND_NAME = '<entity_name>'
            AND ACCOUNT_TYPE >= '4000'
            AND EFFECTIVE_DATE >= DATEADD('year', -1, CURRENT_DATE)",
  "format": "markdown",
  "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-manco", "<CAPABILITY>"]}
}})
```

- `tagged_rows > 0` → vendor data exists. Store `<VENDOR_COUNT>` and `<HAS_UNTAGGED>`. Continue to Gate 3.
- `tagged_rows == 0` → no vendor data. Tell the user in one sentence and fall back to **Layout A**.

---

## Gate 2.7 — Vendor-data check (Layout G path only)

**Skip unless the user chose Layout G at Gate 2.** Same probe as Gate 2.6.

---

## Gate 2.8 — Vendor-data discovery (Layout H path only)

**Skip unless the user chose Layout H at Gate 2.** Same probe as Gate 2.6.

---

## Gate 2.9 — Sub-account-data discovery (Layout I path only)

**Skip unless the user chose Layout I at Gate 2.**

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT
            COUNT_IF(SUB_ACCOUNT_NAME IS NOT NULL) AS tagged_rows,
            COUNT_IF(SUB_ACCOUNT_NAME IS NULL)     AS untagged_rows,
            COUNT(DISTINCT SUB_ACCOUNT_NAME)       AS distinct_sub_accounts
          FROM <journal_entries_table>
          WHERE FUND_NAME = '<entity_name>'
            AND EFFECTIVE_DATE >= DATEADD('year', -1, CURRENT_DATE)",
  "format": "markdown",
  "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-manco", "<CAPABILITY>"]}
}})
```

**Deliberately no `ACCOUNT_TYPE >= '4000'` filter here** — unlike Gate 2.5/2.6's probes, this one must match Layout I's full-COA scope (see `sub-account-view.md`). Live testing showed most sub-account tagging sits on capital accounts below the P&L cutoff; restricting this probe to P&L would under-detect real coverage.

- `tagged_rows > 0` → sub-account data exists. Store `<SUBACCOUNT_COUNT>` and `<HAS_UNTAGGED>`. Continue to Gate 3.
- `tagged_rows == 0` → no sub-account data anywhere in the chart of accounts. Tell the user in one sentence and fall back to **Layout A**.

Sub-accounts are a sparse, opt-in GL feature. A `tagged_rows == 0` result here is common even
at firms that have sub-accounts configured — treat it as the expected fallback path, not an
error to investigate.

---

## Gate 3 — Batched parameter gate

In one `AskUserQuestion`, confirm every parameter the prompt didn't already specify.

**Entity:** confirm `<ENTITY_NAME>`. If named at Gate 0, pre-fill it.

**Period:** offer smart defaults based on today's date:

> What period should I pull actuals for?

| # | Label | Date range |
|---|---|---|
| 1 ← recommended | **Full year `<CURRENT_YEAR>`** | Jan 1 – Dec 31, `<CURRENT_YEAR>` |
| 2 | **YTD `<CURRENT_YEAR>`** | Jan 1 – today |
| 3 | **`<CURRENT_QUARTER>`** | (computed from today's date) |
| 4 | **Full year `<PRIOR_YEAR>`** | Jan 1 – Dec 31, `<PRIOR_YEAR>` |
| 5 | **Custom range** | — |

Adapt `← recommended` and options to context. Always compute labels dynamically from today's date.

Store `<PERIOD_START>`, `<PERIOD_END>`, `<MATCH_STRATEGY>` (Layouts A–D: `name first then GL code` or `GL code only`). A third matching dimension — sub-account — is never asked here; Gate 4 auto-detects it from the existing sheet's row structure (see Gate 4).

### Gate 3a — Aggregation level (Layouts E, F, H, and I only)

**Skip for Layouts A–D and G.** Set `<AGGREGATION> = MONTH` and continue.

**For Layouts E, F, H, I, this MUST be a separate `AskUserQuestion` call** — do not bundle with the period question above.

> Aggregate columns by:

| # | Label |
|---|---|
| 1 ← recommended | **Year** — one period block per year |
| 2 | **Quarter** — one block per quarter |
| 3 | **Month** — one block per month |

Store `<AGGREGATION>` (`YEAR` | `QUARTER` | `MONTH`).

### Gate 3b — Detail-row grouping preference (Layouts F, G, and I + excel-addin only)

**Skip for Layouts A–E and H**, or when `<RUNTIME>` is `local-file`.

> Should detail rows be collapsible in Excel?

| # | Label | Description |
|---|---|---|
| 1 ← recommended | **Yes — collapsed by default** | Rows hidden on open; click **+** to expand |
| 2 | **Yes — expanded by default** | Rows visible; click **−** to collapse |
| 3 | **No grouping** | Flat tab, no outline controls |

Store `<VENDOR_GROUPING>` (Layouts F/G) or `<SUBACCOUNT_GROUPING>` (Layout I).

---

## Gate 4 — Read the existing budget

**If `<RUNTIME>` is `excel-addin`:** use the Excel add-in's runtime read tools.

**If `<RUNTIME>` is `local-file`:**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py" "<DESTINATION_PATH>" --sheet "<BUDGET_SHEET>"
```

In both modes: identify header row, line-item rows, actuals/budget columns, formula rows. Treat any cell where `is_formula: true` as load-bearing — never overwrite it.

**Sub-account detection (Layouts A–D only, always run — cheap, no extra tool call):** while
scanning line-item rows, also check for the two-space-indent convention `sub-account-view.md`
and `budget-by-subaccount.md` both use — an unindented account-header row (bold, no amounts)
immediately followed by one or more indented `  No Sub-Account` / `  <sub-account name>` rows.
This is the shape `budget-by-subaccount.md` writes for accounts with sub-account activity. If
found anywhere on the sheet, set `<HAS_SUBACCOUNT_BUDGET_ROWS> = true` and record the flagged
GL codes as `<SUBACCOUNT_BUDGET_ACCOUNTS>`. Most budgets won't have this pattern — a plain
`false` / empty list is the common case, not a failure.

---

## Gate 5 — Load actuals

**Layout E:** use the category-grouped query from `tag-view.md` §SQL. Pick the JSON path when Gate 2.5 detected `REPORTING_TAGS_JSON` rows; flat path when only `REPORTING_TAGS` was populated.

**Layout F:** use the vendor query from `vendor-view.md` §SQL. Uses `COALESCE(VENDOR_NAME, 'No vendor')` so NULL-vendor entries roll into a single 'No vendor' section — do not run a second query for untagged rows.

**Layout H:** use [`queries/actuals-by-vendor-period.sql`](../queries/actuals-by-vendor-period.sql). Returns `(vendor_name, period, signed_amount)` — no `gl_code` or `account_name` columns. Same `COALESCE(VENDOR_NAME, 'No vendor')` convention as Layout F.

**Layout I:** use the query from `sub-account-view.md` §SQL. Full chart of accounts (no `ACCOUNT_TYPE` filter), grouped by section → GL account → sub-account. `COALESCE(SUB_ACCOUNT_NAME, 'No Sub-Account')` means every account gets at least one row whether or not it has sub-account tagging — do not run a second query and do not drop accounts that only produce a 'No Sub-Account' row.

**Layouts A–D:** call `read_skill(file_path="references/get-actuals.md")` for the main actuals query. In parallel, call `read_skill(file_path="references/vendor-actuals.md")` and run the vendor actuals query — loads `<VENDOR_ACTUALS>` into session context. Never write inline SQL outside those files.

**Layouts A–D, sub-account-aware match (only when Gate 4 set `<HAS_SUBACCOUNT_BUDGET_ROWS>`):**
for the accounts in `<SUBACCOUNT_BUDGET_ACCOUNTS>` only, additionally run the query from
`sub-account-view.md` §SQL (`actuals-by-account-subaccount-period.sql`, period-scoped to
`<PERIOD_START>`/`<PERIOD_END>`) and keep just the rows whose `gl_code` is in that list. Match
each sheet row to its actual by `(gl_code, sub_account_name)` — the sheet's `  No Sub-Account`
row matches the query's `No Sub-Account` row exactly like a named sub-account row would.
Every account NOT in `<SUBACCOUNT_BUDGET_ACCOUNTS>` still matches by `<MATCH_STRATEGY>` alone
against the normal flat `get-actuals.md` result — don't run the sub-account query for accounts
that don't need it, and don't apply sub-account matching when `<HAS_SUBACCOUNT_BUDGET_ROWS>`
is false (the overwhelming majority of runs).

**After the actuals are loaded (Layouts F, G, H only):** if the built data structure has a non-empty `No vendor` bucket, go to **Gate 5.5** before the pre-build review. For every other layout, and whenever the `No vendor` bucket is empty, skip Gate 5.5 entirely and proceed to Gate 6.

---

## Gate 5.5 — Infer vendors for 'No vendor' entries (opt-in; Layouts F, G, H only)

**Strictly opt-in — changes nothing by default.** The `No vendor` section renders exactly as before unless the user explicitly asks for inference. Run this gate ONLY when **all** hold: `<LAYOUT>` is F, G, or H; the loaded actuals contain at least one `No vendor` entry; and the user opts in below (or already asked for memo-based inference in their original prompt — then skip Step 1 and go straight to Step 2). Otherwise **do nothing** — skip to Gate 6.

**Step 1 — Offer inference (`AskUserQuestion`):** compute the `No vendor` bucket's entry count and total. Ask:
- `question`: `"<N> entries totalling <total> have no vendor. Want me to infer vendors from their memos?"` (format `<total>` per the resolved currency)
- `options`: 1. **Leave them as 'No vendor'** ← recommended — *"No inference. The 'No vendor' section stays exactly as pulled from the ledger."* 2. **Infer vendors from the entry memos** — *"Read each memo and propose a likely vendor. You approve the list before anything is written."*

If the user picks option 1 (or dismisses), proceed to Gate 6 unchanged. Only continue on option 2 or an up-front request.

**Step 2 — Pull the memos:** run [`queries/no-vendor-memo-lines.sql`](../queries/no-vendor-memo-lines.sql). Resolve `<memo_column>` from the Gate 0 DWH schema lookup (candidates: `MEMO`, `DESCRIPTION`, `LINE_MEMO`, `NARRATIVE`). Substitute `<entity_name>`, `<period_trunc>`, `<period_start>`, `<period_end>`. **If no memo-like column exists**, tell the user in one sentence — *"These entries don't carry a memo I can read, so I'll leave them as 'No vendor'."* — and proceed to Gate 6 unchanged. Do not retry with a different column guess more than once.

**Step 3 — Infer a vendor per memo (existing vendors first):** build the candidate list from existing named vendors already in the loaded data. For each memo: match to an existing vendor when it clearly refers to one (prefer this so amounts reconcile to rows already on the sheet); propose a brand-new vendor name only when the memo unambiguously names one that isn't already present; leave the entry in `No vendor` when not confident — never force a match. Never write inferred vendor tags back to Carta — this is report-only.

**Step 4 — Confirm before applying:** output a preview table (Memo | Inferred vendor | New or existing? | Amount, currency-formatted, never a bare `$`) grouped so existing-vendor matches and new-vendor proposals are visually distinct. Follow with `"<K> of <N> 'No vendor' entries matched (<total matched>). <N−K> stay as 'No vendor'."` Then `AskUserQuestion`:
- `question`: `"Apply these inferred vendors to the report?"`
- `options`: 1. **Apply all inferred vendors** ← recommended 2. **Apply only matches to existing vendors** 3. **Cancel — keep everything as 'No vendor'**

On option 3, proceed to Gate 6 with the bucket unchanged.

**Step 5 — Fold approved inferences into the data structure:** for each approved memo→vendor mapping, move its `signed_amount` (per period, and per GL account for Layouts F/G) out of `No vendor` and into the target vendor — existing vendor: add to its matching cell; new vendor: create a new entry sorted alphabetically among named vendors; residual unmatched/skipped amounts stay in `No vendor` (drop the section if it empties out). Mark every vendor row that received an inferred amount so Gate 7 attaches a cell comment (see each layout reference's "Inferred vendors" section) — flag text **"inferred from memo"**. Store `<INFERRED_VENDORS>` = the list of `(vendor, amount, sample_memo, is_new)` mappings applied, for the Gate 6 preview and Gate 8 summary. The reassigned structure then flows into Gate 6 and Gate 7 like any other vendor data — no separate write path.

---

## Gate 6 — Pre-build review (approval gate)

Preview table grouped by:
- **Existing rows updated** — Line Item | Old Value | New Value | Source.
- **Cells zeroed** — Line Item | Old Value | Reason.
- **New rows to insert** — Account | Section | Position | Value | Source.
- **GL accounts found in DWH with no row in the sheet** — Account | Total in period.

If any rows carry the `low-confidence — sparse history` flag, surface the count above the table.

If Gate 5.5 ran and `<INFERRED_VENDORS>` is non-empty, add an **Inferred vendors** group — Vendor | Amount | New or existing | Sample memo — so the reassignments are visible one last time before the write. Format every amount per the fund's resolved currency, never a bare `$`. State the residual that stayed in `No vendor`.

Output the preview table above as a normal conversation message. Then call `AskUserQuestion` immediately after:

- `question`: `"Approve applying these updates?"`
- `header`: `"Approval"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Approve and apply the updates"` / `description`: `"Writes the actuals to the destination chosen in Gate 1. ← recommended"`
  2. `label`: `"Edit — change the period range, match strategy, or scope"`
  3. `label`: `"Cancel"`

**Hard rule: no workbook-write tool runs before this gate's `AskUserQuestion` returns the user's explicit "Approve and apply the updates" choice.**

---

## Gate 7 — Write the changes AND brand the tabs

### Approval-recorded check (run FIRST)

Before calling any workbook-write tool, confirm the most recent `AskUserQuestion` answer literally includes `"Approve and apply the updates"`. Nothing else clears this gate.

### Gate 7 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

- **Call 1:** apply the cell updates from the approved payload.
- **Call 2 (per tab touched):** logo via the verbatim brand block from `branding-and-header.md`.
- **Final call (combined verification):** currency format + shape geometry on every tab touched.

**Before any write**, call both in the same message (parallel reads):
1. `read_skill(file_path="references/branding-and-header.md")`
2. `read_skill(file_path="references/<layout-from-gate-2>.md")`

Do not reconstruct either spec from memory.

### Verbatim brand block — paste from `branding-and-header.md`, do not improvise

Substitute only `<TAB_NAME>`. Never hardcode `image.height = 48` — height MUST come from `rows.height`. Height is from the E1:E3 row-band, not a single cell.

### Combined currency + branding verification (REQUIRED, observable, excel-addin only)

After all brand blocks run, execute **one** `execute_office_js` that checks both currency format and logo geometry:

```javascript
const tabs = [/* substitute actual tab names touched this run */];
const result = {};
for (const tabName of tabs) {
  const sheet = context.workbook.worksheets.getItem(tabName);
  sheet.shapes.load("items/name,items/height,items/left,items/top");
  const rows = sheet.getRange("E1:E3");
  rows.load(["height", "left"]);
  const cell = sheet.getRange("<sample_amount_cell>");
  cell.load("numberFormat");
  await context.sync();
  const logo = sheet.shapes.items.find(s => s.name === "CartaLogo");
  result[tabName] = {
    numberFormat:      cell.numberFormat[0][0],
    currencyOk:        cell.numberFormat[0][0].includes("[$"),
    found:             !!logo,
    heightMatchesBand: logo ? Math.abs(logo.height - rows.height) < 2 : false,
    leftMatchesBand:   logo ? Math.abs(logo.left - rows.left) < 2 : false,
  };
}
return result;
```

Per-tab pass criteria — ALL must be true: `currencyOk === true`, `found === true`, `heightMatchesBand === true`, `leftMatchesBand === true`.

**Do not start Gate 8 summary text until every tab passes all four criteria.**

**Row grouping (Layout F, excel-addin only, after verification):** if `<VENDOR_GROUPING>` is `collapsed` or `expanded`, run a **4th `execute_office_js` call** per `vendor-view.md` §"Collapse/expand grouping".

---

## Gate 8 — Summary + next steps

**Gate 8 precondition (DO NOT SKIP).** Confirm three anchors are present in your tool history:
1. An `AskUserQuestion` whose answer included `"Approve and apply the updates"` — Gate 6 approval.
2. A `sheet.shapes.addImage(base64)` call for **each** tab touched — Gate 7 branding.
3. The combined verification showing `currencyOk: true`, `found: true`, `heightMatchesBand: true`, `leftMatchesBand: true` for every tab — Gate 7 verification.

If any anchor is missing, STOP, go back, run the missing gate.

One or two sentences confirming what got written, with a clickable link.

**Next-step menu** (via `AskUserQuestion`):
- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`:
  1. `label`: `"Run a pacing analysis (Budget vs Actuals)"` / `description`: `"← recommended. Compare YTD actuals against the budget."`
  2. `label`: `"Drill into a specific line item"` / `description`: `"Largest entries, month-by-month breakdown."`
  3. `label`: `"Model a what-if scenario on this budget"` / `description`: `"Headcount cuts, revenue shocks, etc."`
  4. `label`: `"I'm done"` / `description`: `""`

**When the user selects an option, immediately load the matching reference via `read_skill(file_path="references/<file>.md")` and follow it from its Gate 1 BEFORE doing any work.** Context (`<SERVER>`, `<ENTITY_NAME>`, `<ENTITY_UUID>`, `<RUNTIME>`, `<HAS_MANCO>`) is already warm — do **not** re-run Gate 0 / 0.75 and do **not** re-enter via an external `Skill()` call.

| Option | Reference to load |
|---|---|
| 1 — Pacing analysis | `read_skill(file_path="references/budget-analysis.md")` |
| 2 — Drill into line item | `read_skill(file_path="references/drill-down-line.md")` |
| 3 — What-if scenario | `read_skill(file_path="references/budget-scenarios.md")` |
| 4 — Done | No invocation; close cleanly |
