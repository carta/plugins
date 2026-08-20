---
name: carta-home-build
description: >
  Builds or rebuilds the Carta Home live artifact — a Cowork dashboard home page that works
  for any Carta firm. Shows a live Schedule of Investments, Fund Performance benchmarks,
  P&L (from STATEMENT_OF_OPS), Balance Sheet (from MONTHLY_NAV_CALCULATIONS), LP Reporting,
  Portfolio Valuations (top holdings by MOIC), ManCo expense actuals by category,
  Form ADV regulatory AUM, and a Skill Directory with one-click copyable prompts.
  The artifact auto-detects the active firm from the Carta MCP context — no hardcoded
  firm name needed. Use this skill whenever the user asks to "build the carta home artifact",
  "rebuild carta home", "set up the carta home page", "deploy carta home", or "restore the
  carta home dashboard".
model: sonnet
allowed-tools:
  - Bash(uv run *build_artifact.py *)
  - Bash(find ~ -name "build_artifact.py"*)
  - Bash(find /sessions -name "build_artifact.py"*)
  - Bash(dirname *)
  - mcp__cowork__list_artifacts
  - mcp__cowork__create_artifact
  - mcp__cowork__update_artifact
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

# Carta Home — Build / Redeploy

Deploys the `carta-home` Cowork live artifact. It is **assembled** from source parts in
this skill's `resources/` directory (template + CSS + config + app JS) by
`scripts/build_artifact.py`, which also substitutes this session's Carta MCP server ID.
You never need to read the assembled HTML — see "Source layout" below.

## What the artifact does

- **Schedule of Investments (SOI)** — live portfolio table with fund-level totals, gain/loss
  coloring, and company drill-down. Pulled from `FUND_ADMIN.AGGREGATE_INVESTMENTS`.
- **Fund Performance** — Net IRR, TVPI, DPI charts vs. peer benchmarks. Pulled from
  `FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS` — queries all funds for the active firm
  automatically (no hardcoded fund names).
- **P&L Card** — Unrealized gain/loss and total expenses from `FUND_ADMIN.STATEMENT_OF_OPS`
  (pre-aggregated, fast — no journal entry scan).
- **Balance Sheet Card** — Portfolio value, LP NAV, GP NAV, Total NAV from
  `FUND_ADMIN.MONTHLY_NAV_CALCULATIONS` with `IS_FIRM_ROLLUP = TRUE` (latest month).
- **LP Reporting & Relations** — links to tear sheet downloads, LP documents, and LP dashboard.
- **Valuations** — top 5 holdings by MOIC from `FUND_ADMIN.AGGREGATE_INVESTMENTS`. Shows
  company name, FMV, and MOIC with color coding (green ≥ 2x, blue ≥ 1x, red < 1x).
- **ManCo & Budgeting** — YTD expense actuals by category from `FUND_ADMIN.STATEMENT_OF_OPS`.
  Shows the top 5 categories by spend (management fees, legal, fund admin, audit, tax prep,
  payroll, software, other) with a total footer. Run button triggers the budget vs actuals skill.
- **Compliance (Form ADV)** — Discretionary AUM, Non-discretionary AUM, and Total Regulatory
  AUM. Tries `FUND_ADMIN.FORM_ADV_FUND_DETAIL` first; falls back to `FUND_ADMIN.MONTHLY_NAV_CALCULATIONS`
  total NAV as a proxy if that table is unavailable (adds a footnote when using the fallback).
- **Skill Directory** — categorized index of carta-investors skills with copyable prompts.
  Prompts auto-substitute the active firm name. Every category shows to every role.
  **Entitlement-gated:** `fetchUserEnrichment()` calls `get_current_user`, logs the full
  payload to the debug console (visible to the LLM client), and reads two product flags:
  - **Fund forecasting** (a single skill inside Fund modeling) — needs `has_tactyc`
  - **ManCo & budgeting** (the whole category) — needs `has_active_manco`

  `requires` sits on a category or on one skill. A category whose every skill is gated
  out hides as well. A gated item hides only when its flag is an explicit `false`. Anything
  else — enrichment unavailable, the call failed, the key absent or `null`, a staff account
  whose enrichment is stripped — shows it. Seeing too much beats seeing nothing.
