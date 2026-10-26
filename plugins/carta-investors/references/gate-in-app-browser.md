# Gate: detect the in-app browser

Run once per session, before opening any page for the user. It sets `browser_family`.

```
ToolSearch(query: "select:mcp__Claude_Browser__navigate,mcp__Claude_Browser__tabs_context,mcp__Claude_Browser__tabs_create,mcp__remote-devices__Claude_Browser__navigate,mcp__remote-devices__Claude_Browser__tabs_context,mcp__remote-devices__Claude_Browser__tabs_create,enable__mcp__remote-devices__Claude_Browser,mcp__Claude_in_Chrome__navigate,mcp__Claude_in_Chrome__tabs_context_mcp,mcp__Claude_in_Chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp")
```

A tool is present when ToolSearch returns its schema or it is already loaded. If `enable__mcp__remote-devices__Claude_Browser`
is the only browser tool present, call it once, then run the ToolSearch again before setting `browser_family`.

Set `browser_family` to the first family whose `navigate` tool is present:

1. `claude_browser`: `mcp__Claude_Browser__*` or `mcp__remote-devices__Claude_Browser__*`, Claude Desktop's in-app
   browser (the remote-devices prefix when the session runs in the cloud linked to the person's computer, as in
   Cowork). Use whichever prefix answered for every call.
2. `claude_in_chrome`: `mcp__Claude_in_Chrome__*` or `mcp__claude-in-chrome__*` (Cowork, and Claude Code with
   Chrome connected). Use whichever prefix answered for every call.
3. `none`: neither, as in the terminal.

Only these tools count. Never open a page with Playwright or any other browser-automation server: it opens a
separate browser the user isn't looking at.

A skill that uses this gate lists all thirteen tools and `ToolSearch` in its own `allowed-tools`, because frontmatter
cannot include a file.

`carta-valuations-workflow` (its probe adds `find` and `computer`) and `fa-tax`'s `tax-agent-companion.md` keep
their own copies of this detection; change them with this file.
