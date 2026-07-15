---
name: carta-compensation-benchmarks
description: >
  Retrieves Carta Total Compensation market benchmarks (salary, equity, total cash) for a role. Output to chat or CSV.
  Market benchmarks are triggered by queries like: "sales benchmarks", "comp benchmarks", "market rate", "what does a [role] pay", "put benchmarks in a CSV".
  Do NOT use for job classification or role mapping — use carta-compensation-rolematcher for that.
  Do NOT use for fund performance benchmarks (use carta-performance-benchmarks) or portfolio structural metrics like SAFE terms and option pool sizes (use carta-market-benchmarks).
version: 1.0.0
model: sonnet
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__discover
  - mcp__carta__call_tool
  - mcp__carta__search_tools
  - mcp__carta__list_accounts
  - AskUserQuestion
  - Skill
  - Read
  - Write
  - Bash(mkdir *)
  - Bash(ls *)
  - Bash(uv run *)
  - mcp__cowork__create_artifact
  - mcp__cowork__update_artifact
---

# Benchmark Query

Look up Carta Total Compensation (CTC) market salary and equity benchmarks for a role at a specific corporation.

> **CRITICAL — Casing rule for ALL user-facing CTC values.**
>
> In every part of your response that the user reads — chat narration, status updates, table headers, table cells, chart titles, CSV column values, file summaries, follow-up suggestions — render CTC taxonomy values in **Title Case** display form, never the UPPER_SNAKE_CASE API enums. This matches the carta-compensation-rolematcher output convention so the plugin's voice is consistent.
>
> | Field | Use in user-facing text | Never |
> |---|---|---|
> | Job area | `Engineering`, `Sales`, `Customer Success`, `Project Management`, `Human Resources` | `ENGINEER`, `SALES`, `CUSTOMER_SUCCESS`, `PROJECT_MANAGEMENT`, `HR` |
> | Focus | `DevOps and Site Reliability`, `Account Executive`, `FP&A` | `devops and site reliability`, `account executive`, `fp&a` |
> | Level | `Entry`, `Mid 1`, `Senior 1`, `Staff 2`, `VP 1`, `C-Level`, `CEO`, `Unknown` | `ENTRY`, `MID1`, `SENIOR1`, `STAFF2`, `VP1`, `C_LEVEL`, `UNKNOWN` |
> | Track | `IC`, `Manager`, `Executive`, `Unknown` | `ic`, `manager`, `executive`, `UNKNOWN` |
>
> The UPPER_SNAKE_CASE enums are **only** for machine handoff — i.e. the `job`, `level`, `focus`, `is_leader` parameters you pass to `compensation:get:benchmark`. Inside the JSON payload for the API call, keep the enum form. Outside the API call, switch to Title Case before any value reaches the user. Even in narration like "Engineering maps to ENGINEER", drop the API enum — say *"Pulling Engineering benchmarks for corp 7"* instead.
>
> See `carta-compensation-rolematcher` → "Display → API enum tables" for the full mapping.

> **Use MCP, not CLI.** Every API call in this skill goes through the carta MCP server's `mcp__carta__fetch` tool, with `compensation:*` commands. Do NOT shell out to the `carta` CLI (`carta compensation ...`, `carta web ...`, etc.) — that bypasses the formatters, the 403 handler, and the attribution requirement. The Bash tool is allowed only for writing CSV/JSON files locally, never for calling Carta APIs.
>
> Examples below use shorthand `fetch("compensation:get:plan", {...})` — read this as `mcp__carta__fetch(command="compensation:get:plan", params={...})`.

