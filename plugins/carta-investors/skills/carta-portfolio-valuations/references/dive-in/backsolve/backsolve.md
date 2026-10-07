# Portfolio Valuation — Backsolve (Guided)

Run the **Backsolve** analysis on a candidate. Backsolve solves for
implied equity value via OPM, anchored on a priced share class from a
recent financing round. This reference is the chat-driven follow-on to
enabling the approach in `references/dive-in/set-approaches.md` — that
file turns Backsolve **on**; this one walks the analyst through its
inputs.

> **Tool-surface note:** every command on this page goes through
> `call_tool` — `get:backsolve` and `compute:backsolve` on the read side,
> and `mutate:backsolve` on the write side, including the nested
> `captableModifications` object.
>
> **Decimal values must be passed as strings, not floats.** The
> generated `call_tool` schema for every field on this command accepts
> only `str | int | dict | list` — there is no float type in the union.
> Confirmed live: passing `assetVolatilityManualEntry: 0.15` (a JSON
> float) fails validation ("Input should be a valid string" /
> "Input should be a valid integer, got a number with a fractional
> part"); passing `assetVolatilityManualEntry: "0.15"` (a string)
> succeeds. Whole integers (e.g. `nonConvertibleDebtOverride: 5000`) are
> fine as native numbers since `int` is in the union — it's specifically
> **non-integer decimals** that must be stringified. This applies to
> every decimal field on `mutate:backsolve`: `weightedTimeToExit`,
> `nonConvertibleDebtOverride` (when it has cents), `equityVolatilityManualEntry`,
> `assetVolatilityManualEntry`, `nonConvertibleDebtInterestManualEntryOverride`.
>
> **`mutate:equity_adjustment` has the same decimal-as-string
> requirement** (confirmed live: `equityAdjustment: 0.05` as a JSON
> float fails with the same pydantic union error as above;
> `equityAdjustment: "0.05"` succeeds). Applies to every decimal field
> on that command: `equityAdjustment`, `backsolveEquityValueOverride`,
> `newCapitalRaised`.
>
> **`mutate:equity_adjustment` does NOT merge on omitted fields —
> confirmed live: saving only `showEquityAdjustmentExhibitManual: true`
> after `equityAdjustment` had been set to `0.15` reset
> `equityAdjustment` back to `0.0`.** This is the opposite of
> `mutate:backsolve`'s `captableModifications`, where omitted keys are
> left untouched. Every save to `mutate:equity_adjustment` must include
> **every field the candidate should end up with**, not just the ones
> changed this turn — re-send the currently-stored value (from the most
> recent `get:equity_adjustment`) for anything not being changed.

## Entry point: equity adjustment / override requests

If the user asks to **override the equity value** or **apply an
equity adjustment** for a candidate that has already run Backsolve
(Step 4 has succeeded at some point — `get:backsolve`'s
`approachEquityValue` is non-zero), skip straight to **Step 5** below.
Do not re-run Steps 1–4 first. If Backsolve hasn't been computed yet
for this candidate, run Step 4 first (silently, no need to ask), then
continue to Step 5.

**If `excel_mode = true`** and this is a direct entry on an already-computed
candidate (skipping Steps 1–4), offer the Excel insert before diving into
Step 5:

> "Backsolve has already been calculated for **{company name}**. Would you like
> me to add the inputs and live formulas to your current Excel sheet first?"
> 1. **Yes — insert into current sheet**
> 2. **No — go straight to the adjustment**

If "Yes", read `references/dive-in/backsolve/backsolve-excel.md` and follow the
**In-sheet mode** path (fetch `get:backsolve` if not already in context). Then
continue to Step 5 after inserting. If "No", go straight to Step 5.

## Entry point: show volatility comps

Triggered any time the user asks to see the volatility comps while
working with Backsolve — e.g. "show me the volatility comps", "what
are the comps' volatility", "compare the volatility comps". Reachable
at any point once Backsolve is enabled, not just right after Step 3.

**Always fetch and show both allocations — never assume they match or
compute one from the other.** Call `get:volatility_comps` twice:

```json
call_tool({
  "name": "portfolio_valuations__get__volatility_comps",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "allocationId": <the Backsolve allocation's id — `allocation.id` from `get:backsolve`>
  }
})
```

```json
call_tool({
  "name": "portfolio_valuations__get__volatility_comps",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

The second call **omits `allocationId` entirely** — passing the
Backsolve allocation's id twice would just return the same result
twice. Omitting it defaults to the candidate's standard-scenario
allocation, which is the comparison point.

> **Confirmed live: these can differ meaningfully even when both
> allocations pull from the same comp set.** On a real candidate with
> identical comps behind both allocations, the Backsolve allocation's
> equity volatility regression came back **~2.5 percentage points
> higher** than the standard scenario's, across every quartile (min,
> mean, max) — not just the headline regression result. Do not treat
> one allocation's result as a proxy for the other's, and do not
> "sanity check" one against the other and skip the second call to
> save a round-trip — the whole point of this entry point is showing
> the user that they're allowed to diverge.

Render both as one comparison table:

| Metric | Backsolve Allocation | Standard Scenario Allocation |
|---|---|---|
| Equity volatility regression | {equityVolatilityRegression.result, %} | {equityVolatilityRegression.result, %} |
| Asset volatility regression | {assetVolatilityRegression.result, %} | {assetVolatilityRegression.result, %} |
| Min | {equityVolatilityQuartiles.minimum, %} | {equityVolatilityQuartiles.minimum, %} |
| Mean / Median | {equityVolatilityQuartiles.mean, %} | {equityVolatilityQuartiles.mean, %} |
| Max | {equityVolatilityQuartiles.maximum, %} | {equityVolatilityQuartiles.maximum, %} |
| R² | {equityVolatilityRegression.rSquared} | {equityVolatilityRegression.rSquared} |

Format volatility figures as percentages to two decimals (e.g.
`40.92%`); R² to two decimals as a plain number (e.g. `1.00`). Use the
**asset** volatility fields instead of equity wherever
`usesAssetVolatility` is `true` for the candidate — label the row
accordingly rather than silently swapping which figures are shown.

Per SKILL.md's volatility disclosure rule, this table (both columns
labeled, both rows present) is what should back **any** Backsolve
volatility figure quoted elsewhere in this file — never state a bare
Backsolve or standard-scenario volatility number without also showing
(or having just shown) this comparison, and never let a number from
this table stand in for OPM or DLOM volatility (`references/dive-in/allocation.md`),
which are separate datasets.

If R² is exactly `1.00` on either or both columns, add a one-line note
below the table — this is a mechanical artifact of having only 2 comps
(any line fits two points perfectly), not a signal of unusually strong
statistical fit:

> *R² of 1.00 reflects having only 2 comps in the regression — not an
> unusually strong statistical fit.*

Only add this note when the underlying comp count is actually 2 (check
against the saved comp set from `get:comparables`, or the count implied
by the quartile spread) — don't attach it reflexively to every R²=1.00
without checking, since a larger comp set landing on 1.00 by
coincidence would be a genuinely different (and more surprising) result
worth noting differently.

## User-Facing Output Rules

Do not surface raw command names, API field names, HTTP status codes,
or numeric project/candidate IDs in chat. Speak in business terms
("share class", "transaction price", "equity value"). Rendered share
class names and dates are expected output.

## UX Rules

Ask inline as plain text (numbered list + wait for reply) — no
`AskUserQuestion`, per SKILL.md's UX Rules.

## Prerequisites

You need a selected candidate with Backsolve ready to configure:
- `ownerId`, `project_id`, `candidate_id` — for the API calls.
- `targetId` — for the deep link.
- The company name and candidate name — for messaging.
- **Backsolve must be enabled in approaches**
  (`call_tool({"name": "portfolio_valuations__get__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`.`backsolve.is_used` is `true`).

These should be in conversation context from the orchestrator. If
Backsolve is not enabled, read `references/dive-in/set-approaches.md`
inline with intent "enable Backsolve" and stop. Do not attempt the
Backsolve walkthrough without this prerequisite.

### Excel environment detection (run once, silently)

Before Step 1, run:

```
ToolSearch({ query: "excel worksheet workbook", max_results: 3 })
```

If results include tools with "excel", "worksheet", or "workbook" in their name,
set `excel_mode = true`. Otherwise `excel_mode = false`. This is silent — do not
tell the user the result.

## Step 1: Fetch backsolve data and select a share class

Call:

```json
call_tool({
  "name": "portfolio_valuations__get__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

Capture from the response:
- `preferredShareClasses` — list of preferred share class names available to backsolve from (i.e. priced on or before `backsolveDate`).
- `commonShareClasses` — list of common share class names available to backsolve from.
- `backsolveShareClass` — the currently selected share class, or `null` if none is set yet.
- `backsolveDate` — the current backsolve date.

Then call `cap_table__get__certificate_share_classes` to get **every**
share class on the company's cap table — not just the ones priced on
or before `backsolveDate`:

```json
call_tool({
  "name": "cap_table__get__certificate_share_classes",
  "arguments": {
    "corporation_id": <targetId>
  }
})
```

Use `is_common` on each returned class to label it Preferred/Common,
and capture each class's `prefix` (e.g. `CS`, `PA`) — needed to join
the DWH query below.

Then query the data warehouse for Initial Issue Date/Last Activity Date
per share class. Initial Issue Date is scoped to true issuance events;
Last Activity Date deliberately widens to **every** security-level
event type, not just issuance — a share class can see later activity
(a transfer, conversion, exercise) with no new certificate issued:

```json
call_tool({
  "name": "dwh__execute__query",
  "arguments": {
    "sql": "SELECT SPLIT_PART(SECURITY_LABEL, '-', 1) AS share_class_prefix, MIN(CASE WHEN EVENT_TYPE = 'Certificate issuance' THEN EVENT_DATE END) AS initial_issue_date, MAX(EVENT_DATE) AS last_activity_date FROM FUND_ADMIN.PORTFOLIO_EVENTS WHERE CORPORATION_NAME ILIKE '<company name>' AND SECURITY_LABEL IS NOT NULL GROUP BY share_class_prefix ORDER BY share_class_prefix",
    "limit": 100
  }
})
```

> **`SECURITY_LABEL IS NOT NULL` is the filter that scopes to
> security-level events** (`Certificate issuance`, `Certificate
> transfer`, `Convertible conversion`, `Warrant exercise`, `Share class
> conversion`) instead of corporation/round-level events (`New priced
> round`, `New share class`, `Company name changed`, `Stock split`,
> `Valuation finalized/amended/deleted`) that never carry a
> `SECURITY_LABEL` and would otherwise pollute `MAX(EVENT_DATE)` with
> dates unrelated to any specific share class.
>
> **`EVENT_TYPE = 'Certificate issuance'` must be the single-spaced
> literal.** The DWH schema's own column description for `EVENT_TYPE`
> renders this value with a doubled space ("Certificate  issuance") —
> that's a formatting artifact in the description text, not the real
> value. Querying with the doubled space silently returns zero rows
> (confirmed live) rather than an error, so a future editor copying the
> value out of `dwh:get:table_schema` will get a query that "succeeds"
> with no results. Use the single-spaced form shown above.
>
> Confirmed live on a real company: without the `CASE WHEN` scoping,
> two share classes' `MAX(EVENT_DATE)` jumped forward by years once
> `Certificate transfer` events were included — e.g. one class's true
> last activity was a 2022 transfer, nearly a decade after its 2013
> issuance. Initial Issue Date must **not** get the same widening — a
> transfer/conversion isn't when the class was first issued, so it
> stays scoped to `Certificate issuance` only via the `CASE WHEN`.

Join each result row to a share class by matching `share_class_prefix`
to that class's `prefix` from `cap_table__get__certificate_share_classes`
(e.g. `PA` → Series A Preferred). `EVENT_DATE` is a timestamp — format
`initial_issue_date`/`last_activity_date` for display as `MM/DD/YYYY`
(matching the Issue Closing Date convention elsewhere in this skill),
not the raw `YYYY-MM-DD` the query returns.

**This query runs once, filtered only by company name — it must never
be scoped to `preferredShareClasses`/`commonShareClasses` (the
selectable-as-of-`backsolveDate` lists).** It fetches dates for **every**
share class returned by `cap_table__get__certificate_share_classes`,
selectable or not, in a single call. This matters because the table
below deliberately shows non-selectable classes too (e.g. Series D,
Series B II) — narrowing the DWH query to only the selectable names
would silently blank out the date columns on every non-selectable row,
even ones that do have data. If a share class has no matching
`share_class_prefix` row, that's because `PORTFOLIO_EVENTS` has no
data for it (see the known limitation below) — not because it was
filtered out upstream.

> **Known limitation — surface, don't hide:** two distinct gaps, both
> render as `—`, neither should be papered over:
> 1. **Matching is by `CORPORATION_NAME ILIKE`**, since
>    `PORTFOLIO_EVENTS.CORPORATION_ID` is not guaranteed to match the
>    cap-table `corporation_id` used elsewhere in this file (see the
>    DWH schema note on that column) — a firm with two similarly-named
>    portfolio companies could over-match. If the query returns rows
>    for more than one distinct company, narrow the filter (e.g. exact
>    name match) and re-run before using the results.
> 2. **Coverage in `PORTFOLIO_EVENTS` is not guaranteed to be
>    complete.** Confirmed live on a real company: Common and one
>    Preferred class had outstanding shares per
>    `cap_table:get:certificate_share_classes` but **zero** matching
>    rows of *any* `EVENT_TYPE` in `PORTFOLIO_EVENTS` — the
>    certificate-issuance history for those classes simply isn't in
>    this table (likely predates event tracking, or a data-population
>    gap). This is not something the query can work around.
>
> Show `—` for Initial Issue Date/Last Activity Date on any share class with no
> matching `share_class_prefix` row, regardless of which gap caused
> it. Do not substitute another date (e.g. a certificate's created-at,
> or a financing round's closing date) to fill it — `—` is correct
> here, a guessed date is not.

**If both `preferredShareClasses` and `commonShareClasses` are empty**,
surface a plain-language fallback and stop:
> "There's no priced share class to backsolve from yet for
> **{company name}** — a financing round needs to be entered in Carta
> first. {DEEP_LINK}"

**If there is exactly one share class total** (across both lists),
skip the question — use it directly and state plainly that it's the
only one available and that it will be selected:
> "Only one share class is available to backsolve from for
> **{company name}**: **{share class}**. I'll select it as the
> Backsolve anchor."

**Otherwise**, render **every** share class from
`cap_table__get__certificate_share_classes` (not just the ones the
current backsolve date allows) as a table, so the user can see the
full cap table alongside what's actually usable today:

> "Which share class should anchor the Backsolve valuation for
> **{company name}**?"
>
> | Share Class | Type | Initial Issue Date | Last Activity Date | Selectable as of {backsolveDate} |
> |---|---|---|---|---|
> | {share class 1} | {Preferred/Common} | {initial_issue_date or —} | {last_activity_date or —} | ✅ |
> | {share class 2} | {Preferred/Common} | {initial_issue_date or —} | {last_activity_date or —} | ✅ |
> | {share class 3} | {Preferred/Common} | {initial_issue_date or —} | {last_activity_date or —} | — |
> …
>
> *Rows without a checkmark priced after the current backsolve date — to select one of those, update the backsolve date first. Initial Issue Date / Last Activity Date reflect actual certificate issuance events on record — a class with no certificates issued yet shows "—".*

List preferred classes first, then common, matching the order
`cap_table__get__certificate_share_classes` returns them. Mark ✅ in
the last column for any share class whose name appears in
`preferredShareClasses` or `commonShareClasses`; use `—` for every
other row.

Then ask the user to pick, inline as plain text, numbering only the
**selectable** (✅) rows:

> 1. **{selectable share class 1}**
> 2. **{selectable share class 2}**
> …
>
> Would you like me to check if there has been a more recent financing round after the current backsolve date ({backsolveDate})?

If `backsolveShareClass` is already set and appears in the list, mark
it in the option text, e.g. "**{share class}** — currently selected",
but still let the user change it.

If the user names one of the non-selectable (`—`) share classes
directly instead of picking a number, tell them plainly it isn't
selectable at the current backsolve date and point at the note above —
do not attempt to save it. Offer to check for a more recent financing
round (below) as the path to unlocking it.

If the user replies **yes** to checking for more recent rounds:

1. Call `cap_table:list:financing_history` for the company and filter for
   priced rounds whose `closing_date` is strictly after `backsolveDate`.

   > **What `closing_date` actually is (confirmed against carta-web
   > source, `eshares/financing_history/services/calculator_service.py`):**
   > it is **not** a stored round-inception/closing field. It's computed
   > as `MAX(issue_date)` over the security events (certificates, notes,
   > warrants) belonging to that share class within the round's date
   > window — i.e. **the share class's last recorded activity date**,
   > not when the round first closed. The domain model self-documents
   > this: `closing_date: date | None  # this instrument's own latest
   > issuance, not the round's` (`eshares/financing_history/domain.py`).
   > Don't refer to it as "the round's closing date" in any user-facing
   > text — call it what the table below calls it, the class's last
   > activity date. For this flow's purpose (surfacing whether a class
   > has *any* recorded activity after `backsolveDate`) that's actually
   > the right signal — just don't misdescribe what it measures.
2. **If no such round is found**, reply:
   > "No financing activity was found after {backsolveDate}. The
   > share classes shown are up to date."
   Then continue to wait for the user's share class selection.
3. **If one or more rounds are found**, surface them to the user:
   > "I found the following round(s) with activity after {backsolveDate}:
   >
   > | Round | Share Class | Last Activity Date | Price per Share |
   > |---|---|---|---|
   > | {round name} | {share class} | {closing_date} | {price} |
   > …
   >
   > Would you like to update the backsolve date to **{most recent
   > activity date}** so these round(s) become available to select?"
4. If the user confirms, call `mutate:backsolve` to update `backsolveDate`
   to the most recent activity date, then re-call `get:backsolve` and
   restart Step 1 with the refreshed data (updated share class lists and
   new `backsolveDate`).
5. If the user declines, continue to wait for their share class selection
   from the original list.

Wait for the reply and capture the chosen share class name before
continuing.

**Do not call `mutate:backsolve` yet to save this selection.** Hold it
as a pending `backsolveShareClass` value in context. It gets folded
into whichever `mutate:backsolve` call fires *next* in Step 2 — the
first save the user triggers there (Timeline, Debt, Capped notes, or
Rights & Preferences), or, if the user picks "Confirm as-is" without
changing anything else, a dedicated save at Step 2E — so the share
class selection and the first round of Step 2 edits land in one write,
not two back-to-back calls for what the user experiences as a single
"set up Backsolve" action. Once any save has included
`backsolveShareClass`, treat it as saved for the rest of this session —
later Step 2 saves don't need to resend it (`mutate:backsolve` leaves
omitted fields unchanged).

## Step 2: Review & confirm backsolve inputs

Reuse the `get:backsolve` response already fetched in Step 1 — no
re-fetch needed. Render the current values grouped into four sections
and ask the user to confirm or change any of them before moving to the
next step:

> "Here's how Backsolve is currently configured for **{company name}**:
>
> **Timeline**
> - Backsolve date: {backsolveDate}
> - Weighted time to exit: {allocation.weightedTimeToExit} years
>
> **Debt**
> - {debtOption display name — see mapping below}
>
> **Capped notes**
> - {"Treat capped notes as equity" if allocation.treatCappedNotesAsEquity is true, else "Treat capped notes as non-convertible debt"}
>
> **Rights & Preferences**
> - {captableModifications summary, or "No terms removed" if null}"

**`debtOption` display mapping** (`allocation.debtOption` from
`get:backsolve`), in the order the option should be offered when
changing it:
- `EXCLUDE_NONCONVERTIBLE` → "Exclude non-convertible debt"
- `EXCLUDE_ALL` → "Exclude all debt"
- `INCLUDE_ALL` → "Include all debt"

Then ask inline as plain text:

> "Would you like to change anything before moving to the next step?"
> 1. **Timeline** — change the backsolve date or weighted time to exit.
> 2. **Debt** — change how debt is treated.
> 3. **Capped notes** — change how capped notes are treated.
> 4. **Rights & Preferences** — remove specific terms (e.g. Seniority, Dividends).
> 5. **Confirm as-is** — keep everything shown above and continue.
>
> *Not sure what any of these mean? Ask and I'll explain before you choose.*

Wait for the reply and route to the matching step below. Allow the
user to make multiple changes in one pass — after saving one section,
re-render the updated summary and re-ask "anything else?" until they
pick "Confirm as-is."

If the user asks for an explanation instead of picking a number (e.g.
"what does that mean", "explain debt option", "what's a capped note"),
answer in plain business terms using what's already documented in this
file — the `debtOption` display mapping above, the capped-notes
treat-as-equity/non-convertible-debt choice, the five Rights &
Preferences terms (Seniority, Dividends, Liquidation preference
multiplier, Capped participation, Uncapped participation) — then
re-render the same five-option menu and wait again. Don't guess at a
definition that isn't backed by this file; if the user asks about
something this file doesn't define, say so plainly rather than
inventing an explanation.

### Step 2A: Change Timeline

Ask in prose which to change (backsolve date, weighted time to exit,
or both), and for the new value(s). Validate the date is ISO-8601
(YYYY-MM-DD) and weighted time to exit is a positive number (years).
Save:

```json
call_tool({
  "name": "portfolio_valuations__mutate__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "backsolveDate": "<value or omit if unchanged>",
    "weightedTimeToExit": <value or omit if unchanged>,
    "backsolveShareClass": "<pending selection from Step 1, only if not yet saved this session — otherwise omit>"
  }
})
```

### Step 2B: Change Debt

Ask inline as plain text:

> "How should debt be treated?"
> 1. **Exclude non-convertible debt**
> 2. **Exclude all debt**
> 3. **Include all debt**

Save the corresponding enum (`EXCLUDE_NONCONVERTIBLE`, `EXCLUDE_ALL`,
`INCLUDE_ALL`) via:

```json
call_tool({
  "name": "portfolio_valuations__mutate__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "debtOption": "<INCLUDE_ALL|EXCLUDE_ALL|EXCLUDE_NONCONVERTIBLE>",
    "backsolveShareClass": "<pending selection from Step 1, only if not yet saved this session — otherwise omit>"
  }
})
```

#### Branch: "Include all debt" with a backsolve date that differs from the valuation date

Only when the user picks **Include all debt** (`INCLUDE_ALL`), check
whether the selected `backsolveDate` differs from the candidate's
valuation date (`scenario.valuation.valuationDate` from `get:backsolve`,
already in context). If they're equal, skip this branch entirely — just
save `debtOption` as above and return to the Step 2 menu.

If they differ, ask inline as plain text before saving:

> "Since the backsolve date ({backsolveDate}) isn't the same as the
> valuation date ({valuationDate}), would you like to set the
> non-convertible debt as of the backsolve date and its interest type?"
> 1. **Yes — set it now**
> 2. **No — skip for now**

If "No", save `debtOption` alone (as above) and return to the Step 2
menu.

If "Yes":

1. Ask in prose for the **non-convertible debt as of the backsolve
   date** (a dollar amount) — this maps to `nonConvertibleDebtOverride`.
2. Ask inline as plain text for the **interest type**:
   > "Which interest type should apply?"
   > 1. **BAA corporate yield**
   > 2. **Custom**

   - If "BAA corporate yield", this maps to
     `nonConvertibleDebtInterestTypeOverride: "BAA_CORP_YIELD"` — no
     further input needed.
   - If "Custom", this maps to
     `nonConvertibleDebtInterestTypeOverride: "CUSTOM_INTEREST"` and
     **requires** a numeric value from the user (the custom interest
     rate), saved as
     `nonConvertibleDebtInterestManualEntryOverride`. Do not proceed to
     save without this value — ask again if omitted.

Save everything together in one call:

```json
call_tool({
  "name": "portfolio_valuations__mutate__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "debtOption": "INCLUDE_ALL",
    "nonConvertibleDebtOverride": <amount>,
    "nonConvertibleDebtInterestTypeOverride": "<BAA_CORP_YIELD|CUSTOM_INTEREST>",
    "nonConvertibleDebtInterestManualEntryOverride": <value or omit if BAA_CORP_YIELD>,
    "backsolveShareClass": "<pending selection from Step 1, only if not yet saved this session — otherwise omit>"
  }
})
```

Then return to the Step 2 menu (re-render the summary and re-ask).

### Step 2C: Change Capped notes

Ask inline as plain text:

> "How should capped notes be treated?"
> 1. **Treat capped notes as equity**
> 2. **Treat capped notes as non-convertible debt**

Save the boolean via:

```json
call_tool({
  "name": "portfolio_valuations__mutate__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "treatCappedNotesAsEquity": <true|false>,
    "backsolveShareClass": "<pending selection from Step 1, only if not yet saved this session — otherwise omit>"
  }
})
```

### Step 2D: Rights & Preferences

Go straight to the fixed list of removable terms — no yes/no gate
first. Present it and let the user pick one or more (multi-select —
they can name several in one reply, e.g. "1 and 3" or "seniority,
dividends"), or back out without changing anything:

> "Which terms would you like to remove?"
> 1. **Seniority**
> 2. **Dividends**
> 3. **Liquidation preference multiplier**
> 4. **Capped participation**
> 5. **Uncapped participation**

If the user backs out (e.g. "never mind", "nothing", "go back")
instead of picking a term, return to the Step 2 menu (re-render the
summary — unchanged — and re-ask).

Capture the selected term(s) and map to the `captableModifications`
field names:

| Option | Field |
|---|---|
| Seniority | `modificationRemoveSeniority` |
| Dividends | `modificationRemoveDividends` |
| Liquidation preference multiplier | `modificationRemoveMultiplier` |
| Capped participation | `modificationRemoveCappedParticipation` |
| Uncapped participation | `modificationRemoveUncappedParticipation` |

Build the `captableModifications` object with `true` for every field
the user selected. If the user is *un-selecting* a term that was
previously removed (check the `captableModifications` values already
captured from Step 1/Step 2's `get:backsolve` response), explicitly
set that field to `false` rather than omitting it — omitted fields
leave the stored value unchanged, per `mutate:backsolve`'s "all fields
optional" contract.

Save via `call_tool`:

```json
call_tool({"name": "portfolio_valuations__mutate__backsolve", "arguments": {
  "ownerId": <ownerId>,
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "captableModifications": {
    "modificationRemoveSeniority": <true|false>,
    "modificationRemoveDividends": <true|false>,
    "modificationRemoveMultiplier": <true|false>,
    "modificationRemoveCappedParticipation": <true|false>,
    "modificationRemoveUncappedParticipation": <true|false>
  },
  "backsolveShareClass": "<pending selection from Step 1, only if not yet saved this session — otherwise omit>"
}})
```

Only include the keys that changed this turn — not the full set of
five every time — to avoid clobbering fields the user didn't touch.

Confirm in plain language:

> "Removed: **{selected terms, comma-separated}**."

Then return to the Step 2 menu (re-render the summary, including the
updated Rights & Preferences line, and re-ask "anything else?").

### Step 2E: Confirm as-is

**If `backsolveShareClass` is still pending** (the user picked "Confirm
as-is" without triggering any of 2A–2D, so no save has happened yet
this session), save it now on its own, silently:

```json
call_tool({
  "name": "portfolio_valuations__mutate__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "backsolveShareClass": "<pending selection from Step 1>"
  }
})
```

This is the only path where `backsolveShareClass` needs its own
dedicated call — every other path already folds it into a 2A–2D save.
**If it's already saved** (folded into an earlier 2A–2D save this
session), skip this — there's nothing left to persist.

Then move on to **Step 3: Set up Volatility** below.

## Step 3: Set up Volatility

Reached after Step 2E (Confirm as-is). Ask inline as plain text:

> "How would you like to set volatility?"
> 1. **Linear regression** — derive volatility from the comp set's
>    regression against public comparables.
> 2. **Custom input** — enter a volatility value manually.

Which volatility value applies (asset vs. equity) is **not** something
to ask the user — it's determined by `usesAssetVolatility` from
`get:backsolve` (already in context from Step 1/Step 2; `true` when
`debtOption` is `INCLUDE_ALL`).

### Step 3A: Linear regression

Save the method:

```json
call_tool({
  "name": "portfolio_valuations__mutate__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "volatilitySelectionMethod": "LINEAR_REGRESSION"
  }
})
```

**This save succeeds regardless of whether comps or financials are
present** — it only stores the selection. `allocation.
assetVolatilityRegression` / `equityVolatilityRegression` in
`get:backsolve`/`mutate:backsolve` responses are **not** where a
missing-data problem shows up (confirmed live: both stay `null`
whether the regression can run or not — do not gate on them). Whether
the comp set/financials are actually sufficient is only revealed when
the calculation is run in Step 4 — do not pre-emptively call
`compute:backsolve` here just to check.

Confirm what was saved, then ask if they're ready to run:

> "Volatility is set to **linear regression** for **{company name}**.
> Ready to run the Backsolve calculation?"
> 1. **Yes — run it**
> 2. **No — not yet**

If "No", stop here and return control. If "Yes", proceed to **Step 4**.

### Step 3B: Custom input

Determine which value to ask for from `usesAssetVolatility` (do not
ask the user which one):

**If `usesAssetVolatility` is `true`** (Include all debt is set), ask:
> "What asset volatility would you like to set? (as a decimal, e.g.
> 0.35 for 35%)"

Save:
```json
call_tool({
  "name": "portfolio_valuations__mutate__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "volatilitySelectionMethod": "MANUAL",
    "assetVolatilityManualEntry": <value>
  }
})
```

**If `usesAssetVolatility` is `false`**, ask:
> "What equity volatility would you like to set? (as a decimal, e.g.
> 0.35 for 35%)"

