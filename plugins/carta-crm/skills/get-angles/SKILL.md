---
name: get-angles
description: >
  Finds the best warm introduction path into a target company through the user's network, and
  then sets the introduction up. Use this skill when the user says things like "find intro
  angles into [company]", "how can I get introduced to [company]", "who do I know at
  [company]", "warm intro to [company]", "find connections at [company]", "how do I reach
  [company]", or "/get-angles". Input: a company name or domain. Output: a ranked route map,
  a drafted intro request, and the follow-through actions.
allowed-tools:
  - mcp__carta__crm_call_tool
  - Artifact
  - mcp__claude_ai_Gmail__create_draft
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
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

## Overview

The user wants into a company they have no relationship with. Answer the question they
actually have — **what is my single best way in, and can you set it up?** — not "here are
eleven people who share an employer with someone there."

Three things make that answer useful:

1. **Check our own side first.** A colleague already in conversation with the target changes
   who to ask, and asking a near-stranger for an intro into an account your own firm is
   working is the embarrassing outcome this step exists to prevent.
2. **Rank by whether the route can actually be walked**, not by how senior the target is.
3. **Finish the job** — draft the ask, then create the draft, log it, and hand off.

## Voice

Never narrate the machinery. No tool names, no "let me call", no mention of this skill, the
artifact, or the template. Progress lines belong in the user's world: "Checking who you know
at Tunic Pay…", not "Calling get_company_angles".

**No emoji** — not in the artifact, the chat, or the drafted message. Status is carried by
words and colour.

**Never invent a person, a title, an employer or a date.** Every name on the route map comes
from a tool response. A confidently wrong intro path costs the user a real relationship.

## Fetch plan — one wave, then one conditional top-up

Every CRM call returns in roughly a quarter of a second, so the cost here is round trips, not
the CRM. Once you have a domain, issue these **in a single turn, in parallel**:

- `crm:get_company_angles` — the paths
- `crm:list_interactions_by_domain` — our firm's own history with the domain
- `crm:get_current_user` — the acting user's name, email and org

```
crm_call_tool({ "name": "crm:get_company_angles", "arguments": { "domain": "<domain>" } })
crm_call_tool({ "name": "crm:list_interactions_by_domain", "arguments": { "domain": "<domain>" } })
crm_call_tool({ "name": "crm:get_current_user", "arguments": {} })
```

`get_current_user` is **not optional**. Without it you cannot tell whether the user is
themselves a connector, you cannot tell whose interactions are ours, and its `organization` is
the firm name on the left-hand card.

Then **one top-up wave for the recommended route only**, in parallel:

```
crm_call_tool({ "name": "crm:fetch_contact_by_id", "arguments": { "id": "<connector_contact_id>" } })
crm_call_tool({ "name": "crm:fetch_company_by_domain", "arguments": { "domain": "<target_domain>" } })
```

`fetch_contact_by_id` carries what the angles payload does not: `activeCompany` — the
connector's current employer, which is the text on their card head — plus `jobs[]` and
`photo_url`. `fetch_company_by_domain` returns the target company's `image`, the logo.

**Call it for the connector only.** A second call for the target would buy nothing beyond their
photograph, which the angles payload already carries in `targetEmployees[].photoUrl`.
`fetch_contact_by_id` also renders a full-height card in the transcript, so a second one is a
visible cost for an invisible gain.

**Where the connector's photo comes from.** The field has two names and the angles one is
usually empty: `contacts[].photoUrl` comes off a light projection where `photo_url` is optional
and frequently absent, while the record from `fetch_contact_by_id` is where the picture actually
is. So take **`photo_url`** (snake_case) from that record, and fall back to `photoUrl`
(camelCase) from the angles payload only when it is empty.

Image URLs go into DATA exactly as the tool returned them. Whether they then display depends on
the viewer, not on this skill -- see **Pictures** under Step 5.

**A third wave is allowed for one thing only:** naming the colleague who actually holds the
relationship, which is the whole point of the left-hand card.

