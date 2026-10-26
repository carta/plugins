---
name: carta-fund-admin-requests
model: sonnet
description: >-
  Send work to your Carta Fund Admin team and track it. Opens a request the team reads, acts on, and replies to — the off-ramp for anything no other Carta skill or command can do. TRIGGER: "ask Carta to", "have Carta do", "send this to my fund admin", "ask my fund admin team", "can Carta do this for me", "check on my request", "did Carta reply", "what requests do I have open", "reply to Carta", "follow up on my request", plus ANY action request (create/change/send/restate/reconcile/split/fix) that no other skill or Carta command covers. NOT FOR: reporting a bug or feature request about this plugin (call fa:create:feedback directly); questions answerable from Carta data (use carta-explore-data); capital call reminders to LPs (that is a Carta command, not a Fund Admin request).
version: 1.0.0
allowed-tools:
  # Production
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__get_current_user
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_contexts
  # Carta-installer naming (lowercase)
  - mcp__carta_production__call_tool
  - mcp__carta_production__read_tool
  - mcp__carta_production__welcome
  - mcp__carta_production__get_current_user
  - mcp__carta_production__set_context
  - mcp__carta_production__list_contexts
  # Local / legacy fallback
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__welcome
  - mcp__carta__get_current_user
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__get_current_user
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.116.1</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Ask Carta to do something

A request opens a case your Carta Fund Admin team works async. It is the answer
whenever the user wants something **done** and no other skill or Carta command
can do it — not a dead end, and never a warehouse query instead.

## Commands

Names are verbatim. `<SERVER>` is whichever Carta MCP server this session has.

| Intent | Call |
|---|---|
| Send a new request | `call_tool({"name": "fa__create__fund-admin-message", "arguments": {"message": "<message>"}})` |
| Read a request + Carta's replies | `read_tool({"name": "fa__list__workflow-message", "arguments": {"workflow_id": <workflow_id>}})` |
| Reply on an existing request | `call_tool({"name": "fa__create__workflow-message", "arguments": {"workflow_id": <workflow_id>, "message": "<message>"}})` |
| List the firm's requests | `read_tool({"name": "fa__list__firm-workflow", "arguments": {"workflow_templates": ["request-generic"], "statuses": ["active"]}})` |
| List tasks waiting on the user | `read_tool({"name": "fa__list__gp-workhub-active-task", "arguments": {"pending_actor": "customer"}})` |

None of these take a `firm_uuid` — they always act on the session's active firm.
`fa__create__fund-admin-message` returns `{"workflow_id": <id>}`, the case number.

---

## Gate 0 — session + access

1. Call `welcome`, then `get_current_user`.
2. No Fund Admin access (`fund_admin_access` false) → surface verbatim and stop:

   > Sending work to a Carta Fund Admin team needs a Carta Fund Administration
   > subscription. I can't find one on your account. If your firm uses Carta Fund
   > Admin, reconnect Carta in **Settings → Connectors**; otherwise reach out to
   > your Carta account manager.

3. Command missing or erroring as unavailable → surface verbatim and stop:

   > Messaging your Carta Fund Admin team isn't enabled for this account yet.

   Do not retry. Do not suggest email or another channel. Do not open a ticket by
   some other route.

---

## Gate 1 — is this a hand-off or a question? [Hard gate]

Run this **before drafting anything.** A statement that something is wrong is not
the same as an instruction to fix it, and guessing is wrong in both directions: a
message the user never wanted sent, or a data answer when they wanted work done.

