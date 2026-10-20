# CTC dashboard — data fetch reference

Every call goes through the Carta MCP. The **browser never calls the MCP** — the skill fetches
here, writes raw JSON, and `build_datadir.py` transforms it into the console schema.

All commands are **read-only**. The `compensation:*` namespace exposes no write commands, so
this dashboard displays CTC data and models locally; it never mutates anything in Carta.

---

## §0 — Resolve the corporation

Follow the resolution order in `carta-compensation-benchmarks/SKILL.md` (numeric id in the
prompt wins; then name search via `list_accounts`; then single-account auto-select; then ask).
Only ever act on a `corporation_pk` that appears verbatim in a `list_accounts` response.

## §1 — Subscription gate (REQUIRED, before anything else)

Run the gate in `${CLAUDE_PLUGIN_ROOT}/references/gate-ctc-subscription.md`: the call, the
once-per-conversation rule and its outcomes live there.

A corp with no subscription has no benchmark data, so every later call is wasted.

## §2 — Plan (REQUIRED — peer group + benchmark version)

```
read_tool({"name": "compensation__get__plan",
           "arguments": {"corporation_id": <corporation_pk>}})
```

Save the whole response to `<rawdir>/plan.json`. The builder reads:

- `benchmark_version.{id, version_major, version_minor, created}` — `id` pins §3; `created`
  supplies the release month in the attribution.
- `peer_group.{code, label, dimension, notional_available}` — **required.** `dimension` is one
  of `post_money | capital_raised | headcount` and selects BOTH the bucket param in §3 AND the
  attribution phrasing. `build_datadir.py` refuses to build on any other value.

> Many corps are `capital_raised` or `headcount`. Hardcoding "post money" produces a wrong
> citation and numbers that don't tie out with the product UI.

## §2a — Filter options (REQUIRED, right after the plan)

```
read_tool({"name": "compensation__get__filter_options",
           "arguments": {"corporation_id": <corporation_pk>,
                         "benchmark_version_id": <plan benchmark_version.id>}})
```

Save the whole response to `<rawdir>/filter_options.json` (capture it as in §2b). It is the one
source for every filter value the later calls send and every label the dashboard shows:

- `params.job[].{value, label, levels}` — the job areas the API accepts and the levels each supports.
- `params.level[].{value, rank, ic_label, manager_label, executive}` — `rank` orders levels
  low to high (compare it, never display it); `ic_label` / `manager_label` are role codes such as
  `IC 4` / `MGR 4`, not product names; `executive: true` marks the executive levels.
- `params.{post_money,headcount,capital_raised}_bucket[].{value, label}` — only the buckets this
  version supports, low to high.
- `params.equity_quantity.{default, values}`, `params.industry`, `params.score` and the percentile lists.
- `coverage[]` — a LIST keyed by `job`: its `industries`, its `focuses` (`{focus, industry}`)
  and the percentiles it has data for. A job in `params.job` with no `coverage` entry has no
  benchmark data for this version.

Stop if `benchmark_version.id` is not the plan's `benchmark_version.id`: the lists describe another
release. Call it again with `benchmark_version_id` whenever you query a different version.

Send `value` fields verbatim. Map the user's wording to a job `value` through its `label`, and to a level `value` through
the role codes; when nothing matches, ask the user with the labels as written. A rejected value
comes back as HTTP 400 pointing at this command: compare what was sent with this payload, resend
the listed value once, then stop and report.

## §2b — Capturing results

