# Bulk Run Results

The end-of-run view for **every** bulk path. Both runners hand off here once
their follow-up value writes have landed:

- `references/bulk/bulk-runner.md` Step 7 (widget runner path)
- `references/md-table-runner.md` Step 10 (text runner path)

It shows what each created valuation still needs, and gives the user a
one-click way into any of them.

---

## Step 1: Gather per-row state (silent)

Start from the completed `get:bulk_status` response plus the confirmed company
list (which carries each company's name, `isLlc` / `llcIssuerId` /
`corporationId`, and the approach the user picked).

For each row with `status: "created"`, fire one read, **in parallel across
all rows, in one batch**. Pass the row's `projectId` / `candidateId` as
`project_id` / `candidate_id`:

```
read_tool({"name": "portfolio_valuations__get__valuation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})
```

That one response carries everything the row needs except the inputs check:

| Field | What it gives |
|---|---|
| `companyValue.amount` | Company value |
| `valueOfHoldings.amount` | Holdings value. The field is `valueOfHoldings`, not `holdingsValue`. |
| `currencyCode` | The valuation's currency |
| `candidateStatus` | `DRAFT`, or `FINAL` for an existing final valuation (see below) |
| The **standard scenario**: the `scenarios[]` entry whose `id` equals `standardScenario.id` | Each approach's `isUsed` / `weight` (`gpc`, `postMoney`, `otherIndicationOfValue`, …), and `allocation.isCompleted` |

Don't also call `get:approaches` here. The standard scenario already has the
approaches, so a second call per row would add nothing.

Once the valuations are back, work out each row's required inputs from
**Required inputs by methodology** in `SKILL.md` (End Goal). Then fetch only
what those inputs need, again in one parallel batch:

- **Financials required** →
  `read_tool({"name": "portfolio_valuations__get__financials", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`
- **Comparables required** →
  `read_tool({"name": "portfolio_valuations__get__comparables", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`

Don't fetch an input that no selected methodology requires. A Custom Value or
Post-money row needs nothing beyond `get:valuation`.

Rows with `status: "error"` get no reads. There is no valuation to read.

**Hold the result in context as `bulk_results`**: one entry per row, carrying
the company name, `ownerId`, `targetId`, target kind, `project_id`,
`candidate_id` and `valuation_id`, plus the state below. **Dive in** (Step 3)
and **back to the list** (Step 4) both read from it.

### Row values

| Column | Source |
|---|---|
| **Company** | The name from the confirmed company list, i.e. what the user picked in the runner. Don't use `get:valuation`'s `corporationName`, which can differ from the dashboard's name for the same company. In the markdown form, Backsolve rows add the note `set transaction price` (the bulk run can't set it — see `bulk-runner.md` Step 6.3). A row whose value write failed in the follow-up step adds `Value not set`. |
| **Company value** | `companyValue.amount`. Show `-` when it is zero or negative (see below). |
| **Holdings value** | `valueOfHoldings.amount`. Show `-` when it is zero or negative (see below). |
| **Method** | Every approach on the standard scenario with `isUsed: true`, in the API's order. Show weights only for a blend of two or more, e.g. `GPC 50% / Backsolve 50%`. A single approach is always 100%, so it shows the label alone: `GPC`, `Custom value`. Labels: `gpc` → GPC, `dcf` → DCF, `ma` → M&A, `postMoney` → Post-money, `backsolve` → Backsolve, `otherIndicationOfValue` → Custom value, `asset` → Asset, `investedCapital` → Invested capital. |
| **Required inputs missing** | The row's required inputs that aren't filled in yet, per the **filled-in** rules in `SKILL.md`. `None` when nothing is missing. |
| **Allocation** (markdown only) | `Run` when the standard scenario's `allocation.isCompleted` is `true`. `Failed` when an allocation attempt on this valuation failed earlier in the session. Otherwise `-`. Never infer it from the holdings value: a holding with a fixed value, such as a convertible note, gives a non-zero holdings value before any allocation has run. |
| **Link to Carta** | Pattern B from `references/deep-link.md`, `value-company` tab, using the row's `valuation_id`. Fall back to Pattern A (`project_id`) when `valuation_id` is missing. Bulk-created rows are `CORPORATION` targets, so use that form. The widget makes the company name and an external-link icon one link, with a **View in Carta** tooltip on hover; the markdown table keeps it as a column. |
| **Next step** (widget only) | Worked out by the template from the other values, first match wins: missing inputs → `Add {inputs}`; company value zero or negative → the method's value step (`Set custom value`, `Set post-money value`, `Set transaction price` for Backsolve, `Calculate {method}` otherwise, `Calculate values` for a blend); allocation failed → `Retry allocation`; not run → `Run allocation`; otherwise `Review & finalize`. An existing final row shows `View`. Nothing to add to the payload. |

