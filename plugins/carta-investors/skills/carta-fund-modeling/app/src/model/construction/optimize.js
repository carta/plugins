// Strategy search: screen many variants cheaply on the same simulated luck, then re-run the best at full size.
import { simulate } from "./engine.js";
import { compileFund, runMany, summarize, tooCloseToCall } from "./monteCarlo.js";
import { reserveTarget } from "./followOns.js";

export const GOALS = [
  { id: "split", label: "Best allocation split", question: "Undecided between, say, 60/40 and 70/30 across your allocations?",
    blurb: "Keeps each allocation's checks and follow-ons, and tries different shares of capital across them." },
  { id: "checks", label: "First checks vs. reserves", question: "Bigger first checks in fewer companies, or smaller checks with more held back for follow-ons?",
    blurb: "Tries bigger and smaller first checks against holding more or less for follow-ons, allocation by allocation." },
  { id: "companies", label: "Hit a number of companies", question: "Want a portfolio of about a certain size? Find the best way to build it.",
    blurb: "Finds the checks and reserves that back about the number of companies you want, and the best way to do it." },
];

export const SCREEN_RUNS = 300;
// A chance-of-target score rests on the few runs that reach it, so it screens on more runs.
export const TARGET_SCREEN_RUNS = 600;
const MAX_CANDIDATES = 300;
// When the split can change, the company-count goal tries fewer reserve levels per split.
const COMPANY_SPLIT_BUDGET = 280;
const COMPANY_SPLIT_LEVELS = [0, 0.2, 0.4, 0.6];
// Screening uses its own simulated funds, so the reported results aren't the ones picked on.
const SCREEN_SEED_OFFSET = 1000003;
const TOP = 5;
export const RESERVE_LEVELS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const CHECK_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

export function niceCheck(v) {
  const step = v < 250e3 ? 5e3 : v < 2.5e6 ? 25e3 : 100e3;
  return Math.max(5e3, Math.round(v / step) * step);
}

/** In place. A variant is { [allocId]: { share?, check?, reserve? } }; reserve is the share of each company's capital held for follow-ons. */
export function applyVariant(plan, variant) {
  const sectors = Object.fromEntries(plan.sectors.map((s) => [s.id, s]));
  for (const a of plan.allocations) {
    const v = variant?.[a.id];
    if (!v) continue;
    if (v.share != null) a.capitalPct = v.share;
    if (v.share === 0) continue; // a dropped allocation keeps its own checks and rules
    if (v.check != null) { a.checkMode = "amount"; a.initialCheck = v.check; }
    if (v.reserve != null) {
      a.followOns = reserveTarget(a, sectors[a.sectorId], v.reserve).followOns;
      a.followOnPreset = v.reserve > 0 ? "custom" : "none";
    }
  }
  return plan;
}

export const withVariant = (plan, variant) => applyVariant(structuredClone(plan), variant);

/** What a strategy looks like in the plan's terms: per allocation share, check, reserve and companies. */
export function strategyFacts(plan, res = simulate(plan)) {
  if (!res.ok) return null;
  const sectors = Object.fromEntries(plan.sectors.map((s) => [s.id, s]));
  return {
    companies: res.metrics.initialDeals,
    allocations: plan.allocations.map((a, j) => {
      const r = res.allocations[j];
      const entry = sectors[a.sectorId].stages[a.entryStage];
      // Per company, so an allocation with no capital still shows what its rules hold.
      const reserve = r.reserveRatio > 0 ? r.reserveRatio / (1 + r.reserveRatio) : 0;
      return { id: a.id, name: a.name, share: a.capitalPct, check: r.initialCheck, reserve, companies: r.initialDeals,
        roundSize: entry.roundSize, ownershipMode: a.checkMode === "ownership" };
    }),
  };
}

// Strategies within $5k of check and half a point of reserve count as the same one.
const factsKey = (f) => f.allocations.map((a) => (a.share > 0 ? `${a.share.toFixed(3)}|${Math.round(a.check / 5e3)}|${Math.round(a.reserve * 200)}` : "0")).join(";");

/** A first check can't be more than the whole round it goes into. */
export const oversizedChecks = (f) => f.allocations.filter((a) => a.share > 0 && a.check > a.roundSize + 1);
const feasible = (f) => oversizedChecks(f).length === 0;

