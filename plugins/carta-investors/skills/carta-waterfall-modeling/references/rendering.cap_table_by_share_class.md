# Rendering — `cap_table_by_share_class`

Column/row spec for `cap_table:get:cap_table_by_share_class`. Number formatting: `SKILL.md`
§Formatting rules. Excel cells + metadata band: `references/excel-output.md`.

**Render straight through.** The response is flat and pre-summed — loop and place, no recompute.
Ownership fields arrive as fractions (0–1): multiply by 100 before appending `%` (`0.35691` →
`35.69%`). Quantities → integers with thousands separators. Money → currency. Null/absent → `—`.

## Columns

| Column | colType |
|---|---|
| Share class | text |
| Stock type | text |
| Authorized units | qty |
| Outstanding | qty |
| Ownership | pct |
| Fully diluted | qty |
| Ownership | pct |
| Capital contributed | currency |

## Rows

Order: share classes → warrants → option pools → total.

**Per `share_classes[]`:** Share class `name`, Stock type `stock_type`, Authorized units
`authorized_shares`, Outstanding `outstanding_shares`, Ownership `outstanding_ownership`, Fully
diluted `fully_diluted_shares`, Ownership `fully_diluted_ownership`, Capital contributed `cash_raised`.

**Per `warrant_blocks[]`:** Share class `name`, Stock type `Warrant`, Fully diluted
`fully_diluted_shares`, Ownership (FD) `fully_diluted_ownership`, Capital contributed `cash_paid`; rest
`—`. `conversion_ratio` → footnote if set.

**Per `option_plans[]` — two rows:**
- `"Shares outstanding under " + name`: Stock type `Option pool`, Authorized units `authorized_shares`,
  Fully diluted `outstanding_shares`, Ownership (FD) `outstanding_ownership`; rest `—`.
- `"Shares available under " + name`: Stock type `Option pool`, Fully diluted `available_shares`,
  Ownership (FD) `available_ownership`; rest `—`.

`option_plans[].fully_diluted_shares` is the plan total — it reconciles the FD Total, not a row.

**Total (bold), from `totals`:** Outstanding `total_outstanding`, Ownership
`total_outstanding_ownership`, Fully diluted `total_fully_diluted`, Ownership (FD)
`total_fully_diluted_ownership`, Capital contributed `total_cash_raised`. Authorized units and Stock type blank.
