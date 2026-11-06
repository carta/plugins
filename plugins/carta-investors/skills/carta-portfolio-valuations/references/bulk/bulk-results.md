# Bulk Run Results

The end-of-run view for **every** bulk path. Both runners hand off here once
their follow-up value writes have landed:

- `references/bulk/bulk-runner.md` Step 7
- `references/md-table-runner.md` Step 9

It shows what each created valuation still needs, and how to pick any of
them up.

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

- **Financials required** → `get:financials`
- **Comparables required** → `get:comparables`

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
| **Company** | The name from the confirmed company list, i.e. what the user picked in the runner. Don't use `get:valuation`'s `corporationName`, which can differ from the dashboard's name for the same company. Backsolve rows add the note `set transaction price` (the bulk run can't set it — see `bulk-runner.md` Step 6.3). A row whose value write failed in the follow-up step adds `Value not set`. A row whose chosen allocation method the valuation doesn't support adds `Allocation not set` (`bulk-runner.md` Step 6.3 made no attempt, so its Allocation stays `-`). |
| **Company value** | `companyValue.amount`. Show `-` when it is zero or negative (see below). |
| **Holdings value** | `valueOfHoldings.amount`. Show `-` when it is zero or negative (see below). |
| **Method** | Every approach on the standard scenario with `isUsed: true`, in the API's order. Show weights only for a blend of two or more, e.g. `GPC 50% / Backsolve 50%`. A single approach is always 100%, so it shows the label alone: `GPC`, `Custom value`. Labels: `gpc` → GPC, `dcf` → DCF, `ma` → M&A, `postMoney` → Post-money, `backsolve` → Backsolve, `otherIndicationOfValue` → Custom value, `asset` → Asset, `investedCapital` → Invested capital. |
| **Required inputs missing** | The row's required inputs that aren't filled in yet, per the **filled-in** rules in `SKILL.md`. `None` when nothing is missing. |
| **Allocation** | `Run` when the standard scenario's `allocation.isCompleted` is `true`. `Failed` when an allocation attempt on this valuation failed earlier in the session, including a bulk run's allocation save or compute that failed (`❌ Allocation not saved` or `❌ Allocation not run`, `bulk-runner.md` Step 6.3). Otherwise `-`. Never infer it from the holdings value: a holding with a fixed value, such as a convertible note, gives a non-zero holdings value before any allocation has run. |

**Zero or negative company value and holdings value show `-`.** This is a deliberate
exception to SKILL.md's **Table values** rule, shared with the Step 2.5c
summary checklist and applying only to these two values. A draft
straight out of a bulk run often has a zero or debt-only negative value (e.g.
GPC with no comps yet). Printing `0` or `-100,000` there reads as a
valuation result, when it only means the value isn't set up yet. Hold the
real number in `bulk_results`; only the rendered cell changes.

**Currency.** Format both values per SKILL.md **Currency default**, using the
row's own `currencyCode`. Never total either column: rows can be in different
currencies.

**Failed rows** keep the runner's existing treatment: show the `error` text
from the bulk status, with a **Fix in Carta** link (the **Investment
overview (fix a failed valuation)** link in `references/deep-link.md`). Match
the failed row's `targetId` against the confirmed company list to pick the
`CORPORATION` or `LLC_ISSUER` form.

**An existing final valuation comes back as `created`.** When a company
already has a FINAL valuation on the run's date, "Previous period"
(`copyFromPrevious`) can return that existing candidate instead of making a
new draft. Spot it by `candidateStatus: "FINAL"`. Add the note `Already final for this
date, no new draft` to the row, and don't count it as a created draft.

Print one count line above the results:
`{N} of {M} valuations created as drafts.` Add `{K} already final.` when any
row is an existing final valuation.

---

## Step 2: Render

Render the results as a markdown table. This skill has no results widget.
The table has no link column: each valuation is on the firm's page in Carta's
valuations dashboard. A failed row keeps its **Fix in Carta** link, built per
`references/deep-link.md` Step 3, inside the error text in its **Required
inputs missing** cell.

| Company | Company value | Holdings value | Method | Required inputs missing | Allocation |
|---|---|---|---|---|---|
| MangoCart | - | - | GPC | Financials, Comparables | - |
| IMIM | 10,000 | - | Custom value | None | - |
| EdgeWave · set transaction price | - | - | Backsolve | Comparables | - |
| Meetly · already final for this date, no new draft | 100.0M | 1.6M | Custom value | None | Run |
| GammaCorp ❌ | - | - | - | {error from bulk status} · [Fix in Carta]({fix url}) | - |

Then close with the dive-in prompt:
> To work on one, type **"dive into {company}"**, e.g. "dive into Meetly".

Each create already called `refresh_page` as it returned, so the dashboard
MCP App shows the new drafts on whichever page is open. Don't move the view
(SKILL.md **Page navigation**).

---

## Step 3: Dive in

A message like "dive into {company}" or "dive into the {company} valuation
and {step}" while `bulk_results` is in context
goes to **SKILL.md Step 2.5 (dive into one)** for that company.

Take `ownerId`, `targetId`, target kind, `project_id`, `candidate_id` and
`valuation_id` straight from the matching `bulk_results` entry. **Skip Step
2.5a's `list:projects` lookup and its "which project?" question.** The bulk
run just created this exact candidate, so there is nothing to choose. Then
run the recap and the **valuation summary checklist** (SKILL.md Step 2.5c)
as normal.

**Then start on the step.** When the message carries an `and {step}` part,
treat it as the user's request and route it through SKILL.md **Step 2.5b**
in the same response, without asking what they'd like to do first. Common
steps:

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
