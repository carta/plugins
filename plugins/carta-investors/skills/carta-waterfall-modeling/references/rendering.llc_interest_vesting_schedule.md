# Rendering — LLC interest vesting schedule (`llc_interest_vesting_schedule` shape)

Column/row spec for `portfolio_valuations:get:llc_interest_vesting_schedule` — one interest's
per-tranche vesting schedule. Rendered **on request only**, in chat, after a holder drill (see
`references/cap-table.llc.md` §Vesting schedule for the fetch + wiring). Number formatting is
`SKILL.md` §Formatting rules.

## Response shape

```
{ interestId, asOfDate,
  totalNominalQuantity, totalVestedQuantity, totalUnvestedQuantity, accountTimezone,
  tranches: [ { state, nominalQuantity, vestedQuantity, unvestedQuantity,
      serviceCondition:        { startDate, endDate, state },          // the time leg (null-dropped)
      performanceConditions:   { actualPayoutPercentage, composeWith,
                                 items: [ { name, description,
                                            actualPayoutPercentage, minPayoutPercentage, maxPayoutPercentage,
                                            evaluationDate, isEvaluated, state } ] } } ] }  // null-dropped
```

Tranches are chronological. A tranche may carry a time (`serviceCondition`) leg, a performance
(`performanceConditions`) leg, or both.

## Caption (one line above the table)

Plan name + interest-level totals:

`{vestingPlanTemplateName} — total {totalNominalQuantity}: vested {totalVestedQuantity} / unvested {totalUnvestedQuantity}`

`vestingPlanTemplateName` comes from the **drilled interest** (`holderRows[].interests[].vestingPlanTemplateName`)
— the schedule response doesn't carry it. If the plan name is absent, use the interest name instead.

## Print — one row per tranche (chat)

| Column        | Source                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| Tranche       | index (1..n)                                                                        |
| State         | `tranche.state`                                                                     |
| Nominal       | `tranche.nominalQuantity`                                                           |
| Vested        | `tranche.vestedQuantity`                                                            |
| Unvested      | `tranche.unvestedQuantity`                                                          |
| Service start | `tranche.serviceCondition.startDate`                                               |
| Service end   | `tranche.serviceCondition.endDate`                                                 |
| Performance   | `tranche.performanceConditions.items[].name` + `actualPayoutPercentage` (achieved %), else `—` |

Format quantities / percentages / dates per `SKILL.md` §Formatting rules; null or unset → `—`. Never
fabricate a missing value.

## Answering on-demand questions (the schedule carries more than it prints)

The printed table is one row per tranche (nominal qty, state, service window, whether a performance
gate exists). The response carries more per tranche. On a direct ask, read the key off the
already-fetched schedule:

| Ask (natural language) | Key |
|---|---|
| vested / unvested units within a tranche (the split, not just state) | `tranche.vestedQuantity`, `tranche.unvestedQuantity` |
| performance condition name / description | `performanceConditions.items[].name`, `.description` |
| min / max / actual payout percentage | `performanceConditions.items[].minPayoutPercentage`, `.maxPayoutPercentage`, `.actualPayoutPercentage` |
| when is the performance condition evaluated | `performanceConditions.items[].evaluationDate` |
| has the performance condition been evaluated | `performanceConditions.items[].isEvaluated` |
| performance condition state | `performanceConditions.items[].state` |
| how conditions compose (AND/OR) | `performanceConditions.composeWith` |
| service-condition state for a tranche | `tranche.serviceCondition.state` |
| account timezone for the dates | `accountTimezone` |

Format per `SKILL.md` §Formatting rules; null-dropped — never fabricate.
