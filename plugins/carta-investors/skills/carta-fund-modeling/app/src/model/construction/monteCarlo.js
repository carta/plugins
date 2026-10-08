// Plays an Advanced plan's fund out many times; each company walks companyTemplate's ladder but draws one fate per round.
import { simulate, makeWaterfall, capitalCalls } from "./engine.js";
import { pacingWeights } from "./plan.js";
import { irrOf } from "./irr.js";

export { irrOf };

// One market for the whole fund per run, using the Market step's own dial factors one or two levels either side.
export const MARKET_SWINGS = [
  { id: "off", label: "Off", blurb: "Every simulated fund faces the market you set in the Market step." },
  { id: "normal", label: "Normal", blurb: "1 in 4 funds live through a tougher market and 1 in 4 a hotter one. Odds of raising and exit values move together for every company in that fund.", grad: [0.8, 1, 1.2], exits: [0.7, 1, 1.4] },
  { id: "big", label: "Strong", blurb: "Like Normal, with bigger gaps between tough and hot markets.", grad: [0.65, 1, 1.4], exits: [0.5, 1, 2] },
];
const MARKET_WEIGHTS = [0.25, 0.5, 0.25];
const MARKET_ODDS = [0.25, 0.75]; // cumulative: tougher below 0.25, typical below 0.75, hotter above

/** Exits within the term count at exit value; anything still held at month T at its round's post-money. */
function expectedValue(A, t0, T, gradF = 1, exitF = 1) {
  // Starts from the real entry stake, because a fixed-amount follow-on adds an absolute one.
  let reach = 1, t = t0, own = A.initial / A.entryPost, value = 0;
  for (const st of A.ladder) {
    const g = Math.min(st.g * gradF, 1 - st.x);
    const f = Math.max(0, 1 - g - st.x);
    const held = (p, when) => (when > T ? reach * p * own * st.mark : 0);
    value += t + st.tx <= T ? reach * st.x * own * st.exitValuation * exitF : held(st.x, t + st.tx);
    value += held(f, t + (g > 0 ? st.tg : st.tx));
    if (!(g > 0)) break;
    if (t + st.tg > T) { value += reach * g * own * st.mark; break; }
    const nx = st.next;
    const amt = nx.mode === "prorata" ? own * nx.roundSize : nx.mode === "amount" ? nx.amount : 0;
    own = (own * nx.ratio + (nx.mode !== "none" ? nx.p * amt / nx.post : 0)) * nx.keep;
    reach *= g;
    t += st.tg;
  }
  return value;
}

// Better odds compound round after round, so swings alone would lift the average; this scale on exits and end marks holds expected value at plan.
function swingScale(A, T, swing) {
  if (!swing.grad) return 1;
  const months = Array.from({ length: 12 }, (_, k) => entryMonth(A.cdf, (k + 0.5) / 12));
  const avg = (gradF, exitF) => months.reduce((sum, m) => sum + expectedValue(A, m, T, gradF, exitF), 0) / months.length;
  const base = avg(1, 1);
  const swung = MARKET_WEIGHTS.reduce((sum, w, l) => sum + w * avg(swing.grad[l], swing.exits[l]), 0);
  return base > 0 && swung > 0 ? base / swung : 1;
}

// A lognormal spread around the round's average exit value that keeps the average: wider means more small exits and a few much bigger ones.
export const EXIT_SPREADS = [
  { id: "off", label: "Off", sigma: 0, blurb: "Every exit is worth exactly its round's exit value." },
  { id: "narrow", label: "Narrow", sigma: 0.5, blurb: "Exits land fairly close to the round's exit value." },
  { id: "typical", label: "Typical", sigma: 1, blurb: "Most exits come in below the round's exit value and a few far above it, as in venture." },
  { id: "wide", label: "Wide", sigma: 1.5, blurb: "A stronger power law: many small exits and rare very large ones." },
];

// Selection changes only who gets follow-ons; the share of graduates backed stays at each rule's participation.
export const SELECTION = [
  { id: "none", label: "Random", skill: 0, blurb: "Follow-ons go to companies that raise a round, at random." },
  { id: "some", label: "Some", skill: 0.5, blurb: "Follow-ons lean toward the companies that go on to exit for more than the round's price." },
  { id: "strong", label: "Strong", skill: 1, blurb: "Follow-ons go to those companies first, as far as participation allows." },
];

// Backing a company moves this many points of its next-round fail chance to raising; unlike the other settings it lifts the average.
export const SURVIVAL = [
  { id: "off", label: "Off", boost: 0, blurb: "Following on doesn't change a company's odds." },
  { id: "5", label: "+5 pts", boost: 0.05, blurb: "A company you follow on into is 5 points less likely to fail at its next round." },
  { id: "10", label: "+10 pts", boost: 0.1, blurb: "A company you follow on into is 10 points less likely to fail at its next round." },
  { id: "20", label: "+20 pts", boost: 0.2, blurb: "A company you follow on into is 20 points less likely to fail at its next round." },
];

