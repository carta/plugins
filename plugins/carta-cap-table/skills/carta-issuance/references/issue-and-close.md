# Issue and close

The issue with no app, and every terminal message. Read this when
[companion-surface.md § 8](companion-surface.md#the-review)'s *Elsewhere* previews and applies the
issue, or at a close.

`mcp__carta__` below is the same placeholder it is everywhere else — substitute the session's
real Carta prefix ([engine.md Step
2](engine.md#step-2--command-names-and-base_url)).

---

## The preview

```
mcp__carta__read_tool({"name": "cap_table__compute__issue_draft_set_preview", "arguments": {
  "company": <corporation_id>, "security_type": "<security_type>",
  "draft_set_id": <draft_set_id>, "version": <version>}})
```

Send `"version"` from your last `cap_table:get:draft_set_companion` read: copy it, and leave it
out only when the read has none. A save after the preview makes the plan stale: preview and
confirm again.

Add `"publish_board_consent": true` only on option grants, and only when the user asked Carta to
create the board consent and send it to the board. Without it, grants that need board approval
stay drafts until a board consent approves them, and the preview's `summary` says so.

| Preview | Do |
|---|---|
| `status: draft` | Keep `plan_id` and `summary`. Put in the confirm's review the `summary`, every `side_effects` label and the `message` of each check whose `state` is not `ok`, word for word. Name each side effect that can't be undone, such as an email to a holder |
| `status: blocked` (no `plan_id`) | Quote each `checks[].message` word for word and ask no approval. Fix the rows per [mutate-recovery.md](mutate-recovery.md), then check and preview again. *"The draft set is already issued"*, *"An issue of this draft set is in progress"* or *"waits for its board consent"*: issue nothing, and say what it says |
| 403 or `role_required` | [mutate-recovery.md § 403](mutate-recovery.md#403) |

### Say what confirming actually does — it differs by type

A grant or a unit goes out for signature; a certificate lands on the cap table. Whoever is
confirming is entitled to know which, so carry the matching sentence into the confirm's review:

| Type | Sentence |
|---|---|
| Option grant | *"Confirming will send these grants to the signatory for signature."* |
| Certificate | *"Confirming will issue these certificates to the cap table."* |
| PIU | *"Confirming will send these profits interest units to the signatory for signature."* |

---

## Apply the plan

```
mcp__carta__cap_table__mutate__apply_plan({"company": <corporation_id>,
  "plan_id": "<plan_id>", "summary": "<summary, unchanged>"})
```

The named tool only: `call_tool` and `mutate` refuse `apply_plan`. Send the `plan_id` and
`summary` of the **latest** preview the user approved, and no rows. When `ToolSearch` found no
apply tool, apply nothing: *"Carta's apply tool isn't available in this chat, so nothing was
issued. Reconnect Carta and ask again."*

| Apply answer | Do |
|---|---|
| `task` comes back | Read the job (below) |
| `plan_stale` or `plan_expired` | The draft set changed, or the plan is too old. Apply nothing; preview again and ask the approval again with the new `summary` |
| `summary_mismatch` | Apply once more with the latest preview's `summary` copied with no change |
| Any other error | Quote its `message`; [mutate-recovery.md § Errors on any call](mutate-recovery.md#errors-on-any-call) |

**Read the job:**

```
mcp__carta__read_tool({"name": "cap_table__get__task", "arguments": {
  "company": <corporation_id>, "task_id": "<task.task_id>"}})
```

Call it again after `poll_after_seconds` until `done` is true, at most 3 times. The draft set read
does not show the job state, so never read the set in its place. Then:

| Job | Do |
|---|---|
| `succeeded` | Issued — [On success](#on-success) |
| `failed` or `partially_failed` | [mutate-recovery.md § Issue job failed](mutate-recovery.md#issue-job-failed) |
| `running` after 3 reads | Say these words: *"The issue is still running in Carta."* Never apply again |
| `not_found` | Another issue held the draft set, so this one started nothing. Preview again: the preview says when the other issue is done |

Keep `draft_set_id` and each `draft_pk` for any later save (SKILL.md hard rule 3).

### On success

Read `cap_table:get:draft_set_companion` one time with `issue_id`, the job's `task_id`. Start
with that read's [What issued](companion-surface.md#what-issued), then go on as below.

Lead with what happens next, in the Carta app's words: **Signatories were notified to sign
options** (certificates, PIUs), then *"Once signatories sign, securities will be sent to
stakeholders."* When the preview's `summary` said rows need board approval, those rows are
drafts held for a board consent, not issued: say so, and say Carta sent the consent to the
board only when you sent `publish_board_consent: true`. Prefer the apply's `meta.web_url` over
the ledger link built below.

Render a short table of the reviewed rows using `MM/DD/YYYY`, with no label or grant number
column: the apply and the job don't give one per security, and a guessed grant number is worse
than none. The apply's `labels` name the draft set; never show them as security labels.

**Don't read the securities back to confirm the issue.** A `succeeded` job *is* the
confirmation, and there is no read that would add to it —
the only per-security lookups are `cap_table__get__piu`, `cap_table__get__certificate` and
`cap_table__get__option_grant`, each of which needs a label or id you don't have. They are
**single-security** lookups: `corporation_id` **plus exactly one** of `label` or
`security_id`, and neither (or both) is rejected with *"Provide exactly one of security_id or
label"*. None of them is a lister, and there is no PIU lister at all — the only listers are
`cap_table__list__certificates` and `cap_table__list__grants`, both `search=<holder name>`.
So a read-back for a PIU has nowhere to go; report the job's own result instead. And never
lift a command name out of a log or a tool-name dump: the name resolves, the arguments don't,
and the failed call is the only thing the user sees for it.

- **Certificate:** Stakeholder · Share class · Quantity · Issue date.
- **Option grant:** Stakeholder · Plan · Option type · Quantity · Exercise price · Issue date.
- **PIU:** Holder · Unit class · Quantity · Threshold value · Issue date.

Link to the ledger at `<BASE_URL>/<VIEW_URL_PATH>`, where `BASE_URL` is the host recorded in
[Step 2](engine.md#step-2--command-names-and-base_url) and `VIEW_URL_PATH` is
`options/list/<CORP_ID>/` (option grant), `certificates/list/<CORP_ID>/` (certificate), or
`options/piu/list/<CORP_ID>/` (PIU).
**Never invent a different path** — `corporations/<corporation_id>/equity/options/` looks
plausible and is not a real route. **Never hardcode a host either:** a demo or test issuance
linked to `app.carta.com` sends the admin to a production company that doesn't hold the
securities they just issued. There is no verified URL for a specific plan's detail page, so
name the plan in plain text, not as a second link. Then close per [Closing](#closing).

## Cleanup unexpected draft rows

Extra or duplicate rows surfaced by `load_drafts` on resume:
[resume-flow.md § Cleanup unexpected draft rows](resume-flow.md#cleanup-unexpected-draft-rows).

---

## Closing

At a terminal state, lead with a one-line domain summary — company, count, type, and for an
issue, the issue date in long form (`Month D, YYYY`).

| State | Template |
|---|---|
| Issued, certificate | *"N \<share class\> certificates issued on \<company\> — \<issue date\>. Open \<company\>'s securities ledger in Carta — link text *\<company\>'s securities ledger*, href `\<BASE_URL\>/\<VIEW_URL_PATH\>` — to see the new certificates."* |
| Issued, grant (uniform) | *"N \<so_type\> option grants issued on \<company\> — \<issue date\>. Open \<company\>'s securities ledger in Carta — link text *\<company\>'s securities ledger*, href `\<BASE_URL\>/\<VIEW_URL_PATH\>` — to see the new grants, or find them under the \<plan name\> plan."* |
| Issued, grant (mixed) | as above, but *"N option grants (X ISOs, Y NSOs) issued on …"* |
| Issued, PIU | *"N \<unit class\> profits interest units issued on \<company\> — \<issue date\>. Open \<company\>'s profits interest ledger in Carta — link text *\<company\>'s profits interest ledger*, href `\<BASE_URL\>/\<VIEW_URL_PATH\>` — to see the new units."* |

Every link above builds on `BASE_URL` — the `base_url` from `get_current_user`, recorded in
[Step 2](engine.md#step-2--command-names-and-base_url) — so a demo, sandbox or
test session links into the environment it actually wrote to.

To **correct** or cancel an issued security afterward, that's
`carta-manage-securities`.

## Say what is live after every write

After each save or issue, tell the user in plain words:

- **What changed in Carta.** For example: "Saved 3 option grant drafts" or "Issued 3 option grants".
- **What is still a draft.** A draft is not on the cap table. After a save only, say "Nothing is
  issued yet."
- **Who Carta notified, after an issue only.** Name only the people in the issue result
  ([§ On success](#on-success)) or in `issue_summary.sentence` once `issue_state` is `done`.
  After a save, Carta has notified nobody: say nothing about notifications.
- **The next step, after a save only.** Where the issuance app shows, tell the user to issue
  with the app's Issue button. With no app, say one line: `When you are ready, say "issue
  them".` The [confirmation gate](../SKILL.md#hard-rules) still applies.
