---
name: carta-round-benchmarks
description: >-
  Carta-wide market benchmarks for venture rounds: round size, pre- and post-money
  valuation and percent sold, as percentiles by stage (Seed to Series D+), sector and
  US metro, from Carta platform data. Answers in chat, or opens an interactive round
  benchmarking dashboard beside the chat. Also places a figure against the market.
  Triggers: "median post-money for a Series C across the market", "Carta-wide Series A pre-money",
  "how much do Seed rounds raise across the market", "round benchmarking dashboard",
  "what percentile is a $40M pre-money at Series A", "fintech Series B valuations in the Bay Area".
  Do NOT use for a fund's IRR, TVPI, DPI or MOIC against peers (use carta-fund-performance),
  for round sizes or option pools across your own portfolio (use carta-market-benchmarks
  in carta-cap-table), or for one company's financing history (use carta-explore-data).
version: 1.1.0
model: inherit
allowed-tools:
  - mcp__carta__read_tool
  - mcp__carta__view_static
  - mcp__carta__skill_checkpoint
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__view_static
  - mcp__claude_ai_Carta__skill_checkpoint
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__view_static
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__skill_checkpoint
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.61.8</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Round Benchmarks

Market-wide percentiles for priced venture rounds: how much companies raise, at what
pre- and post-money valuation, and what share of the company they sell, by stage, sector
and metro area. The numbers are the ones behind Carta's public
[Round Benchmarking tool](https://carta.com/data/explore/round-benchmarking). They describe
the market, never the user's own funds or portfolio.

## Prerequisites

- The Carta MCP connector, signed in.
- A connector that lists round benchmarks. Without it, see "When there is nothing to show".

## When to Use

- "What's the median post-money valuation for a Series C company?"
- "Typical Series A pre-money in fintech?"
- "How much do Seed rounds raise in New York?"
- "Show me Series B valuations by quarter since 2023"
- "Compare SaaS and Biotech Series A round sizes"
- "How does a $60M pre-money at Series A compare with the market?"
- "What percent of the company is sold in a Series B?"
- "Build me a round benchmarking dashboard" / "let me explore valuations by stage, sector and region"

Answer a single question in chat. Open the dashboard when the user asks for one, wants
to explore or compare across several stages, sectors or regions, or would otherwise need
several follow-up questions. When unsure, answer in chat and offer the dashboard.

## When NOT to Use

- "How does Fund II's TVPI compare to peers?" → `carta-fund-performance`
- "What's the typical option pool across our portfolio?" → `carta-market-benchmarks` (carta-cap-table)
- "How does this deal's round size compare with the rest of our portfolio?" → `carta-market-benchmarks` (carta-cap-table)
- "What did Acme raise in its Series B?" → `carta-explore-data`

## Data Retrieval

One read, no firm context needed:

```
read_tool({"name": "insights__get__round_benchmarks", "arguments": {...}})
```

| Argument | Values | How to fill it |
|---|---|---|
| `stage` | `Seed`, `Series A`, `Series B`, `Series C`, `Series D+` | The stage(s) the user names. Series D, E and later are one bucket, `Series D+`: say so when the user asked for one of them |
| `sector` | `SaaS`, `Fintech`, `Biotech`, `Healthtech`, `Medical Devices`, `Hardware`, `Consumer`, `Energy` | Only when the user names a sector. Map their words to one of these (e.g. "B2B software" → `SaaS`) and say which you used; if none fits, ask |
| `metro_area` | `bay-area`, `la-metro`, `nyc-metro`, `boston-metro`, `austin-metro`, `rest-of-usa` | Only when the user names a place. Map a city to its metro ("San Francisco" → `bay-area`) |
| `group_by` | any of `stage`, `sector`, `metro_area` | Every dimension the user filters on or wants compared side by side. Without it, the rows aggregate across all three |
| `reporting_period` | `month`, `quarter`, `year`, `all` | `quarter` by default. `year` for year-over-year questions, `all` for one figure across the whole window |
| `start_date` / `end_date` | ISO dates; data begins `2021-01-01` | Default to January 1 two calendar years before today, through today |
| `percentiles` | any of `5, 10, 25, 50, 75, 90, 95` | `[10, 25, 50, 75, 90]` unless the user asks for other points |

Pass lists as JSON arrays: `"stage": ["Series C"], "group_by": ["stage"]`.

Example, the median Series C post-money by quarter:

```
read_tool({"name": "insights__get__round_benchmarks", "arguments": {
  "stage": ["Series C"], "group_by": ["stage"], "reporting_period": "quarter",
  "start_date": "2024-01-01", "percentiles": [10, 25, 50, 75, 90]}})
```

## The response

| Field | Meaning |
|---|---|
| `cells[]` | One per period × group: `period_start`, `n` (distinct rounds), the grouped dimensions, and one percentile dict per metric — `round_raised_amount`, `round_pre_money`, `round_post_money`, `percent_sold_in_round` — keyed `p10`, `p50`, … |
| `cells[].suppressed` | `true` when fewer than `suppression_floor` rounds back the cell, so its metrics are withheld |
| `data_as_of` | When the benchmark data was last verified. Quote it with every number |
| `coverage.latest_period_start` | The last period the data reaches. It lags today by up to a quarter |
| `notes[]` | Caveats from the server, including when rows were cut off or nothing matched |

## How to Present

Lead with the answer in one sentence, then the detail.

1. **Headline:** the metric's median (`p50`) in the latest period whose cell is not `suppressed`, with its
   period and `n`. Example: "The median Series C post-money in {quarter} was {p50}, across
   {n} rounds."
2. **Spread:** a table of the percentiles for that period.

   | | 10th | 25th | Median | 75th | 90th |
   |---|---|---|---|---|---|
   | Post-money | … | … | … | … | … |

3. **Trend** (when there is more than one period): one row per period with the median and `n`.
4. **Footer:** *Carta round benchmarks · {filters in words} · US-incorporated, USD primary
   rounds · data as of {data_as_of}*
5. **Next step:** one line offering the obvious follow-up, e.g. split by sector or metro,
   or widen the window.

When the user compares groups (sectors, metros, stages), put the groups side by side in one
table for the latest period where none of them is `suppressed`, instead of repeating the
layout per group.

### Placing a round the user names

When the user gives a figure ("$60M pre-money at Series A"), fetch that stage (and their
sector and metro if given) with `reporting_period: "all"`, and place the figure against
that one cell's percentiles, naming the window and `n`. A single cell over the whole window
is the one most likely to clear the suppression floor. If it is `suppressed`, say so and
offer to drop the sector or metro filter:

| Figure is | Say |
|---|---|
| ≥ p90 | Top 10% of rounds |
| ≥ p75 | Upper quartile (75th–90th percentile) |
| ≥ p50 | Above the median (50th–75th percentile) |
| ≥ p25 | Below the median (25th–50th percentile) |
| < p25 | Bottom quartile |

### Formatting

- Round size, pre-money and post-money are **USD**: show them compactly with the currency,
  `$85.0M`, `$1.2B`. If the user gave a figure in another currency, do not convert it:
  say the benchmarks are USD-only and ask for the USD figure.
- `percent_sold_in_round` is a **fraction** of post-money: `0.21` is `21%`. It is the share of
  the company sold by value in the round, not cap-table dilution (option-pool changes are
  not in it). Say so the first time you show it.
- A `null` percentile shows as `—`.

## Dashboard

An interactive app beside the chat, like Carta's public Round Benchmarking tool: stage, sector,
region, metric and date filters, median cards, trend charts, a percentile table, a CSV download
and a box that places a figure against the market. Carta reads the data when the app opens, so
opening it again refreshes it.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-round-benchmarks", checkpoint_label="skill_started")` before opening the app. `<SERVER>` is the Carta MCP server name you call `view_static` on. Each run records each checkpoint at most once, and exactly one of `skill_finished` or `skill_failed`.

Open it with one call, on the Carta MCP server this session has. It takes no filters, because the
app holds every stage, sector and region and the user filters in it:

```
view_static({"name": "insights:view:round_benchmarks", "params": {}})
```

Use the view name exactly as written. Do not read the benchmark data first, and do not open the
app twice: it reads its own data.

| Result | What to do |
|---|---|
| The app opens | Say what is in it in one line, with the `data_as_of` date the result carries. Offer to answer a specific question in chat from the same data |
| The result says `partial` is true | Say a size limit cut off some cells, so the app is partial; the numbers it shows are right |
| `view_static` says the view is unknown or not available | Follow "When there is nothing to show" and stop. Do not retry, and do not build a page yourself |

If the user also asked a specific question ("what is the median Series B post-money?"), answer it
in chat from one `read_tool` read as above, after the app is open.

> **Checkpoint**: Call `skill_checkpoint` with `checkpoint_label="skill_finished"` and a one-line note of what was shown. On any stop before that, call it with `checkpoint_label="skill_failed"` and `notes="<one-line reason>"` instead. A stop that delivered neither the app nor an answer is a failure.

## When there is nothing to show

| Situation | What to do |
|---|---|
| `read_tool` or `view_static` says the command or view is unknown or not available | Round benchmarks are not available on this connector yet. Tell the user, and stop. Do not retry, and do not try `dwh__execute__query` or any other tool instead: the benchmark data is not reachable another way |
| A cell is `suppressed` | Fewer than `suppression_floor` rounds back it (quote the value from the response), so Carta withholds the figures. Say it is too thin to report, never zero, and offer to widen the window or drop a filter |
| `cells` is empty | No rounds matched. Name the filters and offer to widen them |
| The user asks about a non-US company or a non-USD round | Coverage is US-incorporated, USD-denominated primary rounds only. Say so rather than answering from US data |
| The user asks for a single company's round | These are aggregates only; no company is identifiable in them. Point to `carta-explore-data` for the firm's own investments |

## Voice

- Never show tool names, argument names, ids or the words "Snowflake" or "warehouse" in chat.

- Say "the median Series C post-money was {p50}", not "the p50 of round_post_money was {raw number}".
- Say what the peer set is in words: "Series A fintech rounds in the Bay Area, 2025".
