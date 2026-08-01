// LP liquidity forecast — a forward projection of capital CALLS (cash LPs must
// still wire in) and DISTRIBUTIONS (cash LPs receive back), firm-wide, by
// calendar year. Anchored to the SAME fund rollup the Overview firm row and
// Reserves use (snapshot.funds), so the figures tie out across the app:
//   • Uncalled commitment = Σ committed − Σ LP paid-in   (the call pool)
//   • Current LP NAV       = Σ base LP NAV                (the dist pool)
//   • Wind-down years      = when each fund must return capital (the horizon)
//   • Dated future flows   = anything already scheduled in cashflows
// NOTE: PARTNER_DATA (lp-base.json) reports different firm totals (it covers a
// wider set of LP commitments and computes NAV differently); we deliberately do
// NOT use it here so the LP-facing call/distribution math reconciles with the
// fund-level capital shown elsewhere. The split of the pools across years is a
// PROJECTION (explicit, knob-driven): calls front-load over the investment
// period, distributions back-load toward wind-down; no NAV growth. All pure.

const clamp0 = (n) => Math.max(0, n);

/** Normalized weight vector of length n. shape: "even" | "declining" | "backloaded". */
function weights(n, shape) {
  if (n <= 0) return [];
  let raw;
  if (shape === "declining") raw = Array.from({ length: n }, (_, i) => n - i); // n, n-1, …, 1
  else if (shape === "backloaded") raw = Array.from({ length: n }, (_, i) => i + 1); // 1, 2, …, n
  else raw = Array.from({ length: n }, () => 1); // even
  const sum = raw.reduce((s, x) => s + x, 0);
  return raw.map((x) => x / sum);
}

/**
 * @param snapshot  Carta snapshot (funds, baseLpNav, windDownYear, cashflows, source.navAsOf)
 * @param opts {
 *   investmentPeriodYears = 4   — years over which remaining uncalled is called
 *   callShape = "declining"      — call pacing across the investment period
 *   realizationShape = "backloaded" — distribution pacing across the horizon
 *   horizonEndYear              — defaults to the latest fund wind-down year
 * }
 * @returns { asOf, asOfYear, horizonEndYear, committed, contributed, distributed,
 *            uncalled, navPool, years: [{ year, calls, distributions, net, cumNet }],
 *            totals }  or null when there's nothing to project.
 */
export function liquidityForecast(snapshot, opts = {}) {
  const funds = snapshot?.funds || [];
  if (!funds.length) return null;
  const { investmentPeriodYears = 4, callShape = "declining", realizationShape = "backloaded" } = opts;

  // firm rollup — the same source as Overview's firm row and Reserves
  const committed = funds.reduce((s, f) => s + (f.committed || 0), 0);
  const contributed = funds.reduce((s, f) => s + (f.lpPaidIn || 0), 0);
  const distributed = funds.reduce((s, f) => s + (f.lpDistributed || 0), 0);
  const navPool = clamp0(funds.reduce((s, f) => s + (snapshot.baseLpNav?.[f.id] || 0), 0));
  if (!(committed > 0)) return null;

  const asOf = snapshot?.source?.navAsOf;
  const asOfYear = +String(asOf).slice(0, 4);
  const windYears = Object.values(snapshot?.windDownYear || {}).filter((y) => Number.isFinite(y));
  const horizonEndYear = opts.horizonEndYear
    ?? (windYears.length ? Math.max(...windYears) : asOfYear + 8);

  const uncalled = clamp0(committed - contributed);

  // ── scheduled, dated flows already on the books (future-dated only) ──
  const schedCalls = {}, schedDist = {};
  for (const cf of Object.values(snapshot?.cashflows || {})) {
    for (const f of cf.flows || []) {
      if (!f.date || f.date <= String(asOf)) continue; // history is already in contributed/distributed
      const yr = +f.date.slice(0, 4);
      if (f.amount < 0) schedCalls[yr] = (schedCalls[yr] || 0) + -f.amount;
      else if (f.amount > 0) schedDist[yr] = (schedDist[yr] || 0) + f.amount;
    }
  }
  const totalSchedCalls = Object.values(schedCalls).reduce((s, x) => s + x, 0);
  const totalSchedDist = Object.values(schedDist).reduce((s, x) => s + x, 0);

  // remaining pools to spread (don't double-count what's already scheduled)
  const projCalls = clamp0(uncalled - totalSchedCalls);
  const projDist = clamp0(navPool - totalSchedDist);

  // ── projection windows ──
  const firstYear = asOfYear + 1;
  const callYears = [];
  for (let y = firstYear; y < firstYear + investmentPeriodYears; y++) callYears.push(y);
  const distYears = [];
  for (let y = firstYear; y <= Math.max(firstYear, horizonEndYear); y++) distYears.push(y);

  const callW = weights(callYears.length, callShape);
  const distW = weights(distYears.length, realizationShape);
  const projCallBy = {}, projDistBy = {};
  callYears.forEach((y, i) => { projCallBy[y] = projCalls * callW[i]; });
  distYears.forEach((y, i) => { projDistBy[y] = projDist * distW[i]; });

  // ── assemble per-year rows over the union of all active years ──
  // Scheduled flows can be dated in the as-of year itself (after the as-of
  // date); start the timeline at the earliest such year so those dollars are
  // emitted, not silently dropped — otherwise calls wouldn't sum to uncalled.
  const schedYears = [...Object.keys(schedCalls), ...Object.keys(schedDist)].map(Number);
  const startYear = Math.min(firstYear, ...(schedYears.length ? schedYears : [firstYear]));
  const lastYear = Math.max(horizonEndYear, ...callYears, ...distYears, ...schedYears, firstYear);
  const years = [];
  let cumNet = 0;
  for (let y = startYear; y <= lastYear; y++) {
    const calls = (schedCalls[y] || 0) + (projCallBy[y] || 0);
    const distributions = (schedDist[y] || 0) + (projDistBy[y] || 0);
    const net = distributions - calls;
    cumNet += net;
    years.push({ year: y, calls, distributions, net, cumNet });
  }

  const totals = {
    calls: years.reduce((s, r) => s + r.calls, 0),
    distributions: years.reduce((s, r) => s + r.distributions, 0),
    net: years.reduce((s, r) => s + r.net, 0),
    uncalled, navPool,
  };
  return { asOf, asOfYear, horizonEndYear, committed, contributed, distributed, uncalled, navPool, years, totals };
}
