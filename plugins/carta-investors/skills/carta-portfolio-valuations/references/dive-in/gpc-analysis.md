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

Tables of comp multiples, statistics and overrides show numbers and
tickers; that's expected output.

## Prerequisites

`ownerId`, `project_id`, `candidate_id`, `targetId` (for opening its page in
the dashboard MCP App), and the
company and candidate names. GPC enabled, at least one GPC comp, and
financials on the candidate are checked in Step 1.

## Step 1: Verify prerequisites (silent)

**Do this silently** unless a prerequisite fails.

Call `read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`:
- If `gpc.isUsed` is not `true`, surface plain language and ask inline:
  > "GPC isn't enabled on **{candidate name}** yet. Want to enable it
  > and configure?"
  > 1. **Enable GPC now** — read `references/dive-in/set-approaches.md`
  >    with intent "enable GPC" and follow inline.
  > 2. **Cancel** — return to the orchestrator's routing.
  Wait for the reply, then route accordingly.

Call `read_tool({"name": "portfolio_valuations__get__comparables", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`:
- Filter to `isGpc: true` rows. If zero, surface and ask inline:
  > "No GPC comps are saved on **{candidate name}** yet. Want to add
  > some?"
  > 1. **Add comps now** — read `references/dive-in/comps.md` inline.
  > 2. **Cancel** — return to the orchestrator's routing.
  Wait for the reply, then route accordingly.

Call `read_tool({"name": "portfolio_valuations__get__financials", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` (this reads the revenue,
EBITDA, and other financial inputs **entered directly in the valuation
scenario** — not pulled from a data warehouse or external source):
- Check that at least one period has a non-zero revenue or EBITDA value.
- If `periods` is empty or all periods have zero revenue and EBITDA, surface and stop:
  > "**{candidate name}** doesn't have any financials entered yet. GPC
  > analysis needs revenue or EBITDA — want to enter them now?"
  On yes, read `references/dive-in/financials-review.md` inline and follow;
  otherwise stop.

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

### Error handling for `mutate:gpc`

- **404**: re-fetch `get:gpc` to verify the candidate is initialized,
  retry once.
- **500**: usually a malformed field. Retry once.
- **Persistent failure**: surface the plain-language fallback:
  > "Couldn't save GPC methodology right now — want me to try again?"

## Step 3B: Set per-comp multiples

Triggered by Step 2 option 2 or 4.

### Step 3B.1: Pre-flight `read_tool({"name": "portfolio_valuations__get__gpc_multiples", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` (REQUIRED)

**Do this silently.** This pre-flight is required for two reasons:
- It returns the quartile statistics the percentile choices in Step 3B.2
  resolve against.
- It returns the existing per-comp data — needed to construct the
  `multiples` payload.

**It doesn't carry the ids the write needs** — those are `multiple.id`
from `get:gpc_multiples_selection` (Step 3B.1b).

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

It carries no per-period selection figures (manual entries, weights);
those come from `get:gpc_multiples_selection`.

If the response is empty (`compMultiplesData` is absent or has no entries),
surface a fallback:
> "GPC multiples aren't ready yet on **{candidate name}** — this usually
> means the comp set is empty. Want me to check the comps?"

On yes, read `references/dive-in/comps.md` inline and follow.

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
each with a `multiple` and the `financial` it applies to, with
**different** ids: the write uses `multiple.id`, never `financial.id` or a
comparable id. **One call is enough** — revenue, EBITDA and labels are
included, so don't call `get:financials`.

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
| 9247 | 07/01/2025 - 06/30/2026 | Revenue | 11,500,000 | 3.00x | 1.00 | 52.1 (median) | 34,500,000 |
| 9247 | 07/01/2025 - 06/30/2026 | EBITDA | 9,500,000 | — | — | — | — |
| 9249 | CY 2026 | Revenue | 14,000,000 | — | — | — | — |
| … | … | … | … | … | … | … | … |

Show **every** period, both metrics — do not collapse or omit unweighted
rows. A period with financials but no weight is a candidate the user may want
to blend in, so it has to be visible.

Format values in the valuation's currency (`get:valuation` →
`currencyCode`, per SKILL.md § Currency default) with thousands
separators (no cents). Format
multiples as `{n}x` to 2 decimals. Format weighting as a decimal (e.g.
`1.00`, `0.50`). If revenue or EBITDA is `0` for a period, display `0`
and note it as not entered.

`—` is only for the documented unset cases (multiple or weighting of
`0`).

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

Validate the weights per **Multiple selection weights MUST sum to 100%**
below, then save in Step 3B.4.

#### If the user picks option 1 (AI-assisted):

**Step i — Fetch comp statistics (silently)**

