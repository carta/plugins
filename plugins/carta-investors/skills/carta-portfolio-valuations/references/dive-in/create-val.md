# Portfolio Valuation — Create (Guided)

Create a new valuation candidate for a portfolio company by collecting a
handful of inputs from the user, then calling the right create
mutation.

## UX Rules

When presenting 5 or fewer choices, ask the question inline as plain
text — do not use `AskUserQuestion` or any other widget. The prose
blocks below (shown as `> "..."`) are the literal wording to render,
with one option per line. Wait for the user's reply, then route based
on their answer.

## User-Facing Output Rules

Do not surface raw command names, API payloads, HTTP codes, or numeric
project/candidate IDs in chat. Speak in outcomes ("Your **Q2 2026**
valuation is created…"). Backend mechanics stay internal.

## Prerequisites

You need four things to work:
- `ownerId` — the firm's org_pk integer (e.g. `1` for Krakatoa Ventures)
- `targetKind` — the portfolio company's target type, either
  `CORPORATION` or `LLC_ISSUER`
- `targetId` — the id matching that kind: `<corporation_id>` for a
  `CORPORATION`, `<llc_issuer_id>` for an `LLC_ISSUER`. An LLC has no
  `corporationId` at all, so never assume one exists.
- The company name (for user-facing confirmations)
- Optionally: the existing projects list for this company (needed only if
  the user wants to copy from a previous valuation)

These are already in conversation context from the orchestrator — use
them directly without re-asking.

### Resolving the target

Take `targetKind` and `targetId` together from whichever source is
available:

1. the `target` object (`kind` and `id`) on the resolved project from
   `list:projects`, captured by the orchestrator's Step 2.5a; or
2. the matched company's `isLlc` / `llcIssuerId` from
   `list:portfolio_dashboard` — `isLlc: true` means `LLC_ISSUER` with
   `llcIssuerId` as the `targetId`; otherwise `CORPORATION` with
   `corporationId`.

**Source 2 is the one that usually applies here.** This flow routinely
creates a company's *first* valuation, and a company with no projects yet
has no `target` object to read — the dashboard fields are then the only
signal. Resolve from them rather than falling back to `CORPORATION`:
sending `CORPORATION` for an LLC pairs the wrong kind with an id that
does not exist, and the create fails.

`LLC_ENTITY` never reaches this file — SKILL.md Step 2.5a stops that
deprecated target kind upstream with its own message.

## Step 1: Valuation Date

If the user already mentioned a date in their prompt, use it directly
(after running the future-date check below) and skip this question.
Otherwise, compute the four candidate dates dynamically based on
today's date, then ask inline as plain text. **All shortcut options
must be today or earlier — never future-date.** The four "End of
previous {period}" shortcuts are inherently in the past; just don't
generate any forward-looking option.

> **What date should this valuation be as of?**
> 1. **Today** — `{today's date in YYYY-MM-DD}`
> 2. **End of previous month** — `{last day of previous month in YYYY-MM-DD}`
> 3. **End of previous quarter** — `{last day of previous quarter in YYYY-MM-DD}`
> 4. **End of previous year** — `{last day of previous year in YYYY-MM-DD}`
> 5. **Enter a different date** — follow up with a free-text prompt.

Wait for the reply, then use the selected date (or route to the
free-text follow-up for option 5).

**Future-date check.** If the user provides a custom date (via
option 5 or directly in their prompt), validate it:
- **Format**: must be valid YYYY-MM-DD.
- **Not in the future**: must be today or earlier. If the user enters
  a future date, respond in prose:
  > "**{user's date}** is in the future. Today is **{today's date}**,
  > so the valuation date has to be today or earlier. Want to use
  > today, or pick a different date?"
  Then re-prompt.

If invalid, ask again in prose rather than re-rendering the widget.

## Step 2: Copy From Previous Valuation (if applicable)

If the company has existing valuation projects in context, ask inline
as plain text (per this file's UX Rules — no `AskUserQuestion`):

> "Would you like to copy from a previous valuation? This carries over
> inputs and settings."
> 1. **Start fresh** — proceed to Step 3.
> 2. **Copy from a previous valuation** — proceed to the picker below.

If they choose to copy, ask again inline as plain text:

> "Which valuation would you like to copy from?"

One option per existing project, labeled with its valuation date and
name (e.g. "2025-06-15 — Q2 2025"). If there are more than 5 projects,
present the 4 most recent plus a fifth "Show all" option that lists
the remainder in a plain markdown table, then re-asks the same question
inline.

**If copying, skip Step 3** — the API derives the name from the
previous valuation automatically.

If the company has no existing projects, skip this step entirely.

## Step 3: Valuation Name (start fresh only)

If the user already provided a name, use it. Otherwise, generate a
default from the valuation date's quarter and year:
- Jan-Mar = Q1, Apr-Jun = Q2, Jul-Sep = Q3, Oct-Dec = Q4
- Example: valuation date 2026-05-15 → default **"Q2 2026"**

Ask inline as plain text (per this file's UX Rules — no
`AskUserQuestion`):

> "What would you like to name this valuation?"
> 1. **Use the default — {default name}**
> 2. **Pick a custom name** — follow up with a free-text prompt.

## Step 4: Execute Creation

Both calls below take the same `targetId` / `targetKind` pair resolved in
Prerequisites, and the two must agree:

| Company | `targetKind` | `targetId` |
|---|---|---|
| c-corp | `"CORPORATION"` | `<corporation_id>` |
| LLC | `"LLC_ISSUER"` | `<llc_issuer_id>` |

**If starting fresh**, call:

```json
call_tool({"name": "portfolio_valuations__create__project", "arguments": {
  "ownerId": "<org_pk>",
  "ownerKind": "FIRM",
  "targetId": "<targetId>",
  "targetKind": "<targetKind>",
  "valuationDate": "<YYYY-MM-DD>",
  "valuationCandidateName": "<name>"
}})
```

**If copying**, call:

```json
call_tool({"name": "portfolio_valuations__create__project_from_copy", "arguments": {
  "ownerId": "<org_pk>",
  "ownerKind": "FIRM",
  "targetId": "<targetId>",
  "targetKind": "<targetKind>",
  "valuationDate": "<YYYY-MM-DD>",
  "copyFromProjectId": "<selected project id>"
}})
```

`valuationCandidateName` is declared optional and documented as
defaulting to "Version 1", but the API rejects a null — always send a
name.

**Capture for handoff (internal)**: From the response, extract
`project_id` and `candidate_id` (from the created candidate). Hold
them in conversation context — the approach configuration step needs
them. Do not mention these IDs to the user.

### Error handling

**On success, go straight to Step 5.** Do not call `list:projects` to
confirm the create — the response already carries everything Step 5 and
Step 6 need, and the list is not read-your-writes (see below), so a
routine read-back can only mislead.

#### Timeout

A timeout is **not** a failure. The write may well have landed, so the
one thing never to do is immediately re-issue the create.

First tell the user, because the wait is about to get longer and
silence reads as a hang:

> "Creating this valuation is taking longer than usual — that can
> happen when the company has a large cap table. I'll check whether it
> went through in a moment."

Then **wait ~30 seconds** and call `list:projects` for the same
`ownerId` / `ownerKind` / `targetId` / `targetKind`, looking for a
project whose `valuationDate` is the one you just submitted.

The delay is the point. `list:projects` lags a create: a project that
was genuinely written can still be missing from the list read moments
later, and reading too early produces a confident wrong answer — "it
didn't work" — for a valuation that exists. Wait first, then read once.

- **Project present** → the create succeeded. Take `project_id` and
  `candidate_id` from the list entry rather than the create response,
  which never arrived, and continue to Step 5 as normal. Don't mention
  the timeout again; from the user's point of view it worked.
- **Project absent** → re-issue the create exactly once, unchanged. If
  that returns `400` with "A valuation project already exists on
  {date}", the original did land after all (the list was simply still
  behind) — re-read `list:projects` and continue to Step 5.
- **Still absent after that one retry** → stop. Do not issue a third
  create, and do not vary the date or name to get past the error. Say
  plainly that the valuation couldn't be created and offer the deep
  link so the user can check in Carta.

#### `400` — "A valuation project already exists on {date}"

One project per owner/target/date. Outside the timeout path above, this
means a valuation already exists on that date — surface it and offer to
open it or pick a different date. Never retry into it, and never
sidestep it by shifting the date the user asked for.

## Step 5: Success Messaging + Deep Link

Confirm the creation in plain language:

> "Your **{valuation name}** valuation is created (dated
> **{valuationDate}**)."

Then render the deep link on its own line.

### Deep link

See [`references/deep-link.md`](../deep-link.md) for URL construction.
Use **Pattern A** (project landing — versions list shows the new
candidate). Required context: `ownerId`, `targetId`, `project_id`.
Render per deep-link.md Step 5 (a markdown link).

## Step 6: Continue to approach configuration

Return to the orchestrator's drill-down router ("After a successful
create in drill-down mode") to handle approach configuration. The
`project_id` and `candidate_id` captured above are already in context —
do not re-ask the user. If the user explicitly says they want to stop
or do something else ("not now", "I'll set that later"), respect that
intent.
