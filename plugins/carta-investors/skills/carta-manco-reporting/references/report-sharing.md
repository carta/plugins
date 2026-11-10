# Budget reports and sharing

Every budget on the Budget vs Actuals page is a **report**. Each imported workbook budget
seeds one in `<dashboard_dir>/reports.json` (`scripts/report_store.py`), and the build reads
reports instead of the workbook files, so mapping, variance and questions work the same for
every report. A workbook report keeps following its workbook: a re-import or a newly
answered mapping question reaches it on the next build.

## What a person can do in the app

All from the report controls beside **Export**, and none of it needs Claude in the loop:

| Action | What happens |
|---|---|
| Rename | Local, immediately. For a report this dashboard syncs to the hosted app (own_sync.py), your own synced copy there catches up when the user asks the skill to push reports to the hosted app (Step 5.2) — a rebuild the app itself triggers pushes nothing, since it runs with `--no-sync-sweep`. A rename made on the hosted app reaches here the same way: on a push the user asks for (Step 5.2), or sooner if `serve.py`'s own background reconcile runs at this dashboard's next launch (needs the `claude` CLI signed in); a rename of a hosted copy or Carta's own budget stays on the hosted app. |
| Duplicate | Local, immediately; the copy reaches the hosted app the same way, when the user asks for a push (Step 5.2). Holds its own copy of the budget and keeps the report's budget mapping. |
| Hide | Local and hosted. Hidden reports come back from the sidebar's **Show N hidden**. |
| Share | Only the people you add (where a new share starts), or everyone who can view the entity's accounting. People are picked from that same list, which the dashboard saves for a day in `.shareable-users.json` (**Refresh** under the list asks Carta again; a recipient Carta refuses clears it). |
| Update | Sends the owner's later changes. Until then recipients keep the version they have. When the report has no share (sharing was stopped, maybe in another tab), nothing is sent: the app is told the shared copy was deleted and asks whether to share it as new or keep it private. A share reaches everyone only when the Share dialog sends an explicit choice of everyone. |
| Stop sharing | Deletes the shared copy for everyone; the owner's local report stays. |
| Load shared reports | Pulls reports others shared. They are read-only; **Duplicate** makes a copy of your own. |

A shared report reads **Changes not shared yet** (a dot on Share and in the sidebar) once
what it would be shared with now differs from what was last sent: after a rename, a workbook
re-import or a newly answered mapping question. Each build compares a fingerprint of the
payload that was sent with the payload it just wrote.

Filters and other view settings are not shared. Comments are.

A tag-, sub-account-, or vendor-scoped line carries only its scope's name (schema v1),
not which dimension it's scoped by — the recipient's own chart-of-accounts mapping
resolves that on their side, so a line can read differently for them than for the
person who shared it.

## The action vocabulary

The app's frontend (`app/src/state/useReports.js`, `REPORT_ACTIONS`) names each report
change and share operation with one of these strings, and shows the control for one only
when the server says it's available:

- Per-report actions, sent as `POST /api/reports/<id>/<action>`: `rename`, `duplicate`,
  `hide`, `remove`, `unlink`, `derive` (a custom report made from this one) and, for
  custom reports, `edit` (its owner re-cutting it from its source).
- Share operations, sent as `op` to `POST /api/reports/share-op`: `share`,
  `publish-as-new`, `delete`, `pull`, `users`.

`GET /api/reports` can answer with an `actions` array naming exactly which of these it
supports; when the field is absent, every action is allowed (`serve.py` sends no `actions` field).
A server implementing any of these must use these exact strings — the frontend gates each
control on the matching name, not a synonym.

## How sharing reaches Carta

`serve.py` never calls Carta over HTTP. A share runs a headless `claude -p` session
(`scripts/share_bridge.py`), which calls the `fa:*:budget_report*` commands through the
person's own Carta connector, so Carta checks their permissions. The payload is the
canonical model (`scripts/shapes/canonical.py`, `SCHEMA_VERSION = 1`), checked before it
is sent (`scripts/report_payload.py`) and again by Carta.

