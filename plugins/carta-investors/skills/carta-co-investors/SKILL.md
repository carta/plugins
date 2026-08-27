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
version: 0.7.1
model: sonnet
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__skill_checkpoint
  - mcp__claude_ai_carta__skill_checkpoint
  - mcp__Claude_Preview__preview_start
  - mcp__Claude_Preview__preview_list
  - mcp__Claude_Preview__preview_eval
  - AskUserQuestion
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
  - Bash(open *)
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

- **Carta MCP connection** — `list_contexts` and `fetch` tools available; user has an active session for at least one investment firm.
- **SPA documents uploaded** — the firm has Stock Purchase Agreements in Carta's
  Document Intelligence; without them, Mode A will stop with a "no SPAs found"
  message.
- **`Bash` + `uv`** — Mode A runs `process.py` and `generate_artifact.py`.
  **A preview side panel is not a prerequisite.** Where one exists (Claude
  Desktop) the artifact opens in the panel; everywhere else (Cowork, Claude
  Code CLI, headless terminal) the identical artifact is written to a file and
  handed to the user. Only a runtime that cannot execute `uv` at all forces
  Mode B — and only the Step A0 probe may establish that.

## Accessibility

The interactive artifact generated by `generate_artifact.py` has **not yet been
formally audited for WCAG 2.1 AA compliance.** Known accessibility considerations:

- Color-only encoding is avoided (entity-type tags use both color and text labels)
- Tooltips are keyboard-focusable (`tabindex="0"`) with `aria-describedby`
- The drawer close button is a real `<button>` with an SVG icon
- Tables use proper `<thead>` / `<tbody>` semantics

Users who need a WCAG-compliant text view should request Mode B output explicitly
("just tell me", "no file", "quick summary").

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

> "I'll analyze co-investors across your portfolio using SPA data uploaded to
> Carta — pulling data across all your funds. I'll normalize fund vehicles so
> each firm counts once, and build the interactive report. Larger portfolios
> take a moment."

Then proceed immediately to Step 1.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_started")` before proceeding. Use the same MCP server name (`carta` or `claude_ai_carta`) that you're using for `list_contexts` in this session.

---

## Step 1: Establish firm context

1. Call `list_contexts` to get the firm UUID and display name.
2. If nothing returned → stop with: "I couldn't find any Carta data associated
   with your account. Try reconnecting to the Carta MCP server. If you believe
   you're already connected, contact your Carta representative."
3. Call `call_tool({"name": "fa__list__entities", "arguments": {}})` and extract:
   - `firm_carta_id` from any entity in the response — the integer PK used in
     Carta web URLs.
   - `firm_vehicle_names` — collect the `name` of every entity returned. These
     are the firm's own fund vehicles. Use them as additional firm-exclusion
     patterns in Step A1 — without this, vehicles named differently from the
     parent firm slip into the co-investor results.
4. Store:
   - `<firm_id>` — the UUID (36-char string)
   - `<firm_name>` — display name from `list_contexts`
   - `<firm_carta_id>` — integer PK from `fa:list:entities`
   - `<firm_vehicle_names>` — array of fund vehicle name strings
5. Resolve `<base_url>` from the current Carta MCP server URL — never hardcode
   an environment URL. For the production MCP server (`mcp.app.carta.com`),
   `<base_url>` is `https://app.carta.com`. For any other MCP server URL,
   default to `https://app.carta.com` as well.

**Pre-flight check:** before any DWH query, confirm that `<firm_id>` is a
non-empty UUID string (matches pattern `[a-f0-9-]{36}`). If not, stop with:
"Could not determine your firm ID. Try reconnecting to the Carta MCP server.
If you believe you're already connected, contact your Carta representative."

Tell the user: `Firm context loaded: <firm_name>. Fetching SPA data…`

---

## Step 2: Route

**The default output of this skill is the interactive artifact. Proceed directly to Step A0.**

Only route to **text-only analysis (Mode B)** if the user explicitly signals they want text:
- Says "text only", "no file", "just tell me", or "quick summary" → Q1
- Mentions a specific company by name → Q4
- Mentions ">5%", "over 5%", "lead", or "leads" → Q2
- Mentions "<5%", "less than 5%", "under 5%", or "follow-on" → Q3

**Everything else — including any general request about co-investors — goes to Step A0.**

> **Environment is never a routing reason here.** Do not route to Mode B because you believe this
> session lacks the scripts, `uv`, a local file system, or a preview panel. That judgement belongs
> to Step A0's probe, which runs a command and reports facts. Go to Step A0 and let it decide.

---

## Mode A — Interactive artifact

Generate a self-contained interactive HTML file showing the firm's most frequent
co-investors. Each portfolio company in the table is clickable — clicking it opens
a right-side drawer with the full investor breakdown for that company (investors,
% of round, amount paid).

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

Resolve a stable, cross-platform working directory once before fetching.
The intermediate response files and the final HTML artifact all live under
`$WORKSPACE`. **Both the Claude process AND the preview-panel host must be
able to read this path** — on Cowork demo VMs running macOS 26.5+ the host
can no longer see `~/.cache/...` or `/tmp/...`. The probe below picks the
right path automatically: Cowork sandboxes get `$HOME/mnt/outputs/` (the
bind-mounted session outputs dir, visible from both VM and host), regular
Claude Code CLI laptops get `carta workspace cache`, and anything else
falls back to `$TMPDIR`.

