# Budget lines that found no actuals

Step 4.7 in full: how to split the unresolved rows, what to ask, and how to
read the client's own wording back into GL codes. Reached from
[budget-ingest.md](budget-ingest.md), and gated by
[serve-and-update.md](serve-and-update.md) — which will not emit the dashboard
URL until this step is done.

> Steps referenced here that are documented elsewhere: **Step 4** → [serve-and-update.md](serve-and-update.md).

## Step 4.7 — Resolve budget lines that found no actuals

**Runs before Step 5's URL, and it is the only gate that does.** Step 5.5
and Step 6 deliberately wait until the dashboard is up, because a report
missing a breakout or a refresh is still a correct report. This one is
different: a budget line matched to no Carta account renders its budget
against an empty actual, which reads as an account nobody spent from
rather than one nobody matched — a variance the client would take at face
value. Ask, record, re-run Step 4, then emit the URL.

After Step 4's build, `accountsData.unresolvedBudgetRows` lists every
budget line that will render budget-only, and what each needs — a fund, an
account, which half of a fee, a tag value. Ask about them rather than
shipping a page of zeros the reader has to notice for themselves.

### Ask once, as two tables

`accountsData.mappingTable` is those same questions numbered in the
workbook's own order, each pre-filled where the build could work the
answer out. **Print two tables, not one, and ask for one confirmation.**
A firm arrives with dozens of these, they are all the same kind of
question, and asked one at a time they are an afternoon — by the tenth
the operator has stopped reading them.

**The tables are chat text, not a summary folded into the question.**
Render both markdown tables as your own response text, in the same turn,
*before* the `AskUserQuestion` call below — never skip straight from
reading `mappingTable` to asking the question. The question's wording
says "confirm the mappings above": that phrase is a lie unless a table
actually sits above it on screen. Cramming the row list into an option's
`description` field (a comma-separated string of category names, say)
does not satisfy this — the operator cannot check a GL account number,
a fund, or a "Needs your input" row against a sentence. If you find
yourself about to call `AskUserQuestion` and no table has appeared in
this turn's text yet, stop and print it first.

**A plain markdown table is the whole job — never reach for a chart,
diagram, or visualization tool here.** This gate is rows and text, not a
graphic; the dashboard is where anything visual belongs, and it is
launched separately in Step 5. Reaching for a visualization tool at this
gate instead of printing the table is the same confusion as the
missing-table bug above, not a second, better way to show the same rows
— it costs a large, unrelated tool call and still leaves nothing the
operator can confirm against.

Split on whether the entry carries a `proposed` value — that line is the
one between "confirm this" and "decide this", and blurring the two into
one table buries the rows that actually need a decision among the ones
that don't.

### Read the unresolved rows yourself before splitting the table

`mapping_table()`'s own `proposed` only fires on an unambiguous name
match — by design, it never picks between two real candidates or guesses
when the line and the account share nothing obvious. That is a lower bar
than what a reader would trust from you: "Recruiting" against
`options: ["Recruitment (7019)", "Depreciation (7300)", "Consulting
(7012)"]` has an answer a person reads at a glance, and asking the
operator to make that call anyway is asking them to do work you could
have done first.

**Before splitting the table, read every entry left with no `proposed`
value the way an accountant would — not the nearest string, but what the
line plainly means against its own `options`.** Where you're confident,
set `proposed` to that option yourself so the row lands in **Current
mapping** instead of **Needs your input**. It is still only a candidate:
the same single `AskUserQuestion` below is where the operator confirms or
overrules it, exactly like a mechanically-proposed row — you are adding
candidates to that gate, never recording an answer ahead of it.

Two things stay out of this, both already ruled out above and repeated
here because this is exactly where they'd creep back in:

- **Never guess a fund.** A line naming a fund by a short or partial name
  ("Fund I" when the roster only has "Fund II" and "Fund III") is a
  data-identity question, not a wording one — see "Never infer the
  answer" below. Leave these in Needs your input no matter how close the
  name reads.
