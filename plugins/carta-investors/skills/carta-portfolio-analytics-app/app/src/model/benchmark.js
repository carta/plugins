// Cohort benchmarks for one KPI — median + quartile spread per cohort, and where
// each company lands against its cohort. Pure functions over kpi.json.
import { median, quantile, latestPoint, metricOf, isQualitative } from "./kpi.js";

// Round mnemonic → display label + a stable order. The builder emits lowercase
// mnemonics ("seed", "a", … "e"); keep this in step with the view's stageLabel.
export const STAGE_ORDER = ["seed", "a", "b", "c", "d", "e", "f", "g"];
export const stageLabel = (r) => {
  if (!r) return "—";
  const s = String(r).toLowerCase();
  if (s === "seed") return "Seed";
  if (/^[a-e]$/.test(s)) return "Series " + s.toUpperCase();
  return String(r).toUpperCase();
};

// Post-money valuation bands (upper-exclusive). Fixed round edges so a company
// keeps its band as the portfolio changes; labels are currency-agnostic prose
// (the fund's own currency is implied — bands are coarse, not a formatted figure).
export const VAL_BANDS = [
  { key: "lt10",   label: "< $10M",    max: 10e6 },
  { key: "10-25",  label: "$10–25M",   max: 25e6 },
  { key: "25-50",  label: "$25–50M",   max: 50e6 },
  { key: "50-100", label: "$50–100M",  max: 100e6 },
  { key: "100+",   label: "$100M+",    max: Infinity },
];

export const GROUP_BYS = [
  { id: "portfolio", label: "Portfolio" },
  { id: "stage",     label: "Stage" },
  { id: "vintage",   label: "Vintage" },
  { id: "valuation", label: "Valuation band" },
];

/** Cohort key/label/order for a company under a group-by, or null when the
 *  company lacks the grouping input (→ routed to excluded.noGroup). Portfolio
 *  always resolves — every company shares one lane. */
export function groupOf(company, groupBy) {
  if (groupBy === "stage") {
    const r = company?.lastRound?.round;
    if (!r) return null;
    const key = String(r).toLowerCase();
    const i = STAGE_ORDER.indexOf(key);
    // Non-standard rounds (common, preferred, one-offs) share an "Other" lane so
    // they don't each become a single-company lane with an overflowing label.
    if (i < 0) return { key: "other", label: "Other", order: 99 };
    return { key, label: stageLabel(key), order: i + 1 };
  }
  if (groupBy === "vintage") {
    const d = company?.returns?.firstDate;
    if (!d) return null;
    const yr = String(d).slice(0, 4);
    // Negative order → newest vintages sort to the top.
    return { key: yr, label: yr, order: -Number(yr) };
  }
  if (groupBy === "valuation") {
    const post = company?.lastRound?.postMoney;
    if (!Number.isFinite(post)) return null;
    const i = VAL_BANDS.findIndex((b) => post < b.max);
    const band = i >= 0 ? VAL_BANDS[i] : VAL_BANDS[VAL_BANDS.length - 1];
    return { key: band.key, label: band.label, order: i >= 0 ? i : VAL_BANDS.length - 1 };
  }
  return { key: "all", label: "All portfolio", order: 0 };
}

// Quartile bucket for a value against a lane's fences: Q1 <p25, Q2 <median,
// Q3 <p75, Q4 ≥p75. Null when the lane has no spread to bucket against.
function quartileOf(v, { p25, median: med, p75 }) {
  if (![p25, med, p75].every(Number.isFinite)) return null;
  if (v < p25) return 1;
  if (v < med) return 2;
  if (v < p75) return 3;
  return 4;
}

const EMPTY = (unit = "Number") => ({
  unit, cur: undefined,
  overall: { n: 0, median: null, p25: null, p75: null, min: null, max: null },
  lanes: [], excluded: { noMetric: [], noGroup: [] },
});

/** Benchmark a metric across cohorts (portfolio | stage | vintage | valuation).
 *  Values use the quarterly-normalized latest point so monthly and quarterly
 *  reporters are comparable. `cur` is the shared currency of every value, or
 *  undefined when they disagree — never assume USD. See the module tests for the
 *  full return shape (overall stats + per-lane stats + per-company placement). */
export function benchmark(data, metricKey, { groupBy = "portfolio" } = {}) {
  const metric = metricOf(data, metricKey);
  // Benchmarks are arithmetic — a flag/date/prose KPI has no median.
  if (!metric || isQualitative(metric)) return EMPTY(metric ? metric.unit : "Number");
  const unit = metric.unit || "Number";

  const noMetric = [], noGroup = [];
  const laneMap = new Map(); // key → { key, label, order, points: [] }
  const allVals = [];
  let cur, curMixed = false;

  for (const c of data.companies || []) {
    const lp = latestPoint(c, metricKey, metric, true);
    const value = lp && lp.v;
    if (!Number.isFinite(value)) { noMetric.push(c.name); continue; }

    const g = groupOf(c, groupBy);
    if (!g) { noGroup.push(c.name); continue; }

    if (lp.cur) {
      if (cur === undefined) cur = lp.cur;
      else if (cur !== lp.cur) curMixed = true;
    }
    allVals.push(value);
    if (!laneMap.has(g.key)) laneMap.set(g.key, { key: g.key, label: g.label, order: g.order, points: [] });
    laneMap.get(g.key).points.push({ id: c.id, name: c.name, value, cur: lp.cur });
  }

  const sharedCur = curMixed ? undefined : cur;

  const lanes = [...laneMap.values()].map((lane) => {
    const vals = lane.points.map((p) => p.value);
    const stats = {
      n: vals.length,
      median: median(vals),
      p25: quantile(vals, 0.25),
      p75: quantile(vals, 0.75),
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
    };
    const med = stats.median;
    const points = lane.points.map((p) => ({
      ...p,
      vsMedian: med ? (p.value - med) / Math.abs(med) : null,
      percentile: vals.length ? vals.filter((x) => x <= p.value).length / vals.length : null,
      quartile: quartileOf(p.value, stats),
    })).sort((a, b) => b.value - a.value);
    return { ...lane, ...stats, points };
  }).sort((a, b) => a.order - b.order || String(a.label).localeCompare(String(b.label)));

  return {
    unit, cur: sharedCur,
    overall: {
      n: allVals.length,
      median: median(allVals),
      p25: quantile(allVals, 0.25),
      p75: quantile(allVals, 0.75),
      min: allVals.length ? Math.min(...allVals) : null,
      max: allVals.length ? Math.max(...allVals) : null,
    },
    lanes,
    excluded: { noMetric, noGroup },
  };
}
