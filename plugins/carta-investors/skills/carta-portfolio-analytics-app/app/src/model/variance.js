// Forecast vs actuals: each reported period against the company's latest forecast for it.
// A % metric (gross margin) varies in points, not percent: 62% vs 60% is a 2-point miss.
import {
  seriesPoints, forecastSeriesPoints, forecastPoints, quarterEndOf, aggOf, median,
  metricOf, companiesWithForecast,
} from "./kpi.js";

/** |variance| at or under this counts as on forecast (5%, or 5 points for a % metric). */
export const ON_FORECAST_BAND = 0.05;
/** How many recent graded periods the hit rate and the summed total look back over. */
export const TRAILING_PERIODS = 4;
/** Where the heatmap color saturates: ±50% for a money/count KPI, ±10 points for a % KPI. */
export const HEAT_SATURATION = { pct: 0.5, pp: 0.1 };

// Metrics where landing UNDER forecast is the good outcome.
const LOWER_IS_BETTER = /\b(burn|expenses?|costs?|cogs|opex|churn|cac|spend|losses?)\b/i;
export const lowerIsBetter = (metric) => !!(metric && LOWER_IS_BETTER.test(metric.label || ""));

const isPercentUnit = (metric) => !!metric && (metric.unit === "Percentage" || metric.unit === "Percent");
/** "pp" when a metric's variance is a difference in points, else "pct". */
export const gapKindOf = (metric) => (isPercentUnit(metric) ? "pp" : "pct");

export const STATUS = {
  ahead: { label: "Ahead of forecast", tone: "positive" },
  on: { label: "On forecast", tone: "neutral" },
  behind: { label: "Behind forecast", tone: "negative" },
  currency: { label: "Currency mismatch", tone: "warning" },
};

/** "ahead" | "on" | "behind" for a variance, honoring the metric's direction. */
export function varianceStatus(gap, metric) {
  if (gap == null || !Number.isFinite(gap)) return null;
  if (Math.abs(gap) <= ON_FORECAST_BAND) return "on";
  const good = lowerIsBetter(metric) ? gap < 0 : gap > 0;
  return good ? "ahead" : "behind";
}

/** A variance re-signed so positive always means "better than forecast". */
export const goodness = (gap, metric) => (gap == null ? null : lowerIsBetter(metric) ? -gap : gap);

/** One row per period with both an actual and a forecast, ascending. Skips partial quarters,
 *  so a half-filed quarter never reads as a miss. `gap` is null across two currencies. */
