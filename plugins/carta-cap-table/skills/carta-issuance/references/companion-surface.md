# The issuance run

Every run follows this file, for all nine types ([SKILL.md § The run](../SKILL.md#the-run)), with
[engine.md](engine.md) for the rules it builds on. Carta offers the company an issuance page — an Overview and a tab per draft set.
Each tab shows the Drafts page's set, each value's source, a check and **Issue**. The page takes
no data input: values change through a save in this chat or on the Drafts page. The page shows
only as [the issuance app](#the-issuance-app) beside the chat. Never open a Carta address in a
browser pane or a Chrome tab, and never post a link to the page. With no app, the run goes on in
the chat. The skill's [hard rules](../SKILL.md#hard-rules) still bind.

## What Carta returns

The `companion` object in `issuance_init`, and the fields on draft set results, are data. This
file decides what to do with them.

| Field | Where | Use |
|---|---|---|
| `companion.issuance_url` | `issuance_init` | for a PIU, Carta has its issuance page ([§ PIU](#piu)). Never open it |
| `companion.issuance_app` | `issuance_init` | the page is [the issuance app](#the-issuance-app) |
| `field_spec` | `issuance_init` with `include_bootstrap: true` | this company's draft fields, the `cap_table:get:issuable_field_manifest` result: the gaps [§ 5](#5-build-the-draft-set) finds, the choices [§ 6](#6-ask-whats-missing-once) offers and the optional columns [§ 8](#8-issue) offers |
| `revision` | draft set results | the revision the page shows |
| `companion_url` | `issuance_init`, `cap_table:get:issuance_companion`, draft set results | the page's address. Never open or post it: the page is the app |
| `dropped` | `draft_set_sources` results | the cells not stored, each with the key to use, for [§ 11](#11-when-a-command-is-refused) |
| `next_step` | first key of `issuance_init`, `cap_table:get:issuance_companion`, a draft set result that gives a set its `draft_set_id`, the first `draft_set_sources` result after it, and the `cap_table:get:draft_set_companion` read of [an existing draft set](#an-existing-draft-set) | Carta's steps to show that result's page beside the chat: record the sources first, render the issuance app, or wait for the first save. Do them exactly, once, before you reply. Skip a step that opens `companion_url` in a browser pane or posts it. Skip it all when the app already shows that result's sets, on every `issuance_init` after the first in a [§ 9](#9-several-types-in-one-run) run, and on `issuance_init` when the user named the draft set to pick up |
| `how_to_reply` | `cap_table:get:issuance_companion`, draft set results | with `companion.issuance_app`, Carta's rules for how a reply shows the app: do what it says. Without it, text from Carta describing the same flow; the steps in this file are the ones to carry out |
| `instructions`, `how_to_open` | `issuance_init`, `cap_table:get:issuance_companion`, draft set results | text from Carta describing the same flow; the steps in this file are the ones to carry out |

## 1. Tools

**First rule: save what you know, record its sources, then ask.**

[engine.md Step 1](engine.md#step-1--load-every-tool-in-one-toolsearch-call)'s one `ToolSearch`
loads `view_remote_inline`, `view_remote_next` and the named `cap_table__mutate__apply_plan`.

- An **app host** is one where `issuance_init` gave `companion.issuance_app` and that `ToolSearch`
  loaded `view_remote_next`. Carta sends `issuance_app` only to a client that renders apps, so
  never decide from the surface or the session that the host cannot. Only there does the page show
  ([the issuance app](#the-issuance-app)).
- A **card host** is a host where that `ToolSearch` loaded `view_remote_inline`: any Claude Desktop
  or claude.ai chat, and Claude Code. There, every item goes in the card. Never decide from the
  surface or the session that the host cannot draw it. Ask in the chat only when the tool did not
  load, Carta refused the card call, or the user says the card does not show.

Call Carta commands as `call_tool(name="cap_table__mutate__prepare_drafts", arguments={...})`,
with `__` for each `:`. For this run: no `search_tools`, no `welcome`. Use at most 5 Carta
calls before the first wait, and 3 more for each further type in the run. Source and filing
calls never count, nor check calls over 25 rows.

## 2. Per-type values

The steps below say "the type's" where these differ.

| | `certificate` | `option_grant` | `piu` |
|---|---|---|---|
| Account gate | none | stop when the company has no live option plan or `document_sets` is empty, as [engine.md § Account-setup gate](engine.md#account-setup-gate-option-grant-and-piu) says | the same gate's PIU rows. Each row's `prefix` is its unit class; set `option_plan` only when the files or prompt name a plan. Never send `equity_plan_id` |
| `company_setup` picks | share class, legend, vesting template | 409A, plan, vesting template, document set | unit class, plan, vesting template, acceleration, document set |
| Summary adds | price and where it comes from, share class room left | exercise price and its 409A, pool room left | the threshold, and the plan or unit class room left |
| `set_label` | `Certificates #<draft_set_id>` | `Options #<draft_set_id>` | `PIUs #<draft_set_id>` |
| Issue button | **Issue certificates** | **Issue option grants** | **Issue PIUs** |
| `cap_table:list:securities` `type` | `certificate` | `option` | `piu` |
| Library `document_type` | `Stock Purchase Agreement`, `Board Consent`, `Equity Agreement` | `Option Agreement`, `Board Consent`, `Equity Plan` | `PIU Award Agreement`, `Board Consent`, `Equity Plan` |
| Never recommend; for every type also a jurisdiction or exemption, which person a name means, which company | a share class, a price that follows a valuation | a share class, a price that follows a valuation | a unit class, a plan, a threshold |

For `convertible_note`, `rsa`, `warrant`, `rsu`, `sar` and `cbu`, also read
[other-types.md](other-types.md): its columns add to this table, its
§ No block yet comes before [§ 5](#5-build-the-draft-set) saves a note or warrant set, and its
§ Close replaces the per-type text of [issue-and-close.md](issue-and-close.md).

## 3. Start

1. `list_accounts(search="<company name>")`.
2. `cap_table:get:issuance_init` with `corporation_id`, `security_type`, `stakeholder_names`,
   `include_bootstrap: true` and `issue_date` only when the user named a date other than today
   ([engine.md § Voice & defaults](engine.md#voice--defaults)).
3. Apply the type's account gate.

Don't repeat a call whose result brought you here.

## 4. The page

On an app host, the app renders after the first save that gives a set its `draft_set_id`, or at
[an existing draft set](#an-existing-draft-set)'s step 4, as [the issuance app](#the-issuance-app)
says. Open nothing before it. With no app host there is no
page: build, ask, review and issue in the chat.

## 5. Build the draft set

When the user names a saved draft set of this type, or gives files (rows pasted in the chat
count) and names none, first find it as [An existing draft set](#an-existing-draft-set) step 1 says. A set it finds is not built
again: follow that section in place of this one.

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
3. File each source file the user gave with no `file_id`, attached or on disk, once per run, in
   the company's document library, so the page shows it. One `cap_table:create:library_document`
   per file with `corporation_id`, `name` (its file name), `document_type` (the type the file is:
   one of the type's [§ 2](#2-per-type-values) Library `document_type` values, or `Document` when
   none fits) and one of these. The result's `document` is the file's `file_id`.
   - First try `file_key`: `cap_table:mutate:upload_url` with `filename`, then send the file in
     one shell command, each of its `fields` first, then `Content-Type` (the file's type, as
     `application/pdf`), then the file:
     `curl -sS -o /dev/null -w '%{http_code}' --form-string '<field>=<value>' --form-string 'Content-Type=<file type>' -F 'file=@<path>' '<url>'`.
     S3 answers `204`; with any other answer, or no network, that POST can't run.
   - Only when that POST can't run, and the file is under 100 KB (`wc -c <path>`), `filename`
     and `file_content_base64`: encode it with a command (`base64 -w0 <path>`) and paste its
     whole output unchanged; never type or rebuild the bytes yourself. A larger file stays
     unfiled.
4. `cap_table:mutate:draft_set_sources`, a source for every value you set, in calls of 50 rows
   (1–50, 51–100, …) until all rows are covered. Record them on every host, also with no app: the
   set keeps them for any app that opens it later. Each call has `files: {<key>: {name, file_id}}`,
   each source file of those rows once by a short key; `shared.row_columns`, the columns one
   quote on each row's page holds (a table's row: name, email, quantity, type, start date; a
   letter's equity sentence: quantity, type); and `rows: [{draft_pk, source, fields}]` with every
   row: `source` quoting those words, and `fields` (`{<column or save key>: source}`), each with
   its own quote, for any other value or source. The first call also has `shared.fields`
   (`{<column or save key>: source}`), recorded on every row of the set: each source whose page
   and quote are the same on every row (plan, price, vesting, the consent's date), never a
   `needs_input`. A document
   source is `{file: <key>, page, quote}`, with `alternatives` `[{file, page, quote, value}]` when
   documents disagree; any other source is `{kind, label, note}`. Leave out empty keys. Ask a gap
   with no Drafts column in the chat, with no source. Record them also when step 3 filed nothing:
   a source needs no `file_id`, and rows pasted in the chat take `added_by_you` sources, each
   row's `source` with that row's line as its `note`. A big set is never a reason to skip a
   source: 100 rows is two calls. Kinds:
   - `document`: `quote` is the file's exact words that give the value, copied as they are on
     the page, never a summary: the page finds and marks them in the file. Every document and
     alternative has one (a call without is refused): in a letter, the sentence with the value;
   - `company_setup`: a pick from issuance_init or `field_spec` (the type's picks), and
     with `label` `Stakeholder record` on a matched holder's `name`, `email`, `stakeholderKind` and
     `issueDateRelationship`, never `stakeholder_id`;
   - `added_by_you`: the user said it in this chat, with a `note` holding their words that
     gave the value, up to 200 characters and no other chat text;
   - `needs_input`: still missing, with a `note` saying why.
5. Reply as [§ 6](#6-ask-whats-missing-once) says.

## An existing draft set

A PIU with no `companion.issuance_url` has no page: at step 4 it goes on in the chat, as [§ PIU](#piu) says.

The user names a draft set of this type ("resume draft set 472", "the Oct 30 board consents
set"), or gives files and names none.
Keep the set this finds: never start a second one of this
type, so no `prepare_drafts` and no save without its `draft_set_id`.

1. A set named by id needs no lookup. Otherwise, before any save, one `cap_table:list:draft_sets`
   with `corporation_id` and `security_type`. A set named by name is the result whose `name`
   matches it, case-insensitively. Files with no set named match a result whose `name` names
   them (the board consent's date or title), and only once step 2's rows hold the files'
   holders. One match is the set. Several: ask which with `AskUserQuestion`, once, before loading
   any of them. None: build a new set as [§ 5](#5-build-the-draft-set) says, never load another
   set in its place, and the rest of this section does not apply.
2. `cap_table:get:load_drafts` with `corporation_id`, `security_type` and `draft_set_id`: keep
   each row's `draft_pk` and the `revision`. With no files, those rows are the working set. Files
   that list fewer rows than the set holds:
   [resume-flow.md § Cleanup unexpected draft rows](resume-flow.md#cleanup-unexpected-draft-rows).
3. `cap_table:get:draft_set_companion` with `corporation_id`, `security_type` and
   `draft_set_id`. When it leads with `next_step`, do its steps exactly, once, in place of the
   next two steps.
4. Show the page once: with [the issuance app](#the-issuance-app),
   `cap_table:get:issuance_companion` with `corporation_id` and `sets`
   `[{security_type, draft_set_id}]`, then render the app as its `next_step` says. With no app
   there is no page: go on in the chat.
5. Record sources for every saved value the files at hand give, as [§ 5](#5-build-the-draft-set)
   steps 3 and 4 say: file the files first, then `draft_set_sources` in § 5 step 4's calls. Rows
   pasted in the chat are files here too, with `added_by_you` sources, also when every value
   matches the saved one. Each open input of the read that the files leave empty is a `needs_input` source. A value the
   files give that differs from the saved one is not saved over it: it is a
   [§ 6](#6-ask-whats-missing-once) item on that cell, a `pick_one` of the file's value and
   `Keep <saved value>`. With no files, record nothing here.
6. Ask the read's `open_inputs` as [§ 6](#6-ask-whats-missing-once) says: its one card, never a
   list of the gaps in text and never "send me the values". With no open input, go on to
   [§ 8](#8-issue).
7. The reply is § 6's, with "Picked up <`set_label`>, saved earlier." as the first line of
   *What I drafted*. As there, its count line names no holder, field or value the card asks
   about.

Answers then re-save this set as [§ 7](#7-answers) says. `load_drafts` and the read take the
place of the save and its check in [§ 1](#1-tools)'s call count, and the
`cap_table:list:draft_sets` call does not count.

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

Make the `view_remote_inline` call ([The card](#the-card)) first, with no text before it. When it
answers, the reply is these parts, in this order, and no other text:

1. **What I drafted**: that heading, then 4 short lines or fewer: the files read, the holders
   matched ("2 existing, 5 new"), what you drafted and the board consent that covers it ("no
   board consent covers it yet" when none does), the type's summary items. A check message on a
   cell is an item, never a line here. A thing that needs the user and is on no cell (a banner error, a
   possible duplicate stakeholder, a file you could not read) adds one line here.
2. "N things need you, in the card above.", with N the number of items. Then look in
   `field_spec` for an empty optional column ([§ 8](#the-optional-columns-once-per-set) step 1:
   a field with `required` false, not `hidden` and with no `default_value`, that no row fills).
   Name that field to yourself. Only when you can name one, add " Ask me if you also want
   optional details." to that line: the card never posts when it is done, so the user may go
   straight to Issue. When every field has `required` true or a `default_value`, you can name
   none: the line ends at "in the card above.", with no other words. The text names no item,
   no field of an item and no value an item asks about: the card holds them, once.
3. The close, as [§ 12](#12-end-every-turn-that-wrote) says. It is the last line of the reply.

```
**What I drafted**
- Read 6 files: 5 offer letters and an Exhibit A.
- 100 holders: 2 existing, 98 new.
- 100 option grants on the 2024 plan, under the board consent of 10/02/2026.
- Exercise price $1.50 from the 409A of 06/30/2026; 412,000 options left in the pool.

5 things need you, in the card above.

<the close, as § 12 says>
```

In this example, every `field_spec` field is required or has a default, so the count line ends
at "in the card above.".

With no item, there is no card: go on to [§ 8](#8-issue); its optional columns decide the reply.

### The card

On a card host, one `view_remote_inline` with `name: cap_table:view:draft_set_card` and params
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

Only where the card host rule of [§ 1](#1-tools) sends the run to the chat. Build first: the
first question comes after [§ 5](#5-build-the-draft-set) saved the set and recorded its sources,
never before the save. Then, in place of the card, one `AskUserQuestion` with the first 4 items,
one question each (up to 4 options each), and with more items, one more `AskUserQuestion` after
its answers, also when the user left every answer open. Never ask one item per call, and never
put two items in one question. A `type_value` item, a check error with no value to propose
included, offers no value of your own, also no "today" for a date: its options are
`I'll type it` and `Leave it for now`, and the user types the value as the free-text answer. A picked option label
is never a value: `Leave it for now`, or `I'll type it` with nothing typed, is no answer, so save
nothing for that item, and it stays open. Write no text before the first question, and never
list the items in text. After the answers, save the real answers as § 7 says. The reply then is
these parts, in this order, and no other text:

1. The *What I drafted* block of [The reply](#the-reply). A check warning is an item, so it is
   never a line there.
2. "Saved your N answers.", with N the saved answers only. With none, leave the line out.
3. While items are open, this line word for word, with only N changed: "N things still need
   you. Say when, and I'll ask again." Nothing goes between its two sentences. Else § 8.
4. The close.

Outside § 8's review, the reply names no item: the user just saw them in the questions. So no
list of the open items, no field, no value, no check message.

```
**What I drafted**
- 1 holder: Alex Rivera, an existing stakeholder.
- 1 option grant on the 2024 plan; no board consent covers it yet.
- Exercise price $1.50 from the 409A of 06/30/2026; 500,000 options left in the pool.

4 things still need you. Say when, and I'll ask again.

<the close, as § 12 says>
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
3. `cap_table:mutate:draft_set_sources` for changed values, in [§ 5](#5-build-the-draft-set)
   step 4's calls of 50 rows, each value in its row's `fields` as `added_by_you`, with no
   `shared` and no row `source`, each `note` the user's words for it.

After either path, a check warning on a value the user just gave, in the card or in the chat, is
not a new item: the user chose that value, and the page shows the warning. A check error on it is
an item.

`new_person` on a which_person item: save the row's `name` and `email`, no `stakeholder_id`. On
an option grant, a choice the board consent doesn't approve: say the row will be held for board
approval, and offer to draft an amended consent.

Never start a second draft set of this type. The app follows each save by itself. The reply
still ends as [§ 12](#12-end-every-turn-that-wrote) says.

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
3. `No, review and issue`, or no column picked: go on to the review below, then the close.
   A reply in the turn that built the set starts with part 1 of [The reply](#the-reply), one
   time; § 8 adds it in no later turn. A free-text answer picks the empty optional columns whose
   `label` it names.
4. Each picked column: on a card host, one `need_input` card ([The card](#the-card)), never an
   `AskUserQuestion`, also right after the step 2 question, and the reply is as
   [The reply](#the-reply) says; elsewhere, as [No card host](#no-card-host) says. It asks the
   column's value for every row, one item per row: a `pick_one` with the field's `values` and
   `enum_labels` when it has them, else a `type_value` with `input` from its `type`, each `body`
   saying the column is optional. Save the
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

**Where the issuance app shows**, the app's Issue is the one gate. Once no input is
open and the check is clean, say these words, with the type's Issue button from § 2 in place of
`<Issue button>`, and no other sentence about the check or the issue: "All set. Review the draft
set in the app and issue it there with **<Issue button>** at the bottom of the page." Never
issue it from the chat there.

**Once you told them to issue in the app**, call `cap_table:get:draft_set_companion` once with
`wait_for_issue: true`. `issue_state` `done`: say [What issued](#what-issued), then
`issue_summary.sentence`, then [§ 10](#10-follow-through). `failed`: say the app shows why. `running`: say the app is
still issuing. Null: if `status` is `issued`, `partially_issued` or `pending_board_approval`,
close on it with § 10; otherwise say Issue is not pressed yet.

**Elsewhere**, read `cap_table:get:draft_set_companion`, then preview the issue as
[issue-and-close.md § The preview](issue-and-close.md#the-preview) says. Unless the preview is
blocked, ask one `AskUserQuestion` naming the preview's `revision`: "Issue revision 7?". Its Issue
option's `preview` holds the review, with `issue_summary`'s agreement, signatories and holders to
email from the read, and the preview's `summary`. Never print the review as prose before the
question: the host shows that prose only as a one-line summary. Once confirmed, apply the plan and
read its job as [issue-and-close.md § Apply the plan](issue-and-close.md#apply-the-plan) says. Not
confirmed: say "The draft set is still a draft. Nothing is issued yet.", then the close, as
[§ 12](#12-end-every-turn-that-wrote) says; outside the turn that built the set, add no *What I
drafted* block.

#### What issued

The read's `issue_result`: its `detail` word for word, then each `issued` row's `label` and
`holder_name`. Its `board_approval` is the step for the `held` rows: `create_consent`, create
the board consent; `view_consent`, view the board consent; `ask_board_admin`, only a board admin
can create it. Where the issuance app shows, the app shows it; elsewhere link its `url`. With no
`issue_result`, say the `status` only.

**Each turn on this set**, before any write, read `cap_table:get:draft_set_companion`. Its
`status`: `issued` or `partially_issued`, close; `pending_board_approval`, say the set is held
for board approval; `draft`, carry on. For each `edited_in_drafts` value, say once "I saw you
changed <title> for <holder> in Carta", and keep it. Ask its new `open_inputs` as § 6 does, and
save the answers by `payload_key`.

## 9. Several types in one run

When the files and prompt hold two or more of the types with an issuance page, build each in
this run, not one type with the others as follow-ups.

1. `cap_table:get:issuance_init` once per type, with that type's `security_type`.
2. Build one draft set per type with that type's § 5 steps 1 to 4. Never start a second set of
   one type.
3. One card per set that has items, one after the other with no text between them, then one
   reply for every set, as § 6 says: one *What I drafted* block, its lines for each set
   starting with the set's `set_label`, N counting the items of every set, then the close.
   With no card host, each question starts with its `set_label`.

Each save's render names every set of the run, so the app shows an Overview and one tab per set.
The admin issues each set from its own tab, in any order, once its inputs are answered and its
check is clean. Name the set's tab when you say it is ready. After each set issues, call
`cap_table:get:issuance_companion` with `corporation_id` and `sets`, one
`{security_type, draft_set_id}` per set in the order you built them:

- `suggested_next` names a set: say "Next: <that set's `label` in `sets`> is ready to issue on
  its tab."
- `suggested_next` is null and a set has `open_inputs`: ask for them, as above.
- Every set's `state` is `issued` or `pending_board`: close once for the run.

With no app host, confirm and issue one set at a time, each with its own revision.

## 10. Follow-through

Close as the skill does, and say where the files went: "the 5 source files are in Issuance
documents", adding "and corporate documents" when one was filed as `Document`. Name any file not
filed and ask the user to upload it to Issuance documents. On a card host, one `view_remote_inline`
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

Carry on silently: `draft_set_sources` refused twice, skip sources, and with
[the issuance app](#the-issuance-app), for a set a save just gave its `draft_set_id`, render it
now: one `view_remote_next` with the run's `sets`; a file not filed, its
sources have no `file_id`; no `view_remote_inline`, ask in the chat. Send a refused
`draft_set_sources` call again once, and each `dropped` cell again once, under the key its
`problem` names.

A refusal that has a row in [mutate-recovery.md § Errors on any call](mutate-recovery.md#errors-on-any-call)
is not the issuance page being unavailable: stay on this run, and do what its row says.

A `prepare_drafts` or `save_drafts` row with an `error {code, field, message}` is not saved: say
its `message`. With a `field`, fix that field and send the row again with its `draft_pk`; with no
`field`, do what the `message` says and do not send the row again as it was. A top-level `error`
saved no row: say its `message`, and do not send the set again.

## 12. End every turn that wrote

A turn that wrote made at least one successful `prepare_drafts`, `save_drafts`,
`validate_drafts`, `draft_set_sources`, `resolve_duplicate_stakeholder` or `apply_plan` call. Where
the issuance app shows, end its reply with "The draft set is open beside the chat." With no app
host, end a turn that leaves the set a draft with `When you are ready, say "issue them".`, as
[issue-and-close.md § Say what is live](issue-and-close.md#say-what-is-live-after-every-write)
says. At a terminal state, close as [issue-and-close.md § Closing](issue-and-close.md#closing)
says, or for a type in [other-types.md](other-types.md) as its § Close says.

One close per turn, even when the turn made several writes. Only a closing question may follow
the close: a question at the end of the reply, such as § 8's. The § 6 card comes before the
reply's text, so the close stays the last line of that text. An `AskUserQuestion` answer comes
back in the same turn, so the close goes at the end of what you write after it.

A turn whose writes all failed changed nothing: end it with no close and no address.

## The issuance app

With `companion.issuance_app` on an app host, the issuance page is an app beside the chat. Each
render stays in the chat, so render it only at these times:

- **Render it** as the result's `next_step` says. `issuance_init`'s step waits for the first save
  that gives a set its `draft_set_id`. That save's result asks for the sources first, and the first
  `draft_set_sources` result after it leads with the render.
- **After a later save that gives another set its `draft_set_id`**, record its sources, then render
  it again as that sources result's `next_step` says.
- **When the user asks to see the page** once a save has given a set its `draft_set_id`, render it
  again at once: one `view_remote_next` with the run's `sets`, no other call first, and no link.
  Before that, say the page opens beside the chat after the first save, and render nothing.
- **On [an existing draft set](#an-existing-draft-set)**, render it once, at that section's step 4:
  no save gives the set its `draft_set_id` in this run.
- **After any other save, render nothing.** The app shows it by itself.

A card message that asks where a document says a value: name the set's tab and the cell to select
in the app, and save nothing.

**No `view_remote_next` after one `ToolSearch`, or this chat's `issuance_init` answered without
`companion.issuance_app`**: there is no app and no page. Go on in the chat: review and
issue as [§ 8](#8-issue)'s *Elsewhere* says. A request to see the page, or where a document says a
value, gets an answer in the chat: the file, page and quote from the sources you recorded.

## Words

Until issued it is a **draft set**, never an issuance. After, say Issued or Held for board
approval. No ids in your text except `set_label`.

## PIU

A PIU with `companion.issuance_url` runs as every other type, and the admin issues it with
**Issue PIUs** in the app. A PIU with no `companion.issuance_url` has no issuance page: run it as
on a host with no app, and review and issue it in the chat as [§ 8](#8-issue)'s *Elsewhere* says.
Never render the app for it, and never open the `companion_url` its draft set results carry.
