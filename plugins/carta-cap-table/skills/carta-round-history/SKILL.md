---
name: carta-round-history
description: Fetch financing round history for a company. Use when asked about funding rounds, capital raised, or financing history.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Round History

Fetch financing history and summarize by round, or use the cap table by share class for a quick overview.

## When to Use

- "Show me the funding history"
- "What rounds has this company raised?"
- "How much capital was raised in the Series A?"
- "List all financing rounds"
- "Who invested in each round?"
- "What was the price per share for the seed?"

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

### Option 1: Detailed History (per-security)

```
fetch("cap_table:get:financing_history", {"corporation_id": corporation_id})
```

This is the same data that powers the in-app "Financing History" tab.

### Option 2: Quick Summary (from cap table)

```
fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})
```

Each preferred share class represents a round. Faster but less detail: no individual investors, no issue dates, no price per share.

## Key Fields

- `round_name`: name of the financing round (e.g. "Series A Preferred")
- `issue_date`: date the security was issued
- `cash_paid`: amount paid by the investor for this security
- `quantity`: number of shares issued
- `issue_price`: price per share
- `stakeholder_name`: investor name
- `label`: security label (e.g. "PB-9")
- `is_grant`: true if this is an option grant (not a priced round)
- `is_canceled`: true if the security was canceled — exclude from aggregates
- `is_converted`: true if the security converted (e.g. SAFE → preferred)

### Response Format

```json
{
  "count": 120,
  "results": [
    {
      "id": 666,
      "pk_key": "certificate_pk",
      "stakeholder_name": "Janet Sugiyama",
      "currency": "USD",
      "label": "PB-9",
      "round_name": "Series B Preferred",
      "quantity": 180000.0,
      "issue_date": "2014-09-14",
      "cash_paid": 219600.0,
      "issue_price": "1.22",
      "is_grant": false,
      "is_canceled": false,
      "is_converted": false
    }
  ]
}
```

## Workflow

### Step 1 — Fetch Financing History

Call `fetch("cap_table:get:financing_history", {"corporation_id": corporation_id})` for detailed data, or `fetch("cap_table:get:cap_table_by_share_class", {"corporation_id": corporation_id})` for a quick summary.

### Step 2 — Aggregate by Round

1. Group results by `round_name`
2. For each round, aggregate: total `cash_paid`, total `quantity`, count of investors, earliest `issue_date`
3. Use `issue_price` from any non-canceled entry as the price per share
4. Filter out entries where `is_canceled` is true

### Step 3 — Present Results

Present the aggregated table and bar chart (see Presentation section).

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly (aggregation is mechanical grouping, not modeled output).

## Presentation

**Format**: Table + ASCII bar chart

**BLUF lead**: Lead with the total number of rounds and total cash raised before showing the table.

**Sort order**: By `issue_date` ascending (chronological order).

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

| Round | Close Date | Price/Share | Investors | Shares Issued | Cash Raised |
|-------|-----------|-------------|-----------|---------------|-------------|
| Series Seed Preferred | Jun 30, 2013 | $0.27 | 5 | 1,422,435 | $383,380 |
| Series A Preferred | Nov 15, 2013 | $0.44 | 8 | 3,697,191 | $1,645,250 |

After the table, render an ASCII bar chart of cash raised per round (chronological order).
Scale bars to max width 40 chars. Exclude rounds with zero cash raised (e.g. option grants).

```
Cash Raised by Round

Series Seed Preferred  ████                                     $383K
Series A Preferred     ████████████████                         $1.6M
Series B Preferred     ████████████████████████████████████████ $3.7M
```

Each bar width = (cash_raised / max_cash_raised) * 40, rounded to nearest integer.
Format large numbers as $XM or $XK for readability.

## Caveats

- Entries with `is_canceled: true` must be excluded from all aggregates.
- Converted securities (`is_converted: true`) may appear alongside their post-conversion entries — avoid double-counting when summing shares or cash.
- Option grants (`is_grant: true`) appear in financing history but are not priced rounds — exclude from the cash-raised bar chart.
- The quick summary (Option 2) lacks per-investor detail, issue dates, and price per share.
