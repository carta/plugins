---
name: carta-waterfall-modeling
description: >
  Run a waterfall (allocation) against a portfolio company in the investor firm
  context. TRIGGER, "run a waterfall", "create an allocation", "exit scenario",
  "exit distribution", "who gets paid if...". Firm context only; access is controlled server-side.
  Use instead: carta-explore-data for read-only fund/investment/valuation data —
  this skill MODELS exit waterfalls/allocations (who gets paid on exit), it does
  not pull existing data.
version: 0.2.3
model: sonnet
user-invocable: true
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - execute_office_js
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.46.0</carta-plugin>

# Waterfall Modeling

Run a waterfall against a portfolio company and present the distribution.
v1 is firm-context only. After the results, the user can optionally update their
firm's holding values from the run — offered only when the options contract
returns a save command.

## Rendering — read the spec first (non-negotiable)

Before printing any table, read the rendering doc mapped to that command and
render from it — don't free-hand columns from memory. Map (extend as commands
are added):

| Command | Rendering doc |
| --- | --- |
| `waterfall_modeling:get:niagara_results` | `references/rendering.niagara_results.md` |
| `waterfall_modeling:get:core_results` | `references/rendering.core_results.md` |
| `portfolio_valuations:get:llc_cap_table_summary` | `references/rendering.llc_cap_table_summary.md` |
| `portfolio_valuations:get:llc_liquidation_preferences` | `references/rendering.llc_liquidation_preferences.md` |
| `portfolio_valuations:get:llc_interest_vesting_schedule` | `references/rendering.llc_interest_vesting_schedule.md` |
| `cap_table:get:cap_table_by_share_class` | `references/rendering.cap_table_by_share_class.md` |
| `cap_table:get:cap_table_by_stakeholder` | `references/rendering.cap_table_by_stakeholder.md` |
| `cap_table:get:rights_and_preferences` | `references/rendering.rights_and_preferences.md` |
| `cap_table:get:note_blocks` | `references/rendering.note_blocks.md` |
| `cap_table:get:grant_vesting` | `references/rendering.corp_vesting_schedule.md` |
| `cap_table:get:certificate_vesting` | `references/rendering.corp_vesting_schedule.md` |

If the user wants a different format, honor it, but read the spec first.

**Read references on demand, and only what applies.** Each reference file is pulled in
by the step that names it — never read a file a step hasn't pointed you to. A results run
reads only its own `results.<noun>.md` + `rendering.<noun>.md`, never another command's;
the cap-table detail docs, `inputs.md`, `follow-up.md`, and `excel-output.md` are each
read only when their step calls for it.

The flow is:

1. Resolve firm + portfolio company.
2. Fetch the **options contract** for that company → returns `run_command`,
   `get_command`, `cap_table_command` (when available), and `available_inputs`.
3. Collect inputs from the user.
4. Dispatch via `run_command` → returns `{execution_id}`.
5. **When `cap_table_command` is available** — show the cap table for the root
   issuer as of the waterfall date, pause on a light prompt, then continue to
   results. Otherwise skip straight to results — this company's cap table isn't
   available yet.
6. Read the command's results doc (`references/results.<get_command noun>.md`) and
   run its fetch + render + follow-up cuts. The backend polls the engine on the
   first call; breakpoints ride that first call and allocations page **lean**
   (`include_breakpoints: false`) thereafter.

## Surface — chat vs Excel

Detect once, up front, without asking the user: if a writable Excel workbook is
open (Claude for Excel), `<SURFACE>` is `excel`; otherwise `chat`. `excel` is
never a false positive — in `chat` there is no workbook to write to.

- `chat` (default) — render everything inline, exactly as Steps 6a.5 and 6
  describe. No change.
- `excel` — after the company is resolved (Step 2) and **before** fetching
  options (Step 3), announce the workbook **exactly once** — never repeat it
  later in the run — naturally, in one line: _"I'm working in your open workbook
  **{name}** — I'll write the cap table and results to tabs there once the run
  completes."_ Do **not** add a preamble, narrate meta, or dump internal state
  (see UX rules). Then write the cap table and results to
  workbook tabs instead of rendering inline (Steps 6a.5, 6). Reads and writes go
  through the Excel host's workbook tools. Data calls (options, run, results, cap
  table) use the **same MCP tools as chat, called directly** — do NOT write or run
  Python/code to call them (the Carta tools are not bridged into the code sandbox),
  and never narrate tool-runtime mechanics.

