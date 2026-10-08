// Benchmarks a fund's real check history (investment-history.json) into allocation assumptions.
import { defaultFollowOns, uid } from "./plan.js";
import { monthsBetween } from "./feeTiers.js";

const PRICED = [
  [/pre[- ]?seed/i, "Pre-Seed"],
  [/seed/i, "Seed"],
  [/series\s*a/i, "Series A"],
  [/series\s*b/i, "Series B"],
  [/series\s*c/i, "Series C"],
  [/series\s*[d-z]/i, "Series D+"],
];

/** The round a check belongs to, or null for options and warrants (not an investment round). */
export function classifyCheck({ asset, cls }) {
  const c = (cls ?? "").toUpperCase();
  if (c === "OPTIONS" || c === "WARRANTS") return null;
  // SAFEs and notes come before a priced round, so they count as Pre-Seed checks.
  if (c === "SAFE" || c === "CONVERTIBLE_DEBT" || /\b(safe|kiss|convertible|note)\b/i.test(asset ?? "")) return "Pre-Seed";
  for (const [re, round] of PRICED) if (re.test(asset ?? "")) return round;
  return "Other";
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One company's first check (everything on its earliest date) and later follow-ons. */
function companyPath(checks) {
  const real = checks.filter((c) => c.cost > 0 && c.date && classifyCheck(c) !== null);
  if (!real.length) return null;
  const sorted = [...real].sort((a, b) => a.date.localeCompare(b.date));
  const d0 = sorted[0].date;
  const first = sorted.filter((c) => c.date === d0);
  const lead = first.reduce((a, b) => (b.cost > a.cost ? b : a));
  return {
    date: d0,
    round: classifyCheck(lead),
    initial: first.reduce((s, c) => s + c.cost, 0),
    followOns: sorted.filter((c) => c.date > d0).map((c) => c.cost),
  };
}

// Two companies can share a display name, so they're told apart by the build's company key.
const companyKey = (co) => co.id ?? co.name;

/** Parallel funds back the same companies: merge them into one book, company by company. */
export function combineFunds(history, fundIds) {
  const byKey = new Map();
  for (const id of fundIds) {
    for (const co of history[id] ?? []) {
      const e = byKey.get(companyKey(co)) ?? { ...co, checks: [] };
      e.checks.push(...co.checks);
      byKey.set(companyKey(co), e);
    }
  }
  return [...byKey.values()];
}

/** Other funds in `fundId`'s currency that back most of the same companies (likely parallel vehicles): their checks get added. */
export function parallelFunds(history, fundId, currencyOf, threshold = 0.8) {
  const mine = new Set((history[fundId] ?? []).map(companyKey));
  const ccy = currencyOf(fundId);
  if (!mine.size || !ccy) return [];
  return Object.keys(history).filter((id) => {
    if (id === fundId || currencyOf(id) !== ccy) return false;
    const theirs = history[id].map(companyKey);
    const shared = theirs.filter((n) => mine.has(n)).length;
    return shared / Math.max(mine.size, theirs.length) >= threshold;
  });
}

function summarize(paths) {
  const followed = paths.filter((p) => p.followOns.length);
  const initial = paths.reduce((s, p) => s + p.initial, 0);
  const followOn = paths.reduce((s, p) => s + p.followOns.reduce((a, b) => a + b, 0), 0);
  return {
    companies: paths.length,
    medianCheck: median(paths.map((p) => p.initial)),
    avgCheck: paths.length ? initial / paths.length : null,
    followOnRate: paths.length ? followed.length / paths.length : null,
    medianFollowOn: median(paths.flatMap((p) => p.followOns)),
    initialCapital: initial,
    followOnCapital: followOn,
    reserveShare: initial + followOn > 0 ? followOn / (initial + followOn) : null,
  };
}

/** What a fund actually did, overall and by entry round; `asOf` ("YYYY-MM-DD") sets the fund's age. */
export function fundBenchmark(companies, asOf) {
  const paths = (companies ?? []).map((c) => companyPath(c.checks)).filter(Boolean);
  if (!paths.length) return null;
  const dates = paths.map((p) => p.date).sort();
  const total = summarize(paths);
  const groups = new Map();
  for (const p of paths) groups.set(p.round, [...(groups.get(p.round) ?? []), p]);
  const capital = total.initialCapital + total.followOnCapital;
  const byEntry = [...groups.entries()]
    .map(([round, ps]) => {
      const s = summarize(ps);
      return { round, ...s, share: ps.length / paths.length, capitalShare: capital > 0 ? (s.initialCapital + s.followOnCapital) / capital : 0 };
    })
    .sort((a, b) => b.companies - a.companies);
  return {
    ...total,
    firstCheck: dates[0],
    lastFirstCheck: dates.at(-1),
    horizonMonths: Math.max(1, monthsBetween(dates[0], dates.at(-1))),
    ageYears: asOf ? monthsBetween(dates[0], asOf) / 12 : null,
    byEntry,
  };
}

export function stageIndex(sector, round) {
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9+]/g, "");
  return sector.stages.findIndex((st) => key(st.name) === key(round));
}

/** Entry rounds worth their own allocation: enough companies to be a pattern, and in the ladder. */
export function usableEntries(bench, sector, { minShare = 0.05, minCompanies = 3 } = {}) {
  return bench.byEntry.filter((e) => e.share >= minShare && e.companies >= minCompanies && e.round !== "Other" &&
    stageIndex(sector, e.round) >= 0);
}

/** Replaces the plan's allocations with one per entry round the fund used, sized from its history and split by each round's share of capital. */
export function applyBenchmark(plan, bench, { sectorId, source, minCompanies }) {
  const sector = plan.sectors.find((s) => s.id === sectorId) ?? plan.sectors[0];
  const entries = usableEntries(bench, sector, { minCompanies });
  if (!entries.length) return false;
  const weight = entries.reduce((s, e) => s + e.capitalShare, 0);
  plan.allocations = entries.map((e) => {
    const entryStage = stageIndex(sector, e.round);
    const followOns = defaultFollowOns(sector.stages.length, entryStage).map((f, i) => {
      if (!f) return f;
      if (i === entryStage + 1 && e.followOnRate > 0 && e.medianFollowOn > 0) {
        return { mode: "amount", amount: Math.round(e.medianFollowOn), participation: Math.round(e.followOnRate * 100) / 100 };
      }
      return { ...f, mode: "none" };
    });
    return {
      id: uid("alloc"),
      name: e.round,
      sectorId: sector.id,
      entryStage,
      capitalPct: Math.round((e.capitalShare / weight) * 1e4) / 1e4,
      checkMode: "amount",
      initialCheck: Math.round(e.medianCheck),
      entryOwnership: null,
      horizonMonths: Math.max(12, bench.horizonMonths),
      followOns,
      source: { fund: source, companies: e.companies },
    };
  });
  // Rounding can leave the split a hair off 100%; the largest allocation absorbs it.
  const drift = 1 - plan.allocations.reduce((s, a) => s + a.capitalPct, 0);
  const biggest = plan.allocations.reduce((a, b) => (b.capitalPct > a.capitalPct ? b : a));
  biggest.capitalPct = Math.round((biggest.capitalPct + drift) * 1e4) / 1e4;
  return true;
}
