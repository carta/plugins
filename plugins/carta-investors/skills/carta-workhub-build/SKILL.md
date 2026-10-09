---
name: carta-workhub-build
description: >
  Builds or rebuilds the Carta Workhub live artifact — a standalone Cowork view of the work
  a firm shares with its Carta fund admin team. Shows a request composer over the GP tasks it
  has a panel for, in tabs for Drafts, Needs Action (waiting on you), With Carta and Completed,
  grouped by category — requests, capital calls and distributions, financial reporting — with a
  thread view for each request, the capital call review and the reporting tracker. The artifact auto-detects the active firm
  from the Carta MCP context — no hardcoded firm name needed. Use this skill whenever the
  user asks to "build the carta workhub artifact", "rebuild carta workhub", "set up carta
  workhub", "deploy carta workhub", "show my Carta workhub", "rebuild carta tasks",
  "show my Carta task board", or "pin my Carta requests".
model: sonnet
allowed-tools:
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-workhub-build/scripts/build_artifact.py" *)
  - Artifact
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.70.7</carta-plugin>

# Carta Workhub — Build / Redeploy

Deploys the `carta-workhub` Cowork live artifact. It is **assembled** from source parts in
this skill's `resources/` directory by `scripts/build_artifact.py`, which also substitutes
this session's Carta MCP server ID. You never need to read the assembled HTML.

Carta Workhub is the work surface: a live queue belongs on something you pin and keep open,
not inside a fund-data dashboard.

## What the artifact does

- **Composer** — "Ask Carta to do something" opens a box with preset tiles from
  `resources/carta-workhub.config.js`; clicking one drops a labelled template into the textarea. Templates, not filled examples:
  the blanks tell the sender what the team needs, and a prefilled amount invites sending
  someone else's numbers.
  The tiles mirror the app's Quick actions grid but carry no "Ask my Carta fund admin team
  to…" preamble: that phrasing exists to route the chat picker, and here the text goes
  straight to the team, so it would only be noise in what they read.
  Then a second **Review summary**
  step shows the draft verbatim before anything reaches `fa:create:fund-admin-message`. Send lives
  only on that second step; **Back to edit** returns the text rather than an empty box.
- **Beta badge** — on the page title. The subtitle is the only body copy above the composer.
- **Open items** — review infers the request type from `detect` in
  `resources/carta-workhub.config.js` and checks each `requires` entry against the request, with
  label-only template lines stripped so a blank template reads as unspecified. Anything unmet is
  named in one line, with a single open box to add it. Nothing is forced: the box folds into the
  request on send, and sending with it empty is fine. This is pattern matching, not inference —
  the artifact has no model, so requirements are declared per preset. An unrecognised request
  gets no checklist rather than a wrong one.

  **A `requires` regex must match what a sender writes, not what the template says.** The
  capital-call check looked for `lps|investors|partners|class`, which the template's own
  "Split by LP class" line satisfied — so a request that named its call type instead
  ("Call Type: Pro-rata") was told it was missing information it had already given. That
  requirement is now `Call type`, matching the four types Carta acts on: pro-rata, subsequent
  close, bring investors in-line, hybrid. Change a template line and its `requires` entry
  together, or the check drifts back into testing for the old wording.
- **Draft** — **Save as draft** holds a request without sending it. Drafts show in the
  **Drafts** tab, dashed, with **Review and send** or **Discard**. Sending a draft runs the same
  confirm step, and the draft is dropped only once the send succeeds. Carta has no unsent-draft
  state, so a draft lives in `localStorage` and nowhere else, and does not follow the user to
  another machine. Storage also throws on an opaque origin (an artifact served from a `data:`
  URL), so a probe at first use decides which of two truths every surface tells — saved on this
  computer, or kept for this session only. The composer states the scope **before** Save as
  draft is pressed, and the Drafts tab's description repeats it where drafts are listed. A
  durable, cross-device draft needs a server-side command that does not exist yet: carta-mcp#1.
  (The code calls these plans: `FAR_PLANS_KEY`, `farSavePlan`.)
