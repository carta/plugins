// "Return the fund" backsolve — which company-valuation combinations get the FUND
// to a target GROSS MOIC (total value ÷ invested cost). Pure & gross: no LP
// waterfall, so it's plain arithmetic on each company's value and cost.
//
// The target is underdetermined (infinitely many valuation sets hit any MOIC), so
// each "solution" fixes one degree of freedom: a subset of live holdings that each
// exit at the SAME multiple `m` on invested cost. Per subset that pins a unique
// required `m`, and we rank all subsets by it (lowest = most achievable).
import { positionTotalValue } from "./reprice.js";

const RTF_STEP = 0.25, RTF_HEADROOM = 10; // target band ceiling rides this many × above its floor
const RTF_AUTO_POOL = 12; // auto mode searches this many largest-cost movers
const RTF_MAX_SET = 3; // default max companies per solution combo

/**
 * The target band a fund's Return-the-fund search runs in: a fixed band riding above
 * the fund's current gross MOIC. The floor is the nearest clean 0.25 step ABOVE
 * current (e.g. 1.75× for a 1.51× fund) and the ceiling is RTF_HEADROOM above that
 * floor. Anchoring to current means the target is always > current — so there are
 * always solutions — and it keeps working however high current is. `saved` is the
 * scenario's stored target (undefined until the slider is dragged → a seed just above
 * current); it is clamped into the band either way.
 * @returns {{ min, max, step, target }}
 */
export function rtfTargetBand(currentMoic, saved) {
  const cur = currentMoic || 1;
  const min = Math.max(1, Math.floor(cur / RTF_STEP) * RTF_STEP + RTF_STEP);
  const max = min + RTF_HEADROOM;
  const target = Math.min(max, Math.max(min, saved ?? Math.max(2, Math.ceil(cur))));
  return { min, max, step: RTF_STEP, target };
}

/**
 * Search options from a fund's saved Return-the-fund config. `eligible` is the
 * mover universe (`returnTheFundSolutions(...).eligible`). Auto mode searches the
 * RTF_AUTO_POOL largest-cost movers; custom mode searches the user's `flexIds`,
 * seeded from today's auto pool until the user prunes it.
 * @returns {{ mode, maxSet, flexIds, candidateIds }}
 */
export function rtfSearch(config, eligible) {
  const cfg = config || {};
  const mode = cfg.mode === "custom" ? "custom" : "auto";
  const autoPoolIds = [...eligible].sort((a, b) => b.cost - a.cost).slice(0, RTF_AUTO_POOL).map((e) => e.id);
  const flexIds = cfg.flexIds ?? autoPoolIds;
  return { mode, maxSet: cfg.maxSet ?? RTF_MAX_SET, flexIds, candidateIds: mode === "custom" ? flexIds : null };
}

/** All combinations of `arr` of sizes 1..maxSize (order-independent). */
function combinations(arr, maxSize) {
  const out = [];
  const rec = (start, combo) => {
    if (combo.length) out.push(combo.slice());
    if (combo.length === maxSize) return;
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      rec(i + 1, combo);
      combo.pop();
    }
  };
  rec(0, []);
  return out;
}

/**
 * @param {object} [opts]
 *   maxSet       — max companies per solution combo (default RTF_MAX_SET)
 *   poolSize     — auto mode: how many top-cost movers to search (default RTF_AUTO_POOL)
 *   topN         — cap on returned solutions (default 15)
 *   candidateIds — null → auto (top-`poolSize` movers by cost); an array of company
 *                  ids → only those may move (a user whitelist; bypasses the cost cap)
 * @returns {{
 *   investedCost, grossValue, currentMoic, target, gap, alreadyThere,
 *   eligible: [{id,name,cost,value,curMoic}],   // all movers, for the picker
 *   poolTruncated,                              // true when the candidate set was capped
 *   solutions: [{ size, m, companies: [{id,name,cost,value,curMoic,neededValue}] }]
 * }}
 * `m` is the uniform exit MOIC (on invested cost) every company in the combo must
 * reach for the FUND to hit `targetMoic`; `neededValue = m × cost`. Solutions are
 * sorted by `m` ascending. Realized / defunct / archived / written-off (0x) holdings are held flat
 * (their value still counts toward the fund total) and never appear as movers.
 * Config (`candidateIds`, `maxSet`) only steers the mover search — never the fund
 * totals or `alreadyThere`.
 */
export function returnTheFundSolutions(slice, fundId, targetMoic, opts = {}) {
  const { maxSet = RTF_MAX_SET, poolSize = RTF_AUTO_POOL, topN = 15, candidateIds = null } = opts;
  let investedCost = 0, grossValue = 0;
  const eligible = [];
  for (const c of slice.companies || []) {
    if (c.archived) continue;
    let cost = 0, value = 0;
    for (const p of c.positions || []) {
      if (p.fundId !== fundId) continue;
      cost += p.cost || 0;
      value += positionTotalValue(c, p);
    }
    if (cost <= 0) continue;
    investedCost += cost;
    grossValue += value;
    // A written-off holding (current MOIC 0x) is a dead position, not a candidate
    // to re-rate: its cost and (zero) value still count toward the fund totals.
    if (!c.realized && !c.defunct && value > 0) {
      eligible.push({ id: c.id, name: c.name, cost, value, curMoic: value / cost });
    }
  }
  const currentMoic = investedCost > 0 ? grossValue / investedCost : 0;
  const target = targetMoic * investedCost;
  const gap = target - grossValue;
  const base = { investedCost, grossValue, currentMoic, target, gap, eligible };
  if (!(investedCost > 0) || gap <= 0) {
    return { ...base, alreadyThere: gap <= 0, solutions: [], poolTruncated: false };
  }

  // Candidate movers: an explicit user whitelist (bypasses the cost cap — they've
  // already narrowed) or, by default, the largest-cost movers. Capped at MAX_POOL to
  // bound the subset count (C(14,5)=2002); the UI flags when it had to truncate.
  const MAX_POOL = 14;
  let pool = candidateIds == null
    ? [...eligible].sort((a, b) => b.cost - a.cost).slice(0, poolSize)
    : eligible.filter((e) => new Set(candidateIds).has(e.id));
  let poolTruncated = false;
  if (pool.length > MAX_POOL) {
    pool = [...pool].sort((a, b) => b.cost - a.cost).slice(0, MAX_POOL);
    poolTruncated = true;
  }
  const solutions = [];
  for (const S of combinations(pool, maxSet)) {
    const sumCost = S.reduce((s, x) => s + x.cost, 0);
    const sumValue = S.reduce((s, x) => s + x.value, 0);
    const m = (gap + sumValue) / sumCost;
    // require every member to mark UP to the same m (clean "each reaches m×"):
    // reject when m is below any member's current MOIC or below breakeven.
    const maxCurMoic = Math.max(...S.map((x) => x.curMoic));
    if (!(m >= 1) || m < maxCurMoic) continue;
    solutions.push({
      size: S.length,
      m,
      companies: S.map((x) => ({ ...x, neededValue: m * x.cost })),
    });
  }
  solutions.sort((a, b) => a.m - b.m || a.size - b.size);
  return { ...base, alreadyThere: false, solutions: solutions.slice(0, topN), poolTruncated };
}
