// Expected-value model of a new fund, month by month; deal counts are averages, so they can be fractions.
import { irrOf } from "./irr.js";
import { addMonthsYm, deriveGeneral, effectiveGeneral, pacingWeights, waterfallTerms, validateGeneral, validateSectors, validateAllocations, validateFees, validateRecycling, validateWaterfall } from "./plan.js";
import { tierWindow, tiersOnCommitments, termMonthsOf } from "./feeTiers.js";
import { expenseSchedule } from "./feeTiers.js";
import { lightPortfolio, outcomeTemplate, lightFees, validatePortfolio, validateOutcomes, validateLightFees, topOutcome, tierName } from "./light.js";

const PERIOD_MONTHS = { quarterly: 3, semiannual: 6, annual: 12 };

/** One typical company's probability-weighted path, in months from the initial check: a 100 follow-on at 40% graduation counts as 40. */
export function companyTemplate(alloc, sector) {
  const stages = sector.stages;
  const e = alloc.entryStage;
  const entry = stages[e];
  const entryPost = entry.preMoney + entry.roundSize;
  const initial = alloc.checkMode === "ownership" ? alloc.entryOwnership * entryPost : alloc.initialCheck;
  const invest = [], proceeds = [], fmv = [], cost = [], gainPos = [];
  const add = (arr, i, v) => { arr[i] = (arr[i] ?? 0) + v; };
  add(invest, 0, initial);

  let reach = 1, t = 0, own = initial / entryPost, basis = initial;
  let check = null; // the follow-on check written into the round being entered
  let followOnCapital = 0, followOnCount = 0, totalProceeds = 0;
  const funnel = [];
  for (let s = e; s < stages.length; s++) {
    const st = stages[s];
    const last = s === stages.length - 1;
    const g = last ? 0 : st.gradRate || 0;
    const x = st.exitRate || 0;
    const f = Math.max(0, 1 - g - x);
    const tg = t + Math.max(1, Math.round(st.monthsToGraduate || 0));
    const tx = t + Math.max(1, Math.round(st.monthsToExit || 0));
    const tf = g > 0 ? tg : tx; // a company that fails is written off when it would have raised or exited
    const exitValue = own * (st.exitValuation || 0);
    if (x > 0) {
      add(proceeds, tx, reach * x * exitValue);
      add(gainPos, tx, reach * x * Math.max(0, exitValue - basis));
      totalProceeds += reach * x * exitValue;
    }
    funnel.push({ stage: s, name: st.name, reached: reach, exited: reach * x, failed: reach * f, graduated: reach * g, ownership: own, check });
    // Holdings are marked at the stage's post-money until they leave the stage.
    const mark = own * (st.preMoney + st.roundSize);
    const leave = Math.max(g > 0 ? tg : 0, x > 0 ? tx : 0, f > 0 ? tf : 0, t + 1);
    for (let m = t; m < leave; m++) {
      const left = (m >= tg ? g : 0) + (m >= tx ? x : 0) + (m >= tf ? f : 0);
      const rem = reach * Math.max(0, 1 - left);
      add(fmv, m, rem * mark);
      add(cost, m, rem * basis);
    }
    if (!(g > 0)) break;
    const nx = stages[s + 1];
    const post = nx.preMoney + nx.roundSize;
    const keep = 1 - (nx.dilutionPct || 0);
    const fo = alloc.followOns?.[s + 1];
    const p = fo && fo.mode !== "none" ? fo.participation ?? 0 : 0;
    const amt = !fo ? 0 : fo.mode === "prorata" ? own * nx.roundSize : fo.mode === "amount" ? fo.amount || 0 : 0;
    check = amt > 0 ? amt : null;
    const ownWith = ((own * nx.preMoney) / post + amt / post) * keep;
    const ownWithout = ((own * nx.preMoney) / post) * keep;
    add(invest, tg, reach * g * p * amt);
    followOnCapital += reach * g * p * amt;
    followOnCount += reach * g * p;
    reach *= g;
    own = p * ownWith + (1 - p) * ownWithout;
    basis += p * amt;
    t = tg;
  }
  const invested = initial + followOnCapital;
  const len = Math.max(invest.length, proceeds.length, fmv.length);
  const dense = (a) => Array.from({ length: len }, (_, i) => a[i] ?? 0);
  return {
    initial,
    entryOwnership: initial / entryPost,
    followOnCapital,
    followOnCount,
    invested,
    proceeds: totalProceeds,
    moic: invested > 0 ? totalProceeds / invested : null,
    funnel,
    series: { invest: dense(invest), proceeds: dense(proceeds), fmv: dense(fmv), cost: dense(cost), gainPos: dense(gainPos) },
  };
}

