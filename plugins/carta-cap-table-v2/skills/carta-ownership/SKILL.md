---
name: carta-ownership
description: Voting rights, liquidation seniority, and preferred vs common holder analysis. Use when asked about voting power, protective provisions, consent requirements, preferred stockholders, or seniority. For general visual ownership summaries or cap table overviews, use the cap_table_chart tool instead.
---

<!-- Part of the official Carta AI Agent Plugin -->

# Ownership Structure

Surface which preferred stockholders hold voting power and would typically need to consent for major corporate actions (financing rounds, M&A, charter amendments).

> **Routing note:** If the user asks for a general "ownership breakdown" or "cap table summary" without mentioning voting rights, seniority, or protective provisions, use the `cap_table_chart` MCP tool instead — it renders an interactive visual summary. This skill is for detailed voting/governance analysis.

## When to Use

- "Who are the preferred stockholders?"
- "Show me the ownership breakdown by share class"
- "Who has voting power?"
- "What does the cap table look like by holder?"
- "Which investors hold the most shares?"
- "What's the seniority stack?"

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

1. `fetch("cap_table:get:rights_and_preferences", { corporation_id })`
2. `fetch("cap_table:get:cap_table_by_stakeholder", { corporation_id })`

## Key Fields

From share classes:
- `name`: class name (e.g. "Series A Preferred")
- `stock_type`: "PREFERRED" or "COMMON"
- `votes_per_share`: voting weight (0 = non-voting)
- `seniority`: liquidation seniority rank (higher = senior)

From cap table by stakeholder:
- Per-stakeholder share counts and ownership % broken down by share class

## Workflow

### Step 1 — Fetch Share Classes

```
fetch("cap_table:get:rights_and_preferences", { corporation_id })
```

### Step 2 — Fetch Cap Table by Stakeholder

```
fetch("cap_table:get:cap_table_by_stakeholder", { corporation_id })
```

This returns per-stakeholder ownership broken down by share class.

### Step 3 — Identify Preferred Holders

From the share class data, identify preferred classes (stock_type = "PREFERRED" or votes_per_share > 0).

From the cap table, identify stakeholders holding preferred shares. Sort by:
1. Seniority (most senior first)
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
