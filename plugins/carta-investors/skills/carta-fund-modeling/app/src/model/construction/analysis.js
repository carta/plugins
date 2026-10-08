// Analysis behind the Results tabs; everything here is read-only over a plan or its result.
import { simulate, waterfallExample } from "./engine.js";
import { irrOf } from "./irr.js";
import { scaleStage } from "./market.js";

const sum = (xs) => xs.reduce((s, v) => s + v, 0);

/** Calendar years (step 12) or quarters (step 3) over the fund's months, so a July start's first year is Jul–Dec; periods are [from, to). */
export function calendarPeriods(startDate, months, step = 12) {
  const [y, m] = startDate.split("-").map(Number);
  const start = y * 12 + (m - 1);
  const out = [];
  for (let t = 0; t < months;) {
    const key = Math.floor((start + t) / step);
    const to = Math.min(months, (key + 1) * step - start);
    out.push({ from: t, to, year: Math.floor((key * step) / 12), quarter: step === 3 ? ((key * step) % 12) / 3 + 1 : null });
    t = to;
  }
  return out;
}
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** Gross MOIC down to net TVPI, in turns of paid-in capital; `other` is the residual from timing and idle cash. */
export function bridge(result) {
  const { totals: t, metrics: m, waterfall: wf } = result;
  if (!(t.called > 0) || m.grossMoic == null || m.tvpi == null) return null;
  const value = t.totalProceeds + t.navEnd;
  const onCalled = value / t.called;
  const feeDrag = m.grossMoic - onCalled;
  const costs = t.fees + t.expenses;
  const mgmtFees = costs > 0 ? feeDrag * (t.fees / costs) : feeDrag;
  const expenses = feeDrag - mgmtFees;
  const carry = wf.gp / t.called;
  const other = onCalled - carry - m.tvpi;
  return {
    gross: m.grossMoic, feeDrag, mgmtFees, expenses, carry, other, net: m.tvpi,
    steps: [
      { id: "gross", label: "Gross MOIC", value: m.grossMoic, total: true },
      { id: "fees", label: "Management fees", value: -mgmtFees },
      { id: "expenses", label: "Fund expenses", value: -expenses },
      { id: "carry", label: "Carried interest", value: -carry },
      ...(Math.abs(other) >= 0.005 ? [{ id: "other", label: "Timing and cash", value: -other }] : []),
      { id: "net", label: "Net TVPI", value: m.tvpi, total: true },
    ],
  };
}

/** J-curve milestones from the quarterly series, and calls against distributions by calendar year. */
export function liquidity(result, startDate) {
  const q = result.series.quarterly.filter((r) => r.tvpi != null);
  if (!q.length) return null;
  const troughRow = q.reduce((lo, r) => (r.tvpi < lo.tvpi ? r : lo), q[0]);
  const after = q.slice(q.indexOf(troughRow));
  const firstDate = (rows, key, at) => rows.find((r) => r[key] >= at)?.date ?? null;
  const cash = q.map((r) => ({ date: r.date, net: r.lpDist - r.called }));
  const deepest = cash.reduce((lo, r) => (r.net < lo.net ? r : lo), cash[0]);
  const calls = result.series.calls, dist = result.series.lpDist;
  const years = calendarPeriods(startDate, calls.length).map(({ from, to, year }) => (
    { year, from, called: sum(calls.slice(from, to)), distributed: sum(dist.slice(from, to)) }));
  let cum = 0;
  for (const y of years) { cum += y.distributed - y.called; y.cumulative = cum; }
  return {
    trough: { tvpi: troughRow.tvpi, date: troughRow.date },
    tvpiOne: troughRow.tvpi >= 1 ? q[0].date : firstDate(after, "tvpi", 1),
    dpiOne: firstDate(q, "dpi", 1),
    deepestCash: { amount: deepest.net, date: deepest.date },
    years,
  };
}

