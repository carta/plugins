# Request status and chasing overdue companies

Where a firm's requests stand, and how to chase the ones nobody has answered. Reading is the same
procedure either way; chasing adds a write that emails the company again.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

## Step 1 — Read the requests

```
read_tool({"name": "data_collection__list__requests",
           "arguments": {"organization_pk": "<org_pk>",
                         "include_requirements": false,
                         "page_size": 200}})
```

`include_requirements: false` cuts each row by about 75%. Ask for the requirements only when the
user wants to know *what* was asked for, not merely who has answered.

**The default window is not the whole history.** Omitting `look_back_date` defaults to the previous
period onward, on the firm's v1 cadence — so a quarterly firm sees about two quarters and nothing
before them. Pass the period's first day when the user names a period; it filters
greater-than-or-equal, so narrow to the exact period yourself from the returned `look_back_date`.
Never present one window as everything the firm has ever sent.

**"All the requests I've sent" is a `look_back_date`, not the default.** Asking for everything and
taking the default answers a different question than the one asked. Pass a date far enough back to
cover what the user means, expect to page, and say which date you used — the answer is only as
complete as that date, and a user who asked for all of them deserves to know where the floor is.

If `has_more` is true, fetch the rest with `page` and `num_pages` before counting anything.

### Resolve the names

**Request rows carry no company name.** Each has an `entity_id` and an `entity_type` and nothing
else that identifies the company, and Step 3 reports by name. The names come from the roster —
the same read every other route in this skill uses — matched on `entity_id`:

```
read_tool({"name": "data_collection__list__companies",
           "arguments": {"organization_pk": "<org_pk>", "page_size": 200}})
```

Page with `page` and `num_pages` until `has_more` is false, then look each request's `entity_id`
up as a string. One roster holds both id shapes: numeric for `CORPORATION`, a UUID for
`FA_ISSUER`. A row of either shape resolves here and nowhere else.

**Do not resolve through any other list.** `list_accounts` is the user's own account switcher,
`fa__list__issuer` is the fund-admin issuer table and `fa__list__entities` is the firm's funds and
GP entities. None is the data collection roster, and none carries the numeric `CORPORATION` ids —
so a request whose company is a `CORPORATION` looks unresolvable in all three while the roster
resolves it in one call. A real session went through all three, gave up on one company, and
reported it as unidentifiable; the roster had it.

An `entity_id` the roster does not hold belongs to an entity no longer associated with the firm.
Keep the row — the request is real — and say the company is no longer in the portfolio rather than
dropping it or printing the id.

Do this before Step 2. It is one read for the whole report, not one per row.

## Step 2 — Read the status

`status` comes back as one of seven values. They are the firm's view of the request, not the
company's. The last column is the section it reports under in Step 3, and the row order is the
order they sort in:

| Status | What it means | Section |
|---|---|---|
| `overdue` | Sent, past its due date, nothing back | Outstanding |
| `requested` | Sent, nothing back yet | Outstanding |
| `collecting` | The company has started, or nobody was ever asked | With a `sent_date`, Outstanding. Without one, Not sent yet |
| `processing` | Carta is working on what arrived | Outstanding |
| `requires review` | Something needs a person to look at it | Needs your review |
| `updated` | Answered | Complete |
| `not updated` | The period closed with nothing submitted | Closed without data |

**`collecting` and `processing` are Outstanding even though the company has done its part.** The
request is not finished and the firm is still waiting, which is what the user is scanning that
table for. A status that means "not done" belongs with the others that mean "not done", however far
along it is.

**`collecting` means two different things, and `sent_date` separates them.** With a `sent_date`, the
company has started. With none, the request was never sent — it exists for the period and nobody has
been asked for anything. Read `sent_date` on every `collecting` row and split them, because a
never-sent request reported as "Started" tells the user a company is working on something it was
never asked for.

The two halves go to different sections. Nothing is outstanding on a company that was never
contacted, so the never-sent ones get their own table rather than sitting with the requests the firm
is waiting on — see Step 3.

