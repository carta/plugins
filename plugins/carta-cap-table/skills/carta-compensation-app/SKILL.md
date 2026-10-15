---
name: carta-compensation-app
description: >
  Serves a live, clickable CTC console — builds one corporation's Carta Total Compensation
  data into a React app on localhost, where you filter by job area, compare peer groups and
  explore the scorecard yourself. CLAUDE CODE ONLY; it serves a local web app. Use it when
  the ask is to run an app, launch a console, or explore the data live, rather than to be
  told a figure. Invoke with a corporation name or id, e.g. "launch a comp dashboard for Acme".
  Its Benchmarks and Scorecard tabs are surfaces inside the app, not separately routable.
  Route by deliverable, not subject — an answer, CSV or figure to quote belongs to a sibling
  even when the wording overlaps: use carta-compensation-benchmarks for a role's market rate,
  and carta-compensation-scorecard for roster positioning, compa-ratios or who is below market.
  So "what are our comp benchmarks" is a sibling even though it names them, while "open our
  comp benchmarks so I can filter them" is this skill. NOT for a single role lookup. READ-ONLY.
argument-hint: "<corporation name or numeric corporation id — required>"
version: 0.3.0
model: inherit
allowed-tools:
  - mcp__carta__welcome
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  # `fetch` is for MCP *command*-style names (context_tools:get:profile). It is NOT
  # needed for the scorecard commands: read_tool works with the generated tool name,
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
  - mcp__carta-prod__read_tool
  - mcp__carta-prod__fetch
  - mcp__carta-prod__search_tools
  - mcp__carta-prod__list_accounts
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__fetch
  - mcp__claude_ai_Carta__search_tools
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__fetch
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__search_tools
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - Read
  - Write
  - AskUserQuestion
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/ctc_paths.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_roster_page.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_equity_refresh_page.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_report_insights.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_equity_pool_utilization.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_retention_plan.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/ctc_locations.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_corporation_info.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/preflight_claude.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/build_datadir.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/serve.py" *)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.96.13</carta-plugin>

<!-- [PATTERN carta-writing-style v0.0.2] [PATTERN etiquette v0.0.6] [PATTERN text v0.0.8] [PATTERN tables v0.0.12] [PATTERN carta-watermark v0.0.10] [PATTERN base v0.1.0] -->

# CTC Dashboard (local React console)

Builds a corporation's CTC benchmark baseline, writes it to a local data dir in the
**dashboard console JSON schema**, and launches the prebuilt React app via `serve.py`.
**The browser never calls the Carta MCP** — this skill fetches the data; the server only serves
JSON + the app source.

**Read-only.** The `compensation:*` MCP namespace exposes no write commands. This console
displays CTC data and (in later tabs) models scenarios locally. Plan activation, payband edits,
employee edits, offer letters, HRIS resync and every other mutation stay in the CTC product.

> **Plugin root in reference files.** Reference files write the plugin root as a `CLAUDE_PLUGIN_ROOT` variable in braces. Bash does not set that variable, so never run it as written: replace it with the literal plugin root `${CLAUDE_PLUGIN_ROOT}`, keep every quote, and keep the command on one line.

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
`snapshot_benchmark_version_id`, `snapshot_benchmark_version`, `snapshot_skill_version` and
`current_skill_version` without creating anything. Use the printed `dashboard_dir` **verbatim**
— never recompute a cache path.

- `snapshot_age_days=none` with `suggested_match=` lines → did-you-mean picker via
  `AskUserQuestion`.
- `snapshot_age_days=none`, no suggestions → build (Step 1).
- `snapshot_age_days=<N>` → cache hit. **Now run the version gate below** — do not launch on age
  alone.

### The version gate (REQUIRED on every cache hit)

**Age is not freshness**, and there are two independent ways a fresh-looking cache can be stale:
the **benchmark release** it holds, and the **skill version** that built it. Check both before
launching. Neither is visible on screen — a stale dashboard renders perfectly, which is exactly
what makes it worth a gate.

**Age is not freshness.** Carta publishes benchmark releases on its own cadence, and a
corporation's plan can be re-pinned to a newer release at any time — so a cache written
*yesterday* can already be several releases behind. A purely time-based gate serves superseded
percentiles under a citation that names the old release, and the figures look authoritative
because every other part of the dashboard is correct. That is a correctness bug, not a staleness
inconvenience: someone sets salaries from these numbers.

So on a cache hit, make **one** cheap call before launching (Step 1's MCP identification applies):

```
read_tool({"name": "compensation__get__plan",
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

#### Skill version — the second staleness axis (no MCP call)

`resolve` prints `snapshot_skill_version` (what built the cache) and `current_skill_version`
(what a rebuild would produce). Compare them:

| Condition | Action |
|---|---|
| **equal** | Nothing to say. The cache was built by this skill; launch. |
| **differ** | **Tell the user and offer a rebuild** — do not rebuild unprompted, and do not launch silently. One line naming both versions and what it means, then `AskUserQuestion`: rebuild (recommended) vs open the cached build. |
| `snapshot_skill_version=none` | A cache built before the field existed. Same as "differ": say the cache predates version tracking and offer the rebuild. |
| `current_skill_version=none` | The running skill's version could not be read. Say so, skip this check, and fall through to the benchmark gate — never treat unknown as a match. |

**Why offer rather than force**, when a benchmark mismatch re-fetches outright: superseded
percentiles are *wrong*, while a cache from an older skill is *correct but possibly incomplete*.
The figures still tie out; what may be missing is a capability — a tab, a peer-group dimension —
that this version could add. Wrong data justifies spending the user's calls without asking;
missing features do not, especially now that a default rebuild is a ~41-call sweep.

**Say what changed in terms of the dashboard, not the version string.** "Built with skill 0.1.0,
now on 0.2.0" tells the user nothing they can act on. Name the consequence: *"This dashboard was
built before peer-group switching existed, so it has no dimension or bucket pickers. Rebuilding
adds them — about 41 calls, a few minutes."* If you cannot say what a rebuild would add, say that
plainly rather than inventing a benefit.

**Version equality is the signal — do not second-guess it.** This skill's `version:` is bumped
deliberately when a change warrants rebuilding a cache; an unchanged version means the maintainers
judged the change cache-compatible. Never compare timestamps, file contents, or the plugin version
as a substitute — `plugin.json` moves whenever any sibling skill in the plugin changes, which has
nothing to do with this dashboard's data.

> **Bump `version:` in this skill's frontmatter when a change alters what a build produces** — a
> new tab, another data dimension, a different data-dir shape. That bump is the whole mechanism by
> which existing users are told their dashboard can be improved; skip it and they keep opening a
> cache that silently lacks the new capability. Leave it alone for wording, docs and fixes that
> produce a byte-identical build.

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

## Step 0.5 — Preflight: Claude CLI

The ask box, the planner's cohort filter and the Benchmarks location fetch (2d-v) spawn a
`claude` subprocess, and so does `capture_export.py` — the capture route a build takes when
the MCP has no blob delivery (see the capture contract in Step 2). All of them need the
`claude` CLI installed and logged in — the Claude Code binary, from Anthropic. Detect it
early so a missing CLI is resolved before the user waits through the data-fetch cycle.

**This step never fails the skill.** On a cache hit the dashboard is fully functional without
the CLI — only the three console features need it. A build without it still runs: on blob
delivery it never needed a headless session, and without blob delivery it drops to the slow
inline route, which is worth one line to the user.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/preflight_claude.py" check
```

The search covers PATH, the usual install locations, and the binary of the Claude Code
session running this skill (`CLAUDE_CODE_EXECPATH`). That last one means an IDE or desktop
user with nothing on PATH is still found, so `claude_bin=none` should be rare.

- `claude_bin=<path>` → capture the path for Step 4. No output to user, whatever
  `claude_auth=` says. A user who is logged out sees the console's "not supported" message
  in place of the two features; the dashboard itself is unaffected.
- `claude_bin=none` → ask via `AskUserQuestion` before installing anything:
  > "Fetching your data and the chat in the dashboard need the Claude Code CLI (`claude`),
  > which isn't installed here. Want me to install it? (runs Anthropic's installer)"
  - **Yes** → run `preflight_claude.py install`. It uses Anthropic's native installer and
    falls back to npm. Then use the printed path. If it still prints `claude_bin=none`, say
    the install didn't succeed and treat it as **No**.
  - **No** → continue. The dashboard works; the two Claude features show the console's
    "not supported" message, and a build that turns out to need a headless session takes the
    inline route in the capture contract for its benchmark pages. The employee captures (2d,
    2d-bis) have no inline route, so they are skipped and their tabs do not appear.

When Step 4 launches `serve.py`, pass the discovered path as `--claude-bin "<path>"` (only
when a non-`none` path was found). `serve.py` runs the same search itself when it is
omitted, and finds the binary again if the given path disappears (a Claude Code
auto-update deletes old versions), so the flag is a hint rather than a requirement.

**What the user sees when it fails.** The browser gets one message for every failure —
CLI missing, logged out, crashed mid-turn — and never a stuck "Working…" or a raw error. The
specific cause is written to `chat-errors.log` in the dashboard dir. Read that file when a
user reports the chat isn't working, rather than guessing.

