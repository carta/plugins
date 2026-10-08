import { useEffect, useMemo, useState } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { Btn, Badge, InfoTip, Segmented } from "../../ui/components.jsx";
import { fmtMIn, fmtX, fmtPct } from "../../ui/format.js";
import { modeLabel, stepLabel } from "../../model/construction/plan.js";
import { SCENARIOS, scaled, bridge, liquidity, runScenarios, tornado, irrOverTime, dollarFlow, economicsByYear, roundOutcomes, ownershipPaths, exitCurve, breakevenExits, dpiSensitivity, EXIT_FACTORS } from "../../model/construction/analysis.js";
import { planFingerprint } from "../../model/construction/monteCarlo.js";
import { headline, targetStatus, milestones, proceedsByGroup, waterfallTiers } from "../../model/construction/summary.js";
import { trackClick } from "../../analytics.js";
import { ReturnsChart, DeploymentChart } from "./charts.jsx";
import { BridgeChart, PacingChart, TornadoChart } from "./ResultsCharts.jsx";
import { PortfolioTab } from "./ResultsDashboard.jsx";
import LightRisk from "./LightRisk.jsx";
import { whatItTakes } from "../../model/construction/light.js";
import { EVERGREEN_YEARS } from "../../model/construction/feeTiers.js";
import { Histogram } from "./MonteCarloCharts.jsx";
import { StatStrip, ValueBuildChart, ProceedsBreakdown, OutcomeMix, Milestones, WaterfallBar, IrrChart, DollarFlow, RoundOutcomes, OwnershipPath, CostsByYear, ProfitSplit, ExitCurve, ScenarioLines, DpiSensitivity } from "./ModelCharts.jsx";
import { StatusTag } from "./PlanList.jsx";
import LpFaq from "./LpFaq.jsx";
import CalculationsTab from "./CalculationsTab.jsx";
import Assumptions from "./AssumptionsPanel.jsx";
import { cellNum, fmtYm } from "./fields.jsx";
import { MonteCarloDisclaimer } from "./MonteCarloAbout.jsx";

const subtle = "var(--ink-color-global-text-subtle)";
const irr = (v) => (v == null ? "—" : fmtPct(v, 1));
const when = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const DEFS = {
  tvpi: "Net TVPI: what LPs get back (paid out plus still held) for every 1.00× they paid in, after fees, expenses and carry.",
  irr: "Net IRR: the LPs' annual return, taking into account when money is called and paid back.",
  dpi: "DPI: cash actually paid out to LPs for every 1.00× they paid in. DPI 1.0× means LPs have their money back.",
  moic: "Gross MOIC: what the portfolio returns on the capital invested in companies, before fees, expenses and carry.",
  companies: "The number of companies the fund backs with a first check. The reserve ratio is follow-on capital for every 1.00× of first checks.",
  size: "Total commitments from LPs and the GP.",
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "returns", label: "Returns & cash" },
  { id: "portfolio", label: "Portfolio" },
  { id: "economics", label: "Economics" },
  { id: "risk", label: "Risk" },
  { id: "faq", label: "LP due diligence" },
  { id: "math", label: "Calculations" },
];

const MV_CSS = `
.mv-wrap { container-type: inline-size; }
.mv-body { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: var(--ink-spacing-global-horizontal-xlarge); align-items: start; }
.mv-aside { position: sticky; top: 72px; }
.mv-strip { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); padding: 0; margin-bottom: 12px; overflow: hidden; }
.mv-strip-cell { padding: 12px 16px; min-width: 0; box-shadow: 1px 0 0 var(--ink-color-global-border-subtle), 0 1px 0 var(--ink-color-global-border-subtle); }
.mv-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--ink-color-global-border-subtle); margin-bottom: 16px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.mv-tab { font: inherit; font-size: 14px; padding: 10px 14px; border: 0; background: none; cursor: pointer; white-space: nowrap;
  color: var(--ink-color-global-text-subtle); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.mv-tab:hover { color: var(--ink-color-global-text-default); }
.mv-tab[aria-selected="true"] { color: var(--ink-color-global-text-default); font-weight: 600; border-bottom-color: var(--ink-color-global-text-default); }
.mv-tab:focus-visible { outline: 2px solid var(--ink-color-global-border-focus-default); outline-offset: 2px; }
.mv-pair { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@container (max-width: 1000px) { .mv-strip[data-n="6"] { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 600px) { .mv-strip[data-n="4"], .mv-strip[data-n="6"] { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 900px) { .mv-body { grid-template-columns: minmax(0, 1fr); } .mv-aside { position: static; } }
@container (max-width: 720px) { .mv-pair { grid-template-columns: minmax(0, 1fr); } }
`;

