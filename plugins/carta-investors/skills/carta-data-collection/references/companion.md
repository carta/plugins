# Data collection — the companion page

When and how to open the data collection companion page in Claude's browser pane. The other references point here rather
than repeating it. `references/deep-link.md` owns where every link comes from; this file
owns the one link the skill may add query params to.

**What the page can do depends on the firm.** Whenever `_links.companion` is present, its `send`,
`track` and `review` tabs open; `_links.companion.views`, when present, lists every tab this firm
and user can open. Unless `views` names `schedules` and `contacts`, the page is read-only: every write
happens here in the chat, through the MCP, with the action's own confirmation gate, and you never
tell the user to make a change on the page. When the list also names `schedules` and `contacts`,
the firm has the page's actions on: the user can remind, reopen and edit requests from Track rows,
change schedules on the Schedules tab and contacts on the Contacts tab, and send from the setup
form. The chat still writes only through the MCP with its own gate, and may mention that the page
can do the same — but those page writes go through Carta directly and the chat does not see them.
What the page shows can still move between turns, so the skill's "Read the current state before
answering or confirming" rule (`SKILL.md`, "Applies to every action") applies before every answer
and every confirmation that follows an open.

**The setup form's link comes from its own command.** When
`data_collection__get__request_setup_link` answers `enabled: true`, its `companion_url` opens the
request setup form on this page, and the user edits and sends there;
`references/request-setup-view.md`, "Open it", says which of that file's rules hold for the page.
That link comes from the command, never from `_links.companion.web_url` plus params: the table
below has no `view=setup` on purpose. Open it the same way, in the same companion tab.

## Where the link comes from

The firm settings response from the skill's Step 2 carries `_links.companion.web_url`. Take it as
the MCP returns it and add only the query params below — never another host, path or param. The
firm settings description names these params; it is the authority if the two ever disagree.

| Param | Value |
|---|---|
| `view` | The tab that opens: `send`, `track` or `review` whenever `_links.companion` is present; `schedules` or `contacts` only when `_links.companion.views` names them. Never another tab |
| `period` | A period label such as `Q3 2026`, URL-encoded: `Q3%202026` |
| `status` | Request statuses, comma-separated: `overdue`, or `overdue,requested` |
| `entity_type` | One company's `entity_type`. Always sent with `entity_id` |
| `entity_id` | That company's `entity_id`. Always sent with `entity_type` |
| `group` | How the Track tab groups its rows: `none`, `company`, `period`, `data_type` or `due_date` |
| `q` | A company name search, URL-encoded. Never `search` |

Join them with `&`, after `?` — or after `&` when `web_url` already carries a `?`.

`entity_type` and `entity_id` go together or not at all: one without the other does not pick a
company. Take both from the same row — the roster or the request — never from memory.

**The id stays in the link.** An `entity_id` in the query string is the only place this skill
lets one appear. Give the link a plain anchor — *Open Meetly in the companion* — and never print
the URL's query string, or the id, in the prose around it.

## When to open it

| After this | Open | Example |
|---|---|---|
| The text-path summary before a send (`references/send-request.md` Step 5, `references/roll-forward.md` Step 4) | Send tab, for the period being sent | `view=send&period=Q3%202026` |
| `data_collection__send__request` succeeds, or the user says they sent requests from the form | Track tab, for the period sent | `view=track&period=Q3%202026` |
| `data_collection__send__reminder` succeeds for the past-due companies | Track tab, for the period chased, filtered to what was chased | `view=track&period=Q3%202026&status=overdue` |
| `data_collection__send__reminder` succeeds for past-due and not-yet-due companies | Track tab, for the period chased, both statuses | `view=track&period=Q3%202026&status=overdue,requested` |
| A status read for a period — which requests went out, where they stand, who has not responded (`references/status-and-overdue.md` Steps 1 to 3) | Track tab, for that period | `view=track&period=Q3%202026` |
| A status read for who is overdue | Track tab, for the overdue requests' period, filtered to overdue | `view=track&period=Q3%202026&status=overdue` |
| `data_collection__mutate__reopen_request` succeeds | Track tab, for that company and the request's period | `view=track&period=Q3%202026&entity_type=CORPORATION&entity_id=<entity_id>` |
| `data_collection__update__request` succeeds | Track tab, for that company and the request's period | `view=track&period=Q3%202026&entity_type=CORPORATION&entity_id=<entity_id>` |
| A period comparison (`references/period-comparison.md`), whether or not `data_collection__list__period_comparison` answered — the page reads Carta directly | Review tab, for the quarter | `view=review&period=Q3%202026` |
| The same, for one company | Review tab, for the quarter and that company | `view=review&period=Q3%202026&entity_type=CORPORATION&entity_id=<entity_id>` |
| A schedule is created, changed or stopped (`references/recurring-schedule.md`, `references/edit-requests.md` part B), when `views` names `schedules` | Schedules tab | `view=schedules` |
| Contacts change (`references/contacts.md` Step 4), when `views` names `contacts` | Contacts tab | `view=contacts` |

