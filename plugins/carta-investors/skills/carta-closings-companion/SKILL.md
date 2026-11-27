---
name: carta-closings-companion
description: >-
  Work a fund's closings from chat: "show closing contacts for {fund}", "who are the prospects on
  {fund}?", "which LPs have countersigned?", "what have LPs entered so far", "invite {investor} to
  subscribe", "move {investor} to the data room", "remind the LPs who haven't signed", "change
  {investor}'s commitment to $1.5M", "add {investor} as a prospect on {fund}", "rename {investor}",
  or a pasted Carta /closings/ or /closings/overview URL. Reads each investor's state, GP
  commitment, LP-entered amount and collaborators live from fund-admin, in the Closings view when
  the client renders MCP apps and as a table in chat otherwise. Invites, reminds, changes a
  commitment, adds a prospect and edits its name or capital call, each after the user confirms. NOT
  FOR: warehouse metrics such as NAV, TVPI, DPI, IRR, cap tables or booked partner commitments
  (carta-explore-data).
version: 1.0.0
model: inherit
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__welcome
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__carta__view_remote_next
  - mcp__claude_ai_Carta__view_remote_next
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__view_remote_next
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.69.19</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Closings companion

A fund's closing contacts are the investors moving through subscription and countersignature. The user works them from chat. Carta can show them in a read-only Closings view beside the chat; every change still goes through the commands below, never through the view.

