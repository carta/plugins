# Hooks

To avoid relying relying on `python`, `node`, `jq` being installed on client machines, we build a Go binary that contains every Claude Code hook for every plugin. `dispatch.sh <handler>` picks the right native binary and runs the hook handler passed to it. Each plugin's identity comes from its `plugin.json` at run time, so one binary serves all plugins without a per-plugin build.

## Dispatch

```
Claude Code ──stdin JSON──> hooks/dispatch.sh <handler>
                                   │ resolves bin/hooks-<os>-<arch>
                                   ▼
                               main.go ──> registry.Lookup(name) ──> handler
                                   │                                    │
                                   │<───────── stdout JSON ─────────────┘
                                   └── on error/panic ──> hookio.FailOpen(event)
```

`dispatch.sh` takes the handler name as its argument. It resolves the native
binary for the host OS and architecture. It execs the binary with the same
stdin and stdout. `main.go` looks up the handler by name in the registry. A
handler reads stdin JSON and writes stdout JSON. Any error or panic returns
the fail-open shape for that hook event instead.

> **Windows:** `dispatch.sh` is a POSIX shell script, so hooks won't fire unless Bash or Git Bash is installed.

## Handlers

| Name | Hook event | Reads | Effect |
|---|---|---|---|
| `inject-instrumentation` | PreToolUse | `tool_name`, `tool_input`, `session_id`, `prompt_id`, `permission_mode`, `effort`, `agent_id`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_REMOTE` | adds `_instrumentation_v2` to `tool_input` |
| `capture-active-skill` | PreToolUse | `session_id`, `tool_input.skill` | records the active skill for the session |
| `capture-slash-skill` | UserPromptSubmit | `session_id`, `prompt` | records a `/skill` invocation; always returns zero bytes |
| `capture-model` | SessionStart | `session_id`, `model` | records the session's model |
| `inject-context` | SessionStart | `hook_event_name` | adds a per-plugin blurb to `additionalContext` |
| `prune-session-data` | SessionStart | — | prunes session files older than 24h from `CLAUDE_PLUGIN_DATA/sessions` |
| `cache-commands` | PostToolUse | `tool_name`, `tool_response` | caches a `discover()` call's result to `CLAUDE_PLUGIN_DATA/cache/commands.json` |
| `track-corporation` | PostToolUse | `tool_name`, `tool_input.params.corporation_id` | records the corporation id from a `fetch()` call to `CLAUDE_PLUGIN_DATA/prefs.json` |

Source: `handlers/inject_instrumentation.go`, `handlers/capture_skills.go`,
`handlers/capture_model.go`, `handlers/inject_context.go`,
`handlers/prune_session_data.go`, `handlers/carta-cap-table/cache_commands.go`,
`handlers/carta-cap-table/track_corporation.go`.

## Instrumentation payload

`inject-instrumentation` places the `_instrumentation_v2` object in one of two
locations. It uses the tool's short name to decide. The short name is the last
`__`-separated segment of `tool_name`.

| Short name | Location |
|---|---|
| `fetch` or `mutate` | inside `tool_input.params` |
| any other name | at the top level of `tool_input` |

Source: `handlers/inject_instrumentation.go:120-149`.

## Session state

Each handler reads its state from one of three locations.

| Env var | Default | Contents |
|---|---|---|
| `CLAUDE_PLUGIN_ROOT` | none | `.claude-plugin/plugin.json`; gives the plugin name and version |
| `CLAUDE_PLUGIN_DATA` | `/tmp/claude-<plugin>/` | per-plugin session file; holds the skill list |
| `CARTA_SESSION_STATE_DIR` | `$TMPDIR/carta-instrumentation/<session>/` | shared across plugins; one JSON file per plugin, plus `.last-skill` and `.model` |

Each PreToolUse handler writes its own plugin's record first. It then merges
all plugins' records into one session state. This order stops the last hook
from overwriting the other plugins' records.

## Fail-open rule

A hook never blocks a tool call. Every internal error returns the same allow
or OK shape a successful run would return.

## Add a handler

1. Add `handlers/<name>.go` or `handlers/<plugin>/<name>.go if plugin-specific. Register the handler in its `init()` function.
2. Return one of the `internal/hookio` shapes for the handler's hook event.
3. Add the handler to the plugin's `hooks.json`, as `dispatch.sh <name>`.
4. Rebuild with `build.sh` and commit the updated `bin/` directory.

## Build and verify

| Command | Purpose |
|---|---|
| `go vet ./...` | static checks |
| `go test ./...` | unit tests |
| `sh build.sh` | cross-compile all platform binaries |
| `sh build.sh --check` | confirm the build is reproducible |
| `sh verify-checksums.sh` | confirm `bin/` matches `bin/SHA256SUMS` |
| `sh test.sh` | smoke test plus cold-start latency |
| `sh detect-native.sh` | print the binary path for the current host |

The build uses the Go version pinned in `.go-version`.
