// User-defined risk rules — the "conditional formatting for KPIs" engine. A rule
// is { id, name, metricKey, measure, op, threshold, tone }: pick a metric, pick
// what to measure on it (latest value / QoQ growth % / YoY growth % / % vs
// forecast), a comparison operator, and a threshold. Any company where the rule
// fires shows up as a signal. Pure functions over kpi.json — no React, no I/O.
import { metricOf, latest, qoqChange, yoyChange, actualVsForecast } from "./kpi.js";
import { fmtVal } from "../ui/charts.jsx";
import { withCommas } from "../ui/format.js";

// What to compute on the chosen metric. `pct: true` measures return a PERCENT
// number (e.g. 10 for +10%) and take their threshold as a percent too.
export const MEASURES = [
  { id: "latest", label: "Latest value", pct: false, suffix: "" },
  { id: "qoq", label: "QoQ growth %", pct: true, suffix: " QoQ growth" },
  { id: "yoy", label: "YoY growth %", pct: true, suffix: " YoY growth" },
  { id: "fcpct", label: "% vs forecast", pct: true, suffix: " vs forecast" },
];
export const measureOf = (id) => MEASURES.find((m) => m.id === id) || MEASURES[0];

export const OPS = [
  { id: "lt", sym: "<", fn: (a, b) => a < b },
  { id: "lte", sym: "≤", fn: (a, b) => a <= b },
  { id: "gt", sym: ">", fn: (a, b) => a > b },
  { id: "gte", sym: "≥", fn: (a, b) => a >= b },
  { id: "eq", sym: "=", fn: (a, b) => a === b },
  { id: "ne", sym: "≠", fn: (a, b) => a !== b },
];
export const opOf = (id) => OPS.find((o) => o.id === id) || OPS[0];

// Severity → Badge tone. Ordered most-severe first (drives the watchlist sort).
export const TONES = [
  { id: "negative", label: "Critical" },
  { id: "warning", label: "Warning" },
  { id: "info", label: "Info" },
];

/** The comparable value for a rule's measure on one company, or null if the
 *  company lacks the data. Percent measures return a percent number (×100). */
export function ruleValue(company, rule) {
  const key = rule.metricKey;
  if (!key) return null;
  if (rule.measure === "qoq") { const g = qoqChange(company, key); return g == null ? null : g * 100; }
  if (rule.measure === "yoy") { const g = yoyChange(company, key); return g == null ? null : g * 100; }
  if (rule.measure === "fcpct") { const v = actualVsForecast(company, key); return v && v.pct != null ? v.pct * 100 : null; }
  const l = latest(company, key); return l ? l.v : null; // latest value
}

/** Does the rule fire for this company? Returns { value } when it does, else null. */
export function ruleFires(company, rule) {
  const v = ruleValue(company, rule);
  if (v == null || !Number.isFinite(v)) return null;
  const thr = Number(rule.threshold);
  if (!Number.isFinite(thr)) return null;
  return opOf(rule.op).fn(v, thr) ? { value: v } : null;
}

const fmtMeasureVal = (data, rule, v) => {
  const meas = measureOf(rule.measure);
  if (meas.pct) return (v >= 0 ? "+" : "−") + withCommas(Math.abs(v).toFixed(0)) + "%";
  const m = metricOf(data, rule.metricKey);
  return fmtVal(v, m ? m.unit : "Number");
};
const fmtThreshold = (data, rule) => {
  const meas = measureOf(rule.measure);
  if (meas.pct) return `${rule.threshold}%`;
  const m = metricOf(data, rule.metricKey);
  return fmtVal(Number(rule.threshold), m ? m.unit : "Number");
};

/** Short human summary of the rule's condition, e.g. "Revenue QoQ growth < 10%". */
export function ruleCondition(data, rule) {
  const m = metricOf(data, rule.metricKey);
  const meas = measureOf(rule.measure);
  return `${m ? m.label : "?"}${meas.suffix} ${opOf(rule.op).sym} ${fmtThreshold(data, rule)}`;
}

/** Detail string for a fired signal, e.g. "Revenue QoQ growth is +4% (rule: < 10%)". */
export function ruleDetail(data, rule, value) {
  const m = metricOf(data, rule.metricKey);
  const meas = measureOf(rule.measure);
  return `${m ? m.label : "?"}${meas.suffix} is ${fmtMeasureVal(data, rule, value)} (rule: ${opOf(rule.op).sym} ${fmtThreshold(data, rule)})`;
}

/** Custom-rule signals firing for one company: [{ tag, tone, detail, custom, ruleId }]. */
export function customSignalsForCompany(data, company, rules) {
  const out = [];
  for (const r of rules || []) {
    if (!r.metricKey) continue;
    const hit = ruleFires(company, r);
    if (!hit) continue;
    out.push({ tag: r.name || ruleCondition(data, r), tone: r.tone || "warning",
      detail: ruleDetail(data, r, hit.value), custom: true, ruleId: r.id });
  }
  return out;
}

/** Portfolio-wide custom-rule signals, one row per (company, firing rule). */
export function customPortfolioSignals(data, rules) {
  const out = [];
  for (const c of data.companies || []) {
    for (const s of customSignalsForCompany(data, c, rules)) {
      out.push({ ...s, id: `${c.id}-${s.ruleId}`, company: c.name, companyId: c.id });
    }
  }
  return out;
}

let _seq = 0;
export const newRuleId = () => `r-${++_seq}-${(_seq * 2654435761) % 100000}`;
