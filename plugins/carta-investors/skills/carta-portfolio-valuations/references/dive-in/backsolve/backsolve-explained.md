# Backsolve Calculation — How It Works

Explains the math behind the Backsolve approach for the current candidate.
Entered when the user explicitly asks:
- **how the backsolve is calculated** / how we arrive at the value (explanation mode)
- **create an Excel spreadsheet** / export to Excel / give me the formulas in Excel (Excel mode)
- **create an artifact** / interactive calculator / show me an HTML calculator (HTML mode)

Do not enter this reference for requests to *configure* or *run* the backsolve — those go
to `references/dive-in/backsolve/backsolve.md`.

## Output mode

Detect from the user's phrasing before fetching any data:

| Phrasing | Mode |
|---|---|
| "how is it calculated", "explain the math", "walk me through the numbers" | **explain** — walk through sections 1–6 in prose |
| "Excel spreadsheet", "export to Excel", "formulas in a spreadsheet" | **excel** — read `backsolve-excel.md` and generate the file |
| "artifact", "interactive calculator", "HTML", "browser" | **html** — read `backsolve-html.md` and generate the file |
| Multiple modes mentioned | Deliver all requested modes in one response |

## Data to fetch (if not already in context)

Call both in parallel:

```json
call_tool({
  "name": "portfolio_valuations__get__backsolve",
  "arguments": { "ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id> }
})

call_tool({
  "name": "portfolio_valuations__get__equity_adjustment",
  "arguments": { "ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id> }
})
```

