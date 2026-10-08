// Light mode's outcome table is goal-sought from a venture return shape to hit the target gross MOIC, and stays editable.
import { feeTier, normalizeTiers, validateFeeTiers, termMonthsOf, termYearsOf, expenseTotalOf, expenseSchedule, expenseError, isNum } from "./feeTiers.js";

export const OUTCOMES = [
  { id: "failed", label: "Failed", exitYears: 3 },
  { id: "low", label: "Low", exitYears: 4 },
  { id: "medium", label: "Medium", exitYears: 5 },
  { id: "large", label: "Large", exitYears: 6 },
  { id: "unicorn", label: "Unicorn", exitYears: 7 },
];

// Shares and base multiples in `OUTCOMES` order; the goal seek keeps the shares and scales the multiples.
export const SHAPES = [
  { id: "singles", label: "Singles & doubles", tagline: "Low failure rate, modest exits, no unicorns", description: "Few failures (about 15%) and many modest exits, with no unicorns.",
    shares: [0.15, 0.4, 0.3, 0.15, 0], multiples: [0, 1.5, 3, 6, 15] },
  { id: "balanced", label: "Balanced portfolio", tagline: "Returns build steadily up the outcomes", description: "Half the companies fail, the rest spread across modest, mid and large exits, with a rare unicorn.",
    shares: [0.5, 0.25, 0.15, 0.075, 0.025], multiples: [0, 1, 3, 8, 25] },
  { id: "powerLaw", label: "Power law (home-run driven)", tagline: "A few unicorns return the fund", description: "Most companies fail; a few outsized winners return the fund.",
    shares: [0.65, 0.15, 0.125, 0.05, 0.025], multiples: [0, 1, 3, 12, 50] },
];

export const shapeOf = (id) => SHAPES.find((s) => s.id === id) ?? null;

export const MULTIPLE_STEP = 0.5;
export const snapMultiple = (x) => Math.round(x / MULTIPLE_STEP) * MULTIPLE_STEP;
const onStep = (x) => Math.abs(x / MULTIPLE_STEP - Math.round(x / MULTIPLE_STEP)) < 1e-9;

/** The most the goal seek will give an outcome: a Low exit is at best a modest one. */
export const SOLVER_CAPS = { low: 1.5 };
const capOf = (o) => SOLVER_CAPS[o.id] ?? Infinity;

/** A solve that has to scale a shape's multiples by more than this much is a stretch for it. */
export const STRETCH = { low: 0.6, high: 1.6 };

export const outcomeLabel = (id) => OUTCOMES.find((o) => o.id === id)?.label ?? id;

export const tierName = (o) => (typeof o.label === "string" && o.label.trim() ? o.label.trim() : outcomeLabel(o.id));

/** The top survivor tier: "unicorn" while the table has one, else whichever survivor has the highest multiple. */
export function topOutcome(l) {
  const survivors = (l.outcomes ?? []).filter((o) => o.id !== "failed");
  return survivors.find((o) => o.id === "unicorn") ?? survivors.reduce((best, o) => ((o.multiple ?? 0) > (best?.multiple ?? -1) ? o : best), null);
}

// Random ids keep added tiers clear of the standard OUTCOMES ids.
const newTierId = () => `tier-${Math.random().toString(36).slice(2, 8)}`;

/** A hand-built table has no preset shape, so adding a tier clears it. */
export function addOutcome(l) {
  const survivors = l.outcomes.filter((o) => o.id !== "failed");
  const top = survivors.reduce((best, o) => ((o.multiple ?? 0) > (best?.multiple ?? -1) ? o : best), null);
  const id = newTierId();
  l.outcomes.push({ id, label: "New tier", share: 0, multiple: snapMultiple(Math.max(1, (top?.multiple ?? 1) * 1.5)), exitYears: (survivors.at(-1)?.exitYears ?? 4) + 1 });
  l.shape = null;
  l.outcomesEdited = true;
  return id;
}

