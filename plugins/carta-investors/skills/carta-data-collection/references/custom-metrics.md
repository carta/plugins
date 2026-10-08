# Create a metric of the firm's own

A firm can ask its companies for something Carta does not ship — a metric it defines itself, which
then sits in its vocabulary alongside the standard ones and can be requested like any other.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

**This collects nothing.** No company is emailed and no request changes. The new metric is
available to the next request that asks for it, and every request already sent stays as it was.

## Step 1 — Read the vocabulary first

```
read_tool({"name": "data_collection__list__metrics",
           "arguments": {"organization_pk": "<org_pk>"}})
```

**Nothing stops two metrics sharing a label.** A firm asking for "Monthly Active Users" when it or
Carta already has one wants that one, not a second with the same name — and once created, a
duplicate is confusing rather than harmful, so the check is cheap and the cleanup is not.

Search the names for what the user asked for, and for near misses. If one exists, say so and offer
it instead:

> You already collect **Monthly Active Users**. Use that, or create a second one with a different
> name?

`owner_id` says whose it is: 0 is Carta's, anything else is the firm's. A match on either counts.

## Step 2 — Settle the three fields

`name` is what the firm and its portfolio companies read. Write it as a label — "Monthly Active
Users", not "mau" or "MAU_COUNT". Ask if the user gave something that reads like a code.

`unit_type` is what the number is:

| Value | For |
|---|---|
| `Number` | A plain count — headcount, users |
| `Dollar` | An amount of money |
| `Percentage` | A rate out of 100 |
| `Ratio` | One number over another |
| `Text` | Free text rather than a number |
| `Date` | A date |
| `Boolean` | Yes or no |

`aggregation_type` is how the metric adds up across a period:

| Value | Means |
|---|---|
| `last` | The value at the end of the period |
| `first` | The value at the start |
| `sum` | The total across it |
| `mean` | The average |
| `standard deviation` | The spread |

**Ask which aggregation the user wants; do not default to `last`.** A headcount is usually the
value at the end, revenue is usually a sum, and getting it wrong makes every future roll-up wrong
in a way nobody notices until they read a total.

`description` is optional and worth having when the name alone leaves room for doubt — say whether
users are counted monthly or daily, for instance.

### The spellings are exact, and a wrong one is silent

Send a value exactly as written above. Aggregations are lower case, units are capitalised.

Carta does **not** validate these. An unrecognised value is stored as unspecified rather than
rejected, so a metric created with `average` instead of `mean`, or `number` instead of `Number`,
saves with no aggregation or no unit. It looks correct in a list and goes wrong later, when someone
collects against it. Never pass through a value the user typed without matching it to the table
first.

## Step 3 — Confirm

Show what will be created, then ask:

```
| | Value |
|:---|:---|
| Name | Monthly Active Users |
| Unit | Number |
| Adds up as | The value at the end of the period |
| Description | Users active in the last 30 days |
```

Say the aggregation in words rather than as the code — "the value at the end of the period", not
`last`. The code goes on the wire; the sentence is what the user can check.

Ask the confirmation question, end your reply, and wait. Never write in the same reply as the
question.

## Step 4 — Create it

```
call_tool({"name": "data_collection__create__metric",
           "arguments": {"organization_pk": "<org_pk>", "name": "<label>",
                         "unit_type": "<unit>", "aggregation_type": "<aggregation>",
                         "description": "<optional>"}})
```

One metric per call. Creating three is three calls — say how many before starting, and report which
were created if one fails.

The response is the metric, including the `mnemonic` Carta assigned it. **Report the name, keep the
mnemonic.** That mnemonic is what `requested_metrics.type` takes on a send, so hold it if the user
is about to ask for this metric in a request; never show it unless they ask for the raw code.

Then say what is now possible, because creating a metric is rarely the goal:

> **Monthly Active Users** is ready to collect. Add it to a request, or to what a company is always
> asked for?

The first goes to `references/send-request.md`, the second to `references/data-requirements.md`.
