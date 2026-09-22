// Pure helpers over the kpi.json dataset: metric/company lookup, latest value,
// QoQ/YoY growth, and series assembly for the chart kit. No React, no I/O.

export const metricOf = (data, key) => (data.metrics || []).find((m) => m.key === key) || null;
export const companyOf = (data, id) => (data.companies || []).find((c) => c.id === id) || null;
export const metricKeyByLabel = (data, re) => (((data.metrics || []).find((m) => re.test(m.label)) || {}).key) || null;

/** Deep link into this firm's live Carta record, or null with no firmId on
 *  record. Resolves the domain from `source.cartaEnvironment` (recorded at
 *  build time) rather than hardcoding production, since a nonprod-sourced
 *  firmId isn't guaranteed to resolve on app.carta.com. */
export const cartaFirmUrl = (data, path = "/portfolio/investments/") => {
  const id = data.source?.firmId;
  if (id == null) return null; // 0 is a firmId that could legitimately exist; !id would drop it
  const base = data.source?.cartaEnvironment === "nonprod" ? "https://app.sandbox.carta.team" : "https://app.carta.com";
  return `${base}/investors/firm/${id}${path}`;
};

/** Median of a numeric array. Averages the two middle values for even length;
 *  returns null for an empty array. Shared so views don't reimplement it (several
 *  hand-rolled copies were wrong on even-length inputs). */