- **Firm auto-detection** — calls `list_contexts` without a firm name filter; extracts the
  active firm UUID and name from the response. All DWH queries use `FIRM_ID = '${firmId}'`
  dynamically — the artifact works for any Carta firm with no code changes.
- **Capital Activity** (`resources/app/capital-activity.js`) — pinned cards for active capital
  calls and distributions from `fa:list:active-capital-activity`, with a detail overlay
  listing each LP partner's amount, status, and date — paid date once paid, days late while
  outstanding. On a capital call, unpaid partners get **Send Reminder** (**Resend**, over the
  last-reminded date, once one has gone out), which confirms and then sends the email via
  `fa:send:capital-call-reminder`.

## MCP tools required inside the artifact

The artifact calls these tools at runtime via `window.cowork.callMcpTool()`. The tool names
use the format `mcp__<SERVER_ID>__<tool>` where `<SERVER_ID>` is the UUID of the user's
Carta MCP connector — this is the `{{CARTA_MCP_ID}}` placeholder that the build script fills in.

- `mcp__{{CARTA_MCP_ID}}__list_contexts` — auto-detects the active firm
- `mcp__{{CARTA_MCP_ID}}__set_context` — activates the firm's DWH session
- `mcp__{{CARTA_MCP_ID}}__fetch` — all DWH queries (SOI, P&L, BS, benchmarks, tear sheets)
- `mcp__{{CARTA_MCP_ID}}__get_current_user` — signed-in user's profile; `has_tactyc` and
  `has_active_manco` gate their Skill Directory categories (see `fetchUserEnrichment`)
- `mcp__{{CARTA_MCP_ID}}__mutate` — write operations; used by the Capital Activity detail
  overlay's reminder actions (`fa:send:capital-call-reminder`)

## Source layout — the artifact is BUILT, not hand-edited

The deployed artifact is assembled from source parts in `resources/` by
`scripts/build_artifact.py`. **Do NOT read or edit the assembled HTML** — you never
need the full file in context. Edit the small source file for what you're changing:

| File | What it holds | Edit it to… |
|------|---------------|-------------|
| `resources/carta-home.config.js` | `DIR_CATEGORIES` + per-category `requires` | change which skills/categories show, or their entitlement gate |
| `resources/carta-home.app.js` | shared/core runtime logic (`_mcp`, format helpers, `fetchLiveData` bootstrap, SOI, Fund Performance, Skill Directory, tour) | change behavior / data fetching for anything not yet split into its own file below |
| `resources/app/capital-activity.js` | Capital activity cards + detail overlay (fetch/render/dismiss) | change the capital call / distribution cards or their detail modal |
| `resources/app/version-check.js` | update banner: reads the published version, compares, renders/dismisses | change the banner copy or when it appears |
| `../../.claude-plugin/skill-versions.json` | this skill's `version` + release `headline` | **bump on every user-visible change** — see Versioning |
| `resources/carta-home.css` | styles (Ink tokens) | change appearance |
| `resources/carta-home.template.html` | HTML skeleton + `{{CARTA_MCP_ID}}` + injection markers | change page structure |
| `resources/carta-home.tracker.js` | inlined `@carta/mcp-ui-tracker` browser bundle (`window.mcpUiTracker`) | re-run the library's `build:browser` and re-copy the output if the tracker source ever changes |

App-layer JS is split across multiple files (see `APP_JS_PARTS` in
`build_artifact.py`) but still assembles into a single classic (non-module)
`<script>` tag — no bundler, no runtime `import`/`export`. New feature files
just get appended to `APP_JS_PARTS` and concatenated in order; a file's header
comment documents which shared helpers it depends on from elsewhere in the
bundle.

The build inlines `carta-home.css` → `/* __CARTA_HOME_CSS__ */`, `carta-home.tracker.js`
→ `/* __CARTA_HOME_TRACKER_JS__ */`, `carta-home.config.js` → `/* __CARTA_HOME_CONFIG_JS__ */`,
and the concatenated `APP_JS_PARTS` → `/* __CARTA_HOME_APP_JS__ */`, then substitutes
`{{CARTA_MCP_ID}}`, producing one self-contained HTML. `{{FIRM}}` is a **runtime**
placeholder the artifact fills from `list_contexts` — leave it alone.