```
crm_call_tool({ "name": "crm:find_company", "arguments": { "name": "<connector_active_company>" } })
crm_call_tool({ "name": "crm:get_company_relations", "arguments": { "id": "<that_company_id>" } })
```

`get_company_relations` returns one row per participant with `userName` — the resolved name of
our person — plus a `strength` bucket (`LOW`/`MEDIUM`/`HIGH`) and `startDate`. Take the row
whose `contact.email` matches the connector; the highest-`strength` row is the strongest link.

**Cap: one attempt at each of those two calls.** If `find_company` does not resolve the
employer, or no relation row matches the connector, **omit the flag and make the acting user
the sender** — do not retry with the name reworded, do not fall back to `search_contacts` or
`search_people` to hunt for it, and do not guess which colleague it is. A wrong name here sends
the user to the wrong person.

Never call `crm:search_people` or `crm:enrich_person` in this skill. Both are open-world
enrichment calls that cost money per lookup, and neither adds anything the map shows.

## Step 0 — Artifact preflight + Carta connector name

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-0-artifact.md` and run **Gate A + Gate B**.
This is a live artifact — the rendered route map calls Carta at runtime via
`claude.use("mcp")`, which needs both the `Artifact` tool and a Carta connector.

**Gate B discovery:** connectors appear as `mcp__claude_ai_<connector>__<tool>`. Find
the one exposing `crm:get_company_angles` / `crm:list_interactions_by_domain` and store
its display name as `CARTA_MCP_SERVER`. Do not substitute a UUID.

**Gate B probe:** call `welcome` then `get_current_user` via your prefixed tool names
(`mcp__<prefix>__welcome`). If either errors, report what it returned and stop.

## Step 1 — Resolve the domain

**Never guess a domain.** Every route you find for the wrong company is wasted, and the user
cannot tell it happened.

- The user gave a domain (`stripe.com`) — use it as-is.
- The user gave a name — call `crm:find_company`:

```
crm_call_tool({ "name": "crm:find_company", "arguments": { "name": "<company name>" } })
```

One confident match proceeds. **Several plausible matches go to `AskUserQuestion`** — do not
silently take the first result, which is how a `.co.uk` company or a similarly-named portfolio
company becomes the wrong target.

**At most 2 resolution attempts.** After the second, stop and ask the user for the domain.
Do **not**:

- re-run the same lookup with the name reworded
- switch to `crm:search_companies` hoping for a hit
- chain names with `OR` in one query — the cap counts queries, not branches
- reach for `WebSearch` or any web lookup
- guess `<company-name>.com`

Each of those looks like a fresh attempt and will burn the cap without adding information.

## Step 2 — Establish our own coverage

Read `list_interactions_by_domain`. Each interaction carries `title`, `type`, `date`, `sender`
and `participants[{ email, name, domain }]` — and **no owner field**. Classify an interaction as
ours by checking whether `sender`'s email domain matches the acting user's email domain from
`get_current_user`, falling back to the `participants[]` domains.

This **reprioritises the routes; it does not suppress them.** An interaction with the company
domain is not an interaction with the target person, and a hit can be a stale thread or a cold
outbound nobody answered.

| What you found | What to do |
|---|---|
| Recent history involving the target person themselves | Lead with that. No intro is needed — say who owns the relationship and offer `/prepare-for-meeting`. |
| Recent history with the domain, other people | Render the coverage banner naming the colleague and the last touch date, and still rank the warm routes below it. |
| Nothing | No banner. Straight to the routes. |

**Interactions that do not belong to our firm must produce no output.** Do not name the other
firm, reference its domain, or mention the interaction in any form. Treat non-ours history
identically to Nothing in the table above.

Match to the target person only when the interaction participants and the target actually
share an email address. When `targetEmployees` carry no email, you cannot make that match —
treat it as domain-level coverage rather than inferring from a name.

## Step 3 — Rank by route quality

Order the headline answer this way:

0. **The user is already a connector.** A path with `pathType: "direct"` means the acting user
   personally worked at the shared employer. The route is `You -> Target` with that employer as
   the hop, and the ask is a direct reach-out, not an intro request. It fills `recommended`
   differently — see **A direct route** under Step 5.
1. A colleague of ours with live, target-matched history (Step 2).
2. Warm routes, tiered below.

**Tiers — a route you can walk beats a grander one you cannot:**

| Tier | Condition | Label in the artifact |
|---|---|---|
| A | `pathType: "contact"`, tenure overlap, **and** interaction history in the CRM | `Strong route` |
| B | `pathType: "contact"`, tenure overlap, connector thin or absent in the CRM | `Likely route` |
| C | No tenure overlap; or `pathType: "colleague"` (enrichment-sourced — no direct CRM relationship) | `Weak route` |

`pathType: "colleague"` means the connector was surfaced from Carta's enrichment data and has no
direct CRM relationship with the acting user. They have no email in the CRM, so **no Gmail draft
action is available** (Step 6). The route is still worth showing — it widens the search — but cap
it at Tier C regardless of tenure overlap, and make clear in Step 7 that this is a weaker path
requiring the user to track down their own contact details outside the CRM.

Tier C means they may never have met. Say so rather than dressing it up.

**Within a tier**, sort by target seniority: CEO / Founder / President / MD, then C-suite, then
Chief of Staff, then VP / Partner / Director, then Head of, then everyone else. Use `bestPathScore`
only as a tiebreaker inside one seniority band — the server returns `targetEmployees[]` pre-sorted
by `bestPathScore` desc, which is the per-person score; `score` is the per-path field on `paths[]`
and is already sorted by the server. Seniority never promotes a route across tiers.

**Group and dedupe.** One entry per `(target person, shared employer)` — count the connectors
and name the top 1–2 rather than listing pairs. Then dedupe across routes: if the same person
connects to three targets, they are one ask, so say that once instead of offering three
options that are all the same conversation. Show at most **4 routes total** — one recommended
plus 3 alternates.

**If every route is Tier C, or `paths` is empty:** say so in two lines and stop. Do not pad
the map with strangers who happen to share an employer.

## Step 4 — Draft the ask

Write the message the user would otherwise have to write. It goes to the **connector**, not
the target, and it holds four things: the shared employer that makes the ask reasonable, what
we want, a forwardable line about why the target should care, and an easy out.

Keep it short enough to read on a phone. Two guards:

- Every fact about the target comes from a tool response.
- No internal markers, tool names, tier labels or scores in a message a human will read.

For a direct reach-out (Step 3, case 0) the message goes to the target instead, and it opens
on the shared employer rather than on an ask for an introduction.

## Step 5 — Render the route map

**Copy the artifact, do not retype it.** Re-emitting it from memory drifts the CSS between
runs, and the guards go first — the `overflow-wrap: anywhere` that stops a long job title
breaking the diagram, and the `textContent`-only rule below.

```
cp "${CLAUDE_PLUGIN_ROOT}/skills/get-angles/assets/route-map.html" <working-path>
```

Then make **one** `Edit`: replace the example `const DATA = {...}` object with the real one.
Everything else in the file stays byte-identical. Where there is no filesystem, `Read` the
asset and reproduce it verbatim from `<!doctype html>` onward, including the whole `<style>`
block — if you find yourself composing CSS, you have already gone wrong.

Always reference the asset through `${CLAUDE_PLUGIN_ROOT}`; a bare relative path resolves
against the user's working directory.

The `DATA` shape is documented by the example in the file. Rules for filling it:

- `coverage` — omit entirely when Step 2 found nothing. An empty banner reads as broken.
- `ourFirm` — `get_current_user.organization`. Our firm is the tenant rather than a CRM company
  record, so it has no logo; its card head takes the lettermark and that is correct.
- `recommended.sender` — the colleague who should send the ask: `{ name, flag }`, where `name`
  is the `userName` from `get_company_relations` and `flag` is `"Strongest link"`. When the
  third wave did not resolve, this is the acting user instead: `{ name, role: "You" }` with no
  flag. **`role` is only ever the literal `"You"`.** See the omissions list below.
- `recommended.you` — the acting user, and only when they are *not* the sender. Omit otherwise;
  a card that repeats the person above it reads as a bug.
- `recommended.connector` — `{ name, title, email, photoUrl, companyName, companyLogoUrl, location, lists, relationStrength, addedBy }`.
  `title` and `photoUrl` from the angles payload, `companyName` from `activeCompany`,
  `companyLogoUrl` from that company's `image` only if it resolved, `email` from
  `email_detail.email` on the contact record. Any of them may be null — but without `email`
  there is no Gmail action (Step 6).

  Four context fields answer the natural question "who is this person and do I trust this
  route?" — populate them from the same calls already in flight, without any extra round trips:

  - `location` — `city`, `location`, or `country` from the `fetch_contact_by_id` record.
    Null if the CRM holds none. Answers "Australia or London?".
  - `lists` — array of CRM list names from `lists` or `tags` on the contact record. Null or
    `[]` if absent. Answers "is this person a portfolio CEO or an HR recruiter?".
  - `relationStrength` — `"HIGH"` / `"MEDIUM"` / `"LOW"` from the matching row in the
    `get_company_relations` response (the row whose `contact.email` matches the connector).
    This is already fetched in wave 3; copy the `strength` field from that row. Null if wave
    3 did not run. Shown in the "Ask for intro" gutter as "Strong link" / "Medium link" /
    "Light link" so the user can judge the quality of the route at a glance.
  - `addedBy` — the `createdBy` or `addedBy` display name from the `fetch_contact_by_id`
    record, if the CRM exposes it. Null otherwise. Answers "who saved this contact?" —
    critical when the person who added them has since left the firm. **Do not guess, do not
    look it up with a separate call; null is the correct value when the field is absent.**

### A direct route

When the recommended path is `pathType: "direct"` (Step 3, case 0), set
`recommended.pathKind: "direct"` and leave `connector` out. The board drops to three columns —
you, the shared employer, the target — and the middle hop reads `Reach out directly` instead of
`Ask for intro`.

- `sender` is the acting user: `{ name, role: "You" }`. There is no colleague to route through,
  so no `flag`, and **omit `you`** — it would repeat the card beside it.
- `employer` / `overlapYears` / `employerLogoUrl` / `target` / `targetLogoUrl` are filled exactly
  as below.
- The second wave's `fetch_contact_by_id` has nothing to fetch and the third wave does not run:
  both exist to resolve a connector.

**Never invent a connector to fill the five-column shape.** A direct route has none, and the
board draws without one.

**Pictures: pass every URL through verbatim.** `contacts[].photoUrl`,
`targetEmployees[].photoUrl` and a company's `image` are usually populated; the example DATA
ships them as `null` only so the file renders standalone, **not** because null is the normal
state. Copy whatever string the tool returned -- do not rewrite, re-encode or shorten it, and
never build one from a domain name. The artifact handles the awkward stored shapes itself,
including ImageKit paths that wrap an encoded inner URL.

Whether a picture then appears is the viewer's decision, not this skill's:

- Delivered with `Write`, the file opens in a real browser and every picture loads.
- In an artifact panel, external images are subject to the host's content policy and the
  organisation's network egress settings. Where they are not permitted the board shows initials
  and lettermarks instead, which is a designed fallback and not a failure.

**If pictures do not appear in the panel and someone wants them to**, the artifact has already
written the answer to the browser console: one line naming any field that arrived empty, and one
line per URL that failed to load, with the URL in it. The hosts in those lines are the ones to
add to the organisation's allowlist. Read them off the console rather than guessing -- which
hosts the CRM serves images from varies by tenant, by how the contact was enriched, and by
whether the record was uploaded or matched from an external source. This is an organisation-level
setting, so it is an administrator request; do not send anyone to edit their own settings file.

Do **not** read only the angles payload's `photoUrl` — prefer the contact record's `photo_url`,
per the two-step above. Never build a URL from a domain name. Null is correct in exactly two
places: our own people (no photo in the CRM), and a company that did not resolve to a CRM
record.

Where a picture is missing the board falls back to initials or a lettermark, and the artifact
writes a line to the browser console naming the empty fields.
- `recommended.employer` / `overlapYears` — `paths[].sharedEmployer`, and the **calendar years**
  the two tenures overlap, from `contactTenure` / `targetTenure` (`"2017 - 2019"`, or
  `"2019 - Now"` when neither side has left). Omit `overlapYears` when either tenure has no
  dates, or when `tenuresOverlap` is false — the artifact then says so itself.
- `alternates` — at most 3, already grouped and deduped.
- `draft` — the message from Step 4.
- `actions` — see Step 6. Omit any action you are not offering.

### What the CRM does not carry — leave these out

The board shows only what a tool returned. Three things it deliberately does not show, because
no MCP tool exposes them today:

- **A job title for anyone on our own side.** Relations resolve our people to a display name
  only; the organisation's own role field never reaches the API. Never write a title, function
  or team under our colleague's name — not from a signature, not from an email address, not
  inferred from the deal. Their card carries the name and the flag, nothing else.
- **Shared employment between our person and the connector.** The angles graph only computes
  the connector-to-target edge. The left-hand hop is `Ask for intro` and nothing more.
- **A company-wide interaction rollup.** You can resolve the last interaction with a *person*,
  so the banner names that person ("emailed Tom Reid 12 days ago"), never the company.

When the data lands, the fields above are the seams to fill — do not fake them in the meantime.

Do not restyle the file. Its colours are Ink semantic tokens carrying both light and dark
values, and the host controls which resolves. Three things not to "fix":

- **Do not add a Google Fonts or `rsms.me` link.** The artifact sandbox blocks external
  fetches, so a linked face silently falls back and the file stops being self-contained. The
  title resolving to Georgia is intended. Measured, not assumed: in the panel external images
  were refused too — `https://randomuser.me/...`, `https://img.logo.dev/...` — while the same
  URLs load in the CRM's own MCP-App views, which declare their hosts under
  `_meta.ui.csp.resourceDomains`. An artifact has no way to declare them, so whether a picture
  loads is settled by the host and the organisation's egress policy. Fetching the bytes to
  inline them was tried and does not help: the same egress policy blocks the fetch.