/** The base carry rate from 1.0×, then each tier's rate from its fund multiple (everything distributed ÷ paid-in) up. */
export function carryBands(w) {
  const tiers = (w.carryTiers ?? []).filter((t) => t.fromMultiple > 1).sort((a, b) => a.fromMultiple - b.fromMultiple);
  return [{ fromMultiple: 1, rate: w.carryRate ?? 0.2 }, ...tiers.map((t) => ({ fromMultiple: t.fromMultiple, rate: t.rate ?? 0 }))];
}

/** Carry owed on `profit` across carry bands, for `paidIn` of capital: each band's rate on the profit within it. */
export function carryOwed(bands, profit, paidIn) {
  return bands.reduce((sum, b, i) => {
    const lo = (b.fromMultiple - 1) * paidIn;
    const hi = i + 1 < bands.length ? (bands[i + 1].fromMultiple - 1) * paidIn : Infinity;
    return profit > lo ? sum + b.rate * (Math.min(profit, hi) - lo) : sum;
  }, 0);
}

/** European (whole-fund) or American (deal-by-deal) waterfall; the preferred return is a compounding yearly IRR or a multiple of paid-in. */
export function makeWaterfall(w) {
  const bands = carryBands(w);
  const { european, prefOn, catchupOn } = waterfallTerms(w);
  const byMultiple = prefOn && w.hurdleType === "multiple";
  const hurdleMultiple = byMultiple ? Math.max(1, w.hurdleMultiple ?? 1) : 1;
  const hurdle = prefOn && !byMultiple ? w.preferredReturn ?? 0 : 0;
  const hasPref = byMultiple ? hurdleMultiple > 1 : hurdle > 0;
  const cu = hasPref && catchupOn ? w.catchupRate ?? 0 : 0;
  const monthly = Math.pow(1 + hurdle, 1 / 12) - 1;
  const state = { unreturned: 0, pref: 0, prefPaid: 0, profit: 0, gp: 0, lp: 0, contrib: 0, dist: 0 };

  const bandAt = (profit, contrib) => {
    const m = contrib > 0 ? 1 + profit / contrib : 1;
    let i = 0;
    while (i + 1 < bands.length && bands[i + 1].fromMultiple <= m + 1e-12) i++;
    return i;
  };
  const owed = (profit, contrib) => carryOwed(bands, profit, contrib);

  /** `gainPos` (American only) is the month's positive deal-level gain, the base for the GP's deal-by-deal carry. */
  function step(s, contribution, d, gainPos = 0) {
    if (!byMultiple) s.pref += (s.unreturned + s.pref) * monthly;
    s.unreturned += contribution;
    s.contrib += contribution;
    if (byMultiple) s.pref = Math.max(0, (hurdleMultiple - 1) * s.contrib - s.prefPaid);
    let lp = 0, gp = 0;
    // What each tier paid, for showing how a distribution flows (it doesn't change the split).
    const parts = { roc: 0, pref: 0, catchupGp: 0, catchupLp: 0, carryGp: bands.map(() => 0), carryLp: bands.map(() => 0) };
    if (!european) {
      const i = bandAt(Math.max(0, s.dist - s.contrib), s.contrib);
      gp = Math.min(d, bands[i].rate * gainPos);
      lp = d - gp;
      parts.roc = Math.max(0, d - gainPos);
      parts.carryGp[i] = gp;
      parts.carryLp[i] = lp - parts.roc;
      s.dist += d;
    } else {
      s.dist += d;
      const roc = Math.min(d, s.unreturned);
      s.unreturned -= roc; lp += roc; d -= roc; parts.roc = roc;
      const pref = Math.min(d, s.pref);
      s.pref -= pref; s.prefPaid += pref; lp += pref; d -= pref; s.profit += pref; parts.pref = pref;
      if (d > 0) {
        const rate = bands[bandAt(s.profit, s.contrib)].rate;
        if (cu > rate) {
          const deficit = Math.max(0, owed(s.profit, s.contrib) - s.gp);
          const c = Math.min(d, deficit / (cu - rate));
          gp += cu * c; lp += (1 - cu) * c; s.profit += c; d -= c;
          parts.catchupGp = cu * c; parts.catchupLp = (1 - cu) * c;
        }
      }
      // Split the rest band by band, so each rate applies only to profit within its range.
      for (let guard = 0; d > 1e-9 && guard < bands.length + 1; guard++) {
        const i = bandAt(s.profit, s.contrib);
        const top = i + 1 < bands.length ? (bands[i + 1].fromMultiple - 1) * s.contrib : Infinity;
        const chunk = i + 1 < bands.length ? Math.min(d, Math.max(0, top - s.profit)) || d : d;
        gp += bands[i].rate * chunk; lp += (1 - bands[i].rate) * chunk; s.profit += chunk; d -= chunk;
        parts.carryGp[i] += bands[i].rate * chunk; parts.carryLp[i] += (1 - bands[i].rate) * chunk;
      }
    }
    s.gp += gp; s.lp += lp;
    return { lp, gp, parts };
  }

  /** `months` with nothing called or paid out: the preferred return keeps compounding. */
  function idle(s, months) {
    if (byMultiple || !(months > 0)) return;
    s.pref = (s.unreturned + s.pref) * Math.pow(1 + monthly, months) - s.unreturned;
  }

  /** What each side would get if `value` were distributed now, without changing state. */
  function liquidate(s, value, gainPos = 0) {
    const copy = { ...s };
    return step(copy, 0, Math.max(0, value), gainPos);
  }

  /** American clawback: at the end, the GP returns carry above what the whole fund's profit earns. */
  function clawback(s, terminalValue = 0) {
    if (european || !w.clawback) return 0;
    const allowed = owed(Math.max(0, s.dist + terminalValue - s.contrib), s.contrib);
    return Math.max(0, s.gp - allowed);
  }

  return { state, step, idle, liquidate, clawback, owed, bands };
}

