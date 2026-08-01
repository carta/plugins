// LP multiples glidepath for ONE fund — the path of DPI, RVPI and TVPI over the
// fund's life. This is the LP-facing companion to model/liquidity.js (which
// projects the dollar calls/distributions firm-wide): here we trace the three
// capital multiples for a single fund.
//
//   DPI  = cumulative LP distributions ÷ paid-in     (realized)
//   RVPI = residual LP NAV             ÷ paid-in     (unrealized)
//   TVPI = DPI + RVPI                                 (total)
//
// ACTUAL years (≤ as-of) are reconstructed from the fund's dated LP cashflows
// (cumulative paid-in and distributions) and its per-quarter ending LP NAV
// (snapshot.navSeries[].byFund[fundId]) — booked history, unaffected by the active
// scenario. The final actual point (Today) is SNAPPED to the LIVE fund state's
// multiples (fundState.dpi/rvpi/tvpi from computeFundStates), so repricing a company
// or toggling an exit moves the anchor — and the whole projection with it.
//
// PROJECTED years (> as-of → wind-down) roll the pools forward with the SAME
// pacing-shape knobs the liquidity forecast uses: remaining uncalled commitment is
// CALLED over the investment period (callShape); the realizable value pool is
// DISTRIBUTED over the horizon (realizationShape). Called capital is assumed to
// deploy at the fund's CURRENT TVPI (its blended multiple) — so with navGrowth = 0
// the fund's TVPI is CONSERVED: the realizable pool is current NAV + uncalled ×
// TVPI_now, NAV runs off to ~0 by wind-down, RVPI → 0, and DPI climbs to today's
// TVPI. In other words the glidepath converts unrealized value (RVPI) into realized
// value (DPI) at the current multiple; a positive navGrowth compounds residual NAV
// so TVPI rises above today's. NAV each year = prior NAV × (1 + navGrowth) +
// calls × TVPI_now − distributions. All pure; returns null with no paid-in.

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
 * @param snapshot  Carta snapshot (cashflows, navSeries, windDownYear, source.navAsOf)
 * @param fundState a live per-fund state from computeFundStates (model/funds.js) —
 *   carries the scenario-repriced {id, lpPaidIn, lpDistributed, committed, lpNav,
 *   dpi, rvpi, tvpi}. Passing the LIVE state (not the booked snapshot fund) is what
 *   ties the glidepath to the active scenario.
 * @param opts {
 *   investmentPeriodYears = 4   — years over which remaining uncalled is called
 *   callShape = "declining"      — call pacing across the investment period
 *   realizationShape = "backloaded" — distribution pacing across the horizon
 *   navGrowth = 0                — annual growth applied to residual NAV (0 = held flat)
 *   horizonEndYear               — defaults to the fund's wind-down year
 * }
 * @returns { asOf, asOfYear, horizonEndYear, current:{dpi,rvpi,tvpi},
 *            years: [{ year, paidIn, cumDist, nav, dpi, rvpi, tvpi, actual }] }
 *          or null when the fund has no paid-in capital to anchor a multiple.
 */
