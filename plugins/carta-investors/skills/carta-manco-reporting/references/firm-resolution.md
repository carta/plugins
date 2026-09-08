# Resolving the firm and its management company

Steps 0 through 2 in full: argument capture, the local cache probe, the
greeting, firm lookup with its match rules, and the ManCo picker.


> Steps referenced here that are documented elsewhere: **Step 2.75** → [budget-ingest.md](budget-ingest.md).

## Gate 0 — Surface check (run first, before anything else)

**SILENT** — no user-facing output in this step. Next allowed output: Step 0.3's greeting.

Step 5 launches `serve.py`, which binds `127.0.0.1` and opens the user's default
browser. That only works when Claude Code runs on the user's own machine (a local
terminal, or Claude Desktop set to run locally). In a **sandboxed** session —
**Cowork**, or a Claude Code **cloud** session (Claude Desktop can run sessions in
the cloud, which is the default) — the server runs inside a remote container the
user can't reach, and there is no local browser to open, so the dashboard URL goes
nowhere. Don't proceed there.

**Before Step 0 — before any cache scan, MCP call, or greeting — run this once and
route on it:**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/manco_paths.py" detect-surface
```
- `"surface": "sandboxed"` → **stop immediately.** Do **not** scan caches, resolve a
  firm, touch the MCP, or launch `serve.py`. Reply with this message (substance
  verbatim), then end the turn:
  > This dashboard launches an interactive web app on your own machine — a local
  > server plus your browser — so it only works in a Claude Code session running
  > locally. It can't run in a sandboxed session: Cowork, or a Claude Code cloud
  > session (in Claude Desktop, running in the cloud is the default — switch it to
  > run locally). Please re-run from a local session, e.g. "open the ManCo
  > dashboard for \<firm\>".

  This is a graceful exit. Do **not** retry `detect-surface`, do **not** try to
  launch anyway, and do **not** fall back to another surface or tool — a sandboxed
  verdict will not change on retry.
- `"surface": "local"` (the normal case) → continue to **Step 0** silently. Say
  nothing about this check — it stays quiet, like the rest of Step 0.

An explicit `MANCO_REPORTING_SURFACE=local|sandboxed` env var overrides both
signals above (tests / unusual installs).

## Step 0 — Capture firm, check the local cache, greet (cache-first — MCP only on a miss)

Mirrors `carta-investors:carta-fund-modeling`'s "cache-first, MCP-lazy" launch
order: resolve identity and check the local cache **before** touching the
Carta MCP at all. A fresh, unambiguous cache hit reopens with **zero MCP
calls** — Step 1 and Step 2 below are the BUILD path, reached only on a
cache miss, an ambiguous local match, a stale cache, or an explicit refresh.

**Do NOT call `mcp__<SERVER>__welcome`, ever.** Calling `welcome` renders the
Carta connector widget in the transcript (a large card showing plugin-check
status, role, tenure line, quick-start categories, and recommended commands)
— the exact "confusing MCP welcome experience" this skill is built to avoid.
You do not need welcome's response to proceed; the server prefix
(`mcp__claude_ai_Carta__` / `mcp__carta_production__` / `mcp__carta__`) is
discoverable from the tool namespace itself, and the first real MCP call
(`list_contexts` in Step 1, on the BUILD path) will surface any auth error
on its own.

### 0.1 — Capture args

Hold whatever came in the invocation as `<FIRM_NAME_INPUT>` (a name, or a
pasted Carta firm URL / UUID). If it looks like `app.carta.com/investors/firm/<numeric-id>/...`
or a bare UUID, capture that id/uuid separately as `<FIRM_ID_HINT>` for Step 1.

Also scan the invocation for a `--budget-workbook <path>` argument, a
pasted `.xlsx` path, or a dragged-in workbook (which arrives as
`@"<path>"` — strip the `@` and any quotes). Capture the path as `<WORKBOOK_ARG>` for Step 2.75 —
this becomes the firm's Excel budget source. If absent, Step 2.75 falls
back to a persisted `.workbook-ref.json` in the cache dir; if that is also
absent, Step 2.75a-i asks whether the firm has one, once, and remembers
the answer either way.

Also scan for a `--coa-mapping <path>` argument. Capture as
`<COA_MAPPING_ARG>` for Step 2.75. This is the client's own
Carta-COA-→-Budget-Category mapping workbook (they'll typically send it
alongside the budget workbook). Optional but strongly recommended for
firms whose workbook uses bespoke dept/category names — without it, the
Budget-vs-Actuals table can't join Carta actuals to a workbook column
whose dept label doesn't match Carta's raw REPORTING_TAGS_JSON.Department
value (a workbook column headed "Client Services" against journal
entries Carta tags as "CS", say).

Also check whether the invocation's text contains "refresh" or "fetch
fresh" (case-insensitive) — capture this as `<FORCE_REFRESH>`. It forces
the BUILD path below regardless of what the cache probe finds, the same
override Step 2.5 already applies to Step 3.

### 0.2 — Local cache probe (before any MCP call)

Everything here is a local dir scan + Read — **no MCP call yet.** Skip this
whole probe when `<FORCE_REFRESH>` is set (0.1) — go straight to the BUILD
greeting (0.3) and Step 1. Otherwise, run:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/manco_paths.py" list-dashboards
```

