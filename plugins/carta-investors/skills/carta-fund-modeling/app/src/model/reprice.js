// Reprice engine — linear reprice of each position's Carta FV from its mark
// basis (the implied company valuation the mark sits at) to the live input
// valuation. Uplift splits (1 − carry) to LP NAV and carry to accrued carry.
//
// Carry framing reconciliation: 20% gross carry with no hurdle means the GP
// takes c of gross profit, LPs keep (1 − c) — so GP carry equals c/(1−c) of
// LP *net* profit (20% gross ⇔ 25% of LP net profit). Same economics, two
// framings; everything here works off the gross rate c.
//
// Carry flows through the fund waterfall (src/model/waterfall.js): preferred
// return + GP catch-up layered on the base carry rate. It degrades EXACTLY to
// the old flat carry when preferredReturn = 0 and catchupRate = 0.

import { splitProfit } from "./waterfall.js";
import { fundExitProceeds } from "./liqpref.js";
import { fmtB } from "../ui/format.js";

// ── Liquidation-preference waterfall mode (per-company scenario toggle) ─────────
// When a company carries a Carta cap table (company.capTable) and the user flips
// `waterfallMode` on, the company's valuation slider is read as an EXIT company
// (equity) value and the fund's FV becomes its actual proceeds through the
// preference stack (model/liqpref.js) — non-linear, with the preference floor —
// instead of the flat `cartaFv × multiple` line. Off (the default) → unchanged.

/** True if the company has an embedded Carta cap table with share classes. */
export function companyHasCapTable(c) {
  return !!(c && c.capTable && c.capTable.classes && c.capTable.classes.length);
}

/** True if this company should reprice through the liquidation waterfall. */
export function companyIsWaterfall(c) {
  return !!(c && c.waterfallMode && companyHasCapTable(c));
}

/** A reference "current" exit company value ($ absolute) for a cap-table company:
 *  its last priced-round post-money if known, else Σ (class shares × OIP) as a
 *  rough as-issued post-money. 0 when neither is available. */
export function companyReferenceExit(c) {
  if (c.lastRound && c.lastRound.postMoney > 0) return c.lastRound.postMoney;
  const ct = c.capTable;
  if (ct && ct.classes) {
    const s = ct.classes.reduce((a, cl) => a + (cl.shares || 0) * (cl.oip || 0), 0);
    if (s > 0) return s;
  }
  return 0;
}

/** The exit company (equity) value in $ absolute the waterfall is evaluated at:
 *  the valuation slider (stored in $B) when set, else the reference exit. */
export function companyExitValueAbs(c) {
  if (c.valuationB != null) return c.valuationB * 1e9;
  return companyReferenceExit(c);
}

/**
 * Per-position repriced FV, WATERFALL-AWARE. The non-waterfall path is identical
 * to `repricePosition` with the caller's gating (so all existing behavior and
 * tests are preserved); the waterfall path distributes the company's total fund
 * proceeds (from the preference stack) across positions in proportion to their
 * Carta FV, so per-fund NAV rollups stay consistent with the Companies tab.
 * @param opts { live=true, dilution } — `live` gates the scenario (false → held at
 *   Carta marks); `dilution` overrides the company's futureDilution.
 */
export function positionReprice(company, position, opts = {}) {
  const live = opts.live !== false;
  const dil = opts.dilution != null ? opts.dilution : company.futureDilution ?? 0;
  if (live && companyIsWaterfall(company)) {
    const totalFv = company.positions.reduce((s, p) => s + (p.cartaFv || 0), 0);
    const wfFv = fundExitProceeds(company.capTable, companyExitValueAbs(company)).proceeds;
    const keep = 1 - Math.max(0, Math.min(1, dil || 0));
    const share = totalFv > 0 ? (position.cartaFv || 0) / totalFv : 0;
    const repricedFv = wfFv * share * keep;
    return { repricedFv, uplift: repricedFv - (position.cartaFv || 0) };
  }
  const val = live ? company.valuationB : null;
  const mult = live ? company.markMultiple ?? 1 : 1;
  const d = live ? dil : 0;
  return repricePosition(position, val, mult, d);
}

/**
 * Repriced FV for one position. Two modes, same linear engine:
 *  - basis mode: the position has a mark basis (the implied company valuation
 *    its Carta mark sits at) → repriced = FV × (valuationB / basis)
 *  - multiple mode: no documented basis → repriced = FV × markMultiple
 *    (1.0 = held at the Carta mark; 0 = written off)
 */
