---
name: prepare-for-meeting
description: >
  Builds a one-page tear sheet for the next upcoming meeting with a counterparty. Every
  fact about the people, the firm and the deals comes from the CRM. The one exception is a
  single line about the venue, written only when the invite names a place. Use this skill
  when the user says things like "prepare me for my meeting",
  "meeting brief", "brief me for this meeting", "prep for upcoming meeting", "what do I
  need to know before my call with [company]", or "/prepare-for-meeting". Compiles the
  invitees and their interaction history, the organization's notes and relationship
  status, and related deal, investor, fundraising or company context. Briefs exactly one
  meeting — the next one; not an agenda view.
allowed-tools:
  # No list_connectors: the brief is a static page, so it addresses no connector at
  # runtime and has no name to resolve. The call renders a connector card with a
  # Reconnect button per connector, which is a visible cost for nothing.
  - mcp__carta__crm_call_tool
  # WebSearch has one use: the venue line in Step 4b, after the meeting is already
  # resolved. It never resolves a meeting, a company or a person. The CRM does that.
  - WebSearch
  - Artifact
  - AskUserQuestion
  - Bash(cp "${CLAUDE_PLUGIN_ROOT}/skills/prepare-for-meeting/assets/brief-template.html" *)
  - Read
  - Edit
  - Write
version: 1.0.0
model: inherit
---

<!-- carta:plugin-version -->
<carta-plugin>carta-crm:1.14.2</carta-plugin>

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

**Never describe your own search.** The searches you ran, the records you opened, the
lookups that returned nothing and the conclusion you drew from them are all machinery. They
belong in neither the brief nor the chat. A line like "That deal result is unrelated, so no
deal record exists for this company. I have enough to write the brief" is reasoning left on
the page. State the finding, never the hunt for it.

Progress lines are welcome, but phrase them in the user's world:

| Don't say | Say |
|---|---|
| "Now let me look at the template and gather CRM data." | "Pulling your history with DataStream AI…" |
| "I'll fill in the sections and render the HTML." | *(say nothing — just produce the brief)* |
| "Calling get_adviser_profile…" | "Checking who covers this account…" |
| "That search returned nothing, so I have enough to write the brief." | *(say nothing about the search)* |

Lead with the meeting, not the process. No "let me…" preamble about your own steps.

Two more rules that keep this fast and honest:

- **Never invent CRM data.** If a field isn't in the CRM, leave it out. A confidently
  wrong brief is worse than a thin one.
- **Prefer `crm:get_adviser_profile` over hand-assembling context.** One call returns the
  company, top contacts with interaction counts, active deals, the next scheduled
  interaction and recent notes. Don't rebuild that from ten calls.

## Substance: what earns a place on the page

The brief prepares the reader for the meeting. Every line must help them in the room. Seven
rules decide what stays.

1. **Address the reader as "you".** Never write the reader's name. Never tell the reader to
   confirm something with themselves, with the meeting owner or with the organizer when that
   person is the reader. The reader booked the meeting, so "confirm the agenda with the
   meeting owner" tells them to talk to themselves.
2. **Give no CRM housekeeping.** Never tell the reader to log, record or capture anything in
   the CRM. Never ask the reader to create a company record or a contact record. Never
   suggest taking notes. The brief prepares the meeting. It does not hand out chores.
3. **Every line must be about these people.** Cut any line that would fit any other meeting.
   "Listen carefully and build rapport" is filler. If you cannot tie a line to this
   counterparty, this deal or this history, it does not go on the page.
4. **State an absence at most once.** Say once that the CRM holds nothing on the
   counterparty. Never say it a second time further down the page. An item that repeats
   the opening is redundant and costs a line the reader needs.
5. **An empty CRM is the last answer, not the first.** Report an empty CRM only when the CRM
   record, the external company profile and the interaction history are all empty. Read
   `companyProfile`, `externalProfile`, `crm:preview_company` and `recentInteractions`
   before you conclude there is nothing. Two emails with the domain and a profile of what the company does are a
   brief. "Zero contacts, zero deals and zero notes" is a count the reader already knows.
