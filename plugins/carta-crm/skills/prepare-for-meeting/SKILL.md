---
name: prepare-for-meeting
description: >
  Builds a one-page tear sheet for the next upcoming meeting with a counterparty, from CRM
  data only. Use this skill when the user says things like "prepare me for my meeting",
  "meeting brief", "brief me for this meeting", "prep for upcoming meeting", "what do I
  need to know before my call with [company]", or "/prepare-for-meeting". Compiles the
  invitees and their interaction history, the organization's notes and relationship
  status, and related deal, investor, fundraising or company context. Briefs exactly one
  meeting — the next one; not an agenda view.
allowed-tools:
  - mcp__carta__crm_call_tool
  - mcp__cowork__list_artifacts
  - mcp__cowork__create_artifact
  - mcp__cowork__update_artifact
  - AskUserQuestion
  - Bash(cp *)
  - Read
  - Edit
  - Write
version: 1.0.0
model: inherit
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
</IMPORTANT>

## Overview

The user has a meeting coming up and two minutes to prepare. Produce a scannable
one-page tear sheet: who is in the room, what our history with them is, what CRM
objects are in play, and what to ask.

Scope is deliberately narrow: **the next meeting with one counterparty**. There is no
agenda view and no date-range mode. If the user wants a week overview, say this skill
briefs one meeting and ask which.

## Voice — never narrate the machinery

The user asked to be prepared for a meeting. They did not ask how the brief is made, and
naming the mechanics makes a bespoke brief read as something pre-baked.

**Never mention in user-facing text:** the template, placeholders, sections, filling or
rendering, HTML, artifacts, file paths, tool names, or this skill. Per Carta writing style,
favour domain terms over internal system names.

Progress lines are welcome, but phrase them in the user's world:

| Don't say | Say |
|---|---|
| "Now let me look at the template and gather CRM data." | "Pulling your history with DataStream AI…" |
| "I'll fill in the sections and render the HTML." | *(say nothing — just produce the brief)* |
| "Calling get_adviser_profile…" | "Checking who covers this account…" |

Lead with the meeting, not the process. No "let me…" preamble about your own steps.

Two more rules that keep this fast and honest:

- **Never invent CRM data.** If a field isn't in the CRM, omit it and say so in
  "Unknowns". A confidently wrong brief is worse than a thin one.
- **Prefer `crm:get_adviser_profile` over hand-assembling context.** One call returns the
  company, top contacts with interaction counts, active deals, the next scheduled
  interaction and recent notes. Don't rebuild that from ten calls.

## Fetch plan — two waves, issued in parallel

Speed here is round trips, not the CRM: every tool call returns in roughly a quarter of a
second, so what costs time is doing them one at a time. The dependency graph is only two
waves deep, so **issue each wave as parallel calls in a single turn.**

Every `crm:*` name in this skill is dispatched through `crm_call_tool`. The generic
`call_tool` cannot reach CRM tools at all — it resolves Carta commands only:

```
crm_call_tool({ "name": "crm:<tool>", "arguments": { ... } })
```

**Wave 1** — once you have a domain or an entity id, these are independent of each other:

- the entity-appropriate interactions call (below) — the meeting, plus the history timeline
- `crm:get_adviser_profile` — company, top contacts, deals, notes, next interaction
- `crm:get_current_user` — needed only for the acting user's domain

**Wave 2** — only what Wave 1 left genuinely missing, again in parallel:

- `crm:search_contacts` for external attendees who did **not** appear in `topContacts`
- `crm:get_company_angles`

Never serialise these. Two waves is the target; more than three means something is being
fetched that the brief cannot show.

## Step 1 — Resolve the meeting

Every entity's interactions tool returns `futureInteractions` alongside past history.
`futureInteractions[0]` **is** the next meeting — capped at one by the API, which is
exactly the scope here. Take whichever handle the user gave you:

| What the user gives you | Call |
|---|---|
| A deal | `crm:get_deal_interactions` |
| An investor / LP | `crm:get_investor_interactions` |
| A fundraising | `crm:get_fundraising_interactions` |
| A company | `crm:get_company_interactions` |
| A person | `crm:get_contact_interactions` |
| An email address, domain, or a vague company name | `crm:list_interactions_by_domain` with `type: "EVENT"` |

