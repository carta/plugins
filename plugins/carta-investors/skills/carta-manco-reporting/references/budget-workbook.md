# Resolving and parsing a firm's Excel budget workbook

Step 2.75's detail: which workbook is in play, which tabs to read, what shape
each is, how the parse is validated and persisted, and how custom categories
reach the chart-of-accounts mapping. Reached from
[budget-ingest.md](budget-ingest.md)'s Step 2.75 gate — read it only when that
gate says a workbook actually needs resolving.

> Steps referenced here that are documented elsewhere: **Step 2.5 / Step 2.75 gate** → [budget-ingest.md](budget-ingest.md); **Step 3** → [data-fetch.md](data-fetch.md); **Step 4** → [serve-and-update.md](serve-and-update.md).

### 2.75a — Resolve workbook source

Determine `<WORKBOOK_PATH>`, `<SHEET_NAME>` and `<SHAPE_ADAPTER>` in this
order:

1. **Explicit arg**: if the user passed `--budget-workbook <path>` (or a
   bare `.xlsx` path in the prompt), captured as `<WORKBOOK_ARG>` in
   Step 0.1, use that path and go to 2.75a-ii.
2. **Persisted ref**: if no arg, read `<dashboard_dir>/.workbook-ref.json`
   (written on the first ingest — see 2.75c). **A ref recording the shape
   as `dept-crosstab` means `tag-crosstab`** — the layout was renamed for
   what it is rather than what one firm called it, and a ref written before
   that still says the old word. Read it as the new one and carry on; the
   next write records the new spelling.
   - Carries `path`/`sheet`/`shape` and the file still exists → compare the
     file's current mtime (`os.path.getmtime`) against the ref's own
     `workbook_mtime` (2.75c) before deciding whether 2.75b needs to run
     for real:
     - **Unchanged** → the parsed `budget*.json` files already reflect
       this exact file byte-for-byte; skip 2.75b's re-parse entirely and
       go straight to 2.75c (nothing new to record) / 2.75e. Re-parsing an
       untouched workbook every invocation costs real seconds for output
       that comes out identical every time; this is what `workbook_mtime`
       exists to catch.
     - **Changed** → the operator edited the workbook since the last
       ingest. Reuse `path`/`sheet`/`shape` silently (still no need to
       re-ask which tabs), but go to 2.75b and re-parse for real — this
       is the case "budget state has to be re-resolved on every
       invocation" (2.5) exists for, and now it's real work only when
       something could actually have changed.
     - **`workbook_mtime` absent** (a ref written before this field
       existed) → treat as changed: re-parse once, which populates it so
       every invocation after this one can skip cleanly.
   - Carries `path` but the file is gone → go to 2.75a-0 and try to find
     it before giving up.
   - Carries `{"declined": true}` → the operator has already answered.
     Skip 2.75 silently.
   - Carries `{"declined": true, "deferred": true}` → written by an
     earlier version that defaulted rather than asking, so this firm has
     never actually been asked. Treat it as unanswered: go to 2.75a-i.
3. **Neither** → this firm has never been asked. Go to 2.75a-i and ask,
   before the dashboard is built. The budget is what the operator came
   for; building on a fallback they were never offered, and raising it
   afterwards, means the first thing they see is the wrong report.

#### 2.75a-0 — The ref's workbook is missing

A ref goes stale for one boring reason far more often than any other: the
operator renamed or moved the file. The tabs travel with it, so look
before declaring the budget lost.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/inspect_workbook.py" \
  --find-in "<directory the ref's path pointed at>" \
  --require-sheets "<every sheet the ref names>"
