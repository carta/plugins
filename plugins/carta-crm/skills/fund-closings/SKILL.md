---
name: fund-closings
description: >
  Answers questions about a fund's closing in the Carta CRM: whether closings and the data room
  are set up, how far each LP's subscription has progressed (contact state, KYC, risk rating,
  commitments), and what it takes to send subscription documents or a data room invite to an LP.
  Use this skill when the user says things like "is closings set up for [fund]", "data room
  status for [fund]", "subscription details for [fund]", "subscription progress", "who has
  signed", "what do I need to send subscription docs to the next LP", "send subscription docs to
  [LP]", "invite [LP] to the data room", or "/fund-closings". A data room request fires this
  skill only when it names a fund or its LPs. Not for a fund's fundraising pipeline (LPs by
  stage, indicated interest): use search-fundraisings. Not for KYC evaluations or KYC document
  review: use the carta-kyc skills. Never for a company's data room, a company's financing
  round, or fund accounting (capital accounts, capital calls, distributions).
allowed-tools:
  - AskUserQuestion
  - mcp__carta__read_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__carta__crm_read_tool
  - mcp__carta__crm_call_tool
  - mcp__claude_ai_Carta__crm_read_tool
  - mcp__claude_ai_Carta__crm_call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__crm_read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__crm_call_tool
  - mcp__carta__crm_view_tool
  - mcp__claude_ai_Carta__crm_view_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__crm_view_tool
version: 1.0.0
model: haiku
---

<!-- carta:plugin-version -->
<carta-plugin>carta-crm:1.20.16</carta-plugin>

## Overview

Fund closings are answered from the CRM tools, not through `search_tools`. The CRM tools read
closings for any user whose organisation has the Carta integration. Fund Admin is read in two
places only, and either read can be refused by the user's Fund Admin access: the fund lookup,
to find a fund's Carta id when the record's fund field holds none (Step 1), and closing contacts,
to fill gaps CRM leaves (see Combining with Fund Admin), which needs Edit Partners on the fund.

| Question | Tool | Runs through |
|---|---|---|
| Is closings / the data room set up? Where is the ledger? | `crm:get_fund_closings_status` | `crm_read_tool` |
| How far has each LP got? KYC, risk rating, commitments | `crm:get_fund_closing_prospect_statuses` | `crm_read_tool` |
| Send subscription documents to an LP | `crm:send_fundraising_subscription_docs` | `crm_call_tool` |
| Who was invited to and joined the data room (card, or text when the view is off) | `crm:get_fund_data_room_summary` | `crm_view_tool` (text: `crm_read_tool`) |
| Invite an LP to the data room | `crm:send_fundraising_data_room_invite` | `crm_call_tool` |
| Find the fund's Carta id when the fund field has none | `fa__list__entities` | `read_tool` |
| Fill a gap CRM leaves in the LP list (Fund Admin closing contacts) | `fa__list__closing_contacts` | `read_tool` |

If `crm_read_tool` refuses a read tool, run the same call through `crm_call_tool`.

## Step 1 — Find the fund's Carta id

Both read tools take the fund's **Carta id** as an integer (`fundCartaId`, `fundCartaIds`): the
number in `/investors/firm/<firm_id>/portfolio/fund/<fund_carta_id>/closings/...`, which Fund
Admin calls `carta_id`. It is the only id they accept. Never pass a Fund Admin `id`, `fund_id` or
UUID as `fundCartaId`: the tools then report the fund as not set up or not found.

1. Resolve the fundraising opportunity (the fund's name, or the LP's name) through
   `crm_call_tool` and `crm:search_fundraising` with `query` and `limit: 10`. Never resolve
   through a view: a view collapses the rows, and the `id` never reaches you.
2. Open one record with `crm:get_fundraising` and read its fund field. If the field list is
   unclear, `crm:get_fundraising_fields` lists each field's id and type. Use the field only when
   it is an object with `cartaId`. A bare number or string there (e.g. `296940`) is a Fund Admin
   id, not a Carta id: do not use it.