/** Exits and proceeds by the round they happen in, across the chosen allocations (all of them by default). */
export function concentration(result, plan, only = null) {
  const byRound = new Map();
  let deals = 0, failed = 0;
  for (const a of result.allocations) {
    if (only && !only.has(a.id)) continue;
    const planned = plan.allocations.find((x) => x.id === a.id);
    const sector = plan.sectors.find((s) => s.id === planned?.sectorId);
    if (!sector) continue;
    deals += a.initialDeals;
    for (const f of a.funnel) {
      const stage = sector.stages[f.stage];
      const row = byRound.get(f.name) ?? { round: f.name, order: f.stage, exited: 0, proceeds: 0 };
      row.exited += f.exited;
      row.proceeds += f.exited * f.ownership * (stage?.exitValuation ?? 0);
      byRound.set(f.name, row);
      failed += f.failed;
    }
  }
  const rows = [...byRound.values()].filter((r) => r.exited > 0 || r.proceeds > 0).sort((a, b) => a.order - b.order);
  const proceeds = sum(rows.map((r) => r.proceeds)), exited = sum(rows.map((r) => r.exited));
  return {
    deals, failed, exited, proceeds,
    lossRatio: deals > 0 ? failed / deals : null,
    rows: rows.map((r) => ({ ...r, share: proceeds > 0 ? r.proceeds / proceeds : 0, exitedShare: exited > 0 ? r.exited / exited : 0 })),
  };
}

// Light plans have no entry prices. Multiples aren't snapped to the table's 0.5× steps, so the copy is marked `derived` to still run.
function scaledLight(plan, { exits = 1, grad = 1, pace = 1 }) {
  const out = structuredClone(plan);
  const l = out.light, N = l.companies;
  l.derived = true;
  const live = l.outcomes.filter((o) => o.id !== "failed");
  let total = 0;
  for (const o of live) {
    o.multiple = (o.multiple || 0) * exits;
    const n = Math.round((o.share || 0) * N * grad);
    o.share = N > 0 ? n / N : 0;
    total += n;
    o.exitYears = Math.max(0.25, (o.exitYears || 1) * pace);
  }
  // Never more survivors than companies: trim the biggest groups first.
  for (const o of [...live].reverse()) while (total > N && o.share > 0) { o.share -= 1 / N; total--; }
  const failed = l.outcomes.find((o) => o.id === "failed");
  if (failed) failed.exitYears = Math.max(0.25, (failed.exitYears || 1) * pace);
  return out;
}

export function scaled(plan, { exits = 1, grad = 1, prices = 1, pace = 1 } = {}) {
  if (plan.mode === "light") return scaledLight(plan, { exits, grad, pace });
  const out = structuredClone(plan);
  for (const s of out.sectors) {
    s.stages = s.stages.map((st, i, all) => ({
      ...scaleStage(st, i === all.length - 1, { exits, grad, prices }),
      monthsToGraduate: st.monthsToGraduate ? Math.max(1, round(st.monthsToGraduate * pace)) : st.monthsToGraduate,
      monthsToExit: st.monthsToExit ? Math.max(1, round(st.monthsToExit * pace)) : st.monthsToExit,
    }));
  }
  return out;
}

export const SCENARIOS = [
  { id: "down", label: "Downside", blurb: "Exits 30% smaller, 20% fewer companies raise their next round.", lightBlurb: "Exit multiples 30% lower, 20% fewer companies survive.", factors: { exits: 0.7, grad: 0.8 } },
  { id: "base", label: "Base", blurb: "The plan as entered.", factors: {} },
  { id: "up", label: "Upside", blurb: "Exits 40% bigger, 20% more companies raise their next round.", lightBlurb: "Exit multiples 40% higher, 20% more companies survive.", factors: { exits: 1.4, grad: 1.2 } },
];

export function runScenarios(plan, base = simulate(plan)) {
  return Object.fromEntries(SCENARIOS.map((s) => [s.id, s.id === "base" ? base : simulate(scaled(plan, s.factors))]));
}