export const RUN_COUNTS = [
  { runs: 1000, label: "Quick", blurb: "1,000 simulated funds" },
  { runs: 3000, label: "Standard", blurb: "3,000 simulated funds" },
  { runs: 10000, label: "Precise", blurb: "10,000 simulated funds" },
];

/** A 32-bit hash of three integers, so each run, allocation and company gets its own stream. */
export function hash3(a, b, c) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (b >>> 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ (c >>> 0), 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Seeded generator (mulberry32): the same seed always gives the same draws. */
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.normal = () => {
    const u = next() || 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return next;
}

/** Everything a run needs from the plan, worked out once; null for a blocked or Light plan. */
export function compileFund(plan, res = plan.mode === "light" ? null : simulate(plan)) {
  if (plan.mode === "light" || !res?.ok) return null;
  // Recycling isn't simulated, so the expected figures it's compared with leave it out too.
  if (plan.recycling?.enabled) {
    plan = { ...plan, recycling: { ...plan.recycling, enabled: false } };
    res = simulate(plan);
    if (!res.ok) return null;
  }
  const T = res.months;
  const sectors = Object.fromEntries(plan.sectors.map((s) => [s.id, s]));
  const allocs = plan.allocations.map((a, j) => {
    const stages = sectors[a.sectorId].stages;
    const e = a.entryStage;
    const ladder = [];
    for (let s = e; s < stages.length; s++) {
      const st = stages[s];
      const last = s === stages.length - 1;
      const nx = last ? null : stages[s + 1];
      const fo = a.followOns?.[s + 1];
      const p = fo && fo.mode !== "none" ? fo.participation ?? 0 : 0;
      const step = {
        name: st.name,
        g: last ? 0 : st.gradRate || 0,
        x: st.exitRate || 0,
        tg: Math.max(1, Math.round(st.monthsToGraduate || 0)),
        tx: Math.max(1, Math.round(st.monthsToExit || 0)),
        mark: st.preMoney + st.roundSize,
        exitValuation: st.exitValuation || 0,
        next: nx ? {
          ratio: nx.preMoney / (nx.preMoney + nx.roundSize), post: nx.preMoney + nx.roundSize, roundSize: nx.roundSize,
          keep: 1 - (nx.dilutionPct || 0), mode: p > 0 ? fo.mode : "none", p, amount: fo?.amount || 0,
        } : null,
      };
      ladder.push(step);
      if (!(step.g > 0)) break;
    }
    const H = Math.max(1, Math.min(Math.round(a.horizonMonths), T));
    const w = pacingWeights(a, H);
    const cdf = new Float64Array(H);
    w.reduce((acc, v, m) => (cdf[m] = acc + v), 0);
    const ra = res.allocations[j];
    const entry = stages[e];
    return { id: a.id, name: a.name, n: ra.initialDeals, initial: ra.initialCheck, entryPost: entry.preMoney + entry.roundSize, ladder, cdf, H };
  });
  for (const A of allocs) A.scale = Object.fromEntries(MARKET_SWINGS.map((m) => [m.id, swingScale(A, T, m)]));
  const fixed = new Float64Array(T + 1);
  for (let t = 0; t <= T; t++) fixed[t] = (res.series.fees[t] || 0) + (res.series.expenses[t] || 0);
  return {
    T, allocs, fixed, maxLadder: Math.max(1, ...allocs.map((A) => A.ladder.length)),
    general: plan.general,
    committed: plan.general.committed,
    waterfall: plan.waterfall,
    american: plan.waterfall.type === "american",
    liquidateAtEnd: !plan.general.evergreen,
    reserve: res.totals.followOnCapital,
    expected: { grossMoic: res.metrics.grossMoic, tvpi: res.metrics.tvpi, netIrr: res.metrics.netIrr, companies: res.metrics.initialDeals },
  };
}

/** Month a share `u` of the way through an allocation's first checks lands in. */
function entryMonth(cdf, u) {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] >= u) hi = mid; else lo = mid + 1;
  }
  return lo;
}

