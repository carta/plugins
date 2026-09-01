---
name: carta-issuance
description: >-
  Issue securities on a Carta cap table. Use when the user asks to issue
  certificates, stock certificates, option grants (ISO, NSO, EMI, CSOP,
  Unapproved, Startup Concessions, Non-Concessional, ZEPO), to draft
  shares or grants, or to resume issuing from a draft set. USE WHEN the
  user says "issue", "grant", "draft", "award", "give equity", "give
  shares", "give stock", "create a certificate", "create a grant", "set
  up an option grant", "issue equity to a named person", or names any specific
  security type above. Also USE WHEN the user points at a spreadsheet, CSV,
  Carta import template, or a grant/award document as the source of the
  issuance ("issue the grants in this file", "here's our import template").
model: inherit
allowed-tools:
  - AskUserQuestion
  - Skill
  - Read
  - Write
  - Bash(uv run *)
  - Bash(mkdir *)
  - Bash(cp *)
  # Bash(find *) deliberately NOT granted — the renderer probe it existed for is
  # gone. Environment detection reads the tool surface, not the disk.
  - Bash(cat *)
  - Bash(test *)
  - Bash(ls *)
  # In prose and examples, `mcp__carta__*` is a placeholder for the session's actual
  # Carta server prefix (Step 2a). These permission entries are literal — leave them.
  - mcp__carta__fetch
  - mcp__carta__mutate
  - mcp__carta__list_accounts
  - mcp__carta__welcome
  - mcp__visualize__show_widget
  - preview_start
  - preview_list
  - preview_eval
  - preview_screenshot
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

# Issue Securities

Walk an admin from raw input to issued certificates or option grants on a Carta cap table.
Those two are the **only** security types this skill issues.

| Flow | Example prompts |
|---|---|
| Certificates | "Issue 1 cert for Jane Doe, 1000 Series A at $1.50." · "Draft 5 founder certs on Acme." |
| Option grants | "Issue 1000 ISOs to Jane at $1.50 on the 2024 Plan." · "Draft 10 ISOs for new hires." · "Issue an EMI grant — 2000 options at £0.50." |
| Spreadsheet / file | "Issue the grants in ~/Downloads/Q3-hires.xlsx." · "Here's our import template — issue these certs." · "Draft the grant in this signed award agreement." |
| Resume | "Resume draft set 472." · "Continue the 'Q2 hires' draft set." |

To **fix** an already-issued certificate or grant, that's `carta-modify-issuables`, not this
skill.

**Out of scope** — stop and route to the Drafts UI in the Carta app for RSUs, SARs, CBUs,
warrants, convertibles, SAFEs, convertible debt, and for custom legends, vesting,
acceleration, or exercise periods:

> *"This skill issues certificates and option grants today. For \<thing\>, use the Drafts UI in the Carta app."*

Carta's own import template has sheets for several of those, so an uploaded workbook routinely
contains rows this skill can't issue. [Phase 0.25](#phase-025--ingest-an-uploaded-file) skips
them and reports the count — never reshape an RSU row into an option grant to make it fit.

## Architecture — one engine, two surfaces

The transaction is identical everywhere; only the surface that collects and reviews it varies.

- **The engine** is this file: resolve `security_type` → fetch reference data → assemble rows →
  `save_drafts` / `validate_drafts` / `issue_securities` → recovery. It never knows which
  surface is in play.
- **The adapter** implements exactly three capabilities. Nothing else may branch on
  environment.

| Adapter | Selected when | `collectConfig` (0.5) | `showReview` (2) | `confirm` (2→3) |
|---|---|---|---|---|
| **Cowork** (primary, ~95% of usage) | `preview_start` **absent** | one `show_widget` form | chat markdown | one `AskUserQuestion` |
| **Code** | `preview_start` **present** | `render-panel` config panel | `render-panel` review panel | the panel's **Confirm & Issue** button |

