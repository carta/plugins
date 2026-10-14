# Gate — resolve the firm

Run this when a skill acts on one firm through the Carta MCP and the user may
name it in any form — a name, a Carta firm URL, a UUID or a Carta ID — or not
at all. The goal is a `<firm_uuid>` for the skill's Carta commands, plus a
`<firm_name>` and, when known, a `<carta_id>` for links.

The calling skill supplies three things; use its wording where this file says:

- `<firm_question>` — the question to ask which firm.
- `<access_step>` — the Carta command whose answer decides access.
- `<no_uuid_stop>` — what to suggest when the firm can't be found and the user
  has no UUID.

A skill may also name extra firms to suggest when asking (for example, a firm
matched from file names); otherwise only the active firm is suggested.

## Where the firm comes from

Take the first that applies:

1. **Named in this request** — a name, a Carta firm URL
   (`…/investors/firm/<carta_id>/…`), a UUID or a Carta ID.
2. **The firm this conversation is about** — one the user named or worked on
   earlier in *this* conversation, or the firm a `set_context` call in this
   conversation switched to (its UUID is the `firm_id` that call was given).
3. **Neither** → there is no firm to go on yet; the lookup below decides.

`active_firm_id` from `list_contexts` is a **hint, not an answer**. Carta keeps
one active firm per user for 24 hours, shared by every chat, Cowork task and live
page they have open, so it may have been set somewhere else. Offer it when
asking; never use it without asking unless it is the user's only firm.

Any firm list here is a **lookup aid, not a permission check**. It is built from
a periodically synced copy of permissions, so a firm the user has access to may
be missing from it (a new grant, or full view access not yet synced). Never
refuse because a firm is missing from a list; resolve it another way and let
`<access_step>` decide.

Do not call `set_context`. The skill's commands name the firm directly, and
`set_context` would change the user's active firm in every other chat they have
open (and, for staff, record a break-the-glass access grant).

## Look the firm up

`list_contexts` answers in one of two ways, and the same steps read both:

- **Search**: staff in sandbox or production (tell from `base_url`: the
  production or sandbox app, not a local, test or demo host). The arguments
  search every firm in Carta; with none, it returns only the active firm, if
  any.
- **Firm list**: everyone else, including **staff in local, test and demo**.
  It returns the account's own firms and ignores search arguments, so a firm
  the user named is matched against that list. Do not ask for a UUID before
  checking it.

1. Call `list_contexts` with what the user gave: `firm_uuid="<firm_uuid>"`,
   `firm_id="<carta_id>"` (from a Carta ID or a `…/investors/firm/<carta_id>/…`
   URL) or `firm_name="<firm_name>"`; with nothing named, call it bare.
2. Read `structured_content.firms` (each row has `firm_id`, `firm_name`, and
   `carta_id` when Carta knows it) and `active_firm_id`. Never read a row's
   UUID out of the text.
3. Match what the user gave against those rows: a UUID against `firm_id`, a
   Carta ID against `carta_id`, a name by the rule below. A search can return
   loosely related firms, so a row is never taken just for being first.

**Name rule.** Lowercase both names and drop spaces, `-`, `_`, `,` and `.`. A
row matches when either name contains the other. If any row matches exactly,
keep only the exact matches: a fund or SPV row usually carries the firm's name
inside a longer legal name.

| A firm was named | Do |
|---|---|
| One row matches | Use it, with that row's `firm_name` and `carta_id` |
| Several rows match | `AskUserQuestion`, one option per matching firm (up to 4); more than 4 → ask for the full name and match again |
| No row matches, search answered | Say no firm matched and ask again for a name, Carta URL or UUID. Never fall back to another firm |
| No row matches, firm list answered, a UUID was given | Carry on with the UUID as given, shown as the firm wherever a name would be. `<access_step>` decides access |
| No row matches, firm list answered, a name or Carta ID was given | Say Carta's firm list for their account doesn't show it yet, and ask for the firm's UUID. With one, carry on as in the row above. Without one, stop and `<no_uuid_stop>`. Never use a different firm |

| Nothing was named | Do |
|---|---|
| No rows | Ask which firm in plain text — a name, Carta URL or UUID — then look it up |
| One row, firm list answered | That is the user's only firm. Use it |
| One row, search answered | That is the active firm, set somewhere else. `AskUserQuestion`: that firm `(Recommended)`, or "Another firm" |
| 2–4 rows | `AskUserQuestion` — `<firm_question>` — one option per firm |
| More than 4 rows, a firm to suggest | `AskUserQuestion` — `<firm_question>` — with two options: the suggested firm `(Recommended)` and "Another firm". The user types another firm's name; match it with the name rule |
| More than 4 rows, nothing to suggest | Ask `<firm_question>` in plain text, then match the answer with the name rule. A pick-list can hold only 4 options, so never pad one with firms picked at random |

The firm to suggest, put first and marked `(Recommended)` whenever you ask: a
firm the calling skill names (if any), or else the active firm, named from its
row. An `active_firm_id` with no row in `firms` has no name to show, so it is
not offered.