function scratch(c) {
  const T = c.T;
  const maxCo = c.allocs.reduce((s, a) => s + Math.ceil(a.n) + 1, 0);
  const maxSteps = c.allocs.reduce((s, a) => s + (Math.ceil(a.n) + 1) * a.ladder.length, 0);
  return {
    invest: new Float64Array(T + 1), proceeds: new Float64Array(T + 1), gainPos: new Float64Array(T + 1), need: new Float64Array(T + 1),
    coAlloc: new Int32Array(maxCo), coOwn: new Float64Array(maxCo), coBasis: new Float64Array(maxCo), coStep: new Int32Array(maxCo),
    coEnd: new Int8Array(maxCo), coLast: new Int16Array(maxCo), coEndT: new Int32Array(maxCo), coMult: new Float64Array(maxCo),
    coT0: new Int32Array(maxCo), coFo: new Int16Array(maxCo), coValue: new Float64Array(maxCo), nCo: 0, nf: 0,
    evT: new Int32Array(maxSteps), evCo: new Int32Array(maxSteps), evU: new Float64Array(maxSteps), evStep: new Int16Array(maxSteps), evWon: new Uint8Array(maxSteps),
    stepCount: new Int32Array(c.allocs.length * c.maxLadder), stepWins: new Int32Array(c.allocs.length * c.maxLadder), order: new Int32Array(maxSteps),
    flowT: new Int32Array(2 * (T + 2)), flowV: new Float64Array(2 * (T + 2)),
  };
}

export const FAIL = 0, EXIT = 1, HELD = 2;