In-app Share, above, always goes through this `claude`-CLI bridge. `--no-sync-sweep`
(serve-and-update.md Step 4) skips the *own-sync* sweep below only — a separate path to
Carta that mirrors your own reports privately, with no effect on Share.

- The connector is picked from the cache's Carta environment. A non-production cache never
  uses a production connector.
- `--share-mcp-server <name>` (or `MANCO_SHARE_MCP_SERVER`) pins one connector, for example
  a test connector. The startup banner prints which connectors sharing will use. The pin is
  also recorded to `<dashboard_dir>/.share-mcp-server` (`manco_paths.write_share_mcp_server`),
  so `own_sync.py`'s sweep — which runs in its own process, with no access to `serve.py`'s
  flags, whenever something builds without `--no-sync-sweep` — pushes and retires own-sync
  mirrors through that same connector. This pin has no effect on Step 5.2's session push:
  that runs over the Claude session's own Carta connector (`<SERVER>`), never the `claude`
  CLI's. A live `serve.py` re-reads this file on every `_get_bridge()` call and rebuilds its
  own cached Bridge whenever the pin has moved since that Bridge was built, so a relaunch
  that changes or clears the pin takes effect on the running daemon too, not just on sweeps
  spawned after it.
- The `claude` binary the bridge starts is found by `scripts/preflight_claude.py`
  (Step 0.5): `--claude-bin` (or `MANCO_CLAUDE_BIN`) pins one explicitly; otherwise PATH,
  the usual install locations, and the launching Claude Code session's own binary
  (`CLAUDE_CODE_EXECPATH`) are searched in order. `serve.py` re-probes whenever
  `GET /api/claude-status` is asked for while marked unavailable, or right after a
  share fails to reach Carta, so installing or signing in takes effect without a
  relaunch. Only a changed binary path replaces the cached Bridge; a sign-out keeps
  the same Bridge, whose session ends on the failed call, and each later call starts
  a fresh session that fails the same way until the operator signs back in.
  `/api/claude-status` answers `{"available", "state", "reason"}`: `state` is
  `checking` (no probe has landed yet, `reason` is `null`), `available`, or
  `unavailable`; once a probe has run, `reason` is `ok`, `not_installed`, or
  `not_logged_in`.
