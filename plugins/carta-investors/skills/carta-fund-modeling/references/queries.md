# Fund Admin data sourcing — commands & SQL

All data is **Fund Admin** via the connected Carta MCP. **Never** use `fund_forecasting:*`.
Read commands run through the MCP gateway: `read_tool({"name": "<domain>__<verb>__<noun>", "arguments": {...}})`.
DWH queries: `read_tool({"name": "dwh__execute__query", "arguments": {"sql": "...", "limit": 5000}})`.
`dwh__execute__query` accepts **only** `sql` (+ optional `limit`, `offset`, `format`) — there is **no
`schema` argument** (passing one errors). Fully-qualify every table as `FUND_ADMIN.<TABLE>` in the SQL.
**Do NOT write `LIMIT`/`OFFSET` inside the SQL** — pass them as the `limit`/`offset` arguments (the emitter
prints each stem's `limit`). For large results (monthly
NAV series, per-deal, LP base, financing history) pass `"format": "ndjson"`. Then capture whatever the result
was — the small inline result, or the file path the harness prints when it persists a large one (location is
client/config-dependent — read it from the "Output has been saved to …" message, don't reconstruct it) — by
piping it through the helper (**never hand-`cp`, hand-decode, or a hand-written
unwrap**): `uv run scripts/save_query_result.py <result_path> <raw_dir>/<stem>.ndjson`. `save_query_result.py`
handles **every** shape deterministically — inline markdown/pipe tables, a base64 `resource` blob, and the
harness-persisted `{"result": "<ndjson>"}` string wrapper — and exits non-zero if it can't extract ≥1 row.
Saving any wrapper verbatim instead is what yields 0 usable rows downstream.

Rules: **SELECT-only**, bound rows via the `limit` argument, never `INFORMATION_SCHEMA`. Dedup latest snapshot
with `QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC)=1`.
Show **names, not UUIDs**. Resolve fund currency from the data — never assume USD.

**The SQL for every DWH section below lives only in `queries.json`** (the skill root) — the single source of
truth that both the local fetch (`scripts/stem_queries.py`, printed by `scripts/emit_stem_sql.py`, which fills the
`fund_uuid` IN-list) and the hosted app (`server/worker.js`) read. The sections here are the rationale and the
output mapping for each stem, and "Hosted variants" at the end covers the hosted app's own three; the drift-guard tests assert each stem's SELECT still covers the builder's
load-bearing columns. Do **not** hand-author or hand-template a stem query in a first-build; run the emitter
(SKILL.md Step 2).

**Save each query's output to `<raw_dir>/<stem>.ndjson`** (or `.md`), then run
`uv run scripts/build_datadir.py --raw <raw_dir> --out <dashboard_dir> --meta meta.json` — the deterministic, firm-agnostic
generator that writes every console-schema file (SKILL.md Step 3). **Do not hand-author the JSON.** Stems map to
the sections below: `nav_latest`(§2), `investments`(§3), `ownership`(§4), `cashflows`(§5), `accrued_carry`(§7),
`cohort`(§8), `partners`(§9), `deal_irr`(§10), `financing`(§11), `fund_metrics`(§1/§12), `financials`(§14 — firm-context-scoped, no IN-list). The mapping table
below documents the fields the generator derives from each.

## Output → console-schema mapping (produced by `scripts/build_datadir.py`; consumed by `src/model/*`)
Scenario-only console — the dashboard reads `firms.json`, `snapshot.json`, `portfolio.json`, `pacing.json`,
`company-ownership.json`, and `lp-base.json`. Reporting datasets (company financials, tearsheets, SOI, deal
IRR, cash-flow statement) are no longer fetched or written. Cohort benchmarks (§8) and the LP base (§9) ARE
fetched — they feed the Cohort Standing tab (`snapshot.benchmarks`) and the Overview LP Base section.

The **LP Glidepath** section (in the LP Returns tab; `src/model/glidepath.js`) adds **no new query**. Its
"today" anchor is the **live repriced fund state** (`computeFundStates`), so it moves with the active
scenario; the booked history comes from dated LP flows and NAV marks (§5 `snapshot.cashflows`,
`snapshot.navSeries[].byFund`), with the horizon from `snapshot.windDownYear`.

| Console field | Source (this doc) |
|---|---|
| `snapshot.source` (**object**, not a string) | §0 firm name + latest `month_end_date` (§2) → `{firm, navAsOf, marksAsOf, marksPulledAt, currency, mixedCurrency:false}` — the app reads `source.navAsOf.slice(0,4)`, so a string blanks Companies & Exit&IRR |
| `snapshot.funds[].{committed,lpPaidIn,lpDistributed}` | §2 `MONTHLY_NAV_CALCULATIONS` (commitment / lp contributions / distributions) |
| `snapshot.funds[].{type,vintage,name}` | §0 entity enumeration (+ fund start year / vintage) |
| `snapshot.funds[].netLpIrr` | `xirr` of §5 flows + ending LP NAV (suppress for funds < ~1yr old) |
| `snapshot.funds[].gpCapitalNav` | §2 `MONTHLY_NAV_CALCULATIONS.ending_gp_nav` — derived |
| `snapshot.baseAccruedCarry`, `gpEconomics[].accruedCarryToday`, `accruedCarryAsOf` | §7 `ALLOCATIONS` (`Carried interest accrued`, GP side) — **real booked figure** |
| `snapshot.benchmarks[fundId].{tvpi,dpi,moic}{p50..p95}, irr{p50..p90}, fundMoic, cohortSize` | §8 `TEMPORAL_FUND_COHORT_BENCHMARKS` (Cohort Standing) |
| `snapshot.baseLpNav` | §2 `MONTHLY_NAV_CALCULATIONS.ending_lp_nav` |
| `snapshot.cashflows[fundId].{flows,paidInTotal,terminalDate}` | §5 `MONTHLY_NAV_CALCULATIONS` monthly LP contributions/distributions; terminal ← wind-down (vintage + fund life) |
| `snapshot.windDownYear` | vintage + 10 (fund life) |
| `portfolio…companies[].positions[].{cartaFv,markBasisB}` | §3 `AGGREGATE_INVESTMENTS` (remaining_value; `cartaFv` in dollars) + §4 ownership → `markBasisB = FMV / ownership_fraction ÷ 1e9` (**billions**) |
| `portfolio…companies[].costBasis` | §3 `total_cost` |
| `portfolio…assumptions.{carryRate,feeLoads,followOnRatios,...}` | §6 `PROFIT_ALLOCATION_WATERFALL_CONFIG` (carry/pref/catch-up), else defaults; per-fund reserve knobs default to `{}` |
| `pacing.json` | §3 `AGGREGATE_INVESTMENTS.investment_date` (first check per company, by quarter) |
| `company-ownership.json` | §4 `FUND_CORPORATION_OWNERSHIP` |
| `investment-history.json` | §3 `AGGREGATE_INVESTMENTS` (`investment_date`, `total_cost`, `asset_name`, `asset_class_type` per fund × company) → Fund Construction's fund benchmark |
| `lp-base.json` | §9 `PARTNER_DATA` (LPs aggregated firm-wide → LP Returns tab all-partners table) |
| `gp-base.json` | §7b `ALLOCATIONS` GP-entity carry (`gp_carry`, per-partner carry shares) → GP Economics partner-level carry; optionally enriched with §9 `PARTNER_DATA` GP-side commitment |
| `portfolio…companies[].dealIrr` | §10 `TEMPORAL_DEAL_IRR` (latest quarter per company; sanitized) |
| `portfolio…companies[].lastRound` | §11 `FINANCING_HISTORY` (latest priced round: name/post-money/date) |
| `snapshot.fundMetrics` | §12 `AGGREGATE_FUND_METRICS` (mgmt fees, opex, dry powder → Reserves actuals) |
| `snapshot.navSeries` | §5 `MONTHLY_NAV_CALCULATIONS` cashflows stem (firm NAV + TVPI at quarter-ends → Overview trend) |
| company financials (optional) | §14 base `COMPANY_FINANCIALS` (revenue/ARR/headcount — when the firm has them; the legacy `COMPANY_FINANCIALS_LATEST` view is deprecated/empty) |

## 0. Firm resolution + entity enumeration (firm-level)
```
list_contexts                        {"firm_name": "<firm words>"}  # resolve the FIRM by name → firm_uuid (see SKILL.md Step 1)
set_context                          {"firm_id": "<firm_uuid>"}
```
Then enumerate the firm's entities with the **firm directory query — NOT the fund-admin entity-list
command**. The fund-admin entity/fund list commands return verbose per-entity objects and **blow the MCP 40k-char
response limit on large firms** (e.g. a firm with ~100+ SPVs → the list errors out). This query returns just three
columns and **excludes SPVs**, so it stays tiny (that same firm → ~18 rows) and never trips the limit. Print it
filled in with `uv run scripts/emit_stem_sql.py --directory --firm-uuid <firm_uuid>` (the `directory` query in
`queries.json`): a three-table UNION, deduplicated per `fund_uuid`, with SPV-typed entities dropped.
`firm_id` is the `firm_uuid` from `list_contexts`. **No single table is a complete census.**
`MONTHLY_NAV_CALCULATIONS` lists only funds with a month-end NAV close; a fund can hold booked investments
(`AGGREGATE_INVESTMENTS`, whose type column is `fund_entity_type_name`) or carry a metrics row
(`AGGREGATE_FUND_METRICS`) before its first close, so a NAV-only directory misses it from every stem and from the
firm rollup — the UNION captures any fund present in any of the three. **SPVs are excluded
by design** — single-deal vehicles are out of scope for firm/fund-level modeling, and enumerating them is what
breaks large firms. Each returned row is a **Fund** or **GP** entity with its `fund_uuid`, name, and type.
**Capture the result to `<raw_dir>/_enumerate.ndjson` with `save_query_result.py`** — the emitter fills every
fund-filtered stem's IN-list from its `fund_uuid` column, so nothing SPV is ever fetched, and `build_datadir.py`
seeds the fund universe from it (a fund with holdings but no NAV close is kept, with its NAV-derived fields null →
"—"). GP entities stay in the enumeration (their `fund_uuid`s scope the GP-carry / GP-partner stems), but
`build_datadir.py` keeps **only `Fund`-type entities in `snapshot.funds[]`** — a GP LLC's capital is its paired
fund's GP commitment (surfaced as that fund's `gpCommit`), so listing the GP entity as its own fund would
double-count it in the LP-NAV-by-fund chart and firm rollup. Disambiguate the firm with AskUserQuestion; also
accept a pasted firm URL / UUID.

