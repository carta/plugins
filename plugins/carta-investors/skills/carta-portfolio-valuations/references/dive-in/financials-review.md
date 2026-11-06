# Portfolio Valuation — Financials Review (Guided)

Show the user the financial inputs (revenue, EBITDA, net income, etc.)
that feed the valuation. The **primary source is the scenario itself**
(`portfolio_valuations__get__financials`) — what the user has already
entered or previously pulled into this candidate. Only when the
scenario has nothing entered do we fall back to the **Data Warehouse**
table `FUND_ADMIN.COMPANY_FINANCIALS` (the firm's system-of-record) to
see if there's data to offer instead. The Data Warehouse is also
offered as an on-demand comparison/fill source after a populated
scenario table is shown (Step 4.5).

Never show the SQL or table names in chat. The rendered financials
tables show values and metric names — that's expected output.

## Prerequisites

You need a selected candidate:
- `ownerId`, `project_id`, `candidate_id` — for the scenario call and
  any write.
- `targetId` — the portfolio company's `corporationId`. Used both for
  the DWH filter and for opening its page in the dashboard MCP App.
- The company name — for messaging.
- An active firm context. If `set_context` has not been called for the
  active firm, DWH queries will fail. The orchestrator's Step 1
  already ensures this — if you're invoked with no active firm, route
  back to the orchestrator.

These are already in context from the orchestrator. If any are missing,
ask the user to pick a valuation row from the orchestrator's drill-down
flow first.

## Step 0: Entry options (when the user wants to work on financials)

Runs when the user asks to **work on, enter, add or update** the financials
without giving a period and a value ("I want to enter the financials", "let's
work on financials", "add financials"). Skip it for a review request ("show
the financials", "what's the EBITDA"), which starts at Step 1, and for a
specific edit ("set revenue to 5M for FY2024"), which goes straight to
**Edit requests**.

**The user wants to enter them by hand.** When the request says the user wants
to enter the financials themselves ("I'll enter the financials manually", "let
me type them in", "show me a form to enter financials"), skip the menu and open
the financials view: read `references/dive-in/edit-financials-view.md` and
follow it.

Otherwise ask inline, as plain text, and wait:

> How would you like to add the financials for **{company name}**?
> 1. **Import from Carta** — I'll look up what's stored for this company and offer to fill it in.
> 2. **Enter them here in chat** — tell me the period and the numbers.
> 3. **Enter them manually** — I'll open the financials table for you to fill in.

Route the reply:
- **1, import** → run **Step 2** with reason = on-demand, then Step 4.6 to fill.
  When it returns zero rows, say so plainly (Step 2's zero-rows, on-demand
  message) and ask again with options 2 and 3 only.
- **2, enter in chat** → **Edit requests** below: ask for the period and the
  values, with no alternative of editing on the page.
- **3, enter manually** → read `references/dive-in/edit-financials-view.md`
  and follow it.

## Step 1: Pull scenario-bound financials (primary source, silent)

**Do this silently.** Call `get:financials`.

The response's `periods` array already includes prior-LTM and NTM
periods (e.g. "08/01/2022 - 07/31/2023") alongside the current-LTM
periods, deduplicated — no extra merging needed on this end.

The response also includes a separate `ltmFinancials` array — cash and
debt figures for the current LTM period only (`cashAndCashEquivalents`,
`nonConvertibleDebt`, `nonConvertibleDebtInterestManualEntry`,
`nonConvertibleDebtInterestType`). These are unrelated to revenue/EBITDA
and always render as their own table (see Step 4) — never merge them
into the `periods` table.

### Outcomes

- **Every returned period has `revenue == 0` AND `ebitda == 0`** →
  nothing has actually been entered on this candidate yet (periods can
  exist as empty shells). Tell the user plainly:
  > "**{company name}** doesn't have financials entered on this
  > valuation yet."
  Then proceed to **Step 2** (Data Warehouse lookup, fallback reason)
  to check whether the Data Warehouse has something to offer instead.
- **At least one returned period has non-zero revenue or EBITDA** →
  proceed to **Step 4** (render), using the scenario-shaped table
  format. After rendering, continue to **Step 4.5** to offer the
  Data Warehouse as a comparison/fill source.

## Step 2: Data Warehouse lookup

Reached two ways — the messaging at the end differs by reason, but the
query itself is identical either way:
- **Fallback** — Step 1's scenario data was entirely zero.
- **On-demand** — the user asked to also see/fill from the Data
  Warehouse after a populated scenario table was already shown
  (Step 4.5).

Query the firm's system-of-record directly:

Call `read_tool({"name": "dwh__execute__query", "arguments": {"sql": "<query below>", "limit": 100}})` directly.
Substitute `<targetId>` with the portfolio company's `corporationId`
from context. Cap rows at 100 — that's plenty for an annual P&L over
several years, and it keeps the response bounded.

```sql
SELECT
  PERIOD_START,
  PERIOD_END,
  NAME,
  MNEMONIC,
  FLOAT_VALUE,
  CURRENCY,
  UNIT_TYPE,
  FREQUENCY,
  INSTANCE_TYPE,
  REPORT_TYPE,
  AS_OF_DATE
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE CORPORATION_ID = '<targetId>'
  AND REPORT_TYPE IN ('Profit and Loss', 'KPI')
  AND FREQUENCY IN ('ANN', 'QTR')
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY FIRM_ID, CORPORATION_ID, PERIOD_END, MNEMONIC,
                 FREQUENCY, REPORT_TYPE, INSTANCE_TYPE
    ORDER BY DATE(AS_OF_DATE) DESC, INSTANCE_ID DESC
) = 1
ORDER BY PERIOD_END DESC, NAME
LIMIT 100
```

### Why these filters

- `CORPORATION_ID = '<targetId>'` — scope to this portco only. Note:
  `targetId` from `list:portfolio_dashboard` is the same UUID as DWH's
  `CORPORATION_ID`. If the query returns zero rows but you suspect the
  ID is right, do not fall back to a different ID — the data simply
  isn't there. Proceed to the zero-data outcome below.
- `QUALIFY ROW_NUMBER() ... = 1` — exclude superseded data points. The
  same metric for the same period can be reported multiple times; keep
  the one with the newest `AS_OF_DATE`, then the highest `INSTANCE_ID`.
- `REPORT_TYPE IN ('Profit and Loss', 'KPI')` — valuations primarily
  use P&L (revenue, EBITDA, net income) and KPIs. Cash flow and
  balance sheet are out of scope for the default render. If the user
  asks for them, re-run the query without this filter.
- `FREQUENCY IN ('ANN', 'QTR')` — annual and quarterly periods.
  Monthly data is too granular for valuation review at the default
  depth. If the user asks for monthly, re-run without this filter.

### Outcomes

- **Rows returned, fallback reason** → proceed to Step 4 (render DWH
  data), with a note at the top of the table:
  > "Nothing is entered on this valuation yet — showing Data Warehouse
  > data for **{company name}** instead."
  After rendering, go to **Step 4.6** (offer to fill) — filling still
  makes sense here even though the trigger was the empty-scenario
  fallback, not a voluntary on-demand request.
- **Rows returned, on-demand reason** → proceed to Step 4 (render DWH
  data) with the heading "From the Data Warehouse:", no extra note.
  Then go to **Step 4.6**.
- **Zero rows** (or the query fails after one retry), fallback reason →
  no financials exist anywhere. Make entering them the action, not a
  footnote:
  > "**{company name}** has no financials entered yet. Tell me the numbers
  > and I'll enter them for you."
  Then return to the orchestrator's routing.
- **Zero rows, on-demand reason** → tell the user plainly and return to
  **Step 5**'s menu:
  > "No Data Warehouse financials found for **{company name}**."

## Step 4: Render the financials table

Three possible tables depending on which source produced the data —
render whichever ones apply. The scenario tables and the DWH table can
both be on screen at once (Step 4.5's on-demand compare shows DWH data
underneath an already-rendered scenario table).

### Scenario-shaped table (from Step 1)

| Period | Revenue | EBITDA |
|---|---|---|
| {label} | {revenue} | {ebitda} |

- **Period**: use the period's `label` field verbatim (e.g. "FY2024",
  "08/01/2022 - 07/31/2023") — it's already formatted upstream.
- Net income and total assets are not shown — not needed for this
  review.
- Value columns: the valuation's currency (`get:valuation` →
  `currencyCode`, per SKILL.md § Currency default) with thousands
  separators (e.g. `€8,000,000`); show `0` for a genuine zero, not `—` (a `0` here is a
  real reported value, not a missing one — the all-zero case was
  already handled as "not entered" in Step 1).
- **Label suffix**: each period may carry a `periodType` field
  (`"LTM"`, `"PREVIOUS_LTM"`, `"NTM"`, or absent for a regular period).
  Append a suffix to the rendered label based on it:
  - `"LTM"` → `{label} (LTM)` (e.g. `08/01/2023 - 07/31/2024 (LTM)`)
  - `"NTM"` → `{label} (NTM)` (e.g. `08/01/2024 - 07/31/2025 (NTM)`)
  - `"PREVIOUS_LTM"` or absent → `{label}` as-is, no suffix.
- **Sort**: the `"PREVIOUS_LTM"`-tagged period goes **first**,
  regardless of date. All other periods (including `"LTM"`/`"NTM"`)
  follow, sorted by `financialDate` descending (most recent first).
  If more than one period is tagged `"PREVIOUS_LTM"` (shouldn't
  normally happen), sort those among themselves by `financialDate`
  descending too, still ahead of everything else.

### Debt & cash table (from Step 1, `ltmFinancials`)

Only rendered when the scenario-shaped table above is shown (Step 1
source) — `ltmFinancials` doesn't apply to the DWH fallback. Render as
its own table, directly below the Revenue/EBITDA table, never merged
into it — this covers the current LTM period only, not the full period
history:

| Period | Cash & Equivalents | Non-Convertible Debt | Interest Type | Interest Rate |
|---|---|---|---|---|
| {label} | {cashAndCashEquivalents} | {nonConvertibleDebt} | {nonConvertibleDebtInterestType, humanized} | {nonConvertibleDebtInterestManualEntry, %} |

- **Period**: `label` field, same formatting as the Revenue/EBITDA
  table.
- **Cash & Equivalents** / **Non-Convertible Debt**: the valuation's
  currency with thousands separators; `0` for a genuine zero.
- **Interest Type**: humanize the enum (`CUSTOM_INTEREST` → "Custom",
  underscores → spaces, title case) — never show the raw enum token.
- **Interest Rate**: `nonConvertibleDebtInterestManualEntry` as a
  percentage with two decimals (e.g. `5.00%`); show `—` if null.
- If `ltmFinancials` is empty, skip this table entirely — do not
  render an empty shell.
- Interest type and rate can be set in the financials view (`edit-financials-view.md`); see **Edit requests** for chat entry.

### DWH-shaped table (from Step 2)

| Period | Frequency | Metric | Value | Currency |
|---|---|---|---|---|
| {PERIOD_START}–{PERIOD_END} | {FREQUENCY} | {NAME} | {FLOAT_VALUE formatted by UNIT_TYPE} | {CURRENCY} |

**Column logic**:
- **Period**: render as `{PERIOD_START}–{PERIOD_END}` (ISO dates). If
  the period is exactly one calendar year and `FREQUENCY = 'ANN'`,
  render it as just the year (e.g. `FY2025`).
- **Frequency**: `ANN` / `QTR` / `MON` / `SA`. Render as written.
- **Metric**: `NAME` (long form). Show `MNEMONIC` in parentheses only
  if the long form is longer than 30 chars.
- **Value**: format `FLOAT_VALUE` per `UNIT_TYPE`:
  - `Dollar` → the row's `CURRENCY` with thousands separators (e.g.
    `€12,345,678`); with no `CURRENCY`, the bare number
  - `Percentage` → two decimals with `%` (e.g. `42.50%`)
  - `Ratio` → two decimals (e.g. `1.25`)
  - `Number` → integer with thousands separators
  - any other → render `FLOAT_VALUE` as-is
