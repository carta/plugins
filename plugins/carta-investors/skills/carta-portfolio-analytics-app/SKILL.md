---
name: carta-portfolio-analytics-app
description: >
  Spin up an interactive local web console for firm-wide PORTFOLIO-COMPANY ANALYTICS over
  Carta Fund Admin + Data Collection data — a read-only React app spanning operating
  KPIs, valuation, cap tables, risk and benchmarking. Five tabs: Overview (ranked,
  configurable investment-health table with filters and favorites); Company KPIs (a
  company × KPI pivot over time); Insights (quadrant, signals, benchmarks); Reporting
  health (completeness, data quality, what changed); and Custom formulas + covenants.
  Click any company name for its own one-page Company page (returns, cap table, peers,
  credit & leverage, data quality; PDF tearsheet). Surfaces EVERY KPI a company
  reports (revenue, ARR, EBITDA, headcount, custom KPIs…), not a fixed list. Invoke with a
  firm name, e.g. "portfolio analytics for Acme Ventures". For scenario modeling,
  repricing and exit/reserve planning use carta-fund-modeling.
argument-hint: "<firm name or Carta firm URL — required>"
version: 0.1.0
model: inherit
allowed-tools:
  - mcp__carta__welcome
  - mcp__carta__call_tool
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - mcp__carta__discover
  - mcp__carta_production__welcome
  - mcp__carta_production__call_tool
  - mcp__carta_production__set_context
  - mcp__carta_production__list_contexts
  - mcp__carta_production__discover
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__discover
  - Read
  - Write
  - AskUserQuestion
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/fm_paths.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/save_query_result.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/emit_stem_sql.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/save_batch_result.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/build_kpi_datadir.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/serve.py *)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.39.3</carta-plugin>

<!-- Carta investor tooling. React app (in-browser JSX transpile) fed by Data Collection KPIs. -->

# Carta Portfolio Analytics (portfolio-company analytics console)

Builds a firm's portfolio-company dataset from Carta — operating KPIs from **Data
Collection** (`COMPANY_FINANCIALS`), plus valuation, returns, and cap-table data from
**Fund Admin** when available — writes it to a local data dir as `kpi.json`, and launches
a prebuilt React app via `serve.py`. **The browser never calls the Carta MCP** — this
skill fetches the data; the server only serves JSON + the built app.

## No demo data — an Investment Firm Account is required
Never fabricate, synthesize, or fall back to demo data. Every dashboard runs
against **one real Carta Investment Firm Account's** Data Collection KPIs —
fetched fresh or served from a prior local cache.

**Always confirm the Investment Firm Account before doing anything else.** If the
invocation does not name a firm (or names one ambiguously), do **not** auto-pick and
do **not** silently open a cache — **prompt the user with `AskUserQuestion`**:

> **Header:** "Firm account"
> **Question:** "Which Carta Investment Firm Account should I build this dashboard
> for? (firm name or Carta firm URL)"
> Offer any locally-cached firms as options (from `list-dashboards`), plus an "Other"
> free-text path for a new firm name / URL.

Only proceed once a firm is chosen. This prompt is mandatory on every fresh
invocation that doesn't unambiguously name a firm — it is the first thing the user
sees.

## Launch order — cache-first, MCP-lazy
Launching a warm cache needs **no MCP**. Resolve the firm name and check the local
cache before touching any MCP; a fresh cache launches with no MCP call. Only a
build/refresh identifies the MCP and resolves the firm over it.

## Step 0 — Resolve identity + check the local cache
Run silently (no step narration). A pasted Carta firm URL/UUID → parse the id and
match caches:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/fm_paths.py" find-by-id "<parsed_id>"
```
A firm NAME → cache check (read-only; do not slugify yourself):
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/fm_paths.py" resolve "<firm name>"
```
- `snapshot_age_days=<N>` (**cache hit**) → greet, then launch (Step 4) on fresh
  (< 30 days); on stale, `AskUserQuestion` "Use cached (N days old)" vs "Re-fetch".