**Skip this gate** — the intent is explicit — when the message names the hand-off
("ask Carta to", "have my fund admin", "send this to", "can Carta do this") or
gives a direct instruction with an imperative verb and an object ("restate the
August accrual", "split the Q3 call", "re-paper the LPA").

**Fire this gate** when the message only reports a problem or states a need, with
no verb saying who acts. Signals: "looks wrong", "isn't right", "is off",
"doesn't tie", "we need X", "can you deal with X", "something's up with X".

Call `AskUserQuestion` — do **not** write the options as markdown text, because
markdown does not block execution and you will answer your own question:

**Question:** "Do you want me to look into this, or ask your Carta team to fix it?"

**Options:**
1. **Look into it** — pull the data and show you what's going on
2. **Ask Carta to fix it** — send it to your Fund Admin team as a request
3. **Both** — show you the data first, then send a request if you still want one

| User picks | Action |
|---|---|
| Look into it | Hand off to the matching domain skill. Send nothing. |
| Ask Carta to fix it | Proceed to Flow 1. |
| Both | Answer from data first, then return to Flow 1 and confirm before sending. |

## Flow 1 — Send a request

**Never send an unconfirmed message.** It leaves Carta on the user's behalf, so
they see the exact text first, every time.

1. **Draft it.** Write the message yourself from what the user said. Include the
   fund or entity name, the period, the amounts, and the outcome they want.
   Detail is what lets the team act without coming back to ask.
2. **Confirm.** Call the `AskUserQuestion` **tool** with the drafted message
   quoted in full. Do not render the choices as a markdown list — a written list
   is not a gate, and the send must block on a real user turn:
   - **Send it** — send as drafted
   - **Edit first** — take their changes, redraft, confirm again
   - **Don't send** — stop, no message, no fallback
3. **Send** on approval, then report:

   > Sent to your Carta team — case **<workflow_id>**. They'll pick it up and reply
   > here. I'll check for a response whenever you ask.

Never estimate a turnaround. Never say "within 24 hours" or similar — you do not
know the queue.

One call opens one case. Two unrelated asks are two calls, not one merged message.

---

## Flow 2 — What's open

1. List open requests with `fa__list__firm-workflow`. It returns one page at a
   time: pass `after` = the previous `next` until `has_next` is false. Its rows
   cover requests filed in Carta and through this assistant.
2. List tasks waiting on the user with `fa__list__gp-workhub-active-task`, paged
   the same way. Keep rows whose `workflow_template` is `request-generic`; their
   `workflow_id`s are the requests that need the user.
3. For the **Completed** count, list `fa__list__firm-workflow` with
   `"statuses": ["complete", "canceled"]`, paged the same way, and count the rows
   across all pages. Skip it when the user only asked what is open.

`count` covers one page only. Build every group and count from all pages.

Group the requests into three:

| Group | Comes from | Status reads |
|---|---|---|
| **Tasks to complete** | `status` is `active` and its `workflow_id` is in step 2 | Ready for you |
| **In progress** | `status` is `active`, not in step 2 | Working |
| **Completed** | `status` is `complete` or `canceled` | Done / Canceled |

Age comes from `last_activity_at`, falling back to `created_at`.

Do not build a URL yourself. A row links out only through `_links.web_url`; a row
with an empty `url` has no page and no link.

Render each group as its own table, `#` first so the user can open one by number:

| # | Request | Status | Age |
|---|---|---|---|
| 1 | [Split the Q3 capital call](<web_url>) | Ready for you | 2d |

`request-generic` is a DM workflow, so it has **no subject**. Take the request
label from `display_name` when it names a real job; when it is empty or one of
fund-admin's fallback names (`Request`, `New request`, `Processing new request`,
`Review request`, `Request completed`), read the opening message with
`fa__list__workflow-message` — only for the rows you show.
Trim to one line. Link the label itself — never a separate "Open" or "View"
column. Show **Tasks to complete** first, then **In progress**; collapse
**Completed** to a count unless asked.

Close with:

```
Enter a number to open that case, or: [N] New request  [R] Refresh
```

---

## Flow 3 — Read a request

`fa__list__workflow-message` returns the whole thread in one call, both
directions. `author.is_staff` marks what Carta wrote.

Render it as a conversation, oldest first — "You" and "Carta". Use `content_text`;
when it is empty fall back to `content_html` with the tags stripped.

**Never surface Carta's internal agent output.** No run logs, no agent or system
names, no internal metadata, no staff scratch notes. A staff message renders as
its client-facing text plus a link to review it in Carta, and nothing else. If a
message is entirely internal, omit it rather than paraphrasing it.

State plainly whether the ball is with Carta or the user, then:

```
1 - Reply to Carta   ← recommended
2 - Open in Carta
3 - Back to queue
```

## Flow 4 — Reply

Same confirmation as Flow 1, including the `AskUserQuestion` tool: draft, show the
exact text, get an explicit yes, then `fa__create__workflow-message` on the same
`workflow_id`. Read the thread first so the reply answers what was actually asked.
Confirm with:

> Reply sent on case **<workflow_id>**.

Then offer **Back to queue**.

---

## If something goes wrong

| Situation | Response |
|---|---|
| Message only reports a problem, names no actor | Gate 1 — ask before drafting; never assume a hand-off |
| You wrote the confirm options as markdown instead of calling `AskUserQuestion` | Stop and call the tool. A written list does not block the send |
| No Fund Admin subscription | Gate 0 message; stop |
| Messaging not enabled for the account | Gate 0 message; stop — no retry, no other channel |
| No active firm in the session | Call `list_contexts`, then `set_context`; retry once |
| `fa__create__fund-admin-message` returns no `workflow_id` | Say the request may not have been created and to check with their Carta team before resending — do **not** resend automatically, it would open a second case |
| `workflow_id` not found | Wrong case number — ask them to confirm it |
| User wants to attach a file | Not supported yet: describe the document in the message and say the team will ask for it |
| User is reporting a plugin bug | Not a Fund Admin request — call `fa:create:feedback` directly |
