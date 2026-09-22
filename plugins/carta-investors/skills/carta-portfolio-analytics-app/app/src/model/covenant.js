// Covenant tracking — test a formula against a threshold each quarter and report
// HEADROOM, the number a credit investor actually watches.
//
// A covenant is just a saved formula plus: a direction (≤ or ≥), a threshold
// (optionally stepping down over time), and a test basis. The expression language
// is identical to the Formulas builder — compile()/resolveRefs() are reused
// verbatim — so anything you can express there you can put a covenant on.
//
// WHY LTM: every real credit agreement tests maintenance covenants on
// last-twelve-month figures. Using a single quarter's EBITDA in Debt/EBITDA makes
// the ratio read about 4x too high and would show a healthy book as breaching.
// So on the "ttm" basis a FLOW (EBITDA, revenue, capex — metric.agg === "sum")
// sums the four quarters ending at the test date, while a BALANCE (debt, cash —
// agg "last") takes the closing value. That flow-vs-balance split is exactly the
// credit-agreement convention and it comes straight from metadata the build
// pipeline already sets, via aggOf().
//
// This tests REPORTED KPI DATA against thresholds the user types in. It does not
// read credit agreements, and knows nothing about EBITDA add-backs, equity cure
// rights, or springing covenants — those live in the loan documents.
import { compile, resolveRefs } from "./formula.js";
import { quarterlyPoints, aggOf, metricOf, shiftQuarters } from "./kpi.js";

/** A trailing-twelve-month window needs all four quarters. A covenant computed
 *  from three quarters of EBITDA would understate it and manufacture a breach —
 *  for a compliance test, "not enough history" is the honest answer. */
export const MIN_TTM_QUARTERS = 4;

/** Default amber band: flag when headroom falls under 20% of the limit. The
 *  industry rule of thumb — on a 4.0x covenant you want to know at 3.2x, not 3.95x. */
export const DEFAULT_WATCH = 0.2;

export const DIRECTIONS = [
  { id: "max", label: "≤ at most", hint: "The value must stay AT OR BELOW the threshold — leverage, capex limits." },
  { id: "min", label: "≥ at least", hint: "The value must stay AT OR ABOVE the threshold — coverage ratios, minimum liquidity, minimum EBITDA." },
];
export const BASES = [
  { id: "ttm", label: "LTM", hint: "Last twelve months — flows (EBITDA, revenue) are summed across four quarters, balances (debt, cash) take the closing value. This is how credit agreements define every maintenance test." },
  { id: "point", label: "Point-in-time", hint: "Each quarter on its own reported figures. Correct for pure balance tests like a minimum cash covenant; wrong for anything dividing by EBITDA." },
];

/** Starting points. Latent ones (interest coverage, fixed charge, DSCR, capex)
 *  reference metrics the sample firms don't report — they stay hidden there and
 *  surface automatically for a firm that DOES report them. Callers gate with
 *  availablePresets(). */
export const COVENANT_PRESETS = [
  { name: "Max total leverage", direction: "max", basis: "ttm", unit: "Ratio", threshold: 4,
    expr: "({Loans Payable, Current} + {Loans Payable, Less Current}) ÷ {EBITDA}", requirePositive: "{EBITDA}",
    note: "Total debt ÷ LTM EBITDA. The most common maintenance covenant in a leveraged deal." },
  { name: "Max net leverage", direction: "max", basis: "ttm", unit: "Ratio", threshold: 3.5,
    expr: "({Loans Payable, Current} + {Loans Payable, Less Current} − {Cash and Cash Equivalents}) ÷ {EBITDA}", requirePositive: "{EBITDA}",
    note: "Debt net of cash ÷ LTM EBITDA. Sponsors usually negotiate for the net version." },
  { name: "Min liquidity", direction: "min", basis: "point", unit: "Dollar", threshold: 1000000,
    expr: "{Cash and Cash Equivalents}",
    note: "A hard cash floor. Genuinely point-in-time — it's a balance, not a flow." },
  { name: "Min LTM EBITDA", direction: "min", basis: "ttm", unit: "Dollar", threshold: 0,
    expr: "{EBITDA}",
    note: "An absolute earnings floor, common where a leverage ratio would be meaningless." },
  { name: "Min current ratio", direction: "min", basis: "point", unit: "Ratio", threshold: 1,
    expr: "{Total Current Assets} ÷ {Total Current Liabilities}",
    note: "Short-term assets against short-term obligations — a working-capital test." },
  { name: "Max debt / ARR", direction: "max", basis: "point", unit: "Ratio", threshold: 1,
    expr: "({Loans Payable, Current} + {Loans Payable, Less Current}) ÷ {ARR - End}", requirePositive: "{ARR - End}",
    note: "The venture-debt equivalent of a leverage test, for companies with no EBITDA to lend against." },
  // ---- latent: appear only for firms that report these metrics ----
  { name: "Min interest coverage", direction: "min", basis: "ttm", unit: "Ratio", threshold: 3,
    expr: "{EBITDA} ÷ {Interest Expense}", requirePositive: "{Interest Expense}",
    note: "LTM EBITDA ÷ LTM interest. One of the two classic maintenance covenants — needs an interest-expense KPI." },
  { name: "Min fixed charge coverage", direction: "min", basis: "ttm", unit: "Ratio", threshold: 1.25,
    expr: "({EBITDA} − {Capital Expenditures}) ÷ ({Interest Expense} + {Scheduled Principal Payments})", requirePositive: "{Interest Expense} + {Scheduled Principal Payments}",
    note: "Earnings after capex against everything contractually owed. Needs capex and principal KPIs." },
  { name: "Min debt service coverage", direction: "min", basis: "ttm", unit: "Ratio", threshold: 1.2,
    expr: "{EBITDA} ÷ ({Interest Expense} + {Scheduled Principal Payments})", requirePositive: "{Interest Expense} + {Scheduled Principal Payments}",
    note: "LTM EBITDA against total debt service. Needs interest and principal KPIs." },
  { name: "Max capex", direction: "max", basis: "ttm", unit: "Dollar", threshold: 5000000,
    expr: "{Capital Expenditures}",
    note: "An annual capital-spending cap. Needs a capex KPI." },
];

