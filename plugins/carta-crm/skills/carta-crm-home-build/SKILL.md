---
# An organization whose MCP_UI_HOME_ENABLED is off gets no resource from crm-api, so Step 1
# finds nothing to publish and the skill stops there rather than publishing an empty page.
name: carta-crm-home-build
description: >
  Publishes the Carta CRM Home as a live artifact — a standalone page, at a stable URL,
  showing pipeline by stage, recent deals and contacts, object counts, latest notes and
  this week's meetings. The page reads the CRM itself through a read-only grant, so it
  refreshes whenever a viewer opens it. Use this skill when the user asks to "build crm
  home", "rebuild crm home", "publish my crm home", "pin my crm home", "deploy crm home",
  or asks for a CRM Home page they can bookmark. For a fund firm's Carta Home (SOI, fund
  performance, LP reporting) use carta-investors' carta-home-build; for a company's cap
  table use carta-cap-table's carta-captable-home-build. To see the Home inside this
  conversation rather than publish it, use the `home` skill.
model: inherit
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  # Entitlement, and the organization the published title names.
  - mcp__*carta*__welcome
  - mcp__*Carta*__welcome
  - mcp__*carta*__get_current_user
  - mcp__*Carta*__get_current_user
  # The page itself. Prefix-agnostic so the grant holds whichever form the host registers.
  - mcp__*carta*__list_resources
  - mcp__*Carta*__list_resources
  - ListMcpResourcesTool
  - ReadMcpResourceTool
  # The manifest, for the viewBuildId the page is stamped with. Read-only by construction.
  - mcp__*carta*__crm_read_tool
  - mcp__*Carta*__crm_read_tool
  - Bash(uv run *build_artifact.py *)
  - Bash(find ~ -name "build_artifact.py"*)
  - Bash(find /sessions -name "build_artifact.py"*)
  - Bash(dirname *)
  - Artifact
version: 1.0.0
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

# Carta CRM Home — publish

Publishes the CRM Home as **`Carta CRM Home - <Organization>`**, favicon **📇**.

**You never assemble or read the page.** crm-api builds it and serves it as an MCP resource,
so this skill fetches that resource and stamps two things into it. That is deliberate: the
page's JavaScript calls the card tools of the server it will read from, so fetching it from
that same server is what keeps the two in step. A copy vendored into this repository would
drift the moment the Home view changed, and would call tools whose payloads had moved on.

## What the page does

One manifest call, then one call per card, all through `crm_read_tool`:

| Card | Tool |
|---|---|
| Your CRM at a glance | `get_crm_home_counts` |
| Pipeline by stage | `get_crm_home_pipeline` |
| Deals added recently | `get_crm_home_deals` |
| Contacts added recently | `get_crm_home_contacts` |
| Latest notes | `get_crm_home_notes` |
| Meetings today | `get_crm_home_meetings` |
| What you can ask | rendered in the page, no tool |

The manifest decides which of those the organization may see, so the page never chooses for
itself what to show.

## The grant, and why it is this narrow

The page declares `crm_read_tool` and nothing else. **Every viewer of the URL inherits that
grant**, and a non-empty `capabilities` object replaces the stored one on every republish, so
it cannot be trimmed afterwards.

`crm_read_tool` cannot write. It refuses, rather than executing:

```
CRM tool 'update_deal' writes, so it is not available through crm_read_tool.
```

Do **not** add `crm_call_tool`. It reaches the whole catalogue, including every write, and
handing that to everyone who opens a URL is a different thing entirely from showing them a
dashboard.

## Step 0: Gates

**Resolve the connector name.** Call `list_connectors` and take the Carta connector's display
name. This is the one thing the page cannot work out for itself, and a wrong name fails every
card with `server_not_connected`. A firm-specific deployment carries its own name, so never
assume `Carta`.

**Resolve the organization.** Call `get_current_user`. Its organization names the published
artifact. One artifact per organization, so two never write over each other.

**Confirm the user holds CRM.** If `get_current_user` reports no CRM access, say so and stop.

## Step 1: Fetch the page and its build id

**List the resources first, and read the URI off the row rather than assuming it.**

```
ListMcpResourcesTool(server: "<connector display name>")
```

Take the row whose URI ends `crm-home.html` — today the proxy serves it at
`ui://carta/crm-home.html`. The URI carries **no build hash**: it is a constant, and the proxy
owns it, so it does not move when crm-api rebuilds the page. Read it from the list anyway, so a
later rename in the proxy does not need a change here.

crm-api registers the same bundle under `ui://carta-crm/home.html`. That URI is internal to the
proxy and no host can resolve it, so never pass it here.

```
ReadMcpResourceTool(server: "<connector display name>", uri: "<the URI from the list>")
```

**Then read the build id off the manifest**, which is the only place it exists:

```
crm_read_tool({ "name": "get_crm_home", "arguments": {} })
```

