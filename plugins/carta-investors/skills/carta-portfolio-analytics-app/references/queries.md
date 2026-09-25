# KPI data sourcing — SQL & capture

All data is **Fund Admin** via the connected Carta MCP. DWH queries run through
the gateway: `call_tool({"name":"dwh__execute__query","arguments":{"sql":"...","limit":N}})`.
`dwh__execute__query` accepts only `sql` (+ optional `limit`, `offset`, `format`)
— **no `schema` argument**. Fully-qualify every table as `FUND_ADMIN.<TABLE>`.
Do **not** put `LIMIT`/`OFFSET` in the SQL — pass them as arguments. SELECT-only.

Capture every result with the helper (never hand-copy rows):
`uv run scripts/save_query_result.py <result_path_or_.raw> <raw_dir>/<stem>.ndjson`
— it handles inline pipe tables, base64 `resource` blobs, and the harness
`{"result":"<ndjson>"}` wrapper deterministically.

The builder (`scripts/build_kpi_datadir.py`) reads three stems from `<raw_dir>`.
Only **financials** carries the KPI data; the other two only add the fund slice
dimension and are optional.

## 0. Firm resolution + fund directory → `funds` stem
```
list_contexts   {"firm_name":"<firm words>"}    # → firm_uuid (see SKILL.md Step 1)
set_context     {"firm_id":"<firm_uuid>"}
```
Enumerate the firm's Fund/GP entities (excludes SPVs) — compact, never `fa:list:entities`.
`set_context` row-scopes this table, but the SQL ALSO pins the firm explicitly: a staff
user's row-access grant is one shared slot per user, and the user's other surfaces
(another Claude session, fund-admin Data Explorer, the `carta dwh` CLI) can rewrite it
mid-refresh — the context scope alone once served another firm's rows. Every firm-bearing
stem therefore takes `--firm-uuid` (`emit_stem_sql.py` injects the predicate and selects
`firm_id`, which `save_query_result.py --expect-firm` verifies on every captured page):
```sql
SELECT DISTINCT fund_uuid, fund_name, entity_type_name, firm_id
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE is_firm_rollup = FALSE
  AND entity_type_name NOT ILIKE '%SPV%'
  AND firm_id = '<firm_uuid>'
ORDER BY entity_type_name, fund_name, fund_uuid
```
`fund_uuid` ends the order so it is a unique total order — the MCP hoists this
`ORDER BY` onto its `LIMIT/OFFSET` wrapper, and a non-unique order overlaps pages.
Save to `<raw_dir>/funds.ndjson`. The builder's fund-slice **name** map reads this
directly by `fund_uuid` — the same subquery re-applies this SPV exclusion in §3.

## 1. Portfolio-company KPIs (the KPI data) → `financials` stem  ★ required-attempt
Carta **Data Collection** metrics reported *by the portfolio company* live in the
## §0b — Size probe (run BEFORE §1)

One cheap row that says how big this firm's KPI history is, so the skill can decide
whether to ask the user about limiting it. Returns a single row — no paging.
```sql
SELECT COUNT(*) AS row_count,
       COUNT(DISTINCT legal_name) AS company_count,
       MIN(period_end) AS first_period,
       MAX(period_end) AS last_period
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE instance_type = 'Actual'
  AND (float_value IS NOT NULL OR (string_value IS NOT NULL AND string_value <> ''))
  AND firm_id = '<firm_uuid>'
```
Same predicates as §1 — the explicit firm pin included — so the probe counts what the
scoped fetch will actually pull. In practice this returns on the order
of ~100k rows for a large portfolio and ~14k for a smaller one.

