---
name: carta-lpa-audit
description: >-
  See every LPA and side letter across a firm's funds, with the terms they state, in one table: management fee, carry, hurdle, fund term and investment period per fund, and each fund's side letters, LP roster and GP in a side panel. Flags funds with a missing LPA, partial data or a name mismatch, and side letters that match no fund. Reads the terms Carta extracted from the firm's own documents. For a GP, fund manager or Carta staff looking at a firm's funds. TRIGGER: "show me all my LPAs and side letters", "LPAs and side letters for {firm}", "what are the terms in our LPAs", "compare fees and carry across my funds", "which funds are missing an LPA", "what side letters have our funds granted", "LPA audit for {firm}". NOT FOR: an LP's own documents (use carta-lp-dashboard); documents a fund shared with its LPs (use carta-gp-lp-documents); downloading one file (use carta-download-firm-document).
version: 0.5.0
model: sonnet
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  # The connector check's observed call.
  - mcp__carta__welcome
  - mcp__claude_ai_Carta__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  # Carta MCP — registration prefix varies by host (Claude Code / Claude.ai / Cowork / public)
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__list_contexts
  - mcp__carta__list_accounts
  - mcp__carta__set_context
  - mcp__carta__skill_checkpoint
  - mcp__claude_ai_carta__call_tool
  - mcp__claude_ai_carta__read_tool
  - mcp__claude_ai_carta__list_contexts
  - mcp__claude_ai_carta__list_accounts
  - mcp__claude_ai_carta__set_context
  - mcp__claude_ai_carta__skill_checkpoint
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__list_accounts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__skill_checkpoint
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__skill_checkpoint
  # Cowork
  - Artifact
  # Local execution
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lpa-audit/scripts/render-artifact.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lpa-audit/scripts/process.py" *)
  - Bash(pwd)
  - Bash(carta workspace cache *)
  - Bash(command -v *)
  - Bash(test -d *)
  - Bash(test -r *)
  - Bash(date *)
  - Bash(mkdir -p *)
  - Read
  - Write
  # Interaction
  - AskUserQuestion
  - Skill(carta-investors:carta-upload-firm-document)
  - ToolSearch
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.31.18</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If a path is still unreplaced or a file is still not found, tell the user "I couldn't load this skill's files. Reconnect Carta or update the plugin, then ask again." and stop. This is the one message for a missing file in either mode: don't fall back to text tables, copy the script, or hand-write the page, and don't search the disk for the files.

<!-- Part of the official Carta AI Agent Plugin -->

# Fund terms & LPAs

Show extracted LPA terms for every fund the firm manages, as one sortable table — management fee, carry, hurdle, fund term, investment period and side-letter count, one row per fund, so terms compare down a column. Click any row to open that fund's side panel: economic terms, side letters, LP roster and fund identity. Coverage gaps (missing, partial, name-mismatch or no-documents LPA, series governed by a parent agreement, side-letters-without-LPA) surface as row badges and summary tiles at the top that double as filters.

> **Required output: the interactive HTML artifact (Mode A).** Every invocation of this skill must build the artifact and deliver it. The text-only Mode B is a *fallback for genuine execution failures only* — never a routing preference. If Mode A fails, tell the user what specifically failed before rendering Mode B. Do not decide "this user probably wants text" based on how they phrased the request. See Step 2 for the rules.

---

## UX patterns [PATTERN base v0.1.0]

### Typography and text formatting [PATTERN text v0.0.8]

Follow these rules every time except for machine-readable output (JSON, XML):

