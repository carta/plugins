---
name: carta-consolidating-financial-reports
model: sonnet
description: >-
  Builds multi-entity consolidating financial reports in Excel: consolidating P&L (income statement), balance sheet, and trial balance — individually or all three together. Resolves the firm, the entities to include, the reporting period, and the target workbook, then builds the chosen report(s). TRIGGER on "consolidating financial reports", "consolidating P&L", "firm-wide income statement", "P&L for all entities", "P&L by tag", "P&L by department", "consolidating balance sheet", "BS by entity", "balance sheet of all entities", "consolidating trial balance", "TB by entity", "all three consolidating reports", "the full financial package". ALSO fires on a generic ask with no report named — "consolidating financials", "firm-wide financial statements" — and shows the report menu. NOT FOR: single-fund/entity financials, ManCo budgets/actuals/pacing/what-if (carta-manco), consolidating cash flow (carta-manco), SOI, co-investors, Form ADV, LP reporting, cap tables, Fund Admin requests (carta-fund-admin-requests).
version: 1.0.0
allowed-tools:
  # MCP connector discovery (Claude for Excel runtime tool)
  - refresh_mcp_connectors
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
  # Sandbox
  - mcp__carta_sandbox__call_tool
  - mcp__carta_sandbox__fetch
  - mcp__carta_sandbox__welcome
  - mcp__carta_sandbox__set_context
  - mcp__carta_sandbox__list_contexts
  # Local / legacy fallback
  - mcp__carta__call_tool
  - mcp__carta__fetch
  - mcp__carta__welcome
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - AskUserQuestion
  - read_skill
  - Read
  # local-file runtime (Cowork / desktop app / Claude Code). In the Claude for
  # Excel runtime the add-in supplies its own workbook tools, which are not
  # declared here — same as the source reports.
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
[PATTERN base v0.1.0]

# Consolidating Financial Reports

Single entry point for the firm-wide, multi-entity financial statements Carta
builds in Excel. Routes to one of three reports, or all three together:

- **Consolidating P&L** — income statement across the entities you pick, with a
  detail tab and an executive Summary tab. Optional tag/department view.
- **Consolidating balance sheet** — Assets / Liabilities / Equity side by side
  by entity, with a Total column.
- **Consolidating trial balance** — a flat consolidated tab plus a by-entity tab.
- **All three together** — builds all three in one pass, resolving the firm,
  entity scope, period, and destination once instead of three times.

Every report reads live from Carta Fund Admin and writes into Excel. The
audience is an accountant working in a workbook, not an engineer.

All three reports are implemented **inline**, from this skill's own
`references/` tree. There is no dispatch to a separate skill — this skill owns
the whole user-facing surface for the consolidating-financials theme.

---

## Route The Request

