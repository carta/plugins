# Resume flow detail

Full mechanics for [engine.md § Resume an existing draft
set](engine.md#resume-an-existing-draft-set) and [issue-and-close.md § Cleanup unexpected draft
rows](issue-and-close.md#cleanup-unexpected-draft-rows). Read this file when the user asks to resume
an in-progress draft set (by id or name), or when `load_drafts` returns more rows than the
skill is tracking.

---

## Resume an existing draft set

Draft sets are scoped by `security_type` — always pass it.

- **User gave id** → `cap_table:get:load_drafts` — wire `cap_table__get__load_drafts` —
  with `corporation_id`, `security_type`, `draft_set_id`.
- **User gave name** → `cap_table:list:draft_sets` (`cap_table__list__draft_sets`), match
  case-insensitively. One match →
  proceed; multiple → present a table + `AskUserQuestion`; zero → fall back to fresh input.

Take returned rows as the working set. The set's `security_type` is locked once created —
never ask to change it on resume. If `load_drafts` returns more rows than you're tracking,
see [Cleanup unexpected draft rows](#cleanup-unexpected-draft-rows).

**Where the working set goes depends on the surface.**

| Surface | What to do with the rows |
|---|---|
| **artifact** | Seed `draft_set_id`, plus `rows` (each with its `draft_pk`) as the fallback, then build and publish as usual — [SKILL.md § 2](../SKILL.md#2-build-the-page). The page reads the set's rows and terms back itself, and edits and re-saves that same set |
| **chat** | Jump to the [Phase 2 review](issue-and-close.md#phase-2--the-review-gate) |

**Keep the `draft_set_id` you resumed from.** The rows are already on the server, so unless the
user edits them, Phase 3 issues with that id and no `drafts` payload
([hard rule 6](../SKILL.md#hard-rules)).

**Option grant — re-derive the review-only display fields.** `load_drafts` returns
`equity_plan_id` (set-level) and `document_set_id` (per row) but never `plan_name` /
`document_set_label` / `exercise_periods_text` — those were never persisted server-side
([Review-only fields](option-grant-fields.md#review-only-fields-option-grant--never-sent-to-the-mutate)).
Before Phase 2, resolve the plan and document-set names (`cap_table:get:option_plans` →
`cap_table__get__option_plans`, `cap_table:get:document_sets` →
`cap_table__get__document_sets`, match by id) and re-stamp all three onto every row, the same
as a fresh Phase 1 pass — otherwise the Plan / Documents / Exercise periods columns render
`—` for a resumed set even though the data is fully resolvable.

---

**PIU — re-derive the review-only labels too.** `load_drafts` returns `prefix`,
`option_plan` and `document_set_id`, but none of `unit_class_label` / `equity_plan_label` /
`document_set_label` / `threshold_noun`
([Review-only fields](piu-fields.md#review-only-fields-piu--never-sent-to-the-mutate)).
Resolve each id back to its name before Phase 2, and re-read the issuer's threshold noun from
`issuance_init`'s `draft_set_init` **section** — there is no standalone command for it, so it
only arrives that way. Otherwise the review labels the threshold columns generically and shows
a dash where the source of the units belongs.

## Cleanup unexpected draft rows

Resume, or a batch where a recipient was dropped during a
[Phase 1.5](save-validate-flow.md) validation-error retry (that `row_key`'s `draft_pk`, per
[Draft-state bookkeeping](save-validate-flow.md#draft-state-bookkeeping), was deliberately left
alone rather than deleted there) — no-op otherwise. When `load_drafts`
returns more rows than the skill is tracking: group by per-flow key (cert: `name, email,
stakeholder_id, prefix, quantity, issue_date`; grant: `name, email, stakeholder_id, so_type,
quantity, issue_date`; PIU: `name, email, stakeholder_id, prefix, option_plan, quantity,
issue_date` — one batch can legitimately give the same person the same quantity out of two
different unit classes or pools, so the source of the units has to be in the key or those rows
read as duplicates), keep the most-populated row per group (rest are **duplicates**), and
flag any row whose `draft_pk` isn't in your tracked set as an **unrelated extra**. Show two
sub-tables, then `AskUserQuestion`: `"Delete N duplicates and continue"` (drops dedup losers,
keeps unrelated extras) / `"Keep all rows and issue as-is"` / `"Cancel issuance"`. On delete,
send `{draft_pk: <pk>, delete: true}` rows in one `save_drafts` call. Re-load and confirm the
count before the review.
