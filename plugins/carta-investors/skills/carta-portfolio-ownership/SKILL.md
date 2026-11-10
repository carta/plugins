---
name: carta-portfolio-ownership
description: >-
  Show investment firms their ownership by portfolio company and by underlying fund: shares held, outstanding and fully diluted ownership %, and share counts, as of today or a past date. Answers in chat, or builds a live ownership table in Cowork with each company expanded into its funds. Use for "how much do we own of X", our stake or FD% in a company, shares held, ownership across funds and SPVs, every company in a fund, or adding ownership to a spreadsheet. Do NOT use for an LP's share of a fund, a company's cap table, shareholders or option pool (use carta-explore-data), modelling a new round, or cost, FMV and IRR (use carta-soi, or carta-explore-data when the question also asks for ownership).
version: 0.2.0
model: inherit
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  # The connector check's observed call, and session recovery when a call reports the
  # session is not initialized.
  - mcp__carta__welcome
  - mcp__claude_ai_Carta__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  # Carta MCP — registration prefix varies by host (Claude Code / Claude.ai / Cowork / public)
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - mcp__claude_ai_carta__call_tool
  - mcp__claude_ai_carta__read_tool
  - mcp__claude_ai_carta__set_context
  - mcp__claude_ai_carta__list_contexts
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  # Cowork
  - Artifact
  # Local execution
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-ownership/scripts/render-artifact.py" *)
  - Bash(pwd)
  - Read
  - Write
  # Interaction
  - AskUserQuestion
  - ToolSearch
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.31.6</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

<!-- Part of the official Carta AI Agent Plugin -->

# Portfolio ownership

How much the firm, and each fund and SPV in it, owns of every portfolio company, on two
bases: **outstanding** (issued shares) and **fully diluted** (issued shares plus options,
warrants and the unissued pool). It answers a single question in chat, or builds a live
ownership table in Cowork: one row per company, expanded into one row per fund or SPV.

