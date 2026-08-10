# Submit → row mapping

How each row of the config submission becomes a resolved row. Read this once, at the end of
[Phase 0.5](../SKILL.md#phase-05--configure-the-issuance), when the collection surface has
returned its `rows`.

Both surfaces deliver the same payload — Cowork from the form's `sendPrompt()`
([cowork-adapter.md § Submit contract](cowork-adapter.md#submit-contract)), Code from
`cat "$OUT_DIR/<CORP_ID>_action_request.json"`. Each carries `security_type` and `rows`, one
entry per stakeholder, **each already carrying its own full field set** from that person's
block. There are no batch-wide scalars left to stamp: every row decided its own terms on the
surface, so a single batch can genuinely mix `so_type`s and currencies.

Apply the mapping below to **each row individually**. `relationship` may be `""` when the user
left it blank — [Phase 1](../SKILL.md#phase-1--resolve-each-row--reconcile-share-classes) only
honors it for stakeholders with no roster match.

**Omission rule (both types):** an empty string, `false`, or `null` on a pass-through field
means **omit the key entirely** from the payload — see [Row templates](../SKILL.md#row-templates).

---

## Option grant, per row

| Surface field | Becomes | Notes |
|---|---|---|
| `option_type` | `so_type` | then apply that row's `so_type` autofill for `currency` / `exemption` ([payload-reference.md § so_type auto-fill rules](payload-reference.md#so_type-auto-fill-rules)) |
| `exercise_price` | `exercise_price` | ZEPO hard-sets `"0"` |
| `issue_date` | `issue_date` | |
| `board_approval` + `board_approval_date` | `needs_board_approval` | `pending` → `true`, else `false` |
| `vesting_template_id` | `vesting_template` | `null` on **No vesting** — warn, atypical for a grant |
| `vesting_start_date` | `vesting_start_date` | reformat to `MM/DD/YYYY` |
| `document_set_id` | `document_set_id` | |
| `stakeholder_kind` | `stakeholder_kind` | Phase 1 decides whether this or the roster's own value wins |

**Pass through unchanged:** `acceleration_template` (the surface sends `null` on **No
acceleration**), `notes`, `custom_label`, `early_exercise`, `auto_exercise_at_vest`,
`is_flexible_issue_date`, `grant_reason`.

`is_hmrc_notified` / `hmrc_notified` and `is_ato_notified` are already conditionally absent
from the row unless the surface's `so_type` matched (EMI, and the three AU types,
respectively), so no additional gating is needed here.

---

## Certificate, per row

| Surface field | Becomes | Notes |
|---|---|---|
| `share_class_prefix` | `prefix` | |
| `price_per_share` | `law_firm_price` | |
| `issue_date` | `issue_date` | |
| `board_approval` + `board_approval_date` | `needs_board_approval` | certs need a date — there is no `pending` |
| `legend_id` | `legend_id` | never the body — but **do** stamp the resolved legend's body as `legend_body`, a [review-only field](certificate-fields.md#review-only-fields-certificate--never-sent-to-the-mutate) |
| `rule_144_mode` / `rule_144_date` | `rule_144_date` | `issue_date` mode → set it to `issue_date` in `MM/DD/YYYY`; `other` → reformat, and read `rule_144_reason` off the row (already collected inline) and stamp it as `rule_144_difference_reason` — see [Rule 144 difference reason](certificate-fields.md#rule-144-difference-reason) |
| `vesting_template_id` | `vesting_template` | `null` on **No vesting** — this is the certificate default, so unlike a grant, do **not** warn |
| `vesting_start_date` | `vesting_start_date` | reformat to `MM/DD/YYYY`, only when a real template is set |

**Defaults:** `exemption = "Section 4(a)(2)"`; `currency` per the surface.

**Pass through unchanged:** `acceleration_template` (the surface sends `null` on **No
acceleration**), `notes`, `prefix_number`, `cash_paid`, `debt_canceled`.

Finally, drive the [Dividend accrual start date
resolution](certificate-fields.md#dividend-accrual-start-date-resolution) from each class's
`dividend` field.
