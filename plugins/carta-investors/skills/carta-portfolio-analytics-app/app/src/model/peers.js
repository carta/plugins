// Peer context for one company — where it sits against the rest of the portfolio.
// The Company page otherwise shows a company in total isolation.
// Pure functions over kpi.json, like model/rules.js.
import { companiesWith, latest, pointsSince, median } from "./kpi.js";

/** Rank a company against every peer reporting the same metric.
 *
 *  Ranked high-to-low on the latest value. Returns null when the company doesn't
 *  report the metric, so callers can skip rather than print a fake rank.
 *  `percentile` is the share of peers this company is at or above (1 = top).
 */
export function rankOf(data, company, metricKey) {
  const peers = companiesWith(data, metricKey)
    .map((c) => ({ id: c.id, name: c.name, v: (latest(c, metricKey) || {}).v }));
  return rankAmong(peers, company.id);
}

/** Rank a company by its change since the fund invested, against every peer with
 *  an investment date and enough history on the metric. Same shape as rankOf, but
 *  `value` and `median` are fractional changes rather than levels. */
export function rankSinceInvestment(data, company, metricKey) {
  const peers = (data.companies || [])
    .map((c) => ({ id: c.id, name: c.name, v: (sinceInvestment(data, c, metricKey) || {}).change }));
  return rankAmong(peers, company.id);
}

function rankAmong(candidates, companyId) {
  const peers = candidates.filter((p) => Number.isFinite(p.v)).sort((a, b) => b.v - a.v);
  if (peers.length < 2) return null;
  const i = peers.findIndex((p) => p.id === companyId);
  if (i < 0) return null;
  return {
    rank: i + 1,
    of: peers.length,
    value: peers[i].v,
    percentile: (peers.length - i) / peers.length,
    median: median(peers.map((p) => p.v)),
    top: peers.slice(0, 3),
  };
}

/** Change in a metric since the fund first invested.
 *
 *  Needs an investment date, which only a fund-admin firm has (returns.firstDate).
 *  Uses the first reported point ON OR AFTER the investment as the entry value —
 *  the same basis as the Benchmarks tab's "Since investment" mode. */
export function sinceInvestment(data, company, metricKey) {
  const invested = company?.returns?.firstDate;
  if (!invested) return null;
  const pts = pointsSince(company, metricKey, invested);
  if (pts.length < 2) return null;
  const entry = pts[0], now = pts[pts.length - 1];
  // A percentage change off a zero base is undefined, not infinite. Say which of
  // the two reasons applies so the reader isn't left with a bare dash.
  if (!Number.isFinite(entry.v) || !Number.isFinite(now.v)) {
    return { invested, entry, now, change: null, reason: "A value is missing." };
  }
  if (entry.v === 0) {
    return { invested, entry, now, change: null,
      reason: "Started from zero, so a percentage change isn't defined — compare the figures directly." };
  }
  return { invested, entry, now, change: (now.v - entry.v) / Math.abs(entry.v), reason: null };
}

/** Peers at the same financing stage, with the cohort median on a metric.
 *  Stage comes from the cap table's last round, so it needs Carta cap-table
 *  coverage; returns null when this company has no logged round. */
export function stageCohort(data, company, metricKey) {
  const stage = company?.lastRound?.round;
  if (!stage) return null;
  const peers = (data.companies || []).filter(
    (c) => c.lastRound?.round === stage && Number.isFinite((latest(c, metricKey) || {}).v));
  if (peers.length < 2) return null;
  const vals = peers.map((c) => latest(c, metricKey).v);
  const mine = (latest(company, metricKey) || {}).v;
  const med = median(vals);
  return {
    stage,
    count: peers.length,
    median: med,
    value: Number.isFinite(mine) ? mine : null,
    vsMedian: Number.isFinite(mine) && med ? (mine - med) / Math.abs(med) : null,
  };
}

/** The n nearest peers by latest value on a metric — the default overlay set for
 *  a comparison chart, so the picker starts somewhere useful. */
export function nearestPeers(data, company, metricKey, n = 4) {
  const mine = (latest(company, metricKey) || {}).v;
  if (!Number.isFinite(mine)) return [];
  return companiesWith(data, metricKey)
    .filter((c) => c.id !== company.id && Number.isFinite((latest(c, metricKey) || {}).v))
    .map((c) => ({ c, d: Math.abs(latest(c, metricKey).v - mine) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.c);
}