/** Run `i` with the same seed always draws the same market and per-slot fates, so two strategies are compared on the same luck. */
export function runFund(c, settings, i, buf = scratch(c), { irr = true, unlimitedReserve = false } = {}) {
  const { T } = c;
  const seed = settings.seed >>> 0;
  const swing = MARKET_SWINGS.find((m) => m.id === settings.market);
  const sigma = EXIT_SPREADS.find((s) => s.id === settings.spread)?.sigma ?? 1;
  const boost = SURVIVAL.find((x) => x.id === settings.survival)?.boost ?? 0;
  let gradF = 1, exitF = 1;
  const swingId = swing?.grad ? swing.id : "off";
  if (swing?.grad) {
    const u = makeRng(hash3(seed, i, 0x5eed))();
    const lvl = u < MARKET_ODDS[0] ? 0 : u < MARKET_ODDS[1] ? 1 : 2;
    gradF = swing.grad[lvl];
    exitF = swing.exits[lvl];
  }
  const { invest, proceeds, gainPos, need } = buf;
  invest.fill(0); proceeds.fill(0); gainPos.fill(0);

  // Whole companies for sure, plus one more with the chance of the fraction.
  let nCo = 0, nEv = 0, exits = 0, fails = 0, held = 0;
  for (let j = 0; j < c.allocs.length; j++) {
    const A = c.allocs[j];
    const whole = Math.floor(A.n + 1e-9);
    const extra = makeRng(hash3(seed, i, 0x10000 + j))() < A.n - whole ? 1 : 0;
    for (let k = 0; k < whole + extra; k++) {
      const rng = makeRng(hash3(seed, i, (j + 1) * 0x100000 + k));
      // First checks are spread evenly through the pacing, as in the plan; the extra one lands at random.
      const u = k < whole ? (k + 0.5) / whole : rng();
      const t0 = entryMonth(A.cdf, u);
      const co = nCo++;
      buf.coAlloc[co] = j; buf.coOwn[co] = A.initial / A.entryPost; buf.coBasis[co] = A.initial; buf.coMult[co] = 1;
      buf.coT0[co] = t0; buf.coFo[co] = 0;
      invest[t0] += A.initial;
      let t = t0, s = 0, end = HELD, endT = T, backed = false;
      for (; s < A.ladder.length; s++) {
        const st = A.ladder[s];
        // The boost only helps a company raise a round that exists: never past the last one.
        const g = Math.min(st.g * gradF + (backed && st.g > 0 ? boost : 0), 1 - st.x);
        const roll = rng();
        if (roll < st.x) {
          if (t + st.tx <= T) {
            end = EXIT; endT = t + st.tx;
            buf.coMult[co] = exitF * (sigma > 0 ? Math.exp(sigma * rng.normal() - (sigma * sigma) / 2) : 1);
          }
          break;
        }
        if (roll < st.x + g) {
          if (t + st.tg > T) break;
          t += st.tg;
          buf.evT[nEv] = t; buf.evCo[nEv] = co; buf.evU[nEv] = rng(); buf.evStep[nEv] = s;
          // Whether the fund means to follow on here, before reserves or picking skill have their say.
          backed = boost > 0 && st.next.mode !== "none" && buf.evU[nEv] < st.next.p;
          nEv++;
          continue;
        }
        // Fails when it would have raised or exited; written off then if still inside the term.
        if (t + (g > 0 ? st.tg : st.tx) <= T) { end = FAIL; endT = t + (g > 0 ? st.tg : st.tx); }
        break;
      }
      buf.coStep[co] = 0; buf.coEnd[co] = end; buf.coEndT[co] = endT; buf.coLast[co] = Math.min(s, A.ladder.length - 1);
      if (end === EXIT) exits++; else if (end === FAIL) fails++; else held++;
    }
  }

  // The selection tilt uses this run's own share of above-post-money exits, so the number of companies backed stays the same.
  const skill = SELECTION.find((x) => x.id === settings.selection)?.skill ?? 0;
  if (skill > 0) {
    buf.stepCount.fill(0); buf.stepWins.fill(0);
    for (let e = 0; e < nEv; e++) {
      const co = buf.evCo[e], step = buf.evStep[e];
      const A = c.allocs[buf.coAlloc[co]];
      const won = buf.coEnd[co] === EXIT && A.ladder[buf.coLast[co]].exitValuation * buf.coMult[co] >= A.ladder[step].next.post;
      buf.evWon[e] = won ? 1 : 0;
      const key = buf.coAlloc[co] * c.maxLadder + step;
      buf.stepCount[key]++;
      if (won) buf.stepWins[key]++;
    }
  }
  const backs = (e, co, p) => {
    const u = buf.evU[e];
    if (!(skill > 0) || p >= 1) return u < p;
    const key = buf.coAlloc[co] * c.maxLadder + buf.evStep[e];
    const pi = buf.stepWins[key] / buf.stepCount[key];
    if (!(pi > 0 && pi < 1)) return u < p;
    const tilt = skill * Math.min(1 - p, (p * (1 - pi)) / pi);
    return u < (buf.evWon[e] ? p + tilt : p - (tilt * pi) / (1 - pi));
  };
  const order = buf.order;
  for (let e = 0; e < nEv; e++) order[e] = e;
  const sorted = Array.prototype.slice.call(order, 0, nEv).sort((a, b) => buf.evT[a] - buf.evT[b] || a - b);
  let pool = c.reserve, short = 0, followOns = 0, missed = 0;
  for (const e of sorted) {
    const co = buf.evCo[e];
    const A = c.allocs[buf.coAlloc[co]];
    const nx = A.ladder[buf.coStep[co]].next;
    const own = buf.coOwn[co];
    let amt = 0;
    if (nx.mode !== "none" && backs(e, co, nx.p)) {
      const want = nx.mode === "prorata" ? own * nx.roundSize : nx.amount;
      amt = unlimitedReserve ? want : Math.min(want, Math.max(0, pool));
      if (amt < want - 1e-6) { short = 1; missed += want - amt; }
      if (amt > 0) { pool -= amt; invest[buf.evT[e]] += amt; buf.coBasis[co] += amt; followOns++; buf.coFo[co]++; }
    }
    buf.coOwn[co] = (own * nx.ratio + amt / nx.post) * nx.keep;
    buf.coStep[co]++;
  }

  let total = 0, nav = 0, navGain = 0, top1 = 0, top2 = 0, top3 = 0, top4 = 0, top5 = 0, returners = 0;
  for (let co = 0; co < nCo; co++) {
    const A = c.allocs[buf.coAlloc[co]];
    // After its follow-ons, coStep is the round the company ended in.
    const st = A.ladder[buf.coStep[co]];
    const end = buf.coEnd[co];
    let v = 0;
    if (end === EXIT) v = buf.coOwn[co] * st.exitValuation * buf.coMult[co];
    else if (end === HELD) v = buf.coOwn[co] * st.mark;
    v *= A.scale[swingId];
    buf.coValue[co] = v;
    if (v > 0) {
      if (end === EXIT || c.liquidateAtEnd) {
        const t = end === EXIT ? buf.coEndT[co] : T;
        proceeds[t] += v;
        gainPos[t] += Math.max(0, v - buf.coBasis[co]);
      } else { nav += v; navGain += Math.max(0, v - buf.coBasis[co]); }
    }
    total += v;
    if (v >= c.committed) returners++;
    if (v > top5) {
      if (v > top1) { top5 = top4; top4 = top3; top3 = top2; top2 = top1; top1 = v; }
      else if (v > top2) { top5 = top4; top4 = top3; top3 = top2; top2 = v; }
      else if (v > top3) { top5 = top4; top4 = top3; top3 = v; }
      else if (v > top4) { top5 = top4; top4 = v; }
      else top5 = v;
    }
  }

  // Calls and the waterfall run as the plan's Results do, on this run's cash flows.
  let investTotal = 0, needTotal = 0;
  for (let t = 0; t <= T; t++) { need[t] = invest[t] + c.fixed[t]; investTotal += invest[t]; needTotal += need[t]; }
  const calls = capitalCalls(c.general, need, T);
  let called = 0;
  for (let t = 0; t <= T; t++) called += calls[t];
  const cashLeft = Math.max(0, called - needTotal);
  const wf = makeWaterfall(c.waterfall);
  let last = -1, lpTotal = 0, nf = 0;
  for (let t = 0; t <= T; t++) {
    const d = proceeds[t] + (t === T && c.liquidateAtEnd ? cashLeft : 0);
    if (!(calls[t] || d) && t !== T) continue;
    wf.idle(wf.state, t - last - 1);
    const r = wf.step(wf.state, calls[t], d, c.american ? gainPos[t] : 0);
    last = t;
    lpTotal += r.lp;
    if (calls[t]) { buf.flowT[nf] = t; buf.flowV[nf++] = -calls[t]; }
    if (r.lp) { buf.flowT[nf] = t; buf.flowV[nf++] = r.lp; }
  }
  const terminal = wf.liquidate(wf.state, nav + (c.liquidateAtEnd ? 0 : cashLeft), c.american ? navGain : 0);
  const claw = wf.clawback(wf.state, nav);
  const lpEnd = claw + terminal.lp;
  if (lpEnd) { buf.flowT[nf] = T; buf.flowV[nf++] = lpEnd; }
  const netTvpi = called > 0 ? (lpTotal + lpEnd) / called : 0;
  buf.nCo = nCo; buf.nf = nf; buf.nEv = nEv;
  // The LPs' share of holdings an evergreen fund still has: part of its value, but not cash paid out.
  buf.unrealizedLp = c.liquidateAtEnd ? 0 : terminal.lp;
  return {
    grossMoic: investTotal > 0 ? total / investTotal : 0,
    netTvpi,
    netIrr: irr ? irrOf(buf.flowT, buf.flowV, nf) : null,
    called, invested: investTotal, value: total,
    companies: nCo, exits, fails, held, followOns, short,
    reserveUsed: c.reserve - pool,
    missed,
    top1: total > 0 ? top1 / total : 0,
    top3: total > 0 ? (top1 + top2 + top3) / total : 0,
    top5: total > 0 ? (top1 + top2 + top3 + top4 + top5) / total : 0,
    returners,
    returnsFund: total >= c.committed ? 1 : 0,
  };
}