Call `get:gpc_comp_statistics` and capture mean, median, Q1, Q3 for
both Revenue and EBITDA multiples.

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
   the comp set is small (≤ 5 comps), consider mean instead. Capture the
   statistic's numeric value (e.g. median revenue multiple `8.45`), not
   a percentile label.

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
| LTM | Revenue | 8.5x (median) | 7,000,000 | 1.00 | 59,500,000 |
| LTM | EBITDA | — (disabled) | 8,000,000 | 0.00 | — |
| NTM | Revenue | — | 9,000,000 | 0.00 | — |
| … | … | … | … | … | … |

Then explain the rationale in plain language, covering three things:

1. **Which percentile and why** — e.g. "I'm using the **median** — it's
   outlier-resistant for a {N}-company set" or "I'm using the **mean** —
   the set is small ({N} comps) so individual outliers have less distortion."

2. **Which comparable companies anchored the multiple** — call out 2–4
   comps by name that most influenced the chosen percentile (e.g. the
   companies closest to the median, or notable outliers that were excluded
   or pulled the mean). If the `get:comparables` list isn't in context,
   describe the selection in general terms ("the mid-range comps").

3. **Why EBITDA is enabled or disabled** — e.g. "EBITDA is disabled
   because the subject company's EBITDA margin exceeds 100%, which makes
   the multiple unreliable." or "Both metrics are in scope; revenue is the
   primary driver because the comp set has a tighter revenue multiple range."

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
Format multiples to 2 decimals (e.g. `8.45`).

### Step 3B.3: Ask what to change

#### Solving backwards from a target (not supported — say so)

Check first whether the user's preceding turn (or a free-text reply in
this step) asks for the multiples to be **solved backwards from a target
value** — "solve for {target}", "tune the EV to {target}", "what
multiples produce {target}", "find the multiples that get me to $X",
"open the GPC dashboard".

**If so:** say in one line that this flow doesn't solve backwards, offer
picking percentiles and weights here or setting the company value
directly (`set-approaches.md`, Custom Value), and carry on. Never iterate
combinations yourself hunting for the number — each try is a real save.

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

**Common mistake:** `revenueWeight: 1.0` on every row totals N × 100%.

**Rule:** before saving, validate that the sum of all
`revenueWeight` values across the entire `multiples` payload equals
1.0 (± 0.001), and the same for `ebitdaWeight` (only when EBITDA is
in scope; otherwise all `ebitdaWeight` should be 0).

**Which period drives the multiple.** On the AI-assisted path (Step
3B.1c option 1) the recommendation already names its period, so save it
without asking. On the other paths, when the user hasn't said which
period to weight, ask before saving — one option per row returned by
the pre-flight, with date labels, and the most recent applicable row
(typically LTM) first, e.g.:

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
look up the statistic's value from `get:gpc_comp_statistics` and write it as a float into
`revenueMultipleManualEntry` or `ebitdaMultipleManualEntry`.

When applying a manual override (Step 3B.3 option 2), write the
user-supplied number directly into the manualEntry field.

Either way, leave the percentile selection fields out of the payload
(Step 3B.4).

### Step 3B.5: Show what was saved

> "Multiples saved on **{candidate name}**:"

Then one line per changed selection (SKILL.md § Writes) —
`{Period} {Metric} — {previous} → {saved}`, amounts in full.

Then per Step 2 mode:
- "Set per-comp multiples" only (option 2) → return to Step 2.
- "Run all three" (option 4) → proceed to Step 3C (statistics).

### Error handling for `mutate:gpc_multiples_selection`

- **Missing required argument `multiples`**: rejected before the request
  is sent. Build the list and retry — never send it as `null`.
- **404**: re-run the pre-flights (`get:gpc_multiples` and
  `get:gpc_multiples_selection`), retry once.
- **500**: usually a missing `id` on an entry, an `id` taken from
  `financial` instead of `multiple`, or a non-numeric weight.
  Re-validate the payload (every entry has a `multiple.id`; weights
  are floats; sum to 1.0 within ±0.001) and retry.
- **Persistent failure**: surface plain-language fallback with deep
  link.

## Step 3C: View quartile statistics

Triggered by Step 2 option 3 or 4.

### Step 3C.1: Fetch stats

Silently call `get:gpc_comp_statistics`.

### Step 3C.2: Render

Render the statistics in a markdown table grouped by metric. The
typical shape is:

| Metric | Mean | Median | Q1 | Q3 | Min | Max |
|---|---|---|---|---|---|---|
| Revenue Multiple | 8.45 | 7.80 | 5.20 | 11.30 | 2.10 | 18.90 |
| EBITDA Multiple | 22.10 | 19.50 | 14.80 | 27.40 | 6.50 | 45.00 |

Format multiples to 2 decimals. Render only the metrics the API returns
— all of them, at the values returned (SKILL.md § Table values).

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

In a "Run all three" pass, go straight to Step 4 after the stats.

## Step 4: Success messaging + handoff

State the outcome in plain language:

> "GPC analysis complete on **{candidate name}**. {Brief summary, e.g.
> 'Multiples set to median across all comps; methodology captured.'}"

Then return control — the user drives.