base `FUND_ADMIN.COMPANY_FINANCIALS` table (the legacy `COMPANY_FINANCIALS_LATEST`
view is deprecated/empty). Reduce to **one row per reported period** — the latest
real submission — with `QUALIFY`, and page it with a **stable `ORDER BY`**:
```sql
SELECT legal_name, name, mnemonic, report_type, unit_type, currency,
       float_value, string_value, period_end, period_start, frequency, as_of_date,
       instance_id, general_ledger_issuer_id, corporation_id, llc_entity_id, firm_id
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE instance_type = 'Actual'
  AND (float_value IS NOT NULL OR (string_value IS NOT NULL AND string_value <> ''))
  AND as_of_date <= CURRENT_DATE          -- ignore forward-dated submissions
  AND firm_id = '<firm_uuid>'             -- injected by --firm-uuid (see §0)
  -- OPTIONAL history window; add only when the user chose one (see SKILL Step 1b):
  -- AND period_end >= '<since>'
  -- OPTIONAL incremental floor; the in-app refresh sets it to the cached max instance_id:
  -- AND instance_id > <after_instance>
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY legal_name, COALESCE(mnemonic, name),
                 COALESCE(frequency, ''), period_end
    ORDER BY as_of_date DESC NULLS LAST, instance_id DESC) = 1
ORDER BY legal_name, COALESCE(mnemonic, name), COALESCE(frequency, ''), period_end
```

`general_ledger_issuer_id`, `corporation_id` (a UUID in this table) and `llc_entity_id` are the row's
identity keys: the builder's `company_key()` resolves the GL id through the holdings stems' `entity_link_id`
pairing (§3 and §5) and the corporation UUID through §6, so a KPI row joins its holdings and cap table by
id, never by name.

`instance_id` is one submission (a "collection instance"); it is a monotonic surrogate, so
the in-app refresh reads the cached max back as `--after-instance` and pulls only
submissions logged since the last pull. `as_of_date` cannot play that role: companies stamp
it with the statement date (on a large firm a third of the rows have `as_of_date =
period_end`), so a September filing "as of 2026-06-30" would slip under any date floor.

**Why this exact shape — four traps, all verified on live data:**

1. **`period_start` / `frequency` are load-bearing.** One company reports the SAME
   metric at two cadences at once — a monthly figure (`frequency='MON'`) AND a
   quarterly-cumulative figure (`frequency='QTR'`) on the same quarter-end
   `period_end`. The builder needs `frequency` so a quarter is never built by
   summing a cumulative figure on top of its own component months.
2. **Ignore `is_latest`; the latest *submission* is `MAX(as_of_date)`.** `is_latest`
   is unreliable — it can be `true` on a stale row. It is not selected.
3. **Drop forward-dated submissions.** A row can be stamped "as of" a date that has
   not happened yet (a restatement artifact); `as_of_date <= CURRENT_DATE` removes
   it so it cannot win the period.
4. **Page over a TOTAL order, and dedup in SQL.** `LIMIT/OFFSET` re-runs the query as an independent execution per page; the warehouse gives no stable physical order to rows that tie on the `ORDER BY`, so tied rows can silently overlap and gap across pages, dropping whole companies at the page seam. Order over a *total* key: because `QUALIFY` keeps exactly one row per `(legal_name, COALESCE(mnemonic, name), COALESCE(frequency, ''), period_end)`, ordering by all four of those columns fully determines row order, so OFFSET paging is repeatable. Ordering by only three of them is not enough.
**Row-scoped via `set_context` AND explicitly pinned with `firm_id = '<firm_uuid>'`**
(emit with `--firm-uuid`; see §0 for why the context scope alone cannot be trusted).
On a drifted grant the predicate fails to 0 rows instead of pulling foreign data, and
the selected `firm_id` lets `save_query_result.py --expect-firm <firm_uuid>` verify
every captured page — a failing page writes `financials.ndjson.scope_error` and
nothing else. Coverage is **partial**: only portcos that report into Data Collection
appear. Save to `<raw_dir>/financials.ndjson`. If a firm reports none, the query
returns 0 rows legitimately — write an empty file and proceed (the dashboard shows
a clean empty state), but only after `funds` (fetched with the same firm pin)
returned rows; all-stems-empty means the scope, not the data. Large result → pass
`"format":"ndjson"` and capture the tool-results path with `save_query_result.py`.

