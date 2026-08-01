// Fund-level orchestration: joins the Carta snapshot (read-only market data)
// with the editable portfolio document (companies, toggles, assumptions) into
// live fund states. All pure — UI and persistence live elsewhere.

import { upliftByFund, fundReprice, waterfallCfgFor, positionReprice, BOOKED_CARRY_RATE } from "./reprice.js";
import { splitProfit } from "./waterfall.js";
import { cohortPercentile } from "./benchmarks.js";

/** Fund ids in display order, derived from the snapshot (no hardcoded list). */
export const fundIdsOf = (snapshot) => (snapshot?.funds ?? []).map((f) => f.id);

/** Days between two ISO dates. */
export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function isStaleMark(markDate, referenceDate, staleDays = 90) {
  if (!markDate) return false;
  return daysBetween(markDate, referenceDate) > staleDays;
}

/** Inputs the scenario engine needs for one fund. */
export function scenarioFund(snapshot, fundId) {
  const f = snapshot.funds.find((x) => x.id === fundId);
  const cf = snapshot.cashflows[fundId];
  return {
    id: fundId,
    committed: f.committed,
    gpCommit: f.gpCommit ?? null, // real recorded GP commitment; null when Carta has none on file
    lpDistributed: f.lpDistributed,
    paidInTotal: cf.paidInTotal,
    flows: cf.flows,
    terminalDate: cf.terminalDate,
    windDownYear: snapshot.windDownYear[fundId],
  };
}

/**
 * Live state for every fund given the registry and assumptions.
 * Returns [{id, name, vintage, committed, lpPaidIn, lpDistributed, lpNav,
 *           dpi, rvpi, tvpi, netLpIrr, accruedCarry, gpCapitalNav, uplift,
 *           percentile, cohort, baseLpNav, baseTvpi, baseAccruedCarry}]
 */
export function computeFundStates(snapshot, portfolio) {
  const uplifts = upliftByFund(portfolio.companies);
  // exit toggles: proceeds at the slice's marks, per fund (defunct can't exit)
  const exits = {};
  for (const c of portfolio.companies) {
    if (!c.exited || c.archived || c.defunct || !c.includeInNav) continue;
    for (const p of c.positions) {
      const { repricedFv } = positionReprice(c, p, { live: true });
      exits[p.fundId] = (exits[p.fundId] || 0) + repricedFv;
    }
  }
  // fund asset base at Carta marks — denominator for the GP-capital reprice
  // ratio (held-at-Carta companies count at FV with zero uplift)
  const fvByFund = {};
  for (const c of portfolio.companies) {
    if (c.archived) continue;
    for (const p of c.positions) fvByFund[p.fundId] = (fvByFund[p.fundId] || 0) + (p.cartaFv || 0);
  }
  return snapshot.funds.map((f) => {
    const cfg = waterfallCfgFor(portfolio.assumptions, snapshot, f.id);
    const carryRate = cfg.carryRate;
    // The rate Carta's booked accrued carry sits at IS the fund's own baseline
    // (LPA/config) carry rate, else the flat default — NOT a hardcoded 20%. The
    // Baseline slice seeds this same rate, so at Baseline the reprice is neutral
    // (factor 1): carry and LP NAV tie out exactly to Carta's books. The carry-rate
    // dial then reprices the booked carry relative to this anchor.
    const bookedRate = f.waterfall?.carryRate ?? BOOKED_CARRY_RATE;
    const base = {
      lpNav: snapshot.baseLpNav[f.id],
      lpPaidIn: f.lpPaidIn,
      lpDistributed: f.lpDistributed,
      accruedCarry: snapshot.baseAccruedCarry[f.id],
    };
    const uplift = uplifts[f.id] || 0;
    const r = fundReprice(base, uplift, cfg, bookedRate);
    // GP capital rides the fund's marks: booked GP-entity NAV scaled by the
    // holdings' reprice ratio. Estimate — the GP entity may also hold cash.
    const fvBase = fvByFund[f.id] || 0;
    const repriceRatio = fvBase > 0 ? Math.max(0, (fvBase + uplift) / fvBase) : 1;
    const gpCapitalNavLive = f.gpCapitalNav * repriceRatio;

    // ---- exit waterfall: sold-at-mark value converts from paper to cash ----
    // LPs take 100% of proceeds until cumulative distributions reach paid-in;
    // above the make-whole line cash splits (1−c)/c, so carry banks for real.
    // The remaining paper keeps the anchored split (banked carry comes out of
    // accrued first, floored at zero). Total value at the slice's marks is
    // conserved — exits move it between columns, never create or destroy it.
    const exitFv = Math.min(exits[f.id] || 0, Math.max(0, r.lpNav + r.accruedCarry));
    const lpFirst = Math.min(exitFv, Math.max(0, f.lpPaidIn - base.lpDistributed));
    const restAboveWhole = exitFv - lpFirst;
    // Above the make-whole line, proceeds split through the full waterfall
    // (pref + catch-up). Flat case: gpCarry = carryRate·rest, lpProfit = (1−c)·rest.
    const { gpCarry: carryBanked, lpProfit: lpFromRest } = splitProfit(restAboveWhole, f.lpPaidIn, cfg);
    const lpDistributed = base.lpDistributed + lpFirst + lpFromRest;
    const paper = r.lpNav + r.accruedCarry - exitFv;
    const accruedCarry = Math.max(0, Math.min(r.accruedCarry - carryBanked, paper));
    const lpNav = paper - accruedCarry;
    const dpi = f.lpPaidIn > 0 ? lpDistributed / f.lpPaidIn : 0;
    const rvpi = f.lpPaidIn > 0 ? lpNav / f.lpPaidIn : 0;
    const tvpi = f.lpPaidIn > 0 ? (lpNav + lpDistributed) / f.lpPaidIn : 0;
    const marks = snapshot.benchmarks[f.id]?.tvpi ?? null;
    // LV predates Carta's benchmark era — its row exists with all-null marks
    const cohort = marks && Object.values(marks).some((v) => v != null) ? marks : null;
    return {
      id: f.id,
      name: f.name,
      vintage: f.vintage,
      committed: f.committed,
      lpPaidIn: f.lpPaidIn,
      lpDistributed,
      lpNav,
      dpi,
      rvpi,
      tvpi,
      netLpIrr: f.netLpIrr, // Carta net LP IRR at base marks; reprices don't restate it
      // fund-total gross-of-carry MOIC (value ÷ invested capital). It reprices:
      // moving company marks scales the fund's FV by repriceRatio, and MOIC ∝ FV.
      grossMoic: f.grossMoic != null ? f.grossMoic * repriceRatio : null,
      baseGrossMoic: f.grossMoic ?? null, // Carta booked (unrepriced) — for the vs-baseline delta
      accruedCarry,
      carryBanked, // GP cash from exit toggles — paid through the real waterfall
      exitedFv: exitFv,
      gpCapitalNav: f.gpCapitalNav, // booked (Carta) — the workbook reconciliation anchor
      gpCapitalNavLive,
      uplift,
      lpShare: r.lpShare,
      carryShare: r.carryShare,
      carryRate,
      waterfall: cfg, // full waterfall config (carry + pref + catch-up)
      currency: f.currency ?? null, // fund reporting currency (for the mixed-currency guard)
      baseLpNav: base.lpNav,
      baseLpDistributed: base.lpDistributed,
      baseTvpi: base.lpPaidIn > 0 ? (base.lpNav + base.lpDistributed) / base.lpPaidIn : 0,
      baseAccruedCarry: base.accruedCarry,
      cohort,
      cohortSize: snapshot.benchmarks[f.id]?.cohortSize ?? null,
      percentile: cohort ? cohortPercentile(tvpi, cohort) : null,
      cohortStanding: f.cohortStanding,
    };
  });
}

