---
name: carta-workhub-build
description: >
  Builds or rebuilds the Carta Workhub live artifact — a standalone Cowork view of the work
  a firm has sent its Carta fund admin team. Shows a request composer over a queue grouped
  into Tasks to complete (waiting on you), In progress (Carta is working), and a collapsed
  Completed, with a thread view for each request. The artifact auto-detects the active firm
  from the Carta MCP context — no hardcoded firm name needed. Use this skill whenever the
  user asks to "build the carta workhub artifact", "rebuild carta workhub", "set up carta
  workhub", "deploy carta workhub", "show my Carta workhub", "rebuild carta tasks",
  "show my Carta task board", or "pin my Carta requests".
model: sonnet
allowed-tools:
  - Bash(uv run *build_artifact.py *)
  # Matches the locate command in Step 1 verbatim — a reworded find prompts.
  - Bash(SKILL_DIR=*find /sessions "$HOME" -type f -path *build_artifact.py*)
  - Bash(find /sessions "$HOME" -type f -path *build_artifact.py*)
  - Bash(dirname *)
  - Artifact
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

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
- **Beta notice** — a standing banner under the page title says the artifact is in beta and
  that the list only covers requests sent through Claude. The listing sources below cannot see
  a request raised by email or phone, so the gap is stated rather than left for the reader to
  discover. It is the only body copy above the composer: the title and subtitle already say
  what the page is for.
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
- **Plan** — **Save as plan** holds a drafted request without sending it. Plans show in their
  own **Planned** group above the live queue, dashed and marked "Not sent", with **Review and
  send** or **Discard**. Sending a plan runs the same confirm step, and the plan is dropped only
  once the send succeeds. Carta has no unsent-draft state, so a plan lives in `localStorage`
  and nowhere else, so a plan does not follow the user to another machine. Storage also throws on
  an opaque origin (an artifact served from a `data:` URL), so a probe at first use decides which
  of two truths every surface tells — saved on this computer, or kept for this session only. The
  composer states the scope **before** Save as plan is pressed, and a tooltip on the Planned
  heading carries the detail, so the caveat is available without giving it more page weight than
  the work it describes. A durable, cross-device draft needs a server-side
  command that does not exist yet: carta-mcp#1.
- **Sent state** — a confirmation panel: "Your Carta team is on it", the notification promise, and
  a line telling the sender they can reply or add detail in the thread while work is underway.
  It deliberately does **not** show the workflow id — that is Carta's internal handle, and quoting
  it at the sender implies it is how they follow up, when the thread is.
- **Request type** — `fa:create:fund-admin-message` has no type field and the backend stamps
  `request_type: 'other'`, so a sent request would lose its category. The type is carried two
  ways: as the message's **first line**, which is durable server-side and is the first thing the
  team reads, and cached in `localStorage` against the workflow id. The row's own
  `additional_info` carries the request as sent, so a title needs no thread read — only a row
  with neither that nor a cached type falls back to reading its opening message (bounded to
  `FAR_HYDRATE_MAX`).

  **The backend wraps message bodies.** `content_text` and `thread_metadata.message_snippet`
  both come back as `"        Additional Info:\n        <indented body>"`. That preamble is
  Carta's own formatting, so `farUnwrap` strips it and the indent everywhere text is read or
  shown — without it every title read as "Additional Info:" and the thread showed the wrapper
  to the customer.
- **Queue** — grouped **Tasks to complete** (waiting on the customer), **In progress**, and a
  collapsed **Completed**, sorted **Newest** or **Oldest** first. There is deliberately no
  sort-by-status: the queue is grouped by status and rendered into fixed containers, so
  ordering rows by group before re-partitioning them by group is a no-op — the two modes
  produced byte-identical output. Cards in the same group that share a calendar day show the
  time as well, or a re-sort looks like nothing happened. Cards carry no entity:
  `fa:create:fund-admin-message` has no entity field, so `entity` is `null` on every row this
  artifact creates, and the line was a placeholder on 100% of cards. Sorting by it went with it.
  A real fix needs an `entity_uuid` on the create command — see `docs/plans/carta-workhub-entity-uuid.md`.
  Card status reads
  **Sent** / **Working** / **Ready for you** / **Done** — each an event the payload can prove.
  There is deliberately no "received": nothing marks a read, so it would be a guess. Grouping reads `status` (an int; 2 and 3 are terminal and outrank
  the pending actor) then `last_task.template`. Titles come from `request_type`, falling back
  to `thread_metadata.message_snippet`.

  **`fa:list:workflow` takes only `statuses` and rejects any other param** — the firm comes from
  the session context. Its rows name no pending actor; that comes off `tasks[]`.