Every distinct `mnemonic` (or, when blank, `name`) becomes a selectable metric —
no curated allow-list. `unit_type` (`Dollar`/`Number`/`Percentage`) drives value
formatting; `currency` is carried per point.

**Qualitative KPIs live in `string_value`, not `float_value`.** A company can report
a flag, a date or free prose as a KPI; those rows carry a NULL `float_value`, so a
`float_value IS NOT NULL` predicate silently discards them — on a reference firm that
was hundreds of points across most of the portfolio. `unit_type` discriminates:

| `unit_type` | Example `string_value` | Builder treatment |
|---|---|---|
| `Boolean` | `Yes` / `No` | parsed to 1/0, displayed as the original word |
| `Date` | `Sep 01, 2026` | parsed to a sortable date, plus a `Months to <label>` numeric companion |
| anything else | free prose | display-only text |

A row with **both** values set keeps the float — the numeric reading is the richer one.

## 1b. Forecasts / estimates (for the Company page's Forecast card and the Metrics pivot) → `forecasts` stem  · optional
The **`instance_type = 'Estimate'`** rows are portfolio-company **forecasts**. Two
dates matter and must both be selected: **`period_end`** = the *target* period the
forecast is for, and **`as_of_date`** = the *vintage* — when that estimate was
logged. A forecast is rewritten over time, so the same `(company, mnemonic,
period_end)` has several rows at different `as_of_date`s. Keep **every** vintage —
the builder takes `MAX(as_of_date)` per period as the latest-logged estimate AND
retains all vintages for the "how a forecast changed over time" view. Do **not**
filter `is_latest` (the builder computes latest itself).
```sql
SELECT legal_name, name, mnemonic, unit_type, currency,
       as_of_date, period_end, float_value, is_latest, instance_id,
       general_ledger_issuer_id, corporation_id, llc_entity_id, firm_id
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE instance_type = 'Estimate' AND float_value IS NOT NULL
  AND firm_id = '<firm_uuid>'             -- injected by --firm-uuid (see §0)
  -- Same optional window, applied to the TARGET period (never to as_of_date — a
  -- recent forecast about an old quarter is exactly what the accuracy backtest needs):
  -- AND period_end >= '<since>'
ORDER BY legal_name, name, mnemonic, period_end, as_of_date,
         unit_type, currency, float_value, is_latest, instance_id
```
`general_ledger_issuer_id`, `corporation_id` and `llc_entity_id` resolve exactly as they
do for actuals (see the paragraph under the §1 query above), so a forecast lands on the
same company as the KPIs it predicts.

Forecasts keep every vintage (no `QUALIFY`), so there is no unique natural key — the `ORDER BY` lists every selected column to make OFFSET paging repeatable.

Forecasts stay **numeric-only** — unlike §1, this keeps `float_value IS NOT NULL`.
The forecast panels are built on arithmetic the qualitative kinds can't support: vintage
curves, actual-vs-estimate error and the accuracy backtest. A qualitative estimate has
nowhere to land there, so it is left out rather than carried and then ignored.

Firm-pinned and page-verified exactly like §1 (`--firm-uuid` + `--expect-firm`). Save to
`<raw_dir>/forecasts.ndjson`. Legitimately 0 rows for a firm with no forecasts —
save an empty file; the Forecast card then reports that no forecast was logged. Large result
→ `"format":"ndjson"` + `save_query_result.py`. Forecast target periods run into
the future (e.g. 2030) and are intentionally kept out of `dimensions.periods` (the
actuals timeline) — the forecast charts derive their own axis.

## 2. Company → fund map (slice dimension) — retired
This stem (`investments.ndjson`, a `SELECT DISTINCT issuer_name, fund_uuid FROM
FUND_ADMIN.AGGREGATE_INVESTMENTS` query) is retired: §3's `holdings.ndjson`
already carries `issuer_name`/`fund_uuid` and covers the same join (see the note
at the end of §3), so this is no longer fetched, and the builder no longer reads
`investments.ndjson`. Left as `## 2` (not renumbered) so the `§3`/`§4`
cross-references elsewhere in this doc, in SKILL.md, and in
`build_kpi_datadir.py` stay accurate.