Each entry carries `firm_name`, `manco_name`, `firm_uuid`, `firm_carta_id`,
`manco_uuid`, `manco_carta_id`, `manco_entity_id`, `dashboard_dir`, `raw_dir`,
and `raw_age_days` — the same freshness signal Step 2.5 gates Step 3 on,
persisted into `accounts.json` by the prior invocation's Step 4 build. A
cache dir built before these fields existed reads them back as `null` —
treat that exactly like a miss (a normal BUILD re-populates it, no error).

**A firm URL/UUID was pasted (`<FIRM_ID_HINT>` set in 0.1)** — match it
against each entry's `firm_uuid` / `firm_carta_id` (exact match, no fuzzing).

**A firm name was typed** — apply the same clean-match rule Step 1 uses on
MCP results (normalize both sides: strip whitespace, lowercase, drop
`-`/`,`/`.`; a clean match is either normalized string containing the
other) against each entry's `firm_name`.

Classify the result:

- **Exactly one clean match, `raw_age_days` not null and < 24** → **WARM
  HIT.** Set `<FIRM_UUID>`, `<FIRM_CARTA_ID>`, `<FIRM_NAME>`, `<MANCO_UUID>`,
  `<MANCO_CARTA_ID>`, `<MANCO_ENTITY_ID>`, `<MANCO_NAME>` straight from that
  entry, and `<CARTA_ENVIRONMENT>` from its `carta_environment` field
  (`"production"` if that field is `null` — a pre-upgrade cache). **Skip
  Step 1 and Step 2 entirely — no MCP call.** Go to the
  cache-hit greeting (0.3), then **Step 2.5**
  ([budget-ingest.md](budget-ingest.md)), which independently re-checks the
  same `raw_age_days` signal before deciding Step 3 is skippable. Do **not**
  ask the "Build the dashboard for `<MANCO_NAME>`?" confirmation on this
  path — a fresh, unambiguous reopen is meant to be as instant and silent as
  a fund-modeling cache hit, which skips its own confirmation the same way.
- **Exactly one clean match, `raw_age_days` null/≥24, and every identity
  field above present** → a **soft hit**: this firm has been seen before,
  and what is stale is its DATA, not who it is. Set all seven identity
  placeholders from the entry exactly as a WARM HIT does, and **skip Step 1
  and Step 2** — resolving a firm and its entity over the MCP to learn what
  the last build already wrote to disk costs two round trips and answers
  nothing. Go to the greeting (0.3) using the "seen before" variant, then
  Step 2.5, which will send this run to Step 3 for the refresh.
- **Exactly one clean match but an identity field is `null`** (a cache dir
  older than these fields) → treat as a **MISS**: the entry cannot say who
  the entity is, so Step 1/2 must.
