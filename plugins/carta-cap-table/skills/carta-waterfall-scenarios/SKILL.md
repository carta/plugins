---
name: carta-waterfall-scenarios
description: >-
  Exit, sale, acquisition, and liquidation payouts for a company — answers how much money each holder walks away with at a given sale price, return multiples on holdings, and how proceeds distribute across share classes. Computes dollar amounts at modeled valuations, not abstract rights.
when_to_use: >-
  Use when asked how much a holder takes home, what each investor walks
  away with, what the MOIC or return multiple is at a sale price, at what
  sale price common starts seeing money, how distributions or payouts
  change across exit scenarios, how proceeds split between share classes
  at a valuation, who is underwater or gets zero in a low exit, or how
  acquisition payouts break down. For voting power, protective provisions,
  consent rights, or seniority rank in the abstract without computing
  dollar payouts, prefer a rights/seniority skill.
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.93.3</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Waterfall Scenarios

Fetch saved exit scenario models and present them with meaningful context, not just the per-holder table.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

```
call_tool({"name": "cap_table__get__waterfall_scenarios", "arguments": {"corporation_id": corporation_id}})
```

One call returns every saved (non-draft) scenario. This is the only waterfall tool this skill uses — do not call `fetch`, `waterfall_modeling__*`, or any other tool to fill in what this one leaves out. Those serve investor-firm valuations, not a company's saved scenarios.

## Response Shape

```json
{
  "scenarios": [
    {
      "id": 12,
      "name": "Acquisition at $50M",
      "exit_value": "50000000.00",
      "exit_date": "2026-12-31",
      "status": "DONE",
      "holders": [
        {
          "organization_name": "Lead Investor",
          "cost_of_holdings": "5000000.00",
          "value_of_holdings": "18200000.00",
          "outstanding_shares": "3000000",
          "return_multiple": "3.64",
          "irr": "0.41"
        }
      ]
    }
  ],
  "holders_unavailable": "Per-holder payout breakdown is not available from this command for a company-owned scenario…"
}
```

Scenario fields: `id`, `name`, `exit_value`, `exit_date`, `status`.

Holder fields (inside `holders[]`, sorted by payout, largest first):
- `organization_name`: the holder
- `cost_of_holdings`: what the holder paid
- `value_of_holdings`: what the holder receives at this exit
- `outstanding_shares`: shares held
- `return_multiple`: payout / cost (< 1.0x = loss)
- `irr`: internal rate of return

Amounts arrive as strings; cast before comparing or charting.

## Workflow

### Step 1 — Fetch Scenarios

Call `cap_table__get__waterfall_scenarios` once with the corporation ID.

### Step 2 — Read Each Scenario by Its State

A scenario's content depends on its `status` and whether it has `holders`. Handle each one on its own terms:

| What the scenario carries | What to present |
|---|---|
| `status: "DONE"` with `holders` | The full framing in Step 3, per-holder table, and bar chart. |
| `status: "DONE"` without `holders`, and the response carries `holders_unavailable` | The scenario is owned by the company, and this tool can't return its per-holder split. Report its name, exit value, and exit date. Say the per-holder breakdown isn't available here, and point the user to the scenario's Exit modeling page in Carta. **Never** describe holders as absent or payouts as zero. |
| `status: "PREPARING"` or `"IN_PROGRESS"` | Carta is still computing it. Report the name and exit value and say results appear once the run finishes. |
| `status: "ERROR"` | The model run failed in Carta. Report the name and suggest re-running it from Exit modeling. |

If the response has `message: "No saved waterfall scenarios found."`, tell the user the company has no saved exit scenarios and offer the custom-exit guidance below.

### Step 3 — Frame Each Completed Scenario

Don't just show the table — frame each scenario that has holders:

- **Lead with the exit value and what it means**: who gets paid out, at what multiple, and whether any holders are underwater
- **Highlight the biggest winners and losers** by return multiple — a 1.0x return means a holder barely breaks even; anything below that means a loss
- **If there are multiple scenarios**, compare them: how do payouts shift as exit value changes? At what exit value does the common stack start to see meaningful returns?
- **Note liquidation preference effects**: if preferred holders take a large share at lower exit values, say so plainly

### Step 4 — Flag Notable Items

- Any holder with return multiple < 1.0x (loss scenario)
- Large gap between pref payout and common payout at a given exit value
- Scenarios that are very close in exit value but have very different common distributions

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly. Framing and comparison are presentational, not modeled.

## Presentation

**Format**: Per-holder table + ASCII bar chart for each scenario with holders; a one-line status for every other scenario.

**BLUF lead**: Lead with the exit value and a one-sentence summary of who benefits most and whether any holders are underwater. If no scenario has holders, lead with what is available (scenario names and exit values) and why the split isn't shown.

**Sort order**: By `value_of_holdings` descending (the order the tool returns).

Per-holder table columns: Holder, Cost Basis (`cost_of_holdings`), Payout (`value_of_holdings`), Return Multiple (`return_multiple`).

After the per-holder table, render an ASCII bar chart of payout by holder.
Scale bars to max width 40 chars:

```
Payout Distribution — $50M Exit

Lead Investor      ████████████████████████████████████████ $18.2M  3.6x
Founder            ████████████████████                     $9.1M   1.8x
Common Holders     ██████████                               $4.5M   0.9x
```

Each bar width = (value_of_holdings / max value_of_holdings) * 40. Show return multiple after the dollar amount.

## Error Handling

| Situation | What to do |
|---|---|
| 403 / access denied | Exit modeling isn't enabled for this company (a product entitlement, not a problem with the user's permissions). Say: *"Exit modeling isn't enabled for this company in Carta, so there are no saved waterfall scenarios to show."* Do not retry, and do not try other tools. |
| *"Unknown tool"* | Use the exact name `cap_table__get__waterfall_scenarios` through `call_tool` and retry once. Do not guess name variations. |
| Network/transport error | One retry. If it fails again, tell the user Carta couldn't be reached and to try again shortly. |

## Custom Exit Values

If the user asks to model a specific exit value not in the saved scenarios:

> "There's no saved model at that exit value. To model a custom exit, create a new scenario in Carta's scenario modeling tool, then come back and I'll pull it up."

## Caveats

- Waterfall models are read-only snapshots saved in Carta; this skill cannot create or modify scenarios.
- Return multiples are based on the scenario's modeled exit value, not a live valuation.
- Liquidation preference mechanics (participating vs. non-participating, caps) are baked into Carta's model — this skill does not re-derive them.
- Custom exit values cannot be modeled on the fly; they must be created in Carta first.
