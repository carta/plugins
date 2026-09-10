# Building, serving, and updating the dashboard

Steps 4 through 6 in full: assembling the datadir, reusing or
launching the server, and the post-launch offer to change things.


> Steps referenced here that are documented elsewhere: **Step 2.75** → [budget-ingest.md](budget-ingest.md); **Step 3** → [data-fetch.md](data-fetch.md).

## How the app is served — no build step for app edits

**Editing `app/src/**.jsx` and refreshing the page is the whole loop.** Do
not run a build after changing app source; there is nothing to rebuild.

`serve.py` serves two trees:

- `--web-dir` → `webapp/` — the shell: `index.html`, `sw.js`, the vendored
  runtime under `vendor/`, and `fonts/`.
- `--src-dir` → `app/src` — the canonical source, served verbatim at
  `/src/*`.

`webapp/sw.js` is a module service worker that intercepts every same-origin
`.jsx` request and transpiles it with Sucrase in the browser, caching on a
hash of the file's own bytes. `webapp/index.html` carries an importmap
pointing React and lucide-react at the bundles in `vendor/`, and waits
for the service worker to control the page before importing
`/src/main.jsx`. Charts are inline SVG (`ui/components.jsx`'s
`InkLineChart`/`InkBarChart`) — no charting library to vendor.

**`npm run build` (in `app/`) rebuilds only the vendored runtime** —
`webapp/vendor/{react,sucrase,lucide-react}.esm.js` via `app/build.mjs`. Run it
when bumping one of those packages, and essentially never otherwise.
Those bundles are committed, so a user's machine never builds anything.

The tradeoff is deliberate: in-browser transpilation costs a little
load-time performance, in exchange for a source edit never being able to
render stale. That is the right trade for a tool iterated on interactively
that only ever loads from localhost.

If `serve.py` logs `(vendor missing — run npm run build in app/)`, the
runtime bundles are absent — that is the one case where a build is
genuinely required.

## Step 4 — Assemble the datadir

**SILENT** — no user-facing output in this step. Next allowed output: Step 5's URL.

Runs on every invocation, including a warm-cache one that skipped Step 3.
It reads `raw/` and takes seconds, and it is where the budget state
resolved in Step 2.75 is actually applied — skipping it would serve a
snapshot built under whatever the answer used to be.

**`<AS_OF>` on the cache-hit path (Step 3 skipped) is `raw_as_of` from Step
2.5's `manco_paths.py resolve` output — not today's date.** The raw journal
entries under `raw/` are however old `raw_age_days` says they are — Step
2.5 now skips Step 3 on any warm cache regardless of age, so that can be
days, not just hours. Stamping the snapshot with today's date would make
the dashboard claim data through today while `raw/` is actually that much
older. When Step 3 *did* run this invocation, `<AS_OF>` is the value it
just computed and wrote to `.fetched-at` — the two paths agree by
construction.

Run the build script:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/build_manco_datadir.py" \
  --firm-name "<FIRM_NAME>" --firm-uuid "<FIRM_UUID>" --firm-carta-id <FIRM_CARTA_ID> \
  --manco-name "<MANCO_NAME>" --manco-uuid "<MANCO_UUID>" --manco-carta-id <MANCO_CARTA_ID> \
  --manco-entity-id <MANCO_ENTITY_ID> \
  --raw-dir "<raw_dir>" --dashboard-dir "<dashboard_dir>" \
  --as-of "<AS_OF>" --carta-environment "<CARTA_ENVIRONMENT>"
```

`<CARTA_ENVIRONMENT>` is `"production"` or `"nonprod"`, classified in Step 1
(from `<SERVER>`'s name) or carried from Step 0.2's cache probe on a WARM
HIT — see [firm-lookup.md](firm-lookup.md) and [firm-resolution.md](firm-resolution.md). Served to the
dashboard's Snowplow tracker via `/api/telemetry-context` so nonprod usage
isn't misattributed as production.

If the script exits non-zero, read its stderr, surface the first line to the user in plain English, and stop.


## Step 5 — Launch the dashboard

**First check that Step 4.7 is done** ([budget-unresolved.md](budget-unresolved.md)).
A build that left budget lines with
no Carta account has a question to ask before this page is worth showing —
those lines render a budget against an empty actual, which reads as spend
that never happened. Ask, record, rebuild, and come back here. Every other
question in this skill waits until the URL is out; that one cannot.

Two things happen here, in order: **reuse-or-launch**, then **emit the
URL**. Then go to Step 6 — the URL is not the end of the run.

### 5a — Reuse if it's already up

**Check this before anything else. Never compute a port first.** Read
`<dashboard_dir>/.port` and `<dashboard_dir>/.token`, and if the port has
a listener, confirm it is this firm's server rather than someone else's
process on the same port:

```bash
curl -sf -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:<port>/api/snapshot?t=<token>"
```

A `200` means our server, for this data dir, still serving. **Reuse it** —
skip the launch, emit that same URL, and go to Step 6.

This matters more than it looks. Treating an occupied port as "find
another one" hands out a new URL on every invocation — 8787, then 8788,
then 8789 — so a firm's dashboard has no stable address, older tabs go
quietly stale while still rendering, and "refresh the page" in Step 6
becomes ambiguous about which page. Reopening a dashboard should return
the dashboard, at the address it already had.

`serve.py` shuts itself down after a period without requests, so a stale
`.port` with nothing listening is normal and simply means launch again.

### 5b — Otherwise launch, letting the server restore its own address

`serve.py` already remembers a firm's port and token in `.port` / `.token`
and reuses them on relaunch — but an explicit `--port` or `PORT` env
overrides that. So do **not** pass one when `.port` exists. Computing a
port and forcing it is what made a firm's URL drift across invocations;
the stable-URL behaviour was there all along and the skill was overriding
it.

```bash
LOG="<dashboard_dir>/serve.log"
nohup python3 "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/serve.py" \
  --data-dir "<dashboard_dir>" > "$LOG" 2>&1 &
