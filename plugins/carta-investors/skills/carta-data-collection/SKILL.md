---
name: carta-data-collection
description: >
  Data collection for an investment firm's portfolio companies — asking them for financials, KPIs
  and documents, and managing what has been asked. TRIGGER on data
  collection, collecting financials or KPIs, requesting or chasing portfolio company reporting, or
  a company's reporting setup — including the roster ("which companies do I collect from"), a send
  ("send this period's requests"), a schedule ("collect financials every quarter"), standing
  requirements ("always ask Meetly for a board deck"), changes to either ("push back the due date",
  "stop the recurring requests"), the fiscal year ("why does Q1 cover the wrong months"), status
  ("who has not sent their numbers", "who is overdue", "what came in"), reminders ("follow up on
  those"), metrics of the firm's own ("start collecting monthly active users"), and document
  types of the firm's own ("ask them for an insurance certificate"), and contacts — who is asked
  for the data and who is copied ("add Dana to these ten companies", "take Rey off all of them").
user-invocable: true
model: inherit
allowed-tools:
  - mcp__carta__search_tools
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__list_accounts
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__view_remote
  - mcp__claude_ai_Carta__search_tools
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_accounts
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__view_remote
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__search_tools
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__view_remote
  - AskUserQuestion
  - Read
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.68.9</carta-plugin>

# Data collection

Data collection for an investment firm's portfolio companies. Step 0 asks what reading cannot
answer; Step 1 resolves the firm and Step 2 gates on its settings; all three apply to every
action. Step 3 routes to the action's own reference, which carries the procedure.

## Step 0 — Ask what reading cannot answer

Before any read, name the unknowns Carta cannot supply. If reading Carta could produce the
answer — "last quarter", "our roster", "what we usually ask them for" — read; never ask for what
a read can answer. If neither a read nor a form could produce it — which of three firms of the
same name is meant, whether the request is even about data collection — ask for **all** of them
in one `AskUserQuestion`, before spending calls on the rest of the task.

Two boundaries keep this cheap rather than chatty. Reads that discover what the user did not
know to say — a document type that does not exist, a company on a different fiscal year — are
the skill's value; this step never trades them away, it only moves the questions reading cannot
answer to the front. And when the firm itself is not among the unknowns, fire Step 1's firm
resolution in the same reply as the question, so the wait costs nothing.

**A form asks better than you do, so never ask for what one collects.** A send or a schedule
opens `data_collection:view:request_setup`, and a requirements change opens
`data_collection:view:requirements_edit`. Those forms own **one-off or recurring**,
the companies, the period and due date, the cadence and date rules, and the files and metrics — and
they show the firm's actual roster, vocabulary and open periods, which a question cannot. "Set up
data collection" with nothing more is the form, opened at once with no company params: it comes up
with every company on the roster ticked and the user narrows it there. **No question comes before
the form**, not about companies, not about one-off or recurring. So an ambiguous company or a
metric name matching two is **not** a Step 0 unknown: it is a prefill the form resolves, or a choice
the user makes inside it. Read `references/request-setup-view.md` before asking anything on those
paths.

What is left for Step 0 is what no form covers: which firm is meant when the name matches several
accounts, whether an ambiguous request is even about data collection, and the audience — the one
field `request-setup-view.md` allows as a bare question. A way of choosing companies the roster
cannot filter — by amount invested, ownership, stage, geography — is answered in one line, not
researched: companies are picked by name, fund or tag, so say that Carta cannot filter on the
figure they named and open the form for them to tick the companies they mean. Do not go reading
fund data to work the list out yourself.

## Step 1 — Resolve the firm

Every command needs the firm's integer `organization_pk`, so resolve it first.

1. Call `list_contexts` to check for an active firm and get its name. Fire
   `search_tools({"query": "data collection"})` in parallel — it has no dependency on the result.
2. If `org_pk` is not already cached in this session, call `list_accounts` with
   `search: "<firm name>"` to resolve it. Read the integer from `organization_pk:<n>`.
   **Never call `list_accounts` without the search filter** — unfiltered it returns 200+
   accounts.
3. Resolve which candidate to use, by how many came back:

   | Candidates | Do this |
   |---|---|
   | 1 | Use it. Say the name in plain text; do not ask. |
   | 2 or 3 | Settle it yourself — see below. Only ask if that fails. |
   | 4 or more | List them by name and ask which one. |

4. Call `set_context` only if the resolved firm differs from the active one.
5. Cache `org_pk` for the rest of the session. On re-entry, reuse it and skip `list_accounts` —
   `list_contexts` still runs, to catch a firm change.

### Two or three candidates — resolve it without asking

Run Step 2's settings check on **every** candidate, in parallel, in one reply. Then:

| Result | Do this |
|---|---|
| Exactly one has data collection enabled | Use it. Say which firm you picked and move on. |
| None has it enabled | Say data collection is not set up for any firm of that name. Then `AskUserQuestion`: `Try a different firm name` / `Cancel`. |
| More than one has it enabled | Now ask, listing only the enabled ones. |

A firm the user cannot reach comes back as a 404 or a permission error — that counts as not
enabled, so it drops out of the running without a question.

**Do not ask while the answer is still discoverable.** A name that matches three accounts, only
one of which collects data, has one real answer; asking makes the user do the elimination you can
do yourself. Asking is right only when two or more are genuinely viable, or there are too many to
check cheaply.

Because this already fetched the settings, do not repeat the call in Step 2 — carry the response
for the firm you picked.

**The two ids are different.** `list_contexts` returns `firm_id`, a UUID used for Snowflake.
The data collection commands need the **integer** `organization_pk` from `list_accounts`.
Sending the UUID gives a 404.

Never show either id to the user. Use the firm's name.

## Step 2 — Check the firm's settings

Skip this if Step 1 already fetched them while resolving between candidates — reuse that response
rather than calling again.

```
read_tool({"name": "data_collection__get__firm_settings",
           "arguments": {"organization_pk": "<org_pk>"}})
```

**Stop unless `data_collection_enabled` and `data_collection_v2_enabled` are both true.** A 404
means the firm has no data collection configuration at all — treat it the same way and do not
retry. Say *"Data collection isn't set up for &lt;firm&gt; yet"*, then `AskUserQuestion`: `Try a different firm` / `Cancel`.

What the two gates mean, since neither name says it:

| Field | What it actually gates |
|---|---|
| `data_collection_enabled` | The firm collects data at all |
| `data_collection_v2_enabled` | The **send endpoints** work. They reject a firm without it, so this is why the gate exists — it is not a dashboard setting |

**Never say "v2" to the user.** The field name is the API's and stays on the wire, but the
version number means nothing to a firm and will age badly. Say what is true instead: *"Data
collection isn't set up for &lt;firm&gt; yet."*

Hold the whole response. `flexible_data_collection`, `cadence` and `organization_name` are inputs
to the actions, not gates here. `flexible_data_collection` is the one that follows the dashboard —
a firm with it can have several requests for one company in one period, and can collect for any
period rather than only its own cadence. Call it flexible data collection, never "the v2
dashboard". `organization_name` is the firm's own name and is what the standard email wording
opens with — take it from there rather than from however the user happened to phrase the firm.

## Step 3 — Route to the action

| The user wants to | Read and follow |
|---|---|
| Set up data collection, collect from companies, send or schedule — and has not said one-off or recurring | `references/request-setup-view.md`. Do not ask which; the card's Type row offers both. With no companies named, open it with no company params; the roster comes up with every company ticked |
| Send or schedule to companies picked by a figure the roster cannot filter — amount invested, ownership, stage | Say Carta cannot pick companies by that; it can by name, fund or tag. Open `data_collection:view:request_setup` empty. Never derive the list from fund data |
| Send requests for a period — one-off | `references/request-setup-view.md` first, then `references/send-request.md` |
| Set up recurring collection | `references/request-setup-view.md` first, then `references/recurring-schedule.md` |
| Send or schedule, having already dictated the whole request | `references/send-request.md` from Step 1, or `references/recurring-schedule.md` from "The contract" |
| Know which companies they collect from | `references/send-request.md`, Step 2 alone |
| Know what already collects on a schedule | `references/recurring-schedule.md`, "Nothing duplicated" alone |
| Change what a company is normally asked for | `references/requirements-edit-view.md` first, then `references/data-requirements.md` |
| Change what a company is normally asked for, having already stated the full new set | `references/data-requirements.md`, from Step 1 |
| Know what a company is normally asked for | `references/data-requirements.md`, Step 1 alone |
| Ask this period for what last period asked, possibly changed — the requirements carry over | `references/roll-forward.md` |
| Send to the same companies as last time, nothing said about what to ask | `references/request-setup-view.md`, "Companies the prompt picks" — the form, with `recent_companies` |
| Change a request that has already been sent | `references/edit-requests.md`, part A |
| Change or stop an existing schedule | `references/edit-requests.md`, part B |
| Read or change a company's fiscal year | `references/fiscal-year.md` |
| Ask why a period covers the wrong months | `references/fiscal-year.md`, reading alone |
| Know who has answered and who has not | `references/status-and-overdue.md`, Steps 1 to 3 |
| Know what each company sent for a period and what is missing — "which documents came in", "who has not sent their board deck", a document submission tracker | `references/submissions.md` |
| See the files a company uploaded — names, dates, download | `references/submissions.md`, Step 4 alone |
| Chase the companies that have not answered | `references/status-and-overdue.md`, from Step 1 |
| Collect a number Carta does not offer | `references/custom-metrics.md` |
| Ask for a document Carta has no type for | `references/document-types.md` |
| Know who is contacted about a company | `references/contacts.md`, Step 1 alone |
| Ask why a contact seems to be missing, or who a company's request is addressed to | `references/contacts.md`, Step 1 alone |
| Change who is contacted, on any number of companies | `references/contacts.md`, from Step 1 |
| Get numbers out of a newsletter, deck or email a company already sent | Not this skill — see "Extraction is not collection" below |

**Extraction is not collection.** Reading numbers out of a newsletter, a board deck or an email a
company already sent is extraction — a separate capability, and not something a request does. A
company that says "pull it from our newsletter" is declining the request, and this skill cannot
pull anything. Say so in one sentence, without promising it, and offer what collection can do: ask
the company to upload that same newsletter or deck as its response — the `DECK` file type covers
investor updates — so it answers with what it already writes. A newsletter the firm already has in
hand is `carta-portco-financials-and-kpis`, not this skill.

**Defining is not collecting.** A custom metric and a firm's own document type are both
definitions: creating one adds it to the firm's vocabulary and asks nobody for anything. Asking a
company for it is a separate step — and there are two, this send alone or what the company is
always asked for, which is worth settling because one changes every future period.

**A send, a schedule or a requirements change starts with a form, unless the user already said
everything.** Each shows the roster, the firm's own metric vocabulary and — for a send — the periods
that are actually open, none of which a question can show and all of which the user would otherwise
have to supply from memory. The view reference decides whether to open it, prefill it, or skip it,
so it is read *before* the action's own reference rather than partway through one:
`references/request-setup-view.md` for a send or a schedule,
`references/requirements-edit-view.md` for a requirements change. "Send a request" or "update my
data requirements" with no further detail is the case they exist for.

**A requirements change has a higher bar for "already said everything"**, because the write is a
replacement: every company named ends up asking for exactly what was stated and nothing else. "Also
ask for a board deck" adds to a set you have not read, so it does not clear the bar — open the form,
or read the current requirements first.

**One-off or recurring decides which inputs are needed**: a one-off needs a period and a due date, a
schedule needs a cadence and two date rules. Do not infer it from a phrase like "this quarter",
which names a period rather than a repetition.

Where to settle it depends on the route, and the route is decided first. Not knowing the kind is
itself a reason to go through the form: its Type row offers both, so opening it is faster than a
question of your own, and the rows above do not require the kind to pick one. Only on the text path
— the user has dictated the whole request — does the kind come first, because the two procedures
diverge immediately; there it is already in what they said.

### Shared references

Two are read alongside an action's own reference rather than instead of it:

- `references/files-and-metrics.md` — the eight file codes, their user-facing labels, and how to
  read a firm's metric vocabulary. Any action that touches data requirements needs it.
- `references/deep-link.md` — read before offering any link into Carta. The links come ready-made
  from the firm settings response; a URL written by hand sends the user to the wrong sign-in page.

**Read the action's reference before asking the user for anything.** It carries the field shapes,
the rules the API enforces, and what the confirmation must contain — none of which are repeated
here. If the user is mid-answer on the firm, read it while you wait.

Each reference opens by saying what it covers and what it is easily confused with, so the routing
table above is enough to choose one.

## Applies to every action

**A send emails people outside Carta and cannot be recalled.** Ask the confirmation question, end
your reply, and wait. Never write in the same reply as the question — the action's reference says
where its own gate sits.

**A reminder is a send.** It creates nothing, which makes it feel lighter than the first email, but
it reaches the same people and cannot be recalled either. It takes the same gate.

**A schedule emails them repeatedly.** It sends nothing at the moment it is created, so the gate
feels lighter than a send — it is not. It keeps firing until someone stops it
(`references/edit-requests.md`, part B). Say the first send date and that it repeats, before
creating anything.

**Summarize in a table.** Anything you show the user to check — a request before it sends, a
schedule before it is created, what already collects on a schedule — is a set of fields they scan
for the one that is wrong, and prose hides it. Never `Key: value` lines where a table belongs.

A settings summary is key-value, so it takes the two-column form with an **empty first header**:

```
| | Value |
|:---|:---|
| Reporting period | Q2 2026 |
```

Left-align text columns, header included. Right-align numeric ones, header included. Put a single
space on the line after every table.

**A cell holding more than one value takes a bulleted list, not a comma-joined string.** A pipe
table cell cannot hold real list markup, so separate the items with `<br>` and mark each with `•`
— never `-` or `*`:

```
| Metrics | • Cash and Cash Equivalents<br>• Headcount |
```

A single value stays plain, with no bullet. List every item however many there are: a summary the
user is checking before an irreversible send is the wrong place to hide one.

Write dates as `Mmm DD, YYYY` — "Nov 15, 2026".

Values are names and labels — never an id, a file code or a `period_index`. The action's own
reference lists the rows it needs. Exceptions and consequences go in a sentence below the table
rather than a row of their own: a dropped company, or "it repeats until someone stops it", is not
a setting the user chose.

**Never print an `entity_id`, an `organization_pk` or a `firm_id`.** Use company and firm names.
Ids are for the commands.

**Never print a file code or a metric mnemonic.** `BS` is "Balance Sheet" and
`FS_HEADCOUNT` is "Headcount" — see `references/files-and-metrics.md`. Codes go on the wire, labels
go to the user. The same applies to periods: "April 2026", never "period_index: 4".

**Never surface an exception name or a raw error body.** Say what happened, name the companies
affected, and offer the next step.

**Never send `null`.** The API treats null as a value, not an omission, and answers with *"This
field may not be null."* — which fails the whole call, including the companies that were fine.
Whether a field may instead be **omitted** varies by command, so send what the action's own
reference lists rather than assuming an absent field takes a default.

`[]` and `false` are real answers and must still be sent: an empty audience means email nobody, and
`send_follow_up: false` means no reminders.

**Never write a Carta URL yourself.** Use the `_links` the firm settings response carries, per
`references/deep-link.md`.
