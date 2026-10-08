# Portfolio Valuation Approaches

Help the analyst configure the valuation approach for a portfolio company candidate
by asking one question, then saving the result.

> **Five approaches are supported**: **GPC**, **M&A**, **Post-Money**,
> **Backsolve**, and **Custom Value**. For MVP, GPC, Custom Value, and
> Backsolve have follow-on configuration support in chat — M&A and
> Post-Money enable the approach via
> `call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})`
> and surface a deep link for in-Carta configuration.

> **Tool-surface note:** `mutate:approaches` requires
> `usesCompanyLevelDlom`, `dlomConfigured`, `dlomMethod`,
> `dlomVolatilityManualEntry` and `dlomTimeToExitManualEntry` on **every**
> call, even when none of them is changing — the API rejects them as null,
> and an omitted argument reaches it as an explicit null. Read the current
> values from `get:approaches` in Step 2 and echo them back.
> The per-approach objects (`gpc`, `dcf`, `ma`, `postMoney`,
> `otherIndicationOfValue`, `investedCapital`, …) are the opposite: they are
> ignored when null, so naming only the approaches you are changing leaves
> every other approach's `is_used` and `weight` untouched.
> Approach keys are **camelCase**. The tool silently drops an argument it
> does not declare, so `post_money` or `other_indication_of_value` never
> reaches the API and the write does nothing.

## User-Facing Output Rules (IMPORTANT)

Everything in the "⚠️ Critical Requirements" section below — pre-flight calls,
DLOM field names, HTTP status codes, mutate payload shapes, approach IDs — is
**internal implementation detail for the agent**. It must never appear in chat
output to the user.

**Do NOT say to the user:**
- "Pre-flighting `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {...}})`…" / "Calling `call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})`…"
- "`approach_level_dlom_manual_entry: 0`" / "DLOM fields present"
- "no 404, no 500" / "payload accepted"
- Approach IDs (e.g. "GPC id 1114"), project/candidate numeric IDs in prose
- Any raw JSON, field names, or command names

**DO say to the user (outcome-oriented, in Carta voice):**
- "GPC 100% is set on **{candidate name}** for **{company}**. Ready to pull in
  comps?"