## 3. Valuation + returns inputs (Company 360) · optional
Implied valuation = **latest PPS × fully-diluted shares**; the Company 360 page also
shows cost/MOIC/IRR/sector/last-round. Three stems.

These tables row-scope to the firm via `set_context`, with the explicit
`firm_id = '<firm_uuid>'` pin injected by `--firm-uuid` on both the stem and its
SPV-exclusion subquery (§0 has the why); no fund-UUID list is emitted (mirrors
carta-fund-modeling's corp-scope subquery).

**`holdings` — PPS + cost basis + sector, from the fund's Fund Admin marks.**
`AGGREGATE_INVESTMENTS` carries `REMAINING_VALUE_PER_SHARE` (latest per-share FMV),
`LATEST_FMV_EFFECTIVE_DATE`, plus `TOTAL_COST`/`TOTAL_PROCEEDS`/
`TOTAL_UNREALIZED_GAIN_LOSS`/`INVESTMENT_DATE` (→ gross MOIC, holding period) and
`TAGS_JSON` (→ Industry/Country). PPS is taken from the most-recently-marked **equity**
position (warrants/options excluded via `IS_OPTION_OR_WARRANT_ASSET`); cost/FMV/proceeds
sum across all positions.
```sql
SELECT issuer_name, fund_uuid, asset_name, asset_class_type, count_remaining_shares,
       remaining_value, remaining_value_per_share, latest_fmv_effective_date,
       total_cost, total_proceeds, total_unrealized_gain_loss, investment_date, tags_json,
       is_active_investment, is_option_or_warrant_asset, is_public_asset,
       entity_link_id, general_ledger_issuer_id, fund_investment_key
FROM FUND_ADMIN.AGGREGATE_INVESTMENTS
WHERE fund_uuid IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
ORDER BY issuer_name, fund_uuid, asset_name, asset_class_type, fund_investment_key
```
`fund_investment_key` (unique per row) ends the order so a >10k firm, which the SKILL
pages, tiles cleanly — the MCP hoists this `ORDER BY` onto its `LIMIT/OFFSET` wrapper.
`tags_json` is what the app's **Tags** filter reads — every category the firm uses
(Industry, Country, Geography, Status, …), not a fixed pair. It is already selected
above; **no separate tag query exists or is needed** (there is no tag table in the
warehouse, and no MCP write path for tags).

Save to `<raw_dir>/holdings.ndjson`. (Supersedes the trimmed `investments` stem — it also
carries `issuer_name`/`fund_uuid`, so the fund-slice map derives from it too.)

**`fdshares` — fully-diluted shares + ownership % + last round, from the cap table.**

Read `FUND_ADMIN.FUND_CORPORATION_OWNERSHIP` carefully — **two of its column descriptions are
wrong**, and both were verified against live data before this query was written:

| Column | What the description says | What the data actually is |
|---|---|---|
| `FULLY_DILUTED` | "Fully diluted ownership percentage" | The **company total FD share count** (tens of millions) |
| `PERCENTAGE` | "Ownership percentage (0-100)" | A **0–1 fraction**, and `TEXT` — must be cast |

Verified identity on every row: `PERCENTAGE = OWNERSHIP_QUANTITY / FULLY_DILUTED`. So
`PERCENTAGE` is a **fully-diluted** ownership fraction; multiply by 100 only for display.

Three traps this query has to handle:
1. **One row per FUND per company.** A company held by three funds has three rows, each with
   that fund's own slice. Firm-level ownership is the **sum** — taking one row (as the old
   `QUALIFY ROW_NUMBER() PARTITION BY CORPORATION_ID` did) understates a co-invested position.
   Take the latest row per *(corporation, fund)*, then sum.
