// Slice helpers — a slice is a self-contained scenario workspace
// (assumptions + company registry). The baseline slice mirrors Carta at
// workbook defaults and stays locked; experiments live in copies.

export const BASELINE_ID = "baseline";

/** Reset every editable input in a slice body to its default. */
export function normalizeToDefaults(body) {
  const doc = structuredClone(body);
  doc.assumptions = { ...doc.assumptions, carryRate: 0.2, carryRates: {}, spRate: 0.102, feeLoads: {}, followOnRatios: {}, recyclingRatios: {} };
  for (const c of doc.companies) {
    c.valuationB = c.defaultValuationB ?? null;
    c.markMultiple = 1;
    c.includeInNav = false; // baseline holds EVERY company at Carta marks
    c.exited = false;
    c.futureDilution = 0;
    c.waterfallMode = false; // baseline uses the flat reprice, not the preference waterfall
  }
  return doc;
}

export function makeSlice({ id, name, from, locked = false, createdAt, color = null }) {
  return {
    id,
    name,
    locked,
    color: color ?? null, // optional hex tag shown beside the scenario in the nav
    createdAt: createdAt ?? new Date().toISOString().slice(0, 10),
    assumptions: structuredClone(from.assumptions),
    companies: structuredClone(from.companies),
  };
}

export function getSlice(doc, id) {
  return doc.slices.find((s) => s.id === id) ?? doc.slices.find((s) => s.id === BASELINE_ID) ?? doc.slices[0];
}

export function activeSlice(doc) {
  return getSlice(doc, doc.activeSliceId);
}

/** Companies holding positions in a fund (live ones only). Defunct companies
 *  are individually uneditable (UI lock) but fund-level zero/reset DO include
 *  them — a written-off fund zeroes its dead companies' stale Carta marks too. */
export function companiesInFund(body, fundId) {
  return body.companies.filter((c) => !c.archived && c.positions.some((p) => p.fundId === fundId));
}

/**
 * Write off every company in a fund: tapes to zero, connected to NAV.
 * Repriced FV, position tables, and fund NAV all read zero — then write up
 * only the survivors by dragging their tapes back. Companies that also hold
 * positions in OTHER funds get zeroed everywhere (the tape is company-level);
 * surface those via crossFundCompanies() before calling.
 */
export function zeroOutFund(body, fundId) {
  for (const c of companiesInFund(body, fundId)) {
    c.includeInNav = true;
    // zero BOTH modes — a mixed company (some positions with a basis, some
    // without) reprices per-position, so one input alone wouldn't zero it
    c.valuationB = 0;
    c.markMultiple = 0;
    c.waterfallMode = false; // a write-off is a flat $0, not a waterfall exit
  }
  return body;
}

/** Undo: every company in the fund back to Carta marks (parked, disconnected). */
export function resetFundToCarta(body, fundId) {
  for (const c of companiesInFund(body, fundId)) {
    c.valuationB = c.defaultValuationB ?? null;
    c.markMultiple = 1;
    c.includeInNav = false;
    c.exited = false;
    c.futureDilution = 0;
    c.waterfallMode = false;
  }
  return body;
}

/** Companies a fund-level zero would also affect elsewhere. */
export function crossFundCompanies(body, fundId) {
  return companiesInFund(body, fundId).filter((c) => c.positions.some((p) => p.fundId !== fundId));
}

/** Firm-wide write-off: every non-archived company across every fund, tapes to zero. */
export function zeroOutAll(body) {
  for (const c of body.companies.filter((c) => !c.archived)) {
    c.includeInNav = true;
    c.valuationB = 0;
    c.markMultiple = 0;
    c.waterfallMode = false;
  }
  return body;
}

/** Firm-wide undo: every non-archived company back to Carta marks. */
export function resetAllToCarta(body) {
  for (const c of body.companies.filter((c) => !c.archived)) {
    c.valuationB = c.defaultValuationB ?? null;
    c.markMultiple = 1;
    c.includeInNav = false;
    c.exited = false;
    c.futureDilution = 0;
    c.waterfallMode = false;
  }
  return body;
}

/**
 * Reserve strategy — a follow-on posture applied across a scope, expressed as
 * expected future dilution: reserving to follow-on pro-rata DEFENDS ownership
 * (less dilution), so an aggressive posture => ~0 dilution, conservative =>
 * full expected dilution. Sets each eligible company's `futureDilution` and
 * marks it live in NAV (dilution only bites once includeInNav is true — same as
 * the per-company dilution slider). Skips realized/defunct; preserves any
 * existing valuationB/markMultiple reprice (dilution stacks on top).
 * `fundId === "all"` applies firm-wide; otherwise scoped to that fund.
 */
export function applyReserveDilution(body, fundId, dilution) {
  const targets = fundId === "all"
    ? body.companies.filter((c) => !c.archived)
    : companiesInFund(body, fundId);
  for (const c of targets) {
    if (c.realized || c.defunct) continue;
    c.futureDilution = dilution;
    c.includeInNav = true;
  }
  return body;
}

export function sliceId(name) {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") +
    "-" + Math.random().toString(36).slice(2, 6)
  );
}

/** True if a slice's inputs differ from another's (valuations, toggles, assumptions). */
export function sliceDiffers(a, b) {
  const sig = (s) =>
    JSON.stringify([
      s.assumptions.carryRate,
      s.assumptions.carryRates ?? {},
      s.assumptions.spRate,
      s.assumptions.feeLoads ?? {},
      s.assumptions.followOnRatios ?? {},
      s.assumptions.recyclingRatios ?? {},
      s.companies.map((c) => [c.id, c.valuationB, c.markMultiple ?? 1, c.futureDilution ?? 0, c.includeInNav, !!c.exited, !!c.waterfallMode, c.archived, c.positions.length]),
    ]);
  return sig(a) !== sig(b);
}
