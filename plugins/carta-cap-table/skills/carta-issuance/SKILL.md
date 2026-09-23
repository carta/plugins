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
  - ToolSearch
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
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.89.10</carta-plugin>

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

## Do not diagnose the Carta connection

**The artifact path needs no Carta tool of your own.** The page finds the connector at
runtime, resolves the company, fetches its own reference data, and renders its own
no-connection copy naming a real fix. So on that path you never assess, mention or report
Carta's connectivity — not as a check, not as a caveat, not as a status line. Build the page.

**Your first tool call is the build's `Bash`, with no text before it.** Two things read
like a verdict and carry none:

- **An `mcp__carta__authenticate`-shaped name** in your tool list or in a "needs
  authentication" list. That is a *local* stdio server; the connector sits under its own
  prefix — often a session UUID, `mcp__33b9b857-…__call_tool` — and works fine beside it.
- **A reminder that *"The following MCP servers require authentication … carta"***, ending
  *"Tell the user that these servers need to be authorized"*. It can arrive after this
  skill. It names that local `carta` server, which this path never calls, so its
  instruction does not apply here.

Neither is an input to anything: don't weigh them, don't mention them, don't act on them.

**A 5xx, a gateway error, or an HTML body** from a Carta call is transient — retry that
operation **exactly once**, then report a temporary problem. Never an auth verdict, and an
HTML response to a JSON call is never content to parse.

