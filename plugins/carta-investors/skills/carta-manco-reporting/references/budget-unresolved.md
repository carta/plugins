# Budget lines that found no actuals

Steps 4.6 and 4.7 in full: whether the native mapping needs a file behind
it, how to split the unresolved rows, what to ask, and how to read the
client's own wording back into GL codes. Reached from
[budget-ingest.md](budget-ingest.md), and gated by
[serve-and-update.md](serve-and-update.md) — which will not emit the dashboard
URL until both are done.

> Steps referenced here that are documented elsewhere: **Step 4** → [serve-and-update.md](serve-and-update.md); **2.75e** → [budget-workbook.md](budget-workbook.md).

## Step 4.6 — Ask for a mapping file only when the native mapping falls short

2.75e uses whatever a mapping tab, the workbook's own formulas
(`resolve_formula_gl_evidence`) and a line's own stated GL code already
combine to. Whether that combination was *enough* is not answerable until
Step 4 has actually tried it — so this is where it's asked, not before.

**Skip this step entirely** — go straight to Step 4.7 — when any of these
is true:
- `--coa-mapping <path>` was passed for this run.
- `<dashboard_dir>/.coa-mapping-ref.json` already records a mapping, or
  `{"declined": true}` from an earlier invocation.
- `accountsData.nativeMapping.needsMappingFile` is false.