const FIELDS = ["grossMoic", "netTvpi", "netIrr", "called", "invested", "value", "companies", "exits", "fails", "held", "followOns", "short", "missed", "reserveUsed", "top1", "top3", "top5", "returners", "returnsFund"];

/** Run the fund `n` times; each field comes back as an array with one value per run. */
export function runMany(c, settings, n, opts = {}) {
  const buf = scratch(c);
  const out = Object.fromEntries(FIELDS.map((f) => [f, new Float64Array(n)]));
  for (let i = 0; i < n; i++) {
    const r = runFund(c, settings, i, buf, opts);
    for (const f of FIELDS) out[f][i] = r[f] ?? NaN;
    opts.collect?.(buf, i);
  }
  out.n = n;
  return out;
}

export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const x = p * (sorted.length - 1);
  const lo = Math.floor(x), hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

const sortedOf = (arr) => Float64Array.from(arr).filter((v) => Number.isFinite(v)).sort();
const meanOf = (arr) => { let s = 0, k = 0; for (const v of arr) if (Number.isFinite(v)) { s += v; k++; } return k ? s / k : null; };
const shareOf = (arr, test) => { let k = 0; for (const v of arr) if (test(v)) k++; return arr.length ? k / arr.length : 0; };

function spread(arr) {
  const s = sortedOf(arr);
  return { p10: quantile(s, 0.1), p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), p90: quantile(s, 0.9), mean: meanOf(arr) };
}

/** 20 bins from P2 to P98, so a few extreme runs don't flatten the chart; the ends hold the rest. */
export function histogram(arr, bins = 20) {
  const s = sortedOf(arr);
  if (!s.length) return null;
  let lo = quantile(s, 0.02), hi = quantile(s, 0.98);
  if (!(hi > lo)) { lo = s[0]; hi = s[s.length - 1] + 1e-9; }
  const w = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of s) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / w)))]++;
  return { lo, hi, width: w, counts, total: s.length };
}

/** Ways to rank strategies: each scores one run array of net TVPI. */
export const OBJECTIVES = [
  { id: "median", label: "Typical outcome", short: "Median net TVPI",
    blurb: "The middle result: half the simulated funds do better, half do worse. Best for most decisions.",
    score: (arr) => quantile(sortedOf(arr), 0.5) },
  { id: "target", label: "Chance of hitting a target", short: "Chance of target",
    blurb: "How often the fund reaches a net TVPI you choose: your plan's target when it's set on net TVPI. Good when LPs expect a particular multiple.",
    score: (arr, target) => shareOf(arr, (v) => v >= target) },
  { id: "downside", label: "Protect the downside", short: "P10 net TVPI",
    blurb: "The result in a bad case (only 1 in 10 funds do worse). Picks the strategy that holds up best.",
    score: (arr) => quantile(sortedOf(arr), 0.1) },
  { id: "mean", label: "Highest average", short: "Average net TVPI",
    blurb: "The average of every simulated fund. Rare huge outcomes pull it up, so it can favor risky strategies.",
    score: (arr) => meanOf(arr) },
];