- `snapshot_age_days=none` with `suggested_match=` lines → did-you-mean picker.
- no hit → `list-dashboards`; if a firm was supplied and no plausible cache
  matches, go to **BUILD (Step 1)**; if none supplied and none cached, run the
  mandatory **Investment Firm Account** `AskUserQuestion` prompt (see "No demo data"
  above) and wait for a firm before doing anything else.

> **Greeting (single message):** "Welcome to Carta Portfolio Analytics. This builds a
> local web app to slice and dice your portfolio companies — operating KPIs from Data
> Collection, plus valuation, cap tables, and benchmarking from Fund Admin." Then one cache-status line: on a
> hit, "A cache for **\<Firm\>** already exists — reloading your dashboard." On a
> build, "First run for this firm — give me a minute to pull the KPI data and build
> the app."

**Authorization on cache launch:** a cache launch never re-touches Carta; a refresh
goes through live MCP auth (the natural re-check).

## Step 1 — BUILD: identify the Carta MCP + resolve the firm
Reached only on a build/refresh. Scan for a connected `mcp__<SERVER>__*` Carta
server; use its prefix for `list_contexts`/`set_context`/`call_tool`. None
connected → stop: "No Carta MCP is connected. Building needs one — connect the
carta-investors plugin's MCP. Cached dashboards still open without it."

**Classify the environment from the MCP server's name.** A name containing `test`/`sandbox`/`demo`/`preprod`/`preproduction` (case-insensitive) → `cartaEnvironment = "nonprod"`. Everything else — `carta`, `carta_production`, any other name, or an opaque UUID — → `"production"`. This is a customer-facing plugin, so the common case by volume is real production usage; an unrecognized identifier is far more likely a production connector we haven't named than a staff test session, and staff noise is filterable downstream. Carry `cartaEnvironment` to Step 3's `meta.json`.

Resolve the firm: `list_contexts {firm_name:"<typed name>"}` (always pass the name).
Parse **firm name** = leading text, **firm_uuid** = the hex UUID token. One →
use it; multiple → match/`AskUserQuestion`; zero → ask to re-enter.
`set_context {firm_id:<firm_uuid>}`. Capture the integer `#<digits>` as `firmId`
if present, else null.

