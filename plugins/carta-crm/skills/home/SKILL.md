---
# The rollout gate is server-side: crm-api withholds `get_crm_home` unless MCP_UI_HOME_ENABLED
# is on for the organization. This skill degrades when the tool is absent, so shipping it ahead
# of the rollout costs an organization nothing.
name: home
description: >
  Renders the Carta CRM Home: a landing view with counts, open tasks, pipeline by
  stage, this week's meetings, and a directory of the prompts the plugin supports.
  Use this skill when the user says things like "carta crm home", "show my crm
  home", "my crm dashboard", "what's in my pipeline today", "crm landing page",
  or "/home". Read-only. Do NOT use it to look up a specific record — name the
  record instead and Claude picks the right search skill.
allowed-tools:
  - mcp__carta__crm_call_tool
  - mcp__carta__crm_view_tool
  - Skill
version: 1.0.0
model: inherit
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

# Carta CRM Home

The Home is one manifest tool plus one view. The server decides which cards this
organization may see, and the view fetches each card itself. Your job is to read the
manifest, route a new user to the tutorial, and render the view.

## Step 1 — Read the manifest

Call it for data first, not for the view:

```
crm_call_tool({ "name": "crm:get_crm_home", "arguments": {} })
```

Read it for data before you render anything. Step 2 can send the user elsewhere, and a
Home that renders and is then retracted is worse than one that never rendered.

### If the tool does not exist

The Home is behind a rollout flag. When it is off the server does not register
`get_crm_home` at all, and the call fails with an unknown-tool error. That is a normal
answer for an organization outside the rollout, not a failure.

**What you do next depends on what the user asked for.**

| The user asked for | Do this |
|---|---|
| The Home itself, a dashboard, or `/home` | Say the Home is not switched on for their organization, and offer what they can ask for instead |
| Something a card would have shown, such as "what's in my pipeline today" | Answer the question through the skill that owns it, here `search-deals`. Do not mention the Home |

The second row is the important one. A phrase like "what's in my pipeline today" is a real
question that the plugin already answers, so leaving the user with "the Home is off" would
take away an answer they used to get.

**Never assemble a substitute Home.** Do not call `search_deals`, `search_tasks`,
`list_calendar_events` and the rest to imitate the card set. Handing one question to the
skill that owns it is fine, because that skill runs its own access checks. Building a
Home-shaped panel yourself runs none of the card gating, so it can show an organization
something it is not entitled to see.

## Step 2 — Route a new or lapsed user to the tutorial

The manifest carries `firstTimeUser`. When it is `true`, the user is new to the CRM MCP
or has not used it for a while.

**Invoke the `tutorial` skill instead of rendering the Home.** Say one line first, so the
redirect does not read as a mistake:

> Let me walk you through the plugin first. Your Home is waiting at the end.

The tutorial ends by rendering the Home, so nobody is denied it. Do not render the Home
yourself as well.

When `firstTimeUser` is `false` or absent, continue to Step 3.

## Step 3 — Render the Home

```
crm_view_tool({ "name": "crm:get_crm_home", "arguments": {} })
```

The view renders the shell and then fetches every available card itself, in parallel,
each with its own timeout. **Do not call the card tools yourself.** They are
`get_crm_home_counts`, `get_crm_home_tasks`, `get_crm_home_pipeline` and
`get_crm_home_meetings`, and calling them here duplicates every fetch the view is
already making.

If `crm_view_tool` answers that the tool has no view, the MCP App bundle is off for this
organization. Fall back to summarising the manifest you already hold from Step 1, and say
the interactive Home needs the CRM UI enabled.

## What the cards mean

| Card | Shows | When it is missing |
|---|---|---|
| Counts | Object counts across the tenant | — |
| Open tasks | The user's own open tasks | — |
| Pipeline by stage | Open deals grouped by stage | The deals module is off for this tenant |
| Meetings this week | The user's next seven days | Interaction tracking is off for this tenant |
| What you can ask | Prompts the plugin supports | Never. It is static and always renders |

A card the manifest marks unavailable carries a `reason`. Report the reason if the user
asks why a card is absent. Do not offer to enable it: these are tenant permissions, not
user settings.

## After rendering

The Home has two exits. Point at whichever fits:

- a link on a card, which opens that record in the CRM web app;
- a prompt from the directory, which the user sends as their next message.

If the user picks a prompt, let the normal skill routing handle it. Do not try to answer
from the Home's payload.

## Notes

**Never render tenant data unlabelled.** The manifest names the organization, and the
view stamps it on every card. When `realOrganization` is present the user is Carta staff
viewing another tenant, and the view shows a banner. Do not remove or summarise away
either signal.

**The Home is read-only.** It never writes. If the user asks to change a record from
here, hand off to the matching add or update skill.
