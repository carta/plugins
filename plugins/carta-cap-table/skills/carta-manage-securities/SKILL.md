---
name: carta-manage-securities
description: >-
  Edit or cancel an issued security, with a preview before anything changes. Covers
  fixing, amending, cancelling, partly cancelling or uncancelling a certificate, option
  grant, SAFE, note, RSU, RSA, SAR, CBU, PIU or warrant. Not for terminating a person
  (cancelling everything they hold).
owner: carta-cap-table maintainers (#cap-table-eng)
model: inherit
allowed-tools:
  - AskUserQuestion
  - Read
  - ToolSearch
  - mcp__carta__read_tool
  - mcp__carta__welcome
  - mcp__carta__list_accounts
  - mcp__carta__view_remote
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__list_accounts
  - mcp__claude_ai_Carta__view_remote
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__view_remote
  - mcp__*__show_widget
  - mcp__remote-devices__Claude_Browser__preview_start
  - mcp__remote-devices__Claude_Browser__navigate
  - mcp__remote-devices__Claude_Browser__tabs_context
  - mcp__Claude_Browser__preview_start
  - mcp__Claude_Browser__navigate
  - mcp__Claude_Browser__tabs_context
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.110.4</carta-plugin>

# Manage securities

Edit, cancel, partly cancel or uncancel an issued security. Carta checks each change in a
**preview** and saves it as a plan; nothing changes until the user approves and you apply it. To
issue new equity, use `carta-issuance`. To terminate a person (cancel or exercise everything they
hold), send the user to the termination flow in the Carta app.

## Actions

| The user wants to | Preview `name` |
|---|---|
| Edit fields | `cap_table__compute__modify_securities_preview` |
| Cancel a whole security | `cap_table__compute__cancel_security_preview` |
| Cancel part of an option grant or CBU | `cap_table__compute__partial_cancel_security_preview` |
| Reverse a cancellation | `cap_table__compute__reverse_cancel_security_preview` |

`security_type` is one of `certificate`, `option_grant`, `convertible_note`, `rsu`, `rsa`, `sar`,
`cbu`, `piu` or `warrant`. A `CN-` or `SAFE-` label is a `convertible_note` and an `ES-` label is
an `option_grant`. For any other label, take the type from the user's words ("RSU", "warrant",
"units", "shares"); when they do not say, ask once with `AskUserQuestion`. Never guess.

## Hard rules

1. **Preview, then approval, then apply.** Never apply without the user's approval of the
   **latest** preview. Never retry `apply_plan` with an old plan.
2. **Ids only.** Previews take security ids. Get each id from the bootstrap, or from
   `cap_table__get__security` / `cap_table__list__securities`. Never send a label to a preview.
3. **The server decides.** Offer only actions, securities and fields the bootstrap marks as
   available, selectable or eligible. For anything else, quote its `why_not.message`.
4. **Quote Carta's messages word for word**: blockers, failed checks and errors.
5. **Follow the result.** When a result has `next_step` or `how_to_reply`, do what it says. Do
   not open a page any other way, and never build a Carta URL.
6. **No local files.** This skill writes no files and runs no scripts.
7. **Never hand this skill to a background agent.** It needs the user at each approval.
8. **Plain words.** No ids in the text, dates as `MM/DD/YYYY`, a one-line reason for each value
   you chose, and the full text of a legend that changes.

## Calls

Load the Carta tools in one `ToolSearch` before the first Carta call
(`select:mcp__carta__read_tool,mcp__carta__list_accounts`). The apply tool
is often deferred: load it with `ToolSearch` (`+apply_plan`) before the approval question.

Use whichever Carta connector is present. The keys are `name` and `arguments`.

