# Open a companion page beside the chat

How a skill that reads this file puts a Carta companion page — the stakeholder ledger,
pending changes, a draft set, any other — into Claude's own browser pane, or a Claude in Chrome
tab when the pane isn't available, and how its reply leads back to the page. One home for the
procedure, so the page opens the same way whichever skill opened it.

A skill reading this brings two things of its own, both named in the skill: the address, and
the link text it posts.

## The procedure

Open the page in the same turn, without waiting to be asked. Post no link before you open it:
a markdown link in the chat always opens the admin's default browser, never the pane beside this
chat, whatever its text. [§ The way back to the page](#the-way-back-to-the-page) says what the
reply ends with.

Only the browser families below open the page. Never use Playwright or any other
browser-automation tool: it opens a separate browser the admin isn't looking at.

### Find the browser, once per conversation

The first time you open a page, send these two searches in one message:

```
ToolSearch(query: "+Claude_Browser preview_start navigate tabs_context tabs_create javascript_tool", max_results: 10)
ToolSearch(query: "select:mcp__ccd_view__show_pane,mcp__Claude_in_Chrome__tabs_context_mcp,mcp__Claude_in_Chrome__tabs_create_mcp,mcp__Claude_in_Chrome__navigate,mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate")
```

A tool is there when a search returns it or it is already among your tools. If
`enable__mcp__remote-devices__Claude_Browser` is the only browser tool the first search
returns, call it once, then run the first search again before deciding there is no browser.
Then the browser is the first of these that has a `navigate` tool, and every later call uses
that tool's prefix:

1. **Claude's browser**: a tool the first search returned (`mcp__Claude_Browser__` in the Code
   tab, `mcp__remote-devices__Claude_Browser__` in a regular conversation).
2. **Claude in Chrome**: `mcp__Claude_in_Chrome__` or `mcp__claude-in-chrome__`.
3. **None**: the link is the page for the rest of the conversation. Don't tell the admin you
   looked for a browser.

Don't search again later in the conversation. The Claude in Chrome tool names, this order, and
the new-tab first open and its one attempt in Chrome follow `carta-investors`'s
`references/gate-in-app-browser.md`; change them with it.

`Claude_Preview` is a different family: its `preview_start` launches a local server from
`.claude/launch.json` and can't open a Carta address. When `Claude_Preview` is all you have,
the link is the page.

### Open the address

The **page tab** is the one tab you open Carta pages in. Keep its `tabId` for the rest of the
conversation: a skill that steers the page later needs it.

1. **A page tab is kept**: `navigate` it to the address.
2. **Claude's browser with `preview_start`**: call `preview_start` with the address. Its
   `tabId` is the page tab.
3. **Claude's browser otherwise**: call `tabs_context` once. The page tab is the tab already on
   a Carta companion page of this company, else the active tab. With no tab, call
   `tabs_create` and use its `tabId`. Then `navigate` the page tab to the address.
4. **Claude in Chrome**: call `tabs_context_mcp`, then `tabs_create_mcp` for a new tab, then
   `navigate` that tab to the address. The new tab is the page tab. Never navigate a Chrome tab
   you did not open in this conversation.

In the same step, call `mcp__ccd_view__show_pane` with `{"pane": "preview"}` when you have it.
Without it the page can load into a pane the admin has collapsed, and the skill looks like it
did nothing.

**A failed open in Claude's browser gets one retry, at once.** When `navigate` or
`preview_start` fails with any error other than the policy errors below, before any other call,
call `tabs_context` once, take the page tab again as step 3 says, and `navigate` it to the same
address once. When that fails too, the browser is None for the rest of the conversation. Never
make a third attempt, never try another browser tool or another tab, and never fetch the page
another way. In Claude in Chrome, make one attempt: when it fails, the browser is None at once.
Don't mention a failure unless the admin asks why the page didn't open.

### When the page asks for something

- **A `login.` address**: ask the admin to sign in to Carta in that pane or tab once. The
  sign-in is kept for later sessions, and the page loads after they sign in. In Claude's
  browser, Carta staff sign-in (Okta) isn't allowed: tell a staff tester to sign in with a
  non-staff Carta account.
- **"blocked by your organization's policy" or "site policy check is unavailable"**: don't retry
  and don't call `tabs_context`. The browser is None for the rest of the conversation at once.

### Once it is open

The page refreshes itself, so never reload it to show new data, and never read it back to check
it: the admin sees it and it never needs you. A skill that moves an open page to another address
does it on the kept `tabId`; in Claude in Chrome, with that family's `navigate`.

## The way back to the page

**Answer in chat as well**, from the read results. The page is there to look at, not instead of
an answer. Then end the reply that opened or moved the page with one way back to it, which
depends on the browser:

- **Claude's browser** (the page tab is in Claude's browser): post no page link, in any reply. End
  the reply with one short line, one time, that names the page as the skill's link text does:
  "<The page> is open beside the chat. Cmd+Shift+B (Ctrl+Shift+B on Windows) shows the pane if
  it is hidden."
- **Claude in Chrome**: say once that the page is open in a Chrome tab, and end the reply with
  the link, `[<the skill's link text>](<address>)`.
- **None**: end the reply with the link, the same way.

A link is always a markdown link: never a bare URL, never a code block. It is the reply's only
page link. A skill may name more replies that end this way.
