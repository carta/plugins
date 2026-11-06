# Portfolio Valuations — Markdown Table Runner

The bulk runner. Every bulk run that starts from the runner comes here. An unscoped run
starts at Step 0, which opens the picker view; its message is the confirmed plan and goes
straight to Step 8. A run the user already scoped (named companies, a bucket, row numbers)
starts at Step 1, as does any run when the view can't be used: Steps 1–7 build a numbered
table, collect overrides in prose and confirm the plan. Either way, valuations are created in
**Draft** status only (no finalize step).

---

## Step 0: Open the picker view

Read `references/bulk/bulk-runner-view.md`, open `portfolio_valuations:view:edit_bulk_val`, and
follow it. Open it first: the view reads the portfolio itself, so don't fetch or classify the
dashboard before it. The view collects the companies, methods, values, allocation methods and
one date, and its message is the confirmed plan: go straight from it to Step 8.

**View unavailable** (a terminal client, an error, or the flag is off for this user, per that
file): continue with Step 1 and the table.

## Step 1: Fetch and normalise data

Reuse `list:portfolio_dashboard` data already in context. Otherwise fetch
every page as SKILL.md Step 3.2 does and merge the `companies` arrays.

## Step 2: Classify into buckets

Assign each company to the **first** matching bucket (priority order):

| Bucket | Condition |
|---|---|
| `newRound` | `hasCorpCapTable && latestValuation != null && newFinancingRound != null` |
| `draft` | `hasCorpCapTable && hasCorpCapTableAccess && latestValuation.status == "DRAFT"` |
| `final` | `hasCorpCapTable && hasCorpCapTableAccess && latestValuation.status == "FINAL"` |
| `noValuation` | `(hasCorpCapTable && hasCorpCapTableAccess && latestValuation == null) \|\| (isLlc == true && latestValuation == null)` |
| `noAccess` | `hasCorpCapTable && !hasCorpCapTableAccess` |

Companies with `hasCorpCapTable == false` (and `isLlc == false`) are excluded entirely — no row, no count.

---

## Step 3: Suggest a default approach per company

For each company in buckets `newRound`, `draft`, `final`,
and `noValuation`, derive a suggested approach using the
priority order below. Never suggest for `noAccess` companies.

**Priority order:**

| Priority | Condition | Suggested approach |
|---|---|---|
| 1 | Company has one or more events (`newFinancingRound`, `newTenderOffer`, `newShareTransfer`) | Determined by the event with the **latest date** — see event date comparison rules below |
| 2 | `draft` bucket (no events) | Carry forward the existing draft approach (display label, no copy flag) |
| 3 | `final` bucket (no events) | Carry forward existing approach (display label) |
| 4 | `noValuation` bucket | _(blank — ask user)_ |

**Priority 1** uses SKILL.md Step 3.2's **Approach signals** event →
approach mapping and tie-break. For a Post-Money suggestion, pre-fill the
EV from `newFinancingRound.postMoney`.

**API approach name → display label mapping:**

| API value | Display label |
|---|---|
| `gpc` | GPC |
| `ma` | M&A |
| `dcf` | DCF |
| `backsolve` | Backsolve |
| `other_indication_of_value` | Custom Value |
| `post_money` | Post-Money |
| _(any other / null)_ | — |

`latestValuation.approaches` may be an array or a single string. If an
array, use the first non-null entry. Display label is derived from the
mapping above; if the value is unrecognised, show it as-is.

---

## Step 4: Show the table

Above the table, print one line per company with events, in SKILL.md
Step 3.2's **Approach signals** format. Skip it if no company has events.

Then render **two labelled sections**:

### Existing valuations

Companies in buckets `newRound`, `draft`, `final` — sorted: draft/new-round newest `latestValuation.date`
first, then the rest alphabetically.

| # | Company | Last Val. Date | Status | Suggested Approach | Suggested Date |
|---|---|---|---|---|---|

Columns:
- **#** — row number (runs as one sequence across both sections)
- **Company** — suffix `[C]` if `isCartaCompany == true` (e.g., `MangoCart, Inc. [C]`)
- **Last Val. Date** — `latestValuation.date` formatted `YYYY-MM-DD`
- **Status** — `Draft` or `Final`
- **Suggested Approach** — display label from Step 3. For Post-Money rows show the pre-filled EV inline: `Post-Money (243.7M)`. For copy-from-previous rows show: `GPC (copy)` (or whichever approach + copy). Blank cell if no suggestion.
- **Suggested Date** — today's date as default (`YYYY-MM-DD`)

### No valuation

Companies in the `noValuation` bucket — sorted alphabetically.

| # | Company |
|---|---|

Row numbers continue from the "Existing valuations" section.

