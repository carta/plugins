// Turns a client's warehouse history (fee schedules, spend, LP base) and fund-ops percentiles into starting points for a new plan.
import { feeTier, monthsBetween } from "./feeTiers.js";
import { uid } from "./plan.js";

const M = 1e6;

const BASES = [
  [/(limited|all) partners committed/i, "committed"],
  [/contributed capital/i, "called"],
  [/unreturned contributions/i, "calledNet"],
  [/cost basis/i, "costUnrealized"],
  [/\b(nav|fmv)\b/i, "fmv"],
];
/** The plan's fee basis for a fee-schedule "calculation base", or null when it has no equivalent (fixed, custom). */
export const baseOf = (text) => BASES.find(([re]) => re.test(text ?? ""))?.[1] ?? null;

const dayAfter = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10);

/** Months count from the fund's first period; `skipped` lists periods a tier can't express (fixed, custom or one-time fees). */
export function feeTiersFromHistory(periods, termMonths = Infinity) {
  const first = (periods ?? []).map((p) => p.start).filter(Boolean).sort()[0];
  const skipped = [];
  const used = [];
  for (const p of periods ?? []) {
    const basis = baseOf(p.base);
    if (/one-time/i.test(p.frequency ?? "")) { skipped.push(`${p.name || "A period"}: one-time fee`); continue; }
    if (!basis || p.rate == null) { skipped.push(`${p.name || "A period"}: ${p.base || "no base"}`); continue; }
    const startMonth = first && p.start ? monthsBetween(first, p.start) + 1 : 1;
    // A period ends the day before the next starts, so mid-month changes (a step-down on the 15th) meet without overlapping.
    let endMonth = p.end && first ? monthsBetween(first, dayAfter(p.end)) : null;
    if (endMonth != null && p.end < p.start) continue;
    if (endMonth != null) endMonth = Math.max(endMonth, startMonth);
    if (startMonth > termMonths) continue;
    used.push({ rate: p.rate, basis, startMonth, endMonth: endMonth != null && endMonth >= termMonths ? null : endMonth });
  }
  used.sort((a, b) => a.startMonth - b.startMonth);
  const merged = [];
  for (const t of used) {
    const prev = merged.at(-1);
    if (prev && prev.endMonth != null && prev.endMonth + 1 === t.startMonth && prev.rate === t.rate && prev.basis === t.basis) prev.endMonth = t.endMonth;
    else merged.push({ ...t });
  }
  return { tiers: merged.map(feeTier), skipped };
}

/** Past fund's operating spend: average a year, and as a share of its commitments. */
export function expenseRunRate({ fund, metrics, asOf }) {
  const opex = metrics?.opex;
  if (!(opex > 0) || !fund?.vintage || !asOf) return null;
  const years = Math.max(1, +asOf.slice(0, 4) + (+asOf.slice(5, 7) - 1) / 12 - fund.vintage);
  const perYear = opex / years;
  return { perYear, years, pctOfCommitted: fund.committed > 0 ? perYear / fund.committed : null };
}

const ONE_TIME = /organi[sz]ation|formation|offering|syndication|start-?up/i;
const sum = (xs) => xs.reduce((t, v) => t + v, 0);
const roundTo = (v, step) => Math.round(v / step) * step;

/** Running costs average the last three complete calendar years; launch costs become one year-1 line; amounts scale to the new fund's size unless `scale` is off. */
export function expenseLinesFromLedger(accounts, { asOfYear, pastCommitted, committed, termYears, scale = true }) {
  const factor = scale && pastCommitted > 0 && committed > 0 ? committed / pastCommitted : 1;
  const recurring = [], launch = [];
  for (const a of accounts ?? []) {
    const name = (a.name ?? "").trim();
    const years = Object.entries(a.byYear ?? {}).map(([y, v]) => [+y, v]).filter(([, v]) => v > 0).sort((x, y) => x[0] - y[0]);
    if (!name || !years.length) continue;
    if (ONE_TIME.test(name)) {
      launch.push({ name, annualAmount: roundTo(sum(years.map(([, v]) => v)) * factor, 100), startYear: 0, endYear: 1, oneTime: true });
      continue;
    }
    const complete = years.filter(([y]) => y < asOfYear);
    const used = (complete.length ? complete : years).slice(-3);
    recurring.push({ name, annualAmount: roundTo((sum(used.map(([, v]) => v)) / used.length) * factor, 100), startYear: 0, endYear: termYears, oneTime: false, basis: used.map(([y]) => y) });
  }
  recurring.sort((a, b) => b.annualAmount - a.annualAmount);
  const lines = [...recurring, ...launch].filter((l) => l.annualAmount > 0);
  return { lines, perYear: sum(recurring.map((l) => l.annualAmount)), launch: sum(launch.map((l) => l.annualAmount)), factor };
}