`CORPORATION` in the examples stands for the company's own `entity_type`; a fund-admin company is
`FA_ISSUER`.

**Every Track tab URL carries `period` when the requests have a known period.** Without
`period`, the Track tab lists only requests from the firm's previous period onward, on the firm's
own cadence — a monthly firm sees last month and later, so its Q3 2026 requests are not there and
the tab reads "No requests yet". A `status` filter does not widen that window. So add
`period=<label>` for the period of the requests the reply is about — sent, chased, reopened,
updated or listed — alongside any `status`, entity or other filter. When those requests span
several periods, use the most recent of them, and say in one line that the Track tab shows that
period and the chat lists the others.

At each of these moments, open the built URL in Claude's browser pane yourself — see "Opening
it" below. Do not ask first and do not offer it as a choice.

**Before a send, the Send tab shows what each company will be asked for.** Open it with the
summary, before `Send this?`, so the user can check the per-company requirements before anything
goes out. It is not the confirmation: the user still answers the summary's question here. The
setup form (`references/request-setup-view.md`) sends from inside itself and already shows the
requirements, so it takes no Send tab.

**After a request write (a send, a reminder, a reopen or a request update), the Track tab shows the result.** Open
it with the report, once; its link replaces the sent-requests link. When a reminder batch or a send partly failed, still open it, after
saying which companies the write reached.

**After a status read, the Track tab shows the same requests.** Open it with the status tables,
once, filtered to match the question: the period of the requests listed, as the rule above sets
it, and a `status` only when the question is about exactly one status the firm settings
description names — "who is overdue".
"Who has not responded" spans several statuses, as `references/status-and-overdue.md` Step 2
defines, so it takes the period alone. Its
link replaces the sent-requests link here too.

## Opening it

Before replying, open the companion URL yourself; do not ask the user whether to. `preview_start`
and `navigate` are not pre-approved, so the host may still ask the user to approve opening or
moving a tab; a declined approval counts as a failed call. **The companion tab** is any tab on the
companion URL's path, whatever its query string. If a companion tab already shows this exact URL,
there is nothing to open. If one shows another tab or filter, move it to the new URL, so the pane
always ends on the URL just built, in one companion tab. Never navigate a tab that shows anything
else: it is the user's own page.

1. **Claude's browser pane.** Run `ToolSearch` with
   `select:mcp__remote-devices__Claude_Browser__preview_start,mcp__remote-devices__Claude_Browser__navigate,mcp__remote-devices__Claude_Browser__tabs_context,mcp__Claude_Browser__preview_start,mcp__Claude_Browser__navigate,mcp__Claude_Browser__tabs_context,mcp__ccd_view__show_pane,enable__mcp__remote-devices__Claude_Browser`
   to load the tools. If `enable__mcp__remote-devices__Claude_Browser` is the only one found, call
   it once and search again. Then call `tabs_context`. When there is a companion tab, `navigate` it
   to the new URL; otherwise call `preview_start` with the companion URL. In the same step, call
   `mcp__ccd_view__show_pane` with pane `preview` when it is available, so the pane is visible.
   This is the plugin's in-app browser detection (`${CLAUDE_PLUGIN_ROOT}/references/gate-in-app-browser.md`,
   the plugin's own `references/`) narrowed on purpose: the Claude in Chrome tools are left out,
   so a user with only Chrome connected gets the link alone, and `preview_start` and `navigate`
   are not pre-approved.
2. **The link alone**, when the pane did not open the page — its tools are missing, a call failed,
   or the page is blocked by policy. Do not say you looked for a browser.

Load the tools once per session; later opens reuse them.

## When the companion link is absent

A server that does not return `_links.companion` has no companion page to open. Then:

- After a request write (a send, a reminder, a reopen or a request update), offer the sent-requests link per
  `references/deep-link.md`.
- After a status read, offer the sent-requests link per `references/deep-link.md`, once, after
  the tables.
- Before a send, offer nothing in its place — the summary table already shows the request.
- After a schedule write, offer the recurring-requests link per `references/deep-link.md`. The
  same holds when the companion link is present but `views` does not name `schedules`.
- After a contacts change, offer nothing; the same holds when `views` does not name `contacts`.
- After a period comparison, give the summary alone — or, when `references/period-comparison.md`
  Step 2 found the comparison unavailable, only the sentence that Step 2 gives.

## The link in the reply

Whether or not the pane opened, also print the link in the reply, with its plain anchor, after
the data, so a user without the pane can click it.

When Claude's browser pane opened the page, add one short line after the link: *"If the pane shows
a Carta sign-in, sign in once there; the page then stays signed in."* When the pane opened the
page after a period comparison that `references/period-comparison.md` Step 2 found unavailable,
also say the Review tab beside the chat shows the comparison. A sign-in is never a reason to skip
the open.
