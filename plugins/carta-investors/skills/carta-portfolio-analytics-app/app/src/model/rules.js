// User-defined risk rules — the "conditional formatting for KPIs" engine. A rule
// is { id, name, metricKey, measure, op, threshold, threshold2?, tone }: pick a
// metric, pick what to measure on it (latest value / QoQ growth % / YoY growth % /
// % vs forecast), a comparison operator, and a threshold — or, for "between", a
// range from `threshold` to `threshold2`. Any company where the rule fires shows
// up as a signal. Pure functions over kpi.json — no React, no I/O.
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

// Signal rules add a range on top of OPS. OPS itself stays two-argument because
// cell color-coding (cellFormat.js) shares it and has no second threshold.
// Both ends count, as in the column filters' "between".
export const RULE_OPS = [
  ...OPS,
  { id: "between", sym: "between", range: true, fn: (a, lo, hi) => a >= lo && a <= hi },
];
export const ruleOpOf = (id) => RULE_OPS.find((o) => o.id === id) || RULE_OPS[0];

/** A range rule's [low, high], in order whichever way round they were typed,
 *  or null unless both are numbers. */
export function ruleRange(rule) {
  const blank = (x) => x == null || x === "";
  if (blank(rule.threshold) || blank(rule.threshold2)) return null;
  const a = Number(rule.threshold), b = Number(rule.threshold2);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a <= b ? [a, b] : [b, a];
}

/** Is a rule complete enough to save and evaluate? */
export function ruleIsComplete(rule) {
  if (!rule.metricKey) return false;
  if (ruleOpOf(rule.op).range) return ruleRange(rule) != null;
  return rule.threshold !== "" && rule.threshold != null && Number.isFinite(Number(rule.threshold));
}

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
  const op = ruleOpOf(rule.op);
  if (op.range) {
    const range = ruleRange(rule);
    if (!range) return null;
    return op.fn(v, range[0], range[1]) ? { value: v } : null;
  }
  const thr = Number(rule.threshold);
  if (!Number.isFinite(thr)) return null;
  return op.fn(v, thr) ? { value: v } : null;
}

const fmtMeasureVal = (data, rule, v) => {
  const meas = measureOf(rule.measure);
  if (meas.pct) return (v >= 0 ? "+" : "−") + withCommas(Math.abs(v).toFixed(0)) + "%";
  const m = metricOf(data, rule.metricKey);
  return fmtVal(v, m ? m.unit : "Number");
};
const fmtBound = (data, rule, x) => {
  if (measureOf(rule.measure).pct) return `${x}%`;
  const m = metricOf(data, rule.metricKey);
  return fmtVal(Number(x), m ? m.unit : "Number");
};
// "< $5.0M", or "between $300.0M and $500.0M" for a range rule.
const fmtTest = (data, rule) => {
  const op = ruleOpOf(rule.op);
  if (op.range) {
    const range = ruleRange(rule);
    const [lo, hi] = range || [rule.threshold, rule.threshold2];
    return `between ${fmtBound(data, rule, lo)} and ${fmtBound(data, rule, hi)}`;
  }
  return `${op.sym} ${fmtBound(data, rule, rule.threshold)}`;
};

/** Short human summary of the rule's condition, e.g. "Revenue QoQ growth < 10%". */
export function ruleCondition(data, rule) {
  const m = metricOf(data, rule.metricKey);
  const meas = measureOf(rule.measure);
  return `${m ? m.label : "?"}${meas.suffix} ${fmtTest(data, rule)}`;
}

/** Detail string for a fired signal, e.g. "Revenue QoQ growth is +4% (rule: < 10%)". */
export function ruleDetail(data, rule, value) {
  const m = metricOf(data, rule.metricKey);
  const meas = measureOf(rule.measure);
  return `${m ? m.label : "?"}${meas.suffix} is ${fmtMeasureVal(data, rule, value)} (rule: ${fmtTest(data, rule)})`;
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

// Rules persist in the dashboard doc across page loads, so an id must be unique
// across sessions, not just within one — a per-load counter hands every
// session's first rule the same id.
export const newRuleId = () => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `r-${c.randomUUID()}`;
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const EMPTY_RULES = [];
const _rulesCache = new WeakMap();

/** The dashboard doc's custom rules, each with an id no other rule shares.
 *  Docs saved before rule ids were unique can hold two rules under one id; the
 *  first keeps it and each repeat gets `<id>~2`, `<id>~3`, … — the same result
 *  every read, so filter selections and Edit/Delete stay attached to one rule.
 *  Cached per rules array so memos keyed on the result stay stable. Read rules
 *  through this, and write it back as `doc.rules` before editing the list so the
 *  repaired ids persist. */
export function rulesOf(doc) {
  const list = doc?.rules;
  if (!Array.isArray(list) || list.length === 0) return EMPTY_RULES;
  const hit = _rulesCache.get(list);
  if (hit) return hit;
  const taken = new Set(list.map((r) => r && r.id).filter(Boolean));
  const seen = new Set();
  let changed = false;
  const out = list.map((r) => {
    if (r && r.id && !seen.has(r.id)) { seen.add(r.id); return r; }
    const base = (r && r.id) || "r";
    let n = 2;
    while (taken.has(`${base}~${n}`)) n++;
    const id = `${base}~${n}`;
    taken.add(id); seen.add(id); changed = true;
    return { ...r, id };
  });
  const result = changed ? out : list;
  _rulesCache.set(list, result);
  return result;
}
