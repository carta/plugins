// Forecast-accuracy analytics: grade GP-logged forecasts (every vintage) against
// what actually happened, and compare them to a naive "last actual" baseline.
// Pure JS over the kpi.json shapes. No I/O.
import { pointsFor, vintagesFor, companiesWithForecast } from "./kpi.js";
import { quartersBetween } from "./forecast.js";

/** Every (vintage → target-period) forecast that now has an actual, with error.
 *  Only lead ≥ 1 quarter counts as a real forecast (not a same-quarter estimate). */
export function forecastErrors(company, key) {
  const acts = pointsFor(company, key);
  if (!acts.length) return [];
  const actMap = new Map(acts.map((p) => [p.d, p.v]));
  const out = [];
  for (const vintage of vintagesFor(company, key)) {
    for (const p of vintage.points) {
      const actual = actMap.get(p.d);
      if (actual == null || actual === 0) continue;
      const lead = quartersBetween(vintage.asOf, p.d);
      if (lead < 1) continue;
      // naive baseline: the last actual known when this forecast was logged
      let naive = null;
      for (const a of acts) if (a.d <= vintage.asOf) naive = a.v; else break;
      out.push({
        asOf: vintage.asOf, period: p.d, lead,
        forecast: p.v, actual, naive,
        absPct: Math.abs((p.v - actual) / actual),
        signedPct: (p.v - actual) / actual,
        beatNaive: naive == null ? null : Math.abs(p.v - actual) < Math.abs(naive - actual),
      });
    }
  }
  return out;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Per-company accuracy for a metric: MAPE, bias (signed), sample size, and how
 *  often the GP forecast beat the naive baseline. Sorted worst-MAPE first. */
export function accuracyByCompany(data, key) {
  const rows = [];
  for (const c of companiesWithForecast(data, key, true)) {
    const errs = forecastErrors(c, key);
    if (!errs.length) continue;
    const naiveCmp = errs.filter((e) => e.beatNaive != null);
    rows.push({
      id: c.id, name: c.name, n: errs.length,
      mape: mean(errs.map((e) => e.absPct)),
      bias: mean(errs.map((e) => e.signedPct)),
      beatNaiveRate: naiveCmp.length ? mean(naiveCmp.map((e) => (e.beatNaive ? 1 : 0))) : null,
    });
  }
  return rows.sort((a, b) => (b.mape ?? 0) - (a.mape ?? 0));
}

/** Average |error| grouped by forecast lead time (quarters out), capped at 4+. */
export function errorByLeadTime(data, key) {
  const buckets = new Map();
  for (const c of companiesWithForecast(data, key, true)) {
    for (const e of forecastErrors(c, key)) {
      const lead = Math.min(e.lead, 4);
      if (!buckets.has(lead)) buckets.set(lead, []);
      buckets.get(lead).push(e.absPct);
    }
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0])
    .map(([lead, arr]) => ({ lead, label: lead >= 4 ? "4+ q" : `${lead}q`, mape: mean(arr), n: arr.length }));
}

/** Portfolio-level roll-up for a metric. */
export function accuracySummary(data, key) {
  const all = [];
  for (const c of companiesWithForecast(data, key, true)) all.push(...forecastErrors(c, key));
  const naiveCmp = all.filter((e) => e.beatNaive != null);
  return {
    n: all.length,
    companies: new Set(all.length ? companiesWithForecast(data, key, true).map((c) => c.id) : []).size,
    mape: mean(all.map((e) => e.absPct)),
    bias: mean(all.map((e) => e.signedPct)),
    beatNaiveRate: naiveCmp.length ? mean(naiveCmp.map((e) => (e.beatNaive ? 1 : 0))) : null,
  };
}
