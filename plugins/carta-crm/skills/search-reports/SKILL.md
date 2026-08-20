---
name: search-reports
description: >
  Runs a saved report in the Carta CRM and renders its rows as a table, using the columns
  the report saved. Use this skill when the user says things like "run my report", "run the
  [name] report", "show me the [name] report", "open the [name] report", "what reports do we
  have", "list reports", or "/search-reports".
allowed-tools:
  - mcp__carta__crm_view_tool
  - mcp__carta__crm_call_tool
version: 1.0.0
model: haiku
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

## Overview

A saved report is a stored filter plus a stored column set over one entity: deals, contacts,
companies, investors, fundraisings or fees. Running one renders its rows as a table, using the
columns the report saved.

Reports are not searched by keyword. They are listed, chosen, then run — so Step 1 always
precedes Step 2.

For an aggregated breakdown of deal flow by sector, source or owner rather than the rows
themselves, use the `deal-flow-analytics` skill instead.

## Step 1 — Find the report

**Read the list through `crm_call_tool`, never `crm_view_tool`.** `list_reports` has no view of
its own, and this step is for you rather than the user: you need each report's `id` and
`entityType` to run it.

```
crm_call_tool({ "name": "crm:list_reports", "arguments": {} })
```

Pass `entityType` to narrow the list when the user named one — `"deal"`, `"contact"`,
`"company"`, `"investor"`, `"fundraising"` or `"fees"`:

```
crm_call_tool({ "name": "crm:list_reports", "arguments": { entityType: "deal" } })
```

Then branch on what came back:

- **One clear match on name** → Step 2.
- **Several plausible matches** → do NOT guess. Name them and ask which one. Running the wrong
  report answers a question nobody asked, and looks authoritative doing it.
- **No match** → say so, and say what the reports are actually called. Never invent a report or
  a report id.
- **The user only asked what reports exist** → answer from this list and stop. There is nothing
  to render.

## Step 2 — Run the report

Use the `id` and the `entityType` from the entry you matched in Step 1. Both are on that entry;
never guess either.

```
crm_view_tool({
  "name": "crm:get_report_data",
  "arguments": {
    reportId: "<id from list_reports>",
    entityType: "<entityType from the same entry>",
    limit: 50
  }
})
```

The report's own saved columns drive the table. Do not pass a column list, and do not ask the
user which columns they want — the report already answers that.

Use `offset` to paginate, and raise `limit` when the user asks to see more rows.

### If the view is unavailable

CRM views are enabled per organisation. So the `crm_view_tool` call above may answer with:

> CRM tool 'get_report_data' has no view — call it with crm_call_tool instead.

That is a normal response, not a failure — this organisation does not have the view enabled.
Retry that one call verbatim through `crm_call_tool` and present the rows as text per Step 3.
Do **not** retry `crm_view_tool`, and do not report the message to the user.

## Step 3 — Present results

**When the table rendered**, the user already sees every row. Do NOT re-list, re-format, or
summarise the rows as text — that duplicates the answer beside the table. Say what they asked,
or acknowledge in one line, e.g. "Ran Stage A deals: 18 rows match."

`count` is the total the report matches, which can be larger than the rows on this page. When it
is, say so in that one line rather than implying the page is the whole report.

**When you fell back to `crm_call_tool`**, present the rows as a readable text table and keep the
report's column order.

If the report matched nothing:
> "That report matched no records. Its filters may be narrower than you expect."
