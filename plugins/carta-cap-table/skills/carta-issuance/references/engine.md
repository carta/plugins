# The issuance engine — build the surface yourself

Read this on the **chat surface** and nowhere else: the one path where *you* collect the terms
and assemble the payload. [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) selects
it when the host has no `Artifact` tool; an artifact run reaches it only by falling back.

**Being here is not a degraded run.** It needs nothing this session lacks: never report it as
unavailable, never offer to start a dev server, and never say it is blocked on a CLI, a tool or
a connection.

The engine is this file: resolve `security_type` → fetch reference data → run the gates →
collect → assemble rows → `save_drafts` / `validate_drafts` / `issue_securities` → recovery.

Three more reads, each at its own moment:

- **[chat-surface.md](chat-surface.md)** — the collect, the review and the confirm, plus the
  computable defaults you must never ask for. Read it **in parallel with the first Carta
  fetch**, not before it: [Phase 0.5](#phase-05--configure-the-issuance)'s `issuance_init` has
  no dependency on it, so reading first only delays it.
- **[payload-reference.md](payload-reference.md)** — the authoritative field contract: types,
  formats, picklists, autofills, date quirks. Read it **before
  [Phase 1](#phase-1--resolve-each-row--reconcile-share-classes)**. Nothing earlier builds a
  payload, and it is the largest file this path reads — pulling it in ahead of the collect
  delays the one thing the user is waiting for.
- **The type-specific row file waits for `security_type`.** Read
  [option-grant-fields.md](option-grant-fields.md), *or*
  [certificate-fields.md](certificate-fields.md), *or* [piu-fields.md](piu-fields.md) once that
  resolves — exactly one, and never before. Loading the wrong one is pure cost, and a grant run
  has no use for Rule 144.

The path ends at the `issue_securities` mutate
([Phase 3](issue-and-close.md#phase-3--on-confirmation-run-the-mutate)). The host's
confirmation prompt on that mutate is the final, irreversible gate — never the review gate.

---

## Engine hard rules

[SKILL.md § Hard rules](../SKILL.md#hard-rules) binds on every path and still binds here. These
five bind on **this** path, because they govern building a surface and a payload by hand.

1. **The field contract lives in [payload-reference.md](payload-reference.md).** Read it before
   constructing any payload. No invented keys.
2. **Templates only — no custom payloads** for legends, vesting, acceleration, or exercise
   periods: *"Custom \<thing\> isn't supported here. Save as draft and finish in the Drafts UI."*
3. **No id sniffing.** Required values come from user input, the stakeholder roster this run
   resolved against, or a documented default — never scraped from another grant or certificate.
   If none of the three applies, ask via `AskUserQuestion`.
4. **Pre-save assertion.** Before *any* `save_drafts` or `issue_securities` call, walk every row
   and confirm each `always` field (per [Row templates](#row-templates)) holds a non-null value.
   If one is missing, recover **before** the call, in order: (a) the row template's documented
   default; (b) re-run the stakeholder lookup (`detail=full`) and re-stamp
   `issue_date_relationship` / `email` / `stakeholder_kind`; (c) `AskUserQuestion`.
   This is load-bearing because both failure modes are **silent**: `save_drafts` accepts
   incomplete rows without complaint, and at issue time a row with `stakeholder_id=null` slips
   duplicate detection, creates zero securities, and still returns success. That the server
   accepts a row is therefore never a reason to send one — **never offer to save past a missing
   `always` field, and never describe the server's tolerance to the user as an option**
   ([save-validate-flow.md § The assertion is not advisory](save-validate-flow.md#the-assertion-is-not-advisory)).
5. **Never ask who the grantees are before collecting the rest.** A missing recipient is one
   field inside the batch, never a gating question ahead of it — this is the single most common
   way this skill goes wrong. Two sub-rules follow from it:
   - **A bare "N \<securities\>" is a quantity, not a headcount.** *"100 option grants"*,
     *"100 certificates"* — the server's `quantity` field counts shares/options for **one**
     recipient, so with no named people and no plural-**person** language, collect **one** row
     with `quantity` already set to N.
   - **Only open multiple rows when the language counts people** — *"100 employees"*, *"grants
     for 100 new hires"*, or an explicit list of names.
   - Two questions that are real forks, **not** this forbidden one: a genuinely ambiguous
     quantity-vs-headcount (rare), and *"which file did you mean?"* when the prompt referenced
     a file and [Phase 0.25](#phase-025--ingest-an-uploaded-file) found zero or several
     candidates, or the workbook has several importable sheets. Never ask *who* is in the
     file, and never ask in place of parsing a path the prompt already gave.

The incidents behind these rules — including the ones that look redundant — are in
[incidents.md](incidents.md). Read it before weakening any of them.

---

## Voice & defaults

<!-- No [PATTERN carta-writing-style] block: the rules below are what this skill's
     user-facing text actually needs (tagged defaults, no raw ids, jargon explained
     on first use), and the shared pattern does not cover them. -->

- **Explain anything the skill chose.** Tag `(default)`, `(from existing record)`, or
  `(autofill — <so_type> rule)` with a one-line explanation under the review. The review is the
  user's only chance to reject a default, so an unshown default is one they never got to see.
- **Silent defaults are computable; prompted fields aren't.** If the skill can stamp it
  (today's date, the plan's grant term, an autofill rule), stamp it and surface it tagged.
  Never ask twice. The full table is
  [chat-surface.md § 4](chat-surface.md#4-computable-defaults--apply-and-show-never-ask).
- **Show the full text of legally binding values** (e.g. the legend body), not just the
  template name.
- **Dates display as `MM/DD/YYYY`** everywhere the user sees them. Payload formats follow
  [payload-reference.md](payload-reference.md).
- **Explain jargon on first use** (Rule 144 date, Section 4(a)(2), INDIVIDUAL, legend).
- **No raw ids or payload field names in customer-facing text — ever**
  ([SKILL.md hard rule 8](../SKILL.md#hard-rules)). Humanize payload keys before surfacing
  them, server `banner_errors` included: `_` → space, Title Case, with the exceptions listed in
  [labels.md](labels.md).

---

## Phase 0 — Preflight

Four steps, in order, **all before any user interaction and before gathering any input.** The
surface is already selected ([SKILL.md](../SKILL.md#pick-the-surface)), and that selection is
free. These steps are the only round trips this preflight may spend: one `ToolSearch`, one
`list_accounts` (plus at most three disambiguation probes), and one `issuance_init` that
doubles as the account-level hard stop and as Phase 0.5's reference-data fetch.

### Step 1 — Load every tool in ONE ToolSearch call

```
ToolSearch: "select:mcp__carta__call_tool,mcp__carta__search_tools,mcp__carta__welcome,mcp__carta__list_accounts,mcp__carta__get_current_user"
```

`mcp__carta__` is the placeholder prefix ([Step 2](#step-2--command-names-and-base_url)) — when
the session's Carta tools carry a different prefix, substitute it into the `select:` string; the
names after the prefix never change. Zero matches on the literal `mcp__carta__` names means the
wrong prefix, not a disconnected server — re-check the session's tool list and re-run the
`select:` with the prefix it actually carries.

**This call is the only place this skill concludes anything about the connection.** Only when
no tool ending in `call_tool` / `list_accounts` / `welcome` exists, under any prefix, is Carta
genuinely gone: say so and stop. Everything else that looks like an answer is not one
([SKILL.md § Do not diagnose the Carta connection](../SKILL.md#do-not-diagnose-the-carta-connection)).

One call, five tools, the complete set for the run. **`call_tool` is loaded here, up front**, so
Phase 2 never has to load it after the user confirms — that would be serial latency at the worst
possible moment.

**Don't call `search_tools` in the hot path.** Every command name is hardcoded in
[Step 2](#step-2--command-names-and-base_url), and `call_tool` reaches all of them directly;
looking up a name you already know is a pure round trip. `search_tools` is for a command that
table doesn't name.

### Step 2 — Command names and `BASE_URL`

Reads and writes both go through **one** tool, `call_tool`. It takes `name` and `arguments` —
and the name carries **double underscores** where this skill's prose uses colons:

```
mcp__carta__call_tool({"name": "cap_table__get__issuance_init",    "arguments": {…}})
mcp__carta__call_tool({"name": "cap_table__mutate__save_drafts",   "arguments": {…}})
```

This is the authoritative spelling table. Translate every command name in this file the same
way; `arguments`, never `params`. Names this skill once got wrong are marked.

| Prose form | Wire name |
|---|---|
| `cap_table:get:issuance_bootstrap` | `cap_table__get__issuance_bootstrap` |
| `cap_table:get:issuance_init` | `cap_table__get__issuance_init` |
| `cap_table:get:issuable_field_manifest` | `cap_table__get__issuable_field_manifest` |
| `cap_table:get:stakeholders` | `cap_table__get__stakeholders` |
| `cap_table:get:option_plans` | `cap_table__get__option_plans` |
| `cap_table:get:certificate_share_classes` | `cap_table__get__certificate_share_classes` |
| `cap_table:get:document_sets` | `cap_table__get__document_sets` |
| `cap_table:get:legends` | `cap_table__get__legends` |
| `cap_table:get:vesting_templates` | `cap_table__get__vesting_templates` |
| `cap_table:get:acceleration_templates` | `cap_table__get__acceleration_templates` |
| `cap_table:get:409a_valuations` — **not** `valuations_409a` | `cap_table__get__409a_valuations` |
| `cap_table:get:valuations` — the international ones; **not** `international_valuations` | `cap_table__get__valuations` |
| `cap_table:get:load_drafts` | `cap_table__get__load_drafts` |
| `cap_table:list:draft_sets` — resume by name | `cap_table__list__draft_sets` |
| `cap_table:get:cap_table_by_share_class` — context math only | `cap_table__get__cap_table_by_share_class` |
| `cap_table:mutate:save_drafts` | `cap_table__mutate__save_drafts` |
| `cap_table:mutate:validate_drafts` | `cap_table__mutate__validate_drafts` |
| `cap_table:mutate:issue_securities` | `cap_table__mutate__issue_securities` |
| `cap_table:mutate:resolve_duplicate_stakeholder` | `cap_table__mutate__resolve_duplicate_stakeholder` |

There is no `cap_table:get:cap_table_summary` and no `cap_table:get:draft_set_init`. Don't
reach for either; both were invented on a fallback path, so they failed exactly when the run
was already degraded. `draft_set_init` is a **section** of `issuance_init`'s response, not a
command of its own.

> **The totals source has a breakdown-sounding name.** `cap_table:get:cap_table_by_share_class`
> — `corporation_id` alone — returns authorized, outstanding, fully diluted, and ownership %.
> Context math only (e.g. percent-of-fully-diluted for a grant), never a payload source.

**`mcp__carta__` is a placeholder** — here, in every code block below, and in every reference
file. The real prefix is environment-dependent (`mcp__claude_ai_Carta__call_tool`, plugin-scoped and
UUID-suffixed connector forms all occur). Resolve it from the session's tool list and substitute
it everywhere; only the prefix varies — tool and command names never do. The one exception:
SKILL.md's frontmatter `allowed-tools` entries are literal grant patterns — never substitute
there. `call_tool` is the only surface: the `fetch`/`mutate` gateway pair sits behind a flag
that defaults off, so `mcp__carta__fetch` comes back *"No such tool available"*
([incidents.md § Round-trips](incidents.md#round-trips-that-bought-nothing)). And **never call
`set_context`** — every command takes `corporation_id` as a direct param.

**Record `BASE_URL` here**, from the session's `get_current_user` result — it returns `base_url`
(e.g. `https://demo.carta.team`) alongside `environment`. Every Carta link this skill emits is
built from it, because a hardcoded host sends the user into a different environment than the one
they just wrote to. Never derive it from the tool prefix. If it is genuinely absent, say the
environment is unknown rather than assuming production.

#### The connected Carta must be the intended Carta — check before the first call

The hard stop is
[SKILL.md § The connected Carta must be the intended Carta](../SKILL.md#the-connected-carta-must-be-the-intended-carta)'s,
and it binds here too:
`corporation_id` is not unique across environments, so aiming at the wrong one reads one
company's cap table and later issues real securities onto it. The connected environment is
the one behind the `call_tool` you loaded in Step 1 — a readable prefix names it
(`…_Carta_Demo__` → demo, a `-test` or sandbox suffix likewise, unsuffixed → production), and
`get_current_user`'s `environment` settles it, including behind a UUID prefix (its `base_url`
host when `environment` reads `unknown`). A connector offering only `authenticate` is not
connected, and no example in this skill names the user's environment. Three cases:

- **The request names no environment** → the connected one is intended. Continue, say nothing.
- **It names or implies one and that differs** → **hard stop before the first Carta call.**
- **Two Carta surfaces are connected and they disagree** → **hard stop.**

> *"Your Carta connection points at \<connected\>, and this request looks like it's about
> \<intended\>. Corporation ids don't match across environments, so I'd be reading — and then
> writing to — the wrong company. Confirm which environment you want, or connect that Carta
> server."*

**Never settle this yourself** by using the connected server because it is the only one
present. Being the only option is not the same as being the right one.

#### When a call fails

Classify the failure before you report it: no Carta tool under any prefix means genuinely
disconnected and you stop ([Step 1](#step-1--load-every-tool-in-one-toolsearch-call)); a 5xx,
gateway error, HTML body or timeout is transient and gets **one** retry
([SKILL.md § Do not diagnose the Carta connection](../SKILL.md#do-not-diagnose-the-carta-connection)).

**The retry cap is one, and it is a hard cap.** It counts **the failing operation, not the
call**: if `save_drafts` fails twice, a follow-up `issue_securities` against the same draft set
is not a fresh attempt — it is the third try at the same write, and a traced run burned three
500s that way. A second failure means waiting: re-running the same call against a 502 cannot
succeed, and repeated attempts are the inner-loop thrash this skill's budgets exist to prevent.
Do not vary the call to make a retry look novel, do not fall back to a different tool or a
`discover`/`search_tools` probe, and do not treat an HTML error body as a data payload to parse
— an HTML response to a JSON call is an outage signal, never content.

### Step 3 — Resolve the corporation by name

If the prompt named a company and you don't already have its `corporation_id`, call
`list_accounts(search="<name>")` — **never** an unfiltered `list_accounts()`, which returns a
truncated alphabetical page that may never reach the name you want. `search` is the tool's own
name lookup; don't substitute a `search_tools` guess for it.

**Several exact name matches: probe at most three, then ask.** A real run got **25
corporations named exactly "Meetly"**, re-ran the lookup at `detail="full"` for nothing (it
carries no extra distinguishing field), then swept the list corp by corp — twice — spending 57%
of its calls before any issuance work began. Instead:

1. If the prompt named a holder, probe **at most three** candidates with
   `cap_table:get:stakeholders` — wire `cap_table__get__stakeholders` —
   with `{"corporation_id": <id>, "search": "<that person>"}`.
2. **Stop at the first hit** and use that corporation.
3. If more than one hits, or none does inside three probes, **stop and ask which company**
   with `AskUserQuestion`, listing the candidates by any detail that differs.

**Never sweep the list.** Three probes is a hard cap: a fourth, a re-run of the same sweep with
different arguments, or a loop that "looks different" because the id changed are all the same
bug. Zero matches, or several with no named holder to probe with, go straight to step 3.

### Step 4 — Run the account-level hard stops first

**As soon as you have `security_type` and `corporation_id`, run the account-level hard stops —
before the rest of the reference data, before any collection.** One
`cap_table:get:issuance_init` call answers all of them, and each one ends the run:

- **Option grant:** no plan this grant could issue from — the
  [live-plan check](#blockers--act-on-them-first).
- **Option grant:** `document_sets.count == 0`, and **PIU:** `certificate_share_classes.count
  == 0` — the [account-setup gate](#account-setup-gate-option-grant-and-piu).

Ordering is the whole point. A traced run resolved a company, swept 24 candidates and fetched a
162-row roster before reading the plan list that stopped the run — 36 of its 63 calls spent
ahead of a check that invalidated all of them. The stop costs one call and it is knowable
first, so take it first. Everything the gate reads, Phase 0.5 reuses; it is not an extra fetch.

---

## Phase 0.25 — Ingest an uploaded file

**Skip this phase entirely unless the prompt references a file.** When it does, the file
replaces the prompt as the source of the rows — everything downstream is unchanged. It does not
add a path around any gate: Phase 1 still resolves, Phase 1.5 still saves and validates, Phase 2
still reviews, Phase 3 is still the only mutate.

Supported: `.xlsx` `.xlsm` `.csv` `.tsv` (deterministic) and `.pdf` `.docx` (text extraction).
Parsing is a local script, so the phase needs `Bash(uv run *)`.

**[../issuance-import/SKILL.md](../issuance-import/SKILL.md) owns this phase end to end**: the
Bash check and what to say when there is none, locating the file, both parser runs, merging the
result into the rows, and what to tell the user before the collect. Read it now, follow it, and
come back at [Phase 0.5](#phase-05--configure-the-issuance).

**Never hand-read a workbook.** A column read by eye is how a quantity lands in an
exercise-price field — it is the failure this whole phase exists to prevent, and it is not a
fallback when the parser is unavailable.

Carta's own import template has sheets for out-of-scope types, so an uploaded workbook
routinely contains rows this skill can't issue. This phase skips them and reports the count —
never reshape an RSU row into an option grant to make it fit.

---

## Phase 0.5 — Configure the issuance

Fetch the reference data, run the gates, then collect. Collect **in one batch** — every open
field at once, so the user answers once instead of working through a chain of questions, and so
a single batch can carry genuinely different terms for different people.
[chat-surface.md § 1](chat-surface.md#1-collect--one-batch-and-only-what-is-genuinely-open) owns
the collect itself; this section owns what has to be true before it runs.

**One call, and it is the same call Step 4 already made:**

```
mcp__carta__call_tool({"name": "cap_table__get__issuance_init", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<option_grant|certificate|piu>",
  "stakeholder_names": ["<each person the prompt named>"],
  "include_bootstrap": true, "issue_date": "<YYYY-MM-DD>"}})
```

- **`stakeholder_names`** resolves the people the prompt named alongside the reference data, in
  one round trip. They come back as the payload's `stakeholders` section, at `detail=full`,
  carrying `id`, `full_name`, `email`, `event_relationship` and `kind` per person — the same
  shape as the standalone `cap_table:get:stakeholders` command. **If the prompt named nobody,
  pass no names at all**: there is nobody to resolve yet, and
  [Phase 1](#phase-1--resolve-each-row--reconcile-share-classes) resolves whatever names the
  user gives during the collect.

  > **Never put two people in one `search=`.** It AND-s its whitespace-separated terms, so it
  > matches **one person only**; two names in one `search` come back an empty list with a
  > perfectly healthy `200`. Several people go through `stakeholder_names` (here) or `names=`
  > ([Phase 1](#phase-1--resolve-each-row--reconcile-share-classes), which carries the full
  > rule and what it costs when broken).

- **`include_bootstrap: true`** adds [`blockers`](#blockers--act-on-them-first),
  `blockers_summary` and a `knowns_seed` to the same response for no extra round trip. The seed
  carries what the server could derive — the corporation's legal name, the issuer's LLC flag and
  threshold noun, currency and its candidates, the active FMV rows with their source, and
  `jurisdiction_evidence.signals`. It deliberately does **not** carry a jurisdiction verdict.
- **`issue_date`** is what lets the grant-expiration check run at all. Pass it whenever the run
  knows the date; without it that check downgrades to an `informational` entry carrying each
  plan's derived expiry, and a grant whose expiry lands before its issue date reaches the server
  and is rejected there instead. An unparseable date is **refused, not ignored** — send
  `YYYY-MM-DD` or omit the key.

**The sections it returns, per type** — each with the same `{count, results}` shape as its
standalone command:

- *Option grant* — `vesting_templates`, `acceleration_templates`, `document_sets`,
  `valuations_409a`, `international_valuations`, `option_plans`.
- *Certificate* — `certificate_share_classes`, `legends`, `vesting_templates`,
  `acceleration_templates` (cert vesting is opt-in but needs the same two lists once opted in).
- *PIU* — `certificate_share_classes` (**read as the unit classes**: same endpoint and shape, so
  the section keeps that name and its fallback command), `option_plans`, `vesting_templates`,
  `acceleration_templates`, `document_sets`, `draft_set_init`. **No `legends`, no valuations** —
  a PIU has no legend and no exercise price. Threshold value types are not a section: they are
  the fixed pair `Unit` / `Overall`. `draft_set_init` carries the issuer's `thresholdNoun`
  (`"hurdle"` on the growth-shares preset) and `isLLC`.

Every section is fetched server-side in parallel, so `stakeholder_names` and
`include_bootstrap` cost no extra wall-clock — they remove round trips rather than adding them.

**Partial failure is non-fatal.** A section that failed comes back `null` and is named in the
top-level `errors` array (`[{section, message}]`); fall back to that section's own standalone
command. **The command name is not always the section name** — two of them differ, and both
sit on this fallback path, so they fail exactly when the run is already degraded:

| Failed section | Fallback command | Wire name |
|---|---|---|
| `valuations_409a` | `cap_table:get:409a_valuations` | `cap_table__get__409a_valuations` |
| `international_valuations` | `cap_table:get:valuations` | `cap_table__get__valuations` |
| `option_plans`, `document_sets`, `vesting_templates`, `acceleration_templates`, `legends`, `certificate_share_classes`, `stakeholders` | `cap_table:get:<section name>` | `cap_table__get__<section name>` |

`draft_set_init` has **no** standalone command — it arrives only as a section of this response.
When it is missing, treat its fields as unknown ([PIU eligibility](#piu-check-issuer-eligibility)
and [piu-fields.md](piu-fields.md)), never as `false`.

An empty `errors` means full success — use the payload directly. This is the only fallback path;
the rest of this file just says "from the `issuance_init` payload".

**Read each section under its own name.** Never let one section's `count: 0` stand in for
another's. Exactly one count may stop the flow — the [account-setup
gate](#account-setup-gate-option-grant-and-piu) below, on `document_sets.count` read under that
name and no other. Every other count, zero included, never gates: the collect runs regardless
(engine rule 5).

### Account-setup gate (option grant and PIU)

Runs once, immediately after the `issuance_init` payload is read — before FMV, jurisdiction,
plan, or any collection ([Step 4](#step-4--run-the-account-level-hard-stops-first)) — and
skipped entirely for `certificate`.

**Read the count from its section under that exact name.** A real run aborted a valid
issuance by reading `acceleration_templates`' zero as `document_sets`'
([incidents.md § Reading server data wrong](incidents.md#reading-server-data-wrong)).
`count >= 1` always passes, and no other section's zero ever gates.

| `security_type` | Section | On `count == 0` |
|---|---|---|
| `option_grant` | `document_sets` | **Hard stop** — `document_set_id` is an `always` field on every grant row |
| `piu` | `certificate_share_classes` | **Hard stop** — `prefix` is an `always` field, so the batch could never issue |
| `piu` | `document_sets` | **Soft** — a PIU needs one only when the issuer's own properties demand it, and no MCP command exposes those. Omit the documents question when the list is empty and say the one-liner below; `validate_drafts` decides ([SKILL.md hard rule 4](../SKILL.md#hard-rules)) |
| `certificate` | — | skipped |

Hard stop, before collecting anything:

> *"Your corporation doesn't have any option-grant document templates set up yet. Create one in the Carta app, then come back."*
> *"Your corporation doesn't have any unit classes set up yet. Create one in the Carta app, then come back."*

Soft, one line alongside the collect:

> *"This company has no profits-interest document templates. Carta will reject the issuance if your company requires a grant agreement — set one up in the Carta app if it does."*

**A section that failed to fetch** — `null`, absent, or not the documented `{count, results}`
shape — is a failed fetch, **not** `count: 0`. Run that section's own fallback command and
gate on its count; if the fallback errors too, surface its message verbatim and stop as a
fetch failure, never with a no-templates message. Two things follow, and both have shipped
wrong securities:

- **An absent field is unknown, never a fact.** A read that omits a key may be flag-gated,
  trimmed, or partial. Never tell the user a thing is "not configured" on that basis — say
  what you could not see, or let the server answer.
- **Never silently drop an explicit request.** If the user asked for something and a read
  suggests it is unavailable, send it and surface the server's verdict, or stop and say you
  cannot honor it. Issuing without it ships a security that reads as complete and is not — a
  PIU with no matching interest in the linked operating company.

**Why stopping here doesn't break engine rule 5.** Rule 5 forbids asking for *collectible
fields* before the collect. These fields pick **among existing records** and cannot create one,
so for an `always` field zero records makes it unfillable from any surface and the batch can
never issue — an **account-setup blocker**, the same category as an unreachable Carta MCP,
resolved in the Carta app rather than here. For a *conditional* field (PIU document sets) the
blocker isn't certain, which is why that one is soft.

**The gate reads only the sections in the table above.** It is not a "stop on any empty
section" rule and must not be read as one.

### Blockers — act on them first

`include_bootstrap: true` returns `blockers`, a list of `{key, severity, message, evidence}`,
plus `blockers_summary` (`{total, hard_stop, needs_decision, informational, keys}`). They are
the gate, not advice. **Branch on `key`, never on the message text.** **`blockers` is always
emitted, so an empty list means clean — never read absence as "old server".**

| Severity | What you do |
|---|---|
| `hard_stop` | **Collect nothing.** Stop and tell the user what is wrong, in the blocker's own `message` |
| `needs_decision` | Continue, but put the decision to the human. Never resolve it yourself, and never re-derive a verdict the blocker deliberately withheld |
| `informational` | Note it in the one line you say alongside the collect. Do not block |

The keys:

| Key | Severity | Means |
|---|---|---|
| `option_plan.none_selectable` | `hard_stop` | No plan this grant could issue from — every one expired, or none with shares available |
| `grant_expiration.before_issue_date` | `hard_stop` | The plan-derived expiry lands before the issue date, so the server rejects the grant |
| `grant_expiration.unchecked_no_issue_date` | `informational` | No `issue_date` was passed, so the check above could not run; carries each plan's derived expiry instead |
| `valuation.no_active_fmv` | `needs_decision` | No live valuation to price from |
| `valuation.multiple_active_same_class` | `needs_decision` | An HMRC report's AMV and UMV are both live — the admin picks; leave the exercise price unanswered until they do |
| `jurisdiction.unresolved_conflict` | `needs_decision` | Competing signals and **deliberately no verdict** |

**`jurisdiction.unresolved_conflict` is the one to be careful with.** `jurisdiction_evidence`
holds signals and no ranking on purpose: a ranked field is a default, a default gets taken, and
the wrong one sets real holders' tax treatment. Put the competing evidence to the admin and use
their answer. **Do not run the precedence ladder
[below](#option-grant-resolve-the-fmv-and-the-jurisdiction) over it** — that ladder is for a run
with no blocker to consult, and re-deriving a verdict here is the silent default this blocker
exists to prevent.

**Option grants: no live plan is a `hard_stop`.** `equity_plan_id` is required on the first
mutate, so a corporation with no plan this grant could issue from cannot issue at all — and
nothing downstream says so. The account-setup gate reads `document_sets` and passes, the collect
gathers every field, and the run dies at `save_drafts` after the admin has answered everything.
`option_plan.none_selectable` is the mechanism: it catches expired plans **and** plans with no
available shares. Stop with its message, naming the plan and its date so the admin knows what to
fix:

> *"\<Company\>'s only equity plan, \<name\>, expired on \<MM/DD/YYYY\>. Carta can't issue an
> option grant without a live plan — adopt a new one or extend that one in the Carta app, then
> come back."*

**If `blockers` is absent** — the bootstrap extras failed, or the flag was omitted — run that
one check by hand before collecting: count the `option_plans` rows whose `is_expired` is
**false**, and stop on zero with the same message. The expiry also caps
`grant_expiration_date` ([option-grant-fields.md](option-grant-fields.md#option-grant-row)), so
a plan that expired years ago produces an expiry before the issue date too.

One or more live plans → carry them to [Option-plan
reconciliation](#option-plan-reconciliation-option-grant), which picks among them.

### PIU: check issuer eligibility

Profits interests belong to LLCs and partnerships. **Nothing server-side rejects a PIU on a
C-corp** — not the draft-set views, not the validators — so this check exists only here. Read
`draft_set_init.isLLC` from the `issuance_init` payload:

- **`true`** → continue.
- **`false`** → warn once with `AskUserQuestion` before collecting anything: *"\<Company\> isn't
  set up as an LLC or partnership on Carta, and profits interests are normally issued by one.
  Continue anyway, or switch to certificates?"* Continuing is the admin's call; the server will
  accept it either way.
- **absent or `null`** (the section failed, or the field is missing) → treat as **unknown, not
  as `false`**. Continue without the warning — never block on a failed fetch.

### Option grant: resolve the FMV and the jurisdiction

**Skipped entirely for `certificate` and `piu`** — neither has an exercise price, so there is
no FMV to resolve and no `so_type` jurisdiction to gate.

Both are batch-level: every row in one draft set shares them. Resolve once.

**The FMV is not "the 409A".** A company outside the US prices grants from an EMI, CSOP or
share-price valuation and may have no 409A at all — reading only `valuations_409a` is what left
those admins with an empty exercise price. Prefer `international_valuations`, which covers every
source *including* 409A and carries the currency and status that `valuations_409a` cannot.

Read `international_valuations.active` — already filtered to live valuations server-side, so do
**not** re-derive it from dates. Each row carries `price`, `currency`, `valuation_type`,
`effective_date`, `share_class_type` and `share_class_name`. Then, in this order:

1. **Narrow to the chosen option plan's common share class** (`common_share_class_name` on the
   plan — the fallback to match on when a valuation row omits `share_class_type`). An option
   prices off the plan's common share class, so a live preferred FMV is another class's price
   and is dropped. A corp with an Ordinary share price of 0.75 and a Seed Preferred FMV of 1.00
   must price its options at **0.75**.
2. **Exactly one row survives** → that price is the exercise-price default. Show it tagged
   `(default — current <source>)`, where the source is the rows' shared
   `support_reference_type` — `409A` / `EMI` / `CSOP` / `SHARE_PRICE` (the
   `*_VALUATION_REPORT` wire forms mean the same thing).
3. **Two or more survive on the same class** → **do not pick.** An HMRC report yields both an
   **AMV** (actual market value, discounted for restrictions) and a **UMV** (unrestricted market
   value); nothing in the payload says which a grant is priced from, and the difference changes
   the holder's tax position. Put both to the admin in the collect batch and use their answer.
4. **`active` is empty but `history` isn't** → say when cover ended (the lapsed
   `expiration_date`) rather than just "none on file", and ask for the price.

**If the section is missing** — a US-only corp can be refused it, since it is permissioned
separately, in which case it comes back `null` in `errors`. Fall back to `valuations_409a`
(command `cap_table:get:409a_valuations`): use `current_409a` when its `is_expired` is false,
and treat `is_expired: true` as the expired case.

**Derive the jurisdiction too** — it gates which three `so_type`s the option-type question may
offer ([payload-reference.md § Picklists](payload-reference.md#picklists)), and offering a UK
company ISO/NSO instead of EMI/CSOP hands the holder the wrong tax treatment. Prefer
`jurisdiction_evidence.signals` from the bootstrap seed; where it does not settle the question,
the precedence order is:

1. the active valuation's `currency` (`GBP` → UK, `AUD` → AU, `USD` → US);
2. `option_plans[].scheme_type == "EMI"` → UK;
3. an `EMI`/`CSOP` `support_reference_type` in the valuations payload → UK;
4. otherwise `US` — and say so in the review as `(default — assumed US)`, so a wrong guess is
   visible and correctable rather than silent.

**Never gate the option-type question to all nine types across US/UK/AU at once.** Three, for
the resolved jurisdiction. Set the batch `currency` from the same source the jurisdiction came
from, and remember the payload `currency` and `exemption` are ultimately the per-`so_type`
autofill's ([payload-reference.md](payload-reference.md#so_type-auto-fill-rules)), not this one.

**Then collect** — [chat-surface.md § 1](chat-surface.md#1-collect--one-batch-and-only-what-is-genuinely-open).
Every value in
[its § 4](chat-surface.md#4-computable-defaults--apply-and-show-never-ask) is a default you
stamp and show, never a question. Once the answers are in, map each row's fields onto a resolved
row: [row-mapping.md](row-mapping.md). Then go to Phase 1.

---

## Phase 1 — Resolve each row + reconcile share classes

Your working set is the rows from Phase 0.5 — one entry per grantee/holder, each already
carrying its own quantity and full field set. Phase 1 *resolves* each row; it does **not**
re-collect the person, the quantity, or any field already answered.

**Read [payload-reference.md](payload-reference.md) first if you haven't** — every run. It is
the field contract (engine rule 1) and it governs the mapping you are about to do, most sharply
the per-field date formats. Reading it here rather than before the collect is deliberate:
nothing earlier in the run constructs a payload.

**Resolve from what Phase 0.5 already fetched.** Match each row's name case-insensitively
against the `issuance_init` payload's `stakeholders` section, which carries `full_name`,
`email`, `id`, `kind` and `event_relationship` per person:

- **Exactly one match** → reuse `email`, `event_relationship`, `kind`, `id`. Stamp
  `stakeholder_id` to bypass duplicate detection. Tag `(from existing record)`. **No MCP call.**
- **No match** → the person is new, or was named during the collect after Phase 0.5 fetched
  (routine). Batch *only these misses* into **one** `cap_table:get:stakeholders`
  (`cap_table__get__stakeholders`) call passing
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

**Precedence for the two fields the collect can also supply:** a non-empty `relationship`
stamps `issue_date_relationship`, and `stakeholder_kind` (defaulting to `INDIVIDUAL`) stamps
itself — but **only when the lookup found no match**. For an existing stakeholder the cap-table
record always wins. Tag `(from the collect — new stakeholder)`.

Dropping any of `email`, `issue_date_relationship`, `stakeholder_kind`, or `stakeholder_id`
from a stamped row is a contract violation (engine rule 4).

**Push back on parsing only** — a required field empty, a quantity that isn't a parseable
number, a date that doesn't parse (ask for `YYYY-MM-DD` or `MM/DD/YYYY`), a broken email shape,
or a required price that is `0`/blank, *except* the two legitimate `0` cases: a **ZEPO** grant
and a **certificate/RSA on an LLC**. Everything else is the server's call — don't pre-validate
price-vs-FMV, decimals, future dates, negatives, state codes, exemption picklists, or prefix
format.

### Share-class reconciliation (certificate)

Matching a user-supplied class name, the sole-class-only default, and the
ambiguous-match table: [certificate-fields.md § Share-class
reconciliation](certificate-fields.md#share-class-reconciliation-certificate).

### Unit-class + equity-plan reconciliation (PIU)

Both live in [piu-fields.md § Resolution helpers](piu-fields.md#resolution-helpers-piu). Two
facts differ sharply from the other types: the unit class comes from
`certificate_share_classes`, is carried as `prefix`, and is **labelled "Unit class"**; and the
equity plan is **per row, optional, and never defaulted** — an empty plan issues off the unit
class's own authorized total, a different server-side ceiling, so attaching the only plan
silently changes the pool math. `equity_plan_id` is never passed on a PIU mutate.

### Option-plan reconciliation (option grant)

Use the `option_plans` section from the Phase 0.5 `issuance_init` payload.

- **The collect already answered it** → use that answer. Asking again is a wasted interactive
  wait on a question the user already saw.
- **One non-expired plan** → default silently. Tag `(default — only active plan)`.
- **Multiple non-expired, none answered** → `AskUserQuestion`, one option per plan
  (`"Use \"<name>\" (<available_quantity> available)"`), last option `"Cancel"`.
- **Zero non-expired** → you should never arrive here: [Phase 0.5's live-plan
  check](#blockers--act-on-them-first) already stopped the run. If you do, stop now with that
  same message rather than issuing off an expired plan.
- Skip expired plans (`is_expired: true`); **never recompute** `available_quantity`.

Pass `equity_plan_id` **only on the first mutate** that creates the set — it is locked
server-side after. Also stamp the chosen plan's `name` onto every row as `plan_name`, a
[review-only field](option-grant-fields.md#review-only-fields-option-grant--never-sent-to-the-mutate)
never sent to the mutate.

---

## Phase 1.5 — Save + validate before review (or save-only)

Reached immediately after Phase 1 resolves every row. Saving and validating *before* the review
exists is deliberate: `validate_drafts` runs nearly every check `issue_securities` does — all but
the corp-level missing-signatory check — and it needs an existing `draft_set_id`, so validating
early means saving early too. Reviewing an unvalidated summary means the user first learns of a
rejection at the final confirm, after a draft row has already been created.

Full mechanics — the save-only branch, translating server errors into something sayable,
re-asking, and draft-state bookkeeping: [save-validate-flow.md](save-validate-flow.md).

## Resume an existing draft set

Loading a set by id or name, re-deriving option-grant review-only display fields, and jumping
straight to Phase 2: [resume-flow.md](resume-flow.md#resume-an-existing-draft-set).

---

## Shared resolution helpers

On this path these are the **primary** collection mechanism — nothing else has gathered legend,
vesting, acceleration or document set. Put each one in the
[§ 1 batch](chat-surface.md#1-collect--one-batch-and-only-what-is-genuinely-open) rather than
asking them one at a time. Picklist source, default posture, and what gets stamped are below.

Dividend accrual start date is the one field with no natural place in the batch: it depends on
the resolved share class, so it is asked after the class is known.

### Vesting resolution

Use the `vesting_templates` section from the Phase 0.5 `issuance_init` payload. Render a
compact picker (name + `summary_short` + `vesting_type`). `AskUserQuestion`: one option per
template → `vesting_template: <id>`; `"No vesting"` → leave unset. When set, also collect
`vesting_start_date` (`MM/DD/YYYY`, default `issue_date`) **unless** the template's
`vesting_type` is milestone, which the server defaults — skip that prompt.

| Flow | Default posture | "No vesting" |
|---|---|---|
| Certificate | Opt-in (only if the user volunteers) | Normal |
| PIU | Opt-in (only if the user volunteers) | Normal |
| Option grant | Required server-side | Accepted, but warn — atypical |

### Acceleration resolution

Only if vesting is set. Use the `acceleration_templates` section from the `issuance_init`
payload. `AskUserQuestion`: one option per template → `acceleration_template: <id>`;
`"No acceleration"` → leave unset.

### Type-specific helpers

- **Legend** (certificate) — [certificate-fields.md § Legend
  resolution](certificate-fields.md#legend-resolution-certificate).
- **Dividend accrual start date** (certificate) —
  [certificate-fields.md](certificate-fields.md#dividend-accrual-start-date-resolution).
- **Rule 144 difference reason** (certificate, only when `rule_144_date` ≠ `issue_date`) —
  [certificate-fields.md](certificate-fields.md#rule-144-difference-reason).
- **Exercise periods, document set, board approval** (option grant) —
  [option-grant-fields.md § Resolution
  helpers](option-grant-fields.md#resolution-helpers-option-grant).
- **Unit class, equity plan, threshold value and type, document set, board approval,
  corresponding interest** (PIU) — [piu-fields.md § Resolution
  helpers](piu-fields.md#resolution-helpers-piu). **The unit class is never ranked.** A sole
  class is the default; with two or more, ask — filling it in for the user puts the holder in a
  class nobody chose.

---

## Row templates

Fill literally. Every slot must hold a value before review; a `None` or empty is a skill bug —
reapply the default, re-call the stakeholder lookup, or ask (engine rule 4). Each file also
lists the **review-only** fields stamped alongside the payload, which are display-only and
never sent to the mutate.

- **Certificate** — [certificate-fields.md § Certificate
  row](certificate-fields.md#certificate-row).
- **Option grant** — [option-grant-fields.md § Option-grant
  row](option-grant-fields.md#option-grant-row).
- **PIU** — [piu-fields.md § PIU row](piu-fields.md#piu-row).

## Pre-mutate checklist

Tick before any mutate — Phase 1.5's `save_drafts` / `validate_drafts` included, not just the
final `issue_securities`:

- [ ] `security_type` resolved and passed on every call
- [ ] Every row's `issue_date_relationship`, `email`, `stakeholder_kind` and `stakeholder_id` came from the `issuance_init` `stakeholders` section (or the Phase 1 `names=` lookup), not from the collect alone
- [ ] **Cert:** share class resolved → `prefix`. **Grant:** option plan resolved, `so_type` autofills applied (`currency`, `exemption`). **PIU:** unit class resolved → `prefix`, `threshold_value` and `threshold_value_type` both set, equity plan resolved **or deliberately empty**
- [ ] Every `always` field populated per the row template; pre-save assertion passed (engine rule 4)
- [ ] **For `issue_securities` only:** the review was printed and confirmed (Phase 2 → 3). Phase 1.5's calls precede the review by design, so this doesn't apply to them
- [ ] If retry: `draft_set_id` + each row's `draft_pk` in the payload ([SKILL.md hard rule 3](../SKILL.md#hard-rules))

---

## Build the mutate payload from your Phase-1-resolved rows

Three rules govern the `drafts` payload, and each one fails the whole mutate when got wrong:

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

The date rule bites hardest on an [imported](#phase-025--ingest-an-uploaded-file) batch, where
rows arrive in ISO, so all three `CharField`s need converting — Phases 0.5 and 1 did not touch
them.

**Let the serializer enforce all three** rather than doing it by hand, and pass what it returns
as `drafts` verbatim. `$WORK` is your scratchpad directory:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/scripts/serialize_drafts.py" \
  --security-type <option_grant|certificate|piu> \
  --rows "$WORK/_rows.json" --out "$WORK/_drafts.json"
```

Exit 2 with the row and field named means a date couldn't be read — fix it and re-run rather
than sending it.

Re-run the pre-save assertion (engine rule 4) on the resolved rows, then mutate.

---

## Save as draft (escape hatch)

Runs whenever a save-only save is needed: from
[Phase 1.5](#phase-15--save--validate-before-review-or-save-only), or from the Phase 3 answer
`"Save as draft"`.

```
mcp__carta__call_tool({"name": "cap_table__mutate__save_drafts", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant|piu>",
  "drafts": [ ...rows... ],
  "draft_set_id": <draft_set_id if resuming>, "draft_set_name": <optional, ≤30 chars>,
  "equity_plan_id": <equity_plan_id>}})   # option-grant only, on first save
```

Response `{draft_set_id, drafts:[{temp_id, draft_pk, status}]}` — no top-level `validation`
(`save_drafts` skips it by design), **but each row's `status` still reflects its own save.**
Check it:

- **All success** → the *Saved as draft* [closing](issue-and-close.md#closing).
- **Some errored** → surface verbatim per failing `draft_pk`, recover via
  [mutate-recovery.md](mutate-recovery.md#error-recovery), then re-call
  `save_drafts` (**not** `issue_securities`) with the same `draft_set_id` + each `draft_pk`.
- **All failed** → surface verbatim; *"No drafts saved. Fix the errors above and re-try."* — no
  Drafts-UI link, since there is nothing there to open.

**Never show the success message when any row failed** — the user would believe a partial set
is complete.

## Validate without issuing

```
mcp__carta__call_tool({"name": "cap_table__mutate__validate_drafts", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant|piu>",
  "draft_set_id": <draft_set_id>}})
```

Returns `{validation, duplicates}` only. Interpret with the branching rules above; stop at the
report.

---

## Phase 2 → Closing

Everything from the review gate to the closing line lives in
[issue-and-close.md](issue-and-close.md): Phase 2's review and its single confirmation, Phase 3's
branch table, the `issue_securities` call and its response handling, the success rendering,
draft-row cleanup, and every closing template.

**Read it when you reach Phase 2**, not before — after Phase 1.5 returns clean, or straight
away on a resume.
