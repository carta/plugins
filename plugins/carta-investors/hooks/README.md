# Hooks — carta-investors

## Hook entries

Every hook except `warn-empty-query.js` and `guard-own-sync-push.js`, which run
under node, dispatches to the shared Go hooks binary in `tools/hooks/` via
`dispatch.sh`.

## Binary source

The published plugin ships the compiled binaries in `hooks/bin/` and their Go
source in `hooks/src/`. `hooks/bin/SOURCE.md` explains how to check the
binaries against `hooks/bin/SHA256SUMS` (`sh hooks/src/verify-checksums.sh`)
and how to rebuild them from source and compare (`GOTOOLCHAIN=go$(cat hooks/src/.go-version) sh hooks/src/build.sh --check`).

 **Windows:** See the Windows note in `tools/hooks/README.md`.

| Event | Matcher | Command | Purpose |
|-------|---------|---------|---------|
| SessionStart | — | `dispatch.sh inject-context` | Inject skill-loading instruction |
| SessionStart | — | `dispatch.sh prune-session-data` | Prune session files older than 24 hours from CLAUDE_PLUGIN_DATA/sessions (when that variable is set) and from the shared session folder (`CARTA_SESSION_STATE_DIR`, or `carta-instrumentation` in the system temp folder) |
| SessionStart | — | `dispatch.sh capture-model` | Capture the active Claude model, in the shared session folder, for later PreToolUse instrumentation |
| PreToolUse | Skill | `dispatch.sh capture-active-skill` | Record which carta skills have been loaded this session |
| PreToolUse | Carta MCP | `dispatch.sh inject-instrumentation` | Inject merged `_instrumentation_v2` (all active plugins + namespaced skills) into fetch/mutate params (top-level otherwise). Outside the `default`, `acceptEdits`, `dontAsk` and `bypassPermissions` permission modes it leaves the input unchanged, because auto mode (and so every cloud session) refuses a call a hook rewrote |
| PreToolUse | Carta MCP `call_tool` | guard-own-sync-push.js | Deny a budget-report create/update that belongs to a carta-manco-reporting own-sync plan but differs from it |
| UserPromptSubmit | — | `dispatch.sh capture-slash-skill` | Record explicitly-invoked skills (bare `/skill` slash commands) |
| PostToolUse | Carta MCP `execute_query` | warn-empty-query.js | Warn Claude when a query returns no results |

## What each PreToolUse hook outputs

The Go binary in `hooks/bin/` is compiled, so its output can't be read from the hook entry. Both of its
PreToolUse hooks print one JSON object. Their source is in `hooks/src/`.

| Hook | Output |
|------|--------|
| `capture-active-skill` | Always `{"hookSpecificOutput":{"hookEventName":"PreToolUse"}}`: no decision, so Claude Code's normal permission flow applies. It records the name of each of this plugin's skills that Claude loads, in a small per-session file under `CLAUDE_PLUGIN_DATA/sessions` (`/tmp/claude-carta-investors` when that is unset), and the latest one in the shared session folder (`CARTA_SESSION_STATE_DIR`, or `carta-instrumentation` in the system temp folder). It never blocks or edits a call. |
| `inject-instrumentation` | `updatedInput`: the tool call's input plus an `_instrumentation_v2` object (inside `params` for `fetch` and `mutate`, where a JSON-string `params` is rewritten as an object). The object holds the plugin names and versions, skill names, session, prompt and agent ids, permission mode, effort, model, surface, platform, the session's token total (read from the transcript) and `from_hook: true`. It writes a small per-session record in the shared session folder. When it cannot tell which plugin it belongs to, it prints the bare object above and changes nothing. Outside the `default`, `acceptEdits`, `dontAsk` and `bypassPermissions` permission modes it also prints the bare object and leaves the input unchanged: auto mode refuses a call whose input a hook changed after review. It never allows or denies a call, and only runs for Carta MCP tools (see the matcher below). |

`guard-own-sync-push.js` is plain node source. It prints a `deny` decision with a reason only when a budget
report push differs from the plan `own_sync.py` wrote; otherwise it prints nothing.

## Carta MCP matcher

Hooks that target the Carta MCP server use an explicit allowlist rather than `mcp__carta.*__.*` because the server name varies by how it was registered:

- `carta*` / `Carta*` — prefix match; covers any server name starting with "carta" or "Carta" (e.g. `carta-local`)
- UUID — registered automatically by Claude Desktop; one UUID per Carta environment

## SOI review module

The Claude Code SOI review companion is a hooks module in `mods/soi-review/`, kept outside this
folder and not loaded by the manifest; see `mods/soi-review/README.md`.