/** Plain-language differences between a strategy and the current plan. */
export function describeChanges(facts, base) {
  const out = [];
  facts.allocations.forEach((a, i) => {
    const b = base.allocations[i];
    if (Math.abs(a.share - b.share) >= 0.005) out.push({ id: a.id, name: a.name, field: "share", from: b.share, to: a.share });
    if (!(a.share > 0)) return; // a dropped allocation has no checks or reserves to compare
    if (Math.abs(a.check - b.check) >= Math.max(1, b.check * 0.01)) out.push({ id: a.id, name: a.name, field: "check", from: b.check, to: a.check, fromOwnership: b.ownershipMode });
    if (Math.abs(a.reserve - b.reserve) >= 0.01) out.push({ id: a.id, name: a.name, field: "reserve", from: b.reserve, to: a.reserve });
  });
  return out;
}

/** Splits in `step` increments summing to 100%, with locked shares fixed and others within their bounds. */
export function shareCombos(ids, { step = 0.05, locks = {}, bounds = {} } = {}) {
  const free = ids.filter((id) => locks[id] == null);
  const rest = 1 - ids.reduce((s, id) => s + (locks[id] ?? 0), 0);
  if (rest < -1e-9) return [];
  if (!free.length) return Math.abs(rest) < 1e-9 ? [{ ...locks }] : [];
  const units = Math.round(rest / step);
  const lo = (id) => Math.max(0, Math.ceil(((bounds[id]?.min ?? 0) - 1e-9) / step));
  const hi = (id) => Math.floor(((bounds[id]?.max ?? 1) + 1e-9) / step);
  const out = [];
  const pick = (k, left, acc) => {
    const id = free[k];
    if (k === free.length - 1) {
      const share = rest - acc.used;
      const inBounds = share >= (bounds[id]?.min ?? 0) - 1e-9 && share <= (bounds[id]?.max ?? 1) + 1e-9;
      if (inBounds && share >= -1e-9) out.push({ ...locks, ...acc.shares, [id]: Math.max(0, Math.round(share * 1e6) / 1e6) });
      return;
    }
    for (let u = lo(id); u <= Math.min(hi(id), left); u++) {
      pick(k + 1, left - u, { used: acc.used + u * step, shares: { ...acc.shares, [id]: Math.round(u * step * 1e6) / 1e6 } });
    }
  };
  pick(0, units, { used: 0, shares: {} });
  return out;
}

/** The finest step from 5% up that keeps the number of splits manageable. */
export function splitCombos(ids, opts = {}, limit = MAX_CANDIDATES) {
  for (const step of [0.05, 0.1, 0.2, 0.25, 0.5]) {
    const combos = shareCombos(ids, { ...opts, step });
    if (combos.length <= limit) return { step, combos };
  }
  return { step: 1, combos: shareCombos(ids, { ...opts, step: 1 }) };
}

// A message-channel hop lets the page repaint without the timer clamping a hidden tab gets.
const yieldToBrowser = () => new Promise((resolve) => {
  if (typeof MessageChannel === "undefined") return setTimeout(resolve, 0);
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
  ch.port2.postMessage(0);
});

class Cancelled extends Error {}

/** Runs candidates with a shared budget of time slices, progress and cancel. */
function makeRunner(cfg, { onProgress, signal } = {}) {
  let done = 0, total = 1, last = Date.now();
  const tick = async () => {
    done++;
    if (Date.now() - last > 40) {
      onProgress?.(Math.min(0.99, done / total));
      await yieldToBrowser();
      last = Date.now();
    }
    if (signal?.aborted) throw new Cancelled();
  };
  const screenRuns = cfg.screenRuns ?? (cfg.objective === "target" ? TARGET_SCREEN_RUNS : SCREEN_RUNS);
  const screenSettings = { ...cfg.settings, seed: (cfg.settings.seed + SCREEN_SEED_OFFSET) >>> 0 };
  const memo = new Map();
  // `confirm` re-runs on the reported simulated funds; screening uses its own set.
  const evaluate = async (plan, variant, { runs = screenRuns, irr = false, confirm = false } = {}) => {
    const id = `${JSON.stringify(variant)}|${runs}|${irr}|${confirm}`;
    if (memo.has(id)) return memo.get(id);
    const p = withVariant(plan, variant);
    const res = simulate(p);
    const facts = strategyFacts(p, res);
    const c = facts && feasible(facts) && compileFund(p, res);
    let out = null;
    if (c) {
      const summary = summarize(runMany(c, confirm ? cfg.settings : screenSettings, runs, { irr }), { target: cfg.target, objective: cfg.objective, expected: c.expected.tvpi });
      out = { variant, facts, summary, key: factsKey(facts), expected: c.expected };
    }
    memo.set(id, out);
    await tick();
    return out;
  };
  return { evaluate, screenRuns, addWork: (n) => { total += n; }, finish: () => onProgress?.(1) };
}

