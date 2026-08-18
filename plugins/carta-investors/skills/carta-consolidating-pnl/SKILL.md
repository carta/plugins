---
name: carta-consolidating-pnl
model: sonnet
description: 'Consolidating P&L (Income Statement) across the entities of a firm, for any period the user picks — a month, quarter, year, or start-to-end date range. Produces TWO Excel tabs: detail P&L (Period + YTD Actual/Budget/Variance/%) and executive Summary P&L formula-linked to detail. Optional tag-view breaks Actuals down by all firm reporting-tag categories with per-category subtotals. Runs in Claude for Excel (writes into the open workbook), and in Cowork, the desktop app, and Claude Code (adds tabs to an attached .xlsx, or creates one). Sourced from Carta MCP. TRIGGER on "consolidating P&L for [firm] [period]", "P&L for all entities of [firm]", "P&L for our funds", "firm-wide income statement", "P&L with executive summary", "P&L by department", "P&L by tag", "income statement by cost center". DO NOT TRIGGER for single-entity P&L, balance sheet (carta-consolidating-balance-sheet), or ManCo budgeting (carta-manco: budgets, actuals, pacing, what-if).'
version: 1.1.1
allowed-tools:
  # Production
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__fetch
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_contexts
  # Carta-installer naming (lowercase)
  - mcp__carta_production__call_tool
  - mcp__carta_production__fetch
  - mcp__carta_production__welcome
  - mcp__carta_production__set_context
  - mcp__carta_production__list_contexts
  # Local / legacy fallback
  - mcp__carta__call_tool
  - mcp__carta__fetch
  - mcp__carta__welcome
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - Read
  - AskUserQuestion
  # local-file runtime (Cowork / desktop app / Claude Code) — without these the
  # skill has no way to produce a workbook outside the Excel add-in
  - Write
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py *)
  - Bash(test *)
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN menus-and-flows v0.0.7]
[PATTERN base v0.1.0]

# Consolidating P&L (detail + executive summary)

Generates a consolidating Income Statement across the entities of a firm, for
the period the user chooses, as **two linked tabs**:

1. A **detail tab** (`P&L - <FIRM-SHORT> <PERIOD-LABEL>`) matching the
   "P&L- with comments" format, with Period and YTD blocks of Actual /
   Budget / Variance / %.
2. A **Summary P&L** tab at sheet position 0 — a one-page executive
   summary that rolls the detail up into a small set of category lines,
   formula-linked back to the detail.

The data is pulled live from Carta's DWH via the Carta MCP connector —
nothing is embedded in the skill.

The audience is an accountant working in their workbook, not an engineer
running CLI commands.

## Period and scope are the user's choice

Two things this skill must never assume:

- **The period is not always one month.** A P&L is a statement of activity over
  a span of time. Accept a month, a quarter, a year, or an explicit start and end
  date, and label the left-hand block with whatever the user asked for. Gate 1.5
  collects this.
- **The scope is not always every entity under the firm.** These are
  *consolidating* reports across a set of entities, and the user picks the set.
  Asking only "which firm?" and silently rolling up everything beneath it is the
  most common source of surprise on this report. Gate 1.25 collects this.

## Surfaces

This skill runs on four surfaces. The only difference between them is where the
workbook comes from — the report itself is identical.

| Surface | `<RUNTIME>` | Where the tabs land |
|---|---|---|
| Claude for Excel | `excel-addin` | Directly into the workbook already open in front of the user. |
| Cowork | `local-file` | Into an attached `.xlsx`, or a new one the skill creates. |
| Claude desktop app | `local-file` | Same as Cowork. |
| Claude Code | `local-file` | Same as Cowork. |

Claude for Excel is the smoothest of the four, because the accountant sees the
tabs appear in the workbook they were already working in. It is not the only
supported surface, and the skill must not dead-end on the others — Gate 1.5
resolves the runtime and the target workbook before any query runs.

## UX Rules

This skill ships as a standalone Claude for Excel skill — the global `carta-skill-ux-rules` SessionStart hook covers currency formatting, status vocabulary, no-UUID display, and plain-English speech. Skill-specific deviations:

- **Citation links** to Excel ranges use the citation form: `[B1:Q72](<citation:P&L - Acme Mar-26!B1:Q72>)`.
- **No environment URLs.** This skill builds Excel output, not Carta web links — the BASE_URL rule from the global hook does not apply.

## Environment detection (Claude for Excel)

This skill does **not** call `carta auth-status` — that command isn't
available inside the Excel add-in. Instead, the active Carta environment
is detected at Gate 0 from the connected MCP server's prefix
(`mcp__claude_ai_Carta_<Env>__call_tool`).

## When to use

Trigger on any request shaped like:

- "(Consolidating) P&L for `<FIRM>` for `<MONTH>`" — with or without "with executive summary"
- "P&L for all entities of `<FIRM>`" / "firm-wide income statement"
- Any ask to replicate the "P&L- with comments" + Summary P&L pair for another firm/period

Do **NOT** use this skill for:

- **Single-entity P&L** — use `carta-explore-data`; this skill consolidates across a set of entities
- **Balance Sheet** requests — use `carta-consolidating-balance-sheet`
- **Multi-period trend** analysis (one Actual column per month across a range) or **per-entity side-by-side columns** — clarify before building; this skill produces ONE consolidated Actual column per block

## Inputs to collect

Before running, confirm with the user:

1. **Firm name** — must match a firm reachable from the active Carta MCP
   context (resolved fuzzily). Example: `Acme Ventures`.
2. **Entities to include** — which funds and entities under that firm belong in
   the consolidation. Gate 1.25 resolves this. Do not skip it and do not
   substitute the firm answer for it.
3. **Period** — a start and an end date (`YYYY-MM-DD` each). A single month is
   just the common case, not the only one. Gate 1.5 resolves this.
4. **Target workbook** — the open workbook (Claude for Excel), an attached
   `.xlsx`, or a new file. Gate 1.5 resolves this.

If the user supplied any of these in the request, use them and don't re-ask.
Only the firm and the period are strictly required to produce a report; if the
user declines to narrow the entities, `all` is a valid answer — but they must be
given the chance to choose.

---

## Execution discipline

Execute all gates silently. Do not narrate tool calls, intermediate results, or status updates. Only speak at explicit decision points: Gate 1.25 (entity picker), Gate 1.5 (period, and the runtime / target-workbook question), Gate 4 (pre-build review, build chooser, and budget source), Gate 4b (if budget source requires a file or tab), Gate 5 (output destination if workbook is non-empty), and Gate 9 (post-action menu).

---

## Entry mode — fresh session vs. chained skill

