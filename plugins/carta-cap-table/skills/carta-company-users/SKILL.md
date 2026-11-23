---
name: carta-company-users
description: >-
  See and change who can use a company's Carta account: list its users and access levels,
  invite a person, change their access level or title, remove their access or resend their
  invite, with a preview first. Not for stakeholders or board members.
when_to_use: >-
  Use when the user asks who has access to the company in Carta, or to manage its users:
  "who can see our cap table", "who are the admins", "what access does Dana have", "am I an
  admin", "invite our new CFO as an editor", "give our auditor view-only access", "add our
  lawyer to Carta", "make Priya an admin", "change Lee's title", "John left, remove his Carta
  access", "resend Maria's Carta invite". Not for a stakeholder's invitation to accept a grant
  or its reminder, or terminating someone's equity. For board members, use carta-boardroom.
owner: carta-cap-table maintainers (#cap-table-eng)
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
<carta-plugin>carta-cap-table:6.120.3</carta-plugin>

# Company users and roles

List the people who can use a company's Carta account, and invite, change, remove or invite
again one person at a time. Carta checks each change in a **preview**; nothing changes until
the user approves and you apply it. A company user signs in to manage the company; a
stakeholder holds equity. For board members, use the carta-boardroom skill. Removing access
does not end a person's equity: when the person left the company, say a termination in Carta
does that.

## Actions

| The user wants to | `read_tool` `name` |
|---|---|
| See who has access, or one person's access | `cap_table__list__company_users` |
| See the user's own access ("am I an admin?") | `cap_table__get__company`: `sections.access.role` |
| Invite a person | `cap_table__compute__invite_company_user_preview` |
| Change a person's access level or title | `cap_table__compute__change_company_user_preview` |
| Remove a person's access | `cap_table__compute__remove_company_user_preview` |
| Send the invitation email again | `cap_table__compute__resend_company_user_invite_preview` |

## Access levels

| `access_level` | Say | The user's words |
|---|---|---|
| `full_access` | Full Access (legal admin) | admin, full access, legal admin |
| `company_editor` | Company Editor | editor, edit access |
| `view_only` | View-Only | viewer, view-only, read-only |
| `hr` | HR Administrator | HR, HR admin |
| `no_access` | No Access | no access (board members only) |
| `custom` | Custom, with the row's `role`; Limited admin when `limited_admin_share_classes` is set | — |

The company read's `role` is `admin` (Full Access), `editor`, `viewer`, `hr_admin` or
`limited_admin`: say it with the names above.

An invite takes `full_access`, `company_editor`, `view_only` or `hr`; a change also takes
`no_access`. When the user asks for custom access or a limited admin, say to set it in Carta,
under Users and permissions, and send no preview. Carta lets only a Full Access user give Full
Access, or change or remove a Full Access user or a limited admin. Carta gives No Access only to
a current or past board member, and some companies have no HR Administrator level. Do not check
these rules yourself: preview, and quote Carta's answer. When the user names no level, ask with
`AskUserQuestion`. Never pick a level yourself.

## Hard rules

1. **Preview, then approval, then apply.** Never apply without the user's approval of the
   **latest** preview, and apply only its `plan_id`. One approval covers one apply.
2. **The person comes from the list.** `user` is the `id` or `email` of a row of
   `cap_table__list__company_users`. Never send a name, and never guess an id.
3. **Quote Carta's messages word for word**: failed checks and errors.
4. **No shell, no files, no background agent.** `Read` only a result the host saved to a file.
5. **Plain words.** Say access levels as [§ Access levels](#access-levels) says. No ids, field
   names or command names in the text.

## Calls

Load the Carta tools with one `ToolSearch` (query `read_tool list_accounts`) before the first
call, and the apply tool (`+apply_plan`) before the approval question. Use whichever Carta
connector is present.

The company: follow `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` (the plugin's own
`references/`, not this skill's; read it by that path, do not search for it). The first read
sends the id or name the user gave as `company`, never as `corporation_id`, or no `company`.
Each preview and the apply send that read's `meta.company.id`; the approval question names
`meta.company.name`, or the company `label` the user picked when that name is empty.

## Flow

1. **Read the users.** For one person, send `search` with the name or email; for a title ("our
   CFO"), read every row and match `titles`. For "who are the admins" (or editors, viewers), send
   `access_level` as a list, such as `["full_access"]`. When `next` is set and the answer needs
   every row, send it as `after` until it is null. `summary` counts every matching user.
2. **Answer a question and stop.** Show `| Name | Email | Access | Title |`, with the access
   level as [§ Access levels](#access-levels) says and `titles` as the title. For a limited
   admin, add the share class names. Give the count from `summary`.
3. **Find the person** for a change, removal or resend. No row matches: say this person is not
   a company user, and offer to invite them (law firm and outsourced firm users are not listed:
   say to manage them in Carta). Two or more rows match: ask which one in one `AskUserQuestion`,
   with name and email in each option. For an invite, when a row has the same email, say this
   person is already a company user, and offer a change instead.
4. **Collect the inputs.** Use the user's words; ask only for what is missing, in one
   `AskUserQuestion` with up to 4 questions.
   - **Invite:** `email`, `first_name`, `last_name`, `title` (such as CFO) and `access_level`.
     Carta emails the invitation; send `send_invite: false` only when the user asks for no email.
   - **Change:** `user`, with `access_level`, `title` or both. To take all access away, preview a
     removal.
   - **Remove** and **resend:** `user` only.
5. **Preview.** When `status` is `blocked` (no `plan_id`), quote each check with `state: fail`,
   say what the user can do, ask no approval, and stop. On an error, do as
   [§ Error Handling](#error-handling) says, and ask no approval.
6. **Ask for approval.** One `AskUserQuestion` that names the action, the person and the
   company, such as **"Invite Dana Lee to Acme Robotics?"**, with two options: the action
   (**"Invite"**, **"Change"**, **"Remove access"** or **"Resend invite"**) first, then **"Not
   now"**. Put the preview's `summary` word for word, each `side_effects` label and each check
   with `state: warn` in the `preview` of the first option, never as text before the question:
   the host shows text between tool calls only as a one-line summary. Name each side effect that
   cannot be undone, such as an invitation email. On "Not now", apply nothing and say so.
7. **Apply.** Call the named `cap_table__mutate__apply_plan` tool with `company`, the latest
   `plan_id` and its `summary` unchanged. With no apply tool, apply nothing: *"Carta's apply
   tool isn't available in this chat, so nothing was changed. Reconnect Carta and ask again."*

## Several people

Do one person at a time, steps 3 to 7, then the next person, in the order the user gave.

## Error Handling

| Situation | What to do |
|---|---|
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |
| 403, `role_required` or access denied | Quote the message. Do not retry. On the list, when the message gives no other reason (such as a fund that manages the users), say only company admins and editors can see the company users. On a preview, say the user's role cannot make this change. |
| `workflow_unavailable` | Say to make this change in Carta, under Users and permissions. Stop. |
| `scope_required` | Ask the user to grant access as its `fix` says. Call again only after they confirm. |
| `not_found` on `user` | Read the users again once, with `search`. A row matches: preview again once with its `id`. No row: say *"<name> is not a company user of <company>."* word for word, also when the first read found the person, and stop. Send no other preview, also not with the email. |
| `invalid_argument` naming company, signatory or board admin roles | Quote it. Say the person still holds a company role (such as cap table owner or legal contact), a signatory role or a board admin role: give it to someone else in Carta first, then ask again. Do not preview again. |
| `invalid_argument`: the email is "already in use", or the user "already has an active role" | Say this person is already a company user. When a row of the list has this email, offer a change; if not, say to manage the person in Carta. Do not preview the invite again. |
| `invalid_argument`: the email "must be added through your identity provider" | Quote it. Say the company's IT administrator must add this person through the identity provider, and nothing changed. Do not preview again. |
| `invalid_argument`: "already signed in", "Nothing changes." or "last legal administrator" | Quote it, say nothing changed, and stop. Do not preview again. |
| `invalid_argument` on `access_level` | Quote it. When Carta says to remove the user instead, offer a removal; if not, ask for another access level. Preview again once, after the user answers. |
| `invalid_argument` | Quote it. On a preview, when the user's own value is wrong (an email typo, a placeholder email, a title, a name), ask for it and preview again once. On an apply, or when Carta says to do something else, do what Carta says and do not preview again. |
| `summary_mismatch` | Call the apply tool again once, with the `summary` of the latest preview copied with no change. |
| `plan_expired` or `plan_stale` | Preview again with the same inputs, then ask for approval of the new preview. |
| `internal_error` on apply | Call the apply tool again once with the same `plan_id` and `summary`: a plan applies only once. If it fails again, say the change may or may not have been made, and read the users before a new preview. |
| `internal_error` on a read or preview, or `throttled` | Call again once. If it fails again, say Carta has a temporary problem. Stop. |

## Closing

End with one line per person (what changed, on which company), one per change not applied,
and one for an email Carta sent. Do not repeat the request or offer more.
