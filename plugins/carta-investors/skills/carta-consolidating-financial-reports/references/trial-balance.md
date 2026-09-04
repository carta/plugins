[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN base v0.1.0]

# Consolidating Trial Balance

Generates a firm-wide consolidating Trial Balance for a single month as **two tabs**:

1. **TB Consolidated `MMM-YY`** — flat aggregation by Account Code across all entities, with section subtotals and a Grand Total row.
2. **TB By Entity `MMM-YY`** — entities laid out side-by-side as column blocks (Beg / Debit / Credit / End per entity), plus a Total column on the right.

Data is pulled live from Carta's DWH via the Carta MCP connector. This skill runs inside the **Claude for Excel** add-in.

## UX Rules

Plain English only. Never surface MCP server identifiers, DWH column names (`FUND_NAME`, `EFFECTIVE_DATE`, `ACCOUNT_TYPE`), UUIDs, raw JSON, SQL, or gate labels.

- **Currency:** positive `$X,XXX.XX`, negatives `($X,XXX.XX)`, totals bolded `**$X,XXX.XX**`.
- **Citation links:** `[TB Consolidated Apr-26](<citation:TB Consolidated Apr-26!A1:F120>)`.
- **No environment URLs.** This skill builds Excel output only.
- **Every numbered choice MUST be presented via `AskUserQuestion`** — never as a bare markdown list. The `AskUserQuestion` tool is in `allowed-tools`; use it.

## When to use

- "Trial balance of all the entities of `<FIRM>` for `<MONTH>`"
- "Consolidating trial balance for `<FIRM>`"
- "TB by entity for `<FIRM>` `<MONTH>`"
- Any request to replicate the firm-wide TB across all entities

## DO NOT use this skill for

- **Single-entity trial balance** — run a one-off DWH query instead
- **Balance Sheet** — use `read_skill(file_path="references/balance-sheet.md")`
- **P&L / income statement** — use `read_skill(file_path="references/pnl.md")`
- **Multi-period TB** — this skill is point-in-time, single month only

---

## Execution discipline

Execute all gates silently. Do not narrate tool calls, intermediate results, or status updates. Only speak at explicit decision points: Gate 2 (entity scope confirmation if > 5 entities), Gate 4 (pre-build review and approval), Gate 5 (output destination if workbook is non-empty), and Gate 7 (post-action menu).

---

## Entry mode — fresh session vs. chained skill

**Mandatory telemetry beacon — run this before any skip-gate check:** If `<SERVER>` and `<FIRM_UUID>` are already in context, call `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]})` as your very first action. Do not skip this even when all data is already available — it records this skill invocation. If either is unknown, it fires in Gate 0 below.

Before Gate 0, check whether these context variables are already set from an earlier report build in this same skill call (e.g. chained from `references/balance-sheet.md` or `references/pnl.md`):

- `<SERVER>` — connected Carta MCP server prefix
- `<FIRM_NAME>` and `<FIRM_UUID>` — the resolved firm

**If both are in context:** skip Gate 0 entirely. In Gate 1, skip `contexts:list` — but still call `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]})` to re-anchor the session scope and record this skill invocation, then proceed to `fa:list:entities`.

**If either is missing** (fresh session or cold invocation): run Gate 0 and the full Gate 1.

Do not ask "which firm?" when it is already established from the skill the user just ran.

---

## Gate 0: Identify the Carta MCP environment

Scan the tools available in the conversation for any matching `mcp__*__welcome`. Extract the **server identifier** — the middle segment between the first and last `__`. Examples: `mcp__carta__welcome` → `carta`, `mcp__claude_ai_Carta__welcome` → `claude_ai_Carta`.

**If none found:** tell the user no Carta MCP is connected and stop.
**If exactly one found:** call `mcp__<SERVER>__welcome(_instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]})` to verify. This is `<SERVER>`.
**If multiple found:** ask the user which to use via `AskUserQuestion`. Default to `carta` (production) if present.
**Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every other command is gated and will return a reminder.

**DWH param-name traps:** `dwh:execute:query` takes `sql:` not `query:`. `format` accepts `"ndjson"` / `"markdown"`, not `"csv"`.

---