const better = (a, b) => (b == null || (a.summary.score ?? -Infinity) > (b.summary.score ?? -Infinity) ? a : b);

function topUnique(results, n = TOP) {
  const seen = new Set();
  return results.filter(Boolean).sort((a, b) => (b.summary.score ?? -Infinity) - (a.summary.score ?? -Infinity))
    .filter((r) => (seen.has(r.key) ? false : seen.add(r.key))).slice(0, n);
}

function reserveLevels(plan, a) {
  const sector = plan.sectors.find((s) => s.id === a.sectorId);
  const { max } = reserveTarget(a, sector, 1);
  const levels = RESERVE_LEVELS.filter((l) => l <= max + 0.005);
  return { max, levels: levels.length ? levels : [0] };
}

async function searchSplit(plan, cfg, run) {
  const ids = plan.allocations.map((a) => a.id);
  const { combos, step } = splitCombos(ids, { locks: cfg.locks ?? {}, bounds: cfg.bounds ?? {} });
  run.addWork(combos.length);
  const results = [];
  for (const shares of combos) {
    results.push(await run.evaluate(plan, Object.fromEntries(Object.entries(shares).map(([id, share]) => [id, { share }]))));
  }
  return { results, chart: { step, combos: combos.length } };
}

const sameAs = (x, y) => Math.abs(x - y) < 1e-9;

/** The first checks the checks-vs-reserves search tries for an allocation. */
export function checkCandidates(now) {
  return [...new Set([now.check, ...CHECK_STEPS.map((m) => niceCheck(now.check * m))])]
    .filter((c) => c <= now.roundSize + 1).sort((x, y) => x - y);
}

async function searchChecks(plan, cfg, run) {
  const facts = strategyFacts(plan);
  const grids = plan.allocations.map((a, j) => {
    const now = facts.allocations[j];
    const checks = checkCandidates(now);
    const { levels } = reserveLevels(plan, a);
    const reserves = [...levels.filter((l) => Math.abs(l - now.reserve) > 0.005), now.reserve].sort((x, y) => x - y);
    return { id: a.id, name: a.name, now, checks, reserves };
  });
  // Today's check and reserve stay untouched, so that cell is exactly the current plan.
  const cellVariant = (g, check, reserve) => (sameAs(check, g.now.check) && sameAs(reserve, g.now.reserve) ? null
    : { ...(sameAs(check, g.now.check) ? {} : { check }), ...(sameAs(reserve, g.now.reserve) ? {} : { reserve }) });
  const withCell = (best, g, check, reserve) => {
    const v = { ...best };
    const cell = cellVariant(g, check, reserve);
    if (cell) v[g.id] = cell; else delete v[g.id];
    return v;
  };
  const passes = plan.allocations.length > 1 ? 2 : 1;
  run.addWork(grids.reduce((s, g) => s + g.checks.length * g.reserves.length, 0) * (passes + 1));
  const results = [];
  let best = {};
  const mapFor = async (g) => {
    const cells = [];
    let winner = null;
    for (const reserve of g.reserves) {
      const row = [];
      for (const check of g.checks) {
        const r = await run.evaluate(plan, withCell(best, g, check, reserve));
        const got = r?.facts.allocations.find((x) => x.id === g.id);
        // A reserve these rules can't reach at this check isn't a real option.
        const ok = r && Math.abs(got.reserve - reserve) <= 0.02;
        if (ok) { results.push(r); winner = better(r, winner); }
        row.push(ok ? { score: r.summary.score, companies: got.companies, check, reserve } : null);
      }
      cells.push(row);
    }
    return { cells, winner };
  };
  for (let pass = 0; pass < passes; pass++) {
    for (const g of grids) {
      const { winner } = await mapFor(g);
      if (winner) {
        best = { ...best };
        if (winner.variant[g.id]) best[g.id] = winner.variant[g.id]; else delete best[g.id];
      }
    }
  }
  // Maps drawn with every other allocation at its final best (repeat cells come from the memo).
  const heatmaps = [];
  for (const g of grids) {
    const { cells } = await mapFor(g);
    const others = { ...best };
    delete others[g.id];
    heatmaps.push({ id: g.id, name: g.name, checks: g.checks, reserves: g.reserves, cells, others, now: { check: g.now.check, reserve: g.now.reserve } });
  }
  return { results, chart: { heatmaps } };
}

