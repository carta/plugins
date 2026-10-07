# Portfolio Valuations — Claude Code Desktop Preview

Render the portfolio dashboard in the Claude Code preview panel. Reached
from Step 2.2b when `env_mode: "preview-server"`
(`mcp__Claude_Preview__preview_start` OR
`mcp__Claude_Browser__preview_start` is present) — this takes priority over
`Artifact`, so this path is used even when `Artifact` is also present. There
is no separate detection for the desktop app vs. the CLI here — both are
`env_mode: "preview-server"`, and this file covers either whenever a preview
panel is available.

**Two tool families, one flow.** Step 2.2a records which family answered as
`preview_tool_family` (`"claude_preview"` or `"claude_browser"`) — every step
below branches on it. Do not assume `Claude_Preview`: a Claude Code CLI
session with only `Claude_Browser` present is common, and calling the wrong
family's tool name fails outright, which silently drops the user back to the
`artifact` path (with its always-fires copy-to-chat button) instead of
the real local server this file provides.

The dashboard is served by a tiny local server (`scripts/preview_server.py`).
On each `GET /` the server calls `fill_template()` to render HTML from a small
pre-classified payload file. The `POST /run` endpoint catches button clicks from
the panel. The runner is shown as a widget (see `references/cowork-artifact.md`),
not served by this server.

**This step runs after Step 3.2's data load** — the portfolio data is already
in context when you arrive here.

## Step 1: Write the response file

Fetch **all pages** of `list:portfolio_dashboard` first (always `page_size: 100`); do not proceed until
the last page arrives. This raw response is injected into the page as-is (the
server does no Python-side classification for this path — see Step 3 of
`build_artifact.py`'s docstring — the template's own `classifyResponse()`
JS does it client-side), so add a top-level `requestAccessUrl` key to the
page object before writing it: build it as
`{BASE_URL}/investors/firm/{org_pk}/information-access/?has_active_holdings=true&inactive=false&ordering=captable_access&page=1&page_size=50`,
using the resolved `org_pk` (Step 1's firm selection) and `{BASE_URL}` per
`references/deep-link.md` Step 1 (the resolved app host, not the bare API
host). This powers the prep card's "Request access" secondary action.

Write the response to `.claude/preview/dashboard-data.json` using **Bash**
(not the `Write` tool — Bash requires no prior `Read`). For a single-page portfolio, write the page
object directly (with `requestAccessUrl` merged in). For multi-page portfolios, write a JSON array with
one element per page response, merging `requestAccessUrl` into every page object (`classifyResponse`
reads it off whichever page has it):

```bash
mkdir -p .claude/preview
cat > .claude/preview/dashboard-data.json << 'PAYLOAD'
<response JSON, each page object carrying "requestAccessUrl">
PAYLOAD
```

The server calls `fill_template()` directly from this file on each request.

## Step 2: Write `.claude/launch.json`

`launch.json` does **not** support `${CLAUDE_PLUGIN_ROOT}`, so write the
resolved absolute path to `preview_server.py` into `runtimeArgs`. Use
`autoPort: true` — the host picks a free port and injects it via the `PORT` env
var. Discover the assigned port from `preview_list` in Step 3:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "portfolio-valuations-preview",
      "runtimeExecutable": "uv",
      "runtimeArgs": ["run", "<absolute path to scripts/preview_server.py>"],
      "autoPort": true
    }
  ]
}
```

**Skip the write if the config is already present.** Before writing, read
`.claude/launch.json` (if it exists). If a configuration named
`portfolio-valuations-preview` is already present with the correct absolute
path in `runtimeArgs`, skip this step entirely — no write needed.

If `.claude/launch.json` already exists with other configurations, merge this
entry in rather than overwriting.

## Step 3: Launch and navigate the panel

The two tool families differ here — branch on `preview_tool_family`:

**`"claude_preview"`** — `preview_start` spawns the server but does not point
the panel iframe at it; `preview_eval` does. Run the three-call sequence:

1. Call `mcp__Claude_Preview__preview_start` with
   `name: "portfolio-valuations-preview"`. Safe to call on a refresh — reuses
   the server if already running. **This can fire in parallel with Step 1's
   file write** — the server boot doesn't read `dashboard-data.json` on startup;
   only a `GET` does, which happens at the `preview_eval` navigation below.
2. Call `mcp__Claude_Preview__preview_list` — find the entry named
   `portfolio-valuations-preview`. Extract its `port` and `serverId`.
3. Call `mcp__Claude_Preview__preview_eval` with that `serverId` and:
   ```javascript
   window.location.href = 'http://localhost:<port>/';
   ```

**`"claude_browser"`** — `preview_start` spawns the server **and** opens/points
a browser-pane tab at it in one call; there is no separate `preview_eval` step:

1. Call `mcp__Claude_Browser__preview_start` with `name:
   "portfolio-valuations-preview"`. Safe to call on a refresh — reuses the
   server if already running. **This can fire in parallel with Step 1's file
   write**, same reasoning as above. The result carries `port`, `serverId`,
   and `tabId` — it has already navigated that tab to `http://localhost:<port>/`;
   no further call is needed to point the panel at the server.
