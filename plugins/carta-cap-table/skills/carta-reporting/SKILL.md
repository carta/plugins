---
name: carta-reporting
description: >-
  Default skill for all cap table data-display queries — use this whenever the user wants
  to see, list, or explore equity data for a single company. Covers grants, vesting
  schedules, stakeholders, securities, SAFEs, convertible notes, round history, preferred
  holders, liquidation seniority, and rights & preferences. Also handles any request
  starting with "Generate Carta Excel —" (the artifact prompt bar payload).
  Defers to specialized skills for: waterfall exits, SAFE/note conversion math,
  voting rights, issuance, modifying issuables, per-stakeholder vesting detail
  (use carta-grant-vesting for "How much has [name] vested?"), round history lookup
  (use carta-round-history for "What was our Series B round?"), and SAFE/convertible
  conversion math. Not for cross-portfolio data.
model: sonnet
allowed-tools:
  - ToolSearch
  - mcp_registry_suggest_connectors
  - mcp__carta__call_tool
  - mcp__carta__search_tools
  - mcp__carta__list_accounts
  - mcp__cowork__create_artifact
  - Agent
  - AskUserQuestion
  - Bash(cat ${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/staff/*)
  - Bash(cat ${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/references/*)
  - Bash(find * -name "artifact_engine.html"*)
  - Bash(find ~ -name "report_processor.py"*)
  - Bash(find ~ -name "artifact_engine.html"*)
  - Bash(cat "$_engine_html_path"*)
  - Skill(carta-cli:btg)
  - Skill(carta-cap-table:carta-reporting-markdown)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run*)
  - Skill(carta-cap-table:carta-reporting-excel)
---

# Custom Reports

<!-- [PATTERN carta-writing-style v0.0.2] [PATTERN etiquette v0.0.6] [PATTERN text v0.0.8] [PATTERN tables v0.0.12] [PATTERN carta-watermark v0.0.10] -->

Pull data directly from Carta and turn it into a customized report — filtered, sorted, and formatted to your specs. No SQL, no manual exports, no copy-paste.

**How it works:**
- Connects to your Carta account and searches for the right report type based on what you describe
- Lets you customize columns, filters, sorts, formulas, and aggregations in the chat
- Delivers results as a live interactive artifact (Claude Desktop) or a branded Excel file (Claude Code)

> **Prerequisites**
> - Access to a Carta account with cap table data
> - Reporting feature enabled for your company (ask your Carta admin if unsure)
> - Claude Desktop: connects via the Carta integration button; Claude Code: uses an already-configured Carta MCP

## Trigger Examples

- "Show me grants this year"
- "List our SAFEs"
- "Who are our stakeholders?"
- "Show me convertible notes"
- "Show me vesting schedules"
- "Show me preferred holders"
- "What's the liquidation seniority stack?"
- "Show me rights and preferences"
- "How's our equity issuance looking?"
- "What's our round history?"
- "Custom report", "build me a custom report", "I need a custom report", "what reports are available"
- "Export all option grants in 2024 that are > 50% vested, with their exercise prices and vesting schedules"
- "Run a report for each stakeholder with fully diluted ownership above 5%, showing their individual securities and any exercises this year"
- "Generate a report of employees with unvested RSUs with a final vesting date past 2027, and include their current fully diluted ownership"
- "Help me build a cap table report — I'm not sure what's available"
- "What can I export from the cap table?"
- NOT: "What's [Alice]'s vesting schedule?" (use carta-grant-vesting instead)
- NOT: "What was our Series B round?" (use carta-round-history instead)

## Workflow

**Output rules — follow throughout every step:**
- Do not narrate internal steps, environment detection, or tool calls. Work silently.
- Only speak to the user when you need input, have a result to show, or must surface an error.
- Never expose technical terms like "MCP", "ToolSearch", "UUID", or "corporation_id" in user-facing messages.
- Use plain language. "I couldn't find that company" not "list_accounts returned no corporation_pk match."
- **When output mode is ARTIFACT (Cowork available): do not render report data as a markdown table in chat.** The only exceptions are trivially small results: a single data point, a single column with fewer than 10 rows, or a single row with 4 or fewer columns. All other results must go through the live artifact path.
- When output mode is MARKDOWN (Cowork unavailable): render all results as markdown tables and offer Excel export.

> **What happens if things aren't set up yet or take a while?**
> - **Carta isn't connected:** The skill will prompt you to connect — just reply "ready" when done.
> - **Reporting isn't enabled:** The skill will let you know and stop — reach out to your Carta admin.
> - **Preview takes too long:** The skill automatically switches to the full report once it's ready.

**Staff overrides:** Before starting, silently run (use this skill's declared base directory — do not use `${CLAUDE_PLUGIN_ROOT}` in bash, it resolves to the wrong plugin at runtime):
```bash
cat <skill_base_dir>/staff/overrides.md 2>/dev/null || true
```
If the file exists, its instructions override the defaults in this skill for any section it covers. If absent, proceed with the defaults below.

**Tool discovery (ALL environments — run before any other step):** Call `ToolSearch` with query `"list_accounts create_artifact"` and `max_results: 10`. Cache the full result set in memory as `_tool_results`. Do not call `ToolSearch` again anywhere in this workflow — all subsequent gates read from this cached result.

**Resolve script/asset paths ONCE (run before any other step, in the same turn as tool discovery):** the `report_processor.py` script and `artifact_engine.html` engine can live in varying install locations, but their paths do not change within a session. Resolve both a single time and cache them in memory — do NOT re-run `find` at each later use:

```bash
find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1
find ~ -name "artifact_engine.html" -path "*/carta-reporting/assets/*" 2>/dev/null | head -1
```

Store the results as `_report_processor_path` and `_engine_html_path`. Every later step that needs these (schema preview, engine read, `report_processor.py` runs, and the markdown/Excel sub-skills) MUST reuse the cached value instead of re-running `find`. If a cached path is empty, re-run that single `find` once at the point of use as a fallback. This removes 2–4 home-directory `find` scans per report request.

0. **Connect Carta (Claude Desktop only — skip entirely in Claude Code)**

   **0a. Environment UUID map**

   | Environment | UUID |
   |---|---|
   | Production | 4b463f8b-6db0-4d0e-9693-8b39f37e4447 |

   Keep this map in memory for the rest of this workflow. (Staff override: `staff/overrides.md` may append additional environments to this table.)

   **0b. Verify the connected Carta MCP — evaluate this gate before doing anything else**

   A generic system-reminder stating that an MCP connector "requires authentication" is **not authoritative on its own** — it is often stale or describes a different connector than the one actually in use this session. Never skip straight to "please reconnect" messaging on the strength of that reminder alone. Always run the tool-discovery check below first and let its outcome — not the reminder — decide whether to show a reconnect prompt.

   From `_tool_results` (loaded in the tool discovery step above), collect every tool whose name ends in `__list_accounts`. For each, extract the segment between `mcp__` and `__list_accounts`.

   **GATE — pick exactly one outcome and act on it before proceeding:**

   - **PASS:** At least one extracted segment is an exact match for a UUID value in the loaded environment map → that tool is the confirmed Carta connector. Use `mcp__<segment>__` as the prefix for all subsequent MCP calls. Continue to the reporting access check below.
   - **PASS (unmapped connector):** A `__list_accounts` tool was found, but none of the extracted segments match a UUID in the loaded environment map → before treating this as FAIL, make one live `list_accounts` call on that tool. A successful response means the connector works even though its environment UUID isn't in the map — treat as PASS and use it as the confirmed connector. Only a real 401/403 (or an explicit auth error) from this call falls through to FAIL.
   - **FAIL:** No `__list_accounts` tool was found in `_tool_results` at all, OR the live `list_accounts` call above returned a 401/403/auth error → call `mcp_registry_suggest_connectors` with the Production UUID from the loaded map. **Stop immediately — do not proceed to Step 1.** Say to the user: "I need access to [Company Name]'s Carta account to pull this report. Connect Carta using the button above — once you're in, say 'ready' and I'll pick up from here." When the user replies, re-run the single ToolSearch from the tool discovery step and continue from this gate — do not ask them to repeat the original request.

   If multiple tools pass the gate, use the one whose environment appears earliest in the loaded map. If the user's message includes an explicit environment qualifier (production, preprod, sandbox, test, demo), cross-check the confirmed UUID against that environment; if it doesn't match, treat as FAIL.

   **Switching accounts mid-conversation** — if the company is already identified from earlier in this conversation and the user is asking to switch to a different Carta account, skip the "Find the company" step once reporting access is confirmed. Carry forward all previously resolved values and resume from "Find the right report type".

   **Confirm reporting access**

   Reporting access is a property of the connected Carta account (the confirmed MCP connector prefix from Gate 0b), not of an individual company, and it does not change within a conversation — so confirm it **once per connected account**. If `_reporting_access_confirmed` is already set to `true` in this session for the current connector prefix, skip this check entirely and proceed to Step 1 — do not re-call `search_tools`. (If the user switches to a different Carta connector mid-conversation, treat that as a new account and re-confirm.)

   Otherwise, call `mcp__carta__search_tools({"query": "reporting"})` to query Carta's BM25 catalog (reporting tools are indexed, not pinned, so `ToolSearch` won't find them). If no `reporting__*` tools appear in the results, tell the user: "Looks like reporting isn't enabled for this account yet. You can try a different Carta account, or reach out to your Carta contact to get it set up." Then stop — do not proceed to Step 1. On success, set `_reporting_access_confirmed` to `true` in session memory so subsequent report requests on the same connected account skip this round-trip.

0c. **Set output mode — runs in ALL environments (Claude Desktop and Claude Code)**

   From `_tool_results` (loaded in the tool discovery step above), check whether `mcp__cowork__create_artifact` is present.

   **GATE — pick exactly one outcome and hold it for the rest of this session:**

   - **Cowork available** (`mcp__cowork__create_artifact` found) → output mode is **ARTIFACT**. All non-trivial report data **must** be rendered as a live artifact. Do not render report data as a markdown table in chat. Skip this check for all subsequent steps — output mode is already set.
   - **Cowork unavailable** (tool not found) → output mode is **MARKDOWN**. Use markdown tables and Excel export for all results.

   Do not re-run this check later in the workflow. Do not rely on environment heuristics — a user may be on Claude Desktop without Cowork installed.

1. **Find the company** — if the company name appears to be a nickname, abbreviation, or informal reference (e.g. "golden master", "the fund", "our main entity"), note this and use it as a fuzzy search term in `list_accounts` rather than a literal match. After `list_accounts` returns, do a case-insensitive substring match across all account names before assuming no match. Then extract the numeric ID from the `corporation_pk:<id>` field. Only `corporation_pk` accounts support reports. If the user names multiple companies, dispatch one subagent per company in parallel (send all `Agent` tool calls in a single message) to resolve each corporation_id simultaneously. If multiple accounts share the same name, **you MUST call the `AskUserQuestion` tool** — do not ask in plain text, the user cannot respond to plain text questions. List every match explicitly in the question, e.g. "I found 3 accounts named Meetly — which one did you mean? (Account 2451, Account 2452, or Account 7)" — the question must enumerate the options so the user can pick one. If a company cannot be found, say "I couldn't find [CompanyName] — it won't be included in the report" — never fabricate or estimate data for it.

1a. **Resolve phantom equity display label (silent)** — run this step on the **main thread** for each resolved `corporation_id`. Do NOT delegate to a subagent — the resolved label must be available in the parent context before report processing begins.

   Call with `detail: "minimal"` and `page_size: 1` to check for CBU existence without fetching all records:
   ```
   call_tool({"name": "cap_table__list__cbus", "arguments": { corporation_id, detail: "minimal", page_size: 1 }})
   ```
   The `detail: "minimal"` response shape is `{ results: [...] }`. If `results` is empty or the call fails (403/404), set `_phantom_label_<corporation_id>` to `null` — the corporation has no CBUs.

   If `results` is non-empty, call `call_tool({"name": "cap_table__get__option_plans", "arguments": { corporation_id }})`. If this call fails for any reason (403, 404, network error, or unexpected response shape), set `_phantom_label_<corporation_id>` to `"Phantom Equity"` and continue — do not surface the error to the user. On success, look for any plan whose name suggests a phantom equity instrument (e.g. contains "Phantom", "PIU", "CBU", or similar). Use that plan's `name` field as `_phantom_label_<corporation_id>` if it differs from generic values like "Cash Bonus Units Plan". If no distinctive name is found, set `_phantom_label_<corporation_id>` to `"Phantom Equity"` as the fallback.

   Key per-corporation using `_phantom_label_<corporation_id>` (e.g. `_phantom_label_12345`) so multi-corporation flows each have their own label without collision.

   When `_phantom_label_<corporation_id>` is non-null, pass `"label_overrides": {"CBU": "<label>"}` to every `report_processor.py` invocation for that corporation. This applies to schema preview, preview report, and full report processing (step 4d, the markdown skill, and the Excel skill). **Exception:** the `Generate Carta Excel —` prompt-bar path enters `carta-reporting-excel` fresh without session context and cannot apply label overrides — this is a known limitation and out of scope for this fix.

2. **Find the right report type** — call `call_tool({"name": "reporting__search__report_types", "arguments": { corporation_id, query, json_export_supported: true }})` with a natural-language description of the data the user needs (e.g. `"option grants > 50% vested with exercise prices"`). Use `reports` from the response, ranked by `similarity`. If results are empty, rephrase the query with broader terms and try again.

   **Supported report types** (support `export_format: "json"`):
   `canceled_and_returned_report`, `cap_table_summary_report`, `common_securities_report`,
   `eightythreeb_elections_report`, `equity_awards_outstanding`, `equity_plan_granted_report`,
   `equity_plan_report`, `exercised_and_settled_report`, `historical_terminations_report`,
   `ocx_report`, `options_outstanding_report`, `rule_701_report`,
   `secondary_transaction_seller_model`, `securities_ledger_report`,
   `share_registry_report`, `stakeholder_details_report`, `stakeholder_ledger_report`,
   `stakeholder_ownership_details_report`, `termination_modeling_report`, `vesting_details_report`

   When ranking candidates, **always prefer a supported report type over an unsupported one**, even if the unsupported type scores slightly higher. Only fall back to an unsupported type if no supported type has a plausible similarity score. Proceed with the top supported result automatically — only ask for confirmation if the top two supported results have nearly identical similarity scores AND the request is genuinely ambiguous between two different data categories. When the user's prompt clearly names a report type (e.g. "equity awards", "securities ledger", "vesting details", "exercised and settled"), proceed without asking.

   **2a. In MARKDOWN mode, skip this entire step and go straight to "Collect report details".**

3. **Collect report details** — read `references/mcp-tool-reference.md` now (see the [MCP Tool Reference](#mcp-tool-reference) section for the `cat` command) and look up the matched report type in its **REQUIRED params by report_type** table. **Every param listed for that report type is required.** If missing, call `AskUserQuestion`. Default `as_of_date` to today (YYYY-MM-DD). Always use `export_format: "json"`.

   **Filters** — many report types accept filter params; the same reference file lists which filters each report type supports and the ID-lookup commands to resolve them. If the user mentions specific stakeholders, share classes, equity plans, securities, or a date range, resolve their IDs/values and pass the matching filter params as comma-separated strings — the report runs faster. `security_ids` takes comma-separated `TYPE:ID` strings (e.g. `"CERTIFICATE:42,OPTION:7"`); valid types: `CERTIFICATE`, `RSA`, `RSU`, `OPTION`, `SAR`, `CBU`, `PIU`, `WARRANT`, `CONVERTIBLE_NOTE`. Passing unsupported filters for a report type has no effect.

4. **Emit a status message before dispatching subagents** — before triggering any report generation, output a plain-language message to the user. Record the current time as `_report_start_time` (epoch seconds) on the **main thread**, immediately before dispatching the background `Agent` calls in steps 4b and 4c — this is the start of the generation clock. Do not record this inside the subagents. Capture it with: `UV_PYTHON_DOWNLOADS=never uv run python -c "import time; print(int(time.time()))"` (this form is already covered by the skill's `allowed-tools`).

   **Infer company size from the stakeholder count.** After resolving `corporation_id` in Step 1, call:
   ```
   call_tool({"name": "cap_table__get__stakeholders", "arguments": { corporation_id }})
   ```
   The default (summary) response shape is `{ count: N, by_type: {...} }`. Use `count` as the size signal. If a stakeholder call without a `search` filter was already made this session, reuse the cached `count` rather than calling again.

   Branch the message based on `count`:

   - **Fast path (`count` < 50):** "Fetching your **{Report Type}** for {Company} — this usually takes under 30 seconds. I'll show a preview as soon as it's available, then load the full dataset once it's ready."
   - **Slow path (`count` ≥ 50):** "Fetching your **{Report Type}** for {Company} — this may take a minute or more for larger cap tables. I'll show a preview as soon as it's available, then load the full dataset once it's ready."

   Do not skip this message. Emit it as your last output before any `Agent` tool call in step 4.

   **Generate the report** — trigger both reports in parallel, then immediately start downloading and presenting the data:

   **4a. Trigger both reports in parallel (main thread)**
   Issue both `call_tool` invocations in the **same turn** (Claude can make multiple tool calls simultaneously — do not wait for the first to resolve before sending the second):
   - `call_tool({"name": "reporting__create__report", "arguments": { corporation_id, report_type, as_of_date, report_name, export_format: "json", ...required_params }})` → `user_report_pk` (full report)
   - `call_tool({"name": "reporting__create__report", "arguments": { corporation_id, report_type, as_of_date, report_name, export_format: "json", preview: true, ...required_params }})` → `user_report_pk_preview` (preview report — generates faster with partial corporation data)

   If multiple report types matched, dispatch one `Agent` call per report type in the same message so all types trigger simultaneously.
   **Both `user_report_pk` and `user_report_pk_preview` must be in hand before proceeding to 4b, 4c, and 4d.**

   **4b. Background subagent — poll and download the full report** — call the `Agent` tool with `run_in_background: true` in the **same message as 4c** so both background agents start simultaneously. Use this prompt, substituting real values:

   ```
   Poll and download a Carta report. Do not interact with the user. Do not output anything. Do not use isolation — this agent only downloads files, it does not modify the working tree.

   user_report_pk: <pk>
   corporation_id: <corp_id>
   output_path:    /tmp/carta_report_<pk>.json

   Steps:
   1. Poll `call_tool({"name": "reporting__get__report_status", "arguments": { user_report_pk: <pk> }})` every 5 s, up to
      20 attempts.
      - Status "complete" → proceed to step 2.
      - Status "error" or "failed" → write {"error":"report failed"} to output_path and stop.
      - 20 attempts without complete → write {"error":"timeout"} to output_path and stop.
   2. Call `call_tool({"name": "reporting__get__download_url", "arguments": { user_report_pk: <pk>, corporation_id: <corp_id> }})`
      → presigned URL.
   3. Run: curl -fsSL "<presigned_url>" -o <output_path>
   ```

   **4c. Background subagent — poll and download the preview report** — call the `Agent` tool with `run_in_background: true` in the **same message as 4b**. Use this prompt, substituting real values:

   ```
   Poll and download a Carta preview report. Do not interact with the user. Do not output anything. Do not use isolation — this agent only downloads files, it does not modify the working tree.

   user_report_pk_preview: <pk_preview>
   corporation_id:         <corp_id>
   output_path:            /tmp/carta_preview_<pk_preview>.json

   Steps:
   1. Poll `call_tool({"name": "reporting__get__report_status", "arguments": { user_report_pk: <pk_preview> }})` every 5 s,
      up to 10 attempts.
      - Status "complete" → proceed to step 2.
      - Status "error" or "failed" → write {"error":"preview failed"} to output_path and stop.
      - 10 attempts without complete → write {"error":"preview timeout"} to output_path and stop.
   2. Call `call_tool({"name": "reporting__get__download_url", "arguments": { user_report_pk: <pk_preview>, corporation_id: <corp_id> }})`
      → presigned URL. If this call fails, write {"error":"download_url failed"} to output_path and stop.
   3. Run: curl -fsSL "<presigned_url>" -o <output_path>
   ```

   **4d. Main thread — wait for data, then build the artifact** — runs immediately after dispatching 4b and 4c. Read the engine HTML from the cached `_engine_html_path` (resolved once in the tool-discovery step). Use `cat "$_engine_html_path"`; only if that path is empty, resolve it once with `find`:

   ```bash
   cat "$_engine_html_path" 2>/dev/null || find ~ -name "artifact_engine.html" -path "*/carta-reporting/assets/*" 2>/dev/null | head -1 | xargs -I{} cat {}
   ```

   If this returns empty, continue — do **not** fall back to the xlsx skill or generate Excel directly.

   Check for `/tmp/carta_preview_<pk_preview>.json` every 5 s (up to 12 attempts = 60 s):
   - **Preview succeeded** (file present, no `"error"` key) → use the preview file as the data source.
   - **Preview failed** (file contains `"error"`, or 12 attempts elapse without the file appearing) → switch to the full-report fallback: poll for `/tmp/carta_report_<pk>.json` (poll every 5 s up to 20 attempts).

   **Mid-wait check-in (emit exactly once per report request):** If 30 seconds elapse during the preview poll (i.e., after 6 failed attempts) with no data yet available, output this message to the user before continuing to poll:

   > Still processing — large reports can take up to 90 seconds.

   Do not emit this message more than once. Do not emit it if the preview file arrives before 30 seconds.

   Once data file(s) are ready, proceed based on output mode:
   - **MARKDOWN mode (Claude Code):** invoke `Skill(carta-cap-table:carta-reporting-markdown)`. The following context is available in this session: data file path, `corporation_id`, `user_report_pk`.
   - **ARTIFACT mode (Cowork):** build the artifact inline (no subskill invocation — see below).

   **Do not dispatch Excel generation here or in parallel with the artifact.** The Excel path opens only after the user responds to the customization checkpoint. Triggering Excel before that checkpoint bypasses the user's chance to adjust columns, filters, and transforms.

   **Multi-corporation (when step 1 resolved more than one corporation_id):**

   Steps 4a–4c run independently per corporation — trigger N×2 report pairs in parallel. Each corporation produces its own data file at `/tmp/carta_preview_<pk>.json` (or `/tmp/carta_report_<pk>.json` on fallback).

   Once all data files are ready, collect them as a list: `[(corp_legal_name, data_file_path), ...]`.
   - **MARKDOWN mode:** invoke `Skill(carta-cap-table:carta-reporting-markdown)` with each corporation's data file in turn, presenting one markdown table block per corporation.
   - **ARTIFACT mode:** proceed with artifact build below, merging all corporations' sheets using `{Corp Name} — {Sheet Name}` prefixing (see multi-corporation guidance below).

   ---

   **Building the artifact (ARTIFACT mode only)**

   Run `report_processor.py` on each data file with no transforms to get schema data. Use the cached `_report_processor_path` (resolved once in the tool-discovery step); only fall back to `find` if it is empty:

   ```bash
   UV_PYTHON_DOWNLOADS=never uv run "${_report_processor_path:-$(find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1)}" <<'EOF'
   {
     "local_file": "<data file path>"
   }
   EOF
   ```

   Check `stats` before proceeding:
   - `missing_columns` non-empty → note the missing columns in the artifact's `metaRows` as "Columns unavailable: X, Y". Do not abort.
   - `filtered_row_count` = 0 on any sheet → omit that sheet from `_REPORT_PAYLOAD.data` and note the omission before creating the artifact.

   **CRITICAL**: Use the entire sheet dict from `report_processor.py` output directly as each sheet's value in `data` — do NOT reconstruct or selectively pick fields. The output contains `columns`, `rows`, `currency`, `row_currencies`, and `summary_meta`; all must be present for correct currency rendering. Dropping `currency` or `row_currencies` causes every money cell to display `$` regardless of the actual currency.

   **CRITICAL — assembly order:** The engine contains a boot IIFE that runs synchronously when its `<script>` block is parsed. `_REPORT_PAYLOAD` **must** be defined in an earlier `<script>` tag or `initReport` is never called and the artifact renders completely blank. Always assemble as:

   ```
   payload_script + params_script + engine_html   ← CORRECT
   engine_html + payload_script + params_script   ← WRONG
   ```

   Full structure:
   ```html
   <script>const _REPORT_PAYLOAD = <report data>;</script>
   <script>const _REPORT_PARAMS = { config: { … } };</script>
   <engine HTML>
   ```

   `_REPORT_PARAMS`:
   ```html
   <script>
   const _REPORT_PARAMS = {
     config: {
       title:         "<Corporation> — <Report Type>",
       reportType:    "<Human-readable report type>",
       entityName:    "<Corporation legal name>",
       corporationId: "<numeric corporation_id>",
       generatedBy:   "<User full name>",
       asOfDate:      "<YYYY-MM-DD>",
       metaRows:      [["Corporation", "<legal name>"], ["As of Date", "<YYYY-MM-DD>"]]
     }
   };
   </script>
   ```

   `_REPORT_PAYLOAD` shape:
   ```html
   <script>
   const _REPORT_PAYLOAD = {
     config: {
       title:         "{Corporation} — {Report Type}",
       reportType:    "{Human-readable report type}",
       entityName:    "{Stakeholder name, fund name, or company name}",
       corporationId: "{numeric corporation_id}",
       generatedBy:   "{User full name}",
       asOfDate:      "{YYYY-MM-DD}",
       metaRows: [
         // ["Corporation", "{Corporation legal name}"]  — always include
         // ["As of Date",  "{YYYY-MM-DD}"]              — always include
         // ["Stakeholder", "{Stakeholder name}"]        — for stakeholder reports
         // ["Period",      "{issued_from} – {issued_to}"] — for date-range reports
         // ["Equity Plan", "{plan name}"]               — when plan is a param
       ]
     },
     data: {
       // Each sheet's value is the full sheet dict from report_processor.py — include ALL fields
       "Sheet Name": {
         columns: [{name: "Col A", type: "string"}, ...],
         rows: [...],
         currency: {"code": "USD", "symbol": "$"},
         row_currencies: [null, ...]
       }
     }
   };
   </script>
   ```

   **Multi-corporation artifact:** The artifact engine has exactly one `id="sheetsNav"` and one `id="sheets"` element — **never** create separate containers per corporation, never namespace IDs, and never call `initReport` more than once. Build a single `_REPORT_PAYLOAD.data` dict where every sheet name is prefixed with the corporation name: `"Meetly — Securities Ledger"`, `"BiscuitByte — Securities Ledger"`, etc. Set `config.entityName` to comma-joined corporation names and `config.title` to `"Multi-Corporation — {Report Type}"`. Include one `["Corporation", "{name}"]` metaRow per corporation.

   **Naming** — use a short slug: `{stakeholder-or-entity}-{report-type}`, e.g. `meetly-securities-ledger`.

   One short sentence before creating ("Building your report…"), then call `mcp__cowork__create_artifact` with `html` as the full combined HTML string — not a file path.

   **Always present a customization checkpoint after the artifact renders — every artifact, without exception:**

   Compute `{elapsed}` as `(current epoch seconds) − _report_start_time`, rounded to the nearest whole second.
   Compute `{N}` as `filtered_row_count` (sum across all sheets) from `report_processor.py`'s `stats` output.

   > Here's your **{Report Type}** for **{Company Name}** — {N} rows as of {date}, built in {elapsed}s.
   >
   > _(If the original prompt specified transforms, summarize them here.)_
   >
   > Adjust anything before exporting:
   > - **Columns** — hide, add, or reorder
   > - **Filters** — narrow by security type, date range, amount, stakeholder, etc.
   > - **Sort** — change the sort order
   > - **Formulas** — add computed columns (% of total, running sum, ratio, USD conversion, etc.)
   >
   > Say **Export to Excel** when ready, or describe your changes.

   If the dataset is large (> 300 rows), append: "This report has {N} rows — you may want to filter before exporting."

   **Never generate Excel files directly** — no openpyxl, xlsxwriter, SpreadsheetML, or any other method. The only permitted Excel output path is `Skill(carta-cap-table:carta-reporting-excel)`.

   If the user requests a change (different filter, sort, or columns), update only the affected config field and re-generate the artifact — do not restart the workflow. When the user says **Export to Excel**, invoke `Skill(carta-cap-table:carta-reporting-excel)`.

5. **Show a preview** — the artifact created in step 4d is the live preview.

6. **Export to Excel**
   - **Claude Desktop prompt bar** — when the user's message starts with `Generate Carta Excel —`, skip steps 1–5 and invoke `Skill(carta-cap-table:carta-reporting-excel)` directly. The payload includes the corporation ID, so no company lookup is needed.
   - **Claude Code** — handled by `carta-reporting-markdown`, which invokes `Skill(carta-cap-table:carta-reporting-excel)` when the user confirms.

---

## MCP Tool Reference

The full call signatures, filter-param support matrix, and **required-params-by-report-type**
table live in `references/mcp-tool-reference.md` (kept out of the always-loaded skill to
reduce context). Read it on demand — only when you need to look up a required param, a filter
param, or an ID-lookup command — using this skill's declared base directory (do not use
`${CLAUDE_PLUGIN_ROOT}` in bash):

```bash
cat <skill_base_dir>/references/mcp-tool-reference.md
```

Cache the contents in memory the first time you read it; do not re-`cat` it within a session.

---

## Error Handling

| Symptom | Cause | Tell user |
|---|---|---|
| No matching report types | Query didn't match any known report type | Describe what kinds of reports are available and ask what they're looking for |
| `403` / access denied | Your account doesn't have permission to access this company's data. | "It looks like you don't have access to this company's Carta data. Reach out to your Carta admin to request access." |
| `status: error` | Report generation failed. If single report: regenerate once sequentially. If parallel reports: retry failed ones one at a time (sequential — parallel retries cause load failures). If still failing after retry: skip and continue. | "I wasn't able to generate the [Report Name] report — continuing with the rest." |
| `status: not_found` | Report expired. Regenerate immediately with same params from this session — no user prompt needed. Poll until `complete`, fetch download URL, run `report_processor.py` automatically. | _(silent recovery — no message needed unless recovery also fails)_ |
| `filtered_row_count` = 0 | No rows matched the filters | "No rows matched those filters." Offer to loosen the filter or try a different date. |
| `original_row_count` > ~1,000 rows | Large dataset | "This report has a lot of rows — want to narrow it down by date range, report type, or a specific person?" |
| `401` / session expired | Auth expired | "It looks like your Carta session expired — reconnect and try again." |
| `user_report_pk` missing from response | Transient API error | "Something went wrong generating this report — it may be a temporary issue. Try again in a moment, or contact your Carta team if it keeps happening." |
| `missing_columns` or `skipped_formulas` non-empty | Column name mismatch or formula source column not included | "Heads up — '[Column]' wasn't available in this report type and was left out." |

---

## Script Reference: report_processor.py

All post-processing (filter, column selection, sort, formulas, aggregations, preview) runs through this script. Called by `carta-reporting`, `carta-reporting-markdown`, and `carta-reporting-excel`. Never apply these transforms in Claude's memory.

> **Path resolution:** the examples below show `$(find ~ -name "report_processor.py" …)` for self-containment, but in the live workflow use the cached `_report_processor_path` resolved once in the tool-discovery step — `UV_PYTHON_DOWNLOADS=never uv run "${_report_processor_path:-$(find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1)}"`. Only re-run `find` when the cached path is empty.

Single sheet (global transforms):
```bash
UV_PYTHON_DOWNLOADS=never uv run "${_report_processor_path:-$(find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1)}" <<'EOF'
{
  "local_file":      "<path to downloaded report JSON>",
  "sheets":          ["Securities Ledger"],
  "columns":         ["Stakeholder Name", "Grant Date", "Shares Issued", "Vested %"],
  "filters":         [{"column": "Vested %", "op": ">", "value": 0.5}],
  "sort":            [{"column": "Shares Issued", "direction": "desc"}],
  "formulas":        [{"name": "% of Total", "op": "pct_of_total", "column": "Shares Issued"}],
  "aggregations":    {"type": "summary", "columns": {"Shares Issued": "sum"}},
  "label_overrides": {"CBU": "Phantom Units"},
  "preview":         5
}
EOF
```

`label_overrides` — optional dict mapping raw string cell values to display names. Applied to all string-typed columns across every sheet. Use to replace Carta's internal security type codes with the corporation's configured equity language names (e.g. `{"CBU": "Phantom Units"}`). Matching is exact and case-sensitive.

Multi-sheet with per-sheet config:
```bash
UV_PYTHON_DOWNLOADS=never uv run "${_report_processor_path:-$(find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1)}" <<'EOF'
{
  "local_file": "<path>",
  "sheets": {
    "Equity Grants":    {"columns": ["Grant ID", "Award Type", "Exercise Price"],
                         "sort": [{"column": "Grant Date", "direction": "desc"}]},
    "Vesting Schedule": {"columns": ["Grant ID", "Vest Date", "Shares Vested"],
                         "filters": [{"column": "Vest Date", "op": ">", "value": "2024-01-01"}]}
  }
}
EOF
```

Sheet merge — sources must share the same column schema; merged tab replaces source tabs:
```bash
UV_PYTHON_DOWNLOADS=never uv run "${_report_processor_path:-$(find ~ -name "report_processor.py" -path "*/carta-reporting/scripts/*" 2>/dev/null | head -1)}" <<'EOF'
{
  "local_file": "<path>",
  "sheets": {
    "Warrants":                   {"columns": ["Formatted Security ID", "Quantity Exercisable", "Exercise Price"]},
    "Equity Incentive Plan 2023": {"columns": ["Formatted Security ID", "Quantity Exercisable", "Exercise Price"]}
  },
  "merge_sheets": {
    "Pending Exercise": ["Warrants", "Equity Incentive Plan 2023"]
  }
}
EOF
```

All fields except the file source are optional — omit or set to `null` to skip that transform. Per-sheet values override any global transforms at the top level.

**Output:**
```json
{
  "data":  {sheet_name: {"columns": [...], "rows": [...]}},
  "stats": {sheet_name: {"original_row_count": N, "filtered_row_count": N,
                         "displayed_row_count": N, "missing_columns": [],
                         "skipped_formulas": []}}
}
```

---

## Caveats for Governance Queries

When the user's query is about preferred holders, liquidation seniority, or rights and preferences, always include this disclaimer in your response:

> Carta surfaces share ownership and voting structure, but does **not** expose actual consent thresholds or protective provision terms — those live in the Stockholders' Agreement and Certificate of Incorporation. This data identifies *who* holds voting preferred shares; an attorney must interpret *what* approvals are required and at what thresholds.

This applies whether the result is rendered as a live artifact or a markdown table.

---

## Best Effort

- **Authoritative**: report data comes directly from Carta. Business logic values (fully diluted ownership, liquidation proceeds, conversion amounts, IRR, etc.) must always come from a Carta report — never from Claude's calculations.
- **Claude-computed**: filtering, column selection, sorting, mechanical formulas (% of total, running sum, ratio, delta), and aggregations are performed by `report_processor.py` and should be treated as best-effort analysis, not official Carta output.
