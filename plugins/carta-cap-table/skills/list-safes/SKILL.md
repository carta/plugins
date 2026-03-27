---
name: list-safes
description: Fetch all SAFEs for a company. Use when asked about SAFEs, simple agreements for future equity, SAFE terms, valuation caps, or discounts.
---

# List SAFEs

Fetch all SAFEs for a company.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## When to Use This Skill

Use this skill for SAFEs only. If you need both SAFEs and convertible notes together (e.g. for the conversion-calculator or pro-forma-model skills), use `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` instead — that returns both types in one call and avoids a redundant API request. Do not call both `list-safes` and `list-convertible-notes` for the same query.

## Data Fetching

```
fetch("cap_table:list:safes", {"corporation_id": corporation_id})
```

## Key Fields

- `investor_name` or `investor.name`: investor name
- `investment_amount` or `amount`: dollar amount invested
- `valuation_cap` or `cap`: valuation cap
- `discount_rate` or `discount`: discount percentage
- `mfn`: boolean, most favored nation clause
- `status`: "Outstanding", "Converted", etc.

## How to Present

Format as a table:

| Investor | Amount | Val. Cap | Discount | MFN | Status |
|----------|--------|----------|----------|-----|--------|
| Investor A | $500,000 | $6,000,000 | 20% | No | Outstanding |

Show totals: total outstanding amount, count by status.
