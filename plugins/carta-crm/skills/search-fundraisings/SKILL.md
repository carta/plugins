---
name: search-fundraisings
description: >
  Searches for and retrieves fundraising records from the Carta CRM.
  Use this skill when the user says things like "find a fundraising", "search fundraisings",
  "look up a fundraising round", "show fundraising details for [name]", "get fundraising by ID",
  "list fundraisings", "what fundraisings do we have", or "/search-fundraisings".
  Returns fundraising details including ID, name, stage, and custom fields.
  The fundraising ID returned can be used with the update-fundraising skill.
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

Search for fundraisings in the Carta CRM. If the user provided an ID, fetch the single
record directly. Otherwise use the search tool and return results in a readable summary.
Always surface the fundraising ID so the user can reference it for updates.

## Step 1 — Determine search mode

- **By ID** — user provided a fundraising ID → call `get_fundraising`
- **By name / keyword / stage** — user provided a name or stage → call `search_fundraising`

If it's unclear, default to search and ask for a search term.

## Step 2 — Execute the search

Use `crm_view_tool` so the result renders as an interactive table the user can sort and
click through. It takes exactly the same `name` and `arguments` as `crm_call_tool`.

**By name / keyword:**
```
crm_view_tool({
  "name": "crm:search_fundraising",
  "arguments": {
    query: "<search term>",
    limit: 20
  }
})
```

**By ID:**
```
crm_view_tool({ "name": "crm:get_fundraising", "arguments": { id: "<fundraising id>" } })
```

If the user filtered by stage name, resolve the name to a stage ID first, then pass
`stages: ["<stage id>"]`. This lookup has no view of its own, so it goes through
`crm_call_tool`:

```
crm_call_tool({ "name": "crm:get_fundraising_stages", "arguments": {} })
```

Increase `limit` if the user asks to see more results. Use `offset` to paginate.

### If the view is unavailable

CRM views are enabled per organisation, and single-record views behind a second flag on
top of that. So **either** call above may answer with:

> CRM tool 'search_fundraising' has no view — call it with crm_call_tool instead.

That is a normal response, not a failure — this organisation does not have that view
enabled. Retry that one call verbatim through `crm_call_tool` and present the result as
text per Step 3. Do **not** retry `crm_view_tool`, and do not report the message to the
user.

## Step 3 — Present results

**When the view rendered**, the user already sees every record on screen. Do NOT
re-list, re-format, or summarise the rows as text — that duplicates the table.
Answer the question they actually asked, or acknowledge in one line
(e.g. "6 fundraisings match — the ID is in the first column, for `/update-fundraising`.").

**When you fell back to `crm_call_tool`**, display all non-empty fields in a readable
summary and show the ID prominently — the user needs it to run `/update-fundraising`.

If no fundraisings are found:
> "No fundraisings found matching your search. Try a different name or keyword."
