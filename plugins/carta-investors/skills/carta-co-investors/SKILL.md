---
name: carta-co-investors
description: >
  Interactive co-investor report from Carta SPA and cap table data with
  clickable portfolio drill-downs. Use for co-investor analysis or asking who invested in a
  specific portfolio company.
  Trigger phrases: "co-investors", "coinvestors", "who are my co-investors",
  "who else invested", "co-investors by stage/round", "co-investors on Aumni".
  Use instead: carta-explore-data for general fund/investment/portfolio data —
  this skill is specifically for co-investor ("who else invested alongside us")
  analysis.
version: 0.8.9
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
  - mcp__carta__set_context
  - mcp__carta__skill_checkpoint
  - mcp__claude_ai_carta__call_tool
  - mcp__claude_ai_carta__read_tool
  - mcp__claude_ai_carta__list_contexts
  - mcp__claude_ai_carta__set_context
  - mcp__claude_ai_carta__skill_checkpoint
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__skill_checkpoint
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__skill_checkpoint
  # Publish
  - Artifact
  # Local execution
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-co-investors/scripts/render-artifact.py" *)
  - Bash(pwd)
  - Read
  - Write
  # Interaction
  - AskUserQuestion
  - ToolSearch
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.121.11</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

<!-- Part of the official Carta AI Agent Plugin -->

# Co-investor analysis

Analyze who co-invests alongside you across your portfolio using Stock Purchase
Agreement (SPA) data uploaded to Carta and the detailed cap tables that portfolio
companies share with you. Supports both interactive visual reports and direct
analytical questions.

---

## Data source

Co-investors come from two sources, merged so that no company and no investor
is counted twice:

| Source | Table | What it gives |
|---|---|---|
| Uploaded SPAs | `FUND_ADMIN.DOCUMENT_AI_RECORD` | Purchasers per round: shares, amount paid, % of round, entity type |
| Detailed cap tables | `FUND_ADMIN.STAKEHOLDER_CAP_TABLE` | Each company's current holders and their fully diluted ownership |

**Cap table source.** One row per stakeholder × security class, latest snapshot
per company (`MAX(AS_OF_DATE)` per `CORPORATION_ID`). It is row-access
controlled: a firm sees a company's rows only where the company granted it
Detailed cap table access, so **0 rows for a company is normal** and means that
company is SPA-only. Columns used: `CORPORATION_ID`, `STAKEHOLDER_ID`,
`STAKEHOLDER_NAME`, `STAKEHOLDER_GROUP_NAME` (always populated; it groups one
investor's related vehicles within a company), `SECURITY_CLASS_TYPE`,
`AS_CONVERTED_SHARCLASS_STOCK_TYPE` (sic), `STAKEHOLDER_FULLY_DILUTED_OWNERSHIP`
(a fraction repeated on each of the holder's rows — aggregate with `MAX`, never
`SUM`).

**Company bridge (exact, no name matching).** `FUND_ADMIN.AGGREGATE_INVESTMENTS`
`ENTITY_LINK_ID` → `FUND_ADMIN.CORPORATION_ENTITY_LINKS_V2` (join on `FIRM_ID` and
`ENTITY_LINK_ID`; take `DISTINCT` rows with `CORPORATION_ID IS NOT NULL`, since the
view repeats per `AS_OF_DATE`) → `STAKEHOLDER_CAP_TABLE.CORPORATION_ID`. The
company's name is the portfolio record's `ISSUER_NAME`, the same name the SPA side
resolves each SPA issuer to, so a company in both sources is one company.
Restricted to equity investments (`PREFERRED_EQUITY`, `COMMON_EQUITY`).

**Merge rules** (the artifact and Mode B apply the same ones):

1. **Investors only from the cap table:** note blocks (SAFEs and notes), and
   preferred share classes and warrants. Common stock and option plans are the
   founders and employees and are dropped. The placeholder holders "Outside
   investors" and "Outside investor" (matched case-insensitively, trimmed, on either
   the stakeholder name or the group name) are dropped too: Carta uses them as a
   bucket for unnamed holders on thousands of cap tables, so they are not an
   investor. They are removed before anything else reads the holders, so a company
   whose only investor holder is the bucket counts as having no investor holders
   (rule 5; no cap table coverage).
