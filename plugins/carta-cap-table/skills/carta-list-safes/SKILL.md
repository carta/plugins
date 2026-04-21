---
name: carta-list-safes
description: Fetch all SAFEs for a company. Use when asked about SAFEs, simple agreements for future equity, SAFE terms, valuation caps, or discounts.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# List SAFEs

Fetch all SAFEs for a company.

## When to Use

- "Show me the SAFEs on this cap table"
- "What SAFEs are outstanding?"
- "What are the valuation caps on our SAFEs?"
- "List SAFE investors and terms"
- "Do any SAFEs have MFN clauses?"

Use this skill for SAFEs only. If you need both SAFEs and convertible notes together (e.g. for the carta-conversion-calculator skill), use `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` instead — that returns both types in one call and avoids a redundant API request. Do not call both `carta-list-safes` and `carta-list-convertible-notes` for the same query.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

```
fetch("cap_table:list:safes", {"corporation_id": corporation_id})
```

> **Detail mode**: The gateway defaults to `detail=summary` for list commands. Summary mode returns counts, totals, and breakdowns (by status, valuation cap tiers) without serializing every individual SAFE record. If the user needs individual SAFE records (investor names, specific terms, per-instrument amounts), pass `"detail": "full"` in the fetch params. Omitting `detail` gives summary mode automatically.

## Key Fields

- `investor_name` or `investor.name`: investor name
- `investment_amount` or `amount`: dollar amount invested
- `valuation_cap` or `cap`: valuation cap
- `discount_rate` or `discount`: discount percentage
- `mfn`: boolean, most favored nation clause
- `status`: "Outstanding", "Converted", etc.

## Workflow

### Step 1 — Fetch Summary

```
fetch("cap_table:list:safes", {"corporation_id": corporation_id})
```

Omitting `detail` returns the summary: count, total invested, and by-state breakdown. Present this data immediately (BLUF lead).

### If the user needs individual SAFE records

Call again with `"detail": "full"`:

```
fetch("cap_table:list:safes", {"corporation_id": corporation_id, "detail": "full"})
```

This returns individual SAFE records with investor names, specific terms, and per-instrument amounts. Format as a table (see Presentation) with totals.

Do NOT call this automatically — only when the user asks for individual records, investor names, or specific SAFE terms.

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Table

**BLUF lead**: Lead with the count of outstanding SAFEs and total outstanding amount before showing the table.

**Sort order**: By investment amount descending.

| Investor | Amount | Val. Cap | Discount | MFN | Status |
|----------|--------|----------|----------|-----|--------|
| Investor A | $500,000 | $6,000,000 | 20% | No | Outstanding |

Show totals: total outstanding amount, count by status.

## Caveats

- SAFE terms displayed reflect what is recorded in Carta; side letters or amendments outside Carta are not captured.
- MFN clause presence is shown as a boolean flag — the specific MFN trigger conditions are governed by the SAFE agreement itself.
- If you need both SAFEs and convertible notes, use `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` instead -- it returns both types in one call.
