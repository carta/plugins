---
name: carta-workhub-build
description: >-
  Opens the Carta Workhub, the Carta task board; a built Workhub artifact is an old copy, and the
  Workhub opens from the Carta connector. Invoke it first to open the Workhub or its artifact ("open
  the carta workhub", "open the carta workhub artifact", "open my Carta workhub", "build the carta
  workhub artifact", "rebuild carta tasks", "show my Carta task board", "pin my Carta requests",
  "what requests do I have open", Fund Admin ones too); for "ask Carta to", "ask my fund admin
  team", "have my fund admin team", "send this to my fund admin" or an action on a fund or entity no
  other skill covers; to draft a capital call or distribution; and to review, approve or send back
  work the Workhub hosts (expense payments, financial packages, fees, SOI, tax, cash rec: "approve
  the Fund II expense payment"). NOT FOR: one Fund Admin request to check on, follow up or reply to
  (carta-fund-admin-requests); building or rebuilding Carta Home (carta-home-build); a Workhub
  page's KYC card (carta-kyc-fill-form).
model: inherit
allowed-tools:
  - mcp__claude_ai_Carta__open_workhub
  - mcp__carta_production__open_workhub
  - mcp__carta__open_workhub
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__open_workhub
  - Skill(carta-investors:carta-kyc-fill-form)
  - Skill(carta-investors:carta-fund-admin-requests)
  - Skill(carta-investors:carta-explore-data)
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.64.2</carta-plugin>

# Carta Workhub

Requires the Carta connector.

The Carta Workhub is an app in the Carta connector. Workhub pages built earlier are frozen copies
that get no updates; opening the Workhub builds no page.

## KYC cards on a built Workhub page

A prompt that names this skill's KYC branch (a built Workhub page's KYC card, or its **Fill all**
or **Fill selected** button) is for `carta-investors:carta-kyc-fill-form`: invoke it with the
Skill tool, pass the user's prompt along unchanged, and stop without opening the Workhub. Every
other prompt opens the Workhub (below).

## Open it

1. Call `open_workhub` (no params) on the Carta connector. Do not list or open a Workhub artifact:
   it is an old copy.
2. When the Workhub opens, tell the user, in a few plain lines (the **moved-page note**):
   - The Carta Workhub now opens from the Carta connector, so there is nothing to rebuild.
   - They can ask Claude to "open my Carta Workhub" any time.
   - The old Workhub page no longer gets updates, and they can delete it from their artifacts.
3. When the call fails, the tool isn't there, or it answers that it can't be shown here, say the
   Carta connector couldn't open the Workhub and ask them to check that Carta is connected in
   Settings → Connectors. Keep their old page until it opens. Do not build or publish an artifact.

## Open requests

When the user asked what requests they have open, Fund Admin requests included, open the Workhub
(step 1) and, instead of the moved-page note, say their open requests are listed there. When the Workhub doesn't open (step 3),
invoke `carta-investors:carta-fund-admin-requests` with the Skill tool, pass the user's prompt
along unchanged, and let its Flow 2 list them in chat.

## Send work to Carta's Fund Admin team

When the user wants Carta's Fund Admin team to do something (they name Carta, their fund admin
or the Fund Admin team, or ask for an action on a fund or entity that no other skill covers):

A bug report or feature request about this plugin is not a Fund Admin request, even when it says
"ask Carta to": invoke `carta-investors:carta-fund-admin-requests` with the Skill tool, which files
it with `fa:create:feedback`, and send nothing with `send_request`.

1. **Open the Workhub** (step 1). When it doesn't open (step 3), invoke
   `carta-investors:carta-fund-admin-requests` with the Skill tool, pass the user's prompt along
   unchanged and ask nothing first: its Gate 1 and Flow 1 ask, draft, confirm and send.
2. **Files go through Flow 1.** When the user attached files, invoke
   `carta-investors:carta-fund-admin-requests` the same way instead of calling `send_request`: its
   Flow 1 uploads them with the request, which `send_request` can't.