- **Currency**: the row's `CURRENCY` on every `Dollar`-typed row, USD
  included. Blank for other unit types.

If a row has `INSTANCE_TYPE = 'Estimate'` (rather than 'Actual'),
append a small badge to the Metric column: `{NAME} (estimate)`.

**Sort and group**: rows come back ordered by `PERIOD_END DESC, NAME`.
Render in that order.

**Truncation**: if more than 30 rows are returned, render the top 30
by `PERIOD_END DESC` and add a one-line note:

> Showing 30 most recent of {total} financial data points.

## Step 4.5: Offer the Data Warehouse as a comparison/fill source

Only reached right after Step 4 renders a **populated** scenario table
(Step 1's non-zero outcome). Ask inline, as plain text:

> Would you like me to also load **{company name}**'s financials from
> the Data Warehouse, if they're stored in Carta?
> 1. **Yes, load it**
> 2. **No thanks**

Route the reply:
- **Yes** → run **Step 2** with reason = on-demand.
- **No** → proceed to **Step 5**'s menu.

## Step 4.6: Offer to fill scenario financials from the Data Warehouse

Reached after Step 2/Step 4 successfully rendered a DWH-shaped table
(either reason — fallback or on-demand; see Step 2's outcomes). Ask
inline, as plain text:

> Would you like me to fill in the scenario's financials with this
> Data Warehouse data?
> 1. **Yes, fill it in**
> 2. **No, just wanted to see it**

Route the reply:
- **Yes** → proceed to **Step 4.7**.
- **No** → proceed to **Step 5**'s menu.

## Step 4.7: Map & fill scenario financials from the Data Warehouse (write)

This is a real write via `mutate:financials` — apply it, then show what
was saved, same as any edit (see **Edit requests** below for the general
policy).

### Map DWH rows to scenario fields (name-match heuristic)

DWH rows are one-per-metric (`NAME`/`MNEMONIC`/`FLOAT_VALUE`); scenario
periods are flat objects with named fields. There's no fixed lookup
table — match each row's `NAME` (case-insensitive, substring/keyword
match) against the field it clearly describes:

| `NAME` contains… | Scenario field |
|---|---|
| "revenue" | `revenue` |
| "ebitda" | `ebitda` |
| "net income" | `netIncome` |
| "total assets" | `totalAssets` |
| "cost of goods sold", "cogs" | `costOfGoodsSold` |
| "gross profit" | `grossProfit` |
| "total liabilities" | `totalLiabilities` |
| "cash and cash equivalents", "cash" (+ "equivalent") | `cashAndCashEquivalents` |
| "interest bearing liabilit" | `interestBearingLiabilities` |
| "non-convertible debt", "non convertible debt", "convertible debt" | `nonConvertibleDebt` |

This table is illustrative of the heuristic, not exhaustive — apply the
same keyword-matching judgment to metric names that aren't a clean
match to any row above. **If a row's `NAME` doesn't clearly describe
one of these fields, don't guess — leave it unmapped** and list it
under "not applied" in the summary so the user knows it was skipped.

Never map a DWH row to interest type or rate; report any such row as
unmapped too.

### Match DWH periods to scenario periods

Match each DWH `PERIOD_START`/`PERIOD_END` to an existing scenario
period by overlapping date range (compare against that period's
`financialDate`/label-implied range from Step 1's response). If a DWH
period doesn't correspond to any existing scenario period, propose
creating a new one: omit `id`, set `financialDate` = `PERIOD_START`,
`financialDateEnd` = `PERIOD_END`, and `label` built from the same
dates (matching the existing label convention, e.g. "FY2025" for a
calendar year or "MM/DD/YYYY - MM/DD/YYYY" otherwise).

Only write rows that actually change value. If nothing changes (DWH
values match what's already there), say so and skip straight back to
Step 5 — there's nothing to save.

### Apply the write

Call `call_tool` without asking first. `financials` is a required argument —
omitting it is refused by argument validation before any request is sent:

```json
call_tool({"name": "portfolio_valuations__mutate__financials", "arguments": {
  "ownerId": <ownerId>,
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "financials": [<one object per changed/new period, only changed fields + id/financialDate/financialDateEnd/label>]
}})
```

- **Success** → silently re-run Step 1's `get:financials` call, then
  show a **Saved changes** table built from that re-fetch (full values,
  per SKILL.md § Writes):

  | Period | Field | Previous | Saved |
  |---|---|---|---|
  | {label} | {business-term field name} | {previous value or "—" if new} | {saved value} |

  If the mapping skipped any DWH rows as unmapped, mention them plainly
  below the table:
  > Not applied — no clear match: {list of DWH metric names}.

  Then re-render the scenario table (Step 4) and return to Step 5's menu.
- **Failure** → surface the error plainly, retry once, and if it fails
  again suggest editing them on the valuation's page in Carta's valuations
  dashboard as a fallback, and offer to take them there (SKILL.md **Page navigation → After an action, offer instead of moving**). Do not silently drop the
  attempt.

## Step 5: Offer follow-up actions

Present inline as plain text:

> What would you like to do?
> 1. **Looks good**
> 2. **Enter or edit a value**
> 3. **Show a different report type**

Route the reply:
1. **Looks good** — confirm what was reviewed and return control.
2. **Enter or edit a value** — go to **Edit requests** below.
3. **Show a different report type** — proceed to Step 6 (re-run with
   different filters). Only meaningful for the DWH-shaped table; if the
   scenario table is what's showing, say so and offer Step 4.5 (load
   Data Warehouse) as the effective equivalent.

## Step 6: Re-run with different filters (only if requested)

If the user picks "Show me a different report type," ask:

> "Which report type?"
> 1. **All P&L and KPI** (default) — what you already saw.
> 2. **Cash Flow** — re-run with `REPORT_TYPE = 'Cash Flow'`.
> 3. **Balance Sheet** — re-run with `REPORT_TYPE = 'Balance Sheet'`.
> 4. **Monthly granularity** — re-run with `FREQUENCY = 'MON'` (covers
>    P&L and KPI).
> 5. **Cancel** — return to Step 5.

Substitute the filter, re-run the query, and re-render. If the new
filter returns zero rows, surface:
> "No {report type / monthly} data for **{company name}**."
> Then re-prompt with Step 5.

## Edit requests

When the user asks to edit a value at any point ("change revenue",
"add an estimate", "fix the EBITDA", "set revenue to 5M for FY2024"), or picks
option 2 in **Step 0**, take it in chat. Don't steer the user to the page instead; offer it only
when chat can't finish the edit, and open it when they ask to do it in Carta (below).

Ask for what's missing: the period and the values, listing the periods and the
settable fields. Then:
- Only `revenue`, `ebitda`, `netIncome`, `totalAssets`,
  `costOfGoodsSold`, `grossProfit`, `totalLiabilities`,
  `cashAndCashEquivalents`, `interestBearingLiabilities`, and
  `nonConvertibleDebt` are the documented fields of `mutate:financials`.
  The non-convertible debt interest type (`nonConvertibleDebtInterestType`:
  `CUSTOM_INTEREST` or `BAA_CORP_YIELD`) and rate
  (`nonConvertibleDebtInterestManualEntry`, percentage points, used with
  Custom) aren't documented there but the API accepts them on the LTM period.
  Send them with the LTM period's other fields: the type exactly
  `CUSTOM_INTEREST` or `BAA_CORP_YIELD` (`BAA_CORPORATE_YIELD` fails with an
  internal error and saves nothing), the rate in percentage points (`5` for
  5%). Re-fetch and check `ltmFinancials`. An internal error can mean the change
  was or wasn't applied: read the record before calling again, then retry once
  with the interest fields left out. If they still didn't save, say plainly that
  the figures saved but the interest type and rate couldn't be, name the
  valuation's page in Carta's valuations dashboard as the place to set them,
  and offer to take them there (SKILL.md **Page navigation → After an action, offer instead of moving**). Never
  claim they saved without that check.
- Identify the period (ask if ambiguous — don't guess which period a
  bare "set revenue to 5M" refers to) and the field/value from the
  user's request.
- Apply via the same
  `call_tool({"name": "portfolio_valuations__mutate__financials", ...})`
  call shown in Step 4.7 without asking first, re-fetch, and show the
  same "Saved changes" table (one row is fine for a single-value edit).

If the user says they'd rather do it in Carta, open the valuation's page for
them (SKILL.md **Page navigation → Which page to open**) and stop — don't push
chat entry.

## Goal-checklist contribution

End Goal item 2 (only when the methodology requires Financials) is
satisfied once Step 1's `get:financials` returns at least one period with
revenue/EBITDA populated. DWH rows count only once they've been filled
into the valuation (Step 4.7 or Edit requests).