- **Zero or multiple clean matches** → **MISS.** Go to Step 1/2 (BUILD)
  using `<FIRM_NAME_INPUT>` exactly as today.

**No firm was typed, and at least one cached dashboard exists** — offer a
**local-only** resume picker via `AskUserQuestion` (still no MCP): list up
to 4 cached `(firm_name, manco_name)` pairs, each labeled with the names and
(when available) `raw_age_days`, plus "Something else" for a new name.
Picking a row is a WARM HIT on that row (skip Step 1/2, same as above);
"Something else" (or free text) becomes `<FIRM_NAME_INPUT>` and re-enters
0.2 once — if it still doesn't resolve locally, it falls to Step 1/2 as a
MISS.

**No firm was typed, and no cached dashboard exists** — ask via a single
`AskUserQuestion`: *"Which firm's management company do you want to open?"*
Free-text input. Wait for the answer, then capture it as `<FIRM_NAME_INPUT>`
and treat it as a MISS.

### Voice — second person, everywhere the user reads

`carta-investors:carta-fund-modeling` sets the house style and this skill
follows it: **"this skill…" for what the tool is, "you"/"your" for what
belongs to the reader, "I'll…" for what is about to happen.** Never "the
firm's workbook" or "their budget" — the person reading is the firm, and
writing about them in the third person reads as notes taken about them
rather than a question asked of them.

The exception is Carta's own data: *"Carta's stored budget"*, *"Carta's
marks as of…"* — that is not theirs, and saying so is the point.

### 0.3 — Emit the greeting (plain paragraphs, flush left)

Output **exactly one greeting message** as plain paragraphs — three on a
first invocation, two on a warm reload (no
leading `>` blockquote markers — flush-left black body text, matching the
`carta-investors:carta-fund-modeling` house style). This is your FIRST
substantive output — before the greeting, only an `AskUserQuestion` from 0.1
or 0.2 (if one fired) is allowed. Do NOT emit a preface like *"I'll launch
the dashboard..."* or *"Let me start by connecting..."* — the greeting
itself IS the opener.

**The first paragraph is fixed**, on every path. Preserve the paragraph
breaks (blank lines between paragraphs) but do **not** add any Markdown
blockquote prefix:

Welcome to Carta Management Company Reporting. This skill builds a local
React microapp surfacing a management company's financial picture and
budgeting processes. You can import your own budgeting workbook, so the
microapp can map that against financials in Carta for deeper budget
monitoring. You'll also have access to a dashboard covering Key Metrics,
Monthly P&L, Management Fee Income Projections, and Expense analytics
broken out by vendor and variances. Reports and charts extend to a side
panel drill downs with insights and underlying journal entry details.

**The second paragraph runs on a first invocation only** — a MISS or soft
hit at 0.2. It describes work that is about to happen, and on a warm reload
none of it does: firm resolution, entity resolution, the fetch and every
budget question are all skipped, and the reader wants the link rather than
an account of steps nobody is taking.

Here's how it comes together: I'll identify your firm and management
company in Carta, pull the year-to-date journal entries and fee schedules,
and — if you're bringing a workbook — read its budget lines and match them
to your Carta accounts. Where a line could mean more than one thing, I'll
ask rather than guess. Then the microapp is built and served locally, and
I'll hand you the link.

The **last paragraph branches on 0.2's classification** — this is the only
place the cache-hit/miss distinction shows up to the user:

- **WARM HIT** — use the resolved `<FIRM_NAME>` / `<MANCO_NAME>` (not the
  raw typed text) and the freshness signal already in hand, no new lookup:

  Since a cache for **`<FIRM_NAME>`** — **`<MANCO_NAME>`** already exists
  locally, this should be quick — let me reload your dashboard.

  Do NOT append "Let me connect to the Carta MCP..." on this path — there is
  no MCP call coming next.
- **SOFT HIT** — the firm and its entity came off disk too; only the data
  is stale:

  Picking up **`<FIRM_NAME>`** — **`<MANCO_NAME>`**. Refreshing from Carta
  Fund Admin, this takes a few seconds.

