# Hooks — carta-investors

## Hook entries

Every hook except `warn-empty-query.js` dispatches to the shared Go hooks
binary in `tools/hooks/` via `dispatch.sh`.

 **Windows:** `dispatch.sh` is a POSIX shell script, so hooks won't fire unless Bash or Git Bash is installed.

| Event | Matcher | Command | Purpose |
|-------|---------|---------|---------|
| SessionStart | — | `dispatch.sh inject-context` | Inject skill-loading instruction |
| SessionStart | — | `dispatch.sh prune-session-data` | Prune stale session files from CLAUDE_PLUGIN_DATA/sessions |
| SessionStart | — | `dispatch.sh capture-model` | Capture the active Claude model for later PreToolUse instrumentation |
| PreToolUse | Skill | `dispatch.sh capture-active-skill` | Record which carta skills have been loaded this session |
| PreToolUse | Carta MCP | `dispatch.sh inject-instrumentation` | Inject merged `_instrumentation_v2` (all active plugins + namespaced skills) into fetch/mutate params (top-level otherwise) |
| UserPromptSubmit | — | `dispatch.sh capture-slash-skill` | Record explicitly-invoked skills (bare `/skill` slash commands) |
| PostToolUse | Carta MCP `execute_query` | warn-empty-query.js | Warn Claude when a query returns no results |

## Carta MCP matcher

Hooks that target the Carta MCP server use an explicit allowlist rather than `mcp__carta.*__.*` because the server name varies by how it was registered:

- `carta*` / `Carta*` — prefix match; covers any server name starting with "carta" or "Carta" (e.g. `carta-local`)
- UUID — registered automatically by Claude Desktop; one UUID per Carta environment