## Gate 1: Resolve firm + entities

1. `mcp__<SERVER>__list_contexts(firm_name="<FIRM>", _instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]})`. Do not use `call_tool` for `list_contexts` — call the granular tool directly with `_instrumentation` as shown. Multiple matches → `AskUserQuestion` to disambiguate.
2. `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]})`. Do not use `call_tool` for `set_context` — call the granular tool directly with `_instrumentation` as shown.
3. `call_tool({"name": "fa__list__entities", "arguments": {}, "_instrumentation_v2": {"skills": ["carta-investors:carta-consolidating-financial-reports"]}})` → entity list with `name` and `uuid`. Cache the full list.

**Done when:** `<FIRM_NAME>`, `<FIRM_UUID>`, and the full entity list are locked.

---

## Gate 2: Confirm entity scope

If `fa:list:entities` returns **≤ 5 entities**, proceed without asking — include all of them.

If **> 5 entities**, show a short summary and ask via `AskUserQuestion`:

> **N entities found under `<FIRM_NAME>`:**
> Fund A · Fund B · Fund C · Elimination · GP LP · …

```
Which entities should the Trial Balance include?
1 - All entities (N)  ← recommended
2 - Exclude Elimination / zero-activity entities
3 - Pick from a list
4 - Cancel
```

Handle each branch:

- **1 — All** → include every entity from Gate 1.
- **2 — Exclude Elimination** → filter out entities whose name contains "Elimination" or "Elim" (case-insensitive). Show the resulting list and confirm before continuing.
- **3 — Pick from a list** → multi-select `AskUserQuestion`, one option per entity name. Require at least one selection.
- **4 — Cancel** → stop the skill cleanly.

Lock the chosen list as `<entity_scope>` (list of `{name, uuid}` pairs). Never run the TB query with an empty scope.

**Done when:** `<entity_scope>` is a confirmed non-empty list.

---

## Gate 2.5: Runtime and target workbook

Load [`references/local-file-output.md`](references/local-file-output.md)
and follow its **Runtime gate** section to set `<RUNTIME>` and `<TARGET_FILE>`.

Run it **here, before Gate 3 pulls any data.** This skill was written for the
Claude for Excel add-in, but it also runs in Cowork, the Claude desktop app, and
Claude Code. On those surfaces there is no add-in and no "active workbook" tool,
so an add-in-only output path reaches Gate 5 with nothing it can call and stops —
which the user experiences as the skill running and producing nothing at all.

Do not guess `excel-addin`. If no Excel add-in tools are present in the
conversation, the runtime is `local-file`.

Skip this gate only if `<RUNTIME>` and `<TARGET_FILE>` are already in context
(e.g. handed down by a calling skill that resolved them up front).

**Done when:** `<RUNTIME>` is set, and `<TARGET_FILE>` is set or explicitly null.

---

## Gate 3: Pull TB data

**CRITICAL — amount-column trap.** `FUND_ADMIN.JOURNAL_ENTRIES` has two amount columns. `BASE_CURRENCY_AMOUNT` is sparsely populated (typically < 10% of rows); the other ~90%+ only have `AMOUNT`. **Always use `COALESCE(BASE_CURRENCY_AMOUNT, AMOUNT)`** — filtering on `BASE_CURRENCY_AMOUNT` alone silently drops most journal entries and makes most entities appear empty.

Run via `call_tool({"name": "dwh__execute__query", "arguments": {"sql": "...", "format": "ndjson"}, "_instrumentation_v2": {"skills": ["carta-investors:carta-consolidating-financial-reports"]}})`. SELECT-only.

