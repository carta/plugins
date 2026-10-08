# What each company sent — the submission tracker

"Which documents did our companies submit for Q2, and who is missing what?" One table per period:
each company, what arrived, what is still missing. The firm is already resolved and its settings
already checked — `org_pk` comes from the skill's Steps 1 and 2.

This is a different question from status. `references/status-and-overdue.md` says whether each
request is done; this says **what** each company sent against **what it was asked for**. A request
can be outstanding with four of five documents in, and this is the route that shows the one gap.

## Step 0 — Settle the period

The read takes a reporting period as its start date, and the same date goes to both bounds so
one quarter means one quarter:

| The user says | `look_back_date` = `look_back_date_to` |
|---|---|
| A named quarter — "Q2 2026", "second quarter" | The calendar quarter's first day: `2026-04-01`. Periods are stored calendar-ordinal whatever the firm's fiscal year, so do not shift it |
| A named month, on a monthly firm | The month's first day |
| "Last quarter", "this period", nothing | The most recently completed period on the firm's cadence from Step 2 — the one the requests were sent for |
| A range — "the last two quarters" | The earlier start in `look_back_date`, the later in `look_back_date_to` |

Say the period back in the header as a label ("Q2 2026"), never as the wire date.

## Step 1 — Read the tracker

```
read_tool({"name": "data_collection__list__submissions",
           "arguments": {"organization_pk": "<org_pk>",
                          "look_back_date": "2026-04-01",
                          "look_back_date_to": "2026-04-01"}})
```

One row per sent request:

| Field | What it is |
|---|---|
| `company` | The company's name. Absent when the firm no longer lists the company — its collection was disabled after the send, or it left the portfolio. Report it as "No longer in the portfolio"; never show the id |
| `entity_id`, `entity_type` | The company's id, for the files drill-down in Step 4 only |
| `status` | The request's overall status — the same vocabulary as `references/status-and-overdue.md` Step 2 |
| `received` | What arrived: file codes (`BS`, `PL`, `CFS`, `CAP`, `AOI`, `FCST`, `DECK`, `KPI`), metric mnemonics, and `doc:<id>` for a firm-defined document type |
| `missing` | What was asked for and has not arrived, same vocabulary |
| `missing_required` | The subset of `missing` the request marked required. Absent when nothing required is missing |

The response also carries `names.metrics` (mnemonic → name, custom KPIs included) and
`names.documents` (`doc:` id → name) for everything on the page. The report needs no other read.

**Save every page to a file, and read every page.** A page holds 100 rows; while `has_more` is
present, call again with the next `page` and save that too. Write each result to its own file
(`submissions-p1.json`, `submissions-p2.json`, …) rather than carrying rows in your head — Step 3
runs a script over those files, so the table and the counts are arithmetic, not transcription.

**Rows are requests, not companies.** A company with no request for the period is not in the list —
it was never asked. If the user names such a company, say it was not asked that period rather than
reporting it as missing everything.

Do not derive "missing" yourself from a status or a file list. The server computes it per
requirement, including a bulk financials upload that counted as the statements it contained.

## Step 2 — Check the names

The pages name everything they mention, so this step is a check, not a set of reads:

- A row without `company` is a company the firm no longer lists. Do not go looking for it in
  `data_collection__list__companies` — it is not there, that is why it has no name. Report it as
  "No longer in the portfolio" and, when there are several, add the count in the header line.
- A code left unnamed by `names.metrics` or `names.documents` — the Step 3 script lists any under
  `unnamed_codes` — is the one case for a further read: `data_collection__list__metrics` for a
  mnemonic, `data_collection__list__document_types` for a `doc:` id. Then rerun the script with
  the name filled in.

Carta's eight file codes have fixed labels — the table in `references/files-and-metrics.md` and in
the script.

## Step 3 — Report it

Run the script over the saved pages:

```
python3 <skill>/scripts/submissions_report.py submissions-p1.json submissions-p2.json --period "Q2 2026"
```

It prints the report to stdout — header line, tracker table, gaps — and a JSON summary to stderr
with `unnamed_codes` and `unlisted_entity_ids`. Paste the report as it comes; the rules below are
what it implements, and what you follow when the rows are already in hand from a small firm and
you write the table yourself.

**The tracker.** One row per company, sorted with the most missing first, then by name:

| Company | Status | Received | Missing |
|---|---|---|---|
| Meetly | Past due | Balance sheet, P&L, Board deck / investor update | Cash flow statement **(required)** |
| Northwind Robotics | Answered | Balance sheet, P&L, Cash flow statement, Board deck / investor update | — |

- Status in the user's words, per the status reference: "Past due", "Nothing back yet",
  "Started", "Answered", "Needs your review", "Closed without data".
- An item in `missing_required` is marked **(required)**; the rest of `missing` is not.
- A company with nothing missing shows a dash, not an empty cell.
- Metrics and firm-defined documents by their names from `names`; a custom KPI is its name, never
  "Custom KPI #466" or its mnemonic.
- Company names are not links. Never show `entity_id`, a `doc:` id, a mnemonic or a file code —
  the report is in words.

Above the table, one header line: the period, how many companies were asked, how many have sent
everything, how many have something missing.

**The gaps, by item.** After the table, one line per requested item that anyone is missing,
most-missed first: the item, how many companies are missing it, and their names — five by name,
then "and N more". This is the list the user forwards or chases from.

```
**Gaps — Q2 2026**
- Cash flow statement: missing from 12 of 40 companies — Meetly, Halcyon Grid, Verado Health, Cobalt Labs, Larkspur Bio, and 7 more
- Board deck / investor update: missing from 3 of 40 — Pemberton Freight, Sable Interactive, Junco Analytics
```

Then the next step, in the reply text, not as a question tool: chase the companies with something
missing (`references/status-and-overdue.md` Step 4 — its reminder names the items still
outstanding), or look at the files behind one company's row (below). Offer the firm's sent-requests
link once, per `references/deep-link.md`, and never a link per company.

**When the list is empty** for the period, say no requests were sent for it and offer the previous
period, rather than reporting every company as missing everything.

## Step 4 — The files behind a row

When a "missing" reads wrong to the user, or they want the documents themselves, read what actually
arrived for that company and period:

```
read_tool({"name": "data_collection__list__files",
           "arguments": {"organization_pk": "<org_pk>",
                          "entity_id": "<entity_id>", "entity_type": "<entity_type>",
                          "look_back_date": "2026-04-01"}})
```

One row per file: name, type, when it was uploaded. Report the file names and upload dates in a
short list. A `FIN` file is a bulk financials upload that may hold several statements, which is why
a company can show the balance sheet as received with no file typed `BS`. Deleted files are not
listed. Pass `include_download_url: true` only when the user asks to open or download a file — the
links expire in about an hour, so do not paste them unasked.

Without `entity_id` the same read covers the whole firm for the period, paginated. Use it when the
user wants the files themselves rather than the tracker — "show me everything that came in this
quarter" — and report by company.