2. If you need to (re-)confirm which server/port is running (e.g. on
   session resume), call `mcp__Claude_Browser__preview_list` instead of
   `mcp__Claude_Preview__preview_list` — same purpose, find the entry named
   `portfolio-valuations-preview` and read its `port`.

Tell the user:
> 📊 Your portfolio dashboard is open in the preview panel. The card at the top
> shows how many companies are ready to value — click **Get started** to open
> the bulk runner. Or just tell me what you'd like to work on, or ask me to run
> valuations and I'll open the bulk runner widget.

The run card's **Get started** action first tries the local server's `POST
/run` endpoint — see `startBulk()` in `templates/dashboard.html` — which the
background poll (Step 4 below) catches as `intent: "open_runner"`. This is
the path that actually fires on a working Code preview: the server is real
and reachable, so the `fetch("/run", …)` call succeeds. `sendPrompt(text)` is
only reached as a fallback if that fetch fails (host has no local server
reachable from the panel), and even then the dashboard always shows a
copy-to-chat popover underneath so the button is never dead regardless of
which path fires.

**Fallback:** If `preview_start` is unavailable, point the user at the server
directly:
> *"Your portfolio dashboard is running at `http://localhost:7459/`. Open that
> in your browser to view it."*

If neither the preview panel nor a local server is reachable, fall through to
Step 2.2c's markdown table.

## Step 4: Start listening for the Run button

The poll script below is **single-shot** — it exits the moment the button is
clicked (or after ~30 min). It must be running whenever the panel is open;
if it isn't, the button falls back to the copy-to-chat panel.

**Always launch (or re-arm) the poll in these situations:**
- First time the panel is opened in a session (end of Step 3 above).
- After every completed run (immediately after writing `done`/`error` in Step 5).
- At the start of any session where the preview server is already running
  — call the `preview_list` for the recorded `preview_tool_family`
  (`mcp__Claude_Preview__preview_list` or `mcp__Claude_Browser__preview_list`)
  silently; if an entry named `portfolio-valuations-preview` is present with
  `status: running`, re-arm
  the poll immediately without waiting for the user to ask. Also delete any
  stale `.claude/preview/run-request.json` left from the previous session
  before re-arming so a ghost click doesn't fire.

Launch as a **background** Bash command (`run_in_background: true`) so
the user can still type in chat while it waits:

```bash
rm -f .claude/preview/run-request.json && uv run python -c "
import time, pathlib, sys
p = pathlib.Path('.claude/preview/run-request.json')
for _ in range(1800):
    if p.exists():
        print(p.read_text()); sys.exit(0)
    time.sleep(1)
print('TIMEOUT')
"
```

When the background command completes with a JSON payload, **delete
`.claude/preview/run-request.json`** (so the next click is fresh), then branch
on the payload shape:

- **`intent: "open_runner"`** — the request came from the dashboard's run card
  **Get started** button. It carries no `selection`. **Open the bulk-create Plan
  card first** (not the full list):
  follow the **Plan card** section of `references/cowork-artifact.md` (the
  interactive runner path is identical on **both** Cowork and Code Desktop — the
  card and list are `show_widget` widgets, not served by this local server, so
  there is no server change for them). The Plan card lets the user bulk-create in
  one click or open the full list to customize; do not run anything yet. After
  showing it, re-arm the poll (Step 4).

  The Plan card's buttons route through the chat composer (`sendPrompt` +
  copy-to-chat fallback), **not** through this server's `/run` endpoint — so a
  Plan-card click arrives as a normal chat message ("Bulk-create valuations for
  the following companies: …" or "Open the bulk runner so I can customize …"),
  which you handle inline. Only the full **runner list** posts a `selection` to
  `/run` (next branch).

- **`selection` array present** — the request came from the runner **list**
  widget (shown via the Plan card's **Adjust by company** button). Echo the run
  into chat (print the `prompt` field first), then treat `selection` as the
  company list and run the bulk runner from Step 4 (read
  `references/bulk/bulk-runner.md` inline). Each selection entry has `name`,
  `approach`, `date`, `ev` (for Custom Value), and `copyFrom` (for
  "Previous period").

If the user types an instruction in chat instead, handle it normally — the
stale poll will time out on its own.

**Skip Step 3.2's markdown table.** Proceed to Step 2.3's plain-text follow-up
menu for users who prefer to drive from chat, but do not block on it — the
panel button is the primary path.

## Step 5: Signal run state to the panel

Progress is shown **in the chat** — narrate there as you work. The panel needs
only two signals, written to `.claude/preview/run-status.json`:

```json
{ "state": "running" }   // write promptly after the poll hands you a run
{ "state": "done" }      // write when the batch finishes (or "error")
```

Write `running` within a few seconds of picking up the request (otherwise the
~15s stall fallback offers the paste-into-chat path). The moment you write
`running`, the panel hides the stall fallback so the user doesn't also paste and
double-run.

**Refresh the dashboard data before writing `done`.** Before writing `done`,
call `portfolio_valuations:list:portfolio_dashboard` (all pages, `page_size: 100`) to get the
authoritative latest state, then:

1. Write the response to `.claude/preview/dashboard-data.json` via Bash
   (same heredoc pattern as Step 1 — no Read required), merging
   `requestAccessUrl` back into the page object(s) exactly as in Step 1 —
   it does not come back from `list:portfolio_dashboard` on its own:
   ```bash
   cat > .claude/preview/dashboard-data.json << 'PAYLOAD'
   <response JSON, each page object carrying "requestAccessUrl">
   PAYLOAD
   ```
2. Write `done` to `run-status.json`.

The panel sees `done` and calls `window.location.reload()` — the server renders
fresh HTML from the updated `dashboard-data.json`. Do not reconstruct the
payload from in-context state alone — always re-fetch so finalizations,
deletions, or other changes made mid-session are captured accurately.

**Re-arm the poll after every run.** The background poll is single-shot — it
exits once it hands you a request. Relaunch it immediately after writing the
final `done`/`error` so the next button click is caught. The only uncovered
window is the few seconds while relaunching, which is covered by the panel's 15s
stall fallback.

## Step 6: Refresh after any chat-driven mutation

Any mutating operation initiated from chat — finalize, delete, create, set
approach, run allocation, etc. — must be followed by a dashboard refresh so the
panel stays in sync. After the operation completes:

1. Call `portfolio_valuations:list:portfolio_dashboard` (all pages, `page_size: 100`).
2. Write the response to `.claude/preview/dashboard-data.json` via Bash
   (same heredoc pattern as Step 1 — no Read required), merging
   `requestAccessUrl` back into the page object(s) as in Step 1.
3. Trigger the panel to re-render — the call depends on `preview_tool_family`:
   - **`"claude_preview"`**: call `mcp__Claude_Preview__preview_eval` with
     `window.location.reload()`.
   - **`"claude_browser"`**: there is no `preview_eval` in this family. Call
     `mcp__Claude_Browser__javascript_tool` with `action: "javascript_exec"`
     and `text: "location.reload()"` against the panel's `tabId` (the one
     `preview_start` returned in Step 3).

Do this silently — no need to narrate the refresh steps to the user. The panel
update is the confirmation.
