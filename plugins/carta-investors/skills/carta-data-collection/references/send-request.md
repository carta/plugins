# Send data collection requests

The one-off send procedure. Follow it from Step 1. The firm is already resolved and its settings
already checked — `org_pk`, `flexible_data_collection` and `cadence` come from the skill's Steps 1
and 2.

**This emails people outside Carta and cannot be recalled.** Step 5 is the only thing between the
user and those emails.

**Start with the form unless the user has already dictated the whole request.** Read
`references/request-setup-view.md` before Step 1 — it collects the companies, the period, the due
date and the requirements in one pass, showing the roster and the firm's own metric vocabulary,
which no question of yours can show. It also decides when to prefill it or skip it entirely. The
steps below are the text path: what to do when the user answers in words instead of in the form,
or when it cannot render. The form sends by itself and posts nothing back — see that file's "What
comes back: nothing" for the turn after it.

Working through Steps 1-4 as a series of questions is the failure this warning exists to prevent —
by the time the roster comes up in Step 2, the user has been asked for things the form would have
offered.

Read `references/files-and-metrics.md` too, before Step 4 — it holds the file codes, their
user-facing labels, and how to read a firm's metric vocabulary.

## Step 1 — Work out the period

From the user's own words, anchored to the **calendar** year — never the firm's fiscal year:

| The user says | `interval` | `period_year` | `period_index` |
|---|---|---|---|
| July 2026 | `{unit: "months", value: 1}` | 2026 | 7 |
| Q3 2026 | `{unit: "quarters", value: 1}` | 2026 | 3 |
| H2 2026 | `{unit: "half_years", value: 1}` | 2026 | 2 |
| 2026 | `{unit: "years", value: 1}` | 2026 | 1 |

`interval.value` is always `1`. The five supported cadences are 1 week, 1 month, 1 quarter,
1 half_year and 1 year — `unit` also decides what `period_index` counts: months 1-12, quarters
1-4, half_years 1-2, years 1.

If the user says "this period" without naming one, the firm's `cadence` tells you what they
normally collect. Say which period you resolved and let them correct it.

## Step 2 — List the companies

```
call_tool({"name": "data_collection__list__companies",
           "arguments": {"organization_pk": "<org_pk>", "page_size": 200}})
```

Pass `search` instead when the user already named the companies they mean.

Show **names only**. Keep each `entity_id` + `entity_type` pair for the send and never print
either: `entity_id` is an opaque string, numeric for `CORPORATION` and a UUID for `FA_ISSUER`, and
must not be reformatted.

### When the scope is a fund

**Going through the form, pass `funds` and stop here** — see `references/request-setup-view.md`. It
narrows the roster inside the view, which is the only place the fund a company is held by is
visible. The steps below are for the text path, where you are building the send yourself.

"the companies in Fund III", "everything in our growth fund" — the roster filters by fund itself,
so do not pull the whole portfolio and sort it out afterwards:

```
call_tool({"name": "data_collection__list__companies",
           "arguments": {"organization_pk": "<org_pk>", "page_size": 200,
                         "fund_ids": [497]}})
```

Both `funds` and `fund_ids` take a **list**, and several values widen the result — companies held
by any of them. `fund_ids` is the safer of the two: `funds` matches the fund's name **exactly**,
so "Fund III" finds nothing when the fund is recorded as "Krakatoa Ventures Fund III, L.P."

A fund's real name and id come from the firm's own records, not from how the user said it. The
roster response does not carry them, so when you cannot resolve a fund with confidence, say which
fund you took them to mean and let them correct it rather than filtering on a guessed name — an
unmatched `funds` value returns an empty roster, which reads exactly like a fund holding nothing.

`funds`, `fund_ids` and `search` narrow each other, so a fund plus a name fragment is one call.

### When the scope is a tag

"my fintech companies", "everything Priya leads", "the ones we sourced from YC" — firms label their
own investments, and the roster filters by those labels. **Never guess a tag.** The firm invents
both the categories and the values, so read its vocabulary first:

```
call_tool({"name": "data_collection__list__companies",
           "arguments": {"organization_pk": "<org_pk>", "page_size": 200,
                         "include_tags": true}})
```