```sql
WITH bounds AS (
  SELECT DATE '<YYYY-MM-01>'              AS month_start,
         LAST_DAY(DATE '<YYYY-MM-01>')    AS month_end
),
je AS (
  SELECT FUND_NAME, FUND_UUID, ACCOUNT_TYPE, ACCOUNT_NAME, NORMAL_BALANCE,
         EFFECTIVE_DATE,
         COALESCE(BASE_CURRENCY_AMOUNT, AMOUNT) AS AMT
  FROM FUND_ADMIN.JOURNAL_ENTRIES
  WHERE FIRM_ID = '<firm_uuid>'
    AND EFFECTIVE_DATE <= (SELECT month_end FROM bounds)
)
SELECT
  je.FUND_NAME, je.FUND_UUID,
  je.ACCOUNT_TYPE   AS ACCOUNT_CODE,
  je.ACCOUNT_NAME,
  je.NORMAL_BALANCE,
  SUM(CASE WHEN je.EFFECTIVE_DATE <  b.month_start THEN je.AMT END)                              AS BEG_BAL,
  SUM(CASE WHEN je.EFFECTIVE_DATE BETWEEN b.month_start AND b.month_end AND je.AMT > 0 THEN je.AMT END) AS PERIOD_DR,
  SUM(CASE WHEN je.EFFECTIVE_DATE BETWEEN b.month_start AND b.month_end AND je.AMT < 0 THEN je.AMT END) AS PERIOD_CR,
  SUM(je.AMT)                                                                                    AS END_BAL
FROM je
CROSS JOIN bounds b
WHERE je.FUND_UUID IN (<comma-separated single-quoted UUIDs from entity_scope>)
GROUP BY 1, 2, 3, 4, 5
HAVING COALESCE(SUM(CASE WHEN je.EFFECTIVE_DATE <  b.month_start THEN je.AMT END), 0) <> 0
    OR COALESCE(SUM(CASE WHEN je.EFFECTIVE_DATE BETWEEN b.month_start AND b.month_end THEN je.AMT END), 0) <> 0
    OR COALESCE(SUM(je.AMT), 0) <> 0
ORDER BY je.FUND_NAME, je.ACCOUNT_TYPE
```

**Sanity check:** count distinct `FUND_NAME` returned vs. `<entity_scope>`. If many entities are absent and a quick `SELECT FUND_NAME, COUNT(*) FROM FUND_ADMIN.JOURNAL_ENTRIES WHERE FIRM_ID = '<firm_uuid>' GROUP BY 1` shows they have raw rows, the COALESCE was likely dropped — re-check the query.

Stash large results (> 1 000 rows) in `blobs.setJSON("tb_data", ...)`. Treat `NULL` values as `0` when summing.

**Done when:** you have the tidy `(FUND_NAME, ACCOUNT_CODE, ACCOUNT_NAME, NORMAL_BALANCE, BEG_BAL, PERIOD_DR, PERIOD_CR, END_BAL)` dataset.

---

## Gate 4: Pre-build review (approval gate)

Output the preview as a normal conversation message. Then call `AskUserQuestion` immediately after — **the `question` field must be a single short sentence; never include preview content inside it.**

Preview shape:

> **Ready to build the Trial Balance — please review.**
>
> - **Firm:** `<FIRM_NAME>`
> - **Period:** `<Mon YYYY>` (Beg = `<YYYY-MM-01>`, End = `<YYYY-MM-DD month_end>`)
> - **Entity scope:** N entities — Entity A, Entity B, …
> - **Unique account codes:** X
> - **Sheets to write:** `TB Consolidated <MMM-YY>` and `TB By Entity <MMM-YY>`

Then call `AskUserQuestion` with:

- `question`: `"Approve building the Trial Balance?"`
- `header`: `"Approval"`
- `multiSelect`: `false`
- `options`:
  1. **Approve and build** ← recommended (`description`: `"Writes both TB tabs to the destination chosen next."`)
  2. **Change the firm, period, or entity scope**
  3. **Cancel**

If Edit, return to the relevant gate and re-run. **Hard rule: no workbook-write tool runs before this gate's `AskUserQuestion` returns `"Approve and build"`.**

---

## Gate 5: Output destination

Branch on `<RUNTIME>` from Gate 2.5.

**If `<RUNTIME>` is `local-file`:** follow the **Destination**, **Writing**,
**Verification**, and **Closing summary** sections of
[`references/local-file-output.md`](references/local-file-output.md)
instead of the add-in table below, then continue to Gate 6. Report-specific
inputs it needs:

- **Proposed sheet names:** `TB Consolidated <MMM-YY>` and `TB By Entity <MMM-YY>`.
- **New-file name when `<TARGET_FILE>` is null:** `TB - <FIRM-SHORT> <MMM-YY>.xlsx`.
- **COA label detection** compares against the account names in the Gate 3
  dataset — ≥ 5 matching labels in a sheet's column B counts as a match.
