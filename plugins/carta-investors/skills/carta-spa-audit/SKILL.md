---
name: carta-spa-audit
description: >-
  SPA (stock purchase agreement) coverage audit across your portfolio — categorizes every equity investment as missing, unexecuted, executed, or not needed, and can drill into a specific company's SPA documents. Use for any question about which investments are missing an SPA or an executed or signed SPA ("Which of our investments are missing an executed SPA?", "what's our SPA status?"), SPA coverage, document completeness, or a named company's SPA — even when the same request also asks for another skill, such as co-investors: run both. Not for general portfolio metrics; for who else invested alongside you, use carta-co-investors.
version: 0.9.8
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
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-spa-audit/scripts/render-artifact.py" *)
  - Bash(pwd)
  - Bash(carta workspace cache *)
  - Bash(command -v *)
  - Bash(test -d *)
  - Bash(date *)
  - Bash(mkdir -p *)
  - Read
  - Write(~/mnt/outputs/carta-spa-audit/**)
  - Write(~/.carta/cache/carta-spa-audit/**)
  - Write(./carta-spa-audit/**)
  # Interaction
  - AskUserQuestion
  - ToolSearch
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.53.4</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) record `skill_failed` as Error handling describes, and stop. Don't search the disk for them.

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
- **Currency (standard):** `$123,456`. Negative: `($445,443)`. Cost basis follows its own rule in Step B2 — it carries each company's currency code, never a `$`.
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

---

## Prerequisites

- **Carta MCP connection** — `list_contexts` and `read_tool` tools available; user has an active session for at least one investment firm.
- **SPA documents uploaded** — the firm has Stock Purchase Agreements in Carta's Document Intelligence; without them, all equity companies land in bucket 1 (missing SPA).
- **Mode A needs the `Artifact` tool**; without it, Mode B gives a full text answer, not a degraded one.

## Accessibility

The Mode B text path is fully accessible in any text environment — all output is plain Markdown tables.

The Mode A interactive HTML artifact has **not yet been formally audited for WCAG 2.1 AA compliance.** Known considerations:

- Color-only encoding is avoided: every bucket badge and tile pairs its accent color with a text label.
- The drawer close button is a real `<button>` with an SVG icon and `aria-label`.
- The Escape key closes the drawer.
- Tables use proper `<thead>` / `<tbody>` semantics; sort headers expose `aria-sort` state.
- Search input has an `aria-label`.

Users who need a WCAG-compliant text view can ask for text ("text only", "no file", "quick summary"), which Step 2 routes to Mode B.

---

## When to use

- "Run SPA audit"
- "Show me SPA coverage across my portfolio"
- "Which companies are missing SPAs?"
- "Which portfolio companies have executed SPAs?"
- "What's our SPA status?"
- "Do we have SPAs on file for all our equity investments?"
- "Find the SPA for Acme Corp" / "Show me all SPA documents for a specific company" (routes to the drill-down — see Step 2)

---

## SPA data source

Every SPA query below reads one surface: `FUND_ADMIN.DOCUMENT_AI_RECORD`, the generic, document-type-agnostic view. Two VARIANT columns carry the extracted fields: `ATTRIBUTES` (flat, one row per entity) and `RAW_JSON` (the full per-document extraction payload, repeated on every row of that document). `RAW_JSON` can be null; the company's `name` and `executed_by_issuer` are read from it with an `ATTRIBUTES` fallback:

```sql
CASE
  WHEN TYPEOF(RAW_JSON:company:name) = 'OBJECT' AND RAW_JSON:company:name:value::STRING IS NOT NULL
    THEN RAW_JSON:company:name:value::STRING
  WHEN TYPEOF(RAW_JSON:company:name) = 'VARCHAR'
    THEN RAW_JSON:company:name::STRING
  ELSE ATTRIBUTES:name::STRING
END
```

Three gotchas if you touch this:

- **Check `TYPEOF` explicitly rather than `COALESCE`-ing the reads together.** A populated envelope *object* cast straight to the target type returns a stringified JSON blob, not the scalar or the fallback.
- **Cast before the null check** — `:value::TYPE IS NOT NULL`, never the bare `:value IS NOT NULL`. A VARIANT holding a JSON `null` is not SQL `NULL`, so the uncast form treats a missing value as present and never falls through to `ATTRIBUTES`.
- **`BOOLEAN` casts on `RAW_JSON` must go through `TRY_TO_BOOLEAN(...::VARCHAR)`, never a bare `::BOOLEAN`.** Casting a VARIANT envelope object straight to `BOOLEAN` errors the whole query — not just the rows where that branch fires. `executed_by_issuer`'s legacy-scalar branch must also check `TYPEOF(...) = 'BOOLEAN'` specifically, not just "not an object": a bare JSON `null` (no envelope at all) types as `NULL_VALUE`, and treating that as a legacy scalar commits to a `NULL` result instead of falling through to `ATTRIBUTES`.

`name` and `executed_by_issuer` are the only fields migrated so far — the drill-down's transaction date, currency, and purchaser fields still read `ATTRIBUTES` only.

Two rules when writing or editing any of these queries:

1. **Filter on both `DOCUMENT_TYPE = 'stock_purchase_agreement'` and the relevant `RECORD_TYPE`.** The `RECORD_TYPE` labels (`company`, `investor`, `security`, `stock_purchase`) are generic and reused by other document types — an LPA also has `company` and `investor` records. `RECORD_TYPE` alone silently pulls unrelated documents into the audit.
2. **Relate record types by `EXTRACTION_ID`, never `DOCUMENT_ID`.** One uploaded document can hold several extractions — a packet Document AI split into segments can carry two SPAs — and `EXTRACTION_ID` identifies one extracted agreement. Joining the `company`, `investor` and `stock_purchase` rows on `DOCUMENT_ID` pairs one SPA's issuer with another's purchasers. The view serves only each segment's current extraction, so no deduplication is needed.

> **A SPA extracted before this pipeline became the source of record will not appear.** Those documents live only in the older per-type views (`DOCUMENT_AI_SPA_ISSUER` and friends), which this skill no longer reads, and the company will read as "Missing SPA" until it is re-extracted. Do not reintroduce a read of those views to patch an individual gap — the source of record is one surface, and a fix belongs upstream in the extraction backfill.

---

## Step 0: Announce

Open every invocation with:

> "I'll audit SPA coverage across your portfolio — pulling every investment record and SPA document from Carta, then categorizing each company by execution status. Larger portfolios take a moment."

Then proceed immediately to Step 1.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-spa-audit", checkpoint_label="skill_started")` before proceeding. `<SERVER>` is the MCP server name you're using for `list_contexts` in this session.

Each run records each checkpoint at most once, and exactly one of `skill_finished` or `skill_failed`. A step reached again later in the same run (a re-render, a follow-up, a drill-down, a re-publish) does not checkpoint again.

---

## Step 1: Establish firm context

> **Every stop in this step** records `skill_failed` first, as Error handling describes: the run delivered nothing, and a stop that records nothing drops out of the usage stats.

1. Call `list_contexts`. If no context is returned, stop with: "I couldn't find any Carta data associated with your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative."
2. Note the firm `id` — this is your `<firm_id>` for every query below.
3. Note the firm display name — this is your `<firm_name>`.
4. Call `list_accounts` searching for `<firm_name>`. Find the entry with `type: "investment firm"`. Extract the numeric portion of its `id` (e.g. `"organization_pk:2645"` → `2645`) — this is `<org_pk>` for the document library link in Step 3.
5. Resolve `<base_url>` from the current Carta MCP server context — never hardcode an environment URL. For the production MCP server (`mcp.app.carta.com`), `<base_url>` is the Carta production web app URL. For any other server, default to the same production URL.

**Pre-flight check:** confirm that `<firm_id>` is a non-empty UUID string (matches pattern `[a-f0-9-]{36}`). If not, stop with: "Could not determine your firm ID. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative."

Tell the user: `Firm context loaded: <firm_name>. Fetching investment records and SPA documents…`

**Uploads offered in this skill.** Every "drop … into this chat" line in this skill (the artifact, the next-step text, the error-handling rows and the drill-down) follows two rules. Without a Bash tool (claude.ai chat), leave out the drop-in half and keep the Carta link: the upload can't reach the user's files there. Files the user drops or names during this conversation go to `carta-investors:carta-upload-firm-document` for `<firm_name>`, so it does not ask which firm.

---

## Step 2: Route

**The default output of this skill is the interactive artifact (Mode A). Proceed directly to Mode A Step A1.**

> **ALWAYS build the interactive artifact (Mode A). This is not a preference or a default — it is the required output of this skill.** Text is for a session with no `Artifact` tool, a user who asks for it outright, or a drill-down into one named company — never a choice you make from how a general request was phrased.

**A question about the gaps is a request for the audit.** "Which of our investments are missing an executed SPA?", "Which companies are missing SPAs?" and "What's our SPA status?" are all answered by the artifact: its missing and unexecuted tiles are that list, ranked by cost basis. Do not read them as "just list the gaps".

**Do NOT route to Mode B because of the question's wording or the portfolio's size:**

| User signal | What must happen |
|---|---|
| "Which … are missing / unexecuted?", "list the gaps" | Still build Mode A. The artifact's missing and unexecuted buckets are the list. |
| Large portfolio, many entities, many SPAs | Still build Mode A. The page pages its own queries and never routes rows through your context, so size is not a reason for text. |
| Speed / cost concern | Still build Mode A. It costs nothing extra in your context. |

Route to **text-only (Mode B)** only when:
- The user explicitly asks for text: "text only", "no file", "quick summary" or "just tell me".
- The user asks to drill into one specific named company (any phrasing) → Step B0 check only, then the Drill-down section.
- Step A1's first check still finds no `Artifact` tool after loading it.

---

## Mode A — Live Artifact

The artifact shows the firm's four-bucket SPA audit — missing, unexecuted, executed, no SPA needed — ranked by cost basis within each bucket, with every company that has an SPA on file clickable to open a drawer holding the full SPA and purchaser breakdown for that company.

> **The page fetches its own data.** You issue no warehouse queries in Mode A. The rendered HTML calls Carta at runtime through `claude.use("mcp")`, pinning firm context and running the audit, drill-down, enrichment, status, and coverage queries itself. This is why Mode A costs the same for a 400-company firm as for a 12-company one — no rows ever pass through your context.
>
> Consequences worth holding onto:
> - There is no NDJSON blob to resolve, no `process.py`, and no data file to assemble.
> - Do **not** hand-write or edit the artifact HTML, including its paging, even to fix a problem the viewer reports. Every render goes through `render-artifact.py`.
> - Do **not** pre-fetch SPA data "to check it worked". The artifact reports its own errors to the viewer.

### Step A1: Checks before building

Run both checks, and stay quiet about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session publish at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the connector name the page will call.

Both sit in the **plugin's** `references/` directory — `${CLAUDE_PLUGIN_ROOT}/references/`, alongside the other plugin-wide references. They are *not* under this skill's own `references/`. Read them by that exact path; don't search for them.

This skill has its own text answer, so a failed first check does not stop it and its stop message is not shown. If `Artifact` is still missing once that check has tried to load it, go to Mode B and open with one plain sentence: *"The interactive SPA audit needs an up-to-date Claude Code or Cowork with Artifacts turned on for your organization, so here is the audit as text."* Say nothing about checks, modes, or sandboxes.

Store the `name` the connector gate resolves as `<CARTA_MCP_SERVER>`. Step A2 passes it to the render script and Step A3 puts it in the `capabilities.mcp` grant. It is one string; there is nothing to derive and nothing to keep in sync.

### Step A2: Render

Locate the script:

The script is `${CLAUDE_PLUGIN_ROOT}/skills/carta-spa-audit/scripts/render-artifact.py`. Bash reaches that path on every surface, Cowork included, so do not search for it.

Render. Run it on one line, exactly as written below. `allowed-tools` matches the command text, so a shell variable, a different path, or a line break fails the allowlist and the call has to be approved by hand each time:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-spa-audit/scripts/render-artifact.py" "<CWD>/<firm-slug>-spa-audit.html" "<firm-slug>-spa-audit" "<CARTA_MCP_SERVER>" "<firm_id>" "<firm_name>" "<org_pk>" "<base_url>"
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

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-spa-audit", checkpoint_label="skill_finished")` as soon as the publish above has succeeded, before the confirmation below. Mode A has no `data_fetched` checkpoint — the page fetches its own data after your turn ends.

### Step A4: Confirm

> Your SPA coverage audit for **<Firm Name>** is ready: [Open <Firm Name> — SPA coverage audit](<url the publish returned>)

Fill the link with the `url` the publish call returned. The side panel does not always open by itself, and this link is how the user reaches the page when it stays closed, so never say the page is loading or open in the sidebar.

Then a 3–5 bullet summary of what it shows — the four-bucket audit (missing, unexecuted, executed, no SPA needed) ranked by cost basis, a coverage stat contrasting count vs. cost-basis coverage, click any company with an SPA on file to see the document and purchaser breakdown in a drawer, fund and geography filters, live/exited tabs. Keep it brief; the customer can see the artifact. Skip the bullets on re-invocation if you've already shown them.

**Cross-skill follow-up.** Always append a one-line suggestion to run `carta-co-investors`: *"Want to see who co-invests alongside you in these portfolio companies? Run the `carta-co-investors` skill — it builds an interactive co-investor report from the same SPA data this audit just collected."*

> **Numbers live in the artifact, not in your reply.** Do not restate coverage percentages, bucket counts, or company names in chat — you have not seen them. The page queries Carta after your turn ends, so any figure you quote is invented.

---

## Mode B — Audit (text)

Mode B is the four-bucket audit as Markdown tables, in `${CLAUDE_PLUGIN_ROOT}/skills/carta-spa-audit/references/text-audit.md` (this skill's own `references/`; read it by that exact path, do not search for it). When Step 2 routes to text or Step A1 finds no `Artifact` tool, read it and follow Steps B0 to B3 there. When Step 2 routes a named company to the drill-down, run only Step B0's workspace and cache check there, then go to the Drill-down section below; do not fetch or render the audit. This plugin's root is `${CLAUDE_PLUGIN_ROOT}`: wherever that file writes `<plugin_root>`, write this path out in full.

---

## Drill-down: SPA documents by company

When the user picks "Drill into a company" in Step B3, when Step 2 routes a named company here, or when the user asks about one named company's SPA documents after Mode A or Mode B has answered, read `${CLAUDE_PLUGIN_ROOT}/skills/carta-spa-audit/references/drill-down.md` (this skill's own `references/`; read it by that exact path, do not search for it) and follow it. It runs one live query for that company and answers in two tables.

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

> **Checkpoint on every stop before this run has recorded `skill_finished`**, whether or not this table lists it: call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-spa-audit", checkpoint_label="skill_failed", notes="<one-line reason>")` instead of `skill_finished`. `skill_finished` means a report or answer reached the user; a stop that delivered neither is a failure, and counting it as finished makes failed runs look like fast successful ones. Rows that recover and continue (a retry, a fall-through to Mode B, an audit with every company in bucket 1) do not checkpoint.

| Symptom | Likely cause | What to tell the user |
|---------|-------------|----------------------|
| `list_contexts` returns no firm | User not authenticated or MCP session dropped | "I couldn't find any Carta data associated with your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative." |
| `firm_id` fails pre-flight UUID check | MCP session returned malformed context | "Could not determine your firm ID. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative." |
| 401 or 403 from any query | Carta session expired | "Your Carta session has expired. Reconnect to the Carta MCP server and try again." |
| Query fails with table-not-found | DWH schema name changed or table not yet provisioned for this firm | Call `dwh:list:tables` to confirm available table names, then retry with the correct name. |
| 0 rows from `AGGREGATE_INVESTMENTS` | DWH not yet populated for this firm | "No investment data found for your firm. Contact your Carta representative." |
| 0 rows from the unified SPA source | No SPAs uploaded yet, or extractions still processing | All equity companies land in bucket 1 (missing SPA). Include in BLUF: "No SPA documents were found in Carta for your portfolio. Drop your SPAs into this chat, or upload them on your Carta portfolio documents page, to populate this audit." |
| Drill-down returns 0 rows | Company name didn't match any SPA issuer name | "No SPA found matching '[name]'. Check the spelling or confirm the SPA is uploaded in Carta." |
| Company shows as 'Missing SPA' despite having one on file | Company was renamed after investment — fuzzy match can't bridge historical name changes | "This may be a company rename. Try the drill-down with the old company name to locate the SPA manually." |
| `render-artifact.py` exits non-zero | Bad UUID, non-numeric Carta ID, malformed base URL, unusable connector name, output outside CWD, or a missing template/placeholder | Surface the script's stderr and stop. Never hand-write the artifact HTML. |
| No `Artifact` tool, even after Step A1 tried to load it | Artifacts are off or Claude is out of date | Go to Mode B, opening with Step A1's sentence on why the answer is text. |
| Artifact publishes but renders an error | The page's own bootstrap() hit a required-query failure or found 0 audit rows | That error is the page's own and names its cause. Do not re-run Mode A blind; read what the viewer sees first. A "too large" error is not a reason to change the page: it already sizes its own requests and retries smaller ones. Re-run Step A2 and A3 with the script's template unchanged. If the error returns, say the audit couldn't load and stop. |

---

## Caveats

- SPA execution status comes from Carta's document AI extraction. Documents uploaded but not yet processed by Carta won't appear.
- Deduplication is by issuer name: if the same company has multiple SPA uploads, the query takes `MAX(EXECUTED_BY_ISSUER)` — executed wins over unexecuted for the same issuer.
- Only SPAs extracted by the current Document AI pipeline are visible. A document that was extracted before the cutover and never re-extracted makes its company read as "Missing SPA" even though the SPA is uploaded in Carta.
- SPA amounts are shown in the currency the SPA document states, and are marked when it stated none. Cost basis is shown in each holding's own currency. Amounts in different currencies are never summed or ranked against each other.
- Cost basis is the sum across all funds and asset classes for that issuer — total capital deployed, not current fair market value. It sums `BASE_CURRENCY_TOTAL_COST` for foreign-currency investments and `TOTAL_COST` for the rest, keyed off `IS_FOREIGN_CURRENCY_INVESTMENT`: on a foreign-currency row `TOTAL_COST` is often **0** and the amount lives in the base-currency column, so summing `TOTAL_COST` alone silently values those holdings at zero. Do **not** "simplify" this to `COALESCE(BASE_CURRENCY_TOTAL_COST, TOTAL_COST)` — the two base-currency columns differ in null semantics (`BASE_CURRENCY_REMAINING_VALUE` is `0`, not NULL, on domestic rows), so COALESCE collapses SOI valuation. Both `TOTAL_COST` on a domestic row and `BASE_CURRENCY_TOTAL_COST` on a foreign one are in the holding's own `CURRENCY_CODE`, so that column labels the amount on every row. Do **not** label foreign rows with `BASE_CURRENCY_CODE`: it reads `USD` or NULL on some foreign rows whose amount is in IDR, BRL, CAD or EUR, which would show an IDR 28B holding as $28B. A company whose rows span currencies gets `currency_count` > 1 and no single code. Nothing adds or ranks amounts across currencies: Mode B shows each cost basis with its own code; the artifact's value totals count only the companies in the currency most of them share, and both surfaces sort those companies first, then the rest grouped by currency.
- **Renamed companies** may show as "Missing SPA" even when a SPA exists under the old name. If an investment is recorded as "OldName Insurance" but the SPA was uploaded under "NewName Services, Inc." (the former name), the fuzzy match won't link them. Flag these cases with a footnote when they appear in results.
- A company whose SPA documents were uploaded under variant name spellings (e.g. `ACMECORP INC.`, `AcmeCorp Inc.`, `AcmeCorp, Inc.`) will match correctly — the query treats the company as executed if **any** name variant has `EXECUTED_BY_ISSUER = true`.
- If the same company appears as two separate investment records (e.g. "PortCo A, Inc. d/b/a PortCo B" and "PortCo B"), each record is evaluated independently. One may show as executed, the other as missing. This reflects the investment data, not an error.
