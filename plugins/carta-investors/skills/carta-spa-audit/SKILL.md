---
name: carta-spa-audit
description: >-
  SPA coverage audit across your portfolio — categorizes every equity investment as missing, unexecuted, executed, or not needed. Use when asked about SPA coverage, missing SPAs, unexecuted SPAs, or document completeness.
version: 0.9.4
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
  - mcp__carta__list_accounts
  - mcp__carta__set_context
  - mcp__carta__skill_checkpoint
  - mcp__claude_ai_carta__call_tool
  - mcp__claude_ai_carta__list_contexts
  - mcp__claude_ai_carta__list_accounts
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
  - Skill
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

# SPA audit

Audit SPA (Stock Purchase Agreement) coverage across your portfolio. Every portfolio company lands in exactly one of four buckets — missing, unexecuted, executed, or not needed — ranked by cost basis within each bucket.

---

## UX patterns [PATTERN base v0.1.0]

### Typography and text formatting [PATTERN text v0.0.8]

Follow these rules every time except for machine-readable output (JSON, XML):

- **Casing:** Sentence case always — headings, titles, table column heads. No title case.
- **Punctuation:** No period at the end of headings or titles.
- **Bullets:** Always use `•` — never `-` or `*` for user-facing bullets. Numbered lists use `1.` `2.` `3.`
- **Dates:** `Mmm D, yyyy` format (e.g. `Jan 5, 2024`). Exception: first invested dates are shown as `Mmm yyyy` (month-level — day precision is not meaningful for portfolio-entry dates).
- **Currency (standard):** `$123,456`. Negative: `($445,443)`.
- **Null values:** Use `—` (em-dash), never `N/A`, blank, or prose like "not recorded".

### Tables [PATTERN tables v0.0.12]

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

After every major step, print a one-line status in plain language: what completed and what comes next.
Example: `Investment records loaded across 47 companies. Looking up SPA documents…`

Never go silent for more than one step. Never present results without a prior status line.

> **User-facing language — no internals, ever.** The user is a fund manager, not an engineer. Status lines, summaries, and error messages must use plain investor vocabulary only. **Never** expose any of the following to the user — not in a status line, a summary, an error, or an aside: query names, SQL, pagination/pages/offsets, `total_rows`, row or byte counts, blob/file paths, "Snowflake"/"DWH"/"ndjson", latency or timing breakdowns, retries, UUIDs, or exit codes. Talk about *companies*, *SPAs*, *portfolios*, and *coverage* — never the machinery that produces them.

### Carta watermark [PATTERN carta-watermark v0.0.10]

Every time you respond in natural language to a human user using this skill, show this Carta ASCII logo at the start of the response:

```
┌───────┐
│ carta │
└───────┘
```

---

## Prerequisites

- **Carta MCP connection** — `list_contexts` and `fetch` tools available; user has an active session for at least one investment firm.
- **SPA documents uploaded** — the firm has Stock Purchase Agreements in Carta's Document Intelligence; without them, all equity companies land in bucket 1 (missing SPA).
- **Mode A needs Cowork.** Live Artifacts only render there. Claude Desktop and the Claude Code CLI get Mode B, which is a full text answer, not a degraded one.

## Accessibility

The Mode B text path is fully accessible in any text environment — all output is plain Markdown tables.

The Mode A interactive HTML artifact has **not yet been formally audited for WCAG 2.1 AA compliance.** Known considerations:

- Color-only encoding is avoided: every bucket badge and tile pairs its accent color with a text label.
- The drawer close button is a real `<button>` with an SVG icon and `aria-label`.
- The Escape key closes the drawer.
- Tables use proper `<thead>` / `<tbody>` semantics; sort headers expose `aria-sort` state.
- Search input has an `aria-label`.

Users who need a WCAG-compliant text view should request Mode B explicitly ("text only", "no file", "quick summary").

---

## When to use

- "Run SPA audit"
- "Show me SPA coverage across my portfolio"
- "Which companies are missing SPAs?"
- "Which portfolio companies have executed SPAs?"
- "What's our SPA status?"
- "Do we have SPAs on file for all our equity investments?"

---

## SPA data source

Every SPA query below reads one surface: `FUND_ADMIN.DOCUMENT_AI_RECORD`, the generic, document-type-agnostic view. Extracted fields live in the `ATTRIBUTES` JSON column and need explicit casts (`ATTRIBUTES:name::STRING`).

Two rules when writing or editing any of these queries:

1. **Filter on both `DOCUMENT_TYPE = 'stock_purchase_agreement'` and the relevant `RECORD_TYPE`.** The `RECORD_TYPE` labels (`company`, `investor`, `security`, `stock_purchase`) are generic and reused by other document types — an LPA also has `company` and `investor` records. `RECORD_TYPE` alone silently pulls unrelated documents into the audit.
2. **Relate record types within a document by `DOCUMENT_ID` or `EXTRACTION_ID`** — the view holds exactly one extraction per document, so either key works and no deduplication is needed.