## Versioning — bump this skill's entry when you change the artifact

A deployed artifact is a **frozen copy**. Nothing updates it in place, and the sandbox
sets `connect-src 'none'` so it cannot fetch its own release metadata. The only way an
existing user learns a newer build exists is the update banner, which compares the
version baked in at build time against the one carta-mcp reads from the published
`carta/plugins` tree (`plugin:get:version`, called through the `fetch` tool the artifact
already has — no `mcp_tools` change needed).

The version lives in the **plugin's** registry, keyed by this skill:

```jsonc
// plugins/carta-investors/.claude-plugin/skill-versions.json
{ "carta-home-build": { "version": "1.0.0", "headline": "…" } }
```

It sits there rather than beside the skill because carta-mcp reads it from the published
mirror, and a skill that has not opted into publishing never reaches that mirror —
whereas `.claude-plugin/` is plugin-level metadata and is always published.

The registry entry is the **only** place this number lives. This skill's frontmatter
carries no `version:` on purpose: nothing cross-checks the two, so a second copy just
drifts silently every time the artifact ships. `validate-skill-frontmatter.py` warns
about the absence — that warning is expected here, and re-adding the field to silence it
would reintroduce the drift.

**This is not the plugin's own version.** `carta-investors` publishes several releases a
day across ~30 skills; the banner is keyed to this skill's number so it fires only when
*this artifact* changed.

So: **change anything under `resources/`, bump this skill's entry in the same PR.** CI
enforces it (`.forgejo/scripts/validate-artifact-version-bump.py`).

| Bump | When | User sees |
|------|------|-----------|
| **patch** | **the default** — copy tweak, style nudge, refactor, bug fix | nothing |
| **minor** | new card, new data, changed behaviour a user would want to know about | banner |
| **major** | rebuild genuinely required | banner |

**Start at patch and stay there unless you can name what the user gains.** A banner
interrupts every fund CFO running Carta Home, and one raised for a change they cannot
see teaches them to dismiss the next one unread — including the one that mattered. If
you cannot write a headline a customer would care about, that is the signal: ship patch.

Escalating is therefore a deliberate act with a cost attached: minor and major demand a
fresh, non-empty `headline`, and CI rejects the bump without one. The headline *is* the
justification — there is no separate reason field here, because the sentence proving the
bump was worth it is the same sentence the user reads.

`headline` is one line describing what changed, shown in the banner — it is the only
release-comms surface this artifact has, so write it for the fund CFO reading it, not
for the changelog. CI rejects a minor/major bump whose headline is empty or still
describes the previous release.

Two things that follow from the published tree being the source of truth:

- The banner appears only once the change is **published to `carta/plugins`**, not when
  it merges here.
- Internal builds run **ahead** of published, so you cannot dogfood the banner from a
  local build — it correctly stays silent when your version is newer. To see it, stub
  the command's response or temporarily lower your local entry.

## Analytics

New interactive elements: call `trackHome(action, elementId)` (top of the handler),
IDs as `CartaHome.<Area>.<Specific>` (e.g. `CartaHome.Tour.Start`) — skip sort clicks,
keystrokes, dropdown changes. If `@carta/mcp-ui-tracker`'s bundle output changes
upstream, rebuild it (`build:browser`) and overwrite `resources/carta-home.tracker.js`.

## Deploy steps

