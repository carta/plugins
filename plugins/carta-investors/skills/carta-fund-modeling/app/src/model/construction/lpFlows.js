// The waterfall works on the whole LP class, so an LP's flows are the class's flows scaled by its share of that class.
import { addMonthsYm, deriveGeneral } from "./plan.js";

/** An entered LP's share of the plan's LP commitments, or 1 for everyone (no id). */
export function lpShare(plan, lpId) {
  if (!lpId) return 1;
  const lp = (plan.lps ?? []).find((x) => x.id === lpId);
  if (!lp) return 1;
  const entered = (plan.lps ?? []).reduce((s, x) => s + (x.commitment || 0), 0);
  const total = deriveGeneral(plan.general).lpCommitted > 0 ? deriveGeneral(plan.general).lpCommitted : entered;
  return total > 0 ? Math.min(1, (lp.commitment || 0) / total) : 0;
}

/** The LP class is all paid-in capital, the GP's commitment included, so LPs together hold their share of commitments. */
export function lpClassShare(plan, lpId) {
  const { committed } = plan.general;
  const lpPart = committed > 0 ? deriveGeneral(plan.general).lpCommitted / committed : 1;
  return lpShare(plan, lpId) * lpPart;
}

const cumulate = (xs) => { let c = 0; return xs.map((v) => (c += v)); };

/** `roc` is return of contributed capital, `pref` the preferred return, `profit` LPs' share after carry, `net` distributions less calls. */
export function lpFlows(plan, res, share = 1) {
  if (!res?.ok || !plan.general.startDate) return null;
  const s = res.series;
  const T = s.calls.length - 1;
  const k = (xs) => xs.map((v) => (v || 0) * share);
  const called = k(s.calls), roc = k(s.lpRoc), pref = k(s.lpPref), dist = k(s.lpDist);
  const profit = dist.map((d, t) => d - roc[t] - pref[t]);
  const net = dist.map((d, t) => d - called[t]);
  const quarters = Math.floor(T / 3) + 1;
  const dateOf = (q) => addMonthsYm(plan.general.startDate, Math.min(T, q * 3 + 2));
  const build = (monthly) => {
    const cum = cumulate(monthly);
    const perQuarter = Array.from({ length: quarters }, (_, q) => monthly.slice(q * 3, q * 3 + 3).reduce((a, b) => a + b, 0));
    return {
      monthly,
      total: cum[cum.length - 1] ?? 0,
      quarters: Array.from({ length: quarters }, (_, q) => ({ date: dateOf(q), cumulative: cum[Math.min(T, q * 3 + 2)], inPeriod: perQuarter[q] })),
    };
  };
  const out = { called: build(called), roc: build(roc), pref: build(pref), profit: build(profit), net: build(net) };
  return {
    share, startDate: plan.general.startDate, series: out,
    totals: { called: out.called.total, roc: out.roc.total, pref: out.pref.total, profit: out.profit.total, net: out.net.total, distributed: dist.reduce((a, b) => a + b, 0) },
    tvpi: res.metrics.tvpi, netIrr: res.metrics.netIrr,
  };
}
