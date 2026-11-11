---
name: carta-manage-securities
description: >-
  Edit or cancel an issued security, with a preview before anything changes. Covers
  fixing, correcting, amending, cancelling, partly cancelling, uncancelling or undoing the
  termination of a certificate, option grant, SAFE, note, RSU, RSA, SAR, CBU, PIU or
  warrant. Not for terminating a person (cancelling everything they hold).
when_to_use: >-
  Use when the user asks to change a security that is already on the cap table, often to
  match the signed documents: "fix the dates in Carta to match the paperwork", "change the
  issue date", "update the cost basis", "change the legend", "fix the exercise price",
  "fix the SAFE's cap or discount", "correct CS-12", "something looks wrong on CS-12, show me
  first", "I need to fix something on ES-12", "cancel ES-12", "cancel part of this grant". To
  issue new equity, use carta-issuance.
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
<carta-plugin>carta-cap-table:6.112.0</carta-plugin>

# Manage securities

Edit, cancel, partly cancel or uncancel an issued security, or undo its termination. Carta checks each change in a
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
| Undo a termination | `cap_table__compute__undo_termination_preview` |

`security_type` is one of `certificate`, `option_grant`, `convertible_note`, `rsu`, `rsa`, `sar`,
`cbu`, `piu` or `warrant`. Take it from the user's words first: "RSU" or "restricted stock unit" is
`rsu`, "RSA" or "restricted stock award" is `rsa`, "SAR", "UAR" or "stock appreciation right" is
`sar`, "CBU", "cash bonus unit" or "phantom equity" is `cbu`, "PIU", "profits interest" or
"incentive unit" is `piu`, "warrant" is `warrant`, and "certificate", "share certificate" or
"stock certificate" is `certificate`, and so are "shares" or "stock" when they name the security
itself (as in "ES-123 (Shares)"), never as a count ("100 shares") or inside another type's name
("stock option", "restricted stock unit"). "Units" alone is not a type word. With no
type word, a `CN-` or `SAFE-` label is a `convertible_note`, an `RSU-` label is an `rsu`, a `PIU-`
label is a `piu`, a `SAR-` or `UAR-` label is a `sar`, a `CBU-` label is a `cbu` and an `ES-` label
is an `option_grant`. A prefix is only a first guess, not a type the user named: `CBU-3` starts as
`cbu`. Other types share these prefixes: `ES-` (RSU, SAR, CBU, certificate), `SAR-` (CBU), `UAR-`
(PIU, CBU) and `CBU-` (PIU, certificate). When the type came only from a prefix and the bootstrap answers
`not_found`, ask once which type it is, with the types listed for that prefix, then call the
bootstrap again with that type. For a prefix with no other types listed (`CN-`, `SAFE-`, `RSU-`,
`PIU-`), or when the user named the type, quote the `not_found` and stop.
When neither a type word nor one of these prefixes gives the type (for example `CC-5`, or only a
holder), ask once with `AskUserQuestion`. Never guess. For "units", offer `certificate` (an LLC's
common or preferred units), `piu`, `cbu` and `rsu`. Send only the type the user picks, also after a
`not_found`: never try the other types.

## Gates

**Required inputs**: the company, the security (label, id or holder) and the action. Each
action's own inputs are in [§ Flow](#flow) step 3. Ask only for what is missing.

**AI computation**: No. Carta computes every before and after value in the preview. You choose
only the `reason` and write the note from the user's words, and you show both.

