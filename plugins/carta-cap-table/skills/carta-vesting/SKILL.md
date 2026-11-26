---
name: carta-vesting
description: >-
  What a security or holder has vested and what vests next, and vesting changes with a preview
  first: schedules, start dates, removal, acceleration, performance conditions met or missed.
  Not for issuing equity or edits of other fields.
when_to_use: >-
  Use when the user asks about vesting for a named security or holder ("how much has Jane
  vested", "when does ES-12's cliff hit", "what will CS-3 have vested on 06/30/2027", "vesting for
  all of Jane's grants") or asks to change it: "put ES-12 on the 4-year monthly schedule with a
  1-year cliff", "change Jane's vesting start date", "give RSU-4 a custom schedule", "remove
  vesting from CS-9", "accelerate 10,000 of Sam's unvested options", "the board approved full
  acceleration for ES-7 when he left", "the Series B milestone was met", "mark the revenue
  target as missed", "create a new vesting schedule", "archive the old 3-year schedule". Covers
  option grants, RSUs, RSAs, SARs, CBUs, PIUs, warrants and certificates, and the company's
  vesting schedules, acceleration terms and performance conditions. Not for totals across the
  whole company, not to issue equity, not for edits of other fields, and not to stop the vesting
  of someone who left (that is a termination).
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
<carta-plugin>carta-cap-table:6.123.3</carta-plugin>

# Vesting

Read the vesting of issued securities, and change it. Carta checks each change in a
**preview** and saves it as a plan. Nothing changes until the user approves and you apply it.
To issue new equity, use `carta-issuance`. To stop the vesting of someone who left, that is a
termination: say so, send the user to the termination flow in the Carta app, and change nothing
here. An acceleration at a departure is done here.

Send `_instrumentation_v2: {"surface": "<surface>"}` with every Carta tool call, as a parameter
of the tool next to `name` and `arguments`, never in `arguments`. `<surface>` is the closest of
`chat`, `cowork`, `code-terminal`, `code-desktop`, `code-remote`, `excel`, `sdk-cli`,
`sdk-typescript` and `sdk-python`, else `other`. Run no shell command for this or any other
`_instrumentation_v2` field: send `session_id` only when your system prompt already shows it.

## Actions

| The user wants to | `name` |
|---|---|
| See vesting | `cap_table__list__vesting` |
| Find a holder's securities | `cap_table__list__ownership` |
| See the company's schedules, acceleration terms or performance conditions | `cap_table__list__vesting_templates`, `cap_table__get__vesting_template`, `cap_table__list__acceleration_templates`, `cap_table__list__performance_conditions` |
| Apply a schedule, set a custom schedule, or remove vesting | `cap_table__compute__change_vesting_preview` |
| Accelerate vesting | `cap_table__compute__accelerate_vesting_preview` |
| Record that a performance condition was met or missed | `cap_table__compute__recognize_performance_condition_preview` |
| Create, edit, archive or delete a schedule, acceleration terms or a performance condition | see [references/templates.md](references/templates.md) |

## Gates

**Required inputs**: the company, the security (label, id or holder) or the performance
condition, and for a change the action. Ask only for what is missing.

**AI computation**: No. Carta computes vesting. Never work out a vested quantity, a tranche
or an acceleration from the terms text. The only sums you make are a share of the unvested
quantity for an acceleration, the quantities of a custom schedule from the user's percents
([§ Change](#change) step 3), and the percents of a new schedule
([templates.md](references/templates.md#vesting-schedule)). Show each sum.

## Hard rules

1. **Preview, then approval, then apply.** Never apply without the user's approval of the
   **latest** preview. Apply only the `plan_id` of the latest preview.
2. **Ids only in previews.** A preview takes the security id, never a label. Take the `id` and
   the `type` from `cap_table__list__vesting`.
3. **Quote Carta's messages word for word**: failed checks, side effects and errors.
4. **No shell, no files.** Never call Bash, and write no files. When the host saves a large
   result to a file, read that file with `Read`.
5. **Never hand this skill to a background agent.** It needs the user at each approval.
6. **Plain words.** No ids in the text. Show dates as `MM/DD/YYYY`. Use the type as the unit:
   options, RSUs, shares or units.
7. **Only these vesting reads.** Never call `cap_table__get__security` or
   `cap_table__get__certificate_vesting`.

## Calls

Load the Carta tools in one `ToolSearch` before the first Carta call (query
`read_tool list_accounts`). Use whichever Carta connector is present. Every read and every
preview goes through `read_tool`, with the keys `name` and `arguments`. The apply tool is often
deferred: load it with `ToolSearch` (`+apply_plan`) before the approval question. With no Carta
tool, stop: *"I can't reach Carta. Connect Carta in your connector settings, then try again."*

Find the company as `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` says (the plugin's
own `references/`, not this skill's; read it by that path, do not search for it): *Reads* for a
read, *Writes* for a change. `list_accounts` returns `id: "corporation_pk:<n>"`; send `<n>` as
`company`.

## Read

1. **Labels.** Call `cap_table__list__vesting` with `securities` (labels or ids, comma-separated,
   at most 100) and `size: 100`. Send `as_of` (`YYYY-MM-DD`) for a date other than today, also a
   future one. When the result has `next`, call again with `after` set to it.
2. **A holder.** Call `cap_table__list__ownership` with `group_by: "stakeholder"`,
   `include_securities: true` and `search` (the name as the user wrote it). Send all their labels
   to `cap_table__list__vesting`, at most 100 per call. Send the labels, not the ids. When the user
   named a type, keep only the rows of that `type` from `cap_table__list__vesting`:
   `cap_table__list__ownership` gives RSUs, SARs and CBUs the type `option_grant`. Show and name
   only the securities of that type. Do not name the other securities, and do not say that the
   holder has other securities. When 2+ holders match, ask
   which in one `AskUserQuestion`.
3. **Show it.** For one security, lead with one sentence: how much has vested, what vests next
   and when, and when it is fully vested. Then show its tranches by date in a table with these 4
   columns: `| Date | Quantity | Vested | Running total |` (`vest_date`, `quantity`,
   `vested_quantity`, `cumulative_quantity`). `Running total` is the schedule's total up to that
   tranche, vested or not. Never fill it from `cumulative_vested_quantity`: that counts only what
   has vested, so it stops growing after the last vested tranche. Always show this table, also when
   the security is fully vested, expired or canceled. Show at most 12 tranche rows, by date: start
   at the last tranche that vested, or at the first tranche when none vested. When fewer than 12
   are left from there, show the last 12. Put each part that you leave out in one row, such as
   "36 earlier tranches". For several securities, give one row per security in a table with
   these 5 columns, in this order and with these headers:
   `| Security | Vested | Unvested | Next vest | Fully vested |`. Add no other columns. Put the
   type and the unit in the cells, such as `3,333 RSUs`. Write `None` for no next vest. Then offer
   the tranches of one. Never add up quantities of different securities.
4. **Say what matters:**
   - A tranche with no `vest_date` waits for a performance condition: name the condition.
   - `schedule.acceleration` is text that Carta does not compute: quote it, and say which event
     it needs. Never say that shares accelerated.
   - A cliff in the next 90 days, and each `forfeited_quantity`, `canceled_quantity` and
     `expired_quantity` that is more than 0.
   - Nothing unvested and a `vested_outstanding_quantity` more than 0: say that this quantity is
     not exercised (option grants, SARs and warrants) or not settled (RSUs).
   - `time_vested` means that the date passed. It does not mean that the tranche vested.
5. **Schedules and conditions.** Read them with the commands in [§ Actions](#actions).
   Percentages are percents (25 is 25%). A payout multiplier of 1 is 100%.

## Change

For every change, find the company as [§ Calls](#calls) says.

1. **Security.** Read the vesting first with `cap_table__list__vesting`, for the labels or for
   a holder's securities as [§ Read](#read) says, so the user sees what changes. For an
   acceleration with a date from the user, send `as_of` set to `acceleration_date` in this
   read. Each row gives the `id` and the `type` that the preview takes as `security` and
   `security_type`. When 2+ securities match, ask in one `AskUserQuestion`, with an option for all of them. Never guess.
   For a performance condition, skip this step: the change applies to every security that is
   linked to the condition. Say so.
2. **Nothing to change.** When the read shows nothing to change, such as no schedule to remove
   or no unvested units, still preview. Carta's failed check is the answer: quote it. First ask
   for each input that step 3 asks for, such as the quantity of an acceleration.
3. **Collect the inputs.** Use the user's words. Ask only for what is missing, in one
   `AskUserQuestion` with up to 4 questions. Send dates as `YYYY-MM-DD`, numbers as strings.
   Every preview takes `company`. A schedule change and an acceleration also take
   `security_type`, `security` (the id) and `reason` (the user's words, short).
   - **Apply a schedule:** `change: "template"`, `vesting_template` (a name or id from
     `cap_table__list__vesting_templates`; when the user named none, offer up to 4 names) and
     `vesting_start_date`. To change only the start date, send the `schedule.name` from step 1
     and the new date. For a custom schedule, ask for the new tranche dates instead.
   - **Custom schedule:** `change: "custom"`, `vesting_start_date` and `tranches`, each
     `{vest_date, quantity}`. The quantities add up to the security's quantity. When the user gives
     percents, round each quantity down to whole units, put the rest on the last tranche, and show
     the sum. Optional `schedule_name`.
   - **Remove vesting:** `change: "remove"`.
   - For a schedule change, send `vesting_template` only with `template`, and `tranches` only
     with `custom`. Ask if Carta must send an email to the holder, and send `notify_holder`. With
     no value, Carta sends the email. Send `early_exercise` only for an option grant, and only
     when the user asks. An acceleration and a performance condition take no `notify_holder`.
   - **Accelerate:** `acceleration_date` and `quantity`. Take `quantity` from the user: a number,
     "all unvested", or a share of the unvested ("half"). When the user gave none of these, such
     as "under its acceleration terms", ask for the quantity in `AskUserQuestion` before the
     preview. When `acceleration_date` came from this step, read `cap_table__list__vesting` again
     with `as_of` set to `acceleration_date`. Else use the step 1 read. Ask also when that read
     shows no unvested units. For the last two, take `unvested_outstanding_quantity` from that
     read, round a share down to whole units, and show the sum. Never take a number from the
     acceleration terms text. Carta takes the units from the unvested tranches after
     `acceleration_date`. Leave out `effective_date` unless the user gives one. Send it only for
     an option grant, RSU, SAR or CBU, and never a date after today. Carta refuses to accelerate
     a performance award.
   - **Performance condition:** `performance_condition` (a name or id from
     `cap_table__list__performance_conditions`), `met` (true or false), and when met
     `payout_multiplier` (`"1"` is 100%). When the condition's minimum and maximum payout are
     both 1, send `"1"`. Else ask. Send `evaluation_date` only when the user gives one. When a
     blocked preview asks for `repurchase_information`, show the amount of each row it names,
     ask for each amount it did not estimate, and ask for each RSA whether to forfeit the shares
     that were not earned. Never send an amount that the user did not confirm.
4. **Preview.** The first preview sends no `thread_id`. A rework of the same change is one new
   preview with the `thread_id` that its preview returned. `status: blocked` (no `plan_id`):
   quote each failed check, ask for the fix, and ask no approval.
5. **Show the preview** in the `preview` of the **Apply** option in step 6: the `summary` word
   for word, every `side_effects` label, and for a schedule change or an acceleration a table
   `| Tranche | Before | After |` from the preview's `tranches` (date and quantity). Show at most
   12 rows: the tranches that change first, then one row "N more". Name each side effect that
   cannot be undone, such as an email to a holder. Never put the table in the question or in
   text before it: the host shows text between tool calls only as a one-line summary.
6. **Approval.** Ask one `AskUserQuestion`: **"Apply this change?"**, options **"Apply"**
   (first, with the step 5 text in its `preview`) and **"Not now"**. On "Not now", apply
   nothing and say so.
7. **Apply.** Call the named `cap_table__mutate__apply_plan` tool with `company`, the latest
   `plan_id` and its `summary` unchanged. A plan expires 30 minutes after its preview. If
   `ToolSearch` found no apply tool, apply nothing: *"Carta's apply tool isn't available in this
   chat, so nothing was changed. Reconnect Carta and ask again."* When a `task` comes back, read
   `cap_table__get__task` with its `task_id` until `done` is true, at most 3 times. Then say that
   the job is still running. When its `status` is `failed`, `partially_failed` or `canceled`, do
   as [§ Error Handling](#error-handling) says.

**Several securities.** One preview changes one security. Say the split first ("These are 3
changes, one per grant. I'll apply them one at a time, starting with ES-12."), then do steps 3
to 7 for each security, each with its own approval. For schedule changes, ask about
`notify_holder` one time for all. On "Not now" for one security, ask whether to go on with the
next.

## Error Handling

Quote Carta's `message` word for word in each case ([Hard rule 3](#hard-rules)).

| Situation | What to do |
|---|---|
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |
| 403, `role_required` or access denied | Say that the user's role on this company cannot see or make this change. Do not retry. |
| `scope_required` | Ask the user to grant access as its `fix` says. Call again only after they confirm. |
| `out_of_scope` | Say that the user's access does not reach this security. Stop. |
| `not_found` on a label or holder | Ask in one `AskUserQuestion` for the label or name as Carta shows it, with the options "Type the label" and "Type the holder's name". Do not ask in text. Never pick a security by guess. |
| `ambiguous` on a label | The label matches more than one security, such as an option grant and an RSU. Ask which one in one `AskUserQuestion`, with the type and label of each `did_you_mean` row. Then read again with its id and `type`. |
| `not_found` on `security` | Read the id again with `cap_table__list__vesting`. Never guess an id. |
| `not_found` or `ambiguous` on `vesting_template` or `performance_condition` | Read the list of schedules or conditions and ask which one. |
| `invalid_argument` on `security` | Quote it. Do not preview again. |
| Other `invalid_argument`, or `unknown_param` | Do what its `fix` says. Ask the user only for a value that only the user knows, such as a date or a quantity. Then preview again one time. |
| `summary_mismatch` | Call the apply tool again one time, with the `summary` of the latest preview copied with no change. |
| `plan_stale`: "Revision N of this preview replaced this plan." | Apply nothing. Show the summary of revision N, and apply its `plan_id` only after the user approves it. If you do not hold revision N's `plan_id` and `summary`, preview again on the same `thread_id` and ask for approval of that preview. |
| Other `plan_stale`, or `plan_expired` | Preview again, with the same `thread_id` when the preview gave one. Then ask for approval of the new preview. |
| `internal_error` on apply | Call the apply tool again one time with the same `plan_id` and `summary`: a plan applies only one time. If it fails again, say that the change may or may not have been applied, and read the vesting before a new preview. |
| `internal_error` on a read or preview | Follow the error's `fix`. If it has no `fix`, call again one time. If it fails again, say that Carta has a temporary problem. Stop. |
| `too_large` on `cap_table__list__vesting` | Send fewer securities in each call. When one security is too large, say that Carta cannot return its vesting here. Stop. |
| `throttled` | Say that Carta is busy. Wait, then call again one time. If it fails again, stop. |
| Task `failed`, `partially_failed` or `canceled` | Quote the task `error` and each row `error`. Do not apply the same plan again. |

## Closing

End a change with one short message and nothing after it: one line with what was done and on
which company, one bullet per security (`ES-12 · 12,500 options accelerated to 03/01/2027`),
one bullet per change that was not applied, and one line for an email that Carta sent or a job
that is still running.
