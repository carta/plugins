# Portfolio Valuation — Commentary

Read and edit the **valuation commentary** on a candidate — the free-text
note that explains how the valuation was reached and that appears on the
valuation report.

> **This reads *and* writes.** Reading is safe and immediate. Writing
> **overwrites** the saved commentary, so the text it replaced is always
> shown back to the user after the save (see Step 4). Distinct from audit-notes (which is chat-only
> and never writes): commentary is a single stored field on the
> valuation that renders on the report.

The commentary text is the user's content — always quote it verbatim.

## Prerequisites

You need a selected candidate, already in context from the orchestrator:
- `ownerId`, `project_id`, `candidate_id` — for the API calls.
- The company name and valuation date — for user-facing confirmations.

If any are missing, ask the user to pick a valuation row from Step 3
(the dashboard / versions list) first.

## Step 1: Read the current commentary

```
read_tool({"name": "portfolio_valuations__get__commentary", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})
```

Present the result as Carta data — quote it verbatim and cite the
valuation (company + valuation date):

- Non-empty: *"Here's the commentary on **{company}**'s **{valuation
  date}** valuation:"* then the text.
- `null` / empty: state plainly that **no commentary has been set** for
  this valuation. **Never invent, paraphrase, or infer a value** — if
  it's empty, say so.

If the user only wanted to read it, stop here and offer to edit it.

## Step 2: Determine the new text (edit path)

- **User supplies the text** — use it exactly as given.
- **User asks you to draft or suggest it** — the drafted text is
  **AI-constructed, not Carta data**. Before saving you MUST: (1) get the
  user's approval to use AI-drafted text, and (2) show the draft prefixed
  with a **"⚠️ Claude's analysis"** label so it's never mistaken for a
  saved Carta value. Only proceed to Step 3 after they approve the wording.

## Step 3: Save

Save without asking first — per SKILL.md's **Writes — save, then show
what was saved** rule, the user checks the result in Step 4 instead.
Keep the previous text from Step 1 in hand; Step 4 shows it so nothing
is lost when it's overwritten.

```
call_tool({"name": "portfolio_valuations__mutate__commentary", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "commentary": "<text>"}})
```

- To **clear**, pass `"commentary": ""`.
- `commentary` must be present in the request.

## Step 4: After saving

Say what was saved in plain prose ("Saved the commentary for
**{company}**'s **{valuation date}** valuation:") and quote the saved
text verbatim. If commentary existed before, also quote the **previous
text** it replaced, so the user can restore it if the overwrite wasn't
what they wanted. If the commentary was cleared, say so and quote the
text that was removed. The user can view it on the valuation's page in
Carta's valuations dashboard.
