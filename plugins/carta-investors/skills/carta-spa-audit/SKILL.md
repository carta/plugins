---
name: carta-spa-audit
description: SPA coverage audit across your portfolio — categorizes every equity investment as missing, unexecuted, executed, or not needed. Use when asked about SPA coverage, missing SPAs, unexecuted SPAs, or document completeness.
version: 0.8.0
model: sonnet
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__list_accounts
  - AskUserQuestion
  - Skill
  - Read
  - Write
  - Bash(carta workspace cache *)
  - Bash(command -v *)
  - Bash(jq *)
  - Bash(tee *)
  - Bash(uv run *)
  - Bash(test -f *)
  - Bash(test -d *)
  - Bash(find *)
  - Bash(date *)
  - Bash(mkdir -p *)
  - Bash(rm -f *)
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
- **`Bash` + `uv` (Mode A only)** — Mode A runs two bundled scripts. **A preview side panel is not a prerequisite.** Where one exists (Claude Desktop) the artifact opens in the panel; everywhere else (Cowork, Claude Code CLI, headless terminal) the identical artifact is written to a file and handed to the user. Only a runtime that cannot execute `uv` at all forces Mode B — and only the Step A0 probe may establish that.

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

**The default output of this skill is the interactive artifact (Mode A). Proceed directly to Mode A Step A0.**

Only route to **text-only (Mode B)** when the user explicitly signals it:
- Says "text only", "no file", "quick summary", "just tell me", or "list missing only" → Mode B
- Asks to drill into a specific named company (any phrasing) → run Mode B Step B0 cache check + drill-down only

Everything else — including any general "audit my SPAs" or "show coverage" request — goes to Mode A.

> **Environment is never a routing reason here.** Do not route to Mode B because you believe this session lacks the scripts, `uv`, a local file system, or a preview panel. That judgement belongs to Step A0's probe, which runs a command and reports facts. Route to Mode A and let A0 decide.

---

## Mode A — Interactive artifact

Generate a self-contained interactive HTML file showing the four-bucket SPA audit. Each portfolio company row is clickable — clicking it opens a right-side drawer with all SPA documents on file for that company, including per-SPA purchaser breakdowns. A sortable main table, a search input, filter pills per bucket, and a contextual "Upload missing SPAs" CTA (when missing > 0) round out the report.

### Step A0: Resolve workspace and locate the toolchain

> **Never pre-judge the environment.** You cannot tell from your tool list, the session type, or a
> `${CLAUDE_PLUGIN_ROOT}` that failed to expand whether Mode A is buildable. Run the probe below
> **before** you say anything about what this session can or cannot do. Until it has run, every one
> of these statements is forbidden — they have all been wrong in production:
>
> - "the interactive artifact needs a local script environment that isn't available in this session"
> - "the scripts for this skill aren't installed here"
> - "this session doesn't have a file system / can't run Python"
> - "I'll deliver the text version instead" (as an environment claim rather than a user request)
>
> The probe searches **both** `.remote-plugins` and `.local-plugins` because both are real install
> locations — marketplace installs land in the first, side-loaded and dev installs in the second.
> Searching only one comes up empty on the other and yields exactly the false "not available here"
> claim above, while `process.py` sits one directory over.

