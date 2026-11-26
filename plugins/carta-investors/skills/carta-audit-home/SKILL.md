---
name: carta-audit-home
version: 0.1.0
description: >-
  Builds, rebuilds or opens the Carta Audit Home page — a live page for an auditor that
  lists every fund they can audit on Carta, shows which of the seven audit areas are
  ready, what changed since they last checked, and downloads each area's zip from the
  page. Use when someone asks to "build my Carta audit home page", "build my carta
  audit home artifact", "create my audit home", "set up my audit dashboard", "rebuild
  audit home" — and to open an existing one: "open my audit home", "where's my audit
  home". Do NOT use it to answer a readiness, what's-new or download question in chat;
  those go to carta-investors:carta-audit-readiness, carta-investors:carta-audit-whats-new and
  carta-investors:carta-audit-download. Not the firm's Carta Home dashboard
  ("build my Carta Home", "open my home"); that is carta-investors:carta-home-build.
allowed-tools:
  # The only source for the connector's name the page calls.
  - list_connectors
  # The connector check and the audit-access check before building.
  - mcp__carta__welcome
  - mcp__carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-home/scripts/build_audit_home.py" *)
  - Artifact
  - ToolSearch
  - AskUserQuestion
model: inherit
trigger-phrases:
  - "build my Carta audit home page"
  - "build my carta audit home artifact"
  - "create my audit home"
  - "set up my audit dashboard"
  - "rebuild my audit home"
  - "open my audit home"
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.69.16</carta-plugin>

# Carta Audit Home — build, rebuild, open

Publishes the **Carta Audit Home** live page. It opens inside Claude, signs in through
the viewer's own Carta connection, and shows:

- **Your audits** — every fund the viewer can audit, grouped by firm, for an audit year
  they pick. Each fund shows how many of the seven areas have downloadable documents,
  with one tag per area, lit when the area has documents to download.
- **One fund** — the seven areas with document counts, readiness, the documents that
  aren't ready yet, and a **Download** button per area plus **Download all areas**.
- **What's new** — documents added, changed or removed since the viewer last checked,
  with **Mark as checked**.
- **Download across funds** — shows a prompt for the year on screen with a **Copy
  prompt** control. Pasted into chat, it runs `carta-investors:carta-audit-download` for several funds at once,
  including funds too large for the page to open. The page can't type into the chat,
  so the chat also offers a choice that starts it (see "Next step" below).

The page is built from `resources/audit-home.template.html` by
`scripts/build_audit_home.py`, which stamps in the Carta connector's name. Never
hand-edit a built page; change the template and rebuild.

## Voice

Write for an external auditor, not a Carta employee. Never show them a fund UUID, an
`fa__*` command name, the words "MCP", "artifact" or "connector name", or anything
from this skill's checks. Call the page "your Carta Audit Home".

