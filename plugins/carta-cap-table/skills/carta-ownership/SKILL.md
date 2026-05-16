---
name: carta-ownership
description: Voting, governance, and seniority analysis for a company — which corporate decisions require shareholder approval, which holders carry protective provisions or blocking rights, where preferred share classes sit in the liquidation stack, and who holds preferred stock (optionally as of a historical date).
when_to_use: >-
  Use when asked which corporate decisions or actions require shareholder
  consent or approval or a vote, which actions investors must sign off on,
  who has voting control, which holders carry protective provisions or
  blocking rights, how preferred series stack up in liquidation seniority,
  where preferred classes rank in the stack, who holds preferred stock as
  of a date or quarter, or how rights compare across share classes. For
  dollar-amount payouts at a specific exit valuation, prefer a payout or
  waterfall scenario skill. For a flat list of stakeholders or shareholders
  without a rights or governance angle, prefer a stakeholder list skill.
  For a visual cap-table summary, use the cap_table_chart tool.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__carta__cap_table_chart
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Ownership Structure

Surface which preferred stockholders hold voting power and would typically need to consent for major corporate actions (financing rounds, M&A, charter amendments).

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

> The gateway defaults to `detail=summary` for list commands. This skill needs individual records, so `"detail": "full"` is passed explicitly.

1. `fetch("cap_table:get:rights_and_preferences", { corporation_id })`
2. `fetch("cap_table:get:cap_table_by_stakeholder", { corporation_id, "detail": "full" })`

## Key Fields

From share classes:
- `name`: class name (e.g. "Series A Preferred")
- `stock_type`: "PREFERRED" or "COMMON"
- `votes_per_share`: voting weight — `null` on non-voting classes, a positive integer otherwise (guard for `None`, not zero)
- `seniority`: liquidation seniority rank — **lower = more senior**; rank 1 pays out first

From cap table by stakeholder:
- Per-stakeholder share counts and ownership % broken down by share class

## Workflow

### Step 1 — Fetch Share Classes

```
fetch("cap_table:get:rights_and_preferences", { corporation_id })
```

### Step 2 — Fetch Cap Table by Stakeholder

```
fetch("cap_table:get:cap_table_by_stakeholder", { corporation_id, "detail": "full" })
```

This returns per-stakeholder ownership broken down by share class.

If the user's question is anchored to a specific date (e.g. "who had voting control at Q1 close", "preferred holders on 3/31"), add `as_of_date` (ISO `YYYY-MM-DD` or `MM/DD/YYYY`):

```
fetch("cap_table:get:cap_table_by_stakeholder", { corporation_id, "detail": "full", "as_of_date": "2026-03-31" })
```

For ownership questions that only care about preferred holders, narrow server-side with `security_type` or `share_class_id` instead of fetching all holdings and filtering in memory:

```
fetch("cap_table:get:cap_table_by_stakeholder", { corporation_id, "detail": "full", "security_type": "CERTIFICATE", "share_class_id": <preferred_class_id> })
```

`share_class_id` comes from `cap_table:get:rights_and_preferences` (Step 1).

### Step 3 — Identify Preferred Holders

From the share class data, identify preferred classes (`stock_type == "PREFERRED"` or `votes_per_share` is a positive integer).

From the cap table, identify stakeholders holding preferred shares. Sort by:
1. `seniority` ascending (rank 1 = most senior, pays out first)
2. Fully diluted ownership % (descending)

### Step 4 — Present Results

Format as tables (see Presentation).

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Two tables (preferred holders, common holders)

**BLUF lead**: Lead with the total number of preferred holders and the most senior share class before showing the tables.

**Sort order**: By seniority (most senior first), then by fully diluted ownership % descending.

**Preferred Stockholders with Voting Rights**

| Holder | Share Class | Shares | FD % | Votes/Share | Seniority |
|--------|-------------|--------|------|-------------|-----------|
| ... | ... | ... | ... | ... | ... |

**Common Stockholders** (if relevant — founders, employees)

Sort by fully diluted ownership % descending.

| Holder | Shares | FD % |
|--------|--------|------|
| ... | ... | ... |

## Caveats

- Carta surfaces share ownership and voting structure, but does **not** expose actual consent thresholds or protective provision terms — those live in the Stockholders' Agreement and Certificate of Incorporation. This data identifies *who* holds voting preferred shares; an attorney must interpret *what* approvals are required and at what thresholds.
- If the user asks about specific thresholds (e.g., "do we need 60% of Series A to approve?"), acknowledge the limitation and recommend reviewing the governing documents.
