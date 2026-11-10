---
name: carta-partner-rollforward
description: >
  Partner rollforward as a persistent Cowork artifact, firm-wide by default and
  filterable by fund or fund family. Four views: the partner rollforward (the in-app
  Statements > Partner Rollforward tab, across funds), a month-by-month partners'
  capital walk with carried interest accrued broken out, a one-LP capital account
  statement itemized by allocation bucket for audit confirmations (CSV or PDF), and a
  commitment / funded / unfunded rollforward for capital calls. Data from Carta via the MCP.

  Triggers: "partner rollforward", "partners' capital rollforward", "capital account
  rollforward", "partner capital statement", "rollforward by fund family",
  "carried interest accrued by partner", "audit confirmation capital account",
  "rollforward unfunded commitment for a capital call".
  Use instead: carta-explore-data for a one-off number; carta-soi for the schedule of
  investments (holdings), not partner capital.
version: 1.0.0
model: inherit
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__welcome
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  # Step 2: find the firm the user names (list_contexts) and switch to it (set_context).
  - mcp__carta__list_contexts
  - mcp__claude_ai_Carta__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - Artifact
  - AskUserQuestion
  - read_skill
  - Read
  - Write
  - Bash(carta workspace cache *)
  - Bash(command -v *)
  - Bash(jq *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/scripts/render_artifact.py" *)
  - Bash(mkdir -p *)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.34.0</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN base v0.1.0]

# Partner Rollforward Skill

Creates (or refreshes) a persistent Cowork artifact that rolls every partner's capital account from a beginning balance to an ending balance, across all of a firm's funds. The artifact **fetches its own rows from Carta every time it is opened**, so it never goes stale; the skill injects only configuration — the connector name, the firm, and the table names.

The in-app Partner Rollforward tab shows one fund at a time. This artifact opens on the whole firm and narrows with one fund picker that every view shares: fund families with their funds indented beneath, a search box, and ticks that take effect on **Apply**. Each view is one table, with the tabs and filters pinned at the top and the table's header row and first column fixed while it scrolls. The Rollforward and Monthly capital walk show one column per allocation bucket the firm uses, zero where a fund had none, so their columns do not change with the funds or period picked; the walk never shows memo buckets. **Select columns** (shared by the Rollforward and Monthly capital walk tabs) hides columns, and on the Rollforward *Show memo items* adds the memo buckets. The LP statement lists every bucket the firm uses as a row, memo items included, so its lines add up. The Capital call has fixed columns of its own. Every view opens on the last full calendar quarter. Funds, investors and the investor picker read by currency, the firm's currency with the most funds first, then largest commitment first within each currency; clicking the *Fund / investor* header sorts them A–Z. The fund picker lists families newest first. A few headers a fund finance reader could misread carry a small info icon that defines them on hover or keyboard focus, on the Rollforward and the Monthly capital walk; they are not in the CSV. Every column resizes by dragging its header's right edge, and a double-click on the edge resets it; the *Fund / investor* column opens at most 320px wide, a longer name ending in … with the full name on hover.

## What the artifact shows

| View | For | Content |
|---|---|---|
| **Rollforward** (default) | Firm-wide review | One table, one collapsed row per fund (click to expand its partners): **Ties to Carta NAV**, commitment, commitment percentage, partner type and class, beginning balance, one column per allocation bucket, ending balance, ending balance percentage (each partner's share of the fund's ending balance, shown in the $ view; View by % already reads the ending balance that way). Same controls as the app: period, **View by $ / %**, **Select columns**, **Compare to** (previous period or same period last year), export. |
| **Monthly capital walk** | "What is changing each partner's ending balance" | One table: a heading row per selected fund (or investor record), one row per month and a period total, for all investors or one, with **Carried interest accrued** as its own highlighted column. **Select columns** hides columns here too. |
| **LP statement** | Audit confirmations | One investor in each selected fund they hold, in one table: every allocation bucket the firm uses, by month with period totals, beginning and ending balance, and whether it ties to Carta's NAV. Exports to CSV, or to PDF as a capital account statement (one page per partner record, so per fund and class, marked unaudited). |
| **Capital call** | Capital call preparation | Commitment, funded and unfunded balances rolled over the chosen period, plus called-but-not-received and deferred calls. Each partner row, on screen and in the CSV's Investor column, names its share class as the LP statement does (*Jane Smith · Class B*), so an investor with two classes in a fund reads as two records, not a duplicate. |