```

**Only when the session already carries `pk`** from `get_current_user` (a connected Carta
MCP has it from bootstrap), append `--user-id <pk>` so telemetry names a real user. Never
call the MCP just to get it — firm-resolution.md's Step 0 says not to call
`mcp__<SERVER>__welcome` at all, and this launch stays on that same MCP-free footing when
`pk` isn't already in hand. Never substitute the email or a placeholder.

Pass `PORT=8787` **only** when the firm has no `.port` yet — a first-ever
launch. If 8787 is taken, try up to 8797; if all ten are busy, say which
processes hold them and stop.

When a recorded port is held by some unrelated process, `serve.py` binds
elsewhere and deliberately leaves `.port` untouched, so the firm's address
returns as soon as that port frees up.

**Read the URL from the log rather than composing it.** After ~1 second,
take the `[serve] manco-reporting at <url>` line from `serve.log`. It
carries the port actually bound and the token actually in use, which is
the only pair guaranteed to be right — composing one from what we intended
is how a user ends up with a URL that 403s or points at a dead port.

Emit exactly one URL for the user:

```
Dashboard: http://127.0.0.1:<port>/?t=<token>
```

Then one orientation line, e.g. *"`<FIRM_NAME>` — `<MANCO_NAME>` · through `<AS_OF>`. Click any chart bar or category row to drill into journal entries."*

Do not describe the UI, list charts, or narrate features — the dashboard
speaks for itself.

### 5c — Where the report and their workbook differ

One more line, and only when Step 4's build printed a `gaps:` line to
stderr. Say what it says, in plain English, on a single line:

> Budget vs Actuals: 10 budget lines need a mapping decision · 9 are
> budget-only by choice · 1 total was summed from the lines above it.

This is not narration of the UI — it is the one thing the report cannot
say for itself. Each of these states is a quiet marker on a row the reader
has to hover to find, and one of them (a widened total) states a figure
differently from the client's own workbook. Someone who came for their
budget compared against Carta should know the shape of the gap before
they start reading, not discover it a row at a time.

Silent when the build printed no `gaps:` line — a report with nothing to
disclose says nothing. Never list which lines; the counts orient, and
Step 6 is where the unresolved ones get resolved.


## Step 5.5 — Offer to open the account rows up

**The workbook is the anchor.** A budget already broken out one way is
asking that question, and Budget vs Actuals opens its rows that way with
nothing asked: lines carrying reporting-tag values open by that tag, and a
line rolling several Carta GL accounts into one of the firm's own
categories opens by account, saying which accounts make it up. This holds
on both workbook-fed reports — the line-item outline and the per-account
table — so a firm that uploads their own budget gets it without answering
anything. Deeper detail the firm never put in their budget is a different
thing — worth offering, not worth assuming.

**Only ask when the budget offers no breakout of its own**, which is a
sheet mapping one line to one Carta account. Then the rows have nothing to
open, and Carta still holds the detail. `accountsData.rowDimensions`
censuses what the firm's entries actually support, with the spend behind
each.

**Ask after the dashboard is up, never before.** The report is what the
operator came for; a question standing between them and it costs the time
the dashboard was meant to save. They can see the rows first and answer
knowing what they'd be opening.

> **Want to open the account rows up?** You keep `<what they have —
> sub-accounts, `<tag category>`, vendors>` in Carta, so each row in Budget
> vs Actuals can expand to show it. Your budget doesn't break down this
> far, so nothing is expanded today.

Offer each source the census found, plus "No — keep it at account level".
Record the answer as `row_dimension` in `coa-mapping.json` and don't ask
again for this firm; a decline is an answer too. It sets which breakout
opens first, not the only one available — the report offers every censused
source in a picker regardless, so the reader can switch without a rebuild
and this stays a starting point rather than a lock.

**Nothing populated → no offer.** A source the firm never fills would open
a row onto nothing, which reads as an account with no detail rather than a
field they don't keep.


## Step 5.6 — Values no budget line accounts for

A workbook that gives one of the firm's own values its own section reports
that spend there, so the untagged lines over the same accounts report the
rest. **Which dimension names those sections is the firm's choice** — a
reporting tag, a sub-account, a vendor — so all three are matched, and the
firm's own values are the only evidence used.

A section is claimed only on an exact label, or a label containing every
word of one value. Anything short of that is left alone, because a wrong
claim moves real money to the wrong line. A name two dimensions share is
claimed by neither.

A GL account is never claimable: every entry carries one, so a line named
after an account would claim spend the whole budget shares.

A claim is subtracted from a line only where that value actually posts to
the line's own accounts. An income line shares no accounts with an expense
section and has none of its spend to give back.

`accountsData.unclaimedValues` lists the values with real spend that no
line claimed, largest first — **only within a dimension the budget already
uses**. Every vendor a firm pays is unclaimed on a budget that never names
one, and asking about all of them buries the few that are real questions.
Ask, listing what each is worth:

> **You track spend that no budget line accounts for.** `<value>`
> (`<expense>` YTD) is counted inside `<the untagged lines>`. Which line
> reports it — or is it part of those?

**Quote the expense figure, not the total.** A value can sit on both sides
of the P&L — one firm tags a sponsored event's costs and its sponsorship
income alike — and the combined figure reads as spend at nearly twice the
size, which is the number the operator will check against their statement
of operations and find wrong.

Offer the budget's own lines, plus "leave it where it is". Record the
answer as `{"scope": {"source": "...", "category": "...", "value": "..."}}`
against that row's `addr` in `budget-mapping.json`, then re-run Step 4.

**Use `addr`, not the row's position or label alone.** The rows a client
picks here are usually the subtotals a workbook builds its own sections
from, and those carry no key — `addr` falls back to the row's
section/subsection/label path, and a repeated heading gets its own. The next build applies it before
claiming, so the answer behaves exactly like a label that had matched, and
the firm is never asked again.

**A claimed line still needs its own GL accounts to report actuals.** The
answer moves the spend out of the untagged lines; it does not tell the
report which accounts the claiming line covers. Where that line has no GL
codes, Step 4.7 is the gate that asks — until then the value shows only as
the amount that left, which is honest but is not yet the line reporting
it.

**Never guess the near-misses.** A label one word from a tag value is the
case most likely to be wrong and least likely to be noticed.

**Say what a claim does.** Claiming a value moves it out of every untagged
line sharing those accounts — the report shows the amount that moved on
its own row, so a wrong answer is visible rather than buried in a total.


## Step 6 — Offer to update it

**Run this whenever the invocation did not ask the Step 2.75 questions** —
which is every re-invocation of a firm that already has a workbook ref, or
a recorded budget answer. That is the common case, and it is the case that
kept getting skipped.

**Skip it only when the operator answered a Step 2.75 prompt during this
run** — an explicit `--budget-workbook` arg counts as an answer. They have
already said what they wanted; asking again reads as not having listened.

**On a re-invocation** — the dashboard came back from persisted refs
without asking anything — the URL goes out first, then the offer. Someone
re-opening a dashboard they built last week usually wants to look at it,
and only sometimes wants to update it. Making them answer questions before
they can see it inverts that.

After the orientation line, ask a single `AskUserQuestion`:

> **Anything to update?** The dashboard is live at the link above.

- **Nothing — just looking** ← put first; it is the common case
- **Refresh the Carta data** → re-run Step 3, then Step 4
- **Point at a different or updated Excel budget** → re-run Step 2.75a-ii
  onward with the new path, replacing the workbook ref
- **Change which tabs feed Budget vs Actuals** → re-run Step 2.75a-ii
  against the workbook already on file, so the operator can add or drop
  sheets without re-supplying it
- **Resolve the lines that found no actuals** → the fallback for lines
  left unanswered at Step 4.7, or ones a later re-parse introduced. Offer
  it whenever the build printed a mapping-decision count, and lead with
  the one table Step 4.7 describes rather than a question per line

Anything else the operator types goes through `AskUserQuestion`'s free-text
option — treat it as a request and route it to the matching step.

**After any change, rebuild (Step 4) and tell them to reload the page —
do not relaunch the server.** `serve.py` reads the data files per request
and sends `Cache-Control: no-store`, and the port and token persist in the
data dir, so the URL already in their browser picks up the rebuild on a
refresh. Restarting would hand them a second URL for the same dashboard
and leave an orphaned process on the old port.

Say one line: *"Rebuilt — refresh the page to see it."* Then offer the
same question again, so several changes can be made in one sitting, until
the operator picks "Nothing".