The numbers come from one query, `${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-ownership/references/ownership.sql`
(this skill's own `references/`). The live page runs the same text, so a chat answer and the
page always agree. Read it by that exact path; don't search for it.

## When to use

Investors ask for this in many ways. All of these are this skill:

- **One company, whole firm:** "how much do we own of Globex?", "what's our ownership in Initech?", "our stake / position in Hooli", "what % of Umbrella do we own?", "our FD% in Soylent across all entities".
- **One company, one fund:** "what's Fund III's ownership in Globex?", "how many shares of Initech does Fund II hold?", "Globex ownership in Opportunity Fund I".
- **Every company, by fund:** "ownership % by company and by fund", "every company in Fund II with our current ownership", "one tab per fund with shares held, FD shares and FD %", "ownership for these 12 companies".
- **Basis:** "fully diluted", "FD", "FD%", "FDS", "FDSO", "basic ownership", "outstanding ownership", "basic and fully diluted", "fully diluted share count for each company".
- **Shares:** "shares held", "how many shares do we hold", "share count", "total FD shares for each portfolio company".
- **A date:** "as of 3/31/2026", "at last quarter end", "end of last month", "at year end 2025", "Q2 2026 ownership".
- **Spreadsheets and checks:** "add an ownership % column to this sheet", "fill out the ownership tab", "check our ownership figures against Carta", "tie out FD% to the cap tables".

Use something else for:

- **An LP's share of a fund** ("each LP's % of Fund I", "partner ownership interest"). That's fund-partner data, not portfolio ownership.
- **A company's full cap table**, its shareholder list, option pool or employee grants: use `carta-explore-data`.
- **Modelling a new round**, pro forma dilution or what a stake would be worth at a price: use the waterfall or modelling skills.
- **Cost, FMV, MOIC or IRR**: use `carta-soi`, or `carta-explore-data` when the question also asks for ownership.

## User-facing output

Talk like a person who looked it up. Never show UUIDs, tool names, SQL, "the render script", "the template" or step numbers. On a page build, say one short sentence when you start (*"Pulling Acme Ventures' ownership across the portfolio…"*), *"Building your view…"* once, and the confirmation at the end. Nothing between tool calls.

## Step 1: Firm context

If the user's accessible firms are already in the conversation (from a `welcome` call), use that list; otherwise call `list_contexts`. One firm: `set_context` with it. Several: infer the firm from the request (firm, fund or company name), else ask with `AskUserQuestion`, then `set_context`. Keep the firm's **name** and **UUID**.

## Step 2: Funds and SPVs

Fetch the firm's `fund` and `spv` entities by reading `${CLAUDE_PLUGIN_ROOT}/references/list-firm-entities.md` (the plugin's own `references/`, not this skill's; do not search for it) and following it with those two types, as two calls in parallel. If that file says the list is incomplete, keep `incomplete_entities` for the answer. Keep each entity's `uuid`, `name` and `fund_family_name`. Use every fund and SPV in the list, whether or not Carta still services it: ownership is a property of the holding, not of the service.

**Scope.** If the user named funds or SPVs, match those names against the list; the query runs on the matches. Otherwise it runs on every fund and SPV in the list. Ownership is per fund and SPV, so *"we"* and *"the firm"* mean all of them combined.

## Step 3: As-of date

Resolve one date, `YYYY-MM-DD`, from the request; today is the default. Use calendar periods:

| The user says | Date |
|---|---|
| nothing, "current", "now", "today", "latest" | today |
| "end of last month", "prior month end" | last day of the previous month |
| "last quarter end", "end of prior quarter" | last day of the previous calendar quarter |
| "last year end", "end of prior year", "year end" (no year) | December 31 of the previous year |
| "Q2 2026", "as of Q2" | that quarter's last day (06-30) |
| "FY2025", "year end 2025", "12/31/25" | 2025-12-31 |
| "6/30/26", "June 30, 2026", "as of 2026-06-30" | that date |

A future date isn't possible: say so in one sentence and use today. When the date is not clear (*"at entry"*, *"after the Series D"*), ask for the date with `AskUserQuestion`, offering the end of the prior month, quarter and year. Always say the date in the answer.

## Step 4: Answer in chat, or build the page

**Build the page** when the user asks for a view, table, dashboard or report of ownership across the portfolio or a fund, and the `Artifact` tool is present (Step 5 checks). **Answer in chat** for everything else: a question about one or a few companies, or a request to fill a spreadsheet. When `Artifact` is present, finish every chat answer with this question as the last line, without building the page yourself, except after a spreadsheet fill: *"Would you like me to create an artifact to see ownership across all of your portfolio?"* A yes goes to Build the page for the whole portfolio, with every fund and SPV from Step 2 in view, whatever funds the question named. When the page was wanted but `Artifact` is missing, answer in chat and say the live table needs Cowork.

### Answer in chat

1. Read `ownership.sql`. Replace every `<FUND_UUIDS>` with the Step 2 UUIDs, each in single quotes and comma-separated, and every `<AS_OF_DATE>` with the Step 3 date. Append `LIMIT 1000 OFFSET 0`.
2. Run it once with the Carta MCP (a call that fails with an error mentioning `welcome` gets the recovery in Caveats first): `read_tool({"name": "dwh__execute__query", "arguments": {"sql": "<the query>"}})`. If exactly 1,000 rows come back, run the next page with `OFFSET 1000`, up to 10 pages in all. If the query fails, show the error in plain words and stop. Don't rewrite the query or try other tables.
3. Keep the companies the user asked about: a case-insensitive match on `company_name`, or all of them. One row comes back per fund and company. Group rows by `company_key`.
4. **Company row:** shares held is the sum of its fund rows. Outstanding and fully diluted shares are the company totals (the same on every fund row). Both percentages are the summed shares ÷ that total. Never add percentages together, and never add the totals across funds.
5. Show a table with up to 6 columns: **Investment | Shares held | Outstanding ownership % | Outstanding | Fully diluted ownership % | Fully diluted shares**. Put each company in bold, with its funds indented beneath it. Write percentages to three decimals, as `X.XXX%`, like the web app. Always write share counts as the full number with commas, never abbreviated (1,240,000, not 1.2M). Use `—` for any blank value. Mark a company whose `has_cap_table` is false *No cap table on Carta*. For a one-company question, answer in one sentence first, e.g. *"As of Nov 3, 2026 you own 12.400% of Globex fully diluted (1,240,000 of 10,000,000 shares), through Fund II and Fund III."*, then show the table.
6. End by saying the date. Mention any company whose `cap_table_as_of`, or any fund row whose `ownership_as_of`, is more than a quarter older than that date. If Step 2 kept `incomplete_entities`, say which kind of entity (fund or SPV) may be missing and that the totals may be understated. Then follow the build-the-page rule in Step 4.

### Build the page

Follow Steps 5–8.

## Step 5: Checks before building

Read and run both checks, and say nothing about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md`: can this session publish at all? When it fails, this skill's own text answer applies: answer in chat (Step 4), not the gate's stop message.
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md`: the connector name the page will call. Keep it as `CARTA_MCP_SERVER`.

Both are in the **plugin's** `references/` directory, not this skill's. Read them by those exact paths; don't search for them.

## Step 6: Write the funds file and render

**Never write or edit the page HTML yourself.** Every render goes through the script. If it fails, show the error and stop.

1. Slug the firm name: lowercase, spaces to hyphens, drop everything but letters, digits and hyphens, collapse repeated hyphens, trim them from the ends. For example, `"Acme Capital Partners, L.P."` → `acme-capital-partners-lp`.
2. Use `Write` to save `<CWD>/<firm-slug>-ownership-funds.json`, a JSON array of `{"uuid", "name"}`, adding `"fund_family_name"` and `"vintage_date"` (`YYYY-MM-DD`) only when present. Run `pwd` if you need `<CWD>`.
3. Render, on one line exactly as written (the allowlist matches this text):

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-ownership/scripts/render-artifact.py" "<CWD>/<firm-slug>-portfolio-ownership.html" "<firm-slug>-portfolio-ownership" "<CARTA_MCP_SERVER>" "<FIRM_UUID>" "<FIRM_NAME>" "<CWD>/<firm-slug>-ownership-funds.json"
```

Add `--as-of <YYYY-MM-DD>` at the end only when Step 3 resolved a date before today. Without it the page opens on the viewer's today.

On success it prints the output path. It refuses a bad UUID, connector name or slug, a path outside the working directory, an empty or malformed funds file, and a future date.

## Step 7: Publish

Find an existing page first: `Artifact({action: "list", scope: "mine"})`. If a **<Firm Name> — Portfolio Ownership** page exists, keep its `url`. Then publish. This is one call either way; leave out `url` on a first publish:

```
Artifact({
  file_path: "<path the script printed>",
  url: "<existing url, or omit>",
  description: "<Firm Name> — ownership by company and fund",
  favicon: "🧩",
  capabilities: {
    mcp: {
      servers: [
        { server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "set_context", "welcome", "track_ui_event"] }
      ]
    },
    downloads: true
  }
})
```

Don't pass a `title`: the page's `<title>` names it, and that name is how the next run finds this page. Restate the whole `capabilities` object every time, since a tool left out is revoked. `downloads` powers **Download CSV**.

## Step 8: Confirm

Give one sentence, then 3–5 bullets:

> **<Firm Name>**'s ownership table is ready, across **<M>** funds and SPVs, as of **<date>**: [Open <Firm Name> — Portfolio Ownership](<url the publish returned>)

Fill the link with the `url` the publish call returned. The side panel does not always open by itself, and this link is how the user reaches the page when it stays closed, so never say the page is loading or open in the sidebar.

- Every company opens expanded into the funds and SPVs that hold it. Collapse one with its arrow, or all of them from the header.
- Outstanding and fully diluted ownership come with each company's total shares, and the fund rows add up to the company row.
- **As of** switches the date: current, the end of the prior month, quarter or year, or any past date.
- Filter by fund or company name, sort any column, and use **Download CSV** for a spreadsheet.

Add *"I couldn't load every **<fund / SPV>** for **<Firm Name>**, so some may be missing."* when Step 2 set `incomplete_entities`.

## How the numbers work

Use these to answer follow-up questions:

- **Shares held** is the fund's position on the company's Carta cap table, counted the way the cap table counts fully diluted shares (as-converted, including warrants the fund holds).
- **Outstanding ownership %** is shares held ÷ the company's outstanding shares. No outstanding-only position per fund exists, so when a fund holds warrants or options this reads slightly high. Point the user to the company's cap table in Carta for the exact outstanding figure.
- **Fully diluted ownership %** is shares held ÷ the company's fully diluted shares (all share classes, options, warrants and the option pool; notes and SAFEs that haven't converted are left out).
- **Company totals** come from the company's cap table snapshot on or before the as-of date, so every fund of one company divides by the same total. That is why fund rows add up to the company row. A company's totals can be older than the as-of date when its cap table hasn't been updated since; say so using `cap_table_as_of`; the page also shows each company's snapshot date on hover.
- **Shares held can be older than the totals.** Each fund's position is its latest ownership snapshot on or before the as-of date (`ownership_as_of`), and funds of one company can have different dates.
- **Pro forma cap tables are left out.** Zero-share links show `—`, not 0%. A percentage above 100% is a data fault and shows `—`.
- **No cap table on Carta:** a company the fund holds on its books whose cap table isn't on Carta. It is listed so the portfolio is complete, with no ownership.
- **Never across firms.** Every figure is for one firm, its funds and SPVs only.
- **Large firms:** a chat answer stops at 10,000 rows; say so if it does, and suggest narrowing to some funds or companies.

## Caveats

- **Cowork only for the page.** Live Artifacts render only in Cowork; in Claude Code or Claude Desktop, answer in chat.
- **The connector name must match the viewer's.** If a viewer's Carta connector has another display name, every call fails with `server_not_connected` and the page says so. Re-run this skill to republish.
- **Session re-initialization.** When one of your calls fails with an error that mentions `welcome`, call `welcome` once and retry the call once. The live page does the same on its own.