- **Content and layout** come from Gate 6 unchanged.

**If `<RUNTIME>` is `excel-addin`:** check for an active workbook in the Excel
add-in and use the table below.

| Case | Action |
|---|---|
| **No workbook open** | Create a new workbook silently. Tell the user in one sentence. |
| **Empty workbook** (one sheet, `maxRows == 0`) | Use it without asking. Announce the rename in one sentence. |
| **Non-empty workbook** | Ask via `AskUserQuestion`: *"You have `<workbook>.xlsx` open. May I add `TB Consolidated <MMM-YY>` and `TB By Entity <MMM-YY>` to it?"* Options: `Yes, add tabs here` / `No, create a new workbook` / `Cancel`. |

If new sheet names collide with existing tabs, append a numeric suffix (`… Apr-26 (2)`) and mention it in Gate 7. Truncate to Excel's 31-char limit after suffixing.

Lock `<destination_workbook>` and both target sheet names.

**Done when:** destination and sheet names are confirmed and the user has explicitly consented to any edit to a pre-existing workbook.

---

## Gate 6: Build both sheets

### Approval-recorded check (run FIRST, before any write tool)

Before calling any state-mutating `execute_office_js`, confirm your tool history includes an `AskUserQuestion` answer literally containing `"Approve and build"` from Gate 4. If not, run Gate 4 first.

### Call structure — AT LEAST three `execute_office_js` calls per tab

- **Call 1:** cell values, formulas, number formats, borders, freeze panes. One `execute_office_js`. Return.
- **Call 2:** Carta logo via the verbatim brand block below.
- **Call 3 (verification):** load shape names, confirm `CartaLogo` exists.

Do not bundle Calls 1 and 2. Build the Consolidated tab fully, then the By-Entity tab fully, before Gate 7.

**`execute_office_js`'s `code` field has no templating step — it runs
verbatim.** When you need to inject a large computed payload (e.g. a row-plan
array), build the final JS string yourself with the real JSON inlined as a
literal (`const plan = [...];`), not a placeholder token like
`PLAN_JSON_PLACEHOLDER` or a quoted string expecting server-side substitution —
neither will be replaced, and both fail at parse time.

---

### Metadata band (rows 1–5, both tabs)

| Cell | Content | Style |
|---|---|---|
| B1 | `<FIRM_NAME>` | bold, Calibri 10, color `#1F3864` |
| B2 | Consolidated: `<YYYY> Trial Balance — Consolidated (<Mon YYYY>)`. By-Entity: `<YYYY> Trial Balance — By Entity (<Mon YYYY>)`. | bold, Calibri 10, color `#3F3F3F` |
| B3 | `Source: Carta Fund Admin · FUND_ADMIN.JOURNAL_ENTRIES` | italic, Calibri 10, color `#595959` |
| B4 | Consolidated: `Consolidating N entities: Entity1 • Entity2 • …` (alphabetical, bullet-separated). By-Entity: `Amounts in <resolved_currency>. N entities side-by-side; Total column sums across all entities.` (resolve the currency from fund data; never hardcode USD) | italic, Calibri 10, color `#595959`, wrap text, row height ≥ 30pt |
| Row 5 | blank | row height ~8pt |

---

### Carta logo — verbatim brand block, DO NOT SKIP (both tabs)

The tab is not "built" until it carries a `CartaLogo` shape anchored to the E1:E3 row band. Paste this block verbatim per tab — substitute only `<TAB_NAME>`:

```javascript
const base64 = blobs.getText("assets/powered_by_carta.b64.txt").trim();

const sheet = context.workbook.worksheets.getItem("<TAB_NAME>");
const shapes = sheet.shapes;
shapes.load("items/name");
await context.sync();

for (const s of shapes.items) {
  if (s.name === "CartaLogo") s.delete();
}
await context.sync();

const rows = sheet.getRange("E1:E3");
rows.load(["left", "top", "height"]);
await context.sync();

const image = sheet.shapes.addImage(base64);
image.name = "CartaLogo";

image.load(["width", "height"]);
await context.sync();
const ratio = image.width / image.height;

image.lockAspectRatio = false;
image.height = rows.height;
image.width  = rows.height * ratio;
image.left   = rows.left;
image.top    = rows.top;
image.lockAspectRatio = true;
await context.sync();
```

