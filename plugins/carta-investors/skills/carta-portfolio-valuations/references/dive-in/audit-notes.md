# Portfolio Valuation — Audit Notes

Draft narrative rationales for a valuation candidate that the user can
copy into audit workpapers, board memos, or compliance documentation.

> **This is chat-only.** It does not write to the database. It reads
> rationales and inputs already saved on the candidate, formats them into
> a coherent narrative, and presents the result for copy/paste. If a
> rationale field is empty in the API, it is presented as a `[TODO]`
> placeholder for the user to fill in.

## UX Rules

When presenting 5 or fewer choices, ask inline as plain text with a
numbered list of options — do not bury the choice in a paragraph of
prose.

## User-Facing Output Rules

This reference is unusual: the **output is the deliverable**. The user is
going to copy it. So the formatting rules are different from other
references:

- The drafted memo itself **may** include numeric values (company value,
  holdings value, multiples, weights) — auditors need them.
- The drafted memo **may** include approach names ("GPC", "M&A",
  "Backsolve", "Custom Value", "Post-Money") and methodology terms —
  auditors expect them.
- The drafted memo **must not** include raw command names, API field
  names, HTTP status codes, or numeric project/candidate IDs. Speak in
  business terms.
- Outside the drafted memo (the agent's prose around it), continue the
  same backend-mechanics-stay-internal rule that applies elsewhere.

## Prerequisites

You need a selected candidate:
- `ownerId`, `project_id`, `candidate_id` — for the API calls below.
- The company name and valuation date — for the memo header.

These are already in context from the orchestrator. If any are missing,
ask the user to pick a valuation row from Step 3 first.

---

## Step 1: Gather the source material (silent)

**Do this silently. Do not narrate the calls in chat.** Make these
`fetch` calls in parallel where possible:

| Call | Purpose |
|---|---|
| `read_tool({"name": "portfolio_valuations__get__valuation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` | Top-level company value, holdings value, status |
| `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` | Which approaches are enabled, with weights |
| `read_tool({"name": "portfolio_valuations__get__gpc", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` | `weighting_rationale`, `multiple_rationale` (only if GPC is enabled) |
| `read_tool({"name": "portfolio_valuations__get__gpc_comp_statistics", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` | Quartile stats for GPC comp set (only if GPC is enabled) |
| `read_tool({"name": "portfolio_valuations__get__custom_value", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` | `description_of_valuation_methodology`, company value, method (only if Custom Value is enabled) |
| `read_tool({"name": "portfolio_valuations__get__financials", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` | Periods used in the valuation (most recent revenue, EBITDA) |

If any of these calls fail, do not abort — degrade gracefully. The memo
section sourced from a failed call becomes a `[Could not retrieve —
check this section in Carta]` placeholder.

## Step 2: Ask the user what depth they want

Ask inline as plain text:

> **What kind of audit notes do you need?**
> 1. **Quick summary** — 3-5 sentences covering the headline (company,
>    date, EV, methodology mix). Good for a board update.
> 2. **Full memo** — sectioned narrative covering methodology, comp
>    selection rationale, multiples rationale, financials referenced,
>    and final value derivation. Good for auditor workpapers.
> 3. **Just one section** — follow up with: which section?
>    (methodology, comps, multiples, financials, final value)

Wait for the reply, then render the matching template in Step 3. If the
user picks "Just one section," ask inline which section they want
before rendering it.

## Step 3: Render the memo

Render the memo **in a fenced markdown code block** so the user can
copy it cleanly. Do not use a code block for prose around the memo —
just for the memo itself.

### Quick summary template

```
## {Company Name} — {Valuation Date} Valuation Summary

As of {valuation date}, the {valuation candidate name} for {company name}
yields a company value of {companyValue formatted as currency} and a
holdings value of {holdingsValue formatted as currency}. The valuation
uses a {weighted breakdown of approaches, e.g. "100% GPC" or "70% GPC,
30% M&A"} methodology. Status: {DRAFT/FINAL/ARCHIVED}.
```

### Full memo template

```
## {Company Name} — {Valuation Date} Valuation Memo

### Subject
{Company Name} portfolio valuation as of {valuation date}.

### Methodology
This valuation applies the following approach weighting:
- {Approach 1}: {weight × 100}%
- {Approach 2}: {weight × 100}%
- ...

{If GPC weighting_rationale is non-empty, render it as a paragraph here.
If empty, render: "[TODO: weighting rationale not yet recorded.]"}

### Comparable Selection
{If GPC is enabled and gpc_comp_statistics is available:}
The Guideline Public Company set comprises {N} comparable companies.
Multiples reference quartile statistics:
- Revenue multiple: median {x.xx}, mean {x.xx}, range [{Q1.xx}, {Q3.xx}]
- EBITDA multiple: median {x.xx}, mean {x.xx}, range [{Q1.xx}, {Q3.xx}]

{If GPC is not enabled, omit this section.}

### Multiple Selection Rationale
{If GPC multiple_rationale is non-empty, render it as a paragraph here.
If empty, render: "[TODO: multiple selection rationale not yet
recorded.]"}

### Custom Value Methodology
{Only if Custom Value is enabled and description_of_valuation_methodology
is non-empty:}
{description_of_valuation_methodology}

### Financials Referenced
The valuation references the following financial periods:
- {Period 1 label}: revenue {$X.XM}, EBITDA {$X.XM}
- {Period 2 label}: revenue {$X.XM}, EBITDA {$X.XM}
- ...

### Final Value Derivation
The selected approach mix yields:
- Enterprise / company value: {companyValue formatted as currency}
- Holdings value (post-allocation): {holdingsValue formatted as currency}
- Status: {DRAFT/FINAL/ARCHIVED}
```

### Section-only template

When the user picks "Just one section," render only that section using
the matching block from the Full memo template above. Skip the document
header.

## Step 4: After rendering

After the memo block, on a new line outside the code block, write:

> "This is read-only — no changes were saved to the valuation. Copy
> the block above into your workpaper, board memo, or audit document
> as needed."

Then offer two follow-ups, asked inline as plain text:

> **Anything else?**
> 1. **Edit a rationale in Carta** — render the deep link below and
>    point out that rationales need to be updated in the Carta UI for
>    now.
> 2. **Move on** — return to the orchestrator's routing.

Wait for the reply, then follow the matching option above.

### Deep link

See [`references/deep-link.md`](../deep-link.md) for URL construction.
Use **Pattern A** (project landing) — Carta has no dedicated
audit-notes tab; rationales are edited within their respective
approach tabs. Required context: `ownerId`, `targetId`, `project_id`.
Render per deep-link.md Step 5 (a markdown link).

## Goal-checklist note

Audit-notes is **not** a checklist item on the End Goal — it's an
adjacent capability the user can invoke at any time once a candidate
exists. Drafting audit notes does not mark anything as complete.

Two entry points exist:

1. **Direct (lateral)** — users invoke it by saying "draft audit
   notes", "summarize rationales for the EV", "write the memo", etc.
   The orchestrator's Step 6 routing table sends them here.
2. **Walk-through suggestion** — `references/dive-in/allocation.md` Step 9
   (walk-through mode) offers audit-notes as one of three options
   right after the per-class allocation renders, while the rationale
   is fresh. After the memo renders, control returns to the
   allocation handoff prompt so the user can still finalize or pause.