```
crm_call_tool({
  "name": "crm:list_interactions_by_domain",
  "arguments": { "domain": "<domain>", "type": "EVENT" }
})
```

Resolve a name to an ID first when the tool needs one — `crm:search_deals`,
`crm:search_investors`, `crm:search_fundraising`, `crm:search_companies`,
`crm:search_contacts`, or `crm:find_company` / `crm:fetch_company_by_domain`.

When the user is vague ("my meeting with Acme"), prefer `list_interactions_by_domain`:
it expands domain aliases for the org, filters out private email providers, and needs no
ID lookup. Keep the same call's `interactions[]` — that is the past-meeting history for
Step 3, so you don't need a second request for it.

Each interaction is `{title, type, date, sender, participants[{email, name, domain}]}`.
`sender` is the organizer. There is no end time, meeting type, or RSVP status in this
payload — omit those fields rather than guessing at them.

If a Google Calendar or Microsoft 365 connector happens to be available in this session
and the user named no counterparty, read the next event from it and use its external
attendee domain as the handle. Treat this as opportunistic — this plugin does not
provide that connector, so never depend on it.

**If there is no handle at all**, ask the user once who the meeting is with, using
`AskUserQuestion`.

**Attempt cap — at most 2 resolution attempts.** If two attempts return no upcoming
meeting, stop and tell the user plainly that the CRM shows no upcoming meeting with
that counterparty. Do not: re-run the same lookup with a reworded query, switch to a
different entity tool hoping for a hit, widen to a bare company-name search, or reach
for `WebSearch`. Each of those looks like a fresh attempt and will burn the cap without
adding information.

**Sanity-check the date.** State the meeting date in the brief. If it is more than about
two weeks out, add a single line noting so — it usually means the wrong counterparty
was resolved, and the user can correct you.

## Step 2 — Split and resolve the attendees

Call `crm:get_current_user` to get the acting user and their own email domain. Classify
each entry in `participants[]`:

- **Internal** — same domain as the acting user. List them compactly; they need no
  enrichment.
- **External** — everyone else. These drive the rest of the brief.

Resolve external attendees to CRM contacts with `crm:search_contacts` on their email
address. **Cap this at the 3–4 most relevant attendees** — on a twenty-person invite,
enrich the organizer and the senior-most names, not everyone.

Keep attendees you cannot match. They are still in the room, so they still get a row:
show the email on the role line and `No history` for stats. Don't badge them — that the
CRM has nothing on them is already obvious from the row, and a label saying so takes
space without adding information.

**The role line is a job title.** One rule, both groups:

| Who | Role line |
|---|---|
| External, in the CRM | `Title, employer` |
| External, no CRM record | their email address |
| Internal | the title alone |

Never the firm name and never a bare domain. The group label directly above already
names the firm, so repeating it there is duplication, and `mmlcapital.com` is not a role
at all. If you have no title for an internal attendee, **omit the line** rather than
filling it with something that looks like data.

Internal attendees have titles in the CRM like anyone else, and `get_current_user`
does not return one — so fold them into the `search_contacts` pass you are already
making for the externals rather than spending a separate call, and drop the line for
anyone that pass doesn't resolve.

## Step 3 — Gather context

Start with one call on the external domain:

```
crm_call_tool({ "name": "crm:get_adviser_profile", "arguments": { "domain": "<domain>" } })
```

That returns the company, `topContacts[]` with `totalRelationsCount` /
`lastInteractedAt` / `nextInteractionAt`, `totalContactCount`, `activeDeals`,
`nextScheduledInteraction` and `recentNotes`. Read it before deciding what else you
need.

Top up only what came back thin, and **stop at 3 enrichment calls**. Ask for no more than
the brief can show: the history list displays 4 entries, so `limit: 6` is ample — pulling 50
costs tokens on rows nobody sees.

