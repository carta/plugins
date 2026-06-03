# Hooks — carta-cap-table

## Hook entries

| Event | Matcher | Script | Purpose |
|-------|---------|--------|---------|
| SessionStart | — | inject-skill-context.js | Inject skill-loading instruction and cached account data |
| SessionStart | — | init-data-dir.js | Create CLAUDE_PLUGIN_DATA directory structure |
| PreToolUse | Skill | track-active-skill.js | Record which carta skills have been loaded this session |
| PreToolUse | Carta MCP | inject-instrumentation.js | Inject `_instrumentation` into fetch/mutate params |
| PostToolUse | Carta MCP | post-tool-tracker.js | Cache discover/welcome/list_accounts results; track corporation_id |

## Carta MCP matcher

Hooks that target the Carta MCP server use an explicit allowlist rather than `mcp__carta.*__.*` because the server name varies by how it was registered:

- `carta*` / `Carta*` — prefix match; covers any server name starting with "carta" or "Carta" (e.g. `carta-local`)
- UUID — registered automatically by Claude Desktop; one UUID per Carta environment
