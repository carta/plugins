---
name: carta-discover-commands
description: META-DISCOVERY ONLY — answers the question "what cap-table tools or commands exist?" when the user is lost about what's available. NEVER use this skill for any request that names a cap-table topic (stakeholders, grants, vesting, SAFEs, notes, valuations, ownership, waterfall, financing, exposure, etc.) — those are always direct data requests, even if the user phrases them vaguely. The matching specialist skill wins every time over this one.
when_to_use: >-
  Use ONLY when the user explicitly admits they don't know what's
  available and asks a meta question about the toolset itself —
  literal phrasings like "I don't know where to begin", "what kinds
  of cap-table data can I even access", "can you give me a tour of
  the available commands", "which tools are even available for this
  domain", or "point me in the right direction with no specific
  topic in mind". Do NOT fire on any utterance that names a specific
  cap-table noun (stakeholders, shareholders, holders, employees,
  grants, options, vesting, SAFEs, notes, 409A, valuations, ownership,
  waterfall, exit, financing, rounds, exposure, conversions, etc.) —
  even if the verb sounds discovery-flavored ("show me X", "render X",
  "find X", "compare X"), the named noun means it's a direct data
  request and a specialist skill owns it. When in doubt between this
  skill and a specialist, pick the specialist.
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__carta__discover
  - AskUserQuestion
---

<!-- Part of the official Carta AI Agent Plugin -->

# Discover Commands

Use the `discover()` tool to find available commands when no specific skill covers the user's request.

## Step 1 — Search for Relevant Commands

```
discover(search="<keyword from user's request>")
```

Use a keyword that captures the user's intent (e.g. "valuation", "grant", "safe", "stakeholder").

## Step 2 — Pick the Best Match

Review the returned commands. Each has:
- `command`: the name to pass to `fetch()`
- `description`: what it returns
- `required_params`: what you need to provide
- `help`: detailed field descriptions and caveats

## Step 3 — Execute

```
fetch("<command_name>", { ...params })
```

You still need `corporation_id` for most commands — get it from `list_accounts` if you don't have it.
