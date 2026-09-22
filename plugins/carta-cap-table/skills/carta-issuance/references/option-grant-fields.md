# Option-grant-only fields

Read this file only when `security_type = option_grant`, resolved in [SKILL.md § Resolve
security_type](../SKILL.md#resolve-security_type). Vesting and acceleration are shared with the
other two types and stay in [engine.md § Shared resolution
helpers](engine.md#shared-resolution-helpers).

---

## Option-grant row

Fill literally, under [engine.md § Row templates](engine.md#row-templates)'s rule: every slot
holds a value before review, and a `None` or empty is a skill bug.

```python
{
    "name":                    <stakeholder.name>,                # always
    "email":                   <stakeholder.email>,               # always
    "stakeholder_id":          <stakeholder.id>,                  # always
    "stakeholder_kind":        <stakeholder.kind | "INDIVIDUAL">, # always — collected per row for
                                                                   # grants too (real Carta option
                                                                   # grants can go to a non-individual
                                                                   # holder, same as certificates);
                                                                   # resolve it the same way as the
                                                                   # certificate row
                                                                   # (certificate-fields.md)
    "issue_date_relationship": <stakeholder.event_relationship>,  # always
    "so_type":                 <user/picklist>,                   # always
    "quantity":                <user>,                            # always
    "exercise_price":          <user or "0" for ZEPO>,            # always except ZEPO
    "currency":                <autofill per so_type>,            # always
    "needs_board_approval":    <bool>,                            # always — true=pending, false=approved
    "board_approval_date":     <user, YYYY-MM-DD>,                # omit when needs_board_approval=true
    "issue_date":              <user, YYYY-MM-DD>,                # always — OMIT when needs_board_approval is true
    "vesting_template":        <template.id | null>,              # always — null only after explicit "No vesting"
    "vesting_start_date":      <issue_date as MM/DD/YYYY>,        # non-milestone template (CharField)
    # A pending grant has no issue date: the server refuses one before the board approves.
    "grant_expiration_date":   <plan term from issue_date, capped at the plan's own expiration, as MM/DD/YYYY>,  # always — silent default; CharField (MM/DD/YYYY only)
    "exemption":               <autofill per so_type, or omit>, # US — omit; server defaults to Rule 701
    "document_set_id":         <doc_set.id>,                      # always
    "acceleration_template":   <template.id or omit>,             # optional — only meaningful once vesting is set
    "notes":                   <user or omit>,                    # optional
    "custom_label":            <user or omit>,                    # optional — server auto-generates ES-{n}; unique per corp
    "early_exercise":          <bool or omit>,                     # optional — rejected for ZEPO
    "auto_exercise_at_vest":   <bool or omit>,                     # optional
    "is_flexible_issue_date":  <bool or omit>,                     # optional
    "is_hmrc_notified":        <bool or omit>,                     # EMI only — cleared for other so_type
    "hmrc_notified":           <user, YYYY-MM-DD or MM/DD/YYYY, or omit>,  # EMI only
    "employment_related":      <bool>,                             # REQUIRED for Unapproved on UK issuers — ask up
                                                                   # front, never leave to validation; omit otherwise
    "is_ato_notified":         <bool or omit>,                     # AU types only (Startup Concessions/Non-Concessional/ZEPO)
    "grant_reason":            <user or omit>,                    # optional — picklist (carta-web's own field-contract.md), not free-form
    "draft_pk":                <previous_save.draft_pk or omit>,  # retry only
}
```

`equity_plan_id` lives on the draft *set*, not the row — pass on the first mutate only.

### Review-only fields (option grant) — never sent to the mutate

Stamp these onto every resolved row for the review surfaces to render:

| Key | Value |
|---|---|
| `plan_name` | the resolved option plan's `name` ([Option-plan reconciliation](engine.md#option-plan-reconciliation-option-grant)) |
| `document_set_label` | the resolved document set's `name` ([Document-set resolution](#resolution-helpers-option-grant)) |
| `exercise_periods_text` | one line summarizing the plan's six count+period pairs, tagged `(inherited from <plan name>)` ([Exercise-periods resolution](#resolution-helpers-option-grant)) |

---

## Resolution helpers (option grant)

### Exercise-periods resolution

**Display only — never sent.** Render the plan's six count+period pairs as one line in the
review, tagged `(inherited from <plan name>)`. Never emit the termination/exercise fields.
Stamp this same line onto every row as `exercise_periods_text` ([Review-only
fields](#review-only-fields-option-grant--never-sent-to-the-mutate)) so the review surfaces
render it without recomputing it.

### Document-set resolution

A fallback, like every [shared resolution helper](engine.md#shared-resolution-helpers) — it
runs only when the collection surface didn't already resolve the field, never pre-emptively,
on either adapter. The zero-templates stop already ran in Phase 0.5's [account-setup
gate](engine.md#account-setup-gate-option-grant-and-piu), so by now the list holds at least
one entry: **don't re-check the count here, and don't re-issue `cap_table:get:document_sets`
for data the gate already holds.** Reading some *other* section's zero as this one's is the
incident behind that gate ([incidents.md § Reading server data
wrong](incidents.md#reading-server-data-wrong)).

Use the `document_sets` list the gate validated — init's section, or the gate's fallback fetch
when init named the section in `errors`. One → default silently, stamp `document_set_id`, tag
`(default — only template)`. Multiple → `AskUserQuestion` (one per set, last `"Cancel"`).
**Never emit** `form_of_option_doc` / `form_of_exercise_doc` / `equity_incentive_plan_doc` /
`attachments_uuid` — the server populates them from `document_set_id`. Also stamp the chosen
set's `name` onto every row as `document_set_label` ([Review-only
fields](#review-only-fields-option-grant--never-sent-to-the-mutate)).

### Board approval resolution

Runs before the issue-date prompt unless the user already volunteered a board approval date
(then `needs_board_approval = false`, use the date, skip the prompt). `AskUserQuestion`:

| Label | `needs_board_approval` | `board_approval_date` |
|---|---|---|
| `"Yes — board approved today"` | `false` | today (`YYYY-MM-DD`) — **not** `issue_date` |
| `"Yes — approved on a different date"` | `false` | follow-up; `YYYY-MM-DD` or `MM/DD/YYYY` |
| `"No — pending board approval"` | `true` | **omit from the row entirely** (empty string errors; a date contradicts pending) |

Render the review's Board approval cell as `Pending — needs board approval` when `true`.
