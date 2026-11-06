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

`fa-tax`'s `tax-agent-companion.md` keeps its own copy of this detection; change it with this
file. `carta-cap-table`'s `references/open-the-companion-page.md` (Claude in Chrome step
only) copies both this detection and the "Open a link" steps below; change it with this file
too. `carta-cap-table`'s `carta-issuance-companion/references/companion-run.md` copies the
Claude in Chrome tool names and their order; change it with this file too.

## Open a link

Once `browser_family` is set, this is how a hosted hand-off opens a page for the user instead
of only giving its link as text: open the link first, then give the reply, then end the turn
— the reply with the link is always given, whether or not opening succeeded, so a failed or
missing browser costs the user nothing. A caller that can't read this file at all (claude.ai
chat is the surface where that happens) never reaches this section — its own "files can't be
found" handling is what applies instead, and that handling must still give the reply with the
link rather than stopping.

- `browser_family` is `none` → skip opening and give the link only.
- Otherwise open the link in a **new tab**: the family's tabs-context tool, then its
  tabs-create tool, then `navigate` to the link in that tab. Make one attempt. If it fails,
  say nothing about the failure and give the link only. Do not retry or try another family.
  The user signs in (or otherwise authenticates) on the opened page; never do it for them.
