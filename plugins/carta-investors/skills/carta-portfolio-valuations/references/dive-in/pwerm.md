# Portfolio Valuation — Probability-Weighted (PWERM)

Build or work on a valuation that blends several weighted outcomes — an
upside, a downside, a base case — each valued on its own and combined by
probability. Use this when the user asks for a probability-weighted
valuation, a PWERM, or "weight an upside and a downside".

**"Scenario" means two different things here. Get this right or the user
ends up with the wrong shape.**

- `add-candidate.md` adds a *sibling candidate* — a separate what-if
  version of the valuation, with its own company value. Nothing is
  blended; the user picks one.
- This file builds **one candidate that contains several weighted
  scenarios**. The candidate's company value is the probability-weighted
  sum of its scenarios'.

If the user says "add a scenario" meaning "another version to compare",
they want `add-candidate.md`. If they want the outcomes weighted and
combined into one number, they want this file. When the phrasing is
genuinely ambiguous ("add a downside scenario"), ask which:

> Do you want these weighted together into one blended value, or kept as
> separate versions to compare side by side?

## Prerequisites

**On an existing project** (the usual path, reached from Step 2.5a):
`ownerId` and `project_id`, plus `candidate_id` when working on a PWERM
candidate that already exists.

**With no project yet** there is no Step 2.5a recap, so collect the
project's inputs before writing anything, each from the part of
`create-val.md` that asks for it: its **Prerequisites → Resolving the
target** for `ownerKind`, `targetId` and `targetKind`, its **Step 1**
for `valuationDate`, and its **Step 3** for the candidate name. Follow
those sections rather than guessing a payload.

A `403` or `404` from **any** PWERM command — `create:pwerm_project`,
`create:pwerm_candidate`, `get:scenarios`, `mutate:scenarios` — means
probability-weighted valuations are not enabled for this account. **Do
not retry, and do not try another PWERM command.** This covers the
re-weighting path too, which starts at `get:scenarios`. Say so plainly
and offer what this skill can do instead:

> Probability-weighted valuations aren't switched on for your account
> yet. I can set up a standard valuation now, or you can ask your Carta
> contact about enabling them.

## Step 1: Agree the scenarios before creating anything

Ask for the scenarios and their weights in one question — names and
probabilities together, because a weight means nothing without the
outcome it belongs to.

> What outcomes would you like to weight, and how likely is each? For
> example: Downside 30%, Base 50%, Upside 20%.

Rules to hold:
- **At least two scenarios.** One weighted outcome is a standard
  valuation; say so and route to `create-val.md`.
- **Weights must sum to exactly 1.** Accept percentages or decimals and
  convert. If they don't sum to 1, show the sum and ask — never
  normalise silently, because a user who says 30/30/30 may have meant to
  add a fourth scenario rather than to round.
- **Names must be unique.**

## Step 2: Create the candidate

On a project that already exists:

```json
call_tool({"name": "portfolio_valuations__create__pwerm_candidate", "arguments": {
  "ownerId": "<org_pk>",
  "project_id": <project_id>,
  "name": "<candidate name>",
  "scenarios": [
    {"name": "Downside", "weight": "0.30"},
    {"name": "Base",     "weight": "0.50"},
    {"name": "Upside",   "weight": "0.20"}
  ]
}})
```

With no project yet, call
`portfolio_valuations__create__pwerm_project` instead. It takes the same
`scenarios` list plus the project inputs `create__project` takes —
`ownerId`, `ownerKind`, `targetId`, `targetKind`, `valuationDate` and
the candidate name, which goes in as `valuationCandidateName` — and
creates the project and its first candidate together.

Each scenario also takes `useInReport` (default true) and an optional
`exitEquityValue`. Pass `exitEquityValue` only when the user has already
told you what an outcome is worth; it is create-time input and is never
echoed back, so read values afterwards from `get:scenarios`.

`copyFromCandidateId` copies an existing candidate's inputs — offer it
when the user is building a PWERM version of a valuation they already
have, so the comps and financials carry over.

The response confirms `candidateId`, `weightSum` and each scenario's
`id`. Hold those ids: every method call below needs one.

## Step 3: Let the blockers drive the rest

Do not invent a checklist. Read the state and let it tell you what is
left:

```json
read_tool({"name": "portfolio_valuations__get__scenarios", "arguments": {
  "ownerId": "<org_pk>",
  "project_id": <project_id>,
  "candidate_id": <candidate_id>
}})
```