**Excel — strict fetch/write order.** In `excel`, Steps 6a.5 and 6 fetch in a specific order and
write **once** (see **§Excel — fetch & write order** in the command's results doc; mechanics + tab
layouts in [`references/excel-output.md`](references/excel-output.md)).

Everything up to rendering — context, options, input collection, the run — is
identical on both surfaces. Only the **output** of Steps 6a.5 and 6 forks.

## Dispatching commands — call `call_tool` directly, never search

Every command below is dispatched through `call_tool`. It loads **lazily** — it
won't appear in your tool list, but it exists. **Invoke it directly by its exact
name; do NOT search for it first** (no generic/BM25 tool search — that's the
thrash to avoid). Derive `<SERVER>` from any visible Carta tool (e.g.
`mcp__carta_sandbox__welcome` → `carta_sandbox`), then call:
`mcp__<SERVER>__call_tool({"name": "<command with ':' → '__'>", "arguments": {…}})`.
If you genuinely must search, use the connector's own `mcp__<SERVER>__search_tools`,
never the generic BM25 search.

## UX rules

- **ENUM inputs are bounded — never offer free text.** When an option has
  `input_type == "ENUM"`, the choices presented are exactly the
  `choices[].label` values. Do not add "Other", "Type your own", or any
  free-text escape hatch. The user picks one of the presented choices or
  cancels. (Required for correctness — the API rejects non-canonical
  values; free-text mapping isn't always unambiguous.)
- **Don't narrate implementation details.** Do not explain how you derived
  `target_kind`, `target_id`, `owner_kind`, `owner_id`, UUIDs vs
  integers, or any internal resolution logic. Do not echo "Locking: target_id: X, target_kind: Y", and
  **never print a "key facts locked" / "I have everything needed to run" status
  dump** listing the firm, issuer id/UUID, the input catalog, or command names.
  These are machinery the user doesn't need to see. If you must confirm a
  pick, confirm by **company name only** — not by ID.
- **Never name the engine or the commands.** `run_command`, `get_command`, and
  `cap_table_command` are opaque tokens. The user must never see "niagara",
  "core", or any `domain:verb:noun` command string (e.g.
  `waterfall_modeling:compute:waterfall`) — not in the BLUF, headers, follow-up
  prompts, or any plan/status narration.
- Everything Claude surfaces to the user comes from the backend
  (`get:options` catalog, run + results responses). Never invent option
  names, enum values, or field values. If a value is missing from the
  response, render `—` and say the API did not return it.
- Responses from this flow are **snake_case** (e.g. `allocated_proceeds`,
  `percentage_of_total`, `grand_totals`). Read field paths literally.

## Error handling

Never auto-retry: `404` / `403` / `501` stop; `502` / `504` prompt first, then retry the **same
call**. These recur across steps — don't restate them per step:

- `403` → permission denied; stop. The body carries a specific reason as `{error, message}` (same
  shape as the coded errors below). Surface `message` verbatim — it's curated and client-safe — and
  never show the raw `error` code. Branch on `error` only for a next step: `no_investment_reach` →
  offer to pick a different portfolio company (back to Step 2). A bare `403` (no reason body) →
  "permission denied for this action"; stop.
- `404 target_not_found` → the target couldn't be found or reached; stop. (A different 404 from
  `target_not_configured_for_waterfall`, which is the no-model case.)
- `501 waterfall_route_not_supported` → this waterfall isn't supported yet; stop.
- `502 target_lookup_failed` → _"Couldn't look up the issuer right now — the upstream data feed
  didn't respond. Want me to retry?"_

Each step below adds only its own codes.

## Step 1 — Firm context preflight

Call `list_accounts` and `list_contexts`.

- **Firm already active** → `AskUserQuestion`:
  _"Work with **{firm_name}**?"_ — options: "Yes, continue", "Pick a
  different firm".
- **No firm active**:
  - One firm on the account → auto-select and tell the user.
  - Multiple firms → `AskUserQuestion` with one option per firm.
  - Zero firms → stop and tell the user.
