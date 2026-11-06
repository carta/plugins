# Valuations Dashboard MCP App

The firm's portfolio valuations dashboard as an MCP App, shown in the side panel beside the chat
rather than linked. It is the same
dashboard as the Carta page: the portfolio overview and companies table, and, inside the view,
each company's valuation history and each valuation's detail. The user moves between those pages
in the view itself.

Read by SKILL.md Step 1, which opens it once the firm is settled. Never surface the view's
internals (prop names, routes, the frame's data) in chat.

## Open it

SKILL.md Step 1 **Open the dashboard MCP App first** gives the call. `organizationId` is the firm's **integer** org_pk from Step 1, the one `list:portfolio_dashboard`
takes. It is the only parameter, and the view always opens on the firm page. The view reads the
portfolio itself, so don't call `list:portfolio_dashboard` first and don't pass companies.

## After it opens

The result gives the model only `companyCount`, the number of portfolio companies the dashboard
lists. A firm's whole portfolio stays inside the view.

- On the user's very next message, call `mcp__claude-device__list_widget_tools()` first, per
  SKILL.md Step 1 **On the very next prompt, call `list_widget_tools` first**. From then on,
  call the app tools below through `mcp__claude-device__call_widget_tool` with the dashboard's
  widget id.
- Don't describe the view back to the user, and don't render the portfolio table in chat unless
  they ask for it (SKILL.md Step 2).
- With `companyCount` 0, print Step 2.1's **Firm has zero portfolio companies** line and stop.
- Don't open it again in the same session to show it again. When the user asks to show the
  dashboard in the side panel, picture-in-picture or back in the chat, call the app tool
  `set_display_mode` that the open view lists, with `mode` `fullscreen`, `pip` or `inline`, and
  report the mode its result names.

## Open a page in it

Open a page in it only when the user directly asks to see it: SKILL.md
**Page navigation → Which page to open** says which. Never move it unasked. Without the
dashboard's widget id, open nothing (SKILL.md **Page navigation → App tools need the widget id**). Call these app tools through `call_widget_tool` with the dashboard's widget
id:

- **A company** — the user asks to see a specific company: call `open_company` with
  `company` set to its `companyId` (`references/deep-link.md` **The ids the MCP App takes**). Use the company's
  name only when `companyId` isn't known yet.
- **A valuation** — the user asks to see a specific valuation, or says yes to the offer to open
  the updated valuation (SKILL.md **Writes**): call `open_company`
  for its company first, then `open_valuation` with `valuation` set to its `valuation_id`.
  `open_valuation` only finds valuations of the company that is open, so make both calls, in
  that order, even when the company might already be open.
- **The portfolio** — whenever the user asks to see their portfolio companies ("show my
  portfolio", "take me to all my companies", "back to the dashboard", or
  going back to the portfolio): call `open_portfolio`, with no
  arguments. Call it even when the portfolio might already be open: the user may have moved
  in the view.

Make the calls silently, before the reply. A result that names several matches or none means
the id or name didn't match: if you passed a name, resolve the company's `companyId` and call
once more. Otherwise, or if a call fails, don't retry and don't mention it. Moving the view
changes nothing in Carta, so these calls never need a refresh.

## Refresh it after a change

The MCP App does not see writes made from the chat, so it keeps showing what it loaded until it
is refreshed. **Always call the app tool `refresh_page` after every change the skill makes in
Carta: every successful `mutate:*`, `create:*` or `delete:*` call, and every `compute:*` run once
its results are back (an allocation run, SKILL.md **After an allocation**, or the Backsolve
calculation)**, through `call_widget_tool` with the dashboard's widget id and no arguments, so
the user never has to refresh it by hand:

```
mcp__claude-device__call_widget_tool({"id": "<dashboard widget id>",
                                      "name": "refresh_page", "args": {}})
```

This holds for every change in every flow, whether or not the flow's own reference file mentions
it: bulk creates and their follow-up value writes, single creates, new versions, deleting a
draft, and any change to a valuation (approaches, weights or company value, financials, comps,
GPC multiples, backsolve inputs and running the Backsolve calculation, equity adjustment,
allocation inputs, allocation runs or DLOM, audit notes, commentary, finalize or moving back to
draft). It runs the open page's Refresh button: an Updating toast, and on the
portfolio page the new valuations highlighted and named in the toast ("1 new draft valuation.").
It refreshes whichever page the user has open in the view, so don't open another page first.

- Call it as soon as each write returns, before the next call, even in the middle of a
  multi-step flow: five writes make five calls, one straight after each. Never wait for the end
  of the flow or the turn, and never cover several writes with one call. A write that failed, a failed allocation
  or Backsolve run, or a Niagara poll that never reaches `SUCCESS` changed nothing and needs no refresh.
- Call it silently, and say nothing about its result: an answer that the page is still loading
  or already refreshing means the page will show the change anyway.
- One call per successful write or finished `compute:*` run. If the call fails, don't retry,
  don't reopen the MCP App and don't mention it.
- **A write made before the session held the widget id** (the turn that opened the dashboard) is
  the one exception to "straight after": once `list_widget_tools` returns the id, make the first
  `call_widget_tool` one `refresh_page` (SKILL.md **Page navigation → App tools need the widget id**). With no widget tools at all, there is
  nothing to refresh.

## When the MCP App cannot be used

- **A terminal client** cannot render the view. `view_remote_next` then returns a line of text
  saying the dashboard is showing — the user sees nothing. Carry on in chat, as SKILL.md Step 1
  says.
- **No `view_remote_next` tool**: the ToolSearch in SKILL.md Step 1 found none. Carry on in
  chat, as SKILL.md Step 1 says. Never fall
  back to `view_remote` for the dashboard: the server refuses it.
- **`view_remote_next` errors, or the view isn't available to this user** (it is rolled out behind a
  feature flag). Don't retry and don't mention the view or the error. Carry on in chat, as
  SKILL.md Step 1 says.

In every case, give no dashboard link in its place (`references/deep-link.md` **Step 2**).
