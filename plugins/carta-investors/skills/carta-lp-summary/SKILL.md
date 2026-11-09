---
name: carta-lp-summary
description: >
  LP Summary as a persistent Cowork artifact for a GP firm: a list of limited
  partners beside one LP's detail — capital (committed, called, unfunded, NAV), net TVPI,
  DPI and IRR, fund positions with per-fund net IRR and wire status, contacts, and an
  estimated exposure by company or sector with MOIC — plus an All Limited Partners table.
  Read-only. Data from Carta Fund Admin via the MCP, fetched live every time the page opens.

  Triggers: "LP summary", "build the LP summary for [firm]", "LP summary split view",
  "LP detail view", "LP list with detail pane",
  "brand my LP profiles with [firm]'s branding", "brand my LP profiles from this deck".
  Use this, not carta-explore-data, for any request to build, open or refresh the LP summary —
  it publishes the page; do not answer with an ad-hoc roster or table instead.
  Use instead: carta-lp-dashboard for an LP viewing their own portfolio; carta-explore-data for a
  one-off number.
version: 1.0.0
model: inherit
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__welcome
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  # Step 2: find the firm the user names (list_contexts) and switch to it (set_context).
  - mcp__carta__list_contexts
  - mcp__claude_ai_Carta__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  # Branding checkpoints: website versus deck as the brand source.
  - mcp__carta__skill_checkpoint
  - mcp__carta__read_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__claude_ai_Carta__skill_checkpoint
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__skill_checkpoint
  - Artifact
  - AskUserQuestion
  - read_skill
  - Read
  - Write
  - Bash(carta workspace cache *)
  - Bash(command -v *)
  - Bash(jq *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/scripts/render_artifact.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-summary/scripts/brand_assets.py" *)
  - Bash(mkdir -p *)
  - Bash(mv *)
  # "Brand my LP profiles": the firm's logo, colours and fonts.
  - Skill(carta-investors:carta-brand-extraction)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.30.22</carta-plugin>

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN base v0.1.0]

# LP Summary Skill

Creates (or refreshes) a persistent Cowork artifact titled **`<firm_name> — LP Summary`**. The artifact **fetches its own rows from Carta every time it is opened**; the skill injects only configuration — the connector name, the firm and the table names. Never put a figure in the config or the page.

## What the artifact shows