> **A SPA extracted before this pipeline became the source of record will not appear.** Those documents live only in the older per-type views (`DOCUMENT_AI_SPA_ISSUER` and friends), which this skill no longer reads, and the company will read as "Missing SPA" until it is re-extracted. Do not reintroduce a read of those views to patch an individual gap — the source of record is one surface, and a fix belongs upstream in the extraction backfill.

---

## Step 0: Announce

Open every invocation with:

> "I'll audit SPA coverage across your portfolio — pulling every investment record and SPA document from Carta, then categorizing each company by execution status. Larger portfolios take a moment."

Then proceed immediately to Step 1.

---

## Step 1: Establish firm context

1. Call `list_contexts`. If no context is returned, stop with: "I couldn't find any Carta data associated with your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative."
2. Note the firm `id` — this is your `<firm_id>` for every query below.
3. Note the firm display name — this is your `<firm_name>`.
4. Call `list_accounts` searching for `<firm_name>`. Find the entry with `type: "investment firm"`. Extract the numeric portion of its `id` (e.g. `"organization_pk:2645"` → `2645`) — this is `<org_pk>` for the document library link in Step 3.
5. Resolve `<base_url>` from the current Carta MCP server context — never hardcode an environment URL. For the production MCP server (`mcp.app.carta.com`), `<base_url>` is the Carta production web app URL. For any other server, default to the same production URL.

**Pre-flight check:** confirm that `<firm_id>` is a non-empty UUID string (matches pattern `[a-f0-9-]{36}`). If not, stop with: "Could not determine your firm ID. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative."

Tell the user: `Firm context loaded: <firm_name>. Fetching investment records and SPA documents…`

---

## Step 2: Route

**The default output of this skill is the interactive artifact (Mode A). Proceed directly to Mode A Step A1.**

Only route to **text-only (Mode B)** when the user explicitly signals it:
- Says "text only", "no file", "quick summary", "just tell me", or "list missing only" → Mode B
- Asks to drill into a specific named company (any phrasing) → run Mode B Step B0 cache check + drill-down only

Everything else — including any general "audit my SPAs" or "show coverage" request — goes to Mode A.

Route to Mode B when Step A1's gate finds no `Artifact` tool — that means this session is not Cowork.

---

## Mode A — Live Artifact

The artifact shows the firm's four-bucket SPA audit — missing, unexecuted, executed, no SPA needed — ranked by cost basis within each bucket, with every company that has an SPA on file clickable to open a drawer holding the full SPA and purchaser breakdown for that company.

> **The page fetches its own data.** You issue no warehouse queries in Mode A. The rendered HTML calls Carta at runtime through `claude.use("mcp")`, pinning firm context and running the audit, drill-down, enrichment, status, and coverage queries itself. This is why Mode A costs the same for a 400-company firm as for a 12-company one — no rows ever pass through your context.
>
> Consequences worth holding onto:
> - There is no NDJSON blob to resolve, no `process.py`, and no data file to assemble.
> - Do **not** hand-write or edit the artifact HTML. Every render goes through `render-artifact.py`.
> - Do **not** pre-fetch SPA data "to check it worked". The artifact reports its own errors to the viewer.

### Step A1: Checks before building

Run both checks, and stay quiet about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session publish at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the connector name the page will call.

Both sit in the **plugin's** `references/` directory — `${CLAUDE_PLUGIN_ROOT}/references/`, alongside the other plugin-wide references. They are *not* under this skill's own `references/`. Read them by that exact path; don't search for them.

If the `Artifact` tool is missing, this session is not Cowork: go to Mode B and tell the user plainly *"I'll give you the audit as text."* Say nothing about artifacts, Cowork, or sandboxes.

Store the `name` the connector gate resolves as `<CARTA_MCP_SERVER>`. Step A2 passes it to the render script and Step A3 puts it in the `capabilities.mcp` grant. It is one string; there is nothing to derive and nothing to keep in sync.

### Step A2: Render

Locate the script:

```bash
find /sessions "$HOME/mnt" -type f -path '*/carta-spa-audit/scripts/render-artifact.py' 2>/dev/null | head -1
```

If it prints nothing, use `${CLAUDE_PLUGIN_ROOT}/skills/carta-spa-audit/scripts/render-artifact.py`.

Keep the `find` scoped to those two roots — the remote plugin mounts, the only place bash can reach this script, since it cannot reach the path `${CLAUDE_PLUGIN_ROOT}` expands to there. Locally neither exists, the `find` is empty, and the plugin-root path is the correct one. Do not broaden to `$HOME` or `/`: it takes tens of seconds and can resolve a stale cached copy.

Render, substituting the path found above **literally**. `allowed-tools` matches the command text, so a shell variable in place of the path fails the allowlist and the call has to be approved by hand each time:

```bash
uv run "<SCRIPT_PATH>" \
    "<CWD>/<firm-slug>-spa-audit.html" \
    "<firm-slug>-spa-audit" \
    "<CARTA_MCP_SERVER>" \
    "<firm_id>" \
    "<firm_name>" \
    "<org_pk>" \
    "<base_url>"
```

Positional arguments:

1. **Output path** — must be **absolute**, under the session's current working directory (`<CWD>`), and **not under `/tmp`**. Use `pwd` to resolve `<CWD>` if needed.
2. **Artifact ID** — the kebab-case slug naming this artifact. Must equal `<firm-slug>-spa-audit`.
3. **Carta connector display name** — `<CARTA_MCP_SERVER>` from Step A1.
4. **Firm UUID** — from Step 1. The artifact calls `set_context` with this on every load, so the queries succeed even if the user switched contexts elsewhere.
5. **Firm name** — the human-readable name, shown in the page header.
6. **Firm Carta ID** — `<org_pk>` from Step 1, the numeric organization pk, for the documents deep link.
7. **Base URL** — `<base_url>` from Step 1.

On success the script prints one stdout line: the absolute output path. It exits non-zero on any validation failure (bad UUID, non-numeric Carta ID, base URL with a path or a non-https scheme, unusable connector name, output outside CWD, missing template or placeholders). If it fails, surface the error and stop — do not fall back to hand-writing HTML.

**Slugification rules** (apply to the **firm name**, not any UUID):

1. Lowercase
2. Replace whitespace with hyphens
3. Strip non-alphanumeric characters except hyphens
4. Collapse consecutive hyphens
5. Trim leading and trailing hyphens

Example: `"Acme Capital Partners, L.P."` → slug `"acme-capital-partners-lp"` → output `acme-capital-partners-lp-spa-audit.html`, artifact id `acme-capital-partners-lp-spa-audit`.

Re-running the skill for the same firm produces the same artifact id and filename, so Step A3 updates the artifact in place.

### Step A3: Publish

> **The render script only writes the HTML file. Nothing picks up file changes on its own — you MUST publish after every render, or the reader keeps seeing the prior version.**

First look for an existing one:

```
Artifact({action: "list", scope: "mine"})
```

If a **<Firm Name> — SPA coverage audit** artifact is already published, keep its `url`. Then publish — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<absolute path printed by the render script>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "<Firm Name> — SPA coverage audit",
  description: "<Firm Name> — SPA coverage across your portfolio, missing/unexecuted/executed/not-needed",
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

> Your SPA coverage audit for **<Firm Name>** is loading in the Cowork sidebar.

Then a 3–5 bullet summary of what it shows — the four-bucket audit (missing, unexecuted, executed, no SPA needed) ranked by cost basis, a coverage stat contrasting count vs. cost-basis coverage, click any company with an SPA on file to see the document and purchaser breakdown in a drawer, fund and geography filters, live/exited tabs. Keep it brief; the customer can see the artifact. Skip the bullets on re-invocation if you've already shown them.

**Cross-skill follow-up.** Always append a one-line suggestion to run `carta-co-investors`: *"Want to see who co-invests alongside you in these portfolio companies? Run the `carta-co-investors` skill — it builds an interactive co-investor report from the same SPA data this audit just collected."*

> **Numbers live in the artifact, not in your reply.** Do not restate coverage percentages, bucket counts, or company names in chat — you have not seen them. The page queries Carta after your turn ends, so any figure you quote is invented.

---

## Mode B — Audit (text)

Render the four-bucket audit as Markdown tables. Single fetch, single render.

### Step B0: Resolve workspace and check cache

Before fetching anything, resolve a stable, cross-platform working directory. The audit cache and (in v0.4.0) the HTML artifact both live under `$WORKSPACE`. **Both the Claude process AND the preview-panel host must be able to read this path** — on Cowork demo VMs running macOS 26.5+ the host can no longer see `~/.cache/...` or `/tmp/...`. The probe below picks the right path automatically: Cowork sandboxes get `$HOME/mnt/outputs/` (the bind-mounted session outputs dir, visible from both VM and host), regular Claude Code CLI laptops get `carta workspace cache`, and anything else falls back to `$TMPDIR`.

```bash
if [ -d "${HOME}/mnt/outputs" ] && [ -w "${HOME}/mnt/outputs" ]; then
  # Cowork sandbox: $HOME is the session root (/sessions/<name>) and
  # mnt/outputs/ is the bind mount the macOS host sees as
  # ~/Library/Application Support/Claude/.../outputs/. Writes here are
  # readable by both the sandboxed Claude process and the host.
  WORKSPACE="${HOME}/mnt/outputs/carta-spa-audit"
elif command -v carta >/dev/null 2>&1; then
  # Regular Claude Code CLI on a developer laptop.
  WORKSPACE=$(carta workspace cache carta-spa-audit | jq -r .)
else
  # Last-resort fallback (e.g. CI / hosted runtimes without Carta CLI).
  WORKSPACE="${TMPDIR:-/tmp}/carta-spa-audit"
fi
mkdir -p "$WORKSPACE"
```

