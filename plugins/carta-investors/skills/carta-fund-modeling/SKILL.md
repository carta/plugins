---
name: carta-fund-modeling
description: >
  Spin up an interactive local web console for FIRM-LEVEL scenario modeling over Carta Fund Admin data — a
  React app to reprice portfolio companies and model exits ACROSS MULTIPLE COMPANIES, with five tabs:
  Overview (fund-family rollup, investment pacing, concentration), Companies (per-company repricing + LP
  make-whole waterfall + carry banking), Exit & IRR (exit scenarios, XIRR, GP & LP returns, plus a per-fund
  DPI/RVPI/TVPI glidepath in the LP Returns view), Reserves (per-fund dry-powder planning), and Cohort
  Standing (peer-cohort + S&P-equivalent benchmarking). Scenarios persist locally. Invoke with a firm name,
  e.g. "fund modeling for Demo Capital" or "model portfolio scenarios for <firm>". Fund Admin only. NOT
  Tactyc/Fund Forecasting — use carta-fund-forecasting for Tactyc funds. NOT for single-exit waterfalls on
  one company. NOT read-only fund data queries — use carta-explore-data.
argument-hint: "<firm name or Carta firm URL — required>"
version: 1.0.0
model: inherit
allowed-tools:
  - mcp__carta__welcome
  - mcp__carta__call_tool
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - mcp__carta__search_tools
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__search_tools
  - mcp__carta_production__welcome
  - mcp__carta_production__call_tool
  - mcp__carta_production__set_context
  - mcp__carta_production__list_contexts
  - mcp__carta_production__search_tools
  - Read
  - Write
  - AskUserQuestion
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/fm_paths.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/emit_stem_sql.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/save_query_result.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/build_datadir.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/serve.py *)
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
</IMPORTANT>

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]

<!-- Carta investor tooling. React app (in-browser JSX transpile) fed by Fund Admin data. -->

# Fund Modeling (firm-level React console)

Builds a firm's baseline from Carta Fund Admin data, writes it to a local data dir in the
**fund-modeling console JSON schema**, and launches the prebuilt React app via `serve.py`. **The browser
never calls the Carta MCP** — this skill fetches the data; the server only serves JSON + the built app. The
repricing/waterfall/IRR is a **transparent estimate** (the ported `model/`), not Carta's official engine.

## No demo data — real firm required
**Never** fabricate, synthesize, sample, or fall back to demo/placeholder data, and never launch against an
empty or partial data dir. Every dashboard runs against **one real Carta firm's** Fund Admin data — either
fetched fresh or served from a prior local fetch (cache). If the invocation includes no firm (name or URL), do
**not** auto-pick, list, or guess — **stop and ask the user to name a firm**, then proceed only once they
answer. A missing or unresolved firm is a graceful exit, not a reason to invent data.

## Launch order — cache-first, MCP-lazy
Building a dashboard needs the Carta MCP; **launching a warm cache does not.** Resolve the firm **name** and
check the local cache *before* touching any MCP — a fresh cache launches with **no MCP call**. Only a
build/refresh (Step 1 onward) identifies the MCP and resolves the firm over it.

## Step 0 — Resolve identity + check the local cache

```
Firm typed? ──Yes──► Cache hit? ──Yes──► Fresh (<30d)? ──Yes──► Launch (Step 4)
     │                    │                    │
     │                    │                    No──► Offer: Use cached / Re-fetch
     │                    │
     │                    No──► Suggestions? ──Yes──► Did-you-mean picker
     │                               │
     │                               No──► List all local caches → picker / Build fresh
     │
     No──► Local caches exist? ──Yes──► Picker (resume where you left off)
                    │
                    No──► Ask user to name a firm
```

Everything here is a local dir scan + Read — **no MCP call yet.** Read what the invocation gives you and route:

**Run this silently — the user's first line should be the greeting.** Don't narrate the steps ("Step 0", "no MCP
yet", "resolving the firm") or echo `fm_paths` output — no raw `field=value` (`snapshot_age_days=none`,
`slug=…`) or cache paths. Cache age is fine **in words** ("3 days old"), not as a raw field.