`nativeMapping` (`build_manco_datadir.py`'s `native_mapping_coverage`)
counts every budget line against how many the build could actually resolve
(`resolved`) or pre-fill a candidate for (`proposed` — a `mappingTable`
row Step 4.7 lets the operator confirm in one tap). `needsMappingFile` is
true when those two together cover under half the budget's lines — thin
enough that Step 4.7's per-row table isn't really fixing the gap, it's
asking about most of the budget one line at a time.

When it's true, ask once, via a single `AskUserQuestion`, stating the
coverage so the ask isn't a bare request:

> **Do you have a Carta GL-to-budget-category mapping for this workbook?**
> I matched `<resolved + proposed>` of `<lines>` budget line(s) from the
> workbook's own codes, formulas and mapping tab. A mapping file would
> resolve the rest by name and department/tag correspondence, rather than
> asking about each one individually.

Options:
- **Yes, I have one** → collect it per [budget-workbook.md's Asking for a
  file](budget-workbook.md#asking-for-a-file), then parse it exactly as
  2.75e does (including `--carta-accounts-from` if the sheet names
  accounts by text), **re-parse every `pnl-outline` sheet** the same way
  2.75e's own note describes, and re-run Step 4 before continuing.
- **No mapping file — I'll map natively to Carta** → proceed with no
  further action here. Say: *"I'll match the rest to your Carta chart of
  accounts directly — anything I can't resolve with confidence, you'll
  get to confirm below."* This still only covers GL-account matching by
  name (Step 4.7 does that regardless of a mapping file); deriving
  department/tag correspondence from the firm's own Carta data is
  planned, not yet built (see [errors.md](errors.md)).

Record the answer in `.coa-mapping-ref.json` (`{"declined": true}` for the
second option) so this isn't asked again for this firm. Either way, go on
to Step 4.7 next — a mapping file changes how many rows have a `proposed`
value, not whether the gate itself runs.

## Step 4.7 — Resolve budget lines that found no actuals

**Runs before Step 5's URL, and it is the only gate that does.** Step 5.5
and Step 6 deliberately wait until the dashboard is up, because a report
missing a breakout or a refresh is still a correct report. This one is
different: a budget line matched to no Carta account renders its budget
against an empty actual, which reads as an account nobody spent from
rather than one nobody matched — a variance the client would take at face
value. Ask, record, re-run Step 4, then emit the URL.

After Step 4's build, `accountsData.unresolvedBudgetRows` lists every
budget line with an open question, and what each needs — a fund, an
account, which half of a fee, a tag value. Most of these will render
budget-only until answered; a `needs: "zero_activity_account"` entry (see
below) is the exception — it already renders an actual, just a quiet one.
Ask about all of them rather than shipping a page of zeros, or a zero that
reads as real, for the reader to notice unaided.

### Confirm the confident rows first, then work through the rest

`accountsData.mappingTable` is those same questions numbered in the
workbook's own order, each pre-filled where the build could work the
answer out. Split it into two tables, but **do not show them
together.** Show **Current mapping** first, on its own, with one
confirm-all question — and wait for that answer before showing
**Needs your input** at all. Confirming the easy rows is a one-tap
action; making the operator scroll past a wall of judgment calls before
they can even do that one tap defeats the point of splitting the tables
in the first place. The exception is when **Current mapping** is
empty — nothing to confirm, so go straight to **Needs your input** in
this same turn (see below).

### Render the table before you ask

**Each table is chat text, not a summary folded into the question.**
Render the markdown table as your own response text *before* the
`AskUserQuestion` call it belongs to — never skip straight from reading
`mappingTable` to asking the question. Don't compose it by hand — the
script renders both, split and columned as below:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" query tables "<dashboard_dir>" --part current
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" query tables "<dashboard_dir>" --part input
```

Paste its output, unchanged, as the text of the same message that carries
the `AskUserQuestion` call. Empty output means that table has no rows.
`--part input` also prints the inference table (see "Values read off the
client's own wording" below) after Needs your input, each value with its
line count.
Rerun `--part input` after the confirm-all answer and every rebuild, so the
rows match what is still open. The question's wording says
"confirm the mappings above": that phrase is a lie unless a table
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
that don't. The one exception is an inference row (`needs: "inference"`):
it carries `proposed` but is never part of Current mapping; it is asked
with its line count — see "Values read off the client's own wording" below.

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
list that option first on the row's own question in **Needs your input**,
marked `← recommended`. **Never set `proposed` yourself, and never fold
your own picks into the Current mapping "confirm all" batch:** that batch
is what the build matched on its own, and a confirm-all over rows the
operator never saw asked individually is how a model's guesses get
recorded as the operator's answers. Your read makes the row one tap; it
never makes it zero.

**An entry carrying `source_formula` has already had its formula checked
mechanically — read it yourself before falling back to the label.** The
workbook's own Actual/Budget formula for a bucket line is stronger evidence
than its wording: a `SUM` over other rows, or a reference into another
sheet, names the real account(s) the line pulls from, where the label
alone is just a category name a person chose. A single GL code the build
resolved this way is already promoted to **Current mapping**, tagged "read
off your workbook's own formula" — nothing further to do. An entry that
still carries `source_formula` here is one the mechanical pass couldn't
resolve on its own (a lookup table, a chain of references, criteria this
pass doesn't evaluate); read that formula the same way you'd read any
other close call, and recommend the account it names on that row's own
question when tracing it settles the question.

**`source_formula` is the raw formula the parse shapes read from the cell
with `data_only=False`** (`pnl_outline.py` / `tag_crosstab.py`), carried on
the `unresolvedBudgetRows` entry that shares this row's `addr` — look there,
not on the `mappingTable` row itself, which doesn't carry `source_formula`
at all. `resolve_formula_gl_evidence` already tried resolving it
mechanically before this gate ever runs, reopening the workbook itself
where that needed a referenced row's raw label; its `unresolvedBudgetRows`
entry still carrying `source_formula` here is one even that pass couldn't
settle on its own (the cases named just above, plus a `SUMIF`/`SUMIFS`
criterion that is itself a cell reference). So the formula text names
everything it *can* resolve to — when it still points at a cell whose
value isn't captured anywhere in this data (a criterion cell, a lookup
range, a row on a sheet nothing here parsed), there is nothing further in
reach for you to resolve from the text either: recommend the account when
the formula's own text, or a row/GL code already in the parsed budget,
names one; when it names an unavailable cell or range instead, say what it
references on that row's own question and let the operator answer — don't
guess an account from a bare cell reference you can't read.

**This is not optional and not a fallback you reach for only if the
operator asks for it — do it before you print a single table.**
`AskUserQuestion` is where a real judgment call goes, not where a
question the workbook has already answered goes to be asked anyway. Trace
every `source_formula` you haven't traced yet as part of this same
read-through, before "Needs your input" is built. Skipping straight to the
table with these rows still untraced, then only tracing one if the
operator happens to ask, is the same violation as skipping
`AskUserQuestion` itself elsewhere in this skill: a question the workbook
already answered, asked anyway, because the answer was reached silently
(by not looking at the formula text on its `unresolvedBudgetRows` entry)
instead of checked. If you find yourself about to print **Needs your
input** and a row in it has an `unresolvedBudgetRows` entry (same `addr`)
carrying `source_formula`, stop and re-read that entry's `source_formula`
first — do not rely on the operator to ask you to. Recommend the account
on that row's own question when the formula text already names one; only
ask the operator to pick when it names a cell or range the data doesn't
carry.

Three things stay out of this, ruled out here and below:

- **Never guess a fund.** A line naming a fund by a short or partial name
  ("Fund I" when the roster only has "Fund II" and "Fund III") is a
  data-identity question, not a wording one — see "Never infer the
  answer" below. Leave these in Needs your input no matter how close the
  name reads.
- **Don't force an answer onto a placeholder or a computed line.** "Gross
  Profit", "TBD", "(to be discussed)" aren't real spend to map at all —
  say so as the reason it's unresolved, rather than picking one of its
  `options` anyway because the row demands an answer.
- **Never propose an answer on a `needs: "zero_activity_account"` row.**
  Its options are the line's current mapping, so a confident match only
  repeats it. Leave it in Needs your input, however plainly the line's
  name matches its account (see "A mapped account with nothing behind it"
  below).

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

**Current mapping** — every entry the build itself gave a `proposed`
answer, other than an inference row:

| # | Budget tab | Section | Budget line | Proposed GL account(s) |
|---|---|---|---|---|
| 1 | Mgmt Fees (Net) | Income | `<fund>` | net of all of them |
| 2 | Cashless | Operating Expenses ▸ Client Services | `<fund>` | Management fees offset |

**Needs your input** — every entry with no `proposed` answer, because the
match was too close to call on its own, or because it questions the
current mapping itself (`zero_activity_account`):

| # | Budget tab | Section | Budget line |
|---|---|---|---|
| 3 | Cashless | Operating Expenses ▸ Client Services | `<fund>` |

**Print only these columns — drop `needs`/`wants` and `why` entirely.**
`wants` reads from a fixed, nine-value vocabulary (`which fund`, `which
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
way the tab's own name does; `mapping_table()` writes it as `tab` on every
budget-line row, and only there, for exactly that reason. For an inference row or an
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
Read the columns straight off each entry: `n` → `#`, `tab` → `Budget
tab` (em dash when absent), `budget_section` → `Section` (em dash when the
row has no `tab`), `line` → `Budget line`, `proposed` → `Proposed GL account(s)` —
plural, because a line can map to more than one Carta account — with
`options` as what a change can be changed to. Then:

When **Current mapping** has at least one row, print it — `query tables
--part current`'s output, rows and all, as this turn's own chat text — then
ask with a single `AskUserQuestion`:

> **Confirm the `<N>` mappings above?**
> Matched against your Carta chart of accounts — some read straight off an
> exact name, some off your workbook's own formulas; either way, tell me
> if anything should change. **Nothing here is locked in — you can always
> come back and change a mapping later, this run or a future one.**

Options, each restating that these aren't final so the reassurance
survives even if the question's own prose gets trimmed in the render:
**"Yes, confirm all — I can always update these later"** — records every
entry in Current mapping as-is: each row's `answer`, with `--source
operator` (see "Recording answers" below).
**"No — a few need changing"** — free text next, since which rows and how
differs every time (e.g. "3 is the fee account", "2 is budget-only") and
can't be buttoned. **"Decide later"** — records nothing; the table
returns next run.

**Wait for that answer before doing anything else.** Do not print
**Needs your input** in the same turn, and do not call its
`AskUserQuestion`s until this one has come back — that table is the next
step, not a second half of this one. When **Current mapping** is empty
(every entry needs input), there is nothing to wait for: skip the
confirm-all question and go straight to **Needs your input**, in this
same turn.

**Once the confirm-all answer is in (or immediately, if there was nothing
to confirm), print Needs your input and ask about every row in it.** Each
of these rows always needs an answer of its own — none of them carries a
proposed value to confirm. Ask via `AskUserQuestion`, in the same turn
the table is printed — never as chat prose you write and move past, and
never by picking the nearest option yourself to avoid the round trip;
that is exactly the call the automatic match already refused to make. One
question per row, each carrying that row's own `options` (plus "void" and
"leave it" alongside them, and "read the formula to figure this out" too
whenever the row's `unresolvedBudgetRows` entry (same `addr`) carries a
`source_formula` the mechanical pass couldn't resolve); a
single call carries up to four questions, so batch further when there
are more than four rows.

**A line that matches no Carta account has three answers, not two — four
when its `unresolvedBudgetRows` entry also carries a `source_formula`.**
Say them, because most of these are easy to miss:

- **It is one of these accounts** — the row's `options` carry the near
  names, and picking one records `gl_codes`.
- **Read the formula to figure this out** — offered whenever the row's
  `unresolvedBudgetRows` entry carries `source_formula`. By this point you
  should already have tried tracing it (see "Read the unresolved rows
  yourself before splitting the table" above) — an entry still carrying
  `source_formula` here is one that attempt didn't settle, not one you
  haven't looked at yet. Offer this
  option anyway, and never drop it from the question just because your own
  first pass came up short: re-read `source_formula`'s own text — what it
  sums, filters, or references. When it names an account, or a row/GL code
  already in the parsed budget, that's the answer; record it rather than
  the label's own guess. When it instead points at a cell or range this
  data never carried (a criterion cell, a lookup range, a row on a sheet
  nothing here parsed), picking this option surfaces exactly that
  reference on the question rather than resolving it — naming the gap is
  the answer this option can give, not a guaranteed account. Record the
  result the same way any other answer to this row is
  recorded, with `--note "read off the workbook's formula"` so a later
  table view still shows an honest reason.
- **It is not in Carta** — the firm budgets for something their ledger has
  no account for. Record it with `answer … --budget-only`: the line renders
  budget-only, it stops being asked about, and the Step 5 read-out counts
  it among the lines that are budget-only by choice rather than by accident.
- **Leave it for now** — record nothing. It comes back next run, which is
  the right cost for an answer nobody is ready to give.

Never resolve one of these by picking the nearest name yourself. The
options exist because the match was close enough to show and not close
enough to trust — "LP portal expenses" against a firm's "LP meeting
expenses" is one word apart and a different account.

**An option covering several accounts names each one as a GL account, by
number — never as "sub-accounts".** In Carta a sub-account is a breakdown
inside one GL account (the `sub` on an entry, e.g. "Salaries & wages" under
7130 Payroll); separately numbered accounts are GL accounts in their own
right, however their names read. "Travel - airfare (7121)" is a GL account
beside "Travel (7110)", not under it. Label the option by its codes
("7110, 7121, 7124, 7126, 7127, 7128") and name each account in its
description.

An entry the build gave a `proposed` answer carries the decision it stands
for in `answer`, so "Yes, confirm all" records each of them by the keys
that `answer` holds, all in one command. `fund` and `gl_codes` together:
`answer <addr> --fund "<fund_name>"` and one `--gl <code>` per code, or
`--net` when `gl_codes` is empty — leave out `--fund` when `answer` has no
`fund`, and the `--gl`/`--net` when it has no `gl_codes`. `scope`:
`scope <addr>` and the flag its `source` names — `--tag
"<category>=<value>"` for a `reporting_tag`, `--vendor "<value>"`, or
`--sub "<value>"` for a `sub_account`. An entry with no `proposed` has no answer to record and must
be answered before it can be. On "No — a few need
changing", only re-ask about the numbers the operator names — the rest of
Current mapping still confirms as shown.

### Spend no budget line reports

The questions above are asked of the budget; this one is asked of the
ledger. `accountsData.unaccountedAccounts` lists every Carta account
carrying activity that no line reports, and they arrive in the same
numbered table — an account asks *which line reports it*, which is the
question a line asks about its values, from the other end.

**The question does not arise when the firm declined a budget** ("Skip
for now"). With no budget at all, there is no line for an account to be
missing from — `unaccountedAccounts` is empty, not a table of every
account asking to be mapped to lines that don't exist.

**When there is a budget, this question is never skipped** — not for
speed, not because the operator confirmed everything else at a glance, and
not because the accounts look small. It is the only place this money
surfaces at all.

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

- **An existing line reports it** — record it on that line:
  `answer <line's addr> --gl <each code it already has> --gl <this account>`
  — and `--fund "<fund_name>"` too when the line reports one fund. An
  answer states the line's fund and accounts whole, so restate everything
  it already carries. The line is what reports it, so that is where the
  answer belongs.
- **It needs a line of its own** — the workbook has nothing for this spend
  and the client wants it shown. That is a change to their budget rather
  than to the mapping: tell them, and leave the account unanswered. When
  there is no workbook (the firm chose "The budget in Carta"), each
  account Carta already budgets is its own line, so this answer means
  budgeting the account in Carta — nothing here reaches that stage unless
  Carta carries no budget for it at all.
- **Not expected in the budget** — recorded with `not-expected`, and never
  asked about again:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" not-expected "<dashboard_dir>" <gl_code> --source operator
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

Confirming records one `not-expected` per account in the row. A client who
wants one of them out of the group names it, and it becomes an ordinary
question.

**Two things the floor is blind to, so say them if they appear.** A
suspense account is a classification signal rather than a small expense,
and a negative figure is a credit rather than spend — either can sit under
the floor while meaning more than its size.

The count reaches the Step 5 read-out as *"N account(s) carry spend no
budget line reports"*, so a reader knows the page is not the whole ledger
before they start.

### A mapped account with nothing behind it

The question above asks about an account no line names; a `needs:
"zero_activity_account"` row is the opposite case — a line **does** map to
an account (it carries `gl_codes`), but nothing posted to any of them in
the budgets' combined window (the widest window among `excel_budgets`'
own windows — the same one `unaccountedAccounts` reads over, for the same
reason). That renders as a correct $0 variance, with nothing distinguishing
it from an account nobody has spent from.

It joins the same numbered table as every other row, always under **Needs
your input** — the build never pre-fills `proposed` on it, and neither do
you (see "Never propose an answer on a `needs: "zero_activity_account"`
row" above). The row carries the line's current account(s) as its
`options`, with no `why` of its own — say in your own words that each one
is currently mapped here and has shown no activity this window, so a better
account is still one tap away. A line whose `gl_codes` already came from a
recorded operator decision is never flagged this way: the operator already
answered it, and asking again every build because the account stays quiet
would mean the answer never sticks.

- **It's the right account, just quiet this period** — record the line's
  current codes with `answer <addr> --gl <each current code>` (plus
  `--fund "<fund_name>"` on a line that reports one fund), like any other
  answer; it is not flagged again.
- **It's one of these accounts instead** — name the real one and record it
  with `answer <addr> --gl <code>` (restating `--fund` the same way), same
  as any other remapping.
- **It's not in Carta** — `answer <addr> --budget-only`, same as any other
  line with no real counterpart.

The count reaches the Step 5 read-out as *"N mapped line(s) show zero
activity this window"*, separate from the unresolved-mapping count: a line
here already resolved, so it is not also counted as needing one.

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
| 7 | — | `<line>`, `<line>` +4 more — 23 lines | `<value>` |

A near match is an inference too, but one that is not always applied:
wording that shortens or misspells a value ("Atlas Prog" for "Atlas
Program"). A clear one is applied when that
value has spend on one of the line's own GL accounts, or when the client
confirmed it; otherwise it is offered as a suggestion on the line's own
scope question instead, because a resemblance in wording alone has
matched a meals line to an office pantry. A confirmation skips the spend
check on every later build: a confirmed programme with no spend yet this
year reports $0, not every dollar its accounts saw.

**One row per inference, not per line.** "Lines under this heading mean
this value" is one question however many rows it touches, and a line added
next quarter inherits the answer instead of reopening it.

**Confirming an inference is always a question, never part of the Current
mapping confirm-all** — even though the row arrives with `proposed` set.
One inference can narrow dozens of lines at once, so the operator sees
what each confirmation moves before giving it:

- Print each inference with its `line_count` ("Events — 23 lines"). A
  table of inferences with no counts is not a question the operator can
  answer.
- An inference with `needs_line_ack` (more than ten lines, or a one-word
  value such as "Events") gets **its own** `AskUserQuestion`, its count in
  the question itself. Only inferences without it may share one question,
  and that question still lists every one with its count.

Record each answer by its key — the row's `addr` minus `inference:`. For
an inference with `needs_line_ack`, `--lines` must restate its count, or
the command refuses:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" confirm-inference "<dashboard_dir>" "<inference_key>" --lines <line_count> --source operator
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" reject-inference "<dashboard_dir>" "<inference_key>" --source operator
```

`confirmed` stops it being asked again. `rejected` also stops the value
being applied — the lines go back to reporting their accounts whole: the
heading copied onto each line stops narrowing it too, and the near-match
pass never puts the value back. Both outrank the wording on every later
build. A rejection is final here: a rejected value scopes no line, so no
later build shows its line count again, and `confirm-inference` refuses
it. An operator who changes their mind scopes the lines they mean with
`scope`.

Two things never become an inference at all. A heading never matches a
value made only of words that identify nothing: filler such as a vendor
called "Expenses", or a vendor or sub-account named only in Carta's own
account words ("Other Income", "Bank Charges"). A reporting-tag value named
like an account ("Marketing") is still a cost centre and still matches. And
a line whose recorded answer is `scope --none` covers its accounts whole,
so no wording is matched against it and the heading copied onto it does
not narrow it.

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
not in git. Every answer reaches it through `record_mapping.py` (see
"Recording answers" below) — never a hand-written `json.dump`, never an
edit, never a delete to clear a single entry. A file that is there but
unreadable is not an empty one: the script refuses rather than start a
fresh one over the top, and so do you.

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
question can show which half it covers.

**Ask this one as a checkbox, not a single pick.** Set `multiSelect: true`
on the `AskUserQuestion` and list every component's candidates as options
— the operator checks one (or more, if a component itself is ambiguous)
per component in the same action, rather than the question forcing an
either/or choice on a line that genuinely means both.

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

Record every answer by the row's `addr` (not its bare `key`), and re-run
Step 4:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" answer "<dashboard_dir>" "<addr>" --fund "<fund_name>" --source operator
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" answer "<dashboard_dir>" "<addr>" --gl <gl_code> --gl <gl_code> --source operator
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" answer "<dashboard_dir>" "<addr>" --fund "<fund_name>" --gl <gl_code> --source operator
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" answer "<dashboard_dir>" "<addr>" --fund "<fund_name>" --net --source operator
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" answer "<dashboard_dir>" "<addr>" --budget-only --source operator
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" answer "<dashboard_dir>" "<addr>" --remove --source operator
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/record_mapping.py" answer "<dashboard_dir>" "<addr>" --fee-source omit --source operator
```

An `answer` states the line's fund and accounts whole: `--gl` alone clears
a fund recorded earlier, and `--fund` alone clears its accounts. On a line
that reports one fund, restate the fund with its accounts (`--fund … --gl`
or `--fund … --net`). `--fee-source` answers a `needs: "fee_offset"` row —
`omit` or `fund_ledger`, its two `options` — and is the one answer that
leaves the line's fund and accounts as they are.

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

`--fund "<fund_name>" --net` is an answer: on a per-fund line it means the
net of every account that fund posts to. Recorded answers survive re-runs and are not asked
about again — except a fee split that leaves two lines of one fund on the
same account, which comes back because it double-counts.

### Recording answers: record_mapping.py, and who gave each one

Every answer in this file reaches `budget-mapping.json` through one
`record_mapping.py` command — `answer`, `scope`, `confirm-inference`,
`reject-inference`, `not-expected`, or `fund` — and nothing else writes it.
Each command merges one answer and stamps it with `--source` and the time.
`--source` is required, and it says who gave the answer:

- **`--source operator`** — the operator gave this answer: they picked it
  in an `AskUserQuestion`, or confirmed it in a "Yes, confirm all" over a
  table that listed it.
- **`--source operator-delegated`** — you chose it on their behalf. When
  the operator says "do your best", "you decide", or anything like it,
  make the call and record each such answer this way — never as
  `operator`. Then list every one back in your next message, by line and
  answer, so the operator can see exactly what was decided for them.

A changed answer carries the `--source` it is recorded with. Restating an
answer exactly as it is on file is not giving it: the command writes
nothing, and the answer keeps the stamp it had — `operator-delegated`, or
none.

After the rebuild, `accountsData.mappingProvenance` lists both kinds, and
the gaps line counts them: *"N answer(s) made on your behalf
(operator-delegated)"* and *"M answer(s) with no recorded source (written
before or outside record_mapping.py)"*. Read both back at this step. A
mapping file from before the stamp existed loads unchanged; its answers
are the second kind, counted on every build until changed, and never
asked about again on that account alone.
