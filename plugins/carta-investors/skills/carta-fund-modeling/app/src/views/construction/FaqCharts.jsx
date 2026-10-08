import { FS, sans, inkNum } from "../../ui/theme.js";
import { fmtX, fmtPct } from "../../ui/format.js";
import { bridge, concentration, liquidity } from "../../model/construction/analysis.js";
import { fmtMIn } from "../../ui/format.js";
import { ReturnsChart, DeploymentChart, C_TVPI, C_DPI } from "./charts.jsx";
import { BridgeChart, PacingChart, TornadoChart } from "./ResultsCharts.jsx";

const subtle = "var(--ink-color-global-text-subtle)";

/** Values are written beside the bars so they read without the colors. */
export function MiniBars({ rows, label, testId }) {
  const top = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul data-testid={testId} aria-label={label} style={{ listStyle: "none", padding: 0, margin: "8px 0 4px", display: "grid", gap: 8, maxWidth: 640 }}>
      {rows.map((r) => (
        <li key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 160px) 1fr minmax(56px, auto)", gap: 12, alignItems: "center" }}>
          <span style={{ ...sans, fontSize: FS.body, color: subtle }}>{r.label}</span>
          <span style={{ height: 14, background: "var(--ink-color-global-surface-lightgray-default)", borderRadius: 3, overflow: "hidden" }} aria-hidden="true">
            <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, r.value / top)) * 100}%`, background: r.color ?? C_TVPI, borderRadius: 3 }} />
          </span>
          <span style={{ ...inkNum, fontSize: FS.body, fontWeight: 700, textAlign: "right" }}>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The chart for question `id`, or null when it has none. `ctx` is { plan, res, scenarios, sensitivity }. */
export default function FaqChart({ id, ctx }) {
  const { plan, res, scenarios, sensitivity } = ctx;
  const ccy = plan.general.currency;
  const t = res.totals;
  switch (id) {
    case "jcurve":
      return <ReturnsChart quarterly={res.series.quarterly} ccy={ccy} flat />;
    case "calls": {
      const liq = liquidity(res, plan.general.startDate);
      return liq ? <PacingChart years={liq.years} ccy={ccy} flat /> : null;
    }
    case "deploy":
      return <DeploymentChart initialInv={res.series.initialInv} followInv={res.series.followInv} startDate={plan.general.startDate} ccy={ccy} flat />;
    case "gpcarry": {
      const b = bridge(res);
      return b ? <BridgeChart bridge={b} flat /> : null;
    }
    case "drivers":
      return sensitivity?.rows?.length ? <TornadoChart data={sensitivity} label="net TVPI" fmt={(v) => fmtX(v, 2)} flat /> : null;
    case "scenarios": {
      if (!scenarios?.down?.ok || !scenarios?.up?.ok) return null;
      const rows = [["Downside", scenarios.down, "var(--ink-color-global-data-viz-negative-3)"], ["Base", scenarios.base, C_TVPI], ["Upside", scenarios.up, C_DPI]];
      return <MiniBars testId="faq-chart-scenarios" label="Net TVPI by scenario" rows={rows.map(([label, s, color]) => ({ label, color, value: s.metrics.tvpi, text: fmtX(s.metrics.tvpi) }))} />;
    }
    case "concentration": {
      const conc = plan.mode === "light" ? null : concentration(res, plan);
      if (conc?.rows?.length) return <MiniBars testId="faq-chart-concentration" label="Share of exit proceeds by round" rows={conc.rows.map((r) => ({ label: `${r.round} exits`, value: r.share, text: fmtPct(r.share, 0) }))} />;
      const groups = res.allocations.map((a) => ({ label: a.name, value: a.capital * (a.moic ?? 0) })).filter((x) => x.value > 0);
      const total = groups.reduce((s, x) => s + x.value, 0);
      return groups.length && total > 0 ? <MiniBars testId="faq-chart-concentration" label="Share of gross proceeds by outcome" rows={groups.map((x) => ({ label: x.label, value: x.value, text: fmtPct(x.value / total, 0) }))} /> : null;
    }
    case "allocation": {
      const total = res.allocations.reduce((s, a) => s + a.capital, 0);
      return total > 0 ? <MiniBars testId="faq-chart-allocation" label="Share of capital by allocation" rows={res.allocations.map((a) => ({ label: a.name, value: a.capital, text: fmtPct(a.capital / total, 0) }))} /> : null;
    }
    case "reserves": {
      const total = t.initialCapital + t.followOnCapital;
      return total > 0 ? <MiniBars testId="faq-chart-reserves" label="First checks and follow-ons" rows={[
        { label: "First checks", value: t.initialCapital, text: fmtPct(t.initialCapital / total, 0) },
        { label: "Follow-ons", value: t.followOnCapital, text: fmtPct(t.followOnCapital / total, 0), color: C_DPI },
      ]} /> : null;
    }
    case "investable": {
      return <MiniBars testId="faq-chart-investable" label="Where commitments go" rows={[
        { label: "Invested", value: t.invested, text: fmtPct(t.invested / t.committed, 0) },
        { label: "Fees", value: t.fees, text: fmtPct(t.fees / t.committed, 0), color: "var(--ink-color-global-data-viz-negative-3)" },
        { label: "Expenses", value: t.expenses, text: fmtPct(t.expenses / t.committed, 1), color: "var(--ink-color-global-data-viz-neutral-3)" },
      ]} />;
    }
    case "montecarlo": {
      const net = plan.monteCarlo?.lastRun?.base?.summary?.net;
      return net ? <MiniBars testId="faq-chart-montecarlo" label="Net TVPI across simulated funds" rows={[["P10", net.p10], ["P50", net.p50], ["P90", net.p90]].map(([label, v]) => ({ label, value: v, text: fmtX(v) }))} /> : null;
    }
    default:
      return null;
  }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function Ruler({ ruler }) {
  const marks = ruler.marks;
  const top = Math.max(...marks.map((m) => m.value), ruler.value ?? 0, 0.0001) * 1.1;
  const at = (v) => `${clamp(v / top, 0, 1) * 100}%`;
  const label = `${ruler.label}: plan ${ruler.valueText}; ${marks.map((m) => `${m.label} ${m.text}`).join(", ")}`;
  return (
    <div data-testid={`ruler-${ruler.label.toLowerCase().replace(/\W+/g, "-")}`} style={{ marginBottom: 14, maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ ...sans, fontSize: FS.body, fontWeight: 600 }}>{ruler.label}</span>
        <span style={{ ...inkNum, fontSize: FS.value, fontWeight: 700 }}>{ruler.valueText}</span>
        <span style={{ ...sans, fontSize: FS.micro, color: subtle }}>this plan</span>
      </div>
      <div role="img" aria-label={label} style={{ position: "relative", height: 24, margin: "4px 0" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 10, height: 4, borderRadius: 2, background: "var(--ink-color-global-border-subtle)" }} />
        {marks.map((m) => <div key={m.key} style={{ position: "absolute", left: at(m.value), top: 5, width: 2, height: 14, marginLeft: -1, background: m.key === "p50" ? C_TVPI : "var(--ink-color-global-text-subtle)", opacity: m.key === "p50" ? 1 : 0.55 }} />)}
        {ruler.value != null && <div style={{ position: "absolute", left: at(ruler.value), top: 4, width: 16, height: 16, marginLeft: -8, borderRadius: 8, background: "var(--ink-color-global-text-default)", border: "2px solid var(--ink-color-global-surface-background-default)" }} />}
      </div>
      <div style={{ ...sans, fontSize: FS.micro, color: subtle, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {marks.map((m) => <span key={m.key}>{m.label} <span style={inkNum}>{m.text}</span></span>)}
      </div>
    </div>
  );
}

export function Pairs({ chart }) {
  const top = Math.max(...chart.rows.flatMap((r) => [r.plan, r.market]), 0.0001);
  return (
    <div data-testid="market-pairs" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", gap: 14, ...sans, fontSize: FS.micro, color: subtle, marginBottom: 6 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C_TVPI, marginRight: 5 }} />{chart.planLabel}</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--ink-color-global-data-viz-neutral-3)", marginRight: 5 }} />{chart.marketLabel}</span>
      </div>
      {chart.rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 170px) 1fr", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span style={{ ...sans, fontSize: FS.body, color: subtle }}>{r.label}</span>
          <span style={{ display: "grid", gap: 3 }}>
            {[[r.plan, r.planText, C_TVPI], [r.market, r.marketText, "var(--ink-color-global-data-viz-neutral-3)"]].map(([v, text, color], i) => (
              <span key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                <span style={{ height: 10, background: "var(--ink-color-global-surface-lightgray-default)", borderRadius: 3, overflow: "hidden" }} aria-hidden="true">
                  <span style={{ display: "block", height: "100%", width: `${clamp(v / top, 0, 1) * 100}%`, background: color }} />
                </span>
                <span style={{ ...inkNum, fontSize: FS.small, minWidth: 64, textAlign: "right" }}>{text}</span>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MarketCompare({ market }) {
  const { chart } = market;
  return (
    <div data-testid="market-compare" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
      <div style={{ ...sans, fontSize: FS.micro, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: subtle, marginBottom: 6 }}>Versus the market</div>
      <div data-testid="market-text" style={{ ...sans, fontSize: FS.bodyLg, lineHeight: 1.55, marginBottom: 10 }}>{market.text}</div>
      {chart.kind === "rulers" && chart.rulers.map((r) => <Ruler key={r.label} ruler={r} />)}
      {chart.kind === "pairs" && <Pairs chart={chart} />}
      {chart.kind === "bars" && <MiniBars testId="market-bars" label="This plan against reference rates" rows={chart.rows.map((r) => ({ ...r, color: r.highlight ? C_TVPI : "var(--ink-color-global-data-viz-neutral-3)" }))} />}
      <div style={{ ...sans, fontSize: FS.micro, color: subtle, marginTop: 4 }}>Source: {market.source}</div>
    </div>
  );
}
