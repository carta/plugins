# Rendering — convertible note blocks (`cap_table:list:ownership` rows with `kind` `note_block`)

Column/row spec for the convertibles of a corp cap table: the `cap_table:list:ownership` rows whose
`kind` is `"note_block"`, one per round (principal + accrued interest to `as_of`).
**Auto-printed beneath the corp cap table when the corp has notes** (see `references/cap-table.corp.md`
§Convertibles). Number formatting is `SKILL.md` §Formatting rules; Excel form in
`references/excel-output.md` §"Cap Table" tab.

**One row per round, then a Total row.**

## Row shape

```
{ kind: "note_block", id, name,
  principal:   [ { amount, currency } ],
  interest:    [ { amount, currency } ],
  cash_raised: [ { amount, currency } ] }
```

## Print — one table (chat)

| Column | Source | colType |
| --- | --- | --- |
| Round | `name` | text |
| Principal | `principal` | currency |
| Interest | `interest` | currency |
| Amount | `principal` + `interest`, added per currency | currency |
| Cash paid | `cash_raised` | currency |

**Total (bold):** each column added over the rows, per currency.

Money fields follow `references/rendering.ownership.md` (**Money**). Amount and the Total row add
entries per currency only, never across currencies. `id` is not shown.
