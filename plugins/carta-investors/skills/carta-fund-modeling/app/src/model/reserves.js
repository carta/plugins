// Reserves / dry-powder model — a planning overlay on the reported figures.
//
// A venture fund's committed capital splits into: management fees & expenses
// over the fund life, capital invested into companies (at cost), and what's
// left to deploy — the "dry powder." We further earmark the dry powder between
// follow-on reserves (defending the existing book) and fresh new-deal capacity.
//
// Reported (from Carta): committed, lpPaidIn, invested-at-cost.
// Modeled (adjustable): the fee/expense load and the follow-on reserve split.
// All pure — no UI, no persistence.

import { cartaReferenceB, positionReprice } from "./reprice.js";

const clamp0 = (n) => Math.max(0, n);

/** The "no follow-on" baseline expected dilution — i.e. the dilution a company
 *  takes if you reserve nothing (the Companies-tab "None" reserve strategy).
 *  Defending it down toward 0 is what a reserve buys. Single source shared by
 *  the strategy presets and the earmarked-$ estimate below. */
export const FULL_RESERVE_DILUTION = 0.3;

/**
 * Estimated reserve capital earmarked by the current dilution posture, firm-wide.
 * Pro-rata defense costs ≈ (dilution defended) × (current stake value): to hold
 * your slice as the company raises, you re-invest that share of your marked
 * position. So per live company, earmark = (FULL_RESERVE_DILUTION − futureDilution)
 * × its current marked FV (pre-dilution). Realized/defunct/archived and not-in-NAV
 * companies contribute nothing. Returns { total, byFund }. An estimate, not a call.
 */
export function reservesEarmarked(portfolio) {
  let total = 0;
  const byFund = {};
  for (const c of (portfolio.companies || [])) {
    if (c.archived || c.realized || c.defunct || !c.includeInNav) continue;
    const defended = clamp0(FULL_RESERVE_DILUTION - (c.futureDilution ?? 0));
    if (defended <= 0) continue;
    for (const p of c.positions) {
      // stake value being defended = marked FV BEFORE the dilution haircut
      const markFv = positionReprice(c, p, { live: true, dilution: 0 }).repricedFv;
      const amt = defended * markFv;
      total += amt;
      byFund[p.fundId] = (byFund[p.fundId] || 0) + amt;
    }
  }
  return { total, byFund };
}

/** Cost basis deployed per fund + company count per fund, from the slice. */
function deployedByFund(portfolio) {
  const cost = {}, companies = {};
  for (const c of portfolio.companies || []) {
    if (c.archived) continue;
    for (const p of c.positions || []) cost[p.fundId] = (cost[p.fundId] || 0) + (p.cost || 0);
    for (const fid of new Set((c.positions || []).map((p) => p.fundId))) {
      companies[fid] = (companies[fid] || 0) + 1;
    }
  }
  return { cost, companies };
}

/**
 * @param {object} opts
 *   feeLoad        — default lifetime fees+expenses as a share of committed (default 0.20)
 *   followOnRatio  — default share of dry powder earmarked for follow-ons (default 0.50)
 *   spvFeeLoad     — SPVs are single-deal and fee-light; their default fee load (default 0)
 *   feeLoads       — per-fund fee-load overrides, keyed by fund id ({} default)
 *   followOnRatios — per-fund follow-on-split overrides, keyed by fund id ({} default)
 *   recyclingRatio  — default recycling uplift on committed (default 0 — recycling off)
 *   recyclingRatios — per-fund recycling overrides, keyed by fund id ({} default)
 * Returns { funds:[…], totals:{…} } where each fund carries the full
 * committed-capital breakdown plus deployment %, uncalled capital, and the
 * follow-on / new-deal split of its dry powder.
 */
