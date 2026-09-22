// Review analytics — the three questions an analyst asks about a KPI pack before
// trusting anything in it:
//   whatChanged        what moved since last quarter, and who stopped reporting
//   reportingHealth    who is overdue, judged against their OWN cadence
//   dataQualityIssues  do the reported statements actually tie out
// Pure functions over the kpi.json shapes. No I/O.
import {
  monthsBetween, pointsFor, metricCadence, metricOf, metricKeyByLabel,
  quarterlyPoints, shiftQuarters,
} from "./kpi.js";

const isQuarterEnd = (d) => ["-03-", "-06-", "-09-", "-12-"].some((q) => String(d).includes(q));

/** THE definition of "this company reported in this quarter": any point landing in
 *  the three months ending at the quarter-end. Robust to monthly and quarterly
 *  reporters alike. Lifted out of views/Coverage.jsx so the grid, the digest and
 *  the health table can never drift apart on what "reported" means. */
export function coversQuarter(pts, qd) {
  return pts.some((p) => { const m = monthsBetween(p.d, qd); return m >= 0 && m <= 2; });
}

/** Every quarter-end in the dataset, ascending. */
export function quartersOf(data) {
  return (data.dimensions?.periods || []).slice().sort().filter(isQuarterEnd);
}

/** How many companies reported anything at all in a given quarter. */
export function coverageAt(data, qd) {
  let n = 0;
  for (const c of data.companies || []) {
    const series = c.series || {};
    for (const k in series) if (coversQuarter(series[k], qd)) { n++; break; }
  }
  return n;
}

