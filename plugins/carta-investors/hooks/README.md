# Hooks — carta-investors

## Hook entries

Every hook except `warn-empty-query.js` dispatches to the shared Go hooks
binary in `tools/hooks/` via `dispatch.sh`.

## Binary source

The published plugin ships the compiled binaries in `hooks/bin/` and their Go
source in `hooks/src/`. `hooks/bin/SOURCE.md` explains how to check the
binaries against `hooks/bin/SHA256SUMS` (`sh hooks/src/verify-checksums.sh`)
and how to rebuild them from source and compare (`sh hooks/src/build.sh --check`).

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

## SOI review module (`register.tsx`)

A Claude Code hooks module that needs Claude Code 2.1.308 or later. Builds older than
2.1.286, and Cowork, skip it. Builds 2.1.286 to 2.1.307 load it, but it never learns a
review, because the tool name they pass to `tool.call` does not include the server. Every
build runs the command hooks above.

When Claude opens an SOI review in the Update Investments view, the module learns the
review from that `view_remote` result and polls Carta MCP's `fa__get__soi-review-state`
read through `read_tool`, on the same server the view came from. It shows
`SOI Q<n> <yyyy> · <status_label>` in the status line.

- Unlike the allowlist above, it accepts `view_remote` on any server, and recognises
  the review by the view's `remoteName` (`updateInvestmentsMcpApps`).
- Polls every `TICK_MS` while the review waits on the GP, every `SLOW_MS` otherwise;
  stops once it is approved or closed, and pauses after `IDLE_MS` without a prompt. A
  failed poll keeps the last state and records when it failed. One poll runs at a time; a
  poll still running `STALE_MS` after it started is replaced by a fresh one, at most once
  per `STALE_MS`.
- Compares each read with the one before: one toast per company whose booked value
  changed (more than `TOAST_LIMIT` collapse into one), and one when the status moves,
  in the read command's own words. No toast on the session's first read. It also keeps
  the companies changed since that first read, from any source. Reopening the same review
  keeps the session's changes and reads it once, even when it was approved or closed;
  opening a different one starts over.
- Every poll carries `_instrumentation_v2: { from_hook: true }`, so carta-mcp does not
  count it as Claude's usage.
- Tests: `claude plugin test plugins/carta-investors` runs `register.test.tsx`. In CI,
  validate.yml's plugin-tests job installs the claude CLI and runs
  `tests/plugin-mods/test_plugin_mod_suites.py`, which validates and tests every plugin
  with a hooks module. The test file is held back from the public plugin by
  `hooks/*.test.tsx` in `public-plugins.json`.
