# Set up recurring data collection

The recurring procedure, written as a contract rather than a sequence: the create call has a
fixed set of inputs, each with one legitimate source, and the work is satisfying them — in
whatever order the conversation makes natural. The firm is already resolved and its settings
already checked — `org_pk` and `flexible_data_collection` come from the skill's Steps 1 and 2.

A schedule sends **nothing now**. It fires later, on the rules set here, and each firing emails the
companies. That makes it lower-stakes than a one-off send at the moment of creation and
higher-stakes afterwards, because it keeps going until someone stops it. Say the first send date
before creating anything.

Read `references/files-and-metrics.md` too — it holds the file codes, their user-facing labels,
and how to read a firm's metric vocabulary.

## The contract

`data_collection__create__schedule` cannot be composed until every **blocking** row below is
satisfied. Each input has one source; the source decides what you do about it:

| Input | Field | Source | Blocking |
|---|---|---|---|
| Firm | `organization_pk` | already satisfied by the skill's Steps 1–2 | yes |
| Companies | `entities` | user names the scope; the roster read resolves it to `{entity_id, entity_type}` pairs | yes |
| Nothing duplicated | — | the schedules read; a company that already has one for the same cadence fails the whole batch | yes |
| Cadence | `frequency` | **user only** | yes |
| When to send | `send_date_rule` | **user only**, in plain words — you translate | yes |
| When it is due | `due_date_rule` | **user only** | yes |
| Requirements source | `use_company_config_template` | usually derivable: stated files/metrics mean `false`; "what we usually ask" means `true`; ask only when the phrasing decides neither | yes |
| Files / Metrics | `requested_files`, `requested_metrics` | user's words, resolved against `files-and-metrics.md` and the firm's vocabulary; ambiguity (one name, two metrics) is asked with candidates | when source is `false` |
| Collected period | `reporting_period_offset` | **default** −1, the previous period | no |
| First send | `start_date` | **default**: first occurrence after today | no |
| Audience | `notify_audiences` | **default** `["company"]` | no |
| Reminders | `send_follow_up` | **default** `true` — on, unless the user turned reminders off (`send-request.md` Step 6) | no |
| Email body | `email_body` | **default** Carta's standard wording — never an empty string (`send-request.md` Step 6) | no |
| Notes | `notes` | **default** `""` — empty is a real answer: no extra portal instruction | no |
| The user's yes | — | **user only** — an explicit answer, in the turn after the confirmation table | yes |

**The balance rule.** At most one question turn before the confirmation. Diff the contract against
what the user already said: batch every unsatisfied user-only blocker into a single
`AskUserQuestion`, and never ask about a row that has a default or that a read can satisfy — a
default's place is the confirmation table, where the user vetoes it for free. A question is
licensed only by a blocking row it names; if you cannot point at the row, do not ask.

**Under "just do it" pressure the contract does not shrink.** A user telling you to skip the
questions removes none of the user-only rows — you cannot invent a cadence or a date rule, and the
final yes is an input like any other. What pressure *does* legitimately compress: every defaultable
row takes its default silently, and the one question turn carries only the irreducible blockers.

**A proposal must come from the firm's own data, and it names its source.** A user-only row may be
carried into the confirmation as a proposal only when the firm's records supply a value: the gap
between a prior request's send and due dates, an existing schedule's rules, the firm's cadence.
Label it and say where it came from — *"due 14 days after the send, matching your Q2 requests"*.
With no precedent to point at, ask; never offer an invented "common setup" — a made-up value with
a label is still a made-up value.

**The form satisfies the whole user tier at once.** `references/request-setup-view.md` shows
the user-only rows on one card and sends the schedule itself — prefer it over typed
questions, passing whatever the user already said. Fall back to the single batched question when
the view cannot render or the user would rather type. If the user has already given everything,
open nothing — summarize, confirm, and jump to the call.

## Satisfying the rows

