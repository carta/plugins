---
name: carta-market-benchmarks
description: Analyze cap structure patterns across the portfolio as market benchmarks. Use when asked about market benchmarks, typical option pool sizes, average SAFE terms, what's normal for a Series A, cap structure patterns, or portfolio-wide statistics.
---

<!-- Part of the official Carta AI Agent Plugin -->

# Market Benchmarks

Compute portfolio-wide benchmarks from your own Carta data: option pool sizes, SAFE valuation caps, and round sizes. Useful for sanity-checking a new deal's terms against your existing portfolio.

> **Note:** This reflects your firm's portfolio, not Carta-wide market data. Present results as "portfolio benchmarks" not "market data."

## When to Use

- "What's the typical option pool size in our portfolio?"
- "What are average SAFE terms across our companies?"
- "What's normal for a Series A?"
- "Show me cap structure patterns across the portfolio"
- "How does Acme's option pool compare to the rest?"
- "Portfolio-wide statistics on round sizes"

## Prerequisites

No inputs required — this skill loops the full portfolio automatically.

## Data Retrieval

### Portfolio Enumeration

Call `list_accounts`. Filter to `corporation_pk:` accounts. Extract up to 20 numeric corporation IDs. If more than 20 companies exist, ask the user to narrow scope.

### Per-Company Commands

For each company, fetch in sequence:

- `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` — option pool data
- `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` — SAFE/note terms
- `fetch("cap_table:get:financing_history", {"corporation_id": corporation_id})` — round sizes

## Key Fields

From cap table (option pool):
- `option_plans[].authorized_shares`: shares authorized per plan
- `totals.total_fully_diluted`: total fully diluted share count

From convertible notes:
- `price_cap`: SAFE/note valuation cap
- `discount_percent`: discount rate (e.g. `"20.00"` = 20%)
- `interest_rate`: annual interest rate
- `is_debt`: false = SAFE, true = convertible note

From financing history:
- `round_name`: round name
- `cash_paid`: amount paid per security (sum by round_name for round total)
- `issue_date`: close date

## Workflow

### Step 1 — Get Portfolio

Call `list_accounts`. Filter to `corporation_pk:` accounts. Extract up to 20 numeric corporation IDs.

### Step 2 — Collect Data Per Company

**Cap table by share class** (for option pool %):
- `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})`
- From `option_plans[]`: sum `authorized_shares` across all plans
- From `totals.total_fully_diluted`: compute option pool % = option_pool_authorized / total_fully_diluted

**SAFE / convertible note terms:**
- `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})`
- Key fields per instrument: `price_cap`, `discount_percent`, `interest_rate`, `is_debt` (false=SAFE, true=note)
- Collect all valuation caps for SAFEs

**Financing history** (for round sizes):
- `fetch("cap_table:get:financing_history", {"corporation_id": corporation_id})`
- Key fields: `round_name`, `amount_raised`, `issue_date`
- Identify the most recent priced round and its size

### Step 3 — Compute Summary Statistics

For each metric, compute across companies that have data:
- **Median**, **min**, **max**
- Skip companies with no data for a given metric (don't count as zero)

Metrics:
- Option pool % (fully diluted)
- SAFE valuation cap
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
| Median | $8,000,000 |
| Range  | $3M – $25M |
| SAFEs analyzed | 28 |

**Last Priced Round Size**
| Metric | Value |
|--------|-------|
| Median | $5,000,000 |
| Range  | $500K – $30M |
| Companies with priced rounds | 10 |

## Caveats

- Portfolio data reflects point-in-time API calls, not a single atomic snapshot
- Companies with restricted permissions may have incomplete data
- Rate limit: maximum 20 companies per invocation
- This reflects your firm's portfolio, not Carta-wide market data — present results as "portfolio benchmarks" not "market data"