**Mandatory telemetry beacon — run this before any skip-gate check:** If `<SERVER>` and `<FIRM_UUID>` are already in context, call `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-consolidating-pnl"]})` as your very first action. Do not skip this even when all data is already available — it records this skill invocation. If either is unknown, it fires in Gate 0 below.

Before Gate 0, check whether these context variables are already set from an earlier skill call in the same session (e.g. chained from `carta-consolidating-balance-sheet`, or handed down by a calling skill that resolved them up front):

- `<SERVER>` — connected Carta MCP server prefix
- `<FIRM_NAME>` and `<FIRM_UUID>` — the resolved firm
- `<ENTITY_SCOPE>` — `all`, or the explicit list of entities to consolidate
- `<PERIOD_START>` and `<PERIOD_END>` — the reporting period, `YYYY-MM-DD`
- `<RUNTIME>` — `excel-addin` or `local-file`
- `<TARGET_FILE>` — the workbook to write into (`local-file` runtime only)

**If `<SERVER>` and `<FIRM_UUID>` are both in context:** skip Gate 0. Call `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-consolidating-pnl"]})` to re-anchor the session scope and record this skill invocation, then continue from the first gate whose inputs are still missing.

**Skip each of these gates only when its own inputs are already set:**

| Gate | Skip when |
|---|---|
| Gate 0 (MCP environment) | `<SERVER>` is set |
| Gate 1 (resolve firm) | `<FIRM_NAME>` and `<FIRM_UUID>` are set |
| Gate 1.25 (entity scope) | `<ENTITY_SCOPE>` is set |
| Gate 1.5 (period + runtime) | `<PERIOD_START>`, `<PERIOD_END>`, `<RUNTIME>`, and `<TARGET_FILE>` are all set |

A firm arriving in context does **not** imply an entity scope or a period. A
calling skill that resolved all of them up front will have set every variable; a
direct invocation or a chain from another consolidating skill usually has not.
Check each variable independently rather than skipping to Gate 2 on the strength
of the firm alone.

Do not ask "which firm?" when it is already established from the skill the user just ran.

---

## Gate 0: Identify the Carta MCP environment

Scan the tools available in the conversation for any matching `mcp__*__welcome`. Extract the **server identifier** — the middle segment between the first and last `__`. Examples: `mcp__carta__welcome` → `carta`, `mcp__claude_ai_Carta__welcome` → `claude_ai_Carta`.

**If none found:** tell the user no Carta MCP is connected and stop.
**If exactly one found:** call `mcp__<SERVER>__welcome(_instrumentation={"plugin": "carta-investors", "skills": ["carta-consolidating-pnl"]})` to verify. This is `<SERVER>`.
**If multiple found:** ask the user which to use via `AskUserQuestion`. Default to `carta` (production) if present.
**Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every other command is gated and will return a reminder.

---

## Gate 1: Resolve firm

1. `mcp__<SERVER>__list_contexts(firm_name="<FIRM>", _instrumentation={"plugin": "carta-investors", "skills": ["carta-consolidating-pnl"]})`. Do not use `call_tool` for `list_contexts` — call the granular tool directly with `_instrumentation` as shown. Multiple matches → `AskUserQuestion`. Wait for confirmation.
2. `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-consolidating-pnl"]})`. Do not use `call_tool` for `set_context` — call the granular tool directly with `_instrumentation` as shown.

**DWH param-name traps:** `dwh:execute:query` takes `sql:` not `query:`. `dwh:get:table_schema` takes `table_name:` not `table:`. `format` accepts `"ndjson"` / `"markdown"`, not `"csv"`.

**Phrase the firm question as the firm, and say the entity question is next.** If
you have to ask for a firm, make clear it isn't the scope question:

> Which firm should I pull this from? I'll ask which funds and entities to
> include right after.

---

## Gate 1.25: Resolve the entity scope

Skip only if `<ENTITY_SCOPE>` is already in context.

A consolidating P&L spans a set of entities and the user picks the set. Ask.

```
call_tool({"name": "fa__list__entities", "arguments": {}, "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-consolidating-pnl"]}})
```

Classify each returned entity — prefer the API's own `type`, and fall back to
these name heuristics **in order, first match wins**:

| Label | Heuristic |
|---|---|
| `ManCo` | name contains any of `Management`, `Mgmt`, `ManCo`, OR ends in `Capital, LLC` / `Partners Management`, AND does **not** contain `Fund`, `SPV`, `LP`, `Co-Invest`, `Bridge` |
| `Fund` | name contains `Fund` |
| `SPV` | name contains `SPV`, `Co-Invest`, `Bridge` |
| `Other` | anything else — don't guess |

Then ask via `AskUserQuestion`. **`AskUserQuestion` renders at most 4 options and
silently drops the rest**, so the shape depends on the count:

- **Exactly one entity returned:** don't ask. Tell the user the firm has a single
  entity, so a consolidating P&L is just that entity's income statement, and
  offer `carta-explore-data` instead. Stop.
- **Zero entities returned:** the firm resolved but has no Fund Admin entities.
  Say so plainly and stop — do not fall back to an unfiltered firm-wide query.
- **Two or three entities:** one option per entity, plus a final "All of them"
  option carrying the `← recommended` marker in its *description*.
- **Four or more:** ask for the scope shape first — "All entities under the firm"
  (recommended, with the count), "Just the management company", "Just the funds"
  (with the count), "Let me pick specific entities". Omit the ManCo or funds
  option if no entity classified that way. If the user picks "Let me pick
  specific entities", list them as plain numbered text — grouped management
  companies, then funds, then SPVs, then `Other`, each labelled with its kind in
  plain English — and ask them to reply with the numbers. Re-ask once on an
  unparseable reply, echoing the valid range; after a second failure default to
  all entities and say so in one sentence.

> Which funds and entities should I include in this report?

**Never phrase this as "which firm?"** The firm is already resolved. Customers
read "firm" as the whole management company and are then surprised when a chosen
fund's numbers don't appear on their own.

Store `<ENTITY_SCOPE>` as the literal string `all`, or as a list of
`{name, uuid}` records. Never show a UUID to the user.

**Done when:** `<ENTITY_SCOPE>` is set.

---

## Gate 1.5: Resolve the period, runtime, and target workbook

Skip only if `<PERIOD_START>`, `<PERIOD_END>`, `<RUNTIME>`, and `<TARGET_FILE>`
are all in context.

### Period

If the user named a period — a month, a quarter, a year, or two explicit dates —
use it. Otherwise ask via `AskUserQuestion`, and **offer a range, not just a
single month.** A P&L is a statement of activity over time; offering one month is
the most common reason the output isn't what the customer expected.

> What period should the P&L cover?

