// XIRR — annualized IRR over irregularly dated cash flows (Excel-compatible:
// Actual/365 day count from the first flow date).
// Newton's method with a bracketed-bisection fallback.

const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

export function yearsBetween(d0, d1) {
  return (toDate(d1) - toDate(d0)) / MS_PER_YEAR;
}

function toDate(d) {
  return d instanceof Date ? d : new Date(d + "T00:00:00Z");
}

/** flows: [{date: 'YYYY-MM-DD'|Date, amount: number}], at least one negative and one positive. */
export function xirr(flows, { guess = 0.1, tol = 1e-9, maxIter = 100 } = {}) {
  const fs = flows
    .filter((f) => f.amount !== 0)
    .map((f) => ({ t: toDate(f.date).getTime(), a: f.amount }))
    .sort((x, y) => x.t - y.t);
  if (fs.length < 2) return null;
  const hasNeg = fs.some((f) => f.a < 0);
  const hasPos = fs.some((f) => f.a > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = fs[0].t;
  const years = fs.map((f) => (f.t - t0) / MS_PER_YEAR);
  // all flows on one date → NPV is constant in r; no meaningful IRR exists
  // (without this, Newton's first residual check returns the raw guess)
  if (years[years.length - 1] === 0) return null;

  const npv = (r) => {
    let v = 0;
    for (let i = 0; i < fs.length; i++) v += fs[i].a / Math.pow(1 + r, years[i]);
    return v;
  };
  const dnpv = (r) => {
    let v = 0;
    for (let i = 0; i < fs.length; i++)
      v -= (years[i] * fs[i].a) / Math.pow(1 + r, years[i] + 1);
    return v;
  };

  // Newton
  let r = guess;
  for (let i = 0; i < maxIter; i++) {
    const f = npv(r);
    if (Math.abs(f) < tol) return r;
    const d = dnpv(r);
    if (d === 0 || !isFinite(d)) break;
    const next = r - f / d;
    if (next <= -1 || !isFinite(next)) break;
    if (Math.abs(next - r) < tol) return next;
    r = next;
  }

  // Bisection fallback: bracket a sign change in (-1, hi]
  let lo = -1 + 1e-10;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  let expand = 0;
  while (fLo * fHi > 0 && expand < 10) {
    hi *= 2;
    fHi = npv(hi);
    expand++;
  }
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < tol || hi - lo < tol) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