**`requires review` is the one section the firm can act on itself.** It is outstanding on the
firm's side, not the company's, so it does not belong with the requests nobody has answered — a
user chasing companies would email people who already sent their numbers.

**`overdue` is a real status, not something to compute.** Do not compare due dates yourself — read
what the API says, or a request that is a day late by your arithmetic and not by Carta's will be
reported wrongly.

Say the status in the user's words. "Nothing back yet" and "past due" read better than `requested`
and `overdue`; the raw values stay on the wire.

## Step 3 — Report it

Five tables, one row per company, in this order. One table of everything makes the user do the
sorting: the sections are five different jobs — send something, chase someone, review something,
nothing to do, and a period that produced no data — and which rows sit in which is the answer they
came for.

**The order runs most actionable first.** Not sent yet leads because it is the only section whose
cause is the firm's own inaction and the only one fixable the same minute, and because a due date
is running down against companies that have not been asked. Outstanding follows, then the two
sections that need nothing, then the one that can only be reopened.

**A section with no rows is left out entirely.** Say it in the counts instead. An empty table
under a heading reads as a loading failure rather than as good news. On a healthy firm Not sent yet
is usually absent, which is exactly why its presence should be the first thing read.

**Not sent yet** — `collecting` with no `sent_date`. The request exists for the period and nobody
at the company has been asked:

```
| Company | Period | Due |
|:---|:---|:---|
| Halcyon Grid | Q2 2026 | Aug 30, 2026 |
```

Keep the `Due` column: a deadline running down against a company that was never contacted is the
whole point of the section. Follow the table with the way out — *"These have not been sent. Sending
them is a send for the period"* — and route to `references/send-request.md` rather than describing
the fix in prose.

**Outstanding** — everything the firm is still waiting on, in Step 2's status order, and by due
date inside each status:

```
| Company | Period | Due | Status |
|:---|:---|:---|:---|
| Meetly | Q2 2026 | Aug 15, 2026 | Past due |
```

**Needs your review** — waiting on somebody at the firm:

```
| Company | Period | Due |
|:---|:---|:---|
| Field & Foundry | Q2 2026 | Aug 15, 2026 |
```

**Complete** — answered, nothing left to do:

```
| Company | Period | Due |
|:---|:---|:---|
| Aperture Materials | Q2 2026 | Aug 15, 2026 |
```

**Closed without data** — the period closed and nothing was ever submitted:

```
| Company | Period | Due |
|:---|:---|:---|
| Quarry Point Ventures | Q2 2026 | Aug 15, 2026 |
```

Follow that table with what it means and what can be done: *"The period closed with nothing
submitted. It can be reopened in Carta so the company can still send its numbers."*

Every table but Outstanding drops `Status`: every row in them carries the same one and the heading
already says it, so the column is noise. Outstanding keeps it, because it is the only section
holding more than one status and telling them apart is why that table is read.

**Closed without data is its own section, not part of Complete.** The firm has no numbers for that
company for that period, which is the opposite of complete however terminal the status looks.
Filing it under Complete tells a user everything is fine about the one row where it is not, and a
firm that believes a company reported when it did not is worse off than one told plainly.

**Do not call it final either.** A closed period can be reopened, which lets the company submit
after the fact — so this is a recoverable outcome, not a dead end. Reopening is not built into this
skill, and `references/edit-requests.md` does not write status. Say that it can be reopened in
Carta and that you cannot do it here; do not offer to.

Dates as `Mmm DD, YYYY`. Follow the tables with the counts — not sent, outstanding, needing review,
complete, and closed without data — because that is the sentence the user repeats to someone else.
Lead the counts with the not-sent number whenever there is one; a user who asked how their requests
are doing needs to hear first that some were never made. Break the
outstanding number down by status: "6 outstanding" and "6 outstanding, three of them past due" are
different pieces of news. Count closed-without-data separately rather than folding it into
complete; the whole point of the section is that those periods produced nothing.

