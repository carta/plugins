---
name: search-notes
description: >
  Searches for and retrieves note records from the Carta CRM.
  Use this skill when the user says things like "find a note", "search notes",
  "look up a note", "show me notes about [topic]", "list notes",
  "find notes mentioning [keyword]", or "/search-notes".
  Returns note details including ID, title, and text content.
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

Search for notes in the Carta CRM by keyword using `search_notes`.
Return results in a readable summary.

## Step 1 — Collect the search term

If the user provided a keyword or topic, use it directly.
If no search term was given, ask for one.

## Step 2 — Execute the search

Use `crm_view_tool` so the result renders as an interactive table the user can sort and
click through. It takes exactly the same `name` and `arguments` as `crm_call_tool`.

```
crm_view_tool({
  "name": "crm:search_notes",
  "arguments": {
    query: "<search term>",
    limit: 20
  }
})
```

Increase `limit` if the user asks to see more results. Use `offset` to paginate
when `remainingCount > 0`.

### If the view is unavailable

CRM views are enabled per organisation, so the call above may answer with:

> CRM tool 'search_notes' has no view — call it with crm_call_tool instead.

That is a normal response, not a failure — this organisation does not have CRM views
enabled. Retry the call verbatim through `crm_call_tool` and present the result as text
per Step 3. Do **not** retry `crm_view_tool`, and do not report the message to the user.

## Step 3 — Present results

**When the view rendered**, the user already sees every note on screen. Do NOT re-list the
titles or re-print the note text — that duplicates the table. Answer the question they
actually asked, or acknowledge in one line (e.g. "11 notes mention pricing.").

**When you fell back to `crm_call_tool`**, display each note's title, text (truncated to
~200 chars if long), and creation date and owner where available.

If the user asked something the table doesn't answer on its own — a theme across the
notes, or which one is relevant — read the content and answer that directly.

If no notes are found:
> "No notes found matching your search. Try a different keyword."

Note the total count and offer to paginate if `remainingCount > 0`.
