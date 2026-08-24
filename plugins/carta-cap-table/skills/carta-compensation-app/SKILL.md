---
name: carta-compensation-app
description: >
  Launch an interactive local web console for Carta Total Compensation (CTC) data — a React app
  served from localhost, fed by CTC benchmark data fetched once at build time. Today it ships the
  Benchmarks tab: the full salary / total-cash / equity percentile matrix (P25/P50/P75/P90) for a
  corporation, grouped by job area and IC/Manager/Executive track, with an equity representation
  toggle (notional / FD % / shares), and the Scorecard tab: per-metric market positioning
  (salary / total cash / equity) plus the per-employee roster with compa-ratios. Plan Modeling
  and Reports tabs are planned.
  Invoke with a corporation name or numeric id, e.g. "comp dashboard for Acme" or "open the CTC
  console for corp 7". READ-ONLY. CLAUDE CODE ONLY — it serves a local web app; outside Claude Code
  use carta-compensation-benchmarks (market rate for a role) or carta-compensation-scorecard
  (roster, compa-ratios). NOT for a single role lookup.
argument-hint: "<corporation name or numeric corporation id — required>"
version: 0.1.0
model: inherit
allowed-tools:
  - mcp__carta__welcome
  - mcp__carta__call_tool
  # `fetch` is for MCP *command*-style names (context_tools:get:profile). It is NOT
  # needed for the scorecard commands: call_tool works with the generated tool name,
  # which keeps the hyphen — compensation__get__employee-scorecard. Only colons
  # become `__`. Verified against a live MCP; see the failure-modes table.
  - mcp__carta__fetch
  - mcp__carta__search_tools
  - mcp__carta__list_accounts
  # `carta-prod` is the explicit production variant of the same server (`carta` is how
  # it usually registers). Nonprod connectors are deliberately absent: this skill is
  # published to customers, and Step 1 discovers whatever server is connected anyway —
  # granting a staff test connector up front would let a customer session reach it.
  - mcp__carta-prod__welcome
  - mcp__carta-prod__call_tool
  - mcp__carta-prod__fetch
  - mcp__carta-prod__search_tools
  - mcp__carta-prod__list_accounts
  - Read
  - Write
  - AskUserQuestion
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/ctc_paths.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_roster_page.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/build_datadir.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/serve.py *)
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

# CTC Dashboard (local React console)

Builds a corporation's CTC benchmark baseline, writes it to a local data dir in the
**dashboard console JSON schema**, and launches the prebuilt React app via `serve.py`.
**The browser never calls the Carta MCP** — this skill fetches the data; the server only serves
JSON + the app source.

**Read-only.** The `compensation:*` MCP namespace exposes no write commands. This console
displays CTC data and (in later tabs) models scenarios locally. Plan activation, payband edits,
employee edits, offer letters, HRIS resync and every other mutation stay in the CTC product.

## No demo data — real corporation required
**Never** fabricate, synthesize, or fall back to demo data, and never launch against an empty or
partial data dir. Every dashboard runs against **one real corporation's** CTC data — either
fetched fresh or served from a prior local fetch (cache). If the invocation names no corporation,
do **not** auto-pick or guess — ask, then proceed once they answer.

## Step -1 — Confirm this client can run the console (REQUIRED, before anything else)

This skill runs local scripts (`uv run …`) and serves a React app from `127.0.0.1`. That works in
**Claude Code only**. In Cowork, Claude Desktop, or claude.ai there is no local shell and no
browser reachable at localhost, so every step below fails — and it fails at the *first* Bash call,
after the user has already waited, with a permission error that does not explain why.

**If `Bash` is not available in this session, stop before Step 0 and route instead:**

> "The CTC console runs a local web app, so it only works in Claude Code. For the same data
> here I can use **carta-compensation-benchmarks** (market rates for a role) or
> **carta-compensation-scorecard** (your roster and compa-ratios) — which would you like?"

Do not attempt a partial run, and do not fall back to summarising benchmark data in chat yourself:
those two skills already do it properly, with the attribution and PII rules this one does not carry.

## Launch order — cache-first, MCP-minimal
Building needs a full MCP sweep; **launching a warm cache needs exactly one call.** Resolve the
name and check the local cache *before* touching any MCP, then spend a single `get:plan` call on
the version gate (Step 0) to confirm the cached release is still the one the corp's plan points
at. A matching version launches on local data alone.

