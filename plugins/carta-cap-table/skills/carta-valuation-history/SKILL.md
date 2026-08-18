---
name: carta-valuation-history
description: Fetch a company's valuation history and current fair market value (FMV) — 409A, EMI, CSOP or share price. Use for questions about valuations, FMV, exercise prices, or expiry. Not for cross-portfolio comparisons — prefer a portfolio-benchmarks skill.
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
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - AskUserQuestion
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

<!-- Part of the official Carta AI Agent Plugin -->

# Valuation History

Fetch a company's fair market value (FMV) history.

**FMV is not always a 409A.** A 409A is the US instrument; a UK company is valued under an
**EMI** or **CSOP** agreement with HMRC, and other companies use a **share-price** report.
Read whichever the company actually has, and never tell a company with a valid EMI valuation
that it has none.

## When to Use

- "What's our current valuation?" / "What's the current 409A?"
- "Show me the FMV history"
- "When does the valuation expire?"
- "What's the exercise price for common stock?"
- "Has the FMV changed recently?"
- "Is the valuation still valid?"

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you don't have it.

## Data Retrieval

```
call_tool({"name": "cap_table__get__valuations", "arguments": {"corporation_id": corporation_id}})
```

Optional `valuation_source` filters to one or more of `EMI`, `CSOP`, `409A`, `SHARE_PRICE`.
Omit it — the point of this command is that it covers every source at once.

### Response Format

```json
{
  "count": 2,
  "active": [
    {
      "price": "0.500000000000",
      "currency": "GBP",
      "valuation_type": "AMV",
      "support_reference_type": "EMI_VALUATION_REPORT",
      "effective_date": "2026-01-15",
      "expiration_date": "2027-01-14",
      "share_class_name": "Ordinary",
      "status": "ACTIVE"
    }
  ],
  "history": []
}
```

`history` holds every row including expired ones; `active` is the subset the server considers
live.

## Key Fields

- `price`: FMV per share, a high-precision decimal string (e.g. `"0.500000000000"`)
- `currency`: ISO code for **this row** — read it per row, never assume
- `valuation_type`: `AMV`, `UMV`, `FMV`, or `SHARE_PRICE`
- `support_reference_type`: which instrument the row came from (409A / EMI / CSOP / share price)
- `effective_date` / `expiration_date`: ISO `YYYY-MM-DD`
- `status`: `ACTIVE` or `EXPIRED`, computed server-side
- `share_class_name`: e.g. "Common", "Ordinary"

### AMV and UMV

A single HMRC valuation produces **two** prices, both live at once:

- **AMV** — actual market value, discounted for restrictions on the shares
- **UMV** — unrestricted market value

They are not duplicates and one is not "the real one". Show both, labelled. If asked which
applies to a specific grant, say that depends on the grant's terms and point the user to their
equity advisor — the data does not record it, and the two carry different tax outcomes.

## Fallback

If `cap_table__get__valuations` is unavailable for the company, fall back to
`cap_table__get__409a_valuations`, which returns `{count, current_409a, history}` for US 409A
data only. That response has **no currency field** — present its prices unlabelled rather than
assuming a symbol, and check `current_409a.is_expired` before calling it current.

## Workflow

### Step 1 — Fetch Valuations

```
call_tool({"name": "cap_table__get__valuations", "arguments": {"corporation_id": corporation_id}})
```

### Step 2 — Identify the Current Valuation

Use `active`. Do **not** re-derive live-vs-expired from dates: the server applies per-source
rules (a share-price report has its own state; a null expiration means open-ended) that a date
comparison gets wrong.

Where you do sort, sort on **parsed dates**, never raw strings. These are ISO so they happen to
sort correctly, but the 409A fallback returns `MM/DD/YYYY`, where a string sort is month-major
and ranks `12/01/2023` above `04/25/2025`.

If `active` holds more than one row, they are all current — an AMV/UMV pair, or several share
classes. Present them all rather than picking one.

### Step 3 — Check Expiration

- Within 90 days of today — **flag as a time-sensitive action item**, not just a data point:
  bold it, give the exact days remaining, and recommend starting renewal now (especially if a
  financing round is in progress, since closing will likely push past the expiry date).
- Already past — flag as expired.
- No `expiration_date` — say it does not expire on a fixed date rather than inferring one.

### Step 4 — Present Results

Show the history table and trend summary (see Presentation section).

## Gates

**Required inputs**: `corporation_id`.
If missing, call `AskUserQuestion` before proceeding (see carta-interaction-reference §4.1).

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Table + trend summary

**BLUF lead**: Lead with the current FMV per share — with its currency and source — and its
effective/expiration dates, before showing the history table.

**Sort order**: By `effective_date` descending (most recent first).

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

**Currency**: format `price` with **the row's own `currency`**, trimming trailing zeros. Never
hardcode a `$`, and never default to USD — a GBP valuation shown as dollars is a reporting
error, not a cosmetic one.

| Effective | Expires | FMV/Share | Type | Source | Share Class | Status |
|-----------|---------|-----------|------|--------|-------------|--------|
| Jan 15, 2026 | Jan 14, 2027 | GBP 0.50 | AMV | EMI | Ordinary | Current |
| Jan 15, 2026 | Jan 14, 2027 | GBP 0.75 | UMV | EMI | Ordinary | Current |
| Apr 25, 2024 | Apr 24, 2025 | USD 12.61 | FMV | 409A | Common | Expired |

Drop the Type and Source columns when every row shares the same values (a US-only company gets
back its familiar 409A table).

Do not render a bar chart for FMV history — values in mature companies cluster near the
maximum, making bars uninformative (all bars look the same width). The table is sufficient.
Instead, after the table, add a one-line trend summary:
> FMV has grown **Nx since YYYY**, with [acceleration/steady growth] since [year].

**Only compare like with like.** A growth multiple across two different currencies is
meaningless, and so is one that mixes an AMV with a UMV. Compute the trend within a single
currency *and* a single `valuation_type`; if the series spans more than one, give a separate
line for each or omit the trend entirely.

If multiple share classes exist, group by share class name in the table.

## Caveats

- The `price` field is a string with many trailing zeros — always parse and format before
  displaying.
- A valuation with a past `expiration_date` should never be used for new grant pricing. Flag it
  prominently.
- Valuations are point-in-time snapshots — a material event (e.g. a new financing round) can
  invalidate a current valuation before its expiration date.
- This skill reads valuations; it cannot create or update one. Route those requests to the
  Carta app — for a non-US company that is the international valuations dashboard, not the 409A
  ledger.
