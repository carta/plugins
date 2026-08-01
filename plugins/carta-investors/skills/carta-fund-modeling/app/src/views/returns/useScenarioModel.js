import { useMemo } from "react";
import { ALL_FUNDS } from "../../ui/components.jsx";
import { scenarioTable, scenarioRow, exitDateIrr } from "../../model/scenarios.js";
import { scenarioFund, fundIdsOf } from "../../model/funds.js";
import { waterfallCfgFor, exitHorizonFor } from "../../model/reprice.js";

// Shared per-fund scenario model for the Returns family of tabs (Power Law, LP
// Returns, GP Economics). This is the computation that used to live at the top of
// the single Scenarios view (before it was split into three tabs); it is lifted
// here verbatim so all three tabs read from ONE source of truth for the waterfall
// config, the S&P rate, the per-multiple scenario grid and the "today's marks"
// slice. Returns plain values only (no JSX) — each view renders its own sections.
export function useScenarioModel({
  snapshot, portfolio, fundStates, baseAssumptions, fundScope, setAssumption,
  exitHorizonOverrides,
}) {
  const FUND_IDS = fundIdsOf(snapshot);
  // exit modeling is inherently per-fund — when the global scope is All Funds,
  // fall back to the first fund and surface a hint to pick one
  const allMode = fundScope === ALL_FUNDS;
  const fundId = allMode ? FUND_IDS[0] : fundScope;
  // full waterfall config for this fund — carry + preferred return + GP catch-up,
  // pre-set from Carta config and overridable per fund in the active scenario
  const wf = useMemo(() => waterfallCfgFor(portfolio.assumptions, snapshot, fundId),
    [portfolio.assumptions, snapshot, fundId]);
  const carryRate = wf.carryRate;
  const setFundMap = (key, val) =>
    setAssumption(key, { ...(portfolio.assumptions[key] || {}), [fundId]: val });
  const setFundCarry = (rate) => setFundMap("carryRates", rate);
  const setFundPref = (v) => setFundMap("preferredReturns", v);
  const setFundCatchupRate = (v) => setFundMap("catchupRates", v);
  const setFundCatchupLimit = (v) => setFundMap("catchupLimits", v);
  // Assumed exit horizon (ISO date) for this fund — the single terminal date for
  // the Net LP IRR (and the per-company Deal IRR). Defaults to navAsOf year-end.
  // Merge onto the RAW override map (not the effective one) so pinning one fund
  // can't freeze other funds' derived horizons as explicit picks.
  const setExitHorizon = (dateISO) =>
    setAssumption("exitHorizon", { ...(exitHorizonOverrides || {}), [fundId]: dateISO });
  // Drop this fund's per-scenario overrides so the waterfall falls back to the
  // Carta configuration (snapshot.funds[].waterfall) again.
  const revertWaterfall = () => {
    for (const key of ["carryRates", "preferredReturns", "catchupRates", "catchupLimits"]) {
      const m = { ...(portfolio.assumptions[key] || {}) };
      delete m[fundId];
      setAssumption(key, m);
    }
  };
  const spRate = portfolio.assumptions.spRate;
  const hotRate = portfolio.assumptions.spSensitivityRate;
  // accrued carry today — the booked figure from Carta's books (carried interest
  // accrued allocation to the GP), distinct from the modeled carry-at-exit rows
  const accruedCarryToday = snapshot.baseAccruedCarry?.[fundId] ?? 0;
  const accruedCarryAsOf = snapshot.accruedCarryAsOf || snapshot.gpEconomics?.[fundId]?.accruedCarryAsOf || null;
  // carry distributed — the booked REALIZED carry paid to the GP ("carried interest
  // earned" allocation); 0/null when none has been distributed yet → card shows "—".
  const carryDistributed = snapshot.gpEconomics?.[fundId]?.carryDistributed ?? null;
  const carryDistributedAsOf = snapshot.carryDistributedAsOf || snapshot.gpEconomics?.[fundId]?.carryDistributedAsOf || null;

  const fund = useMemo(() => scenarioFund(snapshot, fundId), [snapshot, fundId]);
  // Net LP IRR convention for the whole page: a single terminal on the fund's
  // assumed exit horizon (default = navAsOf year-end, i.e. "exit now"), matching
  // the sidebar, the scorecard below, and the per-company Deal IRR — not wind-down.
  const exitDate = exitHorizonFor(portfolio.assumptions, snapshot, fundId);
  const table = useMemo(() => scenarioTable(fund, wf, spRate, exitDate), [fund, wf, spRate, exitDate]);
  const fs = fundStates.find((f) => f.id === fundId);

  // Where THIS SLICE's marks land: the implied Net TVPI if today's
  // repriced LP NAV (plus anything already distributed) were ultimately
  // delivered on total paid-in incl. scheduled future calls.
  const implied = (fs.lpNav + fs.lpDistributed) / fund.paidInTotal;
  const sliceRows = useMemo(() => {
    if (!(implied > 0)) return [...table];
    const row = scenarioRow(fund, implied, wf);
    const irr = exitDateIrr(fund, exitDate, implied);
    const slice = { ...row, netLpIrr: irr, spIrr: spRate, edge: irr == null ? null : irr - spRate, isSlice: true };
    return [...table, slice].sort((a, b) => a.multiple - b.multiple);
  }, [table, fund, implied, wf, spRate, exitDate]);

  // headline snapshot: where we'd stand if everything realized at today's
  // marks NOW — i.e. one terminal distribution at this year's exit, not the
  // far-out wind-down. The grid below is on this same "exit now" basis.
  const todayIrr = implied > 0 ? exitDateIrr(fund, exitDate, implied) : null;
  const todayEdge = todayIrr == null ? null : todayIrr - spRate;
  // GP carry at today's net position — dollars depend on the multiple, not the
  // exit year; matches the highlighted grid row's GP CARRY.
  const todayGpCarry = implied > 0 ? scenarioRow(fund, implied, wf).gpCarry : null;
  const cartaNet = (fs.baseLpNav + fs.lpDistributed) / fund.paidInTotal;

  // ---- Baseline · Carta counterparts for the scorecard comparison ----
  const baseWf = waterfallCfgFor(baseAssumptions || {}, snapshot, fundId);
  const baseSpRate = baseAssumptions?.spRate ?? 0.102;
  const baseNet = (fs.baseLpNav + fs.baseLpDistributed) / fund.paidInTotal;
  const baseIrr = baseNet > 0 ? exitDateIrr(fund, exitDate, baseNet) : null;
  const baseEdge = baseIrr == null ? null : baseIrr - baseSpRate;
  const baseGpCarry = baseNet > 0 ? scenarioRow(fund, baseNet, baseWf).gpCarry : null;

  return {
    fundId, allMode, wf, carryRate,
    setFundCarry, setFundPref, setFundCatchupRate, setFundCatchupLimit, revertWaterfall,
    setExitHorizon, exitDate,
    spRate, hotRate,
    accruedCarryToday, accruedCarryAsOf, carryDistributed, carryDistributedAsOf,
    fund, sliceRows, fs,
    implied, todayIrr, todayEdge, todayGpCarry, cartaNet,
    baseNet, baseIrr, baseEdge, baseGpCarry,
  };
}
