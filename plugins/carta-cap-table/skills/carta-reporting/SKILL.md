---
name: carta-reporting
description: >-
  Build a custom cap table report or file for one company — filtered, sorted, or
  multi-column tables of grants, stakeholders, securities, SAFEs, convertible notes,
  preferred holders, liquidation seniority, and rights & preferences, delivered as an
  interactive artifact, markdown or Excel. Also handles any request starting with
  "Generate Carta Excel —" (the artifact prompt bar payload). For a single fact or a
  short answer (one holder's ownership, the largest grants, one stakeholder), use
  carta-cap-table. Defers to specialized skills for: SAFE/note conversion math, voting
  rights, issuance, modifying issuables, per-stakeholder vesting detail (use
  carta-grant-vesting for "How much has [name] vested?"), and round history lookup (use
  carta-round-history for "What was our Series B round?"). Not for cross-portfolio data.
model: sonnet
allowed-tools:
  - ToolSearch
  - mcp_registry_suggest_connectors
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__search_tools
  - mcp__carta__list_accounts
  - mcp__carta__request_permissions
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__search_tools
  - mcp__claude_ai_Carta__list_accounts
  - mcp__claude_ai_Carta__request_permissions
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__search_tools
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__request_permissions
  - Artifact
  - Agent
  - AskUserQuestion
  - Read
  - Write
  - Skill(carta-cap-table:carta-reporting-markdown)
  - Bash(date +%s)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_processor.py" *)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/build_report_page.py" *)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/build_template_definition.py" *)
  - Bash(UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_files.py" *)
  - Skill(carta-cap-table:carta-reporting-excel)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.110.3</carta-plugin>

# Custom Reports

<!-- [PATTERN carta-writing-style v0.0.2] [PATTERN etiquette v0.0.6] [PATTERN text v0.0.8] [PATTERN tables v0.0.12] [PATTERN carta-watermark v0.0.10] -->

Pull data directly from Carta and turn it into a customized report — filtered, sorted, and formatted to your specs. No SQL, no manual exports, no copy-paste.

**How it works:**
- Connects to your Carta account and searches for the right report type based on what you describe
- Lets you customize columns, filters, sorts, formulas, and aggregations in the chat
- Delivers results as a live interactive artifact (`Artifact` tool available) or a branded Excel file (`Artifact` tool not available)

> **Prerequisites**
> - Access to a Carta account with cap table data
> - Reporting feature enabled for your company (ask your Carta admin if unsure)
> - Claude Desktop: connects via the Carta integration button; Claude Code: uses an already-configured Carta MCP

## Trigger Examples

- "Show me grants this year"
- "List our SAFEs"
- "Who are our stakeholders?"
- "Show me convertible notes"
- "Show me vesting schedules" (company-wide: see the vesting note in step 3)
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
- "Save this as a template" (after a report is shown; see "Save as a template")
- "What can I export from the cap table?"
- "Compare my option grant spreadsheet with Carta" (see Reconciliation below)
- NOT: "What's [Alice]'s vesting schedule?" (use carta-grant-vesting instead)
- NOT: "What was our Series B round?" (use carta-round-history instead)

## Workflow

**Output rules — follow throughout every step:**
- Do not narrate internal steps, environment detection, or tool calls. Work silently.
- Only speak to the user when you need input, have a result to show, or must surface an error.
- Never expose technical terms like "MCP", "ToolSearch", "UUID", or "corporation_id" in user-facing messages.
- Use plain language. "I couldn't find that company" not "list_accounts returned no corporation_pk match."
- **When output mode is ARTIFACT (`Artifact` tool available): do not render report data as a markdown table in chat.** The only exceptions are trivially small results: a single data point, a single column with fewer than 10 rows, or a single row with 4 or fewer columns. All other results must go through the live artifact path.
- When output mode is MARKDOWN (`Artifact` tool not available): render all results as markdown tables and offer Excel export.

> **What happens if things aren't set up yet or take a while?**
> - **Carta isn't connected:** The skill will prompt you to connect — just reply "ready" when done.
> - **Reporting isn't enabled:** The skill will let you know and stop — reach out to your Carta admin.
> - **Preview takes too long:** The skill automatically switches to the full report once it's ready.

**Reconciliation:** when the user wants their own file (a spreadsheet, an HR export, a register) compared with Carta, do not build a report. Call `read_tool` with `cap_table__compute__reconciliation` once per security type, with `type` and the file's rows in `rows` (`holder`, plus `label` and the values to compare). When the file has more than 500 rows and a shell is available (Claude Code), upload it as a JSON list of the same objects with `cap_table__mutate__upload_url` (editors only) and send its key as `file_key`. Never split one file across calls: each call compares its rows with every Carta security of the type, so a split file reports false missing rows and partial totals. Show the counts, the totals and each issue; when `issues_complete` is false, say that only the first issues are shown.

**Staff overrides:** Before starting, silently `Read` `${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/staff/overrides.md`. If it doesn't exist, carry on without saying anything.
If the file exists, its instructions override the defaults in this skill for any section it covers. If absent, proceed with the defaults below.

**Report tool contract:** `${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/references/mcp-tool-reference.md` lists the only params each `reporting__*` tool accepts — send nothing else (no `include_drafts`, no `with_formula_enabled`, no `corporation_id` on `report_status`). `reporting__create__report` always goes through `call_tool`. If `create__report` or `search__report_types` returns `scope_required`, do not call it again yet: ask the user whether to grant Carta the permission the error names, and if they agree call `<_carta_prefix>request_permissions` (a top-level connector tool, not a `call_tool` name; no arguments) once, show them the authorization link it returns verbatim, and retry the call once after they say they have authorized. When the full and preview creates both return it, ask and call `request_permissions` once, then retry both. Only the main thread runs this: a subagent that gets `scope_required` returns it without retrying. If they decline or it is still refused, tell them in plain words that their Carta connection needs that permission, then stop.

**Tool discovery (ALL environments — run before any other step):** Call `ToolSearch` with query `"list_accounts"` and `max_results: 10`. Cache the full result set in memory as `_tool_results`. Do not call `ToolSearch` again anywhere in this workflow — all subsequent gates read from this cached result. The only exceptions are the two reconnect retries, each after the user says "ready": the FAIL outcome in step 0b and a failed access check in step 0c. Each re-runs this discovery and replaces `_tool_results`.

**Connector prefix:** `_carta_prefix` is the `mcp__<segment>__` of the confirmed `__list_accounts` tool, never a literal. Finding that tool does not mean calling it: step 1 calls it only as the fallback below. In Claude Desktop that is Gate 0b's PASS or PASS (unmapped connector) tool; in Claude Code it is the `__list_accounts` tool in `_tool_results`. Every Carta call this skill makes (`call_tool`, `read_tool`, `search_tools`, `list_accounts`, `request_permissions`), including those it hands to subagents, goes through `_carta_prefix`; the bare `read_tool(...)` / `call_tool(...)` calls below are shorthand for it. Pass `_carta_prefix` to every subagent that calls Carta, in its prompt. (The sub-skills `carta-reporting-markdown` and `carta-reporting-excel` make their own calls.)

**Working files:** downloaded report data lives under `carta-reporting/` in the working directory (the same folder as `config.json`), never `/tmp`, so the paths work on macOS and Windows alike. Background agents run in that same working directory and create the folder (with a `.gitignore` of `*`, so nothing in it can be committed) before they write anything.

**Script paths:** they are fixed — never search for them.
- `report_processor.py`: `${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_processor.py`
- `build_report_page.py`: `${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/build_report_page.py` (it reads the engine HTML itself; do not `Read` it)
- `build_template_definition.py`: `${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/build_template_definition.py`

Run each script only in the one-line form shown below, as its own command: write its input files with `Write` first, then pass them by flag. A heredoc, a pipe or a chained command needs approval every time.

> **Plugin root in reference files.** Reference files write the plugin root as a `CLAUDE_PLUGIN_ROOT` variable in braces. Bash does not set that variable, so never run it as written: replace it with the literal plugin root `${CLAUDE_PLUGIN_ROOT}`, keep every quote, and keep the command on one line.

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

   - **PASS:** At least one extracted segment is an exact match for a UUID value in the loaded environment map → that tool is the confirmed Carta connector. Set `_carta_prefix` to `mcp__<segment>__`. Continue to the reporting access check below.
   - **PASS (unmapped connector):** A `__list_accounts` tool was found, but none of the extracted segments match a UUID in the loaded environment map → before treating this as FAIL, make one live `list_accounts` call on that tool. A successful response means the connector works even though its environment UUID isn't in the map — treat as PASS and set `_carta_prefix` to that tool's `mcp__<segment>__`. Only a real 401/403 (or an explicit auth error) from this call falls through to FAIL.
   - **FAIL:** No `__list_accounts` tool was found in `_tool_results` at all, OR the live `list_accounts` call above returned a 401/403/auth error → call `mcp_registry_suggest_connectors` with the Production UUID from the loaded map. **Stop immediately — do not proceed to Step 1.** Say to the user: "I need access to [Company Name]'s Carta account to pull this report. Connect Carta using the button above — once you're in, say 'ready' and I'll pick up from here." When the user replies, re-run tool discovery (see its reconnect exception) and continue from this gate — do not ask them to repeat the original request.

   If multiple tools pass the gate, use the one whose environment appears earliest in the loaded map; its segment sets `_carta_prefix`. If the user's message includes an explicit environment qualifier (production, preprod, sandbox, test, demo), cross-check the confirmed UUID against that environment; if it doesn't match, treat as FAIL.

   **Switching accounts mid-conversation** — if the company is already identified from earlier in this conversation and the user is asking to switch to a different Carta account, skip the "Find the company" step once reporting access is confirmed (0c). Carry forward all previously resolved values and resume from "Find the right report type".

0c. **Confirm reporting access — runs in ALL environments (Claude Desktop and Claude Code)**

   Reporting access is a property of the connected Carta account (identified by `_carta_prefix`), not of an individual company, and it does not change within a conversation — so confirm it **once per connected account**. If `_reporting_access_confirmed` is already set to `true` in this session for the current `_carta_prefix`, skip this check entirely and proceed to Step 1 — do not re-call `search_tools`. (If the user switches to a different Carta connector mid-conversation, treat that as a new account and re-confirm.)

   Otherwise, call `search_tools({"query": "reporting"})` on `_carta_prefix` to query Carta's BM25 catalog (reporting tools are indexed, not pinned, so `ToolSearch` won't find them). If the response contains no `reporting__*` tools, tell the user: "Looks like reporting isn't enabled for this account yet. You can try a different Carta account, or reach out to your Carta contact to get it set up." Then stop — do not proceed to Step 1.

   If the `search_tools` call itself fails (tool not found, 401/403 or another auth error), say "I can't reach your Carta account. Make sure the Carta connector is set up and signed in, then say 'ready'.", stop, and when the user replies, re-run tool discovery (see its reconnect exception) to refresh `_tool_results`, then continue from step 0 (Claude Code, which skips step 0b, continues from 0c) — do not ask them to repeat the original request. Only a successful response with no `reporting__*` tools means reporting is off.

   On success, set `_reporting_access_confirmed` to `true` in session memory so subsequent report requests on the same connected account skip this round-trip.