```bash
# --- Workspace probe -------------------------------------------------
if [ -d "${HOME}/mnt/outputs" ] && [ -w "${HOME}/mnt/outputs" ]; then
  # Cowork sandbox: $HOME is the session root (/sessions/<name>) and
  # mnt/outputs/ is the bind mount the macOS host sees as
  # ~/Library/Application Support/Claude/.../outputs/. Writes here are
  # readable by both the sandboxed Claude process and the host
  # preview-panel process.
  WORKSPACE="${HOME}/mnt/outputs/carta-co-investors"
elif command -v carta >/dev/null 2>&1; then
  # Regular Claude Code CLI on a developer laptop.
  WORKSPACE=$(carta workspace cache carta-co-investors | jq -r .)
else
  # Last-resort fallback (e.g. CI / hosted runtimes without Carta CLI).
  WORKSPACE="${TMPDIR:-/tmp}/carta-co-investors"
fi
mkdir -p "$WORKSPACE"

# --- Candidate plugin roots -------------------------------------------
# Claude Code CLI exports CLAUDE_PLUGIN_ROOT and substitutes it inline in
# skill content. Cowork's harness does neither, so a literal reference
# would resolve to an empty string or a host-side macOS path the sandbox
# can't read. Cowork also bind-mounts plugins under BOTH .remote-plugins
# (marketplace installs) and .local-plugins (side-loaded / dev installs).
# Search every root before concluding anything is missing.
# Positional params, not a space-joined string: zsh does not word-split an
# unquoted variable, so `for r in $ROOTS` would iterate once over the whole
# string and find nothing.
set -- "${CLAUDE_PLUGIN_ROOT:-}" \
       "${HOME}/mnt/.remote-plugins" \
       "${HOME}/mnt/.local-plugins" \
       "${HOME}/.claude/plugins" \
       "${HOME}/.carta/claude-marketplace/plugins"

# --- carta-co-investors' own install dir ------------------------------
# Match on CONTENT, not name: a directory called carta-co-investors also
# exists under $WORKSPACE, so a name-only find can return the output dir
# and every later `uv run …/scripts/process.py` fails.
SKILL_DIR=""
for r in "$@"; do
  [ -n "$r" ] && [ -d "$r" ] || continue
  hit=$(find "$r" -maxdepth 6 -type d -name carta-co-investors -exec test -f {}/scripts/process.py \; -print 2>/dev/null | head -1)
  if [ -n "$hit" ]; then SKILL_DIR="$hit"; break; fi
done

# --- Record the result for later steps --------------------------------
# Env vars do NOT survive across Bash tool calls; this file does.
UV_OK=no; command -v uv >/dev/null 2>&1 && UV_OK=yes
jq -n --arg workspace "$WORKSPACE" --arg skillDir "$SKILL_DIR" --arg uv "$UV_OK" \
  '{workspace:$workspace, skillDir:$skillDir, uv:$uv}' \
  | tee "$WORKSPACE/.toolchain.json"
```

Read the printed JSON and act on it:

| Probe result | Meaning | Do this |
|---|---|---|
| `uv: "yes"` and `skillDir` non-empty | Full toolchain present | Continue to Step A1. Mode A is buildable — with or without a preview panel. |
| `skillDir` empty | Install path not found in the searched roots | Re-run the probe **once**, widened: `set -- "${HOME}" "${HOME}/mnt"` and `-maxdepth 8` on the find. Then apply this table again. |
| Still empty after that one re-run, or `uv: "no"` | Toolchain genuinely absent | Go to Mode B and tell the user plainly: *"I'll give you the co-investor analysis as text."* Say nothing about scripts, plugins, paths, or sandboxes. |

> **One re-run, then stop.** You get exactly **two** probe attempts total. Do not vary the `find`
> expression a third time, do not search additional roots one at a time, do not `ls` around looking
> for the plugin, and do not switch to `Glob`/`Read` to hunt for `process.py`. Two attempts, then
> Mode B.

Every later Bash call starts with this **standard preamble** — it re-resolves `$WORKSPACE` (env vars
do not persist across Bash tool calls) and reads back what this step recorded:

```bash
# --- Standard preamble (paste at the top of every Mode A Bash call) ----
if [ -d "${HOME}/mnt/outputs" ] && [ -w "${HOME}/mnt/outputs" ]; then
  WORKSPACE="${HOME}/mnt/outputs/carta-co-investors"
elif command -v carta >/dev/null 2>&1; then
  WORKSPACE=$(carta workspace cache carta-co-investors | jq -r .)
else
  WORKSPACE="${TMPDIR:-/tmp}/carta-co-investors"
fi
SKILL_DIR=$(jq -r .skillDir "$WORKSPACE/.toolchain.json")
```

All file paths below assume this `$WORKSPACE`. Do not hardcode `/tmp` — it
breaks on Windows and is invisible to the Cowork host on macOS 26.5+.

### Step A1: Fetch SPA data

Run **three** server-aggregated DWH queries, all with `"format": "ndjson"` and `"response_mode": "inline"`.

> **`response_mode: "inline"` is load-bearing — do not remove it.** The server
> infers the delivery shape from `clientInfo.name`, and that name cannot
> distinguish the Claude Code CLI (which accepts a binary blob) from other
> runtimes that share the same name but reject the blob with `-32602 invalid_union`.
> `inline` forces the always-safe plain-string path for every client. Removing it
> restores the broken inference and the skill fails immediately in Cowork.
**Fire them in parallel — issue all three `fetch` calls in the SAME turn** (three
tool calls in one assistant message) so they run concurrently. They are fully
independent (Query S = co-investors, Query R = per-company rounds, Query T =
live/exited status) and each is a single fetch, so there is nothing to chain. Do
**not** wait for one query's blob to return before issuing the next — firing them
sequentially triples the wait (the fetch phase should take `max(S, R, T)`, not
`S + R + T`).

**How the ndjson response is delivered (important — read before fetching):**
With `format: "ndjson"`, carta-mcp returns a JSON object of shape
`{"result": "<ndjson body>"}`. How that reaches you depends on size, and
**both paths are normal** — do not treat either as an error:

- **Small results come back inline** in the tool result. Nothing is written to
  disk and there is no path to resolve.
- **Large results overflow the context window**, and the client harness
  persists the whole tool result to a file, reporting it as:

  > `Output has been saved to <ABSOLUTE_PATH>`

  That file is the **JSON envelope**, not raw ndjson — its first character is
  `{` and the ndjson lives inside the `result` string. `process.py` unwraps
  this automatically; you do not need to transform it.

When you get a path, capture it and resolve it with `resolve_blob`. Define the function in the same
Bash call that uses it — a shell function does not survive to the next Bash tool call any more than
an env var does:

```bash
# --- Blob path resolver ----------------------------------------------
# An offloaded tool result is written to a host path. On Claude Code CLI
# bash runs on the host, so the saved path is directly readable. In the
# Cowork sandbox bash can't see the macOS host path (/var/folders/…), but
# the SAME file is exposed read-only at a bindfs mount under
# $HOME/mnt/.claude/projects/ — locate it by basename.
# Prints the readable path and returns 0, or prints nothing and returns 1.
resolve_blob() {
  saved="$1"
  if [ -r "$saved" ]; then echo "$saved"; return 0; fi
  hit=$(find "${HOME}/mnt/.claude/projects" -name "$(basename "$saved")" 2>/dev/null | head -1)
  if [ -n "$hit" ] && [ -r "$hit" ]; then echo "$hit"; return 0; fi
  return 1
}

QUERY_S_BLOB=$(resolve_blob "<query_s_saved_path>")
QUERY_R_BLOB=$(resolve_blob "<query_r_saved_path>")
QUERY_T_BLOB=$(resolve_blob "<query_t_saved_path>")
```

Pass the resolved paths straight to `process.py` in Step A2. **Do not `Write`
the bodies** — they're already on disk, and re-emitting them through the
model defeats the whole point of ndjson (keeping the payload out of context).

**If a query came back inline instead** (small result, no path reported —
see the two delivery paths above), there is nothing to resolve: `Write` that
one body verbatim to `$WORKSPACE/query-s.ndjson` (or `query-r.ndjson`) and
pass that path to Step A2 instead. This is the one case where writing a body
is correct, because it is already in context — never do it for a response
that was saved to a path.

**Never change `format` to work around a failure.** `ndjson` is the only
format `process.py` parses; switching to `plain`/`markdown` produces a report
built on a different code path with no guarantee the numbers are right. If
ndjson will not work after the one retry below, stop with the failure message
below — a stopped report is recoverable, a silently wrong one is not.

**If `resolve_blob` returns non-zero** (the saved file couldn't be located —
rare), re-run that one query once and resolve again. This is an internal
retry — do **not** narrate paths, "blob", "sandbox", or any other
mechanics to the user, and do **not** ask the user anything. If it still
fails after the retry, stop with this plain message and nothing else:

> "I couldn't load your SPA data just now. Try running the report again in
> a moment. If it keeps happening, contact your Carta representative."

**Why three queries, not more:** Snowflake does all aggregation (canonical grouping
happens in Python, but per-round/per-company nesting and coverage counts happen
server-side). This collapses ~700 raw investor-round rows into ~30–40 nested rows,
removing the batched-alphabetic split the prior version relied on.

**Build these substitutions first:**
- `<firm_name_esc>` — escape single quotes in `<firm_name>` (replace `'` with `''`)
- `<firm_name_spaced>` — insert a space before each uppercase letter that follows
  a lowercase letter (e.g. `"AcmeVentures"` → `"Acme Ventures"`). Only add the
  corresponding ILIKE clause if the result differs from `<firm_name_esc>`.
- For each name in `<firm_vehicle_names>`, escape single quotes to get `<vehicle_N_esc>`.

Items in `[...]` below are conditional — include only when the substituted
value is non-empty and differs from the `<firm_name_esc>` clause.

---

#### Step A1.0: Build `<CANONICAL_CASE>`

Queries Q1–Q3 substitute a `<CANONICAL_CASE>` expression that collapses one
firm's many fund vehicles into a single canonical row. Build it here, before
any query that needs it. **Mode B also needs it** — Q1–Q3 run this step even
when Mode A was never invoked.

Read `$SKILL_DIR/canonical-investors.json`. It is an object with one key,
`groupings`, holding a list of `{canonical, patterns}` entries, where
`patterns` are SQL `ILIKE` patterns matched against the raw purchaser name.
Emit one `WHEN` per grouping, preserving file order (first match wins), then
fall through to the raw name:

```
CASE
  WHEN p.PURCHASER_NAME ILIKE '<pattern1>' OR p.PURCHASER_NAME ILIKE '<pattern2>' THEN '<canonical>'
  ...one WHEN per grouping, in file order...
  ELSE p.PURCHASER_NAME
END
```

Escape single quotes in both patterns and canonical names (`'` → `''`).

**Two substitution forms — use the right one.** Q1 substitutes
`<CANONICAL_CASE>` where an alias is required, so the expression must end
`... END AS CANONICAL_NAME`. Q2 and Q3 substitute `<CANONICAL_CASE> AS
CANONICAL_NAME`, so there the expression must end `... END` with **no** alias —
appending one produces a duplicate `AS` and a SQL compilation error.

> Generating this by hand is error-prone at ~29 groupings and ~2,700
> characters. Assemble it programmatically from the JSON rather than
> transcribing it, and never abbreviate the pattern list — a dropped `WHEN`
> silently splits one firm into several rows.

---

**Query S** — all purchasers (ranked by number of shared companies), with SPA
coverage and total-company counts embedded in every row. Returns one row per
purchaser; large firms can have thousands of rows.

**Fetch it in ONE call — do NOT paginate.** Pass `"format": "ndjson"` **and
`"limit": 10000`**, which is the server's maximum — it silently rewrites
anything larger down to 10,000 rather than erroring, so asking for more buys
nothing and hides the ceiling. Capture the saved path, if one is reported, and
resolve it to `$QUERY_S_BLOB` via the helper (above). Do not `Write` the
body.

> **CRITICAL — fetch ONCE; never re-issue this query with a different
> `offset`.** A single high-`limit` fetch returns everything, so there is no
> page 2. Do **not** re-run the query for "later pages." The reason this rule
> exists: when the model re-types this ~1,200-char SQL for a second call it
> reliably corrupts a token — the embedded firm UUID (`…8af6…` → `…8ad6…`) or
> even a JOIN key (`s.EXTRACTION_ID` → `s.CLOSING_DATE`, which errors with
> *"Date '<uuid>' is not recognized"*) — silently dropping rows or failing the
> call. One fetch means the SQL is authored exactly once and this whole class
> of error cannot happen.