**Brand-verification call (REQUIRED, observable).** Run as a separate `execute_office_js` before Gate 7:

```javascript
const sheet = context.workbook.worksheets.getItem("<TAB_NAME>");
sheet.shapes.load("items/name");
await context.sync();
return sheet.shapes.items.map(s => s.name);
```

Result must include `"CartaLogo"`. If missing, re-run the brand block.

---

### Number formats (both tabs)

**Money cells:** use the locale-specific token for the resolved currency — resolve from fund data before writing, never default to USD:
- USD: `_([$$-en-US]* #,##0.00_);_([$$-en-US]* (#,##0.00);_([$$-en-US]* "-"??_);_(@_)`
- EUR: `_([$€-x-euro2]* #,##0.00_);_([$€-x-euro2]* (#,##0.00);_([$€-x-euro2]* "-"??_);_(@_)`
- GBP: `_([$£-en-GB]* #,##0.00_);_([$£-en-GB]* (#,##0.00);_([$£-en-GB]* "-"??_);_(@_)`
- CAD: `_([$CA$-en-CA]* #,##0.00_);_([$CA$-en-CA]* (#,##0.00);_([$CA$-en-CA]* "-"??_);_(@_)`

Never use bare `$`, `[$-409]`, or Excel's built-in Accounting format — they render as `R$` / `£` / `¥` on non-US installs.

**Account Code column:** `numberFormat = "@"` (text) — **set BEFORE writing**. Prevents `"1000"` being coerced to a number.

---

### Section classification (both tabs)

| Leading digit of Account Code | Section |
|---|---|
| `1xxx` | Assets |
| `2xxx` | Liabilities |
| `3xxx` | Equity |
| `4xxx` | Revenue |
| `5xxx`–`9xxx` | Expenses |
| Other | Other |

Section order: Assets → Liabilities → Equity → Revenue → Expenses → Other. Sort within each section by Account Code ascending (string sort).

---

### Polish — formatting rules (both tabs)

- **Column header rows**: bold, **white text on black fill** (`#000000` fill, `#FFFFFF` font), centered, wrap text, row height ≥ 34pt. **Set `numberFormat = "@"` on any header cell containing a date string BEFORE writing** (e.g. `MM/DD/YYYY`) — Excel will otherwise coerce it to a date serial.
- **Section header rows** (e.g. `Assets`, `Liabilities`): bold + underlined, font color `#1F3864`, fill `#F2F2F2`. No cell borders.
- **Subtotal rows** (`Total Assets`, `Total Liabilities`, etc.): bold, fill `#EAECEF`, top thin + bottom medium black border.
- **Grand Total row**: bold, font color `#1F3864`, fill `#D6DCE4`, **double-thick navy border** top and bottom (`style = "Double"`, `color = "#1F3864"`).
- **Border syntax (Office.js):** `style = "Continuous"` then `weight = "Thin"|"Medium"|"Thick"`. `"Thin"` is not a valid `style` value — it raises `InvalidArgument`.
- **`fill.color` must be a hex string** like `"#F2F2F2"`. An undefined variable silently produces `InvalidArgument`.

---

### Sheet A — TB Consolidated `MMM-YY`

**Layout** (after metadata band):

| Row | Content |
|---|---|
| Row 6 | Column headers — A = `Account Code`, B = `Account Name`, C = `Beginning Balance` + newline + `MM/01/YYYY`, D = `Debit` + newline + `Period Activity`, E = `Credit` + newline + `Period Activity`, F = `Ending Balance` + newline + `MM/DD/YYYY`. White-on-black, bold, centered, wrap text, row height ≥ 34pt. |
| Row 7 | Section header `Assets` in column B (bold, underlined, `#1F3864`, fill `#F2F2F2`). |
| Rows 8+ | Asset account rows: A = code (text, `@` format), B = name, C–E = raw aggregated values, F = **formula** `=C{row}+D{row}+E{row}`. |
| After last Asset row | `Total Assets` subtotal — bold, fill `#EAECEF`, borders. Then blank row. Then next section. |
| Last row | **Grand Total** — navy bold, fill `#D6DCE4`, double-line navy border. |