6. **Budget 3 to 5 items, each under 45 words.** An item is whatever the page carries to
   brief the reader. Fewer than three means you stopped researching too early. More than
   five means the reader has to triage the brief.
7. **Never describe your own search.** See Voice above.

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
- `crm:get_tenant_custom_instructions` — the reader's own standing preferences (Step 4a)

**Wave 2** — the playbook's own calls (Step 4) plus whatever Wave 1 left genuinely
missing, again in parallel:

- `crm:search_contacts` for external attendees who did **not** appear in `topContacts`
- `crm:get_company_angles`
- `crm:preview_company` when neither the CRM record nor `externalProfile` says what the
  counterparty does
- `crm:list_interactions_by_domain` when `recentInteractions.count` is larger than the
  number of items the profile returned
- one `WebSearch` for the venue (Step 4b), and only when the event carries a `location`

Never serialise these. Two waves is the target; more than three means something is being
fetched that the brief cannot show.

## Step 0 — Checks before building

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — the plugin's own
`references/` directory, not this skill's. Read it by that exact path; don't search for it.
Stay quiet about the check when it passes.

That is the only check this skill needs. **The brief is a static page** — it is rendered from
data gathered here and makes no MCP calls once published (Step 6 passes no `capabilities`),
so there is no connector for the page to address and
`gate-carta-connector-name.md` does not apply.

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

Each interaction is `{title, type, date, sender, participants[{email, name, domain}]}`,
plus `location` when the invite named one. `sender` is the organizer. There is no end
time, meeting type, or RSVP status in this payload — omit those fields rather than
guessing at them.

`location` is the invite's own text, so it is whatever the organizer typed: a full street
address, a restaurant name, a room name, or a video link. The key is absent when the
invite named no place, and an absent key is the one honest signal that there is no venue
to write about. Step 4b is the only place it is used.

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
adding information. `WebSearch` answers one question in this skill, the venue in Step 4b.
The web cannot say whether the CRM holds a meeting.

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

Three fields on the same response carry most of the substance:

- **`companyProfile`** holds the CRM company record's own `description`, `industry`,
  `location`, `website`, `founded` and `employeeCount`. It is the tenant's own copy, so read
  it first. Most company records carry a description, so this is usually where the answer
  is. The field is null when the record holds none of these.
- **`externalProfile`** says what the company does, from the external data provider. It comes
  back when `companyProfile` carries no description, so treat it as the fallback rather than
  the first source.
- **`recentInteractions: { count, items }`** holds the 5 most recent past emails and meetings
  with anyone at the domain, across the whole organization. `items` holds the subject, the
  date and the people. Read them. Two emails already exchanged with the domain tell the
  reader more than any count of CRM objects. When `count` is larger than the number of
  items, read the rest with `crm:list_interactions_by_domain`.

**Say what the counterparty does.** Take the description from `companyProfile` first, then
`externalProfile`. Only when neither describes the business, call `crm:preview_company`,
which returns the name, industry, location, employee count, funding and description. A
reader who walks in knowing what the company sells is prepared. A reader who walks in
knowing the CRM row count is not.

Top up only what came back thin, and **stop at 3 enrichment calls**. Ask for no more than
the brief can show: the history list displays 4 entries, so `limit: 6` is ample — pulling 50
costs tokens on rows nobody sees.

- `crm:get_company_angles` — warm paths. Nothing else returns these.
- `crm:preview_company`: what the company does, when neither `companyProfile` nor
  `externalProfile` says. This call takes priority over the rest of this list on a thin
  domain: it is the difference between a brief and a row count.
- `crm:list_interactions_by_domain`: the interactions beyond the 5 in
  `recentInteractions.items`, when `count` says there are more.
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

## Step 4 — Pick the playbook

A meeting with an LP and a meeting with a banker need different pages. Pick one of four
playbooks from the counterparty, and let it decide both what Wave 2 fetches and what the
brief leads with.

**Precedence — take the first that applies.** Stop at the first hit; do not score them
against each other.

