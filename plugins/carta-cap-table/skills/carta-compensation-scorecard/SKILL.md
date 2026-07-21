---
name: carta-compensation-scorecard
description: >
  Carta Total Compensation scorecard — shows how a corporation's employees compare to market.
  Two lenses: corporation-level rollup (band distribution — what % of employees are below / at / above market) and per-employee scorecard (each employee's compa-ratio + percentile + market band).
  Triggered by queries like: "scorecard", "how is our comp positioned", "who's below market", "which employees are below P50", "show me the roster", "are we paying market", "comp posture", "employee compa-ratios".
  Operates on the corporation's already-ingested CTC roster (HRIS-synced employees).
  Do NOT use for market-rate lookups for a role (use carta-compensation-benchmarks).
  Do NOT use for job classification (use carta-compensation-rolematcher).
  Do NOT use for fund performance scorecards or portfolio-level metrics.
version: 0.1.0
model: sonnet
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__search_tools
  - mcp__carta__list_accounts
  - AskUserQuestion
  - Skill
  - Read
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
e.g. `{"skills": ["carta-cap-table:carta-issue-securities"], "model": "claude-sonnet-5"}`
List only Carta skills in use, each namespaced `"plugin:skill"` (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`).
</IMPORTANT>

# CTC Scorecard

Show how a corporation's compensation stacks up against market — at the corp level (band distribution rollup) or at the employee level (per-employee compa-ratio table) — using Carta Total Compensation data.

This skill calls compensation-service's scorecard endpoints (the same endpoints the CTC in-product UI uses) and renders the result in chat. By construction, the output matches what the customer sees in their CTC product surface.

> **CRITICAL — Casing rule for ALL user-facing CTC values.**
>
> Render CTC taxonomy values in **Title Case** display form, never the UPPER_SNAKE_CASE API enums. Matches the carta-compensation-rolematcher and carta-compensation-benchmarks convention so the plugin's voice is consistent across skills.
>
> | Field | Use in user-facing text | Never |
> |---|---|---|
> | Job area | `Engineering`, `Sales`, `Customer Success`, `Project Management`, `Human Resources` | `ENGINEER`, `SALES`, `CUSTOMER_SUCCESS`, `PROJECT_MANAGEMENT`, `HR` |
> | Focus | `DevOps and Site Reliability`, `Account Executive`, `FP&A` | `devops and site reliability`, `account executive`, `fp&a` |
> | Level | `Entry`, `Mid 1`, `Senior 1`, `Staff 2`, `VP 1`, `C-Level`, `CEO`, `Unknown` | `ENTRY`, `MID1`, `SENIOR1`, `STAFF2`, `VP1`, `C_LEVEL`, `UNKNOWN` |
> | Track | `IC`, `Manager`, `Executive`, `Unknown` | `ic`, `manager`, `executive`, `UNKNOWN` |
> | Band | `Low`, `Mid`, `High` | `low`, `mid`, `high` |
>
> The UPPER_SNAKE_CASE enums are **only** for machine handoff to MCP commands (the `job_filters`, `leader` parameters). Switch to Title Case before any value reaches the user.
>
> **Band enum — the API uses `LOW` / `MID` / `HIGH`, NOT `BELOW_MARKET` / `AT_MARKET` / `ABOVE_MARKET`.** This is the single source of truth:
>
> | API value (filter + response) | Display | Maps to user phrasing |
> |---|---|---|
> | `LOW` | `Low` | "below market", "below P50" |
> | `MID` | `Mid` | "at market" |
> | `HIGH` | `High` | "above market", "above P50" |
>
> Pass `LOW` / `MID` / `HIGH` (not `BELOW_MARKET`) as the `score` filter value, and parse `LOW` / `MID` / `HIGH` from response `score` fields. **Display the actual band value (`Low` / `Mid` / `High`) in tables** — do not relabel it to "Below market". When the user *asked* for a band by market phrasing (e.g. "show me below-market employees"), echo their phrasing in the surrounding prose AND map it to the real enum, e.g. *"Here are your below-market (Low) employees:"* — but the per-row Band column still shows `Low`.
>
> See `carta-compensation-rolematcher` → "Display → API enum tables" for the full mapping.

> **Use MCP, not CLI.** Every API call in this skill goes through the carta MCP. Do not shell out to the `carta` CLI — that bypasses the formatters, the 403 handler, and the attribution requirement.
>
> **⚠️ Two different invocation paths in this skill — do not conflate them.**
>
> | Command | Invoke with | Why |
> |---|---|---|
> | `subscription_status`, `plan` | `mcp__carta__call_tool({"name": "compensation__get__…", "arguments": {…}})` | Registered as flat `call_tool` tools (the plugin-wide convention, same as the benchmarks skill). |
> | `employee-scorecard`, `corporation-scorecard` | `mcp__carta__fetch({"command": "compensation:get:…", "params": {…}})` | Registered only as MCP *commands*. They are **NOT** flat `call_tool` tools — `call_tool({"name": "compensation__get__employee_scorecard"})` returns *"Unknown tool"* and silently wastes calls. |
>
> The scorecard commands are the trap: an LLM carrying `call_tool` muscle memory from the benchmarks skill will call the wrong tool. **In this skill, the `call_tool(...)` shorthand is used ONLY for `subscription_status` and `plan`.** Every `employee-scorecard` / `corporation-scorecard` example below is written out in full as `mcp__carta__fetch(...)` — invoke it exactly as written, do not "translate" it back to `call_tool`.
>
> For the `fetch` commands, note the shapes that trip agents up: the command name is **hyphenated/colon** (`compensation:get:employee-scorecard`), the argument key is **`params`** (not `arguments`), and `page_size` is **snake_case**.

> **Showing employee names is correct.**
>
> CTC customers viewing their own corporation's scorecard already see every employee's name, title, and pay in the CTC product UI. The general "never show PII" rule applies to Carta *staff* browsing customer data, not to a customer browsing their own roster. Surface employee names verbatim in tables — redacting them would be a regression from the product.

## When to Use

### Corporation-level rollup (derive from `compensation:get:employee-scorecard` — see Step 4a)

- *"How is our compensation positioned overall?"*
- *"Show me our comp scorecard"*
- *"Are we paying market?"*
- *"What's our market posture?"*
- *"Give me the band distribution for our employees"*

The corp-level band distribution is derived from the employee endpoint (matching the CTC product). Use `compensation:get:corporation-scorecard` **only** to compare a draft plan against the active plan — see Step 4a.

### Per-employee scorecard (use `compensation:get:employee-scorecard`)

- *"Show me which employees are below P50"*
- *"Who's below market?"*
- *"Show me the roster scorecard"*
- *"Which engineers are below market?"* (job-filtered roster)
- *"Show me the compa-ratios for our managers"* (leader-filtered)
- *"List employees at market"* (band-filtered)

### Ambiguous

If the question is just *"show me our scorecard"* with no further qualifier, **default to the corporation-level rollup** (cheaper, faster, summary-shaped). Offer a follow-up:

> *Ask me to "show employees" or "show employees below market" if you want the per-person table.*

## Prerequisites

1. A corporation — resolved automatically from your accounts (see Step 1).
2. An active CTC subscription with HRIS-synced employees. If the corp has no subscription, the skill stops with a plain-English message (see Subscription gating).

## Workflow

### Step 1 — Resolve corporation (REQUIRED before anything else)

> **Do this ONCE, upfront, before calling any compensation endpoint.** Do not start fetching subscription status or plan data until you have a confirmed `corporation_id`.

Resolve in this priority order — stop as soon as one path succeeds:

**Path 1 — Explicit numeric ID in the prompt (highest priority, no API call needed)**

If the user mentioned a numeric corporation ID anywhere (e.g. *"corp 7"*, *"corp id 7"*, *"corporation_id=7"*, *"for company 728"*), use that exact integer. Do not call `list_accounts`. Do not search for it. Do not substitute a similar-looking ID.

> Anti-patterns:
> - ❌ User says "corp 7" → agent calls `list_accounts(search="7")` — `list_accounts` searches by name substring, not ID.
> - ❌ User says "corp 7" → agent picks a corp from a previous turn. Each prompt's corp ID overrides any prior context.

**Path 2 — Company name in prompt**

If the user named a company (e.g. *"scorecard for Acme"*), call `list_accounts(search="Acme")`. Filter results to entries where `id` starts with `corporation_pk:`. If exactly one match, use it. If multiple, proceed to Path 4.

**Path 3 — Single account (auto-select, no question needed)**

If the user gave no corp hint at all, call `list_accounts()` with no search. Filter to `corporation_pk:` entries. If exactly **one** corporation is returned, use it automatically — do not ask the user to confirm something they have no choice about.

**Path 4 — Multiple accounts (ask once, cleanly)**

If multiple corporations are found, use `AskUserQuestion` immediately:
- Question: *"Which company's scorecard should I show?"*
- Options: corporation names from the list (cap at 10; offer "Other" if more)

Do **not** show the user a raw JSON dump of accounts. Do **not** attempt any compensation call before they answer.

> **HARD STOP — user dismissed the question:**
>
> If the user closed the prompt, said "cancel", "never mind", or otherwise did not select an option — **STOP**. Do not guess a corp. Do not call any compensation endpoint. Reply:
>
> > *"No problem — let me know which corporation's scorecard to look up (name or numeric ID) when you're ready. If there's something else I can help with in the meantime, just ask."*

Extract the numeric `corporation_pk` (the integer after `corporation_pk:`) for all subsequent calls.

### Step 2 — Verify CTC subscription (REQUIRED)

```
call_tool({"name": "compensation__get__subscription_status",
           "arguments": {"corporation_id": <corporation_pk>}})
```

If `is_subscribed` is False, stop here and surface the subscription message (see **Subscription gating** below). Do not call any scorecard endpoint — they will return empty data and waste a round-trip.

### Step 3 — Decide which lens to query

Pick exactly one based on the user's intent:

| User intent | Lens | Continue to |
|---|---|---|
| Corp-level question (positioning, posture, distribution) | Corporation rollup | Step 4a |
| Employee-level question (who, list, roster, individual compa-ratios) | Per-employee | Step 4b |
| Ambiguous "show me the scorecard" | Default to corporation rollup | Step 4a |

Both lenses read from the employee endpoint; the difference is whether you present a band **rollup** (Step 4a) or the **per-employee table** (Step 4b). If you've already fetched the roster for one and the user asks for the other, reuse the rows you have rather than re-fetching.

### Step 4a — Corporation-level rollup

> **The active-plan rollup is derived from the employee endpoint — NOT from `corporation-scorecard`.** The `corporation-scorecard` endpoint is **comparison-only** (draft plan vs. active plan) and rejects the active plan id with *"Cannot compare active plan to itself"* — so it is the wrong tool for a plain "how are we positioned" question. Use `corporation-scorecard` only for the draft-comparison case (note at the end of this step).

First fetch the active plan (for the data citation footer), then pick a derivation path based on what the user actually asked for:

```
call_tool({"name": "compensation__get__plan",
           "arguments": {"corporation_id": <corporation_pk>}})
```

Capture `plan.id` and `benchmark_version` metadata (for the citation later).

> **CRITICAL — the employee endpoint oversizes.** A full-roster fetch fails: `compensation:get:employee-scorecard` returns *"response too large (limit 40000 chars)"* at `page_size` ≥ ~25. Only `page_size` ≈ 10 reliably fits. Do **not** request `page_size: 500` or try to pull the whole roster in one call. Pagination also returns **overlapping rows** across pages — always dedupe by `ids.external_id` before counting. Never estimate or extrapolate a distribution from a partial sweep — that fabricates financial data. Either complete the sweep or use the counts path below.

#### Path 1 — Counts only (the user wants the distribution / positioning)

For *"how are we positioned"*, *"what's the band distribution"*, *"are we paying market"* — where the user wants **counts, not a per-person table** — get the overall-band counts directly with three filtered calls. Read only `total_results` from each (you don't need the rows):

```
mcp__carta__fetch({"command": "compensation:get:employee-scorecard",
                   "params": {"corporation_id": <corporation_pk>, "score": "LOW",  "page_size": 1}})   → total_results = Low count
mcp__carta__fetch({"command": "compensation:get:employee-scorecard",
                   "params": {"corporation_id": <corporation_pk>, "score": "MID",  "page_size": 1}})   → total_results = Mid count
mcp__carta__fetch({"command": "compensation:get:employee-scorecard",
                   "params": {"corporation_id": <corporation_pk>, "score": "HIGH", "page_size": 1}})   → total_results = High count
```

Plus one unfiltered call (`page_size: 1`) to read the roster `total_results`, for reconciliation.

> **MANDATORY reconciliation — the `score` filter keys on the OVERALL `benchmark.score`, which is nullable.** Employees with a null overall band are excluded from ALL three filtered counts, so `Low + Mid + High` is often **less than** the roster total. (Verified on a real corp: Low 66 + Mid 20 + High 0 = 86, but roster total = 134 → 48 employees had no overall band, and HIGH was 0 even though many were `salary_rating.score: HIGH`.) You MUST:
> - Report this as the **overall** band distribution, explicitly labeled as such.
> - State the uncounted remainder: e.g. *"86 of 134 employees have an overall band; 48 aren't yet scored on the combined measure."* Never present the three counts as if they cover the whole roster.
> - **Do NOT label Path-1 counts as a salary / equity / total-cash breakdown.** The overall band is a combined measure and routinely differs from every per-metric band (an employee can be overall Low while Mid on salary and High on equity). For a per-metric breakdown the user must use Path 2.

This path is cheap (4 calls, no paging) and exact for the overall band. Continue to Step 5a (counts rendering).

#### Path 2 — Per-metric details (the user wants the breakdown or the table)

For *"give me the salary / equity / total-cash breakdown"*, or whenever you also need the per-person rows, sweep the roster at the safe page size and count each metric's own band:

```
mcp__carta__fetch({"command": "compensation:get:employee-scorecard",
                   "params": {"corporation_id": <corporation_pk>, "page_size": 10, "page": 1}})
# fetch successive pages 2,3,… until you have collected total_results unique rows
```

1. **Dedupe** collected rows by `ids.external_id` before counting.
2. **Gate the render:** only produce the distribution once `unique_rows == total_results`. If the sweep can't complete, do not render a partial distribution (see the hard page cap below).
3. Count each metric by its own per-metric band (these are populated even when the overall `benchmark.score` is null):
   - **Salary** → `salary_rating.score`
   - **Equity (NTM)** → `ntm_equity_rating.score`
   - **Total cash** → `total_cash_rating.score`

You are **reading** the band the API already returns per row — never recompute a ratio. Continue to Step 5a (per-metric rendering).

> **🛑 HARD PAGE CAP — at most 25 page fetches per sweep. This is a ceiling you may not exceed.**
>
> At `page_size: 10`, 25 pages covers 250 employees — larger than any expected CTC roster. If you reach **25 page fetches** and still have not collected `total_results` unique rows, **STOP. Do not fetch page 26.** Do not render a partial or estimated distribution. Tell the user the roster is too large to sweep through chat and offer to narrow with a filter (job area / level / `leader`), then stop and wait for their reply.
>
> Do **not** try to slip past this cap. Specifically forbidden: raising `page_size` above ~10 to cover more per call (it oversizes and 400s), "just a few more pages" past 25, restarting the sweep from page 1 to reset the counter, or switching to a different command to grab the rest. Each of those is the same unbounded loop wearing a disguise. The cap counts **total** page fetches for this sweep, including retries of a failed page.
>
> A single page that errors (oversize / transport) counts as one attempt against the cap — retry that page at most **once**, then if it still fails, STOP and surface the failure with the partial count collected so far; do not keep hammering it.

**Optional filters (either path)** — pass through verbatim if the user specified them:
- `job_filters`: narrow by job area and/or level — a list of comma-delimited strings `"JobArea,Level,LimitingLevel"` (e.g. `["ENGINEER"]`, `["ENGINEER,SENIOR1"]`). See the `job_filters` format box in Step 4b for the exact encoding — it's the #1 thing agents get wrong.
- `leader`: `true` for managers/executives only, `false` for ICs only
- There is **no** `location` or top-level `level` filter (level only via `job_filters`). For location, filter the fetched rows client-side and say so.

> **When to use `corporation-scorecard` instead.** Only when the user is comparing a **draft / in-flight plan** against the active plan ("how would our positioning change under the new plan?"). It requires the **draft** plan's `plan_id` (a non-active plan), never the active plan's id:
>
> ```
> mcp__carta__fetch({"command": "compensation:get:corporation-scorecard",
>                    "params": {"corporation_id": <corporation_pk>,
>                               "plan_id":        <DRAFT_plan.id>}})
> ```
>
> It returns `{active_plan_counts_per_band, current_plan_counts_per_band}` for the side-by-side comparison in Step 5a. If you only have the active plan (no draft is being modeled), this endpoint is the wrong tool — use the employee-derived rollup above. If you pass the active id and get *"Cannot compare active plan to itself"*, do not surface that error — fall back to Path 1.

### Step 4b — Per-employee scorecard

```
mcp__carta__fetch({"command": "compensation:get:employee-scorecard",
                   "params": {"corporation_id": <corporation_pk>,
                              "page_size": 10}})
```

> The param is `page_size` (snake_case) — camelCase `pageSize` is silently dropped by the tool layer, leaving you on the default page size. And keep `page_size` small (~10): the endpoint returns *"response too large"* at `page_size` ≥ ~25 on larger rosters.

Optional filters (pass through verbatim — translate user phrasing to enums):

| User phrasing | Param | Value |
|---|---|---|
| "below market" (overall) | `score` | `LOW` |
| "at market" (overall) | `score` | `MID` |
| "above market" (overall) | `score` | `HIGH` |
| "engineers", "engineering team" | `job_filters` | `["ENGINEER"]` |
| "senior 1 engineers" (job + level) | `job_filters` | `["ENGINEER,SENIOR1"]` |
| "everyone at senior 1" (level only) | `job_filters` | `[",SENIOR1,"]` |
| "managers", "leaders", "people managers" | `leader` | `true` |
| "ICs", "individual contributors" | `leader` | `false` |
| a specific person by name ("show me Ada Lovelace's scorecard") | `name` | `"Ada Lovelace"` |
| a specific person by employee UUID | `employee_id` | `<uuid>` |

Use Title Case in narration even when passing the raw enum to the API. Example: *"Pulling the Engineering roster scorecard for Acme — filtering to Below market employees."*

> **`job_filters` format — read this; it's the #1 thing agents get wrong.** Each element is a **comma-delimited STRING** `"JobArea,Level,LimitingLevel"`, NOT an object and NOT colon-delimited. The whole param is a **list of such strings**.
>
> | Intent | Pass | ✗ Do not pass |
> |---|---|---|
> | Engineers (any level) | `["ENGINEER"]` | ❌ `[{"job":"ENGINEER"}]` ❌ `"ENGINEER"` (bare, unwrapped) |
> | Engineers at exactly Senior 1 | `["ENGINEER,SENIOR1"]` | ❌ `["ENGINEER:SENIOR1"]` ❌ `[{"job":...,"level":...}]` |
> | Anyone at exactly Senior 1 | `[",SENIOR1,"]` | — |
> | Anyone at level ≤ VP 2 (3rd slot = limiting level) | `[",,VP2"]` | — |
> | Multiple job areas | `["ENGINEER", "SALES"]` | — |
>
> The 2nd CSV slot is exact level; the 3rd is a "≤ this level" cap. `JobArea` is a `JobType` enum (`ENGINEER`, `SALES`, …); `Level`/`LimitingLevel` are `LevelCode` enums (`ENTRY`, `MID1`, `SENIOR1`, … `C_LEVEL`, `CEO`). Passing an object or `job:level` with a colon returns HTTP 400 *"… is not a valid selection for type JobType"*.
>
> **Use the enum NAME, and don't guess it.** Pass `ENGINEER`, not `"Engineering"`; `CUSTOMER_SUCCESS`, not `"Customer Success"`/`"Customer Support"`; `SENIOR1`, not `"Senior 1"` — the Title-Case forms are user-facing only and 400 as API values. If you're unsure of a valid `JobType`/`LevelCode` name, read the full list from `search_tools({"query": "compensation get benchmark"})` (its help enumerates every job area and level). **There is no `compensation:list:job_types` / `list:jobs` / `list:levels` command — do not invent one; it returns `Unknown tool`.**
>
> **There is NO top-level `level` filter and NO `location` filter on this endpoint** — `level` is only reachable through the `job_filters` CSV (above), and a top-level `level` param is silently ignored. Location cannot be filtered server-side at all. If the user asks to filter by location (e.g. "show me below-market employees in Austin"), fetch the roster and filter client-side on `location.home_location` / `location.work_location`, and tell the user you filtered locally.

> **CRITICAL — the `score` filter keys on the OVERALL band only, and it is nullable.**
>
> The `score` filter param matches against `benchmark.score` (the combined equity+salary overall band) — **not** `salary_rating.score` or any per-metric band. Two consequences:
>
> 1. **It does not answer metric-specific questions.** For *"who's below market **on salary**"* / *"above market on equity"*, the `score` filter is the wrong tool — it filters the overall band, not the salary or equity band.
> 2. **Employees with a null overall `score` are silently excluded.** Any `score=...` filter only returns rows whose overall band is non-null. An employee can have `salary_rating.score: HIGH` but a null `benchmark.score` — they will be **invisible** to `score=HIGH`. This is why band-filtered counts can fall short of the unfiltered total.
>
> **To answer a metric-specific band question:** do **not** pass the `score` filter. Sweep the roster using the **capped procedure in Step 4a → Path 2** (page at `page_size` ≈ 10, dedupe by `ids.external_id`, **hard cap of 25 page fetches**, then STOP and offer to narrow), and read the relevant per-metric band client-side — `salary_rating.score` for salary, `ntm_equity_rating.score` for equity, `total_cash_rating.score` for total cash. You are *reading a field that is already in each response* — you are **not** recomputing the ratio. The compa-ratio and band are returned by the API; never recompute them from salary ÷ target.

**Sorting a list.** When the user asks for an *ordered* roster ("worst compa-ratios first", "sort by name"), pass `sort_field` (e.g. `SCORE`, `NAME`, `LEVEL`, `EQUITY_COMPARATIO`) plus `reverse_sort` (`true`/`false`). Sorting orders a list the user wants to see — it is never a substitute for filtering to a specific person (see Single-employee lookup).

#### Single-employee lookup

There is **no single-employee scorecard endpoint** — an individual's compa-ratio and percentile only exist as a row inside the corporation's batch-computed scorecard, scored relative to the whole roster. To answer *"show me [person]'s scorecard"*, query the same `employee_scorecard` endpoint **filtered to that one person**:

- If you have their employee UUID, pass `employee_id` (exact match — returns at most one row).
- Otherwise pass `name` (substring match against full / first / last name — may return more than one person).

```
mcp__carta__fetch({"command": "compensation:get:employee-scorecard",
                   "params": {"corporation_id": <corporation_pk>,
                              "name": "Ada Lovelace"}})
```

Then:
- **Exactly one match** → render that single row (you can use the per-employee table with one row, or narrate the fields inline).
- **Multiple matches** (common with a partial/common name) → list the matches and ask which one with `AskUserQuestion`; do not assume the first.
- **Zero matches** → *"No employee named '[name]' is in this corporation's scorecard. Check the spelling, or ask for the full roster."*

> **Anti-pattern — never sort-and-pick to answer an individual question.** Do NOT pull the unfiltered roster, sort by `NAME`, and read off the top row — that returns whoever sorts first alphabetically (e.g. "A Robot"), not the person asked about. Always filter by `name` or `employee_id`. `sort_field` is for ordering a *list* the user asked to see, not for locating one person.

Also fetch the active plan once (for the citation footer):

```
call_tool({"name": "compensation__get__plan",
           "arguments": {"corporation_id": <corporation_pk>}})
```

Continue to Step 5b to render.

### Step 5a — Render the corporation-level rollup

**Path 1 — overall-band counts (from the three filtered calls).** Render a single overall-band row, and always disclose the uncounted remainder:

```
## Compensation Scorecard: [Company Name]

Overall band (combined salary + equity):

| Band | Employees | Share of scored |
|------|-----------|-----------------|
| Low  | 66 | 77% |
| Mid  | 20 | 23% |
| High |  0 |  0% |

86 of 134 employees have an overall band; 48 aren't yet scored on the combined measure.
Want the salary / equity / total-cash breakdown, or the per-person table? Just ask.

---
*Data source: Companies with post money valuations between [peer_group_label]. Benchmarks released [Month YYYY].*
```

Percentages on this path are a share of the **scored** population (Low+Mid+High), not the full roster — say so. Never imply the three counts cover everyone.

**Path 2 — per-metric breakdown (from the deduped roster sweep).** Render one row per metric:

```
## Compensation Scorecard: [Company Name]

| Rating          | Low      | Mid       | High      | Total |
|-----------------|----------|-----------|-----------|-------|
| Salary          | 12 (24%) | 28 (56%)  | 10 (20%)  | 50    |
| Equity (NTM)    |  5 (10%) | 35 (70%)  | 10 (20%)  | 50    |
| Total cash      |  8 (16%) | 30 (60%)  | 12 (24%)  | 50    |

50 employees in scope. 12 employees are Low (below market) on salary.

Ask me to "show employees below market" if you want the per-person table.

---
*Data source: Companies with post money valuations between [peer_group_label]. Benchmarks released [Month YYYY].*
```

The per-metric total is the number of rows with a non-null band for that metric — it can differ slightly per metric. Compute each percentage as `count / total * 100` rounded to the nearest integer; if `total == 0`, render `—` instead of `0%`.

**Draft-vs-active comparison (only when you called `corporation-scorecard` with a draft plan id).** That endpoint returns:

```
{
  "active_plan_counts_per_band": {
    "salary":     {"LOW": N, "MID": N, "HIGH": N},
    "ntm_equity": {"LOW": N, "MID": N, "HIGH": N},
    "total_cash": {"LOW": N, "MID": N, "HIGH": N}
  },
  "current_plan_counts_per_band": { ... same shape, the draft plan ... }
}
```

Show both blocks side by side with "Current plan" (the draft) and "Active plan" labels, plus a one-line note: *"Current plan reflects in-flight modeling; active plan is what's in force today."*

### Step 5b — Render the per-employee scorecard

Response shape per employee:

```
{
  "ids": {"external_id": "0e5177ee-..."},          // dedupe key for paging
  "personal_info": {"first_name": "...", "last_name": "...", "full_name": "..."},
  "title": {"role": {"level": "MID2", "job": "ENGINEER",
                     "leader": false, "focus": "DevOps and Site Reliability"},
            "official_title": "Software Engineer, Business Systems",
            "external_id": "..."},
  "salary":     {"pay_unit": "YEARLY", "amount": "114645.00", "currency": "USD"},
  "total_cash": {"pay_unit": "YEARLY", "amount": "114645.00", "currency": "USD"},
  "equity_v2":  { "initial_grant": {...}, "total_grant": {...}, "vested": {...},
                  "annualized_ntm": {...}, "next_12_months": {...} },   // may be absent
  "location": {"home_location": {"city": "Tulsa", "state": "OK", "country": "US"},
               "work_location": {"city": "Austin", "state": "TX", "country": "USA"}},
  "tenure": {"start_date": "2018-12-31", "end_date": null},
  "benchmark": {
    "score": "LOW",                                // OVERALL — nullable AND may be absent entirely
    "salary_rating": {"percentile": "43.00", "compa_ratio": "0.96",
                      "score": "MID",
                      "target": {"yearly_amount": "119000.00"},
                      "difference_from_mid": {"yearly_amount": "-4355.00", "percentage": "-3.66"},
                      "currency_code": "USD"},
    "total_cash_rating":          { ... same shape, total-cash target ... },
    "ntm_equity_rating":          { ... equity target, fully_diluted_percentage/shares ... },  // may be absent
    "total_equity_rating":        { ... equity ... },                                          // may be absent
    "unvested_equity_rating":     { ... equity ... },                                          // may be absent
    "paybands_salary_rating":     { ... payband salary target ... },
    "paybands_ntm_equity_rating": { ... payband equity target ... }   // may be absent
  }
}
```

> **The response shape varies per employee.** Not every row carries every field. Observed on real data: some rows have **no top-level `benchmark.score`** at all, and equity ratings (`ntm_equity_rating`, `total_equity_rating`, `unvested_equity_rating`, `paybands_ntm_equity_rating`) are present only when the employee has equity data. Read defensively — treat a missing rating the same as a null one. Identity is under `personal_info`; classification is under `title.role.{level, job, leader, focus}` with the human title in `title.official_title`.

> **CRITICAL — there is no single "the score". There are SIX distinct ratings, and they are independent.**
>
> | Field | What it means | Compares against |
> |---|---|---|
> | `score` | **Overall** quick-glance band — a combined view of how the employee is doing on **equity *and* salary** together. **Nullable.** | (rollup of the below) |
> | `salary_rating` | **Market Salary ratio** — salary vs market | benchmark |
> | `total_cash_rating` | **Total Cash ratio** — total cash comp vs market | benchmark |
> | `ntm_equity_rating` | **Market Equity ratio** — equity vs market | benchmark |
> | `paybands_salary_rating` | **Payband Salary ratio** — salary vs the corp's own payband | payband |
> | `paybands_ntm_equity_rating` | **Payband Equity ratio** — equity vs the corp's own payband | payband |
>
> Each rating has its own `score` (band), `compa_ratio`, and `percentile`. **`benchmark.score` (overall) is NOT the same as `salary_rating.score`** — an employee can be `salary_rating.score: HIGH` while `benchmark.score` is `null` or a different band. Never treat one as a proxy for the other. Always tell the user *which* source a number came from (e.g. "Market Salary ratio" vs "Payband Salary ratio" vs "overall score").

**Classification.** Read the saved classification from `title.role.{level, job, focus, leader}`, and the human-readable title from `title.official_title`. Render the level/job in Title Case per the casing rule (e.g. `MID2` → `Mid 2`, `ENGINEER` → `Engineering`).

**Table format** — six columns, per Carta UX rules:

```
## Roster Scorecard: [Company Name] [— filtered to Low / Engineering / Managers]

| # | Name             | Title                        | Level     | Salary compa-ratio | Band  |
|---|------------------|------------------------------|-----------|--------------------|-------|
| 1 | Ada Lovelace     | Senior Software Engineer     | Senior 1  | 0.81               | Low   |
| 2 | Grace Hopper     | Staff Software Engineer      | Staff 1   | 0.94               | Mid   |
| 3 | …                | …                            | …         | …                  | …     |

**50** employees checked. **12** Low, **28** Mid, **10** High.

---
*Data source: Companies with post money valuations between [peer_group_label]. Benchmarks released [Month YYYY].*
```

**Which band to show for a bare "who's below/above market?" (no metric named).** Prefer the **overall `score`** when it's available — it's the combined equity+salary quick-glance band. Label it explicitly as the overall score, and offer a follow-up to drill into a specific ratio:

> *Banding by overall score (combined salary + equity). Want me to break this out by Market Salary ratio, Market Equity ratio, or Total Cash instead?*

If `benchmark.score` is **null** for an employee (overall not computed), fall back to the most relevant per-metric band — `salary_rating.score` for a pay question — and **say so in that row's source**, rather than dropping the employee or showing a blank. Never silently mix overall-banded and salary-banded employees in one column without flagging which is which.

**Compa-ratio formatting.** The API returns it as a decimal string (e.g. `"0.81"`). Render with two decimals, no `%` sign. A compa-ratio of `1.00` means at-target; below 1.0 is below-target, above is above-target.

**Gap formatting.** Whenever you show a "Gap" column — Salary Gap or TCC Gap — always render BOTH the currency amount AND the percentage together, from that rating's `difference_from_mid`:

```
{sign}{currency_symbol}{abs(yearly_amount)} ({percentage}%)
```

`yearly_amount` is already signed (e.g. `"-4355.00"`) — the sign goes **in front of** the currency symbol, not between the symbol and the digits. Extract the sign first (empty string for positive/zero, `-` for negative), then render the symbol, then the absolute value. Do NOT put `{currency_symbol}` before an unmodified signed `yearly_amount` — that produces `$-4355.00`, which is wrong; the correct form is `-$4,355`.

Format the absolute value with locale comma separators and no decimal places (drop the `.00`): `"4355.00"` → `4,355`, not `4355.00` or `4,355.00`. `percentage` is already two-decimal-place (e.g. `"-3.66"`) — render it as-is with a trailing `%`, keeping its own sign.

`difference_from_mid` has no currency of its own — derive `{currency_symbol}` from the **parent rating's** `currency_code` (e.g. `salary_rating.currency_code`), mapped to a symbol (`USD`→`$`, `EUR`→`€`, `GBP`→`£`, `CAD`→`C$`, etc.). Never hardcode `$` — international corps report in EUR, GBP, and other currencies, and assuming USD misrepresents their pay.

e.g. `-$4,355 (-3.66%)` for a USD salary gap; `-€4,355 (-3.66%)` for a EUR salary gap.

- Salary Gap ← amount/percentage from `salary_rating.difference_from_mid.{yearly_amount, percentage}`, symbol from `salary_rating.currency_code`
- TCC Gap ← amount/percentage from `total_cash_rating.difference_from_mid.{yearly_amount, percentage}`, symbol from `total_cash_rating.currency_code`

`total_cash_rating` has the same shape as `salary_rating`, so the percentage is always available — never drop it for TCC. Salary Gap and TCC Gap must use the identical `{sign}{currency_symbol}{amount} (±%)` format; showing the amount alone for one but not the other is inconsistent and wrong. If `difference_from_mid` is absent for that rating, render `—` for the whole Gap cell rather than a partial value.

**Pagination — fetching is NOT the same as displaying. Don't make the user "next page" through a list you already have.**

`page_size` ≈ 10 is a **fetch-side** constraint (the API oversizes at larger sizes) — it is **not** how much to show the user. Once you've collected the rows for the result the user asked for, **render all of them in one table.** A 19-row below-market list is one table of 19 rows, not "showing 1–10, ask for the next page." Mirroring the fetch page size into the display is a bug.

- **Collected ≤ 50 rows → show them all.** Page the *fetches* under the hood (dedupe by `ids.external_id`, respect the 25-page cap), then render the full collected set as a single table. Do not split it across "pages" in chat.
- **More than ~50 rows in the result** → this is too long to dump in chat. Do **not** offer manual "next page" paging through dozens of fetches. Instead show the first 50 and tell the user to **narrow with a filter** (job area / level / `leader` / band):

  > *Showing 50 of 87. That's a lot to scroll — narrow with a filter (e.g. by job area, level, or band) and I'll show the focused list.*

- The 25-page **fetch** cap (Step 4a) still governs how far you sweep; it is unrelated to how many rows you display.

**Equity / total-cash columns.** The default table shows salary compa-ratio because that's the most common scorecard lens. If the user explicitly asked about equity ("equity compa-ratios", "show equity scorecard"), swap the column for `ntm_equity_rating.compa_ratio` and rename the column header to "Equity compa-ratio (NTM)". Same for total cash: column header "Total cash compa-ratio". If the user asked for **Gap** instead of compa-ratio ("total cash gap", "TCC gap"), swap in "TCC Gap" using the same `{sign}{currency_symbol}{amount} (±%)` format as Salary Gap — see **Gap formatting** above; never render TCC Gap as an amount-only value when Salary Gap shows both, and never hardcode `$` for either column. Don't try to fit all three rating types in one table — it blows the 6-column limit and reads as noise.

**Empty roster.** If `count == 0` but `total_results == 0` for the corp, surface:

> *No employees in scope for this scorecard. This usually means HRIS sync hasn't yet imported employees for this corporation — check the Carta CTC product UI or contact the CTC team.*

**Empty filter result.** If `count == 0` because a filter excluded everyone (e.g. `score=LOW` returned nothing):

> *No employees match that filter. Try a different band, or drop the filter to see the full roster.*

**Band-filter undercount (null overall score).** If a `score=...` filtered query returns **fewer** employees than the unfiltered roster total, do not report the filtered count as complete. Some employees likely have a null overall `benchmark.score` and are excluded by any `score` filter (see the CRITICAL note in Step 4b). If the user's question is metric-specific (salary / equity / total cash), re-fetch the roster **without** the `score` filter and read the per-metric band per employee instead. Only the overall-`score` filter has this null-exclusion behavior; the per-metric bands inside each row are always present when that metric was benchmarked.

## Data citation

Every response that includes scorecard data MUST end with the citation footer in italics below a horizontal rule:

```
---
*Data source: Companies with post money valuations between [peer_group_label]. Benchmarks released [Month YYYY].*
```

- `peer_group_label`: from `compensation:get:plan` → `peer_group.label` (e.g. `"$50M-$100M"`).
- `Month YYYY`: derived from `benchmark_version.created` ISO timestamp (e.g. `"2026-05-06T..."` → `"May 2026"`). Not a version number.

This is the same citation contract as carta-compensation-benchmarks — keep it consistent across the plugin.

## Subscription gating

If `compensation:get:subscription_status` returns `is_subscribed: false`, OR a scorecard call returns HTTP 403, OR `compensation:get:plan` returns 403, stop and reply with this exact message (substitute the company name):

> **No CTC subscription for [Company Name].**
>
> This corporation doesn't have an active Carta Total Compensation subscription, so we can't generate a scorecard. Reach out to the CTC team to get set up, then run this again once the subscription is active.

Do not retry. Do not surface the raw HTTP status, stack trace, or error body. Do not list workarounds — there are none at the MCP layer; this is a billing/subscription gate.

## Error handling

| Condition | What to do |
|---|---|
| `compensation:get:plan` returns no active plan | *"No active CTC plan for this corporation. The scorecard needs an active plan to compute against — ask the corp's CTC admin to activate one in the product UI."* |
| `corporation-scorecard` errors with *"Cannot compare active plan to itself"* | You passed the **active** plan id to a comparison-only endpoint. Expected — don't surface it to the user. Fall back to the employee-derived rollup (Step 4a, Path 1). Only use `corporation-scorecard` with a **draft** plan id. |
| Scorecard regeneration is in flight (response carries `task_status.state: PENDING` / `RUNNING`) | Surface the partial data if present, append: *"The scorecard is currently regenerating in the background. Numbers may shift in the next few minutes."* |
| Unknown band value (anything other than LOW / MID / HIGH) | Render verbatim in chat; don't substitute. The API enum may have grown. |
| Network/transport error | One retry. If it fails again, surface: *"Couldn't reach compensation-service. Try again in a moment — if this keeps happening, contact Carta support."* |
| Response too large (*"response too large (limit 40000 chars)"*) | Drop `page_size` to ~10 and page through. Never estimate a distribution from a partial sweep — complete it or tell the user it couldn't be completed. |

## Anti-patterns

- ❌ Calling `corporation-scorecard` with the **active** plan id to get a plain rollup — it's a comparison-only endpoint and rejects the active plan with *"Cannot compare active plan to itself."* Derive the rollup from the employee endpoint (Step 4a); reserve `corporation-scorecard` for draft-vs-active comparisons.
- ❌ **Estimating or extrapolating a band distribution from a partial roster sweep** ("~55% Low", "roughly half"). If you can't collect every row (oversize/transport errors), say so — never fabricate a distribution. Use Path 1 (filtered counts) or complete the Path 2 sweep.
- ❌ Counting paged rows without deduping by `ids.external_id` — pages overlap, so a naive count double-counts. Always dedupe first.
- ❌ Paging past the **25-page hard cap** on a Path 2 sweep — raising `page_size`, fetching "just a few more" pages, restarting from page 1, or switching commands to grab the rest are all the same unbounded loop in disguise. At 25 fetches, STOP and offer to narrow with a filter.
- ❌ Showing both salary AND equity AND total cash compa-ratio columns in the same table — exceeds 6 columns and reads as noise. Default to salary; let the user ask for a different lens.
- ❌ Hiding employee names — customers see them in the CTC product already.
- ❌ Re-classifying titles via the rolematcher — the scorecard endpoint already reads the corp's saved classifications. Don't second-guess them.
- ❌ Using `pageSize` (camelCase) or a large `page_size` (≥25) — camelCase is silently dropped, and ≥25 oversizes. Use `page_size` ≈ 10 and page.
- ❌ Mirroring the fetch `page_size` into the **display** — e.g. showing "1–10 of 19, ask for the next page" when you've already collected all 19 rows. `page_size` ≈ 10 is a fetch constraint, not a display limit. Render the full collected set (≤ 50 rows) in one table; only for >50 rows show the first 50 and ask the user to narrow.
- ❌ Treating `benchmark.score` (overall) and `salary_rating.score` as interchangeable — they are independent fields. The overall is a combined equity+salary band and is nullable; the salary band is metric-specific.
- ❌ Using the `score=...` filter to answer a metric-specific question ("below market on salary") — it keys on the nullable overall band and silently drops employees with a null overall score. Fetch the roster and read the per-metric band instead.
- ❌ Reporting a band-filtered count as the full answer when it's lower than the unfiltered total — the gap is usually null-overall-score employees the filter excluded. Re-fetch unfiltered for metric-specific questions.
- ❌ Recomputing a compa-ratio or band from salary ÷ target — the API already returns `compa_ratio` and `score` per rating. Read them; never compute them.

## What this skill does NOT cover

- **Market-rate lookups for a hypothetical role** (e.g. "what's the market rate for a Senior 1 engineer?") — that's `carta-compensation-benchmarks`.
- **Fresh-CSV roster scoring** (e.g. "score these 200 employees from this spreadsheet") — not supported in Phase 0. Coming in a later phase.
- **Adjustment-range suggestions** ("to reach P50, increase by $X") — not in Phase 0.
- **Job classification** for a free-text title — use `carta-compensation-rolematcher`.

If the user asks for any of those, route them to the right skill in one sentence and stop — don't try to approximate it here.
