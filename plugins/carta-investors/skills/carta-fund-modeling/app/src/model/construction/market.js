// Market assumptions as a preset and three dials, turned into a sector's round ladder.
import { DEFAULT_STAGES } from "./plan.js";
import { findValuationBenchmark } from "./valuationBenchmarks.js";

export const MARKETS = [
  { id: "typical", label: "Typical venture market", blurb: "Middle-of-the-road odds, exit sizes and pace.", tilt: { grad: 0, exits: 0, pace: 0 } },
  { id: "tough", label: "Tougher market", blurb: "Fewer companies raise their next round, exits are smaller and everything takes longer.", tilt: { grad: -1, exits: -1, pace: -1 } },
  { id: "hot", label: "Hot market", blurb: "More companies raise their next round, exits are bigger and things move faster.", tilt: { grad: 1, exits: 1, pace: 1 } },
  { id: "history", label: "Like your past funds", blurb: "How often your own companies went on to raise a round you joined.", tilt: { grad: 0, exits: 0, pace: 0 } },
];

export const DIALS = [
  { id: "grad", label: "How often companies raise their next round", options: ["Less", "Typical", "More"] },
  { id: "exits", label: "How big exits are", options: ["Smaller", "Typical", "Bigger"] },
  { id: "pace", label: "How fast companies move", options: ["Slower", "Typical", "Faster"] },
];

// Multipliers by level: -2..2, where a preset's tilt and the user's dial add together.
const FACTORS = {
  grad: { "-2": 0.65, "-1": 0.8, 0: 1, 1: 1.2, 2: 1.4 },
  exits: { "-2": 0.5, "-1": 0.7, 0: 1, 1: 1.4, 2: 2 },
  pace: { "-2": 1.6, "-1": 1.3, 0: 1, 1: 0.75, 2: 0.6 },
};
const level = (n) => String(Math.max(-2, Math.min(2, n)));

// `prices` is "default" (the app's starting ladder) or the id of a valuation benchmark.
export const defaultMarket = () => ({ preset: "typical", grad: 0, exits: 0, pace: 0, prices: "default" });

/** Graduation rate per entry round with enough companies: the share that got a later check from the firm. */
export function historyRates(bench, { minCompanies = 3 } = {}) {
  const rates = {};
  for (const e of bench?.byEntry ?? []) {
    if (e.round === "Other" || e.companies < minCompanies || e.followOnRate == null) continue;
    rates[e.round] = Math.round(Math.min(0.9, Math.max(0.05, e.followOnRate)) * 100) / 100;
  }
  return rates;
}

/** A round's odds of raising the next round plus its odds of exiting stay under this, so some companies always fail. */
export const MAX_RAISE_OR_EXIT = 0.98;

/** The cap stops a raise but never cuts odds already above it. */
export function scaleStage(st, last, { exits = 1, grad = 1, prices = 1 } = {}) {
  const cap = Math.max(st.gradRate, MAX_RAISE_OR_EXIT - (st.exitRate || 0));
  return {
    ...st,
    exitValuation: Math.round(st.exitValuation * exits),
    gradRate: last ? st.gradRate : Math.round(Math.min(st.gradRate * grad, cap) * 1000) / 1000,
    preMoney: Math.round(st.preMoney * prices),
    roundSize: Math.round(st.roundSize * prices),
  };
}

export function marketStages(market) {
  const m = market ?? defaultMarket();
  const tilt = MARKETS.find((x) => x.id === m.preset)?.tilt ?? MARKETS[0].tilt;
  const g = FACTORS.grad[level(tilt.grad + (m.grad || 0))];
  const x = FACTORS.exits[level(tilt.exits + (m.exits || 0))];
  const t = FACTORS.pace[level(tilt.pace + (m.pace || 0))];
  const hist = m.preset === "history" ? m.historyRates ?? {} : {};
  const bench = findValuationBenchmark(m.prices)?.rounds ?? {};
  return DEFAULT_STAGES.map((base, i, all) => {
    const s = { ...base };
    // Benchmarks set sizes and valuations, not odds or timing; exit values move with the price so an exit keeps its multiple of post-money.
    if (bench[s.name]) {
      const basePost = s.preMoney + s.roundSize;
      s.roundSize = bench[s.name].roundSize;
      s.preMoney = bench[s.name].preMoney;
      s.exitValuation *= (s.preMoney + s.roundSize) / basePost;
    }
    const last = i === all.length - 1;
    const grad = last ? 0 : (hist[s.name] ?? s.gradRate) * g;
    s.gradRate = Math.round(Math.min(grad, MAX_RAISE_OR_EXIT - s.exitRate) * 1000) / 1000;
    s.exitValuation = Math.round(s.exitValuation * x);
    s.monthsToGraduate = last ? 0 : Math.max(1, Math.round(s.monthsToGraduate * t));
    s.monthsToExit = Math.max(1, Math.round(s.monthsToExit * t));
    return s;
  });
}