/** `paidIn` called at the start and `proceeds` paid back in one go `years` later; American carry treats it as a single deal. */
export function waterfallExample(w, { paidIn, years, proceeds }) {
  const wf = makeWaterfall(w);
  const months = Math.max(0, Math.round(years * 12));
  wf.step(wf.state, paidIn, 0);
  for (let m = 1; m < months; m++) wf.step(wf.state, 0, 0);
  const r = wf.step(wf.state, 0, proceeds, Math.max(0, proceeds - paidIn));
  const claw = wf.clawback(wf.state, 0);
  const profit = proceeds - paidIn;
  const gp = r.gp - claw;
  return {
    proceeds, paidIn, profit, bands: wf.bands, parts: r.parts,
    lp: r.lp + claw, gp, clawback: claw,
    gpShareOfProfit: profit > 0 ? gp / profit : null,
    lpMultiple: paidIn > 0 ? (r.lp + claw) / paidIn : null,
  };
}

/** Capital calls by month: each period's needs are called at the start of the period. */
export function capitalCalls(g, need, T) {
  const calls = new Array(T + 1).fill(0);
  if (g.callFrequency === "upfront") {
    for (const c of g.closes) if (c.month <= T) calls[Math.max(0, Math.round(c.month))] += g.committed * (c.pct || 0);
  } else {
    const P = PERIOD_MONTHS[g.callFrequency] ?? 3;
    for (let t0 = 0; t0 <= T; t0 += P) {
      let n = 0;
      for (let t = t0; t < t0 + P && t <= T; t++) n += need[t];
      calls[t0] += Math.max(0, n);
    }
  }
  return calls;
}