/** The plan's own target when it is set on net TVPI, else the simulator's; `shared` says which, so an edit can write back to the plan. */
export function simTarget(plan) {
  const t = plan.target;
  if (t?.metric === "tvpi" && t.value > 0) return { value: t.value, shared: true };
  return { value: plan.monteCarlo?.target ?? 3, shared: false };
}

export const objectiveOf = (id) => OBJECTIVES.find((o) => o.id === id) ?? OBJECTIVES[0];

export const BATCHES = 20;

/** The objective scored on each of BATCHES equal slices of the runs, for comparing strategies. */
export function batchScores(arr, objective, target) {
  const o = objectiveOf(objective);
  const size = Math.floor(arr.length / BATCHES);
  if (size < 2) return null;
  return Array.from({ length: BATCHES }, (_, b) => o.score(arr.subarray(b * size, (b + 1) * size), target));
}

/** Runs are paired by luck, so the batch-by-batch difference shows how much of the gap between two strategies is noise. */
export function tooCloseToCall(best, other) {
  if (!best || !other) return false;
  const d = best.map((v, i) => v - other[i]);
  const m = d.reduce((s, v) => s + v, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (d.length - 1));
  // 2.09 is the two-sided 95% t value for 19 degrees of freedom (BATCHES - 1).
  return Math.abs(m) <= 2.09 * (sd / Math.sqrt(d.length)) + 1e-9;
}

export function summarize(runs, { target = 3, objective = "median", expected = null } = {}) {
  const net = spread(runs.netTvpi);
  return {
    runs: runs.n,
    gross: spread(runs.grossMoic),
    net,
    netIrr: spread(runs.netIrr),
    score: objectiveOf(objective).score(runs.netTvpi, target),
    batches: batchScores(runs.netTvpi, objective, target),
    chanceAbove1: shareOf(runs.netTvpi, (v) => v >= 1),
    chanceTarget: shareOf(runs.netTvpi, (v) => v >= target),
    chanceAboveExpected: expected != null ? shareOf(runs.netTvpi, (v) => v >= expected) : null,
    chanceReturnFund: meanOf(runs.returnsFund),
    chanceShort: meanOf(runs.short),
    missedWhenShort: (() => { let s = 0, k = 0; for (let i = 0; i < runs.n; i++) if (runs.short[i]) { s += runs.missed[i]; k++; } return k ? s / k : 0; })(),
    companies: meanOf(runs.companies),
    exits: meanOf(runs.exits),
    fails: meanOf(runs.fails),
    held: meanOf(runs.held),
    followOns: meanOf(runs.followOns),
    returners: meanOf(runs.returners),
    top1: meanOf(runs.top1),
    top3: meanOf(runs.top3),
    top5: meanOf(runs.top5),
    called: meanOf(runs.called),
    hist: histogram(runs.netTvpi),
  };
}

/** A short fingerprint of everything a run depends on, so a saved run can tell it's out of date. */
export function planFingerprint(plan) {
  // Leave out only what can't move a result: a field missed here makes a run look stale, never wrongly fresh.
  const { monteCarlo, name, updatedAt, createdAt, id, suggestions, writeup, finalizedAt, confirmed,
    copiedFrom, convertedFrom, lpsAnonymized, ...rest } = plan;
  const { fundName, ...general } = rest.general ?? {};
  const s = JSON.stringify({ ...rest, general });
  let h = 5381;
  for (let k = 0; k < s.length; k++) h = (Math.imul(h, 33) ^ s.charCodeAt(k)) >>> 0;
  return h.toString(36);
}

export const DEAL_BUCKETS = [
  { id: "fail", label: "Written off", max: null },
  { id: "lt1", label: "Under 1×", max: 1 },
  { id: "1to3", label: "1–3×", max: 3 },
  { id: "3to6", label: "3–6×", max: 6 },
  { id: "6to10", label: "6–10×", max: 10 },
  { id: "10to20", label: "10–20×", max: 20 },
  { id: "20plus", label: "20× or more", max: Infinity },
];
export const TOPS = [1, 3, 5, 10, 20];
const BAND_PS = [0.1, 0.25, 0.5, 0.75, 0.9];

const bucketOf = (end, mult) => (end === FAIL ? 0 : DEAL_BUCKETS.findIndex((b, k) => k > 0 && mult < b.max));

