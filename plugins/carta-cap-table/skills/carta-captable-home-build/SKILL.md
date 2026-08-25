---
name: carta-captable-home-build
description: >
  Build or rebuild the Cap Table Home live artifact — a dashboard home page for one Carta
  company. Use when the user asks to "build cap table home", "rebuild cap table home",
  "set up the cap table home page", or "deploy cap table home".
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
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

# Cap Table Home — Build / Redeploy

Deploys the `captable-home` live artifact. It is **assembled** from source parts in this
skill's `resources/` directory (template + CSS + config + app JS) by
`scripts/build_artifact.py`, which also substitutes this session's Carta connector name.
You never need to read the assembled HTML — see "Source layout" below.

## What the artifact does

- **Update banner** — when a newer version of this artifact is published, a banner at the
  top of the page says so and offers a copyable "rebuild" prompt. See Versioning.
- **Dashboards** — two tiles that open a full-page view in the artifact itself:
  - *Cap table* — every share class and option plan with outstanding, fully diluted, and
    % fully diluted. Reuses the `cap_table_chart` response, so it costs no extra fetch.
  - *Round history* — cash raised per round, with close date, price per share, shares
    issued, and post-money valuation. Cash is held per currency and never summed across
    currencies; the tile's bar chart is drawn only when one currency is in play, and falls
    back to per-currency rows otherwise.
- **Ownership** — fully diluted composition by share class and option pool, as a chart.
- **Fully diluted summary** — stat tiles for fully diluted shares, outstanding shares,
  and amount raised, plus a meter for outstanding as a share of fully diluted. Amount
  raised carries its own currency when `cap_table:list:financing_history` resolves to
  exactly one, one tile per currency when it resolves to more than one, and stays
  unitless when it can't be determined — never assumed USD.
- **Option pool** — one meter per option plan: the fill is what has been granted, the
  track is the whole pool, with shares available and pool size beneath it.
- **Stakeholders** — the total as a stat tile, then a bar per stakeholder type. Every bar
  wears the same hue: bar length already carries the count, so coloring each type would
  double-encode it.
- **Drafts** — draft certificate and option grant sets on the cap table. Set names arrive
  already entity-escaped from the API and are decoded before display.
- **Company selector** — one typeahead combobox over the user's companies (one at a
  time), persisted to `localStorage`, that writes the chosen company's name into the page
  subtitle and drives every card's data. Typing filters the loaded options immediately and,
  debounced, re-queries `list_accounts` with `search`. That second half is not optional:
  `list_accounts` returns a single entity-switcher page capped at 200 accounts ordered by
  legal name, so the unsearched list is a prefix, not the whole set, and only a server-side
  `search` reaches every account the user can see. Arrow keys move through the list, Enter
  picks, Escape closes and restores the selected company's name.
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

Every prompt — the cards' "Run in chat" buttons and the directory's copy buttons — is
written with a `{{COMPANY}}` placeholder and resolved at copy time by `resolvePrompt()`
to the selected company's name (or "this company" when nothing is selected). A copied
prompt lands in a chat that has no page context, so it has to name its own subject.
Keep `{{COMPANY}}` a standalone noun — `for {{COMPANY}}`, never `{{COMPANY}}'s` — so the
fallback still reads as a sentence. `[square brackets]` mark a value the user fills in.

Every card fetches live data once a company is selected, and every card has three
distinct states: loading, error, and empty (see "Data sources" below).

## MCP tools required inside the artifact

The artifact resolves the runtime bridge once with `await claude.use("mcp")`, then calls
`mcp.callTool(CARTA_MCP_SERVER, "<tool>", args)`. `CARTA_MCP_SERVER` is the Carta
connector's **display name** — the `{{CARTA_MCP_SERVER}}` placeholder the build script
fills in. The runtime addresses connectors by display name only, never by a UUID.

Every tool below must appear in the publish call's `capabilities.mcp` grant, or the call
rejects with `not_in_manifest`:

- `list_accounts` — resolves which companies the user can select
- `cap_table_chart` — renders the ownership chart
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
| `resources/captable-home.config.js` | all page content: `DIR_CATEGORIES` (directory, each skill carries a `prompts` array), `CAP_PROMPTS` (What to try next fallbacks + dedupe `topics`), `WHATS_NEW`, `NEWS_TAG` | change which skills/categories show, their example prompts, the capability or what's-new cards, or which Contentful tag feeds Plugin news |
| `resources/captable-home.app.js` | shared/core runtime logic (`_mcp`, `_mcpResultCandidates`, `_mcpErrorMessage`, format helpers, the company selector, `loadCompanyData`, tab switching, Skill Directory render, fallback empty states) | change behavior for anything not yet split into its own file |
| `resources/app/ownership.js` | Ownership chart + Fully diluted summary (`cap_table_chart`), the shared `statTile` helper, and `applyAmountRaised`, which dashboards.js calls with the financing currency | change how the ownership doughnut, the FD stat tiles, the dilution meter, or the amount-raised currency logic render |
| `resources/app/option-pool.js` | Option pool card — one meter per plan | change per-plan option-pool rendering |
| `resources/app/stakeholders.js` | Stakeholders card — total stat tile + bar per type | change the stakeholder count/breakdown rendering |
| `resources/app/drafts.js` | Drafts card — merges the two `draft_sets` calls | change how merged drafts render |
| `resources/app/dashboards.js` | the two Dashboards tiles and their full-page views, plus the one `financing_history` fetch that feeds both the round history and the FD summary's currency | change the cap-table or round-history dashboards |
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

