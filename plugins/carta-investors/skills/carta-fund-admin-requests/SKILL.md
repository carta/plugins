---
name: carta-fund-admin-requests
model: sonnet
description: 'Send work to your Carta Fund Admin team and track it. Opens a request the team reads, acts on, and replies to — the off-ramp for anything no other Carta skill or command can do. TRIGGER: "ask Carta to", "have Carta do", "send this to my fund admin", "ask my fund admin team", "can Carta do this for me", "check on my request", "did Carta reply", "what requests do I have open", "reply to Carta", "follow up on my request", plus ANY action request (create/change/send/restate/reconcile/split/fix) that no other skill or Carta command covers. NOT FOR: reporting a bug or feature request about this plugin (call fa:create:feedback directly); questions answerable from Carta data (use carta-explore-data); capital call reminders to LPs (that is a Carta command, not a Fund Admin request).'
version: 1.0.0
allowed-tools:
  # Production
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__get_current_user
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_contexts
  # Carta-installer naming (lowercase)
  - mcp__carta_production__call_tool
  - mcp__carta_production__welcome
  - mcp__carta_production__get_current_user
  - mcp__carta_production__set_context
  - mcp__carta_production__list_contexts
  # Local / legacy fallback
  - mcp__carta__call_tool
  - mcp__carta__welcome
  - mcp__carta__get_current_user
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - AskUserQuestion
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

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
| Read a request + Carta's replies | `call_tool({"name": "fa__list__workflow-message", "arguments": {"workflow_id": <workflow_id>}})` |
| Reply on an existing request | `call_tool({"name": "fa__create__workflow-message", "arguments": {"workflow_id": <workflow_id>, "message": "<message>"}})` |
| List a firm's requests (**staff only**) | `call_tool({"name": "fa__list__workflow", "arguments": {"firm_uuid": "<firm_uuid>", "template_type": "request-generic", "page_size": 50}})` |

`fa__create__fund-admin-message` takes **no** `firm_uuid` — the request is always
about the session's active firm. It returns `{"workflow_id": <id>}`, the case number.

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

Staff callers list with `fa__list__workflow`. Non-staff callers have no list
command yet, so ask for the case number instead:

> I can pull up a specific request if you have its case number. Listing every open
> request isn't available to your account yet.

Group listed rows into three. **Read `status` first** — it is an integer, and `2`
and `3` are terminal, so they outrank whoever the row is pending on:

| Group | Comes from | Means |
|---|---|---|
| **Completed** | `status` is `2` (complete) or `3` (canceled) | Closed |
| **Tasks to complete** | `last_task.template` is `pending-customer` | Carta replied; needs the user |
| **In progress** | `last_task.template` is `pending-carta` or `new` | Carta has it |

An unrecognised `last_task.template` goes under **In progress** — show it rather
than hide it. Age comes from `last_activity_at`, falling back to `created_at`.

Status reads **Sent** (`new`) / **Working** (`pending-carta`) / **Ready for you**
(`pending-customer`) / **Done** (`status` 2) / **Canceled** (`status` 3) — the same
words the Carta Tasks artifact uses. Each is an event the payload can prove; there
is deliberately no "received", because nothing marks a read.

There is **no `state` field and no `_links` block** on this payload. Do not read
either, and do not build a URL yourself. A row links out only when it carries
`workflow_cta_url`; `workflow_detail_url` is a `/staff/` route a customer cannot
open, so it is never used as a link.

Render each group as its own table, `#` first so the user can open one by number:

| # | Request | Status | Age |
|---|---|---|---|
| 1 | [Split the Q3 capital call](<workflow_cta_url>) | Ready for you | 2d |

`request-generic` is a DM workflow, so it has **no subject**. Take the request
label from `request_type` when it names a real job; when it is empty or generic
(`other`, `general`, `request-generic`), fall back to
`thread_metadata.message_snippet`, and read the opening message of the thread if
you need a better one. Trim to one line. Link the label itself — never a separate
"Open" or "View" column. Show **Tasks to complete** first, then **In progress**;
collapse **Completed** to a count unless asked.

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
| User asks to list requests but is not staff | Flow 2 non-staff message; ask for a case number |
| `workflow_id` not found | Wrong case number — ask them to confirm it |
| User wants to attach a file | Not supported yet: describe the document in the message and say the team will ask for it |
| User is reporting a plugin bug | Not a Fund Admin request — call `fa:create:feedback` directly |