```bash
# --- Workspace ---------------------------------------------------------
# The data file, the HTML artifact, and this probe's own record live here.
# Both the Claude process AND (on Desktop) the preview-panel host must be
# able to read it — on Cowork demo VMs running macOS 26.5+ the host can no
# longer see ~/.cache/... or /tmp/....
if [ -d "${HOME}/mnt/outputs" ] && [ -w "${HOME}/mnt/outputs" ]; then
  WORKSPACE="${HOME}/mnt/outputs/carta-spa-audit"
elif command -v carta >/dev/null 2>&1; then
  WORKSPACE=$(carta workspace cache carta-spa-audit | jq -r .)
else
  WORKSPACE="${TMPDIR:-/tmp}/carta-spa-audit"
fi
mkdir -p "$WORKSPACE"

# --- Candidate plugin roots -------------------------------------------
# Claude Code CLI exports CLAUDE_PLUGIN_ROOT and substitutes it inline.
# Cowork's harness does neither, and bind-mounts plugins under BOTH
# .remote-plugins (marketplace installs) and .local-plugins (side-loaded /
# dev installs). Search every root before concluding anything is missing.
# Positional params, not a space-joined string: zsh does not word-split an
# unquoted variable, so `for r in $ROOTS` would iterate once over the whole
# string and find nothing.
set -- "${CLAUDE_PLUGIN_ROOT:-}" \
       "${HOME}/mnt/.remote-plugins" \
       "${HOME}/mnt/.local-plugins" \
       "${HOME}/.claude/plugins" \
       "${HOME}/.carta/claude-marketplace/plugins"

# --- carta-spa-audit's own install dir (process.py) --------------------
# Match on CONTENT, not name: a directory called carta-spa-audit also exists
# under $WORKSPACE, so a name-only find returns the output dir and every
# later `uv run …/scripts/process.py` fails.
SKILL_DIR=""
for r in "$@"; do
  [ -n "$r" ] && [ -d "$r" ] || continue
  hit=$(find "$r" -maxdepth 6 -type d -name carta-spa-audit -exec test -f {}/scripts/process.py \; -print 2>/dev/null | head -1)
  if [ -n "$hit" ]; then SKILL_DIR="$hit"; break; fi
done

# --- artifact-manager's install dir (generate.py) ----------------------
# Per ADR-003 the HTML generator lives in artifact-manager, not here. Its
# directory name is opaque on Cowork (plugin_<id>/), so identify it by the
# pair of scripts only artifact-manager ships.
AM_ROOT=""
for r in "$@"; do
  [ -n "$r" ] && [ -d "$r" ] || continue
  hit=$(find "$r" -maxdepth 6 -type d -name scripts -exec test -f {}/generate.py \; -exec test -f {}/capabilities.py \; -print 2>/dev/null | head -1)
  if [ -n "$hit" ]; then AM_ROOT=$(dirname "$hit"); break; fi
done

# --- Record the result for later steps --------------------------------
# Env vars do NOT survive across Bash tool calls; this file does.
UV_OK=no; command -v uv >/dev/null 2>&1 && UV_OK=yes
jq -n --arg workspace "$WORKSPACE" --arg skillDir "$SKILL_DIR" \
      --arg amRoot "$AM_ROOT" --arg uv "$UV_OK" \
  '{workspace:$workspace, skillDir:$skillDir, artifactManagerRoot:$amRoot, uv:$uv}' \
  | tee "$WORKSPACE/.toolchain.json"
```

Do not hardcode `/tmp` — it breaks on Windows and is invisible to the Cowork host on macOS 26.5+.

Read the printed JSON and act on it:

| Probe result | Meaning | Do this |
|---|---|---|
| `uv: "yes"`, `skillDir` and `artifactManagerRoot` both non-empty | Full toolchain present | Continue to Step A1. Mode A is buildable — with or without a preview panel. |
| `skillDir` or `artifactManagerRoot` empty | Install path not found in the searched roots | Re-run the probe **once**, widened: `set -- "${HOME}" "${HOME}/mnt"` and `-maxdepth 8` on both finds. Then apply this table again. |
| Still empty after that one re-run, or `uv: "no"` | Toolchain genuinely absent | Go to Mode B and tell the user plainly: *"I'll give you the audit as text."* Say nothing about scripts, plugins, paths, or sandboxes. |

> **One re-run, then stop.** You get exactly **two** probe attempts total. Do not vary the `find`
> expression a third time, do not search additional roots one at a time, do not `ls` around looking
> for the plugin, and do not switch to `Glob`/`Read` to hunt for `process.py`. Two attempts, then
> Mode B.

This step has no user-facing status line — Step 0's announcement already covers the wait.

### Step A1: Fetch SPA data

Every later Bash call starts with this **standard preamble** — it re-resolves `$WORKSPACE` (env vars
do not persist across Bash tool calls) and reads back what Step A0 recorded:

```bash
# --- Standard preamble (paste at the top of every Mode A Bash call) ----
if [ -d "${HOME}/mnt/outputs" ] && [ -w "${HOME}/mnt/outputs" ]; then
  WORKSPACE="${HOME}/mnt/outputs/carta-spa-audit"
elif command -v carta >/dev/null 2>&1; then
  WORKSPACE=$(carta workspace cache carta-spa-audit | jq -r .)
else
  WORKSPACE="${TMPDIR:-/tmp}/carta-spa-audit"
fi
SKILL_DIR=$(jq -r .skillDir "$WORKSPACE/.toolchain.json")
AM_ROOT=$(jq -r .artifactManagerRoot "$WORKSPACE/.toolchain.json")
```


**Fire queries in parallel — issue all `fetch` calls in the SAME assistant turn.** Each is a single high-limit fetch — never paginate. Capture each `saved to …` path and resolve to a readable path via `resolve_blob`.

> **`response_mode: "inline"` is load-bearing on every ndjson fetch — do not remove it.** The server infers the delivery shape from `clientInfo.name`, and that name cannot distinguish the Claude Code CLI (which accepts a binary blob) from other runtimes that share the same name but reject the blob with `-32602 invalid_union`. `inline` forces the always-safe plain-string path for every client.

**Query A — main audit (ndjson):** the same SQL as Mode B Step B1 above, with `"format": "ndjson"` and `"limit": 500`. Returns one row per portfolio company with bucket, cost basis, first invested.