0d. **Set output mode — runs in ALL environments (Claude Desktop and Claude Code)**

   Check whether the `Artifact` tool is available in this session.

   **GATE — pick exactly one outcome and hold it for the rest of this session:**

   - **`Artifact` available** → output mode is **ARTIFACT**. All non-trivial report data **must** be rendered as a published artifact. Do not render report data as a markdown table in chat. Skip this check for all subsequent steps — output mode is already set.
   - **`Artifact` not available** (tool not found) → output mode is **MARKDOWN**. Use markdown tables and Excel export for all results.

   Do not re-run this check later in the workflow. Do not rely on environment heuristics: only the `Artifact` tool decides the mode.

1. **Find the company** — do not call `list_accounts` or ask which company before step 1a's first read: Carta finds the company. Reuse the company already resolved in this conversation unless this prompt names or numbers another. Else send the numeric id the user gave, else the company name as the user said it, nicknames included, else no `corporation_id` (Carta uses the user's only company). For errors, follow `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` (the plugin's own `references/`, not this skill's; read it by that path, do not search for it), with these parts for this skill, which override its steps where they differ. Step 1a's `cap_table__list__cbus` call is the first read for each company. Take the numeric id from `meta.company.id` in that response and send it as `corporation_id` in every later call. `reporting__create__report` takes neither a default nor a partial name, so it always gets this id. When that read fails with an error that is not a company error (as find-the-company *Company errors* defines it), so it gives no `meta.company`, call `list_accounts` once on `_carta_prefix` for the id (with `search` when the user named the company), do a case-insensitive substring match across the account names, and take the number from `corporation_pk:<id>`. Ask with the `AskUserQuestion` tool, never in plain text: the user cannot respond to plain text questions. When find-the-company's steps or this fallback find nothing, do not ask the user for the company name (this replaces find-the-company's 'ask the user for the company name as Carta shows it' after an empty `list_accounts` search; its 'Carta found no single company for the user' case is still asked): say "I couldn't find [CompanyName] — it won't be included in the report" — never fabricate or estimate data for it. If the user names several companies, send all their step 1a reads in parallel in one main-thread message, ask once for each read that returns `ambiguous` or `not_found`, and run each `list_accounts` fallback on the main thread. Do not resolve companies in subagents: a subagent cannot call `AskUserQuestion`.

1a. **Resolve phantom equity display label (silent)** — run this step on the **main thread** for each company. A company error here (as find-the-company *Company errors* defines it) is step 1's company question, not a failed call. Do NOT delegate to a subagent — the resolved label must be available in the parent context before report processing begins.

   Call with `detail: "minimal"` and `page_size: 1` to check for CBU existence without fetching all records:
   ```
   read_tool({"name": "cap_table__list__cbus", "arguments": { corporation_id, detail: "minimal", page_size: 1 }})
   ```
   The `detail: "minimal"` response shape is `{ results: [...] }`. If `results` is empty or the call fails with an error that is not a company error, set `_phantom_label_<corporation_id>` to `null` — the corporation has no CBUs; step 1 takes the id from `meta.company`, or from its `list_accounts` fallback when the response has none.

   If `results` is non-empty, call `read_tool({"name": "cap_table__get__option_plans", "arguments": { corporation_id }})`. If this call fails for any reason (403, 404, network error, or unexpected response shape), set `_phantom_label_<corporation_id>` to `"Phantom Equity"` and continue — do not surface the error to the user. On success, look for any plan whose name suggests a phantom equity instrument (e.g. contains "Phantom", "PIU", "CBU", or similar). Use that plan's `name` field as `_phantom_label_<corporation_id>` if it differs from generic values like "Cash Bonus Units Plan". If no distinctive name is found, set `_phantom_label_<corporation_id>` to `"Phantom Equity"` as the fallback.

   Key per-corporation using `_phantom_label_<corporation_id>` (e.g. `_phantom_label_12345`) so multi-corporation flows each have their own label without collision.

   When `_phantom_label_<corporation_id>` is non-null, pass `"label_overrides": {"CBU": "<label>"}` to every `report_processor.py` invocation for that corporation. This applies to schema preview, preview report, and full report processing (step 4d, the markdown skill, and the Excel skill). **Exception:** the `Generate Carta Excel —` prompt-bar path enters `carta-reporting-excel` fresh without session context and cannot apply label overrides — this is a known limitation and out of scope for this fix.

1b. **Detect share-class-scoped access (silent)** — run once per resolved `corporation_id`, on the main thread:

   ```
   read_tool({"name": "cap_table__get__limited_admin_scope", "arguments": { corporation_id }})
   ```

   Store the response as `_scope_<corporation_id>`. Some company admins hold a share-class-scoped role: everything they read is already filtered to the share classes granted to them, so the data is safe either way — this call exists only so the report is *described* correctly.

   - `is_limited_admin: false` → nothing to do. Treat every later total as company-wide.
   - `is_limited_admin: true` with a non-empty `share_classes` → the report covers only those classes. Name them when you present the result, and never call a total or a percentage company-wide.
   - `is_limited_admin: true` with `share_classes: []` → the grant denies every share class, so every report will come back empty. Say that plainly and stop; do not queue a report to prove it.
   - The command is missing, or returns 403/404 → carry on exactly as for `is_limited_admin: false`. Do not surface the failure and do not retry.

   **`null` is not `[]`.** `share_classes: null` means unrestricted; an empty list means the grant denies every share class. Never read one as the other.

   **When `is_limited_admin` is true, drop `intermediate_cap` and `transactions_ledger` from any `reports` value you send** to `cap_table_summary_report` — see the reference file. Sending them yields a workbook with the sheet missing rather than an error.

2. **Find the right report type** — call `read_tool({"name": "reporting__search__report_types", "arguments": { corporation_id, query, json_export_supported: true }})` with a natural-language description of the data the user needs (e.g. `"option grants > 50% vested with exercise prices"`). Use `reports` from the response, ranked by `similarity`. If results are empty, rephrase the query with broader terms and try again.

   **Supported report types** (support `export_format: "json"`):
   `canceled_and_returned_report`, `cap_table_summary_report`, `common_securities_report`,
   `eightythreeb_elections_report`, `equity_awards_outstanding`, `equity_plan_granted_report`,
   `equity_plan_report`, `exercised_and_settled_report`, `historical_terminations_report`,
   `ocx_report`, `options_outstanding_report`, `rule_701_compliance_report`,
   `secondary_transaction_seller_model`, `securities_ledger_report`,
   `share_registry_report`, `stakeholder_details_report`, `stakeholder_ledger_report`,
   `stakeholder_share_registry_report`, `stakeholder_ownership_details_report`,
   `termination_modeling_report`, `vesting_details_report`

   This list is a fallback for ranking only — `reports` from the search response is authoritative,
   because it is already narrowed to what this account may run. Seven of the types above are
   unavailable to a share-class-scoped admin and will never appear in `reports` for one:
   `exercised_and_settled_report`, `historical_terminations_report`, `ocx_report`,
   `rule_701_compliance_report`, `secondary_transaction_seller_model`, `stakeholder_ledger_report`,
   `termination_modeling_report`.

   **Only run a type that `reports` returned** and, when its entry carries `runs_through_api_report`,
   only one with `runs_through_api_report: true`. `reporting__create__report` cannot run any other
   type, so a request for one only fails. Proceed with the top runnable result automatically — only ask for confirmation if the top two runnable results have nearly identical similarity scores AND the request is genuinely ambiguous between two different data categories. When the user's prompt clearly names a report type (e.g. "equity awards", "securities ledger", "vesting details", "exercised and settled"), proceed without asking.

   **2a. In MARKDOWN mode, still make the `reporting__search__report_types` call — skip only the
   ranking dialogue.** The response is the one place a share-class-scoped admin's narrower
   catalogue appears, so every matched type must be confirmed against `reports`. Take the top
   runnable result without asking, then continue to "Collect report details".

   **If the report the user needs is not runnable here, never send `reporting__create__report` a
   type outside `reports`, and do not fall back to the list above.** Never retry a type search did
   not return.
   - A type from the list above that is absent from `reports` is not available to this account.
     Say: "The **{Report Type}** report isn't available on your access level — I can run {two or
     three names from `reports`} instead. Which would you like?" Never describe this as lacking
     access to the company.
   - Any other report the user needs — one not in the list above, or returned with
     `runs_through_api_report: false` — can't be run from here. Say: "The **{Report Type}** report
     can be run from the Reports page in Carta. The closest report I can run here is
     **{closest runnable name from `reports`}** — would you like that instead?"

