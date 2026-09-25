# LLC cap table — Waterfall Modeling

Step 6a.5 detail: fetch, render, and drill the root issuer's LLC cap table. Reached only
when `cap_table_command` resolves to the LLC reader (`llc_cap_table_summary` noun) —
`SKILL.md` §Step 6a.5 gates on it and skips otherwise, so by the time you read this the
cap table IS available. Column/row layout is the
command-matched render doc (rendering map, top of `SKILL.md`); number formatting is
`SKILL.md` §Formatting rules.

## Commands available via this doc

These are the only cap-table-family commands in scope while this doc is active (noun
`llc_cap_table_summary`). **Call only the commands listed here** — never one owned by another detail
doc. The list grows as new LLC readers ship.

- `llc_cap_table_summary` — the cap-table reader (this doc) and its holder drill (same command + `holder_ids`).
- `portfolio_valuations:get:llc_liquidation_preferences` — the LLC liquidation-preferences companion, rendered on request (§Liquidation preferences below).
- `portfolio_valuations:get:llc_interest_vesting_schedule` — a drilled interest's vesting schedule, rendered on request after a holder drill (§Vesting schedule below).

## Fetch once per batch, not per scenario

It's keyed only by `issuerId` + `asOfDate` — equity value never enters it, so a batch of
same-date runs (`SKILL.md` §Step 5 Running several scenarios at once) shares **one** cap
table: fetch and show it once, then print only each scenario's results — **don't re-fetch,
re-render (chat), or re-write the Cap Table tab (excel)** for the other scenarios in that
batch. Scope this to the one batch only; a separately initiated run re-fetches (the
underlying data may have changed since), even at the same date. A different `asOfDate` is
always its own fetch (the "different date" path below).

## Fetch

Show the LLC cap table for the root issuer **as of the waterfall date, before any
allocations table** — never render results first unless the user asked to skip it. This
reader is **independent** of the run — it fetches by issuer + date, not by execution graph:

```
call_tool({"name": "<cap_table_command with all ':' replaced by '__'>", "arguments": {
  "issuerId": "<root.issuer_id from Step 3>",
  "asOfDate": "<WATERFALL_DATE from Step 4, as a FULL ISO timestamp, e.g. 2025-06-15T00:00:00Z>"
}})
// asOfDate MUST be a full ISO-8601 timestamp — normalize the collected WATERFALL_DATE
// (YYYY-MM-DD) to "<date>T00:00:00Z". A bare date is rejected.
// issuerId is the ROOT issuer — root.issuer_id from Step 3, always present on the LLC
// cap-table path (equals the picked issuer when you picked the root).
→ { issuerId, asOfDate,
    view,                        // "OVERVIEW_GROUPS" (holder groups) | "SHARE_CLASS_SUMMARY"
    interestTypeColumns: [ "<type name>", ... ],   // ordered column list (one per type)
    interestTypes: [ { typeId, typeName, stereotype, outstandingQuantity, outstandingPercentage,
                       fullyDiluted, fullyDilutedOwnershipPercentage, vestedQuantity, unvestedQuantity,
                       investedCapital, returnedInvestedCapital, unreturnedInvestedCapital,
                       timeOutstanding, performanceOutstanding, dualOutstanding } ],
    equityPlanPool: { fullyDiluted, fullyDilutedOwnershipPercentage },
    grandTotal:     { ...same cell fields as an interestTypes entry, no type identity },
    holders: [ { holderId, holderName, holderGroup, outstandingQuantity, fullyDiluted } ],
    groups:  [ { rowName, typeBreakdowns: [ {typeId, typeName, +ownership} ], total: {cell w/ money} } ]
             // groups[] present only when view == OVERVIEW_GROUPS
  }
// Money (investedCapital / returnedInvestedCapital / unreturnedInvestedCapital) is on every
// cell. Percentages are numbers ALREADY ×100 (e.g. 49.81 = 49.81%) — never scale them.
```

**View discriminator:** `view == OVERVIEW_GROUPS` when the issuer has holder groups
(`groups[]` present); else `SHARE_CLASS_SUMMARY` (render `interestTypes[]` directly).
The two views differ only in whether group rows appear — see **Cap table rendering** below
for layout.

## Excel