**Query D — per-company drill-down (ndjson):** returns one row per company that has at least one SPA on file, with the full SPA list and purchaser breakdowns nested as a compact JSON string (short keys `num/sc/td/ud/cc/ex/p` for SPAs, `n/t/sh/pp/a` for purchasers). `cc` is the SPA's currency code and is `null` when the document did not state one.

**Query E — fund / geography / SOI valuation enrichment (ndjson):** one row per active portfolio company, with the fund(s) the company belongs to, its geography region tag, and its current SOI valuation (REMAINING_VALUE). Used to power the Fund and Geography multi-select filters and the SOI valuation column in the artifact. Each of the three renders only when it has something to show: the filters need two or more distinct values to be able to narrow anything, and the column needs at least one company with a valuation.

> **Run Query E in the same parallel batch as Queries A and D.** `IS_ACTIVE_INVESTMENT = TRUE` scopes to positions with remaining value — fully-exited companies return no row and will show no funds, `—` for region, and `null` for SOI valuation, which is correct. `FUNDS` is an `ARRAY_AGG`, not a `LISTAGG`: fund names commonly contain a comma (`Acme Ventures Fund I, L.P.`), so a delimited string cannot be split back apart reliably. `REGION_TAG` uses `GET(GET(TAGS_JSON, '  Region'), 0)` — note the two leading spaces in the key name as stored by Snowflake.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "response_mode": "inline",
  "limit": 500,
  "sql": "SELECT ISSUER_NAME AS COMPANY, ARRAY_AGG(DISTINCT FUND_NAME) WITHIN GROUP (ORDER BY FUND_NAME) AS FUNDS, MAX(GET(GET(TAGS_JSON, '  Region'), 0)::STRING) AS REGION_TAG, SUM(REMAINING_VALUE) AS SOI_VALUATION FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' AND IS_ACTIVE_INVESTMENT = TRUE GROUP BY ISSUER_NAME ORDER BY ISSUER_NAME"
}})
```

Capture the `saved to …` path and resolve via `resolve_blob` the same way as Queries A and D. Pass the result as `--enrichment "$QUERY_E_BLOB"` to `process.py` in Step A2.

> **Query E is optional — never let it fail the audit.** If it throws a permission error or table-not-found, pass `--enrichment` omitted; `process.py` will default all companies to `funds=[]`, `regionTag="—"`, `soiValuation=null`, and the artifact drops both filters and the SOI valuation column.

**Query T — live/exited status (ndjson):** one row per equity investment, with `ISSUER_NAME` and `IS_ACTIVE_INVESTMENT`. Produces the `companyStatus` map that powers the Live / Exited filter tabs in the artifact. Fire in the same parallel batch as Queries A, D, and E.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "response_mode": "inline",
  "limit": 50000,
  "sql": "SELECT ISSUER_NAME, IS_ACTIVE_INVESTMENT FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' AND ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') AND ISSUER_NAME IS NOT NULL ORDER BY ISSUER_NAME"
}})
```

Capture the `saved to …` path and resolve via `resolve_blob`. Pass the result as `--status "$QUERY_T_BLOB"` to `process.py` in Step A2.

