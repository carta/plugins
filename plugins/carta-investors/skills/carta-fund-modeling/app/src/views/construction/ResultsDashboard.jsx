import { useMemo, useState } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { Segmented, Badge, Btn } from "../../ui/components.jsx";
import { fmtMIn, fmtX, fmtPct, fmtOwn } from "../../ui/format.js";
import { SCENARIOS, bridge, concentration, liquidity, runScenarios, tornado } from "../../model/construction/analysis.js";
import { trackClick } from "../../analytics.js";
import { ReturnsChart, DeploymentChart } from "./charts.jsx";
import { BridgeChart, TornadoChart, PacingChart } from "./ResultsCharts.jsx";
import { Funnel, FundWaterfall } from "./ResultsParts.jsx";
import { fmtCount, cellNum, fmtYm } from "./fields.jsx";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const TABS = [
  { id: "returns", label: "Returns" },
  { id: "portfolio", label: "Portfolio" },
  { id: "terms", label: "Terms & economics" },
  { id: "liquidity", label: "Liquidity & risk" },
];
export const RANGES = [{ id: "all", label: "Whole life", months: Infinity }, { id: "5", label: "First 5 years", months: 60 }, { id: "10", label: "First 10 years", months: 120 }];
const irr = (v) => (v == null ? "—" : fmtPct(v, 1));

export function Kpi({ label, value, delta, testId }) {
  return (
    <div data-testid={testId} className="card" style={{ padding: "12px 16px", minWidth: 0 }}>
      <div style={{ ...sans, fontSize: FS.small, ...subtle }}>{label}</div>
      <div style={{ ...inkNum, fontSize: FS.h2, fontWeight: 700, lineHeight: "32px" }}>{value}</div>
      {delta && <div style={{ ...sans, fontSize: FS.micro, fontWeight: 600, color: delta.good ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>{delta.text}</div>}
    </div>
  );
}

export function Section({ title, hint, children, right, testId }) {
  return (
    <section data-testid={testId} style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ ...sans, margin: 0, fontSize: FS.bodyLg, fontWeight: 600 }}>{title}</h3>
        {hint && <span style={{ ...sans, fontSize: FS.small, ...subtle }}>{hint}</span>}
        <span style={{ flex: 1 }} />{right}
      </div>
      {children}
    </section>
  );
}

export function FilterBar({ scenario, setScenario, basis, setBasis, range, setRange }) {
  const lab = (t) => <span style={{ ...sans, fontSize: FS.small, fontWeight: 600 }}>{t}</span>;
  return (
    <div data-testid="results-filters" className="card" style={{ padding: "10px 16px", marginBottom: 16, display: "flex", gap: "10px 24px", alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>{lab("Scenario")}
        <Segmented small value={scenario} onChange={(v) => { trackClick(`FundModeling.FundConstruction.Results.Scenario.${v}`); setScenario(v); }}
          options={SCENARIOS.map((s) => ({ id: s.id, label: s.label, testId: `scenario-${s.id}`, title: s.blurb }))} /></span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>{lab("Basis")}
        <Segmented small value={basis} onChange={setBasis} options={[{ id: "net", label: "Net to LPs", testId: "basis-net" }, { id: "gross", label: "Gross", testId: "basis-gross" }]} /></span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>{lab("Charts show")}
        <Segmented small value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: r.label, testId: `range-${r.id}` }))} /></span>
    </div>
  );
}