- **Not in firm context at all** → stop:
  > "Waterfall modeling runs in the context of an investor firm. Switch to
  > a firm context and try again."

Match the firm name from `list_contexts` to the account entry from
`list_accounts` to resolve the integer **org_pk** (the number in the
`organization_pk:<n>` id). `list_contexts.firm_id` is a Snowflake UUID —
NOT the integer the portfolio commands expect.

## Step 2 — Resolve the waterfall target

List the firm's waterfall targets:

```
call_tool({"name": "waterfall_modeling__list__firm_waterfall_candidates", "arguments": {
  "owner_kind": "FIRM",
  "owner_id":   "<org_pk integer from Step 1>"
}})
→ { candidates: [ { id, kind, name } ] }
```

`owner_id` = the integer **org_pk** from Step 1, never the `list_contexts.firm_id` UUID (it 404s).
The response returns every candidate in one call (no paging). **Empty `candidates`** → tell the
user the firm has no waterfall targets and stop.

If the user already named a target, match it by `name` against `candidates`. Otherwise render the
list as a markdown table:

| #   | Target            | Type       |
| --- | ----------------- | ---------- |
| 1   | Acme Corp         | Corp       |
| 2   | Evergreen Fund II | LLC        |
| 3   | Project Titan     | Deal Group |

- **Type** by `kind`: `CORE_COMPANY` → "Corp", `LLC_INTEREST_ISSUER` → "LLC",
  `CORPORATION_DEAL_GROUP` → "Deal Group".

Present names only, never ids. Let the user pick by number or name and confirm the pick. A paper or
churned target may still lack a waterfall model — if so, `get:options` in Step 3 returns 404 and we
stop there.

When the user picks, capture and **lock** for the rest of the flow:

- `target_kind` = the chosen row's `kind`.
- `target_id` = the chosen row's `id`.
- `name` (for user-facing copy only).
- `owner_kind` = `"FIRM"` and `owner_id` = the org_pk from Step 1 — the firm owner, sent on every call.

Do not re-derive these later. If the user wants a different target, restart from Step 2.

## Step 3 — Fetch the options contract

Always call this before the run — never hardcode option names or command
strings:

```
call_tool({"name": "waterfall_modeling__get__options", "arguments": {
  "owner_kind":  "FIRM",
  "owner_id":    "<org_pk from Step 1>",
  "target_kind": "<locked from Step 2>",
  "target_id":   "<locked from Step 2>"
}})
```

Response fields (**every `*_command` is an exact MCP command string — convert `:` to `__`
and pass as the `name` field to `call_tool`; never rewrite or shorten it**):

- `run_command` — the command to dispatch the run in Step 5.
- `get_command` — the command to fetch results in Step 6.
- `cap_table_command` — **optional**; the independent cap-table reader (Step 6a.5),
  fetched by the root issuer + as-of date — **not** coupled to the run. Step 6a.5 dispatches
  on its noun to the matching renderer; an unrecognized noun or `null`/absent → skip the
  cap-table step.
- `save_command` — **optional**; updates the firm's holding values from the run's results
  (offered in the Step 6 follow-up menu). May be `null` or absent — when so, omit the
  update option from the follow-up menu.
- `available_inputs[]` — one entry per input the run accepts. Each entry:
  - `option` — the **body key** to send in Step 5 (e.g. `"EQUITY_VALUE"`).
  - `label` — short human-readable name (e.g. "Equity value"). Show this
    to the user.
  - `description` — longer human explanation. Show this as helper text.
  - `input_type` — one of `DECIMAL | INTEGER | ISO_DATE | ENUM | STRING`.
    Drives how Step 4 collects and formats the value.
  - `required` — boolean. If `true`, you must collect a value.
  - `default` — present for non-required inputs; pre-fill.
  - `choices` — present only when `input_type == "ENUM"`. Each entry has
    `label` (show) and `value` (send).
- `is_multi_entity` — boolean. Rely on this to detect a multi-entity ownership
  structure; it's `true` whether the user picked the root or a non-root sub-entity.