- **Sent state** — a confirmation panel: "Your Carta team is on it", the notification promise, and
  a line telling the sender they can reply or add detail in the thread while work is underway.
  It deliberately does **not** show the workflow id — that is Carta's internal handle, and quoting
  it at the sender implies it is how they follow up, when the thread is.
- **Request type** — `fa:create:fund-admin-message` has no type field and the backend stamps
  `request_type: 'other'`, so a sent request would lose its category. The type is carried two
  ways: as the message's **first line**, which is durable server-side and is the first thing the
  team reads, and cached in `localStorage` against the workflow id. Otherwise the title is the
  row's name, which fund-admin builds from the subject line or the message's first line; a row
  still carrying a generic name (`FAR_GENERIC_TITLES`) reads its opening message instead
  (bounded to `FAR_HYDRATE_MAX`).

  **The backend wraps message bodies.** `content_text` comes back as `"        Additional Info:\n        <indented body>"`. That preamble is
  Carta's own formatting, so `farUnwrap` strips it and the indent everywhere text is read or
  shown — without it every title read as "Additional Info:" and the thread showed the wrapper
  to the customer.
- **Queue** — four tabs, each a row group: **Drafts** (`planned`), **Needs Action** (`todo`,
  waiting on the customer), **With Carta** (`progress`) and **Completed** (`done`). The first
  load opens on Needs Action, or on the next tab holding work when it is empty
  (`FAR_TAB_OPEN_ORDER`); after that only the viewer changes tabs. Each tab carries a count
  pill and a one-line description. The queue holds the workflows Workhub has a panel for, plus expense
  payments, management fee reviews, cash reconciliation and SOI reviews, listed in `TASK_TEMPLATES_WITH_TILES` in
  `resources/carta-workhub.config.js`: requests (`request-generic`), capital activities (`request-capital-activity`), financial packages
  (`publish-financial-package`), expense payments (`prepare-and-pay-expense`), management fee
  reviews (`review-management-fees`), cash reconciliation (`cash-reconciliation`, one workflow per bank
  transaction) and SOI reviews (`review-soi-v2`). No panel opens the last four, so each is a Carta link under
  Expense payments, Management fees, Cash reconciliation or SOI review, unless its needs-action task opens an MCP App (see Task MCP Apps). Every other GP task would only link out to Carta, so it is left out; add a template to that list once a panel opens its tasks. Completed reads the same list,
  so finished work never shows a kind of task the open tabs leave out. Every task of a listed workflow
  shows, including the ones no panel opens (a capital call With Carta or Completed), as a
  Carta link. Inside a tab, rows are grouped by category, in the order and with the icons `TASK_CATEGORIES` in
  `resources/carta-workhub.config.js` gives; a row joins the category listing its
  `workflow_template`, and a listed template no category lists lands in **Other**. A capital activity is a call or a distribution only by its name —
  fund-admin titles the task "Review capital call for…" or "Authorize distribution of…" from
  the activity type — so `named` on Distributions decides there. Filter chips under the
  description (All, then each category present, with counts) narrow the tab to one category;
  each tab keeps its own. A category previews 5 items, then **Show N more**.

  Sorted **Newest** or **Oldest** first, by when the work started, or for Completed by when it
  finished. There is deliberately no sort-by-status or category: the queue is partitioned by
  both, so it would be a no-op. Cards in a category that share a calendar day show the time as
  well, or a re-sort looks like nothing happened. The card/list toggle swaps the grid for one
  row per item.

  A card is the task's name (fund-admin's `display_name`; a request keeps its own title rules,
  above), the row's `entity_name` (omitted when blank — `fa:create:fund-admin-message` has no
  entity field, see `docs/plans/carta-workhub-entity-uuid.md`), and a date line: **As of**
  in Needs Action, **Started** in With Carta, **Completed** or **Canceled** in Completed,
  **Drafted** in Drafts. What it opens, in order: the capital call review panel, the
  reporting tracker, the request's thread, else the row's `_links.web_url` in a new tab,
  marked **Carta ↗** — an absolute http(s) link only. A task with none of these is shown but
  opens nothing. No assignee shows: neither list carries one yet.

  The page is light only, as the Workhub design is: `:root` sets `color-scheme: light`, so
  every `light-dark()` token resolves to its light value.

  **Two cursor-paged lists feed the queue**, read in parallel at 40 rows a page so no reply
  nears carta-mcp's 40k cap. On first load Needs Action also has its own read
  (`pending_actor: customer`), so it paints first; the other tabs count `…` until the lists land:
  - `fa:list:gp-workhub-active-task` — every open task, kept when its `workflow_template` is in
    `TASK_TEMPLATES_WITH_TILES` (the command takes no template filter), grouped by `pending_actor` (`customer`
    → Needs Action, `carta` → With Carta), one card per workflow; the customer's task wins. A
    capital call review opens its panel only when `discover` answers for
    `fa:get:capital-activity-review-summary` — the panel's commands need
    `CARTA_MCP_CAPITAL_ACTIVITY_REVIEW`, which the list ignores — and is otherwise a Capital
    calls card linking to the review in Carta. A failed page, or pages left past 25, drops to
    the `localStorage` path rather than show a short list as complete. A task's `created_at`
    is the current task's, so the start date of a request or capital activity comes from
    `fa:list:firm-workflow` (`active`, those two templates), read alongside; other tasks use
    their own.
  - `fa:list:firm-workflow` (`TASK_TEMPLATES_WITH_TILES`, `complete`/`canceled`) — Completed, the last 90
    days by `completed_date` (else `last_activity_at`), newest 3 pages only, keeping what was
    read; its count reads `120+` at that cap, and a plain `0` when nothing read is recent. The
    list is ordered by `created_at`, so it can miss old work finished recently. A failure
    leaves it empty. A workflow in both lists shows once, as open.
