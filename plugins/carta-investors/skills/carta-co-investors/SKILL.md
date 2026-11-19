---
name: carta-co-investors
description: >
  Interactive co-investor report from Carta SPA and cap table data with
  clickable portfolio drill-downs. Use for co-investor analysis or asking who invested in a
  specific portfolio company — including a quick one-company answer ("who else is in [Company]").
  Trigger phrases: "co-investors", "coinvestors", "who are my co-investors",
  "who else invested", "who else is in [Company]", "other investors in [Company]",
  "who else is on the cap table", "syndicate on [Company]'s round",
  "who syndicated [Company]'s round",
  "co-investors by stage/round", "co-investors on Aumni".
  Use instead: carta-explore-data for general fund/investment/portfolio data, single
  round facts ("who led [Company]'s Series B") and the firm's own syndicate SPVs (listing entities) —
  this skill is specifically for co-investor ("who else invested alongside us")
  analysis. For SPA coverage (which investments are missing an SPA or an executed
  SPA), use carta-spa-audit — also when the same request asks for co-investors.
version: 0.8.12
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
  # Interaction
  - AskUserQuestion
  - ToolSearch
  # Hand-off for SPA coverage asked in the same request
  - Skill(carta-investors:carta-spa-audit)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.53.9</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) record `skill_failed` as Error handling describes, and stop. Don't search the disk for them.

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
   A name is also a vehicle when it spells one of the firm's funds with the same
   words in another order (at least three words, "Fund", numerals and legal suffix
   aside), or when it starts with the leading words of the firm's name that at
   least three of the firm's funds also start with ("Fvlcrum Partners" for the firm
   "FVLCRUM Funds").
   The firm's team is excluded the same way: anyone holding carry in the firm's own
   GP entities (`FUND_ADMIN.GP_ENTITY_MEMBER_CARRY_PERCENTAGES`, read by the
   artifact's Query P), matched by the same name, or by a person's first and last
   name both appearing in a name of five words or fewer. They invest on the side, so
   they are the firm's team and not co-investors. Other individuals still count. A
   firm whose carry holders the account cannot read keeps the full list.
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

Users who need a WCAG-compliant text view can ask for text ("just tell me", "no file", "quick summary"), which Step 2 routes to Mode B.

---

## When to use

- "Who are my most frequent co-investors?"
- "Show me an interactive co-investor report"
- "Who co-invested with me most often?"
- "Who are my most frequent co-investors with more than 5% of a round?"
- "Who co-invested in [Company Name]?"

**SPA coverage is a different skill.** When the request also asks which investments are missing an SPA, whether SPAs are executed or signed, or for an SPA audit — e.g. "Which of our investments are missing an executed SPA? Run the co-investor skill as well" — that part belongs to `carta-spa-audit`. Run this skill for the co-investor part, then run `Skill('carta-investors:carta-spa-audit')` for the SPA part. Do not answer SPA coverage from this skill's SPA queries: they read purchasers, not whether each investment's SPA is on file and executed.

---

## Step 0: Announce

Open every invocation with:

> "I'll pull together who co-invests alongside you across your portfolio, using the SPAs uploaded to Carta and the detailed cap tables your portfolio companies share. Fund vehicles are normalized so each firm counts once."

Then proceed immediately to Step 1.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_started")` before proceeding. `<SERVER>` is the MCP server name you're using for `list_contexts` in this session.

Each run records each checkpoint at most once, and exactly one of `skill_finished` or `skill_failed`. A step reached again later in the same run (a re-render, a follow-up, a drill-down, a re-publish) does not checkpoint again.

---

## Step 1: Establish firm context

> **Every stop in this step** records `skill_failed` first, as Error handling describes: the run delivered nothing, and a stop that records nothing drops out of the usage stats.

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

> **ALWAYS build the interactive artifact (Mode A) for a general co-investor request.** It is the required output, not a preference. Do not read a question as a request for a quick table: "Who are my co-investors?", "Who co-invested with me most often?" and "Who else invested alongside us?" are all answered by the report's ranked co-investor table.

A large portfolio, many entities or many SPAs is not a reason for text. The page pages its own queries and never routes rows through your context.

Route to **text analysis (Mode B)** only for these explicit signals:

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
> - Do **not** hand-write or edit the artifact HTML, including its paging, even to fix a problem the viewer reports. Every render goes through `render-artifact.py`.
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

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_finished")` as soon as the publish above has succeeded, before the confirmation below. Mode A has no `data_fetched` checkpoint — the page fetches its own data after your turn ends.

### Step A4: Confirm

> Your co-investor analysis for **<Firm Name>** is ready: [Open <Firm Name> — Co-Investor Analysis](<url the publish returned>)

Fill the link with the `url` the publish call returned. The side panel does not always open by itself, and this link is how the user reaches the page when it stays closed, so never say the page is loading or open in the sidebar.

Then a 3–5 bullet summary of what it shows — most frequent co-investors ranked by shared portfolio companies, fund vehicles normalized so each firm counts once, click any company to see its current holders (where a cap table is shared) and the round-by-round investor breakdown, filter by live or exited positions or by source (SPAs or cap tables), hide individual investors, and see how many companies each source covers. Keep it brief; the customer can see the artifact. Skip the bullets on re-invocation if you've already shown them.

**Cross-skill follow-up.** When coverage is visibly incomplete, append: *"Coverage here is only as complete as the SPAs on file and the cap tables shared with you — run the `carta-spa-audit` skill to see which portfolio companies are missing an SPA."*

> **Numbers live in the artifact, not in your reply.** Do not restate co-investor counts, coverage percentages, or company names in chat — you have not seen them. The page queries Carta after your turn ends, so any figure you quote is invented.

---

## Mode B — Text analysis

When Step 2 routes to Mode B, read
`${CLAUDE_PLUGIN_ROOT}/skills/carta-co-investors/references/text-analysis.md` (this skill's own
`references/`; read it by that exact path, do not search for it) and follow its Steps B0–B4: the
Q1–Q4b and QC queries and how to present each answer. This plugin's root is
`${CLAUDE_PLUGIN_ROOT}`: wherever that file writes `<plugin_root>`, write this path out in full.
Mode A never needs that file.

---

## Error handling

> **Checkpoint on every stop before this run has recorded `skill_finished`**, whether or not this table lists it: call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_failed", notes="<one-line reason>")` instead of `skill_finished`. `skill_finished` means a report or answer reached the user; a stop that delivered neither is a failure, and counting it as finished makes failed runs look like fast successful ones. Rows that recover and continue (a retry, a fall-through to Mode B) do not checkpoint.

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
| Artifact publishes but renders an error | That error is the page's own and names its cause. Do not re-run Mode A blind; read what the viewer sees first. A "too large" error is not a reason to change the page: it already sizes its own requests and retries smaller ones. Re-run Step A2 and A3 with the script's template unchanged. If the error returns, say the report couldn't load and stop. |