function Summary({ plan, res }) {
  const m = res.metrics;
  const liq = useMemo(() => liquidity(res, plan.general.startDate), [res, plan.general.startDate]);
  const target = targetStatus(plan, res);
  const vs = (label) => {
    if (!target || target.label !== label || target.gap == null) return {};
    const on = Math.abs(target.gap) < 0.05;
    const tableOn = target.table != null && Math.abs(target.table - target.target) < 0.05;
    const short = tableOn ? `${fmtX(-target.gap)} short: holdings sold at fund end` : `${fmtX(-target.gap)} short of ${fmtX(target.target)}`;
    return { sub: on ? `On target (${fmtX(target.target)})` : target.gap < 0 ? short : `${fmtX(target.gap)} above ${fmtX(target.target)}`, tone: target.gap >= -0.05 ? "good" : "bad" };
  };
  return (
    <StatStrip testId="model-overview" items={[
      { key: "tvpi", testId: "mv-tvpi", label: "Net TVPI", value: fmtX(m.tvpi), info: DEFS.tvpi, ...vs("Net TVPI") },
      { key: "irr", testId: "mv-irr", label: "Net IRR", value: irr(m.netIrr), info: DEFS.irr, sub: m.grossIrr != null ? `${irr(m.grossIrr)} gross` : undefined },
      { key: "dpi", testId: "mv-dpi", label: "DPI", value: fmtX(m.dpi), info: DEFS.dpi,
        sub: <span data-testid="mv-back">{liq?.dpiOne ? `Money back ${fmtYm(liq.dpiOne)}` : "Money back not in term"}</span> },
      { key: "moic", testId: "mv-moic", label: "Gross MOIC", value: fmtX(m.grossMoic), info: DEFS.moic, ...vs("Gross MOIC") },
      { key: "companies", testId: "mv-companies", label: "Portfolio companies", value: m.initialDeals == null ? "—" : Math.round(m.initialDeals).toLocaleString("en-US"), info: DEFS.companies,
        sub: m.reserveRatio == null ? undefined : `${fmtX(m.reserveRatio, 2)} reserve ratio` },
      { key: "size", testId: "mv-size", label: "Fund size", value: fmtMIn(plan.general.committed, plan.general.currency), info: DEFS.size,
        sub: `${fmtMIn(res.totals.lpDistributed, plan.general.currency)} to LPs` },
    ]} />
  );
}

