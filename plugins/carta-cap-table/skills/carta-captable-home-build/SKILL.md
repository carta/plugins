---
name: carta-captable-home-build
description: >
  Build or rebuild the Carta Home live artifact for one Carta cap-table company — a
  dashboard page published as "Carta Home - {company}". Use when the user asks to "build
  cap table home", "rebuild cap table home", "deploy cap table home", or asks to build,
  rebuild, deploy or set up Carta Home for a named company or corporation. For a fund firm's
  Carta Home (SOI, fund performance, LP reporting), use carta-investors' carta-home-build
  instead; for a CRM home of pipeline, deals and contacts, use carta-crm's
  carta-crm-home-build.
model: sonnet
allowed-tools:
  # The two Step 0 gates live in the plugin's own references/ directory.
  - Read
  # The only source for a connector's name
  - list_connectors
  # Carta MCP — the connector check's two observed calls. Prefix-agnostic so the grant
  # holds whichever form the host registers, and glob matching is case-sensitive.
  - mcp__*carta*__welcome
  - mcp__*Carta*__welcome
  - mcp__*carta*__list_accounts
  - mcp__*Carta*__list_accounts
  - Bash(uv run *build_artifact.py *)
  - Bash(find ~ -name "build_artifact.py"*)
  - Bash(find /sessions -name "build_artifact.py"*)
  - Bash(dirname *)
  - Artifact
  # Step 0b picks between companies; Step 2 asks who an untitled legacy page belongs to.
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.89.0</carta-plugin>

# Carta Home (cap table) — Build / Redeploy

Deploys the `captable-home` live artifact, published as **`Carta Home - <company>`**. It is
**assembled** from source parts in this skill's `resources/` directory (template + CSS +
config + app JS) by `scripts/build_artifact.py`, which also substitutes this session's
Carta connector name and the company the page is built for. You never need to read the
assembled HTML — see "Source layout" below.

**One page serves one company.** The company is fixed at build time and named in the
artifact's own title, so the two can never disagree. A second company means a second build,
which claims its own artifact and its own URL.

## What the artifact does

- **Update banner** — when a newer version of this artifact is published, a banner at the
  top of the page says so and offers a copyable "rebuild" prompt. See Versioning.
- **Connection banner** — the first card whose fetch comes back with a real error raises
  one banner naming the connector the page calls, the corporation it asks for, and what
  Carta replied. A card's own "Couldn't load …" line cannot tell a dead connector from a
  company that lives on another Carta environment; this can. A permission gap is not an
  error here — the option pool and round history role states never raise it.
- **Fully diluted summary** — a strip above the tiles: stat tiles for fully diluted
  shares, outstanding shares, and amount raised, plus a meter for outstanding as a share
  of fully diluted. It carries no card chrome and nothing to click, because it summarizes
  rather than drills in. Amount raised carries its own currency when
  `cap_table:list:financing_history` resolves to exactly one, one tile per currency when
  it resolves to more than one, and stays unitless when it can't be determined — never
  assumed USD.
- **Dashboards** — five tiles. **Every one behaves the same way**: a preview in the tile,
  and a footer button that opens that dashboard's full-page view. A tile that copies a
  prompt instead would look identical and act differently, which is what the uniform
  footer exists to prevent — `test_every_dashboard_tile_opens_a_drill_down` enforces it.
  - *Cap table* — one horizontal **stacked bar** of fully diluted composition by share
    class and option pool, under the fully diluted total it is a share of, then every
    share class and option plan with outstanding, fully diluted, and % fully diluted.
    Both read the one `cap_table_chart` response, so the pair costs no extra fetch. Each
    segment wears its own hue from the categorical order, separated by a 2px gap in the
    surface color, and is named in the HTML legend below the bar — never color alone. A
    value sits inside a segment only where it measures as fitting; the rest are in the
    tooltip and the table. Six segments at most; a 7th+ class folds into "Other". The
    chart draws in `afterShow`, never at fetch time: its canvas only exists
    while the page is open, and Chart.js sizes to a laid-out canvas.
  - *Round history* — cash raised per round, with close date, price per share, shares
    issued, and post-money valuation. Cash is held per currency and never summed across
    currencies; the tile's bar chart is drawn only when one currency is in play, and falls
    back to per-currency rows otherwise.
  - *Option pool* — one meter per plan in the tile: the fill is what has been granted, the
    track is the whole pool. The page adds pool size, granted, available, % used and
    expiry per plan.
  - *Stakeholders* — the total as a stat tile, then a bar per stakeholder type. Every bar
    wears the same hue: bar length already carries the count, so coloring each type would
    double-encode it. The page adds each type's share of the total.
  - *Drafts* — draft certificate and option grant sets on the cap table, full width
    because it is a list. Set names arrive already entity-escaped from the API and are
    decoded before display.