export const median = (a) => {
  if (!a || !a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Linear-interpolated quantile (q in [0,1]) of a numeric array. Same method as
 *  numpy's default — used for IQR outlier fences and the p95 bubble-size cap in
 *  the scatter chart. Returns null for an empty array. */
export const quantile = (a, q) => {
  if (!a || !a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  if (s.length === 1) return s[0];
  const pos = Math.max(0, Math.min(1, q)) * (s.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** A KPI reported as a flag, a date or prose rather than a number. Its points
 *  carry a display string `s`; a "text" one has no numeric value at all. */
export const isQualitative = (metric) => !!(metric && metric.kind);
export const isCharted = (metric) => !metric || metric.kind !== "text";
/** Key suffix of the numeric companion the builder emits for a date KPI.
 *  Must match MONTHS_TO_SUFFIX in scripts/build_kpi_datadir.py. */
export const MONTHS_TO_SUFFIX = "__MONTHS_TO";

// Qualitative KPIs lead every list — a GP reads "Fundraising required: Yes" and
// "Cash out: Sep 01, 2026" before any number. Dates first, then flags, then prose.
const KIND_RANK = { date: 0, boolean: 1, text: 2 };
/** Sort rank that floats qualitative metrics above numeric ones. Exported so the
 *  Dashboard's row order and the metric lists rank them identically. */
export const kindRank = (m) => (m && m.kind ? KIND_RANK[m.kind] ?? 2 : 99);
// Recommended KPIs surfaced first in every metric dropdown, then the rest A→Z.
const RECOMMENDED_RE = [/^revenue$/i, /^cash and cash equivalents$/i, /^ebitda$/i, /^net income$/i, /total (operating )?expenses/i];

/** Split a metric list into [qualitative, recommended, rest] in display order.
 *  Shared so the dropdown and the tables can never disagree on ordering. */
function groupMetrics(metrics) {
  const qual = metrics.filter(isQualitative)
    .sort((a, b) => kindRank(a) - kindRank(b) || a.label.localeCompare(b.label));
  const used = new Set(qual.map((m) => m.key)), rec = [];
  for (const re of RECOMMENDED_RE) {
    const m = metrics.find((x) => re.test(x.label) && !used.has(x.key));
    if (m) { used.add(m.key); rec.push(m); }
  }
  const rest = metrics.filter((m) => !used.has(m.key)).sort((a, b) => a.label.localeCompare(b.label));
  return [qual, rec, rest];
}

/** Order a metric list: qualitative, then recommended, then alphabetical. */
export function orderMetrics(metrics) {
  const [qual, rec, rest] = groupMetrics(metrics);
  return [...qual, ...rec, ...rest];
}
/** Dropdown options for metrics, same order, with dividers between the groups. */
export function metricOptions(metrics) {
  const [qual, rec, rest] = groupMetrics(metrics);
  // A leading group carries no separatorBefore key at all; later groups always
  // carry it, true on their first entry.
  return [
    ...qual.map((m) => ({ id: m.key, label: m.label })),
    ...rec.map((m, i) => (qual.length
      ? { id: m.key, label: m.label, separatorBefore: i === 0 }
      : { id: m.key, label: m.label })),
    ...rest.map((m, i) => ({ id: m.key, label: m.label, separatorBefore: i === 0 && qual.length + rec.length > 0 })),
  ];
}

/** Latest value of the company's reported "Runway (Months)" KPI, or null. */
export function runwayLatest(data, company) {
  const k = metricKeyByLabel(data, /runway/i);
  const l = k ? latest(company, k) : null;
  return l ? l.v : null;
}

/** Points for one company + metric (already period-ascending), or []. */
export function pointsFor(company, key) {
  return (company && company.series && company.series[key]) || [];
}

/** Points on/after a date (e.g. the fund's investment date) — ascending. */
export function pointsSince(company, key, sinceDate) {
  const p = pointsFor(company, key);
  return sinceDate ? p.filter((x) => x.d >= sinceDate) : p;
}

/** Latest {d, v, cur} for a company+metric, or null. */
export function latest(company, key) {
  const p = pointsFor(company, key);
  return p.length ? p[p.length - 1] : null;
}

/** Value `steps` periods before the latest (steps=1 -> prior period = QoQ on
 *  quarterly data; steps=4 -> ~YoY). Returns null if not enough history. */
export function priorValue(company, key, steps) {
  const p = pointsFor(company, key);
  const i = p.length - 1 - steps;
  return i >= 0 ? p[i].v : null;
}

/** Fractional change latest-vs-prior *reported* period (period-over-period, by
 *  index — NOT calendar-aware). Use for "vs the previous reported period" logic
 *  (e.g. sustained-decline detection). For labeled QoQ/YoY use the calendar-aware
 *  qoqChange / yoyChange below. Null if either missing / prior is 0. */
export function growth(company, key, steps = 1) {
  const cur = latest(company, key);
  const prev = priorValue(company, key, steps);
  if (!cur || cur.v == null || prev == null || prev === 0) return null;
  return (cur.v - prev) / Math.abs(prev);
}

/* ------------------------------------------------------------------ *
 *  Frequency-aware change  —  companies report at different cadences  *
 *  (monthly vs quarterly). Positional "N periods back" would make a   *
 *  monthly company's "YoY" only 4 months. These helpers walk back by  *
 *  CALENDAR months so QoQ = ~3 months and YoY = ~12 months regardless *
 *  of how often the company reports.                                  *
 * ------------------------------------------------------------------ */

/** Whole months from date a to date b (b − a), on "YYYY-MM-DD" period-ends. */
export function monthsBetween(a, b) {
  const [ay, am] = String(a).split("-").map(Number);
  const [by, bm] = String(b).split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** The reported point closest to `months` before `fromDate`, within `tol`
 *  months, and strictly earlier than fromDate. null if none qualifies (e.g. the
 *  company has < 1 year of history → no YoY point). */
export function pointNearMonthsBack(points, fromDate, months, tol) {
  let best = null, bestErr = Infinity;
  for (const p of points) {
    const gap = monthsBetween(p.d, fromDate); // positive = p is earlier
    if (gap <= 0) continue;
    const err = Math.abs(gap - months);
    if (err <= tol && err < bestErr) { best = p; bestErr = err; }
  }
  return best;
}

/** Calendar-aware fractional change: latest vs the point ~`months` earlier.
 *  Returns null when there's no comparable prior point in range or it's 0. */
export function changeOverMonths(company, key, months, tol) {
  const pts = pointsFor(company, key);
  const cur = pts.length ? pts[pts.length - 1] : null;
  if (!cur) return null;
  const prev = pointNearMonthsBack(pts, cur.d, months, tol);
  if (!prev || prev.v === 0) return null;
  return { g: (cur.v - prev.v) / Math.abs(prev.v), cur, prev };
}
/** QoQ = ~3 months back (±1). Number or null. */
export function qoqChange(company, key) {
  const r = changeOverMonths(company, key, 3, 1);
  return r ? r.g : null;
}
/** YoY = ~12 months back (±2). Number or null. */
export function yoyChange(company, key) {
  const r = changeOverMonths(company, key, 12, 2);
  return r ? r.g : null;
}

/** Reporting cadence of one company+metric, from the median month-gap between
 *  reported periods: "monthly" | "quarterly" | "semiannual" | "annual" |
 *  "single" (one point) | "none". */
export function metricCadence(company, key) {
  const p = pointsFor(company, key);
  if (p.length < 2) return p.length ? "single" : "none";
  const gaps = [];
  for (let i = 1; i < p.length; i++) gaps.push(monthsBetween(p[i - 1].d, p[i].d));
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  if (med <= 1.5) return "monthly";
  if (med <= 4) return "quarterly";
  if (med <= 8) return "semiannual";
  return "annual";
}

/** The quarter-end date ("YYYY-MM-DD") that a period falls into. */
export function quarterEndOf(d) {
  const [y, m] = String(d).split("-").map(Number);
  const QE = { 3: "03-31", 6: "06-30", 9: "09-30", 12: "12-31" };
  return `${y}-${QE[[3, 6, 9, 12][Math.floor((m - 1) / 3)]]}`;
}

/** How a metric rolls up: "sum" (flow) or "last" (level). Defaults to "last". */
export const aggOf = (metric) => (metric && metric.agg === "sum" ? "sum" : "last");

/** Roll a company+metric's points up to quarters.
 *  Returns [{ d: quarterEnd, v, months, parts }] ascending, where `months` is how
 *  many source periods fed the quarter and `parts` are their dates — so the UI can
 *  flag a partial quarter (e.g. only 2 of 3 months reported). A company that already
 *  reports quarterly yields months=1 and an unchanged value. */
export function quarterlyPoints(company, key, metric) {
  return rollUpQuarters(pointsFor(company, key), metric);
}

/** The roll-up itself, over ANY points array — so forecasts get exactly the same
 *  flow-vs-balance treatment as actuals rather than a second, drifting copy. */
export function rollUpQuarters(pts, metric) {
  if (!pts || !pts.length) return [];
  const mode = aggOf(metric);
  const buckets = new Map();
  for (const p of pts) {
    const q = quarterEndOf(p.d);
    if (!buckets.has(q)) buckets.set(q, []);
    buckets.get(q).push(p);
  }
  const out = [];
  for (const [q, ps] of buckets) {
    ps.sort((a, b) => (a.d < b.d ? -1 : 1));
    const last = ps[ps.length - 1];
    // A company-reported quarterly figure (`q`) already covers the whole quarter,
    // so it replaces the months instead of being summed with them.
    const qtr = ps.find((p) => p.d === q && p.q != null);
    let v, months, parts;
    if (qtr) {
      v = qtr.q; months = 1; parts = [qtr.d];
    } else {
      v = mode === "sum" ? ps.reduce((s, p) => s + (p.v || 0), 0) : last.v;
      months = ps.length; parts = ps.map((p) => p.d);
    }
    const src = qtr || last;
    const pt = { d: q, v, months, parts, agg: mode, cur: src.cur };
    // A genuine quarterly filing already covers the whole quarter, so partial-quarter
    // detection must not read its months=1 as an understated monthly reporter.
    if (qtr) {
      pt.reportedQuarterly = true;
      // Carry the underlying month sum so the UI can flag when the authoritative
      // quarterly figure disagrees with the company's own monthly filings.
      const monthly = ps.filter((p) => p.v != null);
      if (mode === "sum" && monthly.length) {
        pt.monthlySum = monthly.reduce((s, p) => s + (p.v || 0), 0);
        pt.monthlyParts = monthly.map((p) => p.d);
      }
    }
    // A qualitative reading rolls up as "last"; carry its display string.
    if (src.s != null) pt.s = src.s;
    out.push(pt);
  }
  return out.sort((a, b) => (a.d < b.d ? -1 : 1));
}

/** Expected source periods in a quarter for a company+metric, from its cadence:
 *  monthly → 3, quarterly → 1. Used to flag partial quarters. */
export function expectedPerQuarter(company, key) {
  const cad = metricCadence(company, key);
  return cad === "monthly" ? 3 : 1;
}

/** Points for a company+metric, optionally normalized onto the quarterly grid.
 *  `quarterly=false` returns the raw reported points. This is THE accessor views
 *  should use so monthly and quarterly reporters are comparable: without it a
 *  monthly reporter's "latest revenue" is one month while a quarterly reporter's
 *  is three. Each rolled point carries {months, parts, agg, partial}. */
export function seriesPoints(company, key, metric, quarterly = true) {
  if (!quarterly) return pointsFor(company, key);
  const qp = quarterlyPoints(company, key, metric);
  // How many source periods a quarter *should* have is judged LOCALLY, against the
  // preceding quarter — not from the company's lifetime cadence. A company that
  // reported quarterly for years then switched to monthly has an overall cadence of
  // "quarterly", which would hide a genuinely half-filed quarter. Looking back one
  // quarter flags a DROP in filing (Q3 had 3 months, Q4 has 1 → understated) without
  // false-flagging the quarter where a company first ramps up to monthly reporting.
  return qp.map((p, i) => {
    const expected = Math.max(p.months, i > 0 ? qp[i - 1].months : 1);
    return { ...p, expected, partial: p.agg === "sum" && p.months < expected && !p.reportedQuarterly };
  });
}

/** For a rolled-up point that used a reported quarterly figure, how far that figure
 *  sits from the sum of the same quarter's monthly filings. Returns null when there
 *  is nothing to compare or the two agree within a small tolerance (0.5%, min 1).
 *  { monthlySum, diff, parts } when they meaningfully disagree. */
export function quarterlyMonthlyGap(p) {
  if (!p || !p.reportedQuarterly || p.monthlySum == null || p.v == null) return null;
  const diff = p.monthlySum - p.v;
  if (Math.abs(diff) <= Math.max(1, Math.abs(p.v) * 0.005)) return null;
  return { monthlySum: p.monthlySum, diff, parts: p.monthlyParts || [] };
}

/** Forecast points for a company+metric on the same grid as seriesPoints, so the
 *  Dashboard can pivot estimates exactly the way it pivots actuals. These are the
 *  company's OWN submitted estimates (latest vintage per period), not a model. */
export function forecastSeriesPoints(company, key, metric, quarterly = true) {
  const pts = forecastPoints(company, key);
  if (!quarterly) return pts;
  const qp = rollUpQuarters(pts, metric);
  return qp.map((p, i) => {
    const expected = Math.max(p.months, i > 0 ? qp[i - 1].months : 1);
    return { ...p, expected, partial: p.agg === "sum" && p.months < expected && !p.reportedQuarterly };
  });
}

/** Every period any company has a forecast for. `futureOnly` keeps just the ones
 *  that haven't happened yet — measured against the data date, not the wall clock,
 *  so a dataset built months ago stays self-consistent. */
export function forecastPeriods(data, { futureOnly = true, quarterly = true } = {}) {
  const asOf = data.source?.asOf || null;
  const set = new Set();
  for (const c of data.companies || []) {
    for (const key in (c.forecast || {})) {
      for (const p of c.forecast[key] || []) {
        const d = quarterly ? quarterEndOf(p.d) : p.d;
        if (!futureOnly || !asOf || d > asOf) set.add(d);
      }
    }
  }
  return [...set].sort();
}

/** Latest point on the quarterly grid (or raw when quarterly=false), or null. */
export function latestPoint(company, key, metric, quarterly = true) {
  const p = seriesPoints(company, key, metric, quarterly);
  return p.length ? p[p.length - 1] : null;
}

/* ------------------------------------------------------------------ *
 *  Trailing-twelve-months (LTM) — the denominator for a multiple.     *
 *  A flow (P&L / cash-flow) must be a full YEAR, not one period, or a  *
 *  monthly reporter's revenue multiple is ~12× too high and a         *
 *  quarterly reporter's ~4×. A level (balance sheet) spans no time, so *
 *  its LTM is just the latest value.                                  *
 * ------------------------------------------------------------------ */

/** "Q# 'YY" label for a quarter-end date, e.g. "2025-03-31" → "Q1 '25". */
export function quarterLabel(d) {
  const [y, m] = String(d).split("-").map(Number);
  const q = { 3: 1, 6: 2, 9: 3, 12: 4 }[m] || Math.ceil(m / 3);
  return `Q${q} '${String(y).slice(-2)}`;
}

/** The quarter-end one quarter before `qEnd` ("YYYY-MM-DD" on a quarter boundary). */
function prevQuarterEnd(qEnd) {
  const [y, m] = String(qEnd).split("-").map(Number);
  const [py, pm] = { 3: [y - 1, 12], 6: [y, 3], 9: [y, 6], 12: [y, 9] }[m] || [y, m];
  return quarterEndOf(`${py}-${String(pm).padStart(2, "0")}-15`);
}

/** The four consecutive quarter-ends making up the trailing year that ENDS at
 *  `qEnd` (inclusive), oldest → newest. */
function trailingFourQuarters(qEnd) {
  const out = [qEnd];
  for (let i = 0, cur = qEnd; i < 3; i++) { cur = prevQuarterEnd(cur); out.unshift(cur); }
  return out;
}

/** Trailing-twelve-months value of a company+metric, cadence-aware. A level returns
 *  its latest value; a flow returns a full year (the four quarters ending at the
 *  latest reported quarter, or the annual/semiannual equivalent). `asOf` ends the
 *  window at a chosen date (inclusive) instead of the latest period. Returns
 *  { v, complete, basis, asOf, cur, missing } (v=null + `missing` quarter labels
 *  when a flow is short of a full year), or null when nothing is reported. */
export function ltmValue(company, key, metric, asOf = null) {
  const upto = (pts) => (asOf ? pts.filter((p) => p.d <= asOf) : pts);
  const last = (pts) => (pts.length ? pts[pts.length - 1] : null);
  if (aggOf(metric) !== "sum") {                 // level → point-in-time is already right
    const l = last(upto(seriesPoints(company, key, metric, true)));
    return l ? { v: l.v, complete: true, basis: "level", asOf: l.d, cur: l.cur, missing: [] } : null;
  }
  const cad = metricCadence(company, key);
  if (cad === "annual") {                         // one annual filing already spans a year
    const l = last(upto(pointsFor(company, key)));
    return l ? { v: l.v, complete: true, basis: "annual", asOf: l.d, cur: l.cur, missing: [] } : null;
  }
  if (cad === "semiannual") {                     // two halves ~6 months apart = a year
    const pts = upto(pointsFor(company, key));
    const end = pts[pts.length - 1], prev = pts[pts.length - 2];
    const span = prev ? monthsBetween(prev.d, end.d) : null;
    const complete = span != null && span >= 5 && span <= 7;
    return {
      v: complete ? (end.v || 0) + (prev.v || 0) : null,
      complete, basis: "ltm", asOf: end ? end.d : null, cur: end ? end.cur : null,
      missing: complete ? [] : ["the prior half-year"],
    };
  }
  // monthly / quarterly: sum the four quarters ending at the chosen (or latest) quarter
  const qs = upto(seriesPoints(company, key, metric, true));
  if (!qs.length) return null;
  const end = qs[qs.length - 1].d;
  const byQ = new Map(qs.map((p) => [p.d, p]));
  const missing = [], parts = [];
  for (const q of trailingFourQuarters(end)) {
    const p = byQ.get(q);
    if (!p || p.partial) missing.push(quarterLabel(q));   // absent OR incomplete quarter
    else parts.push(p);
  }
  const complete = missing.length === 0;
  return {
    v: complete ? parts.reduce((s, p) => s + (p.v || 0), 0) : null,
    complete, basis: "ltm", asOf: end,
    cur: (parts[parts.length - 1] || qs[qs.length - 1]).cur,
    missing,
  };
}

/** Change over `steps` quarters on the quarterly grid (1 = QoQ, 4 = YoY).
 *  Operating on rolled-up quarters is what makes this a true quarter-over-quarter
 *  comparison for a monthly reporter (Q4 total vs Q3 total, not Dec vs Sep).
 *  Falls back to the calendar-based raw comparison when quarterly=false.
 *  Returns { g, cur, prev } or null. */
export function quarterChange(company, key, metric, steps, quarterly = true) {
  // "Fundraising Required is up 100% QoQ" is noise, not insight.
  if (isQualitative(metric)) return null;
  if (!quarterly) {
    const r = changeOverMonths(company, key, steps * 3, steps === 1 ? 1 : 2);
    return r ? { g: r.g, cur: r.cur, prev: r.prev } : null;
  }
  const qp = quarterlyPoints(company, key, metric);
  if (qp.length < 2) return null;
  const cur = qp[qp.length - 1];
  // walk back by calendar quarters so a skipped quarter doesn't silently shift
  const targetQ = shiftQuarters(cur.d, -steps);
  const prev = qp.find((p) => p.d === targetQ);
  if (!prev || prev.v === 0) return null;
  return { g: (cur.v - prev.v) / Math.abs(prev.v), cur, prev };
}

/** Shift a quarter-end date by n quarters (n may be negative). */
export function shiftQuarters(qEnd, n) {
  const [y, m] = String(qEnd).split("-").map(Number);
  const qi = Math.floor((m - 1) / 3) + n;          // 0-based quarter index, shifted
  const yy = y + Math.floor(qi / 4);
  const q = ((qi % 4) + 4) % 4;
  return quarterEndOf(`${yy}-${String(q * 3 + 1).padStart(2, "0")}-01`);
}

/** Human label for a cadence string. */
export function cadenceLabel(c) {
  return { monthly: "Monthly", quarterly: "Quarterly", semiannual: "Semi-annual", annual: "Annual", single: "One period", mixed: "Mixed", unknown: "—", none: "—" }[c] || "—";
}

/** Companies that report a given metric. */
export function companiesWith(data, key) {
  return (data.companies || []).filter((c) => pointsFor(c, key).length);
}

/** Metrics a given company reports, in display order (qualitative first). */
export function metricsFor(data, company) {
  const has = new Set(Object.keys(company.series || {}));
  return orderMetrics((data.metrics || []).filter((m) => has.has(m.key)));
}

/** Metrics safe for arithmetic — drops flags, dates and prose, but KEEPS the
 *  "Months to <date KPI>" companions, which are ordinary numbers. Use for
 *  valuation multiples, benchmarks, formulas and covenants. */
export const numericMetrics = (metrics) => (metrics || []).filter((m) => !isQualitative(m));

// ---- forecasts (Estimate instance_type) ----
/** Latest-logged forecast points for a company+metric: [{d, v, asOf}]. */
export const forecastPoints = (company, key) => (company && company.forecast && company.forecast[key]) || [];
/** Every forecast vintage for a company+metric: [{asOf, points:[{d,v}]}]. */
export const vintagesFor = (company, key) => (company && company.forecastVintages && company.forecastVintages[key]) || [];

/** Companies that have any forecast for `key` (optionally requiring actuals too). */
export function companiesWithForecast(data, key, needActual = false) {
  return (data.companies || []).filter((c) =>
    forecastPoints(c, key).length && (!needActual || pointsFor(c, key).length));
}
/** Metric keys a given company forecasts (in dataset order). */
export function forecastMetricsFor(data, company) {
  const has = new Set(Object.keys((company && company.forecast) || {}));
  return (data.metrics || []).filter((m) => has.has(m.key));
}

/** Variance latest-actual vs the latest-logged forecast for the SAME period.
 *  Returns {period, actual, forecast, diff, pct} for the most recent period that
 *  has both, or null. */
export function actualVsForecast(company, key) {
  const acts = pointsFor(company, key);
  const fc = forecastPoints(company, key);
  if (!acts.length || !fc.length) return null;
  const fcByPeriod = new Map(fc.map((p) => [p.d, p.v]));
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i];
    if (fcByPeriod.has(a.d)) {
      const f = fcByPeriod.get(a.d);
      return { period: a.d, actual: a.v, forecast: f, diff: a.v - f, pct: f === 0 ? null : (a.v - f) / Math.abs(f) };
    }
  }
  return null;
}