**A pasted Carta firm URL / UUID → identity lookup.** Parse the id locally (the firm id from a
`…/investors/firm/<id>` URL, or a bare firm UUID) and match it against your caches:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/fm_paths.py" find-by-id "<parsed_id>"
```
`match=<slug>` (+ `name`, `dashboard_dir`, `snapshot_age_days`) → a hit; greet and go to the **cache-age branch**.
`match=none` → **BUILD (Step 1)**, carrying the parsed id/URL to the MCP resolve.

**A firm NAME → cache check.** Slugify the typed name and look for a matching cache (pass the name to the
script — do **not** slugify it yourself). Caches are keyed by each firm's **canonical** name (Step 1), so an
exact hit means the typed name already matches that firm's canonical name:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/fm_paths.py" resolve "<firm name>"
```
It is **read-only** — it prints `slug=…`, `cache_root=…`, `raw_dir=…`, `dashboard_dir=…`, and
`snapshot_age_days=<N|none>` **without creating any dir**. On a hit, **use the printed `dashboard_dir` verbatim**
for the launch — never recompute a cache path in the shell. (The build paths come from Step 1's canonical
resolve, not here.)
- `snapshot_age_days=<N>` (**cache hit**) → greet, then the **cache-age branch** — a silent fast launch on fresh,
  no picker.
- `snapshot_age_days=none` (**no hit**) with `suggested_match=<slug>` lines (each `name`, `age_days`,
  `dashboard_dir`) → **did-you-mean picker**: `AskUserQuestion` offering each row (label `name` + `age_days`)
  plus "Build fresh from Carta '<typed>'". Reopen → greet + **cache-age branch** with that row's `dashboard_dir`
  + `age_days`; Build fresh → **BUILD (Step 1)**.
- `snapshot_age_days=none` with no `suggested_match` lines → **check for other local caches** below.

**No firm in the invocation** → **check for other local caches** below (resume where you left off).