3. **Collect report details** — read `references/mcp-tool-reference.md` now (see the [MCP Tool Reference](#mcp-tool-reference) section for the `Read` path) and look up the matched report type in its **REQUIRED params by report_type** table. **Every param listed for that report type is required.** If missing, call `AskUserQuestion`. Default `as_of_date` to today (YYYY-MM-DD). Always use `export_format: "json"`.

   **Vesting without a named person.** `vesting_details_report` covers one stakeholder at a time and needs an issuance date range, so it cannot answer a company-wide "show me vesting schedules". When the request names no stakeholder, call `AskUserQuestion` before running it: "Schedule-level vesting detail is per person — which stakeholder, and which grant issue dates? Or I can show company-wide outstanding awards instead." If they choose company-wide, call `reporting__search__report_types` again with the query `"outstanding equity awards"` and run `equity_awards_outstanding` if it is in `reports`; if it is not, give step 2a's unavailable-type message.

   **Filters** — many report types accept filter params; the same reference file lists which filters each report type supports and the ID-lookup commands to resolve them. If the user mentions specific stakeholders, share classes, equity plans, securities, or a date range, resolve their IDs/values and pass the matching filter params as comma-separated strings — the report runs faster. `security_ids` takes comma-separated `TYPE:ID` strings (e.g. `"CERTIFICATE:42,OPTION:7"`); valid types: `CERTIFICATE`, `RSA`, `RSU`, `OPTION`, `SAR`, `CBU`, `PIU`, `WARRANT`, `CONVERTIBLE_NOTE`. Passing unsupported filters for a report type has no effect.

4. **Emit a status message before dispatching subagents** — before triggering any report generation, output a plain-language message to the user. Record the current time as `_report_start_time` (epoch seconds) on the **main thread**, immediately before dispatching the background `Agent` calls in steps 4b and 4c — this is the start of the generation clock. Do not record this inside the subagents. Capture it with `date +%s`, run on its own, one line.

   **Infer company size from the stakeholder count.** After resolving `corporation_id` in Step 1, call:
   ```
   read_tool({"name": "cap_table__get__stakeholders", "arguments": { corporation_id }})
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

   If several report types matched, issue each type's full and preview create pair in the same main-thread message, then run one 4b and 4c agent pair per type.
   **Both `user_report_pk` and `user_report_pk_preview` must be in hand before proceeding to 4b, 4c, and 4d.**

   **4b. Background subagent — poll and download the full report** — call the `Agent` tool with `run_in_background: true` in the **same message as 4c** so both background agents start simultaneously. Use this prompt, substituting real values:

   ```
   Poll and download a Carta report. Do not interact with the user. Do not output anything. Do not use isolation — this agent must write into the working directory, and it only writes download files under the git-ignored `carta-reporting/` folder.

   user_report_pk: <pk>
   corporation_id: <corp_id>
   carta_prefix:   <_carta_prefix>
   output_path:    carta-reporting/carta_report_<pk>.json
   The main thread treats the file's existence as "ready". Only `report_files.py` writes output_path, atomically, and it also creates the git-ignored `carta-reporting/` folder. Never write or move that file any other way.

   Steps:
   0. Every error below is written with this one-line command, `--message` being the quoted error text: `UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_files.py" error --out <output_path> --message "<error text>"`
   1. Poll `read_tool` on <carta_prefix> `({"name": "reporting__get__report_status", "arguments": { user_report_pk: <pk> }})` every 5 s, up to
      20 attempts.
      - Status "complete" → proceed to step 2.
      - Status "error" or "failed" → write the error "report failed" and stop.
      - Status "not_found" → write the error "report not found" and stop.
      - 20 attempts without complete → write the error "timeout" and stop.
   2. Call `read_tool` on <carta_prefix> `({"name": "reporting__get__download_url", "arguments": { user_report_pk: <pk>, corporation_id: <corp_id> }})`
      → presigned URL, only after step 1 returned "complete". On not_found, call report_status once more: if "complete", call download_url once more; if "pending", go back to step 1 within the attempts left; otherwise, or if download_url fails again, write the error "download_url failed" and stop.
   3. Run, as one command: `UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_files.py" download --url "<presigned_url>" --out <output_path>`
      If it exits non-zero it has already written the error "download failed" to output_path; stop.
   ```

   **4c. Background subagent — poll and download the preview report** — call the `Agent` tool with `run_in_background: true` in the **same message as 4b**. Use this prompt, substituting real values:

   ```
   Poll and download a Carta preview report. Do not interact with the user. Do not output anything. Do not use isolation — this agent must write into the working directory, and it only writes download files under the git-ignored `carta-reporting/` folder.

   user_report_pk_preview: <pk_preview>
   corporation_id:         <corp_id>
   carta_prefix:           <_carta_prefix>
   output_path:            carta-reporting/carta_preview_<pk_preview>.json
   The main thread treats the file's existence as "ready". Only `report_files.py` writes output_path, atomically, and it also creates the git-ignored `carta-reporting/` folder. Never write or move that file any other way.

   Steps:
   0. Every error below is written with this one-line command, `--message` being the quoted error text: `UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_files.py" error --out <output_path> --message "<error text>"`
   1. Poll `read_tool` on <carta_prefix> `({"name": "reporting__get__report_status", "arguments": { user_report_pk: <pk_preview> }})` every 5 s,
      up to 10 attempts.
      - Status "complete" → proceed to step 2.
      - Status "error" or "failed" → write the error "preview failed" and stop.
      - Status "not_found" → write the error "preview not found" and stop.
      - 10 attempts without complete → write the error "preview timeout" and stop.
   2. Call `read_tool` on <carta_prefix> `({"name": "reporting__get__download_url", "arguments": { user_report_pk: <pk_preview>, corporation_id: <corp_id> }})`
      → presigned URL only after step 1 returned "complete". On not_found, call report_status once more: if "complete", call download_url once more; if "pending", go back to step 1 within the attempts left; otherwise, or if download_url fails again, write the error "download_url failed" and stop.
   3. Run, as one command: `UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_files.py" download --url "<presigned_url>" --out <output_path>`
      If it exits non-zero it has already written the error "download failed" to output_path; stop.
   ```

   **4d. Main thread — wait for data, then build the artifact** — runs immediately after dispatching 4b and 4c. The page is built by `build_report_page.py` below.

   If the build or the publish fails, say so — do **not** fall back to the xlsx skill or generate Excel directly.

   Wait for the preview file with two one-line commands, each its own call (`--attempts` counts checks 5 s apart; the default is 12):
   1. `UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_files.py" wait --path "carta-reporting/carta_preview_<pk_preview>.json" --attempts 6`
   2. Only if it printed `{"ready": false}`: emit the mid-wait check-in below, then run `UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_files.py" wait --path "carta-reporting/carta_preview_<pk_preview>.json" --attempts 6`.

   The result is `{"ready": true, "error": <text or null>}` or `{"ready": false}`:
   - **Preview succeeded** (`ready` with `error` null) → use the preview file as the data source. The preview holds partial data, so add `["Status", "Preview — full report loading"]` to the artifact's `metaRows` and do not present its row count as final. If `build_report_page.py` exits with "No rows matched" on a build that used any preview file, treat it as **Preview failed** and run the full-report wait: the partial data says nothing about the final result.
   - **Preview failed** (`error` set, or `ready: false` after both waits) → switch to the full-report fallback: the **full-report wait**: run `UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_files.py" wait --path "carta-reporting/carta_report_<pk>.json" --attempts 20`, and while it prints `{"ready": false}` run it again, up to 3 calls in total. Do not raise `--attempts`: one call past about 2 minutes exceeds the Bash tool timeout. One call can give up while the 4b agent is still polling or downloading. `ready` with `error` null means the file is the data source; anything else is a failed full report (see the swap step).

   **Mid-wait check-in (emit exactly once per report request):** when the first wait ends with `ready: false` (no data yet), output this message to the user before the second wait:

   > Still processing — large reports can take a few minutes.

   Do not emit this message more than once. Do not emit it if the preview file arrives during the first wait.

   Once data file(s) are ready, proceed based on output mode:
   - **MARKDOWN mode (no `Artifact` tool):** invoke `Skill(carta-cap-table:carta-reporting-markdown)`. The following context is available in this session: data file path, `corporation_id`, `user_report_pk`.
   - **ARTIFACT mode (`Artifact` tool available):** build the artifact inline (no subskill invocation — see below).

   **Swap in the full report (when any data source was a preview).** After publishing the preview artifact, run the full-report wait in this same turn: for each corporation whose data came from its preview, run the full-report wait for its `carta_report_<pk>.json`. The wait is bounded by its 3 calls, and it ends at once when the 4b agent gives up, because the agent always writes an error file then. Then:
   - **Every full report landed without an `"error"` key** → run `report_processor.py` on the full files with the same config (including `label_overrides`) as the preview build, rebuild the artifact without the `Status` row(s) and with the normal description, and republish in place by passing the existing artifact `url`. Every sheet in it must come from a full report.
   - **Any failed or timed out** → if the error is "report not found", first recreate that report once: the same `reporting__create__report` call as 4a with the same params, then dispatch a fresh 4b agent for the new pk and wait again (run the full-report wait), saying nothing to the user. The new pk replaces `user_report_pk` for the rest of the session, including the hand-off to the output skill. A full report that lands this way is handled as above. For every other failure, or if that retry also fails: keep that corporation's preview sheets, set `["Status", "Preview only — {Corp Name}'s full report didn't finish"]` for each such corporation (a single corporation: `["Status", "Preview only — full report didn't finish"]`), rebuild with the full sheets for the rest, republish in place with a preview description, then say plainly: "The full report didn't finish for {Corp Name}, so that part shows only a preview of the data — tell me to retry."
   Then show the customization checkpoint below. Never present a preview as the final report.

   **Do not dispatch Excel generation here or in parallel with the artifact.** The Excel path opens only after the user responds to the customization checkpoint. Triggering Excel before that checkpoint bypasses the user's chance to adjust columns, filters, and transforms.

   **Multi-corporation (when step 1 resolved more than one corporation_id):**

   Steps 4a–4c run independently per corporation — trigger N×2 report pairs in parallel. Each corporation produces its own data file at `carta-reporting/carta_preview_<pk>.json` (or `carta-reporting/carta_report_<pk>.json` on fallback).

   Once all data files are ready, collect them as a list: `[(corp_legal_name, data_file_path), ...]`. In ARTIFACT mode, any file that is a preview is covered by the swap step above, per corporation.
   - **MARKDOWN mode:** invoke `Skill(carta-cap-table:carta-reporting-markdown)` with each corporation's data file in turn, presenting one markdown table block per corporation.
   - **ARTIFACT mode:** proceed with artifact build below, merging all corporations' sheets using `{Corp Name} — {Sheet Name}` prefixing (see multi-corporation guidance below).

   ---

   **Building the artifact (ARTIFACT mode only)**

   Run `report_processor.py` on each data file with no transforms to get schema data:

   Write `carta-reporting/config.json` (in the working directory) with:

   ```json
   {
     "local_file": "<data file path>"
   }
   ```

   Then run this as its own command, on one line. `--out` keeps the full result in a file, so you never retype the rows:

   ```bash
   UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_processor.py" --config "carta-reporting/config.json" --out "carta-reporting/result.json"
   ```

   The command prints `{"out": <path>, "stats": {...}}`, plus `"warnings": {...}` when there are any (see the warnings table below). Check `stats` and any `warnings` in that output before proceeding; never `Read` `result.json` (the rows stay in the file):
   - `missing_columns` non-empty → note the missing columns in the artifact's `metaRows` as "Columns unavailable: X, Y". Do not abort.
   - `filtered_row_count` = 0 on any sheet, or `empty_rows_dropped` equal to `filtered_row_count` (only empty placeholder rows matched) → `build_report_page.py` leaves that sheet out and lists it in `omitted_sheets`; note the omission when you present the report. If every sheet is empty it builds nothing and exits with "No rows matched those filters". Relay that, and offer to loosen the filter, only when every input was a full report; a build that used a preview file falls back to the full report instead (see step 4d).

   **CRITICAL:** the page is assembled by `build_report_page.py`, never by hand. It copies each non-empty sheet whole from `result.json` (`columns`, `rows`, `currency`, `row_currencies`, `summary_meta` — dropping `currency` or `row_currencies` makes every money cell show `$`), escapes text that could break the page, and puts the data before the engine, which the engine requires or the artifact renders blank.

   `Write` `carta-reporting/params.json` with the artifact's `config` object:

   ```json
   {
     "title":         "<Corporation> — <Report Type>",
     "reportType":    "<Human-readable report type>",
     "entityName":    "<Corporation legal name>",
     "corporationId": "<numeric corporation_id>",
     "userReportPk":  "<user_report_pk of the full report>",
     "generatedBy":   "<User full name>",
     "asOfDate":      "<YYYY-MM-DD>",
     "metaRows": [
       ["Corporation", "<legal name>"],
       ["As of Date",  "<YYYY-MM-DD>"]
     ]
   }
   ```

   `userReportPk` and `asOfDate` ride along in the Excel export prompt-bar payload so the Excel skill can find the report; `build_report_page.py` adds the per-sheet `sheetSources` itself.

   `metaRows` always include `Corporation` and `As of Date`; add `["Stakeholder", "<name>"]` for stakeholder reports, `["Period", "<issued_from> – <issued_to>"]` for date-range reports, `["Equity Plan", "<plan name>"]` when a plan is a param.

   Then run this as its own command, on one line:

   ```bash
   UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/build_report_page.py" --result "carta-reporting/result.json" --params "carta-reporting/params.json" --output "{slug}.html"
   ```

   It prints `{"output": <file>, "omitted_sheets": [...]}`.

   **Multi-corporation artifact:** The artifact engine has exactly one `id="sheetsNav"` and one `id="sheets"` element, so build one page: run `report_processor.py` once per corporation with its own `--out` (`carta-reporting/result-<corporation_id>.json`); each run prints its own `stats`, then pass every result to `build_report_page.py` with `--result "<file>" --label "<corporation name>" --report "<corporation_id>:<user_report_pk>"` repeated once per corporation (each corporation's own full-report `user_report_pk`; `userReportPk` in `params.json` is for a single corporation). Two sheets with the same final name are refused, so each corporation needs its own `--label`. Sheets come out named `"Meetly — Securities Ledger"`, `"BiscuitByte — Securities Ledger"`. Set `entityName` in `params.json` to comma-joined corporation names, `title` to `"Multi-Corporation — {Report Type}"`, and include one `["Corporation", "{name}"]` metaRow per corporation. This one page is only the view: its Excel export bar produces one Excel file per report (one per corporation), through `carta-reporting-excel`, not a single workbook.

   **Naming** — use a short slug: `{stakeholder-or-entity}-{report-type}`, e.g. `meetly-securities-ledger`.

   One short sentence before publishing ("Building your report…"), then publish the file `build_report_page.py` wrote:

   ```
   Artifact({
     file_path: "{slug}.html",
     title: "{Company Name} — {Report Type}",
     description: "{Report Type} for {Company Name} — {N} rows as of {date}.",
     favicon: "📋"
   })
   ```

   For an artifact built from a preview, use the description `"{Report Type} for {Company Name} — preview, {N} rows so far, as of {date}."`; the swap step republishes with the description above.

   The payload is baked into the page, so it needs no `capabilities`. To refresh a report
   already published this session, pass that artifact's `url` so it redeploys in place.

   **Present a customization checkpoint after the full report renders (or fails), and after every later rebuild — never for the preview artifact:**

   Compute `{elapsed}` as the output of `date +%s` (run on its own, one line, no shell arithmetic) minus `_report_start_time`, rounded to the nearest whole second.
   Compute `{N}` as `kept_row_count` (sum across all sheets) from `report_processor.py`'s `stats` output — the data rows in the report, before any preview cut. When any sheet has `empty_rows_dropped` > 0, also say so, using the `empty_rows_dropped` row of the Error Handling table.

   > Here's your **{Report Type}** for **{Company Name}** — {N} rows as of {date}, built in {elapsed}s.
   >
   > _(When the full report failed, use instead: "Here's a preview of your **{Report Type}** for **{Company Name}** — {N} rows so far (the full report didn't finish), as of {date}." The Status row and the chat message above are the preview caveat.)_
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
   >
   > _(Add this line only when `_templates_available_<corporation_id>` is `true` after the check in "Save as a template":)_ Or say **Save this as a template** to keep the report in Carta and run it again at a new as-of date.

   If the dataset is large (> 300 rows), append: "This report has {N} rows — you may want to filter before exporting." (For a preview: "The preview already has {N} rows.")

   **Percentage columns under a share-class scope.** `pct_of_total` divides by the sum of the rows
   in the report. When `_scope_<corporation_id>` reports `is_limited_admin: true` that denominator
   is the in-scope total, not the company's, so name the column "% of {Share Class} Total" — or
   "% of In-Scope Total" for more than one class — and never present it as ownership of the
   company. Carta withholds its own formula columns from this role for the same reason.

   **Never generate Excel files directly** — no openpyxl, xlsxwriter, SpreadsheetML, or any other method. The only permitted Excel output path is `Skill(carta-cap-table:carta-reporting-excel)`.

   If the user requests a change (different filter, sort, or columns), update only the affected config field and re-generate the artifact — do not restart the workflow. When the user says **Export to Excel**, invoke `Skill(carta-cap-table:carta-reporting-excel)`.

5. **Show a preview** — the artifact created in step 4d is the live preview.

6. **Export to Excel**
   - **Claude Desktop prompt bar** — when the user's message starts with `Generate Carta Excel —`, skip steps 1–5 and invoke `Skill(carta-cap-table:carta-reporting-excel)` directly. The payload includes the corporation ID, so no company lookup is needed.
   - **MARKDOWN mode (`Artifact` tool not available)** — handled by `carta-reporting-markdown`, which invokes `Skill(carta-cap-table:carta-reporting-excel)` when the user confirms.

---

## Save as a template

A report built here can be kept in Carta as a template: its sheets, columns, filters and sort, with no as-of date, so it can be run again at a new date. This step is only for a report the user has seen in full.

**Check once per company, before that company's first customization checkpoint is shown:** whether templates are on is decided per company, so a listed tool says nothing. Call `read_tool({"name": "reporting__list__report_templates", "arguments": { corporation_id }})`. Set `_templates_available_<corporation_id>` to `true` only when the call succeeds; on any failure (templates not enabled for the company, not found, no permission, or anything else), set it to `false` and do not retry. When it is `false`, never offer a template and never mention one. If the user asks for one anyway, say "I can't save this report as a template for this company right now." and stop.

**Run this when the user says "save this as a template" (or accepts the offer in the checkpoint), in either output mode:**

0. **Decide availability first.** If `_templates_available_<corporation_id>` is not set for this company (in MARKDOWN mode the check above never ran), run that check now, and stop as it says when it is `false`.

1. **One company, full report only.** If the report covers more than one company, say a template is saved for one company's report at a time and stop. If only a preview of the data came in, say the template can be saved once the full report has loaded, and stop. The data file for the save is the full report's `carta-reporting/carta_report_<pk>.json`.

2. **Ask for the name and the audience in one `AskUserQuestion` call** (two questions):
   - *Name*: offer a short name that says what the report shows, such as "Outstanding grants by holder", and the report type's own name as the second option. The user can type their own.
   - *Who can see it*: "Only me" (recommended, the default) or "All company admins".

3. **Write the inputs**, each with `Write`:
   - `carta-reporting/template-config.json`: the current `carta-reporting/config.json`, with `sheets` set to a list of the sheets shown in the report when the config names none. In ARTIFACT mode those are the sheets in `report_processor.py`'s `stats` that `build_report_page.py` did not list in `omitted_sheets`; in MARKDOWN mode, the sheets in `report_processor.py`'s `stats`.
   - `carta-reporting/template-name.txt`: the name, exactly as the user chose it, and nothing else.
   - `carta-reporting/create-params.json`: the `arguments` object of the full report's `reporting__create__report` call.

4. **Build the definition**, as its own command, on one line. The name goes in by file, never on the command line:

   ```bash
   UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/build_template_definition.py" --config "carta-reporting/template-config.json" --report "carta-reporting/carta_report_<pk>.json" --report-type "<report_type>" --name-file "carta-reporting/template-name.txt" --create-params "carta-reporting/create-params.json" --out "carta-reporting/template-definition.json"
   ```

   - **It exits 1 and prints `{"refused": [...]}`:** nothing is saved. Tell the user why in plain words, one line per reason, and offer to change the report so it can be saved (for example, drop the formula, or pick another column for the column or filter a reason names). Do not retry the same input.
   - **`dropped_params` is not empty:** after the save, say the template does not keep those filters (name each one the report used: people, plans, securities, share classes or issue dates), so every run covers all of them.

5. **Save it.** `Read` `carta-reporting/template-definition.json`, then `call_tool({"name": "reporting__create__report_template", "arguments": { corporation_id, name, visibility, definition }})`. `name` is the definition's `default_name`, and `definition` is passed exactly as the file holds it, so the two names match. `visibility` is `"creator"` for "Only me" and `"company_admins"` for "All company admins". On success the result has the template's `id`; say: "Saved **{name}** in Carta — {Only you can run it | Company admins can run it}. Run it again from Run Reports at a new as-of date." Never show the id.

**When the save does not go through, always tell the user; never drop a save silently. The report on screen is unchanged.**

| Answer | Tell the user |
|---|---|
| `scope_required` | Handle it as for `reporting__create__report`: ask, call `request_permissions` once, then repeat the save once. |
| The name is taken | Ask for another name with `AskUserQuestion`, write it to `carta-reporting/template-name.txt`, then repeat steps 4 and 5 once with it. |
| A list of problems with the definition | Say each problem in plain words (the column or filter and what is wrong) and that nothing was saved. For a report type Carta does not take yet, say which report types it does take, as its reason names them. For an `unknown_sheet` problem on a sheet saved by its own name, say that its name comes from the company's data (a share class, a plan) or its terms, so a template cannot find it by name on another date; offer to merge it with the sheets that share the same start or end of name, which a template can save. |
| Templates aren't enabled for this company, or Carta did not save it | "I couldn't save this as a template in Carta. Your report is still here." Do not retry. |
| They can't run this report here | "I couldn't save this as a template: your access doesn't let you run this report at this company. Your report is still here." Do not retry. |
| Any other failure, or no answer | Say the save may not have gone through. Call `read_tool({"name": "reporting__list__report_templates", "arguments": { corporation_id }})` once to check; report whether a template with that name is there. Never save the same template twice. |

---

## MCP Tool Reference

The full call signatures, filter-param support matrix, and **required-params-by-report-type**
table live in `references/mcp-tool-reference.md` (kept out of the always-loaded skill to
reduce context). Read it on demand — only when you need to look up a required param, a filter
param, or an ID-lookup command. `Read` it at
`${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/references/mcp-tool-reference.md`; do not search for it.

Keep the contents in memory the first time you read it; do not read it again within a session.

---

## Error Handling

| Symptom | Cause | Tell user |
|---|---|---|
| No matching report types | Query didn't match any known report type | Describe what kinds of reports are available and ask what they're looking for |
| `403` with a message naming share classes or an access level | The account holds a share-class-scoped role that cannot run this report type, or cannot run it across several companies. This is a restriction on the report, not on the company. | Relay the message's own wording, then offer an alternative from `reports`. Never say they lack access to the company. |
| `403` / access denied, no message | Your account doesn't have permission to access this company's data. | "It looks like you don't have access to this company's Carta data. Reach out to your Carta admin to request access." |
| `status: error` | Report generation failed. If single report: regenerate once sequentially. If parallel reports: retry failed ones one at a time (sequential — parallel retries cause load failures). If still failing after retry: skip and continue. | "I wasn't able to generate the [Report Name] report — continuing with the rest." |
| `status: error` and `_scope_<corporation_id>` has `is_limited_admin: true` | The status carries no reason, but the most common cause for a scoped account is that no share class in its scope has data for this report. Retry once, then stop — a second failure will not clear. | "I couldn't generate the **{Report Type}** report. Your access covers {share class names}, and this report may have nothing there. Want me to try {alternative from `reports`} instead?" |
| `status: not_found` | Report expired. The 4b agent writes `report not found` as the error. | Silent: the main thread recreates that report once with the same params and dispatches a fresh download agent (4d swap step); the new pk replaces `user_report_pk` for the rest of the session. Only if that also fails, use the "didn't finish" wording there. |
| `empty_rows_dropped` > 0 | Rows whose numeric columns are all zero or blank were dropped (placeholder security types Carta emits for types never issued). Not applied to a sheet with a filter asking for zero on a numeric column (op `=`, value 0, e.g. `Shares = 0`): the all-zero rows it matched are the answer and stay. Any other numeric filter (e.g. `Shares < 1000`) still drops them. | "{K} rows with no values were left out." (K = sum of `empty_rows_dropped` across sheets) |
| `filtered_row_count` = 0 | No rows matched the filters | Full-report build: "No rows matched those filters." Offer to loosen the filter or try a different date. Preview build: do not relay; run the full-report wait first. |
| `original_row_count` > ~1,000 rows | Large dataset | "This report has a lot of rows — want to narrow it down by date range, report type, or a specific person?" |
| `401` / session expired | Auth expired | "It looks like your Carta session expired — reconnect and try again." |
| `user_report_pk` missing from response | Transient API error | "Something went wrong generating this report — it may be a temporary issue. Try again in a moment, or contact your Carta team if it keeps happening." |
| `mixed_currency_columns` non-empty | That column's amounts are in more than one currency, so its totals (summary or per group), `pct_of_total`, `running_sum` and `delta` were left out — those formulas are also listed in `skipped_formulas`. Never total them yourself. | "'[Column]' has amounts in several currencies, so I left its total out rather than add them together." |
| `missing_columns` or `skipped_formulas` non-empty (other than for `mixed_currency_columns`) | Column name mismatch or formula source column not included | "Heads up — '[Column]' wasn't available in this report type and was left out." |
| `unknown_filter_columns` non-empty | A filter named a column this sheet does not have, so **that filter did not run** and the rows shown are broader than asked for. Never present the result as filtered. | "I couldn't filter on '[Column]' — it isn't in this report, so these rows are unfiltered. Here are the columns I can filter on: […]" Offer to re-run against a real column. |
| `unknown_sort_columns` non-empty | A sort named a column this sheet does not have, so **that sort did not run** and the rows are not in the order asked for. Never present the result as sorted. A column that is one of the `formulas` names you requested is computed after the sort runs, so it cannot be sorted on (unless it is aggregated by a `group_by`). | Formula column: "I can't sort by a computed column — the rows are not sorted by '[Column]'". Any other name: "I couldn't sort by '[Column]' — it isn't in this report, so the rows are not sorted by it. Here are the columns I can sort on: […]" Offer to re-run against a real column. |
| `unsupported_filters` non-empty | A `>`, `<`, `>=` or `<=` filter named a text column, which has no order, so **that filter did not run** and the rows shown are broader than asked for. Never present the result as filtered. | "I couldn't apply '[Column] [op] [value]' — '[Column]' is text, so these rows are unfiltered on it." Offer `=`, `!=` or `contains` instead, or a numeric or date column. |
| `structural_rows_dropped` > 0 | The sheet has section headings or total rows, and a filter, sort, column pick, formula or aggregation was applied, which cannot keep them in place. | "Section headings and totals were left out because of the filters/sort — say so if you want them back unsorted." |
| `warnings.unknown_sheets` present | A name in `warnings.unknown_sheets.requested` is not in this report, so it was left out. | "This report has no sheet called '[Name]'. Its sheets are: […]" (list `warnings.unknown_sheets.available`) Offer to re-run with a real sheet. |
| `warnings.merge_sources_missing` present, or `stats[<merged sheet>].schema_warnings` non-empty | A sheet to merge was missing (`warnings.merge_sources_missing[].source`), or its columns differ (`schema_warnings`), so its rows are not in the merged tab. | Name the sheet that was left out and why; never present the merged tab as complete. |
| `filtered_row_count` == `original_row_count` with filters set | The filters matched every row. Legitimate, but confirm it is not a mis-typed filter before presenting. | State plainly that the filter matched all N rows. |

---

## Script Reference: report_processor.py

All post-processing (filter, column selection, sort, formulas, aggregations, preview) runs through this script. Called by `carta-reporting`, `carta-reporting-markdown`, and `carta-reporting-excel`. Never apply these transforms in Claude's memory.

Each example is the config file's content. Write it to `carta-reporting/config.json`, then run the one-line command shown with the first example.

Single sheet (global transforms):
Write `carta-reporting/config.json` (in the working directory) with:

```json
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
```

Then run this as its own command, on one line:

```bash
UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_processor.py" --config "carta-reporting/config.json"
```

**Filter ops** — a filter's `op` must be exactly one of:

| Op | Meaning | Applies to |
|---|---|---|
| `>` `<` `>=` `<=` | ordering comparison | numeric and date columns |
| `=` | equals | all types (string match is case-insensitive) |
| `!=` | not equals | all types |
| `contains` | substring match | all types (case-insensitive) |

**Equality is `=`, not `==`. `==` is not a valid op** — nor are `eq`, `in`, `startswith`,
or any SQL/pandas operator. Anything outside the table above raises an error and the
report does not run.

`filters` uses the column's **display name** exactly as it appears in the sheet's
`columns`. A filter naming a column the sheet does not have is reported in
`stats.unknown_filter_columns` and applies no restriction — check that field before
presenting a filtered report, the same way you check `missing_columns`. An ordering op
(`>` `<` `>=` `<=`) on a text column applies no restriction either; it is reported in
`stats.unsupported_filters` as `{"column", "op"}`.

`sort` runs before `columns` selects, so a sort column need not be one of the selected columns.
Rows with no value in the sort column go last, ascending or descending. A sort naming a column
the sheet does not have applies no ordering and is reported in `stats.unknown_sort_columns`; so does a
sort on a `formulas` column (formulas run after the sort), unless a `group_by` aggregates it.
`running_sum` and `delta` over a money column are money, in the currency of the source cells.
A summary's totals row is `{"_t": [cells]}`, like a source totals row, and its "Total" label sits in
the first visible (not `hidden`) column with no aggregation (no label when every such column has one).
A sheet with a filter asking for zero on a numeric column (op `=`, value 0) keeps its all-zero rows
(no `empty_rows_dropped`); other numeric filters still drop them.

`label_overrides` — optional dict mapping raw string cell values to display names. Applied to all string-typed columns across every sheet. Use to replace Carta's internal security type codes with the corporation's configured equity language names (e.g. `{"CBU": "Phantom Units"}`). Matching is exact and case-sensitive.

Multi-sheet with per-sheet config:
Write `carta-reporting/config.json` (in the working directory) with:

```json
{
  "local_file": "<path>",
  "sheets": {
    "Equity Grants":    {"columns": ["Grant ID", "Award Type", "Exercise Price"],
                         "sort": [{"column": "Grant Date", "direction": "desc"}]},
    "Vesting Schedule": {"columns": ["Grant ID", "Vest Date", "Shares Vested"],
                         "filters": [{"column": "Vest Date", "op": ">", "value": "2024-01-01"}]}
  }
}
```

Then run this as its own command, on one line:

```bash
UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_processor.py" --config "carta-reporting/config.json"
```

Sheet merge — sources must share the same column schema; merged tab replaces source tabs:
Write `carta-reporting/config.json` (in the working directory) with:

```json
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
```

Then run this as its own command, on one line:

```bash
UV_PYTHON_DOWNLOADS=never uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-reporting/scripts/report_processor.py" --config "carta-reporting/config.json"
```

All fields except the file source are optional — omit or set to `null` to skip that transform. Per-sheet values override any global transforms at the top level.

**Output:**
```json
{
  "data":  {sheet_name: {"columns": [...], "rows": [...]}},
  "stats": {sheet_name: {"original_row_count": N, "filtered_row_count": N,
                         "empty_rows_dropped": N, "kept_row_count": N,
                         "displayed_row_count": N,
                         "missing_columns": [], "unknown_filter_columns": [], "unknown_sort_columns": [],
                         "unsupported_filters": [],
                         "skipped_formulas": [], "structural_rows_dropped": N,
                         "mixed_currency_columns": [],   // merged tabs: every list stat is the union over the merged sources
                         "merged_from": [...], "schema_warnings": [...]}},   // last two: merged tabs only
  "warnings": {"unknown_sheets": {"requested": [...], "available": [...]},
               "merge_sources_missing": [{"target": ..., "source": ...}]}   // keys present only when raised
}
```

With `--out <file>`, this JSON is written to the file and stdout carries `{"out": <file>, "stats": {...}}`, plus `"warnings"` when non-empty.

A money column's total, group totals, `pct_of_total`, `running_sum` and `delta` combine its
amounts across rows, so they run only over amounts in one currency (the sheet's base currency, or a row or cell
override). Over several currencies the aggregate is `null`, the column is left out of
`summary_meta.ops` and the formula is skipped; `mixed_currency_columns` names it. A total or
group row whose amounts are all in a non-base currency carries it in `row_currencies`.

A merged tab built from more than one source has no `summary_meta`: each source's Total row stays a
literal value in its own currency, and Excel writes no `SUM` across sources. Each list stat of a
merged tab (`missing_columns`, `unknown_filter_columns`, `unknown_sort_columns`, `unsupported_filters`, `skipped_formulas`,
`mixed_currency_columns`) is the union over the merged sources, in first-seen order, so a source's
skipped formula or unrun filter still shows.

`kept_row_count` is the data rows in the result, before the preview cut: after grouping, without a summary totals row. `displayed_row_count` counts the displayed rows other than section headings and `_t` totals rows (a summary aggregation's Total row is counted), so it is < `kept_row_count` exactly when a preview cut data rows.

---

## Caveats for Governance Queries

When the user's query is about preferred holders, liquidation seniority, or rights and preferences, always include this disclaimer in your response:

> Carta surfaces share ownership and voting structure, but does **not** expose actual consent thresholds or protective provision terms — those live in the Stockholders' Agreement and Certificate of Incorporation. This data identifies *who* holds voting preferred shares; an attorney must interpret *what* approvals are required and at what thresholds.

This applies whether the result is rendered as a live artifact or a markdown table.

---

## Best Effort

- **Authoritative**: report data comes directly from Carta. Business logic values (fully diluted ownership, liquidation proceeds, conversion amounts, IRR, etc.) must always come from a Carta report — never from Claude's calculations.
- **Claude-computed**: filtering, column selection, sorting, mechanical formulas (% of total, running sum, ratio, delta), and aggregations are performed by `report_processor.py` and should be treated as best-effort analysis, not official Carta output.
