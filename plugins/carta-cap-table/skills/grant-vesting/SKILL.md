---
name: grant-vesting
description: Fetch vesting schedule for a specific option grant. Use when asked about vesting details, cliff dates, vesting progress, or unvested shares for a particular grant.
---

# Grant Vesting Data

Fetch the full vesting schedule for an option grant and present it with useful context, not just the raw table.

## Prerequisites

You need:
1. `corporation_id` — get from `list_accounts` if you don't have it
2. `grant_id` — identify via the grants list using the holder's name or grant number

## Workflow

1. **Identify the grant**: Call `fetch("cap_table:list:grants", {"corporation_id": corporation_id, "search": "<holder name>"})`. If multiple grants are returned, ask the user which one, or pick the most relevant based on context.
2. **Fetch vesting data**: Call `fetch("cap_table:get:grant_vesting", {"corporation_id": corporation_id, "grant_id": grant_id})`.
3. **Present with context** — see below.

## How to Present

The tool returns a formatted summary and vesting events table. Lead with a one-sentence plain-English summary before showing the table:

- **Pre-cliff**: how long until the cliff, how many shares vest at cliff
- **Partially vested**: what % has vested, what the ongoing cadence is (monthly/quarterly), when fully vested
- **Fully vested**: confirm and note if any shares remain unexercised

Flag anything time-sensitive:
- Cliff date within the next 90 days
- Grant expiring soon
- Large unvested block concentrated at a future date
- **Deep in-the-money grants**: if the current 409A FMV is available and the spread between exercise price and FMV exceeds 10×, flag it. Note that holders face significant ordinary income (NSO) or AMT (ISO) exposure at exercise, and recommend the company consider a tender offer, early exercise program, or liquidity event planning.

Then show the formatted table from the tool.