- `crm:get_company_angles` — warm paths. Nothing else returns these.
- `crm:search_contacts` — **only** for external attendees missing from `topContacts`.
- `crm:get_contact_interactions` — only when you need per-person detail `topContacts`
  lacks, and only for 1–2 people.
- `crm:search_deals` — **required whenever the Deals block will be shown.**
  `activeDeals` is not enough to render a deal card: it carries only `id`, `stage` (the raw
  id, e.g. `due-diligence`, not the label) and `addedAt`, and its `name` is the **company**
  name — so every card would repeat the counterparty's name instead of the deal's. Search
  filtered to the counterparty and read `fields.projectName` for the name, `stageName` for
  the badge, and `fields.evEstimate` / `fields.EBITDA` / `fields.chequeSize` for the detail
  line. Use `activeDeals` only to decide *whether* there are deals worth a call.

**Do not call these — `get_adviser_profile` already returned the same data:**

| Redundant call | Already in the profile as |
|---|---|
| `crm:list_notes_by_domain` / `crm:search_notes` | `recentNotes` |
| `crm:search_contacts` for a known contact | `topContacts[]` with title and counts |
| a second lookup for the next meeting | `nextScheduledInteraction` |

Each redundant call is a whole extra round trip — think, call, read, think — so it costs far
more than the ~250ms the request itself takes.

Use `count` from Step 1 as the relationship-depth signal, and `interactions[]` as the
recent-history timeline. Highlight the last interaction and anything that looks like a
change since it.

## Step 4 — Classify the primary context

Label the brief so the reader knows what kind of conversation this is. Pick the first
that applies:

1. Whatever the user explicitly named
2. An open deal on this domain
3. An active fundraising
4. An investor / LP relationship
5. A company relationship
6. Person-only — no institutional object yet, so treat it as a first contact

## Step 5 — Build the document

Do this silently. Per Voice above, never announce that you are reading a template or filling
sections — that is the single most common way this skill's output starts sounding pre-baked.

**Copy the file. Do not retype it.** Re-emitting the document from memory drifts: the CSS
comes back subtly different every run, so two briefs made an hour apart don't match, and
small guards silently disappear (the `.person-role` ellipsis that stops long job titles
overflowing is the one that goes first). Copying also costs ~2,000 fewer output tokens.

**Preferred — when `Bash` is available (Claude Code, or any host with a filesystem):**

```
cp "${CLAUDE_PLUGIN_ROOT}/skills/prepare-for-meeting/assets/brief-template.html" <working-path>
```

Then `Edit` that copy once per placeholder. Do **not** `Write` the finished document back
in one go: that retypes the whole `<style>` block, which is exactly what copying avoids.

**Fallback — no filesystem (Cowork artifacts, Desktop chat):** `Read` the template and
reproduce everything from `<html>` onward **verbatim**, including the entire `<style>`
block. Do not reformat, abbreviate, tidy, or re-derive a single rule. If you find yourself
composing CSS, you have already gone wrong.

Always reference the template through `${CLAUDE_PLUGIN_ROOT}` — a bare relative path
resolves against the user's working directory, not the plugin, and will fail.

**Drop the authoring comment.** The `HOW TO USE` block at the top of the template is
instructions for you, not part of the document. Delete it from the copy — it is ~1.3KB of
tokens the reader never sees. Everything from `<html>` onward stays.

Fill the `<!-- FILL: ... -->` placeholders and **delete any whole section whose data you
don't have**, comment markers included. Each section is bounded by
`<!-- SECTION: name -->` and `<!-- /SECTION: name -->`. Removing a section is how partial
data degrades gracefully; leaving an empty shell looks broken.

Hard constraints on the document:

- **No `<script>`.** The brief is a snapshot, not a live dashboard, and the PDF renderer
  does not execute JavaScript — a script-driven template renders as a blank page. This is
  also why the template ships no JS.
- **Keep the CSS inline** and images to absolute `https://` URLs. The document must stand
  alone in all three delivery paths below.
- **Escape every value you interpolate.** CRM field values are untrusted — a tenant's
  tag, dropdown option, note body or company name can contain arbitrary text. Convert
  `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`. Never drop a raw CRM value
  into an HTML attribute.
