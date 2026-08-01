// Scenario Deal IRR — a per-company, gross deal-level IRR that reacts to the
// valuation slider, anchored to Carta's reported deal IRR.
//
// Why this exists: the Companies table shows a live MOIC (value ÷ cost) but the
// Deal IRR column is Carta's reported money-weighted `TEMPORAL_DEAL_IRR`, frozen
// at build time. For a fixed holding period IRR is just MOIC annualized, so a
// moving MOIC beside a static IRR is internally contradictory. This computes the
// reprice's *effect* on IRR at an assumed exit date and shifts Carta's number by
// that delta — so the cell ties out to Carta when untouched and moves with the
// slider. It is GROSS of fund fees/carry (a deal-level, not LP-level, figure) and
// a transparent estimate, not Carta's engine.

import { xirr } from "./xirr.js";

// Entry cashflow legs (one negative leg per funded position at its mark date),
// shared by scenarioDealIrr and the exit-timing curve.
export function entryLegsFor(positions) {
  return (positions || [])
    .filter((p) => (p.cost || 0) > 0 && p.markDate)
    .map((p) => ({ date: p.markDate, amount: -p.cost }));
}

// Shift Carta's anchor IRR by our base→now XIRR delta so a Carta-tied value tracks
// the lever while staying anchored; floored at -1 (IRR can't underflow -100%).
// Callers handle a null `now` (the fallback differs by use).
//
// Valid when `base`/`now` share the SAME holding period (only the terminal VALUE
// differs, e.g. scenarioDealIrr's reprice slider at a fixed exitDate) — an additive
// shift stays bounded there. Do NOT reuse this for a varying HOLDING PERIOD (base
// = "exit now", now = "exit N quarters out"): `base` can be enormous for a young,
// high-multiple position (annualizing a short hold), and the delta swamps the
// anchor within a couple of quarters, permanently pinning the result at the -1
// floor even though the real annualized return only decays gracefully toward 0 as
// the exit recedes. Use anchorIrrByRatio for that case instead.
export function anchorIrr(cartaIrr, base, now) {
  if (cartaIrr == null) return now;
  if (base == null) return cartaIrr;
  return Math.max(-1, cartaIrr + (now - base));
}

// Multiplicative anchor — in growth-factor (1+r) space — for a varying holding
// period (the exit-timing curve): stable regardless of how large `base` is,
// because it's a ratio rather than a subtraction. See anchorIrr's comment above
// for why the additive form breaks down in this case.
export function anchorIrrByRatio(cartaIrr, base, now) {
  if (now == null) return null;
  if (cartaIrr == null) return now;
  if (base == null || base <= -1) return cartaIrr;
  return Math.max(-1, ((1 + cartaIrr) * (1 + now)) / (1 + base) - 1);
}

/**
 * Anchored scenario Deal IRR for one company.
 *
 * @param {object}   a
 * @param {Array}    a.positions       - company positions [{cost, markDate}]
 * @param {string}   a.exitDate        - assumed exit date (ISO `YYYY-MM-DD`)
 * @param {?number}  a.cartaIrr        - Carta's reported deal IRR (the anchor); null if none
 * @param {number}   a.baseValue       - residual FV at Carta marks (pre-reprice)
 * @param {number}   a.repricedValue   - residual FV at the current slider marks
 * @param {number}   [a.proceeds=0]    - realized proceeds already received
 * @param {boolean}  [a.realized=false]- fully exited → locked to Carta's IRR
 * @returns {?number} annualized IRR (decimal), or null when it can't be formed
 *
 * Convention: `base`/`now` are our own exit-on-`exitDate` XIRRs at the base and
 * repriced values; the returned value is `cartaIrr + (now - base)`. At baseline
 * marks `now === base` so the delta is 0 and the result equals `cartaIrr` for
 * ANY exitDate. When Carta has no reported IRR we surface the raw `now` estimate
 * so the cell still tracks MOIC (caller labels it as an estimate).
 */
export function scenarioDealIrr({
  positions, exitDate, cartaIrr, baseValue, repricedValue, proceeds = 0, realized = false,
}) {
  // Realized deals have already exited — the slider can't restate history.
  if (realized) return cartaIrr ?? null;

  const entryLegs = entryLegsFor(positions);
  if (!entryLegs.length) return cartaIrr ?? null;

  // A modeled total loss (FV → 0, no proceeds) is a -100% deal IRR, not an
  // unformable stream. Return it explicitly; otherwise xirr sees no positive
  // flow, returns null, and we'd wrongly snap back to Carta's reported IRR.
  const terminal = (repricedValue || 0) + (proceeds || 0);
  if (terminal <= 0) return -1;

  const irrAt = (v) => xirr([...entryLegs, { date: exitDate, amount: (v || 0) + (proceeds || 0) }]);
  const base = irrAt(baseValue);
  const now = irrAt(repricedValue);

  // Degenerate stream (e.g. entry == exitDate, or no positive terminal) → xirr
  // returns null; fall back to Carta's number rather than showing a broken delta.
  if (now == null) return cartaIrr ?? null;
  return anchorIrr(cartaIrr, base, now);
}
