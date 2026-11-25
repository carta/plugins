---
name: carta-workhub-build
description: >-
  Opens the Carta Workhub, the Carta task board and list of open requests; a built Workhub
  artifact is an old copy, and the Workhub opens from the Carta connector. Invoke it first to open,
  show, build, rebuild or set up the Workhub or its artifact ("open the carta workhub", "open the
  carta workhub artifact", "open my Carta workhub", "build the carta workhub artifact", "rebuild
  carta workhub", "rebuild carta tasks", "show my Carta task board", "pin my Carta requests",
  "what requests do I have open"). Also to draft a capital call or distribution ("call $1M pro
  rata from Fund I investors"), and to review, approve or send back work the Workhub hosts (expense
  payment, financial package, management fees, SOI, tax return, Form 1099, cash rec: "approve
  the Fund II expense payment"). NOT FOR: one Fund Admin request, to follow up, reply or check on
  (carta-fund-admin-requests); the Carta Home fund dashboard (carta-investors:carta-home-build); a
  Workhub page's KYC card prompt (carta-investors:carta-kyc-fill-form).
model: inherit
allowed-tools:
  - mcp__claude_ai_Carta__open_workhub
  - mcp__carta_production__open_workhub
  - mcp__carta__open_workhub
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__open_workhub
  - Skill(carta-investors:carta-kyc-fill-form)
  - Skill(carta-investors:carta-fund-admin-requests)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.63.3</carta-plugin>

# Carta Workhub

The Carta Workhub is an app in the Carta connector. Workhub pages built from this skill are
frozen copies that get no updates, and this skill builds nothing.

## KYC cards on a built Workhub page

A prompt that names this skill's KYC branch (a built Workhub page's KYC card, or its **Fill all**
or **Fill selected** button) is for `carta-investors:carta-kyc-fill-form`: invoke it with the
Skill tool, pass the user's prompt along unchanged, and stop without opening the Workhub. Every
other prompt opens the Workhub (below).

## Open it

1. Call `open_workhub` (no params) on the Carta connector. Do not list or open a Workhub artifact:
   it is an old copy.
2. When the Workhub opens, tell the user, in a few plain lines:
   - The Carta Workhub now opens from the Carta connector, so there is nothing to rebuild.
   - They can ask Claude to "open my Carta Workhub" any time.
   - The old Workhub page no longer gets updates, and they can delete it from their artifacts.
3. When the call fails, the tool isn't there, or it answers that it can't be shown here, say the
   Carta connector couldn't open the Workhub and ask them to check that Carta is connected in
   Settings → Connectors. Keep their old page until it opens. Do not build or publish an artifact.

## Open requests

When the user asked what requests they have open, open the Workhub (step 1) and, instead of
step 2's lines, say their open requests are listed there. When the Workhub doesn't open (step 3),
invoke `carta-investors:carta-fund-admin-requests` with the Skill tool, pass the user's prompt
along unchanged, and let its Flow 2 list them in chat.

## A capital call or distribution

When the user asked for a capital call or distribution, always open the Workhub first (step 1),
even when they did not ask for it, then draft it with the Workhub's `draft_capital_activity` app
tool, once, passing only what they gave. The draft shows in the Workhub for them to review and
release. Tell them what Carta filled in instead of step 2's lines, and name what was drafted: a
call or a distribution, the fund, the amount with the currency code the draft carries, and the due
date. Say it is open in the Workhub for review. Give the Carta link to the draft only when they ask
for it.

A capital call the Workhub draft can't do (a parallel entity capital call, for example), or one
`draft_capital_activity` refuses, goes to Carta's Fund Admin team as a generic request, where
Carta's Fund Admin agent picks it up. File it with the Workhub's `send_request` app tool, so the
request opens in the Workhub for the user to follow.

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

Instead of step 2's lines, say which item is open in the Workhub. The user approves or sends it
back on that screen. Where the screen lists its own approve or send-back tool (an expense payment,
a financial package), call it only after the user confirms in the chat; on any other screen, they
click approve themselves. Never approve with a Carta command outside the screen, and give no
Carta link to the item unless they ask for one.

When the Workhub doesn't open (step 3), say it couldn't open here and use the matching Carta
commands for the item, which give its review page in Carta.
