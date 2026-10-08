# Create and edit data requirements

A company's **standing** requirements: what a request asks for when it is told to use that
company's own configuration, rather than stating requirements for one send. Changing them changes
every future request; it does not touch a request already sent.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

**There is a form for this, and it is usually the right way in.** Read
`references/requirements-edit-view.md` first: it opens `data_collection:view:requirements_edit`,
which shows the roster, the firm's metric vocabulary and its own document types, accepts the
companies the user already named, and saves the change itself. Follow the steps below only when that
reference says to skip the form — the user has already stated the complete new set — or when the
client cannot render a view.

Read `references/files-and-metrics.md` too, before Step 3 — it holds the eight file codes, their
user-facing labels, and how to read a firm's metric vocabulary.

**This sends nothing.** No company is emailed and no request is created. It is still a write the
user cannot undo, so Step 4 confirms before it happens.

## Step 1 — Read what the companies have now

**Name the companies you are about to change.** `entity_ids` narrows the read, and at a firm of any
size the unfiltered response is large enough to be refused outright:

```
read_tool({"name": "data_collection__get__requirements",
           "arguments": {"organization_pk": "<org_pk>",
                         "entity_ids": ["4242", "3ba0c7d2-0000"]}})
```

`entity_ids` takes a **list** of `entity_id` values, from this command or
`data_collection__list__companies`. An id the firm does not hold is dropped, so a filter matching
nothing comes back empty rather than failing. Omit it only when the user genuinely asked about the
whole portfolio — "what does everyone have saved?" — and expect a large answer.

There is also `entity_type` (`CORPORATION`, `LLC` or `FA_ISSUER`), which restricts *which* type the
ids mean. It is rarely worth sending: an id already implies its type, numeric for `CORPORATION` and
a uuid for `FA_ISSUER`.

**Do not skip this step even when the user dictated the whole change.** Step 3 needs each row's
`configuration_id`, and reading a filtered set is cheap.

One row per company asked for — every company in the firm when `entity_ids` is omitted — and not
only the configured ones. Each row carries the ten fields a firm can edit, in the shape the write
takes:

| Field | What it is |
|---|---|
| `enabled` | False means nothing is collected from that company at all |
| `requested_files`, `required_files` | File codes; required is a subset of requested |
| `requested_metrics`, `required_metrics` | Metric mnemonics, same relationship |
| `requested_documents`, `required_documents` | Integer ids of the firm's own document types |
| `send_follow_up` | Whether Carta sends reminders |
| `currency`, `currency_locked` | See Step 3 |

Three counts come back with it, all over the rows returned rather than the firm: `count` is how many
came back, `disabled_count` how many have `enabled: false`, and `unconfigured_count` how many have
nothing saved yet — those rows are Carta's defaults and carry no `configuration_id`, which matters
in Step 3. With `entity_ids` set, do not read `count` as the size of the portfolio.

Show the companies the user asked about, by name, with their requirements as labels. Never print a
file code, a metric mnemonic or a document id.

## Step 2 — Work out what changes

Ask in the user's own terms — "add the balance sheet for everyone", "stop asking Meetly for a board
deck", "make headcount required". Say back what you resolved, as names and labels.

**Every company in one call gets the same values.** To give two companies different requirements,
call once per group and say so rather than implying per-company values are possible in one go.

`enabled: false` is the switch to reach for when a firm wants to stop collecting from a company
without losing its requirements. It is not the same as removing every file and metric.

## Step 3 — Build the write

```
call_tool({"name": "data_collection__update__requirements",
           "arguments": {"organization_pk": "<org_pk>",
                         "entities": [{"entity_id": "<id>", "entity_type": "<type>"}],
                         ...the fields that change}})
```

**Send the whole row back, not only what changed.** Whether an omitted field survives depends on
the company:

| The company | An omitted field |
|---|---|
| Has a saved configuration (`configuration_id` present) | Keeps its current value |
| Has none (`configuration_id` absent, counted by `unconfigured_count`) | Is written as Carta's default |

A partial call is therefore safe on one company and destructive on another, and the read is the
only thing that tells them apart. Take the row from Step 1, change what the user asked for, and
send all ten fields.

Three rules the API enforces, none of which the field names reveal:

- **Each required list must be a subset of the requested list in the same call.** The check reads
  only what is submitted, not what is stored — so `required_files` without `requested_files` fails
  against an empty list rather than the saved one.
- **`currency_locked: true` needs a `currency` in the same call.** A lock with no code is rejected.
  `currency` is an ISO 4217 three-letter code, or null to let each company report in whichever
  currency it chooses.
- **Files and metrics take string codes; documents take integer ids** of the firm's own document
  types. A document id from another firm is rejected.

**`send_follow_up` also governs recurring sends.** Changing it here changes what a schedule for
these companies does. Say so if the user has one.

Three fields exist on the model and are **not** editable here — `memo`, the custom template and
whether it is required. Carta accepts those only from staff, so do not offer them.

## Step 4 — Confirm, then write

Show a table of what changes, one row per field that differs, with the before and after as labels:

```
| | Before | After |
|:---|:---|:---|
| Documents | • Balance Sheet<br>• Captable | • Balance Sheet<br>• Captable<br>• Board Deck / Investor Update |
```

Name the companies above the table and say how many there are. Then say, in one sentence, that
this changes what those companies are asked for from now on and does not change any request
already sent.

Ask the confirmation question, end your reply, and wait. Never write in the same reply as the
question.

The response is the firm's full requirements list, in the same shape Step 1 returned. Read the
companies you changed back out of it and report what they now ask for — do not report the values
you sent, report what came back.