It returns every scenario with its `weight`, `scenarioCompanyValue` and
`allocation`, plus `canFinalize` and a `blockers` list. Each blocker
names the scenario it belongs to, and `nextAction` names the first one.

| Blocker | What it means | Where to go |
|---|---|---|
| `TOO_FEW_SCENARIOS` | Fewer than two weighted scenarios | `mutate:scenarios` to add one |
| `WEIGHTS_NOT_ONE` | The weights don't sum to 1 | Show the sum, ask, then `mutate:scenarios` |
| `NO_COMPANY_VALUE` | A scenario has no value yet | Step 4, for that scenario |
| `ALLOCATION_NOT_RUN` | A scenario's value isn't allocated | Step 4's **Allocation** rule — the standard-engine path with its three overrides, not just the run |
| `ALLOCATION_STALE` | Inputs changed since the allocation ran | The same rule again for that scenario |
| `CANDIDATE_NOT_DRAFT` | Already finalized | Say so; finalizing again isn't possible |
| `NOT_PWERM` | Not a probability-weighted candidate | Wrong flow — re-read the routing table |

Report progress in the user's terms — "Upside still needs a company
value" — rather than the code.

## Step 4: Value each scenario

The method flows in `references/dive-in/` were written for the standard
scenario. **For a weighted scenario these rules override what those
files say.** Read the rule before following the flow.

- **Methods table** (`methodology-edit-view.md`) — **never open it for a
  weighted scenario.** It takes `valuation_id` and nothing else, and it
  saves on its own, so whatever the user types lands on the candidate's
  standard scenario and the weighted one keeps `NO_COMPANY_VALUE`. This
  overrides the SKILL.md routing row that sends "let me type it in
  myself" to the methods table, and every offer of it in
  `set-approaches.md`: its Step 1 by-hand entry, and the M&A, Post-Money
  and Blended success messages.
- **M&A, post-money and custom value** — follow `set-approaches.md`
  Requirements 1–3 and its Step 3 first: `get:approaches`, which
  initializes the scenario on the server and returns each approach's id,
  then `mutate:approaches` to turn the approach on and give it a weight.
  Both take `scenario_id`. Only then write the value — `mutate:ma`,
  `mutate:post_money` or `mutate:custom_value`, also with `scenario_id`.
  Writing the value first either fails or stores it under an approach
  with no weight, leaving the scenario at `NO_COMPANY_VALUE`.
- **Comps** (`comps.md`) — unchanged. `get:reference_comparables` keeps
  `scenarioId` set to `standardScenario.id`, because the comps are
  shared across scenarios. Do not substitute the weighted scenario's id:
  the parameter is a different one from `scenario_id`, and the call
  fails outright without it.
- **Allocation** (`allocation.md`) — follow its **standard-engine**
  path, with three overrides. **Skip its Step 1 company-value check**:
  that reads `get:valuation`, whose `companyValue` is the candidate's
  blend, so it can be empty while this scenario already has its value —
  and its refusal sends the user to the standard scenario. `get:scenarios`
  has already shown this scenario has a value, because it raised no
  `NO_COMPANY_VALUE` for it. **Drop both Niagara methodologies from
  Gate 0's available set before its empty-set check**; if nothing is
  left, say this outcome can't be allocated from chat and offer the
  valuation's page in Carta. Then run the path as written — the
  methodology choice, the debt, time-to-exit, volatility and DLOM
  questions, `mutate:allocation` to save them, `compute:allocation` to
  run the math — passing `scenario_id` on `get:allocation`,
  `mutate:allocation` and `compute:allocation`. Jumping straight to
  `compute:allocation` runs the math with no saved methodology or DLOM,
  on inputs nobody chose. **Report the result from the
  `compute:allocation` response and this scenario's row in
  `get:scenarios`, not `get:valuation`** — its Steps 8–9 announce the
  candidate's figures — **then go back to Step 3** rather than handing
  control back.
- **Backsolve** (`backsolve/backsolve.md`) — the flow's comparison call
  omits `allocationId`, which defaults to the standard scenario's
  allocation. Pass this scenario's allocation id instead; `get:scenarios`
  returns it as `allocation.id` per scenario.
- **Financials** — shared, like comps. `get:financials` and
  `mutate:financials` take no scenario; a weighted scenario reads the
  standard scenario's financials.
- **Everything else** in those flows — the approaches, allocation, GPC,
  M&A, DCF, backsolve, post-money and custom-value reads and writes —
  takes `scenario_id`.

