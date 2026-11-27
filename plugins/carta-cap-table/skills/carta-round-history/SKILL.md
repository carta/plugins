---
name: carta-round-history
description: >-
  See every priced funding round a company raised: date, price, amount and investors.
  Lists each financing round with its date, share class issued, price per share, total
  cash raised, and the investors who participated. Covers what was raised and from whom
  across the company's funding history.
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
  - mcp__carta__read_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - AskUserQuestion
  - Read
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.123.6</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Round History

Fetch the company's financing history, one row per share class, and present it as a round-by-round table.

Send `_instrumentation_v2: {"surface": "<surface>"}` with every Carta tool call, as a parameter
of the tool next to `name` and `arguments`, never in `arguments`. `<surface>` is the closest of
`chat`, `cowork`, `code-terminal`, `code-desktop`, `code-remote`, `excel`, `sdk-cli`,
`sdk-typescript` and `sdk-python`, else `other`. Run no shell command for this or any other
`_instrumentation_v2` field: send `session_id` only when your system prompt already shows it.

## When to Use

- "Show me the funding history" / "List all financing rounds"
- "How much capital was raised in the Series A?" / "What was the price per share for the seed?"
- "Who invested in each round?"

## Prerequisites

Do not call `list_accounts` or ask which company before the first read: Carta finds the company. Reuse the company already resolved in this conversation unless this prompt names or numbers another. Else send the numeric id the user gave, else the company name as the user said it, else no `corporation_id` (Carta uses the user's only company). On an error, and for later calls, follow `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` (the plugin's own `references/`, not this skill's; read it by that path, do not search for it). Its reads are cap table reads: reuse `meta.company.id` on later calls.

## Data Retrieval

```
read_tool({"name": "cap_table__list__financings", "arguments": {"corporation_id": corporation_id, "size": 100}})
```

It returns the rows of the in-app "Financing History" tab, latest `closing_date` first. While `has_next` is true, call it again with `after` set to `next`, at most 5 pages. If `has_next` is still true after 5 pages, show what you read and say the list is partial: it holds the latest rounds only.

## Key Fields

Each entry in `results[]`:

- `kind`: `share_class` (a priced round) or `note_block` (SAFEs or convertible notes, with no price)
- `id`: the share class id or the note block id
- `name`: share class, i.e. the round (e.g. "Series A Preferred")
- `closing_date`: when the round closed
- `original_issue_price`: price per share, `{amount, currency}`
- `shares_issued`: shares issued in the round
- `cash_raised`: a list of `{amount, currency}`, one per currency — `[]` when the class raised no cash (e.g. common stock)
- `post_money`: post-money valuation, `{amount, currency}`
- `fully_diluted`: fully diluted shares after the round

Amounts and share counts are decimal strings. `summary.total_cash_raised` is the cash raised by every row on all pages, one `{amount, currency}` per currency.

Any numeric field can be `null`, meaning Carta has no value for it. `null` is not `0` — show it as "—", never as 0.

## Workflow

### Step 1 — Fetch Financing History

Read `cap_table__list__financings` as above. It answers overview, per-round cash, price per share, and post-money questions on its own.

### Step 2 — Investors in a Round (only when asked)

`cap_table__list__financings` has no investor names. For *"who invested in the Series A?"* or *"list investors by round"*, read the share certificates and keep the ones whose `share_class_name` matches the round's `name`:

```
read_tool({"name": "cap_table__list__certificates", "arguments": {"corporation_id": corporation_id, "ordering": "-quantity", "page_size": 25, "page": 1}})
```

- Each row carries `name` (holder), `quantity`, `share_class_name`, `issue_date`, `status_explanation`, and `debt_canceled` (converted SAFE or note amount). Group matching rows by holder and sum `quantity`.
- Fetch the page in `next` (its `page` and `page_size`) until `has_next` is false, **at most 10 pages**. If the sweep is still incomplete at 10 pages, show what you have, say the list is partial, and point the user to the round's page in Carta.
- Certificates carry no cash paid. Report each investor's shares only. Do not multiply shares by the issue price to produce a per-investor dollar amount. Write this sentence word for word: "Per-investor cash isn't available: Carta certificates record shares, not cash paid."

## Gates

**Required inputs**: none before the first read. The company comes from Prerequisites (omitted, a name, or `meta.company.id`).

**AI computation**: No — this skill presents Carta data directly (grouping certificates by holder is mechanical, not modeled output).

## Presentation

**Format**: Table + ASCII bar chart

**BLUF lead**: Lead with the number of priced rounds that raised cash and the total raised, from `summary.total_cash_raised`.

**Sort order**: By `closing_date` ascending: reverse the rows, which the tool returns latest first.

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

**Currency**: Label every amount with its own currency. When `summary.total_cash_raised` has more than one currency, show one total per currency — never add amounts across currencies, and never assume USD. Put the ISO code before every amount (`USD 383,380`), also when all rows are in USD. Do not use a currency symbol such as `$`.

| Round | Close Date | Price/Share | Shares Issued | Cash Raised | Post-Money |
|-------|-----------|-------------|---------------|-------------|------------|
| Series Seed Preferred | Jun 30, 2013 | USD 0.27 | 1,602,438 | USD 383,380 | USD 4.0M |
| Series A Preferred | Nov 15, 2013 | USD 0.44 | 3,697,191 | USD 1,645,250 | USD 12.0M |

After the table, render an ASCII bar chart of cash raised per round (chronological order). Scale bars to max width 40 chars. Leave out rows whose `cash_raised` is empty (e.g. common stock). If the company raised in more than one currency, draw one chart per currency.

```
Cash Raised by Round

Series Seed Preferred  ████                                     USD 383K
Series A Preferred     ████████████████                         USD 1.6M
Series B Preferred     ████████████████████████████████████████ USD 3.7M
```

Each bar width = (cash_raised / max_cash_raised) * 40, rounded to nearest integer. Format large numbers as K or M after the ISO code (e.g. `USD 1.6M`).

## Error Handling

| Situation | What to do |
|---|---|
| `results` is empty | Say the company has no financing history recorded in Carta. Do not call other tools looking for rounds. |
| 403, `role_required` or access denied | Say the user's role can't see this company's financing history. Do not retry. |
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |

## Caveats

- Rows are per share class. A round that issued more than one class (e.g. Series A and Series A-1) appears as separate rows — present them as Carta reports them.
- A row with `kind` `note_block` is a block of SAFEs or convertible notes, not a priced round: it has no price, post-money or fully diluted, and `shares_issued` is 0. Label it as SAFEs/notes and do not count it as a round. `summary.total_cash_raised` includes its cash. For the instruments, prefer the matching instrument-list skill.
- `cash_raised` is new cash only. When investors paid for a class by converting SAFEs or notes, that class shows less cash or none, because the converted money stays on the SAFE/notes row. Say this when a class shows less than the user expects, and do not call it an error. When the user compares with signed round documents, sum `debt_canceled` of the class's certificates, read as in Step 2, as its converted amount. If the sweep is partial, say the converted amount is partial too. A preferred class (not common stock) that shows no cash and no converted amount has no consideration recorded in Carta: tell the user to check the certificates in Carta.
