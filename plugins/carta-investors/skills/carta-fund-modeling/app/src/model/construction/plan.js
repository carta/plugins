// All amounts are in the plan's own currency (plan.general.currency).
import { defaultMarket, normalizeSectorMarket, dropForeignBenchmark } from "./market.js";
import { feeTier, normalizeTiers, validateFeeTiers, termMonthsOf, termYearsOf, expenseError, totalOfExpenseLines, isNum } from "./feeTiers.js";
import { defaultLight, normalizeLight, validatePortfolio, validateOutcomes, validateLightFees } from "./light.js";

export const CONSTRUCTION_VERSION = 1;

export const STEPS = [
  { id: "terms", label: "Fund terms" },
  { id: "market", label: "Market" },
  { id: "strategy", label: "Strategy" },
  { id: "montecarlo", label: "Goal seek & simulate", optional: true },
  { id: "writeup", label: "Fund write-up", optional: true },
  { id: "results", label: "Summary" },
];

export const LIGHT_STEPS = [
  { id: "terms", label: "Fund terms" },
  { id: "portfolio", label: "Portfolio" },
  { id: "writeup", label: "Fund write-up", optional: true },
  { id: "results", label: "Summary" },
];

export const stepsFor = (plan) => (plan?.mode === "light" ? LIGHT_STEPS : STEPS);

export const stepLabel = (id) => [...STEPS, ...LIGHT_STEPS].find((s) => s.id === id)?.label ?? id;

/** Picked when a plan is started; only the `ready` ones can be chosen. */
export const PLAN_MODES = [
  { id: "light", label: "Light", ready: true,
    blurb: "A quick model from a handful of inputs: company count, check size, reserves and how the portfolio turns out." },
  { id: "advanced", label: "Advanced", ready: true,
    blurb: "Set every assumption step by step: sectors, check sizes, follow-ons, fees and waterfall." },
];

export const modeLabel = (id) => PLAN_MODES.find((m) => m.id === id)?.label ?? id;

export const CALL_FREQUENCIES = [
  { id: "upfront", label: "Upfront" },
  { id: "quarterly", label: "Quarterly" },
  { id: "semiannual", label: "Semi-annually" },
  { id: "annual", label: "Annually" },
];

export const FEE_BASES = [
  { id: "committed", label: "Committed capital (LPs)",
    blurb: "LP commitments, from each close. The GP's own commitment isn't charged.",
    shape: "Flat: the same fee every year, however much has been invested. The most common choice during the investment period." },
  { id: "called", label: "Capital called to date",
    blurb: "Everything called from LPs so far, including capital called to pay fees and expenses.",
    shape: "Starts small and grows as capital is called, then stays at the total called." },
  { id: "calledNet", label: "Called minus returned",
    blurb: "Capital called from LPs so far, less what the fund has paid back to them.",
    shape: "Grows as capital is called, then falls as the fund returns money." },
  { id: "invested", label: "Invested capital to date",
    blurb: "Everything put into companies so far, first checks and follow-ons, including companies that have since exited or failed.",
    shape: "Grows while the fund invests, then stays flat." },
  { id: "costUnrealized", label: "Cost of unrealized investments",
    blurb: "What the fund paid for the companies it still holds.",
    shape: "Falls as companies exit or fail. A common step-down after the investment period." },
  { id: "fmv", label: "Value of active investments",
    blurb: "The current value of the companies the fund still holds, at their latest marks.",
    shape: "Rises and falls with valuations, so fees go up when the portfolio does well." },
];

export const FOLLOW_ON_MODES = [
  { id: "none", label: "None" },
  { id: "prorata", label: "Pro-rata" },
  { id: "amount", label: "Fixed amount" },
];

// Rule-of-thumb defaults for when the firm's own funds don't supply a value; shown as "typical", never as Carta data.
export const TYPICAL = { termYears: 10, investmentPeriodYears: 5, gpCommitPct: 0.02, callFrequency: "quarterly" };