## Step 0 — Resolve identity + check the local cache

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/ctc_paths.py" resolve "<corp name>"
```

Read-only; prints `slug`, `cache_root`, `raw_dir`, `dashboard_dir`, `snapshot_age_days`,
`snapshot_benchmark_version_id` and `snapshot_benchmark_version` without creating anything. Use
the printed `dashboard_dir` **verbatim** — never recompute a cache path.

- `snapshot_age_days=none` with `suggested_match=` lines → did-you-mean picker via
  `AskUserQuestion`.
- `snapshot_age_days=none`, no suggestions → build (Step 1).
- `snapshot_age_days=<N>` → cache hit. **Now run the version gate below** — do not launch on age
  alone.

### The version gate (REQUIRED on every cache hit)

**Age is not freshness.** Carta publishes benchmark releases on its own cadence, and a
corporation's plan can be re-pinned to a newer release at any time — so a cache written
*yesterday* can already be several releases behind. A purely time-based gate serves superseded
percentiles under a citation that names the old release, and the figures look authoritative
because every other part of the dashboard is correct. That is a correctness bug, not a staleness
inconvenience: someone sets salaries from these numbers.

So on a cache hit, make **one** cheap call before launching (Step 1's MCP identification applies):

```
call_tool({"name": "compensation__get__plan",
           "arguments": {"corporation_id": <corporation_pk>}})
```

Compare its `benchmark_version.id` against the printed `snapshot_benchmark_version_id`:

| Condition | Action |
|---|---|
| ids **match** and age <30d | Launch (Step 4) silently. |
| ids **match** and age ≥30d | Offer "use cached" vs "re-fetch" — the release is current, only the fetch is old. |
| ids **differ** | **Re-fetch (Step 2), regardless of age.** Say why in one line: "Carta published a newer benchmark release (v21.0 → v25.5) — refetching." Do not offer "use cached" as the default here; the cached figures are superseded. |
| `snapshot_benchmark_version_id=none` | Treat as a mismatch and re-fetch. A cache whose version cannot be read must not be trusted. |
| The plan call fails (403/5xx) | Fall back to the age rule and **say so**: "Couldn't confirm the benchmark release is current, so this may be up to N days behind." Never silently pretend the check passed. |

**This intentionally costs one MCP call on a warm launch.** The previous zero-call path was
faster but could not distinguish "4 days old and current" from "4 days old and 12 releases
behind" — and it is the *only* thing standing between a user and year-old compensation figures.
One `get:plan` call is the cheapest possible check: it is the same call Step 2b already makes, it
returns in one round trip, and on a match nothing else is fetched.

> **Use the plan's version, not the newest published one.** `compensation:list:benchmark_versions`
> may show a release *newer* than the plan's (releases land before plans are re-pinned). Always
> follow `get:plan` — that is what the CTC product UI shows, so pinning to a newer release would
> make this dashboard disagree with the product.

A numeric corp id instead of a name → `ctc_paths.py find-by-id <id>`.
No corporation in the invocation → `ctc_paths.py list-dashboards` to offer resuming a prior one.

**Run this silently.** The user's first line should be the greeting, not narration of the steps.
Cache age in words ("3 days old"), never as a raw `field=value`.

## Step 1 — BUILD: identify the Carta MCP + resolve the corporation

Reached **only on a build/refresh** (cache miss, stale re-fetch, or an explicit "refresh"). A
warm-cache launch needs only the MCP identification below plus the single `get:plan` call for
Step 0's version gate — not the rest of this step's resolution work.

**Identify the Carta MCP server.** Scan the tools available in the conversation for any matching
`mcp__*__welcome`. Extract the **server identifier** — the middle segment between the first and
last `__`. Examples: `mcp__carta__welcome` → `carta`; `mcp__carta-prod__welcome` → `carta-prod`.

- **None found:** stop and tell the user, do not fabricate data:
  > "No Carta MCP is connected. Building needs one — connect a Carta MCP (the **carta-cap-table**
  > plugin provides it). Your cached dashboards still open without it."
- **Exactly one:** call `mcp__<SERVER>__welcome` to verify. This is `<SERVER>`.
- **Multiple:** ask via `AskUserQuestion`. Default to `carta` (production) if present.

**Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every other command is gated.

**Classify the environment from `<SERVER>`'s name.** A name containing `test`/`sandbox`/`demo`/
`preprod`/`preproduction` (case-insensitive) → `cartaEnvironment = "nonprod"`. Everything else —
`carta`, `carta-prod`, any other name, or an opaque UUID — → `"production"`. This is a
customer-facing plugin, so an unrecognized identifier is far more likely to be a production
connector we haven't named than a staff test session. Carry this into Step 2e's `meta.json`.

**Resolve the corporation.** Priority order — stop at the first that succeeds:

1. **A numeric id in the prompt** ("corp 7") → use that integer verbatim. No lookup.
2. **A name** → `list_accounts(search="<name>")`, filtered to entries whose `id` starts with
   `corporation_pk:`. One match → use it. Several → `AskUserQuestion` with the names **copied
   verbatim** from the response.
3. **No hint** → `list_accounts()` bare. Exactly one corporation → use it silently (don't ask
   someone to confirm something they have no choice about).
4. **Zero `corporation_pk:` entries** → the caller may have no cap table at all. Check with
   `fetch({command: "context_tools:get:profile", params: {}})` — it is a command, not a flat
   tool, so `call_tool` returns "Unknown tool". If its `corporations[]` is empty, say CTC needs a
   cap table and stop. Do **not** ask them to name a corporation they don't have.

> **HARD RULE — only ever act on a name and `corporation_pk` returned verbatim by
> `list_accounts` for *this* query.** Never invent or auto-correct a company name, never blend two
> returned names, never reuse one remembered from earlier in the conversation. If the search
> returns nothing, say so and ask for the exact name or numeric id — a benchmark for the wrong
> corp is worse than asking again.

**Key the cache on the canonical corporation name** (the one the API returned, not the one typed):

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/ctc_paths.py" resolve "<canonical name>"
```