- **The company** — baked in at build time as `BAKED_CORPORATION_ID` /
  `BAKED_COMPANY_NAME`, written into the page subtitle and driving every card's data. The
  page has no picker: it loads its one company and nothing else, and remembers nothing
  between opens. To serve another company, build again for that company.
- **What to try next** — four prompt cards. Personalized from
  `get_current_user`'s `recommendations` when it returns any, padded out with the static
  `CAP_PROMPTS` from the config. A pad is skipped when a personalized prompt already
  covers one of its `topics`, so the grid never shows two cards on one subject.
- **What's new** — recently shipped cap-table capabilities, from `WHATS_NEW` in the
  config, each with a copyable prompt. Update it when a release adds something a user
  would want to try; the section hides itself when the list is empty.
- **Plugin news** — Carta events, customer stories, and guides. The template ships static
  fallback cards; `live-content.js` replaces them with live Contentful entries tagged
  `NEWS_TAG`. Every failure path keeps the static cards, so the row is never empty.
- **Skill Directory** — categorized index of carta-cap-table skills, each with two or
  three copyable example prompts covering that skill's distinct use cases.

Every prompt — the What to try next cards, the foot of each drill-down page, and the
directory's copy buttons — is written with a `{{COMPANY}}` placeholder and resolved at
copy time by `resolvePrompt()` to the built-for company's name (or "this company" when it
is somehow blank). A copied prompt lands in a chat that has no page context, so it has
to name its own subject. Keep `{{COMPANY}}` a standalone noun — `for {{COMPANY}}`, never
`{{COMPANY}}'s` — so the fallback still reads as a sentence. `[square brackets]` mark a
value the user fills in.

Each dashboard's prompt sits at the foot of its **page**, not on its tile: the user has
just read the data there, so that is where the same question carries into chat. The
prompts live in `DASHBOARD_PROMPTS` in the config, keyed by page id. `fullPagePrompt()`
returns an empty string for a key it doesn't know, so a mistyped page id renders nothing
and fails silently — `test_every_drill_down_page_has_a_prompt_that_resolves` keeps the
template, the config and the call sites in agreement.

Every card fetches live data on open, and every card has three distinct states: loading,
error, and empty (see "Data sources" below).

## MCP tools required inside the artifact

The artifact resolves the runtime bridge once with `await claude.use("mcp")`, then calls
`mcp.callTool(CARTA_MCP_SERVER, "<tool>", args)`. `CARTA_MCP_SERVER` is the Carta
connector's **display name** — the `{{CARTA_MCP_SERVER}}` placeholder the build script
fills in. The runtime addresses connectors by display name only, never by a UUID.

Every tool below must appear in the publish call's `capabilities.mcp` grant, or the call
rejects with `not_in_manifest`:

- `cap_table_chart` — renders the ownership composition bar
- `call_tool` — the non-deprecated dispatcher for every other colon-namespaced command
  (`cap_table:get:...`, `cap_table:list:...`) that the cards use, plus
  `marketing:list:content` / `marketing:get:asset_data` for the Plugin news row. The
  marketing commands only exist on some environments; a missing one leaves the static
  news cards in place.
- `fetch` — carries `plugin:get:version` for the update banner, and remains the legacy
  dispatch path for environments without `call_tool`
- `get_current_user` — `recommendations` for the Capabilities cards

## Source layout — the artifact is BUILT, not hand-edited

The deployed artifact is assembled from source parts in `resources/` by
`scripts/build_artifact.py`. **Do NOT read or edit the assembled HTML** — you never need
the full file in context. Edit the small source file for what you're changing:

| File | What it holds | Edit it to… |
|------|---------------|-------------|
| `resources/captable-home.config.js` | all page content: `DIR_CATEGORIES` (directory, each skill carries a `prompts` array), `CAP_PROMPTS` (What to try next fallbacks + dedupe `topics`), `DASHBOARD_PROMPTS` (one per drill-down page, keyed by page id), `WHATS_NEW`, `NEWS_TAG` | change which skills/categories show, their example prompts, the capability, dashboard or what's-new prompts, or which Contentful tag feeds Plugin news |
| `resources/captable-home.app.js` | shared/core runtime logic (`_mcp`, `_mcpResultCandidates`, `_mcpErrorMessage`, format helpers, `fullPagePrompt`/`fpCopyPrompt`, the baked company constants + `selectCompany`, `loadCompanyData`, tab switching, Skill Directory render, fallback empty states) | change behavior for anything not yet split into its own file |
| `resources/app/ownership.js` | the ownership composition bar (`drawOwnershipChart` + `ownershipLegendHtml`, both used by the Cap table page) + the Fully diluted summary strip, all from `cap_table_chart`; the categorical palette and its surface/label color helpers; the shared `statTile` helper; and `applyAmountRaised`, which dashboards.js calls with the financing currency | change how the stacked bar, its legend, the FD stat tiles, the dilution meter, or the amount-raised currency logic render |
| `resources/app/option-pool.js` | Option pool tile (one meter per plan) + its full-page per-plan table | change option-pool rendering |
| `resources/app/stakeholders.js` | Stakeholders tile (total stat tile + bar per type) + its full-page by-type table | change the stakeholder count/breakdown rendering |
| `resources/app/drafts.js` | Drafts tile + full-page table; merges the two `draft_sets` calls | change how merged drafts render |
| `resources/app/dashboards.js` | the Cap table and Round history tiles, `openDashboardPage`/`closeDashboardPage` and every `open*Page()` entry point, plus the one `financing_history` fetch that feeds both the round history and the FD summary's currency | change the cap-table or round-history dashboards, or how any drill-down page opens |
| `resources/app/capabilities.js` | What to try next — recommendation fetch, static padding, copy | change how capability cards are chosen or rendered |
| `resources/app/whats-new.js` | What's new — renders `WHATS_NEW` | change how what's-new cards render (edit the content in the config) |
| `resources/app/version-check.js` | update banner: reads the published version, compares, renders/dismisses | change the banner copy or when it appears |
| `resources/app/live-content.js` | Plugin news — live Contentful fetch, adapters, asset resolution | change which content types render or how news cards look |
| `../../.claude-plugin/skill-versions.json` | this skill's `version` + release `headline` | **bump on every user-visible change** — see Versioning |
| `resources/captable-home.css` | styles (Ink tokens) | change appearance |
| `resources/captable-home.template.html` | HTML skeleton + injection markers | change page structure |
| `resources/captable-home.tracker.js` | inlined `@carta/mcp-ui-tracker` browser bundle (`window.mcpUiTracker`) | re-run the library's `build:browser` and re-copy the output if the tracker source ever changes |

App-layer JS assembles into a single classic (non-module) `<script>` tag — no bundler,
no runtime `import`/`export`. New feature files get appended to `APP_JS_PARTS` in
`build_artifact.py` and concatenated in order. Card fetch/render functions are declared
with `function name() {}` (hoisted), so `loadCompanyData` in `captable-home.app.js` can
call them regardless of concatenation order.

**But top-level `const`/`let` are not hoisted.** One script means one shared scope, so a
module's constants are still in the temporal dead zone while an earlier file's top-level
code runs. Calling a later module's function from `captable-home.app.js`'s init block
throws `ReferenceError` the moment that function reads one of its own constants — and it
takes the whole page with it. Two rules follow:

- Each module does its own first paint at the bottom of its own file (see
  `capabilities.js`, `whats-new.js`, `version-check.js`, `live-content.js`).
- Every top-level name across all parts has to be unique. A duplicate `const` is a
  parse-time `SyntaxError` that kills every card at once; `test_bundle_parses` catches it.

