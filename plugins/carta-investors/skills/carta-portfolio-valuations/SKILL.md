---
name: carta-portfolio-valuations
description: >
  Portfolio valuations workflow — firm selection, dashboard, bulk-create valuations
  on one or many companies (refresh, manual EV), and dive-in on a single
  valuation. TRIGGER when the user mentions working on, reviewing, or running
  portfolio valuations, takes a closer look at a specific company's valuation, or
  updates the EV / company value (e.g. "work on my valuations today", "review our
  portfolio valuations", "run all my Q2 valuations", "which companies need new
  valuations", "look at MangoCart's valuations", "update the EV for Acme", "set the
  company value for MangoCart", "batch valuations", "auto-run valuations"). DO NOT TRIGGER for 409A
  valuations or cap table valuations, or to turn the valuation tool on for a firm
  (this skill runs valuations only once it is already enabled). Use instead:
  carta-valuations-excel when the user is working in Claude for Excel (a workbook
  is open) — this skill's dashboard and bulk-create UI don't run there.
user-invocable: true
model: inherit
allowed-tools:
  # Carta MCP.
  - mcp__carta__search_tools
  - mcp__claude_ai_Carta__search_tools
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__search_tools
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  # MCP App views: the Methods table (references/dive-in/methodology-edit-view.md), the
  # financials view (references/dive-in/edit-financials-view.md) and the bulk picker
  # (references/bulk/bulk-runner-view.md) open with view_remote.
  - mcp__carta__view_remote
  - mcp__claude_ai_Carta__view_remote
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__view_remote
  # The dashboard (references/dashboard-view.md) runs in the newer MCP App shell, which
  # gives it its own app tools, so the server only opens it through view_remote_next.
  - mcp__carta__view_remote_next
  - mcp__claude_ai_Carta__view_remote_next
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__view_remote_next
  # Claude Desktop's widget tools, which control an open MCP App. The host adds them only after
  # the turn that opened the dashboard, so Step 1 calls list_widget_tools on the next turn;
  # the dashboard's app tools (refresh_page and the others the view registers) go through
  # call_widget_tool.
  - mcp__claude-device__list_widget_tools
  - mcp__claude-device__call_widget_tool
  - mcp__claude-device__set_widget_display_mode
  - mcp__claude-device__widget_context_v0
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - mcp__carta__list_contexts
  - mcp__claude_ai_Carta__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  # Supplies the `environment` that app-host.md maps to the app host.
  - mcp__carta__get_current_user
  - mcp__claude_ai_Carta__get_current_user
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__get_current_user
  - mcp__visualize__read_me
  - mcp__visualize__show_widget
  - ToolSearch
  - Bash(sleep *)
  - Bash(mkdir *)
  - Bash(cat *)
  - Bash(printf *)
  - Bash(mktemp *)
  - Bash(rm -f *)
  - Bash(echo *)
  - Read
  - Write
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.30.4</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

<!-- Part of the official Carta AI Agent Plugin -->

# Portfolio Valuations Workflow Skill

**Plugin root in reference files.** Reference files write the plugin root as a `CLAUDE_PLUGIN_ROOT` variable in braces. Bash does not set that variable, so never run it as written: replace it with the literal plugin root `${CLAUDE_PLUGIN_ROOT}`, keep every quote, and keep the command on one line.

Entry point for the portfolio valuations workflow, paired with Carta's
valuation pages. The chat does the work; the page shows it. This skill never builds an artifact or starts a local preview
server.

- **Bulk mode** — the bulk runner creates draft valuations across **one
  company or many** in a single pass via `create:bulk` (new drafts, and
  copy-from-previous for GPC). Driven by Steps 3–7 in
  `references/bulk/bulk-runner.md` and the runner in
  `references/md-table-runner.md`, whose selection screen is the
  `portfolio_valuations:view:edit_bulk_val` picker view in
  `references/bulk/bulk-runner-view.md` (approach recommended from each company's events,
  value and allocation method per company, one valuation date).
- **Dive into one** — open a single candidate, show a recap of where it
  stands, then route the user's free-text request directly to the
  relevant individual flow (cap table, financials, approaches, comps,
  GPC, allocation, finalize). No rigid wizard.
- **The Carta page** — the dashboard MCP App shows Carta's valuations
  dashboard beside the chat. Open the firm, company or valuation page in it
  when the user asks to see one, and refresh it after every change. See **Page navigation** below. Where the MCP App can't be shown
  (e.g. the terminal), the work carries on in chat.

References live in `references/bulk/` (the bulk runner) and
`references/dive-in/` (the individual single-valuation ability flows,
reachable on dive-in). `references/deep-link.md` is shared: it builds the
few Carta links the skill gives, and says which ids the MCP App takes.
See [README.md](README.md) for a full catalog of reference files.

## Startup: load every tool in one message

**Before Gate 1, send every startup `ToolSearch` in one message.** Each round
of tool calls costs seconds of model time, far more than any of these calls.
In that one message, send:

- one `select:` search that loads the Carta tools Gate 1 and Step 1 call:
  `read_tool`, `list_contexts`, `list_accounts`, `set_context`,
  `view_remote_next` (the dashboard's view tool) and `view_remote` (the other
  views' tool). Take their full names from the Carta server listed in your
  deferred tools (the prefix differs by host), and skip any that are already
  loaded:

```
ToolSearch({ query: "select:<carta>__read_tool,<carta>__list_contexts,<carta>__list_accounts,<carta>__set_context,<carta>__view_remote_next,<carta>__view_remote" })
```

If every one of these is already loaded, skip the search.

## Gate 1: Access check — upsell when Portfolio Valuations isn't enabled

**Run this once, on first invocation of the skill, right after the Startup message and before anything else.**
One probe up front — never a check scattered through the individual flows. Every step after this may assume access is settled.

A caller without Portfolio Valuations is stopped in one of **two** ways, and
which one they hit depends on how their access is configured:

- **The commands are hidden.** The MCP server filters them out of the tool
  surface, so calling one returns `Unknown tool:
  'portfolio_valuations__…'` — the same error a typo produces.
- **The commands are callable but the API refuses.** The call goes through
  and the API returns an access-denied error — no permissions, or the
  feature isn't enabled for the firm.

Both mean the same thing to the user: they can't use Portfolio Valuations.
Treat them identically. There is no entitlement field to read beforehand, so
the only way to know is to call something and read the response.

**Do not probe with `search_tools`.** Nearly every command in this domain is
registered unindexed, so it is absent from `search_tools` results whether or
not the caller has access. A missing command there means nothing and must
never be treated as an access or health signal.

### The probe

```
read_tool({"name": "portfolio_valuations__search__tickers",
           "arguments": {"query": "aapl"}})
```

Its only parameter is one you supply, so it needs no firm, project, or
candidate — which is why it can run before firm selection, and why it is
cheap. **The payload doesn't matter; only whether the call got through.**

Never show the probe or its output to the user, and never mention tickers —
this is a silent capability check, not a search the user asked for.

### Branching

Show the upsell on **either** of these:

1. **`Unknown tool`** for a `portfolio_valuations__*` name — the commands
   are hidden from this caller.
2. **Access-denied** — the response says the user or their firm has no
   permissions for Portfolio Valuations, or that the feature isn't enabled
   (an authorization failure, typically HTTP 403).

**Anything else** — results, an empty list, a validation error, a timeout, a
5xx, a network failure, a dropped connection → treat the caller as **having
access**. Continue to Step 1 and never mention this gate. An outage must
never tell a paying customer to buy what they already own.

Cache the outcome for the session. Do not re-probe on re-entry, and do not
re-check before individual calls. If a later call hits either signal after
this gate passed, show the upsell then — but say nothing about the earlier
check.

### The upsell message

Show this instead of the dashboard, runner, or recap — never alongside a
partial render, and never after already showing portfolio data.

Output it as written — do not reword, expand, or add a feature list:

> This feature requires Portfolio Valuations, which isn't enabled for your
> firm yet. You're on the Investors plugin, so unlocking it is
> straightforward — reach out to your Carta account team or
> [request a demo →](https://carta.com/demo/portfolio-valuations/?&utm_medium=product&utm_source=claude&utm_campaign=valuations-plugin-inq-ww-q3-26).
>
> In the meantime, I can help with fund performance data, NAV, TVPI, LP
> documents, or anything else in your current plan.
>
> Request a demo:
> https://carta.com/demo/portfolio-valuations/?&utm_medium=product&utm_source=claude&utm_campaign=valuations-plugin-inq-ww-q3-26

Keep the bare URL on its own line after the message: a markdown link isn't
clickable in a terminal. Keep both URLs exactly as written, unwrapped — the
`utm_` parameters attribute the lead to this plugin.

Then stop. Do not present the *dashboard-on-screen* or *no-dashboard* fork, and do not attempt
any further `portfolio_valuations` call this session.

The closing line is an offer, so honour it if the user takes it up: fund
performance, NAV and TVPI go to `carta-explore-data`; LP documents to
`carta-lp-dashboard`. Those domains are gated separately and generally do
work for a caller without valuations. Route on request — don't
pre-emptively start one.

## End Goal

A valuation candidate is **complete** when all six items below hold.
This checklist is the orchestrator's goal — every routing decision on
dive-in and the entire bulk flow are organized around it.

Candidate-scoped reads are written `get:<name>` below; each is
`read_tool({"name": "portfolio_valuations__get__<name>", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`.

1. **Cap table data is present** — **`CORPORATION` only.**
   `get:cap_table_summary` returns share-class data (non-empty). A c-corp
   candidate stores its own cap-table snapshot; an empty one blocks
   allocation.
   - **`LLC_ISSUER` — not applicable.** An LLC's cap table is live issuer
     data, not part of the candidate. Treat item 1 as N/A — never mark it
     ⏳ missing, and never fetch the LLC cap table just to tick it off.
     LLC completeness depends on **access** to that cap table, which
     surfaces through item 5.
2. **Financials are filled in** — only when the selected methodology
   requires them (**Required inputs by methodology** below, which also
   defines "filled in"). Otherwise N/A — never ⏳ missing.
3. **Required approach inputs are in place.** The selected methodology is
   every approach in `get:approaches` with `isUsed: true`. Then:
   - **Comparables**, when the table below requires them, are filled in.
   - **GPC enabled** also needs `get:gpc_multiples` to return a non-empty
     multiples set.
   - **Custom Value enabled** (`otherIndicationOfValue.isUsed: true`) also
     needs `get:custom_value.company_value` to be non-zero.
   - No other methodology has an approach-specific input to check here.
   - **Every selected approach has produced a positive value**:
     `get:approaches` → `approachValues.{key}.value` > 0. This is what the
     Step 2.5c checklist shows as each **Calculate {method}** / **Set … value**
     item.
4. **Company value is positive** — `get:valuation` →
   `companyValue.amount` > 0. Zero or negative (e.g. a GPC draft with no
   comps, left with only its debt adjustment) is not done.
5. **Holdings value is positive** — `get:valuation` →
   `valueOfHoldings.amount` > 0 (not `holdingsValue`, which is the
   dashboard's field).
   - **On the LLC path this is where cap-table access bites.** An LLC's
     holdings value comes from a **Niagara** allocation
     (`references/dive-in/allocation.md`), which reads the LLC cap table.
     Without access the allocation fails and the candidate can't be
     completed. **Don't preflight access with an extra call** — the
     dashboard has no LLC access flag, and allocation's own
     `get:configuration` check reports it. When it comes back
     permission-denied, say so plainly:
     > "You don't have access to **{company}**'s cap table, so the
     > allocation can't run. Contact the company to grant access, then we
     > can compute the holdings value."
6. **Status is FINAL** — the candidate's `status` field is `FINAL`.

### Required inputs by methodology

Items 2 and 3 above, the **Required inputs missing** column in
`references/bulk/bulk-results.md`, and the **Inputs:** section of the
Step 2.5c checklist all read this one table. Change it here, never in a
copy.

| Methodology (`get:approaches` key) | Required inputs |
|---|---|
| Custom Value (`otherIndicationOfValue`) | None |
| Post-money (`postMoney`) | None |
| GPC (`gpc`) | Financials, Comparables |
| DCF (`dcf`) | Comparables |
| Backsolve (`backsolve`) | Comparables |
| M&A (`ma`) | Financials |

- **More than one methodology selected** → combine their required inputs
  and list each once. `GPC 50% / M&A 50%` requires Financials and
  Comparables.
- A methodology not in the table requires no inputs here.
- **Filled in:**
  - **Financials**: `get:financials` returns at least one period with
    revenue/EBITDA populated.
  - **Comparables**: `get:comparables` returns at least one comp with
    `isGpc: true`.
- **Required inputs missing** = the required inputs that aren't filled in.

### How to use the goal

**Trust the API, not the session.** Never track checklist state in your
head: re-derive it from a fresh `get:valuation` / `get:approaches` before
deciding what's done.

In **bulk mode**, the bulk runner creates a draft for every company in
one pass (`create:bulk`). Failures are isolated per-company.

On **dive into one**:
- **When entering a candidate**, silently call `get:valuation` and
  `get:approaches` to establish where it is on the checklist.
- **While the user is working on the valuation**, end every response with
  the **valuation summary checklist** (Step 2.5c), re-fetched each time.
  That is the always-on view of items 4 and 5 and the required inputs.
- **In lateral-entry routing**, do not proactively suggest next steps.
  Answer what the user asked, then return control. The summary checklist
  is a status line, not a suggestion, so it still renders.
- **When the user explicitly asks** "what's left?", "am I done?",
  "what's next?", surface the checklist with simple status markers
  (✅ done / ⏳ missing). Show only the candidate name and the six items.
- **When the user tries to skip ahead** to a step that isn't ready
  (e.g. "finalize this" while EV is zero), refuse gracefully and point
  at the gap.
- **Never *offer* a step whose prerequisites aren't met.** A next-step
  menu lists only options runnable right now:
  - **No "Finalize" until company value (item 4) and holdings value
    (item 5) are both positive** — offer the missing prerequisite instead
    ("Run allocation", "Set an approach and value").
  - **No "Run allocation" while company value is zero** — set an approach
    and capture a value first.

## UX Rules

These apply in every reference file too; they aren't repeated there.

- **Never use the `AskUserQuestion` tool** — it isn't granted to this
  skill. Ask every follow-up **inline as plain text**: the question,
  numbered options where relevant, then wait for a free-text reply.
- For **multiple fields at once**, use `show_widget` to render an
  elicitation form.
- The prose examples (shown as `> "..."`) are illustrative wording.
- Never surface raw command names, API field names, HTTP status codes, or
  internal IDs (org_pk, corporationId, firm_id, project or candidate IDs)
  in chat. Speak in business terms ("revenue", "comps", "allocation",
  "company value", "holdings value").

## User-Facing Output Rules

**When a sub-flow reference exists for the user's intent, you MUST
read the reference and follow it.** Do not paraphrase the concept from
your own knowledge.

**When executing Step 6's bulk pipeline, you MUST run every step
in the path** — including for refreshes, which are not silent clones.
See "Execution discipline" in `references/bulk/bulk-runner.md` for
the full rule, the required mutate sequence, and the post-run
self-check.

**Creating more than one valuation at a time MUST go through
`create:bulk`, never a per-company loop of `create:project` /
`create:project_from_copy`** — text runner included. Only exactly **one**
confirmed company uses `references/dive-in/create-val.md`. Each
`create:bulk` item carries its own methodology, `copyFromPrevious` and
`valuationDate`, so no per-company setting justifies a loop.

## Currency default

Format every amount in the currency the data names (`currencyCode`, a
currency field on the row). Never assume or default to USD or `$`. When the
data names none, show the bare number with no symbol. Do this silently: never
add a note, legend line or caveat saying the currency is missing. Never total
amounts that are in different currencies.

## Table values — render what the command returned

**Every table in this skill**, in any reference file. A value the command
returned goes in the cell as that value — negatives, zeros, and outliers
included. Never substitute `NM`, `N/A`, a blank, or any other
not-meaningful marker, and never drop or bury the row. Comparable
multiples are where this slips most; finance convention prints `NM` there
and this skill does not.

`—` means the response carried nothing — null, absent, or a documented
unset sentinel. That is the only thing it may mean.

Flag an odd value in a line under the table, never by emptying its cell.

## Volatility disclosure — always label the source, show the full table

This skill surfaces **multiple, independent volatility datasets** on
the same candidate, and they are not interchangeable even though every
one of them is "a volatility percentage":

- **OPM volatility** (`get:volatility_comps` called without an
  `allocationId` — see `references/dive-in/allocation.md` Step 4C.2) —
  equity or asset, chosen by the candidate's debt treatment.
- **DLOM volatility** (`get:approaches`'s `dlomVolatilityQuartiles` /
  `dlomVolatilityRegression` / `dlomChaffe` / `dlomFinnerty` — see
  `references/dive-in/allocation.md` Step 5.2) — its own comp-derived
  distribution, computed independently of the OPM figure above. These
  two can and do differ materially on the same candidate.
- **Backsolve volatility** (`get:volatility_comps` called with and
  without the Backsolve allocation's `allocationId` — see
  `references/dive-in/backsolve/backsolve.md`'s "show volatility
  comps" entry point) — the Backsolve allocation's regression and the
  candidate's standard-scenario regression, which can also diverge on
  identical comps.

**The rule, wherever any of this skill's reference files displays a
volatility number:**

1. **Always name the source** alongside the number — which dataset
   (OPM / DLOM / Backsolve), which entity when more than one is in
   play (Backsolve allocation vs. standard scenario; subject company
   vs. comp set), which volatility type (equity vs. asset — and why,
   e.g. "asset, because debt is included"), and which statistic
   (regression result, mean, median, a specific percentile, or a
   manual entry).
2. **Show the full quartile/regression table, not just the single
   number**, whenever one is available — even if the user asked about
   one figure. It shows where the number sits in the distribution and
   catches a source mix-up. A bare number is fine only when the command
   returns a single scalar.
3. **Never default one dataset's value into another's without saying
   so.** When a reference file says to borrow a value captured
   elsewhere, name the dataset it came from before applying it.

## Tool surface

**Every** read-only command in this skill (`read_only: true` in `search_tools`) is called via
`read_tool({"name": "...", "arguments": {...}})`, and every command that changes data —
including the `compute:*` commands, which carta-mcp marks as changing data — via `call_tool` with the same
shape. There is no exception.

Some writes declare body fields as **required**, because the API rejects
them as null and an omitted argument reaches it as an explicit null. A
call that leaves one out is refused by argument validation before any
request is sent:

| Command | Required body fields |
|---|---|
| `mutate:approaches` | `usesCompanyLevelDlom`, `dlomConfigured`, `dlomMethod`, `dlomVolatilityManualEntry`, `dlomTimeToExitManualEntry` |
| `mutate:comparables` | `comparables` |
| `mutate:financials` | `financials` |
| `mutate:gpc_multiples_selection` | `multiples` |

So read the current state first — `get:approaches`, `get:comparables`,
`get:financials`, `get:gpc_multiples_selection` — and echo back the
fields you are not changing. The rejection names every missing field at
once, so recovering takes one retry, not one per field.

Per-approach objects on `mutate:approaches` (`gpc`, `dcf`, `ma`, …) are
the opposite: they are ignored when null, so naming only the approaches
you are changing leaves every other approach's `isUsed` and `weight`
untouched.

### Param naming — non-negotiable

Carta's MCP API uses different parameter names and casing across
endpoints. **Do not pattern-match or guess.** Specifically, when calling
`read_tool` or `call_tool`, the `name` value and `arguments` keys below are fixed:

| `name` | Required `arguments` |
|---|---|
| `portfolio_valuations__list__portfolio_dashboard` | `organizationId` (NOT `organizationPk`), `page_size: 100` (always — never omit), `raw: false` (always — never omit). The formatted response strips null fields and is the shape this skill reads. Only switch to `raw: true` when the user explicitly asks for the raw API response. |
| `portfolio_valuations__list__projects` | `ownerId`, `ownerKind: "FIRM"`, `targetId`, `targetKind: "CORPORATION"` (camelCase) |
| `portfolio_valuations__get__llc_cap_table_summary` | `issuerId` (the LLC issuer id — the candidate's `target.id` from `list:projects`, == the dashboard `llcIssuerId`); optional `asOfDate` — a **full ISO-8601 timestamp** (`YYYY-MM-DDT00:00:00Z`), **never** a bare `YYYY-MM-DD`. Both camelCase — contrast the c-corp cap-table commands' snake_case `project_id` / `candidate_id`. |
| `portfolio_valuations__get__configuration`, and the four Niagara commands (`compute__niagara_waterfall`, `get__niagara_waterfall`, `compute__niagara_opm`, `get__niagara_opm`) | `valuation_id` (snake_case) — the valuation's **integer** id, the `valuationId` on a `list:projects` candidate. These take it **alone**: no `ownerId`, no `project_id`, no `candidate_id`. Both `get__niagara_*` polls additionally require `groupingMethod` (camelCase, `BY_INTEREST_HOLDER` or `BY_INTEREST_TYPE`) and 400 without it. |

Using a wrong name returns a validation error.

## Writes — save, then show what was saved

Applies to **every** `mutate:*` and `create:*` call, in any reference
file.

**Do not ask the user to confirm a write before making it.** When the
user asks to save, set, update, or enter a value, make the call. A
question the skill genuinely needs answered — which period, which
share class, how to split the weights — is still asked; a "does this
look right? / apply these changes?" gate on a value the user already
gave is not.

**After every write, show the user what was saved** so they can check
it without being interrupted first. One row or line per changed field:
`{Field} — {full previous value, or "—" if new} → {full saved value}`.
Build it from the write's response (or a re-fetch), not from what you
sent. If the user spots a mistake, fix it with another write.

**Then call `refresh_page`** straight after each successful write, per
`references/dashboard-view.md` **Refresh it after a change**.

**End the turn by offering to open the updated valuation.** When the user
asked for an action on a specific valuation and the turn made at least one
successful `mutate:*` call on it, close the reply with one plain-text
question, after the saved-values summary:

> Would you like me to take you to the updated **{company} {valuation label}** valuation page?

`{valuation label}` is how the company page names it ("Q2 2026", or its
date when it isn't a quarter end). On a yes, call the dashboard MCP App's
`open_company` then `open_valuation` for it (`references/dashboard-view.md`
**Open a page in it**). On a no, or any other reply, leave the view where it
is and handle the reply.

- **Once per turn**, even when the turn made several writes on the
  valuation, and only as the turn's last line. A turn whose writes all
  failed changed nothing and gets no question.
- **Skip it when the valuation's page is already open in the view.** Before
  asking, call the app tool `get_open_page` once; if it names this
  valuation as the open page, don't ask.
- **Skip it when the session holds no dashboard widget id** (**Page
  navigation → App tools need the widget id**): there is no way to take
  them there.
- **Skip it for a create, a bulk run or a delete.** Those aren't an action
  on an existing valuation's page: a new valuation shows up on whichever
  page is open once `refresh_page` runs, and a deleted one has no page. A
  finished allocation run gets the same offer (**Page navigation → After an
  allocation**).

**Numbers in that saved-values summary are the full value — `130,107,041.24`,
never `130.1M`** — because rounding hides the extra zero or misplaced
decimal the user is checking for. Abbreviations are fine everywhere else.

### Exceptions: finalize and delete always need an explicit yes

Two writes can't be undone, so they are the only ones that wait for
the user:

- **Finalizing a valuation** (status → FINAL) — `references/dive-in/ship.md`
  Step 3.
- **Deleting a valuation** — `references/dive-in/ship.md`
  **Delete a valuation**.

For these two, say what will happen, ask, and call the write only on an
explicit yes. An earlier "finalize it" or "delete it" is the request,
not the confirmation.

---

## Page navigation

The page is the dashboard MCP App (`references/dashboard-view.md`): Carta's
portfolio valuations dashboard, with its firm, company and valuation pages,
shown beside the chat. The work happens in chat, and this section keeps the
MCP App in step with it. Never link any of those pages, or the older
valuation pages outside the dashboard (`references/deep-link.md` **Step
2**): the MCP App is the way to them.

### App tools need the widget id

Every app tool (`open_portfolio`, `open_company`, `open_valuation`,
`get_open_page`, `refresh_page`, `set_display_mode`) is called through
`call_widget_tool` with the dashboard's widget id, so it runs only while the
session holds that id (Step 1 **On the very next prompt, call
`list_widget_tools` first**). The session holds none in the turn that opened
the dashboard, in a host without the widget tools (the Code tab), or when the
MCP App can't be used. Without the id:

- Skip every offer to open a page.
- Answer a direct request to see a page with one line saying where it is in
  Carta's valuations dashboard, with no link, and carry on.
- A write that succeeded before the id was held is refreshed late: once
  `list_widget_tools` returns the id, the first `call_widget_tool` is one
  `refresh_page` (`references/dashboard-view.md` **Refresh it after a
  change**).

### Which page to open

**Move the view only when the user directly asks to see a page.** Nothing
else moves it: not an action on a valuation (adding financials, setting an
approach, running allocation, finalizing), not resolving or diving into a
valuation, not a create, a bulk run or a delete. While the MCP App is open,
open the page the user asks for through its app tools, per
`references/dashboard-view.md` **Open a page in it**: the firm dashboard with
`open_portfolio`, a company page with `open_company`, and a valuation page
with `open_company` then `open_valuation`.

| The user asks to see | Open |
|---|---|
| Their portfolio companies ("show my portfolio", "take me to all my companies", "back to the dashboard") | The firm dashboard |
| A company, its dashboard or its historical valuations ("take me to Meetly", "show me Meetly's dashboard", "Meetly's valuation history") | The company page |
| A specific valuation ("take me to Meetly's Q2 valuation", "show me that valuation", "yes" to the offer below) | The valuation page |

Open the most specific page the request names: "show me Meetly's Q2
valuation" opens that valuation's page, not the company page first.

**After an action, offer instead of moving.** When the user asked for an
action on a specific valuation and it succeeded, the turn ends by asking
whether to open the updated valuation page (**Writes → End the turn by
offering to open the updated valuation**; for an allocation run, **After an
allocation**). Open it only on a yes. Where a flow points the user at a page
to finish something there (a per-class DLOM, a status flip, a delete that
failed), say which page and offer to take them there the same way; don't
open it unasked. Every offer waits on the widget id (**App tools need the
widget id**).

### Refresh the page after a change

Call `refresh_page` straight after each successful write, per
`references/dashboard-view.md` **Refresh it after a change**.

### After an allocation

An allocation changes the holdings value, which the valuation page shows.
Once the run's results are back (allocation.md Step 7, or a Niagara poll at
`SUCCESS` in Step N4), call `refresh_page` once, per
`references/dashboard-view.md` **Refresh it after a change**, and end the turn by
offering to open the updated valuation page, exactly as **Writes → End the
turn by offering to open the updated valuation** says. Don't move the view
unasked. A run that failed changed nothing, so leave the view alone.

### No dashboard links

Never link a valuations dashboard page (`references/deep-link.md` **Step 2**).

### When the user acts on the page

The valuation pages have their own status actions, finalize included. A user can
change a valuation there without telling you, so a status you read earlier
may be stale:

- Before any status-dependent step — finalize, delete, offering
  **Finalize** in a menu, the Step 2.5d download notice, Fund Holdings Step
  F2 — read the status from a fresh `get:valuation`, never from context.
- When the user says they changed something on the page ("I finalized it on
  the page", "I moved it back to draft"), re-read the valuation and
  re-render the Step 2.5c checklist. Don't assume it's still a draft, and
  don't move the view: the page already shows the change.

---

## Routing: match the request to a capability

This skill does three things — **review the dashboard**, **bulk-create
valuations**, and **dive into one valuation**. There is **no fixed
sequence**: read the user's first message, match it against the table
below, and enter that capability directly. The only hard prerequisite is
**firm selection** (Step 1) — resolve `org_pk` first, then act on the
matched capability.

### Global interrupt: fund holdings request (any point in the flow)

**Check every user message, at every step** — dashboard, bulk runner,
dive-in, mid-flow. Trigger phrases: "show fund holdings", "fund
breakdown", "fund holdings value", "fund level breakdown", or equivalent.
On match, jump to **Fund Holdings (cross-flow capability)** below. Never
answer it with `get:allocation`, which returns per-share-class allocation
output, not the fund-level split.

| The user's request… | Enter |
|---|---|
| **One** company named, or single-company drill-down ("show me MangoCart's valuations", "let's work on Acme today", "I want to pick comps myself", "review Acme's cap table", "let's go step by step on Acme", "update the EV for Acme") | **Dive into one** — after Step 1, go to **Step 2.5**: show the recap, then route the request. If the candidate isn't identified, ask which one. |
| **Multiple** companies named ("review MangoCart and Acme") | **Bulk-create** with that pre-selected set — see *Multi-company entry* below. |
| Open-ended: generic / unscoped ("I want to work on my portfolio valuations", "let's work on valuations today", "work on portfolio valuations for {firm}"), review / status phrasing scoped to the portfolio ("review my Q2 valuations", "which companies need new valuations"), bare / help-ish (empty message, "help", "what can you do", "get started", "show me what you can do", bare `/carta-portfolio-valuations`), or ambiguous | After Step 1, present the *dashboard-on-screen* or *no-dashboard* fork (below, whichever matches what Step 1's open call did) and wait. Do **not** render the portfolio table or jump into `references/bulk/bulk-runner.md` until the user asks. |
| Explicit bulk/multi-valuation **action** intent, no specific companies named ("run all my valuations", "batch valuations", "auto-run valuations", "let's do some bulk valuations", "I want to do a few bulk valuations", "do multiple valuations at once") | **Ask which way in** — after Step 1, present the *bulk-intent fork* (below) and wait. Do **not** jump straight to the dashboard or the runner. |

Resolve company-name matches against `list:portfolio_dashboard` (params
in **Param naming**) only after Step 1 — it needs `org_pk`.

For the **open-ended** row, the fork below is the only prompt: no separate
firm line or menu before it. Step 1's open call always runs, so exactly one
of the two applies.

**No dashboard on screen (the dashboard MCP App couldn't be used).** After
Step 1, set `intro_shown = true`, then ask and wait:

> You're working in **{firm_name}**. Would you like to:
> 1. **See the dashboard here** — I'll show every company, its latest valuation and status in chat.
> 2. **Work on an existing valuation** — tell me which company and we'll go straight in.

Route the reply:
- **Dashboard** ("1", "dashboard", "show me everything") → **Step 2.2**.
- **Existing valuation** ("2", a company name) → **Step 2.5 (dive into one)**
  for that company; if none was named, ask which one.
- **Bulk request** → the *bulk-intent fork*.

**Dashboard on screen (the dashboard MCP App opened).** The dashboard Step 1
showed is the portfolio view: don't render the table or call
`list:portfolio_dashboard`. Don't say anything about a page having been
opened. Set `intro_shown = true`, suggest bulk valuations, ask which company
or valuation to work on, and wait:

> Would you like to run a bulk valuation across several companies, or work on one company or valuation? Tell me which company or valuation you want to start with, or say "show it here" for the portfolio table in chat.

"Show it here" (or any request for the table) → **Step 2.2**. A company name
→ **Step 2.5**. A bulk request → the *bulk-intent fork*.

The single-company, multi-company and bulk rows route as the table says in
both cases.

**Bulk-intent fork (bulk action, no companies named).** After Step 1,
ask:

> Would you like to:
> 1. **See the bulk runner table** — review every company eligible for a valuation, then pick which to run.
> 2. **Tell me which companies** — you already have specific ones in mind.

Route the reply:
- **Bulk runner table** ("1", "show me", "see the table") → go straight
  to the runner, without rendering the dashboard first: read
  `references/md-table-runner.md` and follow from Step 0.
- **Already have companies in mind** ("2", "I know which ones", a company
  name) → if none were named yet, ask "Which companies?" in prose; once
  named, treat as **Multi-company entry** below (pre-selected set).

**Multi-company entry.** Read `references/bulk/bulk-runner.md`
**immediately** (no `org_pk` dependency — in parallel with Step 1's API
calls); carry the named set in as the pre-selected company list and start
at **Step 4** once Step 1 completes (skip Step 3).

### Silent entry signals (apply before routing, never surfaced)

- **One-line intro (bulk-create paths only).** Fire it **once per
  session** (gated on `intro_shown`), before the work, only on paths that
  can lead to creating drafts across companies: **multiple companies
  named** and the **bulk-intent fork** (when it's presented):
  > ⚡ I can create these as **drafts** — each defaults to a roll-forward of last period (refreshed multiples + the latest financials), and you can override any company before I start or finalize later.

  Never for a single named company (dive-in), or on the *dashboard-on-screen*
  and *no-dashboard* forks (they set `intro_shown = true`).

---

## Fund Holdings (cross-flow capability)

Reached from the **global interrupt** above. Fund holdings exist only
for a **finalized (`status: FINAL`)** valuation; drafts have no committed
allocation to report against.

### Step F1: Resolve target company + valuation date

- **A specific company/candidate is already in context** (e.g. mid
  dive-in, Step 2.5a's recap already ran) → use that company's name and
  the valuation date currently in view. Skip to **Step F2**.
- **On the rendered dashboard** (Step 2.3/2.4) with no company named →
  use every company in the **Final valuation** bucket (already derived
  in Step 3.2). Skip to **Step F2**.
- **No company/candidate in context at all** (e.g. the interrupt fired
  before any dashboard or dive-in has loaded) → ask in plain text:
  "Which company's fund holdings would you like to see?" Once named,
  resolve it against the dashboard/company list, then continue.

### Step F2: Check valuation status — gate on FINAL

For the resolved company(ies), check the status: `latestValuation.status`
from the dashboard data, or a fresh `get:valuation` mid dive-in:

- **Status is `FINAL`** → proceed to **Step F3** with that company +
  valuation date.
- **Status is `DRAFT`, or there is no valuation at all** → do **not**
  run the query. Tell the user plainly, e.g.:
  > Fund holdings can only be viewed for a **finalized** valuation — this one is still a draft.
  Then list that company's finalized valuations (`list:projects`,
  candidates with `status == "FINAL"`) and ask which one they'd like to
  see:
  > Here are the finalized valuations for **{company}** — which would you like to see fund holdings for?
  > 1. {date 1}
  > 2. {date 2}
  > ...
  Wait for the reply, then continue to **Step F3** with the chosen date.
  If there are **no** finalized valuations for that company at all, say
  so plainly and stop — do not offer a date list.
- **Multiple companies resolved in Step F1** (dashboard-wide request) →
  apply this gate per company; only companies with a `FINAL` valuation
  go into Step F3's query. If none are final, say: "No final valuations
  are in the dashboard yet."

### Step F3: Query and render

`FUND_ADMIN.FUND_HOLDINGS_VALUE` answers fund-holdings questions from
any angle — by company and date, by fund, firm-wide, or by date range.
Build the `WHERE` clause from what the user actually asked.

**Confirm the schema before writing SQL:**
`read_tool({"name": "dwh__get__table_schema", "arguments": {"table_name": "FUND_HOLDINGS_VALUE", "schema": "FUND_ADMIN"}})`
(`dwh__list__tables` first if the table may have moved). Known columns:
`VALUATION_DATE`, `TARGET_NAME`, `FUND_NAME`, `FUND_HOLDINGS_VALUE`,
`FUND_INVESTED_CAPITAL`, `FUND_LEGAL_OWNERSHIP_PCT`, `FUND_MOIC`,
`TOTAL_HOLDINGS_VALUE`, `SOURCE`, `ALLOCATION_METHODOLOGY`; select more
when the question needs it.

Default shape (company + date, one clause per company joined with `OR`):

```sql
SELECT
    VALUATION_DATE,
    TARGET_NAME,
    FUND_NAME,
    FUND_HOLDINGS_VALUE,
    FUND_INVESTED_CAPITAL,
    FUND_LEGAL_OWNERSHIP_PCT,
    FUND_MOIC,
    TOTAL_HOLDINGS_VALUE,
    SOURCE,
    ALLOCATION_METHODOLOGY
FROM FUND_ADMIN.FUND_HOLDINGS_VALUE
WHERE (<one clause per company: TARGET_NAME ILIKE '%{name}%' AND VALUATION_DATE = '{date}'>)
ORDER BY FUND_HOLDINGS_VALUE DESC
```

Other shapes: `FUND_NAME ILIKE '%{fund}%'` for a fund; just
`SOURCE = 'PORTFOLIO_VALUATION'` (still FINAL-only per Step F2) firm-wide;
`VALUATION_DATE BETWEEN` for a range.

Call `read_tool({"name": "dwh__execute__query", "arguments": {"sql": "<query>", "limit": 200}})`.
For an open-ended question, `dwh__execute__question` (plain English) is an
acceptable fallback.

Display results as a markdown table with columns: **Company**, **Fund**,
**Valuation Date**, **Holdings Value**, **Invested Capital**,
**Ownership %**, **MOIC**, **Method**. Format amounts with an M/B/K
suffix in the fund's currency when the schema check above shows the
table carries one; otherwise show the bare number (see **Currency
default**). Ownership % as `X.XX%`; MOIC as `X.Xx`; show `—` for any null
field. If the query returns no rows, say: "There are no fund holdings
for this valuation."

Then return control to wherever the user was — don't force a new menu.

---

## Step 1: Firm selection (prerequisite — resolve before any capability)

Every capability needs `org_pk`, so resolve the firm first.

**Never load the portfolio on entry.** `list:portfolio_dashboard` is slow,
so the skill does not call it when it starts: not ahead of time, not in
parallel with firm selection, and not to build the first reply. It runs only
when the user asks to see the portfolio in chat, names a company to resolve,
or starts a bulk run. Firm selection needs only `list_contexts`,
`list_accounts` and `set_context`.

1. Call `list_contexts` to check for an active firm and get the firm name.
   - **The user gave a numeric firm ID** (e.g. "Krakatoa Ventures (firm id = 1)"):
     find the firm whose `carta_id` equals that number, use the number as
     `org_pk`, and **skip `list_accounts`**. A firm's `carta_id` is the same
     integer as its `organization_pk`. The user has already chosen the firm, so
     skip step 3's confirmation and go to step 4. If no firm has that
     `carta_id` (or `carta_id` is null), fall back to step 2.
2. If `org_pk` is **not** cached and wasn't given, once `list_contexts` returns, call
   `list_accounts` with `search: "<firm name>"` to resolve `org_pk`
   (integer ID from `organization_pk:<n>`). **Never call `list_accounts`
   without the search filter** — the unfiltered response returns 200+
   accounts.
3. If active firm exists, confirm by asking in plain text. If multiple
   firms and no active one, list them and ask the user to pick. If one firm, auto-select silently.
4. Call `set_context` if the user picked a different firm.
5. **Open the dashboard MCP App** — always, once the firm is settled. See
   **Open the dashboard MCP App first** below.

**Important**: The `list_contexts` `firm_id` is a UUID used for
Snowflake — it is NOT the same as the integer org_pk needed by
valuation commands. Resolve org_pk from the `list_accounts`
search result (`organization_pk:<n>`), or from the firm ID the user gave
(step 1).

**Session cache**: hold `org_pk` for the session. On re-entry, still call
`list_contexts` to confirm the active firm, but reuse the cached `org_pk`.

If the user has no firms, surface plainly and stop.

**Open the dashboard MCP App first.** The dashboard is an MCP App: Carta's
dashboard page shown in the side panel on the right of the chat, not a link,
not inline in a message and not a browser page.
On every invocation, as soon as the firm is settled (after the user confirms
it, when Step 1 asks) and before any table, recap or link, open it with:

```
view_remote_next({"name": "portfolio_valuations:view:dashboard",
             "params": {"organizationId": <org_pk>}})
```

`references/dashboard-view.md` says what to do once it returns. The view moves
itself to the side panel as it mounts, so don't move it.

**On the very next prompt, call `list_widget_tools` first.** The host adds
the tools that control an open MCP App only after the turn that opened it.
So in the user's next message after each time
`portfolio_valuations:view:dashboard` loads, **whatever that message says,
your first call is `mcp__claude-device__list_widget_tools()`**. Load it with
`ToolSearch(query: "select:mcp__claude-device__list_widget_tools,mcp__claude-device__call_widget_tool,mcp__claude-device__set_widget_display_mode")`
if it isn't loaded. Its result gives the dashboard's widget id (the widget
`view_remote_next` opened) and the app tools that widget lists. Keep that id
for the session, and reach the dashboard's app tools
(`references/dashboard-view.md`) through `call_widget_tool` with it. Then
carry on with the user's message. Make the call silently. If
`list_widget_tools` isn't available or fails (the Code tab has no such
tools), say nothing and carry on without the id (**Page navigation → App
tools need the widget id**).

Make the open call
even when the request names a company or valuation. Use `view_remote_next`, not `view_remote`: the server refuses to
open the dashboard through `view_remote`. The **Startup** message loaded
`view_remote_next`; if it still isn't loaded, load it first with
`ToolSearch(query: "select:mcp__carta__view_remote_next,mcp__claude_ai_Carta__view_remote_next,mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__view_remote_next")`
and use whichever answers. When the MCP App opens, it is the way to the firm
dashboard.

**When the MCP App can't be used** — only in the cases
`references/dashboard-view.md` **When the MCP App cannot be used** lists, and
never without first trying the call above — carry on in chat with no link in
its place: the *no-dashboard fork* (Routing) offers the portfolio table here.

After firm selection, resolve any company-name matches captured during
routing:
- **One match (single company named)** → proceed to Step 2.5 (dive into
  one) for that company.
- **Multiple matches (named in the user's message)** → read
  `references/bulk/bulk-runner.md` inline; carry the matched list
  in as the pre-selected company set and start at Step 4. Skip Step 3.
- **No company named** → the route the request matched in **Routing**.
- **A name that matched no company** → say so and ask which company.

---

## Step 2: Dashboard entry

Reached when the user picks the portfolio table from the *dashboard-on-screen*
or *no-dashboard* fork. Go to **Step 2.2**, which fetches and renders it
via **Step 3.2**; Step 2.3's menu routes from there.

### Step 2.1: Edge-case firm lines

Only these edge cases print a greeting; the normal case is the fork
**Routing** presents after Step 1.

- **Multiple firms, none active** (user must pick first):
  > 👋 **Portfolio Valuations**. Pick a firm to get started.

  Then run Step 1's firm picker. After selection, carry on with the route the
  request matched in **Routing**.

- **Zero firms**:
  > 👋 **Portfolio Valuations** — you don't have any firms set up in Carta yet. Add one and come back.

  Stop.

- **Firm has zero portfolio companies** (detected after Step 3.2's
  data load):
  > 👋 **Portfolio Valuations** — working in **{firm_name}**, but there are no portfolio companies yet. Add some in Carta and come back.

  Stop.

### Step 2.2: Render the dashboard

Render the grouped markdown table from **Step 3.2** in chat, after the
Step 2.1 line when one applies. Don't ask how the user wants to see it. No
link under it.

### Step 2.3: Prompt the user

After the table, present a three-bucket follow-up menu in plain text.
The **Act** bucket is always static. The **Analyze** and **Export**
buckets are data-aware — omit any option whose condition is not met,
and omit the bucket heading entirely if all its options are suppressed.

Render in plain text using this structure:

```
**⚡ Act**
- Bulk-create draft valuations — open the runner across all companies that need one

**📊 Analyze**
- _(if final or draft bucket non-empty)_ Dig into a specific holding — compare approaches, see comp multiples, check DLOM
- _(if final bucket non-empty)_ Which holdings are most overdue for a refresh?
- _(if new-events bucket non-empty)_ How does the new round for {first company in new-events bucket} affect our valuation?

**📤 Export**
- _(always)_ Export portfolio SOI
```

Company names in Analyze are pulled directly from the bucket lists —
use real names from the data, not placeholders.

Close with one line: "What would you like to do?" and wait for the
user's reply (free text or named action). Step 2.4 routes all replies.

After the "What would you like to do?" line, add one inline note (no section heading, no bullet):

> 💡 I can also show the individual fund-level holdings breakdown for any company with a final valuation — say "show fund holdings" to see it.

### Step 2.4: Route the reply

Route based on the user's free-text reply or named action from Step 2.3:

- **Act — run/refresh valuations** (e.g. "refresh", "continue drafts",
  "run first valuations", "re-value stale", "bulk", "run them all",
  "do the ones that need it", bucket-scoped phrases like "just the
  drafts", "the no-val ones", named companies, row numbers) → start
  the bulk runner immediately. Read `references/md-table-runner.md`
  inline:
  - An unscoped reply ("refresh", "bulk", "run them all", "do the ones
    that need it") follows from Step 0, the picker view.
  - A reply that names companies, a bucket or row numbers follows from
    Step 1, so the scope the user gave reaches the plan without being
    asked for again (the view opens with nothing ticked). Route it via
    Step 3.3's intent routing table in `references/bulk/bulk-runner.md`
    (read it inline).

- **Act — dive into one** (e.g. "dig into", "take a closer look",
  "dive in", a single company name) → go to **Step 2.5 (dive into one)**
  for that company.

- **Analyze** (e.g. "which are most overdue", "how does the round affect
  valuation", "compare approaches", "what's the status", questions about
  specific holdings) → answer using data already in context from Step 3.2.
  Fetch additional detail as needed. After answering, re-present Step 2.3's
  menu.

- **Export — SOI** (e.g. "export SOI", "download SOI") → a schedule of
  investments isn't built here. Say so in one line and leave it there —
  don't assemble one by hand out of the dashboard data, and don't offer
  the valuation ledger as a substitute. Then re-present Step 2.3's menu.

- **Fund holdings** → the **global interrupt** (Step F1 uses the Final
  bucket when no company is named).

---

## Step 2.5: Dive into one (single-company entry)

Reached from:
- **Routing / firm selection** matched a single named company.
- **The *dashboard-on-screen* or *no-dashboard* fork** routed a company name.
- **Step 3.4** confirm resolved to exactly 1 company.
- **Bulk run results** — the user typed "dive into {company}" or "dive into
  the {company} valuation and {step}" after a bulk run. Take the candidate context from that company's
  `bulk_results` entry, skip Step 2.5a's `list:projects` lookup, and after
  the recap start on the step. See `references/bulk/bulk-results.md` Step 3.

There is **no mode picker** — do not ask "run autonomously vs. work on
it myself." Show the recap, then answer what the user asks.

**Company dashboard or history requests.** When the user asks for the
company's dashboard or its historical valuations rather than one valuation
("show me Meetly's dashboard", "Meetly's valuation history"), open the
company page in the dashboard MCP App (**Page navigation**), and don't ask
which valuation to work on. Resolve a
valuation and go on to Step 2.5a only when they then pick one.

### Step 2.5a: Recap (where the candidate stands)

Once the candidate is resolved, leave the view where it is: open its page
only if the user asks to see it (**Page navigation → Which page to open**).
After an action on it succeeds, the turn offers the page.

Resolve the candidate context (`project_id`, `candidate_id`,
`valuation_id`) from `list:projects`. With several projects, ask which
one, unless the user already named it.

**Capture the target type.** The `list:projects` response carries a
`target` object with `id` and `kind` per project. Hold the resolved
project's `target.kind` (one of `CORPORATION`, `LLC_ISSUER`, `LLC_ENTITY`)
and `target.id` in context: `cap-table-review.md` branches on the kind,
and the LLC path uses `target.id` as the issuer id. **Allocation does not
branch on it** — `allocation.md` Gate 0 decides what to offer.

**Stop here when `target.kind` is `LLC_ENTITY`** (deprecated; no flow
supports it). Don't route onward. Say one line and return control:

> "**{company}** is an entity type we no longer support for valuations.
> Open it in Carta if you need to look at it there."

Everything after this point assumes `target.kind` is `CORPORATION` or
`LLC_ISSUER`.

**When `list:projects` returns zero projects**, the holding has no
valuation yet — not an error. Never surface the gateway's generic "EMPTY
RESPONSE … BEST EFFORT" warning, here or as a caveat on other data. Use
the dashboard's `isLlc` / `llcIssuerId` for the target, skip the
candidate reads below, recap what you know, and route as normal.
Cap-table review still works for an LLC (it needs no candidate); the
candidate-scoped flows (financials, approaches, comps, GPC, allocation,
finalize) need a valuation first — offer `create-val.md`.

Then silently call `get:valuation`, `get:approaches` and `get:financials`
(the Financials line needs period data), and render a short recap:

> Here's where **{company}**'s {valuation date} valuation stands:
> - **Approaches:** {approach list with weights} — {how they were set, e.g. "copied from the prior valuation"}
> - **Company value:** {companyValue} — {one-line note if an approach is contributing $0 / dragging the value}
> - **Financials:** {populated / all periods blank — note the DLOM impact if blank}
> - **Cap table:** {accessible / not accessible on this candidate}
> - **Status:** {Draft / Final}

No link in the recap (**No dashboard links**). Keep it to these lines; omit one only if it
genuinely doesn't apply.

Follow the recap with the **valuation summary checklist** (Step 2.5c).

### Step 2.5b: Route the user's request (no wizard)

After the recap, wait for the user and route their free-text request to
the matching individual flow. Do **not** push a "where would you like to
start?" menu and do **not** prompt "ready for the next step?" — answer
what they asked, then return control.

As you route, open the valuation's page in the dashboard MCP App only when
the user directly asks to see it (**Page navigation**). A request that
changes the valuation leaves the view where it is, and the turn ends by
offering to open the updated valuation (**Writes**).

| User intent (examples) | Flow to read inline |
|---|---|
| "review the cap table", "show holders", "ownership %" | `references/dive-in/cap-table-review.md` |
| "review financials", "show revenue", "what's the EBITDA", "refresh financials", "enter / add / work on the financials" | `references/dive-in/financials-review.md` (enter, add or work on → its Step 0 offers import from Carta, entry in chat, or entering them manually in the financials view) |
| "I'll enter the financials manually", "let me type in the financials myself", "show me a form / table to enter financials" | `references/dive-in/edit-financials-view.md` — opens the financials view for the user to fill in. Takes precedence over the `financials-review.md` row for any request to enter the financials by hand. |
| "let me enter the inputs for the methods", "I want to type in the GPC / post-money / custom value myself", "I'll set the weights myself", "manually set the weighting", "let me weigh the methods" | `references/dive-in/methodology-edit-view.md` — opens the methods table for the user to fill in. Takes precedence over the `set-approaches.md` row for any request to enter method inputs or weights by hand. |
| "set approaches", "change methodology", "use GPC / M&A / post-money / backsolve", "Custom Value", "manual EV", "set the company value to {N}" | `references/dive-in/set-approaches.md` |
| "find comps", "update comps", "add a peer", "drop {ticker}" | `references/dive-in/comps.md` |
| "run GPC analysis", "recommend multiples", "set the 75th percentile", "quartile stats" | `references/dive-in/gpc-analysis.md` (requires `gpc` enabled; if not, read `set-approaches.md` first) |
| "work on Backsolve", "run backsolve", "select a backsolve share class", "solve for equity value", "override the backsolve value", "make an equity adjustment", "adjust the equity value" | `references/dive-in/backsolve/backsolve.md` (requires `backsolve` enabled; if not, read `set-approaches.md` first — an override/adjustment request on an already-computed candidate enters directly at that file's Step 5) |
| "how is the backsolve calculated", "explain the backsolve math", "how do we arrive at this value", "walk me through the backsolve numbers", "how does backsolve work", "how is the equity value derived", "show me the formulas", "show me the math" | `references/dive-in/backsolve/backsolve-explained.md` (only enter on explicit "explain / how is it calculated / show me the formulas" phrasing — do NOT enter for requests to configure or run backsolve) |
| "create an Excel spreadsheet for the backsolve", "export backsolve to Excel", "give me the backsolve in a spreadsheet" | `references/dive-in/backsolve/backsolve-excel.md` — the file writes directly into the current sheet when Claude for Excel is active and says so plainly otherwise |
| "run waterfall / OPM / CSE", "allocate to share classes", "compute holdings value" | `references/dive-in/allocation.md`, for every target kind. Its Gate 0 decides which methodologies to offer; don't call `get:configuration` here or for any other row. Requires a positive EV; if zero or negative, say so and route to `set-approaches.md`. Pass `valuationId` along with the usual ids. |
| "add another scenario", "create a Version 2", "what if {X}" | `references/dive-in/add-candidate.md` |
| "create a new valuation", "start a Q2 valuation", "new valuation as of {date}" | `references/dive-in/create-val.md` |
| "draft audit notes", "produce the audit memo" | `references/dive-in/audit-notes.md` |
| "view / read the valuation commentary", "add / edit / update the commentary", "write a note explaining this valuation", "clear the commentary" | `references/dive-in/commentary.md` |
| "upload/attach a document", "add the DCF workbook", "list documents", "what's attached to this valuation", "download a document", "get me the backsolve file" | `references/dive-in/documents.md` |
| "goal seek", "tune the EV to {target}", "open the GPC dashboard" | Solving backwards from a target value isn't something this skill does. Say so plainly in one line, then offer what it can do: set the company value directly (`references/dive-in/set-approaches.md`, Custom Value) or work the GPC multiples by hand (`references/dive-in/gpc-analysis.md`). Don't invent a solver, and don't iterate multiples yourself trying to land on the number. |
| "show fund holdings", "fund breakdown" | The **global interrupt** (top of Routing). |
| "finalize", "mark as final", "ship it" | `references/dive-in/ship.md` (requires a positive EV and holdings value — verified inline) |
| "delete this valuation" | `references/dive-in/ship.md` → **Delete a valuation** (requires an explicit `YES` before the call). |
| "I'm done", "let's move on", "back to the list", "back to the results" | Leave this valuation: stop the Step 2.5c checklist. If the user came from a bulk run and asks for the list, re-show it refreshed (`references/bulk/bulk-results.md` Step 4). Otherwise ask what they'd like to do next. |
| Anything else | Answer from the recap / current state, or ask one short clarifying question. |

Every flow except create-val needs a selected candidate; allocation and
finalize need a positive EV. Explain a failed dependency in plain words.

### Step 2.5c: Valuation summary checklist (every response)

Render this markdown checklist after the Step 2.5a recap, then again at the
**end of every response** while the user is working on this valuation. That
includes responses from inside a dive-in flow (comps, financials,
allocation…), so the user never loses track of what's left.

Always render it **inside a fenced code block** (plain ```` ``` ````, no
language tag), so it shows as a boxed, monospaced panel set apart from the
chat text, the same treatment as the bulk runner's Step 5 status table.
Markdown doesn't render inside the block, so use no bold or links there.
It has three parts: the values (no heading), **Inputs:** and **Next steps:**.
Pad the labels so the values line up in one column:

````
```
MangoCart, Inc. summary

• Company value    -
• Holdings value   -

Inputs:
[ ] Financials (Required)
[ ] Comparables (Required)

Next steps:
[ ] Calculate GPC
[ ] Run allocation
```
````

Once values and inputs are in place (a GPC 60% / M&A 40% blend in EUR, to
show one Calculate item per method and that the currency comes from the
valuation):

````
```
Acme GmbH summary

• Company value    €48,200,000
• Holdings value   €6,150,000

Inputs:
[x] Financials (Required)
[x] Comparables (Required)

Next steps:
[x] Calculate GPC
[x] Calculate M&A
[x] Run allocation
```
````

A Custom Value valuation requires neither input, so neither is marked
`(Required)` and its **Next steps:** are `[ ] Set custom value`, then
`[ ] Run allocation` (Post-money: `[ ] Set post-money value`):

````
```
IMIM summary

• Company value    €10,000
• Holdings value   -

Inputs:
[ ] Financials
[ ] Comparables

Next steps:
[x] Set custom value
[ ] Run allocation
```
````

- **Company value** is End Goal item 4 and **Holdings value** is item 5.
  They are plain bullets (`•`), never checkboxes. Show the current value
  next to the item, or `-` when it's zero or negative (same exception to
  the **Table values** rule as the bulk results table: on a draft, zero or
  a debt-only negative means the value isn't set up yet).
  Format it in the valuation's currency
  (`get:valuation` → `currencyCode`); with none, show the bare number (see
  **Currency default**).
- **Selected methodology** comes from `get:valuation` too: the approaches with
  `isUsed: true` on the standard scenario (the `scenarios[]` entry whose `id`
  equals `standardScenario.id`). The method items' values need
  `get:approaches` (`approachValues`), which `get:valuation` doesn't carry.
- **Inputs:** always lists **Financials** then **Comparables**, whatever the
  methodology. Add ` (Required)` after each one the selected methodology
  requires, from **Required inputs by methodology** (End Goal). `[x]` when
  it's filled in (the **filled-in** rules there), `[ ]` when not, required
  or not. The two are independent: `(Required)` comes from the table alone,
  never from whether the input is filled in. A Backsolve valuation with
  financials in place shows `[x] Financials`, with no `(Required)`.
- **Next steps:** lists, in this order:
  1. one **method item** per selected methodology, in the API's order (see
     below);
  2. **Run allocation**, last, for every methodology.

  `[x]` when done, `[ ]` when not. The section always shows, because every
  methodology has at least a method item and Run allocation.
- **Run allocation** is `[x]` when the standard scenario's
  `allocation.isCompleted` is `true`, `[ ]` otherwise. It carries no value
  text, with one exception: `[ ] Run allocation   Failed` when an
  allocation attempt on this valuation failed earlier in the session. Never
  infer it from the holdings value: a fixed-value holding such as a
  convertible note gives a holdings value before any allocation has run.
- **Method items.** One per approach with `isUsed: true`. `[x]` when that
  approach has produced a positive value: `get:approaches` →
  `approachValues.{key}.value` > 0 (`gpc`, `ma`, `dcf`, `backsolve`,
  `postMoney`, `otherIndicationOfValue`, …). Zero or negative, e.g. GPC
  with no comps left holding only its debt adjustment, is `[ ]`. Label them
  by what the user does:

  | Approach key | Item |
  |---|---|
  | `gpc` | Calculate GPC |
  | `dcf` | Calculate DCF |
  | `ma` | Calculate M&A |
  | `backsolve` | Calculate Backsolve |
  | `asset` | Calculate Asset |
  | `investedCapital` | Calculate Invested capital |
  | `otherIndicationOfValue` | Set custom value |
  | `postMoney` | Set post-money value |
- **Re-fetch before every render. Trust the API, not the session.** In one
  parallel batch, silently call `get:valuation`, `get:approaches`,
  `get:financials` and `get:comparables`. Both inputs always show, so both
  are always fetched. The
  checklist must show what the user just changed: Comparables flips to
  `[x]` in the same response that saves the comps. Never re-render it from
  values held over from an earlier turn. Reads already made in the same
  response count (e.g. the Step 2.5a recap's), as long as no write came
  after them.
- Put nothing else in it: no status or cap table. The
  six-item ✅/⏳ view is still what "what's left?" / "am I done?" gets (see
  **How to use the goal**). Show that view in place of this checklist in
  the same response, not in addition to it.
- **Stop rendering it** only when the user leaves the valuation: they say
  they're done ("I'm done", "back to the list", "let's move on"), switch to
  another company, or start a different flow (dashboard, bulk runner). A
  global interrupt such as Fund Holdings hands control back to this
  valuation afterwards, so the checklist picks back up.

### Step 2.5d: Allocation complete: offer the review download

When the checklist's **Run allocation** step is `[x]` on a **DRAFT** valuation,
tell the user they can download the valuation for review before
finalizing. Put it directly under the checklist:

> ✅ Allocation is complete. Before you finalize, you can download this valuation for review: on this valuation's page in Carta's valuations dashboard, choose **Actions → Export PDF** (or **Export Excel**).

No link.

- **Once per valuation per session.** Show it the first time the item is
  `[x]`: right after an allocation run (`references/dive-in/allocation.md`
  Step 9 / N6), or on entering a draft whose allocation is already complete.
  Don't repeat it on every later checklist render.
- **Skip it for a FINAL valuation.** Its report was already rendered when
  it was finalized.
- **The download happens in Carta.** This skill has no command that exports
  a draft (the report is only rendered on finalize). So never say "I'll
  download it" or offer to fetch the file. Point at the Actions menu.
- The Actions menu is on the valuation's page.
- Keep **Finalize** as a later, separate step the user asks for.

---

## Step 3.2: Load and render the portfolio dashboard

Used by Step 2.2 and the bulk runner's Step 3.

Fetch all pages fresh:

1. Call `read_tool({"name": "portfolio_valuations__list__portfolio_dashboard", "arguments": {"organizationId": "<org_pk>", "page_size": 100, "raw": false}})`
   for the first page.
2. While `companies.length < totalCompanies`, call again with a `cursor`
   (or `page`) param from the previous response until you have all companies.
3. Merge all `companies` arrays from every page response into one array.
   Do **not** render the dashboard until the last page is received.

Each page response shape:
- `companies` — portfolio companies in this page. Each item has:
  `name`, `corporationId`, `isCartaCorporation`, `hasCorpCapTable`,
  `hasCorpCapTableAccess`, `isLlc`,
  `llcIssuerId` (present only for LLC targets — the issuer id used as
  the cap-table `issuerId`),
  `latestValuation` (nullable — fields: `date`, `status`, `approaches`,
  `companyValue`, `holdingsValue`),
  `newFinancingRound` (nullable — fields: `shareClassName`, `cashRaised`,
  `closingDate`, `initialClosingDate`, `postMoney`),
  `newTenderOffer` (nullable — fields: `date`, `endDate`, `price`,
  `currencyCode`),
  `newShareTransfer` (nullable — fields: `date`, `operationType`,
  `quantity`, `pricePerShare`).
- `totalCompanies` — total count of portfolio companies.

If all `companies` entries are non-Carta, surface and stop:
> "**{firm_name}** has no Carta-managed portfolio companies yet. Add
> companies in Carta and come back."

#### Classify each company

**Events sections are independent** — a company can appear in multiple events sections
simultaneously if it has more than one event type. Each events section includes every
company where the condition holds, regardless of what other events that company has.

**Valuation and status groups are mutually exclusive** — assign each company to exactly
one of these based on the first condition it meets (priority order):

| Label | Condition |
|---|---|
| Draft valuation | `latestValuation != null && latestValuation.status == "DRAFT"` |
| Final valuation | `latestValuation != null && latestValuation.status == "FINAL"` |
| No valuation | `(hasCorpCapTable == true && latestValuation == null && hasCorpCapTableAccess == true) \|\| (isLlc == true && latestValuation == null)` |
| No cap table access | `hasCorpCapTable == true && hasCorpCapTableAccess == false` |
| No cap table | `hasCorpCapTable == false AND isLlc == false` |

**Events sections** — rendered independently, each showing all companies matching its condition:

| Section | Condition |
|---|---|
| Recent financing rounds | `latestValuation != null && newFinancingRound != null` |
| Recent tender offers | `latestValuation != null && newTenderOffer != null` |
| Recent share transfers | `latestValuation != null && newShareTransfer != null` |

> **LLC companies (`isLlc == true`) are always eligible.**: ignore `hasCorpCapTable` and `hasCorpCapTableAccess` entirely — they use `llcIssuerId` instead of a corp cap table. If they have a `latestValuation`, they fall into the events groups or valuation groups as normal. If they have no valuation, they go directly to the No valuation group regardless of cap table fields.

The No cap table group is **never rendered in the table**.

#### Render the dashboard as a grouped markdown table

Render as a grouped, numbered table. **Assign row numbers only to
companies in the events groups and valuation groups** — these are actionable.
The No cap table access group is shown without row numbers. Row numbers run as
a single sequence across all actionable groups. Only render non-empty groups;
precede each with a bold section label using the label name only
(e.g. **Recent financing rounds**, **Draft valuation**) — do not include group numbers.

**Valuation groups** (Draft valuation, Final valuation) columns: `#`, `Portfolio Company`,
`Latest Val. Date`, `Status`, `Approach`, `Company Value`, `Holdings Value`.

**No valuation** group columns: `#` and `Portfolio Company` only. Do not include valuation columns.

In the `Portfolio Company` cell, suffix the name with `[C]` if
`isCartaCorporation == true` (e.g., `MangoCart, Inc. [C]`).

**Recent financing rounds** — render as its own table with columns:
`Portfolio Company`, `Round`, `Cash raised`, `Post-money`, `Closing date`, `Initial close`.
Format cash raised and post-money with B/M/K suffix. Use `shareClassName` for Round,
`cashRaised`, `postMoney`, `closingDate`, `initialClosingDate` from `newFinancingRound`.

**Recent tender offers** — render as its own table with columns:
`Portfolio Company`, `Date`, `End date`, `Price`, `Currency`.
Use `date`, `endDate`, `price`, `currencyCode` from `newTenderOffer`.
Format price with B/M/K suffix.

**Recent share transfers** — render as its own table with columns:
`Portfolio Company`, `Date`, `Type`, `Quantity`, `Price per share`.
Use `date`, `operationType`, `quantity`, `pricePerShare` from `newShareTransfer`.
Format quantity with locale comma separators; format price per share as a decimal number.
Show `—` for price per share when null (non-sale transfers).

Companies in events sections **also appear in their valuation group** (Draft or Final)
with normal row numbers — the events tables are separate sections, not a replacement.

**Approach signals** — after all events tables, if any company appears in one or more events
sections, print an approach signals block headed **Approach signals:**. One line per company,
listing **all events present** and the recommended approach based on the event with the
**latest date**. If dates tie, financing round takes precedence over secondary market events.

Event → approach mapping:

| Event | Date field | Recommended approach |
|---|---|---|
| `newFinancingRound` | `closingDate` (fall back to `initialClosingDate`) | Post-Money — note the postMoney EV |
| `newTenderOffer` | `date` | Backsolve |
| `newShareTransfer` | `date` | Backsolve |

Backsolve can be created in bulk; only its transaction price is set
afterward (bulk-runner Step 6.3). Never say it "can't be created
in bulk".

Format each line as:
*{Company} — {all events with dates} → **{Approach}** (latest event: {event type}, {date})*

Example:
> **Approach signals:**
> - IMIM [C] — new financing round ($62.5M, 2018-03-02) → **Post-Money** (latest event: financing round, 2018-03-02)
> - Meetly [C] — tender offer (2020-01-10) + share transfer (2020-02-15) → **Backsolve** (latest event: share transfer, 2020-02-15)
> - Acme Corp — new financing round ($50M, 2026-01-15) + tender offer (2026-04-01) → **Backsolve** (latest event: tender offer, 2026-04-01)

**No cap table access** group — render as a single comma-separated line of company names
(no table). After the list, add the note plus the request-access link
built per `references/deep-link.md` **Cap table access request page**:
*"Cap table access required — request it from the company, or create a
pro-forma cap table."*
[Request cap table access]({cap table access request URL})

Sort within each group:
- Events groups (Recent financing rounds, Recent tender offers, Recent share transfers): alphabetical by company name
- Valuation groups (Draft valuation, Final valuation): newest `latestValuation.date` first
- No valuation: alphabetical by company name
- No cap table access: alphabetical

Format amounts with a B/M/K suffix (12.5M, 8.0M, 1.2B), with the currency
symbol only when the data names a currency (see **Currency default**). Show
`—` for any unavailable column.

After all group tables, print a legend line:
> *[C] = Carta company*

Then, if any companies have `hasCorpCapTable == false AND isLlc == false`, print:
> *{N} companies have no cap table and are not shown. To run
> valuations for these companies, a pro-forma cap table must be
> created first. Ask me to list them if you'd like to see them.*

#### Derive bucket lists for Step 3.3 (silent)

After rendering, silently capture four derived lists into context —
these power Step 3.3's prose suggestions:

- **New events** — companies appearing in any events section (Recent financing rounds, Recent tender offers, Recent share transfers). A company with multiple event types is counted once.
- **Draft** — companies in the Draft valuation group (draft valuation in progress, no new events).
- **No valuation** — companies in the No valuation group (no valuation yet, accessible cap table).
- **Final** — companies in the Final valuation group (final valuation, no new events).

The No cap table access and No cap table groups are never included in any bucket.