| The user wants | Read | With |
|---|---|---|
| Guideline public companies | `gpc-analysis.md` | `scenario_id` on every GPC call; comps rule above |
| Comparable acquisitions (M&A) | `set-approaches.md`, then in chat | the M&A rule above, then `mutate:ma` / `mutate:ma_transactions` |
| Backsolve to a financing round | `backsolve/backsolve.md` | `scenario_id`, plus the allocation rule above |
| Post-money from the last round | `set-approaches.md`, then in chat | the M&A rule above, then `mutate:post_money` |
| A value they'll type themselves | `set-approaches.md`, then in chat | the M&A rule above, then `mutate:custom_value` |

**Read the scenario's M&A state first**, with `scenario_id`: `get:ma`
returns the selected `transactions`, each with its `identifier`, and the
multiple rows whose `id`s `mutate:ma` takes. Build
`transactionIdentifiers` from that list plus the user's additions. If
the user names a deal that isn't in it and gives no identifier, say this
skill can't search transactions and offer the valuation's page in Carta.

`get:ma`, `mutate:ma` and `mutate:ma_transactions` appear nowhere else
in this skill, so their shapes:

```json
read_tool({"name": "portfolio_valuations__get__ma", "arguments": {
  "ownerId": "<org_pk>",
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "scenario_id": <scenario_id>
}})
```

```json
call_tool({"name": "portfolio_valuations__mutate__ma_transactions", "arguments": {
  "ownerId": "<org_pk>",
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "scenario_id": <scenario_id>,
  "transactionIdentifiers": ["<capiq_id>", "..."]
}})
```

```json
call_tool({"name": "portfolio_valuations__mutate__ma", "arguments": {
  "ownerId": "<org_pk>",
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "scenario_id": <scenario_id>,
  "multiplesMethod": "<method>",
  "multiples": [{"id": <multiple_id>, "revenueWeight": <weight>, "ebitdaWeight": <weight>}],
  "multipleRationale": "<why these multiples>"
}})
```

`transactionIdentifiers` replaces the whole selection, so send every
transaction to keep, not just the new one — which is why the `get:ma`
read comes first. Every field on `mutate:ma` is optional; send only
what the user set.

The M&A value adds every multiple's weighted revenue and weighted EBITDA
into one figure, so the weights are one allocation: every
`revenueWeight` plus every `ebitdaWeight` across the scenario's
multiples (as `get:ma` returns them) totals 1 **jointly**. One multiple
at `revenueWeight` 0.5 and `ebitdaWeight` 0.5 is a full weighting; 1 and
1 counts the value twice. Nothing server-side enforces that for M&A, so
a wrong total silently scales the scenario's value.

Omitting `scenario_id` on a call that takes it addresses the candidate's
standard scenario, which carries no weight and is not part of the blend
— the call succeeds, the number looks plausible, and the scenario the
user named is untouched.

Comps, financials and the cap table are shared across scenarios, so
changing them changes every scenario. That is what the user expects when
they say "use these comps" — say so if they ask why one change moved
more than one outcome.

## Step 5: Show the blend

Once `canFinalize` is true, show the scenarios and the number they
produce:

| Scenario | Weight | Company value |
|---|---:|---:|
| Downside | 30% | {value} |
| Base | 50% | {value} |
| Upside | 20% | {value} |
| **Blended** | **100%** | **{candidate company value}** |

Read the blended figure from the candidate rather than multiplying the
rows yourself. Carry each amount's own currency (**Currency default**).

Then offer the next step: finalize (`ship.md`), adjust a weight
(`mutate:scenarios`), or revisit a scenario's value (Step 4).

## Changing an existing PWERM candidate

`mutate:scenarios` adds, renames, re-weights and removes in one call.
Ids come from `get:scenarios`. An entry with an `id` updates that
scenario; one without creates it.

```json
call_tool({"name": "portfolio_valuations__mutate__scenarios", "arguments": {
  "ownerId": "<org_pk>",
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "scenarios": [
    {"id": <scenario_id>, "name": "Downside", "weight": "0.40"},
    {"id": <scenario_id>, "name": "Base",     "weight": "0.45"},
    {"id": <scenario_id>, "name": "Upside",   "weight": "0.15"}
  ],
  "deleteScenarioIds": []
}})
```

Re-weighting is the common request ("make the downside 40%"). The
weights must still sum to 1 afterwards, so work out what else has to
move and **confirm the whole set before writing**:

> Taking Downside to 40% leaves 60% across Base and Upside. Should I
> make them 45% and 15%, keeping their current ratio?

Removing a scenario frees its weight, which leaves the rest summing to
less than 1 — handle the same way, in the same question.