> **Path — do NOT rely on `${CLAUDE_PLUGIN_ROOT}` in bash.** In the Cowork sandbox that env
> var is empty, so `uv run "${CLAUDE_PLUGIN_ROOT}/…"` resolves to a broken path. Use the
> **base directory reported for this skill when it loaded** (it ends in
> `/skills/carta-captable-home-build`) as `<SKILL_DIR>`. If you don't have it, resolve it
> once with a scoped `find` (NOT `find /`):
> ```
> SKILL_DIR="$(dirname "$(dirname "$(find /sessions "$HOME" -type f -path '*/carta-captable-home-build/scripts/build_artifact.py' 2>/dev/null | head -1)")")"
> ```

### Step 1: Build the self-contained artifact (no need to read any HTML)

```
uv run "<SKILL_DIR>/scripts/build_artifact.py" \
  --mcp-server "<CARTA_MCP_SERVER>" \
  --out <outputs-directory>/captable-home-updated.html
```

### Step 2: Find an already-published Cap Table Home

```
Artifact({action: "list", scope: "mine"})
```

Look for an artifact titled **Cap Table Home**. If one is there, keep its `url` — Step 3
passes it so the page redeploys in place instead of claiming a second URL. If there is
none, omit `url`.

### Step 3: Publish the artifact

One call either way. `action` defaults to `"publish"`, so it is omitted below; `url` is
the only difference between a first publish and a redeploy.

```
Artifact({
  file_path: "<outputs-directory>/captable-home-updated.html",
  url: "<url from Step 2 — omit entirely on a first publish>",
  title: "Cap Table Home",
  description: "Dashboard home for a single company — Cap table and Round history dashboards, Ownership, Fully Diluted Summary, Option Pool, Stakeholders, Drafts, What to try next, What's new, Plugin news, and a Skill Directory.",
  favicon: "📊",
  label: "Redeployed from skill bundle",
  capabilities: {
    mcp: {
      servers: [
        {
          server: "<CARTA_MCP_SERVER>",
          tools: ["list_accounts", "cap_table_chart", "call_tool", "fetch", "get_current_user"]
        }
      ]
    }
  }
})
```

> Anything the page calls that is missing from `tools` rejects with `not_in_manifest`.
> Keep `favicon` and `title` stable across redeploys — users find the tab by its icon.
> Restate the whole `capabilities` object every time: a non-empty object replaces the
> stored grant, so a tool you leave out is revoked.

### Step 4: Confirm

Give the user the artifact's URL and tell them it is live. The first open asks the viewer
to consent to the Carta connector; until they accept, every card shows its
no-connector state.

## Data sources (for reference)

| Card | Backing command |
|------|------------------|
| Cap table dashboard | `cap_table_chart` — reuses the response Ownership already fetched (`_capTableChartData`), so it adds no call |
| Round history dashboard | `cap_table:list:financing_history` — one row per share class, already aggregated and date-sorted, carrying `closing_date`, `original_issue_price`, `shares_issued`, `post_money`, and `cash_raised_by_currency`. **Not `cap_table:get:financing_history`:** that command is deprecated *with* a replacement, and the gateway raises `ToolError` on any such command, so calling it renders nothing but the card's error state |
| What to try next | `get_current_user` — `recommendations`, filtered to entries that are not `is_skill_gap` and carry a `recommended_prompt` |
| Update banner | `plugin:get:version` via `fetch`, with `plugin` + `skill` params |
| Plugin news | `marketing:list:content` (tag `NEWS_TAG`, `tag_source: "metadata"`) then `marketing:get:asset_data` per image. Images must arrive as `data:` URIs — the sandbox CSP is `img-src 'self' data:`, so a remote asset URL renders nothing |
| Ownership | `cap_table_chart` — `chart_data.share_classes` + `chart_data.option_plans`, by `fully_diluted_shares` |
| Fully diluted summary | `cap_table_chart` — `chart_data.totals` for share counts (same call as Ownership, two renders), upgraded by the Round history dashboard's `cap_table:list:financing_history` response, which the dashboard hands over via `applyAmountRaised` — one currency renders plainly, more than one renders a per-currency breakdown (never summed), none/failure keeps the unitless fallback |
| Option pool | `cap_table:get:option_plans` (403 for non-staff users falls back to a plain "not available for your role" state, not an error banner) |
| Stakeholders | `cap_table:get:stakeholders` (summary mode — no `search` param, no names/PII). `by_type` keys vary per corporation, so they are always iterated, never matched against a hardcoded enum |
| Drafts | `cap_table:list:draft_sets` called **twice** — once per required `security_type` (`certificate`, `option_grant`) — and merged; one call can fail without blocking the other |
| Company selector | `list_accounts` with `detail: "full"` (required — `"summary"` returns blank names), filtered to an `id` starting `corporation_pk:`; re-queried with `search` when the user types. Do not filter on `type === "company"` — a corporation that can hold, or that sits under a parent org, is typed `fund` and still has a cap table |

`cap_table:get:cap_table_summary` does not exist ("Unknown command") — never reference it.
`cap_table:get:financing_history` exists but is deprecated with a replacement, which the
gateway turns into a hard error — use `cap_table:list:financing_history`.

## Notes

- `build_artifact.py` produces a complete, self-contained live artifact — CSS + config +
  app inlined, fully self-contained — Chart.js is vendored at the plugin level (`plugins/carta-cap-table/vendor/chart.umd.min.js`) and inlined at build time. The runtime CSP allows no external
  script, style or connect host, so a CDN reference blocks silently and the charts never draw.
- To change the artifact, edit the relevant source file under `resources/` (see the
  source-layout table above), then re-run `build_artifact.py`. Never hand-edit the
  assembled `captable-home-updated.html`.