export function ReturnsTab({ plan, res, base, scenario, basis, setScenario, scenarios, months, cards: showCards = true }) {
  const ccy = plan.general.currency;
  const m = res.metrics, b = base.metrics;
  const target = plan.target?.value > 0 ? plan.target : null;
  const delta = (cur, ref, kind = "x") => {
    if (scenario === "base" || cur == null || ref == null) return null;
    const d = cur - ref;
    return { good: d >= 0, text: `${d >= 0 ? "+" : "−"}${kind === "x" ? fmtX(Math.abs(d), 2) : fmtPct(Math.abs(d), 1)} vs base` };
  };
  const cards = basis === "net"
    ? [["tvpi", "Net TVPI", fmtX(m.tvpi), delta(m.tvpi, b.tvpi)], ["dpi", "DPI", fmtX(m.dpi), delta(m.dpi, b.dpi)], ["rvpi", "RVPI", fmtX(m.rvpi), delta(m.rvpi, b.rvpi)], ["irr", "Net IRR", irr(m.netIrr), delta(m.netIrr, b.netIrr, "pct")]]
    : [["moic", "Gross MOIC", fmtX(m.grossMoic), delta(m.grossMoic, b.grossMoic)], ["girr", "Gross IRR", irr(m.grossIrr), delta(m.grossIrr, b.grossIrr, "pct")],
      ["inv", "Invested", fmtMIn(res.totals.invested, ccy), null], ["val", "Proceeds + remaining value", fmtMIn(res.totals.totalProceeds + res.totals.navEnd, ccy), null]];
  const metricKey = basis === "net" ? "tvpi" : "grossMoic";
  const gap = target && (plan.target.metric === metricKey) ? m[metricKey] - target.value : null;
  const rows = SCENARIOS.map((s) => ({ ...s, r: scenarios[s.id] })).filter((s) => s.r?.ok);
  const lim = (q) => q.month <= months;
  return (
    <div data-testid="results-tab-returns-body">
      {showCards && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 8 }}>
          {cards.map(([id, label, value, d]) => <Kpi key={id} testId={`kpi-${id}`} label={label} value={value} delta={d} />)}
        </div>
      )}
      {showCards && gap != null && (
        <div data-testid="kpi-target" style={{ ...sans, fontSize: FS.small, marginBottom: 12, color: gap >= -0.05 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)", fontWeight: 600 }}>
          Target {fmtX(target.value, 2)}: {Math.abs(gap) < 0.05 ? "on target" : gap < 0 ? `${fmtX(-gap, 2)} short` : `${fmtX(gap, 2)} above`}
        </div>
      )}
      <ReturnsChart quarterly={res.series.quarterly.filter(lim)} ccy={ccy} />
      <Section title="Scenarios" hint="Click a row to see the whole page under that scenario.">
        <div className="card" style={{ padding: "6px 16px", overflowX: "auto" }}>
          <table className="ledger" data-testid="scenario-table" style={{ minWidth: 560 }}>
            <thead><tr><th style={{ textAlign: "left" }}>Scenario</th><th>Net TVPI</th><th>DPI</th><th>Net IRR</th><th>Gross MOIC</th><th style={{ textAlign: "left" }}>What changes</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} data-testid={`scenario-row-${s.id}`} onClick={() => setScenario(s.id)} aria-selected={scenario === s.id}
                style={{ cursor: "pointer", background: scenario === s.id ? "var(--accent-soft)" : undefined, fontWeight: scenario === s.id ? 700 : 400 }}>
                <td>{s.label}</td><td style={cellNum}>{fmtX(s.r.metrics.tvpi)}</td><td style={cellNum}>{fmtX(s.r.metrics.dpi)}</td>
                <td style={cellNum}>{irr(s.r.metrics.netIrr)}</td><td style={cellNum}>{fmtX(s.r.metrics.grossMoic)}</td>
                <td style={{ ...subtle, fontWeight: 400, textAlign: "left" }}>{s.blurb}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