- **Casing:** Sentence case always — headings, titles, table column heads. No title case.
- **Punctuation:** No period at the end of headings or titles.
- **Bullets:** Always use `•` — never `-` or `*` for user-facing bullets. Numbered lists use `1.` `2.` `3.`
- **Dates:** `Mmm D, yyyy` format (e.g. `Jan 5, 2024`).
- **Amounts:** Rendered with a currency prefix (`$123,456`-style), negatives parenthesised (`($445,443)`). A per-extraction currency is read from `RAW_JSON` (not `ATTRIBUTES`, which is unpopulated for these two document types — see Caveats): the `currency_code` siblings (a small share of documents) first, else the free-form `currency` value when it is exactly a three-letter ISO code (e.g. `EUR`). When known, the amount renders with that currency's own symbol or code (e.g. `€123,456`). When neither yields a code, the fund's Carta reporting currency (`fa__list__entities`' `currency`, carried in the funds file) fills it: on the agreement, each LP commitment, and a side-letter commitment taken from the fund's own roster, never on a letter the fund received as an investor. A currency the document states always wins. When none of these is known, the currency is unknown: render the number bare (`123,456`) and never assume USD. Never sum amounts across currencies. Side letter `capital_commitment` fields arrive from the pipeline pre-formatted (e.g. `"MYR 15,000,000"`) and are displayed verbatim — populated on a minority of side letters (see Caveats).
- **Percentages:** `X.XX%` (two decimals for rates; one decimal is fine for large percentages).
- **Null values:** Use `—` (em-dash), never `N/A`, blank, or prose like "not recorded". The exception is a fund-table or Step B2 tear-sheet cell (fee, carry, hurdle, fund term, investment period) on a fund whose terms were extracted: write "Not found", never "None" — an empty extraction can't tell a term the agreement doesn't have from one that wasn't read. A stated 0 still reads "None", or "No fee (per LPA)" for the fee. Other tear-sheet rows (post-investment fee, waterfall, capital call notice) keep `—`. Carry tiers is omitted when null, and the drill-down tables omit any blank row (see Drill-down).

### Tables [PATTERN tables v0.0.12]

Always use Markdown tables for list output with more than one column.

- Numeric columns: right-aligned (header too).
- Text columns: left-aligned (header too).
- Add a single blank line after every table.
- Never use tables for lists of user actions — use `AskUserQuestion` instead.

### Writing style [PATTERN carta-writing-style v0.0.2]

Direct, calm, short sentences. Professional. No "please". Not sycophantic.

- Be clear — plain language, specific actions, understood on first read.
- Match mental models — use fund manager vocabulary; favor domain terms (LPA, GP, LP, hurdle, carry, waterfall).
- Be concise — say only what the user needs to move forward. No filler.
- Match tone to moment — neutral/direct for tasks; supportive for high-risk actions.
- Action-oriented language — buttons/links describe the action or outcome.
- **Never use "OK", "Submit", "Yes", or "No" as action labels.** Use specific verb + object.
- Never use humor for errors.

### Etiquette [PATTERN etiquette v0.0.6]

1. Always show the user a short (1–4 sentences max) summary of this skill's purpose, plus 2–3 brief bullets describing how it works, on first use.
2. After processing a request, summarize what changed. Then suggest 1–3 things the user might do next.

### Step transparency (required during execution)

After every major step, print a one-line status in plain language: what completed and what comes next.
Example: `Fund entities loaded across 8 funds. Looking up LPA extractions…`

Never go silent for more than one step. Never present results without a prior status line.

> **User-facing language — no internals, ever.** The user is a fund manager, not an engineer. Status lines, summaries, and error messages must use plain investor vocabulary only. **Never** expose any of the following to the user — not in a status line, a summary, an error, or an aside: query names, SQL, pagination, `total_rows`, row or byte counts, blob/file paths, "Snowflake"/"DWH"/"ndjson", latency or timing breakdowns, retries, UUIDs (including `DOCUMENT_ID`), or exit codes. Talk about *funds*, *LPAs*, *side letters*, and *terms* — never the machinery.

---

## Prerequisites

- **Carta MCP connection** — `list_contexts` and `list_accounts` available; the firm to audit is the one the request names or links, or the user's only firm; Step 1 asks when it can't tell.
- **Firm's fund entities** — the skill needs the firm's own fund vehicle names (via `fa__list__entities`) to scope the LPA audit. A firm with zero fund entities will hit the empty state.
- **LPAs uploaded and extracted** — the firm has LPAs (and optionally side letters) in Carta's Document Intelligence pipeline. Without any extractions, every fund lands in No documents.
- **Mode A needs the `Artifact` tool**; without it, Mode B gives a full text answer, not a degraded one.

## Accessibility

The Mode B text path is fully accessible in any text environment — all output is plain Markdown tables.

The Mode A interactive HTML artifact has **not yet been formally audited for WCAG 2.1 AA compliance.** Known considerations:

- Color-only encoding is avoided: every status is a text badge.
- Each fund name is a real `<button>` with `aria-expanded` / `aria-controls`. Opening the panel moves focus to its title; Escape closes it and returns focus to the row. ↑/↓ step between funds.
- The panel's previous, next and close controls are real `<button>`s with `aria-label`s; the "N of M" position is an `aria-live` region.
- The fund table uses `<thead>` / `<tbody>` semantics; its sort headers are `<button>`s and expose `aria-sort`.

Users who need a WCAG-compliant text view should request Mode B explicitly ("text only", "no file").

---

## When to use

- "Show me my fund terms"
- "What's in our LPAs?"
- "Look at my fund terms"
- "Fund terms and LPAs"
- "Walk me through Fund III's LPA"
- "What side letters are on file for [fund]?"
- "Compare my funds' management fees"
- "Compare my funds' carry"
- "Review our LPAs"
- "Which of my funds are missing an LPA?"
- "LPA audit"

Trigger phrases anchor on *fund terms*, *LPA*, *side letters*, or a specific fund name. The skill defaults to the data-first fund-terms view; the coverage-gap questions (which funds are missing an LPA, which are partially extracted) still route here and get surfaced inline in the fund table.

---

## Step 0: Announce

Open every invocation with:

> "I'll pull the extracted LPA terms for every fund you manage — management fee, carry, hurdle, waterfall, term, side letters — into one table. Missing LPAs and partial extractions surface inline. Side letter economic provisions (fee and carry reductions, waivers, hurdle changes) are extracted and compared against each fund's own LPA."

Then proceed immediately to Step 1.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lpa-audit", checkpoint_label="skill_started")` before proceeding. `<SERVER>` is the MCP server name you're using for `list_contexts` in this session.

Each run records each checkpoint at most once, and exactly one of `skill_finished` or `skill_failed`. A step reached again later in the same run (a re-render, a follow-up question, a drill-down, a re-publish) does not checkpoint again.

---

## Step 1: Establish firm context

1. Pick the firm the request is about, and never silently audit another one:
   - If the request carries a Carta firm link (`…/investors/firm/<carta_id>/…`), call `list_contexts(firm_id="<carta_id>")` and use the row whose `carta_id` equals it. Carta staff have no firm memberships, so this is how a staff login reaches a client firm.
   - Otherwise call `list_contexts`. If the request names a firm, use the one context whose name matches it. If no firm is named and exactly one context comes back, use that one. In any other case, ask which firm with `AskUserQuestion`, listing the contexts' names.
   - If no context matches the firm the request names or links, stop with: "I couldn't find <the firm the user named> among the Carta firms this login can open. If you are Carta staff, paste the firm's Carta link (the `/investors/firm/<number>/` page) and I'll use that." That list is a synced copy that can lag a new grant, so never present it as a lack of access.
   - If no context comes back at all, stop with: "I couldn't find any Carta data associated with your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, [contact Carta Support](https://support.carta.com/kb/guide/en/how-to-get-support-with-carta-help-T8DEfuxhi9/Steps/3724508)."
2. Call `set_context` with the chosen firm's `id`. That `id` is your `<firm_id>`, the sole filter both DWH queries scope on.
3. The chosen firm's display name is your `<firm_name>`.
4. Call `list_accounts` searching for `<firm_name>`. Find the entry with `type: "investment firm"`. Extract the numeric portion of its `id` (e.g. `"organization_pk:2645"` → `2645`) — this is `<org_pk>` for the documents link and the artifact's numeric Carta ID.
5. Retrieve the firm's own entities with `fa__list__entities` (via `read_tool`): **one call per entity type, all six, every run**, then merge the results. Pass `{"entity_types": "fund"}`, then `"spv"`, `"syndicate_spv"`, `"gp_entity"`, `"management_co"` and `"elimination"`.
   - **Never call it without `entity_types`, and never skip a type.** An unfiltered list for a firm with many entities is larger than the response limit and fails with "response too large". A skipped type silently drops all of its entities from the audit, so an SPV left out shows as if it had no LPA.
   - A type the firm doesn't use returns an empty list. That is expected; move on to the next type.
   - If one type's call still comes back "response too large", follow `${CLAUDE_PLUGIN_ROOT}/references/list-firm-entities.md` (the plugin's own `references/`, not this skill's — do not search for it).
   - For every entity keep its display `name`, its numeric `carta_id`, its `entity_type_string` and its `currency` (the fund's Carta reporting currency) — these are the `<firm_funds>`, and their names are the `<firm_fund_names>` the audit will be scoped to. Keep every entity, including GP, management-company and elimination entities: the artifact matches all of them and then sets aside the ones that never carry an LPA (see Step A2a).
   - If all six calls return no entities, stop with: "I couldn't find any funds on file for <firm_name>. [Contact Carta Support](https://support.carta.com/kb/guide/en/how-to-get-support-with-carta-help-T8DEfuxhi9/Steps/3724508) if you believe this is an error."
6. Resolve `<base_url>` from the current Carta MCP server context — never hardcode an environment URL. For the production MCP server (`mcp.app.carta.com`), `<base_url>` is the Carta production web app URL. For any other server, default to the same production URL.

**Pre-flight check:** confirm `<firm_id>` is a non-empty UUID string (matches `[a-f0-9-]{36}`). If not, stop with: "Could not determine your firm ID. Try reconnecting to the Carta MCP server."

> **Firm scoping is done in SQL, on `FIRM_ID` alone.** `<firm_fund_names>` is not a scoping input: it is what the fund-name matching transform (JS in Mode A, `process.py` in Mode B) matches the returned LPA fund names against, to decide which of the firm's funds each extraction belongs to, and which have no LPA at all. Every fund the firm manages needs to be in that list even when it has no extraction, or a missing LPA cannot be reported as missing.

Tell the user: `Firm context loaded: <firm_name>. Fetching LPAs and side letters…`

**Uploads offered in this skill.** Every "drop … into this chat" line in this skill (the artifact, the next-step text, the error-handling rows and the drill-down) follows two rules. Without a Bash tool (claude.ai chat), leave out the drop-in half and keep the Carta link: the upload can't reach the user's files there. Files the user drops or names during this conversation go to `carta-investors:carta-upload-firm-document` for `<firm_name>`, so it does not ask which firm.

---

## Step 2: Route

**The default output of this skill is the interactive artifact (Mode A). Proceed directly to Mode A Step A1.**

> **ALWAYS build the interactive artifact (Mode A). This is not a preference or a default — it is the required output of this skill.** Text-only tables are a fallback for genuine execution failures, never a choice you make based on how the request was phrased.

**Do NOT route to Mode B based on any of these signals:**

| User signal | What must happen |
|---|---|
| "just tell me" / "quick summary" | Still build Mode A. The artifact IS the quick summary — summary tiles at the top plus the fund table. |
| Asks about one specific fund by name | Still build Mode A. After the artifact opens, tell the user to click that fund's row. |
| "text only" / "no file" | Still build Mode A first. If the user re-affirms after seeing the artifact, then render Mode B tables as a supplement. |
| Speed / cost concern | Still build Mode A. The Live Artifact fetches its own data at render time and costs nothing extra in your context. |

**The ONLY legitimate reasons to fall back to Mode B:**

1. **Mode A execution actually fails** — Step A1's first check still finds no `Artifact` tool after loading it (a genuine, structural reason, not a judgment call about the environment), or `render-artifact.py` exits non-zero on a validation error (a missing plugin file is handled by the note at the top). Do not preemptively route based on "this might not work" — attempt Mode A, and only when a specific error surfaces, fall back with a plain-English explanation of what went wrong.
2. **The user explicitly asks for text-only AFTER seeing the artifact** — e.g. "the artifact didn't open, can I get this as a text table?"

**If Mode A does fail, tell the user what failed before falling back.** Example: `"I couldn't build the fund-terms view just now — I'll give you the terms as text instead."` Never silently downgrade, and never describe scripts, plugins, paths, or sandboxes while doing it.

---

## Mode A — Live Artifact

The artifact shows every fund the firm manages as a row in one sortable table, with coverage gaps (missing, partial, name-mismatch or no-documents LPA, series governed by a parent agreement, side-letters-without-LPA) as row badges and summary tiles that filter the table. A vehicle whose agreement states no fee or carry (an SPV, aggregator, feeder, blocker or side fund; see Caveats → *Partial LPAs*) gets its own "Vehicle agreement" badge and tile, not a gap. Clicking a row opens that fund's side panel — economic terms, side letters, LP roster with totals, fund identity — beside the table on wide screens and as a drawer over it on narrow ones, with previous/next to step through funds without closing it.

> **The page fetches its own data.** You issue no warehouse queries in Mode A. The rendered HTML calls Carta at runtime through `claude.use("mcp")`, pinning firm context and running the LPA and side-letter queries itself, then matches them against the firm's fund list in JavaScript. This is why Mode A costs the same for a 40-fund firm as for a 3-fund one — no rows ever pass through your context.
>
> Consequences worth holding onto:
> - There is no NDJSON blob to resolve, no `process.py`, and no data file to assemble.
> - Do **not** hand-write or edit the artifact HTML. Every render goes through `render-artifact.py`.
> - Do **not** pre-fetch LPA data "to check it worked". The artifact reports its own errors to the viewer.

### Step A1: Checks before building

Run both checks, and stay quiet about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session publish at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the connector name the page will call.

Both sit in the **plugin's** `references/` directory — `${CLAUDE_PLUGIN_ROOT}/references/`, alongside the other plugin-wide references. They are *not* under this skill's own `references/`. Read them by that exact path; don't search for them.

This skill has its own text answer, so a failed first check does not stop it and its stop message is not shown. If `Artifact` is still missing once that check has tried to load it, go to Mode B and open with one plain sentence: *"The interactive fund-terms view needs an up-to-date Claude Code or Cowork with Artifacts turned on for your organization, so here are the fund terms as text."* Say nothing about checks, modes, or sandboxes.

Store the `name` the connector gate resolves as `<CARTA_MCP_SERVER>`. Step A2 passes it to the render script and Step A3 puts it in the `capabilities.mcp` grant. It is one string; there is nothing to derive and nothing to keep in sync.

### Step A2: Render

**2a.** Write `<firm_funds>` from Step 1 to a JSON file in the session's current working directory, named `<firm-slug>-funds.json`. Contents are a JSON array with one object per entity:

```json
[
  {"name": "Acme Ventures Fund I, L.P.", "carta_id": 4218781, "entity_type": "Fund", "currency": "EUR"},
  {"name": "Acme Ventures Fund II, L.P.", "carta_id": 4237898, "entity_type": "Fund", "currency": "EUR"},
  {"name": "Acme Ventures GP, LLC", "carta_id": 4223606, "entity_type": "GP Entity", "currency": "EUR"}
]
```

`carta_id` powers each fund's "Open in Carta" link and must be digits; `entity_type` is `fa__list__entities`' `entity_type_string`, verbatim; `currency` is its `currency`, a three-letter ISO code or `null` (see the Amounts rule). Entities typed `GP Entity`, `Management Co` or `Elimination Entity` never carry an LPA, so the page lists them under "not audited" instead of reporting them as missing — unless a side letter was attributed to one, in which case it stays in the table. An entity whose name marks it as no fund vehicle (wire instructions, F/B/O or custodial account, trust, duplicate, two funds joined by "and" or "&", or the firm's own name; a name that adds "Fund" to the firm's, such as "<Firm> Fund, L.P.", is a fund) is listed the same way, but only when no agreement (its own or a parent's) matched it and no side letter was attributed to it. A bare name string is still accepted in place of an object; that entity gets no link, and only its name can set it aside.

Preserve each name verbatim — apostrophes, ampersands, commas and all. The script JSON-escapes hostile characters at substitution time. It is a file rather than a command-line argument because fund names contain apostrophes ("O'Brien Capital Fund, L.P."), which terminate shell single-quoting.

> **This file is required, not optional.** Unlike carta-co-investors' vehicles file, an LPA audit with zero known funds is a Step-1-level stop condition (Step 1 already stops if `fa__list__entities` returns nothing) — `render-artifact.py` rejects a missing or empty fund-names file rather than rendering an artifact with nothing to audit.

**2b.** The script is `${CLAUDE_PLUGIN_ROOT}/skills/carta-lpa-audit/scripts/render-artifact.py`. Run it by that full path and do not search for it: in Cowork, `Glob` and `find` cannot see plugin files, even though the anchored path runs.

**2c.** Render. Run it on one line, exactly as written below. `allowed-tools` matches the command text, so a shell variable, a different path, or a line break fails the allowlist and the call has to be approved by hand each time:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lpa-audit/scripts/render-artifact.py" "<CWD>/<firm-slug>-lpa-audit.html" "<firm-slug>-lpa-audit" "<CARTA_MCP_SERVER>" "<firm_id>" "<firm_name>" "<org_pk>" "<base_url>" "<CWD>/<firm-slug>-funds.json"
```

If the script file does not exist, follow the note at the top of this skill on plugin files that can't be found.

Positional arguments:

1. **Output path** — must be **absolute**, under the session's current working directory (`<CWD>`). Use `pwd` to resolve `<CWD>` if needed.
2. **Artifact ID** — the kebab-case slug naming this artifact. Must equal `<firm-slug>-lpa-audit`.
3. **Carta connector display name** — `<CARTA_MCP_SERVER>` from Step A1.
4. **Firm UUID** — from Step 1. The artifact calls `set_context` with this on every load, so the queries succeed even if the user switched contexts elsewhere.
5. **Firm name** — the human-readable name, shown in the page header.
6. **Firm Carta ID** — `<org_pk>` from Step 1, the numeric organization pk, for the documents deep link.
7. **Base URL** — `<base_url>` from Step 1.
8. **Fund names file** — the absolute path from 2a, also under CWD.

On success the script prints one stdout line: the absolute output path. It exits non-zero on any validation failure (bad UUID, non-numeric Carta ID, base URL with a path or a non-https scheme, unusable connector name, output or fund-names file outside CWD, missing/empty fund-names file). If it fails, tell the user in plain words what failed, then fall back to Mode B (Step 2) — do not hand-write the HTML. A missing template or missing placeholders means the plugin's files are broken: follow the note at the top of this skill.

**Slugification rules** (apply to the **firm name**, not any UUID):

1. Lowercase
2. Replace whitespace with hyphens
3. Strip non-alphanumeric characters except hyphens
4. Collapse consecutive hyphens
5. Trim leading and trailing hyphens

Example: `"Acme Capital Partners, L.P."` → slug `"acme-capital-partners-lp"` → output `acme-capital-partners-lp-lpa-audit.html`, artifact id `acme-capital-partners-lp-lpa-audit`.

Re-running the skill for the same firm produces the same artifact id and filename, so Step A3 updates the artifact in place.

### Step A3: Publish

> **The render script only writes the HTML file. Nothing picks up file changes on its own — you MUST publish after every render, or the reader keeps seeing the prior version.**

First look for an existing one:

```
Artifact({action: "list", scope: "mine"})
```

If a **<Firm Name> — LPA coverage audit** artifact is already published, keep its `url`. Then publish — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<absolute path printed by the render script>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "<Firm Name> — LPA coverage audit",
  description: "<Firm Name> — extracted LPA terms and side letter coverage across every fund",
  favicon: "📋",
  capabilities: {
    mcp: {
      servers: [
        { server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "set_context", "welcome"] }
      ]
    }
  }
})
```

All three tools must be in the grant, or the page loads and the matching call rejects with `not_in_manifest`. The artifact only calls `welcome` itself when the MCP reports a "session not initialized" error, then retries the original call once.

Keep `title` and `favicon` stable across redeploys, and restate the whole `capabilities` object every time: a non-empty object replaces the stored grant, so a tool left out is revoked.

### Step A4: Confirm

> Your fund-terms view for **<Firm Name>** is ready: [Open <Firm Name> — LPA coverage audit](<url the publish returned>)

Fill the link with the `url` the publish call returned. The side panel does not always open by itself, and this link is how the user reaches the page when it stays closed, so never say the page is loading or open in the sidebar.

Then a 3–5 bullet summary of what it shows — one sortable table of every fund's terms, coverage gaps (missing, partial, name-mismatch or no-documents LPA, series governed by a parent agreement, side-letters-without-LPA) as badges and summary tiles that filter the table, click any row for its side panel (economic terms, side letters, LP roster, fund identity) and step between funds with ↑/↓, plus search. Keep it brief; the customer can see the artifact. Skip the bullets on re-invocation if you've already shown them.

**Side letter caveat.** Always append once, right after the confirmation message:

> *"Each side letter lists what was extracted from it: fee and carry changes (with LPA comparisons where relevant), custom fee and carry schedules, MFN, excuse and transfer terms."*

**Provision-query follow-up.** Always append:

> *"Want to search across every fund's LPA terms and side letter provisions for a specific question — e.g. 'do any provisions prevent me from investing in defense tech?' or 'which LPs got reduced carry?' — just ask. See Step B4."*

> **Numbers live in the artifact, not in your reply.** Do not restate coverage counts, fund statuses, or fund names in chat — you have not seen them. The page queries Carta after your turn ends, so any figure you quote is invented.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lpa-audit", checkpoint_label="skill_finished")` once the publish in Step A3 has succeeded. Mode A has no `data_fetched` checkpoint — the page fetches its own data after your turn ends.

---

## Mode B — Text fallback

Render fund-by-fund tear-sheets as Markdown, one section per fund. Single fetch, single render.

### Step B0: Resolve workspace and check cache

Before fetching anything, resolve a stable, cross-platform working directory, `<WORKSPACE>`, where the audit cache lives. Run each command below as its own Bash call, exactly as written: each matches an `allowed-tools` entry, and a shell variable does not survive from one Bash call to the next, so write the resolved path into later commands literally.

1. `test -d "$HOME/mnt/outputs"` — succeeds in the Cowork sandbox, where `mnt/outputs/` under the session root is the folder the host can read too. `<WORKSPACE>` is that folder (expand `$HOME` with `pwd` if needed) plus `/carta-lpa-audit`.
2. Otherwise `command -v carta` — succeeds on a Claude Code laptop. Run `carta workspace cache carta-lpa-audit`; it prints a quoted path, which is `<WORKSPACE>` without the quotes.
3. Otherwise `<WORKSPACE>` is `<CWD>/carta-lpa-audit`, with `<CWD>` from `pwd`.

Then create it:

```bash
mkdir -p "<WORKSPACE>"
```

Do not hardcode `/tmp` — it breaks on Windows and is invisible to the Cowork host on macOS 26.5+.

**Cache check:**

```bash
date +%s && date -r "<WORKSPACE>/carta-lpa-audit-data.json" +%s
```

The cache is fresh when the two printed numbers differ by less than 3600. If the second command fails, there is no cache.

If the cache is fresh AND the cached `firmId` matches `<firm_id>`:
1. `Read` `<WORKSPACE>/carta-lpa-audit-data.json`.
2. Run `date -r "<WORKSPACE>/carta-lpa-audit-data.json" +%H:%M` and tell the user: `Using cached LPA data from <that time>. Preparing results…`
3. Skip B1, go to B2.

**Fall through to Step B1 (live fetch)** when the cache is absent, stale, or belongs to a different firm.

### Step B1: Fetch LPA data

**Fire three queries in parallel — issue all three `read_tool` calls in the SAME assistant turn.** Each is a single high-limit fetch — never paginate. Capture each `saved to …` path and check it from bash, as Response resolution below says.

> **CRITICAL — fetch ONCE per query; never re-issue with a different `offset`.** Re-typing the SQL for "page 2" reliably corrupts a token silently.

> **CRITICAL — always include the `FIRM_ID` WHERE clause below.** Without it Query T returns every firm's LPA rows, Query O every firm's operating-agreement rows and Query L every firm's side-letter rows, which is the tenant boundary. So an unscoped query is a data-exposure incident, not just a bug.

**Firm-scoping — how it works.** Every query scopes on `FIRM_ID = '<firm_id>'` and nothing else. `FIRM_ID` is constant across every row of an extraction, so a flat `WHERE` returns whole extractions — no sub-select is needed to pull the sibling rows in.

> **Do not add a second scoping leg.** Extractions still stamped with the `'fund_admin'` placeholder instead of a firm UUID (about one in ten — see Caveats) belong to no firm and are invisible to every one of them. That is a deliberate trade for real tenant scoping, and reaching them means matching extracted fund *names* against the firm's fund list in SQL — which scopes on text lifted out of a document rather than on the firm key, so it hands a firm any unattributed extraction whose fund name happens to resemble one of theirs, including another firm's.

**Query T — LPA extraction rows (ndjson):** every row for the LPAs belonging to this firm. `DOCUMENT_CURRENCY_CODE` is a per-extraction `COALESCE` over `RAW_JSON:...:currency_code` siblings (a small share populated). The pruned `RAW_JSON` also carries the free-form `currency` string, which `process.py` trusts only when it is exactly a three-letter ISO code. Both the bare and `extraction.`-prefixed shapes are tried since one extractor version wraps the whole payload a level deeper; see Caveats. `RAW_JSON` comes back pruned to the paths `process.py` reads (`OBJECT_CONSTRUCT` over `COALESCE(RAW_JSON:extraction, RAW_JSON)`, each leaf reduced to its envelope's `value`, each array to the fields read) and windowed to the extraction's first row (`ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1`, `NULL` on every other row) — `process.py` reads it (envelope-aware) as the only source for the fund/GP/LP/terms fields; see "RAW_JSON as the source" below and Caveats for why both the pruning and the windowing are load-bearing.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "limit": 50000,
  "response_mode": "inline",
  "sql": "SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, IFF(ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1 AND RJ IS NOT NULL, OBJECT_CONSTRUCT('currency', COALESCE(RJ:currency:value, RJ:currency), 'fund_info', OBJECT_CONSTRUCT('fund_name', COALESCE(RJ:fund_info:fund_name:value, RJ:fund_info:fund_name), 'state_of_formation', COALESCE(RJ:fund_info:state_of_formation:value, RJ:fund_info:state_of_formation), 'lpa_date', COALESCE(RJ:fund_info:lpa_date:value, RJ:fund_info:lpa_date), 'master_series', COALESCE(RJ:fund_info:master_series:value, RJ:fund_info:master_series), 'fund_purpose', COALESCE(RJ:fund_info:fund_purpose:value, RJ:fund_info:fund_purpose), 'registered_agent_name', COALESCE(RJ:fund_info:registered_agent_name:value, RJ:fund_info:registered_agent_name), 'principal_office_address', COALESCE(RJ:fund_info:principal_office_address:value, RJ:fund_info:principal_office_address)), 'document_metadata', OBJECT_CONSTRUCT('governing_law', COALESCE(RJ:document_metadata:governing_law:value, RJ:document_metadata:governing_law)), 'parties', OBJECT_CONSTRUCT('general_partner', OBJECT_CONSTRUCT('name', COALESCE(RJ:parties:general_partner:name:value, RJ:parties:general_partner:name), 'entity_type', COALESCE(RJ:parties:general_partner:entity_type:value, RJ:parties:general_partner:entity_type), 'state_of_formation', COALESCE(RJ:parties:general_partner:state_of_formation:value, RJ:parties:general_partner:state_of_formation), 'commitment_amount', COALESCE(RJ:parties:general_partner:commitment_amount:value, RJ:parties:general_partner:commitment_amount), 'commitment_percentage', COALESCE(RJ:parties:general_partner:commitment_percentage:value, RJ:parties:general_partner:commitment_percentage), 'address', COALESCE(RJ:parties:general_partner:address:value, RJ:parties:general_partner:address), 'members', TRANSFORM(RJ:parties:general_partner:members, x VARIANT -> OBJECT_CONSTRUCT('name', COALESCE(x:name:value, x:name)))), 'limited_partners', TRANSFORM(RJ:parties:limited_partners, x VARIANT -> OBJECT_CONSTRUCT('name', COALESCE(x:name:value, x:name), 'entity_type', COALESCE(x:entity_type:value, x:entity_type), 'commitment_amount', COALESCE(x:commitment_amount:value, x:commitment_amount), 'percentage_interest', COALESCE(x:percentage_interest:value, x:percentage_interest), 'address', COALESCE(x:address:value, x:address)))), 'carried_interest', OBJECT_CONSTRUCT('carried_interest_rate', COALESCE(RJ:carried_interest:carried_interest_rate:value, RJ:carried_interest:carried_interest_rate), 'preferred_return_rate', COALESCE(RJ:carried_interest:preferred_return_rate:value, RJ:carried_interest:preferred_return_rate), 'preferred_return_multiple', COALESCE(RJ:carried_interest:preferred_return_multiple:value, RJ:carried_interest:preferred_return_multiple), 'distribution_waterfall_type', COALESCE(RJ:carried_interest:distribution_waterfall_type:value, RJ:carried_interest:distribution_waterfall_type), 'waterfall_tiers', TRANSFORM(RJ:carried_interest:waterfall_tiers, x VARIANT -> OBJECT_CONSTRUCT('kind', COALESCE(x:kind:value, x:kind), 'percentage_to_gp', COALESCE(x:percentage_to_gp:value, x:percentage_to_gp)))), 'management_fee', OBJECT_CONSTRUCT('pays_management_fee', COALESCE(RJ:management_fee:pays_management_fee:value, RJ:management_fee:pays_management_fee), 'management_fee_rate_investment_period', COALESCE(RJ:management_fee:management_fee_rate_investment_period:value, RJ:management_fee:management_fee_rate_investment_period), 'management_fee_rate_post_investment', COALESCE(RJ:management_fee:management_fee_rate_post_investment:value, RJ:management_fee:management_fee_rate_post_investment), 'management_fee_basis_investment_period', COALESCE(RJ:management_fee:management_fee_basis_investment_period:value, RJ:management_fee:management_fee_basis_investment_period)), 'fund_terms', OBJECT_CONSTRUCT('fund_term_years', COALESCE(RJ:fund_terms:fund_term_years:value, RJ:fund_terms:fund_term_years), 'investment_period_years', COALESCE(RJ:fund_terms:investment_period_years:value, RJ:fund_terms:investment_period_years), 'initial_closing_date', COALESCE(RJ:fund_terms:initial_closing_date:value, RJ:fund_terms:initial_closing_date)), 'capital_provisions', OBJECT_CONSTRUCT('capital_call_notice_days', COALESCE(RJ:capital_provisions:capital_call_notice_days:value, RJ:capital_provisions:capital_call_notice_days))), NULL) AS RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(NULLIF(RAW_JSON:fund_size:gp_commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:gp_commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:fund_size:target_fund_size:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:target_fund_size:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:fund_size:minimum_lp_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:minimum_lp_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:parties:limited_partners[0]:commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:parties:limited_partners[0]:commitment_amount:currency_code::VARCHAR, 'null')) AS DOCUMENT_CURRENCY_CODE FROM (SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(RAW_JSON:extraction, RAW_JSON) AS RJ FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'limited_partnership_agreement' AND FIRM_ID = '<firm_id>') ORDER BY DOCUMENT_ID, EXTRACTION_ID, RECORD_INDEX"
}})
```

**Query O — operating agreement rows (ndjson):** the same projection as Query T under `DOCUMENT_TYPE = 'operating_agreement'`. An LLC vehicle's governing document runs through the LPA extractor and writes the same record types, so `process.py` assembles both together. It is its own query, not an `IN` list, so each response stays under the connector's size cap.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "limit": 50000,
  "response_mode": "inline",
  "sql": "SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, IFF(ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1 AND RJ IS NOT NULL, OBJECT_CONSTRUCT('currency', COALESCE(RJ:currency:value, RJ:currency), 'fund_info', OBJECT_CONSTRUCT('fund_name', COALESCE(RJ:fund_info:fund_name:value, RJ:fund_info:fund_name), 'state_of_formation', COALESCE(RJ:fund_info:state_of_formation:value, RJ:fund_info:state_of_formation), 'lpa_date', COALESCE(RJ:fund_info:lpa_date:value, RJ:fund_info:lpa_date), 'master_series', COALESCE(RJ:fund_info:master_series:value, RJ:fund_info:master_series), 'fund_purpose', COALESCE(RJ:fund_info:fund_purpose:value, RJ:fund_info:fund_purpose), 'registered_agent_name', COALESCE(RJ:fund_info:registered_agent_name:value, RJ:fund_info:registered_agent_name), 'principal_office_address', COALESCE(RJ:fund_info:principal_office_address:value, RJ:fund_info:principal_office_address)), 'document_metadata', OBJECT_CONSTRUCT('governing_law', COALESCE(RJ:document_metadata:governing_law:value, RJ:document_metadata:governing_law)), 'parties', OBJECT_CONSTRUCT('general_partner', OBJECT_CONSTRUCT('name', COALESCE(RJ:parties:general_partner:name:value, RJ:parties:general_partner:name), 'entity_type', COALESCE(RJ:parties:general_partner:entity_type:value, RJ:parties:general_partner:entity_type), 'state_of_formation', COALESCE(RJ:parties:general_partner:state_of_formation:value, RJ:parties:general_partner:state_of_formation), 'commitment_amount', COALESCE(RJ:parties:general_partner:commitment_amount:value, RJ:parties:general_partner:commitment_amount), 'commitment_percentage', COALESCE(RJ:parties:general_partner:commitment_percentage:value, RJ:parties:general_partner:commitment_percentage), 'address', COALESCE(RJ:parties:general_partner:address:value, RJ:parties:general_partner:address), 'members', TRANSFORM(RJ:parties:general_partner:members, x VARIANT -> OBJECT_CONSTRUCT('name', COALESCE(x:name:value, x:name)))), 'limited_partners', TRANSFORM(RJ:parties:limited_partners, x VARIANT -> OBJECT_CONSTRUCT('name', COALESCE(x:name:value, x:name), 'entity_type', COALESCE(x:entity_type:value, x:entity_type), 'commitment_amount', COALESCE(x:commitment_amount:value, x:commitment_amount), 'percentage_interest', COALESCE(x:percentage_interest:value, x:percentage_interest), 'address', COALESCE(x:address:value, x:address)))), 'carried_interest', OBJECT_CONSTRUCT('carried_interest_rate', COALESCE(RJ:carried_interest:carried_interest_rate:value, RJ:carried_interest:carried_interest_rate), 'preferred_return_rate', COALESCE(RJ:carried_interest:preferred_return_rate:value, RJ:carried_interest:preferred_return_rate), 'preferred_return_multiple', COALESCE(RJ:carried_interest:preferred_return_multiple:value, RJ:carried_interest:preferred_return_multiple), 'distribution_waterfall_type', COALESCE(RJ:carried_interest:distribution_waterfall_type:value, RJ:carried_interest:distribution_waterfall_type), 'waterfall_tiers', TRANSFORM(RJ:carried_interest:waterfall_tiers, x VARIANT -> OBJECT_CONSTRUCT('kind', COALESCE(x:kind:value, x:kind), 'percentage_to_gp', COALESCE(x:percentage_to_gp:value, x:percentage_to_gp)))), 'management_fee', OBJECT_CONSTRUCT('pays_management_fee', COALESCE(RJ:management_fee:pays_management_fee:value, RJ:management_fee:pays_management_fee), 'management_fee_rate_investment_period', COALESCE(RJ:management_fee:management_fee_rate_investment_period:value, RJ:management_fee:management_fee_rate_investment_period), 'management_fee_rate_post_investment', COALESCE(RJ:management_fee:management_fee_rate_post_investment:value, RJ:management_fee:management_fee_rate_post_investment), 'management_fee_basis_investment_period', COALESCE(RJ:management_fee:management_fee_basis_investment_period:value, RJ:management_fee:management_fee_basis_investment_period)), 'fund_terms', OBJECT_CONSTRUCT('fund_term_years', COALESCE(RJ:fund_terms:fund_term_years:value, RJ:fund_terms:fund_term_years), 'investment_period_years', COALESCE(RJ:fund_terms:investment_period_years:value, RJ:fund_terms:investment_period_years), 'initial_closing_date', COALESCE(RJ:fund_terms:initial_closing_date:value, RJ:fund_terms:initial_closing_date)), 'capital_provisions', OBJECT_CONSTRUCT('capital_call_notice_days', COALESCE(RJ:capital_provisions:capital_call_notice_days:value, RJ:capital_provisions:capital_call_notice_days))), NULL) AS RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(NULLIF(RAW_JSON:fund_size:gp_commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:gp_commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:fund_size:target_fund_size:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:target_fund_size:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:fund_size:minimum_lp_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:minimum_lp_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:parties:limited_partners[0]:commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:parties:limited_partners[0]:commitment_amount:currency_code::VARCHAR, 'null')) AS DOCUMENT_CURRENCY_CODE FROM (SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(RAW_JSON:extraction, RAW_JSON) AS RJ FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'operating_agreement' AND FIRM_ID = '<firm_id>') ORDER BY DOCUMENT_ID, EXTRACTION_ID, RECORD_INDEX"
}})
```

**Query L — side letter extraction rows (ndjson):** every row for the side letters belonging to this firm. Both roles come back on the same filter — the firm's fund appears as the `fund` entity when it granted the terms and as a `limited_partner` entity when it received them; `process.py` (Step B1.5 below) checks both fields and tags the match with `role`. `DOCUMENT_CURRENCY_CODE` here is the side letter's own `capital_commitment` currency, independent of Query T's.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "limit": 50000,
  "response_mode": "inline",
  "sql": "SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, OBJECT_CONSTRUCT('capital_commitment', ATTRIBUTES:capital_commitment, 'economic_provisions', ATTRIBUTES:economic_provisions) AS ATTRIBUTES, IFF(ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1 AND RJ IS NOT NULL, OBJECT_CONSTRUCT('issuer_name', COALESCE(RJ:issuer_name:value, RJ:issuer_name), 'executed_by_issuer', COALESCE(RJ:executed_by_issuer:value, RJ:executed_by_issuer), 'has_draft_markings', COALESCE(RJ:has_draft_markings:value, RJ:has_draft_markings), 'has_unfilled_placeholders', COALESCE(RJ:has_unfilled_placeholders:value, RJ:has_unfilled_placeholders), 'side_letters', TRANSFORM(RJ:side_letters, x VARIANT -> OBJECT_CONSTRUCT('investor', COALESCE(x:investor:value, x:investor), 'issue_date', COALESCE(x:issue_date:value, x:issue_date), 'executed_by_investor', COALESCE(x:executed_by_investor:value, x:executed_by_investor), 'complex_management_fee', OBJECT_CONSTRUCT('summary', COALESCE(x:complex_management_fee:summary:value, x:complex_management_fee:summary)), 'complex_carry', OBJECT_CONSTRUCT('summary', COALESCE(x:complex_carry:summary:value, x:complex_carry:summary)), 'mfn_provision', OBJECT_CONSTRUCT('summary', COALESCE(x:mfn_provision:summary:value, x:mfn_provision:summary)), 'excuse_right', OBJECT_CONSTRUCT('summary', COALESCE(x:excuse_right:summary:value, x:excuse_right:summary)), 'transfer_restriction_modification', OBJECT_CONSTRUCT('summary', COALESCE(x:transfer_restriction_modification:summary:value, x:transfer_restriction_modification:summary))))), NULL) AS RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(NULLIF(RAW_JSON:side_letters[0]:capital_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:side_letters[0]:capital_commitment:currency_code::VARCHAR, 'null')) AS DOCUMENT_CURRENCY_CODE FROM (SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, ATTRIBUTES, RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(RAW_JSON:extraction, RAW_JSON) AS RJ FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'side_letter' AND FIRM_ID = '<firm_id>') ORDER BY DOCUMENT_ID, EXTRACTION_ID, RECORD_INDEX"
}})
```

Substitute `<firm_id>` with the UUID from Step 1 in all three — it is the only placeholder any query takes.

> **`response_mode: "inline"` is load-bearing on both ndjson fetches — do not remove it.** The server infers the delivery shape from `clientInfo.name`, and that name cannot distinguish the Claude Code CLI (which accepts a binary blob) from other runtimes that share the same name but reject the blob with `-32602 invalid_union`. `inline` forces the always-safe plain-string path for every client.

> **`DOCUMENT_TYPE` is load-bearing too.** `DOCUMENT_AI_RECORD` holds every document type, and `RECORD_TYPE` values (`fund`, `limited_partner`, `investor`) are generic labels an SPA and a subscription agreement also use. Dropping the `DOCUMENT_TYPE` filter silently pulls other document types into the audit.

**Every query groups an agreement's rows by `EXTRACTION_ID`, and keeps `DOCUMENT_ID` to link to the source document.** One uploaded document can hold several extractions: Document AI splits a packet into segments, so one file can carry two LPAs, or two side letters, each its own extraction. Grouping on `DOCUMENT_ID` would merge them into one fund with the other agreement's LPs. A re-extraction does not duplicate an agreement, because the view serves only each segment's current extraction.

> **Do not group on `DOCUMENT_ID`.** It crosses agreements whenever a document holds more than one. A test fails if a query windows or orders rows without `EXTRACTION_ID`.

> **Inline vs. offloaded response — handle both; neither branch is dead code.** The median firm returns 7–9 rows / 1–2 KB, which arrives inline in the tool result body (no `saved to` path). When it does, write the raw ndjson text to a temp file under `<WORKSPACE>` (e.g. `<WORKSPACE>/query_t.ndjson`, `query_o.ndjson`, `query_l.ndjson`) so the assembly step below can read it via CLI arg the same way it reads a resolved blob. The distribution has a long tail, though — p90 is ~113–151 rows and the largest firm returns 1,344 rows / 340 KB — so **6 firms today exceed the ~100kb inline cap** and get offloaded to a `tool-results/*.txt` path. Use their saved path once bash can read it (`test -r`). Never assume one path exclusively.

**Response resolution (unified for inline + offloaded).** For each query, determine which path applies:

- **Inline** — the tool result contains the ndjson text directly (no `saved to <path>` marker). Write it to `<WORKSPACE>/query_t.ndjson` (or `query_o.ndjson`, `query_l.ndjson`) using the Write tool. That file is the query's path.
- **Offloaded** — the tool result surfaces a `saved to <path>` line. Check it with its own Bash call, `test -r "<saved path>"`. Bash is what reads the file (`process.py`, below), and the Read tool can open paths bash can't. If the check succeeds, the saved path is the query's path. If it fails, treat the query as not loaded: do not search the disk for the file. In the Cowork sandbox bash can't read the saved path, so a large offloaded result there ends in the reload message below.

Call the three results `<QUERY_T_PATH>`, `<QUERY_O_PATH>` and `<QUERY_L_PATH>`.

If neither the inline write nor the saved path yields a file bash can read, re-run that one query once. Do **not** narrate paths or sandbox mechanics to the user. If it still fails:

> "I couldn't load your LPA data just now. Try running the report again in a moment. If it keeps happening, [contact Carta Support](https://support.carta.com/kb/guide/en/how-to-get-support-with-carta-help-T8DEfuxhi9/Steps/3724508)."

Tell the user: `LPA data loaded. Assembling report…`

**RAW_JSON as the source.** `process.py` (and artifact.html's JS port) reads most fund/GP/LP/terms and side-letter fields from `RAW_JSON`: unwrap a citation envelope (`{value, text, ..., citations[]}`) to its `value`, trying the bare path then the `extraction`-prefixed path, and treat a JSON-null `value` as null. **There is no `ATTRIBUTES` fallback.** document-ai builds `ATTRIBUTES` from the same extraction output, so a field `RAW_JSON` leaves null is null in `ATTRIBUTES` too — verified on production data: across every field below, zero LPA, operating-agreement, or side-letter rows carry an `ATTRIBUTES` value that `RAW_JSON` lacks. Every document a firm-scoped query returns has `RAW_JSON`; the only extractions without one (Jul 6–10 2026) carry the `'fund_admin'` placeholder `FIRM_ID`, which the `FIRM_ID = '<firm_id>'` filter never matches. The rows' `RECORD_TYPE` and `KIND` still decide *which* records exist (an LP row, a `limited_partnership` event row) — just not their field values. The two exceptions are `lpCapitalCommitment` and `economicProvisions`, which have no `RAW_JSON` read path and stay on `ATTRIBUTES`. Query L returns only those two `ATTRIBUTES` keys; Query T and Query O return no `ATTRIBUTES`, because nothing reads it there.

| Field group | `RAW_JSON` path root | Correlated by |
|---|---|---|
| `fund.*` | `fund_info` (`governingLaw` is `document_metadata.governing_law`) | one per extraction |
| `generalPartner.*` | `parties.general_partner` | one per extraction |
| `limitedPartners[].*` | `parties.limited_partners[]` | positional — the Nth `limited_partner` row by `RECORD_INDEX` is the Nth array entry (validated: counts always match). Not by `name`: ~6% of LP rows have no extracted name |
| `terms.*` | `carried_interest` / `management_fee` / `fund_terms` / `capital_provisions` | one per extraction, only when an ATTRIBUTES `limited_partnership` event row exists |
| side letter `issueDate` / `executedByInvestor` / `lpName` / `lpCapitalCommitment` | `side_letters[]` | positional — same index as the ATTRIBUTES event row within its extraction (validated: array size always matches event-row count) |
| side letter `executedByIssuer` / `hasDraftMarkings` / `hasUnfilledPlaceholders` / `fundName` (issuer) | extraction root (`executed_by_issuer`, `has_draft_markings`, `has_unfilled_placeholders`, `issuer_name`) | one per extraction |
| `complexManagementFee` / `complexCarry` / `mfnProvision` / `excuseRight` / `transferRestrictionModification` | `side_letters[].complex_management_fee` / `.complex_carry` / `.mfn_provision` / `.excuse_right` / `.transfer_restriction_modification` (`.summary`) | positional; no `ATTRIBUTES` counterpart. Each renders as a labelled line on the side letter (see Caveats) |

`economic_provisions` is **not** migrated — `RAW_JSON`'s closest analog (`side_letters[].complex_carry`) is a materially different shape (a waterfall-tier structure, not `{provision_type, rate_paid}`), and reshaping one into the other would be new derivation logic, not plumbing. A letter's tiered or IRR-based fee and carry terms are shown from the `summary` sentence of `complex_management_fee` and `complex_carry` instead, never as a rate.

### Step B1.5: Assemble JSON

The firm's fund names (from Step 1's `fa__list__entities` call) are passed in as a JSON array so `process.py` can match them against the extracted LPA fund entity names — the exact same deterministic algorithm Mode A's JS transform ports and validates against, not an approximation.

The script is `${CLAUDE_PLUGIN_ROOT}/skills/carta-lpa-audit/scripts/process.py`; do not search for it. Run it on one line, exactly as written below, for the same allowlist reason as Mode A's Step A2c:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lpa-audit/scripts/process.py" --lpa-rows "<QUERY_T_PATH>" --operating-agreement-rows "<QUERY_O_PATH>" --side-letter-rows "<QUERY_L_PATH>" --firm-id "<firm_id>" --firm-name "<firm_name>" --firm-carta-id <org_pk> --firm-fund-names-file "<CWD>/<firm-slug>-funds.json" --out "<WORKSPACE>/carta-lpa-audit-data.json"
```

If the script file does not exist, follow the note at the top of this skill on plugin files that can't be found.

`<CWD>/<firm-slug>-funds.json` is the same file Mode A's Step 2a writes: every entity from Step 1 as `{"name", "carta_id", "entity_type", "currency"}`. Write it first if Mode A didn't run. It is passed as a file so an apostrophe in a fund name can't break the shell quoting. With `entity_type`, the entities Step 2a describes as never carrying an LPA land in `notAudited` instead of `funds`, by the same rule the page uses.

Output (`carta-lpa-audit-data.json`) lands in `<WORKSPACE>` and doubles as the Mode B cache. This is the exact schema Step B2, the Drill-down section, and Step B4 read from.

- **Exit 0** — proceed.
- **Non-zero exit** — show the script's stderr output to the user and stop.

Tell the user: `LPA data loaded. Building your coverage report…`

### Step B2: Present results

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lpa-audit", checkpoint_label="data_fetched")` once the LPA data is in hand, whether Step B1 fetched it or Step B0 read it from the cache.

**BLUF lead:** One sentence with the coverage split before the fund sections.

> "**<extracted>** of **<total_funds>** funds have full data · **<vehicle_agreement>** vehicle agreements that state no fee or carry of their own · **<partial>** with partial data · **<parent_agreement>** governed by a parent agreement · **<missing>** missing an LPA · **<name_mismatch>** with a name mismatch · **<no_documents>** with no documents extracted · **<total_side_letters>** side letters granted."

Leave out the vehicle-agreement, parent-agreement, name-mismatch and no-documents clauses when their counts (`coverage.vehicleAgreement`, `coverage.parentAgreement`, `coverage.nameMismatch`, `coverage.noDocuments`) are 0. Never fold either into "missing": a fund whose LPA exists under another name is not a fund without an LPA.

Then present **one section per fund**, sorted by status (full data → vehicle agreement → partial data → governed by parent → name mismatch → missing → no documents) then fund name. Each section is a mini tear-sheet, with the depth of detail scaled to what's extracted.

**Formatting rules:**
- Dates: `Mmm D, yyyy`. Percentages: `X.XX%`. Multiples: `X.XXx` (a hurdle stated as a multiple of capital, `1.60x`). Amounts: `$X,XXX` / `($X,XXX)`-style, using the extraction's `RAW_JSON`-derived currency, else the fund's Carta currency, where known, and rendering the number bare when the currency is unknown (never an assumed `$`) — see the Amounts rule above and Caveats. Null: `—`, except a fee, carry, hurdle, fund term or investment period on a fund whose terms were extracted, which is `Not found` (see Null values above).
- Fund term / investment period: `<N> years`, rounded to one decimal (`10.4 years`). Capital call notice: `<N> days`.
- **Management fee:** `0` means the LPA states no fee is charged — render `No fee (per LPA)`, never `0%` or `None`. A missing rate is `Not found` (see Null values above).
- **Fee basis:** In the tear-sheet table use `lpa.terms.mgmtFeeBasisShort` (the verbatim sentence cut to 60 characters). Show the full `mgmtFeeBasisInvestmentPeriod` only in the Drill-down.
- **Operating agreements:** An operating agreement keeps the carry it states, as an LLC fund's own governing document. When `lpa.notFundLpa` is true (its stated carry is above 50%, a member profit split rather than fund carry), label the document `Operating agreement, not a fund LPA`; `process.py` has already withheld carry, hurdle and waterfall, so do not infer carry from the document.
- **Document links.** Every `documentId` (on a fund, a parent agreement, an unmatched or received document, a side letter) is the fund-admin document's own id. Link it as `[<label>](<base_url>/investors/firm/<org_pk>/portfolio/documents/<document_id>)`, the document library link below with the id appended.
- **Term checks.** Each entry in `lpa.termFlags` (`{field, reason}`) marks a value outside a sane range — more likely a misread than a real term. Keep the value and append `⚠ Check the LPA — <reason>` to that row, e.g. `| Hurdle | 300.00% ⚠ Check the LPA — above 30%, may be a multiple |`. Never drop or correct the value: an unusual term can be real.

---

#### ✅ Full data

For each fund with full data (`lpaStatus: "EXTRACTED"`):

> **<Fund name>** — [LPA](<document link for documentId>) dated <lpa_date> · <state_of_formation><if lpaMatch == "close": · *Similar name — matched to the LPA for "<lpa.fund.name>"; confirm it's this fund's.*>
>
> | Field | Value |
> |-------|------|
> | Management fee (investment) | <rate>% of <basis> |
> | Management fee (post-investment) | <rate>% |
> | Carry | <rate>%<if carryTierRates: " (tiered)"> |
> | Carry tiers | <carryTierRates joined with " → ", each as <rate>%; omit the row when carryTierRates is null> |
> | Hurdle | <rate>%, <multiple>x, or both as "<rate>% · <multiple>x" |
> | Waterfall | <structure> |
> | Fund term | <N> years |
> | Investment period | <N> years |
> | Capital call notice | <N> days |
>
> **<gp_name>** (<entity_type>) · <lp_count> LPs · <side_letter_count> side letters

If the user wants LP or side letter detail on a specific fund, run the drill-down (below).

---

#### ▫ Vehicle agreements

For each fund with `lpaStatus: "VEHICLE_AGREEMENT"` (a vehicle whose agreement carries no fee, carry, hurdle or waterfall; the rule is in Caveats → *Partial LPAs*). Never call it partial or missing. For each:

> **<Fund name>** — [Vehicle agreement](<document link for documentId>) · Vehicle agreement on file. It states no fee or carry of its own, which is usual for a vehicle that distributes pro rata or takes its economics from the main fund's agreement.<if not lpa.termsExtracted: [Upload the full agreement](<document library link>).> Every vehicle gets this same line.
>
> <a `| Field | Value |` table of only the non-null `lpa.terms` (a `0` fee is `No fee (per LPA)`, capital call notice, fund term); omit the table when every term is null>

---

#### ⚠ Partial data

LPA fund entity was detected but the agreement states none of the terms the table shows (fee, carry, hurdle, fund term, investment period): the terms event row is missing, every term in it is empty, or it states only terms the table does not show, such as a waterfall type or a post-investment fee. For each:

> **<Fund name>** — On file, but the documents state no headline fee, carry, hurdle or fund-term figures
>
> **<gp_name>** (<entity_type>) · <lp_count> LPs · <side_letter_count> side letters

---

#### ◐ Governed by a parent agreement

A series of one LLC whose own agreement is not on file, while the parent LLC's agreement is. Terms sit in each series' own schedule, so none are shown for the series, and it is not counted as missing or as a name mismatch. For each (`parentAgreements` names the parent's agreement):

> **<Fund name>** — Governed by the **[<parentAgreements[0].name>](<document link for parentAgreements[0].documentId>)** agreement. Series-specific terms are not on file.<if side_letter_count > 0: **<N>** side letter<s> on file.>

---

#### ⚠ Name mismatch

For each fund with `lpaStatus: "NAME_MISMATCH"` (an LPA tied between it and a sibling, or an unmatched document could be its: one sharing a word that names this fund rather than the firm or its fund family, its name with one run of words written as initials ("AV" for "Acme Ventures"), either way round, or its fund number when that is 2 or more; a GP or manager entity never counts). `possibleLpaNames` holds those documents' fund names:

> **<Fund name>** — No document carries this name. Its LPA may be filed as **<possibleLpaNames[0]>**<if more than one: (+<N> more)> — check which fund it covers.<if side_letter_count > 0: **<N>** side letter<s> on file even without the LPA.>

Right after the fund sections, list `unmatchedDocuments` (fund name linked to its document · GP name · date) under **Documents that didn't match any fund**, with this line: "A renamed fund is the usual cause. Link by asking your Carta team: send them each document and the fund it belongs to, and they will attach it."

#### ❌ Missing LPAs

For each fund with `lpaStatus: "MISSING"` (the firm has documents, none of them this fund's):

> **<Fund name>** — No LPA on file<if side_letter_count > 0: **<N>** side letter<s> on file even without the LPA.>

#### ➖ No documents

For each fund with `lpaStatus: "NO_DOCUMENTS"` (nothing extracted for the firm at all): list the funds in one line, not one section each:

> *No LPA or operating agreement has been extracted for this firm — <N> funds: <names joined with ", ">.* <if side_letter_count > 0 for any: side letters are on file for <names>.>

---

---

#### Not audited

When `notAudited` is non-empty, one line, not one section per entity:

> *Not audited — <N> entities that are not fund vehicles, by reason (`notAudited[].reason`: entity type, wire instructions, custodial account, trust, duplicate, combined entry, the firm itself): <reason>: <names joined with ", ">; …*

---

#### Received from other managers

When `receivedDocuments` is non-empty, one collapsed line, not a section per document: these are LPAs of other managers' funds whose investor roster names one of the firm's entities, so they are not errors and are not counted in coverage. Other managers' agreements whose roster names none of the firm's entities are not in the data at all: nothing ties them to the firm, so never mention them.

> *<N> agreements received from other managers (not part of this firm's coverage).*

#### Side letters

State the split once: `sideLetterCounts.granted` letters granted by the firm's funds, `received` received as an investor, `unmatched` that name none of the firm's funds (`unmatchedSideLetters`), out of `extracted` rows. `company` letters are a portfolio company's funding round (the issuer is an Inc., Corp., PBC, PLC or Ltd., or a company form used abroad such as AB, AG, GmbH, S.A., B.V. or N.V., whose name has no fund or vehicle word, such as Fund, Capital, Partners, Feeder or Blocker), including one that names a firm fund as its investor; they are on no fund and left out of `unmatchedSideLetters` — mention their count in one clause, never list them. A letter with a named issuer where neither party could be the firm (neither shares a distinctive word with the firm's or its entities' names, nor is one of those names written with initials, "AV Global I SPV" for "Acme Ventures Global I SPV") is another manager's fund and its own investors: it is not in the data at all, `extracted` included, so never mention it. The raw row count is higher than what lands on a fund because duplicate uploads fold together.

#### Inherited series

A fund with `inheritedFromMaster` set shares the agreement of that master fund. Show its terms line, add "inherited from <master>", and do not repeat the LP roster (`lpa.limitedPartnerCount` gives its size).

**After all sections,** say how to add documents:

> To add a missing or full LPA, drop it into this chat and I'll add it to your firm's Documents page, or [view or upload LPA documents in Carta](<base_url>/investors/firm/<org_pk>/portfolio/documents/).

**Side letter note.** Always append once at the end:

> *"Side letter economic provisions are extracted and compared against the fund's own LPA where relevant."*

### Step B3: Offer next steps

```python
AskUserQuestion(
    questions=[{
        "question": "What would you like to do next?",
        "header": "Next step",
        "multiSelect": False,
        "options": [
            {"label": "Drill into a fund", "description": "See the full tear-sheet (terms, LP roster, side letters with LP names + execution status) for a specific fund."},
            {"label": "Show only gaps", "description": "List only funds without an LPA, with partial LPA extractions, or governed by a parent agreement."},
            {"label": "Compare a term across funds", "description": "e.g. compare management fee or carry across every extracted LPA in a single side-by-side table."},
            {"label": "Ask a question about provisions", "description": "Free-text query across every fund's LPA terms and side letter provisions — e.g. 'do any provisions prevent me from investing in defense tech?' or 'which LPs got reduced carry?'"},
            {"label": "Done — no further action", "description": "Return to chat."},
        ],
    }]
)
```

If the user picks "Drill into a fund," continue with the **Drill-down** section below. If they pick "Show only gaps," re-render Step B2 with only the Partial, Governed by a parent agreement, Name mismatch, Missing and No documents sections. If they pick "Compare a term," ask which term (mgmt fee, carry, hurdle, waterfall, term), then render a one-column table with fund name + that term for every extracted fund, applying Step B2's year rounding and term-check suffix to each value. If they pick "Ask a question about provisions," continue with Step B4.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lpa-audit", checkpoint_label="skill_finished")` after showing the next-step question.

---

### Step B4: Provision-query follow-up

Triggered by "Ask a question about provisions" in Step B3, or any free-text question about LPA terms / side letter provisions that arrives after the initial report renders. Also runs after Mode A — the interactive artifact doesn't have a query box inside it, so the follow-up happens in chat.

**Prompt the user (unless they already asked):**

> "What are you looking for in your funds' LPA terms or side letter provisions?"

**Then search the cached JSON at `<WORKSPACE>/carta-lpa-audit-data.json`.** For each fund:

1. Walk `lpa.terms.*` for prose fields that might carry restrictions or definitions (`waterfallStructure`, `mgmtFeeBasisInvestmentPeriod`) and `lpa.fund.fundPurpose` for the investment mandate — these are the LPA-side fields most likely to encode a restriction.
2. Walk `sideLetters[*].economicProvisions[*]` for every provision. Match on `provision_type` and inspect `rate_paid` when relevant.
3. When the user's question is about a *sector restriction* (defense, tobacco, ESG carve-out, sanctioned countries, etc.) or a specific *right* (co-invest priority), say plainly that it isn't in the data this audit reads rather than implying the letter grants nothing. MFN, excuse-right and transfer terms and custom fee and carry schedules are read: search each side letter's `mfnProvision`, `excuseRight`, `transferRestrictionModification`, `complexManagementFee` and `complexCarry` text alongside `economicProvisions` (see Caveats).

**Presentation:**

> "Searched **<N>** funds' LPA terms and **<M>** side letter provisions for `<user's question>`.
>
> **Matches found:**
> • <Fund A>: <side letter's counterparty> — <provision_type>: <rate> (LPA: <lpa value>)
> • <Fund B>: LPA fundPurpose mentions "<matching keyword>" — <snippet>
>
> **Nothing surfaced for:** <specific sub-question that requires fields this audit can't read>. This may exist in the source documents — it just isn't in the extracted data available here, so check the source LPA or side letter to be sure."

**Never fabricate a match.** If the extraction data doesn't contain the answer, say so plainly rather than inferring from partial evidence. When the user's question is a compliance-material one ("can I invest in X?"), always add: *"This search covers only what Carta's LPA + side letter extraction currently captures. Confirm any answer against the actual LPA and side letter PDFs before acting on it."*

After answering, re-offer Step B3's menu so the user can drill further or exit.

---

## Drill-down: single-fund tear-sheet

Triggered when the user selects "Drill into a fund" or names a specific fund.

### Step A

If the user hasn't named a fund, ask: "Which fund would you like to review?"

### Step B

Find the fund in the cached JSON by name (case-insensitive substring match). If not found:

> "No LPA data found for '<fund_name>'. Check that the fund name matches how it's listed in Carta, or run the full audit again."

### Step C

Present three sub-sections:

**Fund identity**

| Field | Value |
|-------|------|
| Fund name | <name> |
| LPA date | <lpa_date> |
| State of formation | <state> |
| General partner | <gp_name> (<gp_entity_type>, <gp_state>) |
| GP commitment | <gp_commitment_percentage>% · $<gp_commitment_amount> (either half alone when only one was extracted; never wrap the amount in parentheses, which reads as negative) |

**Economic terms** (only shown when `termsExtracted == true`)

| Field | Value |
|-------|------|
| Management fee (investment period) | <rate>% of <basis> |
| Management fee (post-investment) | <rate>% |
| Carried interest | <carry>%<if carryTierRates: " (tiered)"> |
| Carry tiers | <carryTierRates joined with " → ", each as <rate>%> |
| Preferred return / hurdle | <hurdle>%, <multiple>x, or both as "<hurdle>% · <multiple>x" |
| Waterfall structure | <structure> |
| Fund term | <years> years (one decimal) |
| Investment period | <years> years (one decimal) |
| Capital call notice | <days> business days |
| Initial closing | <date> |

Both tables above list every field the extraction *can* carry. Omit any row whose value wasn't extracted rather than printing it with a `—` placeholder — an empty row reads as a data gap the reader has to check. If nothing in a table survives, skip the table and its heading.

A row whose field is in `lpa.termFlags` keeps its value and ends with `⚠ Check the LPA — <reason>`, as in Step B2.

If `lpaStatus == "PARTIAL"`, show this message before the tables (and instead of them when `termsExtracted == false`; keep the Economic terms table when `termsExtracted` is true):

> "The documents on file for this fund name it but state no headline fee, carry, hurdle or fund-term figures. They are often signature pages from a subscription packet. Drop the full LPA into this chat, or upload it in Carta, to see its terms."

**Side letters — <count> on file · <N> with extracted provisions**

`<count>` is `sideLetterCount`: the letters the fund granted its own LPs. Side letters with any extracted provision sort to the top of the table. Deduplication is by (counterparty, issue date, role), the counterparty compared modulo case and punctuation, and an undated, draft, unfilled or fund-unsigned copy folds into that counterparty's one signed, dated letter — repeated uploads of the same letter across investor subscription bundles collapse to one row (cleanest extraction wins). Two signed letters to one LP on different dates stay two rows.

| # | Counterparty | Issue date | Capital commitment | Summary |
|---|-------------|-----------|--------------------|---------|
| 1 | Sample LP | Mar 24, 2022 | MYR 15,000,000 | • **Reduced carry:** 15% (LPA: 20.00%) |
| 2 | Another LP | Oct 12, 2019 | $5,000,000 `[from LPA]` | — |
| 3 | Sample LP III `[All series]` | Jan 15, 2026 | — | — |

A row with `sharedAcrossSeries: true` carries an `[All series]` chip: the letter names a series LLC but not one of its series, so it is listed on every series of that LLC and counted once in `totalSideLetters`. A letter that names a series is listed on that series alone.

Letters with `role: "investor"` are the fund receiving terms as an LP of another manager's fund; the counterparty is that fund. A portfolio company's round letter is never one of them: it counts as a `company` letter. List them after the table under **Received as an investor — <N>**, same columns, and never include them in `<count>` or `totalSideLetters`: those count what the fund granted its LPs.

**Capital commitment** prefers the side letter's own `lpCapitalCommitment` — a pipeline-formatted string (e.g. `"MYR 15,000,000"`), shown verbatim, populated on a minority of side letters.

When that is absent, `process.py` backfills from the fund's own LPA: it matches the side letter's `lpName` against the LPA's `limited_partner` roster (`best_match`, a normalized fuzzy match at `≥ 0.85` — investor names only; fund names use the stricter matcher in Caveats) and takes that LP's `commitment_amount`, writing `lpCapitalCommitmentAmount`, `lpCapitalCommitmentCurrency` and `lpCapitalCommitmentFromLpa: true`. Render a backfilled figure with the LPA's own amount formatting and a `[from LPA]` chip — never bare, since it was not stated in the side letter and rests on a name match. `—` when neither source has a figure.

The backfill is skipped for `role: "investor"` rows (the counterparty is another manager's fund and this fund is its LP, so neither side matches this fund's roster) and when the name clears no roster entry at the threshold. It also can't help when the fund's selected LPA carries no LP roster at all — LPA selection prefers `headlineTermCount` first, then `termsExtracted`, which biases toward the roster-bearing extraction, but does not guarantee one.

**Summary rendering rules:**
- Each `economic_provisions[].provision_type` renders as a bulleted line.
- After those, each non-empty `complexManagementFee`, `complexCarry`, `mfnProvision`, `excuseRight` and `transferRestrictionModification` renders as a bulleted line: the label (`Custom management fee`, `Custom carry`, `MFN`, `Excuse right`, `Transfer`) in bold, then its extracted sentence verbatim.
- Known types compare against the fund's own LPA where relevant:
  - `REDUCED_CARRIED_INTEREST` → `Reduced carry: <rate> (LPA: <lpa carry>)`
  - `REDUCED_MANAGEMENT_FEE` → `Reduced management fee: <rate> (LPA: <lpa mgmt fee>)`
  - `INCREASED_PREFERRED_RETURN` / `INCREASED_HURDLE` → `Increased hurdle: <rate> (LPA: <lpa hurdle>)`
- Full waivers render as a bare label — no rate, no trailing `—`, and no `(LPA: …)` comparison. A waiver isn't a rate to compare against the LPA, and a trailing dash reads as missing data when nothing is in fact missing:
  - `WAIVED_MANAGEMENT_FEE` → `Waived management fee`
  - `WAIVED_CARRIED_INTEREST` → `Waived carried interest`
- Known labels are sentence case — only the first word is capitalized.
- Unknown types fall through with a title-cased raw label so they're still visible.
- Empty summary shows `—` — extraction may just not cover the provisions this side letter modifies yet, not necessarily "no modifications."

Always follow the side letter table (or empty state) with:

> *"Provisions in the Summary column are extracted from each side letter; LPA comparisons pull from this fund's extracted terms. See Step B4 to search across all funds' extracted provisions."*

### Step D

```python
AskUserQuestion(
    questions=[{
        "question": "What would you like to do next?",
        "header": "Next step",
        "multiSelect": False,
        "options": [
            {"label": "Back to full audit", "description": "Return to the three-bucket fund summary. ← recommended"},
            {"label": "Look up another fund", "description": "Search LPA data for a different fund."},
        ],
    }]
)
```

---

## Gates

**AI computation:** No — bucket assignments, tear-sheet values, and side letter counts come directly from Carta's Document AI extractions via deterministic queries + Python assembly. Fund-name matching (extracted fund name → firm's fund list) is a deterministic name heuristic, not a system-recorded link; matched rows are labeled with the source fund name in `boundingBoxes` for verification.

---

## Best effort

- **Authoritative (from Carta Document AI):** LPA extracted terms, fund/GP/LP identities, side letter dates, execution status, side letter `economic_provisions`, custom fee and carry schedules and MFN, excuse and transfer terms, side letter `capital_commitment` (~15.7% coverage), bounding-box provenance.
- **Computed (by Claude):** name match between the firm's own fund list and extracted LPA fund entity names — `lpaMatch: "close"` (typo-level or legal-form difference, or the one fund whose name is the agreement's with one run of words written as initials, either way round, "FP Global I SPV" and "Future Positive Global I SPV") is an inference, not a system-recorded link, and renders with a "Similar name" tag.
- **Not surfaced by this skill:** side letter co-invest rights and sector restrictions, which the extraction has no field for.
- **Not surfaced in v0.1:** per-field confidence scores (`DOCUMENT_AI_RECORD` doesn't expose them). Bounding-box provenance provides page-level source citation instead.

---

## Error handling

> **Checkpoint on every stop before this run has recorded `skill_finished`**, whether or not this table lists it: call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lpa-audit", checkpoint_label="skill_failed", notes="<one-line reason>")` instead of `skill_finished`. `skill_finished` means a report or answer reached the user; a stop that delivered neither is a failure, and counting it as finished makes failed runs look like fast successful ones. Rows that recover and continue (a fall-through to Mode B, a fund that lands in No documents) do not checkpoint.

| Symptom | Likely cause | What to tell the user |
|---------|-------------|----------------------|
| `list_contexts` returns no firm | User not authenticated or MCP session dropped | "I couldn't find any Carta data associated with your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, [contact Carta Support](https://support.carta.com/kb/guide/en/how-to-get-support-with-carta-help-T8DEfuxhi9/Steps/3724508)." |
| `firm_id` fails pre-flight UUID check | MCP session returned malformed context | "Could not determine your firm ID. Try reconnecting to the Carta MCP server." |
| `fa__list__entities` returns no entities across all six types | Firm has no fund vehicles in Carta yet | "I couldn't find any funds on file for <firm_name>. [Contact Carta Support](https://support.carta.com/kb/guide/en/how-to-get-support-with-carta-help-T8DEfuxhi9/Steps/3724508) if you believe this is an error." |
| 401 or 403 from any query | Carta session expired | "Your Carta session has expired. Reconnect to the Carta MCP server and try again." |
| Queries T and O both return 0 rows | No LPA or operating agreement extraction carries this firm's `FIRM_ID` — either none uploaded, or the firm's extractions predate the `FIRM_ID` backfill | Every fund lands in No documents. Include in BLUF: "No LPA documents have been extracted yet across any of your funds. Drop your LPAs into this chat, or upload them at the link above, to populate this audit." Do **not** retry with a fund-name filter to go looking for them. |
| A fund shows Missing, Name mismatch or No documents but the user insists its LPA is uploaded | Its extraction is likely in the unbackfilled `'fund_admin'` residue (see Caveats) | "That LPA is uploaded but hasn't been linked to your firm in our extraction records yet, so it isn't showing here. [Contact Carta Support](https://support.carta.com/kb/guide/en/how-to-get-support-with-carta-help-T8DEfuxhi9/Steps/3724508) to have it re-processed." |
| `render-artifact.py` exits non-zero | Bad UUID, non-numeric Carta ID, malformed base URL, unusable connector name, output or fund-names file outside CWD, or missing/empty fund-names file | Tell the user in plain words what failed, then fall back to Mode B. Never hand-write the artifact HTML. |
| `render-artifact.py` reports a missing template or placeholders | The plugin's files are broken | Follow the note at the top of this skill: one stop message, no Mode B. |
| No `Artifact` tool, even after Step A1 tried to load it | Artifacts are off or Claude is out of date | Go to Mode B, opening with Step A1's sentence on why the answer is text. |
| Artifact publishes but renders an error | The page's own bootstrap() hit a required-query failure | That error is the page's own and names its cause. Do not re-run Mode A blind; read what the viewer sees first. |
| Series shows 'Governed by parent agreement' | The series' own agreement is not on file but its parent LLC's is; the parent's carry, fee and hurdle belong to specific series, so none are shown on the others | Not a gap in the match. To show terms for the series, drop the agreement or schedule that names it into this chat, or upload it in Carta. |
| Fund shows as 'Name mismatch' or 'Missing' despite an LPA existing | The LPA's extracted fund name has a word the fund's Carta name lacks (or vice versa), or it tied between two sibling funds (`possibleLpaNames`) | Suggest running Mode B drill-down with the fund name as it appears in the LPA. Never re-attribute a sibling vehicle's LPA (e.g. a Holdings or GP entity's) to the fund by hand. |

---

## Caveats

- **`DOCUMENT_AI_RECORD.FIRM_ID` backfill is not finished, and unbackfilled extractions are invisible.** Roughly nine in ten LPA and side-letter extractions carry a real firm UUID. The remainder are stamped `'fund_admin'`, belong to no firm, and are therefore returned to nobody. A fund whose only LPA sits in that residue reports as **missing an LPA** until re-extraction or a backfill stamps its `FIRM_ID`. This is the accepted cost of scoping on the tenant key alone.
- **Currency comes from `RAW_JSON`, never from `ATTRIBUTES`.** `ATTRIBUTES:currency_code` is populated on almost no LPA rows and no side-letter rows, and the few LPA rows that carry it are stray `RECORD_TYPE = 'stock_purchase'` events misfiled under an LPA document type — not a record type this skill reads, so `ATTRIBUTES` is not a usable currency source here. `RAW_JSON` carries a clean `currency_code` sibling next to each money amount — populated on only a small share of those money fields. Where present, this skill derives one `document_currency_code` per extraction via `COALESCE` across `gp_commitment_amount`, `target_fund_size`, `minimum_lp_commitment`, and the first limited-partner entry (LPA), or `side_letters[0].capital_commitment` (side letters) — never per-LP, since multiple LPs within a document have never been observed to disagree. Since 2026-08-01 most LPAs carry only the free-form `RAW_JSON:currency:value` string and almost none carry `currency_code` siblings, so the free-form value is the fallback — but only when it is exactly a three-letter ISO code (`^[A-Z]{3}$`); prose such as "United States dollars" or "Sterling or £" is never parsed. When neither yields a code the fund's Carta reporting currency fills it (`fill_fund_currency` / `fillFundCurrency`, applied where each fund is joined to its entity); in a replay across many firms, the Carta currency covered every agreement with no code, and where both were known they agreed. With no Carta currency either, the currency is unknown and amounts render bare — never assume USD. Side letter `capital_commitment` values arrive pre-formatted (`"MYR 15,000,000"`) on the `limited_partner` entity row (not the `side_letter` event row) and are displayed verbatim — populated on a minority of `limited_partner` rows across side letters. **Only an exact ISO code in `RAW_JSON:currency:value` is used** — the field is free-form (many distinct strings for "USD" alone, e.g. "United States dollars", "Sterling or £"), so anything else is ignored. **`RAW_JSON`'s schema is not stable across extractor versions** — one version (`lpa-1.0`, a small minority of extractions) wraps the entire payload a level deeper under an `extraction` key, so every `RAW_JSON` path above is tried both bare and `extraction.`-prefixed via `COALESCE`; a path that doesn't exist in a given document's shape returns `NULL` harmlessly.
- **No confidence scores.** `DOCUMENT_AI_RECORD` does not expose per-field confidence. `boundingBoxes` (page + coordinates per field) is carried through as the audit trail, but the artifact does not display it yet — point a reader who needs provenance at the source document.
- **Side letter provisions beyond `economic_provisions` come from `RAW_JSON` only.** `ATTRIBUTES` never carries `mfn_provision`, `excuse_right`, `transfer_restriction_modification`, `complex_management_fee` or `complex_carry`; each is an envelope object whose `summary` sibling is what renders. `economic_provisions` holds only a reduced or waived fee or carry, so a negotiated fee schedule or a carry carve-out appears in `complex_*` and an MFN, excuse or transfer clause in its own field. Coverage varies by firm: across all firms `summary` text reaches `DOCUMENT_AI_RECORD` for only a small share of side-letter event rows, while a single firm can be far higher. A letter with none of them says "No provisions extracted", which means none were extracted, not that the letter grants nothing.
- **`RAW_JSON` is windowed to one row per extraction, not selected on every row.** It averages **~55KB/row** for LPAs and **~9.6KB/row** for side letters, and is identical across every row of one extraction (2–4 rows for an LPA, ~3 for a side letter) — selecting it unwindowed would multiply that cost by the row count for no benefit. Both Query T and Query L null it out on every row but the first (`ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1`); `process.py` and the JS transform already scan an extraction's rows for the first non-null `RAW_JSON`, so this is transparent to both. A test fails if a query selects `RAW_JSON` without that windowing.
- **`RAW_JSON` is pruned to the paths the transforms read, never selected whole.** The full document runs to tens of kilobytes for an LPA and several for a side letter, almost all of it citation envelopes and sections this skill never reads (`governance`, `reporting`, `signatures`, `bbox_index`, …). Selected whole, one firm's Query T reached about 10MB of ndjson and the largest firm's nearly 30MB; wrapped and escaped in the MCP response, that tripped the connector's 16MB cap — *"Connector response exceeded the 16 MB limit"* — so the artifact could not load at all. Each query therefore builds `RAW_JSON` with `OBJECT_CONSTRUCT`, holding only the paths in the "RAW_JSON as the source" table: every leaf as `COALESCE(<leaf>:value, <leaf>)`, and the `limited_partners` / `members` / `side_letters` arrays as a `TRANSFORM` keeping only the fields the readers take from each entry. A citation envelope's `citations`, `text` and `reasoning` are most of its size and nothing reads them. Left in, they push a 40-row page past `dwh:execute:query`'s 200 KiB inline ceiling for dozens of firms, and the page fetches every overflowing page again in smaller pieces. Reduced to values, the heaviest page across all firms is about half that ceiling. `rjGet` / `_rj_get` unwrap an envelope when one arrives and pass a bare value through. The root is `COALESCE(RAW_JSON:extraction, RAW_JSON)`, so the `lpa-1.0` wrapper is flattened once in SQL — safe because no document carries both shapes; the readers' `extraction` fallback stays for older renders. Pruned, even the largest firm's queries are a fraction of that size, with identical reader output on every LPA and side letter. **A new `RAW_JSON` read path, or a new field read off an array entry, must be added to the projection in both SKILL.md and artifact.html** — a path left out reads null everywhere, silently; a test fails if the page reads a path or an array field the projection omits, if a query passes an envelope or an array through whole, or if a query selects `RAW_JSON` whole.
- **Firm context does not reliably persist across `set_context` in a long session.** Row-level access filters `DOCUMENT_AI_*` on the *active* firm, and an explicit `FIRM_ID` predicate does not override it. Observed in a long session: the same query returned rows, then none, because the context silently reverted between calls. A zero-row result is therefore ambiguous — re-check `list_contexts` and confirm the active firm before concluding data is missing.
- **A hurdle can be a multiple of capital.** Some agreements set the hurdle as a multiple ("until each LP has received 1.6x its contributions") rather than an annual rate. Document AI stores that in `carried_interest.preferred_return_multiple` (1.6 for 1.6x), beside `preferred_return_rate` when the agreement states both, and the hurdle shows as "1.60x" or "8.00% · 1.50x". Extractions made before that field existed still carry a multiple as a rate in the hundreds (160, 300), which the "above 30%, may be a multiple" term check flags until they are re-extracted.
- **Partial LPAs.** An LPA extraction may include the fund/GP/LP entities but skip the `limited_partnership` event row that carries economic terms, or its row may state only terms the table does not show, such as a waterfall type or a post-investment fee. `PARTIAL` is decided by `headlineTermCount` (the number of fee, carry, hurdle, term and investment-period fields stated) being zero. Those funds land in the "Partial" bucket rather than "Extracted," unless the fund is a vehicle: an SPV by Carta entity type or name, or an aggregator, feeder, blocker, side fund, AIV / alternative investment vehicle or co-invest vehicle by name (`VEHICLE_WORDS`). A vehicle whose agreement carries no non-zero fee, carry, hurdle or waterfall is a "Vehicle agreement": its economics are usually pro rata or set in the main fund's agreement. Every vehicle is reported the same way, as an agreement that states no fee or carry of its own: that describes the document, not the vehicle, since with no terms row the fee and carry are unstated rather than shown to be none. Without a terms row the report also keeps the upload link. The vehicle test is a heuristic on type and name, since the extraction has no pro-rata field; "Holdings" and "Opportunity" are not vehicle words because main funds use them too, and a vehicle that states carry or a fee stays "Extracted". The cause is almost always the document, not a pending extraction: the classifier assigns an LPA only the pages it recognises as one, so an LPA bundled into a subscription packet is often extracted from its signature pages alone (a short segment, against a long one for LPAs that carry terms), and a short-form agreement states no terms. Re-extracting the same file gives the same result, so the page tells the user the documents state no headline fee, carry, hurdle or fund-term figures, lists any other terms they do state, and offers the upload link rather than saying terms are pending.
- **A fund's LP roster is the union across every LPA document that resolves to it.** Funds collect an executed copy of the LPA per investor, so one copy names only its own signatory (one fund can have a hundred copies covering a slightly smaller number of investors). A named LP appears once, matched on its name modulo case and punctuation (not `norm_name`, which would merge investors that differ only by legal form), preferring the entry that carries a commitment. Unnamed entries come from the selected LPA only. Each LP keeps the currency of the document its amount came from, and a roster in more than one currency is not totalled. Commitments themselves are mostly not in an LPA at all: signature pages state none, and an amended LPA often omits its partner schedule (a minority of one firm's LP entries carried one).
- **Operating agreements are audited as LPAs.** An LLC vehicle's governing document runs through the same extractor and writes the same record types under `DOCUMENT_TYPE = 'operating_agreement'` (Query O), so it matches a fund, supplies its terms and LP roster, and is labelled "operating agreement" in the panel. Its carry, hurdle, tiers and waterfall are kept unless the stated carry is above 50%: that is a member profit split (e.g. a holdings LLC paying 100% to its manager), so they are withheld and the panel says "Operating agreement, not a fund LPA". A fund's one agreement is chosen across both types by the rule in *Each extraction goes to one legal vehicle*.
- **Fund-name match is word-for-word, not a similarity score.** Sibling vehicles at one firm often differ by one word — "Fund IV, LP" vs "Fund IV Holdings, LP", "Fund III" vs "Fund III GP, LLC" / "Fund III-A" / "Fund III (Cayman)". `fund_key` normalizes only formatting (case, punctuation, L.P./LP, IV/4, "Fund"/"The"/"And", one trailing legal form, descriptive parentheticals like "(a Delaware limited partnership)", and security/round labels like "(Series B)", "(Common Secondary)", "(Convertible Note - June 2023)", and the final spaced-dash segment of a series LLC's name when it names a series or class, like " - Series I", " – Widgets Series" or " - Class A" — only that last segment, and never a parenthetical); every other word — including "(Cayman)", "(AIV)", "(A)" — is identity. Two names match only when their words line up one-for-one, with typo/plural tolerance on words of 4+ letters (`lpaMatch: "close"`). A word with no counterpart — HOLDINGS, GP, PARALLEL, a series letter — means a different vehicle. The previous `SequenceMatcher ≥ 0.85` match stripped HOLDINGS/PARTNERS/GP/parentheticals and so scored "Fund IV" vs "Fund IV Holdings" at 1.0. Consequence: renames and radically different vehicle names land as "Name mismatch" or "Missing" rather than on the wrong fund.
- **Most extractions attach to no fund, and that is normal.** A firm that invests in other managers' funds holds their LPAs too. An unattached extraction that shares a distinctive word with the firm's or its entities' names is listed as unmatched (likely a rebrand: Carta's entity name differs from the document's); the rest are "received from other managers" when their investor roster names one of the firm's entities, and otherwise left out of the report entirely. An unattached agreement of a GP, manager or adviser entity (its fund name ends in GP, General Partner, Manager(s), Management or Advisor/Adviser(s), optionally followed by a numeral, "Company" or "Co.", and one legal form: LLC, L.L.C., Ltd., Limited, LLP, LP, L.P., Corp., Corporation, Inc. or Co.) is left out too: it governs the manager, not a fund. None is an error. Words naming a vehicle type or a manager's role ("Managers", "Advisers", "Aggregator", "Trust") are not distinctive: otherwise a firm's "Acme Secondary Managers LLC" would make every LPA whose GP is some "Fund Managers I, LLC" look like the firm's own.
- **An unmatched document flags only the funds it could be.** A fund with no document is `NAME_MISMATCH` only when an unmatched document shares a word naming that fund, not the firm or its fund family (a word in 3+ of the firm's entity names), or shares its fund number ("Summit Secondary VP VII" for "Acme Venture Partners VII" before a rename). Any other fund with no document stays `MISSING`, however many unmatched documents the firm has.
- **Series share one master agreement.** Every series of an LLC can resolve to the same document. The fund the agreement names is the master; the others are marked `inheritedFromMaster` and drop the repeated LP roster.
- **Each extraction goes to one legal vehicle.** An LPA or side letter resolves to the single best fund. Carta often tracks one SPV's rounds as separate funds ("Acme SPV, L.P. (Series A)", "… (Series B)"); when the tied candidates are the same vehicle once labels are dropped, the one LPA covers all of them. The series of a series LLC ("Acme Owl, LLC - Series I", "… - Series II") are not: each series' terms sit in its own schedule, so an agreement goes to the series it names (or that series' classes) — in its fund name ("Acme Series LLC - Kraken Series"), or failing that in the series it states it governs (`fund_info.master_series`, e.g. "Kraken Series", on a series schedule or supplement) — and one stating no series, in its name or in `master_series`, goes to none (a `master_series` naming two or more series, "Series I Units; Series II Units", or describing series in general, "separate and distinct Series of Units", states none): each series without its own agreement is shown as governed by it (`lpaStatus: PARENT_AGREEMENT`, `parentAgreements`) rather than missing. A schedule that states a series, listed or not, never makes its sibling series governed; they are not governed: they show as a name mismatch, with the schedule in `possibleLpaNames`, when the series is unlisted, and as missing otherwise. A series named within its LLC ("Harbor Series (the “Series”) of Acme Series LLC", "Kraken I, a Series of Acme LLC", in the fund name or `master_series`) reads as Carta writes it, "Acme Series LLC - Harbor Series". The text before "of" must end as a series designation (the last series word followed only by labels, such as "Harbor Series", "Series I" or "Series A-1") unless the name says ", a Series of", so "Acme Series A Fund of Funds, LP" is left as it is. An agreement named only by its series ("Harbor Continuation Series") goes to the one series of that name at the firm; the name needs a word beyond the series word and its label, so a bare "Series I" goes nowhere. A series name reaches only that series, or that series followed by a class label ("… Series A1- Class B"), so "Series 1" never reaches "Series 10" and "Series A" never reaches "Series A-1". An LLC with only one listed series keeps its parent's agreement, whether or not Carta splits that series into classes. On any other tie (e.g. an LPA named "Acme 2011 Holdings" when the firm has both "…Holdings, LP" and "…Holdings, LLC") it goes to neither, and each tied fund carries the name in `possibleLpaNames` for review. A fund's one agreement is the one stating the most headline terms (`headlineTermCount`: how many of fee, carry, hurdle, term and investment period it states), then the one with populated terms (`termsExtracted`), then one that names that fund's series, then the stronger name match, then the most recent.
- **Side letter → parent LPA link** is via fund-name match, not a schema FK. When a side letter's `fund` entity name diverges from the LPA's `fund` entity name, the match may miss.
- **A side letter's `fund` entity is not always the firm's own fund.** When the firm's fund is the LP, the extracted `fund`/issuer is someone else and the firm's fund is the `limited_partner`/investor party. If the issuer is another manager's fund, the match is tagged `role: "investor"`, listed apart and left out of `sideLetterCount` and `totalSideLetters`. If the issuer is a portfolio company (e.g. an MFN or information-rights letter from the fund's Series A), it is a `company` letter and sits on no fund: it is not about the firm's LPAs. Check both cases after any change to the side-letter matching logic.