2. **Pro-forma cap tables.** `IS_PRO_FORMA` rows carry a different (often wildly different) FD
   count — one company showed 218,936,270 FD on a pro forma vs 5,478,601 real. Exclude them,
   or the implied valuation built on FD shares is wrong.
3. **Zero ownership.** Rows with `OWNERSHIP_QUANTITY = 0` mean the cap table has no position
   linked, not that the fund truly owns 0%. The builder maps 0 → null (see below).
4. **Funds disagree on the FD total when their snapshots are out of sync.** `FULLY_DILUTED` is a
   company-wide number, but it is stamped as of *each fund's own* refresh date, so two funds
   holding the same company can carry different FD totals — e.g. one fund at 49,133,333 (as_of
   2026-06-10) and another at 44,693,889 (as_of 2026-08-24, matching the live cap table). The
   builder takes the FD from the **freshest** snapshot, not the largest (a plain max would pick the
   stale one). This is only the **fallback**: the implied valuation's FD share count is sourced from
   `SUMMARY_CAP_TABLE` (§4) when a cap table is present, so it always agrees with the Cap table
   card — see the builder note below.

Two junk patterns to expect in the output — both left in the extract and handled downstream,
because they're cap-table data issues, not query bugs:
- **Placeholder single-share rows.** `OWNERSHIP_QUANTITY = 1` with `ROUND_DATE = 2010-01-01`
  gives a ~0.00000007% stake. Real rows, meaningless numbers.
- **Stub cap tables.** A company with an implausibly small `FULLY_DILUTED` (e.g. 35,007) can
  report ~99.99% ownership for what is actually a minority venture stake. The builder blanks
  anything over 100%; the rest survive and read oddly, which is the honest outcome.

The query keeps the grain at **one row per (corporation, fund)** and lets the builder do
the summing. That way the same rows feed both the firm-wide **Ownership %** (the sum) and
the per-fund breakdown shown on Company 360 — the fund names come from the `funds` stem via
`FUND_ID` (identical to `fund_uuid`). The builder picks `fd_shares`/`as_of` from the
freshest per-fund snapshot and blanks a summed total that exceeds 100%.

```sql
WITH own AS (
  SELECT CORPORATION_ID, FUND_ID, AS_OF_DATE, FULLY_DILUTED, OWNERSHIP_QUANTITY,
         TRY_TO_NUMBER(PERCENTAGE, 38, 18) AS own_pct
  FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP
  WHERE FUND_ID IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
    AND FULLY_DILUTED > 1000 AND IS_PRO_FORMA = FALSE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_ID, FUND_ID ORDER BY AS_OF_DATE DESC)=1
),
fin AS (
  SELECT corporation_id, investment_name, round, post_money_valuation,
         COALESCE(closing_date, raised_date) AS round_date
  FROM FUND_ADMIN.FINANCING_HISTORY
  QUALIFY ROW_NUMBER() OVER (PARTITION BY corporation_id ORDER BY COALESCE(closing_date, raised_date) DESC NULLS LAST)=1
)
SELECT o.CORPORATION_ID AS corporation_id, f.investment_name AS name,
       o.FUND_ID AS fund_id, o.own_pct, o.OWNERSHIP_QUANTITY AS own_qty,
       o.FULLY_DILUTED AS fd_shares, o.AS_OF_DATE AS as_of,
       f.round, f.post_money_valuation AS post_money, f.round_date
FROM own o
JOIN fin f ON o.CORPORATION_ID = f.corporation_id
WHERE f.investment_name IS NOT NULL
ORDER BY corporation_id, fund_id
```
Save to `<raw_dir>/fdshares.ndjson`. `own_pct` (per fund) is summed into the dashboard's
**Ownership %** position metric and kept per-fund for the Company 360 ownership dropdown;
it is available to any firm with cap-table portcos, fund-admin or not.

**`deal_irr` — per-company IRR (Company 360 returns strip).**

