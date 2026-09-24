---
name: carta-home-build
description: >
  Builds or rebuilds the Carta Home live artifact — a Cowork dashboard home page that works
  for any Carta firm. Summary cards for Schedule of Investments, Fund Performance, P&L,
  Balance Sheet, LP Reporting, Portfolio Valuations, ManCo actuals and Form ADV, plus a
  Skill Directory of copyable prompts. Auto-detects the active firm from the Carta MCP
  context. Use whenever the user asks to "build the carta home artifact", "rebuild carta
  home", "set up the carta home page", or "deploy carta home". Do NOT use it to build or
  change one dashboard: a Schedule of Investments is carta-soi, a fund performance page is
  carta-fund-performance. For a company's cap table use carta-cap-table's
  carta-captable-home-build; for a CRM home use carta-crm's carta-crm-home-build.
model: sonnet
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  # Carta MCP — the connector check's observed call, the entitlement read, and the firm
  # resolution passed down to the dashboard skills.
  # Prefix-agnostic so the grant holds whichever form the host registers.
  - mcp__*carta*__welcome
  - mcp__*Carta*__welcome
  - mcp__*carta*__get_current_user
  - mcp__*Carta*__get_current_user
  # Resolves the firm the published title names, and the firm handed to the
  # dashboard skills so the fan-out doesn't re-ask.
  - mcp__*carta*__list_contexts
  - mcp__*Carta*__list_contexts
  # The dashboard fan-out (Step 5). A skill that isn't installed is skipped.
  - Skill
  - AskUserQuestion
  - Bash(uv run *build_artifact.py *)
  - Bash(find ~ -name "build_artifact.py"*)
  - Bash(find /sessions -name "build_artifact.py"*)
  - Bash(dirname *)
  - Artifact
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.40.1</carta-plugin>

# Carta Home — Build / Redeploy

Deploys the `carta-home` live artifact, published as **`Carta Home - <firm>`**. It is
**assembled** from source parts in this skill's `resources/` directory (template + CSS +
config + app JS) by `scripts/build_artifact.py`, which also substitutes this session's
Carta connector name and the firm the title names. You never need to read the assembled
HTML — see "Source layout" below.

The firm reaches the title through the build, because the published artifact takes its name
from the page's own `<title>` tag. Nothing else about the bundle is firm-specific: the body
still detects whichever firm is active at open time. One artifact per firm, so each has its
own sidebar tile.

## What the artifact does

- **Schedule of Investments (SOI)** — fund-level summary of the top 3 funds by value, with
  gain/loss coloring. Pulled from `FUND_ADMIN.AGGREGATE_INVESTMENTS`. The card footer
  launches the standalone SOI dashboard; home holds no holdings table of its own.
- **Fund Performance** — Net IRR, TVPI, DPI summary chart vs. peer benchmarks. Pulled from
  `FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS` — queries all funds for the active firm
  automatically (no hardcoded fund names). When that table has no qualifying rows for
  the firm, the card falls back to `FUND_ADMIN.AGGREGATE_FUND_METRICS` and previews each
  fund's Total Value (per-fund currency) with a "no benchmark trend" note, instead of
  rendering blank. IRR/TVPI/DPI are near-always null for those firms, so Total Value is
  what the card shows. The card footer launches the standalone Fund Performance dashboard.
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
  last-reminded date, once one has gone out), which previews and then sends the email via
  `fa:send:capital-call-reminder`. Rows with `email_notice_enabled: false` show a muted
  **Email disabled** and no menu — the backend drops those sends silently. **Remind investors**
  in the summary row batches the same send: a selection table of the remindable investors (all
  checked to start), then a preview with a picker over each one's own email. One entry per
  interest group, since the backend collapses a group's rows into a single email. The preview
  is the confirmation: snoozing it means the next click sends, and a sent batch reads
  **Sent just now** for 24h (`caBulkRemindedAt`).

## Dashboard launchers

Two of the home cards are **summaries that link out**, not full surfaces. The full
Schedule of Investments and Fund Performance experiences each live in their own standalone
artifact, published by their own skill, so there is exactly one implementation of each.

