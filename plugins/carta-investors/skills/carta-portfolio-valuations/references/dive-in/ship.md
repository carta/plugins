# Portfolio Valuation — Finalize

Mark a valuation candidate as **FINAL** (End Goal item 6). This file
also covers **Delete a valuation**.

Approach names and amounts in prerequisite and success messaging are fine.

## Prerequisites

You need a selected candidate:
- `project_id`, `candidate_id` — for the finalize call.
- `ownerId` — for the `get:valuation` check in Step 1.
- `targetId` — for opening its page in the dashboard MCP App.
- The company name, valuation date, and candidate name — for messaging.

These are already in context from the orchestrator. If any are missing,
ask the user to pick a valuation row from Step 3 first.

---

## Step 1: Verify prerequisites (silent)

Finalizing requires three things to be true. Verify all three **silently**
before continuing — do not narrate the calls in chat.

Call `get:valuation`, then check:

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
> valuation is already FINAL — nothing to do."

Then return control.

### 2B. Company value is zero/missing

Translate to plain language and offer a direct route to fix it:

> "I can't finalize **{candidate name}** yet — the company value is
> still zero. Set an approach and capture a value first."

Ask:

> **What would you like to do?**
> 1. **Set an approach now** — read `references/dive-in/set-approaches.md` and
>    follow inline.
> 2. **Cancel** — return control.

Wait for the reply, then follow the selected option.

### 2C. Holdings value is zero/missing

Translate to plain language and offer a direct route to fix it:

> "I can't finalize **{candidate name}** yet — the holdings value is
> still zero. Run the allocation to populate it."

Ask:

> **What would you like to do?**
> 1. **Run allocation now** — read `references/dive-in/allocation.md` inline
>    and follow.
> 2. **Cancel** — return control.

Wait for the reply, then follow the selected option.

## Step 3: Finalize

Finalize waits for an explicit yes (SKILL.md **Exceptions: finalize and
delete always need an explicit yes**) — ask even if they said "finalize
it" or "ship it". Write the values out in full:

> "Finalizing **{candidate name}** on **{company name}**'s
> **{valuation date}** valuation locks it as FINAL. This can't be undone.
>
> Company value: {companyValue, full value, e.g. 130,107,041.24}
> Holdings value: {valueOfHoldings, full value}
>
> Finalize it?"
> 1. **Yes, finalize**
> 2. **No, keep it as a draft**

Wait for the reply. Only an explicit yes continues. Anything else
cancels: say the valuation was left as a draft and return control.

On yes, re-run Step 1's `get:valuation` first. The user can finalize on the
dashboard's valuation page too, so it may already be FINAL by now. If it is,
don't call the write: show the Step 2A message and stop. Otherwise call:

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
  renamed or the project re-keyed. Re-fetch `get:valuation` once
  to confirm IDs are still valid, then retry the mutate. If it fails
  again, surface the manual fallback.
- **Any other error**: surface the manual fallback.

**Manual fallback** (plain language, no command names or HTTP codes):

> "I couldn't finalize **{candidate name}** from here right now. You
> can flip the status to FINAL on the valuation's page in Carta's
> valuations dashboard — the change will reflect the next time we look at this
> candidate."

Then return control. Do not loop or re-prompt.

## Step 4: Success messaging

On a successful finalize, surface success in plain language:

> "**{candidate name}** on **{company name}**'s **{valuation date}**
> valuation is now FINAL.
>
> Company value: {companyValue, full value}
> Holdings value: {valueOfHoldings, full value}"

Refresh the dashboard MCP App (`references/dashboard-view.md` **Refresh it after a change**); don't move the view. Then end the turn by offering to open the updated valuation page (SKILL.md **Writes → End the turn by offering to open the updated valuation**).

The values **are** included — seeing them confirmed is the point of this
step.

After the success block, add one inline note (no section heading, no bullet):

> 💡 I can also show the individual fund-level holdings breakdown for this valuation — note it may take up to 10 minutes for the holdings data to reflect the finalized values. Say "show fund holdings" to see it.

## Delete a valuation

Only DRAFT candidates can be deleted.

1. **Check status (silent).** Call `get:valuation` and read
   `candidateStatus` (never from context). If it is `FINAL` or `ARCHIVED`,
   say plainly that only draft valuations can be deleted, and stop.
2. **Warn and ask.** The request to delete is not the confirmation. Ask:

   > "Deleting **{candidate name}** on **{company name}**'s
   > **{valuation date}** valuation removes it permanently. This can't
   > be undone.
   >
   > Type **YES** (all capitals) to delete it. Any other reply cancels."

3. **Only an exact `YES` continues.** Anything else — "yes", "sure",
   "ok", silence — cancels: say the valuation was kept and return control. Don't re-ask.
4. **Delete.** First re-read `get:valuation`: the status may have changed
   on the valuation's page while the user answered. If `candidateStatus` is
   no longer `DRAFT`, give step 1's message and stop. Otherwise call:

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
   **{valuation date}** valuation has been deleted." Refresh the
   dashboard MCP App (`references/dashboard-view.md` **Refresh it after a
   change**); don't move the view. Then return control.

   On any failure (including not having permission to delete), don't
   retry — say plainly that it couldn't be deleted from here and that the
   user can delete it on the valuation's page in Carta's valuations
   dashboard, and offer to take them there (SKILL.md **Page navigation → After an
   action, offer instead of moving**).