- The skill pushes the owner's own reports to Carta for the hosted app itself, through this
  session's own Carta connector, when the user asks for it — Step 5.2
  ([serve-and-update.md](serve-and-update.md)), via `own_sync.py --plan`. The same
  `plan_push` that a sweep (below) would use builds what the session sends, so the two
  never differ. `--plan` plans a push for every report that's new or changed,
  unconditionally — there is no `claude` CLI to wait on or defer to, since Step 4 always
  builds with `--no-sync-sweep`.
  - `--plan --mirrors <file>` reconciles first: `<file>` holds a `fa:get:budget_reports`
    `call_tool` result the session's own sub-agent fetched over its Carta connector
    (own_sync.py has none) and wrote exactly as the tool call returned it, read this way
    since planning and pushing run in separate processes. `own_sync.py` unwraps it
    (`share_bridge.unwrap`, the same way a live bridge call unwraps its own capture) and
    checks it the same way `list_reports` checks a live listing
    (`share_ops.trusted_reports`), then `reconcile_names_from_listing` settles every
    own-synced report's name against it before anything is planned — without this, a plan
    built after a rename made on the hosted app would resend the pre-rename name and
    silently overwrite it. The file is read once and deleted, so a later `--plan --mirrors`
    reusing a leftover path reconciles against nothing rather than a listing that could now
    be stale.
  - `--plan` (`--mirrors` omitted) drops any earlier plans and writes, per push due,
    `<dashboard_dir>/.own-sync-plan/<report_id>.arguments.json` (the call's exact
    `arguments`) and `<report_id>.plan.json` (what `--record` stamps), and prints
    `{"pushes": [{"report_id", "name", "command", "arguments_file"}]}`. Without a user id it
    exits 3 and prints `{"error": "no_user_id"}`.
  - `--plan --recreate <report_id>` plans one report as a create, after Carta answered its
    update with `not_owner` (the link is no longer this user's to update), and replaces only
    that report's plan.
  - `--retire <report_id>` is the `not_found` counterpart: the hosted app's own Delete, most
    likely, not `not_owner`'s "no longer mine" — there is no mirror left to recreate. Records
    the report's own-sync as retired (`report_store.ReportStore.retire_own_sync`) and drops
    its plan, making no Carta call at all: a later `--plan` never pushes this report again,
    sweep or session alike, until an explicit `--recreate` starts it over. The local report
    itself is untouched, just unsynced.
  - `--lookup <report_id>` is a plain local read of the report's own-sync uuid as last
    recorded — no Carta call, no lock. Prints `null` for an unknown report id, one whose
    own-sync was retired (`--retire`, above), or while a plan for this report is still on
    disk (a push this run hasn't recorded yet, whether it's still in flight or it failed) —
    never a uuid a failed push or a retired link left stale.
- `own_sync.py`'s **sweep** (`own_sync.py` with no flags) mirrors the owner's own reports to
  Carta through a headless `claude` session, the same way Share does. It runs only when
  something calls `build_manco_datadir.py` *without* `--no-sync-sweep` — never from this
  skill's own Step 4, which always passes it; see [serve-and-update.md](serve-and-update.md)'s
  Step 4. Until the operator's user id file, a working `claude` CLI and a Carta connector
  that CLI can reach are all in place, it pushes nothing and writes why to
  `<dashboard_dir>/own_sync.log`. `own_sync_status.json` holds
  `{"blocked_by": <reason or null>[, "due": [report ids]]}` under one rule
  (`own_sync._record_blocked`): `no_user_id` whenever no user id is saved, for every report;
  `not_installed`, `not_logged_in` or `unreachable` only while some of the owner's reports have
  a push due, with `due` naming them; otherwise `null`, including after any push, a sweep's or
  a session's `--record`. This status is diagnostic only — `own_sync.py --plan` (the session's
  own call) never reads it.
- While any plan exists, carta-investors' `scripts/hooks/guard-own-sync-push.js` (a
  PreToolUse hook on the Carta connector's `call_tool`) refuses a budget-report create or
  update that belongs to it but differs from its arguments file. The bridge's own relay
  session is exempt (`share_bridge.BRIDGE_ENV`): it checks its calls itself.
- `--record <report_id> --uuid <uuid>` reads the `.plan.json` the latest `--plan` wrote,
  stamps the push, drops that plan either way, clears `blocked_by`, and prints
  `{"recorded": <bool>, "delete_uuid": <uuid or null>}`. `delete_uuid` names a mirror the
  session must delete, when the report was removed while its push was in flight. When
  `--uuid` already names a different, real local report, it prints
  `{"recorded": false, "delete_uuid": null, "error": "conflict"}` instead, deleting
  nothing — that uuid is the other report's live mirror. Used by Step 5.2's sub-agent
  after every push.
- The session runs only the Carta command it was asked for: a hook (`scripts/relay_guard.py`)
  blocks any other, and the session is closed after reading reports other people shared, so
  their text never reaches a later call. It can't edit files or run commands.
- A `not_logged_in` error's dialog offers a **Sign in to Claude** button alongside the
  copy-to-clipboard prompt. It posts `/api/claude-signin`, which runs `claude auth login`
  with its stdin left open on a pipe — never written to or closed — and hands back the
  URL the CLI prints. Leaving stdin open matters: the CLI blocks reading a paste-back
  code from it, and that read is what keeps the process alive long enough for the
  browser's OAuth redirect to complete the sign-in locally; closing stdin (or DEVNULL)
  would answer that read with EOF and exit the CLI before the redirect could ever
  arrive. The dashboard itself opens the returned URL in a new tab, then polls
  `GET /api/claude-status` every couple of seconds until it reports signed in, for up
  to ten minutes — matching (but tracked independently of) the server's own
  `_SIGNIN_WINDOW`, past which `serve.py` kills the process itself and frees the slot
  for another attempt. Past its own ten minutes the dialog gives up too, returning to
  its button with "Still not signed in — try again." `not_installed` never gets this
  button — installing needs Step 0.5's confirmation, which this endpoint doesn't ask
  for.
