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
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-fund-performance/scripts/render-artifact.py" *)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.70.4</carta-plugin>

# Fund Performance Dashboard

Publishes a self-contained live artifact showing one firm's fund performance. The
artifact resolves the firm context at runtime through `window.claude.use("mcp")`, so no
firm UUID or MCP server name is substituted at build time.

## What the artifact shows

| Section | Notes |
|---|---|
| All-funds table | Fund name, Net IRR, TVPI, DPI, MOIC, NAV, Total Value — sortable, top 50 funds by NAV |
| Per-fund detail view | Time-series charts for TVPI, DPI, Net IRR and MOIC against peer benchmark percentiles (P25/P50/P75/P90) |
| Fund selector | Dropdown on the fund title, to switch funds without returning to the list |

Navigation: list view → click a fund row → detail view → "← Back to all funds".

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
`list_contexts` and `set_context`, so grant exactly those. Set `server` to the viewer's
Carta connector display name from `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md`
(the plugin's `references/`, not this skill's); the page looks that name up at runtime.

```python
Artifact(
    file_path="<path the render script printed>",
    favicon="📈",
    title="Fund Performance",
    description="Live fund performance dashboard — IRR, TVPI, DPI and MOIC against peer benchmarks.",
    capabilities={"mcp": {"servers": [{"server": "<carta_connector_name>", "tools": ["fetch", "list_contexts", "set_context"]}]}},
)
```

To update a dashboard published earlier, pass `url="<existing artifact URL>"` so the
link stays the same. Without it a second artifact is created.

## Step 3 — Respond

Say in one sentence that the dashboard is ready, and that clicking a fund opens its
charts. Do not restate the metrics.

## Error handling

The artifact handles these itself — no action needed in the skill:

- **No Carta MCP connected** → the page shows a "Connect Carta" prompt.
- **No fund data returned** → the page shows an error with a Retry button.
- **NULL benchmark percentiles** → illustrative trajectories are drawn, labelled
  "Illustrative benchmark data".

## File structure

```
carta-fund-performance/
  SKILL.md
  references/
    artifact.html     ← self-contained page: inline Chart.js, CSS and JS
  scripts/
    render-artifact.py ← stamps the Carta Home link into the page
```

The CSP in the artifact runtime allows no external script, style or connect host, so
everything is inlined and nothing may be converted to a CDN reference.
