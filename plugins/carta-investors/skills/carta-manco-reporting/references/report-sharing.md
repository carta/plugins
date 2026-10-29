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
| Rename | Local and hosted. A local rename also reaches your own synced copy in the hosted app (own_sync.py) when the report is one of your own. A rename made on the hosted app comes back here only for a report this dashboard syncs to the hosted app (own_sync.py), at the next rebuild or at this dashboard's next launch; a rename of a hosted copy, an uploaded budget or Carta's own budget stays on the hosted app. |
| Duplicate | Local and hosted. Holds its own copy of the budget and keeps the report's budget mapping. |
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

- The connector is picked from the cache's Carta environment. A non-production cache never
  uses a production connector.
- `--share-mcp-server <name>` (or `MANCO_SHARE_MCP_SERVER`) pins one connector, for example
  a test connector. The startup banner prints which connectors sharing will use. The pin is
  also recorded to `<dashboard_dir>/.share-mcp-server` (`manco_paths.write_share_mcp_server`),
  so `own_sync.py`'s detached post-build sweep — which runs in its own process, with no access
  to `serve.py`'s flags — pushes and retires own-sync mirrors through that same connector. A
  live `serve.py` re-reads this file on every `_get_bridge()` call and rebuilds its own cached
  Bridge whenever the pin has moved since that Bridge was built, so a relaunch that changes or
  clears the pin takes effect on the running daemon too, not just on sweeps spawned after it.
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
- After every build, `own_sync.py`'s sweep mirrors the owner's own reports to Carta for the
  hosted app. Until the operator's user id file, a working `claude` CLI and a Carta connector
  that CLI can reach are all in place, it pushes nothing and writes why to
  `<dashboard_dir>/own_sync.log`. `own_sync_status.json` holds
  `{"blocked_by": <reason or null>[, "due": [report ids]]}` under one rule
  (`own_sync._record_blocked`): `no_user_id` whenever no user id is saved, for every report;
  `not_installed`, `not_logged_in` or `unreachable` only while some of the owner's reports have
  a push due, with `due` naming them; otherwise `null`, including after any push, a sweep's or
  a session's `--record`. `GET /api/reports` returns it as `own_sync`. The local app re-reads
  that list whenever its tab becomes visible again, and shows the reason, with what to do, on
  each of the owner's reports it applies to (`app/src/reports/OwnSyncNotice.jsx`): "Not on the
  hosted app" for a report no sync has pushed yet, "Changes won't reach the hosted app" for one
  an earlier sync did.
  `unreachable` is the usual case for a dashboard built in the Claude desktop app: its
  Carta connector isn't available to the `claude` CLI.
- A Claude session with its own Carta connector makes those pushes itself through
  `own_sync.py`. The same `plan_push` builds what the sweep sends, so the two never differ.
  - `--plan` takes the sweep's lock, so it waits out a sweep already holding it (one not yet
    started isn't waited for). It writes, per push due,
    `<dashboard_dir>/.own-sync-plan/<report_id>.arguments.json` (the call's exact `arguments`)
    and `<report_id>.plan.json` (what `--record` stamps), and prints
    `{"pushes": [{"report_id", "name", "command", "arguments_file"}]}`. Each run drops earlier
    plans first. Without a user id it exits 3 and prints `{"error": "no_user_id"}`.
  - `--plan --recreate <report_id>` plans one report as a create, after Carta answered its
    update with `not_found` or `not_owner`.
  - `--record <report_id> --uuid <uuid>` reads the `.plan.json` the latest `--plan` wrote,
    stamps the push, drops that plan, clears `blocked_by`, and prints
    `{"recorded": <bool>, "delete_uuid": <uuid or null>}`. `delete_uuid` names a mirror the
    session must delete, when the report was removed while its push was in flight.
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

When Carta hasn't turned the budget-report commands on for someone, the app says sharing
isn't available yet.

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
ManCo reporting dashboard") that runs the same load from the user's own session. Do it with
these steps, in order, and nothing else. Do not search for the script; its path is below.

1. Find the dashboard directory the usual way (`manco_paths.py resolve`), then get the entity:

   ```bash
   <UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/import_shared_reports.py" context --data-dir "<dashboard_dir>"
   ```

   It prints `{"fund_uuid": "<fund_uuid>"}`.

2. List the reports: `call_tool` with name `fa__get__budget_reports` and arguments
   `{"fund_uuid": "<fund_uuid>"}`.

3. For each report in that list whose `is_owner` is false, fetch it: `call_tool` with name
   `fa__get__budget_report` and arguments `{"fund_uuid": "<fund_uuid>", "report_uuid": "<report_uuid>"}`.

4. Write the answers, unchanged, to `<dashboard_dir>/.reports/pulled.json` as
   `{"list": <step 2 result>, "reports": {"<report_uuid>": <step 3 result>, ...}}`, then:

   ```bash
   <UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/import_shared_reports.py" import --data-dir "<dashboard_dir>" --responses "<dashboard_dir>/.reports/pulled.json"
   ```

   It prints the counts (`added`, `updated`, `removed`, `skipped`). A report whose payload
   fails the contract — or whose size `fa:get:budget_report` offloaded to a document URL
   instead of inlining — is skipped, never shown with wrong numbers.

5. Tell the user how many reports were added or updated and to reload the dashboard page.
   If step 2's `call_tool` answers that the command "is not enabled for this user" (or either
   step answers "Unknown tool"/"Unknown command"), sharing isn't turned on for them yet; say
   so and stop.

The payloads are the firm's budget figures: keep `pulled.json` inside the dashboard
directory and don't copy it anywhere else.
