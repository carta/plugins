# Change data requirements with the interactive form

An MCP App view that changes what a group of companies is **always** asked for, across four steps,
and saves it itself. Use it in place of asking for the requirements one group at a time.

This is the standing configuration, not one send. Read `references/data-requirements.md` for what
the fields mean and what the write does; this file only decides whether the form opens.

**This file overrides Step 0 for everything the form collects.** Step 0 says to ask for what
reading cannot answer; that does not reach the companies or the requirements. An unclear company
is a prefill this form resolves, not a question of your own.

## First decide whether to open it at all

The form exists to collect what is missing. A user who has already said which companies and what to
ask them for should not be walked through four steps of their own answers.

| What they have given | Do this |
|---|---|
| Nothing beyond the firm | Open it empty |
| The companies but not the requirements | Open it with the companies prefilled |
| The requirements but not the companies | Open it, and pass no selection |
| Everything | Do not open it. Go to [Skip the form](#skip-the-form) |

Everything means both of:

- at least one company
- the complete set of files, document types and metrics those companies should ask for from now on

**"Complete" is the whole bar here, and it is higher than it looks.** The write is a replacement:
every company named ends up asking for exactly what was stated and nothing else. "Also ask Meetly
for a board deck" is *not* everything — it is a change to a set you have not read, and you cannot
turn it into a full set without knowing what Meetly asks for today. Either open the form, or read
the current requirements first and confirm the resulting full set.

## Open it

```
view_remote({"name": "data_collection:view:requirements_edit",
             "params": {"organization_pk": "<org_pk>"}})
```

Pass the companies the user already named, so the form opens with them ticked:

```
view_remote({"name": "data_collection:view:requirements_edit",
             "params": {"organization_pk": "<org_pk>",
                        "company_names": ["Meetly", "KJMW"]}})
```

`company_names` is the names **as the user said them** — the view matches them against the roster
itself, so do not read the roster first and do not translate them to ids. A name that matches
nothing is dropped, and a name that matches more than one is left unselected rather than guessed.

For "all of them" / "every company" / "the whole portfolio", pass `select_all_companies: true`
instead of listing names. Past the roster's paging ceiling this deliberately selects nothing rather
than a subset that looks like everything — replacing requirements on part of a portfolio the user
believes is all of it is the worst outcome here, and the form's own select-all still covers what is
on screen.

**Only the selection prefills.** The requirements never do, and this is deliberate rather than
missing: a ticked box reads as "what these companies ask for today" when it would actually mean "and
nothing else". The boxes open empty and the form says so on every step. Do not describe it to the
user as editing or adding to their current setup.

**The view loads the roster, the metric vocabulary and the firm's own document types itself.** Do
not pass them in and do not read them first.

**A named metric or document type the firm never defined is an offer to create it.** "Always ask
them for an insurance certificate" at a firm with no such document type cannot be ticked until the
definition exists. Say so and ask whether to create it: the form itself can — the metrics step has
a **New metric** button and the files step a **New document type** button, which create the
definition and tick it in place — or follow `references/custom-metrics.md` /
`references/document-types.md` and reopen the form. Name any near-match in the same question, so
an existing entry is picked over a duplicate.

### Filtering by something the roster does not carry

A scope like "my Healthcare companies" or "everything in Fund III" is a filter on the roster, not a
list of names. Resolve it first with `data_collection__list__companies` — `tags` / `tag_ids` for a
firm-assigned label, `funds` / `fund_ids` for a holding fund — then pass the resulting names as
`company_names`. Say which companies you resolved, so a wrong filter is caught before the form
rather than after the save.

## After it opens

**The form saves the change itself.** Stop after opening it and wait. Do not call
`data_collection__update__requirements` as well — that would write twice.

Do not ask for any of the requirements yourself once it is open; the form is asking.

## Skip the form

When the user has already given everything, do not open the form. Summarize what you are about to
do, ask them to confirm, and **end your reply**. Then write with
`data_collection__update__requirements`, following `references/data-requirements.md` from Step 3.

**The summary is a table** — one row per setting, so the user can scan for the one they want to
change. It names things the way the user does: companies by name, requirements by label, never a
file code or a metric mnemonic.

```
Here's the new setup for 2 companies at Krakatoa Ventures. This replaces what they ask for
from now on and does not change any request already sent.

| | Value |
|:---|:---|
| Companies (2) | • Meetly<br>• KJMW |
| Files | • Balance sheet (required)<br>• Cap table |
| Documents | Side letter |
| Metrics | • Headcount (required)<br>• ARR |
| Automated reminders | On |
 
Save this?
```

The first header cell is empty and both columns are left-aligned — the house shape for a key-value
summary. The line after the table holds a single space.

Say plainly that this replaces rather than adds, and that it does not touch a request already sent.
Never write in the same reply as the question.

## When a view cannot render

A terminal client cannot render a view. `view_remote` returns a text list instead, which says the
form opened and to wait — that is the fallback working, not a failure. Never tell the user the form
is unavailable. Fall back to the text procedure in `references/data-requirements.md` and say you are
collecting it in the conversation instead.
