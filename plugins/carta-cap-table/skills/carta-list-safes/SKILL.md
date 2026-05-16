---
name: carta-list-safes
description: SAFEs for a single company — simple agreements for future equity, with SAFE investor names, SAFE investment amounts, SAFE valuation caps, SAFE discount rates, MFN flags on SAFEs, and SAFE totals. Lists SAFEs only; does not cover convertible notes or other debt.
when_to_use: >-
  Use when the user mentions SAFEs by name (or "simple agreements for
  future equity" / "future-equity agreements"). Covers SAFE investors,
  SAFE valuation caps, SAFE discount rates, MFN clauses on SAFEs, and
  how much has been raised through SAFEs. Do not use for convertible
  notes, convertible debt, interest-bearing instruments with maturity
  dates, or generic "outstanding instruments" / "outstanding obligations"
  framing without the word SAFE — those belong to a convertible-notes
  skill. For modeling how SAFEs convert at a priced round, prefer a
  conversion-calculator skill.
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

If you need both SAFEs and convertible notes together (e.g. for the carta-conversion-calculator skill), use `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` instead — that returns both types in one call and avoids a redundant API request. Do not call both `carta-list-safes` and `carta-list-convertible-notes` for the same query.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

```
fetch("cap_table:list:safes", {"corporation_id": corporation_id})
```

> **Detail mode**: This command supports `detail=summary` (counts, totals, breakdowns — fast) and `detail=full` (individual SAFE records with investor names and terms). Choose the right mode upfront based on user intent — see Workflow.

## Key Fields

- `investor_name`: investor name
- `investor_amount`: dollar amount invested
- `valuation_cap`: valuation cap (null on uncapped SAFEs)
- `discount`: discount percentage
- `state`: one of `PENDING_LEGAL_ADMIN_REVIEW`, `AWAITING_SIGNATURES`, `AWAITING_FUNDING`, `ISSUED`, `CANCELED`
- `date_issued`, `company_signed_on`, `investor_signed_on`: signature/issuance dates
- `instrument`: side-letter / template variant (e.g. YC, Carta-standard)

## Workflow

### Step 1 — Fetch SAFEs

Choose detail mode based on the user's intent — do NOT default to summary then re-fetch:

- **Aggregate questions** ("how many SAFEs?", "total invested in SAFEs?"): omit `detail` — summary mode returns counts, totals, and breakdowns instantly.

  ```
  fetch("cap_table:list:safes", {"corporation_id": corporation_id})
  ```

- **Individual records** ("show me the SAFEs", "list SAFE investors", "what are the valuation caps?", any request for investor names or terms): use `detail=full` directly.

  ```
  fetch("cap_table:list:safes", {"corporation_id": corporation_id, "detail": "full"})
  ```

When in doubt, prefer `detail=full` — most SAFE queries want to see investor names and terms.

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Table

**BLUF lead**: Lead with the count of outstanding SAFEs and total outstanding amount before showing the table.

**Sort order**: By investment amount descending.

| Investor | Amount | Val. Cap | Discount | State |
|----------|--------|----------|----------|-------|
| Investor A | $500,000 | $6,000,000 | 20% | ISSUED |

Show totals: total outstanding amount, count by state.

## Caveats

- SAFE terms displayed reflect what is recorded in Carta; side letters or amendments outside Carta are not captured.
- MFN clause presence is shown as a boolean flag — the specific MFN trigger conditions are governed by the SAFE agreement itself.
- If you need both SAFEs and convertible notes, use `fetch("cap_table:get:convertible_notes", {"corporation_id": corporation_id})` instead -- it returns both types in one call.