`DASHBOARDS` in `resources/carta-home.config.js` is the registry. Each entry has:

| Field | Purpose |
|---|---|
| `key` | matches the `--dashboard-url <key>=<url>` passed at build time |
| `footerId` | the card footer element the launcher renders into |
| `prompt` | **the contract** — copied into chat when no URL was baked in |
| `label` | the launcher's visible text |
| `buildSkill` | build-time only: candidates Step 5 fans out to, in preference order. Optional. |

**`prompt` is the contract, and `buildSkill` follows it.** The same sentence routes to
whichever skill owns that dashboard in the current install — `carta-soi` here, and
`carta-portfolio-analytics-routing` in the published `carta/plugins` tree, where `carta-soi`
does not exist. `buildSkill` lists both so the build-time fan-out reaches the same owner the
prompt would: Step 5 takes the first candidate that resolves. Home never needs to know which.

**Home publishes before its dashboards exist.** It goes out with each launcher marked as
building, the fan-out runs, then home redeploys over itself with the real links — a
redeploy reaches viewers who already have it open. Home is published first because a
published artifact surfaces itself, so publishing it last would land the viewer on a
dashboard instead.

**Degradation is automatic.** A `buildSkill` whose every candidate is absent or unavailable
is skipped in Step 5, so no `--dashboard-url` reaches that key, so the tile renders its
prompt in the same popover every other run button uses. There is no separate public/internal branch
and no error state — a dashboard that could not be published simply reverts to the copyable
prompt. Adding a dashboard later is one registry entry plus its skill.

## MCP tools required inside the artifact

The artifact resolves the runtime bridge once with `await claude.use("mcp")`, then calls
`mcp.callTool(CARTA_MCP_SERVER, "<tool>", args)`. `CARTA_MCP_SERVER` is the Carta
connector's **display name** — the `{{CARTA_MCP_SERVER}}` placeholder the build script
fills in. The runtime addresses connectors by display name only, never by a UUID.

Every tool below must appear in the publish call's `capabilities.mcp` grant, or the call
rejects with `not_in_manifest`:

- `welcome` — re-initializes an expired MCP session
- `list_contexts` — auto-detects the active firm
- `set_context` — activates the firm's DWH session
- `fetch` — all DWH queries (SOI, P&L, BS, benchmarks, tear sheets)
- `get_current_user` — signed-in user's profile; `has_tactyc` and `has_active_manco` gate
  their Skill Directory categories (see `fetchUserEnrichment`)
- `mutate` — the legacy write dispatcher, granted as a fallback; nothing in `resources/`
  calls it
- `call_tool` — the gateway dispatcher, carrying both the Capital Activity reminder sends
  (`fa__send__capital-call-reminder`) and the Plugin news live-content cards

## Source layout — the artifact is BUILT, not hand-edited

The deployed artifact is assembled from source parts in `resources/` by
`scripts/build_artifact.py`. **Do NOT read or edit the assembled HTML** — you never
need the full file in context. Edit the small source file for what you're changing:

| File | What it holds | Edit it to… |
|------|---------------|-------------|
| `resources/carta-home.config.js` | `DIR_CATEGORIES` + per-category `requires`, `NEWS_TAG`; `DASHBOARDS` launcher registry | change which skills/categories show, their entitlement gate, which Contentful tag feeds Plugin news, or which cards launch a standalone dashboard |
| `resources/carta-home.app.js` | shared/core runtime logic (`_mcp`, format helpers, `fetchLiveData` bootstrap, SOI, Fund Performance, Skill Directory, tour) | change behavior / data fetching for anything not yet split into its own file below |
| `resources/app/capital-activity.js` | Capital activity cards + detail overlay (fetch/render/dismiss) | change the capital call / distribution cards or their detail modal |
| `resources/app/version-check.js` | update banner: reads the published version, compares, renders/dismisses | change the banner copy or when it appears |
| `resources/app/live-content.js` | Plugin news row: Contentful fetch, per-content-type adapters, card render (tag itself lives in the config file above) | change how news cards are fetched, adapted or rendered |
| `../../.claude-plugin/skill-versions.json` | this skill's `version` + release `headline` | **bump on every user-visible change** — see Versioning |
| `resources/carta-home.css` | styles (Ink tokens) | change appearance |
| `resources/carta-home.template.html` | HTML skeleton + injection markers | change page structure |
| `resources/carta-home.tracker.js` | inlined `@carta/mcp-ui-tracker` browser bundle (`window.mcpUiTracker`) | re-run the library's `build:browser` and re-copy the output if the tracker source ever changes |
| `resources/carta-home.chart.js` | inlined Chart.js v4.5.1 UMD | bump only to change Chart.js versions — never link it from a CDN, the CSP blocks that |

