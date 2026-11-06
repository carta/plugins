# Portfolio Valuation — Add Candidate

Add a new scenario/version (a "candidate") to an **existing valuation
project**. Use this when the user wants to try a different scenario on a
valuation they already have — e.g. "create a Version 2" or "let me try
a different multiple on the Q2 valuation."

This is different from `create-val.md`, which creates a whole new project
(new valuation date, new project ID). Adding a candidate keeps the
parent project — same valuation date, same company — and creates a
sibling scenario inside it.

## Prerequisites

You need:
- `project_id` — the parent project the candidate belongs to.
- The parent project's name and valuation date (for user-facing
  confirmations like "on the **Q2 2026** valuation").
- The list of existing candidates on this project (only needed if the
  user wants to copy from a sibling).
- `targetId` — for opening its page in the dashboard MCP App.

These are already in conversation context from the orchestrator's
Step 2.5a — use them directly without re-asking. If the user hasn't selected a project yet, ask which
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
(e.g. "make a Version 2 starting from a 50M EV"). Otherwise, skip
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

## Step 5: Success Messaging

Confirm the creation in plain language. Reference both the new candidate
name and the parent valuation so the user knows where it landed:

> "Your **{candidate name}** is created on the **{project name}**
> valuation."

The create already refreshed the dashboard MCP App (SKILL.md **Refresh the
page after a change**), so don't move the view.

## Step 6: Continue with the new candidate

The new candidate is now the active candidate (`project_id` and
`candidate_id` in context) — every following flow and the Step 2.5c
checklist apply to it, not the sibling it was copied from. A copied
candidate inherits the sibling's inputs, so the checklist may already
show items done. Confirm what was created and return control.