Do not hardcode `/tmp` — it breaks on Windows and is invisible to the Cowork host on macOS 26.5+.

**Cache check.** If `$WORKSPACE/carta-spa-audit-data.json` exists AND is less than 60 minutes old AND the cached `firmId` matches the current `<firm_id>`, read it and skip Step B1 entirely:

```bash
test -f "$WORKSPACE/carta-spa-audit-data.json" && \
  find "$WORKSPACE/carta-spa-audit-data.json" -mmin -60 -print
```

If the file is fresh:
1. `Read` it.
2. Confirm `data.meta.firmId == <firm_id>` (cache is per-firm; a stale cache from another firm must be ignored).
3. Tell the user: `Using cached SPA data from $(date -r "$WORKSPACE/carta-spa-audit-data.json" "+%H:%M"). Preparing results…`
4. Skip Step B1 and proceed directly to Step B2.

**Fall through to Step B1 (live fetch) when:**
- The cache file does not exist
- The cache file is older than 60 minutes
- The cached `firmId` does not match
- The user explicitly asks to refresh (e.g. "rerun", "fresh data")

Drill-down queries always run live — per-company SPA documents are too noisy to cache and the user expects current data when they ask for it.

### Step B1: Fetch audit data

Run the main audit query and the two coverage queries in parallel.

### Main audit query

Reads the unified SPA source (see below), groups by issuer name to deduplicate multi-upload cases, then fuzzy-matches investment names to SPA issuer names at Jaro-Winkler ≥ 90 to catch variants like "AcmeCorp, Inc." vs. "AcmeCorp Inc." or "AcmeCo International Inc. (fka. OldName, Inc.)" vs. "AcmeCo International Inc."

**Important — regex escaping:** Snowflake processes backslashes in string literals (`\s` → `s`), so patterns that need a literal backslash for the regex engine must use `\\` in the SQL string. The patterns below use `[(]`, `[)]`, and `[ ]` (space) instead of `\(`, `\)`, and `\s` to avoid this entirely.

> **`fuzzy_matched` needs a total ordering — do not drop a trailing ORDER BY key.** Once `norm_investments` emits an alias candidate alongside the primary name, one investment can score 100 against two different SPAs, and `has_executed_spa DESC` alone does not separate them. With a tie, `ROW_NUMBER()` picks whichever row the plan happens to emit first, so the SPA named against a company changes between runs of the *same* audit. The rank ends `..., s.has_executed_spa DESC, i.is_alias, s.spa_name`: the executed flag keeps its precedence so bucket assignment is untouched, `is_alias` prefers a match on the company's own name over its former name, and `spa_name` makes the order total.

> **`NULLS LAST` on that same rank is load-bearing — do not drop it.** `fuzzy_matched` ranks candidates through a `LEFT JOIN`, and Snowflake sorts NULLs **first** on a `DESC` ordering. Without `NULLS LAST`, a company whose primary name finds no SPA but whose alias scores 100 has its NULL row win `rn = 1`, carries a NULL `spa_name` into `labeled`, and gets bucketed "1. Missing SPA" — silently discarding exactly the matches the alias candidates exist to recover. At one firm that was the difference between 66 and 133 companies in Executed SPA. Like the total ordering above, it only became load-bearing once `norm_investments` emitted more than one row per investment. The co-investors skill carries the same clause; keep the two in step.

