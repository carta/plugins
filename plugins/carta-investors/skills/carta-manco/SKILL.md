---
name: carta-manco
model: opus
description: 'ManCo (management company) budgeting and reporting for Carta Fund Admin firms; hard-gates on Fund Admin + active ManCo. TRIGGER: build/create/draft a budget, pull/import the Carta budget, add/refresh actuals, interleave Budget/Actual/Variance, sub-account drill-down, pacing/variance analysis, "what did we spend on [X] YTD", "where did we overspend", what-if/scenario modeling (headcount cuts, revenue shocks, new fund raise, expansion hires). ALSO fires on ANY generic management-company ask naming no specific report, and shows the capability menu: "help with our ManCo", "help me with our ManCo financials", "ManCo financials", "management company financials", "ManCo reporting", "not sure what I need". NOT FOR: single-FUND (not ManCo) financials, portfolio valuations, LP reporting, cap tables, loans (carta-investors:carta-loan-dashboard); a NAMED consolidating statement (P&L, BS, TB, cash flow) — use carta-consolidating-pnl/-balance-sheet/-trial-balance or fa-manco:carta-consolidating-cash-flow.'
version: 1.0.0
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
  - AskUserQuestion
  - read_skill
  - Skill
  - Read
  - Write
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/scripts/read_workbook.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/scripts/write_workbook.py *)
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
</IMPORTANT>

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN base v0.1.0]

# Carta Budgeting

Unified ManCo budgeting skill. Routes to one of five capabilities.

**Prerequisites:** a Carta Fund Admin connection + an active management company. Gate 0.75 (below) confirms both before dispatching to any capability.

- [`references/fetch-budget.md`](references/fetch-budget.md) — pull a stored ManCo budget from Carta Fund Admin into Excel.
- [`references/create-budget.md`](references/create-budget.md) — build a new budget workbook from prior-year actuals (or a template, recommendation, tag slice, restructure, or inflation buffer).
- [`references/fetch-actuals.md`](references/fetch-actuals.md) — write/refresh actuals into an existing budget workbook (interleave, separate tab, vendor view, tag view, etc.).
- [`references/budget-analysis.md`](references/budget-analysis.md) — pacing and variance analysis against an existing budget.
- [`references/budget-scenarios.md`](references/budget-scenarios.md) — what-if scenario modeling (headcount cuts, revenue shocks, cost rebalancing, new fund raises, expansion hires).

## Route The Request