### Step 0: Cowork preflight + Carta MCP server ID

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-0-cowork.md` and run **Gate A + Gate B**. This is a live artifact — the rendered HTML calls Carta at runtime via `window.cowork.callMcpTool`, which requires both Cowork and a UUID-form Carta tool prefix.

**Gate B discovery:** Scan for any tool matching `mcp__<UUID>__list_contexts` where `<UUID>` is the 8-4-4-4-12 hex format. Store the UUID as `CARTA_MCP_ID`.

### Step 1: Build the self-contained artifact (no need to read any HTML)

Run the build script — it assembles CSS + config + app into one file and substitutes the
server id. The script lives in **this skill's own `scripts/` directory**.

> **Path — do NOT rely on `${CLAUDE_PLUGIN_ROOT}` in bash.** In the Cowork sandbox that env
> var is empty, so `uv run "${CLAUDE_PLUGIN_ROOT}/…"` resolves to a broken path. Use the
> **base directory reported for this skill when it loaded** (it ends in
> `/skills/carta-home-build`) as `<SKILL_DIR>`. If you don't have it, resolve it once with a
> scoped `find` (NOT `find /`):
> ```
> SKILL_DIR="$(dirname "$(dirname "$(find /sessions "$HOME" -type f -path '*/carta-home-build/scripts/build_artifact.py' 2>/dev/null | head -1)")")"
> ```

```
uv run "<SKILL_DIR>/scripts/build_artifact.py" \
  --mcp-id <CARTA_MCP_ID> \
  --out <outputs-directory>/carta-home-updated.html
