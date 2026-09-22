---
name: carta-issuance
description: >-
  Issue securities on a Carta cap table. Use when the user asks to issue
  certificates, stock certificates, option grants (ISO, NSO, EMI, CSOP,
  Unapproved, Startup Concessions, Non-Concessional, ZEPO), profits interest
  units (PIUs), to draft shares, grants or units, or to resume issuing from a
  draft set. USE WHEN the user says "issue", "grant", "draft", "award", "give
  equity", "give shares", "give stock", "create a certificate", "create a
  grant", "issue a profits interest", "issue PIUs", "grant profits interest
  units", "set up an option grant", "issue equity to a named person", or names
  any specific security type above. Also USE WHEN the user points at a
  spreadsheet, CSV, Carta import template, or a grant/award document as the
  source of the issuance ("issue the grants in this file", "here's our import
  template").
model: inherit
allowed-tools:
  - AskUserQuestion
  - Skill
  - Read
  - Write
  - Artifact
  - Bash(uv run *)
  - Bash(mkdir *)
  - Bash(cat *)
  - Bash(test *)
  - Bash(ls *)
  # No `Bash(find *)`: the surface comes from the tool list, not the disk.
  # `mcp__carta__*` is literal here; in prose it stands for the session prefix.
  - mcp__carta__call_tool
  - mcp__carta__search_tools
  - mcp__carta__list_accounts
  - mcp__carta__welcome
  - mcp__carta__get_current_user
  - mcp__carta__cap_table_issuance_panel
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.88.2</carta-plugin>

# Issue Securities

From raw input to issued securities on a Carta cap table. These three types, and no others:

| Type | Example prompt |
|---|---|
| Certificate | "1 cert for Jane Doe, 1000 Series A at $1.50." |
| Option grant | "1000 ISOs to Jane at $1.50 on the 2024 Plan." |
| Profits interest unit | "5,000 CC units to Jane, $2.00 per-unit threshold." |

A spreadsheet or award document sources those same three types; *"resume draft set 472"*
re-enters a saved one. To **fix** an already-issued security, use `carta-modify-issuables`.

**Out of scope** — stop and route to the Drafts UI for RSUs, SARs, CBUs, warrants,
convertibles, SAFEs, convertible debt, and for anything **custom**: a legend, schedule or
exercise period the corporation has no template for. Picking one it does have is in scope,
and a grant's vesting schedule is the normal case, not a deflection.

> *"This skill issues certificates, option grants and profits interest units today. For \<thing\>, use the Drafts UI in the Carta app."*

## Carta is connected — read this before you conclude otherwise

**An opaque tool prefix is not a disconnected server.** On most hosts the Carta tools
arrive prefixed with a session UUID — `mcp__33b9b857-…__call_tool`. Match on the
**suffix**, never on the literal string `mcp__carta__…`, and never on a readable name.

Two things that look like "Carta is not connected" and are not:

- **A `carta` entry in a "needs authentication" list.** That is a *local* stdio server, not
  the Carta connector — which can be working fine while that entry sits unauthenticated.
- **A 5xx, a gateway error, or an HTML body** from a Carta call. Transient: retry the
  operation exactly once, then report a temporary problem. Never an auth failure.

**Say nothing about the connection until a `ToolSearch` for those suffixes has come back
empty.** It settles this in milliseconds and is the only evidence that does — a real run
declared a live connector dead off the `authenticate` entry alone and threw its turn away.
Only when **no** tool ending in `call_tool` / `list_accounts` / `welcome` exists, under any
prefix, is Carta genuinely absent. Say so then, and stop.

## Pick the surface

Take the **first** row that matches. Every row reads **your own tool list** — never the
disk, never an env var — and matches on the **suffix**.

| Condition | Surface |
|---|---|
| the user asked for a **different surface** than the one you would pick | the one they asked for |
| a tool whose name **ends in** `cap_table_issuance_panel` | **panel** — [§ The panel](#the-panel) |
| the **`Artifact`** tool is present | **artifact** — [references/artifact-surface.md](references/artifact-surface.md) |
| else | **chat** — [references/chat-surface.md](references/chat-surface.md) |

Record the selection once. Never re-detect.

The panel and the artifact both render a real form that collects, saves and validates on
its own, and neither puts its HTML anywhere near your context. They are the two good
paths. The chat surface exists for a host that has neither, and it is the only path that
spends your turns on data entry.

**Never render a form with `show_widget` or `preview_start`**, whatever else is missing.
A widget is for one small question or one short status; an issuance form rendered in one
cannot be submitted at all on some hosts
([incidents.md](references/incidents.md#surfaces-that-cannot-carry-a-form)).

## Resolve `security_type`

Resolve once, at the top. Pass on every draft-set tool call.

| Cue | `security_type` |
|---|---|
| "cert", "certificate", "shares", "Series A", "common", "membership units" | `certificate` (default) |
| "option", "ISO", "NSO", "grant" (with plan), "EMI", "CSOP", "Unapproved", "Startup Concessions", "ESS", "Non-Concessional", "ZEPO" | `option_grant` |
| "PIU", "PIUs", "profits interest", "profits interest unit", "incentive units", "threshold", "hurdle" | `piu` |
| Ambiguous ("equity") | Ask with `AskUserQuestion` |
| Mixed in one prompt | Ask which to run first; run the others in follow-ups |
| Out-of-scope security | Route to the Drafts UI; stop |

**"units" and "membership units" are not PIU cues.** On an LLC, Carta's equity language
renames a *certificate* to a membership unit, so bare "units" lands at `certificate` at least
as often as at `piu`. Read it as `piu` only alongside a real PIU signal — "profits",
"incentive", a threshold or hurdle amount, or a named equity plan. Without one it is a real
fork → `AskUserQuestion`, never a silent pick.

**A bare "N \<securities\>" is a quantity, not a headcount.** *"100 option grants"*, nobody
named, no plural-**person** language → one recipient getting 100. Only people-language
(*"100 employees"*, *"100 new hires"*) makes N a row count. This holds on every surface:
never open a form with 100 blank rows, and never ask who the recipients are before the
form opens — a missing recipient is an empty field on the form, not a chat question.

## The panel

**Call the tool from here — there is nothing further to read.** Its arguments below are the
whole interface: pass the user's words through, and everything else — the form, its reference
data, its validation, the draft set — is the panel's job.

### 1. Preflight

- **One `ToolSearch`** for the panel tool, `mcp__carta__call_tool`, and
  `mcp__carta__list_accounts` if you need a lookup. Load `call_tool` now, not after the
  confirm. Don't call `search_tools` for a name this file already gives you.
- **The connected Carta must be the intended Carta.** `corporation_id` is not unique across
  environments, so aiming at the wrong one issues real securities onto the wrong company.
  When the request implies an environment that differs from the connected one — a host, a
  Carta link, "sandbox", "demo", "production" — **hard stop and ask.**
- **Let the panel resolve the corporation.** It takes a `corporation` name and resolves it
  server-side. Pass `list_accounts(search="<name>")`'s numeric id when you already have one
  — `list_accounts` returns `id: "corporation_pk:<n>"`, and only `<n>` is valid — but do not
  make that call just to feed the panel.
- **A file in the prompt goes through [the import sub-skill](issuance-import/SKILL.md)
  first** — the panel can't read a local file.

### 2. Call the panel tool once

```
cap_table_issuance_panel({"corporation_id": <corporation_id>,   // or:
                          "corporation": "<the name the user said>",
                          "security_type": "<option_grant|certificate|piu>",
                          "stakeholders": ["<names exactly as the user said them>"],
                          "quantity": "<only if the user named one>"})
```

Pass **one** of `corporation_id` or `corporation`, preferring an id you already have. A name
it cannot pin down returns `corporationId: null` and one `corporation.unresolved` blocker
naming the candidates — the panel's cue to ask rather than guess.

Pass names and quantity **verbatim**. The server resolves them; one it cannot pin down comes
back in `prefill.ambiguous` with no prefill, for the user to settle in the panel — a
prefilled row reads as the user's own answer, so never fill one in.

One call — and no roster, plan or valuation fetch of your own.

### 3. Read `blockers` first

Each entry is `{key, severity, message, evidence}`. Branch on `key`, never message text.
`blockers` is always present: an empty list means clean, never "old server".

| Severity | What you do |
|---|---|
| `hard_stop` | **Say what is wrong in plain language and stop.** Don't open the panel around it or offer to continue |
| `needs_decision` | A fork the server refused to settle. Don't settle it either, and don't hint at a preference — the surface asks the human. Continue |
| `warn` / `informational` | Surface it in the line you say alongside the panel; continue |

The panel folds `needs_decision` into `warn` on its own wire; only
`cap_table:get:issuance_bootstrap` reports it, and keeps each `evidence`.

**`jurisdiction.unresolved_conflict` returns competing evidence and no verdict.** There is no
`resolved`, `recommended` or `most_likely` key, deliberately: a ranked field is a default and a
default gets taken. **Never run a precedence ladder over that evidence and never pick a side** —
the wrong answer sets real holders' tax treatment; the human chooses in the panel.

Then say one short line: the result's `_terminal_fallback`, plus any warn. Echo nothing else —
no ids, no field names ([hard rule 8](#hard-rules)).

### 4. Wait

**When the panel opens, your next action is to wait.** It loads its own data, collects the
rows, saves and validates the draft set and renders validation errors against their own fields.
None of it reaches you; it ends by sending **one** compact message naming the `draft_set_id`.

**Emit no `AskUserQuestion` while the panel is open** — it suspends the panel's submit watcher,
so the click never lands. Don't narrate, poll, or re-send the panel.

**The only thing that ends the wait: the user says they don't see it.** No timeout or
liveness signal exists — treat their *first* report as
[trigger 3](#5-falling-back-off-this-path) firing, no second check. That report also retires
the submit watcher, so `AskUserQuestion` is unrestricted again.

### 5. Falling back off this path

Three triggers, all observable — never a hunch that it looks slow:

1. **The panel tool call returns an error.** A 5xx, gateway, HTML body or timeout is
   transient — **retry exactly once** first; a second failure means falling back, not a
   third attempt.
2. **The user asks for a different surface.**
3. **The panel opened and nobody can submit it** — **one user report they don't see it**, or
   it errors after opening.

Fall back to the next matching row of [the surface table](#pick-the-surface): the artifact if
`Artifact` is present, else the chat surface. Carry the panel's `draft_set_id` in if it
already saved one, rather than starting a second.

**No interactive human means stop, not fall back.** Every surface needs someone to approve the
terms, so there is nothing to fall back *to*, and hand-building the payload to get past that
issues securities nobody reviewed ([rules 2 and 5](#hard-rules)). If you ever do build rows by
hand, read [payload-reference.md](references/payload-reference.md) first — **including its
"Never emit" list**; one bad key fails the whole mutate.

Say once, when a replacement surface opens: *this is a different form than the panel that
didn't render — not a stale plugin.*

## Issue

The panel and the chat surface end at a saved, validated `draft_set_id`, and **you** perform
the irreversible write so the host's own confirmation prompt fires. **The artifact surface
issues from the page instead** — its own Confirm sheet is that gate, so you report the
result and never re-issue
([artifact-surface.md § 4](references/artifact-surface.md#4-the-page-issues-you-report)).

```
mcp__carta__call_tool({"name": "cap_table__mutate__issue_securities", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant|piu>",
  "draft_set_id": <draft_set_id>}})
```

`call_tool` takes `name` + `arguments`, and the wire name carries **double underscores** —
`cap_table:mutate:issue_securities` is the prose form, never the argument.

**No `drafts` key** — the draft set already holds the rows the user approved
([hard rule 6](#hard-rules)).

**Don't call `validate_drafts` again first.** The surface already validated, and
`issue_securities` re-validates server-side before it writes.

Then read [references/issue-and-close.md](references/issue-and-close.md) for the response
branches, what to say per holder, and the closing lines. On a rejection that a re-call
cannot clear, read [references/mutate-recovery.md](references/mutate-recovery.md).

## Hard rules

Every surface.

1. **Never mix two security types in one mutate.** Run the skill once per type for a mixed
   request.
2. **One confirmation gate per mutate attempt** — never zero, never two stacked. The gate is
   the surface's own Confirm button, or one `AskUserQuestion` on the chat surface; **never one
   stacked on an open panel** — [§ 4](#4-wait) owns that mechanic and its one exception.
   Recovery questions after a server short-circuit are unrestricted.
3. **Retry contract — reuse identity from the FIRST response.** Put `draft_set_id` from the
   first mutate on every later `issue_securities`, `save_drafts`, `load_drafts`,
   `validate_drafts`, `resolve_duplicate_stakeholder`: omit it and the server mints a *second*
   draft set of the same incomplete rows. Put each row's `draft_pk` from its first save on
   every retry row, alongside *every* required field: omit it and the row inserts instead of
   updating. **A timeout is not an error** — the call may already have succeeded, so retrying
   with the wrong params risks a duplicate set or a double-issue; read
   [§ Timeouts & retries](references/payload-reference.md#timeouts--retries) first.
4. **The server is the source of truth.** Don't mirror its validation; surface its messages
   verbatim.
5. **Never delegate to a background agent.** The gates require interactive HITL.
6. **Issue what was validated, not a copy of it.** When the draft set already holds the rows
   the user approved, issue with `draft_set_id` and **no `drafts` key**. Re-sent rows are only
   *probably* identical to the reviewed ones — one transposed digit issues terms nobody
   approved, and no later gate compares the two. Send rows again only to change them, each
   with its `draft_pk` attached.
7. **Never substitute the certificate flow for a PIU.** Server-side a PIU *is* a certificate
   row with `type="PIU"`, so that path looks like a fallback when a PIU call is refused. It
   isn't — it issues a plain unit certificate with no threshold value, a different security.
8. **No raw ids or payload field names in customer-facing text — ever.** Not in headers,
   status lines, prompts, confirmations or errors. Never write the word "ID"
   (✅ *"looking up Jane"* / ❌ *"pulling stakeholder id 12345"*), and never render `(<number>)`
   after a name. Humanize payload keys before surfacing them, server `banner_errors` included:
   `_` → space, Title Case, with the exceptions in [labels.md](references/labels.md).

Every rule here comes from a real run that went wrong ([incidents.md](references/incidents.md)).

## Where everything else lives

Every path below starts `${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/` — that variable anchors
at the **plugin** root, so the skill segment belongs in the path. Read them there, and **do
not search**: on several hosts `Glob` and `find` cannot reach the plugin mount and return
empty every time.

- `references/artifact-surface.md` — the artifact path, end to end. Nothing else needed.
- `references/chat-surface.md` — the last-resort path: its phases, and what it reads.
- `references/issue-and-close.md` — the mutate's response branches and the closing lines.
- `references/mutate-recovery.md` — on a server rejection a re-call can't clear.
- `references/resume-flow.md` — *"resume draft set 472"*.
- `references/incidents.md` — before weakening or arguing with any rule.
- `issuance-import/SKILL.md` — the prompt points at a spreadsheet, CSV or award document. On
  every surface, before any form opens. It owns parsing; **never hand-read a workbook**.