Key the cache on the canonical name:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/fm_paths.py" resolve "<canonical name>"
```
Use its printed `slug`/`raw_dir`/`dashboard_dir` as the build target.

## Step 1b — How much history? (size probe, then ask only if it's big)
Before fetching, run the **§0b size probe** — one row, no paging. Then:

- **Under 25,000 rows** → fetch the **full history**, say nothing. Most firms land
  here (a firm with a few dozen portcos is ~13k rows, where a 3-year window would
  save under 12%). Don't tax a small firm with a question that doesn't matter.
- **25,000 rows or more** → `AskUserQuestion` **before** fetching:

> **Header:** "History"
> **Question:** "\<Firm\> has **\<row_count\>** KPI data points spanning
> \<first_period\>–\<last_period\>. How much should I load?"
> - **"Last 3 years (recommended)"** — faster to build; covers year-on-year
>   comparisons, the forecast backtest and covenant LTM tests. *(state the
>   approximate kept-row count)*
> - **"Everything"** — the full history; slower, and worth it for long-run trend
>   work.
> - *(free-text "Other" lets them name a different cutoff, e.g. "since 2020")*

Pass the chosen cutoff as `period_end >= '<since>'` in **§1 and §1b** (target period
only — never filter forecasts on `as_of_date`), then to the build:
`--since <YYYY-MM-DD>`. It is recorded in `kpi.json` as `source.since` and shown in
the app's sidebar.

**Two consequences to state when a window is applied**, because they are real:
- **"Started reporting" in the Coverage tab is suppressed** — with a window you cannot
  tell a genuinely new reporter from a company whose earlier history was simply not
  fetched. The app hides that panel rather than reporting a false positive.
- Forecast-accuracy and coverage history only reach back to the cutoff.

A cached dashboard records its window; **re-run and choose "Everything" to widen it**
(a widened window needs a re-fetch — the raw cache only holds what was pulled).

### Position KPIs on the KPIs tab

The KPIs tab's KPI picker is split in two: **KPIs** (what the company reports) and
**Position KPIs** (facts about the firm's stake — ownership %, gross MOIC, deal IRR,
cost, current value, proceeds, unrealized, implied valuation, price per share, post-money,
mark vs last round). Position KPIs render in their own **Current** column, not in the
period columns, because each is a single point-in-time value with no history.

Only KPIs with real data are offered, so coverage degrades honestly:
- a fund-admin firm gets the full list;
- a firm with **cap-table portcos but no fund admin** still gets **Ownership %** and
  **Post-money**, since both come from the cap table (§ `fdshares`);
- a pure Data Collection firm gets no picker at all.

**Ownership % needs the `own_pct` columns added to the `fdshares` query.** A dashboard
built before that change simply won't offer Ownership %; re-run the fetch for that firm
to pick it up. Everything else on the list works from data already cached.

### Qualitative KPIs

A company can report a **flag**, a **date** or **free prose** as a KPI — a
fundraising-required yes/no, a predicted cash-out date, a written note. These come
back in `string_value`, and `unit_type` types them:

- **Boolean** → parsed to 1/0, shown as the reported word. Sortable and rule-testable.
- **Date** → parsed to a real date, shown as reported, plus a numeric companion KPI
  `Months to <label>` (signed; negative = already past) so a covenant can test
  *"cash-out inside 6 months"*.
- **anything else** → display-only text; excluded from charts, growth and rankings.

They sort to the **top** of every KPI list and get their own **Qualitative KPIs**
card under the KPI snapshot on the Company page. The build summary reports `qualitativeMetrics` and
`qualitativeCompanies`. Forecasts stay numeric-only.

### Cap table (a card on the Company page, not a top-level tab)

Fetch §4 (`capstack`) to enable it. One read, no sub-tabs: a banner (fully diluted,
outstanding, authorized, cash raised, and — when preferred classes and a company value exist —
the preference stack, coverage and what is left for common), one share-class table carrying
both structure and the recorded rights (OIP, multiple, participating, dividend, preference),
option pools and convertibles, the liquidation stack, then **Holdings** — the fund-admin
Schedule of Investments with each fund's fully-diluted ownership, or the per-fund ownership
split alone for a cap-table-only firm. Each block hides itself when its data is missing, so a
firm with holdings but no cap table still gets Holdings. The same card also opens inline from
an Overview row's drawer.
There is **no top-level Cap table tab**: it rendered the same components as the Company
page's card, so it was retired and old `/captable` links redirect into the Company page.

When a company has no cap table the tab says why, from its `entityKind`: a Carta customer that has not shared it, a paper company, or a general-ledger-only issuer. The Overview table offers an **Issuer type** column and filter on the same field.

The named-shareholder register (`STAKEHOLDER_CAP_TABLE`) is **not** in the client-accessible
data set, so the app never fetches it — there is no per-holder or co-investor breakdown, and
the cap table is share-class level only.

Two things to know when running it:

- **Holdings come only from fund administration.** A fund-admin firm shows per-asset Schedule
  of Investments lines (from `holdings.ndjson`, already cached — no extra query). A firm
  without fund administration has none, so the "our holdings" panel shows nothing for it.
- **Duplicate corporations.** Duplicate cap tables for one company are merged by company id (the entity link); two corporations with the same display name (`Acme Corp` and `Acme Corp.`) stay separate because they have different entity links, so the builder keeps the most complete cap table only when duplicates land on one company's own id and prints a NOTE naming the companies affected.

The build summary reports `capTableCompanies`, `capTableClasses` and `soiCompanies` — check
them, and expect the cap table to be far better covered than the holdings detail.

## Step 2 — Fetch the KPI data → raw query files
All 10 stems (`funds`, `financials`, `forecasts`, `holdings`, `fdshares`, `deal_irr`, `capstack`, `holdings_history`, `entity_identity`, `corporation_links` — see `references/queries.md` for what each covers and powers) are **static SQL**: none of them filters on a hand-templated `fund_uuid` IN-list. `holdings`/`fdshares`/`deal_irr`/`holdings_history` reach fund scope through a `NOT ILIKE '%SPV%'` subquery over `MONTHLY_NAV_CALCULATIONS` (same shape as `funds`'s own query); `capstack` has no fund/firm column to filter on at all; everything else is scoped by `set_context`.

5 of the 10 stems — `funds`, `holdings`, `fdshares`, `deal_irr`, `capstack` — are light enough to batch into one `dwh__execute__queries` call, collapsing 5 serial per-stem model turns into one with no fund-UUID list ever hand-templated or emitted. `financials`, `forecasts` and `holdings_history` are deliberately kept OUT of the batch and fetched separately (step 5 below) because they are the large, heavily-paged time-series stems (`financials` alone can run several MB on a large firm), and bundling them into the same parallel batch as the light stems risks exceeding the MCP session/exec timeout — confirmed on a large firm where a batch of all stems failed but the light-stems-only batch completed reliably in about 45s. `entity_identity` is also fetched on its own rather than in the light batch, but for a different reason: it is small, not paged, but its `--verify-complete --unique-key entity_link_id` integrity check needs to run against its own result rather than a batch response shared with four other stems.

1. **Emit the batch:**
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/emit_stem_sql.py" \
     batch ${SINCE:+--since "$SINCE"}
   ```
   Prints a JSON array of batch objects — `{"batch":0,"format":"ndjson","limit":10000,
   "stems":[...],"queries":[...]}` — with `stems[i]` aligned to `queries[i]`. Only the 5
   light stems (`_BATCH_ORDER`) are in the batch — `financials`/`forecasts` are excluded and
   fetched separately in step 5. All 5 fit in the one batch (the cap is 10 queries per
   `dwh__execute__queries` call). `--since` has no effect on the batch (it only reaches
   `financials`/`forecasts` via their own `sql` calls in step 5); pass it when Step 1b chose
   a window regardless, so it is available for step 5.