/** Rounds across every allocation, in ladder order, and where each allocation's steps sit among them. */
function roundsOf(plan, c) {
  const at = new Map();
  plan.allocations.forEach((a, j) => c.allocs[j].ladder.forEach((st, s) => {
    const order = a.entryStage + s;
    if (!at.has(st.name) || at.get(st.name) > order) at.set(st.name, order);
  }));
  const names = [...at.keys()].sort((x, y) => at.get(x) - at.get(y));
  return { names, index: c.allocs.map((A) => A.ladder.map((st) => names.indexOf(st.name))) };
}

/** The deep dive for one strategy, from the same simulated funds as its headline numbers; `plan` already has the strategy applied. */
export function simulateDetailed(plan, { settings, target = 3, objective = "median" }) {
  const c = compileFund(plan);
  if (!c) return null;
  const n = settings.runs;
  const Q = Math.ceil(c.T / 3) + 1;
  const rounds = roundsOf(plan, c);
  const R = rounds.names.length;
  const funnel = { reached: new Float64Array(R), graduated: new Float64Array(R), exited: new Float64Array(R), failed: new Float64Array(R), held: new Float64Array(R) };
  const bucketCount = new Float64Array(DEAL_BUCKETS.length), bucketValue = new Float64Array(DEAL_BUCKETS.length);
  const topShare = new Float64Array(TOPS.length);
  const net = new Float32Array(n * Q), gross = new Float32Array(n * Q);
  let valueAll = 0;
  const values = [];
  const collect = (buf, i) => {
    values.length = 0;
    let total = 0;
    for (let co = 0; co < buf.nCo; co++) {
      const idx = rounds.index[buf.coAlloc[co]];
      const last = buf.coStep[co];
      for (let s = 0; s <= last; s++) funnel.reached[idx[s]]++;
      for (let s = 0; s < last; s++) funnel.graduated[idx[s]]++;
      const end = buf.coEnd[co];
      (end === EXIT ? funnel.exited : end === FAIL ? funnel.failed : funnel.held)[idx[last]]++;
      const v = buf.coValue[co];
      const b = bucketOf(end, buf.coBasis[co] > 0 ? v / buf.coBasis[co] : 0);
      bucketCount[b]++; bucketValue[b] += v;
      values.push(v);
      total += v;
    }
    valueAll += total;
    if (total > 0) {
      values.sort((x, y) => y - x);
      let acc = 0, k = 0;
      TOPS.forEach((top, j) => { for (; k < Math.min(top, values.length); k++) acc += values[k]; topShare[j] += acc / total; });
    }
    // Cash back over time, against all the capital the fund ends up using, so it ends at the fund's multiple.
    let called = 0, invested = 0;
    for (let f = 0; f < buf.nf; f++) if (buf.flowV[f] < 0) called -= buf.flowV[f];
    for (let t = 0; t <= c.T; t++) invested += buf.invest[t];
    let dist = 0, cash = 0, f = 0, t = 0;
    for (let q = 0; q < Q; q++) {
      const until = Math.min(c.T, q * 3);
      for (; f < buf.nf && buf.flowT[f] <= until; f++) if (buf.flowV[f] > 0) dist += buf.flowV[f];
      if (f === buf.nf && until === c.T) dist -= buf.unrealizedLp;
      for (; t <= until; t++) cash += buf.proceeds[t];
      net[i * Q + q] = called > 0 ? dist / called : 0;
      gross[i * Q + q] = invested > 0 ? cash / invested : 0;
    }
  };
  const runs = runMany(c, settings, n, { irr: true, collect });
  const bandsOf = (arr) => {
    const col = new Float64Array(n);
    return Array.from({ length: Q }, (_, q) => {
      for (let i = 0; i < n; i++) col[i] = arr[i * Q + q];
      col.sort();
      return { month: Math.min(c.T, q * 3), ...Object.fromEntries(BAND_PS.map((p) => [`p${Math.round(p * 100)}`, quantile(col, p)])) };
    });
  };
  const per = (arr) => Array.from(arr, (v) => v / n);
  return {
    summary: { ...summarize(runs, { target, objective, expected: c.expected.tvpi }), histGross: histogram(runs.grossMoic) },
    expected: c.expected,
    months: c.T,
    runs,
    funnel: rounds.names.map((name, k) => ({ name, reached: funnel.reached[k] / n, graduated: funnel.graduated[k] / n, exited: funnel.exited[k] / n, failed: funnel.failed[k] / n, held: funnel.held[k] / n })),
    deals: DEAL_BUCKETS.map((b, k) => ({ ...b, companies: bucketCount[k] / n, share: valueAll > 0 ? bucketValue[k] / valueAll : 0 })),
    concentration: TOPS.map((top, j) => ({ top, share: topShare[j] / n })),
    bands: { net: bandsOf(net), gross: bandsOf(gross) },
    liquidates: c.liquidateAtEnd,
  };
}