- **Don't force an answer onto a placeholder or a computed line.** "Gross
  Profit", "TBD", "(to be discussed)" aren't real spend to map at all —
  say so as the reason it's unresolved, rather than picking one of its
  `options` anyway because the row demands an answer.

Leave a row in **Needs your input** whenever two real options are both
plausible, or none is — and say why, in one short phrase, when you
present the table: "no account came close," "reads as a placeholder,"
"two very different accounts both fit." That's the difference between a
table the operator can act on in one pass and one that reads like a list
of what you couldn't be bothered with.

**This does not extend to "Spend no budget line reports" below.** That
table asks which of the firm's own budget lines should claim a Carta
account's activity — a question about how the firm organizes its budget,
not about matching words. An account's name gives no signal toward that
the way a budget line's own wording points at a GL account, so there's
nothing here to anchor a guess on. Every row there stays for the
operator, as before.

**Current mapping** — every entry with a `proposed` answer, whether the
build worked it out or you did:

| # | Budget tab | Section | Budget line | Proposed GL account(s) |
|---|---|---|---|---|
| 1 | Mgmt Fees (Net) | Income | `<fund>` | net of all of them |
| 2 | Cashless | Operating Expenses ▸ Client Services | `<fund>` | Management fees offset |

**Needs your input** — every entry with no `proposed` answer, because the
match was too close to call on its own:

| # | Budget tab | Section | Budget line |
|---|---|---|---|
| 3 | Cashless | Operating Expenses ▸ Client Services | `<fund>` |

**Print only these columns — drop `needs`/`wants` and `why` entirely.**
`wants` reads from a fixed, seven-value vocabulary (`which fund`, `which
half of the fee`, `which account(s)`, …), so a table full of budget-line
asks routinely shows the identical string on every row — a column that
never varies tells the reader nothing a heading like "Needs your input"
hasn't already said. `why` is the same problem in prose form: real
signal, but it competes with the mapping decision itself rather than
supporting it. Neither ever needed its own column; both are still there
in the JSON for your own reasoning, e.g. deciding how to phrase a
genuinely ambiguous row in prose (see "three answers, not two" below).

**`Budget tab` is the workbook's own sheet name — `workbook_meta.sheet` —
never a reworded `--label`.** A firm's own section headings repeat across
every tab in the workbook, so a heading can never tell two tabs apart the
way the tab's own name does; `mapping_table()` prints `sheet` for every
budget-line row for exactly that reason. For an inference row or an
account row, there's no tab to name at all — an inference is a match
method, an account is a Carta ledger entry with no tab of its own — so
those print an em dash instead of leaving the column blank or guessing at
one.

**`Section` is the line's own P&L placement — its top-level section
("Income" / "Operating Expenses"), plus the department sub-section when
the line sits inside one ("Operating Expenses ▸ Client Services") — read
from `budget_section`.** This is exactly the heading `Budget tab` deliberately
leaves out, and the two answer different questions: `Budget tab` tells two
identically-named lines on different sheets apart; `Section` tells the
reader what part of the P&L a line belongs to before they map it — "Fund V"
under Income means something different from "Fund V" under a department's
expense block, and the tab name alone doesn't say which. Print an em dash
when the row carries no section of its own: an inference row, an account
row, or a line from a budget shape with no P&L hierarchy to read (a
monthly crosstab or a bare GL-code column sheet, say) — don't guess one
from the line's label or tab name.

Numbers run continuously across both tables — row 3 is still "3" wherever
it lands, so "3 is the fee account" still resolves to the right entry.
Read the columns straight off each entry: `n` → `#`, `section` → `Budget
tab` (row type permitting), `budget_section` → `Section` (em dash when
absent), `line` → `Budget line`, `proposed` → `Proposed GL account(s)` —
plural, because a line can map to more than one Carta account — with
`options` as what a change can be changed to. Then:

When **Current mapping** has at least one row, ask with a single
`AskUserQuestion`:

> **Confirm the `<N>` mappings above?**
> Matched by name against your Carta chart of accounts — some read
> straight off an exact name, some are my own best read of what a line
> means; either way, tell me if anything should change.

Options: **"Yes, confirm all"** — records every entry in Current mapping
as-is, one `record_budget_mapping()` call. **"No — a few need
changing"** — free text next, since which rows and how differs every
time (e.g. "3 is the fee account", "2 is budget-only") and can't be
buttoned. **"Decide later"** — records nothing; the table returns next run.

**The rows under "Needs your input" always need an answer of their own,
whatever gets picked above — none of them carries a proposed value to
confirm.** Ask for those as free text in the same turn: a pick from
their options, "void", or "leave it". When Current mapping is empty
(every entry needs input), skip the `AskUserQuestion` entirely and go
straight to asking for these.

**A line that matches no Carta account has three answers, not two.** Say
them, because two of the three are easy to miss:

- **It is one of these accounts** — the row's `options` carry the near
  names, and picking one records `gl_codes`.
- **It is not in Carta** — the firm budgets for something their ledger has
  no account for. Record `status: "void"`: the line renders budget-only,
  it stops being asked about, and the Step 5 read-out counts it among the
  lines that are budget-only by choice rather than by accident.
- **Leave it for now** — record nothing. It comes back next run, which is
  the right cost for an answer nobody is ready to give.

Never resolve one of these by picking the nearest name yourself. The
options exist because the match was close enough to show and not close
enough to trust — "LP portal expenses" against a firm's "LP meeting
expenses" is one word apart and a different account.

An entry carrying `answer` is recordable as it stands, so "Yes, confirm
all" writes the lot in one `record_budget_mapping()` call. An entry with no
`proposed` has no answer to record and must be answered before it can be.
On "No — a few need changing", only re-ask about the numbers the operator
names — the rest of Current mapping still confirms as shown.

### Spend no budget line reports

The questions above are asked of the budget; this one is asked of the
ledger. `accountsData.unaccountedAccounts` lists every Carta account
carrying activity that no line reports, and they arrive in the same
numbered table — an account asks *which line reports it*, which is the
question a line asks about its values, from the other end.

Two ways an account gets there, and the entry's `section` says which — for
your own reasoning, not the table: an account isn't scoped to any one
budget tab, so print an em dash under `Budget tab` for these rows rather
than `section`'s value. `Budget line` carries the account itself (its
number and name).

| It reads | It means |
|---|---|
| no line names it | nothing in the budget covers this account at all |
| part of it, beyond the lines that name it | a scoped line reports its own value here, and the rest belongs to nobody |

**Neither is visible on the report.** A figure that is wrong invites
checking, because it sits beside a budget it disagrees with. Spend no line
claims appears nowhere — no row, no total, no drawer — so this gate is the
only place it can surface.

**Ranked by expense, and income sorts last.** A firm budgeting fee income
per fund reports it from the fund side, so the ManCo's own fee-income
account has no line naming it and appears here every time. That is one
answer to give once, not the headline of the question.

Three ways to answer:

- **An existing line reports it** — add the account to that line's
  `gl_codes` in the `rows` block. The line is what reports it, so that is
  where the answer belongs.
- **It needs a line of its own** — the workbook has nothing for this spend
  and the client wants it shown. That is a change to their budget rather
  than to the mapping: tell them, and leave the account unanswered.
- **Not expected in the budget** — recorded under `accounts`, and never
  asked about again:

```json
{"accounts": {"6300": {"status": "not_expected"}}}
```

**Each `needs: "account_line"` entry gets its own three-way question —
never bundled with another entry, and never collapsed to two options.**
The bulk row below (`needs: "account_line_bulk"`) is the *only* place
more than one account shares a question, and it exists solely for
accounts under the ask floor — a `needs: "account_line"` entry reaching
this gate is already past that floor by construction, however small its
`amount` looks next to one that is. Folding a real account into the bulk
row's "not expected" / "decide later" pair is a live bug, not a
shortcut: it silences "an existing line reports it" and "it needs a line
of its own" for spend the build itself flagged as material enough to
ask about individually. Two accounts arriving in the same batch (e.g.
Software at $23,176 and Consulting at $3,563 both showing up on one
build) still each get their own `AskUserQuestion` with all three
answers — asking twice costs one extra turn; merging them costs a
mapping decision no one actually made.

