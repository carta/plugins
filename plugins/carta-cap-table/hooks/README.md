# Hooks — carta-cap-table

## Hook entries

Every hook dispatches to the shared Go hooks binary in `tools/hooks/` via
`dispatch.sh`, except the carta-pe-bulk-issuance `PostToolUse` entry, which runs a Python script with `uv`.

> **Windows:** See the Windows note in `tools/hooks/README.md`. The carta-pe-bulk-issuance entry also needs `uv` on the PATH.

| Event | Matcher | Command | Purpose |
|-------|---------|---------|---------|
| SessionStart | — | `dispatch.sh inject-context` | Inject the welcome-first and skill-loading instruction |
| SessionStart | — | `dispatch.sh prune-session-data` | Prune stale (>24h) session files from CLAUDE_PLUGIN_DATA/sessions |
| SessionStart | — | `dispatch.sh capture-model` | Capture the active Claude model for later PreToolUse instrumentation |
| PreToolUse | Skill | `dispatch.sh capture-active-skill` | Record which carta skills have been loaded this session |
| PreToolUse | Carta MCP | `dispatch.sh inject-instrumentation` | Inject merged `_instrumentation_v2` (all active plugins + namespaced skills) into fetch/mutate params (top-level otherwise). Outside the `default`, `acceptEdits`, `dontAsk` and `bypassPermissions` permission modes it leaves the input unchanged, because auto mode (and so every cloud session) refuses a call a hook rewrote |
| UserPromptSubmit | — | `dispatch.sh capture-slash-skill` | Record explicitly-invoked skills (bare `/skill` slash commands) |
| PostToolUse | Carta MCP | `skills/carta-pe-bulk-issuance/scripts/save_read.py` | While a carta-pe-bulk-issuance run has capture on, save its Carta reads, and the answers of its save and issue calls, to CLAUDE_PLUGIN_DATA/carta-pe-bulk-issuance so `build_ref.py` builds the run's reference file and `record.py` its run log. The shell test skips Python whenever no run is capturing. `capture.py stop` deletes the saved reads; a run nothing has touched for 7 days is deleted by the next `capture.py start` |

## Carta MCP matcher

Hooks that target the Carta MCP server use an explicit allowlist rather than `mcp__carta.*__.*` because the server name varies by how it was registered:

- `carta*` / `Carta*` — prefix match; covers any server name starting with "carta" or "Carta" (e.g. `carta-local`)
- UUID — registered automatically by Claude Desktop; one UUID per Carta environment