export function forecastVariance(company, key, metric, { quarterly = true } = {}) {
  const acts = seriesPoints(company, key, metric, quarterly);
  const fcs = forecastSeriesPoints(company, key, metric, quarterly);
  if (!acts.length || !fcs.length) return [];
  const fcBy = new Map(fcs.map((p) => [p.d, p]));
  // The logged-on date of a rolled-up quarter is the newest of the months that fed it.
  const loggedBy = new Map();
  for (const p of forecastPoints(company, key)) {
    const d = quarterly ? quarterEndOf(p.d) : p.d;
    if (p.asOf && (!loggedBy.has(d) || p.asOf > loggedBy.get(d))) loggedBy.set(d, p.asOf);
  }
  const kind = gapKindOf(metric);
  const flow = aggOf(metric) === "sum";
  const rows = [];
  for (const a of acts) {
    const f = fcBy.get(a.d);
    if (!f || !Number.isFinite(a.v) || !Number.isFinite(f.v)) continue;
    if (a.partial || f.partial) continue;
    // A flow quarter summed from 3 months can't be held against a forecast of 1.
    if (quarterly && flow && !a.reportedQuarterly && !f.reportedQuarterly && a.months !== f.months) continue;
    const mismatch = !!(a.cur && f.cur && a.cur !== f.cur);
    const diff = a.v - f.v;
    const gap = mismatch ? null : kind === "pp" ? diff : f.v === 0 ? null : diff / Math.abs(f.v);
    const loggedOn = loggedBy.get(a.d) || null;
    rows.push({
      period: a.d, actual: a.v, forecast: f.v,
      diff: mismatch ? null : diff, gap, gapKind: kind,
      loggedOn, late: !!(loggedOn && loggedOn > a.d),
      cur: a.cur || f.cur || undefined, fcCur: f.cur || undefined,
      status: mismatch ? "currency" : varianceStatus(gap, metric),
    });
  }
  return rows;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Counts by status, hit rate (share at or ahead of forecast), median variance and latest period.
 *  `cumulative` sums the last `trailing` periods only for a flow metric in one currency. */
export function varianceSummary(rows, metric, { trailing = TRAILING_PERIODS } = {}) {
  const scored = (rows || []).filter((r) => r.gap != null);
  const count = (s) => scored.filter((r) => r.status === s).length;
  const ahead = count("ahead"), on = count("on"), behind = count("behind");
  const last = scored.length ? scored[scored.length - 1] : null;
  let cumulative = null;
  const tail = scored.slice(-trailing);
  const curs = new Set(tail.map((r) => r.cur || ""));
  if (aggOf(metric) === "sum" && !isPercentUnit(metric) && metric?.unit !== "Ratio" && tail.length >= 2 && curs.size === 1) {
    const actual = tail.reduce((s, r) => s + r.actual, 0);
    const forecast = tail.reduce((s, r) => s + r.forecast, 0);
    const gap = forecast === 0 ? null : (actual - forecast) / Math.abs(forecast);
    cumulative = { n: tail.length, from: tail[0].period, to: tail[tail.length - 1].period,
      actual, forecast, diff: actual - forecast, gap, cur: tail[0].cur, status: varianceStatus(gap, metric) };
  }
  return {
    n: scored.length, ahead, on, behind,
    mismatched: (rows || []).filter((r) => r.status === "currency").length,
    hitRate: scored.length ? (ahead + on) / scored.length : null,
    medianGap: scored.length ? median(scored.map((r) => r.gap)) : null,
    meanGap: mean(scored.map((r) => r.gap)),
    last, cumulative,
  };
}

/** Portfolio view for one metric: one row per company, sorted worst-first for `period`.
 *  `period` defaults to the newest period at least half the best-covered period's companies report.
 *  Amounts stay in each company's own currency; the roll-up never sums across companies. */
export function portfolioVariance(data, key, { quarterly = true, period = null, trailing = TRAILING_PERIODS, columns = 8 } = {}) {
  const metric = metricOf(data, key);
  const perCo = [];
  for (const c of companiesWithForecast(data, key, true)) {
    const rows = forecastVariance(c, key, metric, { quarterly });
    if (rows.length) perCo.push({ c, rows });
  }
  const coverage = new Map();
  for (const { rows } of perCo) for (const r of rows) if (r.gap != null) coverage.set(r.period, (coverage.get(r.period) || 0) + 1);
  const periods = [...coverage.keys()].sort();
  const best = Math.max(0, ...coverage.values());
  const fallback = [...periods].reverse().find((p) => coverage.get(p) * 2 >= best) || null;
  const chosen = period && coverage.has(period) ? period : fallback;
  const upTo = periods.filter((p) => !chosen || p <= chosen);
  const cols = upTo.slice(-columns);

  const rows = perCo.map(({ c, rows: rs }) => {
    const at = rs.find((r) => r.period === chosen) || null;
    const recent = rs.filter((r) => r.gap != null && (!chosen || r.period <= chosen)).slice(-trailing);
    const hits = recent.filter((r) => r.status === "ahead" || r.status === "on").length;
    return {
      id: c.id, name: c.name, at,
      byPeriod: Object.fromEntries(rs.filter((r) => r.gap != null).map((r) => [r.period, r.gap])),
      hitRate: recent.length ? hits / recent.length : null, n: recent.length,
    };
  });
  const score = (r) => (r.at && r.at.gap != null ? goodness(r.at.gap, metric) : null);
  rows.sort((a, b) => {
    const sa = score(a), sb = score(b);
    if (sa == null && sb == null) return a.name.localeCompare(b.name);
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sa - sb || a.name.localeCompare(b.name);
  });

  const graded = rows.filter((r) => r.at && r.at.gap != null);
  const count = (s) => graded.filter((r) => r.at.status === s).length;
  return {
    metric, period: chosen, periods, cols, rows, gapKind: gapKindOf(metric),
    summary: {
      compared: graded.length, ahead: count("ahead"), on: count("on"), behind: count("behind"),
      mismatched: rows.filter((r) => r.at && r.at.status === "currency").length,
      medianGap: graded.length ? median(graded.map((r) => r.at.gap)) : null,
    },
  };
}
