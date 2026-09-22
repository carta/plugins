// Client-side forecasting methods for projecting an actual KPI series forward.
// Pure JS, deterministic. Each method fits the historical values and can produce
// (a) in-sample one-step predictions (for a residual band) and (b) a forward
// projection. No I/O, no dependencies.

// ---- date/cadence helpers (periods are ISO "YYYY-MM-DD" period-ends) ----
const parse = (d) => { const [y, m, day] = String(d).split("-").map(Number); return { y, m, day }; };
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
function addMonthsEnd(dateStr, n) {
  const { y, m } = parse(dateStr);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const dd = String(lastDay(ny, nm)).padStart(2, "0");
  return `${ny}-${String(nm).padStart(2, "0")}-${dd}`;
}
export function monthsBetween(a, b) {
  const A = parse(a), B = parse(b);
  return (B.y * 12 + B.m) - (A.y * 12 + A.m);
}
export function quartersBetween(a, b) { return Math.round(monthsBetween(a, b) / 3); }

/** Bias-adjust a forecast series by a company's historical signed error `bias`
 *  (mean of (forecast − actual)/actual — positive ⇒ habitually over-forecasts).
 *  weight ∈ [0,1] dials how much of the bias to remove. adjusted = raw / (1 + w·bias).
 *  Returns [{d, v}] (empty if bias is null or the divisor collapses). */
export function biasAdjustedForecast(forecastPts, bias, weight = 1) {
  if (bias == null || !Number.isFinite(bias)) return [];
  const k = 1 + weight * bias;
  if (k === 0) return [];
  return (forecastPts || []).map((p) => ({ d: p.d, v: p.v / k }));
}

/** Infer the step (months) between periods — 3 for quarterly, 1 for monthly. */
export function inferCadence(dates) {
  if (dates.length < 2) return 3;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(Math.abs(monthsBetween(dates[i - 1], dates[i])));
  gaps.sort((x, y) => x - y);
  return gaps[Math.floor(gaps.length / 2)] || 3;
}
export function futurePeriods(lastDate, cadence, horizon) {
  const out = [];
  for (let h = 1; h <= horizon; h++) out.push(addMonthsEnd(lastDate, cadence * h));
  return out;
}

// ---- fitting methods: each takes numeric values[] and returns
//      { fitted:[..|null], forecast:(h)=>number } ----
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const diffs = (v) => v.slice(1).map((x, i) => x - v[i]);

function fitLinear(v) {
  const n = v.length;
  const xs = v.map((_, i) => i);
  const mx = mean(xs), my = mean(v);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (v[i] - my); den += (xs[i] - mx) ** 2; }
  const b = den ? num / den : 0, a = my - b * mx;
  return { fitted: xs.map((x) => a + b * x), forecast: (h) => a + b * (n - 1 + h) };
}
function fitFlat(v) {
  const last = v[v.length - 1];
  return { fitted: v.map((_, i) => (i ? v[i - 1] : null)), forecast: () => last };
}
function fitDrift(v, k = 4) {
  const d = diffs(v);
  const drift = mean(d.slice(Math.max(0, d.length - k)));
  const last = v[v.length - 1];
  return { fitted: v.map((_, i) => (i ? v[i - 1] + drift : null)), forecast: (h) => last + drift * h };
}
function fitGrowth(v, k = 4) {
  const allPos = v.every((x) => x > 0);
  if (!allPos) return fitDrift(v, k); // geometric growth undefined with ≤0 values
  const ratios = v.slice(1).map((x, i) => x / v[i]).slice(-k).sort((a, b) => a - b);
  const r = ratios[Math.floor(ratios.length / 2)] || 1;
  const last = v[v.length - 1];
  return { fitted: v.map((_, i) => (i ? v[i - 1] * r : null)), forecast: (h) => last * Math.pow(r, h) };
}
function fitHolt(v, alpha = 0.5, beta = 0.3) {
  if (v.length < 2) return fitFlat(v);
  let level = v[0], trend = v[1] - v[0];
  const fitted = [null];
  for (let i = 1; i < v.length; i++) {
    const pred = level + trend;
    fitted.push(pred);
    const prevLevel = level;
    level = alpha * v[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return { fitted, forecast: (h) => level + h * trend };
}

export const METHODS = [
  { id: "holt", label: "Smoothed trend (Holt)", fit: (v) => fitHolt(v) },
  { id: "linear", label: "Linear trend", fit: (v) => fitLinear(v) },
  { id: "growth", label: "Trailing growth", fit: (v) => fitGrowth(v) },
  { id: "drift", label: "Moving-average", fit: (v) => fitDrift(v) },
  { id: "flat", label: "Flat (last value)", fit: (v) => fitFlat(v) },
];
export const methodById = (id) => METHODS.find((m) => m.id === id) || METHODS[0];

/** Residual standard deviation of a fitted model's one-step predictions. */
function residualStd(values, fitted) {
  const res = [];
  for (let i = 0; i < values.length; i++) if (fitted[i] != null) res.push(values[i] - fitted[i]);
  if (res.length < 2) return 0;
  const m = mean(res);
  return Math.sqrt(mean(res.map((r) => (r - m) ** 2)));
}

/**
 * Project an actual series forward.
 *   points: [{d, v}] (period-ascending)   methodId   horizon (# periods)
 * Returns { line:[{d,v}], band:{lo:[{d,v}], hi:[{d,v}]} } — line connects from the
 * last actual so it visually continues the series; band is ±1σ of residuals.
 */
export function projectSeries(points, methodId, horizon = 6) {
  const pts = (points || []).filter((p) => Number.isFinite(p.v));
  if (pts.length < 3) return null;
  const values = pts.map((p) => p.v);
  const dates = pts.map((p) => p.d);
  const model = methodById(methodId).fit(values);
  const sigma = residualStd(values, model.fitted);
  const cadence = inferCadence(dates);
  const fdates = futurePeriods(dates[dates.length - 1], cadence, horizon);
  const anchor = { d: dates[dates.length - 1], v: values[values.length - 1] };
  const line = [anchor], lo = [anchor], hi = [anchor];
  fdates.forEach((d, i) => {
    const v = model.forecast(i + 1);
    const spread = sigma * Math.sqrt(i + 1); // widen with horizon
    line.push({ d, v });
    lo.push({ d, v: v - spread });
    hi.push({ d, v: v + spread });
  });
  return { line, band: { lo, hi }, sigma };
}

/** Pick the method with the lowest holdout error on this series (hold out the
 *  last `holdout` points, fit on the rest, score one-step-ahead). */
export function bestMethod(points, holdout = 3) {
  const pts = (points || []).filter((p) => Number.isFinite(p.v));
  if (pts.length < 6) return null;
  const values = pts.map((p) => p.v);
  const cut = values.length - holdout;
  let best = null;
  for (const m of METHODS) {
    const model = m.fit(values.slice(0, cut));
    let err = 0, n = 0;
    for (let h = 1; h <= holdout; h++) {
      const actual = values[cut + h - 1];
      if (actual == null || actual === 0) continue;
      err += Math.abs((model.forecast(h) - actual) / actual); n++;
    }
    if (n) { const mape = err / n; if (!best || mape < best.mape) best = { id: m.id, label: m.label, mape }; }
  }
  return best;
}
