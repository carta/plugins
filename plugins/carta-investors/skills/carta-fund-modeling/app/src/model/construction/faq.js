// LP questions a model can answer with numbers; every answer is computed from the plan, so it moves with the plan.
import { fmtMIn, fmtX, fmtPct, fmtOwn, fmtYm, fmtYears, fmtCount } from "../../ui/format.js";
import { FEE_BASES, deriveGeneral, gpCommitPctOf, waterfallTerms } from "./plan.js";
import { SCENARIOS, bridge, concentration, liquidity } from "./analysis.js";
import { planFingerprint } from "./monteCarlo.js";
import { whatItTakes } from "./light.js";
import { EVERGREEN_YEARS, termYearsOf } from "./feeTiers.js";

export const FAQ_CATEGORIES = [
  { id: "fund", label: "Fund and terms" },
  { id: "portfolio", label: "Portfolio construction" },
  { id: "fees", label: "Fees and carry" },
  { id: "returns", label: "Returns" },
  { id: "liquidity", label: "Liquidity and pacing" },
  { id: "risk", label: "Risk" },
];

const sum = (xs) => xs.reduce((t, v) => t + v, 0);
const whole = (n) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const plural = (n, one, many = `${one}s`) => `${whole(n)} ${Math.round(n) === 1 ? one : many}`;
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const baseName = (id) => lc((FEE_BASES.find((b) => b.id === id)?.label ?? "commitments").replace(/ \(LPs\)$/, ""));

// Months 0 to 12·y − 1; month 12·y opens the next year.
const through = (series, y, of) => (of > 0 && series ? sum(series.slice(0, Math.min(series.length, y * 12))) / of : null);

