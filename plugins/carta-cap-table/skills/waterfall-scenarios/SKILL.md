---
name: waterfall-scenarios
description: Fetch saved waterfall / exit scenario models for a company. Use when asked about liquidation preferences, exit payouts, return multiples, or waterfall analysis.
---

# Waterfall Scenarios

Fetch saved exit scenario models and present them with meaningful context, not just the per-holder table.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Workflow

```
fetch("cap_table:get:waterfall_scenarios", {"corporation_id": corporation_id})
```

The command returns each completed (status == "DONE", non-draft) scenario with a per-holder breakdown of cost basis, payout value, share count, and return multiple.

## How to Present

Don't just show the table — frame each scenario:

- **Lead with the exit value and what it means**: who gets paid out, at what multiple, and whether any holders are underwater
- **Highlight the biggest winners and losers** by return multiple — a 1.0x return means a holder barely breaks even; anything below that means a loss
- **If there are multiple scenarios**, compare them: how do payouts shift as exit value changes? At what exit value does the common stack start to see meaningful returns?
- **Note liquidation preference effects**: if preferred holders take a large share at lower exit values, say so plainly

After the per-holder table, render an ASCII bar chart of payout by holder (sorted descending by payout).
Scale bars to max width 40 chars:

```
Payout Distribution — $50M Exit

Lead Investor      ████████████████████████████████████████ $18.2M  3.7x
Founder            ████████████████████                     $9.1M   1.8x
Common Holders     ██████████                               $4.5M   0.9x
```

Each bar width = (value_of_holdings / max_value) * 40. Show return multiple after the dollar amount.

Flag anything notable:
- Any holder with return multiple < 1.0x (loss scenario)
- Large gap between pref payout and common payout at a given exit value
- Scenarios that are very close in exit value but have very different common distributions

## Custom Exit Values

If the user asks to model a specific exit value not in the saved scenarios:

> "There's no saved model at that exit value. To model a custom exit, create a new scenario in Carta's scenario modeling tool, then come back and I'll pull it up."