export function computeReserves(snapshot, portfolio, opts = {}) {
  const { feeLoad = 0.2, followOnRatio = 0.5, spvFeeLoad = 0, feeLoads = {}, followOnRatios = {},
          recyclingRatio = 0, recyclingRatios = {} } = opts;
  const { cost, companies } = deployedByFund(portfolio);

  const funds = (snapshot.funds || []).map((f) => {
    const isSpv = f.type === "SPV";
    const committed = f.committed || 0;
    const paidIn = f.lpPaidIn || 0;
    const invested = cost[f.id] || 0; // active book at cost (realized exits excluded)
    // per-fund overrides win; otherwise the SPV/fund default
    const load = feeLoads[f.id] ?? (isSpv ? spvFeeLoad : feeLoad);
    const ratio = followOnRatios[f.id] ?? followOnRatio;
    // recycling provisions (LPA) let the fund reinvest proceeds — modeled as an
    // uplift on committed that raises the investable ceiling. The uplift IS the
    // cap; fees stay on the base committed amount (recycling raises deployable
    // capacity, not the fee base).
    const recycling = recyclingRatios[f.id] ?? recyclingRatio;
    const recyclable = committed * recycling;
    const feeReserve = committed * load;
    const investable = clamp0(committed * (1 + recycling) - feeReserve);
    // Capital already put to work. The active book undercounts funds that have
    // realized exits (those positions leave the registry), so floor deployed at
    // called capital — an LP-called dollar isn't fresh dry powder to redeploy.
    const deployed = Math.max(invested, paidIn);
    const reserves = clamp0(investable - deployed); // dry powder still to deploy
    const followOn = reserves * ratio;
    const newDeal = reserves - followOn;
    const uncalled = clamp0(committed - paidIn); // not yet called from LPs
    const deployedPct = investable > 0 ? Math.min(1, deployed / investable) : 1;
    return {
      id: f.id, name: f.name, type: f.type || "Fund", isSpv, vintage: f.vintage,
      committed, paidIn, invested, deployed, feeReserve, investable, recyclable,
      reserves, followOn, newDeal, uncalled, deployedPct,
      feeLoad: load, followOnRatio: ratio, recycling, // effective per-fund knobs (incl. defaults)
      companies: companies[f.id] || 0,
    };
  });

  const sum = (k) => funds.reduce((s, x) => s + (x[k] || 0), 0);
  const totals = {
    committed: sum("committed"), paidIn: sum("paidIn"), invested: sum("invested"), deployed: sum("deployed"),
    feeReserve: sum("feeReserve"), investable: sum("investable"), recyclable: sum("recyclable"),
    reserves: sum("reserves"), followOn: sum("followOn"), newDeal: sum("newDeal"),
    uncalled: sum("uncalled"),
    coreReserves: funds.filter((f) => !f.isSpv).reduce((s, x) => s + x.reserves, 0),
  };
  totals.deployedPct = totals.investable > 0 ? Math.min(1, totals.deployed / totals.investable) : 1;
  return { funds, totals };
}

/**
 * Firm-wide count of new deals the dry powder can fund = Σ floor(new-deal capacity
 * ÷ that fund's average check). The average check is the per-fund override
 * (`avgChecks[id]`) else the fund's own derived check (invested ÷ companies backed)
 * else the firm average across funds with a deployment history, else a $2M floor —
 * identical to the per-fund figure the Reserves allocation section shows. A count
 * of within-fund ratios, so it's valid even across currencies. Shared by the
 * Reserves header stat and the scenario report so the two can't drift.
 */
export function newDealCount({ funds }, avgChecks = {}) {
  const withHistory = funds.filter((f) => !f.isSpv && f.companies > 0 && f.invested > 0);
  const firmAvgCheck = withHistory.length
    ? withHistory.reduce((s, f) => s + f.invested, 0) / withHistory.reduce((s, f) => s + f.companies, 0)
    : 0;
  const defaultCheck = (f) => (f.companies > 0 ? f.invested / f.companies : 0) || firmAvgCheck || 2_000_000;
  return funds.reduce((sum, f) => {
    const check = avgChecks[f.id] ?? defaultCheck(f);
    return sum + (check > 0 && f.newDeal > 0 ? Math.floor(f.newDeal / check) : 0);
  }, 0);
}

/** Funds that are nearly tapped out (deployment ≥ threshold) — reserve-discipline flags. */
export function nearlyDeployed(reserves, threshold = 0.85) {
  return reserves.funds.filter((f) => !f.isSpv && f.deployedPct >= threshold);
}