**Reused daemon caveat:** if `serve.py` detects an already-running daemon for this corp, it
reuses it and exits. That daemon re-checks the CLI whenever a Claude feature is used while
marked unavailable, so a CLI installed or logged in since then is picked up without a
relaunch.

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

**Don't call any other `mcp__<SERVER>__*` tool before `welcome`** — the server instructions require `welcome` as the first call.

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
   tool, so `read_tool` returns "Unknown tool". If its `corporations[]` is empty, say CTC needs a
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
> **You handle identifiers, counts and file paths. Scripts handle rows.** No benchmark figure
> should ever appear in your reply, in a file you write, or in a heredoc.
>
> **There is exactly one exception, and it is the inline route** at the bottom of this contract —
> the last resort when the MCP has no blob delivery *and* there is no `claude` CLI. There, and
> only there, a page is copied verbatim into a `.raw` file with the Write tool, and the figure
> check in **2f** is mandatory as the compensating control. On every other route, and in every
> reply on every route, the rule above is absolute.
>
> Retyping a payload is
> both the slowest thing this skill can do — a page is ~25k tokens — and the one that silently
> corrupts a salary that then looks authoritative in the dashboard. Composing a result back out
> yourself — a heredoc, a Python literal, a summary — means generating every character of it
> again, and a single wrong digit is invisible.
>
> **Every bulk export asks for `"response_mode": "blob"`.** Those are
> `compensation:export:benchmarks`, `compensation:export:scorecard` and
> `compensation:export:equity-refresh-report` — the only three commands that take the
> parameter. Never send it on a `compensation:get:*` call. The MCP then hands the payload to
> your client, which writes it to a file and shows you only a small ack — row counts, the paging
> cursor, the benchmark release. The rows never enter the conversation at all, so there is
> nothing to reproduce:
>
> ```
> read_tool({"name": "compensation__export__benchmarks",
>            "arguments": {…, "response_mode": "blob"}})
> ```
>
> The result names the file your client saved. Pass **that path** straight to the capture script;
> never reconstruct it, and never open it to look.
>
> ```bash
> uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" --export-page <saved_file_path> "<raw_dir>"
> ```
>
> `--export-page` takes `<raw_dir>` itself, not one `.json` file: a page covers up to 12 job
> areas, and it fans out into one `benchmark_<JOB>.json` per area. For the employee exports use
> `save_roster_page.py --export-scorecard` the same way.
>
> **Verify from the ack, not by eye.** The script prints the job areas and row count it wrote;
> the ack reports `row_count` and `jobs_covered`. Compare them programmatically and re-capture
> on any mismatch. Do not read the file to check it — that puts the payload back in your context,
> which is the whole thing this contract avoids.
>
> #### Everything else, and the fallbacks
>
> **A result the harness persisted to a file.** The tool result says *"Output has been saved
> to …"* or carries `<persisted-output>`, and names a path — `benchmark_locations` arrives this
> way, and so does any result the client judges too big to inline. **Read that path out of the
> message and pass it straight through.** Don't reconstruct it: the location is client-dependent.
> Don't open it to look, and don't hunt for a sibling `*-blob-*.json` — the helper unwraps the
> envelope itself. Name a single `.json` destination, or add `--export-page` with `<raw_dir>`
> when the payload is an export page:
> ```bash
> uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" <printed_result_path> "<raw_dir>/<name>.json"
> ```
>
> **A small inline result** (`subscription_status`, `plan`, `retention-plan`). A result of a few
> fields you only read needs nothing written at all — read the values and move on. When it does
> have to reach disk, Write the tool result **verbatim** to a `.raw` file with the Write tool —
> mechanical reproduction, not retyping — then pass that file to the same command.
>
> **"Mechanical reproduction" reaches those few-field results and nothing else.** It is not a
> general licence to hand-write a small payload. Benchmark rows are written by hand on the inline
> route alone, where **2f**'s figure check is the compensating control. **Employee names,
> salaries and equity holdings have no hand-written route at all, on any route** — 2f does not
> check roster files, so a mistyped salary would reach the dashboard unseen. When a capture of
> employee data has no route available, the step says what to do instead (2d, 2d's paged
> fallback and 2d-bis each spell it out); the Write tool is never the fallback.
>
> #### When the MCP has no blob delivery
>
> **If `response_mode` comes back as an unknown parameter on one of the three exports above**,
> the MCP predates blob delivery and the payload would arrive inline. Only those three carry
> blob delivery, so a rejection anywhere else says nothing about this MCP and must not downgrade
> the route. Capture it with **`capture_export.py`** instead of calling
> `read_tool` yourself: it runs each call in a headless `claude -p` session on the same Carta MCP
> server, checks the arguments the session actually sent, and takes the raw tool result off that
> session's event stream straight to disk, so the payload enters no conversation at all. It needs
> the `claude` CLI from Step 0.5, and it is the same path the console's on-demand location fetch
> uses (`location_fetch.py`).
>
> **`sweep`** — one whole `compensation:export:benchmarks` sweep (2c, 2c-bis, 2d-v):
> ```bash
> uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" sweep --server "<SERVER>" --claude-bin "<claude_bin>" --dest "<dir>" --args '{"corporation_id": <id>, "benchmark_version_id": <id>, "equity_quantity": "FOUR_YEAR_GRANT", "<dimension>_bucket": "<CODE>"}'
> ```
> It pages from `job_offset: 0` at the server's 12-area page until `next_job_offset` is null,
> retries a failed page once, stops at the same `pages + 2` ceiling this skill states everywhere
> else, and fans each page out into `benchmark_<JOB>.json` plus `export_pages.json` exactly as
> `save_benchmark_result.py --export-page` does. It also checks every page came back on the
> pinned `benchmark_version_id`. Leave `job_limit` and `job_offset` out of `--args`; it owns
> paging and refuses them. Leave `response_mode` out too — this route is for an MCP that
> rejects it, so passing it fails every page. Its last line is `sweep COMPLETE — 22 job areas across 2 page(s)`, or
> it exits 1 with `FAILED — <reason>` after removing that sweep's files, so a failed sweep never
> leaves a half-captured group behind.
>
> **`call`** — one read-only `compensation__get__*` / `compensation__export__*` result written
> to a file, which you then pass to the matching `save_*` script as its source path:
> ```bash
> uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" call --server "<SERVER>" --claude-bin "<claude_bin>" --tool compensation__get__plan --args '{"corporation_id": <id>}' --out "<raw_dir>/plan.raw"
> uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" "<raw_dir>/plan.raw" "<raw_dir>/plan.json"
> ```
>
> `<SERVER>` is the identifier from Step 1; `<claude_bin>` is the path from Step 0.5. Exit 2
> means the arguments were wrong — fix them, never retry unchanged. Exit 1 means the fetch failed.
>
> **`FAILED — server_unavailable: <SERVER> is not connected in a headless session; reachable:
> <a>, <b>`** means the headless session names the same Carta MCP differently. A claude.ai
> connector and a locally configured server with the same URL are deduplicated, and the copy
> kept can differ between this session and a headless one (verified: "claude.ai Carta (Test)"
> here, `carta-test` headless, both `mcp.test.carta.rocks`). **Ask via `AskUserQuestion`** which
> of the reachable servers is the same Carta environment as `<SERVER>` — never pick one
> yourself, since a different environment means a different company's data. Use the answer as
> `--server` for every capture in this build, and as `mcpServer` in `meta.json` (2e). If none
> is, stop the build.
>
> **With no blob delivery AND no `claude` CLI**, the inline route is what is left: same call
> without `response_mode`, `job_limit: 6` so **a full sweep is 4 pages**, and each page written
> verbatim to a `.raw` file with the Write tool — and **split the sweep's pages across one subagent each** so the
> reproduction cost is paid once per page rather than page after page in one context. Every call
> ceiling in this skill is stated in terms of the sweep's page count, so on this route they come
> out at **8 calls** for the corp's own group and **6 calls** per alternate bucket or per
> location. Say in one line that the build is on the slow path and why, and offer the CLI install
> from Step 0.5 — a page reproduced by hand is the risk every other route exists to remove.
>
> **On this route the offsets are known in advance, so the pages run in parallel.** `job_limit`
> is fixed at 6 and there are 22 job areas, so the sweep is exactly `job_offset` **0, 6, 12, 18** —
> derivable without following the cursor, which is what `scripts/location_fetch.py` already does
> (`range(0, TOTAL_JOB_AREAS, JOB_LIMIT)`, every page at once). Dispatch all four at once, **one
> subagent per page**, each capturing *its own* `job_offset` and nothing else. A subagent that
> pages onwards from its own offset is the pattern this split exists to remove.
>
> **Completeness is then proved from the captured pages, not from a cursor.** The orchestrator
> saves the returned `.raw` files in ascending offset order via
> `save_benchmark_result.py --export-page`, so the manifest's last entry is the final page and
> `export_pages.json` reports `sweep_complete: true`; then it reads that manifest and confirms the
> union of every page's `jobs_covered` + `jobs_empty` equals `total_job_areas` (22) — the same
> check `_check_sweep` in `location_fetch.py` runs over its parallel pages. `build_datadir.py
> --check` refuses to build on a manifest that says otherwise, so a sweep that stopped short
> cannot pass silently.
>
> **This route only ships behind the 2f figure check.** It is the one place a payload passes
> through a model, so the check over every captured directory is not optional here: run it before
> `build_datadir.py`, and if it reports any anomaly, re-capture the directory holding the flagged
> file rather than building over it.
>
> The helper unwraps every shape (bare JSON, content blocks, base64 `resource.blob`,
> string-valued `result`, the columnar export envelope) and **exits 2 rather than write something
> the builder would misread**.
>
> **If you find yourself about to type benchmark numbers or employee rows into a file — a
> heredoc, a Python literal, anything you compose rather than copy — stop.** You are in the
> failure mode this contract exists to prevent.