- `root` — `{issuer_id, issuer_kind, name}`. The resolved top-level entity the
  waterfall runs against; **present for every supported target** (equal to the
  picked entity when you picked the root; `null` only for the rare not-yet-supported
  standalone corporation). Used **only** to fetch the cap table (Step 6a.5) — the run
  (Step 5) and results (Step 6) always use the picked `target_id` locked in Step 2.
  Root display name = `root.name` when set, else the picked company name.

Cache `run_command`, `get_command`, `cap_table_command` (if present),
`save_command` (if present), `is_multi_entity`, `root` (if present), and the
catalog for the rest of the flow. **Do not re-call `get:options` mid-flow.**

**Announce the multi-entity structure before collecting inputs.** When
`is_multi_entity` is `true`, print one sentence before Step 4 — e.g. _"This is a
multi-entity structure — proceeds are distributed from the top-level operating
entity, **{root display name}**, and flow down through the ownership chain."_
Announce for **both** ME cases, including when the user picked the root.

**Error handling** (stop, do not retry automatically):

- `404 target_not_configured_for_waterfall` → tell the user this company has no waterfall model
  configured, and stop.
- Shared: `403`, `404 target_not_found`, `501 waterfall_route_not_supported`, `502 target_lookup_failed` — see §Error handling.

## Step 4 — Collect inputs from the user

Walk `available_inputs` by each entry's `input_type` / `required` (don't hardcode option
names); collect **required inputs first, then optional**. **Read
[`references/inputs.md`](references/inputs.md) when you reach this step** — it holds the
collection order & method, the per-`input_type` formatting table
(DECIMAL/INTEGER/ISO_DATE/ENUM/STRING), the ENUM label/value rules, and the
**`EQUITY_VALUE`** special case (ask in plain prose, **never** `AskUserQuestion`; never
suggest a value). Build the `options` dict (each entry's `option` field → collected/mapped
value), then go to Step 5.

## Step 5 — Dispatch the run

**Pre-run review.** Before dispatching, echo the resolved inputs back once
and confirm via `AskUserQuestion` ("Run it" vs "Change a value"): the
company name, `EQUITY_VALUE` as formatted currency, `WATERFALL_DATE` as
ISO, and any non-default optionals by their `choices[].label`. If the user
changes a value, re-collect just that input (Step 4) and re-confirm.

On confirm, dispatch via the `run_command` from Step 3:

```
call_tool({"name": "<run_command with all ':' replaced by '__'>", "arguments": {
  "owner_kind":  "FIRM",
  "owner_id":    "<org_pk from Step 1>",
  "target_kind": "<locked from Step 2>",
  "target_id":   "<locked from Step 2>",
  "options":     { /* built from Step 4 */ }
}})
```

`owner_kind`, `owner_id`, `target_kind`, `target_id`, and `options` are the
required arguments — never omit `options` (its inputs vary, but the key is
always sent).

Response: `{"execution_id": "<string>"}`. Lock `execution_id` for the
rest of the flow.

The dispatch is fast — it does NOT wait for the engine to finish. The
first `get_command` call in Step 6 is what waits on completion.

**Error handling** (this step):

- `400 invalid_target_id` → stop and surface the message.
- `502 waterfall_dispatch_failed` → "Couldn't kick off the waterfall — the request was rejected.
  Want me to try again?" Retry uses the same body.
- Shared: `403`, `404 target_not_found`, `501 waterfall_route_not_supported`, `502 target_lookup_failed` — see §Error handling.

### Running several scenarios at once (same company + date)

The user may ask for **several** equity values on the **same date** — low/base/high cases, or a
row of exit values from their spreadsheet. Confirm the set once (the list of values + the one
shared date), then run them as a batch: dispatch each value (Step 5) and render each run's results
(Step 6). Fetch and show the cap table **once** for that `(target, date)` — the once-per-batch
reuse rule (in the cap-table detail doc for the active noun, §Step 6a.5) handles this; never
re-fetch or re-print it per value.
Different dates → each date is its own cap table (fetched once).

## Step 6 — Fetch and render results

Dispatch by the `get_command` noun: read that command's results doc and execute its
fetch loop, BLUF, allocations render, and follow-up cuts. **Read ONLY that doc and the
`rendering.<same noun>.md` it points to — never another command's results or rendering
files.**