/** `extras` carries what's costly to compute: { scenarios, sensitivity, breakeven }. */
export function buildFaq(plan, res, extras = {}) {
  if (!res?.ok) return [];
  const light = plan.mode === "light";
  const g = plan.general, ccy = g.currency, t = res.totals, m = res.metrics;
  const d = deriveGeneral(g);
  const term = termYearsOf(g);
  const liq = liquidity(res, g.startDate);
  const b = bridge(res);
  const conc = light ? null : concentration(res, plan);
  const q = res.series.quarterly;
  const deals = m.initialDeals;
  const carry = t.gpCarryRealized + t.gpCarryUnrealized;
  const profit = res.waterfall.paidOut + res.waterfall.unrealized.lp + res.waterfall.unrealized.gp - res.waterfall.paidIn;
  const { scenarios, sensitivity, breakeven, market = {} } = extras;
  const out = [];
  const add = (id, category, question, answer, figures) => { if (answer) out.push({ id, category, question, answer, figures }); };

  add("size", "fund", "How big is the fund, and how much is the GP committing?",
    `${fmtMIn(t.committed, ccy)} in total commitments: ${fmtMIn(d.lpCommitted, ccy)} from LPs and ${fmtMIn(d.gpCommitted, ccy)} (${fmtPct(gpCommitPctOf(g), 2)}) from the GP.`,
    [{ label: "Fund size", value: fmtMIn(t.committed, ccy) }, { label: "LP commitments", value: fmtMIn(d.lpCommitted, ccy) }, { label: "GP commitment", value: fmtMIn(d.gpCommitted, ccy) }]);

  add("term", "fund", "What are the fund's term and investment period?",
    g.evergreen
      ? `Evergreen, modeled over ${EVERGREEN_YEARS} years, with a ${g.investmentPeriodYears}-year investment period (new investments until ${fmtYm(d.investmentPeriodEnd, null)}).`
      : `A ${term}-year term, ending ${fmtYm(d.endDate, null)}, with a ${g.investmentPeriodYears}-year investment period: new companies are added until ${fmtYm(d.investmentPeriodEnd, null)}.`,
    [{ label: "Term", value: g.evergreen ? "Evergreen" : fmtYears(term) }, { label: "Investment period", value: fmtYears(g.investmentPeriodYears) }]);

  const closes = g.closes ?? [];
  if (!light && closes.length > 0) {
    add("closes", "fund", "How do commitments come in?",
      closes.length === 1 ? `All commitments close at month ${closes[0].month ?? 0}.`
        : `${closes.length} closes: ${closes.map((c) => `${fmtPct(c.pct, 0)} (${fmtMIn(t.committed * c.pct, ccy)}) at month ${c.month}`).join(", ")}. Fees and capital calls start from each close.`);
  }

  const initialCap = t.initialCapital, followCap = t.followOnCapital;
  const checks = res.allocations.filter((a) => a.initialCheck > 0).map((a) => a.initialCheck);
  const avgCheck = deals > 0 ? initialCap / deals : null;
  add("companies", "portfolio", "How many companies will you back, and how big are the first checks?",
    `About ${whole(deals)} companies, with first checks averaging ${fmtMIn(avgCheck, ccy)}${checks.length > 1 ? ` (from ${fmtMIn(Math.min(...checks), ccy)} to ${fmtMIn(Math.max(...checks), ccy)} across allocations)` : ""}, plus about ${whole(m.followOns)} follow-on checks.`,
    [{ label: "Companies", value: whole(deals) }, { label: "Average first check", value: fmtMIn(avgCheck, ccy) }, { label: "Follow-on checks", value: whole(m.followOns) }]);

  const held = m.reserveRatio == null ? null : m.reserveRatio / (1 + m.reserveRatio);
  add("reserves", "portfolio", "How much do you hold back for follow-ons?",
    held == null ? null : `${fmtPct(held, 0)} of invested capital (${fmtMIn(followCap, ccy)}) goes into follow-ons and ${fmtPct(1 - held, 0)} (${fmtMIn(initialCap, ccy)}) into first checks: ${fmtX(m.reserveRatio, 2)} of follow-on capital for every 1.00× of first checks.`,
    [{ label: "First checks", value: fmtMIn(initialCap, ccy) }, { label: "Follow-ons", value: fmtMIn(followCap, ccy) }, { label: "Reserve ratio", value: fmtX(m.reserveRatio, 2) }]);

  if (!light) {
    const withOwn = res.allocations.filter((a) => a.entryOwnership != null && a.initialDeals > 0);
    if (withOwn.length) {
      const entry = sum(withOwn.map((a) => a.initialDeals * a.entryOwnership)) / sum(withOwn.map((a) => a.initialDeals));
      let exitW = 0, exitN = 0;
      for (const a of res.allocations) for (const f of a.funnel) { exitW += f.exited * f.ownership; exitN += f.exited; }
      const atExit = exitN > 0 ? exitW / exitN : null;
      add("ownership", "portfolio", "What ownership do you target, and what are you left with at exit?",
        `${fmtOwn(entry)} at entry on average${atExit != null ? `, and ${fmtOwn(atExit)} on average by the time a company exits, after dilution from later rounds net of follow-ons` : ""}.`,
        [{ label: "At entry", value: fmtOwn(entry) }, ...(atExit != null ? [{ label: "At exit", value: fmtOwn(atExit) }] : [])]);
    }
  }

  const totalCap = sum(res.allocations.map((a) => a.capital));
  if (res.allocations.length > 0 && totalCap > 0) {
    const entryName = (a) => {
      const planned = plan.allocations?.find((x) => x.id === a.id);
      return planned ? plan.sectors?.find((s) => s.id === planned.sectorId)?.stages[planned.entryStage]?.name : null;
    };
    add("allocation", "portfolio", light ? "How is the portfolio split across outcomes?" : "How is capital split across stages and strategies?",
      res.allocations.map((a) => `${a.name}: ${fmtPct(a.capital / totalCap, 0)} of capital (${fmtMIn(a.capital, ccy)}), ${plural(a.initialDeals, "company", "companies")}${!light && entryName(a) ? `, entering at ${entryName(a)}` : ""}, ${fmtX(a.moic, 1)} expected`).join(". ") + ".",
      res.allocations.map((a) => ({ label: a.name, value: fmtPct(a.capital / totalCap, 0) })));
  }

  if (market.entry) {
    const entries = plan.allocations.map((a) => {
      const sector = plan.sectors.find((x) => x.id === a.sectorId);
      const st = sector?.stages[a.entryStage];
      return st ? `${st.name}: ${fmtMIn(st.preMoney, ccy)} pre-money, ${fmtMIn(st.roundSize, ccy)} round` : null;
    }).filter(Boolean);
    add("entryprices", "portfolio", "What entry valuations are you assuming?", `The plan enters at ${[...new Set(entries)].join("; ")}.`);
  }

  const cumInvested = res.series.invest;
  if (cumInvested && t.invested > 0) {
    const at = (y) => fmtPct(through(cumInvested, y, t.invested), 0);
    const ip = g.investmentPeriodYears || 0;
    add("deploy", "portfolio", "How fast will you deploy the fund?",
      `${at(1)} of invested capital goes out in year 1, ${at(2)} by the end of year 2 and ${at(3)} by year 3${ip > 3 ? `; ${at(ip)} by the end of the ${ip}-year investment period` : ""}.`,
      [1, 2, 3, ...(ip > 3 ? [ip] : [])].map((y) => ({ label: `By year ${y}`, value: at(y) })));
  }

  const feeLine = !light && plan.fees?.tiers?.length
    ? ` Fee schedule: ${plan.fees.tiers.map((tier) => {
      const from = Math.ceil((tier.startMonth || 1) / 12), to = tier.endMonth ? Math.ceil(tier.endMonth / 12) : term;
      return `${fmtPct(tier.rate, 2)} of ${baseName(tier.basis)}, years ${from} to ${to}`;
    }).join("; ")}.` : "";
  add("fees", "fees", "What management fees will LPs pay?",
    `${fmtMIn(t.fees, ccy)} over the fund's life: ${fmtPct(t.fees / t.committed, 1)} of commitments, about ${fmtPct(t.fees / t.committed / term, 2)} a year on average.${feeLine}`,
    [{ label: "Total fees", value: fmtMIn(t.fees, ccy) }, { label: "Of commitments", value: fmtPct(t.fees / t.committed, 1) }, { label: "Average a year", value: fmtPct(t.fees / t.committed / term, 2) }]);

  add("expenses", "fees", "What will the fund's operating expenses be?",
    `${fmtMIn(t.expenses, ccy)} over the fund's life: ${fmtPct(t.expenses / t.committed, 2)} of commitments, about ${fmtMIn(t.expenses / term, ccy)} a year.`,
    [{ label: "Total expenses", value: fmtMIn(t.expenses, ccy) }, { label: "A year", value: fmtMIn(t.expenses / term, ccy) }]);

  add("investable", "fees", "How much of LP capital actually gets invested?",
    `${fmtPct(t.invested / t.committed, 1)} of commitments (${fmtMIn(t.invested, ccy)}) reaches companies. Fees and expenses take ${fmtPct((t.fees + t.expenses) / t.committed, 1)} (${fmtMIn(t.fees + t.expenses, ccy)}).`,
    [{ label: "Invested", value: fmtMIn(t.invested, ccy) }, { label: "Fees and expenses", value: fmtMIn(t.fees + t.expenses, ccy) }]);

  const w = plan.waterfall;
  const { prefOn, catchupOn } = waterfallTerms(w);
  const tiers = (w.carryTiers ?? []).length;
  add("carry", "fees", "What are the carry, preferred return and catch-up terms?",
    `${w.type === "european" ? "A European (whole-fund)" : "An American (deal-by-deal)"} waterfall with ${fmtPct(w.carryRate, 0)} carry${tiers ? `, stepping up across ${tiers + 1} tiers` : ""}. ${prefOn
      ? `LPs get a preferred return of ${w.hurdleType === "multiple" ? `${fmtX(w.hurdleMultiple, 2)} their capital` : `${fmtPct(w.preferredReturn, 1)} a year`} first${catchupOn ? `, then the GP catches up at ${fmtPct(w.catchupRate, 0)}` : ", with no catch-up"}.`
      : "There is no preferred return."} ${w.clawback ? "The GP's carry is subject to clawback." : "There is no clawback."}`);

  if (!light && plan.recycling) {
    const r = plan.recycling;
    add("recycling", "fees", "Can the fund recycle proceeds?",
      r.enabled ? `Yes: up to ${fmtPct(r.pctOfProceeds, 0)} of exit proceeds can be reinvested, capped at ${fmtPct(r.capPct, 0)} of commitments (${fmtMIn(t.committed * r.capPct, ccy)}), for ${fmtYears(r.termYears)}. ${t.recycled > 0 ? `${fmtMIn(t.recycled, ccy)} is recycled in this plan.` : ""}`.trim() : "No. Proceeds go back to LPs and aren't reinvested.");
  }

  add("gpcarry", "fees", "How much will the GP earn in carry, and what do fees and carry cost LPs?",
    `${fmtMIn(carry, ccy)} of carry${profit > 0 ? ` (${fmtPct(carry / profit, 1)} of the fund's ${fmtMIn(profit, ccy)} profit)` : " (the fund makes no profit)"}.${b ? ` Of a ${fmtX(b.gross)} gross multiple, fees and expenses take ${fmtX(b.feeDrag)} and carry takes ${fmtX(b.carry)}, leaving LPs ${fmtX(b.net)}.` : ""}`,
    b ? [{ label: "Gross", value: fmtX(b.gross) }, { label: "Management fees", value: `−${fmtX(b.mgmtFees)}` }, { label: "Fund expenses", value: `−${fmtX(b.expenses)}` }, { label: "Carry", value: `−${fmtX(b.carry)}` }, { label: "Net TVPI", value: fmtX(b.net) }] : undefined);

  add("net", "returns", "What net returns do you project?",
    `${fmtX(m.tvpi)} net TVPI (${fmtX(m.dpi)} paid out and ${fmtX(m.rvpi)} still held) and a net IRR of ${m.netIrr == null ? "—" : fmtPct(m.netIrr, 1)}, after fees, expenses and carry.${m.rvpi < 0.005 && !g.evergreen ? " Companies still held when the fund ends are sold at their last-round value, so everything is paid out by then." : ""}`,
    [{ label: "Net TVPI", value: fmtX(m.tvpi) }, { label: "DPI", value: fmtX(m.dpi) }, { label: "RVPI", value: fmtX(m.rvpi) }, { label: "Net IRR", value: m.netIrr == null ? "—" : fmtPct(m.netIrr, 1) }]);

  add("gross", "returns", "What does the portfolio return before fees and carry?",
    `${fmtX(m.grossMoic)} gross MOIC and a gross IRR of ${m.grossIrr == null ? "—" : fmtPct(m.grossIrr, 1)}: ${fmtMIn(t.totalProceeds + t.navEnd, ccy)} of proceeds and remaining value on ${fmtMIn(t.invested, ccy)} invested.`,
    [{ label: "Gross MOIC", value: fmtX(m.grossMoic) }, { label: "Gross IRR", value: m.grossIrr == null ? "—" : fmtPct(m.grossIrr, 1) }]);

  if (market.public) {
    add("publicmarkets", "returns", "How do returns compare with public markets?", `${m.netIrr == null ? "No net IRR" : `${fmtPct(m.netIrr, 1)} net IRR`} and ${fmtX(m.tvpi)} net TVPI over the term.`);
  }

  const target = light ? plan.light?.targetMoic : plan.target?.value;
  const targetMetric = light ? "grossMoic" : plan.target?.metric ?? "grossMoic";
  if (target > 0) {
    const actual = targetMetric === "tvpi" ? m.tvpi : m.grossMoic;
    const gap = actual - target;
    add("target", "returns", "Does the plan reach its return target?",
      `The target is ${fmtX(target)} ${targetMetric === "tvpi" ? "net TVPI" : "gross MOIC"} and the plan projects ${fmtX(actual)}: ${Math.abs(gap) < 0.05 ? "on target" : gap < 0 ? `${fmtX(-gap)} short` : `${fmtX(gap)} above`}.`);
  }

  if (scenarios?.down?.ok && scenarios?.up?.ok) {
    const row = (s) => `${fmtX(s.metrics.tvpi)} net TVPI (${s.metrics.netIrr == null ? "—" : fmtPct(s.metrics.netIrr, 1)} IRR)`;
    const down = scenarios.down.metrics.tvpi;
    // Light shifts outcome multiples and survivors, not rounds raised, so each mode has its own description.
    const how = (id) => { const s = SCENARIOS.find((x) => x.id === id); return lc((light ? s.lightBlurb : s.blurb).replace(/\.$/, "")); };
    add("scenarios", "returns", "What do returns look like if exits disappoint, or beat the plan?",
      `Downside (${how("down")}): ${row(scenarios.down)}. Base: ${row(scenarios.base)}. Upside (${how("up")}): ${row(scenarios.up)}. ${down >= 1 ? "LPs get their capital back even in the downside." : "In the downside LPs don't get all their capital back."}`,
      [{ label: "Downside", value: fmtX(down) }, { label: "Base", value: fmtX(scenarios.base.metrics.tvpi) }, { label: "Upside", value: fmtX(scenarios.up.metrics.tvpi) }]);
  }

  if (light) {
    const w1 = whatItTakes(plan.light, g.committed);
    if (w1 && w1.invested > 0) {
      add("returnfund", "returns", "What does it take to return the fund?",
        `One ${w1.label.toLowerCase()} needs a ${fmtX(w1.multipleToReturnFund, 1)} gross return on the ${fmtMIn(w1.invested, ccy)} invested in it to pay back ${fmtMIn(g.committed, ccy)} on its own. At the ${fmtX(w1.multiple, 0)} assumed, each returns ${fmtMIn(w1.perCompany, ccy)}, so ${w1.needed === 1 ? "one does it" : `it takes ${w1.needed}`}.`);
    }
  } else {
    const rounds = new Map();
    for (const a of res.allocations) {
      const planned = plan.allocations.find((x) => x.id === a.id);
      const sector = plan.sectors.find((s) => s.id === planned?.sectorId);
      if (!sector) continue;
      for (const f of a.funnel) {
        if (!(f.exited > 0.001)) continue;
        const r = rounds.get(f.name) ?? { round: f.name, order: f.stage, exits: 0, proceeds: 0 };
        r.exits += f.exited;
        r.proceeds += f.exited * f.ownership * (sector.stages[f.stage]?.exitValuation ?? 0);
        rounds.set(f.name, r);
      }
    }
    const list = [...rounds.values()].filter((r) => r.proceeds > 0).sort((x, y) => x.order - y.order).map((r) => ({ ...r, each: r.proceeds / r.exits, needed: t.committed / (r.proceeds / r.exits) }));
    if (list.length) {
      add("returnfund", "returns", "How many exits does it take to return the fund?",
        `Returning ${fmtMIn(t.committed, ccy)} takes ${list.map((r) => `about ${fmtCount(r.needed)} ${r.round} exits (each returning ${fmtMIn(r.each, ccy)})`).join(", or ")}. The plan expects ${whole(sum(list.map((r) => r.exits)))} exits in total.`,
        list.map((r) => ({ label: `${r.round} exits needed`, value: fmtCount(r.needed) })));
    }
  }

  if (conc && conc.rows.length) {
    const top = conc.rows.reduce((hi, r) => (r.share > hi.share ? r : hi), conc.rows[0]);
    add("concentration", "returns", "How concentrated are the returns?",
      `${fmtPct(top.share, 0)} of exit proceeds come from ${top.round} exits, which are ${fmtPct(top.exitedShare, 0)} of all exits.`,
      conc.rows.map((r) => ({ label: `${r.round} share of proceeds`, value: fmtPct(r.share, 0) })));
  } else if (light) {
    const groups = res.allocations.map((a) => ({ name: a.name, proceeds: a.capital * (a.moic ?? 0) })).filter((x) => x.proceeds > 0);
    const total = sum(groups.map((x) => x.proceeds));
    if (groups.length && total > 0) {
      const top = groups.reduce((hi, x) => (x.proceeds > hi.proceeds ? x : hi), groups[0]);
      add("concentration", "returns", "How concentrated are the returns?", `${fmtPct(top.proceeds / total, 0)} of gross proceeds come from the "${top.name}" outcome.`);
    }
  }

  if (conc && conc.lossRatio != null) {
    add("loss", "returns", "What share of companies do you expect to fail?",
      `About ${fmtPct(conc.lossRatio, 0)} of companies (${whole(conc.failed)} of ${whole(conc.deals)}) fail along the way; the exits and companies still held carry the returns.`);
  }

  const proceeds = res.series.proceeds;
  if (proceeds && sum(proceeds) > 0) {
    let acc = 0, half = null;
    const total = sum(proceeds);
    for (let i = 0; i < proceeds.length; i++) { acc += proceeds[i]; if (acc >= total / 2) { half = i; break; } }
    if (half != null) {
      const yy = +g.startDate.slice(0, 4) + Math.floor((+g.startDate.slice(5, 7) - 1 + half) / 12);
      add("exittiming", "returns", "When do exits happen?",
        `Half of the ${fmtMIn(total, ccy)} of exit proceeds arrive by ${yy}, about ${fmtYears(Math.round((half / 12) * 10) / 10)} after the fund starts.`);
    }
  }

  const callAt = (y) => through(res.series.calls, y, t.committed);
  add("calls", "liquidity", "How quickly will you call capital?",
    `${fmtPct(callAt(1), 0)} of commitments is called by the end of year 1, ${fmtPct(callAt(3), 0)} by year 3 and ${fmtPct(callAt(5), 0)} by year 5. In total ${fmtMIn(t.called, ccy)} (${fmtPct(t.called / t.committed, 0)}) is called, including for fees and expenses.`,
    [1, 3, 5].map((y) => ({ label: `Called by year ${y}`, value: fmtPct(callAt(y), 0) })));

  if (q.length) {
    const first = q.find((r) => r.lpDist > 0);
    const at = (month) => q.find((r) => r.month >= month);
    const y5 = at(60), y10 = at(120);
    add("distributions", "liquidity", "When do LPs start getting cash back?",
      `${first ? `The first distribution comes around ${fmtYm(first.date, null)}.` : "LPs are not paid in cash within the term."}${y5?.dpi != null ? ` DPI is ${fmtX(y5.dpi)} at year 5` : ""}${y10?.dpi != null ? ` and ${fmtX(y10.dpi)} at year 10` : ""}.`,
      [...(y5?.dpi != null ? [{ label: "DPI at year 5", value: fmtX(y5.dpi) }] : []), ...(y10?.dpi != null ? [{ label: "DPI at year 10", value: fmtX(y10.dpi) }] : [])]);
  }

  if (liq) {
    add("jcurve", "liquidity", "How deep is the J-curve, and when does it recover?",
      `Net TVPI bottoms at ${fmtX(liq.trough.tvpi)} around ${fmtYm(liq.trough.date, null)}. ${liq.tvpiOne ? `It passes 1.0× in ${fmtYm(liq.tvpiOne, null)}.` : "It doesn't reach 1.0× within the term."} The most cash LPs are out of pocket at once is ${fmtMIn(-liq.deepestCash.amount, ccy)} (${fmtPct(-liq.deepestCash.amount / t.committed, 0)} of commitments), in ${fmtYm(liq.deepestCash.date, null)}.`,
      [{ label: "Low point", value: fmtX(liq.trough.tvpi) }, { label: "Peak cash out", value: fmtMIn(-liq.deepestCash.amount, ccy) }]);
    add("moneyback", "liquidity", "When do LPs get their money back?",
      liq.dpiOne ? `Cash paid out first equals what LPs paid in (DPI 1.0×) in ${fmtYm(liq.dpiOne, null)}.` : `Not within the term: DPI ends at ${fmtX(m.dpi)}, with ${fmtX(m.rvpi)} of value still held.`);
  }

  if (sensitivity?.rows?.length) {
    const top = sensitivity.rows.slice(0, 3);
    add("drivers", "risk", "What are the biggest drivers of returns?",
      `Moving each assumption on its own, the largest swings in net TVPI are: ${top.map((r) => `${lc(r.label)} (${r.lowLabel} to ${r.highLabel}) moves it from ${fmtX(r.low)} to ${fmtX(r.high)}`).join("; ")}. The plan sits at ${fmtX(sensitivity.base)}.`,
      top.map((r) => ({ label: r.label, value: `${fmtX(r.low)} to ${fmtX(r.high)}` })));
    const exits = sensitivity.rows.find((r) => r.id === "exits");
    if (exits) add("exitsens", "risk", "How sensitive are returns to exit valuations?", `A 25% drop in every exit valuation takes net TVPI to ${fmtX(exits.low)}; a 25% rise takes it to ${fmtX(exits.high)}.`);
    const fees = sensitivity.rows.find((r) => r.id === "fees");
    if (fees) add("feesens", "risk", "How much do fees matter?", `A 25% higher management fee rate lowers net TVPI to ${fmtX(fees.high)}; a 25% lower rate lifts it to ${fmtX(fees.low)}.`);
  }

  if (breakeven) {
    add("breakeven", "risk", "How bad do exits have to get before LPs lose money?",
      breakeven.already ? `LPs already get back less than they paid in: net TVPI is ${fmtX(breakeven.base)}.`
        : breakeven.factor == null ? "Even if exit values fell by 98%, net TVPI would stay above 1.0×."
          : `Every exit valuation would have to fall about ${fmtPct(breakeven.drop, 0)} before net TVPI drops to 1.0× (from ${fmtX(breakeven.base)} today).`);
  }

  const run = plan.monteCarlo?.lastRun?.base?.summary;
  if (run?.net) {
    const stale = plan.monteCarlo.lastRun.fingerprint !== planFingerprint(plan);
    add("montecarlo", "risk", "What is the range of outcomes across many simulated funds?",
      `Across the simulated funds, net TVPI is ${fmtX(run.net.p10)} in a bad case (10th percentile), ${fmtX(run.net.p50)} in the middle and ${fmtX(run.net.p90)} in a good case (90th).${run.chanceTarget != null ? ` The chance of reaching the target is ${fmtPct(run.chanceTarget, 0)}.` : ""}${stale ? " This is from an earlier run; the plan has changed since." : ""}`,
      [{ label: "P10", value: fmtX(run.net.p10) }, { label: "P50", value: fmtX(run.net.p50) }, { label: "P90", value: fmtX(run.net.p90) }]);
  }

  for (const item of out) {
    const cmp = { net: market.net, fees: market.fees, expenses: market.expenses, entryprices: market.entry, publicmarkets: market.public }[item.id];
    if (cmp) item.market = cmp;
  }
  return out;
}

export function faqText(items) {
  return items.map((i) => `${i.question}\n${i.answer}${i.market ? `\nVersus the market: ${i.market.text}` : ""}`).join("\n\n");
}