2. **Issue it as ONE call:**
   ```
   call_tool({"name":"dwh__execute__queries","arguments":{"queries": <batch.queries>,
     "limit": 10000, "format": "ndjson", "response_mode": "inline"}})
   ```
   Pass `limit`/`format`/`response_mode` explicitly — the tool defaults to
   `limit:1000`/`format:markdown`, both wrong here, and `response_mode:auto`, which is the
   bug: for ndjson `auto` guesses whether the client accepts a binary blob from its reported
   name, and on the surfaces that guess wrong the result's `content[1]` blob is rejected
   client-side (`-32602 invalid_union`, "expected text"). The run then falls back to markdown,
   whose pipe-table parse is lossy for JSON columns. `response_mode:"inline"` forces the
   lossless single-text ndjson envelope, so the markdown fallback never triggers. The queries
   run in parallel server-side and return a positional JSON array, one element per query
   (`{index, total_rows, result}` or `{index, error}`). (The in-app refresh in
   `scripts/refresh.py` is the one place that passes `"blob"` instead: its client is always
   the Claude Code CLI, which persists the body to disk and hands the model a one-line ack,
   and it falls back to `"inline"` on its own if the blob shape is rejected.)

3. **Capture the whole batch into per-stem files — never hand-split or hand-author
   ndjson.** Two cases:
   - **Large result** → the harness persisted it and printed the absolute path in its
     result message ("Output has been saved to …") — pass that path directly.
   - **Small inline result** → Write the raw tool result verbatim to `<raw_dir>/batch.raw`,
     then pass that file.
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/save_batch_result.py" \
     <result_path> "<raw_dir>" --stems funds,holdings,fdshares,deal_irr,capstack
   ```
   It writes each stem's `<raw_dir>/<stem>.ndjson` — an empty file for 0 rows or a failed
   query, so the fetch contract's "the file must exist" still holds — and prints one
   status line per stem:
   - `<stem> N row(s)` — captured.
   - `<stem> 0 rows (empty file)` — genuinely empty for one of these 5 light stems.
   - `ERROR stem=<stem>: <msg>` — that one query failed inside the batch; re-run it as a
     single `dwh__execute__query` to surface the error, then capture with
     `save_query_result.py`.
   - `TRUNCATED stem=<stem> next_offset=<N>` — that stem hit the 10k page limit and is
     incomplete; page it (next step). Don't treat `TRUNCATED` as success.

4. **Page any truncated stem — singular, not batched.** Re-emit just that stem's SQL and
   fetch the next page with a single `dwh__execute__query`:
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/emit_stem_sql.py" \
     sql <stem> ${SINCE:+--since "$SINCE"}
   ```
   ```
   call_tool({"name":"dwh__execute__query","arguments":{"sql": <that SQL>, "limit": 10000,
     "offset": <next_offset>, "format": "ndjson", "response_mode": "inline"}})
   ```
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/save_query_result.py" \
     <result_path> "<raw_dir>/<stem>.ndjson" --append --verify-complete --unique-key "<key>"
   ```
   Repeat with `offset` = the newly reported `next_offset` until no `<stem>.ndjson.truncated`
   marker remains. Use the stem's `--unique-key` from the per-stem list in the **Fallback**
   note below (`holdings` → `fund_investment_key`, etc.) so a mis-tiled or short page fails
   the fetch rather than building silently.

5. **Fetch `financials` and `forecasts` — singular paged calls, kept OUT of the batch.**
   These are the two large time-series stems (see the rationale at the top of this step);
   they are never part of the batch, so fetch each from offset 0 using the exact same
   emit/call/save/page loop as step 4, starting cold instead of reacting to a `TRUNCATED`
   status:
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/emit_stem_sql.py" \
     sql financials ${SINCE:+--since "$SINCE"}
   ```
   ```
   call_tool({"name":"dwh__execute__query","arguments":{"sql": <that SQL>, "limit": 10000,
     "offset": 0, "format": "ndjson", "response_mode": "inline"}})
   ```
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/save_query_result.py" \
     <result_path> "<raw_dir>/financials.ndjson" \
     --verify-complete --unique-key "legal_name,mnemonic|name,frequency,period_end"
   ```
   Then repeat with `sql <stem> --append` at each reported `next_offset`, passing the same `--verify-complete --unique-key "legal_name,mnemonic|name,frequency,period_end"` flags on every paged call:
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/save_query_result.py" \
     <result_path> "<raw_dir>/financials.ndjson" --append \
     --verify-complete --unique-key "legal_name,mnemonic|name,frequency,period_end"
   ```
   until no `financials.ndjson.truncated` marker remains — same loop as step 4. `financials`
   is deduped by its own `QUALIFY` (latest `as_of_date` per
   `legal_name`/`mnemonic`/`frequency`/`period_end`), so it pages far fewer times in
   practice than the §0b size probe's raw `row_count` suggests — that count is over
   undeduped source rows, before the dedup collapses repeat submissions of the same
   KPI/period. 0 rows is fine for `financials` in particular: it may legitimately return
   0 rows when the firm isn't in Data Collection — save the empty file, build anyway, and
   tell the user their portcos don't currently report KPIs into Carta.

   Fetch `forecasts` the same way, but its `save_query_result.py` calls pass only `--verify-complete` (no `--unique-key`): forecasts keeps every vintage, so it has no unique key to check — only that the assembled row count matches the server's `total_rows`.

   Fetch `holdings_history` the same way too (paged, from offset 0), passing `--verify-complete --unique-key "_pk"` on every call — `_pk` is the table's unique row key, so the integrity check catches any mis-tiled or dropped page. It is **optional**: a firm with no fund administration returns 0 rows (save the empty file and build — the Company page's "SOI performance" card hides itself). `emit_stem_sql.py sql holdings_history` → `dwh__execute__query` → `save_query_result.py <result_path> "<raw_dir>/holdings_history.ndjson" --verify-complete --unique-key "_pk"` (`--append` on later pages). If the query errors in an environment that lacks the table, write an empty `holdings_history.ndjson` and proceed — do not block the build on it.

   Fetch `entity_identity` the same way (singular, from offset 0), passing `--verify-complete --unique-key "entity_link_id"` — `emit_stem_sql.py sql entity_identity` → `dwh__execute__query` → `save_query_result.py <result_path> "<raw_dir>/entity_identity.ndjson" --verify-complete --unique-key "entity_link_id"`. It is the company-identity bridge (`references/queries.md` §6): one row per portfolio company with its numeric Carta `corporation_id`, `corporation_uuid` and `is_carta_customer`. Attempt it always; 0 rows is legitimate — save the empty file and build (companies then keep typed fallback ids and `entityKind: null`). If `--unique-key entity_link_id` reports duplicates, the view returned rows with a NULL entity link; re-run the save without `--unique-key`, build, and expect `entityKind: null` for the affected rows.

   Fetch `corporation_links` the same way (singular, from offset 0), passing `--verify-complete --unique-key "general_ledger_issuer_id,corporation_id"` — `emit_stem_sql.py sql corporation_links` → `dwh__execute__query` → `save_query_result.py <result_path> "<raw_dir>/corporation_links.ndjson" --verify-complete --unique-key "general_ledger_issuer_id,corporation_id"`. It lists every Carta corporation each GL issuer is linked to (`references/queries.md` §7), so KPIs and cap tables that report from a corporation the entity link does not name still land on that company. A firm with no rows writes an empty file — the build still runs.

   - If any `save_query_result.py` page prints `INTEGRITY CHECK FAILED` and exits non-zero (a `<stem>.ndjson.integrity_error` sidecar appears), the paged fetch tiled incorrectly or dropped a page. **Do not build.** Delete `<raw_dir>/<stem>.ndjson` and its markers and re-fetch the stem from offset 0; if it fails again, stop and report the mismatch to the user rather than building a partial dashboard.

