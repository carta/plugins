# Gate 0, Gate 1, and Step 0 — greeting, surface check, hosted hand-off, cache probe

On **every** invocation: the greeting's opening line and the surface check (Gate 0) — a
sandboxed surface exits there, before any of the rest. On a **local surface**: Gate 1 — an
invocation that itself asks for the hosted app gets the link and exits there too. Every other
local invocation (the normal case) goes straight on to Step 0's argument capture and local
cache probe, and the rest of the greeting, with no question in between. Leading with the opening line means the
reader has an answer to "what is this going to do" on screen while the checks behind it run,
rather than a silent pause before anything appears.

**Steps 1, 1.5, and 2 are the BUILD path and live in [firm-lookup.md](firm-lookup.md).**
Read that file only when Step 0.2 classifies a **MISS**, when `<FORCE_REFRESH>` was set, or
when Gate 1's "Hosted, firm named" branch resolves a firm outside the BUILD path proper (its
own paragraph says which pieces of Step 1 it borrows and which it skips). A warm or soft cache
hit skips all three steps and goes straight to Step 2.5, so on those runs the BUILD path is
never needed.

Splitting them is deliberate: Step 0 is marked *always*, so anything beside it
is re-read on every warm reopen — including the MCP firm lookup, the ManCo
eligibility gate, and the ManCo picker that a warm reopen has no use for.

> Steps referenced here that are documented elsewhere: **Steps 1, 1.5, and 2** → [firm-lookup.md](firm-lookup.md); **Step 2.75** → [budget-ingest.md](budget-ingest.md).

## Step 0.0 — Say hello first, before any check runs

**The very first thing you output, before any tool call** — before Gate 0's
surface check, before Step 0.1's argument capture, before anything else.

Output `SKILL.md`'s "Step 0.0 — Say this first, verbatim, before any tool
call" paragraph exactly as written there — that copy is the one you already
have in context without reading anything, which is the whole point. Do not
paraphrase or summarize it, and do not reach for this file to find it: by the
time you'd read this sentence, the paragraph should already be on screen.

Issue Gate 0's first tool call in the **same assistant message** as this
paragraph, so the check starts without waiting on a round-trip — the reader
gets the opening line at the same moment the check begins, not after it.

## Gate 0 — Surface check (runs right after the opening line)

**There is no Bash tool in this session at all** (claude.ai chat, or another surface with
none) → skip the uv prerequisite below and everything else in this gate — none of it can run
without Bash. Go straight to the **`surface=sandboxed`** branch below, including its
hosted-or-not check; if the invocation asks for hosted, treat that branch's "Open the hosted
app" step as the gate-file-unreadable case, which that section's "If that file can't be read"
sentence covers. A Bash tool that IS present but whose
`detect-surface` call fails ("No such file", a bad path) is a different case, covered further
down where `detect-surface` is actually run.

### Prerequisite — ensure `uv` is installed

Every script this skill runs is `uv run <script>`, starting with the surface
check immediately below. Most engineers already have `uv`; an external user
opening this dashboard for the first time often doesn't, and has no reason to
know what it is. Installing software on someone's machine is their call, so
when `uv` is missing, ask once in plain words before installing — never
install it without a yes.

Each command below is a single simple command — no `||`, `&&`, `|`, `;`, or
`{ }`. The two `--version` checks are pre-approved `allowed-tools` entries;
the install commands are not, so Claude Code also shows its own permission
prompt for them after the user says yes below. A compound line bundling several of these with shell operators is **not**
equivalent and must never be substituted in its place: the permission
matcher checks every simple command a compound line decomposes into
independently, so a rule written for the whole compound line doesn't
pre-approve any of its pieces, and the run stalls on a permission prompt.
Run these one at a time, in order, stopping at the first one that succeeds:

```bash
uv --version
```

Succeeds → `<UV_BIN>` is `uv`, skip straight to the "Immediately after" note
below. Fails (not found) → try:

```bash
$HOME/.local/bin/uv --version
```

Succeeds → `<UV_BIN>` is the literal, unexpanded text `$HOME/.local/bin/uv`
(so it matches this skill's pre-approved commands and never puts a
home-directory path in the transcript). Fails too → `uv` isn't installed
yet. Ask before installing it — one `AskUserQuestion` call with exactly
this input. The question goes inside a `questions` array; `question`,
`header` and `options` are never top-level fields:

```json
{
  "questions": [
    {
      "question": "This dashboard needs uv, a small free tool that runs its Python scripts. It isn't installed yet. Install it now? It goes in ~/.local/bin and doesn't need admin rights.",
      "header": "Install uv",
      "multiSelect": false,
      "options": [
        {"label": "Install uv", "description": "Download and install uv from astral.sh, then continue."},
        {"label": "Not now", "description": "Stop here. You can install uv yourself and run this again."}
      ]
    }
  ]
}
```

This is the only question Gate 0 asks, and it comes only when both
`--version` checks fail — never when `uv` is already present. **Ask it at
most once per run.** The answer is final: never re-ask it, rephrase it, or
ask a follow-up ("Are you sure?", "Try another installer?"), whatever you
read afterward.

**"Not now" (or any answer other than "Install uv")** → reply with this one
line and stop — no further tool calls, no `Read` of errors.md, no second
question. Don't install, don't retry, don't suggest another installer:

> No problem. When you're ready, install uv from https://docs.astral.sh/uv/getting-started/installation/ and ask for the dashboard again.

**"Install uv"** → install it with these two commands, each run on its own:

```bash
curl -LsSf https://astral.sh/uv/install.sh -o /tmp/uv-install.sh
```

```bash
sh /tmp/uv-install.sh
```