**If `<SURFACE>` is `excel`:** the root issuer's summary (group overview or
share-class summary) goes to the **"Cap Table"** tab — no inline table. **How and when
to write is governed by the command's results doc §Excel — fetch & write order and
`references/excel-output.md`**: one consolidated `execute_office_js`, Cap Table block
before the Waterfall block — never as a separate write. The holder drill is **not written
to the sheet by default** — it's offered later in the follow-up menu (both surfaces) and
renders in chat; write it to the sheet only if the user explicitly asks.

## Chat rendering

**Chat** (default) — render inline. **Phrase the lead in past tense** — the run
already happened (Step 5). Render one short line, then the table:

> Here's the cap table for **{root display name}** as of **{WATERFALL_DATE}**:

Render the summary per **Cap table rendering** below (read the command-matched render spec
first). After the table, a **light prompt** via `AskUserQuestion` — default is to proceed
to results:

> "Drill into a holder, or show the allocation results?"
> Options:
>
> - "Show the allocation results" ← recommended
> - "Drill into a holder" — only when `holders` is non-empty
> - "Show liquidation preferences" — the liq-pref companion (§Liquidation preferences below)
> - "Cap table as of a different date" — re-fetch without re-running (below)

On **"Drill into a holder"** → run the **Holder drill** flow below, then repeat this
prompt. On **"Show the allocation results"** → continue to the results fetch (`SKILL.md` §Step 6). On **"Show liquidation
preferences"** → run the **Liquidation preferences** flow below, then repeat this prompt.
On **"Cap table as of a different date"** → ask for the date, re-fetch with the **same `issuerId`** (the root,
per the fetch above) and only a new `asOfDate` (no re-run), render again, and repeat this prompt.
This changes only the cap table, so also **suggest** in one line: _"Want me to re-run the waterfall
as of that date too, with the same options?"_ — on yes, restart from Step 5 with the new date.

## Cap table rendering

Read the doc mapped to `cap_table_command` first (rendering map, top of
`SKILL.md`) — the column/row/header spec; render straight through (no recompute). No
doc matches → say so and proceed. Excel always writes the full wide matrix; chat
uses it only when `interestTypeColumns.length ≤ 5`, else the narrow summary — see
that doc, §Chat vs Excel.

## Holder drill (chat by default; Excel sheet only on request)

Users drill by **name**, never a UUID; `holders[]` (in every response) is the discovery list —
each entry is `{ holderId, holderName, holderGroup }` (drill with the `holderId`s).

1. **Show the holder names compactly — all of them, not one per line.** Group by `holderGroup`:
   one line per group, names comma-separated (a single wrapped comma-separated line when there are
   no groups). Listing every name lets the user pick; the compact layout keeps it short. Only if the
   list is genuinely large (> ~40) ask which group first (or "type a name"), then list that subset.
   Show a holder's group beside its name only when two holders share a name.
2. **The user names a holder** (free text — too many for a 4-option picker); match it against
   `holders[]` `holderName`. If a name maps to **more than one** id (same name, different groups),
   pass **all** of them — never dedupe or force one. Drilling is per **holder** — there is no group
   drill (a holder group like "Founders" isn't a drill target).
3. **Re-fetch** the same command with `holder_ids: [<id>, …]` (+ the locked `issuerId` / `asOfDate`).
   That ADDS `holderRows[]` on top of the summary — one entry per id, each with its own
   `holderGroup`. Render it as an extra table **in chat** per the render spec's **Holder drill**
   section (appends Pref Accrued/Returned + the Vested/Unvested split).
4. **After the drill table renders, gate the vesting offer on whether a drilled interest has a plan** —
   read each drilled interest's `vestingPlanTemplateName` (`holderRows[].interests[]`):
   - **Any has a plan** → **offer the vesting schedule** via `AskUserQuestion` (`Show vesting schedule` ·
     `Back to menu`) — see **§Vesting schedule** below.
   - **None have a plan** (e.g. Common — `vestingPlanTemplateName` null) → there's no schedule; **say so in
     one line** (e.g. _"A1-1 is Common — no vesting schedule."_) — never skip silently to the menu.
   This is the only place vesting is offered (both drill entry points reach it here), then continue as the
   caller directed (repeat the light prompt, or return to the follow-up menu).

## Vesting schedule (on request — after a holder drill)

Normally reached from the **Holder drill** step 4 offer above. If the user instead asks for a vesting
schedule **directly, without having drilled a holder yet** (e.g. "show the vesting schedule for <holder>"),
there's no `interestId` yet — so **run the Holder drill fetch for that holder first** (steps 1–3, to get the
`interestId`) and **skip step 4's offer** — the user already asked for vesting, so go straight to "Pick the
interest" below.