**Fallback — per-stem serial fetch.** If `dwh__execute__queries` is unavailable (`Unknown
tool` / `NotFoundError` on an older MCP), the ndjson call is rejected client-side, or
`save_batch_result.py` can't split the response (exit 2 — re-run with `--dump-shape` to
inspect the envelope), fetch the 5 light batch stems singly too, the same way step 5 already
fetches `financials`/`forecasts`: `emit_stem_sql.py sql <stem>` →
`call_tool({"name":"dwh__execute__query", "arguments": {"sql": <that SQL>, "limit": 10000,
"format": "ndjson", "response_mode": "inline"}})` → `save_query_result.py <result_path>
"<raw_dir>/<stem>.ndjson"`. Same pagination rules and the same 0-rows-is-fine-for-`financials`
guidance apply.

Pass `--verify-complete --unique-key "<key>"` on every page of each light stem (same as
`financials`/`holdings_history` in step 5), so a saved-rows vs server `total_rows` mismatch
fails the fetch instead of silently building on a short/duplicated stem. Per-stem keys:
`holdings` → `fund_investment_key`; `fdshares` → `corporation_id,fund_id`; `deal_irr` →
`issuer_name,fund_uuid`; `capstack` → `corporation_id,security_class_id`; `funds` →
`fund_uuid`. This matters most when a stem falls back to `format:markdown`: a JSON/VARIANT
column (`holdings.tags_json`) is re-joined safely by `save_query_result.py`, and the
row-count check is the backstop if any row still mis-parses.