/** Never Failed or the last survivor; the removed tier's companies fall into Failed. */
export function removeOutcome(l, id) {
  if (id === "failed" || l.outcomes.filter((o) => o.id !== "failed").length <= 1) return false;
  l.outcomes = l.outcomes.filter((o) => o.id !== id);
  l.shape = null;
  l.outcomesEdited = true;
  return true;
}

const FEE_RATE = 0.02;
// Fund expenses are a total over the fund's life (an amount, or a share of commitments).
const DEFAULT_EXPENSES = { expenseMode: "amount", expenseTotal: 2.5e6, expenseTotalPct: 0.02 };
const EXPENSES_PER_YEAR = 250000;

/** A round check size that fills `investable` with `companies` first checks plus reserves. */
export function suggestedCheck(investable, companies, reservePct) {
  if (!(investable > 0) || !(companies > 0)) return null;
  const raw = (investable * (1 - reservePct)) / companies;
  const step = raw >= 1e6 ? 25000 : 5000;
  return Math.max(step, Math.round(raw / step) * step);
}

/** The check is sized so the default portfolio fits commitments less the default fee (on LP commitments) and term expenses. */
export function defaultLight(committed = null, { gpPct = 0, termYears = 10 } = {}) {
  const companies = 40;
  const reservePct = 0.4;
  const investable = committed > 0
    ? committed - FEE_RATE * committed * (1 - gpPct) * termYears - EXPENSES_PER_YEAR * termYears
    : null;
  const l = {
    companies,
    initialCheck: suggestedCheck(investable, companies, reservePct),
    reservePct,
    followOnMonths: 18,
    targetMoic: 3,
    shape: "balanced",
    fitLevers: ["initialCheck"],
    outcomesEdited: false,
    outcomeMode: "count",
    outcomes: OUTCOMES.map((o, i) => ({ id: o.id, share: shapeOf("balanced").shares[i], multiple: shapeOf("balanced").multiples[i], exitYears: o.exitYears })),
    fees: { tiers: [feeTier({ rate: FEE_RATE })], ...DEFAULT_EXPENSES, expenseTotal: EXPENSES_PER_YEAR * (termYears || 10) },
  };
  l.outcomes = solveOutcomes(l).outcomes;
  return l;
}

/** Fill in any field a saved Light section lacks, in the current shape. */
export function normalizeLight(l, committed, termYears = 10, ipYears = 5) {
  const d = defaultLight(committed, { termYears });
  if (!l) return d;
  // A plan with no targetMoic keeps its table and check as entered: a custom shape whose target is what it already returns.
  const legacy = l.targetMoic === undefined;
  const out = { ...d, ...l, outcomes: (l.outcomes?.length ? l.outcomes : d.outcomes).map((o) => ({ ...o })), fees: { ...d.fees, ...l.fees } };
  // A per-year expense (expenseAmount / expensePct) becomes the same total over the term.
  const f = l.fees ?? {};
  if (f.expenseTotal == null && f.expenseAmount != null) out.fees.expenseTotal = f.expenseAmount * (termYears || 10);
  if (f.expenseTotalPct == null && f.expensePct != null) out.fees.expenseTotalPct = f.expensePct * (termYears || 10);
  delete out.fees.expenseAmount;
  delete out.fees.expensePct;
  out.fees.tiers = l.fees?.tiers ? normalizeTiers(l.fees.tiers, Math.round((termYears || 10) * 12)) : tiersFromOldFees(f, termYears, ipYears);
  for (const k of ["rate", "basis", "stepDown", "stepDownRate", "stepDownBasis", "stepDownMonth"]) delete out.fees[k];
  // Companies are whole: a fractional count snaps to the nearest company.
  const N = out.companies;
  if (isNum(N) && N > 0) {
    out.companies = Math.max(1, Math.round(N));
    if (out.outcomeMode !== "pct") for (const o of out.outcomes) if (o.id !== "failed" && isNum(o.share)) o.share = Math.round(o.share * N) / out.companies;
  }
  for (const o of out.outcomes) if (o.id !== "failed" && isNum(o.multiple)) o.multiple = snapMultiple(o.multiple);
  if (!legacy && out.shape && !out.outcomesEdited) out.outcomes = solveOutcomes(out).outcomes;
  delete out.checkOverridden;
  if (legacy) {
    const moic = lightPortfolio(out).grossMoic;
    Object.assign(out, { shape: null, targetMoic: isNum(moic) ? Math.round(moic * 100) / 100 : d.targetMoic, outcomesEdited: false });
  }
  return out;
}

