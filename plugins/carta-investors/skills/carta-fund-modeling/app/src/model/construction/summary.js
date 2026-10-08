import { fmtMIn, fmtX, fmtPct, fmtOwn, fmtYm, fmtYears, fmtCount } from "../../ui/format.js";
import { gateSteps, stepFlow, addMonthsYm, CALL_FREQUENCIES, FEE_BASES, gpCommitPctOf, pacingWeights, effectiveGeneral, waterfallTerms } from "./plan.js";
import { lightExpenseTotal, lightPortfolio, shapeOf } from "./light.js";
import { MARKETS, marketFunnel } from "./market.js";
import { bridge, liquidity } from "./analysis.js";
import { termYearsOf } from "./feeTiers.js";


/** Every required step is confirmed and valid; optional ones don't count. */
export const isComplete = (plan) => {
  const flow = stepFlow(plan);
  return gateSteps(plan).every((s) => flow[s.id].done);
};

/** The first step still needing input, or Results when everything's done. */
export const firstUnfinished = (plan) => {
  const flow = stepFlow(plan);
  return gateSteps(plan).find((s) => !flow[s.id].done)?.id ?? "results";
};

/** Two or three plain sentences: size, net result, what fees and carry take, and when LPs are paid back. */
export function storyline(plan, result) {
  if (!result?.ok) return [];
  const ccy = plan.general.currency;
  const m = result.metrics, t = result.totals;
  const b = bridge(result);
  const liq = liquidity(result, plan.general.startDate);
  const carry = t.gpCarryRealized + t.gpCarryUnrealized;
  const out = [
    `A ${fmtMIn(t.committed, ccy)} fund backing ${Math.abs(m.initialDeals - Math.round(m.initialDeals)) < 0.05 ? Math.round(m.initialDeals) : `about ${Math.round(m.initialDeals)}`} companies returns ${fmtX(m.tvpi)} net to LPs${m.netIrr == null ? "" : ` (${fmtPct(m.netIrr, 1)} net IRR)`}.`,
    `Before ${fmtMIn(t.fees + t.expenses, ccy)} of fees and expenses and ${fmtMIn(carry, ccy)} of carry, the portfolio returns ${fmtX(m.grossMoic)} gross${b ? `: costs take ${fmtX(b.feeDrag)} and carry ${fmtX(b.carry)} of it` : ""}.`,
  ];
  out.push(liq?.dpiOne ? `LPs get their money back (DPI 1.0×) by ${fmtYm(liq.dpiOne, null)}.` : "LPs don't get all their money back in cash within the fund's term.");
  return out;
}

const feeSummary = (tiers, termMonths) => (tiers ?? []).map((tier) => {
  const from = Math.ceil((tier.startMonth || 1) / 12), to = tier.endMonth ? Math.ceil(tier.endMonth / 12) : Math.ceil(termMonths / 12);
  const basis = (FEE_BASES.find((b) => b.id === tier.basis)?.label ?? "commitments").replace(/ \(LPs\)$/, "").toLowerCase();
  return `${fmtPct(tier.rate, 1)} of ${basis}, years ${from}–${to}`;
}).join("; ") || "None";