Never print a request id, an `entity_id` or an `organization_pk`.

For one request in full, including what it asked for:

```
read_tool({"name": "data_collection__get__request",
           "arguments": {"organization_pk": "<org_pk>", "request_id": "<id>"}})
```

### Offer the next step

**The report is not the end of the reply.** A user looking at two past-due companies and two that
were never sent is one question away from acting on either, and stopping at the counts makes them
open a new request to say so. Offer the next step **in the reply itself, below the report** — a
short list, one line per option, one of them marked "(Recommended)" — and end with the question.
Not `AskUserQuestion`: the report and the options belong in one reply, the review option carries a
link a question tool cannot, and the surfaces this skill runs on do not all have that tool. Only
the options the report earned:

| Offer it when | Option | Where it goes |
|---|---|---|
| Anything is past due | Follow up on the past-due ones | Step 4 |
| Anything is `requested` and not yet due | Chase the not-yet-due ones too | Step 4 |
| Anything is in Not sent yet | Send requests | `references/send-request.md` |
| Always | Review what has come in | `references/deep-link.md`, sent requests |

**Four is the ceiling and this list is exactly four**, so every option has to be one the report
earned. Drop the ones with no rows behind them rather than offering an action against an empty set,
and never add a fifth.

**Every count in an option is the count that action will actually email.** Only `requested` and
`overdue` can be chased at all, so an option offering to follow up on six when four are reachable is
a promise the next step breaks. Each number here, and Step 4's dropped-company sentence, have to
agree.

**Past due and not yet due are separate options, never one number.** They read the same in the
Outstanding table — both are waiting on the company — but chasing them is not the same act. See
Step 4: a company whose deadline has not arrived is being nudged early, not chased late, and folding
the two into "follow up on 4" emails people who have done nothing wrong.

**Mark one recommended, from what the report showed:**

| The report showed | Recommend |
|---|---|
| Anything past due | Follow up on the past-due ones |
| Otherwise, anything in Not sent yet | Send requests |
| None of those | Review what has come in |

Past due outranks never sent. A missed deadline is the one state where the firm is already late on
something it promised somebody else, and a reminder is the cheapest way to move it. Sending a
request the firm never sent is still the firm's own to do, and stays doable after the chase goes
out — so it is the recommendation only when nothing is past due.

**Never recommend the not-yet-due chase.** It is offered because a firm sometimes wants to nudge
before a close, and it is never the default, because the default is the option people accept without
reading. An early email nobody asked for cannot be recalled.

The recommendation is one action, not a ranking of the tables. Not sent yet still leads the report,
because a never-asked company is the thing most easily missed while reading; what to do first once
it has been read is a different question.

**The review option is a link or the tracker, not a re-read.** Offer the sent-requests link per
`references/deep-link.md`, in Claude's browser or the user's own. Do not re-read the requests you have just listed and
present that as a review. When the user wants to see *what* arrived per company — which documents
came in, which are missing — that is `references/submissions.md`, a different read with the
per-item answer this route does not carry.

**The link is the firm's whole dashboard, never one company.** It is the sent-requests page for the
firm — every company, every request in the window — which is what a user reviewing what came in is
asking for. Send them there once, after the tables. Do not build a link per row, per section, or
per company: the server returns no company-scoped link, so a per-company URL would be guessed,
and a guessed URL is the thing that file exists to prevent.

**Company names in these tables are not links.** The rule that firm and fund names anchor a link
covers dashboards those names have a page for. A portfolio company in a status table has none here,
so leave the names as text and let the one dashboard link carry the navigation.

End the reply with the question and wait. The question itself writes nothing and needs no
confirmation gate — but the follow-up branch leads straight to a send, which takes the gate in
Step 4.

## Step 4 — Chase

Only for `requested` and `overdue`. Those are the two statuses a firm may still act on; anything
else means the company has already responded or Carta is mid-way through the answer.