- **Do not switch to `@media (prefers-color-scheme)`.** Dark mode runs through `light-dark()`;
  the host sets the scheme.
- **Do not use `localStorage`.** The sandbox throws on web storage. State stays in memory.

**Build DOM with `textContent`.** Connector names, titles and employer names are untrusted
tenant data, and this document executes JavaScript — assigning markup built from those strings
is an XSS sink, not a styling shortcut.

Deliver it with whichever sink the host offers, in this order, and **try each once**:

1. **`Artifact`** — the primary sink. Write the populated file to the scratchpad, then publish:
   ```
   Artifact({
     file_path: "<scratchpad-path>",
     title: "Warm introductions — <Company>",
     favicon: "🗺️",
     capabilities: {
       mcp: { servers: [{ server: "claude_ai_Gmail", tools: ["create_draft"] }] }
     }
   })
   ```
   The `capabilities.mcp` grant is what lets the in-panel action buttons call Gmail; omit it
   and the buttons will not fire. For update-in-place, call `Artifact({ action: "list" })`
   first, find the entry whose title matches, and pass its `url` to the call.
2. **`Write`** the file and name the path. It stays fully interactive in a browser.
   Omit `DATA.actions` — in-panel buttons cannot run outside an artifact.

A failed render counts as no render: move to the next sink rather than re-rendering the same
one.