**This file documents the Cowork path**, since that is nearly all real usage. If [Phase 0 Step
1](#step-1--detect-the-environment-from-the-tool-surface) selects the Code adapter, read
[code-adapter.md](references/code-adapter.md) — its **§0** lists every point where that adapter
diverges, and anything §0 does not mention behaves exactly as described here.

Read up front on every run:

- **[references/cowork-adapter.md](references/cowork-adapter.md)** — the form, the chat review,
  the confirm, and the authoritative per-block field list. Skip only if Step 1 selected Code.
- **[references/payload-reference.md](references/payload-reference.md)** — the authoritative
  field contract: types, formats, picklists, autofills, date quirks.

Both paths end the same way: the `issue_securities` mutate ([Phase 3](#phase-3--on-confirmation-run-the-mutate)).
The SDK's HITL prompt on that mutate is the final, irreversible gate — never the review gate.

---

## Hard rules

1. **The field contract lives in [payload-reference.md](references/payload-reference.md).**
   Read it before constructing any payload. No invented keys.
2. **Never mix certificate and option grant fields in one mutate.** Run the skill twice for a
   mixed request.
3. **One confirmation gate per mutate attempt** — never zero, never two stacked. On Cowork the
   gate is the `AskUserQuestion` in
   [cowork-adapter.md §3](references/cowork-adapter.md#3-confirm--one-askuserquestion); on Code
   it is the panel button, and stacking a question on an open panel suspends its submit watcher
   so the click never lands. Recovery questions after a server short-circuit are unrestricted
   on both. The SDK's HITL prompt is not this gate.
4. **Retry contract — reuse identity from the FIRST response.** `draft_set_id` from the first
   mutate goes on every subsequent `issue_securities`, `save_drafts`, `load_drafts`,
   `validate_drafts`, `resolve_duplicate_stakeholder`; omitting it makes the server auto-create
   a *second* draft set with the same incomplete rows. Each row's `draft_pk` from its first
   save goes on every retry row alongside *every* required field; omitting `draft_pk` inserts a
   new row instead of updating.
   **A timeout is not an error** — the call may have already succeeded server-side, so retrying
   with the wrong params risks a duplicate draft set or a double-issue. Read
   [payload-reference.md § Timeouts & retries](references/payload-reference.md#timeouts--retries)
   before retrying any mutate that timed out.
5. **The server is the source of truth.** Don't mirror its validation; surface its messages
   verbatim.
6. **Never delegate to a background agent.** The gates require interactive HITL.
7. **Templates only — no custom payloads** for legends, vesting, acceleration, or exercise
   periods: *"Custom \<thing\> isn't supported here. Save as draft and finish in the Drafts UI."*
8. **No id sniffing.** Required values come from user input, `cap_table:get:stakeholders` with
   `detail=full`, or a documented default — never scraped from another grant or certificate. If
   none of the three applies, ask via `AskUserQuestion`.
9. **Pre-save assertion.** Before *any* `save_drafts` or `issue_securities` call, walk every row
   and confirm each `always` field (per [Row templates](#row-templates)) holds a non-null value.
   If one is missing, recover **before** the call, in order: (a) the row template's documented
   default; (b) re-run the stakeholder lookup (`detail=full`) and re-stamp
   `issue_date_relationship` / `email` / `stakeholder_kind`; (c) `AskUserQuestion`.
   This is load-bearing because both failure modes are **silent**: `save_drafts` accepts
   incomplete rows without complaint, and at issue time a row with `stakeholder_id=null` slips
   duplicate detection, creates zero securities, and still returns success. That the server
   accepts a row is therefore never a reason to send one — **never offer to save past a missing
   `always` field, and never describe the server's tolerance to the user as an option**
   ([save-validate-flow.md § The assertion is not advisory](references/save-validate-flow.md#the-assertion-is-not-advisory)).
10. **Never ask who the grantees are before opening the collection surface.** A missing
    recipient is an empty field on the surface, never a chat question — this is the single most
    common way this skill goes wrong. Two sub-rules follow from it:
    - **A bare "N \<securities\>" is a quantity, not a headcount.** *"100 option grants"*,
      *"100 certificates"* — the server's `quantity` field counts shares/options for **one**
      recipient. With no named people and no plural-**person** language, open **one** blank
      block with `quantity` pre-filled to N (`knowns.rows = [{"quantity": "100"}]`).
    - **Only pre-render multiple blank blocks when the language counts people** — *"100
      employees"*, *"grants for 100 new hires"*, or an explicit list of names. Then build
      `knowns.rows` as that many empty dicts so the surface opens pre-sized.
    - Genuinely ambiguous (rare) → `AskUserQuestion` which one. That is a real fork, not the
      forbidden "who are the grantees" question.
    - **"Which file did you mean?" is also a real fork**, not this forbidden question — but only
      when the prompt referenced a file and [Phase 0.25](#phase-025--ingest-an-uploaded-file)'s
      search found zero or several candidates, or the workbook has more than one importable
      sheet. Never use it to ask *who* is in the file, and never in place of parsing a path the
      prompt already gave.
11. **Issue what was validated, not a copy of it.** When a draft set already holds the rows the
    user approved, [Phase 3](#first-do-you-need-a-payload-at-all) issues with `draft_set_id` and
    **no `drafts` key**. Re-sending rows makes the issued payload merely *probably* identical to
    the reviewed one — a transposed digit anywhere in it issues terms nobody approved, and no
    later gate compares the two. Send rows again only to change them, and then with each
    `draft_pk` attached.

The incidents behind these rules — including the ones that look redundant — are in
[references/incidents.md](references/incidents.md). Read it before weakening any of them.

---

## Voice & defaults

- **Explain anything the skill chose.** Tag `(default)`, `(from existing record)`, or
  `(autofill — <so_type> rule)` with a one-line explanation under the review. The review is the
  user's only chance to reject a default, so an unshown default is one they never got to see.
- **Silent defaults are computable; prompted fields aren't.** If the skill can stamp it
  (today's date, `issue_date + 10 years`, an autofill rule), stamp it and surface it tagged.
  Never ask twice.
- **Show the full text of legally binding values** (e.g. the legend body), not just the
  template name.
- **Dates display as `MM/DD/YYYY`** everywhere the user sees them. Payload formats follow
  [payload-reference.md](references/payload-reference.md).
- **Explain jargon on first use** (Rule 144 date, Section 4(a)(2), INDIVIDUAL, legend).
- **No raw ids or payload field names in customer-facing text — ever.** Not in headers, status
  lines, prompts, confirmations, or error renderings. Never write the word "ID"
  (✅ *"looking up Jane"* / ❌ *"pulling stakeholder id 12345"*), and never render `(<number>)`
  after a name. Translate payload keys before surfacing them, including when echoing server
  `banner_errors` back: humanize mechanically (`_` → space, Title Case), with the exceptions
  listed in [references/labels.md](references/labels.md).

---

## Resolve `security_type`

Resolve once, at the top. Pass on every draft-set tool call.

| Cue | `security_type` |
|---|---|
| "cert", "certificate", "shares", "Series A", "common" | `certificate` (default) |
| "option", "ISO", "NSO", "grant" (with plan), "EMI", "CSOP", "Unapproved", "Startup Concessions", "ESS", "Non-Concessional", "ZEPO" | `option_grant` |
| Ambiguous ("equity") | Ask with `AskUserQuestion` |
| Mixed in one prompt | Ask which to run first; run the other in a follow-up |
| Out-of-scope security | Route to the Drafts UI; stop |

---

## Phase 0 — Preflight

Four steps, in order, **all before any user interaction and before gathering any input.** Step
1 is free. Steps 2–4 are the only round trips this preflight may spend: one `ToolSearch`, one
connectivity check, one `list_accounts`. Phase 0.5 then spends exactly **one** more —
`issuance_init`, which carries the stakeholder lookup with it.

### Step 1 — Detect the environment from the tool surface

**Look at your own available tools.** `preview_start` present → **Code** adapter;
`preview_start` absent → **Cowork** adapter. That is the whole test: free, synchronous, and
correct in both environments, because `render-panel` cannot work without `preview_start`.

Do **not** run a Bash probe, check the filesystem, or reason about what the environment "looks
like" — the tool list is ground truth. Record the selection once and reuse it for Phases 0.5
and 2. Never re-detect per surface, never drop from Code to Cowork because a panel seems slow,
and never attempt `render-panel` when `preview_start` is absent.

### Step 2 — Load every tool in ONE ToolSearch call

```
ToolSearch: "select:mcp__carta__fetch,mcp__carta__mutate,mcp__carta__welcome,mcp__carta__list_accounts"
```

`mcp__carta__` is the placeholder prefix
([Step 2a](#step-2a--carta-command-names-hardcoded-never-discovered)) — when the session's
Carta tools carry a different prefix, substitute it into the `select:` string; the names after
the prefix never change. Zero matches on the literal `mcp__carta__` names means the wrong
prefix, not a disconnected server — re-check the session's tool list before treating it as the
Step 3 stop.

One call, four tools, the complete set for the run. **`mutate` is loaded here, up front**, so
Phase 2 never has to load it after the user confirms — that would be serial latency at the
worst possible moment. On the Cowork path, add `mcp__visualize__show_widget` to the same
`select:` list if it isn't already loaded.

**Never call `discover` or `search_tools` in the hot path.** Every command name is hardcoded
below; looking up a name you already know is a pure round trip. `discover` is a debugging aid.

### Step 2a — Carta command names (hardcoded, never discovered)

Reads go through `fetch`, writes through `mutate`. The argument key is **`params`**, not
`arguments`, and command names are **colon-separated**:

```
mcp__carta__fetch({"command": "cap_table:get:<noun>",     "params": {…}})
mcp__carta__mutate({"command": "cap_table:mutate:<noun>", "params": {…}})
```

**`mcp__carta__` is a placeholder** — here, in every code block below, and in every reference
file. The real prefix is environment-dependent (`mcp__carta-test__fetch`, plugin-scoped and
UUID-suffixed connector forms all occur). Resolve it from the session's tool list and
substitute it everywhere; only the prefix varies — tool and command names never do. The one
exception: the frontmatter `allowed-tools` entries are literal grant patterns — never
substitute there.

| Purpose | Command | Tool |
|---|---|---|
| Reference data for the collection surface, **plus named stakeholders** via `stakeholder_names` | `cap_table:get:issuance_init` | `fetch` |
| Stakeholder lookup for a roster **miss** — pass `names=` for several, `search=` for exactly one | `cap_table:get:stakeholders` | `fetch` |
| Load an existing set's rows | `cap_table:get:load_drafts` | `fetch` |
| List draft sets (resume by name) | `cap_table:list:draft_sets` | `fetch` |
| Cap-table totals for context math — authorized, outstanding, fully diluted, ownership % | `cap_table:get:cap_table_by_share_class` | `fetch` |
| Save rows, no validation | `cap_table:mutate:save_drafts` | `mutate` |
| Validate a saved set | `cap_table:mutate:validate_drafts` | `mutate` |
| Save + validate + dedupe + issue | `cap_table:mutate:issue_securities` | `mutate` |
| Resolve flagged duplicates | `cap_table:mutate:resolve_duplicate_stakeholder` | `mutate` |

> **The totals source has a breakdown-sounding name.** `cap_table:get:cap_table_by_share_class`
> — `corporation_id` alone — returns authorized, outstanding, fully diluted, and ownership %.
> Context math only (e.g. percent-of-fully-diluted for a grant), never a payload source. There
> is no `cap_table:get:cap_table_summary` — guessing it returns *"Unknown command"* — and the
> similar-sounding `cap_table_summary_report` is a different plugin's report command, not a
> name here; the row above is this skill's totals source.

**Go through `fetch`/`mutate`, not `call_tool`.** The runtime's tool descriptions deprecate
`fetch` in favour of `call_tool` and `discover` in favour of `search_tools`. That notice is
known and deliberately not followed — do not "fix" the contradiction. `fetch` stays because
the per-command tools `call_tool` would target are excluded from `tools/list` (the mechanics
below); the `discover` half is moot here because every command name is hardcoded in the table
above, so discovery never runs (full story:
[incidents.md § Round-trips](references/incidents.md#round-trips-that-bought-nothing)).
Both `fetch` and `mutate` are *pinned gateway* tools: always
present in `tools/list`, reachable in one hop, with scope and staff checks enforced inside the
command executor. The double-underscore form (`cap_table__mutate__issue_securities`) is not a
typo for a command name — carta-mcp also generates one hidden tool per command by swapping `:`
for `__` — but those are excluded from `tools/list` and reachable only via a
`search_tools` → `call_tool` round trip, which is the cost this skill's hot path exists to
avoid. When such a tool isn't visible to the session, that route returns *"Unknown tool"*
instead.

**Never call `set_context` for a corporation-scoped command.** Every command above takes
`corporation_id` as a direct param — pass it.

### Step 3 — Confirm Carta MCP connectivity

The whole flow depends on the Carta MCP server. When it doesn't answer, **classify the failure
before reporting it** — "not connected" and "Carta is briefly down" need opposite responses from
the user, and telling someone to reconnect a connection that was fine is its own failure.

| Signal | Meaning | Do |
|---|---|---|
| No Carta MCP tool in the tool list at all | Genuinely not connected | Stop with the message below |
| A call fails with HTTP 5xx / 502 / 503 / a gateway or HTML error body / a timeout | Transient upstream — the server is connected and briefly unhealthy | **Retry once**, then stop with the *temporary problem* message |

**Genuinely not connected** — stop before gathering any input:

> *"I can't reach Carta — the Carta MCP server isn't connected. Connect the Carta MCP server and try again."*

**Transient upstream** — retry the failed call exactly **once**. If the retry succeeds, continue
the run normally and say nothing about it. If it fails again, stop:

> *"Carta is having a temporary problem on its end — the connection is fine. Give it a minute and try again."*

**The retry cap is one, and it is a hard cap.** A second failure means waiting, not another
attempt: re-running the same call against a 502 cannot succeed, and repeated attempts are the
inner-loop thrash this skill's budgets exist to prevent. Do not vary the call to make a retry
look novel, do not fall back to a different tool or a `discover`/`search_tools` probe, and do not
treat an HTML error body as a data payload to parse — an HTML response to a JSON call is an
outage signal, never content.

### Step 4 — Resolve the corporation by name

If the prompt named a company and you don't already have its `corporation_id`, call
`list_accounts(search="<name>")` — **never** an unfiltered `list_accounts()`, which returns a
truncated alphabetical page that may never reach the name you want. `search` is the tool's own
name lookup; don't substitute a `discover` guess for it. Only ask the user via
`AskUserQuestion` if `search` returns zero or several ambiguous matches.

---

## Phase 0.25 — Ingest an uploaded file

**Skip this phase entirely unless the prompt references a file.** When it does, the file
replaces the prompt as the source of the rows — everything downstream is unchanged. It does not
add a path around any gate: Phase 1 still resolves, Phase 1.5 still saves and validates, Phase 2
still reviews, Phase 3 is still the only mutate.

Supported: `.xlsx` `.xlsm` `.csv` `.tsv` (deterministic) and `.pdf` `.docx` (text extraction —
see [Documents](#documents-pdf--docx)). The sub-skill
[issuance-import/SKILL.md](issuance-import/SKILL.md) owns the mechanics;
[issuance-import/references/column-map.md](issuance-import/references/column-map.md) is the
header vocabulary. **Never hand-read a workbook** — a column read by eye is how a quantity lands
in an exercise-price field.

### Step 0 — Confirm you can actually run the parser

The parser is a local script, so this phase needs `Bash(uv run *)`. **Check your own tool
surface for Bash before promising an import** — it is present on the Code adapter and is not
guaranteed on Cowork.

No Bash → **do not hand-read the file.** Reading a workbook by eye is the failure this whole
phase exists to prevent, and offering it as a fallback would make the parser's guarantees
optional. Say so and route to the feature built for this:

> *"I can't read spreadsheets in this session. Two options: import it directly in Carta's Drafts
> UI, which takes this same template — or paste the rows here as text and I'll set them up."*

Pasted-as-text rows are fine: they arrive in the prompt, so the ordinary prompt-driven flow
handles them with the user's own values in plain sight. That is different in kind from silently
parsing a binary nobody can see.

### Step 1 — Locate the file

Take the path straight from the prompt; a pasted `~/Downloads/…` path is the norm. Only if the
user said "the attached file" with no path, list the likely directories (`ls -t ~/Downloads`,
`~/Desktop`, the cwd) and look for a supported extension recently modified. Zero or several
plausible matches → `AskUserQuestion` which one (allowed by Hard rule 10's file carve-out).
`Bash(find *)` is deliberately not granted to this skill — use `ls`.

### Step 2 — Parse, before spending any round trip

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-import/scripts/parse_upload.py" \
  --file "<path>" --out-dir "$OUT_DIR"
```

This first run is deliberately **without** `--reference`: it costs nothing, and its output tells
you the two things Phase 0.5's fetches need — the `security_type` and the names in the file. It
prints `SECURITY_TYPE=`, `ROW_COUNT=`, and the paths it wrote.

- **Exit 2 with `AMBIGUOUS:` + `CANDIDATES=[…]`** — the workbook has more than one importable
  sheet. `AskUserQuestion` which, then re-run with `--sheet "<name>"`. **Never merge two
  sheets into one batch** (Hard rule 2) and never pick for the user.
- **Exit 2 with `ERROR:`** — nothing usable. Surface the message verbatim and fall back to the
  ordinary prompt-driven flow; do not guess at rows.

**Reconcile `security_type` with the prompt.** File and prompt disagreeing is a real fork →
`AskUserQuestion`. The file wins only when the prompt never said.

### Step 3 — Fetch reference data (Phase 0.5's fetches, informed by the file)

Run [Phase 0.5](#phase-05--configure-the-issuance)'s fetches exactly as documented, with two
inputs now supplied by the file: `issuance_init`'s `security_type`, and its `stakeholder_names`
covering **the names the file contains** rather than the names the prompt named. That keeps the
lookup bounded by the file's row count, never by roster size.

`stakeholder_names` takes the whole list at once, which is the only correct shape here — a
40-row sheet resolved through a concatenated `search=` matches **nobody** and would create 40
duplicate stakeholders on a real cap table. Pass the names as a list; never join them into a
`search` string.

**The [account-setup gate](#account-setup-gate-option-grant-only) still applies.** Having a
parsed file in hand is not a reason to push past it: a corp with no option-grant document set
cannot issue one, whether the rows came from a spreadsheet or from the prompt. Stop where the
gate says to stop — the parsed rows cost nothing and the file is still there afterwards.

### Step 4 — Re-run the parser to resolve names to ids

```bash
uv run "…/parse_upload.py" --file "<path>" [--sheet "<name>"] \
  --reference "$OUT_DIR/_data.json" --out-dir "$OUT_DIR"
```

`--reference` is the same `_data.json` you just built for `build_config.py`. The parser matches
the file's free text against it — vesting schedule, acceleration terms, share class (by name
**or** prefix), legend (by code or name), document set, equity plan, and the roster — and
writes `_import_knowns.json`.

**Unresolved is blank, never guessed.** A cell matching nothing leaves its field **unset** with
an `import_notes` entry. There is no fuzzy matching, and do not add any: an almost-match on a
vesting schedule or share class issues genuinely wrong terms, and unlike a bad quantity the
server cannot catch it.

### Step 5 — Merge into `knowns` and open the surface

`_import_knowns.json` holds `{security_type, rows, equity_plan_id?, batch_errors?}`. Its `rows`
**are** your `knowns.rows` — merge them in and continue into Phase 0.5 unchanged. The row count
comes from the file, so Hard rule 10's quantity-vs-headcount heuristic doesn't apply here (a
40-row sheet is unambiguously 40 blocks). Carry `batch_errors` through to the surface's
panel-level banner, and hold `equity_plan_id` for the first mutate only.

Each row may carry `import_notes` — `[{field, raw_value, reason}]`, **display-only**. Two
obligations, both load-bearing:

1. **Show every note on the surface**, against the field it's about. On Code, `build_config.py`
   renders them as amber markers automatically. On Cowork, render them the same way in the
   `show_widget` form — see
   [cowork-adapter.md §1](references/cowork-adapter.md#import-markers-uploaded-file-rows).
2. **Render a noted field with nothing selected**, so the surface's own readiness check blocks
   submission until the admin picks. `build_config.py` does this for you. A marker alone is
   ignorable; the blocked button is what actually prevents a silent wrong issuance.

**Strip `import_notes` before any mutate** — same discipline as the review-only fields
([Build the mutate payload](#build-the-mutate-payload-from-your-phase-1-resolved-rows)).
The server rejects unknown keys.

### Step 6 — Say what happened, in one line, before the surface opens

Read `_import_report.json` and report totals — never silently drop a column or a row. A dropped
`Exercise Price` column is a wrong-priced grant the user has no way to notice.

> *"Read 38 rows from Q3-grants.xlsx. State of Residency and Employee ID aren't fields this
> flow sets, and 3 values I couldn't match are flagged in the form — everything else is filled
> in. Review and submit when ready."*

Rows the file carried but this skill can't issue (RSUs, SARs, CBUs, warrants, RSAs,
convertibles) are skipped by the parser with a reason. **Name them and their count** — they need
the Drafts UI, and an admin who thinks a 40-row sheet issued 40 securities when it issued 37 has
been misled.

**Name the unmapped columns too, not just how many.** `unmapped_columns` in the report holds the
header labels this skill has no field for — several
([cowork-adapter.md](references/cowork-adapter.md#fields) lists them: state of residency, state
exemption, employee id, cost center, job title, salary, convertible note) are dropped by design,
and a file supplying one is an admin who expects it to land. *"2 columns I couldn't map"* leaves
them believing it did. Say which: *"State of Residency and Employee ID aren't fields this flow
sets — add them on the stakeholder record in Carta."* Naming a column costs a few words; a
silently dropped value the admin deliberately filled in is data loss they find out about later.

### Documents (`.pdf` / `.docx`)

The parser extracts text to `_import_text.txt` and stops — it writes no rows, because prose has
no fixed layout and a script guessing at it would guess silently.

Read the text, build the rows yourself in the parser's own row schema
([issuance-import/SKILL.md § Row schema](issuance-import/SKILL.md#row-schema)), and give every
field you filled this way an `import_notes` entry with `"confidence": "low"` so it renders as
needs-confirmation. Then continue from Step 3.

Take only what the document states. A grant agreement rarely names a vesting template by the
company's own template name, so leave `vesting_template_id` unset rather than inferring it from
prose like "vests monthly over four years" — that is the fuzzy match this phase forbids, done by
hand. Empty text means a scanned image: the parser exits 2 saying so; route the admin to OCR it
or type the values in, and never infer values from a filename.

---

## Phase 0.5 — Configure the issuance

Collect everything on **one** surface — every field, per stakeholder — so the user submits once
instead of answering a chain of questions, and so a single batch can carry genuinely different
terms for different people. This is the engine's `collectConfig`; the adapter from Step 1
decides what the surface is.

**Fetch the reference data first, and issue every call below in ONE assistant turn.** They have
no dependencies on each other; serial fetches here are pure latency.

- **Stakeholder lookup** — pass the people the prompt named as `stakeholder_names` on the
  **same** `issuance_init` call below. The server resolves them alongside the reference data in
  one round trip, and the result comes back as that payload's `stakeholders` section with the
  same shape as the standalone `cap_table:get:stakeholders` command. There is no separate
  stakeholder fetch here.
  **If the prompt named nobody, pass no names at all**: there is nobody to resolve yet, and
  [Phase 1](#phase-1--resolve-each-row--reconcile-share-classes) resolves whatever names the
  user types into the form.

  > **Never put two people in one `search=`.** `search` AND-s its whitespace-separated terms, so
  > it matches **one person only** — `search="Jane Doe"` works, `search="Jane Doe Bob Smith"`
  > asks for a single human matching all four terms and returns an empty list with a perfectly
  > healthy `200`. Commas don't help; they're stripped before the terms are AND-ed. Use
  > `stakeholder_names` (here) or `names=` (Phase 1) for several people — never a concatenated
  > `search`.
- **Reference data** — `cap_table:get:issuance_init` with the active `security_type`, plus
  `stakeholder_names` when the prompt named people. **One call** returns every section the
  surface and Phase 1 need, each with the same `{count, results}` shape as its standalone
  command:
  - *Option grant* — `vesting_templates`, `acceleration_templates`, `document_sets`,
    `valuations_409a`, `international_valuations`, `option_plans`.
  - *Certificate* — `certificate_share_classes`, `legends`, `vesting_templates`,
    `acceleration_templates` (cert vesting is opt-in but needs the same two lists once opted in).
  - *Both, only when `stakeholder_names` was passed* — `stakeholders`, already at `detail=full`,
    carrying `id`, `full_name`, `email`, `event_relationship`, and `kind` per person.

  Every section is fetched server-side in parallel, so adding `stakeholder_names` costs no extra
  wall-clock — it removes a round trip rather than adding one.

  **Partial failure is non-fatal.** A section that failed comes back `null` and is named in the
  top-level `errors` array (`[{section, message}]`); fall back to that section's individual
  `cap_table:get:<section>` command. An empty `errors` means full success — use the payload
  directly. This is the only fallback path; the rest of this file just says "from the
  `issuance_init` payload".

  **Read each section under its own name.** Never let one section's `count: 0` stand in for
  another's. Exactly one count may stop the flow — the [Account-setup
  gate](#account-setup-gate-option-grant-only) below, on `document_sets.count` read under that
  name and no other. Every other count, zero included, never gates: the surface is built and
  opened regardless (Hard rule 10).

### Account-setup gate (option grant only)

Runs once, immediately after the `issuance_init` payload is read — before FMV, jurisdiction,
plan, or any surface work — and is skipped entirely when `security_type` is `certificate`. Both
adapters run it: a zero-template corporation cannot issue from either surface.

Read `document_sets.count` from the `document_sets` section, under that exact name. Confirm the
section name before acting on the number: a real run aborted a valid issuance by reading
`acceleration_templates`' zero as this section's ([incidents.md § Reading server data
wrong](references/incidents.md#reading-server-data-wrong)). Then branch:

- **`count >= 1`** → pass; continue the phase. No other section's count matters here —
  `acceleration_templates.count: 0`, or any other empty list, is a normal state and never gates.
- **`count == 0`** → stop before building any surface:

  > *"Your corporation doesn't have any option-grant document templates set up yet. Create one in the Carta app, then come back."*

- **`document_sets` failed to fetch** — `null` (named in the top-level `errors` or not), absent
  outright, or present but not the documented `{count, results}` shape (missing or non-numeric
  `count`) → a failed fetch, **not** `count: 0`. Run the section's fallback,
  `cap_table:get:document_sets` with `security_type: "option_grant"`, and gate on that count
  instead. If the fallback errors too, surface its message verbatim and stop as a fetch failure
  — never with the no-templates message above.

**Why stopping here doesn't break Hard rule 10.** Rule 10 forbids asking for *collectible
fields* — anything the surface has a field for, like who the grantees are — before the surface
opens. The surface's document-set field picks **among existing templates**; it cannot create
one. Every grant row requires one (`document_set_id` is an `always` field), so with zero
templates the field is unfillable from any surface and the batch it collects can never issue. A
missing template is an **account-setup blocker** — the same category as an unreachable Carta MCP
(Phase 0 Step 3) — and account setup happens in the Carta app, not on this surface.

**The gate has exactly one member: `document_sets`, on option grants.** It is not a "stop on any
empty section" rule and must not be read as one.

### Option grant: resolve the FMV and the jurisdiction (before building the surface)

Both are batch-level: every row in one draft set shares them. Resolve once, pass in `knowns`.

**The FMV is not "the 409A".** A company outside the US prices grants from an EMI, CSOP or
share-price valuation and may have no 409A at all — reading only `valuations_409a` is what left
those admins with an empty exercise price. Prefer `international_valuations`, which covers every
source *including* 409A and carries the currency and status that `valuations_409a` cannot.

Read `international_valuations.active` (already filtered to live valuations server-side — do
**not** re-derive it from dates) and set:

| `knowns` key | Value |
|---|---|
| `fmv_options` | the `active` rows as-is (`price`, `currency`, `valuation_type`, `effective_date`) |
| `fmv_source` | the rows' shared `support_reference_type` (`409A` / `EMI` / `CSOP` / `SHARE_PRICE`) |
| `fmv_expired_on` | only when `active` is empty and `history` has one — its `expiration_date`, so the hint can say *when* cover lapsed instead of just "none" |

`build_config.py` derives the hint and the prefill from these; don't pre-compute either.

> **Never pick between two active valuations.** An HMRC report yields both an **AMV** (actual
> market value, discounted for restrictions) and a **UMV** (unrestricted market value). Nothing
> in the payload says which one a grant is priced from, and the difference changes the holder's
> tax position — so pass both and let the panel ask. The panel deliberately leaves the field
> empty in that case; do not "help" by filling one in.

**If the section is missing** — a US-only corp can be refused it (it is permissioned separately),
in which case it comes back `null` in `errors`. Fall back to `valuations_409a`: use
`current_409a` when its `is_expired` is false, and treat `is_expired: true` as the expired case.

**Derive `knowns.jurisdiction` too** — `build_config.py` defaults it to `"US"`, which shows a UK
company ISO/NSO buttons instead of EMI/CSOP. In precedence order:

1. the active valuation's `currency` (`GBP` → UK, `AUD` → AU, `USD` → US);
2. `option_plans[].scheme_type == "EMI"` → UK;
3. an `EMI`/`CSOP` `support_reference_type` in the valuations payload → UK;
4. otherwise `US` — and say so in the review as `(default — assumed US)`, so a wrong guess is
   visible and correctable rather than silent.

Set `knowns.currency` from the same source. See
[code-adapter.md § knowns](references/code-adapter.md#1-config-panel-build_configpy-builds-every-block).

**The surface's fields** — one full key-value block per stakeholder, every field inside that
person's own block, so a batch can issue genuinely different terms to different people. The
authoritative enumeration for both adapters is
[cowork-adapter.md § Fields](references/cowork-adapter.md#fields); it also covers batch mode
(shared terms once + a compact name/email/quantity table) for large identical-term batches.

Render the form with `show_widget` and wait for its `sendPrompt()` reply —
[cowork-adapter.md §1](references/cowork-adapter.md#1-collectconfig--the-show_widget-form).
**Never express this as a chain of `AskUserQuestion`s**: it is an option-picker that cannot take
a free-text quantity, price, date, or name, so one prompt per field is the exact serial
interrogation this phase exists to eliminate. Reserve `AskUserQuestion` for genuinely blocking
single choices — an ambiguous `security_type`, a multi-plan pick, the Phase 2 confirm.

**On submit**, take the returned `rows` as your working set and map each row's own fields onto
a resolved row: [references/row-mapping.md](references/row-mapping.md). Then go to Phase 1.

---

## Phase 1 — Resolve each row + reconcile share classes

Your working set is the `rows` from Phase 0.5 — one entry per grantee/holder, each already
carrying its own quantity and full field set. Phase 1 *resolves* each row; it does **not**
re-collect the person, the quantity, or any field the surface already carries.

**Resolve from what Phase 0.5 already fetched.** Match each `rows[].name` case-insensitively
against the `issuance_init` payload's `stakeholders` section, which carries `full_name`, `email`,
`id`, `kind`, and `event_relationship` per person:

- **Exactly one match** → reuse `email`, `event_relationship`, `kind`, `id`. Stamp
  `stakeholder_id` to bypass duplicate detection. Tag `(from existing record)`. **No MCP call.**
- **No match** → the person is new, or was typed into the form after Phase 0.5 fetched (routine
  on Cowork). Batch *only these misses* into **one** `cap_table:get:stakeholders` call passing
  `names=` (a list of the missed names), not `search=`. A genuine no-match is a new stakeholder —
  never ask for an email that is already on the cap table.
- **Multiple matches on one name** → disambiguate with `AskUserQuestion`.

> **`search` matches one person; `names` matches many.** `search` AND-s its whitespace-separated
> terms across `full_name`/`email`, so two people in one `search` string can never match anything
> — it returns an empty list with a `200`, which looks exactly like "nobody here". **A
> zero-result `search` that contained more than one name is a malformed query, not an absent
> person.** Never conclude "these are all new stakeholders" from one; re-issue it as `names=`.
> Creating a duplicate stakeholder for someone already on the cap table is silent, wrong, and
> lands on a real cap table.

> **The number of stakeholder calls is bounded by roster misses, never by row count.** A
> per-name `search` loop is the serial round-trip pattern this skill was slow for — and
> concatenating every row's name into one `search` to make that loop look batched is the same bug
> wearing a disguise, with the added defect that it silently matches nobody.

**Precedence for the two fields the surface can also supply:** a non-empty `relationship`
stamps `issue_date_relationship`, and `stakeholder_kind` (defaulting to `INDIVIDUAL`) stamps
itself — but **only when the lookup found no match**. For an existing stakeholder the cap-table
record always wins; the surface auto-populates and locks these on an exact name match precisely
so the two agree. Tag `(from config surface — new stakeholder)`.

Dropping any of `email`, `issue_date_relationship`, `stakeholder_kind`, or `stakeholder_id`
from a stamped row is a contract violation (Hard rule 9).

**Push back on parsing only** — a required field empty, a quantity that isn't a parseable
number, a date that doesn't parse (ask for `YYYY-MM-DD` or `MM/DD/YYYY`), a broken email shape,
or a required price that is `0`/blank, *except* the two legitimate `0` cases: a **ZEPO** grant
and a **certificate/RSA on an LLC**. Everything else is the server's call — don't pre-validate
price-vs-FMV, decimals, future dates, negatives, state codes, exemption picklists, or prefix
format.

### Share-class reconciliation (certificate)

Matching a user-supplied class name, the "most recently created" default, and the
ambiguous-match table: [certificate-fields.md § Share-class
reconciliation](references/certificate-fields.md#share-class-reconciliation-certificate).

### Option-plan reconciliation (option grant)

Use the `option_plans` section from the Phase 0.5 `issuance_init` payload.

- **One non-expired plan** → default silently. Tag `(default — only active plan)`.
- **Multiple non-expired** → `AskUserQuestion`, one option per plan
  (`"Use \"<name>\" (<available_quantity> available)"`), last option `"Cancel"`.
- Skip expired plans (`is_expired: true`); **never recompute** `available_quantity`.

Pass `equity_plan_id` **only on the first mutate** that creates the set — it is locked
server-side after. Also stamp the chosen plan's `name` onto every row as `plan_name`, a
[review-only field](references/option-grant-fields.md#review-only-fields-option-grant--never-sent-to-the-mutate)
never sent to the mutate.

---

## Phase 1.5 — Save + validate before review (or save-only)

Reached immediately after Phase 1 resolves every row, for **both** of the surface's footer
buttons. Saving and validating *before* the review exists is deliberate: `validate_drafts` runs
nearly every check `issue_securities` does — all but the corp-level missing-signatory check —
and it needs an existing `draft_set_id`, so validating early means saving early too. Reviewing
an unvalidated summary means the user first learns of a rejection at the final confirm, after a
draft row has already been created.

Full mechanics — branching on `save_only` / `config_submit`, translating server errors back
into `knowns`, re-rendering the surface, and draft-state bookkeeping:
[references/save-validate-flow.md](references/save-validate-flow.md).

## Resume an existing draft set

Loading a set by id or name, re-deriving option-grant review-only display fields, and jumping
straight to Phase 2: [references/resume-flow.md](references/resume-flow.md#resume-an-existing-draft-set).

---

## Shared resolution helpers

The collection surface already gathers legend, vesting, acceleration, and document set as
fields inside each stakeholder's block, so on a normal run the row arrives already carrying the
resolved id/label and **these procedures don't run**. They are the fallback for anything the
surface didn't resolve. Picklist source, default posture, and what gets stamped are identical
either way.

Board approval is the exception to "the surface already did this": it *is* a surface field, but
the pointed-to section documents the underlying `needs_board_approval` logic both paths
converge on. Dividend accrual start date is a further exception — it has no surface field at
all yet and always goes through chat.

### Vesting resolution

Use the `vesting_templates` section from the Phase 0.5 `issuance_init` payload. Render a
compact picker (name + `summary_short` + `vesting_type`). `AskUserQuestion`: one option per
template → `vesting_template: <id>`; `"No vesting"` → leave unset. When set, also collect
`vesting_start_date` (`MM/DD/YYYY`, default `issue_date`) **unless** the template's
`vesting_type` is milestone, which the server defaults — skip that prompt.

| Flow | Default posture | "No vesting" |
|---|---|---|
| Certificate | Opt-in (only if the user volunteers) | Normal |
| Option grant | Required server-side | Accepted, but warn — atypical |

### Acceleration resolution

Only if vesting is set. Use the `acceleration_templates` section from the `issuance_init`
payload. `AskUserQuestion`: one option per template → `acceleration_template: <id>`;
`"No acceleration"` → leave unset.

### Type-specific helpers

- **Legend** (certificate) — [certificate-fields.md § Legend
  resolution](references/certificate-fields.md#legend-resolution-certificate).
- **Dividend accrual start date** (certificate) —
  [certificate-fields.md](references/certificate-fields.md#dividend-accrual-start-date-resolution).
- **Rule 144 difference reason** (certificate, only when `rule_144_date` ≠ `issue_date`) —
  [certificate-fields.md](references/certificate-fields.md#rule-144-difference-reason).
- **Exercise periods, document set, board approval** (option grant) —
  [option-grant-fields.md § Resolution
  helpers](references/option-grant-fields.md#resolution-helpers-option-grant).

---

## Row templates

Fill literally. Every slot must hold a value before review; a `None` or empty is a skill bug —
reapply the default, re-call the stakeholder lookup, or ask (Hard rule 9). Each file also lists
the **review-only** fields stamped alongside the payload, which are display-only and never sent
to the mutate.

- **Certificate** — [certificate-fields.md § Certificate
  row](references/certificate-fields.md#certificate-row).
- **Option grant** — [option-grant-fields.md § Option-grant
  row](references/option-grant-fields.md#option-grant-row).

## Pre-mutate checklist

Tick before any mutate — Phase 1.5's `save_drafts` / `validate_drafts` included, not just the
final `issue_securities`:

- [ ] `security_type` resolved and passed on every call
- [ ] Stakeholder lookup ran with `detail=full` → `issue_date_relationship`, `email`, `stakeholder_kind`, `stakeholder_id` stamped on every row
- [ ] **Cert:** share class resolved → `prefix`. **Grant:** option plan resolved, `so_type` autofills applied (`currency`, `exemption`)
- [ ] Every `always` field populated per the row template; pre-save assertion passed (Hard rule 9)
- [ ] **For `issue_securities` only:** the review surface was opened and confirmed (Phase 2 → 3). Phase 1.5's calls precede the review by design, so this doesn't apply to them
- [ ] If retry: `draft_set_id` + each row's `draft_pk` in the payload (Hard rule 4)

---

## Phase 2 — Render the review surface (mandatory pre-save gate)

The engine's `showReview` + `confirm`. Phase 1.5 has already saved and validated these rows, so
this is a **read-only** confirmation before the irreversible `issue_securities` call, not
another save.

Print the review as chat markdown, then confirm with one `AskUserQuestion` —
[cowork-adapter.md §2–3](references/cowork-adapter.md#2-showreview--chat-markdown). **That
order is mandatory and overrides any host rule about prose between tool calls**; the review is
the gate, not narration of one. The full
always/conditional/optional column spec, the default-explanation text, the confirm prompt, and
the compressed format for identical-term batches are in
[references/chat-review.md](references/chat-review.md).

> **Tool pre-load:** `mutate` must already be loaded (Phase 0 batched it) before you open this
> surface. Do not `ToolSearch` here — it adds serial latency after the user has confirmed. If
> for any reason it isn't loaded, load it now, *before* rendering the review.

---

## Phase 3 — On confirmation, run the mutate

You reach Phase 3 when the review surface confirms. **The confirmation already happened — do
not re-ask**, and don't second-guess a fresh signal as a stale replay. Branch directly:

| Answer | Do |
|---|---|
| `"Issue … now"` / any free-text affirmative | [Run the issue securities mutate](#run-the-issue-securities-mutate) |
| `"Save as draft"` | [Save as draft](#save-as-draft-escape-hatch) |
| `"Edit a row"` | re-render the Phase 0.5 form, pre-filled with the resolved rows |
| `"Cancel"` | stop — *Canceled* closing |

### First: do you need a payload at all?

**Usually not.** [Phase 1.5](#phase-15--save--validate-before-review-or-save-only) already saved
and validated these rows, and the review is read-only with nothing to merge back — so the server
is already holding exactly what the user just approved. Issue *those* rows:

```
mcp__carta__mutate({"command": "cap_table:mutate:issue_securities", "params": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant>",
  "draft_set_id": <draft_set_id>}})     # no `drafts` key at all
```

`drafts` is optional. Given `draft_set_id` and no rows, the server skips the save entirely and
validates and issues what is already persisted on that set. Everything else is unchanged — the
same blocking validation, the same duplicate detection, the same corporation-signatory check, the
same atomic issue, the same response shape.

This is the **correctness** path, not just the cheap one. Re-serializing rows between validation
and issue means the payload that commits is not provably the payload that was validated and
shown to the user: validation passes on payload A, the user reviews payload A, and payload B is
what issues. Nothing downstream catches that divergence. Sending no rows makes it impossible
([Hard rule 11](#hard-rules)).

**Build a `drafts` payload only when the rows aren't already on the server:**

- **Rows changed after Phase 1.5 saved them** — an error-retry that edited a value, or a
  [back-to-edit](references/back-to-edit.md) round trip. Send the changed rows **with their
  `draft_pk`s** so they update rather than insert (Hard rule 4), then the set is current again.
- **No `draft_set_id`** — nothing was ever saved, so there is no set to issue from. Rare on this
  path: Phase 1.5 runs before the review by design, so reaching Phase 3 without one means an
  earlier step was skipped.

If either applies, build the payload per the rules below. Otherwise skip to
[Run the issue securities mutate](#run-the-issue-securities-mutate).

### Build the mutate payload from your Phase-1-resolved rows

Three rules govern the `drafts` payload on **both** paths, and each one fails the whole mutate
when got wrong:

- **Per-field date formats.** `grant_expiration_date`, `vesting_start_date` and `rule_144_date`
  are `CharField(10)` and take **`MM/DD/YYYY` only** — an ISO string comes back
  `Date is invalid`, with no server-side coercion. Every other date goes out ISO. Rows carry ISO
  everywhere upstream of this call. Conversion is idempotent, so a row already in `MM/DD/YYYY`
  is fine.
- **Non-payload keys stripped**: `import_notes`, `row_key`, and the review-only
  `plan_name` / `document_set_label` / `exercise_periods_text` / `legend_body`. Any of them
  present is an unknown-field rejection.
- **Empty means omit**, while a real `0` price, `needs_board_approval: false`, and an explicit
  `vesting_template: null` all survive.

**On Cowork — apply all three by hand.** There is no serializer on this path: the script below
reads and writes `$OUT_DIR` files that only the Code adapter has. The date rule bites hardest on
an [imported](#phase-025--ingest-an-uploaded-file) batch, where rows arrive prefilled in ISO (the
form's date inputs accept nothing else), so all three CharFields need converting — Phases 0.5/1
did not touch them. Strip `row_key` here too: you needed it to thread `draft_pk`
([cowork-adapter.md § Draft state](references/cowork-adapter.md#draft-state-on-this-path)), and
it is an unknown field to the server.

**On Code — run the serializer**, which enforces all three, and pass what it returns as `drafts`
verbatim:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/scripts/serialize_drafts.py" \
  --security-type <option_grant|certificate> \
  --rows "$OUT_DIR/_review_rows.json" --out "$OUT_DIR/_drafts.json"
```

Exit 2 with the row and field named means a date couldn't be read — fix it and re-run rather
than sending it.

Re-run the pre-save assertion (Hard rule 9) on the resolved rows, then mutate.

---

## Run the issue securities mutate

One mutate runs save → validate → check duplicates → issue, atomically. The save step is skipped
when you send no rows.

```
# The normal case, both security types — the set already holds the reviewed rows
mcp__carta__mutate({"command": "cap_table:mutate:issue_securities", "params": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant>",
  "draft_set_id": <draft_set_id>}})
```

Only when the rows must change, or no set exists yet ([above](#first-do-you-need-a-payload-at-all)):

```
# Certificate
mcp__carta__mutate({"command": "cap_table:mutate:issue_securities", "params": {
  "corporation_id": <corporation_id>, "security_type": "certificate",
  "drafts": [ ...cert rows, each with its draft_pk when the set exists... ],
  "draft_set_id": <draft_set_id when one exists>,
  "draft_set_name": <optional label, ≤30 chars>}})

# Option grant — additionally pass equity_plan_id on the FIRST save of a new set
mcp__carta__mutate({"command": "cap_table:mutate:issue_securities", "params": {
  "corporation_id": <corporation_id>, "security_type": "option_grant",
  "drafts": [ ...grant rows, each with its draft_pk when the set exists... ],
  "equity_plan_id": <equity_plan_id>,               # first save of a new set only
  "draft_set_id": <draft_set_id when one exists>}})
```

An unknown `draft_set_id` sent with no `drafts` returns a descriptive error rather than quietly
creating a new set — so a stale id fails loudly instead of issuing into the wrong place.

**Response:** `{draft_set_id, drafts:[{temp_id, draft_pk, status}], validation:{status, success,
errors, warnings}, duplicates:{has_duplicates, count, results}, issued:[{id}]|null}`. **Always
capture `draft_set_id` and each `draft_pk`**, even on success — a follow-up may retry this
conversation. On the no-rows path `drafts` comes back `[]` (nothing was saved); the `draft_pk`s
you already hold from Phase 1.5 stay valid.

| Response state | Action |
|---|---|
| `issued` non-empty | Committed — render the table per [On success](#on-success) |
| `validation.errors` | [mutate-recovery.md § Error recovery](references/mutate-recovery.md#error-recovery) |
| `duplicates.has_duplicates` | [mutate-recovery.md § Duplicate resolution](references/mutate-recovery.md#duplicate-resolution) |
| Only `validation.warnings` (`issued: null`) | Surface verbatim; `AskUserQuestion`: `"Acknowledge and issue"` / `"Edit a row"`; re-call on acknowledge |
| Issue failed / 403 | [mutate-recovery.md § Atomic issue failure](references/mutate-recovery.md#atomic-issue-failure) |

Every re-call carries `draft_set_id` + each `draft_pk` (Hard rule 4).

### On success

Render a short table using `MM/DD/YYYY`. Don't fabricate `Label` or `Grant number` columns —
they aren't in the response.

- **Certificate:** Stakeholder · Share class · Quantity · Issue date.
- **Option grant:** Stakeholder · Plan · Option type · Quantity · Exercise price · Issue date.

Link to the ledger at `https://app.carta.com/<VIEW_URL_PATH>`, where `VIEW_URL_PATH` is
`options/list/<CORP_ID>/` (option grant) or `certificates/list/<CORP_ID>/` (certificate).
**Never invent a different path** — `corporations/<corporation_id>/equity/options/` looks
plausible and is not a real route. `app.carta.com` is a deliberate hardcode: no MCP command
resolves an environment-specific host, so this link is only correct in production and will
misdirect a sandbox/test session — a known, accepted tradeoff, not an oversight. There is no
verified URL for a specific plan's detail page, so name the plan in plain text, not as a second
link. Then close per [Closing](#closing).

## Save as draft (escape hatch)

Runs whenever a save-only save is needed: from [Phase 1.5](#phase-15--save--validate-before-review-or-save-only)'s
**Save** button (the common case), or from the Phase 3 answer `"Save as draft"`.

```
mcp__carta__mutate({"command": "cap_table:mutate:save_drafts", "params": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant>",
  "drafts": [ ...rows... ],
  "draft_set_id": <draft_set_id if resuming>, "draft_set_name": <optional, ≤30 chars>,
  "equity_plan_id": <equity_plan_id>}})   # option-grant only, on first save
```

Response `{draft_set_id, drafts:[{temp_id, draft_pk, status}]}` — no top-level `validation`
(`save_drafts` skips it by design), **but each row's `status` still reflects its own save.**
Check it:

- **All success** → the *Saved as draft* closing.
- **Some errored** → surface verbatim per failing `draft_pk`, recover via
  [mutate-recovery.md](references/mutate-recovery.md#error-recovery), then re-call
  `save_drafts` (**not** `issue_securities`) with the same `draft_set_id` + each `draft_pk`.
- **All failed** → surface verbatim; *"No drafts saved. Fix the errors above and re-try."* — no
  Drafts-UI link, since there is nothing there to open.

**Never show the success message when any row failed** — the user would believe a partial set
is complete.

## Validate without issuing

```
mcp__carta__mutate({"command": "cap_table:mutate:validate_drafts", "params": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant>",
  "draft_set_id": <draft_set_id>}})
```

Returns `{validation, duplicates}` only. Interpret with the branching rules above; stop at the
report.

## Cleanup unexpected draft rows

Extra or duplicate rows surfaced by `load_drafts` on resume, or a dropped `row_key` from a
Phase 1.5 retry: [resume-flow.md § Cleanup unexpected draft
rows](references/resume-flow.md#cleanup-unexpected-draft-rows).

---

## Closing

At a terminal state, lead with a one-line domain summary — company, count, type, and for an
issue, the issue date in long form (`Month D, YYYY`).

| State | Template |
|---|---|
| Issued, certificate | *"N \<share class\> certificates issued on \<company\> — \<issue date\>. Open [\<company\>'s securities ledger](https://app.carta.com/\<VIEW_URL_PATH\>) in Carta to see the new certificates."* |
| Issued, grant (uniform) | *"N \<so_type\> option grants issued on \<company\> — \<issue date\>. Open [\<company\>'s securities ledger](https://app.carta.com/\<VIEW_URL_PATH\>) in Carta to see the new grants, or find them under the \<plan name\> plan."* |
| Issued, grant (mixed) | as above, but *"N option grants (X ISOs, Y NSOs) issued on …"* |
| Saved as draft | *"N \<security type\> drafts saved on \<company\> — finish in the [Drafts UI](https://app.carta.com/drafts/\<security_type\>/\<CORP_ID\>/draft/?draftSetPk=\<draft_set_id\>)."* |
| Canceled, **a real draft set exists** | *"Issuance canceled on \<company\> — the draft set is still there if you want to come back to it: [Drafts UI](…same URL…)."* |
| Canceled, **no real draft set** | *"Issuance canceled on \<company\> — nothing was saved to Carta."* (no link — there is nothing to open) |

A draft set is **real** when this batch was resumed from an existing one, **or** at least one
row from a `save_drafts` / `issue_securities` call this session came back with a success
`status` and therefore a saved `draft_pk`. It is **not** real when `draft_set_id` is still the
initial `"new"` placeholder, or when every row's `status` came back an error.

Every link above hardcodes `app.carta.com` — no MCP command resolves an environment-specific
host, so this is only correct in production. A deliberate, accepted tradeoff: a sandbox/test
session gets a link pointing at production. `security_type` in a Drafts-UI path is the
literal mutate value (`certificate` or `option_grant`).

To **correct** an issued certificate or grant afterward, that's `carta-modify-issuables`.