/** Presets whose every referenced KPI resolves for this firm. */
export function availablePresets(metrics) {
  return COVENANT_PRESETS.filter((p) => {
    const c = compile(p.expr);
    return !c.error && resolveRefs(c.refs, metrics || []).unknown.length === 0;
  });
}

/** Normalise a threshold list (always a list, even for one fixed value) and pick
 *  the entry in force at `period`: the latest whose `from` is on or before it.
 *  A null/blank `from` means "since inception". */
export function thresholdAt(cov, period) {
  const list = (cov?.thresholds || []).filter((t) => t && t.value != null && t.value !== "")
    .map((t) => ({ from: t.from || null, value: Number(t.value) }))
    .filter((t) => Number.isFinite(t.value))
    .sort((a, b) => (a.from || "") < (b.from || "") ? -1 : 1);
  if (!list.length) return null;
  let pick = null;
  for (const t of list) if (!t.from || !period || t.from <= period) pick = t;
  return pick ? pick.value : list[0].value;   // before the first dated step → earliest
}

/** Signed, relative room left. +0.2 = a fifth of the limit still available;
 *  negative = breached. Same reading in both directions, so one column works for
 *  a max and a min covenant side by side. */
export function headroomOf(value, threshold, direction) {
  if (value == null || threshold == null || !Number.isFinite(value) || !Number.isFinite(threshold)) return null;
  const denom = Math.abs(threshold);
  if (denom === 0) return direction === "max" ? (value <= 0 ? 0 : -1) : (value >= 0 ? 0 : -1);
  return direction === "max" ? (threshold - value) / denom : (value - threshold) / denom;
}

export function statusOf(headroom, watchPct = DEFAULT_WATCH) {
  if (headroom == null) return "untested";
  if (headroom < 0) return "breach";
  if (headroom < (watchPct ?? DEFAULT_WATCH)) return "watch";
  return "pass";
}

export const STATUS_LABEL = { breach: "Breach", watch: "Watch", pass: "Pass", untested: "No data", notmeaningful: "Not meaningful" };
export const STATUS_TONE = { breach: "negative", watch: "warning", pass: "positive", untested: "neutral", notmeaningful: "warning" };

/** Quarter-grid lookup per referenced KPI, carrying each metric's roll-up mode. */
function refGrid(data, company, refMap) {
  const grid = {};
  for (const name in refMap) {
    const key = refMap[name];
    const metric = metricOf(data, key);
    grid[name] = { pts: quarterlyPoints(company, key, metric), agg: aggOf(metric) };
  }
  return grid;
}

/** Evaluate a covenant across every quarter the company reports.
 *  Returns [{ d, value, threshold, headroom, status }] ascending. */
