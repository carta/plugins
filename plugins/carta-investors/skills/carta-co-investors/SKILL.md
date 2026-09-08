---
name: carta-co-investors
description: >
  Interactive co-investor report from Carta SPA data with clickable portfolio
  drill-downs. Use for co-investor analysis or asking who invested in a
  specific portfolio company.
  Trigger phrases: "co-investors", "coinvestors", "who are my co-investors",
  "who else invested", "co-investors by stage/round", "co-investors on Aumni".
  Use instead: carta-explore-data for general fund/investment/portfolio data —
  this skill is specifically for co-investor ("who else invested alongside us")
  analysis.
version: 0.8.1
model: sonnet
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  # The connector check's observed call. Prefix-agnostic so the grant holds
  # whichever form the host registers.
  - mcp__*carta*__welcome
  - mcp__*Carta*__welcome
  # Carta MCP — registration prefix varies by host (Claude Code / Claude.ai / Cowork / public)
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__skill_checkpoint
  - mcp__claude_ai_carta__call_tool
  - mcp__claude_ai_carta__list_contexts
  - mcp__claude_ai_carta__set_context
  - mcp__claude_ai_carta__skill_checkpoint
  # Cowork
  - Artifact
  # Local execution
  - Bash(uv run /sessions/*)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/*)
  - Bash(find /sessions *)
  - Bash(pwd)
  - Read
  - Write
  # Interaction
  - AskUserQuestion
  - ToolSearch
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

<!-- Part of the official Carta AI Agent Plugin -->

# Co-investor analysis

Analyze who co-invests alongside you across your portfolio using Stock Purchase
Agreement (SPA) data uploaded to Carta. Supports both interactive visual reports
and direct analytical questions.

---

## Data source

All SQL reads a single table, `FUND_ADMIN.DOCUMENT_AI_RECORD` — one row per
extracted entity or event, with the type-specific fields in an `ATTRIBUTES`
VARIANT rather than named columns. Each query opens with a prelude that pivots
it into the three relations the analysis needs, so every downstream CTE reads
exactly as it would against named columns:

| Prelude CTE | Filter |
|---|---|
| `spa_issuer` | `RECORD_TYPE = 'company'` |
| `spa_purchaser` | `RECORD_TYPE = 'investor'` |
| `spa_deal` | `RECORD_TYPE = 'stock_purchase'` |

`spa_rec` also filters `FIRM_ID` even though every query filters it again
downstream. That is deliberate: `firm_id` is the leading column of the table's
clustering key, so pinning it here lets Snowflake prune partitions instead of
scanning every firm's records and discarding them after the join. Measured on a
~460-SPA firm it cut Query S from 3.3 GB scanned to 765 MB and 2.65s to 1.25s.
It is safe because `firm_id` is constant across an extraction's records —
verified: zero extractions carry more than one distinct `firm_id`.

**Four rules this surface enforces.** Each one is a silent wrong-answer bug,
not a query error:

1. **Always filter `DOCUMENT_TYPE = 'stock_purchase_agreement'` as well as
   `RECORD_TYPE`.** `RECORD_TYPE` is a generic label — nothing prevents another
   document type from emitting `company` or `investor`, and a collision would
   silently pull foreign entities into the analysis. The shared `spa_rec` CTE
   applies this filter once for all three relations.

2. **Cast before testing for NULL.** Every key is physically present on every
   row, holding a JSON null where there's no value — so `ATTRIBUTES:name IS NOT
   NULL` is *always true* and filters nothing. Test
   `ATTRIBUTES:name::VARCHAR IS NOT NULL` instead. The preludes cast, so
   downstream predicates like `i.ISSUER_NAME IS NOT NULL` behave correctly.

3. **Use `TRY_TO_DATE`, never `::DATE`,** for `effective_date`. It is a string
   attribute here, not a `DATE` column, and `::DATE` throws on malformed
   values. `TRY_TO_DATE` yields NULL, which is what the downstream
   `COALESCE(CAST(CLOSING_DATE AS VARCHAR), …, 'undated')` dedup key expects.

4. **`FIRM_ID` is not always a firm.** A minority of SPA records carry the
   literal `'fund_admin'` placeholder instead of a firm UUID. Those rows are
   invisible to the `FIRM_ID = '<firm_id>'` filter — do not "fix" that by
   relaxing the filter, which would leak other firms' documents.

---

## UX patterns [PATTERN base v0.1.0]

### Typography and text formatting

Follow these rules every time except for machine-readable output (JSON, XML):

- **Casing:** Sentence case always — headings, titles, table column heads. No title case.
- **Punctuation:** No period at the end of headings or titles.
- **Bullets:** Always use `•` — never `-` or `*` for user-facing bullets. Numbered lists use `1.` `2.` `3.`
- **Dates:** `Mmm D, yyyy` format (e.g. `Jan 5, 2024`).
- **Currency (standard):** `$123,456`. Negative: `($445,443)`.
- **Null values:** Use `—` (em-dash), never `N/A`, blank, or prose like "not recorded".

### Tables

Always use Markdown tables for list output with more than one column.

- Numeric columns: right-aligned (header too).
- Text columns: left-aligned (header too).
- Add a single blank line after every table.
- Never use tables for lists of user actions — use `AskUserQuestion` instead.

### Writing style [PATTERN carta-writing-style v0.0.2]

Direct, calm, short sentences. Professional. No "please". Not sycophantic.

- Be clear — plain language, specific actions, understood on first read.
- Match mental models — use fund manager / investor vocabulary; favor domain terms.
- Be concise — say only what the user needs to move forward. No filler.
- Match tone to moment — neutral/direct for tasks; supportive for high-risk actions.
- Action-oriented language — buttons/links describe the action or outcome.
- **Never use "OK", "Submit", "Yes", or "No" as action labels.** Use specific verb + object.
- Never use humor for errors.

### Etiquette [PATTERN etiquette v0.0.6]

1. Always show the user a short (1–4 sentences max) summary of this skill's purpose, plus 2–3 brief bullets describing how it works, on first use.
2. After processing a request that changed data or made non-read tool calls, summarize what changed. Then, if appropriate, suggest 1–3 things the user might do next.

### Step transparency (required during execution)

After every major step, print a one-line status in plain language: what
completed and what comes next.
Example: `SPA data loaded across 23 companies. Building your report…`

Never go silent for more than one step. Never present results without a prior status line.

> **User-facing language — no internals, ever.** The user is a fund manager,
> not an engineer. Status lines, summaries, and error messages must use plain
> investor vocabulary only. **Never** expose any of the following to the user —
> not in a status line, a summary, an error, or an aside: query names
> (“Query S”, “Query R”), SQL, pagination/pages/offsets, `total_rows`, row or
> byte counts, blob/file paths, “Snowflake”/“DWH”/“ndjson”, latency or timing
> breakdowns, retries, UUIDs, or exit codes. Talk about *companies*,
> *co-investors*, *rounds*, and *SPA coverage* — never the machinery that
> produces them. (Example of what NOT to say: “Query S returned 2,837 rows
> across 3 pages.” Say: “SPA data loaded.”)

### Carta watermark [PATTERN carta-watermark v0.0.10]

Every time you respond in natural language to a human user using this skill, show
this Carta ASCII logo at the start of the response:

```
┌───────┐
│ carta │
└───────┘
```

---

## Prerequisites

This skill assumes:

- **Carta MCP connection** — `list_contexts` and `call_tool` available; the user has an active session for at least one investment firm.
- **SPA documents uploaded** — the firm has Stock Purchase Agreements in Carta's Document Intelligence. Without them the artifact renders a "no SPAs found" state rather than an empty table.
- **Mode A needs Cowork.** Live Artifacts only render there. Claude Desktop and the Claude Code CLI get Mode B, which is a full text answer, not a degraded one.
- **`Bash` + `uv`** — Mode A runs one render script. Mode B needs neither.

## Accessibility

Mode B is fully accessible in any text environment — all output is plain Markdown tables.

The Mode A artifact has **not yet been formally audited for WCAG 2.1 AA compliance.** Known considerations:

- Color-only encoding is avoided (entity-type tags use both color and text labels)
- Tooltips are keyboard-focusable (`tabindex="0"`) with `aria-describedby`
- The drawer close button is a real `<button>` with an SVG icon
- Tables use proper `<thead>` / `<tbody>` semantics
- The loading shimmer respects `prefers-reduced-motion`

Users who need a WCAG-compliant text view should request Mode B explicitly ("just tell me", "no file", "quick summary").

---

## When to use

- "Who are my most frequent co-investors?"
- "Show me an interactive co-investor report"
- "Who co-invested with me most often?"
- "Who are my most frequent co-investors with more than 5% of a round?"
- "Who co-invested in [Company Name]?"

---

## Step 0: Announce

Open every invocation with:

> "I'll pull together who co-invests alongside you across your portfolio, using the SPAs uploaded to Carta. Fund vehicles are normalized so each firm counts once."

Then proceed immediately to Step 1.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_started")` before proceeding. Use the same MCP server name (`carta` or `claude_ai_carta`) you're using for `list_contexts` in this session.

---

## Step 1: Establish firm context

1. Call `list_contexts` to get the firm UUID and display name. If nothing is returned → stop with: "I couldn't find any Carta data associated with your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative."
2. Call `call_tool({"name": "fa__list__entities", "arguments": {}})` and extract:
   - `<firm_carta_id>` — the integer PK used in Carta web URLs, from any entity in the response.
   - `<firm_vehicle_names>` — the `name` of every entity returned. These are the firm's own fund vehicles. Without them, a vehicle named differently from the parent firm shows up in its own co-investor list.
3. Store `<firm_id>` (the UUID), `<firm_name>` (display name), `<firm_carta_id>`, and `<firm_vehicle_names>`.
4. Resolve `<base_url>` from the current Carta MCP server URL — **never hardcode an environment URL**, or a sandbox firm deep-links into production. The production MCP server (`mcp.app.carta.com`) maps to the Carta production web app; a sandbox server maps to the matching sandbox web app. It must be a plain `https://` origin with no path — the render script rejects anything else.

**Pre-flight check:** confirm `<firm_id>` is a non-empty UUID string (matches `[a-f0-9-]{36}`). If not, stop with: "Could not determine your firm ID. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative."

---

## Step 2: Route

**The default output is the interactive artifact. Proceed to Step A1.**

Route to **text analysis (Mode B)** when the user explicitly signals text, or asks a question a table answers better than a report:

- "text only", "no file", "just tell me", "quick summary" → Q1
- A specific company by name → Q4
- ">5%", "over 5%", "lead", "leads" → Q2
- "<5%", "less than 5%", "under 5%", "follow-on" → Q3

Route to Mode B when Step A1's gate finds no `Artifact` tool — that means this session is not Cowork.

---

## Mode A — Live Artifact

The artifact shows the firm's most frequent co-investors, with every portfolio company clickable to open a drawer holding the full investor breakdown for that company (investors, % of round, amount paid).

> **The page fetches its own data.** You issue no warehouse queries in Mode A. The rendered HTML calls Carta at runtime through `claude.use("mcp")`, pinning firm context and running the co-investor, rounds, and status queries itself. This is why Mode A costs the same for a 400-company firm as for a 12-company one — no rows ever pass through your context.
>
> Consequences worth holding onto:
> - There is no NDJSON blob to resolve, no `process.py`, and no data file to assemble.
> - Do **not** hand-write or edit the artifact HTML. Every render goes through `render-artifact.py`.
> - Do **not** pre-fetch co-investor data "to check it worked". The artifact reports its own errors to the viewer.

### Step A1: Checks before building

Run both checks, and stay quiet about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session publish at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the connector name the page will call.

Both sit in the **plugin's** `references/` directory — `${CLAUDE_PLUGIN_ROOT}/references/`, alongside the other plugin-wide references. They are *not* under this skill's own `references/`. Read them by that exact path; don't search for them.

If the `Artifact` tool is missing, this session is not Cowork: go to Mode B and tell the user plainly *"I'll give you the analysis as text."* Say nothing about artifacts, Cowork, or sandboxes.

Store the `name` the connector gate resolves as `<CARTA_MCP_SERVER>`. Step A2 passes it to the render script and Step A3 puts it in the `capabilities.mcp` grant. It is one string; there is nothing to derive and nothing to keep in sync.

### Step A2: Render

**2a.** Write `<firm_vehicle_names>` from Step 1 to a JSON file in the session's current working directory, named `<firm-slug>-vehicles.json`. Contents are a JSON array of strings:

```json
["Acme Ventures Fund I, L.P.", "Acme Ventures Opportunities Fund", "Acme Seed II"]
```

Preserve each name verbatim — apostrophes, ampersands, commas and all. The script JSON-escapes hostile characters at substitution time. It is a file rather than a command-line argument because fund names contain apostrophes ("O'Reilly Capital"), which terminate shell single-quoting.

> **This file is load-bearing — write it whenever `fa__list__entities` returns anything.** It is the only thing that keeps the firm's own vehicles out of its own co-investor list. `<firm_name>` alone does not do it: Acme Ventures' funds are named "Acme Fund VI, LP" and "Vela I, LP", neither of which contains the firm name. Skipping the file put the firm's own funds at the top of its report.
>
> Pass every entity name, not just the ones that look like funds. The artifact matches spelling variants ("Acme Fund VI, L.P." against a listed "Acme Fund VI, LP") and short forms, so an over-inclusive list is safe; a missing entry is not.
>
> Omit the argument only when `fa__list__entities` genuinely returns nothing.

**2b.** Locate the script:

```bash
find /sessions "$HOME/mnt" -type f -path '*/carta-co-investors/scripts/render-artifact.py' 2>/dev/null | head -1
```

If it prints nothing, use `${CLAUDE_PLUGIN_ROOT}/skills/carta-co-investors/scripts/render-artifact.py`.

Keep the `find` scoped to those two roots — the remote plugin mounts, the only place bash can reach this script, since it cannot reach the path `${CLAUDE_PLUGIN_ROOT}` expands to there. Locally neither exists, the `find` is empty, and the plugin-root path is the correct one. Do not broaden to `$HOME` or `/`: it takes tens of seconds and can resolve a stale cached copy.

**2c.** Render, substituting the path from 2b **literally**. `allowed-tools` matches the command text, so a shell variable in place of the path fails the allowlist and the call has to be approved by hand each time:

```bash
uv run "<SCRIPT_PATH>" \
    "<CWD>/<firm-slug>-co-investors.html" \
    "<firm-slug>-co-investors" \
    "<CARTA_MCP_SERVER>" \
    "<firm_id>" \
    "<firm_name>" \
    "<firm_carta_id>" \
    "<base_url>" \
    "<CWD>/<firm-slug>-vehicles.json"
```

Positional arguments:

1. **Output path** — must be **absolute**, under the session's current working directory (`<CWD>`), and **not under `/tmp`**. Use `pwd` to resolve `<CWD>` if needed.
2. **Artifact ID** — the kebab-case slug naming this artifact. Must equal `<firm-slug>-co-investors`.
3. **Carta connector display name** — `<CARTA_MCP_SERVER>` from Step A1.
4. **Firm UUID** — from Step 1. The artifact calls `set_context` with this on every load, so the queries succeed even if the user switched contexts elsewhere.
5. **Firm name** — the human-readable name. Also the first firm-vehicle match pattern.
6. **Firm Carta ID** — the numeric organization pk, for the documents deep link.
7. **Base URL** — `<base_url>` from Step 1.
8. **Vehicles file** — optional; the absolute path from 2a, also under CWD and not under `/tmp`.

On success the script prints one stdout line: the absolute output path. It exits non-zero on any validation failure (bad UUID, non-numeric Carta ID, base URL with a path or a non-https scheme, unusable connector name, output or vehicles file outside CWD, malformed vehicles file, missing template or placeholders). If it fails, surface the error and stop — do not fall back to hand-writing HTML.

**Slugification rules** (apply to the **firm name**, not any UUID):

1. Lowercase
2. Replace whitespace with hyphens
3. Strip non-alphanumeric characters except hyphens
4. Collapse consecutive hyphens
5. Trim leading and trailing hyphens

Example: `"Acme Capital Partners, L.P."` → slug `"acme-capital-partners-lp"` → output `acme-capital-partners-lp-co-investors.html`, vehicles file `acme-capital-partners-lp-vehicles.json`, artifact id `acme-capital-partners-lp-co-investors`.

Re-running the skill for the same firm produces the same artifact id and filename, so Step A3 updates the artifact in place.

### Step A3: Publish

> **The render script only writes the HTML file. Nothing picks up file changes on its own — you MUST publish after every render, or the reader keeps seeing the prior version.**

First look for an existing one:

```
Artifact({action: "list", scope: "mine"})
```

If a **<Firm Name> — Co-Investor Analysis** artifact is already published, keep its `url`. Then publish — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<absolute path printed by the render script>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "<Firm Name> — Co-Investor Analysis",
  description: "<Firm Name> — who co-invests alongside you across the portfolio",
  favicon: "🤝",
  capabilities: {
    mcp: {
      servers: [
        { server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "set_context", "welcome"] }
      ]
    }
  }
})
```

All three tools must be in the grant, or the page loads and the matching call rejects with `not_in_manifest`. The artifact only calls `welcome` itself when the MCP reports a "session not initialized" error — see **Session re-initialization** under Caveats.

Keep `title` and `favicon` stable across redeploys, and restate the whole `capabilities` object every time: a non-empty object replaces the stored grant, so a tool left out is revoked.

### Step A4: Confirm

> Your co-investor analysis for **<Firm Name>** is loading in the Cowork sidebar.

Then a 3–5 bullet summary of what it shows — most frequent co-investors ranked by shared portfolio companies, fund vehicles normalized so each firm counts once, click any company to see the round-by-round investor breakdown, filter by live or exited positions, SPA coverage for context. Keep it brief; the customer can see the artifact. Skip the bullets on re-invocation if you've already shown them.

**Cross-skill follow-up.** When SPA coverage is visibly incomplete, append: *"Coverage here is only as complete as the SPAs on file — run the `carta-spa-audit` skill to see which portfolio companies are missing one."*

> **Numbers live in the artifact, not in your reply.** Do not restate co-investor counts, coverage percentages, or company names in chat — you have not seen them. The page queries Carta after your turn ends, so any figure you quote is invented.

---

## Mode B — Text analysis

Answer specific analytical questions about co-investors using aggregation queries.

### Step B0: Build `<CANONICAL_CASE>`

Q1–Q3 substitute a `<CANONICAL_CASE>` expression that collapses one firm's many
fund vehicles into a single canonical row. Build it before any query that needs it.

Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-co-investors/canonical-investors.json`.
It holds one key, `groupings`, a list of `{canonical, patterns}` entries whose
`patterns` are SQL `ILIKE` patterns matched against the raw purchaser name. Emit
one `WHEN` per grouping, preserving file order (first match wins), then fall
through to the raw name:

```
CASE
  WHEN p.PURCHASER_NAME ILIKE '<pattern1>' OR p.PURCHASER_NAME ILIKE '<pattern2>' THEN '<canonical>'
  ...one WHEN per grouping, in file order...
  ELSE p.PURCHASER_NAME
END
```

Escape single quotes in both patterns and canonical names (`'` → `''`).

**Two substitution forms — use the right one.** Q1 substitutes `<CANONICAL_CASE>`
where an alias is required, so the expression must end `... END AS CANONICAL_NAME`.
Q2 and Q3 substitute `<CANONICAL_CASE> AS CANONICAL_NAME`, so there it must end
`... END` with **no** alias — appending one produces a duplicate `AS` and a SQL
compilation error.

> Assemble this programmatically from the JSON rather than transcribing it. At ~29
> groupings and ~2,700 characters, a dropped `WHEN` silently splits one firm into
> several rows. Mode A does not need this step — the artifact reads the same file
> and applies the groupings in JS.

### Step B1: Infer scope and question type

Default to **all funds** — do not ask the user to confirm scope unless they
specifically request a single fund.

Infer the **question type** from `$ARGUMENTS`:
- Company name mentioned → Q4 (company-specific)
- ">5%" or "lead" mentioned → Q2 (frequent leads)
- "<5%" or "less than" mentioned → Q3 (frequent below-threshold)
- Otherwise → **Q1 (most frequent overall)**

Only ask a clarifying question if the request is genuinely ambiguous (e.g. a
company name that could match multiple issuers).

### Step B2: Fetch data

Use `call_tool({"name": "dwh__execute__query", "arguments": {...}})` with the appropriate query below.

> **SPA deduplication:** all queries open with `doc_metadata` + `dedup_docs` CTEs
> that select `MAX(EXTRACTION_ID)` per `(ISSUER_NAME, COALESCE(CLOSING_DATE, SHARE_CLASS_NAME, 'undated'))`.
> This deduplicates duplicate uploads while preserving genuine multiple rounds.

**Standard exclusion filters (add to every WHERE clause):**

```sql
AND p.PURCHASER_NAME NOT ILIKE '%<firm_name>%'
AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%'
AND p.ENTITY_TYPE NOT ILIKE '%notice%'
AND p.ENTITY_TYPE NOT ILIKE '%law firm%'
```

For `<firm_name_spaced>`: insert a space before any digit sequence that follows
a letter (e.g. "Capital99" → "Capital 99").

> If a query fails with a table-not-found error: call `call_tool({"name": "dwh__list__tables", "arguments": {}})`
> to confirm available table names, then retry with the correct names.

#### Q1 — Most frequent overall

Identical to Mode A's Query S in shape. **Run Step B0 first** to assemble
`<CANONICAL_CASE>`. The result schema (`CANONICAL_NAME`, `ENTITY_TYPE`,
`COMPANY_COUNT`, `COMPANIES`, `RAW_NAMES`) maps directly to the Q1 output
table below.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, ATTRIBUTES:name::VARCHAR AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR AS PURCHASER_NAME, ATTRIBUTES:entity_type::VARCHAR AS ENTITY_TYPE, ATTRIBUTES:share_class_name::VARCHAR AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:total_amount_paid::NUMBER(38,2) AS TOTAL_AMOUNT_PAID FROM spa_rec WHERE RECORD_TYPE = 'investor'), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(ATTRIBUTES:effective_date::VARCHAR) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> '' GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), purchaser_canonical AS (SELECT i.ISSUER_NAME, p.PURCHASER_NAME, p.ENTITY_TYPE, <CANONICAL_CASE> FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%') SELECT CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, COUNT(DISTINCT ISSUER_NAME) AS COMPANY_COUNT, ARRAY_AGG(DISTINCT ISSUER_NAME) WITHIN GROUP (ORDER BY ISSUER_NAME) AS COMPANIES, ARRAY_AGG(DISTINCT PURCHASER_NAME) WITHIN GROUP (ORDER BY PURCHASER_NAME) AS RAW_NAMES FROM purchaser_canonical GROUP BY CANONICAL_NAME ORDER BY COMPANY_COUNT DESC LIMIT 50"
}})
```

> Append one `AND p.PURCHASER_NAME NOT ILIKE '%<vehicle>%'` clause per entry in
> the `<firm_vehicle_names>` collected in Step 1, so off-brand firm vehicles
> don't leak into Q1.

#### Q2 — Most frequent with >5% of a round

> **Why "% of round" and not "ownership":** this number reflects the investor's
> share of a single SPA round at purchase time. It is **not** current fully
> diluted ownership — that would require dilution math (subsequent rounds,
> option pool refreshes, secondaries) which SPA data alone cannot provide.
> Never use the word "ownership" in user-facing output for this skill.

Use the Step B0 `CANONICAL_NAME` CASE expression so multi-vehicle investors
are aggregated at the canonical level. % of round is recomputed as
`SUM(canonical shares) / SUM(round shares)` so a firm investing through
multiple vehicles in the same round is credited with the combined stake.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, ATTRIBUTES:name::VARCHAR AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR AS PURCHASER_NAME, ATTRIBUTES:entity_type::VARCHAR AS ENTITY_TYPE, ATTRIBUTES:share_class_name::VARCHAR AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:total_amount_paid::NUMBER(38,2) AS TOTAL_AMOUNT_PAID FROM spa_rec WHERE RECORD_TYPE = 'investor'), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(ATTRIBUTES:effective_date::VARCHAR) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> '' GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), spa_canonical AS (SELECT i.ISSUER_NAME, <CANONICAL_CASE> AS CANONICAL_NAME, p.ENTITY_TYPE, p.SHARES_PURCHASED, s.CLOSING_DATE, dd.EXTRACTION_ID FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID LEFT JOIN spa_deal s ON dd.EXTRACTION_ID = s.EXTRACTION_ID WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%'), per_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, SUM(SHARES_PURCHASED) AS CANONICAL_SHARES FROM spa_canonical GROUP BY ISSUER_NAME, CANONICAL_NAME, EXTRACTION_ID, CLOSING_DATE), pct_per_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, CANONICAL_SHARES / NULLIF(SUM(CANONICAL_SHARES) OVER (PARTITION BY EXTRACTION_ID), 0) AS PCT_OF_ROUND FROM per_round), latest_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND, ROW_NUMBER() OVER (PARTITION BY ISSUER_NAME, CANONICAL_NAME ORDER BY CLOSING_DATE DESC NULLS LAST, EXTRACTION_ID DESC) AS rn FROM pct_per_round), filtered AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND FROM latest_round WHERE rn = 1 AND PCT_OF_ROUND > 0.05) SELECT CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, COUNT(DISTINCT ISSUER_NAME) AS COMPANIES_ABOVE_5PCT, ROUND(AVG(PCT_OF_ROUND) * 100, 1) AS AVG_PCT_OF_ROUND, ARRAY_AGG(DISTINCT ISSUER_NAME) WITHIN GROUP (ORDER BY ISSUER_NAME) AS COMPANIES FROM filtered GROUP BY CANONICAL_NAME ORDER BY COMPANIES_ABOVE_5PCT DESC, AVG_PCT_OF_ROUND DESC LIMIT 50"
}})
```