> **Query T is optional — never let it fail the audit.** If it throws for any reason, omit `--status`; `process.py` will produce no `companyStatus` field and the artifact renders normally without the Live / Exited tabs.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "response_mode": "inline",
  "limit": 500,
  "sql": "WITH gen_rec AS (SELECT DOCUMENT_ID, RECORD_TYPE, ATTRIBUTES, CREATED_AT FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement'), spa_docs AS (SELECT c.DOCUMENT_ID, c.ATTRIBUTES:name::STRING AS ISSUER_NAME, c.ATTRIBUTES:executed_by_issuer::BOOLEAN AS EXECUTED_BY_ISSUER, TRY_TO_DATE(e.ATTRIBUTES:closing_dates[0]::STRING) AS CLOSING_DATE, IFF(REGEXP_LIKE(e.ATTRIBUTES:currency_code::STRING, '^[A-Z]{3}$'), e.ATTRIBUTES:currency_code::STRING, NULL) AS CURRENCY_CODE, c.CREATED_AT::DATE AS UPLOAD_DATE FROM gen_rec c LEFT JOIN gen_rec e ON e.DOCUMENT_ID = c.DOCUMENT_ID AND e.RECORD_TYPE = 'stock_purchase' WHERE c.RECORD_TYPE = 'company' AND c.ATTRIBUTES:name::STRING IS NOT NULL), gen_purch AS (SELECT DOCUMENT_ID, ATTRIBUTES:name::STRING AS PURCHASER_NAME, ATTRIBUTES:entity_type::STRING AS ENTITY_TYPE, ATTRIBUTES:share_class_name::STRING AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:price_per_share::NUMBER AS PRICE_PER_SHARE, ATTRIBUTES:total_amount_paid::NUMBER AS TOTAL_AMOUNT_PAID FROM gen_rec WHERE RECORD_TYPE = 'investor'), purchaser_rows AS (SELECT sd.ISSUER_NAME, DENSE_RANK() OVER (PARTITION BY sd.ISSUER_NAME ORDER BY sd.DOCUMENT_ID) AS spa_num, sd.CLOSING_DATE, sd.CURRENCY_CODE, sd.UPLOAD_DATE AS upload_date, gp.SHARE_CLASS_NAME, gp.PURCHASER_NAME, gp.ENTITY_TYPE, gp.SHARES_PURCHASED, gp.PRICE_PER_SHARE, gp.TOTAL_AMOUNT_PAID, sd.EXECUTED_BY_ISSUER FROM spa_docs sd LEFT JOIN gen_purch gp ON gp.DOCUMENT_ID = sd.DOCUMENT_ID AND (gp.ENTITY_TYPE IS NULL OR (gp.ENTITY_TYPE NOT ILIKE '%notice%' AND gp.ENTITY_TYPE NOT ILIKE '%law firm%'))), per_spa AS (SELECT ISSUER_NAME, spa_num, ANY_VALUE(CLOSING_DATE) AS transaction_date, ANY_VALUE(upload_date) AS upload_date, ANY_VALUE(CURRENCY_CODE) AS currency_code, ANY_VALUE(SHARE_CLASS_NAME) AS share_class, MAX(CASE WHEN EXECUTED_BY_ISSUER = TRUE THEN 1 ELSE 0 END) = 1 AS executed, ARRAY_AGG(OBJECT_CONSTRUCT('n', PURCHASER_NAME, 't', ENTITY_TYPE, 'sh', SHARES_PURCHASED, 'pp', PRICE_PER_SHARE, 'a', TOTAL_AMOUNT_PAID)) WITHIN GROUP (ORDER BY SHARES_PURCHASED DESC NULLS LAST) AS purchasers FROM purchaser_rows GROUP BY ISSUER_NAME, spa_num) SELECT ISSUER_NAME, TO_JSON(ARRAY_AGG(OBJECT_CONSTRUCT('num', spa_num, 'sc', share_class, 'td', transaction_date, 'ud', upload_date, 'cc', currency_code, 'ex', executed, 'p', purchasers)) WITHIN GROUP (ORDER BY spa_num)) AS SPAS_JSON FROM per_spa GROUP BY ISSUER_NAME ORDER BY ISSUER_NAME"
}})
```

Also run the two coverage scalar queries (markdown format is fine, no blob needed) in parallel — same SQL as Mode B Step B1.

**Query P — pending extraction count:** counts SPA documents uploaded to Carta but not yet visible in the fund-admin data share (either Document AI hasn't started — `extracted_at IS NULL` — or extraction is done but enrichment hasn't completed — `enriched_at IS NULL`). Surfaced in the artifact as an FYI pill in the page-header subtitle (NOT a bucket tile) — pending docs can't be attributed to specific portfolio companies until extraction completes, so a tile would imply a precision we don't have. The pill lets customers see "X documents are processing" without claiming any company-level impact.

> **Cross-database query.** This query targets `PROD_DOCUMENT_AI_DB.DOCUMENT_AI.documents_metadata` — a separate database from `FUND_ADMIN`. The fund-admin data share's base models intentionally filter out un-extracted docs at the source layer (`WHERE extracted_at IS NOT NULL AND enriched_at IS NOT NULL`), so the raw `documents_metadata` table is the only path to count pending docs. The MCP gateway permits this cross-database read from a fund-admin context (verified Jun 2026 against a sandbox firm with production-shaped SPA data — 40 pending SPA docs surfaced).
>
> **Schema reference (verified):** `documents_metadata` columns include `document_id`, `document_type` (text — SPA value is the literal string `'Stock Purchase Agreement (SPA)'`), `owner_id` (= firm UUID), `owner_type` (must equal `'firm'`), `extracted_at` (timestamp, NULL when Document AI hasn't started), `enriched_at` (timestamp, NULL when extraction done but enrichment incomplete).

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT COUNT(DISTINCT document_id) AS pending_extraction_docs FROM PROD_DOCUMENT_AI_DB.DOCUMENT_AI.documents_metadata WHERE owner_id = '<firm_id>' AND owner_type = 'firm' AND document_type = 'Stock Purchase Agreement (SPA)' AND (extracted_at IS NULL OR enriched_at IS NULL)"
}})
```

Pass the result as `--pending-extraction-docs <query_p_count>` to `process.py` in Step A2.

> **Query P is optional — never let it fail the audit.** The cross-database read into
> `PROD_DOCUMENT_AI_DB.DOCUMENT_AI.documents_metadata` requires a grant that not every firm
> context has. If this query throws (`DataWarehouseError`, permission denied, or the cross-DB
> object is not visible), **do not retry it and do not error the report** — the pending pill
> is purely informational. Silently drop it: pass `--pending-extraction-docs 0` and continue
> assembling the audit from the main + coverage queries, which live entirely in `FUND_ADMIN`.

