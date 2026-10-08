/** Monthly flows → yearly IRR, stepping out from 0% toward the profit's sign so late fee calls can't land on a far-off second root. */
export function irrOf(times, amounts, n) {
  let profit = 0, anyIn = false;
  for (let i = 0; i < n; i++) { profit += amounts[i]; if (amounts[i] > 0) anyIn = true; }
  if (!anyIn) return -1;
  const npv = (r) => {
    let v = 0;
    const f = 1 / (1 + r);
    for (let i = 0; i < n; i++) v += amounts[i] * Math.pow(f, times[i]);
    return v;
  };
  if (Math.abs(profit) < 1e-9) return 0;
  const dir = profit > 0 ? 1 : -1;
  let lo = 0, flo = profit, hi = null;
  for (let r = 0.0025 * dir; Math.abs(r) <= (dir > 0 ? 2 : 0.95); r += 0.0025 * dir * Math.max(1, Math.abs(r) / 0.02)) {
    const f = npv(r);
    if (!Number.isFinite(f)) break;
    if (f * flo <= 0) { hi = r; break; }
    lo = r; flo = f;
  }
  if (hi == null) return dir > 0 ? null : -1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2, f = npv(mid);
    if (f * flo > 0) { lo = mid; flo = f; } else hi = mid;
  }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}