const wholeCount = (N, share) => (isNum(share) ? Math.round(N * share + 1e-9) : 0);

const survivorCount = (l) => l.outcomes.reduce((s, o) => s + (o.id !== "failed" ? wholeCount(l.companies || 0, o.share) : 0), 0);

/** Whole-company counts per outcome, with Failed as the rest, so the groups always add up. */
export function resolvedOutcomes(l) {
  const N = l.companies || 0;
  const rest = Math.max(0, N - survivorCount(l));
  return l.outcomes.map((o) => {
    const count = o.id === "failed" ? rest : wholeCount(N, o.share);
    return { ...o, count, share: N > 0 ? count / N : 0 };
  });
}

/** Entered as counts, survivors keep their typed numbers and Failed takes the difference; entered as shares, every group keeps its share. */
export function setCompanies(l, n) {
  const old = l.companies;
  if (l.outcomeMode !== "pct" && old > 0 && n > 0) {
    for (const o of l.outcomes) if (o.id !== "failed" && isNum(o.share)) o.share = (o.share * old) / n;
  }
  l.companies = n;
}

/** Moving to counts snaps each group to whole companies. */
export function setOutcomeMode(l, mode) {
  const N = l.companies;
  if (mode !== "pct" && N > 0) for (const o of l.outcomes) if (o.id !== "failed" && isNum(o.share)) o.share = wholeCount(N, o.share) / N;
  l.outcomeMode = mode;
}

/** Reserves are a share of all capital put to work, and go only to companies that survive. */
export function lightPortfolio(l) {
  const N = l.companies || 0;
  const C = l.initialCheck || 0;
  const R = Math.min(Math.max(l.reservePct || 0, 0), 0.99);
  const initialCapital = N * C;
  const deployed = initialCapital / (1 - R);
  const reserves = deployed - initialCapital;
  const survivors = survivorCount(l);
  const followOn = survivors > 0 ? reserves / survivors : 0;
  const groups = resolvedOutcomes(l).map((o) => {
    const { count } = o;
    const perCompany = C + (o.id === "failed" ? 0 : followOn);
    const multiple = o.id === "failed" ? 0 : o.multiple || 0;
    return { ...o, label: tierName(o), count, perCompany, followOn: o.id === "failed" ? 0 : followOn, multiple, proceeds: count * perCompany * multiple };
  });
  const proceeds = groups.reduce((s, g) => s + g.proceeds, 0);
  return { companies: N, initialCapital, reserves, deployed, survivors, followOn, groups, proceeds, grossMoic: deployed > 0 ? proceeds / deployed : null };
}

/** Top outcomes needed to return commitments, and the multiple one unicorn needs on everything invested in it to return the fund alone. */
export function whatItTakes(l, committed) {
  const topId = topOutcome(l)?.id;
  const top = lightPortfolio(l).groups.find((g) => g.id === topId);
  if (!top || !(committed > 0)) return null;
  const perCompany = top.perCompany * top.multiple;
  return {
    label: top.label,
    multiple: top.multiple,
    invested: top.perCompany,
    perCompany,
    fundMultiple: perCompany / committed,
    needed: perCompany > 0 ? Math.ceil(committed / perCompany) : null,
    multipleToReturnFund: top.perCompany > 0 ? committed / top.perCompany : null,
  };
}