> Substitute `<CANONICAL_CASE>` with the same assembled CASE block built in
> Step B0 (read from `canonical-investors.json`). Q2/Q3 take the **un-aliased**
> form — see the two-substitution-forms note in that step.

#### Q3 — Most frequent with <5% of a round

Same shape as Q2 with three changes: filter is `PCT_OF_ROUND < 0.05 AND
PCT_OF_ROUND > 0 AND PCT_OF_ROUND < 1.0` (the `< 1.0` clause excludes
single-purchaser SPAs where the investor was the only buyer); aggregate column
is renamed `COMPANIES_BELOW_5PCT`; rounding goes to 2 decimals to match the
small percentage values.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, ATTRIBUTES:name::VARCHAR AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR AS PURCHASER_NAME, ATTRIBUTES:entity_type::VARCHAR AS ENTITY_TYPE, ATTRIBUTES:share_class_name::VARCHAR AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:total_amount_paid::NUMBER(38,2) AS TOTAL_AMOUNT_PAID FROM spa_rec WHERE RECORD_TYPE = 'investor'), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(ATTRIBUTES:effective_date::VARCHAR) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> '' GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), spa_canonical AS (SELECT i.ISSUER_NAME, <CANONICAL_CASE> AS CANONICAL_NAME, p.ENTITY_TYPE, p.SHARES_PURCHASED, s.CLOSING_DATE, dd.EXTRACTION_ID FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID LEFT JOIN spa_deal s ON dd.EXTRACTION_ID = s.EXTRACTION_ID WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%'), per_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, SUM(SHARES_PURCHASED) AS CANONICAL_SHARES FROM spa_canonical GROUP BY ISSUER_NAME, CANONICAL_NAME, EXTRACTION_ID, CLOSING_DATE), pct_per_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, CANONICAL_SHARES / NULLIF(SUM(CANONICAL_SHARES) OVER (PARTITION BY EXTRACTION_ID), 0) AS PCT_OF_ROUND FROM per_round), latest_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND, ROW_NUMBER() OVER (PARTITION BY ISSUER_NAME, CANONICAL_NAME ORDER BY CLOSING_DATE DESC NULLS LAST, EXTRACTION_ID DESC) AS rn FROM pct_per_round), filtered AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND FROM latest_round WHERE rn = 1 AND PCT_OF_ROUND < 0.05 AND PCT_OF_ROUND > 0 AND PCT_OF_ROUND < 1.0) SELECT CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, COUNT(DISTINCT ISSUER_NAME) AS COMPANIES_BELOW_5PCT, ROUND(AVG(PCT_OF_ROUND) * 100, 2) AS AVG_PCT_OF_ROUND, ARRAY_AGG(DISTINCT ISSUER_NAME) WITHIN GROUP (ORDER BY ISSUER_NAME) AS COMPANIES FROM filtered GROUP BY CANONICAL_NAME ORDER BY COMPANIES_BELOW_5PCT DESC, AVG_PCT_OF_ROUND DESC LIMIT 50"
}})
```

#### Q4 — Company-specific

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, ATTRIBUTES:name::VARCHAR AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR AS PURCHASER_NAME, ATTRIBUTES:entity_type::VARCHAR AS ENTITY_TYPE, ATTRIBUTES:share_class_name::VARCHAR AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:total_amount_paid::NUMBER(38,2) AS TOTAL_AMOUNT_PAID FROM spa_rec WHERE RECORD_TYPE = 'investor'), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(ATTRIBUTES:effective_date::VARCHAR) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')) SELECT dd.EXTRACTION_ID, i.ISSUER_NAME, p.SHARE_CLASS_NAME, s.CLOSING_DATE, p.PURCHASER_NAME, p.ENTITY_TYPE, p.SHARES_PURCHASED, p.TOTAL_AMOUNT_PAID, p.SHARES_PURCHASED / NULLIF(SUM(p.SHARES_PURCHASED) OVER (PARTITION BY dd.EXTRACTION_ID), 0) AS PCT_OF_ROUND FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID LEFT JOIN spa_deal s ON dd.EXTRACTION_ID = s.EXTRACTION_ID WHERE i.ISSUER_NAME ILIKE '%<company_name>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%' ORDER BY s.CLOSING_DATE DESC, p.SHARES_PURCHASED DESC LIMIT 500"
}})
```

