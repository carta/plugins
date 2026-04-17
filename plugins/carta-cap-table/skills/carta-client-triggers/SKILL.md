---
name: carta-client-triggers
description: Surface time-based BD triggers across the portfolio. Use when asked about client outreach, which clients closed a round recently, stale cap tables, pending grants, tombstones, weekly deals, or BD triggers.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Client Triggers

Scan the portfolio for actionable outreach triggers: recent round closes, expiring 409As, and companies with pending grants but no current valuation.

## When to Use

- "Which clients closed a round recently?"
- "Any stale cap tables or pending grants?"
- "Show me BD triggers across the portfolio"
- "Weekly deals update"
- "Which companies need outreach?"
- "Any tombstone opportunities this week?"

## Prerequisites

No inputs required — this skill loops the full portfolio automatically.

## Data Retrieval

### Portfolio Enumeration

Call `list_accounts`. Filter to accounts where `id` starts with `corporation_pk:`. Extract up to 20 numeric corporation IDs. If more than 20 companies exist, ask the user to narrow scope.

### Per-Company Commands

For each company, fetch in sequence:

- `fetch("cap_table:get:financing_history", {"corporation_id": corporation_id})` — financing history per company
- `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` — 409A status (optional, only if checking valuation triggers)

### Parameters

If the user specifies a time window (e.g., "last 60 days", "last 6 months"), use that instead of the default 90 days.

## Key Fields

From financing history:
- `issue_date`: date of issuance
- `round_name`: name of the round (e.g. "Series A")
- `is_grant`: true if this is a grant issuance (not a priced round)

From 409A FMVs:
- `expiration_date`: when the valuation expires
- `price`: FMV per share

## Workflow

### Step 1 — Get Portfolio

Call `list_accounts`. Filter to accounts where `id` starts with `corporation_pk:`. Extract the numeric corporation IDs (up to 20).

### Step 2 — Collect Data Per Company

**Financing history:**
- `fetch("cap_table:get:financing_history", {"corporation_id": corporation_id})`
- Key fields: `issue_date`, `round_name`, `is_grant`
- Group by `round_name`, find max `issue_date` per round -> "last round date"

**409A status** (optional, only if checking valuation triggers):
- `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})`
- Key fields: `expiration_date`, `price` (FMV per share)
- Find the most recent valuation (sort by `effective_date` desc)

### Step 3 — Compute Trigger Classifications

| Trigger | Condition | Default Window | Rationale |
|---------|-----------|----------------|-----------|
| Recent Closes | Last round closed within N days | 90 days | Typical post-close window for cap table review and congratulatory outreach |
| Stale 409A | 409A expired or expiring within N days | 60 days | Shorter than carta-portfolio-alerts (90d) because BD outreach needs to land before the renewal conversation starts |
| Pending Grants | Grants issued recently + no valid 409A | 90 days | Grants without current FMV create immediate 409A compliance exposure |

#### Recent Closes
Companies whose last round closed within N days (default 90, or user-specified):
- Trigger: `last_round_date >= today - N days`
- Action: Congratulations / cap table review outreach

#### Stale 409A
Companies with an expired or near-expiry 409A (within 60 days):
- Trigger: `expiration_date <= today + 60 days` or no 409A on file
- Action: Renewal reminder outreach

#### Pending Grants (no current 409A)
Companies that issued grants recently (within 90 days) but have no valid 409A:
- Trigger: recent `is_grant=true` entry + no active 409A
- Action: Urgency outreach — grants issued without a current FMV create 409A exposure

### Step 4 — Present Results

Group output by trigger type (see Presentation section).

## Gates

**Required inputs**: None — portfolio enumeration is automatic.

**AI computation**: Yes — trigger classifications (recent closes, stale 409As, pending grants) are AI-derived from Carta financing and valuation data.
Trigger the AI computation gate (see carta-interaction-reference §6.2) before outputting any trigger classifications or outreach recommendations.

**Subagent prohibition**: Not applicable.

## Presentation

**Format**: Tables grouped by trigger type

**BLUF lead**: Lead with the count of companies scanned and how many triggers were found across all categories.

**Sort order**: By recency within each trigger group (most recent first). Omit sections with no results.

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

**Recent Closes (last 90 days)**

| Company | Round | Close Date | Days Ago |
|---------|-------|------------|----------|
| Acme Inc | Series B | Jan 15, 2026 | 63 days |

**Stale or Expiring 409As**

| Company | Last 409A | Expiration | Status |
|---------|-----------|------------|--------|
| Beta Corp | $2.50 | Apr 1, 2026 | Expiring soon |
| Gamma LLC | — | — | No 409A on file |

**Grants Issued Without Current 409A**

| Company | Last Grant Date | 409A Status |
|---------|----------------|-------------|
| Delta Co | Feb 20, 2026 | Expired |

If no triggers found in a category, omit that section.

## Caveats

- Portfolio data reflects point-in-time API calls, not a single atomic snapshot
- Companies with restricted permissions may have incomplete data
- Rate limit: maximum 20 companies per invocation
