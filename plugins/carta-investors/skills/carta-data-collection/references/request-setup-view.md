# Set up a request with the interactive form

An MCP App view that opens on one card with the whole request — one-off or recurring — already
filled in, every row editable, and **sends it itself** from that card. Use it in place of asking
for the inputs one group at a time.

**This file overrides Step 0 for everything the form collects.** The skill's Step 0 says to ask
for what reading cannot answer; that does not reach the companies, the period, the due date, the
cadence, the date rules, or the files and metrics. Those belong to the form, ambiguous or not — an
unclear company is a prefill it resolves or a choice made inside it, never a question of your own.
Read this file before asking anything on a send or schedule path.

## First decide whether to open it at all

The form exists to collect what is missing. A user who has already dictated the whole request should
not be handed a card of their own answers to press Send on.

| What they have given | Do this |
|---|---|
| Nothing beyond the firm | Open it with no company params — the roster comes up with every company ticked |
| Some of it, but no companies | Open it prefilled with what they said; the roster comes up with every company ticked |
| Some of it, companies included | Open it prefilled — see [Pass what the user already told you](#pass-what-the-user-already-told-you) |
| Everything | Do not open it. Go to [Skip the form](#skip-the-form) |
| Everything but the audience | Do not open it. Ask who to email, then [Skip the form](#skip-the-form) |

Everything means all of:

- at least one company
- `kind`, one-off or recurring
- timing — a reporting period **and** a due date for a one-off; a cadence **and** both date rules for
  a schedule
- at least one file or metric
- the audience

Reminders are **not** on that list. They default to on. The summary states that, so the user can
turn them off without having been asked.

**Do not open it to confirm what the user already dictated.** A card of prefilled answers is no
faster than reading a summary here — and it reads as though nothing was heard.

**Do not use `AskUserQuestion` to collect these.** Anything the form asks for, the form asks
better — it shows the roster, the firm's own metric vocabulary and the periods that are actually
open. A question can only offer what you can guess. One exception: the audience, below. Which
companies is not one — a bare "set up data collection" opens the form with the whole roster ticked,
and the user narrows it in the Companies view, which has search and fund, tag and status filters.

## Companies the prompt picks

A bare "send requests" or "set up data collection" names no companies. Open the form with no
company params: it ticks every company on the roster and says so, and the Companies view is where
the user narrows it. **Never ask which companies before the form**, and never after it has opened.

When the prompt does pick companies, pass them, so the form opens with the right ones ticked:

| The prompt says | Pass |
|---|---|
| Company names | `company_names`, as the user said them — the view matches them to the roster |
| A fund or a tag | `funds: ["<name>"]` or `tags: ["<name>"]`, spelled as the user said |
| "All of them", "every company", "the whole portfolio" | `select_all_companies: true` |
| "The same ones as last time", "the ones I asked last quarter" | `recent_companies: true`. The view reads the firm's request history and preselects the latest batch — the latest reporting period on a fixed-cadence firm, the latest send day on a flexible one. This repeats the *companies* only; the user still picks the requirements in the form. Repeating the whole request, requirements included, is `references/roll-forward.md` instead |
| A figure the roster cannot filter — amount invested, ownership, stage | Nothing. Say Carta cannot pick companies by that, and open the form for them to tick the ones they mean |

**Say what came back.** After `recent_companies`, the response carries `recentCompaniesFound` and,
when some of those companies have since left the roster, `recentCompaniesDropped`. Say both in
one line — "Preselected 38 of the 40 companies from your last send; 2 are no longer in the
portfolio" — so the user knows what to check. A `recentCompaniesFound` of 0 means the firm has
never sent anything: say so, and the form is open with nothing ticked.

**Ask a bare question only for a single missing field, and only the audience.** Two or more missing
fields go to the form, because it shows them together on one card — as does anything missing
that the form asks for beside another field.

## Open it

```
view_remote({"name": "data_collection:view:request_setup",
             "params": {"organization_pk": "<org_pk>",
                        "kind": "recurring",
                        "company_names": ["Acme, Inc.", "Meetly"],
                        "cadence": "quarters",
                        "due_date": "2026-11-15",
                        "file_names": ["balance sheet"],
                        "metric_names": ["headcount"],
                        "required_names": ["balance sheet"]}})
```

`organization_pk` is the integer firm id from the skill's Step 1, and it is the only required
param. The view loads the company roster and the firm's metric vocabulary itself — do not fetch
either first, and do not pass them in.

Then stop and wait. The user is filling in the form.

**Say what the form actually shows, not what you asked it to show.** The response reports the
selection it made — `selectedEntityIds`, `selectedFiles`, `selectedMetrics`. A phrase it could not
resolve is absent from those, so a field you asked to prefill may have come back unticked. Read them
before describing the form: "prefilled with financials" when `selectedFiles` is missing tells the
user something untrue about a request they are about to send, and they stop checking the ones that
matter.

If something you passed did not come through, say which and let them pick it in the form. That is a
working form with one field to answer, not a failure worth retrying.

**A miss that names something the firm never defined is an offer to create it.** When the
unresolved phrase is a metric or a document type the vocabulary simply does not hold — "Total
Revenue per user" at a firm with nothing like it — do not stop at reporting the miss. Say it does
not exist yet and ask whether to create it, naming both routes:

- **In the form**: the card's What's asked view has a **New metric** button and a **New document
  type** button. Either creates the definition and ticks it into this request in place — offer this
  first, since the user is already in the form.
- **Through you**: follow `references/custom-metrics.md` or `references/document-types.md`, then
  reopen the form with the same prefills — the name resolves now, so it opens ticked. Creating
  while the form sits open is safe: a definition collects nothing (see the skill's "Defining is
  not collecting").

A phrase that *nearly* matches an existing entry is not this case. "Total Revenue per user" beside
an existing "Average Revenue Per User" may be the same ask misremembered — name the near-match in
the same question, so the user can pick it instead of minting a duplicate.

### Pass what the user already told you

The other params prefill the form. **Send every one the user has already given**, or they get asked a
second time for something they just said — which reads as though the form ignored them.

| Param | Send when the user has | Values |
|---|---|---|
| `kind` | said which kind of request | `one_off` or `recurring` |
| `company_names` | named companies | The names as they said them |
| `select_all_companies` | asked for all of them | `true` |
| `recent_companies` | asked for the same companies as last time, or chose it in the question above | `true` |
| `funds` | scoped it to a fund | The fund names as they said them |
| `cadence` | said how often | `months`, `quarters`, `half_years`, `years` |
| `due_date` | named a due date or deadline | `YYYY-MM-DD` |
| `file_names` | asked for documents | The words they used |
| `metric_names` | asked for metrics | The words they used |
| `required_names` | called some of them required | The same words, for the required subset |

`company_names`, `file_names` and `metric_names` all take the user's own words, not ids or codes.
The view matches them itself — against the roster, the eight file types, and this firm's metric
vocabulary. So do not call `data_collection__list__companies` or read the metric vocabulary first,
and do not translate anything to a code or a mnemonic.

**A scope named by fund is `funds`, not a company list.** "The companies in Fund I", "everything
in our growth fund" — pass `funds` with the fund names as the user said them, and no
`company_names`. The view narrows the roster itself and opens with every company that fund holds
already selected.

**Do not try to resolve the fund yourself.** The roster's own fund filter takes a `fund_id`, and
that id appears in no response you can read — the roster rows carry only what identifies a company.
Looking for it is a dead end that ends in reading the whole portfolio and picking through it by
hand, which is the work this form exists to remove.

A tag scope is different, and stays where it is: `include_tags` returns each tag's name **and** id
in the same response, so "my Healthcare companies" resolves in one call. See
`references/send-request.md`, "When the scope is a tag" — resolve it there, then pass the resulting
names as `company_names`.

**A scope the roster cannot filter is neither a prefill nor a read.** "Companies we've invested $3M
or more into", "where we own over 10%", "our Series A companies" — the roster carries names, funds
and tags, and none of those figures. Say in one line that Carta cannot pick companies by that, that
it can by name, fund or tag, and open the form empty so they tick the companies they mean. Do not
turn to fund or portfolio data to derive the list: the send takes companies, not a threshold, and a
list you built from a figure the user cannot see is one they cannot check.

**"All of them" is `select_all_companies: true`, not a list of every name.** "Send to all companies",
"every portfolio company", "the whole portfolio" — pass the flag and no `company_names`. Do not read
the roster to enumerate it: the view already has it, and a firm too large for the view to load
selects nothing rather than a subset that looks like everything.

**A phrase can name several file types.** "Financials" is the balance sheet, the P&L and the cash
flow statement, and the view expands it to all three. Pass the phrase as the user said it; do not
split it up yourself.

**The eight file types match on any of their usual names**, because their vocabulary is fixed and
the view knows it. Pass what the user said and it resolves:

| Type | Names it answers to |
|---|---|
| `BS` | balance sheet, statement of financial position |
| `PL` | profit and loss, profit & loss, P&L, PnL, income statement |
| `CFS` | cash flow statement, cash flow, statement of cash flows |
| `CAP` | cap table, captable, capitalization table |
| `AOI` | articles of incorporation, articles, certificate of incorporation, charter |
| `DECK` | board deck, investor update, deck |
| `FCST` | forecasts, projections, budget |
| `KPI` | KPIs, key metrics |

Symbols, punctuation and case are folded, so "P&L", "p and l" and "profit/loss" are one name. The
codes are listed only so you can read a response back; keep passing the phrase.

Metrics and the firm's own document types have **no** such list — the firm names those itself, so
only the ambiguity rule below protects them.

`required_names` is the subset the user called required, and it covers files and metrics alike.
"Balance sheet and headcount, balance sheet required" is
`file_names: ["balance sheet"]`, `metric_names: ["headcount"]`, `required_names: ["balance sheet"]`.

**A phrase that matches more than one thing prefills nothing.** "Cash" is six different metrics at
some firms, so the view leaves it unselected rather than picking one — the user sees that field
unanswered and answers it in the form. Pass the phrase anyway; do not try to disambiguate it
yourself.

**Only send what the user actually said. Never guess.** A prefilled field looks like their own
answer, so a wrong guess is worse than an empty field: they have to notice it and undo it. Omit
anything you are inferring rather than quoting.

Reading their words:

| They said | Send |
|---|---|
| "send a data collection request to Acme" | `kind: one_off`, `company_names: ["Acme"]` |
| "collect financials from my portfolio every quarter" | `kind: recurring`, `cadence: quarters` |
| "set up monthly collection for Acme and Meetly" | `kind: recurring`, `cadence: months`, `company_names: ["Acme", "Meetly"]` |
| "request Q3 numbers, due the 15th of November" | `kind: one_off`, `due_date: 2026-11-15` |
| "get the balance sheet from Acme, required" | `kind: one_off`, `company_names: ["Acme"]`, `file_names: ["balance sheet"]`, `required_names: ["balance sheet"]` |
| "ask Acme for cash and headcount" | `kind: one_off`, `company_names: ["Acme"]`, `metric_names: ["cash", "headcount"]` — "cash" may be ambiguous, which is the view's problem, not yours |
| "start data collection" | `organization_pk` alone — nothing else was said |

A phrase like "this quarter" names a period, not a cadence — it does not mean `recurring`. Only
words about repetition ("every quarter", "quarterly", "ongoing") settle `kind` as recurring.

Because the form asks which kind it is, you do not have to settle that first when opening the form.
Send `kind` when you know it and let the form ask when you do not.

## What it collects

One card, one row per choice. Each row carries a tag saying where its value came from — **From
your prompt** (what you passed), **Default** (the form's own), **Edited** (changed on the card) —
and an Edit action. Companies and What's asked open a full-height view; the other rows edit in
place.

| Row | Holds |
|---|---|
| Companies | The roster as a table, narrowed by fund, tag and each company's last request |
| Type | One-time or recurring |
| Reporting period and Due date, or Schedule | The period and due date for a one-off; the cadence and both date rules for a schedule |
| What's asked | Use current configurations (each company's saved setup, shown for review) or start from scratch with files, documents and metrics, each requested or required. A one-off opens on current configurations, a schedule on start from scratch. The view can also create a metric or a document type of the firm's own in place |
| Emailed | Company contacts, firm contacts, both, or nobody |
| Reminders | On by default |
| Email wording | Carta's standard wording unless changed |
| Upload page instructions | Optional text shown where the company uploads |

## What comes back: nothing

The card's button is the send. When the user presses **Send to N companies** or **Set up recurring
requests**, the form calls the send command itself, shows "Requests sent" or "Requests set up",
and posts **no message** into this conversation. There is no confirmation turn after the form:
the confirmation happened inside it. Do not wait for a message, and do not promise one.

So the first thing you hear after opening the form is whatever the user types next, and you
cannot see what they did in it. Three rules for that turn:

1. **"I submitted", "done", "sent it", "I set it up" is true until a read says otherwise.**
   Believe it, then verify: `data_collection__list__requests` for the firm, `include_requirements:
   false`, and pick the rows whose `sent_date` is after the moment you opened the form. Report
   them — how many companies, which period, the due date — in the same shape as
   `references/send-request.md` Step 5's table, and offer the sent-requests link per
   `references/deep-link.md`. A schedule shows in `data_collection__list__schedules` instead, by
   its `created` time. If the read shows nothing new, say that a send did not reach Carta and
   offer to open the form again; never say it before reading.
2. **Never say that nothing was sent because no message arrived.** None is expected. That
   sentence, said to a user who has just seen "Requests sent", is the failure this section exists
   to prevent.
3. **Audience, reminders and email wording are not in any read.** If the user asks about them,
   say the form set them and where to see them, rather than guessing.

A user who instead types the answers in words ("send it to Acme and Meetly for Q2, due the
15th") has left the form. Take them at their word and continue in the text path,
`references/send-request.md` from Step 4 — the form may still be open, so ask before sending
whether they already pressed Send there.

## Two things the form leaves out

**An absent email body means Carta's standard wording**, not an empty email, and not wording of
your own. The form omits the field rather than sending an empty string — so when you go on to call
the send command, supply that standard wording explicitly, per `references/send-request.md` Step 6.

**An empty audience list is a real choice.** It means create the request and email nobody. Pass
`[]` through rather than treating it as unanswered.

## Skip the form

When the user has already given everything, do not open the form. Summarize what you are about to
do, ask them to confirm, and **end your reply**. This is the same confirmation gate the two
procedures require, reached without opening the form.

**The summary is a table** — one row per setting, so the user can scan for the one they want to
change instead of reading a paragraph for it. It names things the way the user does: companies by
name, requirements by label, the period in words.

```
Here's the request for Krakatoa Ventures. Confirm and I'll send it.

| | Value |
|:---|:---|
| Companies (2) | • Meetly<br>• KJMW |
| Reporting period | Q2 2026 |
| Due date | Nov 15, 2026 |
| Files | Balance sheet (required) |
| Metrics | • Cash and Cash Equivalents<br>• Headcount |
| Email | The companies |
| Automated reminders | On |
| Email wording | Carta's standard wording, since you didn't give any |
 
Send this?
```

The first header cell is empty and both columns are left-aligned — that is the house shape for a
key-value summary. The line after the table holds a single space.

Companies and Metrics carry more than one value, so each is a `•` list joined by `<br>`. Files
carries one, so it stays plain. List every item — a portfolio of forty companies makes a tall cell,
and a tall cell is better than a summary that hides the company the user did not mean to include.

This is the shape both procedures use at their Step 5 — a recurring one swaps the period and due
date rows for cadence, first send and due date. Ten rows is the ceiling; past that, a value is
carrying a list that belongs in its own line below the table.

Say what you assumed, not just what they said. Reminders are on because that is the default, and
the line is there so they can say "turn reminders off" instead of discovering it after the send.

Then continue in the action's own reference — `references/send-request.md` from its Step 5, or
`references/recurring-schedule.md` from "The confirmation". Skipping the form skips the form, not the
duplicate check or the reporting.

### When only the audience is missing

Ask that one question directly, with `AskUserQuestion` — who should get the email: the companies,
the firm, both, or nobody. It is a single choice from a fixed list, so a question is faster than a
form and offers exactly the same options.

Then summarize as above. Do not ask about anything else this way: every other field either has a
roster, a vocabulary or a set of open periods behind it, which a question cannot show.

## Where it will not render

A terminal client cannot render a view. Do not decide that in advance: call `view_remote` first,
every time. When the host cannot render it, the call returns a text list of what to ask for
instead, and that list — nothing else — is your signal to fall back to the questions in
`references/send-request.md` Step 4 or the single batched question in
`references/recurring-schedule.md`, "The contract". Never skip the call because a tool looks
missing, and never open with questions "instead of" a form you have not tried to open.

If the host renders the form but cannot post the reply, the form shows the user the text to send and
they paste it. Either way the answers reach you as a message, so handle it the same.

## When the form asks for contacts

The form also posts a message when a selected company has nobody to send to: "N of the companies I
selected ... have no company contacts", with everything picked so far. Add the contacts with
`references/contacts.md`, then reopen this view with the picks under the param names in the table
above — `company_names`, `kind`, `due_date` or `cadence`, and the file and metric names. The
message's own wording ("Companies:", "one-time") is for the user; the params are not.