export function repricePosition(position, valuationB, markMultiple = 1, dilution = 0) {
  const { cartaFv, markBasisB } = position;
  // Expected future dilution haircuts the value that flows to the fund: the
  // repriced FV is scaled by (1 − dilution). Applied relative to the Carta mark,
  // so a company held flat with dilution set still marks below book.
  const keep = 1 - Math.max(0, Math.min(1, dilution || 0));
  if (markBasisB != null && markBasisB > 0 && valuationB != null) {
    const repricedFv = cartaFv * (valuationB / markBasisB) * keep;
    return { repricedFv, uplift: repricedFv - cartaFv };
  }
  const m = markMultiple == null || !isFinite(markMultiple) ? 1 : Math.max(0, markMultiple);
  const repricedFv = cartaFv * m * keep;
  return { repricedFv, uplift: repricedFv - cartaFv };
}

/**
 * Aggregate uplift per fund across a company registry.
 * companies: [{archived, includeInNav, valuationB, positions: [{fundId, cartaFv, markBasisB, ...}]}]
 * Archived or excluded companies contribute nothing (held at Carta marks).
 */
export function upliftByFund(companies) {
  const byFund = {};
  for (const c of companies) {
    if (c.archived || !c.includeInNav) continue;
    for (const p of c.positions) {
      const { uplift } = positionReprice(c, p, { live: true });
      byFund[p.fundId] = (byFund[p.fundId] || 0) + uplift;
    }
  }
  return byFund;
}

/** The gross carry rate Carta's booked GP-entity NAVs embed. The carry-rate
 *  input is a scenario dial: at 20% the booked base passes through untouched
 *  (everything reconciles to Carta and the workbook); at any other rate the
 *  booked base rescales linearly (straight no-hurdle carry), so "what if this
 *  fund's carry were 15%" reprices the WHOLE carry, not just the margin. */
export const BOOKED_CARRY_RATE = 0.2;

/**
 * Flow a fund's uplift through to LP NAV / TVPI / accrued carry, respecting
 * the LP make-whole: carry accrues only on value above LP paid-in capital.
 *
 * Carta's base split (LP NAV vs GP-entity accrued carry) is anchored at
 * `bookedRate` — the rate the booked accrued carry actually sits at, which the
 * caller passes as the fund's own baseline (LPA/config) carry rate so Baseline
 * ties out to Carta's books (factor 1); it defaults to 20% for callers with no
 * per-fund rate. The booked carry rescales by carryRate/bookedRate (linear, no
 * hurdle), and the marginal uplift splits (1−c)/c. Below
 * the make-whole line (deep markdown scenarios), LPs absorb 100% of the move
 * and accrued carry floors at zero — the GP holds no carry until LPs are made
 * whole. Value is conserved at the gross marks, so cutting the rate moves
 * carry dollars to LP NAV.
 *
 * base: {lpNav, lpPaidIn, lpDistributed, accruedCarry}. cfg: the fund's waterfall
 * config {carryRate, preferredReturn, catchupRate, catchupLimit} — a bare number
 * is accepted as a carry-only shorthand for backward compatibility.
 */
export function fundReprice(base, uplift, cfg, bookedRate = BOOKED_CARRY_RATE) {
  const wf = typeof cfg === "number" ? { carryRate: cfg } : (cfg || {});
  const carryRate = wf.carryRate ?? 0.2;
  // Anchor the booked-carry rescale to a non-zero rate. A fund can carry at 0%
  // (its config carryRate is a real 0, so `?? default` upstream keeps it), which
  // would make carryRate/bookedRate a divide-by-zero → NaN that poisons lpNav and
  // every firm rollup. A 0% fund has no booked carry to rescale anyway, so falling
  // back to the flat default is safe (0 × anything = 0).
  const anchor = bookedRate > 0 ? bookedRate : BOOKED_CARRY_RATE;
  const gross0 = base.lpNav + base.accruedCarry + base.lpDistributed;
  const gross1 = gross0 + uplift;
  const profit = (g) => Math.max(0, g - base.lpPaidIn);
  // Marginal carry across the reprice, through the full waterfall (pref + catch-up).
  // Flat case: splitProfit(p) = carryRate·p, so this reduces to carryRate·Δprofit.
  const gpCarryAt = (g) => splitProfit(profit(g), base.lpPaidIn, wf).gpCarry;
  const rawCarry = base.accruedCarry * (carryRate / anchor) + (gpCarryAt(gross1) - gpCarryAt(gross0));
  // Hard invariants, in priority order: carry is never negative, and carry can
  // never exceed total profit above the make-whole line — so an underwater
  // fund holds zero carry even when Carta's base carry exceeds carryRate ×
  // base profit (true for funds underwater on carry), and LP NAV can never go negative.
  const accruedCarry = Math.max(0, Math.min(rawCarry, profit(gross1)));
  const carryShare = accruedCarry - base.accruedCarry;
  const lpShare = uplift - carryShare; // value is conserved: LP + carry = gross move
  const lpNav = base.lpNav + lpShare;
  const tvpi = base.lpPaidIn > 0 ? (lpNav + base.lpDistributed) / base.lpPaidIn : 0;
  const rvpi = base.lpPaidIn > 0 ? lpNav / base.lpPaidIn : 0;
  const dpi = base.lpPaidIn > 0 ? base.lpDistributed / base.lpPaidIn : 0;
  return { lpNav, accruedCarry, tvpi, rvpi, dpi, uplift, lpShare, carryShare };
}

