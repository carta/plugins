---
name: carta-hmrc-limits
description: >-
  Report a UK company's HMRC EMI/CSOP limit usage. Use when asked how much EMI allowance is left, whether the company is near the £6m EMI limit, who is close to or over their £250k individual limit, CSOP headroom, or whether a planned grant fits.
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

# HMRC EMI/CSOP Limits

Report how much of a UK company's HMRC share-scheme allowances its outstanding grants use —
at company level and per option holder.

## When to Use

- "How much of our EMI limit have we used?"
- "How much EMI allowance is left?"
- "Are we close to the £6 million EMI limit?"
- "Who is near their individual limit?"
- "Is anyone over the £250k EMI/CSOP limit?"
- "How much CSOP headroom does Priya have?"
- "Can we grant another £50k of EMI options?"

UK companies only. A company without UK share schemes has nothing to report here.

## Prerequisites

You need the `corporation_id`. Get it from `list_accounts` if you do not have it.

## Data Retrieval

Company-level allowance:

```
call_tool({"name": "uk_compliance__get__hmrc_limits",
           "arguments": {"corporation_id": corporation_id}})
```

Per-holder breakdown:

```
call_tool({"name": "uk_compliance__list__hmrc_stakeholder_limits",
           "arguments": {"corporation_id": corporation_id}})
```

Both are read-only, so issue them in a single response when the question needs both.

### Filters on the per-holder call

- `status` — comma-separated: `WITHIN_LIMIT`, `APPROACHING_LIMIT`, `EXCEEDED_LIMIT`,
  `MISSING_UMV_VALUATION`
- `search` — holder name
- `ordering` — `name`, or `-name` to reverse
- `page`, `page_size` — `page_size` defaults to 25

## Reading the response

Company level returns `scheme_type` (`EMI_ONLY`, `CSOP_ONLY`, `EMI_AND_CSOP`),
`statutory_limits`, `company_limit_usage` and an optional `warnings` list.

Per holder returns `count` (rows on this page), `total_count` (the company total) and
`stakeholder_limits[]`, each with `name`, `scheme_type`, `limit_status`,
`individual_limit_usage` and `option_grants_count`.

`limit_status` and the company `status` share four values: `WITHIN_LIMIT`,
`APPROACHING_LIMIT` (at or above 80%), `EXCEEDED_LIMIT`, `MISSING_UMV_VALUATION`.

## Rules

**Never state a limit from memory. Read `statutory_limits`.** The EMI company limit rose
from £3m to £6m on 6 April 2026, and the service returns the figure that applies. Quoting a
remembered number will eventually be wrong, and wrong by millions.

**`MISSING_UMV_VALUATION` is not zero.** It means at least one grant has no unrestricted
market value valuation covering its grant date, so that grant could not be priced. The
`used` and `available` figures are absent on this status. Say the total is unavailable and
that a valuation is needed — never report £0 used or a full allowance remaining. Treating it
as zero tells a company it has room it may not have.

**Read `total_count` before summarising the roster.** `count` is only this page. With more
holders than one page, filter with `status=EXCEEDED_LIMIT,APPROACHING_LIMIT` rather than
paging the whole company — the holders who matter are the ones near or over.

**A `warnings` entry about non-GBP grants means the totals are incomplete.** Only
GBP-denominated grants count toward the figures, so a company holding grants in other
currencies has usage the numbers do not show. Pass the warning on.

**The £250k individual limit is combined EMI and CSOP, with a £60k CSOP sub-limit.** When
`individual_limit_usage.breakdown` is present, `emi_available` and `csop_available` show
headroom per scheme. A holder can have combined room left while their CSOP room is spent, so
quote the relevant one for the scheme being asked about.

## Presenting

Lead with the answer, then the figures. For "how much is left", give `available` and the
`limit` it is measured against, and say the status in words.

For roster questions, a short table — holder, status, used, available — and name the count
you are showing against `total_count`. Put anyone `EXCEEDED_LIMIT` first; that is the
actionable group.

Round to whole pounds. These are statutory thresholds, so do not present a figure as more
precise than the source.

## If the call fails

- **403** — the company does not have the HMRC limits feature enabled, or this user lacks
  the company tax data permission. Both are expected for non-UK companies and for users
  without tax access. Say which company was refused and suggest they check with an
  administrator; do not retry.
- **400 on `status`** — an invalid status value. The four valid ones are listed above.

## Related Skills

- `carta-valuation-history` — the EMI and CSOP valuations these figures are priced from
- `carta-reporting` — the underlying option grants and other cap table data