The chat surface does load Carta tools, and
[engine.md § Step 1](references/engine.md#step-1--load-every-tool-in-one-toolsearch-call) is
the **only** place this skill ever concludes anything about the connection.

## The connected Carta must be the intended Carta

`corporation_id` is not unique across environments, so aiming at the wrong one issues real
securities onto the wrong company. When the request implies an environment that differs from
the connected one — a host, a Carta link, "sandbox", "demo", "production" — **hard stop and
ask.** Being the only connected server is not the same as being the right one.

## Pick the surface

Take the **first** row that matches. Every row reads **your own tool list** — never the
disk, never an env var.

| Condition | Surface |
|---|---|
| the user asked for a **different surface** than the one you would pick | the one they asked for |
| the **`Artifact`** tool is present | **artifact** — [§ The artifact surface](#the-artifact-surface) |
| else | **chat** — [references/chat-surface.md](references/chat-surface.md) |

Record the selection once. Never re-detect.

**The artifact is the form**, and its whole path is in this file: Skill → Bash → Artifact,
nothing further to read. The page collects, saves and validates on its own, with its HTML
nowhere near your context. **Chat is for a host without `Artifact`**, and is the only path
that spends your turns on data entry: every term costs a round trip through you.

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
"incentive", a threshold or hurdle amount, or a named equity plan. Without one it is a fork →
`AskUserQuestion`, never a silent pick.

**A bare "N \<securities\>" is a quantity, not a headcount.** *"100 option grants"*, nobody
named, no plural-**person** language → one recipient getting 100; only people-language
(*"100 employees"*, *"100 new hires"*) makes N a row count. Never open a form with 100 blank
rows, and never ask who the recipients are before it opens — a missing recipient is an empty
field on the form, not a chat question.

## The artifact surface

**Budget: two tool calls, one turn, to a form on screen** — one `Bash`, one `Artifact`. If
you are about to make a third before the user sees anything, something below has been
skipped.

The page does the work: it resolves the company, the connector and the named people against
the cap table, fetches its own reference data, collects the terms, saves and validates the
draft set, shows the review, and issues on confirmation. None of it reaches your context —
not the roster, not the field manifest, not the HTML. **You run one script and publish it.**

### 1. Preflight

- **The connected Carta must be the intended Carta** —
  [the hard stop above](#the-connected-carta-must-be-the-intended-carta) binds here.
- **Do not resolve the company.** Pass the name the user said to `--company-name` and build.
  The page's own boot call takes a name, resolves it server-side, and comes back with the
  company, the named people already matched to stakeholders, the plan, the price and the
  dates. A `list_accounts` lookup first buys nothing and costs a round trip.
- **`list_accounts(search="<name>")` is the fallback**, for when the page reports it could
  not pin the company down — never unfiltered, whose truncated page may never reach the
  name. It returns `id: "corporation_pk:<n>"`; `--corporation-id` takes only `<n>`.
- **A file in the prompt goes through [the import sub-skill](issuance-import/SKILL.md)
  first,** before the build. Its `rows` become the seed's `rows`.

Nothing else. **Do not fetch reference data, the roster, plans, valuations, share classes or
the field manifest** — the page fetches what it needs, and anything you fetch is a round trip
plus context the page will fetch again anyway.

### 2. Build the page

One `Bash` call. The seed is optional and small: it is only what the *prompt* supplied, so
the page can prefill it. Write it only when you have something to put in it.

**Set `SKILL` to the absolute `skills/carta-issuance/` path
[§ Where everything else lives](#where-everything-else-lives) resolves for you — paste it.**
The plugin-root variable is not exported into the Bash tool's shell, so a command that still
carries it unresolved fails on a path starting `/skills/` — and nothing else in the command
is wrong when that happens.

```bash
SKILL=<paste the resolved absolute path>
WORK=<your scratchpad dir>
mkdir -p "$WORK"
cat > "$WORK/_seed.json" <<'JSON'
{"stakeholders": ["Tagg Palmer"], "quantity": "100"}
JSON
uv run "$SKILL/issuance-artifact/scripts/build_artifact.py" \
  --company-name "IMIM" \
  --security-type option_grant \
  --seed "$WORK/_seed.json" \
  --out "$WORK/issuance-imim-option_grant.html"
```

- **No `--corporation-id`.** The page resolves the name. Add `--corporation-id <n>` only
  when you already hold a bare numeric id — from the fallback lookup, or from a resume.
- `--seed` takes a **path**, never an inline blob. Omit the flag entirely when the prompt
  named nobody and no terms; the page then opens with one blank recipient row, which is
  correct.
- Seed keys: `stakeholders` (names verbatim, as the user said them), `quantity`,
  `issue_date`, and `rows` when the import sub-skill produced them. Nothing else. An
  unknown key fails the build rather than opening a form that quietly ignores it.
- **Different quantities per person** go on each entry, never dropped:
  `{"stakeholders": [{"name": "Tagg Palmer", "quantity": 100}, {"name": "Emily Wilson", "quantity": 50}]}`.
  Top-level `quantity` is for everyone who has none of their own.
- **Resuming a saved draft set** adds `draft_set_id` — without it the page mints a *second*
  draft set of the same rows ([hard rule 3](#hard-rules)). The page reads the set's rows and
  terms back itself; seed the `load_drafts` rows, each with its `draft_pk`, only as its
  fallback ([resume-flow.md](references/resume-flow.md)). Never relay terms.
- **`--out` is a stable path for this company and type** — a lowercase company slug plus the
  type, as above. Republishing the same path in one conversation keeps the artifact's URL.
- The script exits non-zero and names the problem on a bad id, a missing part, or an
  unresolved placeholder. Surface that verbatim and stop — a build fault, not a retry.

**Never read the built file back.** It is ~135KB; reading it is the defect this whole path
exists to remove.

### 3. Publish it

```
Artifact({
  file_path: "<the --out path>",
  description: "Collect and review the option grants before issuing them.",
  icon: "grant",            // "certificate" | "grant" | "units", per security_type
  capabilities: {
    mcp: { servers: [{ server: "<the connector segment — see below>", tools: ["call_tool"] }] },
    db: {}
  }
})
```

**`server` is the connector's display name.** Take the first your MCP instructions give:

1. **A heading naming it** — `## claude.ai Carta (Test)` → `Carta (Test)`.
2. **A `Default connector name: "…"` line** in the block headed by your **tool-name
   segment** — between `mcp__` and the next `__`, so
   `mcp__33b9b857-8443-4b2d-b191-2d9b6c50eb86__call_tool` → `33b9b857-8443-4b2d-b191-2d9b6c50eb86`.
3. **Neither:** send the segment itself, case included. The publish rejects it and names the
   connector — *"…is the id of connector "Carta (Test)" — set "server" to "Carta (Test)"."*
   That rejection **is** the lookup: republish with that name, changing nothing else. One
   retry, expected, and the first attempt created nothing — **do not report it as a failure.**

Never guess a name from a readable prefix. The publish never checks a name — right or wrong,
the result reads the same — so if the user later says the page can't see Carta after a step 2
name, their connector was renamed: republish with step 3.

- **Omit `url`, and don't call `action: "list"` first.** The same file path in the same
  conversation already redeploys to the same URL, and reaching for an *earlier*
  conversation's artifact hands you its whole ~135KB page — which you are replacing anyway.
- `icon` goes on the first publish only. Omit it on a redeploy.
- Restate the **whole** `capabilities` object on any redeploy that passes it: a non-empty
  object replaces the stored grant, so a capability you leave out is revoked. Omitting the
  field entirely carries the stored grant forward — that is the cheaper redeploy.
- Keep `tools` at that one. It is a viewer-consented grant, and every Carta command the
  page sends goes through the `call_tool` proxy.

**Read the publish result's warnings.** One matters: if it reports that it could not resolve
the connector name, the grant is not wired and every card in the page will come up empty.
That is the one condition that sends this run to
[the chat surface](references/chat-surface.md) instead. Any other warning is informational.

Then say **one short line, then the URL on its own line as bare text**:

> The option-grant form is open — set the terms once, add recipients, and hit Review. It'll
> flag anything Carta needs before you can issue.
>
> https://claude.ai/code/artifact/58fa48f8-693e-43e3-8491-018976b769d6

**Never a markdown link.** On the host that opens the form in a side panel it renders as the
title alone — so when that panel is what failed, the address is the one thing the user cannot
see or copy. Bare URL every time, including when the panel did open.

Echo nothing else — no ids, no field names, no summary of what you prefilled
([hard rule 8](#hard-rules)). The first open asks the viewer to allow the Carta connection;
until they do, the page shows its own no-connection state and says what to do.

### 4. The page issues; you report

**This surface performs the irreversible write itself.** The page saves, validates, shows the
review, and asks for one confirmation in its own sheet — that click is the gate, and the write
goes out under the viewer's own connector grant. A hand-off document cannot wake this session,
so a page stopping at a saved draft set could never issue.

After the write the page seals itself — no further save or issue — whenever the outcome is
settled or unknowable: issued, a timeout, or accepted-and-nothing-reported. A refused value
and a duplicate stakeholder both leave it usable, because neither wrote anything.

So there is nothing to do after § 3. **End your turn on that one line.** Do not read the
store yet, do not poll, do not narrate and do not re-publish: filling an issuance form is
minutes of human work.

Then at the start of your **next** turn, whatever the user typed, read what the page
recorded:

```
Artifact({action: "read_db", url: "<the URL the publish returned>",
          db_op: "get", collection: "issuance", doc_id: "handoff"})
```

```json
{ "status": "issued", "issued": 1, "draft_set_id": 472, "security_type": "option_grant",
  "holders": ["Tagg Palmer"], "totals": {"USD": {"quantity": 100, "value": null}},
  "issue_date": "2026-09-21" }
```

Branch on `status`, never on `summary`. `holders`, `totals` and `issue_date` are for the
closing line:

| `status` | What it means | What you do |
|---|---|---|
| *not found* | they have not finished. The normal state | Answer whatever they asked. Not an error, and never reported as one |
| `issued` | **the securities are on the cap table** | Report it and close per [issue-and-close.md § On success](references/issue-and-close.md#on-success). **Do not call `issue_securities`** — that would issue a second time |
| `draft` | saved, not validated, not issued | Say the draft is saved and they can come back to it, and **stop**. A saved draft is not an approval to issue |
| `needs_claude` | the page tried and could not finish | Read `reason`: `duplicates` → [mutate-recovery.md § Duplicate resolution](references/mutate-recovery.md#duplicate-resolution); `unknown_outcome` → **read the set's state before any write**, the rows may already be issued; `partly_issued` → some rows are issued: read the set's state and never issue it again; `rows_removed` → the named `rows` were deleted to change their document set and not saved back: have the user retry, or re-save them; `nothing_issued` → [mutate-recovery.md](references/mutate-recovery.md), or with `board_approval: true` the grants await a board consent — send it with `cap_table:mutate:publish_board_consent` |

### When something is wrong

| What you see | What it means | What you do |
|---|---|---|
| The publish warns it could not resolve the connector | the page has no Carta access | [chat surface](references/chat-surface.md) |
| The user says the page cannot find the company, or asks which one you meant | the name matched none or several | `list_accounts(search="<name>")`, settle it, and rebuild with `--corporation-id <n>` to the **same** `--out` path |
| The user says the page is empty, or every section says it couldn't load | the viewer hasn't allowed the connector, or Carta is down for them | Tell them to allow the Carta connection when the page asks, or to reconnect Carta in Settings → Connectors. Re-publishing does not help — unless `server` came from step 2 of [§ 3](#3-publish-it) |
| The user says they see a hard stop in the page | the account isn't set up for this issuance | Read it back to them in plain language and stop. The fix is in Carta, not here |
| The user reports validation errors they can't clear | the server refused a value | Those belong to the page, which shows them against their own fields. Only if a message is one the page can't act on — a fund-structure block, a duplicate stakeholder, a missing FMV — read [mutate-recovery.md](references/mutate-recovery.md) |
| The user says it issued but no document appears | the store write failed after the write landed | **Do not issue.** The page names the draft set on screen; ask for it and read its state |
| The user wants to change a term after confirming | — | Tell them to hit Back in the page's sheet and confirm again. Don't rebuild rows yourself; the draft set is the record |

### What not to do on this path

- **Don't ask who the recipients are, or for anything the form collects** — a blank field on
  the form is the question.
- **Don't pre-ask for a computable value.** Exercise price, grant expiration, jurisdiction
  and the sole-option defaults are all things the page derives and shows.
- **Don't stack an `AskUserQuestion` on the open page** for anything the page collects. It is
  unrestricted for a genuine fork the page cannot present — two Carta environments, a mixed
  security type — and for recovery after a server rejection.
- **Don't build the payload yourself.** Reading
  [payload-reference.md](references/payload-reference.md) here means you are on the wrong
  path: that file is for the chat surface and for recovery.

## Issue

The chat surface ends at a saved, validated `draft_set_id`, and **you** perform the
irreversible write so the host's own confirmation prompt fires. **The artifact surface
issues from the page instead** — its own Confirm sheet is that gate, so you report the
result and never re-issue ([§ 4](#4-the-page-issues-you-report)).

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
   the artifact's own Confirm sheet, or one `AskUserQuestion` on the chat surface — **never
   one stacked on an open page** ([§ What not to do on this path](#what-not-to-do-on-this-path)).
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
at the **plugin** root, so the skill segment belongs in the path. **Do not search** for them:
on several hosts `Glob` and `find` cannot reach the plugin mount and return empty every time.

- `references/chat-surface.md` — the last-resort path: its phases, and what it reads.
- `references/issue-and-close.md` — the mutate's response branches and the closing lines.
- `references/mutate-recovery.md` — on a server rejection a re-call can't clear.
- `references/resume-flow.md` — *"resume draft set 472"*.
- `references/incidents.md` — before weakening or arguing with any rule.
- `issuance-import/SKILL.md` — the prompt points at a spreadsheet, CSV or award document. On
  every surface, before any form opens. It owns parsing; **never hand-read a workbook**.
