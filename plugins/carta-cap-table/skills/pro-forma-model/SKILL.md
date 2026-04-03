---
name: pro-forma-model
description: Model a pro-forma financing round to show dilution impact. Use when asked to model a Series A/B/C, new round, or show how a round would affect ownership.
---

# Pro-Forma Round Modeling

Model the dilution impact of a new financing round using cap table data, SAFE/note conversion terms, and round parameters.

## When to Use

- "Model a Series B at $80M pre-money"
- "What does dilution look like if we raise $20M at $100M pre?"
- "How would a 10% option pool increase affect ownership?"
- "Show me pro-forma ownership after converting SAFEs into a Series A"

## Required Inputs — MUST BLOCK

**STOP. Do not compute ANY pro-forma values, scenarios, or estimates without ALL required inputs. Do not model multiple scenarios as a substitute for asking. Do not proceed "in the meantime". Ask first, compute after.**

| Input | Example | Required? |
|---|---|---|
| Pre-money valuation | "$80M pre-money" | Yes |
| New investment amount (raise size) | "raising $15M" | **Yes — ALWAYS ask if not given** |
| Option pool target | "10% post-money pool" | No — skip pool math if omitted |

If the raise size is missing, you MUST call AskUserQuestion BEFORE any computation:
AskUserQuestion("How much are you raising in this round? I need the raise amount before I can compute any pro-forma numbers.")

**Even in multi-part requests** (e.g. "get me cap table AND pro-forma"), complete the other parts but BLOCK on the pro-forma until raise size is confirmed. Do not guess. Do not model scenarios at common amounts. Ask.

**Subagent prohibition:** Do NOT delegate this skill to a background agent if the raise size is missing. A subagent cannot ask the user for input.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

Fetch saved pro-forma round models:

```
fetch("cap_table:get:pro_forma_models", {"corporation_id": corporation_id})
```

Returns saved pro-forma round models. If none exist, compute manually (see Option 2 below).

## Key Fields

From saved models:
- `name`: round name (e.g. "Series A")
- `inputs.pre_money_valuation`: pre-money valuation used
- `inputs.new_investment_amount`: round size
- `inputs.post_round_option_pool.value`: target option pool %
- `outputs.post_money_valuation`: computed post-money valuation
- `outputs.post_round_share_price`: new share price
- `outputs.post_round_option_pool_share_count_increase`: shares added to pool
- `investments[]`: per-investor breakdown
- `convertibles[]`: SAFEs/notes included in the model

## Option 1: Use Saved Pro-Forma Models

```
fetch("cap_table:get:pro_forma_models", {"corporation_id": corporation_id})
```

This returns any saved pro-forma round models. If the company has modeled rounds in Carta, use these directly.

## Option 2: Compute from Cap Table Data

### Step 1: Gather Current State

1. `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` — get current authorized/outstanding/fully-diluted shares
2. `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` — get SAFEs and convertible notes (filter to `status_explanation: "Outstanding"`)
3. `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` — get current FMV

### Step 2: Apply Round Math

Given user inputs:
- **Pre-money valuation** (e.g. $80M)
- **Round size** (e.g. $15M)
- **Option pool increase** (e.g. 10% post-money target)

Before computing, check available pool shares. From `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})`, compare `option_plans[].authorized_shares` vs `option_plans[].fully_diluted_shares` — the difference is currently available (unissued) shares. Report both the authorized pool size and the available-for-future-grants amount separately. If the available pool is nearly exhausted (< 5% of authorized), flag it — even a large authorized pool means little if it's mostly issued/vested.

Calculate using this EXACT formula. Do not deviate or simplify.

**Option pool shuffle** — the pool increase is carved from pre-money, meaning it inflates the denominator for price-per-share. This is circular (pool depends on post-FD, post-FD depends on pool), so solve iteratively:

```
Inputs:
  pre_money        = user-provided (e.g. $80,000,000)
  raise            = user-provided (e.g. $20,000,000)
  pool_pct         = user-provided (e.g. 0.10 for 10%)
  pre_fd           = from cap table total_fully_diluted
  existing_pool    = from cap table option_plans fully_diluted_shares
  conversion_shares = SAFE + note conversions (see below)

Step A — Solve for new pool shares (iterative):
  Start with: new_pool_shares = 0
  Repeat until stable (max 20 iterations):
    adjusted_pre_fd   = pre_fd + new_pool_shares + conversion_shares
    price_per_share    = pre_money / adjusted_pre_fd
    new_round_shares   = raise / price_per_share
    post_fd            = adjusted_pre_fd + new_round_shares
    new_pool_shares    = (post_fd * pool_pct) - existing_pool
    if new_pool_shares < 0: new_pool_shares = 0

Step B — Final values:
  post_money         = pre_money + raise
  price_per_share    = pre_money / (pre_fd + new_pool_shares + conversion_shares)
  new_round_shares   = raise / price_per_share
  post_fd            = pre_fd + new_pool_shares + conversion_shares + new_round_shares

Verify: new_round_shares / post_fd should equal raise / post_money (investor ownership = raise / post-money). If not, recheck the math.

SAFE conversions (only if status = "Outstanding"):
  Cap:      shares = investment / (cap / pre_fd)
  Discount: shares = investment / (price_per_share * (1 - discount))
  Use whichever gives MORE shares to the holder.

Note conversions (only if status = "Outstanding"):
  Same as SAFE but use total_with_interest instead of investment.
```


### Step 3: Present Results

Show a before/after ownership table with: stakeholder group, pre-round shares, pre-round %, post-round shares, post-round %, dilution.

Also show: price per share, pre-money and post-money valuation, total SAFE/note conversion shares, new option pool shares added.

## Important Notes

- If SAFE terms are ambiguous, show both cap and discount scenarios
- Option pool shuffle: the pool increase typically comes from pre-money (dilutes existing holders, not new investors). Clarify this.
