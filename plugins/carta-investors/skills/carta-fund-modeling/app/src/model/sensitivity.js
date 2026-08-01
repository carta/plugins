// Exit-value impact — which portfolio companies drive the fund's net LP
// multiple. Built BOTTOMS-UP from the holdings: each company's realizable value
// at the scenario's marks is scaled ±exitDelta, the increment flows through the
// reprice + LP make-whole waterfall to LP NAV, and the change in the fund's net
// LP multiple is read off. The companies are then ranked by that impact, so the
// GP can see where the fund's exit-value exposure is concentrated.
//
// "Net LP multiple" is net LP TVPI: (LP NAV + LP distributions) ÷ LP paid-in
// (incl. scheduled future calls), with LP NAV taken AFTER the carried-interest
// split — i.e. a total-value multiple (unrealized + realized), net of carry.
// It is horizon-independent, so exit timing does not enter; carry rate is a
// fixed fund term, held at the scenario's rate. All pure — no UI, no persistence.

import { fundReprice, positionReprice } from "./reprice.js";

/** Realizable value of each company in a fund at the scenario's marks, ranked
 *  by value. Archived and fully-realized (zero-FV) positions drop out. */
export function fundCompanies(slice, fundId) {
  const out = [];
  for (const c of slice.companies || []) {
    if (c.archived) continue;
    let fv = 0;
    for (const p of c.positions || []) {
      if (p.fundId !== fundId) continue;
      fv += positionReprice(c, p, { live: true }).repricedFv;
    }
    if (fv > 0) out.push({ id: c.id, name: c.name, fv });
  }
  out.sort((a, b) => b.fv - a.fv);
  return out;
}

/** Per-company GROSS return multiple for a fund: TOTAL value ÷ invested cost,
 *  ranked by multiple descending (rank 1 = best). Total value = residual fair
 *  value (repriced to the scenario's marks) PLUS realized proceeds
 *  (distributions), so realized/exited holdings show their real return (their
 *  residual FV is 0 but proceeds carry the exit), and partially-realized
 *  holdings combine both. Write-downs (marked toward zero, no proceeds)
 *  legitimately sit at the tail. Feeds the Power Law chart. Pure. */
export function fundCompanyReturns(slice, fundId) {
  const out = [];
  for (const c of slice.companies || []) {
    if (c.archived) continue;
    let value = 0, cost = 0;
    for (const p of c.positions || []) {
      if (p.fundId !== fundId) continue;
      value += positionReprice(c, p, { live: true }).repricedFv + (p.proceeds || 0);
      cost += p.cost || 0;
    }
    if (cost > 0) out.push({ id: c.id, name: c.name, value, cost, moic: value / cost, realized: !!c.realized });
  }
  out.sort((a, b) => b.moic - a.moic);
  return out;
}

/**
 * @param snapshot  Carta snapshot (cashflows for paid-in)
 * @param slice     active portfolio slice (companies + assumptions)
 * @param fs        the fund's live state from computeFundStates (baseLpNav /
 *                  baseLpDistributed / baseAccruedCarry / uplift / carryRate /
 *                  lpPaidIn)
 * @param opts  { exitDelta = 0.25 }
 * @returns { baseMultiple, portFv, exitDelta, count,
 *            companies: [{ id, name, fv, lowMultiple, highMultiple, swing }] }
 *          sorted by |swing| desc. Multiples are net LP TVPI; null where the
 *          fund has no paid-in capital.
 */
export function exitValueImpact(snapshot, slice, fs, opts = {}) {
  const { exitDelta = 0.25 } = opts;
  const paidInTotal = snapshot.cashflows?.[fs.id]?.paidInTotal ?? 0;

  // pre-exit reprice base (exit toggles ignored — a clean exit-value sweep)
  const base = {
    lpNav: fs.baseLpNav,
    lpPaidIn: fs.lpPaidIn,
    lpDistributed: fs.baseLpDistributed,
    accruedCarry: fs.baseAccruedCarry,
  };
  const baseUplift = fs.uplift || 0;
  // full waterfall config (carry + pref + catch-up); falls back to carry-only
  const cfg = fs.waterfall ?? { carryRate: fs.carryRate ?? 0.2 };

  // net LP multiple (TVPI) implied by a given fund uplift: reprice → LP NAV →
  // (LP NAV + distributions) / paid-in. The multiple is an OUTPUT of the marks.
  const multipleFromUplift = (uplift) => {
    if (!(paidInTotal > 0)) return null;
    const r = fundReprice(base, uplift, cfg);
    return (r.lpNav + base.lpDistributed) / paidInTotal;
  };

  const baseMultiple = multipleFromUplift(baseUplift);
  const all = fundCompanies(slice, fs.id);
  const portFv = all.reduce((s, c) => s + c.fv, 0);

  // per-holding: swing that company's realizable value ±exitDelta, others held,
  // and read the change in the fund's net LP multiple.
  const companies = all.map((c) => {
    const lowMultiple = multipleFromUplift(baseUplift - c.fv * exitDelta);
    const highMultiple = multipleFromUplift(baseUplift + c.fv * exitDelta);
    const swing = lowMultiple == null || highMultiple == null ? null : Math.abs(highMultiple - lowMultiple);
    return { id: c.id, name: c.name, fv: c.fv, lowMultiple, highMultiple, swing };
  });
  companies.sort((a, b) => (b.swing ?? -1) - (a.swing ?? -1));

  return { baseMultiple, portFv, exitDelta, count: companies.length, companies };
}
