# Option-grant-only fields

Option-grant-specific row template. Read this file only when `security_type = option_grant`
(resolved in [SKILL.md § Resolve security_type](../SKILL.md#resolve-security_type)). The
certificate equivalent lives in [certificate-fields.md](certificate-fields.md). Shared
resolution helpers used by both types (vesting, acceleration, exercise periods, document sets,
board approval) stay in [SKILL.md § Shared resolution
helpers](../SKILL.md#shared-resolution-helpers).

---

## Option-grant row

Fill literally. Every slot must hold a value before review. `None`/empty → skill bug;
reapply the default, re-call the stakeholder lookup, or ask ([Hard rule
9](../SKILL.md#hard-rules)).

```python
{
    "name":                    <stakeholder.name>,                # always
    "email":                   <stakeholder.email>,               # always
    "stakeholder_id":          <stakeholder.id>,                  # always
    "stakeholder_kind":        <stakeholder.kind | "INDIVIDUAL">, # always — the config panel's
                                                                   # Stakeholder-type toggle collects
                                                                   # this per row for grants too (real
                                                                   # Carta option grants can go to a
                                                                   # non-individual holder, same as
                                                                   # certificates); resolve it the same
                                                                   # way as the certificate row
                                                                   # (certificate-fields.md)
    "issue_date_relationship": <stakeholder.event_relationship>,  # always
    "so_type":                 <user/picklist>,                   # always
    "quantity":                <user>,                            # always
    "exercise_price":          <user or "0" for ZEPO>,            # always except ZEPO
    "currency":                <autofill per so_type>,            # always
    "needs_board_approval":    <bool>,                            # always — true=pending, false=approved
    "board_approval_date":     <user, YYYY-MM-DD>,                # omit when needs_board_approval=true
    "issue_date":              <user, YYYY-MM-DD>,                # always
    "vesting_template":        <template.id | null>,              # always — null only after explicit "No vesting"
    "vesting_start_date":      <issue_date as MM/DD/YYYY>,        # non-milestone template (CharField)
    "grant_expiration_date":   <issue_date + 10 years as MM/DD/YYYY>,  # always — silent default; CharField (MM/DD/YYYY only)
    "exemption":               <autofill per so_type>,            # US — default Section 4(a)(2)
    "document_set_id":         <doc_set.id>,                      # always
    "acceleration_template":   <template.id or omit>,             # optional — only meaningful once vesting is set
    "notes":                   <user or omit>,                    # optional
    "custom_label":            <user or omit>,                    # optional — server auto-generates ES-{n}; unique per corp
    "early_exercise":          <bool or omit>,                     # optional — rejected for ZEPO
    "auto_exercise_at_vest":   <bool or omit>,                     # optional
    "is_flexible_issue_date":  <bool or omit>,                     # optional
    "is_hmrc_notified":        <bool or omit>,                     # EMI only — cleared for other so_type
    "hmrc_notified":           <user, YYYY-MM-DD or MM/DD/YYYY, or omit>,  # EMI only
    "is_ato_notified":         <bool or omit>,                     # AU types only (Startup Concessions/Non-Concessional/ZEPO)
    "grant_reason":            <user or omit>,                    # optional — picklist (carta-web's own field-contract.md), not free-form
    "draft_pk":                <previous_save.draft_pk or omit>,  # retry only
}
```

`equity_plan_id` lives on the draft *set*, not the row — pass on the first mutate only.

### Review-only fields (option grant) — never sent to the mutate

Stamp these onto every resolved row alongside the row template above, for the review
surfaces to render (`issuance-review/SKILL.md`'s Plan / Exercise periods / Documents
columns) — they are **display-only** and must **never** appear in the `issue_securities` /
`save_drafts` payload:

| Key | Value |
|---|---|
| `plan_name` | the resolved option plan's `name` ([Option-plan reconciliation](../SKILL.md#option-plan-reconciliation-option-grant)) |
| `document_set_label` | the resolved document set's `name` ([Document-set resolution](#resolution-helpers-option-grant)) |
| `exercise_periods_text` | one line summarizing the plan's six count+period pairs, tagged `(inherited from <plan name>)` ([Exercise-periods resolution](#resolution-helpers-option-grant)) |

---

## Resolution helpers (option grant)

Option-grant-only resolution helpers. Vesting and Acceleration resolution are shared between
both security types (different default posture per type) and stay in [SKILL.md § Shared
resolution helpers](../SKILL.md#shared-resolution-helpers).

### Exercise-periods resolution

**Display only — never sent.** Render the plan's six count+period pairs as one line in the
review, tagged `(inherited from <plan name>)`. Never emit the termination/exercise fields.
Stamp this same line onto every row as `exercise_periods_text` ([Review-only
fields](#review-only-fields-option-grant--never-sent-to-the-mutate)) so the review surfaces
render it without recomputing it.

### Document-set resolution

The zero-templates stop lives in [SKILL.md § Account-setup gate (option grant
only)](../SKILL.md#account-setup-gate-option-grant-only), which runs on **both** adapters in
Phase 0.5 immediately after `issuance_init` returns, before any surface is built, reading
`document_sets.count` under its own section name. This helper, like every section in [SKILL.md §
Shared resolution helpers](../SKILL.md#shared-resolution-helpers), is a fallback that runs only
when the collection surface didn't already resolve the field — never pre-emptively, on either
path. By the time it runs the gate has passed, so the list holds at least one entry: **don't
re-check the count here, and don't re-issue `cap_table:get:document_sets` for data the gate
already holds.** Stopping over any *other* section's count is the real incident this file used
to warn about — a run read `acceleration_templates`' `count: 0` as this section's and aborted a
valid issuance when `document_sets` had returned `count: 1`
([incidents.md § Reading server data wrong](incidents.md#reading-server-data-wrong)).

Use the `document_sets` list the gate validated — init's section, or the gate's fallback fetch
when init named the section in `errors`. One → default silently, stamp `document_set_id`, tag
`(default — only template)`. Multiple → `AskUserQuestion` (one per set, last `"Cancel"`).
**Never emit** `form_of_option_doc` / `form_of_exercise_doc` / `equity_incentive_plan_doc` /
`attachments_uuid` — the server populates them from `document_set_id`. Also stamp the chosen
set's `name` onto every row as `document_set_label` ([Review-only
fields](#review-only-fields-option-grant--never-sent-to-the-mutate)) — never sent to the mutate.

### Board approval resolution

Runs before the issue-date prompt unless the user already volunteered a board approval date
(then `needs_board_approval = false`, use the date, skip the prompt). `AskUserQuestion`:

| Label | `needs_board_approval` | `board_approval_date` |
|---|---|---|
| `"Yes — board approved today"` | `false` | today (`YYYY-MM-DD`) — **not** `issue_date` |
| `"Yes — approved on a different date"` | `false` | follow-up; `YYYY-MM-DD` or `MM/DD/YYYY` |
| `"No — pending board approval"` | `true` | **omit from the row entirely** (empty string errors; a date contradicts pending) |

Render the review's Board approval cell as `Pending — needs board approval` when `true`.