**Firm overview row** (per entity) = `{ id, name, type, vintage, committed, called, pctCalled,
distributions, nav, dryPowder, tvpi, dpi, rvpi, grossMoic, netIrr, mgmtFees, numInvestments }` assembled
from queries 1 (AGGREGATE_FUND_METRICS) + 2 (MONTHLY_NAV_CALCULATIONS). Sum/rollup into `totals`.

## 1. Fund metrics / dry powder  → `AGGREGATE_FUND_METRICS`
See §12, the `fund_metrics` stem.

## 2. NAV / committed / called / distributions (+ series) → `MONTHLY_NAV_CALCULATIONS`
This is the **`nav_latest` stem** — the builder's headline per-fund row. The SELECT must carry **all** columns
`build_datadir.py` reads for each fund, or the Overview renders **$0 for every fund**: `fund_uuid, fund_name,
entity_type_name, cumulative_commitment_amount, cumulative_lp_contributions, cumulative_lp_distributions,
ending_lp_nav, ending_gp_nav, lp_dpi, lp_rvpi, lp_tvpi`. Use the real **`cumulative_lp_distributions`** column
(NOT `cumulative_total_distributions` — the two diverge on GP/manager entities, where *total* includes non-LP
distributions and would overstate LP DPI/distributions). `cumulative_gp_contributions` is also carried: it feeds
`snapshot.funds[].gpCommit` (the GP paid-in co-investment) as a fallback when the `gp_partners` stem (§9) records no GP-partner commitment.
SQL: the `nav_latest` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem nav_latest`).
→ `snapshot.funds[].{committed,lpPaidIn,lpDistributed,overviewLpNav,gpCapitalNav,lpDpi,lpRvpi,lpTvpi}` and
`snapshot.baseLpNav`. The firm NAV/TVPI **trend** (`navSeries`) comes from the §5 cashflows stem, not here.

## 3. Per-deal baseline (scenario rows) → `AGGREGATE_INVESTMENTS`
`fund_uuid` **must** be in the SELECT (the builder keys each holding to its fund; omit it and every company is
dropped → empty Companies tab). Group by it too so one query covers the whole firm. `entity_link_id`
is the cap-table bridge key — resolved to a corporation via the §16 `corporations` stem, replacing the
display-name/alias join. `general_ledger_issuer_id` is also carried for GL-side reconciliation.
SQL: the `investments` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem investments`).
`asset_name` (the specific security, e.g. "Series E-2 Preferred") and `count_remaining_shares` (the fund's
share holding in that security) are the join keys the §15 cap-table stem uses to make the liquidation-preference
waterfall **fund-specific** (which classes the fund holds, and how many shares).

