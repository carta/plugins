# Gate 0 and Step 0 — surface check, cache probe, greeting

The two things that run on **every** invocation: the surface check, and Step 0's
argument capture, local cache probe and greeting.

**Steps 1 and 2 are the BUILD path and live in [firm-lookup.md](firm-lookup.md).**
Read that file only when Step 0.2 classifies a **MISS**, or when
`<FORCE_REFRESH>` was set. A warm or soft cache hit skips both steps and goes
straight to Step 2.5, so on those runs the BUILD path is never needed.

Splitting them is deliberate: Step 0 is marked *always*, so anything beside it
is re-read on every warm reopen — including the MCP firm lookup and the ManCo
picker that a warm reopen has no use for.

> Steps referenced here that are documented elsewhere: **Steps 1 and 2** → [firm-lookup.md](firm-lookup.md); **Step 2.75** → [budget-ingest.md](budget-ingest.md).

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