```

`<SKILL_DIR>` is this skill's base directory — e.g. in Cowork
`/sessions/<name>/mnt/.remote-plugins/plugin_<id>/skills/carta-home-build`, in Claude Code
`${CLAUDE_PLUGIN_ROOT}/skills/carta-home-build`.

### Step 2: Check whether the artifact already exists

Call `list_artifacts`. If an artifact with id `carta-home` is present, use
`update_artifact`. Otherwise use `create_artifact`.

### Step 3: Create or update the artifact

**mcp_tools list** — use the actual resolved tool names (with real UUID):

```
mcp__<CARTA_MCP_ID>__list_contexts
mcp__<CARTA_MCP_ID>__set_context
mcp__<CARTA_MCP_ID>__fetch
mcp__<CARTA_MCP_ID>__get_current_user
mcp__<CARTA_MCP_ID>__mutate
mcp__<CARTA_MCP_ID>__call_tool
```

> The artifact sandbox only permits tools listed in `mcp_tools`. `get_current_user`
> **must** be included or `fetchUserEnrichment()` fails silently — the debug log never
> prints and the Skill Directory falls back to showing all categories. `mutate` enables
> write operations, needed for the Capital Activity reminder actions. `call_tool` is the
> gateway dispatcher the Plugin news live content cards use to reach
> `marketing__list__content` / `marketing__get__asset_data`
> (`resources/app/live-content.js`); without it those cards fall back to the static
> defaults. The marketing commands only exist on some environments, so a missing command
> degrades gracefully to the static cards.

**Create (first time):**
```
create_artifact({
  id: "carta-home",
  title: "Carta Home",
  description: "Dashboard home — SOI, Fund Performance, P&L, Balance Sheet, LP Reporting, Valuations, ManCo Actuals, Form ADV, and Skill Directory. Works for any Carta firm.",
  html_path: "<outputs-directory>/carta-home-updated.html",
  mcp_tools: [
    "mcp__<CARTA_MCP_ID>__list_contexts",
    "mcp__<CARTA_MCP_ID>__set_context",
    "mcp__<CARTA_MCP_ID>__fetch",
    "mcp__<CARTA_MCP_ID>__get_current_user",
    "mcp__<CARTA_MCP_ID>__mutate",
    "mcp__<CARTA_MCP_ID>__call_tool"
  ]
})
```

**Update (already exists):**
```
update_artifact({
  id: "carta-home",
  html_path: "<outputs-directory>/carta-home-updated.html",
  update_summary: "Redeployed from skill bundle; entitlement-gated Skill Directory from get_current_user",
  mcp_tools: [
    "mcp__<CARTA_MCP_ID>__list_contexts",
    "mcp__<CARTA_MCP_ID>__set_context",
    "mcp__<CARTA_MCP_ID>__fetch",
    "mcp__<CARTA_MCP_ID>__get_current_user",
    "mcp__<CARTA_MCP_ID>__mutate",
    "mcp__<CARTA_MCP_ID>__call_tool"
  ]
})
```

### Step 4: Validate

Open the artifact from Cowork's artifacts panel and check that it displays fund data for
the active firm without errors — SOI rows, Fund Performance charts, and the P&L/Balance
Sheet cards should all populate.

### Step 5: Confirm

Tell the user the artifact is live and they can open it from the artifacts panel.
The artifact will auto-detect whichever firm they have active in their Carta MCP context.

## If something fails

- **DWH query timeout** — this happens inside the deployed artifact, not in this build
  session. Ask the user to reopen the artifact and retry; if it still times out, the firm
  may have an unusually large portfolio or there's an underlying DWH issue, so ask the user
  to confirm in their Carta MCP session that the firm resolves correctly before retrying.
- **Cowork sandbox reports a permission error calling an MCP tool** — the artifact was
  created or updated with an incomplete `mcp_tools` list. Compare it against the complete
  list in Step 3 and re-issue `create_artifact`/`update_artifact` with every entry.
- **Firm context unavailable inside the artifact** — also a runtime issue, not something
  this build session can query directly. Go back to Step 0 to reconfirm the Carta MCP
  server ID used at build time, and ask the user to confirm their Carta MCP connector has
  an active firm in context before redeploying.

## Related skills

The artifact's SOI, P&L, and Fund Performance cards surface the same underlying data as
`carta-explore-data` (ad-hoc DWH queries) and `carta-soi` (dedicated SOI artifact). Routing
stays clean because this skill only triggers on explicit build/deploy/redeploy requests for
the Carta Home dashboard as a whole, not on requests for one of those cards in isolation.

## Data sources (for reference)

| Card | DWH Table | Notes |
|------|-----------|-------|
| SOI | `FUND_ADMIN.AGGREGATE_INVESTMENTS` + `FUND_ADMIN.FUNDS` | Joined on FUND_UUID |
| Fund Performance | `FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS` | All funds for the firm, ≥ 2021-06-01 |
| P&L | `FUND_ADMIN.STATEMENT_OF_OPS` | Pre-aggregated per-firm; no journal scan |
| Balance Sheet | `FUND_ADMIN.MONTHLY_NAV_CALCULATIONS` | IS_FIRM_ROLLUP = TRUE, latest month |
| Tear Sheets | `FUND_ADMIN.AGGREGATE_INVESTMENTS` + `FUND_ADMIN.CORPORATION_BASIC_INFO_V2` | Company list |
| 409A | `FUND_ADMIN.IRC409A_VALUE` + `FUND_ADMIN.CORPORATION_BASIC_INFO_V2` | Latest valuation per company |
| Deal IRR | `FUND_ADMIN.TEMPORAL_DEAL_IRR` | Latest per ISSUER_NAME |
| Valuations | `FUND_ADMIN.AGGREGATE_INVESTMENTS` | Top 5 by MOIC; HAVING COST > 0 to exclude zero-cost rows |
| ManCo Actuals | `FUND_ADMIN.STATEMENT_OF_OPS` | Per-category expense breakdown; top 5 by spend |
| Form ADV AUM | `FUND_ADMIN.FORM_ADV_FUND_DETAIL` (primary) / `FUND_ADMIN.MONTHLY_NAV_CALCULATIONS` (fallback) | Discretionary + non-discretionary + total; falls back to total NAV if form ADV table unavailable |
| Capital Activity | none — `fa:list:active-capital-activity` + `fa:list:capital-activity-partner` | Active capital calls/distributions + per-partner detail; the row `id`/`fund_uuid` feed the reminder `mutate` call |

## Notes

- `build_artifact.py` produces a complete, self-contained Cowork live artifact — CSS + config
  + app inlined, base64-encoded fonts and logo, no external CDNs except Chart.js from
  cdn.jsdelivr.net. (Assemble via the build script; the source `carta-home.css` /
  `carta-home.app.js` are injected — the template on its own is intentionally unstyled.)
- The artifact supports **any Carta firm** — it calls `list_contexts` without a firm_name
  filter and extracts the active firm automatically.
- Skill directory prompts use `{{FIRM}}` internally and are replaced at runtime with the
  detected firm name.
- If `update_artifact` returns a read-only error (artifact was shared from another session),
  fall back to `create_artifact` with id `carta-home-v2`.
- To change the artifact, edit the relevant source file under `resources/` (see the
  source-layout table above — includes `resources/app/*.js` for features already split out),
  then re-run `build_artifact.py`. Never hand-edit the assembled `carta-home-updated.html`.