/** Per-fund gross carry rate, falling back to the model-wide assumption. */
export function carryRateFor(assumptions, fundId) {
  return assumptions.carryRates?.[fundId] ?? assumptions.carryRate ?? 0.2;
}

/**
 * The default assumed-exit date for a fund when the user hasn't set one:
 * 12/31 of the NAV-as-of year — the console's existing "exit now" terminal, so
 * IRRs are unchanged at load. Falls back to a bare `-12-31` guard only if the
 * snapshot has no navAsOf (never expected for a built dashboard).
 */
export function defaultExitHorizon(snapshot) {
  const navYear = snapshot?.source?.navAsOf?.slice(0, 4);
  return navYear ? `${navYear}-12-31` : null;
}

/**
 * Per-fund assumed-exit date (ISO `YYYY-MM-DD`) driving the scenario IRRs — the
 * single terminal date for the fund's Net LP IRR and the per-company Deal IRR.
 * A user override in `assumptions.exitHorizon[fundId]` wins; otherwise the
 * year-end default above (so nothing moves until the user sets a horizon).
 */
export function exitHorizonFor(assumptions, snapshot, fundId) {
  return (assumptions || {}).exitHorizon?.[fundId] ?? defaultExitHorizon(snapshot);
}

/** Quarter offset from an ISO anchor → ISO date (q×3 months); shared so slider and horizon derivation agree. */
export function quarterOffsetDate(anchorISO, q) {
  const [y, m, d] = String(anchorISO || "").split("-").map(Number);
  if (!y) return anchorISO;
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCMonth(dt.getUTCMonth() + (Math.round(q) || 0) * 3);
  return dt.toISOString().slice(0, 10);
}

/** Inverse of quarterOffsetDate: whole quarters between an ISO anchor and an ISO target date (month-based, day-agnostic, matching quarterOffsetDate's own arithmetic). */
export function quartersBetween(anchorISO, targetISO) {
  const [ay, am] = String(anchorISO || "").split("-").map(Number);
  const [ty, tm] = String(targetISO || "").split("-").map(Number);
  if (!ay || !ty) return 0;
  return Math.round(((ty - ay) * 12 + (tm - am)) / 3);
}

/**
 * Per-fund exit horizon derived from realized companies' exit-timing sliders: the
 * proceeds-weighted average exit quarter, offset from navAsOf. Funds with no
 * realized company are omitted. An explicit user horizon wins downstream (see
 * effectiveExitHorizons).
 */
export function deriveRealizedExitHorizons(snapshot, portfolio) {
  const navAsOf = snapshot?.source?.navAsOf;
  if (!navAsOf) return {};
  const wSum = {}, wq = {}; // per-fund proceeds sum and proceeds×quarter sum
  for (const c of portfolio?.companies || []) {
    if (!c.exited || c.realized || c.archived || c.defunct || !c.includeInNav) continue;
    const q = Math.max(0, Math.round(c.exitTimingQ ?? 0));
    for (const p of c.positions) {
      const { repricedFv } = positionReprice(c, p, { live: true });
      const w = Math.max(0, repricedFv || 0);
      if (w <= 0) continue;
      wSum[p.fundId] = (wSum[p.fundId] || 0) + w;
      wq[p.fundId] = (wq[p.fundId] || 0) + w * q;
    }
  }
  const out = {};
  for (const fundId of Object.keys(wSum)) {
    if (wSum[fundId] <= 0) continue;
    out[fundId] = quarterOffsetDate(navAsOf, wq[fundId] / wSum[fundId]);
  }
  return out;
}