- **MISS** — nothing is resolved yet, so this paragraph is **held back
  until it is.** Emit paragraphs one and two immediately, in the same
  message as Step 1's first MCP call — the reader then has text on screen
  while the lookups run, and they cost no perceived wait. Write this one
  after Step 2's confirmation, as the transition into the fetch:

  Building **`<FIRM_NAME>`** — **`<MANCO_NAME>`**. This takes a few
  seconds.

  It names what was confirmed rather than asking again; Step 2 owns the
  question.

That's the full greeting — three paragraphs on a first invocation, two on a
reload. Do NOT append anything else before the next step's first tool
call — the last paragraph is the transition into silent execution (either
straight to Step 2.5, on a WARM HIT, or into Step 1's first MCP call
otherwise).

**Latency tip**: emit the greeting text and issue the next step's first tool
call in the **same assistant message**. Do not wait for a user turn between
the greeting and that call — that adds a full network round-trip of
perceived latency for no reason.


## Step 1 — Resolve firm via list_contexts (SILENT — BUILD path only)

Reached only when Step 0.2 classified a **MISS**, or `<FORCE_REFRESH>` was
set. A WARM HIT and a soft hit both skip this step and Step 2 entirely —
each already holds the firm and the entity from a previous build, and a
soft hit differs only in that its DATA needs refreshing.

Identify the Carta MCP server by prefix — scan the tools connected in this
session for any `mcp__<SERVER>__list_contexts` (equivalently, `call_tool` /
`set_context` under the same prefix). Most sessions surface one of
`claude_ai_Carta`, `carta_production`, or `carta`, but treat those three as
examples, not the whole set — a connector can be namespaced under any name,
including an opaque generated ID (Claude Desktop exposes Carta as a
claude.ai connector this way instead of a friendly name). Because this scan
runs at the top level of the skill, not inside a dispatched subagent, any
connected name works the same way — there's no closed allowlist to update
by hand when a new connector ID shows up. Use whichever prefix you find as
`<SERVER>` for every tool call in this step and after. Do **not** call
`welcome` to identify the server — it's not needed, and its response
renders as a widget.

If nothing matches, break silence with one plain sentence: *"The Carta Fund
Admin MCP needs to be authorized in this session — run `/mcp` and reconnect
the Carta connector, then re-invoke this skill."* Then stop.

If **two or more** distinct prefixes have connected tools at the same time, don't
silently pick one — ask via a single `AskUserQuestion`, listing the live prefixes as
options:

> "I see more than one Carta MCP connector active right now (`<PREFIX_A>`,
> `<PREFIX_B>`, ...). Which one should this session use?"

Default to `carta` if the user has no strong preference, or if asking would be
disruptive (e.g. no interactive turn is available to wait on). Once resolved — by
answer or by default — use that prefix as `<SERVER>` for every tool call in this step
and after.

**Classify `<CARTA_ENVIRONMENT>` from `<SERVER>`'s name** — served to the
dashboard's Snowplow tracker so nonprod usage isn't misattributed as
production. A name containing `test`/`sandbox`/`demo`/`preprod`/
`preproduction` (case-insensitive) → `"nonprod"`. Everything else — `carta`,
`carta_production`, any other name, or an opaque UUID — → `"production"`
(this is a customer-facing plugin, so an unclassified name is far more
likely production than a staff test session). Carry `<CARTA_ENVIRONMENT>`
to Step 4's build command.

Resolve firm identity via `mcp__<SERVER>__list_contexts`. If `<FIRM_ID_HINT>`
was captured in Step 0.1 (user pasted a firm URL or UUID), call
`list_contexts(firm_id=<FIRM_ID_HINT>)` or `firm_uuid=<...>` for an exact
lookup — skip the fuzzy name path entirely. Otherwise:

Call `mcp__<SERVER>__list_contexts(firm_name="<FIRM_NAME_INPUT>")`. **Important:** the endpoint does fuzzy/relevance matching against the caller's permission set and will return a *fallback* firm even when nothing truly matches the input token — do NOT trust the top hit blindly. Sanity-check every response as follows:

1. **Normalize** `<FIRM_NAME_INPUT>` → `<TOKEN>` (strip whitespace, lowercase, remove punctuation like `-`, `,`, `.`).
2. Compute the same normalization on each returned firm's canonical name → `<CANON>`.
3. A hit is a **clean match** iff `<TOKEN>` is a substring of `<CANON>` OR `<CANON>` is a substring of `<TOKEN>` (either direction, so `"northstar"` matches `"northstarcapital"` and `"north-star capital llc"` matches `"north-star capital"`).
4. If the top result is **not** a clean match, immediately retry with two more casing/spelling variants in a single parallel batch:
   - `list_contexts(firm_name="<original casing>")` (the raw input)
   - `list_contexts(firm_name="<TOKEN with hyphens preserved but capitalization flipped>")` — e.g. `North-Star` → `North-star`
   - `list_contexts(firm_name="<TOKEN with hyphens removed>")` — e.g. `North-star` → `Northstar`
5. Merge the three response sets, dedupe by firm ID, and re-apply the clean-match check.
6. **Narrow out fund/SPV entities sharing the firm's name.** Carta Fund Admin
   onboards each fund and SPV as its own `firm_id` too, and `list_contexts`
   carries no type/kind field to tell those apart from the actual firm —
   confirmed live against sandbox: searching `firm_name="Unusual Ventures"`
   cleanly matches the firm itself *and* eight sibling entities, including
   `"Unusual Ventures Fund III, L.P. for itself and as nominee for Unusual
   Ventures Investment Partners Fund III, L.P."` and `"UNUSUAL VENTURES FUND
   II, L.P."` — a fund/SPV's legal name almost always embeds the parent
   firm's name as a substring, so the clean-match rule in step 3 alone
   cannot separate them. Before classifying, check whether any clean match
   is an **exact** normalized match (`<CANON>` equals `<TOKEN>`, not merely
   a substring of it):
   - **At least one exact match exists** → drop every clean match that is
     not exact. A fund's expanded legal name is never identical to the bare
     firm name a user types, so this reliably clears the fund/SPV noise
     without a name-pattern blacklist (`"L.P."`, `"LLC"`, `"Fund"`, …) that
     could just as easily hide a firm legitimately named e.g. "Acme Capital
     Management, LLC". Classify only the exact-match survivors below.
   - **No candidate is exact** (the typed name is itself a partial/fuzzy
     variant, e.g. `"north-star"` for `"North-Star Capital"`) → keep the
     full clean-match set as-is; narrowing only helps once a true anchor
     exists.

Then classify the narrowed clean-match set:

- **Exactly one clean match** → set `<FIRM_UUID>`, `<FIRM_CARTA_ID>`, `<FIRM_NAME>` (canonical name from the response, not the user's input).
  Proceed to Step 2 without asking: the endpoint only returns firms the
  caller is permissioned for, so one clean match is already unambiguous.
- **Multiple clean matches** → present up to 4 candidates via `AskUserQuestion`, one per option; user picks. If more than 4, take the top 4 and add a fifth "None of these — retype" option.
- **Zero clean matches but non-empty fuzzy results** → do NOT silently accept a fuzzy fallback. Present the top 3 fuzzy results via `AskUserQuestion` with the framing *"No firm exactly matched '<FIRM_NAME_INPUT>' — did you mean one of these?"* plus a "None of these — retype" option. Only proceed once the user picks.
- **Zero results across all variants** → tell the user *"No firm found matching '<FIRM_NAME_INPUT>'. Want to try a different name?"* and re-prompt via `AskUserQuestion`.

Then `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>)` to activate the firm.


## Step 2 — Resolve ManCo entity (BUILD path only)

**SILENT** apart from the entity question below — no narration of what is being resolved.

Reached in the same cases as Step 1 (a MISS, or `<FORCE_REFRESH>`) — never
on a WARM HIT or a soft hit, both of which already know the entity.

Call `mcp__<SERVER>__call_tool(name="fa__list__entities", arguments={})`.

A firm's entity list is mostly funds. `fa__list__entities` returns
`Fund`, `GP Entity`, `Management Co`, `SPV`, `Elimination Entity` and
`Holding` together, and this dashboard reports on a management company —
so **never offer the raw list**. Funds and SPVs are not answers to this
question, and putting them in a picker invites a choice that produces an
empty dashboard.

Filter to `entity_type_string == "Management Co"` (or
`entity_type_enum == 4`):

- **Exactly one ManCo** → hold it and confirm below.
- **Multiple ManCos** → `AskUserQuestion` over **those ManCos only**.

**Hold the full response** — Step 3 persists it to `<raw_dir>/entities.json`
(raw_dir isn't resolved until Step 2.5). It's the only source of each fund's
own `carta_id`; a JE's own `FUND_CARTA_ID` column doesn't exist.

**Zero ManCos** → fall back to `GP Entity` (`entity_type_enum == 2`).
Some firms book management-company activity on their GP entity and carry
no separate ManCo, and the dashboard reads the same way for either.

- **Exactly one GP entity** → hold it and confirm below.
- **Multiple GP entities** → `AskUserQuestion` over those.
- **Neither** → say so and offer the only move left, rather than stopping
  on a dead end: *"`<FIRM_NAME>` has no management company or GP entity in
  Carta Fund Admin, so there is nothing for this dashboard to report on.
  Want to try a different firm?"* — `AskUserQuestion`, and a yes re-enters
  Step 1.

Set `<MANCO_UUID>`, `<MANCO_CARTA_ID>`, `<MANCO_ENTITY_ID>` and
`<MANCO_NAME>` from whichever entity was resolved.

### Confirm the entity before fetching

Two gates, in order: **the firm, then the entity under it.**

Step 1 is the firm gate and already asks only when it needs to — one
clean match the caller is permissioned for proceeds straight here, since
`list_contexts` matches against the caller's own permission set. Nothing
below re-litigates the firm.

This is the entity gate, and it **always runs on a build** — whether one
entity was found or several. Step 3 is a long fetch, and this is the last
cheap place to catch a wrong entity; a dashboard built on the wrong one is
wrong in every figure, under this skill's own name.

It does **not** run on a warm or soft cache hit. Both reopen an entity a
previous run already confirmed, and re-asking on every reload is the
question that teaches a reader to stop reading questions.

**Exactly one management company** → confirm it:

> **Build the dashboard for `<MANCO_NAME>`?**
> `<FIRM_NAME>` · `<entity type>`

Offer *"Yes, build it"*, *"No — different entity"* (re-open the list for
this firm) and *"No — different firm"* (back to Step 1).

**Several management companies** → the picker is the confirmation:

> **Which management company under `<FIRM_NAME>`?**

One option per ManCo, plus *"None of these — different firm"*.

**Any GP-entity fallback** → always ask, whether one was found or several.
This is a substitution, not a resolution: the reader asked for a management
company and would be shown something else, and that must not pass as a
detail.

> **`<FIRM_NAME>` has no management company in Carta Fund Admin. Build
> your dashboard on its GP entity, `<MANCO_NAME>`?**

Offer *"Yes, build it"* and *"No — pick a different firm"* (back to Step 1).

**Naming the firm.** Firm names are not unique in Carta — one client name
matched four distinct firms in a real run — so `<FIRM_NAME>` alone may not
say which firm this is. Disambiguate with the entity's own
`_links.web_url`, linking the firm name, rather than printing a raw Carta
ID at the reader: an internal identifier is the kind of thing the Carta UX
rules keep out of user-facing copy, and a link answers the same question by
being clickable.

The three ManCo identifiers are different numbers on the same entity and are
not interchangeable — take each from the field named here, never derive one
from another:

| Placeholder | Field on the `fa__list__entities` row | Used by |
|---|---|---|
| `<MANCO_UUID>` | `uuid` | the DWH queries' `FUND_UUID` filter |
| `<MANCO_CARTA_ID>` | `carta_id` | in-product Carta URLs |
| `<MANCO_ENTITY_ID>` | `id` | `fa__get__cash-balance`'s `entity_ids` |