**Ties to Carta NAV** is the first column after the name, for each fund and each investor: *Yes* when the ledger's ending balance equals Carta's month-end NAV, or *Differs by …* when it does not. Every view, the LP statement and its PDF included, reads an investor's tie from the same fund-wide comparison, so they never disagree. The reader should never have to take the numbers on trust.

## Steps

Steps 2–4 each carry a network round-trip. Post a one-line status after each — connecting, checking the data, rendering, publishing.

### 1. Identify the Carta connector
Scan the tools available in the conversation (system-reminder blocks) for a `call_tool` that has a matching `welcome` from the same connector. Cowork and claude.ai name them `mcp__claude_ai_<connector>__call_tool`; the Claude desktop app names them `mcp__<connector_id>__call_tool`, where the id is opaque and the display name comes from the session's connector list or the server's instructions (Carta's is `Carta`). None found → tell the user you checked the conversation's tool list for a Carta connector (`call_tool` + matching `welcome`) and found none, point them to connect one via their claude.ai connector settings, and stop (error table: *No connector found*). Exactly one → use it. Multiple → ask the user which.

Keep that connector's **display name** as `<CARTA_MCP_SERVER>`. The artifact runtime addresses a connector by display name and the tool names are bare verbs (`call_tool`, `welcome`). Never substitute a UUID or an `mcp__…__` tool name — the runtime rejects both.

### 2. Call welcome and resolve the firm
Call `mcp__<SERVER>__welcome(_instrumentation={"plugin": "carta-investors", "skills": ["carta-partner-rollforward"]})` — every run, including a refresh. If it fails, tell the user what `welcome` returned and that the report cannot resolve firm context without it, then stop (error table: *`welcome` fails*).

**Resolve the firm the user means, even if another firm is active.** Row access follows the active firm, so pick the firm before any query runs. Call `list_contexts`, passing the name if the user gave one:

```text
list_contexts({"firm_name": "<firm_name>"})
```

Read `firms` and `active_firm_id` from the structured result. For a Carta staff account the name is a search across all firms; for everyone else it is ignored and you get their own firms, so match the name yourself.

- **Exactly one match** → use it and say which firm you are building for.
- **Several match** → ask with `AskUserQuestion`, one option per firm.
- **None match** → say which name you searched, list up to five firms they can access, and stop (error table: *Named firm not found*).
- **No firm named** → take the single firm, or the one whose `is_active` is true, and confirm it in the same turn. With several firms and none active, ask. An empty list is normal for a staff account, so ask which firm rather than stopping.

If that firm is not already active, switch before going on:

```text
set_context({"firm_id": "<firm_uuid>"})
```

Carry its name into `firm_name` and its UUID into `firm_context_id`. The artifact re-pins the context on every load, because the viewer's connector opens on whatever firm they last used.

Every Carta tool call in this skill carries `_instrumentation`.

### 3. Validate the data in one query
The schema is known (below), so there is no discovery pass. Run this once; it proves the table names resolve, proves the firm has partner activity, and yields `firm_warehouse_id`:

```text
read_tool({"name": "dwh__execute__query",
           "arguments": {"sql": "<SQL>", "format": "markdown"},
           "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-partner-rollforward"]}})
```

The param key is `sql`, not `query`. `format` accepts `"markdown"` / `"ndjson"`. SELECT only. No firm filter — row access scopes it.

```sql
SELECT f.FIRM_ID AS firm_id, COUNT(DISTINCT f.FUND_UUID) AS funds,
       COUNT(DISTINCT f.FUND_FAMILY_ID) AS fund_families, COUNT(DISTINCT f.REPORTING_CURRENCY) AS currencies
FROM FUND_ADMIN.FUNDS f
WHERE f.FUND_UUID IN (SELECT a.FUND_UUID FROM FUND_ADMIN.ALLOCATIONS a)
GROUP BY f.FIRM_ID
```

- One row → its `firm_id` is `firm_warehouse_id`. **It can be a different ID from `firm_context_id`** for the same firm, and neither can be derived from the other, so always take it from this row. The artifact pins the firm in its SQL with this id and refuses to render any page carrying another firm's rows.
- Several rows (a staff account scoped to nothing) → you did not pin a firm in Step 2; go back and do.
- Zero rows → tell the user the firm has no partner ledger activity in this context and stop (error table: *No partner activity*).
- A table or column error → run `read_tool({"name": "dwh__list__tables", "arguments": {}, "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-partner-rollforward"]}})`, find the datashare name for the missing table (the same table with a `FUNDADMIN_DATASHARE_` prefix is the usual variant), put it in `tables`, and re-run once. If it still fails, stop (error table: *Table not found*).

Do **not** put these numbers in the artifact. It re-fetches on open.

### 4. Assemble the config
```text
{ mcp_server: "<CARTA_MCP_SERVER>", firm_name: "<firm resolved in step 2>",
  firm_context_id: "<firm UUID from list_contexts>",
  firm_warehouse_id: "<firm_id from step 3>",
  tables: { funds: "FUND_ADMIN.FUNDS", partners: "FUND_ADMIN.PARTNER_DATA",
            nav: "FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS",
            allocations: "FUND_ADMIN.ALLOCATIONS" } }
```

Table names must be plain identifiers (letters, digits, `_`, `.`); the artifact refuses anything else because they are placed in SQL.

### 5. Render the artifact (deterministic — via `render_artifact.py`)
The template stays out of your context: a bundled script reads it, applies the XSS-safe escaping and writes the finished HTML. **You write only the small config file and run the script — never load or emit the template, and never hand-author the escaping.**

**5a. Locate the workspace:**
```bash
if [ -d "$HOME/mnt/outputs" ] && [ -w "$HOME/mnt/outputs" ]; then WORKDIR="$HOME/mnt/outputs/carta-partner-rollforward"
elif command -v carta >/dev/null 2>&1; then WORKDIR="$(carta workspace cache carta-partner-rollforward | jq -r .)"
else WORKDIR="${TMPDIR:-/tmp}/carta-partner-rollforward"; fi
mkdir -p "$WORKDIR"
```
If `uv` or Bash is unavailable, use the inline fallback (5d).

**5b. Write the config.** `Write` the step-4 config as compact JSON to `$WORKDIR/rollforward-data.json`.

**5c. Render.**
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/render_artifact.py" --workdir "$WORKDIR" --template "${CLAUDE_PLUGIN_ROOT}/skills/carta-partner-rollforward/references/artifact_template.html" --in rollforward-data.json --out partner-rollforward.html
```
It prints the absolute path of the HTML. Branch on the exit code:

| RC | meaning | next move |
|----|---------|-----------|
| 0 | HTML written; path on stdout | publish (5e) |
| 1 | config file missing / bad JSON | re-check 5b, retry once |
| 4 | bundled template not found | inline fallback (5d) |
| 14 | template token count is not exactly 1 (drift) | stop; tell the user the bundled template has drifted and needs a fix from the skill's maintainer |

If the RC=1 retry also fails, stop and offer to escalate rather than retrying further.

**5d. Inline fallback** (only when `uv` or Bash is unavailable or the runtime blocks subprocess): load the template with `read_skill(file_path="references/artifact_template.html")`, escape the compact config JSON as the template's header comment documents (the `\uXXXX` form for `&` `<` `>` `'` — **not** HTML entities), replace the single `__LOAN_DATA__` placeholder, then publish.

**5e. Publish the artifact.** `Artifact({action: "list", scope: "mine"})`; if a **Partner Rollforward** artifact is already published, keep its `url` and tell the user you are refreshing it in place before you publish over it. That is the title the template's own `<title>` sets, and the tag always wins over the `title` parameter, so looking for anything else publishes a duplicate every run. Then publish:

```
Artifact({
  file_path: "<path printed by the script>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "Partner Rollforward",
  description: "Partner rollforward across all funds — fetched live from Carta.",
  icon: "table",
  label: "Refreshed for <firm_name>",
  capabilities: {
    mcp: { servers: [{ server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "welcome", "set_context"] }] },
    downloads: true
  }
})
```

All three tools **must** be in the grant, or the page loads and every fetch rejects with `not_in_manifest`. Keep `title` and `icon` stable across redeploys, and restate the whole `capabilities` object every time. Give the user the URL and say the report pulls fresh numbers each time it is opened, briefly. Do nothing else after.

## How the numbers are built

The artifact reads four tables through `dwh__execute__query`, each pinned to the firm, and does the arithmetic in the page so that changing the period, fund or view re-queries nothing.

- `FUND_ADMIN.ALLOCATIONS` — the fund ledger by partner, **allocation bucket** and effective date (`ACTUAL_AMOUNT`). The artifact sums it by month. The buckets are the in-app columns: *Capital contribution, Contributions outside commitment, Syndication costs, Management fees, Management fee waiver, Net operating income (loss), Unrealized gain (loss), Carried interest accrued, Distribution*, and so on. Columns are discovered from the data across every fund the firm has, loaded in full when the report opens, so a bucket any fund uses appears without a code change, for every fund alike.
- `FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS` — Carta's own month-end commitment and ending NAV per partner. `CUMULATIVE_TOTAL_COMMITMENT` is the commitment in force at the end month (`TOTAL_COMMITMENT` is only what was committed during that month); `ENDING_TOTAL_NAV` checks each partner's ledger balance (the *Ties to Carta NAV* column). When the fund has NAV rows for the month, a partner with no row of its own counts as zero NAV; a fund's figure is the sum of its partners' gaps. When the fund has none, the column reads — (no NAV for that month).
- `FUND_ADMIN.PARTNER_DATA` — partner name, class, entity type, LP/GP flag, and `PARTNER_ENTITY_ID`, which identifies one investor across funds. The investor picker is keyed by it, never by name: different investors share names. Records with no commitment and no ledger lines (funds keep old, empty ids) are not listed.
- `FUND_ADMIN.FUNDS` — fund name, **fund family** (`FUND_FAMILY_ID`, `FUND_FAMILY_NAME`), **reporting currency** and `VINTAGE_DATE` (orders funds newest first; a fund without one goes by its first month of ledger activity).

**Beginning balance** is every non-memo bucket posted before the first month of the period — the balance at the close of the month before `From`. **Ending balance** is the beginning balance plus the period's bucket movements — the balance at the close of the `To` month. Column headers carry both dates. A period is whole months, `From` through `To` inclusive; the app's tab accepts arbitrary days, so a mid-month start is the one known difference. The default is the last full calendar quarter, which may not be closed yet early in the next quarter; the NAV column shows it.

**Comparison.** *Previous period* is the same number of months directly before; *Same period last year* moves both months back twelve. A year-to-date period (starting in January, other than a single month or Q1) offers only *Same period last year*. A fund with no ledger activity by the end of the comparison window shows *Not available*, not zero.

**Memo buckets are not part of the capital account.** *Capital call receivable, Deferred capital call, Distribution Payable, Late interest receivable/payable, Partner loan receivable/payable* are posted to the ledger but sit outside the balance. Measured on 60 funds that carry them, leaving them out reproduces Carta's month-end NAV on all 60; counting them reproduces it on 32. They stay available behind **Select columns → Show memo items**, and the LP statement lists them marked as memo.

**Capital call arithmetic.** Funded = *Capital contribution* + *Capital contributions - rolled*. Unfunded = commitment less funded, never below zero. *Contributions outside commitment* do not reduce unfunded. *Called, not yet received* is the cumulative *Capital call receivable* bucket. The window is the chosen `From`–`To` period: funded and unfunded at the close of the month before `From`, and at the close of `To`.

**Currency.** Every amount is formatted in its fund's `REPORTING_CURRENCY`. The firm's primary currency (the one with the most funds) decides how: in a USD firm its dollars read `$` and every other currency its code (`EUR 1,200.00`); in any other firm dollars read `USD` and every other currency, its own included, its standard symbol (`€`, `£`, `R$`, `CA$`, `A$`), or its code where no symbol is unique to it (`SGD`, `SEK`), so no two currencies share a mark. Amounts format the same for every viewer, whatever their browser's region; tables, total labels and the PDF statement all follow this one rule. Each PDF statement page is one partner record in one fund, so one currency, named in its facts and in the amount column's header on every page. Funds of every currency share one table with no currency headings; they are ordered by currency (most funds first) and never compared or converted across currencies. On the Rollforward and Capital call, several funds in one currency end with a **Total** row; funds in several currencies end with one total row per currency — *Total ($)*, *Total (EUR)* in a USD firm — never added together, and a banner says so. A fund with no reported currency prints bare numbers, never dollars.

**Fund families** sit in the fund picker, each with its funds indented beneath it, newest first; ticking a family ticks all its funds, and a family of one fund reads as that fund. Leave the picker on *All funds* for the whole firm.

**Row volume.** The artifact queries each fund separately, four funds at a time, and reads every query a page at a time: up to 10,000 rows, shrinking to the row count the tool says fits when a page is over its 200 KiB inline ceiling, then following `next_offset`. Every query ends in an `ORDER BY` over all its columns, which the tool applies to each page, so pages neither repeat nor skip rows. A load whose pages do not add up to the tool's `total_rows` fails rather than showing a silent subset.

**Export.** *Export CSV* and, on the LP statement, *Export PDF* save through the viewer's `downloads` capability, which asks the viewer to confirm each file. The buttons are hidden in views that cannot save. The PDF is written in the page without a library: standard Helvetica text, so accented Latin names are real text; a name in a script those fonts cannot encode (Chinese, Cyrillic, Arabic…) is drawn as a picture of the text, or replaced by a visible placeholder if the viewer cannot draw it.

## Error table

| Symptom | Cause | Tell user |
|---|---|---|
| No connector found (Step 1) | No `call_tool`/`welcome` pair in the conversation's tool list | No Carta connector is available; connect one via claude.ai connector settings |
| `welcome` fails (Step 2) | Carta session not live, or identity/firm context unresolved | What `welcome` returned; retry once the session is confirmed live |
| Named firm not found (Step 2) | The name matches none of the firms the user can access | Which name was searched, which firms they can access, and to try again with one of those |
| No partner activity (Step 3) | The pinned firm has no ledger rows | There is no partner ledger activity for this firm in this context |
| Table not found (Step 3) | A table is unknown at this warehouse layer and discovery found no variant | Partner ledger data is not available in this context |
| Row from another firm mid-page (artifact) | Session's active firm changed while a page was loading | The render is refused rather than painted; reopen the report to reload under the current firm |
| "Differs by …" in *Ties to Carta NAV* | The ledger's ending balance does not equal Carta's month-end NAV for that fund or investor | Not an error in the page: the fund's ledger and its NAV disagree for that month. Say which fund or investor, and suggest checking it with the fund administrator |