Omit a section entirely if it has no rows. Omit `noAccess` companies from both sections; add a note at the bottom: *"{N} companies excluded — cap table access required."*

---

## Step 5: Invite confirmation

After the table, output:

> To run, tell me which rows and any overrides — e.g. *"run 1–4, keep the suggestions"* or *"run 2 and 3 with GPC, skip the rest."*
> You can also override the date for any row: *"run 1 as of 2026-03-31."*

Wait for the user's reply before proceeding.

---

## Step 6: Parse the response

From the user's reply, extract:

- **Companies to run** — by row number, name, range (`1–4`), or description
  (`"everything"`, `"the new rounds"`, `"the drafts"`). Resolve against
  the rendered table.
- **Approach overrides** — explicit approach names or synonyms. Map
  directly to the `methodology` key `create:bulk` expects (Step 8 uses
  these verbatim — snake_case, not the display label): "manual", "manual
  EV", "custom" → `other_indication_of_value`; "post-money", "PM" →
  `post_money`; "backsolve", "BS" → `backsolve`; "GPC" → `gpc`; "M&A" →
  `ma`; "DCF" → `dcf`. For a row from the **Existing valuations** section
  where the user accepts the suggested "(copy)" approach as-is (no
  override), there is no `methodology` key at all — mark it
  `copyFromPrevious: true` instead (see Step 8.1).
- **Date overrides** — per-company or global. Must be today or earlier;
  if the user specifies a future date, refuse and ask again.
- **Allocation overrides** — "Waterfall" → `WATERFALL`; "CSE", "common stock
  equivalent" → `COMMON_STOCK_EQUIVALENT`, for Post-Money, Custom Value and
  Manual EV rows only. Step 8.3 runs them after the value. OPM can't be set in
  a bulk run: say it needs inputs the run doesn't collect, and offer it on the
  valuation afterwards.
- **EV overrides** — explicit company value amounts (`"run 1 with EV 50M"`).
  Parse with B/M/K suffix support. These apply only to Post-Money, Custom
  Value, and Manual EV rows — `create:bulk` has no field for the value
  itself, so overrides captured here are applied in Step 8.3, after the
  bulk create completes.

If a company has **no approach** (blank suggestion, no override specified),
ask one focused clarifying question before proceeding:

> *"Which approach for **{company name}**? Options: GPC, Manual EV, Post-Money, Backsolve, M&A, DCF, Custom Value."*

Do not ask more than one clarifying question per reply round — gather all
missing approaches in a single numbered list if more than one company needs it.

---

## Step 7: Echo the plan and confirm

Print a numbered list of exactly what will be run, wrapped in a fenced
code block so it stands out visually from the surrounding chat. Follow it
with the confirmation prompt outside the block:

```
Here's what I'll create — all as Draft:

1. Acme Corp      — GPC,                                    as of 2026-03-31
2. BetaCo         — Post-Money (243.7M), Waterfall allocation, as of 2026-03-31
3. GammaCorp      — Manual EV (15.0M),                      as of 2026-03-31
```

Type **"yes"** / **"go"** / **"looks good"** to start, or tell me any last changes.

Do **not** proceed until the user gives a clear affirmation.

---

## Step 8: Execute — Draft only

Two or more confirmed companies always go through one `create:bulk` call
(SKILL.md § User-Facing Output Rules).

### Step 8.1: Submit the bulk request

Follow `references/bulk/bulk-runner.md` Step 6.1 (payload, string ids,
snake_case `methodology` keys, Backsolve), with these differences:

- Each item's `valuationDate` is its row's date, after Step 6's date
  overrides.
- An Existing-valuations row where the user kept the suggested "(copy)"
  approach sends `copyFromPrevious: true` and no `methodology`. Every
  other row, including every No-valuation row, sends `methodology`.

### Step 8.2: Poll for completion

Follow `references/bulk/bulk-runner.md` Step 6.2. A timeout goes to
Step 9 with whatever results are in.

### Step 8.3: Set values and allocation methods for Post-Money, Custom Value, and Manual EV rows

Follow `references/bulk/bulk-runner.md` Step 6.3, including its "never
write a value onto a final valuation" guard, using the values and allocation methods
of the confirmed plan only: the view's message, or the Step 7 list the user said yes to.
Report into Step 9.

Never call a finalize or status-update command: every valuation stays in
Draft.

---

## Step 9: Finish

Once Step 8.3 has finished, read `references/bulk/bulk-results.md` and
follow it — it builds the **Bulk run results** table (the dashboard MCP App
already shows the new drafts, refreshed after each create), and handles the "dive
into {company}" hand-off.

Then remind the user:

> All valuations are in **Draft** status. Tell me which one to dive into, or
> which to finalize, when you're ready.
