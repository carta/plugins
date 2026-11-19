# Break the glass

Read this when a Carta MCP call answers `break_the_glass_required`. `<SERVER>` is the
Carta server the calling skill resolved.

The person is Carta staff reaching a firm or
company they are not a member of. Only for the firm or company the run has settled on — never for
a candidate it is still comparing — call `mcp__<SERVER>__break_the_glass` once (load it with
`ToolSearch` `select:` first when it is deferred), with the `entity_type` and `entity_pk` the error
names and a `rationale` naming the failed command and the user's ask, then retry the failed call
once. Do not ask first: the user's request is the authorization, and Carta records the grant in its
audit trail. Say in one line that you opened break-the-glass access to the firm or company. When
the tool is not in this session, or the elevation or the retry fails, say they don't have access to
it in Carta and stop. Never call it before a call has failed with that error.