`latest_fmv_effective_date` (last revaluation) and `latest_update_effective_date` (last touched) are the real
"Mark date" / stale source — `MAX()` across a company's lots; the builder falls back to `investment_date` when null.
→ one `deals[]` row per company: `id` (slug of issuer_name), `name`, `invested`=total_cost,
`fmv`=remaining_value, `realized`=total_proceeds, `status` (Active/Realized from is_active),
`moic`=(remaining_value+total_proceeds)/total_cost. Aggregate multiple asset rows per issuer.
**Pull ALL companies — do NOT filter on `is_active_investment`.** A company is **realized/exited** when
`is_active_investment = FALSE` (no remaining value, `total_proceeds > 0`): write it to `portfolio.companies`
with `realized: true`, `proceeds` (= total_proceeds), `includeInNav: false`, and position `cartaFv: 0`. The
Companies view renders these as **read-only** cards (no tape — the exit is crystallized) behind a "Show
realized" toggle, and they stay inert in NAV/reprice/concentration math. Their distributions are already in
the fund's DPI (§2/§5), so do not re-add proceeds to fund totals.

## 4. Per-company fund ownership % → `FUND_CORPORATION_OWNERSHIP`
Column semantics (verified): `PERCENTAGE` (TEXT) is the ownership **fraction** (0–1, e.g. `0.0578…`; it is
often `0E-39` = 0 → treat as missing). `FULLY_DILUTED` (NUMBER) is a **fully-diluted share count, NOT a
fraction** — never use it as ownership %. There is **no** `ownership_pct_calc` column.
SQL: the `ownership` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem ownership`).
→ ownership fraction = `CAST(PERCENTAGE AS FLOAT)` when `> 0`, else unavailable. `markBasisB` (implied
company valuation) = `FMV / ownership_fraction ÷ 1e9` (**billions** — §3 mapping). `CORPORATION_ID` is
joined directly to the company that resolved to that `corpUuid` via the entity_link bridge
(`CORPORATION_BASIC_INFO_V2`, §16) — **no name matching**. A company whose `corpUuid` is null
(no entity_link, or no corporations-stem row) simply gets no ownership. If ownership is unavailable for a
company, **omit `markBasisB`** (it reprices in ×-multiple mode) — do NOT substitute a share count.
Also emit **`company-ownership.json`** = `{ companyId: { pct, asOf } }` (companyId = the company `id`,
i.e. `entity_link_id`) where `pct` is the firm's fully-diluted ownership **fraction** (0–1)
— sum `PERCENTAGE` across the firm's funds per corporation, `asOf` = latest `AS_OF_DATE`. Omit companies with
no cap-table record (e.g. unconverted SAFEs, or `PERCENTAGE = 0`) — the stat hides for them.

## 5. LP cash flows + firm NAV/TVPI trend → `MONTHLY_NAV_CALCULATIONS` (monthly series)
This is the **single canonical `cashflows` query**. `build_datadir.py` reads ONE `cashflows` stem and derives
BOTH the per-fund LP flows/IRR **and** the firm NAV & TVPI trend chart from it, so the SELECT must carry all
**seven** columns the builder reads (`build_datadir.py`, `build()` cashflows loop). A query missing `fund_uuid`
drops every row (`if u not in funds: continue`); one missing `ending_lp_nav` / `cumulative_*` renders the
Overview NAV chart at **$0**. Firm-level `JOURNAL_ENTRIES.amount` nets to zero when summed (double-entry), so
these per-month LP columns are the right source.
SQL: the `cashflows` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem cashflows`).
**Do not** add `AND (lp_contributions <> 0 OR lp_distributions <> 0)` to this local stem — the builder needs every
month-end row for the NAV trend (it filters zero-flow months for IRR internally). The hosted app's own
`cashflows` variant does filter; see "Hosted variants". Save to `<raw_dir>/cashflows.ndjson` (large →
use `"format":"ndjson"` then `save_query_result.py`; see the intro + SKILL Step 2).
→ `cashflows[fundId].flows[]`: one entry per month, `amount = lp_distributions − lp_contributions` (LP-net:
negative when contributing, positive when distributing). `paidInTotal` = cumulative LP contributions (§2).
`netLpIrr` = `xirr(flows + {date: navAsOf, amount: endingLpNav})`; suppress it for funds whose first flow is
< ~1 year before navAsOf (annualizing a few months explodes). `snapshot.navSeries = [{date, nav, tvpi}]` is
summed across funds at quarter-ends, `tvpi = (Σ ending_lp_nav + Σ cumulative_lp_distributions) / Σ
cumulative_lp_contributions` → the Overview NAV & TVPI trend chart.