> **CRITICAL — fetch ONCE; never re-issue this query with a different `offset`.** A single fetch with `limit: 500` covers any real portfolio (even Sequoia-scale firms top out around 300 portfolio companies). Do **not** re-run this query for "later pages." Reason: when the model re-types this ~1,500-char SQL for a second call it reliably corrupts a token — the embedded firm UUID drifts (e.g. `…8af6…` → `…8ad6…`), or a JOIN key changes (`d.DOCUMENT_ID` → `s.DOCUMENT_ID`), silently dropping rows or failing the call. One fetch means the SQL is authored exactly once and this whole class of error cannot happen.
>
> **If the row count ever exceeds 500** (it won't for any real firm — flag it as a data anomaly rather than paginating): raise `limit` in the same single call. Never add `offset` pages.

Replace `<firm_id>` with the firm id from Step 1.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_issuers AS (SELECT ATTRIBUTES:name::STRING AS ISSUER_NAME, ATTRIBUTES:executed_by_issuer::BOOLEAN AS EXECUTED_BY_ISSUER FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement' AND RECORD_TYPE = 'company' AND ATTRIBUTES:name::STRING IS NOT NULL), norm_spa AS (SELECT ISSUER_NAME AS spa_name, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS name_norm, MAX(CASE WHEN EXECUTED_BY_ISSUER = TRUE THEN 1 ELSE 0 END) AS has_executed_spa FROM spa_issuers GROUP BY ISSUER_NAME), norm_investments_base AS (SELECT ISSUER_NAME, MAX(CASE WHEN ASSET_CLASS_TYPE = 'PREFERRED_EQUITY' THEN 1 ELSE 0 END) AS has_preferred, MAX(CASE WHEN ASSET_CLASS_TYPE = 'COMMON_EQUITY' THEN 1 ELSE 0 END) AS has_common, MIN(INVESTMENT_DATE) AS first_invested, SUM(CASE WHEN IS_FOREIGN_CURRENCY_INVESTMENT THEN BASE_CURRENCY_TOTAL_COST ELSE TOTAL_COST END) AS total_cost_basis, COUNT(DISTINCT CASE WHEN IS_FOREIGN_CURRENCY_INVESTMENT THEN BASE_CURRENCY_CODE ELSE CURRENCY_CODE END) AS currency_count, MAX(CASE WHEN IS_FOREIGN_CURRENCY_INVESTMENT THEN BASE_CURRENCY_CODE ELSE CURRENCY_CODE END) AS currency_code, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS name_norm, COALESCE(REGEXP_SUBSTR(ISSUER_NAME, '[(] *(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?)[ :]+([^)]+)[)]', 1, 1, 'ie', 3), REGEXP_SUBSTR(ISSUER_NAME, '[(]([^)]+)[)]', 1, 1, 'e', 1)) AS alias_raw FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' GROUP BY ISSUER_NAME), norm_investments AS (SELECT ISSUER_NAME, has_preferred, has_common, first_invested, total_cost_basis, currency_count, currency_code, name_norm, 0 AS is_alias FROM norm_investments_base UNION ALL SELECT ISSUER_NAME, has_preferred, has_common, first_invested, total_cost_basis, currency_count, currency_code, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(alias_raw), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS name_norm, 1 AS is_alias FROM norm_investments_base WHERE alias_raw IS NOT NULL AND TRIM(alias_raw) <> ''), fuzzy_matched AS (SELECT i.ISSUER_NAME, i.has_preferred, i.has_common, i.first_invested, i.total_cost_basis, i.currency_count, i.currency_code, s.spa_name, s.has_executed_spa, ROW_NUMBER() OVER (PARTITION BY i.ISSUER_NAME ORDER BY JAROWINKLER_SIMILARITY(i.name_norm, s.name_norm) DESC NULLS LAST, s.has_executed_spa DESC, i.is_alias, s.spa_name) AS rn FROM norm_investments i LEFT JOIN norm_spa s ON JAROWINKLER_SIMILARITY(i.name_norm, s.name_norm) >= 90), best AS (SELECT * FROM fuzzy_matched WHERE rn = 1), labeled AS (SELECT CASE WHEN has_preferred = 0 AND has_common = 0 THEN 4 WHEN spa_name IS NULL THEN 1 WHEN has_executed_spa = 0 THEN 2 ELSE 3 END AS sort_key, CASE WHEN has_preferred = 0 AND has_common = 0 THEN '4. No SPA needed' WHEN spa_name IS NULL THEN '1. Missing SPA' WHEN has_executed_spa = 0 THEN '2. SPA not executed' ELSE '3. Executed SPA' END AS spa_bucket, ISSUER_NAME AS company, spa_name, first_invested, total_cost_basis, currency_count, currency_code FROM best) SELECT spa_bucket, company, spa_name, first_invested, total_cost_basis, currency_count, currency_code FROM labeled ORDER BY sort_key, total_cost_basis DESC NULLS LAST, company",
  "limit": 500
}})
```

### Coverage queries (run in parallel with the main query)

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT COUNT(DISTINCT ATTRIBUTES:name::STRING) AS spa_companies FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement' AND RECORD_TYPE = 'company' AND ATTRIBUTES:name::STRING IS NOT NULL"
}})

call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT COUNT(DISTINCT ISSUER_NAME) AS total_companies FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>'"
}})
```

If any query fails with a table-not-found error, call `call_tool({"name": "dwh__list__tables", "arguments": {}})` to confirm available table names, then retry.

**Bucket definitions:**
- **1. Missing SPA** — holds equity (preferred or common) but no SPA document found in Carta
- **2. SPA not executed** — SPA uploaded but `EXECUTED_BY_ISSUER = FALSE` on all documents for that issuer
- **3. Executed SPA** — at least one SPA with `EXECUTED_BY_ISSUER = TRUE`
- **4. No SPA needed** — no preferred or common equity (SAFE-only, convertible debt, fund investment, warrants, tokens, etc.)

Tell the user: `SPA data loaded. Building your coverage report…`

### Step B1.5: Write cache

After both queries return, assemble a cache payload and write it to `$WORKSPACE/carta-spa-audit-data.json` so a re-invocation within 60 minutes can skip the live fetch (Step B0).

Cache schema:

