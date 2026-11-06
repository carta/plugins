# Portfolio Valuation — Allocation (Guided)

Distribute the candidate's enterprise value across share classes to
produce a per-class value and the firm's holdings value. The user
picks the methodology, time-to-exit, volatility source, DLOM method,
and DLOM scope at each step.

A candidate uses exactly one allocation methodology at a time. Five
exist, split across two engines:

| Methodology | Engine | Used when |
|---|---|---|
| **Common Stock Equivalent (CSE)** | standard | Liquidation preferences are negligible — typically very early stage. Treats all classes as common. |
| **Waterfall** | standard | A single-scenario allocation down the liquidation waterfall (preferred prefs first, then participation, then common). Used when a single exit value is the right model. |
| **Option Pricing Model (OPM)** | standard | Industry standard for venture-backed companies with multiple preferred classes. Each class is treated as a call option on enterprise value. Captures probability-weighted outcomes via Black-Scholes. |
| **Niagara Waterfall** | Niagara | One allocation down the company's live liquidation waterfall, run by the Niagara engine. |
| **Niagara OPM** | Niagara | Prices each interest as an option, by enriching an underlying Niagara waterfall run. |

The standard methodologies (Steps 4A/4B/4C below) save their inputs and
then call
`call_tool({"name": "portfolio_valuations__compute__allocation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`
to run the math. The Niagara methodologies use a different,
asynchronous engine with its own run/poll commands — see
[Niagara allocation path](#niagara-allocation-path) at the bottom of
this file. Both paths end the same way: a holdings value on the
candidate.

## Gate 0: Resolve which methodologies this candidate supports

**Do this silently**, before Step 1 and before any methodology prompt.

**Run Gate 0 only when the user has asked to allocate** ("run
allocation", "allocate to share classes", "compute holdings value", or a
named methodology). Never call `get:configuration` for a recap, a
question, or ahead of time.

**`config.allocationMethodologies` is the only source for what this
candidate can run** — never infer it from the target kind (`isLlc`,
`corporationId` vs `llcIssuerId`, `targetKind`). A named request ("run
CSE") still runs Gate 0 first; Step 3 then decides whether the name
skips the picker.

Call
`read_tool({"name": "portfolio_valuations__get__configuration", "arguments": {"valuation_id": <valuation_id>}})`:

```json
{ "valuation_id": <valuation_id> }
```

Capture:
- `config.allocationMethodologies` — the supported set, drawn from
  `COMMON_STOCK_EQUIVALENT`, `WATERFALL`, `OPTION_PRICING_MODEL`,
  `NIAGARA_WATERFALL`, `NIAGARA_OPM`.
- `isNiagaraModelEnabled` — whether the Niagara model is on at all.
- `config.enablementFailureReasons` — `{code, message}` entries.
  Non-empty is the reason a Niagara run won't dispatch. **Empty does
  NOT mean a Niagara run will go through** — it means no blocker was
  *recorded*. A valuation with the Niagara model switched off reports
  `isNiagaraModelEnabled: false`, omits both Niagara entries from
  `allocationMethodologies`, and still returns
  `enablementFailureReasons: []`. Treat this list as an explanation of
  unavailability, never as evidence of availability.
- `config.waterfallAccess` — per corporation: `modelStatus` ∈
  `{NOT_FOUND, NOT_ASSIGNED, ASSIGNED, UNKNOWN}`, plus
  `capTableAccessLevel`, `hasOpenCapTableRequest`,
  `canRequestCapTableAccess`.

Now build the **available set** the rest of this file works from:

1. Start from `config.allocationMethodologies`. **This list is the
   authority on what may be offered** — if a methodology isn't in it,
   it isn't available, whatever the other fields say.
2. **Drop both Niagara entries if `enablementFailureReasons` is
   non-empty** (or `isNiagaraModelEnabled` is false). Listed isn't the
   same as runnable; checking here saves the user answering questions
   for a run that will be refused.

**If the available set is empty**, stop — there is nothing to offer.
Explain it in business terms, and pick the wording from what the
response actually carries — do not assert a cause the data doesn't
support:

- **`enablementFailureReasons` non-empty** → use the `message` text as
  the source of truth, rather than paraphrasing from `code`:

  > "Allocation can't run on **{candidate name}** yet — {message}."

- **`enablementFailureReasons` empty** → there is no `message` to
  quote, so don't invent one and don't guess at a cause. Say only what
  is true:

  > "Allocation isn't available on **{candidate name}**."

Never add a guessed cause ("it's probably still building") — there is
no build-delay or sync-timing behind this gate.

If `waterfallAccess.modelStatus` is `NOT_FOUND` or `NOT_ASSIGNED`, this
company simply doesn't have a waterfall model configured — that's a
one-time setup Carta has to do on its side, not something pending or on
a timeline:

> "**{company}** doesn't have a waterfall model set up yet, so this
> allocation can't run. Reach out to Carta to get one configured."

If `waterfallAccess.capTableAccessLevel` is short of full access
(`restricted` is the value seen in practice), that's a separate,
genuine access problem. Say so, and mention `canRequestCapTableAccess`
if it's true:

> "You don't have access to **{company}**'s cap table, so the
> allocation can't run. Contact the company to grant access, then we
> can compute the holdings value."

**If the available set is non-empty** → continue to Step 1. Don't
announce which engine a methodology belongs to or explain the split —
the user asked for an allocation, so just offer what's available and
run the one they pick.

SKILL.md § UX Rules applies to both engines. Free-text numbers (time to
exit, volatility, custom DLOM) are asked in prose and parsed. Tables of
per-class values, volatility comps and DLOM exhibits are expected output.

## Prerequisites

- `ownerId`, `project_id`, `candidate_id` — standard-engine calls, and
  reading/writing the saved allocation on either path.
- `valuation_id` — the integer `valuationId` on the `list:projects`
  candidate. Every Niagara command keys off this alone.
- `targetId` — for opening its page in the dashboard MCP App.
- The company and candidate names — for messaging.

Both engines satisfy End Goal item 5 once a fresh `get:valuation` shows
a positive `valueOfHoldings.amount` — never read it off the poll payload.

## Step 1: Verify prerequisites (silent)

**Do this silently** unless a prerequisite fails.

Call `read_tool({"name": "portfolio_valuations__get__valuation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` and check `companyValue`:
- **Zero, null, or missing** → surface plain language and ask inline
  as plain text:

  > **I can't run allocation on {candidate name} yet — the company value is still zero. Set an approach and capture a value first?**
  > 1. **Set an approach now** — read `references/dive-in/set-approaches.md` inline.
  > 2. **Cancel** — return to the orchestrator's routing.

  Wait for the reply, then act accordingly.

If non-zero, run the **data-readiness check** below, then proceed to
Step 2.

### Data-readiness check (silent unless thin)

**Skip this check entirely when Gate 0's available set contains only
Niagara methodologies.** It reads the candidate-scoped cap table, which
is a standard-engine concept — on a target that only supports Niagara
it returns 400, and the Niagara run reads the company's live cap table
for itself. Run the check when any of CSE / Waterfall / OPM is
available.

Allocation distributes the company value across share classes using
the cap table; if the cap table or financials are missing/stale, the
result is wrong silently. Run two silent checks:

1. `read_tool({"name": "portfolio_valuations__get__cap_table_summary", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` — does the
   summary contain share classes (any non-zero outstanding)? Keep the
   `id` and `securityType` of every `COMMON_SHARE_CLASS` /
   `PREFERRED_SHARE_CLASS` entry from `captableData` in context.
2. `read_tool({"name": "portfolio_valuations__get__financials", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` — do any periods have
   revenue or EBITDA populated?

**If both look healthy** (cap table has share classes AND at least
one financial period has revenue/EBITDA), continue silently to
Step 2. Do not surface the check.

**If either looks thin** (no share classes, or zero financial
periods, or all periods are blank), surface a soft prompt. Ask
inline as plain text:

> **Before running allocation, the {cap table / financials / cap table and financials} look thin on {candidate name}. Review first?**
> 1. **Skip and run anyway** — proceed to Step 2.
> 2. **Review cap table** — read `references/dive-in/cap-table-review.md` inline, then return here and re-run Step 1.
> 3. **Review financials** — read `references/dive-in/financials-review.md` inline, then return here and re-run Step 1.

Wait for the reply, then act accordingly. Tailor the wording to which
one is thin (don't say "cap table looks thin" if the cap table is
fine and only financials are missing). This is a soft check — the
user can always skip.

## Step 2: Pre-flight `read_tool({"name": "portfolio_valuations__get__allocation", "arguments": {...}})` (REQUIRED)

**Do this silently.** This pre-flight returns the current methodology
and DLOM configuration on the candidate.

Call `read_tool({"name": "portfolio_valuations__get__allocation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` and capture:
- `allocationMethodology` — current methodology (or null if not set).
- `debtOption`, `treatCappedNotesAsEquity` — current debt-treatment
  settings (required for CSE — see Step 4A).
- `scenario.dlomMethod`, `scenario.dlomVolatilityManualEntry`,
  `scenario.dlomTimeToExitManualEntry` — current DLOM settings (nested
  under `scenario`, not top-level).
- `scenario.usesCompanyLevelDlom`, `scenario.companyLevelDlomManualEntry` —
  current company-level DLOM.
- For OPM: `weightedTimeToExit`, `equityVolatilityManualEntry`,
  `volatilitySelectionMethod`.


If this call returns 404, retry once. If it 404s again, the candidate
isn't initialized — surface a fallback:
> "Couldn't load allocation inputs for **{candidate name}**."

## Step 3: Pick methodology

**Offer only what's in Gate 0's available set** — never a fixed list.
Each methodology routes to its own branch:

| Available-set entry | Branch |
|---|---|
| `COMMON_STOCK_EQUIVALENT` | Step 4A |
| `WATERFALL` | Step 4B |
| `OPTION_PRICING_MODEL` | Step 4C |
| `NIAGARA_WATERFALL` | Step N1 |
| `NIAGARA_OPM` | Step N2 |

**If the user named a methodology** in their request ("run OPM", "run
the waterfall", "run CSE"):

- **In the available set** → skip the picker entirely and proceed
  directly to that branch. Don't confirm a choice they already made.
- **Not in the available set** → say so in one line, then **render the
  picker below** so they can pick from what's actually there. Don't
  just name the alternatives in prose and wait — give them the numbered
  list:

  > "**{company}** can't run a {named methodology} allocation. Here's
  > what's available:"

  …followed immediately by the picker's numbered options.

**If the user asked for an allocation without naming one** ("run
allocation", "allocate to share classes", "compute the holdings
value") → render the picker.

If exactly **one** methodology is available, don't render a picker for
a single option. State which one is running in one clause and proceed:

> "Running the {methodology} allocation on **{candidate name}**."

**Unless the user named a different one.** Never silently substitute a
methodology for the one they asked for — that runs a model they didn't
choose and stamps it onto the valuation. Name the gap and get a yes
first:

> "**{company}** can't run a {named methodology} allocation — the only
> one available is {available methodology}. Run that instead?"

If `allocationMethodology` is **already set** from the pre-flight *and
is still in the available set*, default to it and confirm. Ask inline
as plain text:

> **{candidate name} is currently set to {methodology}. Keep it or change?**
> 1. **Keep {methodology}** — proceed to the matching branch.
> 2. **Change methodology** — re-prompt with the picker below.
> 3. **Cancel** — return to the orchestrator.

Wait for the reply, then act accordingly. If the saved methodology is
*not* in the available set any more, skip this confirmation and render
the picker directly — don't offer to keep something that can't run.

Otherwise render the picker, under this header:

> **Which allocation methodology should this candidate use?**

Then one numbered line per available-set entry, in the order below,
using that entry's wording verbatim. **Number them 1..N over the lines
you actually render** — if the set has three entries, the options are
1, 2, 3, whatever those entries are. Never render a line for an entry
that isn't in the available set.

| Entry | Line to render |
|---|---|
| `COMMON_STOCK_EQUIVALENT` | **CSE (Common Stock Equivalent)** — treat all share classes as common. Simplest; ignores liquidation preferences. Best for very early stage. |
| `WATERFALL` | **Waterfall** — distribute company value down the liquidation waterfall. Good for a single exit-scenario allocation. |
| `OPTION_PRICING_MODEL` | **OPM (Option Pricing Model)** — treat each share class as a call option on enterprise value. Industry standard for venture-backed companies with multiple preferred classes. |
| `NIAGARA_WATERFALL` | **Waterfall** — distribute the company value down the company's liquidation waterfall. A single exit-scenario allocation. |
| `NIAGARA_OPM` | **OPM (Option Pricing Model)** — price each interest as a call option on the company value, capturing probability-weighted outcomes. |

**Don't put "Niagara" in the label the user sees.** It's the name of an
engine, not of a methodology, and the User-Facing Output Rules keep
internals out of chat.

The two engines never overlap in practice — a candidate's available set
carries at most one Waterfall and one OPM — so the labels don't
collide. If a set ever does contain both engines' entries, don't render
two identically-labelled options: ask one short clarifying question
instead, describing what differs for the user rather than naming the
engine.

Wait for the reply, then proceed to the matching branch. Do not make a
domain-judgment recommendation between the options (e.g. "this looks
like an OPM situation"). The user picks; we configure.

## Widget availability check (silent, cached — runs once before 4A/4C/N1/N2)

Check `show_widget` once per session, and cache as `widget_available`:

- `ToolSearch(query: "select:mcp__visualize__show_widget")` — present
  if the schema returns, or it's already in the loaded-tools list.

**`true`** → follow the combined-form instructions in Step 4A.1 / 4C.1
(standard) or N1.1 / N2.1 (Niagara) below. **`false`** → use each
step's "Fallback (no widget)" subsection instead — still one combined
message covering all fields, not sequential prompts. Never call
`show_widget` in this case.

## Step 4A: CSE branch

Triggered by methodology = `COMMON_STOCK_EQUIVALENT`.

CSE requires two inputs beyond DLOM (which defaults silently — see
Step 5): debt treatment and capped-note treatment.

**Note:** CSE's compute (`run_cse()`) hard-overrides both to
`EXCLUDE_ALL`/`false` regardless of what's saved. Still ask and save
them — matches the web UI, and the value persists on the record even
though CSE's math ignores it.

### Step 4A.1: Debt treatment and capped notes (one form)

One elicitation form, not two prompts (UX Rules: multiple fields →
`show_widget`). Pre-fill each field from its pre-flight value.

Call `mcp__visualize__read_me` (module `elicitation`) if not loaded,
then `show_widget` with:

- **Debt treatment** — single-select, default = current `debtOption`
  (or "Exclude all debt" if unset):
  - Include all debt — subtract all outstanding debt before allocating to equity
  - Exclude all debt — ignore debt entirely; allocate the full company value
  - Exclude non-convertible debt only — convertible debt stays in the equity waterfall
- **Capped notes treatment** — yes/no, default = current `treatCappedNotesAsEquity`:
  - Yes — treat capped notes as if converted, participating in the equity waterfall
  - No — treat them as debt instead

Map the reply: **Include all** → `debtOption: INCLUDE_ALL`, **Exclude
all** → `EXCLUDE_ALL`, **Exclude non-convertible** →
`EXCLUDE_NONCONVERTIBLE`; capped notes → `treatCappedNotesAsEquity`
(`true`/`false`).

#### Fallback (no widget)

If `widget_available` is `false`, ask both fields in one message:

> **Confirm or update these before running CSE allocation on {candidate name}:**
> 1. **Debt treatment** — currently: {current, or "Exclude all debt"}. Options: Include all debt / Exclude all debt / Exclude non-convertible debt only.
> 2. **Capped notes treatment** — currently: {Yes / No}. Options: Yes / No.
>
> Reply with any changes, or say "use defaults" to keep everything as-is.

Parse against both fields — anything unaddressed keeps its current
value; "use defaults"/"keep current" leaves both unchanged. Same
mapping as Step 4A.1 above.

Proceed to **Step 5: DLOM configuration** — DLOM itself defaults
silently to 0%, so in the common case this adds no further prompts.

## Step 4B: Waterfall branch

Triggered by methodology = `WATERFALL`.

Waterfall uses the cap table's existing liquidation preferences —
nothing additional to configure beyond DLOM. Proceed to **Step 5: DLOM
configuration**.

## Step 4C: OPM branch

Triggered by methodology = `OPTION_PRICING_MODEL`. OPM has the most
inputs.

### Step 4C.1: Debt treatment, capped notes, and time to exit (one form)

One elicitation form for all three, not sequential prompts. Pre-fill
each field from its pre-flight value.

Call `mcp__visualize__read_me` (module `elicitation`) if not loaded,
then `show_widget` with:

- **Debt treatment** — same three options as Step 4A.1, default =
  current `debtOption` (or "Exclude all debt" if unset)
- **Capped notes treatment** — yes/no, default = current `treatCappedNotesAsEquity`
- **Weighted time to exit (years)** — numeric, decimal allowed (e.g.
  4.5), default = current `weightedTimeToExit` if set, else blank

Map the reply: debt treatment and capped notes use the same mapping as
Step 4A.1; time to exit → validate as a positive float (re-prompt just
that field in prose if invalid — don't re-render the whole form).

#### Fallback (no widget)

If `widget_available` is `false`, ask all three fields in one message:

> **Confirm or update these before running OPM allocation on {candidate name}:**
> 1. **Debt treatment** — currently: {current, or "Exclude all debt"}. Options: Include all debt / Exclude all debt / Exclude non-convertible debt only.
> 2. **Capped notes treatment** — currently: {Yes / No}. Options: Yes / No.
> 3. **Weighted time to exit** — currently: {N} years (or unset). Enter a new value, or keep current.
>
> Reply with any changes, or say "use defaults" to keep everything as-is.

Parse against all three — anything unaddressed keeps its current
value; "use defaults" leaves everything unchanged. Same mapping as
Step 4C.1 above. If time to exit is unset and not supplied, ask for it
in prose before proceeding.

### Step 4C.2: Volatility selection method

`volatilitySelectionMethod` is required: `LINEAR_REGRESSION` or
`MANUAL`. Ask the choice first — the comps check below only runs if
linear regression is picked.

> **How should volatility be determined?**
> 1. **Linear regression** — derive volatility from comparable companies' data.
> 2. **Manual** — enter a specific volatility percentage.

**If Manual** — sets `volatilitySelectionMethod: MANUAL`. Which field
to ask for depends on the debt treatment from Step 4C.1:
- `debtOption = EXCLUDE_ALL` → **Equity Volatility** → `equityVolatilityManualEntry`
- `debtOption = INCLUDE_ALL` or `EXCLUDE_NONCONVERTIBLE` → **Asset
  Volatility** → `assetVolatilityManualEntry` (debt participates, so
  the model needs whole-enterprise volatility, not just equity)

Ask as a percentage (e.g. 65), convert to decimal (0.65) before saving.

**If Linear regression** — call
`read_tool({"name": "portfolio_valuations__get__volatility_comps", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`
first to confirm real numbers exist (needs both comps AND LTM
financials on the candidate; either missing → empty result):

- **Non-empty** → set `LINEAR_REGRESSION`, don't set
  `equityVolatilityManualEntry`. Render the full quartile table labelled
  **OPM {equity/asset} volatility** (SKILL.md § Volatility disclosure):
  > "Volatility derived from comps on **{candidate name}** ({equity/asset} volatility, OPM): see table below.
  >
  > {full quartile table}
  >
  > Regression result: {result}%{ — memo text, if the regression carries one}"
- **Empty** → tell the user plainly and offer alternatives:
  > "Linear regression needs comparable companies and LTM financials on **{candidate name}**, and one or both aren't set up. What would you like to do?"
  > 1. **Add comparable companies** — read `references/dive-in/comps.md` inline, then return here.
  > 2. **Add LTM financials** — read `references/dive-in/financials-review.md` inline, then return here.
  > 3. **Use manual volatility instead** — set `volatilitySelectionMethod: MANUAL` and ask for the percentage.

### Step 4C.3: Continue to DLOM

OPM-specific inputs are now captured. Proceed to **Step 5: DLOM
configuration** — DLOM defaults silently to 0%, so in the common case
this adds no further prompts.

## Step 5: DLOM configuration

DLOM (discount for lack of marketability) is **not required**. Default
silently to **0%, company-level, no method** for every methodology —
no DLOM prompts unless asked. Send explicit zero values
in Step 6 (`dlomMethod: "CUSTOM_DLOM"`, `usesCompanyLevelDlom: true`,
`companyLevelDlomManualEntry: 0`) rather than omitting them, to avoid
carrying forward a stale value from a prior methodology.

**Only enter Steps 5.1–5.4 if the user explicitly asks** to set,
change, or configure DLOM ("set DLOM to 20%", "use Chaffe", "apply
DLOM per share class", "what's the DLOM on this?"). Default to the
candidate's current DLOM state; change only what they ask.

### Step 5.1: DLOM method

If `dlomMethod` is already set, confirm. Ask inline as plain text:

> **DLOM method is currently {Chaffe / Finnerty / Custom}. Keep or change?**
> 1. **Keep {current method}**
> 2. **Switch to Chaffe** — put option on volatility and time to exit (Black-Scholes).
> 3. **Switch to Finnerty** — alternative put-option model.
> 4. **Switch to Custom** — flat percentage (no model).

Wait for the reply, then act accordingly.

If not set, ask inline as plain text:

> **Which DLOM method?**
> 1. **Chaffe** — most common; put option on volatility and time to exit (Black-Scholes).
> 2. **Finnerty** — alternative put-option model.
> 3. **Custom** — flat percentage (no model).

Wait for the reply, then act accordingly.

### Step 5.2: DLOM inputs (varies by method)

**For Chaffe / Finnerty**:

DLOM volatility is its **own dataset**. **Never default to the OPM's
volatility entries or comps regression here** (SKILL.md § Volatility
disclosure).

If `dlomTimeToExitManualEntry` and `dlomVolatilityManualEntry` are not
set (for CSE/Waterfall, or if not already in context), fetch
`read_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`
silently and read the DLOM-specific fields:
- `dlomVolatilityQuartiles` — the full comp-derived distribution
  (minimum through maximum, mean, median) computed for DLOM.
- `dlomVolatilityRegression` — `{result, memo, rSquared}`, the
  regression-derived pick (a low `rSquared` falls back to a percentile
  — `memo` says which one).
- `dlomChaffe` / `dlomFinnerty` — Carta's own precomputed DLOM
  percentage for each method at the candidate's current inputs. When
  the user asks "what would the DLOM be", quote these directly rather
  than re-deriving a figure from the quartiles yourself — they are the
  authoritative, already-computed answer.

Default `dlomVolatilityManualEntry` to `dlomVolatilityRegression.result`
if unset. Whenever one of these numbers is shown, label it **DLOM
volatility** and render the full `dlomVolatilityQuartiles` table with it.

- Offer to override either; otherwise reuse.

**For Custom**:
- Ask for a flat percentage (e.g. 25 → 0.25).

### Step 5.3: Company-level vs per-class DLOM

By default, use company-level DLOM (one value applied to all classes).
Ask inline as plain text:

> **Apply DLOM at the company level (one value across all classes), or per share class?**
> 1. **Company level** — set `usesCompanyLevelDlom: true`. One value applies to every class. Recommended unless there's a specific reason to differentiate.
> 2. **Per share class** — see Step 5.4.
> 3. **Keep current setting** — only include this option if the pre-flight returned a setting; on selection, leave the field unchanged.

Wait for the reply, then act accordingly.

### Step 5.4: Per-class DLOM (set it in Carta)

Per-class DLOM can't be saved from chat: the allocation save drops
per-class values before they reach the valuation. When the user picks it
(or asks for it), say so in one line: per-class DLOM is set on the
valuation's page in Carta's valuations dashboard. Offer to take them there
(SKILL.md **Page navigation → After an action, offer instead of moving**),
then continue with the company-level setting unchanged.

## Step 6: Save (`call_tool({"name": "portfolio_valuations__mutate__allocation", "arguments": {...}})`)

**Field names are camelCase — non-negotiable.** A key the command
doesn't declare (e.g. snake_case) is **silently dropped**, so the save
looks fine and changes nothing. When in doubt, match `get:allocation`'s
response field names.

Never send `holdings` (see Step 5.4).

Build the payload from the captured inputs and call:

```json
{
  "ownerId": <ownerId>,
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "allocationMethodology": "<COMMON_STOCK_EQUIVALENT | WATERFALL | OPTION_PRICING_MODEL>",
  "debtOption": "<INCLUDE_ALL | EXCLUDE_ALL | EXCLUDE_NONCONVERTIBLE>", // CSE, OPM
  "treatCappedNotesAsEquity": <bool>,                     // CSE, OPM
  "weightedTimeToExit": <float>,                          // OPM only
  "equityVolatilityManualEntry": <float or null>,         // OPM only, MANUAL + debtOption EXCLUDE_ALL
  "assetVolatilityManualEntry": <float or null>,          // OPM only, MANUAL + debtOption INCLUDE_ALL/EXCLUDE_NONCONVERTIBLE
  "volatilitySelectionMethod": "<LINEAR_REGRESSION | MANUAL>", // OPM only
  "dlomMethod": "<CHAFFE | FINNERTY | CUSTOM_DLOM>",
  "dlomTimeToExitManualEntry": <float or null>,
  "dlomVolatilityManualEntry": <float or null>,
  "usesCompanyLevelDlom": <bool>,
  "companyLevelDlomManualEntry": <float or null>,
  "showChaffeExhibit": <bool>,                            // optional
  "showFinnertyExhibit": <bool>                           // optional
}
```

Only include fields the user actually set or changed — omit
everything else.

### Error handling

- **404 on mutate**: re-run pre-flight (`read_tool({"name": "portfolio_valuations__get__allocation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`), retry once.
- **500 on mutate**: usually a malformed numeric or wrong methodology
  string. Re-validate the payload (numerics are floats; methodology
  is one of the three exact strings; volatility values are decimals
  not percentages); retry.
- **Persistent failure**: surface plain-language fallback with deep
  link.

## Step 7: Run (`call_tool({"name": "portfolio_valuations__compute__allocation", "arguments": {...}})`) — auto-chain after save

**Do this immediately and silently** after Step 6 succeeds. The user
should not need to ask "now run it."

Call `call_tool({"name": "portfolio_valuations__compute__allocation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`. Capture the response. It returns per-share-class values reflecting the
allocation result.

### Error handling

- **Compute fails** (500, timeout, etc.): retry once. If it still
  fails, the inputs may be inconsistent (e.g. OPM with zero
  volatility, time-to-exit < 0). Surface:
  > "Saved the allocation inputs, but the calculation didn't run.
  > You can compute it on the valuation's page in Carta's valuations
  > dashboard."

  Offer to take them there, and open it only on a yes (SKILL.md **Page navigation → After an action, offer instead of moving**).

  Do not roll back the `call_tool({"name": "portfolio_valuations__mutate__allocation", "arguments": {...}})` save — the user's inputs
  are still valuable. The compute can be re-run later.

## Step 8: Render results

Refresh the top-level valuation to get the new holdings value:

Call `read_tool({"name": "portfolio_valuations__get__valuation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`.

Render two things:

### Per-share-class allocation table

| Share Class | Class Value | Per-Share Value | DLOM |
|---|---|---|---|

Pull from the `call_tool({"name": "portfolio_valuations__compute__allocation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` response. Format currency with
thousands separators. Format DLOM as a percentage with one decimal.

### Top-line summary

> "Allocation complete on **{candidate name}** ({methodology}).
>
> Company value: {companyValue, full value}
> Holdings value: {valueOfHoldings, full value}"

Include the methodology label so the user remembers which model was
used. Include both values so the user can sanity-check.

Then follow SKILL.md **Page navigation → After an allocation**: refresh the
dashboard MCP App and end the turn by offering to open the updated valuation
page.

## Step 9: Handoff

Confirm the result and return control — the user drives. If the run
completed the allocation, show the SKILL.md Step 2.5d review download
notice (once per valuation).

## Niagara allocation path

Reached from Step 3 when the user picks `NIAGARA_WATERFALL` or
`NIAGARA_OPM`. Gate 0, Step 1 (company value) and Step 2 (pre-flight)
still apply and should already have run. Steps 4A–8 do **not** apply —
don't run them, and don't fall back into them if a step here fails.

Two structural differences from the standard engine drive everything
below:

1. **Every Niagara command keys off `valuation_id` alone.** There is no
   `ownerId` / `project_id` / `candidate_id` triple on these calls; the
   backend resolves the candidate's standard-scenario allocation itself.
2. **The engine is asynchronous.** The run command dispatches and
   returns immediately (the endpoint answers `201` with an empty body,
   so the response is just an echo of what was requested). Results
   arrive later, through a separate poll command.

Both run commands are **writes**: dispatching one sets the candidate's
standard-scenario methodology to the Niagara model, stamps the current
company value onto it, and discards any previous result. This is not a
read-only calculation — don't dispatch one speculatively.

DLOM does not apply on this path. Skip Step 5 entirely; there is no
DLOM input on either Niagara run.

### Step N1: Niagara Waterfall inputs

Two things to collect: how results should be grouped, and whether to
apply a vesting hypothesis. One combined form, not sequential prompts.

**Grouping method** — `groupingMethod`, sent on the Step N4 poll only
(the run commands don't accept it). Options:
- `BY_INTEREST_HOLDER` — one group per holder. **The val-tool default;
  use it unless the user asks otherwise.**
- `BY_INTEREST_TYPE` — one group per interest type.

It's the same allocation either way — only the grouping of the output
differs. Say it that way if the user asks; don't present it as a
modelling choice.

**Time-based vesting** — `timeBasedVestingHypothesis`, one of:
- `''` (empty string) — vest quantities as of the valuation date. This
  is a **real option and the default**, not a missing value. Omitting
  the field means `''`.
- `TIME_VESTING_ACCELERATION` — accelerate time-based vesting to
  `targetDate`.

`targetDate` is an ISO 8601 date (`YYYY-MM-DD`), **required** when the
hypothesis is `TIME_VESTING_ACCELERATION` and ignored otherwise. The web
UI passes the valuation date — default to that, and only ask for a
different one if the user wants it.

#### Step N1.1: One combined form

Call `mcp__visualize__read_me` (module `elicitation`) if not loaded,
then `show_widget` with:

- **Group results by** — single-select, default "Holder":
  - Holder — one row per interest holder
  - Interest type — one row per interest type
- **Time-based vesting** — single-select, default "As of the valuation
  date":
  - As of the valuation date — vest only what has vested
  - Accelerate vesting — treat time-based vesting as accelerated to a
    target date
- **Acceleration target date** — date, shown only when "Accelerate
  vesting" is picked, default = the candidate's valuation date

Map the reply: Holder → `BY_INTEREST_HOLDER`, Interest type →
`BY_INTEREST_TYPE`; As of the valuation date → `timeBasedVestingHypothesis: ""`,
Accelerate vesting → `TIME_VESTING_ACCELERATION` plus `targetDate`.

##### Fallback (no widget)

If `widget_available` is `false`, ask both in one message:

> **Confirm these before running the waterfall allocation on {candidate name}:**
> 1. **Group results by** — currently: Holder. Options: Holder / Interest type.
> 2. **Time-based vesting** — currently: as of the valuation date. Options: as of the valuation date / accelerate to a target date.
>
> Reply with any changes, or say "use defaults" to keep both as-is.

Parse against both fields — anything unaddressed keeps its default;
"use defaults" takes `BY_INTEREST_HOLDER` and `""`. If the user picks
acceleration without naming a date, use the valuation date rather than
asking a second question.

Proceed to **Step N3**.

### Step N2: Niagara OPM inputs

The OPM takes the same **grouping method** as Step N1 — collect it the
same way, with the same `BY_INTEREST_HOLDER` default, and the same rule
that the run and the poll must agree.

Beyond that, the OPM has two model inputs: **equity volatility** and
**weighted time to exit**. Ask about them exactly as Step 4C does on
the standard OPM branch — defaults from the current values, prompt only if
the user wants to override.

**The write path is what differs, and it is not the run command.**
`portfolio_valuations:compute:niagara_opm` takes `valuation_id` and
nothing else — it ignores its request body entirely, and the OPM reads
both values off the **saved allocation** instead. Passing either
override to the run raises an error rather than dispatching a run that
silently ignores them. So an override has to be saved *before* the run,
through `mutate:allocation`.

That also fixes the wording: leaving a field blank means **use the
value already saved on the allocation**, not "use a backend default".
Say "keep the current volatility", never "leave it blank".

#### Step N2.1: Read current values, then one combined form

Read the current values first — this is the source for "current" in the
form. Call
`read_tool({"name": "portfolio_valuations__get__allocation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`
and capture `weightedTimeToExit`, `equityVolatilityManualEntry`,
`assetVolatilityManualEntry`, `volatilitySelectionMethod`, and
`debtOption`.

Call `mcp__visualize__read_me` (module `elicitation`) if not loaded,
then `show_widget` with:

- **Group results by** — single-select, default "Holder" (same two
  options as Step N1.1)
- **Weighted time to exit (years)** — numeric, decimal allowed (e.g.
  4.5), default = current `weightedTimeToExit`
- **Volatility (%)** — numeric, default = the current manual entry
  (`assetVolatilityManualEntry` when `debtOption` is `INCLUDE_ALL` or
  `EXCLUDE_NONCONVERTIBLE`, otherwise `equityVolatilityManualEntry`)

Volatility is asked as a percentage (e.g. 65) and saved as a decimal
(0.65) — convert before writing. Time to exit is a positive float;
re-prompt just that field in prose if it doesn't parse, rather than
re-rendering the whole form.

##### Fallback (no widget)

If `widget_available` is `false`, ask all three in one message:

> **Confirm these before running the OPM allocation on {candidate name}:**
> 1. **Group results by** — currently: Holder. Options: Holder / Interest type.
> 2. **Weighted time to exit** — currently: {N} years. Enter a new value, or keep current.
> 3. **Volatility** — currently: {N}%. Enter a new value, or keep current.
>
> Reply with any changes, or say "use defaults" to keep everything as-is.

Parse against all three — anything unaddressed keeps its current value.

#### Step N2.2: Save overrides (only if something changed)

**If the user changed neither volatility nor time to exit, skip this
step entirely** and go straight to Step N3. The run will use what's
already saved. Grouping method is a poll/run argument, not an
allocation field — changing it alone never triggers a save.

If either changed, call
`call_tool({"name": "portfolio_valuations__mutate__allocation", "arguments": {...}})`
with only the changed fields, plus the volatility method:

```json
{
  "ownerId": <ownerId>,
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "volatilitySelectionMethod": "MANUAL",      // whenever volatility is overridden
  "weightedTimeToExit": <float>,              // only if time to exit changed
  "equityVolatilityManualEntry": <float>,     // debtOption EXCLUDE_ALL
  "assetVolatilityManualEntry": <float>       // debtOption INCLUDE_ALL / EXCLUDE_NONCONVERTIBLE
}
```

Send **one** of the two volatility fields, never both, and omit any
field the user didn't change. **`volatilitySelectionMethod` must be
`MANUAL`** whenever volatility is overridden — the OPM enrichment has no
linear regression, so don't offer Step 4C.2's regression branch here.
Step 6's camelCase rule and error handling apply.

### Step N3: Dispatch the run

**Niagara Waterfall** — call
`call_tool({"name": "portfolio_valuations__compute__niagara_waterfall", "arguments": {...}})`:

```json
{
  "valuation_id": <valuation_id>,
  "timeBasedVestingHypothesis": "<'' | TIME_VESTING_ACCELERATION>",
  "targetDate": "<YYYY-MM-DD>"
}
```

Omit `targetDate` unless the hypothesis is `TIME_VESTING_ACCELERATION`.

**Niagara OPM** — call
`call_tool({"name": "portfolio_valuations__compute__niagara_opm", "arguments": {...}})`:

```json
{ "valuation_id": <valuation_id> }
```

`valuation_id` and nothing else. Do not pass
`equityVolatilityManualEntry`, `weightedTimeToExit`, or
`groupingMethod` here — the first two belong on the Step N2.2 save and
the third on the Step N4 poll.

Either way the response is an echo (`{status: "requested", ...}`), not
a result. **It does not mean the allocation succeeded** — never render
a value off it, and never tell the user the allocation is done at this
point.

#### Error handling

- **422 `waterfall_not_eligible`** — the candidate isn't eligible for a
  Niagara run: no model configured, missing cap-table access, or an
  ambiguous ownership structure (see Gate 0). Gate 0 normally catches
  this and drops the Niagara options before they are offered; if it
  slips through, use Gate 0's messaging for whichever condition
  applies. Do not retry — retrying doesn't fix a missing model or a
  missing access grant.
- **Other failures** — retry once, then surface plainly with the deep
  link.

### Step N4: Poll for the result

Poll with the **same `groupingMethod`** collected in Step N1/N2 — the
parameter is required on the poll and 400s without it.

**Niagara Waterfall** —
`read_tool({"name": "portfolio_valuations__get__niagara_waterfall", "arguments": {...}})`.
**Niagara OPM** —
`read_tool({"name": "portfolio_valuations__get__niagara_opm", "arguments": {...}})`.
Both take:

```json
{
  "valuation_id": <valuation_id>,
  "groupingMethod": "<BY_INTEREST_HOLDER | BY_INTEREST_TYPE>"
}
```

`status` is one of `PENDING`, `SUCCESS`, `FAILURE`. **Only `SUCCESS`
carries a `payload`** — `PENDING` and `FAILURE` have none, so never try
to read a value off a non-`SUCCESS` poll.

**Poll budget: at most 10 polls.** Wait ~5 seconds after the run, then
~10 seconds between polls. These runs are slow — an OPM waits on an
underlying waterfall run before it can enrich it — so `PENDING` on the
first few polls is the normal case, not a symptom.

If the run is still `PENDING` after 10 polls, **stop polling**. Do not
re-dispatch the run, do not switch to the other methodology, and do not
poll the other command hoping for a result. Say plainly that it's still
computing and hand off:

> "**{candidate name}**'s allocation is still computing. It'll be
> waiting on the valuation's page in Carta's valuations dashboard when it
> finishes."

Keep the user informed while polling, but only once — a single "running
the allocation, this takes a minute" line, not a message per poll.

#### On `FAILURE`

Surface the `error` field in plain language. **For
the OPM, a `FAILURE` can come from the underlying waterfall run rather
than the OPM itself** — the enrichment can only run on a waterfall that
succeeded. So don't describe an OPM failure as an OPM-specific problem
unless the error says so; "the allocation didn't complete" is the
accurate framing.

Do not retry a `FAILURE` by re-dispatching. A failed run means the
inputs or the model are wrong, and an identical re-run fails the same
way.

### Step N5: Render results

First refresh the candidate's holdings value — the poll payload carries
the allocation, not the firm's holdings:

`read_tool({"name": "portfolio_valuations__get__valuation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`

Then render the per-group table and a top-line summary, mirroring
Step 8.

#### Per-group allocation table

Build from `payload.model.overall` — one row per group. The rows are
holders or interest types depending on the grouping method, so label the
first column to match what was actually requested:

| {Holder / Interest Type} | Allocated Proceeds | % of Total | Units | MOIC |
|---|---|---|---|---|

Pull `groupName`, `allocatedProceeds.proceeds`,
`allocatedProceeds.percentageOfTotal`, `allocatedProceeds.units`, and
`moic`. Format currency with thousands separators and percentages to
two decimals.

`payload.model.overall` is **paginated** (`totalGroups`, `page`,
`pageSize`, `pages`, default 25 per page). If `pages` > 1, either fetch
the remaining pages before rendering or show the first page and say how
many groups there are in total — never render a partial table as if it
were complete. `include_breakpoints: false` drops the tier list, which
is the cheap way to page through groups after the first fetch.

#### Top-line summary

> "Allocation complete on **{candidate name}** ({Waterfall / OPM}).
>
> Company value: {value, full value}
> Holdings value: {valueOfHoldings, full value}"

The company-value field differs between the two payloads:
- **Waterfall** — `payload.equityValue`, with
  `payload.allocatedCompanyValue` alongside it.
- **OPM** — `payload.allocatedValue`. There is no `equityValue` on this
  payload, and unlike the waterfall poll it carries **no `requestedAt`
  / `completedAt`** — don't report timing for an OPM run.

Take `valueOfHoldings` from the `get:valuation` refresh, not the poll.

Refresh the dashboard MCP App (`references/dashboard-view.md` **Refresh it after a change**); don't move the view. Then end the turn by offering to open the updated valuation page (SKILL.md **Writes → End the turn by offering to open the updated valuation**).

#### The `"Infinity"` values

A final breakpoint's `to` and an interest's `irrPercentage` can be the
literal string `"Infinity"`. Both are legitimate — an open-ended top
tier, and an IRR on a zero-cost position. Render them as "no upper
limit" and "n/a" respectively. Never coerce either to a number: it
becomes a nonsense figure in a table the user may hand to an auditor.

### Step N6: Handoff

Same as **Step 9**.