> **If the row count ever exceeds the limit**, the response header carries a
> `next_offset` token. Raising `limit` will not help — 10,000 is the server
> cap. `process.py` detects `next_offset` and aborts rather than emitting a
> report that silently under-reports, so do **not** work around it by adding
> `offset` pages. Treat it as a data anomaly and say only:
>
> > "There's more co-investor data here than this report can show in one pass.
> > Contact your Carta representative."


> **Why the ORDER BY has a tiebreaker:** Query S ends with
> `ORDER BY COUNT(DISTINCT cc.CANONICAL_NAME) DESC, p.PURCHASER_NAME, p.ENTITY_TYPE`.
> The leading count is not unique (many purchasers tie); the trailing
> `p.PURCHASER_NAME, p.ENTITY_TYPE` (the GROUP BY key) makes the order total
> and deterministic. Keep it.

> **Why the `norm_investments` / `norm_spa` / `canonical_company` CTEs:** SPA
> issuer names and SOI investment names rarely match exactly — "Apogee" in
> the SOI, "Apogee Systems, Inc." on the SPA. And SPAs for the same portfolio
> company often appear under multiple casings ("PIE Group Holdings, Inc.",
> "PIE GROUP HOLDINGS, INC.", "Pie Group Holdings, Inc.") across rounds.
> The CTE chain applies the same regex normalization as the SPA-audit skill
> (strip parentheticals, d/b/a phrases, common suffixes like Inc/LLC/Ltd/Corp/
> LP/Holdings/Technologies, punctuation) then fuzzy-matches SPA issuers to
> equity investments with **Snowflake's `JAROWINKLER_SIMILARITY >= 90`**.
> Each SPA issuer's canonical name = the matched SOI name when it exists,
> else the best-cased raw SPA spelling. Downstream — chip column, per-investor
> company count, per-company round dedup, coverage % — all key off that
> canonical name so one portfolio company stays one row regardless of how
> the SPA spelled it. The `norm_investments` CTE also enforces the shared
> **equity-only universe** (`ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY',
> 'COMMON_EQUITY')`) so the co-investor and SPA-audit skills report the same
> coverage denominator for a given firm.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "response_mode": "inline",
  "limit": 10000,
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, ATTRIBUTES:name::VARCHAR AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR AS PURCHASER_NAME, ATTRIBUTES:entity_type::VARCHAR AS ENTITY_TYPE, ATTRIBUTES:share_class_name::VARCHAR AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:total_amount_paid::NUMBER(38,2) AS TOTAL_AMOUNT_PAID FROM spa_rec WHERE RECORD_TYPE = 'investor'), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(ATTRIBUTES:effective_date::VARCHAR) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), norm_investments AS (SELECT ISSUER_NAME AS INV_NAME, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), ',? *(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L[.]P[.]|LP|PBC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]? *$', '')), '[,.]', '')) AS NAME_NORM FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' GROUP BY ISSUER_NAME HAVING MAX(CASE WHEN ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') THEN 1 ELSE 0 END) = 1), norm_spa AS (SELECT DISTINCT i.ISSUER_NAME AS SPA_NAME, LOWER(TRIM(i.ISSUER_NAME)) AS NORM_KEY, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(i.ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), ',? *(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L[.]P[.]|LP|PBC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]? *$', '')), '[,.]', '')) AS NAME_NORM FROM spa_issuer i WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> ''), spa_fuzzy AS (SELECT s.SPA_NAME, s.NORM_KEY, i.INV_NAME AS MATCHED_INV_NAME, ROW_NUMBER() OVER (PARTITION BY s.SPA_NAME ORDER BY JAROWINKLER_SIMILARITY(s.NAME_NORM, i.NAME_NORM) DESC NULLS LAST) AS RN FROM norm_spa s LEFT JOIN norm_investments i ON JAROWINKLER_SIMILARITY(s.NAME_NORM, i.NAME_NORM) >= 90), canonical_company AS (SELECT NORM_KEY, COALESCE(MIN(MATCHED_INV_NAME), MAX(SPA_NAME)) AS CANONICAL_NAME FROM spa_fuzzy WHERE RN = 1 GROUP BY NORM_KEY), doc_metadata AS (SELECT i.EXTRACTION_ID, cc.CANONICAL_NAME AS ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i JOIN canonical_company cc ON LOWER(TRIM(i.ISSUER_NAME)) = cc.NORM_KEY LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> '' GROUP BY i.EXTRACTION_ID, cc.CANONICAL_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), coverage AS (SELECT (SELECT COUNT(*) FROM norm_investments ni WHERE EXISTS (SELECT 1 FROM spa_fuzzy sf WHERE sf.RN = 1 AND sf.MATCHED_INV_NAME = ni.INV_NAME)) AS SPA_COMPANIES, (SELECT COUNT(*) FROM norm_investments) AS TOTAL_COMPANIES) SELECT p.PURCHASER_NAME, p.ENTITY_TYPE, ARRAY_AGG(DISTINCT cc.CANONICAL_NAME) WITHIN GROUP (ORDER BY cc.CANONICAL_NAME) AS COMPANIES, (SELECT SPA_COMPANIES FROM coverage) AS SPA_COMPANIES, (SELECT TOTAL_COMPANIES FROM coverage) AS TOTAL_COMPANIES FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN canonical_company cc ON LOWER(TRIM(i.ISSUER_NAME)) = cc.NORM_KEY JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID WHERE p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_esc>%' [AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%'] [AND p.PURCHASER_NAME NOT ILIKE '%<vehicle_N_esc>%' ...] GROUP BY p.PURCHASER_NAME, p.ENTITY_TYPE ORDER BY COUNT(DISTINCT cc.CANONICAL_NAME) DESC, p.PURCHASER_NAME, p.ENTITY_TYPE"
}})
```

---

**Query R** — one row per portfolio company. The `ROUNDS_JSON` column is a
compact JSON string produced by `TO_JSON(ARRAY_AGG(OBJECT_CONSTRUCT(...)))`,
nesting up to 15 investors per round, ordered by % of round descending. Short
keys (`n`, `t`, `p`, `a`, `f`, `sc`, `cd`, `inv`) keep the payload small.

Same as Query S — **one fetch** with `"format": "ndjson"` and `"limit": 10000`
(never paginate; the fetch-once rule above applies here too). Capture the
saved path if one is reported, resolve it to `$QUERY_R_BLOB`. Do not `Write` the body.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "response_mode": "inline",
  "limit": 10000,
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, ATTRIBUTES:name::VARCHAR AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR AS PURCHASER_NAME, ATTRIBUTES:entity_type::VARCHAR AS ENTITY_TYPE, ATTRIBUTES:share_class_name::VARCHAR AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:total_amount_paid::NUMBER(38,2) AS TOTAL_AMOUNT_PAID FROM spa_rec WHERE RECORD_TYPE = 'investor'), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(ATTRIBUTES:effective_date::VARCHAR) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), norm_investments AS (SELECT ISSUER_NAME AS INV_NAME, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), ',? *(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L[.]P[.]|LP|PBC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]? *$', '')), '[,.]', '')) AS NAME_NORM FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' GROUP BY ISSUER_NAME HAVING MAX(CASE WHEN ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') THEN 1 ELSE 0 END) = 1), norm_spa AS (SELECT DISTINCT i.ISSUER_NAME AS SPA_NAME, LOWER(TRIM(i.ISSUER_NAME)) AS NORM_KEY, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(i.ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D/?B/?A|F/?K/?A|AKA) +.*$', '')), ',? *(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L[.]P[.]|LP|PBC|CO[.]?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY)[.]? *$', '')), '[,.]', '')) AS NAME_NORM FROM spa_issuer i WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> ''), spa_fuzzy AS (SELECT s.SPA_NAME, s.NORM_KEY, i.INV_NAME AS MATCHED_INV_NAME, ROW_NUMBER() OVER (PARTITION BY s.SPA_NAME ORDER BY JAROWINKLER_SIMILARITY(s.NAME_NORM, i.NAME_NORM) DESC NULLS LAST) AS RN FROM norm_spa s LEFT JOIN norm_investments i ON JAROWINKLER_SIMILARITY(s.NAME_NORM, i.NAME_NORM) >= 90), canonical_company AS (SELECT NORM_KEY, COALESCE(MIN(MATCHED_INV_NAME), MAX(SPA_NAME)) AS CANONICAL_NAME FROM spa_fuzzy WHERE RN = 1 GROUP BY NORM_KEY), doc_metadata AS (SELECT i.EXTRACTION_ID, cc.CANONICAL_NAME AS ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i JOIN canonical_company cc ON LOWER(TRIM(i.ISSUER_NAME)) = cc.NORM_KEY LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' GROUP BY i.EXTRACTION_ID, cc.CANONICAL_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), investor_rows AS (SELECT cc.CANONICAL_NAME AS ISSUER_NAME, p.SHARE_CLASS_NAME, s.CLOSING_DATE, dd.EXTRACTION_ID, p.PURCHASER_NAME, p.ENTITY_TYPE, p.SHARES_PURCHASED, p.TOTAL_AMOUNT_PAID, p.SHARES_PURCHASED / NULLIF(SUM(p.SHARES_PURCHASED) OVER (PARTITION BY dd.EXTRACTION_ID), 0) AS PCT_OF_ROUND, CASE WHEN p.PURCHASER_NAME ILIKE '%<firm_name_esc>%' [OR p.PURCHASER_NAME ILIKE '%<firm_name_spaced>%'] [OR p.PURCHASER_NAME ILIKE '%<vehicle_N_esc>%' ...] THEN TRUE ELSE FALSE END AS IS_FIRM, ROW_NUMBER() OVER (PARTITION BY dd.EXTRACTION_ID ORDER BY p.SHARES_PURCHASED DESC NULLS LAST) AS RN FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN canonical_company cc ON LOWER(TRIM(i.ISSUER_NAME)) = cc.NORM_KEY JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID LEFT JOIN spa_deal s ON dd.EXTRACTION_ID = s.EXTRACTION_ID WHERE p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%'), per_round AS (SELECT ISSUER_NAME, SHARE_CLASS_NAME, CLOSING_DATE, EXTRACTION_ID, ARRAY_AGG(OBJECT_CONSTRUCT('n', PURCHASER_NAME, 't', ENTITY_TYPE, 'p', ROUND(PCT_OF_ROUND, 4), 'a', TOTAL_AMOUNT_PAID, 'f', IS_FIRM)) WITHIN GROUP (ORDER BY PCT_OF_ROUND DESC NULLS LAST) AS INVESTORS FROM investor_rows WHERE RN <= 15 GROUP BY ISSUER_NAME, SHARE_CLASS_NAME, CLOSING_DATE, EXTRACTION_ID) SELECT ISSUER_NAME, TO_JSON(ARRAY_AGG(OBJECT_CONSTRUCT('sc', SHARE_CLASS_NAME, 'cd', CLOSING_DATE, 'inv', INVESTORS)) WITHIN GROUP (ORDER BY CLOSING_DATE DESC NULLS LAST)) AS ROUNDS_JSON FROM per_round GROUP BY ISSUER_NAME ORDER BY ISSUER_NAME"
}})
```

