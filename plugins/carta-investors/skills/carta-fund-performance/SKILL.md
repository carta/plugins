---
name: carta-fund-performance
description: >
  Fund performance for a Carta firm. Publishes a standalone Fund Performance live
  artifact that fetches its data live from Carta each time it is opened, and answers
  peer-benchmark questions in chat: a fund's Net IRR, TVPI, MOIC or DPI against peer
  cohorts, with its percentile standing.
  Page triggers: "fund performance dashboard", "fund performance artifact",
  "build me a fund performance page", "standalone fund performance view".
  Chat triggers: "performance benchmark", "peer comparison", "fund percentile",
  "IRR vs peers", "how does my fund stack up", "what percentile is our TVPI?".
  A request for benchmarks specifically follows references/benchmarks.md.
  Do NOT use for cap table market benchmarks (option pool sizes, SAFE terms) — use
  carta-market-benchmarks in carta-cap-table. Do NOT use for NAV or general fund
  financial queries — use carta-explore-data. Do NOT use for the full Carta Home
  surface — use carta-home-build.
version: 1.1.0
model: inherit
allowed-tools:
  - Read
  - Artifact
  # Peer-benchmark answers in chat (references/benchmarks.md) query the warehouse through
  # whichever Carta connector prefix the host registers.
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  # Step 1: render the page (stamps the Carta Home link in).
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-performance/scripts/render-artifact.py" *)
  # Step 2, before republishing over an existing page: find the user's changes and carry
  # them over (references/keep-customizations.md).
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-performance/scripts/customizations.py" *)
  # Save the live page, and carry the user's changes into the rendered page in place.
  - Write
  - Edit
  # Ask about a change that collides with the new version — only then.
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.5.10</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

# Fund Performance

Two modes. Pick one from the request:

| The user wants | Mode |
|---|---|
| A fund performance dashboard, page or artifact to keep open and re-share | **Page** — Steps 1–3 below |
| An answer in chat on how a fund compares to its peers: benchmarks, percentile, "IRR vs peers", "how does Fund II stack up" | **Peer benchmarks in chat** — read `${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-performance/references/benchmarks.md` (this skill's own `references/`) and follow it from its own entry point, with the user's message as context. Do not render or publish the page for these |

When a message could be either ("show me fund performance vs peers"), answer the benchmark
question in chat first and offer the page.

## Page

Publishes a self-contained live artifact showing one firm's fund performance. The
artifact resolves the firm context at runtime through `window.claude.use("mcp")`, so no
firm UUID or MCP server name is substituted at build time.

## What the artifact shows

| Section | Notes |
|---|---|
| Overview graph | Net IRR, TVPI or DPI per fund, quarter by quarter, each with a dashed peer-median (P50) line when the cohort has one — modelled on Carta Home's Fund Performance tile, reading the same measures as the table (LP net IRR, LP DPI, LP TVPI). A "Compare funds" legend shows or hides each fund with an eye toggle (up to five), starting on the 3 largest funds by NAV; filters pick the metric, the period (1Y / 3Y / All) and whether the peer median shows. Hidden when no fund has quarterly history |
| All-funds table | Fund name, Net IRR, TVPI, DPI and RVPI (LP only, as Carta's Fund Performance tab labels them), MOIC, Total value, NAV, Contributions, Distributions, then the app's own fund-list columns: Vintage year, Partners (limited partners plus the general partner) and Total size (compact, one decimal: $88.2M) — top 50 funds by NAV, sortable by any column; a click anywhere on a row opens the fund. Net IRR shows two decimals, as the app does |
| Per-fund detail view | KPI strip with a Net IRR callout (net to LPs against the fund's gross IRR, and the gap in percentage points), then one chart of the fund against its vintage cohort — P25–P75 shaded, P50 dashed, a Net IRR / TVPI / DPI / MOIC switch — with a line naming the fund's quartile; below, a table of the LP-only figures against the total fund, its TVPI, DPI and RVPI worked out from the dollar rows so each column reconciles; MOIC is Carta's |
| Fund family view | Opens on **Fund family**: funds sharing a `FUND_FAMILY_ID` (`FUND_ADMIN.FUNDS`) are one row labelled with the family name; funds with no family stay as themselves. A "View" toggle (shown only when the firm has a family) switches to **Underlying funds**. The graph, fund switcher and detail page all work on the family. See "Fund families" below |
| Fund switcher | The Schedule of Investments' "Fund" picker, listing the firm's funds: picking one opens its detail. On a fund, "← All funds" in place of the firm name returns to the list |

The page follows the Schedule of Investments layout: an "As of" month-end top right, the firm's name above the title,
dotted-underlined labels that show a definition on hover, and shimmer placeholders while
data loads.

Amounts render in each fund's own `FUND_REPORTING_CURRENCY`. A fund with no reporting
currency renders bare numbers — the artifact never assumes a currency.

## Fund families

A family row is built from its funds' latest month-end rows in `AGGREGATE_FUND_METRICS` (that table keeps only the latest refresh, so history comes from the quarterly benchmark table, below):

- **Summed:** Committed capital (the list's Total size), Total value, NAV, Contributions, Distributions, Invested (cost basis), Partners and the LP-only dollar columns. Uncalled capital is committed minus contributions, so it is the sum too. A column any fund lacks is blank for the family, never a short total. A family's Vintage year is blank, as in the app: its funds have different ones.
- **Recomputed, never averaged:** LP TVPI, DPI and RVPI are the summed LP dollars over summed LP paid-in; MOIC is the funds' summed value (MOIC × cost of investments) over summed cost.
- **Net IRR:** IRRs can't be added or averaged, so the family shows Carta's own family Net IRR, the figure the app's fund list shows on the family row. The page makes one `fa:get:fund-irr` read with `family: true` on one member fund, as of the funds' latest month-end (today while that month is still running). If it fails, the family reads N/A with a note. The family's Net IRR by quarter is read the same way, one `fa:get:fund-irr` read per quarter-end by the family's Carta id (four at a time, newest 40 quarters), and drawn on the family's own page once it arrives; the overview graph has no Net IRR line for a family.
- **Gross IRR:** not shown for a family; gross IRRs can't be added or averaged either.
- **LP MOIC:** blank for a family; it has no published formula to rebuild from the summed columns.
- **Quarterly series (TVPI and DPI):** each fund's own quarterly LP TVPI and DPI (`TEMPORAL_FUND_COHORT_BENCHMARKS`), combined at each finished quarter weighted by that fund's LP paid-in capital at the quarter-end (`PARTNER_MONTHLY_NAV_CALCULATIONS`, LP rows, `CUMULATIVE_TOTAL_CONTRIBUTIONS`): the pooled value over the pooled paid-in. A fund with no paid-in yet adds nothing; a fund with paid-in but no ratio or weight leaves that quarter empty, so a fund is never silently left out. Rows are dated by quarter-end, as the warehouse dates its own, so a family shares the overview graph's axis with the funds.
- **MOIC by quarter:** none for a family; it needs each fund's cost by quarter, which the warehouse does not keep. Its current MOIC is in the table.
- **Peer benchmark:** percentiles can't be merged across cohorts, so the family uses one fund's cohort: the earliest vintage (larger fund on a tie). The chart names it.
- **Currency:** a family is combined only when every fund reports the same, non-empty `FUND_REPORTING_CURRENCY`. Different currencies, or any fund (even all of them) with none, leave the family as its funds, listed separately with a note.

## Step 1 — Render the page

Run this on one line, with the path exactly as written and quoted — do not search for the
script. `<CWD>` is the session's current directory:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-performance/scripts/render-artifact.py" "<CWD>/fund-performance.html"
```

When Carta Home is building this page, it gives you its own URL. Append
`--home-url "<carta_home_url>"` so the page's "Back to Home" link points there. Without it
the link stays hidden.

The script prints the absolute path it wrote. If it fails, show the error and stop. Never
publish the template itself: its Home link is a placeholder.

## Step 2 — Publish the artifact

Publish the rendered file with the Artifact tool. The artifact calls `fetch` (`dwh:execute:query`, plus `fa:get:fund-irr` for a fund family's Net IRR),
`list_contexts` and `set_context`, so grant exactly those, plus `track_ui_event` for the page's usage analytics. Set `server` to the viewer's
Carta connector display name from `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md`
(the plugin's `references/`, not this skill's); the page looks that name up at runtime.

```python
Artifact(
    file_path="<path the render script printed>",
    favicon="📈",
    title="Fund Performance",
    description="Live fund performance dashboard — IRR, TVPI, DPI and MOIC against peer benchmarks.",
    capabilities={"mcp": {"servers": [{"server": "<carta_connector_name>", "tools": ["fetch", "list_contexts", "set_context", "track_ui_event"]}]}},
)
```

To update a dashboard published earlier, pass `url="<existing artifact URL>"` so the
link stays the same. Without it a second artifact is created.

**Before republishing over an existing page, keep the user's changes.** Users
customize this dashboard by asking Claude to edit it, and republishing a fresh render would
replace those edits unless they are carried over — without asking, except about a change
that collides with the new version. Follow `${CLAUDE_PLUGIN_ROOT}/references/keep-customizations.md` (the
plugin's `references/`, not this skill's; read it by that exact path, don't search for it)
with:

- page "your Fund Performance dashboard"
- live file `<CWD>/fund-performance.live.html`
- script `${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-performance/scripts/customizations.py`
- new build: the file Step 1 rendered — pass its path straight to `plan`

When `plan` reads `unmodified`, publish the rendered file as above. When there are changes
to carry over, carry them into the rendered file itself and publish it with the same call.
It is written by the script: change it in place with `Edit`, never `Read` + `Write` — the
page has lines far longer than `Read` returns. When the reference has you keep the user's
own page instead, publish the `.rebased.html` file `rebase` writes, with the same call.
When you respond (Step 3), end with the reference's summary of what was kept — or, when
Carta Home asked for it, return those lines with the URL instead of printing them.

## Step 3 — Respond

Say in one sentence that the dashboard is ready, and that clicking a fund opens its
chart against its peers. Do not restate the metrics.

## Error handling

The artifact handles these itself — no action needed in the skill:

- **No Carta MCP connected** → the page says live data isn't available in this view.
- **No fund data returned** → the page says no performance data is available.
- **NULL benchmark percentiles** → the charts show the funds alone and say there is no
  peer benchmark yet; nothing is drawn in place of missing data.
- **The current, unfinished month** → the As of date reads "month to date", and those
  figures stay out of the fund's chart.

## File structure

```
carta-fund-performance/
  SKILL.md
  references/
    artifact.html     ← self-contained page: inline Chart.js, CSS and JS
    benchmarks.md     ← peer-benchmark answers in chat: query, percentile bands, presentation
  scripts/
    customizations.py  ← finds what a user changed on their published page
    render-artifact.py ← stamps the Carta Home link into the page
```

`artifact.html` carries a baseline of itself on its last line, so a later republish can
tell what the user changed. After editing the page, restamp it from the repo root —
`test_fund_performance_baseline.py` fails until you do:

```
uv run plugins/carta-investors/skills/carta-fund-performance/scripts/customizations.py stamp plugins/carta-investors/skills/carta-fund-performance/references/artifact.html
```

The CSP in the artifact runtime allows no external host except Google Fonts, which serves
the Inter stylesheet. Everything else is inlined, and nothing may be converted to a CDN
reference.