## Step 3 — Build the data dir (deterministic — do NOT hand-write JSON)
Write `<raw_dir>/meta.json` = `{"name":"<canonical name>","slug":"<slug from Step 1>",
"currency":"<code, optional>","mark":{"text":"<≤3 initials>","bg":"<hex>","fg":"<hex>"},
"firmId":<carta_id|null>,"firmUuid":"<firm_uuid>","cartaEnvironment":"<production|nonprod from Step 1>"}`. Then:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/build_kpi_datadir.py" \
  --raw "<raw_dir>" --out "<dashboard_dir>" --meta "<raw_dir>/meta.json" \
  ${SINCE:+--since "$SINCE"}   # only when Step 1b chose a window
```
It writes `firms.json` + `kpi.json` and prints a one-line JSON summary
(metrics/companies/funds/periods). A firm with no Data Collection coverage yields
0 companies (a WARN, not an error) — the app opens to a clean empty state; tell the
user their portcos don't currently report KPIs into Carta.

## Step 4 — Launch
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/scripts/serve.py" \
  --data-dir "<dashboard_dir>" \
  --web-dir "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/webapp" \
  --src-dir "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-app/app/src" --detach
```
**Only when the session already carries `pk`** from `get_current_user` (a connected Carta MCP has it from bootstrap), append `--user-id <pk>` to the `serve.py` command so telemetry names a real user. Never call the MCP to get it, and never substitute the email or a placeholder.

