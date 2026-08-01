// Fund distribution waterfall — the single source of truth for splitting profit
// between LPs and the GP (carry). Works in the GROSS domain: given total profit
// above return-of-capital and the fund's waterfall config, returns the LP and GP
// (carry) shares. Pure — no UI, no time dimension.
//
// Tiers (European, simple-hurdle framing — horizon-independent to match the
// dashboard's multiple-based scenarios):
//   1. Preferred return — 100% to LP until LP profit reaches preferredReturn × paidIn
//   2. GP catch-up      — GP takes catchupRate of each dollar until GP holds
//                         catchupLimit of the profit distributed so far
//   3. Carry split      — residual splits carryRate to GP, (1 − carryRate) to LP
//
// DEGRADES EXACTLY: preferredReturn = 0 and catchupRate = 0 → gpCarry =
// carryRate × profit, identical to the pre-waterfall flat carry. A catch-up with
// no preferred return is a no-op (nothing to catch up on), which is correct.

/**
 * Split gross profit (value above LP paid-in) into LP and GP (carry) shares.
 * @param profit  total value above return-of-capital; ≤ 0 → no carry (make-whole)
 * @param paidIn  LP paid-in capital — the return-of-capital and preferred-return base
 * @param cfg     { carryRate, preferredReturn=0, catchupRate=0, catchupLimit=carryRate }
 * @returns { lpProfit, gpCarry }
 */
export function splitProfit(profit, paidIn, cfg = {}) {
  const carry = cfg.carryRate ?? 0.2;
  const pref = cfg.preferredReturn ?? 0;
  const cuRate = cfg.catchupRate ?? 0;
  const cuLimit = cfg.catchupLimit != null && cfg.catchupLimit > 0 ? cfg.catchupLimit : carry;
  if (!(profit > 0)) return { lpProfit: profit, gpCarry: 0 };

  // Tier 1 — preferred return: 100% to LP
  const lpPref = Math.min(profit, Math.max(0, pref) * Math.max(0, paidIn));
  let rem = profit - lpPref;
  let gp = 0;

  // Tier 2 — GP catch-up (only meaningful when there's a pref to catch up on)
  if (rem > 0 && cuRate > 0 && cuLimit > 0 && cuLimit < 1 && lpPref > 0) {
    // Bring GP to cuLimit of profit distributed so far: gp/(lpPref+gp) = cuLimit
    const gpTarget = (lpPref * cuLimit) / (1 - cuLimit);
    const cuDollars = gpTarget / cuRate; // gross distributions needed to reach the target
    const spent = Math.min(rem, cuDollars);
    gp += cuRate * spent;
    rem -= spent;
  }

  // Tier 3 — residual carry split
  gp += carry * rem;

  const gpCarry = Math.max(0, Math.min(gp, profit)); // never negative, never exceeds profit
  return { lpProfit: profit - gpCarry, gpCarry };
}

/**
 * Inverse of splitProfit's LP-profit curve: given a target LP net profit, find
 * the gross profit that produces it. lpProfit(G) is continuous, monotonically
 * increasing and piecewise-linear, so a bounded bisection converges cleanly.
 * Used by the Returns grid, which is parameterized by the NET LP multiple.
 * @returns grossProfit (≥ lpNetProfit); flat case returns lpNetProfit/(1−carry).
 */
export function grossProfitForLpProfit(lpNetProfit, paidIn, cfg = {}) {
  if (!(lpNetProfit > 0)) return lpNetProfit;
  const carry = cfg.carryRate ?? 0.2;
  // Upper bound: at worst the GP takes `carry` of every dollar, so gross ≤
  // lpNetProfit/(1−carry) plus the preferred-return headroom. Pad generously.
  let lo = lpNetProfit;
  let hi = lpNetProfit / Math.max(1e-6, 1 - carry) + Math.max(0, cfg.preferredReturn ?? 0) * Math.max(0, paidIn) + 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (splitProfit(mid, paidIn, cfg).lpProfit < lpNetProfit) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