```json
{
  "meta": {
    "firmId": "<firm_id>",
    "firmName": "<firm_name>",
    "firmCartaId": <org_pk>,
    "generatedAt": "<UTC ISO 8601 timestamp>"
  },
  "coverage": {
    "totalCompanies": <Y>,
    "spaCompanies": <X>
  },
  "buckets": {
    "missing":     [{"company": "...", "firstInvested": "YYYY-MM-DD", "costBasis": <number>}, ...],
    "unexecuted":  [...],
    "executed":    [...],
    "notNeeded":   [...]
  }
}
```

Use `Write` to write the JSON. Group the main audit query's rows by `spa_bucket` into the four bucket arrays. Drill-down data is NOT cached (always fetched live in Step B2 follow-ups).

---

### Step B2: Present results

**BLUF lead:** One sentence with the coverage fraction and bucket breakdown before the tables.

> "**X** of your **Y** priced-equity portfolio companies have an SPA on file. Of those equity investments: **A** are missing an SPA entirely, **B** have executed SPAs on file, and **C** have an SPA uploaded but not yet executed. **Z** additional investment(s) don't need an SPA (SAFEs, convertible notes, fund/LP positions, tokens, warrants)."

> **Y is priced-equity only.** Count investments in the Executed / Unexecuted / Missing buckets — exclude "No SPA needed" from the denominator. That bucket surfaces in its own sub-table as an FYI. This keeps the co-investor skill and the SPA-audit skill reporting the same coverage % for the same firm.

Then present **four separate sub-tables** — one per bucket, in priority order, each with its own heading. Do not combine into one flat table.

**Formatting rules (all tables):**
- Currency: `$X,XXX,XXX` with commas, no cents
- Dates: `Mmm yyyy` (e.g. "Dec 2017") — month-level is intentional for first invested
- `#` column for row references — does not count toward the 6-column limit
- Never show raw UUIDs
- Sort each sub-table by `total_cost_basis DESC` when rendering — filter rows by their `spa_bucket` value and sort within that bucket, regardless of the order rows arrived from the query
- Within actionable buckets, insert a `— Exited / written-off positions —` divider row between the last `$>0` entry and the first `$0` cost-basis row
- **Fuzzy-match footnote:** if any company was matched to its SPA via Jaro-Winkler similarity (not an exact name match), append `*` to that company name and add a footnote below the table: `* matched via name similarity`

---

#### ❌ Missing SPA — A companies

Show all rows individually — each represents a gap to remediate.

| # | Company | First invested | Cost basis |
|---|---------|---------------|----------:|
| 1 | Acme Holdings, Inc. | Nov 2017 | $30,534,806 |

---

#### ⚠ SPA not executed — C companies

SPA is on file but needs the issuer's signature.

| # | Company | First invested | Cost basis |
|---|---------|---------------|----------:|
| 1 | PortCo Beta, Inc. | Dec 2017 | $52,405,204 |

---

#### ✅ Executed SPA — B companies

| # | Company | First invested | Cost basis |
|---|---------|---------------|----------:|
| 1 | Greenfield Tech, Inc. | Aug 2021 | $24,515,309 |

---

#### — No SPA needed — W companies

| # | Company | First invested | Cost basis |
|---|---------|---------------|----------:|
| 1 | Example Co., Inc. | Jul 2023 | $1,500,000 |

---

**After all four sections,** add the document library link and flag the two highest-priority gaps:

> [View all SPA documents in Carta](<base_url>/investors/firm/<org_pk>/portfolio/documents/)

• Largest cost-basis position in bucket 1 (missing SPA) — biggest blind spot, no document on file
• Largest cost-basis position in bucket 2 (unexecuted SPA) — most urgent to chase for signature

---

### Step B3: Offer next steps

```python
AskUserQuestion(
    questions=[{
        "question": "What would you like to do next?",
        "header": "Next step",
        "multiSelect": False,
        "options": [
            {"label": "Drill into a company", "description": "See all SPA documents on file for a specific portfolio company."},
            {"label": "Show only gaps", "description": "List companies with missing or unexecuted SPAs only, sorted by cost basis."},
            {"label": "Run co-investor analysis", "description": "Hand off to the carta-co-investors skill — it uses the same SPA data to surface who else invested alongside you in your portfolio companies."},
            {"label": "Done — no further action", "description": "Return to chat."},
        ],
    }]
)
```

If the user picks "Drill into a company," continue with the **Drill-down** section below. If they pick "Show only gaps," re-render Step B2 with only buckets 1 and 2. If they pick "Run co-investor analysis," hand off to `carta-co-investors` (do not re-fetch — the SPA data is already cached at `$WORKSPACE`).

**Suggested next step after presenting the audit.** Always append, in plain text after Step B2 and before the AskUserQuestion: *"To close any coverage gap, upload missing SPAs to your Carta portfolio documents page — uploaded SPAs unlock co-investor analysis and more downstream skills. [View or upload SPA documents in Carta](\<base_url>/investors/firm/\<org_pk>/portfolio/documents/)"*

---

## Drill-down: SPA documents by company

Triggered when the user selects "Drill into a company" or asks to see documents for a named company.

### Step A

