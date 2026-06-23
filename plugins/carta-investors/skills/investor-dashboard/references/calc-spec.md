# Scenario calc engine — spec (`web/js/calc.js`)

> **This is a transparent ESTIMATE, not Carta's official waterfall (Niagara).** Niagara is a
> company-level, server-side, cap-table-tenant-gated engine and cannot be called live from the browser
> in firm context. `calc.js` implements a simplified **European whole-fund** waterfall so the dashboard
> can recompute instantly as the user edits assumptions. The UI must surface this caveat (see SKILL/plan).

## Inputs

`baseline` (written by the skill from Carta Fund Admin data):
- `fund`: `{ name, currency }`
- `terms`: `{ carryPct, hurdlePct, gpCommitPct, catchUp, distributionType }` — pulled from fund-properties
  where available, else defaults (`carryPct 0.20`, `hurdlePct 0.08`, `gpCommitPct 0.02`, `catchUp true`).
- `capital`: `{ committedCapital, contributedCapital, cumulativeDistributions, totalMgmtFees, dryPowder,
  fundSize, fundStartDate, fundAgeYears?, avgCheckSize? }`
- `deals[]`: `{ id, name, invested (total_cost), fmv (remaining_value), realized (total_proceeds),
  ownershipPct (0..1), investmentDate, status, moic }`
- `cashflows[]`: `{ date, amount }` — LP-net dated flows (<0 contribution, >0 distribution) for IRR.
  Sourced from `JOURNAL_ENTRIES` by `event_type`. If absent, IRR is approximated and flagged.

`scenario` (the user's "plan"):
- `termOverrides`: any of `carryPct, hurdlePct, gpCommitPct, catchUp`
- `deals[dealId]`: `{ followOnReserve?, exitValuation?, exitDate?, exitMultipleOnReserve? }`
- `avgCheckSize?`

## Per-deal projection (`projectDeal`)
- `investedTotal = invested + followOnReserve`.
- **With an exit assumption:** `baseProceeds = ownershipPct × exitValuation`. The follow-on participates
  at `exitMultipleOnReserve` (default = `baseProceeds / invested`, the deal's projected exit multiple):
  `exitProceeds = baseProceeds + followOnReserve × reserveMultiple`; `residualFMV = 0`.
- **Without an exit assumption:** held at mark → `exitProceeds = 0`, `residualFMV = fmv + followOnReserve`.
- `dealValue = realized + exitProceeds + residualFMV`.

## Fund aggregation
- `totalInvested = Σ investedTotal`; `newExitProceeds = Σ exitProceeds`; `residualNAV = Σ residualFMV`.
- `totalDistributions = cumulativeDistributions + newExitProceeds`.
- `totalValue = totalDistributions + residualNAV` → this is the **distributable** at full liquidation.

## European whole-fund waterfall (`runWaterfall`)
On `distributable` against `contributed = contributedCapital`, `lpShare = 1 − gpCommitPct`:
1. **Return of capital:** `roc = min(distributable, contributed)`.
2. **Preferred return:** `prefTarget = contributed × ((1+hurdlePct)^prefYears − 1)`; `pref = min(rem, prefTarget)`.
   `prefYears` = years from `fundStartDate` to the terminal exit date (else current fund age).
3. **GP catch-up (full):** `catchUpTarget = carryPct/(1−carryPct) × pref`; `catchUp = min(rem, catchUpTarget)`.
4. **Carry split:** `gpSplit = rem × carryPct`, `lpSplit = rem − gpSplit`.
- `gpCarry (promote) = catchUp + gpSplit`.
- `netProceedsLP = (roc + pref) × lpShare + lpSplit`; `netProceedsGP = (roc + pref) × gpCommitPct + gpCarry`.
- Identity: tiers sum to `distributable`; `netProceedsLP + netProceedsGP = distributable`.

## Metrics
- **Gross MOIC** = `totalValue / totalInvested`.
- **Net TVPI (LP)** = `netProceedsLP / contributedLP` (`contributedLP = contributed × lpShare`).
- **Projected DPI** = net TVPI (full-liquidation model distributes everything). Historical DPI comes from baseline.
- **Net IRR (LP)** = XIRR (bisection) over dated flows: historical LP `cashflows` + the *incremental* net
  LP proceeds placed at exit dates (weighted by each deal's exit proceeds). No dated history → approximate
  with a single contribution at fund start + terminal distribution, and `netIRRApproximate = true`.

## Deals remaining (`capacity`)
- `avgCheckSize` = scenario override, else `capital.avgCheckSize`, else `Σ invested / #deals`.
- `capitalForNewDeals = max(0, dryPowder − Σ followOnReserve)`.
- `dealsRemaining = floor(capitalForNewDeals / avgCheckSize)`.

## Budget vs forecast (`computeDiff`)
`computeBaseline` = `compute(baseline, {deals:{}})` (marks held, no reserves). `computeDiff` returns
`{ budget, forecast, deltas }` for grossMOIC, netTVPI, netIRR, netProceedsLP, gpCarry, dealsRemaining.

## Known simplifications / exclusions (surface in UI)
Per-LP carry terms / exemptions / reduced carry, hurdle exceptions, side letters, multiple LP classes,
GP-commitment fee offset, management-fee recycling, **liquidation preferences / preferred stack** (proceeds
assume `ownership% × equity value`), dilution between now and exit, and American (deal-by-deal) carry.
All are out of scope for v1 and must be listed in the Scenario view's estimate banner.