function closedFraction(closes, month) {
  return (closes ?? []).reduce((s, c) => s + (c.month <= month ? c.pct || 0 : 0), 0);
}

const pctOf = (a, b) => `${((a / b) * 100).toFixed(0)}%`;

function inWindow(month, startYear, endYear) {
  return month >= Math.round(startYear * 12) && month < Math.round(endYear * 12);
}

/** Ids of the steps (see STEPS) that must be fixed before the plan can be simulated; null when ready. */
export function simulationBlocker(plan) {
  const checks = plan.mode === "light" ? [
    ["terms", { ...validateGeneral(effectiveGeneral(plan)), ...validateLightFees(plan.light.fees, plan.general), ...validateWaterfall(plan.waterfall) }],
    ["portfolio", { ...validatePortfolio(plan.light), ...validateOutcomes(plan.light) }],
  ] : [
    ["terms", { ...validateGeneral(plan.general), ...validateFees(plan.fees, plan.general), ...validateRecycling(plan.recycling), ...validateWaterfall(plan.waterfall) }],
    ["market", validateSectors(plan.sectors)],
    ["strategy", validateAllocations(plan.allocations, plan.sectors)],
  ];
  const bad = checks.filter(([, e]) => Object.keys(e).length).map(([n]) => n);
  return bad.length ? bad : null;
}

/** @returns {object} { ok, blockedBy?, totals, metrics, allocations, series, warnings } */
export function simulate(plan) {
  const blockedBy = simulationBlocker(plan);
  if (blockedBy) return { ok: false, blockedBy, partial: lightPartial(plan) };
  return project(plan);
}

// While a blocked Light plan's fees are all on commitments, its fees, expenses and investable capital don't depend on the portfolio, so they can still show.
function lightPartial(plan) {
  const ok = (e) => Object.keys(e).length === 0;
  if (plan.mode !== "light" || !ok(validateGeneral(effectiveGeneral(plan))) || !ok(validateLightFees(plan.light.fees, plan.general))) return null;
  if (!tiersOnCommitments(plan.light.fees.tiers)) return null;
  const l = plan.light;
  const t = project({ ...plan, light: { ...l, companies: 0 } }).totals;
  const portfolioOk = ok(validatePortfolio(l));
  return {
    totals: { committed: t.committed, investable: t.investable, fees: t.fees, expenses: t.expenses, feesByTier: t.feesByTier },
    companies: portfolioOk ? l.companies : null,
    held: portfolioOk ? l.reservePct : null,
  };
}