- "Custom Value 100% is set. What company value would you like to use?"
- "That approach is already in place — nothing changed."
- On failure: translate to plain language ("Couldn't save the approach — try
  again, or open the valuation in Carta and come back.")

The user should experience a confident, calm flow. Technical mechanics stay in
the agent's head.

## Prerequisites

You need four IDs to work with a specific candidate and render the deep link:
- `ownerId` — the firm's org_pk integer (e.g. `1` for Krakatoa Ventures)
- `targetId` — the portfolio company's `corporationId` (used for the deep link)
- `project_id` — the valuation project ID
- `candidate_id` — the specific scenario/candidate ID within the project

When reached after a create, these IDs are already in conversation context from
the just-completed `create:project` / `create:project_from_copy` response — use
them directly without re-asking. If any IDs are missing, re-fetch them from
`list:projects` before proceeding. If only `targetId` is missing, proceed without
the deep link rather than guessing.

---

## ⚠️ Critical Requirements (read before any mutate)

Two hard requirements have caused real failures in the past. They are
**non-negotiable** and must be followed every time you write approaches.

### Requirement 1 — Always pre-flight with `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`

You **must** call `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` **before**
calling `call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})`. This call:

1. Lazy-initializes the valuation scenario on the server (this is the step that
   prevents the "scenario hasn't been initialized yet" 404 — running raw
   commands works because the operator naturally fetches first; the skill
   previously skipped this and hit 404s).
2. Returns the actual `id` for each approach object on this candidate. You need
   that `id` to write the approach back.

**Do not skip this call, even if you think you already know the IDs.** The IDs
are per-candidate and the init side-effect is the whole point.

### Requirement 2 — DLOM fields are required on every approach object

Every approach object passed to `call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})` **must** include both:

```
"approach_level_dlom_manual_entry": 0,
"approach_level_dlom_source": null
```

Omitting either field causes a **500 error**. There is no default — the
backend rejects the payload outright. Set them on every approach you write,
every time, even if you're "just" toggling weight or `is_used`.

### Requirement 3 — Weighting rule (non-negotiable)

- **Exactly one approach being set** → it is always written at `weight: 1`
  (100%) with `is_used: true`. Never ask the user for a percentage in this
  case, and never honor a stray percentage the user attaches to a lone
  approach (e.g. "set GPC at 60%" with nothing else mentioned) — a single
  approach is mathematically 100% of the blend by definition. Just set it
  to 100% and proceed.
- **Two or more approaches being set together** (e.g. "set GPC and M&A",
  "blend GPC with Post-Money") → weights across all approaches in the call
  must sum to 1.0 (100%). Before writing anything, ask the user how to
  split the percentages — see Step 1C. Do not guess an even split or any
  other default; wait for the user's answer.

---

## Step 1: Ask Which Approach(es)

If the user has already mentioned **exactly one** approach in their
request (e.g. "set up GPC", "I want to backsolve from the last round",
"use the post-money from our last round"), **skip this picker entirely**
and proceed directly with that choice at 100% (see Requirement 3 above —
no percentage question needed for a single approach). The picker below is
only for users who haven't said which approach.

If the user has mentioned **two or more** approaches in their request
(e.g. "set GPC and M&A", "blend GPC with Post-Money"), skip the picker
too, but go to **Step 1C** to collect the weighting split before
proceeding to Step 2 — do not default to an even split.

### Step 1A: Pick the approach

Ask inline as plain text and wait for the user's free-text reply — all
five approaches in one question, no tools:

> **What's the basis for this valuation?**
> 1. **GPC (public-company comps)** — derive from public-company market multiples. Best when reasonable peer comparables exist.
> 2. **M&A (transaction comps)** — derive from comparable M&A transactions.
> 3. **Backsolve** — solve for implied equity value via OPM, anchored on the latest round's transaction price. Use when you want a DLOM-adjusted, allocation-aware result.
> 4. **Post-Money** — use the latest round's post-money valuation directly. Use when the round is recent and a simple direct read is appropriate.
> 5. **Custom Value** — use a company value the analyst already has in mind (manual EV).

Accept a number, an approach name, or a paraphrase ("use the last
round's post-money" → Post-Money). If the reply names a financing round
without saying which method ("value it off the Series B"), ask which of
Backsolve or Post-Money they want rather than picking one — the two
produce materially different values off the same round.

Then proceed to Step 2 with that approach.

### Step 1C: Collect the weighting split (multiple approaches only)

Reached only when the user's request named two or more approaches
together. Ask in prose, inline as plain text like every other question in
this file:

> "What weighting would you like across **{approach list}**? For example,
> '60% GPC / 40% M&A'."

Parse the reply into a fraction per approach (e.g. 60% → 0.6). The
fractions **must sum to 1.0** — if they don't, or if the user names an
approach that wasn't part of the original set (or omits one that was),
ask again with the specific mismatch called out (e.g. "Those add up to
90%, not 100% — what should the last 10% go to?"). Do not proceed to
Step 2/3 until the split is confirmed.

### MVP scope reminder

For MVP, **GPC**, **Custom Value**, and **Backsolve** have chat-driven
follow-on flows (see their Step 4 sections below — Backsolve chains
into `references/dive-in/backsolve/backsolve.md`). **M&A** and **Post-Money**
enable the approach in Carta but their detailed inputs (transaction
comparables, round dates) are configured in the Carta UI directly. This
reference handles all five at the `call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})` step the same way (DLOM
fields, weight 1, `is_used: true`); the difference is in Step 4
(success messaging + handoff).

No data fetching needed before this question.

---

## Step 2: Pre-flight `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` (REQUIRED — initializes the scenario)

**Do this silently.** Do not announce the call, do not narrate it in chat. The
user should not know this step exists.

Call `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {...}})` with params:

```json
{
  "ownerId": <ownerId>,
  "project_id": <project_id>,
  "candidate_id": <candidate_id>
}
```

**This call serves two purposes**:
- Initializes the valuation scenario on the server (fixes the empty-candidate /
  "scenario not initialized" issue).
- Returns the `id` for each available approach (`gpc`, `otherIndicationOfValue`,
  etc.) which is required as the `id` field in the mutate payload below.

Capture the returned approach IDs in context.

If this call returns 404, retry it **once** after a short pause. If it 404s
again, the candidate genuinely doesn't exist — verify `project_id` and
`candidate_id` are correct (re-fetch from `read_tool({"name": "portfolio_valuations__list__projects", "arguments": {"ownerId": "<ownerId>", "ownerKind": "FIRM", "targetId": "<targetId>", "targetKind": "CORPORATION"}})` if needed) before
proceeding.

---

## Step 3: Save via `call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})`

Once Step 2 has returned the approach IDs, call
`call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})`.

> **Reminder:** every approach object **must** include
> `approach_level_dlom_manual_entry: 0` and `approach_level_dlom_source: null`.
> Omitting either is a guaranteed 500.

Each example below is the `arguments` value passed to `call_tool`. The
examples show the approach object only — add the five required top-level
DLOM fields from the tool-surface note, echoing back the values Step 2
returned.

**GPC 100% example:**
```json
{
  "ownerId": 1,
  "project_id": 7,
  "candidate_id": 7,
  "gpc": {
    "id": <id from Step 2 get:approaches>,
    "is_used": true,
    "weight": 1,
    "approach_level_dlom_manual_entry": 0,
    "approach_level_dlom_source": null
  }
}
```

**Custom Value 100% example:**
```json
{
  "ownerId": 1,
  "project_id": 7,
  "candidate_id": 7,
  "otherIndicationOfValue": {
    "id": <id from Step 2 get:approaches>,
    "is_used": true,
    "weight": 1,
    "approach_level_dlom_manual_entry": 0,
    "approach_level_dlom_source": null
  }
}
```

**M&A 100% example:**
```json
{
  "ownerId": 1,
  "project_id": 7,
  "candidate_id": 7,
  "ma": {
    "id": <id from Step 2 get:approaches>,
    "is_used": true,
    "weight": 1,
    "approach_level_dlom_manual_entry": 0,
    "approach_level_dlom_source": null
  }
}
```

**Post-Money 100% example:**
```json
{
  "ownerId": 1,
  "project_id": 7,
  "candidate_id": 7,
  "postMoney": {
    "id": <id from Step 2 get:approaches>,
    "is_used": true,
    "weight": 1,
    "approach_level_dlom_manual_entry": 0,
    "approach_level_dlom_source": null
  }
}
```

**Backsolve 100% example:**
```json
{
  "ownerId": 1,
  "project_id": 7,
  "candidate_id": 7,
  "backsolve": {
    "id": <id from Step 2 get:approaches>,
    "is_used": true,
    "weight": 1,
    "approach_level_dlom_manual_entry": 0,
    "approach_level_dlom_source": null
  }
}
```

**Blended example (two or more approaches — GPC 60% / M&A 40%, from Step 1C):**
```json
{
  "ownerId": 1,
  "project_id": 7,
  "candidate_id": 7,
  "gpc": {
    "id": <id from Step 2 get:approaches>,
    "is_used": true,
    "weight": 0.6,
    "approach_level_dlom_manual_entry": 0,
    "approach_level_dlom_source": null
  },
  "ma": {
    "id": <id from Step 2 get:approaches>,
    "is_used": true,
    "weight": 0.4,
    "approach_level_dlom_manual_entry": 0,
    "approach_level_dlom_source": null
  }
}
```
All approach objects being set go in the **same** mutate call, weights
from Step 1C's confirmed split (must sum to 1). Every object still needs
both DLOM fields per Requirement 2, regardless of blend.

### Error handling (internal — do not surface raw codes to the user)

- **404 on mutate**: Step 2 should have prevented this. If it still happens,
  re-run Step 2 (the pre-flight `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {...}})`) once and retry the mutate.
  Do NOT tell the user about the 404 or the retry — just do it.
- **500 on mutate**: nearly always a missing DLOM field. Re-check that BOTH
  `approach_level_dlom_manual_entry: 0` and `approach_level_dlom_source: null`
  are present on every approach object in the payload, then retry. Do NOT
  mention DLOM fields to the user.
- **Persistent 404 after retry**: surface a plain-language fallback (no status
  code, no "scenario not initialized" phrasing):
  > Couldn't save the approach right now. Open this valuation in Carta once,
  > then come back and I'll save the configuration: {DEEP_LINK} (rendered
  > per deep-link.md Step 5 — a markdown link, label "Open in Carta")

### Deep link to the valuation

See [`references/deep-link.md`](../deep-link.md) for URL construction.
Use **Pattern B** with `{tab}` = `value-company` (the approaches /
methodology landing tab). Required context: `ownerId`, `targetId`,
`valuation_id`. Render per deep-link.md Step 5 (a markdown
link — label "View in Carta", or "Open in Carta" in the error-handling
fallback above). This is the `{DEEP_LINK}` referenced in the
error-handling section above.

## Step 4: Success messaging + handoff

State the outcome in plain language. Do not mention `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {...}})`,
`call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})`, HTTP codes, field names, or IDs. End each success
message with the deep link on its own line so the user has an easy escape
hatch without it competing with the follow-up question.

The follow-up varies by approach. In **walk-through mode** (orchestrator
Step 6, after a successful create), each follow-up auto-suggests the
natural next step. In **lateral-entry mode** (user invoked
set-approaches directly via Step 6 routing), do not push the next step
— just confirm the save and stop.

### GPC

Say "GPC 100% is set on **{candidate name}**. Ready to pull in comps?",
then on a new line render `{DEEP_LINK}`.

In walk-through mode, on user confirmation, read **`references/dive-in/comps.md`**
inline and follow — the natural next step since GPC needs selected peer
companies before multiples and analysis. The required context (`ownerId`,
`targetId`, `project_id`, `candidate_id`, candidate name) is already in
the conversation.

In lateral-entry mode, just stop and let the user drive.

### Custom Value

Say "Custom Value 100% is set on **{candidate name}**.", then on a new
line render `{DEEP_LINK}`.

Then ask inline as plain text — "What company value would you like to
use for **{company name}**?" — and wait for the reply. Capture it and call
`call_tool({"name": "portfolio_valuations__mutate__custom_value", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "companyValue": "<value>"}})`
with the value. This is in scope for set-approaches since the follow-up
is a single field, not a separate skill flow.

Custom Value takes the number the user gives you. If they instead ask for
a **target** to be solved backwards into multiples and weights, say in one
line that this skill doesn't do that, and offer the two things it does —
enter a value here, or work the GPC multiples by hand
(`references/dive-in/gpc-analysis.md`). Don't iterate multiples yourself
hunting for the number.

### M&A

Say "M&A is enabled on **{candidate name}**. Configure the transaction
comparables and inputs in Carta — I can't drive that flow yet.", then
on a new line render `{DEEP_LINK}`.

Do not chain to another skill. Return control to the orchestrator's
Step 6 routing or, in a walk-through after a fresh create, offer the
next **runnable** checklist item. The value for M&A is set in Carta, so
holdings value is still zero here — **do not offer "Finalize" yet**
(finalize needs a positive holdings value from allocation; see SKILL.md
"How to use the goal"). Offer allocation only once a value is captured.

### Post-Money

Say "Post-Money is enabled on **{candidate name}**. Configure the round
date, amount, and discount in Carta — I can't drive that flow yet.",
then on a new line render `{DEEP_LINK}`.

Do not chain. Return to orchestrator routing. The value is set in Carta,
so holdings value is still zero — **do not offer "Finalize" yet** (it
needs a positive holdings value from allocation).

### Backsolve

Say "Backsolve 100% is set on **{candidate name}**. Ready to pick the
share class to solve from?", then on a new line render `{DEEP_LINK}`.

In walk-through mode, on user confirmation, read
**`references/dive-in/backsolve/backsolve.md`** inline and follow — the natural
next step since Backsolve needs a priced share class selected before
its equity value can be computed. The required context (`ownerId`,
`targetId`, `project_id`, `candidate_id`, candidate name) is already in
the conversation.

In lateral-entry mode, just stop and let the user drive.

Holdings value is still zero until allocation runs — **do not offer
"Finalize" yet** (it needs a positive holdings value from allocation).

### Blended (two or more approaches)

Say "**{Approach A}** {weight A}% / **{Approach B}** {weight B}% is set
on **{candidate name}**." (extend for 3+ approaches), then on a new line
render `{DEEP_LINK}`.

For the follow-up, apply each approach's own rule from above to whichever
approaches are in the blend, in the order they appear: if GPC is one of
them, ask "Ready to pull in comps?" (walk-through mode only, per the GPC
section); if Backsolve is one of them, ask "Ready to pick the share
class to solve from?" (walk-through mode only, chaining into
`references/dive-in/backsolve/backsolve.md` per the Backsolve section); for M&A /
Post-Money in the blend, note that their detailed inputs are configured
in Carta directly (per their sections above) rather than re-asking
anything already covered. If Custom Value is one of them, still run its
company-value follow-up question. Do not offer "Finalize" until every
approach's own value-capture step is complete and holdings value is
non-zero from allocation.

### No change needed (already configured)

If the user picks an approach that's already `is_used: true` with the
same weight, say "That approach is already in place — nothing changed.
Ready to [next step]?", then on a new line render
`{DEEP_LINK}`.

The "next step" prompt depends on the approach (GPC → "pull in comps?";
others → orchestrator routing). Do not skip the prompt.
