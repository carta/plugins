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
  - Bash(uv run *)
  - Bash(mkdir *)
  - Bash(cp *)
  - Bash(cat *)
  - Bash(test *)
  - Bash(ls *)
  # No `Bash(find *)`: the surface comes from the tool list, not the disk.
  # Read-only CLI producers only — writes go through `call_tool`.
  - Bash(carta web list *)
  - Bash(carta web get *)
  - Bash(carta web download *)
  # `mcp__carta__*` is literal here; in prose it stands for the session prefix.
  - mcp__carta__call_tool
  - mcp__carta__search_tools
  - mcp__carta__list_accounts
  - mcp__carta__welcome
  - mcp__carta__cap_table_issuance_panel
  - mcp__visualize__show_widget
  - preview_start
  - preview_list
  - preview_eval
  - javascript_tool
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.85.7</carta-plugin>

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
convertibles, SAFEs, convertible debt, and for custom legends, vesting, acceleration or
exercise periods:

> *"This skill issues certificates, option grants and profits interest units today. For \<thing\>, use the Drafts UI in the Carta app."*

## Pick the surface

One branch, from **your own tool list** — never the disk, never an env var. Match on the
**suffix**: on real hosts these names arrive prefixed (`mcp__Claude_Browser__preview_start`;
the Carta prefix is often an opaque session UUID), so literal equality silently picks the
wrong path.