```

A workbook in the same folder carrying the same tabs is almost certainly
the same workbook renamed. When there are candidates, ask via
`AskUserQuestion`:

> **The budget workbook isn't where it was — is this it?**
> `<old filename>` is gone. `<candidate filename>` is in the same folder
> and has the same tabs (`<sheet names>`).

Offer each candidate (`complete: true` ones first), plus "No — I'll send
you the file" (then [Asking for a file](#asking-for-a-file)) and "No
budget this run". On acceptance, rewrite the ref's
`path` and carry on to 2.75b as though nothing happened. Say one line
about what you re-pointed — silent self-repair on a file the operator
didn't ask you to touch is worse than the failure.

Only when the search returns nothing, fall back to the old behavior:

> The workbook your budget came from is no longer at `<path>`, so Budget
> vs Actuals is off for this run. Drag the workbook into the chat to
> re-point it, or pass `--budget-workbook <path>` next time.

Do not re-point without asking, and do not accept a candidate that is
missing sheets the ref names — a workbook with two of three tabs is a
different file, or an older copy, and quietly rendering two thirds of a
budget is worse than rendering none.

#### 2.75a-i — Ask whether there's a budget workbook

Reached when there is no arg and no ref, which means this firm has never
been asked. **Ask once**, via a single `AskUserQuestion`, before Step 3:

> **Where should `<MANCO_NAME>`'s budget come from?**
> Budget vs Actuals compares your firm's budget against its Carta journal
> entries. Your own workbook gives the richest report — its budget line
> items, date range preferences, its own wording. Carta's stored budget
> works too, broken out per GL account.

**Do not name a dimension here.** "Its departments" was one firm's word
for their own breakout, written into copy every firm reads. Carta carries
reporting tags under whatever category a firm named, plus sub-accounts and
vendors, and a firm that breaks spend out by cost centre or by fund should
not be told the report is about departments. The same rule the dashboard
follows with `dimensionLabel` — answer in the firm's own word, or in none
at all.

Options:
- **Your Excel workbook** → collect the file per [Asking for a
  file](#asking-for-a-file) below, then continue to 2.75a-ii.
- **The budget in Carta** → write `{"declined": true}` to
  `<dashboard_dir>/.workbook-ref.json` and skip the rest of Step 2.75.
  The dashboard renders a per-account Budget vs Actuals from Carta's own
  budget.
- **Neither / skip for now** → same `{"declined": true}`. Carta's budget
  is used if the firm has one; if not, the dashboard is actuals-only and
  the Budget vs Actuals page does not appear.

Record the answer either way: without it every future invocation re-asks,
and a firm that keeps its budget in Carta would be prompted forever.

To change it later, pass `--budget-workbook <path>` (which overrides a
recorded answer), or delete `.workbook-ref.json` from the firm's cache
dir to be asked again.

#### Asking for a file

Every prompt in this skill that needs a file — a budget workbook, a
mapping workbook — collects it the same way.

**Ask in the chat, as prose. Never via `AskUserQuestion`.** A file can be
dragged into the chat, and the app turns the drop into the file's own
path. It cannot be dragged into a picker, whose free-text field is a text
box. Using a picker here forces the one user who has the file in hand to
type its path by hand.

> **Send me your budget workbook.** Drag the `.xlsx` into the chat, or
> paste its full path — either works.

Then wait for the reply. Do not offer example paths as selectable
options: `~/Downloads/budget.xlsx` is not a file the user has, and
captioning it "example only" does not stop it reading as an answer.

**Normalise what comes back** before passing it to any script. A dragged
file arrives as an `@`-mention, and a path pasted from Finder may carry
quotes or an escaped space:

```bash
# @"/Users/me/Downloads/Budget FY26.xlsx"  →  /Users/me/Downloads/Budget FY26.xlsx
WB="$(printf '%s' "$RAW" | sed -e 's/^@//' -e 's/^["'"'"']//' -e 's/["'"'"']$//')"
[ -f "$WB" ] || { echo "no file at: $WB"; }
```

Quote `"$WB"` everywhere downstream — these filenames routinely carry
spaces and `&`.

#### 2.75a-ii — Resolve the sheet and shape

Given a workbook path, list its tabs rather than making the user recall
one — a sheet name like `Budget vs Actuals (Dept View)` has to be typed
exactly, and getting it wrong fails the parse:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/inspect_workbook.py" \
  --workbook "<WORKBOOK_PATH>" \
  --accounts "<raw_dir>/accounts-all.txt"
```

The JSON lists every sheet, ordered so budget-looking tabs come first and
hidden ones last. Each carries `likely_shape` (`tag-crosstab`,
`pnl-outline`, `monthly-crosstab`, `coa-mapping`, or null), a one-line
`why`, and `shape_settled` — whether that classification is structural
evidence or a best guess. Those three decide which tabs are offered, and
whether the shape is stated or asked about.

`--accounts` points at the chart of accounts Step 2.6 fetched. **Drop the
flag when that file does not exist** — the run stays correct without it.

With it, each sheet also carries a `row_axis`: which label column its rows
live in, how many of them name an account Carta already holds, and a
verdict of `carta-accounts`, `own-categories`, or `unclear`. Measured
across the candidate budget sheets of three real firms, that reads 92%,
24%, 2% and 62% — decisive at both ends, genuinely undecidable in the
middle, which is why `unclear` exists rather than a threshold that always
picks a side.

**Nothing reads `row_axis` yet.** It is reported so it can be checked
against real workbooks before anything depends on it. It corroborates a
shape rather than deciding one — a sheet whose rows name Carta's accounts
can be any of the three.

### Offer the tabs that look like budgets, not the workbook

**Only sheets with a non-null `likely_shape` are offered, and at most
three.** A financial-statements workbook carries twenty tabs — posted
journals, an expense export, a fee schedule per fund — and none of them is
the budget. Listing all of them makes the operator do the classifying that
the inspector has already done, in a picker where every option looks
equally plausible.

Rank the candidates by `shape_settled` first, then by row count, and offer
the top three. Prefer variety where they tie: if several share a shape,
lead with one of each rather than three near-identical crosstabs, so an
outline-shaped budget isn't pushed off the list by department views.

Ask **one multi-select `AskUserQuestion`** — a workbook routinely holds
more than one budget worth showing (a YTD department view alongside an
annual plan), and making the operator re-invoke the skill per tab is the
wrong shape. Name each candidate and say what it looks like in the
workbook's own terms — periods and what the rows are — never by adapter
name.

The fourth option is always **"None of these — show me every tab"**, which
lists the rest in batches of three plus a further "more" option until the
list is exhausted. Narrowing the offer is a convenience, not a decision:
an operator whose budget the inspector failed to recognise must still be
able to reach it.