#### The small ones are shown, not counted

An account under the ask floor does not get a question of its own. It
gets a place in a single row, `needs: "account_line_bulk"`, carrying the
whole list on its `accounts` key.

**Print that list.** Every account, its name and its amount — not the
count, and not a sample. Measured on three real firms the row gathers
thirteen accounts worth about four thousand in total, and a client
deciding those are not expected wants to see which thirteen before they
say so. The floor decides whether an account is *asked about* separately,
never whether it is *shown*.

One answer covers the row:

> **The small ones** — 13 accounts, none individually material. Not
> expected in the budget?
> `7105 Meal 585 · 7180 Telephone & internet 585 · 7099 Other fees 963 · …`

Confirming records `status: "not_expected"` for every account in the row,
in the same `accounts` block. A client who wants one of them out of the
group names it, and it becomes an ordinary question.

**Two things the floor is blind to, so say them if they appear.** A
suspense account is a classification signal rather than a small expense,
and a negative figure is a credit rather than spend — either can sit under
the floor while meaning more than its size.

The count reaches the Step 5 read-out as *"N account(s) carry spend no
budget line reports"*, so a reader knows the page is not the whole ledger
before they start.

### Values read off the client's own wording

Some rows carry `needs: "inference"`. These are not lines that failed to
resolve — they resolved, and the report already counts them. What they
record is *how*: the value was read off the line's own name, or the
heading above it, rather than stated by the workbook in a column of its
own. A firm whose crosstab has a column per department is stating those
values; a firm whose section heading happens to read like a department
name is not, and reading one as the other quietly narrows a line to a
slice of the money it means.

They are applied rather than withheld, because a page of holes is worse
than a page with a question against it — but they are always shown. Like
an account row, an inference isn't scoped to one budget tab either — its
`section` names the match method ("matched on the heading above it"), not
a tab — so it prints the same em dash under `Budget tab`:

| # | Budget tab | Budget line | Proposed GL account(s) |
|---|---|---|---|
| 7 | — | `<line>`, `<line>` +4 more | `<value>` |

**One row per inference, not per line.** "Lines under this heading mean
this value" is one question however many rows it touches, and a line added
next quarter inherits the answer instead of reopening it.

Record the answer under `inferences` in `budget-mapping.json`, keyed as
the row's `addr` gives it (`inference:<key>`, minus the prefix):

```json
{"inferences": {"subsection|reporting_tag|Department|<value>":
                {"status": "confirmed"}}}
```

`confirmed` stops it being asked again. `rejected` also stops the value
being applied — the lines go back to reporting their accounts whole. Both
outrank the wording on every later build.

**Say the open item out loud.** The gaps line names the count awaiting
confirmation, and it belongs in the read-out even when the operator
confirms everything else at a glance — an inference nobody was told about
is the one that surfaces months later as a figure the client cannot
account for.

**Say what the table cannot know.** How a firm splits management fees
across its budget is the firm's own convention — one line net of the
offset, or a gross line with a cashless line beneath it, or both halves in
separate sections. The build reads the money, not the intent, so name the
assumption when you show the table:

> These read your fee lines against what each fund actually posted. Row 1
> looks like the fee net of its offset, rows 2 and 5 like the offset on its
> own. Tell me if your workbook splits them another way.

**`budget-mapping.json` is the only record of these answers.** Each one
cost a conversation with the client, nothing else holds them, and they are
not in git. Merge into it — `record_budget_mapping()` — and never write it
whole or delete it to clear a single entry. A file that is there but
unreadable is not an empty one: stop rather than start a fresh one over
the top.