**Zero or negative company value and holdings value show `-`.** This is a deliberate
exception to SKILL.md's **Table values** rule, shared with the Step 2.5c
summary checklist and applying only to these two values. A draft
straight out of a bulk run often has a zero or debt-only negative value (e.g.
GPC with no comps yet). Printing `$0` or `-$100,000` there reads as a
valuation result, when it only means the value isn't set up yet. Hold the
real number in `bulk_results`; only the rendered cell changes.

**Currency.** Format Company value and Holdings value in the row's own currency, from
`get:valuation` → `currencyCode`. Never assume USD or
default to `$`. When no currency code comes back, show the bare number with
no symbol. Never total the Company value or Holdings value columns: rows can be in
different currencies.

**Failed rows** keep the runner's existing treatment: show the `error` text
from the bulk status, with a **Fix in Carta** link (the **Investment
overview (fix a failed valuation)** link in `references/deep-link.md`). Match
the failed row's `targetId` against the confirmed company list to pick the
`CORPORATION` or `LLC_ISSUER` form.

**An existing final valuation comes back as `created`.** When a company
already has a FINAL valuation on the run's date, "Previous period"
(`copyFromPrevious`) can return that existing candidate instead of making a
new draft. Spot it by `candidateStatus: "FINAL"`. Render the row with
`status: "existing_final"` (the markdown form adds the note `Already final
for this date, no new draft`), and don't count it as a created draft.

In the markdown form, print one count line above the results (the widget
shows none):
`{N} of {M} valuations created as drafts.` Add `{K} already final.` when any
row is an existing final valuation.

---

## Step 2: Render

### Widget

Use the widget when a widget surface exists: `env_mode: "artifact"` or
`env_mode: "preview-server"`. The exception is a user who
chose the text runner (**Inline view**, `md-table-runner.md`) for this run.
They get the markdown form below, the same way they picked their runner.

Build the payload: one object per row, in the confirmed order.

```json
{"rows":[
  {"name":"MangoCart","status":"created","ev":-100000,"holdings":0,"currency":"USD",
   "methodology":[{"label":"GPC","weight":1}],
   "missing":["Financials","Comparables"],"allocate":"not_run",
   "url":"<Pattern B deep link>"},
  {"name":"IMIM","status":"created","ev":10000,"holdings":0,"currency":"USD",
   "methodology":[{"label":"Custom value","weight":1}],
   "missing":[],"allocate":"not_run","url":"<Pattern B deep link>"},
  {"name":"Meetly","status":"existing_final","ev":100000000,"holdings":1583683.08,
   "currency":"USD","methodology":[{"label":"Custom value","weight":1}],
   "missing":[],"allocate":"run","url":"<Pattern B deep link>"},
  {"name":"EdgeWave","status":"created","ev":0,"holdings":0,"currency":"EUR",
   "methodology":[{"label":"Backsolve","weight":1}],
   "missing":["Comparables"],"allocate":"not_run","url":"<Pattern B deep link>"},
  {"name":"GammaCorp","status":"error",
   "error":"<error text from bulk status>","fixUrl":"<fix link>"}
]}
```

- `ev` / `holdings` are raw numbers, not formatted strings. The template
  formats them with the row's `currency`, and renders zero or negative as `-`.
- `status` is `created`, `existing_final` or `error`.
- Leave `currency` out when the API returned none. Never fill in `"USD"` as a
  default.
- `weight` is the 0–1 value from the standard scenario.
- `allocate` is `not_run`, `run` or `failed`. The widget has no Allocation
  column; it only uses this to pick the **Next step** (`Run allocation` /
  `Retry allocation`).
- No `note` field: the widget shows no text under the company name.
- `missing` uses the labels `Financials` and `Comparables`, listed once each.
- Never put internal IDs in the payload. The template only renders what is
  listed above.

Build and show it:

```bash
mkdir -p .claude/preview
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/build_artifact.py" \
  --template cowork-bulk-results --pre-classified \
  < <(printf '%s' '{"rows":[…]}') \
  > .claude/preview/bulk-results-artifact.html
```

If `mcp__visualize__read_me` output isn't in context yet this session, call
it first. Then `Read` `.claude/preview/bulk-results-artifact.html` and pass
the full contents verbatim to `mcp__visualize__show_widget`:

```
title:            "portfolio_valuations_bulk_results"
widget_code:      <full contents of bulk-results-artifact.html>
loading_messages: ["Tallying the results…", "Checking what's missing…"]
```

