# Resume a draft set

Read this when the user asks to resume a saved draft set, by id or name, of any of the nine
types, or when the files list fewer rows than a loaded draft set holds. The resumed set enters
[the run](companion-surface.md) like a set this run saved.

---

## Resume an existing draft set

Draft sets are scoped by `security_type` — always pass it. The set's `security_type` is locked
once created: never ask to change it.

1. **Start the run on it:** [companion-surface.md § 3](companion-surface.md#3-start)'s
   `issuance_init` with the set's `security_type`, and the type's account gate.
2. **Pick the set up** as
   [companion-surface.md § An existing draft set](companion-surface.md#an-existing-draft-set)
   says: find it, load it, read it, show the page once and ask once.

The rows are already on the server, so unless the user edits them, the issue reads them by
`draft_set_id`, with no `drafts` payload ([hard rule 6](../SKILL.md#hard-rules)).

## Cleanup unexpected draft rows

On resume, when the files list fewer rows than the loaded set holds: group by per-flow key
(cert: `name, email, stakeholder_id, prefix, quantity, issue_date`; grant: `name, email,
stakeholder_id, so_type, quantity, issue_date`; PIU: `name, email, stakeholder_id, prefix,
option_plan, quantity, issue_date` — one batch can legitimately give the same person the same
quantity out of two different unit classes or pools, so the source of the units has to be in
the key or those rows read as duplicates; convertible note: `name, email, stakeholder_id,
dollar_amount, currency, issue_date`; warrant: `name, email, stakeholder_id, prefix, quantity,
issue_date`; CBU: `name, email, stakeholder_id, option_plan, share_class, quantity, issue_date`;
RSA, RSU and SAR: `name, email, stakeholder_id, quantity, issue_date`), keep the most-populated row per group (rest are **duplicates**), and
flag any row whose `draft_pk` isn't in your tracked set as an **unrelated extra**. Show two
sub-tables, then `AskUserQuestion`: `"Delete N duplicates and continue"` (drops dedup losers,
keeps unrelated extras) / `"Keep all rows and issue as-is"` / `"Cancel issuance"`. On delete,
send `{draft_pk: <pk>, delete: true}` rows in one `save_drafts` call. Re-load and confirm the
count before the review.
