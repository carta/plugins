# Certificate-only fields

Certificate-specific reconciliation, resolution, and row-template detail. Read this file
only when `security_type = certificate` (resolved in [SKILL.md § Resolve
security_type](../SKILL.md#resolve-security_type)). The option-grant equivalents (vesting,
acceleration, exercise periods, document sets, board approval) are shared or option-grant-only
and stay in [SKILL.md § Shared resolution helpers](../SKILL.md#shared-resolution-helpers).

---

## Share-class reconciliation (certificate)

Use the `certificate_share_classes` section from the Phase 0.5 `issuance_init` payload — no
separate call (fall back to
`mcp__carta__fetch({"command": "cap_table:get:certificate_share_classes", "params": {"corporation_id": <id>}})`
only if init named it in `errors`).

Each result has `id`, `name`, `prefix`, `authorized`, `outstanding`, `available`
(server-computed — **never recompute client-side**, it accounts for warrants + the option
pool), `is_common`, and `dividend` (`"Non-cash"`/`"Cash"`/`null`). Match names
case-insensitively; capture `prefix` for the payload and `dividend` to drive the
[Dividend accrual start date resolution](#dividend-accrual-start-date-resolution). For
unmatched names, build one table (User-supplied / Suggested match / Confidence) and ask
**once**: `"Accept suggested mappings"` / `"Map manually"` / `"Skip unmatched rows"` —
never per-row.

**No class named or implied → default to the most recently created one.** The response
carries no creation timestamp, so `build_config.py` uses the **last** entry in `results` as
the proxy for "latest" (every corp's response observed so far returns classes in ascending
`id` order, which is ascending creation order). Pass `knowns.share_class_prefix` only when the
prompt actually named or implied a class — omitting it is how the script's own default
applies; don't compute "latest" yourself and pass it as if the user asked for it.

---

## Legend resolution (certificate)

Use the `legends` section from the Phase 0.5 `issuance_init` payload (fall back to
`cap_table:get:legends` only if init named it in `errors`). One legend → default silently;
multiple → `AskUserQuestion`, one
option per template. Stamp the chosen `id` as `legend_id`; **never send `legend` body** (the
server resolves it). **Also stamp the chosen legend's full body text onto the row as
`legend_body`** ([review-only field](#review-only-fields-certificate--never-sent-to-the-mutate)
— never sent to the mutate) — the review's "View legend" modal renders this field verbatim,
and the user is attesting to it, so a row that skips this stamp opens an empty modal.

---

## Dividend accrual start date resolution

Certificate only. Read the resolved share class's `dividend` field:

- `"Non-cash"` → `AskUserQuestion`: `"Use the issue date…"` / `"Use a different date"`
  (collect as `MM/DD/YYYY`). Stamp `dividend_accrual_start_date` on every row carrying that
  class. Skip the prompt if the user volunteered the date.
- `"Cash"` / `null` → do not prompt, do not include the field (the server rejects it).

---

## Rule 144 difference reason

Certificate only; only when `rule_144_date` ≠ `issue_date`. **Side panel**: collected inline —
`build_config.py` renders a reason `<select>` in the same block, shown the moment "Use a
different date" is picked (same enum as below), and the panel won't enable Review until it's
set. Read `rule_144_reason` off the submitted row and stamp it as
`rule_144_difference_reason` — no separate prompt needed. **Cowork path only** (no panel):
`AskUserQuestion`, one option per enum (label → value): "Has determined 144 date" →
`has_determined_144_date`; "Non-restricted 144" → `non_restricted_144`; "Relevance provision"
→ `relevance_provision`; "Affiliates" → `affiliates`; "Non-affiliates" → `non_affiliates`.

---

## Certificate row

Fill literally. Every slot must hold a value before review. `None`/empty → skill bug;
reapply the default, re-call the stakeholder lookup, or ask ([Hard rule
9](../SKILL.md#hard-rules)).

```python
{
    "name":                    <stakeholder.name>,                # always
    "email":                   <stakeholder.email>,               # always
    "stakeholder_id":          <stakeholder.id>,                  # always — bypasses dup detection
    "stakeholder_kind":        <stakeholder.kind | "INDIVIDUAL">, # always
    "issue_date_relationship": <stakeholder.event_relationship>,  # always
    "currency":                "USD",                             # always — US default
    "prefix":                  <share_class.prefix>,              # always — NOT share_class
    "quantity":                <user>,                            # always
    "law_firm_price":          <user>,                            # paid issuances; 0 only for LLC corps
    "board_approval_date":     <user, YYYY-MM-DD>,                # always
    "issue_date":              <user, YYYY-MM-DD>,                # always
    "rule_144_date":           <issue_date as MM/DD/YYYY>,        # US restricted (CharField — MM/DD/YYYY only)
    "legend_id":               <legend.id>,                       # US — NEVER body
    "exemption":               "Section 4(a)(2)",                 # US — default
    "dividend_accrual_start_date": <user or omit>,               # only when share class has non-cash dividends
    "rule_144_difference_reason": <user, only when rule_144_date != issue_date>,
    "notes":                   <user or omit>,                    # optional
    "vesting_template":        <template.id or omit>,             # opt-in — unlike grants, omit entirely on "No vesting"
    "vesting_start_date":      <issue_date as MM/DD/YYYY or omit>, # only when vesting_template is set (non-milestone)
    "acceleration_template":   <template.id or omit>,             # optional — only meaningful once vesting is set
    "prefix_number":           <user or omit>,                    # optional — server auto-numbers if omitted
    "cash_paid":                <user or omit>,                    # optional
    "debt_canceled":           <user or omit>,                    # optional
    "draft_pk":                <previous_save.draft_pk or omit>,  # retry only
}
```

### Review-only fields (certificate) — never sent to the mutate

Stamp this onto every resolved row alongside the row template above, for the review surface
to render — **display-only**, must **never** appear in the `issue_securities` / `save_drafts`
payload:

| Key | Value |
|---|---|
| `legend_body` | the resolved legend's full text ([Legend resolution](#legend-resolution-certificate)) — the review's "View legend" modal renders this verbatim; without it, the modal opens empty. `legend_id` is what's sent to the mutate; `legend_body` is what the user reads before attesting to it |