3. **Ask when no one is named.** Skip this step when the message names the hand-off ("ask Carta
   to", "have my fund admin", "send this to", "can Carta do this") or gives a direct instruction
   with an imperative verb and an object ("restate the August accrual", "split the Q3 call",
   "re-paper the LPA"). Ask when the message only reports a problem or states a need, with no verb
   saying who acts. Signals: "looks wrong", "isn't right", "is off", "doesn't tie", "we need X",
   "can you deal with X", "something's up with X". Call the `AskUserQuestion` tool, not a written
   list, with "Do you want me to look into this, or ask your Carta team to fix it?" and **Look
   into it**, **Ask Carta to fix it** and **Both**. On **Look into it**, invoke
   `carta-investors:carta-explore-data` with the Skill tool and send nothing. On **Both**, invoke
   it first, then come back to step 4. These phrases match `carta-fund-admin-requests`' Gate 1, so
   a prompt gets the same decision on either path.
4. **Draft, then send.**
   1. Write the message as `carta-fund-admin-requests`' Flow 1 step 1 does, from what the user
      said rather than their raw words: the fund or entity, the period, each amount with its
      currency code read from the data (never assumed to be USD), and the outcome they want.
   2. File it with the Workhub's `send_request` app tool. It shows them the message with one
      confirm (Send it / Edit first / Don't send) before it sends, and sends nothing on **Don't
      send**. The request opens in the Workhub, where its progress shows.
   3. Instead of the moved-page note, say it was sent and that it is open in the Workhub.
5. **Never resend.** When `send_request` errors or returns no case, say the request may not have
   been sent and ask them to check the Workhub before resending. Hand nothing to
   `carta-fund-admin-requests` and don't retry: a second send opens a second case.

## A capital call or distribution

When the user asked for a capital call or distribution:

1. **Open the Workhub first** (step 1), even when they did not ask for it.
2. **Draft it** with the Workhub's `draft_capital_activity` app tool, once, passing only what they
   gave. The draft shows in the Workhub for them to review and release.
3. **Report**, instead of the moved-page note: what Carta filled in, and what was drafted (a call
   or a distribution, the fund, the amount with the currency code the draft carries, and the due
   date). Say it is open in the Workhub for review.
4. **Link only on request.** Give the Carta link to the draft only when they ask for it.

A capital call the Workhub draft can't do (a parallel entity capital call, for example), or one
`draft_capital_activity` refuses, goes to Carta's Fund Admin team as a generic request, where
Carta's Fund Admin agent picks it up. File it as **Send work to Carta's Fund Admin team** steps 2,
4 and 5 say (files through Flow 1, a drafted message to the Workhub's `send_request` app tool,
never a resend), so the request opens in the Workhub for the user to follow.

When the Workhub doesn't open (step 3), say it couldn't open here and that nothing was drafted.
For a capital call the Workhub draft can't do, invoke `carta-investors:carta-fund-admin-requests`
with the Skill tool and pass the user's prompt along unchanged; for any other call or distribution,
offer to draft it with Carta's capital activity commands instead, which give a link to review it
in Carta. Draft nothing until they say yes.

## A task the Workhub hosts

When the user asked to review, approve or send back work the Workhub hosts (an expense payment, a
financial package, management fees, an SOI, a tax return, a Form 1099, or a fund's cash
reconciliation), open the Workhub (step 1), then open that item there:

- When a Carta result leads with `open_app`, do what it says: it names the Workhub's
  `open_workflow_item` app tool and the item's params.
- Otherwise find the task with `list_visible_tasks` (narrow it with `filter_tasks`) and open it
  with `open_task`.

Instead of the moved-page note, say which item is open in the Workhub. The user approves or sends it
back on that screen. Where the screen lists its own approve or send-back tool (an expense payment,
a financial package), call it only after the user confirms in the chat; on any other screen, they
click approve themselves. Never approve with a Carta command outside the screen, and give no
Carta link to the item unless they ask for one.

When the Workhub doesn't open (step 3), say it couldn't open here and use the matching Carta
commands for the item, which give its review page in Carta.