export function describeTier(t, baseLabel) {
  const pct = `${(t.rate * 100).toFixed(2)}%`;
  const base = baseLabel.charAt(0).toLowerCase() + baseLabel.slice(1);
  return `${pct} on ${base}, ${t.endMonth == null ? `from month ${t.startMonth}` : `months ${t.startMonth} to ${t.endMonth}`}`;
}

const BUCKETS = [["<1m", 1 * M], ["1m-2m", 2 * M], ["2m-5m", 5 * M], ["5m-10m", 10 * M], ["10m-25m", 25 * M], ["25m-100m", 100 * M], ["100m-250m", 250 * M], ["250m+", Infinity]];
export const bucketOf = (committed) => (committed > 0 ? BUCKETS.find(([, max]) => committed < max)[0] : null);

/** Same size bucket (else the nearest), old enough to show several years of fees, most funds; market data is USD, so other currencies get none. */
export function marketCohort(ops, { committed, currency }, asOfYear) {
  if (!ops?.cohorts?.length || currency !== "USD" || !(committed > 0)) return null;
  const order = BUCKETS.map(([id]) => id);
  const want = order.indexOf(bucketOf(committed));
  const ranked = ops.cohorts
    .map((c) => ({ c, dist: Math.abs(order.indexOf(c.bucket) - want), mature: asOfYear - c.vintage >= 4 }))
    .filter((x) => x.c.bucket && order.includes(x.c.bucket))
    .sort((a, b) => a.dist - b.dist || (b.mature - a.mature) || ((b.c.mgmtFees.n ?? 0) - (a.c.mgmtFees.n ?? 0)));
  const best = ranked[0];
  if (!best) return null;
  return { ...best.c, age: Math.max(1, asOfYear - best.c.vintage), exactSize: best.dist === 0 };
}

/** Where a value sits against a band: "below", "within" (25th to 75th) or "above". */
export const placeIn = (v, band) => (v == null || band?.p25 == null || band?.p75 == null ? null : v < band.p25 ? "below" : v > band.p75 ? "above" : "within");

export function shareThrough(series, years, committed) {
  if (!series || !(committed > 0)) return null;
  let sum = 0;
  for (let t = 0; t < Math.min(series.length, years * 12); t++) sum += series[t] || 0; // month 12·years opens the next year
  return sum / committed;
}

/** Each fund, then all of them combined, unless they span currencies, since commitments in different currencies can't be added. */
export function lpSources(lpBase) {
  const funds = (lpBase?.funds ?? []).filter((f) => f.commitment > 0)
    .map((f) => ({ id: f.id, name: f.name, commitment: f.commitment, count: f.count, currency: f.currency ?? null }));
  const all = (lpBase?.lps ?? []).filter((l) => l.commitment > 0);
  const currencies = [...new Set(funds.map((f) => f.currency).filter(Boolean))];
  if (!all.length || currencies.length > 1) return funds;
  return [...funds, { id: null, name: "All funds combined", commitment: lpBase.totalCommitment ?? all.reduce((s, l) => s + l.commitment, 0), count: all.length, currency: currencies[0] ?? null }];
}

/** Each LP keeps its share of the source's LP commitments under its real name (the anonymize switch hides it on display); LPs past `max` pool so shares still add to 100%. */
export function lpsFromBase(lpBase, lpCommitted, { fundId = null, max = 40 } = {}) {
  const source = lpSources(lpBase).find((f) => f.id === fundId);
  if (!source || !(source.commitment > 0) || !(lpCommitted > 0)) return [];
  const amountIn = (l) => (fundId ? l.commitmentByFund?.[fundId] ?? 0 : l.commitment);
  const lps = (lpBase.lps ?? []).map((l) => ({ name: l.name, amount: amountIn(l) })).filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount);
  if (!lps.length) return [];
  const head = lps.slice(0, max);
  const rows = head.map((l, i) => ({ name: l.name?.trim() || `LP ${i + 1}`, share: l.amount / source.commitment }));
  const restCount = Math.max(source.count, lps.length) - head.length;
  const rest = 1 - rows.reduce((s, r) => s + r.share, 0);
  if (restCount > 0 && rest > 1e-9) rows.push({ name: `Other LPs (${restCount})`, share: rest, pooled: true });
  const out = rows.map((r) => ({ id: uid("lp"), name: r.name, share: r.share, commitment: Math.round(r.share * lpCommitted), ...(r.pooled ? { pooled: true } : {}) }));
  out[0].commitment += lpCommitted - out.reduce((s, l) => s + l.commitment, 0); // rounding lands on the largest LP
  return out;
}
