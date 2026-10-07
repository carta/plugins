# Portfolio Valuation — Add Candidate

Add a new scenario/version (a "candidate") to an **existing valuation
project**. Use this when the user wants to try a different scenario on a
valuation they already have — e.g. "create a Version 2" or "let me try
a different multiple on the Q2 valuation."

This is different from `create-val.md`, which creates a whole new project
(new valuation date, new project ID). Adding a candidate keeps the
parent project — same valuation date, same company — and creates a
sibling scenario inside it.

## UX Rules

When presenting 5 or fewer choices, ask inline as plain text (no
`AskUserQuestion` — it is not granted to this skill): state the question,
list numbered options, and wait for the user's free-text reply. The prose
examples below (shown as `> "..."`) are illustrative wording for those
inline questions.

## User-Facing Output Rules

Do not surface raw command names, API payloads, HTTP codes, or numeric
project/candidate IDs in chat. Speak in outcomes ("Your **Version 2** is
created on the **Q2 2026** valuation…"). Backend mechanics stay internal.

## Prerequisites

You need:
- `project_id` — the parent project the candidate belongs to.
- The parent project's name and valuation date (for user-facing
  confirmations like "on the **Q2 2026** valuation").
- The list of existing candidates on this project (only needed if the
  user wants to copy from a sibling).
- `ownerId` and `targetId` — for the deep link at the end.

These are already in conversation context from the orchestrator's
Step 6 drill-down (the projects table) — use them directly without
re-asking. If the user hasn't selected a project yet, ask which
valuation row they want to add the candidate to.

---

## Step 1: Candidate Name

If the user already provided a name, use it. Otherwise, suggest a default
based on the existing candidates on this project:
- If the latest candidate is "Version 1", default to **"Version 2"**.
- If it's "Version 2", default to **"Version 3"**, and so on.
- If the existing candidates use a different naming pattern (e.g. "Base
  case", "Bull case"), don't try to guess — just ask.

Ask inline as plain text:

> **What would you like to name this scenario?**
> 1. **Use the default — {default name}**
> 2. **Pick a custom name** — follow up with a free-text prompt.

Wait for the reply. If the user picks the default, use {default name}; if
they pick a custom name, ask for the name as free text, then proceed to
Step 2.

## Step 2: Copy From a Sibling Candidate (if applicable)

If the project already has at least one candidate, ask inline as plain text:

> **Want to copy from an existing scenario on this valuation? This carries
> over inputs and settings.**
> 1. **Start fresh** — proceed to Step 3.
> 2. **Copy from a sibling scenario** — proceed to the picker below.

Wait for the reply, then route accordingly.

If they choose to copy, ask inline as plain text again:

> **Which scenario would you like to copy from?**

One option per existing candidate, labeled with its name and status (e.g.
"Version 1 — DRAFT"). If there are more than 5 candidates, present the 4
most recent plus a fifth "Show all" option that lists the remainder in a
plain markdown table, then re-asks the question inline with the full
list.

Wait for the reply, then proceed with the chosen sibling candidate.

If the project has only the one candidate that's already selected (or
zero candidates), skip this step.

## Step 3: Optional Seed Company Value

This step is **optional and not required** — most users will skip it. Ask
only if the user explicitly mentioned a starting value in their request
(e.g. "make a Version 2 starting from a $50M EV"). Otherwise, skip
silently and proceed to Step 4.

If a value is mentioned, capture it as a decimal number (no currency
symbol or commas). Do not invent a value or pull one from elsewhere.

## Step 4: Execute Creation

Call:

```json
call_tool({
  "name": "portfolio_valuations__create__candidate",
  "arguments": {
    "project_id": "<parent project_id>",
    "name": "<candidate name>",
    "copyFromCandidateId": "<sibling candidate_id>",   // omit if starting fresh
    "companyValue": <decimal>                          // omit unless explicitly provided in Step 3
  }
})
```

Only include `copyFromCandidateId` if the user chose to copy. Only
include `companyValue` if Step 3 captured one.

**Capture for handoff (internal)**: From the response, extract the new
`candidate_id`. The `project_id` is unchanged. Hold both in conversation
context — downstream references (set-approaches, gpc-analysis,
allocation, finalize) need them. Do not mention these IDs to the user.

## Step 5: Success Messaging + Deep Link

Confirm the creation in plain language. Reference both the new candidate
name and the parent valuation so the user knows where it landed:

> "Your **{candidate name}** is created on the **{project name}**
> valuation."

Then render the deep link on its own line.

### Deep link

See [`references/deep-link.md`](../deep-link.md) for URL construction.
Use **Pattern A** (project landing — versions list shows the new
candidate). Required context: `ownerId`, `targetId`, `project_id`.
Render per deep-link.md Step 5 (a markdown link).

## Step 6: Continue with the new candidate

Return to the orchestrator's Step 6 ("After a successful create in
drill-down mode"). The new candidate is now the active
candidate — `project_id` and `candidate_id` are in context. The
walk-through path (cap-table-review → financials-review →
set-approaches → ...) applies to the new candidate, not the sibling it
was copied from.

If the user copied from a sibling, the new candidate inherits the
sibling's inputs (cap table, financials, approaches, comps, etc.). The
End Goal checklist (see orchestrator) will reflect that on its next
re-derivation — items the sibling already had may already be ✅ for the
new candidate. Use that to short-circuit the walk-through to the first
genuinely unfinished item.
