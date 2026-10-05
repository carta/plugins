# Rendering — phantom units (`phantom` shape)

Column/row spec for `cap_table:get:phantom` — phantom units issued, issued (not canceled), and
outstanding. **Auto-printed beneath the corp cap table when the corp has phantom units** (see
`references/cap-table.corp.md` §Phantom units). Number formatting is `SKILL.md` §Formatting rules;
Excel form in `references/excel-output.md` §"Cap Table" tab.

**Render straight through** — one row per `rows[]` entry, then a Total row. Quantities → two decimals
with thousands separators (`1,464,983.50`); null → `—`.

## Response shape

```
{ rows: [ { share_class_label, equity_plan_label, issued, issued_not_canceled, outstanding } ],
  total: { issued, issued_not_canceled, outstanding } }
```

## Caption (one line above the table)

`Non-dilutive — not included in outstanding, fully diluted, or ownership %.`

## Print — one table (chat)

| Column | Source | colType |
| --- | --- | --- |
| Phantom | `rows[].share_class_label` | text |
| Issued | `rows[].issued` | qty2 |
| Issued (not canceled) | `rows[].issued_not_canceled` | qty2 |
| Outstanding | `rows[].outstanding` | qty2 |

**Total (bold), from `total`:** Issued `issued`, Issued (not canceled) `issued_not_canceled`,
Outstanding `outstanding`.

`equity_plan_label` is not shown. No ownership column — never compute a %.