Every row shows a **Next step** button named after what that valuation
needs next (see **Row values**). Clicking the button fills the chat composer with
`Dive into the {company} valuation and {step}`, e.g. `Dive into the Lumen
Health Ltd valuation and retry the allocation`. An existing final row sends
`Dive into the {company} valuation` alone. The composer is only filled, never
sent, so the button then reads **Added to chat · press Enter ↵** for a few
seconds. `sendPrompt` can silently do nothing on some hosts, so the widget
always shows a copy-to-chat box as well.

Only two things in a row are clickable: the company name and its icon
open the valuation in Carta, and the **Next step** button fills the chat.
Clicking anywhere else in the row does nothing.

The company-name **Link to Carta** and **Fix in Carta** open through the host's `openLink()`,
falling back to `window.open`. A plain `target="_blank"` link, or one inside
an element that stops click propagation, does nothing in the widget
sandbox. Either way the page opens in the user's default browser, not the
Claude Code in-app browser: widget code can't reach that browser. Keep this
handling if you edit the template.

Tell the user:
> ✅ Here are your results. Each company shows its next step: click one to
> pick it up, then press **Enter**. If the chat box doesn't fill in, copy the
> prompt from the box under the table.

### Markdown fallback

Use this when no widget surface exists (`env_mode: "inline"`), or when the user chose the text runner. The
columns are the same, minus the widget's **Next step** button, and
**Link to Carta** stays a column. Build the link cell per `references/deep-link.md`
Step 5: a markdown link labeled **Open in Carta**, or **Fix in Carta** on a failed row.

| Company | Company value | Holdings value | Method | Required inputs missing | Allocation | Link to Carta |
|---|---|---|---|---|---|---|
| MangoCart | - | - | GPC | Financials, Comparables | - | [Open in Carta]({url}) |
| IMIM | $10,000 | - | Custom value | None | - | [Open in Carta]({url}) |
| EdgeWave · set transaction price | - | - | Backsolve | Comparables | - | [Open in Carta]({url}) |
| Meetly · already final for this date, no new draft | $100.0M | $1.6M | Custom value | None | Run | [Open in Carta]({url}) |
| GammaCorp ❌ | - | - | - | {error from bulk status} | - | [Fix in Carta]({fix url}) |

The symbols above are only examples. Each row uses its own currency. Company value and
Holdings value show `-` when zero or negative, as in the widget.

Then close with:
> To work on one, type **"dive into {company}"**, e.g. "dive into Meetly".

---

## Step 3: Dive in

A message like "Dive into the {company} valuation and {step}" (from the
widget) or "dive into {company}" (typed) while `bulk_results` is in context
goes to **SKILL.md Step 2.5 (dive into one)** for that company.

Take `ownerId`, `targetId`, target kind, `project_id`, `candidate_id` and
`valuation_id` straight from the matching `bulk_results` entry. **Skip Step
2.5a's `list:projects` lookup and its "which project?" question.** The bulk
run just created this exact candidate, so there is nothing to choose. Then
run the recap and the **valuation summary checklist** (SKILL.md Step 2.5c)
as normal.

**Then start on the step.** When the message carries an `and {step}` part,
treat it as the user's request and route it through SKILL.md **Step 2.5b**
in the same response, without asking what they'd like to do first. The
widget only ever sends these steps:

| Step in the prompt | Flow |
|---|---|
| `add financials` | `references/dive-in/financials-review.md` |
| `add comparables` | `references/dive-in/comps.md` |
| `add financials and comparables` | Financials first, then comparables, one at a time |
| `calculate GPC` | `references/dive-in/gpc-analysis.md` |
| `calculate {other method}`, `calculate the values`, `set the custom value`, `set the post-money value` | `references/dive-in/set-approaches.md` |
| `set the transaction price` | `references/dive-in/backsolve/backsolve.md` |
| `run the allocation`, `retry the allocation` | `references/dive-in/allocation.md` |
| `review it before finalizing` | `references/dive-in/ship.md`. Walk through the review; finalize only when the user confirms. |

The step is a starting point, not a script. If the refreshed state shows it
is already done (the user fixed it in Carta meanwhile), say so and suggest
the next unchecked checklist item instead.

A name that matches a **failed** row has no valuation to enter. Say so
plainly and point at that row's **Fix in Carta** link.

---

## Step 4: Back to the list

When the user leaves a valuation they entered from these results ("back to
the list", "back to the results", "show the list again"), re-run **Step 1**
for every row in `bulk_results`. Re-fetch it, because the user has probably
changed things. Then render **Step 2** again in the same form as before, and
update `bulk_results` with the fresh state.