## 6. Fund terms (carry / preferred return / GP catch-up) → `PROFIT_ALLOCATION_WATERFALL_CONFIG` → `waterfall`
Per-fund profit-allocation waterfall config — the canonical **carry rate**, **preferred return** (hurdle) and
**GP catch-up**, sourced from the fund's profit-allocation config in the DWH (per the table's own
DWH description). **This is read over the MCP.** A fund can have multiple configs (partner-class or
side-letter variants); each is a row. `build_datadir.py` keeps the recommended (rank-1) config and seeds
per-fund carry/pref/catch-up; a fund with no automated waterfall legitimately returns 0 rows and falls back to
the flat `carryRate` default (0.20) with pref/catch-up disabled.
SQL: the `waterfall` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem waterfall`).
Rates are decimals (`0.30` = 30%). Optional stem — record an empty file (`fm_paths.py touch-empty "<raw_dir>/waterfall.ndjson"`) when a
firm has no automated waterfall so the fetch gate passes.

**GP commitment ($) for the Returns GP-returns table → the `gp_partners` stem (§9).**
`build_datadir.py` derives `snapshot.funds[].gpCommit` from the GP partners' summed `commitment`
(`PARTNER_DATA.TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT` where `IS_GENERAL_PARTNER = TRUE`) — the same figure the
fund's profit-allocation config exposed, and materially more complete (populated for funds that config left
blank). When a fund records no GP-partner commitment, `gpCommit` falls back to the GP's paid-in
(`nav_latest.cumulative_gp_contributions`); null only when neither exists (app shows "—"). **Never** substitute
a modeled estimate (e.g. `committed/99`). The distribution / GP-contribution / hurdle *calc-type* metadata that
config also returned is not consumed by the app, so it is intentionally dropped.

## 7. Accrued carry today (real, from Carta books) → `ALLOCATIONS`
Carried interest accrued is booked as a reallocation: it nets to zero across all partners, so take the
**GP side** (`IS_GENERAL_PARTNER = TRUE`) as the GP's accrued balance.
SQL: the `accrued_carry` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem accrued_carry`).
→ `snapshot.baseAccruedCarry[fundId]` and `snapshot.gpEconomics[fundId].accruedCarryToday` = the GP-side
sum (the carry standing on Carta's books at today's marks). `snapshot.accruedCarryAsOf` (and per-fund
`gpEconomics[].accruedCarryAsOf`) = `MAX(EFFECTIVE_DATE)` — accrual is booked quarterly, so this is often a
quarter-end earlier than navAsOf; label it as such. Surfaced in the **GP returns** "Accrued Carry Today"
callout, and consumed by `src/model/reprice.js` for the LP-vs-carry uplift split — so it must be the real
booked number, not 0. Funds with no accrual return $0.