| Condition | Path |
|---|---|
| a tool whose name **ends in** `cap_table_issuance_panel`, bare or prefixed | **panel** — [the next section](#the-panel-path) |
| else, a tool ending in `preview_start` | **engine + code adapter** — `references/engine.md`, then `references/code-adapter.md` |
| else | **engine + cowork adapter** — `references/engine.md`, then `references/cowork-adapter.md` |

Record the selection once. Never re-detect per surface.

## The panel path

**Call the tool from here — there is nothing further to read.** Its arguments below are the
whole interface: pass the user's words through, and everything else — the form, its reference
data, its validation, the draft set — is the panel's job. A panel run also needs no skill-load
self-check: when the server builds the form, a partial skill load cannot produce a wrong one.
Bare tool names mean the session's resolved, possibly prefixed ones.

### 1. Preflight

- **One `ToolSearch`** for the panel tool, `mcp__carta__call_tool`, and `mcp__carta__list_accounts`
  if you need a lookup. Load `call_tool` now, not after the confirm.
- **The connected Carta must be the intended Carta.** `corporation_id` is not unique across
  environments, so aiming at the wrong one issues real securities onto the wrong company. When
  the request implies an environment that differs from the connected one — a host, a Carta
  link, "sandbox", "demo", "production" — **hard stop and ask.**
- **Resolve the corporation:** `list_accounts(search="<name>")`, never an unfiltered
  `list_accounts()` — its truncated page may never reach the name. Ask only on zero or several
  matches. **Extract the numeric id** — `list_accounts` returns `id: "corporation_pk:<n>"`;
  pass only `<n>` as `corporation_id`, or the panel tool rejects it.
- **Resolve `security_type`** per [the table below](#resolve-security_type).
- **A file in the prompt goes through [the import sub-skill](issuance-import/SKILL.md)
  first** — the panel can't read a local file.

### 2. Call the panel tool once

```
cap_table_issuance_panel({"corporation_id": <corporation_id>,
                          "security_type": "<option_grant|certificate|piu>",
                          "stakeholders": ["<names exactly as the user said them>"],
                          "quantity": "<only if the user named one>"})
```

**Pass the names and quantity verbatim.** Don't pre-resolve a name, fetch the roster, or ask
who the grantees are — a missing recipient is an empty field on the panel, never a chat
question. The server resolves names; one it cannot pin down comes back in `prefill.ambiguous`
with no prefill, for the user to settle in the panel — a prefilled row reads as the user's own
answer, so never fill one in.

**A bare "N \<securities\>" is a quantity, not a headcount.** *"100 option grants"*, nobody
named, no plural-**person** language → `quantity: 100` with an empty `stakeholders` list: one
recipient, 100 options. Only people-language (*"100 employees"*, *"100 new hires"*) makes N a
row count.

One call — and no roster, plan or valuation fetch of your own.

### 3. Read `blockers` first

Each entry is `{key, severity, message, evidence}`. Branch on `key`, never message text.
`blockers` is always present: an empty list means clean, never "old server".

| Severity | What you do |
|---|---|
| `hard_stop` | **Say what is wrong in plain language and stop.** Don't open the panel around it or offer to continue |
| `warn` / `informational` | Surface it in the line you say alongside the panel; continue |

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
Past that handoff the only files you may need are
[references/mutate-recovery.md](references/mutate-recovery.md) on a server rejection and the
import sub-skill if the prompt named a file.

**Emit no `AskUserQuestion` while the panel is open** — it suspends the panel's submit watcher,
so the click never lands. Don't narrate, poll, or re-send the panel.

**The only thing that ends the wait: the user says they don't see it.** No timeout or
liveness signal exists — treat their *first* report as
[trigger 3](#6-falling-back-off-this-path) firing, no second check. That report also retires
the submit watcher, so `AskUserQuestion` is unrestricted again.

### 5. On that message, issue

```
mcp__carta__call_tool({"name": "cap_table__mutate__issue_securities", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant|piu>",
  "draft_set_id": <draft_set_id from the panel's message>}})
```

`call_tool` takes `name` + `arguments`, and the wire name carries **double underscores** —
`cap_table:mutate:issue_securities` is the prose form, never the argument.

**No `drafts` key** — the draft set already holds the rows the user approved
([hard rule 6](#hard-rules)).

The host's confirmation prompt on this mutate is the final, irreversible gate — **and the only
gate you add here**: the panel's Confirm button was the review gate.

Then:

- **Success** → say what was issued per holder: name, quantity, security, any value worth
  checking. Dates `MM/DD/YYYY`. **The response is the record — don't read the security back.**
  The `cap_table__get__*` tools are single-security lookups — each needs `corporation_id`
  **and exactly one** of `label` or `security_id`, and none lists a corporation's securities.
- **The server rejects or short-circuits** → surface its messages **verbatim**, humanized
  ([hard rule 8](#hard-rules)); never pre-empt its validation. Re-call with the **same**
  `draft_set_id` once the user clears what it named ([hard rule 3](#hard-rules)).
- **A timeout is not an error** — never retry with fresh params ([hard rule 3](#hard-rules)).
- **Anything that re-call can't clear** — flagged duplicates, a row that must change — read
  [references/mutate-recovery.md](references/mutate-recovery.md).

### 6. Falling back off this path

Three triggers, all observable — never a hunch that it looks slow:

1. **The panel tool call returns an error**, or the tool is absent. A 5xx, gateway, HTML body
   or timeout is transient — **retry exactly once** first; a second failure means falling back,
   not a third attempt.
2. **The user asks for a different surface.**
3. **Nobody will submit the panel** — no interactive human in the session, **one user report
   they don't see it** (the only observable proof), **or it errors after opening.** The rows
   and the payload are then yours to build: read
   [references/payload-reference.md](references/payload-reference.md), **including its
   "Never emit" list**, before you build them. A field the panel would have resolved is not a
   field you may send — a hand-built row carrying `vesting_acceleration_name` is rejected as an
   `Unknown draft field`, and the panel's camelCase view names several such fields.

[references/engine.md](references/engine.md) is the entry point for all three. Add the adapter
the [surface table](#pick-the-surface) names for your tool list only when a replacement
surface has to be rendered (`references/code-adapter.md` if a tool ends in `preview_start`,
else `references/cowork-adapter.md`): trigger 3 renders nothing, but it still needs the engine
and the payload reference. If the panel already saved a draft set, carry its `draft_set_id` in
rather than starting a second.

**If trigger 3 opens a replacement surface** (a human is present, just not the panel that
failed), say once: *this fallback form is a different design than the panel that didn't
render — not a stale plugin.*

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

## Hard rules

Every path, panel included.

1. **Never mix two security types in one mutate.** Run the skill once per type for a mixed
   request.
2. **One confirmation gate per mutate attempt** — never zero, never two stacked. The gate is
   the surface's own Confirm button, or one `AskUserQuestion` on a chat surface; **never one
   stacked on an open panel** — [§ 4](#4-wait) owns that mechanic and its one exception.
   Recovery questions after a server short-circuit are unrestricted. The host's
   confirmation prompt on the mutate is the final irreversibility gate, never the review
   gate.
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
not search**: in Cowork `Glob` and `find` cannot reach the plugin mount and return empty every
time.

- `references/engine.md` — both fallback paths: preflight, every phase, row templates, payload
  rules, its own hard rules. It names the rest as you need them.
- `references/incidents.md` — before weakening or arguing with any rule.
- `issuance-import/SKILL.md` — the prompt points at a spreadsheet, CSV or award document. On
  every path, before any surface opens. It owns parsing; **never hand-read a workbook**.