Run with **Bash run_in_background**; read the printed `http://127.0.0.1:<port>/?t=<token>`
(also in `<dashboard_dir>/.port` + `.token`) and give the user that URL.

The app opens on the **Overview** tab — a ranked, configurable investment-health table over
every company. The **Company page** is the deep-dive surface, in three tabs — Summary
(risk & signals, KPI snapshot with each KPI's portfolio rank and a reporting-health status
line, qualitative KPIs, investment returns, valuation & last round, credit), Cap table
(cap table + SOI performance) and Forecast — with
notes under every tab; every card and tab stays on the page, a card with no data saying what
is missing and where it comes from, and **Download PDF** prints every tab as one tearsheet.
It's a second-level page, not a sidebar tab of its own — the sidebar lists five top-level
tabs (Overview, Company KPIs, Insights, Reporting health, Custom formulas), and the Company
page opens by clicking any company name (in the Overview table, a KPI row, etc.), with the
sidebar's **Company KPIs** row highlighting while it's open. A company page is still a
shareable URL: `/firm/<slug>/company/<companyId>[/<tab>]` — the optional segment opens that
tab (`summary`, `captable`, `forecast`); a card id from an older link opens its tab and
scrolls to the card.

After the URL, add one line: "The console opens on an **Overview** ranking of every company
and spans a **KPIs** pivot, **Coverage**, a **Portfolio** board (triage + **Benchmarks**),
and **Formulas** — click any company name for its own deep-dive page with a PDF tearsheet.
Use the **Update data** button (top bar / sidebar) to check each dataset's freshness and
refresh one dataset or all of them, or just say 'refresh data'."

## Refresh / edits
There are two ways to refresh, and they share the same downstream scripts:

