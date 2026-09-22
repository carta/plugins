// Rule-based risk signals per company — shared by the Portfolio "Signals" tab and
// the Company page so the two never drift. Pure functions over kpi.json.
import { latest, growth, metricKeyByLabel } from "./kpi.js";
import { customSignalsForCompany } from "./rules.js";
import { fmtVal } from "../ui/charts.jsx";
import { withCommas } from "../ui/format.js";

// second-to-last QoQ growth (period n-1 vs n-2)
function growth2(company, key) {
  const p = (company.series || {})[key] || [];
  if (p.length < 3) return null;
  const a = p[p.length - 3].v, b = p[p.length - 2].v;
  return a === 0 ? null : (b - a) / Math.abs(a);
}

// The registry of built-in signals, independent of whether any company
// currently fires one — the Filters panel lists every id here so a signal
// with zero current matches still shows up (with a 0 count), the same way
// its tag/ruleId stays stable regardless of who's firing it right now.
export const BUILTIN_SIGNALS = [
  { id: "revenue-declining", tag: "Revenue declining" },
];

/** Built-in signals firing for one company: [{ tag, tone, detail, ruleId }].
 *  Only rule kept: sustained revenue decline (≥ 2 quarters down). Everything else
 *  is left to user-defined custom rules (model/rules.js). */
export function signalsForCompany(data, company) {
  const out = [];
  const revKey = metricKeyByLabel(data, /^revenue$/i);

  // revenue declining ≥ 2 quarters
  if (revKey) {
    const g1 = growth(company, revKey, 1), g2 = growth2(company, revKey);
    if (g1 != null && g2 != null && g1 < 0 && g2 < 0) {
      const l = latest(company, revKey);
      const [sig] = BUILTIN_SIGNALS;
      out.push({ tag: sig.tag, tone: "warning", ruleId: `builtin:${sig.id}`,
        detail: `Revenue fell ${withCommas(Math.abs(g1 * 100).toFixed(0))}% last quarter (2 down in a row), now ${fmtVal(l.v, "Dollar", undefined, l.cur)}` });
    }
  }
  return out;
}

/** Portfolio-wide signals, sorted by severity. */
export function portfolioSignals(data) {
  const order = { negative: 0, warning: 1, info: 2 };
  const out = [];
  for (const c of data.companies || []) {
    for (const s of signalsForCompany(data, c)) out.push({ ...s, id: `${c.id}-${s.tag}`, company: c.name, companyId: c.id });
  }
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

/** Every signal firing per company — built-in first, then custom rules — keyed
 *  by company id. Companies with no hits are absent, so `m[id] || []` is the
 *  idiom. Shared by the Overview's Signals column and its filter predicate. */
export function signalHitsByCompany(data, rules) {
  const m = {};
  for (const c of data.companies || []) {
    const hits = [...signalsForCompany(data, c), ...customSignalsForCompany(data, c, rules || [])];
    if (hits.length) m[c.id] = hits;
  }
  return m;
}
