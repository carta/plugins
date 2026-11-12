---
name: carta-valuation-history
description: >-
  See a company's 409A and other valuations, and when the current one expires. Covers
  valuation history and current fair market value (FMV): 409A, EMI, CSOP or share price.
  Use for questions about valuations, FMV, exercise prices, or expiry. Not for
  cross-portfolio comparisons — prefer a portfolio-benchmarks skill.
when_to_use: >-
  Use when asked about the current valuation, fair market value (FMV),
  common stock exercise price, when the current valuation expires or is
  still valid, how the FMV has changed over time, or what the strike
  price should be for new option grants. Covers US 409A companies and
  companies valued under EMI, CSOP or a share-price report. For
  aggregate FMV comparisons across multiple portfolio companies, prefer
  a portfolio-benchmarks skill.
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
<carta-plugin>carta-cap-table:6.114.3</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Valuation History

Fetch a company's fair market value (FMV) history.

**FMV is not always a 409A.** A 409A is the US instrument; a UK company is valued under an **EMI** or **CSOP** agreement with HMRC, and other companies use a **share-price** report. Read whichever the company actually has, and never tell a company with a valid EMI valuation that it has none.

## When to Use

- "What's our current valuation?" / "What's the current 409A?"
- "Show me the FMV history" / "Has the FMV changed recently?"
- "When does the valuation expire?" / "Is the valuation still valid?"
- "What's the exercise price for common stock?"

## Prerequisites

Do not call `list_accounts` or ask which company before the first read: Carta finds the company. Reuse the company already resolved in this conversation unless this prompt names or numbers another. Else send the numeric id the user gave, else the company name as the user said it, else no `corporation_id` (Carta uses the user's only company). On an error, and for later calls, follow `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` (the plugin's own `references/`, not this skill's; read it by that path, do not search for it). Its reads are cap table reads: reuse `meta.company.id` on later calls.

## Data Retrieval

```
read_tool({"name": "cap_table__get__valuations", "arguments": {"corporation_id": corporation_id}})
```

Optional `valuation_source` filters to one or more of `EMI`, `CSOP`, `409A`, `SHARE_PRICE`. Omit it — the point of this command is that it covers every source at once.

## Key Fields

The response is `{count, active: [...], history: [...]}`. `history` holds every row including expired ones; `active` is the subset the server considers live. Each row has:

- `price`: FMV per share, a high-precision decimal string (e.g. `"0.500000000000"`) — parse it and trim trailing zeros before display
- `currency`: ISO code for **this row** — read it per row, never assume
- `valuation_type`: `AMV`, `UMV`, `FMV`, or `SHARE_PRICE`
- `support_reference_type`: which instrument the row came from (409A / EMI / CSOP / share price)
- `effective_date` / `expiration_date`: ISO `YYYY-MM-DD`
- `status`: `ACTIVE` or `EXPIRED`, computed server-side
- `share_class_name`: e.g. "Common", "Ordinary"
- `share_class_type`: `COMMON` or `PREFERRED`. An option's exercise (strike) price comes from a `COMMON` row

**AMV and UMV.** A single HMRC valuation produces **two** prices, both live at once: **AMV** (actual market value, discounted for restrictions on the shares) and **UMV** (unrestricted market value). They are not duplicates and one is not "the real one". Show both, labelled. If asked which applies to a specific grant, say that depends on the grant's terms and point the user to their equity advisor — the data does not record it, and the two carry different tax outcomes.

## Workflow

### Step 1 — Fetch Valuations

Call `cap_table__get__valuations` once, as in Data Retrieval.

### Step 2 — Identify the Current Valuation

Use `active`. Do **not** re-derive live-vs-expired from dates: the server applies per-source rules (a share-price report has its own state; a null expiration means open-ended) that a date comparison gets wrong. Where you do sort, sort on **parsed dates**, never raw strings.

If `active` holds more than one row, they are all current — an AMV/UMV pair, or several share classes. Present them all rather than picking one. If `active` is empty, say there is no current valuation, and lead with the latest expired row, flagged as expired.

### Step 3 — Check Expiration

- Within 90 days of today — **flag as a time-sensitive action item**, not just a data point: bold it, give the exact days remaining, and recommend starting renewal now (especially if a financing round is in progress, since closing will likely push past the expiry date).
- Already past — flag as expired, and say it must not be used to price new grants.
- No `expiration_date` — say it does not expire on a fixed date rather than inferring one.

Then present the results as in Presentation.

## Gates

**Required inputs**: none before the first read. The company comes from Prerequisites (omitted, a name, or `meta.company.id`).

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Table + trend summary

**BLUF lead**: Lead with the current FMV per share — with its currency and source — and its effective/expiration dates, before showing the history table.

**Sort order**: By `effective_date` descending (most recent first).

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

**Currency**: format `price` with **the row's own `currency`**. Never default to USD — a GBP valuation shown as dollars is a reporting error, not a cosmetic one. Put the ISO code before every amount (`USD 23.71`), in the table and in the prose, also when all rows are in USD. Do not use a currency symbol such as `$` or `£`.

| Effective | Expires | FMV/Share | Type | Source | Share Class | Status |
|-----------|---------|-----------|------|--------|-------------|--------|
| Jan 15, 2026 | Jan 14, 2027 | GBP 0.50 | AMV | EMI | Ordinary | Current |
| Jan 15, 2026 | Jan 14, 2027 | GBP 0.75 | UMV | EMI | Ordinary | Current |
| Apr 25, 2024 | Apr 24, 2025 | USD 12.61 | FMV | 409A | Common | Expired |

Drop the Type and Source columns when every row shares the same values (a US-only company gets back its familiar 409A table). If multiple share classes exist, group by share class name.

Do not render a bar chart: FMV values in mature companies cluster near the maximum, so every bar looks the same. After the table, add a one-line trend summary:
> FMV has grown **Nx since YYYY**, with [acceleration/steady growth] since [year].

**Only compare like with like.** A growth multiple across two currencies, or one that mixes an AMV with a UMV, is meaningless. Compute the trend within a single currency *and* a single `valuation_type`; if the series spans more than one, give a line for each or omit the trend.

## Error Handling

| Situation | What to do |
|---|---|
| 403, `role_required` or access denied | Say the user's role can't see this company's valuations. Do not retry, and do not call the 409A-only fallback. |
| `Unknown tool` or a server error for `cap_table__get__valuations` | Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-valuation-history/references/409a-fallback.md` (this skill's own `references/`; read it by that path, do not search for it) and follow it. |
| Response too large on a grants, notes or data warehouse read | This skill needs only the valuations command. For a list of grants or notes, use carta-reporting. |
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |

## Caveats

- Valuations are point-in-time snapshots — a material event (e.g. a new financing round) can invalidate a current valuation before its expiration date.
- This skill reads valuations; it cannot create or update one. Route those requests to the Carta app — for a non-US company that is the international valuations dashboard, not the 409A ledger.