## Impersonation

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/impersonation.md` (the plugin's own
`references/`, not this skill's) and follow it. Do not search for the file — read it
at that path. The page runs as whoever opens it, on their own Carta sign-in.

---

## Step 0 — Checks before building

Run these in order and say nothing about them when they pass. Each file is in the
**plugin's** `references/` directory, not this skill's. Read it by the exact path given
and don't search for it.

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session
   publish a page at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the name of the
   Carta connection the page will call. Its confirmation call is `welcome`, carrying
   `_instrumentation_v2` as `${CLAUDE_PLUGIN_ROOT}/references/audit/mcp-setup.md` describes,
   with `"skills": ["carta-investors:carta-audit-home"]`.
3. **Audit access.** One call:

   ```
   mcp__<SERVER>__read_tool({
     "name": "fa__list__member-firms",
     "arguments": {},
     "_instrumentation_v2": {"skills": ["carta-investors:carta-audit-home"]}
   })
   ```

   - **One or more firms** → continue.
   - **Empty, for an auditor** → don't build. The page would be empty. Say: "You don't
     have audit access to any fund on Carta yet. Access to a fund's audit documents
     comes from the fund's general partner or its fund administrator, not from Carta
     support. Once you have it, ask me again."
   - **Empty, for Carta staff** → don't build. The page lists only firms where the
     viewer is a member. Say the page is for auditors, and offer
     `carta-investors:carta-audit` to work a fund in chat.

If the checks' files can't be read at all, this is claude.ai chat, which can't publish
the page. Say: "Your Carta Audit Home can't be built in claude.ai chat. Open Claude Code
or Cowork and ask me again." Then stop.

The page itself covers several funds and firms at once, so it never needs the picker
from the "Several funds at once" section of
`${CLAUDE_PLUGIN_ROOT}/references/audit/resolve-engagement.md`. It does follow that
section's rules: firms in `fa__list__member-firms` order, one firm active at a time,
and each year offered only when a fund has documents for it.

## Step 1 — Find a page already published

```
Artifact({action: "list", scope: "mine"})
```

Keep the `url` of the artifact whose title is exactly **Carta Audit Home** and whose
favicon is **📋**. Step 3 passes it so the page updates in place and keeps its link.
Leave `url` out when there is none.

More than one match means an earlier run made a second page instead of updating the
first. Don't pick one silently: say how many there are and which link you are about to
update.

### Open instead of rebuilding

If the caller asked to **open or find** the page ("open my audit home", "where's my
audit home") and Step 1 found it, don't rebuild. Send this as the whole reply, then
ask the "Next step" question below:

> Here's your Carta Audit Home: <link, titled Carta Audit Home>
>
> Tip: click its title and choose **Pin** to keep it one click away. Or just say "Open
> my audit home" anytime.

If Step 1 found none, say so in one line and build it.

## Step 2 — Build the page

The script is in this skill's own `scripts/` directory. Run it on one line, exactly as
written, so `allowed-tools` matches it. `<connector name>` is Step 0's answer, and
`<outputs-directory>` is the session's outputs folder:

```
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-home/scripts/build_audit_home.py" --mcp-server "<connector name>" --out "<outputs-directory>/carta-audit-home.html"
```

It prints the built file's path. If it prints `error:`, stop and say the page couldn't
be built. Don't edit the template or the output to get past it.

## Step 3 — Publish

```
Artifact({
  file_path: "<the path Step 2 printed>",
  url: "<url from Step 1 — omit entirely on a first publish>",
  description: "Your audits on Carta: readiness by area, what's new since your last check, and downloads.",
  favicon: "📋",
  label: "Built from the Carta Investors plugin",
  capabilities: {
    mcp: {
      servers: [
        {
          server: "<connector name>",
          tools: ["welcome", "set_context", "read_tool", "call_tool"]
        }
      ]
    }
  }
})
```

- No `title`: the tool takes it from the page's `<title>`, **Carta Audit Home**.
- Restate the whole `capabilities` object on every publish. A tool left out is taken
  away from the page.
- Keep `favicon` the same on every publish. Step 1 finds the page by it.

## Step 4 — Confirm

Give the link and say what it shows, in two lines at most, then the pin tip:

> Your Carta Audit Home is ready: <link>
>
> It lists every fund you audit, shows which areas are ready and what's new, and
> downloads each area's documents. The first time it opens, Claude asks to use your
> Carta connection; say yes.
>
> Tip: click its title and choose **Pin** to keep it one click away.

Then ask the "Next step" question below.

## Next step

A live page can't type into the chat, so the chat offers the several-funds download as
a choice the auditor clicks. Ask per the "Next-step question" section of
`${CLAUDE_PLUGIN_ROOT}/references/audit/next-step.md` (the plugin's own `references/`, not
this skill's; do not search for it), with these choices:

- **Download across funds** — "Every fund you audit, in one go. You pick the year and
  areas next."
- **Done for now** — "Come back any time: say 'Open my audit home'."

Route a "Download across funds" answer to `carta-investors:carta-audit-download` as the
request "Download audit documents for all my funds". It carries no year: the download
skill's funds picker offers only the years the ticked funds have documents for, and
pre-ticks every fund for "all my funds" (the "Several funds at once" section of
`${CLAUDE_PLUGIN_ROOT}/references/audit/resolve-engagement.md`).

---

## How the page works

For whoever changes the template. Everything the page calls goes through one `_mcp()`
wrapper, which stamps `_instrumentation_v2` with `from_ui: true`.

| What | Command | Notes |
|---|---|---|
| Firms | `fa__list__member-firms` | The viewer's own firms. Staff get an empty list. |
| Funds and years | `fa__list__auditable-funds` | Once per firm for each year the "Years with documents" section of `${CLAUDE_PLUGIN_ROOT}/references/audit/resolve-engagement.md` names, with that section's offered years and its Step 3 default year. |
| Documents | `fa__list__audit-documents` | Once per audit area per fund for the chosen year, always with `audit_area` (the seven slugs in `${CLAUDE_PLUGIN_ROOT}/references/audit/audit-areas.md`), every page of each (`has_next` / `after`). A fund's seven calls run together, at most 8 listing calls at a time across the page, and the page merges the rows. Readiness follows the table in `${CLAUDE_PLUGIN_ROOT}/references/audit/audit-areas.md`. |
| Download | `fa__mutate__export-audit-documents` then `fa__get__audit-export-status` | By area. The page polls every 5 seconds for up to 5 minutes, then offers **Try again**. A Partners' Equity export can return a second zip. |
| Download across funds | none | Shows "Download audit documents for all my funds, audit year <year>" as a prompt with a **Copy prompt** control, for the viewer to paste into chat; the prompt follows the year selector. A page can't post into the chat itself; the "Next step" question above is the one-click route. "All my funds" is the wording the "Several funds at once" section of `${CLAUDE_PLUGIN_ROOT}/references/audit/resolve-engagement.md` pre-ticks every fund for. If the browser blocks copying, the page says to select the prompt and copy it by hand. |

- **One firm at a time.** Carta keeps one active firm per session, so the page calls
  `set_context` before each firm's calls and never runs two firms' calls together. The
  chat shares that active firm, so the page switches again every time rather than trust
  the firm it set last.
- **What's new** is kept in the viewer's browser, per fund and year. The first visit
  saves today's list. Later visits compare against it until the viewer presses **Mark
  as checked**. This record is separate from the one the chat skills keep in
  `${CLAUDE_PLUGIN_ROOT}/references/audit/check-record.md`, which a page can't read.
- **Large listings.** A whole fund's list can pass Carta's answer-size limit, so the page
  lists one area at a time. The page can't fetch an oversize answer's download link,
  because it can't reach any web address, so an area that is still oversize is marked
  "Too many to list here": it keeps its **Download** button, shows no count or
  readiness, and the fund's other areas render normally. The fund's line and detail
  point to `carta-investors:carta-audit-readiness` in chat. A failure on any area other
  than size is asked once more under the fund's firm, then abandons the fund, since a list
  with a hole in it would misreport what's new. The area count leaves an abandoned fund
  out and says how many funds weren't checked, and a firm whose funds didn't load after
  a second try gets a notice, so a count never shrinks without a reason on screen.
- **First-visit tour.** The first load that works opens a four-step tour (funds and audit
  year, the seven areas, what's new, downloads). It is kept in the viewer's browser under
  its own key, skips a step whose target isn't on screen, waits while the viewer is typing,
  and makes no Carta calls.
- **Downloads** open Carta's own download link in a new tab. The browser saves the zip
  under Carta's file name; the link's tooltip shows the plugin's area-first name.

## If something fails

- **Every fund says Carta isn't connected, or the sign-in expired.** The viewer
  reconnects Carta in Settings → Connectors and presses **Refresh**. If their
  connection has a different name from the one Step 0 found, rebuild.
- **The page says it doesn't have permission.** The publish call left a tool out.
  Publish again with the full `tools` list and the same `url`.
- **In claude.ai chat the page shows no data.** Live pages only reach Carta in Claude
  Code and Cowork. Say so; it isn't an error.