- **In-app Update-data button (per-dataset).** The console's topbar/sidebar button opens a panel listing each dataset (Operating KPIs, Forecasts, Holdings & returns, Ownership & cap tables — see `scripts/datasets.py`) with its last-fetched time and a refresh button, plus **Refresh all**. Clicking one POSTs `/api/refresh` (`{}` for all, `{"datasets":[keys]}` for a subset); `serve.py` runs `refresh.py`, which spawns a **sandboxed headless `claude` subprocess** (allowed only `mcp__<prefix>__{welcome,set_context,call_tool}`, no Bash/Write, server-authored SQL) to fetch into the raw dir, streaming progress the app polls at `/api/refresh/status`. The user then clicks **Load new data** (`/api/refresh/apply`) to rebuild `kpi.json` and reload. `/api/capabilities` reports whether the button can run (a `claude` binary on PATH + a firm-id'd cache); when it can't, the panel shows freshness read-only and points at the chat fallback. Freshness is per-stem ndjson mtime, stamped into `kpi.json.source.datasets` + `source.builtAt` by the build. On an escalation (`needs_human`, e.g. a stem past 100,000 rows or an id-less cache) the panel falls back to the chat flow below. A full fetch lands in a `<stem>.ndjson.fetching` staging file and replaces the stem only once every page is in, so a fetch that stops short leaves the previous stem in place; a stem left with a `.truncated` or `.integrity_error` marker refuses to build until it is re-fetched. The refresh asks the DWH for `response_mode: "blob"`, so a 10,000-row page of `financials` (3–4 MB on a large firm) lands on disk and the model sees only an ack + path; every Carta MCP call it issues, including `welcome` and `set_context`, carries `_instrumentation_v2` (the server rejects calls without it, and the plugin hook doesn't run in the subprocess). The warehouse tables refresh every few minutes, and a refresh that lands mid-fetch shifts every later OFFSET page (on QED: 554 rows duplicated, 554 missed); the saver's integrity check catches that and the stem is fetched once more. The whole session is mirrored to `<raw_dir>/refresh.log` — read that first when a refresh fails.
- **Operating KPIs and Forecasts refresh incrementally.** Both time-series stems select `instance_id` (one submission = one instance; the ids are monotonic). A refresh reads the cached stem's max `instance_id` and fetches only `instance_id > <max>` — the submissions logged since the last pull — into `<stem>.delta.ndjson`, then merges: `financials` replaces by its dedup key (`legal_name, mnemonic|name, frequency, period_end`) keeping the row that wins the SQL's own order (`as_of_date`, then `instance_id`), so a restated period takes the newer figure; `forecasts` appends, since every vintage is kept. Zero new rows keeps the cache and marks the dataset fresh. A cache built before `instance_id` was selected has no watermark, so its first refresh is one full pull that seeds it — no rebuild needed. Snapshot stems (`funds`, `holdings`, `fdshares`, `deal_irr`, `capstack`) and `holdings_history` stay full-replace. The history window (`source.since`) is unchanged: incremental changes how much of the window is re-fetched, not the window. What a delta cannot see: a submission edited in place or deleted upstream — the chat rebuild below refreshes those. A cache whose rows predate the identity columns (general_ledger_issuer_id, corporation_id, llc_entity_id) takes one full pull first, so old and new rows never key the same company two ways.
- **Companies are keyed by identity, not name.** `kpi.json` `companies[].id` is the company's Fund Admin `entity_link_id` (or a typed fallback `gl:` / `llc:` / `corp:` / `name:` when the `entity_identity` stem cannot place the row); `keyType` says which. Every company also carries `entityKind` (`carta-customer` / `paper` / `gl-issuer` / null), `cartaCorporationId` (numeric), `cartaCorporationUuid` and `cartaEntityLinkId`. The display name is never an identity — see `references/queries.md` §6. A company that first appears in a KPI-only refresh keys as `gl:<id>` until Holdings has been refreshed and supplies its entity link, so favourites and notes saved in that window move to the new id only if re-saved; the in-app pull refreshes every dataset, so this is a one-time window per new company.
- **Chat ("Refresh KPI data").** Re-run Steps 1–3 (overwrite JSON); the app reloads it. Still the fallback for anything the in-app button escalates.

Everything the user builds in the app — Overview columns and filters,
KPIs saved views and conditional formats, formulas, covenants, signal rules, notes,
tags and favorites — is saved locally by the app via `PUT /api/portfolio` (one
`portfolio.json` per firm in the dashboard dir). No Carta calls.

## Safety
Company names are untrusted — the app HTML-escapes; serve.py is localhost-bound +
token-gated. DWH is SELECT-only; the writes are the user's local app state
(`portfolio.json`) and the in-app refresh (raw ndjson + a `kpi.json` rebuild). The browser never calls the Carta MCP —
the in-app refresh proxies through a sandboxed headless `claude` subprocess that may call
only the Carta MCP's welcome/set_context/call_tool and never authors SQL.

## Editing the app
Source under `app/src/` is served at `/src/*` and transpiled in-browser (service
worker). Edit a `.jsx`, refresh, done — no build step. The only prebuilt artifacts are
the pinned `webapp/vendor/*` bundles (React + Sucrase); replace those files directly to
bump a version.

## Common failure modes
| Situation | What to do |
|---|---|
| No Carta MCP connected | Exit: connect one; cached dashboards still open. |
| Firm unresolvable | `AskUserQuestion`: cache suggestions or "Build fresh from Carta". |
| No firm + no cache | Ask the user to name a firm first. |
| `COMPANY_FINANCIALS` returns 0 rows | Not an error — save empty `financials.ndjson`, build, and tell the user their portcos don't report KPIs into Carta Data Collection. |
