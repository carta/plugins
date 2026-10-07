---
name: carta-market-benchmarks
description: >-
  Computed statistics across portfolio companies — median, average, typical, range — used as market benchmarks. Returns aggregate numbers and percentiles, not raw per-company listings.
when_to_use: >-
  Use when asked what's typical for a metric, what's normal at a given
  stage, what the median value is, what the average comes out to, how
  something compares to the market, what range a metric falls in across
  the portfolio, or how a specific deal's terms stack up against portfolio
  norms. Covers option pool sizing, SAFE valuation caps, SAFE discount
  rates, round sizes by stage, and similar structural metrics. For raw
  cross-company data tables without computed statistics, prefer a
  multi-company raw-data skill. For time-based risk detection across
  companies, prefer a portfolio-alerts skill.
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.94.0</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Market Benchmarks

Compute portfolio-wide benchmarks from your own Carta data: option pool sizes, SAFE valuation caps, and round sizes. Useful for sanity-checking a new deal's terms against your existing portfolio.

> **Note:** This reflects your firm's portfolio, not Carta-wide market data. Present results as "portfolio benchmarks" not "market data."

## Prerequisites

No inputs required — this skill loops the full portfolio automatically.

## Data Retrieval

### Portfolio Enumeration

Call `list_accounts`. Filter to `corporation_pk:` accounts. Extract up to 20 numeric corporation IDs. If more than 20 companies exist, ask the user to narrow scope.

### Per-Company Commands

For each company, the relevant commands are:

- `call_tool({"name": "cap_table__get__cap_table_by_share_class", "arguments": {"corporation_id": corporation_id}})` -- option pool data
- `call_tool({"name": "cap_table__get__convertible_notes", "arguments": {"corporation_id": corporation_id}})` -- SAFE/note terms (summary includes min/max/average price_cap, avg_discount, by_type)
- `call_tool({"name": "cap_table__list__financing_history", "arguments": {"corporation_id": corporation_id}})` -- round sizes (one row per share class with closing_date and cash_raised_by_currency)

> **Use `cap_table__list__financing_history` — never `cap_table__get__financing_history`.** The `get` tool is deprecated: the gateway rejects every call to it with *"This command is deprecated"* before reaching Carta, so calling it fails once per company.

The convertible-notes call defaults to `detail=summary`, and the other two return aggregates — no individual records are needed.

> **Parallel execution**: `call_tool` reads are read-only, so Claude Code runs parallel calls concurrently. Issue ALL calls for ALL companies in a single response — do NOT loop company-by-company. See Workflow Step 2.

## Key Fields

From cap table (option pool):
- `option_plans[].authorized_shares`: shares authorized per plan
- `totals.total_fully_diluted`: total fully diluted share count

From convertible notes (summary):
- `min_price_cap`, `max_price_cap`: lowest and highest valuation cap
- `median_price_cap`: **despite its name, this is the average (mean) cap**, not the median. It averages every instrument the company holds, whatever its status. Call it the company's average cap.
- `avg_discount`: average discount rate
- `by_type`: instrument counts keyed by type (`SAFE`, `Convertible Note`, `Convertible Equity`, `ASA`)
- `total_dollar_amount`: total invested across all instruments

From financing history (`share_class_financings[]`, one row per share class):
- `name`: share class (the round)
- `closing_date`: when the round closed
- `cash_raised_by_currency`: `{currency: amount}` — `{}` for classes that raised no cash (e.g. common stock)

## Workflow

### Step 1 — Get Portfolio

Call `list_accounts`. Filter to `corporation_pk:` accounts. Extract up to 20 numeric corporation IDs.

### Step 2 — Collect Data for All Companies (parallel)

Issue ALL calls for ALL companies **in a single response** — do NOT loop company-by-company. Each call is independent and will execute concurrently.

For example, with 5 companies and all 3 data types, issue all 15 calls at once:

```
call_tool({"name": "cap_table__get__cap_table_by_share_class", "arguments": {"corporation_id": 1}})
call_tool({"name": "cap_table__get__convertible_notes", "arguments": {"corporation_id": 1}})
call_tool({"name": "cap_table__list__financing_history", "arguments": {"corporation_id": 1}})
call_tool({"name": "cap_table__get__cap_table_by_share_class", "arguments": {"corporation_id": 2}})
call_tool({"name": "cap_table__get__convertible_notes", "arguments": {"corporation_id": 2}})
call_tool({"name": "cap_table__list__financing_history", "arguments": {"corporation_id": 2}})
... (all companies)
```

Then from the results:

**Cap table by share class** (for option pool %):
- From `option_plans[]`: sum `authorized_shares` across all plans
- From `totals.total_fully_diluted`: compute option pool % = option_pool_authorized / total_fully_diluted

**SAFE / convertible note terms** (summary):
- Use each company's `median_price_cap` as its **average** cap, and `min_price_cap` / `max_price_cap` for the range
- Use `avg_discount` for discount benchmarks
- Use `by_type` to count instruments by type per company

**Financing history**:
- Last priced round = the row with the latest `closing_date` whose `cash_raised_by_currency` is not empty
- Its size = that row's `cash_raised_by_currency` amount. Benchmark round sizes within one currency only (the most common one across the portfolio), and name the companies left out because they raised in another currency — never add or compare amounts across currencies

**If a call fails for one company** (403, access denied, or any other error): count that company as "no data" for that metric and carry on with the rest. Do not retry it, and do not look for another tool to fill the gap. List the skipped companies in the caveats.

### Step 3 — Compute Summary Statistics

For each metric, compute across companies that have data:
- **Median**, **min**, **max**
- Skip companies with no data for a given metric (don't count as zero)

Metrics:
- Option pool % (fully diluted)
- SAFE valuation cap — the portfolio median of each company's average cap
- Last priced round size

### Step 4 — Present Results

See Presentation section.

If the user asks about a specific company ("how does Acme's option pool compare?"), show that company's value alongside the portfolio median.

## Gates

**Required inputs**: None — portfolio enumeration is automatic.

**AI computation**: Yes — portfolio benchmark statistics (median, min, max for option pool sizes, SAFE caps, round sizes) are AI-derived from aggregated cap table data.
Trigger the AI computation gate (see carta-interaction-reference §6.2) before outputting any benchmark statistics or portfolio comparisons.

**Subagent prohibition**: Not applicable.

## Presentation

**Format**: Benchmark tables grouped by metric

**BLUF lead**: Lead with the number of companies analyzed and the most notable finding (e.g., "median option pool is 12.5% across 14 companies").

**Sort order**: By metric name (Option Pool, SAFE Caps, Round Sizes).

**Portfolio Benchmarks (N companies)**

**Option Pool Size (% Fully Diluted)**
| Metric | Value |
|--------|-------|
| Median | 12.5% |
| Range  | 8% – 20% |
| Companies with data | 14 |

**SAFE Valuation Caps**
| Metric | Value |
|--------|-------|
| Median of company average caps | $8,000,000 |
| Range  | $3M – $25M |
| Companies with SAFEs or notes | 9 |

**Last Priced Round Size**
| Metric | Value |
|--------|-------|
| Median | $5,000,000 |
| Range  | $500K – $30M |
| Companies with priced rounds | 10 |

## Caveats

- Portfolio data reflects point-in-time API calls, not a single atomic snapshot
- Companies with restricted permissions may have incomplete data — name the companies skipped for a failed call
- SAFE caps are per-company averages across every convertible instrument, not per-SAFE medians
- Rate limit: maximum 20 companies per invocation
- This reflects your firm's portfolio, not Carta-wide market data — present results as "portfolio benchmarks" not "market data"