> **Live only, never the warehouse.** Every answer comes from a fresh `fa__list__closing_contacts` call. Never read `LP_CLOSING_CONTACT_STATUSES` or any other warehouse table for closings; it lags real-time commitment and collaborator changes. Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-closings-companion/references/closing-contacts.md` (this skill's own `references/`; do not search for it) for what each field means, how states group, and how to page.

## Commands

> **Asking the user.** Every question below uses `AskUserQuestion`. A client without that tool (Claude Desktop) gets the same question in chat: a confirmation as one line that names what will change, a choice as a numbered list of its options, and a request for missing details as a plain chat question. Nothing is sent until the user answers yes to the confirmation.

> **Carta MCP only.** Make every Carta call through this session's Carta MCP tools (`welcome`, `list_contexts`, `set_context`, `call_tool`) and, for the Closings view, `view_remote_next` and the view's app tools (Step 4), and read each result as it returns. Never run the `carta` CLI or any shell command, never save a result to a file to inspect it, and never use Playwright or another browser tool of your own.

Call each command in this table through `call_tool` on whichever Carta MCP server this session has. Every call carries `"_instrumentation_v2": {"skills": ["carta-investors:carta-closings-companion"]}`; if one is rejected for missing it, send it again with it, without telling the user.

| Intent | Call |
|---|---|
| The firm's funds | `call_tool({"name": "fa__list__entities", "arguments": {"entity_types": "fund"}})`, plus `"search": "<fund_name>"` when the user named a fund |
| Closing contacts | `call_tool({"name": "fa__list__closing_contacts", "arguments": {"fund_uuid": "<fund_uuid>", "detailed": true, "size": 10}})`, plus `"state": ["<state>"]` or `"search": "<email or investor name>"` when the user filters; every read keeps `"detailed": true`, filtered or repeated, because the LP-entered amount comes only with it |
| Invite prospects | `call_tool({"name": "fa__mutate__invite_closing_contacts", "arguments": {"fund_uuid": "<fund_uuid>", "contact_ids": ["<public_id>"]}})` |
| Invite to the data room | `call_tool({"name": "fa__mutate__invite_data_room_contacts", "arguments": {"fund_uuid": "<fund_uuid>", "contact_ids": ["<public_id>"]}})` |
| Remind investors | `call_tool({"name": "fa__mutate__send_closing_reminders", "arguments": {"fund_uuid": "<fund_uuid>", "contact_ids": ["<public_id>"]}})` |
| Change a commitment | `call_tool({"name": "fa__mutate__closing_contact_commitment", "arguments": {"fund_uuid": "<fund_uuid>", "contact_id": "<public_id>", "investor_name": "<partner_name>", "current_amount": "<commitment_amount>", "new_amount": "<number>", "currency": "<fund currency>"}})` |
| Add a prospect | `call_tool({"name": "fa__create__closing_prospect", "arguments": {"fund_uuid": "<fund_uuid>", "partner_name": "<legal name>", "contacts": [{"name": "<contact name>", "email": "<contact email>"}], "commitment_amount": "<number>"}})`; for a commitment the investor enters, send `"variable_commitment_enabled": true` and `"expected_commitment_amount"` (optionally `"minimum_commitment"` and `"maximum_commitment"`) in place of `commitment_amount`; for a capital call, `"call_capital_on_countersign": true` and `"capcall_percent_of_commitment": "<whole percent>"` |
| Edit a prospect | `call_tool({"name": "fa__mutate__closing_prospect", "arguments": {"fund_uuid": "<fund_uuid>", "contact_id": "<public_id>"}})`, plus only the fields to change: `"partner_name"`, `"call_capital_on_countersign"`, `"capcall_percent_of_commitment": "<whole percent>"` |

**Adding and editing a prospect is not open to every user.** If either command is refused as not enabled for this user, say that adding and editing prospects from chat is not available to them yet, tell them to use Add prospective investors in the Closings tab in Carta, and stop. Do not retry, and do not build a URL.

## Step 1: connector and firm

Call `welcome` with `_instrumentation={"plugin": "carta-investors", "skills": ["carta-closings-companion"]}`, once per run. If it fails, say what it returned and stop.

1. A pasted Carta URL names the firm: `list_contexts({"firm_id": "<number after /investors/firm/>"})`, and the user is never asked to choose it. Otherwise `list_contexts({"firm_name": "<firm_name>"})` when the user named a firm, or with no arguments.
2. One match: use it. Several: `AskUserQuestion`, one option per firm. None: say so, list up to five accessible firms, and stop. For a Carta staff account an empty list is normal; ask which firm.
3. If the chosen firm is not active, `set_context({"firm_id": "<firm_uuid>"})`.

## Step 2: the fund

1. List the funds with the table's first call.
2. A pasted Carta URL: the firm is already resolved, so read only the number after `/fund/` and match it to the `carta_id` field. Otherwise match by name. Several matches: `AskUserQuestion`. None: list up to five of the firm's funds and ask.
3. Keep the fund's `uuid`, `name` and `currency`. Never default to USD or any currency; an amount is shown in the fund's own currency. With no currency on the record, show plain numbers.

## Step 3: read the contacts

Make the table's contacts call, with the user's `state` or `search` filter when they named one. An access error ("Closings is not available on this fund...") means:

- They need the **Edit Partners** permission on this fund in Carta.
- The fund must have closings enabled.

Tell the user that and stop. Do not retry, and do not fall back to the warehouse. A fund with no closing contacts: say so in one line, and offer a different filter when one was set.

## Step 4: show the closings

The contacts result's `how_to_reply` says how to show them: it either names the Closings view to open, or says to describe the contacts in chat. Follow it. Every contact answer in chat follows `${CLAUDE_PLUGIN_ROOT}/skills/carta-closings-companion/references/chat-table.md` (this skill's own `references/`; do not search for it), which says what to write when the view is open.

1. **`how_to_reply` names the Closings view.** Open it with the call it names. Once it is open, use its app tools as `fa:view:closings`'s help says, rather than opening it again: read what the user sees with `list_visible_contacts` before you answer about it. The view never writes: every change still goes through Steps 5, 6, 7, 9, 10 and 11 with their confirmations. If opening it fails, returns only text, returns an app payload but the user says nothing appeared, or the text says no view appears (a client that cannot render MCP apps), the view is not open: do not retry other display modes, do not mention the view, and continue with 2.
2. **Otherwise, describe the closings in chat** with that table, as the whole answer. Keep any state or investor filter the user named. Say nothing about a view, never build a Carta URL, and never give a URL that was not in a result.

## Step 5: invite prospects

Only contacts in the `prospect` state can be invited to subscribe.

1. Choose the contacts from the rows already read: those whose `status` is Prospect and that the user named, or every prospect when they asked to invite all. Read the list again filtered with `"state": ["prospect"]` when the rows in hand are stale or were filtered differently.
2. Show the investors to be invited and ask for confirmation with `AskUserQuestion`: "Invite {N} prospects to subscribe?" with the names listed (up to ten, then "+ N more"). Inviting emails each person who fills the investor's form, so never send without a yes.
3. On yes, call the invite command with those contacts' `public_id` values. Never retry a failed send; say what failed and ask.
4. Report from the response: `invited_contact_ids` (how many contacts were invited), `num_of_invitation_sent` (emails sent) and `skipped_contact_ids` (not prospects; no email went out), by investor name. Use the response's `summary` wording where it fits.
5. Read the contacts again and show what changed. The view, when open, shows the change within about 30 seconds.

A refusal naming a missing permission means the user needs **Edit Partners** or **Edit Fundraising** on the fund. Say that and stop.

## Step 6: send reminders

Reminders reach investors who were invited and have not finished: the `signing` group in `references/closing-contacts.md`. A contact still filling its form is sent the invitation again; one waiting on signatures gets a signing reminder at each signatory who has not signed. Prospects are invited with Step 5, not reminded.

1. Choose the contacts from the rows already read: those in the `signing` group that the user named, or all of them when they asked to remind everyone. Read the list again filtered with `"state"` set to the `signing` group's states when the rows in hand are stale or were filtered differently.
2. Show the investors and ask for confirmation with `AskUserQuestion`: "Send reminders to {N} investors?" with the names listed (up to ten, then "+ N more"). A reminder emails the people on each investor's form or signature page, and fund-admin does not stop a second reminder sent a minute later, so never send without a yes.
3. On yes, call the reminder command once with those contacts' `public_id` values. Never retry a failed send; a send that failed may have gone out, so say what failed and ask.
4. Report from the response: `num_filler_emails` (invitation emails sent) for `filler_contact_ids`, `signatory_results` (each signatory sent, skipped with fund-admin's reason, or failed), `failed_contact_ids` (signatories could not be reached) and `skipped_contact_ids` (not in the `signing` group; no email went out), by investor name. Use the response's `summary` wording where it fits.
5. Say the view does not change after a reminder, because it shows no reminder status.

A refusal naming a missing permission means the user needs **Edit Partners** on the fund. Say that and stop.

## Step 7: change a commitment

The user gives an investor and an amount: "Rio Capital committed 250k". Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-closings-companion/references/commitment-edits.md` (this skill's own `references/`; do not search for it) for which contacts can change, which amount is written, and how to read the amount and the investor.

1. Find the investor in the rows already read. When those rows were filtered by a state or by another search, read again with `"search": "<investor name>"` (and `"detailed": true`) first: never say an investor is missing after a filtered read. Read the amount in the fund's currency as that file says. When either is unclear, ask.
2. Show one row: investor, the amount label from `commitment-edits.md`'s table, the amount now shown, the new amount, currency. Ask for confirmation with `AskUserQuestion`: "Change {investor}'s {label} to {new} {currency}? (now shown as {current})" Never change an amount without a yes. Several changes in one message are confirmed and made one at a time.
3. On yes, call the commitment command once with that row's values. Never retry a failed change; say what came back and ask.
4. Report the result's `summary`. If it refuses because the amount changed since the read, read the contacts again and start over from step 2. A refusal for a contact past the editable states: say what `commitment-edits.md` says and stop.
5. Read the contacts again and show what changed; for a variable commitment also say the investor's own amount is unchanged. The view, when open, shows the change within about 30 seconds.

## Step 8: move a contact along the funnel

A sentence such as "move Birch to the data room" is an action in Carta, not a field to set. A GP cannot set a contact's state by hand. Pick the action from what they asked:

| The user asks | Do this |
|---|---|
| "invite Birch", "move Birch to invited", "send Birch the subscription invite" | Step 5 |
| "move Birch to the data room", "to the data room stage", "give Birch data room access", "invite Birch to the data room" | Step 9 |
| "add Birch as a prospect", "create a prospect for Birch" | Step 10 |
| "rename Birch", "call 25% on countersign for Birch", "turn off Birch's capital call" | Step 11 |
| "mark Birch as in progress, submitted, signed or countersigned" | Set nothing. Say the state follows what happens in Carta: the investor's form and signatures, then the GP's countersignature. Offer to read the contact again |

## Step 9: invite contacts to the data room

A contact in any state except archived or deleted can be invited to the data room. The invite emails each of the contact's collaborators, so it needs a yes.

1. Choose the contacts from the rows already read: the ones the user named, or every contact in a state the user named. Read the list again when the rows in hand are stale or were filtered differently: filtered with that `"state"` when the user named one, and paged to the end.
2. Ask with `AskUserQuestion`: "Invite {N} contacts to the data room? Their collaborators get an email." with the names listed (up to ten, then "+ N more"). Never send without a yes.
3. On yes, call the data room invite command with those contacts' `public_id` values, at most 50 at a time. Never call it again for contacts already sent: that emails them twice. Never retry a failed send; say what failed and ask.
4. Report `invited_contact_ids` and `skipped_contact_ids` by investor name. A skipped contact is not on this fund, or was archived or deleted.
5. Read the contacts again and report each one's `invited_to_data_room`. It is the only record of who was invited, because the invite does not say who was emailed. The view, when open, shows the change within about 30 seconds. A collaborator the data room's tiers would show nothing gets no email, so an invited contact with no data room set up yet can still read as not invited: say so and suggest setting up the data room in Carta.

A refusal naming a missing permission means the user needs **Edit Partners** or **Edit Fundraising** on the fund. Say that and stop.

## Step 10: add a prospect

The user names an investor to add: "add Oak Partners as a prospect on Fund III, contact Pat Tester pat@oak.example, 500k". Adding stages the investor as a prospect and emails no one. Inviting it to subscribe is Step 5.

1. Collect what the command needs, and ask for anything missing with `AskUserQuestion`. Never invent a name, an email address or an amount.
   - The investor's legal name.
   - One or more contacts, each with a name and an email address.
   - The commitment. A fixed amount is read in the fund's currency as `${CLAUDE_PLUGIN_ROOT}/skills/carta-closings-companion/references/commitment-edits.md` says under "The amount" (this skill's own `references/`; do not search for it). When the user says the investor enters their own amount, use a variable commitment: the expected amount, and a minimum and maximum only if the user gave them.
   - A capital call only when the user asks for one: a whole percent above 0 and at most 100. The fund's closing must call capital on countersignature, or the command refuses.
