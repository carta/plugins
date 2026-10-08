// Projected from this plan, not what any LP has actually done.
import { useMemo, useState } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { Btn, Dropdown, InfoTip } from "../../ui/components.jsx";
import { fmtFullIn, fmtMIn, fmtPct, fmtX } from "../../ui/format.js";
import { lpLabels } from "../../model/construction/plan.js";
import { lpFlows, lpShare, lpClassShare } from "../../model/construction/lpFlows.js";
import { fmtYm } from "./fields.jsx";

const subtle = "var(--ink-color-global-text-subtle)";
const BLUE = "var(--ink-color-global-data-viz-blue-3)";
const AXIS = "var(--ink-color-global-border-subtle)";
const W = 560, H = 230, PL = 58, PR = 12, PT = 12, PB = 30;

function ticks(lo, hi, n = 4) {
  const min = Math.min(0, lo), max = Math.max(0, hi);
  if (max === min) return [0, 1];
  const raw = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function FlowCard({ title, info, total, quarters, ccy, empty, testId }) {
  const [mode, setMode] = useState("cumulative");
  const key = mode === "cumulative" ? "cumulative" : "inPeriod";
  const vals = quarters.map((q) => q[key]);
  const t = ticks(Math.min(...vals), Math.max(...vals));
  const lo = t[0], hi = t.at(-1);
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = quarters.length;
  const x = (i) => PL + (n > 1 ? (i / (n - 1)) * plotW : 0);
  const y = (v) => PT + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const band = plotW / n, bw = Math.max(1, band * 0.78);
  const line = quarters.map((q, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(q[key]).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const yearTicks = quarters.map((q, i) => ({ i, y: q.date.slice(0, 4), m: q.date.slice(5) })).filter((p, i, all) => p.m === "12" || i === all.length - 1);
  const every = Math.ceil(yearTicks.length / 7);
  return (
    <div className="card" data-testid={testId} style={{ padding: "16px 18px 12px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>{title}</span>
        {info && <InfoTip label={`About ${title}`} portal width={280}>{info}</InfoTip>}
      </div>
      <div style={{ ...inkNum, fontSize: 22, fontWeight: 600 }} data-testid={`${testId}-total`}>{fmtFullIn(total, ccy)}</div>
      <div style={{ ...sans, fontSize: FS.micro, color: subtle, marginBottom: 8 }}>Projected</div>
      {empty ? (
        <div style={{ ...sans, fontSize: FS.body, color: subtle, padding: "28px 0" }}>{empty}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {[["cumulative", "Cumulative"], ["inPeriod", "In period"]].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)} data-testid={`${testId}-${id}`}
                style={{ ...sans, fontSize: FS.small, padding: "4px 12px", borderRadius: 14, cursor: "pointer", border: "none", fontWeight: mode === id ? 600 : 500,
                  background: mode === id ? "var(--ink-color-global-surface-lightgray-default)" : "transparent", color: mode === id ? "var(--ink-color-global-text-default)" : subtle }}>{label}</button>
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label={`${title}, ${mode === "cumulative" ? "cumulative" : "by quarter"}`}>
            {t.map((v) => (
              <g key={v}>
                <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={AXIS} strokeDasharray={v === 0 ? "" : "2 3"} />
                <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>{v === 0 ? "0" : fmtMIn(v, ccy)}</text>
              </g>
            ))}
            {yearTicks.filter((_, k) => k % every === 0).map((p) => <text key={p.i} x={x(p.i)} y={H - PB + 18} textAnchor="middle" style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>{p.y}</text>)}
            {mode === "cumulative"
              ? <><path d={area} fill={BLUE} opacity="0.35" /><path d={line} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" /></>
              : quarters.map((q, i) => {
                const v = q[key], top = Math.min(y(v), y(0)), h = Math.abs(y(v) - y(0));
                return <rect key={i} x={PL + band * i + (band - bw) / 2} y={top} width={bw} height={Math.max(h, v === 0 ? 0 : 1)} fill={BLUE} opacity="0.85" />;
              })}
            {quarters.map((q, i) => (
              <rect key={`h${i}`} x={PL + band * i} y={PT} width={band} height={plotH} fill="transparent"><title>{`${fmtYm(q.date)}: ${fmtFullIn(q[key], ccy)}`}</title></rect>
            ))}
          </svg>
        </>
      )}
    </div>
  );
}

function ProceedsCard({ f, ccy }) {
  const row = (label, value, strong) => (
    <div data-testid={`flow-row-${label.toLowerCase().replace(/\W+/g, "-")}`} key={label}
      style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 12px", borderBottom: strong ? "none" : "1px solid var(--ink-color-global-border-subtle)",
        background: strong ? "var(--ink-color-global-surface-lightgray-default)" : undefined, borderRadius: strong ? 6 : 0, fontWeight: strong ? 600 : 400 }}>
      <span style={{ ...sans, fontSize: FS.bodyLg }}>{label}</span>
      <span style={{ ...inkNum, fontSize: FS.bodyLg }}>{fmtFullIn(value, ccy)}</span>
    </div>
  );
  return (
    <div className="card" data-testid="flow-proceeds" style={{ padding: "16px 18px 12px", minWidth: 0 }}>
      <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, marginBottom: 6 }}>Net LP Proceeds</div>
      <div style={{ ...inkNum, fontSize: 22, fontWeight: 600 }} data-testid="flow-net-total">{fmtFullIn(f.totals.net, ccy)}</div>
      <div style={{ ...sans, fontSize: FS.micro, color: subtle, marginBottom: 14 }}>Projected</div>
      {row("Called Capital", -f.totals.called)}
      {row("Initial Capital Return", f.totals.roc)}
      {row("Hurdle Return", f.totals.pref)}
      {row("LP Profits", f.totals.profit)}
      {row("Net Proceeds", f.totals.net, true)}
      <div style={{ ...sans, fontSize: FS.small, color: subtle, marginTop: 10 }}>
        <div>Projected TVPI: {fmtX(f.tvpi, 2)}</div>
        <div>Projected IRR: {f.netIrr == null ? "—" : fmtPct(f.netIrr, 2)}</div>
      </div>
    </div>
  );
}