Use its printed `raw_dir` / `dashboard_dir` as the build target. Because every build keys on the
canonical name, any typed variant or a re-fetch lands on the **same** directory — a rebuild
refreshes that cache in place and a corp can never spawn a duplicate.

Then tell the user: "✅ Resolved <canonical name>. Starting data fetch…" — the only checkpoint
between here and the launch.

## Step 2 — Fetch → raw files

> **What's happening:** pulling the corporation's plan and market benchmarks from Carta. Results
> land as raw JSON in the local cache — nothing is sent back to Carta.

Follow `references/queries.md` for the exact arguments.

> ### The capture contract — read this before the first call
>
> **Never re-type, summarise, or hand-transcribe an MCP result into a file.** A benchmark response
> is ~15k tokens of decimal strings (or numbers, for the export); retyping one is slow and a
> single wrong digit silently corrupts a salary figure that then looks authoritative in the
> dashboard. Every response reaches disk through `save_benchmark_result.py`, one of three ways:
>
> **Case 1 — the harness persisted the result to a file** (the common case for `plan` /
> `subscription_status`). The tool result says something like *"Output has been saved to …"*.
> **Read that path from the message and pass it straight through** — the payload never has to
> pass through your reply:
> ```bash
> uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" \
>   <printed_result_path> "<raw_dir>/plan.json"
> ```
> Don't reconstruct the path — the location is client-dependent. Don't hunt for a sibling
> `*-blob-*.json`; the helper unwraps the envelope itself.
>
> **Case 2 — a small INLINE result** (`subscription_status`, or any small probe). **Write** the
> tool result **verbatim** to a `.raw` file with the Write tool — copy, don't paraphrase or
> reformat — then pass that file:
> ```bash
> Write <raw_dir>/<name>.raw          ← the raw tool result, unedited
> uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" "<raw_dir>/<name>.raw" "<raw_dir>/<name>.json"
> ```
>
> **Case 2b — an inline result too large to retype comfortably.** Both capture scripts accept
> `-` as the source and read the payload from **stdin**, which is the right route whenever the
> harness did NOT persist the result to a file and the payload is big (a full export page is
> ~25k tokens). Pipe it rather than hand-copying it into a heredoc:
> ```bash
> pbpaste | uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" - "<raw_dir>/<name>.json"
> ```
> `-` composes with `--export-page` and with `save_roster_page.py` too — verified, and it
> produces byte-identical output to the file path.
>
> **Or write the result to a `.raw` file with the Write tool**, then pass that path. The Write
> tool reproduces content exactly, so this is a legal capture route and NOT the hand-copying the
> contract forbids — the distinction is mechanical reproduction versus retyping. Do NOT use a
> shell heredoc for this: quoting mangles payloads and it invites transcription. **Verify every
> page after capture** — `--export-page` prints the row and job-area counts it captured, and they
> must match what the response reported (`row_count`, `jobs_covered`). A mismatch means the
> payload did not survive; re-capture rather than building on it.
>
> **If none of these routes is available, stop and say so** rather than retyping a benchmark
> payload by hand: that is the one thing this contract exists to prevent, and a truncated or
> mistyped page is worse than no dashboard.
>
> **Case 3 — a `compensation:export:benchmarks` page** (this is how every benchmark row is now
> fetched — see Step 2c). Same source rules as Case 1/2/2b (persisted path, verbatim `.raw` file,
> or `-` for stdin),
> but pass `--export-page` and give it `<raw_dir>` itself as the destination, not one `.json`
> file — a page covers up to 6 job areas at the recommended `job_limit`, so it fans out into that many
> `benchmark_<JOB>.json` files in one call:
> ```bash
> uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" \
>   --export-page <printed_result_path_or_.raw_file> "<raw_dir>"
> ```
>
> Every case the helper does the unwrapping (bare JSON, content blocks, base64 `resource.blob`,
> string-valued `result`, or the columnar export envelope) and **exits 2 rather than write
> something the builder would misread**.
>
> **If you find yourself about to type benchmark numbers into a heredoc or a Python literal, stop
> — you are in the failure mode this contract exists to prevent.** Use Case 1, 2, or 3.