**Never hand-copy an MCP response into a raw file.** On the bulk exports that take it —
`compensation:export:benchmarks`, `compensation:export:scorecard` and
`compensation:export:equity-refresh-report`, the only three commands with blob delivery — ask
for `"response_mode": "blob"` (see the capture contract in SKILL.md Step 2) and pass the path
your client saved. Every other command, `compensation:get:*` included, reaches disk by the path
the harness saved a large result to, or by the file `capture_export.py` wrote. Either way the
path goes through the normalizer:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" <captured_or_saved_path> "<raw_dir>/<name>.json"
```

It unwraps whatever shape the transport used — a bare payload, an MCP content-block list, a
base64 `resource.blob`, a string-valued `result`/`text` (the large-result path), or a short
preamble before the JSON — and writes the plain payload the builder expects.

Branch on its stdout sentinel:

| Output | Meaning |
|---|---|
| `captured (N rows)` | Good. |
| `captured (non-row payload)` | A plan / subscription response — expected, no row count. |
| `EMPTY (0 rows)` | Valid but empty: this corp has no data for that job area. **Not a failure** — the job simply won't appear in the grid. |
| exit 2 | No usable payload found. It prints what it saw; fix the call and re-fetch. Do not proceed with a missing file. |

The exit-2 refusal matters: writing a transport wrapper verbatim would give the builder one junk
"row" and silently produce a near-empty dashboard.

## §3 — Benchmarks (paged bulk export)

**Job areas** are `params.job` from §2a. The sweep covers every one of them; their count is the
`total_job_areas` each page reports.

Fetch them via `compensation:export:benchmarks` — a bulk **columnar** export that returns several
job areas' full matrices (every level, both ladders) in one response, replacing the old
one-call-per-job-area sweep:

```
read_tool({"name": "compensation__export__benchmarks", "arguments": {
  "corporation_id": <corporation_pk>,
  # "jobs" OMITTED on the first call — sweeps every area, a page at a time.
  # To page explicitly: "jobs": ["ENGINEER", "SALES", ...] (repeated keys on the wire),
  # or omit "jobs" and pass "job_offset" / "job_limit" to move the window.
  "benchmark_version_id": <benchmark_version.id>,
  "<dimension>_bucket": "<peer_group.code>", # EXACTLY ONE bucket param
  "equity_quantity": "FOUR_YEAR_GRANT",      # REQUIRED
  "response_mode": "blob"                    # payload goes to a file, not into context
}})
```

**Response shape** — a single `columns` header (once) plus one flat value array per row, in
`columns` order, with paging and hoisted fields alongside:

```
{
  "columns": ["job", "ladder", "level", "focus", "currency", "sal_low", ..., "eq_p90_nv"],
  "rows": [[<value>, <value>, ...], ...],
  "row_count": N,
  "jobs_covered": ["ENGINEER", "DESIGN", ...],   # areas this page actually returned rows for
  "jobs_empty": ["SALES", ...],                  # areas this page covered but had no data
  "job_offset": 0,
  "total_job_areas": 22,
  "next_job_offset": 12,                          # null on the LAST page
  "geo_adjustment": {"label": "...", "salary_scalar": "...", "equity_scalar": "..."},
  "benchmark_version": {"id": ..., "version_major": ..., "version_minor": ...}
}
```

**ZIP `columns` against each row — never assume positions.** Appending a column is a safe,
backward-compatible change; reordering or removing one is not, so a caller that assumed
positions would silently misread every field. Values are JSON **numbers**, not the decimal
strings `get:benchmark` returns (`"96000.00"` → `96000`) — formatting is the client's job.
`geo_adjustment` and `benchmark_version` are hoisted to the response (identical across every row
of one call, since geo applies per-request) rather than repeated per row.

**PAGING IS THE DEFAULT — this is the one rule that matters most.** A call that omits `jobs` and
`job_limit` returns the **first page**, not the whole matrix — there are `total_job_areas` job areas and the
server caps one response at 12 of them. **Omit `job_limit`** so you get that full page; the full
matrix is then `total_job_areas` ÷ 12 pages, rounded up. Keep calling with `job_offset` = the previous response's
`next_job_offset` until that field comes back `null`; `total_job_areas` says how many areas exist
overall. Treating one response as the complete cube would silently publish 12 job areas as
if it were everything. An explicit `job_limit` above 12 is a **400 error**, not silently clamped —
so a truncated sweep can never look complete by accident.

**On the inline fallback, where you set `job_limit: 6` yourself, the offsets are known up front**
— 0, 6, 12, 18 — so those four pages are fetched in parallel, one subagent each, instead of
following the cursor. Completeness is then proved from the captured pages: the union of every
page's `jobs_covered` + `jobs_empty` must equal `total_job_areas`, and `export_pages.json` must
report `sweep_complete: true`. See SKILL.md Step 2c-ter.

Capture each page per the capture contract in SKILL.md — request `"response_mode": "blob"` and
pass the path your client saved to `save_benchmark_result.py --export-page`, which fans the
page out into one `<rawdir>/benchmark_<JOB>.json` per job area it covered. Where the MCP has no
blob delivery, `capture_export.py sweep` does the whole sweep instead: it pages for you and
writes the same files. **Never call the export yourself and write the response out.**

**Batching rules — these are load-bearing:**

| Approach | Result |
|---|---|
| `compensation:export:benchmarks` with `job_limit` omitted and `"response_mode": "blob"`, following `next_job_offset` to `null` | ✅ one call per 12 job areas for the full matrix. **Use this.** |
| One call per job area via `compensation:get:benchmark` | ❌ one call per job area — this is the pattern the export command exists to replace; do not fall back to it, even to route around a failing export call. |
| One call per (job, level) row | ❌ one call per row, hundreds in all. This is what the Cowork artifact does per row. |
| Explicit `job_limit` above 12 | ❌ 400 error, not clamped. |
| `capture_export.py sweep`, no `response_mode` | ⚠ the headless-session route for an MCP that rejects `response_mode` — the script makes every call and writes the pages itself, so no payload passes through a conversation. Needs the `claude` CLI. |
| `job_limit: 6` with no `response_mode` | ⚠ the inline fallback when there is no `claude` CLI either — 4 pages at the fixed offsets 0, 6, 12, 18, run in parallel with one subagent per page, each reproduced into its own `.raw` file, and the figure check in SKILL.md Step 2f is mandatory before the build. See SKILL.md's capture contract. |

A full matrix is **one export call per 12 job areas** on the blob route, **one per 6** on the
inline fallback. Every call ceiling in SKILL.md is stated as a function of that page count.
Capture each page to disk (via `--export-page`) the moment it arrives, or let one
`capture_export.py sweep` make all of a sweep's calls — see SKILL.md Step 2c.

**`equity_quantity` is pinned to `FOUR_YEAR_GRANT`.** It is one of `params.equity_quantity.values`.
`params.equity_quantity.default` is the backend default (next-12-months vesting), not this
pin: it returns roughly a quarter of the value HR users expect, a hard tie-out failure against the
product UI, not a stylistic choice.

**Exactly one `*_bucket` param.** The three bucket enums are disjoint, so a code valid for one
is invalid for the others; passing two either 400s or silently picks one.

**Enums, not labels.** `job` is a `params.job[].value` (UPPER_SNAKE, `ENGINEER`); `focus` is a
focus name from `coverage[job].focuses` (`Web Engineer`, `AI and Machine Learning`), used
verbatim and case-sensitive — a lowercased or invented value silently returns the job-area blend.
Never combine them (`ENGINEER/Web Engineer` → 400). Valid values come from §2a.

**Locations — one sweep per location, never a computed one.** `location` takes one value per
call, in the product's format: `"City,ST,USA"` for a US metro, `"City,ST,CAN"` for a Canadian
one, `",,<ISO3>"` for a country. `ctc_locations.py` builds it from a geo label exactly as the
product does. `geo_adjustment` (label, `salary_scalar`, `equity_scalar`) is hoisted per
**response** for that one location; a call without `location` returns the default location,
San Francisco, at scalar 1.0. Verified on corp 7: `"Tulsa,OK,USA"` returns "Tulsa, OK" at 0.70,
`",,GBR"` returns "GBR" at 0.80 salary / 0.85 equity, in USD. Add
`"convert_to_local_currency": true` for an international market's local currency, as the
product's toggle does (`",,GBR"` then returns GBP).

`compensation:get:benchmark_locations` (`geo_adjustment_version_id` from the plan's
`benchmark_version.geo_adjustment_version.id`) lists every supported location: 444 locally,
397 US and 47 international. Each entry's `location` is the value to pass here verbatim
(SKILL.md 2d-v).
Never derive a location by multiplying another location's figures by its scalar: the server
applies the scalar to the **unrounded** base, clamps it to the plan threshold, derives bands
from the adjusted mid and only then rounds, so scaling rounded figures drifts from the product
and the bands drift further.

## §4 — Build

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/build_datadir.py" --raw <rawdir> --out <dashboard_dir> --meta <meta.json>
```