(On Windows, when `curl`/`sh` aren't available, one command instead of those
two: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`.)

Astral's installer drops the binary at `$HOME/.local/bin/uv`, which a fresh,
non-interactive shell may not have on `PATH` yet — so **don't assume `uv run`
resolves after this runs.** Immediately after, re-run the `$HOME/.local/bin/uv
--version` check above once. It succeeding means `<UV_BIN>` is the literal
`$HOME/.local/bin/uv`, exactly as above. It failing means the install didn't
land a usable binary: treat it as an install failure (below).

Hold whichever value resolved as `<UV_BIN>` in working memory for the rest of
this invocation, and use it in place of every literal `uv` in every `uv run
<script>` command this skill or its reference files show from here on
(`manco_paths.py`, `build_manco_datadir.py`, `parse_budget_workbook.py`,
`inspect_workbook.py`, `parse_coa_mapping.py`, `save_query_result.py`) — the
same substitution discipline this file already applies to `PLUGIN_ROOT`
below. Never print `<UV_BIN>`; it's infrastructure, not something they asked
about. Past the approval question above, don't narrate the install either.

If the install commands themselves fail (offline, blocked download, no write
access), follow [errors.md](errors.md)'s "`uv` isn't installed" entry: one
identical retry of the same two commands, then — if it still fails — the one
plain-English line pointing at the uv install docs, and stop. Do not try a
different installer, a different URL, or ask the user again how to proceed.

**SILENT from here on** — zero further user-facing output in this step,
unless the surface turns out to be sandboxed (below). The next allowed
output is Gate 1's hosted reply (only when the invocation asked for the hosted
app) or 0.3's continuation of the greeting. Do NOT output any text after
this check, including phrases like "Surface is local — safe to continue",
"Checking local cache", "Now checking the local dashboard cache for…",
"Surface is local, proceeding silently to Step 0.2's cache probe", or any
other narration of what is happening — **announcing that you're about to
be quiet is not the same as being quiet, and is exactly as forbidden as any
other sentence here.** Between this check and 0.3 (or Gate 1's hosted
reply), a tool call is the whole turn — issue it and say nothing, not
even a single confirming word.

**If the Bash tool itself is present but the command fails** — wrong path,
missing file, permission denied, anything short of a `"surface": "..."`
verdict — that is not a sandboxed result (there's a Bash tool here to retry
with; the no-Bash-tool case above, at the top of this gate, is the one that
is), and it's the same environment-failure case [errors.md](errors.md)
covers for every other script this skill calls. Retry it once, silently,
with no text before or after the retry — **the
identical command, byte for byte.** Do not vary it: no swapping in an
explicit `CLAUDE_PLUGIN_ROOT=<value>` prefix, no substituting a hardcoded or
derived absolute path in place of `${CLAUDE_PLUGIN_ROOT}`, no trying a
`uv run` vs `python3` variant — each of those is a second *different* attempt
dressed up as a retry, and none of them are yours to invent. A retry that
then returns a verdict is handled exactly as if it had returned that verdict
the first time — same silence, same next step.

**If the identical retry fails the same way too**, one narrow fallback
applies before giving up — narrow because it uses nothing you derived or
reconstructed yourself. Every skill invocation opens with a line the harness
prints for you, before Gate 0 ever runs: `Base directory for this skill:
<path>`, where `<path>` is always `<plugin_root>/skills/carta-manco-reporting`.
That line is handed to you, not guessed — it's a different thing from the
banned move above, which is about inventing a path from unrelated context
(an earlier tool result, a remembered install location, anything
plausible-looking).

Check for it now, before any further tool call: scan this invocation's own
opening turn — not this reference file's own text, which mentions the line
only to describe it — for a literal line starting `Base directory for this
skill:`. **No such line this invocation → no third attempt, full stop.**
Go straight to the escalation below; a second identical failure is already
the end of the line here. Found it → strip its trailing
`/skills/carta-manco-reporting` to get `PLUGIN_ROOT`, and retry
`detect-surface` a third time — still silently, still no text before or
after — substituting `PLUGIN_ROOT` for `${CLAUDE_PLUGIN_ROOT}` in that one
command only.

If that third attempt returns a verdict: handle it exactly as if the first
attempt had returned it, and **keep `PLUGIN_ROOT` in working memory for the
rest of this invocation.** Every later script call this skill makes
(`build_manco_datadir.py`, `parse_budget_workbook.py`, `inspect_workbook.py`,
`parse_coa_mapping.py`, `save_query_result.py`, `serve.py`) substitutes that
same `PLUGIN_ROOT` for `${CLAUDE_PLUGIN_ROOT}` too, directly, without
repeating this retry-then-fallback sequence at each one — `${CLAUDE_PLUGIN_ROOT}`
already failed twice in this session, so there's no reason it resolves later.
Never write `PLUGIN_ROOT` to a file, never mention it to the user, never
print it — it stays exactly as silent as the retry it stands in for.

Only if that third attempt fails the same way as the first two — or the
`Base directory for this skill:` line was never printed this invocation —
does errors.md's escalation apply: one plain-English line about what's
actually wrong, and nothing else in that message or after it — never the
path or cache directory it failed on, never a menu of technical workarounds
to choose from, and never `AskUserQuestion` for how to proceed. The fix
(reinstall, update, re-run) is the user's to trigger, not yours to attempt
on their behalf inside this session.

Step 5 launches `serve.py`, which binds `127.0.0.1` and opens the user's default
browser. That only works when Claude Code runs on the user's own machine. In a
cloud session — Cowork, or a Claude Code cloud session (Claude Desktop can run
sessions in the cloud, which is the default) — the server runs inside a remote
container the user can't reach, so the dashboard URL goes nowhere. Don't proceed
there.

**Right after 0.0's opening line — before any cache scan, MCP call, or the
rest of the greeting — run the uv prerequisite above, then this, and route on
it:**
```bash
<UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/manco_paths.py" detect-surface
```
- `"surface": "sandboxed"` → **stop immediately.** Do **not** scan caches, resolve a
  firm, touch the MCP, or launch `serve.py`.

  Check whether the invocation itself asks for the hosted app — it says "hosted" or
  "online", or pastes the bare hosted-app URL (the same check Gate 1 uses below). Give the
  hosted app's URL only in that case; otherwise don't mention it at all.

  - **Hosted asked for** → **Open the hosted app** with **https://manco-reporting.carta.cloud**
    (see "Open the hosted app" below), then reply with this message (substance verbatim), then
    end the turn:
    > **Carta hosts this dashboard** at **https://manco-reporting.carta.cloud** — sign in with
    > Carta and pick your firm, with nothing to build.
    >
    > - **Key Metrics, Monthly P&L, and Management Fee Income** by fund
    > - **Budget vs Actuals**, with journal-entry drill-downs
    > - Carta's own budget shows there automatically. A budget imported from your own
    >   workbook reaches the hosted app through this skill's local workflow.
    >
    > **→ Open it now: https://manco-reporting.carta.cloud**

    If the invocation named a firm, add one line to that reply, after the "Open it now" line:
    "You asked about **\<firm\>** — pick it from the firm chooser when the app opens, or use
    **Switch firm** if it opens a different one." (No deep link here: a sandboxed session does
    not reliably have the MCP.)
  - **Hosted not asked for** (the default) → Do **not** open the hosted app, and do **not**
    mention its URL. Reply with this message (substance verbatim), then end the turn:
    > This session is running in the cloud, where a local dashboard can't reach your browser.
    > To build the ManCo dashboard and import your own budget workbook from Excel, you need
    > Claude Code running on your computer — open it there and ask, "open the ManCo dashboard
    > for `<firm>`".

    If the invocation named a firm, substitute it for `<firm>` in that line.

  This is a graceful exit. Do **not** retry `detect-surface`, do **not** try to launch
  anyway, and do **not** fall back to another surface or tool. (Opening the hosted link in
  the in-app browser is not a fallback; where it's given, it's part of this reply.)
- `"surface": "local"` (the normal case) → continue to **Gate 1** silently. Do not
  output any text — proceed directly with a tool call and nothing else.

An explicit `MANCO_REPORTING_SURFACE=local|sandboxed` env var overrides both
signals above (tests / unusual installs).

### Open the hosted app

**The bare link is `https://manco-reporting.carta.cloud`** (`manco_paths.py`'s
`HOSTED_APP_URL`) — every "the bare link" below means this.

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-in-app-browser.md` (the plugin's own
`references/`, not this skill's; do not search for it) and follow it to set
`browser_family`, then its "Open a link" section to open the hosted link. If that file can't
be read, skip opening and give the reply with the link — never stop. Either way, the link
goes in the reply text itself: a terminal session has `browser_family: none`, so the reply is
the only way the user reaches it.

## Gate 1 — Hosted hand-off, only when asked (local sessions only)

Reached only on `"surface": "local"` — a sandboxed session never reaches here (Gate 0 already
exited). A local session builds and opens the local dashboard by default: **never ask the user
whether to run hosted or local.** Take the hosted hand-off below only when the invocation
itself asks for the hosted app — it says "hosted" or "online", or pastes the bare hosted-app
URL. Anything else, a pasted Carta firm URL/UUID included, → **Local**.

This check runs **before** Step 0.1 captures `<FIRM_NAME_INPUT>`/`<FIRM_ID_HINT>` and before
Step 1 runs over MCP for the BUILD path proper — both still apply to a hosted hand-off exactly
as Step 0.1/Step 1 state them, just reached from this earlier point. Carta hosts this dashboard
at the bare link (see "Open the hosted app" above); the user signs in there and the hosted
app's own firm chooser (or its `?firm=` query param — see [DEPLOY.md](../DEPLOY.md)'s "Which
firm opens") picks the firm, so the hosted path needs no local cache.

- **Hosted, no firm named** → **Open the hosted app** with the bare link, then reply with it
  and end the turn: "Open **https://manco-reporting.carta.cloud** in your browser, sign in
  with Carta, and pick your firm." Do **not** scan caches, touch the Carta MCP, or launch
  `serve.py`.
- **Hosted, firm named** (name, or a pasted Carta firm URL/UUID) → resolve the firm's
  canonical name and uuid the same way Step 1 does ([firm-lookup.md](firm-lookup.md)),
  capturing `<FIRM_NAME_INPUT>`/`<FIRM_ID_HINT>` as Step 0.1 does: identify `<SERVER>` by the
  tool-list scan (never call `welcome`), then call
  `mcp__<SERVER>__list_contexts(firm_name="<FIRM_NAME_INPUT>", _instrumentation_v2={...})` (or
  `firm_id=`/`firm_uuid=` for a pasted URL/UUID) and apply Step 1's clean-match rule — but
  **without `AskUserQuestion`** on an ambiguous or fuzzy result, and **never `set_context`**,
  which would change the user's active firm for no reason here. If the match leaves no single
  firm, or no Carta MCP is connected at all, fall back: **Open the hosted app** with the bare
  link, then reply with it plus Gate 0's **Switch firm** line, naming the firm as typed, and
  end the turn. Otherwise build the link:
  ```bash
  <UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/manco_paths.py" hosted-url --firm-name "<canonical name>" --firm-uuid "<firm_uuid>"
  ```
  Then check whether *this machine* has ever built this firm locally — a plain local read, no
  MCP, using the same `list-dashboards` call Step 0.2 runs moments later for a local build,
  matched by exact `firm_uuid`/`firm_carta_id` against the identity `list_contexts` just
  returned (never a name-fuzz match: `<FIRM_NAME_INPUT>` can be a pasted URL/UUID here, which
  a firm-name clean-match would never match against a cached `firm_name`):
  ```bash
  <UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/manco_paths.py" list-dashboards
  ```
  No match on this firm's `firm_uuid`/`firm_carta_id` among the cached dashboards → this
  machine has never pushed a workbook budget for this firm (a colleague's own-sync push,
  upload, or share from elsewhere isn't ruled out — this is a local-only check, not a live
  one): add one line to the reply, after the link: "This computer hasn't built **\<canonical
  name\>**'s dashboard, so no workbook budget has gone to the hosted app from here; unless one
  was added another way, it shows Carta's own budget." A match exists → say nothing extra.
  **Open the hosted app** with the link just built, then reply with it (plus the budget-data
  note when it applies) and end the turn: "Open **\<link\>** and sign in with Carta to open
  **\<canonical name\>**." Do **not** launch `serve.py`, run Step 1's eligibility gate, or
  fetch any Fund Admin data — this hand-off only resolves identity for a link.
- **Local** → continue to **Step 0.1** silently.

## Step 0 — Capture firm, check the local cache, finish the greeting (cache-first — MCP only on a miss)

Mirrors `carta-investors:carta-fund-modeling`'s "cache-first, MCP-lazy" launch
order: resolve identity and check the local cache **before** touching the
Carta MCP at all. A fresh, unambiguous cache hit reopens with no MCP call
before Step 3's actuals pull, and with none at all when Carta can't be reached
(Step 3's cached-actuals fallback) — Step 1, Step 1.5, and Step 2 below are the
BUILD path, reached only on a cache miss, an ambiguous local match, or an
explicit refresh.

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
the BUILD path below regardless of what the cache probe finds.

### 0.2 — Local cache probe (before any MCP call)

Everything here is a local dir scan + Read — **no MCP call yet.** Skip this
whole probe when `<FORCE_REFRESH>` is set (0.1) — go straight to the BUILD
continuation of the greeting (0.3) and Step 1. Otherwise, run:

```bash
<UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/manco_paths.py" list-dashboards
```

Each entry carries `firm_name`, `manco_name`, `firm_uuid`, `firm_carta_id`,
`manco_uuid`, `manco_carta_id`, `manco_entity_id`, `dashboard_dir`, `raw_dir`,
and `raw_age_days` — the age of the last completed pull, which here only
separates a warm hit from a soft one (Step 3 runs either way), persisted into `accounts.json` by the prior invocation's Step 4 build. A
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
  Step 1, Step 1.5, and Step 2 entirely — no identity lookup over the
  MCP.** Go to the
  cache-hit continuation of the greeting (0.3), then **Step 2.5**
  ([budget-ingest.md](budget-ingest.md)), and Step 3 re-pulls the actuals
  as on every run. Do **not**
  ask the "Build the dashboard for `<MANCO_NAME>`?" confirmation on this
  path — a fresh, unambiguous reopen is meant to be as instant and silent as
  a fund-modeling cache hit, which skips its own confirmation the same way.
- **Exactly one clean match, `raw_age_days` null/≥24, and every identity
  field above present** → a **soft hit**: this firm has been seen before,
  and what is stale is its DATA, not who it is. Set all seven identity
  placeholders from the entry exactly as a WARM HIT does, and **skip Step 1,
  Step 1.5, and Step 2** — resolving a firm and its entity over the MCP, and
  re-confirming eligibility, to learn what the last build already wrote to
  disk costs round trips and answers nothing. Go to the greeting's
  continuation (0.3) using the "seen before" variant, then Step 2.5 and
  Step 3, as on every run.
- **Exactly one clean match but an identity field is `null`** (a cache dir
  older than these fields) → treat as a **MISS**: the entry cannot say who
  the entity is, so Step 1/1.5/2 must.
- **Zero or multiple clean matches** → **MISS.** Go to Step 1/1.5/2 (BUILD)
  using `<FIRM_NAME_INPUT>` exactly as today.

**No firm was typed, and at least one cached dashboard exists** — offer a
**local-only** resume picker via `AskUserQuestion` (still no MCP): list up
to 4 cached `(firm_name, manco_name)` pairs, each labeled with the names and
(when available) `raw_age_days`, plus "Something else" for a new name.
Picking a row is a WARM HIT on that row (skip Step 1/1.5/2, same as above);
"Something else" (or free text) becomes `<FIRM_NAME_INPUT>` and re-enters
0.2 once — if it still doesn't resolve locally, it falls to Step 1/1.5/2 as a
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

### 0.3 — Finish the greeting (plain paragraphs, flush left)

0.0 already said the opening paragraph, before Gate 0 or the cache probe
ran. This step adds what comes after it: two more paragraphs on a first
invocation — the "here's how it comes together" paragraph, then the
branching paragraph — and one on a warm reload, the branching paragraph
only (0.2's resume picker or "which firm" ask, if either fired, sits
between 0.0's opening line and this step). Same plain-paragraph, flush-left
style as 0.0 — no Markdown blockquote prefix, matching the
`carta-investors:carta-fund-modeling` house style.

**The next paragraph runs on a first invocation only** — a MISS or soft
hit at 0.2. It describes work that is about to happen, and on a warm reload
almost none of it does: firm resolution, entity resolution and every budget
question are skipped, the fetch is only the day's actuals, and the reader
wants the link rather than an account of steps nobody is taking.

Here's how it comes together: I'll identify your firm and management
company in Carta, pull the year-to-date journal entries and fee schedules,
and — if you're bringing a workbook — read its budget lines and match them
to your Carta accounts. Where a line could mean more than one thing, I'll
ask rather than guess. Then the microapp is built and served locally, and
I'll hand you the link.

The **paragraph after that branches on 0.2's classification** — this is the
only place the cache-hit/miss distinction shows up to the user:

- **WARM HIT** — use the resolved `<FIRM_NAME>` / `<MANCO_NAME>` (not the
  raw typed text) and the freshness signal already in hand, no new lookup:

  Since a cache for **`<FIRM_NAME>`** — **`<MANCO_NAME>`** already exists
  locally, this should be quick — let me reload your dashboard with today's
  actuals.

  Do NOT append "Let me connect to the Carta MCP..." on this path — the
  actuals pull is the only MCP work left, and it needs no announcement.
- **SOFT HIT** — the firm and its entity came off disk too; only the data
  is stale:

  Picking up **`<FIRM_NAME>`** — **`<MANCO_NAME>`**. Refreshing from Carta
  Fund Admin, this takes a few seconds.

- **MISS** — nothing is resolved yet, so this paragraph is **held back
  until it is.** Emit the "here's how it comes together" paragraph right
  after 0.2 classifies the MISS, in the same message as Step 1's first MCP
  call — the reader then has text on screen while the lookups run, and they
  cost no perceived wait. Write this one after Step 2 resolves the entity —
  whether by an explicit confirmation or, on the single-ManCo firm, without
  asking one at all — as the transition into the fetch:

  Building **`<FIRM_NAME>`** — **`<MANCO_NAME>`**. This takes a few
  seconds.

  It names what was resolved rather than asking again; Step 2 owns the
  question, when it asks one at all.

That's the rest of the greeting — two paragraphs on a first invocation, one
on a reload, on top of 0.0's opening line. Do NOT append anything else
before the next step's first tool call — the last paragraph is the
transition into silent execution (either straight to Step 2.5, on a WARM
HIT, or into Step 1's first MCP call otherwise).

**Latency tip**: emit this continuation and issue the next step's first tool
call in the **same assistant message**. Do not wait for a user turn between
the two — that adds a full network round-trip of perceived latency for no
reason.