App-layer JS is split across multiple files (see `APP_JS_PARTS` in
`build_artifact.py`) but still assembles into a single classic (non-module)
`<script>` tag — no bundler, no runtime `import`/`export`. New feature files
just get appended to `APP_JS_PARTS` and concatenated in order; a file's header
comment documents which shared helpers it depends on from elsewhere in the
bundle.

The build inlines `carta-home.css` → `/* __CARTA_HOME_CSS__ */`, `carta-home.tracker.js`
→ `/* __CARTA_HOME_TRACKER_JS__ */`, `carta-home.config.js` → `/* __CARTA_HOME_CONFIG_JS__ */`,
and the concatenated `APP_JS_PARTS` → `/* __CARTA_HOME_APP_JS__ */`, then substitutes
`{{CARTA_MCP_SERVER}}`, producing one self-contained HTML. `{{FIRM}}` is a **runtime**
placeholder the artifact fills from `list_contexts` — leave it alone.

## Versioning — bump this skill's entry when you change the artifact

A deployed artifact is a **frozen copy**. Nothing updates it in place, and the sandbox
sets `connect-src 'none'` so it cannot fetch its own release metadata. The only way an
existing user learns a newer build exists is the update banner, which compares the
version baked in at build time against the one carta-mcp reads from the published
`carta/plugins` tree (`plugin:get:version`, called through the `fetch` tool the artifact
already has — no `capabilities.mcp` change needed).

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

## Analytics — currently inert, by platform constraint

Keep calling `trackHome(action, elementId)` on new interactive elements (top of the
handler), IDs as `CartaHome.<Area>.<Specific>` (e.g. `CartaHome.Tour.Start`) — skip sort
clicks, keystrokes, dropdown changes. The calls are harmless and cost nothing.

**No event currently reaches Snowplow, and rebuilding the tracker will not change that.**
The runtime CSP is `connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com`,
so the collector host is unreachable from the artifact — the browser blocks the request
before the tracker's transport matters. Restoring analytics means routing events through an
MCP tool call (which goes over the runtime bridge, not the network, and so is not
CSP-limited), not fixing the bundle.

## Deploy steps

### Step 0: Checks before building

Run both checks before building, and stay quiet about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session publish at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the connector name the page will call.

Both sit in the **plugin's** `references/` directory — `${CLAUDE_PLUGIN_ROOT}/references/`,
alongside the other plugin-wide references. They are *not* under this skill's own
`references/`. Read them by that exact path; don't search for them.

This is a live artifact: the rendered HTML calls Carta at runtime through `claude.use("mcp")`, so it needs both.

**Connector check — run it before publishing, and stay quiet when it passes.** Call `welcome`, then `get_current_user`, using *your own* prefixed tool names (`mcp__<prefix>__welcome`). `welcome` confirms the connector actually answers — being listed is registry state, not proof — and publishing without one observed call earns the platform's "published against an unobserved interface" warning. `get_current_user` is not a second check; this skill needs its payload (see below). If either call errors, tell the user Carta isn't responding and stop — do not publish. If both succeed, say nothing about them and get on with the build.

Keep `get_current_user`'s response: Step 4 grants that tool, and the Skill Directory's entitlement gate reads `has_tactyc` / `has_active_manco` from the same payload at runtime.

### Step 1: Resolve the firm once, for everyone

