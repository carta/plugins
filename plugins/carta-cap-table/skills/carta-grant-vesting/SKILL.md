---
name: carta-grant-vesting
description: Fetch vesting schedule for a specific grant — options (ISO/NSO), RSUs, SARs, or CBUs. Use when asked about vesting details, cliff dates, vesting progress, settlement, or unvested shares for any grant type.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Grant Vesting Data

Fetch the full vesting schedule for a grant — options, RSUs, SARs, or CBUs — and present it with useful context, not just the raw table.

## When to Use

- "What's the vesting schedule for this grant?"
- "When does the cliff hit?"
- "How many shares have vested so far?"
- "Show vesting progress for Jane's options"
- "Show the vesting schedule for Jane's RSU grant"
- "How many shares are eligible for settlement?"
- "How many unvested shares remain?"
- "When is this grant fully vested?"

## Prerequisites

You need:
1. `corporation_id` — get from `list_accounts` if you don't have it
2. `grant_id` — identify via the list command for the relevant grant type (see below)
3. **Grant type** — required to pick the right list and detail commands. If unstated, infer from the user's wording ("options", "ISO", "NSO" → options; "RSU"; "SAR"; "CBU"). If still unclear, ask via `AskUserQuestion` before searching.

## Data Retrieval

> The gateway defaults to `detail=summary` for list commands. This skill needs individual records, so `"detail": "full"` is passed explicitly.

Two endpoints exist for vesting detail and they are **not interchangeable**:

| Grant type | List command | Vesting detail command |
|------------|--------------|------------------------|
| Options (ISO/NSO) | `cap_table:list:grants` | `cap_table:get:grant_vesting` |
| RSUs | `cap_table:list:rsus` | `cap_table:get:rsu_vesting` |
| SARs | `cap_table:list:sars` | *(none — see Caveats)* |
| CBUs | `cap_table:list:cbus` | *(none — see Caveats)* |

**Important:** `cap_table:get:grant_vesting` is options-only and returns 500 for RSU/SAR/CBU ids. Use the table above; do not reuse a command across types.

```
fetch("<list command>", {"corporation_id": corporation_id, "search": "<holder name>", "detail": "full"})
```

Then, for options or RSUs:

```
fetch("<vesting detail command>", {"corporation_id": corporation_id, "grant_id": grant_id})
```

For SARs and CBUs, the list-record `vested_shares_quantity` is the only available signal — there is no per-event detail endpoint yet.

## Key Fields

The vesting detail commands return slightly different shapes:

**`cap_table:get:grant_vesting` (options):**
- `total_shares`, `vested_shares`, `unvested_shares`
- `grant_date`, `cliff_summary`
- `vesting_events[]` — each with `date`, `amount`, `cumulative`, `has_vested`

**`cap_table:get:rsu_vesting` (RSUs):**
- `awarded`, `vested_shares`, `unvested_shares`, `settled`, `eligible_for_settlement`
- `vesting_start_date`, `vesting_type`, `primary_vesting_title`/`description`
- `has_additional_condition`, `additional_vesting_title`/`description`
- `acceleration_terms`, `termination_date`
- `tranches[]` — each with `vest_date`, `awarded`, `eligible_for_settlement`, `settled`, `status`, `vesting_status`, `milestone_name`, `additional_condition_*`, `vesting_type`

## Workflow

### Step 1 — Identify the Grant

**If `grant_id` is already known** from prior conversation context (e.g. the user just viewed a grants list), skip directly to Step 2.

Otherwise, pick the list command based on grant type and search:

- **Type stated by the user** (e.g. "Jane's RSU", "the SAR"): use the matching list command from the table above.
- **Type unknown**: try `cap_table:list:grants` first (options are most common). If the holder is not found, try `list:rsus`, then `list:sars`, then `list:cbus`. Do not conclude vesting data is unavailable until all four have been checked.

```
fetch("<list command>", {"corporation_id": corporation_id, "search": "<holder name>", "detail": "full"})
```

If multiple grants are returned, ask the user which one, or pick the most relevant based on context.

### Step 2 — Fetch Vesting Data

Pick the detail command based on grant type:

- **Options (ISO/NSO)** → `fetch("cap_table:get:grant_vesting", {"corporation_id": ..., "grant_id": ...})`
- **RSUs** → `fetch("cap_table:get:rsu_vesting", {"corporation_id": ..., "grant_id": ...})`
- **SARs / CBUs** → no detail endpoint; use the list record's `vested_shares_quantity` and `quantity` fields and surface what's available.

### Step 3 — Present with Context

Lead with a one-sentence plain-English summary before showing the table (see Presentation section).

## Gates

**Required inputs**: `corporation_id`, `grant_id`, and grant type (options, RSU, SAR, or CBU).
If grant type is missing or ambiguous, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).
If `grant_id` is unknown, use Step 1 of the Workflow to search by holder name.

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Summary sentence + vesting events / tranches table

**BLUF lead**: Lead with a one-sentence plain-English summary of the vesting state before showing the table.

**Sort order**: By vesting date ascending (chronological).

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

Tailor the summary based on vesting state:
- **Pre-cliff**: how long until the cliff, how many shares vest at cliff
- **Partially vested**: what % has vested, what the ongoing cadence is (monthly/quarterly), when fully vested
- **Fully vested**: confirm and note if any shares remain unexercised (options/SARs) or unsettled (RSUs/CBUs)

Format as the **vesting events / tranches table** returned by the tool, sorted by vesting date ascending (chronological).

Flag anything time-sensitive:
- Cliff date within the next 90 days
- Grant expiring soon
- Large unvested block concentrated at a future date
- **Deep in-the-money grants** (options only — ISO/NSO): if the current 409A FMV is available and the spread between exercise price and FMV exceeds 10x, flag it. Note that holders face significant ordinary income (NSO) or AMT (ISO) exposure at exercise, and recommend the company consider a tender offer, early exercise program, or liquidity event planning. Skip this flag for RSUs, SARs, and CBUs.
- **RSU settlement window** (RSUs only): if `eligible_for_settlement` exceeds `settled`, note how many shares are awaiting settlement and flag if a `termination_date` is imminent — RSUs typically have a hard window to settle after termination.

Then show the formatted table from the tool.

## Caveats

- The `grant_id` is required and must be resolved first — if the user provides a name, search the appropriate list command (see Data Retrieval) to find the matching ID before fetching vesting data.
- `cap_table:list:grants` excludes RSUs, SARs, and CBUs. A "not found" result there does **not** mean the grant has no vesting data — check the other three list commands.
- `cap_table:get:grant_vesting` is **options-only** and returns 500 for RSU/SAR/CBU grant ids. Always route by grant type; do not pass an RSU id to it.
- The exercise-price / 409A FMV spread flag applies to options (ISO/NSO) only. RSUs, SARs, and CBUs do not have an exercise price in the same sense — skip that flag for non-option grants.
- SARs and CBUs do not have a per-event vesting endpoint exposed today. The list record's `vested_shares_quantity` and `quantity` are the only reliable signals — say so plainly rather than fabricating tranche detail.
- Vesting schedules reflect the original grant terms; any modifications (e.g., acceleration clauses, leaves of absence) may not be captured in the data.
- The 10x in-the-money flag requires a current 409A FMV — if no valuation data is available, skip the flag rather than guessing.
- Exercised/settled vs. outstanding status may not be reflected in the vesting schedule itself; check grant-level fields for exercise/settlement history.
