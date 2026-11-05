# Open a companion page beside the chat

How a skill that reads this file puts a Carta companion page — the stakeholder ledger,
pending changes, any other — into Claude's own browser panel, or a Claude in Chrome tab when
the panel isn't available. One home for the procedure, so
the page opens the same way whichever of them opened it.

A skill reading this brings two things of its own, both named in the skill: the address, and
the link text it posts.

## The procedure

1. **Always post the link first**, as a markdown link, in the skill's own words:
   `[<the skill's link text>](<address>)`.
2. **Open it in Claude's built-in browser yourself** (or, without one, in Claude in Chrome),
   right after the link, without waiting to be asked. A link on its own opens the admin's default
   browser, not the panel beside this chat.
   1. Look at the tools you already have for one whose name contains `Claude_Browser`
      (`mcp__remote-devices__Claude_Browser__preview_start` in a regular conversation,
      `mcp__Claude_Browser__preview_start` in the Code tab). If there is one, call its
      `preview_start` with the address. When there is no `preview_start`, call its
      `tabs_context` and `navigate` that tab's `tabId` to the address.
   2. Only for whichever of these tools aren't already among your tools, run
      `ToolSearch(query: "select:mcp__remote-devices__Claude_Browser__preview_start,mcp__remote-devices__Claude_Browser__navigate,mcp__remote-devices__Claude_Browser__tabs_context,mcp__remote-devices__Claude_Browser__javascript_tool,mcp__Claude_Browser__preview_start,mcp__Claude_Browser__navigate,mcp__Claude_Browser__tabs_context,mcp__Claude_Browser__javascript_tool,mcp__ccd_view__show_pane,enable__mcp__remote-devices__Claude_Browser")`,
      then open the page with the tools it returns the same way. If
      `enable__mcp__remote-devices__Claude_Browser` is the only browser tool it finds, call it
      once, then run the same `ToolSearch` again before deciding there is no browser.
   3. Keep the `tabId`: the one `preview_start` returned, or the one you navigated. A skill
      that steers the page later needs it.
   4. **In the same step, call `mcp__ccd_view__show_pane` with `{"pane": "preview"}` when it is
      among your tools.** Without it the page can load into a pane the admin has collapsed, and
      the skill looks like it did nothing.
   5. **No `Claude_Browser` after that: try Claude in Chrome.** Run
      `ToolSearch(query: "select:mcp__Claude_in_Chrome__tabs_context_mcp,mcp__Claude_in_Chrome__tabs_create_mcp,mcp__Claude_in_Chrome__navigate,mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate")`.
      If it finds them, use whichever prefix answered for every call: its `tabs_context_mcp`,
      then its `tabs_create_mcp` for a new tab, then `navigate` that tab to the address. Keep
      that tab's `tabId`. Make one attempt; if it fails, the link is the page. These tool names
      and this order follow `carta-investors`'s `references/gate-in-app-browser.md`; change them
      with it.
3. **Answer in chat as well**, from the read results. The page is there to look at, not
   instead of an answer.

Tell the admin where the page is open. In Claude's browser panel, add that if they don't see
it, Cmd+Shift+B (Ctrl+Shift+B on Windows) shows it. In Claude in Chrome, say it is open in a new
Chrome tab.

## When it doesn't open

- **`Claude_Preview` is a different family.** Its `preview_start` launches a local server from
  `.claude/launch.json` and can't open a Carta address. When `Claude_Preview` is all you have,
  the link is the page.
- **No browser at all** — neither your tools nor either search turns up a `Claude_Browser` or a
  Claude in Chrome tool. Then the link is the
  page; don't tell the admin you looked for a browser.
- **A `login.` address** — ask the admin to sign in to Carta in that panel (or Chrome tab) once.
  The sign-in is kept for later sessions, and the page loads after they sign in. In Claude's
  browser panel, Carta staff sign-in (Okta) isn't allowed: tell a staff tester to sign in with a
  non-staff Carta account.
- **"blocked by your organization's policy" or "site policy check is unavailable"** — don't
  retry. Use the link alone for the rest of the conversation.

## Once it is open

The page refreshes itself, so never reload it to show new data. A skill that moves an open page
to another address does it on the kept `tabId`; in Claude in Chrome, with that family's
`navigate`. Don't read it back to check
it; the admin sees it and it never needs you.

Only `Claude_Browser` and Claude in Chrome tools open the page. Never use Playwright or any
other browser-automation tool: it opens a separate browser the admin isn't looking at.
