# SOI review module — carta-investors

A Claude Code hooks module (`register.tsx`, declared in `hooks.json` beside it and named by the
`hooks` entry of `.claude-plugin/plugin.json`) that needs Claude Code 2.1.308 or later. Builds older than
2.1.286, and Cowork, skip it. Builds 2.1.286 to 2.1.307 load it, but it never learns a
review, because the tool name they pass to `tool.call` does not include the server. Every
build runs the command hooks in `hooks/hooks.json` (see `hooks/README.md`).

When Claude opens an SOI review in the Update Investments view, the module learns the
review from that `view_remote` result and polls Carta MCP's `fa__get__soi-review-state`
read through `read_tool`, on the same server the view came from. It shows
`SOI Q<n> <yyyy> · <status_label>` in the status line.

- Unlike the Carta MCP matcher allowlist in `hooks/README.md`, it accepts `view_remote` on any server, and recognises
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
- On the desktop app, draws a band above the prompt, under any other plugin's band
  (each keeps the rest of the chain, so both show in either order):
  the review, a status pill, fair value and change (or "Multi-currency"), the companies
  changed this session, and when it last updated (with a warning after a failed poll).
- `/soi-review` shares the review's companion page link and, on the desktop app only,
  asks Claude to open it in its built-in browser; or says there is no review, or no
  companion page for it.
- Every poll carries `_instrumentation_v2: { from_hook: true }`, so carta-mcp does not
  count it as Claude's usage.
- Tests: `claude plugin test plugins/carta-investors` runs `register.test.tsx`. In CI,
  validate.yml's plugin-tests job installs the claude CLI and runs
  `tests/plugin-mods/test_plugin_mod_suites.py`, which validates and tests every plugin
  with a hooks module. The test file is held back from the public plugin by
  `mods/*/*.test.tsx` in `public-plugins.json`.
- The module lives apart from `hooks/` on purpose: Anthropic's plugin directory review holds
  a plugin whose commands or scripts point at a folder that also holds a module's files. Keep
  the module, its hooks file and its types here, and keep every `${CLAUDE_PLUGIN_ROOT}/hooks/...`
  command pointing at `hooks/`, which holds no module files.
- `types/index.d.ts` is the `$.state` contract `claude plugin validate` checks the module
  against. The publish step drops the `types` entry from the published `plugin.json`.