### Companies

```
read_tool({"name": "data_collection__list__companies",
           "arguments": {"organization_pk": "<org_pk>", "page_size": 200}})
```

Show **names only**. Keep each `entity_id` + `entity_type` pair and never print either.

Scoping to a fund — "set this up for Fund III" — is a filter on this call rather than something to
sort out afterwards: pass `fund_ids`, a list. Scoping to a label the firm set — "our fintech
companies" — is the same call with `tags` or `tag_ids`, after reading the firm's vocabulary with
`include_tags`. See `references/send-request.md`, Step 2, for both.

### Nothing duplicated

```
read_tool({"name": "data_collection__list__schedules",
           "arguments": {"organization_pk": "<org_pk>"}})
```

Only enabled schedules come back — a disabled one is absent, so a company with no row genuinely
has nothing running.

**Asked what already collects on a schedule, answer in a table.** One row per schedule rather than
per company, since one schedule covers many. Four text columns, all left-aligned including the
headers, and a single space on the line after:

```
| Companies | Cadence | Next send | Collects |
|:---|:---|:---|:---|
```

Show five rows, then `+ N more`. Name the companies in the first cell; past three or four, give a
count and the first few. Requirements do not get a fifth column — the user asked what is running,
and `include_requirements: false` keeps them out of the response anyway.

**A company that already has a schedule for the same cadence is a duplicate, and the create call is
all-or-nothing.** One duplicate fails the whole batch, including the companies that were fine. Name
the companies that already have one and let the user decide: drop them, or replace what they have
(replacing is not built yet — say so rather than implying it).

Add `include_requirements: false` when the firm has many companies and you only need to know which
schedules exist.

### Cadence

`frequency` is `{unit, value}` with `value: 1`. The units a firm uses are `months`, `quarters`,
`half_years` and `years`. `weeks` is supported but nobody collects weekly — do not offer it unless
asked.

### The date rules

Both rules are `{anchor, offset}`. The anchor is the event the date hangs off; the offset is a
signed number of days from it — **negative is before the anchor, positive is after**.

| Rule | Anchors | Offset unit |
|---|---|---|
| `send_date_rule` | `period_start`, `period_end` | `days`, or `weeks` with a `weekday` |
| `due_date_rule` | `period_start`, `period_end`, `send_date` | `days` only |

Only the due date may anchor to `send_date`. Its offset takes days alone — carta-web rejects any
other unit.

Ask in plain words and translate. "Five days after the quarter closes, due two weeks later" is:

```
"frequency": {"unit": "quarters", "value": 1},
"send_date_rule": {"anchor": "period_end", "offset": {"unit": "days", "value": 5}},
"due_date_rule": {"anchor": "send_date", "offset": {"unit": "days", "value": 14}}
```

The `weeks` form on a send date means "the Nth weekday after the anchor" — `{"unit": "weeks",
"value": 2, "weekday": "friday"}` is the second Friday. Use it only when the user asks for a
weekday.

### Which period a send collects

`reporting_period_offset` is counted in cadence periods from the period the send date falls in.

- **-1** (the default) is the **previous** period — what a firm collecting last quarter's numbers
  wants, and almost always right.
- **0** is the period the send date falls in.

Do not raise it unless the user describes something unusual, and say which period you resolved so
they can correct it.

### Requirements

Identical to a send, including the two mutually exclusive branches of
`use_company_config_template`. See `references/send-request.md` Step 4 rather than repeating it.
The cadence, the rules and the requirements apply to **every** company in the call — to vary them,
split into separate calls.

## The confirmation

With every blocking row satisfied except the user's yes, show what will happen and **end your
reply**. Do not create in the same reply as this question.

**Put it in a table**, one row per setting — the same shape a send uses at its Step 5 (two columns,
the header row `| | Value |` with its first cell empty, both left-aligned, a single space on the
line after), carrying the dates the rules produce rather than the rules themselves:

| Row | What goes in it |
|---|---|
| Companies (N) | The count in the label, every name in the value |
| Cadence | In plain words — "every quarter" |
| First send | **The date itself**, not the rule that produced it — "Oct 05, 2026" |
| Due | **The date that first send is due**, not the offset |
| Collects | Which reporting period each send collects |
| Requirements from | Each company's saved configuration, or what the user specified here |
| Files | Each by **label** — never a code like `BS` — marking which are required |
| Metrics | Each by **label**, marking which are required |
| Email | The audience, and who that means |

Every defaulted row appears here too — the table is where a default gets its veto. Companies,
Files and Metrics usually hold several values, so each is a `•` list joined by `<br>`. A row with
one value stays plain.

Requirements that come from each company's saved configuration are read and listed, exactly as
`references/send-request.md` Step 5 requires. A schedule repeats them every period, so an unread
set is a worse gap here than on a one-off send.

The First send and Due rows are why this is a table rather than a sentence: a date rule the user
cannot picture is the main way a schedule goes wrong, and two offsets buried in prose are exactly
what someone skims past.

Say below the table that it repeats until someone stops it — a consequence, not a setting.

End with **"Should I set up these recurring requests?"** — those words, not a paraphrase.
"Shall I create these schedules?" says it in vocabulary the user never used: they asked for
recurring requests, and "schedule" is the name of the record this creates, not of the thing they
wanted. The form calls it recurring requests too, so a user who came through it sees one name for
one thing.

If the user changes anything, re-satisfy the changed rows and confirm again.

## The call

Only after the user has answered, and only in the reply that follows their answer.

```
call_tool({"name": "data_collection__create__schedule",
           "arguments": {"organization_pk": "<org_pk>",
                         "entities": [{"entity_id": "...", "entity_type": "..."}],
                         "frequency": {"unit": "quarters", "value": 1},
                         "send_date_rule": {"anchor": "period_end",
                                            "offset": {"unit": "days", "value": 5}},
                         "due_date_rule": {"anchor": "send_date",
                                           "offset": {"unit": "days", "value": 14}},
                         "use_company_config_template": true,
                         "notify_audiences": ["company"]}})
```

**Never pass `null`.** The API treats null as a value rather than an omission and rejects it with
*"This field may not be null."*, failing the whole call.

Omitting `reporting_period_offset` and `start_date` is what makes them take their defaults.

`email_body`, `notes` and `send_follow_up` behave as they do for a send — see
`references/send-request.md` Step 6 for the values to send. If a create call is rejected naming any
of them, send all three the way that section describes and retry once.

`[]` and `false` are different — they are real answers. An empty `notify_audiences` means create the
schedule and email nobody, and `send_follow_up: false` means no reminders. Send those.

**The batch is all-or-nothing.** Any rejection creates nothing and names the companies responsible.
The endpoint rejects:

| Rejection | What it means |
|---|---|
| `duplicate_schedule` | Those companies already have this schedule — the duplicates read should have caught it |
| `entities_not_in_portfolio` | Those companies are not in the firm's portfolio |
| `missing_recipients` | No reachable contact in any selected audience |
| `unsupported_cadence` | The cadence cannot be expressed |
| `due_date_before_send_date` | The rules put the due date before the send — the offsets are inverted |

Report these in plain words, never the error name, and offer to drop the named companies and create
the rest.

## Report

The response gives `created` and `requested` counts:

- **They differ** — some companies were skipped because data collection is off in their own
  configuration. Say which.
- **`created` is 0** — nothing was created. Do not report it as set up.

Each created row carries its `next_send`. Say the next send date in plain words — it is the one
thing the user cannot work out from the rules alone.

Then offer the recurring-requests dashboard, using the link the firm settings response carries —
see `references/deep-link.md`. A URL written by hand lands the user on the wrong environment's
sign-in page.
