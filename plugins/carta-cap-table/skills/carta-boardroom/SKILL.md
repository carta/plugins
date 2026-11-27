---
name: carta-boardroom
description: >-
  Board consents and board members in Carta. See consents and who signed; create, rename, change
  the date or email, swap grants, send, remind, void, delete. See the board; add, end a term,
  remove or invite a member again. Each change has a preview.
when_to_use: >-
  Use when the user asks about a board consent or a unanimous written consent of the board:
  "which board consents wait for signatures", "who has not signed the board consent", "create a
  draft board consent", "send the consent to the board", "remind the directors to sign", "move
  the consent's expiration date", "void the approved consent", "delete the draft consent". Also
  for the directors and observers on the board: "who is on our board", "add Jane to the board",
  "end Bob's board term", "remove a director", "resend the board invite". To issue grants, also
  grants that need board approval, use carta-issuance. Not for stockholder consents, or for
  spousal or witness signatures on a security.
owner: carta-cap-table maintainers
model: inherit
allowed-tools:
  - AskUserQuestion
  - Read
  - ToolSearch
  - mcp__carta__read_tool
  - mcp__carta__welcome
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.124.1</carta-plugin>

# Boardroom

Read the board consents and board members of a company and change them. Carta checks each
change in a **preview** and saves it as a plan. Nothing changes until the user approves and you
apply it.

Send `_instrumentation_v2: {"surface": "<surface>"}` with every Carta tool call, as a parameter
of the tool next to `name` and `arguments`, never in `arguments`. `<surface>` is the closest of
`chat`, `cowork`, `code-terminal`, `code-desktop`, `code-remote`, `excel`, `sdk-cli`,
`sdk-typescript` and `sdk-python`, else `other`. Run no shell command for this or any other
`_instrumentation_v2` field: send `session_id` only when your system prompt already shows it.

## Actions

| The user wants to | `name` | Who can | Consent status |
|---|---|---|---|
| See consents, status, signatures | `cap_table__list__board_consents` | Boardroom users, not limited admins | any |
| See one consent: text, approvers, attachments | `cap_table__get__board_consent` | Boardroom users, not limited admins | any |
| Create a draft consent | `cap_table__compute__create_board_consent_preview` | board admin, legal admin | — |
| Rename, change the email to the directors, swap the draft grants | `cap_table__compute__update_board_consent_preview` | board admin who can edit, legal admin | draft, awaiting legal review |
| Change the expiration date | `cap_table__compute__update_board_consent_preview` | board admin who can edit, legal admin | draft, awaiting legal review, awaiting approval, expired |
| Send for approval | `cap_table__compute__send_board_consent_preview` | legal admin | draft, awaiting legal review |
| Remind directors who did not sign | `cap_table__compute__notify_board_consent_approvers_preview` | legal admin | awaiting approval |
| Void | `cap_table__compute__void_board_consent_preview` | board admin who can edit, legal admin | approved |
| Delete | `cap_table__compute__delete_board_consent_preview` | board admin who can edit, legal admin | draft, awaiting legal review, canceled, expired, void |

No command writes the consent text or picks its template. No command attaches the first draft
grants, a 409A report or a file. No command signs, cancels or takes back a consent that waits for
approval. For these, say so in one line. Then say where to do it: on the consent's page in Carta
Boardroom. Post its link when a result gave one. Directors sign through the link in their email.

## Hard rules

1. **Preview, then approval, then apply.** Never apply without the user's approval of the
   **latest** preview. Apply only the `plan_id` of the latest preview.
2. **Ids from Carta.** `consent_id` is the `id` of a row of the consent list. `approval_ids`
   are `approvers[].id` of the single consent read. Never guess an id.
3. **Quote Carta's messages word for word**: failed checks and errors.
4. **Links from Carta only.** Post `meta.web_url` of a preview or apply result as
   `[Open in Boardroom](<web_url>)`. Never build a Carta URL.
5. **Never hand this skill to a background agent.** It needs the user at each approval.
6. **Plain words.** No ids in your own text. Show dates as `MM/DD/YYYY` and send them as
   `YYYY-MM-DD`. Turn a relative date into a date from `meta.as_of` of the last read, and show it.

## Calls

Before the first Carta call, load the Carta tools with one `ToolSearch` (query `read_tool
list_accounts`). Use whichever Carta connector is present. The keys of `read_tool` are `name` and
`arguments`. Reads and previews go through `read_tool`. Apply goes only through the **named**
`cap_table__mutate__apply_plan` tool. It is often deferred: load it with `ToolSearch`
(`+apply_plan`) before the first preview. If it is not found, say *"Carta's apply tool isn't
available in this chat, so nothing was changed. Reconnect Carta and ask again."* Ask no approval,
and never apply through another tool.

Find the company as `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` says (the plugin's own
`references/`; do not search for it), but send it as `company`. Each preview and the apply take
`company` = `meta.company.id` of the first read. With no Carta tool, stop: *"I can't reach Carta.
Connect Carta in your connector settings, then try again."*

## Flow

