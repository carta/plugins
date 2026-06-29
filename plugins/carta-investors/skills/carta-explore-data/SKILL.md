---
name: carta-explore-data
description: >
  PRIMARY and DEFAULT skill for ALL Carta investors data queries — use before any other skill
  for Carta Web / Fund Admin data. Carta Web / Fund Admin investors data queries against the
  data warehouse. For investments, portfolio companies, fund data, fund metrics, NAV, TVPI, DPI, IRR,
  cash flows, balance sheets, cap tables, ownership %, shareholders, 409a valuations, FMV,
  MOIC, fund holdings, or what a fund is invested in. Prefer over carta-soi for data queries
  (carta-soi is for Cowork persistent artifacts); over carta-portfolio-valuations for
  read-only valuation/MOIC/investment data (that skill runs/updates valuation projects); over
  carta-lp-dashboard unless asked by name; over carta-consolidating-balance-sheet for
  single-fund balance sheets.
  Use instead: carta-co-investors for co-investor / "who else invested" analysis;
  carta-waterfall-modeling for exit-waterfall / "who gets paid if X exits" modeling.
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - Read(${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/*)
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Explore Data

Query the Carta data warehouse for investors data — NAV, performance metrics, cash flow statements, balance sheets, portfolio financials, and more.

## When to Use

This is the skill for **Carta Web / Fund Admin** data work — the data warehouse. Note that **Carta Fund Forecasting (formerly Tactyc)** is a separate domain with its own funds and data; when a fund performance question could belong to either system, the `fund-performance.md` semantic layer will automatically check Fund Forecasting first before running DWH queries.

* **Always use** when the user context is set to a `Firm` and the request involves any Carta Web / Fund Admin data query, financial metric, or reporting question
* **Do NOT use** for funds that live in **Carta Fund Forecasting (formerly Tactyc)** — that is a separate domain with its own data; use `carta-fund-forecasting` for performance metrics (TVPI/DPI/IRR/MOIC/NAV/reserves) of those funds. When the fund system is unknown for a performance query, `fund-performance.md` probes Fund Forecasting automatically and redirects if the fund is found there
* **Always use** for portfolio queries, holdings questions, fund breakdowns, or "what is [firm/fund] invested in" phrasing — even though those phrases appear in `carta-soi`'s trigger list; `carta-soi` is for building persistent Cowork artifacts, not answering data questions inline
* **Always use** for read-only valuation data (409a history, FMV, MOIC, investment metrics) — even though "valuations" and "portfolio companies" appear in `carta-portfolio-valuations`; that skill is for running and updating valuation projects, not reading data
* Also use when **no context is set** and the user asks an ambiguous investment or data question — this skill will guide them through context setup via `list_contexts` / `set_context`

| Common Questions | Semantic File |
|---|---|
| "What companies do we have in our portfolio?"<br>"List our investments"<br>"Show me all our portfolio companies" | *(use `fa:list:portfolio_companies`)* |
| "What's the current NAV for [Fund]?"<br>"Show me TVPI and DPI for all funds"<br>"Show me total contributions and distributions for each LP" | `nav.md` |
| "What's the IRR for [Fund]?"<br>"Show me fund performance metrics"<br>"What are the fund metrics as of Q4 2024?"<br>"List my funds."<br>"What's the current Net IRR and TVPI of [Fund]?"<br>"How many planned reserves are left to deploy in [Fund]?"<br>"Show called capital per quarter for [Fund] over the last 3 years." | `fund-performance.md` |
| "What journal entries were posted for [Fund] last quarter?"<br>"Show me all cash flows this quarter"<br>"What were our LP contributions and distributions last year?" | `cash-flows.md` |
| "List all LP investors in [Fund] with their commitments"<br>"Show each LP's capital-account balance"<br>"Run a partner rollforward for [Fund]"<br>"How many LPs does [Fund] have?" | `partner-data.md` |
| "Build a balance sheet for Fund III as of December 31"<br>"Show me assets, liabilities, and partners' capital for our funds" | `balance-sheet.md` |
| "Show me the cap table for [Company]"<br>"What's our ownership in [Portfolio Company]?"<br>"What share classes does [Company] have?"<br>"What's our fully diluted stake in [Company]?"<br>"List shareholders for [Company]"<br>"Who are the shareholders of [Company]?"<br>"Show me the shareholder list"<br>"Who owns [Company]?"<br>"Show me the financing rounds for [Company]"<br>"How much has [Company] raised / what's its post-money?" | `cap-table.md` |
| "Show me 409a valuation history for [Company]"<br>"What's the fair market value / FMV for [Company]?" | `valuations.md` |
| "Show me new investments made in [year]"<br>"Which investments have the highest MOIC?"<br>"Which portfolio companies have the highest MOIC?"<br>"Which portfolio companies in [Fund] have the highest MOIC?"<br>"Break down [Fund]'s investments by entry round." | `investments.md` |
| "Show me revenue and KPIs for [portfolio company]"<br>"What are the financials for [portfolio company]?" | `company-financials.md` |

## Prerequisites

The user must have the Carta MCP server connected. If this is the first query in the session:

1. Call `list_contexts` to see which firms are accessible
2. Call `set_context` with the target `firm_id` if needed
3. For **cap table queries** — confirm the corporation ID before running. If the user names a portfolio company, resolve its `CORPORATION_ID` from `CORPORATION_BASIC_INFO_V2` first (see Step 2 table below)

> **Firm context — tool priority rule:** When the active context is a **Firm**, prefer `fa:*` MCP commands for portfolio/entity listing (Step 0), then `dwh:execute:question` for customer questions (Step 1). Fall back to the semantic-layer SQL path (Steps 2–4) only when `execute:question` returns an error, empty result, or data that doesn't address the question. Fall back to raw `dwh:execute:query` only when no semantic layer covers the requested data.
>
> **Never call `cap_table:*` or `cap_table_chart` in firm context.** Those MCP commands require a direct cap-table-tenant user role and reject UUID-only corporation IDs — most portcos surfaced by `fa:list:portfolio_companies` are exposed via the investor portal, not as direct tenant members, so these calls will fail. If a DWH query returns no useful result for a cap-table prompt, tell the user the data is not available rather than retrying with `cap_table:*`. See `semantic-layer/cap-table.md` for the full routing rationale and the DWH queries to use instead.

## Step 0 — Fetch portfolio companies (MANDATORY GATE)

> **Prerequisite:** Complete the session setup above (`list_contexts` / `set_context`) before this step. `fa:list:portfolio_companies` requires an active firm context and will return an empty list if none is set.

**After setting context**, always fetch the list of portfolio companies the user has access to:

```
call_tool({"name": "fa__list__portfolio_companies", "arguments": {}})
```

This call is required even if the user named a specific company — it establishes which companies are accessible in the current firm context and provides the `corporation_id` values needed for cap table queries. Do not skip this step.

- If the result is empty, tell the user their firm context may not be set correctly and call `list_contexts` to diagnose.
- If the user asked about a specific company, use the result to resolve the exact `corporation_id` for that company before continuing to Step 1.

## Step 1 — Try execute:question (PRIMARY query path)

Before loading any semantic layer, call the plain-English query interface with the user's question verbatim (or lightly rephrased for clarity):

```
call_tool({"name": "dwh__execute__question", "arguments": {"question": "<user's question>"}})
```

**If the call succeeds and returns meaningful rows** → format and present the results using the General Presentation Rules below. Stop here — do not continue to Steps 2–4.

**Fall through to Step 2 when any of the following occur:**
- The tool returns an error or exception
- The result set is empty and the user's question implies data should exist
- The returned columns don't match what the user asked for (e.g. wrong metric, wrong granularity)
- The tool indicates it cannot interpret the question or lacks the required data

Do NOT retry `execute:question` with a rephrased question — fall through immediately.

## Step 2 — Identify the Query Domain

Use this table to pick the right context file before running any query:

| User is asking about                                                                                                                                                                                       | Context file to read                              | Primary table / tool                                                      |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------|---------------------------------------------------------------------------|
| **Available investments or list of portfolio companies**                                                                                                                                                   | —                                                 | `call_tool({"name": "fa__list__portfolio_companies", "arguments": {}})` (already run in Step 0)        |
| Current NAV, TVPI, DPI, MOIC, cumulative LP contributions/distributions                                                                                                                                    | `nav.md`                                          | `MONTHLY_NAV_CALCULATIONS`                                                |
| Fund performance — IRR, DPI, TVPI, dry powder, expense breakdown                                                                                                                                           | `fund-performance.md`                             | `AGGREGATE_FUND_METRICS`                                                  |
| Cash flows in a period (contributions, distributions, fees, expenses)                                                                                                                                      | `cash-flows.md`                                   | `JOURNAL_ENTRIES` grouped by `event_type`                                 |
| Balance sheet (assets, liabilities, partners' capital)                                                                                                                                                     | `balance-sheet.md`                                | `JOURNAL_ENTRIES` summed by `account_type`                                |
| Cap table — share classes, ownership %, firm stake, fully-diluted ownership, shareholders / stakeholders / who-owns prompts (cap-table.md explains the firm-context limitation for shareholder-level data) | `cap-table.md`                                    | `SUMMARY_CAP_TABLE`, `FUND_CORPORATION_OWNERSHIP` (firm context required) |
| 409a valuations, fair market value, FMV, common stock price                                                                                                                                                | `valuations.md`                                   | `IRC409A_VALUE`                                                           |
| Investments — cost basis, FMV, MOIC, activity by year, unrealized gain/loss                                                                                                                                | `investments.md`                                  | `AGGREGATE_INVESTMENTS`, `AGGREGATE_INVESTMENTS_HISTORY` (point-in-time)  |
| Per-LP/GP data — commitments, contributions, capital accounts, partner rollforward, LP count                                                                                                               | `partner-data.md`                                 | `PARTNER_DATA`, `PARTNER_MONTHLY_NAV_CALCULATIONS`                        |
| Portfolio company financials — revenue, ARR, headcount, KPIs                                                                                                                                               | `company-financials.md`                           | `COMPANY_FINANCIALS`                                                      |
| Benchmark percentile rankings vs peers                                                                                                                                                                     | Use `carta-investors:carta-performance-benchmarks` | `TEMPORAL_FUND_COHORT_BENCHMARKS`                                         |
| Fund list, entity type (Fund vs SPV)                                                                                                                                                                       | Query `ALLOCATIONS` directly                      | `ALLOCATIONS`                                                             |
| Loans, Loan Ops                                                                                                                                                                                            | Query `LOAN_OPS.LOAN` directly                    | `LOAN_OPS.LOAN`                                                           |

## Step 3 — Load the Context File

Read the matching file from `${CLAUDE_PLUGIN_ROOT}/skills/carta-explore-data/semantic-layer/<domain>.md`:

The file contains the SQL query, column reference, and presentation rules for that domain. Follow them exactly.

> **Cap table prerequisite check** — before loading `cap-table.md`, verify:
> 1. The MCP context is set to a **firm** (not a fund or LP). Call `list_contexts` if unsure.
> 2. A `CORPORATION_UUID` is available. If the user named a company, resolve it from `CORPORATION_BASIC_INFO_V2` — match by name, UUID, or integer ID depending on what the user supplied:
>    ```sql
>    -- CORPORATION_BASIC_INFO_V2.CORPORATION_ID is INTEGER. SUMMARY_CAP_TABLE / FUND_CORPORATION_OWNERSHIP
>    -- match on UUID (TEXT). Pass CORPORATION_UUID — never CORPORATION_ID — to cap-table.md queries.
>    SELECT DISTINCT CORPORATION_ID AS corporation_integer_id, CORPORATION_UUID, CORPORATION_NAME
>    FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2
>    WHERE LOWER(CORPORATION_NAME) LIKE '%<user-supplied name>%'
>       OR CORPORATION_UUID = '<user-supplied uuid>'
>       OR CORPORATION_ID = <user-supplied integer id>
>    LIMIT 10
>    ```
>    If multiple matches are found, use `AskUserQuestion` to confirm which one before continuing.

* IMPORTANT: if a specific semantic layer was not found, check for Saved Questions by running `call_tool({"name": "fa__list__saved_queries", "arguments": {}})` to get a list of existing questions and descriptions saved on the Data Warehouse. Use `call_tool({"name": "fa__get__saved_query", "arguments": {"name": "<query_name>"}})` to retrieve the SQL of a matching saved query, where `<query_name>` is the `name` field returned by `fa__list__saved_queries`.

## Step 4 — Execute the Query

> **MANDATORY pre-query checklist — run for every query, no exceptions:**
>
> 1. **Determine the schema** from the domain routing table in Step 2: if the table is listed with an explicit schema prefix (e.g. `LOAN_OPS.LOAN`), use that schema. Otherwise `FUND_ADMIN` is the default and most common schema.
> 2. **Verify the table exists**: `call_tool({"name": "dwh__list__tables", "arguments": {"schema": "<SCHEMA>"}})` — use the schema from step 2. If the target table does not appear in the result, it does not exist — check the wrong→right table name reference in `## SQL Compilation Safety Rules` before continuing. Do **not** query a table that is not listed.
> 3. **Verify column names**: `call_tool({"name": "dwh__get__table_schema", "arguments": {"table_name": "<TABLE>", "schema": "<SCHEMA>"}})` — use the schema from step 2. Confirm every column you plan to SELECT or filter on appears in the schema with its **exact** name. Check the wrong→right column name reference in `## SQL Compilation Safety Rules` if a column is missing.
>
> **Then resolve any remaining uncertainty:**
>
> 1. **Unclear intent — ask immediately.** If the user's request contains a term that doesn't map to any known domain, table, or Carta concept in the Step 2 table, immediately call `AskUserQuestion` with focused options. Do **not** respond in prose first — go straight to `AskUserQuestion`.
> 2. **Ask up to 2 clarifying questions.** If, after checking saved queries (Step 3) and schema inspection, you still cannot identify the right table or domain, use `AskUserQuestion` to ask the user **at most 2 focused questions** — e.g. fund-level vs company-level, metric type, entity name. After receiving answers, re-run Steps 2–3 before querying.
>
> **Never assume a table or column name.** Every wrong guess produces a Snowflake compilation error visible in production logs.

Use the MCP commands in sequence, substituting `<SCHEMA>` with the schema determined in the checklist above:

1. **Browse tables:** `call_tool({"name": "dwh__list__tables", "arguments": {"schema": "<SCHEMA>"}})`
2. **Inspect schema:** `call_tool({"name": "dwh__get__table_schema", "arguments": {"table_name": "<TABLE>", "schema": "<SCHEMA>"}})`
3. **Run the query:** `call_tool({"name": "dwh__execute__query", "arguments": {"sql": "..."}})`

**Output format:** Present results as a markdown table. Use fund or company names as row headers — never raw UUIDs. Currency values use `$X,XXX` format with commas; percentages use `X.XX%`. Bold totals and summary rows.

## General Query Rules

- **Always include LIMIT** — default `LIMIT 200`; use 50–500 for aggregations
- **Only SELECT** — no INSERT, UPDATE, DELETE, or DDL
- **Do not query `INFORMATION_SCHEMA`** — it is not supported in this data warehouse; use the semantic layer files and `call_tool({"name": "dwh__list__tables", ...})` / `call_tool({"name": "dwh__get__table_schema", ...})` instead
- **Date fields** — `effective_date` for `JOURNAL_ENTRIES`; `month_end_date` for `MONTHLY_NAV_CALCULATIONS`; `investment_date` for `AGGREGATE_INVESTMENTS`
- **Deduplication** — for `MONTHLY_NAV_CALCULATIONS` and `AGGREGATE_FUND_METRICS`, use `QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY last_refreshed_at DESC) = 1`
- **ALLOCATIONS has multiple rows per fund** — always `GROUP BY fund_uuid` with `MAX(fund_name)` when using it for fund metadata

## SQL Compilation Safety Rules

- **Always schema-qualify tables**: `FUND_ADMIN.TABLE_NAME` (or `LOAN_OPS.TABLE_NAME` for loans). A bare name defaults to `PUBLIC` where no customer tables exist.
- **Only query schemas visible in `dwh__list__tables`**: never query a schema that does not appear in that tool's output — unrecognized schemas are either internal-only or non-existent and will always fail.
- **Use `fund_uuid` (VARCHAR), not `fund_id`** — the integer `fund_id` is internal-only and not available in customer-facing views.
- **Snowflake syntax only**: `LIMIT N` not `FETCH FIRST N ROWS ONLY`; `LIKE`/`RLIKE` not `SIMILAR TO`; `ROW_NUMBER() OVER (...)` not bare `ROW()`; `DATE_TRUNC` not `ROUND` on dates; UUID values are strings (`fund_uuid = '<uuid>'`).
- **Wrong → right table names** — if the user or context uses any name on the left, use the right instead:

| ❌ Do NOT query | ✅ Use instead |
|---|---|
| `FUND_NAV` / `NAV_HISTORY` | `MONTHLY_NAV_CALCULATIONS` |
| `FUND_METRICS` / `FUND_PERFORMANCE_SUMMARY` / `FUND_PERFORMANCE_METRICS` / `FUND_PERFORMANCE` | `AGGREGATE_FUND_METRICS` |
| `CAPITAL_CALLS` / `FUND_CAPITAL_CALLS` | `CAPITAL_ACTIVITIES` |
| `INVESTMENTS` (bare) | `AGGREGATE_INVESTMENTS` |
| `PORTFOLIO_COMPANIES` | `call_tool({"name": "fa__list__portfolio_companies"})` — not a queryable table |
| `FINANCIAL_STATEMENTS` / `FINANCIALS` / `PROFIT_AND_LOSS` / `KPIS` / `PORTFOLIO_KPIS` | `COMPANY_FINANCIALS` (KPIs) or `JOURNAL_ENTRIES` (P&L) |
| `INVESTORS_PARTNER` | `PARTNER_DATA` |
| `FUNDADMIN_DATASHARE_*` (with full dbt prefix) | Use short name: e.g. `MONTHLY_NAV_CALCULATIONS` |

- **Wrong column names**: Domain-specific corrections are in each semantic layer file's `⚠️ Common Mistakes` section. Always run `dwh__get__table_schema` to verify column names before querying — the schema response flags common aliases in the column descriptions.

## General Presentation Rules

Each semantic file's `## Presentation` section is the source of truth for its domain. When a semantic file does not specify, fall back to these defaults:

- **Render results as a markdown table** with clear column headers
- **Use names, never raw UUIDs** as row identifiers — fund name, company name, LP name
- **Currency** — `$X,XXX` with commas; negatives/outflows in parentheses `($X,XXX)`; bold totals `**$X,XXX**`
- **Percentages** — `X.XX%`
- **Multiples** — `X.XXx` (e.g. MOIC, TVPI, DPI)
- **Missing values** — show `—` rather than `0` or `null` to avoid implying a real zero
- **Use Carta voice** — "your fund's NAV", "your portfolio", not "query results"

## Terms

| Acronym | Definition |
|---------|------------|
| NAV | Net Asset Value |
| TVPI | Total Value to Paid-In |
| DPI | Distributions to Paid-In |
| IRR | Internal Rate of Return |
| MOIC | Multiple on Invested Capital |
| FMV | Fair Market Value |