Keep `fund_uuid` in both the SELECT and the PARTITION BY. This table holds one row
per **(issuer, fund, quarter)**, so partitioning on `issuer_name` alone leaves every
co-investing fund tied at the latest quarter, and `ROW_NUMBER` breaks that tie
arbitrarily — the identical query then returns a different IRR run to run. Measured
on a reference firm: several co-invested companies were ambiguous, and one alternated
by more than 2× from one run to the next.
```sql
SELECT issuer_name, fund_uuid, deal_irr, performance_quarter_end_date
FROM FUND_ADMIN.TEMPORAL_DEAL_IRR
WHERE fund_uuid IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
QUALIFY ROW_NUMBER() OVER (PARTITION BY issuer_name, fund_uuid
                           ORDER BY performance_quarter_end_date DESC, deal_irr DESC)=1
ORDER BY issuer_name, fund_uuid
```
`TEMPORAL_DEAL_IRR` exposes no identity column, only `issuer_name` — the same Fund Admin string the
holdings row carries, so the builder maps an IRR row to its company through the holdings `issuer_name`.

Save to `<raw_dir>/deal_irr.ndjson` (builder sanitizes: 0→null, ≤-99.9%→-100%, >5×→null).
Every fund's row is kept on purpose. The builder shows the IRR of the fund with the
largest cost basis and discloses the spread, because an IRR cannot be summed across
funds the way the cost, value and proceeds figures beside it are.

The builder folds name variants across these stems into the KPI company (token-subset +
fuzzy match) so a "Alpha" vs "Alpha Industries Inc" mismatch doesn't spawn a duplicate.
Coverage is limited to Carta cap-table portcos; all three optional — write empty files if none.

## 4. Cap table (Cap table tab) · optional

This query is scoped by the row-access policy to the corporations the firm can see. There
is **no `fund_id` / `firm_id` column** on the table, so no fund filter is possible — or
needed.

**`capstack` — the full cap table by security class, with rights and preferences.**

⚠ **`AS_OF_DATE` is a per-ROW refresh stamp, not a snapshot boundary.** One real company has
17 security classes: 14 stamped `…20:08:15.530000` and 3 stamped `…531000`, one millisecond
later. `QUALIFY … PARTITION BY corporation_id ORDER BY as_of_date DESC` therefore returns
**3 rows out of 17** and silently drops every share class. Partition by
**`corporation_id, security_class_id`**. With that fix the same company returns all 17 and
fully-diluted ownership sums to exactly 100.000%.

`CASH_RAISED`, `PRINCIPAL` and `INTEREST` are `OBJECT`s keyed by currency code — flatten them
(`cash_raised:USD::NUMBER`); never `SELECT *` here.

⚠ **`SUMMARY_CAP_TABLE.LEGAL_NAME` GOES STALE AFTER A RENAME.** On one firm, 19 of 39
cap-table corporations carried a name that no longer matched the authoritative one. Most
differences are punctuation (`Globex` vs `Globex Inc.`) that name normalization absorbs, but
two were genuine renames that normalization can never bridge:

| Cap table still says | Company is actually called |
|---|---|
| `Initech Technologies Inc` | **Umbrella Nano Inc.** |
| `Soylent Catalysts, Inc.` | **Hooli Technologies, Inc.** |

The failure is silent and nasty: the real cap table attaches to the wrong company (or to no
company), while a leftover empty shell corporation under the *old* name attaches to the right
one — so the app shows a full set of share classes with every quantity zero. **Always carry the
authoritative name from `CORPORATION_BASIC_INFO_V2`** and join on that.

