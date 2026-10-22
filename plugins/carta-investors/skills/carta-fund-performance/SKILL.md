---
name: carta-fund-performance
description: >
  Publishes a standalone Fund Performance live artifact for the user's Carta firm — a
  page that opens directly on the fund performance table and fetches its data live from
  Carta each time it is opened. Use when the user asks for a fund performance dashboard,
  page, or artifact they can keep open and re-share.
  Trigger phrases: "fund performance dashboard", "fund performance artifact",
  "build me a fund performance page", "publish a fund performance dashboard",
  "standalone fund performance view".
  Do NOT use to answer a performance question in chat ("what percentile is our TVPI?",
  "how does Fund II compare to peers?") — that is carta-portfolio-analytics-routing.
  Do NOT use for NAV or general fund financial queries — use carta-explore-data.
  Do NOT use for the full Carta Home surface (capital activity, schedule of investments,
  news) — use carta-home-build; this skill is the fund-performance page alone.
version: 1.0.0
model: inherit
allowed-tools:
  - Read
  - Artifact
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
<carta-plugin>carta-investors:6.107.1</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

# Fund Performance Dashboard

Publishes a self-contained live artifact showing one firm's fund performance. The
artifact resolves the firm context at runtime through `window.claude.use("mcp")`, so no
firm UUID or MCP server name is substituted at build time.

## What the artifact shows

| Section | Notes |
|---|---|
| Overview graph | Net IRR, TVPI or DPI per fund, quarter by quarter, each with a dashed peer-median (P50) line when the cohort has one — modelled on Carta Home's Fund Performance tile, reading the same measures as the table (LP net IRR, LP DPI, LP TVPI). A "Compare funds" legend shows or hides each fund with an eye toggle (up to five), starting on the 3 largest funds by NAV; filters pick the metric, the period (1Y / 3Y / All) and whether the peer median shows. Hidden when no fund has quarterly history |
| All-funds table | Fund name, Net IRR, TVPI, DPI and RVPI (LP only, as Carta's Fund Performance tab labels them), MOIC, Total value, NAV, Contributions, Distributions — top 50 funds by NAV, sortable by any column; a click anywhere on a row opens the fund |
| Per-fund detail view | KPI strip with a Net IRR callout (net to LPs against the fund's gross IRR, and the gap in percentage points), then one chart of the fund against its vintage cohort — P25–P75 shaded, P50 dashed, a Net IRR / TVPI / DPI / MOIC switch — with a line naming the fund's quartile; below, a table of the LP-only figures against the total fund, its TVPI, DPI and RVPI worked out from the dollar rows so each column reconciles; MOIC is Carta's |
| Fund switcher | The Schedule of Investments' "Fund" picker, listing the firm's funds: picking one opens its detail. On a fund, "← All funds" in place of the firm name returns to the list |

The page follows the Schedule of Investments layout: an "As of" month-end top right, the firm's name above the title,
dotted-underlined labels that show a definition on hover, and shimmer placeholders while
data loads.

Amounts render in each fund's own `FUND_REPORTING_CURRENCY`. A fund with no reporting
currency renders bare numbers — the artifact never assumes a currency.

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

Publish the rendered file with the Artifact tool. The artifact calls `fetch` (`dwh:execute:query`),
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
