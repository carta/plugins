---
# The rollout gate is server-side: crm-api withholds `get_crm_home` unless MCP_UI_HOME_ENABLED
# is on for the organization. This skill degrades when the tool is absent, so shipping it ahead
# of the rollout costs an organization nothing.
name: home
description: >
  Renders the Carta CRM Home: a landing view with pipeline by stage, recent
  contacts, deals, object counts, latest notes, this week's meetings, and a
  directory of the prompts the plugin supports.
  Use this skill when the user says things like "carta crm home", "show my crm
  home", "my crm dashboard", "what's in my pipeline today", "crm landing page",
  or "/home". It is also the skill that decides whether the Home belongs in the
  conversation or on a published page, so start here even when the user may want
  a page. Read-only. Do NOT use it to look up a specific record — name the
  record instead and Claude picks the right search skill. For a fund firm's
  Carta Home use carta-investors' carta-home-build; for a company's cap table
  use carta-cap-table's carta-captable-home-build.
allowed-tools:
  # Prefix-agnostic so the grant holds whichever form the host registers. Cowork names the
  # connector by uuid (mcp__2827383e-...), which the literal `mcp__carta__` form never matches.
  - mcp__*carta*__crm_call_tool
  - mcp__*Carta*__crm_call_tool
  - mcp__*carta*__crm_view_tool
  - mcp__*Carta*__crm_view_tool
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

The Home is one manifest tool and two places to put it. The server decides which cards this
organization may see, and the view fetches each card itself. Your job is to read the
manifest, route a new user to the tutorial, pick where the Home goes, and render it.

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

## Step 3 — Pick where the Home goes

There are two, and they are not alternatives of equal standing:

- **In this conversation.** Step 4 renders it. This works everywhere the CRM MCP is
  reachable, so it is the floor and the default.
- **As a published page.** The `carta-crm-home-build` skill publishes it at a stable URL the
  user can bookmark and reopen cold.

**The page is available only when both of these hold**, so establish it before any rule
below offers the page or invokes anything:

- The `Artifact` tool is present. Without it this surface cannot publish at all.
- The `carta-crm-home-build` skill is installed. It is internal today, so a published
  install does not carry it and no build verb can reach it.

Treat the page as unavailable whenever you cannot confirm both. Never name a page this
surface cannot produce, and never invoke a skill you have not seen.

Decide in this order, and stop at the first that answers.

**1. What the user asked for.** A build or publish verb, such as "publish my crm home", "pin
it", or "give me a link I can bookmark", names the page. When the page is available, invoke
`carta-crm-home-build` and do not render here as well. When it is not, say in one line that a
bookmarkable page is not available on this surface, then render in the conversation. A plain
"show my crm home" names neither target, so carry on. A build verb is not a reason to invoke
a skill that is absent.

**2. What they already told you this session.** If they have already chosen, honour it
without asking again, as long as that target is still available. A recorded choice for a
target this surface cannot serve falls through to the next rule rather than failing.

**3. What this surface can do.** If the page is unavailable, render in the conversation and
say nothing about a page that cannot be built here. If it is available, both targets are
open, so ask once, in one line:

> Want this as a page you can bookmark, or just here in the chat?

**Ask only when both are genuinely available.** A question with one real answer is friction,
not a choice.

**Do not persist the answer.** It holds for this session. Getting it wrong costs one sentence
to redo, which is cheaper than a stored preference nobody remembers setting.

If you cannot tell whether the page is available, render in the conversation. The floor is
never the wrong answer, and it never depends on the published page existing.

## Step 4 — Render the Home

```
crm_view_tool({ "name": "crm:get_crm_home", "arguments": {} })
```

The view renders the shell and then fetches every available card itself, in parallel,
each with its own timeout. **Do not call the card tools yourself.** They are
`get_crm_home_pipeline`, `get_crm_home_contacts`, `get_crm_home_deals`,
`get_crm_home_counts`, `get_crm_home_notes` and `get_crm_home_meetings`, and calling
them here duplicates every fetch the view is already making.

Read the card set from the manifest rather than from this list. The server ranks the
cards by the caller's own measured tool use, so both which cards appear and the order
they appear in vary per user.

If `crm_view_tool` answers that the tool has no view, the MCP App bundle is off for this
organization. Fall back to summarising the manifest you already hold from Step 1, and say
the interactive Home needs the CRM UI enabled.

### Close with the escape hatch

A third answer exists, and it looks like success: `crm_view_tool` returns the manifest, no
error, and the host mounts nothing. You cannot tell that apart from a Home that rendered —
you never see the view — so do not guess, and do not claim it rendered.

Say one line after the call, whenever the published page is available:

> If nothing appeared above, say "publish my crm home" and I'll give you a page instead.

One sentence, offered every time, costs a reader nothing and turns a blank surface into the
page. Leave it out where `carta-crm-home-build` is unavailable, per the Step 3 checks —
never name a page this surface cannot produce.

## What the cards mean

| Card | Shows | When it is missing |
|---|---|---|
| Pipeline by stage | Open deals grouped by stage | Absent from the manifest when the deals module is off |
| Contacts added recently | Contacts added in the last 30 days | Never |
| Deals | The tenant's deals | Absent from the manifest when the deals module is off |
| Your CRM at a glance | Object counts across the tenant | Never |
| Latest notes | The most recent notes | Never |
| Meetings this week | The user's next seven days | Present but unavailable, with a reason, when interaction tracking is off |
| What you can ask | Prompts the plugin supports | Never. It is static and always renders |

Two gates behave differently, so a card goes missing in two different ways. A module
gate drops its card from the manifest entirely, because a tenant that does not buy the
module should not see the tile. An interactions gate keeps the card and marks it
unavailable with a reason, because an absent tile would be indistinguishable from a
genuinely empty week.

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