### Check for other local caches
A miss on the typed name doesn't mean there's nothing cached — the user may have typed a variant of a firm
already built, or nothing at all. Scan once:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/fm_paths.py" list-dashboards
```
- `dashboards=none` (**no caches at all**) → if the invocation **supplied a firm** (name typed, or URL/UUID
  pasted), go straight to **BUILD (Step 1)** — this is a clean first build, **no picker**. If **no firm was
  supplied**, **hard-stop**: ask the user (via `AskUserQuestion`) for a firm name or Carta firm URL and stop
  until they answer.
- **caches exist, and a firm was typed** → decide by relevance, **do not list unrelated caches**. Judge whether
  any cached `name` is **plausibly the same firm** the user typed (a variant/abbreviation/legal-suffix
  difference — e.g. "Demo Capital" ↔ "Demo Capital Partners LP"; but "Acme Ventures" is *not* a match for a
  cached "Demo Capital Partners LP"):
  - a plausible match → show the **did-you-mean picker**: an `AskUserQuestion` offering **only the matching
    cache(s)** to reopen (label with `name` + `age_days`) **plus** "Build fresh from Carta '<typed>'". Reopen →
    greet + **cache-age branch** using that row's printed `dashboard_dir` + `age_days`; Build fresh → **BUILD
    (Step 1)**.
  - **no plausible match** → the user named a distinct firm; go straight to **BUILD (Step 1)**, **no picker**.
    You may add one non-blocking aside naming the other cached dashboards ("You also have N cached — say 'open
    <name>' to view one instead"), but do not turn it into a prompt.
- **caches exist, no firm typed** → **resume**: `AskUserQuestion` listing the local dashboards to reopen
  (`name` + `age_days`, up to ~3; *Other* covers the rest). Reopen → greet + **cache-age branch** using that
  row's printed `dashboard_dir` + `age_days`; *Other* / a new name → **BUILD (Step 1)**.

**Never fabricate or auto-pick a *Carta* firm.** Offering the user's own local caches for a pick is allowed;
never auto-launch one without a pick, and never invent or guess a Carta firm.

**Greet the user (single message).** When a firm/cache is settled (exact match, picked cache, or a firm to
build), present the welcome below as **one** message, then proceed. Show it on first use even if the user
immediately entered a task — do not suppress it. For \<Firm Name\>: on a picker or `find-by-id` hit use the
printed cached `name` (the canonical `snapshot.source.firm`); on a name-`resolve` hit the typed name is fine
(it is slug-equal to the canonical); when building, the typed name (Step 1's canonical `name` once resolved).

> Welcome to Carta Fund Modeling. This skill builds a React app that lets you run scenarios on portfolio
> companies and evaluate returns. You'll start from a **Baseline** scenario representing the valuation marks
> Carta currently holds on your companies, and can build new scenarios to change company valuations and see
> the impact on firm- and fund-level performance metrics.
>
> Here's how it works:
> - Pull your fund holdings, valuations, and cash flows from Carta
> - Build a local snapshot on your machine
> - Launch an interactive dashboard in your browser

Then append **one** cache-status sentence (substitute the real firm name for \<Firm Name\>):
- a cache exists (exact match or picked cache): read `source.navAsOf` from the cached
  `\<dashboard_dir\>/snapshot.json` and state the data recency alongside the cache age — e.g. "Since a cache
  for **\<Firm Name\>** already exists locally, this should be quick — let me reload your dashboard. It reflects
  Carta's marks as of **\<MMM d, yyyy\>**, pulled \<N\> days ago." Format `navAsOf` for display as **MMM d, yyyy**
  (the stored value is ISO); `\<N\>` is the cache age already in hand. If `navAsOf` is missing, drop the "as of"
  clause and keep just the cache age.
- no cache (building): "It looks like this is the first time you're running this skill on this firm. Let me take a few minutes to pull the latest data and build the infrastructure to customize the app for this firm."

**Cache-age branch** (for a resolved cache):
- `snapshot_age_days < 30` (fresh) → **skip the build entirely**, go straight to **Step 4 (Launch)** — it serves the cached snapshot and makes **no MCP call**.
- `snapshot_age_days ≥ 30` (stale) → ask via `AskUserQuestion`: "Cached data for \<Firm Name\> is \<N\> days old. Use it or re-fetch from Carta?" Options: **"Use cached"** / **"Re-fetch"**. On "Use cached" → **Step 4**; on "Re-fetch" → **BUILD (Step 1)**.

**Authorization on cache launch:** a user who lost firm access can still view the *local* cached snapshot (data
they already exported to disk). Accepted, signed-off risk — a cache launch never re-touches Carta; any refresh
goes through live MCP auth, which is the natural re-check.

## Step 1 — BUILD: identify the Carta MCP + resolve the firm (only when building)
Reached **only on a build/refresh** (cache miss, stale re-fetch, or an explicit "Refresh Carta holdings"). A
warm-cache launch skips this step entirely — no MCP.

**Identify the Carta MCP server.** Scan the tools available in the conversation for any matching `mcp__*__welcome`. Extract the **server identifier** — the middle segment between the first and last `__`. Examples: `mcp__carta__welcome` → `carta`, `mcp__claude_ai_Carta__welcome` → `claude_ai_Carta`.

**If none found:** stop and tell the user (do not fabricate data):
> "No Carta MCP is connected. Building/refreshing needs one — connect a Carta MCP (the **carta-investors**
> plugin provides it). Your cached dashboards still open without it."
**If exactly one found:** call `mcp__<SERVER>__welcome` to verify. This is `<SERVER>`.
**If multiple found:** ask the user which to use via `AskUserQuestion`. Default to `carta` (production) if present.
**Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — every other command is gated and will return a reminder.
**Fund Admin only — never `fund_forecasting:*`.**

**Resolve the firm via `list_contexts`.** Call `list_contexts {firm_name: "<typed firm name>"}` — **always pass
the typed name; never call it bare** (bare can return an already-active firm instead of the one asked for).

The result is one firm per line; **don't rely on exact punctuation** (the UUID may be in `[...]` or `(...)`, an
active firm suffixed `(active)`). Per line: **firm name** = leading text, **`firm_uuid`** = the hex UUID token.
- **One firm** → use it.
- **Multiple** → match the typed name (case-insensitive); single match → proceed, else `AskUserQuestion` to
  pick. Matching can be fuzzy, so confirm on any ambiguity.
- **Zero** → tell the user no firm matched and ask them to re-enter — don't fall back to anything.

`set_context {firm_id: <firm_uuid>}` with the chosen UUID. `carta_id` (integer firm ID) is optional — when a line
carries a `#<digits>` token, capture it as `firmId`, else set `"firmId": null`. All DWH queries use `firm_uuid`.

