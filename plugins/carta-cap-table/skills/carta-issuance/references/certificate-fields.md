# Certificate-only fields

Read this file only when `security_type = certificate`, resolved in [SKILL.md § Resolve
security_type](../SKILL.md#resolve-security_type). Vesting and acceleration are shared with the
other two types and stay in [engine.md § Shared resolution
helpers](engine.md#shared-resolution-helpers).

---

## Share-class reconciliation (certificate)

Use the `certificate_share_classes` section from the Phase 0.5 `issuance_init` payload — no
separate call (fall back to
`mcp__carta__call_tool({"name": "cap_table__get__certificate_share_classes", "arguments": {"corporation_id": <id>}})`
only if init named it in `errors`).

Each result has `id`, `name`, `prefix`, `authorized`, `outstanding`, `available`
(server-computed — **never recompute client-side**, it accounts for warrants + the option
pool), `is_common`, and `dividend` (`"Non-cash"`/`"Cash"`/`null`). Match names
case-insensitively; capture `prefix` for the payload and `dividend` to drive the
[Dividend accrual start date resolution](#dividend-accrual-start-date-resolution). For
unmatched names, build one table (User-supplied / Suggested match / Confidence) and ask
**once**: `"Accept suggested mappings"` / `"Map manually"` / `"Skip unmatched rows"` —
never per-row.

**No class named or implied → the builders pre-select a class only when the corp has
exactly one.** With two or more the control renders **required and unselected**, and
`missingFields()` holds **Review** on `a share class` until a human picks. Nothing is ranked:
which class a holder lands in sets their liquidation preference, their price and their
economics, so a ranked default hides the decision the field exists to capture — and the
response order is not dependable anyway. Metal corporation 7 returns its eight classes in
neither `id` nor `created` order, so the last entry there is `PC` (Series C, created 2016)
while the newest class is `PSB` (2019); "the last one" was never reliably "the latest one".

Pass `knowns.share_class_prefix` only when the prompt actually named or implied a class.
Omitting it is what leaves the control unselected; never pick a class yourself and pass it as
if the user had asked for it.

**A PIU follows the identical rule** under the name "unit class" — see [piu-fields.md §
Unit-class reconciliation](piu-fields.md#unit-class-reconciliation).

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

Fill literally, under [engine.md § Row templates](engine.md#row-templates)'s rule: every slot
holds a value before review, and a `None` or empty is a skill bug.

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

Stamp this onto every resolved row for the review surface to render:

| Key | Value |
|---|---|
| `legend_body` | the resolved legend's full text ([Legend resolution](#legend-resolution-certificate)) — the review's "View legend" modal renders this verbatim; without it, the modal opens empty. `legend_id` is what's sent to the mutate; `legend_body` is what the user reads before attesting to it |