Call `list_contexts` with no firm filter. If exactly one firm is accessible, take it. If
several are, take the firm whose `is_active` is true — the same resolution `fetchLiveData()`
does at runtime in `carta-home.app.js`. If none is active, infer from the user's request, and
ask with `AskUserQuestion` if you cannot infer confidently. If `list_contexts` returns no
firm at all, tell the user their connector has no firm in context and stop; the title names
the firm and cannot be guessed.

**Capture the firm name and firm UUID.** The name is what Step 3's title and Step 2's lookup
key are built from. Step 5 hands both to the dashboard skills so they do not re-ask the user
the same question — `carta-soi` explicitly reuses a firm list already in conversation context
rather than calling `list_contexts` again.

The published home artifact still auto-detects the firm at runtime. This resolution is for
the *build session* only: it fixes the title and lets the fan-out run unattended.

### Step 2: Find what is already published

```
Artifact({action: "list", scope: "mine"})
```

One call covers everything. Keep the `url` of each artifact below, matched on the title
its own skill publishes under — Steps 3 and 5 pass them so each page redeploys in place
instead of claiming a second URL. Omit a `url` you did not find.

| Artifact | Match the whole title | Scope |
|---|---|---|
| Home | `Carta Home - <Firm>` (hyphen) | this firm only |
| Schedule of investments | `<Firm> — Schedule of Investments` (em dash) | this firm only |
| Fund performance | `Fund Performance` | shared by every firm |

**A title is not an identity on its own.** The two firm-scoped pages carry the firm in
theirs, so one belonging to a *different* firm is not a match — reusing its `url` would
republish over that firm's page. Match the whole title, never a fragment: every firm's SOI
ends in the same three words.

Fund performance is the deliberate exception. It carries no firm in its title because the
page resolves the active firm when a viewer opens it, so one artifact serves everyone —
adopting it is reuse, not a collision. Don't "correct" it into a per-firm match.

A bare **Carta Home** with no firm suffix predates per-firm titling. Only adopt one whose
favicon is **🏠** — that is this skill's page, so redeploy over it. A bare **Carta Home**
carrying **📊** belongs to carta-cap-table's `carta-captable-home-build` and holds some
company's cap table; leave it alone, publishing over it would replace that cap table with
this firm's dashboard.

### Step 3: Build the self-contained artifact (no need to read any HTML)

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

`<slug>` is the firm name lowercased with non-alphanumerics collapsed to `-`, so two firms
never write over each other's file. The bundle itself is firm-agnostic — the slug only
keeps the paths apart.

```
uv run "<SKILL_DIR>/scripts/build_artifact.py" \
  --mcp-server "<CARTA_MCP_SERVER>" \
  --firm-name "<firm name from Step 0>" \
  --dashboard-building soi \
  --dashboard-building perf \
  --out <outputs-directory>/carta-home-<slug>.html
```

`--firm-name` is stamped into the page's `<title>` as `Carta Home - <Firm>`, which is what
names the published artifact. It is the only firm-specific thing in the bundle; the body
still detects whichever firm is active when a viewer opens it.

**This build runs twice.** On this pass, every entry with a `buildSkill` takes
`--dashboard-building <key>` and nothing else — including one whose artifact Step 2
already found. Step 5 rebuilds that artifact too, so linking to it now would point at the
page this run is about to replace. Step 6 runs the same command again with the URLs Step 5
returns, and the cards become launchers.

**An existing URL is not a reason to skip Step 5.** Every entry with a `buildSkill` is
rebuilt on every run, so the dashboards carry the current version of their skill rather
than whatever shipped whenever they were last published. Step 2's URL tells the dashboard
skill where to redeploy; it never stands in for building.

**Omit both flags for an entry with no `buildSkill`** — do not pass an empty value or a
guessed URL. An omitted key leaves that card on its copyable prompt, which is the intended
fallback.

`<SKILL_DIR>` is this skill's base directory — e.g. in Cowork
`/sessions/<name>/mnt/.remote-plugins/plugin_<id>/skills/carta-home-build`, in Claude Code
`${CLAUDE_PLUGIN_ROOT}/skills/carta-home-build`.

### Step 4: Publish the home artifact