2. Check the fund does not hold the investor already: read the contacts with `"search": "<investor name>"` and `"detailed": true`. On a match, show it with its state and ask whether to add another, edit it (Step 11, or Step 7 for the amount) or stop. Adding twice makes two prospects.
3. Show the investor, each contact, the commitment with its currency, and the capital call if any. Ask for confirmation with `AskUserQuestion`: "Add {investor} as a prospect with a {amount} {currency} commitment? Nobody is emailed." Never add without a yes.
4. On yes, call the add command once. Never retry a failed add: it may have been created, so read the contacts again with `"search": "<investor name>"` before saying what happened, and ask.
5. Report the result's `summary`, read the contacts again and show the new row, then offer Step 5 to invite it. The view, when open, shows the change within about 30 seconds.

A refusal naming a missing permission means the user needs **Edit Partners** on the fund. Say that and stop.

## Step 11: edit a prospect

The user asks to rename an investor or change its capital call: "rename Oak to Oak Partners LLC", "call 25% on countersign for Rio". A new amount is Step 7.

1. Find the investor in the rows already read. When those rows were filtered by a state or by another search, read again with `"search": "<investor name>"` (and `"detailed": true`) first: never say an investor is missing after a filtered read. Several matches: `AskUserQuestion`, one option per investor.
2. A new name applies only while the investor's `status` is Prospect. From any other state say the name can only be changed in Carta and leave it out. A capital call can change while the investor is a prospect, invited or in progress.
3. Show the investor and each change as old to new. Ask for confirmation with `AskUserQuestion`: "Change {investor}: {changes}?" Never change anything without a yes.
4. On yes, call the edit command once with only the fields that change. Never retry a failed change; say what came back and ask.
5. Report the result's `summary`. If the answer says the investor was invited before the rename applied, say the name is unchanged and that any capital-call change in the same request was applied. If it says capital calls are not enabled for this closing, say nothing changed.
6. Read the contacts again and show what changed. The view, when open, shows the change within about 30 seconds.

A refusal naming a missing permission means the user needs **Edit Partners** on the fund. Say that and stop.
