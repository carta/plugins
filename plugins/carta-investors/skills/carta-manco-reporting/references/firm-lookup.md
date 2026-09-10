# Steps 1 and 2 — resolve the firm and its ManCo over MCP (BUILD path)

Reached only when Step 0.2 classified a **MISS**, or `<FORCE_REFRESH>` was set.
A warm or soft cache hit skips both of these steps entirely — see
[firm-resolution.md](firm-resolution.md), which owns Gate 0 and Step 0 and
routes here.

> Steps referenced here that are documented elsewhere: **Gate 0 / Step 0** → [firm-resolution.md](firm-resolution.md); **Step 2.5 / Step 2.75** → [budget-ingest.md](budget-ingest.md); **Step 3** → [data-fetch.md](data-fetch.md).

## Step 1 — Resolve firm via list_contexts (SILENT — BUILD path only)

Reached only when Step 0.2 classified a **MISS**, or `<FORCE_REFRESH>` was
set. A WARM HIT and a soft hit both skip this step and Step 2 entirely —
each already holds the firm and the entity from a previous build, and a
soft hit differs only in that its DATA needs refreshing.

Identify the Carta MCP server by prefix — scan the tools connected in this
session for any `mcp__<SERVER>__list_contexts` (equivalently, `call_tool` /
`set_context` under the same prefix). Most sessions surface one of
`claude_ai_Carta`, `carta_production`, or `carta`, but treat those three as
examples, not the whole set — a connector can be namespaced under any name,
including an opaque generated ID (Claude Desktop exposes Carta as a
claude.ai connector this way instead of a friendly name). Because this scan
runs at the top level of the skill, not inside a dispatched subagent, any
connected name works the same way — there's no closed allowlist to update
by hand when a new connector ID shows up. Use whichever prefix you find as
`<SERVER>` for every tool call in this step and after. Do **not** call
`welcome` to identify the server — it's not needed, and its response
renders as a widget.

If nothing matches, break silence with one plain sentence: *"The Carta Fund
Admin MCP needs to be authorized in this session — run `/mcp` and reconnect
the Carta connector, then re-invoke this skill."* Then stop.

If **two or more** distinct prefixes have connected tools at the same time, don't
silently pick one — ask via a single `AskUserQuestion`, listing the live prefixes as
options:

> "I see more than one Carta MCP connector active right now (`<PREFIX_A>`,
> `<PREFIX_B>`, ...). Which one should this session use?"

Default to `carta` if the user has no strong preference, or if asking would be
disruptive (e.g. no interactive turn is available to wait on). Once resolved — by
answer or by default — use that prefix as `<SERVER>` for every tool call in this step
and after.

**Classify `<CARTA_ENVIRONMENT>` from `<SERVER>`'s name** — served to the
dashboard's Snowplow tracker so nonprod usage isn't misattributed as
production. A name containing `test`/`sandbox`/`demo`/`preprod`/
`preproduction` (case-insensitive) → `"nonprod"`. Everything else — `carta`,
`carta_production`, any other name, or an opaque UUID — → `"production"`
(this is a customer-facing plugin, so an unclassified name is far more
likely production than a staff test session). Carry `<CARTA_ENVIRONMENT>`
to Step 4's build command.

Resolve firm identity via `mcp__<SERVER>__list_contexts`. If `<FIRM_ID_HINT>`
was captured in Step 0.1 (user pasted a firm URL or UUID), call
`list_contexts(firm_id=<FIRM_ID_HINT>)` or `firm_uuid=<...>` for an exact
lookup — skip the fuzzy name path entirely. Otherwise:

Call `mcp__<SERVER>__list_contexts(firm_name="<FIRM_NAME_INPUT>")`. **Important:** the endpoint does fuzzy/relevance matching against the caller's permission set and will return a *fallback* firm even when nothing truly matches the input token — do NOT trust the top hit blindly. Sanity-check every response as follows:

1. **Normalize** `<FIRM_NAME_INPUT>` → `<TOKEN>` (strip whitespace, lowercase, remove punctuation like `-`, `,`, `.`).
2. Compute the same normalization on each returned firm's canonical name → `<CANON>`.
3. A hit is a **clean match** iff `<TOKEN>` is a substring of `<CANON>` OR `<CANON>` is a substring of `<TOKEN>` (either direction, so `"northstar"` matches `"northstarcapital"` and `"north-star capital llc"` matches `"north-star capital"`).
4. If the top result is **not** a clean match, immediately retry with two more casing/spelling variants in a single parallel batch:
   - `list_contexts(firm_name="<original casing>")` (the raw input)
   - `list_contexts(firm_name="<TOKEN with hyphens preserved but capitalization flipped>")` — e.g. `North-Star` → `North-star`
   - `list_contexts(firm_name="<TOKEN with hyphens removed>")` — e.g. `North-star` → `Northstar`
5. Merge the three response sets, dedupe by firm ID, and re-apply the clean-match check.
6. **Narrow out fund/SPV entities sharing the firm's name.** Carta Fund Admin
   onboards each fund and SPV as its own `firm_id` too, and `list_contexts`
   carries no type/kind field to tell those apart from the actual firm —
   confirmed live against sandbox: searching `firm_name="Unusual Ventures"`
   cleanly matches the firm itself *and* eight sibling entities, including
   `"Unusual Ventures Fund III, L.P. for itself and as nominee for Unusual
   Ventures Investment Partners Fund III, L.P."` and `"UNUSUAL VENTURES FUND
   II, L.P."` — a fund/SPV's legal name almost always embeds the parent
   firm's name as a substring, so the clean-match rule in step 3 alone
   cannot separate them. Before classifying, check whether any clean match
   is an **exact** normalized match (`<CANON>` equals `<TOKEN>`, not merely
   a substring of it):
   - **At least one exact match exists** → drop every clean match that is
     not exact. A fund's expanded legal name is never identical to the bare
     firm name a user types, so this reliably clears the fund/SPV noise
     without a name-pattern blacklist (`"L.P."`, `"LLC"`, `"Fund"`, …) that
     could just as easily hide a firm legitimately named e.g. "Acme Capital
     Management, LLC". Classify only the exact-match survivors below.
   - **No candidate is exact** (the typed name is itself a partial/fuzzy
     variant, e.g. `"north-star"` for `"North-Star Capital"`) → keep the
     full clean-match set as-is; narrowing only helps once a true anchor
     exists.

Then classify the narrowed clean-match set:

- **Exactly one clean match** → set `<FIRM_UUID>`, `<FIRM_CARTA_ID>`, `<FIRM_NAME>` (canonical name from the response, not the user's input).
  Proceed to Step 2 without asking: the endpoint only returns firms the
  caller is permissioned for, so one clean match is already unambiguous.
- **Multiple clean matches** → present up to 4 candidates via `AskUserQuestion`, one per option; user picks. If more than 4, take the top 4 and add a fifth "None of these — retype" option.
- **Zero clean matches but non-empty fuzzy results** → do NOT silently accept a fuzzy fallback. Present the top 3 fuzzy results via `AskUserQuestion` with the framing *"No firm exactly matched '<FIRM_NAME_INPUT>' — did you mean one of these?"* plus a "None of these — retype" option. Only proceed once the user picks.
- **Zero results across all variants** → tell the user *"No firm found matching '<FIRM_NAME_INPUT>'. Want to try a different name?"* and re-prompt via `AskUserQuestion`.

Then `mcp__<SERVER>__set_context(firm_id=<FIRM_UUID>)` to activate the firm.


## Step 2 — Resolve ManCo entity (BUILD path only)

**SILENT** apart from the entity question below — no narration of what is being resolved.

Reached in the same cases as Step 1 (a MISS, or `<FORCE_REFRESH>`) — never
on a WARM HIT or a soft hit, both of which already know the entity.

Call `mcp__<SERVER>__call_tool(name="fa__list__entities", arguments={})`.

A firm's entity list is mostly funds. `fa__list__entities` returns
`Fund`, `GP Entity`, `Management Co`, `SPV`, `Elimination Entity` and
`Holding` together, and this dashboard reports on a management company —
so **never offer the raw list**. Funds and SPVs are not answers to this
question, and putting them in a picker invites a choice that produces an
empty dashboard.

Filter to `entity_type_string == "Management Co"` (or
`entity_type_enum == 4`):

- **Exactly one ManCo** → hold it and confirm below.
- **Multiple ManCos** → `AskUserQuestion` over **those ManCos only**.

**Hold the full response** — Step 3 persists it to `<raw_dir>/entities.json`
(raw_dir isn't resolved until Step 2.5). It's the only source of each fund's
own `carta_id`; a JE's own `FUND_CARTA_ID` column doesn't exist.

**Zero ManCos** → fall back to `GP Entity` (`entity_type_enum == 2`).
Some firms book management-company activity on their GP entity and carry
no separate ManCo, and the dashboard reads the same way for either.

- **Exactly one GP entity** → hold it and confirm below.
- **Multiple GP entities** → `AskUserQuestion` over those.
- **Neither** → say so and offer the only move left, rather than stopping
  on a dead end: *"`<FIRM_NAME>` has no management company or GP entity in
  Carta Fund Admin, so there is nothing for this dashboard to report on.
  Want to try a different firm?"* — `AskUserQuestion`, and a yes re-enters
  Step 1.

Set `<MANCO_UUID>`, `<MANCO_CARTA_ID>`, `<MANCO_ENTITY_ID>` and
`<MANCO_NAME>` from whichever entity was resolved.

### Confirm the entity before fetching

Two gates, in order: **the firm, then the entity under it.**

Step 1 is the firm gate and already asks only when it needs to — one
clean match the caller is permissioned for proceeds straight here, since
`list_contexts` matches against the caller's own permission set. Nothing
below re-litigates the firm.

This is the entity gate, and it **always runs on a build** — whether one
entity was found or several. Step 3 is a long fetch, and this is the last
cheap place to catch a wrong entity; a dashboard built on the wrong one is
wrong in every figure, under this skill's own name.

It does **not** run on a warm or soft cache hit. Both reopen an entity a
previous run already confirmed, and re-asking on every reload is the
question that teaches a reader to stop reading questions.

**Exactly one management company** → confirm it:

> **Build the dashboard for `<MANCO_NAME>`?**
> `<FIRM_NAME>` · `<entity type>`

Offer *"Yes, build it"*, *"No — different entity"* (re-open the list for
this firm) and *"No — different firm"* (back to Step 1).

**Several management companies** → the picker is the confirmation:

> **Which management company under `<FIRM_NAME>`?**

One option per ManCo, plus *"None of these — different firm"*.

**Any GP-entity fallback** → always ask, whether one was found or several.
This is a substitution, not a resolution: the reader asked for a management
company and would be shown something else, and that must not pass as a
detail.

> **`<FIRM_NAME>` has no management company in Carta Fund Admin. Build
> your dashboard on its GP entity, `<MANCO_NAME>`?**

Offer *"Yes, build it"* and *"No — pick a different firm"* (back to Step 1).

**Naming the firm.** Firm names are not unique in Carta — one client name
matched four distinct firms in a real run — so `<FIRM_NAME>` alone may not
say which firm this is. Disambiguate with the entity's own
`_links.web_url`, linking the firm name, rather than printing a raw Carta
ID at the reader: an internal identifier is the kind of thing the Carta UX
rules keep out of user-facing copy, and a link answers the same question by
being clickable.

The three ManCo identifiers are different numbers on the same entity and are
not interchangeable — take each from the field named here, never derive one
from another:

| Placeholder | Field on the `fa__list__entities` row | Used by |
|---|---|---|
| `<MANCO_UUID>` | `uuid` | the DWH queries' `FUND_UUID` filter |
| `<MANCO_CARTA_ID>` | `carta_id` | in-product Carta URLs |
| `<MANCO_ENTITY_ID>` | `id` | `fa__get__cash-balance`'s `entity_ids` |
