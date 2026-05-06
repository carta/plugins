---
name: carta-waterfall-scenarios
description: Fetch saved waterfall / exit scenario models for a company. Use when asked about liquidation preferences, exit payouts, return multiples, or waterfall analysis. Do NOT use for liquidation seniority stack or preferred stockholder voting analysis — use carta-ownership instead.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Waterfall Scenarios

Fetch saved exit scenario models and present them with meaningful context, not just the per-holder table.

## When to Use

- "Show me the waterfall analysis"
- "What do exit payouts look like at $50M?"
- "Who gets paid first in a liquidation?"
- "Compare exit scenarios"
- "What return multiples do investors get?"
- "Is anyone underwater in this exit model?"

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

```
fetch("cap_table:get:waterfall_scenarios", {"corporation_id": corporation_id})
```

The command returns each completed (status == "DONE", non-draft) scenario with a per-holder breakdown of cost basis, payout value, share count, and return multiple.

## Key Fields

- `exit_value`: total exit/liquidation amount for the scenario
- `status`: scenario status ("DONE" for completed models)
- `cost_basis`: what the holder originally paid
- `payout_value` / `value_of_holdings`: what the holder receives at exit
- `share_count`: number of shares held
- `return_multiple`: payout / cost basis (< 1.0x = loss)

## Workflow

### Step 1 — Fetch Scenarios

Call the data retrieval endpoint with the corporation ID.

### Step 2 — Frame Each Scenario

Don't just show the table — frame each scenario:

- **Lead with the exit value and what it means**: who gets paid out, at what multiple, and whether any holders are underwater
- **Highlight the biggest winners and losers** by return multiple — a 1.0x return means a holder barely breaks even; anything below that means a loss
- **If there are multiple scenarios**, compare them: how do payouts shift as exit value changes? At what exit value does the common stack start to see meaningful returns?
- **Note liquidation preference effects**: if preferred holders take a large share at lower exit values, say so plainly

### Step 3 — Flag Notable Items

- Any holder with return multiple < 1.0x (loss scenario)
- Large gap between pref payout and common payout at a given exit value
- Scenarios that are very close in exit value but have very different common distributions

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly. Framing and comparison are presentational, not modeled.

## Presentation

**Format**: Per-holder table + ASCII bar chart

**BLUF lead**: Lead with the exit value and a one-sentence summary of who benefits most and whether any holders are underwater.

**Sort order**: By payout descending (largest payout first).

After the per-holder table, render an ASCII bar chart of payout by holder.
Scale bars to max width 40 chars:

```
Payout Distribution — $50M Exit

Lead Investor      ████████████████████████████████████████ $18.2M  3.7x
Founder            ████████████████████                     $9.1M   1.8x
Common Holders     ██████████                               $4.5M   0.9x
```

Each bar width = (value_of_holdings / max_value) * 40. Show return multiple after the dollar amount.

Per-holder table columns: Holder, Cost Basis, Payout, Return Multiple. Sort by payout descending.

## Custom Exit Values

If the user asks to model a specific exit value not in the saved scenarios:

> "There's no saved model at that exit value. To model a custom exit, create a new scenario in Carta's scenario modeling tool, then come back and I'll pull it up."

## Caveats

- Waterfall models are read-only snapshots saved in Carta; this skill cannot create or modify scenarios.
- Return multiples are based on the scenario's modeled exit value, not a live valuation.
- Liquidation preference mechanics (participating vs. non-participating, caps) are baked into Carta's model — this skill does not re-derive them.
- Custom exit values cannot be modeled on the fly; they must be created in Carta first.
