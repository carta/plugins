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
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__carta__search_tools
  - AskUserQuestion
  - Bash(cat "${CLAUDE_PLUGIN_DATA}/cache/commands.json"*)
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
e.g. `{"skills": ["carta-cap-table:carta-issue-securities"], "model": "claude-sonnet-5"}`
List only Carta skills in use, each namespaced `"plugin:skill"` (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`).
</IMPORTANT>

<!-- Part of the official Carta AI Agent Plugin -->

# Discover Commands

Use the command registry to find available commands when no specific skill covers the user's request. A prior `discover` call in this environment caches the full registry to disk — read that cache first and only hit the network on a miss.

## Step 0 — Read the cached command registry (do this first)

The plugin's PostToolUse hook writes the full command registry to `${CLAUDE_PLUGIN_DATA}/cache/commands.json` after any `discover` call. Read it before making any MCP call:

```bash
cat "${CLAUDE_PLUGIN_DATA}/cache/commands.json" 2>/dev/null || true
```

If the file exists and is valid, treat it as the command list and validate it before use:

- **Freshness** — the JSON has a `cached_at` ISO timestamp. If `cached_at` is more than **24 hours** old, treat the cache as stale and fall through to Step 1 (this matches the 24h TTL the welcome/accounts caches use).
- **Version** — the JSON has a `plugin_version`. If it does not match the running plugin version (see the `<carta-plugin version=… />` tag injected at session start), treat the cache as stale and fall through to Step 1.
- **Shape** — the command list lives under the `commands` key (an array). If the file is empty, unparseable, or `commands` is missing/empty, fall through to Step 1.

When the cache is valid and fresh, **skip Steps 1–2's network call** — pick the best-matching command directly from the cached `commands` array (same `name` / `description` / `inputSchema` fields as the live `search_tools` result) and go straight to Step 3. This removes a network round-trip on warm sessions.

## Step 1 — Search for Relevant Commands (cache miss / stale only)

```
search_tools({"query": "<keyword from user's request>"})
```

Use a keyword that captures the user's intent (e.g. "valuation", "grant", "safe", "stakeholder").

## Step 2 — Pick the Best Match

Review the returned tools. Each has:
- `name`: the tool name to pass to `call_tool` (e.g. `cap_table__get__stakeholders`)
- `description`: what it returns
- `inputSchema`: the required and optional parameters

## Step 3 — Execute

```
call_tool({"name": "<tool_name>", "arguments": { ...params }})
```

You still need `corporation_id` for most commands — get it from `list_accounts` if you don't have it.
