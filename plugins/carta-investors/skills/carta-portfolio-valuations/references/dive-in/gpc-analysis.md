# Portfolio Valuation — GPC Analysis (Guided)

Run the **Guideline Public Company** analysis on a candidate. This is
the methodology layer that sits on top of the GPC comp set built via
`dive-in/comps.md`. It covers three things, the user picks which:

1. **Configure GPC methodology** — regression method, multiples approach
   (e.g. BEV), and capture rationales.
2. **Set per-comp multiples** — pick percentile selections per metric
   (revenue, EBITDA), or override with manual entries.
3. **View quartile statistics** — show mean/median/Q1/Q3 across the
   selected GPC comp set.

The user usually wants one of these three things at a time. The
reference routes to whichever they ask for.

## UX Rules

When presenting 5 or fewer choices, always ask inline as plain text —
a short question followed by a numbered list of options.

## User-Facing Output Rules

Do not surface raw command names, API field names, HTTP status codes,
or numeric project/candidate/comparable IDs in chat. Speak in business
terms ("regression", "multiples", "median", "quartile", "BEV").
Rendered tables of comp multiples, statistics, and overrides include
numeric values and ticker names — that's expected output.

## Prerequisites

You need a selected candidate with GPC ready to analyze:
- `ownerId`, `project_id`, `candidate_id` — for the API calls.
- `targetId` — for the deep link.
- The company name and candidate name — for messaging.
- **GPC must be enabled in approaches** (`read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`.`gpc.is_used` is
  `true`).
- **At least one comp must be saved with `is_gpc: true`**
  (`read_tool({"name": "portfolio_valuations__get__comparables", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` returns at least one such row).
- **Financials must be entered on the candidate** (`read_tool({"name": "portfolio_valuations__get__financials", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`
  returns at least one period with non-zero revenue or EBITDA).

These should be in conversation context from the orchestrator. If GPC
is not enabled, read `references/dive-in/set-approaches.md` inline with
intent "enable GPC" and stop. If no GPC comps are saved, read
`references/dive-in/comps.md` inline and stop. If financials are
missing, tell the user to fill them in before continuing. Do not
attempt the GPC analysis without all three prerequisites.

## Goal-checklist contribution

Gpc-analysis contributes to **End Goal item 3 (Required approach
inputs)** when GPC is enabled. Specifically: GPC requires
`read_tool({"name": "portfolio_valuations__get__gpc_multiples", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` to return a non-empty multiples set. Once a
`call_tool({"name": "portfolio_valuations__mutate__gpc_multiples_selection", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "multiples": [...]}})` succeeds, this half of GPC's input requirement is
met. (The other half — comps with `is_gpc: true` — is handled by
`references/dive-in/comps.md`.)

This reference also typically contributes to **End Goal item 4 (Company
value is non-zero)**, since saving GPC multiples flows through to a
`companyValue` derivation.

## Step 1: Verify prerequisites (silent)

Before doing anything, verify GPC is enabled and comps exist. **Do this
silently** unless a prerequisite fails.

Call `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`:
- If `gpc.is_used` is not `true`, surface plain language and ask inline:
  > "GPC isn't enabled on **{candidate name}** yet. Want to enable it
  > and configure?"
  > 1. **Enable GPC now** — read `references/dive-in/set-approaches.md`
  >    with intent "enable GPC" and follow inline.
  > 2. **Cancel** — return to the orchestrator's routing.
  Wait for the reply, then route accordingly.

Call `read_tool({"name": "portfolio_valuations__get__comparables", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`:
- Filter to `is_gpc: true` rows. If zero, surface and ask inline:
  > "No GPC comps are saved on **{candidate name}** yet. Want to add
  > some?"
  > 1. **Add comps now** — read `references/dive-in/comps.md` inline.
  > 2. **Cancel** — return to the orchestrator's routing.
  Wait for the reply, then route accordingly.

Call `read_tool({"name": "portfolio_valuations__get__financials", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` (this reads the revenue,
EBITDA, and other financial inputs **entered directly in the valuation
scenario** — not pulled from a data warehouse or external source):
- Check that at least one period has a non-zero revenue or EBITDA value.
- If `periods` is empty or all periods have zero revenue and EBITDA, try
  `call_tool({"name": "portfolio_valuations__get__financials_refresh", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` once to pull the
  latest inputs from source records. Then re-call `read_tool({"name": "portfolio_valuations__get__financials", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`.
  **Do this silently** — do not tell the user about the retry.
