// Company KPIs value filters, saved per view as `kpiFilters: [{ key, cond }]`; AND across KPIs.
// A condition reads the company's latest value on the grid shown (latest quarter, or month).
import { condMatches, isEmptyCond, FILTER_OPS } from "./overviewFilters.js";
import { latestPoint, metricOf, isQualitative } from "./kpi.js";
import { fmtVal } from "../ui/charts.jsx";

const listOf = (filters) => (Array.isArray(filters) ? filters : []);
const isActive = (f) => f && f.key && f.cond && !isEmptyCond("number", f.cond);

/** The conditions that still apply to this dataset: a KPI the firm no longer
 *  reports (or one that turned qualitative) is dropped, as Overview drops a stale
 *  column filter, and an empty condition constrains nothing. */
export function readKpiFilters(filters, data) {
  return listOf(filters).filter((f) => {
    if (!isActive(f)) return false;
    const m = metricOf(data, f.key);
    return !!m && !isQualitative(m);
  });
}

/** The value a condition compares: the latest actual on the grid shown, or null. */
export function kpiFilterValue(company, metric, quarterly) {
  const p = latestPoint(company, metric.key, metric, quarterly);
  return p && Number.isFinite(p.v) ? p.v : null;
}

/** `(company) => boolean` over every active condition. A company with no value
 *  for a KPI fails that condition unless it asks to include blanks. */
export function kpiFilterPredicate(filters, data, quarterly = true) {
  const active = readKpiFilters(filters, data).map((f) => ({ cond: f.cond, metric: metricOf(data, f.key) }));
  if (!active.length) return () => true;
  return (company) => active.every(({ cond, metric }) => condMatches("number", cond, kpiFilterValue(company, metric, quarterly)));
}

export const removeKpiFilter = (filters, key) => listOf(filters).filter((f) => f.key !== key);

/** Order-insensitive equality on the active conditions — the saved-view dirty check. */
export function sameKpiFilters(a, b) {
  const sig = (list) => listOf(list).filter(isActive).map((f) => `${f.key}=${JSON.stringify(f.cond)}`).sort().join("|");
  return sig(a) === sig(b);
}

/** The currencies a money KPI is reported in across the portfolio. A threshold is
 *  compared in each company's own currency, so with more than one the label and
 *  editor must not print a single currency symbol. */
export function kpiCurrencies(data, key) {
  const set = new Set();
  for (const c of data.companies || []) for (const p of (c.series || {})[key] || []) if (p && p.cur) set.add(p.cur);
  return [...set].sort();
}

/** Chip text, e.g. "Revenue > $0", "EBITDA 1.00M–5.00M (or blank)". */
export function kpiFilterLabel(filter, data) {
  const m = metricOf(data, filter.key);
  const label = m ? m.label : filter.key;
  const c = filter.cond;
  // Points with no recorded currency are in the fund's own, as elsewhere in the app.
  const found = m && m.unit === "Dollar" ? kpiCurrencies(data, m.key) : [];
  const curs = found.length || !data.source?.currency ? found : [data.source.currency];
  const fmt = (x) => {
    const n = Number(x);
    if (!m) return String(x);
    // One currency → its symbol; several → the bare number, read in each company's own currency.
    if (m.unit === "Dollar") return curs.length === 1 ? fmtVal(n, "Dollar", null, curs[0]) : fmtVal(n, "Number");
    return fmtVal(n, m.unit);
  };
  const op = FILTER_OPS.find((o) => o.id === c.op) || FILTER_OPS[0];
  const blanks = c.blanks ? " (or blank)" : "";
  return op.id === "between" ? `${label} ${fmt(c.a)}–${fmt(c.b)}${blanks}` : `${label} ${op.sym} ${fmt(c.a)}${blanks}`;
}