/** The simulated fund closest to a percentile of `field` (e.g. the median fund), by its run number. */
export function runAt(runs, field, p) {
  const order = Array.from({ length: runs.n }, (_, i) => i).sort((a, b) => runs[field][a] - runs[field][b] || a - b);
  return order[Math.round(p * (order.length - 1))];
}

const OUTCOME = { [FAIL]: "Written off", [EXIT]: "Exited", [HELD]: "Still held" };

/** One simulated fund, company by company; the same run number and settings always replay the same fund. */
export function dealsOfRun(plan, settings, run) {
  const c = compileFund(plan);
  if (!c) return null;
  const buf = scratch(c);
  const fund = runFund(c, settings, run, buf, { irr: true });
  const paths = Array.from({ length: buf.nCo }, () => []);
  for (let e = 0; e < buf.nEv; e++) paths[buf.evCo[e]].push({ month: buf.evT[e], step: buf.evStep[e] + 1 });
  const companies = Array.from({ length: buf.nCo }, (_, co) => {
    const A = c.allocs[buf.coAlloc[co]];
    const end = buf.coEnd[co];
    const steps = [{ month: buf.coT0[co], round: A.ladder[0].name }, ...paths[co].sort((a, b) => a.month - b.month).map((p) => ({ month: p.month, round: A.ladder[p.step].name }))];
    return {
      id: co, allocation: A.name, allocationIndex: buf.coAlloc[co],
      entryRound: A.ladder[0].name, entryMonth: buf.coT0[co], finalRound: A.ladder[buf.coStep[co]].name,
      outcome: OUTCOME[end], outcomeId: end === EXIT ? "exit" : end === FAIL ? "fail" : "held", endMonth: end === HELD ? null : buf.coEndT[co],
      cost: buf.coBasis[co], value: buf.coValue[co], moic: buf.coBasis[co] > 0 ? buf.coValue[co] / buf.coBasis[co] : 0,
      followOns: buf.coFo[co], steps,
    };
  });
  return { run, fund, months: c.T, companies, invest: Array.from(buf.invest), proceeds: Array.from(buf.proceeds) };
}

/** Rules of thumb on one strategy's results, worst first. Tones: bad, warn, good. */
export function healthChecks(summary, facts, target) {
  const out = [];
  const add = (id, tone, text) => out.push({ id, tone, text });
  const med = summary.net.p50, p10 = summary.net.p10;
  const x = (v) => `${v.toFixed(2)}×`;
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (med < 1) add("median", "bad", `The typical simulated fund returns ${x(med)} net: LPs lose money in most of them.`);
  else if (med < 2) add("median", "warn", `The typical simulated fund returns ${x(med)} net, below the 2–3× LPs usually look for.`);
  else add("median", "good", `The typical simulated fund returns ${x(med)} net${med >= 3 ? ", a strong result" : ""}.`);
  if (p10 < 0.5) add("downside", "warn", `In a bad case (1 fund in 10) LPs get back ${x(p10)}, less than half their money.`);
  else add("downside", "good", `Even in a bad case (1 fund in 10) LPs get back ${x(p10)}.`);
  add("above1", summary.chanceAbove1 >= 0.8 ? "good" : "warn", `${pct(summary.chanceAbove1)} of simulated funds return LPs' money or more.`);
  add("target", summary.chanceTarget >= 0.5 ? "good" : "warn", `${pct(summary.chanceTarget)} reach the ${x(target)} net target.`);
  if (facts) {
    const n = facts.companies;
    if (n < 15) add("companies", "warn", `${Math.round(n)} companies is a concentrated portfolio: one or two outcomes decide the fund.`);
    else if (n > 100) add("companies", "warn", `${Math.round(n)} companies is a very broad portfolio: winners have to be big to move the fund.`);
    else add("companies", "good", `${Math.round(n)} companies spreads the risk well.`);
    const held = facts.allocations.reduce((s, a) => s + (a.share || 0) * a.reserve, 0);
    if (held < 0.25) add("reserves", "warn", `${pct(held)} held for follow-ons is light: there's little to back the winners.`);
    else if (held > 0.6) add("reserves", "warn", `${pct(held)} held for follow-ons is heavy: more first checks could find more winners.`);
    else add("reserves", "good", `${pct(held)} held for follow-ons is in the usual range.`);
  }
  if (summary.chanceShort > 0.2) add("short", "warn", `Reserves run out in ${pct(summary.chanceShort)} of funds, so some follow-ons get cut.`);
  if (summary.top1 > 0.5) add("top1", "warn", `On average the best company is ${pct(summary.top1)} of all value: the fund hinges on one winner.`);
  const rank = { bad: 0, warn: 1, good: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