**2a. Subscription gate (REQUIRED — do this before anything else).**

```
read_tool({"name": "compensation__get__subscription_status",
           "arguments": {"corporation_id": <corporation_pk>}})
```

It returns `{corporation_id, has_ctc_access, is_subscribed}`.

- `has_ctc_access: true`, `is_subscribed: true` → continue.
- `has_ctc_access: true`, `is_subscribed: false` → stop, surface the subscription message, fetch nothing.
- `has_ctc_access: false` → the caller has no CTC role on this corp (`is_subscribed` is `null`). Stop; do not retry.

A corp with no subscription has no benchmark data, so every later call would be wasted.

**2b. Plan.** It is a small result, so the capture contract's small-result route applies: pass
the harness's printed path, or Write the result verbatim to `<raw_dir>/plan.raw`, then normalize:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" <result_path> "<raw_dir>/plan.json"
```

On the no-blob route, fetch it with `capture_export.py call` instead — which doubles as the
check that headless capture works here at all, before the sweeps depend on it:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" call --server "<SERVER>" --claude-bin "<claude_bin>" --tool compensation__get__plan --args '{"corporation_id": <corporation_pk>}' --out "<raw_dir>/plan.raw"
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" "<raw_dir>/plan.raw" "<raw_dir>/plan.json"
```

Capture from it: `benchmark_version.id` (pins 2c) and `peer_group.{code,label,dimension}`. If
`dimension` is missing or is not one of `post_money` / `capital_raised` / `headcount`, **stop** —
guessing produces numbers that don't match the product UI.

**2c. Benchmarks — paged bulk export, not one call per job area.**

There are **22 job areas** (listed in `references/queries.md` §3), but the fetch is now
`compensation:export:benchmarks` — a bulk **columnar** export that returns several job areas'
full matrices (every level, both the IC and LEADER ladders) in one response, replacing the old
one-call-per-job-area sweep.

**Take the server's full page: omit `job_limit`, starting at `job_offset: 0`.** It defaults to
12, its own per-response cap, so a full sweep is **2 pages** (22 areas).

> **The page size is bounded by the server's cap, not by time.** An explicit `job_limit` above
> 12 is a 400 rather than being clamped, so there is no bigger page to ask for. Under
> `response_mode: "blob"` the response size does not bind either — the payload goes to a file,
> not into your context.

Call it with `equity_quantity: "FOUR_YEAR_GRANT"`, `benchmark_version_id`, exactly one
`<dimension>_bucket` param, `job_offset`, and `"response_mode": "blob"`. On the no-blob route,
`capture_export.py sweep` sends the same fixed arguments from `--args`, **minus
`response_mode`** — that MCP rejects it, which is why this route is in play — and owns
`job_offset` and the page size itself.

> **PAGING IS THE DEFAULT, not an opt-in.** A response that omits `jobs`/`job_limit` is the FIRST
> PAGE — not the whole matrix. There is no way to get all 22 areas in one call.
>
> **On the blob route, keep calling with `job_offset` = the previous response's `next_job_offset`
> until that field comes back `null`.** The page size is the server's, so the page count is not
> something to assume. `total_job_areas` tells you how many exist overall (22), so you can tell a
> stalled sweep from a finished one without counting job names yourself. Treating one response as
> the complete cube would silently publish 12 of 22 job areas as if it were everything — this is
> the exact failure mode the paging discipline below exists to prevent. `capture_export.py sweep`
> applies the same discipline on its own behalf.
>
> **On the inline route the page size is yours (`job_limit: 6`), so the offsets are fixed at 0, 6,
> 12, 18** and the four pages are fetched in parallel rather than one behind the next. Nothing
> there follows a cursor, so completeness is proved from the captured pages instead: save them in
> ascending offset order and confirm `export_pages.json` reports `sweep_complete: true` with the
> union of every page's `jobs_covered` + `jobs_empty` equal to `total_job_areas`.

Capture the corp's own group into the raw dir itself:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" --export-page <saved_file_path> "<raw_dir>"
```

Pass it the path your client saved the blob to (or a harness-persisted result path), and give it
`<raw_dir>` itself as the destination, not a single `.json` file. It fans one page out into
one `benchmark_<JOB>.json` per job area the page covered (matching the per-job-area files the old
sweep produced, so `build_datadir.py` is unchanged), and appends the page's paging metadata to
`<raw_dir>/export_pages.json`. It prints whether the sweep is COMPLETE or INCOMPLETE after every
page — **read that line**; it is the authoritative answer to "am I done paging."

On the no-blob route the whole sweep is one command, which writes the same files and prints
`sweep COMPLETE` once:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" sweep --server "<SERVER>" --claude-bin "<claude_bin>" --dest "<raw_dir>" --args '{"corporation_id": <id>, "benchmark_version_id": <id>, "equity_quantity": "FOUR_YEAR_GRANT", "<dimension>_bucket": "<plan peer_group.code>"}'
```

> **Never echo benchmark figures into the conversation** — they belong in the data dir. The
> script prints job-area and row counts only; report progress the same way.

**How the corp's own group is fanned out, per route** — the same three answers as the alternates
in 2c-ter, applied to this one sweep:

- **Blob route — parallel tool calls, no subagents.** Nothing reaches your context but acks.
- **`capture_export.py` route — one Bash call.** The script owns the whole sweep.
- **Inline route — one subagent per page, all four in parallel.** Offsets 0, 6, 12, 18 are known
  up front, so each subagent captures exactly its own `job_offset` to
  `<raw_dir>/page_<offset>.raw` and reports that path and nothing else; you then run
  `save_benchmark_result.py --export-page` over those files **in ascending offset order** and
  check the manifest. Brief each subagent per 2c-ter.

