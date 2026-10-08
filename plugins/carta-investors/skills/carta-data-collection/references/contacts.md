# Manage who is contacted about data collection

Who receives a company's data collection email, and who at the firm is copied on it. Changing a
contact changes who gets the next request; it does not touch a request already sent, and it emails
nobody at the moment you change it.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

## The two kinds of contact

They are separate lists on separate sides of the relationship, and mixing them up sends the wrong
people a company's numbers. Say which one you mean; never say just "contact".

| | Who they are | What they get |
|:---|:---|:---|
| **Recipients** (`points_of_contact`) | People **at the portfolio company** | Asked for the data — they receive the request and upload against it |
| **Firm contacts** (`firm_contacts`) | People **at the firm** | Copied on that company's email, as a CC |

A third distinction sits inside recipients and is not the firm's to change:

- **Company-designated** contacts (`is_company_designated: true`) were named by the portfolio
  company itself. They stay whatever the company set. They still count toward the rule that a
  company must have someone to ask, which is why removing every other recipient succeeds for a
  company that has one and fails for a company that does not.

**Do not report that a primary was set.** `primary` marks who Carta addresses, but Carta derives
that per company from the company's own contacts. There is no field for choosing it.

**"Our contacts disappeared" is usually the dashboard's primary marker.** The dashboard marks one
company contact per company as primary; the company's other contacts are still there. Who a request
reaches is decided by the audience on the send, not by that marker: the `company` audience emails
the company's contacts, the `firm` audience emails the firm contacts, and both emails both. Read
Step 1 and show both lists by name before agreeing that anything was removed. If the user wants
another person at the company asked, add a company contact; a firm-side person who should be
copied is a firm contact.

## When the setup form sent you here

The request setup form refuses to go on while a selected company has nobody the chosen audience
reaches. Its "Add contacts" button posts a message into the conversation that opens with
"N of the companies I selected for this data request have no ... contacts", names them, and lists
everything the user picked: companies, one-time or recurring with its date or cadence, and either
the files and metrics or "each company's saved configuration".

Do two things, in order:

1. Add the missing contacts with Steps 1 to 4 below. Ask for the names and emails; the message
   never carries them and you never invent a recipient.
2. Reopen the form with `data_collection:view:request_setup`, following
   `references/request-setup-view.md`, and translate the message into that view's own param names:

| The message says | Send |
|:---|:---|
| Companies: A, B, C | `company_names: ["A", "B", "C"]` |
| Request: one-time, due 9/30/2026 | `kind: "one_off"`, `due_date: "2026-09-30"` |
| Request: recurring, quarterly | `kind: "recurring"`, `cadence: "quarters"` |
| Files: ..., Metrics: ... | `file_names`, `metric_names`, and `required_names` for the ones marked (required) |
| Requirements: each company's saved configuration | No file or metric params |

Those are the only names the view knows. `companies`, `request_type` and `due` are not params: the
gateway drops them, so the form opens with nothing prefilled and the user re-picks everything the
message was meant to carry. Do not send anything — the message asks for the form back, not a send.

## Step 1 — Read who is on the companies now

There is no separate contact read; contacts come back on the roster.

```
read_tool({"name": "data_collection__list__companies",
           "arguments": {"organization_pk": "<org_pk>", "include_contacts": true,
                         "search": "<name fragment>"}})
```

Contacts roughly triple each row, so narrow rather than pulling a whole portfolio with them
attached: `search` for a name fragment, `fund_ids` for a fund — "add Dana to everyone in Fund III"
is one filtered call — or `page_size`. See `references/send-request.md`, Step 2, for the fund
filters.

Each company comes back with both lists. `firm_contacts` entries carry an `id` — it identifies that
contact **on that company alone**, which is why the bulk command removes by email address instead.

Read before you write. Both write paths below need to know what is there now: one to avoid
reporting a change that was already true, the other because it replaces a list wholesale.

### The roster is the only source of companies

A scope named by another list — "everyone on the Q2 request list", "the companies I just
sent to" — is resolved against the roster, never written from that list's rows. Request rows
are requests, not companies: a row with no `sent_date` is a never-sent placeholder, and it can
reference an entity that is no longer associated with the firm. A real session offered "all 232
on the list" when only 58 were attachable companies — the write was rejected wholesale, and had
it not been, contacts would have landed on 171 foreign entities.

So: read `data_collection__list__companies`, intersect it with whatever list the user named, and
say what the intersection was — "58 of the 232 rows are portfolio companies; the rest are
never-sent placeholders" — before asking for confirmation. The confirmation counts companies
from the roster, not rows from the other list.

## Step 2 — Choose the command by how many companies

