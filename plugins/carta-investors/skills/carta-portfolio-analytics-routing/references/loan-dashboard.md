
<!--
MIRROR OF carta-loan-dashboard/SKILL.md — any change to that skill must be
manually re-applied here or the two will drift (no tooling keeps them in
sync; see carta-portfolio-analytics-routing/SKILL.md Architecture Notes
§"Specialists are unchanged").

NOT YET WIRED — this route is not dispatched from Step 3. Step 7e below
calls `read_skill`, which is NOT in the router's `allowed-tools`; testing
this fallback path today will fail silently at the tool-call stage. Add
`mcp__cowork__list_artifacts` and `read_skill` to `allowed-tools` at
promotion time (see "Future routes" in SKILL.md).
-->

# Loan Dashboard Skill

Creates (or updates) a persistent Cowork artifact showing the user's loan portfolio: KPI tiles + a top-10 loans table. Data is pulled from Carta via the MCP and **baked into the artifact at create time** (the artifact does not fetch live). The skill is identity-agnostic — RAP scopes which loans are visible via the firm context; the skill adds no firm filter.

## Steps

### 1. Identify the Carta MCP server
Scan the tools available in the conversation (system-reminder blocks) for `mcp__*__fetch` that also has a matching `mcp__*__welcome`. Extract `<SERVER>` (the middle segment between the first and last `__`). None found → tell the user no Carta MCP server is connected and stop. Exactly one → use it. Multiple → ask the user which.

### 2. Ensure firm context (do NOT re-welcome)
`welcome` is a once-per-connection handshake that the MCP fires on connect and caches (identity/firm/accounts). **Reuse that cached context.** Only call `mcp__<SERVER>__welcome` if no Carta context is established yet this session (e.g. a fresh connection that never welcomed); **never re-display the welcome screen** on a later invocation. Read the resolved firm context from what's already established. (If you do have to call `welcome` and it fails, report the error and stop.)

### 3. Confirm firm context
Show the user which firm the context resolves to and confirm it's the one they want. RAP scopes rows to this firm. (Staff: impersonate the target firm before invoking — this skill does not switch context.)

### 4. Resolve the schema (optimistic — probe only on failure)
The loan schema is known and stable. Resolving it with an upfront `dwh:list:tables` + `SELECT * FROM … LIMIT 1` probe on **every** run is avoidable latency (profiling on the sibling skill: ~21s probe + ~34s retry on a column-name mismatch = ~55s, ~31% of wall time). **Bind the placeholders to the confirmed schema below and query it directly (Step 5). Do NOT probe up front. Fall back to discovery only when a query actually errors.**

Confirmed schema (data-explorer / datashare layer exposed via the MCP, verified live):
- Table: `<loan_table>` = `LOAN_OPS.LOAN`
- Columns: `<committed>`=`TOTAL_COMMITMENT`, `<drawn>`=`TOTAL_DRAWN_AMOUNT`, `<outstanding>`=`OUTSTANDING_PRINCIPAL`, `<currency>`=`CURRENCY_CODE`, `<active>`=`IS_ACTIVE`, `<firm_name>`=`LENDING_FIRM_NAME`, `<loan_name>`=`LOAN_NAME`, `<borrower>`=`BORROWER_NAME`, `<lead_lender>`=`LEAD_LENDER_NAME`

**Fallback — trigger ONLY on a query error (warehouse layers diverge; the synonyms exist only to recover, never to pre-empt):**
- *Loan table not found* (the Step-5 query errors that `LOAN_OPS.LOAN` is unknown): call `dwh:list:tables`, set `<loan_table>` to the datashare loan view (`LOAN` or ends `_LOAN`, e.g. `LOAN_OPS.LOANOPS_DATASHARE_LOAN`); re-run. If `dwh:list:tables` shows no loan view at all, tell the user loan data isn't available in this context and stop.
- *Unknown column* (a layer names a money column differently): probe `SELECT * FROM <loan_table> LIMIT 1` (format markdown) and resolve — `<committed>` → first present of `TOTAL_COMMITMENT`, `TOTAL_COMMITTED_AMOUNT`; `<drawn>` → first present of `TOTAL_DRAWN_AMOUNT`, `TOTAL_DRAWN`; re-run. If a concept still has no matching column, drop its tile/column rather than erroring.

### 5. Run the two queries (markdown)
Run each via `mcp__<SERVER>__fetch` with `{command: "dwh:execute:query", params: {sql: "<SQL>", format: "markdown"}}`. The result is a **markdown table**. No firm filter — RAP scopes rows.

**Run them in parallel.** The KPIs query and the top-10 query are independent — both read `<loan_table>` and neither needs the other's result. Issue both `fetch` calls in the **same turn** (two tool calls in one assistant message) so they run concurrently, rather than awaiting one then the other. (This is well within the documented ≤3-concurrent rate-limit ceiling.) If the multi-currency guard in step 6 triggers a re-run scoped to one currency, fire that re-run's two queries the same way.

KPIs (use the resolved column names from step 4):
```sql
SELECT COUNT(*) AS total_loans, COUNT_IF(<active>) AS active_loans,
       SUM(<committed>) AS total_committed,
       SUM(<drawn>) AS total_drawn,
       SUM(<outstanding>) AS total_outstanding,
       MAX(<firm_name>) AS firm_name, MAX(<currency>) AS currency_code,
       COUNT(DISTINCT <currency>) AS currency_count
FROM <loan_table>;
```
Top 10 (aliased so parsing maps by stable names):
```sql
SELECT <loan_name> AS loan_name, <borrower> AS borrower_name, <lead_lender> AS lead_lender_name,
       <committed> AS committed, <drawn> AS drawn, <outstanding> AS outstanding, <active> AS is_active
FROM <loan_table> WHERE <outstanding> IS NOT NULL
ORDER BY <outstanding> DESC LIMIT 10;
```
If a resolved column is absent, drop it (and the dependent tile/column) rather than erroring.

