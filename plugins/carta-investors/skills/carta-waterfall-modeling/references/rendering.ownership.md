# Rendering — `ownership`

Column/row spec for `cap_table:list:ownership`. Number formatting: `SKILL.md`
§Formatting rules. Excel cells + metadata band: `references/excel-output.md`.

**Render straight through.** The response is flat and pre-summed — loop and place, no recompute.
Numbers arrive as decimal strings (`"1000000"`, `"0.35691"`): convert them before you format them.
Ownership fields are fractions (0–1): multiply by 100 before appending `%` (`"0.35691"` →
`35.69%`). Quantities → integers with thousands separators. Null/absent → `—`. When a row has
`ownership_unavailable: true`, its Ownership cells are `—`.

**Money** is a list with one `{amount, currency}` per currency. Format each entry in its own
currency. When a list has more than one entry, show each entry in the same cell, separated by `; `.
Never add amounts in different currencies. An empty list → `—`.

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

The rows are in `results`, one row for each `kind`. Order: share classes → warrants → option pools →
total. Rows with `kind` `"note_block"` are not part of this table: the convertibles table
(`cap-table.corp.md` §Convertibles) shows the notes.

**Per row with `kind` `"share_class"`:** Share class `name`, Stock type `stock_type`, Authorized units
`authorized_shares`, Outstanding `outstanding_shares`, Ownership `outstanding_ownership`, Fully
diluted `fully_diluted_shares`, Ownership `fully_diluted_ownership`, Capital contributed `cash_raised`.

**Per row with `kind` `"warrant_block"`:** Share class `name`, Stock type `Warrant`, Fully diluted
`fully_diluted_shares`, Ownership (FD) `fully_diluted_ownership`, Capital contributed `cash_raised`;
rest `—`. `conversion_ratio` → footnote if set.

**Per row with `kind` `"option_plan"` — two rows:**
- `"Shares outstanding under " + name`: Stock type `Option pool`, Authorized units `authorized_shares`,
  Fully diluted `outstanding_shares`, Ownership (FD) `outstanding_ownership`; rest `—`.
- `"Shares available under " + name`: Stock type `Option pool`, Fully diluted `available_shares`,
  Ownership (FD) `available_ownership`; rest `—`.

An option plan row's `fully_diluted_shares` is the plan total — it reconciles the FD Total, not a row.

**Total (bold), from `summary`:** Outstanding `total_outstanding`, Ownership
`total_outstanding_ownership`, Fully diluted `total_fully_diluted`, Ownership (FD)
`total_fully_diluted_ownership`, Capital contributed `total_cash_raised`. Authorized units and Stock type blank.