Save:
```json
call_tool({
  "name": "portfolio_valuations__mutate__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "volatilitySelectionMethod": "MANUAL",
    "equityVolatilityManualEntry": <value>
  }
})
```

Confirm what was saved, then ask if they're ready to run:

> "Volatility is set to **{value}** ({asset or equity}) for **{company
> name}**. Ready to run the Backsolve calculation?"
> 1. **Yes — run it**
> 2. **No — not yet**

If "No", stop here and return control. If "Yes", proceed to **Step 4**.

## Step 4: Run the Backsolve calculation

Reached only via a "Yes" answer from Step 3A or Step 3B — volatility
selection is the last input before running the calculation. Call:

```json
call_tool({
  "name": "portfolio_valuations__compute__backsolve",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

**If this errors**, show the error to the user directly — this is one
of the few places in this skill where the raw error message is
user-facing rather than translated, since the message itself is
actionable:

> "Running the Backsolve calculation failed: {error message}."

**Specifically for `"Volatility required in order to run the
backsolve"`** (confirmed live — this is what a Linear regression
selection returns when the comp set or financials are incomplete),
follow up with next steps rather than leaving the raw message to stand
alone:

> "This usually means the comp set or the financials are incomplete
> for **{company name}**. Comps are added directly in Carta:
> {COMPS_DEEP_LINK}. Want me to check or fill in financials here?"