### If no sink is available

**Never paste the route map into the chat as prose, markdown, or ASCII art.** A wall of text
is not a degraded version of a diagram; it is a different and much worse thing, and it defeats
the point of the skill. There is no chat-text fallback for the map.

This should be rare — almost every host renders an HTML artifact, and where none does, `Write`
succeeds. Before concluding you have no sink, confirm you tried the `Artifact` tool and not
only `Write`; that mistake is what produces a text dump on a host that would have rendered the
map perfectly well.

If `Artifact` and `Write` are both genuinely unavailable, stop and say so in two lines: name
the single best route in one sentence, give the drafted message, and offer to answer questions
about the alternates conversationally. Do not substitute a hand-drawn diagram.

## Step 6 — Take care of it

The map shows the route; this is where the introduction actually happens. Offer these as a
numbered list with one marked `<- recommended`, via `AskUserQuestion`. Never fire one silently.

1. **Create the email draft** — `mcp__claude_ai_Gmail__create_draft` to the connector.
   **Draft only, never send.** This is an email to a real colleague and the user has not read
   it yet. If no mail connector is available in this session, skip this option without
   announcing its absence; the message is already in the artifact with a copy button.
   **Skip this option entirely for `colleague`-typed routes** — enrichment contacts have no CRM
   email address, so there is nothing to send to.

   **Fill `args` — an empty one drafts a blank email.** The in-panel button calls
   `callMcp(action.tool, action.args || {})` and passes nothing else, so the message in
   `DATA.draft` reaches Gmail only if it is also in `args`:

   ```
   args: {
     to: [ "<connector_email>" ],
     subject: "<same string as DATA.draft.subject>",
     body: "<same string as DATA.draft.body>"
   }
   ```

   `to` is an **array of bare addresses**. The tool rejects `"Name <addr>"`, and
   `DATA.draft.to` is a display name rather than an address — take the address from the
   connector's `email_detail.email` on their `fetch_contact_by_id` record, or `contact.email`
   on the relation row.

   **On a direct route the recipient is the target, not the connector** (Step 4). Their address
   is `targetEmployees[].email` where the CRM holds one, and often it holds none — that is the
   usual outcome, not a fault. Do not substitute the connector's address to have somewhere to
   send it, and do not go looking for the target's address with `search_people` or
   `enrich_person`. **No address, no action:** drop this option rather than offering a
   button that drafts to nobody. Keep `subject` and `body` byte-identical to `DATA.draft` —
   they are the same message, and a reader comparing the panel to their drafts folder should
   find no difference.