const withFees = (plan, k) => { const p = structuredClone(plan); for (const t of (p.mode === "light" ? p.light.fees.tiers : p.fees?.tiers) ?? []) t.rate = (t.rate || 0) * k; return p; };
const withReserves = (plan, d) => { const p = structuredClone(plan); p.light.reservePct = Math.min(0.9, Math.max(0, (p.light.reservePct || 0) + d)); p.light.derived = true; return p; };
const withCarry = (plan, d) => { const p = structuredClone(plan); p.waterfall.carryRate = Math.max(0, Math.min(0.9, (p.waterfall.carryRate || 0) + d)); return p; };

const DRIVERS = [
  { id: "exits", label: "Exit valuations", low: "−25%", high: "+25%", make: (p, up) => scaled(p, { exits: up ? 1.25 : 0.75 }) },
  { id: "grad", label: "Chance of raising the next round", low: "−20%", high: "+20%", make: (p, up) => scaled(p, { grad: up ? 1.2 : 0.8 }) },
  { id: "prices", label: "Entry prices", low: "−20%", high: "+20%", make: (p, up) => scaled(p, { prices: up ? 1.2 : 0.8 }) },
  { id: "pace", label: "Time to graduate and exit", low: "−20%", high: "+25%", make: (p, up) => scaled(p, { pace: up ? 1.25 : 0.8 }) },
  { id: "fees", label: "Management fee rate", low: "−25%", high: "+25%", make: (p, up) => withFees(p, up ? 1.25 : 0.75) },
  { id: "carry", label: "Carried interest", low: "−5 pts", high: "+5 pts", make: (p, up) => withCarry(p, up ? 0.05 : -0.05) },
];

const LIGHT_DRIVERS = [
  { id: "exits", label: "Exit multiples", low: "−25%", high: "+25%", make: (p, up) => scaled(p, { exits: up ? 1.25 : 0.75 }) },
  { id: "grad", label: "Companies that survive", low: "−20%", high: "+20%", make: (p, up) => scaled(p, { grad: up ? 1.2 : 0.8 }) },
  { id: "pace", label: "Years to exit", low: "−20%", high: "+25%", make: (p, up) => scaled(p, { pace: up ? 1.25 : 0.8 }) },
  { id: "reserves", label: "Reserves", low: "−10 pts", high: "+10 pts", make: (p, up) => withReserves(p, up ? 0.1 : -0.1) },
  { id: "fees", label: "Management fee rate", low: "−25%", high: "+25%", make: (p, up) => withFees(p, up ? 1.25 : 0.75) },
  { id: "carry", label: "Carried interest", low: "−5 pts", high: "+5 pts", make: (p, up) => withCarry(p, up ? 0.05 : -0.05) },
];

/** What happens to `metric` when each assumption is nudged down and up on its own, biggest swing first. */
export function tornado(plan, metric = "tvpi") {
  const DRIVERS_ = plan.mode === "light" ? LIGHT_DRIVERS : DRIVERS;
  const read = (p) => { const r = simulate(p); return r.ok ? r.metrics[metric] : null; };
  const base = read(plan);
  if (base == null) return null;
  const rows = DRIVERS_.map((d) => {
    const lo = read(d.make(plan, false)), hi = read(d.make(plan, true));
    return { id: d.id, label: d.label, lowLabel: d.low, highLabel: d.high, low: lo, high: hi, swing: Math.abs((hi ?? base) - (lo ?? base)) };
  }).filter((r) => r.low != null && r.high != null);
  return { base, rows: rows.sort((a, b) => b.swing - a.swing) };
}

