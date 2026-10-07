# Portfolio Valuation — Finalize

Mark a valuation candidate as **FINAL**. This is the last step in the
End Goal checklist (item 6). This file also covers **deleting** a
valuation (see **Delete a valuation**). Both are permanent, so both wait
for an explicit yes from the user.

## UX Rules

When presenting 5 or fewer choices, ask inline as plain text (no
`AskUserQuestion`) — state the question and list the options as numbered
choices in the chat message, then wait for the user's free-text reply.

## User-Facing Output Rules

Do not surface raw command names, API field names, HTTP status codes, or
numeric project/candidate IDs in chat. Speak in business terms ("company
value", "holdings value", "FINAL"). Approach names and dollar amounts in
prerequisite messaging are fine — auditors expect them.

## Prerequisites

You need a selected candidate:
- `project_id`, `candidate_id` — for the finalize call.
- `ownerId` — for the prerequisite `call_tool({"name": "portfolio_valuations__get__valuation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` check in Step 1.
- `targetId` — for the deep link.
- The company name, valuation date, and candidate name — for messaging.

These are already in context from the orchestrator. If any are missing,
ask the user to pick a valuation row from Step 3 first.

---

## Step 1: Verify prerequisites (silent)

Finalizing requires three things to be true. Verify all three **silently**
before continuing — do not narrate the calls in chat.

Call:

```json
call_tool({
  "name": "portfolio_valuations__get__valuation",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

Then check:

1. **Status is not already FINAL.** Read `candidateStatus` from the
   response. If it is already `FINAL`, do not finalize again — see Step 2A.
2. **Company value is positive.** Read `companyValue.amount`. If zero,
   negative, null or missing, prerequisite fails — see Step 2B.
3. **Holdings value is positive.** Read `valueOfHoldings.amount` (not
   `holdingsValue`, which this response doesn't have). If zero, negative,
   null or missing, prerequisite fails — see Step 2C.

If all three pass, proceed to Step 3.

If any fail, surface the corresponding fallback in Step 2 and **do not**
proceed to Step 3.

## Step 2: Prerequisite fallbacks

### 2A. Already FINAL

> "**{candidate name}** on **{company name}**'s **{valuation date}**
> valuation is already FINAL — nothing to do. {DEEP_LINK}"

Then return to the orchestrator's routing.

### 2B. Company value is zero/missing

Translate to plain language and offer a direct route to fix it:

> "I can't finalize **{candidate name}** yet — the company value is
> still zero. Set an approach and capture a value first."

Ask inline as plain text:

> **What would you like to do?**
> 1. **Set an approach now** — read `references/dive-in/set-approaches.md` and
>    follow inline.
> 2. **Open in Carta** — render the deep link.
> 3. **Cancel** — return to the orchestrator's routing.

Wait for the reply, then follow the selected option.

### 2C. Holdings value is zero/missing

Translate to plain language and offer a direct route to fix it:

> "I can't finalize **{candidate name}** yet — the holdings value is
> still zero. Run the allocation to populate it."

Ask inline as plain text:

> **What would you like to do?**
> 1. **Run allocation now** — read `references/dive-in/allocation.md` inline
>    and follow.
> 2. **Open in Carta** — render the deep link.
> 3. **Cancel** — return to the orchestrator's routing.

Wait for the reply, then follow the selected option.

## Step 3: Finalize

Finalizing can't be undone from here, so it is one of the two writes in
this skill that always waits for an explicit yes (see SKILL.md's
**Writes — save, then show what was saved**). The user's request to
finalize is not the confirmation — ask even if they said "finalize it"
or "ship it". Ask inline as plain text, with the values written out in
full:

> "Finalizing **{candidate name}** on **{company name}**'s
> **{valuation date}** valuation locks it as FINAL. This can't be undone.
>
> Company value: {companyValue, full value, e.g. $130,107,041.24}
> Holdings value: {valueOfHoldings, full value}
>
> Finalize it?"
> 1. **Yes, finalize**
> 2. **No, keep it as a draft**

Wait for the reply. Only an explicit yes continues. Anything else
cancels: say the valuation was left as a draft and return to the
orchestrator's routing.

On yes, call:

```json
call_tool({
  "name": "portfolio_valuations__mutate__candidate",
  "arguments": {
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "status": "FINAL"
  }
})
```

Verify the response shows `status: "FINAL"`. If so, proceed to Step 4
(success messaging).

If the call fails:

- **Transient error** (network/timeout/5xx): retry once. If it fails
  again, surface the manual fallback below.
- **Stale IDs** (404 or "not found"): the candidate may have been
  renamed or the project re-keyed. Re-fetch via `call_tool({"name": "portfolio_valuations__get__valuation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})` once
  to confirm IDs are still valid, then retry the mutate. If it fails
  again, surface the manual fallback.
- **Any other error**: surface the manual fallback.

**Manual fallback** (plain language, no command names or HTTP codes):

> "I couldn't finalize **{candidate name}** from here right now. You
> can flip the status to FINAL directly in Carta — the change will
> reflect the next time we look at this candidate.
> {DEEP_LINK}"

Then return to the orchestrator's routing. Do not loop or re-prompt.

## Step 4: Success messaging

On a successful finalize, surface success in plain language:

> "**{candidate name}** on **{company name}**'s **{valuation date}**
> valuation is now FINAL.
>
> Company value: {companyValue formatted as currency}
> Holdings value: {holdingsValue formatted as currency}
>
> {DEEP_LINK}"

The dollar values **are** included — the user just finalized them and
seeing them confirmed is the point of this step.

After the success block, add one inline note (no section heading, no bullet):

> 💡 I can also show the individual fund-level holdings breakdown for this valuation — note it may take up to 10 minutes for the holdings data to reflect the finalized values. Say "show fund holdings" to see it.

After success, the End Goal checklist re-derivation will mark item 6
(Status is FINAL) as ✅. The candidate is now complete.

## Delete a valuation

Deleting removes the candidate permanently, so like finalize it always
waits for an explicit yes. Only DRAFT candidates can be deleted.

1. **Check status (silent).** Use `candidateStatus` from the Step 1
   `get:valuation` call (fetch it if it isn't in context). If it is
   `FINAL` or `ARCHIVED`, say plainly that only draft valuations can be
   deleted, render the deep link, and stop.
2. **Warn and ask.** The request to delete is not the confirmation. Ask
   inline as plain text:

   > "Deleting **{candidate name}** on **{company name}**'s
   > **{valuation date}** valuation removes it permanently. This can't
   > be undone.
   >
   > Type **YES** (all capitals) to delete it. Any other reply cancels."

3. **Only an exact `YES` continues.** Anything else — "yes", "sure",
   "ok", silence — cancels: say the valuation was kept and return to the
   orchestrator's routing. Don't re-ask.
4. **Delete.**

   ```json
   call_tool({
     "name": "portfolio_valuations__delete__candidate",
     "arguments": {
       "project_id": <project_id>,
       "candidate_id": <candidate_id>
     }
   })
   ```

   On success: "**{candidate name}** on **{company name}**'s
   **{valuation date}** valuation has been deleted." Then return to the
   orchestrator's routing.

   On any failure (including not having permission to delete), don't
   retry — say plainly that it couldn't be deleted from here and render
   the deep link so the user can delete it in Carta.

## Deep link

See [`references/deep-link.md`](../deep-link.md) for URL construction.
Use **Pattern A** (project landing) since Carta has no dedicated
finalize tab. Required context: `ownerId`, `targetId`, `project_id`.
Render per deep-link.md Step 5 (a markdown link). This
is the `{DEEP_LINK}` referenced above.

## Goal-checklist contribution

Finalize is **End Goal item 6: Status is FINAL**. Once Step 3 (or the
manual flip in Carta) sets the candidate's status to FINAL, item 6
flips from ⏳ to ✅ on the next checklist re-derivation.

Once item 6 is satisfied — and assuming items 1-5 are also satisfied —
the candidate is **complete**. The orchestrator's walk-through path
ends here. The user can re-enter to start a new candidate, or move on.