2. **Log the outreach on the deal** so the pipeline reflects that an intro was requested.
   Notes are deal comments, and `comment` **replaces** the existing text rather than appending:

   ```
   crm_call_tool({ "name": "crm:fetch_deal_by_deal_id", "arguments": { "id": "<deal_id>" } })
   crm_call_tool({ "name": "crm:update_deal", "arguments": { "id": "<deal_id>", "comment": "<merged text>" } })
   ```

   Read first, append to what is there, show the merged text, and only write once the user
   confirms. Skipping the read destroys whatever the deal already held. Where there is no
   deal for this company, skip this option — do not create one to have somewhere to log.
3. **Add the target to the CRM** — `crm:create_contact`, confirmed, only when they are not
   already there and only for the recommended route's target.
4. **Hand off** — offer `/prepare-for-meeting` for once the intro lands.

**When `Artifact` was used**, put actions in `DATA.actions`; the `capabilities.mcp` grant from
the publish call is what lets the in-panel buttons fire. The artifact renders them only where
the bridge exists and confirms in-panel before writing.
On `Write` or any other sink, omit `DATA.actions` — a button that cannot fire is worse than no
button — and run the list above in the chat instead.

## Step 7 — Close

Two lines. The user is looking at the map, so do not restate it. Name the one action you would
take — who to ask, for whom — and stop.