### 6. Parse the markdown table rows into the data object

**Multi-currency guard (required — never sum across currencies).** If the KPI row's `currency_count > 1`, the SUMs span multiple currencies and are not meaningful. Get the per-currency counts: run `SELECT <currency> AS currency_code, COUNT(*) AS n FROM <loan_table> GROUP BY <currency> ORDER BY n DESC` (format markdown). Then **use `AskUserQuestion`** to present each currency as a selectable option labeled with its count — e.g. options "USD (60)", "EUR (4)", "GBP (1)". Do **not** ask the user to free-type the currency. On selection, re-run the step-5 queries scoped with `WHERE <currency> = '<chosen>'` and proceed. Only render once a single currency is resolved.

Parse each query's markdown-table output (a header row, a `---|---` separator row, then pipe-delimited data rows); map columns by header name. Assemble exactly this shape:
```text
{ firm_name, currency_code,
  kpis: { total_loans, active_loans, inactive_loans, total_committed, total_drawn,
          drawn_utilization_pct, total_outstanding, undrawn_capacity },
  top_loans: [ { loan_name, borrower_name, lead_lender_name, committed, outstanding,
                 draw_utilization_pct, is_active } ] }
```
Derive: `inactive_loans = total_loans − active_loans`; `undrawn_capacity = total_committed − total_drawn`; `drawn_utilization_pct = total_drawn / total_committed × 100`, rounded to 1 decimal (0 if committed is 0). Per loan (columns are aliased in the top-10 query — `committed`, `drawn`, `outstanding`, `is_active`): `draw_utilization_pct = drawn / committed × 100` (0 if committed is 0). Treat NULL numerics as 0.

### 7. Render the artifact (deterministic — via `render_artifact.py`)
The step-6 data object is small; the artifact template is ~12 KB. To keep the template **out of your context and out of your output** (re-emitting it — or hand-writing the escape in a heredoc — is the dominant render cost and a frequent failure), a bundled script reads the template itself and performs the escape + substitution. **You write only the small data file and run the script — never load or emit the template, and never hand-author the escaping.**

**7a. Locate the workspace and the script** (one Bash block; `${CLAUDE_PLUGIN_ROOT}` is NOT substituted in Cowork, so probe both runtimes):
```bash
if [ -d "$HOME/mnt/outputs" ] && [ -w "$HOME/mnt/outputs" ]; then WORKDIR="$HOME/mnt/outputs/carta-loan-dashboard"
elif command -v carta >/dev/null 2>&1; then WORKDIR="$(carta workspace cache carta-loan-dashboard | jq -r .)"
else WORKDIR="${TMPDIR:-/tmp}/carta-loan-dashboard"; fi
mkdir -p "$WORKDIR"
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -d "$CLAUDE_PLUGIN_ROOT/skills/carta-loan-dashboard" ]; then
  SKILL_DIR="$CLAUDE_PLUGIN_ROOT/skills/carta-loan-dashboard"
else
  SKILL_DIR="$(find "$HOME/mnt/.remote-plugins" -maxdepth 3 -type d -name carta-loan-dashboard 2>/dev/null | head -1)"
fi
```
If `uv`/Bash is unavailable or `$SKILL_DIR/../../scripts/render_artifact.py` does not resolve (a hosted surface that blocks subprocess), use the **inline fallback (7e)**.

**7b. Write the data.** `Write` the step-6 data object as compact JSON to `$WORKDIR/loan-data.json`. (You are writing a small data file — never the template.)

**7c. Render.**
```bash
uv run "$SKILL_DIR/../../scripts/render_artifact.py" --workdir "$WORKDIR" --template "$SKILL_DIR/references/artifact_template.html" --out loan-dashboard.html
```
The shared renderer reads the template you point it at, applies the XSS-safe `\uXXXX` escaping, substitutes the single placeholder, writes the finished HTML, and prints its absolute path to stdout. Branch on the exit code — do not re-derive the result:

| RC | meaning | next move |
|----|---------|-----------|
| 0 | HTML written; path on stdout | continue to 7d |
| 1 | data file missing / bad JSON | re-check 7b, retry once |
| 4 | bundled template not found | use the inline fallback (7e) |
| 14 | template token count is not exactly 1 (drift) | stop; the template needs fixing, report it |

**7d. Create / update the artifact.** `Read` the rendered HTML from the path the script printed. Then `mcp__cowork__list_artifacts`; if id `loan-dashboard` exists → `mcp__cowork__update_artifact` (id `loan-dashboard`, that html, `update_summary: "Refreshed for <firm_name>"`); else → `mcp__cowork__create_artifact` (id `loan-dashboard`, name "Loan Dashboard", that html, description "Loan portfolio dashboard — KPIs + top-10 loans from Carta."). Tell the user the dashboard is ready, briefly. Do nothing else after.

**7e. Inline fallback** (only when 7a's probe finds no script or the runtime blocks subprocess): load the template with `read_skill(file_path="references/loan-dashboard/artifact_template.html")` (this router's own mirrored copy — `read_skill` resolves relative to the currently-executing skill, which is this router, not `carta-loan-dashboard`), escape the compact data JSON exactly as the template's header comment documents (the `\uXXXX` form for `&` `<` `>` `'` — **not** HTML entities; a raw `</script>` in a warehouse string would otherwise inject HTML = stored XSS), replace the single `__LOAN_DATA__` placeholder, then create/update as in 7d.