The build inlines `captable-home.css` → `/* __CAPTABLE_HOME_CSS__ */`,
`captable-home.tracker.js` → `/* __CAPTABLE_HOME_TRACKER_JS__ */`, `captable-home.config.js`
→ `/* __CAPTABLE_HOME_CONFIG_JS__ */`, and the concatenated app JS →
`/* __CAPTABLE_HOME_APP_JS__ */`, then substitutes `{{CARTA_MCP_SERVER}}`, producing one
self-contained HTML.

## Versioning — bump this skill's entry when you change the artifact

A deployed artifact is a **frozen copy**. Nothing updates it in place. The version lives
in the **plugin's** registry, keyed by this skill:

```jsonc
// plugins/carta-cap-table/.claude-plugin/skill-versions.json
{ "carta-captable-home-build": { "version": "0.1.0", "headline": "…" } }
```

It sits there rather than beside the skill because carta-mcp reads it from the published
mirror, and a skill that has not opted into publishing never reaches that mirror —
whereas `.claude-plugin/` is plugin-level metadata and is always published.

**This is not the plugin's own version.** `carta-cap-table` publishes many releases
across ~30 skills. The update banner is keyed to this skill's number so it fires only
when *this artifact* changed — `app/version-check.js` reads `version` from the
`plugin:get:version` response and must never compare against the `plugin_version` that
rides along beside it.

So: **change anything under `resources/`, bump this skill's entry in the same PR.** CI
enforces it (`.forgejo/scripts/validate-artifact-version-bump.py`).

| Bump | When | User sees |
|------|------|-----------|
| **patch** | **the default** — copy tweak, style nudge, refactor, bug fix | nothing |
| **minor** | new card, new data, changed behaviour a user would want to know about | banner |
| **major** | rebuild genuinely required | banner |

**Start at patch and stay there unless you can name what the user gains.** If you cannot
write a headline a customer would care about, that is the signal: ship patch.

`headline` is one line describing what changed. It is the text the banner shows, so write
it for the customer. CI rejects a minor/major bump whose headline is empty or still
describes the previous release.

## Deploy steps

### Step 0: Checks before building

Run both checks before building, and stay quiet about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session publish at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the connector name the page will call.

Both sit in the **plugin's** `references/` directory — `${CLAUDE_PLUGIN_ROOT}/references/`,
alongside the other plugin-wide references. They are *not* under this skill's own
`references/`. Read them by that exact path; don't search for them.

This is a live artifact: the rendered HTML calls Carta at runtime through `claude.use("mcp")`, so it needs both.

**Connector check — run it before publishing, and stay quiet when it passes.** Call `welcome`, then `list_accounts`, using *your own* prefixed tool names (`mcp__<prefix>__welcome`). This is the connector's mandated bootstrap and it is what makes the grant honest: publish without one observed call and the platform warns that the page is "published against an unobserved interface". It does **not** verify the display name — nothing in this session can — so the name still comes from `list_connectors`. If either call errors, tell the user Carta isn't responding and stop — do not publish. If both succeed, say nothing about them.

**One connector answers the company and gets baked in — they must be the same one.**
The page hard-codes two values that only work as a pair: the corporation pk, resolved
here by `list_accounts`, and the connector display name, published in Step 3. A user with
both `Carta` and `Carta (Test)` installed has two connectors matching
`mcp__*Carta*__list_accounts`, so the glob can resolve the company on one environment
while `list_connectors` hands you the name of the other. The page then asks production
for a Test corporation and every card fails for every viewer.

So when `list_connectors` returns **more than one connected Carta entry**, ask with
`AskUserQuestion` which one this page is for *before* calling `welcome` / `list_accounts`
— the gate's Step 2 table says the same, and it is not optional here. Then make every
call in Step 0 and Step 0b through **that connector's own prefix**, and pass **that**
name as `--mcp-server` in Step 1 and as `server` in Step 3. Never resolve the company
through one prefix and publish against another name.