Use this table to jump straight to the right report. Determining the report
(this table, or the Router Gate's `AskUserQuestion` menu) happens **before**
Gate 0 and Gate 0.5, so the user sees what this skill can do without waiting on
any MCP round-trip. Actually loading the report reference, however, waits until
Gate 0 has resolved the firm, the entity scope, and the period, and Gate 0.5 has
established the surface and the target workbook — never load a report body
before both gates pass.

| If the user needs… | Report | Load |
|---|---|---|
| Income statement across entities — revenue, expenses, net income, executive summary, tag/department view | `pnl` | `read_skill(file_path="references/pnl.md")` |
| Financial position across entities — assets, liabilities, equity | `balance-sheet` | `read_skill(file_path="references/balance-sheet.md")` |
| Account-level balances across entities — flat consolidated plus by-entity | `trial-balance` | `read_skill(file_path="references/trial-balance.md")` |
| All three at once — one setup, three tabs | `all` | Load all three in sequence, see "Build" below |

If the user's prompt matches multiple rows or is ambiguous, fall through to the Router Gate — that section carries the AskUserQuestion disambiguation menu.

---

## Customer Intent Framework

Use this as the semantic layer when the Router Gate's phrase table doesn't
produce an exact match — before falling back to the welcome screen +
`AskUserQuestion` menu.

| What the customer is trying to do | Typical phrasing | Route |
|---|---|---|
| See firm-wide profitability across entities | "how did the firm do last quarter", "our total income and expenses", "firm-wide earnings", "P&L across all our funds" | `pnl` |
| See profitability split by department or cost center | "P&L by department", "income statement by cost center", "spend by project code" | `pnl` (tag-view) |
| See firm-wide financial position across entities | "what's our financial position", "firm-wide assets and liabilities", "balance sheet for the whole firm" | `balance-sheet` |
| See every account balance across entities | "give me every account balance across the firm", "trial balance for all entities" | `trial-balance` |
| Understand where cash moved across entities | "where did our cash go", "sources and uses across the firm" | Out of scope — see STOP rows (`carta-manco`) |
| Get every consolidating statement at once, without picking just one | "give me everything", "the full financial package", "all three reports", "P&L, balance sheet, and trial balance" | `all` |

---

## UX Rules

Audience is an accountant in Excel. Plain English only. Never surface MCP
identifiers, DWH column names (`ACCOUNT_TYPE`, `EFFECTIVE_DATE`), UUIDs, raw
JSON, SQL, or gate labels.

- **Every numbered choice in this skill — including the report menu and the
  entity picker — MUST be presented via `AskUserQuestion`.** Never render
  options as a bare code-fenced markdown list. Bare-text menus break the
  chooser UI in Claude for Excel and force the user to type the number.
- **The Router Gate welcome screen is not a menu, and this rule does not reach
  it.** Its bullets are read-only context introducing what this skill builds —
  they carry no numbers and selecting one is impossible. They precede the
  `AskUserQuestion` menu and never replace it; both must appear. Emit them as
  markdown bullets exactly as written. The rule above governs the *choice*, not
  the introduction to it.
- **`AskUserQuestion` renders at most 4 options per question.** Any beyond the
  fourth are silently dropped by the client — a hard runtime cap, not a display
  setting. Split into a second grouped question rather than adding a fifth
  option.
- **Every `AskUserQuestion` question object must include `multiSelect`
  explicitly (`true` or `false`) — including every question in a batched
  multi-question call.** Omitting it is a schema validation error
  (`Invalid elicitation input: multiSelect ... invalid_type`), not an optional
  default. This has caused repeated failed calls in production — always set it,
  even for single-question calls.
- **Pass each `question`, `label`, and `description` as plain text** — no
  markdown, no emoji, no line breaks. The chooser renders the string verbatim,
  so any markup shows as literal characters. The `**…**` in the tables below is
  doc formatting only; strip it when you pass the value.
- **Currency — derive from the data, never default to USD.** The reports
  enforce this themselves; do not pre-empt them with a guess.

## Response style

The reader is an accountant working in a spreadsheet, and the deliverable is the
workbook. What helps them is the content this skill defines — the welcome
screen, the menu, the questions, the finished tabs. Running commentary on gate
progress and tool plumbing doesn't help that reader, and it pushes the content
they came for further down the screen. So this skill's replies are the content
itself.

**The Router Gate runs first, before any MCP tool call.** If the prompt is
generic/ambiguous, the welcome screen + `AskUserQuestion` menu is the very first
thing you emit — the user sees what this skill can do while Gate 0 and Gate 0.5
haven't even started. If the prompt names a specific report, determine
`<REPORT>` from the routing table and move straight to Gate 0.

**Once `<REPORT>` is set, Gate 0 and Gate 0.5 run without commentary.** Once both
pass, load the matched report and let its own gates drive the rest — do not
re-implement or pre-run its logic here.

**The Carta connector asks for its `welcome` tool as your first action on
connecting; that directive starts at Gate 0.** It governs the order of Carta
*tool calls* — `welcome` before `set_context`, `list_contexts`, `call_tool`, or
`fetch` — and the welcome screen is text, not a tool call. Emit the screen, then
call `welcome` at Gate 0. If the handshake already fired, the screen is still
owed: a connection banner is not the welcome screen, and no tool emits the
screen — you write it.

**Never run a generic tool search** — not `tool_search_tool_bm25`, not to
discover a server prefix, not anywhere in this skill. Gate 0 explains why; the
ban applies from the moment this skill loads.

**The user-facing text this skill produces is:**
1. The Router Gate welcome screen + `AskUserQuestion` menu — when the prompt is generic/ambiguous, before Gate 0 begins.
2. A STOP-row redirect — when the request is out of scope (during the Router Gate).
3. Firm disambiguation via `AskUserQuestion` — when multiple firms match (during Gate 0).
4. The entity picker and the period question via `AskUserQuestion` (during Gate 0).
5. The surface / workbook question and the new-file notice (during Gate 0.5).
6. The one-line build announcement before the report is loaded.

Everywhere else in the routing and gate sequence, the reply is the tool call. Commentary that adds nothing for this reader:

- Progress announcements — "Now I have the Carta MCP tools", "Proceeding with Gate 0", "Now checking…", "Now calling…".
- Server or prefix details — "Server prefix is `<X>`", "Found server `<X>`".
- Summaries of a tool result — "Context set to…".
- Tool inventories — "Only `<X>` surfaced", "this server lacks `list_contexts`". `list_contexts` and `call_tool` load lazily and are often absent from the visible tool list; that is expected and they still work, so there is nothing here worth reporting.
- MCP tool or command names in user-facing text, including inside an error message or a request for help. Describe what you need in plain English ("I can't reach your Carta connector") and name only the connector the user sees in their settings.
- A description of a step in place of the step. When a step calls for text, that text *is* the reply: a sentence about the welcome screen leaves the reader without the screen. Third-person narration ("The user asked for…", "no specific report was named"), narrated deliberation ("Let me check the args"), and announced intent ("I need to show the welcome menu") are all this same failure.
- Internal tool errors — `context_snip` failures, compression notes, and similar plumbing.
---

## Entry mode — fresh session vs. chained skill

Check whether these context variables are already set from an earlier call in
the same session:

- `<SERVER>` — connected Carta MCP server prefix
- `<FIRM_NAME>` and `<FIRM_UUID>` — the resolved firm
- `<ENTITY_SCOPE>` — the entities to include (`all`, or an explicit list)
- `<PERIOD_START>` and `<PERIOD_END>` — the reporting period
- `<RUNTIME>` — `excel-addin` or `local-file`
- `<TARGET_FILE>` — the workbook to write into (`local-file` runtime only)
- `<REPORT>` — previously routed report, if re-entering from a next-step menu.
  One of `pnl`, `balance-sheet`, `trial-balance`, or `all` (all three, built in
  one pass — see "Build" below).

**Step order is always: Router Gate → Gate 0 → Gate 0.5 → Dispatch.** The
Router Gate carries its own user-facing output — the welcome screen and the
menu — and that output lands before the connector's `welcome` call, not after.

**If `<REPORT>` is already set:** skip the Router Gate — the user already picked
or named a report in this session.

**If `<SERVER>`, `<FIRM_NAME>`, and `<FIRM_UUID>` are all set:** skip the firm
resolution in Gate 0 and reuse them. Do not ask "which firm?" when it is
already established from the skill the user just ran.

**If `<RUNTIME>` and `<TARGET_FILE>` are set:** skip Gate 0.5.

---

## Router Gate — Determine the right report

**STOP rows — handle before routing:** check these first. A match here means
the request is out of scope for this skill entirely — redirect and stop; do not
proceed to Gate 0.

**Name the target skill verbatim in every redirect.** Write the identifier out
in full — `carta-investors:carta-explore-data`, `carta-investors:carta-manco` —
rather than paraphrasing it into a description of what it does ("I'll route it
through the data warehouse", "the budgeting tools"). A paraphrase leaves the user
with nothing to act on; the identifier is the one piece of the message they can
actually use. One sentence of plain-English context around it is fine.

| Message signals | Action |
|---|---|
| "single-entity P&L", "single-entity balance sheet", "single-entity trial balance", "one fund's balance sheet", "fund-level balance sheet", "fund account balances as of [date]" | **Stop.** These reports always roll up across entities. Tell the user: "For a single fund or single entity, try `carta-investors:carta-explore-data` — these consolidating reports always aggregate across multiple entities." |
| "consolidating cash flow", "cash flow statement", "sources and uses" | **Stop.** Tell the user: "The consolidating cash flow statement is routed from `carta-investors:carta-manco` — try that." |
| "new budget", "create a budget", "build a budget", "pull our budget", "fetch the budget", "refresh actuals", "pull actuals", "pacing", "what-if", "budget scenario" | **Stop.** Tell the user: "Budgets, actuals, pacing, and what-if scenarios live in `carta-investors:carta-manco`." |
| "SOI", "schedule of investments", "fund holdings", "co-investor", "performance benchmark", "peer comparison" | **Stop.** Tell the user: "Fund holdings, co-investor analysis, and performance benchmarks live in a separate skill set — try `carta-investors:carta-portfolio-analytics-routing`." |
| "Form ADV", "Schedule D", "regulatory AUM", "Form PF", "SEC filing" | **Stop.** Tell the user: "Form ADV and regulatory filing data live in a separate skill set — try `carta-investors:carta-compliance-routing`." |
| "tear sheet", "AGM deck", "LP deck", "K-1", "capital call notice", "distribution notice" | **Stop.** Tell the user: "LP documents and reporting live in a separate skill set — try `carta-investors:carta-lp-reporting-routing`." |
| "cap table", "equity grants", "409A", "option pool" | **Stop.** Tell the user: "Cap table and equity administration live in Carta's cap table tools, not here." |

If none of the rows above match, continue below.

Infer the report from the user's prompt. **Do not ask the user to name a report
by its technical name.** Two paths only:

- **Specific prompt** — matches a row in the table below. Set `<REPORT>`
  immediately, do **not** dispatch yet, and do **not** emit the welcome screen
  or call `AskUserQuestion`. Proceed straight to Gate 0.
- **Generic / ambiguous prompt** — matches no row, or the skill was invoked with
  no specific task. Fall through to the Customer Intent Framework above before
  giving up and showing the welcome screen and `AskUserQuestion` menu.

**Route rows — classify and proceed to Gate 0:**

| Phrase in the prompt | `<REPORT>` |
|---|---|
| "consolidating P&L", "consolidated income statement", "firm-wide income statement", "P&L for all entities", "P&L with executive summary", "P&L by department", "P&L by tag", "income statement by cost center", "P&L by project code" | `pnl` |
| "consolidating balance sheet", "consolidated BS", "BS by entity", "balance sheet of all entities", "balance sheet - consolidating" | `balance-sheet` |
| "consolidating trial balance", "TB by entity", "trial balance of all entities" | `trial-balance` |
| "all three reports", "the full financial package", "P&L, balance sheet, and trial balance", "everything", "build all the consolidating reports" | `all` |

**If ambiguous** (prompt matches no row, or skill was invoked with no specific task), emit a welcome screen first, then ask via `AskUserQuestion`.

**Welcome screen** — output before calling `AskUserQuestion`, and before any
Gate 0 tool call. **It opens the reply; nothing precedes it** — not a sentence
about it, not the connector handshake. Emit the block below exactly as written.
It is already complete as it stands: only the headline and the closing italic
line vary, and both carry their default inline, so emitting it verbatim is
always correct. **Format rule:** put each report on its OWN line as a markdown
bullet (`- `). Do NOT merge them into one paragraph — run together they render
as an unreadable wall of text in Claude for Excel.

> **Ready to build a consolidating financial report.**

Here's what I can build for you:

- **Consolidating P&L** — Income statement across your entities, with a detail tab and a one-page executive summary. Can also break spend down by department or reporting tag.
- **Consolidating balance sheet** — Assets, liabilities, and equity side by side by entity, with a firm-wide total.
- **Consolidating trial balance** — Every account balance, as a flat consolidated tab plus a by-entity tab.
- **All three, back to back** — Builds all three in one pass — I'll resolve the firm, entities, and period once and reuse them for every report.

*I can write straight into an open Excel workbook, or build a standalone `.xlsx` file — whichever you're working with.*

**Headline variant:** swap the first line for *"**Connected to [FIRM] via Carta
Fund Admin.**"* only when a real firm name is already known from a chained call
this session. Never emit a bracketed placeholder.

**The closing italic line tells the user where the workbook comes from before
they pick a report — never drop it.** Swap it for the matching variant when the
surface is already obvious from what is in front of you (Excel add-in tools
present, or a file path/attachment in the prompt — the same signals Gate 0.5
uses, read statically, with no tool call and no question here):

- `excel-addin` → *I'll add new tabs to the workbook you have open — or update them if they're already there.*
- `local-file` → *Attach an existing workbook and I'll update it, or I'll build a new `.xlsx` file and give you the path when it's done.*
- Unclear → keep the neutral line as written above. Gate 0.5 asks explicitly later.

**Never ask the runtime question here** — that belongs to Gate 0.5. This choice
picks the wording of one line, nothing more.

Then ask (one `AskUserQuestion`, 4 options):

> Which consolidating report can I build for you?

| # | Label | Description | `<REPORT>` |
|---|---|---|---|
| 1 | Consolidating P&L | Income statement across your entities, with an executive summary. | `pnl` |
| 2 | Consolidating balance sheet | Assets, liabilities, and equity by entity. | `balance-sheet` |
| 3 | Consolidating trial balance | Every account balance, flat and by entity. | `trial-balance` |
| 4 | All three reports | Build the P&L, balance sheet, and trial balance together — one setup, three tabs. | `all` |

Store `<REPORT>` from the chosen option, then proceed to Gate 0. **Do not
dispatch yet** — dispatch happens only after Gate 0.5.

---

## Gate 0 — Carta MCP environment, firm, entity scope, and period

Scan the tools available in the conversation for any matching `mcp__*__welcome`.
Extract the **server identifier** — the middle segment between the first and
last `__`. Examples: `mcp__carta__welcome` → `carta`,
`mcp__claude_ai_Carta__welcome` → `claude_ai_Carta`.

**If none found:** tell the user no Carta MCP is connected and stop.
**If exactly one found:** call `mcp__<SERVER>__welcome(_instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]})` to verify. This is `<SERVER>`.
**If multiple found:** ask which to use via `AskUserQuestion`. Default to `carta` (production) if present.
**Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every other command is gated and will return a reminder.

### The five Carta tools load lazily — a short tool list is not a missing tool

Derive `<SERVER>` from the server name as shown above. After that, the five
suffixes `welcome`, `set_context`, `list_contexts`, `call_tool`, `fetch` are
exhaustive for every Carta MCP server regardless of environment. Call
`mcp__<SERVER>__<suffix>` directly.

**`list_contexts` and `call_tool` load lazily. They will often NOT appear in
your tool list, and that is expected — they still exist and still work.** Only
`welcome`, `set_context`, and `fetch` are reliably visible up front; a server
may also expose extras like `get_current_user` or `mutate` that this skill does
not use. Never treat a tool's absence from the visible list as evidence it is
unavailable, and never tell the user a Carta tool "doesn't exist" or that the
connector is missing a capability. Just call it.

**Never search for these tools.** Do not run `tool_search_tool_bm25` under any
circumstances — not to discover the prefix, not to find `list_contexts` or
`call_tool`, not for anything. A BM25 search returns only the eagerly-loaded
subset, so it will appear to prove the lazy tools are missing when they are not.
That false negative is the trap: it leads to abandoning the run and telling the
user to re-authenticate a working connector. If you genuinely must search, use
the connector's own `mcp__<SERVER>__search_tools`, never the generic search.

If a call to one of the five genuinely errors, handle it from the error table at
the end of this skill — do not infer from a tool listing.

### Instrumentation — every Carta MCP call carries `_instrumentation_v2`

Pass it on **every** `welcome`, `set_context`, `list_contexts`, `call_tool`, and
`fetch` call, exactly as written in the examples below:

```
_instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]}
```

In Claude Code a hook injects this automatically, but in Claude for Excel there
are no hooks — the call is rejected outright if the skill does not supply it. So
always send it explicitly; sending it twice is harmless.

Add `"model": "<the running model id>"` only if you can actually introspect the
running model. If you cannot, omit the key — never guess a model id, and never
substitute a family name like `claude-opus`.

### Resolve the firm

If the user named a firm → `mcp__<SERVER>__list_contexts(firm_name="<entity>", _instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]})` → disambiguate via `AskUserQuestion` if multiple → `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation_v2={"skills": ["carta-investors:carta-consolidating-financial-reports"]})`.

Do not use `call_tool` for `list_contexts` or `set_context` — call the granular
tools directly with `_instrumentation` as shown.

If the user named no firm, ask for it — but phrase it as the *firm or management
company*, and say that the entity choice comes next, so the user isn't left
thinking the firm answer decides their scope:

> Which firm should I pull this from? I'll ask which funds and entities to
> include right after.

### Resolve the entity scope

**Always run this step.** These are *consolidating* reports — the point is that
they span more than one entity, so the user must be able to say which ones.
Defaulting silently to "everything under the firm" is what makes the output
surprising.

Load [`references/entity-picker.md`](references/entity-picker.md) and follow it.
It lists the entities under the firm, groups them (management company, funds,
SPVs), and builds the picker within the 4-option `AskUserQuestion` cap.

Store `<ENTITY_SCOPE>` as either `all` or the explicit list of entity names and
UUIDs the user chose. Pass it to the report at Dispatch.

**Never phrase this step as "which firm?" when what you mean is "which funds?"**
Customers read "firm" as the whole management company and are then surprised
when a chosen fund's numbers don't appear on their own. Ask about *funds and
entities* explicitly.

### Resolve the reporting period

Collect the period **before** dispatching, so the report doesn't ask again.

- If the user gave an explicit period — a month, a quarter, a year, or a start
  and end date — use it.
- If they didn't, ask via `AskUserQuestion`, and **offer a date range, not just
  a single month.** An accountant asking for a P&L usually means a span of
  time; offering only one month is the most common source of "this isn't what I
  expected" on these reports.

> What period should the report cover?

| # | Label | Description |
|---|---|---|
| 1 | Month to date | The current month through today. |
| 2 | Quarter to date | The current quarter through today. |
| 3 | Year to date | January 1 through today. |
| 4 | A specific start and end date | Tell me the two dates and I'll use that range. |

Store `<PERIOD_START>` and `<PERIOD_END>` as `YYYY-MM-DD`.

The P&L renders a **period block** covering `<PERIOD_START>`→`<PERIOD_END>`
alongside a **year-to-date block** through `<PERIOD_END>`. The balance sheet and
trial balance are as-of statements — they use `<PERIOD_END>` only, and
`<PERIOD_START>` is ignored. Say so in one clause if the user picked a range for
one of those two:

> A balance sheet is a snapshot, so I'll build it as of [PERIOD_END].

**DWH param-name traps** (for the report to apply, not this skill):
`dwh:execute:query` takes `sql:` not `query:`. `dwh:get:table_schema` takes
`table_name:` not `table:`. `format` accepts `"ndjson"` / `"markdown"`, not
`"csv"`.

---

## Gate 0.5 — Surface and target workbook

Every report in this skill writes into an Excel workbook. Where that workbook
comes from depends on the surface, and getting this wrong is the most common
reason a run appears to do nothing at all.

**If `<RUNTIME>` was already inferred before the welcome screen** (Router
Gate), reuse it here without re-detecting. That early pass uses the exact same
signals below, so it never needs a second look — this step only runs the
detection fresh when `<RUNTIME>` is still unset (a specific-prompt request
skipped the welcome screen and never inferred it, or the earlier pass left it
genuinely unclear).

Set `<RUNTIME>`:

- **`excel-addin`** — Claude for Excel. Signals: the user refers to "this
  workbook", "the open spreadsheet", or a tab, with no file path; or Excel
  add-in tools are available in the conversation.
- **`local-file`** — Claude Code, Cowork, or the desktop app. Signals: the user
  supplied a file path (`~/Downloads/Financials.xlsx`), attached a file, or
  asked to "create a new file"; or no Excel add-in tools are available.

If genuinely unclear, ask via `AskUserQuestion`: *"Are you working in Excel
through Claude for Excel, or with a local .xlsx file?"*

### If `<RUNTIME>` is `excel-addin`

The workbook in front of the user is the target. Set `<TARGET_FILE> = null` and
proceed — the report's own destination gate handles the open-workbook cases (no
workbook, empty workbook, workbook with existing tabs).

### If `<RUNTIME>` is `local-file`

Resolve `<TARGET_FILE>`:

1. If the user attached a spreadsheet or named a path, set `<TARGET_FILE>` to
   it. The report adds its tabs to that file.
2. If not, set `<TARGET_FILE> = null` and tell the user, in one sentence, before
   any work starts:

   > No spreadsheet attached, so I'll build this as a new `.xlsx` file and give
   > you the path when it's done. If you'd rather I add these tabs to an
   > existing workbook, attach it or give me the file path.

   Do not stop for an answer — proceed. The user can redirect if they want to.

**Surface guidance — say this at most once, and only when it helps.** These
reports were built for Claude for Excel, where the tabs land directly in the
workbook already open in front of the user. They work in Cowork, the desktop
app, and Claude Code too; the only difference is where the workbook comes from.
If the user seems unsure which surface to use:

> These build fastest in Claude for Excel, where I write straight into your open
> workbook — but I can also produce the file here for you to open in Excel.

Do not repeat this, and do not lead with it when the user already named a report
and a period.

---

## Build — load the report and execute it inline

Both gates have passed.

### `<REPORT>` is `pnl`, `balance-sheet`, or `trial-balance`

Emit exactly one line:

> Building your consolidating **[P&L | balance sheet | trial balance]** for
> **[FIRM_NAME]**.

Then load the matched report and follow it exactly:

| `<REPORT>` | Load |
|---|---|
| `pnl` | `read_skill(file_path="references/pnl.md")` |
| `balance-sheet` | `read_skill(file_path="references/balance-sheet.md")` |
| `trial-balance` | `read_skill(file_path="references/trial-balance.md")` |

**Follow the loaded file verbatim from its own gates. Do not reconstruct its
logic from memory** — each one carries exact SQL, Excel number-format strings,
column maps, and approval gates that must not be paraphrased.

### `<REPORT>` is `all`

Build all three, one after another, into the same target workbook. Gate 0 and
Gate 0.5 already ran exactly once for the whole batch — that single firm,
entity-scope, period, and destination resolution is what "all three" saves
over running each report on its own. Each report still runs its own DWH data
pull; see "Why the data pull isn't shared" below.

Emit exactly one line before the batch starts:

> Building your consolidating P&L, balance sheet, and trial balance for
> **[FIRM_NAME]** — one setup, three tabs.

Then, in this order — P&L, balance sheet, trial balance — emit that report's
own one-line announcement (as in the single-report case above) and load it:

1. `read_skill(file_path="references/pnl.md")`
2. `read_skill(file_path="references/balance-sheet.md")`
3. `read_skill(file_path="references/trial-balance.md")`

Follow each file verbatim from its own gates, exactly as in the single-report
case — including that report's own approval gate before it writes. Do not
batch all three approvals into one prompt; let each report ask separately,
back to back. If one report fails or the user declines its approval gate, say
so in one sentence and continue to the next report rather than aborting the
whole batch.

**Why the data pull isn't shared.** The three reports query different
account-type ranges and different time semantics — the P&L sums two date
windows (period and YTD) over accounts `>= '4000'`, the balance sheet takes a
single cumulative as-of balance over accounts `'1000'`–`'3999'`, and the trial
balance computes a beginning balance plus period debits/credits over every
account. No single query shape serves all three without rewriting every
report's data-pull gate, which is out of scope here. "One setup" refers to the
firm/entity/period/destination resolution shared via Gate 0 and Gate 0.5, not
to the DWH query itself.

**The gates you already ran are already satisfied.** Gate 0 and Gate 0.5 have
set `<SERVER>`, `<FIRM_NAME>`, `<FIRM_UUID>`, `<ENTITY_SCOPE>`,
`<PERIOD_START>`, `<PERIOD_END>`, `<RUNTIME>`, and `<TARGET_FILE>`. Every report
reads these variables under the same names in its own "Entry mode" section and
skips the gates whose inputs are set. Do **not** re-resolve the firm, re-ask the
entity scope, or re-ask the period — the report begins at the first gate whose
inputs are still missing, which is normally its data pull.

The report's own sub-references resolve inside this skill's tree
(`references/pnl/schema.md`, `references/balance-sheet/formatting.md`, and so
on) and its Excel branding asset resolves from this skill's `assets/`. Use those
paths as written in the loaded file — do not rewrite them back to another
skill's directory.

---

## If Something Goes Wrong

Out-of-scope topics are handled proactively by the STOP rows in the Router Gate
— they never reach this table. This table covers issues that surface mid-flow.

| Situation | Response |
|---|---|
| No Carta MCP server found | "I can't see your Carta connector. Open **Settings → Connectors** in Claude, enable Carta, then ask me again." |
| `list_contexts` returns no firm | Echo the name back and ask for the correct spelling. Don't silently near-match. |
| Firm resolves but has only one entity | Say so plainly, and offer to run the single-entity report via `carta-investors:carta-explore-data` instead. A consolidating report over one entity is just that entity's statement. |
| The user asks for two (but not all three) reports at once | Build the first, then offer the second from the post-run menu. Do not run both in one pass. |
| The user asks for all three reports | Route to `<REPORT> = all` — see "Build" above. Builds all three in one pass instead of offering them one at a time. |
| Query times out | Tell the user it's slow and offer to retry — never auto-retry. |
| Auth / permission error from the MCP | Ask the user to reconnect Carta in Settings → Connectors. |
| Connector connected, tool calls fail (`McpAuthError` / "tool not available") | Prefix mismatch — NOT an auth issue. Re-run `refresh_mcp_connectors` and probe the matching prefix's `welcome`. Never tell the user to re-auth without verifying the prefix mismatch first. |
| `list_contexts` or `call_tool` is not in your visible tool list | **Not a failure — they load lazily.** Call the tool anyway. Do not search for it, do not report a connector gap, and do not ask the user to re-authenticate a connector that just answered `welcome`. |
| A Carta MCP call is rejected for missing instrumentation | Re-send the same call with `_instrumentation_v2` as specified in Gate 0. Do not surface this to the user — it is an internal contract, and the retry is silent. |

---

## References

### Report entry points

- `references/pnl.md` — consolidating P&L: detail tab + executive Summary tab, optional tag-view
- `references/balance-sheet.md` — consolidating balance sheet: Assets / Liabilities / Equity by entity
- `references/trial-balance.md` — consolidating trial balance: flat consolidated tab + by-entity tab

`<REPORT> = all` has no reference file of its own — it loads the three files
above in sequence from the "Build" section, reusing the firm/entity/period/
destination resolved once in Gate 0 and Gate 0.5.

### Shared by this skill

- `references/entity-picker.md` — list the entities under a firm, group them, and build the picker within the `AskUserQuestion` option cap
- `references/local-file-output.md` — producing a workbook outside Claude for Excel (runtime gate, destination, Office.js→operations translation, verification readback, path-based closing summary)

### Maintainers only — never loaded at runtime

- `docs/architecture-notes.md` — why this skill is built the way it is: the inline-orchestrator pattern, the mirroring obligation against the standalone report skills, the self-contained-package rule, and the publish cutover. Read it before restructuring the skill or re-mirroring a report body. **Do not load it while serving a user** — it carries no runtime instruction, and `docs/` is stripped from the published plugin.

### P&L sub-references (loaded by `references/pnl.md`)

- `references/pnl/schema.md` — journal-entries column contract, sign conventions, period semantics, entity filtering
- `references/pnl/section-map.md` — keyword table assigning expense accounts to sections
- `references/pnl/formatting.md` — number formats, column widths, row styling
- `references/pnl/branding-and-header.md` — Carta branding, header layout, powered-by asset
- `references/pnl/summary-tab.md` — executive Summary tab layout and cross-sheet formula links
- `references/pnl/budget-fetch.md` — pulling stored budget figures for the Budget columns
- `references/pnl/fill-budget-columns.md` — writing budget figures into the period columns
- `references/pnl/tag-view.md` — Actuals broken down by reporting-tag category

### Balance-sheet sub-references (loaded by `references/balance-sheet.md`)

- `references/balance-sheet/schema.md` — journal-entries column contract and sign conventions
- `references/balance-sheet/formatting.md` — number formats and layout
- `references/balance-sheet/branding-and-header.md` — Carta branding and header layout

`references/trial-balance.md` is self-contained and has no sub-references.

### Assets

- `assets/powered_by_carta.png` and `assets/powered_by_carta.b64.txt` — this skill's own copy of the branding asset, shared by all three report bodies. The base64 sidecar is read package-relative at Excel runtime via `blobs.getText("assets/powered_by_carta.b64.txt")`, so it has to be a real file in this skill, not a path rewrite.
