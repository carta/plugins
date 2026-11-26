# Termination errors and recovery

What each failure means and what to do. **Always surface the server's own message verbatim**
alongside the explanation — it names the security and the rule, which is the detail that tells
the user what to fix (SKILL.md Hard rule 8).

**Only a short list of termination failures reaches you with their own code.** Carta rewrites
every other one to a generic internal error before it answers, so the naming detail is gone.
The table below is that list. When what comes back is the generic error, say so plainly and
route to Carta Support — don't invent a cause, and don't promise the user a detail the
response does not carry.

## Before anything is written

Failures from `stakeholder_bootstrap` and the preview are safe — nothing has changed. A
preview that comes back `status: "blocked"` saved no plan at all.

### Refused for access: `permissions.can_terminate` false, or a 403

Missing **HR permission** or **TERMINATIONS product access**. Not retryable, and not something
to work around:

> *"Your Carta login doesn't have the access needed to terminate stakeholders (HR permission
> plus the Terminations product). Ask a full-access admin at \<company\> to grant it, or to run
> the termination."*

A **share-class-scoped limited admin** can also be blocked when the stakeholder's holdings sit
outside their scope. Same shape of answer: name the limitation, route to a full-access admin.

### The apply tool is not available

Phase 0 loads `cap_table__mutate__apply_plan` with its own `ToolSearch`. When that search finds
no apply tool, stop there — before collecting a date, a reason or an approval:

> *"Carta's apply tool isn't available in this chat, so I can't record a termination.
> Reconnect Carta and ask again."*

### The preview comes back blocked

`status: "blocked"`, a null `plan_id`, and one `checks` entry with `state: "fail"` per refusal,
each carrying Carta's own `message` and the `field` it is about. Nothing was saved.

**Go back to the input the `field` names, not always to Step 2.** A block is often nothing to
do with the termination date, and re-asking someone's last day because their negotiated
exercise extension was refused wastes the admin's time and invites a wrong date:

| `field` | Go back to |
|---|---|
| `termination_date`, `termination_reason` | Step 2, and re-ask that value |
| `new_relationship` | the relationship question in Step 2 |
| `deadlines` | that security's deadline question in Step 3 |
| `forfeit` on an **RSA** | that RSA's repurchase-or-forfeit question in Step 3 |
| `forfeit` on a **PIU** | Step 2's termination date. A PIU's disposition comes from the first preview, not the user (SKILL.md Hard rule 4), so there is nothing to re-ask — the usual cause is a future date, which forfeiture refuses |
| `stakeholders`, or no `field` | Step 2, after showing which person or security is named |

Show which securities and why, verbatim, in every case. **Never** retry with a value you
picked yourself.

| Meaning | What to tell the user |
|---|---|
| Termination date is before a security's **issue date** | *"ES-104 was issued 1 Apr 2026, after the 14 Mar 2026 last day you gave. Which date is right?"* |
| Last day to exercise is **before** the termination date | The deadline must be on or after the last day. Re-ask for the deadline. |
| Last day to repurchase is before the termination date | Same rule, for certificates/RSAs/PIUs. |
| Security is **locked** | *"ES-88 is locked, so it can't be terminated. That usually means a pending action or a legal hold — check it in the Carta app, or contact Carta Support."* The whole stakeholder is blocked until it clears. |
| Security is **already terminated** | The stakeholder was terminated before. Stop and route to [reversal](../SKILL.md#reversal); re-terminating cannot fix it. |
| Security is **already cancelled** | A cancelled security can't be terminated. Name it and stop. A *partly* cancelled one is fine and goes through. |
| An **unissued RSA** can't be terminated for service | Name the RSA and stop. It has to be purchased before its unvested shares can be forfeited; repurchasing it instead may be what the user wants. |
| A **security named in `deadlines` or `forfeit`** that the termination does not end | The id or the `security_type` is wrong, or the security dropped out when the date changed. Read the ids back off the preview's own rows. |
| A security in **both `deadlines` and `forfeit`** | A forfeited security has no repurchase window. Drop it from one of the two — which one is the user's choice for an RSA, and the first preview's answer for a PIU. |

### The plan is refused at apply

- **`plan_expired`** — the plan outlived `expires_at`. Preview again, show 4a again, and get a
  fresh yes. Never apply a plan the user approved an hour ago without re-confirming.
- **`plan_stale`** — the cap table moved under the plan. Same answer: preview again and
  re-confirm.
- **`summary_mismatch`** — the summary sent is not the plan's. Send the preview's `summary`
  byte for byte; never reword it.

### A conflict the server can't resolve

Forfeiting with a **future** termination date is rejected. What the user can change depends on
the security.

**An RSA** — both values came from the user, so present the conflict and let them choose:

> *"You've asked to forfeit the unvested RSA shares, but Carta doesn't allow forfeiture with a
> future termination date (30 Apr 2026). Either use a date on or before today, or repurchase the
> unvested shares instead. Which would you like?"*

**A PIU** — the disposition came from Carta, not the user, so the date is the only way out.
Don't offer repurchase:

> *"PIU-4 is forfeited by Carta, and forfeiture can't use a future termination date
> (30 Apr 2026). Use a date on or before today."*

---

## After the apply

`apply_plan` answers `status: "applied"` with a `task`. That means the job started, not that
anyone is terminated. Read `cap_table:get:task` until `done` is true, waiting
`poll_after_seconds` between calls, then read `status`, `counts` and `rows`.

### `partially_failed`

Some stakeholders terminated and some did not. `counts` gives the split; `rows` lists the
failures first, each with the stakeholder id as its `key` and Carta's own message as `error`.
Report exactly who terminated and who didn't, verbatim. Never summarise a partial result as a
blanket failure:

> *"3 of 4 terminated on Acme. Priya Raman did not — ES-88 is locked. Jamie, Alex and Sam are
> complete, effective 14 Mar 2026."*

For a stakeholder who failed, don't claim nothing was written — a failure isn't guaranteed to
leave their record untouched. Say Carta reported an error, and ask the user to check their
record in Carta before anyone retries. For one who succeeded, the termination stands — **do
not apply a second plan to retry the failures**; once the blocker clears and the record checks
out, run a fresh termination for just the failed stakeholders.

If an error reads internal rather than actionable, don't speculate on the cause:

> *"Priya's termination failed with an internal error from Carta. Check her record in Carta
> before trying again, and contact Carta Support with her name and the 14 Mar 2026 date."*

### `failed` or `canceled`

The job itself did not run to completion. Read its top-level `error`, and `rows` for anything
per person. Report it and route to support. Don't apply a second plan.

### `succeeded`

Every stakeholder terminated. Securities issued *after* the termination date are left
untouched, and that is worth naming when the user mentions one, since it usually signals a
wrong date or an unexpected grant — a recorded termination can only be changed by Carta
Support.

### Still running

`done: false` means keep waiting; tell the user it is still processing and poll again after
`poll_after_seconds`. If polling times out entirely, do not apply a second plan. Say the
termination was submitted, its outcome is unconfirmed, and point at the stakeholder ledger to
verify before anyone tries again. Re-sending the **same** `plan_id` is always safe: Carta
returns the stored result rather than terminating twice.

### Something was written and it's wrong

Route to [reversal](../SKILL.md#reversal): individual securities can be undone one at a time,
the relationship change and the recorded date need Carta Support, and re-terminating will not
override a recorded termination. Don't attempt a workaround.