export function fundGlidepath(snapshot, fundState, opts = {}) {
  if (!fundState || !fundState.id) return null;
  const fundId = fundState.id;
  const paidIn0 = fundState.lpPaidIn || 0;
  const committed = fundState.committed || 0;
  if (!(paidIn0 > 0)) return null; // no denominator → no multiple

  // Live anchor — the scenario-repriced multiples for this fund. dpi/rvpi/tvpi come
  // straight off the fund state (already computed as distributions/NAV over paid-in),
  // and nav0 is the live repriced LP NAV. dist0/paidIn0 are historical cash (unchanged
  // by repricing); nav0/rvpi/tvpi move when marks or exit toggles change.
  const dpiNow = fundState.dpi != null ? fundState.dpi : (fundState.lpDistributed || 0) / paidIn0;
  const rvpiNow = fundState.rvpi != null ? fundState.rvpi : (fundState.lpNav || 0) / paidIn0;
  const tvpiNow = fundState.tvpi != null ? fundState.tvpi : dpiNow + rvpiNow;
  const dist0 = fundState.lpDistributed != null ? fundState.lpDistributed : dpiNow * paidIn0;
  const nav0 = fundState.lpNav != null ? fundState.lpNav : rvpiNow * paidIn0;

  const asOf = snapshot?.source?.navAsOf;
  const asOfYear = +String(asOf).slice(0, 4);
  if (!Number.isFinite(asOfYear)) return null;

  const {
    investmentPeriodYears = 4,
    callShape = "declining",
    realizationShape = "backloaded",
    navGrowth = 0,
  } = opts;
  const windDown = snapshot?.windDownYear?.[fundId];
  const horizonEndYear =
    opts.horizonEndYear ?? (Number.isFinite(windDown) && windDown > asOfYear ? windDown : asOfYear + 8);

  // ── actual lead-in (per-year, ≤ asOfYear) ──────────────────────────────────
  // Cumulative paid-in / distributions from the fund's dated LP cashflows.
  const flows = (snapshot?.cashflows?.[fundId]?.flows || [])
    .filter((f) => f.date)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  // Year-end LP NAV from navSeries (last quarter of each year that carries this
  // fund); carried forward so a year with no explicit point still has a value.
  const navByYear = new Map();
  for (const p of snapshot?.navSeries || []) {
    const v = p?.byFund?.[fundId];
    if (v == null || !p.date) continue;
    navByYear.set(+p.date.slice(0, 4), v); // later quarters overwrite → year-end
  }

  const years = [];
  const flowFirstYear = flows.length ? +flows[0].date.slice(0, 4) : asOfYear;
  const navFirstYear = navByYear.size ? Math.min(...navByYear.keys()) : asOfYear;
  const firstActualYear = Math.min(flowFirstYear, navFirstYear, asOfYear);

  let cumPaid = 0, cumDist = 0, lastNav = null;
  let fi = 0;
  for (let y = firstActualYear; y <= asOfYear; y++) {
    // fold in every flow dated within year y (calls are negative, dist positive)
    while (fi < flows.length && +flows[fi].date.slice(0, 4) <= y) {
      const amt = flows[fi].amount || 0;
      if (amt < 0) cumPaid += -amt;
      else cumDist += amt;
      fi++;
    }
    if (navByYear.has(y)) lastNav = navByYear.get(y);
    if (y === asOfYear) {
      // snap the boundary point to the reported anchor so the tab ties out
      years.push({ year: y, paidIn: paidIn0, cumDist: dist0, nav: nav0, dpi: dpiNow, rvpi: rvpiNow, tvpi: tvpiNow, actual: true });
    } else if (cumPaid > 0 && lastNav != null) {
      const dpi = cumDist / cumPaid, rvpi = clamp0(lastNav) / cumPaid;
      years.push({ year: y, paidIn: cumPaid, cumDist, nav: clamp0(lastNav), dpi, rvpi, tvpi: dpi + rvpi, actual: true });
    }
    // years before the fund has both paid-in AND a NAV mark are skipped (the
    // J-curve genuinely doesn't start until capital is called and marked).
  }

  // ── projection (asOfYear+1 .. horizonEndYear) ──────────────────────────────
  const uncalled = clamp0(committed - paidIn0);
  const callYears = [];
  for (let y = asOfYear + 1; y <= Math.min(asOfYear + investmentPeriodYears, horizonEndYear); y++) callYears.push(y);
  const distYears = [];
  for (let y = asOfYear + 1; y <= horizonEndYear; y++) distYears.push(y);

  const callW = weights(callYears.length, callShape);
  const distW = weights(distYears.length, realizationShape);
  const callBy = {}, distBy = {};
  callYears.forEach((y, i) => { callBy[y] = uncalled * callW[i]; });
  // realizable value pool = everything still to be returned: current NAV plus the
  // uncalled commitment deployed at the fund's current multiple (uncalled × TVPI_now).
  // Distributing exactly this pool while NAV takes in calls × TVPI_now conserves the
  // fund's TVPI at navGrowth = 0 — RVPI simply converts into DPI over the horizon.
  const realizable = nav0 + uncalled * tvpiNow;
  distYears.forEach((y, i) => { distBy[y] = realizable * distW[i]; });

  let pi = paidIn0, d = dist0, nav = nav0;
  for (const y of distYears) {
    const calls = callBy[y] || 0;          // paid-in added at cost
    const dist = distBy[y] || 0;
    nav = clamp0(nav * (1 + navGrowth) + calls * tvpiNow - dist); // called capital marked at TVPI_now
    pi += calls;
    d += dist;
    const dpi = d / pi, rvpi = nav / pi;
    years.push({ year: y, paidIn: pi, cumDist: d, nav, dpi, rvpi, tvpi: dpi + rvpi, actual: false });
  }

  return {
    asOf,
    asOfYear,
    horizonEndYear,
    current: { dpi: dpiNow, rvpi: rvpiNow, tvpi: tvpiNow },
    committed,
    uncalled,
    years,
  };
}
