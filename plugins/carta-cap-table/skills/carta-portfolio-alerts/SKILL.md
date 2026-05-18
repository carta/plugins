---
name: carta-portfolio-alerts
description: "Scans portfolio companies for time-bounded and threshold-bounded risks — expiring 409A valuations, maturing convertible notes, low option pools, and large unconverted SAFE exposure. Classifies each finding as critical, warning, or info and presents a severity-sorted dashboard with days-remaining and threshold-gap metrics. Use when checking what's expiring across the portfolio, upcoming note maturities, low option pool alerts, SAFE exposure warnings, running a portfolio health audit, red-flag scan, or asking which companies have deadlines or renewals approaching. For raw multi-company data without a risk or threshold lens, prefer carta-portfolio-query. For statistical norms, prefer carta-market-benchmarks."
allowed-tools: "mcp__carta__fetch, mcp__carta__list_contexts, mcp__carta__set_context, mcp__carta__list_accounts, AskUserQuestion"
---

# Portfolio Alerts

Scan multiple companies for red flags and compute severity classifications (critical / warning / info).

## Workflow

### Step 1 — Get Portfolio

Call `list_accounts` to get all `corporation_pk` accounts. Filter to accounts where `id` starts with `corporation_pk:`. Extract up to 20 numeric corporation IDs. If more than 20 companies exist, ask the user to narrow scope.

### Step 2 — Fetch Data for All Companies

Issue ALL fetch calls for ALL companies **in a single response** — do NOT loop company-by-company. The `fetch` tool has `readOnlyHint=true`, so all calls execute concurrently.

Per-company commands (all use summary mode by default):

- `fetch("cap_table:get:409a_valuations", {"corporation_id": ID})` — 409A expiry (`expiration_date`, `price`, `effective_date`)
- `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": ID})` — option pool (`available_ownership`, `name`)
- `fetch("cap_table:get:convertible_notes", {"corporation_id": ID})` — note maturity (`maturity.nearest_date`, `maturity.total_outstanding_debt`)
- `fetch("cap_table:list:safes", {"corporation_id": ID})` — SAFE exposure

If the user asks about a specific check only (e.g. "any expiring 409As?"), issue only the relevant command per company — but still all companies in one response.

### Step 3 — Classify Findings

Apply severity thresholds to the results for each company:

| Check | Critical | Warning | Info |
|-------|----------|---------|------|
| 409A expiry | No 409A on file, or `expiration_date` in the past | `expiration_date` within 90 days | `expiration_date` within 180 days |
| Option pool | `available_ownership` < 2% | `available_ownership` < 5% | `available_ownership` < 10% |
| Note maturity | `maturity.nearest_date` in the past | `maturity.nearest_date` within 90 days | `maturity.nearest_date` within 180 days |
| SAFE exposure | — | total outstanding SAFEs > 20% of last known valuation cap | — |

Companies with no 409A data should never be silently skipped — always include them as a distinct category.

Use `maturity.nearest_date` and `maturity.total_outstanding_debt` from the convertible notes summary (pre-filtered to outstanding debt notes). Sum outstanding SAFE amounts per company for the exposure check.

### Step 4 — Present Results

Present a summary dashboard (see Presentation section).

## Gates

**Required inputs**: None — portfolio enumeration is automatic.

**AI computation**: Severity classifications are AI-derived. Trigger the AI computation gate (see carta-interaction-reference §6.2) before outputting any severity classifications or health assessments.

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
