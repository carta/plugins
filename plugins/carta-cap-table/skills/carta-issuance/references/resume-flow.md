# Resume flow detail

Full mechanics for [SKILL.md § Resume an existing draft
set](../SKILL.md#resume-an-existing-draft-set) and [SKILL.md § Cleanup unexpected draft
rows](../SKILL.md#cleanup-unexpected-draft-rows). Read this file when the user asks to resume
an in-progress draft set (by id or name), or when `load_drafts` returns more rows than the
skill is tracking.

---

## Resume an existing draft set

Draft sets are scoped by `security_type` — always pass it.

- **User gave id** → `cap_table:get:load_drafts` (`corporation_id`, `security_type`, `draft_set_id`).
- **User gave name** → `cap_table:list:draft_sets`, match case-insensitively. One match →
  proceed; multiple → present a table + `AskUserQuestion`; zero → fall back to fresh input.

Take returned rows as the working set; jump to the [Phase 2
review](../SKILL.md#phase-2--render-the-review-surface-mandatory-pre-save-gate). The set's
`security_type` is locked once created — never ask to change it on resume. If `load_drafts`
returns more rows than you're tracking, see [Cleanup unexpected draft rows](#cleanup-unexpected-draft-rows).

**Option grant — re-derive the review-only display fields.** `load_drafts` returns
`equity_plan_id` (set-level) and `document_set_id` (per row) but never `plan_name` /
`document_set_label` / `exercise_periods_text` — those were never persisted server-side
([Review-only fields](option-grant-fields.md#review-only-fields-option-grant--never-sent-to-the-mutate)).
Before Phase 2, resolve the plan and document-set names (`cap_table:get:option_plans`,
`cap_table:get:document_sets`, match by id) and re-stamp all three onto every row, the same
as a fresh Phase 1 pass — otherwise the Plan / Documents / Exercise periods columns render
`—` for a resumed set even though the data is fully resolvable.

---

## Cleanup unexpected draft rows

Resume, or a batch where a stakeholder block was removed during a
[Phase 1.5](save-validate-flow.md) validation-error retry (that dropped `row_key`'s
`draft_pk`, per [Draft-state bookkeeping](save-validate-flow.md#draft-state-bookkeeping), was
deliberately left alone rather than deleted there) — no-op otherwise. When `load_drafts`
returns more rows than the skill is tracking: group by per-flow key (cert: `name, email,
stakeholder_id, prefix, quantity, issue_date`; grant: `name, email, stakeholder_id, so_type,
quantity, issue_date`), keep the most-populated row per group (rest are **duplicates**), and
flag any row whose `draft_pk` isn't in your tracked set as an **unrelated extra**. Show two
sub-tables, then `AskUserQuestion`: `"Delete N duplicates and continue"` (drops dedup losers,
keeps unrelated extras) / `"Keep all rows and issue as-is"` / `"Cancel issuance"`. On delete,
send `{draft_pk: <pk>, delete: true}` rows in one `save_drafts` call. Re-load and confirm the
count before the review.
