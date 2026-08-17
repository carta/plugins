---
name: search-deals
description: >
  Searches for and retrieves deal records from the Carta CRM.
  Use this skill when the user says things like "find a deal", "search deals",
  "look up a deal", "show me deals for [company]", "get deal by ID", "find deal in [stage]",
  "list deals", "what deals do we have for [company]", or "/search-deals".
  Returns deal details including ID, company, stage, pipeline, tags, and custom fields.
  The deal ID returned can be used with the update-deal skill.
allowed-tools:
  - mcp__carta__crm_view_tool
  - mcp__carta__crm_call_tool
version: 1.0.0
model: haiku
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
</IMPORTANT>

## Overview

Search for deals in the Carta CRM. If the user provided an ID, fetch that deal
directly. Otherwise use `search_deals` with filters. Always surface the deal ID
so the user can reference it for updates.

**Important:** Call `get_deal_fields` before every `search_deals` call to discover
valid field IDs for filters. Do not skip this step.

## Step 1 — Fetch deal fields

Always call this before searching. It is a schema lookup with no view of its own, so it
goes through `crm_call_tool`:

```
crm_call_tool({ "name": "crm:get_deal_fields", "arguments": {} })
```

Read the field IDs, types, and descriptions carefully. Map the user's intent to the
most specific matching field(s) and use those in the `filters` parameter.

## Step 2 — Determine search mode

- **By ID** — user provided a deal ID → call `fetch_deal_by_deal_id`
- **By filters / keyword** — user provided a company name, stage, or criteria → call `search_deals`

## Step 3 — Execute the search

Use `crm_view_tool` so the result renders as an interactive table the user can sort and
click through. It takes exactly the same `name` and `arguments` as `crm_call_tool`.

**By ID:**
```
crm_view_tool({ "name": "crm:fetch_deal_by_deal_id", "arguments": { id: "<deal id>" } })
```

**By filters:**
```
crm_view_tool({
  "name": "crm:search_deals",
  "arguments": {
    query: "<free-text search — last resort only>",
    stages: ["<stage id>"],
    filters: [
      { field_id: "<field id>", operator: "eq", value: "<value>" }
    ],
    limit: 50
  }
})
```

Prefer `filters` over `query` whenever a specific field matches the user's intent.
Available operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, `between`.
Use `stages` to filter by pipeline stage (funnel, tracking, due-diligence, execution, dead, completed).

Increase `limit` or use `offset` to paginate if `remainingCount > 0`.

### If the view is unavailable

CRM views are enabled per organisation, so either call above may answer with:

> CRM tool 'search_deals' has no view — call it with crm_call_tool instead.

That is a normal response, not a failure — this organisation does not have that view
enabled. Retry that one call verbatim through `crm_call_tool` and present the result as
text per Step 4. Do **not** retry `crm_view_tool`, and do not report the message to the
user.

## Step 4 — Present results

**When the view rendered**, the user already sees every deal on screen. Do NOT re-list,
re-format, or summarise the rows as text — that duplicates the table. Answer the question
they actually asked, or acknowledge in one line (e.g. "8 deals in due diligence — the ID
is in the first column, for `/update-deal`.").

**When you fell back to `crm_call_tool`**, display all non-empty fields in a readable
summary and show the deal ID prominently — the user needs it to run `/update-deal`.

`fetch_deal_by_deal_id` returns full detail including all notes and linked people. The
view renders those, so only call them out in text if the user asked about them.

If no deals are found:
> "No deals found matching your search. Try a different company name or adjust the filters."

Note the total count and offer to paginate if `remainingCount > 0`.