`meta.json` = `{"corporation": "<name>", "corporationId": <int>}`.

Outputs `benchmarks.json`, `taxonomy.json` (from `filter_options.json`), `snapshot.json`. The builder refuses to write on a
bad peer-group dimension or zero benchmark rows rather than publish an empty dashboard.

## §5 — Launch

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/serve.py" --data-dir <dashboard_dir> --detach
```

Prints `http://127.0.0.1:<port>/?t=<token>` and opens the browser. Port and token persist in
the data dir, so relaunching the same corp reopens the same URL.

---

## Response shape notes

These notes describe the **nested** `benchmarks` shape that `compensation:get:benchmark` returns
and that `compensation:get:plan`'s response nests `benchmark_version`/`peer_group` inside.
The columnar `compensation:export:benchmarks` shape is documented in §3 above — it emits JSON
numbers rather than decimal strings, and `save_benchmark_result.py --export-page` reconstructs
the nested shape from it before writing `benchmark_<JOB>.json`, so `build_datadir.py` reads one
row shape regardless of which command fetched it.

Salary/TCC percentiles are **flat**; equity percentiles are **nested objects**:

```
salary_benchmarks.percentiles.p50              -> "164000.00"   (decimal STRING)
equity_benchmarks.percentiles.p50.as_shares    -> "24745"
equity_benchmarks.percentiles.p50.as_fd_percentage  -> "0.040"   (PERCENT number, i.e. 0.040 means 0.040%)
equity_benchmarks.percentiles.p50.as_notional_value -> "133000"
```

