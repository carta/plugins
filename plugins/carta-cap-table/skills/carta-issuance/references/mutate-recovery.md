# Mutate recovery

What to do when a mutate comes back short-circuited. Read this when
[Run the issue securities mutate](../SKILL.md#run-the-issue-securities-mutate)'s response
table sends you here — not on a clean success.

Two rules govern every branch below:

- **Surface server messages verbatim.** The server is the source of truth; don't mirror or
  paraphrase its validation ([Hard rule 5](../SKILL.md#hard-rules)).
- **Every re-call carries `draft_set_id` and each row's `draft_pk`** ([Hard rule
  4](../SKILL.md#hard-rules)). Omitting `draft_set_id` mints a second draft set; omitting
  `draft_pk` inserts a new row instead of updating.
- **Send only the rows you actually changed.** Recovery is the case where a `drafts` payload is
  right — you are editing values, so they must go back. Rows you did not touch are already
  correct on the server; resending them re-opens the divergence [Hard rule
  11](../SKILL.md#hard-rules) exists to close. Once the set is clean, the issue re-call needs no
  rows at all.

---

## Error recovery

Find the missing value in this order, and stop at the first that applies:

1. The documented default from the row template — tag it `(default — applied after server
   flagged it missing)`.
2. Re-run the stakeholder lookup with `detail=full` and re-stamp `issue_date_relationship`,
   `email`, `stakeholder_kind`, `stakeholder_id` from the record.
3. `AskUserQuestion` for that field.

Never scrape a value from another grant or certificate ([Hard rule
8](../SKILL.md#hard-rules)). Then re-call `issue_securities` with the same `draft_set_id` and
each `draft_pk`.

**Canonical rewrite.** The server's *"Email may be from the company's domain"* becomes:
*"Heads-up: this email uses the company's domain. Review the Carta best practices for
stakeholder email addresses before continuing."*

---

## Duplicate resolution

There is no Carta UI for this — it only happens here.

`AskUserQuestion`: `"Map all to existing stakeholders"` / `"Create all as new stakeholders"` /
`"Resolve individually"`. Batch the answer into **one** call:

```
mcp__carta__mutate({"command": "cap_table:mutate:resolve_duplicate_stakeholder", "params": {
  "security_type": "<certificate|option_grant>", "draft_set_id": <draft_set_id>,
  "drafts": [{"id": <draft_pk>, "stakeholder_id": <stakeholder_id>},   # merge into existing
             {"id": <draft_pk>}]}})                                    # create as new
```

Then re-call `issue_securities`.

---

## Option-grant specific errors

| Server message | Action |
|---|---|
| *"Fair market value is required for …"* | Surface verbatim. `AskUserQuestion`: `"Update FMV in Carta UI"` / `"Cancel"`. This skill cannot update FMV. Point a non-US corp (`knowns.jurisdiction` ≠ `US`, or an EMI/CSOP `fmv_source`) at the international valuations dashboard, `/corporations/<CORP_ID>/valuations/international/` — the 409A ledger is the wrong place for a company that prices from an EMI or CSOP valuation. |
| Custom label clash | Re-render the row; ask for a new label or clear it (the server auto-generates one). Re-call with `draft_pk`. |
| *"Vesting start date is required"* | Collect `MM/DD/YYYY`, re-call with `draft_pk`. |
| *"Custom vesting must sum to total quantity"* | Route to the app: *"Custom vesting was set outside the skill. Finish in the Drafts UI."* |

Quantity and option-pool overflows are surfaced verbatim, like every other server message.

---

## Atomic issue failure

Errors are keyed at three levels: `errors.drafts` (per-row), `errors.corporation`
(issuer-level — authorized-share or option-pool overflow), and `errors.issuance` (global).

Surface them verbatim, with the rollback note:

> *"Issue failed for N of M rows. The successful rows did **not** issue — Carta rolls back the
> entire batch."*

For a pool overflow, add:

> *"The \<plan name\> doesn't have enough available shares. Reduce a row's quantity or expand
> the pool in the Carta app."*

If the error names required fields, drop into [Error recovery](#error-recovery).

---

## 403

> *"This account can draft but not issue. Have someone with Full access on \<company\> run the
> issue step."*