**Aggregation:** group by `ACCOUNT_CODE`; sum `BEG_BAL`, `PERIOD_DR`, `PERIOD_CR`, `END_BAL` across all entities. Use the **longest non-empty** `ACCOUNT_NAME` for each code (handles minor label drift across entities).

**Grand Total formula** per column C/D/E/F:
`=<Total Assets> + <Total Liabilities> + <Total Equity> + <Total Revenue> + <Total Expenses> + <Total Other>`
**NOT `=SUM(C:C)`** — that double-counts section subtotals.

**Freeze panes:** `freezeAt("B7")` — locks rows 1–6 (metadata + header) and column A (Account Code) in view.

**Column widths:** A = 75pt, B = 260pt, C–F = 100pt each.

---

### Sheet B — TB By Entity `MMM-YY` — Side-by-Side Layout

For N entities: total width = 2 label columns + N × 4 entity columns + 4 Total columns.

**Layout** (after metadata band):

| Row | Content |
|---|---|
| Row 6 (entity banners) | Merge each entity's 4-column block (e.g. C6:F6, G6:J6, …). White-on-black, bold, centered — write entity display name. Merge the Total block (last 4 cols) with label `Total`. **Set `numberFormat = "@"` on merged cells BEFORE merging.** `range.merge(true)` discards trailing values — merge first, then write. |
| Row 7 (sub-headers) | Per block: `Beg Balance` + date, `Debit` + `Period Activity`, `Credit` + `Period Activity`, `End Balance` + date. White-on-black, bold, centered, wrap text, row height ≥ 38pt. A7 = `Account Code`, B7 = `Account Name` — same fill. |
| Row 8 | Section header `Assets` in column B. |
| Rows 9+ | One data row per unique Account Code across all entities. |
| … | Section subtotals, blank rows, Grand Total at bottom. |

**Data rows** — per entity block:
- Beg / Dr / Cr columns: raw value from that entity's query row, or **blank** if the entity has no entry for this account.
- Ending Balance column: `=IF(AND(ISBLANK(<Beg>), ISBLANK(<Dr>), ISBLANK(<Cr>)), "", N(<Beg>)+N(<Dr>)+N(<Cr>))` — keeps the cell visually blank when the entity doesn't have the account. Never show `-` for a non-existent account.

**Total block** per column: `=SUM(<refs to corresponding column across all entity blocks>)`.

**Section subtotal rows:** `=SUM(...)` over that section's data rows for each column. Bold, fill `#EAECEF`, thin top + medium bottom border.

**Grand Total row:** same sum-of-subtotals pattern (not `SUM(C:C)`). Bold, navy, fill `#D6DCE4`, double-line navy border.

**Vertical entity dividers:** every entity block's first column gets a medium grey (`#A6A6A6`) left border running from row 6 to the Grand Total row. The Total block gets a heavier black medium left border. **Re-apply these borders as a final pass after all fills** — range-fill operations can wipe inner borders.

**Freeze panes:** `freezeAt("C8")` — locks rows 1–7 (metadata + banners + sub-headers) and columns A–B (label columns) so entities can be scrolled horizontally while labels stay visible.

**Column widths:** A = 75pt, B = 260pt, every numeric column (entity + Total) = 95pt each.

---

## Gate 7: Verify and report

**Gate 7 precondition.** Before sending the report, scan your tool history. For each tab, verify:
1. `AskUserQuestion` answer `"Approve and build"` — Gate 4 approval.
2. `shapes.addImage(base64)` call for the tab — branding.
3. Brand-verification `execute_office_js` returning `CartaLogo` — branding check.

**Tie-outs:**

1. **Cross-tab check:** for each Account Code on the Consolidated tab, the four values (Beg/Dr/Cr/End) should equal the Total block for that account on the By-Entity tab (within $1). Flag any divergence.
2. **Balance check:** Grand Total Beg ≈ 0, End ≈ 0, Dr + Cr ≈ 0. Flag if off by > $1 (usually indicates backdated JEs outside the entity scope).
3. **Zero-activity entities:** list any entity from `<entity_scope>` that returned no rows from the query — they are absent from the By-Entity tab's column blocks.