Each company then carries `tags`, each with `id`, `name` and `category_name`. Categories are the
firm's own — commonly Industry, Geography, Lead Partner and Deal Source. Match the user's words
against the names you actually see, then filter:

```
call_tool({"name": "data_collection__list__companies",
           "arguments": {"organization_pk": "<org_pk>", "page_size": 200,
                         "tags": ["Fintech"]}})
```

Both `tags` and `tag_ids` take a **list**, and several values widen the result. `tags` matches the
name **exactly** (ignoring case) across *every* category, so a name a firm reused in two categories
matches both — reach for `tag_ids` when you need one exact tag and nothing else. A tag filter also
returns the tags, so you can show what matched without asking for them separately.

Tags, funds and `search` all narrow each other. An untagged company matches no tag filter.

If the user's words fit no tag you can see, say so and show the closest category rather than
filtering on a guess — a tag that does not exist returns an empty roster, which reads exactly like
a firm with no such companies.

Parse the rest of the scope in the user's own terms — "all of them", "everyone except Acme and
Meetly". Say back what you resolved, as names and a count, and let them correct it.

If `has_more` is true the firm holds more than 200 companies: fetch the rest with `page` and
`num_pages`, and never present one page as the whole portfolio.

## Step 3 — Check what already exists

```
call_tool({"name": "data_collection__list__requests",
           "arguments": {"organization_pk": "<org_pk>",
                         "look_back_date": "<period start, YYYY-MM-DD>",
                         "page_size": 200}})
```

`look_back_date` is the period's first day and filters greater-than-or-equal, so narrow to the
exact period yourself using the returned `look_back_date`. Add `include_requirements: false` when
the firm has many companies and you only need to know which requests exist — it cuts each row by
about 75%.

What to do with a company that already has a request for the period:

| `flexible_data_collection` | Requests per company per period | Say |
|---|---|---|
| true | Several, so long as the requirements differ | Which companies already have one, and let the user decide |
| false | One, whatever the requirements | The firm's dashboard shows one request per period and cannot display a second. Offer to drop those companies or use a different period |

The send endpoint enforces this, so a mistake is a rejection rather than a bad send. Checking
first spares the user filling in the rest for nothing.

## Step 4 — Capture the send

Reaching here as a series of questions means the form was skipped when it should not have been —
see the top of this reference.

The period, the due date and the requirements apply to **every** company in the call. To vary
them, split into separate sends — say so rather than implying per-company values are possible.

| Input | Field | Notes |
|---|---|---|
| Companies | `entities` | `{entity_id, entity_type}` pairs from Step 2 |
| Period | `interval`, `period_year`, `period_index` | From Step 1 |
| Due date | `due_date` | `YYYY-MM-DD` |
| Requirements source | `use_company_config_template` | See below |
| Files | `requested_files` | `{type, required}`; only the eight types below |
| Metrics | `requested_metrics` | `{type, required}` |
| Documents | `requested_documents` | `{type, required}`; `type` is an integer id, not a code |
| Audience | `notify_audiences` | See below |
| Reminders | `send_follow_up` | |
| Email body | `email_body` | |
| Portal instructions | `notes` | Shown in the upload portal, not the email |
| CC | `cc_emails` | |

Ask for these as a group, not one question at a time, and accept them in any order.

**Ask about metrics as well as files.** When the user specifies requirements here rather than using
saved configurations, they can request metrics too, and a request for files alone is often not what
they meant. Read the firm's vocabulary first:

```
call_tool({"name": "data_collection__list__metrics",
           "arguments": {"organization_pk": "<org_pk>"}})
```

Then offer what the firm actually collects, by label. Do not recite dozens of metrics — ask what
they want and match, or offer what the company's saved configuration already asks for.

### Requirements source

Ask in plain words — "use what each company already has", or "specify for this send". Never name
`use_company_config_template`. The branches are mutually exclusive and the API rejects a mix:

- **Use what they have** → `true`. Do **not** send `requested_files`, `requested_metrics` or
  `requested_documents`.
- **Specify here** → `false`. At least one of the three must be non-empty, and it applies to every
  company.

A firm's own document type can go either way: `requested_documents` here asks for it on this send
alone, and `references/data-requirements.md` makes it part of what the company is always asked for.
`references/document-types.md` covers defining one and choosing between the two.

