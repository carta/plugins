---
name: carta-portfolio-alerts
description: Detect red flags and time-sensitive issues across portfolio companies. Use when asked to flag problems, find expiring items, or audit portfolio health.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Portfolio Alerts

Scan multiple companies for red flags and compute severity classifications (critical / warning / info). Builds on the `carta-portfolio-query` pattern.

## When to Use

- "Flag any red flags across my portfolio"
- "Which companies need attention?"
- "Are any 409As expiring soon?"
- "Which companies have low option pools?"
- "Any SAFEs or notes approaching maturity?"

## Prerequisites

No inputs required — this skill loops the full portfolio. Call `list_accounts` to get all `corporation_pk` accounts automatically.

## Data Retrieval

### Portfolio Enumeration

Call `list_accounts` to get all portfolio companies. Filter to accounts where `id` starts with `corporation_pk:`. Extract up to 20 numeric corporation IDs. If more than 20 companies exist, ask the user to narrow scope.

### Per-Company Commands

Depending on the check:
- `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` — 409A expiry check
- `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` — option pool check
- `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` — note maturity check
- `fetch("cap_table:list:safes", {"corporation_id": corporation_id})` — SAFE exposure check

## Key Fields

From 409A: `expiration_date`, `price`, `effective_date`
From cap table option plans: `available_ownership`, `name`
From convertible notes: `maturity_date`, `status_explanation`, `is_debt`, `dollar_amount`, `total_with_interest`

## Workflow

### Step 1 — Get Portfolio

Call `list_accounts` to get all `corporation_pk` accounts.

### Step 2 — Run Checks

For each company, run the relevant checks. Run whichever checks are relevant to the user's question. If they say "all red flags", run all of them.

#### 1. Expiring 409A Valuations

```
fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})
```
| Check | Critical | Warning | Info | Rationale |
|-------|----------|---------|------|-----------|
| 409A expiry | No 409A on file, or expiration_date in the past | expiration_date within 90 days | expiration_date within 180 days | 90 days = standard board reporting cycle; 180 days = early warning for planning |
| Option pool | available_ownership < 2% | available_ownership < 5% | available_ownership < 10% | 5% is industry floor for meaningful hiring capacity; <2% is effectively exhausted |
| Note maturity | maturity_date in the past | maturity_date within 90 days | maturity_date within 180 days | 90 days = typical negotiation window for extension or conversion |
| SAFE exposure | — | total outstanding SAFEs > 20% of last known valuation cap | — | 20% = significant dilution risk at conversion |

Companies with no 409A data should never be silently skipped — always include them in the output as a distinct category.

#### 2. Low Option Pool

```
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})
```
- **Critical**: option plan available_ownership < 2%
- **Warning**: option plan available_ownership < 5%
- **Info**: option plan available_ownership < 10%

#### 3. SAFEs/Notes Approaching Maturity

```
fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})
```
- Filter to `status_explanation: "Outstanding"` and `is_debt: true` (notes have maturity dates)
- **Critical**: maturity_date is in the past
- **Warning**: maturity_date is within 90 days
- **Info**: maturity_date is within 180 days

#### 4. Large Unconverted SAFE Exposure

```
fetch("cap_table:list:safes", {"corporation_id": corporation_id})
```
- Sum outstanding SAFE amounts
- **Warning**: total outstanding SAFEs > 20% of last known valuation cap
- Present total SAFE exposure per company

### Step 3 — Classify Severity

Compute severity classifications (critical / warning / info) for each finding.

### Step 4 — Present Results

Present a summary dashboard (see Presentation section).

## Gates

**Required inputs**: None — portfolio enumeration is automatic.

**AI computation**: Yes — severity classifications (critical, warning, info) for 409A expiry, option pool health, note maturity, and SAFE exposure are AI-derived.
Trigger the AI computation gate (see carta-interaction-reference §6.2) before outputting any severity classifications or health assessments.

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
- Rate limit: maximum 20 companies per invocation — if more than 20 companies, ask the user to narrow scope
- Some companies may error (permissions, incomplete setup) — skip gracefully and note which failed
- Always show the scan date and count: "Scanned 12 companies on Mar 18, 2025"