function Overview({ plan, res }) {
  const ccy = plan.general.currency;
  const t = res.totals;
  const line = headline(plan, res);
  const light = plan.mode === "light";
  const flow = useMemo(() => dollarFlow(res), [res]);
  const ended = t.liquidatedAt
    ? `Companies still held when the fund ends (${fmtYm(t.liquidatedAt)}) are sold at ${light ? "their value on that date" : "their last round's post-money valuation"}: ${fmtMIn(t.liquidation, ccy)} of proceeds.`
    : `Evergreen: holdings still active after the modeled ${EVERGREEN_YEARS} years are valued as of then.`;
  return (
    <div data-testid="mv-panel-overview">
      {line && <div data-testid="model-story" style={{ ...sans, fontSize: FS.bodyLg, margin: "0 0 14px" }}>{line}</div>}
      {res.warnings.map((w) => (
        <div key={w} role="alert" style={{ ...sans, fontSize: FS.small, margin: "0 0 12px", display: "flex", gap: 8, alignItems: "center" }}>
          <Badge tone="warning">CHECK</Badge>{w}
        </div>
      ))}
      <ValueBuildChart quarterly={res.series.quarterly} ccy={ccy}
        info={`Green is cash LPs have been paid; blue is what they still hold. Together they're the TVPI. The dashed line is what LPs have paid in, so the chart crosses it when TVPI reaches 1.0×. ${ended}`} />
      <DollarFlow flow={flow} ccy={ccy}
        info={`The top bar is the fund's ${fmtMIn(t.committed, ccy)} of commitments${t.recycled > 0 ? ` plus ${fmtMIn(t.recycled, ccy)} of recycled proceeds` : ""}, split into what's invested, fees, expenses and anything not used. The middle bar is what the investments are worth by the end: the capital back plus the gain${flow?.lost > 0.5 ? ", with the dashed outline for what's lost" : ""}. The bottom bar is who's paid it, after the waterfall. All three use the same scale.`} />
      <ProceedsBreakdown rows={proceedsByGroup(res)} ccy={ccy}
        info={light ? "Each outcome's share of the capital invested against its share of the gross proceeds." : "Each allocation's share of the capital invested against its share of the gross proceeds."} />
    </div>
  );
}

function ReturnsCash({ plan, res }) {
  const ccy = plan.general.currency;
  const liq = useMemo(() => liquidity(res, plan.general.startDate), [res, plan.general.startDate]);
  const irrPoints = useMemo(() => irrOverTime(res), [res]);
  return (
    <div data-testid="mv-panel-returns">
      <Milestones items={milestones(plan, res)} />
      <ReturnsChart quarterly={res.series.quarterly} ccy={ccy} />
      <IrrChart points={irrPoints} info="The annual return to date at each quarter, counting what's still held at its value then. Net is what LPs earn after fees, expenses and carry; gross is the portfolio's own return. Early on fees dominate and IRR swings widely, so it starts at the end of year 1. The last point is the fund's final IRR." />
      {liq && <PacingChart years={liq.years} ccy={ccy} />}
    </div>
  );
}

/** Light plans: what one unicorn has to return, by itself, to pay back the whole fund. */
function ReturnTheFund({ plan }) {
  const w = whatItTakes(plan.light, plan.general.committed);
  if (!w || !(w.invested > 0)) return null;
  const ccy = plan.general.currency;
  const nm = w.label.toLowerCase();
  const takes = w.needed === 1 ? `one ${nm} does it` : w.needed ? `it takes ${w.needed} ${nm}s` : null;
  return (
    <div data-testid="return-the-fund" style={{ marginBottom: 16 }}>
      <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, margin: "0 0 8px 2px" }}>
        Return the fund<InfoTip label="About Return the fund" portal>
          One {nm} has to return {fmtX(w.multipleToReturnFund, 1)} on the {fmtMIn(w.invested, ccy)} invested in it (first check plus follow-on) to pay back the fund's {fmtMIn(plan.general.committed, ccy)} of commitments on its own.
        </InfoTip>
      </div>
      <StatStrip testId="return-the-fund-stats" items={[
        { key: "need", label: `${w.label} exit needed`, value: fmtX(w.multipleToReturnFund, 1), info: `The gross multiple one ${nm} needs to pay back the whole fund by itself.` },
        { key: "inv", label: `Invested per ${nm}`, value: fmtMIn(w.invested, ccy), info: "First check plus follow-on." },
        { key: "fund", label: "Fund to return", value: fmtMIn(plan.general.committed, ccy) },
        { key: "yours", label: `At your ${fmtX(w.multiple, 0)}`, value: `${fmtX(w.fundMultiple)} the fund`, sub: takes ? `So ${takes}` : undefined },
      ]} />
    </div>
  );
}