### Files and metrics

Read `references/files-and-metrics.md` for the eight file codes, their labels, and how to read a
firm's metric vocabulary. The short version: the API takes codes (`BS`, `CAP`, `CFS`), the user
sees labels ("Balance Sheet", "Captable", "Cash Flow Statement"), and metrics are per firm so they
have to be looked up.

Each item is `{type, required}`. `required: true` means the company cannot submit without it.

Nothing outside the eight file codes is requestable. A user asking for something else needs a
custom document type, which this action does not create.

### Audience, and what it does to the email

| `notify_audiences` | To | CC |
|---|---|---|
| `["company"]` | company primary contact | company CCs |
| `["firm"]` | firm contacts | none |
| `["company", "firm"]` | company primary contact | company CCs + firm contacts |
| `[]` | nobody — creates the requests and emails no one | |

**Both audiences means one email per company**, addressed to the company with the firm contacts on
CC, so everyone sees the whole recipient list. It is not a separate internal copy — say so before
the user chooses it, or a CC to their own team reads as a mistake.

A company with no contact in **any** selected audience is rejected and named. An audience that has
no contact is simply ignored: pick both for a company with no firm contact and the send goes to
the company alone. Say which companies will reach fewer audiences than the user picked — reporting
it is not blocking it.

## Step 5 — Confirm, then stop

Show what will happen and **end your reply**. Do not call the send command in the same reply as
this question.

**Put it in a table**, one row per setting — two columns, the header row `| | Value |` with its
first cell empty, both left-aligned, a single space on the line after. This is the last thing standing between the user and an email
that cannot be recalled, and they are looking for the single line that is wrong; prose buries it.
`references/request-setup-view.md` shows the rendered shape.

| Row | What goes in it |
|---|---|
| Companies (N) | The count in the label, every name in the value |
| Reporting period | The period in words — "Q2 2026", never a `period_index` |
| Due date | `Mmm DD, YYYY` — "Nov 15, 2026" |
| Requirements from | Each company's saved configuration, or what the user specified here |
| Files | Each by **label** — never a code like `BS` — marking which are required |
| Metrics | Each by **label**, marking which are required |
| Email | The audience, and who that means — per company, who is in To and who is in CC |
| Email wording | The firm's own, or that Carta's standard wording will be used because they gave none |
| Automated reminders | On or off |

Companies, Files and Metrics usually hold several values, so each is a `•` list joined by `<br>`.
A row with one value stays plain.

**When the requirements come from each company's saved configuration, read them and list them
anyway.** "Use what each company already has" tells the user where the requirements come from, not
what they are, and a user approving an email that cannot be recalled is entitled to see what it asks
for — in the beta, the first thing a user did after a summary without them was ask for exactly this.
Read `data_collection__get__requirements` with the selected `entity_ids` (at most 50 per call) and
group the companies by identical configuration — the same files, metrics and document types with
the same required flags. A company with no saved configuration (no `configuration_id`) is its own
group, labelled as Carta's defaults, even when those defaults happen to match a saved set.

- **One group** — every selected company asks for the same thing. Fill the Files and Metrics rows
  from it, exactly as a specified send would.
- **Several groups** — the Files and Metrics rows give way to one `Requirements` row reading
  "N different saved setups", and a second table follows the summary with one row per setup,
  largest group first and the defaults last, naming every company in it:

  ```
  | Companies | Files | Metrics |
  |:---|:---|:---|
  | • Meetly<br>• KJMW | • Balance Sheet (required)<br>• Board Deck / Investor Update | • Headcount<br>• ARR |
  | • Halcyon Grid | • Balance Sheet | • Headcount (required) |
  | • Orphan Labs (Carta's defaults — nothing saved) | • Balance Sheet<br>• Profit & Loss | — |
  ```

  A firm's own document types go in the Files column, since they are things to upload. Never
  print a code, a mnemonic or a document id; labels per `files-and-metrics.md`.

When the user asks to see the email, quote its body verbatim in a blockquote below the table —
Carta's standard wording with the firm's name filled in, or the user's own. The Email wording row
names the source; it does not stand in for the text.