/**
 * Optimal reserve allocation — rank live holdings by the expected return on the
 * next dollar invested, and suggest how to split each fund's follow-on reserve.
 *
 * Next dollar return (marginal) = markValuation ÷ entryValuation × (1 − dilution), in
 * absolute $:
 *   • markValuation = the company's expected post-money at the scenario marks.
 *     Uses the explicit $B mark (`valuationB × 1e9`) when set; otherwise derives it
 *     from the holding's repriced FV ÷ the firm's ownership fraction (marks are
 *     stored as multiples, so FV/ownership recovers the company valuation).
 *   • entryValuation = the last priced round post-money (the price the next dollar
 *     pays), falling back to the Carta-mark-implied valuation when there's no round.
 *   • dilution = expected future dilution, applied once (mark is pre-dilution).
 * Reserve where it's highest. Needs a company `valuationB` OR an `ownership[id].pct`
 * to recover a valuation; companies with neither are skipped.
 *
 * Suggested split: within each fund's follow-on pool (from computeReserves), each
 * company's share is weighted by its upside (marginal − 1); companies with no
 * accretive next dollar (marginal ≤ 1) get $0. Pure.
 */
export function optimalReserveAllocation(snapshot, portfolio, opts = {}) {
  const { ownership = {}, ...reserveOpts } = opts;
  const { funds } = computeReserves(snapshot, portfolio, reserveOpts);
  const followOnByFund = {}, fundName = {};
  for (const f of funds) { followOnByFund[f.id] = f.followOn || 0; fundName[f.id] = f.name; }

  const rows = [];
  for (const c of portfolio.companies || []) {
    if (c.archived || c.realized || c.defunct) continue;
    const costByFund = {};
    let fvMark = 0, fvCarta = 0; // company FV at scenario marks (ex-dilution) / at Carta marks
    for (const p of c.positions || []) {
      costByFund[p.fundId] = (costByFund[p.fundId] || 0) + (p.cost || 0);
      fvMark += positionReprice(c, p, { live: true, dilution: 0 }).repricedFv;
      fvCarta += p.cartaFv || 0;
    }
    const invested = Object.values(costByFund).reduce((s, v) => s + v, 0);
    if (!(invested > 0)) continue;
    // primary fund = where most of the cost sits (follow-on comes from its pool)
    const fundId = Object.keys(costByFund).sort((a, b) => costByFund[b] - costByFund[a])[0];
    const pct = ownership[c.id]?.pct;
    const refB = cartaReferenceB(c); // $B mark basis, when the mark is basis-mode
    // marked company valuation ($): explicit $B mark, else FV ÷ ownership
    const markVal = c.valuationB != null ? c.valuationB * 1e9 : (pct > 0 ? fvMark / pct : null);
    // Carta-mark-implied valuation ($): the fallback entry when there's no credible round
    const cartaImplied = refB != null ? refB * 1e9 : (pct > 0 ? fvCarta / pct : null);
    // entry valuation ($) = last round post-money, but only when it's a credible
    // price — ≥ $1M and ≥ the fund's cost basis (guards near-$0 / stale round data
    // that would otherwise explode the multiple); else the Carta-implied valuation.
    const lastRaw = c.lastRound && c.lastRound.postMoney > 0 ? c.lastRound.postMoney : null;
    const usableLast = lastRaw != null && lastRaw >= Math.max(1e6, invested) ? lastRaw : null;
    const entryVal = usableLast ?? cartaImplied;
    if (!(markVal > 0) || !(entryVal > 0)) continue;
    const dilution = Math.max(0, Math.min(1, c.futureDilution ?? 0));
    const marginal = (markVal / entryVal) * (1 - dilution);
    rows.push({ id: c.id, name: c.name, fundId, fundName: fundName[fundId] || fundId,
                // the fund's follow-on pool this row draws from — 0 means the fund is
                // fully deployed (no dry powder to allocate), so suggested is $0 for
                // EVERY holding in it regardless of upside. Lets the UI distinguish
                // "no pool available" from "pool exists but this dollar isn't accretive".
                fundFollowOn: followOnByFund[fundId] || 0,
                marginal, entryVal, markVal, dilution, invested, lastRound: c.lastRound || null });
  }

  // split each fund's follow-on pool by upside weight (marginal − 1)
  const weightByFund = {};
  for (const r of rows) weightByFund[r.fundId] = (weightByFund[r.fundId] || 0) + Math.max(0, r.marginal - 1);
  for (const r of rows) {
    const w = Math.max(0, r.marginal - 1);
    const totW = weightByFund[r.fundId] || 0;
    r.suggested = totW > 0 ? (followOnByFund[r.fundId] || 0) * (w / totW) : 0;
  }
  rows.sort((a, b) => b.marginal - a.marginal);
  return { companies: rows, totalFollowOn: funds.reduce((s, f) => s + (f.followOn || 0), 0) };
}
