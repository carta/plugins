// Concentration & attribution — who actually drives each fund's value, and
// what the fund looks like without its winner. Slice-aware: FVs are repriced
// at the active slice's marks, so concentration responds to scenarios.
import { positionReprice, fundReprice, carryRateFor } from "./reprice.js";

/** Per-company repriced FV inside one fund. The live test matches
 *  upliftByFund exactly (includeInNav && !archived — defunct companies CAN be
 *  written off by a fund-level zero-out, which sets includeInNav on them), so
 *  this page's TVPI always agrees with the fund table. */
export function fundHoldings(companies, fundId) {
  const out = [];
  for (const c of companies) {
    if (c.archived) continue;
    const live = c.includeInNav;
    let fv = 0;
    for (const p of c.positions) {
      if (p.fundId !== fundId) continue;
      fv += positionReprice(c, p, { live }).repricedFv;
    }
    if (fv > 0.5) out.push({ id: c.id, name: c.name, fv, defunct: !!c.defunct, exited: !!c.exited && live });
  }
  return out.sort((a, b) => b.fv - a.fv);
}

function fundCtx(snapshot, portfolio, fundId, totalFv) {
  const f = snapshot.funds.find((x) => x.id === fundId);
  const base = {
    lpNav: snapshot.baseLpNav[fundId],
    lpPaidIn: f.lpPaidIn,
    lpDistributed: f.lpDistributed,
    accruedCarry: snapshot.baseAccruedCarry[fundId],
  };
  const carryRate = carryRateFor(portfolio.assumptions, fundId);
  // uplift of the slice vs Carta, fund-scoped (defunct/parked companies are flat)
  const baseFv = portfolio.companies.filter((c) => !c.archived)
    .flatMap((c) => c.positions).filter((p) => p.fundId === fundId)
    .reduce((s, p) => s + (p.cartaFv || 0), 0);
  return { base, carryRate, uplift: totalFv - baseFv, lpPaidIn: f.lpPaidIn };
}

/** Fund TVPI with a what-if move applied to one holding's value (e.g. −fv for
 *  "went to zero", +fv for "doubles") — full make-whole rerun, slice-aware. */
export function tvpiIf(snapshot, portfolio, fundId, deltaFv = 0) {
  const holdings = fundHoldings(portfolio.companies, fundId);
  const total = holdings.reduce((s, h) => s + h.fv, 0);
  const ctx = fundCtx(snapshot, portfolio, fundId, total);
  return ctx.lpPaidIn > 0 ? fundReprice(ctx.base, ctx.uplift + deltaFv, ctx.carryRate).tvpi : 0;
}

/**
 * Concentration profile for one fund at the slice's marks.
 * Share fractions are of the fund's total holdings value.
 */
export function concentration(snapshot, portfolio, fundId) {
  const holdings = fundHoldings(portfolio.companies, fundId);
  const total = holdings.reduce((s, h) => s + h.fv, 0);
  if (!holdings.length || total <= 0) return null;
  const share = (n) => holdings.slice(0, n).reduce((s, h) => s + h.fv, 0) / total;
  const ctx = fundCtx(snapshot, portfolio, fundId, total);
  const tvpi = ctx.lpPaidIn > 0 ? fundReprice(ctx.base, ctx.uplift, ctx.carryRate).tvpi : 0;
  return { holdings, total, top5: share(Math.min(5, holdings.length)), tvpi, count: holdings.length };
}

// ─── Firm-wide ("All Funds") concentration ──────────────────────────────────
// Each company's value is aggregated across EVERY fund it sits in; the what-if
// TVPI is the firm-level make-whole rerun — every fund repriced independently
// (its own carry rate and make-whole line) and re-summed, never one big fund.

/** Per-company repriced FV across all funds, with a per-fund breakdown so a
 *  what-if can move the right dollars in the right fund. Mirrors fundHoldings
 *  (non-live companies held at Carta marks; <$0.50 dropped). */
export function fundHoldingsAcrossAll(companies) {
  const out = [];
  for (const c of companies) {
    if (c.archived) continue;
    const live = c.includeInNav;
    const byFund = {};
    let fv = 0;
    for (const p of c.positions) {
      const r = positionReprice(c, p, { live }).repricedFv;
      byFund[p.fundId] = (byFund[p.fundId] || 0) + r;
      fv += r;
    }
    if (fv > 0.5) out.push({ id: c.id, name: c.name, fv, defunct: !!c.defunct, exited: !!c.exited && live, byFund });
  }
  return out.sort((a, b) => b.fv - a.fv);
}

/** Firm make-whole rerun: reprice each paid-in fund at the slice's marks
 *  (its uplift vs Carta plus any per-fund what-if delta) and roll the LP NAVs
 *  up to a firm TVPI on summed paid-in. Pure; no exit toggles (matches the
 *  per-fund concentration view). */
function firmReprice(snapshot, portfolio, perFundDelta = {}) {
  const cartaByFund = {};
  const marksByFund = {};
  for (const c of portfolio.companies) {
    if (c.archived) continue;
    const live = c.includeInNav;
    for (const p of c.positions) {
      cartaByFund[p.fundId] = (cartaByFund[p.fundId] || 0) + (p.cartaFv || 0);
      const r = positionReprice(c, p, { live }).repricedFv;
      marksByFund[p.fundId] = (marksByFund[p.fundId] || 0) + r;
    }
  }
  let lpNav = 0;
  let lpDistributed = 0;
  let lpPaidIn = 0;
  for (const f of snapshot.funds) {
    if (!(f.lpPaidIn > 0)) continue;
    const base = {
      lpNav: snapshot.baseLpNav[f.id],
      lpPaidIn: f.lpPaidIn,
      lpDistributed: f.lpDistributed,
      accruedCarry: snapshot.baseAccruedCarry[f.id],
    };
    const carryRate = carryRateFor(portfolio.assumptions, f.id);
    const uplift = (marksByFund[f.id] || 0) - (cartaByFund[f.id] || 0) + (perFundDelta[f.id] || 0);
    const r = fundReprice(base, uplift, carryRate);
    lpNav += r.lpNav;
    lpDistributed += base.lpDistributed;
    lpPaidIn += f.lpPaidIn;
  }
  return { tvpi: lpPaidIn > 0 ? (lpNav + lpDistributed) / lpPaidIn : 0, lpNav, lpDistributed, lpPaidIn };
}

/** Firm TVPI with a per-fund what-if delta (a holding's signed `byFund` map). */
export function tvpiIfAcrossAll(snapshot, portfolio, perFundDelta = {}) {
  return firmReprice(snapshot, portfolio, perFundDelta).tvpi;
}

/** Firm-wide concentration profile at the slice's marks. */
export function concentrationAcrossAll(snapshot, portfolio) {
  const holdings = fundHoldingsAcrossAll(portfolio.companies);
  const total = holdings.reduce((s, h) => s + h.fv, 0);
  if (!holdings.length || total <= 0) return null;
  const share = (n) => holdings.slice(0, n).reduce((s, h) => s + h.fv, 0) / total;
  const tvpi = firmReprice(snapshot, portfolio, {}).tvpi;
  return { holdings, total, top5: share(Math.min(5, holdings.length)), tvpi, count: holdings.length };
}