**Confirmation**: see [Hard rule 1](#hard-rules).

## Hard rules

1. **Preview, then approval, then apply.** Never apply without the user's approval of the
   **latest** preview. Never retry `apply_plan` with an old plan.
2. **Ids only.** Previews take security ids. Get each id from the bootstrap, or from
   `cap_table__get__security` / `cap_table__list__securities`. Never send a label to a preview.
3. **The server decides.** Offer only actions, securities and fields the bootstrap marks as
   available, selectable or eligible. For anything else, quote its `why_not.message`. A
   `single_security_only` field still changes, one security per change
   ([change-flow.md § Several securities](references/change-flow.md#several-securities)).
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

1. **Bootstrap.** Call it once per change and type (twice only for the label retry in
   [§ Actions](#actions)), after any earlier apply, with `company`, `security_type` and `label` (a
   list), `security` (ids) or `holder` (the name exactly as the user wrote it). To reverse a
   cancellation or undo a termination, send `label` or `security`: `holder` finds only
   securities held now. For an
   edit, and when the user asks to see the security before a change ("show me first", "something
   looks wrong"), always send `look_first: true` on the first type's bootstrap, so the Change page
   opens before the first preview. With no field named, ask which field in one `AskUserQuestion`
   ([change-flow.md § Open the page first](references/change-flow.md#open-the-page-first)).
2. **Read the bootstrap.**
   - `blockers`: for `hard_stop`, quote `message` and `fix`, then stop. Ask about each
     `needs_decision`. Say each `informational` once.
   - `sections.actions`: an action with `available: false` cannot run. The `preview` value
     `preview_<name>` is the `cap_table__compute__<name>_preview` call.
   - `sections.securities`: never offer a row with `selectable: false`. When the user named a
     person and 2+ rows are selectable, ask which ones in one `AskUserQuestion`.
3. **Collect the inputs** for the action. Use the user's words; ask only for what is missing,
   in one `AskUserQuestion` with up to 4 questions. Dates are `YYYY-MM-DD`. Every preview also
   takes `company` and `security_type`, the same as the bootstrap that found the security. A
   preview with `changes` sends `security_type` in each item instead.
   - **Edit:** `securities` (a list of ids; the other previews take `security`), or `changes` for
     securities with different values or of several types
     ([change-flow.md § Several securities](references/change-flow.md#several-securities)). See
     [references/change-flow.md](references/change-flow.md) for fields, reason,
     note, Rule 144 and the Change page. The field formats are in
     [references/field-contract.md](references/field-contract.md).
   - **Cancel:** `security`, `cancel_date` (not in the future), `cancel_reason`, and `notes`.
     Send `relationship` when the reason is `Relationship change`. For a certificate, RSA or
     PIU from an equity plan, ask whether the shares go back to the plan pool (`return_shares`).
   - **Partial cancel:** `security`, `effective_date` and `quantity`. The last tranches go first.
   - **Reverse cancel:** `security` and `reason`. `notes` is required when the reason is
     `Other - describe below`.
   - **Undo termination:** `security` only.
4. **Preview.** Every change goes through the preview in [§ Actions](#actions), never
   `cap_table__mutate__modify_issuable`, which keeps no Change page. Send this pass's
   `thread_id` (see [§ Several changes](#several-changes)). A rework is one new preview on
   the same thread. That holds after the cap table changed under a preview too (the page says
   so, or apply answers `plan_stale`): preview again with the same `thread_id`, never a new
   bootstrap, so the page shows the next revision.
   `status: blocked` (no `plan_id`): quote each failed check, ask for the fix, ask no approval.
5. **Show the preview.** With `next_step` and the browser tool it names, follow it, then keep
   the chat to one line: the count, the fields, the reason, any problem and the full text of a
   legend that changes. Else show a table with the header `| Security | Field | Before | After |`
   (for a partial cancel, the tranches). Put the table in the `preview` of the **Apply** option
   in step 7, never in the question and never as text before the question: the host shows text
   between tool calls only as a one-line summary, so the user never sees a table there. When
   step 7 shows the approval card, put the table in your last message, after `view_remote`.
   Post every `companion_url` as `[See it in Carta](<companion_url>)`, never as a bare address.
   Put the link of the latest page in your last message: after the answer to a question, after
   a blocked preview and after a `look_first` bootstrap. A link in a question is not a link.
6. **List the side effects.** Show every `side_effects` label with the table, before the approval.
   Name each one that cannot be undone, such as an email to a holder.
7. **Approval.** When the email side effect counts more emails than holders, first ask **"Send these N
   emails?"** as [change-flow.md § Several securities](references/change-flow.md#several-securities)
   **Emails** says, also before an approval card. Ask one `AskUserQuestion`: **"Apply this change?"**, options **"Apply"** (first,
   with the step 5 table in its `preview`) and **"Not now"**. When `how_to_reply` names an
   approval card, show that card with `view_remote` instead. On "Not now", apply nothing and say so.
8. **Apply.** Call the named `cap_table__mutate__apply_plan` tool with `company`, the latest
   `plan_id` and its `summary` unchanged. If `ToolSearch` found no apply tool, apply nothing:
   *"Carta's apply tool isn't available in this chat, so nothing was changed. Reconnect Carta
   and ask again."*
   - A `task` comes back: read `cap_table__get__task` until `done` is true, at most 3 times.
     Then say the job is still running in Carta.
   - An error, or a task that ends `failed` or `partially_failed`: follow
     [§ Error Handling](#error-handling).

## Error Handling

Quote Carta's `message` word for word in each case ([Hard rule 4](#hard-rules)).

| Situation | What to do |
|---|---|
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |
| 403, `role_required` or access denied | Say the user's role on this company cannot make this change. Do not retry. |
| `scope_required` | Ask the user to grant access as its `fix` says. Call again only after they confirm. |
| `workflow_unavailable` | Say to make this change in the Carta web app. Stop. Do not retry, and never use `cap_table__mutate__modify_issuable`. |
| `out_of_scope` | Say the user's access does not reach these securities or their plan. Stop. Do not retry. |
| `not_found` on `thread_id` | Preview again with no `thread_id`. The page then has a new address: post the new `companion_url`. |
| `not_found` on `security` or `securities` | Call the bootstrap again to get the ids. Never guess an id. |
| Bootstrap `not_found` on `label` | Make sure `label` is a list, one label per item. Then follow [§ Actions](#actions). |
| Bootstrap "Unknown field in `fields`" | `fields` picks bootstrap sections, not the fields to edit. Leave it out. |
| Preview `unknown_param` or `reason_why` too long | Do what its `fix` says (for example `notes` → `note`, `reason_why` at most 140 characters), then preview again once. |
| `invalid_argument` | Do what its `fix` says (for example, get ids from the bootstrap, or send `changes` alone). Ask the user only for a value that only the user knows, such as a quantity, a date or a name. Never pick a value yourself. Then preview again once. |
| `summary_mismatch` | Call the apply tool again once, with the `summary` of the latest preview copied with no change. |
| `too_large` on `security` | Split the securities into parts of the size Carta's `message` names, one change per part ([change-flow.md § Several securities](references/change-flow.md#several-securities) step 4). |
| `too_large`: "The response is larger than the token budget" | Read again with fewer securities or fewer `fields`. |
| `throttled` | Say Carta is busy. Wait, then call again once. If it fails again, stop. |
| `internal_error` on apply | Call the apply tool again once with the same `plan_id` and `summary`: a plan applies only once, and a second call returns the stored result. If it fails again, say Carta has a temporary problem and the change may or may not have been applied. Read the securities before any new preview. |
| `internal_error` on a read or preview | Follow the error's `fix`. If it has no `fix`, call again once. If it fails again, say Carta has a temporary problem. Stop. |
| `plan_stale`: "The cap table changed after the preview." | Say a security changed in Carta after the preview. Preview again on the same `thread_id`, then ask for approval of the new preview. |
| `plan_stale`: "Revision N of this preview replaced this plan." | A newer preview on the thread replaced this plan. Apply nothing. Show the summary of revision N, then apply its `plan_id` only after the user approves it. If you do not hold revision N's `plan_id` and `summary`, preview again on the same `thread_id` and ask for approval of that preview. |
| `plan_expired` | Preview again on the same `thread_id`, then ask for approval again. |
| Task `failed` or `partially_failed` | Name each security that did not change and quote its row `error`. Do not apply the same plan again. Offer a new preview of only those securities, after the user fixes what the error names. |

## Several changes

One approval applies one change: one action and one reason. An edit can change securities of
several types, each with its own values, in one preview with `changes`, up to
`limits.max_securities` securities
([change-flow.md § Several securities](references/change-flow.md#several-securities)). Cancels,
partial cancels, reverse cancels and undone terminations take one security each. Different
reasons are separate changes. Run each change as its own pass through steps 1 to 8, and say the
split first, with the type of each security: *"These are two changes, an edit of certificate CS-1
and a cancel of option grant ES-12. I'll apply them one at a time, starting with CS-1."* Each pass
opens its own page with its own bootstrap and sends that pass's `thread_id`, never an earlier
pass's.

## Closing

End the run with one short message and nothing after it:

- One line: what was done and on which company.
- One bullet per security that changed: label, field, before → after.
- One bullet per change that was not applied.
- The page link as `[See it in Carta](<companion_url>)`.
- One line only for something that cannot be undone or is still running, such as an email to a
  holder or a job still in progress.

```
2 option grants updated on Meetly.
- ES-218 · Board approval date 08/01/2022 → 06/15/2024
- ES-219 · Board approval date 08/01/2022 → 06/15/2024
```

Leave out the reason, the note and the audit log (the Change page and Carta show them), and
any repeat of the request, of what Carta reported, or of an offer to do more.