**Query O — orphaned-SPA count:** counts distinct SPA issuer names with no fuzzy-match (Jaro-Winkler ≥ 90) to any investment in `AGGREGATE_INVESTMENTS`. Surfaced as a second FYI pill in the page-header subtitle when `> 0`. These are SPAs uploaded to Carta whose issuer name couldn't be linked to a portfolio company — typically name-divergence cases (e.g. SPA filed under "Acme Holdings Inc." vs. investment recorded as "Acme", parent vs. subsidiary entities, or a company renamed since investment). They don't land in any bucket — the audit pivots on investments, so an SPA without an investment record has nowhere to go.

> **SQL note — anti-join pattern, not `NOT EXISTS`.** Snowflake cannot evaluate a correlated `NOT EXISTS` subquery whose `WHERE` clause references a UDF (`JAROWINKLER_SIMILARITY` here): the planner rejects it with `SQL compilation error: Unsupported subquery type cannot be evaluated`. The query below sidesteps the limitation by materializing the matched set in a `matched` CTE and then doing a `LEFT JOIN ... WHERE m.ISSUER_NAME IS NULL` anti-join. Functionally equivalent, executes cleanly.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH norm_spa AS (SELECT ISSUER_NAME, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), ',? *(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L[.]P[.]|LP|PBC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]? *$', '')), '[,.]', '')) AS name_norm FROM (SELECT ATTRIBUTES:name::STRING AS ISSUER_NAME FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement' AND RECORD_TYPE = 'company' AND ATTRIBUTES:name::STRING IS NOT NULL) GROUP BY ISSUER_NAME), norm_inv AS (SELECT TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), ',? *(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L[.]P[.]|LP|PBC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]? *$', '')), '[,.]', '')) AS name_norm FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' GROUP BY ISSUER_NAME), matched AS (SELECT DISTINCT s.ISSUER_NAME FROM norm_spa s JOIN norm_inv i ON JAROWINKLER_SIMILARITY(s.name_norm, i.name_norm) >= 90) SELECT COUNT(DISTINCT ns.ISSUER_NAME) AS orphaned_spas, ARRAY_AGG(DISTINCT ns.ISSUER_NAME) WITHIN GROUP (ORDER BY ns.ISSUER_NAME) AS orphaned_spa_names FROM norm_spa ns LEFT JOIN matched m ON ns.ISSUER_NAME = m.ISSUER_NAME WHERE m.ISSUER_NAME IS NULL"
}})
```

Pass the count as `--orphaned-spas <query_o_count>` and the names array (JSON-serialized) as `--orphaned-spa-names '<query_o_names_json>'` to `process.py` in Step A2.

> **Query O is optional — never let it fail the audit.** Like Query P, this is an FYI-only
> count. If it throws for any reason (`DataWarehouseError`, missing Document AI data), **do not
> retry it and do not error the report** — silently drop the orphaned pill: pass
> `--orphaned-spas 0` and continue. The main audit and coverage queries stand on their own.

Resolve the saved paths in one Bash call — define `resolve_blob` in the same call that uses it, since
a shell function does not survive to the next Bash tool call any more than an env var does:

```bash
# --- Blob path resolver ----------------------------------------------
# dwh:execute:query with response_mode="inline" returns the body as a plain
# string. When that string is too large for the client's context window, the
# client harness writes the whole tool result to disk and reports the path as
# "Output has been saved to <ABSOLUTE_PATH>". resolve_blob translates that to
# a path THIS shell can read (directly on Claude Code CLI; via the
# bind-mounted sandbox path on Cowork).
resolve_blob() {
  saved="$1"
  if [ -r "$saved" ]; then echo "$saved"; return 0; fi
  hit=$(find "${HOME}/mnt/.claude/projects" -name "$(basename "$saved")" 2>/dev/null | head -1)
  if [ -n "$hit" ] && [ -r "$hit" ]; then echo "$hit"; return 0; fi
  return 1
}