2. **Investor identity.** An SPA purchaser is identified by its name. A cap table
   holder is identified, in order, by: a `canonical-investors.json` grouping
   matched on `STAKEHOLDER_NAME`; a grouping matched on `STAKEHOLDER_GROUP_NAME`;
   the group name, only when it is related to the stakeholder name (the two, once
   fund-family words, series numerals and legal suffixes are removed, contain one
   another, with at least 4 characters left); otherwise the stakeholder name
   itself. The group name is often a shared GP or custodian label ("Fund GP") over
   unrelated vehicles, so it is never trusted on its own. The identity is then
   keyed on its compact form: upper-case, diacritics, punctuation, spacing and
   quote style dropped, trailing legal suffix and series numeral removed, so
   "Upper90 Fund" and "Upper 90 Fund" are one investor.
   **Within one company**, an SPA purchaser and a cap table holder whose names
   reduce to the same loose stem (fund-family words, numerals and legal suffixes
   removed, at least 4 characters left: "Mantis Capital Fund I, LP" and "Mantis
   Capital") are one investor, with SPA and cap table evidence at that company and
   no past-investor flag there; that union holds wherever the investor appears.
   Nothing else is matched across companies.
3. **An investor counts once per company**, however many sources name it. Ranking
   is by distinct companies.
4. **The firm's own vehicles are excluded** from cap table holders exactly as from
   SPA purchasers. A name is also a vehicle when the firm's own name appears in it
   as whole words, in any spacing ("F&J Labs Co-Invest", "FJLabs Fund IV"); the
   firm name must have two or more words or at least 6 characters, so a firm
   called "Vela" does not remove every investor with Vela in its name.
5. **Past investors:** a purchaser named on a company's SPA but absent from that
   company's current cap table still counts as a co-investor, when that cap table
   lists at least one investor holder. The company drill-down lists them apart from
   current holders.
6. **Companies without cap table access behave exactly as SPA-only companies.**
7. **Row threshold (artifact only).** A list of fewer than 150 co-investors (after
   the source, individuals and Live/Exited filters) shows every investor, including
   those at one company. From 150 up it shows investors at 2 or more companies, with
   a "Show all N co-investors" button in the filter bar; the footer says what is
   shown and carries the same toggle as a link. Mode B returns
   its own top 50 and has no threshold.
8. **Hide individuals.** An SPA entity type of Individual/person wins. Otherwise a
   name is a person only if it is 2-4 capitalised words with no institution word
   (fund, capital, global, angels, studio, tech, …) and does not match any
   `canonical-investors.json` grouping.

The SPA source reads `FUND_ADMIN.DOCUMENT_AI_RECORD` — one row per
extracted entity or event. Two VARIANT columns carry the type-specific
fields: `ATTRIBUTES` (flat, one row per entity) and `RAW_JSON` (the full
per-document extraction payload, repeated on every row of that document).
`RAW_JSON` can be null; always read it with an `ATTRIBUTES` fallback. Each
query opens with a prelude that pivots the table into the three relations
the analysis needs, so every downstream CTE reads exactly as it would
against named columns:

| Prelude CTE | Filter |
|---|---|
| `spa_issuer` | `RECORD_TYPE = 'company'` |
| `spa_purchaser` | `RECORD_TYPE = 'company'` (flattens `RAW_JSON:purchasers[]`), `ATTRIBUTES`-sourced `RECORD_TYPE = 'investor'` fallback |
| `spa_deal` | `RECORD_TYPE = 'stock_purchase'` |

`spa_rec` also filters `FIRM_ID` even though every query filters it again
downstream. That is deliberate: `firm_id` is the leading column of the table's
clustering key, so pinning it here lets Snowflake prune partitions instead of
scanning every firm's records and discarding them after the join. Measured on a
~460-SPA firm it cut Query S from 3.3 GB scanned to 765 MB and 2.65s to 1.25s.
It is safe because `firm_id` is constant across an extraction's records —
verified: zero extractions carry more than one distinct `firm_id`.

**`RAW_JSON` envelope shape.** Every `RAW_JSON` leaf is a citation envelope
— `{value, text, reasoning, confidence, error, citations[]}` — except on a
minority of legacy-shaped documents where the same field is a bare scalar.
`spa_issuer` and `spa_deal` read it with this pattern:

```sql
CASE
  WHEN TYPEOF(RAW_JSON:path:to:field) = 'OBJECT' AND RAW_JSON:path:to:field:value::TYPE IS NOT NULL
    THEN RAW_JSON:path:to:field:value::TYPE
  WHEN TYPEOF(RAW_JSON:path:to:field) != 'OBJECT' AND RAW_JSON:path:to:field IS NOT NULL
    THEN RAW_JSON:path:to:field::TYPE
  ELSE ATTRIBUTES:field::TYPE
END
```

Two gotchas if you touch this:

- **Check `TYPEOF` explicitly rather than `COALESCE`-ing the three reads
  together.** A populated envelope *object* cast straight to `TYPE` returns
  a stringified JSON blob, not the scalar or the fallback.
- **Cast before the null check** — `:value::TYPE IS NOT NULL`, never the
  bare `:value IS NOT NULL`. A VARIANT holding a JSON `null` is not SQL
  `NULL`, so the uncast form treats a missing value as present and never
  falls through to `ATTRIBUTES`.

`spa_purchaser` reads `RAW_JSON:purchasers[]` via `LATERAL FLATTEN` off the
single `RECORD_TYPE = 'company'` row, never joined directly against
`RECORD_TYPE = 'investor'` rows — `RAW_JSON` is document-level, so every
investor row would otherwise carry the full document payload for no
reason. Its `ATTRIBUTES` fallback leg triggers on
`COALESCE(ARRAY_SIZE(RAW_JSON:purchasers), 0) = 0`, covering both a
missing/empty array and a null `RAW_JSON` in one check.

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
- **Currency:** amounts carry their row's currency code or symbol, with commas and no cents (`€1,000,000`, `CA$250,000`). Use a bare number when the currency is unknown, never `$` by default. Negatives in parentheses: `(€445,443)`.
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
Example: `Investor data loaded across 23 companies. Building your report…`

Never go silent for more than one step. Never present results without a prior status line.

> **User-facing language — no internals, ever.** The user is a fund manager,
> not an engineer. Status lines, summaries, and error messages must use plain
> investor vocabulary only. **Never** expose any of the following to the user —
> not in a status line, a summary, an error, or an aside: query names
> (“Query S”, “Query R”), SQL, pagination/pages/offsets, `total_rows`, row or
> byte counts, blob/file paths, “Snowflake”/“DWH”/“ndjson”, latency or timing
> breakdowns, retries, UUIDs, or exit codes. Talk about *companies*,
> *co-investors*, *rounds*, *cap tables*, and *coverage* — never the machinery that
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

- **Carta MCP connection** — `list_contexts`, `read_tool` and `call_tool` available; the user has an active session for at least one investment firm.
- **SPA documents uploaded or detailed cap table access** — the firm has Stock Purchase Agreements in Carta's Document Intelligence, or portfolio companies that granted it Detailed cap table access. With neither, the artifact renders a "nothing found" state rather than an empty table. A firm with only one of the two gets a report from that source alone.
- **Mode A needs the `Artifact` tool**; without it, Mode B gives a full text answer, not a degraded one.
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

> "I'll pull together who co-invests alongside you across your portfolio, using the SPAs uploaded to Carta and the detailed cap tables your portfolio companies share. Fund vehicles are normalized so each firm counts once."

Then proceed immediately to Step 1.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_started")` before proceeding. Use the same MCP server name (`carta` or `claude_ai_carta`) you're using for `list_contexts` in this session.

---

## Step 1: Establish firm context

1. Call `list_contexts` to get the firm UUID and display name. If nothing is returned → stop with: "I couldn't find any Carta data associated with your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative."
2. Call `read_tool({"name": "fa__list__entities", "arguments": {"entity_types": "fund"}})` and read `<firm_carta_id>` — the integer PK used in Carta web URLs — from any entity in the response. This call is only for that id; the firm's own vehicles are read from the warehouse (Mode A's page and Mode B's queries both do it), so do not list every entity type here.
   - **Never call it without `entity_types`.** An unfiltered list for a firm with many funds and SPVs is larger than the response limit, and the call fails with "response too large".
   - If the `fund` call comes back "response too large" or with no entities (an SPV-only firm), call once more with `{"entity_types": "management_co"}` and take `<firm_carta_id>` from that. That is the only retry: no `search=` probing, no other type lists, no repeat of either call.
3. Store `<firm_id>` (the UUID), `<firm_name>` (display name), and `<firm_carta_id>`.
4. Resolve `<base_url>` from the current Carta MCP server URL — **never hardcode an environment URL**, or a sandbox firm deep-links into production. The production MCP server (`mcp.app.carta.com`) maps to the Carta production web app; a sandbox server maps to the matching sandbox web app. It must be a plain `https://` origin with no path — the render script rejects anything else.

**Pre-flight check:** confirm `<firm_id>` is a non-empty UUID string (matches `[a-f0-9-]{36}`). If not, stop with: "Could not determine your firm ID. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative."

---

## Step 2: Route

**The default output is the interactive artifact. Proceed to Step A1.**

Route to **text analysis (Mode B)** when the user explicitly signals text, or asks a question a table answers better than a report:

- "text only", "no file", "just tell me", "quick summary" → Q1
- A specific company by name → Q4 and Q4b
- ">5%", "over 5%", "lead", "leads" → Q2
- "<5%", "less than 5%", "under 5%", "follow-on" → Q3

Route to Mode B when Step A1's first check still finds no `Artifact` tool after loading it.

---

## Mode A — Live Artifact

The artifact shows the firm's most frequent co-investors, drawn from SPAs and detailed cap tables, with every portfolio company clickable to open a drawer holding the investor breakdown for that company: current holders and their fully diluted ownership where a cap table is shared, then each round's investors, % of round and amount paid. A source filter narrows the list to SPAs or cap tables, a toggle hides individual investors, and a list of 150 or more investors shows only those at 2+ companies until the viewer asks for all.

> **The page fetches its own data.** You issue no warehouse queries in Mode A. The rendered HTML calls Carta at runtime through `claude.use("mcp")`, pinning firm context and running the co-investor, rounds, status, firm-vehicle, and cap table queries itself. This is why Mode A costs the same for a 400-company firm as for a 12-company one — no rows ever pass through your context.
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

This skill has its own text answer, so a failed first check does not stop it and its stop message is not shown. If `Artifact` is still missing once that check has tried to load it, go to Mode B and open with one plain sentence: *"The interactive co-investor report needs an up-to-date Claude Code or Cowork with Artifacts turned on for your organization, so here is the analysis as text."* Say nothing about checks, modes, or sandboxes.

Store the `name` the connector gate resolves as `<CARTA_MCP_SERVER>`. Step A2 passes it to the render script and Step A3 puts it in the `capabilities.mcp` grant. It is one string; there is nothing to derive and nothing to keep in sync.

### Step A2: Render

**2a.** Locate the script:

The script is `${CLAUDE_PLUGIN_ROOT}/skills/carta-co-investors/scripts/render-artifact.py`. Bash reaches that path on every surface, Cowork included, so do not search for it.

**2b.** Render. Run it on one line, exactly as written below. `allowed-tools` matches the command text, so a shell variable, a different path, or a line break fails the allowlist and the call has to be approved by hand each time:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-co-investors/scripts/render-artifact.py" "<CWD>/<firm-slug>-co-investors.html" "<firm-slug>-co-investors" "<CARTA_MCP_SERVER>" "<firm_id>" "<firm_name>" "<firm_carta_id>" "<base_url>"
```

Positional arguments:

1. **Output path** — must be **absolute** and under the session's current working directory (`<CWD>`). Use `pwd` to resolve `<CWD>` if needed.
2. **Artifact ID** — the kebab-case slug naming this artifact. Must equal `<firm-slug>-co-investors`.
3. **Carta connector display name** — `<CARTA_MCP_SERVER>` from Step A1.
4. **Firm UUID** — from Step 1. The artifact calls `set_context` with this on every load, so the queries succeed even if the user switched contexts elsewhere.
5. **Firm name** — the human-readable name. The page also treats it as one of the firm's own vehicles.
6. **Firm Carta ID** — the numeric organization pk, for the documents deep link.
7. **Base URL** — `<base_url>` from Step 1.

On success the script prints one stdout line: the absolute output path. It exits non-zero on any validation failure (bad UUID, non-numeric Carta ID, base URL with a path or a non-https scheme, unusable connector name, output path outside CWD, missing template or placeholders). If it fails, surface the error and stop — do not fall back to hand-writing HTML.

**Slugification rules** (apply to the **firm name**, not any UUID):

1. Lowercase
2. Replace whitespace with hyphens
3. Strip non-alphanumeric characters except hyphens
4. Collapse consecutive hyphens
5. Trim leading and trailing hyphens

Example: `"Acme Capital Partners, L.P."` → slug `"acme-capital-partners-lp"` → output `acme-capital-partners-lp-co-investors.html`, artifact id `acme-capital-partners-lp-co-investors`.

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

Then a 3–5 bullet summary of what it shows — most frequent co-investors ranked by shared portfolio companies, fund vehicles normalized so each firm counts once, click any company to see its current holders (where a cap table is shared) and the round-by-round investor breakdown, filter by live or exited positions or by source (SPAs or cap tables), hide individual investors, and see how many companies each source covers. Keep it brief; the customer can see the artifact. Skip the bullets on re-invocation if you've already shown them.

**Cross-skill follow-up.** When coverage is visibly incomplete, append: *"Coverage here is only as complete as the SPAs on file and the cap tables shared with you — run the `carta-spa-audit` skill to see which portfolio companies are missing an SPA."*

> **Numbers live in the artifact, not in your reply.** Do not restate co-investor counts, coverage percentages, or company names in chat — you have not seen them. The page queries Carta after your turn ends, so any figure you quote is invented.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_finished")` once the publish in Step A3 has succeeded. Mode A has no `data_fetched` checkpoint — the page fetches its own data after your turn ends.

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
- Company name mentioned → Q4 and Q4b (company-specific)
- ">5%" or "lead" mentioned → Q2 (frequent leads)
- "<5%" or "less than" mentioned → Q3 (frequent below-threshold)
- Otherwise → **Q1 (most frequent overall)**

Only ask a clarifying question if the request is genuinely ambiguous (e.g. a
company name that could match multiple issuers).

### Step B2: Fetch data

Use `read_tool({"name": "dwh__execute__query", "arguments": {...}})` with the appropriate query below.

> **SPA deduplication:** all queries open with `doc_metadata` + `dedup_docs` CTEs
> that select `MAX(EXTRACTION_ID)` per `(ISSUER_NAME, COALESCE(CLOSING_DATE, SHARE_CLASS_NAME, 'undated'))`.
> This deduplicates duplicate uploads while preserving genuine multiple rounds.
> In Q1–Q3, `ISSUER_NAME` there is already one name per company: the `company`
> CTE folds spellings that differ only in case, punctuation or a legal suffix
> ("BookNook, Inc." and "BOOKNOOK INC.") with the same normalization the
> artifact uses, so a company counts once.

**Standard exclusion filters (add to every WHERE clause):**

```sql
AND p.PURCHASER_NAME NOT ILIKE '%<firm_name>%'
AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%'
AND p.ENTITY_TYPE NOT ILIKE '%notice%'
AND p.ENTITY_TYPE NOT ILIKE '%law firm%'
AND p.PURCHASER_NAME NOT IN (SELECT PURCHASER_NAME FROM own_purchaser)
```

The `own_purchaser` clause drops the firm's own funds, SPVs, GPs and management companies, which are often named nothing like the firm ("Vela I, LP" for Acme Ventures). Its `firm_vehicle` and `own_purchaser` CTEs apply the artifact's `matchesFirmVehicle` rule: names compared upper-cased with periods and commas dropped and hyphens closed up, a match on the whole name or on whole leading words, and a match on the name without its legal suffix and series numeral when that still has two words. A bare substring match would both miss "Acme Fund VI LP" for the vehicle "Acme Fund VI, L.P." and drop "Andreessen Horowitz Fund IX" for a vehicle named "Fund IX". The Q1–Q3 SQL below includes it; Q4 leaves it out on purpose, because its breakdown marks the firm's own row as **(You)**.

Q1–Q3 also group co-investors on that same normalized name with its legal suffix and series numeral removed and then compacted to letters and digits (the artifact's `investorKey`), so "Northwind Capital II, LP", "NORTHWIND CAPITAL II, L.P.", "Northwind Capital IV LP" and "NorthwindCapital" are one row; the row shows a mixed-case spelling. **Mode B applies the compact key only:** the artifact's extra step, uniting an SPA purchaser and a cap table holder of one company on their loose stem ("Mantis Capital Fund I, LP" with "Mantis Capital"), is not in the SQL, so Mode B can list such a pair as two investors and flag a past investor the artifact would not. Mode B also keeps diacritics out of the key by dropping them rather than folding them. Q1's `cap_canon`/`cap_identity` CTEs resolve each cap table holder with the artifact's holder identity order (the first `<CANONICAL_CASE>` in Q1 belongs to `cap_canon`). For the firm's own name, Mode B excludes any name that contains it by `ILIKE` or by compact substring (`<firm_name_compact>`: the firm name's upper-case letters and digits without its legal suffix; leave the compact clauses out when that has one word and fewer than 6 characters), which is broader than the artifact's whole-word rule. Q1's SPA leg groups SPA issuers by their exact `ISSUER_KEY` and never maps them to a portfolio company, so Q1 can count an unmatched SPA issuer, or two spellings of one portfolio company, that QC and the artifact do not. Their `name_pool` CTE is the set of names the firm-vehicle rule tests: in Q1 it also holds the cap table holders' names, in Q2 and Q3 only SPA purchasers.

For `<firm_name_spaced>`: insert a space before any digit sequence that follows
a letter (e.g. "Capital99" → "Capital 99").

> If a query fails with a table-not-found error: call `read_tool({"name": "dwh__list__tables", "arguments": {}})`
> to confirm available table names, then retry with the correct names.

#### Q1 — Most frequent overall

Mode A's Query S in shape, with cap table holders added: `cap_holder` is each company's current investor holders under the portfolio record's name, `cap_identity` resolves each to an investor in merge rule 2's order, and `purchaser_canonical` unions them with the SPA purchasers so an investor counts once per company across both sources. A cap table company that an SPA names with another spelling takes the SPA's spelling (`spa_label`), so a cap table company and the SPA issuer QC matches to it are one company in Q1. Q1's SPA leg still groups SPA issuers by their exact `ISSUER_KEY`, so it can count an unmatched SPA issuer, or two spellings of one portfolio company, that QC does not. `<CANONICAL_CASE>` appears three times: once per leg and once in `cap_canon`. **Run Step B0 first** to assemble
`<CANONICAL_CASE>`. The result schema (`CANONICAL_NAME`, `ENTITY_TYPE`,
`COMPANY_COUNT`, `COMPANIES`, `RAW_NAMES`) maps directly to the Q1 output
table below.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, CASE WHEN TYPEOF(RAW_JSON:company:name) = 'OBJECT' AND RAW_JSON:company:name:value::VARCHAR IS NOT NULL THEN RAW_JSON:company:name:value::VARCHAR WHEN TYPEOF(RAW_JSON:company:name) != 'OBJECT' AND RAW_JSON:company:name IS NOT NULL THEN RAW_JSON:company:name::VARCHAR ELSE ATTRIBUTES:name::VARCHAR END AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT r.EXTRACTION_ID, CASE WHEN TYPEOF(f.VALUE:name) = 'OBJECT' THEN f.VALUE:name:value::VARCHAR ELSE f.VALUE:name::VARCHAR END AS PURCHASER_NAME, CASE WHEN TYPEOF(f.VALUE:entity_type) = 'OBJECT' THEN f.VALUE:entity_type:value::VARCHAR ELSE f.VALUE:entity_type::VARCHAR END AS ENTITY_TYPE, CASE WHEN TYPEOF(f.VALUE:share_class_name) = 'OBJECT' THEN f.VALUE:share_class_name:value::VARCHAR ELSE f.VALUE:share_class_name::VARCHAR END AS SHARE_CLASS_NAME, CASE WHEN TYPEOF(f.VALUE:shares_purchased_by_cash) = 'OBJECT' THEN f.VALUE:shares_purchased_by_cash:value::NUMBER ELSE f.VALUE:shares_purchased_by_cash::NUMBER END AS SHARES_PURCHASED, CASE WHEN TYPEOF(f.VALUE:total_amount_paid) = 'OBJECT' THEN f.VALUE:total_amount_paid:value::NUMBER(38,2) ELSE f.VALUE:total_amount_paid::NUMBER(38,2) END AS TOTAL_AMOUNT_PAID FROM spa_rec r, LATERAL FLATTEN(input => r.RAW_JSON:purchasers) f WHERE r.RECORD_TYPE = 'company' AND r.RAW_JSON IS NOT NULL AND ARRAY_SIZE(r.RAW_JSON:purchasers) > 0 UNION ALL SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR, ATTRIBUTES:entity_type::VARCHAR, ATTRIBUTES:share_class_name::VARCHAR, ATTRIBUTES:shares_purchased_by_cash::NUMBER, ATTRIBUTES:total_amount_paid::NUMBER(38,2) FROM spa_rec WHERE RECORD_TYPE = 'investor' AND EXTRACTION_ID IN (SELECT EXTRACTION_ID FROM spa_rec WHERE RECORD_TYPE = 'company' AND COALESCE(ARRAY_SIZE(RAW_JSON:purchasers), 0) = 0)), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(CASE WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) = 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) != 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0] IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]::VARCHAR ELSE ATTRIBUTES:effective_date::VARCHAR END) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), spa_company AS (SELECT EXTRACTION_ID, ISSUER_NAME, COALESCE(NULLIF(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')), ''), UPPER(TRIM(ISSUER_NAME))) AS ISSUER_KEY FROM spa_issuer WHERE FIRM_ID = '<firm_id>' AND ISSUER_NAME IS NOT NULL AND TRIM(ISSUER_NAME) <> ''), company AS (SELECT c.EXTRACTION_ID, l.ISSUER_NAME FROM spa_company c JOIN (SELECT ISSUER_KEY, COALESCE(MIN(IFF(ISSUER_NAME <> UPPER(ISSUER_NAME), ISSUER_NAME, NULL)), MIN(ISSUER_NAME)) AS ISSUER_NAME FROM spa_company GROUP BY ISSUER_KEY) l ON c.ISSUER_KEY = l.ISSUER_KEY), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM company i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), soi_company AS (SELECT DISTINCT ISSUER_NAME, ENTITY_LINK_ID FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' AND ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') AND ISSUER_NAME IS NOT NULL AND TRIM(ISSUER_NAME) <> '' AND ENTITY_LINK_ID IS NOT NULL), cap_link AS (SELECT DISTINCT FIRM_ID, ENTITY_LINK_ID, CORPORATION_ID FROM FUND_ADMIN.CORPORATION_ENTITY_LINKS_V2 WHERE FIRM_ID = '<firm_id>' AND CORPORATION_ID IS NOT NULL), norm_investments_base AS (SELECT ISSUER_NAME AS INV_NAME, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS NAME_NORM, COALESCE(REGEXP_SUBSTR(ISSUER_NAME, '[(] *(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?)[ :]+([^)]+)[)]', 1, 1, 'ie', 3), IFF(REGEXP_LIKE(UPPER(TRIM(REGEXP_SUBSTR(ISSUER_NAME, '[(]([^)]+)[)]', 1, 1, 'e', 1))), '(.{0,2}|[0-9].*|SERIES.*|.*COMPANY|HELD .*|INVESTMENT .*|HOLDINGS?|GROUP|CAYMAN|BVI|PTY|DELAWARE|OFFSHORE|ONSHORE|FEEDER)'), NULL, REGEXP_SUBSTR(ISSUER_NAME, '[(]([^)]+)[)]', 1, 1, 'e', 1)), REGEXP_SUBSTR(ISSUER_NAME, '[ ,]+(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?)[ :]+([^(]+)', 1, 1, 'ie', 3)) AS ALIAS_RAW FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' GROUP BY ISSUER_NAME HAVING MAX(CASE WHEN ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') THEN 1 ELSE 0 END) = 1), norm_investments AS (SELECT INV_NAME, NAME_NORM, 0 AS IS_ALIAS FROM norm_investments_base UNION ALL SELECT INV_NAME, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ALIAS_RAW), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS NAME_NORM, 1 AS IS_ALIAS FROM norm_investments_base WHERE ALIAS_RAW IS NOT NULL AND TRIM(ALIAS_RAW) <> ''), norm_spa AS (SELECT DISTINCT i.ISSUER_NAME AS SPA_NAME, LOWER(TRIM(i.ISSUER_NAME)) AS NORM_KEY, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(i.ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS NAME_NORM FROM spa_issuer i WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> ''), spa_fuzzy AS (SELECT s.SPA_NAME, s.NORM_KEY, i.INV_NAME AS MATCHED_INV_NAME, ROW_NUMBER() OVER (PARTITION BY s.SPA_NAME ORDER BY JAROWINKLER_SIMILARITY(s.NAME_NORM, i.NAME_NORM) DESC NULLS LAST, i.IS_ALIAS, i.INV_NAME) AS RN FROM norm_spa s LEFT JOIN norm_investments i ON JAROWINKLER_SIMILARITY(s.NAME_NORM, i.NAME_NORM) >= 90), spa_label AS (SELECT f.MATCHED_INV_NAME AS INV_NAME, MIN(c.ISSUER_NAME) AS ISSUER_NAME FROM spa_fuzzy f JOIN spa_company sc ON sc.ISSUER_NAME = f.SPA_NAME JOIN company c ON c.EXTRACTION_ID = sc.EXTRACTION_ID WHERE f.RN = 1 AND f.MATCHED_INV_NAME IS NOT NULL GROUP BY f.MATCHED_INV_NAME), cap_latest AS (SELECT CORPORATION_ID, STAKEHOLDER_NAME, STAKEHOLDER_GROUP_NAME, STAKEHOLDER_FULLY_DILUTED_OWNERSHIP, SECURITY_CLASS_TYPE, AS_CONVERTED_SHARCLASS_STOCK_TYPE FROM FUND_ADMIN.STAKEHOLDER_CAP_TABLE WHERE CORPORATION_ID IN (SELECT CORPORATION_ID FROM cap_link) QUALIFY AS_OF_DATE = MAX(AS_OF_DATE) OVER (PARTITION BY CORPORATION_ID)), cap_holder AS (SELECT DISTINCT COALESCE(sl.ISSUER_NAME, s.ISSUER_NAME) AS ISSUER_NAME, h.STAKEHOLDER_NAME, COALESCE(h.STAKEHOLDER_GROUP_NAME, h.STAKEHOLDER_NAME) AS GROUP_NAME FROM cap_latest h JOIN cap_link l ON h.CORPORATION_ID = l.CORPORATION_ID JOIN soi_company s ON s.ENTITY_LINK_ID = l.ENTITY_LINK_ID LEFT JOIN spa_label sl ON sl.INV_NAME = s.ISSUER_NAME WHERE (h.SECURITY_CLASS_TYPE = 'note_block' OR (h.SECURITY_CLASS_TYPE IN ('share_class', 'warrant_block') AND h.AS_CONVERTED_SHARCLASS_STOCK_TYPE = 'Preferred')) AND COALESCE(LOWER(TRIM(h.STAKEHOLDER_NAME)), '') NOT IN ('outside investors', 'outside investor') AND COALESCE(LOWER(TRIM(h.STAKEHOLDER_GROUP_NAME)), '') NOT IN ('outside investors', 'outside investor')), cap_canon AS (SELECT p.PURCHASER_NAME, <CANONICAL_CASE>, IFF(LENGTH(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(p.PURCHASER_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')), '\\\\b(FUND|FUNDS|CAPITAL|VENTURES|VENTURE|PARTNERS|PARTNER|GROWTH|OPPORTUNITY|OPPORTUNITIES|MANAGEMENT|HOLDINGS|GROUP|SERIES|THE|OF|LP|LLC|LLP|LTD|LIMITED|INC|CORP|CORPORATION|CO|COMPANY|GP|PBC|PLC|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|[0-9]+)\\\\b', ''), '[^A-Z0-9]', '')) >= 4, REGEXP_REPLACE(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(p.PURCHASER_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')), '\\\\b(FUND|FUNDS|CAPITAL|VENTURES|VENTURE|PARTNERS|PARTNER|GROWTH|OPPORTUNITY|OPPORTUNITIES|MANAGEMENT|HOLDINGS|GROUP|SERIES|THE|OF|LP|LLC|LLP|LTD|LIMITED|INC|CORP|CORPORATION|CO|COMPANY|GP|PBC|PLC|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|[0-9]+)\\\\b', ''), '[^A-Z0-9]', ''), '') AS LOOSE_STEM FROM (SELECT STAKEHOLDER_NAME AS PURCHASER_NAME FROM cap_holder UNION SELECT GROUP_NAME FROM cap_holder) p), cap_identity AS (SELECT h.ISSUER_NAME, h.STAKEHOLDER_NAME, CASE WHEN sc.CANONICAL_NAME <> h.STAKEHOLDER_NAME THEN h.STAKEHOLDER_NAME WHEN gc.CANONICAL_NAME <> h.GROUP_NAME THEN h.GROUP_NAME WHEN sc.LOOSE_STEM <> '' AND gc.LOOSE_STEM <> '' AND (CONTAINS(sc.LOOSE_STEM, gc.LOOSE_STEM) OR CONTAINS(gc.LOOSE_STEM, sc.LOOSE_STEM)) THEN h.GROUP_NAME ELSE h.STAKEHOLDER_NAME END AS PURCHASER_NAME FROM cap_holder h JOIN cap_canon sc ON sc.PURCHASER_NAME = h.STAKEHOLDER_NAME JOIN cap_canon gc ON gc.PURCHASER_NAME = h.GROUP_NAME), name_pool AS (SELECT PURCHASER_NAME FROM spa_purchaser UNION SELECT PURCHASER_NAME FROM cap_identity UNION SELECT STAKEHOLDER_NAME FROM cap_identity), firm_vehicle AS (SELECT DISTINCT V_NORM, TRIM(REGEXP_REPLACE(REGEXP_REPLACE(V_NORM, ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')) AS V_STEM FROM (SELECT TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(FUND_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')) AS V_NORM FROM FUND_ADMIN.FUNDS WHERE FIRM_ID = '<firm_id>' AND FUND_NAME IS NOT NULL) WHERE V_NORM <> ''), own_purchaser AS (SELECT DISTINCT pn.PURCHASER_NAME FROM (SELECT PURCHASER_NAME, TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(PURCHASER_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')) AS P_NORM FROM name_pool WHERE PURCHASER_NAME IS NOT NULL) pn JOIN firm_vehicle v ON pn.P_NORM = v.V_NORM OR STARTSWITH(pn.P_NORM, v.V_NORM || ' ') OR (CONTAINS(pn.P_NORM, ' ') AND STARTSWITH(v.V_NORM, pn.P_NORM || ' ')) OR (CONTAINS(v.V_STEM, ' ') AND TRIM(REGEXP_REPLACE(REGEXP_REPLACE(pn.P_NORM, ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')) = v.V_STEM)), purchaser_canonical AS (SELECT i.ISSUER_NAME, p.PURCHASER_NAME, p.ENTITY_TYPE, <CANONICAL_CASE> FROM dedup_docs dd JOIN company i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND REGEXP_REPLACE(UPPER(p.PURCHASER_NAME), '[^A-Z0-9]', '') NOT LIKE '%<firm_name_compact>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%' AND p.PURCHASER_NAME NOT IN (SELECT PURCHASER_NAME FROM own_purchaser) UNION ALL SELECT p.ISSUER_NAME, p.PURCHASER_NAME, CAST(NULL AS VARCHAR) AS ENTITY_TYPE, <CANONICAL_CASE> FROM cap_identity p WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND REGEXP_REPLACE(UPPER(p.PURCHASER_NAME), '[^A-Z0-9]', '') NOT LIKE '%<firm_name_compact>%' AND p.STAKEHOLDER_NAME NOT ILIKE '%<firm_name>%' AND p.STAKEHOLDER_NAME NOT ILIKE '%<firm_name_spaced>%' AND REGEXP_REPLACE(UPPER(p.STAKEHOLDER_NAME), '[^A-Z0-9]', '') NOT LIKE '%<firm_name_compact>%' AND p.PURCHASER_NAME NOT IN (SELECT PURCHASER_NAME FROM own_purchaser) AND p.STAKEHOLDER_NAME NOT IN (SELECT PURCHASER_NAME FROM own_purchaser)) SELECT COALESCE(MIN(IFF(CANONICAL_NAME <> UPPER(CANONICAL_NAME), CANONICAL_NAME, NULL)), MIN(CANONICAL_NAME)) AS CANONICAL_NAME, MAX(ENTITY_TYPE) AS ENTITY_TYPE, COUNT(DISTINCT ISSUER_NAME) AS COMPANY_COUNT, ARRAY_AGG(DISTINCT ISSUER_NAME) WITHIN GROUP (ORDER BY ISSUER_NAME) AS COMPANIES, ARRAY_AGG(DISTINCT PURCHASER_NAME) WITHIN GROUP (ORDER BY PURCHASER_NAME) AS RAW_NAMES FROM purchaser_canonical GROUP BY COALESCE(NULLIF(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(CANONICAL_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')), ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')), '[^A-Z0-9]', ''), ''), REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(CANONICAL_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')), '[^A-Z0-9]', '')) ORDER BY COMPANY_COUNT DESC LIMIT 50"
}})
```

#### Q2 — Most frequent with >5% of a round

> **Why "% of round" and not "ownership":** this number reflects the investor's
> share of a single SPA round at purchase time. It is **not** current fully
> diluted ownership — that would require dilution math (subsequent rounds,
> option pool refreshes, secondaries) which SPA data alone cannot provide.
> Use the word "ownership" only for cap table figures, and then only as
> "current fully diluted ownership". SPA figures are always "% of round".
> Q2 and Q3 rank SPA rounds only: a cap table has no round to take a share of.

Use the Step B0 `CANONICAL_NAME` CASE expression so multi-vehicle investors
are aggregated at the canonical level. % of round is recomputed as
`SUM(canonical shares) / SUM(round shares)` so a firm investing through
multiple vehicles in the same round is credited with the combined stake.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, CASE WHEN TYPEOF(RAW_JSON:company:name) = 'OBJECT' AND RAW_JSON:company:name:value::VARCHAR IS NOT NULL THEN RAW_JSON:company:name:value::VARCHAR WHEN TYPEOF(RAW_JSON:company:name) != 'OBJECT' AND RAW_JSON:company:name IS NOT NULL THEN RAW_JSON:company:name::VARCHAR ELSE ATTRIBUTES:name::VARCHAR END AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT r.EXTRACTION_ID, CASE WHEN TYPEOF(f.VALUE:name) = 'OBJECT' THEN f.VALUE:name:value::VARCHAR ELSE f.VALUE:name::VARCHAR END AS PURCHASER_NAME, CASE WHEN TYPEOF(f.VALUE:entity_type) = 'OBJECT' THEN f.VALUE:entity_type:value::VARCHAR ELSE f.VALUE:entity_type::VARCHAR END AS ENTITY_TYPE, CASE WHEN TYPEOF(f.VALUE:share_class_name) = 'OBJECT' THEN f.VALUE:share_class_name:value::VARCHAR ELSE f.VALUE:share_class_name::VARCHAR END AS SHARE_CLASS_NAME, CASE WHEN TYPEOF(f.VALUE:shares_purchased_by_cash) = 'OBJECT' THEN f.VALUE:shares_purchased_by_cash:value::NUMBER ELSE f.VALUE:shares_purchased_by_cash::NUMBER END AS SHARES_PURCHASED, CASE WHEN TYPEOF(f.VALUE:total_amount_paid) = 'OBJECT' THEN f.VALUE:total_amount_paid:value::NUMBER(38,2) ELSE f.VALUE:total_amount_paid::NUMBER(38,2) END AS TOTAL_AMOUNT_PAID FROM spa_rec r, LATERAL FLATTEN(input => r.RAW_JSON:purchasers) f WHERE r.RECORD_TYPE = 'company' AND r.RAW_JSON IS NOT NULL AND ARRAY_SIZE(r.RAW_JSON:purchasers) > 0 UNION ALL SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR, ATTRIBUTES:entity_type::VARCHAR, ATTRIBUTES:share_class_name::VARCHAR, ATTRIBUTES:shares_purchased_by_cash::NUMBER, ATTRIBUTES:total_amount_paid::NUMBER(38,2) FROM spa_rec WHERE RECORD_TYPE = 'investor' AND EXTRACTION_ID IN (SELECT EXTRACTION_ID FROM spa_rec WHERE RECORD_TYPE = 'company' AND COALESCE(ARRAY_SIZE(RAW_JSON:purchasers), 0) = 0)), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(CASE WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) = 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) != 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0] IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]::VARCHAR ELSE ATTRIBUTES:effective_date::VARCHAR END) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), spa_company AS (SELECT EXTRACTION_ID, ISSUER_NAME, COALESCE(NULLIF(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')), ''), UPPER(TRIM(ISSUER_NAME))) AS ISSUER_KEY FROM spa_issuer WHERE FIRM_ID = '<firm_id>' AND ISSUER_NAME IS NOT NULL AND TRIM(ISSUER_NAME) <> ''), company AS (SELECT c.EXTRACTION_ID, l.ISSUER_NAME FROM spa_company c JOIN (SELECT ISSUER_KEY, COALESCE(MIN(IFF(ISSUER_NAME <> UPPER(ISSUER_NAME), ISSUER_NAME, NULL)), MIN(ISSUER_NAME)) AS ISSUER_NAME FROM spa_company GROUP BY ISSUER_KEY) l ON c.ISSUER_KEY = l.ISSUER_KEY), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM company i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), name_pool AS (SELECT PURCHASER_NAME FROM spa_purchaser), firm_vehicle AS (SELECT DISTINCT V_NORM, TRIM(REGEXP_REPLACE(REGEXP_REPLACE(V_NORM, ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')) AS V_STEM FROM (SELECT TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(FUND_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')) AS V_NORM FROM FUND_ADMIN.FUNDS WHERE FIRM_ID = '<firm_id>' AND FUND_NAME IS NOT NULL) WHERE V_NORM <> ''), own_purchaser AS (SELECT DISTINCT pn.PURCHASER_NAME FROM (SELECT PURCHASER_NAME, TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(PURCHASER_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')) AS P_NORM FROM name_pool WHERE PURCHASER_NAME IS NOT NULL) pn JOIN firm_vehicle v ON pn.P_NORM = v.V_NORM OR STARTSWITH(pn.P_NORM, v.V_NORM || ' ') OR (CONTAINS(pn.P_NORM, ' ') AND STARTSWITH(v.V_NORM, pn.P_NORM || ' ')) OR (CONTAINS(v.V_STEM, ' ') AND TRIM(REGEXP_REPLACE(REGEXP_REPLACE(pn.P_NORM, ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')) = v.V_STEM)), spa_canonical AS (SELECT i.ISSUER_NAME, <CANONICAL_CASE> AS CANONICAL_NAME, p.ENTITY_TYPE, p.SHARES_PURCHASED, s.CLOSING_DATE, dd.EXTRACTION_ID FROM dedup_docs dd JOIN company i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID LEFT JOIN spa_deal s ON dd.EXTRACTION_ID = s.EXTRACTION_ID WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND REGEXP_REPLACE(UPPER(p.PURCHASER_NAME), '[^A-Z0-9]', '') NOT LIKE '%<firm_name_compact>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%' AND p.PURCHASER_NAME NOT IN (SELECT PURCHASER_NAME FROM own_purchaser)), per_round AS (SELECT ISSUER_NAME, COALESCE(NULLIF(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(CANONICAL_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')), ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')), '[^A-Z0-9]', ''), ''), REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(CANONICAL_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')), '[^A-Z0-9]', '')) AS CANONICAL_KEY, COALESCE(MIN(IFF(CANONICAL_NAME <> UPPER(CANONICAL_NAME), CANONICAL_NAME, NULL)), MIN(CANONICAL_NAME)) AS CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, SUM(SHARES_PURCHASED) AS CANONICAL_SHARES FROM spa_canonical GROUP BY ISSUER_NAME, CANONICAL_KEY, EXTRACTION_ID, CLOSING_DATE), pct_per_round AS (SELECT ISSUER_NAME, CANONICAL_KEY, CANONICAL_NAME, ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, CANONICAL_SHARES / NULLIF(SUM(CANONICAL_SHARES) OVER (PARTITION BY EXTRACTION_ID), 0) AS PCT_OF_ROUND FROM per_round), latest_round AS (SELECT ISSUER_NAME, CANONICAL_KEY, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND, ROW_NUMBER() OVER (PARTITION BY ISSUER_NAME, CANONICAL_KEY ORDER BY CLOSING_DATE DESC NULLS LAST, EXTRACTION_ID DESC) AS rn FROM pct_per_round), filtered AS (SELECT ISSUER_NAME, CANONICAL_KEY, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND FROM latest_round WHERE rn = 1 AND PCT_OF_ROUND > 0.05) SELECT COALESCE(MIN(IFF(CANONICAL_NAME <> UPPER(CANONICAL_NAME), CANONICAL_NAME, NULL)), MIN(CANONICAL_NAME)) AS CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, COUNT(DISTINCT ISSUER_NAME) AS COMPANIES_ABOVE_5PCT, ROUND(AVG(PCT_OF_ROUND) * 100, 1) AS AVG_PCT_OF_ROUND, ARRAY_AGG(DISTINCT ISSUER_NAME) WITHIN GROUP (ORDER BY ISSUER_NAME) AS COMPANIES FROM filtered GROUP BY CANONICAL_KEY ORDER BY COMPANIES_ABOVE_5PCT DESC, AVG_PCT_OF_ROUND DESC LIMIT 50"
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
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, CASE WHEN TYPEOF(RAW_JSON:company:name) = 'OBJECT' AND RAW_JSON:company:name:value::VARCHAR IS NOT NULL THEN RAW_JSON:company:name:value::VARCHAR WHEN TYPEOF(RAW_JSON:company:name) != 'OBJECT' AND RAW_JSON:company:name IS NOT NULL THEN RAW_JSON:company:name::VARCHAR ELSE ATTRIBUTES:name::VARCHAR END AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT r.EXTRACTION_ID, CASE WHEN TYPEOF(f.VALUE:name) = 'OBJECT' THEN f.VALUE:name:value::VARCHAR ELSE f.VALUE:name::VARCHAR END AS PURCHASER_NAME, CASE WHEN TYPEOF(f.VALUE:entity_type) = 'OBJECT' THEN f.VALUE:entity_type:value::VARCHAR ELSE f.VALUE:entity_type::VARCHAR END AS ENTITY_TYPE, CASE WHEN TYPEOF(f.VALUE:share_class_name) = 'OBJECT' THEN f.VALUE:share_class_name:value::VARCHAR ELSE f.VALUE:share_class_name::VARCHAR END AS SHARE_CLASS_NAME, CASE WHEN TYPEOF(f.VALUE:shares_purchased_by_cash) = 'OBJECT' THEN f.VALUE:shares_purchased_by_cash:value::NUMBER ELSE f.VALUE:shares_purchased_by_cash::NUMBER END AS SHARES_PURCHASED, CASE WHEN TYPEOF(f.VALUE:total_amount_paid) = 'OBJECT' THEN f.VALUE:total_amount_paid:value::NUMBER(38,2) ELSE f.VALUE:total_amount_paid::NUMBER(38,2) END AS TOTAL_AMOUNT_PAID FROM spa_rec r, LATERAL FLATTEN(input => r.RAW_JSON:purchasers) f WHERE r.RECORD_TYPE = 'company' AND r.RAW_JSON IS NOT NULL AND ARRAY_SIZE(r.RAW_JSON:purchasers) > 0 UNION ALL SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR, ATTRIBUTES:entity_type::VARCHAR, ATTRIBUTES:share_class_name::VARCHAR, ATTRIBUTES:shares_purchased_by_cash::NUMBER, ATTRIBUTES:total_amount_paid::NUMBER(38,2) FROM spa_rec WHERE RECORD_TYPE = 'investor' AND EXTRACTION_ID IN (SELECT EXTRACTION_ID FROM spa_rec WHERE RECORD_TYPE = 'company' AND COALESCE(ARRAY_SIZE(RAW_JSON:purchasers), 0) = 0)), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(CASE WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) = 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) != 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0] IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]::VARCHAR ELSE ATTRIBUTES:effective_date::VARCHAR END) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), spa_company AS (SELECT EXTRACTION_ID, ISSUER_NAME, COALESCE(NULLIF(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')), ''), UPPER(TRIM(ISSUER_NAME))) AS ISSUER_KEY FROM spa_issuer WHERE FIRM_ID = '<firm_id>' AND ISSUER_NAME IS NOT NULL AND TRIM(ISSUER_NAME) <> ''), company AS (SELECT c.EXTRACTION_ID, l.ISSUER_NAME FROM spa_company c JOIN (SELECT ISSUER_KEY, COALESCE(MIN(IFF(ISSUER_NAME <> UPPER(ISSUER_NAME), ISSUER_NAME, NULL)), MIN(ISSUER_NAME)) AS ISSUER_NAME FROM spa_company GROUP BY ISSUER_KEY) l ON c.ISSUER_KEY = l.ISSUER_KEY), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM company i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), name_pool AS (SELECT PURCHASER_NAME FROM spa_purchaser), firm_vehicle AS (SELECT DISTINCT V_NORM, TRIM(REGEXP_REPLACE(REGEXP_REPLACE(V_NORM, ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')) AS V_STEM FROM (SELECT TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(FUND_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')) AS V_NORM FROM FUND_ADMIN.FUNDS WHERE FIRM_ID = '<firm_id>' AND FUND_NAME IS NOT NULL) WHERE V_NORM <> ''), own_purchaser AS (SELECT DISTINCT pn.PURCHASER_NAME FROM (SELECT PURCHASER_NAME, TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(PURCHASER_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')) AS P_NORM FROM name_pool WHERE PURCHASER_NAME IS NOT NULL) pn JOIN firm_vehicle v ON pn.P_NORM = v.V_NORM OR STARTSWITH(pn.P_NORM, v.V_NORM || ' ') OR (CONTAINS(pn.P_NORM, ' ') AND STARTSWITH(v.V_NORM, pn.P_NORM || ' ')) OR (CONTAINS(v.V_STEM, ' ') AND TRIM(REGEXP_REPLACE(REGEXP_REPLACE(pn.P_NORM, ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')) = v.V_STEM)), spa_canonical AS (SELECT i.ISSUER_NAME, <CANONICAL_CASE> AS CANONICAL_NAME, p.ENTITY_TYPE, p.SHARES_PURCHASED, s.CLOSING_DATE, dd.EXTRACTION_ID FROM dedup_docs dd JOIN company i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID LEFT JOIN spa_deal s ON dd.EXTRACTION_ID = s.EXTRACTION_ID WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND REGEXP_REPLACE(UPPER(p.PURCHASER_NAME), '[^A-Z0-9]', '') NOT LIKE '%<firm_name_compact>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%' AND p.PURCHASER_NAME NOT IN (SELECT PURCHASER_NAME FROM own_purchaser)), per_round AS (SELECT ISSUER_NAME, COALESCE(NULLIF(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(CANONICAL_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')), ' (LP|LLC|LTD|LIMITED|INC|CORP|CORPORATION|GP|PBC)$', ''), ' (I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII)$', '')), '[^A-Z0-9]', ''), ''), REGEXP_REPLACE(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(UPPER(CANONICAL_NAME), '[’‘`´]', ''''), '[.,]', ''), ' *[-‐‑‒–—] *', '-'), '\\\\s+', ' ')), '[^A-Z0-9]', '')) AS CANONICAL_KEY, COALESCE(MIN(IFF(CANONICAL_NAME <> UPPER(CANONICAL_NAME), CANONICAL_NAME, NULL)), MIN(CANONICAL_NAME)) AS CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, SUM(SHARES_PURCHASED) AS CANONICAL_SHARES FROM spa_canonical GROUP BY ISSUER_NAME, CANONICAL_KEY, EXTRACTION_ID, CLOSING_DATE), pct_per_round AS (SELECT ISSUER_NAME, CANONICAL_KEY, CANONICAL_NAME, ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, CANONICAL_SHARES / NULLIF(SUM(CANONICAL_SHARES) OVER (PARTITION BY EXTRACTION_ID), 0) AS PCT_OF_ROUND FROM per_round), latest_round AS (SELECT ISSUER_NAME, CANONICAL_KEY, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND, ROW_NUMBER() OVER (PARTITION BY ISSUER_NAME, CANONICAL_KEY ORDER BY CLOSING_DATE DESC NULLS LAST, EXTRACTION_ID DESC) AS rn FROM pct_per_round), filtered AS (SELECT ISSUER_NAME, CANONICAL_KEY, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND FROM latest_round WHERE rn = 1 AND PCT_OF_ROUND < 0.05 AND PCT_OF_ROUND > 0 AND PCT_OF_ROUND < 1.0) SELECT COALESCE(MIN(IFF(CANONICAL_NAME <> UPPER(CANONICAL_NAME), CANONICAL_NAME, NULL)), MIN(CANONICAL_NAME)) AS CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, COUNT(DISTINCT ISSUER_NAME) AS COMPANIES_BELOW_5PCT, ROUND(AVG(PCT_OF_ROUND) * 100, 2) AS AVG_PCT_OF_ROUND, ARRAY_AGG(DISTINCT ISSUER_NAME) WITHIN GROUP (ORDER BY ISSUER_NAME) AS COMPANIES FROM filtered GROUP BY CANONICAL_KEY ORDER BY COMPANIES_BELOW_5PCT DESC, AVG_PCT_OF_ROUND DESC LIMIT 50"
}})
```

#### Q4 — Company-specific

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, CASE WHEN TYPEOF(RAW_JSON:company:name) = 'OBJECT' AND RAW_JSON:company:name:value::VARCHAR IS NOT NULL THEN RAW_JSON:company:name:value::VARCHAR WHEN TYPEOF(RAW_JSON:company:name) != 'OBJECT' AND RAW_JSON:company:name IS NOT NULL THEN RAW_JSON:company:name::VARCHAR ELSE ATTRIBUTES:name::VARCHAR END AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT r.EXTRACTION_ID, CASE WHEN TYPEOF(f.VALUE:name) = 'OBJECT' THEN f.VALUE:name:value::VARCHAR ELSE f.VALUE:name::VARCHAR END AS PURCHASER_NAME, CASE WHEN TYPEOF(f.VALUE:entity_type) = 'OBJECT' THEN f.VALUE:entity_type:value::VARCHAR ELSE f.VALUE:entity_type::VARCHAR END AS ENTITY_TYPE, CASE WHEN TYPEOF(f.VALUE:share_class_name) = 'OBJECT' THEN f.VALUE:share_class_name:value::VARCHAR ELSE f.VALUE:share_class_name::VARCHAR END AS SHARE_CLASS_NAME, CASE WHEN TYPEOF(f.VALUE:shares_purchased_by_cash) = 'OBJECT' THEN f.VALUE:shares_purchased_by_cash:value::NUMBER ELSE f.VALUE:shares_purchased_by_cash::NUMBER END AS SHARES_PURCHASED, CASE WHEN TYPEOF(f.VALUE:total_amount_paid) = 'OBJECT' THEN f.VALUE:total_amount_paid:value::NUMBER(38,2) ELSE f.VALUE:total_amount_paid::NUMBER(38,2) END AS TOTAL_AMOUNT_PAID FROM spa_rec r, LATERAL FLATTEN(input => r.RAW_JSON:purchasers) f WHERE r.RECORD_TYPE = 'company' AND r.RAW_JSON IS NOT NULL AND ARRAY_SIZE(r.RAW_JSON:purchasers) > 0 UNION ALL SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR, ATTRIBUTES:entity_type::VARCHAR, ATTRIBUTES:share_class_name::VARCHAR, ATTRIBUTES:shares_purchased_by_cash::NUMBER, ATTRIBUTES:total_amount_paid::NUMBER(38,2) FROM spa_rec WHERE RECORD_TYPE = 'investor' AND EXTRACTION_ID IN (SELECT EXTRACTION_ID FROM spa_rec WHERE RECORD_TYPE = 'company' AND COALESCE(ARRAY_SIZE(RAW_JSON:purchasers), 0) = 0)), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(CASE WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) = 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) != 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0] IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]::VARCHAR ELSE ATTRIBUTES:effective_date::VARCHAR END) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), spa_currency AS (SELECT EXTRACTION_ID, CASE WHEN REGEXP_LIKE(CUR_RAW, '[A-Z]{3}') THEN CUR_RAW WHEN REGEXP_LIKE(CUR_RAW, 'US[$]|U[.]?S[.]? DOLLARS?|UNITED STATES (DOLLARS?|CURRENCY)') THEN 'USD' WHEN REGEXP_LIKE(CUR_RAW, 'CANADIAN (DOLLARS?|CURRENCY)') THEN 'CAD' WHEN REGEXP_LIKE(CUR_RAW, 'AUSTRALIAN DOLLARS?') THEN 'AUD' END AS CURRENCY FROM (SELECT EXTRACTION_ID, UPPER(TRIM(CASE WHEN TYPEOF(RAW_JSON:currency) = 'OBJECT' THEN RAW_JSON:currency:value::VARCHAR ELSE RAW_JSON:currency::VARCHAR END)) AS CUR_RAW FROM spa_rec WHERE RECORD_TYPE = 'company')) SELECT dd.EXTRACTION_ID, i.ISSUER_NAME, p.SHARE_CLASS_NAME, s.CLOSING_DATE, cur.CURRENCY, p.PURCHASER_NAME, p.ENTITY_TYPE, p.SHARES_PURCHASED, p.TOTAL_AMOUNT_PAID, p.SHARES_PURCHASED / NULLIF(SUM(p.SHARES_PURCHASED) OVER (PARTITION BY dd.EXTRACTION_ID), 0) AS PCT_OF_ROUND FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID LEFT JOIN spa_deal s ON dd.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_currency cur ON dd.EXTRACTION_ID = cur.EXTRACTION_ID WHERE i.ISSUER_NAME ILIKE '%<company_name>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%' ORDER BY CLOSING_DATE DESC, SHARES_PURCHASED DESC LIMIT 500"
}})
```

> Column note: use `p.SHARE_CLASS_NAME` from the purchaser table as the round label.
> The SPA table does not have a `SERIES_NAME` column. Q4 leaves purchaser names
> as raw values so the breakdown matches the SPA document line-for-line.

#### Q4b — Company-specific current holders

Run alongside Q4 for the same company. It reads the company's current cap table by stakeholder; an empty result means the company has not shared a detailed cap table with the firm, and Q4 alone answers.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH cap_link AS (SELECT DISTINCT FIRM_ID, ENTITY_LINK_ID, CORPORATION_ID FROM FUND_ADMIN.CORPORATION_ENTITY_LINKS_V2 WHERE FIRM_ID = '<firm_id>' AND CORPORATION_ID IS NOT NULL), soi_company AS (SELECT DISTINCT ISSUER_NAME, ENTITY_LINK_ID FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' AND ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') AND ISSUER_NAME IS NOT NULL AND ENTITY_LINK_ID IS NOT NULL), cap_latest AS (SELECT CORPORATION_ID, STAKEHOLDER_NAME, STAKEHOLDER_GROUP_NAME, STAKEHOLDER_FULLY_DILUTED_OWNERSHIP, SECURITY_CLASS_TYPE, AS_CONVERTED_SHARCLASS_STOCK_TYPE FROM FUND_ADMIN.STAKEHOLDER_CAP_TABLE WHERE CORPORATION_ID IN (SELECT CORPORATION_ID FROM cap_link) QUALIFY AS_OF_DATE = MAX(AS_OF_DATE) OVER (PARTITION BY CORPORATION_ID)) SELECT s.ISSUER_NAME, h.STAKEHOLDER_NAME, h.STAKEHOLDER_GROUP_NAME, MAX(h.STAKEHOLDER_FULLY_DILUTED_OWNERSHIP) AS FULLY_DILUTED_OWNERSHIP FROM cap_latest h JOIN cap_link l ON h.CORPORATION_ID = l.CORPORATION_ID JOIN soi_company s ON s.ENTITY_LINK_ID = l.ENTITY_LINK_ID WHERE s.ISSUER_NAME ILIKE '%<company_name>%' AND (h.SECURITY_CLASS_TYPE = 'note_block' OR (h.SECURITY_CLASS_TYPE IN ('share_class', 'warrant_block') AND h.AS_CONVERTED_SHARCLASS_STOCK_TYPE = 'Preferred')) AND COALESCE(LOWER(TRIM(h.STAKEHOLDER_NAME)), '') NOT IN ('outside investors', 'outside investor') AND COALESCE(LOWER(TRIM(h.STAKEHOLDER_GROUP_NAME)), '') NOT IN ('outside investors', 'outside investor') GROUP BY s.ISSUER_NAME, h.STAKEHOLDER_NAME, h.STAKEHOLDER_GROUP_NAME ORDER BY ISSUER_NAME, FULLY_DILUTED_OWNERSHIP DESC NULLS LAST, STAKEHOLDER_NAME LIMIT 500"
}})
```

#### QC — Coverage

Run once per Mode B answer, alongside the ranking query. It counts the priced-equity portfolio companies covered by SPAs, by detailed cap tables with investor holders, by both, and by either. The SPA and cap table counts each include the companies in both; Step B3 turns them into disjoint counts.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, CASE WHEN TYPEOF(RAW_JSON:company:name) = 'OBJECT' AND RAW_JSON:company:name:value::VARCHAR IS NOT NULL THEN RAW_JSON:company:name:value::VARCHAR WHEN TYPEOF(RAW_JSON:company:name) != 'OBJECT' AND RAW_JSON:company:name IS NOT NULL THEN RAW_JSON:company:name::VARCHAR ELSE ATTRIBUTES:name::VARCHAR END AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT r.EXTRACTION_ID, CASE WHEN TYPEOF(f.VALUE:name) = 'OBJECT' THEN f.VALUE:name:value::VARCHAR ELSE f.VALUE:name::VARCHAR END AS PURCHASER_NAME, CASE WHEN TYPEOF(f.VALUE:entity_type) = 'OBJECT' THEN f.VALUE:entity_type:value::VARCHAR ELSE f.VALUE:entity_type::VARCHAR END AS ENTITY_TYPE, CASE WHEN TYPEOF(f.VALUE:share_class_name) = 'OBJECT' THEN f.VALUE:share_class_name:value::VARCHAR ELSE f.VALUE:share_class_name::VARCHAR END AS SHARE_CLASS_NAME, CASE WHEN TYPEOF(f.VALUE:shares_purchased_by_cash) = 'OBJECT' THEN f.VALUE:shares_purchased_by_cash:value::NUMBER ELSE f.VALUE:shares_purchased_by_cash::NUMBER END AS SHARES_PURCHASED, CASE WHEN TYPEOF(f.VALUE:total_amount_paid) = 'OBJECT' THEN f.VALUE:total_amount_paid:value::NUMBER(38,2) ELSE f.VALUE:total_amount_paid::NUMBER(38,2) END AS TOTAL_AMOUNT_PAID FROM spa_rec r, LATERAL FLATTEN(input => r.RAW_JSON:purchasers) f WHERE r.RECORD_TYPE = 'company' AND r.RAW_JSON IS NOT NULL AND ARRAY_SIZE(r.RAW_JSON:purchasers) > 0 UNION ALL SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR, ATTRIBUTES:entity_type::VARCHAR, ATTRIBUTES:share_class_name::VARCHAR, ATTRIBUTES:shares_purchased_by_cash::NUMBER, ATTRIBUTES:total_amount_paid::NUMBER(38,2) FROM spa_rec WHERE RECORD_TYPE = 'investor' AND EXTRACTION_ID IN (SELECT EXTRACTION_ID FROM spa_rec WHERE RECORD_TYPE = 'company' AND COALESCE(ARRAY_SIZE(RAW_JSON:purchasers), 0) = 0)), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(CASE WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) = 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]:value::VARCHAR WHEN TYPEOF(RAW_JSON:transaction_summary:closing_dates[0]) != 'OBJECT' AND RAW_JSON:transaction_summary:closing_dates[0] IS NOT NULL THEN RAW_JSON:transaction_summary:closing_dates[0]::VARCHAR ELSE ATTRIBUTES:effective_date::VARCHAR END) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), norm_investments_base AS (SELECT ISSUER_NAME AS INV_NAME, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS NAME_NORM, COALESCE(REGEXP_SUBSTR(ISSUER_NAME, '[(] *(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?)[ :]+([^)]+)[)]', 1, 1, 'ie', 3), IFF(REGEXP_LIKE(UPPER(TRIM(REGEXP_SUBSTR(ISSUER_NAME, '[(]([^)]+)[)]', 1, 1, 'e', 1))), '(.{0,2}|[0-9].*|SERIES.*|.*COMPANY|HELD .*|INVESTMENT .*|HOLDINGS?|GROUP|CAYMAN|BVI|PTY|DELAWARE|OFFSHORE|ONSHORE|FEEDER)'), NULL, REGEXP_SUBSTR(ISSUER_NAME, '[(]([^)]+)[)]', 1, 1, 'e', 1)), REGEXP_SUBSTR(ISSUER_NAME, '[ ,]+(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?)[ :]+([^(]+)', 1, 1, 'ie', 3)) AS ALIAS_RAW FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' GROUP BY ISSUER_NAME HAVING MAX(CASE WHEN ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') THEN 1 ELSE 0 END) = 1), norm_investments AS (SELECT INV_NAME, NAME_NORM, 0 AS IS_ALIAS FROM norm_investments_base UNION ALL SELECT INV_NAME, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ALIAS_RAW), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS NAME_NORM, 1 AS IS_ALIAS FROM norm_investments_base WHERE ALIAS_RAW IS NOT NULL AND TRIM(ALIAS_RAW) <> ''), norm_spa AS (SELECT DISTINCT i.ISSUER_NAME AS SPA_NAME, LOWER(TRIM(i.ISSUER_NAME)) AS NORM_KEY, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(i.ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY)[.]?)+ *$', '')), '[,.]', '')) AS NAME_NORM FROM spa_issuer i WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> ''), spa_fuzzy AS (SELECT s.SPA_NAME, s.NORM_KEY, i.INV_NAME AS MATCHED_INV_NAME, ROW_NUMBER() OVER (PARTITION BY s.SPA_NAME ORDER BY JAROWINKLER_SIMILARITY(s.NAME_NORM, i.NAME_NORM) DESC NULLS LAST, i.IS_ALIAS, i.INV_NAME) AS RN FROM norm_spa s LEFT JOIN norm_investments i ON JAROWINKLER_SIMILARITY(s.NAME_NORM, i.NAME_NORM) >= 90), canonical_company AS (SELECT NORM_KEY, COALESCE(MIN(MATCHED_INV_NAME), MAX(SPA_NAME)) AS CANONICAL_NAME FROM spa_fuzzy WHERE RN = 1 GROUP BY NORM_KEY), cap_link AS (SELECT DISTINCT FIRM_ID, ENTITY_LINK_ID, CORPORATION_ID FROM FUND_ADMIN.CORPORATION_ENTITY_LINKS_V2 WHERE FIRM_ID = '<firm_id>' AND CORPORATION_ID IS NOT NULL), cap_latest AS (SELECT CORPORATION_ID, STAKEHOLDER_NAME, STAKEHOLDER_GROUP_NAME, STAKEHOLDER_FULLY_DILUTED_OWNERSHIP, SECURITY_CLASS_TYPE, AS_CONVERTED_SHARCLASS_STOCK_TYPE FROM FUND_ADMIN.STAKEHOLDER_CAP_TABLE WHERE CORPORATION_ID IN (SELECT CORPORATION_ID FROM cap_link) QUALIFY AS_OF_DATE = MAX(AS_OF_DATE) OVER (PARTITION BY CORPORATION_ID)), cap_cov AS (SELECT DISTINCT a.ISSUER_NAME AS INV_NAME FROM FUND_ADMIN.AGGREGATE_INVESTMENTS a JOIN cap_link l ON a.FIRM_ID = l.FIRM_ID AND a.ENTITY_LINK_ID = l.ENTITY_LINK_ID WHERE a.FIRM_ID = '<firm_id>' AND a.ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') AND a.ISSUER_NAME IS NOT NULL AND l.CORPORATION_ID IN (SELECT CORPORATION_ID FROM cap_latest WHERE (SECURITY_CLASS_TYPE = 'note_block' OR (SECURITY_CLASS_TYPE IN ('share_class', 'warrant_block') AND AS_CONVERTED_SHARCLASS_STOCK_TYPE = 'Preferred')) AND COALESCE(LOWER(TRIM(STAKEHOLDER_NAME)), '') NOT IN ('outside investors', 'outside investor') AND COALESCE(LOWER(TRIM(STAKEHOLDER_GROUP_NAME)), '') NOT IN ('outside investors', 'outside investor'))), spa_cov AS (SELECT DISTINCT MATCHED_INV_NAME AS INV_NAME FROM spa_fuzzy WHERE RN = 1 AND MATCHED_INV_NAME IS NOT NULL) SELECT (SELECT COUNT(*) FROM spa_cov) AS SPA_COMPANIES, (SELECT COUNT(*) FROM cap_cov) AS CAP_COMPANIES, (SELECT COUNT(*) FROM spa_cov WHERE INV_NAME IN (SELECT INV_NAME FROM cap_cov)) AS BOTH_COMPANIES, (SELECT COUNT(*) FROM (SELECT INV_NAME FROM spa_cov UNION SELECT INV_NAME FROM cap_cov)) AS COVERED_COMPANIES, (SELECT COUNT(*) FROM norm_investments_base) AS TOTAL_COMPANIES"
}})
```

Tell the user: `SPA and cap table data loaded. Preparing results…`

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="data_fetched")`.

### Step B3: Present results

**Coverage line — always include** (numbers from QC):
"**X** companies from SPAs only, **Y** from cap tables only, **Z** from both, **A** covered in total, of your **N** priced-equity portfolio companies."

QC returns overlapping counts, so derive the three disjoint numbers from its columns:
X = `SPA_COMPANIES` − `BOTH_COMPANIES`, Y = `CAP_COMPANIES` − `BOTH_COMPANIES`,
Z = `BOTH_COMPANIES`, A = `COVERED_COMPANIES`. X + Y + Z = A always; check it before
you print the line, and re-run QC rather than adjusting a number if it fails.

> **What the numbers mean:** X is the portfolio companies (from your SOI) with at
> least one matching SPA in Carta and no shared cap table; Y is those with a shared
> detailed cap table that lists investor holders and no SPA; Z is those with both;
> A is those with either, so the three groups never overlap and a company in both
> counts once. Companies with several SPAs count once. SPAs whose issuer name
> doesn't match a current portfolio company are excluded. N is the priced-equity
> portfolio companies.

#### Q1 output

> **<Firm name> — Most frequent co-investors**
> (<coverage line>)
> *Co-investment counts are per company, not per round, and count each company
> once whether the investor appears on its SPAs, its cap table, or both.
> Multi-vehicle investors are aggregated to a single canonical entry per the
> groupings in `canonical-investors.json`.*

| Co-investor | Companies | Entity type | Portfolio companies |
|---|---|---|---|
| [Name] | [N] | [type, or — when only a cap table names them] | Co. 1, Co. 2, Co. 3 |

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

Start with one muted line under the company name: "From SPAs", "From cap table", or "From SPAs and cap table".

When Q4b returned rows, show current holders first:

> **<Firm name> — <Company name>, current holders**

| Investor | Current fully diluted ownership |
|---|---|
| [Investor, per merge rule 2] | [X.X%] |

Q4b rows are one per stakeholder; resolve each to its investor with merge rule 2 and add up only the rows that resolve to the same investor (a shared label such as "Fund GP" is not an investor), and mark the firm's own vehicles **(You)**. Then, for each SPA round (grouped by `EXTRACTION_ID`), render a separate section:

> **<Firm name> — <Company name>, <Share class>** (Closing: <date or —>)
> <N> investors | Total raised: <amount in CURRENCY>

| Investor | Entity type | Shares | Amount paid | % of round |
|---|---|---|---|---|
| [Your fund] **(You)** | [type] | [N] | [amount in CURRENCY] | [X.X%] |

Amounts take the round's `CURRENCY` column (see **Currency** under Typography). Rounds in different currencies get separate totals.

When Q4b returned rows, end with a small **Past investors** heading listing the SPA purchasers (other than the firm's own vehicles) whose compact key (as Q1 groups) matches no current holder's. They still count as co-investors. Skip the heading when Q4b returned nothing: with no cap table to compare against, nobody is "past".

[View SPA source documents in Carta](<base_url>/investors/firm/<firm_carta_id>/portfolio/documents/)

If no SPA and no cap table match: "No SPA or cap table found for '[name]'. Did you mean one of these? [list closest matches from available issuers]"

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

> **Checkpoint on every stop in this table**: call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_failed", notes="<one-line reason>")` instead of `skill_finished`. `skill_finished` means a report or answer reached the user; a stop that delivered neither is a failure, and counting it as finished makes failed runs look like fast successful ones. Rows that recover and continue (a retry, a fall-through to Mode B) do not checkpoint.

| Scenario | Response |
|---|---|
| `list_contexts` returns nothing | "I couldn't find any Carta data for your account. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative." |
| `firm_id` fails pre-flight UUID check | "Could not determine your firm ID. Try reconnecting to the Carta MCP server. If you believe you're already connected, contact your Carta representative." |
| 401/403 from any DWH query | "Your Carta session has expired. Reconnect to the Carta MCP server and try again." |
| Query fails with table-not-found | Call `dwh:list:tables` to confirm available table names, then retry with correct names. |
| 0 SPA rows returned | Continue with cap tables alone if any returned rows. If neither source has rows: "No SPA documents or detailed cap tables were found for your account. Contact your Carta representative if you believe this is an error." |
| 0 cap table rows for a company, or for the whole firm | Normal, not an error: the company has not granted Detailed cap table access. Use SPAs only for it, say nothing about access unless asked, and do not retry. |
| Company name not found (Q4) | "No SPA or cap table found for '[name]'. Did you mean: [suggestions from available issuers]?" |
| Partial coverage | Show the coverage line (X companies from SPAs only, Y from cap tables only, Z from both, A covered in total). Offer to list missing companies. |
| MCP query error | "Could not reach Carta data. Try again in a moment." |
| `render-artifact.py` exits non-zero | Surface the script's stderr and stop. Never hand-write the artifact HTML. |
| No `Artifact` tool, even after Step A1 tried to load it | Go to Mode B, opening with Step A1's sentence on why the answer is text. |
| Artifact publishes but renders an error | That error is the page's own and names its cause. Do not re-run Mode A blind; read what the viewer sees first. |