**Fund lines arrive with candidates too.** A workbook abbreviates ("Opp
Fund II"), and a shorter name can fit two funds at once — both are cases
the automatic match refuses, so the gate offers the roster's near names
and the operator picks. The abbreviation runs one way only: a line's word
may be the start of a fund's, never the reverse.

**A fund named in two sections is asked which half each line means.** Both
lines resolve from the same fund-side entries, so both report the same
money unless each names its account — a firm's fees and the offsets
against them are separate Carta accounts, and a workbook listing a fund
twice is usually separating exactly those. The question comes back if the
answer gives both lines the same account, because that is the double count
it exists to prevent; an account one line already holds alone is not
offered to the others. Two lines are settled only when their accounts
differ.

A line naming **no** account is the fund's net — every account it posts
to, fee less offset. A line naming **only** the offset reports the
magnitude, because a workbook budgets a cashless fee as a positive amount.

**Never infer the answer.** Similarity between a workbook's wording and
Carta's is a hint, not an answer. Measured on a real firm, a fee line
naming one fund was one tie-break away from being matched to another with
a similar name — a real fund, the wrong money, under a name that
looks right. A wrong mapping is worse than a blank, because a blank is
visible.

**A line naming exactly one Carta account is already resolved** and never
reaches this gate. Once the words identifying its scope are taken out —
"Rent - <office>" is the account "Rent" for that office — what remains is
either an account's own name or it isn't. Exactly one account carrying
that name is not a judgement call; two, or a resemblance, is.

**Lead with the suggestions the build already worked out.** Each entry
needing a GL account carries `suggestions`: candidate accounts drawn from
the client's own mapping and from Carta account names that read like the
line. They are proposals, never applied — a client's mapping usually names
lines more briefly than their budget does, and closing that gap by
matching on a prefix would silently resolve half a line.

**A line naming two things gets a candidate for each.** "Payroll Taxes
(Employer) + Workers Comp" is two Carta accounts wearing one label;
offering only the first is the case that looks resolved and is not.
`suggestions` carries the `component` each candidate answers, so the
question can show which half it covers and accept both.

**Offer the firm's own Carta values**, filtered to what the line needs:

| Line needs | Offer |
|---|---|
| a fund | the funds in `feeSchedule.funds` / fund-side entries |
| a GL account | the accounts in `accountsData.accounts` |
| a tag value | the values under the chosen category in `tagCategories` |

Sub-accounts and vendors are on the entries too, where a line is scoped
that way.

These are the `options` column of the table. Come back to a single line
only for the numbers the operator changed, and only where the change needs
more than the options already list.

**Two ways to decline.** Not every budget line has a Carta counterpart —
a placeholder for hires not yet made has nothing to compare against:

- **Void** — keep the line, mark it `no actuals expected`. The blank then
  reads as a decision rather than a gap.
- **Remove** — drop the line from the report entirely.

Record every answer in `<dashboard_dir>/budget-mapping.json`, keyed by the
row's `addr` (not its bare `key`), and re-run Step 4:

```json
{"rows": {"r7":  {"fund": "<a fund the firm has>"},
          "r19": {"gl_codes": [7110, 7105]},
          "r21": {"gl_codes": []},
          "r24": {"status": "void"},
          "r25": {"status": "removed"}}}
```

**Two entries can share a `key` and even a `label`.** Every shape adapter
numbers its own rows from 1, so a firm with more than one ingested budget
routinely has an "r17" in each — two unrelated lines. `unresolvedBudgetRows`
carries `budget_id`/`budget_label` on every entry so a duplicate-looking
key doesn't get asked about, or answered, as if it were one line; name
which budget in the question when two candidates share a key. Always
record the answer under `addr`, not `key` — `addr` is unique per budget
and per row, and a decision recorded under the bare key of a firm with
more than one budget is silently never applied, on purpose, rather than
risk landing on the wrong budget's line.

An empty `gl_codes` is an answer: on a per-fund line it means the net of
every account that fund posts to. Recorded answers survive re-runs and are
not asked about again — except a fee split that leaves two lines of one
fund on the same account, which comes back because it double-counts.
