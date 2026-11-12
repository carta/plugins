# Mutate recovery

What to do when a save, a validation, the issue preview or the issue job comes back refused.
Read this when [issue-and-close.md](issue-and-close.md) or
[save-validate-flow.md](save-validate-flow.md) sends you here — not on a clean success.

Two rules govern every branch below:

- **Surface server messages verbatim.** The server is the source of truth; don't mirror or
  paraphrase its validation ([hard rule 4](../SKILL.md#hard-rules)).
- **Every re-call carries `draft_set_id` and each row's `draft_pk`** ([hard rule
  3](../SKILL.md#hard-rules)). Omitting `draft_set_id` mints a second draft set; omitting
  `draft_pk` inserts a new row instead of updating. `save_drafts` patches, so a row of
  `draft_pk` plus the fields you mean to change keeps the rest — resending every required
  field is belt-and-braces, not required. Check the response's `cleared_fields` for anything
  a save emptied.
- **Send only the rows you actually changed.** Recovery is the case where a `drafts` payload is
  right — you are editing values, so they must go back. Rows you did not touch are already
  correct on the server; resending them re-opens the divergence [hard rule
  6](../SKILL.md#hard-rules) exists to close. Once the set is clean, preview the issue again
  ([issue-and-close.md § Phase 2](issue-and-close.md#phase-2--the-review-gate)).

---

## Error recovery

Find the missing value in this order, and stop at the first that applies:

1. The documented default from the row template — tag it `(default — applied after server
   flagged it missing)`.
2. Re-run the stakeholder lookup with `detail=full` and re-stamp `issue_date_relationship`,
   `email`, `stakeholder_kind`, `stakeholder_id` from the record.
3. `AskUserQuestion` for that field.

Never scrape a value from another grant or certificate ([engine rule
3](engine.md#engine-hard-rules)). Then save the changed rows with the same `draft_set_id` and
each `draft_pk`, validate, and preview the issue again.

**Canonical rewrite.** The server's *"Email may be from the company's domain"* becomes:
*"Heads-up: this email uses the company's domain. Review the Carta best practices for
stakeholder email addresses before continuing."*

---

## Duplicate resolution

There is no Carta UI for this — it only happens here.

`AskUserQuestion`: `"Map all to existing stakeholders"` / `"Create all as new stakeholders"` /
`"Resolve individually"`. Batch the answer into **one** call:

```
mcp__carta__call_tool({"name": "cap_table__mutate__resolve_duplicate_stakeholder", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<the set's security_type>",
  "draft_set_id": <draft_set_id>,
  "drafts": [{"id": <draft_pk>, "stakeholder_id": <stakeholder_id>},   # merge into existing
             {"id": <draft_pk>, "stakeholder_id": null}]}})             # create as new
```

Then validate again. On the chat surface, then preview the issue.

---

## Option-grant specific errors

| Server message | Action |
|---|---|
| *"Fair market value is required for …"* | Surface verbatim, then follow [§ Fix it in this chat](#fix-it-in-this-chat): its first row says which companies get the 409A offer. |
| Custom label clash | Re-render the row; ask for a new label or clear it (the server auto-generates one). Re-call with `draft_pk`. |
| *"Vesting start date is required"* | Collect `MM/DD/YYYY`, re-call with `draft_pk`. |
| *"Custom vesting must sum to total quantity"* | Route to the app: *"Custom vesting was set outside the skill. Finish in the Drafts UI."* |

Quantity and option-pool overflows are surfaced verbatim, like every other server message. For
an option-pool overflow, offer [the pool increase](#fix-it-in-this-chat).

---

## Fix it in this chat

Two blockers have a fix Carta can make in this chat. Offer it once, in one line, and do the fix
only when the user says yes:

| Blocker | Offer | Preview |
|---|---|---|
| No live FMV (`valuation.no_active_fmv`, or *"Fair market value is required for …"*), on a company whose resolved jurisdiction is `US` with no EMI, CSOP or share-price signal ([engine.md](engine.md#option-grant-resolve-the-fmv-and-the-jurisdiction)). Every other company gets no offer: give the link to `BASE_URL/corporations/<CORP_ID>/valuations/international/`, where an admin adds the valuation | *"Enter the company's 409A valuation here?"* | `cap_table:compute:add_409a_valuation_preview` |
| The plan's pool is too small for the grants | *"Add shares to the \<plan name\> pool here?"* | `cap_table:compute:increase_equity_plan_pool_preview` |

Ask the user for each value the preview's help names; never pick a value yourself. The fix is
its own change: preview, one `AskUserQuestion` with its `summary` and `side_effects`, the named
`cap_table__mutate__apply_plan`, then `cap_table__get__task`, as in [issue-and-close.md § Apply
the plan](issue-and-close.md#apply-the-plan). Then read `issuance_init` again for a new FMV,
save the changed rows, validate, and preview the issue again. On "no", or a `role_required`
refusal, say the fix is in the Carta app.

---

## Issue job failed

`cap_table:get:task` ended `failed` or `partially_failed`. Quote the job's `error` and each
failed row's `error` word for word. Never apply the same plan again.

- **`failed`** — no row issued. Fix the cause per [Error recovery](#error-recovery), then
  preview the issue again. For an option-pool overflow, offer [the pool
  increase](#fix-it-in-this-chat).
- **`partially_failed`** — some rows issued, so the preview refuses the set. Name the rows that
  did not issue, and send the user to the Drafts page in Carta to issue them.

---

## 403

> *"This account can draft but not issue. Have someone with Full access on \<company\> run the
> issue step."*

---

## Errors on any call

| Situation | What to do |
|---|---|
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |
| 403, `role_required` or access denied | Say the user's role on this company cannot draft or issue. Do not retry. On the issue preview or apply, use [§ 403](#403). |
| "Nothing was saved" with `Unknown draft field` | For a type this run does not serve (see [§ Resolve `security_type`](../SKILL.md#resolve-security_type)), route to the Drafts UI. Else rename each field as the message says and save again with the same `draft_set_id`. |
| "Draft set not found" | The set is deleted or the id is wrong. Call `cap_table:list:draft_sets` with `security_type` once and ask which set. Never start a new set without telling the user. |
| "requires security_type" | Send the run's `security_type` for this set and call again once. |
| `unauthenticated` ("The Carta session is not valid") | The Carta sign-in of this chat ended. This is Carta's answer, not a connection check. Say: *"Your Carta session ended. Reconnect Carta (Settings → Connectors, or `/mcp` in Claude Code), then say 'continue'."* Make no other Carta call in this turn. After the user replies, make the same call once more, with the same `draft_set_id` and each `draft_pk` ([hard rule 3](../SKILL.md#hard-rules)): what is saved stays saved. |
| Any other `invalid_argument`, `unknown_param` or `ambiguous` | Carta refused a value you sent, not the surface. Fix what its `message`, `field` and `did_you_mean` name; ask the user with `AskUserQuestion` when only they know the value. Then make the same call once more, with the same `draft_set_id` and each `draft_pk` when it has them. Stay on the surface. |
| "response too large" on `issuance_init` or `load_drafts` | Do not change the call to retry. Say Carta could not load it for this company, and send the user to the Drafts page in Carta. |