1. **Read.** Call `cap_table__list__board_consents`. Send `status` (a list of `draft`,
   `awaiting_legal_review`, `awaiting_approval`, `approved`, `expired`, `void`, `canceled`,
   `deleted`) only for a status the user names or the action needs. For more rows, send
   `next` as `after`. Show `| Consent | Status | Signed | Expires |`, where Signed is
   `approvals_signed of approvals_total`.
   - Find the consent by its name. When the user names no consent, or 2 or more rows fit, ask
     which one in one `AskUserQuestion`. When no row fits, say so and show the table.
   - For who signed, or a reminder to one person, read `cap_table__get__board_consent` with
     `consent_id`. `signed_on` null means not signed. Show `| Director | Signed on |`.
   - A read of the list ends with the table. Ask nothing more.
2. **Check the status.** When the consent's status is not in the action's row in
   [§ Actions](#actions), say which statuses allow it and stop. Do not ask for the user's
   role: Carta checks it.
3. **Collect the inputs.** Use the user's words. Ask only for what is missing, in one
   `AskUserQuestion`. Every preview except create also takes `consent_id`.
   - **Create:** `name` only. Before the preview, say the consent starts empty: the text, the
     grants and the 409A report go in on its Boardroom page.
   - **Update:** only the fields to change: `name`, `expiration_date` (today or later),
     `custom_subject_line` and `custom_message` (the email to the directors; `""` clears one).
     A new date on an expired consent that was sent for approval sends it again: Carta emails
     each director who did not sign.
   - **Swap the draft grants:** this replaces the draft set on the consent with another set of the
     same equity plan. Read `cap_table__get__board_consent`. When `attachments.securities` is
     empty, there is no draft set to replace: say to attach one in Boardroom, and stop. Call
     `cap_table__list__drafts` with `type: ["option_grant", "rsu"]`. Pick an `in_progress` row
     with the same `equity_plan` as the row whose `id` is `attachments.securities[].draft_set_id`.
     When no row fits, say to change the attachments in Boardroom, and stop. Send `draft_set_id`
     and `security_type` = the `id` and `type` of that row. To pick some drafts only, add
     `draft_ids` = the `id` of each row of `cap_table__list__draft_securities` (`draft_set_id` and
     `security_type` of that row).
   - **Remind:** `approval_ids` = the `id` of each named director with `signed_on` null. Leave it
     out only when the user names no director: then Carta reminds all who did not sign. When every
     named director already signed, say so and stop: send no preview. Never send `[]`.
4. **Preview.** Send `company` and the inputs. When `status` is `blocked`, there is no `plan_id`.
   Quote each `checks[].message` with `state: fail`. Ask for the fix when the user can give it.
   When the fix is in Boardroom, post the link. Ask no approval.
5. **Approval.** The company name is `meta.company.name` of the first read. When it is empty, call
   `list_accounts` once (with `search` only when the user gave a name: a search matches names, not
   ids). Take the `name` of the row whose `id` is `corporation_pk:<meta.company.id>`. With no
   name, ask the user to name the company, and ask no approval. Then ask one `AskUserQuestion`:
   **"Apply this change on <company name>?"**, with options **"Apply"** (first) and **"Not now"**.
   In the `preview` of **Apply**, put the `summary` word for word, each new value (a date as
   `MM/DD/YYYY`, a name, the email text) and each `side_effects` label on its own line. Put none
   of this in text before the question: the host shows it as one line. When `side_effects` has an
   `email`, the question also says: *"Carta emails these people as soon as you apply. You can't
   unsend an email."* On "Not now", apply nothing and say so.
6. **Apply.** Call the named `cap_table__mutate__apply_plan` tool with `company`, the latest
   `plan_id` and its `summary` unchanged.

A send locks the attached draft grants. Carta issues them when every director signs: never
issue them again.

## Board members

To see the directors and observers on the board, add one, end a term, remove one or send the
invitation again, read `${CLAUDE_PLUGIN_ROOT}/skills/carta-boardroom/references/board-members.md`
(this skill's own `references/`; do not search for it).

## Error Handling

| Situation | What to do |
|---|---|
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |
| `role_required` or 403 | Say the user's role cannot do this on this company, or the company has no Boardroom. Name who can, from [§ Actions](#actions) or, for a board member action, from the board members reference, and each company role that its message names. Do not retry. |
| `scope_required` | Ask the user to grant access as its `fix` says. Call again only after they confirm. |
| `workflow_unavailable` | Say Carta cannot do this from this chat yet. Say where to do it: in Boardroom. Do not retry. |
| `not_found` on `consent_id` or `member_id` | Read the list again once and use the `id` of the row. If it fails again, show the list and ask which one. |
| `not_found` on `plan_id`, `plan_expired` or `plan_stale` | Preview again, then ask for approval of the new preview. |
| `unknown_param` or `invalid_argument` | Do what its `fix` says, then call again once. Ask the user for a date or a name only when the `fix` needs one. |
| `summary_mismatch` | Call the apply tool again once, with the `summary` of the latest preview copied with no change. |
| `throttled` | Say Carta is busy. Wait, then call again once. If it fails again, stop. |
| `internal_error` on apply | Call the apply tool again once with the same `plan_id` and `summary`: a plan applies only once, and a second call returns the stored result. If it fails again, say the change may or may not have been applied, and read the consent before any new preview. |
| `internal_error` on a read or preview | Call again once. If it fails again, say Carta has a temporary problem. Stop. |

## Closing

End with one short message and nothing after it. Write one line with what was done and on
which company, and one line with each person Carta emailed. Post the apply result's
`meta.web_url` as `[Open in Boardroom](<web_url>)`. After a create, add one line: write the
text and attach the grants or the 409A report on that page.