function Portfolio({ plan, res }) {
  const ccy = plan.general.currency;
  const rounds = useMemo(() => roundOutcomes(res), [res]);
  const paths = useMemo(() => ownershipPaths(res), [res]);
  if (plan.mode !== "light") {
    return (
      <div data-testid="mv-panel-portfolio">
        <RoundOutcomes rows={rounds}
          info="Across every allocation: how many companies reach each round, and how many of them exit there, fail there, or raise the next round. These are expected counts from each round's rates, so they can be fractions." />
        <OwnershipPath paths={paths} ccy={ccy}
          info="Your ownership as each company enters each round. Pro-rata follow-ons keep it level before the round's extra dilution; rounds you skip dilute you by the new money. Hover a round for the follow-on check." />
        <PortfolioTab plan={plan} res={res} months={Infinity} />
      </div>
    );
  }
  return (
    <div data-testid="mv-panel-portfolio">
      <OutcomeMix rows={proceedsByGroup(res)} ccy={ccy}
        info="Grey is each outcome's share of the companies; blue is its share of the gross proceeds. Under each: the number of companies and the gross multiple." />
      <ReturnTheFund plan={plan} />
      <DeploymentChart initialInv={res.series.initialInv} followInv={res.series.followInv} startDate={plan.general.startDate} ccy={ccy} />
    </div>
  );
}

function Economics({ plan, res }) {
  const ccy = plan.general.currency;
  const t = res.totals;
  const b = useMemo(() => bridge(res), [res]);
  const years = useMemo(() => economicsByYear(res, plan.general.startDate), [res, plan.general.startDate]);
  const pctOf = (v) => (t.committed > 0 ? `${fmtPct(v / t.committed, 1)} of commitments` : undefined);
  const carry = t.gpCarryRealized + t.gpCarryUnrealized;
  const wf = res.waterfall;
  const profit = wf.paidOut + wf.unrealized.lp + wf.unrealized.gp - wf.paidIn;
  const sens = useMemo(() => dpiSensitivity(plan, res), [plan, res]);
  return (
    <div data-testid="mv-panel-economics">
      <StatStrip testId="mv-costs" items={[
        { key: "fees", testId: "cost-fees", label: "Management fees", value: fmtMIn(t.fees, ccy), sub: pctOf(t.fees), info: "Fees paid to the manager over the fund's life." },
        { key: "exp", testId: "cost-expenses", label: "Fund expenses", value: fmtMIn(t.expenses, ccy), sub: pctOf(t.expenses), info: "Legal, audit, admin and other fund costs." },
        { key: "carry", testId: "cost-carry", label: "GP carry", value: fmtMIn(carry, ccy), sub: profit > 0 ? `${fmtPct(carry / profit, 1)} of profit` : undefined,
          info: `The GP's share of the profit at a ${fmtPct(plan.waterfall.carryRate, 0)} carry rate, after any preferred return and catch-up.` },
        { key: "inv", testId: "cost-invested", label: "Reaches companies", value: t.committed > 0 ? fmtPct(t.invested / t.committed, 0) : "—", sub: `${fmtMIn(t.invested, ccy)} invested`,
          info: "Share of commitments that ends up invested in companies, after fees and expenses." },
      ]} />
      {b && <BridgeChart bridge={b} />}
      <CostsByYear years={years} ccy={ccy}
        info="What the fund pays its manager each calendar year. Fees step down after the investment period if the plan says so; carry starts once distributions clear the waterfall's earlier tiers." />
      <ProfitSplit years={years} ccy={ccy}
        info="LP profit is everything LPs have been paid less everything they've paid in, so it starts below zero and crosses it when LPs have their money back. GP carry is the carry paid out so far." />
      <WaterfallBar tiers={waterfallTiers(plan, res)} ccy={ccy}
        info={`Partners paid in ${fmtMIn(wf.paidIn, ccy)} and the fund paid out ${fmtMIn(wf.paidOut, ccy)}. LPs here include the GP's own commitment, which the waterfall treats like LP money. Paid in includes capital called for fees and expenses.`} />
      <DpiSensitivity data={sens} ccy={ccy}
        info="Distributions are all the cash the fund pays out, LPs and GP together, as a multiple of what partners paid in. LP DPI is the LPs' part of it after carry. Below any preferred return the GP gets nothing; through any catch-up its share climbs; above that, the GP gets its carry rate. LPs include the GP's own commitment, as in the waterfall split above." />
    </div>
  );
}

