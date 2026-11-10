# Check submitted numbers against the previous period

Whether the numbers companies submitted for a quarter look right — "does anything look wrong",
"check the numbers", "anything odd in Meetly's Q3". This compares each submitted KPI with the
same KPI from the previous period and flags the changes worth a second look. It reads only.

Not to be confused with `references/submissions.md`, which answers *what* each company sent and
what is missing — not whether the values make sense.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

## Step 1 — Work out the quarter and the company

The comparison takes a quarter as `period_id`: `2026-Q3`. Take it from the user's words, anchored
to the calendar year as `references/send-request.md` Step 1 does. "Last quarter" is a quarter you
work out, not a question.

For one company, take its `entity_type` and `entity_id` from the roster
(`data_collection__list__companies`), matched by name. Without a company, the comparison covers
the whole portfolio.

## Step 2 — Compare

```
read_tool({"name": "data_collection__list__period_comparison",
           "arguments": {"organization_pk": "<org_pk>", "period_id": "2026-Q3"}})
```

For one company, add `"entity_type": "<entity_type>", "entity_id": "<entity_id>"` — both or
neither.

**If the command is missing, or answers 404**, Step 2 found the comparison unavailable: it is not
available in the chat yet — but the companion page reads Carta directly, not through the MCP, so
its Review tab can still show it. Say *"The period comparison isn't available in the chat yet, so I
can't check the numbers here."*, then go to Step 4, and carry on with whatever else the user asked.
Never say the numbers look fine or that nothing is wrong: the chat checked nothing. Do not work the
comparison out yourself from other reads.

## What comes back

| Field | Holds |
|---|---|
| `period`, `previous_period` | The two periods compared |
| `results` | One row per compared KPI: `company_name`, `metric_name`, `previous_value`, `current_value`, `change_ratio`, `rule` |
| `not_compared` | The companies that could not be compared, and why |

**Without a company, `results` holds only the anomalies.** An empty `results` means no KPI tripped
a rule — say that, for the companies that were compared. **With a company, `results` holds every
compared KPI of it**, and only the rows with a `rule` are anomalies.

What each `rule` means, in the words to use:

| `rule` | Say |
|---|---|
| `previous_zero` | Was zero last period, so the change has no percentage |
| `scale_mismatch` | Off by orders of magnitude — often thousands entered as units, or the reverse |
| `sign_flip` | Changed sign — positive last period, negative now, or the reverse |
| `change_over_threshold` | Moved by more than the usual threshold |

## Step 3 — Summarize

Lead with one sentence: how many companies were compared and how many anomalies came up. Then the
anomalies in a table, grouped by company:

```
| Company | Metric | Q2 2026 | Q3 2026 | Why it stands out |
|:---|:---|---:|---:|:---|
| Meetly | Cash and Cash Equivalents | 1,200,000 | 1,200 | Off by orders of magnitude — check the units |
```

Name the periods from `previous_period` and `period` in the column headers. Write the values as
they came back, with the units the metric carries; the comparison returns no currency, so do not
add a currency symbol. Write `change_ratio` as a percentage only where it helps the sentence.

**Say which companies were not compared, and why**, from `not_compared`, in a sentence or a short
list below the table. A company that was not compared is not a company that looks fine — never let
the summary read as though the whole portfolio passed.

Stop at describing. Whether a value is wrong is the firm's call; if the user wants the company to
correct it, that is `references/reopen-request.md`.

## Step 4 — Open the companion

Open the companion on the Review tab for the quarter, per `references/companion.md` — with
`entity_type` and `entity_id` when the comparison was for one company. Do this whether Step 2
returned a comparison or found it unavailable.
