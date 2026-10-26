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

import { countsInFirmTvpi } from "./concentration.js";
import { fundReprice, positionReprice, positionTotalValue, retainedFraction } from "./reprice.js";

/** Realizable value of each company across the funds in `fundIds`, ranked by value.
 *  Archived and fully-realized (zero-FV) positions drop out. Only the
 *  stake still held is realizable — a secondary already turned the rest to cash.
 *  A company held by several of `fundIds` has its `fv` totalled across them, and
 *  `fvByFund` splits it per fund. */
export function fundCompanies(slice, fundIds) {
  const out = [];
  for (const c of slice.companies || []) {
    if (c.archived) continue;
    const retained = retainedFraction(c);
    const fvByFund = {};
    let fv = 0;
    for (const p of c.positions || []) {
      if (!fundIds.includes(p.fundId)) continue;
      const v = positionReprice(c, p, { live: true }).repricedFv * retained;
      fvByFund[p.fundId] = (fvByFund[p.fundId] || 0) + v;
      fv += v;
    }
    if (fv > 0) out.push({ id: c.id, name: c.name, fv, fvByFund });
  }
  out.sort((a, b) => b.fv - a.fv);
  return out;
}

/** Per-company GROSS return multiple across one or more funds: TOTAL value ÷ invested cost,
 *  ranked by multiple descending (rank 1 = best). Total value = residual fair
 *  value (repriced to the scenario's marks) PLUS realized proceeds
 *  (distributions), so realized/exited holdings show their real return (their
 *  residual FV is 0 but proceeds carry the exit), and partially-realized
 *  holdings combine both. A company held by several of `fundIds` sums its value
 *  and cost over those positions. Write-downs (marked toward zero, no proceeds)
 *  legitimately sit at the tail. Feeds the Power Law chart. Pure. */
export function fundCompanyReturns(slice, fundIds) {
  const out = [];
  for (const c of slice.companies || []) {
    if (c.archived) continue;
    let value = 0, cost = 0;
    for (const p of c.positions || []) {
      if (!fundIds.includes(p.fundId)) continue;
      value += positionTotalValue(c, p);
      cost += p.cost || 0;
    }
    if (cost > 0) out.push({ id: c.id, name: c.name, value, cost, moic: value / cost, realized: !!c.realized });
  }
  out.sort((a, b) => b.moic - a.moic);
  return out;
}

/**
 * @param slice     active portfolio slice (companies + assumptions)
 * @param states    the funds' live states from computeFundStates (baseLpNav /
 *                  baseLpDistributed / baseAccruedCarry / uplift / carryRate /
 *                  lpPaidIn); one fund's state in a list gives that fund's
 *                  multiple, several give the pooled multiple across them: the
 *                  funds' (LP NAV + LP distributions) summed over their paid-in
 *                  summed. A company's value is then swung in every fund that
 *                  holds it. Pooling counts every fund with paid-in capital (the firm Net TVPI rule).
 * @param opts  { exitDelta = 0.25 }
 * @returns { baseMultiple, portFv, exitDelta, count,
 *            companies: [{ id, name, fv, lowMultiple, highMultiple, swing }] }
 *          sorted by |swing| desc. Multiples are net LP TVPI; null where the
 *          funds have no paid-in capital.
 */
export function exitValueImpact(slice, states, opts = {}) {
  const { exitDelta = 0.25 } = opts;
  const funds = states
    .filter(countsInFirmTvpi)
    .map((fs) => ({
      id: fs.id,
      paidIn: fs.lpPaidIn,
      // pre-exit reprice base (exit toggles ignored — a clean exit-value sweep)
      base: {
        lpNav: fs.baseLpNav,
        lpPaidIn: fs.lpPaidIn,
        lpDistributed: fs.baseLpDistributed,
        accruedCarry: fs.baseAccruedCarry,
      },
      uplift: fs.uplift || 0,
      // full waterfall config (carry + pref + catch-up); falls back to carry-only
      cfg: fs.waterfall ?? { carryRate: fs.carryRate ?? 0.2 },
    }));
  const paidInTotal = funds.reduce((s, f) => s + f.paidIn, 0);

  // a fund's LP value (NAV after carry + distributions) at a given uplift
  const lpValue = (f, uplift) => fundReprice(f.base, uplift, f.cfg).lpNav + f.base.lpDistributed;
  const baseValue = funds.reduce((s, f) => s + lpValue(f, f.uplift), 0);

  // net LP multiple (TVPI) implied by moving each fund's uplift by `shift[fund id]`:
  // reprice → LP NAV → (LP NAV + distributions) / paid-in, pooled across the
  // funds. The multiple is an OUTPUT of the marks.
  const multipleFrom = (shift) => {
    if (!(paidInTotal > 0)) return null;
    const value = funds.reduce((s, f) => (f.id in shift ? s - lpValue(f, f.uplift) + lpValue(f, f.uplift + shift[f.id]) : s), baseValue);
    return value / paidInTotal;
  };

  const baseMultiple = multipleFrom({});
  const all = fundCompanies(slice, funds.map((f) => f.id));
  const portFv = all.reduce((s, c) => s + c.fv, 0);

  // per-holding: swing that company's realizable value ±exitDelta in every fund
  // that holds it, others held, and read the change in the net LP multiple.
  const companies = all.map((c) => {
    const shift = (sign) => Object.fromEntries(Object.entries(c.fvByFund).map(([id, v]) => [id, sign * v * exitDelta]));
    const lowMultiple = multipleFrom(shift(-1));
    const highMultiple = multipleFrom(shift(1));
    const swing = lowMultiple == null || highMultiple == null ? null : Math.abs(highMultiple - lowMultiple);
    return { id: c.id, name: c.name, fv: c.fv, lowMultiple, highMultiple, swing };
  });
  companies.sort((a, b) => (b.swing ?? -1) - (a.swing ?? -1));

  return { baseMultiple, portFv, exitDelta, count: companies.length, companies };
}
