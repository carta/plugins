// Fund-level orchestration: joins the Carta snapshot (read-only market data)
// with the editable portfolio document (companies, toggles, assumptions) into
// live fund states. All pure — UI and persistence live elsewhere.

import { upliftByFund, fundReprice, waterfallCfgFor, positionReprice, BOOKED_CARRY_RATE,
         secondaryEvents, hasSecondaryPlan, retainedFraction } from "./reprice.js";
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
 * Run a fund's liquidity events in order, converting paper value into cash.
 * Cash below the paper given up is a realized loss (a secondary priced under the mark).
 * Recycled cash is reinvested and never reaches the waterfall.
 *
 * @param events [{date, paper, cash, recyclePct, terminal}] — terminal runs last
 * @returns {lpDistributed, carryBanked, paperOut, cashIn, realizedLoss, recycled,
 *           secondaryCash, legs}
 */
export function applyLiquidityEvents(events, opts) {
  const { lpPaidIn = 0, lpDistributed0 = 0, availablePaper = 0, cfg, recycleCap = Infinity } = opts;
  let paper = Math.max(0, availablePaper);
  let lpDistributed = lpDistributed0;
  let carryBanked = 0, paperOut = 0, cashIn = 0, realizedLoss = 0, recycled = 0, secondaryCash = 0;
  const legs = [];
  const ordered = [...events].sort((a, b) => {
    if (!!a.terminal !== !!b.terminal) return a.terminal ? 1 : -1;
    const [x, y] = [String(a.date || ""), String(b.date || "")];
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (const e of ordered) {
    const wantPaper = Math.max(0, e.paper || 0);
    if (wantPaper <= 0 || paper <= 0) continue;
    const takePaper = Math.min(wantPaper, paper);
    // Clamping paper has to clamp the cash with it, or a partly-honoured event
    // would pay out at full size against a shrunken position.
    const cash = Math.max(0, (e.cash || 0) * (takePaper / wantPaper));
    paper -= takePaper;
    paperOut += takePaper;
    cashIn += cash;
    realizedLoss += takePaper - cash;
    let payable = cash;
    if (!e.terminal) {
      secondaryCash += cash;
      const share = Math.max(0, Math.min(1, e.recyclePct || 0));
      const take = Math.min(cash * share, Math.max(0, recycleCap - recycled));
      recycled += take;
      payable -= take;
    }
    if (payable <= 0) continue;
    const lpFirst = Math.min(payable, Math.max(0, lpPaidIn - lpDistributed));
    const { gpCarry, lpProfit } = splitProfit(payable - lpFirst, lpPaidIn, cfg);
    lpDistributed += lpFirst + lpProfit;
    carryBanked += gpCarry;
    if (!e.terminal && e.date) legs.push({ date: e.date, amount: lpFirst + lpProfit });
  }
  return { lpDistributed, carryBanked, paperOut, cashIn, realizedLoss, recycled, secondaryCash, legs };
}

/**
 * Live state for every fund given the registry and assumptions.
 * Returns [{id, name, vintage, committed, lpPaidIn, lpDistributed, lpNav,
 *           dpi, rvpi, tvpi, netLpIrr, accruedCarry, gpCapitalNav, uplift,
 *           invested, fv, baseFv, percentile, cohort, baseLpNav, baseTvpi,
 *           baseAccruedCarry}]
 */
export function computeFundStates(snapshot, portfolio) {
  const uplifts = upliftByFund(portfolio.companies);
  const navAsOf = snapshot?.source?.navAsOf || null;
  // The terminal exit sells only the RETAINED stake (defunct can't exit) —
  // secondaries already sold the rest, each on its own date and at its own price.
  const exits = {};
  const secondaries = {};
  for (const c of portfolio.companies) {
    if (c.archived || c.defunct || !c.includeInNav) continue;
    const retained = retainedFraction(c);
    for (const p of c.positions) {
      if (hasSecondaryPlan(c)) {
        for (const e of secondaryEvents(c, p, { navAsOf })) {
          (secondaries[p.fundId] = secondaries[p.fundId] || []).push(e);
        }
      }
      if (!c.exited) continue;
      const { repricedFv } = positionReprice(c, p, { live: true });
      exits[p.fundId] = (exits[p.fundId] || 0) + repricedFv * retained;
    }
  }
  // Per fund: FV at Carta marks (also the GP-capital reprice denominator) and
  // cost basis. Split by position fundId, so cross-fund companies sum to firm total.
  const fvByFund = {};
  const costByFund = {};
  for (const c of portfolio.companies) {
    if (c.archived) continue;
    for (const p of c.positions) {
      fvByFund[p.fundId] = (fvByFund[p.fundId] || 0) + (p.cartaFv || 0);
      costByFund[p.fundId] = (costByFund[p.fundId] || 0) + (p.cost || 0);
    }
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

    // Value at the slice's marks is conserved EXCEPT for `realizedLoss`: a
    // secondary sold below the mark destroys the difference.
    const recycling = (portfolio.assumptions?.recyclingRatios || {})[f.id] ?? 0;
    const ev = applyLiquidityEvents(
      [...(secondaries[f.id] || []).map((e) => ({
         ...e, recyclePct: e.recyclePct != null ? e.recyclePct : recycling })),
       { terminal: true, paper: exits[f.id] || 0, cash: exits[f.id] || 0 }],
      { lpPaidIn: f.lpPaidIn,
        lpDistributed0: base.lpDistributed,
        availablePaper: r.lpNav + r.accruedCarry,
        cfg,
        // An LPA caps recycling at a share of committed, not per sale. No
        // provision configured → honour the per-sale share the user set.
        recycleCap: recycling > 0 ? Math.max(0, f.committed * recycling) : Infinity },
    );
    const { lpDistributed, carryBanked } = ev;
    const paper = r.lpNav + r.accruedCarry - ev.paperOut;
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
      carryBanked, // GP cash from every liquidity event — through the real waterfall
      exitedFv: ev.paperOut, // paper value converted to cash across every event
      secondaryProceeds: ev.secondaryCash, // cash from partial sales before the exit
      secondaryLegs: ev.legs, // dated LP distributions, for the scenario IRRs
      realizedLoss: ev.realizedLoss, // mark value lost selling below the mark
      recycled: ev.recycled, // secondary cash reinvested instead of distributed
      invested: costByFund[f.id] || 0, // cost basis — fixed, doesn't reprice
      fv: fvBase + uplift,
      baseFv: fvBase, // FV at Carta marks — for the vs-baseline delta
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
  const invested = sum("invested");
  const fv = sum("fv");
  const secondaryProceeds = sum("secondaryProceeds");
  const realizedLoss = sum("realizedLoss");
  const recycled = sum("recycled");
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
    invested,
    fv,
    secondaryProceeds,
    realizedLoss,
    recycled,
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
    fv: sum("baseFv"), // firm-wide FV at Carta marks — baseline for the FV delta
    dpi: lpPaidIn > 0 ? lpDistributed / lpPaidIn : 0,
    tvpi: lpPaidIn > 0 ? (lpNav + lpDistributed) / lpPaidIn : 0,
  };
}