If the user hasn't named a company, ask: "Which company would you like to review?"

### Step B

Run this query, replacing `<company_name>` with their input:

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH gen_rec AS (SELECT DOCUMENT_ID, RECORD_TYPE, ATTRIBUTES, CREATED_AT FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement'), spa_docs AS (SELECT c.DOCUMENT_ID, c.ATTRIBUTES:name::STRING AS ISSUER_NAME, c.ATTRIBUTES:executed_by_issuer::BOOLEAN AS EXECUTED_BY_ISSUER, TRY_TO_DATE(e.ATTRIBUTES:closing_dates[0]::STRING) AS CLOSING_DATE, IFF(REGEXP_LIKE(e.ATTRIBUTES:currency_code::STRING, '^[A-Z]{3}$'), e.ATTRIBUTES:currency_code::STRING, NULL) AS CURRENCY_CODE, c.CREATED_AT::DATE AS UPLOAD_DATE FROM gen_rec c LEFT JOIN gen_rec e ON e.DOCUMENT_ID = c.DOCUMENT_ID AND e.RECORD_TYPE = 'stock_purchase' WHERE c.RECORD_TYPE = 'company' AND c.ATTRIBUTES:name::STRING IS NOT NULL), gen_purch AS (SELECT DOCUMENT_ID, ATTRIBUTES:name::STRING AS PURCHASER_NAME, ATTRIBUTES:entity_type::STRING AS ENTITY_TYPE, ATTRIBUTES:share_class_name::STRING AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:price_per_share::NUMBER AS PRICE_PER_SHARE, ATTRIBUTES:total_amount_paid::NUMBER AS TOTAL_AMOUNT_PAID FROM gen_rec WHERE RECORD_TYPE = 'investor') SELECT DENSE_RANK() OVER (ORDER BY sd.DOCUMENT_ID) AS spa_num, sd.UPLOAD_DATE AS upload_date, sd.ISSUER_NAME, gp.PURCHASER_NAME, gp.SHARE_CLASS_NAME, gp.SHARES_PURCHASED, gp.PRICE_PER_SHARE, gp.TOTAL_AMOUNT_PAID, sd.CURRENCY_CODE, sd.CLOSING_DATE AS transaction_date, CASE WHEN sd.EXECUTED_BY_ISSUER = TRUE THEN 'Yes' ELSE 'No' END AS executed FROM spa_docs sd LEFT JOIN gen_purch gp ON gp.DOCUMENT_ID = sd.DOCUMENT_ID AND (gp.ENTITY_TYPE IS NULL OR (gp.ENTITY_TYPE NOT ILIKE '%notice%' AND gp.ENTITY_TYPE NOT ILIKE '%law firm%')) WHERE UPPER(sd.ISSUER_NAME) LIKE UPPER('%<company_name>%') ORDER BY sd.DOCUMENT_ID, gp.PURCHASER_NAME",
  "limit": 100
}})
```

### Step C

Present results in two sub-tables. Both use `SPA #` as the join key so the user can correlate rows.

**Document overview**

| SPA # | Issuer | Transaction date | Upload date | Executed? |
|------:|-------|:----------------:|:-----------:|:---------:|
| 1 | Acme Corp, Inc. | Jan 31, 2022 | Jan 2022 | Yes |

**Purchaser / transaction details**

| SPA # | Purchaser (fund) | Share class | Shares | Price/share | Total amount |
|------:|-----------------|------------|-------:|------------:|-------------:|
| 1 | Sample Fund IV, L.P. | Series C Preferred | 125,000 | 40.00 USD | 5,000,000 USD |

Every amount carries the `CURRENCY_CODE` of its SPA — never assume USD, and never total across SPAs with different codes. When `CURRENCY_CODE` is null the document did not state a currency: render the bare number with a `*` and add the footnote `* currency not stated in the source document`.

**Field notes:**
- **Upload date** — when Carta extracted the document. For SPAs that predate the current extraction pipeline this falls back to a data-refresh date and reads as approximate.
- **Executed?** — Yes/No from document extraction; a specific execution date is not available
- **Currency** — read from the document extraction, per SPA. Null when the document itself stated no currency.

### Step D

```python
AskUserQuestion(
    questions=[{
        "question": "What would you like to do next?",
        "header": "Next step",
        "multiSelect": False,
        "options": [
            {"label": "Back to full audit", "description": "Return to the four-bucket portfolio summary. ← recommended"},
            {"label": "Look up another company", "description": "Search SPA documents for a different portfolio company."},
        ],
    }]
)
```

---

## Gates

**AI computation:** No — bucket assignments and cost basis totals come directly from Carta data via deterministic SQL. No AI-derived values are presented as facts.

---

## Best effort

