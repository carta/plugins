---
name: portfolio-alerts
description: Detect red flags and time-sensitive issues across portfolio companies. Use when asked to flag problems, find expiring items, or audit portfolio health.
---

# Portfolio Alerts

Scan multiple companies for red flags and compute severity classifications (critical / warning / info). Builds on the `portfolio-query` pattern.

## When to Use

- "Flag any red flags across my portfolio"
- "Which companies need attention?"
- "Are any 409As expiring soon?"
- "Which companies have low option pools?"
- "Any SAFEs or notes approaching maturity?"

## Prerequisites

No inputs required — this skill loops the full portfolio. Call `list_accounts` to get all `corporation_pk` accounts automatically.

## Commands

Depending on the check:
- `list_accounts` — get all portfolio companies
- `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` — 409A expiry check
- `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` — option pool check
- `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` — note maturity check
- `fetch("cap_table:list:safes", {"corporation_id": corporation_id})` — SAFE exposure check

## Key Fields

From 409A: `expiration_date`, `price`, `effective_date`
From cap table option plans: `available_ownership`, `name`
From convertible notes: `maturity_date`, `status_explanation`, `is_debt`, `dollar_amount`, `total_with_interest`

## How It Works

1. Call `list_accounts` to get all `corporation_pk` accounts
2. For each company, run the relevant checks
3. Compute severity classifications (critical / warning / info) for each finding
4. Present a summary dashboard

## Alert Checks

Run whichever checks are relevant to the user's question. If they say "all red flags", run all of them.

### 1. Expiring 409A Valuations

```
fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})
```
- **Critical**: no 409A on file at all — treat as missing/unknown FMV; flag for immediate follow-up if the company issues options
- **Critical**: expiration_date is in the past
- **Warning**: expiration_date is within 90 days of today
- **Info**: expiration_date is within 180 days

Companies with no 409A data should never be silently skipped — always include them in the output as a distinct category.

### 2. Low Option Pool

```
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})
```
- **Critical**: option plan available_ownership < 2%
- **Warning**: option plan available_ownership < 5%
- **Info**: option plan available_ownership < 10%

### 3. SAFEs/Notes Approaching Maturity

```
fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})
```
- Filter to `status_explanation: "Outstanding"` and `is_debt: true` (notes have maturity dates)
- **Critical**: maturity_date is in the past
- **Warning**: maturity_date is within 90 days
- **Info**: maturity_date is within 180 days

### 4. Large Unconverted SAFE Exposure

```
fetch("cap_table:list:safes", {"corporation_id": corporation_id})
```
- Sum outstanding SAFE amounts
- **Warning**: total outstanding SAFEs > 20% of last known valuation cap
- Present total SAFE exposure per company

## Presentation

### Summary Dashboard

```
Portfolio Health Check — 12 companies scanned

Critical (2):
  - Beta Inc: 409A EXPIRED (expired 2025-01-14, 63 days ago)
  - Gamma Corp: Option pool at 1.2% available

Warning (3):
  - Acme Corp: 409A expires in 37 days (04/24/2025)
  - Delta LLC: Convertible note matures in 45 days
  - Epsilon Inc: Option pool at 4.1% available

Healthy (7): Alpha, Zeta, Eta, Theta, Iota, Kappa, Lambda
```

### Detail Table (for specific checks)

| Company | Issue | Severity | Details | Action Needed |
|---------|-------|----------|---------|---------------|
| Beta Inc | 409A Expired | Critical | Expired 01/14/2025 | Order new 409A |
| Acme Corp | 409A Expiring | Warning | Expires 04/24/2025 (37 days) | Schedule valuation |

## Important Notes

- Be mindful of rate limits — if > 20 companies, ask the user to narrow scope
- Some companies may error (permissions, incomplete setup) — skip gracefully and note which failed
- Always show the scan date and count: "Scanned 12 companies on 2025-03-18"
- Sort by severity (critical first), then by urgency (nearest deadline first)

