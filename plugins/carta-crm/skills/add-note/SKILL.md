---
name: add-note
description: >
  Adds a note to a deal in the Carta CRM via the Carta CRM MCP Server; notes are
  stored as comments on the deal record. Use this skill when the user says things
  like "add a note", "log a note", "add note to a deal", "add note to Carta CRM",
  "add a comment", "comment on a deal", or "/add-note".
allowed-tools:
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

In the Carta CRM MCP Server, notes are added as comments on deal records using the
`comment` field via `update_deal`. Help the user identify which deal to attach
the note to, collect the note content, then update the deal.

## Step 1 — Identify the deal

Ask the user which deal the note is for. If they named a company or deal, search for it:

```
crm_call_tool({ "name": "crm:get_deal_fields", "arguments": {} })
crm_call_tool({ "name": "crm:search_deals", "arguments": { query: "<company name>", limit: 10 } })
```

If multiple deals match, present the list and ask which one to attach the note to.

If the user provided a deal ID directly, skip the search.

## Step 2 — Collect the note content

Ask the user for:
- **Note text** (required) — the content of the note

If the user has already provided the note content in their message, extract it directly
without re-asking.

Optionally show the existing comment on the deal (from `fetch_deal_by_deal_id`) so the
user knows whether they're replacing or appending:

```
crm_call_tool({ "name": "crm:fetch_deal_by_deal_id", "arguments": { id: "<deal id>" } })
```

## Step 3 — Add the note to the deal

Call:

```
crm_call_tool({
  "name": "crm:update_deal",
  "arguments": {
    id: "<deal id>",
    comment: "<note content>"
  }
})
```

Note: `comment` replaces the existing deal comment. If the deal already has a comment
and the user wants to append, combine the existing text with the new content and confirm
before saving.

## Step 4 — Report result

On success, respond with:
> "Note added to deal **{company name}** (ID: `{id}`)."

On error, show the error message and suggest:
- Verify the deal ID is correct — run `/search-deals` to find it
