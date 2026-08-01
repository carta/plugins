// Scenario report model — pure summaries of a scenario's outputs, used by the
// Report view (on-screen side-by-side comparison + the printable PDF report).
//
// Every input is a self-contained slice body ({assumptions, companies}), so this
// computes ANY scenario without touching the active one — the whole doc.slices[]
// array is in memory. Reuses the same pure engines the tabs render from, so the
// report ties out to the Overview MetricBar / Reserves header for that scenario.

import { computeFundStates, firmRollup, firmBaseRollup } from "./funds.js";
import { computeReserves, newDealCount } from "./reserves.js";

/**
 * Top-line output metrics for one scenario, each with its vs-Baseline delta. The
 * `$` figures (lpNav, gpCarry, lpDistributed, dryPowder, newDealCapacity) are only
 * meaningful in a single currency — `mixedCurrency` tells the caller to blank them.
 * TVPI / DPI / newDeals are currency-neutral and always valid.
 */
export function scenarioSummary(snapshot, slice) {
  const fs = computeFundStates(snapshot, slice);
  const agg = firmRollup(fs);
  const base = firmBaseRollup(fs);
  const gpCarry = agg.accruedCarry + agg.carryBanked;
  const a = slice.assumptions || {};
  const res = computeReserves(snapshot, slice, {
    feeLoads: a.feeLoads || {},
    followOnRatios: a.followOnRatios || {},
    recyclingRatios: a.recyclingRatios || {},
  });
  const newDeals = newDealCount(res, a.avgChecks || {});
  // firm LP-NAV move vs Carta base marks (matches App.jsx firmLpDelta)
  const lpNavDelta = fs.reduce((s, f) => s + (f.lpNav - f.baseLpNav), 0);
  return {
    id: slice.id,
    name: slice.name,
    color: slice.color ?? null,
    locked: !!slice.locked,
    currency: agg.currency,
    mixedCurrency: agg.mixedCurrency,
    // currency figures (+ deltas vs Baseline)
    lpNav: agg.lpNav, lpNavDelta,
    gpCarry, gpCarryDelta: gpCarry - base.gpCarry,
    lpDistributed: agg.lpDistributed, lpDistributedDelta: agg.lpDistributed - base.lpDistributed,
    dryPowder: res.totals.reserves,
    newDealCapacity: res.totals.newDeal,
    // currency-neutral
    tvpi: agg.tvpi, tvpiDelta: agg.tvpi - base.tvpi,
    dpi: agg.dpi, dpiDelta: agg.dpi - base.dpi,
    newDeals,
    // per-fund breakdown (funds that carry capital). Carries every metric the
    // report's by-entity picker can surface — LP NAV, MOIC, TVPI, DPI, Net IRR,
    // committed, LP distributions — so the view can toggle columns with no recompute.
    perFund: fs
      .filter((f) => f.committed || f.lpNav)
      .map((f) => ({
        id: f.id, name: f.name,
        lpNav: f.lpNav, tvpi: f.tvpi, dpi: f.dpi, rvpi: f.rvpi,
        grossMoic: f.grossMoic, netLpIrr: f.netLpIrr,
        committed: f.committed, lpDistributed: f.lpDistributed,
        // per-fund GP carry mirrors the firm rollup: accrued + banked-from-exits
        gpCarry: f.accruedCarry + f.carryBanked,
      })),
  };
}

const pctLabel = (x) => `${(x * 100).toFixed(0)}%`;
const hasEntries = (m) => m && Object.keys(m).length > 0;

/**
 * A short human list of what a scenario changed vs the Baseline — for the report's
 * "what differs" section. Returns [] for the Baseline itself (or when no slice).
 * `baseSlice` is the locked Baseline; `slice` is the scenario to describe.
 */
export function scenarioDiff(baseSlice, slice) {
  if (!slice || slice.locked || (baseSlice && slice.id === baseSlice.id)) return [];
  const out = [];
  const a = slice.assumptions || {};
  const b = (baseSlice && baseSlice.assumptions) || {};
  const bc = b.carryRate ?? 0.2;
  const sc = a.carryRate ?? 0.2;
  if (Math.abs(sc - bc) > 1e-9) out.push(`Carry ${pctLabel(bc)}→${pctLabel(sc)}`);

  const comps = slice.companies || [];
  const live = comps.filter((c) => c.includeInNav && !c.archived);
  if (live.length) out.push(`${live.length} ${live.length === 1 ? "company" : "companies"} repriced`);
  const wf = comps.filter((c) => c.waterfallMode).length;
  if (wf) out.push(`${wf} via liquidation waterfall`);
  const exited = comps.filter((c) => c.exited).length;
  if (exited) out.push(`${exited} realized at mark`);
  const diluted = comps.filter((c) => (c.futureDilution ?? 0) > 0).length;
  if (diluted) out.push(`${diluted} with future dilution`);
  if (hasEntries(a.feeLoads) || hasEntries(a.followOnRatios) || hasEntries(a.recyclingRatios) || hasEntries(a.avgChecks) || hasEntries(a.carryRates))
    out.push("per-fund reserve / carry overrides");

  return out.length ? out : ["No changes vs Baseline"];
}

// Metrics that carry a vs-Baseline delta in the report's comparison table.
const REPORT_DELTA_KEYS = ["lpNav", "gpCarry", "lpDistributed", "tvpi", "dpi"];

/** Build the full report model for a set of selected scenarios (Baseline first). */
export function buildReport(snapshot, slices, baseSlice) {
  const summaries = slices.map((s) => scenarioSummary(snapshot, s));

  // Re-anchor every delta to the Baseline SCENARIO shown in the report (the locked
  // slice, else the passed baseSlice, else the first), NOT Carta's booked base marks.
  // scenarioSummary's own *Delta fields are measured vs firmBaseRollup (Carta's
  // books) — a meaningful "vs Carta" figure, but the Baseline slice usually differs
  // from Carta's books (it applies each fund's real waterfall carry rate, which
  // shifts value between LP NAV and GP carry even at 0 uplift). So a delta vs booked
  // base does NOT equal (scenario value − Baseline column value), and the firm total
  // fails to reconcile with the per-entity moves (e.g. one fund's carry drops $45.5M
  // to $0 while the firm shows only −$9.7M). Anchoring to the Baseline summary makes
  // every delta exactly value − Baseline value, matching the table's caption.
  const baseSummary =
    summaries.find((s) => s.locked) ||
    (baseSlice && summaries.find((s) => s.id === baseSlice.id)) ||
    summaries[0];
  for (const s of summaries) {
    for (const k of REPORT_DELTA_KEYS) s[`${k}Delta`] = baseSummary ? s[k] - baseSummary[k] : 0;
  }

  const diffs = Object.fromEntries(slices.map((s) => [s.id, scenarioDiff(baseSlice, s)]));
  // union of funds across the selected scenarios, in first-seen order
  const fundOrder = [];
  const seen = new Set();
  for (const sm of summaries) for (const f of sm.perFund) if (!seen.has(f.id)) { seen.add(f.id); fundOrder.push({ id: f.id, name: f.name }); }
  return { summaries, diffs, fundOrder };
}
