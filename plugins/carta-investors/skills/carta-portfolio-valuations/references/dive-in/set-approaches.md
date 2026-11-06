# Portfolio Valuation Approaches

Help the analyst configure the valuation approach for a portfolio company candidate
by asking one question, then saving the result.

Five approaches are supported: **GPC**, **M&A**, **Post-Money**,
**Backsolve**, and **Custom Value**. GPC, Custom Value and Backsolve have
follow-on configuration in chat. M&A and Post-Money are enabled here, and
their values are entered in the methods table (Step 4).

> **Tool-surface note:** the five required top-level DLOM fields
> (SKILL.md § Tool surface) go on every `mutate:approaches` call — echo
> them back from Step 2. Per-approach objects are ignored when null, so
> name only the approaches you're changing. Approach keys are
> **camelCase**: an undeclared key such as `post_money` or
> `other_indication_of_value` is silently dropped and the write does
> nothing.

Pre-flight calls, DLOM fields, status codes, payloads and approach IDs
never appear in chat (SKILL.md § UX Rules). Say outcomes instead: "GPC
100% is set on **{candidate name}**", "That approach is already in place
— nothing changed", or on failure "Couldn't save the approach right now
— want me to try again?"

## Prerequisites

`ownerId`, `targetId` (the company's `corporationId`, for opening its
page in the dashboard MCP App), `project_id` and `candidate_id`. After a
create they're already in context from the create response. If any are
missing, re-fetch from `list:projects`; if only `targetId` is missing, go
ahead without opening the page.

---

## ⚠️ Critical Requirements (read before any mutate)

### Requirement 1 — Always pre-flight with `get:approaches`

Call `get:approaches` **before** every `mutate:approaches` (Step 2). It
initializes the valuation scenario on the server (skipping it gives a
"scenario hasn't been initialized" 404) and returns each approach's `id`,
which the write needs. Never skip it, even if you think you know the IDs.

### Requirement 2 — DLOM fields are required on every approach object

Every approach object passed to `mutate:approaches` **must** include
both, or the call fails with a 500:

```
"approachLevelDlomManualEntry": 0,
"approachLevelDlomSource": null
```

### Requirement 3 — Weighting rule (non-negotiable)

- **Exactly one approach being set** → always `weight: 1` (100%) with
  `isUsed: true`. Never ask for a percentage, and ignore a stray one on a
  lone approach ("set GPC at 60%").
- **Two or more approaches together** → weights must sum to 1.0. Ask the
  split first (Step 1C); never guess an even split.

---

## Step 1: Ask Which Approach(es)

If the user wants to enter the method inputs or the weighting themselves, read
`references/dive-in/methodology-edit-view.md` instead — it opens the methods table for them.

If the request already names **exactly one** approach ("set up GPC",
"use the post-money from our last round"), skip the picker and use it at
100%. If it names **two or more**, skip the picker and go to **Step 1C**.

### Step 1A: Pick the approach

Ask inline as plain text and wait for the reply:

> **What's the basis for this valuation?**
> 1. **GPC (public-company comps)** — derive from public-company market multiples. Best when reasonable peer comparables exist.
> 2. **M&A (transaction comps)** — derive from comparable M&A transactions.
> 3. **Backsolve** — solve for implied equity value via OPM, anchored on the latest round's transaction price. Use when you want a DLOM-adjusted, allocation-aware result.
> 4. **Post-Money** — use the latest round's post-money valuation directly. Use when the round is recent and a simple direct read is appropriate.
> 5. **Custom Value** — use a company value the analyst already has in mind (manual EV).