- **One page — item counts AND prose length both matter.** The limits below are measured
  against A4, but they are a ceiling on *count*, not a guarantee: a brief inside every limit
  still spills to a second page if the entries are wordy. Keep each briefing flag to a single
  line at ~90 characters. Cut ruthlessly — three sharp flags beat ten hedged ones.

  | Section | Max |
  |---|---|
  | Briefing flags | 5 |
  | People — external attendees | 4 |
  | People — internal attendees | 3 |
  | Deals | 3 |

  Format rules the layout depends on:

  - **Briefing flags are one line each** — ~90 characters max. Choose the correct severity:
    `flag-high` for anything that changes how the meeting opens, `flag-watch` for items to
    monitor, `flag-note` for context or FYI, `flag-strength` for positive signals. Order:
    high → watch → note → strength. Delete the whole briefing section only if you have
    nothing at all to flag.
  - **Never invent a value.** Every name, figure and date on the page must come from a tool
    response. When a field is absent, leave it out — do not fill it from a note, a
    neighbouring record, or inference. Two traps that have both produced wrong briefs:
    - Deal cards come from `search_deals` rows *only*. A fund target quoted in a note is
      not a deal; a deal's name is `fields.projectName` and nothing else.
    - `lastInteractedAt` and `nextInteractionAt` are frequently `null`. Print `Last` /
      `Next` only when the field is genuinely populated. `6 interactions` on its own is a
      complete, honest stats line.
  - **People stats dates are short** — `14 Jul`, never `14 Jul 2026`. The stats line is
    narrow; a year overflows it.
  - **Nobody vanishes.** External attendees cap at 4 and internal at 3. If the invite has
    more, close that group with `<p class="people-more">+N more on the invite</p>`. A brief
    whose job is telling you who is in the room must not silently omit someone who will be.
  - **Header firm names come from data.** The external firm name comes from the CRM entity.
    The acting user's firm comes from `get_current_user().organization` — do not hardcode
    it. Meeting time comes from `futureInteractions[0].startDate` — format as
    `Thu 11 Jun · 14:30` (abbreviated weekday, no year, 24-hour clock).
  - **Meeting time is local to the reader.** `startDate` comes back as UTC, with a trailing
    `Z`. Convert it to the acting user's timezone before formatting; printing the raw UTC
    hour puts the brief an hour or more off in most of the world, which is exactly the kind
    of error that makes someone miss the call.
  - **Avatar initials are two characters** — first initial + last initial only (`JD` not
    `JDR`). Assign background colors from the palette in the template comment, round-robin
    by position. Internal attendees always get `#A7AAAA`.

  If you have more material than fits, drop the least decision-relevant items rather than
  shrinking the text or trimming the template's styling — and account for what you dropped
  with the `.people-more` line rather than letting it disappear.

- **Before delivering, re-read the document for leftover template text.** Any remaining
  placeholder — `Meeting title`, `Date · Author`, `Generated date`, `N interactions`,
  `Attendee name` — means a fill was missed, and it will render verbatim to the user.
  Placeholders inside `FILL` comments are fine; visible ones are not.

Don't restyle the template. Colours are Carta Ink semantic tokens. Typography follows the
`carta-magnus` brand skill: **Libre Caslon Text** display, **Plus Jakarta Sans** body,
**IBM Plex Mono** for the uppercase label layer — all three load from Google Fonts.

Two things not to "fix":

- **Don't swap in SangBleu Versailles.** It is Carta's primary display face but is licensed
  to the design team, and brand guidance is explicit that Claude-generated output uses Libre
  Caslon Text instead. Naming SangBleu only produces a silent fallback to a system serif.
- **Don't copy the type ramp from `ux-patterns/css/cap-table-artifact.css` or
  `carta-lp-dashboard`.** Both use Inter, which is not a Carta brand typeface.

## Step 6 — Deliver it

### 1. An artifact — the primary render

The brief is a self-contained static HTML document, so **any** artifact capability renders it.
Use whichever this host offers:

