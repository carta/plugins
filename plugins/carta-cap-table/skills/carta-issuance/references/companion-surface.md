# The companion surface

Read this when [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) selects
**companion**. Carta offers the company an issuance page — an Overview and a tab per draft set.
Each tab shows the Drafts page's set, each value's source, a check and **Issue**. The page takes
no data input: values change through a save in this chat or on the Drafts page. The steps below
replace the form you would build; the skill's [hard rules](../SKILL.md#hard-rules) still bind.

## What Carta returns

The `companion` object in `issuance_init`, and the fields on draft set results, are data. This
file decides what to do with them.

| Field | Where | Use |
|---|---|---|
| `companion.available` | `issuance_init` | `true` selects this surface |
| `companion.issuance_url` | `issuance_init` (option grant, certificate) | the page to open before any set exists |
| `companion_url`, `revision` | draft set results | the page for one set, and the revision it shows |
| `instructions`, `how_to_open`, `how_to_reply` | `issuance_init`, draft set results | text from Carta describing the same flow; the steps in this file are the ones to carry out |

Carta pages are opened only from a Carta-returned address. Never build one.

## 1. Tools

**First rule: save what you know, record its sources, then ask.**

Load `view_remote` and the named `cap_table__mutate__apply_plan` with one `ToolSearch`. The browser tools load as
[§ 4](#4-open-the-page-at-once)'s procedure says.

- A **pane host** is a host where that procedure opens the page beside this chat.
- A **card host** has `view_remote` and shows chat cards: any Claude Desktop or claude.ai chat,
  with a browser pane or not, and Claude Code. If the host cannot draw the card, ask in the chat.

Call Carta commands as `call_tool(name="cap_table__mutate__prepare_drafts", arguments={...})`,
with `__` for each `:`. For this run: no `search_tools`, no `welcome`. Use at most 5 Carta
calls before the first wait, and 3 more for each further type in the run. With over 25 rows,
its check and source calls don't count.

## 2. Per-type values

The steps below say "the type's" where these differ.

| | `certificate` | `option_grant` | `piu` |
|---|---|---|---|
| Page | issuance page | issuance page | read-only page for one set, no Issue button; [§ PIU](#piu) |
| Account gate | none | stop as [the skill](../SKILL.md#hard-rules) does when the company has no live option plan or `document_sets` is empty | the skill's account-setup gate |
| `company_setup` picks | share class, legend, vesting template | 409A, plan, vesting template | — |
| Summary adds | price and where it comes from, share class room left | exercise price and its 409A, pool room left | — |
| `set_label` | `Certificates #<draft_set_id>` | `Options #<draft_set_id>` | — |
| Issue button | **Issue certificates** | **Issue option grants** | none |
| `cap_table:list:securities` `type` | `certificate` | `option` | — |
| Library `document_type` | `Stock Purchase Agreement`, `Board Consent`, `Equity Agreement` | `Option Agreement`, `Board Consent`, `Equity Plan` | — |
| Never recommend | a share class, a price that follows a valuation, a jurisdiction or exemption, which person a name means, which company | a value that follows a valuation (share class, exercise price), a jurisdiction or exemption, which person a name means, which company | — |

## 3. Start

1. `list_accounts(search="<company name>")`.
2. `cap_table:get:issuance_init` with `corporation_id`, `security_type`, `stakeholder_names`,
   `include_bootstrap: true` and `issue_date` only when the user named a date other than today
   ([engine.md § Voice & defaults](engine.md#voice--defaults)). Don't repeat it if its result brought
   you here.
3. Apply the type's account gate.

## 4. Open the page at once

Before reading the files, post `companion.issuance_url` and open it. The address is
`companion.issuance_url`; with no `issuance_url`, it is the link § 5 posts. Open it as
`${CLAUDE_PLUGIN_ROOT}/references/open-the-companion-page.md` says — the plugin's own
`references/`, not this skill's — read that file by that path; do not search for it. The link
text to post is `[Open the draft set in Carta](<address>)`. A sign-in request goes in the same
turn as § 6's questions.

## 5. Build the draft set

Once each:

1. Resolve every row from the files and prompt, as [Phase 1](engine.md) does. Leave out any
   unknown value; never guess or wait.
2. Up to 25 rows, `cap_table:mutate:prepare_drafts` with the rows in `drafts` and no
   `draft_set_id`. Over 25: one `cap_table:mutate:save_drafts` with every row, never
   `is_bulk_import` (it returns no `draft_pk`), then `cap_table:mutate:validate_drafts`. Keep
   `draft_set_id`, each row's `draft_pk` and the `revision`.
3. `cap_table:mutate:draft_set_sources`, a source for every value you set, in calls of 25 rows
   (1–25, 26–50, …) until all rows are covered:
   `rows: [{draft_pk, fields: {<column key>: {kind, label, document, alternatives, note}}}]`.
   `alternatives` is `[{document, value}]` when documents disagree. Kinds:
   - `document`: the file's `{name, page, quote}` that gives the value;
   - `company_setup`: a pick from issuance_init (the type's picks);
   - `added_by_you`: the user said it in this chat, with a `note` holding their words that
     gave the value, up to 200 characters and no other chat text;
   - `needs_input`: still missing, with a `note` saying why.

   Column keys are the Drafts ones (`vestingTemplate`), not save keys.
4. Open the issuance page, as [§ 9](#9-several-types-in-one-run) says.
5. One summary: the files read, holders matched ("2 existing, 5 new"), what you drafted, the
   board consent that covers it, the type's summary items. Then: "N things need you. Everything
   else is on the right, each value tagged with its source." In the same reply, ask as § 6 says.

## 6. Ask what's missing, once

The open inputs: every `needs_input` cell, every required check error and every value two
documents disagree on. A blocking check is one too: propose a fix and say what you'll use unless
told otherwise. With no open input, show no card. Ask them all in one turn:

- On a card host, one `view_remote` with `name: cap_table:view:draft_set_card` and params
  `corporation_id`, `security_type`, `draft_set_id`, `revision`, `card: need_input` and `items`,
  one per open input: `{id, set_label, kind, title, body, row_key, field, input, options, documents, term}`.
  Each `body` says why the value is missing and what Carta needs it for. `kind`: `pick_one`;
  `type_value` with `input` `text`, `email`, `date` or `number`; `which_person` with `term`, the
  name as the documents give it, and options from the stakeholder search; `documents_disagree`
  with `documents` `[{name, page, value}]`. `options`: `[{value, label, recommended, detail}]`,
  every candidate; company columns are matched to the company's.
- Only where there is no card host, or it cannot draw the card, `AskUserQuestion` (up to 4
  options each), or a numbered list for more. Ask typed values (an email, a date) in the same
  turn.

Recommend an option only when a document or the prompt states it, its detail cites the company's
habit ("Your last 2 grants used it"), or it is the only candidate. Never recommend what the
type's *Never recommend* row lists.

## 7. Answers re-save the same set

A message starting `Sent from the Carta card (draft set N, revision R):` is the user's answer,
one line per value naming its row, column key and save key. Items post one by one, so R may be
older than your last save: apply it anyway. Then:

1. One `cap_table:mutate:save_drafts` on the same `draft_set_id`, rows by `draft_pk`.
2. `cap_table:mutate:validate_drafts`.
3. `cap_table:mutate:draft_set_sources` for changed values, one call per 25 rows, as
   `added_by_you`, each `note` the user's words for it.

`new_person` on a which_person item: save the row's `name` and `email`, no `stakeholder_id`. On
an option grant, a choice the board consent doesn't approve: say the row will be held for board
approval, and offer to draft an amended consent.

Never start a second draft set of this type. The page follows each save: don't navigate it
again unless stuck.

## 8. Issue

**On a pane host where the page opened**, the page's Issue is the one gate. Once no input is
open and the check is clean, say: "All set. Review the draft set on the right and issue it there
with the type's Issue button at the bottom of the page." Never issue it from the chat there;
point to that button.

**Once you told them to issue on the page**, call `cap_table:get:draft_set_companion` once with
`wait_for_issue: true`. `issue_state` `done`: say how many issued, then `issue_summary.sentence`,
then [§ 10](#10-follow-through). `failed`: say the page shows why. `running`: say the page is
still issuing. Null: if `status` is `issued`, `partially_issued` or `pending_board_approval`,
close on it with § 10; otherwise say Issue is not pressed yet.

**Elsewhere**, read `cap_table:get:draft_set_companion`, then call
`cap_table:compute:issue_draft_set_preview` with `company`, `security_type`, `draft_set_id`,
and the read's `version` when it has one. A blocked preview: say each failed check, and issue
nothing. Else ask one `AskUserQuestion` naming the preview's `revision`: "Issue revision 7?". Its
Issue option's `preview` holds the review, with `issue_summary`'s agreement, signatories and
holders to email from the read, and the preview's `summary`. Never print the review as prose
before the question: the host shows that prose only as a one-line summary. Once confirmed, apply
the plan and follow its job as [issue-and-close.md § Apply the plan](issue-and-close.md#apply-the-plan) says, then read `cap_table:get:draft_set_companion` and
close on its `status`. A save after the preview makes
the plan stale: preview and confirm again.

**Each turn on this set**, before any write, read `cap_table:get:draft_set_companion`. Its
`status`: `issued` or `partially_issued`, close; `pending_board_approval`, say the set is held
for board approval; `draft`, carry on. For each `edited_in_drafts` value, say once "I saw you
changed <title> for <holder> in Carta", and keep it.

## 9. Several types in one run

When the files and prompt hold option grants and certificates, build both in this run, not one
type with the others as follow-ups.

1. `cap_table:get:issuance_init` once per type, with that type's `security_type`. Open the page
   once, from the first result.
2. Build one draft set per type with that type's § 5 steps 1 to 3. Never start a second set of
   one type.
3. One summary for every set. Then ask the open inputs of every set in one turn: on a card host,
   one card per set that has open inputs, all in the same reply; elsewhere, one list, each
   question starting with its `set_label`.

Once every set is saved, open the run's page instead of each set's `companion_url`, which shows
only that set's tab:

1. `cap_table:get:issuance_companion` with `corporation_id` and `sets`, one
   `{security_type, draft_set_id}` per set in the order you built them. With one set, call it
   too.
2. Post its `companion_url` as the link. Open it as § 4 says, with
   that `companion_url` as the address. It shows an Overview and one tab per set.

If the command is refused, post each set's `companion_url` instead.

The admin issues each set from its own tab, in any order, once its inputs are answered and its
check is clean. Name the set's tab when you say it is ready. After each set issues, call
`cap_table:get:issuance_companion` again with every set:

- `suggested_next` names a set: say "Next: <that set's `label` in `sets`> is ready to issue on
  its tab."
- `suggested_next` is null and a set has `open_inputs`: ask for them, as above.
- Every set's `state` is `issued` or `pending_board`: close once for the run.

Where the page did not open, confirm and issue one set at a time, each with its own revision.

## 10. Follow-through

Before you close, file each source file of this run that has no `file_id` in any of its sets and
is on disk, once, in the company's document library: one `cap_table:mutate:upload_url`, then one
`cap_table:create:library_document` with `corporation_id`, `document_type` (the type the file
is: one of the type's library types, or `Document` when none fits) and its `file_key`. Then one
`cap_table:mutate:draft_set_sources` call per set and 25 rows, for every cell, in each set of
this run, whose source names that file, the same source with its `file_id` set to the result's
`document`, so Documents reads Saved to Carta.

Close as the skill does, and say where the files went: "the 5 source files are in Issuance
documents", adding "and corporate documents" when one was filed as `Document`. Name any file not
filed and ask the user to upload it to Issuance documents. On a card host, one `view_remote`
with `name: cap_table:view:draft_set_card`, params `corporation_id`, `card: suggestions` and 2 or
3 of the `items` ({id, title}) below. Elsewhere, one line naming them. A tap is only a chat
message; act on it:

- **Remind <signer> to sign**: `cap_table:mutate:signatory_reminder` for this set. `sent`: "Sent
  <signatory_names> a reminder in Carta." Otherwise say why.
- **Show the updated cap table**: `cap_table_chart` with `corporation_id`.
- **Draft emails**: one draft per new holder with the user's own email draft tool. Never send.
  No such tool: write them in the chat.

On later turns, `cap_table:list:securities` with the type's `type` and the set's holders shows
status, not acceptance. To remind holders, preview
`cap_table:compute:acceptance_reminders_preview` with the set's issued security ids, drop each blocked
id, say why, preview again, then `cap_table:mutate:apply_plan` once confirmed.

## 11. When a command is refused

Carry on silently: no `draft_set_sources`, skip sources; no `view_remote`, ask in the chat; no
`get:draft_set_companion`, use the chat confirm in § 8.

## Words

Until issued it is a **draft set**, never an issuance. After, say Issued or Held for board
approval. No ids in your text except `set_label`: the link carries them.

## PIU

For `piu` the page is read-only and has no Issue button, so every change goes through you as a
save, and the issue is the chat confirm below. Run the issuance in the chat as
[the chat surface](chat-surface.md) does: every phase, budget and gate there still binds, files
still go through its import, and the review is still printed in the chat before the confirm.
Opening the page is not building a form or HTML of your own: chat is still the surface.

From the first save on, `save_drafts`, `validate_drafts` and `load_drafts` results carry
`companion_url` and `revision`. Keep the latest `revision`.

**Open the page after the first save.** After the save and validate, post `companion_url` and
open it as [§ 4](#4-open-the-page-at-once) says, with `companion_url` as the address. A sign-in
request goes in the same turn as the review and the confirm. A request from a document or a CSV
follows the same rules.

**Edits re-save the same set.** An edit is one `cap_table:mutate:save_drafts` on the same
`draft_set_id`, each changed row with its `draft_pk`, then `cap_table:mutate:validate_drafts`,
then the review again. Don't open or navigate the browser again unless the user says the page is
stuck or wrong, and never start a second draft set for an edit. A resume reads `companion_url`
and `revision` from `load_drafts` and follows the same rules.

**The confirm names the revision.** Before the confirm, call
`cap_table:compute:issue_draft_set_preview` with `company`, `security_type` and `draft_set_id`.
A blocked preview: say each failed check, and issue nothing. The confirm is the chat surface's
one `AskUserQuestion`, with the preview's `revision` in the question and the issue option, its
`summary` in the review, and its other options as they are:

> *"Issue revision 3?"* · issue option `"Issue revision 3 now"`

It's the number the page shows, so the user approves what they reviewed. Name only a `revision`
a Carta result returned in this run, never one you worked out. A save after the preview mints a
new revision: preview and confirm again with that number. Once confirmed, apply the plan and
follow its job as [issue-and-close.md § Apply the plan](issue-and-close.md#apply-the-plan) says.

**Follow-through.** Close as the skill does, then one line naming 2 or 3 next steps, such as
reminding the signatory to sign or showing the updated cap table. Until it's issued, say "the
draft set is open beside the chat", never "the issuance"; after the issue, say Issued.