function project(plan) {

  const g = effectiveGeneral(plan);
  const { lpCommitted } = deriveGeneral(g);
  const committed = g.committed;
  const T = termMonthsOf(g);
  const light = plan.mode === "light" ? plan.light : null;
  const rec = !light && plan.recycling?.enabled ? plan.recycling : null;
  const feePlan = light ? lightFees(light, g) : { tiers: plan.fees.tiers, expenses: expenseSchedule(plan.fees, g) };
  // A fund with an end date sells what it holds at its last-round mark when the term ends; an evergreen fund's holdings stay unrealized.
  const liquidateAtEnd = !g.evergreen;
  const book = light ? lightPortfolio(light) : null;
  let allocs;
  if (light) {
    // Light: fixed company counts per outcome, first checks spread over the investment period.
    const H = Math.round((g.investmentPeriodYears || 3) * 12);
    allocs = book.groups.filter((o) => o.count > 0).map((o) => ({
      a: { id: o.id, name: o.label, count: o.count, horizonMonths: H },
      tpl: outcomeTemplate(o, light),
    }));
  } else {
    const sectorsById = Object.fromEntries(plan.sectors.map((s) => [s.id, s]));
    allocs = plan.allocations.map((a) => ({ a, tpl: companyTemplate(a, sectorsById[a.sectorId]) }));
  }
  const dealsFor = (a, tpl, investable) => a.count ?? (tpl.invested > 0 ? (investable * a.capitalPct) / tpl.invested : 0);

  // Called-capital fees charge the LPs only, like the committed basis.
  const lpShare = committed > 0 ? lpCommitted / committed : 1;

  /** `calls` are the previous pass's capital calls, which the called-capital fee bases follow. */
  function run(investable, calls = null) {
    const z = () => new Array(T + 1).fill(0);
    const invest = z(), initialInv = z(), followInv = z(), proceeds = z(), fmv = z(), cost = z(), gainPos = z();
    const fees = z(), expenses = z(), need = z(), dist = z(), recycled = z();
    const starts = allocs.map(() => z());
    const feesByTier = Object.fromEntries(feePlan.tiers.map((x) => [x.id, 0]));
    for (const [i, { a, tpl }] of allocs.entries()) {
      const n = dealsFor(a, tpl, investable);
      const H = Math.max(1, Math.min(Math.round(a.horizonMonths), T));
      const w = pacingWeights(a, H);
      for (let m = 0; m < H; m++) starts[i][m] += n * w[m];
    }
    const place = (i, t0, n) => {
      if (!(n > 0)) return;
      const s = allocs[i].tpl.series;
      for (let k = 0; k < s.invest.length && t0 + k <= T; k++) {
        const t = t0 + k;
        invest[t] += n * s.invest[k];
        (k === 0 ? initialInv : followInv)[t] += n * s.invest[k];
        proceeds[t] += n * s.proceeds[k];
        gainPos[t] += n * s.gainPos[k];
        fmv[t] += n * s.fmv[k];
        cost[t] += n * s.cost[k];
      }
    };
    let recycledTotal = 0, pool = 0, cumInvest = 0, cumNeed = 0, cumDist = 0, cumCalls = 0, liquidation = 0;
    const recCap = rec ? rec.capPct * committed : 0;
    for (let t = 0; t <= T; t++) {
      // Proceeds at t come only from earlier starts, so they are final before recycling.
      let r = 0;
      if (rec && t < rec.termYears * 12) r = Math.min(rec.pctOfProceeds * proceeds[t], recCap - recycledTotal);
      recycled[t] = r;
      recycledTotal += r;
      for (const [i, { a, tpl }] of allocs.entries()) {
        let n = starts[i][t];
        if (r > 0 && !rec.ahead && tpl.invested > 0) n += (r * a.capitalPct) / tpl.invested;
        place(i, t, n);
      }
      if (rec?.ahead) pool += r;
      cumInvest += invest[t];
      if (calls) cumCalls += calls[t];
      const called = calls ? cumCalls : cumNeed;
      const basis = {
        committed: lpCommitted * closedFraction(g.closes, t),
        called: lpShare * called,
        calledNet: lpShare * Math.max(0, called - cumDist),
        invested: cumInvest,
        costUnrealized: cost[t],
        fmv: fmv[t],
      };
      for (const tier of feePlan.tiers) {
        const [from, to] = tierWindow(tier, T);
        if (t < from || t >= to) continue;
        const fee = (tier.rate / 12) * (basis[tier.basis] ?? 0);
        fees[t] += fee;
        feesByTier[tier.id] += fee;
      }
      for (const x of feePlan.expenses) if (inWindow(t, x.startYear, x.endYear)) expenses[t] += x.annualAmount / 12;
      const fromRecycling = rec?.ahead ? Math.min(pool, invest[t]) : rec ? r : 0;
      if (rec?.ahead) pool -= fromRecycling;
      need[t] = invest[t] - fromRecycling + fees[t] + expenses[t];
      dist[t] = proceeds[t] - r;
      if (liquidateAtEnd && t === T) {
        liquidation = fmv[T];
        proceeds[T] += liquidation;
        gainPos[T] += Math.max(0, fmv[T] - cost[T]);
        dist[T] += liquidation;
        fmv[T] = 0;
        cost[T] = 0;
      }
      cumNeed += need[t];
      cumDist += dist[t];
    }
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    return { invest, initialInv, followInv, proceeds, fmv, cost, gainPos, fees, expenses, need, dist, recycled,
      feesByTier, totalFees: sum(fees), totalExpenses: sum(expenses), totalRecycled: recycledTotal, totalNeed: sum(need), recycledPool: pool, liquidation };
  }

  // Investable capital depends on fees, which depend on what's invested: iterate to a fixed point.
  let investable = committed;
  let r = run(investable);
  for (let i = 0; i < 40; i++) {
    const next = Math.max(0, committed - r.totalFees - r.totalExpenses + (rec?.ahead ? r.totalRecycled : 0));
    const done = Math.abs(next - investable) < 1;
    investable = next;
    r = run(investable, capitalCalls(g, r.need, T));
    if (done) break;
  }

  const calls = capitalCalls(g, r.need, T);
  const totalCalled = calls.reduce((s, v) => s + v, 0);
  const cashLeft = Math.max(0, totalCalled - r.totalNeed) + (r.recycledPool || 0);
  const endCash = liquidateAtEnd ? cashLeft : 0; // unspent cash is returned when the fund winds up

  const wf = makeWaterfall(plan.waterfall);
  const american = plan.waterfall.type === "american";
  // Deal-by-deal carry on what's still held comes from its gain over cost.
  const heldGain = (t) => (american ? Math.max(0, r.fmv[t] - r.cost[t]) : 0);
  const lpDist = new Array(T + 1).fill(0), gpCarry = new Array(T + 1).fill(0);
  const lpRoc = new Array(T + 1).fill(0), lpPref = new Array(T + 1).fill(0); // LP-class return of capital and preferred return
  const quarterly = [];
  let cumCalled = 0, cumLp = 0, cumGp = 0, cumCash = 0, cumPaidOut = 0;
  const tierTotals = { roc: 0, pref: 0, catchupGp: 0, catchupLp: 0, carryGp: wf.bands.map(() => 0), carryLp: wf.bands.map(() => 0) };
  for (let t = 0; t <= T; t++) {
    const { lp, gp, parts } = wf.step(wf.state, calls[t], r.dist[t] + (t === T ? endCash : 0), american ? r.gainPos[t] * (r.proceeds[t] > 0 ? r.dist[t] / r.proceeds[t] : 0) : 0);
    lpDist[t] = lp; gpCarry[t] = gp;
    lpRoc[t] = parts.roc; lpPref[t] = parts.pref;
    cumCalled += calls[t]; cumLp += lp; cumGp += gp; cumPaidOut += lp + gp;
    tierTotals.roc += parts.roc; tierTotals.pref += parts.pref;
    tierTotals.catchupGp += parts.catchupGp; tierTotals.catchupLp += parts.catchupLp;
    parts.carryGp.forEach((v, i) => { tierTotals.carryGp[i] += v; });
    parts.carryLp.forEach((v, i) => { tierTotals.carryLp[i] += v; });
    cumCash += calls[t] - r.need[t] - (t === T ? endCash : 0);
    if (t % 3 === 0 || t === T) {
      const nav = wf.liquidate(wf.state, r.fmv[t] + Math.max(0, cumCash), heldGain(t));
      quarterly.push({
        month: t, date: addMonthsYm(g.startDate, t),
        called: cumCalled, lpDist: cumLp, lpNav: nav.lp,
        dpi: cumCalled > 0 ? cumLp / cumCalled : null,
        tvpi: cumCalled > 0 ? (cumLp + nav.lp) / cumCalled : null,
        invested: r.invest.slice(0, t + 1).reduce((s, v) => s + v, 0),
        nav: r.fmv[t],
      });
    }
  }
  const navEnd = r.fmv[T];
  const terminal = wf.liquidate(wf.state, navEnd + cashLeft - endCash, heldGain(T));
  const claw = wf.clawback(wf.state, navEnd);
  const lpTotal = cumLp + claw;
  const gpRealized = cumGp - claw;
  // The GP repays the clawback when the fund winds up, so it lands in the final month.
  if (claw) {
    lpDist[T] += claw;
    gpCarry[T] -= claw;
    const last = quarterly.at(-1);
    last.lpDist = lpTotal;
    if (last.called > 0) {
      last.dpi = lpTotal / last.called;
      last.tvpi += claw / last.called;
    }
  }

  const gross = { t: [], v: [] }, net = { t: [], v: [] };
  const flow = (f, t, v) => { if (v) { f.t.push(t); f.v.push(v); } };
  for (let t = 0; t <= T; t++) {
    flow(gross, t, -r.invest[t]);
    flow(gross, t, r.proceeds[t]);
    flow(net, t, -calls[t]);
    flow(net, t, lpDist[t]);
  }
  flow(gross, T, navEnd);
  flow(net, T, terminal.lp);
  const irr = (f) => (f.v.some((v) => v < 0) ? irrOf(f.t, f.v, f.v.length) : null);

  const invested = r.invest.reduce((s, v) => s + v, 0);
  const totalProceeds = r.proceeds.reduce((s, v) => s + v, 0);
  const dpi = totalCalled > 0 ? lpTotal / totalCalled : null;
  const rvpi = totalCalled > 0 ? terminal.lp / totalCalled : null;

  // Per-allocation figures scale the typical company by the deal count.
  const allocations = allocs.map(({ a, tpl }) => {
    const base = dealsFor(a, tpl, investable);
    return {
      id: a.id, name: a.name,
      capital: a.count != null ? base * tpl.invested : investable * a.capitalPct,
      initialDeals: base,
      followOns: base * tpl.followOnCount,
      initialCapital: base * tpl.initial,
      followOnCapital: base * tpl.followOnCapital,
      reserveRatio: tpl.initial > 0 ? tpl.followOnCapital / tpl.initial : null,
      initialCheck: tpl.initial,
      entryOwnership: tpl.entryOwnership,
      moic: tpl.moic,
      funnel: tpl.funnel.map((f) => ({ ...f, reached: f.reached * base, exited: f.exited * base, failed: f.failed * base, graduated: f.graduated * base })),
    };
  });

  const warnings = [];
  if (light) {
    const gap = book.deployed - investable;
    if (gap > investable * 0.02) warnings.push(`Companies and reserves need ${pctOf(gap, investable)} more than the investable capital after fees and expenses. Back fewer companies, write smaller checks or hold less in reserve.`);
    else if (-gap > investable * 0.02) warnings.push(`Companies and reserves use ${pctOf(-gap, investable)} less than the investable capital, so some of the fund goes uninvested.`);
  } else if (r.totalNeed > committed * 1.001) {
    warnings.push(`The plan needs ${((r.totalNeed / committed - 1) * 100).toFixed(1)}% more capital than the fund's commitments. Reduce fees, expenses or follow-ons.`);
  }
  const beyond = allocs.some(({ a }) => a.horizonMonths > T);
  if (beyond) warnings.push("An initial investment horizon is longer than the fund term; checks after the term are left out.");
  if (!g.evergreen && g.investmentPeriodYears && allocs.some(({ a }) => a.horizonMonths > g.investmentPeriodYears * 12)) {
    warnings.push("An initial investment horizon runs past the investment period.");
  }

  return {
    ok: true,
    months: T,
    totals: {
      committed, lpCommitted, investable, invested, totalProceeds, navEnd, cashLeft,
      liquidation: r.liquidation, liquidatedAt: liquidateAtEnd ? addMonthsYm(g.startDate, T) : null,
      fees: r.totalFees, feesByTier: r.feesByTier, expenses: r.totalExpenses, recycled: r.totalRecycled,
      initialCapital: r.initialInv.reduce((s, v) => s + v, 0),
      followOnCapital: r.followInv.reduce((s, v) => s + v, 0),
      called: totalCalled, lpDistributed: lpTotal,
      gpCarryRealized: gpRealized, gpCarryUnrealized: terminal.gp, clawback: claw,
    },
    metrics: {
      grossMoic: invested > 0 ? (totalProceeds + navEnd) / invested : null,
      grossIrr: irr(gross),
      dpi, rvpi, tvpi: dpi != null && rvpi != null ? dpi + rvpi : null,
      netIrr: irr(net),
      initialDeals: allocations.reduce((s, a) => s + a.initialDeals, 0),
      followOns: allocations.reduce((s, a) => s + a.followOns, 0),
      reserveRatio: (() => {
        const i = allocations.reduce((s, a) => s + a.initialCapital, 0);
        return i > 0 ? allocations.reduce((s, a) => s + a.followOnCapital, 0) / i : null;
      })(),
    },
    allocations,
    waterfall: {
      paidIn: totalCalled, paidOut: cumPaidOut, bands: wf.bands, parts: tierTotals, clawback: claw,
      unrealized: { lp: terminal.lp, gp: terminal.gp },
      lp: lpTotal + terminal.lp, gp: gpRealized + terminal.gp,
    },
    light: light ? { deployed: book.deployed, investable, gap: book.deployed - investable, grossMoic: book.grossMoic } : null,
    series: { quarterly, calls, need: r.need, expenses: r.expenses, invest: r.invest, initialInv: r.initialInv, followInv: r.followInv, proceeds: r.proceeds, lpDist, gpCarry, lpRoc, lpPref, fees: r.fees },
    warnings,
  };
}