> The `RN <= 15` cap keeps the per-round investor list bounded. The long
> tail past the 15th investor has near-zero percentage of round and is
> not rendered prominently in the drill-down view.

Query R is one row per portfolio company (10s–100s of rows even for large
firms), so the single `"limit": 10000` fetch always covers it in one call —
the same fetch-once rule as Query S. Never re-issue it with an `offset`.

**Query T** — one row per equity investment: `ISSUER_NAME` and `IS_ACTIVE_INVESTMENT`.
Fired in parallel with S and R (issue all three fetches in the same assistant turn).
Produces the `companyStatus` map that powers the Live / Exited filter in the artifact.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "response_mode": "inline",
  "limit": 50000,
  "sql": "SELECT ISSUER_NAME, IS_ACTIVE_INVESTMENT FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' AND ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY') AND ISSUER_NAME IS NOT NULL ORDER BY ISSUER_NAME"
}})
```

Capture the `saved to …` path, resolve it to `$QUERY_T_BLOB` via the helper.
Do not `Write` the body. Apply the same fetch-once rule as S and R.

If Query S returns 0 rows: stop with "No SPA documents were found for your account.
Contact your Carta representative if you believe this is an error."

Tell the user: `SPA data loaded. Assembling report…`

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="data_fetched")`.