| # | Label | Description |
|---|---|---|
| 1 | Month to date | The current month through today. |
| 2 | Quarter to date | The current quarter through today. |
| 3 | Year to date | January 1 through today. |
| 4 | A specific start and end date | Tell me the two dates and I'll use that range. |

Resolve to:

- `<PERIOD_START>` — first day of the requested span, `YYYY-MM-DD`
- `<PERIOD_END>` — last day of the requested span, `YYYY-MM-DD`
- `<YTD_START>` — `<year of PERIOD_END>-01-01`

Derive `<PERIOD_LABEL>` for tab and header text from the span:

| Span | `<PERIOD_LABEL>` |
|---|---|
| Exactly one calendar month | `Mar-26` |
| Exactly one calendar quarter | `Q1-26` |
| A full calendar year | `FY26` |
| Anything else | `Mar-Jun 26` (start month–end month, end year) |

Keep the detail tab name within Excel's 31-character limit:
`P&L - <FIRM-SHORT> <PERIOD-LABEL>`.

If `<PERIOD_START>` falls in an earlier year than `<PERIOD_END>`, the YTD block
covers only the `<PERIOD_END>` year and will be *shorter* than the period block.
Say so in one clause at Gate 4 rather than presenting a YTD column that looks
wrong.

### Runtime and target workbook

Load [`references/local-file-output.md`](references/local-file-output.md)
and follow its **Runtime gate** section to set `<RUNTIME>` and `<TARGET_FILE>`.
Run it here, before any query — a runtime mismatch discovered at Gate 5 has
already cost the user a full data pull, and on a local surface it reads as the
skill doing nothing at all.

Do not guess `excel-addin`. That guess is the specific failure this gate exists
to prevent: there is no add-in to call on Cowork, the desktop app, or Claude
Code, so an add-in-only path dead-ends with no output and no actionable error.

**Done when:** `<PERIOD_START>`, `<PERIOD_END>`, `<YTD_START>`,
`<PERIOD_LABEL>`, `<RUNTIME>`, and `<TARGET_FILE>` are all set.

---

## Gate 2: Pull the two period blocks

The schema and sign conventions for the Carta DWH journal-entries
table are documented in `references/schema.md`. Load that file now
and apply its rules.

The period boundaries come from Gate 1.5: `<PERIOD_START>`, `<PERIOD_END>`, and
`<YTD_START>`. Do not recompute them from a month, and do not assume
`<PERIOD_START>` is the first of a month — it can be any date the user gave.

**Query window.** The outer `EFFECTIVE_DATE` predicate must cover *both* blocks,
so it spans `LEAST(<PERIOD_START>, <YTD_START>)` through `<PERIOD_END>`. When the
period starts in an earlier year than it ends, `<PERIOD_START>` is the earlier
bound; otherwise `<YTD_START>` is. Compute `<WINDOW_START>` as the earlier of the
two and use it below — an outer filter of `<YTD_START>`…`<PERIOD_END>` would
silently drop the part of the period that falls before January 1.

**Single query, both blocks at once, summed across the entities in scope:**

```sql
SELECT
  ACCOUNT_TYPE,
  ACCOUNT_NAME,
  SUM(CASE WHEN EFFECTIVE_DATE BETWEEN '<period_start>' AND '<period_end>' THEN AMOUNT ELSE 0 END) AS PERIOD_AMT,
  SUM(CASE WHEN EFFECTIVE_DATE BETWEEN '<ytd_start>'    AND '<period_end>' THEN AMOUNT ELSE 0 END) AS YTD_AMT
FROM <journal_entries_table>
WHERE FIRM_ID = '<firm_uuid>'
  AND ACCOUNT_TYPE >= '4000'
  AND EFFECTIVE_DATE BETWEEN '<window_start>' AND '<period_end>'
  -- entity scope from Gate 1.25: omit this line entirely when <ENTITY_SCOPE> = all
  AND FUND_NAME IN ('<entity_name_1>', '<entity_name_2>', …)
GROUP BY 1, 2
HAVING SUM(CASE WHEN EFFECTIVE_DATE BETWEEN '<ytd_start>' AND '<period_end>' THEN AMOUNT ELSE 0 END) <> 0
    OR SUM(CASE WHEN EFFECTIVE_DATE BETWEEN '<period_start>' AND '<period_end>' THEN AMOUNT ELSE 0 END) <> 0
ORDER BY 1, 2
```

**Entity scope.** When `<ENTITY_SCOPE>` is `all`, omit the `FUND_NAME` line — that
is the firm-wide roll-up. When it is an explicit list, filter on the entity
display names. Escape single quotes in entity names by doubling them
(`O''Brien Capital`); fund legal names routinely contain apostrophes, commas, and
periods.

**Why the `HAVING` clause tests both blocks.** With a period that can start before
January 1, an account may have period activity but zero YTD activity. Testing YTD
alone would drop it from the report.

### DWH result formatting

Queries > 50 rows: request `format: "ndjson"`, bucket into a blob. Don't paste large results — triggers `context_snip`. Use `"markdown"` only for ≤50-row previews.

Run via `call_tool({"name": "dwh__execute__query", "arguments": {"sql": "..."}, "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-consolidating-pnl"]}})`.

SELECT-only.

**Critical**: `FUND_NAME` appears only in the `WHERE` clause, never in the
`GROUP BY`. The GROUP BY on `ACCOUNT_TYPE, ACCOUNT_NAME` rolls the same COA
account up across every in-scope entity into a single row — that is what makes
the output *consolidating* rather than per-entity. Narrowing `<ENTITY_SCOPE>`
changes which entities are summed, not the shape of the result.

**The `HAVING ... <> 0` clause filters out accounts with no actuals in either
block.** That's correct for this stage — but **do not** treat that filtered set as
the final row list for the workbook. If a budget is loaded in Gate 4b,
accounts with budget but zero actuals must still appear as rows (with `-`
or `0` in the Actual columns). The row-set merge happens at the start of
Gate 6 — see "Row set: union of actuals + budget" there.

**Done when:** the period dataset is loaded — Period + YTD amounts for every
P&L account with activity in either block, aggregated across the entities in
`<ENTITY_SCOPE>`.

---

## Gate 2.5: Tag-category discovery (silent probe)

**Always run this gate** — even if the user hasn't asked for tag-view. The result determines whether the Gate 4 build chooser shows the "tag-view" option or hides it. **Silent — no user-facing output.**

Tag-view layout (when chosen at Gate 4) shows **all firm tag categories side by side** under each period band — no "which dimension?" picker. This probe's job is to discover whether the firm has a tag taxonomy in `REPORTING_TAGS_JSON` (or falls back to the flat `REPORTING_TAGS` column).

### Probe 1 — Detect the JSON-vs-flat path