| # | Playbook | It applies when |
|---|---|---|
| 1 | Whatever the user named | The request says "investor meeting", "banker call", "meeting the founder" |
| 2 | **Adviser** — M&A banker, adviser, broker | `get_adviser_profile` returned `company.adviserViewEnabled: true`, **or** any fee is linked to this company or its contacts |
| 3 | **Investor** — LP, fund investor | `crm:search_investors` resolves the counterparty, **or** it holds a fundraising relationship |
| 4 | **Founder** — a target or portfolio company | The counterparty resolves to a company record and an attendee's title reads founder, co-founder, CEO or owner |
| 5 | **Other** | None of the above. A first contact, a service provider, an internal-ish catch-up |

The masthead context tag names the playbook you chose (`ADVISER · M&A`, `INVESTOR · LP`,
`FOUNDER · SERIES B`, or the deal context for Other). Printing it is what lets the reader
see a wrong call and correct you in one line, so never omit it.

Each playbook adds its own Wave 2 calls and its own scenario block. The people and deals
blocks are the same in all four.

**Adviser** — what we have paid them and what we have run with them.

- `crm:get_fees_by_contact` for the attendees you resolved, or `crm:search_fees` filtered
  to the company. Read `totalAmount` from the response; never add the rows up yourself.
- `crm:search_deals` for live **and** closed mandates, so the brief can say sell-side or
  buy-side and name what is running now.
- Scenario block: fees paid to date, the mandates behind them, and any live process.

**Investor** — what they committed to and what they asked for.

- `crm:get_investor_interactions` for the relationship timeline.
- `crm:get_fundraising` or `crm:search_fundraising` for the vehicle they are in, and
  `crm:get_fund_closings_status` when a close is in flight.
- Scenario block: commitment, vehicle and closing status, plus the open question from the
  most recent note.

**Founder** — who the company is and how far along it is.

- `companyProfile` from `get_adviser_profile` for what the business actually does. It is
  the tenant's own record and Wave 1 already has it. Fall back to `crm:preview_company`
  or `crm:find_company` only when that field and `externalProfile` are both empty.
- `crm:get_company_angles` for warm paths in. Its argument is `domain`.
- Scenario block: round, stage and maturity signals, with the last note's substance.

**Other** — no scenario block. The three context paragraphs, the people, and any deals.

### Step 4a — The reader's own preferences

`crm:get_tenant_custom_instructions` returns `{ content }`: free text an admin set for the
tenant and the reader set for themselves. If it holds a `## Meeting prep` section, follow
that section for this brief.

It **reorders and re-weights** — which block leads, what earns a paragraph, what to always
mention. A reader who writes "for banker meetings show deals and fees first" gets the
scenario block above the people block.

It **never authorises an invented fact**. A preference cannot conjure a fee the CRM does
not hold. When the preference asks for something absent, leave it out silently; do not
write a line saying the CRM lacks it.

No `## Meeting prep` section, or no content at all, is the normal case. Say nothing and
use the playbook as written.

### Step 4b — The venue, when the invite names one

A reader who knows the place walks in better prepared. This is the one line on the page
that does not come from the CRM, so it is fenced tightly.

**The gate is the event's `location` field.** Read it from the meeting you resolved in
Step 1: `futureInteractions[0].location`, or `nextScheduledInteraction.location` on
`get_adviser_profile`. **No `location` key means no venue line.** Delete
`SECTION: venue` and say nothing about it, in the brief or in the chat. Never infer a
place from a company's address, a contact's city, or the meeting title.

**A video link is not a venue.** A `location` that is a Zoom, Meet, Teams or Webex URL,
or any bare URL, names no place to walk into. Treat it exactly like an absent field:
delete the section. The reader already has the link in their own calendar.

**One `WebSearch`, one line.** Search the place as it is written, with the city when the
`location` carries one. Write a single sentence: what the place is, and the one thing
worth knowing before walking in, such as the kind of food, the dress code, or how long a
table usually takes. Stop at one search. A second search is a research project, and the
reader has two minutes.