**a. The host's native artifact capability.** If you can create an HTML artifact directly —
as in Claude chat and Claude Desktop — do that. This is the common case and needs no MCP tools
at all. Title it `Meeting Brief — <Company> — <date>`.

**b. The Cowork artifact MCP tools**, when `mcp__cowork__*` are available. Prefer these when
present, because they support update-in-place.

**Never skip to PDF just because `mcp__cowork__*` is missing** — check for a native artifact
capability first. (`carta-lp-dashboard` *requires* the Cowork tools because it builds a live
artifact calling `window.cowork.callMcpTool` at runtime. This brief is a static snapshot and
has no such dependency, so it is far less picky about the host.)

**A failed render counts as no render.** If the artifact renderer errors rather than being
absent — "unable to reach", "problem displaying content", a timeout, or an empty panel — treat
it exactly like a missing capability: **try it once, then move to the next sink.** Do not
re-render the same artifact hoping it sticks; the renderer being unreachable is not something
a retry fixes, and a half-rendered panel with no brief behind it is the worst outcome for a
user who is two minutes from a call.

**A written HTML file that the host previews is a render, not a consolation.** Many hosts show
an inline preview of a file you create, with an open/download control. When that happens the
user is looking at the brief, so don't apologise or describe it as a fallback — just point at
it. Only mention a failed renderer once, in a single clause, and never twice.

Using route (b): build a stable id `meeting-brief-<company-slug>-<yyyy-mm-dd>` from the meeting
date. Per-meeting ids mean successive briefs don't overwrite each other, while re-briefing the
same meeting updates in place.

Call `mcp__cowork__list_artifacts` and check whether that id already exists.

- **New** — `mcp__cowork__create_artifact` with `id`, `name`
  (`Meeting Brief — <Company> — <date>`), `html` (the full document), and a one-line
  `description` naming the company and date.
- **Exists** — `mcp__cowork__update_artifact` with the same `id`, the full `html`, and an
  `update_summary` such as `Refreshed <date>`.

**Do not pass `mcp_tools`** — this artifact makes no calls at runtime.

If the `mcp__cowork__*` tools aren't available in this session, skip this sink silently
and move on. Don't announce the absence.

### 2. PDF — portable fallback and shareable takeaway

Produce it whenever the artifact sink was unavailable; offer it when the artifact
rendered.

```
crm_call_tool({
  "name": "crm:generate_pdf_from_html",
  "arguments": {
    html: "<the same document from Step 5>",
    file_name: "meeting-brief-<company>-<yyyy-mm-dd>.pdf",
    format: "A4",
    print_background: true
  }
})
```

Give the user the returned `url` and note that it expires shortly. If the call fails —
the MCP connection is unavailable or the tool isn't exposed on this surface — fall through
to the file sink and say PDF export wasn't available. Don't retry it.

### 3. File — filesystem fallback

`Write` the document to `meeting-brief-<company>-<yyyy-mm-dd>.html` and tell the user the
path. This skill has no `Bash`, so it cannot open a browser itself.

### If no sink is available

**Never paste the brief into the chat as prose or markdown.** The brief is a rendered
one-page document; retyping it as a wall of text is not a degraded version of it, it is a
different and much worse thing, and it defeats the point of the skill.

This should be rare: almost every host can render an HTML artifact, and where one can't, PDF
export usually works. Before concluding you have no sink, confirm you actually checked for a
**native** artifact capability and not only `mcp__cowork__*` — that mistake is what produces a
prose dump on a host that could have rendered the brief perfectly well.

If a native artifact, the Cowork tools, PDF export and `Write` are all genuinely unavailable,
stop and say so in two lines: name what you tried, and offer to answer specific questions
about the meeting conversationally instead. Do not silently substitute a text dump.

Otherwise **at least one sink must succeed** — never fail the brief because a single
delivery path is missing.

## Step 7 — Close

Keep it to a couple of lines. If the artifact rendered, the user is already looking at
it — don't restate its contents. Lead with the single most important thing they should
walk in knowing, and offer the PDF if you haven't already produced one.