`{COMPS_DEEP_LINK}`: see [`references/deep-link.md`](../../deep-link.md),
**Pattern B** with `{tab}` = `comparables` (same tab `comps.md` uses).
If the user says yes to checking/filling in financials, read
`references/dive-in/financials-review.md` inline and follow.

Do not render a table in this case. Stop and let the user decide next
steps (e.g. fix the underlying input and retry).

**If it succeeds**, re-fetch `call_tool({"name":
"portfolio_valuations__get__backsolve", "arguments": {"ownerId":
<ownerId>, "project_id": <project_id>, "candidate_id":
<candidate_id>}})` to pick up the headline equity value fields
(`approachEquityValue`, `currentBacksolve`) alongside the compute
response's `allocation.totals` (per-share-class breakdown). Render:

> "Backsolve calculation complete for **{company name}**. Implied
> equity value: **{approachEquityValue, formatted as currency}**.
>
> | Share Class | Type | Quantity | Price | Value per Unit | Total Value |
> |---|---|---|---|---|---|
> | {shareClass} | {type} | {originalQuantity, comma-separated} | {price, currency} | {marketableValue, currency} | {classValue, currency} |
> …"

One row per entry in `allocation.totals`, in the order returned. Format
all dollar figures with a currency symbol and thousands separators;
show per-unit prices to 2–4 decimal places (small option values like
$0.0999 shouldn't round to $0.10 and lose the distinction from a
different row's $0.10).

**Always render the deep link immediately after the table, in the same
response — never wait for the user to ask for it.** See
[`references/deep-link.md`](../../deep-link.md), **Pattern B** with
`{tab}` = `value-company/backsolve/results` (not the plain
`value-company/backsolve` landing tab used elsewhere in this file —
`/results` lands directly on the full breakdown). Render per
deep-link.md Step 5 (a markdown link labeled "See the full results in
Carta").

**If `excel_mode = true`**, append immediately after the deep link — same response,
no extra round-trip:

> "Would you like me to add the backsolve inputs and live formulas to your current
> Excel sheet?"
> 1. **Yes — insert into current sheet**
> 2. **No — skip**

If "Yes", read `references/dive-in/backsolve/backsolve-excel.md` and follow the
**In-sheet mode** path. The `get:backsolve` data is already in context — no re-fetch
needed. If "No", continue normally.

Do not proactively offer Step 5 (equity adjustment) here — only enter
it if the user separately asks to override or adjust the value (see
"Entry point" above).

## Step 5: Equity adjustment (override the computed value)

Reached when the user asks to override the Backsolve equity value or
apply an equity adjustment — either right after Step 4, or as a direct
entry point (see above) on a candidate that already has a computed
Backsolve value.

### Step 5, part 1: Fetch current state

Call:

```json
call_tool({
  "name": "portfolio_valuations__get__equity_adjustment",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

Capture `backsolveEquityValueOverride`, `equityAdjustment`,
`newCapitalRaised`, `equityAdjustmentDateOverride`,
`equityAdjustmentLanguage`, `showEquityAdjustmentExhibitManual`, and
`backsolveEquityValue` (the pure computed value, unaffected by any
override — use it to show the user what the override is measured
against).

### Step 5, part 2: Present the adjustable fields

Render the current state and the field menu, inline as plain text:

> "Backsolve computed **{backsolveEquityValue, currency}** for
> **{company name}**. The value currently in effect is
> **{approachEquityValue, currency}** (from
> `get:equity_adjustment` — this reflects any existing override below).
> Here's what you can change:
>
> 1. **Override value** — replace the computed equity value directly.
>    Currently: {backsolveEquityValueOverride, currency, or "not set"}.
> 2. **Percentage adjustment** — bump or discount the override value.
>    Currently: {equityAdjustment as a %, e.g. "+5%", or "0%"}.
> 3. **New capital raised** — capital raised in the round, added on top.
>    Currently: {newCapitalRaised, currency, or "$0"}.
> 4. **Adjustment date** — the date the adjustment applies as of.
>    Currently: {equityAdjustmentDateOverride, or "valuation date"}.
> 5. **Adjustment note** — a short description of why the adjustment
>    was made. Currently: {equityAdjustmentLanguage, or "none"}.
> 6. **Done — save and continue**"

Let the user pick one or more fields in a single reply (e.g. "1 and 3",
"override and add a note") — same multi-select pattern as Step 2D's
Rights & Preferences. For each field picked, ask a follow-up in prose:

- **Override value** — "What equity value would you like to use?" (a
  dollar amount, maps to `backsolveEquityValueOverride`).
- **Percentage adjustment** — "What percentage adjustment? (e.g. '+5%'
  or '-10%')" (maps to `equityAdjustment` as a decimal fraction — parse
  "+5%" → `0.05`, "-10%" → `-0.10`; must be ≥ -0.9999).
- **New capital raised** — "How much new capital was raised?" (a dollar
  amount, maps to `newCapitalRaised`).
- **Adjustment date** — "What date should the adjustment apply as of?"
  (ISO-8601, maps to `equityAdjustmentDateOverride`).
- **Adjustment note** — "What note would you like to attach?" (free
  text, maps to `equityAdjustmentLanguage`).

**If the user sets a percentage adjustment or new capital raised
without ever having set an override value** (checked from Step 5 part
1's `backsolveEquityValueOverride` — `null`/never set), the formula
(`equityValue = backsolveEquityValueOverride * (1 + equityAdjustment) +
newCapitalRaised`) has nothing to multiply. Default
`backsolveEquityValueOverride` to the computed `backsolveEquityValue`
in this same save so the percentage/capital change lands on the
computed value rather than zero — mention this plainly: "I'll use the
computed value (**{backsolveEquityValue, currency}**) as the base for
that adjustment."

Once the user has specified at least one field, save. **This command
does not merge on omitted fields (see the tool-surface note at the top
of this file) — every call must carry every field, not just the ones
changed this turn.** Start from the values captured in Step 5 part 1
(or the most recent save's response) and overlay only what the user
changed this turn; send the rest as-is, not omitted. **Any save that
changes at least one adjustment field must also set
`showEquityAdjustmentExhibitManual: true`**, even if the user didn't
ask about the exhibit flag directly — it marks that this candidate now
has a manual adjustment worth surfacing:

```json
call_tool({
  "name": "portfolio_valuations__mutate__equity_adjustment",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "backsolveEquityValueOverride": "<current or newly-changed value, string>",
    "equityAdjustment": "<current or newly-changed decimal fraction, string>",
    "newCapitalRaised": "<current or newly-changed value, string>",
    "equityAdjustmentDateOverride": "<current or newly-changed ISO date>",
    "equityAdjustmentLanguage": "<current or newly-changed text>",
    "showEquityAdjustmentExhibitManual": true
  }
})
```

**Reminder:** `backsolveEquityValueOverride`, `equityAdjustment`, and
`newCapitalRaised` must be passed as strings, not JSON numbers (see the
tool-surface note at the top of this file) — this applies even to
whole-dollar amounts, since these are decimal-typed fields on this
command. `showEquityAdjustmentExhibitManual` is the one field on this
command that's a real boolean, not a decimal — pass it as `true`
natively, not `"true"`.

After saving, re-render the current state (part 1's fields, refreshed)
and ask "Anything else to change?" with the same six-item menu, until
the user picks **Done**.

### Step 5, part 3: Confirm and hand off

On **Done**, state the outcome in plain language — no field names, no
command names:

> "The equity value in effect for **{company name}** is now
> **{approachEquityValue, currency}**."

Then render the deep link: [`references/deep-link.md`](../../deep-link.md),
**Pattern B** with `{tab}` = `value-company/backsolve/results`. Render
per deep-link.md Step 5.

## Deep link

See [`references/deep-link.md`](../../deep-link.md) for URL construction.
Use **Pattern B** with `{tab}` = `value-company/backsolve`. Required
context: `ownerId`, `targetId`, `valuationId`. Render per deep-link.md
Step 5 (a markdown link).