/** Exit-value factor at which `metric` falls to `level`; { already } if it is there now, { factor: null } if even near-worthless exits stay above. */
export function breakevenExits(plan, { metric = "tvpi", level = 1 } = {}) {
  const read = (k) => { const r = simulate(scaled(plan, { exits: k })); return r.ok ? r.metrics[metric] : null; };
  const base = read(1);
  if (base == null) return null;
  if (base <= level) return { already: true, base, factor: 1, drop: 0 };
  const floor = 0.02;
  const atFloor = read(floor);
  if (atFloor == null || atFloor > level) return { base, factor: null, drop: null };
  let lo = floor, hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if ((read(mid) ?? 0) < level) lo = mid; else hi = mid;
  }
  return { base, factor: hi, drop: 1 - hi };
}

/** Interim net and gross IRR each quarter from year 1, counting what's still held at its value then, as funds report it. */
export function irrOverTime(result, { fromMonth = 12 } = {}) {
  if (!result?.ok) return [];
  const { invest, proceeds, calls, lpDist } = result.series;
  const irrAt = (out, back, held, t) => {
    const tt = [], vv = [];
    for (let m = 0; m <= t; m++) {
      if (out[m]) { tt.push(m); vv.push(-out[m]); }
      if (back[m]) { tt.push(m); vv.push(back[m]); }
    }
    if (held > 0) { tt.push(t); vv.push(held); }
    return vv.some((v) => v < 0) ? irrOf(tt, vv, vv.length) : null;
  };
  return result.series.quarterly.filter((q) => q.month >= fromMonth).map((q) => ({
    month: q.month, date: q.date,
    net: irrAt(calls, lpDist, q.lpNav, q.month),
    gross: irrAt(invest, proceeds, q.nav, q.month),
  }));
}

/** The fund's money end to end — committed and used, what the portfolio made of it, who was paid — each column summing to the one before. */
export function dollarFlow(result) {
  if (!result?.ok) return null;
  const t = result.totals, wf = result.waterfall;
  const value = t.totalProceeds + t.navEnd;
  const used = t.invested + t.fees + t.expenses + t.cashLeft;
  const overCalled = Math.max(0, used - t.committed - t.recycled);
  const raised = t.committed + t.recycled + overCalled;
  const sources = [
    { id: "commitments", label: "Commitments", value: t.committed },
    { id: "recycled", label: "Recycled proceeds", value: t.recycled },
    { id: "overCalled", label: "Called beyond commitments", value: overCalled },
  ];
  const uses = [
    { id: "initial", label: "First checks", value: t.initialCapital },
    { id: "followOn", label: "Follow-ons", value: t.followOnCapital },
    { id: "fees", label: "Management fees", value: t.fees },
    { id: "expenses", label: "Fund expenses", value: t.expenses },
    { id: "returned", label: "Cash left uninvested", value: t.cashLeft },
    { id: "uncalled", label: "Never called", value: raised - used },
  ];
  const outcome = [
    { id: "cost", label: "Invested capital back", value: Math.min(t.invested, value) },
    { id: "gain", label: "Gain on investments", value: Math.max(0, value - t.invested) },
    { id: "returned", label: "Cash left uninvested", value: t.cashLeft },
  ];
  const payout = [
    { id: "lp", label: "LPs", value: wf.lp },
    { id: "gp", label: "GP carry", value: wf.gp },
    { id: "recycled", label: "Reinvested", value: t.recycled },
  ];
  const keep = (rows) => rows.filter((r) => r.value > 0.5);
  return {
    sources: keep(sources), uses: keep(uses), outcome: keep(outcome), payout: keep(payout),
    raised, invested: t.invested, value, lost: Math.max(0, t.invested - value),
    multiple: t.invested > 0 ? value / t.invested : null,
  };
}

/** Per calendar year of the fund: fees, expenses and carry paid, with cumulative LP profit and carry. */
export function economicsByYear(result, startDate) {
  if (!result?.ok) return [];
  const { fees, expenses, gpCarry, lpDist, calls } = result.series;
  const years = [];
  let lpProfit = 0, carry = 0;
  for (const { from, to, year } of calendarPeriods(startDate, fees.length)) {
    const row = { year, fees: sum(fees.slice(from, to)), expenses: sum(expenses.slice(from, to)), carry: sum(gpCarry.slice(from, to)) };
    lpProfit += sum(lpDist.slice(from, to)) - sum(calls.slice(from, to));
    carry += row.carry;
    years.push({ ...row, lpProfit, cumCarry: carry });
  }
  return years;
}