If `get:backsolve` returns no `currentBacksolve` or `approachEquityValue` (the
calculation hasn't been run yet), tell the user:

> "The Backsolve hasn't been calculated yet for **{company name}** — run it
> first and I can walk you through the numbers."

Stop and return control.

---

## How to explain the calculation

Use the fetched data to walk through the calculation in plain language,
section by section. Replace every placeholder below with the actual values
from the API response. Speak in business terms — no field names, no command
names, no internal IDs.

All currency amounts: use the `currencyCode` from the response — **never
assume USD**. Format with symbol and thousands separators; use B/M/K suffix
for large numbers where it aids readability.

---

### Section 1 — The starting question

Explain conceptually what the backsolve is doing before showing any numbers:

> "A backsolve starts from a known fact: investors paid
> **{goalSeekFmv, currency/share}** per share for **{backsolveShareClass}**
> in a recent financing round. The calculation works backwards — it asks:
> *'What total equity value must the company have for the OPM waterfall to
> allocate exactly {goalSeekFmv} per share to {backsolveShareClass}?'*
>
> The engine searches for that equity value by running the Option Pricing Model
> (OPM) repeatedly until it finds the value where the model's output matches
> the target price. This is called goal-seeking."

`goalSeekFmv` = `currentBacksolve.goalSeekFmv` from `get:backsolve`. If `null`
or zero, use the target class's OIP (original issue price) from
`allocation.totals` — find the entry whose `shareClass` matches
`backsolveShareClass` and read its `oip`.

---

### Section 2 — The inputs the model uses

Show a compact table of the key OPM inputs drawn from `get:backsolve`:

| Input | Value |
|---|---|
| Target share class | `backsolveShareClass` |
| Target price (goal-seek FMV) | `goalSeekFmv` per share |
| Equity volatility | `allocation.equityVolatilityManualEntry` as %, or "linear regression" if `allocation.volatilitySelectionMethod == "LINEAR_REGRESSION"` |
| Time to exit | `allocation.weightedTimeToExit` years |
| Risk-free rate | `allocation.riskFreeRateWeightedTte` as % |
| Debt treatment | `allocation.debtOption` (display name — see mapping below) |
| Capped notes | "Treated as equity" / "Treated as debt" from `allocation.treatCappedNotesAsEquity` |

`debtOption` display mapping:
- `EXCLUDE_ALL` → "Exclude all debt"
- `EXCLUDE_NONCONVERTIBLE` → "Exclude non-convertible debt"
- `INCLUDE_ALL` → "Include all debt"

---

### Section 3 — The waterfall breakpoints

Explain what the breakpoints mean, then show the actual ones:

> "The OPM models the company's cap table as an ordered waterfall of
> breakpoints — equity-value thresholds where the set of securities that
> participate in the next dollar of value changes. Each band is priced as a
> call option using Black-Scholes."

Render `allocation.breakpoints` as a table. One row per breakpoint in the
order returned:

| Band | Equity range | Width | Who participates | Split |
|---|---|---|---|---|
| {n} | {from, currency} → {to, currency or "∞"} | {delta, currency} | {description} | {sc_percentages formatted as "Class A: X%, Class B: Y%"} |

Format `sc_percentages` keys into readable class names by replacing underscores
with spaces, capitalising each word, and stripping the leading "preferred" /
"common" prefix — e.g. `preferredSeriesA` → "Series A", `commonCommon` →
"Common". Show percentages to 2 decimal places.

After the table, note what drives each boundary in plain language — for example:
- A "Liquidation preference" boundary is the point where all senior-preference
  holders are fully paid out.
- A "Participates" boundary is where common stock begins to share in the upside.
- A "Converts to common" boundary is where a preferred class's conversion value
  exceeds its liquidation preference and it flips to pro-rata common.

Only describe boundaries that appear in the actual data — don't enumerate every
possible type.

---

### Section 4 — Pricing the bands (Black-Scholes)

Explain the option pricing step, then show the incremental values:

> "Each breakpoint boundary is priced as a **European call option on the
> company's equity value**, struck at that boundary. The call option formula
> (Black-Scholes) uses the solved equity value, the boundary level as the
> strike, the volatility, risk-free rate, and time to exit.
>
> The **incremental value** for each band equals the call-option value at the
> previous boundary minus the call-option value at this boundary — the dollar
> amount that 'falls into' that band at the solved equity value."

Show a compact table of the breakpoint option values from `allocation.breakpoints`:

| Band | Boundary strike | Option value at strike | Incremental value |
|---|---|---|---|
| {n} | {to, currency or "∞"} | {optionValue, currency} | {incrementalOptionValue, currency} |

Note which band captures the bulk of the value and why (e.g. "Band 1 holds
almost all the value because the total equity sits just above the liquidation
preference stack").

---

### Section 4b — The exact formulas (show when user asks for formulas or math detail)

Show the actual formula with live numbers from the first finite breakpoint band
(Band 1 in most cases). Use `goalSeekFmv` as the target price, `approachEquityValue`
as S, and the first entry in `allocation.breakpoints` as the example band.

Render it as a formula block, not a table — the user should be able to copy it
into Excel or a calculator directly:

```
Black-Scholes inputs for Band 1 (strike K = {to from first breakpoint}):

  S   = {approachEquityValue}          (company equity value)
  K   = {to from first breakpoint}     (breakpoint boundary / strike)
  r   = {riskFreeRateWeightedTte}      (risk-free rate, annualised)
  σ   = {equityVolatilityManualEntry}  (equity volatility)
  T   = {weightedTimeToExit}           (years to exit)

  d1  = [ ln(S/K) + (r + σ²/2)·T ] / (σ·√T)
      = [ ln({S}/{K}) + ({r} + {σ²/2})·{T} ] / ({σ}·√{T})
      = {computed d1 value to 6 decimal places}

  d2  = d1 − σ·√T
      = {d1} − {σ·√T}
      = {computed d2 value to 6 decimal places}

  N(d1) = {norm.cdf(d1) to 6 decimal places}  (standard normal CDF)
  N(d2) = {norm.cdf(d2) to 6 decimal places}

  C(K) = S·N(d1) − K·e^(−r·T)·N(d2)
       = {S}·{N(d1)} − {K}·e^(−{r}·{T})·{N(d2)}
       = {S·N(d1)} − {K·e^(-rT)·N(d2)}
       = {C(K) to 2 decimal places}

  C(0) = S = {S}           (call struck at zero equals equity value)

  ΔV(Band 1) = C(0) − C(K₁)
             = {S} − {C(K₁)}
             = {ΔV}
```

Do not show d1/d2/N values for the final band (K = ∞) since C(∞) = 0 by definition.

**Excel-equivalent formula** (show this when user mentions Excel or spreadsheets):

```excel
d1  = (LN(S/K) + (r + σ^2/2)*T) / (σ*SQRT(T))
d2  = d1 - σ*SQRT(T)
C   = S*NORM.S.DIST(d1,TRUE) - K*EXP(-r*T)*NORM.S.DIST(d2,TRUE)
ΔV  = C_prev - C
```

where `NORM.S.DIST(x, TRUE)` is Excel's standard normal CDF.

---

### Section 5 — Per-class allocation

Show how the incremental values are distributed across share classes to produce
the final per-share prices. Use `allocation.totals` from `get:backsolve`:

| Share Class | Shares | OIP | Total class value | Value per share |
|---|---|---|---|---|
| {shareClass} | {originalQuantity, comma-separated} | {oip, currency} | {classValue, currency} | {marketableValue, currency to 4 decimal places} |

After the table, call out the goal-seek confirmation:

> "**{backsolveShareClass}** lands at **{its marketableValue per share, currency
> to 4 decimal places}** per share — exactly the target price of
> **{goalSeekFmv, currency}**. This is the goal-seek confirming the model found
> the right equity value."

Point out the solved raw equity value:

> "The solved equity value before any adjustment:
> **{currentBacksolve.backsolveEquityValue, currency}**."

---

### Section 6 — Equity adjustment (only if one is applied)

**Show this section only if** `get:equity_adjustment` returns an `equityAdjustment`
that is non-zero, OR a `backsolveEquityValueOverride` that differs from the raw
computed `backsolveEquityValue`, OR a non-zero `newCapitalRaised`.

If none of those conditions hold, skip this section entirely — do not mention
adjustments at all.

When shown, explain each component that is active:

**Override value** (if `backsolveEquityValueOverride` ≠ `backsolveEquityValue`):
> "An **override** replaces the raw computed equity value. The computed value
> was **{backsolveEquityValue, currency}**; it has been manually overridden to
> **{backsolveEquityValueOverride, currency}** as the starting point for any
> further adjustments."

**Percentage adjustment** (if `equityAdjustment` is non-zero):
> "A **{+X% / -X%} percentage adjustment** is applied to the (override) base
> value:
>
> **{base, currency}** × (1 {+ / -} {|equityAdjustment| as %}) = **{result, currency}**"

**New capital raised** (if `newCapitalRaised` > 0):
> "**{newCapitalRaised, currency}** of new capital raised in the round is added
> on top."

Then show the final arithmetic in plain text, using only the components that
are active:

```
Base (override or computed):   {backsolveEquityValueOverride or backsolveEquityValue}
× (1 + equityAdjustment):      {result after % adjustment, or omit line if 0%}
+ New capital raised:          {newCapitalRaised, or omit line if $0}
─────────────────────────────
Approach equity value:         {approachEquityValue from get:equity_adjustment}
```

Close with:
> "This **{approachEquityValue, currency}** is the company value you see for
> **{company name}**'s Backsolve approach in Carta."

---

## After the explanation

After delivering the prose explanation, **always offer the output formats below**
unless the user's request already named a specific format (in which case deliver
that format without asking):

> "Want this in a different format?
> 1. **Excel spreadsheet** — a workbook with live Black-Scholes formulas in every
>    cell (edit equity value, volatility, or time to exit and everything recalculates)
> 2. **Interactive HTML calculator** — open in a browser with live sliders/inputs
> 3. **This explanation is enough, thanks**"

Do not re-read this reference for the follow-up. Use the data already in context.

- If the user picks **Excel**, read `references/dive-in/backsolve/backsolve-excel.md` and follow it.
- If the user picks **HTML**, read `references/dive-in/backsolve/backsolve-html.md` and follow it.

---

## Verify mode (useful when checking a result)

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/backsolve_calculator.py" \
  --verify \
  --input "$BACKSOLVE_JSON"
```

This re-runs the scipy `brentq` goal-seek and reports whether the solved equity
value matches the API response (difference should be < 0.01%).

---

## After delivering the output

Do not proactively offer to change any inputs or re-run the calculation. Return
control and let the user drive. If they ask a follow-up (e.g. "what would
happen if I changed the volatility?"), answer it from context — do not re-read
this reference a second time.