/** How the scenarios are built, from the same factors the model applies. */
function ScenarioMethod({ light = false }) {
  const pct = (f) => `${f > 1 ? "+" : "−"}${Math.round(Math.abs(f - 1) * 100)}%`;
  return (
    <div data-testid="scenario-method" style={{ display: "grid", gap: 8 }}>
      <div>{light ? "Each scenario reruns the whole plan with the outcome table shifted:" : "Each scenario reruns the whole plan with the market assumptions shifted in every round of every sector profile:"}</div>
      <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 4 }}>
        {SCENARIOS.map((s) => (
          <li key={s.id}><b>{s.label}:</b> {s.factors.exits || s.factors.grad
            ? (light ? `exit multiples ${pct(s.factors.exits ?? 1)}, companies that survive ${pct(s.factors.grad ?? 1)}.` : `exit values ${pct(s.factors.exits ?? 1)}, chance of raising the next round ${pct(s.factors.grad ?? 1)}.`)
            : "the plan exactly as entered."}</li>
        ))}
      </ul>
      <div>{light ? "Fund size, fees, checks, reserves, the waterfall and timing stay the same. These are fixed what-ifs for a tougher or hotter market, not probabilities." : "Fund size, fees, checks, reserves, the waterfall and timing stay the same. These are fixed what-ifs for a tougher or hotter market, not probabilities; the Monte Carlo shows how likely each result is."}</div>
    </div>
  );
}