- **Authoritative (from Carta):** bucket assignments, cost basis, first invested date, SPA document counts, execution status
- **Computed (by Claude):** fuzzy match groupings — if an investment name and SPA issuer name are joined via Jaro-Winkler similarity score < 100, that match is Claude's inference, not a system-recorded link. These rows are labeled with `*` in results.
- **Surfaced as FYI, not in a bucket:** orphaned SPAs (SPA documents uploaded under an issuer name with no fuzzy-match to any equity investment record) are counted via Query O and shown as an FYI pill in the page-header subtitle. They do not land in any bucket — the audit pivots on investments, so an SPA without a matching investment has nowhere to go. Typical causes: parent vs. subsidiary entity mismatch, post-investment renames that diverge beyond Jaro-Winkler ≥ 90, or SPAs uploaded for investments not yet booked in Carta.

---

## Error handling

| Symptom | Likely cause | What to tell the user |
|---------|-------------|----------------------|
| `list_contexts` returns no firm | User not authenticated or MCP session dropped | "I couldn't find any Carta data associated with your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative." |
| `firm_id` fails pre-flight UUID check | MCP session returned malformed context | "Could not determine your firm ID. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative." |
| 401 or 403 from any query | Carta session expired | "Your Carta session has expired. Reconnect to the Carta MCP server and try again." |
| Query fails with table-not-found | DWH schema name changed or table not yet provisioned for this firm | Call `dwh:list:tables` to confirm available table names, then retry with the correct name. |
| 0 rows from `AGGREGATE_INVESTMENTS` | DWH not yet populated for this firm | "No investment data found for your firm. Contact your Carta representative." |
| 0 rows from the unified SPA source | No SPAs uploaded yet, or extractions still processing | All equity companies land in bucket 1 (missing SPA). Include in BLUF: "No SPA documents were found in Carta for your portfolio. Upload SPAs via your Carta portfolio documents page to populate this audit." |
| Drill-down returns 0 rows | Company name didn't match any SPA issuer name | "No SPA found matching '[name]'. Check the spelling or confirm the SPA is uploaded in Carta." |
| Company shows as 'Missing SPA' despite having one on file | Company was renamed after investment — fuzzy match can't bridge historical name changes | "This may be a company rename. Try the drill-down with the old company name to locate the SPA manually." |
| `render-artifact.py` exits non-zero | Bad UUID, non-numeric Carta ID, malformed base URL, unusable connector name, output outside CWD, or a missing template/placeholder | Surface the script's stderr and stop. Never hand-write the artifact HTML. |
| No `Artifact` tool (Step A1 gate) | This session is not Cowork | Go to Mode B. Tell the user "I'll give you the audit as text" — nothing about Cowork, artifacts, or sandboxes. |
| Artifact publishes but renders an error | The page's own bootstrap() hit a required-query failure or found 0 audit rows | That error is the page's own and names its cause. Do not re-run Mode A blind; read what the viewer sees first. |

---

## Caveats

- SPA execution status comes from Carta's document AI extraction. Documents uploaded but not yet processed by Carta won't appear.
- Deduplication is by issuer name: if the same company has multiple SPA uploads, the query takes `MAX(EXECUTED_BY_ISSUER)` — executed wins over unexecuted for the same issuer.
- Only SPAs extracted by the current Document AI pipeline are visible. A document that was extracted before the cutover and never re-extracted makes its company read as "Missing SPA" even though the SPA is uploaded in Carta.
- Amounts are shown in the currency the SPA document states, and are marked when it stated none. Amounts in different currencies are never summed.
- Cost basis is the sum across all funds and asset classes for that issuer — total capital deployed, not current fair market value. It sums `BASE_CURRENCY_TOTAL_COST` for foreign-currency investments and `TOTAL_COST` for the rest, keyed off `IS_FOREIGN_CURRENCY_INVESTMENT`: on a foreign-currency row `TOTAL_COST` is **0** and the amount lives in the base-currency column, so summing `TOTAL_COST` alone silently values those holdings at zero. Do **not** "simplify" this to `COALESCE(BASE_CURRENCY_TOTAL_COST, TOTAL_COST)` — the two base-currency columns differ in null semantics (`BASE_CURRENCY_REMAINING_VALUE` is `0`, not NULL, on domestic rows), so COALESCE collapses SOI valuation. The currency each amount is denominated in follows the same flag, and is carried through so the artifact can render the amount in it rather than labelling the column ambiguously.
- **Renamed companies** may show as "Missing SPA" even when a SPA exists under the old name. If an investment is recorded as "OldName Insurance" but the SPA was uploaded under "NewName Services, Inc." (the former name), the fuzzy match won't link them. Flag these cases with a footnote when they appear in results.
- A company whose SPA documents were uploaded under variant name spellings (e.g. `ACMECORP INC.`, `AcmeCorp Inc.`, `AcmeCorp, Inc.`) will match correctly — the query treats the company as executed if **any** name variant has `EXECUTED_BY_ISSUER = true`.
- If the same company appears as two separate investment records (e.g. "PortCo A, Inc. d/b/a PortCo B" and "PortCo B"), each record is evaluated independently. One may show as executed, the other as missing. This reflects the investment data, not an error.