**Then check coverage:**

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/build_datadir.py" --raw "<raw_dir>" --check
```

Same four lines as before (`captured` / `empty` / `CORRUPT` / `plan.json`), plus a fifth when the
raw dir was fetched via the export: `EXPORT SWEEP: <warning>` if the last page's `next_job_offset`
was still non-null. `build_datadir.py` **refuses to build** in that state even if every
`benchmark_<JOB>.json` file happens to exist, so a build can never publish a sweep that was cut
short mid-page.

**Mid-sweep a non-zero exit is expected** — before the final page, most areas are legitimately
still `MISSING`. Only the **final** check needs to come back clean (exit 0). Do not treat a
non-zero exit between pages as a failure and re-fetch what you already have. On the no-blob
route there is nothing to check between pages: `capture_export.py` either prints `sweep
COMPLETE` or exits 1 with `FAILED — <reason>`, having already retried the failing page once and
removed the partial files.

**When a page-level call fails** (403, 5xx, timeout, malformed response):

1. **Retry that page once**, same arguments (same `job_offset`) — or, on the no-blob route, run
   the sweep once more. Transient 5xx and timeouts usually clear.
2. **Never fall back to per-job-area `compensation:get:benchmark` calls, or to calling the export
   yourself to route around a failing sweep.** That is the ~22-call pattern this command exists
   to replace — if the export is failing, the fix is the export call's arguments (wrong
   `benchmark_version_id`, bad bucket param, auth), not a different endpoint or a different
   capture route.
3. **If a page fails twice**, stop before building and surface the error — a full sweep is only a
   couple of pages, so a page that won't succeed after a retry means something systemic, not bad
   luck on one of 22 job areas. A timeout is NOT a reason to reach for a different `job_limit`:
   12 is the server's own per-response cap, anything above it is a 400, and the payload goes to a
   file rather than into the response, so page size is not what is costing you the time.

A hard ceiling regardless of outcome: **at most `pages × 2` export calls per build** for the
corp's OWN group — every page in the sweep retried at most once. On the blob path a sweep is 2
pages, so that is **4 calls**; on the inline fallback it is 4 pages, so **8 calls**. On the
no-blob route that budget is the script's own, so the ceiling is **2 sweeps**. Alternates in
2c-bis carry their own ceiling. If you're about to exceed either, stop and report — you're in a
retry loop.

**The ceiling is per SWEEP, not per subagent.** It counts every export call made for this group
however the work was split, so the inline route's four page subagents share the same 8 calls
between them — one page each plus a retry — rather than getting 8 apiece.

**2c-bis. The other buckets in the corp's dimension — this is what turns on the peer-group
dropdowns.**

The Benchmarks tab has a dimension picker and a bucket picker, and **it hides both unless the
data dir contains more than one peer group.** They read `alternatePeerGroups`, which
`build_datadir.py` assembles from `peer_<CODE>/` subdirectories of the raw dir. Fetch nothing
here and the controls never appear — not broken, just nothing to switch between.

So: after the corp's own sweep is COMPLETE, **sweep every other bucket in the same dimension.**
Same `benchmark_version_id`, same `equity_quantity: "FOUR_YEAR_GRANT"`, and the same paging
discipline the route in play calls for (2c-ter spells each one out: `"response_mode": "blob"`
with `job_limit` omitted and page-until-`next_job_offset`-is-null on the blob route; the same
`--args` **without `response_mode`** on the `capture_export.py` route, where the script owns
paging; `job_limit: 6` at the fixed offsets on the inline route). The only thing that changes
is the `<dimension>_bucket` value. The codes, in order, per dimension:

| Dimension | Bucket codes (low → high) |
|---|---|
| `post_money` | `ONE_MILLION`, `TEN_MILLION`, `TWENTY_FIVE_MILLION`, `FIFTY_MILLION`, `ONE_HUNDRED_MILLION`, `TWO_HUNDRED_FIFTY_MILLION`, `FIVE_HUNDRED_MILLION`, `ONE_BILLION` |
| `headcount` | `ONE_TO_TWENTY_FIVE`, `TWENTY_FIVE_TO_HUNDRED`, `HUNDRED_TO_FIVE_HUNDRED`, `GREATER_THAN_FIVE_HUNDRED` |
| `capital_raised` | `ONE_TO_TEN_MILLION`, `TEN_TO_TWENTY_FIVE_MILLION`, `TWENTY_FIVE_TO_FIFTY_MILLION`, `FIFTY_TO_ONE_HUNDRED_MILLION`, `ONE_HUNDRED_TO_TWO_HUNDRED_MILLION`, `GREATER_THAN_TWO_HUNDRED_MILLION` |

**Sweep all three dimensions, not just the plan's.** The app has a dimension picker as well as
a bucket picker, and it offers whatever dimensions the data dir contains — so fetching only the
plan's dimension leaves that control with one option, which is the same dead-end the bucket
picker had. Post-money valuation, headcount and capital raised are all real ways a customer
asks "who are we being compared against", and the builder already labels each group with its
own dimension and citation phrase.

The bucket param name changes with the dimension — **exactly one** per call:

| Dimension | Param |
|---|---|
| `post_money` | `post_money_bucket` |
| `headcount` | `headcount_bucket` |
| `capital_raised` | `capital_raised_bucket` |

**The plan's own dimension still leads.** The builder puts it first in the picker and the corp's
own bucket stays the default, because that is the peer set the plan actually chose — switching
bucket asks "what if we were valued higher?", while switching dimension changes what a peer *is*.
Both are legitimate; only one is the default.

> **A bucket label alone is ambiguous across dimensions.** `$1M-$10M` exists in both post-money
> and capital raised, and on a real corp they return different figures (167,000 vs 144,000 for the
> same role). That is why each group carries its own dimension and citation, and why the CSV
> filename includes the dimension. Never describe a group by its bucket label alone.

Capture each bucket into its OWN subdirectory — `--export-page` and `--dest` both take the
destination, so point it at `peer_<CODE>/` instead of the raw dir, with that dimension's bucket
param in the call:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" --export-page <saved_file_path> "<raw_dir>/peer_<CODE>"

# no-blob route — one command per bucket, same destination:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" sweep --server "<SERVER>" --claude-bin "<claude_bin>" --dest "<raw_dir>/peer_<CODE>" --args '{"corporation_id": <id>, "benchmark_version_id": <id>, "equity_quantity": "FOUR_YEAR_GRANT", "<dimension>_bucket": "<CODE>"}'
```

Use the bucket code **exactly** as spelled above: `build_datadir.py` reads the code back out of
the directory name to look up that group's label and dimension, so `peer_one_million` or
`peer_ONE-MILLION` lands as an unlabelled group in the switcher.

**Skip the corp's own bucket** — it is already the flat `benchmark_*.json` set at the top of the
raw dir, and fetching it twice would put the same group in the dropdown twice.

