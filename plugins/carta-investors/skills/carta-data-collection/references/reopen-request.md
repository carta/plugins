# Reopen a request

Set one sent request back to collecting so the company can submit again, and tell the company if
the user wants that. It covers a request the company already answered — `updated`, `processing`
or `requires review` — and one that closed with nothing submitted, `not updated`.

It is easily confused with two neighbours. Chasing (`references/status-and-overdue.md`, Step 4) is
for a request that is still open and unanswered; nothing is reopened, the company is emailed again.
Editing (`references/edit-requests.md`, part A) changes what an open request asks for or when it is
due, and refuses once the company has answered. Reopening is the step that comes **after** an
answer: it does not change the request, it lets the company answer it again.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

**Reopening emails nobody.** The status moves and the company's portal accepts uploads again, and
the company is not told. The only way they hear is the message in Step 3, which is a send and takes
the same gate as any other.

## Step 1 — Find the request

Read the requests as `references/status-and-overdue.md` Step 1 does, with `include_requirements:
false`, and resolve the company name through the roster. Narrow to the company the user named and
the period they mean; when they named no period, the most recent answered or closed request is the
one they mean, and say which period you took.

Keep the request's `id`, its `entity_id` and `entity_type`, its `status`, period and due date. Never
print the ids.

## Step 2 — Check the status

| Status now | Do this |
|---|---|
| `updated`, `processing`, `requires review` | Reopen. The company has answered and will be able to answer again |
| `not updated` | Reopen. The period closed with nothing, and this lets the company submit late |
| `requested`, `overdue` | **Nothing to reopen** — the request is still open. Say so and offer a reminder, Step 4 of `references/status-and-overdue.md` |
| `collecting` with a `sent_date` | Already open. Say so; nothing to do |
| `collecting` with no `sent_date` | Never sent. Sending it is `references/send-request.md` |

Say the status in the user's words — "Meetly answered this on Jul 2" rather than `updated`.

## Step 3 — Decide whether to tell the company

Offer the two shapes in the reply, one line each, the first marked "(Recommended)":

1. Reopen and send the company a message — they are told the portal is open again and what to do
2. Reopen quietly — the portal opens and nobody is emailed

A company that is not told has no reason to look, so the quiet shape is for a user who will reach
the company some other way. Say that in one sentence rather than letting them pick it by default.

For the message, draft it as `references/status-and-overdue.md` "Writing the reminder" says: read the
request with `data_collection__get__request` first so the draft can name what is being asked for
again, show the body verbatim in a blockquote, and let the user edit it. There is no house wording
and no subject — the body is the whole email. A reopen reads differently from a chase, so say that
the request has been reopened and why, not that something is late:

```
**Meetly** — Q2 2026

> Hi — we've reopened Meetly's Q2 2026 reporting so you can update what you sent. The
> revised balance sheet is what we're after. You can upload it from the link in your
> original request. Thanks.
```

## Step 4 — Confirm

Show what will happen as a table, then the body if there is one:

```
| | Value |
|:---|:---|
| Company | Meetly |
| Period | Q2 2026 |
| Status now | Answered Jul 2, 2026 |
| After | Collecting — the company can submit again |
| Email | Yes, the message above · No, nobody is emailed |
```

Then the two consequences, in one sentence each: the reopen cannot be undone from here, and the
company's request leaves Complete (or Closed without data) on the firm's dashboard until it
answers again. If an email goes, say it reaches people outside Carta and cannot be recalled.

Ask the confirmation question, end your reply, and wait. Never write in the same reply as the
question.

## Step 5 — Reopen

```
call_tool({"name": "data_collection__mutate__reopen_request",
           "arguments": {"organization_pk": "<org_pk>", "entity_type": "<entity_type>",
                         "entity_id": "<entity_id>", "request_id": "<id>"}})
```

One request per call. `entity_type` and `entity_id` come from the request row; the command returns
404 when they do not match the request, so take both from the same row rather than from memory.

The response is the request with `status` now `collecting`. Nothing else about it changed: the
period, the due date and the requirements are as they were.

## Step 6 — Tell the company, if the user chose that

```
call_tool({"name": "data_collection__send__reminder",
           "arguments": {"organization_pk": "<org_pk>", "rfi_id": "<id>",
                         "email_body": "<the wording the user approved>"}})
```

Reopen first, then email. The email points the company at a portal that has to be open when they
click it. The reminder replaces the email body stored on the request, as it always does.

## Step 7 — Report it

Say the request is open again and, when a message went, that the company was emailed. Then offer
the sent-requests link per `references/deep-link.md`.

**If the reopen failed**, nothing changed. Say so, say why in plain words, and offer to try again.

**If the reopen succeeded and the email failed**, say both halves plainly, in that order: the
company can submit again, and they have not been told. The reopen stands — it cannot be rolled back
from here — so offer, one line each: send the same message again, change the wording and send,
or leave it and reach the company another way. Never report "done" when the email did not go: a
user who believes the company was told will wait for an answer that is not coming.

Never print a request id, an `entity_id` or an `organization_pk`.