> Column note: use `p.SHARE_CLASS_NAME` from the purchaser table as the round label.
> The SPA table does not have a `SERIES_NAME` column. Q4 leaves purchaser names
> as raw values so the breakdown matches the SPA document line-for-line.

Tell the user: `SPA data loaded. Preparing results…`

### Step B3: Present results

**Coverage note — always include:**
"Results cover **X** of your **Y** priced-equity portfolio companies that have at least one SPA on file."

> **What X means:** the count of portfolio companies (from your SOI) with at
> least one matching SPA in Carta. Companies with multiple SPAs (e.g. one per
> round) count once. SPAs whose issuer name doesn't match any current portfolio
> company are excluded.

#### Q1 output

> **<Firm name> — Most frequent co-investors**
> (X of your Y priced-equity portfolio companies have at least one SPA on file)
> *Co-investment counts are per company, not per round. Multi-vehicle investors
> are aggregated to a single canonical entry per the groupings in
> `canonical-investors.json`.*

| Co-investor | Companies | Entity type | Portfolio companies |
|---|---|---|---|
| [Name] | [N] | [type] | Co. 1, Co. 2, Co. 3 |

*Name groupings applied: list rows where `RAW_NAMES` contains a `||` separator
— each becomes "Raw Name A" + "Raw Name B" → **Canonical Name**. Omit the
section if no rows had multi-vehicle groupings.*

