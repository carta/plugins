# Create a document type of the firm's own

Carta ships eight document types — Articles of Incorporation, Captable, Balance Sheet, Profit &
Loss, Cash Flow Statement, Forecasts, Board Deck / Investor Update, KPI. A firm that asks its
companies for something else — an insurance certificate, a policy, a rent roll — defines its own,
which then sits alongside the eight.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

**This collects nothing.** No company is asked for anything and no request changes. The type becomes
available to add to a company's requirements.

## Two ways it reaches a company

Creating the type only defines it. Asking a company for it is a separate step, and there are two:

| Route | Do this | Use when |
|---|---|---|
| This send only | `requested_documents` on `references/send-request.md`, with `use_company_config_template: false` | The user wants it for this period, not every period |
| Every future send | `requested_documents` on `references/data-requirements.md` | It becomes part of what the company is always asked for |

The second is then picked up by any send that uses the company's saved configuration
(`use_company_config_template: true`).

**Which one the user means is worth asking**, because "ask Meetly for an insurance certificate"
reads as either. A one-off is the safer default: adding it to the standing requirements changes
every future period, and the user may not have meant that.

## Step 1 — Read what the firm already has

```
read_tool({"name": "data_collection__list__document_types",
           "arguments": {"organization_pk": "<org_pk>"}})
```

**A duplicate name is rejected.** Unlike a metric, where two may share a label, carta-web answers
400 if one of the firm's active types already uses the name. Search the list for what the user asked
for and near misses, and offer the existing one:

> You already have **Insurance Certificate**. Use that, or create a separate one with a different
> name?

Only active types come back, so anything in the list can be asked for. A type someone deleted is
absent rather than flagged.

## Step 2 — Settle the name and description

`name` is what the firm and its portfolio companies read. Write it as a label — "Insurance
Certificate", not "ins_cert". Up to 255 characters, and it cannot be blank.

`description` is optional and says what the company should upload. Worth having whenever the name
alone leaves room for doubt: "Insurance Certificate" does not say whose, or for what period.

## Step 3 — Confirm

```
| | Value |
|:---|:---|
| Name | Insurance Certificate |
| Description | Current general liability certificate, naming the fund as additional insured |
```

Then say, in one sentence, that this adds a document type the firm can ask for and asks nobody for
anything yet.

Ask the confirmation question, end your reply, and wait. Never write in the same reply as the
question.

## Step 4 — Create it

```
call_tool({"name": "data_collection__create__document_type",
           "arguments": {"organization_pk": "<org_pk>", "name": "<label>",
                         "description": "<optional>"}})
```

One type per call. Creating three is three calls — say how many before starting, and report which
were created if one fails.

The response carries the **id** the type was given. That id is what `requested_documents` and
`required_documents` take, so keep it for the call that asks for the document; never show it to the
user.

Then offer the step that makes it do something, naming both routes:

> **Insurance Certificate** is ready. Ask for it on this period's request, or add it to what
> Meetly is always asked for?

The first is `references/send-request.md`, the second `references/data-requirements.md`.

## Ids and codes are not interchangeable

Both the send and the requirements write take the two kinds side by side, and they are different
shapes:

| Field | Takes |
|---|---|
| `requested_files`, `required_files` | Carta's string codes — `BS`, `CAP`, `DECK` |
| `requested_documents`, `required_documents` | Integer ids of the firm's own types — `3`, `9` |

Sending a code where an id belongs, or the reverse, is a 400. An id from another firm, or one that
was deleted, is rejected too.