Keep its `viewBuildId`. Step 2 stamps it, and the page compares it against a fresh manifest call
to tell a reader their copy is behind. It comes from the manifest and not from the URI because
the URI has no hash to take.

**If the resource is not listed**, the organization is outside the Home rollout. crm-api
withholds it exactly when it withholds the card tools, so there is nothing to publish and a
page built anyway would be a column of errors. Tell the user the Home is not switched on for
their organization, and stop. Do not fall back to the views bundle at
`ui://carta/crm-views.html`: it is a different build that expects a host to hand it a result,
and it carries demo fixtures.

The read is large, so the result is saved to a file and you are given the path rather than
the content. **Keep the path and pass it to Step 2. Do not open it** — Step 2 reads it, and
nothing in this skill needs the page in your context.

## Step 2: Stamp the page

The script lives in **this skill's own `scripts/` directory**.

> **Path — do NOT rely on `${CLAUDE_PLUGIN_ROOT}` in bash.** In the Cowork sandbox that env
> var is empty, so `uv run "${CLAUDE_PLUGIN_ROOT}/…"` resolves to a broken path. Use the base
> directory reported for this skill when it loaded (it ends in `/skills/carta-crm-home-build`)
> as `<SKILL_DIR>`. If you do not have it, resolve it once with a scoped `find` (NOT `find /`):
> ```
> SKILL_DIR="$(dirname "$(dirname "$(find /sessions "$HOME" -type f -path '*/carta-crm-home-build/scripts/build_artifact.py' 2>/dev/null | head -1)")")"
> ```

```
uv run "<SKILL_DIR>/scripts/build_artifact.py" \
  --resource "<path from Step 1>" \
  --connector "<connector display name>" \
  --organization "<organization from Step 0>" \
  --build-id "<viewBuildId from Step 1>" \
  --out <outputs-directory>/crm-home-<slug>.html
```

`<slug>` is the organization lowercased with non-alphanumerics collapsed to `-`, so two
organizations never write over each other's file.

The script writes three things and validates the rest:

- `<meta name="carta-connector">`, where the page reads which connector to call.
- `<meta name="carta-home-build">`, the `viewBuildId` from Step 1. The page compares it against
  `viewBuildId` on a fresh manifest call and shows a rebuild notice when the two disagree. Pass
  it every time: without `--build-id` the page carries no stamp, and a page with no stamp never
  reports being behind. This is also why the page must be fetched fresh rather than reused from
  a previous run.
- the `<title>` that names the artifact.

It refuses a page that never calls `get_crm_home`, or one carrying the other views, so a wrong
resource stops here rather than reaching a URL.

## Step 3: Find an already-published CRM Home

```
Artifact({action: "list", scope: "mine"})
```

Look for one titled exactly **`Carta CRM Home - <Organization>`**. If it is there, keep its
`url` so Step 4 redeploys in place and the bookmark keeps working. If there is none, omit
`url` and this organization gets its own artifact.

An artifact for a **different organization is not a match** — reusing its `url` would replace
that organization's page with this one.

Two neighbours to leave alone. **`Carta Home - <firm>`** (favicon 🏠) belongs to
carta-investors' `carta-home-build`. **`Carta Home - <company>`** (favicon 📊) belongs to
carta-cap-table's `carta-captable-home-build`. Neither is a CRM Home, and publishing over one
would replace a colleague's dashboard.

## Step 4: Publish

`action` defaults to `"publish"`, so it is omitted. `url` is the only difference between a
first publish and a redeploy.

```
Artifact({
  file_path: "<outputs-directory>/crm-home-<slug>.html",
  url: "<url from Step 3 — omit entirely on a first publish>",
  description: "Your Carta CRM at a glance — pipeline by stage, recent deals and contacts, latest notes, and today's meetings.",
  favicon: "📇",
  label: "Rebuilt from the Carta CRM Home resource",
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

> **No `title` here, and do not add one.** The tool takes the title from the file's own
> `<title>` tag, which Step 2 set. Passing one as well would only apply if the tag were
> missing, and it would drift from the page.

> **Omit `favicon` on a redeploy.** A viewer finds their tab by its icon, so it stays 📇 for
> the life of the artifact.

## Step 5: Confirm it works

Give the user the URL and tell them what it will and will not do:

- It reads **live**, so it is current whenever they open it, not a snapshot.
- It **cannot write** to their CRM.
- Anyone they share it with reads their CRM data through it. Say this plainly.

If they report every card failing, the connector name is the first thing to check: a page
stamped with a name their session does not carry gets `server_not_connected` on every call.
Rebuild with the right name and republish to the same `url`.

## What this skill does not do

**It does not render the Home in the conversation.** That is the `home` skill, and it is the
one that works everywhere the CRM MCP is reachable. This skill only publishes.

**It does not choose between the two.** The `home` skill selects a target and calls this one
when the user wants a page.

**It does not build the page.** If the Home looks wrong, the fix is in crm-api's
`src/components/mcp/ui`, not here. Rebuilding through this skill republishes whatever that
server currently serves.
