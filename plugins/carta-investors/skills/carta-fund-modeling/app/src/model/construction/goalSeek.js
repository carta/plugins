// Smallest changes to unlocked assumptions that reach a return target: reserves (a decision) first, then market levers eased together until the target is met.
import { simulate } from "./engine.js";
import { applyVariant, niceCheck, RESERVE_LEVELS } from "./optimize.js";
import { reserveShare } from "./followOns.js";
import { scaleStage } from "./market.js";

export const METRICS = [{ id: "grossMoic", label: "Gross MOIC" }, { id: "tvpi", label: "Net TVPI" }];
export const metricLabel = (id) => METRICS.find((m) => m.id === id)?.label ?? id;

// How far each market lever may move at the extreme (t = 1), and where a change starts to look aggressive.
export const LEVERS = {
  exits: { label: "Exit valuations", full: 2.5, aggressive: 1.5 },
  grad: { label: "Chance of raising the next round", full: 1.3, aggressive: 1.15 },
  prices: { label: "Entry prices (pre-money and round size)", full: 0.6, aggressive: 0.75 },
};
const TOLERANCE = 0.02;
const CHECK_STEPS = [0.5, 0.67, 0.8, 1.25, 1.5, 2, 3];
const ITERATIONS = 24;

export const lockKey = (lever, id) => `${lever}:${id}`;

const factorAt = (lever, t) => 1 + t * (LEVERS[lever].full - 1);

// `t` runs from 0 (as is) to 1 (each lever's limit).
function eased(plan, t, free) {
  const out = structuredClone(plan);
  for (const s of out.sectors) {
    const f = free[s.id];
    if (!f || !(t > 0)) continue;
    const factors = { exits: f.exits ? factorAt("exits", t) : 1, grad: f.grad ? factorAt("grad", t) : 1, prices: f.prices ? factorAt("prices", t) : 1 };
    s.stages = s.stages.map((st, i, all) => scaleStage(st, i === all.length - 1, factors));
    s.customized = true;
  }
  return out;
}

/** `changes` are { lever, scope, factor | from, to, aggressive }, ready to show before anything is applied. */
export function solveTarget(plan, { metric = "grossMoic", value, locks = plan.locks ?? {} }) {
  const read = (p) => { const r = simulate(p); return r.ok ? r.metrics[metric] : null; };
  const start = read(plan);
  if (start == null || !(value > 0)) return { ok: false, reached: false, start, target: value, changes: [], limits: [], plan };
  if (start >= value - TOLERANCE) return { ok: true, reached: true, already: true, start, achieved: start, target: value, changes: [], limits: [], plan };

  const changes = [], limits = [];
  let work = structuredClone(plan);

  for (const a of plan.allocations) {
    if (locks[lockKey("reserve", a.id)]) continue;
    const sector = work.sectors.find((s) => s.id === a.sectorId);
    const before = read(work);
    let best = null;
    for (const level of RESERVE_LEVELS) {
      const cand = structuredClone(work);
      applyVariant(cand, { [a.id]: { reserve: level } });
      const m = read(cand);
      if (m != null && (best == null || m > best.m)) best = { level, m, cand };
    }
    if (best && best.m - before >= TOLERANCE) {
      changes.push({ lever: "reserve", scope: a.name, from: reserveShare(work.allocations.find((x) => x.id === a.id), sector), to: best.level, aggressive: false });
      work = best.cand;
    }
  }

  // First checks only move the multiple when follow-ons are fixed amounts; pro-rata follow-ons grow with the check, so the mix stays the same.
  for (const a of plan.allocations) {
    if (locks[lockKey("check", a.id)]) continue;
    const cur = work.allocations.find((x) => x.id === a.id);
    const sector = work.sectors.find((s) => s.id === a.sectorId);
    const key = cur.checkMode === "ownership" ? "entryOwnership" : "initialCheck";
    const from = cur[key];
    if (!(from > 0)) continue;
    const before = read(work);
    let best = null;
    for (const k of CHECK_STEPS) {
      const cand = structuredClone(work);
      const x = cand.allocations.find((y) => y.id === a.id);
      x[key] = key === "initialCheck" ? niceCheck(from * k) : Math.min(0.5, Math.round(from * k * 1e4) / 1e4);
      if (key === "initialCheck" && x[key] > (sector.stages[x.entryStage]?.roundSize ?? Infinity)) continue; // a check can't exceed the round
      const m = read(cand);
      if (m != null && (best == null || m > best.m)) best = { m, cand, to: x[key] };
    }
    if (best && best.m - before >= TOLERANCE) {
      changes.push({ lever: "check", scope: a.name, from, to: best.to, ownership: key === "entryOwnership", aggressive: false });
      work = best.cand;
    }
  }
  if ((read(work) ?? 0) >= value - TOLERANCE) {
    return { ok: true, reached: true, start, achieved: read(work), target: value, changes, limits, plan: work };
  }

  const used = new Set(plan.allocations.map((a) => a.sectorId));
  const free = {};
  for (const s of plan.sectors) {
    if (!used.has(s.id)) continue;
    const f = Object.fromEntries(Object.keys(LEVERS).map((l) => [l, !locks[lockKey(l, s.id)]]));
    if (Object.values(f).some(Boolean)) free[s.id] = f;
  }
  if (!Object.keys(free).length) {
    limits.push("Everything that could move is locked.");
    return { ok: true, reached: false, start, achieved: read(work), target: value, changes, limits, plan: work };
  }
  const at = (t) => read(eased(work, t, free));
  const top = at(1);
  let t = 1;
  if (top != null && top >= value - TOLERANCE) {
    let lo = 0, hi = 1;
    for (let i = 0; i < ITERATIONS; i++) {
      const mid = (lo + hi) / 2;
      if ((at(mid) ?? 0) < value) lo = mid; else hi = mid;
    }
    t = hi;
  }
  const solved = eased(work, t, free);
  for (const s of plan.sectors) {
    const f = free[s.id];
    if (!f) continue;
    for (const lever of Object.keys(LEVERS)) {
      if (!f[lever]) continue;
      // Graduation only matters where some round can still raise another.
      if (lever === "grad" && !s.stages.some((st, i) => i < s.stages.length - 1 && st.gradRate > 0)) continue;
      const factor = factorAt(lever, t);
      if (Math.abs(factor - 1) < 0.005) continue;
      const aggressive = lever === "prices" ? factor < LEVERS.prices.aggressive : factor > LEVERS[lever].aggressive;
      changes.push({ lever, scope: s.name || "Profile", factor, aggressive });
    }
  }
  const achieved = read(solved);
  const reached = achieved != null && achieved >= value - TOLERANCE;
  if (!reached) {
    for (const s of plan.sectors) for (const lever of Object.keys(LEVERS)) if (free[s.id]?.[lever] && (lever !== "grad" || s.stages.some((st, i) => i < s.stages.length - 1 && st.gradRate > 0))) limits.push(`${LEVERS[lever].label} for ${s.name || "the profile"} reached the limit of ×${LEVERS[lever].full}.`);
    if (!limits.length) limits.push("No further change is allowed.");
  }
  return { ok: true, reached, start, achieved, target: value, changes, limits, plan: solved };
}