const median = (a) => {
  const s = a.filter((v) => v != null).sort((x, y) => x - y);
  if (!s.length) return null;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/** The newest quarter whose coverage has SETTLED.
 *
 *  A quarter that just closed is always under-reported — companies haven't filed
 *  yet. On one test firm the newest quarter covers 47 of 106 companies versus 63
 *  the quarter before, purely because of filing lag. Defaulting a "what changed"
 *  digest to the newest quarter would therefore manufacture a wave of false
 *  "went dark" alerts every single time it's opened.
 *
 *  So: walk back from the newest quarter and take the first one whose coverage is
 *  at least 80% of the median coverage of the four quarters before it. Returns
 *  { quarter, latest, settled } — `settled` is false when the caller is looking at
 *  a quarter that is still filling up, so the view can say so instead of crying wolf.
 */
export function settledQuarter(data) {
  const qs = quartersOf(data);
  if (!qs.length) return { quarter: null, latest: null, settled: true };
  const latest = qs[qs.length - 1];
  for (let i = qs.length - 1; i >= 1; i--) {
    const prior = qs.slice(Math.max(0, i - 4), i).map((q) => coverageAt(data, q));
    const base = median(prior);
    if (base == null || base === 0) continue;
    if (coverageAt(data, qs[i]) >= 0.8 * base) return { quarter: qs[i], latest, settled: qs[i] === latest };
  }
  return { quarter: qs[qs.length - 1], latest, settled: true };
}

/** Is a given quarter still filling up (i.e. below the settled threshold)? */
export function isStillFiling(data, qd) {
  const qs = quartersOf(data);
  const i = qs.indexOf(qd);
  if (i < 1) return false;
  const base = median(qs.slice(Math.max(0, i - 4), i).map((q) => coverageAt(data, q)));
  if (base == null || base === 0) return false;
  return coverageAt(data, qd) < 0.8 * base;
}

/* ---------- Reporting health ---------- */

const CADENCE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/** Which bucket a company falls into, and by how much. Lateness is measured
 *  against the company's OWN cadence — an annual reporter is not late at six
 *  months, and flagging it as such would bury the companies that genuinely went
 *  dark. Cadence comes from metricCadence on the company's densest metric. */
export function reportingHealth(data) {
  const asOf = data.source?.asOf || null;
  const rows = [];
  for (const c of data.companies || []) {
    const series = c.series || {};
    const keys = Object.keys(series);
    const all = keys.flatMap((k) => series[k]);
    if (!all.length) {
      rows.push({ id: c.id, name: c.name, last: null, cadence: null, cadenceMonths: null,
        monthsSince: null, periodsLate: null, metricCount: 0, bucket: "never" });
      continue;
    }
    const last = all.reduce((m, p) => (p.d > m ? p.d : m), all[0].d);
    // the shortest cadence any metric is reported at = how often we hear from them
    let cadence = null, cadenceMonths = Infinity;
    for (const k of keys) {
      const cad = metricCadence(c, k);
      const m = CADENCE_MONTHS[cad];
      if (m && m < cadenceMonths) { cadenceMonths = m; cadence = cad; }
    }
    if (!cadence) { cadence = "quarterly"; cadenceMonths = 3; }   // single-point reporters
    const monthsSince = asOf ? monthsBetween(last, asOf) : null;
    const late = monthsSince == null ? null : monthsSince - cadenceMonths;
    const periodsLate = late == null ? null : Math.max(0, late / cadenceMonths);
    const bucket = late == null ? "unknown"
      : late <= 0 ? "ontime"
      : late <= cadenceMonths ? "late1"
      : late <= cadenceMonths * 3 ? "late23"
      : "overdue";
    rows.push({ id: c.id, name: c.name, last, cadence, cadenceMonths, monthsSince, periodsLate,
      metricCount: keys.length, bucket });
  }
  const order = { overdue: 0, never: 1, late23: 2, late1: 3, ontime: 4, unknown: 5 };
  rows.sort((a, b) => (order[a.bucket] - order[b.bucket]) || ((b.monthsSince ?? -1) - (a.monthsSince ?? -1)));
  const buckets = rows.reduce((m, r) => { m[r.bucket] = (m[r.bucket] || 0) + 1; return m; }, {});
  return { rows, buckets, asOf };
}

export const BUCKET_LABEL = {
  ontime: "On time", late1: "1 period late", late23: "2–3 periods late",
  overdue: "Badly overdue", never: "Never reported", unknown: "Unknown",
};

/* ---------- Data quality ---------- */

/** Relative tolerance on the accounting identities. Statements are reported in
 *  whole currency units and rounded, so an exact equality test would flag
 *  thousands of harmless roundings. 1% is loose enough to ignore rounding and
 *  tight enough that a genuinely broken balance sheet still trips it. */
export const TOLERANCE = 0.01;

export const CHECKS = [
  { id: "balance", label: "Balance sheet doesn't balance", severity: 1,
    hint: "Total assets should equal total liabilities plus total equity. When it doesn't, something in the reported statement is wrong or incomplete — treat that company's balance-sheet metrics with caution." },
  { id: "grossprofit", label: "Revenue − COGS ≠ gross profit", severity: 1,
    hint: "The three figures should reconcile. A mismatch usually means one of them is being reported on a different basis, so gross margin for that company won't mean what you think." },
  { id: "jump", label: "Implausible 10× jump", severity: 2,
    hint: "A value that moved more than tenfold (or fell below a tenth) in a single period. Occasionally real — a genuine step change — but far more often a units error, a currency change, or a typo." },
  { id: "curassets", label: "Current assets exceed total assets", severity: 1,
    hint: "Current assets are a subset of total assets, so this is arithmetically impossible as reported." },
  { id: "cash", label: "Cash exceeds total assets", severity: 1,
    hint: "Cash is a component of total assets, so this cannot be right as reported." },
  { id: "negative", label: "Negative value where impossible", severity: 2,
    hint: "Revenue and headcount can't be negative. Usually a sign convention flipped somewhere in the submission." },
  { id: "frozen", label: "Value frozen 5+ periods", severity: 3,
    hint: "The identical value repeated for five or more consecutive periods. Sometimes genuine (a dormant company), often a figure being carried forward rather than re-reported." },
];

const near = (a, b) => Math.abs(a - b) <= Math.abs(a || 1) * TOLERANCE;

/** Every data-quality issue in the portfolio, newest-first within each check.
 *  This flags what COMPANIES REPORTED — it is not a claim that Carta got
 *  something wrong. The view must say so. */
export function dataQualityIssues(data) {
  const K = {
    assets: metricKeyByLabel(data, /^total assets$/i),
    liabilities: metricKeyByLabel(data, /^total liabilities$/i),
    equity: metricKeyByLabel(data, /^total equity$/i),
    curAssets: metricKeyByLabel(data, /^total current assets$/i),
    cash: metricKeyByLabel(data, /^cash and cash equivalents$/i),
    revenue: metricKeyByLabel(data, /^revenue$/i),
    cogs: metricKeyByLabel(data, /^cogs$/i) || metricKeyByLabel(data, /cost of (goods|revenue)/i),
    grossProfit: metricKeyByLabel(data, /^gross profit$/i),
    headcount: metricKeyByLabel(data, /^headcount$/i),
  };
  const issues = [];
  // `metricKeys` names the KPI(s) each issue implicates, for per-row flagging.
  const push = (check, c, period, detail, metricKeys = []) =>
    issues.push({ check, companyId: c.id, company: c.name, period, detail, metricKeys: metricKeys.filter(Boolean) });

  for (const c of data.companies || []) {
    const map = (k) => new Map(k ? pointsFor(c, k).map((p) => [p.d, p.v]) : []);
    const A = map(K.assets), L = map(K.liabilities), E = map(K.equity);
    const CA = map(K.curAssets), CASH = map(K.cash);
    const R = map(K.revenue), C = map(K.cogs), G = map(K.grossProfit), HC = map(K.headcount);

    for (const [d, a] of A) {
      if (a && L.has(d) && E.has(d) && !near(a, L.get(d) + E.get(d)))
        push("balance", c, d, `assets ${a} vs liabilities+equity ${L.get(d) + E.get(d)}`, [K.assets, K.liabilities, K.equity]);
      if (a > 0 && CA.has(d) && CA.get(d) > a * (1 + TOLERANCE))
        push("curassets", c, d, `current assets ${CA.get(d)} > total assets ${a}`, [K.curAssets, K.assets]);
      if (a > 0 && CASH.has(d) && CASH.get(d) > a * (1 + TOLERANCE))
        push("cash", c, d, `cash ${CASH.get(d)} > total assets ${a}`, [K.cash, K.assets]);
    }
    for (const [d, r] of R) {
      if (r && C.has(d) && G.has(d) && !near(r, C.get(d) + G.get(d)))
        push("grossprofit", c, d, `revenue ${r} vs COGS+gross profit ${C.get(d) + G.get(d)}`, [K.revenue, K.cogs, K.grossProfit]);
      if (r < 0) push("negative", c, d, `revenue ${r}`, [K.revenue]);
    }
    for (const [d, h] of HC) if (h < 0) push("negative", c, d, `headcount ${h}`, [K.headcount]);

    for (const key of [K.revenue, K.headcount, K.assets]) {
      if (!key) continue;
      const pts = pointsFor(c, key);
      const label = (metricOf(data, key) || {}).label || key;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1].v, b = pts[i].v;
        if (a && b) {
          const ratio = Math.abs(b / a);
          if (ratio > 10 || ratio < 0.1) push("jump", c, pts[i].d, `${label} ${a} → ${b}`, [key]);
        }
      }
      const vals = pts.map((p) => p.v);
      if (vals.length >= 5 && vals[vals.length - 1] !== 0
        && new Set(vals.slice(-5)).size === 1)
        push("frozen", c, pts[pts.length - 1].d, `${label} unchanged at ${vals[vals.length - 1]} for 5+ periods`, [key]);
    }
  }

  const byCheck = CHECKS.map((ch) => {
    const list = issues.filter((i) => i.check === ch.id).sort((a, b) => (a.period < b.period ? 1 : -1));
    return { ...ch, issues: list, companies: new Set(list.map((i) => i.companyId)).size };
  }).filter((ch) => ch.issues.length);
  const affected = new Set(issues.map((i) => i.companyId)).size;
  return { issues, byCheck, affected, total: issues.length, checked: (data.companies || []).length };
}