const M = 1e6;
/** The currency the starting amounts below are sized in. The app has no FX rates to convert them. */
export const DEFAULTS_CURRENCY = "USD";
/** Starting stage ladder: general assumptions, not market data. Companies only exit from Series A on. */
export const DEFAULT_STAGES = [
  { name: "Pre-Seed", roundSize: 1.5 * M, preMoney: 8 * M, dilutionPct: 0, gradRate: 0.5, exitRate: 0, exitValuation: 15 * M, monthsToGraduate: 18, monthsToExit: 30 },
  { name: "Seed", roundSize: 4 * M, preMoney: 16 * M, dilutionPct: 0, gradRate: 0.55, exitRate: 0, exitValuation: 40 * M, monthsToGraduate: 20, monthsToExit: 36 },
  { name: "Series A", roundSize: 15 * M, preMoney: 55 * M, dilutionPct: 0, gradRate: 0.5, exitRate: 0.13, exitValuation: 150 * M, monthsToGraduate: 24, monthsToExit: 42 },
  { name: "Series B", roundSize: 35 * M, preMoney: 150 * M, dilutionPct: 0, gradRate: 0.45, exitRate: 0.18, exitValuation: 400 * M, monthsToGraduate: 24, monthsToExit: 42 },
  { name: "Series C", roundSize: 70 * M, preMoney: 400 * M, dilutionPct: 0, gradRate: 0.4, exitRate: 0.28, exitValuation: 900 * M, monthsToGraduate: 24, monthsToExit: 36 },
  { name: "Series D+", roundSize: 120 * M, preMoney: 900 * M, dilutionPct: 0, gradRate: 0, exitRate: 0.53, exitValuation: 2000 * M, monthsToGraduate: 0, monthsToExit: 36 },
];

export function copyPlan(plan, names = [], now = new Date(), base = `${plan.name} (copy)`) {
  const taken = new Set(names);
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  const copy = structuredClone(plan);
  const at = now.toISOString();
  delete copy.finalizedAt;
  delete copy.convertedFrom;
  return {
    ...copy,
    id: planId(name),
    name,
    createdAt: at.slice(0, 10),
    updatedAt: at,
    general: { ...copy.general, fundName: name },
    copiedFrom: { id: plan.id, name: plan.name, at, dismissed: false },
  };
}

