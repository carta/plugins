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

```
call_tool({"name": "compensation__get__subscription_status",
           "arguments": {"corporation_id": <corporation_pk>}})
```

`is_subscribed: false` → stop, surface the subscription message, fetch nothing.
`403` → the caller has no CTC role on this corp; stop.

A corp with no subscription has no benchmark data, so every later call is wasted.

## §2 — Plan (REQUIRED — peer group + benchmark version)

```
call_tool({"name": "compensation__get__plan",
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

## §2b — Capturing results

**Never hand-copy an MCP response into a raw file.** Every response goes through the normalizer:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" <result_path> "<raw_dir>/<name>.json"
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" - "<raw_dir>/<name>.json"   # or pipe via stdin
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

**Job area enums** (~22 — there is no `compensation:list:job_types` command, so this list comes
from the `export:benchmarks` / `get:benchmark` command help; re-read it via
`search_tools({"query": "compensation export benchmark"})` if a call 400s on an unknown value):

```
ACCOUNTING, ADMIN, CEO, CORPORATE_AFFAIRS, CUSTOMER_SUCCESS, DATA, DESIGN,
ENGINEER, FINANCE, HR, IT, LEGAL, MANUFACTURING, MARKETING, OPERATIONS,
PRODUCT, PROJECT_MANAGEMENT, RESEARCH, SALES, STRATEGY, SUPPORT, OTHER
```

Fetch them via `compensation:export:benchmarks` — a bulk **columnar** export that returns several
job areas' full matrices (every level, both ladders) in one response, replacing the old
one-call-per-job-area sweep:

```
call_tool({"name": "compensation__export__benchmarks", "arguments": {
  "corporation_id": <corporation_pk>,
  # "jobs" OMITTED on the first call — sweeps every area, a page at a time.
  # To page explicitly: "jobs": ["ENGINEER", "SALES", ...] (repeated keys on the wire),
  # or omit "jobs" and pass "job_offset" / "job_limit" to move the window.
  "benchmark_version_id": <benchmark_version.id>,
  "<dimension>_bucket": "<peer_group.code>", # EXACTLY ONE bucket param
  "equity_quantity": "FOUR_YEAR_GRANT"       # REQUIRED
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
`job_limit` returns the **first page**, not the whole matrix — there are 22 job areas and a call
that asks for too many **times out at 10s** before it reaches the ~300-row response cap. Always
pass `job_limit: 6` (4 pages for the full matrix). Keep calling with `job_offset` = the previous
response's
`next_job_offset` until that field comes back `null`; `total_job_areas` says how many areas exist
overall. Treating one response as the complete cube would silently publish 6 of 22 job areas as
if it were everything. An explicit `job_limit` above 12 is a **400 error**, not silently clamped —
so a truncated sweep can never look complete by accident.

Capture each page per the capture contract in SKILL.md (Case 3) — pass the persisted result path
(or a verbatim-written `.raw` file) to `save_benchmark_result.py --export-page`, which fans the
page out into one `<rawdir>/benchmark_<JOB>.json` per job area it covered. **Do not hand-copy
response bodies into that file yourself.**

**Batching rules — these are load-bearing:**

| Approach | Result |
|---|---|
| `compensation:export:benchmarks` with `job_limit: 6`, following `next_job_offset` to `null` | ✅ 4 calls for the full 22-area matrix. **Use this.** |
| One call per job area via `compensation:get:benchmark` | ❌ ~22 calls — this is the pattern the export command exists to replace; do not fall back to it, even to route around a failing export call. |
| One call per (job, level) row | ❌ ~374 calls. This is what the Cowork artifact does per row. |
| Explicit `job_limit` above 12 | ❌ 400 error, not clamped. |
| Omitting `job_limit` entirely | ❌ asks for every remaining area; ~17s against a 10s server timeout, so the call fails and returns nothing. |

A full matrix is **4 export calls** (22 areas ÷ 6 per page). Capture each page to disk (via
`--export-page`) the moment it arrives — see SKILL.md Step 2c.

**`equity_quantity` must be `FOUR_YEAR_GRANT`.** The MCP default is `NTM_VESTING`, which
returns roughly a quarter of the value HR users expect — a hard tie-out failure against the
product UI, not a stylistic choice.

**Exactly one `*_bucket` param.** The three bucket enums are disjoint, so a code valid for one
is invalid for the others; passing two either 400s or silently picks one.

**Enums, not labels.** `job` is UPPER_SNAKE (`ENGINEER`); `focus` is lowercase free text
(`backend`). Never combine them (`ENGINEER/BACKEND` → 400). There is **no**
`compensation:list:job_types` command — read valid values from
`search_tools({"query": "compensation export benchmark"})`.

**Location note — no bulk per-location scalar table.** `geo_adjustment` (with `salary_scalar` /
`equity_scalar`) is hoisted per **response**, for whichever single `location` param that call
passed — omitting `location` fetches the national baseline with no scalars at all. There is
currently no command that returns a scalar table across the ~400 supported locations, so an
offline location dropdown that recomputes geo-adjusted figures client-side is **not buildable
today** without either a ~400x fetch multiplier (one export sweep per location) or a new
compensation-service endpoint. Do not invent one — fetch once without `location` for the
national matrix this dashboard displays, and if a single location's scalars are ever fetched,
apply them in the order below.

**Client-side geo → bands → rounding order (when a location's scalars ARE available).** The
server applies the geo scalar to the **unrounded** national base, **then** derives low/mid/high
bands from the geo-adjusted mid, **then** rounds (equity to 4 decimal places, cash to the corp's
configured precision). Multiplying already-rounded, already-banded national percentiles by a
scalar drifts from the product UI, and the error compounds because the bands derive from the
geo-adjusted mid, not the national one. There is no shortcut ordering.

## §4 — Build

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/build_datadir.py" --raw <rawdir> --out <dashboard_dir> --meta <meta.json>
```

`meta.json` = `{"corporation": "<name>", "corporationId": <int>}`.

Outputs `benchmarks.json`, `taxonomy.json`, `snapshot.json`. The builder refuses to write on a
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
equity_benchmarks.percentiles.p50.as_fd_percentage  -> "0.0004"  (FRACTION, not percent)
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
(note: invoked via `fetch` with `params`, **not** `call_tool`) and, where commands don't exist
yet, new `compensation:get:*` endpoints for paybands and report data.

**Prefer `compensation:export:scorecard`** for the whole employee list: one columnar response
carrying every benchmarked employee, no paging and no overlap. It is staff-gated and refuses
above 200 employees, so the paged endpoint below remains the fallback.

⚠ The employee-scorecard endpoint oversizes at `page_size ≥ ~25` (verified: 30 fails on a
134-employee list with `response too large`; use **10**), returns **overlapping rows**
across pages (dedupe by `ids.external_id`), and its `score` filter keys on a **nullable**
overall band — so Low+Mid+High routinely sums to less than the roster total. Any roster sweep
must page in the script, dedupe, and gate on completeness before publishing.