**When no sheet has a shape at all**, say so and list every tab instead —
there is nothing to narrow to, and silently showing a bare tab list would
read as though the inspector had endorsed them.

Hidden tabs are offered last, and only when nothing visible looks like a
budget — an author who hid a sheet usually meant it.

### The shape is stated, not asked, when the header settles it

**Do not ask about a sheet whose `shape_settled` is true.** The classifier
has already run — it is what ordered and narrowed the question above — and
asking the operator to confirm its answer is asking them to agree with a
reading they cannot check without opening the file. On the tabs three real
firms actually picked, the classification matched what they confirmed
every time.

`shape_settled` marks a classification that rests on something a
differently-shaped sheet does not have in its header: four or more quarter
columns, twelve months plus a year total, or named super-headers over
repeated Actual/Budget blocks. Say what you are reading it as, in the same
line that reports the parse, and move on:

> Reading **Budget 2026** as an income-statement outline — quarterly
> columns, spread across each quarter's months.

**A stated shape is still correctable.** If the parse then fails, or the
operator says the report is reading their sheet wrongly, come back here —
and treat the shape as unsettled when you do, so the ask below runs rather
than the same statement being repeated. See 2.75b's failure handling.
Stating a shape saves a question; it does not close the subject.

### A tab whose shape is unsettled — ask in their words, not ours