- **Capital call review** — a `request-capital-activity` workflow carrying an open
  `review-capital-activity` (or `review-capital-activity-changes`) task opens the review panel
  instead of the thread. It is one page: a sidebar with the summary (the total, the notice and due
  dates, any adjustments, and for a distribution what it can pay out) and the payment accounts,
  beside the preparer's note and the **Allocations**, **Notice** and **Delivery** tabs, and **Wires** for an
  activity that pays out. The Notice
  tab shows the notice each investor receives, as the real PDF and as the rendered email. The footer carries **Request
  changes**, which opens a modal and keeps an unsent request as a draft on this computer, and
  **Approve and release**, behind its own confirm step. Read from `fa:get:capital-activity-review-summary`,
  `fa:list:capital-activity-review-row` (its rows carry each group's `wire_status` for the Wires
  tab), `fa:get:capital-activity-partner-email-preview` and
  `fa:get:capital-activity-notice-pdf-preview`; written with `fa:mutate:request-capital-activity-changes`
  and `fa:mutate:approve-capital-activity`. All of them ride the `fetch` and `mutate` tools
  already in the grant, so adding a command never changes the publish call.

  There is no build flag for this: the server decides which rows exist, so no review card
  means the environment does not serve them. `--ccr-fund-uuid` / `--ccr-activity-id` seed one
  card for a demo, and its panel still reads through the same commands. The seed card replaces
  that activity's live review card.

  **The summary's embedded rows are the table's first paint.** `rows.results` on the summary is
  the unfiltered first page; seeding from it means the table is populated the moment the summary
  lands, instead of reporting zero investors until the row walk returns. The walk then replaces
  the seed wholesale rather than emptying it first. A count that is not yet known reads `Totals`,
  never `0`.

  **Allocations reads buckets from `bucket_totals`, never from rows.** The summary's
  `bucket_totals` is the complete column set, in served order; a row's `amount_buckets` lists only
  the buckets that move money for that interest, so a bucket absent from a row is a zero cell and
  the column set must never be derived from rows. The summary view is Investor / Commitment /
  Net contribution / Called after; when more than one non-adjustment bucket or any adjustment
  composes the net, **Show breakdown** adds one column per bucket,
  adjustments last and signed by `impact_on_owed` (decrease reads as a reduction), with Investor
  and Partner class pinned left and Net contribution / Called after pinned right while the rest
  scrolls; the sidebar steps aside while the breakdown is open. Header
  labels are the full `display_name`, balanced over at most two lines and never abbreviated. Nothing reads `inside_commitment`: the post-call figures
  are served already computed. Totals come from `bucket_totals` and the summary, never by summing
  a page. The Participating and Non-participating counts above the table switch which investors it
  lists. When the row walk stops short the table says "Only N of M participating investors
  loaded", and after a
  complete walk a bucket whose total no loaded row carries is called out under the table rather
  than shown as a column of dashes. The review panel is `min(1160px, 96vw)` by `min(780px, 92vh)`.

  **The email preview follows `carta-home`'s `renderEmailPreview`** — the same command, the same
  envelope-plus-scriptless-iframe shape, the same `[/LINK_CARTA]` caveat. Recipients key on
  `addr_type` (`TO` / `CC` / `BCC`), not `type`. Keep the two behaviourally identical.

  **The Notice tab shows the real PDF, painted by a renderer the artifact carries.** Read with
  `fa:get:capital-activity-notice-pdf-preview`, which returns the document as a base64 `data:`
  URI; pdf.js, vendored under `resources/vendor/`, paints it to canvas. The notice is never
  redrawn from figures — a replica of a document drifts from the document.

  Three measured facts hold that shape in place, and none of them is obvious:

  - **The browser's own viewer is blocked here.** `<object>`, `<iframe src="data:">` and
    `<embed src="blob:">` were each tried against real PDF bytes inside a published artifact and
    all three render nothing. A renderer in the page is the only way, so the vendored bundle is
    load-bearing rather than a convenience.
  - **The bytes have to be in the response.** The CSP blocks every external host, so neither the
    authenticated Carta link nor a presigned S3 URL loads, and the page cannot redeem a document
    token either.
  - **A binary blob would not survive the trip.** Every Anthropic-managed surface rejects a blob
    content block, so the command returns a `data:` URI instead.

  **Each render costs.** Carta renders the document through Prince or Carbone on every call and
  stores it, so the panel fetches only the visible tab and only for the investor on screen —
  never a walk down the picker. A measured notice is 2 pages and ~45 KB. Each render is then
  kept in memory for the page's life, keyed by activity and investor, so returning to an
  investor costs nothing; a request for changes or a release clears that activity's renders.

  **The activity link is read off the task row**: `fund_uuid` plus `object_id` (the activity's
  ShortUUID); no fund, no panel. **Open in Carta** uses the task's `_links.web_url` until the
  summary serves its own.

  A release is followed to its verdict, which can take minutes. With no reply after 4 seconds the
  panel shows it in progress and its card moves to With Carta. A connector that stops waiting is
  not a failure: the panel re-reads `fa:list:gp-workhub-active-task` every 15 seconds, and a card gone from it
  has released, because release closes the review task in the same transaction. Reopening the card
  meanwhile shows the release, not the review. With no verdict after 11 minutes the panel locks
  both decisions and sends the reviewer to Carta rather than inviting a second press. A refusal
  (a failing blocking health check) stays written above Approve.

  A 400 or 403 from any review read or write — in an error envelope, a thrown error, or a reply
  carrying the error in its payload — raises a toast inside the panel until it is dismissed.
