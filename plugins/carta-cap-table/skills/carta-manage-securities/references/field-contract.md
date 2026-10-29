# Field contract

Carta's bootstrap (`cap_table__get__security_change_bootstrap`) gives the form for the securities
you change: `sections.form`, one entry per field. It is the source of truth. This file says how to
read it, the formats the edit preview takes, and the rules users trip on.

## Form fields

| Key | Use |
|---|---|
| `name` | Send the new value under this key in the preview's `fields`. |
| `label` | Show this to the user. |
| `eligible` | Offer only fields with `eligible: true`. |
| `why_not` | Why the field cannot change ([SKILL.md](../SKILL.md#hard-rules) Hard rule 3). |
| `current` | The value now: `value` when `same`, else `by_security`. Null for free text and personal data. |
| `options` | The values of a choice field. Show each `label`, send its `id`. |
| `options_complete` | False when the field has more than 25 options: send the record id. |
| `optional` | The field can be empty. Not a reason to hide it. |

`why_not.code` is `locked`, `accepted`, `single_security_only` or `disabled` (from the web form),
or `staff_only`, `documents` or `out_of_scope` (the agent's limits).

## Formats

- **Dates:** as in [SKILL.md § Flow](../SKILL.md#flow) step 3.
- **Numbers:** a decimal string with no commas or currency symbol (`"10001"`, `"10.50"`).
- **Legend:** a JSON list of its option ids, e.g. `"[12]"`.

## Reason

`reason` is one of two exact strings. Both go to the security's history.

- `Clerical error`: a typo, format or data-entry mistake. The record was wrong from the start.
- `Amendment`: a real change to the terms.

## Choice values

Values come from the field's `options` in the bootstrap, for example `rule_144_difference_reason`
and `grant_reason`. Never send a value that is not one of its options, unless `options_complete`
is false (see the table above).

## Rules users trip on

- **Single-security fields.** `quantity`, `option_plan`, `custom_label` and `prefix_label` change
  on one security at a time. With 2+ securities the bootstrap marks them `single_security_only`.
- **Post-termination exercise periods** are not changed by this skill. Send the user to Carta.
- **Documents** are not edited here (`why_not.code: documents`). Send the user to Carta.
- **`dividend_accrual_start_date`** is share-class gated: Carta rejects a value that does not fit
  a certificate's share class. Quote the check.
- **`returned_invested_capital`** shows only for an LLC with that setting on.
- **One change is atomic.** When a check fails for one security, none of them change.
