---
name: carta-list-convertible-notes
description: Fetch all convertible instruments (SAFEs and convertible debt) for a company. Use when asked about convertible notes, SAFEs, convertible debt, note terms, caps, discounts, or maturity dates.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# List Convertible Notes

Fetch all convertible instruments for a company.

## When to Use

- "Show me all convertible notes"
- "What convertible instruments are outstanding?"
- "Which notes are approaching maturity?"
- "List all SAFEs and convertible debt"
- "What are the terms on our convertible notes?"
- "Show me notes grouped by tranche"

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

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

## Workflow

### Step 1 — Fetch Convertible Instruments

Call the data retrieval endpoint with the corporation ID and any optional filters.

### Step 2 — Classify Instruments

Separate results into SAFEs (`is_debt: false`) and Convertible Notes (`is_debt: true`).

### Step 3 — Filter and Flag

Filter out canceled/converted unless specifically asked. For outstanding instruments, check if `maturity_date` is approaching (within 90 days) or past.

### Step 4 — Present Results

Format as separate tables by type, grouped by `note_block` if there are multiple tranches (see Presentation).

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Separate tables for SAFEs and Convertible Notes

**BLUF lead**: Lead with the count of outstanding instruments and total outstanding amount before showing the tables.

**Sort order**: By investment amount descending within each table. Group by `note_block` if there are multiple tranches.

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

**SAFEs:**

| Investor | Amount | Val. Cap | Discount | MFN | Status |
|----------|--------|----------|----------|-----|--------|
| Investor A | $500,000 | $6,000,000 | 20% | No | Outstanding |

**Convertible Notes:**

| Investor | Amount | Val. Cap | Discount | Interest | Maturity | Total w/ Interest | Status |
|----------|--------|----------|----------|----------|----------|-------------------|--------|
| Investor B | $500,000 | $8,000,000 | 20% | 6% | Nov 5, 2019 | $740,164 | Converted |

Show totals: total outstanding amount, total with interest.

## Caveats

- Interest calculations reflect Carta's accrual logic; actual amounts may differ if the note agreement specifies non-standard compounding.
- Maturity date flags are informational — actual enforcement and extension terms are governed by the note agreement.
- Canceled and converted instruments are hidden by default; ask the user if they want the full history.
