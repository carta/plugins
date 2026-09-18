# The issuance engine — build the surface yourself

Read this on the two paths [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) names
**engine + code adapter** and **engine + cowork adapter**: the ones where *you* build the
collection surface and the payload. A panel run reaches it only by falling back — no human to
submit the panel, the tool errored, or the user asked for another surface
([SKILL.md § Falling back](../SKILL.md#6-falling-back-off-this-path)).

The transaction is identical on both; only the surface that collects and reviews it varies.

- **The engine** is this file: resolve `security_type` → fetch reference data → assemble rows →
  `save_drafts` / `validate_drafts` / `issue_securities` → recovery. It never knows which
  surface is in play.
- **The adapter** implements exactly three capabilities. Nothing else may branch on
  environment.

| Adapter | `collectConfig` (0.5) | `showReview` (2) | `confirm` (2→3) |
|---|---|---|---|
| **Cowork** | one `show_widget` form | chat markdown | one `AskUserQuestion` |
| **Code** | `render-panel` config panel | `render-panel` review panel | the panel's **Confirm & Issue** button |

**This file documents the Cowork path**, since that is nearly all fallback usage. If the
surface table selected the Code adapter, read [code-adapter.md](code-adapter.md) **before
Phase 0.25 or Phase 0.5 issues its first Carta call** — its **§0** lists every point where
that adapter diverges, two of which change that call, and anything §0 does not mention behaves
exactly as described here.

Two more reads, each at its own moment:

- **[cowork-adapter.md](cowork-adapter.md)** — the form, the chat review, the confirm, and the
  authoritative per-block field list. Read it **in parallel with the first Carta fetch**, not
  before it: [Phase 0.5](#phase-05--configure-the-issuance)'s `issuance_init` has no dependency
  on it, so reading first only delays it. Skip it entirely on the Code adapter.
- **[payload-reference.md](payload-reference.md)** — the authoritative field contract: types,
  formats, picklists, autofills, date quirks. Read it **before
  [Phase 1](#phase-1--resolve-each-row--reconcile-share-classes)**, on both adapters. Nothing
  earlier builds a payload, and it is the largest file either path reads — pulling it in ahead
  of the collection surface delays the one thing the user is waiting for.

**The type-specific row file waits for `security_type`.** Read
[option-grant-fields.md](option-grant-fields.md), *or*
[certificate-fields.md](certificate-fields.md), *or* [piu-fields.md](piu-fields.md) once that
resolves — exactly one, and never before. Loading the wrong one is pure cost, and a grant run
has no use for Rule 144.

Both paths end the same way: the `issue_securities` mutate
([Phase 3](issue-and-close.md#phase-3--on-confirmation-run-the-mutate)). The host's HITL prompt
on that mutate is the final, irreversible gate — never the review gate.

---

## Engine hard rules

[SKILL.md § Hard rules](../SKILL.md#hard-rules) binds on every path and still binds here. These
six bind on **this** path, because they govern building a surface and a payload by hand.

1. **The field contract lives in [payload-reference.md](payload-reference.md).** Read it before
   constructing any payload. No invented keys.
2. **Templates only — no custom payloads** for legends, vesting, acceleration, or exercise
   periods: *"Custom \<thing\> isn't supported here. Save as draft and finish in the Drafts UI."*
3. **No id sniffing.** Required values come from user input, the stakeholder roster this run
   resolved against (`cap_table:get:stakeholders` at `detail=full`, or the roster file the Code
   path hands its builder), or a documented default — never scraped from another grant or
   certificate. If none of the three applies, ask via `AskUserQuestion`.
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
5. **Never ask who the grantees are before opening the collection surface.** A missing
   recipient is an empty field on the surface, never a chat question — this is the single most
   common way this skill goes wrong. Two sub-rules follow from it:
   - **A bare "N \<securities\>" is a quantity, not a headcount.** *"100 option grants"*,
     *"100 certificates"* — the server's `quantity` field counts shares/options for **one**
     recipient, so with no named people and no plural-**person** language, open **one** blank
     block with `quantity` pre-filled to N (`knowns.rows = [{"quantity": "100"}]`).
   - **Only pre-render multiple blank blocks when the language counts people** — *"100
     employees"*, *"grants for 100 new hires"*, or an explicit list of names. Then
     `knowns.rows` is that many empty dicts, so the surface opens pre-sized.
   - Two questions that are real forks, **not** this forbidden one: a genuinely ambiguous
     quantity-vs-headcount (rare), and *"which file did you mean?"* when the prompt referenced
     a file and [Phase 0.25](#phase-025--ingest-an-uploaded-file) found zero or several
     candidates, or the workbook has several importable sheets. Never ask *who* is in the
     file, and never ask in place of parsing a path the prompt already gave.
6. **Never build a collection surface you cannot prove you have the rules for.** See
   [Confirm this skill actually loaded](#confirm-this-skill-actually-loaded) — run that check
   before the surface, and stop rather than building one from partial context.

The incidents behind these rules — including the ones that look redundant — are in
[incidents.md](incidents.md). Read it before weakening any of them.

## Confirm this skill actually loaded

A `Skill` invocation can return *"Launching skill: carta-issuance"* and inject **no content**.
That has happened: the run carried on from a reference file it had read directly and shipped a
config form whose option-type control was hardcoded to ISO/NSO instead of gated to the corp's
jurisdiction, offering a UK or AU corp the wrong tax treatments. It looked entirely plausible;
nothing failed. A partial load fails *confidently*, so check for it rather than waiting to
notice.

**Before building any collection surface, confirm you can answer all three from content this
run actually loaded — SKILL.md, this file, and the reference files they sent you to — not from
memory:**

| # | Question | Where the answer lives |
|---|---|---|
| 1 | How many numbered items are in [Engine hard rules](#engine-hard-rules), and what does the **last** one say? | this file — the answer is **6**, and it is this check |
| 2 | **Option grant:** name all **three** `so_type`s the resolved jurisdiction allows, and say how you resolved that jurisdiction. **Certificate or PIU:** name the field its row template marks `always` that neither other type has. | grant: [payload-reference.md § Picklists](payload-reference.md#picklists) for the three-per-region table, [Phase 0.5](#option-grant-resolve-the-fmv-and-the-jurisdiction-before-building-the-surface) for the derivation · cert: [certificate-fields.md](certificate-fields.md#certificate-row) · PIU: [piu-fields.md](piu-fields.md#piu-row) |
| 3 | Which builder makes the surface **on the adapter the surface table selected**, which `--security-type` values does it take, and what must you never do instead? | [Phase 0.5](#phase-05--configure-the-issuance) — its table names both |

Question 1 is self-verifying: engine rule 6 *is* this check, so a run that cannot name it is a
run that never loaded this file. Answering "5" means the content is stale or partial — stop.

**If any answer is missing, stop and say so.** Do not build the surface, and do not
reconstruct the rules from a reference file:

> *"The carta-issuance skill didn't load fully, so I don't have the issuance rules in front of
> me. Re-invoke it (or start a fresh message) and I'll pick this up from the top."*

Re-invoking is cheap. A form built on missing rules issues real securities on the wrong tax
treatment, and neither the review nor the server catches it.

**This check has no counterpart on the panel path**, and belongs to this file rather than
SKILL.md, because the failure it catches is a *form built from partial instructions*. When the
server builds the form, a partial skill load cannot produce a wrong one.

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
  Never ask twice.
- **Show the full text of legally binding values** (e.g. the legend body), not just the
  template name.
- **Dates display as `MM/DD/YYYY`** everywhere the user sees them. Payload formats follow
  [payload-reference.md](payload-reference.md).
- **Explain jargon on first use** (Rule 144 date, Section 4(a)(2), INDIVIDUAL, legend).
- **No raw ids or payload field names in customer-facing text — ever**
  ([SKILL.md hard rule 8](../SKILL.md#hard-rules)). Not in headers, status lines, prompts,
  confirmations, or error renderings. Never write the word "ID" (✅ *"looking up Jane"* /
  ❌ *"pulling stakeholder id 12345"*), and never render `(<number>)` after a name. Translate
  payload keys before surfacing them, including when echoing server `banner_errors` back:
  humanize mechanically (`_` → space, Title Case), with the exceptions listed in
  [labels.md](labels.md).

---

## Phase 0 — Preflight

Five steps, in order, **all before any user interaction and before gathering any input.** The
surface is already selected ([SKILL.md](../SKILL.md#pick-the-surface)), and that selection is
free. Steps 2–5 are the only round trips this preflight may spend: one `ToolSearch`, one
connectivity check, one `list_accounts` (plus at most three disambiguation probes), and one
`issuance_init` that doubles as the account-level hard stop. Phase 0.5 then spends **one** more on Cowork
(`issuance_init`, which carries the stakeholder lookup with it) or **one** on Code (the
bootstrap CLI call).

### Step 1 — What the surface selection changes before your first Carta call

| | Cowork | Code |
|---|---|---|
| Phase 0.5 producer | `cap_table:get:issuance_init`, with `stakeholder_names` for the people the prompt named; they come back as the payload's `stakeholders` section | the same `cap_table:get:issuance_init` call, plus one `cap_table:get:stakeholders` for the full roster the panel's autocomplete needs. Write both results to files and pass them by path — never retype one into a heredoc ([code-adapter.md §1](code-adapter.md#1-config-panel-build_configpy-builds-every-block)). A CLI that has `carta web download issuance-bootstrap` can do both in one call and compute `blockers` too; check with `carta web download --help` before using it, and fall back to the two commands when it is absent |
| Phase 1 match set | that `stakeholders` section | the full roster (`STAKEHOLDER_LIST_JSON`). **There is no `stakeholders` section on this path** — matching against one finds nothing and every grantee is classified new |
| Phase 0.5 fetch budget | 1 call | 1 call |
| Blockers | none — the gates below are all there is | none from `issuance_init`; run the [hard stops](#step-5--run-the-account-level-hard-stops-first) yourself. Where the bootstrap CLI is present it computes `blockers` server-side and they are binding ([Blockers](#blockers--act-on-them-before-building-anything)) |

Everything else the adapters differ on is a *surface* difference, not a call difference.
**A Cowork run needs nothing further from either adapter file until it builds the surface.**
**A Code run must read [code-adapter.md](code-adapter.md) §0 before Phase 0.25 or Phase 0.5
issues anything** — §0 carries the remaining overrides, and reading it after the call is
already formed is what produced a wasted second roster fetch.

Every bare `preview_start` / `preview_list` / `preview_eval` in this file and its references
means the resolved, possibly prefixed name from the tool list — or `javascript_tool` as the
eval fallback.

### Step 2 — Load every tool in ONE ToolSearch call

```
ToolSearch: "select:mcp__carta__call_tool,mcp__carta__search_tools,mcp__carta__welcome,mcp__carta__list_accounts"
```

`mcp__carta__` is the placeholder prefix
([Step 2a](#step-2a--carta-command-names-hardcoded-never-discovered)) — when the session's
Carta tools carry a different prefix, substitute it into the `select:` string; the names after
the prefix never change. Zero matches on the literal `mcp__carta__` names means the wrong
prefix, not a disconnected server — re-check the session's tool list before treating it as the
Step 3 stop.

One call, four tools, the complete set for the run. **`call_tool` is loaded here, up front**,
so Phase 2 never has to load it after the user confirms — that would be serial latency at the
worst possible moment. On the Cowork path, add `mcp__visualize__show_widget` to the same
`select:` list if it isn't already loaded.

**Don't call `search_tools` in the hot path.** Every command name is hardcoded below, and
`call_tool` reaches all of them directly; looking up a name you already know is a pure round
trip. `search_tools` is for a command this file does not name.

### Step 2a — Carta command names (hardcoded, never discovered)

Reads and writes both go through **one** tool, `call_tool`. It takes `name` and
`arguments` — and the name carries **double underscores** where this skill's prose uses
colons:

```
mcp__carta__call_tool({"name": "cap_table__get__<noun>",    "arguments": {…}})
mcp__carta__call_tool({"name": "cap_table__mutate__<noun>", "arguments": {…}})
```

**Translate every command name in this file the same way**: the table below reads
`cap_table:get:issuance_init`, and the wire name is `cap_table__get__issuance_init`. Colons in
prose, double underscores in the call; `arguments`, never `params`. Getting either wrong costs
a round trip on an `Unknown tool` or an argument-shape rejection.

**`mcp__carta__` is a placeholder** — here, in every code block below, and in every reference
file. The real prefix is environment-dependent (`mcp__carta-test__call_tool`, plugin-scoped and
UUID-suffixed connector forms all occur). Resolve it from the session's tool list and
substitute it everywhere; only the prefix varies — tool and command names never do. The one
exception: SKILL.md's frontmatter `allowed-tools` entries are literal grant patterns — never
substitute there.

**Record `BASE_URL` here too**, from the session's `get_current_user` result — it returns
`base_url` (e.g. `https://demo.carta.team`) alongside `environment`. Every Carta link this
skill emits is built from it, because a hardcoded host sends the user into a different
environment than the one they just wrote to. Never derive it from the tool prefix. If it is
genuinely absent, say the environment is unknown rather than assuming production.

#### The connected Carta must be the intended Carta — check before the first call

**A Carta server being connected is not evidence it is the right one.** `corporation_id` is
not unique across environments: corp 3 on demo is a different company from corp 3 on
production or on a local stack, so aiming at the wrong one does not fail — it reads one
company's cap table and later issues real securities onto it.

Resolve the connected environment before Phase 0.25 or 0.5 calls anything: the tool prefix
names it (`…_Carta_Demo__` → demo, a `-test` or sandbox suffix likewise, unsuffixed →
production) and `get_current_user`'s `environment` / `base_url` confirm it.

- **The request names no environment** → the connected one is the intended one. Continue,
  say nothing.
- **The request names or implies one** — a host, a Carta link, "local", "metal", "sandbox",
  "demo", "production" — **and it differs** → **hard stop before the first Carta call.**
- **Two Carta surfaces are connected and they disagree**, or you are mixing `carta web …` with
  MCP calls and cannot establish that both resolve to the same environment → **hard stop.**

> *"Your Carta connection points at \<connected\>, and this request looks like it's about
> \<intended\>. Corporation ids don't match across environments, so I'd be reading — and then
> writing to — the wrong company. Confirm which environment you want, or connect that Carta
> server."*

**Never settle this yourself** by using the connected server because it is the only one
present. Being the only option is not the same as being the right one.

| Purpose | Command (prose form) | Wire name for `call_tool` |
|---|---|---|
| Reference data for the collection surface, **plus named stakeholders** via `stakeholder_names` | `cap_table:get:issuance_init` | `cap_table__get__issuance_init` |
| Stakeholder lookup for a roster **miss** — pass `names=` for several, `search=` for exactly one | `cap_table:get:stakeholders` | `cap_table__get__stakeholders` |
| Load an existing set's rows | `cap_table:get:load_drafts` | `cap_table__get__load_drafts` |
| List draft sets (resume by name) | `cap_table:list:draft_sets` | `cap_table__list__draft_sets` |
| Cap-table totals for context math — authorized, outstanding, fully diluted, ownership % | `cap_table:get:cap_table_by_share_class` | `cap_table__get__cap_table_by_share_class` |
| Save rows, no validation | `cap_table:mutate:save_drafts` | `cap_table__mutate__save_drafts` |
| Validate a saved set | `cap_table:mutate:validate_drafts` | `cap_table__mutate__validate_drafts` |
| Save + validate + dedupe + issue | `cap_table:mutate:issue_securities` | `cap_table__mutate__issue_securities` |
| Resolve flagged duplicates | `cap_table:mutate:resolve_duplicate_stakeholder` | `cap_table__mutate__resolve_duplicate_stakeholder` |

> **The totals source has a breakdown-sounding name.** `cap_table:get:cap_table_by_share_class`
> — `corporation_id` alone — returns authorized, outstanding, fully diluted, and ownership %.
> Context math only (e.g. percent-of-fully-diluted for a grant), never a payload source. There
> is no `cap_table:get:cap_table_summary`, and the similar-sounding `cap_table_summary_report`
> belongs to a different plugin; the row above is this skill's totals source.

**`call_tool` is the surface; the `fetch`/`mutate` gateway pair is not.** The runtime's tool
descriptions deprecate `fetch` in favour of `call_tool`, and on a normal session that is the
whole story: the gateway pair sits behind a flag that defaults off, so `mcp__carta__fetch`
comes back *"No such tool available"* and a `ToolSearch` for it resolves nothing. Load
`call_tool` (Step 2) and address every command by its double-underscore wire name. Scope and
staff checks are enforced inside the command executor either way. Full story:
[incidents.md § Round-trips](incidents.md#round-trips-that-bought-nothing).

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

**The retry cap is one, and it is a hard cap.** It counts **the failing operation, not the
call**: if `save_drafts` fails twice, a follow-up `issue_securities` against the same draft set
is not a fresh attempt — it is the third try at the same write, and a traced run burned three
500s that way. A second failure means waiting: re-running the same call against a 502 cannot
succeed, and repeated attempts are the inner-loop thrash this skill's budgets exist to
prevent. Do not vary the call to make a retry
look novel, do not fall back to a different tool or a `discover`/`search_tools` probe, and do not
treat an HTML error body as a data payload to parse — an HTML response to a JSON call is an
outage signal, never content.

### Step 4 — Resolve the corporation by name

If the prompt named a company and you don't already have its `corporation_id`, call
`list_accounts(search="<name>")` — **never** an unfiltered `list_accounts()`, which returns a
truncated alphabetical page that may never reach the name you want. `search` is the tool's own
name lookup; don't substitute a `search_tools` guess for it.

**Several exact name matches: probe at most three, then ask.** A real run got **25
corporations named exactly "Meetly"**, re-ran the lookup at `detail="full"` for nothing (it
carries no extra distinguishing field), then swept the list corp by corp — twice — spending 57%
of its calls before any issuance work began. Instead:

1. If the prompt named a holder, probe **at most three** candidates with
   `cap_table:get:stakeholders(corporation_id=<id>, search="<that person>")`.
2. **Stop at the first hit** and use that corporation.
3. If more than one hits, or none does inside three probes, **stop and ask which company**
   with `AskUserQuestion`, listing the candidates by any detail that differs.

**Never sweep the list.** Three probes is a hard cap: a fourth, a re-run of the same sweep with
different arguments, or a loop that "looks different" because the id changed are all the same
bug. Zero matches, or several with no named holder to probe with, go straight to step 3.

### Step 5 — Run the account-level hard stops first

**As soon as you have `security_type` and `corporation_id`, run the account-level hard stops —
before the roster, before the rest of the reference data, before any surface work.** One
`cap_table:get:issuance_init` call answers all of them, and each one ends the run:

- **Option grant:** no plan this grant could issue from — the
  [live-plan check](#blockers--act-on-them-before-building-anything).
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
Parsing is a local script, so the phase needs `Bash(uv run *)` — present on the Code adapter,
not guaranteed on Cowork.

**[../issuance-import/SKILL.md](../issuance-import/SKILL.md) owns this phase end to end**: the
Bash check and what to say when there is none, locating the file, both parser runs, the roster
half of Phase 0.5's fetches, merging the result into `knowns.rows`, and what to tell the user
before the surface opens. Read it now, follow it, and come back at
[Phase 0.5](#phase-05--configure-the-issuance).

**Never hand-read a workbook.** A column read by eye is how a quantity lands in an
exercise-price field — it is the failure this whole phase exists to prevent, and it is not a
fallback when the parser is unavailable.

Carta's own import template has sheets for out-of-scope types, so an uploaded workbook
routinely contains rows this skill can't issue. This phase skips them and reports the count —
never reshape an RSU row into an option grant to make it fit.

---

## Phase 0.5 — Configure the issuance

Collect everything on **one** surface — every field, per stakeholder — so the user submits once
instead of answering a chain of questions, and so a single batch can carry genuinely different
terms for different people. This is the engine's `collectConfig`; the selected adapter decides
what the surface is.

**Fetch the reference data first, and issue every call below in ONE assistant turn.** They have
no dependencies on each other; serial fetches here are pure latency.

**On Code the producer is the same `issuance_init` call**, plus one `cap_table:get:stakeholders`
for the full roster the panel's autocomplete needs — issued together in one turn, each result
written to a file and passed by path
([code-adapter.md §1](code-adapter.md#1-config-panel-build_configpy-builds-every-block)).

> **If this CLI has `carta web download issuance-bootstrap`**, it replaces both calls: it writes
> every section, the full roster and a knowns seed to files and computes
> [blockers](#blockers--act-on-them-before-building-anything) server-side. It is absent from
> released `carta-web-cli` through 27.24.0, so **check `carta web download --help` first** and
> use the two commands above when it is not listed. Never let a missing subcommand become a
> hand-read of the reference data.

- **Stakeholder lookup — Cowork** — pass the people the prompt named as `stakeholder_names` on
  the **same** `issuance_init` call below. The server resolves them alongside the reference
  data in one round trip, and they come back as that payload's `stakeholders` section, same
  shape as the standalone `cap_table:get:stakeholders` command. There is no separate
  stakeholder fetch here. **If the prompt named nobody, pass no names at all**: there is nobody
  to resolve yet, and [Phase 1](#phase-1--resolve-each-row--reconcile-share-classes) resolves
  whatever names the user types into the form.
  **On Code there is no name list to pass** — the bootstrap writes the full roster to a file
  ([Step 1](#step-1--what-the-surface-selection-changes-before-your-first-carta-call)).

  > **Never put two people in one `search=`.** It AND-s its whitespace-separated terms, so it
  > matches **one person only**; two names in one `search` come back an empty list with a
  > perfectly healthy `200`. Several people go through `stakeholder_names` (here) or `names=`
  > ([Phase 1](#phase-1--resolve-each-row--reconcile-share-classes), which carries the full
  > rule and what it costs when broken).
- **Reference data** — `cap_table:get:issuance_init` with the active `security_type`, plus
  `stakeholder_names` on Cowork when the prompt named people. **One call** returns every
  section the surface and Phase 1 need, each with the same `{count, results}` shape as its
  standalone command:
  - *Option grant* — `vesting_templates`, `acceleration_templates`, `document_sets`,
    `valuations_409a`, `international_valuations`, `option_plans`.
  - *Certificate* — `certificate_share_classes`, `legends`, `vesting_templates`,
    `acceleration_templates` (cert vesting is opt-in but needs the same two lists once opted in).
  - *PIU* — `certificate_share_classes` (**read as the unit classes**: same endpoint and
    shape, so the section keeps that name and its fallback command), `option_plans`,
    `vesting_templates`, `acceleration_templates`, `document_sets`, `draft_set_init`. **No
    `legends`, no valuations** — a PIU has no legend and no exercise price. Threshold value
    types are not a section: they are the fixed pair `Unit` / `Overall`. `draft_set_init`
    carries the issuer's `thresholdNoun` (`"hurdle"` on the growth-shares preset) and `isLLC`.
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
  gate](#account-setup-gate-option-grant-and-piu) below, on `document_sets.count` read under that
  name and no other. Every other count, zero included, never gates: the surface is built and
  opened regardless (engine rule 5).

### Account-setup gate (option grant and PIU)

Runs once, immediately after the `issuance_init` payload is read — before FMV, jurisdiction,
plan, or any surface work, and before the roster
([Step 5](#step-5--run-the-account-level-hard-stops-first)) — and skipped entirely for
`certificate`. Both adapters run it.

**Read the count from its section under that exact name.** A real run aborted a valid
issuance by reading `acceleration_templates`' zero as `document_sets`'
([incidents.md § Reading server data wrong](incidents.md#reading-server-data-wrong)).
`count >= 1` always passes, and no other section's zero ever gates.

| `security_type` | Section | On `count == 0` |
|---|---|---|
| `option_grant` | `document_sets` | **Hard stop** — `document_set_id` is an `always` field on every grant row |
| `piu` | `certificate_share_classes` | **Hard stop** — `prefix` is an `always` field, so the batch could never issue |
| `piu` | `document_sets` | **Soft** — a PIU needs one only when the issuer's own properties demand it, and no MCP command exposes those. Both builders omit the Documents row when the list is empty, so there is nothing to do beyond the one-liner below; `validate_drafts` decides ([SKILL.md hard rule 4](../SKILL.md#hard-rules)) |
| `certificate` | — | skipped |

Hard stop, before building any surface:

> *"Your corporation doesn't have any option-grant document templates set up yet. Create one in the Carta app, then come back."*
> *"Your corporation doesn't have any unit classes set up yet. Create one in the Carta app, then come back."*

Soft, one line alongside the surface:

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
fields* before the surface opens. These fields pick **among existing records** and cannot
create one, so for an `always` field zero records makes it unfillable from any surface and the
batch can never issue — an **account-setup blocker**, the same category as an unreachable Carta
MCP (Phase 0 Step 3), resolved in the Carta app rather than on this surface. For a
*conditional* field (PIU document sets) the blocker isn't certain, which is why that one is
soft.

**The gate reads only the sections in the table above.** It is not a "stop on any empty
section" rule and must not be read as one.

### Blockers — act on them before building anything

Where Phase 0.5's producer returns `blockers`, they are the gate, not advice. Each entry is
`{key, severity, message, evidence}`; branch on `key`, never on the message text. **`blockers`
is always emitted, so an empty list means clean — never read absence as "old server".**

| Severity | What you do |
|---|---|
| `hard_stop` | **Do not build the surface.** Stop and tell the user what is wrong, in the blocker's own `message` |
| `needs_decision` | Build the surface, but put the decision to the human. Never resolve it yourself, and never re-derive a verdict the blocker deliberately withheld |
| `informational` | Note it in the one line you say alongside the surface. Do not block |

**Pass the intended issue date to the producer whenever the run knows it.** Without it the
grant-expiration check cannot run at all and downgrades to an `informational` entry carrying
each plan's derived expiry — so a grant whose expiry lands before its issue date reaches the
server and is rejected there instead.

**Option grants: no live plan is a `hard_stop`.** `equity_plan_id` is required on the first
mutate, so a corporation with no plan this grant could issue from cannot issue at all — and
nothing downstream says so. The account-setup gate reads `document_sets` and passes, the
surface builds and collects every field, and the run dies at `save_drafts` after the admin has
filled the whole thing in. `option_plan.none_selectable` is the mechanism: it catches expired
plans **and** plans with no available shares. Stop with its message, naming the plan and its
date so the admin knows what to fix:

> *"\<Company\>'s only equity plan, \<name\>, expired on \<MM/DD/YYYY\>. Carta can't issue an
> option grant without a live plan — adopt a new one or extend that one in the Carta app, then
> come back."*

**Where no producer returns blockers** — the Cowork path, or the Code fallback when the CLI
has no `issuance-bootstrap` — run that one check by hand before building: count the
`option_plans` rows whose `is_expired` is **false**, and stop on zero with the same message.
The expiry also caps `grant_expiration_date`
([option-grant-fields.md](option-grant-fields.md#option-grant-row)), so a plan that expired
years ago produces an expiry before the issue date too.

One or more live plans → carry them to [Option-plan
reconciliation](#option-plan-reconciliation-option-grant), which picks among them.

### PIU: check issuer eligibility (before building the surface)

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

### Option grant: resolve the FMV and the jurisdiction (before building the surface)

**Skipped entirely for `certificate` and `piu`** — neither has an exercise price, so there is
no FMV to resolve and no `so_type` jurisdiction to gate.

Both are batch-level: every row in one draft set shares them. Resolve once, pass in `knowns`.

**The FMV is not "the 409A".** A company outside the US prices grants from an EMI, CSOP or
share-price valuation and may have no 409A at all — reading only `valuations_409a` is what left
those admins with an empty exercise price. Prefer `international_valuations`, which covers every
source *including* 409A and carries the currency and status that `valuations_409a` cannot.

Read `international_valuations.active` (already filtered to live valuations server-side — do
**not** re-derive it from dates) and set four `knowns` keys, specified in full in the shared
[`knowns` table](code-adapter.md#1-config-panel-build_configpy-builds-every-block):
`fmv_options` (every `active` row **as-is**, keeping `share_class_type` and `share_class_name`
alongside `price`, `currency`, `valuation_type`, `effective_date`), `fmv_source` (their shared
`support_reference_type`), `fmv_expired_on` (only when `active` is empty and `history` isn't),
and `common_share_class_name` (the chosen plan's). The builder derives the hint and the prefill
from these — don't pre-compute either, and pass every active row.

> **Never filter or choose among the active rows; that is the surface's job.** Two on the
> **same** class is a real question for the admin — an HMRC report yields both an **AMV**
> (actual market value, discounted for restrictions) and a **UMV** (unrestricted market value),
> nothing in the payload says which a grant is priced from, and the difference changes the
> holder's tax position — so the surface leaves the field empty. Do not "help" by filling one
> in. Two on **different** classes is not a choice at all: an option prices off the plan's
> common share class, so a live preferred FMV is another class's price and the surface drops
> it. A corp with an Ordinary share price of 0.75 and a Seed Preferred FMV of 1.00 must price
> its options at **0.75**.

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
[code-adapter.md § knowns](code-adapter.md#1-config-panel-build_configpy-builds-every-block).

**The surface's fields** — one full key-value block per stakeholder, every field inside that
person's own block, so a batch can issue genuinely different terms to different people. The
authoritative enumeration for both adapters is
[cowork-adapter.md § Fields](cowork-adapter.md#fields); it also covers batch mode
(shared terms once + a compact name/email/quantity table) for large identical-term batches.

**First, [confirm this skill actually loaded](#confirm-this-skill-actually-loaded)** — engine
rule 6. This is the gate that check exists for: everything below builds the surface, and a
surface built on partial context looks right and issues the wrong tax treatment.

**Build the surface with its script, never by hand.** Write `_data.json` and `_knowns.json`
and run the builder for the selected adapter.

**A fetched result reaches the builder as a file whenever it can.** Retyping one into a
heredoc is dead time with no tool call in it — one traced run spent 129 seconds on a roster.
So: if it has a CLI producer, redirect it to disk and pass the path; if it arrived through MCP
and exists only in your context, write it out **once** and derive anything else from that
file. Never transcribe the same result twice.

**On Code, clear the cache directory's `_draft_state.json` before you build.** `OUT_DIR` is
keyed only by `corporation_id` and persists indefinitely, so a file left there by an unrelated
earlier session on the same corp reuses the same `r0`/`r1` row keys and threads a stranger's
`draft_pk` onto these rows. The `rm -f` is part of the
[§1 recipe](code-adapter.md#1-config-panel-build_configpy-builds-every-block);
Cowork holds this state in context and has nothing to clear.

| Adapter | Builder | `--security-type` | Then |
|---|---|---|---|
| Cowork | `build_cowork_form.py` | `option_grant` · `certificate` · `piu` | pass its output verbatim as `show_widget`'s `widget_code` and wait for the `sendPrompt()` reply — [cowork-adapter.md §1](cowork-adapter.md#1-collectconfig--the-show_widget-form) |
| Code | `build_config.py` | `option_grant` · `certificate` · `piu` | assemble `SUB_FLAGS` and invoke `render-panel` — [code-adapter.md §1](code-adapter.md#1-config-panel-build_configpy-builds-every-block) |

A hand-built surface re-rolls the same dice every run — one traced run wrote a literal
`'+today+'` as a board approval date and dropped three required controls. **Do not call
`read_me`**: the generated document is already complete, so that is ~5k tokens for nothing.

**Never express this as a chain of `AskUserQuestion`s**: it is an option-picker that cannot take
a free-text quantity, price, date, or name, so one prompt per field is the exact serial
interrogation this phase exists to eliminate. Reserve `AskUserQuestion` for genuinely blocking
single choices — an ambiguous `security_type`, a multi-plan pick, the Phase 2 confirm.

**On submit** — the `sendPrompt()` JSON on Cowork, the panel's action-request file on Code,
same shape — take the returned `rows` as your working set and map each row's own fields onto a
resolved row: [row-mapping.md](row-mapping.md). Then go to Phase 1.

---

## Phase 1 — Resolve each row + reconcile share classes

Your working set is the `rows` from Phase 0.5 — one entry per grantee/holder, each already
carrying its own quantity and full field set. Phase 1 *resolves* each row; it does **not**
re-collect the person, the quantity, or any field the surface already carries.

**Read [payload-reference.md](payload-reference.md) first if you haven't** — both
adapters, every run. It is the field contract (engine rule 1) and it governs the mapping you
are about to do, most sharply the per-field date formats. Reading it here rather than before
the surface is deliberate: nothing earlier in the run constructs a payload.

**Resolve from what Phase 0.5 already fetched.** Match each `rows[].name` case-insensitively
against **that adapter's match set** — on Cowork the `issuance_init` payload's `stakeholders`
section, on Code the full roster you fetched alongside it (`STAKEHOLDER_LIST_JSON`); there is
no `stakeholders` section on the Code path, and matching against a section that isn't there
finds nothing, classifies every grantee as new, and creates **duplicate stakeholders on a real
cap table**. Either set carries `full_name`, `email`, `id`, `kind`, and `event_relationship`
per person:

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

- **The surface already collected one** → use it. The form renders an Equity plan field, so a
  submitted row carrying `option_plan` has been answered; asking again is a wasted interactive
  wait on a question the user already saw.
- **One non-expired plan** → default silently. Tag `(default — only active plan)`.
- **Multiple non-expired, none collected** → `AskUserQuestion`, one option per plan
  (`"Use \"<name>\" (<available_quantity> available)"`), last option `"Cancel"`.
- **Zero non-expired** → you should never arrive here: [Phase 0.5's live-plan
  check](#blockers--act-on-them-before-building-anything) already stopped the
  run before the surface was built. If you do, stop now with that same message rather than
  issuing off an expired plan.
- Skip expired plans (`is_expired: true`); **never recompute** `available_quantity`.

Pass `equity_plan_id` **only on the first mutate** that creates the set — it is locked
server-side after. Also stamp the chosen plan's `name` onto every row as `plan_name`, a
[review-only field](option-grant-fields.md#review-only-fields-option-grant--never-sent-to-the-mutate)
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
[save-validate-flow.md](save-validate-flow.md).

## Resume an existing draft set

Loading a set by id or name, re-deriving option-grant review-only display fields, and jumping
straight to Phase 2: [resume-flow.md](resume-flow.md#resume-an-existing-draft-set).

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
  helpers](piu-fields.md#resolution-helpers-piu). **The unit class is a surface
  field that arrives resolved only when the prompt named a class.** With none named the
  builder pre-selects a sole class and otherwise leaves the control unselected, blocking
  submission until a human picks — never fill it in for them.

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
- [ ] Every row's `issue_date_relationship`, `email`, `stakeholder_kind` and `stakeholder_id` came from the roster the run actually resolved against — the `issuance_init` `stakeholders` section on Cowork, the roster file handed to the builder on Code — not from the surface alone
- [ ] **Cert:** share class resolved → `prefix`. **Grant:** option plan resolved, `so_type` autofills applied (`currency`, `exemption`). **PIU:** unit class resolved → `prefix`, `threshold_value` and `threshold_value_type` both set, equity plan resolved **or deliberately empty**
- [ ] Every `always` field populated per the row template; pre-save assertion passed (engine rule 4)
- [ ] **For `issue_securities` only:** the review surface was opened and confirmed (Phase 2 → 3). Phase 1.5's calls precede the review by design, so this doesn't apply to them
- [ ] If retry: `draft_set_id` + each row's `draft_pk` in the payload ([SKILL.md hard rule 3](../SKILL.md#hard-rules))

---

## Build the mutate payload from your Phase-1-resolved rows

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
([cowork-adapter.md § Draft state](cowork-adapter.md#draft-state-on-this-path)), and
it is an unknown field to the server.

**On Code — run the serializer**, which enforces all three, and pass what it returns as `drafts`
verbatim:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/scripts/serialize_drafts.py" \
  --security-type <option_grant|certificate|piu> \
  --rows "$OUT_DIR/_review_rows.json" --out "$OUT_DIR/_drafts.json"
```

Exit 2 with the row and field named means a date couldn't be read — fix it and re-run rather
than sending it.

Re-run the pre-save assertion (engine rule 4) on the resolved rows, then mutate.

---

## Save as draft (escape hatch)

Runs whenever a save-only save is needed: from [Phase 1.5](#phase-15--save--validate-before-review-or-save-only)'s
**Save** button (the common case, both adapters), or from the Phase 3 answer `"Save as draft"`
(Cowork only).

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
[issue-and-close.md](issue-and-close.md): Phase 2's review surface and its single confirmation,
Phase 3's branch table, the `issue_securities` call and its response handling, the success
rendering, draft-row cleanup, and every closing template.

**Read it when you reach Phase 2**, not before — after Phase 1.5 returns clean, or straight
away on a resume. Both adapters reach it the same way, and by then the surface the user was
waiting on is already open (Code) or already submitted (Cowork).
