---
name: search-investors
description: >
  Searches for and retrieves investor records from the Carta CRM.
  Use this skill when the user says things like "find an investor", "search investors",
  "look up an investor", "show me investor details for [name]", "get investor by ID",
  "list investors", "what investors do we have", or "/search-investors".
  Returns investor details including ID, name, and custom fields.
  The investor ID returned can be used with the update-investor skill.
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

Search for investors in the Carta CRM. If the user provided an ID, fetch the single
record directly. Otherwise use the search tool and return results in a readable summary.
Always surface the investor ID so the user can reference it for updates.

## Step 1 — Determine search mode

- **By ID** — user provided an investor ID → call `get_investor`
- **By name / keyword** — user provided a name or description → call `search_investors`

If it's unclear, default to search and ask the user for a name or keyword.

## Step 2 — Execute the search

Use `crm_view_tool` so the result renders as an interactive table the user can sort and
click through. It takes exactly the same `name` and `arguments` as `crm_call_tool`.

**By name / keyword:**
```
crm_view_tool({
  "name": "crm:search_investors",
  "arguments": {
    query: "<search term>",
    limit: 20
  }
})
```

**By ID:**
```
crm_view_tool({ "name": "crm:get_investor", "arguments": { id: "<investor id>" } })
```

Increase `limit` if the user asks to see more results. Use `offset` to paginate.

### If the view is unavailable

CRM views are enabled per organisation, and single-record views behind a second flag on
top of that. So **either** call above may answer with:

> CRM tool 'search_investors' has no view — call it with crm_call_tool instead.

That is a normal response, not a failure — this organisation does not have that view
enabled. Retry that one call verbatim through `crm_call_tool` and present the result as
text per Step 3. Do **not** retry `crm_view_tool`, and do not report the message to the
user.

## Step 3 — Present results

**When the view rendered**, the user already sees every record on screen. Do NOT
re-list, re-format, or summarise the rows as text — that duplicates the table.
Answer the question they actually asked, or acknowledge in one line
(e.g. "Found 9 investors — the ID is in the first column, for `/update-investor`.").

**When you fell back to `crm_call_tool`**, display all non-empty fields in a readable
summary and show the ID prominently — the user will need it to run `/update-investor`.

If no investors are found:
> "No investors found matching your search. Try a different name or keyword."