- **Capital call review** — a `request-capital-activity` workflow carrying an open
  `review-capital-activity` (or `review-capital-activity-changes`) task opens the review panel
  instead of the thread: the preparer's note, what is being called, when it is due,
  how much of each commitment it consumes, and collapsible Investor allocations / Payment and
  delivery. A second panel shows the notice each investor receives, as the rendered email and as
  the real PDF. The footer carries **Request changes** and **Approve and release**, each behind
  its own confirm step. Read from `fa:get:capital-activity-review-summary`,
  `fa:list:capital-activity-review-row`, `fa:get:capital-activity-partner-email-preview` and
  `fa:get:capital-activity-notice-pdf-preview`; written with `fa:request-changes:capital-activity`
  and `fa:approve-and-release:capital-activity`. All of them ride the `fetch` and `mutate` tools
  already in the grant, so adding a command never changes the publish call.

  There is no build flag for this: the server decides which rows exist, so no review card
  means the environment does not serve them. `--ccr-fund-uuid` / `--ccr-activity-id` seed one
  card for a demo, and its panel still reads through the same commands.

  **The summary's embedded rows are the table's first paint.** `rows.results` on the summary is
  the unfiltered first page; seeding from it means the table is populated the moment the summary
  lands, instead of reporting zero investors until the row walk returns. The walk then replaces
  the seed wholesale rather than emptying it first. A count that is not yet known reads `Totals`,
  never `0`.

  **The panel is built to `Capital Call Review v3 - Carta Tasks.dc.html`, control for control.**
  The mock has 16 `onClick` handlers and 13 `sc-if` states; every one has a counterpart. When you
  change this panel, re-derive that list from the mock rather than reading the diff — a control
  that exists in the mock and not here does not announce itself.

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
  never a walk down the picker. A measured notice is 2 pages and ~45 KB.

  **The activity link is read off the workflow row**, not guessed: `fund.uuid` plus whichever of
  `capital_activity_id` / `object_id` the row carries. A row with neither opens the panel to a
  state that says so rather than to an empty review.

  A release that fails ambiguously does **not** re-enable the button. `server_unavailable` and
  `upstream_error` are not proof the release did not run, so the panel sends the reviewer to Carta
  to check rather than inviting a second press.
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
- **Firm auto-detection** — `list_contexts` resolves the active firm, then `set_context` pins it.
  The firm name shows under the page title. `list_contexts` answers `firm_name: "Unknown"` for
  some firms whose workflow rows carry the real name, so that literal is treated as no answer and
  the queue's own `firm.name` wins. First real name set holds; a later blank cannot clear it.

A card links out only when the workflow carries `workflow_cta_url`. `workflow_detail_url` is a
`/staff/` route, so it is never used — a customer cannot open it.

## Listing sources, in order

1. `fa:list:fund-admin-message` — the customer-facing list. **Not built yet in carta-mcp.**
2. `fa:list:workflow` with `template_type='request-generic'` — staff only.
3. Workflow ids this artifact recorded in `localStorage`.

Path 3 cannot see requests raised by email or phone, so the UI says so rather than implying
the list is complete. Once path 1 lands, non-staff get a full list and the caveat disappears.

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

`fa:create:document-content` is staff-gated, so the composer probes `discover` and
stays text-only when the viewer may not attach. Publish without `discover` and every
viewer looks un-entitled, staff included.

`callTool` **rejects** on tool failure rather than resolving with `isError`. The queue and
thread readers degrade one section while the rest of the page renders, so `_mcp` maps the
`tool_error` code back to an `isError` envelope and rethrows everything else — connector
codes (`needs_reauth`, `server_not_connected`) are page-level, not per-section.

## Source layout — the artifact is BUILT, not hand-edited

**Do NOT read or edit the assembled HTML.** Edit the small source file for what you change.

| File | What it holds |
|------|---------------|
| `resources/app/fund-admin-requests.js` | composer, queue, thread overlay — the whole feature |
| `resources/app/capital-call-review.js` | the capital call review panel and its notice sub-panel |
| `resources/carta-workhub.app.js` | shared helpers (`_mcp`, `escHtml`, `showToast`, `trackWorkhub`) plus firm resolution and boot |
| `resources/app/version-check.js` | update banner: reads the published version, compares, renders |
| `resources/carta-workhub.config.js` | `TASK_PRESETS` — the composer's preset tiles |
| `resources/carta-workhub.css` | styles (Ink tokens) |
| `resources/carta-workhub.template.html` | HTML skeleton + injection markers |
| `resources/carta-workhub.tracker.js` | inlined `@carta/mcp-ui-tracker` browser bundle |
| `resources/vendor/` | pdf.js, vendored — pinned to the last UMD release for a reason its README gives |
| `../../.claude-plugin/skill-versions.json` | this skill's `version` + release `headline` |

`carta-workhub.app.js` duplicates a handful of helpers from `carta-home.app.js` on purpose:
the two artifacts ship independently, so neither may import from the other. Keep them
behaviourally identical.

## Versioning

Same contract as `carta-home-build`, keyed to `carta-workhub-build` in
`plugins/carta-investors/.claude-plugin/skill-versions.json`. A deployed artifact is a frozen
copy, so **change anything under `resources/`, bump the entry in the same PR** — CI enforces it
via `.forgejo/scripts/validate-artifact-version-bump.py`.

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
uv run "<SKILL_DIR>/scripts/build_artifact.py" --mcp-server "<CARTA_MCP_SERVER>" --out "<CWD>/carta-workhub.html"
```

Add `--ccr-fund-uuid <fund_uuid> --ccr-activity-id <capital_activity_id>` to seed one capital call
review card. That is for testing the panel before the queue can discover review tasks; a normal
build omits both.

Locate `<SKILL_DIR>` first. This exact form is what `allowed-tools` permits, so a
reworded one prompts for permission:

```bash
SKILL_DIR="$(dirname "$(dirname "$(find /sessions "$HOME" -type f -path '*/carta-workhub-build/scripts/build_artifact.py' 2>/dev/null | head -1)")")"
```

Fall back to `${CLAUDE_PLUGIN_ROOT}/skills/carta-workhub-build` when that comes back empty.

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
          tools: ["list_contexts", "set_context", "fetch", "mutate", "welcome", "discover"]
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

> Carta Workhub is live. Anything waiting on you shows at the top under **Tasks to complete**.

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
