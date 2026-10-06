# Files and metrics

What a data collection request can ask a portfolio company for, and how to say it to the user.

Shared by every action that touches data requirements. Ported from the internal
`middle-office-data-collection` plugin's reference of the same name, which is the authoritative
source for the labels.

## Files — a fixed set of eight

The API accepts exactly these eight **codes** in `requested_files` and `requested_metrics`'s
sibling. The code is what goes on the wire; the label is what the user sees.

| Code | Label |
|---|---|
| `AOI` | Articles of Incorporation |
| `CAP` | Captable |
| `BS` | Balance Sheet |
| `PL` | Profit & Loss |
| `CFS` | Cash Flow Statement |
| `FCST` | Forecasts |
| `DECK` | Board Deck / Investor Update |
| `KPI` | KPI |

**Send the code, show the label.** `{"type": "BS", "required": true}` on the wire; "Balance Sheet"
in anything the user reads. A code outside these eight is rejected with a 400 naming it.

The Python enum in carta-web spells these `BALANCE_SHEET`, `CAP_TABLE`, `CASH_FLOW` and so on —
those are **names, not values**, and the API does not accept them.

### One word can name several

**"Financials" is three codes, not one: `BS`, `PL` and `CFS`.** There is no `FINANCIALS` code, so
asking which statements were meant is asking the user to name something they already named. Take it
as all three, say so in the summary, and let them narrow it. Same for "financial statements", "the
financials" and "full financials".

Nothing else in the eight groups this way. "Documents" and "everything" are too loose to expand, so
ask about those.

The words each code answers to, so a phrase is matched rather than queried:

| Code | Also called |
|---|---|
| `BS` | balance sheet, statement of financial position |
| `PL` | profit and loss, P&L, PnL, income statement |
| `CFS` | cash flow, cash flow statement, statement of cash flows |
| `CAP` | cap table, captable, capitalization table |
| `AOI` | articles, certificate of incorporation, charter |
| `DECK` | board deck, investor update, deck |
| `FCST` | forecasts, projections, budget |
| `KPI` | KPIs, key metrics |

Case and punctuation do not matter: "P&L", "p and l" and "profit/loss" are one name.

### A firm can define more

The eight are not the whole list. A firm asks for anything else — an insurance certificate, a policy
— through a document type of its own, which carries an **integer id** rather than a string code and
travels in `requested_documents` rather than `requested_files`. See
`references/document-types.md`; the two fields sit side by side on the same command and are not
interchangeable.

### Saying them well

- Preserve each label exactly as written above. Do not invent alternatives.
- `Captable` is one word because the backend enum spells it that way.
- Do not shorten `DECK` to "Deck" — it covers investor updates too.
- `Profit & Loss`, not "P&L", unless space genuinely demands it.
- Join a list with commas and an Oxford comma: *"Balance Sheet, Profit & Loss, and Cash Flow
  Statement"*.

## Metrics — per firm, never hardcoded

Metrics are configured per firm. There is no fixed list, so read the firm's own vocabulary:

```
call_tool({"name": "data_collection__list__metrics",
           "arguments": {"organization_pk": "<org_pk>"}})
```

Each entry has a `mnemonic` — `FS_CASH_AND_CASH_EQUIVALENTS` — and a `name` —
"Cash & Cash Equivalents".

**Send the mnemonic, show the name.** Surface a mnemonic only if the user asks for the raw code.
If a `name` is missing, fall back to humanising the mnemonic: drop the `FS_` prefix, replace
underscores with spaces, title-case the rest. `FS_HEADCOUNT` → "Headcount".

A firm can have dozens. Do not list them all unprompted — ask what the user wants to collect and
match against the vocabulary, or offer the ones already on the company's saved configuration.

### The firm's own metrics come first

`owner_id` says whose a metric is: `0` is one of Carta's, and anything else is one the firm created.
`custom_count` says how many are the firm's own.

**List the firm's own before Carta's**, under their own heading, the way the web app does:

> **Your metrics**
> • Monthly Active Users
> • Net Revenue Retention
>
> **Carta's metrics**
> • Headcount
> • Cash & Cash Equivalents

A firm looks for what it defined itself, and a list that buries three of its own among forty
standard ones reads as though they are missing. Never show the id.

`references/custom-metrics.md` is how a firm adds one.

## Required is a subset of requested

Each item carries `required`:

```json
{"type": "BS", "required": true}
```

`required: true` means the portfolio company cannot submit its response without it. An item that is
requested but not required is optional for them. Say which are required when confirming — it
changes what the company has to do.

## Period labels

Never show a raw period field to the user. Convert it:

| `interval.unit` | Label | Example |
|---|---|---|
| `months` | Month name and year | April 2026 |
| `quarters` | Q + index + year | Q1 2026 |
| `half_years` | H + index + year | H1 2026 |
| `years` | The year | 2026 |

Never show a "period index" column, and never say "Year 2026, month 4". `data_collection__list__requests` also
returns `period_label`, already formatted the same way — prefer it when echoing an existing
request.
