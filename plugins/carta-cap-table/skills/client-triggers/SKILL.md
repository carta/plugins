---
name: client-triggers
description: Surface time-based BD triggers across the portfolio. Use when asked about client outreach, which clients closed a round recently, stale cap tables, pending grants, tombstones, weekly deals, or BD triggers.
---

# Client Triggers

Scan the portfolio for actionable outreach triggers: recent round closes, expiring 409As, and companies with pending grants but no current valuation.

## Prerequisites

No inputs required — this skill loops the full portfolio automatically. Cap at 20 companies.

## Commands

- `list_accounts` — get all portfolio companies
- `fetch("cap_table:get:financing_history", {"corporation_id": corporation_id})` — financing history per company
- `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` — 409A status (optional)

## Key Fields

From financing history:
- `issue_date`: date of issuance
- `round_name`: name of the round (e.g. "Series A")
- `is_grant`: true if this is a grant issuance (not a priced round)

From 409A FMVs:
- `expiration_date`: when the valuation expires
- `price`: FMV per share

## How to Present

See Step 4 below. Group by trigger type. Omit sections with no results.

## Step 1 — Get Portfolio

Call `list_accounts`. Filter to accounts where `id` starts with `corporation_pk:`. Extract the numeric corporation IDs (up to 20).

## Step 2 — Collect Data Per Company

For each company, fetch in sequence:

**Financing history:**
- `fetch("cap_table:get:financing_history", {"corporation_id": corporation_id})`
- Key fields: `issue_date`, `round_name`, `is_grant`
- Group by `round_name`, find max `issue_date` per round → "last round date"

**409A status** (optional, only if checking valuation triggers):
- `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})`
- Key fields: `expiration_date`, `price` (FMV per share)
- Find the most recent valuation (sort by `effective_date` desc)

## Step 3 — Classify Triggers

### Recent Closes
Companies whose last round closed within N days (default 90, or user-specified):
- Trigger: `last_round_date ≥ today - N days`
- Action: Congratulations / cap table review outreach

### Stale 409A
Companies with an expired or near-expiry 409A (within 60 days):
- Trigger: `expiration_date ≤ today + 60 days` or no 409A on file
- Action: Renewal reminder outreach

### Pending Grants (no current 409A)
Companies that issued grants recently (within 90 days) but have no valid 409A:
- Trigger: recent `is_grant=true` entry + no active 409A
- Action: Urgency outreach — grants issued without a current FMV create 409A exposure

## Step 4 — Present Results

Group output by trigger type. Example:

---

**Recent Closes (last 90 days)**

| Company | Round | Close Date | Days Ago |
|---------|-------|------------|----------|
| Acme Inc | Series B | 2026-01-15 | 63 days |

**Stale or Expiring 409As**

| Company | Last 409A | Expiration | Status |
|---------|-----------|------------|--------|
| Beta Corp | $2.50 | 2026-04-01 | Expiring soon |
| Gamma LLC | — | — | No 409A on file |

**Grants Issued Without Current 409A**

| Company | Last Grant Date | 409A Status |
|---------|----------------|-------------|
| Delta Co | 2026-02-20 | Expired |

---

If no triggers found in a category, omit that section.

## Parameters

If the user specifies a time window (e.g., "last 60 days", "last 6 months"), use that instead of the default 90 days.

## Best Effort

- **Computed:** trigger classification (recent close / stale 409A / pending grants) and time-window detection are heuristic
- **Authoritative:** round close dates, 409A expiration dates, and grant issuance dates come directly from Carta