Use this table to jump straight to the right reference. Determining the
capability (this table, or the Router Gate's `AskUserQuestion` menu) happens
**before** Gate 0 / Gate 0.5 / Gate 0.75 so the user sees what this skill can
do without waiting on any MCP round-trip. Actually loading the **Load first**
reference (or dispatching to an external consolidating skill), however, still
waits until Gate 0 has resolved `<SERVER>`, Gate 0.5 has detected `<RUNTIME>`,
and Gate 0.75 has confirmed ManCo eligibility — never invoke a downstream
reference or skill before all three gates pass. The "Pair with" file is
loaded only when the capability reference itself delegates to it, not
upfront.

| If the user needs… | Capability | Load first | Pair with (load only when capability delegates) | Minimal first check |
|---|---|---|---|---|
| Pull/fetch/import/sync a stored ManCo budget from Carta | fetch-budget | `references/fetch-budget.md` | `references/fetch-budget-data.md`, `references/cash-balance.md` | Carta MCP connected + firm resolved |
| Build/create/draft a new budget for a future year | create-budget | `references/create-budget.md` | `references/from-prior-actuals.md` (default) or `references/from-template.md` | Prior-year actuals accessible in Carta, or template file path provided |
| Add/refresh actuals into an existing budget workbook | fetch-actuals | `references/fetch-actuals.md` | `references/get-actuals.md` | Existing budget workbook open or path supplied |
| Pacing, variance, "how are we doing", "on track", compare budget vs actuals | budget-analysis | `references/budget-analysis.md` | `references/pacing-overview.md` | Both budget columns and actuals columns present in the workbook |
| What-if scenario: headcount cuts, revenue shocks, new fund raises, expansion hires | budget-scenarios | `references/budget-scenarios.md` | Scenario-specific sub-reference (see Router Gate table) | Budget baseline available in workbook |

If the user's prompt matches multiple rows or is ambiguous, fall through to the Router Gate — that section carries the AskUserQuestion disambiguation menu.

---

## Customer Intent Framework

Use this as the semantic layer when the Router Gate's phrase table doesn't
produce an exact match — before falling back to the welcome screen +
`AskUserQuestion` menu.

| What the customer is trying to do | Typical phrasing | Route |
|---|---|---|
| Get the budget that's already stored in Carta into a workbook | "bring in our budget", "load the ManCo numbers", "I need the budget in front of me" | fetch-budget |
| Stand up a budget that doesn't exist in a workbook yet | "we don't have a budget for next year yet", "start our 2027 plan", "set up the budget from scratch" | create-budget |
| Get real spend data layered onto an existing budget | "fill in what we actually spent", "update this with real numbers", "true up the budget" | fetch-actuals |
| Find out whether spend is on track without saying "pacing" or "variance" | "are we overspending", "how's the year looking so far", "did we blow past budget on legal" | budget-analysis |
| Explore a hypothetical change to the plan | "what happens if we don't hire", "can we afford a new fund raise", "model cutting costs" | budget-scenarios |
| See firm-wide profitability across entities | "how's the ManCo doing overall", "our total income and expenses", "firm-wide earnings" | consolidating-pnl (external) |
| See firm-wide assets/liabilities across entities | "what's the ManCo's financial position", "firm-wide assets and liabilities" | consolidating-balance-sheet (external) |
| See account-level detail across entities | "give me every account balance across the firm" | consolidating-trial-balance (external) |
| Understand where cash moved across entities | "where did our cash go", "sources and uses across the firm" | consolidating-cash-flow (external) |

---

## UX Rules

Audience is an accountant in Excel, so write in plain English and in their
vocabulary. Internal identifiers mean nothing to this reader and read as noise:
MCP tool names, DWH column names (`ACCOUNT_TYPE`, `EFFECTIVE_DATE`), UUIDs, raw
JSON, SQL, and the gate labels used in these instructions all stay out of the
reply. Say "your firm's Carta connection", not the connector's tool name.

- **Currency formatting:** positive `$X,XXX`, negatives `($X,XXX)`, totals bolded — use the resolved currency symbol, never a bare `$`. Derive from the data, never default to USD.
- **Difference values are absolute** — e.g. `$0` for a match, `$2,000` for a gap.
- **Status vocabulary:** ✅ Match | ⚠ Mismatch ($X diff) | ❌ Missing in Carta | ❌ Missing in Client Doc.
- **Closing summary link** is a workbook citation (`<citation:Sheet!Range>`) in Claude for Excel mode, and a `file://` path in Claude Code / Cowork mode. Never both.
- **Every numbered choice in this skill — including all next-step menus — MUST be presented via `AskUserQuestion`.** Never render options as a bare code-fenced markdown list. Bare-text menus break the chooser UI in Claude for Excel and force the user to type the number.
- **The Router Gate welcome screen is not a menu, and the rule above does not reach it.** Its bullets are read-only context introducing what this skill can do — they carry no numbers and selecting one is impossible. They precede the `AskUserQuestion` menu and never replace it; both must appear. Emit them as markdown bullets exactly as written. The rule above governs the *choice*, not the introduction to it.

## Response style

The reader is an accountant working in a spreadsheet, and the deliverable is the
workbook. What helps them is the content this skill defines — the capability
menu, the questions, the finished tabs. Running commentary on gate progress and
tool plumbing doesn't help that reader, and it pushes the content they came for
further down the screen. So this skill's replies are the content itself.

**The Router Gate runs first, before any MCP tool call.** If the prompt is
generic/ambiguous, the welcome screen + `AskUserQuestion` menu is the very
first thing you emit — the user sees what this skill can do while Gate 0,
Gate 0.5, and Gate 0.75 haven't even started. If the prompt names a specific
capability, determine `<CAPABILITY>` from the routing table and move straight to
Gate 0.

**Once `<CAPABILITY>` is set, Gate 0, Gate 0.5, and Gate 0.75 run without
commentary.** Once eligibility is confirmed, dispatch and let the capability's
own gates (from its reference file, or the external skill it hands off to) drive
the rest — do not re-implement or pre-run its logic here.

**The user-facing text this skill produces is:**
1. The Router Gate welcome screen + `AskUserQuestion` menu — when the prompt is generic/ambiguous, before Gate 0 begins.
2. Firm disambiguation via `AskUserQuestion` — when multiple firms match (during Gate 0).
3. The Gate 0.5 runtime question via `AskUserQuestion` — when the runtime is genuinely ambiguous.
4. The eligibility messages (No ManCo, No Fund Admin, Try again) — word for word as written, with nothing added around them (during Gate 0.75).

Everywhere else in the routing and gate sequence, the reply is the tool call. Commentary that adds nothing for this reader:

- Progress announcements — "Now I have the Carta MCP tools", "Proceeding with Gate 0", "Now checking…", "Now calling…".
- Server or prefix details — "Server prefix is `<X>`", "Found server `<X>`".
- Summaries of a tool result — "Context set to…", "Eligibility check complete…".
- Tool inventories — "Only `<X>` surfaced", "this server lacks `list_contexts`". `list_contexts` and `call_tool` load lazily and are often absent from the visible tool list; that is expected and they still work, so there is nothing here worth reporting.
- A description of a step in place of the step. When a step calls for text, that text *is* the reply: a sentence about the welcome screen leaves the reader without the screen.
- Internal tool errors — `context_snip` failures, compression notes, and similar plumbing.

---

## Entry mode — fresh session vs. chained skill

Check whether these context variables are already set from an earlier
budgeting skill call in the same session:

- `<SERVER>` — connected Carta MCP server prefix
- `<FIRM_UUID>` — the resolved firm (set in Gate 0, distinct from the ManCo entity below — some commands, e.g. `fa:get:cash-balance`, need both at once)
- `<ENTITY_NAME>`, `<ENTITY_UUID>`, and `<ENTITY_ID>` — the resolved ManCo entity (`<ENTITY_ID>` is its integer Fund PK, distinct from `<ENTITY_UUID>` — see `entity-picker.md`)
- `<RUNTIME>` — `excel-addin` or `local-file`
- `<HAS_MANCO>` — whether `fa:get:manco_eligibility` confirmed active Fund Admin + an active ManCo this session
- `<CAPABILITY>` — previously routed capability (if re-entering from a next-step menu)

**Step order is always: Router Gate → Gate 0 → Gate 0.5 → Gate 0.75 → dispatch.**

**If `<CAPABILITY>` is already set:** skip the Router Gate entirely — the user
already picked (or named) a capability in this session. Go straight to the
Gate 0 check below.

**If `<CAPABILITY>` is not set:** run the Router Gate first — before any MCP
tool call — to determine it (specific-prompt match, or the welcome screen +
`AskUserQuestion` menu for a generic/ambiguous prompt).

**Once `<CAPABILITY>` is known:** if `<SERVER>`, `<ENTITY_NAME>`,
`<ENTITY_UUID>`, and `<RUNTIME>` are all already set, skip Gate 0 and Gate 0.5
and proceed directly to Gate 0.75. Otherwise run Gate 0 and Gate 0.5 first.

**Gate 0.75 always runs** — `fa:get:manco_eligibility` is never skipped, even when `<HAS_MANCO>` is already known. The call is fast and cached, and its `_instrumentation` records the skill invocation.

**If `<HAS_MANCO>` is true after Gate 0.75:** dispatch to `<CAPABILITY>` directly — the Router Gate already ran, so there is no menu left to show.

---

## Router Gate — Determine the right capability

Ambiguous requests use a two-step menu (category, then drill-down) instead of one flat list — `AskUserQuestion` caps at 4 options in Claude for Excel, and the 9 capabilities/dispatches don't fit in one question.

**STOP rows — handle before routing:** check these first, before attempting
any capability match below. A match here means the request is out of scope
for this skill entirely — redirect and stop; do not proceed to Gate 0.

| Message signals | Action |
|---|---|
| "loan dashboard", "loan portfolio", "draw balance", "loan overview" | **Stop.** Loans are a separate domain. Tell the user: "Loans live in a separate skill — try `carta-investors:carta-loan-dashboard` or `carta-investors:carta-loan-overview` directly." |
| "Fund Forecasting", "Tactyc", "forecasting metrics" | **Stop.** Fund Forecasting is a separate domain from Fund Admin ManCo budgeting. Tell the user: "Fund Forecasting / Tactyc metrics are handled by a different skill — try `carta-investors:carta-fund-forecasting`." |
| "single-fund financials", "this fund's financials", "portfolio valuations", "fund marks", "portfolio company valuation" | **Stop.** Single-fund and portfolio-level financials/valuations are out of scope for ManCo budgeting. Tell the user: "That's single-fund/portfolio territory, not the ManCo — try Carta's portfolio valuations tools." |
| "LP reporting", "LP documents", "K-1", "capital call notice", "distribution notice", "AGM deck", "tear sheet" | **Stop.** LP reporting is a separate domain. Tell the user: "LP documents and reporting live in a separate skill set — try `carta-investors:carta-lp-reporting-routing`." |
| "cap table", "equity grants", "409A", "option pool" | **Stop.** Cap table administration is out of scope for ManCo budgeting. Tell the user: "Cap table and equity administration live in Carta's cap table tools, not here." |

If none of the rows above match, continue below to determine the capability.

Infer the capability from the user's prompt. **Do not ask the user to name a
capability by its technical name.** Two paths only:

- **Specific prompt** — it matches a row in the table below. Set
  `<CAPABILITY>` to that reference/skill immediately — do **not** dispatch
  yet, and do **not** emit the welcome screen or call `AskUserQuestion` — the
  user already named the task. Proceed straight to Gate 0.
- **Generic / ambiguous prompt** — it matches no row, or the skill was invoked
  with no specific task (e.g. "help with our ManCo", "ManCo financials").
  Fall through to the Customer Intent Framework below before giving up and
  showing the welcome screen and `AskUserQuestion` menu.

**Route rows — classify and proceed to Gate 0:**

| Phrase in the prompt | Capability | Reference to load |
|---|---|---|
| "pull / fetch / import / sync Carta budget", "bring Carta's budget into this sheet", "pull the Carta budget for [ManCo]", "add / update / refresh cash balance", "add / update the beginning cash balance" | fetch-budget | `read_skill(file_path="references/fetch-budget.md")` |
| "build / create / draft / generate a budget for [year]", "build a budget for next year", "from last year's actuals", "from prior actuals", "add a 5% inflation buffer", "group / categorize budget line items" | create-budget | `read_skill(file_path="references/create-budget.md")` |
| "pull / fetch / get / refresh / sync actuals for [firm/ManCo]", "what did we spend on [category] YTD", "interleave Budget/Actual/Variance", "actuals by department/tag/vendor/sub-account", "add next month column", "extend budget through [month]" | fetch-actuals | `read_skill(file_path="references/fetch-actuals.md")` |
| "how are we doing", "pacing", "on track", "how are we pacing against budget", "variance analysis", "compare budget vs actuals", "budget vs actuals for [firm]", "are we over on [X]", "where did we overspend or underspend", "drill into [X]" | budget-analysis | `read_skill(file_path="references/budget-analysis.md")` |
| "what if we cut headcount", "model a revenue shortfall", "preserve $X cash", "raise a new fund", "model hiring N FTEs", "what-if", "scenario", "build me a scenario model" | budget-scenarios | `read_skill(file_path="references/budget-scenarios.md")` |
| "consolidating P&L", "consolidated income statement", "ManCo P&L", "pull our ManCo P&L", "consolidating P&L across all entities" | consolidating-pnl (external) | `Skill("carta-investors:carta-consolidating-pnl")` |
| "consolidating balance sheet", "consolidated BS" | consolidating-balance-sheet (external) | `Skill("carta-investors:carta-consolidating-balance-sheet")` |
| "consolidating trial balance", "show me the trial balance", "TB" | consolidating-trial-balance (external) | `Skill("carta-investors:carta-consolidating-trial-balance")` |
| "consolidating cash flow", "cash flow statement for the ManCo" | consolidating-cash-flow (external) | `Skill("fa-manco:carta-consolidating-cash-flow")` |

**If ambiguous** (prompt matches no row, or skill was invoked with no specific task), emit a welcome screen first, then ask via `AskUserQuestion`.

**Welcome screen** — output before calling `AskUserQuestion`, and before any
Gate 0 tool call. It opens the reply; nothing precedes it. Emit the block below
exactly as written. It is already complete as it stands: only the headline
varies, and it carries its default inline, so emitting it verbatim is always
correct. **Format rule:** put each
capability on its OWN line as a markdown bullet (`- `). Do NOT merge them into
one paragraph — a blockquote with the items run together renders as an
unreadable wall of text in Claude for Excel.

> **Ready to help with your ManCo budget.**

Here's what I can help you with:

- **Fetch budget from Carta** — Pull the ManCo budget stored in Carta into this workbook.
- **Build a new budget** — Draft next year's budget from prior-year actuals, a template, recommendations, or a tag/department slice.
- **Add / refresh actuals** — Write YTD actuals into an existing budget (interleaved columns, separate tab, vendor view, tag view).
- **Analyze pacing & variance** — Compare actuals to budget, assess on-track status, drill into over/under lines.
- **Model a what-if scenario** — Simulate headcount cuts, revenue shocks, new fund raises, or expansion hires.
- **Consolidating financials** — Firm-wide P&L, balance sheet, trial balance, or cash flow.

**Headline variant:** swap the first line for *"**Connected to [FIRM] via Carta
Fund Admin.**"* only when a real firm name is already known from a chained call
this session. Never emit a bracketed placeholder.

**Format rule for `AskUserQuestion`:** pass each `question`, `label`, and `description` as **plain text** — no markdown (`**bold**`, backticks), no emoji, no line breaks. The chooser renders the string verbatim, so any markup shows as literal characters. The `**…**` in the tables below is doc formatting only; strip it when you pass the value.

**`AskUserQuestion` renders at most 4 options per question** (any beyond the fourth are silently dropped by the client — a hard runtime cap in Claude for Excel, not a display setting). The nine capabilities therefore CANNOT be listed in one question. Use a **two-step grouped menu** — a category question, then a drill-down only for the categories that map to more than one capability.

**Step 1 — category** (one `AskUserQuestion`, 4 options):

> What would you like to do with your budget?

| # | Label | Description | Routes to |
|---|---|---|---|
| 1 | **Work with the budget itself** | Pull the ManCo budget from Carta, or build a new one. | drill-down A |
| 2 | **Actuals & variance** | Write/refresh actuals into a budget, or analyze pacing vs budget. | drill-down B |
| 3 | **Model a what-if scenario** | Headcount cuts, revenue shocks, new fund raises, or expansion hires. | `budget-scenarios` (no drill-down) |
| 4 | **Consolidating financials** | Firm-wide P&L, balance sheet, trial balance, or cash flow across all entities. | drill-down C |

**Step 2 — drill-down** (a second `AskUserQuestion`, ≤4 options; skip entirely for category 3):

- **Drill-down A — budget itself:**
  | # | Label | `<CAPABILITY>` | Load |
  |---|---|---|---|
  | 1 | **Fetch the ManCo budget from Carta** | fetch-budget | `read_skill(file_path="references/fetch-budget.md")` |
  | 2 | **Build a new budget from prior-year actuals** | create-budget | `read_skill(file_path="references/create-budget.md")` |
- **Drill-down B — actuals & variance:**
  | # | Label | `<CAPABILITY>` | Load |
  |---|---|---|---|
  | 1 | **Add / refresh actuals on an existing budget** | fetch-actuals | `read_skill(file_path="references/fetch-actuals.md")` |
  | 2 | **Analyze pacing and variance (budget vs actuals)** | budget-analysis | `read_skill(file_path="references/budget-analysis.md")` |
- **Drill-down C — consolidating financials:**
  | # | Label | Dispatch to |
  |---|---|---|
  | 1 | **Consolidating P&L** | `Skill("carta-investors:carta-consolidating-pnl")` |
  | 2 | **Consolidating balance sheet** | `Skill("carta-investors:carta-consolidating-balance-sheet")` |
  | 3 | **Consolidating trial balance** | `Skill("carta-investors:carta-consolidating-trial-balance")` |
  | 4 | **Consolidating cash flow** | `Skill("fa-manco:carta-consolidating-cash-flow")` |

> **Never add a fifth option to any single `AskUserQuestion` call** — split into
> another grouped question instead. A flat 5+ option menu loses every option past
> the fourth.

Store `<CAPABILITY>` from the final chosen option, then proceed to Gate 0 (or
straight to Gate 0.5 / Gate 0.75 if `<SERVER>`/`<ENTITY_NAME>`/`<ENTITY_UUID>`/
`<RUNTIME>` are already resolved from a prior chained call). **Do not load the
reference or invoke the external skill yet** — dispatch only happens after
Gate 0.75 confirms eligibility (see the Dispatch step at the end of Gate
0.75).

---

## Gate 0 — Carta MCP environment + resolve firm

Scan the tools available in the conversation for any matching `mcp__*__welcome`. Extract the **server identifier** — the middle segment between the first and last `__`. Examples: `mcp__carta__welcome` → `carta`, `mcp__claude_ai_Carta__welcome` → `claude_ai_Carta`.

**If none found:** tell the user no Carta MCP is connected and stop.
**If exactly one found:** call `mcp__<SERVER>__welcome(_instrumentation={"plugin": "carta-investors", "skills": ["carta-manco"]})` to verify. This is `<SERVER>`.
**If multiple found:** ask the user which to use via `AskUserQuestion`. Default to `carta` (production) if present.
**Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every other command is gated and will return a reminder.

**Resolve firm:** if user named one → `mcp__<SERVER>__list_contexts(firm_name="<entity>", _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco"]})` → disambiguate via `AskUserQuestion` if multiple → `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco"]})`. Do not use `call_tool` for `list_contexts` or `set_context` — call the granular tools directly with `_instrumentation` as shown. **Store the resolved value as `<FIRM_UUID>` for the rest of the session** — it's the firm, not the ManCo entity `entity-picker.md` resolves later; downstream commands that need both (e.g. `fa:get:cash-balance`) require them kept distinct.

**DWH param-name traps:** `dwh:execute:query` takes `sql:` not `query:`. `dwh:get:table_schema` takes `table_name:` not `table:`. `format` accepts `"ndjson"` / `"markdown"`, not `"csv"`.

**DWH result formatting:** queries > 50 rows: request `format: "ndjson"`, bucket into a blob. Don't paste large results — triggers `context_snip`. Use `"markdown"` only for ≤50-row previews.

If no firm was named, defer to the capability's own parameter gate.

**Never BM25-search for Carta MCP tools at any point in this skill.** Derive `<SERVER>` from the server name as shown in step 2. After that, the five suffixes `welcome`, `set_context`, `list_contexts`, `call_tool`, `fetch` are exhaustive for every Carta MCP server regardless of environment. Call `mcp__<SERVER>__<suffix>` directly — these tools exist on every Carta server; you do not need to verify their existence before calling them. Do not run `tool_search_tool_bm25` under any circumstances — not to discover the prefix, not to find `fetch`, not for anything.

---

## Gate 0.5 — Detect runtime

Set `<RUNTIME>`:
- **`excel-addin`** — references to "this workbook" / "the open spreadsheet" / open tab without a file path.
- **`local-file`** — user supplied a file path (`~/Downloads/Budget.xlsx`) or asked to "create a new file" / "write to disk".
- If unclear, ask via `AskUserQuestion`: *"Are you working in Excel via Claude for Excel, or with a local .xlsx file (Claude Code / Cowork)?"*

---

## Gate 0.75 — ManCo eligibility (HARD GATE)

> **STOP. This is a hard gate.** ManCo budgeting and consolidating-financials capabilities require an active Carta Fund Admin subscription AND an active management company. Verify here; do not route, load a reference file, or invoke any external skill until eligibility is confirmed.

Runs once per session after the firm is resolved (Gate 0). Call the eligibility pre-check:

```
mcp__<SERVER>__fetch(command="fa:get:manco_eligibility", _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco"]})
```

This returns `{available, has_active_manco, has_fund_admin, fa_product_codes}` — a fast, cached pre-check; it replaces listing entities and inferring a ManCo from an `entity_types` filter.

| `available` | `has_fund_admin` | `has_active_manco` | Action |
|---|---|---|---|
| `false` | — | — | Enrichment not yet synced or a transient DWH outage — **not** a denial. Surface the **Try again** message below and STOP. |
| `true` | `false` | — | Surface the **No Fund Admin** message below and STOP. |
| `true` | `true` | `false` | Set `<HAS_MANCO> = false`. Surface the **No ManCo** message below and STOP. |
| `true` | `true` | `true` | Set `<HAS_MANCO> = true`. Proceed to Dispatch below. |
| Call errors / times out | | | Do NOT auto-retry. Surface the generic connection error from the shared Error-handling table and STOP. |

### Hard-gate discipline (non-negotiable)

A `false` gating result is FINAL. You get **at most one** `fa:get:manco_eligibility` probe per session. After it returns a denial, you MUST stop. Do NOT:
- re-run `fa:get:manco_eligibility` hoping the cached result changes within the same session,
- fall back to `fa:list:entities` or a DWH query to "look for a ManCo another way,"
- load a budgeting reference file or invoke an external skill "to see if it works anyway,"
- re-call `welcome` / `set_context` to re-authenticate — a fresh token does not grant a product the firm hasn't bought.

### No ManCo message (surface verbatim, no preamble)

Copy-paste the exact text below word for word — every sentence. Do not drop, reorder, or rephrase any part of it. Do not add anything before or after it.

> I don't see Management Company Administration as part of your Carta plan. That's built for firm-level operations: firm-level financial position, expense allocations across entities, and managing your operating budget.
>
> Reach out to your account team or [request a demo →](https://carta.com/demo/fund-admin/?&utm_medium=product&utm_source=claude&utm_campaign=manco-plugin-inq-ww-q3-26) to get access. I can help you pull fund-level performance, LP reporting, or capital activity in the meantime.

### No Fund Admin message (surface verbatim)

> I can't find a Carta Fund Admin firm on your account, and these ManCo features run on Fund Admin data. If your firm uses Carta Fund Admin, reconnect Carta in **Settings → Connectors**; otherwise reach out to your Carta account manager to get Fund Admin set up.

### Try again message (surface verbatim)

> I'm still syncing your account details — this can take a moment for new or recently updated accounts. Please try again shortly.

After surfacing any of these messages, do not dispatch to `<CAPABILITY>` — the
Router Gate's choice is discarded along with the session.

### Dispatch

Once `<HAS_MANCO>` is `true`, dispatch to `<CAPABILITY>`:

- **Budgeting capabilities** (`fetch-budget`, `create-budget`, `fetch-actuals`, `budget-analysis`, `budget-scenarios`): re-fire the telemetry beacon (see **Per-capability telemetry** below), then call `read_skill` for the matched reference file and follow it exactly from its Gate 1. Do not reconstruct its gates from memory.
- **Consolidating capabilities** (`consolidating-pnl`, `-balance-sheet`, `-trial-balance`, `-cash-flow`): invoke the external skill via the `Skill` tool shown in the routing table. Pass the original user message and the resolved firm context so the downstream skill can skip its own firm resolution. Do not re-implement consolidating logic here.

#### Per-capability telemetry (budgeting capabilities only, set before loading the reference)

For **budgeting capabilities**, **re-fire the telemetry beacon** so this capability's MCP calls attribute correctly. Every budgeting reference's `_instrumentation` uses `skills: ["carta-manco", "<CAPABILITY>"]` — the capability name itself (`fetch-budget`, `create-budget`, `fetch-actuals`, `budget-analysis`, or `budget-scenarios`), not a separate skill identifier.

```
mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>, _instrumentation={"plugin": "carta-investors", "skills": ["carta-manco", "<CAPABILITY>"]})
```

(Consolidating capabilities skip this — the external skill they dispatch to fires its own per-skill instrumentation.)

---

## If Something Goes Wrong (reactive, in-flow issues)

Out-of-scope topics (loans, Fund Forecasting, single-fund financials, LP
reporting, cap tables) are handled proactively by the STOP rows in the Router
Gate above — they never reach this table. This table covers issues that only
surface mid-flow, once a capability is already running.

| Situation | Response |
|---|---|
| User wants pacing AND to build the budget first | Route to `create-budget` first; `budget-analysis` follows once the budget exists. |
| `fetch-budget` returns no budget rows | ManCo was already confirmed in Gate 0.75, so this means no budget is loaded into Carta for that year yet. Offer to build one with `create-budget`. |
| `fetch-actuals` / `budget-analysis` returns zero actuals rows | ManCo confirmed in Gate 0.75 — so no activity posted for that period. Suggest a different date range. |

---

## Shared hard rules (apply across all capabilities)

- **Currency — derive from the data, never default to USD.** Resolve the workbook's presentation currency before writing; if it can't be resolved, ask the user. State the resolved currency in cell A4: `Amounts in <resolved_currency>`.
- **Currency format (locale-specific token):** USD `[$$-en-US]#,##0.00_);([$$-en-US]#,##0.00);"-"` · EUR `[$€-x-euro2]#,##0.00_);([$€-x-euro2]#,##0.00);"-"` · GBP `[$£-en-GB]#,##0.00_);([$£-en-GB]#,##0.00);"-"` · CAD `[$CA$-en-CA]#,##0.00_);([$CA$-en-CA]#,##0.00);"-"`. Never a bare `$` or `_($*` — Excel substitutes the system symbol.
- **Do not freeze panes.** Do not write a Provenance tab.
- **Two-row header for month-bucketed tables.** Row N = merged month label. Row N+1 = sub-headers spelled out in full. Never abbreviate (`B`/`A`/`V`). Never write both into the same row — subsequent merges destroy sub-headers.
- **Month-label date-serial trap:** apply `numberFormat = [["@"]]` to header ranges before writing period labels — otherwise Excel coerces "Jan 2026" → date serial.
- `range.merge(true)` discards trailing cell values. Insert a new row first.
- **Border syntax (Office.js):** `style = "Continuous"`, then `weight = "Thin"`. Never `style: "Thin"`.
- **Branding standards:** follow [`references/branding-and-header.md`](references/branding-and-header.md) for every tab. Asset access via `blobs.getText("assets/powered_by_carta.b64.txt")` in excel-addin mode.
- **No workbook-write tool runs before the capability's approval gate returns explicit "Approve and write" / "Approve and apply" / "Approve and refresh".** Each capability defines its own approval gate — respect it.
- Never auto-retry a failed query. Always surface the failure and let the user decide.

---

## Error handling (shared)

| Symptom | What to tell the user |
|---|---|
| No Carta MCP server found | "I can't see your Carta connector. Open **Settings → Connectors** in Claude, enable Carta, then ask me again." |
| `contexts:list` returns no firm | Echo the name and ask for correct spelling. Don't silently near-match. |
| Query times out | Tell the user it's slow and offer to retry — never auto-retry. |
| Auth / permission error from the MCP | Ask the user to reconnect Carta in Settings → Connectors. |
| Connector connected, tool calls fail (`McpAuthError` / "tool not available") | Prefix mismatch — NOT an auth issue. Re-run `refresh_mcp_connectors`, probe the matching prefix's `welcome`. Never tell the user to re-auth without verifying the prefix mismatch first. |

---

## Schema discovery

The skill queries the Carta DWH journal-entries table. Look up column names via the Carta MCP DWH schema command at Gate 0 if needed. Don't embed column listings inline — the DWH contract can drift.

---

## References

### Capability entry points
- `references/fetch-budget.md` — pull a stored ManCo budget from Carta Fund Admin into Excel
- `references/create-budget.md` — build a new budget workbook from prior-year actuals, a template, a recommendation, a tag slice, a restructure, or an inflation buffer
- `references/fetch-actuals.md` — write or refresh actuals into an existing budget workbook (interleaved, separate tab, vendor view, tag view, etc.)
- `references/budget-analysis.md` — pacing and variance analysis against an existing budget
- `references/budget-scenarios.md` — what-if scenario modeling (headcount cuts, revenue shocks, cost rebalancing, new fund raises, expansion hires)

### Data fetching
- `references/fetch-budget-data.md` — DWH query patterns for pulling stored budget figures
- `references/cash-balance.md` — GL-based bank/cash balance fetch (`fa:get:cash-balance`), used by `fetch-budget`'s Beginning cash balance row and every budget-scenario reference's cash-impact summary
- `references/get-actuals.md` — DWH query patterns for pulling journal-entry actuals
- `references/entity-picker.md` — firm/entity resolution and picker UX

### Create-budget sub-references
- `references/from-prior-actuals.md` — build baseline from last year's Carta actuals (default path)
- `references/from-template.md` — build from a user-supplied Excel template
- `references/from-recommendation.md` — build from a Carta-generated recommendation
- `references/slice-by-tag.md` — scope budget to a specific department/tag
- `references/budget-by-subaccount.md` — build a budget with sub-account rows nested under their parent account, for accounts that have sub-account activity
- `references/reorganize-categories.md` — restructure COA groupings before budgeting
- `references/inflation-buffer.md` — apply a percentage uplift across line items
- `references/fill-budget-columns.md` — write budget figures into month columns

### Fetch-actuals sub-references
- `references/add-actuals-columns.md` — interleave Budget / Actual / Variance columns in-place
- `references/add-actuals-tab.md` — write actuals to a separate tab
- `references/add-period.md` — extend the workbook with a new period column
- `references/vendor-actuals.md` — add a vendor-level breakdown view
- `references/vendor-view.md` — write a standalone vendor-only worksheet
- `references/vendor-only-view.md` — vendor view without budget columns
- `references/inline-vendor.md` — inline vendor detail beneath line items
- `references/tag-view.md` — actuals bucketed by department/tag
- `references/sub-account-view.md` — full chart-of-accounts drill-down, sub-accounts nested under their one parent GL account (not just P&L)
- `references/refresh-existing.md` — refresh already-written actuals figures

### Budget-analysis sub-references
- `references/pacing-overview.md` — YTD pacing summary and on-track logic
- `references/drill-down-line.md` — drill into a single line item for transaction detail

### Budget-scenarios sub-references
- `references/headcount-reduction.md` — model a headcount cut
- `references/revenue-shock.md` — model a revenue shortfall
- `references/cost-rebalance.md` — redistribute cost targets across categories
- `references/new-fund-raise.md` — model incremental costs of a new fund raise
- `references/expansion-hire.md` — model adding N FTEs

### Shared presentation
- `references/branding-and-header.md` — Carta branding standards, header layout, and powered-by-Carta asset

---

## Architecture Notes

### Orchestrator pattern

This skill is a hybrid, unlike a uniform mirror-only or dispatch-only router:
the 5 budgeting capabilities (`fetch-budget`, `create-budget`, `fetch-actuals`,
`budget-analysis`, `budget-scenarios`) are implemented **inline** via
`read_skill(file_path="references/<capability>.md")` — this skill is their
sole implementation, there is no separate standalone skill for any of them.
The 4 consolidating-financials capabilities are **external dispatches** via the
`Skill()` tool to standalone `carta-investors`/`fa-manco` skills that own their
own gates end to end.

This skill is the sole, published implementation of all 5 budgeting
capabilities — no separate leaf skill exists for any of them, and no sibling
skill to keep in sync. References stay self-contained for this reason: each
capability's full logic lives in its own reference file here rather than
split across skills that could drift apart from each other.

### Consolidating-financials routing (menu-only, not a top-level trigger)

This skill's own description does not claim "consolidating P&L / balance
sheet / trial balance / cash flow" as trigger phrases, even though the
Router Gate below still dispatches to those 4 capabilities. `carta-
consolidating-pnl` and `carta-consolidating-balance-sheet` independently
claim those same phrases in their own descriptions — if this skill's
description claimed them too, the top-level picker would face a genuine
ambiguity between two skills for the same utterance. A named consolidating
ask (e.g. "show consolidating P&L for our firm") therefore reaches the
standalone skill directly, without this skill ever being selected.

The Router Gate's Route rows and the welcome-screen menu (category 4,
drill-down C) still dispatch to the 4 consolidating skills — those only run
**after** carta-manco is already selected (explicit invocation by name, or a
genuinely ambiguous "help with our ManCo" request that falls through to the
menu), so they carry no picker-level collision risk. A user who names the
consolidating ask directly reaches the standalone skill without ever loading
carta-manco; a user who asks broadly still finds it as a menu option.

### Firm-context handoff to consolidating skills (known, accepted inefficiency)

The 4 consolidating skills each track firm context as `<FIRM_NAME>`/
`<FIRM_UUID>` internally, while this skill tracks `<ENTITY_NAME>`/
`<ENTITY_UUID>`. The Dispatch step passes the resolved firm context "so the
downstream skill can skip its own firm resolution," but the variable-naming
mismatch means that skip doesn't reliably fire — the downstream skill may
re-resolve the firm it was just handed. This is a minor extra round-trip, not a
correctness bug, and fixing it means changing the variable-naming contract of 4
other skills — out of scope here.

### Telemetry naming feeds an external Metabase dashboard

Gate 0.75's Dispatch step tags `_instrumentation.skills` with `<CAPABILITY>`
itself (`fetch-budget`, `create-budget`, `fetch-actuals`, `budget-analysis`,
`budget-scenarios`). A Metabase dashboard ("Budget Skills Usage") filters on
these exact strings — renaming a capability here requires updating that
dashboard's SQL too, an external dependency this repo cannot verify or fix
directly.
