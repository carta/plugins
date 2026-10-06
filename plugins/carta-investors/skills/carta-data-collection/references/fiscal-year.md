# Fiscal year

Which month a company's financial year starts in. It decides what every reporting period *means*
for that company: one whose year starts in April reports a different Q1 from one whose year starts
in January.

The firm is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

**The `get` and `set` fiscal-year commands are in the financials API and use a different
permission from the rest of data collection.** A firm that can send requests may still get a
permission error there. Treat that as "this is not available to you", not as a company without a
fiscal year, and do not retry. The roster read below has no such catch.

**The parameter is `entity_pk`, not `entity_id`.** Every other data collection command takes
`entity_id`. The value is the same one from `data_collection__list__companies`; only the name
differs.

## Reading it

The company roster already carries it, so a read costs no extra call and no extra permission:

```
call_tool({"name": "data_collection__list__companies",
           "arguments": {"organization_pk": "<org_pk>"}})
```

Each row carries `fiscal_year_start_month` and `fiscal_year_start_month_name` **only when the
company is not on the calendar year** — an absent pair means a January start. So "do all our
companies report on the same year?" is answered by scanning the roster for rows that carry the
field, and "which ones differ?" is those rows by name.

For one company, the financials-API read also works (subject to the permission note above):

```
call_tool({"name": "data_collection__get__fiscal_year",
           "arguments": {"organization_pk": "<org_pk>", "entity_type": "<type>",
                         "entity_pk": "<id>"}})
```

Say the month by name — "April", never "4". The formatter returns both.

**Read this when a period label looks wrong to the user.** A firm asking why Q1 covers the wrong
months is asking about the fiscal year, whether or not they say so.

## Changing it

```
call_tool({"name": "data_collection__set__fiscal_year",
           "arguments": {"organization_pk": "<org_pk>", "entity_type": "<type>",
                         "entity_pk": "<id>", "fiscal_year_start_month": <1-12>}})
```

`fiscal_year_start_month` is 1 to 12, where 1 is January. One company per call — there is no bulk
form, so changing several is one call each. Say how many that will be before starting, and report
which succeeded if one fails.

**Set it before collecting from a company whose year is not the calendar year.** Changing it later
does not rewrite the periods already collected — it changes what their labels mean, so a request
labelled Q1 covers different months before and after. That is the sentence to say when a user asks
to change it on a company with history.

Read the current month first, then confirm:

> **&lt;Company&gt;** — fiscal year starts **January**, changing to **April**.
>
> Every reporting period for this company shifts with it, including the ones already collected.

Ask the confirmation question, end your reply, and wait. Never write in the same reply as the
question.

The response is the company's fiscal year as it now stands. Report that rather than the value you
sent.

## What it does not do

It does not change the firm's collection cadence — that is `cadence` on the firm's settings, and a
firm collecting quarterly still collects quarterly whatever month its companies' years start in.
The fiscal year decides which months each quarter covers; the cadence decides how often one is
collected.