Anything Step 3 flagged goes in a sentence **below** the table, with what you did about it — a
duplicate or a dropped company is an exception, not a setting, and a row for it reads as though the
user chose it.

The last two rows matter even when the user never raised them. Both have defaults that take effect
silently, and the summary is the only place to change one before it goes out.

Labels are the ones the file and metric lists carry — "Balance sheet", not "Balance Sheet" or
"BS". Close with **`Send this?`** on its own line, that exact question: it is what the user's
"yes" answers, and a different closing line ("Confirm to send", "let me know") leaves the reply
open-ended about what happens next.

Resolve the recipient list once, here, and reuse it for the send. Do not look it up again: two
lookups can disagree, and then the user approves one list while a different list gets the email.

If the user changes anything, return to Step 4. Write nothing until they confirm.

## Step 6 — Send

Only after the user has answered, and only in the reply that follows their answer.

```
call_tool({"name": "data_collection__send__request",
           "arguments": {"organization_pk": "<org_pk>",
                         "entities": [{"entity_id": "...", "entity_type": "..."}],
                         "interval": {"unit": "months", "value": 1},
                         "period_year": 2026,
                         "period_index": 7,
                         "due_date": "2026-08-18",
                         "use_company_config_template": true,
                         "notify_audiences": ["company"],
                         "email_body": "<the standard wording, see below>",
                         "notes": "",
                         "send_follow_up": true}})
```

Always pass `notify_audiences` explicitly, `[]` included. Omitting it falls back to a deprecated
field and defaults to `["company"]` — an accidental email.

### Four fields this command always needs

`notify_audiences`, `email_body`, `notes` and `send_follow_up` must all be present. This command
does not treat an absent field as "use the default": leaving them out returns

```
{"notes": ["This field may not be null."],
 "email_body": ["This field may not be null."],
 "send_follow_up": ["This field may not be null."]}
```

and nothing is sent. Send each one with a real value:

| Field | Send |
|---|---|
| `email_body` | The firm's own wording if they gave any. Otherwise **Carta's standard wording** — never an empty string, which would email the companies a blank message |
| `notes` | `""` when the user gave no portal instructions. Empty is a real answer here: it means the upload portal shows no extra instruction |
| `send_follow_up` | `true` unless the user turned reminders off |

**Carta's standard wording** is what the web app sends when a firm adds nothing of its own:

> &lt;Firm name&gt; is using Carta to collect &lt;monthly | quarterly | semi-annual&gt; information from
> their portfolio companies. Upload the requested information for [Corporation Name] as of
> [Period End].

Fill the firm name from `organization_name` and the cadence word from `cadence`, both in the Step 2
settings response. Use the firm's own name rather than the user's shorthand for it — this wording
goes to people outside the firm. Leave `[Corporation Name]` and `[Period End]` exactly as written —
Carta replaces those per company when it sends, and one request covers many companies.

**Say so in the Step 5 summary**: *"Email wording: Carta's standard wording, since you didn't give
any."* A user who never mentioned the email should still see what will go out, and be able to
change it before it does.

`[]` and `false` are real answers rather than blanks — send those.

**The batch is all-or-nothing.** Any rejection creates nothing, and the error names the companies
responsible. The endpoint rejects a duplicate (same entity, period and requirements), an entity
outside the portfolio, an entity with no reachable recipient in any selected audience, and — for a
firm without flexible collection — an entity that already has a request for the period. Report it
in plain words, never an exception name, and offer to drop the named companies and send the rest.

## Step 7 — Report

The response gives `sent` and `requested` counts:

- **They differ** — some companies were dropped because data collection is off in their own
  configuration. Say which.
- **`sent` is 0** — nothing was created. Do not report it as sent.

The response also carries `results`, one entry per request created, each with the `entity_id` of
the company it went to. Match those to the roster you read in Step 2 and **report the companies by
name** — a table with one row per company, or a sentence when there are two or three. Never print
a request id, and never bridge rows with a range or an arrow: the user knows their companies, not
Carta's ids, and the dashboard link below is where the ids live. An older server returns
`request_ids` alone; then name the companies from the send you just made and say nothing about ids.

Then offer the sent-requests dashboard, using the link the firm settings response carries — see
`references/deep-link.md`. A URL written by hand lands the user on the wrong environment's sign-in
page.