export function covenantSeries(data, company, cov, compiled, refMap) {
  if (!compiled?.fn) return [];
  const guard = cov.requirePositive ? compile(cov.requirePositive) : null;
  // Build the quarter grid from BOTH the main expression's refs AND the guard's
  // own refs, so a `requirePositive` referencing a KPI not used in the main
  // expression still resolves. Without this the guard reads "unavailable" every
  // quarter and the covenant is perpetually "Not meaningful".
  const gridMap = guard?.fn && guard.refs.length
    ? { ...refMap, ...resolveRefs(guard.refs, data.metrics || []).map }
    : refMap;
  const grid = refGrid(data, company, gridMap);
  const names = Object.keys(grid);
  if (!names.length) return [];
  const quarters = [...new Set(names.flatMap((n) => grid[n].pts.map((p) => p.d)))].sort();
  const ttm = (cov.basis || "ttm") === "ttm";
  const watch = cov.watchPct ?? DEFAULT_WATCH;
  // A ratio is only meaningful when its denominator is positive. Debt ÷ NEGATIVE
  // EBITDA comes out negative, which trivially satisfies "≤ 4.0x" — so a company
  // carrying debt with negative earnings, the single most distressed case, would
  // be reported as passing. On a real portfolio that was 47 of 72 tested
  // companies. `requirePositive` is an expression that must evaluate above zero
  // for the test to count; otherwise the quarter is flagged "Not meaningful"
  // rather than silently passed. It's why credit agreements pair a leverage
  // covenant with a minimum-EBITDA covenant.

  const out = [];
  for (const q of quarters) {
    // `back` is a month offset (12 for yoy()/prior()); shift the test quarter, then
    // apply the covenant's basis at that shifted date.
    const resolve = (name, back) => {
      const g = grid[name];
      if (!g) return null;
      const at = back ? shiftQuarters(q, -Math.round(back / 3)) : q;
      const val = (qd) => { const hit = g.pts.find((p) => p.d === qd); return hit ? hit.v : null; };
      if (!ttm || g.agg !== "sum") return val(at);          // balances always take the closing value
      let sum = 0, found = 0;
      for (let i = 0; i < 4; i++) { const v = val(shiftQuarters(at, -i)); if (v != null) { sum += v; found++; } }
      return found >= MIN_TTM_QUARTERS ? sum : null;         // a partial year is not a year
    };
    const value = compiled.fn(resolve);
    if (value == null || !Number.isFinite(value)) continue;
    const threshold = thresholdAt(cov, q);
    const guardVal = guard && guard.fn ? guard.fn(resolve) : null;
    if (guard && guard.fn && (guardVal == null || !Number.isFinite(guardVal) || guardVal <= 0)) {
      out.push({ d: q, value, threshold, headroom: null, status: "notmeaningful",
        reason: `${cov.requirePositive} is ${guardVal == null ? "unavailable" : "not positive"} — the ratio doesn't mean anything here` });
      continue;
    }
    const headroom = headroomOf(value, threshold, cov.direction);
    out.push({ d: q, value, threshold, headroom, status: statusOf(headroom, watch) });
  }
  return out;
}

/** Which companies a covenant applies to (empty/absent list = the whole book). */
export function appliesTo(data, cov) {
  const ids = cov?.companyIds || [];
  const all = data.companies || [];
  return ids.length ? all.filter((c) => ids.includes(c.id)) : all;
}

/** Latest test per company, tightest headroom first, with the change in headroom
 *  since the prior quarter — headroom erodes gradually, so the trend is often a
 *  better warning than the level. */
export function covenantTable(data, cov) {
  const compiled = compile(cov.expr || "");
  const { map, unknown } = resolveRefs(compiled.refs || [], data.metrics || []);
  if (compiled.error || unknown.length) {
    return { rows: [], error: compiled.error || `Unknown KPI: ${unknown.join(", ")}`, counts: {} };
  }
  const rows = [];
  for (const c of appliesTo(data, cov)) {
    const s = covenantSeries(data, c, cov, compiled, map);
    if (!s.length) continue;
    const last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null;
    rows.push({
      id: c.id, name: c.name, ...last, series: s,
      trend: prev && last.headroom != null && prev.headroom != null ? last.headroom - prev.headroom : null,
    });
  }
  rows.sort((a, b) => (a.headroom ?? Infinity) - (b.headroom ?? Infinity));
  const counts = rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  return { rows, error: null, counts, tested: rows.length, scope: appliesTo(data, cov).length };
}

/** Every company × covenant, tightest headroom first — the "which three are
 *  closest to tripping" view. */
export function portfolioBreaches(data, covenants) {
  const out = [];
  for (const cov of covenants || []) {
    const { rows, error } = covenantTable(data, cov);
    if (error) continue;
    for (const r of rows) out.push({ ...r, covenantId: cov.id, covenant: cov.name, direction: cov.direction, unit: cov.unit, basis: cov.basis });
  }
  out.sort((a, b) => (a.headroom ?? Infinity) - (b.headroom ?? Infinity));
  return out;
}
