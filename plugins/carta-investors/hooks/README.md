# Hooks — carta-investors

## Hook entries

| Event | Matcher | Script | Purpose |
|-------|---------|--------|---------|
| SessionStart | — | inject-skill-context.js | Inject skill-loading instruction |
| PreToolUse | Skill | track-active-skill.js | Record which carta skills have been loaded this session |
| PreToolUse | Carta MCP | inject-instrumentation.js | Inject merged `_instrumentation_v2` (all active plugins + namespaced skills) into fetch/mutate params (top-level otherwise) |
| PostToolUse | Carta MCP `execute_query` | warn-empty-query.js | Warn Claude when a query returns no results |

## Carta MCP matcher

Hooks that target the Carta MCP server use an explicit allowlist rather than `mcp__carta.*__.*` because the server name varies by how it was registered:

- `carta*` / `Carta*` — prefix match; covers any server name starting with "carta" or "Carta" (e.g. `carta-local`)
- UUID — registered automatically by Claude Desktop; one UUID per Carta environment
