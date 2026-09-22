// Safe arithmetic evaluator for user-defined KPI formulas. No eval() — a tiny
// recursive-descent parser over +, −, ×, ÷, parentheses, numbers, and metric
// references written as {Metric Label}. Nulls propagate (a missing input or a
// divide-by-zero yields null, not a crash).
//
// Plus time functions — yoy(x), prior(x) and ltm(x) — which look BACKWARD in time.
// They are calendar-based (~12 months, ±2), never "N data points back": for a
// monthly reporter, four points back is four MONTHS, and a "YoY" built that way
// would be silently wrong. This reuses the same pointNearMonthsBack helper the
// QoQ/YoY columns use, so every year-over-year figure in the app is
// computed the same way.
import { pointNearMonthsBack, metricCadence } from "./kpi.js";

// Reporting cadence → months between periods, for ltm()'s trailing-year sum.
const CADENCE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

const OPS = { "×": "*", "÷": "/", "−": "-", "–": "-" }; // normalize pretty operators

/** Time functions. Each gets the inner expression as a function of a month-offset
 *  resolver, so it can evaluate the same sub-expression at a different date. */
export const FUNCS = {
  // fractional change vs ~12 months earlier: (now − then) / |then|
  yoy: (at) => { const now = at(0), then = at(12); return now == null || then == null || then === 0 ? null : (now - then) / Math.abs(then); },
  // the value itself, ~12 months earlier
  prior: (at) => at(12),
  // last twelve months: trailing-year sum of a FLOW metric at its own cadence
  // (4 quarters, 12 months, …). Null until a full year is present (no understated total).
  ltm: (at, ctx) => {
    const step = ctx && ctx.cadenceMonths;
    if (!step) return null;
    const n = Math.round(12 / step);
    let sum = 0;
    for (let i = 0; i < n; i++) { const v = at(i * step); if (v == null) return null; sum += v; }
    return sum;
  },
};

export function tokenize(expr) {
  const s = (expr || "").replace(/[×÷−–]/g, (m) => OPS[m]);
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n") { i++; continue; }
    if (ch === "{") {
      const end = s.indexOf("}", i);
      if (end < 0) throw new Error("Unclosed { in formula");
      toks.push({ t: "ref", v: s.slice(i + 1, end).trim() });
      i = end + 1; continue;
    }
    if ("+-*/()".includes(ch)) { toks.push({ t: ch }); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(i, j).toLowerCase();
      if (!FUNCS[name]) throw new Error(`Unknown function "${s.slice(i, j)}" — try ${Object.keys(FUNCS).join("() or ")}()`);
      toks.push({ t: "fn", v: name });
      i = j; continue;
    }
    throw new Error(`Unexpected character "${ch}"`);
  }
  return toks;
}

// Recursive-descent → a function fn(resolve) -> number|null.
// resolve(refName) returns the metric's value (number) or null if unavailable.
function parse(toks) {
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (t) => { const x = toks[pos]; if (!x || (t && x.t !== t)) throw new Error("Malformed formula"); pos++; return x; };

  // Every node is (res, ctx): res resolves a metric at a month-offset; ctx carries
  // evaluator hints (cadenceMonths) that time functions like ltm() need.
  function expr() { // + and −
    let left = term();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = eat().t, right = term();
      const l = left, r = right;
      left = (res, ctx) => bin(op, l(res, ctx), r(res, ctx));
    }
    return left;
  }
  function term() { // × and ÷
    let left = factor();
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = eat().t, right = factor();
      const l = left, r = right;
      left = (res, ctx) => bin(op, l(res, ctx), r(res, ctx));
    }
    return left;
  }
  function factor() {
    const tk = peek();
    if (!tk) throw new Error("Unexpected end of formula");
    if (tk.t === "-") { eat(); const f = factor(); return (res, ctx) => { const v = f(res, ctx); return v == null ? null : -v; }; }
    if (tk.t === "num") { eat(); return () => tk.v; }
    if (tk.t === "ref") { eat(); return (res) => res(tk.v, 0); }
    if (tk.t === "fn") {
      eat(); eat("("); const inner = expr(); eat(")");
      const f = FUNCS[tk.v];
      // `at(n)` re-evaluates the inner expression n months earlier, by shifting
      // every metric lookup inside it rather than the outer value.
      return (res, ctx) => f((n) => inner((name, off) => res(name, (off || 0) + n), ctx), ctx);
    }
    if (tk.t === "(") { eat("("); const e = expr(); eat(")"); return e; }
    throw new Error("Malformed formula");
  }
  const fn = expr();
  if (pos !== toks.length) throw new Error("Unexpected token in formula");
  return fn;
}

function bin(op, a, b) {
  if (a == null || b == null) return null;
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") return b === 0 ? null : a / b;
  return null;
}

/** Compile an expression → { fn, refs:[names], error }. */
export function compile(expr) {
  try {
    const toks = tokenize(expr);
    if (!toks.length) return { fn: null, refs: [], error: null };
    const refs = [...new Set(toks.filter((t) => t.t === "ref").map((t) => t.v))];
    const fn = parse(toks);
    return { fn, refs, error: null };
  } catch (e) {
    return { fn: null, refs: [], error: e.message };
  }
}