**2a. Subscription gate (REQUIRED — do this before anything else).**

```
call_tool({"name": "compensation__get__subscription_status",
           "arguments": {"corporation_id": <corporation_pk>}})
```

- `is_subscribed: true` → continue.
- `is_subscribed: false` → stop, surface the subscription message, fetch nothing.
- `403` → the caller has no CTC role on this corp. Stop; do not retry.

A corp with no subscription has no benchmark data, so every later call would be wasted.

**2b. Plan.** Write the raw response to a temp file, then normalize:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" \
  <result_path> "<raw_dir>/plan.json"
```

Capture from it: `benchmark_version.id` (pins 2c) and `peer_group.{code,label,dimension}`. If
`dimension` is missing or is not one of `post_money` / `capital_raised` / `headcount`, **stop** —
guessing produces numbers that don't match the product UI.

**2c. Benchmarks — paged bulk export, not one call per job area.**

There are **22 job areas** (listed in `references/queries.md` §3), but the fetch is now
`compensation:export:benchmarks` — a bulk **columnar** export that returns several job areas'
full matrices (every level, both the IC and LEADER ladders) in one response, replacing the old
one-call-per-job-area sweep.

**Always pass `job_limit: 6`, starting at `job_offset: 0`.** A full sweep is then **4 pages**
(22 areas ÷ 6). Do *not* omit `job_limit` hoping for a bigger page:

> **The binding limit is a 10-second SERVER TIMEOUT, not a row cap.** Omitting `job_limit`
> asks for every remaining area at once, which on a real corp takes ~17s and fails with
> `exceeded 10000ms time limit` — burning a call and returning nothing. The response *cap* is
> ~300 columnar rows (~12 areas at ~17 rows each), so the old "omit it, you'll get up to 12"
> advice is arithmetically true and operationally wrong: the request times out long before it
> hits the row cap. Verified against a live MCP — the timeout error itself recommends
> `job_limit: 6`, and 6 completes comfortably (observed 55 and 102 rows per page).

Call it with `equity_quantity: "FOUR_YEAR_GRANT"`, `benchmark_version_id`, exactly one
`<dimension>_bucket` param, `job_offset`, and `job_limit: 6`.

> **PAGING IS THE DEFAULT, not an opt-in.** A response that omits `jobs`/`job_limit` is the FIRST
> PAGE — not the whole matrix. There is no way to get all 22 areas in one call.
>
> **Keep calling with `job_offset` = the previous response's `next_job_offset` until that field
> comes back `null`.** `total_job_areas` tells you how many exist overall (22), so you can tell a
> stalled sweep from a finished one without counting job names yourself. Treating one response as
> the complete cube would silently publish 6 of 22 job areas as if it were everything — this is
> the exact failure mode the paging discipline below exists to prevent.

Capture **every page** the moment it arrives, via the export-specific mode:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" \
  --export-page <printed_result_path_or_.raw_file> "<raw_dir>"
```

