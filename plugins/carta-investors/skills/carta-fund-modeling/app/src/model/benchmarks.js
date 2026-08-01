// Cohort percentile interpolation + S&P same-cashflow comparator.

import { yearsBetween } from "./xirr.js";

/** 83 → "83rd", 71 → "71st", 84 → "84th" — correct English ordinals. */
export function ordinal(n) {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[v % 10] || "th";
  return `${v}${suffix}`;
}

/**
 * Where a TVPI sits in its vintage cohort, interpolating between the known
 * percentile marks. cohort: {p5, p10, p25, p50, p75, p90, p95} (any subset,
 * values in x). Carta's TEMPORAL_FUND_COHORT_BENCHMARKS publishes marks down
 * to p5, so most funds interpolate for real even below the median — only a
 * fund below the very lowest published mark falls back to a plain "below pN"
 * (no fabricated percentile, since there's no data point below it to interpolate
 * against).
 */
export function cohortPercentile(tvpi, cohort) {
  if (!cohort) return null;
  const marks = ["p5", "p10", "p25", "p50", "p75", "p90", "p95"]
    .filter((k) => cohort[k] != null)
    .map((k) => ({ p: Number(k.slice(1)), tvpi: cohort[k] }));
  if (!marks.length) return null;
  if (tvpi < marks[0].tvpi) return { text: `below ${ordinal(marks[0].p)}`, pctl: null, below: true, belowP: marks[0].p };
  const last = marks[marks.length - 1];
  if (tvpi >= last.tvpi) return { text: `${ordinal(last.p)}+`, pctl: last.p, above: true };
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i], b = marks[i + 1];
    if (tvpi >= a.tvpi && tvpi < b.tvpi) {
      const p = a.p + ((tvpi - a.tvpi) / (b.tvpi - a.tvpi)) * (b.p - a.p);
      return { text: ordinal(p), pctl: p, between: [a, b] };
    }
  }
  return null;
}

/**
 * S&P-equivalent multiple: compound each LP contribution at `rate` to the
 * horizon date; the multiple the fund must beat to outperform indexing the
 * same cash flows.
 */
export function spEquivalentMultiple(flows, horizonDate, rate = 0.102) {
  let fv = 0, paidIn = 0;
  for (const f of flows) {
    if (f.amount >= 0 || f.date > horizonDate) continue;
    const yrs = yearsBetween(f.date, horizonDate);
    fv += -f.amount * Math.pow(1 + rate, yrs);
    paidIn += -f.amount;
  }
  return paidIn > 0 ? fv / paidIn : null;
}