**Carry DISTRIBUTED (realized).** The realized counterpart is the `'Carried interest earned'` bucket — carry
actually paid out to the GP (vs. `'Carried interest accrued'`, which is unrealized). Same GP-side pattern; save
as the `distributed_carry` stem (columns `fund_uuid, carry_distributed, as_of`):
SQL: the `distributed_carry` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem distributed_carry`).
**Sign convention (important):** unlike accrued carry (booked **positive**), realized `'Carried interest earned'`
is booked on the GP side as an **outflow — negative** `ACTUAL_AMOUNT` (the GP capital account is relieved when
carry is paid), exactly like LP distributions. So take `ABS(SUM(...))` — the realized carry paid to the GP is a
positive magnitude. (The builder also `abs()`-es defensively.) Without this, high-DPI funds that have long since
paid carry — e.g. a fund at 7× DPI — read `$0`/"—" because the raw sum is negative and the UI only shows `> 0`.
→ `snapshot.gpEconomics[fundId].carryDistributed` (+ `carryDistributedAsOf`). Surfaced in the **GP returns**
"Carry distributed · Carta books" callout below the table; **genuinely $0 → the card shows "—"** (no carry
distributed yet). Do **not** confuse a general GP-side `'Distribution'` bucket (return of GP capital, etc.) with
realized carry — only `'Carried interest earned'` is carry.

## 7b. GP partner-level carry (real, from Carta books) → `ALLOCATIONS` → `gp_carry`
Per-GP-partner accrued carry, for the GP Economics **GP partner carry** table. `'Carried interest accrued'`
is booked at three levels in `ALLOCATIONS` — at the **Fund** (GP side `+`, LP side `−`), and again **inside the
GP entity** (`ENTITY_TYPE_NAME = 'GP'`) where it is split among that GP's members. The GP-entity rows are the
per-partner split; they sum to the firm's total accrued carry. We map each GP entity back to its LP fund via
the **fund-level** GP allocation (`GP_ENTITY_NAME` on the `Fund` rows = the GP-entity name = `FUND_NAME` on the
`GP` rows), so the per-partner carry lands on the right `fund_uuid`. Save as the `gp_carry` stem (columns
`fund_uuid, fund_name, gp_entity_name, partner_name, partner_type, accrued_carry`):
SQL: the `gp_carry` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem gp_carry`).
→ `gp-base.json[fundId].partners[]` with each partner's `accruedCarry` (real booked) and `carryShare`
(`accruedCarry ÷ GP entity total`). The app applies `carryShare` to the fund's **scenario** GP carry, so
partner-level carry reacts to reprices deterministically. A GP entity may back **two** funds (e.g. a main fund
+ a sidecar/SPV); the per-partner carry is the same GP-entity pool, and the builder keeps only funds that are
in the dashboard (`uuid_to_id`), so no double-count. Optional stem: a firm with no GP-entity-level carry
allocations yields no rows → the GP partner carry table simply doesn't render. GP partner names are
confidential — they stay in the local data dir. Do **not** confuse with §7 (fund-level GP accrual total).

## 8. Cohort benchmarks (TVPI/IRR/DPI/MOIC percentiles) → `TEMPORAL_FUND_COHORT_BENCHMARKS`
This table is **denormalized and cross-firm-preaggregated**: each fund's own row already carries its peer
cohort's percentile marks (grouped by vintage / AUM bucket / entity type across *all* firms). It is **not**
row-scoped to the active firm context the way `COMPANY_FINANCIALS` (§14) is — you filter to your own
`fund_uuid`s and the peer stats come back on those rows, so there is **no wider context** that yields more.
The **newest** performance quarter is frequently not-yet-benchmarked (all percentile columns null), so fetch
a recent **window** (not just the latest quarter) and let `build_datadir.py` select, per fund, the most recent
quarter that actually has a cohort. `fund_uuid` and `performance_quarter_start_date` **must** be in the SELECT
(the builder keys on `fund_uuid` and picks by quarter).
SQL: the `cohort` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem cohort`).
→ `snapshot.benchmarks[fundId]`: `tvpi/dpi/moic = {p5,p10,p25,p50,p75,p90,p95}`, `irr = {p50,p75,p90}`,
`fundMoic = moic` (the fund's own MOIC, since `src/model/funds.js` doesn't compute fund MOIC), `cohortSize
= fund_count`. The builder picks the latest quarter whose cohort is populated; a fund whose every recent
quarter is null genuinely has **no published peer cohort** — the rail shows the empty state (only the fund's
own MOIC) and the build summary reports `benchmarksReason: "no_coverage_published"`. Always write the
`benchmarks` key (even if every percentile is null), since `funds.js` reads `snapshot.benchmarks[fundId]`.
Some firm roles cannot read this table — the query fails with Snowflake `Error in secure object`. If so,
**still write an empty `cohort.ndjson`** (`fm_paths.py touch-empty "<raw_dir>/cohort.ndjson"`) to record the attempt; benchmarks
degrade to the empty state (`benchmarksReason: "no_coverage_published"`) and the run proceeds. Do **not**
leave the file absent — `cohort` is a file-required stem, so a missing file hard-fails the build (the fetch
gate treats "no file" as "query never run"). An empty file is the correct signal for "fetched, none available".

## 9. LP base (limited partners) → `PARTNER_DATA`  → `lp-base.json`
SQL: the `partners` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem partners`).
Aggregate **by `partner_name` across funds** (an LP in several funds collapses to one row): sum
commitment/contributed/distributed/nav; `funds` = distinct fund count; `region` bucketed from
`partner_country` (else `partner_state`, else "Unknown"). Then `pct = commitment / Σcommitment`,
`unfunded = max(0, commitment − contributed)`, `dpi = contributed>0 ? distributed/contributed : null`.
→ `lp-base.json`: `{ asOf, totalCommitment, totalContributed, totalDistributed, totalNav,
byRegion:[{region,commitment,pct,count}], lps:[{name,partnerClass,partnerClassByFund,region,commitment,
pct,contributed,unfunded,distributed,nav,dpi,funds}] }` (sort lps by commitment desc, cap ~200). Feeds
the **LP Returns tab** all-partners table (per-LP table + by-region bars). `pct` is share of total
commitments, not per-fund cap-table ownership. Treat LP names as confidential — they stay in the local
data dir only.