`build_datadir.py` normalizes both into `{p25..p90}` and
`{p25..p90}.{notional,shares,fdpct}`.

**Percentiles only.** The response also carries `low/mid/high` bands — those are the corp's own
target band, not market data. The dashboard drops them.

**Missing ≠ zero.** A percentile the API omits stays `null` through the whole pipeline and
renders as `—`.

## Future stems (not yet fetched)

The Scorecard / Reports / Plan Modeling tabs will need `compensation:get:employee-scorecard`
(note: invoked via `read_tool` as `compensation__get__employee-scorecard`, **not** via `fetch`) and, where commands don't exist
yet, new `compensation:get:*` endpoints for paybands and report data.

**Prefer `compensation:export:scorecard`** for the whole employee list: one columnar response
carrying every benchmarked employee, no paging and no overlap. It is staff-gated and refuses
above 200 employees, so the paged endpoint below remains the fallback.

Its columns include `tenure_start_date` and `tenure_end_date` (ISO, either may be null).
Note `tenure_end_date` is null on every row of every corporation reached so far — no
departed employee appears on a scorecard — so it is captured but nothing consumes it.

## §6 — Refresh planner

> **Released, staff accounts only.** `compensation:export:equity-refresh-report` is
> in carta-mcp's registry and callable today, but it carries `staff_only: True` —
> the same gate as `compensation:export:scorecard` and
> `compensation:get:employee-scorecard`. A non-staff caller gets a permission
> error, not an empty list, and that difference matters: reporting it as "no
> employees" would describe the corporation instead of the caller's access.
>
> The tab it feeds is a separate gate and still off by default — see the
> staff-preview note in SKILL.md Step 2e. Both have to line up for a staff QA
> build: the capture below AND the `preview.refreshPlanner` key.

```
compensation:export:equity-refresh-report
  generated tool name: compensation__export__equity-refresh-report
  arguments: { "corporation_id": <int> }
```

The equity refresh export returns one columnar response carrying every benchmarked
employee's equity holdings and vesting position, taking only `corporation_id`. This is
the data behind CTC's Equity Refresh Report at `/reports/equity-refresh/all-employees`,
and **the figures must tie out against that page**: pass them through unchanged, never
re-derive one.

Staff-gated. No paging and no filters — it returns every employee or refuses above the
row cap. Capture with `save_equity_refresh_page.py`, which refuses a partial sweep. SKILL.md
Step 2d-bis has the route for each case; these rows are employee equity holdings, so there is
no hand-written route for them on any route.

Columns, in wire order — the client zips these against each row's value array, so
the ORDER is the contract:

`external_id`, `stakeholder_id`, `full_name`, `job_title`, `job_area`, `job_level`,
`job_track`, `location`, `geo_adjustment`, `hire_date`, `total_vested_shares`,
`total_unvested_shares`, `date_of_final_vest`, `live_award_count`,
`four_year_grant_benchmark_num_shares`, `refresh_grant_num_shares`, `job_focus`,
`ntm_vesting`, `ttm_vesting`.