/** Gross MOIC is linear in survivor multiples, so they scale by `k = target / base MOIC`, snap to 0.5× steps, then nudge to close the snapping gap. */
export function solveOutcomes(l, shapeId = l.shape, target = l.targetMoic) {
  const N = l.companies || 0;
  const shape = shapeOf(shapeId);
  const years = Object.fromEntries(l.outcomes.map((o) => [o.id, o.exitYears]));
  let outcomes;
  if (shape) {
    const counts = shape.shares.map((s) => (N > 0 ? Math.round(N * s) : 0));
    // Trim the top outcomes if rounding left more survivors than companies, keeping at least one.
    let survivors = counts.slice(1).reduce((a, b) => a + b, 0);
    for (let i = counts.length - 1; i > 0 && survivors > N; i--) while (counts[i] > 0 && survivors > N) { counts[i]--; survivors--; }
    if (survivors === 0 && N > 0) { counts[1] = 1; }
    const named = Object.fromEntries(l.outcomes.filter((o) => typeof o.label === "string").map((o) => [o.id, o.label]));
    outcomes = OUTCOMES.map((o, i) => ({ id: o.id, ...(named[o.id] ? { label: named[o.id] } : {}), share: N > 0 ? (i === 0 ? 0 : counts[i] / N) : shape.shares[i], multiple: shape.multiples[i], exitYears: years[o.id] ?? o.exitYears }));
  } else {
    outcomes = l.outcomes.map((o) => ({ ...o }));
  }
  const moicOf = () => lightPortfolio({ ...l, outcomes }).grossMoic;
  const base = moicOf();
  if (!isNum(target) || !(target >= 0) || !(base > 0)) return { outcomes, k: null };
  const k = target / base;
  // Only outcomes with companies in them move; an empty one keeps its base multiple.
  for (const o of outcomes) if (o.id !== "failed" && wholeCount(N, o.share) > 0) o.multiple = Math.min(capOf(o), snapMultiple((o.multiple || 0) * k));
  const live = outcomes.filter((o) => o.id !== "failed" && wholeCount(N, o.share) > 0);
  // Moving a company between neighbouring survivors closes gaps 0.5× steps can't, a few times at most so the shape stays the shape.
  const moves = [];
  if (shape && N > 0) {
    for (let i = 0; i < live.length - 1; i++) moves.push([live[i], live[i + 1]], [live[i + 1], live[i]]);
  }
  let moved = 0;
  for (let i = 0; i < 60; i++) {
    let best = null, bestGap = Math.abs(moicOf() - target);
    const tryIt = (apply, undo, step) => {
      apply();
      const gap = Math.abs(moicOf() - target);
      undo();
      if (gap < bestGap - 1e-12) { best = step; bestGap = gap; }
    };
    for (const o of live) for (const d of [MULTIPLE_STEP, -MULTIPLE_STEP]) {
      if (o.multiple + d < 0 || o.multiple + d > capOf(o)) continue;
      tryIt(() => { o.multiple += d; }, () => { o.multiple -= d; }, () => { o.multiple += d; });
    }
    // A step up on one outcome with a step down on another finds finer moves than either alone.
    for (const up of live) for (const dn of live) {
      if (up === dn || dn.multiple < MULTIPLE_STEP || up.multiple + MULTIPLE_STEP > capOf(up)) continue;
      tryIt(() => { up.multiple += MULTIPLE_STEP; dn.multiple -= MULTIPLE_STEP; }, () => { up.multiple -= MULTIPLE_STEP; dn.multiple += MULTIPLE_STEP; },
        () => { up.multiple += MULTIPLE_STEP; dn.multiple -= MULTIPLE_STEP; });
    }
    if (moved < 3) for (const [from, to] of moves) {
      if (wholeCount(N, from.share) <= 1) continue;
      const one = 1 / N;
      tryIt(() => { from.share -= one; to.share += one; }, () => { from.share += one; to.share -= one; },
        () => { from.share -= one; to.share += one; moved++; });
    }
    if (!best) break;
    best();
  }
  return { outcomes, k };
}

/** Re-solve the table in place, unless it's been edited by hand (then the gap shows instead). */
export function resolveOutcomes(l, { force = false } = {}) {
  if (!force && (l.outcomesEdited || !l.shape)) return;
  l.outcomes = solveOutcomes(l).outcomes;
  l.outcomesEdited = false;
}