> ### Sweep ALL dimensions and ALL buckets by default
>
> **Unless the user has asked for something narrower, fetch every bucket in all three
> dimensions.** Do not ask first, and do not quietly pick a cheaper scope on their behalf — a
> partial sweep is the one outcome that looks like a broken app rather than a saved call. With
> one dimension the dimension picker renders a single option and hides; with one bucket both
> pickers hide, and the user sees a dashboard with no peer-group controls at all and no
> indication that anything was skipped.
>
> Narrow **only** on an explicit instruction ("just post-money", "skip the alternates", "keep it
> quick"). Then say which scope you used and which pickers it leaves empty, so the absence is a
> stated choice rather than a silent gap.

**Cost, and why it is no longer a reason to ask.** There are 18 buckets across the three
dimensions (8 post-money, 4 headcount, 6 capital raised), each a full 2-page sweep: **17
alternates × 2 = 34 extra calls**, against the ~7 for the corp's own group.

Sequentially that is minutes of wall clock, which is the cost "ask first" was protecting
against. **Run the sweeps in parallel instead** (2c-ter) and those 34 calls cost roughly one
bucket's wall clock, because buckets are independent. Parallelism, not a smaller scope, is the
answer to the cost.

| Scope | Calls | What the pickers show |
|---|---|---|
| **All three dimensions (DEFAULT)** | ~34 (17 alternates × 2 pages) | Both pickers fully populated |
| Own dimension, all buckets | ~6–14 (3–7 alternates × 2) | Bucket picker works; dimension picker hides |
| Adjacent buckets only | ~4 (2 alternates × 2) | Three buckets in one dimension |
| Own bucket only | 0 extra | Neither picker appears |

The per-dimension figures differ — post-money has 7 alternates (~14 calls), capital raised 5
(~10), headcount 3 (~6) — so quote the number for the dimension actually in play rather than
34 for all three.

A verified reference point: on corp 7 the full 18-bucket sweep completed with every page
returning 200, so the scope is known to finish rather than being a guess.

Ceiling for this step: **at most `pages + 2` export calls per bucket** — the sweep's pages plus
two retries to spend anywhere in it, so **4 calls** for the 2-page blob sweep and **6** for the
4-page inline fallback, and **one sweep per bucket** on the no-blob route, where
`capture_export.py` holds itself to that same budget — and **stop the whole step after 3
consecutive buckets fail**. A systemic failure — wrong `benchmark_version_id`, auth, a bad bucket
param — will fail on every bucket, and grinding through 17 of them wastes ~70 calls (17 × the
4-call blob ceiling) to learn what the second one already told you. It is a budget for the
bucket's whole sweep, however that sweep was split: the inline route's four page subagents share
those 6 calls, they do not each get 6.

**A failed alternate is not a failed build.** Alternates are additive: the corp's own group is
already captured and the dashboard is complete without them. If a bucket's sweep won't finish,
delete its `peer_<CODE>/` directory (the script has already emptied it) and move on — `build_datadir.py` already drops an
alternate with no rows and warns rather than publishing a group that renders as a blank grid,
but removing the directory keeps the warning list honest about what you actually attempted.
Report which buckets are in the switcher and which you dropped.

**2c-ter. Run the alternates in parallel.**

**Do the alternates in parallel.** Buckets are independent — each is a self-contained sweep
writing to its own `peer_<CODE>/` directory, with no shared state and no ordering between them.
Running them one after another is the slowest possible arrangement, and wall clock is the only
thing that ever made this step worth asking about. **How you parallelise depends on the capture
route.**

**Blob route — parallel tool calls, no subagents.** The payload never reaches you: the MCP hands
each page to the client, which writes it to a file, and you see only the ack. There is nothing to
keep out of your context, so delegating a bucket buys 17 extra contexts — each loading the
capture contract and a brief — and buys no safety. Issue the export calls as **parallel tool
calls** instead: every bucket's `job_offset: 0` together in one message, each followed by its own
`save_benchmark_result.py --export-page <saved_path> "<raw_dir>/peer_<CODE>"`; then every
bucket's `next_job_offset` the same way, until each bucket's `next_job_offset` comes back null.
A 2-page sweep across 17 buckets is a handful of turns.

**`capture_export.py` route — parallel Bash calls, no subagents.** Issue the alternates' sweep
commands several in one message, about 6 at a time, until all 17 have run. The script keeps
payloads out of every conversation, so a subagent there adds cost and a place for a brief to
drift without making capture any safer.

**Inline route — one subagent per PAGE, every page in parallel.** This is the only route where
delegating pays for itself: a page's payload would otherwise pass through the orchestrator twice
(once arriving, once being written back out by hand), and each hand-reproduced page is an
opportunity to corrupt a salary figure. The point of delegating here is that **no single context
reproduces more than one payload**, so a subagent handed a whole bucket — writing its four pages
out one after another — is the "page after page in one context" pattern the capture contract
rules out, on the one route where nothing but 2f catches a mistyped figure.

`job_limit` is 6 and there are 22 job areas, so a bucket's offsets are **0, 6, 12, 18** before a
single call is made — no cursor to follow, exactly as `location_fetch.py` computes
`range(0, TOTAL_JOB_AREAS, JOB_LIMIT)` and runs those pages at once. Dispatch all four together,
one subagent each. Each returns the path of the `.raw` file it wrote
(`<raw_dir>/peer_<CODE>/page_<offset>.raw`) and nothing else, so every payload lives in exactly
one context. Keep the fan-out to one bucket's four pages at a time and move bucket by bucket —
17 buckets dispatched at once would be 68 contexts in flight for no extra safety.

**You save the pages, in ascending offset order.** Run
`save_benchmark_result.py --export-page <raw_dir>/peer_<CODE>/page_<offset>.raw
"<raw_dir>/peer_<CODE>"` yourself, offset 0 first and offset 18 last — the manifest records the
last page saved as the sweep's end, and concurrent saves into one directory would also race on
`export_pages.json`. You are passing paths, not reading payloads, so the capture contract holds.

**How an inline sweep proves it covered all 22 areas.** Not by a cursor coming back null —
there is none. Read `peer_<CODE>/export_pages.json` after the saves and require both: the union
of every page's `jobs_covered` + `jobs_empty` equals `total_job_areas` (22), and
`sweep_complete` is `true`. That is the same test `_check_sweep` applies in `location_fetch.py`
to its own parallel pages. A missing offset shows up as a short union; `build_datadir.py --check`
then refuses the build, so a bucket that stopped short is re-run or dropped, never published.

**Do the version gate ONCE, before starting any sweep.** Resolve the corporation, run Step
2a/2b, and pass the same pinned `benchmark_version_id` to every sweep. The script refuses a page
from any other release, so a release published mid-sweep fails that bucket rather than leaving
buckets that silently disagree across the picker. Seventeen sweeps each re-fetching `get:plan`
would be 17 wasted calls on top of that.

Every bucket's sweep needs the following, and on the inline route — where the unit of delegation
is one page, not one bucket — each page subagent's brief must spell all of it out:

- Its bucket code(s), and **the matching bucket param for that dimension** — `post_money_bucket`
  / `headcount_bucket` / `capital_raised_bucket`, exactly one per call.
- The pinned `benchmark_version_id`, `corporation_id`, and `equity_quantity: "FOUR_YEAR_GRANT"`.
- The absolute raw-dir path, and the destination `<raw_dir>/peer_<CODE>` — the code spelled
  **exactly** as in the table above, since the builder reads the dimension and label back out of
  the directory name.
- The paging discipline **for the route in play** — the three routes differ here:
  - **Blob route:** `"response_mode": "blob"` with `job_limit` omitted, so the server's 12-area
    page applies, and **page until `next_job_offset` is null**, however many pages that takes.
    The page size is the server's and must not be assumed.
  - **`capture_export.py` route:** no `response_mode` in `--args`, since this MCP rejects it.
    The script owns `job_offset` and the page size, and pages until `next_job_offset` is null
    on your behalf.
  - **Inline route:** `job_limit: 6` and no `response_mode`, and the subagent captures **exactly
    its own `job_offset` and nothing else** — never the next page, whatever `next_job_offset`
    says. You derive the offsets (0, 6, 12, 18) and verify coverage from the manifest afterwards.
- **The capture contract, in full.** Pass the saved file path to
  `save_benchmark_result.py --export-page`; never retype or summarise a payload. On the inline
  route the subagent's job ends at writing its page verbatim to
  `<raw_dir>/peer_<CODE>/page_<offset>.raw` and reporting that path — you run the save script,
  in offset order, so the manifest is written once and in sequence.
- **A verification step, done by PARSING — not by eye.** The script prints the job areas and row
  count it captured; parse the response's own `jobs_covered` and `row_count` and compare them
  programmatically, then re-capture on any mismatch rather than proceeding. Say
  this explicitly in an inline-route brief: an agent told only to "confirm the counts match" will skim two
  numbers that look alike, and a single transposed digit inside a 100-row page changes neither
  the row count nor the job list. Structural comparison is what catches a payload that arrived
  intact but was written back wrong — the one failure the capture contract exists to prevent, and
  one that a real sweep has already produced and caught this way. On the inline route the
  subagent reports its page's own `job_offset`, `jobs_covered`, `next_job_offset` and `row_count`
  — metadata, never figures — and you compare those against what the save script prints for that
  page, re-capturing that offset on any mismatch.
- The per-bucket ceiling — **`pages + 2` calls**, i.e. the sweep's own page count plus two
  retries (4 calls for a 2-page sweep, 6 for a 4-page one), **shared across the bucket's page
  subagents rather than granted to each** — and the instruction to delete a partial
  `peer_<CODE>/` and report it rather than leaving it half-swept.
- **Never echo benchmark figures into the conversation or into a subagent's report** — the same
  rule that applies here. Report bucket codes, page counts and row counts only.

The figures themselves are checked once, over every captured directory, in **2f** — after the
locations in 2d-v have landed and before `build_datadir.py` runs.

**Verify the fan-out centrally once the sweeps return.** Do not trust a subagent's report alone —
read each bucket's `peer_<CODE>/export_pages.json` and confirm `sweep_complete: true`. A retried page
can appear twice in a manifest's `pages` list; that is harmless, because a re-capture overwrites
the same per-job-area files rather than appending, but a manifest whose `sweep_complete` is
false means that bucket really is short and must be re-run or dropped. On the inline route also
confirm the union of each manifest's `jobs_covered` + `jobs_empty` equals `total_job_areas` —
with no cursor to run out, a page subagent that never returned shows up only as a gap in that
union. Then run
`build_datadir.py --raw "<raw_dir>" --check` once over the lot, and say which buckets you
dropped.

**2d. Employee list — one bulk export (feeds the Scorecard tab).**

Fetch this on **every build**, not on request. It is what makes the Scorecard tab exist, and
because a warm cache launches without re-fetching data (Step 0 spends one call on the version
gate only), a build that skips it produces a dashboard whose Scorecard tab is missing for the
next 30 days with no way for the user to ask for it short of an explicit "refresh".

Call **`compensation:export:scorecard`** with just `corporation_id`. It returns every
benchmarked employee in ONE columnar response — no `page`, no `page_size`, nothing to page
through. Capture it with the export flag:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_roster_page.py" --export-scorecard <saved_file_path> "<raw_dir>"

# no-blob route:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" call --server "<SERVER>" --claude-bin "<claude_bin>" --tool compensation__export__scorecard --args '{"corporation_id": <id>}' --out "<raw_dir>/roster_export.raw"
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_roster_page.py" --export-scorecard "<raw_dir>/roster_export.raw" "<raw_dir>"
```

Ask for `"response_mode": "blob"` here too and pass the path your client saved. The capture
contract applies in full: the employee list is names and salaries, so it is never written out by
hand. Pass `<raw_dir>` itself as the destination, not a single `.json`. The script writes
`<raw_dir>/roster_pages.json` in the same schema the paged path produces, so `build_datadir.py`
does not care which route was used.

With neither — no blob delivery and no `claude` CLI — this export has no capture route: it is
employee names and salaries, and the inline route's hand-written `.raw` file is for benchmark
pages only, so stop the roster and build without the Scorecard tab as below. Say so in one line.

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

Fetch `compensation:get:employee-scorecard` with **`page_size: 10`**, then page with
`page: 2, 3, …`. Capture **every page** through `capture_export.py call`, on every route.
`get:employee-scorecard` has no blob delivery, so **do not pass `response_mode`** here — a
rejection would be read as "this MCP predates blob delivery" and downgrade the whole build, and
an ignored one would land names and salaries inline with nothing but hand-copying left. If the
harness persists a page to a file instead, pass that printed path. With neither — no `claude`
CLI and nothing persisted — this fallback has no capture route: these pages are employee names
and salaries, and the inline route's hand-written `.raw` file is for benchmark pages only, so
stop the roster and build without the Scorecard tab as below. Then save each page (no
`--export-scorecard` flag):

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" call --server "<SERVER>" --claude-bin "<claude_bin>" --tool compensation__get__employee-scorecard --args '{"corporation_id": <id>, "page": <n>, "page_size": 10}' --out "<raw_dir>/roster_page_<n>.raw"
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_roster_page.py" "<raw_dir>/roster_page_<n>.raw" "<raw_dir>"
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

**2d-v. Locations — the Benchmarks tab's Location dropdown.**

The CTC product's Benchmarks page offers every supported location and re-fetches when one
is picked; the server applies that location's scalar, the plan threshold, bands and
rounding. The console does the same: it lists every supported location, and fetches a
picked one on demand (`scripts/location_fetch.py`) through the user's own Carta MCP, with
the same `location` value the product sends. Every figure on screen is still the server's.

**First, save the location list.** One call, with the id from the plan's
`benchmark_version.geo_adjustment_version.id`:

```
read_tool({"name": "compensation__get__benchmark_locations",
           "arguments": {"geo_adjustment_version_id": <geo_adjustment_version.id>}})
```

The result is ~65KB, so the harness saves it to a file. Pass the printed path straight to
`save_benchmark_result.py` — don't open the file, and don't reconstruct the path:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" <printed_result_path> "<raw_dir>/location_catalog.json"
```

If it arrives inline instead, fetch it with `capture_export.py call` (`--tool
compensation__get__benchmark_locations`) and pass the `--out` file — never write it out yourself.

If the plan has no `geo_adjustment_version`, or the command is unknown (an older Carta
MCP), skip this: the console then offers only the locations fetched below.

**Then fetch where the employees are, ahead of time,** so the common picks open at once.
Run this after the roster (2d), which is where that list comes from:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/ctc_locations.py" plan --raw "<raw_dir>"
```

It prints `default=<label>` (the location the main sweep already covers — San Francisco),
then one line per location still to fetch:

```
location=Tulsa,OK,USA	dir=<raw_dir>/geo_tulsa-ok	employees=37	label=Tulsa, OK
```

and `to_fetch=N`. It also writes each `geo_<slug>/location.json`. Re-running it after a
partial sweep lists only what is left.

For each line, run a full sweep exactly like 2c — same `benchmark_version_id`,
`equity_quantity: "FOUR_YEAR_GRANT"`, the plan's own `<dimension>_bucket`, and on the blob route
`job_limit` omitted with `"response_mode": "blob"`, **paging until `next_job_offset` is null**
however many pages that takes (on the `capture_export.py` route the same `--args` **without
`response_mode`**, which the script pages itself; on the inline route, `job_limit: 6` and the
fixed offsets 0, 6, 12, 18) — adding **`"location": "<location>"` verbatim** from the line, and capturing
every page into that line's `dir`:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_benchmark_result.py" --export-page <saved_file_path> "<dir>"

# no-blob route — one command per location:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" sweep --server "<SERVER>" --claude-bin "<claude_bin>" --dest "<dir>" --args '{"corporation_id": <id>, "benchmark_version_id": <id>, "equity_quantity": "FOUR_YEAR_GRANT", "<dimension>_bucket": "<plan peer_group.code>", "location": "<location>"}'
```

Either route keeps that dir's `location.json`. The capture contract, the parsed verification and
the per-sweep ceiling (**`pages + 2` calls** for the whole location however it was split — 4 for
the 2-page blob sweep, 6 for the 4-page inline fallback, one sweep per location on the no-blob
route) are the same as for peer groups, and the sweeps run in parallel the same way, per route
(2c-ter): parallel tool calls on the blob route, parallel Bash on the `capture_export.py` route,
and on the inline route **one subagent per page** — the four fixed offsets dispatched at once,
each subagent writing only its own page to `<dir>/page_<offset>.raw`, with you saving them in
ascending offset order and proving coverage from `<dir>/export_pages.json` exactly as in 2c-ter.
These directories are covered by the 2f figure check along with everything else.

- **Everything else is fetched when picked.** With the list saved and `mcpServer` in
  `meta.json` (2e), the console fetches any other location, any alternate peer group's
  figures for a location, and an international market's local-currency figures on demand,
  in about 15-40 seconds. That needs the `claude` CLI (Step 0.5); without it the picker
  says the fetch isn't supported in this setup.
- **These ahead-of-time sweeps are USD, for the plan's own peer group.** An international
  market opens in local currency, as in the product, which is a fetch on first pick.
- **A location that won't complete is dropped, not padded.** Delete that `geo_<slug>/`
  directory's pages (keep `location.json`) and say which location is missing; the builder
  also omits any location whose sweep is incomplete or from another release.
- **Never add a location that was not fetched**, and never derive one from another's
  figures and a scalar — see "Changing the app" below.

**2d-bis. Equity refresh report** — the Refresh planner tab.

> **Run this when the caller asked for the planner.** Otherwise skip it: the tab is
> still hidden by default (`app/src/App.jsx` → `SHOW_REFRESH_PLANNER = false`), so
> for an ordinary build the capture is wasted work.
>
> A **staff** caller who asks to QA the planner gets both halves — this capture AND
> the preview key in `meta.json`. See the staff-preview note under Step 2e. Doing
> only the key produces a visible tab with no `planner.json` behind it, which reads
> as a broken feature rather than a hidden one.

Call `compensation:export:equity-refresh-report` — generated tool name
`compensation__export__equity-refresh-report` — with `corporation_id`. It takes no
other arguments: no paging, no filters, one response carrying every benchmarked
employee. Then:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_equity_refresh_page.py" "<result path>" "<raw_dir>"
```

Ask for `"response_mode": "blob"` here too — this is one of the three commands that take it —
and pass the path your client saved as `<result path>`. If the MCP rejects `response_mode`,
capture it with `capture_export.py call` and hand the script that `--out` file:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/capture_export.py" call --server "<SERVER>" --claude-bin "<claude_bin>" --tool compensation__export__equity-refresh-report --args '{"corporation_id": <id>}' --out "<raw_dir>/equity_refresh.raw"
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_equity_refresh_page.py" "<raw_dir>/equity_refresh.raw" "<raw_dir>"
```

With neither — no blob delivery and no `claude` CLI — this report has no capture route: it is
employee names, salaries and equity holdings, and the inline route's hand-written `.raw` file is
for benchmark pages only, so stop the capture and build without the planner tab as below. Say so
in one line.

Three things that will bite:

- **It is staff-gated.** A non-staff caller gets a permission error, not an empty
  list. Say so plainly and build without the planner rather than reporting that the
  corporation has no employees.
- **`400` "at most 190 fit in one export response"** means the corporation is too
  large. There is no paged fallback for this report — say which corporation and
  stop, rather than narrowing the list, which would silently drop people from a
  refresh cycle.
- **The figures are the report's own.** They tie out against CTC's Equity Refresh
  Report; pass them through unchanged and never re-derive one.

`build_datadir` treats the report as optional — with no capture it records
`hasPlanner: false` and the tab does not appear.

> **When the workflow ships**, flip `SHOW_REFRESH_PLANNER` to `true` and delete the
> staff-preview note under Step 2e. Both must move together, or the docs will
> promise a tab the app does not show, or vice versa.

**2d-ii. The equity pool (optional).** The planner's review step measures a plan's
draw against the corporation's available pool — the same figures the CTC product
UI's Refresh Grant Planner "Equity pool impact" tile renders. Read them from the
carta-web endpoint the product UI itself uses (`equity_pool_utilization`), so the
microapp ties out against the product to the share.

Fetch via the MCP:

```
read_tool({"name": "cap_table__get__equity_pool_utilization",
           "arguments": {"corporation_id": <corporation_pk>}})
```

Then always hand the result to the capture script — the script owns the
null-vs-zero decision:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_equity_pool_utilization.py" "<result path>" "<raw_dir>"
```

Skip the whole step only when the MCP call itself failed (no result path to
hand it). The review step then states that no pool figure is in the build
instead of showing a guardrail — a live cache miss and a corporation whose
ledger reports no pools sum to exactly `0`, and neither is "this company has no
shares left", so neither is ever rendered as a zero balance.

> **Do NOT source the pool from `compensation:get:reports-insights.efab.*`.** That
> reads a different (compensation-service Redis) snapshot warmed by an out-of-band
> job — it can drift from the product UI. The `reports-insights` command is still
> useful for the two `num_employees` counts it also returns, but not for the pool.

**2d-iii. Corporation equity units (optional).** The planner can show grants as
shares, fully diluted ownership or an equity value, matching CTC's own Equity Unit
dropdown. The last two need a fully diluted share count and a per-share value that
the refresh report does not carry.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_corporation_info.py" "<result path>" "<raw_dir>"
```

The source is the corporation info endpoint. **The price is not a choice** — it is
resolved server-side from the corporation's own settings, so picking between the
preferred price and the 409A value here would disagree with every other CTC
surface.

Skip it otherwise. A unit whose input is missing is dropped from the toggle rather
than shown as `$0` or `0.0000%`, exactly as the product does.

**2d-iv. Refresh grant policy (planner-only).** The Settings step of the Refresh
Grant Planner applies the corporation's refresh grant policy — target %, cadence,
tenure gate and the recommended corridor. Without this capture the step falls back
to a "policy could not be fetched" banner and disables its controls.

Run this whenever 2d-bis ran (i.e. the caller asked for the planner). Skip otherwise.

```
read_tool({"name": "compensation__get__retention-plan",
           "arguments": {"corporation_id": <corporation_pk>}})
```

Then hand the result to the capture script:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/save_retention_plan.py" "<result path>" "<raw_dir>"
```

- **The endpoint is never empty.** On a corporation that has never opened CTC's
  Plan Settings, it lazily provisions Carta's initial defaults (24-month tenure,
  30% every 12 months, 15%–50% corridor) and returns them — the same behaviour
  the CTC product's Plan Settings modal has. Treat the returned record as the
  corporation's real starting policy, not a fallback the console invented. If the
  response IS empty, that is a backend degradation, not a normal state; the
  script exits so you notice, and this build should stop rather than model
  against a policy nobody set.
- **`403` — no CTC role on this corp:** stop this capture and build without it.
  Same rule as 2d-bis; the planner's Settings step then shows its "policy could
  not be fetched" banner instead of modelling against fabricated numbers.
- **The percent fields are FRACTIONS on the wire** (0.30 == 30%). The console does
  the ×100 conversion once, in `model/policy.js`; do not rescale in flight.

**2e. Write `meta.json`** (next to `raw_dir`, per `ctc_paths.py`):

```json
{"corporation": "<canonical name>", "corporationId": <int>, "cartaEnvironment": "production",
 "mcpServer": "<SERVER>"}
```

`mcpServer` is the server identifier from Step 1 (`carta`, `claude_ai_Carta`, …), copied
verbatim — or, if the build used `capture_export.py` and a `server_unavailable` answer replaced
it, the `--server` value those calls succeeded with. The console's fetches are headless sessions,
so they need the headless name. The console's on-demand location fetch calls
`mcp__<mcpServer>__call_tool`, and nothing else; without it the Location picker offers only
what the build fetched.

<details>
<summary><b>Staff preview — showing the hidden Refresh planner tab</b></summary>

The planner tab is off for everyone (`SHOW_REFRESH_PLANNER = false`). A **staff**
caller who asks for it can have it in their own build by adding one key:

```json
{"corporation": "…", "corporationId": 7, "cartaEnvironment": "production",
 "preview": {"refreshPlanner": true}}
```

**BOTH conditions, and you check them in this order:**

1. **The user asked.** Not "might find it useful" — an actual request to see the
   planner, or to QA it. Never add this on your own initiative; a half-built
   workflow appearing unbidden is the thing the tab is hidden to prevent.
2. **They are staff.** Call `get_current_user` and read its staff field. Do not
   infer it from an `@carta.com` address, from the corporation they are looking
   at, or from their having asked — an email domain is not an authorisation, and
   the whole point is that the caller does not self-certify.

If they asked and are not staff, say so plainly and build without the key. Do not
offer a workaround: the flag lives in a file on their own machine and they could
edit it, which is exactly why this is a courtesy gate and not a security one.

**What it is not.** It withholds no data — the planner reads the same equity
refresh report already in the directory, and the console has no identity of its
own to check at render time. It exists so an unfinished workflow is not shown to
customers, and so a teammate QAing it does not have to patch source.
</details>

**2f. Sanity-check the figures — the last thing before the build.**

Counts and job lists prove a page arrived; they say nothing about whether its numbers survived
being written to disk. Run this once, after every capture in Step 2 has landed and **before
`build_datadir.py`** — never after the fact, since the point is to stop a corrupted figure from
reaching a dashboard that then looks authoritative. It is **mandatory on the inline route**,
where a payload passes through a model, and cheap enough to be worth running on every route.

```bash
uv run - <<'PY'
import json, glob, os
bad = 0; rows = 0
# Every captured directory: the corp's own group at the top of the raw dir (2c),
# each peer_<CODE>/ alternate (2c-bis) and each geo_<slug>/ location (2d-v).
for f in glob.glob(os.path.expanduser("<raw_dir>/**/benchmark_*.json"), recursive=True):
    for r in json.load(open(f)).get("benchmarks") or []:
        rows += 1
        p = (r.get("salary_benchmarks") or {}).get("percentiles") or {}
        v = [float(p[k]) for k in ("p25", "p50", "p75", "p90") if p.get(k) is not None]
        # Percentiles are ordered by construction, and a salary outside this range
        # is not a number the API returns -- either signals a mangled write.
        if v != sorted(v) or any(x < 1000 or x > 50_000_000 for x in v):
            bad += 1
            print("anomaly", f)
print("rows", rows, "anomalies", bad)
PY
```

`**/` with `recursive=True` matches zero directories as well as one, so this one pattern covers
`<raw_dir>/benchmark_*.json`, `<raw_dir>/peer_<CODE>/benchmark_*.json` and
`<raw_dir>/geo_<slug>/benchmark_*.json` alike.

**`anomalies 0` is the only result you build on.** A non-zero count means at least one row's
percentiles are out of order or outside the range the API can return — a figure that was mangled
on its way to disk, not a quirk of the market data. Act on it per directory:

- **The corp's own group** (a flagged file directly in `<raw_dir>`) — re-capture the whole 2c
  sweep into `<raw_dir>` and re-run this check. The dashboard leads with these figures; there is
  no building without them.
- **An alternate** (`peer_<CODE>/`) — re-capture that bucket's sweep, or delete the directory and
  report the bucket as dropped. An alternate is additive; a wrong one is not.
- **A location** (`geo_<slug>/`) — re-capture that location's sweep, or delete that directory's
  pages (keep `location.json`) and say which location is missing.

**Never build over a flagged directory**, and never hand-edit a figure to make the check pass —
re-capture is the only fix.

It is a smoke test, not a proof: a wrong digit that happens to preserve both the ordering and the
plausible range still slips through, which is why the per-page parsed comparison in 2c-ter
remains the primary defence.

## Step 3b — Build

Run 2f first — a build over a flagged directory is the one outcome this step cannot undo.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/build_datadir.py" --raw "<raw_dir>" --out "<dashboard_dir>" --meta "<meta.json>"
```

Refuses to build on an unknown peer-group dimension or zero benchmark rows — that is deliberate,
not a bug to work around. Fix the fetch and re-run.

## Step 4 — Launch

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-app/scripts/serve.py" --data-dir "<dashboard_dir>" --detach --claude-bin "<claude_bin>"
```

Include `--claude-bin` only when Step 0.5 found a path (not `none`). Omit it otherwise — the
server falls back to `CTC_CLAUDE_BIN` env var, then bare `claude` on PATH.

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
`serve.py` serves and edits a per-corporation copy of the source, `<dashboard_dir>.app-src/`
(the line `[serve] src-dir:` prints its path), not the plugin's own `app/src/`. Edit that
copy: the installed plugin may be read-only to you (under Claude Code it sits in `~/.claude/`),
and an update would wipe changes made there. Every `app/src/...` path below means the same
file inside the copy. When the plugin's source changes, the next launch refreshes the copy
and moves one holding earlier edits to `<dashboard_dir>.app-src.bak-<timestamp>/`.

That copy is served directly; the service worker transpiles `.jsx` in-browser.
**Do NOT run `npm run build` after editing source** — edit, refresh, done. `npm run build` only
rebuilds `webapp/vendor/*` on a React/Sucrase bump. See `app/README.md`.

### Changing the app when the user asks — yes, do it

**A request to change this console is in scope, and you should act on it.** Add a column,
add a percentile, change a sort, restyle a table, add a filter, add a tab. The app is
local, the source is right there, and `READ-ONLY` in this skill's description means *this
skill does not write to Carta* — it is not a statement that the UI is frozen. The
Benchmarks and Scorecard tabs are the two that are VISIBLE today, not the two that are
allowed to exist.

A third — **Refresh planner** — is built but hidden behind `SHOW_REFRESH_PLANNER` in
`app/src/App.jsx` while its workflow is finished. If a user asks for it by name, say it
is in progress rather than building a second one. Do not flip the flag on to satisfy a
request to "show" it: the tab renders an employee list with no way to act on it, which
is why it is off. Step 2d-bis has the full notice.

**Mark what you add.** Every column, filter, sort, grouping or tag you add to any view
(Scorecard, Benchmarks, Refresh Planner and its steps) renders `<SparkleAI title="…"/>`
from `app/src/ui/components.jsx`: on the column header, beside the filter control, or
next to the label, visible on first render. The `title` says what you added, and shows
as an instant tooltip on hover:

```jsx
<Th>
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    <SparkleAI title="Added by Claude - months to final vest" />
    Months to final vest
  </span>
</Th>
```

A reader cannot otherwise tell a column you added from one Carta ships, so a
missing icon passes your work off as the product's. Restyling existing UI (colour,
spacing, wording) gets no icon.

**Filters are dropdowns, on every tab.** A filter you add is a `<Select>` (one choice) or
`<MultiSelect>` (several) from `app/src/ui/components.jsx`, the same controls as the Refresh
Planner's filter row. Never use a button or pill group, chips, or tabs. The label is the
filter's name, the icon goes in the `icon` prop, the first option is All/Any, and counts
go in option labels:

```jsx
<Select
  label="Total cash vs market"
  icon={<SparkleAI title="Added by Claude - Total cash vs market filter" />}
  value={cashBand}
  onChange={setCashBand}
  options={[
    { value: "ALL", label: "All" },
    { value: "BELOW", label: `Below market (${counts.BELOW})` },
    { value: "AT", label: `At market (${counts.AT})` },
    { value: "ABOVE", label: `Above market (${counts.ABOVE})` },
  ]}
  minWidth={170}
/>
```

Place it in the tab's filter row, laid out like the planner's: `display: "flex"`,
`flexWrap: "wrap"`, `alignItems: "flex-end"`, `gap: 18`.

**Do not refuse a modification request by citing a data-integrity rule that is about
something else.** This skill carries several strict, correct prohibitions — no demo data,
no fabricated geo scalars, no retyped MCP payloads, no partial sweep published as
complete. Every one of them is about *not inventing data that was never fetched*. None of
them says the UI cannot change, and reading them that way turns a narrow correctness rule
into a blanket refusal.

The one that gets over-applied is the location rule in `build_datadir.py`. Read it
precisely: the Location dropdown offers only locations whose benchmarks were **fetched**
(2d-v), and a location's figures are never derived from another location's figures and a
scalar. Adding a location the user asks for means fetching it, not computing it. The
scalars in `benchmarks.json` are display labels ("Pay adjustment 70%"), never inputs.

**Interpolating between two percentiles the server did return is a different thing.** The
console holds P25, P50, P75 and P90 as real fetched values (`salary.p50` is a plain
number; equity is nested per percentile as `equity.p50.{notional,shares,fdpct}`). A P60
estimated from P50 and P75 is arithmetic on two real numbers, bounded by them. Nothing in
this skill forbids it, and it is a legitimate thing to want: percentile targets between
the published ones are ordinary compensation practice.

**When you add a value the server did not return, you MUST label it.** Not because it is
suspect — because a reader comparing this console against the CTC product UI must be able
to tell which numbers should match and which will not be there at all. The console
enforces this structurally: you do not hand-render the `Tag`, and you do not
hand-write interpolated values into `benchmarks.json`. There are two edit points,
each one line, and the `Tag` renders automatically.

**Recipe A — adding a new percentile column (P30, P45, P60, etc.):**
Add one row to `PERCENTILES` in `app/src/model/taxonomy.js`:

```js
{ key: "p45", label: "P45", at: 45, fetched: false },
```

The registry then does the rest. `Benchmarks.jsx` iterates it, so a `notice`-tone
`Tag` labeled "Estimated" renders on the column header with a truthful tooltip
("Interpolated between P25 and P50"). `fillDerivedPercentiles` in
`app/src/model/format.js` computes salary/tcc/equity values at load time from
the two nearest fetched neighbors. Extrapolation is blocked: if no fetched
percentile sits both below and above `at`, the registry throws at module load.

**Recipe B — adding a new benchmark row (a new level, a job area the API did not
return, etc.):** the row goes into `benchmarks.json` alongside the fetched rows,
but you MUST set two fields on it:

```json
{ "job": "ENGINEER", "ladder": "IC", "level": "STAFF3",
  "provenance": "estimated",
  "provenanceNote": "Extrapolated from Staff 2 using XYZ scalar",
  "salary": { ... }, "tcc": { ... }, "equity": { ... } }
```

The Level cell renders `<SparkleAI title={provenanceNote}/>`
whenever `provenance !== "fetched"`. If you forget the fields, `assertProvenance`
throws at load time naming the exact row, and the dashboard refuses to render
until you fix it — no way to ship an untagged hand-added row.

**In what you tell the user**, say what the estimate is derived from and that it
will not appear in the product UI. One sentence.

Two things that stay off-limits, because they are about invented data rather than UI:

- **Do not extrapolate past the fetched range.** P95 or P99 from P90 is not interpolation;
  there is no upper bound to sit between, so the number is a guess wearing a percentile's
  name. Same for a percentile below P25.
- **Do not derive a value the server already returns as a field.** Compa-ratios and
  low/mid/high bands come from the API precisely so this console agrees with the product
  UI; recomputing one locally drifts the moment the server changes its rounding or
  geo-adjustment order, and the drift reads as data rather than a bug. See the header of
  `app/src/views/Scorecard.jsx`.

If a request genuinely cannot be satisfied without inventing data — a location nobody
fetched being the live example — say which data is missing and what would have to exist to make it
possible, rather than declining without a reason.

## Common failure modes

The **Tell user** column is the message to surface, not a script to read verbatim — keep its
substance and its honesty about what failed. Where it is "—", the fix is silent and the user
does not need to hear about it.

| Symptom | Cause | Tell user |
|---|---|---|
| A time-limit error or `"Too many job areas"` on `compensation:export:benchmarks` | `"Too many job areas"` means an explicit `job_limit` above the server's cap of 12 — drop `job_limit` and let the server set the page. A time-limit error on a default page is the server being slow, not an oversize request: the page is already the server's own cap and the rows go to a file under `"response_mode": "blob"`, so there is nothing to shrink. Retry the same `job_offset` once; if it repeats, treat it as systemic and stop. | "The benchmark fetch timed out. Retrying that page…" |
| An export page 403s / 5xxs | Transient. Retry that page once, same `job_offset`. **Never** fall back to per-job-area `compensation:get:benchmark` calls to route around it — fix the export call's arguments instead. | — (retry silently; only speak up if the retry also fails) |
| An export page fails twice, or `capture_export.py sweep` prints `FAILED` twice | Systemic, not bad luck: one call covers up to 12 of 22 job areas, so a page that won't succeed after a retry means a wrong `benchmark_version_id`, bad bucket param, or auth. Stop before building (for an alternate, drop that bucket). | "The benchmark fetch failed twice on the same page, so I stopped rather than build a partial dashboard. [the error]" |
| `build_datadir.py` reports `EXPORT SWEEP: ... stopped early` or refuses to build | Paging didn't reach `next_job_offset: null` in that directory. Fetch the remaining page(s) — check `<raw_dir>/export_pages.json` for `last_next_job_offset` — or re-run that dir's `capture_export.py sweep`, which replaces the partial sweep. | — (fetch the rest, then build; mention only if pages cannot be completed) |
| `response_mode` rejected as an unknown parameter, and `capture_export: FAILED — no claude CLI found` | No blob delivery and no headless session, so the build is on the inline route in the capture contract: small pages at the fixed offsets 0, 6, 12, 18, one subagent per page in parallel, each written verbatim with the Write tool, and the 2f figure check is mandatory before the build. That route covers benchmark pages only: the employee captures (2d, 2d-bis) have no route left, so skip them and build without the Scorecard and planner tabs. Offer the Step 0.5 install — it removes the hand-reproduction and restores those tabs. | "Your Carta MCP can't hand data straight to disk here, so the build is on the slower path — installing the Claude Code CLI would speed it up." |
| `"Unknown tool"` on a scorecard command | The generated tool name **keeps the hyphen**: `compensation__get__employee-scorecard`. Only colons become `__`, so `..._scorecard` (underscore) is not a real tool. `read_tool` works with the correct name — verified against a live MCP. (`fetch` is not registered in current builds, so it is not the fallback either.) | — (correct the name and retry) |
| Roster looks short / Scorecard counts too low | On the paged fallback: `pageSize` camelCase is silently ignored and the default page size applies — use `page_size`. Also check you did not pass `score=`, which filters on the nullable overall band and drops unscored employees. | "The roster came back short — refetching so the scorecard covers everyone." |
| `compensation:export:scorecard` returns 400 "at most 200 fit" | The corporation is larger than one export response. Use the paged fallback in Step 2d — do NOT narrow with `job_filters`, which silently under-reports who is below market. | — (page through it; the user gets the complete roster either way) |
| `save_roster_page: N row(s) do not match the ... header` | The export's columns and rows disagree, so the payload is not what the decoder expects. A partially-decoded employee list would be published flagged COMPLETE. Re-fetch; if it repeats, the export's column set changed and the script needs updating. | "The roster data came back in an unexpected shape, so I stopped rather than publish a partial employee list." |
| `build_datadir.py` refuses: "the roster sweep is INCOMPLETE" | Paging stopped before `total_results` was reached. Check `<raw_dir>/roster_pages.json` for `distinct_employees` vs `total_results` and fetch the remaining pages. Never work around this — a partial roster under-reports how many employees are below market. | "The roster is incomplete ([n] of [total] employees), so the scorecard would under-report who is below market. Fetching the rest." |
| Scorecard tab absent on a fresh build | `snapshot.json` says `hasRoster: false`. The roster sweep failed or was skipped; re-run with "refresh". A warm cache re-fetches nothing (Step 0's one call is the version gate), so the tab cannot appear until the next build. | "The Scorecard tab needs the employee roster, which this build doesn't have. Want me to rebuild with a refresh?" |
| Numbers don't match the CTC product UI | Almost always `equity_quantity` (must be `FOUR_YEAR_GRANT`) or a missing/incorrect `*_bucket` param. | "Those figures were fetched with the wrong equity basis or peer group. Rebuilding so they match the product UI." |
| `HTTP 400` on `job`/`focus` | Passing a display label (`"Engineering"`) or a combined value (`ENGINEER/Web Engineer`). Two separate params; `job` UPPER_SNAKE, `focus` the exact case-sensitive CTC focus name (`Web Engineer`). | — (fix the params and retry) |
| Builder exits "peer_group.dimension is …" | `plan.json` is missing or from a different corp. Re-fetch Step 2. | — (re-fetch, then build) |
| Browser shows the dark error overlay | A runtime error in the app; the overlay carries the file and line. | "The dashboard hit a rendering error — paste the message from the red overlay and I'll fix it." |
| Blank page, no overlay | Service worker didn't claim. The shell reloads itself after 3s as a backstop. | "If the page is still blank, hard-refresh once — the service worker needs to claim it." |