### Step A2: Assemble JSON

Run this in the **same Bash call** as the blob resolution above, prefixed by the standard preamble
from Step A0 — `$QUERY_S_BLOB`, `$SKILL_DIR`, and `$WORKSPACE` are all empty in a fresh shell:

```bash
uv run "$SKILL_DIR/scripts/process.py" \
  --summary "$QUERY_S_BLOB" \
  --rounds  "$QUERY_R_BLOB" \
  --status  "$QUERY_T_BLOB" \
  --firm-name "<firm_name>" \
  --firm-carta-id "<firm_carta_id>" \
  --canonical "$SKILL_DIR/canonical-investors.json" \
  --out "$WORKSPACE/carta-co-investors-data.json"
```

The `--summary` / `--rounds` / `--status` inputs are the **resolved blob paths** from
Step A1 (`$QUERY_S_BLOB`, `$QUERY_R_BLOB`, `$QUERY_T_BLOB`), not files the skill wrote. Each
query is a single fetch, so pass **one** path per flag.
(All flags still accept multiple values — `process.py` concatenates them — but
with single-fetch queries there is only ever one blob per query, so do not
synthesize extra paths.) SPA-coverage counts ride on the Query S rows, and the
output (`carta-co-investors-data.json`) is written to `$WORKSPACE`.

- **Exit 0** — data written to `$WORKSPACE/carta-co-investors-data.json`. Proceed.
- **Non-zero exit** — show the script's stderr output to the user and stop.

### Step A3: Generate HTML artifact

> **You MUST run `generate_artifact.py` to produce the HTML.** Do **not** write,
> compose, inline, or "improvise" HTML for the artifact under any
> circumstances. The template (`artifact-template.html`) is the single source
> of truth for the artifact's structure, styling, tile labels, the
> All / Live / Exited filter tabs, and interactive drawer behavior.
> Hand-written or model-generated HTML diverges from the design system, omits
> required tooltips and Ink tags, and has produced silent "Could not load
> data" failures in past sessions.

Start this Bash call with the standard preamble from Step A0, then:

```bash
uv run "$SKILL_DIR/scripts/generate_artifact.py" \
  --data "$WORKSPACE/carta-co-investors-data.json" \
  --title "<firm_name> — Co-investor analysis" \
  --out "$WORKSPACE/carta-co-investors.html"
```

The generated HTML stands on its own — the sortable co-investor table, the
entity-type tags, and the click-to-drill-down company drawer all work offline
from a browser, with or without a preview panel. The generator also drops a
`mcp-ui-tracker.global.js` bundle beside it for usage telemetry; every call
into it is optional-chained, so the artifact renders identically when the file
is opened without its sibling.

- **Exit 0** — proceed to Step A4.
- **Non-zero exit** — this is a real failure, not an environment guess. Show
  the script's stderr to the user in plain language and offer Mode B (text
  analysis). Do **not** fabricate an HTML file to fill the gap.

Tell the user: `Artifact generated. Opening your report…`

### Step A4: Deliver the artifact

**Two delivery surfaces, one artifact.** A preview side panel exists only in
Claude Desktop. Everywhere else the *same* HTML file — already written by Step
A3 — is handed to the user: Cowork opens a returned HTML file on its own, and a
browser opens it everywhere else. **A missing panel is not a missing artifact,
and it is never a reason to fall back to Mode B.**

Pick the surface once:

- Look through the tools already available to you for anything **ending in**
  `preview_start` / `preview_list` — a prefixed name (e.g.
  `mcp__Claude_Preview__preview_start`) is the same capability, not a different
  one.
- **Found** → Step A4a (panel).
- **Not found** → Step A4b (file).

#### Step A4a: Panel (Claude Desktop)

1. Read `.claude/launch.json` if it exists. Start with
   `{"version":"0.0.1","configurations":[]}` if it doesn't.
2. Upsert the co-investor config — add or replace any entry whose `name` starts
   with `carta-co-investors-`:

```json
{
  "name": "carta-co-investors-<firm_carta_id>",
  "runtimeExecutable": "uv",
  "runtimeArgs": [
    "run", "python",
    "<skill_dir>/scripts/preview_server.py",
    "--serve-dir", "<workspace_path>"
  ],
  "autoPort": true
}
```

> Substitute `<skill_dir>` with the literal `skillDir` Step A0 resolved.
> `launch.json` expands neither environment variables nor
> `${CLAUDE_PLUGIN_ROOT}`, so a placeholder written verbatim leaves the panel
> pointing at a path that does not exist.

> **Why `uv run python` and not a bare `python3` path?** Claude Desktop spawns
> `launch.json` processes outside a normal shell. Calling `python3` directly
> can trigger pyenv's shim and fail silently in some setups; an absolute Unix
> path like `/usr/bin/python3` doesn't exist on Windows. `uv` is installed on
> PATH by the Carta plugin installer on every platform and `uv run python`
> guarantees the right interpreter without environment leakage. Same pattern
> as the published `carta-form-adv` skill.

3. Write the merged config back to `.claude/launch.json`.
4. Call `preview_start`.
5. Call `preview_list` — find the entry matching `carta-co-investors-<firm_carta_id>`. Extract `port` and `serverId`.
6. Call `preview_eval` passing `serverId` as the target server parameter and this JavaScript:

```javascript
window.location.href = 'http://localhost:<port>/carta-co-investors.html';
```