/** Firm-level rollup across all funds. Monetary totals and ratios sum across
 *  funds, so they're only meaningful in a single currency. When the funds with
 *  capital span more than one reporting currency we flag `mixedCurrency` and
 *  expose no single `currency` — callers must not present a combined total
 *  (never sum across currencies). */
export function firmRollup(fundStates) {
  const sum = (k) => fundStates.reduce((s, f) => s + (f[k] || 0), 0);
  const committed = sum("committed");
  const lpPaidIn = sum("lpPaidIn");
  const lpDistributed = sum("lpDistributed");
  const lpNav = sum("lpNav");
  const accruedCarry = sum("accruedCarry");
  const carryBanked = sum("carryBanked");
  const gpCapitalNav = sum("gpCapitalNav");
  const gpCapitalNavLive = sum("gpCapitalNavLive");
  const uplift = sum("uplift");
  // currencies among funds that actually carry capital (ignore empty/GP shells)
  const currencies = [...new Set(
    fundStates.filter((f) => (f.committed || f.lpPaidIn || f.lpNav) && f.currency).map((f) => f.currency)
  )];
  const mixedCurrency = currencies.length > 1;
  return {
    committed,
    lpPaidIn,
    lpDistributed,
    lpNav,
    accruedCarry,
    carryBanked,
    gpCapitalNav,
    gpCapitalNavLive,
    uplift,
    currency: mixedCurrency ? null : (currencies[0] ?? null),
    mixedCurrency,
    dpi: lpPaidIn > 0 ? lpDistributed / lpPaidIn : 0,
    tvpi: lpPaidIn > 0 ? (lpNav + lpDistributed) / lpPaidIn : 0,
  };
}

/** Firm-level rollup at the BASE (unrepriced, no-exit) scenario — the
 *  baseline counterpart to firmRollup(), for computing firm-wide vs-baseline
 *  deltas (e.g. the Companies sidebar's "Firm impact" panel). `lpPaidIn`
 *  doesn't change between scenarios (it's real historical cash-in, not
 *  reprice-driven), so it's shared with firmRollup() rather than re-summed.
 *  GP carry's baseline mirrors firmRollup()'s `accruedCarry + carryBanked +
 *  gpCapitalNavLive` definition at base: baseAccruedCarry, no banked carry
 *  (exit toggles are scenario-only edits — the base scenario never sets
 *  `exited: true`), and gpCapitalNav at its booked (repriceRatio = 1) value. */
export function firmBaseRollup(fundStates) {
  const sum = (k) => fundStates.reduce((s, f) => s + (f[k] || 0), 0);
  const lpPaidIn = sum("lpPaidIn");
  const lpDistributed = sum("baseLpDistributed");
  const lpNav = sum("baseLpNav");
  // GP carry = carried interest only (baseline accrued; baseline carry-banked is 0
  // with no exits toggled). Mirrors the live firmGpCarry, which excludes the GP's
  // own capital NAV — so the baseline scenario shows a zero carry delta.
  const gpCarry = sum("baseAccruedCarry");
  return {
    lpPaidIn,
    lpDistributed,
    lpNav,
    gpCarry,
    dpi: lpPaidIn > 0 ? lpDistributed / lpPaidIn : 0,
    tvpi: lpPaidIn > 0 ? (lpNav + lpDistributed) / lpPaidIn : 0,
  };
}