**Say nothing you did not find.** An address that returns nothing recognisable gets no
line. A room name in your own building gets no line. Half a fact is worse than silence
here, because every other line on the page is CRM truth and this one rides on that trust.
The label on the block says the line is not CRM data, so keep it.

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
- **Every item on the page passes the Substance rules above.**
- **Escape every value you interpolate.** CRM field values are untrusted — a tenant's
  tag, dropdown option, note body or company name can contain arbitrary text. Convert
  `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`. Never drop a raw CRM value
  into an HTML attribute.
- **One page — item counts AND prose length both matter.** The limits below are measured
  against A4, but they are a ceiling on *count*, not a guarantee: a brief inside every limit
  still spills to a second page if the entries are wordy. Cut ruthlessly — three sharp
  sentences beat ten hedged ones.

  | Section | Max |
  |---|---|
  | Context — paragraphs | 3, each ~45 words |
  | Venue — lines | 1, ~25 words |
  | Scenario — rows | 4 |
  | People — external attendees | 4 |
  | People — internal attendees | 3 |
  | Deals | 3 |

  Format rules the layout depends on:

  - **The context block is three paragraphs, in this order.** They answer the three
    questions a reader has walking in, and they are prose, not labelled fragments.
    1. **Your history with these people** — what has actually passed between you. The last
       exchange and its substance, what is outstanding, what was promised. "Guy asked for
       the revised fee schedule on 27 Aug and it has not gone out" beats "4 interactions".
    2. **Who you are meeting** — the person. Their role, how long they have been the
       contact, what they have handled for you before.
    3. **Their firm** — what it is and what it does, at the level a stranger needs.
    Drop a paragraph whose data you do not have rather than padding it. One honest
    paragraph is a brief; three hedged ones are noise.
  - **No severity labels anywhere.** No `High`, `Watch`, `Note` or `Strength` prefixes, and
    no badge substitutes such as `Risk:` or `FYI:`. If something matters, the sentence says
    why it matters. A label is what the reader has to decode instead of reading.
  - **The venue line is one sentence, and only with a `location` on the event.** Keep its
    label, which marks it as the one line on the page that is not CRM data. It sits
    outside the 3-to-5 item budget: it is colour around the meeting, so it neither counts
    towards that budget nor excuses a thin brief. Delete `SECTION: venue` when the invite
    named no place, when it named only a video link, and when the search found nothing.
  - **The scenario block is the playbook's own facts**, at most 4 rows, each a figure or a
    short phrase with its label. Fees paid, commitment and closing status, round and stage.
    Delete the whole section for the Other playbook, or whenever the calls came back empty.
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
Use the `Artifact` tool — it works in every host and supports update-in-place:

```
Artifact({
  file_path: "<scratchpad-path>",
  title: "Meeting Brief — <Company> — <date>",
  favicon: "📋"
})
```

**Do not pass `capabilities`** — this brief makes no MCP calls at runtime.

For update-in-place, call `Artifact({ action: "list", scope: "mine" })` first, find the entry
whose title matches, and pass its `url` to the call. `scope: "mine"` matters: a title match
against an artifact someone shared with you cannot be updated, and publishing without a `url`
silently creates a second brief instead. Build the title as `Meeting Brief — <Company> — <yyyy-mm-dd>`
from the meeting date — per-meeting titles mean successive briefs don't overwrite each other,
while re-briefing the same meeting updates in place.

**Never skip to PDF** — the `Artifact` tool covers every host; PDF is for when `Artifact`
genuinely fails or the user wants a portable copy.

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
export usually works. Before concluding you have no sink, confirm you tried the `Artifact` tool
and not only `Write` — that mistake is what produces a prose dump on a host that could have
rendered the brief perfectly well.

If the `Artifact` tool, PDF export and `Write` are all genuinely unavailable,
stop and say so in two lines: name what you tried, and offer to answer specific questions
about the meeting conversationally instead. Do not silently substitute a text dump.

Otherwise **at least one sink must succeed** — never fail the brief because a single
delivery path is missing.

## Step 7 — Close

Keep it to a couple of lines. If the artifact rendered, the user is already looking at
it — don't restate its contents. Lead with the single most important thing they should
walk in knowing, and offer the PDF if you haven't already produced one.