Publishing here, before the dashboards exist, is what puts the viewer on home rather than
on whichever dashboard was built last — a published artifact surfaces itself, so the only
way home is the landing surface is for it to be the first one published. **Keep the URL
this returns**; Step 6 redeploys over it.

One call either way. `action` defaults to `"publish"`, so it is omitted below; `url` is
the only difference between a first publish and a redeploy.

```
Artifact({
  file_path: "<outputs-directory>/carta-home-<slug>.html",
  url: "<Carta Home url from Step 2 — omit entirely on a first publish>",
  description: "Dashboard home for <Firm> — SOI, Fund Performance, P&L, Balance Sheet, LP Reporting, Valuations, ManCo Actuals, Form ADV, and Skill Directory.",
  favicon: "🏠",
  label: "Redeployed from skill bundle",
  capabilities: {
    mcp: {
      servers: [
        {
          server: "<CARTA_MCP_SERVER>",
          tools: ["welcome", "list_contexts", "set_context", "fetch", "get_current_user", "mutate", "call_tool"]
        }
      ]
    }
  }
})
```

> **No `title` here, and do not add one.** The tool reads the title out of the file's
> `<title>` tag and uses its `title` parameter only when the file has none — so a `title`
> passed alongside a built page is silently dropped. `build_artifact.py` stamps
> `Carta Home - <Firm>` into the tag from `--firm-name`. If the artifact comes out named
> wrong, the build is wrong: check what Step 1 printed, not this call.
>
> Anything the page calls that is missing from `tools` rejects with `not_in_manifest`.
> `get_current_user` **must** be there or `fetchUserEnrichment()` fails silently — the
> debug log never prints and the Skill Directory falls back to showing all categories.
> `call_tool` carries the Capital Activity reminder sends, and is the gateway dispatcher
> the Plugin news live content cards use to reach
> `marketing__list__content` / `marketing__get__asset_data`
> (`resources/app/live-content.js`); without it those cards fall back to the static
> defaults. The marketing commands only exist on some environments, so a missing command
> degrades gracefully to the static cards.
>
> Keep `favicon` stable across redeploys — users find the tab by its icon — and keep the
> title stable **for a given firm**: it is the per-firm lookup key Step 2 matches on.
> Restate the whole `capabilities` object every time: a non-empty object replaces the
> stored grant, so a tool you leave out is revoked.
>
> The title is stamped once, at build; the **page** still follows whatever firm is active
> in the viewer's Carta context when they open it. A viewer who switches firm sees a title
> that no longer matches the body. Rebuild for that firm to fix it.

### Step 5: Publish the dashboard artifacts

**This step always runs.** Home is live by now with its cards marked as building, and this
is what fills them in. Skipping it because a card already points somewhere leaves the
starter pack unbuilt and every dashboard on whatever version it was last published from.

For each `DASHBOARDS` entry in `resources/carta-home.config.js` that has a `buildSkill`,
work down its candidates in order and invoke the **first one that resolves**, keeping the
artifact URL it returns, keyed by the entry's `key`. A candidate that is not installed is
not a failure — move to the next one. Once a candidate returns a URL, stop; do not invoke
the rest, or the same dashboard is published twice.

A router candidate serves several dashboards, so it needs the entry's `prompt` to know
which one to build. Lead with that sentence, then the same context every candidate gets.

Tell each one the firm is already settled, and hand it its existing URL from Step 2 —
e.g. for the `soi` entry:

> <the entry's `prompt`>
>
> Publish the SOI artifact for firm **<firm name>** (`<firm_uuid>`), already resolved —
> do not call `list_contexts` and do not ask me to pick a firm. Load every fund in the firm
> and pick the initial fund yourself. Redeploy to `<url from Step 2>` if given, so the link
> stays stable. Return only the published artifact URL.

`carta-fund-performance` resolves its own firm at runtime and needs no context passed —
it still takes the existing URL so its link stays stable. It is the `perf` entry's only
candidate: the router's benchmarks route answers in chat rather than publishing an
artifact, so an install without it leaves that card on its prompt.