> **CRITICAL — Show only PERCENTILE columns (p25/p50/p75/p90) for all three rating types.**
>
> The `compensation:get:benchmark` response includes both `low/mid/high` bands AND `p25/p50/p75/p90` percentiles. **Surface only the percentiles** — they are the raw market data. Skip the band fields entirely (they're a derived corp-specific target band that adds noise without adding information for benchmark queries).
>
> Every output (chat reply, CSV, JSON) MUST include all three rating types: salary, equity, AND total cash. Don't stop at salary.
>
> ### Cowork vs everywhere else — pick ONE chat surface, not both
>
> Where the benchmark numbers actually appear depends on the client:
>
> | Client | Chat reply | Live artifact panel |
> |---|---|---|
> | **Cowork** (`mcp__cowork__create_artifact` callable) | One-line acknowledgement + the data-source attribution line. NO markdown percentile tables. | ✅ Renders the percentile tables |
> | **Claude Code, Claude Desktop, claude.ai** | ✅ Renders the markdown tables (the "Chat reply format" below) + the attribution line | Not available — skip the artifact path |
>
> **Anti-patterns:**
> - ❌ In Cowork, rendering the markdown percentile tables AND the artifact panel — the data appears twice, the chat reply is noise.
> - ❌ In Claude Code / Desktop / claude.ai, skipping the markdown tables on the assumption an artifact will pick up the slack — the artifact doesn't render there, so the user gets nothing.
>
> The Excel / CSV export paths are unchanged — both clients can request a file export and it works the same way regardless.
>
> ### Chat reply format (single role) — Claude Code / Desktop / claude.ai only
>
> Skip this entire section when running in Cowork — the artifact panel renders the same percentile data and a markdown duplicate is noise. Use the one-line acknowledgement format from the "Live artifact" section below instead.
>
> Three small tables, one per rating type. Each has 4 columns: P25, P50, P75, P90.
>
> ```
> ## Market Benchmark: [Role] at [Company]
>
> **Salary**
> | P25 | P50 | P75 | P90 |
> |-----|-----|-----|-----|
> | $145,000 | $164,000 | $186,000 | $210,000 |
>
> **Total Cash Compensation (TCC)**
> | P25 | P50 | P75 | P90 |
> |-----|-----|-----|-----|
> | $164,000 | $185,000 | $210,000 | $237,000 |
>
> **Equity (4-Year Grant)**
> | Metric | P25 | P50 | P75 | P90 |
> |--------|-----|-----|-----|-----|
> | FD % | 0.030% | 0.040% | 0.050% | 0.144% |
> | Shares | 18,620 | 24,745 | 30,870 | 88,444 |
> | Notional value | $100,000 | $133,000 | $165,000 | $474,000 |
>
> (For peer groups ≥ $500M post money — `peer_group.notional_available: true` — put **Notional value** as the first row instead.)
>
> **Geo Adjustment:** [location] (X.XX× salary, X.XX× equity)
>
> ---
> *Data source: Companies with [peer_group_dimension_phrase] [peer_group_label]. Benchmarks released [Month YYYY].*
> ```
>
> The `[peer_group_dimension_phrase]` varies by `peer_group.dimension` — see "Required attribution" below for the three exact phrasings. Do NOT hardcode `post money valuations between`.
>
> ### CSV format (bulk)
>
> One row per `(job, ladder, level)`. Default column order (peer group < $500M post money):
>
> ```
> job, ladder, level, currency,
> salary_p25, salary_p50, salary_p75, salary_p90,
> tcc_p25, tcc_p50, tcc_p75, tcc_p90,
> equity_fd_pct_p25, equity_fd_pct_p50, equity_fd_pct_p75, equity_fd_pct_p90,
> equity_shares_p25, equity_shares_p50, equity_shares_p75, equity_shares_p90,
> equity_notional_p25, equity_notional_p50, equity_notional_p75, equity_notional_p90
> ```
>
> For peer groups ≥ $500M post money (`peer_group.notional_available: true`), notional comes first:
>
> ```
> ..., equity_notional_p25..p90, equity_fd_pct_p25..p90, equity_shares_p25..p90
> ```
>
> Field source map (from each `benchmarks[i]` entry):
> - `salary_p*` → `salary_benchmarks.percentiles.{p25,p50,p75,p90}`
> - `tcc_p*` → `tcc_benchmarks.percentiles.{p25,p50,p75,p90}`
> - `equity_shares_p*` → `equity_benchmarks.percentiles.{p25,p50,p75,p90}.as_shares`
> - `equity_fd_pct_p*` → `equity_benchmarks.percentiles.{p25,p50,p75,p90}.as_fd_percentage`
> - `equity_notional_p*` → `equity_benchmarks.percentiles.{p25,p50,p75,p90}.as_notional_value`
> - `currency` → `salary_benchmarks.currency_code`
>
> Note: equity percentiles are nested objects (`percentiles.p25.as_shares`, etc.), not flat values like salary/tcc.
>
> If a column's source field is missing for a particular row (e.g. some roles have no equity), leave that cell blank — do not invent zeros and do not drop the column.
>
> **Anti-patterns:**
> - ❌ Showing the user a low/mid/high table. Those are the corp's pay-band target, not market data — skip them.
> - ❌ CSV with `salary_low / salary_mid / salary_high` columns instead of percentile columns.
> - ❌ Salary-only output. The user asked for "benchmarks" — show all three rating types.
> - ❌ Skipping TCC because "the user said sales benchmarks" — TCC IS a benchmark.

> **CRITICAL — Excel exports MUST use the branded export script**
>
> When the user asks for an Excel (.xlsx) file, you MUST call the export script below. Do **not** write openpyxl code yourself. Do **not** choose colors, fonts, or layout — the script applies Carta's official brand guidelines automatically (teal headers, alternating rows, "Powered by Carta" logo, attribution row). Any hand-rolled Excel output will have incorrect branding.
>
> **Anti-patterns:**
> - ❌ Writing `from openpyxl import Workbook` and styling cells yourself
> - ❌ Choosing your own header colors (navy, blue, or anything else)
> - ❌ Skipping the logo — the script embeds it automatically from the plugin's assets
> - ❌ Omitting `--notional-first` when `peer_group.notional_available` is true

### Excel export — exact steps

**Step 1 — Build a JSON array of row objects** (one dict per `(job, ladder, level)`). Use `null` for missing values, never `0` or empty string.

```json
{
  "job": "ENGINEER", "ladder": "IC", "level": "SENIOR1", "currency": "USD",
  "salary_p25": 145000, "salary_p50": 164000, "salary_p75": 186000, "salary_p90": 210000,
  "tcc_p25": 164000, "tcc_p50": 185000, "tcc_p75": 210000, "tcc_p90": 237000,
  "equity_fd_pct_p25": 0.0003, "equity_fd_pct_p50": 0.0004, "equity_fd_pct_p75": 0.0005, "equity_fd_pct_p90": 0.00144,
  "equity_shares_p25": 18620, "equity_shares_p50": 24745, "equity_shares_p75": 30870, "equity_shares_p90": 88444,
  "equity_notional_p25": 100000, "equity_notional_p50": 133000, "equity_notional_p75": 165000, "equity_notional_p90": 474000
}
```

**Step 2 — Write the rows to a temp JSON file** (avoids shell argument length limits):
```
Write /tmp/benchmarks_export.json  ← the JSON array
```

**Step 3 — Run the export script**:
```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-benchmarks/scripts/export_benchmarks.py \
  --data @/tmp/benchmarks_export.json \
  --output <output_path>.xlsx \
  --attribution "<full attribution string>" \
  [--notional-first]   # required when peer_group.notional_available is true
```

The script handles all branding automatically — do not modify its output styling. The attribution string must also appear in the chat reply per the attribution rules above.

### Live artifact — exact steps

> **The live artifact panel is an enhancement, not a replacement for the chat experience.** Every surface (Cowork, Claude Code, Claude Desktop, claude.ai) gets the same data and the same Excel export path. The artifact only changes HOW that data is presented:
>
> - **In Cowork** — render the artifact panel for every benchmark query, no opt-in trigger required. Words like "interactive", "visualize", "explore" are no longer needed. The chat reply that accompanies the panel MUST be a one-line acknowledgement (e.g. *"Opened the benchmark panel for <Role> at <Company> — see the side panel."*) **plus the standard data-source attribution line** (see "Required attribution" below) — and **NOTHING ELSE**. No markdown percentile tables, no per-rating-type sub-tables, no salary/TCC/equity numbers in chat. The artifact panel owns those numbers; duplicating them in chat is noise. The attribution stays in chat because the panel doesn't render it.
> - **In Claude Code, Claude Desktop, claude.ai** — the artifact tools (`mcp__cowork__create_artifact`) are not available. Present the same data inline using the "Chat reply format (single role)" or CSV/Excel export paths. Skip the artifact steps below.
>
> Why no Claude Desktop / `preview_start` path? The artifact's interactive controls (corp search, refetch, Download Excel) call `window.cowork.callMcpTool` — a bridge that only exists inside Cowork's iframe. In `preview_start`, the panel would render but the buttons would silently fail to make MCP calls. Cowork is the only surface where the artifact functions correctly today; the chat-only path covers everywhere else equivalently.

**Step 0 — Pick the rendering path**

- **Cowork** (`mcp__cowork__create_artifact` is callable) → use the artifact panel path below (Steps 1, 2, 4). Default for every benchmark query — no trigger phrase needed.
- **Anywhere else** → skip the artifact steps; present the data inline per "Chat reply format (single role)" + offer the Excel export when appropriate.

**Step 1 — Build the benchmark payload JSON**

Serialize the fetched benchmark results into this shape:
```json
{
  "company": { "id": 7, "name": "Acme Corp" },
  "results": [ /* array of row objects — see the per-row shape below */ ],
  "version": "v3.1",
  "benchmark_version_id": 51,
  "peer_group": { "dimension": "post_money", "code": "ONE_HUNDRED_MILLION", "label": "$100M-$250M" },
  "fetchedAt": "2026-05-27T10:00:00Z"
}
```

> **`benchmark_version_id` is REQUIRED in the payload** (the numeric `benchmark_version.id` from `compensation:get:plan` / the benchmark response — NOT the `"v21.0"` display string). The artifact's interactive controls (changing level, location, adding a row) re-fetch via `compensation:get:benchmark` and must pin the same benchmark version the pre-seed used; omitting it causes those re-fetches to fail. The top-level `version` string is display-only.

> **`peer_group` is REQUIRED in the payload** — the same `{dimension, code, label}` you captured from `compensation:get:plan` in Step 3b. The artifact's interactive re-fetches pass `<dimension>_bucket: <code>` on every call so the panel's numbers match the corp's plan-configured peer group (and the CTC product UI). Omitting it makes those re-fetches fall back to a default comparable set whose values diverge from the FE — the exact mismatch users report. `code` is the bucket enum (e.g. `ONE_HUNDRED_MILLION`), NOT the `label` display string.

**The artifact's `results[]` row shape is NESTED — NOT the flat CSV shape.** The engine's `renderTable` reads `r.salary.p25`, `r.equity.p50.notional`, etc. Pre-seeding flat rows (e.g. `r.salary_p25`) makes every cell render as `—`. Use this shape per row:

```json
{
  "job": "ENGINEER", "level": "SENIOR1",
  "ladder": "IC",
  "currency": "USD",
  "location": "San Francisco,CA,USA",
  "geo": "San Francisco-Oakland-Hayward, CA",
  "version": "v24.9",
  "error": null,
  "salary": { "p25": 145000, "p50": 164000, "p75": 186000, "p90": 210000 },
  "tcc":    { "p25": 164000, "p50": 185000, "p75": 210000, "p90": 237000 },
  "equity": {
    "p25": { "notional": 100000, "shares": 18620, "fdpct": 0.0003 },
    "p50": { "notional": 133000, "shares": 24745, "fdpct": 0.0004 },
    "p75": { "notional": 165000, "shares": 30870, "fdpct": 0.0005 },
    "p90": { "notional": 474000, "shares": 88444, "fdpct": 0.00144 }
  }
}
```

Field mapping from the `compensation:get:benchmark` response:
- `salary.p*` ← `salary_benchmarks.percentiles.p*` (numeric)
- `tcc.p*` ← `tcc_benchmarks.percentiles.p*` (numeric)
- `equity.p*.notional` ← `equity_benchmarks.percentiles.p*.as_notional_value`
- `equity.p*.shares` ← `equity_benchmarks.percentiles.p*.as_shares`
- `equity.p*.fdpct` ← `equity_benchmarks.percentiles.p*.as_fd_percentage`
- `ladder` ← `benchmarks[i].ladder` (`"IC"` or `"LEADER"`). The artifact derives the row's track from this + the level: `IC` → IC track; `LEADER` with level rank ≤8 → Manager track; `LEADER` with level rank ≥9 (VP1+) → Executive track. This is what makes the displayed track and per-track level name (e.g. VP1 shows as "Distinguished" on IC but "Vice President" on Executive) match the CTC product UI — pass `ladder` through verbatim.
- `currency` ← `salary_benchmarks.currency_code` (fall back to `tcc_benchmarks.currency_code`; surface `null` if neither is present — do NOT default to `"USD"`)
- `location` ← the **API location string** you passed as the `location` param to `compensation:get:benchmark` (the `"City,ST,USA"` form, e.g. `"San Francisco,CA,USA"`; `",,US"` for national). This is what pre-seeds the artifact's per-row location dropdown — it must be the API value, NOT the display label. Omit or set `null` when you queried without a location (the dropdown then seeds to "Any").
- `geo` ← `geo_adjustment.label` (the MSA *display* label, e.g. `"San Francisco-Oakland-Hayward, CA"`). Display-only — drives the read-only "Location:" line, NOT the dropdown selection. Keep it distinct from `location`: the label is not a valid API value and must never be sent back as the `location` param.
- `version` ← `benchmark_version.version_major` and `version_minor` concatenated as `"v<major>.<minor>"`
- `error` ← `null` for successful rows; populate with a short string when a per-job/level fetch failed so the table can render an explicit error cell instead of fabricating zeros

Use `null` for any percentile value the API didn't return — never `0` or `""`.

> ⚠ **Do not confuse this with the Excel export's row shape.** The Excel export script (`export_benchmarks.py`) consumes a *flat* row shape (`salary_p25`, `equity_shares_p50`, etc., documented in the Excel section above). The artifact engine consumes the *nested* shape documented here. Keep them separate — they are two independent contracts with different consumers.

Write the payload to `/tmp/benchmark_payload_<corp_id>.json`.

**Step 2 — Render the artifact panel (Cowork)**

Read the engine HTML and inject the payload as a `<script>` block before the engine's own JavaScript runs, then create the artifact via Cowork:

```
Read ${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-benchmarks/assets/artifact_engine.html
```

Then call `mcp__cowork__create_artifact` with:
- `html` = `<script>window._BENCHMARK_PAYLOAD = <payload JSON>;</script>` + engine HTML  *(the script tag MUST appear in the document before the engine's main `<script>` block; injecting after the engine's own boot IIFE runs is too late — the engine will treat the panel as interactive-only and skip the pre-seed)*
- `id` = `comp-benchmarks-<company-slug>`  *(stable per company so re-renders update the existing artifact in place via the auto-retry to `mcp__cowork__update_artifact`)*
- `description` = `Compensation benchmarks for <Company Name>`

If `mcp__cowork__create_artifact` returns "already exists" (or equivalent), immediately retry with `mcp__cowork__update_artifact` using the same arguments. Re-invocations for the same company produce the same artifact id, so the update branch is the common case after the first render.

> **CRITICAL — Required attribution on every benchmark response**
>
> Whenever you surface ANY Carta Total Compensation benchmark data (single lookup, bulk table, comparison, follow-up answer, CSV, Markdown, JSON export — anything that contains target $, percentile, compa-ratio, score, or per-role/level numbers), you MUST include the attribution string in EVERY output channel — chat reply AND every file you generate.
>
> ### The exact string
>
> ```
> Data source: Companies with <peer_group_dimension_phrase> <peer_group_label>. Benchmarks released <Month> <YYYY>.
> ```
>
> Three placeholders, all required:
>
> 1. **`<peer_group_dimension_phrase>`** — depends on which peer-group dimension the corp's plan uses (`peer_group.dimension` from `compensation:get:plan`). Pick one of three exact phrasings — do NOT hardcode `post money valuations between` regardless of the corp:
>    - `post_money` → *"post money valuations between"*
>    - `capital_raised` → *"capital raised between"*
>    - `headcount` → *"headcount of"*
> 2. **`<peer_group_label>`** — comes from `compensation:get:plan` → `peer_group.label` (e.g. `"$50M-$100M"`, `"$1M-$10M"`, `"100-500 employees"`). This identifies the band the corp is benchmarked against. Always include it — the citation is incomplete without it.
> 3. **`<Month> <YYYY>`** — a calendar date derived from the benchmark version's `created` ISO timestamp. **NOT a version number.**
>
> Examples of correct values:
>
> | `peer_group.dimension` | `peer_group.label` | `benchmark_version.created` | Correct attribution |
> |---|---|---|---|
> | `post_money` | `"$50M-$100M"` | `"2026-05-06T14:42:41.646134Z"` | `Data source: Companies with post money valuations between $50M-$100M. Benchmarks released May 2026.` |
> | `post_money` | `"$500M-$1B"` | `"2026-02-15T08:00:00Z"` | `Data source: Companies with post money valuations between $500M-$1B. Benchmarks released February 2026.` |
> | `capital_raised` | `"$1M-$10M"` | `"2025-06-26T21:19:22Z"` | `Data source: Companies with capital raised between $1M-$10M. Benchmarks released June 2025.` |
> | `capital_raised` | `"$10M-$25M"` | `"2025-11-30T23:59:59Z"` | `Data source: Companies with capital raised between $10M-$25M. Benchmarks released November 2025.` |
> | `headcount` | `"100-500 employees"` | `"2026-01-15T08:00:00Z"` | `Data source: Companies with headcount of 100-500 employees. Benchmarks released January 2026.` |
>
> **Anti-patterns — do NOT do these:**
> - ❌ Hardcoding `post money valuations between` for a `capital_raised` or `headcount` corp — the phrase MUST track `peer_group.dimension`
> - ❌ Omitting the peer-group sentence — the citation must always name the comparison set
> - ❌ `Data source: ... released v24.6` — that's the version number, not the date
> - ❌ `Data source: ... released benchmark v24.6 (May 2026)` — drop the version, just use the month + year
> - ❌ Omitting it from the CSV because "the chat reply has it"
> - ❌ Putting it only in a separate "Source" sheet without also placing it visibly in the data
> - ❌ Using `version_major`, `version_minor`, or the `version` string anywhere in the attribution
> - ❌ Using the internal enum code instead of the human label (`$50M-$100M`) — always use `peer_group.label`, never `peer_group.code`
>
> ### Where to place it
>
> | Output type | Placement (required) |
> |---|---|
> | Chat reply | Last line of the message, italicized, after a `---` horizontal rule |
> | Markdown file | Last line of the file, italicized, after a `---` horizontal rule |
> | CSV file | Final row, e.g. `Data source,Companies with capital raised between $1M-$10M. Benchmarks released June 2025.` (use 1 cell or split across 2; both work) |
> | JSON export | Top-level `"_source": "Companies with capital raised between $1M-$10M. Benchmarks released June 2025."` field |
>
> (The examples above use `capital_raised` phrasing as a reminder that the dimension phrase is not always "post money valuations between" — swap in the phrase that matches the corp's `peer_group.dimension`.)
>
> ### Pre-send checklist (run before every response that touches benchmark data)
>
> 1. Did I read `peer_group.dimension` from the `compensation:get:plan` response and pick the matching phrase (`post money valuations between` / `capital raised between` / `headcount of`) — NOT a hardcoded "post money"?
> 2. Did I read `peer_group.label` and put it in the citation?
> 3. Did I derive the date from the benchmark version's `created` ISO timestamp? (Not from `version`, `version_major`, `version_minor`.)
> 4. Did I format it as `<Month name> <YYYY>` with no version number?
> 5. Is the attribution in the chat reply?
> 6. If I generated a file, is the attribution INSIDE the file too?
> 7. If multiple versions were used, did I list each with its own date?
>
> **If any answer is no, fix it before sending.** This is non-negotiable, even when the user asks for terse output.

## When to Use

- "What's the market rate for a senior engineer in San Francisco?"
- "Benchmark this role: Staff Product Manager, NYC"
- "How does our offer compare to market for a mid-level designer?"
- "What's the equity benchmark for a Director of Engineering?"
- "Show me CTC data for a [role] at [company]"

## Prerequisites

1. A corporation — resolved automatically from your accounts (see Step 1 below). If you have multiple corps, you'll be asked once to pick one.
2. A role description or job title — free text is fine, the rolematcher maps it to the CTC taxonomy.

## Workflow

### Step 1 — Resolve corporation (REQUIRED before anything else)

> **Do this ONCE, upfront, before calling any compensation endpoint.** Do not start fetching subscription status or plan data until you have a confirmed `corporation_id`.

Resolve in this priority order — stop as soon as one path succeeds:

**Path 1 — Explicit numeric ID in the prompt (highest priority, no API call needed)**

If the user mentioned a numeric corporation ID anywhere (e.g. *"corp 7"*, *"corp id 7"*, *"corporation_id=7"*, *"for company 728"*), use that exact integer. Do **not** call `list_accounts`. Do **not** search for it. Do **not** substitute a similar-looking ID.

> Anti-patterns:
> - ❌ User says "corp 7" → agent calls `list_accounts(search="7")` — `list_accounts` searches by name substring, not ID. "7" matches every corp with "7" in its name.
> - ❌ User says "corp 7" → agent picks a corp from a previous turn. Each prompt's corp ID overrides any prior context.

**Path 2 — Company name in prompt**

If the user named a company (e.g. *"benchmarks for Acme"*), call `list_accounts(search="Acme")`. Filter results to entries where `id` starts with `corporation_pk:`. If exactly one match, use it. If multiple, proceed to Path 4.

> **HARD RULE — only ever use a name and `corporation_pk` that appear verbatim in the `list_accounts` response.** The corp you act on MUST be one returned by the API for this query, copied exactly. Never:
> - invent, complete, or correct a company name the API didn't return,
> - blend or merge two different returned names into one (e.g. seeing "Acme Labs" and "Acme Health" and proceeding with "Acme"),
> - assume a corp exists because the user named it — if `list_accounts(search=...)` returns it, it exists; if it doesn't, it doesn't,
> - reuse a name/ID remembered from earlier in the conversation instead of the current response.
>
> If the search returns **no** `corporation_pk:` matches, do NOT guess or substitute the closest-looking corp. Tell the user you couldn't find a company by that name and ask them to confirm the exact name or give the numeric corp ID — then re-run `list_accounts`. A benchmark for the wrong (or a non-existent) corp is worse than asking again.

**Path 3 — Single account (auto-select, no question needed)**

If the user gave no corp hint at all, call `list_accounts()` with no search. Filter to `corporation_pk:` entries. If exactly **one** corporation is returned, use it automatically — do **not** ask the user to confirm something they have no choice about.

**Path 4 — Multiple accounts (ask once, cleanly)**

If multiple corporations are found, use `AskUserQuestion` immediately:
- Question: *"Which company should I look up benchmarks for?"*
- Options: corporation names **copied verbatim from the `list_accounts` response** (cap at 10; offer "Other" if more). Do not paraphrase, shorten, or normalize the names — present them exactly as returned so the user picks a real corp.

After the user picks, map their selection back to the **exact** `list_accounts` entry it came from and use that entry's `corporation_pk`. If the user typed a free-text answer via "Other" that doesn't match a returned name, treat it as a new name hint and re-run Path 2 — do not approximate it to one of the listed corps.

Do **not** show the user a raw JSON dump of accounts. Do **not** attempt any compensation call before they answer.

> **HARD STOP — user dismissed the question:**
>
> If the user closed the prompt, said "cancel", "never mind", or otherwise did not select an option — **STOP**. Do not guess a corp. Do not call any compensation endpoint. Reply:
>
> > *"No problem — let me know which corporation to look up benchmarks for (name or numeric ID) when you're ready. If there's something else I can help with in the meantime, just ask."*
>
> Picking a corp the user didn't authorize would return data for the wrong company. There is no recovery from that mistake.

**Note:** `list_contexts` / `set_context` are for Fund Admin firms — they do not return corporations. Always use `list_accounts` for corporation lookup.

Extract the numeric `corporation_pk` (the integer after `corporation_pk:`) for all subsequent calls.

### Step 2 — Verify CTC subscription (REQUIRED — HARD GATE)

> **STOP. The subscription check is a hard gate. Do not ask for — or even mention — the role until `is_subscribed: true` comes back.**
>
> Asking for the role is **Step 3a**, and Step 3a does not begin until this step returns `is_subscribed: true`. In the turn where you run the subscription check, your message to the user must contain **only** that you are verifying CTC access — nothing about a role, job title, level, or "in the meantime / simultaneously / while that runs." A corp with no CTC subscription (or no caller access) has no benchmark data, so any role the user gives would be wasted effort. Verify first; ask for the role only once you know there is data to return.
>
> **Anti-patterns — never do these (they defeat the gate):**
> - ❌ "Let me check the subscription and get the role from you simultaneously…"
> - ❌ "Verifying access — meanwhile, what role do you want benchmarks for?"
> - ❌ "Meetly has a subscription. What role…" bundled into the *same* turn as outcomes you haven't branched on yet
> - ❌ Calling the `carta-compensation-rolematcher` skill, or asking the user for a title/level, before `is_subscribed: true`
>
> The role question is a **separate turn** that happens *after* a confirmed `is_subscribed: true`.

```
call_tool({"name": "compensation__get__subscription_status", "arguments": {"corporation_id": <corporation_pk>}})
```

Three outcomes:
- `is_subscribed: true` → **only now** proceed to Step 3a and ask for the role.
- `is_subscribed: false` → stop and send the subscription message (see **Subscription gating**). Do not call `plans/` or `benchmark/` — they return empty data anyway and waste a round-trip. Do not invoke the rolematcher — don't make the user level a role we can't benchmark.
- **403** → the caller lacks a CTC role on this corp. Stop and send the no-access message (see **Access gating**). Do not retry or re-authenticate.

### Step 3a — Map role to CTC taxonomy

**Invoke the `carta-compensation-rolematcher` skill** to classify free-text job titles, descriptions, or pasted job postings into the CTC taxonomy. Use the Skill tool, not Read:

```
Skill("carta-compensation-rolematcher")
```

Pass the user's role description as input. Do not freelance the mapping — the rolematcher has the canonical job_area / focus / level / track logic and will return values that align with the CTC enums.

**When to invoke:** anytime the user provides a job title or job description in the context of a benchmark/comp conversation, even if their phrasing sounds like something else. Treat all of these as rolematcher invocations:

- *"What role is this?"* (explicit)
- *"Match this job description to the CTC taxonomy"* (explicit)
- *"What would be a good role for this job description?"* (asking for the taxonomy match)
- *"What's a good job description for this role?"* (the user is showing you a JD and asking about classification — even though "for this role" sounds like reverse direction, in a benchmark context the JD is the input and the taxonomy match is the output)
- *"What level is this?"* / *"What level does this map to?"*
- *"How does this fit?"* (when paired with a JD or title)
- Any time the user pastes a multi-line job description after a benchmark query — they're almost always asking how it maps

**If the user's question is ambiguous** between "classify this for benchmark" vs "help me write the JD copy" vs "give me career advice", invoke the rolematcher first to get the classification, then use the result to answer their actual question. Do not skip the rolematcher and freelance — the user is in a comp/benchmark conversation.

Capture the output:
- `job_area` — must be one of: `ACCOUNTING`, `ADMIN`, `CEO`, `CORPORATE_AFFAIRS`, `CUSTOMER_SUCCESS`, `DATA`, `DESIGN`, `ENGINEER`, `FINANCE`, `HR`, `IT`, `LEGAL`, `MANUFACTURING`, `MARKETING`, `OPERATIONS`, `PRODUCT`, `PROJECT_MANAGEMENT`, `RESEARCH`, `SALES`, `STRATEGY`, `SUPPORT`, `OTHER`
- `focus` (e.g. `"backend"`, `"devops and site reliability"`, `null`) — job-area-dependent; the rolematcher returns lowercase multi-word strings matching the taxonomy verbatim — pass them through as-is to the API
- `level` — must be one of (low to high seniority): `ENTRY`, `MID1`, `MID2`, `SENIOR1`, `SENIOR2`, `STAFF1`, `STAFF2`, `PRINCIPAL`, `VP1`, `VP2`, `C_LEVEL`, `CEO`
- `track` — the value returned by the rolematcher (`ic`, `manager`, `executive`, or `UNKNOWN`). Map to `is_leader`: `manager` or `executive` → `true`, `ic` → `false`. If `UNKNOWN`, stop and ask the user before calling the API — see Error Handling.

If the rolematcher returns a value not in these enums (e.g. `LEAD1`, `PRODUCT_MANAGER`), map it to the closest valid value before calling the API. If unsure, read the valid enum list from `discover("compensation:get:benchmark")` (or `search_tools({"query": "compensation get benchmark"})`) — do NOT guess a plausible-looking name or invent a `compensation:list:*` command to look it up. Ask the user if still ambiguous.

If the user provides only a job title, that is sufficient minimum input for the rolematcher.

**Anti-patterns:**
- ❌ Reading the rolematcher SKILL.md file directly instead of invoking the skill — the skill has tools and runtime context the inline read can't replicate
- ❌ Freelancing the taxonomy mapping ("this looks like SENIOR2 to me") — always defer to `carta-compensation-rolematcher` for the classification

### Step 3b — Fetch the corporation's active benchmark version + peer group

```
fetch("compensation:get:plan", {"corporation_id": <corporation_pk>})
```

Capture three things from the response:
- `benchmark_version.id` — use as `benchmark_version_id` in the next step.
- `peer_group` — `{code, label, dimension, notional_available}`. The `label` (e.g. `"$50M-$100M"`) is required for the data-source footnote. The `dimension` — one of `post_money` / `capital_raised` / `headcount` — selects BOTH the data-source attribution phrase (see "Required attribution") AND which bucket param to pass in Step 4. Many corps default to `capital_raised`, NOT `post_money` — do not assume. The `notional_available` boolean tells you the equity column order (see Step 5).
- If `peer_group.dimension` is missing or not one of those three values, follow Step 4a (STOP).

### Step 4 — Fetch the benchmark

> **CRITICAL — Valid enum values: read them, don't guess them. Two failure modes to avoid.**
>
> Every filter param on `compensation:get:benchmark` (`job`, `level`, `focus`, the three `*_bucket` params, `equity_quantity`) takes a fixed **UPPER_SNAKE_CASE enum value**. The API validates by exact enum name and returns **HTTP 400** for anything else. Two things burn retries:
>
> **1. There is NO `compensation:list:*` command for these enums. Do not invent one.**
> `compensation:list:job_types`, `list:jobs`, `list:peer_groups`, `list:post_money_buckets`, `list:capital_raised_buckets`, `list:headcount_buckets` — **none of these exist.** Calling them returns `Unknown command` and wastes a turn. The only `compensation:list:*` command is `compensation:list:benchmark_versions`. To see the valid filter values, **read the `compensation:get:benchmark` command help** — it enumerates every `job`, `level`, and bucket value:
> ```
> discover("compensation:get:benchmark")
> ```
> (`search_tools({"query": "compensation get benchmark"})` also returns it.) Read the enum lists from that help; never self-discover via a guessed `list:` command.
>
> **2. Pass the enum NAME, not the human display label.**
> The API wants `MARKETING`, not `"Marketing"`; `CUSTOMER_SUCCESS`, not `"Customer Success"` or `"Customer Support"`; `SENIOR1`, not `"Senior 1"`. For buckets, pass the enum name (`TWENTY_FIVE_MILLION`), not the dollar label (`"$25M-$50M"`). The Title-Case forms are for **user-facing text only** (see the casing rule at the top of this file) — they are never valid API values. If you only have a free-text role, that's what the `carta-compensation-rolematcher` in Step 3a is for; it returns canonical enum names. Do not hand-translate a display label into a guessed enum.
>
> **Anti-patterns (all observed in real failures):**
> - ❌ `fetch("compensation:list:job_types")` → `Unknown command`. Read `discover("compensation:get:benchmark")` instead.
> - ❌ `job: "Marketing"` / `job: "Engineering"` / `job: "Customer Support"` → HTTP 400. Use `MARKETING` / `ENGINEER` / `CUSTOMER_SUCCESS`.
> - ❌ `job: "PRODUCT_MANAGER"` → HTTP 400 (invented). The value is `PRODUCT`. When unsure, read the help — don't guess a plausible-looking name.
> - ❌ `capital_raised_bucket: "$250M-$500M"` (a label) or a fabricated name → HTTP 400. Pass a real `CapitalRaisedBuckets` name from the help.
>
> Bucketing across many job functions? Iterate over the valid `job` enum names from the help — do **not** loop over display labels.

```
fetch("compensation:get:benchmark", {
  "corporation_id": <corporation_pk>,
  "job": <job_area>,                        # omit to get ALL job areas
  "level": <level>,                         # omit to get ALL levels for the job
  "focus": <focus>,                         # omit if null
  "is_leader": <true if track == "manager" or track == "executive" else false>,
  "benchmark_version_id": <benchmark_version.id>,
  "location": <location string>,            # optional, for geo adjustment

  # --- The corp's plan-default peer group. Include EXACTLY ONE bucket
  #     param. Do NOT include two or three. Pick the key by string-mapping
  #     `peer_group.dimension` from the plan response:
  #
  #         peer_group.dimension          key to use
  #         ────────────────────────      ─────────────────────────
  #         "post_money"               →  "post_money_bucket"
  #         "capital_raised"           →  "capital_raised_bucket"
  #         "headcount"                →  "headcount_bucket"
  #         null / unknown             →  STOP — see Step 4a below
  #
  #     The value is always `peer_group.code` from the plan response.
  "<peer_group_dimension>_bucket": <peer_group.code>,   # ONLY ONE — see mapping above

  # ⚠ DO NOT include the other two bucket params in the same call. The enum
  # values are dimension-specific (PostMoneyBuckets vs CapitalRaisedBuckets
  # vs HeadcountBuckets are disjoint), so a code value valid for one bucket
  # param is invalid for the other two — including more than one will either
  # silently override (which one wins is undefined and may change) or return
  # HTTP 400.
  #
  # Example: Meetly's plan returns peer_group = {dimension: "post_money",
  # code: "ONE_HUNDRED_MILLION", label: "$100M-$250M"}. The right call passes:
  #     "post_money_bucket": "ONE_HUNDRED_MILLION"
  # Not:
  #     "capital_raised_bucket": "ONE_HUNDRED_MILLION"   ← 400 Bad Request
  #     (also wrong: passing both — only one bucket param per call)

  "equity_quantity": "FOUR_YEAR_GRANT"      # REQUIRED — match the CTC product UI default
})
```

> **`equity_quantity` defaults to `NTM_VESTING` on the MCP side, but the CTC product UI defaults to `FOUR_YEAR_GRANT`.** Always pass `FOUR_YEAR_GRANT` explicitly so the skill's numbers tie out against the in-product UI. If you omit it, you'll return ~25% of the value HR users expect — that's a hard tie-out failure, not a stylistic preference. Applies to every benchmark call: single role, bulk CSV, live artifact panel, Excel export.

**Peer-group override (user-driven sensitivity analysis).** When the user explicitly asks to see a different peer group than the corp's plan default (*"show me $10M-$25M benchmarks instead"* or *"what would this look like for a 100-500 person company"*), **DROP the plan-default bucket param entirely and replace it with the override**. Do not include both — the API's behavior when more than one bucket is non-null is undefined and may change.

So a Meetly-corp call that normally has `post_money_bucket: "ONE_HUNDRED_MILLION"` (plan default), when the user asks for "show me the $1M-$10M raised peer group instead", becomes:

```
fetch("compensation:get:benchmark", {
  "corporation_id": 7, "job": "ENGINEER", "level": "ENTRY",
  # post_money_bucket DROPPED — replaced by capital_raised_bucket below
  "capital_raised_bucket": "ONE_TO_TEN_MILLION",
  "equity_quantity": "FOUR_YEAR_GRANT",
  ...
})
```

User-phrasing → override mapping:

| User says | Bucket param key | Bucket value (note: each dimension's enum uses different naming) |
|---|---|---|
| *"$10M-$25M valuation"* | `post_money_bucket` | `TEN_MILLION` (post-money enum uses single-lower-bound names) |
| *"$25M-$50M valuation"* | `post_money_bucket` | `TWENTY_FIVE_MILLION` |
| *"$1M-$10M raised"* | `capital_raised_bucket` | `ONE_TO_TEN_MILLION` (capital-raised enum uses range names) |
| *"$10M-$25M raised"* | `capital_raised_bucket` | `TEN_TO_TWENTY_FIVE_MILLION` |
| *"100-500 employees"* | `headcount_bucket` | `HUNDRED_TO_FIVE_HUNDRED` |
| *"25-100 employees"* | `headcount_bucket` | `TWENTY_FIVE_TO_HUNDRED` |

**Important: the naming asymmetry between the three enums is intentional, not a typo.**

- `PostMoneyBuckets` names a bucket by its **lower bound only**: `TEN_MILLION` IS the `$10M-$25M` band.
- `CapitalRaisedBuckets` and `HeadcountBuckets` name a bucket by its **explicit range**: `TEN_TO_TWENTY_FIVE_MILLION` is the `$10M-$25M` band.

Do NOT "fix" `post_money_bucket: "TEN_MILLION"` to `post_money_bucket: "TEN_TO_TWENTY_FIVE_MILLION"` thinking it's a typo. The post-money enum has no `_TO_` form — passing `TEN_TO_TWENTY_FIVE_MILLION` returns HTTP 400.

Reference for the full enum sets is in `compensation:get:benchmark`'s help (run `discover("compensation:get:benchmark")`, or `search_tools({"query": "compensation get benchmark"})`, to verify a specific value). There is no `compensation:list:*` command for bucket enums — read them from the command help.

### Step 4a — Unknown / missing `peer_group.dimension` (STOP)

If `compensation:get:plan` returned a `peer_group.dimension` value that is **not** one of `post_money` / `capital_raised` / `headcount`, OR `peer_group.dimension` is null / absent entirely, **stop**. Do not attempt the benchmark fetch. Do not guess a bucket param.

Tell the user:

> *"I can't pull benchmarks for [Company Name] — the corporation's plan returned an unexpected peer-group dimension (`<dimension value>`), so I don't know which peer-group bucket to query. This usually means compensation-service shipped a new dimension type the skill hasn't been updated for. Please reach out to the CTC team to confirm the corp's plan configuration."*

Why this is a stop-not-guess: each dimension's bucket param accepts values from a different enum. Picking a default would either send a code value that's invalid for the chosen param (HTTP 400) or — worse — accidentally return data from the wrong peer-group dimension, which would mislead the user with numbers that don't match what they see in the product UI.

If the dimension is one of the three known values, continue to Step 4 above.

### Step 4 — bulk-fetch nuances

**Single-job bulk:** omit `level` to get every level for one job in one call (~17 rows, fits well under the gateway response budget).

**Multi-job bulk (CSV across all functions):** issue **one fetch per job area** in parallel — do **not** omit both `job` and `level`. The unfiltered query returns ~22 jobs × ~17 levels in a single payload that exceeds the 40K-char gateway budget and will be rejected with `"response too large"`. Iterating per-job stays inside the budget and parallelizes cleanly.

### Step 5 — Present results

The response shape is:

```
{
  "benchmarks": [
    {
      "job": "ENGINEER", "ladder": "IC", "level": "SENIOR1",
      "salary_benchmarks": {
        "yearly_salary": {"low": "158000.00", "mid": "186000.00", "high": "214000.00"},
        "percentiles": {"p25": "...", "p50": "...", "p75": "...", "p90": "..."},
        "currency_code": "USD"
      },
      "equity_benchmarks": {
        "as_fd_percentage": {"low": "...", "mid": "0.012600", "high": "..."},
        "as_shares": {"low": "...", "mid": "7717.00", "high": "..."},
        "as_notional_value": {"low": "...", "mid": "41000.00", "high": "..."},
        "percentiles": {...},
        "quantity": "FOUR_YEAR_GRANT"
      },
      "tcc_benchmarks": {
        "yearly_tcc": {"low": "...", "mid": "210000.00", "high": "..."},
        "percentiles": {...}
      },
      "geo_adjustment": {"label": "...", ...}
    },
    ...
  ],
  "count": N,
  "benchmark_version": {"id": ..., "version_major": ..., "version_minor": ..., "created": "...", "description": "..."}
}
```

Three rating types — show only the **percentile** distribution (p25/p50/p75/p90) for each. The `low/mid/high` band fields are derived from the corp's pay-philosophy target percentile and a configured spread; they're noise for benchmark queries. Read the percentiles directly from the response.

**Null percentile handling — no fallbacks allowed:**
If a percentile field (`p25`, `p50`, `p75`, `p90`) is `null` or absent, render it as `—` in the table. Do **not** substitute `yearly_salary.mid`, `yearly_salary.low`, or any other band field. Do not infer, interpolate, or borrow values from adjacent fields. A `—` is correct and honest; a band value presented as a percentile is misleading.

**Sparse benchmark version message:**
If some or all percentiles are null (older benchmark versions may only populate a subset), add a note below the table:

> *Some percentiles are unavailable — this corporation's plan uses an older benchmark version (v[X.Y], [Month YYYY]) with limited coverage. To see full percentile ranges, the plan can be updated to a current benchmark version.*

Do not editorialize beyond this. Do not say "the data is incomplete" or suggest the data is wrong — it's accurate for that version, just limited.

Use the **single-role chat reply format** and **CSV column structure** spelled out in the CRITICAL block at the top of this file. Do not improvise different shapes.

For role-specific emphasis when there's space to call out a single number per rating:

- **All roles** — quote `salary_benchmarks.percentiles.p50` (median market salary) and `equity_benchmarks.percentiles.p50.as_notional_value` (median annual equity in $)
- **Sales / sales-leadership roles** — lead with `tcc_benchmarks.percentiles.p50` (median total cash) since variable pay is a major part of sales comp; salary alone understates the comp picture
- **Equity** — surface `as_fd_percentage`, `as_shares`, AND `as_notional_value` percentiles; users want all three (what % of company, how many shares, what's it worth)

### Equity column order (tables, CSVs, chat formatting)

The order in which equity columns appear depends on the corp's peer group, surfaced by `compensation:get:plan` as `peer_group.notional_available`:

| `peer_group.notional_available` | Order |
|---|---|
| `true` (≥ $500M post money) | **notional → FD% → shares** |
| `false` (all smaller peer groups) | **FD% → shares → notional** |

Rationale: actual notional-value benchmarks are only available for valuations ≥ $500M. Below that, the notional is a derived figure, so FD% (the structural metric) leads. Apply this ordering to:
- CSV column order: `equity_fd_pct_*` / `equity_shares_*` / `equity_notional_*` groups
- Markdown / chat tables: column position
- Per-row callouts: which equity number you quote first

If `peer_group` is missing from the plan response (very old plans, mis-configured corps), fall back to the default order (FD% → shares → notional).

If a `benchmarks` array entry has empty `salary_benchmarks`, empty `equity_benchmarks`, AND empty `tcc_benchmarks` (i.e. only `geo_adjustment` populated), that's a genuine data coverage gap for that role/level/version. Flag it as a separate "no data" section and exclude the row from the data table — do not emit a zero-filled row.

## Version Override

If the user asks about the current benchmark version or wants to query against a different version, follow the workflow in `${CLAUDE_PLUGIN_ROOT}/skills/carta-compensation-benchmarks/references/benchmark-versions.md`.

## Subscription gating (REQUIRED before any benchmark query)

> **HARD STOP RULE:** `is_subscribed: false` is FINAL. Do NOT call `plans/` or `benchmark/` for that corp. Do NOT "try anyway to see what comes back". Do NOT rationalize ("local/test environments may still return data"). The `subscription_status` response is authoritative — if the UI says no subscription, the API has no data, and you must respect that.

Compensation-service's `plans/` and `benchmark/` endpoints return 200 even for corporations that don't have an active CTC subscription — the response just has empty/null ratings. **You cannot infer subscription status from those calls.** That's why `subscription_status` exists.

Once you have resolved the corporation (Step 1), call `compensation:get:subscription_status` as **Step 2 — before any `plans/` or `benchmark/` call, and before asking the user for a role** (see Step 2 above). It returns `{corporation_id, is_subscribed}`. "First" here means first among the *compensation* calls, not before corp resolution — you still need a `corporation_pk` from Step 1 to make this call.

**Single-corp query:**
1. `fetch("compensation:get:subscription_status", {"corporation_id": <id>})`
2. If `is_subscribed` is `false`:
   - Tell the user: *"Compensation benchmarks require a Carta Total Compensation subscription. Visit this page to request a demo: https://carta.com/demo/total-comp/?&utm_medium=product&utm_source=carta-web&utm_campaign=ctc-plugin-inq-amer-q2-26"*
   - **STOP.** Do not call `plans/`, `benchmark/`, `benchmark_versions`, or any other compensation endpoint for this corp.
   - Do not generate a CSV/JSON file for this corp. No "framework" file. No "structure-only" file. Nothing.
   - Do not "try the benchmark to see if it works anyway". The answer is no.
3. If `is_subscribed` is `true` → proceed with the benchmark workflow.

**Multi-corp / bulk query:**
1. Call `compensation:get:subscription_status` for each corp up front. Partition them into `subscribed` and `unsubscribed` lists.
2. Run benchmark queries (`plans/`, `benchmark/`) **only** for corps in the `subscribed` list. Never query the API for corps in `unsubscribed`.
3. In the chat reply, list unsubscribed corps separately: *"The following corporations don't have an active CTC subscription and were excluded: [Corp A], [Corp B]."*
4. In any generated file (CSV/JSON), unsubscribed corps must not appear as data rows. Optionally include a separate "Excluded (no CTC subscription)" section for transparency. Never invent zeros or blanks for them.

### Anti-patterns to avoid

- ❌ User says "corp 728" → `subscription_status` returns `is_subscribed: false` → agent thinks "let me try the benchmark anyway to see if local/test data exists" — **NO.** Stop and tell the user.
- ❌ Generating a CSV with empty rows when the corp isn't subscribed — that's a wasted file with no data.
- ❌ Saying "the local test environment doesn't have benchmark data seeded" when the actual cause is "this corp doesn't have CTC". The agent's diagnosis is wrong, and the user-facing message conflates two unrelated problems.

## Access gating (no-CTC-access vs. no-subscription)

A `compensation:*` read can fail for two unrelated reasons that must NOT be conflated, because they have different remediations:

- **No subscription** — the corporation doesn't have Carta Total Compensation. Remediation: a sales/demo conversation.
- **No access** — the corporation HAS CTC, but the **current user** doesn't hold a CTC role on it (Company Viewer, Compensation Manager, Company Editor, Company Admin). A user can be a stakeholder, board member, or cap-table admin without any CTC role. Remediation: an internal role grant — NOT a sales conversation.

> **You distinguish these — the MCP layer does not.** The carta MCP gateway is a thin, domain-agnostic adapter: when a compensation command hits a 403 it surfaces the raw error, it does NOT probe subscription state or compose a friendly message. The authoritative signal for the distinction is `compensation:get:subscription_status`: when it succeeds it returns `{corporation_id, is_subscribed}` — `false` is no-subscription, `true` means a later `plan`/`benchmark` 403 is no-access. When it *itself* returns a 403, that 403 is the signal: the caller lacks a CTC role, so it's no-access. Step 2 already calls it up front — use its result (or its 403) to classify, per the table below.

**How to classify a failure:**

| What you observe | Meaning | What to do |
|---|---|---|
| `subscription_status` → `is_subscribed: false` | No subscription | Follow **Subscription gating** — send the demo-link message, STOP. Do not call `plans/` or `benchmark/`. |
| `subscription_status` → `is_subscribed: true`, but a later `plan`/`benchmark` read returns **403** | No access (corp has CTC, you lack a role) | Send the no-access message below, STOP. Do NOT show a demo link — the corp already has CTC. |
| `subscription_status` itself returns **403** | No access (the 403 means you lack a CTC role on this corp) | Send the no-access message below, STOP. Treat a 403 on the status probe as no-access, not as "couldn't determine subscription". |

**The no-access message (surface this verbatim):**

> *"Your account doesn't have a CTC role for this corporation, contact a company admin for access"*

This wording is deliberately neutral on subscription state: it's correct for both no-access rows above, including the `subscription_status`-403 case where the corp's subscription status is unknown (a 403 only establishes the caller lacks a CTC role, not that the corp has CTC). Do not assert that the corporation has Carta Total Compensation.

> **HARD STOP RULE:** Both outcomes are FINAL. Do NOT re-authenticate, retry, or "try a different command to see if it works" — re-authentication issues a fresh token for the **same user** and does not grant a role they don't have. Do NOT generate a CSV/JSON file for that corp. No partial output.

**Multi-corp / bulk query:** call `subscription_status` for each corp up front; for corps that come back `is_subscribed: true`, a subsequent benchmark 403 means no-access. Partition and surface the two failure classes separately:
- *"The following corporations don't have an active CTC subscription and were excluded: [Corp A]."*
- *"Your account doesn't have a CTC role for the following corporations, contact a company admin for access: [Corp B]."*

### Anti-patterns to avoid

- ❌ Treating the failure as a transient auth issue and asking the user to re-login. Re-authentication issues a fresh token for the **same user** — it does not grant a role they don't have.
- ❌ Expecting the gateway to hand you a finished, user-ready message. It returns a raw sanitized 403 — YOU classify it using the `subscription_status` result and compose the message.
- ❌ Showing a CTC product demo link for the access-denied case. The user needs an internal role grant, not a sales conversation — and on a `subscription_status` 403 you don't even know the corp lacks CTC, so a demo link would be a guess.
- ❌ Treating a 403 on `subscription_status` as "subscription unknown, try the benchmark anyway". A 403 there means no-access — stop and send the no-access message.

## Error Handling

| Symptom | Cause | Tell user |
|---|---|---|
| Rolematcher returns `UNKNOWN` for `job_area` | Role description too vague or not in CTC taxonomy | "Could you clarify the role? For example: job area (Engineering, Sales), seniority level, and whether it's an IC or manager track." |
| Rolematcher returns `UNKNOWN` for `track` | Level is also UNKNOWN — no seniority signals present | "Is this an individual contributor (IC), manager, or executive role? This determines which benchmark track to use." |
| Benchmark response has no data for role/level (subscribed corp) | Data coverage gap — no snapshot for that exact slice | "No benchmark data is available for [role] at [level] in this benchmark version. Want to try a different level or focus?" |
| `compensation:get:subscription_status` returns `is_subscribed: false` | Corp doesn't have an active CTC subscription | See **Subscription gating** — stop and send the subscription message. |
| `compensation:get:subscription_status` returns **403**, OR `is_subscribed: true` but a `plan`/`benchmark` read returns **403** | The current user lacks a CTC role on this corp | See **Access gating** — send the no-access message, stop. No demo link; do NOT re-authenticate (won't grant a missing role). |

## What next?

After delivering benchmarks, offer these follow-up options:

- **Export to CSV** — "Want me to export this as a CSV file?"
- **Look up another role** — "Want benchmarks for a different role or level?"
- **Compare with a different location** — "Want to see how these numbers change for a different city or country?"
- **Version comparison** — "Want to compare against a prior benchmark version?"