/** Always re-solves, replacing any hand edits. */
export function setShape(l, id) {
  l.shape = id;
  resolveOutcomes(l, { force: true });
}

/** The Portfolio inputs "Fit to capital" may change, in the order they're listed to the user. */
export const FIT_LEVERS = [
  { id: "initialCheck", label: "Check size" },
  { id: "companies", label: "Companies" },
  { id: "reservePct", label: "Reserves" },
];
const MAX_RESERVES = 0.9;

/** Deployed = companies × check ÷ (1 − reserves); chosen inputs share the change equally, and check size, else reserves, absorbs rounding. */
export function fitToCapital(l, investable, levers = l.fitLevers ?? ["initialCheck"]) {
  const on = new Set(levers);
  const N = l.companies, R = l.reservePct || 0;
  if (!(investable > 0) || !(N > 0) || on.size === 0) return false;
  // No check typed yet: size it straight from what's left once the companies and reserves are set.
  if (!(l.initialCheck > 0)) {
    if (!on.has("initialCheck")) return false;
    l.initialCheck = Math.max(1, Math.round((investable * (1 - R)) / N / 1000) * 1000);
    return true;
  }
  const C = l.initialCheck;
  const deployed = (N * C) / (1 - R);
  const f = Math.pow(investable / deployed, 1 / on.size);
  if (on.has("companies")) setCompanies(l, Math.max(1, Math.round(N * f)));
  if (on.has("reservePct")) l.reservePct = Math.min(MAX_RESERVES, Math.max(0, 1 - (1 - R) / f));
  if (on.has("initialCheck")) l.initialCheck = C * f;
  // Close what rounding and the reserves limit left over.
  const firstChecks = investable * (1 - (l.reservePct || 0));
  if (on.has("initialCheck")) l.initialCheck = Math.max(1, Math.round(firstChecks / l.companies / 1000) * 1000);
  else if (on.has("reservePct")) l.reservePct = Math.min(MAX_RESERVES, Math.max(0, 1 - (l.companies * l.initialCheck) / investable));
  return true;
}

/** Survivors' follow-on lands `followOnMonths` in (or the month before exit); while held, value runs on a straight line from cost to exit. */
export function outcomeTemplate(group, { initialCheck, followOnMonths }) {
  const X = Math.max(1, Math.round((group.exitYears || 0) * 12));
  const fo = group.followOn > 0 ? Math.max(1, Math.min(Math.round(followOnMonths || 1), X - 1)) : null;
  const len = X + 1;
  const z = () => new Array(len).fill(0);
  const invest = z(), proceeds = z(), fmv = z(), cost = z(), gainPos = z();
  invest[0] = initialCheck;
  if (fo != null && fo < X) invest[fo] += group.followOn;
  const invested = initialCheck + (fo != null && fo < X ? group.followOn : 0);
  const exitValue = invested * group.multiple;
  for (let k = 0; k < X; k++) {
    const basis = initialCheck + (fo != null && k >= fo ? group.followOn : 0);
    cost[k] = basis;
    fmv[k] = group.id === "failed" ? basis : basis * (1 + (group.multiple - 1) * (k / X));
  }
  proceeds[X] = exitValue;
  gainPos[X] = Math.max(0, exitValue - invested);
  return {
    initial: initialCheck,
    entryOwnership: null,
    followOnCapital: invested - initialCheck,
    followOnCount: invested > initialCheck ? 1 : 0,
    invested,
    proceeds: exitValue,
    moic: invested > 0 ? exitValue / invested : null,
    funnel: [],
    exitMonths: X,
    series: { invest, proceeds, fmv, cost, gainPos },
  };
}

