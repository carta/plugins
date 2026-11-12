---
name: carta-register-of-allotments
description: >-
  See a UK company's share allotments and SH01 filing status. This is the UK statutory
  Register of Allotments: each share allotment with its holder, share class, quantity,
  price and allotment date. Read-only.
when_to_use: >-
  Use when asked to show the register of allotments, the allotment
  register, what shares have been allotted (and to whom), allotment
  history, or SH01 return data for a company. Phrasings like "show me
  the register of allotments", "what shares have been allotted", "who
  were shares allotted to", "SH01 return data", or "allotment register
  for <company>". This is UK company-secretarial (CoSec) statutory-
  register data, distinct from financing rounds or a general stakeholder
  list.
model: inherit
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
<carta-plugin>carta-cap-table:6.114.7</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Register of Allotments

Show a UK company's statutory **Register of Allotments** — the record of every share allotment the company has made.

## Background

Under the UK Companies Act, a company must keep a register of the shares it has **allotted** (issued to a holder). Each allotment records who received the shares, which share class, how many, at what price, on what date, and whether the corresponding **SH01** return has been filed with Companies House. Carta maintains this register as part of its company-secretarial (CoSec) product.

## When to Use

- "Show me the register of allotments for <company>."
- "What shares have been allotted, and to whom?"
- "Pull the SH01 return data for this company."
- "Show the allotment history."

For funding-round economics (price per share by round, cash raised), prefer the round-history skill; for a current ownership snapshot, prefer a stakeholder-list skill. This skill is specifically the statutory allotments register.

## Prerequisites

Do not call `list_accounts` or ask which company before the first read: Carta finds the company. Reuse the company already resolved in this conversation unless this prompt names or numbers another. Else send the numeric id the user gave, else the company name as the user said it, else no `corporation_id` (Carta uses the user's only company). On an error, and for later calls, follow `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` (the plugin's own `references/`, not this skill's; read it by that path, do not search for it). This domain returns no `meta`: send the same value on later calls.

## Data Retrieval

```
read_tool({"name": "cosec__get__register_of_allotments", "arguments": {"corporation_id": corporation_id}})
```

Optional filters. Send only the ones the user asked for:

- `status`: `pending` (not yet written to the register) or `published`.
- `stakeholder_name`: one word. It matches a first name, a surname or an organization name, never a full personal name. For a person, send the surname, then keep only that person's rows (see *Rows you keep yourself*).
- `from_date` / `to_date`: allotment date range, YYYY-MM-DD, both days included.
- `filing_status`: the SH01 state, one or more of `not_generated`, `generated`, `filed`, `accepted`, `rejected`, comma-separated. "Not filed yet" is `not_generated,generated`.
- `share_class_id`: a numeric share class id only. This read returns class names, not ids: to show one class by name, read without this filter and keep the rows of that class (see *Rows you keep yourself*).
- `sort_by` and `direction` (send both or neither): `sort_by` is `transactioned`, `stakeholder_name`, `share_class_name`, `quantity`, `cost` or `filing_status`; `direction` is `ASC` or `DESC` in capitals. With no sort, the newest allotments come first.
- `page` / `page_size` (default page size 25).

Do not send `raw`: the normal response has every field this skill uses.

## Key Fields

The response is `{count, page, num_pages, allotments: [...]}`, where `count` is the total across all pages and `allotments` is the current page. Each allotment has:

- `stakeholder` — the holder the shares were allotted to
- `share_class` — the class of shares allotted
- `quantity` — number of shares allotted
- `price` / `price_currency` — price per share and its currency
- `transactioned` — the allotment date (YYYY-MM-DD)
- `status` — `pending` or `published`
- `filing_status` — the SH01 filing state (`not_generated` when no SH01 exists yet)

## Presentation

Lead with the total `count` (with a filter, say it is the count that matches the filter), except for rows you keep yourself. Then show a table, most recent first unless the user asked for another order:

| Date | Holder | Share Class | Quantity | Price | Status | Filing |
|------|--------|-------------|----------|-------|--------|--------|

Show each price with its own `price_currency` code before the amount (for example `GBP 1.00`). Never assume GBP or USD, and never add amounts in different currencies. A price of 0 can mean that no price is recorded.

If `num_pages` is greater than 1, tell the user more pages are available and how to narrow the results (the filters above), except for rows you keep yourself.

**Rows you keep yourself** (one share class by name, or one person among holders who share a surname): fetch each page up to `num_pages`, at most 10 pages, and say the list is partial if more remain. Lead with the number of rows you kept, never with `count`, which counts every row the read matched.

## Gates

**Required inputs**: none before the first read. The company comes from Prerequisites (omitted, a name, or the id already resolved).

**AI computation**: No — this skill presents Carta data directly.

## Error Handling

| Situation | What to do |
|---|---|
| `role_required` or 403 | Say the user is not a company admin, or the company has no CoSec registers (Carta keeps this register for UK companies). Do not retry. |
| No allotments (an empty list) | With no filter, say the company has no allotments recorded in Carta. With a filter, say no allotments match it, name the filter, and offer to read without it. Do not say or suggest that the company has no allotments: an empty filtered list does not show that. Do not call other tools looking for them. |
| `invalid_argument` on a filter | Correct the value to the format in *Data Retrieval* and call again one time. |
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |

## Caveats

- **Company admins of CoSec companies only.** Tell a user without access why, rather than reporting a failure.