**The Outstanding table is wider than what can be chased.** It also holds `collecting` and
`processing`, where the company has already sent something. "Chase the outstanding ones" therefore
does not mean every row of that table — take the two chaseable statuses, and say which companies
you dropped and why before confirming, so a count that shrinks from six to three is not a surprise.

**Never sent is not chaseable at all.** A reminder on a request that was never sent returns 400,
and rightly: there is nothing to remind anyone of. A user who says "chase everyone" after reading
the report means the Not sent yet rows too, so say that those need sending rather than chasing and
offer that instead — do not call the reminder and report a failure you could have predicted.

**`requested` is chaseable and usually premature.** A request whose due date has not arrived is not
late: the company has done nothing wrong and the deadline is still ahead. Nudging early is a real
thing a firm sometimes wants before a close, so it stays available — but it is a different act from
chasing a missed deadline, and the two never share a count. Chase past-due on request; chase
not-yet-due only when the user asked for that specifically.

When a not-yet-due request is in the batch, **say its due date in the confirmation**. The person
approving needs to see they are emailing a company three months ahead of its deadline, because the
word "reminder" implies lateness that is not there.

```
call_tool({"name": "data_collection__send__reminder",
           "arguments": {"organization_pk": "<org_pk>", "rfi_id": "<id>",
                         "email_body": "<the wording>"}})
```

Four things this does not do, all worth saying rather than assuming:

- **It changes nothing.** No status moves, the due date stands, the company sees the same portal.
  To change what was asked for or when it is due, that is `references/edit-requests.md`.
- **It has no wording of its own.** `email_body` is required and a blank one is rejected. Whatever
  is written here is the entire reminder, so name the period and what is still outstanding.
- **It replaces the email body stored on the request**, so the next reminder starts from this text
  rather than the original.
- **It is one request per call.** Chasing five companies is five calls.

### Writing the reminder

Draft it from what the request actually asks for — the company, the period, the due date that has
passed, and the files or metrics still outstanding. Show the draft and let the user edit it before
anything is sent.

**The report did not fetch the requirements, so fetch them now.** Step 1 reads with
`include_requirements: false`, which is right for a report and useless for a draft — a reminder that
cannot name what is missing says only "your reporting is outstanding", which the company already
knows. Read each request being chased with `data_collection__get__request` before drafting.

**One body per company, not one shared body.** `email_body` is per call, and the parts that make a
reminder worth reading — the period, the date that passed, the files still missing — differ by
company. Show the drafts together so they can be edited in one pass, and keep each short enough that
four can be read at once.

**Show the copy itself, not a description of it.** The user is approving an email to somebody outside
Carta, so what they read has to be what the company receives. Render every body verbatim in a
blockquote under the company's name — never paraphrased, never summarized, and never one sample
standing in for four:

```
**Meetly** — Q2 2026, due Aug 15, 2026

> Hi — we don't yet have Meetly's Q2 2026 reporting. Still outstanding: balance sheet and
> headcount. You can upload them from the link in your original request. Thanks.
```

An email body is prose and a pipe table cannot hold it, so this is the one thing the user checks
that is **not** a table. Every other summary in this skill still is.

**What you show is the whole email.** There is no house template around it — the body is the entire
message the company receives, so a draft that reads like a fragment ships as a fragment. The command
has no subject field either: do not draft one, and do not imply the company will see one.

Keep it short and factual. A first reminder and a fourth read differently, and only the user knows
which this is, so ask rather than guessing a tone.

### Confirming

Name every company that will be emailed, show every body in full, and say how many emails that is.
The copy and the question go in the same reply — a gate that asks the user to approve wording they
have to scroll back for is not a gate. Then:

> Sending reminders to **3 companies** outside Carta. It cannot be undone.

Ask the confirmation question, end your reply, and wait. Never send in the same reply as the
question.

Send them one at a time and report by name which were emailed. If one fails, say which succeeded
before it — a caller who reports "done" after three of five leaves the user believing two companies
were chased when they were not.

A request the firm does not own returns 404. One that was never sent returns 400, and there is
nothing to remind anyone about.