function tiersFromOldFees(f, termYears, ipYears) {
  if (!isNum(f.rate)) return [feeTier({ rate: FEE_RATE })];
  const main = feeTier({ rate: f.rate, basis: f.basis ?? "committed" });
  if (!f.stepDown) return [main];
  const cut = isNum(f.stepDownMonth) ? f.stepDownMonth : Math.round((ipYears || 5) * 12);
  const T = Math.round((termYears || 10) * 12);
  if (cut >= T) return [main];
  main.endMonth = cut;
  return [main, feeTier({ rate: f.stepDownRate ?? 0.015, basis: f.stepDownBasis ?? "committed", startMonth: cut + 1 })];
}

export function lightFees(l, general) {
  return { tiers: l.fees.tiers ?? [], expenses: expenseSchedule(l.fees, general) };
}

export const lightExpenseTotal = expenseTotalOf;

export function validatePortfolio(l) {
  const e = {};
  if (!isNum(l.companies) || l.companies <= 0) e.companies = "Enter how many companies the fund backs.";
  else if (!Number.isInteger(l.companies)) e.companies = "Enter a whole number of companies.";
  if (!isNum(l.initialCheck) || l.initialCheck <= 0) e.initialCheck = "Enter an initial check size.";
  if (!isNum(l.reservePct) || l.reservePct < 0 || l.reservePct >= 1) e.reservePct = "Reserves must be at least 0% and under 100%.";
  if (!isNum(l.targetMoic) || l.targetMoic <= 0) e.targetMoic = "Enter a target gross multiple above zero.";
  if (!isNum(l.followOnMonths) || l.followOnMonths < 1) e.followOnMonths = "Follow-ons need to come at least a month after the first check.";
  return e;
}

export function validateOutcomes(l) {
  const e = {};
  const N = l.companies || 0;
  const survivors = survivorCount(l);
  if (survivors > N) {
    e.total = l.outcomeMode !== "pct"
      ? `Survivors add up to ${survivors} companies, more than the ${N} the fund backs.`
      : `Survivors work out to ${survivors} companies, more than the ${N} the fund backs.`;
  }
  for (const o of l.outcomes) {
    if (typeof o.label === "string" && !o.label.trim()) { e[o.id] = "Give this tier a name."; continue; }
    if (o.id !== "failed" && (!isNum(o.share) || o.share < 0)) e[o.id] = "Enter zero or more companies.";
    else if (o.id !== "failed" && l.outcomeMode !== "pct" && Math.abs(o.share * N - Math.round(o.share * N)) > 1e-6) e[o.id] = "Enter a whole number of companies.";
    else if (o.id !== "failed" && (!isNum(o.multiple) || o.multiple < 0)) e[o.id] = "Enter a gross multiple of zero or more.";
    else if (o.id !== "failed" && !l.derived && !onStep(o.multiple)) e[o.id] = "Gross multiples go in steps of 0.5× (e.g. 2.5×).";
    else if (!isNum(o.exitYears) || o.exitYears <= 0) e[o.id] = "Enter the years from first check to exit.";
  }
  if (l.reservePct > 0 && N > 0 && !(survivors > 0)) e.total = "Reserves only go to surviving companies, so at least one company needs to survive.";
  return e;
}

export function validateLightFees(f, general) {
  const e = validateFeeTiers(f.tiers, general ? termMonthsOf(general) : Infinity);
  const bad = expenseError(f);
  if (bad) e.expense = bad;
  return e;
}

/** First checks spread over the investment period, so each group exits over a window; `afterEnd` ("all"/"some") flags windows past the fund's end. */
export function outcomeTimeline(l, general) {
  const T = Math.round(termYearsOf(general, 0) * 12);
  const H = Math.max(1, Math.min(Math.round((general.investmentPeriodYears || 3) * 12), T || Infinity));
  const rows = {};
  for (const o of l.outcomes) {
    if (!(o.exitYears > 0)) continue;
    const from = Math.max(1, Math.round(o.exitYears * 12));
    const to = from + H - 1;
    rows[o.id] = { from, to, afterEnd: general.evergreen ? null : from > T ? "all" : to > T ? "some" : null };
  }
  return { termMonths: T, horizon: H, rows };
}