[View SPA source documents in Carta](<base_url>/investors/firm/<firm_carta_id>/portfolio/documents/)

---

#### Q2 output

> **<Firm name> — Most frequent co-investors with >5% of a round**
> *% of round is calculated from shares at SPA closing — purchase-time only.
> This is not the investor's current cap table position; that would require
> dilution math (subsequent rounds, option pool refreshes, secondaries) not
> derivable from SPA data alone.*

| Co-investor | Companies >5% | Avg % of round | Entity type | Portfolio companies |
|---|---|---|---|---|

[View SPA source documents in Carta](<base_url>/investors/firm/<firm_carta_id>/portfolio/documents/)

---

#### Q3 output

Same as Q2 but heading reads "with <5% of a round".

---

#### Q4 output

For each round (grouped by `EXTRACTION_ID`), render a separate section:

> **<Firm name> — <Company name>, <Share class>** (Closing: <date or —>)
> <N> investors | Total raised: $X,XXX

| Investor | Entity type | Shares | Amount paid | % of round |
|---|---|---|---|---|
| [Your fund] **(You)** | [type] | [N] | $[X,XXX] | [X.X%] |

[View SPA source documents in Carta](<base_url>/investors/firm/<firm_carta_id>/portfolio/documents/)

If no match: "No SPA found for '[name]'. Did you mean one of these? [list closest matches from available issuers]"

