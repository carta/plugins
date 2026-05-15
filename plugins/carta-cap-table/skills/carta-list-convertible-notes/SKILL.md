---
name: carta-list-convertible-notes
description: Convertible debt instruments outstanding for a single company — interest-bearing convertible notes with note terms, conditions, principal amounts, accrued interest, valuation caps, discount rates, and maturity dates. Lists the notes themselves and what was agreed.
when_to_use: >-
  Use when asked about convertible notes, convertible debt, debt
  instruments outstanding, note terms or conditions agreed on, note
  principal or accrued interest, maturity dates on outstanding debt,
  when notes come due, note discount rates, or note investors. Generic
  "outstanding obligations" / "outstanding instruments" / "agreements
  that will convert" framing also belongs here unless the user names
  SAFEs explicitly. For SAFEs (no maturity, no interest, named as SAFEs
  or "simple agreements for future equity"), prefer a SAFE list skill.
  For modeling the conversion math at a priced round, prefer a
  conversion-calculator skill. Do NOT route to a cross-company
  portfolio-query skill for single-company note listings — even when the
  user says "all our debt" or "list our notes" without naming a company,
  default to this skill for the single-company case.
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

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

```
fetch("cap_table:list:convertible_notes", {"corporation_id": corporation_id})
```

> **Detail mode**: This command supports `detail=summary` (counts, totals, breakdowns — fast) and `detail=full` (individual instrument records with investor names and terms). Choose the right mode upfront based on user intent — see Workflow.

Optional params:
- `page`, `pageSize`: pagination (only relevant when `detail` is `full`)
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

### Step 1 — Fetch Convertible Notes

Choose detail mode based on the user's intent — do NOT default to summary then re-fetch:

- **Aggregate questions** ("how many convertible notes?", "total outstanding amount?"): omit `detail` — summary mode returns counts, totals, and breakdowns instantly.

  ```
  fetch("cap_table:list:convertible_notes", {"corporation_id": corporation_id})
  ```

- **Individual records** ("show me all convertible notes", "which notes are approaching maturity?", "what are the terms?", any request for investor names or specific terms): use `detail=full` directly.

  ```
  fetch("cap_table:list:convertible_notes", {"corporation_id": corporation_id, "detail": "full"})
  ```

When in doubt, prefer `detail=full` — most convertible note queries want to see specific terms.

After fetching with `detail=full`, classify and filter:

1. Separate results into SAFEs (`is_debt: false`) and Convertible Notes (`is_debt: true`).
2. Filter out canceled/converted unless specifically asked. For outstanding instruments, check if `maturity_date` is approaching (within 90 days) or past.

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
