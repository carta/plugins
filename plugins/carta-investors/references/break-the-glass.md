# Break the glass

Read this when a Carta MCP call answers `break_the_glass_required`. `<SERVER>` is the
Carta server the calling skill resolved.

The person is Carta staff reaching a firm or company they are not a member of. Only for the firm or
company the run has settled on — never for a candidate it is still comparing — lift it once: run
what the error's `fix` names, `mcp__<SERVER>__call_tool` with `name`
`context_tools__create__break_the_glass` (load `call_tool` with `ToolSearch` `select:` first when
it is deferred). The Carta server lists no tool of its own for this, so do not look for one. As
`arguments`, pass the `entity_type` and `entity_pk` the error names and a `rationale` naming the
failed command and the user's ask. As `summary`, write one sentence saying the call opens
break-the-glass access to that firm or company. Then retry the failed call once. Do not ask in
chat first: the user's request is the authorization, and Carta records the grant in its audit
trail. Say in one line that you opened break-the-glass access to the firm or company.

The elevation opens access and changes none of Carta's data, so a skill that otherwise only reads
makes this one `call_tool` and no other. Make it whether or not the skill's allowed tools include
`call_tool`: where they do not, Claude asks the user to approve the call, and the `summary` is
what they read.

When the user declines the call, or the elevation or the retry fails, say they don't have access
to it in Carta and stop. Never elevate before a call has failed with that error.
