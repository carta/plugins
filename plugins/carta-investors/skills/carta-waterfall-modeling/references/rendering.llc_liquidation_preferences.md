# Rendering — LLC liquidation preferences (`llc_liquidation_preferences` shape)

Column/row spec for `portfolio_valuations:get:llc_liquidation_preferences` — the
per-interest-type rights & preferences *configuration* used in the waterfall. Rendered
**on request only**, as a companion beside the LLC cap table (see
`references/cap-table.llc.md` §Liquidation preferences for the fetch + wiring). Number
formatting is `SKILL.md` §Formatting rules.

## Response shape

```
{ interestTypes: [ { interestTypeId, prefix,
      behaviors: { liquidationMultiplierBehaviorType, participatingBehaviorType,
                   participationCapBehaviorType, preferredReturnBehaviorType,
                   equityConversionBehaviorType },        // on/off type enums — reference-only
      traits:    { liquidationMultiplierType, liquidationMultiplierValue,
                   participatingValue, participationCapType, participationCapValue,
                   originalIssuePrice, investedCapitalAmount,
                   thresholdValue, thresholdValueType,
                   equityConversionType, equityConversionValue,
                   accrualPeriod, accrualRate, accrualStartDate,
                   compoundingPeriod, dayCountConvention, interestPayout } } ] }
```

One entry per interest type. **Every printed value lives under `traits`.** `interestTypeId`
is an id and `prefix` a short code — neither is the display name; join for the label (below).

## Row label — join to the cap table

The command carries only `interestTypeId` + `prefix`, not the display name. Join each
`interestTypes[i].interestTypeId` to the cap table's `interestTypes[].typeId` (from
`llc_cap_table_summary`, already fetched) and use that entry's `typeName` as the row label.
No match → fall back to `prefix`.

## Print — two tables (chat)

Render two compact tables, one interest type per row, in the cap table's type order. Values
are under each type's `traits`.

**Table 1 — Economics**

| Column        | Source (`traits.…`)         | Note                                                |
| ------------- | --------------------------- | --------------------------------------------------- |
| Interest Type | `typeName` (joined) / `prefix` | row label                                        |
| OIP           | `originalIssuePrice`        | original issue price                                |
| Conv. ratio   | `equityConversionValue`     | conversion *price* is corp-only → `—` on LLC        |
| Multiplier    | `liquidationMultiplierValue`| e.g. `1.5×`; `—` if none                            |
| Participating | `participatingValue`        | Yes / No                                            |
| Cap           | `participationCapValue`     | `—` if none                                         |
| Threshold     | `thresholdValue`            | LLC PIU hurdle; blank for capital interests         |

**Table 2 — Dividends / preferred return**

| Column        | Source (`traits.…`)                                   |
| ------------- | ----------------------------------------------------- |
| Interest Type | `typeName` (joined) / `prefix`                        |
| Dividend      | `interestPayout`                                      |
| Cumulative    | derived from `interestPayout` (dividend type); `—` if not determinable |
| Rate          | `accrualRate`                                         |
| Accrual       | `accrualPeriod`                                       |
| Compounding   | `compoundingPeriod`                                   |

Formatting: money / prices / rates / percentages per `SKILL.md` §Formatting rules; null or
unset → `—`. Never fabricate a missing value.

## Answering on-demand questions (the command returns more than it prints)

Each interest type carries `traits` and `behaviors` beyond the printed columns. On a direct
ask for a specific interest type, read the key off the already-fetched response (no re-fetch).
Keys are under the type's `traits` unless noted:

| Ask (natural language) | Key |
|---|---|
| original issue price / OIP | `originalIssuePrice` |
| accrual start date | `accrualStartDate` |
| accrual period / how often it accrues | `accrualPeriod` |
| compounding period | `compoundingPeriod` |
| day-count convention | `dayCountConvention` |
| interest payout / how preferred return is paid | `interestPayout` |
| equity conversion ratio / conversion type | `equityConversionValue`, `equityConversionType` |
| liquidation multiple type | `liquidationMultiplierType` |
| participation cap type | `participationCapType` |
| distribution threshold / hurdle | `thresholdValue`, `thresholdValueType` |
| invested capital amount (per type) | `investedCapitalAmount` |
| is <behavior> enabled (multiplier / participating / cap / preferred return / conversion) | `behaviors.{liquidationMultiplier,participating,participationCap,preferredReturn,equityConversion}BehaviorType` |

Format per `SKILL.md` §Formatting rules; null-dropped — never fabricate.