| `get_command` noun | Results doc |
| --- | --- |
| `niagara_results` | [`references/results.niagara_results.md`](references/results.niagara_results.md) |
| `core_results` | [`references/results.core_results.md`](references/results.core_results.md) |

The results doc reaches back here for the shared pieces below: the cap table
(§Step 6a.5), the formatting rules, the single-entity BLUF, and the follow-up menu
([`references/follow-up.md`](references/follow-up.md)).

### Step 6a.5 — Cap table (only when available)

**Gate on `cap_table_command`** (cached from Step 3). Absent or `null` → skip: one short line —
_"The cap table isn't available for this company yet."_ — then go to the results fetch; don't elaborate.
Otherwise **dispatch on its noun** to the matching detail doc, and **read that doc when you reach
this step**:

| `cap_table_command` noun | Detail doc |
| --- | --- |
| `llc_cap_table_summary` | [`references/cap-table.llc.md`](references/cap-table.llc.md) |
| `cap_table_by_share_class` | [`references/cap-table.corp.md`](references/cap-table.corp.md) |

**Scope guard:** each detail doc opens with a **Commands available via this doc** list — the only
cap-table-family commands in scope for that noun. Call only the commands the matched doc lists; never
call one that a different detail doc owns.

Any other noun → skip as above. The cap table comes **as of the waterfall date, before any
allocations** — in `chat` render it now, **before** the detail doc's light prompt (never ask first);
in `excel` **don't write it here**, hold it and write it with the results in the single write (the
results doc's §Excel — fetch & write order). Then continue to the results fetch.

### Formatting rules (shared by every rendered table + the BLUF totals)

- Currency (tables): `$X,XXX.XX` — two decimals, thousands separator.
- Currency (Excel cells): see [`references/excel-output.md`](references/excel-output.md) (USD-locked accounting format).
- Currency (BLUF only): compact, two decimals — `$1.00B` (≥1B),
  `$500.00M` (≥1M), `$12.50K` (≥1K), `$999.99` (<1K).
- Percentages: `X.XX%`.
- MOIC: `X.XXx` (two decimals, lowercase `x`).
- IRR: `X.XX%`.
- Participating Qty: integer with thousands separator.
- Null / absent values: `—` (em dash).

### BLUF lead — single-entity (`chat`)

One short sentence echoing only the run inputs — no analysis, no top
recipient, no MOIC/IRR commentary. Source values from Step 4 inputs
(the get-results response carries neither equity value nor date). Render
`EQUITY_VALUE` as compact currency per the Formatting rules above;
`WATERFALL_DATE` as ISO.

> Waterfall for **$1.00B** on **2025-06-15**, grouped by holder.

Never name a top recipient, cite %, or call out MOIC/IRR. (The multi-entity BLUF,
the allocations table, and the Excel Waterfall-tab write live in the command's
results doc.)

### Follow-up prompt

After rendering the holder table (or, in `excel`, after writing the **Waterfall**
tab), present the follow-up menu and run the chosen action per
[`references/follow-up.md`](references/follow-up.md) — the **surface-specific
menu** (you **must** call `AskUserQuestion` with every option for the surface,
never in prose, never collapsed) and — **only when Step 3 returned `save_command`**
— the update-holding-values action (confirm-then-post, anchored on the run
identity). The cut handlers (BY_TYPE / firm-holdings / breakpoints) live in the
command's results doc. **Read that file when you reach this step**, and repeat the
menu after each action until the user is done.

## Do NOT

At-a-glance recap; each rule is stated in full where it applies above.

- **Don't invent** option names, command strings, or result fields.
- **Don't show raw enum values** — use `label`, map back to `value` when sending.
- **Don't re-call `get:options`** mid-flow — fetch once, reuse.
- **Don't pass `raw`** on results calls.
- **Don't mix target context** — restart Step 2 to change company.
- **Don't coerce silently** — confirm currency + date first.
- **Don't auto-retry** — 404 / 403 / 501 stop; 504 / 502 prompt first.
- **Don't branch on engine name** — dispatch via `run_command` / `get_command`.
- **Don't run more than one scenario** unasked; batch multi-value-at-one-date runs.