This is a **third capture path**, in addition to the two in the contract above — pass it the same
kind of source (a harness-persisted result path, or a verbatim `.raw` file you Wrote first), but
give it `<raw_dir>` itself as the destination, not a single `.json` file. It fans one page out into
one `benchmark_<JOB>.json` per job area the page covered (matching the per-job-area files the old
sweep produced, so `build_datadir.py` is unchanged), and appends the page's paging metadata to
`<raw_dir>/export_pages.json`. It prints whether the sweep is COMPLETE or INCOMPLETE after every
page — **read that line**; it is the authoritative answer to "am I done paging."

> **Never echo benchmark figures into the conversation** — they belong in the data dir. Report
> progress as "N of 22 job areas covered so far" between pages, not row counts or numbers.

**Check coverage between pages** the same way as before:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/build_datadir.py" \
  --raw "<raw_dir>" --check
```

Same four lines as before (`captured` / `empty` / `CORRUPT` / `plan.json`), plus a fifth when the
raw dir was fetched via the export: `EXPORT SWEEP: <warning>` if the last page's `next_job_offset`
was still non-null — i.e. paging stopped before `total_job_areas` was covered. `build_datadir.py`
**refuses to build** in that state even if every `benchmark_<JOB>.json` file happens to exist, so a
build can never publish a sweep that was cut short mid-page.

**Mid-sweep a non-zero exit is expected** — after page 1 of 2, most areas are legitimately still
`MISSING`. Only the **final** check needs to come back clean (exit 0). Do not treat a non-zero exit
between pages as a failure and re-fetch what you already have.

**When a page-level call fails** (403, 5xx, timeout, malformed response):

1. **Retry that page once**, same arguments (same `job_offset`). Transient 5xx and timeouts
   usually clear.
2. **Never fall back to per-job-area `compensation:get:benchmark` calls to route around a failing
   export call.** That is the ~22-call pattern this command exists to replace — if the export is
   failing, the fix is the export call's arguments (wrong `benchmark_version_id`, bad bucket
   param, auth), not a different endpoint.
3. **If a page fails twice**, stop before building and surface the error — with only 4 calls in
   a full sweep, a page that won't succeed after a retry means something systemic, not bad luck on
   one of 22 job areas. A timeout on a `job_limit: 6` page is NOT a reason to retry with a bigger
   limit; if 6 areas time out, a larger page certainly will.

A hard ceiling regardless of outcome: **at most 8 export calls per build** (4 pages plus
retries). If you're about to exceed that, stop and report — you're in a retry loop.

**2d. Employee list — one bulk export (feeds the Scorecard tab).**

Fetch this on **every build**, not on request. It is what makes the Scorecard tab exist, and
because a warm cache launches without re-fetching data (Step 0 spends one call on the version
gate only), a build that skips it produces a dashboard whose Scorecard tab is missing for the
next 30 days with no way for the user to ask for it short of an explicit "refresh".

Call **`compensation:export:scorecard`** with just `corporation_id`. It returns every
benchmarked employee in ONE columnar response — no `page`, no `page_size`, nothing to page
through. Capture it with the export flag:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_roster_page.py" \
  --export-scorecard <printed_result_path_or_.raw_file> "<raw_dir>"
```

Same source rules as the capture contract above (harness-persisted path, or a verbatim `.raw`
file you Wrote first), and the same destination convention as `--export-page`: pass `<raw_dir>`
itself, not a single `.json`. The script writes `<raw_dir>/roster_pages.json` in the same schema
the paged path produces, so `build_datadir.py` does not care which route was used.

> **Read the script's last line — it is the authoritative answer to "am I done."** It prints
> `sweep COMPLETE — N of M employees captured`. The export returns everyone or refuses, so an
> INCOMPLETE here is not "fetch another page" — it means the response was filtered or capped, and
> you should stop rather than build on it.

