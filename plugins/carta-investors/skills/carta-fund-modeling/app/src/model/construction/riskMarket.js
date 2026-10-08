import { lightPortfolio, topOutcome, tierName } from "./light.js";
import { performanceCohorts } from "./faqMarket.js";

/** P(X = k) for X ~ Binomial(n, p), by the recurrence on k so no factorials are needed. */
export function binomialPmf(n, p) {
  const pmf = new Array(n + 1).fill(0);
  if (p <= 0) { pmf[0] = 1; return pmf; }
  if (p >= 1) { pmf[n] = 1; return pmf; }
  pmf[0] = Math.pow(1 - p, n);
  for (let k = 1; k <= n; k++) pmf[k] = (pmf[k - 1] * (n - k + 1) * p) / (k * (1 - p));
  return pmf;
}

/** Odds of each top-tier company count, treating companies as independent draws from the outcome table; uncertainty in the multiples isn't included. */
export function lightOdds(plan) {
  if (plan.mode !== "light") return null;
  const l = plan.light, N = l.companies;
  const top = topOutcome(l);
  if (!top || !(N > 0)) return null;
  const p = Math.min(1, Math.max(0, top.share || 0));
  const pmf = binomialPmf(N, p);
  let cum = 0, K = N;
  for (let k = 0; k <= N; k++) { cum += pmf[k]; if (cum >= 0.9999) { K = k; break; } }
  const byCount = Object.fromEntries(pmf.slice(0, K + 1).map((prob, k) => [k, prob]));
  return { label: tierName(top), companies: N, share: p, byCount, target: l.targetMoic };
}

/** The peer cutoffs for a grid metric, as { floor marks } in the metric's own units, or null when there are none. */
export function peerThresholds(cohort, metric) {
  const band = { tvpi: cohort?.tvpi, grossMoic: cohort?.moic, netIrr: cohort?.irr }[metric];
  if (!band) return null;
  const scale = metric === "netIrr" ? 0.01 : 1; // Carta publishes IRR in percent
  const marks = [["p50", "Median"], ["p75", "Top quartile"], ["p90", "Top decile"]].filter(([k]) => band[k] != null).map(([k, label]) => ({ key: k, label, value: band[k] * scale }));
  return marks.length === 3 ? marks : null;
}

/** 0 below the median, 1 from the median, 2 from the top quartile, 3 from the top decile. */
export const peerBand = (value, marks) => (value == null ? null : marks.reduce((band, m, i) => (value >= m.value ? i + 1 : band), 0));

/** The firm's performance cohorts the grid can be compared with, each with the cutoffs for all three metrics. */
export function peerCohorts(snapshot) {
  const year = +(snapshot?.source?.navAsOf ?? "").slice(0, 4) || new Date().getFullYear();
  return performanceCohorts(snapshot).map((c) => {
    const b = snapshot.benchmarks?.[c.fundId] ?? {};
    return { ...c, moic: b.moic, irr: b.irr, year };
  });
}

/** Company multiples in the same buckets a plan's tiers fall into. */
export const RECORD_BUCKETS = [
  { id: "loss", label: "Under 0.25×", max: 0.25 },
  { id: "low", label: "0.25–1.5×", max: 1.5 },
  { id: "mid", label: "1.5–5×", max: 5 },
  { id: "large", label: "5–15×", max: 15 },
  { id: "top", label: "15× and up", max: Infinity },
];
const bucketOf = (m) => RECORD_BUCKETS.find((b) => m < b.max)?.id ?? "top";

export function positionCurrencies(positions, snapshot) {
  const ccyOf = Object.fromEntries((snapshot?.funds ?? []).map((f) => [f.id, f.currency ?? null]));
  return new Set((positions ?? []).map((p) => ccyOf[p.fundId] ?? null));
}

/** The firm's companies by multiple so far: current value plus proceeds, over cost. */
export function trackRecord(companies, snapshot) {
  const multiples = [];
  for (const c of companies ?? []) {
    // Amounts held in more than one currency can't be added.
    if (c.archived || positionCurrencies(c.positions, snapshot).size > 1) continue;
    const cost = (c.positions ?? []).reduce((s, p) => s + (p.cost || 0), 0);
    if (!(cost > 0)) continue;
    multiples.push((c.positions.reduce((s, p) => s + (p.cartaFv || 0) + (p.proceeds || 0), 0)) / cost);
  }
  if (!multiples.length) return null;
  const counts = Object.fromEntries(RECORD_BUCKETS.map((b) => [b.id, 0]));
  for (const m of multiples) counts[bucketOf(m)]++;
  return { n: multiples.length, shares: Object.fromEntries(RECORD_BUCKETS.map((b) => [b.id, counts[b.id] / multiples.length])), counts };
}

/** The plan's companies in the same buckets: Failed is the first, every other tier by its multiple. */
export function planRecord(plan) {
  const book = lightPortfolio(plan.light);
  const shares = Object.fromEntries(RECORD_BUCKETS.map((b) => [b.id, 0]));
  for (const g of book.groups) shares[g.id === "failed" ? "loss" : bucketOf(g.multiple)] += book.companies > 0 ? g.count / book.companies : 0;
  return shares;
}