**Key the cache on the canonical firm name.** Resolve the build paths from the **canonical `name`** (not the
typed name):
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/fm_paths.py" resolve "<canonical name>"
```
Use its printed `slug`/`raw_dir`/`dashboard_dir` as the build target (Steps 2–3 write there). Because every
build of a firm keys on its canonical name, **all invocations — any typed variant, a pasted URL, a re-fetch —
land on the same directory**: a rebuild refreshes that one cache in place, and a firm can never spawn a
duplicate. (When the typed name already equals the canonical name, this slug matches Step 0's — a plain
refresh.) Persist `carta_id`/`firm_uuid` as `firmId`/`firmUuid` in the snapshot (Step 3) so a later URL/UUID
invocation finds this cache via `find-by-id` (Step 0) without a fetch.

## Step 2 — Fetch the baseline (Fund Admin) → raw query files

> **What's happening:** Fetching the firm's fund holdings, partner data, valuations, and financials from Carta's data warehouse in parallel waves. Results land as raw JSON files in the local cache — nothing is sent back to Carta.

Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/references/queries.md`. Substitute the **Step-1 canonical
`raw_dir`** for `<raw_dir>` in every command below. The dir is created on demand by the first writer that
touches it (the Write tool, `save_query_result.py`, or `touch-empty`); there is no shell `CACHE`/`RAW` variable
to set.
Enumerate the firm's entities with the **compact DWH directory query in queries.md §0** (a firm-scoped
`MONTHLY_NAV_CALCULATIONS` SELECT) — **not the fund-admin entity-list command**, which returns verbose per-entity objects and
**exceeds the MCP 40k-char limit on large firms** (a firm with ~100+ SPVs breaks it). The §0 query **excludes SPVs**
(`entity_type_name NOT ILIKE '%SPV%'`) — single-deal SPVs are out of scope and are what blow the limit — so it
stays tiny and returns only Fund/GP entities. Then **write that query's `fund_uuid` column to
`<raw_dir>/fund_uuids.txt` (one uuid per line)** with the Write tool — this is the only value you extract by hand;
because SPVs are already filtered out of the directory, no SPV is ever fetched. From here the queries
are generated deterministically: **do NOT hand-write SQL or paste an IN-list.** Get every stem's ready-to-run
query from the emitter, which fills the `fund_uuid` / `corporation_id` IN-list from the manifest
(`scripts/stem_queries.py`, the source of truth for stem SQL).

### GP carry opt-in check (before Wave 1)

`gp_carry` contains **per-member names** — run this check after writing `fund_uuids.txt` and before emitting Wave 1:

**1. Probe for data access.** Emit the `gp_carry` query and run it with `limit: 1` to check both permission and data presence:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/emit_stem_sql.py" --raw "<raw_dir>" --stem gp_carry
```
Run the resulting SQL via `dwh__execute__query` with `limit: 1` (override the emitted limit in the tool call).

**2a. Query fails** (e.g. `Error in secure object`) **or returns 0 rows:**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/fm_paths.py" touch-empty "<raw_dir>/gp_carry.ndjson"
```
Tell the user: "GP partner carry data is not accessible for this firm — skipping." Then add `--skip gp_carry` to the Wave 1 emit command (step 3 below).

**2b. Query returns rows** — ask via `AskUserQuestion`:
> "This firm has GP partner-level carry data (per-member names, accrued carry, carry shares). Include it in the GP Economics tab?"
> Options: **"Yes, include it"** / **"No, skip it"**

- **"Yes"** → include `gp_carry` in Wave 1 (omit `--skip`).
- **"No"** → touch-empty `<raw_dir>/gp_carry.ndjson` (same command as 2a) and add `--skip gp_carry` to the Wave 1 emit.

**3. Emit the fetch batches** with `--skip gp_carry` when the user opted out or data was not accessible:
```bash
# Default (opted in):
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/emit_stem_sql.py" --raw "<raw_dir>" --batch

# Opted out or not accessible:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/emit_stem_sql.py" --raw "<raw_dir>" --batch --skip gp_carry
```

It prints a **JSON list of batches**, each `{batch, format:"ndjson", limit:10000, stems:[...], queries:[...]}` —
at most 10 queries per batch (the `dwh:execute:queries` cap), with `stems[i]` aligned to `queries[i]`. Every stem
is fund-scoped and independent, so **fetch each batch with one parallel `dwh:execute:queries` call — do NOT fetch
stems one at a time.** Serial per-stem fetching is the single biggest reason a first build is slow: each stem
costs a full model turn whose reasoning dwarfs the query itself. Issue all batches' calls together (in one
message) so the two batches don't serialize needlessly.

For **each batch**, two mechanical moves:

1. Issue the whole batch in one call:
   ```
   call_tool({"name":"dwh__execute__queries","arguments":{"queries": <batch.queries>, "limit": 10000, "format": "ndjson"}})
   ```
   Pass `limit:10000` and `format:"ndjson"` **explicitly** — the command defaults to `limit:1000` / `format:markdown`,
   both wrong for us. The queries run in parallel server-side and return a **positional JSON array**, one element
   per query (`{index, total_rows, result}` or `{index, error}`).