**Never echo employee names, salaries or compa-ratios into the conversation** — they belong in
the data dir, same rule as benchmark figures. Report only "N employees captured".

**If the export returns 400 "at most 200 fit in one export response":** the corporation is too
large for a single response. Fall back to the paged sweep below — it is slower and its pages
overlap, but it has no size ceiling. Do not narrow with `job_filters` to squeeze under the cap: a
filtered employee list silently under-reports how many people sit below market, which is the
failure this whole tab exists to surface.

Three things that will bite otherwise:

- **The generated tool name is `compensation__export__scorecard`** — colons become `__`. Unlike
  `employee-scorecard`, there is no hyphen in this one.
- **It is staff-gated.** A non-staff caller gets a permission error, not an empty list — fall
  back to the paged sweep rather than reporting the corporation has no employees.
- **`403` means no CTC role on this corp** (not "no employees"): stop, don't retry. A genuinely
  empty employee list returns `total_results: 0`.

<details>
<summary><b>Fallback — the paged sweep</b> (only when the export is unavailable or refuses)</summary>

Call `compensation:get:employee-scorecard` with **`page_size: 10`**, then page with
`page: 2, 3, …`. Capture **every page the moment it arrives** (no `--export-scorecard` flag):

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_roster_page.py" \
  <printed_result_path_or_.raw_file> "<raw_dir>"
```

> **Why 10 and not 30.** A `page_size` of 30 is REJECTED — the response exceeds the 80,000-char
> transport limit. Verified against a live MCP on a 134-employee employee list. 10 is the
> documented safe value in that error message.

**Budget — the overlap makes this bigger than it looks.** Pages return overlapping rows, so a
page of 10 yields fewer than 10 NEW employees (observed ~30-40% repeats, i.e. ~6-7 new per page).
Budget **`ceil(total_results / 6) + 2` calls**. The authoritative signal is the script's `N of M`
line rising each page — stop only when a page adds **zero** new employees twice in a row.

- **The generated tool name keeps its hyphen** — `compensation__get__employee-scorecard`.
- **`page_size` is snake_case.** `pageSize` is not rejected — it is *ignored*, and you get the
  default 10 instead, i.e. a short employee list that looks real.
- **Never pass `score=LOW/MID/HIGH` to shrink a page.** It filters on the *overall* band, which
  is nullable, so it silently drops every employee without one and undercounts the list.

</details>

If the roster sweep fails outright, **still build** — `build_datadir.py` omits `roster.json`,
`snapshot.json` records `hasRoster: false`, and the Scorecard tab simply does not appear.
Losing one tab is better than losing the Benchmarks dashboard too. Say which tab is missing
and why.

**2e. Write `meta.json`** (next to `raw_dir`, per `ctc_paths.py`):

```json
{"corporation": "<canonical name>", "corporationId": <int>, "cartaEnvironment": "production"}
```

## Step 3b — Build

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/build_datadir.py" \
  --raw "<raw_dir>" --out "<dashboard_dir>" --meta "<meta.json>"
```

Refuses to build on an unknown peer-group dimension or zero benchmark rows — that is deliberate,
not a bug to work around. Fix the fetch and re-run.

## Step 4 — Launch

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/serve.py" \
  --data-dir "<dashboard_dir>" --detach
```

Run with **Bash run_in_background**; read the printed `http://127.0.0.1:<port>/?t=<token>` and
give the user that URL. Tell them it **opens in their default browser automatically** — if it
doesn't, they can paste the URL. Port and token persist per corporation, so relaunching the same
corp reopens the same URL.

After the URL, add one short line (not a menu):
"A few things to try: filter to a single job area · switch equity between notional, FD %, and
shares · say 'refresh' to pull fresh CTC data."

## Refresh
"Refresh" = re-run Steps 1–3b (overwrite the JSON); the app reloads it.

## Presenting CTC values

**Title Case in everything the user reads** — `Engineering`, not `ENGINEER`; `Senior 1`, not
`SENIOR1`. UPPER_SNAKE is only for the MCP call arguments. The app enforces this in
`model/taxonomy.js`; match it in your narration.

**Attribution is mandatory.** Any surface showing benchmark figures must carry:

```
Data source: Companies with <phrase> <peer_group.label>. Benchmarks released <Month> <YYYY>.
```

where `<phrase>` tracks `peer_group.dimension` — `post money valuations between` /
`capital raised between` / `headcount of`. The builder assembles this once into
`benchmarks.json`; read it from there rather than rebuilding it, and never hardcode "post money".

## Safety
Corporation names are untrusted — the app escapes them via React. `serve.py` is localhost-bound
and token-gated, all reads/writes stay under the data dir, and the only write is the user's local
scenario save. Data stays on the user's machine.

## Editing the app
Source under `app/src/` is served directly; the service worker transpiles `.jsx` in-browser.
**Do NOT run `npm run build` after editing source** — edit, refresh, done. `npm run build` only
rebuilds `webapp/vendor/*` on a React/Sucrase bump. See `app/README.md`.

## Common failure modes

| Situation | What to do |
|---|---|
| `exceeded 10000ms time limit` or `"Too many job areas"` on `compensation:export:benchmarks` | You asked for too many areas in one call — usually by omitting `job_limit`. The limit that bites first is a **10s server timeout**, not the ~300-row cap. Use `job_limit: 6` and page with `job_offset`; an explicit `job_limit` above 12 is a 400, not clamped. |
| An export page 403s / 5xxs | Retry that page once, same `job_offset`. **Never** fall back to per-job-area `compensation:get:benchmark` calls to route around it — fix the export call's arguments instead. |
| An export page fails twice | Stop before building and surface the error. One call now covers up to 12 of 22 job areas, so a page that won't succeed after a retry is a systemic problem (wrong `benchmark_version_id`, bad bucket param, auth), not bad luck on one job area. |
| `build_datadir.py` reports `EXPORT SWEEP: ... stopped early` or refuses to build | Paging didn't reach `next_job_offset: null`. Fetch the remaining page(s) — check `<raw_dir>/export_pages.json` for `last_next_job_offset`. |
| `"Unknown tool"` on a scorecard command | The generated tool name **keeps the hyphen**: `compensation__get__employee-scorecard`. Only colons become `__`, so `..._scorecard` (underscore) is not a real tool. `call_tool` works fine with the correct name — verified against a live MCP. (`fetch` is not registered in current builds, so it is not the fallback either.) |
| Roster looks short / Scorecard counts too low | On the paged fallback: `pageSize` camelCase is silently ignored and the default page size applies — use `page_size`. Also check you did not pass `score=`, which filters on the nullable overall band and drops unscored employees. |
| `compensation:export:scorecard` returns 400 "at most 200 fit" | The corporation is larger than one export response. Use the paged fallback in Step 2d — do NOT narrow with `job_filters`, which silently under-reports who is below market. |
| `save_roster_page: N row(s) do not match the ... header` | The export's columns and rows disagree, so the payload is not what the decoder expects. Do not work around it — a partially-decoded employee list would be published flagged COMPLETE. Re-fetch; if it repeats, the export's column set changed and the script needs updating. |
| `build_datadir.py` refuses: "the roster sweep is INCOMPLETE" | Paging stopped before `total_results` was reached. Check `<raw_dir>/roster_pages.json` for `distinct_employees` vs `total_results` and fetch the remaining pages. Never work around this — a partial roster under-reports how many employees are below market. |
| Scorecard tab absent on a fresh build | `snapshot.json` will say `hasRoster: false`. The roster sweep failed or was skipped; re-run with "refresh". A warm cache re-fetches nothing (Step 0's one call is the version gate), so the tab cannot appear until the next build. |
| Numbers don't match the CTC product UI | Almost always `equity_quantity` (must be `FOUR_YEAR_GRANT`) or a missing/incorrect `*_bucket` param. |
| `HTTP 400` on `job`/`focus` | Passing a display label (`"Engineering"`) or a combined value (`ENGINEER/BACKEND`). Two separate params; `job` UPPER_SNAKE, `focus` lowercase. |
| Builder exits "peer_group.dimension is …" | `plan.json` is missing or from a different corp. Re-fetch Step 2. |
| Browser shows the dark error overlay | Copy the message back into the session — it carries the file and line. |
| Blank page, no overlay | Service worker didn't claim. Hard-refresh once; the shell reloads itself after 3s as a backstop. |