```sql
SELECT
  COUNT_IF(REPORTING_TAGS_JSON IS NOT NULL) AS json_rows,
  COUNT_IF(REPORTING_TAGS IS NOT NULL)      AS flat_rows
FROM <journal_entries_table>
WHERE FIRM_ID = '<firm_uuid>'
  AND EFFECTIVE_DATE BETWEEN '<window_start>' AND '<period_end>'
```

- `json_rows > 0` → **JSON path**. Skip Probe 2 — go directly to Probe 3 (JSON path). Probe 3 returns both category names and cardinality in one query, making a separate category-discovery query redundant.
- `json_rows == 0 AND flat_rows > 0` → **flat path**. Set `<TAG_CATEGORIES> = ["Reporting Tag"]`, `<TAG_PATH> = "flat"`, and continue to Probe 3.
- Both zero → set `<TAG_CATEGORIES> = []`, `<TAG_PATH> = "none"`. Gate 4 will omit the tag-view chooser option.

### Probe 3 — Cardinality per category (when tag-view is on the table)

Only needed if `<TAG_CATEGORIES>` is non-empty. Returns the value count per category for the wide-vs-long decision in Gate 4's dimension picker.

**JSON path:**
```sql
SELECT f.key::TEXT AS category, COUNT(DISTINCT f.value::TEXT) AS n_values
FROM <journal_entries_table>,
     LATERAL FLATTEN(input => REPORTING_TAGS_JSON) f
WHERE FIRM_ID = '<firm_uuid>'
  AND REPORTING_TAGS_JSON IS NOT NULL
  AND EFFECTIVE_DATE BETWEEN '<window_start>' AND '<period_end>'
GROUP BY 1
ORDER BY 1
```

**JSON path — after query:** Store `<TAG_CATEGORIES>` as the sorted list of distinct `category` values returned, set `<TAG_PATH> = "json"`, and store `<TAG_CARDINALITY>` as the map of `category → n_values`.

**Flat path:**
```sql
SELECT 'Reporting Tag' AS category, COUNT(DISTINCT REPORTING_TAGS) AS n_values
FROM <journal_entries_table>
WHERE FIRM_ID = '<firm_uuid>'
  AND REPORTING_TAGS IS NOT NULL
  AND EFFECTIVE_DATE BETWEEN '<window_start>' AND '<period_end>'
```

**Flat path — after query:** `<TAG_CATEGORIES>` is already set to `["Reporting Tag"]` (from Probe 1). Keep `<TAG_PATH> = "flat"`. Store `<TAG_CARDINALITY>` as `{"Reporting Tag": n_values}`.

**No `AskUserQuestion` here.** This gate only probes. The tag-view choice happens in Gate 4 if the user picks tag-view mode; the wide-vs-long choice (if needed) is asked there too.

**Done when:** `<TAG_CATEGORIES>` and `<TAG_PATH>` are populated.

---

## Gate 3: Classify and assign to sections

Classify by leading digit of `ACCOUNT_TYPE`, per `references/schema.md`:

- `4xxx` → **Revenue** — multiply `PERIOD_AMT` and `YTD_AMT` by `-1` for
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
> - **Period:** Jan 1 – Jun 30, 2026 (plus YTD through Jun 30, 2026)
> - **Entities:** Acme Capital Management, Acme Ventures Fund I, Acme Ventures Fund II
> - **Revenue accounts:** 4 (Bank interest, Monitoring income,
>   Flow-through distributions, Unrealized gains)
> - **Expense accounts:** 32, grouped into Human Capital, Contractor
>   Expenses, Occupancy & Office, Professional Services, Travel &
>   Marketing, Technology & Data, Other
> - **Where it goes:** two new tabs in `Acme-Financials.xlsx`
>     - `P&L - Acme Jan-Jun 26` (detail)
>     - `Summary P&L` (executive summary, first tab)
>
> Note: if you pull from a budget source below, accounts that have a
> budget but no actuals this period will also be added as rows (with
> `$0` actuals) — final count may be slightly higher than the
> totals above.

**Echo the period and the entity scope back explicitly** — these are the two
things users most often find surprising after the fact, and this review is the
last point at which they can correct them cheaply.

- **Period:** state the actual span, not just a month name. If the span is a
  single month, say so (`March 2026`); if it's a range, give both dates.
- **Entities:** name them when there are 5 or fewer. Above that, give the count
  and the mix — *"12 entities — 1 management company, 9 funds, 2 SPVs"*. When
  `<ENTITY_SCOPE>` is `all`, say *"all entities under the firm"* explicitly
  rather than leaving scope unstated.
- **Where it goes:** name the destination — the open workbook, the attached file,
  or a new `.xlsx` — so the user knows before the write, not after.

If `<PERIOD_START>` falls in an earlier year than `<PERIOD_END>`, add one clause
so the shorter YTD column doesn't read as a bug:

> Your period starts before January 1, so the YTD column covers 2026 only and
> will be smaller than the period column.

If any expense accounts landed in `Other`, surface them here:

> ⚠ **3 accounts landed in `Other`:** "Carried interest expense",
> "Foreign exchange", "Misc operating". Confirm or adjust the section
> mapping before building.

Then ask with `AskUserQuestion`. **The available options depend on whether Gate 2.5 found tag data** (i.e. whether `<TAG_CATEGORIES>` is non-empty):

```
1 - Build both tabs (detail + Summary)  ← recommended
2 - Build the detail tab only (no Summary)
3 - Build a tag-view tab — Actuals broken down by all reporting tag categories   ← only if <TAG_CATEGORIES> is non-empty
4 - Change the firm or period
5 - Cancel
```

If `<TAG_CATEGORIES>` is empty, omit option 3 from the chooser entirely.
If the user's prompt explicitly asked for tag/department/cost-center breakdown,
make option 3 the `← recommended` default (and demote option 1 to a plain option).

Handle each branch:

- **1 — Build both tabs** → proceed to the budget source question below.
- **2 — Detail only** → drop the Summary build from the plan; proceed to the budget source question below. Gates 5–6 run only, then Gate 8 verifies the detail alone and omits the Summary tie-out.
- **3 — Tag-view** → record `build_mode = "tag-view"`. **Skip the budget source question entirely** (no Budget/Variance columns in tag-view mode). All firm tag categories from `<TAG_CATEGORIES>` are shown side by side under each period band — no dimension picker. The only follow-up is the wide-vs-long question below, and only if cardinality exceeds the threshold.
- **4 — Change firm or period** → return to Inputs, re-run Gates 1–3, then present this review again.
- **5 — Cancel** → stop the skill cleanly.

### Wide vs long (only when option 3 chosen AND cardinality is high)

