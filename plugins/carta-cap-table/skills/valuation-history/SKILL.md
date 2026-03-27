---
name: valuation-history
description: Fetch 409A valuation history for a company. Use when asked about 409A valuations, FMV, exercise prices, or valuation expiration dates.
---

# 409A Valuation History

Fetch 409A fair market value (FMV) history for a company.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Fetching

```
fetch("cap_table:get:409a_valuations", {"corporation_id": corporation_id})
```

Optional params:
- `share_class_id`: filter to a specific share class
- `report_id`: filter to a specific valuation report

## Key Fields

- `effective_date`: date the 409A valuation became effective
- `expiration_date`: date the valuation expires (typically 1 year after effective)
- `stale_date`: date after which the valuation is considered stale (if applicable)
- `price`: FMV per share as a string (e.g. `"12.610000000000"`)
- `name`: share class name (e.g. "Common")
- `common`: true if this is the common stock FMV
- `report_id`: ID of the 409A report
- `share_class_id`: ID of the share class

## Response Format

JSON array of FMV records:
```json
[
  {
    "id": 484,
    "effective_date": "04/25/2024",
    "expiration_date": "04/24/2025",
    "stale_date": null,
    "price": "12.610000000000",
    "report_id": 472,
    "share_class_id": 9,
    "name": "Common",
    "common": true,
    "corporation_id": 7
  }
]
```

## How to Present

1. Sort by `effective_date` descending (most recent first)
2. The **most recent** entry is the current 409A — highlight it
3. Format `price` as currency (e.g. "$12.61/share"), trimming trailing zeros
4. Check if `expiration_date` is within 90 days of today — **flag as a time-sensitive action item**, not just a data point: bold it, call out the exact days remaining, and recommend initiating renewal immediately (especially if a financing round is in progress, as closing will likely push past the expiry date)
5. Check if `expiration_date` is in the past — flag as "expired"
6. For history, show a table:

| Effective | Expires | FMV/Share | Share Class | Status |
|-----------|---------|-----------|-------------|--------|
| 04/25/2024 | 04/24/2025 | $12.61 | Common | Current |
| 03/31/2023 | 04/24/2024 | $10.33 | Common | Expired |

7. Do not render a bar chart for FMV history — values in mature companies cluster near the
   maximum, making bars uninformative (all bars look the same width). The table is sufficient.
   Instead, after the table, add a one-line trend summary:
   > FMV has grown **Nx since YYYY**, with [acceleration/steady growth] since [year].

8. If multiple share classes exist, group by share class name in the table.