```sql
WITH corp AS (
  SELECT corporation_uuid, corporation_name
  FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2
  WHERE corporation_uuid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY corporation_uuid ORDER BY _loaded_at DESC) = 1
)
SELECT s.legal_name, COALESCE(c.corporation_name, s.legal_name) AS corp_name,
       s.corporation_id, s.security_class_id, s.security_class_name,
       s.security_class_type, s.security_class_type_detailed, s.as_converted_shareclass_name,
       s.outstanding_shares, s.fully_diluted_quantity, s.authorized_shares,
       s.fully_diluted_ownership, s.plan_size, s.shares_available_under_plan,
       s.weighted_average_exercise_price, s.original_issue_price, s.conversion_ratio,
       s.conversion_price, s.seniority, s.multiplier, s.participating_preferred,
       s.preference_cap, s.dividend_coupon, s.dividend_type, s.dividend_accrual,
       s.is_compounding, s.earliest_issue_date, s.as_of_date,
       s.cash_raised:USD::NUMBER AS cash_raised_usd,
       s.principal:USD::NUMBER   AS principal_usd,
       s.interest:USD::NUMBER    AS interest_usd
FROM FUND_ADMIN.SUMMARY_CAP_TABLE s
LEFT JOIN corp c ON c.corporation_uuid = s.corporation_id
QUALIFY ROW_NUMBER() OVER (PARTITION BY s.corporation_id, s.security_class_id
                           ORDER BY s.as_of_date DESC) = 1
ORDER BY corporation_id, security_class_id
```
Save to `<raw_dir>/capstack.ndjson`. The builder joins on `corp_name` and falls back to
`legal_name`.

Sense-check before moving on: `outstanding_shares × original_issue_price × multiplier` should
equal the recorded `cash_raised_usd` for a preferred class. It ties out exactly on real data
(one class: 7,408,921 × 3.45 × 1.0 = 25,560,777 = `cash_raised_usd`). That identity is what
makes the app's liquidation-preference stack trustworthy.

The named-shareholder register (`STAKEHOLDER_CAP_TABLE`) is deliberately **not** fetched: it
is not in the client-accessible data set, so the app never queries it and shows no per-holder
or co-investor breakdown. The cap table above is share-class level only.

**Holdings detail needs no new query.** The Cap table tab's "our holdings" section reads
per-asset Schedule-of-Investments lines straight out of `holdings.ndjson` (§3) — fund, asset,
share count, cost, value, unrealized, proceeds. Firms with no fund administration have an empty
`holdings.ndjson`, so the "our holdings" panel simply shows nothing for them.

## 5. SOI performance history (Company 360 "SOI performance" chart) → `holdings_history` stem · optional
The time-series twin of §3's `holdings`. `holdings` is a **latest snapshot** (one
row per fund per security, current mark); `AGGREGATE_INVESTMENTS_HISTORY` carries
the **same position rows at every snapshot date**, which is what a value-per-share /
FMV / cost line over time needs. It powers the Company 360 Overview "SOI performance"
section. Large and paged like `financials`/`forecasts` — fetch it via its own
`sql holdings_history` call, **not** in the light batch.

Columns verified on the live warehouse. `EFFECTIVE_DATE` is
the snapshot date — rows form an event-driven slowly-changing dimension
(`NEXT_EFFECTIVE_DATE` closes each interval, `IS_CURRENT_STATE` flags the latest,
`EVENT_TYPES` names what changed). One row per fund per asset per effective date.

```sql
SELECT issuer_name, fund_uuid, asset_name, asset_class_type, effective_date,
       next_effective_date, is_current_state,
       count_remaining_shares, remaining_value, remaining_value_per_share,
       total_cost, total_unrealized_gain_loss, total_proceeds,
       is_option_or_warrant_asset, entity_link_id, general_ledger_issuer_id, _pk
FROM FUND_ADMIN.AGGREGATE_INVESTMENTS_HISTORY
WHERE fund_uuid IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
ORDER BY issuer_name, fund_uuid, asset_name, asset_class_type,
         effective_date, next_effective_date, _pk
```
This stem keeps every effective-date row (no dedup), so `_pk` — the table's unique
row key — ends the order to make the paged fetch a repeatable total order.

The builder reduces each `(company, effective_date)` to one point:
- **fmv** = `SUM(remaining_value)` across positions — dollars ARE summable.
- **cost** = `SUM(total_cost)` across positions.
- **pps** = `remaining_value_per_share` of the largest **equity** position that date
  (warrants/options excluded via `is_option_or_warrant_asset` — the same rule §3's
  snapshot PPS uses; per-share values are not summable, so one representative mark is
  kept, not a sum).