**GP partners (`gp_partners` stem) — optional commitment enrichment for `gp-base.json`.** Same query as
above but `WHERE … AND IS_GENERAL_PARTNER = TRUE` (the `gp_partners` stem in `queries.json`).
This is now **secondary**: the GP Economics partner-carry table is driven by the **real per-partner carry
shares** from §7b (`gp_carry`), not by GP commitment. When present, `gp_partners` only enriches each partner
row with `commitment`/`contributed`; when absent the table still renders from `gp_carry` alone. `gp-base.json`
is keyed by the snapshot **fund id** (same key as `snapshot.gpEconomics`):
`{ "<fundId>": { gpEntity, totalAccruedCarry, totalGpCommit, partners:[{name, partnerType, accruedCarry,
carryShare, commitment?, contributed?}] } }`. Optional: absent when a firm exposes neither GP-carry nor
GP-partner rows, in which case the GP tab simply hides the partner-carry table. GP names are confidential —
local data dir only.

## 10. Per-deal IRR (company-level) → `TEMPORAL_DEAL_IRR`
SQL: the `deal_irr` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem deal_irr`).
→ per company, take the primary fund's latest `deal_irr`; write `portfolio.companies[].dealIrr`. **Sanitize:**
`0.0` → null (held-at-cost / no IRR), `≤ -0.999` → -1.0 (total write-off, shows -100%), `> 5` → null
(tiny/recent basis → unrealistic). Shown as a Deal IRR column on Companies and beside each holding in the
Overview concentration list.

## 11. Last priced round → `FINANCING_HISTORY`
**Scope this by the firm's portfolio `corporation_id`s.** Do **not** run it unscoped: `FINANCING_HISTORY` is not
firm-context-limited, so an unfiltered query returns cross-firm rows and the `LIMIT` can truncate before your
companies' rounds are reached. The scope is expressed as a **subquery** over the same ownership table §4 reads,
so this stem takes only `fund_uuid`s and needs no previously-fetched stem:
SQL: the `financing` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem financing`).
Do **not** replace that subquery with a pasted `corporation_id` list. It resolves to ~1,150 UUIDs on a mid-size
firm — too long for one call, so it has to be hand-chunked, and each chunk costs minutes of token emission.
§4's `QUALIFY` only dedupes to the latest `AS_OF_DATE` per `(CORPORATION_ID, FUND_ID)`, so the subquery yields the
same corporation set the ownership stem does.
→ `corporation_id` is joined directly to the company that resolved to that `corpUuid` via the entity_link
bridge (`CORPORATION_BASIC_INFO_V2`, §16, no name matching) and written to
`portfolio.companies[].lastRound = {round, postMoney, date}`. Shown in the Companies expand as context for
repricing. Only Carta-customer portcos (those with a resolved `corpUuid`) have rounds here, so coverage is
partial.