/* ---------- What changed ---------- */

/** The quarter total for a company+metric (uses the shared quarterly roll-up, so a
 *  monthly reporter's quarter is the sum of its months, not just the last one). */
function quarterValue(data, company, key, qd) {
  const qp = quarterlyPoints(company, key, metricOf(data, key));
  const hit = qp.find((p) => p.d === qd);
  return hit ? hit.v : null;
}
/** ISO currency of a company+metric's latest quarterly point, or undefined. A
 *  company reports one currency per metric, so this labels its mover rows. */
function quarterCurrency(data, company, key) {
  const qp = quarterlyPoints(company, key, metricOf(data, key));
  return qp.length ? qp[qp.length - 1].cur : undefined;
}

/** Everything that moved between `quarter` and the quarter before it.
 *
 *  Movers are returned with BOTH the absolute and percentage change. Callers
 *  should rank by absolute by default: on a real portfolio the top percentage
 *  mover is some company going from $400 to $60K of revenue (+15,217%), which is
 *  noise, while the largest dollar swings are what actually move a fund.
 */
export function whatChanged(data, { quarter, metricKey } = {}) {
  const qs = quartersOf(data);
  const qd = quarter || settledQuarter(data).quarter;
  const prior = qd ? shiftQuarters(qd, -1) : null;
  const key = metricKey || metricKeyByLabel(data, /^revenue$/i);
  const metric = key ? metricOf(data, key) : null;
  const out = { quarter: qd, prior, metricKey: key, metric, movers: [], wentDark: [], started: [], forecastMisses: [] };
  if (!qd || !key) return out;

  for (const c of data.companies || []) {
    const pts = pointsFor(c, key);
    const anyPts = Object.values(c.series || {});
    const here = anyPts.some((s) => coversQuarter(s, qd));
    const there = prior ? anyPts.some((s) => coversQuarter(s, prior)) : false;

    if (there && !here) {
      const last = anyPts.flat().reduce((m, p) => (p.d > m ? p.d : m), "0000-00-00");
      out.wentDark.push({ id: c.id, name: c.name, last });
    }
    if (here) {
      const first = qs.find((q) => anyPts.some((s) => coversQuarter(s, q)));
      if (first === qd) out.started.push({ id: c.id, name: c.name, metricCount: Object.keys(c.series || {}).length });
    }
    if (!pts.length) continue;
    const cur = quarterValue(data, c, key, qd);
    const prev = prior ? quarterValue(data, c, key, prior) : null;
    if (cur != null && prev != null) {
      out.movers.push({ id: c.id, name: c.name, cur, prev, abs: cur - prev,
        pct: prev === 0 ? null : (cur - prev) / Math.abs(prev), curCode: quarterCurrency(data, c, key) });
    }
  }
  out.movers.sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs));
  out.wentDark.sort((a, b) => (a.last < b.last ? -1 : 1));
  out.started.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