/** Explicit per-fund picks layered over the realized-timing-derived horizons, so an explicit horizon always wins. */
export function effectiveExitHorizons(snapshot, portfolio) {
  return {
    ...deriveRealizedExitHorizons(snapshot, portfolio),
    ...((portfolio?.assumptions || {}).exitHorizon || {}),
  };
}

/**
 * The full waterfall config for a fund: per-fund scenario overrides (the
 * assumptions maps) layered over the snapshot's Carta config, with safe
 * defaults (pref 0, catch-up off) so firms without a configured waterfall
 * behave exactly as the flat-carry model did.
 */
export function waterfallCfgFor(assumptions, snapshot, fundId) {
  const a = assumptions || {};
  const cfg = (snapshot?.funds || []).find((f) => f.id === fundId)?.waterfall || {};
  return {
    carryRate: a.carryRates?.[fundId] ?? cfg.carryRate ?? a.carryRate ?? 0.2,
    preferredReturn: a.preferredReturns?.[fundId] ?? cfg.preferredReturn ?? 0,
    catchupRate: a.catchupRates?.[fundId] ?? cfg.catchupRate ?? 0,
    catchupLimit: a.catchupLimits?.[fundId] ?? cfg.catchupLimit ?? null,
    configName: cfg.configName ?? null,
  };
}

/** GP carry expressed as a share of LP net profit (0.20 gross → 0.25). */
export function carryOnLpNetProfit(carryRate) {
  return carryRate / (1 - carryRate);
}

/**
 * The company's reference valuation per Carta's own data: an explicit override
 * if present, else the mark basis of the most recent mark (ties → the higher
 * basis, i.e. the latest transaction). This is what the Reset button restores.
 */
export function cartaReferenceB(company) {
  if (company.cartaValuationB != null) return company.cartaValuationB;
  const based = company.positions.filter((p) => p.markBasisB);
  if (!based.length) return null;
  return based.reduce((best, p) => {
    if (!best) return p;
    const d = (p.markDate || "").localeCompare(best.markDate || "");
    if (d > 0) return p;
    if (d === 0 && p.markBasisB > best.markBasisB) return p;
    return best;
  }, null).markBasisB;
}

/** Quick-pick multiples relative to the Carta mark, shown as a sentiment guide:
 *  0× = write-off, 1× = held at Carta, 3/5/10/20× = increasingly bullish. */
export const SENTIMENT_MULTIPLES = [0, 1, 3, 5, 10, 20];

/** Red→green sentiment color for a quick-pick multiple. Literal HSL (semantic —
 *  red = down, green = up — so it reads correctly in both light and dark mode;
 *  same "literal colors are intentional" precedent as Overview's chart PALETTE). */
export function sentimentColor(mult) {
  if (mult <= 0) return "hsl(2, 62%, 50%)";   // write-off — red
  if (mult < 1.5) return "hsl(40, 6%, 46%)";  // held at Carta — neutral grey
  if (mult < 4) return "hsl(140, 40%, 40%)";  // 3× — light green
  if (mult < 8) return "hsl(150, 52%, 34%)";  // 5× — green
  if (mult < 15) return "hsl(156, 66%, 27%)"; // 10× — deep green
  return "hsl(158, 72%, 21%)";                // 20× — deepest green
}

/** The sentiment quick-pick preset chips for a valuation slider. `anchor` is the
 *  Carta-mark value in the slider's own units (the `resetValue`), so `1×` snaps
 *  to the Carta mark in every mode ($B valuation, absolute MOIC, or multiple). */
function sentimentPresets(anchor) {
  const base = anchor || 1;
  return SENTIMENT_MULTIPLES.map((m) => ({
    v: m === 0 ? 0 : base * m, label: `${m}×`, tone: sentimentColor(m),
  }));
}

/** Resolve the mode-dependent reprice config for a company — one config drives
 *  both the inline (compact) and expanded RepriceControl. The number is the
 *  knob; the quick-pick presets are multiples of the Carta mark (the resetValue). */
