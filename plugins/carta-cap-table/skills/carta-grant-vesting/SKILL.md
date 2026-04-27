---
name: carta-grant-vesting
description: Fetch vesting schedule for a specific option grant. Use when asked about vesting details, cliff dates, vesting progress, or unvested shares for a particular grant.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Grant Vesting Data

Fetch the full vesting schedule for an option grant and present it with useful context, not just the raw table.

## When to Use

- "What's the vesting schedule for this grant?"
- "When does the cliff hit?"
- "How many shares have vested so far?"
- "Show vesting progress for Jane's options"
- "How many unvested shares remain?"
- "When is this grant fully vested?"

## Prerequisites

You need:
1. `corporation_id` — get from `list_accounts` if you don't have it
2. `grant_id` — identify via the grants list using the holder's name or grant number

## Data Retrieval

> The gateway defaults to `detail=summary` for list commands. This skill needs individual records, so `"detail": "full"` is passed explicitly.

```
fetch("cap_table:list:grants", {"corporation_id": corporation_id, "search": "<holder name>", "detail": "full"})
```

Then:

```
fetch("cap_table:get:grant_vesting", {"corporation_id": corporation_id, "grant_id": grant_id})
```

## Key Fields

Fields are returned in the formatted summary and vesting events table from the tool. Key context includes:
- Grant holder name and grant number
- Exercise price
- Total shares granted
- Vesting start date, cliff date, and end date
- Vested vs. unvested share counts
- Per-period vesting events with dates and quantities

## Workflow

### Step 1 — Identify the Grant

**If `grant_id` is already known** from prior conversation context (e.g. the user just viewed a grants list), skip directly to Step 2.

Otherwise, search for it:

```
fetch("cap_table:list:grants", {"corporation_id": corporation_id, "search": "<holder name>", "detail": "full"})
```

If multiple grants are returned, ask the user which one, or pick the most relevant based on context.

### Step 2 — Fetch Vesting Data

Call `fetch("cap_table:get:grant_vesting", {"corporation_id": corporation_id, "grant_id": grant_id})`.

### Step 3 — Present with Context

Lead with a one-sentence plain-English summary before showing the table (see Presentation section).

## Gates

**Required inputs**: `corporation_id`, `grant_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).
If `grant_id` is unknown, use Step 1 of the Workflow to search by holder name.

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Summary sentence + vesting events table

**BLUF lead**: Lead with a one-sentence plain-English summary of the vesting state before showing the table.

**Sort order**: By vesting date ascending (chronological).

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

Tailor the summary based on vesting state:
- **Pre-cliff**: how long until the cliff, how many shares vest at cliff
- **Partially vested**: what % has vested, what the ongoing cadence is (monthly/quarterly), when fully vested
- **Fully vested**: confirm and note if any shares remain unexercised

Format as the **vesting events table** returned by the tool, sorted by vesting date ascending (chronological).

Flag anything time-sensitive:
- Cliff date within the next 90 days
- Grant expiring soon
- Large unvested block concentrated at a future date
- **Deep in-the-money grants**: if the current 409A FMV is available and the spread between exercise price and FMV exceeds 10x, flag it. Note that holders face significant ordinary income (NSO) or AMT (ISO) exposure at exercise, and recommend the company consider a tender offer, early exercise program, or liquidity event planning.

Then show the formatted table from the tool.

## Caveats

- The `grant_id` is required and must be resolved first — if the user provides a name, search grants to find the matching ID before fetching vesting data.
- Vesting schedules reflect the original grant terms; any modifications (e.g., acceleration clauses, leaves of absence) may not be captured in the data.
- The 10x in-the-money flag requires a current 409A FMV — if no valuation data is available, skip the flag rather than guessing.
- Exercised vs. unexercised status may not be reflected in the vesting schedule itself; check grant-level fields for exercise history.