export function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function planId(name) {
  return (
    (name || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") +
    "-" + Math.random().toString(36).slice(2, 6)
  );
}

/** "YYYY-MM" for the first month of the quarter after `date`. */
export function nextQuarterStart(date = new Date()) {
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  const y = date.getUTCFullYear() + (q > 3 ? 1 : 0);
  const m = (q % 4) * 3 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function defaultSector(name = "Venture (default)") {
  return { id: uid("sector"), name, stages: DEFAULT_STAGES.map((s) => ({ ...s })), market: defaultMarket(), customized: false };
}

export function defaultFollowOns(stageCount, entryStage) {
  return Array.from({ length: stageCount }, (_, i) =>
    i <= entryStage ? null : { mode: i <= entryStage + 2 ? "prorata" : "none", amount: null, participation: i === entryStage + 1 ? 0.6 : 0.4 });
}

export function defaultAllocation(sector, { name = "Seed", entryStage = 1, capitalPct = 1 } = {}) {
  return {
    id: uid("alloc"),
    name,
    sectorId: sector.id,
    entryStage,
    capitalPct,
    checkMode: "amount",
    initialCheck: 1 * M,
    entryOwnership: null,
    horizonMonths: 36,
    followOns: defaultFollowOns(sector.stages.length, entryStage),
  };
}

export const horizonYears = (a) => Math.max(1, Math.ceil((a.horizonMonths || 0) / 12));

/** Even by default; paced "by year", each year's typed company count is spread evenly across its months. */
export function pacingWeights(a, H) {
  const counts = a.pacing === "byYear" ? a.yearlyCounts ?? [] : [];
  const years = Math.ceil(H / 12);
  const count = (y) => (isNum(counts[y]) && counts[y] > 0 ? counts[y] : 0);
  const total = Array.from({ length: years }, (_, y) => count(y)).reduce((s, v) => s + v, 0);
  if (!(total > 0)) return new Array(H).fill(1 / H);
  const w = new Array(H).fill(0);
  for (let y = 0; y < years; y++) {
    const from = y * 12, to = Math.min(H, from + 12);
    for (let m = from; m < to; m++) w[m] = count(y) / total / (to - from);
  }
  return w;
}

/** Split `n` companies across `years` as evenly as whole numbers allow, earlier years first. */
export function evenYearlyCounts(n, years) {
  const whole = Math.max(0, Math.round(n || 0));
  return Array.from({ length: years }, (_, y) => Math.floor(whole / years) + (y < whole % years ? 1 : 0));
}

export function defaultFees() {
  return {
    tiers: [feeTier({ rate: 0.02, basis: "committed", startMonth: 1, endMonth: null })],
    expenseMode: "amount", expenseTotal: 2.5 * M, expenseTotalPct: 0.02,
  };
}

/** Which tiers a waterfall applies: a preferred return and catch-up only exist in a European one. */
export function waterfallTerms(w) {
  const european = w.type === "european";
  const prefOn = european && w.hasPref !== false;
  return { european, prefOn, catchupOn: prefOn && w.hasCatchup !== false };
}

export function defaultWaterfall() {
  return { type: "european", hasPref: true, hurdleType: "irr", preferredReturn: 0.08, hurdleMultiple: 1.2, hasCatchup: true, catchupRate: 1, carryRate: 0.2, carryTiers: [], clawback: true };
}

export const defaultMonteCarloSettings = () => ({ runs: 3000, market: "normal", spread: "typical", selection: "some", survival: "off", seed: 1 });

/** Monte Carlo step settings; `lastRun` keeps the latest search so it shows again on return. */
export function defaultMonteCarlo() {
  return {
    goal: "split", objective: "median", target: 3, targetCompanies: null, tolerance: 0.1, allowSplit: false,
    locks: {}, bounds: {}, settings: defaultMonteCarloSettings(), lastRun: null,
  };
}

/** The fund write-up's saved text, by section: `{ text, draftBase }`, where `draftBase` is the model draft the text started from. */
export const defaultWriteup = () => ({ sections: {} });

export function defaultRecycling() {
  return { enabled: false, pctOfProceeds: 1, capPct: 0.2, termYears: 5, ahead: false };
}

export function blankPlan({ name = "New fund", currency = null, mode = "advanced", today = new Date() } = {}) {
  const now = today.toISOString();
  const sector = defaultSector();
  return {
    id: planId(name),
    name,
    mode,
    createdAt: now.slice(0, 10),
    updatedAt: now,
    confirmed: {},
    general: {
      fundName: name,
      currency,
      startDate: nextQuarterStart(today),
      evergreen: false,
      termYears: TYPICAL.termYears,
      investmentPeriodYears: TYPICAL.investmentPeriodYears,
      committed: null,
      gpCommitMode: "pct",
      gpCommitPct: TYPICAL.gpCommitPct,
      gpCommitAmount: null,
      callFrequency: TYPICAL.callFrequency,
      closes: [{ month: 0, pct: 1 }],
    },
    sectors: [sector],
    allocations: [defaultAllocation(sector)],
    fees: defaultFees(),
    recycling: defaultRecycling(),
    waterfall: defaultWaterfall(),
    lps: [],
    lpsAnonymized: false,
    lpsSource: null,
    writeup: defaultWriteup(),
    suggestions: {},
    monteCarlo: defaultMonteCarlo(),
    ...(mode === "light" ? { light: defaultLight(null) } : {}),
  };
}

// Ladders start at Pre-Seed; a saved ladder may still have this round in front.
const RETIRED_ROUND = "SAFE / CN";

/** Allocations keep their rounds: later entries shift down one, and an entry at the removed round moves to the next. */
export function dropRound(sectors, allocations, name) {
  const hits = Object.fromEntries(sectors.map((s) => [s.id, s.stages.findIndex((st) => st.name === name)]).filter(([, i]) => i >= 0));
  if (!Object.keys(hits).length) return { sectors, allocations };
  return {
    sectors: sectors.map((s) => (hits[s.id] == null ? s : { ...s, stages: s.stages.filter((_, i) => i !== hits[s.id]) })),
    allocations: allocations?.map((a) => {
      const i = hits[a.sectorId];
      if (i == null) return a;
      const entryStage = a.entryStage > i ? a.entryStage - 1 : a.entryStage;
      const followOns = (a.followOns ?? []).filter((_, k) => k !== i).map((f, k) => (k <= entryStage ? null : f));
      return { ...a, entryStage, followOns };
    }),
  };
}

/** Rounds saved with an option pool top-up keep it as their additional dilution. */
const renameOptionPool = (sector) => ({
  ...sector,
  stages: (sector.stages ?? []).map(({ esopPct, ...st }) => (st.dilutionPct == null && esopPct != null ? { ...st, dilutionPct: esopPct } : st)),
});

/** Fill in any section a saved plan lacks, so every step can open it. */
export function normalizePlan(p) {
  if (!p) return p;
  const base = blankPlan({ name: p.name });
  const dropped = dropRound(p.sectors?.length ? p.sectors : base.sectors, p.allocations, RETIRED_ROUND);
  const sectors = dropped.sectors.map(renameOptionPool).map(normalizeSectorMarket).map((s) => dropForeignBenchmark(s, p.general?.currency));
  const allocations = dropped.allocations ?? [defaultAllocation(sectors[0])];
  const out = {
    ...base,
    ...p,
    // Monte Carlo is a step in Advanced, so a plan saved as "goalseek" opens as Advanced.
    mode: p.mode === "goalseek" ? "advanced" : p.mode ?? base.mode,
    monteCarlo: { ...base.monteCarlo, ...p.monteCarlo, settings: { ...base.monteCarlo.settings, ...p.monteCarlo?.settings } },
    general: { ...base.general, ...p.general },
    sectors,
    allocations,
    fees: normalizeFees(p.fees, p.general, base.fees),
    recycling: { ...base.recycling, ...p.recycling },
    waterfall: { ...base.waterfall, ...p.waterfall, carryTiers: p.waterfall?.carryTiers ?? [] },
    lps: p.lps ?? [],
    lpsAnonymized: p.lpsAnonymized === true,
    lpsSource: p.lpsSource ?? null,
    writeup: { ...defaultWriteup(), ...p.writeup, sections: { ...p.writeup?.sections } },
    suggestions: p.suggestions ?? {},
    ...(p.mode === "light" ? { light: normalizeLight(p.light, p.general?.committed, termYearsOf(p.general), p.general?.investmentPeriodYears) } : {}),
  };
  // A plan with no confirmed steps counts as confirmed up to its first step with a problem.
  if (!p.confirmed) {
    const valid = stepStatus(out);
    out.confirmed = {};
    for (const st of gateSteps(out)) { if (!valid[st.id]) break; out.confirmed[st.id] = true; }
  }
  return out;
}

/** The firm's most recent real fund (not an SPV, has commitments); ties go to the larger fund. */
export function latestFund(snapshot, pick = () => true) {
  const funds = (snapshot?.funds ?? []).filter((f) => f.type !== "SPV" && f.committed > 0 && pick(f));
  if (!funds.length) return null;
  return [...funds].sort((a, b) => (b.vintage ?? 0) - (a.vintage ?? 0) || (b.committed ?? 0) - (a.committed ?? 0))[0];
}

/** `sources` maps each suggested field to the name of the fund it came from. */
export function suggestDefaults(snapshot) {
  const general = {};
  const waterfall = {};
  const sources = {};
  const f = latestFund(snapshot);
  const currency = f?.currency ?? snapshot?.source?.currency ?? null;
  if (currency) {
    general.currency = currency;
    sources.currency = f?.currency ? f.name : "firm reporting currency";
  }
  if (f) {
    general.committed = f.committed;
    sources.committed = f.name;
    if (f.gpCommit != null) {
      general.gpCommitPct = Math.round((f.gpCommit / f.committed) * 1e4) / 1e4;
      sources.gpCommitPct = f.name;
    }
  }
  const wf = latestFund(snapshot, (x) => x.waterfall?.carryRate != null);
  if (wf) {
    waterfall.carryRate = wf.waterfall.carryRate;
    waterfall.preferredReturn = wf.waterfall.preferredReturn ?? 0;
    waterfall.catchupRate = wf.waterfall.catchupRate ?? 0;
    sources.carryRate = sources.preferredReturn = sources.catchupRate = wf.name;
  }
  return { general, waterfall, sources };
}

export function suggestedPlan(snapshot, opts = {}) {
  const { general, waterfall, sources } = suggestDefaults(snapshot);
  const plan = blankPlan({ ...opts, currency: general.currency ?? null });
  Object.assign(plan.general, general);
  Object.assign(plan.waterfall, waterfall);
  plan.suggestions = sources;
  if (plan.mode === "light") {
    const g = plan.general;
    plan.light = defaultLight(g.committed, { gpPct: gpCommitPctOf(g) ?? 0, termYears: termYearsOf(g) });
  }
  return plan;
}

export function addMonthsYm(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** The GP's share of commitments, whether it was entered as a percentage or an amount. */
export function gpCommitPctOf(g) {
  if (g.gpCommitMode === "amount") return g.committed > 0 && g.gpCommitAmount > 0 ? g.gpCommitAmount / g.committed : 0;
  return g.gpCommitPct ?? 0;
}

export function deriveGeneral(g) {
  const committed = g.committed > 0 ? g.committed : 0;
  const gpPct = Math.min(Math.max(gpCommitPctOf(g), 0), 1);
  const validStart = /^\d{4}-\d{2}$/.test(g.startDate ?? "");
  return {
    gpCommitted: committed * gpPct,
    lpCommitted: committed * (1 - gpPct),
    endDate: validStart && !g.evergreen && g.termYears > 0 ? addMonthsYm(g.startDate, Math.round(g.termYears * 12)) : null,
    investmentPeriodEnd: validStart && g.investmentPeriodYears > 0 ? addMonthsYm(g.startDate, Math.round(g.investmentPeriodYears * 12)) : null,
    closedPct: (g.closes ?? []).reduce((s, c) => s + (c.pct || 0), 0),
  };
}

const pctOk = (x) => isNum(x) && x >= 0 && x <= 1;

/** Light has no commitment closes: everything closes at the start. */
export function effectiveGeneral(plan) {
  return plan.mode === "light" ? { ...plan.general, closes: [{ month: 0, pct: 1 }] } : plan.general;
}

/** Input checks for the General step → { field: message }. Empty object = valid. */
export function validateGeneral(g) {
  const e = {};
  if (!g.fundName?.trim()) e.fundName = "Give the fund a name.";
  if (!g.currency) e.currency = "Pick the fund's currency.";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(g.startDate ?? "")) e.startDate = "Pick a start month.";
  if (!(g.committed > 0)) e.committed = "Enter the total committed capital.";
  if (g.gpCommitMode === "amount") {
    if (!(isNum(g.gpCommitAmount) && g.gpCommitAmount >= 0)) e.gpCommitPct = "Enter the GP commitment amount.";
    else if (g.committed > 0 && g.gpCommitAmount >= g.committed) e.gpCommitPct = "The GP commitment must be less than total committed capital.";
  } else if (!(isNum(g.gpCommitPct) && g.gpCommitPct >= 0 && g.gpCommitPct < 1)) e.gpCommitPct = "GP commitment must be between 0% and 100%.";
  if (!g.evergreen && !(g.termYears > 0)) e.termYears = "Enter the fund term, or mark the fund evergreen.";
  if (!(g.investmentPeriodYears > 0)) e.investmentPeriodYears = "Enter the investment period.";
  else if (!g.evergreen && g.termYears > 0 && g.investmentPeriodYears > g.termYears) {
    e.investmentPeriodYears = "The investment period can't be longer than the fund term.";
  }
  const closes = g.closes ?? [];
  if (!closes.length) e.closes = "Add at least one close.";
  else {
    const total = closes.reduce((s, c) => s + (c.pct || 0), 0);
    if (Math.abs(total - 1) > 1e-6) e.closes = `Closes add up to ${(total * 100).toFixed(1)}% of commitments — they need to total 100%.`;
    else if (closes.some((c) => !(isNum(c.month) && c.month >= 0))) e.closes = "Each close needs a month of 0 or later.";
  }
  return e;
}

/** Sector checks → { [sectorId]: { stages: {[i]: message}, sector?: message } }. */
export function validateSectors(sectors) {
  const out = {};
  for (const s of sectors ?? []) {
    const e = { stages: {} };
    if (!s.name?.trim()) e.sector = "Name this profile.";
    if (!s.stages?.length) e.sector = "Add at least one stage.";
    (s.stages ?? []).forEach((st, i) => {
      const last = i === s.stages.length - 1;
      if (!(st.roundSize > 0) || !(st.preMoney > 0)) e.stages[i] = "Round size and valuation must be above zero.";
      else if (!pctOk(st.gradRate) || !pctOk(st.exitRate) || !pctOk(st.dilutionPct ?? 0)) e.stages[i] = "Rates must be between 0% and 100%.";
      else if (st.gradRate + st.exitRate > 1 + 1e-9) e.stages[i] = "Graduation plus exit can't be more than 100%.";
      else if (last && st.gradRate > 0) e.stages[i] = "The last stage can't graduate — set its graduation rate to 0%.";
      else if (st.exitRate > 0 && !(st.exitValuation > 0)) e.stages[i] = "Enter an exit valuation for this stage.";
      else if (!last && st.gradRate > 0 && !(st.monthsToGraduate > 0)) e.stages[i] = "Enter the months to graduate.";
      else if (st.exitRate > 0 && !(st.monthsToExit > 0)) e.stages[i] = "Enter the months to exit.";
    });
    if (e.sector || Object.keys(e.stages).length) out[s.id] = e;
  }
  return out;
}

/** Allocation checks → { total?: message, [allocId]: message }. */
export function validateAllocations(allocations, sectors) {
  const e = {};
  if (!allocations?.length) {
    e.total = "Add at least one allocation.";
    return e;
  }
  const total = allocations.reduce((s, a) => s + (a.capitalPct || 0), 0);
  if (Math.abs(total - 1) > 1e-6) e.total = `Allocations add up to ${(total * 100).toFixed(1)}% of investable capital — they need to total 100%.`;
  for (const a of allocations) {
    const sector = sectors?.find((s) => s.id === a.sectorId);
    if (!sector) e[a.id] = "Pick a sector profile.";
    else if (!(isNum(a.entryStage) && a.entryStage >= 0 && a.entryStage < sector.stages.length)) e[a.id] = "Pick an entry round.";
    else if (a.checkMode === "ownership" ? !(a.entryOwnership > 0 && a.entryOwnership < 1) : !(a.initialCheck > 0)) e[a.id] = "Enter the initial check.";
    else if (!(a.horizonMonths > 0)) e[a.id] = "Enter the initial investment horizon.";
    else if (a.pacing === "byYear" && Array.from({ length: horizonYears(a) }, (_, y) => a.yearlyCounts?.[y]).some((v) => !(isNum(v) && v >= 0))) e[a.id] = "Enter companies for each year, zero or more.";
    else if (a.pacing === "byYear" && !(Array.from({ length: horizonYears(a) }, (_, y) => a.yearlyCounts?.[y] || 0).reduce((s, v) => s + v, 0) > 0)) e[a.id] = "Enter companies for at least one year.";
    else if ((a.followOns ?? []).some((f) => f && f.mode === "amount" && !(f.amount > 0))) e[a.id] = "Enter each fixed follow-on amount.";
    else if ((a.followOns ?? []).some((f) => f && f.mode !== "none" && !pctOk(f.participation))) e[a.id] = "Participation must be between 0% and 100%.";
  }
  return e;
}

/** Expenses are one total over the fund's life, so a plan saved with separate expense lines gets the total they add up to. */
export function normalizeFees(fees, general, fallback) {
  if (!fees) return fallback;
  const out = { ...fallback, ...fees, tiers: normalizeTiers(fees.tiers, termMonthsOf(general)) };
  if (fees.expenseTotal == null && fees.expenseTotalPct == null && Array.isArray(fees.expenses)) {
    out.expenseMode = "amount";
    out.expenseTotal = Math.round(totalOfExpenseLines(fees.expenses, termYearsOf(general)));
  }
  delete out.expenses;
  return out;
}

export function validateFees(fees, general) {
  const e = { ...validateFeeTiers(normalizeTiers(fees?.tiers, termMonthsOf(general)), general ? termMonthsOf(general) : Infinity) };
  const bad = expenseError(fees);
  if (bad && !Array.isArray(fees?.expenses)) e.expense = bad;
  return e;
}

export function validateRecycling(r) {
  if (!r?.enabled) return {};
  const e = {};
  if (!(r.pctOfProceeds > 0 && r.pctOfProceeds <= 1)) e.pctOfProceeds = "Enter a share of proceeds between 0% and 100%.";
  if (!(r.capPct > 0 && r.capPct <= 1)) e.capPct = "Enter a cap between 0% and 100% of commitments.";
  if (!(r.termYears > 0)) e.termYears = "Enter how many years proceeds can be recycled.";
  return e;
}

export function validateWaterfall(w) {
  const e = {};
  if (!(isNum(w.carryRate) && w.carryRate >= 0 && w.carryRate < 1)) e.carryRate = "Carry must be between 0% and 100%.";
  let prev = 1;
  for (const t of w.carryTiers ?? []) {
    if (!(isNum(t.fromMultiple) && t.fromMultiple > prev)) e[t.id] = `Each tier must start above ${prev.toFixed(2)}×, the tier before it.`;
    else if (!(isNum(t.rate) && t.rate >= 0 && t.rate < 1)) e[t.id] = "Carry must be between 0% and 100%.";
    if (isNum(t.fromMultiple)) prev = Math.max(prev, t.fromMultiple);
  }
  const { prefOn, catchupOn } = waterfallTerms(w);
  if (prefOn) {
    if (w.hurdleType === "multiple") {
      if (!(isNum(w.hurdleMultiple) && w.hurdleMultiple >= 1 && w.hurdleMultiple < 10)) e.hurdleMultiple = "The preferred return must be between 1.0× and 10× paid-in capital.";
    } else if (!(isNum(w.preferredReturn) && w.preferredReturn >= 0 && w.preferredReturn < 1)) e.preferredReturn = "The hurdle must be between 0% and 100% a year.";
    if (catchupOn && !(isNum(w.catchupRate) && w.catchupRate >= 0 && w.catchupRate <= 1)) e.catchupRate = "Catch-up must be between 0% and 100%.";
  }
  return e;
}

/** Real names, or "LP 1", "LP 2"… when anonymized; the pooled "Other LPs (n)" row names no one, so it keeps its label. */
export function lpLabels(plan) {
  let n = 0;
  return (plan.lps ?? []).map((lp) => (!plan.lpsAnonymized || lp.pooled ? lp.name : `LP ${++n}`));
}

export function validateLps(lps, lpCommitted) {
  const e = {};
  if (!lps?.length) return e;
  lps.forEach((lp) => {
    if (!lp.name?.trim()) e[lp.id] = "Name this LP.";
    else if (!(lp.commitment > 0)) e[lp.id] = "Enter this LP's commitment.";
  });
  const total = lps.reduce((s, lp) => s + (lp.commitment || 0), 0);
  if (lpCommitted > 0 && Math.abs(total - lpCommitted) > Math.max(1, lpCommitted * 1e-6)) e.total = "mismatch";
  return e;
}

/** For the earliest-entering allocation: `from` is a company backed at month 0, `to` adds the longest first-check horizon; `afterEnd` is "all" or "some". */
export function exitTimeline(sector, allocations, general) {
  const users = (allocations ?? []).filter((a) => a.sectorId === sector.id);
  const entry = users.length ? Math.min(...users.map((a) => a.entryStage ?? 0)) : 0;
  const horizon = users.length ? Math.max(...users.map((a) => Math.max(1, a.horizonMonths || 1))) : 1;
  const termMonths = !general.evergreen && general.termYears > 0 ? Math.round(general.termYears * 12) : null;
  const rows = {};
  let reach = 0;
  for (let i = entry; i < sector.stages.length; i++) {
    const st = sector.stages[i];
    if (st.exitRate > 0) {
      const from = reach + Math.max(1, Math.round(st.monthsToExit || 0));
      const to = from + horizon - 1;
      rows[i] = { from, to, afterEnd: termMonths == null ? null : from > termMonths ? "all" : to > termMonths ? "some" : null };
    }
    if (!(st.gradRate > 0) || i === sector.stages.length - 1) break;
    reach += Math.max(1, Math.round(st.monthsToGraduate || 0));
  }
  return { entry, horizon, termMonths, rows };
}

/** The steps that must be confirmed, in order: every step except optional ones and the Summary. */
export const gateSteps = (plan) => stepsFor(plan).filter((s) => !s.optional && s.id !== "results");

/** A step is `locked` until every required step before it is confirmed; changing an earlier step later doesn't re-lock anything. */
export function stepFlow(plan) {
  const valid = stepStatus(plan);
  const confirmed = plan.confirmed ?? {};
  const out = {};
  let blockedBy = null;
  for (const s of stepsFor(plan)) {
    const gate = !s.optional && s.id !== "results";
    out[s.id] = {
      valid: !!valid[s.id],
      confirmed: gate && !!confirmed[s.id],
      done: gate ? !!confirmed[s.id] && !!valid[s.id] : !!valid[s.id],
      locked: blockedBy != null,
      blockedBy,
    };
    if (gate && !confirmed[s.id] && blockedBy == null) blockedBy = s.id;
  }
  return out;
}

const hasWriteup = (plan) => Object.values(plan.writeup?.sections ?? {}).some((s) => s?.included);

/** Whether inputs are valid, step by step. Confirmation is tracked separately, in `stepFlow`. */
export function stepStatus(plan) {
  const ok = (e) => Object.keys(e).length === 0;
  if (plan.mode === "light") {
    return {
      terms: ok(validateGeneral(effectiveGeneral(plan))) && ok(validateLightFees(plan.light.fees, plan.general)) && ok(validateWaterfall(plan.waterfall))
        && ok(validateLps(plan.lps ?? [], deriveGeneral(effectiveGeneral(plan)).lpCommitted)),
      portfolio: ok(validatePortfolio(plan.light)) && ok(validateOutcomes(plan.light)),
      writeup: hasWriteup(plan),
    };
  }
  return {
    terms: ok(validateGeneral(plan.general)) && ok(validateFees(plan.fees, plan.general))
      && ok(validateRecycling(plan.recycling)) && ok(validateWaterfall(plan.waterfall))
      && ok(validateLps(plan.lps ?? [], deriveGeneral(plan.general).lpCommitted)),
    market: ok(validateSectors(plan.sectors)),
    strategy: ok(validateAllocations(plan.allocations, plan.sectors)),
    montecarlo: !!plan.monteCarlo?.lastRun,
    writeup: hasWriteup(plan),
  };
}

// construction.json: { version, plans, activePlanId }

export function emptyDoc() {
  return { version: CONSTRUCTION_VERSION, plans: [], activePlanId: null };
}

export function activePlan(doc) {
  return doc?.plans?.find((p) => p.id === doc.activePlanId) ?? doc?.plans?.[0] ?? null;
}
