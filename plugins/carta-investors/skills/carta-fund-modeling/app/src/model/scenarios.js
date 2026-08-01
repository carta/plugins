// Scenario + XIRR engine, ported from the workbook's Scenarios / IRR by Exit
// Year / CF by Exit Year tabs.
//
// Scenario rows (per fund, per net multiple m — NET to LPs, on total LP
// paid-in including scheduled future calls):
//   LP distributions = m × paidInTotal
//   LP net profit    = (m − 1) × paidInTotal
//   GP carry         = carryRate/(1−carryRate) × LP net profit   (20% gross ⇒ 25% of net)
//   GP commit        = fund.gpCommit       (REAL recorded GP commitment; null when Carta has none — no ~1% estimate)
//   GP capital       = m × GP commit       (that co-invest at the net multiple; null when no commit recorded)
//   Net LP IRR       = XIRR(historical + scheduled flows, terminal at wind-down
//                      bringing LP distributions to m × paidInTotal)
//
// Exit-year matrix: only flows dated on/before 12/31 of the exit year count;
// the terminal lands on 12/31 of the exit year (the base column keeps the
// wind-down date) and brings cumulative LP distributions to m × the *gross*
// contributions called through that date.

import { xirr } from "./xirr.js";
import { grossProfitForLpProfit } from "./waterfall.js";

export const SCENARIO_MULTIPLES = [1, 2, 3, 5, 7, 10];

export function scenarioRow(fund, m, cfg = 0.2) {
  const wf = typeof cfg === "number" ? { carryRate: cfg } : (cfg || {});
  const paidInTotal = fund.paidInTotal; // includes scheduled future calls
  const lpDistributions = m * paidInTotal;
  const lpNetProfit = (m - 1) * paidInTotal;
  // GP carry via the fund waterfall: find the gross profit that yields this net
  // LP profit; the difference is carry. Flat case → c/(1−c)·lpNetProfit. Carry
  // exists only on profit — sub-1x outcomes pay zero, never negative.
  const gross = lpNetProfit > 0 ? grossProfitForLpProfit(lpNetProfit, paidInTotal, wf) : 0;
  const gpCarry = Math.max(0, gross - Math.max(0, lpNetProfit));
  // GP co-invest — the REAL GP commitment carried on fund.gpCommit: the fund's
  // recorded configuration commitment where present, else the GP's paid-in
  // co-investment. No modeled estimate: null only when neither exists, and the
  // co-invest columns read blank rather than inventing ~1%. gpCommit is the constant principal (m=1
  // value); gpCapital is it scaled by the net multiple — the GP's own money at exit.
  const gpCommit = fund.gpCommit != null && fund.gpCommit > 0 ? fund.gpCommit : null;
  const gpCapital = gpCommit != null ? m * gpCommit : null;
  return { multiple: m, lpDistributions, lpNetProfit, gpCarry, gpCommit, gpCapital, gpTotal: gpCarry + (gpCapital || 0) };
}

/** Terminal distribution at wind-down for net multiple m. */
export function terminalAtWindDown(fund, m) {
  return Math.max(0, m * fund.paidInTotal - fund.lpDistributed);
}

/** Projected net LP IRR for the base scenario (terminal at the wind-down date). */
export function scenarioIrr(fund, m) {
  const flows = [...fund.flows];
  const t = terminalAtWindDown(fund, m);
  if (t > 0) flows.push({ date: fund.terminalDate, amount: t });
  return xirr(flows);
}

// `exitDate` selects the IRR convention per row: an ISO date → exit-on-that-date
// (terminal there, Method A); null → wind-down terminal (Method B, back-compat).
// The app passes the fund's assumed exit horizon (default = navAsOf year-end) to
// keep the whole table on the same "exit on horizon" basis as the sidebar /
// scorecard and the per-company Deal IRR.
export function scenarioTable(fund, cfg = 0.2, spRate = 0.102, exitDate = null) {
  return SCENARIO_MULTIPLES.map((m) => {
    const row = scenarioRow(fund, m, cfg);
    // exitDate null → wind-down basis (back-compat); an ISO date → exit on it.
    const irr = exitDate == null ? scenarioIrr(fund, m) : exitDateIrr(fund, exitDate, m);
    return { ...row, netLpIrr: irr, spIrr: spRate, edge: irr == null ? null : irr - spRate };
  });
}

/**
 * IRR for an exit on a specific ISO date (`YYYY-MM-DD`): flows through that
 * date, terminal dated there and sized off gross contributions called by then,
 * bringing cumulative LP distributions to m × that gross paid-in. A future
 * `exitDate` includes any scheduled calls in the window and lengthens the
 * horizon (same multiple, later date → lower IRR).
 */
export function exitDateIrr(fund, exitDate, m) {
  const flows = fund.flows.filter((f) => f.date <= exitDate);
  if (!flows.some((f) => f.amount < 0)) return null; // nothing called yet — n/m
  const grossPaidIn = flows.reduce((s, f) => s + (f.amount < 0 ? -f.amount : 0), 0);
  const distributed = flows.reduce((s, f) => s + (f.amount > 0 ? f.amount : 0), 0);
  const terminal = Math.max(0, m * grossPaidIn - distributed);
  return xirr([...flows, { date: exitDate, amount: terminal }]);
}

/**
 * IRR for an exit in a specific calendar year: delegates to `exitDateIrr` with
 * the 12/31 year-end date. Pass year = null for the base column (all flows,
 * wind-down terminal). Kept for back-compat with the exit-year matrix.
 */
export function exitYearIrr(fund, year, m) {
  if (year == null) return scenarioIrr(fund, m);
  return exitDateIrr(fund, `${year}-12-31`, m);
}

export function exitYearMatrix(fund, years) {
  const out = {};
  for (const y of years) {
    for (const m of SCENARIO_MULTIPLES) {
      out[`${y ?? "base"}|${m}`] = exitYearIrr(fund, y, m);
    }
  }
  return out;
}
