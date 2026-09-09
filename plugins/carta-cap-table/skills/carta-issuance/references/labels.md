# Customer-facing labels

The exception list for the mechanical humanization rule in
[SKILL.md § Voice & defaults](../SKILL.md#voice--defaults). Read it when rendering a review, a
confirmation, or a server error back to the user.

The default rule handles most fields: `_` → space, Title Case. These are the ones where that
produces the wrong word.

| Payload key (snake / camel) | Customer-facing label |
|---|---|
| `issue_date_relationship` | Relationship |
| `stakeholder_kind` | Stakeholder type |
| `stakeholder_id` | *(omit — refer to the person by name)* |
| `legend_id` | Build legend (cert) / Exercise legend (grant) |
| `document_set_id` | Documents |
| `prefix_number` | Certificate number |
| `so_type` | Option type |
| `vesting_template` | Vesting schedule |
| `acceleration_template` | Acceleration terms |
| `grant_expiration_date` | Grant expiration |
| `rule_144_date` | Rule 144 date |
| `needs_board_approval` | Board approval |
| `law_firm_price` | Price per share |
| `prefix` | Share class — **but "Unit class" on a PIU** (the one per-type label here) |
| `prefix_number` (PIU) | Security number |
| `board_approval_date` | Board approval |
| `option_plan` | Equity plan |
| `threshold_value` | Threshold value — or the issuer's own noun, e.g. "Hurdle value" |
| `threshold_value_type` | Threshold value type |
| `corresponding_interest` | Corresponding interest |
| `cash_paid` (PIU) | Consideration price |

`quantity`, `exercise_price`, `issue_date`, `currency`, `exemption`, `custom_label`, and
`notes` humanize correctly under the default rule and are listed here only so you don't go
looking for them.

Document sets, vesting schedules, option plans, legends, unit classes, draft sets, and
stakeholders are always referred to **by name**. Their ids are an internal payload concern —
including a PIU's `option_plan`, which carries a plan pk despite being a text field.

This table cannot be exhaustive against every field `validate_drafts` / `issue_securities`
might name. For anything not listed, apply the mechanical rule — never surface the raw
`snake_case` key verbatim, including when echoing server `banner_errors` back.