function ScenarioCompare({ scenarios, scenario, setScenario, light = false }) {
  const rows = SCENARIOS.map((s) => ({ ...s, r: scenarios[s.id] })).filter((s) => s.r?.ok);
  return (
    <div className="card" style={{ padding: "12px 18px", marginBottom: 16, overflowX: "auto" }}>
      <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        Scenarios<InfoTip label="About scenarios" portal width={320}><ScenarioMethod light={light} /><div style={{ marginTop: 8 }}>Click a row to see the whole page under that scenario.</div></InfoTip>
      </div>
      <table className="ledger" data-testid="scenario-table" style={{ minWidth: 480 }}>
        <thead><tr><th style={{ textAlign: "left" }}>Scenario</th><th>Net TVPI</th><th>DPI</th><th>Net IRR</th><th>Gross MOIC</th></tr></thead>
        <tbody>{rows.map((s) => (
          <tr key={s.id} data-testid={`scenario-row-${s.id}`} onClick={() => setScenario(s.id)} aria-selected={scenario === s.id}
            style={{ cursor: "pointer", background: scenario === s.id ? "var(--accent-soft)" : undefined, fontWeight: scenario === s.id ? 700 : 400 }}>
            <td title={light ? s.lightBlurb : s.blurb}>{s.label}</td><td style={cellNum}>{fmtX(s.r.metrics.tvpi)}</td><td style={cellNum}>{fmtX(s.r.metrics.dpi)}</td>
            <td style={cellNum}>{irr(s.r.metrics.netIrr)}</td><td style={cellNum}>{fmtX(s.r.metrics.grossMoic)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function MonteCarloCard({ plan, onEdit }) {
  const run = plan.monteCarlo?.lastRun;
  if (!run?.base?.summary) {
    return (
      <div className="card" data-testid="mc-cta" style={{ ...sans, padding: "14px 18px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: FS.bodyLg, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6, flex: 1 }}>
          Monte Carlo<InfoTip label="About Monte Carlo" portal>The figures on this page are the expected case. A Monte Carlo run plays the plan out thousands of times, drawing each company's outcome at random from your assumptions, to show the spread around it: how often the fund lands well above or below.</InfoTip>
        </span>
        <Btn kind="primary" onClick={() => onEdit("montecarlo")}>Run Monte Carlo</Btn>
      </div>
    );
  }
  const s = run.base.summary;
  const stale = run.fingerprint !== planFingerprint(plan);
  return (
    <div data-testid="mc-summary" className="card" style={{ padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10, ...sans }}>
        <span style={{ fontSize: FS.bodyLg, fontWeight: 600 }}>Monte Carlo</span>
        <span style={{ fontSize: FS.small, color: subtle }}>{when(run.at)}</span>
        {stale && <Badge tone="warning">Plan changed since</Badge>}
        <span style={{ flex: 1 }} />
        <Btn onClick={() => onEdit("montecarlo")}>{stale ? "Run again" : "Open"}</Btn>
      </div>
      <StatStrip testId="mc-tiles" items={[
        { key: "p10", testId: "mc-p10", label: "Bad case (P10)", value: fmtX(s.net.p10), info: "Net TVPI that 90% of runs beat." },
        { key: "p50", testId: "mc-p50", label: "Middle (P50)", value: fmtX(s.net.p50), info: "Half the runs land above this net TVPI, half below." },
        { key: "p90", testId: "mc-p90", label: "Good case (P90)", value: fmtX(s.net.p90), info: "Net TVPI that only 10% of runs beat." },
      ]} />
      <Histogram hist={s.hist} target={run.target} label="Your plan" />
      <MonteCarloDisclaimer style={{ marginTop: 10 }} />
    </div>
  );
}

function Risk({ plan, scenarios, scenario, setScenario, onEdit, snapshot, companies }) {
  const light = plan.mode === "light";
  const sens = useMemo(() => tornado(plan, "tvpi"), [plan]);
  const be = useMemo(() => breakevenExits(plan), [plan]);
  // The break-even factor joins the curve so the line crosses 1.0x exactly at its marker.
  const curve = useMemo(() => exitCurve(plan, [...new Set([...EXIT_FACTORS, ...(be?.factor && !be.already ? [be.factor] : [])])].sort((a, b) => a - b)), [plan, be]);
  const lines = useMemo(() => SCENARIOS.filter((s) => scenarios?.[s.id]?.ok).map((s) => ({ id: s.id, label: s.label, quarterly: scenarios[s.id].series.quarterly })), [scenarios]);
  const beText = be?.already ? "Net TVPI is already below 1.0× at the planned exit values."
    : be?.factor == null ? "Net TVPI stays above 1.0× even if exits are worth almost nothing, because the rest of the portfolio's value covers it."
      : `LPs get their money back as long as exits are worth at least ${Math.round(be.factor * 100)}% of plan, a ${Math.round(be.drop * 100)}% drop.`;
  return (
    <div data-testid="mv-panel-risk">
      <ScenarioCompare scenarios={scenarios} scenario={scenario} setScenario={setScenario} light={light} />
      <ScenarioLines series={lines}
        info={light ? "Net TVPI quarter by quarter under each scenario. The scenarios shift exit multiples and how many companies survive; everything else stays as planned." : "Net TVPI quarter by quarter under each scenario. The scenarios shift exit values and the chance of raising the next round; everything else stays as planned."} />
      <ExitCurve points={curve} breakeven={be} note={beText}
        info={light ? "Every exit multiple scaled together, from a tenth of plan to double, with the rest of the plan unchanged. Below 1.0× net TVPI, LPs get back less than they paid in." : "Every exit valuation in every round scaled together, from a tenth of plan to double, with the rest of the plan unchanged. Below 1.0× net TVPI, LPs get back less than they paid in."} />
      {sens && <TornadoChart data={sens} label="net TVPI" fmt={(v) => fmtX(v, 2)} />}
      {light ? <LightRisk plan={plan} snapshot={snapshot} companies={companies} /> : <MonteCarloCard plan={plan} onEdit={onEdit} />}
    </div>
  );
}

export default function ModelView({ plan, result, onBack, onEdit, snapshot, companies }) {
  // A model opens at its top and on its overview, wherever the page was before.
  const [tab, setTab] = useState("overview");
  useEffect(() => { window.scrollTo?.(0, 0); setTab("overview"); }, [plan.id]);
  const light = plan.mode === "light";
  const [scenario, setScenario] = useState("base");
  const scenarios = useMemo(() => runScenarios(plan, result), [plan, result]);
  const res = scenarios?.[scenario]?.ok ? scenarios[scenario] : result;
  // Panels that explain a figure read the plan's inputs, so they get the scenario's plan with its result.
  const shown = useMemo(() => (res === result ? plan : scaled(plan, SCENARIOS.find((s) => s.id === scenario).factors)), [plan, res, result, scenario]);
  const pick = (id) => { trackClick(`FundModeling.FundConstruction.Model.Tab.${id}`); setTab(id); };
  const edit = (step, section) => { trackClick(`FundModeling.FundConstruction.Model.Edit.${step}`); onEdit(step, section); };
  const panel = {
    overview: <Overview plan={shown} res={res} />,
    returns: <ReturnsCash plan={shown} res={res} />,
    portfolio: <Portfolio plan={shown} res={res} />,
    economics: <Economics plan={shown} res={res} />,
    risk: <Risk plan={plan} scenarios={scenarios} scenario={scenario} setScenario={setScenario} onEdit={edit} snapshot={snapshot} companies={companies} />,
    faq: <LpFaq plan={shown} res={res} base={{ scenarios }} snapshot={snapshot} companies={companies} onEdit={edit} />,
    math: <CalculationsTab plan={shown} res={res} />,
  }[tab];
  return (
    <div className="mv-wrap" data-testid="model-view">
      <style>{MV_CSS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: "var(--ink-spacing-global-vertical-normal)" }}>
        <Btn onClick={onBack} data-testid="all-plans">← All plans</Btn>
        <span style={{ ...sans, fontSize: FS.h3 ?? 20, fontWeight: 600 }} data-testid="plan-name">{plan.name}</span>
        <span data-testid="plan-mode" style={{ display: "flex" }}><Badge tone={light ? "neutral" : "info"}>{modeLabel(plan.mode)}</Badge></span>
        <StatusTag plan={plan} testId="plan-status" />
        {plan.finalizedAt && plan.updatedAt > plan.finalizedAt && <span style={{ ...sans, fontSize: FS.small, color: subtle }}>Edited since it was finalized</span>}
        <span style={{ flex: 1 }} />
        <span data-testid="results-filters" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...sans, fontSize: FS.small, color: subtle, display: "inline-flex", alignItems: "center", gap: 4 }}>
            Scenario<InfoTip label="How the scenarios work" portal width={320}><ScenarioMethod light={light} /></InfoTip>
          </span>
          <Segmented small value={scenario} onChange={(v) => { trackClick(`FundModeling.FundConstruction.Model.Scenario.${v}`); setScenario(v); }}
            options={SCENARIOS.map((s) => ({ id: s.id, label: s.label, testId: `scenario-${s.id}`, title: light ? s.lightBlurb : s.blurb }))} />
        </span>
        <Btn kind="primary" onClick={() => edit("terms")} data-testid="edit-assumptions">Edit assumptions</Btn>
      </div>
      {scenario !== "base" && (
        <div role="status" data-testid="scenario-banner" style={{ ...sans, fontSize: FS.small, display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <Badge tone="info">{SCENARIOS.find((s) => s.id === scenario)?.label}</Badge>
          <span style={{ color: subtle }}>Every figure shows this scenario.</span>
          <Btn kind="link" onClick={() => setScenario("base")}>Back to base</Btn>
        </div>
      )}
      <div className="mv-body">
        <div style={{ minWidth: 0 }}>
          <Summary plan={plan} res={res} />
          <div className="mv-tabs" role="tablist" aria-label="Model" data-testid="model-tabs">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" className="mv-tab" aria-selected={tab === t.id} data-testid={`mv-tab-${t.id}`} onClick={() => pick(t.id)}>{t.label}</button>
            ))}
          </div>
          <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>{panel}</div>
        </div>
        <Assumptions plan={plan} result={result} onEdit={edit} className="mv-aside" />
      </div>
    </div>
  );
}