QUERY_A_BLOB=$(resolve_blob "<query_a_saved_path>")
QUERY_D_BLOB=$(resolve_blob "<query_d_saved_path>")
QUERY_E_BLOB=$(resolve_blob "<query_e_saved_path>")  # empty string if Query E was skipped
QUERY_T_BLOB=$(resolve_blob "<query_t_saved_path>")  # empty string if Query T was skipped
```

If `resolve_blob` returns non-zero (rare), re-run that one query once and resolve again. Do **not** narrate paths, "blob", or sandbox mechanics to the user. If it still fails:

> "I couldn't load your SPA data just now. Try running the report again in a moment. If it keeps happening, contact your Carta representative."

Tell the user: `SPA data loaded. Assembling report…`

### Step A2: Assemble JSON

Run this in the **same Bash call** as the blob resolution above, prefixed by the standard preamble
from Step A1 — `$QUERY_A_BLOB`, `$SKILL_DIR`, and `$WORKSPACE` are all empty in a fresh shell:

```bash
uv run "$SKILL_DIR/scripts/process.py" \
  --audit       "$QUERY_A_BLOB" \
  --rounds      "$QUERY_D_BLOB" \
  --enrichment  "$QUERY_E_BLOB" \
  --status      "$QUERY_T_BLOB" \
  --firm-id "<firm_id>" \
  --firm-name "<firm_name>" \
  --firm-carta-id <org_pk> \
  --spa-companies <spa_companies> \
  --total-companies <total_companies> \
  --pending-extraction-docs <query_p_count> \
  --orphaned-spas <query_o_count> \
  --orphaned-spa-names '<query_o_names_json>' \
  --out "$WORKSPACE/carta-spa-audit-data.json"
```

> `<query_p_count>` is the result of Query P from Step A1 — the DISTINCT count of pending-extraction SPA docs. Pass `0` if Query P returned nothing **or threw** (it is optional — see the note under Query P).
>
> `<query_o_count>` is the `orphaned_spas` value from Query O. `<query_o_names_json>` is the `orphaned_spa_names` array from Query O, serialized as a JSON string (e.g. `'["Acme Holdings Inc.","Beta Corp"]'`). Pass `0` and `'[]'` if Query O returned nothing **or threw** (it is optional — see the note under Query O).
>
> `$QUERY_T_BLOB` is the resolved path from Query T in Step A1. Pass an empty string (or omit the flag entirely) if Query T threw — `process.py` gracefully disables the Live / Exited filter when `--status` is absent.

The `--audit`, `--rounds`, and `--status` inputs are the resolved blob paths from Step A1, not files the skill wrote. Output (`carta-spa-audit-data.json`) lands in `$WORKSPACE` and doubles as the Mode B cache.

- **Exit 0** — proceed.
- **Non-zero exit** — show the script's stderr output to the user and stop.

### Step A3: Render the artifact

Per ADR-003, all artifact infrastructure (HTML generation, preview server, launch.json, port allocation, panel navigation) lives in `artifact-manager`. carta-spa-audit ships only its own template + styles + manifest under `references/` and delegates the rest.

> **Never hand-write the HTML.** The template (`references/template.html`) is the single source of truth for the artifact's structure, tile labels, filter pills, search, sort handlers, drawer behavior, and the upload-missing-SPAs CTA. Hand-written or model-generated HTML diverges from the Ink design system, omits the canonical Carta watermark, and has produced silent "Could not load data" failures in past sessions.

**Two delivery surfaces, one artifact.** A preview side panel exists only in Claude Desktop. Everywhere else the *same* HTML is written to a file and handed to the user — Cowork opens a returned HTML file on its own, and a browser opens it everywhere else. **A missing panel is not a missing artifact, and it is never a reason to fall back to Mode B.**

Pick the surface once:

- Look through the tools already available to you for anything **ending in** `preview_start` / `preview_list` — a prefixed name (e.g. `mcp__Claude_Browser__preview_start`) is the same capability, not a different one.
- **Found** → Step A3a (panel).
- **Not found** → Step A3b (file). Go there directly; do **not** invoke `render-panel` first — its Step 0 aborts by design in non-Desktop environments, and that abort is not a signal about Mode A.

#### Step A3a: Panel (Claude Desktop)

Define the inputs for `artifact-manager:render-panel`, then invoke it via `Skill`. **Pass literal values** — env vars do not persist across Bash calls.

| Argument | Value |
|---|---|
| `ARTIFACT_YAML` | `<skillDir>/references/artifact.yaml` — the `skillDir` Step A0 resolved (`${CLAUDE_PLUGIN_ROOT}` is unreliable outside Claude Code CLI) |
| `ARTIFACT_NAME` | `carta-investors-spa-audit-<org_pk>` (scope-id = firm `<org_pk>` — one panel per firm) |
| `ARTIFACT_FILENAME` | `<org_pk>_spa_audit.html` |
| `OUT_DIR` | `$WORKSPACE` (the `workspace` Step A0 recorded; pass the literal path) |
| `SUB_FLAGS` | `--substitute "TITLE=<firm_name> — SPA coverage audit"`, `--substitute "BASE_URL=<base_url>"`, and `--substitute-file "DATA=$WORKSPACE/carta-spa-audit-data.json"` |

> **`BASE_URL`** is the environment web URL resolved in Step 1 (`<base_url>`). It is baked into the artifact so the "Upload missing SPAs" / "Open documents" buttons and the footer link point at the right environment. The artifact opens these via the save server's `POST /open-url` — Claude Desktop's preview pane sandboxes the artifact iframe and blocks `<a target="_blank">` navigation to non-localhost URLs, so a plain link does nothing. `artifact.yaml` declares `capabilities: [save]`, which makes `render-panel` spawn `save_server.py` and substitute `{{SAVE_PORT}}`; the `/open-url` endpoint requires **artifact-manager ≥ 0.13.1**. On older artifact-manager the buttons fall back to `window.open()` (which the preview pane blocks — the audit still renders, only the links are inert).

Now invoke `artifact-manager:render-panel` — same-session loading is the contract documented in render-panel's SKILL.md.

`render-panel` handles `launch.json` upsert, preview-server start, save-server spawn (because of `capabilities: [save]`), `{{SAVE_PORT}}` substitution, and panel navigation. It returns the artifact URL when done.

**If render-panel aborts with "Claude Desktop required"** — the surface check above was wrong about this session. Go to Step A3b and deliver the file. Do **not** go to Mode B, and do not tell the user the panel was unavailable.

#### Step A3b: File (Cowork, Claude Code CLI, headless)

Run the same generator `render-panel` runs, with the same substitutions, and write the artifact into `$WORKSPACE`. Start with the standard preamble from Step A1, then:

```bash
# --no-project: artifact-manager ships a pyproject.toml, and without this uv
# tries to create a .venv inside its install dir — which fails on a read-only
# plugin mount.
uv run --no-project --with pyyaml "$AM_ROOT/scripts/generate.py" \
  --config "$SKILL_DIR/references/artifact.yaml" \
  --out-dir "$WORKSPACE" \
  --out-name "<org_pk>_spa_audit.html" \
  --substitute "TITLE=<firm_name> — SPA coverage audit" \
  --substitute "BASE_URL=<base_url>" \
  --substitute-file "DATA=$WORKSPACE/carta-spa-audit-data.json"