| Situation | Command |
|:---|:---|
| Any change touching more than one company | `data_collection__set__contacts_bulk` |
| One company, adding or removing one firm contact | `data_collection__add__firm_contact` / `data_collection__remove__firm_contact` |
| One company, reworking its whole recipient list | `data_collection__set__company_recipients` |

Prefer the bulk command whenever more than one company is involved, **even when every company is
getting a different change**. That is what it is for. It is one call, it reports per company, and it
leaves untouched anyone it was not told about.

### The bulk command

Each company carries its own changes:

```
call_tool({"name": "data_collection__set__contacts_bulk",
           "arguments": {
             "organization_pk": "<org_pk>",
             "entities": [
               {"entity_id": "<id>", "entity_type": "<type>",
                "add_recipients": [{"email": "...", "name": "...", "title": "..."}],
                "remove_firm_contacts": ["..."]},
               {"entity_id": "<id>", "entity_type": "<type>",
                "add_firm_contacts": [{"email": "...", "name": "..."}]}
             ]}})
```

The four change lists — `add_firm_contacts`, `remove_firm_contacts`, `add_recipients`,
`remove_recipients` — go **inside** each entity, never beside the list. Each entity needs at least
one of them. Removes take plain email addresses.

Because each company is independent, one call can do opposite things: a company can gain an address
while another loses it. Two things are rejected: the same address added and removed **on one
company**, and the same company listed twice.

`entities` takes at most 100 companies per call; split a larger job and say you are doing so.

It **adds and removes** — a contact you do not name is left alone.

One caveat when you report back: the `recipients` count in a succeeded entry is the merged list
length, not what the user will see on screen. A company with no contacts of its own can report a
count while its `points_of_contact` still reads empty.

### The single-company commands

`data_collection__set__company_recipients` **replaces** that company's whole recipient list. Read the current list
first and send it back changed; anyone left out stops receiving that company's requests. Use the
bulk command instead unless the user is genuinely reworking one company's list.

## Step 3 — Confirm, then write

Show who gains and who loses the emails, and on how many companies:

```
| | Gains | Loses |
|:---|:---|:---|
| Recipients (at the company) | dana@meetly.example | — |
| Firm contacts (CC'd) | — | rey@thefirm.example |
```

Name the companies above the table and say how many there are. Then say, in one sentence, that an
address new to a company starts receiving Carta email about that company from the next request on.

### A recipient's domain is worth a lenient glance

A recipient is a person at the portfolio company, so the address usually looks like it. Before
asking for confirmation, compare each **added recipient's** domain with the company it is being
added to. A personal-mail domain (gmail, outlook, and the like) or a domain sharing a word with the
company's name is ordinary. A corporate-looking domain with nothing in common with the company is
worth a line:

```
Worth a second look: pat@othervc.example on Meetly — the domain matches neither the
company's name nor a personal-mail provider.
```

Flag, never block. Fractional CFOs, agencies and outside counsel make the pattern legitimate, so
this is a note under the confirmation table, not a question of its own — and never a reason to
change the payload yourself. Firm contacts are exempt: they are the firm's own people, and Carta
checks firm membership itself on the write.

Ask the confirmation question, end your reply, and wait. Never write in the same reply as the
question.

### The same recipient on many companies is usually the wrong list

A recipient is one company's person. The same address appearing in `add_recipients` across more
than a handful of companies is the shape of a paste error, a stale spreadsheet, or a firm-side
person on the wrong list — the pattern behind a real incident. When one address is being added as
a **recipient** to more than five companies in a call, say so in the confirmation: name the
address and the count, and ask whether they meant a **firm contact**, which is the list for someone
copied across many companies. The same firm contact on many companies is normal and needs no note.

## Step 4 — Report per company, not per call

**The bulk response is 200 even when some companies were rejected.** Each company is applied
independently, so the status code says nothing about whether the change took. Read the body:

| Field | What it means |
|:---|:---|
| `succeeded` / `succeeded_count` | Companies written. Another company's failure does not roll these back |
| `failed` / `failed_count` | Companies rejected, each with the company and a reason |
| `recipients` (in a succeeded entry) | That company's **resulting** recipient count — not how many were added |

If `failed_count` is above zero, name those companies to the user and give the reason. Do not
report the call as done because it returned 200.

The commonest reason is that removing a recipient would leave a company with nobody to ask. That
is why the same payload can succeed for one company and fail for another: a company whose only
remaining contact is company-designated still has someone to ask, and a company whose contacts were
all firm-managed does not.

A failure is per company and safe to retry after fixing the payload — the companies that succeeded
stay written, so a retry should name only the ones that failed.