## 12. Fund metrics actuals → `AGGREGATE_FUND_METRICS`
This is the **`fund_metrics` stem**. Besides fees/opex/dry-powder it is the builder's source for the firm
**display currency** (`fund_reporting_currency` — omit it and currency labels render blank) and the
authoritative per-fund **vintage** (`vintage_year`/`vintage_date`, falls back to the cohort table, else "—").
SQL: the `fund_metrics` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem fund_metrics`).
→ `snapshot.fundMetrics[fundId] = {mgmtFees, opex, dryPowder}` (+ `source.currency`, per-fund `vintage`).
`total_moic` (the fund-total, **gross-of-carry** MOIC — value ÷ invested capital, before the LP/GP carry
split; distinct from net LP TVPI) → `snapshot.funds[fundId].grossMoic`, surfaced as the **Gross MOIC** column
on Overview and the Returns scorecard. Null when Carta reports none (e.g. a fund not yet deployed) → "—".
Surfaced in Reserves beside the per-fund
fee-load slider to ground the assumption in fees/opex actually charged to date.

## 13. NAV / TVPI trend → merged into §5
The firm NAV & TVPI trend (`snapshot.navSeries`) is derived from the **same single `cashflows` query in §5** —
`build_datadir.py` reads one `cashflows` stem for both the LP flows/IRR and the NAV trend. There is **no
separate `navSeries` stem** (the builder never reads one), so do **not** run a second query here: fetch §5
once, with all seven columns, and the trend is built from it. Kept as §13 only to preserve section numbering.
## 15. Cap table & liquidation preferences (optional) → `SUMMARY_CAP_TABLE` → `company.capTable` (embedded)
Per-share-class cap table **with liquidation-preference terms** — the source for the Companies-tab preference
waterfall. Corporation-filtered like §11 financing, scoped by the same ownership subquery — it takes only
`fund_uuid`s. Keep the latest snapshot per `(CORPORATION_ID, SECURITY_CLASS_ID)`:
SQL: the `captable` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem captable`).
**This is the heaviest stem.** `SUMMARY_CAP_TABLE` scans ~1.04M rows for a 15-fund firm before the `QUALIFY`
collapses it to ~5,200. Note also that the `20000` limit is silently clamped to **10,000** server-side, so a firm
with roughly double that share-class count truncates without warning.
Joined by `CORPORATION_ID` (a **UUID** — the same value §4 ownership and §11 financing carry; do NOT substitute
an integer id). `build_datadir.py` binds each company to its `CORPORATION_ID` via the §11 financing name bridge,
attaches the class stack, and matches the fund's holdings (§3 `asset_name` + `count_remaining_shares`) to
classes. The whole entry is **embedded on the company object** (`portfolio.json` companies →
`company.capTable = {available, hasPrefTerms, currency, classes, fundHoldings}`) — the Carta layer, like
positions — so the reprice/NAV model and the Companies UI read the same object (no side file).
The load-bearing preference columns: `SENIORITY` (stack rank), `MULTIPLIER` (preference multiple, e.g. 1×),
`PARTICIPATING_PREFERRED` (participating vs non-participating), `PREFERENCE_CAP` (participation cap),
`ORIGINAL_ISSUE_PRICE`, `CONVERSION_RATIO`, `OUTSTANDING_SHARES`, and `CASH_RAISED` (a `{currency: amount}`
object — **carry the currency through; never assume USD, never sum across currencies**). **Optional /
non-gating**: a firm whose portcos are not Carta cap-table customers yields an empty `captable.ndjson` and those
companies degrade to the flat (no-waterfall) reprice — write an empty file (`fm_paths.py touch-empty`) to
record the attempt, exactly like the other optional stems.

## 16. Corporation bridge → `CORPORATION_BASIC_INFO_V2`

Resolves each investment's `entity_link_id` to its cap-table corporation — the `corporations` stem
replaces the display-name/alias bridge (§11's fka/dba join) with a real id join. `CORPORATION_BASIC_INFO_V2`
is itself row-scoped to the active firm context, so the filter is belt-and-braces rather than load-bearing; it
stays because the manifest has no firm-context/no-IN-list mechanism. Scoped like §11 financing / §15 captable,
by the ownership subquery. Note the join key: this table's `corporation_uuid` **is** ownership's
`CORPORATION_ID`.
SQL: the `corporations` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem corporations`).
→ save to `<raw_dir>/corporations.ndjson`. Expect **fewer** rows than the corporation scope — only Carta
cap-table customers appear here (695 of 1,149 on a reference 15-fund firm). Optional / non-gating: a firm whose
portcos aren't Carta cap-table customers has no rows — write an empty file (`fm_paths.py touch-empty`) to record
the attempt, exactly like the other optional stems.

## 17. Fee schedules (optional) → `MANAGEMENT_FEE_SCHEDULES` → `fee-history.json`
Each fund's management-fee periods, so Fund Construction can start a new fund from a past fund's terms.
`fee_rate` is the annual rate on `calculation_base`; a waived period is written with a 0 rate. Optional: a
missing or empty `fee_schedules.ndjson` still builds, and the "start from a past fund" helper stays hidden.
SQL: the `fee_schedules` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem fee_schedules`).
→ `fee-history.json` `{ asOf, funds: { <fundId>: [{ order, name, start, end, rate, base, frequency, waived, minFee, fixedFee, currency }] } }`.

