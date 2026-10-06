# Edit sent requests and existing schedules

Two actions that look alike and behave oppositely. Both change something that already exists; one
merges what you send and the other replaces it.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

Read `references/files-and-metrics.md` too, before changing any requirements — it holds the file
codes, their user-facing labels, and how to read a firm's metric vocabulary.

| | A sent request | A schedule |
|:---|:---|:---|
| What it is | One company, one period, already emailed | A rule that keeps emailing |
| The write | Merges — an omitted field is unchanged | **Replaces** — an omitted field takes its default |
| Read first | To show what it asks for now | **Mandatory**, or earlier choices are silently undone |
| Wrong edit costs | One company, once | Every company, every firing, until someone notices |

Hold that difference. It is the whole reason these share a reference rather than being written
twice.

## A — Edit a sent request

### A1 — Find it

```
call_tool({"name": "data_collection__list__requests",
           "arguments": {"organization_pk": "<org_pk>", "page_size": 200}})
```

Narrow by the company the user named, and by period if they gave one. `look_back_date` filters
greater-than-or-equal, so narrow to the exact period yourself from the returned value. Add
`include_requirements: false` when you only need to find the request rather than show what it asks
for.

Keep the `id`. Never print it — say the company and the period.

### A2 — Read it

```
call_tool({"name": "data_collection__get__request",
           "arguments": {"organization_pk": "<org_pk>", "request_id": "<id>"}})
```

Show what the request asks for now, as labels, before proposing a change. The company may already
have started work against it.

### A3 — Change it

```
call_tool({"name": "data_collection__update__request",
           "arguments": {"organization_pk": "<org_pk>", "request_id": "<id>",
                         ...only the fields that change}})
```

**This one merges.** A field left out is unchanged, so send only what the user is changing. It is
the only data collection write that behaves this way.

The requirements are the exception, and they replace as a whole:

| To do this | Send |
|---|---|
| Leave the requirements alone | None of the three fields |
| State them here | `use_company_config_template: false` with `requested_files` and `requested_metrics` |
| Take each company's saved configuration | `use_company_config_template: true`, and neither list |

`due_date` must be in the future.

**The window is sent and not answered.** A request the company has already responded to returns
409. Report that plainly — the answer is in, so the request is no longer the thing to change.

## B — Change or stop a schedule

### B1 — Find it

```
call_tool({"name": "data_collection__list__schedules",
           "arguments": {"organization_pk": "<org_pk>"}})
```

Returns the enabled schedules only. A schedule the user remembers but cannot be found here is
already stopped — say so rather than looking further.

### B2 — Read it, always

```
call_tool({"name": "data_collection__get__schedule",
           "arguments": {"organization_pk": "<org_pk>", "schedule_id": "<id>"}})
```

**Not optional.** The write in B3 replaces the schedule, so this response is the only record of
what the user is not changing. Skipping it undoes their earlier choices silently.

### B3 — Replace it

```
call_tool({"name": "data_collection__update__schedule",
           "arguments": {"organization_pk": "<org_pk>", "schedule_ids": ["<id>"],
                         ...every field, not only what changes}})
```

**This one replaces.** Every field takes the value sent here, and a field left out takes its
default rather than what the schedule holds today. Restate everything from B2, changing only what
the user asked for.

Required every time: `frequency`, `send_date_rule`, `due_date_rule`, `use_company_config_template`.
The shapes match `data_collection__create__schedule` — `frequency` is `{unit, value}` with value 1,
each date rule is `{anchor, offset}`. See `references/recurring-schedule.md` for the detail rather
than restating it here.

Every schedule in `schedule_ids` gets the same settings, so call once per group that should differ.

### B4 — Stop it

```
call_tool({"name": "data_collection__disable__schedules",
           "arguments": {"organization_pk": "<org_pk>", "ids": ["<id>"]}})
```

A disabled schedule sends nothing more and drops out of `data_collection__list__schedules`. **There is no command
that re-enables one** — the way back is creating a new schedule. Say that before disabling, and
name the companies whose collection stops.

The response gives `disabled_count` and the ids submitted. It does not say which of them stopped,
so a count lower than the number of ids means some were already disabled or belong to another firm,
without naming them. Report the shortfall and read `data_collection__list__schedules` to see what still runs.

## Confirming, for both

Show a table of the change — the field, what it is now, what it becomes — with values as labels and
dates as `Mmm DD, YYYY`.

Then say the consequence in one sentence, and make it the right one:

- A request: this company has already been emailed, and changing what is asked for may not reach
  someone who has started work.
- A schedule: this changes every future send, for every company on it, until someone changes it
  again.
- Disabling: those companies get no further requests, and there is no command that puts it back.

Ask the confirmation question, end your reply, and wait. Never write in the same reply as the
question.