**If every candidate is missing, or the one that ran errors or returns no URL: skip the
entry, say nothing, and move on.** Do not retry it, do not reach for a skill outside the
candidate list, and do not stop the build — the card falls back to its prompt, which is a
working affordance, not a failure. Never block the home build on a dashboard.

### Step 6: Redeploy home with the dashboard links

Run Step 3's build command again, this time passing `--dashboard-url <key>=<url>` for every
dashboard Step 5 published, and dropping `--dashboard-building` for those keys. Keep
`--dashboard-building` only for an entry that was meant to build and did not, so its card
still explains itself.

Then run Step 4's `Artifact` call again with `url` set to the home URL it returned, so this
redeploys in place instead of claiming a second page. A redeploy reaches viewers who
already have home open, so the cards change from building to links under them — no reload.

**If a dashboard was skipped, redeploy anyway.** The card falls back to its prompt, which
is the working affordance. Leaving home on "building" for a dashboard that will never
arrive is the one outcome to avoid.

### Step 7: Validate

Open the published URL and check that it displays fund data for the active firm without
errors — SOI rows, Fund Performance charts, and the P&L/Balance Sheet cards should all
populate. The first open asks the viewer to consent to the Carta connector; until they
accept, every card shows its no-connector state.

### Step 8: Confirm

Give the user the artifact's URL, name the firm in its title, and tell them it is live.

## If something fails

- **DWH query timeout** — this happens inside the deployed artifact, not in this build
  session. Ask the user to reopen the artifact and retry; if it still times out, the firm
  may have an unusually large portfolio or there's an underlying DWH issue, so ask the user
  to confirm in their Carta MCP session that the firm resolves correctly before retrying.
- **A card reports `not_in_manifest`** — the publish call carried an incomplete
  `capabilities.mcp` grant. Compare it against the full `tools` list in Step 5 and
  republish with every entry, passing the same `url`.
- **Every card reports `server_not_connected` or `needs_reauth`** — the viewer has no
  callable Carta connector under the name baked in at publish time, or their credentials
  lapsed. Ask them to add or reconnect Carta in Settings → Connectors. If their connector's
  display name differs from the one Step 0 resolved, republish with the right name.
- **Firm context unavailable inside the artifact** — a runtime issue this build session
  cannot query directly. Ask the user to confirm their Carta MCP connector has an active
  firm in context before redeploying.

## Related skills

The artifact's SOI, P&L, and Fund Performance cards surface the same underlying data as
`carta-explore-data` (ad-hoc DWH queries) and `carta-soi` (dedicated SOI artifact). Routing
stays clean because this skill only triggers on explicit build/deploy/redeploy requests for
the Carta Home dashboard as a whole, not on requests for one of those cards in isolation.

## Data sources (for reference)

| Card | DWH Table | Notes |
|------|-----------|-------|
| SOI | `FUND_ADMIN.AGGREGATE_INVESTMENTS` + `FUND_ADMIN.FUNDS` | Joined on FUND_UUID |
| Fund Performance | `FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS` (chart + metrics); `FUND_ADMIN.AGGREGATE_FUND_METRICS` (Total Value fallback when benchmarks empty) | All funds for the firm, ≥ 2021-06-01 |
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

- `build_artifact.py` produces a complete, self-contained live artifact — CSS + config +
  app + Chart.js inlined, base64-encoded fonts and logo, **no external hosts at all**. The
  runtime CSP allows no external script, style or connect host, so a CDN reference blocks
  silently and whatever needed it never renders. (Assemble via the build script; the source
  `carta-home.css` / `carta-home.app.js` are injected — the template on its own is
  intentionally unstyled.)
- The artifact supports **any Carta firm** — it calls `list_contexts` without a firm_name
  filter and extracts the active firm automatically.
- Skill directory prompts use `{{FIRM}}` internally and are replaced at runtime with the
  detected firm name.
- Publishing with a `url` only works on an artifact the user owns. If the `url` from
  Step 2 was shared with them rather than theirs, drop `url` and publish fresh.
- To change the artifact, edit the relevant source file under `resources/` (see the
  source-layout table above — includes `resources/app/*.js` for features already split out),
  then re-run `build_artifact.py`. Never hand-edit the assembled HTML.
