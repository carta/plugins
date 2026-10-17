---
name: carta-lp-dashboard
description: >-
  Opens the user's own Carta LP portfolio dashboard (NAV, capital activity, TVPI/DPI/RVPI).
  LP users only, when they explicitly ask for their LP dashboard or LP portfolio. Not for
  GP/firm users or ambiguous queries; use carta-explore-data.
version: 1.0.0
model: inherit
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  # Carta MCP — registration prefix varies by host (Claude Code / Claude.ai / Cowork)
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__welcome
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  # Cowork
  - Artifact
  # Local execution — the find locates the script on remote plugin mounts
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-dashboard/scripts/render_artifact.py" *)
  # Interaction
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.88.2</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

# LP Dashboard Skill

This skill publishes or redeploys a persistent live artifact that fetches the LP's portfolio from Carta via `claude.use("mcp")` each time it is opened — no data is embedded. The page loads three sections through the `call_tool` gateway tool: summary, timeseries and quarterly.

## Metrics

Show TVPI, DPI and RVPI to LPs — whatever the GP's fund-performance sharing setting — and keep the amount KPIs, capital activity and fund table. **Never show IRR**, even when asked, and no ratio besides those three. The summary carries DPI and RVPI only per currency, in `totals_by_currency`; never add amounts or ratios up across currencies.

## Steps

### 1. Checks before building

Run both checks, and stay quiet about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session publish at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the connector name the page will call. Its confirmation call is `welcome`, which also verifies the Carta session is active.

Both sit in the **plugin's** `references/` directory — `${CLAUDE_PLUGIN_ROOT}/references/`. They are *not* under this skill's own `references/`. Read them by that exact path; don't search for them.

Store the `name` the connector gate resolves as `<CARTA_MCP_SERVER>`. Step 3 passes it to the render script and Step 4 puts it in the `capabilities.mcp` grant.

### 1b. Confirm this is an investor's login

This dashboard is for limited partners (LPs). Before the portfolio lookup, ask Carta who the user is — **once per request, never retried**:

```
mcp__<SERVER>__read_tool({"name": "lp__get__persona", "arguments": {}})
```

It returns `{"persona": …, "lp_portfolio_ids": [...]}`. Act on `persona`:

| `persona` | Do |
|---|---|
| `LP` | Continue to Step 2. Say nothing about the check. |
| `HYBRID` | Continue to Step 2. Say once that the dashboard shows the portfolio they hold as an investor. |
| `GP` | Stop. Tell them this dashboard shows an investor's own portfolio, and their login belongs to a fund manager — for their fund's data, try `carta-investors:carta-explore-data`. Return the `NEEDS_HUMAN` lines below. |
| `NONE` | Stop. Tell them: "No LP portfolios found on this account." If they expected some, they can check the Carta LP portal or ask their fund manager. Return the `NEEDS_HUMAN` lines below. |

```
NEEDS_HUMAN: this Carta login is not an LP
needs_human: true
```

If the call fails, read the error's `code`:
- `invalid_argument` with `field: "user_id"`, or a plain-text error whose body names `user_id` (for example `400 … {"user_id": "Staff users must specify a user_id."}`) — a Carta staff login, which looks up an LP by name. Skip this check and continue to Step 2.
- `unauthenticated` — their Carta session has ended: ask them to reconnect Carta, then stop with `NEEDS_HUMAN: the Carta session has ended` and `needs_human: true`.
- Anything else, including a plain-text reply that the command is not enabled — LP tools aren't turned on for this login yet. Say so and stop with `NEEDS_HUMAN: LP tools are not enabled for this Carta login` and `needs_human: true`.

After a `GP` or `NONE` answer, never go on to find a portfolio yourself — don't call the lookup, and don't query portfolio data with another tool or skill.

### 2. Resolve the LP portfolio

**An LP or HYBRID login** (Step 1b passed) never types its own name. List the portfolios this login holds:

```
mcp__<SERVER>__read_tool({"name": "lp_portfolio__lookup__portfolio", "arguments": {}})
```

**A staff login** (Step 1b skipped) searches by the partner name the user gave, or ask for it:

```
mcp__<SERVER>__read_tool({"name": "lp_portfolio__lookup__portfolio", "arguments": {"name": "<partner_name>"}})
```

Handle the result:
- **`result: "match"`** — take `candidates[0].portfolio_id` and `candidates[0].partner_name`, and go to Step 3.
- **`result: "ambiguous"`** — if the user gave a name and exactly one candidate's `partner_name` is that name, take it. Otherwise — including every no-name lookup — show them all and ask the user to pick. Never take the first one: candidates that share a name differ only by `fund_count`, so never choose between them yourself:
  ```
  Which portfolio?
    1. <partner_name> (<fund_count> funds)
    2. ...
  ```
  A candidate is a cross-firm portfolio, so one may hold funds at several firms. Take the chosen `portfolio_id` and `partner_name` and go to Step 3.
- **`result: "no_match"`** with no `name` sent — this login lists no portfolio of its own yet. Ask the user for the name on their LP portfolio and search by it.
- **`result: "no_match"`** after a name search — tell the user no portfolio matched and ask for a different name.

**Lookup budget — bounded, do not loop.** You get **at most 3 lookups in total** for one request, the no-name lookup included. After the third `no_match`, stop and return:

```
NEEDS_HUMAN: no LP portfolio found (tried: <each name searched, plus "own portfolios" if the no-name lookup ran>)
needs_human: true
```

These all count as attempts and never reset the budget:
- spelling variants, substrings, initials, or adding or dropping a suffix such as "LLC" or "Trust";
- adding a firm or fund name to the query;
- repeating a name already tried, or repeating the no-name lookup;
- switching to `carta-explore-data`, a warehouse query, or any other tool to find the portfolio.

A **401 or 403 is terminal**: stop at once and return `NEEDS_HUMAN: this Carta login cannot open an LP portfolio` with `needs_human: true`. Do not retry, and do not try another name.

### 3. Build the artifact HTML

**Never `Read` the template.** The render script fills it in and inlines Chart.js from the plugin's `vendor/chart.umd.min.js`, so neither the template nor the chart bundle enters context.

**3a.** Render. Run this on one line, with the script path exactly as written: `allowed-tools` pre-approves that exact command, so a shell variable or a `cd` in front of it makes the user approve it by hand.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-dashboard/scripts/render_artifact.py" --mcp-server "<CARTA_MCP_SERVER>" --portfolio-id "<portfolio_id>" --out lp-dashboard.html
```

The script prints the absolute output path. It exits non-zero on an unusable connector name, a portfolio id that is not a UUID, an output path outside the working directory, or a missing Chart.js bundle. Surface the error and stop; do not edit the HTML by hand.

Chart.js is inlined rather than linked because the runtime CSP blocks external scripts. A CDN link does not error — it blocks, and every chart stays blank.

### 4. Publish the artifact

Take the path the script printed, then look for an existing page:

```
Artifact({action: "list", scope: "mine"})
```

If an **LP Portfolio Dashboard** artifact is already published, keep its `url`. Then publish — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<path printed by render_artifact.py>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "LP Portfolio Dashboard",
  description: "LP portfolio dashboard — fund allocations, NAV trend, capital activity and quarterly movers, loaded live from Carta.",
  icon: "dashboard",
  label: "Refreshed for <partner_name>",
  capabilities: {
    mcp: { servers: [{ server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "welcome"] }] }
  }
})
```

The title must match the page's own `<title>`, which always wins in the gallery — a different one makes the lookup above miss and publishes a duplicate. Both tools must be in the grant, or every fetch rejects with `not_in_manifest`. Restate the whole `capabilities` object every time: a non-empty object replaces the stored grant.

### 5. Respond to the user

Give the user the URL and say the dashboard loads fresh data from Carta each time it's opened. Keep it brief.