> Substitute `<workspace_path>` with the value of `$WORKSPACE` resolved in
> Step A0. `launch.json` does not expand environment variables, so the path
> must be a literal string.

**If `preview_start` errors or the panel never navigates** — the surface check
was wrong about this session. Go to Step A4b and deliver the file. Do **not**
go to Mode B, and do not tell the user the panel was unavailable.

#### Step A4b: File (Cowork, Claude Code CLI, headless)

The artifact already exists at `$WORKSPACE/carta-co-investors.html` — Step A3
wrote it. There is nothing left to build.

State that absolute path in your reply and hand the file back as the
deliverable — Cowork opens a returned HTML file on its own; elsewhere the user
opens that path in a browser. On a desktop shell where `open` exists, running
`open "$WORKSPACE/carta-co-investors.html"` is a convenience, not a
requirement — it does not exist in the Cowork sandbox, and its absence changes
nothing about the delivery.

> **No process commentary.** Do not explain which surface you used, that a
> preview panel was absent, that you "ran the generator directly", or what a
> preview server is. Report the co-investors, not the plumbing (see
> "User-facing language — no internals, ever").

#### Step A4c: Present the result

Tell the user:

> "Report ready: <N> co-investors across <M> portfolio companies (SPA coverage:
> <spa_companies> of <total_companies>). Click any company to drill into the full
> investor breakdown."
>
> Data as of <generatedAt>.
> [View SPA source documents in Carta](<base_url>/investors/firm/<firm_carta_id>/portfolio/documents/)

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-co-investors", checkpoint_label="skill_finished")`.

### Step A5: Clean up