| Part | Content |
|---|---|
| **Header** | Firm name, "Limited Partner Summary" with the as-of date beside it ("· some funds earlier" with each earlier fund's date in a tooltip), and **Export LP profile** on the right. The header keeps to an 8px rhythm and a 12-column grid: the four overview figures share the first 9 columns, Export the last 3; each figure's qualifier sits on the line under it, and a label that wraps on a narrow window keeps the figures level. Under the title, an overview of four figures: **Total commitments** (in the main currency, with how many LPs hold it; other currencies apart behind a "+ EUR" note); **Unfunded commitments** (in the main currency — the one most funds report in — with its % of committed; other currencies stay apart behind a "+ EUR" note); **Distributions** (what LPs have received in the main currency, with net DPI — distributions over paid-in — beside it, "No capital called yet" before any is paid in; other currencies apart behind the same "+ EUR" note); and **Concentration**, the top 3 LPs' share of commitments in the main currency (hover: each LP's share and the share of unfunded they owe; left out at 3 LPs or fewer). Once a pane the current view shows (list or detail, or the table) is scrolled down — and only when it has enough to scroll that folding the header will not pull it back to the top — the header collapses (it also folds as soon as the viewer picks an LP themselves — after a mouse click on a row, the header folds in one step while a spacer at the list's top takes the same height so that row stays exactly put, then eases away (or sooner, when the pointer leaves the LP pane) — and then stays folded until they use the **Show overview** button the folded header shows, click the folded header, or scroll up from the top of a pane): the logo and firm name fold away, and the title, figures and Export button step down to their small sizes and stay in view (on a phone the page scrolls as a whole instead). |
| **LP list** (left) | An Ink ButtonGroup, small and icon-only (**List view**, **Table view**, each named in a tooltip; the selected one filled) and one filter (LP or fund name) head the pane. A filter button on the search's right edge opens a menu: **Status** — *Wire issues* (LPs with a missing, unverified or stale wire on any fund) — and **Fund** — *All funds* or any set of funds (an LP shows if it holds a position in one; the table also narrows each LP to those funds); each row counts the LPs in it under the other filters and the search, and *Clear all*, pinned to the menu's bottom edge while the menu scrolls, resets. A yellow dot on the button means some LP shown under the current search and funds has wire issues; like a notification, it clears once the menu is opened and returns only if more LPs get wire issues (with none, the menu reads *Wire issues 0*). Active filters show as removable chips under the search, and the button shows a soft wash and a filled icon while any is on. When a filter or the search hides the selected LP, the first one left is selected (the detail empties when none is left); clearing every filter and the search brings the earlier selection back, unless an LP was picked in between. Picked funds also narrow the committed figure each list row shows. The column heading counts the LPs shown ("Limited Partner (N)", following the filter; the table's heading too). One row per LP family (`FIRM_PARTNER_GROUP_ID`), largest commitment first: name and committed (rounded, exact on hover). |
| **LP detail** (right) | Name (24px, below the overview figures in the page's hierarchy: title → overview figures → LP name → LP numbers), with the LP's wire status beside it as the wire pill itself ("1 of 2 wires stale"; hovering it names each fund whose wire needs attention and why, and clicking it shows every fund row, scrolls to Fund positions and flashes the Wire column); Limited Partner since (earliest commitment) · investor type · location (state for a US partner, otherwise country); a detail not on file drops out of that line, and one grey sentence names what is missing ("No start date, investor type, location or contact on file"; it takes the contact line's place only when the LP has no contact at all, primary or not, and otherwise sits under the contacts); the contact on its own line, led by a small "Contact" label: primary name · email (its copy button shows on hover or focus, and always on touch screens) · "+N more", a menu of every other contact ("+N contacts" when there is no primary). A contact whose email doesn't match their Carta account carries a yellow "Unverified email" label (tooltip: "This email doesn't match their Carta account. Notices may not reach them."); the menu link adds "(1 needs review)" / "(N need review)" for flagged contacts inside it. The warehouse exposes only the flag, never the account email. **Capital**: committed, called bar, called · %, unfunded. **Performance**: NAV, net TVPI, DPI and IRR (while neither the partner's contributions nor the NAV table show capital paid in, each reads a dash whose tooltip says "No capital called yet"). **Fund positions**: fund, committed, unfunded, net TVPI, net IRR, wire pill (tooltip dates it); top 4, then "Show N more" / "Show less". |
| **Exposure** | Estimated: the LP's share of each fund's NAV × the fund's value in each company, summed across its funds, or for one fund picked from the dropdown. By company, by sector, or by geography when the scope holds a non-US company (Unknown last, with a source note), largest first; the top 4, then "Show N more" / "Show less". Written-off companies (no value left, a cost recorded) stay in at $0. Below the whole list (and its toggle) a muted, unbarred "Other (cash, fees and other assets)" line, with the tooltip "Net value of cash, receivables, payables, and unvalued holdings.", reconciles the rest of the NAV in scope so the % column adds up to 100%; it is not ranked and does not set the bar scale. Columns: a bar scaled to the largest row, Est. NAV, % of NAV (a share of the NAV in scope), MOIC. A company opens to the funds it is held through; a sector or geography to its companies. Picking a fund with no non-US exposure while on Geography goes back to Company. |
| **Table** | Toggling to Table slides the list pane open over the detail into a full-width table: Limited Partner (contact · funds), committed, called bar with the % on hover, unfunded, net TVPI, wire status. Sorts by name, committed, called, unfunded or net TVPI (committed, largest first, to start); the pane's search and filter menu; an LP with several funds expands to fund rows (5, then "+N more") from its chevron, and "Expand all" opens every one. A click anywhere else on a row (a quiet "View →" slides in on hover) folds back to List with that LP selected, scrolled into view and open in the detail; the list keeps the table's sort. A footer totals what is shown. |
| **Export** | **Export profile** in the header opens an **Export profiles** dialog, so the PDF is always previewed before it is saved. On the left, **Profiles** (a select whose panel holds a searchable LP checklist with a tri-state All; it starts with the current LP, or in Table view the ticked rows) and **Template**: a *Carta · Standard layout* card, and either the firm's card (*<firm> · Your logo and colors*, the default) or, before branding is set up, a dashed *Your firm · Logo and colors, set up in Claude* slot whose *Copy setup prompt* copies the branding prompt and confirms with a brief "Copied. Paste in chat." tooltip. On the right, the first page in the chosen template, drawn by the same code as the PDF. The footer holds Cancel and *Export profile* / *Export N profiles* (past 5 LPs, *Save as one PDF instead*). Each PDF is `<lp-slug>-lp-profile-<yyyy-mm-dd>.pdf`, saved one at a time, each confirmed by the viewer. The PDF: header (firm · LP Profile · LP · as of, and any funds valued earlier), investor type, location, LP since, primary contact, the Capital / Performance band, every fund position (fund, vintage, committed, unfunded, net TVPI, net IRR), the top 10 companies by estimated NAV with % of NAV and MOIC, then an Other line for the rest of the NAV in scope, any written-off companies, Geography where it is offered, and a "Generated from Carta" footer with page numbers; amounts are exact. Wire status is never printed: the PDF is the document a GP shares with an LP, and wire details are for the GP. Where the viewer cannot save files, the same controls copy the LPs as a spreadsheet table instead. Nothing is written to Carta. |

Rules the page applies:
- Committed, called and unfunded print exact; the LP list's committed and exposure values print rounded, `$40.0M` / `$951K`, with the exact amount on hover.
- Unfunded is committed less called. TVPI, DPI and IRR are net and read "—" until capital is called. A fund's net IRR solves over that fund's own cash flows.
- MOIC is estimated value over the LP's share of cost, read over the securities whose cost is recorded (a sector pools its companies'); it reads "—" when no cost is recorded.
- Wire status per fund is **Confirmed**, **Stale** (confirmed more than 12 months ago), **Unverified** (added and not confirmed, or changed since), **Missing**, or **Restricted** (the viewer's role cannot read wire data). An LP shows its worst. No bank name or account number is shown anywhere.
- A feeder passes through to its master fund. Any other fund-of-fund holding keeps its own name, and groups under "Fund investments" by sector.
- Sector is the firm's own Industry or Sector tag, else "Unclassified".
- Amounts in different currencies are never added together: the detail shows a Capital / Performance block per currency.
- The LP pane's edge drags (or takes arrow keys) to give the detail more room, between 300px and whatever leaves the detail 360px; the width is kept between visits and a double-click resets it. The detail lays itself out by its own width: Fund positions drop Unfunded and Net TVPI and Exposure its bars below 760px, and Capital stacks above Performance below 600px.
- On a phone the toggle swaps the views in place, and the list and the detail take turns, with a back link to the list.
- The page is read-only: it sends, edits and changes nothing.

## When Carta Home builds this page

Carta Home may invoke this skill with the firm already resolved (name and firm UUID) and, on a rebuild, the URL of the existing page. Then:
- Skip `list_contexts` and use the firm you were given; still call `welcome` and `set_context` (Step 2).
- Redeploy to the URL you were given instead of searching for one (Step 5e).
- Reply with only the published artifact URL.
- Write `origin: "home"` in the config (Step 4); any other invocation writes `"chat"`. It labels the page-open analytics event with where the request came from.
- Write the home URL Carta Home gave you as `home_url` in the config, so the page shows a "Back to Home" link. Without it the link stays hidden.
- Skip the intro (Step 2) and the branding follow-up (5f): Home builds its dashboards in parallel and waits on each URL, so a question here would stall the whole starter pack.
- A brand set up earlier carries into Home's build only through that firm's own workdir (5a): the build reads the firm's previous `lp-summary-data.json` from there, as any rebuild does.

## Steps

Steps 2–4 each carry a network round-trip. Post a one-line status after each — connecting, checking the data, rendering, publishing. The build asks nothing it does not need: the only question after the firm is the branding follow-up (5f), once the page is live.

### 1. Identify the Carta connector
Scan the tools available in the conversation (system-reminder blocks) for `mcp__claude_ai_<connector>__call_tool` that also has a matching `…__welcome`. None found → tell the user you checked the conversation's tool list for a Carta connector (`call_tool` + matching `welcome`) and found none, point them to connect one via their claude.ai connector settings, and stop (error table: *No connector found*). Exactly one → use it. Multiple → ask the user which.

Keep that connector's **display name** as `<CARTA_MCP_SERVER>`. The artifact runtime addresses a connector by display name and the tool names are bare verbs (`call_tool`, `welcome`). Never substitute a UUID or an `mcp__…__` tool name — the runtime rejects both.

### 2. Call welcome and resolve the firm
Call `mcp__<SERVER>__welcome(_instrumentation={"plugin": "carta-investors", "skills": ["carta-lp-summary"]})` — every run, including a refresh. If it fails, tell the user what `welcome` returned and that the page cannot resolve firm context without it, then stop (error table: *`welcome` fails*).

> **Checkpoint**: once `welcome` succeeds, call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lp-summary", checkpoint_label="skill_started")`. A branding request skips this: *Brand the LP profiles* step 1 sends it only when the page must be built first. Each build run records each checkpoint at most once, and exactly one of `skill_finished` or `skill_failed`; a refresh or republish later in the same run does not checkpoint again. Checkpoints carry no firm, LP or amount. If a checkpoint call fails, carry on.

**Resolve the firm the user means, even if another firm is active.** Row access follows the active firm, so pick the firm before any query runs. Call `list_contexts`, passing the name if the user gave one:

```text
list_contexts({"firm_name": "<firm_name>"})
```

Read `firms` and `active_firm_id` from the structured result. For a Carta staff account the name is a search across all firms; for everyone else it is ignored and you get their own firms, so match the name yourself.

- **Exactly one match** → use it and say which firm you are building for.
- **Several match** → ask with `AskUserQuestion`, one option per firm.
- **None match** → say which name you searched, list up to five firms they can access, and stop (error table: *Named firm not found*).
- **No firm named** → take the single firm, or the one whose `is_active` is true, and confirm it in the same turn. With several firms and none active, ask. An empty list is normal for a staff account, so ask which firm rather than stopping.

If that firm is not already active, switch before going on:

```text
set_context({"firm_id": "<firm_uuid>"})
```

Carry its name into `firm_name` and its UUID into `firm_context_id`. The artifact re-pins the context on every load, because the viewer's connector opens on whatever firm they last used.

Every Carta tool call in this skill carries `_instrumentation`.

**Then, once, tell the user what they are getting** while the rest builds — before Step 3's query, in this wording with the firm's name:

> While I build it, here's what you get with **<firm_name>'s LP Summary**:
> - An overview up top: what LPs still owe you, what you've distributed (and DPI), and how concentrated your LP base is.
> - Every limited partner in one list, with commitments and any wire that needs attention.
> - Each LP's capital, returns (TVPI, DPI, IRR) and fund positions in one view.
> - Estimated exposure: the companies, sectors and regions their money is in.
> - One-page LP profiles to export as PDFs before a call.

### 3. Validate the data in one query
The schema is known (below), so there is no discovery pass. Run this once; it proves the table names resolve, proves the firm has limited partners, and yields `firm_warehouse_id`:

```text
call_tool({"name": "dwh__execute__query",
           "arguments": {"sql": "<SQL>", "format": "markdown"},
           "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-lp-summary"]}})
```

The param key is `sql`, not `query`. `format` accepts `"markdown"` / `"ndjson"`. SELECT only. No firm filter — row access scopes it.

```sql
SELECT f.FIRM_ID AS firm_id, COUNT(DISTINCT p.FUND_UUID) AS funds, COUNT(*) AS lp_accounts
FROM FUND_ADMIN.PARTNER_DATA p
JOIN FUND_ADMIN.FUNDS f ON f.FUND_UUID = p.FUND_UUID
WHERE p.IS_LIMITED_PARTNER AND p.IS_ACTIVE
  AND (f.SERVICE_STOP_DATE IS NULL OR f.SERVICE_STOP_DATE > CURRENT_DATE())
GROUP BY f.FIRM_ID
```

- One row → call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lp-summary", checkpoint_label="data_checked")`. Its `firm_id` is `firm_warehouse_id`. **It is a different ID from `firm_context_id`** for the same firm; neither can be derived from the other. The artifact pins the firm in its SQL with this id and refuses to render any page carrying another firm's rows.
- Several rows (a staff account scoped to nothing) → you did not pin a firm in Step 2; go back and do.
- Zero rows → tell the user the firm has no active limited partners in this context and stop (error table: *No limited partners*).
- A table or column error → run `call_tool({"name": "dwh__list__tables", "arguments": {}, "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-lp-summary"]}})`, find the datashare name for the missing table (the same table with a `FUNDADMIN_DATASHARE_` prefix is the usual variant), put it in `tables`, and re-run once. If it still fails, stop (error table: *Table not found*).

Do **not** put these numbers in the artifact. It re-fetches on open.

### 4. Assemble the config
```text
{ mcp_server: "<CARTA_MCP_SERVER>", firm_name: "<firm resolved in step 2>",
  firm_context_id: "<firm UUID from list_contexts>",
  firm_warehouse_id: "<firm_id from step 3>",
  artifact_title: "<firm_name> — LP Summary",
  origin: "<home when Carta Home invoked this skill, otherwise chat>",
  home_url: "<Carta Home's URL when Carta Home gave you one, otherwise omit>",
  tables: { funds: "FUND_ADMIN.FUNDS", partners: "FUND_ADMIN.PARTNER_DATA",
            nav: "FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS",
            contacts: "FUND_ADMIN.PARTNER_CONTACTS",
            investments: "FUND_ADMIN.AGGREGATE_INVESTMENTS",
            underlying: "FUND_ADMIN.UNDERLYING_INVESTMENTS",
            entity_links: "FUND_ADMIN.CORPORATION_ENTITY_LINKS_V2",
            corporations: "FUND_ADMIN.CORPORATION_BASIC_INFO_V2",
            tags: "FUND_ADMIN.INVESTMENT_TAGS" } }
```

The config may also carry a `brand` object (the page theme and the PDF export), or `brand_declined` when the build's branding offer (5f) was turned down. Never write either by hand: `scripts/brand_assets.py` adds them (*Brand the LP profiles*, 5f) and 5b carries them forward.

`firm_context_id` and `firm_warehouse_id` are both required: without either the page shows an error and loads no rows, rather than querying unpinned. Table names must be plain identifiers (letters, digits, `_`, `.`); the artifact refuses anything else because they are placed in SQL. `artifact_title` becomes the page's `<title>`; it travels in this file, never on the command line, so a firm name with quotes or `$` stays intact.

### 5. Render the artifact (deterministic — via `render_artifact.py`)
The template stays out of your context: a bundled script reads it, applies the XSS-safe escaping, fills in the title and writes the finished HTML. **You write only the small config file and run the script — never load or emit the template, and never hand-author the escaping.**

**5a. Locate the workspace.** Each firm gets its own folder, named by the `firm_context_id` Step 2 resolved, so a firm's config, and the brand or declined offer in it, survives builds for other firms:
```bash
FIRM_ID="<firm_context_id>"
if [ -d "$HOME/mnt/outputs" ] && [ -w "$HOME/mnt/outputs" ]; then WORKDIR="$HOME/mnt/outputs/carta-lp-summary/$FIRM_ID"
elif command -v carta >/dev/null 2>&1; then WORKDIR="$(carta workspace cache carta-lp-summary | jq -r .)/$FIRM_ID"
else WORKDIR="${TMPDIR:-/tmp}/carta-lp-summary/$FIRM_ID"; fi
mkdir -p "$WORKDIR"
```
The renderer is `${CLAUDE_PLUGIN_ROOT}/scripts/render_artifact.py` (the plugin's own `scripts/`, not this skill's) and the branding script is `${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-summary/scripts/brand_assets.py`. Bash reaches both paths on every surface, Cowork included, so do not search for them. If `uv`/Bash is unavailable or the renderer does not resolve, use the inline fallback (5d).

**5b. Write the config.** `Write` the step-4 config as compact JSON to `$WORKDIR/lp-summary-data.new.json`, then keep any firm branding the last build embedded (see *Brand the LP profiles*) and put the new file in place:
```bash
if [ -f "$WORKDIR/lp-summary-data.json" ]; then uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-summary/scripts/brand_assets.py" carry --from "$WORKDIR/lp-summary-data.json" --to "$WORKDIR/lp-summary-data.new.json"; fi
mv "$WORKDIR/lp-summary-data.new.json" "$WORKDIR/lp-summary-data.json"
```
`carry` copies the brand — and a declined offer — only when both configs are for the same `firm_context_id`: the per-firm workdir already keeps firms apart, and this check guards it, so one firm's logo never reaches another's page.

**5c. Render.**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/render_artifact.py" --workdir "$WORKDIR" --template "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-summary/references/artifact_template.html" --in lp-summary-data.json --out lp-summary.html
```
It prints the absolute path of the HTML. Branch on the exit code:

| RC | meaning | next move |
|----|---------|-----------|
| 0 | HTML written; path on stdout | publish (5e) |
| 1 | config file missing / bad JSON, or `artifact_title` missing | re-check 5b, retry once |
| 4 | bundled template, or the vendored jsPDF it inlines, not found | inline fallback (5d) |
| 14 | template token count is wrong (drift) | stop; tell the user the bundled template has drifted and needs a fix from the skill's maintainer |

If the RC=1 retry also fails, stop and offer to escalate rather than retrying further.

**5d. Inline fallback** (only when the renderer does not resolve or the runtime blocks subprocess): load the template with `read_skill(file_path="references/artifact_template.html")`, escape the compact config JSON as the template's header comment documents (the `\uXXXX` form for `&` `<` `>` `'` — **not** HTML entities), replace the single `__LOAN_DATA__` placeholder, replace the single `__ARTIFACT_TITLE__` placeholder with the config's `artifact_title` (HTML-escaped), then publish. Leave the `/* __VENDOR_JS:jspdf.umd.min.js__ */` marker as it is: without the inlined jsPDF the page cannot make PDFs, and Export copies a table instead; leave `/* __MCP_UI_TRACKER_JS__ */` too: without the inlined tracker the page sends no usage analytics.

**5e. Publish the artifact.** Unless Carta Home gave you a URL, call `Artifact({action: "list", scope: "mine"})`; if an artifact titled exactly **`<firm_name> — LP Summary`** is already published, keep its `url` and tell the user you are refreshing it in place before you publish over it. That is the title the rendered page's `<title>` carries, and the tag always wins over the `title` parameter, so looking for anything else publishes a duplicate every run. Another firm's page is not a match. Then publish:

```
Artifact({
  file_path: "<path printed by the script>",
  url: "<url from the list or from Carta Home — omit entirely on a first publish>",
  title: "<firm_name> — LP Summary",
  description: "Limited partners side by side with each one's capital, performance, fund positions and exposure — fetched live from Carta.",
  icon: "users",
  label: "Refreshed for <firm_name>",
  capabilities: {
    mcp: { servers: [{ server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "welcome", "set_context", "read_tool", "track_ui_event"] }] },
    downloads: true
  }
})
```

All five tools **must** be in the grant, or the page loads and the matching call rejects with `not_in_manifest` (`read_tool` serves the update banner; `track_ui_event` carries the page's usage analytics, which the page drops silently without it). `downloads: true` lets Export save its PDFs; a view without it copies the profiles as a spreadsheet table instead. Keep `title` and `icon` stable across redeploys, and restate the whole `capabilities` object every time. Once the publish succeeds in a build run, call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lp-summary", checkpoint_label="skill_finished")`. Give the user the URL and say the page pulls fresh numbers each time it is opened, briefly. Then 5f, and nothing else after.

**5f. Offer branding, once — after the page is live.** This is the main way a firm's PDFs get branded: most are branded here, before anyone opens Export. Ask only after the URL is in the user's hands, so the build never waits on it. If the config has neither `brand` nor `brand_declined` (`jq 'has("brand") or has("brand_declined")' "$WORKDIR/lp-summary-data.json"` prints `false`) and Carta Home did not invoke you, ask with `AskUserQuestion`: **"Want exports to carry your logo? I can pull it from your website."** — *Yes, pull it from our website* / *Use a deck I'll drop in* / *Not now*. Whenever the offer ends without a brand, record that with the decline command so a rebuild does not ask again:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-summary/scripts/brand_assets.py" decline --config "$WORKDIR/lp-summary-data.json"
```
- **Yes** → follow *Brand the LP profiles* steps 2–5 with the website as the source (it runs `carta-investors:carta-brand-extraction` and republishes the same page). If the user cancels at step 3, or no brand is applied, run the decline command above and stop.
- **Use a deck I'll drop in** → ask the user to drop the pitch deck or LP letter (PowerPoint (`.pptx`, `.ppsx`, `.potx`) or PDF) in the chat, then follow steps 2–5 with the deck as the source. If no deck arrives, the user cancels at step 3, or no brand is applied, run the decline command above and stop.
- **Not now** → run the decline command above and stop.

## Brand the LP profiles

Once a brand is on file the page itself wears it: the firm's logo in place of the Carta mark (the eyebrow keeps "Powered by Carta") and its colours on the progress bars, and, for a brand set up from a brand board, its fonts too (a brand from `apply` leaves the page's fonts alone). Export's PDF carries the brand as well, as the firm's template card. The build offers it once, as a follow-up after the page is live (5f). With no brand on file, the page stays Carta-styled and the Export dialog's Template list shows a dashed *Your firm* slot whose *Copy setup prompt* copies **"Brand my LP profiles with <firm_name>'s branding"** for the viewer to paste here. With a brand on file, the slot becomes the firm's template card (the default, remembered per viewer) beside *Carta · Standard layout* (the unbranded PDF).

When the user asks to brand their LP profiles, from their website or from a deck they drop in ("brand my LP profiles from this deck"), or says yes in 5f:
1. Resolve the firm as in Steps 1–2 (without the intro: the page is not being built) and `$WORKDIR`, that firm's own folder, as in 5a (already done when you come from 5f). The page must already exist (`$WORKDIR/lp-summary-data.json`); if it does not, build it first (Steps 3–5, skipping 5f), then come back.

   A branding request on a page that already exists is not a build: it sends none of `skill_started`, `data_checked`, `skill_finished` or `skill_failed`, only the source checkpoint in step 2. When the page does not exist yet, the build it runs first is a build: send `skill_started` before Step 3, then that build's checkpoints as usual.
2. Look for the firm's saved brand board first: `mcp__<SERVER>__read_tool(name="fa__get__brand_board")` once Step 2's `set_context` has run, the same board `carta-agm-deck-builder` reuses. A board found there is the source (say so in one line, and re-extract only if the user asks); an error or no board means there is none, so go on. It carries every brand colour by role and the firm's `@font-face` files; read its `typography` and pick the **heading font** and the **body font** (the families the firm's own site uses for headings and for text). Otherwise pick the source, then invoke `carta-investors:carta-brand-extraction` with it. The source is a pitch deck or LP letter the user attached (a PowerPoint (`.pptx`, `.ppsx`, `.potx`) or PDF), else the one chosen in 5f. With neither, as when the request is the Export dialog's pasted *Copy setup prompt*, ask once with `AskUserQuestion`: **"Where should the branding come from?"** — *Pull it from our website* / *Use a deck I'll drop in*. For the website, ask for the URL if you do not have it. This holds however the request arrives: never fetch the site, read the deck or choose colours yourself instead. **A logo file the user provides takes priority** over any extracted one, as in `carta-agm-deck-builder`. From its result pick one logo (a PNG/SVG, preferably on a transparent or white background), the **accent colour** (`#RRGGBB`) and the heading font family:
   - **Website:** its primary brand colour and heading font.
   - **PowerPoint:** the first accent candidate, its heading font, and the first logo candidate. These are exact.
   - **PDF:** the first accent candidate and logo candidate, no font. Tell the user the colour is a best guess from the PDF.

   When a deck gives no accent candidates, show the logo alone at step 3 and ask the user for the colour; with none, leave out `--accent`.

   Record which source was used, without a file name, firm or colour in it: `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lp-summary", checkpoint_label="brand_source_website")`, or `checkpoint_label="brand_source_deck"` for a deck. `<SERVER>` is the connector from Step 1. If the call fails, carry on.
3. Show the user the logo, the colours and, for a brand board, the two fonts, and ask them to confirm (`AskUserQuestion`: *Use this branding* / *Use a different logo or colour* / *Cancel*). With fonts, say that these are the firm's own font files from its site and that the firm should be licensed to embed them in documents; a commercial typeface may not allow it. Do nothing more until they confirm.
4. Embed the confirmed brand in the page config. The script writes it into the file itself — the logo as a `data:` URI (artifacts cannot load external images) and the display font only if its TTF downloads from Google Fonts — so neither the base64 nor the firm name passes through the shell:
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-summary/scripts/brand_assets.py" apply --config "$WORKDIR/lp-summary-data.json" --logo "<logo file path>" --accent "<#RRGGBB>" --font "<font family>"
   ```
   Use `--logo-url "<https URL>"` instead of `--logo` for an extracted logo you have not saved. Leave out `--font` when the font is not on Google Fonts. RC 1 prints why (not an image, over 1 MB, a malformed colour); fix it and run again. When the summary it prints carries a `note`, the font could not be embedded: tell the user the PDF uses the standard typeface.
   With a brand board, use `apply-board` instead: it embeds the board's primary, secondary and text colours, the heading and body fonts (the board's files, or Google Fonts for a family the board has none for; a file that is not TrueType is converted for the PDF) and the logo:
   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-summary/scripts/brand_assets.py" apply-board --config "$WORKDIR/lp-summary-data.json" --board "<brand board JSON file>" --heading-font "<heading family>" --body-font "<body family>" --logo "<logo file path>"
   ```
   When the user chose a different colour at step 3, add `--accent "<#RRGGBB>"`; it replaces the board's primary colour.
   Write the board to a file under `$WORKDIR` first (the `brand_board` value as JSON), so its contents never pass through the shell. A `note` in the summary names a font left out or one the PDF cannot use; tell the user which text then keeps the standard typeface.
5. Render and republish to the same page (5c and 5e); the brand rides in the config, and 5b carries it to every later rebuild, so it is extracted once.

What the brand changes. On the page: the heading and body fonts, from a brand board only (a family with no file on the board or on Google Fonts keeps the page's own), the firm's logo beside the eyebrow "Powered by Carta", and its accent on the progress bars (only where it reads as a graphic on white; dark mode keeps the page's colours) over a pale tint of its secondary colour. In the PDF, only when Branding is the firm: the firm's logo top-left in the header (max 32pt tall; the firm's name in text if the logo will not load); the accent on the LP name (only if it clears WCAG AA on white — otherwise it stays the text colour), the section rules and the called and exposure bars, the header band's last third in the secondary colour; the heading font on the LP name and the document title, the body font on everything else (Bold where the board has a Bold face), body text in the firm's text colour when it is dark enough to read (7:1 on white); a Powered by Carta lockup beside the page numbers. Table rules are never branded.

## How the numbers are built

The artifact reads these tables through `dwh__execute__query`, each pinned to the firm, and does the arithmetic in the page.

- `FUND_ADMIN.PARTNER_DATA` — one row per LP per fund: family (`FIRM_PARTNER_GROUP_ID` / `_NAME`), entity type, country and state, earliest commitment date, committed (`TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT`), called (`TOTAL_CAP_CONTRIBUTION`), distributed (`TOTAL_DISTRIBUTION`). Wire fields (`HAS_CONFIRMED_WIRE_INSTRUCTIONS`, `HAS_WIRE_SETUP`, `WIRE_CONFIRMATION_DATE`, `WIRE_INSTRUCTIONS_ADDED_DATE`) load in a separate query, so a viewer who cannot read them still gets the rest of the page.
- **The profile** rolls the family's fund records up per `FIRM_PARTNER_GROUP_ID`. Investor type shows the shared value, "Mixed (n)" when the funds disagree, or "—" when none is recorded. Carta records no headquarters, so location shows the LP's HQ: the location most of its fund records give (a tie goes to the largest commitment), with the others on hover. LP since is the earliest commitment date across the funds, ignoring placeholder dates before 1900.
- `FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS` — each partner's latest month gives NAV, cumulative paid-in and distributions (net TVPI and DPI) and the as-of date; every partner's NAV at the fund's latest month is the fund NAV look-through divides by. The months with money moving, plus today's NAV, are the cash flows behind net IRR.
- `FUND_ADMIN.PARTNER_CONTACTS` — every contact on each LP account, name and email, flagged primary or not. The table has no role or title column, so none is shown.
- `FUND_ADMIN.AGGREGATE_INVESTMENTS` — active holdings per security (`ASSET_NAME`) with their remaining value (fair value) and cost (`TOTAL_COST`) in the fund's currency. A position in the fund's own currency reads the native columns, because the base-currency columns are not populated for it (mostly 0); only a foreign-currency position reads `BASE_CURRENCY_REMAINING_VALUE` / `BASE_CURRENCY_TOTAL_COST`. One with no converted value is counted in a note, never guessed; a cost that is not recorded reads "—".
- `FUND_ADMIN.UNDERLYING_INVESTMENTS` — which of the firm's own funds a fund-of-fund holding is, so a feeder passes through to its master (matched by fund name when no link is recorded).
- `FUND_ADMIN.INVESTMENT_TAGS` — the firm's Industry or Sector tag, each company's sector.
- **Geography** (Exposure's third grouping, offered only when the LP's companies in scope include one whose recorded country — HQ, else the firm's Country tag — is not the US): the firm's own `FUND_ADMIN.INVESTMENT_TAGS` Geography or Region values as written (a tag's first value, trimmed; category matched case-insensitively), else its Country values — with spellings of one country merged into one row (US, USA, United States and United States of America; UK and United Kingdom; Cayman and Cayman Islands; BVI; UAE; Korea; The Netherlands), and any other value left as written — else each company's HQ `COUNTRY` from `FUND_ADMIN.CORPORATION_BASIC_INFO_V2` (via `CORPORATION_ENTITY_LINKS_V2`) as US / Non-US. One source for the whole firm, so a company without a value in it reads Unknown; nothing is inferred and Carta's internal sales regions are not used. Groups sort by estimated NAV with Unknown last; written-off companies with a recorded cost stay in their group at $0. A note under the table names the source.
- `FUND_ADMIN.FUNDS` — fund name, vintage year (the PDF's Fund positions) and **reporting currency**. Funds Carta no longer services are left out.

**Look-through is an estimate.** The LP's share of a fund is their NAV over the fund's NAV; it multiplies the fund's value in each company, and companies are summed across the LP's funds. A security's value and cost scale by the same share. The NAV the named holdings do not account for (cash, fees, other assets) shows as Exposure's "Other" row, so the % column adds up to 100%.

**Row volume.** Each load pages 500 rows at a time, up to 200 pages per table, with `LIMIT` and `OFFSET` written into the SQL (the connector's own `limit` and `offset` arguments do not keep a query's `ORDER BY` between pages, so pages overlap and rows go missing). Every paged query therefore sorts on a unique key. Past the page cap the page says the figures are partial instead of showing a silent subset.

## Error table

Once `skill_started` is sent, every stop before `skill_finished`, whether or not this table lists it, first calls `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lp-summary", checkpoint_label="skill_failed")`. A stop before `skill_started` (no connector, `welcome` fails) sends nothing. The artifact rows describe the published page, which has its own tracking.

| Symptom | Cause | Tell user |
|---|---|---|
| No connector found (Step 1) | No `call_tool`/`welcome` pair in the conversation's tool list | No Carta connector is available; connect one via claude.ai connector settings |
| `welcome` fails (Step 2) | Carta session not live, or identity/firm context unresolved | What `welcome` returned; retry once the session is confirmed live |
| Named firm not found (Step 2) | The name matches none of the firms the user can access | Which name was searched, which firms they can access, and to try again with one of those |
| No limited partners (Step 3) | The pinned firm has no active LP accounts | There are no active limited partners for this firm in this context |
| Table not found (Step 3) | A table is unknown at this warehouse layer and discovery found no variant | LP data is not available in this context |
| "Could not switch Carta to this firm" (artifact) | The page could not set the viewer's Carta session to this firm | The page stops rather than showing an empty list; reopen it, and check the viewer can access the firm |
| "The Carta session changed firms" (artifact) | Session's active firm changed while the page was loading: another firm's rows came back, or the firm check before or after the load found none | The render is refused rather than painted; reopen the page to reload under the current firm |
| Wire status reads "Restricted" (artifact) | The viewer's role cannot read wire data, or the wire load failed (the page notes it) | Expected for that role; someone with access to wire data sees the status. With the note, reopen the page to retry |