function repriceConfig(company, { totalFv, hasBasis, cartaMoic, cartaRef, updateCompany }) {
  // Waterfall mode: the slider is an EXIT company valuation ($B). 1× snaps to the
  // company's reference (current) value; proceeds flow through the preference stack.
  if (companyIsWaterfall(company)) {
    const refB = companyReferenceExit(company) / 1e9; // billions
    const cur = company.valuationB ?? refB ?? 0;
    // `ref` (→ max, → presets) must NEVER fall back to `cur` — cur is the value
    // being dragged/set, so anchoring the range to it bakes each render's dragged
    // value into the NEXT render's max/presets, compounding on every mousemove
    // tick of a single drag (or every preset click) into an exponential runaway
    // (observed: a company with no reference exit blew up to e+31/e+34 after a
    // few interactions). Anchor to a stable, company-intrinsic floor instead.
    const ref = refB || 1;
    return {
      value: cur, min: 0, max: Math.max(1, ref * 8), step: 0.01,
      fmtVal: (x) => fmtB(x), resetValue: refB,
      onChange: (x) => updateCompany(company.id, { valuationB: x, includeInNav: true }),
      presets: sentimentPresets(ref),
    };
  }
  if (hasBasis) {
    const cur = company.valuationB ?? cartaRef ?? 0;
    // Same fix as the waterfall branch above — never anchor `ref` to `cur`.
    const ref = cartaRef || 1;
    return {
      value: cur, min: 0, max: Math.max(2, ref * 22), step: 0.01,
      fmtVal: (x) => fmtB(x), resetValue: cartaRef,
      onChange: (x) => updateCompany(company.id, { valuationB: x, includeInNav: true }),
      presets: sentimentPresets(ref),
    };
  }
  if (cartaMoic) {
    const cur = (company.markMultiple ?? 1) * cartaMoic;
    return {
      value: cur, min: 0, max: Math.max(60, Math.ceil(cartaMoic * 22)), step: 0.05,
      fmtVal: (x) => x.toFixed(2) + "×", resetValue: cartaMoic,
      onChange: (m) => updateCompany(company.id, { markMultiple: m / cartaMoic, includeInNav: true }),
      presets: sentimentPresets(cartaMoic),
    };
  }
  const cur = company.markMultiple ?? 1;
  return {
    value: cur, min: 0, max: 40, step: 0.05,
    fmtVal: (x) => x.toFixed(2) + "×", resetValue: 1,
    onChange: (x) => updateCompany(company.id, { markMultiple: x, includeInNav: true }),
    presets: sentimentPresets(1),
  };
}

/**
 * Full reprice-slider state for one company: whether it's adjustable at all
 * (`canReprice` — false for realized exits, defunct companies, and companies
 * with no FV/basis to reprice from), its current uplift vs Carta marks, and
 * the config object `RepriceControl` needs (`cfg`, null when not adjustable
 * or archived). Shared by the Companies table and any other view that exposes
 * a per-company reprice slider (e.g. a sidebar scoped to a fund).
 */
export function companyRepriceState(company, updateCompany) {
  const live = company.includeInNav && !company.archived;
  let uplift = 0;
  for (const p of company.positions) {
    uplift += positionReprice(company, p, { live }).uplift;
  }
  const totalFv = company.positions.reduce((s, p) => s + (p.cartaFv || 0), 0);
  const totalCost = company.positions.reduce((s, p) => s + (p.cost || 0), 0);
  const hasBasis = company.positions.some((p) => p.markBasisB);
  const canReprice = !company.realized && !company.defunct
    && (hasBasis || totalFv > 0 || companyIsWaterfall(company));
  const cartaMoic = totalCost > 0 ? totalFv / totalCost : null;
  const cartaRef = cartaReferenceB(company);
  const cfg = canReprice && !company.archived
    ? repriceConfig(company, { totalFv, hasBasis, cartaMoic, cartaRef, updateCompany })
    : null;
  // Expected future dilution (0–90%) — a sibling slider that haircuts the FV
  // flowing to the fund. Persists exactly like the valuation knob.
  const dilutionCfg = canReprice && !company.archived
    ? {
        value: (company.futureDilution ?? 0) * 100, min: 0, max: 90, step: 1,
        fmtVal: (x) => x.toFixed(0) + "%", resetValue: 0,
        presets: [{ v: 0, label: "None" }, { v: 10, label: "10%" }, { v: 25, label: "25%" }, { v: 50, label: "50%" }],
        onChange: (x) => updateCompany(company.id, { futureDilution: x / 100, includeInNav: true }),
      }
    : null;
  return { cfg, dilutionCfg, uplift, canReprice };
}
