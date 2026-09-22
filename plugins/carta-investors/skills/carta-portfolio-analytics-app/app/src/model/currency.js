// Exclude currencies from the dataset and convert KPI values to one target
// currency with user-entered FX rates. No-op until a currency is excluded or rated.

export const DEFAULT_CURRENCY = { excluded: [], target: null, rates: {} };

/** True when the settings would change any value (drop or convert). A target
 *  with no usable rate is inert, so selecting one alone does nothing. */
export function currencyActive(s) {
  if (!s) return false;
  const hasExcl = Array.isArray(s.excluded) && s.excluded.length > 0;
  const hasRate = !!(s.target && s.rates && Object.keys(s.rates).some((k) => k !== s.target && s.rates[k] > 0));
  return hasExcl || hasRate;
}

/** Currency codes that appear on any Dollar-carrying point (actuals + forecast),
 *  sorted — the set the currency control offers to exclude or rate. */
export function presentCurrencies(data) {
  const set = new Set();
  const scan = (map) => { for (const k in (map || {})) for (const p of map[k] || []) if (p && p.cur) set.add(p.cur); };
  for (const c of (data && data.companies) || []) { scan(c.series); scan(c.forecast); }
  return [...set].sort();
}

// Convert/drop one point. Points without a `cur` are non-Dollar KPIs (headcount,
// ratios) and are never touched. Returns null to drop an excluded point.
function convPoint(p, excluded, target, rates) {
  const cur = p && p.cur;
  if (!cur) return p;
  if (excluded.has(cur)) return null;
  if (target && cur !== target && rates[cur] > 0) {
    const r = rates[cur];
    const np = { ...p, cur: target };
    if (p.v != null) np.v = p.v * r;
    if (p.q != null) np.q = p.q * r;
    return np;
  }
  return p;
}

function convMap(map, excluded, target, rates) {
  if (!map) return map;
  const out = {};
  for (const k in map) {
    const pts = [];
    for (const p of map[k] || []) { const np = convPoint(p, excluded, target, rates); if (np) pts.push(np); }
    // Drop a series left empty by exclusion so the company stops "reporting" it.
    if (pts.length) out[k] = pts;
  }
  return out;
}

/** Data with Dollar KPI points excluded / converted per settings. Returns the
 *  same object unchanged when nothing is active, so it's free to call always.
 *  Valuations and returns are left as-is — they carry no per-point currency. */
export function withCurrency(data, settings) {
  if (!data || !currencyActive(settings)) return data;
  const excluded = new Set(settings.excluded || []);
  const target = settings.target || null;
  const rates = settings.rates || {};
  const companies = (data.companies || []).map((c) => {
    const next = { ...c };
    if (c.series) next.series = convMap(c.series, excluded, target, rates);
    if (c.forecast) next.forecast = convMap(c.forecast, excluded, target, rates);
    if (c.forecastVintages) {
      const fv = {};
      for (const k in c.forecastVintages) {
        fv[k] = (c.forecastVintages[k] || []).map((v) => ({
          ...v, points: (v.points || []).map((p) => convPoint(p, excluded, target, rates)).filter(Boolean),
        }));
      }
      next.forecastVintages = fv;
    }
    return next;
  });
  return { ...data, companies };
}
