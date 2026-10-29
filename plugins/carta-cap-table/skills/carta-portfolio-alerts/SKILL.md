---
name: carta-portfolio-alerts
description: >-
  Time-bounded and threshold-bounded risk detection across portfolio companies — finds items that are expiring soon, maturing soon, running low, or otherwise at risk. Surfaces what needs attention now, not what the data looks like in general.
when_to_use: >-
  Use when asked which companies have an expiring item (409As, agreements,
  exercise windows), what is maturing in the next N months across the
  portfolio (convertible notes, debt instruments), which companies are
  running low on something (option pool below a threshold, runway), which
  SAFEs are approaching their valuation-cap trigger or expiring before
  conversion across the portfolio, which 83(b) elections are not filed or
  have a filing deadline coming up, how much Rule 701 room a company has
  left, or to run a portfolio health audit or
  red-flag scan. For raw multi-company data without a risk or
  time or threshold lens, prefer a portfolio data-query skill. For
  statistical norms across the portfolio, prefer a portfolio-benchmarks
  skill.
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.109.1</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Portfolio Alerts

Scan multiple companies for red flags and compute severity classifications (critical / warning / info).

## Prerequisites

No inputs required — this skill loops the full portfolio. Call `list_accounts` to get all `corporation_pk` accounts automatically.

## Data Retrieval

### Portfolio Enumeration

Call `list_accounts` to get all portfolio companies. Filter to accounts where `id` starts with `corporation_pk:`. Extract up to 20 numeric corporation IDs. If more than 20 companies exist, ask the user to narrow scope.

### Per-Company Commands

For each company, these are the relevant checks:

- `read_tool({"name": "cap_table__get__409a_valuations", "arguments": {"corporation_id": corporation_id}})` -- 409A expiry check
- `read_tool({"name": "cap_table__get__cap_table_by_share_class", "arguments": {"corporation_id": corporation_id}})` -- option pool check
- `read_tool({"name": "cap_table__get__convertible_notes", "arguments": {"corporation_id": corporation_id}})` -- note maturity check (summary includes `maturity.nearest_date`)
- `read_tool({"name": "cap_table__list__safes", "arguments": {"corporation_id": corporation_id}})` -- SAFE exposure check
- `read_tool({"name": "cap_table__list__83b_elections", "arguments": {"company": corporation_id, "status": "not_filed"}})` -- 83(b) deadline check
- `read_tool({"name": "cap_table__get__rule_701", "arguments": {"company": corporation_id}})` -- Rule 701 limit check (last 12 months)

The server defaults to `detail=summary` for list commands. The first four commands use summary mode — the convertible notes summary includes a `maturity` block with `nearest_date` and `total_outstanding_debt` for outstanding debt notes. The 83(b) list always returns its `summary` with the rows: `not_filed_open` and `next_deadline` count only deadlines today or later.

If the user asks about a specific check only (e.g. "any expiring 409As?"), read only the relevant command per company.

> **Parallel execution**: The `read_tool` tool has `readOnlyHint=true`, so Claude Code executes parallel `read_tool` calls concurrently. Issue ALL `read_tool` calls for ALL companies in a single response — do NOT loop company-by-company. See Workflow Step 2.

## Key Fields

From 409A: `expiration_date`, `price`, `effective_date`
From cap table option plans: `available_ownership`, `name`
From convertible notes (summary): `maturity.nearest_date`, `maturity.total_outstanding_debt`, `by_status`, `by_type`
From 83(b) elections: `summary.not_filed_open`, `summary.next_deadline`; each row's `holder_name`, `label`, `type`, `deadline`
From Rule 701: `within_limit`, `from_date`, `to_date`; each test's `type`, `result`, `limit`, `used`, `remaining`

## Workflow

### Step 1 — Get Portfolio

Call `list_accounts` to get all `corporation_pk` accounts. Extract up to 20 numeric corporation IDs.

### Step 2 — Fetch Data for All Companies (parallel)

Issue ALL `read_tool` calls for ALL companies **in a single response** — do NOT loop company-by-company. Each `read_tool` call is independent and will execute concurrently.

For example, with 5 companies and all 6 checks, issue all 30 `read_tool` calls at once:

```
read_tool({"name": "cap_table__get__409a_valuations", "arguments": {"corporation_id": 1}})
read_tool({"name": "cap_table__get__cap_table_by_share_class", "arguments": {"corporation_id": 1}})
read_tool({"name": "cap_table__get__convertible_notes", "arguments": {"corporation_id": 1}})
read_tool({"name": "cap_table__list__safes", "arguments": {"corporation_id": 1}})
read_tool({"name": "cap_table__list__83b_elections", "arguments": {"company": 1, "status": "not_filed"}})
read_tool({"name": "cap_table__get__rule_701", "arguments": {"company": 1}})
read_tool({"name": "cap_table__get__409a_valuations", "arguments": {"corporation_id": 2}})
read_tool({"name": "cap_table__get__cap_table_by_share_class", "arguments": {"corporation_id": 2}})
... (all companies)
```

If the user asks about a specific check only (e.g. "any expiring 409As?"), issue only the relevant command per company — but still all companies in one response.