Compute the **total column count per period block** as: `sum(n_values for each category in <TAG_CATEGORIES>) + len(<TAG_CATEGORIES>)`. The `+ len(...)` term covers the per-category Total columns. Multiply by 2 for the Period + YTD blocks.

If the combined total exceeds 24, ask via `AskUserQuestion`. The `← recommended` marker depends on which side of the 36-column threshold the run falls on (mirrors the Cardinality guard table in `references/tag-view.md`):

> The tag-view tab would have `<N>` columns across `<C>` categories (`<cat1>`, `<cat2>`, …). With that many, should I build wide (one column per tag per category per period) or long (one row per tag per account)?

| Total tag columns (Period + YTD combined) | Recommended option |
|---|---|
| 25–36 | **Wide — one column per tag** ← recommended |
| > 36 | **Long — one row per tag per account** ← recommended |

Always offer both options regardless of which is recommended — accountants sometimes want the wide layout even past 36 columns if they're going to filter it down in Excel.

Store `<TAG_LAYOUT>` (`wide` | `long`). Default `wide` for ≤ 24 (no question asked).

**Loop until the user picks a build option or cancels.** Never write to
Excel based on inferred intent.

**Do not** surface internal field names (`ACCOUNT_TYPE`, `PERIOD_AMT`,
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

**Skip this gate entirely if `build_mode == "tag-view"`.** Tag-view mode
writes Actuals only — there are no Budget/Variance/% columns to fill. The
Carta `fa:list:budgets` API has no tag dimension, so a per-tag Budget
column would be mathematically misleading (the same budget value
duplicated across every tag column).

Fetch the budget rows now — before any Excel writes — so Gate 6 can
write Budget columns E + N in the same pass as the detail build.

### Option 1 — Pull from Carta

Read [`references/budget-fetch.md`](references/budget-fetch.md) now and
follow Part A (entity picker) + Part B (fetch). Then return here with the
budget rows in the output shape that file documents.

**Narrow the date window in the `fa:list:budgets` call** — pass `start_date = <window_start>` and `end_date = <period_end>` (the same window Gate 2 uses, so it covers both the period block and the YTD block). An un-narrowed call returns the full annual budget (~44KB for a typical ManCo), which forces an extra round-trip through `code_execution` and burns context. The narrowed response is small enough to handle inline.

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

Branch on `<RUNTIME>` from Gate 1.5. The two runtimes resolve the destination
completely differently, and running the wrong branch is what makes this skill
appear to do nothing at all: in a `local-file` runtime there is no Excel add-in
to ask for an "active workbook", so an add-in-only Gate 5 dead-ends with no
output and no error the user can act on.

- **`excel-addin`** → **Branch A** below (the open-workbook matrix).
- **`local-file`** → **Branch B** below (attached file or new `.xlsx`).

---

### Branch A — `excel-addin` runtime

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
   | **A. No workbook open** | Add-in reports no active workbook | Create a new workbook silently. Tell the user in one sentence that you created `P&L - <FIRM-SHORT> <PERIOD-LABEL>.xlsx` because nothing was open. |
   | **B. Empty workbook open** | One sheet, `maxRows == 0`, no data, no other tabs (e.g. a fresh `Book1.xlsx` / `Sheet1`) | Use it without asking. **Announce the rename** in one sentence before writing: *"I'll use the empty workbook you have open and rename `Sheet1` to `P&L - <FIRM-SHORT> <PERIOD-LABEL>`."* No `AskUserQuestion` is required for the empty case — asking adds friction with no decision to make. |
   | **C. Non-empty workbook open** | Any sheet has data, OR more than one sheet exists | Run the COA label scan described below, then ask. |

   **COA label detection (Case C only).** Before asking the user anything,
   scan every existing tab for matching P&L content. For each tab, read
   non-empty values from column B via `execute_office_js` and compare them
   against the `ACCOUNT_NAME` values in the Gate 3 dataset. A tab is a
   **COA-label match** if ≥ 5 account labels from the current query appear
   in that tab's column B. An **exact-name match** is a tab whose name
   equals the proposed detail-tab name (`P&L - <FIRM-SHORT> <PERIOD-LABEL>`).

   - **If a matching tab is found (exact-name or COA-label):** ask via
     `AskUserQuestion`, naming the matched tab explicitly:
     > *"I found an existing tab `<matched_tab_name>` that appears to
     > contain P&L data for this firm. What would you like to do?"*
     > Options:
     > - **"Update the existing `<matched_tab_name>` tab"** — clear and
     >   rebuild it in place (also rebuild `Summary P&L` if present). ← recommended
     > - **"Create new tabs instead"** — adds `P&L - <FIRM-SHORT> <PERIOD-LABEL>`
     >   (and `Summary P&L`) as new tabs (with a numeric suffix like `(2)`
     >   if those names also already exist; truncate to 31 chars after suffixing).
     > - **"Cancel"** — stop the skill.
     If the user picks **"Update existing tab"**, clear the matched tab's
     used data range before writing:
     ```javascript
     const sheet = context.workbook.worksheets.getItem("<matched_tab_name>");
     sheet.getUsedRange().clear();
     await context.sync();
     ```
     Proceed to Gate 6 using `<matched_tab_name>` as the detail-tab target
     (the sheet already exists — do not call `create_sheet`). Also clear
     and reuse the existing `Summary P&L` tab if it is present; otherwise
     create it fresh.
   - **If no matching tab is found:** ask concretely via `AskUserQuestion`:
     *"You have `<workbook>.xlsx` open with N tabs. May I add
     `P&L - <FIRM-SHORT> <PERIOD-LABEL>` and `Summary P&L` to it?"*
     Options: `Add P&L tabs to this workbook` / `Create a new workbook instead` / `Cancel`.
   - If the user picks "Create new tabs" and the proposed name collides
     with an existing tab, append a numeric suffix (`… Mar-26 (2)`) and
     mention the rename in Gate 8's report. Truncate to Excel's 31-character
     limit after suffixing.

3. **If the user cancels** or denies edit permission for the active
   workbook **and** picks "Cancel": stop the skill cleanly. Don't fall
   back silently to creating a new file.

**The hard rule from Gate 4 still applies** — no workbook-write tool runs
before this gate has either (a) returned an explicit "Yes" answer for case
C, or (b) explicitly announced the rename for case B / new workbook for
case A. Case B removes the dialog but does NOT remove the announcement.

Lock the chosen `<destination workbook>` and the two target sheet names
(`P&L - <FIRM-SHORT> <PERIOD-LABEL>` for the detail, and `Summary P&L` for the
executive summary) and use them through Gates 6, 7, and 8.

**If `budget_source = "workbook_tab"` (deferred from Gate 4b):**
List the open workbook's tabs and use `AskUserQuestion` to ask which
one holds the budget. Same header heuristic as Gate 4b option 2. Parse
and store the rows now, before Gate 6 writes.
Source label: `Imported from tab "<TAB_NAME>" in this workbook`.
Ask the user about scope (`single-entity` vs `firm-wide`).

---

### Branch B — `local-file` runtime

There is no add-in and no "active workbook" here. **Load
[`references/local-file-output.md`](references/local-file-output.md)
now and follow it.** It owns the destination resolution, the
Office.js→operations translation table, the `read_workbook.py` /
`write_workbook.py` invocations, the verification readback, and the closing-summary
path rules — all shared with the other consolidating reports.

Report-specific inputs it needs from here:

- **Proposed tab names:** `P&L - <FIRM-SHORT> <PERIOD-LABEL>` (detail) and
  `Summary P&L` (executive summary, sheet position 0).
- **New-file name when `<TARGET_FILE>` is null:**
  `P&L - <FIRM-SHORT> <PERIOD-LABEL>.xlsx`.
- **COA label detection** compares against the `ACCOUNT_NAME` values in the Gate 3
  dataset — same ≥ 5-label threshold as Branch A.
- **Content and layout** come from Gate 6 and Gate 7 unchanged: the column map,
  number formats, section order, the `=D{row}-E{row}` variance formulas, and the
  Summary tab's cross-sheet links. The shared reference changes *how* each write
  is issued, never *what* is written.
- **Logo anchor:** `E1`, sized to the `E1:E3` row band — see
  [`references/branding-and-header.md`](references/branding-and-header.md).

**The hard rule from Gate 4 applies here too** — no write runs before Gate 4's
build approval, and no write to a pre-existing file runs before the shared
reference's destination `AskUserQuestion` returns an explicit yes.

---

**Done when:** the destination (open workbook, `<TARGET_FILE>`, or a new file
path) and both target sheet names are known, and the user has explicitly
consented to any edit to a pre-existing workbook.

---

## Gate 6: Build and brand the detail P&L tab

### Tag-view branch (if `build_mode == "tag-view"`)

**Stop reading the rest of Gate 6 and switch references.** Load
[`references/tag-view.md`](references/tag-view.md) now and follow it
verbatim. That file documents:

- Tab name (`P&L by Reporting Tag - <FIRM-SHORT> <PERIOD-LABEL>`).
- Three-row nested header: row 4 = period band (merged `<PERIOD-LABEL>` / `YTD <PERIOD-LABEL>`); row 5 = category band (merged per category within each period block); row 6 = tag header (account + tag values + per-category Total per block).
- Category-grouped SQL — JSON path uses `LATERAL FLATTEN` + `CROSS JOIN` to produce one row per (entry × category); flat path uses a synthetic `'Reporting Tag'` category.
- All firm tag categories shown side by side (from `<TAG_CATEGORIES>`) — no dimension picker.
- No Budget / Variance / % columns. No Summary tab. No Gate 7.
- Same metadata band, branding, sign convention, classification, section order, and number formats as the standard build.

**Currency-format verification (REQUIRED, observable, excel-addin only).** After the cell-write call (and before the brand block), run this readback as a **separate** `execute_office_js` call:

```javascript
const sheet = context.workbook.worksheets.getItem("<TAG_VIEW_TAB_NAME>");
const cell = sheet.getRange("<sample_amount_cell>");  // e.g. first data cell, typically C7
cell.load("numberFormat");
await context.sync();
return cell.numberFormat[0][0];
```

The returned string MUST contain a locale-specific currency token matching the resolved fund currency (one of `[$$-en-US]` USD, `[$€-x-euro2]` EUR, `[$£-en-GB]` GBP, `[$CA$-en-CA]` CAD). If it returns `_($* #,##0...`, `$#,##0`, `"$"#,##0`, or anything without a `[$...-...]` locale token, Excel will render currency in the user's local symbol. **Halt, re-apply the format for the resolved currency (`_-<CCY_TOKEN>* #,##0.00_-;_-<CCY_TOKEN>* (#,##0.00);_-<CCY_TOKEN>* "-"??_-;_-@_-`) to the full amount range, and re-verify.** Without this readback in your tool history, Gate 6 is not complete.

After the tag-view tab is built and branded, **skip Gate 7 (no Summary
tab in tag-view mode)** and jump straight to Gate 8 with the tag-view
verification + report variant in `tag-view.md`.

### Standard branch (Build mode = both tabs or detail-only)

The rest of Gate 6 below applies.

### Approval-recorded check (run FIRST, before any write tool)

Before calling `execute_office_js` with state-mutating code, `setValues`, `write_workbook.py`, or any other workbook-write tool, look back at your tool history. Find the most recent `AskUserQuestion` you sent. Does its answer correspond to one of the Gate 4 build-approval choices — **"Build both tabs (detail + Summary)"**, **"Build the detail tab only"**, or **"Build a tag-view tab"**? If NO, Gate 4 did not pass — send the Gate 4 approval menu now and wait for the explicit answer.

**Do not interpret upstream answers as approval.** A budget-source response from the batched chooser, a firm-pick answer, a destination-picker answer from Gate 5, or any prior `AskUserQuestion` whose answer is not literally one of the three build-approval choices listed above does NOT clear this gate.

### Gate 6 requires AT LEAST three separate `execute_office_js` calls (excel-addin runtime)

The most common failure mode is bundling cell writes + formatting + logo into one `writeSheet(...)` function — the model writes the cells, returns, and forgets the logo. **Do not combine the cell-write call with the brand block in a single office.js block.**

- **Call 1:** cell values, formulas, formatting, headers, borders. One `execute_office_js`. Return.
- **Call 2:** logo on the detail tab via the verbatim brand block below.
- **Call 3 (verification, LAST in Gate 6):** load shape names on the detail tab, confirm `CartaLogo` exists.

Returning from Call 1 does NOT finish Gate 6. The verification call must appear in your tool history before Gate 7.

Read `references/formatting.md` AND [`references/branding-and-header.md`](references/branding-and-header.md) now and apply both verbatim. `branding-and-header.md` reserves rows 1–4 for the firm/title/source/context band and places the Carta logo at **column E**, rows 1–3 height. `formatting.md` documents the +4 row shift this introduces — all data row numbers downstream are offset accordingly.

### Brand block — verbatim, paste don't paraphrase (DO NOT SKIP)

The detail tab is not "built" until it carries a `CartaLogo` shape sized to the E1:E3 row band. **Paste the block below verbatim** — never substitute a hardcoded pixel height (e.g. `image.height = 48`), never anchor to a single cell (`getRange("E1")`). Both shortcuts produce a logo the user has to resize and reposition by hand. Substitute only `<TAB_NAME>` = `<DETAIL_TAB_NAME>`:

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

**Brand-verification call (REQUIRED, observable).** Run this as a **separate** `execute_office_js` call before proceeding to Gate 7. The check confirms not just that the shape exists but that it was sized to the E1:E3 row band:

```javascript
const sheet = context.workbook.worksheets.getItem("<DETAIL_TAB_NAME>");
sheet.shapes.load("items/name,items/height,items/left");
const rows = sheet.getRange("E1:E3");
rows.load(["height", "left"]);
await context.sync();

const logo = sheet.shapes.items.find(s => s.name === "CartaLogo");
return {
  found:             !!logo,
  heightMatchesBand: logo ? Math.abs(logo.height - rows.height) < 2 : false,
  leftMatchesBand:   logo ? Math.abs(logo.left - rows.left)   < 2 : false,
  shapeHeight:       logo ? logo.height : null,
  rowBandHeight:     rows.height,
};
```

Pass criteria — ALL three must be true: `found`, `heightMatchesBand`, `leftMatchesBand`. If `found` is false, re-run the brand block. If `heightMatchesBand` is false, the block was paraphrased with a pixel literal — delete the shape and re-run the verbatim block above. If `leftMatchesBand` is false, the anchor was a single cell instead of `E1:E3` — same fix. **Do not proceed to Gate 7 until every check passes.** Without this verification in your tool history with all-true checks, Gate 6 branding is not complete.

### Column map (use exactly — do NOT add columns the skill doesn't ask for)


| Col | Period block (rows ≥ 6) | YTD block (mirror) |
|---|---|---|
| **A** | (blank, narrow margin) | — |
| **B** | Account label / section header / subtotal label | — |
| **C** | **5pt spacer** — NO Acct # / GL Code column. Leave empty. | — |
| **D** | Period Actual (raw $) | — |
| **E** | Period Budget | — |
| **F** | (spacer) | — |
| **G** | `=D{row}-E{row}` (Variance) | — |
| **H** | `=IF(E{row}>0, IF(G{row}/E{row}>1000,"1000+%",G{row}/E{row}), "n/a")` | — |
| **I** | (spacer) | — |
| **J** | Period Comments — blank in data rows | — |
| **K** | (spacer) | — |
| **L** | — | (blank) |
| **M** | — | YTD Actual |
| **N** | — | YTD Budget |
| **O** | — | (spacer) |
| **P** | — | `=M{row}-N{row}` |
| **Q** | — | `=IF(N{row}>0, IF(P{row}/N{row}>1000,"1000+%",P{row}/N{row}),"n/a")` |
| **S** | — | YTD Comments — blank |

Header bands: `D4:H4` merged + centered, content = `<PERIOD-LABEL>`. `M4:Q4` merged + centered, content = `YTD <PERIOD-LABEL>`. Both bold, white-on-black.

Row 5 headers: `D5/M5=Actual`, `E5/N5=Budget`, `G5/P5=Variance`, `H5/Q5=%`. `J4=<PERIOD-LABEL> Comments`, `S4=YTD Comments`. Bold, centered.

### Number formats — paste these literal strings, do not paraphrase

Paste these EXACT strings; never rewrite them from memory. Excel number-format strings are easy to mangle.

| Use for | Format string |
|---|---|
| Currency cells (D, E, G, M, N, P + subtotals + totals) | locale token for resolved currency: `[$$-en-US]` USD, `[$€-x-euro2]` EUR, `[$£-en-GB]` GBP, `[$CA$-en-CA]` CAD — pattern: `_-<CCY_TOKEN>* #,##0.00_-;_-<CCY_TOKEN>* (#,##0.00);_-<CCY_TOKEN>* "-"??_-;_-@_-` |
| Variance cells if you want no $ symbol (optional) | `_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)` |
| Percent cells (H, Q) | `0.0%;(0.0%)` (right-aligned) |

**Use the locale-specific token for the resolved currency — never a bare `$` or `"$"`** (resolves to system currency on non-US locales, renders as `R$` on pt-BR, `£` on en-GB). Resolve from fund data: `[$$-en-US]` USD, `[$€-x-euro2]` EUR, `[$£-en-GB]` GBP, `[$CA$-en-CA]` CAD. The negatives section (after the first `;`) MUST keep the parens form `(#,##0.00)` — leading-minus is wrong and will be flagged immediately.

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
2. Build a budget-account set from Gate 4b's `budget_rows` where Period or
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

These all stay constant between the Period and YTD blocks — the same row
is `D` in the Period block and `M` in YTD.

**Done when:** the detail sheet exists with both period blocks, all
sections, all subtotals, total expenses, and net income — all driven by
formulas; Budget and Comments columns blank; the row-reference map is
captured.

After the detail tab is written and read-back has confirmed the row map, call `context_snip` on the large `execute_office_js` write payloads from this gate — Gate 7 only needs the row-reference map you captured, not the full row arrays.

---

## Gate 7: Build and brand the Summary P&L tab

**Skip this gate entirely if `build_mode == "tag-view"` or if Gate 4
chose "Build the detail tab only".** Tag-view writes one tab; detail-only
writes one tab. Both jump straight to Gate 8.

Read `references/summary-tab.md` AND [`references/branding-and-header.md`](references/branding-and-header.md) now and apply both verbatim. The Summary tab follows the same 4-row metadata band as the detail tab — rows 1–4 reserved for firm/title/source/context, and the Carta logo at column E anchored to E1 with height = rows 1–3. If `summary-tab.md`'s legacy layout puts the Executive Summary title on B2 with a larger font, keep it on B2 but trim the font down so it still fits inside the 4-row band (or move auxiliary text to B3/B4).

### Brand block — verbatim, paste don't paraphrase (DO NOT SKIP)

The Summary tab is not "built" until it carries a `CartaLogo` shape sized to the E1:E3 row band. **Paste the brand block from Gate 6** (the verbatim version inline there) — never hardcode `image.height = <number>`, never anchor to a single cell. Substitute `<TAB_NAME>` = `<SUMMARY_TAB_NAME>`.

**Brand-verification call (REQUIRED, observable).** Run this as a **separate** `execute_office_js` call before moving to Gate 8. Same shape-geometry check as the detail tab:

```javascript
const sheet = context.workbook.worksheets.getItem("<SUMMARY_TAB_NAME>");
sheet.shapes.load("items/name,items/height,items/left");
const rows = sheet.getRange("E1:E3");
rows.load(["height", "left"]);
await context.sync();

const logo = sheet.shapes.items.find(s => s.name === "CartaLogo");
return {
  found:             !!logo,
  heightMatchesBand: logo ? Math.abs(logo.height - rows.height) < 2 : false,
  leftMatchesBand:   logo ? Math.abs(logo.left - rows.left)   < 2 : false,
};
```

Pass criteria — `found`, `heightMatchesBand`, `leftMatchesBand` all true. Same fix paths as Gate 6: pixel-literal height → delete shape + re-run verbatim block; single-cell anchor → delete shape + re-run with `getRange("E1:E3")`. If any check fails, re-run before moving to Gate 8.

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
  `='P&L - <FIRM-SHORT> <PERIOD-LABEL>'!D<row>` (single quotes required
  because the tab name contains spaces).
- Empty buckets (Monitoring/Interest, Tax/Other, or Unrealized) get a
  literal `0` so `Investment Income`'s `SUM` still evaluates — and they
  must be surfaced in Gate 8's report.
- Use the same locale-specific currency token here as on the detail tab (`[$$-en-US]` USD, `[$€-x-euro2]` EUR, `[$£-en-GB]` GBP, `[$CA$-en-CA]` CAD) —
  arguably more important on the Summary, which is the tab most likely
  to be screenshotted.

**Done when:** Summary P&L tab exists at position 0, every amount on it
is a formula referencing the detail tab (no hardcoded values), Net Income
reconciles to the detail for both Period and YTD.

---

## Gate 8: Verify and report

**Tag-view branch (if `build_mode == "tag-view"`):** load
[`references/tag-view.md`](references/tag-view.md) §"Gate 8 — verification
+ report (tag-view variant)" and follow that section verbatim. Skip the
rest of this gate — the Summary tie-out, Budget tie-out, and standard
report shape don't apply in tag-view mode.

**Standard branch (both tabs or detail-only):** the rest of Gate 8 applies.

**Gate 8 precondition (DO NOT SKIP).** Before sending the report text below, scan your tool history. Three anchors MUST be present in that order:

1. An `AskUserQuestion` whose answer included `"Approve and write"` (or the Gate 4 "Build it" approval) — approval gate.
2. A `sheet.shapes.addImage(base64)` call for the detail tab — and one for the Summary tab if Gate 4 included Summary — Gate 6/7 branding.
3. The branding-verification `execute_office_js` whose result reported `{found: true, heightMatchesBand: true, leftMatchesBand: true}` for every tab — Gate 6/7 verification. (The verification call now returns a geometry object instead of a shape-name array; matching on `"CartaLogo"` alone is no longer sufficient.)

If any anchor is missing, you have skipped a gate. **Do NOT report tie-out success in the build summary when no `shapes.addImage` call appears in your tool history.** STOP, go back, run the missing gate, then return here.

After writing the detail tab (and the Summary tab, if Gate 4 included it):

1. Read back the `Net Income` row Actual columns on the **detail** (D and
   M). Verify each equals `Revenue subtotal − Total expenses`.
2. If Summary was built: read back the `Net Income` row on the **Summary**
   (C15 for Month, C28 for YTD). Verify each equals the detail's Net
   Income — Period against detail D, YTD against detail M.
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

**In `excel-addin` runtime** — use workbook citations:

> The P&L is ready in `<workbook>.xlsx` — [Summary P&L](<citation:Summary P&L!B1:F30>) and [P&L - <FIRM-SHORT> <PERIOD-LABEL>](<citation:P&L - <FIRM-SHORT> <PERIOD-LABEL>!B1:Q72>).

(**Substitute `<FIRM-SHORT>` and `<PERIOD-LABEL>` with the resolved values before rendering the citation link** — leaving the angle-bracket placeholders in the URL produces a broken link.)

**In `local-file` runtime** — citations don't resolve; give the real path instead,
and name both tabs so the user knows what to open:

> The P&L is ready at `/Users/you/Acme-Financials.xlsx` — two new tabs, `Summary P&L` and `P&L - Acme Jan-Jun 26`. Open it in Excel to review.

State the **absolute** path, not a relative one, and say plainly whether you
created the file or added tabs to an existing one. Never emit a `<citation:…>`
link in this runtime.

>
> **Key tie-outs (Summary ties to detail):** Net Income (Period) + Net Income (YTD) + Investment Income (Period) + Total expenses (Period). Render as the shared 5-column shape: `Line item | Detail | Summary | Difference | Status`, totals bold, `$0` for matches.
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

**Skip the budget tie-out if `build_mode == "tag-view"`** — Gate 4b was
skipped, no Budget data was fetched or written. In tag-view mode, jump
directly to the post-action menu at the end of this gate.

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

| Symptom | Likely cause | What to tell the user |
|---|---|---|
| No Carta MCP connected | Connector not enabled in Claude settings | "Open **Settings → Connectors** in Claude, enable Carta, then ask me again." List any `failed` Carta entries. |
| `contexts:list` returns no firm | Firm name spelling mismatch or not in scope | Echo the name back and ask for the correct spelling. Never near-match silently. |
| `contexts:list` returns multiple firms | Common short name matches several firms | Show the candidates via `AskUserQuestion` and let the user pick. |
| DWH query returns 0 rows | No P&L activity for the period, or books not posted | "No P&L activity found for this firm through `<MMM YYYY>`. Confirm the period or check whether books are posted." |
| DWH query times out | DWH load or unusually large date range | Tell the user the query is slow and offer to retry with the same parameters — never auto-retry. |
| Summary Net Income ≠ Detail Net Income | Formula error or row-reference map stale | Surface as `⚠ Mismatch ($X diff)` in Gate 8's Key tie-outs; offer to rebuild the Summary tab. |
| Revenue accounts in unmatched Summary buckets | Keyword list doesn't cover the account name | Surface empty buckets; ask whether to extend the keyword list or accept zeros. |
| Auth / permission error from MCP | Carta session expired or lacks DWH access | "Reconnect Carta in **Settings → Connectors**." Do not retry automatically. |

---

## Do NOT

- **Don't rename accounts** — `ACCOUNT_NAME` verbatim; section assignment is display-only.
- **Don't fabricate Comments** — J and S stay blank in data rows.
- **Don't hardcode numbers on Summary** — every Actual/Budget cell is a cross-sheet formula.
- **Don't claim success without re-reading both tabs in Gate 8** — tie-out is a read-back.
- **Don't add columns the skill doesn't ask for** (no Acct # / GL Code column — column C is a 5pt spacer).
- **Account label = `account_name` only.** Never `"4160 Management fee income"` or any variation. GL code is internal-only.
- **Do NOT freeze panes** on either tab.
- **Don't skip branding** — Gate 8 must not run until both tabs carry `CartaLogo` on column E. See [`references/branding-and-header.md`](references/branding-and-header.md).