- If still empty after the refresh attempt, surface and stop:
  > "**{candidate name}** doesn't have any financials entered yet.
  > Please fill in revenue and/or EBITDA in Carta before running GPC
  > analysis, then come back."
  Render `{DEEP_LINK}` on its own line and
  stop. Use **Pattern B** with `{tab}` = `financials`.
- The prerequisite check is the only reason to call this; Step 3B.1b gets its
  own revenue and EBITDA figures from `get:gpc_multiples_selection`.

All three prerequisites pass → proceed to Step 2.

## Step 2: Ask what the user wants to do

Ask inline as plain text:

> "What part of the GPC analysis would you like to work on?"
> 1. **Configure methodology** — regression method, multiples approach
>    (e.g. BEV), and rationales.
> 2. **Set per-comp multiples** — pick percentile selections per
>    metric, or override with manual entries.
> 3. **View statistics** — show mean/median/quartile stats across
>    the selected comp set.
> 4. **Run all three in order** — guided pass through 1 → 2 → 3.
> 5. **Cancel** — return to the orchestrator's routing.

Wait for the reply, then route to the matching step below.

If the user has already mentioned an intent in their request (e.g.
"set the median multiple", "show quartile stats", "what's the
methodology?"), skip the question and proceed directly with that
intent.

## Step 2b: Choose the multiple method (REQUIRED before any multiples fetch)

`get:gpc_multiples` returns **one** method's dataset per call — MVIC or
BEV, never both, because the two together exceed the response size limit.
So the method must be chosen before the first fetch.

Ask inline as plain text, and **do not assume the default**:

> "Which multiple method would you like to see?"
> 1. **MVIC** — market value of invested capital.
> 2. **BEV** — business enterprise value.

Hold the reply as `gpc_method` and pass it as `method` on every
`get:gpc_multiples` call in this reference. Ask once per session; reuse
`gpc_method` for later fetches unless the user asks to switch. If the user
names a method in their request ("show me the BEV multiples"), resolve it
silently and skip the question. If they decline to choose, use `MVIC` —
that is the command default and the more common method.

**One call, nothing else.** `get:gpc_multiples` is the only command needed
for the multiples data — it already carries `compMultiplesData` (per-comp
multiples and quartiles for the chosen method) and `gpc`. Do not call
`get:gpc`, `get:gpc_comp_statistics`, `get:comparables` or
`get:financials` to assemble or enrich this view.

The "Run all three" option is the natural walk-through path — when
this reference is loaded by the orchestrator's walk-through mode,
default to that option without asking.

## Step 3A: Configure methodology

Triggered by Step 2 option 1 or 4.

### Step 3A.1: Show current configuration

Call `read_tool({"name": "portfolio_valuations__get__gpc", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` and render the current state in plain language:

> "Current GPC methodology on **{candidate name}**:
> - Regression: {regressionSelection or 'not set'}
> - Multiples approach: {multiplesApproach or 'not set'}
> - Weighting rationale: {weightingRationale snippet or '[none]'}
> - Multiple rationale: {multipleRationale snippet or '[none]'}"

If `weightingRationale` or `multipleRationale` is more than 80 chars,
truncate with `…`.

### Step 3A.2: Pick what to change

Ask inline as plain text:

> "What would you like to change?"
> 1. **Regression method** — follow up with a free-text prompt asking
>    for the regression identifier (e.g. "linear", "log-linear"). The
>    API accepts a string identifier; do not invent values.
> 2. **Multiples approach** — follow up with a free-text prompt asking
>    for the approach identifier (e.g. "BEV"). Same rule.
> 3. **Weighting rationale** — follow up with a free-text prompt for
>    the narrative.
> 4. **Multiple rationale** — same.
> 5. **Done — save and continue** — proceed to Step 3A.3 with whatever
>    the user has accumulated so far.

Allow the user to change multiple things in one turn. After each
change, re-show the current draft state and ask "anything else?" until
the user picks "Done."

### Step 3A.3: Save GPC config

Call:

```json
call_tool({
  "name": "portfolio_valuations__mutate__gpc",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "weightingRationale": "<value or null>",
    "multipleRationale": "<value or null>",
    "regressionSelection": "<value or null>",
    "multiplesApproach": "<value or null>"
  }
})
```

Only include fields the user changed. Do not send fields that weren't
touched.

### Step 3A.4: Show what was saved

> "GPC methodology saved on **{candidate name}**:"

Then one line per changed setting — `{Setting} — {previous} → {saved}`
(e.g. `Regression — linear → log-linear`).

Then proceed per Step 2 mode:
- "Configure methodology" only (option 1) → return to Step 2.
- "Run all three" (option 4) → proceed to Step 3B (multiples).

### Error handling for `call_tool({"name": "portfolio_valuations__mutate__gpc", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`

- **404**: re-fetch `read_tool({"name": "portfolio_valuations__get__gpc", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` to verify the candidate is initialized,
  retry once. Do not surface the 404.
- **500**: usually a malformed field. Retry once. Do not surface.
- **Persistent failure**: surface the plain-language fallback:
  > "Couldn't save GPC methodology right now. {DEEP_LINK}."

## Step 3B: Set per-comp multiples

Triggered by Step 2 option 2 or 4.

### Step 3B.1: Pre-flight `read_tool({"name": "portfolio_valuations__get__gpc_multiples", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` (REQUIRED)

**Do this silently.** This pre-flight is required for two reasons:
- It returns the quartile statistics the percentile choices in Step 3B.2
  resolve against.
- It returns the existing per-comp data — needed to construct the
  `multiples` payload.

**It does not give you the ids the write needs.** The `id` on every
`multiples` entry in Step 3B.4 is the `multiple.id` from
`read_tool({"name": "portfolio_valuations__get__gpc_multiples_selection", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`,
which returns `allGpcMultiplesFinancialsMap` — one entry per period,
each holding a `multiple` object and a `financial` object with
**different** ids. Take `multiple.id`, never `financial.id`, and never a
comparable id. Call that command too before writing.

Call:

```json
read_tool({
  "name": "portfolio_valuations__get__gpc_multiples",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "method": "<gpc_method from Step 2b — MVIC or BEV>"
  }
})
```

Capture the response. The shape is:
- `gpc` — `id`, `regressionSelection`, `multiplesApproach`.
- `compMultiplesData` — keyed by the **requested method** (`MVIC` or `BEV`),
  then by **metric** (`REVENUE`, `EBITDA`). Each metric holds:
  - `multiples` — per-comparable `ltm`/`ntm`/`year0`–`year2` values plus
    exclusion flags.
  - `quartiles` — `min`/`mean`/`median`/`max` and percentiles per period.

`compMultiplesData` is **not** keyed by period ID, and it does not carry
`selectionDate`, `revenueMultipleManualEntry`, `ebitdaMultipleManualEntry`,
`revenueWeight` or `ebitdaWeight`. Those are the per-period *selection*
figures, which live in the upstream `allGpcMultiplesFinancialsMap` field —
a separate payload that this command does not return.

If the response is empty (`compMultiplesData` is absent or has no entries),
surface a fallback:
> "GPC multiples aren't ready yet on **{candidate name}**.
> {DEEP_LINK}."

### Step 3B.1b: Show the per-period multiples (REQUIRED — display before multiples)

**Do this silently** then render the table below before proceeding.

Call:

```json
read_tool({
  "name": "portfolio_valuations__get__gpc_multiples_selection",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

This returns `allGpcMultiplesFinancialsMap` — one entry per financial period,
each with a `multiple` and the `financial` it applies to. **One call is
enough**: revenue, EBITDA and their labels are included, so do not call
`get:financials`, and do not try to read period data from
`get:gpc_multiples` (its `compMultiplesData` is keyed method → metric and
carries no periods).

For each entry, extract:
- **Multiple id** — `multiple.id`. **Always display this as the first
  column.** It is the key `mutate:gpc_multiples_selection` writes against, and
  it lets the user point at a row directly ("set 9247 to 2.5x"). One
  `multiple.id` covers both the Revenue and the EBITDA row of a period, so a
  write against it affects both legs.
- **Period** — `financial.revenueLabel` / `financial.ebitdaLabel` (e.g.
  "07/01/2025 - 06/30/2026 revenue", "CY 2026 EBITDA"). These already name
  the period, so no date matching is needed.
- **Value** — `financial.revenue` or `financial.ebitda`.
- **Multiple** — `multiple.revenueMultiple` or `multiple.ebitdaMultiple`
  (`0` means unset — show `—`). `revenueMultipleManualEntry` /
  `ebitdaMultipleManualEntry` hold the manually-typed value when the user
  overrode the percentile pick.
- **Weighting** — `multiple.revenueWeight` or `multiple.ebitdaWeight`
  (`0` means unset).
- **Percentile** — `multiple.revenueMultipleClosestPercentile` /
  `ebitdaMultipleClosestPercentile` with
  `...ManualEntryPercentileSelection` as the numeric value (e.g. `52.1`,
  closest `median`). Show `—` when the multiple is unset.
- **Adjusted Value** — `value × multiple × weighting`. Show `—` if either
  the multiple or weighting is unset.

Render as a markdown table with **two rows per period** (one for Revenue,
one for EBITDA), in the order the entries are returned:

| Multiple id | Period | Metric | Value | Multiple | Weight | Percentile | Adjusted Value |
|---|---|---|---|---|---|---|---|
| 9247 | 07/01/2025 - 06/30/2026 | Revenue | $11,500,000 | 3.00x | 1.00 | 52.1 (median) | $34,500,000 |
| 9247 | 07/01/2025 - 06/30/2026 | EBITDA | $9,500,000 | — | — | — | — |
| 9249 | CY 2026 | Revenue | $14,000,000 | — | — | — | — |
| … | … | … | … | … | … | … | … |

Show **every** period, both metrics — do not collapse or omit unweighted
rows. A period with financials but no weight is a candidate the user may want
to blend in, so it has to be visible.

Format values as currency with thousands separators (no cents). Format
multiples as `{n}x` to 2 decimals. Format weighting as a decimal (e.g.
`1.00`, `0.50`). If revenue or EBITDA is `$0` for a period, display `$0`
and note it as not entered.

The `—` cells above are for the documented unset cases only (multiple or
weighting of `0`); anything the response returned is rendered as returned,
never `NM` (`SKILL.md` §Table values).

The weighted rows should reconcile to the scenario's company value — a
single period at weight `1.00` means its adjusted value *is* the GPC
company value. Say so when it holds; flag it if it doesn't.

After rendering the table, if any active periods (non-zero financial value)
are missing multiples or weightings, surface a short note:
> "Some periods are missing multiples or weightings — the steps below will
> help set them."

### Step 3B.1c: Offer AI-assisted analysis or manual entry

After rendering the financial mapping table, ask inline as plain text:

> "How would you like to set the multiples and weightings?"
> 1. **Recommend multiples based on comp statistics** — I'll pull the comp
>    statistics, choose the best multiples and weightings, and explain my reasoning.
> 2. **I'll enter them manually** — show me the table and I'll tell you
>    what to use.

Wait for the reply, then follow the matching path below.

#### If the user picks option 2 (manual entry):

Re-display the financial mapping table (from Step 3B.1b) with current
values. Then ask in prose:

> "Which multiples and weightings would you like to use? You can specify
> by period and metric — e.g. 'LTM Revenue: 8.5x, weight 1.0' or
> 'use median for all revenue periods'."

Capture the user's input, validate that:
- All `revenueWeight` values across all period rows sum to exactly 1.0.
- All `ebitdaWeight` values (when EBITDA is in scope) sum to exactly 1.0.

If they don't sum to 1.0, surface a plain-language correction:
> "Those weightings add up to {sum × 100}% — they need to total 100%
> exactly. Try again?"

Once valid, proceed to Step 3B.4 to save.

#### If the user picks option 1 (AI-assisted):

**Step i — Fetch comp statistics (silently)**

Call:

```json
read_tool({
  "name": "portfolio_valuations__get__gpc_comp_statistics",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

Capture mean, median, Q1, Q3 for both Revenue and EBITDA multiples.

**Step ii — Reason about the best multiples**

Apply the following judgment rules in order:

1. **Prefer the period with the most complete financials.** If LTM has
   non-zero revenue and EBITDA, weight it at 1.0. If LTM is zero but NTM
   is non-zero, weight NTM at 1.0. If multiple periods are non-zero,
   favour the most recent historical period (LTM > CY current year > NTM).

2. **One period drives the weight.** Place the full 1.0 weight on the
   chosen period; set all other period rows to 0. This ensures weightings
   sum to exactly 1.0 for both revenue and EBITDA.

3. **Pick the multiple percentile and resolve the numeric value.**
   Default to **median** as a neutral, outlier-resistant choice. If
   the comp set is small (≤ 5 comps), consider mean instead. Look up
   the actual statistic value from `read_tool({"name": "portfolio_valuations__get__gpc_comp_statistics", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` (e.g.
   the median revenue multiple is `8.45`). Capture that float — the
   API expects an explicit numeric entry, not a percentile label.

4. **Revenue vs. EBITDA scope.** If EBITDA is negative or zero across
   all comps (early-stage company), disable EBITDA (`ebitdaWeight: 0`
   across all rows) and rely solely on revenue. If both metrics are
   meaningful, use revenue as the primary driver (`revenueWeight: 1.0`,
   `ebitdaWeight: 0`) unless there is a clear reason to split — keep it
   simple by default.

5. **Outlier check.** If the chosen percentile multiple is more than 2×
   the median (i.e. heavily skewed), note it in the rationale and
   recommend staying with median regardless.

**Step iii — Present the recommendation**

Show the proposed selections as a summary table:

| Period | Metric | Multiple (%ile) | Value | Weighting | Adjusted Value |
|---|---|---|---|---|---|
| LTM | Revenue | 8.5x (median) | $7,000,000 | 1.00 | $59,500,000 |
| LTM | EBITDA | — (disabled) | $8,000,000 | 0.00 | — |
| NTM | Revenue | — | $9,000,000 | 0.00 | — |
| … | … | … | … | … | … |

Then explain the rationale in plain language, covering three things:

1. **Which percentile and why** — e.g. "I'm using the **median** — it's
   outlier-resistant for a {N}-company set" or "I'm using the **mean** —
   the set is small ({N} comps) so individual outliers have less distortion."

2. **Which comparable companies anchored the multiple** — call out 2–4
   comps by name that most influenced the chosen percentile (e.g. the
   companies closest to the median, or notable outliers that were excluded
   or pulled the mean). Reference their tickers and individual contribution
   where it's clear from the comp set. If the comps list from `read_tool({"name": "portfolio_valuations__get__comparables", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`
   is in context, use it; if not, describe the selection in general terms
   ("the mid-range comps in the set").

3. **Why EBITDA is enabled or disabled** — e.g. "EBITDA is disabled
   because the subject company's EBITDA margin exceeds 100%, which makes
   the multiple unreliable." or "Both metrics are in scope; revenue is the
   primary driver because the comp set has a tighter revenue multiple range."

Example:

> "I'm using **LTM Revenue at the median (8.5×)**. The median is anchored
> by **Appian (APPN)** and **Blackbaud (BLKB)** — both are mid-market
> software platforms with similar revenue scale to {company}. **ADP** and
> **Baidu** sit at the high end and pull the mean up to 12×, which is why
> I prefer the median here. EBITDA is disabled because {reason}. Implied
> value: **$59.5M**."

Then save the selections straight away — proceed to Step 3B.4 without
asking for approval first. Step 3B.5 shows what was saved; if
the user wants something changed after seeing it, apply the change with
another save and show the result again.

**Validation before saving**: confirm that `revenueWeight` values sum to
1.0 (± 0.001) and, when EBITDA is in scope, `ebitdaWeight` values also
sum to 1.0. If not, auto-correct by placing the remainder on the weighted
period before proceeding to save.

### Step 3B.2: Render current multiples

Render as a markdown table:

| # | Ticker | Revenue Multiple | Revenue %ile | EBITDA Multiple | EBITDA %ile |
|---|---|---|---|---|---|

Show the manual entry if set, otherwise the percentile-derived value.
Format multiples to 2 decimals (e.g. `8.45`). Show "—" only when the
response carries no value for that metric on that comp; every multiple it
did return is rendered as returned, never `NM` (`SKILL.md` §Table values).

### Step 3B.3: Ask what to change

#### Solving backwards from a target (not supported — say so)

Check first whether the user's preceding turn (or a free-text reply in
this step) asks for the multiples to be **solved backwards from a target
value** — "solve for {target}", "tune the EV to {target}", "what
multiples produce {target}", "find the multiples that get me to $X",
"open the GPC dashboard".

**If so:** say in one line that this flow doesn't solve backwards from a
target, then offer the two things it does do — pick percentiles and
weights here, or set the company value directly (`set-approaches.md`,
Custom Value). Then carry on with the widget below.

**Never approximate it.** Do not iterate percentile or weight
combinations yourself hunting for the target number, and do not save
several variants to compare. Each save is a real write against the
candidate, and a hand-rolled search both burns calls and leaves the
valuation wherever the last attempt landed.

#### Widget

Ask inline as plain text:

> "What would you like to change?"
> 1. **Set the percentile across all comps** — e.g. "use median for
>    revenue, mean for EBITDA". Follow up: which metric and which
>    percentile (mean / median / Q1 / Q3 / custom)?
> 2. **Override one comp's multiple manually** — follow up: which
>    comp number, which metric, what value?
> 3. **Adjust revenue/EBITDA weighting** — follow up with two numbers
>    that sum to 1.0 (e.g. 0.6 / 0.4).
> 4. **Done — save and continue** — proceed to Step 3B.4.

Allow multiple changes in one turn. Build up the draft state before
saving. If the user wants to cancel, they can say so in prose — no
widget option needed.

### Step 3B.4: Save multiples

Call `call_tool({"name": "portfolio_valuations__mutate__gpc_multiples_selection", "arguments": {...}})`.
`multiples` is a **required** argument — the API rejects it as null, so the
call is refused before it is sent if you leave it out.

The API expects **explicit numeric multiples** — always set the resolved
float in `revenueMultipleManualEntry` / `ebitdaMultipleManualEntry`. Never
send a percentile string (MEAN/MEDIAN/Q1/Q3) as a substitute for the
numeric value.

**Do not send the percentile selection fields at all.** The API derives
`revenueMultipleManualEntryPercentileSelection` and its EBITDA equivalent
from the manual entry, and they hold real values on an existing selection
(e.g. `79.5`) — sending `null` overwrites them.

```json
{
  "ownerId": <ownerId>,
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "multiplesMethod": "<multiplesMethod from pre-flight, e.g. 'MVIC'>",
  "multiples": [
    {
      "id": <multiple.id from get:gpc_multiples_selection — NOT financial.id>,
      "revenueMultipleManualEntry": <resolved float, e.g. 8.45>,
      "ebitdaMultipleManualEntry": <resolved float or null if disabled>,
      "revenueWeight": <float, e.g. 1.0>,
      "ebitdaWeight": <float, e.g. 0.0>
    }
    // one entry per period in compMultiplesData
  ]
}
```

### Multiple selection weights MUST sum to 100% — non-negotiable

The multiples API returns **multiple rows per comp** (one per period
slot — e.g. LTM, NTM, CY year 0/1/2). Each row carries its own
`revenueWeight` and `ebitdaWeight`. The Carta UI sums these weights
across all rows and validates that the **total is exactly 1.0
(100%)**. If the total isn't 100%, the UI shows "Weighting incomplete"
and the GPC value won't compute correctly.

**Common footgun:** writing `revenueWeight: 1.0` to every row
produces a total of N × 100% (e.g. 5 rows = 500%). This was an
actual bug we hit in testing — Meetly's GPC weighting summed to 500%
because all five period rows had weight 1.0.

**Rule:** before saving, validate that the sum of all
`revenueWeight` values across the entire `multiples` payload equals
exactly 1.0, and the same for `ebitdaWeight` (only when EBITDA is
in scope; otherwise all `ebitdaWeight` should be 0). If the user
hasn't specified per-row weighting, default to **placing the full
1.0 on the most recent applicable row** (typically LTM) and leave
the other rows at 0. Confirm the chosen row with the user by asking
inline as plain text before saving — one option per row returned by
the pre-flight, with date labels, e.g.:

> "Which period should drive the multiple? (Weighting must total 100%.)"
> 1. **LTM (04/01/2025–03/31/2026)** — set this row's weight to 1.0, others to 0.
> 2. **NTM (04/01/2026–03/31/2027)** — set this row's weight to 1.0, others to 0.
> 3. **CY 2026** — set this row's weight to 1.0, others to 0.
> 4. **Custom blend** — ask in prose for the per-row weights as decimals summing to 1.0; validate before saving.

When the user picks "Custom blend", parse the reply and verify the
sum equals 1.0 ± 0.001 tolerance. If it doesn't, surface a
plain-language correction:
> "Those weights add up to {sum × 100}% — they need to total 100%
> exactly. Try again?"

The same rule applies to EBITDA when it's in scope: total
`ebitdaWeight` across rows must sum to 1.0.

When applying "set percentile across all comps" (Step 3B.3 option 1),
look up the actual statistic value (e.g. median revenue multiple =
`8.45`) from `read_tool({"name": "portfolio_valuations__get__gpc_comp_statistics", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`, write it as a float into
`revenueMultipleManualEntry` or `ebitdaMultipleManualEntry`, and set
the corresponding percentileSelection to `null`.

When applying a manual override (Step 3B.3 option 2), write the
user-supplied number directly into the manualEntry field and set
the corresponding percentileSelection to `null`.

### Step 3B.5: Show what was saved

> "Multiples saved on **{candidate name}**:"

Then one line per changed selection, per SKILL.md's **Writes — save,
then show what was saved** rule — `{Period} {Metric} — {previous} →
{saved}` with multiples, weights, and any dollar amounts in full (e.g.
`$59,500,000`, not `$59.5M`).

Then per Step 2 mode:
- "Set per-comp multiples" only (option 2) → return to Step 2.
- "Run all three" (option 4) → proceed to Step 3C (statistics).

### Error handling for `call_tool({"name": "portfolio_valuations__mutate__gpc_multiples_selection", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "multiples": [...]}})`

- **Missing required argument `multiples`**: rejected before the request
  is sent. Build the list and retry — never send it as `null`.
- **404**: re-run the pre-flights (`read_tool({"name": "portfolio_valuations__get__gpc_multiples", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`
  and `get:gpc_multiples_selection`), retry once.
- **500**: usually a missing `id` on an entry, an `id` taken from
  `financial` instead of `multiple`, or a non-numeric weight.
  Re-validate the payload (every entry has a `multiple.id`; weights
  are floats; sum to 1.0 within ±0.01) and retry.
- **Persistent failure**: surface plain-language fallback with deep
  link.

## Step 3C: View quartile statistics

Triggered by Step 2 option 3 or 4.

### Step 3C.1: Fetch stats

Call:

```json
read_tool({
  "name": "portfolio_valuations__get__gpc_comp_statistics",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

**Do this silently.**

### Step 3C.2: Render

Render the statistics in a markdown table grouped by metric. The
typical shape is:

| Metric | Mean | Median | Q1 | Q3 | Min | Max |
|---|---|---|---|---|---|---|
| Revenue Multiple | 8.45 | 7.80 | 5.20 | 11.30 | 2.10 | 18.90 |
| EBITDA Multiple | 22.10 | 19.50 | 14.80 | 27.40 | 6.50 | 45.00 |

Format multiples to 2 decimals. Render only the metrics that the API
returns (don't fabricate rows) — and all of them, at the values returned.
A negative or outsized mean, median, or max is still the statistic: never
`NM`, never dropped (`SKILL.md` §Table values).

If the response is empty, surface:
> "No GPC statistics available yet on **{candidate name}**. Run the
> multiples step first to populate."

Then route to Step 3B.

### Step 3C.3: Offer next

Ask inline as plain text:

> "What's next?"
> 1. **Tweak multiples** — go to Step 3B.
> 2. **Tweak methodology** — go to Step 3A.
> 3. **Done — what's next overall?** — see Step 4 (handoff).

In "Run all three" walk-through mode, after rendering stats, default
to option 3 (don't loop back).

## Step 4: Success messaging + handoff

State the outcome in plain language:

> "GPC analysis complete on **{candidate name}**. {Brief summary, e.g.
> 'Multiples set to median across all comps; methodology captured.'}"

End each success message with the deep link on its own line.

### Handoff rules

The next move depends on End Goal state and mode:

1. **Walk-through mode**: silently re-derive the End Goal checklist
   (`read_tool({"name": "portfolio_valuations__get__valuation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`, `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`). The next unfinished item is
   most likely **item 5 (allocation)** — running the allocation
   populates holdings value. Suggest:
   > "GPC analysis is in. Allocation is the natural next step — want
   > to run it now, or pause here?"
   On yes, read **`references/dive-in/allocation.md`** inline and
   follow. On no, return control.

2. **Lateral-entry mode**: just confirm and stop. The user drives.

To check the mode, look at how this reference was loaded —
orchestrator walk-through (after a fresh create) vs. direct lateral
entry via the drill-down routing table.

## Deep link

See [`references/deep-link.md`](../deep-link.md) for URL construction.
Use **Pattern B** with `{tab}` = `value-company/gpc/conclusion`.
Required context: `ownerId`, `targetId`, `valuationId`. Render per
deep-link.md Step 5 (a markdown link).
