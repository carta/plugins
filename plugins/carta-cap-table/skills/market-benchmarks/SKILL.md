---
name: market-benchmarks
description: Analyze cap structure patterns across the portfolio as market benchmarks. Use when asked about market benchmarks, typical option pool sizes, average SAFE terms, what's normal for a Series A, cap structure patterns, or portfolio-wide statistics.
---

# Market Benchmarks

Compute portfolio-wide benchmarks from your own Carta data: option pool sizes, SAFE valuation caps, and round sizes. Useful for sanity-checking a new deal's terms against your existing portfolio.

> **Note:** This reflects your firm's portfolio, not Carta-wide market data. Present results as "portfolio benchmarks" not "market data."

## Prerequisites

No inputs required — this skill loops the full portfolio automatically. Cap at 20 companies.

## Commands

- `list_accounts` — get all portfolio companies
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

## How to Present

See Step 4 below. Present as benchmark tables grouped by metric.

## Step 1 — Get Portfolio

Call `list_accounts`. Filter to `corporation_pk:` accounts. Extract up to 20 numeric corporation IDs.

## Step 2 — Collect Data Per Company

For each company, fetch in sequence:

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

## Step 3 — Compute Summary Statistics

For each metric, compute across companies that have data:
- **Median**, **min**, **max**
- Skip companies with no data for a given metric (don't count as zero)

Metrics:
- Option pool % (fully diluted)
- SAFE valuation cap
- Last priced round size

## Step 4 — Present Results

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

---

If the user asks about a specific company ("how does Acme's option pool compare?"), show that company's value alongside the portfolio median.

