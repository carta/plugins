# Portfolio Valuation — Create (Guided)

Create a new valuation candidate for a portfolio company by collecting a
handful of inputs from the user, then calling the right create
mutation.

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

Take `targetKind` and `targetId` together from the `target` (`kind`, `id`)
on the resolved project from `list:projects`, or else from the dashboard
row: `isLlc: true` → `LLC_ISSUER` with `llcIssuerId`; otherwise
`CORPORATION` with `corporationId`. A first valuation has no `target` yet,
so the dashboard row is usually the source — sending `CORPORATION` for an
LLC fails the create.

## Step 1: Valuation Date

If the user already mentioned a date in their prompt, use it directly
(after running the future-date check below) and skip this question.
Otherwise, compute the four candidate dates dynamically based on
today's date, then ask inline as plain text. **All shortcut options
must be today or earlier — never future-date.**

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

If invalid, ask again.

## Step 2: Copy From Previous Valuation (if applicable)

If the company has existing valuation projects in context, ask:

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

Ask:

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
them in conversation context for later flows. Do not mention these IDs to the user.

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

Wait first, then read once: `list:projects` lags a create.

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
  plainly that the valuation couldn't be created and suggest the user
  check the company's page in Carta's valuations dashboard (SKILL.md
  **Page navigation**).

#### `400` — "A valuation project already exists on {date}"

One project per owner/target/date. Outside the timeout path above, this
means a valuation already exists on that date — surface it and offer to
open it or pick a different date. Never retry into it, and never
sidestep it by shifting the date the user asked for.

## Step 5: Success Messaging

Confirm the creation in plain language:

> "Your **{valuation name}** valuation is created (dated
> **{valuationDate}**)."

The create already refreshed the dashboard MCP App (SKILL.md **Refresh the
page after a change**), so don't move the view.

## Step 6: Return control

Confirm what was done and return control. The new `project_id` and
`candidate_id` stay in context for whatever the user asks next (e.g.
setting approaches) — do not re-ask for them.
