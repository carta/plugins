# Rendering — convertible note blocks (`note_blocks` shape)

Column/row spec for `cap_table:get:note_blocks` — convertibles grouped by round (principal +
accrued interest per round). **Auto-printed beneath the corp cap table when the corp has notes**
(see `references/cap-table.corp.md` §Convertibles). Number formatting is `SKILL.md` §Formatting
rules; Excel form in `references/excel-output.md` §"Cap Table" tab.

**Render straight through** — one row per round, then a Total row. Money → currency; null → `—`.

## Response shape

```
{ note_blocks: [ { id, name, principal, interest, amount, cash_paid } ],
  totals: { total_principal, total_interest, total_amount, total_cash_raised } }
```

## Print — one table (chat)

| Column | Source | colType |
| --- | --- | --- |
| Round | `note_blocks[].name` | text |
| Principal | `note_blocks[].principal` | currency |
| Interest | `note_blocks[].interest` | currency |
| Amount | `note_blocks[].amount` | currency |
| Cash paid | `note_blocks[].cash_paid` | currency |

**Total (bold), from `totals`:** Principal `total_principal`, Interest `total_interest`,
Amount `total_amount`, Cash paid `total_cash_raised`.

`id` is not shown. `amount` = principal + accrued interest (pre-summed upstream — don't recompute).
