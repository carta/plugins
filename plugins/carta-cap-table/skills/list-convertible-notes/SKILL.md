---
name: list-convertible-notes
description: Fetch all convertible instruments (SAFEs and convertible debt) for a company. Use when asked about convertible notes, SAFEs, convertible debt, note terms, caps, discounts, or maturity dates.
---

# List Convertible Notes

Fetch all convertible instruments for a company.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Fetching

```
fetch("cap_table:list:convertible_notes", {"corporation_id": corporation_id})
```

Optional params:
- `page`, `pageSize`: pagination
- `search`: text search
- `statusExplanation`: filter by status (e.g. "Outstanding", "Converted", "Canceled")

## Key Fields

- `is_debt`: `false` = SAFE, `true` = convertible note
- `dollar_amount`: investment amount
- `price_cap`: valuation cap
- `discount_percent`: discount rate
- `interest_rate`: annual interest rate (convertible debt only)
- `maturity_date`: when the note matures
- `total_with_interest`: principal + accrued interest
- `status_explanation`: "Outstanding", "Converted", "Canceled"
- `note_block`: groups notes by round/tranche (e.g. "2013 SAFE", "Bridge 2014")
- `name`: investor name
- `label`: security label (e.g. "SAFE-1", "CN-1")

## How to Present

1. Separate into SAFEs (`is_debt: false`) and Convertible Notes (`is_debt: true`)
2. Filter out canceled/converted unless specifically asked
3. For outstanding instruments, check if `maturity_date` is approaching (within 90 days) or past

**SAFEs:**

| Investor | Amount | Val. Cap | Discount | MFN | Status |
|----------|--------|----------|----------|-----|--------|
| Investor A | $500,000 | $6,000,000 | 20% | No | Outstanding |

**Convertible Notes:**

| Investor | Amount | Val. Cap | Discount | Interest | Maturity | Total w/ Interest | Status |
|----------|--------|----------|----------|----------|----------|-------------------|--------|
| Investor B | $500,000 | $8,000,000 | 20% | 6% | 11/05/2019 | $740,164 | Converted |

4. Group by `note_block` if there are multiple tranches
5. Show totals: total outstanding amount, total with interest