/** For each reserve level (and split), first checks scale together until the expected company count is within tolerance of `target`. */
export function companyVariants(plan, target, { tolerance = 0.1, splits = [null], levels = RESERVE_LEVELS } = {}) {
  const out = [];
  const seen = new Set();
  const maxReserve = Object.fromEntries(plan.allocations.map((a) => [a.id, Math.floor(reserveLevels(plan, a).max * 100) / 100]));
  for (const shares of splits) {
    for (const level of levels) {
      const v = Object.fromEntries(plan.allocations.map((a) => (
        [a.id, { reserve: Math.min(level, maxReserve[a.id]), ...(shares ? { share: shares[a.id] } : {}) }])));
      let facts = strategyFacts(withVariant(plan, v));
      for (let k = 0; k < 3 && facts && facts.companies > 0; k++) {
        const factor = facts.companies / target;
        if (Math.abs(facts.companies - target) <= tolerance * target && k > 0) break;
        // A check stops at its round's size; the others keep growing, so the floor stays reachable.
        for (const a of facts.allocations) v[a.id] = { ...v[a.id], check: Math.min(niceCheck(a.check * factor), a.roundSize) };
        facts = strategyFacts(withVariant(plan, v));
      }
      if (!facts || !feasible(facts) || Math.abs(facts.companies - target) > tolerance * target) continue;
      const key = factsKey(facts);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ variant: v, companies: facts.companies });
    }
  }
  return out;
}

/** Whether a company-count target is within reach, given the fewest the plan can back. */
export const companiesReachable = (few, target, tolerance = 0.1) => !few || !(target > 0) || few.companies <= target * (1 + tolerance) + 1e-9;

/** Keeping the split: every first check at its round's full size and the most reserve the company-count search tries. */
export function fewestCompanies(plan) {
  const facts = strategyFacts(plan);
  if (!facts) return null;
  const v = Object.fromEntries(plan.allocations.map((a) => {
    const f = facts.allocations.find((x) => x.id === a.id);
    const { max } = reserveLevels(plan, a);
    return [a.id, { check: f.roundSize, reserve: Math.min(RESERVE_LEVELS.at(-1), Math.floor(max * 100) / 100) }];
  }));
  const min = strategyFacts(withVariant(plan, v));
  const rounds = plan.allocations.map((a) => {
    const sector = plan.sectors.find((x) => x.id === a.sectorId);
    return { allocation: a.name, round: sector.stages[a.entryStage].name, roundSize: facts.allocations.find((x) => x.id === a.id).roundSize };
  });
  return min ? { companies: min.companies, held: Math.max(...Object.values(v).map((x) => x.reserve)), rounds } : null;
}