Accept a number, an approach name, or a paraphrase ("use the last
round's post-money" → Post-Money). If the reply names a financing round
without saying which method ("value it off the Series B"), ask whether
they want Backsolve or Post-Money — the two give materially different
values off the same round.

Then proceed to Step 2.

### Step 1C: Collect the weighting split (multiple approaches only)

Ask in prose:

> "What weighting would you like across **{approach list}**? For example,
> '60% GPC / 40% M&A'."

Parse each into a fraction (60% → 0.6). If they don't sum to 1.0, or the
reply adds or drops an approach, ask again naming the mismatch ("Those
add up to 90%, not 100% — what should the last 10% go to?"). Don't go on
until the split is confirmed.

---

## Step 2: Pre-flight `get:approaches` (REQUIRED — initializes the scenario)

**Do this silently.** Call `get:approaches` and capture each approach's
`id` (`gpc`, `otherIndicationOfValue`, …) plus the five top-level DLOM
fields to echo back.

If it returns 404, retry **once** after a short pause. If it 404s again,
verify `project_id` and `candidate_id` (re-fetch from `list:projects`)
before going on.

---

## Step 3: Save via `mutate:approaches`

Call `call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {...}})`
with one object per approach being set, keyed by its approach key, plus
the five top-level DLOM fields echoed from Step 2:

| Approach | Key |
|---|---|
| GPC | `gpc` |
| M&A | `ma` |
| Post-Money | `postMoney` |
| Backsolve | `backsolve` |
| Custom Value | `otherIndicationOfValue` |

**Single approach (GPC shown):**
```json
{
  "ownerId": 1,
  "project_id": 7,
  "candidate_id": 7,
  "gpc": {
    "id": <id from Step 2 get:approaches>,
    "isUsed": true,
    "weight": 1,
    "approachLevelDlomManualEntry": 0,
    "approachLevelDlomSource": null
  }
}
```

**Blended (GPC 60% / M&A 40%, from Step 1C):**
```json
{
  "ownerId": 1,
  "project_id": 7,
  "candidate_id": 7,
  "gpc": {
    "id": <id from Step 2 get:approaches>,
    "isUsed": true,
    "weight": 0.6,
    "approachLevelDlomManualEntry": 0,
    "approachLevelDlomSource": null
  },
  "ma": {
    "id": <id from Step 2 get:approaches>,
    "isUsed": true,
    "weight": 0.4,
    "approachLevelDlomManualEntry": 0,
    "approachLevelDlomSource": null
  }
}
```

All approaches go in the **same** call.

### Error handling

- **404 on mutate**: re-run Step 2 once and retry, without telling the
  user.
- **500 on mutate**: nearly always a missing DLOM field (Requirement 2).
  Fix the payload and retry.
- **Persistent 404 after retry**: say, with no status code:
  > Couldn't save the approach right now. Open this valuation's page once
  > in Carta's valuations dashboard, then come back and I'll save the
  > configuration.

  Offer to take them there, and open it only on a yes (SKILL.md **Page navigation → After an action, offer instead of moving**).

## Step 4: Success messaging

State the outcome in plain language. Then return control — the user
drives (SKILL.md Step 2.5b). Holdings
value stays zero until allocation runs, so never offer "Finalize" here.

### GPC

"GPC 100% is set on **{candidate name}**." If the user then asks to pick
comps, read `references/dive-in/comps.md`.

### Custom Value

"Custom Value 100% is set on **{candidate name}**." Then ask — "What
company value would you like to use for **{company name}**?" — and save
the reply with
`call_tool({"name": "portfolio_valuations__mutate__custom_value", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "companyValue": "<value>"}})`.

If they ask for a **target** to be solved backwards instead, say in one
line that this skill doesn't do that, and offer entering a value here or
working the GPC multiples by hand (`references/dive-in/gpc-analysis.md`).

### M&A

"M&A is enabled on **{candidate name}**." Then offer the methods table
for the M&A value (`references/dive-in/methodology-edit-view.md`, **Offer
it instead of sending the user to Carta**).

### Post-Money

"Post-Money is enabled on **{candidate name}**." Then offer the methods
table for the post-money value, as for M&A.

If the table can't be used (that file's **When the view cannot be used**),
ask "What post-money value would you like to use for **{company name}**?"
and save the reply with
`call_tool({"name": "portfolio_valuations__mutate__post_money", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "equityValueOverride": <value>}})`.

### Backsolve

"Backsolve 100% is set on **{candidate name}**." If the user then asks
to pick the share class or run it, read
`references/dive-in/backsolve/backsolve.md`.

### Blended (two or more approaches)

"**{Approach A}** {weight A}% / **{Approach B}** {weight B}% is set on
**{candidate name}**." (extend for 3+). Add each approach's own line from
above where it has one — the methods-table offer for M&A and Post-Money,
and the company-value question for Custom Value. When the blend includes
M&A or Post-Money, make one methods-table offer naming every method that
needs a value, and skip the Custom Value question: on yes the user enters
them all in the table.

### No change needed (already configured)

If the approach is already `isUsed: true` at the same weight, say "That
approach is already in place — nothing changed."