> **Path — do NOT rely on `${CLAUDE_PLUGIN_ROOT}` in bash.** In the Cowork sandbox that env
> var is empty, so `uv run "${CLAUDE_PLUGIN_ROOT}/…"` resolves to a broken path. Use the
> **base directory reported for this skill when it loaded** (it ends in
> `/skills/carta-captable-home-build`) as `<SKILL_DIR>`. If you don't have it, resolve it
> once with a scoped `find` (NOT `find /`):
> ```
> SKILL_DIR="$(dirname "$(dirname "$(find /sessions "$HOME" -type f -path '*/carta-captable-home-build/scripts/build_artifact.py' 2>/dev/null | head -1)")")"
> ```

### Step 0b: Resolve which company this build is for

The page carries one company, so settle it before building. Reuse the **same
`list_accounts` response** the connector check above already made — same connector
prefix, and `detail: "full"` is required (`"summary"` returns blank names). Keep the accounts whose `id` starts
`corporation_pk:`. Do **not** filter on `type === "company"`: a corporation that can hold,
or that sits under a parent org, is typed `fund` and still has a cap table.

- **The user named a company** — re-call `list_accounts` with `search: "<name>"` and take
  the match. `search` is matched server-side across every account they can reach; the
  unsearched response is a single page capped at 200 accounts ordered by legal name, so a
  company further down the alphabet is *only* reachable this way.
- **Exactly one company** — build for it and say nothing.
- **More than one** — ask with `AskUserQuestion`. Never guess: guessing publishes a page
  titled for the wrong company.
- **None** — tell the user they have no cap-table company on this connector and stop.

Carry forward the company's **name** and its **bare pk** — `id` with the
`corporation_pk:` prefix stripped. The build rejects a still-prefixed id.

### Step 1: Build the self-contained artifact (no need to read any HTML)

`<slug>` is the company name lowercased with non-alphanumerics collapsed to `-`, so two
companies never write over each other's file.

```
uv run "<SKILL_DIR>/scripts/build_artifact.py" \
  --mcp-server "<CARTA_MCP_SERVER>" \
  --corporation-id "<bare corporation pk from Step 0b>" \
  --company-name "<company name from Step 0b>" \
  --out <outputs-directory>/captable-home-<slug>.html
```

### Step 2: Find an already-published Carta Home for this company

```
Artifact({action: "list", scope: "mine"})
```

Look for an artifact titled exactly **`Carta Home - <Company>`**. If one is there, keep its
`url` — Step 3 passes it so the page redeploys in place. If there is none, omit `url`: this
company gets its own artifact. An artifact for a *different* company is not a match — reusing
its `url` would overwrite that company's page.

**A bare `Carta Home` with no company suffix** is a page from before the title carried the
company. Its favicon says which skill built it: **📊** is a cap-table page, **🏠** is
carta-investors' firm dashboard — never redeploy over a 🏠, it would replace a firm's
dashboard with this cap table. A 📊 one was built for *some* company and the listing cannot
say which, so do not assume it is this one: ask with `AskUserQuestion` whether to redeploy
over it or publish a new page, and pass its `url` in Step 3 only if the user says it is this
company's.

### Step 3: Publish the artifact

One call either way. `action` defaults to `"publish"`, so it is omitted below; `url` is
the only difference between a first publish and a redeploy.

```
Artifact({
  file_path: "<outputs-directory>/captable-home-<slug>.html",
  url: "<url from Step 2 — omit entirely on a first publish>",
  description: "Cap table home for <Company> — a fully diluted summary, and Cap table, Round history, Option pool, Stakeholders and Drafts dashboards, plus What to try next, What's new, Plugin news, and a Skill Directory.",
  favicon: "📊",
  label: "Redeployed from skill bundle",
  capabilities: {
    mcp: {
      servers: [
        {
          server: "<CARTA_MCP_SERVER>",
          tools: ["cap_table_chart", "call_tool", "fetch", "get_current_user"]
        }
      ]
    }
  }
})
```