- **Financial reporting tracker** — a package task opens the Financial Reporting Tracker for its
  period: the banner, the multi-select entity filter (a
  fund family's box selects every member), the combined filter-and-sort menu, entity search,
  the period selector, and the six-column table with fund families **and any
  entity holding two or more packages** as collapsible rows. A row with two or more packages
  beneath it reads a status ("Awaiting your review", "Ready to publish", or the ordinary cell
  text) instead of a button, tagged "N packages" under its name; each package is a child row of
  its own with its own button. A fund-family member the combined package covers reads "In
  combined package"; one publishing packages of its own reads and owes them, nested a level
  deeper when it holds two or more. Every label, dot and package name is produced straight from
  `fa:get:reporting-status` — `display_label` and the family's own rollup read are both computed
  server-side now — so the panel and the page read identically. Every button carries the
  backend's absolute `href` and opens Carta in a new tab, unless its task has an MCP App (below);
  nothing is written from here.

  **The package tasks are the way in.** Every `publish-financial-package` task on the queue's
  task list, open or finished, is a card under Financial reporting, and it always opens the
  tracker, never Carta. The period is the one its title ends in — fund-admin writes "Review
  financials for Q2 2026", or a bare year ("…for 2025") for the year end, which the tracker
  reads as Q4-YE. A title that ends some other way ("Reviewing your 2024 financials", Carta's
  own step) opens the current period. `review-financial-extraction-*` tasks sit under Other.

  There is no build flag for this either: the read is gated server-side by
  `CARTA_MCP_FINANCIAL_REPORTING_TRACKER`. The card does not probe it, so a viewer it refuses
  sees the panel's own error rather than a Carta link. `--frt-seed-period "Q2 2026"` forces one
  period card for a demo, read live, and it is the only read the queue makes up front.

  **The panel is sized for its table** — `min(1120px, 96vw)` by `min(760px, 90vh)` —
  because six table columns need it; below about 900px the table scrolls inside the panel, never
  the page. The read returns the whole firm with no paging, so a firm past roughly 80 entities
  would exceed carta-mcp's 40k reply cap and the period would read as failed; a firm with many
  multi-package entities hits it sooner, since every package adds its own share of the reply.
  That is accepted for now.

  **Task MCP Apps open in a new chat.** A needs-action tracker button whose task has a Carta MCP
  App (today, cash reconciliation, on the entity's own fund) opens a **new Claude Desktop chat**
  instead of Carta, prefilled with a prompt that names the app, the entity, the firm and the
  exact `view_remote` call; the GP sends it and Claude renders the app there. An artifact cannot
  post into a chat or render an app itself, so the app never runs inside the Workhub.
  `openClaudeChat` in `carta-workhub.app.js` opens `claude://claude.ai/new?q=<prompt>` and also
  tries to put the prompt on the clipboard, for when the link handler does not fire; the toast
  says whether the copy worked. A small ↗ beside
  the button keeps the cell's Carta link.

  carta-mcp decides which cells: the tracker asks `discover` about `fa:list:workhub-task-app`
  once, and only when that answers reads, through `fetch`, the tracker columns with an app, each
  with its view and the entity field that fills each view param. The read is gated server-side,
  and each entry by its view's own gate, so a viewer it refuses keeps every Carta link. A new app
  is one entry in carta-mcp's registry, not a change here, and needs nothing new in the publish
  grant: `view_remote` is called by Claude in the chat, never by the artifact.

  **Queue cards open apps the same way.** A needs-action management fee review
  (`review-management-fees`, `fa:view:gp_management_fee_review` by `fund_uuid` and the task's
  `object_id`) or expense approval (`prepare-and-pay-expense`, `fa:view:expense_payment_review`
  by `object_id`) opens a new chat instead of Carta. So does a cash reconciliation task
  (`cash-reconciliation`, `fa:view:gp_cash_reconciliation`), which passes only the task's
  `fund_uuid`: the view lists a fund's transactions, so the app opens filtered to the fund
  that was clicked rather than on every fund. An SOI review (`review-soi-v2`,
  `fa:view:update_investments`) passes only `fund_uuid` too: the view opens the fund's open
  review, its period and task from that. Its boot data and commands sit behind a flag the
  view's own does not cover, so its `TASK_APPS` entry names `requires:
  'fa:list:firm-asset-group'`, which `farTaskAppViews` checks with `mcpCommandAvailable`; a
  viewer without it keeps the Carta link rather than opening a chat that answers "not
  enabled". `TASK_APPS` in
  `resources/carta-workhub.config.js` lists them, each with the task row field that fills each view
  param, and `farTaskAppFor` builds the prompt target with the tracker's `frtAppPrompt`. The task
  list is not gated by the views' flags, so `mcpViewAvailable` asks
  `discover(scope="view")` per view, and a viewer it refuses keeps the card's Carta link. A card
  with the app has no Carta link of its own, and is marked **Claude ↗**.
- **Thread view** — the full conversation from `fa:list:workflow-message`, with a reply box
  writing to `fa:create:workflow-message`. Carta's internal agent output is never surfaced.

  Bodies render as **paragraphs**, taken from `content_html` — `content_text` is the same
  message flattened, and preferring it threw away the structure the author wrote. Tags are
  stripped either way, so nothing from the payload is ever inserted as HTML.

  The opening message is a filled template, so it renders as a **field grid**: `Label: value`
  lines become rows, a label with no value is dropped, and text before the first field is kept
  unless the panel heading already says it.

  **Attribution is positional, not read from the payload.** Every message comes back
  `author: {is_staff: true}` — Carta's replies included — so `is_staff` labels everything
  "Carta", and matching `author.id` to the signed-in user would label Carta's reply "You".
  Index 0 is the request that opened the thread; a reply sent in this session is appended with
  `isStaff: false`. Known gap: a reply sent in an *earlier* session shows as Carta.
- **Firm auto-detection** — `list_contexts` resolves the active firm; `set_context` pins it only
  when Carta has another firm active.
  The firm name shows under the page title. `list_contexts` answers `firm_name: "Unknown"` for
  some firms, so that literal is treated as no answer. First real name set holds; a later blank
  cannot clear it.

A card links out only when its row carries `_links.web_url` (set only when `url` is).

## Listing sources, in order

1. `fa:list:fund-admin-message` — the customer-facing list. **Not built yet in carta-mcp.**
2. `fa:list:gp-workhub-active-task` plus `fa:list:firm-workflow` — see Queue.
3. Workflow ids this artifact recorded in `localStorage`.

1 and 2 are read together, so 1 answering nothing costs no extra wait.

Path 3 cannot see requests raised by email or phone, so the UI says so rather than implying
the list is complete.

## MCP tools required inside the artifact

The artifact resolves the bridge once with `await claude.use("mcp")`, then calls
`mcp.callTool(CARTA_MCP_SERVER, "<tool>", args)`. `CARTA_MCP_SERVER` is the Carta
connector's **display name** — the `{{CARTA_MCP_SERVER}}` placeholder the build script
fills in. The runtime addresses connectors by display name only, never by a UUID.

Every tool below must appear in the publish call's `capabilities.mcp` grant, or the call
rejects with `not_in_manifest`:

- `list_contexts` / `set_context` — resolve and pin the firm
- `fetch` — the list and thread reads
- `mutate` — sending a request, replying, uploading an attachment, and the review decision
- `welcome` — re-initializes an expired MCP session
- `discover` — asks whether this viewer may attach files at all
- `get_current_user` — whose messages are whose in a thread

`fa:create:document-content` is staff-gated, so the composer probes `discover` and
stays text-only when the viewer may not attach. Publish without `discover` and every
viewer looks un-entitled, staff included.

Thread attribution compares each message's author against the viewer's own id, since
a staff sender's messages carry `is_staff` true exactly as Carta's do. Without
`get_current_user` it falls back to position, which labels a staff viewer's own
replies "Carta".

`callTool` **rejects** on tool failure rather than resolving with `isError`. The queue and
thread readers degrade one section while the rest of the page renders, so `_mcp` maps the
`tool_error` code back to an `isError` envelope and rethrows everything else — connector
codes (`needs_reauth`, `server_not_connected`) are page-level, not per-section.

## Source layout — the artifact is BUILT, not hand-edited

**Do NOT read or edit the assembled HTML.** Edit the small source file for what you change.

| File | What it holds |
|------|---------------|
| `resources/app/fund-admin-requests.js` | composer, queue, thread overlay — the whole feature |
| `resources/app/capital-call-review.js` | the capital call review panel |
| `resources/app/financial-reporting-tracker.js` | the Financial Reporting Tracker cards and panel |
| `resources/carta-workhub.app.js` | shared helpers (`_mcp`, `escHtml`, `showToast`, `trackWorkhub`, `openClaudeChat`) plus firm resolution and boot |
| `resources/app/version-check.js` | update banner: reads the published version, compares, renders |
| `resources/carta-workhub.config.js` | `TASK_PRESETS` — the composer's preset tiles |
| `resources/carta-workhub.css` | styles (Ink tokens) |
| `resources/carta-workhub.template.html` | HTML skeleton + injection markers |
| `resources/carta-workhub.tracker.js` | inlined `@carta/mcp-ui-tracker` browser bundle |
| `resources/vendor/` | pdf.js, vendored — pinned to the last UMD release for a reason its README gives |
| `scripts/artifact_parts.json` | the part order and template markers, shared by `build_artifact.py` and the hosted Worker |
| `app/` | the hosted micro-app: a Cloudflare Worker serving these same `resources/` at `workhub.<label>.carta.cloud` — see `app/DEPLOY.md` |
| `../../.claude-plugin/skill-versions.json` | this skill's `version` + release `headline` |

The hosted micro-app runs `resources/` unchanged, so every change here ships to both surfaces.
It reaches Carta only through the commands in `app/server/commands.json`; a new command needs
an entry there, which `tests/js/carta-workhub-hosted-drift.test.js` enforces.

`carta-workhub.app.js` duplicates a handful of helpers from `carta-home.app.js` on purpose:
the two artifacts ship independently, so neither may import from the other. Keep them
behaviourally identical.

## Versioning

Same contract as `carta-home-build`, keyed to `carta-workhub-build` in
`plugins/carta-investors/.claude-plugin/skill-versions.json`. A deployed artifact is a frozen
copy, so **change anything under `resources/`, bump the entry in the same PR** — CI enforces it
via `.forgejo/scripts/validate-artifact-version-bump.py`.

In short, for anyone outside Carta reading this: any change under `resources/` needs the
`version` in `skill-versions.json` raised in the same change, or users keep the old build with no
notice.

Patch is the default and raises no banner. Minor and major interrupt every user, so they
demand a fresh headline written for the person reading it. This skill's frontmatter carries no
`version:` on purpose: a second copy drifts silently.

## Analytics

New interactive elements call `trackWorkhub(action, elementId)` at the top of the handler, with
ids as `CartaWorkhub.<Area>.<Specific>` (e.g. `CartaWorkhub.Compose.Send`). Skip sort clicks,
keystrokes, and dropdown changes.

## Deploy steps

### Step 0: Preflight

This is a live artifact — the published page calls Carta at runtime via
`claude.use("mcp")`, so it needs both the `Artifact` tool and a Carta connector in the
session. Check both before building; a page published without them renders an empty queue
for every viewer.

**Gate A — the `Artifact` tool is available.** If it is not, stop: there is nothing to
publish to.

**Gate B — resolve the connector's display name.** claude.ai connectors appear as
`mcp__claude_ai_<connector>__<tool>`. Find the one exposing `list_contexts` / `fetch` and
store its **display name** as `CARTA_MCP_SERVER`. Do not substitute a UUID or a prefixed
tool name — the runtime addresses connectors by display name and rejects anything else.
Display names legitimately contain spaces and parentheses, e.g. `Carta (Preproduction)`,
so quote the value everywhere it is passed.

### Step 1: Build

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-workhub-build/scripts/build_artifact.py" --mcp-server "<CARTA_MCP_SERVER>" --out "<CWD>/carta-workhub.html"
```

Add `--ccr-fund-uuid <fund_uuid> --ccr-activity-id <capital_activity_id>` to seed one capital call
review card, or `--frt-seed-period "Q2 2026"` to seed one Financial Reporting Tracker card. Both
are for testing a panel before the queue would show its card; a normal build omits them.

Bash reaches `${CLAUDE_PLUGIN_ROOT}/skills/carta-workhub-build` on Claude Code and Cowork; do not search
for it first. Run each command on one line, exactly as written: `allowed-tools` matches the
command text, so a shell variable, a different path, or a line break makes the call ask for
approval. Only if `uv run` reports that the file does not exist, find the script once (this
call asks for approval) and run it from the path it prints:

```
find /sessions "$HOME" -type f -path '*/carta-workhub-build/scripts/build_artifact.py' 2>/dev/null
```

The script prints the output path, version, and build id. It exits non-zero on any unresolved
marker or a missing registry entry.

### Step 2: Find an already-published Carta Workhub

```
Artifact({action: "list", scope: "mine"})
```

Look for an artifact titled **Carta Workhub**. If one is there, keep its `url` — Step 3 passes
it so the page redeploys in place instead of claiming a second URL. If there is none, omit
`url`.

### Step 3: Publish

One call either way. `action` defaults to `"publish"`, so it is omitted below; `url` is the
only difference between a first publish and a redeploy.

```
Artifact({
  file_path: "<CWD>/carta-workhub.html",
  url: "<url from Step 2 — omit entirely on a first publish>",
  title: "Carta Workhub",
  description: "Work you have sent your Carta fund admin team, and what needs you.",
  favicon: "🗂️",
  label: "Redeployed from skill bundle",
  capabilities: {
    mcp: {
      servers: [
        {
          server: "<CARTA_MCP_SERVER>",
          tools: ["list_contexts", "set_context", "fetch", "mutate", "welcome", "discover",
                  "get_current_user"]
        }
      ]
    }
  }
})
```

> Anything the page calls that is missing from `tools` rejects with `not_in_manifest`.
> `mutate` is what Send and Reply use, so leaving it out breaks both while the queue still
> renders. Restate the whole `capabilities` object on every redeploy: a non-empty object
> replaces the stored grant, so a tool you leave out is revoked. Keep `favicon` and `title`
> stable — users find the tab by its icon.

### Step 4: Confirm

Give the user the artifact's URL.

> Carta Workhub is live. Anything waiting on you shows under **Needs Action**.

The first open asks the viewer to consent to the Carta connector; until they accept, the
queue shows its no-connector state.

## If something fails

- **The queue reports `not_in_manifest`** — the publish call carried an incomplete
  `capabilities.mcp` grant. Compare it against the `tools` list in Step 3 and republish with
  every entry, passing the same `url`.
- **No Attach files control, even for staff** — most often `discover` missing from the
  grant, which reads exactly like being un-entitled. The console says which:
  `[far attach] availability probe failed` is the manifest, `not available to this viewer`
  is the staff gate on `fa:create:document-content`.
- **Everything reports `server_not_connected` or `needs_reauth`** — the viewer has no
  callable Carta connector under the name baked in at publish time, or their credentials
  lapsed. Ask them to add or reconnect Carta in Settings → Connectors. If their connector's
  display name differs from the one Step 0 resolved, republish with the right name.
- **Publishing with a `url` is refused** — that artifact was shared with the user rather
  than owned by them. Drop `url` and publish fresh.

## Known gap

Snowplow UI events do not fire. `resources/carta-workhub.tracker.js` is a build artifact of
`@carta/mcp-ui-tracker` and probes `cowork?.callMcpTool`, which no longer resolves; hand-
patching a minified bundle would be overwritten by the next `build:browser`. Upstream needs
a `claude.use("mcp")` transport. `test_vendored_tracker_still_carries_the_dead_cowork_transport`
pins the gap so it fails once upstream ships and this caveat can be dropped.