2. **Capture the whole batch into per-stem files via the batch helper — never hand-split, hand-decode, or
   hand-author ndjson.** Two cases, same shapes as a single query:
   - **Large result** → the harness persisted it and prints the absolute path in its result message ("Output has
     been saved to …"; the location is client/config-dependent — read it from the message, don't reconstruct it).
     Pass **that** printed path directly. The helper unwraps that envelope itself (the positional array is a base64
     blob behind an embedded JSON string) — do **not** hunt for the separate `*-blob-*.json` file the harness also drops:
     ```bash
     uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/save_batch_result.py" <result_path> "<raw_dir>" --stems <comma-joined batch.stems>
     ```
   - **Small INLINE result** (returned in the tool response, no file) → **Write** the raw tool result verbatim to
     `<raw_dir>/batch<N>.raw`, then pass that file:
     ```bash
     uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/save_batch_result.py" "<raw_dir>/batch<N>.raw" "<raw_dir>" --stems <comma-joined batch.stems>
     ```
   `save_batch_result.py` splits the positional array by `--stems` order and writes clean `<stem>.ndjson` per
   query — reusing the **same** deterministic normalization as the single-query path (inline markdown/pipe table,
   base64 `resource` blob, the harness `{"result": "<ndjson>"}` wrapper, or the persisted tool-result `.txt`
   envelope — a `[pointer, base64-blob]` list). It writes an **empty file** for a
   stem that returned 0 rows or `{index,error}` (so the contract's "the file must exist" holds), and prints
   per-stem status. If it can't split the response into `len(stems)` slices it exits **2 and writes nothing** —
   run it once with `--dump-shape` to inspect the envelope, then use the fallback below.
3. **Read the helper's per-stem output:**
   - `save_batch_result: <stem> N row(s)` — captured.
   - `save_batch_result: <stem> 0 rows (empty file)` — genuinely empty (or a failed query). Fine **unless** it's
     a rows-required stem (`nav_latest`, `investments`), in which case re-fetch that stem singly (fallback below).
   - `ERROR stem=<stem>: <msg>` — that query failed inside the batch; re-run it as a single `dwh__execute__query`
     to surface the error, then capture with `save_query_result.py`.
   - `TRUNCATED stem=<stem> next_offset=<N>` — that stem is **incomplete**; **paginate it** (below).
     `build_datadir.py` refuses to build while any `<stem>.ndjson.truncated` marker exists, so this is not
     skippable. Do **not** treat a `TRUNCATED` line as success.

**Fallback — per-stem serial fetch.** If `dwh__execute__queries` is unavailable (`Unknown tool` / `NotFoundError`
on an older MCP) or `save_batch_result.py` can't split the envelope, fall back to fetching each stem singly:
`emit_stem_sql.py --stem <name>` → `call_tool({"name":"dwh__execute__query","arguments": <that {sql,limit,format}>})`
→ `save_query_result.py <result_path> "<raw_dir>/<stem>.ndjson"`. Same pagination and contract rules apply. This
is the pre-batch path; it is correct but slower (one serial round-trip per stem).

**Pagination — when you see the `TRUNCATED` sentinel** (from either the batch helper's `TRUNCATED stem=<stem>`
line or a single fetch). Page that **one** stem via the single-query tool — re-run its query
(`emit_stem_sql.py --stem <stem>` if you no longer have it) with `offset` set to the reported `next_offset`, then
capture it with `--append`:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/save_query_result.py" <result_path> "<raw_dir>/<stem>.ndjson" --append
```
Repeat until the `TRUNCATED` line stops appearing — the helper clears the marker itself on the final page.
`offset` is a `dwh__execute__query` argument, exactly like `limit`; do **not** put `OFFSET` in the SQL.

**You get at most 5 pages per stem (50,000 rows).** If a 6th page is still reporting `next_offset`, STOP and
report `needs_human: <stem> exceeds 50,000 rows — the fund-modeling schema does not expect a stem this large`.
Do **not**: raise `limit` above 10,000 (the server clamps it, so this changes nothing and silently re-truncates);
delete the `.truncated` marker by hand; pass `--no-strict` to the builder; or narrow the query's `fund_uuid` /
date range to duck under the cap. Each of those turns a loud, fixable truncation back into the silent wrong-data
bug this gate exists to catch.

**Capture inline results immediately — do not defer.** For every INLINE stem, do the Write-to-`.raw` step
**in the same turn** the result comes back, before issuing the next tool call. A long first build can trigger
context compaction mid-fetch; anything still sitting only in conversation history (not yet written to
`<raw_dir>`) is lost when that happens, forcing a re-fetch from Carta. Writing to disk immediately makes each
stem durable the moment it lands, regardless of what happens to the conversation afterward. If you ever resume
a build and an inline stem's data is no longer visible in context, **treat it as never fetched** — re-run its
query and capture it via the helper. Never reconstruct rows from partial memory of an earlier result; a
hand-reconstructed file is exactly the "0 funds / 0 companies" / silently-truncated-stem failure mode above.

**Fetch the whole manifest in ONE batch — there is no second wave.** Every stem is fund-scoped, so a single
`emit_stem_sql.py` call returns all of them and there is no ordering dependency between any two:
`nav_latest`, `investments`, `cashflows`, `fund_metrics`, `accrued_carry`, `distributed_carry`, `waterfall`,
`cohort`, `deal_irr`, `partners`, `gp_partners`, `gp_carry` (if opted in — see the GP carry opt-in check above),
`ownership`, `financing` (§11), `captable` (§15), `corporations` (§16). Issue them together, then normalize each
returned result with `save_query_result.py`. **Also run the §14 `financials` query in the same batch** (it takes
no `fund_uuid` list — it is firm-context-scoped). The whole build runs off the MCP DWH and these local helpers only.

**Do not stop after the fund-level stems** — `financing` supplies each company's last priced round, `captable`
populates its cap table on the dashboard, and `corporations` is the id bridge those enrichments (cap table AND
"Latest round" on Overview) resolve through. All three are file-required (see contract below): a missing
`<stem>.ndjson` hard-fails the build, so skipping them can no longer silently yield "0 cap tables" / blank
"Latest round" fields, indistinguishable from a firm that legitimately has none.

`financing`, `captable` and `corporations` filter by corporation, but they take **only the `fund_uuid` list** —
their corporation scope is a subquery over `FUND_CORPORATION_OWNERSHIP` (see queries.md §11). **Never** rewrite
one of them to take a pasted `corporation_id` IN-list: that resolves to ~1,150 UUIDs on a mid-size firm, which
is too long for a single call, so it has to be hand-chunked into several — and each chunk costs *minutes* of
token emission. On a 15-fund firm that one mistake cost 15 minutes for `financing` alone. Pass the emitter's
object through unedited and the subquery handles it in one call.

Batching the fetch instead of running one stem at a time is the main first-build speedup: it collapses ~16
model turns into one, and the per-turn reasoning — not the network wait — is what dominates a serial build.
(Correctness is unchanged: the emitted SQL is the manifest's verbatim query with the `fund_uuid` IN-list filled
in, and the deterministic capture is identical; only the scheduling and templating change.)

### The fetch is a contract, not a checklist — every DWH stem file MUST exist
Fetching is **not optional and not LLM-discretionary**. `build_datadir.py` is the deterministic gate: it
**refuses to build (exits 2) if any file-required stem's `<stem>.ndjson` is absent**, listing what was never
fetched. You cannot launch a dashboard that skipped a stem — so do not "skip for speed," and do not decide a
firm "probably has none" and move on. Run **every** stem below.

The **file must exist**; it may be **empty**. When a query genuinely returns 0 rows, or fails with
`Error in secure object` (a role that can't read that table), **record the attempt by writing an empty file** —
do NOT leave the file absent:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/fm_paths.py" touch-empty "<raw_dir>/<stem>.ndjson"
```
An empty cohort file is what makes benchmarks read as `no_coverage_published` ("genuinely none") instead of
falsely blocking the build. A **missing** file means the query was never run — that is the exact bug this gate
exists to stop.

Stems → queries.md section. **The DWH stems below are file-required — the builder rejects a build that
is missing any of their `<stem>.ndjson` files** (write an empty file when truly none):
`nav_latest`(§2, **rows required**), `investments`(§3, **rows required**),
`cashflows`(§5 — the single 7-column query that feeds both LP IRR and the NAV/TVPI trend; do **not** run a
separate §13), `fund_metrics`(§1/§12), `accrued_carry`(§7), `distributed_carry`(§7 — realized "Carried interest
earned"; feeds the "Carry distributed" callout, $0→"—"), `cohort`(§8), `deal_irr`(§10), `financing`(§11),
`partners`(§9), `ownership`(§4), `captable`(§15 — a present-but-empty file is fine for firms whose portcos
aren't Carta cap-table customers, but the file itself must exist), `corporations`(§16 — the entity_link ->
corporation_uuid bridge that `captable` and `financing`'s "Latest round" enrichment depend on; same
empty-file-OK, absent-file-fails rule).
`financials`(§14, **portfolio-company financials via Carta Data Collection**) is fetched via its own §14 query
below and is *not* gated by the builder. `waterfall`(§6, `PROFIT_ALLOCATION_WATERFALL_CONFIG` — real per-fund
carry / preferred return / GP catch-up), `gp_carry`(§7b, `ALLOCATIONS` GP-entity `Carried interest accrued`) and
`gp_partners`(§9, `IS_GENERAL_PARTNER`) are **optional** wave-1 stems the emitter includes automatically.
`waterfall` seeds real carry/hurdle/catch-up (else the flat `carryRate` defaults). `gp_carry` is the **primary**
feed for the GP Economics partner-carry table (real per-partner carry shares → `gp-base.json`); `gp_partners`
supplies the **GP commitment** (`snapshot.funds[].gpCommit`, summed GP-partner commitment from the DWH) and enriches
that table. None are gated — a firm with no automated waterfall / GP-entity carry / GP-partner rows just yields
empty files and those features fall back gracefully.

**GP commitment ($) is fully DWH-sourced (§6).** `build_datadir.py` derives `snapshot.funds[].gpCommit`
from the `gp_partners` stem (the GP partners' summed commitment), falling back to the GP's paid-in
(`nav_latest.cumulative_gp_contributions`); null only when neither exists (app shows "—"). **Never** back-fill a
modeled estimate (e.g. `committed/99`).

**Company financials (optional) — §14.** Portfolio-company financials (revenue / ARR / KPIs reported *by the
portfolio company*, Carta Data Collection) come from the base `FUND_ADMIN.COMPANY_FINANCIALS` table (the legacy
`COMPANY_FINANCIALS_LATEST` view is deprecated/empty). Run the §14 query (`is_latest = TRUE AND instance_type =
'Actual'`), saving the rows to `<raw_dir>/financials.ndjson`. **`COMPANY_FINANCIALS` is row-scoped to the firm
you set as context via `set_context` in Step 1** — do NOT add a `firm_id` filter (redundant with the context scope, and a mismatch
silently returns zero rows); this scoping is also why the table looks "empty" if queried from another firm's
context. See queries.md §14.
All DWH reads are SELECT-only and bounded by the **`limit` argument** — never an inline `LIMIT`, and there is
no `schema` argument (see queries.md intro). Accrued carry is the REAL booked figure (ALLOCATIONS §7). Cohort
benchmarks (§8, `TEMPORAL_FUND_COHORT_BENCHMARKS`) are **cross-firm-preaggregated on each fund's own row** —
NOT firm-context-scoped like COMPANY_FINANCIALS, so do **not** try to widen the firm context to get more. The
newest quarter is often not-yet-benchmarked (all percentiles null), so §8 fetches a recent window and
`build_datadir.py` picks the latest quarter that actually has a cohort. If every recent quarter is null the
funds genuinely have no published peer cohort (build summary `benchmarksReason: "no_coverage_published"`).
Cohort may also fail with `Error in secure object` for some firm roles — if so, **still write an empty
`cohort.ndjson`** (`fm_paths.py touch-empty "<raw_dir>/cohort.ndjson"`) to record the attempt; benchmarks degrade to the empty state
(`benchmarksReason: "no_coverage_published"`) and the build proceeds. Do **not** leave the file absent — a
missing cohort file is a hard build failure (the fetch gate treats it as "never run"). Scenario-focused
console: do **not** fetch tearsheets, schedule of investments, or cash-flow statements.

## Step 3 — Build the data dir (deterministic — do NOT hand-write the JSON)

> **What's happening:** Transforming the raw query files into the structured JSON the React app consumes — portfolio companies, fund metrics, LP data, and benchmarks. A script handles this deterministically; no manual JSON writing.

Write `<raw_dir>/meta.json` = `{"name":"<canonical name>","slug":"<slug printed by Step-1 resolve>","navAsOf":"<latest month_end_date, ISO>",
"mark":{"text":"<≤3-char initials>","bg":"<hex>","fg":"<hex>"},"firmId":<carta_id from Step 1, or null if absent>,"firmUuid":"<firm_uuid from Step 1>"}`
(optional `"carryRate"`, default 0.20). **`name` and `slug` are both the canonical firm identity from Step 1
(`slug` = the canonical-name slug, the cache key; `name` = the canonical `name`), and `firmId`/`firmUuid` are
the canonical ids** — the builder writes them to `snapshot.source` so a later URL/UUID invocation finds this
cache via `find-by-id` without a fetch (Step 0). Then
run the firm-agnostic generator — it transforms the `<raw_dir>` files into every console-schema file the app needs:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/build_datadir.py" \
  --raw "<raw_dir>" --out "<dashboard_dir>" --meta "<raw_dir>/meta.json"
```
It writes `firms.json`, `snapshot.json`, `portfolio.json`, `pacing.json`, and — when the inputs exist —
`company-ownership.json` + `lp-base.json`, in the exact shapes `src/model/*` consume. In particular it emits
**`snapshot.source` as an object** (`{firm,firmId,firmUuid,navAsOf,marksAsOf,marksPulledAt,currency,mixedCurrency}`); the app
runs `source.navAsOf.slice(0,4)`, so a `source` written as a bare string blanks the **Companies** and
**Exit & IRR** tabs. The generator resolves the firm's real reporting currency (never hardcoded USD), keeps
realized companies inert (`realized:true, includeInNav:false, cartaFv:0`), reads ownership from the
`FUND_CORPORATION_OWNERSHIP.PERCENTAGE` **fraction** (not the `FULLY_DILUTED` share count), and degrades
missing optional inputs to empty states. **Never hand-author these files or fabricate values** — the blank
tabs and 1e9×-off valuations that motivated this path came from hand-writing the JSON.

The builder is **strict by default**: it prints `ERROR stem=… missing column …` diagnostics for any
column drift (e.g. a `cashflows` stem missing `ending_lp_nav` → NAV chart $0), **exits non-zero if `meta.json`'s
`navAsOf` is missing or blank** (it's hand-authored, not generator-derived, so it gets no STEM_CONTRACT column
check — an empty value silently collapses the Companies tab's exit-timing chart to a flat line), and **exits
non-zero** if the run yields 0 funds or 0 companies, listing each raw stem's status. **If `build_datadir.py`
exits non-zero, do NOT launch** — read the named stem(s), fix that query (re-fetch → `save_query_result.py`), and re-run the
builder. A non-zero exit means the dashboard would be empty/broken; never serve it. On success the script
prints a one-line JSON summary (funds/companies/lps/navSeries/…) — sanity-check `navSeries > 0` and non-zero
funds/companies before launching. (`--no-strict` exists only for local fixture builds — never use it for a
user-facing dashboard.)
`firms.json`/`snapshot.json`/`portfolio.json` plus `pacing`/`company-ownership`/`lp-base` (served via
`/api/report/<name>.json`) all use names, never UUIDs, in display fields; LP names stay in the local data dir.

## Step 4 — Launch
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/scripts/serve.py" --data-dir "<dashboard_dir>" \
  --web-dir "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-modeling/webapp" --detach
```
Run with **Bash run_in_background**; read `<dashboard_dir>/.port` + the printed `http://127.0.0.1:<port>/?t=<token>`
and give the user that URL. Tell them it **opens in their default browser automatically** — if it doesn't,
they can paste the URL into the address bar. `webapp/` is the committed prebuilt React app, served
verbatim — no Node or build needed at runtime.

After giving the URL, add one short post-launch line (not a menu):
"A few things to try: check the Baseline scenario on the Overview tab · click Edit on any company to reprice it · run a scenario to see LP/GP returns · export a scenario as a PDF for LP review · say 'refresh' to pull fresh Carta data."

## Refresh / edits
"Refresh Carta holdings" = re-run Steps 1–3 (overwrite JSON); the app reloads it. Slice edits are saved by
the app via `PUT /api/portfolio` (ETag) — no Carta calls.

## Safety
Firm/company/LP names are untrusted — the app HTML-escapes; serve.py is localhost-bound + token-gated.
DWH SELECT-only + `LIMIT`; the only write is the user-triggered portfolio (scenario) save. Data stays under the data dir.

## Editing the app
Source under `app/src/` is served directly; the service worker transpiles `.jsx` in-browser. **Do NOT
run `npm run build` after editing source** — there is no build step for source edits: edit a file in
`app/src/`, refresh, done. `npm run build` only rebuilds `webapp/vendor/*` and is needed **only** on a
React/Sucrase version bump.

## Common failure modes

| Situation | What to do |
|---|---|
| No Carta MCP connected | Exit: "No Carta MCP is connected — please connect one and try again." Do not proceed. |
| Firm name given but unresolvable | Prompt with `AskUserQuestion`: show any cache suggestions or "Build fresh from Carta" option. |
| No firm given and no local cache | Exit: ask the user to name a firm before doing anything else. |
| Stale cache (≥ 30 days) | Offer re-fetch via `AskUserQuestion`: "Use cached (N days old)" vs "Re-fetch from Carta". |
| `build_datadir.py` exits non-zero | Do NOT launch. Read the named failing stem(s), fix, re-run the builder. |