3. No usable `cartaId` → look the fund up in Fund Admin by name (the fund field's `name`, else the
   fundraising record's name) and take its `carta_id`. Several funds match → ask which one; do
   not guess.

   ```
   read_tool({"name": "fa__list__entities", "arguments": {"entity_types": "fund", "search": "<fund name>"}})
   ```
4. The lookup was refused or failed (no access, response too large) → say the fund field holds
   no Carta id and the Fund Admin lookup failed, with the reason, and stop. Do not tell the user
   to link the record: it may already be linked.
5. The lookup ran and no fund matches → tell the user to link the fundraising record to a Carta
   fund first, and stop.

## Step 2 — Read closings and subscription progress

```
crm_read_tool({
  "name": "crm:get_fund_closings_status",
  "arguments": { "fundCartaIds": [<fund_carta_id>] }
})
```

- `isSetUp: false` can also mean the user cannot read the fund in Fund Admin. Say closings are
  not set up **or not readable by you**, never that the fund has no closing.
- Check `isSetUp` and `closingsLedgerUrl` separately: the URL can be empty when `isSetUp` is
  true. Report whether the data room is set up from this response.
- `isSetUp: false`, or `fund_admin_closings_fund_not_found` from the call below, when the id came
  from the fund field: check the id **once** with the Fund Admin lookup in Step 1. A different
  `carta_id` → rerun the call with it. Only then report not set up or not found. One lookup, no
  other ids tried. A refused or failed lookup leaves the first result: report it as is. Always
  say which Carta id you used.

For LP-by-LP progress, one call covers the whole fund. Never call it per LP.

```
crm_read_tool({
  "name": "crm:get_fund_closing_prospect_statuses",
  "arguments": { "fundCartaId": <fund_carta_id> }
})
```

- An absent field means Fund Admin had no value. Do not turn it into "not started".
- `lpStatedCommitmentAmount` is what the LP typed on the form. `commitmentAmount` is the GP's
  figure. Label them differently and never add them together.
- This tool reports its failures (unknown fund, no permission, closings not set up, Fund Admin
  unreachable). Pass the actual reason on to the user.
- Show each amount with its currency from the data. Never total across currencies.

### Combining with Fund Admin

While the CRM tools are available to the user, CRM is the primary source. Read Fund Admin
closing contacts only for what CRM does not return, such as a contact state it lacks. Say which
source each figure came from. When the two disagree, report the CRM figure and say they differ.

Fund Admin takes the fund's UUID. Look up only the fund being asked about with the Step 1
`fa__list__entities` lookup (`search` set to the fund name), and match its `carta_id` field to the
Carta id from Step 1. Never list every fund: a large firm's list comes back too large. Then read
the closing contacts:

```
read_tool({"name": "fa__list__closing_contacts", "arguments": {"fund_uuid": "<fund_uuid>"}})
```

If no returned fund has that `carta_id`, answer from CRM and say the fund was not found in Fund
Admin.

Fund Admin needs Edit Partners on the fund. When the closing contacts read is refused, do not
retry it: answer from CRM and say the Fund Admin view was not available. A lookup that fails for
another reason, such as a response that is too large, is not a refusal: say what failed and
answer from CRM. Never send through Fund Admin;
sends go through the CRM tools below.

## Show the data room card

For a question about who was invited to or joined a fund's data room, show the card. When the
question also asks whether closings are set up, run Step 2 first and show the card after it. The
card is read-only: it never sends anything, and an invite still goes through Step 3 and its
confirmation.

```
crm_view_tool({
  "name": "crm:get_fund_data_room_summary",
  "arguments": { "fundCartaId": <fund_carta_id> }
})
```

Use the Carta fund id from Step 1. Make this view call once and never retry it. Then, by its
answer:

- It returns normally: you never see the view, so a card that did not mount looks the same as one
  that did. Never say it rendered. For the card, say only: "If nothing appeared above, ask me
  for a text summary." Still give the Step 2 answer when the question asked about setup. When the
  user asks for that summary, make the text call below.
- It says the tool has no view: the card is off for this organization. Make the text call, and do
  not say the line above. The text call is the same tool and arguments through `crm_read_tool`
  (`crm_call_tool` if the read tool is refused). Summarize what it returns, for example: invited,
  joined, not joined yet, last joined, last file opened and by which LP, and the link. Report every
  field the tool returns. Say "joined" for an LP who accepted the invite.
- Either call says the tool is not found: answer from `crm:get_fund_closings_status` and
  `crm:get_fund_closing_prospect_statuses` (Step 2).

## Step 3 — Send subscription docs or a data room invite

Both send tools **email real people and cannot be recalled**. Only call one when the user has
asked to send. The host does not ask before these calls, so the gates below are the only check.

**A question about what is needed is not a request to send.** "What's needed to send
subscription docs to the next LP?" gets a list, and no call to either send tool. The list is:

- the legal name of the subscribing entity,
- at least one collaborator (name and email), each of whom is emailed,
- fixed commitment (an amount), or variable commitment (expected amount, optional minimum and
  maximum),
- whether Fund Admin triggers a capital call on countersign, and the percent called.

Also say whether closings are set up (Step 2), since sending fails without it.

**One approval covers one call**, with exactly the values shown, in the same turn.

### Subscription docs: two different stops

Collect the details above, then:

1. Preview. Show the fund, the legal name, each collaborator's name and email, the commitment
   mode and amounts, and the capital-call setting. Use `AskUserQuestion` with options
   `"Looks right"` / `"Change something"` / `"Cancel"`. "Change something" collects the edit and
   shows the preview again.
2. Final check, a separate question:
   > **Last step — this can't be undone.** Send subscription docs to <N> collaborators now:
   > Fund Admin emails <each collaborator> the documents for <fund>. Capital call on
   > countersign: <yes, N% / no>.

   Use `AskUserQuestion` with options `"Send subscription docs to <N> collaborators now"` /
   `"Not yet"`. Continue only on the first; anything else: stop and say nothing was sent.
3. Only then call the tool with `confirmSend: true`:

```
crm_call_tool({
  "name": "crm:send_fundraising_subscription_docs",
  "summary": "<one sentence: who is emailed, for which fund>",
  "arguments": {
    "fundraisingId": "<fundraising_id>",
    "legalName": "<legal_name>",
    "collaborators": [{ "name": "<name>", "email": "<email>" }],
    "autoTriggerCapitalCallOnCountersign": false,
    "commitmentAmount": "<decimal string>",
    "confirmSend": true
  }
})
```

### Data room invite: one stop

Directly before the call, show the fund, the LP's legal name, each collaborator's name and
email (for a staged prospect, the ones its subscription docs went to), and that the invite can't
be recalled. Take those values from details the user gives or confirms in this turn; never show a
placeholder phrase. Use `AskUserQuestion` with options `"Send data room invite"` / `"Cancel"`. Continue only on
`"Send data room invite"`; anything else: stop and say nothing was sent. Then call
`crm:send_fundraising_data_room_invite` with the same arguments shape, `confirmSend: true`, and
no `prospect` unless none is staged.

### When a send fails

Every send after a failure goes back through its gate with the changed details before
`confirmSend: true`; the earlier approval never carries over.

- `PROSPECT_PERSIST_FAILED`: **never retry.** The prospect exists in Fund Admin but the CRM did
  not record it, so a retry stages a duplicate. Tell the user to escalate to a person.
- `FA_REJECTED_REQUEST`: identical input cannot succeed. Fix the input or stop.
- `CAPITAL_CALLS_NOT_ENABLED`: ask whether to send without the capital call.
- `PROSPECT_DETAILS_REQUIRED`: ask for the prospect details and send again with `prospect`.
- `ALREADY_SENT`: already sent. Say so; a re-send is only accepted if the earlier invite failed.
- `FA_UNREACHABLE`: safe to retry later.

Success means the prospect is staged and the invite dispatched, **not** that email was
delivered. Say who is being invited, and that delivery can be checked in Fund Admin.

## Step 4 — Present results

Lead with the answer: set up or not, data room yes or no, how many LPs at each stage. Then a
table of LPs with contact state, KYC status and commitment, at most six columns. Do not show
ids; link the closings ledger URL when there is one. After a view call that returned normally, do not repeat the data room summary as text.
