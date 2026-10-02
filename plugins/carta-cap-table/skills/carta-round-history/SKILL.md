---
name: carta-round-history
description: >-
  Financing round history for a company — each priced round with its date, share class issued, price per share, total cash raised, and the investors who participated. Covers what was raised and from whom across the company's funding history.
when_to_use: >-
  Use when asked about funding rounds, financing rounds, the company's
  round history, capital raised totals, how much has been pulled in from
  outside investors, how much money has been raised across all rounds,
  cumulative cash raised, who invested in a specific round, price per
  share at a financing, the equity activity timeline, or a round-by-
  round breakdown. For securities outside priced rounds (SAFEs,
  convertible notes), prefer the matching instrument-list skill. For
  current stakeholder snapshots without round context, prefer a
  stakeholder list skill.
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.92.0</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Round History

Fetch the company's financing history, one row per share class, and present it as a round-by-round table.

## When to Use

- "Show me the funding history"
- "What rounds has this company raised?"
- "How much capital was raised in the Series A?"
- "List all financing rounds"
- "Who invested in each round?"
- "What was the price per share for the seed?"

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

> **Use `cap_table__list__financing_history` — never `cap_table__get__financing_history`.** The `get` tool is deprecated: the gateway rejects every call to it with *"This command is deprecated. Use 'cap_table:list:financing_history' instead."* before reaching Carta, so calling it only wastes a turn.

```
call_tool({"name": "cap_table__list__financing_history", "arguments": {"corporation_id": corporation_id}})
```

This tool takes only `corporation_id` — there is no `detail`, `ordering`, or paging argument. It returns every share class in one call, already aggregated and sorted by `closing_date`, with the same totals as the in-app "Financing History" tab.

## Key Fields

Each entry in `share_class_financings[]`:

- `name`: share class, i.e. the round (e.g. "Series A Preferred")
- `closing_date`: when the round closed
- `original_issue_price`: price per share
- `shares_issued`: shares issued in the round
- `cash_raised_by_currency`: `{currency: amount}` — `{}` when the class raised no cash (e.g. common stock)
- `post_money`: post-money valuation
- `fully_diluted`: fully diluted shares after the round
- `currency`: the share class's currency

Top level: `total_cash_raised_by_currency` — the per-currency totals across all rows.

Any numeric field can be `null`, meaning Carta has no value for it. `null` is not `0` — show it as "—", never as $0.

### Response Format

```json
{
  "share_class_financings": [
    {
      "name": "Series Seed Preferred",
      "closing_date": "2013-06-30",
      "original_issue_price": 0.265,
      "cash_raised_by_currency": {"USD": 383379.57},
      "shares_issued": 1602438.0,
      "post_money": 4000000.0,
      "fully_diluted": 15094339.0,
      "currency": "USD"
    }
  ],
  "total_cash_raised_by_currency": {"USD": 383379.57}
}
```

## Workflow

### Step 1 — Fetch Financing History

Call `cap_table__list__financing_history` once. It answers overview, per-round cash, price per share, and post-money questions on its own.

### Step 2 — Investors in a Round (only when asked)

`cap_table__list__financing_history` has no investor names. For *"who invested in the Series A?"* or *"list investors by round"*, read the share certificates and keep the ones whose `share_class_name` matches the round's `name`:

```
call_tool({"name": "cap_table__list__certificates", "arguments": {"corporation_id": corporation_id, "ordering": "-quantity", "page_size": 25, "page": 1}})
```

- Each row carries `name` (holder), `quantity`, `share_class_name`, `issue_date`, and `status_explanation`. Group matching rows by holder and sum `quantity`.
- Fetch successive pages until you have `total` rows, **at most 10 pages**. If the sweep is still incomplete at 10 pages, show what you have, say the list is partial, and point the user to the round's page in Carta.
- Certificates carry no cash paid. Report each investor's shares only. Do not multiply shares by the issue price to produce a per-investor dollar amount — say that per-investor cash isn't available here.

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly (grouping certificates by holder is mechanical, not modeled output).

## Presentation

**Format**: Table + ASCII bar chart

**BLUF lead**: Lead with the number of rounds that raised cash and the total raised, from `total_cash_raised_by_currency`.

**Sort order**: By `closing_date` ascending (the order the tool returns).

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

**Currency**: Label every amount with its own currency. When `total_cash_raised_by_currency` has more than one key, show one total per currency — never add amounts across currencies, and never assume USD.

| Round | Close Date | Price/Share | Shares Issued | Cash Raised | Post-Money |
|-------|-----------|-------------|---------------|-------------|------------|
| Series Seed Preferred | Jun 30, 2013 | $0.27 | 1,602,438 | $383,380 | $4.0M |
| Series A Preferred | Nov 15, 2013 | $0.44 | 3,697,191 | $1,645,250 | $12.0M |

After the table, render an ASCII bar chart of cash raised per round (chronological order).
Scale bars to max width 40 chars. Leave out rows whose `cash_raised_by_currency` is empty (e.g. common stock). If the company raised in more than one currency, draw one chart per currency.

```
Cash Raised by Round

Series Seed Preferred  ████                                     $383K
Series A Preferred     ████████████████                         $1.6M
Series B Preferred     ████████████████████████████████████████ $3.7M
```

Each bar width = (cash_raised / max_cash_raised) * 40, rounded to nearest integer.
Format large numbers as $XM or $XK for readability.

## Error Handling

| Situation | What to do |
|---|---|
| *"This command is deprecated"* | You called `cap_table__get__financing_history`. Call `cap_table__list__financing_history` instead, once. Do not retry the deprecated tool. |
| `share_class_financings` is empty | Say the company has no financing history recorded in Carta. Do not call other tools looking for rounds. |
| 403 / access denied | Say the user's role can't see this company's financing history. Do not retry. |

## Caveats

- Rows are per share class. A round that issued more than one class (e.g. Series A and Series A-1) appears as separate rows — present them as Carta reports them.
- SAFEs and convertible notes are not share classes and do not appear here until they convert; for those, prefer the matching instrument-list skill.
