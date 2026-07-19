---
name: update-note
description: >
  Searches for notes in the Carta CRM and helps the user update deal comments.
  Use this skill when the user says things like "update a note", "edit note",
  "update note content", "change a note", or "/update-note".
  Note: standalone note editing is not available via MCP — notes/comments are
  attached to deals and updated via the update-deal skill.
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

Notes in the Carta CRM MCP are accessible via `search_notes` but are edited as
`comment` fields on deal records via `update_deal`. Help the user find the note
they want to change, then update the associated deal's comment.

## Step 1 — Find the note

Search for the note by keyword:

```
crm_call_tool({ "name": "crm:search_notes", "arguments": { query: "<keyword>", limit: 10 } })
```

Show the results to the user and ask which note they want to update.

## Step 2 — Identify the associated deal

Once the user has selected a note, find the deal it belongs to. Ask the user for
the deal name/company, or search:

```
crm_call_tool({ "name": "crm:get_deal_fields", "arguments": {} })
crm_call_tool({ "name": "crm:search_deals", "arguments": { query: "<company name>", limit: 10 } })
```

Fetch the deal to show the current comment:
```
crm_call_tool({ "name": "crm:fetch_deal_by_deal_id", "arguments": { id: "<deal id>" } })
```

## Step 3 — Collect the updated content

Show the user the existing comment and ask what they'd like to change.

## Step 4 — Update the deal comment

Call:

```
crm_call_tool({
  "name": "crm:update_deal",
  "arguments": {
    id: "<deal id>",
    comment: "<updated note content>"
  }
})
```

## Step 5 — Report result

On success, respond with:
> "Note updated on deal **{company name}** (ID: `{id}`)."

On error, show the error message and suggest verifying the deal ID by running
`/search-deals`.