## 18. Market ranges for fees and expenses (optional) → `FUND_OPS_BENCHMARKS_V2` → `ops-benchmarks.json`
One row per cohort (vintage year x fund-size bucket): aggregate percentiles of lifetime-to-date management fees and
operating expenses as a share of fund size, and of legal, software and payroll costs as a share of contributions.
No fund or firm names. Cohorts too small to rank have NULL percentiles and are dropped. Optional, like §17.
SQL: the `ops_benchmarks` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem ops_benchmarks`).
→ `ops-benchmarks.json` `{ asOf, cohorts: [{ vintage, bucket, mgmtFees: {p10..p90, n}, opex, legal, tech, payroll }] }`.

## 19. Expense history (optional) → general-ledger expense accounts → `expense-history.json`
What each fund actually booked to its expense accounts, by account and calendar year, so Fund Construction can start a
new fund's expenses from the client's own spend (audit, administration, legal, tax, one-time launch costs).
Management fees are left out (they come from §17). Account types 6000 to 6999 are the expense accounts. `AMOUNT` can
be in the entry's own currency, so the fund's base-currency amount is used where it is set. Optional, like §17.
SQL: the `expense_ledger` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem expense_ledger`).
→ `expense-history.json` `{ asOf, funds: { <fundId>: [{ name, byYear: { "<year>": amount } }] } }`, biggest account first.

## 14. Portfolio-company financials (attempt-required) → `COMPANY_FINANCIALS`
Carta **Data Collection** financials (revenue / ARR / KPIs reported *by the portfolio company*) come from the
**base `COMPANY_FINANCIALS`** table (the legacy `COMPANY_FINANCIALS_LATEST` view is deprecated/empty). This is a
**required-attempt** stem — `build_datadir.py` hard-fails (exit 2) if `financials.ndjson` is ABSENT, so a rebuild
must run it EVERY time. It legitimately returns **0 rows** for a firm whose portcos don't report into Data
Collection — that's fine (write an empty file to record the attempt), but you may not skip the fetch. Fetch only
the latest actuals for the metrics the dashboard renders:
SQL: the `financials` stem in `queries.json` (`uv run scripts/emit_stem_sql.py --raw <raw_dir> --stem financials`).
The `QUALIFY` keeps the latest submission per data point (newest `as_of_date`, then `instance_id`).
`float_value IS NOT NULL` sits in the `QUALIFY`, after the ranking, so a blank latest submission drops the
point instead of surfacing an older value.
The `WHERE` mirrors `build_datadir.py`'s `METRIC_DEFS` matcher exactly (the same mnemonics, the same
`revenue` / `recurring revenue` name fallbacks, the same deferred/forecast exclusion) — the builder discards
every other row, so fetching them only burns DWH pages. `COMPANY_FINANCIALS` is one row per company × metric ×
period for the whole firm, so it is the one stem that outgrows the 10,000-row clamp on a large firm; without
this filter a firm with many custom KPIs can exceed even the 5-page (50,000-row) pagination cap. The `ORDER BY`
is required: offset paging is only stable over an ordered result. Add a metric to `METRIC_DEFS` → add it
here in the same change.
**`COMPANY_FINANCIALS` is row-scoped to the active firm context** — it returns *only* the firm you `SET_CTX`'d
in Step 1. Do **not** add a `firm_id`/`firm_name` filter: it is redundant with the context scope, and a value
that doesn't match the row's own `firm_id` silently returns zero rows. Rely on the Step-1 `set_context`. (This
scoping is also why a cross-firm `COUNT(*)` looks "empty" when run from a different firm's context — it is not
empty, it is filtered.)
Captured as the `financials` stem: it is in `queries.json` with no IN-list slot, so the emitter includes it
in the batch without substitution → `<raw_dir>/financials.ndjson`. The builder matches `legal_name` to the issuer-name slug and surfaces
revenue / ARR in the Companies expand. Coverage is **partial** — only portcos that report into Carta Data
Collection appear, and a company must also be a tracked holding to surface on its card; render only when present.

## Hosted variants → `queries.json` `hosted`
The hosted app (`server/worker.js`) runs the local `nav_latest`, `fund_metrics`, `cohort`, `ownership`,
`corporations`, `captable`, `waterfall`, `accrued_carry`, `distributed_carry`, `deal_irr`, `financing`,
`fee_schedules` and `ops_benchmarks` stems, each fund-scoped one scoped to the firm's funds through the §0
directory query (`ops_benchmarks` holds no firm data and has no scope). Only `nav_latest`, `fund_metrics` and the three hosted
queries below are required; any other one the user's role cannot read leaves its data out and the firm still loads. It reads every result as **one
10,000-row page**: it cannot page, and it rejects any result that reports `next_offset` rather than save a partial
snapshot. The one exception is `captable`: a cap table cut at the limit is left out whole and the firm still loads,
with no `company.capTable` (§15). Three queries are its own, each trimmed to fit that one page:
- `nav_history` — `MONTHLY_NAV_CALCULATIONS` at quarter-ends plus each fund's latest month only: the months its
  NAV trend keeps. Locally the trend comes from every month-end row of the §5 `cashflows` stem.
- `cashflows` — only months with a non-zero LP contribution or distribution, and only the flow columns: the
  dated flows behind net LP IRR (the NAV trend comes from `nav_history`). The local §5 stem keeps every month.
- `investments` — one row per lot, ungrouped, with `remaining_value_per_share`, which the hosted snapshot
  reads per lot. The local §3 stem groups by asset.
