---
name: adviser-tracker
description: >
  Publishes the organization's top twenty M&A advisers (investment banks) as a live page: each
  bank with its logo, deals created per quarter and per year, relationship strength with our
  team and the top contact, split into Tier 1 and Tier 2, with a year-over-year chart per bank
  and a monthly deal chart for the last three years. The page reads the stored tracker from
  Carta when it opens, so it is current whenever it is opened. Use this skill when the user says
  things like "adviser tracker", "advisor tracker", "M&A adviser tracker", "show our advisers",
  "who are our top banks", or "/adviser-tracker". For one adviser's record use search-companies.
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  # The fallback confirmation call for the connector, and the organization the published title names.
  - mcp__carta__welcome
  - mcp__claude_ai_Carta__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__carta__get_current_user
  - mcp__claude_ai_Carta__get_current_user
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__get_current_user
  # The warm-up and confirmation call: it starts the server's build when none is stored, and returns the state only.
  - mcp__carta__crm_read_tool
  - mcp__claude_ai_Carta__crm_read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__crm_read_tool
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/adviser-tracker/scripts/build_live_page.py" *)
  - Artifact
  - ToolSearch
version: 1.0.1
model: inherit
---

<!-- carta:plugin-version -->
<carta-plugin>carta-crm:1.18.4</carta-plugin>

# Adviser Tracker

Publishes the tracker as **`M&A Adviser Tracker - <Organization>`**, icon **🤝**.

**This skill never reads tracker data and never copies any.** The page fetches the stored
tracker from Carta when someone opens it. A tracker that is not built yet, a build that failed,
an organization without the tracker and a missing connector are states the page shows itself.
The skill publishes a page for every one of them and never stops for them.

## Voice

Never mention the template, the script, tool names, files, paths or this skill. Progress lines
speak in the user's words: "Setting up your tracker", "Publishing the page".

## The grant, and why it is this narrow

The page declares `crm_read_tool` and nothing else. **Every viewer of the URL inherits that
grant**, and a non-empty `capabilities` object replaces the stored one on every republish.
`crm_read_tool` cannot write. Do **not** add `crm_call_tool`: it reaches every write, and a
viewer of a URL must not have that.

## Step 0: Gate

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` (the plugin's own
`references/`, not this skill's). Do not search for it.

## Step 1: Start the build, and find the published tracker and the organization

The Carta tools may be deferred. Load `crm_read_tool` and `get_current_user` with one tool search
in the same turn that opens this skill.

Then in ONE turn, as parallel calls, make these four calls:

```
crm_read_tool({ "name": "crm:get_adviser_tracker_page", "arguments": { "stateOnly": true } })
```

```
Artifact({action: "list", scope: "mine", limit: 50})
```

plus `get_current_user`, for its organization, and `list_connectors`, for Step 2.

The page call is a warm-up. It answers with a state and no tracker data, and when no page is
stored it starts the server's build at once, so the build runs while you publish. Whatever state
it answers, including `not_configured` or an error, carry on: the page shows that state itself.
Never call it again and never read data with it.

One artifact per organization, so two never write over each other. If `get_current_user` fails or
names no organization, leave the organization out and carry on.

Look for an artifact titled exactly **`M&A Adviser Tracker - <Organization>`** (with no
organization, **`M&A Adviser Tracker`**). An artifact for a different organization is not a
match. Keep its `url`.

**It is there, its label is `Live adviser tracker`, and the user did not ask for a rebuild:**
the page is live, so it is already current. Go to Step 5 with that `url` and publish nothing.
A rebuild is asked for with words like "rebuild", "republish", "redeploy" or "update the
template".

**A match with any other label, or a label the list does not show,** is a snapshot from before
the page was live, or cannot be told from one. Go on to Step 2 and redeploy it in place at the
kept `url`. Publishing again is always safe.

**No match:** go on to Step 2 and omit `url` on the first publish.

## Step 2: The connector's name

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` (the plugin's own
`references/`, not this skill's). Do not search for it. Follow it: take the name from the Step 1
`list_connectors` answer, and ask the user when several connectors match. The Step 1 page call is
the confirmation call the gate asks for: when it answered, with any state, the connector answers.
Only when it failed, confirm with one `welcome` call.

When there is no Carta connector, or the confirmation call does not answer, do not stop and do
not ask: use `Carta`, publish the page anyway, and say so in Step 5. The page then tells each
viewer to add the Carta connector, and it works once they do.

## Step 3: Write the page

Run this as its own command on one line, with the script path exactly as written and every
argument quoted. Chain nothing before or after it. Do not search for the script.

```
uv run "${CLAUDE_PLUGIN_ROOT}/skills/adviser-tracker/scripts/build_live_page.py" --connector "<connector display name>" --organization "<organization>" --out "<outputs-directory>/adviser-tracker-<slug>.html"
```

`<slug>` is the organization lowercased with non-alphanumerics collapsed to `-`, or `tracker`
with no organization. Leave `--organization` out when there is none.

## Step 4: Publish

`url` is the only difference between a first publish and a redeploy.

```
Artifact({
  file_path: "<outputs-directory>/adviser-tracker-<slug>.html",
  url: "<url from Step 1 — omit entirely on a first publish>",
  description: "Your top M&A advisers: deals per quarter and year, relationship strength and top contact, by tier.",
  favicon: "🤝",
  label: "Live adviser tracker",
  capabilities: {
    mcp: {
      servers: [
        {
          server: "<connector display name>",
          tools: ["crm_read_tool"]
        }
      ]
    }
  }
})
```

> **No `title` here.** The tool takes it from the file's `<title>` tag. **Omit `favicon` on a
> redeploy**, so the tab keeps its icon.

## Step 5: Reply

Give the user the URL and say what the page does:

- It reads **live**: opening it, or its Refresh button, shows the newest stored tracker. The
  server refreshes the stored tracker every hour, so the time on the page is at most about an
  hour old.
- The first time, or after a long pause, the page may say it is building. It updates by itself.
- It **cannot write** to their CRM.
- Anyone they share it with reads this organization's tracker through it. Say this plainly.
- When Step 2 found no connector: the page asks each viewer to add the Carta connector.