```

The result is a single self-contained HTML file — sortable table, search, bucket filter pills, and the click-to-drill-down company drawer all work offline from a browser.

> **`{{SAVE_PORT}}` stays unsubstituted here, and that is correct.** There is no save server without a panel. The template tests the placeholder and routes Carta links through `window.open()` instead — the only difference between the two surfaces. Do not spawn `save_server.py`, do not substitute a port, and do not edit the generated HTML afterwards.

- **Exit 0** — present the file (see below). This is a complete Mode A delivery, not a degraded one.
- **Non-zero exit** — now, and only now, fall back to Mode B Step B2 using the data already in `$WORKSPACE/carta-spa-audit-data.json`.

#### Step A3c: Present the result

State the artifact's absolute path in your reply and hand the file back as the deliverable — Cowork opens a returned HTML file on its own; elsewhere the user opens that path in a browser.

> **No process commentary.** Do not explain which surface you used, that a preview panel was absent, that you "ran the generator directly", or what a save server is. Report the audit, not the plumbing (see "User-facing language — no internals, ever"). The one exception worth stating plainly: on the file surface, "Upload missing SPAs" opens Carta in your browser.

Tell the user:

> "Report ready: **<pct>%** SPA coverage (<spa_companies> of <total_companies> portfolio companies). Gaps to close: <missing> missing · <unexecuted> unexecuted · <pending> pending Document AI scan. Click any company with a Status of 'Executed SPA' or 'SPA not executed' to view the underlying SPA documents."
>
> [View or upload SPA documents in Carta](<base_url>/investors/firm/<org_pk>/portfolio/documents/)

**Suggested next step.** When `<missing> + <unexecuted> > 0`, append: *"To close your coverage gap, upload the missing SPAs at the link above — uploaded SPAs unlock co-investor analysis, round-by-round purchaser breakdowns, and more downstream skills."*

**Cross-skill follow-up.** Always append a one-line suggestion to run [[carta-co-investors]]: *"Want to see who co-invests alongside you in these portfolio companies? Run the `carta-co-investors` skill — it builds an interactive co-investor report from the same SPA data this audit just collected."*

### Step A4: Clean up

Nothing to clean. The ndjson query bodies are blobs the MCP client persists into its own session-scoped `tool-results/` directory (read-only from the sandbox, garbage-collected when the session ends). What the skill writes to `$WORKSPACE` is meant to persist: the assembled `carta-spa-audit-data.json` (which doubles as the Mode B cache), the HTML artifact, and `.toolchain.json` (Step A0's resolved paths — a re-run reuses it instead of searching again).

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

> **CRITICAL — fetch ONCE; never re-issue this query with a different `offset`.** A single fetch with `limit: 500` covers any real portfolio (even Sequoia-scale firms top out around 300 portfolio companies). Do **not** re-run this query for "later pages." Reason: when the model re-types this ~1,500-char SQL for a second call it reliably corrupts a token — the embedded firm UUID drifts (e.g. `…8af6…` → `…8ad6…`), or a JOIN key changes (`d.DOCUMENT_ID` → `s.DOCUMENT_ID`), silently dropping rows or failing the call. One fetch means the SQL is authored exactly once and this whole class of error cannot happen.
>
> **If the row count ever exceeds 500** (it won't for any real firm — flag it as a data anomaly rather than paginating): raise `limit` in the same single call. Never add `offset` pages.

Replace `<firm_id>` with the firm id from Step 1.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_issuers AS (SELECT ATTRIBUTES:name::STRING AS ISSUER_NAME, ATTRIBUTES:executed_by_issuer::BOOLEAN AS EXECUTED_BY_ISSUER FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement' AND RECORD_TYPE = 'company' AND ATTRIBUTES:name::STRING IS NOT NULL), norm_spa AS (SELECT ISSUER_NAME AS spa_name, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), ',? *(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L[.]P[.]|LP|PBC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]? *$', '')), '[,.]', '')) AS name_norm, MAX(CASE WHEN EXECUTED_BY_ISSUER = TRUE THEN 1 ELSE 0 END) AS has_executed_spa FROM spa_issuers GROUP BY ISSUER_NAME), norm_investments AS (SELECT ISSUER_NAME, MAX(CASE WHEN ASSET_CLASS_TYPE = 'PREFERRED_EQUITY' THEN 1 ELSE 0 END) AS has_preferred, MAX(CASE WHEN ASSET_CLASS_TYPE = 'COMMON_EQUITY' THEN 1 ELSE 0 END) AS has_common, MIN(INVESTMENT_DATE) AS first_invested, SUM(TOTAL_COST) AS total_cost_basis, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), ',? *(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L[.]P[.]|LP|PBC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]? *$', '')), '[,.]', '')) AS name_norm FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' GROUP BY ISSUER_NAME), fuzzy_matched AS (SELECT i.ISSUER_NAME, i.has_preferred, i.has_common, i.first_invested, i.total_cost_basis, s.spa_name, s.has_executed_spa, ROW_NUMBER() OVER (PARTITION BY i.ISSUER_NAME ORDER BY JAROWINKLER_SIMILARITY(i.name_norm, s.name_norm) DESC, s.has_executed_spa DESC) AS rn FROM norm_investments i LEFT JOIN norm_spa s ON JAROWINKLER_SIMILARITY(i.name_norm, s.name_norm) >= 90), best AS (SELECT * FROM fuzzy_matched WHERE rn = 1), labeled AS (SELECT CASE WHEN has_preferred = 0 AND has_common = 0 THEN 4 WHEN spa_name IS NULL THEN 1 WHEN has_executed_spa = 0 THEN 2 ELSE 3 END AS sort_key, CASE WHEN has_preferred = 0 AND has_common = 0 THEN '4. No SPA needed' WHEN spa_name IS NULL THEN '1. Missing SPA' WHEN has_executed_spa = 0 THEN '2. SPA not executed' ELSE '3. Executed SPA' END AS spa_bucket, ISSUER_NAME AS company, spa_name, first_invested, total_cost_basis FROM best) SELECT spa_bucket, company, spa_name, first_invested, total_cost_basis FROM labeled ORDER BY sort_key, total_cost_basis DESC NULLS LAST, company",
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

---

## Caveats

- SPA execution status comes from Carta's document AI extraction. Documents uploaded but not yet processed by Carta won't appear.
- Deduplication is by issuer name: if the same company has multiple SPA uploads, the query takes `MAX(EXECUTED_BY_ISSUER)` — executed wins over unexecuted for the same issuer.
- Only SPAs extracted by the current Document AI pipeline are visible. A document that was extracted before the cutover and never re-extracted makes its company read as "Missing SPA" even though the SPA is uploaded in Carta.
- Amounts are shown in the currency the SPA document states, and are marked when it stated none. Amounts in different currencies are never summed.
- Cost basis is `SUM(TOTAL_COST)` across all funds and asset classes for that issuer — total capital deployed, not current fair market value.
- **Renamed companies** may show as "Missing SPA" even when a SPA exists under the old name. If an investment is recorded as "OldName Insurance" but the SPA was uploaded under "NewName Services, Inc." (the former name), the fuzzy match won't link them. Flag these cases with a footnote when they appear in results.
- A company whose SPA documents were uploaded under variant name spellings (e.g. `ACMECORP INC.`, `AcmeCorp Inc.`, `AcmeCorp, Inc.`) will match correctly — the query treats the company as executed if **any** name variant has `EXECUTED_BY_ISSUER = true`.
- If the same company appears as two separate investment records (e.g. "PortCo A, Inc. d/b/a PortCo B" and "PortCo B"), each record is evaluated independently. One may show as executed, the other as missing. This reflects the investment data, not an error.
