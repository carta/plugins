// Deployment runway — how long each fund's fresh new-deal capacity lasts at its
// recent deployment pace. Joins the Reserves model (new-deal $ left, capital at
// cost, company count) with the pacing series (new companies per quarter):
//   avg check     = invested-at-cost ÷ companies backed
//   pace ($/qtr)  = (new companies in the trailing window ÷ window) × avg check
//   runway        = new-deal capacity ÷ pace
// SPVs (single-deal, no ongoing deployment) and funds with no recent pacing are
// excluded — an idle fund has no meaningful runway. All pure — no UI.

import { quarterOf, addMonths, monthDiff } from "./pacing.js";

/**
 * @param reserves  output of computeReserves(snapshot, portfolio, …)
 * @param pacing    pacing.json ({ pulledAt, monthly: { fundId: [[ym, n], …] } })
 * @param opts { paceWindowQuarters = 4, nearThreshold = 0.85, avgChecks = {} }
 *   avgChecks — per-fund average-check overrides (keyed by fund id); when set,
 *               replaces the derived invested ÷ companies check for that fund.
 * @returns { asOfYm, asOfQuarter, funds: [{ id, name, newDeal, invested,
 *            companies, avgCheck, companiesPerQtr, pacePerQtr, runwayQuarters,
 *            runwayMonths, exhausts, nearlyDeployed }], totals }
 *          funds[] holds only non-SPV funds that have recent deployment pace.
 */
export function deploymentRunway(reserves, pacing, opts = {}) {
  const { paceWindowQuarters = 4, nearThreshold = 0.85, avgChecks = {} } = opts;
  const monthly = pacing?.monthly || {};
  const asOfYm = (pacing?.pulledAt || "").slice(0, 7);
  if (!asOfYm) return { asOfYm: null, asOfQuarter: null, funds: [], totals: { newDeal: 0, pacePerQtr: 0 } };
  const windowStartYm = addMonths(asOfYm, -paceWindowQuarters * 3);

  // new companies for a fund within the trailing window (inclusive of asOf month)
  const recentCount = (fid) =>
    (monthly[fid] || []).reduce((n, [ym, c]) => (ym > windowStartYm && ym <= asOfYm ? n + c : n), 0);

  const funds = [];
  for (const f of reserves.funds) {
    if (f.isSpv) continue;
    if (!(f.newDeal > 0)) continue; // no fresh capacity left → no runway to report
    const companies = f.companies || 0;
    const invested = f.invested || 0;
    // user override wins; otherwise derive from this fund's invested ÷ companies
    const avgCheck = avgChecks[f.id] ?? (companies > 0 ? invested / companies : 0);
    const companiesPerQtr = recentCount(f.id) / paceWindowQuarters;
    const pacePerQtr = companiesPerQtr * avgCheck;
    if (!(pacePerQtr > 0) || !(avgCheck > 0)) continue; // idle / no recent pace → no runway

    const runwayQuarters = f.newDeal / pacePerQtr;
    const runwayMonths = runwayQuarters * 3;
    const exhausts = quarterOf(addMonths(asOfYm, Math.round(runwayMonths)));
    // whole new deals the new-deal capacity buys at this fund's average check
    const newDeals = Math.floor(f.newDeal / avgCheck);
    funds.push({
      id: f.id, name: f.name, newDeal: f.newDeal, invested, companies,
      avgCheck, newDeals, companiesPerQtr, pacePerQtr, runwayQuarters, runwayMonths,
      exhausts, nearlyDeployed: f.deployedPct >= nearThreshold,
    });
  }
  // shortest runway first — the funds that need attention soonest
  funds.sort((a, b) => a.runwayQuarters - b.runwayQuarters);

  const totals = {
    newDeal: funds.reduce((s, f) => s + f.newDeal, 0),
    newDeals: funds.reduce((s, f) => s + f.newDeals, 0),
    pacePerQtr: funds.reduce((s, f) => s + f.pacePerQtr, 0),
  };
  totals.runwayQuarters = totals.pacePerQtr > 0 ? totals.newDeal / totals.pacePerQtr : null;
  return { asOfYm, asOfQuarter: quarterOf(asOfYm), funds, totals };
}

// re-exported for callers that want the window math without re-importing pacing
export { monthDiff };