New columns are APPENDED for that reason, so read by zipping rather than by
position — a hardcoded index breaks on the next addition.

Five things a reader gets wrong otherwise:

* **There is no total-equity column.** The product computes "Total Shares Granted" as
  `total_vested_shares + total_unvested_shares` at render, so the console does the same
  addition rather than expecting a field.
* **`job_level` is an annotated level** — `IC 3`, `MGR 6`, `EX 10` — not a level code.
  The trailing number is the canonical rank and is shared across tracks (`IC 5` and
  `MGR 5` are both SENIOR2), so ordering by that number is correct across the whole
  ladder. `LEVEL_RANK` in `taxonomy.js` keys on codes and does not apply here.
* **`live_award_count` is null, not 0, when no equity was captured** for that employee.
  Cancelled and forfeited awards are already excluded server-side, so a non-null count is
  live holdings. Treating null as 0 would let a "has prior grants" filter include people
  it cannot judge.
* **`ntm_vesting` / `ttm_vesting` are FLOW, not stock.** Shares vesting in the next
  twelve months and vested in the last twelve — the amount moving through a window,
  never a balance at its edge. Reading either as an unvested total is wrong by
  roughly the length of the schedule. Same null rule as `live_award_count`, and
  here the zero carries the signal: an employee past their final vest has `0`
  vesting next year, which is exactly who a refresh cycle is looking for, while
  `null` means their equity was never captured.
* **Both are computed as of the request date**, unlike `total_vested_shares`. Two
  calls against an unchanged cap table can legitimately differ; never report that
  as a data error. And `ttm_vesting` counts events on securities the employee STILL
  HOLDS — cancelled awards are filtered upstream — so it is not a history of
  everything that ever vested, and must not be described as one.

`build_datadir` emits `planner.json` with an `availability` block (`tenure`, `equity`,
`vesting`, `grants`). Any false there means the corresponding filter is disabled in the
UI with a visible reason — equity is genuinely absent on corporations whose latest
scorecard run predates their equity ingest, and that is "not in this snapshot" rather
than "no equity".

⚠ The employee-scorecard endpoint oversizes at `page_size ≥ ~25` (verified: 30 fails on a
134-employee list with `response too large`; use **10**), returns **overlapping rows**
across pages (dedupe by `ids.external_id`), and its `score` filter keys on a **nullable**
overall band — so Low+Mid+High routinely sums to less than the roster total. Any roster sweep
must page in the script, dedupe, and gate on completeness before publishing.

## §7 — Equity pool (for the planner's Equity Pool tile)

```
cap_table:get:equity_pool_utilization
  generated tool name: cap_table__get__equity_pool_utilization
  arguments: { "corporation_id": <int> }
```

Returns:

```json
{
  "totalEquityAvailable": <int|null>,
  "totalReservedShares":  <int|null>,
  "fullyDilutedShares":   <int|null>,
  "usedShares":           <int|null>
}
```

**This is the same source the CTC product UI's Refresh Grant Planner "Equity pool
impact" panel reads** (`/api/corporations/<id>/manage-employees/retain/equity-pool-utilization/`
on carta-web). The endpoint makes a **live gRPC read** against the equity ledger
per request — no Redis cache in the request path, so no cache-warming ritual is
required. Values tie out against the product UI to the share.

Capture with `save_equity_pool_utilization.py`; the script derives `poolUsedShares`
locally when the wire didn't already include it, and enforces the same "null is
not 0" invariant `save_report_insights.py` does.

⚠ **`null` is not `0`.** If any field comes back null (unusual — the endpoint is
live) or a corporation legitimately reports no pools (sum of 0), the tile renders
its empty-state notice rather than "0 shares available".

### Why not `compensation:get:reports-insights.efab.*`?

That endpoint reads a **different** snapshot — compensation-service's Redis cache
of the equity ledger, warmed only by the out-of-band `SendCompensationOverviewNotification`
Celery task. Different denominators (scope filters), a stale cache, and its own
arithmetic mean its `efab.*` numbers can drift from what the product UI shows.
Use `reports-insights` for its `equity_refresh.num_employees` and
`cost_to_market.num_employees` counts — never for the pool tile.