| Step | Tool | `name` |
|---|---|---|
| Company | `list_accounts(search="<company name>")` | — |
| Bootstrap | `read_tool` | `cap_table__get__security_change_bootstrap` |
| Preview | `read_tool` | the preview in [§ Actions](#actions) |
| Apply | the **named** `cap_table__mutate__apply_plan` tool | — |
| Job | `read_tool` | `cap_table__get__task` |

`list_accounts` returns `id: "corporation_pk:<n>"`; send `<n>` as `company`. With no Carta tool,
stop: *"I can't reach Carta. Connect the Carta MCP server and try again."*

## Flow

1. **Bootstrap.** Call it once per change, after any earlier apply, with `company`,
   `security_type` and `label` (a list), `security` (ids) or `holder`. To reverse a
   cancellation, send `label` or `security`: `holder` finds only securities held now. For an
   edit, always send `look_first: true`, so the Change page opens before the first preview
   ([change-flow.md § Open the page first](references/change-flow.md#open-the-page-first)).
2. **Read the bootstrap.**
   - `blockers`: for `hard_stop`, quote `message` and `fix`, then stop. Ask about each
     `needs_decision`. Say each `informational` once.
   - `sections.actions`: an action with `available: false` cannot run. The `preview` value
     `preview_<name>` is the `cap_table__compute__<name>_preview` call.
   - `sections.securities`: never offer a row with `selectable: false`. When the user named a
     person and 2+ rows are selectable, ask which ones in one `AskUserQuestion`.
3. **Collect the inputs** for the action. Use the user's words; ask only for what is missing,
   in one `AskUserQuestion` with up to 4 questions. Dates are `YYYY-MM-DD`.
   - **Edit:** see [references/change-flow.md](references/change-flow.md) for fields, reason,
     note, Rule 144 and the Change page. The field formats are in
     [references/field-contract.md](references/field-contract.md).
   - **Cancel:** `security`, `cancel_date` (not in the future), `cancel_reason`, and `notes`.
     Send `relationship` when the reason is `Relationship change`. For a certificate, RSA or
     PIU from an equity plan, ask whether the shares go back to the plan pool (`return_shares`).
   - **Partial cancel:** `security`, `effective_date` and `quantity`. The last tranches go first.
   - **Reverse cancel:** `security` and `reason`. `notes` is required when the reason is
     `Other - describe below`.
4. **Preview.** Every change goes through the preview in [§ Actions](#actions), never
   `cap_table__mutate__modify_issuable`, which keeps no Change page. Send this pass's
   `thread_id` (see [§ Several changes](#several-changes)). A rework is one new preview on
   the same thread.
   `status: blocked` (no `plan_id`): quote each failed check, ask for the fix, ask no approval.
5. **Show the preview.** With `next_step` and the browser tool it names, follow it, then keep
   the chat to one line: the count, the fields, the reason, any problem and the full text of a
   legend that changes. Else show a table in chat (security · field · before → after, or the
   tranches for a partial cancel). Post any `companion_url` as `[See it in Carta](<companion_url>)`.
6. **List the side effects.** Show every `side_effects` label before the approval question.
   Name each one that cannot be undone, such as an email to a holder.
7. **Approval.** Ask one `AskUserQuestion`: **"Apply this change?"**, options **"Apply"** and
   **"Not now"**. When `how_to_reply` names an approval card, show that card with `view_remote`
   instead. On "Not now", apply nothing and say so.
8. **Apply.** Call the named `cap_table__mutate__apply_plan` tool with `company`, the latest
   `plan_id` and its `summary` unchanged. If `ToolSearch` found no apply tool, apply nothing:
   *"Carta's apply tool isn't available in this chat, so nothing was changed. Reconnect Carta
   and ask again."*
   - A `task` comes back: read `cap_table__get__task` until `done` is true, at most 3 times.
     Then say the job is still running in Carta.
   - `plan_stale`: say the security changed in Carta after the preview, and offer a new one.
   - `plan_expired`: preview again, then ask for approval again.

## Several changes

One approval applies one change: one action, one reason, one security type, and at most
`limits.max_securities` securities for an edit. Cancels, partial cancels and reverse cancels take
one security each. Run each change as its own pass through steps 1 to 8, and say the split
first: *"These are two changes. I'll apply them one at a time, starting with CS-1."* Each pass
opens its own page with its own bootstrap and sends that pass's `thread_id`, never an earlier
pass's.

## Closing

End the run with one short message and nothing after it:

- One line: what was done and on which company.
- One bullet per security that changed: label, field, before → after.
- One bullet per change that was not applied.
- One line only for something that cannot be undone or is still running, such as an email to a
  holder or a job still in progress.

```
2 option grants updated on Meetly.
- ES-218 · Board approval date 08/01/2022 → 06/15/2024
- ES-219 · Board approval date 08/01/2022 → 06/15/2024
```

Leave out the reason, the note and the audit log (the Change page and Carta show them), and
any repeat of the request, of what Carta reported, or of an offer to do more.
