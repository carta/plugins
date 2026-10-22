# Launch `--user-id`

A local launch of a dashboard server (`serve.py`) takes `--user-id <pk>` so its Snowplow events name a
person. `pk` is the integer Carta user id in the `get_current_user` result. `serve.py` saves it as
`.user-id` and reuses the saved id on later launches that omit the flag.

- **Build path** (any run that has already made a Carta MCP call, a build or a refresh): if `pk` is not
  in the session, call `mcp__<SERVER>__get_current_user` once, right after the run's first MCP call, and
  keep `pk`.
- **Warm-cache launch** (no MCP call is allowed): pass `--user-id` only when `pk` is already in the
  session. Never call the MCP just to get it.
- **Reusing a running server** (no launch): write `pk`, when in the session, to `<dashboard_dir>/.user-id`.
  The server reads that file per request, so it takes effect without a relaunch.
- Without a Carta MCP, omit the flag. Never substitute the email or a placeholder.