/** Split LP-side results across named LPs in proportion to commitments. */
export function perLp(result, lps, gpPct) {
  if (!result?.ok) return [];
  const lpShare = 1 - (gpPct ?? 0);
  const total = lps.reduce((s, lp) => s + (lp.commitment || 0), 0);
  if (!(total > 0)) return [];
  const t = result.totals;
  const lpNav = (result.metrics.rvpi ?? 0) * t.called;
  return lps.map((lp) => {
    const w = ((lp.commitment || 0) / total) * lpShare;
    return {
      id: lp.id, name: lp.name, commitment: lp.commitment,
      called: t.called * w, distributed: t.lpDistributed * w, nav: lpNav * w,
      dpi: result.metrics.dpi, tvpi: result.metrics.tvpi,
    };
  });
}

/** Light projection re-run over nearby unicorn counts (rows) × multiples (columns); Failed absorbs the difference, and a cell is null when the unicorns don't fit. */
export function lightSensitivity(plan) {
  if (plan.mode !== "light" || simulationBlocker(plan)) return null;
  const N = plan.light.companies;
  const uni = topOutcome(plan.light);
  if (!uni) return null;
  const count = Math.round((uni.share || 0) * N);
  const multiple = uni.multiple;
  const start = Math.max(0, count - 2);
  const counts = Array.from({ length: 5 }, (_, i) => start + i);
  const multiples = [...new Set([0.5, 0.75, 1, 1.5, 2].map((f) => (f === 1 ? multiple : Math.max(1, Math.round(multiple * f)))))].sort((a, b) => a - b);
  const rows = counts.map((c) => ({
    count: c,
    cells: multiples.map((x) => {
      const p = structuredClone(plan);
      const u = p.light.outcomes.find((o) => o.id === uni.id);
      u.share = c / N;
      u.multiple = x;
      const r = simulate(p);
      return r.ok ? { tvpi: r.metrics.tvpi, netIrr: r.metrics.netIrr, grossMoic: r.metrics.grossMoic } : null;
    }),
  }));
  return { label: tierName(uni), current: { count, multiple }, counts, multiples, rows };
}