async function searchCompanies(plan, cfg, run) {
  const N = cfg.targetCompanies;
  const tolerance = cfg.tolerance ?? 0.1;
  const ids = plan.allocations.map((a) => a.id);
  const split = cfg.allowSplit && ids.length > 1;
  const splits = split
    ? splitCombos(ids, { locks: cfg.locks ?? {}, bounds: cfg.bounds ?? {} }, Math.floor(COMPANY_SPLIT_BUDGET / COMPANY_SPLIT_LEVELS.length)).combos
    : [null];
  const variants = companyVariants(plan, N, { tolerance, splits, levels: split ? COMPANY_SPLIT_LEVELS : RESERVE_LEVELS });
  // The chart's counts all use one search, with today's split, so the points compare like for like.
  const counts = [...new Set([0.8, 0.9, 1, 1.1, 1.2].map((m) => Math.max(1, Math.round(N * m))))];
  const chartVariants = counts.map((n) => ({ n, list: companyVariants(plan, n, { tolerance }) }));
  run.addWork(variants.length + chartVariants.reduce((s, x) => s + x.list.length + 1, 0));
  const results = [];
  for (const { variant } of variants) results.push(await run.evaluate(plan, variant));
  const chartRuns = Math.max(1000, Math.round(cfg.settings.runs / 3));
  const nearby = [];
  for (const { n, list } of chartVariants) {
    let top = null;
    for (const { variant } of list) {
      const r = await run.evaluate(plan, variant);
      if (r) top = better(r, top);
    }
    const confirmed = top && await run.evaluate(plan, top.variant, { runs: chartRuns, confirm: true });
    if (confirmed) nearby.push({ target: n, companies: confirmed.facts.companies, summary: compact(confirmed.summary) });
  }
  return { results, chart: { target: N, nearby, found: variants.length, chartRuns, splitChanged: split } };
}

const SEARCH = { split: searchSplit, checks: searchChecks, companies: searchCompanies };

const stable = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

/** Outline Strategy 1's cell on each map drawn with the other allocations as Strategy 1 has them. */
function markStrategy1(heatmaps, best) {
  for (const h of heatmaps) {
    const others = { ...best.variant };
    delete others[h.id];
    h.strategy1 = null;
    if (stable(others) !== stable(h.others)) continue;
    const v = best.variant[h.id] ?? {};
    const r = h.reserves.findIndex((x) => sameAs(x, v.reserve ?? h.now.reserve));
    const c = h.checks.findIndex((x) => sameAs(x, v.check ?? h.now.check));
    if (r >= 0 && c >= 0 && h.cells[r][c]) h.strategy1 = [r, c];
  }
}

/** The summary without the per-batch scores, for saving. */
const compact = ({ batches, ...rest }) => rest;

/** Screens candidates, then re-runs the top five and the current plan at `settings.runs`; null when cancelled or the plan can't run. */
export async function optimize(plan, cfg, { onProgress, signal } = {}) {
  const run = makeRunner(cfg, { onProgress, signal });
  try {
    const baseFacts = strategyFacts(plan);
    if (!baseFacts || !feasible(baseFacts)) return null;
    const search = await SEARCH[cfg.goal](plan, cfg, run);
    const finalists = topUnique(search.results);
    run.addWork(finalists.length + 1);
    const full = { runs: cfg.settings.runs, irr: true, confirm: true };
    const base = await run.evaluate(plan, {}, full);
    if (!base) throw new Error("The current plan couldn't be simulated.");
    const confirmed = [];
    for (const f of finalists) confirmed.push(await run.evaluate(plan, f.variant, full));
    const ranked = confirmed.filter(Boolean).sort((a, b) => (b.summary.score ?? -Infinity) - (a.summary.score ?? -Infinity));
    const best = ranked[0];
    if (best && search.chart.heatmaps) markStrategy1(search.chart.heatmaps, best);
    run.finish();
    return {
      goal: cfg.goal, objective: cfg.objective, target: cfg.target, targetCompanies: cfg.targetCompanies,
      settings: cfg.settings, screened: new Set(search.results.filter(Boolean).map((r) => r.key)).size, screenRuns: run.screenRuns,
      base: { facts: baseFacts, summary: compact(base.summary), expected: base.expected },
      strategies: ranked.map((r, i) => ({
        rank: i + 1, variant: r.variant, facts: r.facts, summary: compact(r.summary),
        changes: describeChanges(r.facts, baseFacts),
        isCurrent: r.key === base.key,
        tie: i > 0 && tooCloseToCall(best.summary.batches, r.summary.batches),
      })),
      beatsCurrentClearly: best ? best.key !== base.key && !tooCloseToCall(best.summary.batches, base.summary.batches) : false,
      chart: search.chart,
    };
  } catch (e) {
    if (e instanceof Cancelled) return null;
    throw e;
  }
}