export function PortfolioTab({ plan, res, months }) {
  const ccy = plan.general.currency;
  const [picked, setPicked] = useState(null); // null means every allocation
  const [openId, setOpenId] = useState(null);
  const all = res.allocations;
  const sel = picked ? all.filter((a) => picked.has(a.id)) : all;
  const toggle = (id) => setPicked((cur) => {
    const next = new Set(cur ?? all.map((a) => a.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next.size === all.length || next.size === 0 ? null : next;
  });
  const conc = useMemo(() => concentration(res, plan, picked), [res, plan, picked]);
  const deals = sel.reduce((t, a) => t + a.initialDeals, 0);
  const capital = sel.reduce((t, a) => t + a.capital, 0);
  const own = deals > 0 ? sel.reduce((t, a) => t + a.initialDeals * (a.entryOwnership ?? 0), 0) / deals : null;
  const moic = capital > 0 ? sel.reduce((t, a) => t + a.capital * (a.moic ?? 0), 0) / capital : null;
  const proceedsOf = (a) => a.capital * (a.moic ?? 0);
  const totalProc = sel.reduce((t, a) => t + proceedsOf(a), 0);
  const top = conc.rows.length ? conc.rows.reduce((hi, r) => (r.share > hi.share ? r : hi), conc.rows[0]) : null;
  const lim = (v, i) => i <= months;
  return (
    <div data-testid="results-tab-portfolio-body">
      <div role="group" aria-label="Allocations" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <span style={{ ...sans, fontSize: FS.small, fontWeight: 600 }}>Allocations</span>
        {all.map((a) => {
          const on = !picked || picked.has(a.id);
          return (
            <button key={a.id} type="button" aria-pressed={on} onClick={() => toggle(a.id)} data-testid={`alloc-chip-${a.id}`}
              style={{ ...sans, fontSize: FS.body, padding: "5px 12px", borderRadius: 16, cursor: "pointer",
                border: `1px solid ${on ? "var(--ink-color-global-border-active)" : "var(--ink-color-global-border-subtle)"}`,
                background: on ? "var(--ink-color-global-surface-lightgray-default)" : "transparent", color: on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>
              {a.name}
            </button>
          );
        })}
        {picked && <Btn kind="link" onClick={() => setPicked(null)} data-testid="alloc-all">Show all</Btn>}
      </div>
      <div data-testid="portfolio-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi label="Companies" value={fmtCount(deals)} />
        <Kpi label="Initial capital + follow-ons" value={fmtMIn(capital, ccy)} />
        <Kpi label="Avg entry ownership" value={own == null ? "—" : fmtOwn(own)} />
        <Kpi label="Expected MOIC" value={fmtX(moic)} />
      </div>
      <Section title="Returns by allocation" hint="Click a row for its round-by-round path.">
        <div className="card" style={{ padding: "6px 16px", overflowX: "auto" }}>
          <table className="ledger" data-testid="alloc-table" style={{ minWidth: 640 }}>
            <thead><tr><th style={{ textAlign: "left" }}>Allocation</th><th>Companies</th><th>Capital</th><th>Entry ownership</th><th>Expected MOIC</th><th>Proceeds</th><th>Share</th></tr></thead>
            <tbody>{sel.map((a) => (
              <tr key={a.id} data-testid={`alloc-row-${a.id}`} onClick={() => setOpenId(openId === a.id ? null : a.id)} style={{ cursor: "pointer", fontWeight: openId === a.id ? 700 : 400 }}>
                <td>{a.name}</td><td style={cellNum}>{fmtCount(a.initialDeals)}</td><td style={cellNum}>{fmtMIn(a.capital, ccy)}</td>
                <td style={cellNum}>{fmtOwn(a.entryOwnership)}</td><td style={cellNum}>{fmtX(a.moic)}</td>
                <td style={cellNum}>{fmtMIn(proceedsOf(a), ccy)}</td><td style={cellNum}>{totalProc > 0 ? fmtPct(proceedsOf(a) / totalProc, 0) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {sel.filter((a) => a.id === openId).map((a) => <div key={a.id} style={{ marginTop: 12 }}><Funnel a={a} ccy={ccy} /></div>)}
      </Section>
      <Section title="Where the proceeds come from" hint="Share of exits against share of exit proceeds, by the round the exit happens in." testId="concentration">
        {conc.rows.length === 0 ? <div style={{ ...sans, ...subtle }}>No exits in this selection.</div> : (
          <div className="card" style={{ padding: "14px 18px" }}>
            {top && (
              <div data-testid="concentration-note" style={{ ...sans, fontSize: FS.body, marginBottom: 12 }}>
                <strong>{fmtPct(top.share, 0)}</strong> of exit proceeds come from {top.round} exits, which are {fmtPct(top.exitedShare, 0)} of all exits.
                {conc.lossRatio != null && <> About <strong>{fmtPct(conc.lossRatio, 0)}</strong> of companies fail along the way.</>}
              </div>
            )}
            <div style={{ display: "grid", gap: 8 }}>
              {conc.rows.map((r) => (
                <div key={r.round} data-testid={`conc-${r.round}`} style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px", gap: 10, alignItems: "center" }}>
                  <span style={{ ...sans, fontSize: FS.body }}>{r.round}</span>
                  <span style={{ display: "grid", gap: 3 }} aria-hidden="true">
                    <span style={{ height: 8, width: `${Math.max(1, r.exitedShare * 100)}%`, background: "var(--ink-color-global-data-viz-neutral-3)", borderRadius: "0 3px 3px 0" }} />
                    <span style={{ height: 8, width: `${Math.max(1, r.share * 100)}%`, background: "var(--ink-color-global-data-viz-blue-3)", borderRadius: "0 3px 3px 0" }} />
                  </span>
                  <span style={{ ...inkNum, fontSize: FS.small, textAlign: "right" }}>{fmtPct(r.exitedShare, 0)} of exits · {fmtPct(r.share, 0)} of $</span>
                </div>
              ))}
            </div>
            <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 8 }}>Grey: share of exits. Blue: share of exit proceeds. Value still held when the fund ends is not counted here.</div>
          </div>
        )}
      </Section>
      <DeploymentChart initialInv={res.series.initialInv.filter(lim)} followInv={res.series.followInv.filter(lim)} startDate={plan.general.startDate} ccy={ccy} />
    </div>
  );
}

export function TermsTab({ plan, res }) {
  const ccy = plan.general.currency;
  const t = res.totals;
  const b = useMemo(() => bridge(res), [res]);
  const pctOf = (v) => (t.committed > 0 ? fmtPct(v / t.committed, 1) : "—");
  const carry = t.gpCarryRealized + t.gpCarryUnrealized;
  return (
    <div data-testid="results-tab-terms-body">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi testId="cost-fees" label="Management fees" value={fmtMIn(t.fees, ccy)} delta={{ good: true, text: `${pctOf(t.fees)} of commitments` }} />
        <Kpi testId="cost-expenses" label="Fund expenses" value={fmtMIn(t.expenses, ccy)} delta={{ good: true, text: `${pctOf(t.expenses)} of commitments` }} />
        <Kpi testId="cost-carry" label="GP carry" value={fmtMIn(carry, ccy)} delta={{ good: true, text: `${fmtPct(plan.waterfall.carryRate, 0)} carry` }} />
        <Kpi testId="cost-invested" label="Reaches investments" value={t.committed > 0 ? fmtPct(t.invested / t.committed, 0) : "—"} delta={{ good: true, text: `${fmtMIn(t.invested, ccy)} of ${fmtMIn(t.committed, ccy)}` }} />
      </div>
      {b ? <BridgeChart bridge={b} /> : null}
      {b && (
        <div data-testid="bridge-note" style={{ ...sans, fontSize: FS.body, margin: "-4px 0 16px" }}>
          Fees and expenses take <strong>{fmtX(b.feeDrag, 2)}</strong> and carry takes <strong>{fmtX(b.carry, 2)}</strong> from a <strong>{fmtX(b.gross, 2)}</strong> gross multiple, leaving LPs <strong>{fmtX(b.net, 2)}</strong> for every 1.00× they paid in.
        </div>
      )}
      <FundWaterfall plan={plan} result={res} />
    </div>
  );
}

export function LiquidityTab({ plan, res, basis, months, scenarios }) {
  const ccy = plan.general.currency;
  const liq = useMemo(() => liquidity(res, plan.general.startDate), [res, plan.general.startDate]);
  const metric = basis === "net" ? "tvpi" : "grossMoic";
  const sens = useMemo(() => tornado(plan, metric), [plan, metric]);
  const years = liq ? liq.years.filter((y) => y.from <= months) : [];
  const conc = useMemo(() => concentration(res, plan), [res, plan]);
  return (
    <div data-testid="results-tab-liquidity-body">
      {liq && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
          <Kpi testId="ms-trough" label="J-curve low point" value={fmtX(liq.trough.tvpi)} delta={{ good: true, text: fmtYm(liq.trough.date) }} />
          <Kpi testId="ms-cash" label="Most cash out the door" value={fmtMIn(-liq.deepestCash.amount, ccy)} delta={{ good: true, text: `${fmtYm(liq.deepestCash.date)} · ${plan.general.committed > 0 ? fmtPct(-liq.deepestCash.amount / plan.general.committed, 0) : "—"} of commitments` }} />
          <Kpi testId="ms-tvpi1" label="TVPI reaches 1.0×" value={liq.tvpiOne ? fmtYm(liq.tvpiOne) : "Not within the term"} />
          <Kpi testId="ms-dpi1" label="DPI reaches 1.0× (money back)" value={liq.dpiOne ? fmtYm(liq.dpiOne) : "Not within the term"} />
        </div>
      )}
      {liq && <PacingChart years={years} ccy={ccy} />}
      <Section title="What the result depends on" hint={`Each assumption moved on its own around the base plan. ${basis === "net" ? "Net TVPI" : "Gross MOIC"}.`} testId="sensitivity-section">
        {sens ? <TornadoChart data={sens} label={basis === "net" ? "net TVPI" : "gross MOIC"} fmt={(v) => fmtX(v, 2)} /> : null}
      </Section>
      <Section title="Downside exposure" testId="risk-cards">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <Kpi testId="risk-loss" label="Companies that fail" value={conc.lossRatio == null ? "—" : fmtPct(conc.lossRatio, 0)} delta={{ good: true, text: `${fmtCount(conc.failed)} of ${fmtCount(conc.deals)}` }} />
          <Kpi testId="risk-down" label="Net TVPI in the downside" value={fmtX(scenarios.down?.metrics?.tvpi)} delta={{ good: true, text: "exits −30%, fewer raise" }} />
        </div>
      </Section>
    </div>
  );
}

export default function ResultsDashboard({ plan, result }) {
  const [tab, setTab] = useState("returns");
  const [scenario, setScenario] = useState("base");
  const [basis, setBasis] = useState("net");
  const [range, setRange] = useState("all");
  const scenarios = useMemo(() => runScenarios(plan, result), [plan, result]);
  const res = scenarios[scenario]?.ok ? scenarios[scenario] : result;
  const months = RANGES.find((r) => r.id === range)?.months ?? Infinity;
  const body = { plan, res, base: result, scenario, basis, months, scenarios, setScenario };
  return (
    <div data-testid="results-dashboard">
      <FilterBar scenario={scenario} setScenario={setScenario} basis={basis} setBasis={setBasis} range={range} setRange={setRange} />
      {scenario !== "base" && (
        <div role="status" data-testid="scenario-banner" style={{ ...sans, fontSize: FS.small, display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <Badge tone="info">{SCENARIOS.find((s) => s.id === scenario)?.label}</Badge>
          <span>Every figure below shows this scenario. {SCENARIOS.find((s) => s.id === scenario)?.blurb}</span>
          <Btn kind="link" onClick={() => setScenario("base")}>Back to base</Btn>
        </div>
      )}
      <div role="tablist" aria-label="Results sections" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--ink-color-global-border-subtle)", marginBottom: 16, overflowX: "auto" }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button key={t.id} role="tab" type="button" aria-selected={on} aria-controls={`results-panel-${t.id}`} data-testid={`results-tab-${t.id}`}
              onClick={() => { trackClick(`FundModeling.FundConstruction.Results.Tab.${t.id}`); setTab(t.id); }}
              style={{ ...sans, fontSize: FS.bodyLg, fontWeight: on ? 650 : 500, padding: "10px 16px", marginBottom: -1, cursor: "pointer", whiteSpace: "nowrap", background: "transparent", border: "none", borderRadius: 0,
                borderBottom: `2px solid ${on ? "var(--ink-color-global-text-default)" : "transparent"}`, color: on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`results-panel-${tab}`}>
        {tab === "returns" && <ReturnsTab {...body} />}
        {tab === "portfolio" && <PortfolioTab {...body} />}
        {tab === "terms" && <TermsTab {...body} />}
        {tab === "liquidity" && <LiquidityTab {...body} />}
      </div>
    </div>
  );
}