Reached when a selected sheet's `shape_settled` is false: `likely_shape` is
null, or it is one of the two guesses that stay open (`monthly-crosstab`
fires on twelve month labels plus a single Actual/Budget marker, which a
monthly outline also satisfies and which no customer workbook has
validated; `coa-mapping` rests on a repeat ratio tuned on one firm's tabs).

**Never offer the adapter names.** `tag-crosstab`, `pnl-outline` and
`monthly-crosstab` are this skill's internal vocabulary. An operator
cannot tell which describes their sheet without reading all three
carefully and mapping them onto a file they are not looking at, and the
question reads as an exam. Asking someone to pick from a list they have no
basis to choose from produces an answer, not information.

**Say what this skill ingests, because that is the other half of the
answer.** It reads **budget reports** — a tab stating what the firm planned
to spend and earn. It does not read a balance sheet, a trial balance, a
posted-journals export or a fee schedule. An operator who picked one of
those has not made a mistake about the layout; they have picked a tab this
skill has no use for, and asking them to describe its columns will not
change that.

Ask them to describe it, via `AskUserQuestion` with a free-text option:

> **How is `<sheet name>` laid out?**
> I couldn't recognise the layout of this tab well enough to build it into
> the microapp. Describe the budget tab in your own words — what the rows
> are, and what the columns across the top row are.

Offer alongside it: **"Skip this tab"**, which drops the sheet and carries
on with whatever else was selected (or, if it was the only one, with no
budget this run — see 2.75a-i's caveat).

**Map their answer to a shape yourself**, using the descriptions below —
the operator states what their sheet contains, and this step translates
that into an adapter. Read for the two things that separate the shapes:

| What they describe | Shape |
|---|---|
| rows are GL / P&L lines; the columns repeat Actual / Budget / Variance once per department, team, cost centre, fund — whatever they break the budget out by | `tag-crosstab` |
| reads top to bottom like an income statement — income, then expenses, subtotals, a bottom line — with one column per quarter or per month | `pnl-outline` |
| one budget for the whole management company, broken out by nothing, with a column per calendar month | `monthly-crosstab` |

#### When it still cannot be read, say so — never drop it quietly

A tab the operator chose and then never hears about again reads as a tab
that worked. They will look for it on the Budget vs Actuals page, not find
it, and have no way to know whether it failed, was ignored, or is simply
empty. **Every tab that leaves this step unread is named out loud, with the
reason and what it costs.**

Three ways a selected tab ends up unread, and all three are reported the
same way:

| | Say |
|---|---|
| the description matches no shape | *"I couldn't place `<sheet>` from that description — `<what was ambiguous>`. It's left out of this run."* |
| the description is a shape, but the parse then fails | 2.75b's own refusal message names the tab and the reason |
| it isn't a budget report | *"`<sheet>` looks like a `<balance sheet / journal export / …>`. This skill reads budget reports — what the firm planned to spend and earn — so there's nothing for it to import here."* |

Then say what follows, in the same breath:

- **What is still being built** — the other selected tabs, by name, or that
  there is no budget this run and the dashboard will show spend without a
  budget beside it.
- **How to get it in** — point them at a tab that is a budget, or offer to
  re-run once they can name the right one. Do not ask them to describe the
  same tab a second time in the same run; a second attempt at a description
  that already failed is a question with no new information behind it.

**Never guess the nearest shape to avoid the conversation.** A wrong
adapter does not fail loudly — it parses the wrong columns successfully and
produces a Budget vs Actuals page that is plausible and wrong, which is far
more expensive than a tab the operator was told was skipped.

**Keep the "not a recognized budget" guard.** A tab that reaches 2.75b and
fails to parse is reported as such — that guard is what stops a
misidentified sheet becoming a silent wrong dashboard, and none of the
above replaces it.

Store the selections as `<SHEETS>`, a list of `{sheet, shape, slug}`. The
slug is a short kebab-case form of the sheet name, used for the output
filename in 2.75b.

### 2.75b — Parse the workbook

Run once per entry in `<SHEETS>`. The first selection writes
`budget.json`; any others write `budget-<slug>.json`, which is how the
build script tells the primary from the rest.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/parse_budget_workbook.py" \
  --workbook "<WORKBOOK_PATH>" \
  --sheet "<SHEET_NAME>" \
  --shape "<SHAPE_ADAPTER>" \
  --label "<human-readable label>" \
  --out "<dashboard_dir>/budget.json"
```

Pass back every answer the ref (2.75c) records for that sheet —
`--period-start`, `--period-year`, `--stop-label` — so an answer the
operator gave once survives the re-parse every invocation performs.
Losing one doesn't degrade quietly: a multi-year tab with no
`--period-year` refuses outright, and a sheet that needs `--stop-label`
gets refused by the credibility gate on every run until it is supplied
again.

`--label` is what appears in the sidebar sub-nav, so make it read like
something a person would say — "Dept View · YTD Q2 2026" rather than the
raw sheet name where they differ.

If a sheet fails to parse, report which one and carry on with the rest
rather than abandoning the whole ingest — one unreadable tab shouldn't
cost the operator the tabs that did work.

That applies to a sheet the adapter could not read. A sheet it read and
then **refused** is a different thing, and carrying on is the wrong
answer — see 2.75b-iii.

#### 2.75b-i — The window actuals are summed over

Every budget is compared against Carta spend over exactly one window, and
that window comes from the budget, not from today's date: each budget's
own `period_start`/`period_end` (2.75b-ii resolves a sheet that doesn't
state where it begins).

**Apply it silently — don't ask the operator to confirm it before
building.** There's nothing to record here: the window comes straight off
what the sheet states, and 2.75c's ref file carries no answer for it.

Two things this window has to get right, with no question to catch them:

**The end date is the sheet's claim, not a fact.** A workbook can carry a
June title band over an Actual column its author last refreshed in March —
the tab says one period, its own numbers cover another. We recompute
actuals from Carta and so are unaffected, but the dashboard will then
disagree with the client's own spreadsheet by a whole quarter. Catching
that is now the reader's job once the dashboard is up (below), not
something the build front-loads into a question.

**Spend after a budget's end date is not overspend.** Summing to today
against a budget that stopped in June reports the calendar as a variance,
in the firm's favour or against it depending on the line — exactly why the
window defaults to the budget's own end, never past it, on its own.

**Adjusting after the build, not before it.** A reader who wants a wider
window than the tab states gets there post-build, never as an upfront
question:
- A `by-account` budget already carries a live date-range control
  (`BudgetPeriodControls`, defaulting to the tab's own window) that
  re-sums real actuals for whatever range it's set to.
- A `by-tag-crosstab` budget has a single "Compare through today instead"
  toggle instead of a full range picker — its column budgets are one
  total each, not a monthly split, so there's no safe way to widen
  actuals without a matching wider budget figure behind them. It sits in
  its own row below the period chip, paired with a short hint, matching
  the layout of this view's other toggles (show-all-departments,
  show-hidden-rows) rather than sharing the chip's own row — the chip row
  is `justify-content: space-between`, which stretches a lone second item
  to the far edge instead of keeping it beside what it modifies. The
  toggle only ever widens the upper bound to the true as-of date, and
  relabels the chip plainly ("... through today") rather than reusing the
  tab's own label for a window it no longer describes.
- A `by-line-item` (outline) budget has neither yet — a real gap, tracked
  in [errors.md](errors.md).

#### 2.75b-ii — Confirm the start when the sheet is ambiguous

After parsing, check each budget's emitted `period_start` / `period_end`.
A crosstab reads its end date from its own title band ("For the Period
Ending June 30, 2026"), but **nothing in the sheet says where the period
begins.**

This is not hypothetical. A real workbook's year-to-date and
quarter-to-date tabs carried byte-identical title bands — same heading,
same period line — differing only in the tab name. Assuming January
compares a quarter's budget against a year's spend, and the variance is
wrong by the whole difference.

**The parser enforces this.** A sheet whose name says it covers part of a
year, with a `period_end` and no `--period-start`, fails the parse and
prints the plausible windows. You do not have to notice the situation —
you have to answer it.

When that error appears — or, ahead of it, when a parsed budget has a
`period_end` but no `period_start` and its sheet name or label hints at a
period shorter than year-to-date (QTD, Q1, "quarter", MTD) — ask once via
`AskUserQuestion`:

> **What period does `<sheet name>` cover?**
> Its title says it ends `<period_end>`, but not where it starts. Actuals
> are summed over exactly this window, so getting it wrong compares one
> period's budget against another's spend.

Offer the plausible windows given the end date — year-to-date, the quarter
ending then, the month ending then — and re-run 2.75b for that sheet with
`--period-start <ISO date>`.

Do not infer the period from the tab name without asking. "QTD" in a sheet
name is a human label, not metadata, and a firm that names tabs differently
would be silently misread.

#### 2.75b-iii — When the parse-credibility gate refuses

`parse_budget_workbook.py` checks its own output before writing it: that
the line rows aren't all zero, that the workbook's own stated totals tie
to the rows beneath them, and that it read a plausible share of the
sheet's numeric rows. A refusal exits 5, writes nothing, and names the
check and the figures.

**A refusal is a question, not a verdict.** The adapter read the sheet;
what it produced doesn't hold together. Nearly always the operator knows
the missing piece — which year is real, where their budget stops — and
one answer turns the refusal into a correct parse. Reporting it and
moving on wastes the one thing the gate bought.

Read the check name in the error and work it through:

- **`all_zero_refusal`** — either no line rows at all, or every one zero.
  Most often the sheet declares a year it hasn't filled in yet: a plan
  with 2024–2027 columns where only 2024–2025 carry figures. Ask which
  year they want and re-run with that `--period-year`. Failing that the
  shape is wrong — the header block matched but the budget sits elsewhere
  on the tab, so go back to 2.75a-ii. **Treat the shape as unsettled on
  re-entry**, whatever `shape_settled` said: the classification has now
  been tested against the sheet and lost, so restating it would ask the
  parse to fail the same way twice. Take the operator's own description
  instead. Only a genuinely empty template justifies `--skip-validation`.

- **`tie_out`, refused** — a stated total is off from the rows we summed
  by a multiple, or against the opposite sign. When the sum is *larger*
  than the total, the outline usually ran past the end of the budget into
  a supporting schedule and counted it twice; ask the operator for the
  last row of the real budget and re-run with `--stop-label "<that row>"`.
  When the sum is *smaller*, lines the total covers weren't read as lines
  — that's a parser limit, not a missing answer, so say so plainly rather
  than sending them looking for a setting that doesn't exist.

- **`coverage`** — far fewer rows emitted than the sheet has numbers in.
  The shape or the sheet is wrong; re-confirm both.

Put the figures in front of them rather than the check name: *"On `<tab>`
the sheet's own Total Expenses says $741,000, but the lines under it add
to $0 — so something isn't being read. Does the budget stop at a
particular row?"* An accountant can answer that; "tie_out failed" they
cannot.

**Never pass `--skip-validation` on the operator's behalf.** It exists
for a workbook they have looked at and confirmed is genuinely shaped that
way. Forcing it silently reinstates exactly the failure the gate was
built to stop — a confident dashboard built on numbers nobody checked.

Record whatever answer resolves it in the ref (2.75c). Without that the
same refusal returns on the next invocation and they answer it again.

A `tie_out` **warning** is different: the parse is written and the run
continues. It means the firm's own total disagrees with its own parts,
which is legitimate — the workbook wins, and we mirror what they see.
Mention it once, in passing, and don't treat it as a problem to solve.

### 2.75c — Persist the workbook reference

After parsing, write `<dashboard_dir>/.workbook-ref.json` naming every
budget produced in this ingest — one entry per selected sheet:

```json
{
  "path": "<WORKBOOK_PATH>",
  "workbook_mtime": 1735689600.0,
  "budgets": [
    {"sheet": "<SHEET_NAME>", "shape": "<SHAPE_ADAPTER>", "file": "budget.json"},
    {"sheet": "<SHEET_NAME>", "shape": "<SHAPE_ADAPTER>", "file": "budget-<slug>.json",
     "period_start": "2026-04-01", "period_year": 2026,
     "stop_label": "Total Expenses"}
  ]
}
```

`workbook_mtime` is `path`'s own `os.path.getmtime` at the moment this
write happens — i.e., right after a real 2.75b parse, never copied
forward from an old ref. 2.75a checks it before reusing this ref at all,
so it's what lets an untouched workbook skip re-parsing while an edited
one still gets caught on the very next invocation. Independent of
`derived_from.source_mtime` below, which tracks a different file for a
different reason (staleness against the client's original, not this
skip).

Record every answer the operator gave about a sheet, and pass each back on
later invocations:

| Recorded | Passed back as | Set when |
|---|---|---|
| `period_start` | `--period-start` | 2.75b-ii settled an ambiguous start |
| `period_year` | `--period-year` | the tab states several years |
| `stop_label` | `--stop-label` | 2.75b-iii found where the budget ends |

Each is an answer the sheet cannot give about itself, so an unrecorded one
is given once and lost. The failures are not subtle: the window silently
reverts to January, a multi-year tab refuses outright, and a sheet needing
a stop label is refused by the credibility gate on every run.

**List every sheet, not just the first.** The build script renders exactly
the files the ref names. A budget left over from an earlier ingest is then
ignored rather than riding along — selecting three tabs and getting four
Budget-vs-Actuals views back, the fourth unconnected to anything chosen
this time, is the failure this prevents. Stale files stay on disk and are
reported, so re-ingesting that sheet brings it back.

Future invocations reuse this without prompting. A new
`--budget-workbook <new_path>` overrides it, and re-ingesting replaces the
list wholesale — so dropping a tab from the selection drops its view.

**This file is what makes a parsed budget count.** `build_manco_datadir.py`
ignores `budget*.json` in a firm's cache dir unless the ref accounts for
them and the source workbook is still where the ref says. The ref is the
record of intent; the JSON beside it is derived output. Without that rule
a budget, once ingested, renders forever — outliving a decline at the
prompt and outliving the workbook it came from. If the build script warns
about orphaned budget files, it means parsed output is present with no ref
to explain it, and the fix is to re-ingest rather than to trust it.

#### When `<WORKBOOK_PATH>` is a locally-transformed copy, not the client's own file

None of the built-in shape adapters fit every real workbook — an operator
can end up hand-transforming a copy of the client's file (a monthly sheet
regrouped into quarters, say) to get it through one. Record that provenance
on the entry instead of leaving `path` pointing at a file the client never
sent:

```json
{"sheet": "<SHEET_NAME>", "shape": "<SHAPE_ADAPTER>", "file": "budget.json",
 "derived_from": {"source_path": "<ORIGINAL_CLIENT_FILE>", "source_mtime": 1735689600.0}}
```

`source_mtime` is the original file's modification time at the moment it
was transformed (`os.path.getmtime`) — the thing to compare against on a
later invocation, not a value to ever recompute from the derived copy.

**Check it at 2.5/2.75a, before reusing the ref.** If any budget entry
carries `derived_from`, stat `source_path` and compare its current mtime
against the recorded `source_mtime`. A mismatch means the client sent an
updated workbook after the transform was made, and the derived copy this
firm's dashboard is built from no longer reflects it — the two files have
silently diverged with nothing else to catch it. Warn, don't silently
re-derive (the transform was a one-off manual step, not a script this flow
owns): *"`<source_path>` has changed since `<file>` was derived from it —
the budget on this dashboard may be out of date. Re-derive and re-ingest
to pick up the update."* Continue with the existing (now possibly stale)
budget rather than blocking the run on it.

### 2.75d — Speak once at first ingest

The very first time a workbook is ingested for a given firm, break
silence with one line: *"Ingested budget from <workbook_filename> ·
<sheet_name>. Future invocations will reuse it automatically."*
Subsequent invocations that pick up the persisted ref run silently.

### 2.75e — Custom categories and the COA mapping

A budget tab that names its line items after Carta's own GL accounts joins
to actuals on its own. Most don't: firms group spend into their own
buckets ("Salaries, Benefits, and Payroll Taxes") and name departments
their own way, and those labels have to be bridged to Carta's GL codes and
`REPORTING_TAGS_JSON.Department` values before any actual can be resolved.

**Skip this step entirely** when `--coa-mapping <path>` was passed, or when
`<dashboard_dir>/.coa-mapping-ref.json` already records one — go straight
to the parse below.

**Look in the workbook already in play before asking for a file.** Step
2.75a-ii's `inspect_workbook.py` run classifies every sheet, and a client
who maintains a Carta-GL-to-budget-category mapping usually keeps it as a
tab in the same file — `likely_shape: "coa-mapping"`. When one is there,
use it: parse that sheet and say so in one line, rather than asking for a
file the operator would have to go and find inside the workbook they just
sent. Ask only when no sheet is classified that way. Carry its name
forward as `<COA_MAPPING_SHEET_NAME>` — the parser matches by exact sheet
name and does not default to whichever tab was just classified.

This is not a small convenience. Without the mapping, a budget written in
the firm's own words resolves almost no actuals — one real workbook went
from 5 of 92 lines carrying Carta GL codes to 38, and the Actual column
from blank to populated, on nothing but reading a tab that was already
in the file.

**Check whether any selected sheet is `pnl-outline` first — it changes
which options are honest to offer.** `shapes/pnl_outline.py`'s GL-code
resolution (`_gl_codes_for`) tries a supplied mapping record's category
first, then falls back to a Carta account number the line's own label
states (a 4-digit code, leading 4-7 — e.g. "4100 - Client Fees"). A line
named only in the firm's own words ("Salaries, Benefits, and Payroll
Taxes") still needs a mapping; a line already carrying its own Carta code
resolves with no mapping file at all. `tag-crosstab` remains stronger
still — its GL codes come straight out of column A for every row,
independent of a line's label text or any mapping file.

Ask once, via a single `AskUserQuestion` — the wording depends on whether
any selected sheet is `pnl-outline`:

**No `pnl-outline` sheet selected** (tag-crosstab only) — the original
three-way question, unchanged:

> **Does this budget use your own category or breakout names?**
> Line items, and whatever the budget breaks them out by, have to be
> matched to Carta GL accounts and your own reporting-tag values before
> actuals can be resolved against them.

Options:
- **Yes, and I have the mapping file** → collect it per [Asking for a
  file](#asking-for-a-file), then parse it as below. This is the reliable
  route and worth asking for.
- **No mapping file — I'll map natively to Carta** → proceed. Say the
  caveat below. This still only covers GL-account matching by name (Step
  4.7 does that regardless of a mapping file); deriving department/tag
  correspondence from the firm's own Carta data is planned, not yet
  built.
- **No — the tab already carries Carta GL codes** → skip, no caveat
  needed. A tag-crosstab with GL codes in column A is the common case
  here, and this shape genuinely resolves them without a mapping file.

**At least one `pnl-outline` sheet selected** — drop the third option
entirely, since a sheet mixing coded and named lines can't promise every
line resolves:

> **Do you have a Carta GL-to-budget-category mapping for this workbook?**
> `<sheet name>` reads top-to-bottom like an income statement. Lines
> already named after a Carta account (e.g. "4100 - Client Fees") resolve
> on their own; lines named only in your own words ("Salaries,
> Benefits, and Payroll Taxes") need a mapping file to match to a Carta
> account.

Options:
- **Yes, I have one** → collect it per [Asking for a
  file](#asking-for-a-file), then parse it as below.
- **No mapping file — I'll map natively to Carta** → proceed. Say the
  caveat below.

**Say this whenever proceeding without a mapping file** (either "No
mapping file — I'll map natively to Carta" branch above): *"I'll match
each budget line to your Carta chart of accounts directly — anything I
can't resolve with confidence, you'll get to confirm before the
dashboard renders."* Name the attempt up front rather than only the
failure mode: Step 4.7 is where that confirmation actually happens,
matching lines by name against the firm's own Carta accounts and asking
about the close calls — this runs whether or not a mapping file was
supplied. It doesn't cover department/reporting-tag correspondence,
which a mapping file resolves and this path can't yet derive on its own
(see [errors.md](errors.md)). For any selected `pnl-outline` sheet
specifically, the native-mapping attempt covers only the lines named in
the firm's own words — a line already stating its own Carta account
number resolves regardless — so say which kind you mean rather than let
the operator assume the whole sheet is dark.

Record the answer in `.coa-mapping-ref.json` (`{"declined": true}` for
either "no mapping" branch) so this isn't asked again for this firm.

**A note on what a mapping can and can't be inferred.** Line items often
carry enough signal to match by name — a budget line "Salaries" against
Carta's "Gross Wages and Salaries". Department names frequently do not: a
workbook column headed "Client Services" against journal entries Carta
tags "CS" share nothing a matcher can use, because the relationship is
institutional knowledge rather than string similarity. That is precisely
the case the mapping file exists to carry, which is why it's worth one
question rather than an assumption.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/parse_coa_mapping.py" \
  --workbook "<COA_MAPPING_PATH>" \
  --sheet "<COA_MAPPING_SHEET_NAME>" \
  --out "<dashboard_dir>/coa-mapping.json" \
  --dept-vocabulary-from "<dashboard_dir>/budget.json" \
  --carta-tags-from "<dashboard_dir>/accounts.json"
```

`--carta-subs-from` does the same for a sub-account column, and defaults to
the same file. A firm heads that column with their own word — "Office",
"Site" — which reads like a reporting tag and holds sub-accounts; the
values settle it. Where the mapping names one, the budget line is scoped to
it, so a line whose label doesn't mention the office still resolves.

`--carta-tags-from` is what finds the mapping sheet's tag column. Add it
whenever the dashboard dir already carries a build — the firm's real tag
values identify that column by its contents, which no list of header
wordings can do for a category the client named themselves. Drop the flag
on a first-ever ingest, where there is no build to read yet; the parse
falls back to header wording, and the next invocation has the data.

`--dept-vocabulary-from` points at the budget parsed in 2.75b and is what
reconciles the two files' department spellings, so a mapping section
reading "Investment" resolves onto the workbook's own "Investment Team"
rather than sitting beside it as a second department. Drop the flag when
no department-shaped budget was parsed.

**"No department/tag column found" does not always mean the wrong sheet.**
Some firms budget with no breakout axis at all — no department, cost
center, fund, or office column, just a plain GL-to-category map (e.g. a
"GL to Bucket Mapping" tab: account name in one column, expense bucket in
the next, nothing else). The parser raises rather than silently emitting
an empty `value_aliases` on purpose — that output is indistinguishable
from a real tag column this parser failed to detect, and the two need
different fixes. Tell them apart with `--suggest` before doing anything
else: dump the header row and a few sample rows, and read them yourself.
If a department/cost-center/fund/office column is genuinely there and the
parser missed it, fix detection with an explicit `--header-row`/`--columns`
(or add `--carta-tags-from` if the values just don't match the header
keywords). **If it plainly is not there — the sheet has nothing to name a
breakout axis with — pass `--no-tag-axis`.** That is the caller (you)
affirming the absence is real, not a way to force past a column the
sheet actually has; passing it over a sheet with a real tag column does
nothing (the column still resolves, aliases and all) but passing it to
paper over a genuine miss ships a mapping that silently joins nothing.
An empty `value_aliases` from a `--no-tag-axis` parse is the correct,
expected output, not a gap — say so in one line rather than treating it
as a caveat: *"This budget has no department/cost-center breakout, so
there's nothing to alias — GL-to-category matching still applies."*
**Persist `no_tag_axis: true` in `.coa-mapping-ref.json` alongside
`header_row`/`columns` whenever the flag was needed**, and pass
`--no-tag-axis` again on every re-parse this step and 2.75b's re-run
below both trigger — the sheet's own layout hasn't changed, so the same
absence is still real, and without this the exact same raise fires again
on every re-ingest, asking a question already answered.

**Re-parse every `pnl-outline` sheet after this step resolves — always,
not only when a crosstab is also in play.** 2.75b's earlier pass over an
outline sheet ran before this step ever asked its question, so it ran
with no mapping in hand — its GL codes cover only lines that already
state their own Carta account number (see above); any line resolvable
only by name is still empty. That earlier parse is provisional, not
final; the file it wrote is what `build_manco_datadir.py` actually reads,
so leaving it as-is ships without the name-matched lines regardless of
what the operator just answered here. Re-run 2.75b for
every selected `pnl-outline` sheet now, with `--dept-vocabulary-from`
pointed at a crosstab's `budget.json` when one was also selected (parse
the crosstab first in that case — it names the departments the outline's
own sub-sections resolve against), or with the mapping alone when the
workbook has no crosstab at all. Do this whether the operator just
supplied a mapping or explicitly declined one: a re-parse with `mapping=[]`
is still the authoritative, on-the-record output — better a re-parse that
confirms nothing changed than one that never ran because the ordering
never revisited it.

Persist the ref to `<dashboard_dir>/.coa-mapping-ref.json` on success.
Speak one line on first ingest: *"Ingested COA mapping from
<mapping_filename>. Future invocations will reuse it automatically."*

---

## Step 2.75c — Which reporting tag scopes the columns, and does every column match one?

A budget's columns are scoped by one of the firm's own Carta reporting-tag
categories. **Which one is a per-firm fact with no default.** One firm
breaks out by team; another uses a single category to track things like
field teams, product-specific spend and marketing. Neither is more
canonical than the other, and neither can be assumed.

Run this whenever a workbook has a column axis (`tag-crosstab`, or an
outline whose lines carry a `dept`).

**Only a reporting tag or a date range can scope a column.** Sub-accounts
and vendors break a GL account into *rows* beneath it, not columns, so
they are never candidates here — don't offer them.

**Read what the firm actually has.** After Step 4's first build the
snapshot carries `tagCategories` — every category their journal entries
use, its distinct values, and the spend behind each.

**Match on the values, not the name.** The evidence that a category is
the one a budget breaks out by is that its *values* look like the
workbook's column headings. A category named plausibly whose values are
nothing like the columns joins to nothing and reports every column as $0.

### The evidence usually answers this — check before asking

`--carta-tags-from` (2.75e) locates the mapping sheet's tag column by
matching its cells against the firm's real tag values. Those values belong
to a category, so finding the column names the category. Three cases:

| Evidence | What to do |
|---|---|
| One category's values match | Take it. Say which category and which values matched, in one line. Don't ask — the operator would be confirming something already proven. |
| Several match, or none | Ask, ranked by overlap (below). |
| Any column heading matches no real tag | Surface it before building (below). |

**When several categories match, or none do**, `rank_tag_categories`
scores the overlap; lead with its top match and say which values matched:

> **Your budget breaks out by column — which Carta reporting tag is
> that?**
> `Initiative` matches 3 of your 4 columns (Field Ops, North Region,
> Marketing Spend). Also available: `Office` (3 values, no match),
> `Team` (11 values, 1 match).

Offer each category, plus "none — the columns aren't a Carta tag".

Record the answer as `tag_category` in `coa-mapping.json`, beside the
`value_aliases` that reconcile individual value names where a workbook
heading and its Carta tag differ. Re-run Step 4.

### Columns the firm has no tag for

`unknown_tag_values` in the parsed mapping lists every column heading
that matches no tag the firm actually uses. Raise them here, while they
are still fixable. A heading that joins to nothing renders $0 — which
reads as a group that spent nothing, not as a mapping error, and the
operator has no way to tell the two apart from the report.

> **`<heading>` isn't a reporting tag you use.** Your `Initiative` values
> are `Field Ops`, `North Region`, `Growth`. Which is it?

Offer the firm's real values under the chosen category, plus "leave it
unmapped" — a column can legitimately be something Carta doesn't track,
and a recorded blank beats a wrong join. A typo or a tag renamed since the
budget was written is the common cause, and both are one answer away.

### When it is not asked

**The build matches the columns itself.** A workbook whose column headings
are one category's values has already named that category, and
`resolve_dimension` takes it — mapping sheet or no mapping sheet. It is
the same evidence the table above describes, read from the workbook
instead of from a mapping tab, so a crosstab budget usually needs no
question at all. Department is one such category and gets no special
treatment; a firm breaking out by fund, office or initiative resolves the
same way, and the report reads that firm's own word back in its heading
and its columns.

It holds back where the evidence is thin: one heading in common is a
coincidence, not a match, and two categories fitting equally well is a
question rather than an answer. Both fall through to the ask above.

A firm using exactly one category has already answered — the build takes
it, since there is nothing to choose between. A firm using several, whose
columns match none of them, and never asked leaves it unresolved: scoped
rows report firm-wide rather than inventing a dimension. Say so once,
because a column showing the firm's whole spend is not the same claim as
that column having spent it.

**No category tagged at all** → every scoped row reports firm-wide. Same
sentence, same reason.

---