The snapshot-date column is `effective_date` (the builder tries a few aliases for
resilience). A row with no parseable date is skipped. A company needs **two**
snapshots to draw a line; single-snapshot companies carry no `soiHistory`. Save to
`<raw_dir>/holdings_history.ndjson` — write an empty file if the firm has no fund
administration (the "SOI performance" section then hides itself). Large result →
`"format":"ndjson"` + `save_query_result.py`, paged exactly like `financials`.

## 6. Company identity → `entity_identity` stem · attempt-required

One row per (firm, entity link) — every portfolio company the firm tracks, including paper corporations
and GL-only issuers whose corporation columns are NULL. It bridges a holdings or KPI row to its Carta
corporation: `corporation_id` is the **numeric** Carta Web id (the one in `app.carta.com/.../investment/<id>/…`
URLs), `corporation_uuid` matches `SUMMARY_CAP_TABLE.corporation_id` / `FUND_CORPORATION_OWNERSHIP.CORPORATION_ID`,
and `is_carta_customer` tells a real Carta cap-table customer from a firm-created paper corporation.
```sql
SELECT entity_link_id, corporation_id, corporation_uuid, is_carta_customer, corporation_name
FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2
ORDER BY corporation_name, entity_link_id
```
Context-scoped (no `firm_id` filter). **No `corporation_uuid IS NOT NULL` filter** — paper and GL-only
companies must be kept; they are exactly what `entityKind` classifies. Small (one row per portco): fetch it
singly, `save_query_result.py <result_path> "<raw_dir>/entity_identity.ndjson" --verify-complete --unique-key "entity_link_id"`.
A firm with no rows writes an empty file — the build still runs, every company keeps a typed fallback id
and `entityKind: null`.

The builder keys every company by `company_key(row)`: the row's own `entity_link_id`; else the entity link
the holdings stems (§3 and §5) pair with its `general_ledger_issuer_id`; else the entity link its
corporation UUID maps to here; else `gl:<id>` / `llc:<id>` / `corp:<uuid>` / `name:<norm_co(name)>`.
`entityKind` is `carta-customer` (`is_carta_customer` and a numeric `corporation_id`), `paper` (numeric id,
not a customer) or `gl-issuer` (no corporation). The company's display name is the directory's
`corporation_name`; it is never an identity.

## 7. Corporation links → `corporation_links` stem · attempt-required

One row per (GL issuer, Carta corporation) the firm has linked. One issuer often links to several
corporations — the paper corporation the firm created on the Fund Admin side and the portfolio
company's own Carta account that its KPIs and cap table report from — and `CORPORATION_BASIC_INFO_V2`
(§6) names only the linked one. This table names all of them.
```sql
SELECT general_ledger_issuer_id, corporation_id, is_carta_customer
FROM FUND_ADMIN.CORPORATION_ENTITY_LINKS
ORDER BY general_ledger_issuer_id, corporation_id
```
Context-scoped (no `firm_id` filter). Small (a few hundred rows): fetch it singly,
`save_query_result.py <result_path> "<raw_dir>/corporation_links.ndjson" --verify-complete --unique-key "general_ledger_issuer_id,corporation_id"`.
A firm with no rows writes an empty file — the build still runs.

The builder resolves a KPI or cap-table row's corporation UUID through §6 first; when §6 does not
list it, through this table: corporation → GL issuer → the entity link the holdings stems (§3, §5)
pair with that issuer. Two entity links in §6 that share one corporation UUID fold onto the first
(one Carta corporation is one company); the build prints a NOTE with the count.

## meta.json (written by hand before the build)
`{"name":"<canonical firm name>","slug":"<slug>","currency":"<code>"?,
  "mark":{"text":"<≤3 chars>","bg":"<hex>","fg":"<hex>"}?,
  "firmId":<carta_id|null>,"firmUuid":"<firm_uuid>"}`
The builder writes `firms.json` + `kpi.json` from the stems + meta.
