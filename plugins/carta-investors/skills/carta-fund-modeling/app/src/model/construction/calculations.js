// Step-by-step working for the model's figures; every input is read from the plan or its result so the working always matches.
import { expenseSchedule } from "./feeTiers.js";
import { fmtFullIn, fmtX, fmtPct, fmtYm } from "../../ui/format.js";
import { FEE_BASES, deriveGeneral, effectiveGeneral, waterfallTerms } from "./plan.js";
import { bridge, liquidity, calendarPeriods } from "./analysis.js";
import { tierWindow } from "./feeTiers.js";
import { lightFees, whatItTakes } from "./light.js";
import { waterfallTiers } from "./summary.js";

export const CALC_CATEGORIES = [
  { id: "returns", label: "Returns" },
  { id: "capital", label: "Capital and companies" },
  { id: "fees", label: "Fees and expenses" },
  { id: "companies", label: "Company math" },
  { id: "waterfall", label: "Waterfall" },
  { id: "timing", label: "Timing" },
];

const sum = (xs) => xs.reduce((t, v) => t + v, 0);
const pct = (v, d = 2) => fmtPct(v, d);
const mult = (v) => fmtX(v, 2);
const count = (n) => (n == null ? "—" : Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const yrs = (months) => { const y = months / 12; return `${Number.isInteger(y) ? y : y.toFixed(2)} ${y === 1 ? "year" : "years"}`; };
const baseName = (id) => { const l = FEE_BASES.find((b) => b.id === id)?.label ?? id; return l.charAt(0).toLowerCase() + l.slice(1); };

/** A line of working: `op` joins it to the running result ("" for the first line). */
const step = (op, label, value) => ({ op, label, value });

// `rate` is annual; flows are dated in months from the start.
function npv(flows, rate) {
  return flows.reduce((s, [t, v]) => s + v / Math.pow(1 + rate, t / 12), 0);
}

/** The LPs' (net) or the portfolio's (gross) monthly cash flows, as the IRR sees them. */
function flowsOf(res, side) {
  const s = res.series, T = res.months, out = [];
  for (let t = 0; t <= T; t++) {
    if (side === "net") { if (s.calls[t]) out.push([t, -s.calls[t]]); if (s.lpDist[t]) out.push([t, s.lpDist[t]]); }
    else { if (s.invest[t]) out.push([t, -s.invest[t]]); if (s.proceeds[t]) out.push([t, s.proceeds[t]]); }
  }
  const end = side === "net" ? res.waterfall.unrealized.lp : res.totals.navEnd;
  if (end) out.push([T, end]);
  return out;
}

/** Every calculation the plan can show; `steps` are lines of working ending in `result`, and `value` is that result as a number, for checking. */
export function calculations(plan, res) {
  if (!res?.ok) return [];
  const light = plan.mode === "light";
  const g = plan.general, ccy = g.currency, t = res.totals, m = res.metrics, wf = res.waterfall;
  // Sub-dollar residue (a present value of −0.0003) shows as $0.
  const $ = (v) => fmtFullIn(Math.abs(v) < 0.5 ? 0 : v, ccy);
  const out = [];
  const add = (e) => { if (e) out.push(e); };

  add({
    id: "tvpi", category: "returns", title: "Net TVPI", question: "How is net TVPI calculated?",
    formula: "Net TVPI = (paid out to LPs + LPs' share of what's still held) ÷ capital paid in",
    steps: [step("", "Paid out to LPs", $(t.lpDistributed)), step("+", "LPs' share of what's still held", $(wf.unrealized.lp)), step("÷", "Capital paid in", $(t.called))],
    result: mult(m.tvpi), value: m.tvpi,
    note: "Paid in is every capital call, including the GP's own commitment and the calls that pay fees and expenses.",
  });
  add({
    id: "dpi", category: "returns", title: "DPI", question: "How is DPI calculated?",
    formula: "DPI = paid out to LPs ÷ capital paid in",
    steps: [step("", "Paid out to LPs", $(t.lpDistributed)), step("÷", "Capital paid in", $(t.called))],
    result: mult(m.dpi), value: m.dpi,
  });
  add({
    id: "rvpi", category: "returns", title: "RVPI", question: "How is RVPI (value still held) calculated?",
    formula: "RVPI = LPs' share of what's still held ÷ capital paid in. Net TVPI = DPI + RVPI.",
    steps: [step("", "LPs' share of what's still held", $(wf.unrealized.lp)), step("÷", "Capital paid in", $(t.called))],
    result: mult(m.rvpi), value: m.rvpi,
    note: g.evergreen ? "An evergreen fund keeps its holdings, valued at their last round." : "The fund sells what it still holds when the term ends, so nothing is left at the end.",
  });
  add({
    id: "moic", category: "returns", title: "Gross MOIC", question: "How is gross MOIC calculated?",
    formula: "Gross MOIC = (exit proceeds + value of companies still held) ÷ capital invested in companies",
    steps: [step("", "Exit proceeds", $(t.totalProceeds)), step("+", "Value of companies still held", $(t.navEnd)), step("÷", "Invested in companies", $(t.invested))],
    result: mult(m.grossMoic), value: m.grossMoic,
    note: "Gross means before fees, expenses and carry: it's what the portfolio itself earns.",
  });
  for (const side of ["net", "gross"]) {
    const rate = side === "net" ? m.netIrr : m.grossIrr;
    if (rate == null) continue;
    const flows = flowsOf(res, side);
    const out_ = -sum(flows.filter(([, v]) => v < 0).map(([, v]) => v)), in_ = sum(flows.filter(([, v]) => v > 0).map(([, v]) => v));
    const net = side === "net";
    add({
      id: `${side}Irr`, category: "returns", title: net ? "Net IRR" : "Gross IRR", question: `How is ${net ? "net" : "gross"} IRR calculated?`,
      formula: `${net ? "Net" : "Gross"} IRR is the yearly rate at which the present value of every ${net ? "LP cash flow (calls out, distributions and remaining value in)" : "portfolio cash flow (investments out, proceeds and remaining value in)"} adds to zero.`,
      steps: [
        step("", `${flows.length} monthly cash flows: money ${net ? "called from LPs" : "invested"}`, `−${$(out_)}`),
        step("+", net ? "Paid back to LPs, including what's still held" : "Proceeds, including what's still held", $(in_)),
        step("", `Discounted at ${pct(rate)} a year, they add to`, $(npv(flows, rate))),
      ],
      result: pct(rate, 1), value: rate,
      note: "Each flow is discounted by (1 + IRR) raised to its age in years. The rate is found by search, starting at 0%, so it can't land on a far-off second answer.",
    });
  }
  const b = bridge(res);
  if (b) {
    add({
      id: "bridge", category: "returns", title: "Gross to net", question: "How does gross MOIC become net TVPI?",
      formula: "Net TVPI = gross MOIC − fee drag − expense drag − carry − timing, each as a multiple of capital paid in",
      steps: b.steps.map((s, i) => step(i === 0 ? "" : "−", s.label, fmtX(Math.abs(s.value), 3))).slice(0, -1),
      result: mult(b.net), value: b.net,
      note: "Fees and expenses are drag because they're called from LPs but never invested. Carry is the GP's share of the profit. Timing covers cash that sits uninvested.",
    });
  }

  const ahead = !light && plan.recycling?.enabled && plan.recycling.ahead;
  add({
    id: "investable", category: "capital", title: "Investable capital", question: "How much of the fund can be invested?",
    formula: `Investable = commitments − management fees − fund expenses${ahead ? " + recycled proceeds" : ""}`,
    steps: [step("", "Commitments", $(t.committed)), step("−", "Management fees", $(t.fees)), step("−", "Fund expenses", $(t.expenses)), ...(ahead ? [step("+", "Recycled proceeds", $(t.recycled))] : [])],
    result: $(t.investable), value: t.investable,
    note: "Fees depend on what's invested and what's invested depends on fees, so the model repeats the sum until the two agree.",
  });
  const calledSteps = [step("", "Invested in companies", $(t.invested)), step("+", "Management fees", $(t.fees)), step("+", "Fund expenses", $(t.expenses))];
  if (t.cashLeft > 0.5) calledSteps.push(step("+", "Cash called but not invested", $(t.cashLeft)));
  if (t.recycled > 0.5) calledSteps.push(step("−", "Investments paid from recycled proceeds", $(t.recycled)));
  add({
    id: "called", category: "capital", title: "Capital called", question: "How much capital is called from partners?",
    formula: "Capital called = what's invested + fees + expenses, less what recycled proceeds pay for",
    steps: calledSteps, result: $(t.called), value: t.called,
    note: `Calls go out ${g.callFrequency === "upfront" ? "at each close" : `at the start of each ${g.callFrequency === "annual" ? "year" : g.callFrequency === "semiannual" ? "half-year" : "quarter"} for that period's needs`}. ${pct(t.committed > 0 ? t.called / t.committed : 0, 1)} of commitments is called.`,
  });
  add({
    id: "reserves", category: "capital", title: "Reserve ratio", question: "How is the reserve ratio calculated?",
    formula: "Reserve ratio = follow-on capital ÷ first-check capital",
    steps: [step("", "Follow-on capital", $(t.followOnCapital)), step("÷", "First-check capital", $(t.initialCapital))],
    result: mult(m.reserveRatio), value: m.reserveRatio,
    note: `So ${pct(t.followOnCapital / (t.initialCapital + t.followOnCapital), 1)} of what's invested goes into follow-ons.`,
  });
  if (!light) {
    for (const a of res.allocations) {
      if (!(a.initialDeals > 0)) continue;
      const perCo = a.capital / a.initialDeals;
      const planned = plan.allocations.find((x) => x.id === a.id);
      add({
        id: `companies-${a.id}`, category: "capital", title: `Companies: ${a.name}`, question: `How is the number of companies in ${a.name} worked out?`,
        formula: "Companies = the allocation's capital ÷ what one company costs (first check + expected follow-ons)",
        steps: [
          step("", `Investable capital × ${pct(planned?.capitalPct ?? 1, 1)} for ${a.name}`, $(a.capital)),
          step("÷", `First check ${$(a.initialCheck)} + expected follow-ons ${$(a.followOnCapital / a.initialDeals)}`, $(perCo)),
        ],
        result: count(a.initialDeals), value: a.initialDeals,
        note: "Expected follow-ons weight each follow-on check by the chance the company raises that round and that you take part. That's why the count can be a fraction.",
      });
      if (planned?.checkMode === "ownership") {
        const sector = plan.sectors.find((s) => s.id === planned.sectorId);
        const st = sector?.stages[planned.entryStage];
        if (st) add({
          id: `check-${a.id}`, category: "capital", title: `First check: ${a.name}`, question: `How is the first check in ${a.name} sized?`,
          formula: "First check = target ownership × post-money valuation (pre-money + round size)",
          steps: [step("", "Target ownership", pct(planned.entryOwnership)), step("×", `${st.name} post-money (${$(st.preMoney)} + ${$(st.roundSize)})`, $(st.preMoney + st.roundSize))],
          result: $(a.initialCheck), value: a.initialCheck,
        });
      }
    }
  } else {
    const l = plan.light;
    add({
      id: "companies-light", category: "capital", title: "Companies and checks", question: "How much goes into first checks and follow-ons?",
      formula: "First checks = companies × check size; follow-ons fill the rest of what's invested",
      steps: [step("", "Companies", count(l.companies)), step("×", "First check", $(l.initialCheck)), step("=", "First checks", $(t.initialCapital)), step("+", "Follow-ons", $(t.followOnCapital))],
      result: $(t.invested), value: t.invested,
    });
  }

  const gEff = effectiveGeneral(plan);
  const feePlan = light ? lightFees(plan.light, gEff) : { tiers: plan.fees.tiers, expenses: expenseSchedule(plan.fees, gEff) };
  const lpCommitted = deriveGeneral(gEff).lpCommitted;
  const tierRows = (feePlan?.tiers ?? []).map((tier) => {
    const [from, to] = tierWindow(tier, res.months);
    const months = Math.max(0, Math.min(to, res.months + 1) - from);
    const paid = t.feesByTier?.[tier.id] ?? 0;
    const avg = tier.rate > 0 && months > 0 ? paid / (tier.rate * months / 12) : 0;
    return { tier, months, paid, avg };
  }).filter((r) => r.paid > 0.5);
  if (tierRows.length) {
    add({
      id: "fees", category: "fees", title: "Management fees", question: "How are management fees calculated?",
      formula: "Each tier: yearly rate × the fee basis, charged monthly (rate ÷ 12) for the months the tier runs",
      steps: tierRows.flatMap((r, i) => [
        step(i === 0 ? "" : "+", `${pct(r.tier.rate)} a year × ${baseName(r.tier.basis)} (${r.tier.basis === "committed" && Math.abs(r.avg - lpCommitted) < 1 ? "" : "average "}${$(r.avg)}) × ${yrs(r.months)}`, $(r.paid)),
      ]),
      result: $(t.fees), value: t.fees,
      note: `Fees on commitments are charged on LP commitments only (${$(lpCommitted)}): the GP doesn't pay fees on its own commitment. Fees on a basis that changes over time, such as invested capital or NAV, use that month's basis, so the working shows the average.`,
    });
  }
  const expRows = (feePlan?.expenses ?? []).map((x) => {
    const from = Math.round(x.startYear * 12), to = Math.min(Math.round(x.endYear * 12), res.months + 1);
    const months = Math.max(0, to - from);
    return { x, months, total: (x.annualAmount / 12) * months };
  }).filter((r) => r.total > 0.5);
  if (expRows.length) {
    add({
      id: "expenses", category: "fees", title: "Fund expenses", question: "How are fund expenses calculated?",
      formula: "Each expense: yearly amount ÷ 12 for every month it runs",
      steps: expRows.map((r, i) => step(i === 0 ? "" : "+", `${r.x.name || "Expense"}: ${$(r.x.annualAmount)} a year × ${yrs(r.months)}`, $(r.total))),
      result: $(t.expenses), value: t.expenses,
    });
  }

  if (!light) {
    for (const a of res.allocations) {
      const planned = plan.allocations.find((x) => x.id === a.id);
      const sector = plan.sectors.find((s) => s.id === planned?.sectorId);
      if (!sector || !(a.initialDeals > 0) || !a.funnel.length) continue;
      const stages = sector.stages;
      const perCo = (f) => f.reached / a.initialDeals;
      if (a.funnel.length > 1) {
        const [f0, f1] = a.funnel;
        const nx = stages[f1.stage];
        const post = nx.preMoney + nx.roundSize;
        const fo = planned.followOns?.[f1.stage];
        const p = fo && fo.mode !== "none" ? fo.participation ?? 0 : 0;
        const amt = f1.check ?? 0;
        const keep = 1 - (nx.dilutionPct || 0);
        const without = f0.ownership * (nx.preMoney / post) * keep;
        const withFo = (f0.ownership * (nx.preMoney / post) + amt / post) * keep;
        add({
          id: `ownership-${a.id}`, category: "companies", title: `Ownership after a round: ${a.name}`, question: `How does ownership change from ${f0.name} to ${f1.name} in ${a.name}?`,
          formula: "New ownership = (old ownership × pre-money ÷ post-money + follow-on ÷ post-money) × (1 − extra dilution), blended by how often you follow on",
          steps: [
            step("", `Ownership at ${f0.name}`, pct(f0.ownership)),
            step("×", `${f1.name} pre-money ÷ post-money (${$(nx.preMoney)} ÷ ${$(post)})`, (nx.preMoney / post).toFixed(4)),
            step("×", `1 − extra dilution (${pct(nx.dilutionPct || 0, 1)})`, keep.toFixed(4)),
            step("=", "If you don't follow on", pct(without)),
            ...(amt > 0 ? [step("", `If you invest ${$(amt)} (adds ${$(amt)} ÷ ${$(post)}, less dilution)`, pct(withFo))] : []),
          ],
          result: pct(f1.ownership), value: f1.ownership,
          resultLabel: amt > 0 ? `Blended: ${pct(p, 0)} × ${pct(withFo)} + ${pct(1 - p, 0)} × ${pct(without)}` : `Ownership at ${f1.name}`,
          note: "Pro-rata means investing your ownership share of the new round, which keeps your stake level before any extra dilution. Later rounds work the same way.",
        });
      }
      const lastIdx = a.funnel.length - 1;
      add({
        id: `reach-${a.id}`, category: "companies", title: `Chance of reaching each round: ${a.name}`, question: `How likely is a company in ${a.name} to reach each round?`,
        formula: "Chance of reaching a round = the product of the chances of raising each round before it",
        steps: a.funnel.slice(0, -1).map((f, i) => {
          const st = stages[f.stage];
          return step(i === 0 ? "" : "×", `Raises after ${f.name} (${pct(st.gradRate || 0, 1)}), so reaches ${a.funnel[i + 1].name}`, pct(perCo(a.funnel[i + 1])));
        }),
        result: pct(perCo(a.funnel[lastIdx])), value: perCo(a.funnel[lastIdx]),
        resultLabel: `Chance of reaching ${a.funnel[lastIdx].name}`,
        note: `Of ${count(a.initialDeals)} companies, about ${count(a.funnel[lastIdx].reached)} reach ${a.funnel[lastIdx].name}. At each round the rest exit (at that round's exit rate) or fail.`,
      });
      const rows = a.funnel.filter((f) => f.exited > 0).map((f) => {
        const st = stages[f.stage];
        return { f, st, value: perCo(f) * (st.exitRate || 0) * f.ownership * (st.exitValuation || 0) };
      });
      const proceeds = sum(rows.map((r) => r.value)), invested = a.capital / a.initialDeals;
      add({
        id: `moic-${a.id}`, category: "companies", title: `Expected multiple: ${a.name}`, question: `How is the expected multiple for ${a.name} worked out?`,
        formula: "Expected multiple = Σ over rounds (chance of reaching × exit rate × ownership × exit value) ÷ what one company costs",
        steps: [
          ...rows.map((r, i) => step(i === 0 ? "" : "+", `${r.f.name}: ${pct(perCo(r.f), 1)} reach × ${pct(r.st.exitRate, 0)} exit × ${pct(r.f.ownership)} × ${$(r.st.exitValuation)}`, $(r.value))),
          step("÷", "What one company costs (first check + expected follow-ons)", $(invested)),
        ],
        result: mult(a.moic), value: a.moic,
        note: "This is the probability-weighted average across every path a company can take. Most companies return nothing; a few large exits carry the multiple.",
      });
    }
  } else {
    const w = whatItTakes(plan.light, g.committed);
    if (w?.multipleToReturnFund != null) {
      add({
        id: "returnfund", category: "companies", title: "Return the fund", question: "What exit does one unicorn need to return the whole fund?",
        formula: "Multiple needed = fund size ÷ what's invested in one unicorn (first check + follow-on)",
        steps: [step("", "Fund size", $(g.committed)), step("÷", "Invested in one unicorn", $(w.invested))],
        result: fmtX(w.multipleToReturnFund, 1), value: w.multipleToReturnFund,
        note: `At your ${fmtX(w.multiple, 0)} unicorn multiple, one unicorn returns ${fmtX(w.fundMultiple)} the fund.`,
      });
    }
    const groups = res.allocations.filter((x) => x.capital > 0);
    if (groups.length) {
      const planned = sum(groups.map((x) => x.capital * (x.moic ?? 0)));
      const late = planned - (t.totalProceeds + t.navEnd);
      add({
        id: "outcomes", category: "companies", title: "Gross proceeds by outcome", question: "How do the outcomes add up to gross proceeds?",
        formula: "Each outcome: capital invested in it × its multiple. Gross MOIC = total ÷ capital invested.",
        steps: [
          ...groups.map((x, i) => step(i === 0 ? "" : "+", `${x.name}: ${count(x.initialDeals)} companies, ${$(x.capital)} × ${fmtX(x.moic ?? 0, 2)}`, $(x.capital * (x.moic ?? 0)))),
          ...(Math.abs(late) > 0.5 ? [step(late > 0 ? "−" : "+", "Exits due after the fund ends, sold at their value then instead", $(Math.abs(late)))] : []),
          step("÷", "Capital invested", $(t.invested)),
        ],
        result: mult(m.grossMoic), value: m.grossMoic,
      });
    }
  }

  const tiers = waterfallTiers(plan, res);
  if (tiers.length) {
    const w = plan.waterfall;
    const { prefOn, catchupOn } = waterfallTerms(w);
    add({
      id: "waterfall", category: "waterfall", title: "The waterfall, tier by tier", question: "How is the money split between LPs and the GP?",
      formula: w.type === "european"
        ? `Whole-fund order: LPs get their capital back, ${prefOn ? `then a preferred return (${w.hurdleType === "multiple" ? `${fmtX(w.hurdleMultiple, 2)} their capital` : `${pct(w.preferredReturn, 1)} a year, compounding`}), ${catchupOn ? `then the GP catches up at ${pct(w.catchupRate, 0)}, ` : ""}` : ""}then the rest is split ${pct(1 - w.carryRate, 0)} / ${pct(w.carryRate, 0)}.`
        : `Deal by deal: each exit returns its own cost to LPs, then the GP takes ${pct(w.carryRate, 0)} of that deal's gain.${w.clawback ? " At the end, the GP gives back any carry above its share of the whole fund's profit." : ""}`,
      steps: tiers.map((x, i) => step(i === 0 ? "" : "+", `${x.label}: LPs ${$(x.lp)}, GP ${$(x.gp)}`, $(x.lp + x.gp))),
      result: $(wf.lp + wf.gp), value: wf.lp + wf.gp,
      note: `LPs get ${$(wf.lp)} and the GP ${$(wf.gp)}. LPs here include the GP's own commitment, which is treated like LP money.`,
    });
    const profit = wf.lp + wf.gp - wf.paidIn;
    if (profit > 0) {
      add({
        id: "carryshare", category: "waterfall", title: "GP's share of the profit", question: "What share of the fund's profit does the GP get?",
        formula: "GP share = carry ÷ (everything paid out and still held − capital paid in)",
        steps: [step("", "GP carry", $(wf.gp)), step("÷", `Fund profit (${$(wf.lp + wf.gp)} − ${$(wf.paidIn)})`, $(profit))],
        result: pct(wf.gp / profit, 1), value: wf.gp / profit,
        note: catchupOn && (w.catchupRate ?? 0) >= 1 ? "With a full catch-up, the GP ends at its carry rate once the fund clears the catch-up." : "Below the headline carry rate when a preferred return without a full catch-up keeps part of the profit for LPs.",
      });
    }
  }

  const liq = liquidity(res, g.startDate);
  if (liq) {
    const q = res.series.quarterly;
    const back = q.find((r) => r.dpi != null && r.dpi >= 1);
    if (back) add({
      id: "moneyback", category: "timing", title: "Money back", question: "When do LPs get their money back?",
      formula: "Money back is the first quarter in which everything paid to LPs reaches everything they've paid in (DPI 1.0×)",
      steps: [step("", `Paid out to LPs by ${fmtYm(back.date)}`, $(back.lpDist)), step("÷", `Paid in by ${fmtYm(back.date)}`, $(back.called))],
      result: fmtYm(back.date), value: back.month,
      note: `DPI that quarter: ${mult(back.dpi)}.`,
    });
    const deepest = q.reduce((lo, r) => (r.lpDist - r.called < lo.lpDist - lo.called ? r : lo), q[0]);
    add({
      id: "jcurve", category: "timing", title: "Deepest point of the J-curve", question: "How much are LPs out of pocket at the worst point?",
      formula: "LPs' net cash = paid out to LPs − paid in, at its lowest quarter",
      steps: [step("", `Paid out to LPs by ${fmtYm(deepest.date)}`, $(deepest.lpDist)), step("−", `Paid in by ${fmtYm(deepest.date)}`, $(deepest.called))],
      result: $(deepest.lpDist - deepest.called), value: deepest.lpDist - deepest.called,
      note: `That's ${pct(t.committed > 0 ? (deepest.called - deepest.lpDist) / t.committed : 0, 1)} of commitments, in ${fmtYm(deepest.date)}.`,
    });
  }
  return out;
}

/** Year-by-year (or quarter-by-quarter) cash flows, with a totals row that ties to the headline figures. */
export function ledger(res, startDate, by = "year") {
  if (!res?.ok) return { rows: [], totals: null };
  const s = res.series, T = res.months;
  const rows = [];
  for (const { from, to, year, quarter } of calendarPeriods(startDate, T + 1, by === "quarter" ? 3 : 12)) {
    const span = (a) => sum(a.slice(from, to));
    const q = s.quarterly.filter((r) => r.month <= to - 1).at(-1);
    rows.push({
      key: from,
      label: quarter ? `${year} Q${quarter}` : String(year),
      called: span(s.calls), initial: span(s.initialInv), followOn: span(s.followInv), fees: span(s.fees), expenses: span(s.expenses),
      proceeds: span(s.proceeds), lpDist: span(s.lpDist), gpCarry: span(s.gpCarry),
      nav: q?.nav ?? 0, dpi: q?.dpi ?? null, tvpi: q?.tvpi ?? null,
    });
  }
  const tot = (k) => sum(rows.map((r) => r[k]));
  return {
    rows,
    totals: {
      called: tot("called"), initial: tot("initial"), followOn: tot("followOn"), fees: tot("fees"), expenses: tot("expenses"),
      proceeds: tot("proceeds"), lpDist: tot("lpDist"), gpCarry: tot("gpCarry"), nav: res.totals.navEnd, dpi: res.metrics.dpi, tvpi: res.metrics.tvpi,
    },
  };
}
