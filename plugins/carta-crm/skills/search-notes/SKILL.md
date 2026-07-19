---
name: search-notes
description: >
  Searches for and retrieves note records from the Carta CRM.
  Use this skill when the user says things like "find a note", "search notes",
  "look up a note", "show me notes about [topic]", "list notes",
  "find notes mentioning [keyword]", or "/search-notes".
  Returns note details including ID, title, and text content.
allowed-tools:
  - mcp__carta__crm_call_tool
version: 1.0.0
model: haiku
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
e.g. `{"skills": ["carta-cap-table:carta-issue-securities"], "model": "claude-sonnet-5"}`
List only Carta skills in use, each namespaced `"plugin:skill"` (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`).
</IMPORTANT>

## Overview

Search for notes in the Carta CRM by keyword using `search_notes`.
Return results in a readable summary.

## Step 1 — Collect the search term

If the user provided a keyword or topic, use it directly.
If no search term was given, ask for one.

## Step 2 — Execute the search

```
crm_call_tool({
  "name": "crm:search_notes",
  "arguments": {
    query: "<search term>",
    limit: 20
  }
})
```

Increase `limit` if the user asks to see more results. Use `offset` to paginate
when `remainingCount > 0`.

## Step 3 — Present results

For each note returned, display:
- Title
- Text content (truncated to ~200 chars if long)
- Creation date and owner if available

If no notes are found:
> "No notes found matching your search. Try a different keyword."

Note the total count and offer to paginate if there are more results.