**Report:**

> Trial Balance ready in `<workbook>.xlsx`:
> [TB Consolidated `<MMM-YY>`](<citation:TB Consolidated <MMM-YY>!A1:F{last_row}>) and [TB By Entity `<MMM-YY>`](<citation:TB By Entity <MMM-YY>!A1:{last_col}{last_row}>).
>
> **N** entities · **X** unique account codes.
>
> **Key tie-outs:** Grand Total Beg **$0.00** ✅ · End **$0.00** ✅ · Dr+Cr **$0.00** ✅

*(If any entities had no JE activity: "Entities excluded (no activity): Entity A, Entity B.")*

**Post-action menu** via `AskUserQuestion`:

- `question`: `"What would you like to do next?"`
- `header`: `"Next step"`
- `multiSelect`: `false`
- `options`:
  1. **Build the Balance Sheet for the same firm and period** ← recommended
  2. **Build the P&L for the same firm and period**
  3. **Build the TB for a different period**
  4. **I'm done**

| Option | Action |
|---|---|
| 1 — Balance Sheet | `read_skill(file_path="references/balance-sheet.md")` |
| 2 — P&L | `read_skill(file_path="references/pnl.md")` |
| 3 — Different period | Re-entry from Gate 3 with new month |
| 4 — Done | Close cleanly |

---

## Error handling

| Symptom | Tell the user |
|---|---|
| No Carta MCP connected | "Open Settings → Connectors, enable Carta, then retry." |
| `contexts:list` no match | Echo name, ask for spelling. Don't near-match silently. |
| `contexts:list` multiple matches | Show candidates via `AskUserQuestion`. |
| Query returns 0 rows | "No journal entries found for this firm through `<Mon YYYY>`. Check the period or confirm books are open for that month." |
| Many entities missing from results | "Fewer entities than expected appeared in the results. If a quick row-count confirms they have raw journal entries, the COALESCE may have been dropped — I'll re-check the query." Re-run Gate 3. |
| Query timeout | Tell user it's slow, offer to retry — never auto-retry. |
| Auth / permission error | Ask user to reconnect Carta in Settings → Connectors. Do not retry automatically. |

Never auto-retry a failed command. Always surface the failure and let the user decide.

---

## Common pitfalls

1. **`BASE_CURRENCY_AMOUNT` sparsity** — always `COALESCE(BASE_CURRENCY_AMOUNT, AMOUNT)`. The #1 cause of "most entities look empty".
2. **Account Code is text** — set `numberFormat = "@"` BEFORE writing. Prevents `"1000"` coercing to a number and losing leading zeros.
3. **Credits stored as negatives** — pass through unchanged; the accounting format renders them as `(600,069.30)`.
4. **End Balance is a formula, not a hardcoded value** — `=Beg+Dr+Cr` so the user can audit by clicking the cell.
5. **Grand Total sums section subtotal cells, NOT the full column** — `=SUM(C:C)` double-counts. Always sum the subtotal cells explicitly.
6. **`range.merge(true)` discards trailing values** — merge first, then write the value into the merged range.
7. **Re-apply vertical entity dividers AFTER fills** — range-fill operations can wipe inner borders. Reset per-entity left borders as a final pass.
8. **By-Entity End Balance formula** — use `=IF(AND(ISBLANK(...)), "", N(...)+N(...)+N(...))` so non-existent accounts stay blank rather than showing `-`.
9. **Sheet name limit** — 31 chars. `TB Consolidated MMM-YY` = 22 ✓, `TB By Entity MMM-YY` = 19 ✓.
10. **Always `EFFECTIVE_DATE`** — never `POSTED_DATE`.
11. **Office.js `numberFormat` arrays must match cell dimensions exactly** — `Array(rows).fill(Array(cols).fill(FORMAT))`.
12. **`fill.color` must be a hex string** — `"#D6DCE4"`. An undefined variable silently raises `InvalidArgument`.