/** Companies reaching each round across the allocations, and how many exit, fail or raise again there. */
export function roundOutcomes(result) {
  if (!result?.ok) return [];
  const byRound = new Map();
  for (const a of result.allocations) {
    for (const f of a.funnel ?? []) {
      const row = byRound.get(f.name) ?? { round: f.name, order: f.stage, reached: 0, exited: 0, failed: 0, graduated: 0 };
      row.order = Math.min(row.order, f.stage);
      row.reached += f.reached; row.exited += f.exited; row.failed += f.failed; row.graduated += f.graduated;
      byRound.set(f.name, row);
    }
  }
  return [...byRound.values()].filter((r) => r.reached > 1e-9).sort((x, y) => x.order - y.order);
}

/** Each allocation's ownership as it enters each round, after its follow-ons and the round's dilution. */
export function ownershipPaths(result) {
  if (!result?.ok) return [];
  return result.allocations.filter((a) => a.funnel?.length).map((a) => ({
    id: a.id, name: a.name,
    points: a.funnel.map((f) => ({ round: f.name, stage: f.stage, ownership: f.ownership, check: f.check ?? null, reached: f.reached })),
  }));
}

export const EXIT_FACTORS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Net TVPI, DPI and net IRR with every exit value scaled by each factor. */
export function exitCurve(plan, factors = EXIT_FACTORS) {
  return factors.map((k) => {
    const r = k === 1 ? simulate(plan) : simulate(scaled(plan, { exits: k }));
    return r.ok ? { factor: k, tvpi: r.metrics.tvpi, dpi: r.metrics.dpi, netIrr: r.metrics.netIrr } : null;
  }).filter(Boolean);
}

/** The cash-weighted years between money going in and coming back, from the plan's own flows. */
export function holdingYears(res) {
  const s = res.series;
  const at = (xs) => { let w = 0, n = 0; xs.forEach((v, t) => { if (v > 0) { w += v * t; n += v; } }); return n > 0 ? w / n : null; };
  const out = s.lpDist.map((v, t) => v + (s.gpCarry[t] ?? 0));
  const callAt = at(s.calls), backAt = at(out);
  if (callAt == null || backAt == null) return null;
  return Math.max(0, (backAt - callAt) / 12);
}

/** The plan's waterfall terms run at each `step`× of paid-in, returned `years` later; the plan's actual result is slotted in at its multiple. */
export function dpiSensitivity(plan, res, { step = 0.5, years = holdingYears(res) ?? 5 } = {}) {
  const wf = res.waterfall, paidIn = wf.paidIn;
  if (!(paidIn > 0)) return null;
  const row = (multiple, lp, gp, extra) => {
    const total = lp + gp, profit = total - paidIn;
    return { multiple, total, lp, gp, lpDpi: lp / paidIn, gpShareOfProfit: profit > 0 ? gp / profit : null, gpShareOfTotal: total > 0 ? gp / total : 0, ...extra };
  };
  const mine = row((wf.lp + wf.gp) / paidIn, wf.lp, wf.gp, { plan: true });
  const top = Math.min(10, Math.max(4, Math.ceil((mine.multiple + step) / step) * step));
  const rows = [];
  for (let m = step; m <= top + 1e-9; m += step) {
    const x = round(m, 2);
    if (Math.abs(x - mine.multiple) < 0.005) continue;
    const r = waterfallExample(plan.waterfall, { paidIn, years, proceeds: paidIn * x });
    rows.push(row(x, r.lp, r.gp));
  }
  rows.push(mine);
  rows.sort((a, b) => a.multiple - b.multiple);
  return { paidIn, years, planMultiple: mine.multiple, rows };
}