Nothing to clean. The ndjson query bodies are blobs the MCP client persists
into its own session-scoped `tool-results/` directory (read-only from the
sandbox, and garbage-collected when the session ends). What the skill writes
to `$WORKSPACE` is meant to persist: the assembled
`carta-co-investors-data.json`, the HTML artifact, and `.toolchain.json`
(Step A0's resolved paths — a re-run reuses it instead of searching again).

---

## Mode B — Text analysis

Answer specific analytical questions about co-investors using aggregation queries.

### Step B0: Reuse cached data if available

Before fetching anything, resolve the workspace and check for the assembled
artifact data from a prior Mode A run. Use the same Cowork-aware probe as
Step A0 so a cached file from a Mode A run on the same machine is actually
discoverable here.

```bash
if [ -d "${HOME}/mnt/outputs" ] && [ -w "${HOME}/mnt/outputs" ]; then
  WORKSPACE="${HOME}/mnt/outputs/carta-co-investors"
elif command -v carta >/dev/null 2>&1; then
  WORKSPACE=$(carta workspace cache carta-co-investors | jq -r .)
else
  WORKSPACE="${TMPDIR:-/tmp}/carta-co-investors"
fi
mkdir -p "$WORKSPACE"
test -f "$WORKSPACE/carta-co-investors-data.json" && \
  find "$WORKSPACE/carta-co-investors-data.json" -mmin -60 -print
```

If the file exists **and** is less than 60 minutes old, it contains everything
Q1 and Q4 need — `coInvestors` (canonical-grouped, ranked by company count)
and `companyRounds[<company>]` (per-round investor breakdowns with `name`,
`entityType`, `pctOfRound`, `amountPaid`, `isFirm`, `shareClass`, `closingDate`).

**Cache-served question types:**
- **Q1** — read `data.coInvestors` directly; map to the Q1 output table.
- **Q4** — read `data.companyRounds[<matched_company>]` directly; render each
  round as a separate section. Use `data.meta.firmName` for the title and
  `data.meta.firmCartaId` for the source-documents link.

**For Q1 and Q4, tell the user:** `Using cached SPA data from $(date -r "$WORKSPACE/carta-co-investors-data.json" "+%H:%M"). Preparing results…` then skip Step B2 entirely and proceed to Step B3.

**Fall through to Step B2 (DWH fetch) when:**
- The cache file does not exist
- The cache file is older than 60 minutes
- The question type is Q2 or Q3 (those need per-round percentage math the cache doesn't precompute)
- The user explicitly asks to refresh (e.g. "rerun", "fresh data")

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

Run the main query **in parallel** with the coverage queries (B and C from Mode A).

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

> **Cache-first:** if Step B0 found a fresh `carta-co-investors-data.json`,
> read `coInvestors` from it (already canonical-grouped and ranked) instead
> of running this query. Only fall back to the DWH query when the cache is
> absent or stale.

Identical to Mode A's Query S in shape. **Run Step A1.0 first** to assemble
`<CANONICAL_CASE>` from `canonical-investors.json` — the model needs that even
when Mode A wasn't invoked. The result schema (`CANONICAL_NAME`, `ENTITY_TYPE`,
`COMPANY_COUNT`, `COMPANIES`, `RAW_NAMES`) maps directly to the Q1 output
table below.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, ATTRIBUTES:name::VARCHAR AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR AS PURCHASER_NAME, ATTRIBUTES:entity_type::VARCHAR AS ENTITY_TYPE, ATTRIBUTES:share_class_name::VARCHAR AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:total_amount_paid::NUMBER(38,2) AS TOTAL_AMOUNT_PAID FROM spa_rec WHERE RECORD_TYPE = 'investor'), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(ATTRIBUTES:effective_date::VARCHAR) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> '' GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), purchaser_canonical AS (SELECT i.ISSUER_NAME, p.PURCHASER_NAME, p.ENTITY_TYPE, <CANONICAL_CASE> FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%') SELECT CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, COUNT(DISTINCT ISSUER_NAME) AS COMPANY_COUNT, ARRAY_AGG(DISTINCT ISSUER_NAME) WITHIN GROUP (ORDER BY ISSUER_NAME) AS COMPANIES, ARRAY_AGG(DISTINCT PURCHASER_NAME) WITHIN GROUP (ORDER BY PURCHASER_NAME) AS RAW_NAMES FROM purchaser_canonical GROUP BY CANONICAL_NAME ORDER BY COMPANY_COUNT DESC LIMIT 50"
}})
```

> Append the same `firm_vehicle_names` exclusion clauses to the WHERE that
> Mode A Step A1 describes, so off-brand firm vehicles don't leak into Q1.

#### Q2 — Most frequent with >5% of a round

> **Why "% of round" and not "ownership":** this number reflects the investor's
> share of a single SPA round at purchase time. It is **not** current fully
> diluted ownership — that would require dilution math (subsequent rounds,
> option pool refreshes, secondaries) which SPA data alone cannot provide.
> Never use the word "ownership" in user-facing output for this skill.

Use the Step A1.0 `CANONICAL_NAME` CASE expression so multi-vehicle investors
are aggregated at the canonical level. % of round is recomputed as
`SUM(canonical shares) / SUM(round shares)` so a firm investing through
multiple vehicles in the same round is credited with the combined stake.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_rec AS (SELECT * FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'stock_purchase_agreement' AND FIRM_ID = '<firm_id>'), spa_issuer AS (SELECT EXTRACTION_ID, FIRM_ID, ATTRIBUTES:name::VARCHAR AS ISSUER_NAME FROM spa_rec WHERE RECORD_TYPE = 'company'), spa_purchaser AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::VARCHAR AS PURCHASER_NAME, ATTRIBUTES:entity_type::VARCHAR AS ENTITY_TYPE, ATTRIBUTES:share_class_name::VARCHAR AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:total_amount_paid::NUMBER(38,2) AS TOTAL_AMOUNT_PAID FROM spa_rec WHERE RECORD_TYPE = 'investor'), spa_deal AS (SELECT EXTRACTION_ID, TRY_TO_DATE(ATTRIBUTES:effective_date::VARCHAR) AS CLOSING_DATE FROM spa_rec WHERE RECORD_TYPE = 'stock_purchase'), doc_metadata AS (SELECT i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE, MIN(p.SHARE_CLASS_NAME) AS SHARE_CLASS_NAME FROM spa_issuer i LEFT JOIN spa_deal s ON i.EXTRACTION_ID = s.EXTRACTION_ID LEFT JOIN spa_purchaser p ON i.EXTRACTION_ID = p.EXTRACTION_ID WHERE i.FIRM_ID = '<firm_id>' AND i.ISSUER_NAME IS NOT NULL AND TRIM(i.ISSUER_NAME) <> '' GROUP BY i.EXTRACTION_ID, i.ISSUER_NAME, s.CLOSING_DATE), dedup_docs AS (SELECT MAX(EXTRACTION_ID) AS EXTRACTION_ID FROM doc_metadata GROUP BY ISSUER_NAME, COALESCE(CAST(CLOSING_DATE AS VARCHAR), SHARE_CLASS_NAME, 'undated')), spa_canonical AS (SELECT i.ISSUER_NAME, <CANONICAL_CASE> AS CANONICAL_NAME, p.ENTITY_TYPE, p.SHARES_PURCHASED, s.CLOSING_DATE, dd.EXTRACTION_ID FROM dedup_docs dd JOIN spa_issuer i ON dd.EXTRACTION_ID = i.EXTRACTION_ID JOIN spa_purchaser p ON dd.EXTRACTION_ID = p.EXTRACTION_ID LEFT JOIN spa_deal s ON dd.EXTRACTION_ID = s.EXTRACTION_ID WHERE p.PURCHASER_NAME NOT ILIKE '%<firm_name>%' AND p.PURCHASER_NAME NOT ILIKE '%<firm_name_spaced>%' AND p.ENTITY_TYPE NOT ILIKE '%notice%' AND p.ENTITY_TYPE NOT ILIKE '%law firm%'), per_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, SUM(SHARES_PURCHASED) AS CANONICAL_SHARES FROM spa_canonical GROUP BY ISSUER_NAME, CANONICAL_NAME, EXTRACTION_ID, CLOSING_DATE), pct_per_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, EXTRACTION_ID, CLOSING_DATE, CANONICAL_SHARES / NULLIF(SUM(CANONICAL_SHARES) OVER (PARTITION BY EXTRACTION_ID), 0) AS PCT_OF_ROUND FROM per_round), latest_round AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND, ROW_NUMBER() OVER (PARTITION BY ISSUER_NAME, CANONICAL_NAME ORDER BY CLOSING_DATE DESC NULLS LAST, EXTRACTION_ID DESC) AS rn FROM pct_per_round), filtered AS (SELECT ISSUER_NAME, CANONICAL_NAME, ENTITY_TYPE, PCT_OF_ROUND FROM latest_round WHERE rn = 1 AND PCT_OF_ROUND > 0.05) SELECT CANONICAL_NAME, ANY_VALUE(ENTITY_TYPE) AS ENTITY_TYPE, COUNT(DISTINCT ISSUER_NAME) AS COMPANIES_ABOVE_5PCT, ROUND(AVG(PCT_OF_ROUND) * 100, 1) AS AVG_PCT_OF_ROUND, ARRAY_AGG(DISTINCT ISSUER_NAME) WITHIN GROUP (ORDER BY ISSUER_NAME) AS COMPANIES FROM filtered GROUP BY CANONICAL_NAME ORDER BY COMPANIES_ABOVE_5PCT DESC, AVG_PCT_OF_ROUND DESC LIMIT 50"
}})
```

> Substitute `<CANONICAL_CASE>` with the same assembled CASE block built in
> Step A1.0 (read from `canonical-investors.json`). Q2/Q3 take the **un-aliased**
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

> **Cache-first:** if Step B0 found a fresh `carta-co-investors-data.json`,
> read `companyRounds[<matched_company>]` from it instead of running this
> query. Match the company name case-insensitively against the JSON keys.
> Only fall back to the DWH query below when the cache is absent or stale.

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
| `open` command fails | Tell the user the file path to open manually: `$WORKSPACE/carta-co-investors.html` (the resolved value, not the literal env var). |
| MCP query error | "Could not reach Carta data. Try again in a moment." |
