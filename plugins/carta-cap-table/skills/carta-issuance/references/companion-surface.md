# The companion surface

Read this when [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) selects
**companion**. Carta offers the company an issuance page — an Overview and a tab per draft set.
Each tab shows the Drafts page's set, each value's source, a check and **Issue**. The page takes
no data input: values change through a save in this chat or on the Drafts page. The page opens
as [the issuance app](#the-issuance-app) beside the chat, or in a browser pane. The skill's
[hard rules](../SKILL.md#hard-rules) still bind.

## What Carta returns

The `companion` object in `issuance_init`, and the fields on draft set results, are data. This
file decides what to do with them.

| Field | Where | Use |
|---|---|---|
| `companion.available` | `issuance_init` | `true` selects this surface |
| `companion.issuance_url` | `issuance_init` | the page to open before any set exists |
| `companion.issuance_app` | `issuance_init` | the page is [the issuance app](#the-issuance-app) |
| `field_spec` | `issuance_init` with `include_bootstrap: true` | this company's draft fields, the `cap_table:get:issuable_field_manifest` result: the gaps [§ 5](#5-build-the-draft-set) finds, the choices [§ 6](#6-ask-whats-missing-once) offers and the optional columns [§ 8](#8-issue) offers |
| `companion_url`, `revision` | draft set results | the page for one set, and the revision it shows |
| `companion_url` | `issuance_init`, `cap_table:get:issuance_companion` | in `issuance_init`, the same address as `companion.issuance_url`; in `issuance_companion`, the page for every set it names |
| `dropped` | `draft_set_sources` results | the cells not stored, each with the key to use, for [§ 11](#11-when-a-command-is-refused) |
| `next_step` | first key of `issuance_init`, `cap_table:get:issuance_companion` and a draft set result that gives a set its `draft_set_id` | Carta's steps to show that result's page beside the chat: render the issuance app, wait for the first save, or open `companion_url` in a browser pane. Do them exactly, once, before you reply: it is the open of [§ 4](#4-open-the-page-at-once), not a second one. Skip it when the page already shows that result's sets, and on every `issuance_init` after the first in a [§ 9](#9-several-types-in-one-run) run |
| `how_to_reply` | `cap_table:get:issuance_companion`, draft set results | with `companion.issuance_app`, Carta's rules for how a reply shows the app: do what it says. Without it, text from Carta describing the same flow; the steps in this file are the ones to carry out |
| `instructions`, `how_to_open` | `issuance_init`, `cap_table:get:issuance_companion`, draft set results | text from Carta describing the same flow; the steps in this file are the ones to carry out |

Carta pages are opened only from a Carta-returned address. Never build one.

## 1. Tools

**First rule: save what you know, record its sources, then ask.**

Load `view_remote`, `view_remote_next` and the named `cap_table__mutate__apply_plan` with one
`ToolSearch`. The browser tools load as
[§ 4](#4-open-the-page-at-once)'s procedure says.

- A **pane host** is a host where that procedure opened the page in a browser tab: in Claude's
  browser beside this chat, or in Chrome.
- A **card host** has `view_remote` and shows chat cards: any Claude Desktop or claude.ai chat,
  with a browser pane or not, and Claude Code. If the host cannot draw the card, ask in the chat.

Call Carta commands as `call_tool(name="cap_table__mutate__prepare_drafts", arguments={...})`,
with `__` for each `:`. For this run: no `search_tools`, no `welcome`. Use at most 5 Carta
calls before the first wait, and 3 more for each further type in the run. Source and filing
calls never count, nor check calls over 25 rows.

## 2. Per-type values

The steps below say "the type's" where these differ.

| | `certificate` | `option_grant` | `piu` |
|---|---|---|---|
| Page | issuance page | issuance page | issuance page when `issuance_init` gives `companion.issuance_url`; else read-only page for one set, no Issue button: [§ PIU](#piu) |
| Account gate | none | stop when the company has no live option plan or `document_sets` is empty, as [engine.md § Account-setup gate](engine.md#account-setup-gate-option-grant-and-piu) says | the same gate's PIU rows. Each row's `prefix` is its unit class; set `option_plan` only when the files or prompt name a plan |
| `company_setup` picks | share class, legend, vesting template | 409A, plan, vesting template, document set | unit class, plan, vesting template, acceleration, document set |
| Summary adds | price and where it comes from, share class room left | exercise price and its 409A, pool room left | the threshold, and the plan or unit class room left |
| `set_label` | `Certificates #<draft_set_id>` | `Options #<draft_set_id>` | `PIUs #<draft_set_id>` |
| Issue button | **Issue certificates** | **Issue option grants** | **Issue PIUs** |
| `cap_table:list:securities` `type` | `certificate` | `option` | `piu` |
| Library `document_type` | `Stock Purchase Agreement`, `Board Consent`, `Equity Agreement` | `Option Agreement`, `Board Consent`, `Equity Plan` | `PIU Award Agreement`, `Board Consent`, `Equity Plan` |
| Never recommend; for every type also a jurisdiction or exemption, which person a name means, which company | a share class, a price that follows a valuation | a share class, a price that follows a valuation | a unit class, a plan, a threshold |

## 3. Start

1. `list_accounts(search="<company name>")`.
2. `cap_table:get:issuance_init` with `corporation_id`, `security_type`, `stakeholder_names`,
   `include_bootstrap: true` and `issue_date` only when the user named a date other than today
   ([engine.md § Voice & defaults](engine.md#voice--defaults)).
3. Apply the type's account gate.

Don't repeat a call whose result brought you here.

## 4. Open the page at once

Before reading the files and before any save, open `companion.issuance_url` in the same turn. With
`companion.issuance_app`, open nothing yet: the app renders after the first save, as
[the issuance app](#the-issuance-app) says. With no
`issuance_url`, the address is the page § 9 gives after the save. This one open is what the
result's first key asks for ([What Carta returns](#what-carta-returns)). Open it as
`${CLAUDE_PLUGIN_ROOT}/references/open-the-companion-page.md` says — the plugin's own
`references/`, not this skill's — read that file by that path; do not search for it. The link
text is `[Open the draft set in Carta](<address>)`, and the pane line calls the page "The draft
set". The reply's way back to the page is the close [§ 12](#12-end-every-turn-that-wrote-with-the-way-to-the-page)
puts at its end. A sign-in request goes in the same turn as § 6's questions.

## 5. Build the draft set

Once each:

1. Resolve every row from the files and prompt, as [engine.md § Phase 1](engine.md) does.
   Leave out any unknown value; never guess or wait. Each field that `field_spec`, or one of its
   `conditionalRules`, requires for the row, not `hidden`, with no `default_value` and no
   given value, is a `needs_input` cell; so is the vesting schedule when nothing gives it.
   No other field is a gap, except one the type's own reference names (a debt note's maturity
   date): with no given value, leave it out and Carta's default stands (when `field_spec` does not
   require it, a grant with no board approval date waits for the board).
   `field_spec` comes from the § 3 `issuance_init` call: make no
   `cap_table:get:issuable_field_manifest` call.
   The save's check finds missing required fields first, and the fields below only on a later
   save, so a gap you miss here comes back as a second card. Before the save, find each of these
   in `field_spec` by name, for each row:
   - `document_set_id`, `legend_id`: when `required`, the one the files or prompt name, else the
     only one in its `issuance_init` section (`document_sets`, `legends`) as a `company_setup`
     pick, else a `needs_input` cell.
   - `rule_144_date`: when `required` and no file or the prompt gives it, a `needs_input` cell.
   - Each field, not `hidden`, with no `default_value` and no given value, whose
     `conditionalRules` `when` reads a `needs_input` cell, such as `vesting_start_date`
     (`vesting_template`) and `rule_144_difference_reason` (`rule_144_date`): a
     [§ 6](#6-ask-whats-missing-once) item of its own in the same card, after that cell's item.
     Never fold it into the other item's `body`. Its own `body` says when Carta needs it. Record
     no source for it: the other answer decides if it is a gap.
2. Before the save, check each row once more against step 1's list. Up to 25 rows,
   `cap_table:mutate:prepare_drafts` with the rows in `drafts` and no `draft_set_id`. Over 25:
   one `cap_table:mutate:save_drafts` with every row, never `is_bulk_import` (it returns no
   `draft_pk`), then `cap_table:mutate:validate_drafts`. Keep `draft_set_id`, each row's
   `draft_pk` and the `revision`.
3. File each source file on disk with no `file_id`, once per run, in the company's document
   library, so the page shows it: one `cap_table:mutate:upload_url`, then one
   `cap_table:create:library_document` with `corporation_id`, `document_type` (the type the file
   is: one of the type's [§ 2](#2-per-type-values) Library `document_type` values, or `Document`
   when none fits) and its `file_key`. The
   result's `document` is the file's `file_id`.
4. `cap_table:mutate:draft_set_sources`, a source for every value you set, in calls of 10 rows
   (1–10, 11–20, …) until all rows are covered: `files: {<key>: {name, file_id}}`, each source
   file of those rows once by a short key, and
   `rows: [{draft_pk, fields: {<column or save key>: source}}]`. A document source is
   `{file: <key>, page, quote}`, with `alternatives` `[{file, page, quote, value}]` when
   documents disagree; any other source is `{kind, label, note}`. Leave out empty keys. Ask a gap
   with no Drafts column in the chat, with no source. Kinds:
   - `document`: `quote` is the file's exact words that give the value, copied as they are on
     the page, never a summary: the page finds and marks them in the file;
   - `company_setup`: a pick from issuance_init or `field_spec` (the type's picks), and
     with `label` `Stakeholder record` on a matched holder's `name`, `email`, `stakeholderKind` and
     `issueDateRelationship`, never `stakeholder_id`;
   - `added_by_you`: the user said it in this chat, with a `note` holding their words that
     gave the value, up to 200 characters and no other chat text;
   - `needs_input`: still missing, with a `note` saying why.
5. Move the page to the saved set in this turn, before the card, also when a source call failed:
   `cap_table:get:issuance_companion` with `corporation_id` and `sets`
   `[{security_type, draft_set_id}]`, then open its `companion_url` as § 4 says. With the
   command refused, open the set's `companion_url`. The page at `companion.issuance_url` never
   shows a saved set: it reads only the sets its address names. With several types,
   [§ 9](#9-several-types-in-one-run) moves it once every set is saved. With
   [the issuance app](#the-issuance-app), skip this step: the save's result renders the app.
6. Reply as [§ 6](#6-ask-whats-missing-once) says.

## 6. Ask what's missing, once

The **items** are the things that need the user and are on a cell, one item per cell: every
`needs_input` cell, every value two documents disagree on, and every other cell with a check
error or check warning (`validation.errors` and `validation.warnings`, by `draft_pk` and
column), also when the prompt or a document gave that cell's value, except a check warning on a
value the user just gave ([§ 7](#7-answers)). After each `needs_input` item come its dependent
fields, as [§ 5](#5-build-the-draft-set) step 1 says. A check message on a cell
that is already an item (a gap, or two documents that disagree) goes in that item's `body`, and
is not a second item. A check message on a cell is never a line of text. A
`cap_table:get:draft_set_companion` read's `open_inputs` are items too: `reason` `missing` is a
`needs_input` item; `invalid` is a check error, with its `messages` in the item's `body`.

### The reply

Make the `view_remote` call ([The card](#the-card)) first, with no text before it. When it
answers, the reply is these parts, in this order, and no other text:

1. **What I drafted**: that heading, then 4 short lines or fewer: the files read, the holders
   matched ("2 existing, 5 new"), what you drafted and the board consent that covers it ("no
   board consent covers it yet" when none does), the type's summary items. A check message on a
   cell is an item, never a line here. A thing that needs the user and is on no cell (a banner error, a
   possible duplicate stakeholder, a file you could not read) adds one line here.
2. "N things need you, in the card above.", with N the number of items. The line ends there,
   with one exception: the set has an empty optional column ([§ 8](#the-optional-columns-once-per-set)
   step 1: a `field_spec` field with `required` false, not `hidden` and with no `default_value`,
   that no row fills). Only then add " Ask me if you also want optional details." to that line:
   the card never posts when it is done, so the user may go straight to Issue. Before you add
   it, name to yourself the `field_spec` field that makes the exception. With no such field
   (every field has `required` true or a `default_value`), never add it. The text names no item,
   no field of an item and no value an item asks about: the card holds them, once.
3. The reply's page line, as [§ 12](#12-end-every-turn-that-wrote-with-the-way-to-the-page)
   says, alone: no line about the browser before it. It is the last line of the reply.

```
**What I drafted**
- Read 6 files: 5 offer letters and an Exhibit A.
- 100 holders: 2 existing, 98 new.
- 100 option grants on the 2024 plan, under the board consent of 10/02/2026.
- Exercise price $1.50 from the 409A of 06/30/2026; 412,000 options left in the pool.

5 things need you, in the card above.

[Open the draft set in Carta](<address>)
```

In this example, every `field_spec` field is required or has a default, so the count line ends
at "in the card above.".

With no item, there is no card: go on to [§ 8](#8-issue); its optional columns decide the reply.

### The card

On a card host, one `view_remote` with `name: cap_table:view:draft_set_card` and params
`corporation_id`, `security_type`, `draft_set_id`, `revision`, `card: need_input` and `items`,
one per item: `{id, set_label, kind, title, body, row_key, field, input, options, documents, term}`.
`options`: `[{value, label, recommended, detail}]`, every candidate; company columns are matched
to the company's. Each `body` says why the item needs the user and what Carta needs it for.

| Item | `kind` and `options` |
|---|---|
| a gap with `field_spec` `values` | `pick_one`, options from its `values` and `enum_labels`, the recommended one first |
| a gap with a `source` | `pick_one`, options from its `issuance_init` section, by `id` and `name` |
| another gap | `type_value`, with `input` (`text`, `email`, `date` or `number`) from its `type` |
| a check warning on a filled cell | `pick_one` on that cell: the value you propose, then `Keep <current value>` with the cell's current value; the `body` gives the check's message |
| a check error on a filled cell | `pick_one` on that cell with only the values you propose, no `Keep`; the `body` gives the check's message |
| a name that can be several people | `which_person`, with `term`, the name as the documents give it, and options from the stakeholder search |
| two documents disagree | `documents_disagree`, with `documents` `[{name, page, value}]`, each `value` as `save_drafts` takes it for that column, and one option per value, labelled with the value. When a board consent gives one, recommend it unless the type's *Never recommend* row lists that field, labelled `<value> · board consent` with `detail` `Board consent p.N approves it`, and label each other `<value> · needs new approval` |

Recommend an option only when a document or the prompt states it, its detail cites the company's
habit ("Your last 2 grants used it"), or it is the only candidate. Never recommend what the
type's *Never recommend* row lists. A proposed fix follows the same rule: it is an option, and
recommended only when the rule allows. A check item never offers a value that no document, the
prompt, the company's data or the check's message gives: with no value to propose, a check error is a `type_value`
item on that cell, and a check warning is a `pick_one` with only `Keep <current value>`.

### No card host

Only where there is no card host, or it cannot draw the card: in place of the card, one
`AskUserQuestion` with the first 4 items, one question each (up to 4 options each), and with more
items, one more `AskUserQuestion` after its answers. Never ask one item per call, and never put
two items in one question. A `type_value` item, a check error with no
value to propose included, offers no value of your own: its options are `I'll type it` and
`Leave it for now`, and the user types the value as the free-text answer. A picked option label
is never a value: `Leave it for now`, or `I'll type it` with nothing typed, is no answer, so save
nothing for that item, and it stays open. Write no text before the first question, and never
list the items in text. After the answers, save the real answers as § 7 says. The reply then is
these parts, in this order, and no other text:

1. The *What I drafted* block of [The reply](#the-reply).
2. "Saved your N answers.", with N the saved answers only. With none, leave the line out.
3. While items are open: "N things still need you. Say when, and I'll ask again." Else § 8.
4. The close.

Outside § 8's review, the reply names no item: the user just saw them in the questions. So no
list of the open items, no field, no value, no check message.

```
**What I drafted**
- 1 holder: Alex Rivera, an existing stakeholder.
- 1 option grant on the 2024 plan; no board consent covers it yet.
- Exercise price $1.50 from the 409A of 06/30/2026; 500,000 options left in the pool.

4 things still need you. Say when, and I'll ask again.

[Open the draft set in Carta](<address>)
```

### Possible duplicate stakeholders

A check whose `duplicates` has `has_duplicates` true, or a **Possible duplicate stakeholders**
block on the page, means a row may be a holder already on the cap table. The set does not issue
until each such row is resolved, and no Carta page resolves it: only this chat can. In the same
turn as the items, after the card or the questions, ask it in the chat, never in the card, with
the matches from `duplicates`, and resolve it as
[mutate-recovery.md § Duplicate resolution](mutate-recovery.md#duplicate-resolution) says, on the
same `draft_set_id`. Never pick for the user. A row not resolved is an open input, so § 8 waits
for it.

## 7. Answers

**Saved in the card.** Card context that starts `Saved in the card (draft set N, revision R):`
comes with the user's next message. It lists values the card already saved, with their
sources. Don't save those values and don't call `draft_set_sources` for them: make one
`cap_table:mutate:validate_drafts` call, keep the revision it returns, then go on to the other
items and § 8.

**Any other answer re-saves the same set**: an answer in the chat, or a card message that lists
values the card did not save, one line per value with its row, column key and save key. Card
items post one by one, so the revision such a message names can be older than your last save:
apply it anyway. Then:

1. One `cap_table:mutate:save_drafts` on the same `draft_set_id`, rows by `draft_pk`.
2. `cap_table:mutate:validate_drafts`.
3. `cap_table:mutate:draft_set_sources` for changed values, one call per 10 rows, as
   `added_by_you`, each `note` the user's words for it.

After either path, a check warning on a value the user just gave, in the card or in the chat, is
not a new item: the user chose that value, and the page shows the warning. A check error on it is
an item.

`new_person` on a which_person item: save the row's `name` and `email`, no `stakeholder_id`. On
an option grant, a choice the board consent doesn't approve: say the row will be held for board
approval, and offer to draft an amended consent.

Never start a second draft set of this type. The page follows each save: don't navigate it
again unless it is stuck or the user asks to see it. The reply still ends as
[§ 12](#12-end-every-turn-that-wrote-with-the-way-to-the-page) says.

## 8. Issue

### The optional columns, once per set

The first time no input is open on a set (after the build, after a `Saved in the card` context,
or after the last answer in the chat), offer the set's empty
optional columns, one time per set:

1. The **empty optional columns** are the `field_spec` fields with `required` false, not
   `hidden` and with no `default_value`, that no row of the set has a value for. With none, reply
   as step 3 says.
2. One `AskUserQuestion` with `multiSelect: true`, on every host, with no text before it:
   "Fill an optional column before you review and issue?", with the first 3 empty optional
   columns in `field_spec` order as options, each labelled with its `label` (the column's title
   on the page), then `No, review and issue`. Sets that reach this point in the same turn share
   one `AskUserQuestion`, one question per set, each starting with its `set_label`. The
   suggestions card is for after the issue, so it never asks this.
3. `No, review and issue`, or no column picked: go on to the review below, then the page line.
   A reply in the turn that built the set starts with part 1 of [The reply](#the-reply), one
   time; § 8 adds it in no later turn. A free-text answer picks the empty optional columns whose
   `label` it names.
4. Each picked column: ask its value for every row, one item per row: a `pick_one` with the
   field's `values` and `enum_labels` when it has them, else a `type_value` with `input` from
   its `type`, each `body` saying the column is optional. On a card host, the items go in one
   `need_input` card ([The card](#the-card)), never in an `AskUserQuestion`, and the reply is as
   [The reply](#the-reply) says; elsewhere, as [No card host](#no-card-host) says. Save the
   answers as § 7 says, with `added_by_you` sources. An optional row left empty is no open
   input: after these answers, go on to the review.

**Asked for optional details.** When the user asks for optional details, answer with the
question in step 2, also while card items are still open: it is the set's one offer. With no
empty optional column, say there are none. While card items are open, any answer leaves the
user to answer them: a picked column's items join the open items in one `need_input` card, and
the review waits until none is open.

Before the user answers the question, write no text of the review. Never offer a set's optional
columns again, also after a later `Saved in the card` context.

### The review

**On a pane host where the page opened, or where the issuance app shows**, the page's Issue is
the one gate. Once no input is
open and the check is clean, say these words, with the type's Issue button from § 2 in place of
`<Issue button>`, and no other sentence about the check or the issue: "All set. Review the draft
set on the page and issue it there with **<Issue button>** at the bottom of the page." Never
issue it from the chat there.

**Once you told them to issue on the page**, call `cap_table:get:draft_set_companion` once with
`wait_for_issue: true`. `issue_state` `done`: say [What issued](#what-issued), then
`issue_summary.sentence`, then [§ 10](#10-follow-through). `failed`: say the page shows why. `running`: say the page is
still issuing. Null: if `status` is `issued`, `partially_issued` or `pending_board_approval`,
close on it with § 10; otherwise say Issue is not pressed yet.

**Elsewhere**, read `cap_table:get:draft_set_companion`, then call
`cap_table:compute:issue_draft_set_preview` with `company`, `security_type`, `draft_set_id` and
`version`: copy the read's `version`, and leave it out only when the read has none. A blocked preview: say each failed check, and issue
nothing. Else ask one `AskUserQuestion` naming the preview's `revision`: "Issue revision 7?". Its
Issue option's `preview` holds the review, with `issue_summary`'s agreement, signatories and
holders to email from the read, and the preview's `summary`. Never print the review as prose
before the question: the host shows that prose only as a one-line summary. Once confirmed, apply
the plan as [issue-and-close.md § Apply the plan](issue-and-close.md#apply-the-plan) says. Then read the job with
`cap_table:get:task` and the apply's `task.task_id` until `done` is true, at most 3 times. The draft set read
does not show the job state, so never read the set in its place. When the job is done, read
`cap_table:get:draft_set_companion` one time with `issue_id`, the job's `task_id`, say [What issued](#what-issued), and close on its `status`.
A job still `running` after 3 `get:task` reads: say these words, *"The issue is
still running in Carta."*, and never apply again. Not confirmed: say "The draft set is still a draft. Nothing is issued
yet.", then the close; outside the turn that built the set, add no *What I drafted* block. A
save after the preview makes the plan stale: preview and confirm again.

#### What issued

The read's `issue_result`: its `detail` word for word, then each `issued` row's `label` and
`holder_name`. Its `board_approval` is the step for the `held` rows: `create_consent`, create
the board consent; `view_consent`, view the board consent; `ask_board_admin`, only a board admin
can create it. On a pane host the page shows it; elsewhere link its `url`. With no
`issue_result`, say the `status` only.

**Each turn on this set**, before any write, read `cap_table:get:draft_set_companion`. Its
`status`: `issued` or `partially_issued`, close; `pending_board_approval`, say the set is held
for board approval; `draft`, carry on. For each `edited_in_drafts` value, say once "I saw you
changed <title> for <holder> in Carta", and keep it. Ask its new `open_inputs` as § 6 does, and
save the answers by `payload_key`.

## 9. Several types in one run

When the files and prompt hold two or more of the types with an issuance page, build each in
this run, not one type with the others as follow-ups.

1. `cap_table:get:issuance_init` once per type, with that type's `security_type`. Open the page
   once, from the first result.
2. Build one draft set per type with that type's § 5 steps 1 to 4. Never start a second set of
   one type.
3. One card per set that has items, one after the other with no text between them, then one
   reply for every set, as § 6 says: one *What I drafted* block, its lines for each set
   starting with the set's `set_label`, N counting the items of every set, then the page line.
   With no card host, each question starts with its `set_label`.

Once every set is saved, open the run's page instead of each set's `companion_url`, which shows
only that set's tab. With [the issuance app](#the-issuance-app), skip this: each save's render
already named every set of the run.

1. `cap_table:get:issuance_companion` with `corporation_id` and `sets`, one
   `{security_type, draft_set_id}` per set in the order you built them. With one set, call it
   too.
2. Open its `companion_url` as § 4 says, with that `companion_url` as the address. It shows
   an Overview and one tab per set.

If the command is refused, the page is each set's `companion_url`, as
[§ 12](#12-end-every-turn-that-wrote-with-the-way-to-the-page)'s step 2 says.

The admin issues each set from its own tab, in any order, once its inputs are answered and its
check is clean. Name the set's tab when you say it is ready. With the command refused, each set
has its own page instead of a tab: name the set's `set_label` and point to its page as § 12's
step 2 says. After each set issues, call
`cap_table:get:issuance_companion` again with every set:

- `suggested_next` names a set: say "Next: <that set's `label` in `sets`> is ready to issue on
  its tab."
- `suggested_next` is null and a set has `open_inputs`: ask for them, as above.
- Every set's `state` is `issued` or `pending_board`: close once for the run.

Where the page did not open, confirm and issue one set at a time, each with its own revision.

## 10. Follow-through

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

Carry on silently: `draft_set_sources` refused twice, skip sources; a file not filed, its
sources have no `file_id`; no `view_remote`, ask in the
chat; no `get:draft_set_companion`, use the chat confirm in § 8. Send a refused
`draft_set_sources` call again once, and each `dropped` cell again once, under the key its
`problem` names.

A refusal that has a row in [mutate-recovery.md § Errors on any call](mutate-recovery.md#errors-on-any-call)
is not the companion being unavailable: stay on this page, and do what its row says.

A `prepare_drafts` or `save_drafts` row with an `error {code, field, message}` is not saved: say
its `message`. With a `field`, fix that field and send the row again with its `draft_pk`; with no
`field`, do what the `message` says and do not send the row again as it was. A top-level `error`
saved no row: say its `message`, and do not send the set again.

## 12. End every turn that wrote with the way to the page

With [the issuance app](#the-issuance-app), the close is that section's line, not an address.

A turn that wrote made at least one successful `prepare_drafts`, `save_drafts`,
`validate_drafts`, `draft_set_sources`, `resolve_duplicate_stakeholder` or `apply_plan` call. End its reply with one way back
to the page, as the open-the-page file of § 4 says in § The way back to the page: a user who
steps away and comes back needs it.

The address:

1. the issuance page's `companion_url`, once `cap_table:get:issuance_companion` has answered in
   this run;
2. otherwise, with several sets in this run and that command refused, each set's
   `companion_url`. In Claude's browser, the page tab shows the page of the set the reply is
   about: when the set that has open inputs or is ready to issue is not the one it shows,
   `navigate` the page tab to that set's `companion_url` as that file's § Open the address
   says, with its one retry, and the pane line names the `set_label` the page tab shows.
   Elsewhere, the reply's one link is the `companion_url` of the set the reply is about, as
   `[Open the draft set in Carta (<set_label>)](<companion_url>)`. A request to see another set
   gets that set's link, as below;
3. otherwise the `companion_url` of the latest draft set result;
4. otherwise `companion.issuance_url`.

One close per turn, even when the turn made several writes. Only a closing question may follow
the close: a question at the end of the reply, such as § 8's. The § 6 card comes before the
reply's text, so the close stays the last line of that text. An `AskUserQuestion` answer comes
back in the same turn, so the close goes at the end of what you write after it.

**The user asks to see the page** ("show me the page", "where is it?"). With the issuance app,
do as [the issuance app](#the-issuance-app) says. In Claude's browser,
`navigate` the page tab to the address (under step 2, the page of the set the user names, else of
the set the run last talked about), as that file's § Open the address says, with its one retry,
then end with the pane line and post no link. Elsewhere, post the link. A card message that asks
to show where a document says a value carries its own address on the issuance page: open that
address, not the step 1 address, as its message says, and save nothing.

A turn whose writes all failed changed nothing, so the page has nothing new to show: name no
Carta page and no address, under any label, and post no pane line unless this turn opened or
navigated the page tab.

## The issuance app

With `companion.issuance_app`, the issuance page is an app beside the chat. Each render stays in
the chat, so render it only at these times:

- **Render it** as the result's `next_step` says. `issuance_init`'s step waits for the first save
  that gives a set its `draft_set_id`, and that save's result leads with the render.
- **After a later save that gives another set its `draft_set_id`**, render it again as `how_to_reply`
  says.
- **When the user asks to see the page** once a save has given a set its `draft_set_id`, render it
  again at once: one `view_remote_next` with the run's `sets`, no other call first, and no link.
  Before that, say the page opens beside the chat after the first save, and render nothing.
- **After any other save, render nothing.** The app shows it by itself.

Where this file opens, moves or links the page, with the app:

- [§ 4](#4-open-the-page-at-once), [§ 5](#5-build-the-draft-set) step 5 and
  [§ 9](#9-several-types-in-one-run)'s move open nothing: the saves' renders above show the run.
- [§ 12](#12-end-every-turn-that-wrote-with-the-way-to-the-page)'s close is "The draft set is open
  beside the chat." No address, no pane line and no render.
- A card message asks where a document says a value: name the set's tab and the cell to select in
  the app, and save nothing.
- Never share `companion_url` or open the browser pane while the app shows.

**No `view_remote_next` after one `ToolSearch`, or the host cannot render apps**: there is no app.
Open the page as § 4 says.

## Words

Until issued it is a **draft set**, never an issuance. After, say Issued or Held for board
approval. No ids in your text except `set_label`: the link carries them.

## PIU

A PIU with `companion.issuance_url` runs as every other type, from [§ 4](#4-open-the-page-at-once),
and the admin issues it with **Issue PIUs** on the page. This section is only for a PIU with no
`companion.issuance_url`: its page is read-only and has no Issue button, so every change goes
through you as a save, and the issue is the chat confirm below. Run the issuance in the chat as
[the chat surface](chat-surface.md) does: every phase, budget and gate there still binds, files
still go through its import, and the review is still printed in the chat before the confirm.
Opening the page is not building a form or HTML of your own: chat is still the surface.

From the first save on, `save_drafts`, `validate_drafts` and `load_drafts` results carry
`companion_url` and `revision`. Keep the latest `revision`.

**Open the page after the first save.** After the save and validate, open `companion_url` as
[§ 4](#4-open-the-page-at-once) says, with `companion_url` as the address. A sign-in
request goes in the same turn as the review and the confirm. A request from a document or a CSV
follows the same rules.

**Edits re-save the same set.** An edit is one `cap_table:mutate:save_drafts` on the same
`draft_set_id`, each changed row with its `draft_pk`, then `cap_table:mutate:validate_drafts`,
then the review again. Don't open or navigate the browser again unless the user says the page is
stuck or wrong or asks to see it, and never start a second draft set for an edit. The reply
still ends as [§ 12](#12-end-every-turn-that-wrote-with-the-way-to-the-page) says. A resume reads `companion_url`
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
draft set is open on the page", never "the issuance"; after the issue, say Issued.