/* ---------- Default formulas seeded on first load ---------- */

/** Formulas every firm starts with, so the builder isn't an empty page and the
 *  derived KPI is already flowing through the Dashboard pivot
 *  and Company page without anyone having to build it. */
export const DEFAULT_FORMULAS = [
  { id: "seed-gross-margin", name: "Gross Profit Margin %", unit: "Percentage", expr: "{Gross Profit} ÷ {Revenue}" },
  { id: "seed-ltm-revenue", name: "LTM Revenue", unit: "Dollar", expr: "ltm({Revenue})" },
  { id: "seed-ltm-ebitda", name: "LTM EBITDA", unit: "Dollar", expr: "ltm({EBITDA})" },
];

/** Add any default formula this firm can actually evaluate, ONCE.
 *
 *  Two rules make this safe to run on every load:
 *   - a seeded id is recorded in `doc.seededFormulas`, so deleting the formula is
 *     permanent — it never silently reappears on the next refresh;
 *   - a default is skipped when its KPIs don't resolve for this firm, so a firm
 *     that doesn't report EBITDA gets no card reading "⚠ Unknown KPI".
 *  Returns a new doc, or null when there is nothing to do (so the caller can skip
 *  the write entirely rather than persisting a no-op).
 */
export function seedDefaultFormulas(doc, metrics) {
  if (!doc || !metrics || !metrics.length) return null;
  const seeded = new Set(doc.seededFormulas || []);
  const existing = doc.customMetrics || [];
  const add = DEFAULT_FORMULAS.filter((f) => {
    if (seeded.has(f.id)) return false;
    if (existing.some((x) => x.id === f.id || x.name === f.name)) return false;
    const c = compile(f.expr);
    return !c.error && resolveRefs(c.refs, metrics).unknown.length === 0;
  }).map((f) => ({ ...f, scope: "all", overrides: {} }));
  // Mark every default as considered — including ones this firm can't evaluate, so
  // we don't recompile them on every single load forever.
  const nextSeeded = [...new Set([...seeded, ...DEFAULT_FORMULAS.map((f) => f.id)])];
  if (!add.length && nextSeeded.length === seeded.size) return null;
  return { ...doc, customMetrics: [...existing, ...add], seededFormulas: nextSeeded };
}

/** Map a ref name (metric label OR key, case-insensitive) to a metric key. */
export function resolveRefs(refs, metrics) {
  const byLabel = new Map(metrics.map((m) => [m.label.toLowerCase(), m.key]));
  const byKey = new Map(metrics.map((m) => [m.key.toLowerCase(), m.key]));
  const map = {}; const unknown = [];
  for (const r of refs) {
    const k = byLabel.get(r.toLowerCase()) || byKey.get(r.toLowerCase());
    if (k) map[r] = k; else unknown.push(r);
  }
  return { map, unknown };
}

/** Evaluate a compiled formula across a company's history → [{d, v}] (ascending).
 *  A period is included only when every referenced metric has a value that period. */
export function formulaSeries(company, compiled, refKeyMap) {
  if (!compiled.fn) return [];
  const refs = compiled.refs;
  const maps = {}; // refName -> Map(period -> value)
  const pts = {};  // refName -> raw points, for backward-in-time lookups
  const periodSets = [];
  for (const r of refs) {
    const key = refKeyMap[r];
    if (!key) return []; // unresolved ref
    const arr = (company.series || {})[key] || [];
    maps[r] = new Map(arr.map((p) => [p.d, p.v]));
    pts[r] = arr;
    periodSets.push(arr.map((p) => p.d));
  }
  // candidate periods: if no refs (pure number), nothing to plot; else union
  const periods = [...new Set(periodSets.flat())].sort();
  // Cadence for ltm()'s trailing-year window. When refs disagree, the coarsest
  // (fewest periods per year) wins, so ltm never over-counts by summing too many.
  const cadences = refs.map((r) => CADENCE_MONTHS[metricCadence(company, refKeyMap[r])]).filter(Boolean);
  const ctx = { cadenceMonths: cadences.length ? Math.max(...cadences) : null };
  const out = [];
  for (const d of periods) {
    // `back` is a month offset: 0 = this period, 12 = the closest point ~a year
    // earlier (±2 months), so monthly and quarterly reporters both resolve to a
    // genuine year rather than a fixed number of rows back.
    const resolve = (name, back) => {
      if (!maps[name]) return null;
      if (!back) return maps[name].has(d) ? maps[name].get(d) : null;
      const p = pointNearMonthsBack(pts[name], d, back, 2);
      return p ? p.v : null;
    };
    const v = compiled.fn(resolve, ctx);
    if (v != null && Number.isFinite(v)) out.push({ d, v });
  }
  return out;
}

/** Latest evaluated value for a company (from the derived series), or null. */
export function formulaLatest(company, compiled, refKeyMap) {
  const s = formulaSeries(company, compiled, refKeyMap);
  return s.length ? s[s.length - 1] : null;
}