// Additional dilution isn't part of a market: it's the user's own and carries across a rebuild.
const NUMERIC = ["roundSize", "preMoney", "gradRate", "exitRate", "exitValuation", "monthsToGraduate", "monthsToExit"];

export const keepDilution = (stages, from) => stages.map((s) => {
  const d = from?.find((x) => x.name === s.name)?.dilutionPct;
  return d ? { ...s, dilutionPct: d } : s;
});

/** A ladder's market-driven numbers, for telling a hand edit from a dilution change. */
export const ladderKey = (stages) => JSON.stringify(stages.map(({ dilutionPct, ...s }) => s));

export const DEFAULT_PROFILE_NAME = "Venture (default)";

export function marketSummary(sector) {
  const m = sector?.market ?? defaultMarket();
  const preset = MARKETS.find((x) => x.id === m.preset) ?? MARKETS[0];
  const tuned = (m.grad || 0) !== 0 || (m.exits || 0) !== 0 || (m.pace || 0) !== 0;
  const bench = findValuationBenchmark(m.prices);
  return [
    `${preset.label}${tuned ? ", adjusted" : ""}`,
    bench ? `Carta ${bench.sector} prices` : "app default prices",
    ...(sector?.customized ? ["rounds fine-tuned"] : []),
  ].join(" · ");
}

/** The name a profile takes from its benchmark, while the user hasn't named it themselves. */
export function autoProfileName(sector, market) {
  const named = sector.name && sector.name !== DEFAULT_PROFILE_NAME && sector.name !== sector.autoName;
  if (named) return null;
  const bench = findValuationBenchmark(market.prices);
  return bench ? bench.sector : DEFAULT_PROFILE_NAME;
}

/** Whether a sector's rounds are exactly what its market produces (not fine-tuned by hand). */
export function matchesMarket(sector) {
  const want = marketStages(sector.market);
  return sector.stages.length === want.length && sector.stages.every((s, i) => s.name === want[i].name && NUMERIC.every((k) => s[k] === want[i][k]));
}

/** A sector with no market gets the default one; a ladder that doesn't match it stays customized. */
export function normalizeSectorMarket(sector) {
  // A ladder that wasn't fine-tuned is rebuilt from its market, so it follows the current assumptions.
  if (sector.market) return sector.customized ? sector : { ...sector, stages: keepDilution(marketStages(sector.market), sector.stages), customized: false };
  const withMarket = { ...sector, market: defaultMarket() };
  return { ...withMarket, customized: !matchesMarket(withMarket) };
}

/** A foreign-currency benchmark reverts to default prices so its amounts are never read in the plan's currency; a fine-tuned ladder keeps its numbers. */
export function dropForeignBenchmark(sector, currency) {
  const bench = findValuationBenchmark(sector.market?.prices);
  if (!bench || bench.currency === currency) return sector;
  const market = { ...sector.market, prices: "default" };
  const out = { ...sector, market, ...(sector.customized ? {} : { stages: marketStages(market) }) };
  const name = autoProfileName(out, market);
  return name ? { ...out, name, autoName: name } : out;
}

/** What a ladder means for 100 companies entering at `from`. */
export function marketFunnel(stages, from = Math.max(0, stages.findIndex((s) => s.name === "Seed"))) {
  let reach = 100, months = 0, exited = 0, failed = 0, exitMonths = 0;
  const rows = [];
  const values = [];
  for (let i = from; i < stages.length; i++) {
    const s = stages[i];
    const last = i === stages.length - 1;
    const grad = last ? 0 : s.gradRate;
    const ex = reach * s.exitRate;
    rows.push({ name: s.name, reach });
    exited += ex;
    failed += reach * Math.max(0, 1 - grad - s.exitRate);
    exitMonths += ex * (months + s.monthsToExit);
    if (s.exitRate > 0 && s.exitValuation > 0) values.push(s.exitValuation);
    months += s.monthsToGraduate;
    reach *= grad;
  }
  return {
    entry: stages[from]?.name, rows, exited, failed,
    exitRange: values.length ? [Math.min(...values), Math.max(...values)] : null,
    yearsToExit: exited > 0 ? exitMonths / exited / 12 : null,
  };
}

