# Launch `--user-id`

A local launch of a dashboard server (`serve.py`) takes `--user-id <pk>` so its Snowplow events name a
person. `pk` is the integer Carta user id in the `get_current_user` result. `serve.py` saves it as
`.user-id` and reuses the saved id on later launches that omit the flag.

A build also reads `.user-id` on its own — `carta-manco-reporting`'s `own_sync.py` sweeps a dashboard's
own reports to Carta right after every build, under whoever `.user-id` names at that moment. So `.user-id`
must hold the *current* run's operator by the time the build script runs, not just by the time `serve.py`
next launches — a stale id from a previous operator's run would push this run's reports under their name
instead.

- **Build path** (any run that has already made a Carta MCP call, a build or a refresh): if `pk` is not
  in the session, call `mcp__<SERVER>__get_current_user` once, right after the run's first MCP call, and
  keep `pk`. Once `<dashboard_dir>` is resolved in this same run — right away if it's already known at
  this point, otherwise as soon as it becomes known, and always before the build script runs — write `pk`
  to `<dashboard_dir>/.user-id` as plain text, no surrounding whitespace.
- **Launch with no MCP call this run** (a cache-only reopen, e.g. one that could not reach Carta):
  pass `--user-id` only when `pk` is already in the session. Never call the MCP just to get it.
- **Reusing a running server** (no launch): call `mcp__<SERVER>__get_current_user` when `pk` is not
  already in the session, then write it to `<dashboard_dir>/.user-id` the same way. The server reads that
  file per request, so it takes effect without a relaunch — and a dashboard reused by a different operator
  than whoever last launched or built it doesn't keep acting under the previous one's id.
- Without a Carta MCP, omit the flag and skip the file write. Never substitute the email or a placeholder.