export default function LpCashFlows({ plan, res, onEdit }) {
  const [lpId, setLpId] = useState("all");
  const labels = lpLabels(plan);
  const lps = plan.lps ?? [];
  const share = lpClassShare(plan, lpId === "all" ? null : lpId);
  const f = useMemo(() => lpFlows(plan, res, share), [plan, res, share]);
  const ccy = plan.general.currency;
  const options = [{ id: "all", label: "All Limited Partners" }, ...lps.map((lp, i) => ({ id: lp.id, label: `${labels[i]} · ${fmtPct(lpShare(plan, lp.id), 1)}` }))];
  const pref = f?.totals.pref > 0;
  if (!f) return <div data-testid="mv-panel-lpflows" style={{ ...sans, color: subtle }}>Finish the plan's other steps to see LP cash flows.</div>;
  return (
    <div data-testid="lp-cash-flows">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>Showing returns for</span>
        <Dropdown testId="lp-pick" minWidth={240} value={options.some((o) => o.id === lpId) ? lpId : "all"} options={options} onChange={setLpId} />
        {lpId !== "all" && <span data-testid="lp-share" style={{ ...sans, fontSize: FS.small, color: subtle }}>{fmtPct(lpShare(plan, lpId), 2)} of LP commitments</span>}
      </div>
      <div style={{ ...sans, fontSize: FS.small, color: subtle, marginBottom: 16, maxWidth: "80ch" }}>
        This plan's projection, scaled to each LP's share of commitments. {lps.length === 0 && (
          <>Enter your LPs to see them one at a time. {onEdit && <Btn kind="link" onClick={() => onEdit("terms", "lps")} data-testid="lp-flows-enter">Add limited partners</Btn>}</>
        )}
      </div>
      <div style={{ ...sans, fontSize: FS.h3, fontWeight: 600, margin: "0 0 10px" }}>LP Cash Flows Over Time</div>
      <style>{`.lpf-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; } @media (max-width: 760px) { .lpf-grid { grid-template-columns: minmax(0, 1fr); } }`}</style>
      <div className="lpf-grid" data-testid="lp-flow-grid">
        <ProceedsCard f={f} ccy={ccy} />
        <FlowCard testId="flow-net" title="Net LP Proceeds Over Time" total={f.totals.net} quarters={f.series.net.quarters} ccy={ccy}
          info="What the LP has received less what it has paid in. It starts negative as capital is called and turns positive as the fund distributes." />
        <FlowCard testId="flow-called" title="LP Called Capital" total={f.totals.called} quarters={f.series.called.quarters} ccy={ccy}
          info="Capital called from the LP, including what pays management fees and fund expenses." />
        <FlowCard testId="flow-roc" title="LP Return of Contributed Capital" total={f.totals.roc} quarters={f.series.roc.quarters} ccy={ccy}
          info="Distributions that give the LP back the capital it paid in, before any preferred return or profit." />
        <FlowCard testId="flow-pref" title="Preferred Hurdle Return" total={f.totals.pref} quarters={f.series.pref.quarters} ccy={ccy}
          empty={pref ? null : "No preferred return in this waterfall."}
          info="The preferred return paid to the LP after its capital is back and before the GP starts earning carry." />
        <FlowCard testId="flow-profit" title="LP Profits after Carried Interest" total={f.totals.profit} quarters={f.series.profit.quarters} ccy={ccy}
          info="Everything the LP receives beyond its capital and preferred return, after the GP's carried interest." />
      </div>
    </div>
  );
}