- When no candidate server's welcome resolves, the `claude` CLI session's own
  `system`/`init` event (`--verbose` stream-json) tells `Bridge._probe_welcome`
  (`scripts/share_bridge.py`) which of the Bridge's own candidate servers were configured
  at all, whether or not their welcome then succeeded. The init event reports each
  connector's **display name** — for the native claude.ai-managed Carta connector that's
  literally `claude.ai Carta` (a space, mixed case), not the underscored **tool-call
  prefix** (`claude_ai_Carta`) the Bridge's own candidate-server tuples hold. `_probe_welcome`
  normalizes each init-event name with `_tool_prefix` (every run of characters outside
  `[A-Za-z0-9_-]` becomes one underscore, trimmed at the ends — the same rule
  `carta-compensation-app`'s `location_fetch._tool_prefix` uses for the identical problem)
  before comparing it against the candidate servers — without this, the exact case this
  whole mechanism exists for (a production user's native connector token lapsing) would
  never be detected as "configured" at all. The normalized form is what `ShareError.configured`
  carries; the original display name is kept alongside it for the user-facing message,
  since that's what `/mcp` actually shows the operator to pick.
  - One of them was configured: that connector is signed out, not missing. The error names
    it, by its display name, and asks the operator to re-authenticate it by hand (run
    `claude`, `/mcp`, pick it, choose Authenticate) — never registers a second one
    alongside it. Stacking a second Carta connector would leave two Carta tool surfaces
    active at once and still wouldn't fix the one that's actually broken.
  - None of them were configured at all: `Bridge._connect` raises the plain "Couldn't
    reach Carta — sharing needs your Carta connector connected in Claude." error with no
    side effect. Registration only happens one layer up, in `serve.py`'s `_run_share_op`
    (its `ShareError` `UNREACHABLE` branch) — the one place a real share operation the
    operator started is in play (`users`, `share`, `publish-as-new`, `delete`, or `pull`),
    never the background sweep (`own_sync.sweep`, run with nobody watching after every
    build) or the startup reconcile (`_reconcile_own_sync_names_at_startup`). It makes
    exactly one `claude mcp add --transport http <entry> <url> --scope user` call for the
    cache's Carta environment (`share_bridge.register_connector`, whose
    `CONNECTOR_REGISTRATION` table maps each environment to its entry name and URL) — but
    only when that environment's entry is among the Bridge's own candidate servers, so a Bridge pinned
    (`--share-mcp-server` / `MANCO_SHARE_MCP_SERVER`) to a server outside that table (a
    local stack, say) never falls back to registering the environment's default connector
    instead. An environment with no known connector (e.g. a local stack) skips
    registration entirely rather than guessing a URL. `register_connector` returns the
    entry name it wrote (or `None`), and `serve.py` builds its message from that returned
    name directly rather than re-deriving it from `CONNECTOR_REGISTRATION` a second time —
    two independent lookups could otherwise end up naming different entries. `claude mcp
    add` only writes a config entry — it never starts OAuth or opens a browser — so the
    message on a successful registration names the entry and tells the operator to sign in
    themselves: "Added the Carta connector `<entry>` to Claude, but it still needs you to
    sign in: run `claude`, type `/mcp`, choose `<entry>` and pick Authenticate, then try
    sharing again." That trailing sign-in sentence is built once, by
    `share_bridge.sign_in_steps(name)`, and shared verbatim by both this message and the
    re-auth message above. The operator's next share attempt is the de facto retry; there is no
    code-level one. Nothing to register (unknown environment, the entry isn't among the
    Bridge's candidate servers, or `claude mcp add` failed for any reason other than the
    entry already existing) leaves the plain "Couldn't reach Carta — sharing needs your
    Carta connector connected in Claude."
    error in place.

When Carta hasn't turned the budget-report commands on for someone, the app says sharing
isn't available yet.

## Same-named reports in "Shared with you"

The hosted app's own listing is entity-wide, not scoped to what was shared with you.
`opPull` skips every report you own (`is_owner`), so none of yours shows under "Shared with
you" — Carta's own-sync comment in `server/reportShare.js` (right above `opPull`) states
this rule. Another user's own-sync mirror is not yours, so it does: it imports into "Shared
with you" as `shared_<slug>`, then `-2`, `-3`, … for each further report with the exact same
name. Those can be mistaken for your own report, especially right after you've just pushed
one from a common workbook sheet name such as "Opex Budget by Bucket." Your own report only
ever shows under Budget vs Actuals, because Carta marks your own-sync mirror `is_owner` with
`shared_with` set to exactly your own user id (`isOwnSyncMirror`) — a shape a deliberate
Share never produces (sharing with only yourself is refused) — so there's no ambiguity about
which section a report belongs in, even when two names collide.

## When something goes wrong

The dialog explains each failure in plain words. Two ask the owner to decide:

- **Changed on Carta since you last shared:** offer **Overwrite with my version**, which is
  a forced update.
- **The shared copy was deleted:** offer **Share as new** or **Keep private**, which drops
  the link to Carta.

A shared-in report built on a different data date than the reader's own gets a banner
only. Its figures are never adjusted.

## Loading shared reports from chat

The app's **Load shared reports** runs through a background Claude session. When that can't
reach Carta, the app suggests a prompt ("Load the budget reports shared with me into my …
ManCo reporting dashboard") that runs the same load from the user's own session. When the user asks for
that load in chat, the skill's Step 5.4 ([serve-and-update.md](serve-and-update.md)) runs
steps 1-4 below through a sub-agent and reports this section's step 5 outcome. Do it with these steps,
in order, and nothing else. Do not search for the script; its path is below.

1. Find the dashboard directory the usual way (`manco_paths.py resolve`), then get the entity:

   ```bash
   <UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/import_shared_reports.py" context --data-dir "<dashboard_dir>"
   ```

   It prints `{"fund_uuid": "<fund_uuid>"}`.

2. List the reports: `call_tool` with name `fa__get__budget_reports` and arguments
   `{"fund_uuid": "<fund_uuid>"}`.

3. For each report in that list, fetch it: `call_tool` with name `fa__get__budget_report`
   and arguments `{"fund_uuid": "<fund_uuid>", "report_uuid": "<report_uuid>"}`. Fetch every
   report, `is_owner` true or false — `import_shared_reports.py import` (next step) decides
   on its own which ones it actually needs: someone else's share, a report this dashboard
   already tracks, or one of the user's own reports with no local record yet, adopted as a
   personal copy rather than filed under Shared Reports.

4. Write the answers, unchanged, to `<dashboard_dir>/.reports/pulled.json` as
   `{"list": <step 2 result>, "reports": {"<report_uuid>": <step 3 result>, ...}}`, then:

   ```bash
   <UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/import_shared_reports.py" import --data-dir "<dashboard_dir>" --responses "<dashboard_dir>/.reports/pulled.json"
   ```

   It prints the counts (`added`, `adopted`, `updated`, `removed`, `skipped`,
   `duplicate_dropped`). A report whose payload fails the contract — or whose size
   `fa:get:budget_report` offloaded to a document URL instead of inlining — is skipped,
   never shown with wrong numbers. Copies of the user's own report — same name and same
   budget content (lines, amounts, period, currency and view; the variance-chart data each
   build refreshes doesn't count) — become at most one local report: none when a local
   report already is that report, otherwise only the most recently updated copy. Two
   reports with the same name but different budget content are both kept. The other
   copies stay in Carta untouched, are recorded locally so no later pull offers them
   again, and are counted once in `duplicate_dropped`, on the pull that first sees them.

5. Tell the user how many reports were added, adopted as their own, or updated, and to
   reload the dashboard page.
   If step 2's `call_tool` answers that the command "is not enabled for this user" (or either
   step answers "Unknown tool"/"Unknown command"), sharing isn't turned on for them yet; say
   so and stop.

The payloads are the firm's budget figures: keep `pulled.json` inside the dashboard
directory and don't copy it anywhere else.