### Step B4: Recommend next step

End with one concrete suggested next step:

- After Q1 → "Want to drill into a specific company to see the full investor breakdown?"
- After Q4 → "Want to see which of these investors took >5% of a round in your portfolio companies?"
- After Q2 → "Want to compare with investors who come in at <5% — the smaller check followers?"
- After Q3 → offer a summary insight and suggest generating the interactive artifact report

Do not repeat the full menu after every result. If the user asks "what else can you show me?", surface:
1. Drill into a specific co-investor — all companies you share with them
2. Switch question type — overall / >5% / <5% / by company
3. List portfolio companies with missing SPA data
4. Generate the interactive visual report

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_finished")`.

---

## Error handling

| Scenario | Response |
|---|---|
| `list_contexts` returns nothing | "I couldn't find any Carta data for your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative." |
| `firm_id` fails pre-flight UUID check | "Could not determine your firm ID. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative." |
| 401/403 from any DWH query | "Your Carta session has expired. Reconnect to the Carta MCP server and try again." |
| Query fails with table-not-found | Call `dwh:list:tables` to confirm available table names, then retry with correct names. |
| 0 SPA rows returned | "No SPA documents were found for your account. Contact your Carta representative if you believe this is an error." |
| Company name not found (Q4) | "No SPA found for '[name]'. Did you mean: [suggestions from available issuers]?" |
| Partial SPA coverage | Note in results: "X of your Y portfolio companies have at least one SPA on file." Offer to list missing companies. |
| MCP query error | "Could not reach Carta data. Try again in a moment." |
| `render-artifact.py` exits non-zero | Surface the script's stderr and stop. Never hand-write the artifact HTML. |
| No `Artifact` tool (Step A1 gate) | Go to Mode B. Tell the user "I'll give you the analysis as text" — nothing about Cowork, artifacts, or sandboxes. |
| Artifact publishes but renders an error | That error is the page's own and names its cause. Do not re-run Mode A blind; read what the viewer sees first. |