### Step 3 — Classify Findings

Apply severity thresholds to the results for each company:

#### 1. Expiring 409A Valuations

| Check | Critical | Warning | Info | Rationale |
|-------|----------|---------|------|-----------|
| 409A expiry | No 409A on file, or expiration_date in the past | expiration_date within 90 days | expiration_date within 180 days | 90 days = standard board reporting cycle; 180 days = early warning for planning |

Companies with no 409A data should never be silently skipped — always include them in the output as a distinct category.

#### 2. Low Option Pool

| Check | Critical | Warning | Info | Rationale |
|-------|----------|---------|------|-----------|
| Option pool | available_ownership < 2% | available_ownership < 5% | available_ownership < 10% | 5% is industry floor for meaningful hiring capacity; <2% is effectively exhausted |

#### 3. SAFEs/Notes Approaching Maturity

| Check | Critical | Warning | Info | Rationale |
|-------|----------|---------|------|-----------|
| Note maturity | `maturity.nearest_date` in the past | `maturity.nearest_date` within 90 days | `maturity.nearest_date` within 180 days | 90 days = typical negotiation window for extension or conversion |

Use `maturity.nearest_date` and `maturity.total_outstanding_debt` from the convertible notes summary. These fields are pre-filtered to outstanding debt notes by the backend.

#### 4. Large Unconverted SAFE Exposure

| Check | Critical | Warning | Info | Rationale |
|-------|----------|---------|------|-----------|
| SAFE exposure | — | total outstanding SAFEs > 20% of last known valuation cap | — | 20% = significant dilution risk at conversion |

Sum outstanding SAFE amounts per company.

#### 5. 83(b) Elections Not Filed

| Check | Critical | Warning | Info | Rationale |
|-------|----------|---------|------|-----------|
| 83(b) deadline | A `not_filed` row with `deadline` within 7 days | A `not_filed` row with `deadline` later than 7 days | A `not_filed` row with `deadline` in the past | The IRS 30-day window cannot be extended; a past deadline is a record to confirm with the holder, not an action |

The list can include holders outside the US, who do not file an 83(b). Name the holder and the security label for each finding.

#### 6. Rule 701 Limit

| Check | Critical | Warning | Info | Rationale |
|-------|----------|---------|------|-----------|
| Rule 701 | `within_limit` is false | The `disclosure` test fails, or `within_limit` is null | — | Rule 701 allows the greatest of the `amount`, `outstanding_shares` and `total_assets` limits; above $10M in 12 months the holders must get the extra disclosure before they buy |

For room left, give the `remaining` of each limit test that ran: shares for `outstanding_shares`, the company currency for `amount` and `total_assets`. The company may use the test with the most room. `within_limit` null means the `total_assets` test did not run: ask the user for the total assets at the most recent balance sheet date, then call again with `total_assets`.

### Step 4 — Present Results

Present a summary dashboard (see Presentation section).

## Gates

**Required inputs**: None — portfolio enumeration is automatic.

**AI computation**: Yes — severity classifications (critical, warning, info) for 409A expiry, option pool health, note maturity, SAFE exposure, 83(b) deadlines and Rule 701 limits are AI-derived.
Before you fetch data or compute, call `AskUserQuestion` (never plain text) with: "No saved Carta model matches these terms. I can compute severity classifications using AI — this would be Claude's analysis, not Carta data. Would you like me to proceed?" If the user says no, stop: no output, no fallback. If the user says yes, start the computed output with:

> ⚠️ **Claude's analysis** — computed from cap table data, not from a saved Carta model. Verify with counsel before relying on these numbers.

**Subagent prohibition**: Not applicable.

## Presentation

**Format**: Summary dashboard + detail table

**BLUF lead**: Lead with the count of companies scanned and the critical/warning/healthy breakdown.

**Sort order**: Severity (critical first), then urgency (nearest deadline first).

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

### Summary Dashboard

```
Portfolio Health Check — 12 companies scanned

Critical (2):
  - Beta Inc: 409A EXPIRED (expired Jan 14, 2025, 63 days ago)
  - Gamma Corp: Option pool at 1.2% available

Warning (3):
  - Acme Corp: 409A expires in 37 days (Apr 24, 2025)
  - Delta LLC: Convertible note matures in 45 days
  - Epsilon Inc: Option pool at 4.1% available

Healthy (7): Alpha, Zeta, Eta, Theta, Iota, Kappa, Lambda
```

### Detail Table (for specific checks)

| Company | Issue | Severity | Details | Action Needed |
|---------|-------|----------|---------|---------------|
| Beta Inc | 409A Expired | Critical | Expired Jan 14, 2025 | Order new 409A |
| Acme Corp | 409A Expiring | Warning | Expires Apr 24, 2025 (37 days) | Schedule valuation |

## Caveats

- Portfolio data reflects point-in-time API calls, not a single atomic snapshot
- Companies with restricted permissions may have incomplete data
- Rate limit: maximum 20 companies per invocation — ask the user to narrow scope if more than 20
- Some companies may error (permissions, incomplete setup) — skip gracefully and note which failed
- Always show the scan date and count: "Scanned 12 companies on Mar 18, 2025"