> **No `title` here, and do not add one.** The tool reads the title out of the file's
> `<title>` tag and uses its `title` parameter only when the file has none — so a `title`
> passed alongside a built page is silently dropped. `build_artifact.py` stamps
> `Carta Home - <Company>` into the tag from `--company-name`, which is why the page and
> the name it publishes under cannot disagree. If the artifact comes out named wrong, the
> build is wrong: check what Step 1 printed, not this call.
>
> Anything the page calls that is missing from `tools` rejects with `not_in_manifest`.
> `list_accounts` is **not** in the grant: the skill resolves the company at build time and
> the page never calls it.
> Keep `favicon` stable across redeploys — users find the tab by its icon — and keep the
> title stable **for a given company**: it is the per-company lookup key Step 2 matches on.
> Restate the whole `capabilities` object every time: a non-empty object replaces the
> stored grant, so a tool you leave out is revoked.

### Step 4: Confirm

Give the user the artifact's URL, name the company it is built for, and tell them it is
live. Name the Carta connection it calls too when they have more than one — that is the
only place a viewer can catch a page pointed at the wrong environment before opening it. The first open asks the viewer to consent to the Carta connector; until they accept,
every card shows its no-connector state. If they want another company, say so plainly:
run this skill again for that company and they get a second artifact.

If Step 2 left a bare `Carta Home` behind — the user said it wasn't this company's — say so
too: it is an older page, and they can either rebuild for whichever company it holds or
delete it from their artifact gallery.

## Data sources (for reference)

| Card | Backing command |
|------|------------------|
| Cap table dashboard (tile, stacked bar and table) | `cap_table_chart` — one call, held in `_capTableChartData`, feeding all three plus the FD summary's share counts |
| Round history dashboard | `cap_table:list:financing_history` — one row per share class, already aggregated and date-sorted, carrying `closing_date`, `original_issue_price`, `shares_issued`, `post_money`, and `cash_raised_by_currency`. **Not `cap_table:get:financing_history`:** that command is deprecated *with* a replacement, and the gateway raises `ToolError` on any such command, so calling it renders nothing but the card's error state |
| What to try next | `get_current_user` — `recommendations`, filtered to entries that are not `is_skill_gap` and carry a `recommended_prompt` |
| Update banner | `plugin:get:version` via `fetch`, with `plugin` + `skill` params |
| Plugin news | `marketing:list:content` (tag `NEWS_TAG`, `tag_source: "metadata"`) then `marketing:get:asset_data` per image. Images must arrive as `data:` URIs — the sandbox CSP is `img-src 'self' data:`, so a remote asset URL renders nothing |
| Ownership composition bar (on the Cap table page) | `cap_table_chart` — `chart_data.share_classes` + `chart_data.option_plans`, by `fully_diluted_shares`, largest first and capped at six segments |
| Fully diluted summary | `cap_table_chart` — `chart_data.totals` for share counts (same call again, no extra fetch), upgraded by the Round history dashboard's `cap_table:list:financing_history` response, which the dashboard hands over via `applyAmountRaised` — one currency renders plainly, more than one renders a per-currency breakdown (never summed), none/failure keeps the unitless fallback |
| Option pool | `cap_table:get:option_plans` (403 for non-staff users falls back to a plain "not available for your role" state, not an error banner) |
| Stakeholders | `cap_table:get:stakeholders` (summary mode — no `search` param, no names/PII). `by_type` keys vary per corporation, so they are always iterated, never matched against a hardcoded enum |
| Drafts | `cap_table:list:draft_sets` called **twice** — once per required `security_type` (`certificate`, `option_grant`) — and merged; one call can fail without blocking the other |
| The company itself | none at runtime — baked in at build time. The **skill** resolves it once with `list_accounts` in Step 0 (see there) |

`cap_table:get:cap_table_summary` does not exist ("Unknown command") — never reference it.
`cap_table:get:financing_history` exists but is deprecated with a replacement, which the
gateway turns into a hard error — use `cap_table:list:financing_history`.

## Notes

- `build_artifact.py` produces a complete, self-contained live artifact — CSS + config +
  app inlined, fully self-contained — Chart.js is vendored at the plugin level (`plugins/carta-cap-table/vendor/chart.umd.min.js`) and inlined at build time. The runtime CSP allows no external
  script, style or connect host, so a CDN reference blocks silently and the charts never draw.
- To change the artifact, edit the relevant source file under `resources/` (see the
  source-layout table above), then re-run `build_artifact.py`. Never hand-edit the
  assembled HTML.
