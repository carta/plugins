---
name: conversion-calculator
description: Calculate SAFE and convertible note conversion into equity. Use when asked about SAFE conversion, note conversion, conversion shares, or how instruments convert in a round.
---

# Conversion Calculator

Calculate how SAFEs and convertible notes convert into equity at a given round price or valuation.

## When to Use

- "How many shares would the SAFEs convert into at a $50M pre?"
- "Calculate SAFE conversions for the Series A"
- "What happens to the convertible notes if we raise at $10/share?"
- "Show me the conversion math for all outstanding instruments"

## Prerequisites

You need:
1. `corporation_id` — get from `list_accounts`
2. Round terms — user must provide at least a **pre-money valuation** or **price per share**

If neither is provided, you MUST call AskUserQuestion BEFORE any computation:
AskUserQuestion("What pre-money valuation or price per share should I use for the conversion calculation?")

**Subagent prohibition:** Do NOT delegate this skill to a background agent if the round valuation or price per share is missing. A subagent cannot ask the user for input. If these are absent and you are considering dispatching an agent, stop — ask the user directly first, then proceed.

## Data Retrieval

- `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` — SAFEs + convertible notes
- `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` — current fully diluted count
- `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` — current FMV (for reference)

## Key Fields

From convertible instruments:
- `is_debt`: false = SAFE, true = convertible note
- `dollar_amount`: principal investment amount
- `price_cap`: valuation cap
- `discount_percent`: discount rate (e.g. `"20.00"` = 20%)
- `interest_rate`: annual interest rate (notes only)
- `total_with_interest`: principal + accrued interest (use this for note conversions)
- `has_most_favored_nation_clause`: MFN SAFE — converts at best subsequent terms
- `status_explanation`: filter to "Outstanding" only

## Step 1: Gather Instrument Data

1. `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` — SAFEs + notes (filter to `status_explanation: "Outstanding"`)
2. `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` — get current fully diluted share count from `totals.total_fully_diluted`
3. `fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})` — current FMV for context

## Step 2: Conversion Math

### SAFE Conversion

For each SAFE, compute shares under both methods, use the one giving MORE shares:

**Cap conversion:**
```
cap_price = valuation_cap / pre_money_fully_diluted_shares
shares = investment_amount / cap_price
```

**Discount conversion:**
```
discount_price = round_price_per_share * (1 - discount_rate)
shares = investment_amount / discount_price
```

**No cap, no discount (MFN):**
- Converts at the round price (or the best terms of a subsequent SAFE)
```
shares = investment_amount / round_price_per_share
```

### Convertible Note Conversion

Same as SAFE but:
- Use `total_with_interest` (principal + accrued interest) instead of investment amount
- If `interest_rate` and `maturity_date` are available and `total_with_interest` is not, calculate:
  ```
  years = (conversion_date - issue_date) / 365
  total = principal * (1 + interest_rate * years)
  ```

## Step 3: Present Results

### Per-Instrument Table

| Instrument | Investor | Amount | Accrued Interest | Total | Cap | Discount | Method Used | Price/Share | Shares |
|-----------|----------|--------|-----------------|-------|-----|----------|-------------|-------------|--------|
| SAFE-1 | Investor A | $500,000 | — | $500,000 | $6M | 20% | Cap | $0.60 | 833,333 |
| SAFE-2 | Investor B | $250,000 | — | $250,000 | $8M | — | Cap | $0.80 | 312,500 |
| CN-1 | Investor C | $500,000 | $240,164 | $740,164 | $8M | 20% | Discount | $0.88 | 840,914 |

### Summary

```
Round price per share: $1.10
Pre-money fully diluted: 10,000,000 shares

SAFE conversions: 1,145,833 shares ($750,000 invested)
  - Effective avg price: $0.65/share (41% discount to round price)

Note conversions: 840,914 shares ($500,000 principal + $240,164 interest)
  - Effective avg price: $0.88/share (20% discount to round price)

Total conversion shares: 1,986,747
Post-conversion fully diluted: 11,986,747
```

## Important Notes

- Always show which conversion method (cap vs discount) was more favorable and used
- If a SAFE has both cap and discount, compute both and pick the one yielding more shares
- For MFN SAFEs, note that they take the best terms of any subsequent SAFE
- Accrued interest on notes can significantly increase the conversion amount — always account for it
- State the assumed conversion date (today or the round close date)
- This is an estimate — actual conversion depends on legal documents. Recommend review by counsel.