**Pick the interest — only ones with a plan.** Offer just the drilled interests whose
`vestingPlanTemplateName` is non-null (`holderRows[].interests[]`) — a null-plan interest (e.g. Common) has no
schedule, so **never offer it**; if that drops any, note it in one line (_"A1-1 is Common — no schedule;
skipped."_). Present the rest as `AskUserQuestion` options **plus "All interests"** (loops the per-interest
call over those same plan-bearing ones). One plan-bearing interest → skip the picker. **More than 4** → list
them compactly and take a **free-text** name matched against `holderRows[].interests[].interestName` (shown as
`↳↳ {interestName}` sub-rows in the drill table). On selection, fetch that interest's schedule and render it in
chat. Read `references/rendering.llc_interest_vesting_schedule.md` first, then:

```
call_tool({"name": "portfolio_valuations__get__llc_interest_vesting_schedule", "arguments": {
  "interest_id": "<interestId from the drilled holderRows[].interests[]>"
  // optional "asOfDate": "<YYYY-MM-DD>" for a historical snapshot; omit for today
}})
→ { interestId, totalNominalQuantity, totalVestedQuantity, totalUnvestedQuantity, accountTimezone,
    tranches: [ { state, nominalQuantity, vestedQuantity, unvestedQuantity, serviceCondition, performanceConditions } ] }
```

- `interest_id` is the **drilled interest's** `interestId` (from `holderRows[].interests[]`) — an interest
  id, not a holder id.
- The caption's plan name comes from that same drilled interest (`vestingPlanTemplateName`); the schedule
  response doesn't carry it (render doc §Caption).
- Render the tranche table per the render doc, in chat.
- **If `<SURFACE>` is `excel`, you MUST offer the write before returning to any menu.** After the chat
  render, offer via `AskUserQuestion` to add the schedule to the **Vesting** tab (see
  `references/excel-output.md` §Vesting schedule) — the sheet write happens only on an explicit yes.
- Return to the menu after.

Errors: `403` / `404` / any → one line that the vesting schedule isn't available; never block results.

## Liquidation preferences (on request)

On a **direct ask** — or when the user picks **"Show liquidation preferences"** from the cap-table
light prompt or the **Explore the cap table** follow-up sub-menu (`references/follow-up.md`) — fetch the
per-interest-type configuration and render it as a companion beside the cap table. Never render it unless
the user asks. Read `references/rendering.llc_liquidation_preferences.md` first, then:

```
call_tool({"name": "portfolio_valuations__get__llc_liquidation_preferences", "arguments": {
  "interest_issuer_id": "<root.issuer_id from Step 3>"
  // optional "asOf": "<YYYY-MM-DD>" for a historical snapshot; omit for today
}})
→ { interestTypes: [ { interestTypeId, prefix, behaviors: {...}, traits: {...} } ] }
```

- `interest_issuer_id` is the **root** issuer — the same `root.issuer_id` used for the cap-table
  fetch above. This command keys on `interest_issuer_id`, **not** the cap table's `issuerId`.
- `asOf` is a bare `YYYY-MM-DD` (unlike the cap table's full ISO timestamp); omit to default to today.
- **Row labels:** the response carries only `interestTypeId` + `prefix` — join `interestTypeId` to the
  cap table's `interestTypes[].typeId` for `typeName` (render doc §Row label).
- Render the two tables per the render doc, in chat, beside the cap table.
- **If `<SURFACE>` is `excel`, you MUST offer the write before returning to any menu.** After the chat
  render, offer via `AskUserQuestion` to add the two tables to the **Cap Table** tab (see
  `references/excel-output.md` §Liquidation preferences) — the sheet write happens only on an explicit yes.

Errors: `403` / `404` / any → one line that liquidation preferences aren't available; never block results.

## Error handling (never block results on the cap table)

- "still running" / not-ready → offer to retry the same fetch; if declined, proceed to the results fetch.
- `403` → say the user can't view this company's cap table; `404` / any other error → one line
  that the cap table isn't available. Either way, proceed to the results fetch — its failure must not stop
  results.