/** Every assumption the model rests on, grouped, with the step (and section) that edits it. */
export function assumptions(plan, result) {
  const g = plan.general, ccy = g.currency, w = plan.waterfall, tiersOn = waterfallTerms(w);
  const term = termYearsOf(g);
  const light = plan.mode === "light";
  const row = (label, value, step, section) => ({ label, value, step, section });
  const groups = [
    { id: "terms", title: "Fund terms", rows: [
      row("Fund size", fmtMIn(g.committed, ccy), "terms", "general"),
      row("Term", g.evergreen ? "Evergreen" : fmtYears(g.termYears), "terms", "general"),
      row("Investment period", fmtYears(g.investmentPeriodYears), "terms", "general"),
      row("GP commitment", fmtPct(gpCommitPctOf(g), 1), "terms", "general"),
      row("Capital calls", CALL_FREQUENCIES.find((c) => c.id === g.callFrequency)?.label ?? "—", "terms", "general"),
    ] },
    { id: "fees", title: "Fees & expenses", rows: [
      row("Management fee", feeSummary(light ? plan.light.fees.tiers : plan.fees.tiers, term * 12), "terms", "fees"),
      row("Fund expenses", fmtMIn(lightExpenseTotal(light ? plan.light.fees : plan.fees, g), ccy), "terms", "fees"),
    ] },
    { id: "waterfall", title: "Waterfall", rows: [
      row("Type", w.type === "american" ? "American (deal by deal)" : "European (whole fund)", "terms", "waterfall"),
      row("Preferred return", tiersOn.prefOn ? (w.hurdleType === "multiple" ? fmtX(w.hurdleMultiple) : fmtPct(w.preferredReturn, 0)) : "None", "terms", "waterfall"),
      row("GP catch-up", tiersOn.catchupOn ? fmtPct(w.catchupRate, 0) : "None", "terms", "waterfall"),
      row("Carried interest", fmtPct(w.carryRate, 0), "terms", "waterfall"),
    ] },
  ];
  if (light) {
    const l = plan.light;
    const book = lightPortfolio(l);
    groups.push({ id: "portfolio", title: "Portfolio", rows: [
      row("Companies", fmtCount(l.companies), "portfolio", "portfolio"),
      row("Initial check", fmtMIn(l.initialCheck, ccy), "portfolio", "portfolio"),
      row("Reserves", fmtPct(l.reservePct, 0), "portfolio", "portfolio"),
      row("Target gross MOIC", fmtX(l.targetMoic), "portfolio", "portfolio"),
      row("Return shape", shapeOf(l.shape)?.label ?? "Custom", "portfolio", "outcomes"),
      row("Survivors", `${fmtCount(book.survivors)} of ${fmtCount(book.companies)}`, "portfolio", "outcomes"),
    ] });
  } else {
    groups.push({ id: "market", title: "Market", rows: plan.sectors.map((s) => row(s.name,
      s.customized ? "Custom ladder" : MARKETS.find((x) => x.id === s.market?.preset)?.label ?? "Typical venture market", "market", null)) });
    groups.push({ id: "strategy", title: "Strategy", rows: plan.allocations.map((a) => {
      const sector = plan.sectors.find((s) => s.id === a.sectorId);
      const entry = sector?.stages[a.entryStage]?.name ?? "—";
      const check = a.checkMode === "ownership" ? `${fmtPct(a.entryOwnership, 1)} ownership` : `${fmtMIn(a.initialCheck, ccy)} checks`;
      return row(a.name, `${fmtPct(a.capitalPct, 0)} · ${entry} · ${check}`, "strategy", null);
    }) });
    const run = plan.monteCarlo?.lastRun;
    const target = plan.target?.value > 0 ? `${fmtX(plan.target.value)} ${plan.target.metric === "tvpi" ? "net TVPI" : "gross MOIC"}` : "None set";
    groups.push({ id: "montecarlo", title: "Goal seek & simulate", rows: [
      row("Target", target, "montecarlo", null),
      row("Last Monte Carlo run", run?.at ? new Date(run.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not run yet", "montecarlo", null),
    ] });
    // Last, as in a Light plan.
    const book = advancedPortfolio(plan, result);
    if (book) groups.push(book);
  }
  return groups;
}

/** The plan's goal and how far it is from it, or null when it has none. */
export function targetStatus(plan, result) {
  const light = plan.mode === "light";
  const metric = light ? "grossMoic" : plan.target?.metric ?? "grossMoic";
  const target = light ? plan.light?.targetMoic : plan.target?.value;
  if (!(target > 0)) return null;
  const actual = result?.ok ? (metric === "tvpi" ? result.metrics.tvpi : result.metrics.grossMoic) : null;
  // Light: the outcome table's multiple, before holdings still open at fund end are sold at their value then.
  const table = light && result?.ok ? result.light?.grossMoic ?? null : null;
  return { label: metric === "tvpi" ? "Net TVPI" : "Gross MOIC", target, actual, gap: actual == null ? null : actual - target, table };
}

export const headline = (plan, result) => storyline(plan, result)[0] ?? null;

/** A group's values on one line, for its collapsed row in the assumptions panel. */
export const assumptionSummary = (group) => group.rows.slice(0, 3).map((r) => r.value).join(" · ");

// Follows each allocation's own pacing; Light spreads its companies evenly over the investment period.
function backedByMonth(plan, result) {
  const T = result.months;
  const out = new Array(T + 1).fill(0);
  const spread = (n, w) => w.forEach((x, m) => { if (m <= T) out[m] += n * x; });
  if (plan.mode === "light") {
    const H = Math.max(1, Math.round((effectiveGeneral(plan).investmentPeriodYears || 3) * 12));
    spread(result.metrics.initialDeals, new Array(H).fill(1 / H));
  } else {
    plan.allocations.forEach((a, j) => {
      const H = Math.max(1, Math.min(Math.round(a.horizonMonths), T));
      spread(result.allocations[j]?.initialDeals ?? 0, pacingWeights(a, H));
    });
  }
  return out;
}

const BUILD = [
  { share: 0.25, label: "25% of portfolio" },
  { share: 0.5, label: "50% of portfolio" },
  { share: 0.75, label: "75% of portfolio" },
  { share: 1, label: "Portfolio complete" },
];
const DPI_STEPS = [0.5, 1, 2, 3, 5];

/** `kind` is "fund" (calendar dates), "build" (portfolio filling up), "value" (J-curve) or "cash" (when LPs get a multiple back). */
export function milestones(plan, result) {
  if (!result?.ok) return [];
  const g = plan.general;
  const liq = liquidity(result, g.startDate);
  const q = result.series.quarterly;
  const out = [
    { id: "start", kind: "fund", label: "First close", short: "First close", date: g.startDate },
    { id: "ip", kind: "fund", label: "Investing ends", short: "Investing ends", date: addMonthsYm(g.startDate, (g.investmentPeriodYears || 0) * 12) },
  ];
  const backed = backedByMonth(plan, result);
  const total = backed.reduce((t, v) => t + v, 0);
  if (total > 0) {
    let cum = 0, k = 0;
    backed.forEach((v, m) => {
      cum += v;
      while (k < BUILD.length && cum >= BUILD[k].share * total - 1e-6) {
        out.push({ id: `build${Math.round(BUILD[k].share * 100)}`, kind: "build", label: BUILD[k].label, short: `${Math.round(BUILD[k].share * 100)}%`, date: addMonthsYm(g.startDate, m),
          detail: `${Math.round(cum)} ${Math.round(cum) === 1 ? "company" : "companies"} backed` });
        k++;
      }
    });
  }
  if (liq) {
    out.push({ id: "trough", kind: "value", label: "J-curve low", short: `Low ${fmtX(liq.trough.tvpi)}`, date: liq.trough.date, value: liq.trough.tvpi });
    if (liq.tvpiOne) out.push({ id: "tvpi1", kind: "value", label: "TVPI 1.0×", short: "TVPI 1×", date: liq.tvpiOne });
  }
  for (const x of DPI_STEPS) {
    const row = q.find((r) => r.dpi != null && r.dpi >= x);
    if (row) out.push({ id: x === 1 ? "dpi1" : `dpi${x}`, kind: "cash", label: x === 1 ? "Money back (DPI 1.0×)" : `DPI ${x.toFixed(1)}×`, short: x === 1 ? "Money back" : `DPI ${x}×`, date: row.date });
  }
  if (q.length) out.push({ id: "end", kind: "fund", label: g.evergreen ? "End of model" : "Fund ends", short: g.evergreen ? "End of model" : "Fund ends", date: q.at(-1).date });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Where the gross proceeds come from: Light plans by outcome, Advanced plans by allocation. */
export function proceedsByGroup(result) {
  if (!result?.ok) return [];
  return result.allocations.map((a) => ({
    id: a.id, label: a.name, companies: a.initialDeals, capital: a.capital, moic: a.moic ?? 0, proceeds: a.capital * (a.moic ?? 0),
  }));
}

/** The waterfall's tiers, each split between LPs and the GP, plus what's still held at the end. */
export function waterfallTiers(plan, result) {
  if (!result?.ok) return [];
  const wf = result.waterfall, w = plan.waterfall, p = wf.parts;
  const { prefOn, catchupOn } = waterfallTerms(w);
  const band = (b, i) => (wf.bands.length > 1 ? `Carry from ${fmtX(b.fromMultiple, 1)} (${fmtPct(b.rate, 0)})` : `Carry split (${fmtPct(b.rate, 0)})`);
  return [
    { id: "roc", label: "Return of capital", lp: p.roc, gp: 0 },
    ...(prefOn ? [{ id: "pref", label: "Preferred return", lp: p.pref, gp: 0 }] : []),
    ...(catchupOn ? [{ id: "catchup", label: "GP catch-up", lp: p.catchupLp, gp: p.catchupGp }] : []),
    ...wf.bands.map((b, i) => ({ id: `carry-${i}`, label: band(b, i), lp: p.carryLp[i], gp: p.carryGp[i] })),
    ...(wf.clawback > 0 ? [{ id: "clawback", label: "Clawback", lp: wf.clawback, gp: -wf.clawback }] : []),
    ...(wf.unrealized.lp + wf.unrealized.gp > 0.5 ? [{ id: "unrealized", label: "Still held at the end", lp: wf.unrealized.lp, gp: wf.unrealized.gp }] : []),
  ].filter((t) => Math.abs(t.lp) + Math.abs(t.gp) > 0.5);
}

// Same shape as a Light plan's Portfolio group, so both modes read alike.
function advancedPortfolio(plan, result) {
  if (!result?.ok) return null;
  const ccy = plan.general.currency;
  const allocs = result.allocations ?? [];
  const deals = allocs.reduce((t, a) => t + a.initialDeals, 0);
  if (!(deals > 0)) return null;
  const row = (label, value) => ({ label, value, step: "strategy", section: null });
  const held = result.metrics.reserveRatio == null ? null : result.metrics.reserveRatio / (1 + result.metrics.reserveRatio);
  const target = targetStatus(plan, result);
  const own = allocs.reduce((t, a) => t + a.initialDeals * (a.entryOwnership ?? 0), 0) / deals;
  const moics = allocs.map((a) => a.moic).filter((v) => v != null);
  const rows = [
    row("Companies", fmtCount(deals)),
    row("Initial check", fmtMIn(allocs.reduce((t, a) => t + a.initialCapital, 0) / deals, ccy)),
    row("Reserves", held == null ? "—" : fmtPct(held, 0)),
    ...(target ? [row(`Target ${target.label === "Net TVPI" ? "net TVPI" : "gross MOIC"}`, fmtX(target.target))] : []),
    row("Entry ownership", fmtOwn(own)),
    row("Company MOIC", moics.length ? (Math.min(...moics) === Math.max(...moics) ? fmtX(moics[0]) : `${fmtX(Math.min(...moics))}–${fmtX(Math.max(...moics))}`) : "—"),
  ];
  const lead = allocs.reduce((best, a) => (a.capital > (best?.capital ?? -1) ? a : best), null);
  const planned = plan.allocations.find((a) => a.id === lead.id);
  const sector = plan.sectors.find((x) => x.id === planned?.sectorId);
  const entry = sector?.stages[planned.entryStage];
  if (entry) {
    const next = sector.stages[planned.entryStage + 1];
    const funnel = marketFunnel(sector.stages, planned.entryStage);
    rows.push(row(`${entry.name} round`, `${fmtMIn(entry.roundSize, ccy)} at ${fmtMIn(entry.preMoney, ccy)} pre`));
    if (next) rows.push(row(`Raise ${next.name}`, fmtPct(entry.gradRate, 0)));
    rows.push(row("Exits per 100", `${Math.round(funnel.exited)}${funnel.exitRange ? ` at ${fmtMIn(funnel.exitRange[0], ccy)}–${fmtMIn(funnel.exitRange[1], ccy)}` : ""}`));
  }
  return { id: "portfolio", title: "Portfolio", rows };
}
