import { useEffect, useMemo, useRef, useState } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { Btn, Segmented } from "../../ui/components.jsx";
import { fmtCheckIn, fmtMIn, fmtX, fmtPct } from "../../ui/format.js";
import { simulateDetailed, dealsOfRun, healthChecks, runAt } from "../../model/construction/monteCarlo.js";
import { applyVariant } from "../../model/construction/optimize.js";
import { ChartCard, Tip, topRounded, C_TVPI } from "./charts.jsx";
import { InfoTip } from "../../ui/components.jsx";
import { useWidth } from "./ModelCharts.jsx";
import { Histogram } from "./MonteCarloCharts.jsx";
import { fmtCount } from "./fields.jsx";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const lab = { ...sans, fontSize: FS.micro, fill: MICRO };
const num = { ...inkNum, textAlign: "right", whiteSpace: "nowrap" };
const BLUE = C_TVPI;
const GREY = "var(--ink-color-global-data-viz-neutral-3)";
// Color-blind-checked in both themes; "still held" is the neutral because it hasn't resolved either way.
export const OUTCOME_COLORS = {
  graduated: "light-dark(#285DA3, #3987e5)",
  exit: "light-dark(#1baf7a, #199e70)",
  fail: "light-dark(#eb6834, #d95926)",
  held: GREY,
};
const OUTCOME_LABEL = { graduated: "Raised the next round", exit: "Exited", fail: "Written off", held: "Still held at the end" };

export const METRICS = [
  { id: "net", label: "Net TVPI", testId: "mc-metric-net" },
  { id: "gross", label: "Gross MOIC", testId: "mc-metric-gross" },
];
const metricName = (m) => (m === "gross" ? "gross MOIC" : "net TVPI");
const runField = (m) => (m === "gross" ? "grossMoic" : "netTvpi");
const years = (m) => `Year ${(m / 12).toFixed(m % 12 ? 1 : 0)}`;

function ticks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const TONE = {
  bad: { icon: "✕", label: "Problem", color: "var(--ink-color-global-feedback-negative-strong)" },
  warn: { icon: "!", label: "Watch", color: "var(--ink-color-global-feedback-warning-strong)" },
  good: { icon: "✓", label: "Good", color: "var(--ink-color-global-feedback-positive-strong)" },
};

export function HealthChecks({ checks }) {
  return (
    <div className="card" data-testid="mc-health" style={{ padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ ...sans, fontSize: FS.body, fontWeight: 700, marginBottom: 10 }}>Health checks</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {checks.map((c) => {
          const t = TONE[c.tone];
          return (
            <li key={c.id} data-testid={`mc-health-${c.id}`} data-tone={c.tone} style={{ display: "flex", gap: 10, alignItems: "flex-start", ...sans, fontSize: FS.small, lineHeight: 1.45 }}>
              <span aria-hidden="true" style={{ flex: "none", width: 18, height: 18, borderRadius: 9, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                color: "var(--ink-color-global-surface-background-default)", background: t.color }}>{t.icon}</span>
              <span><span style={{ fontWeight: 700 }}>{t.label}: </span>{c.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Overview({ d, metric, target, facts }) {
  const s = d.summary;
  const m = metric === "gross" ? s.gross : s.net;
  const items = [
    { key: "p50", testId: "mc-kpi-median", label: `Median ${metricName(metric)}`, value: fmtX(m.p50), info: "The middle simulated fund: half do better, half worse." },
    { key: "mean", testId: "mc-kpi-mean", label: "Average", value: fmtX(m.mean), info: "Pulled up by the rare funds with a huge winner, so it sits above the median." },
    { key: "p10", testId: "mc-kpi-p10", label: "Bad case (P10)", value: fmtX(m.p10), info: "1 simulated fund in 10 does worse than this." },
    { key: "p90", testId: "mc-kpi-p90", label: "Good case (P90)", value: fmtX(m.p90), info: "1 simulated fund in 10 does better than this." },
    { key: "irr", testId: "mc-kpi-irr", label: "Median net IRR", value: fmtPct(s.netIrr.p50, 1), sub: `P10 ${fmtPct(s.netIrr.p10, 1)} · P90 ${fmtPct(s.netIrr.p90, 1)}` },
    { key: "above1", testId: "mc-kpi-above1", label: "Return LPs' money", value: fmtPct(s.chanceAbove1, 0), info: "Share of simulated funds with net TVPI of 1× or more." },
    { key: "target", testId: "mc-kpi-target", label: `Reach ${fmtX(target, 1)} net`, value: fmtPct(s.chanceTarget, 0) },
    { key: "fund", testId: "mc-kpi-fund", label: "Portfolio returns the fund", value: fmtPct(s.chanceReturnFund, 0), info: "Share of simulated funds whose companies end up worth at least the fund's total commitments, before fees and carry." },
    { key: "returners", testId: "mc-kpi-returners", label: "Fund returners", value: (s.returners ?? 0).toFixed(2), info: "Companies per simulated fund, on average, that are each worth the whole fund's commitments on their own." },
  ];
  return (
    <>
      <div className="card" data-testid="mc-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "14px 20px", padding: "16px 20px" }}>
        {items.map((it) => (
          <div key={it.key} data-testid={it.testId} style={{ minWidth: 0 }}>
            <div style={{ ...sans, fontSize: FS.small, ...subtle, display: "flex", alignItems: "center", gap: 4 }}>
              {it.label}{it.info && <InfoTip label={`About ${it.label}`} portal width={260}>{it.info}</InfoTip>}
            </div>
            <div style={{ ...inkNum, fontSize: FS.h3 ?? 20, fontWeight: 700, lineHeight: "28px", whiteSpace: "nowrap" }}>{it.value}</div>
            {it.sub && <div style={{ ...sans, fontSize: FS.micro, ...subtle, whiteSpace: "nowrap" }}>{it.sub}</div>}
          </div>
        ))}
      </div>
      <div style={{ height: 16 }} />
      <Histogram hist={metric === "gross" ? s.histGross : s.hist} target={metric === "gross" ? null : target} label="This strategy"
        title={`${metric === "gross" ? "Gross MOIC" : "Net TVPI"} across simulated funds`} metricLabel={metric === "gross" ? "Gross MOIC" : "Net TVPI"}
        marker={metric === "gross" ? d.expected.grossMoic : d.expected.tvpi} />
      <HealthChecks checks={healthChecks(s, facts, target)} />
    </>
  );
}

/** Cash back over the fund's life, as a multiple: the median fund with the middle half and 8 in 10 of funds around it. */
export function FanChart({ bands, metric, liquidates }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const H = 260, PL = 44, PR = 16, PT = 14, PB = 28;
  const n = bands.length;
  const T = bands[n - 1].month;
  const max = Math.max(1.2, ...bands.map((b) => b.p90)) * 1.06;
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const x = (m) => PL + (m / (T || 1)) * plotW;
  const y = (v) => PT + (1 - v / max) * plotH;
  const area = (lo, up) => `M ${bands.map((b) => `${x(b.month)} ${y(b[up])}`).join(" L ")} L ${[...bands].reverse().map((b) => `${x(b.month)} ${y(b[lo])}`).join(" L ")} Z`;
  const line = bands.map((b, i) => `${i ? "L" : "M"} ${x(b.month)} ${y(b.p50)}`).join(" ");
  const yearTicks = Array.from({ length: Math.floor(T / 12) + 1 }, (_, k) => k * 12).filter((m, k, all) => all.length <= 12 || k % 2 === 0);
  const what = metric === "gross" ? "Cash returned ÷ invested (gross)" : "Distributions to LPs ÷ capital called (net DPI)";
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>When</th><th>Bad case (P10)</th><th>P25</th><th>Median</th><th>P75</th><th>Good case (P90)</th></tr></thead>
      <tbody>{bands.filter((b) => b.month % 12 === 0 || b.month === T).map((b) => (
        <tr key={b.month}><td>{years(b.month)}</td>{["p10", "p25", "p50", "p75", "p90"].map((k) => <td key={k} style={num}>{fmtX(b[k])}</td>)}</tr>
      ))}</tbody>
    </table>
  );
  const h = hi != null ? bands[hi] : null;
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const m = ((e.clientX - r.left) / r.width * W - PL) / plotW * T;
    let best = 0;
    bands.forEach((b, i) => { if (Math.abs(b.month - m) < Math.abs(bands[best].month - m)) best = i; });
    setHi(best);
  };
  return (
    <ChartCard title="Cash back over time" testId="mc-fan"
      info={`${what}, across every simulated fund, against all the capital the fund ends up using.${liquidates ? " The fund sells what it still holds at the end of its term, so the last point is the fund's final multiple." : " An evergreen fund keeps what it holds, so this shows cash only."}`}
      legend={[["Median", BLUE], ["Middle half (P25–P75)", `color-mix(in srgb, ${BLUE} 34%, transparent)`], ["8 in 10 funds (P10–P90)", `color-mix(in srgb, ${BLUE} 14%, transparent)`]]} table={table}>
      <div ref={ref}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label={`${what} over the fund's life`}
          onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
          {ticks(0, max, 4).map((v) => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeDasharray={v ? "2 3" : undefined} />
              <text x={PL - 6} y={y(v) + 4} textAnchor="end" style={lab}>{fmtX(v, 1)}</text>
            </g>
          ))}
          {yearTicks.map((m) => <text key={m} x={x(m)} y={H - PB + 16} textAnchor="middle" style={lab}>{`Y${m / 12}`}</text>)}
          <path d={area("p10", "p90")} style={{ fill: `color-mix(in srgb, ${BLUE} 14%, transparent)` }} />
          <path d={area("p25", "p75")} style={{ fill: `color-mix(in srgb, ${BLUE} 30%, transparent)` }} />
          <line x1={PL} x2={W - PR} y1={y(1)} y2={y(1)} strokeDasharray="4 4" strokeWidth="1.5" style={{ stroke: "var(--ink-color-global-text-subtle)" }} />
          <text x={W - PR - 4} y={y(1) - 5} textAnchor="end" style={{ ...lab, fill: "var(--ink-color-global-text-subtle)" }}>1× money back</text>
          <path d={line} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
          {h && (
            <g>
              <line x1={x(h.month)} x2={x(h.month)} y1={PT} y2={PT + plotH} style={{ stroke: "var(--ink-color-global-text-subtle)" }} />
              <circle cx={x(h.month)} cy={y(h.p50)} r={4.5} fill={BLUE} style={{ stroke: "var(--ink-color-global-surface-background-default)" }} strokeWidth="2" />
            </g>
          )}
        </svg>
      </div>
      {h && <Tip left={Math.max(12, Math.min(88, (x(h.month) / W) * 100))} title={years(h.month)}
        rows={[["Good case (P90)", fmtX(h.p90), BLUE], ["Median", fmtX(h.p50), BLUE], ["Bad case (P10)", fmtX(h.p10), BLUE]]} />}
    </ChartCard>
  );
}

/** Per round, what the average simulated fund's companies did there: raised the next round, exited, failed or were still held. */
export function FunnelChart({ funnel }) {
  const [hi, setHi] = useState(null);
  const rows = funnel.filter((r) => r.reached > 0.05);
  const max = Math.max(...rows.map((r) => r.reached), 1);
  const parts = ["graduated", "exit", "fail", "held"];
  const val = (r, p) => ({ graduated: r.graduated, exit: r.exited, fail: r.failed, held: r.held }[p]);
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>Round</th><th>Companies</th>{parts.map((p) => <th key={p}>{OUTCOME_LABEL[p]}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td style={num}>{r.reached.toFixed(1)}</td>{parts.map((p) => <td key={p} style={num}>{val(r, p).toFixed(1)}</td>)}</tr>)}</tbody>
    </table>
  );
  return (
    <ChartCard title="Round funnel" testId="mc-funnel" table={table}
      info="For the average simulated fund: how many companies reach each round, and what happens to them there."
      legend={parts.map((p) => [OUTCOME_LABEL[p], OUTCOME_COLORS[p]])}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(70px, 110px) 52px minmax(0, 1fr)", rowGap: 8, columnGap: 10, alignItems: "center" }}>
        {rows.map((r) => [
          <span key={`n${r.name}`} style={{ ...sans, fontSize: FS.small }}>{r.name}</span>,
          <span key={`c${r.name}`} style={{ ...num, fontSize: FS.small, fontWeight: 700 }}>{r.reached.toFixed(1)}</span>,
          <div key={`b${r.name}`} style={{ position: "relative", height: 22 }}>
            <div style={{ display: "flex", gap: 2, height: "100%", width: `${(r.reached / max) * 100}%` }}>
              {parts.map((p) => {
                const v = val(r, p);
                if (!(v > 0.005)) return null;
                const id = `${r.name}-${p}`;
                return <span key={p} data-testid={`mc-funnel-${r.name}-${p}`} onMouseEnter={() => setHi(id)} onMouseLeave={() => setHi(null)}
                  style={{ flex: `${v} 0 0`, minWidth: 2, background: OUTCOME_COLORS[p], borderRadius: 3, opacity: hi == null || hi === id ? 1 : 0.6 }} />;
              })}
            </div>
            {hi?.startsWith(`${r.name}-`) && (() => {
              const p = hi.slice(r.name.length + 1);
              return <Tip left={50} title={`${r.name}: ${r.reached.toFixed(1)} companies`} rows={[[OUTCOME_LABEL[p], `${val(r, p).toFixed(1)} (${fmtPct(val(r, p) / r.reached, 0)})`, OUTCOME_COLORS[p]]]} />;
            })()}
          </div>,
        ])}
      </div>
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 8 }}>Companies per simulated fund, on average. Bar length is how many reach the round.</div>
    </ChartCard>
  );
}

/** Per outcome bucket: the share of companies beside the share of all value they produce. */
export function DealBuckets({ deals }) {
  const [hi, setHi] = useState(null);
  const total = deals.reduce((s, b) => s + b.companies, 0) || 1;
  const rows = deals.map((b) => ({ ...b, coShare: b.companies / total }));
  const max = Math.max(...rows.map((r) => Math.max(r.coShare, r.share)), 0.01);
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>Company outcome</th><th>Companies per fund</th><th>Share of companies</th><th>Share of value</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{r.label}</td><td style={num}>{r.companies.toFixed(1)}</td><td style={num}>{fmtPct(r.coShare, 0)}</td><td style={num}>{fmtPct(r.share, 0)}</td></tr>)}</tbody>
    </table>
  );
  const bar = (v, color, k) => (
    <div style={{ height: 9, display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ height: 9, width: `${(v / max) * 100}%`, minWidth: v > 0 ? 2 : 0, background: color, borderRadius: "0 3px 3px 0", opacity: hi == null || hi === k ? 1 : 0.55 }} />
      <span style={{ ...inkNum, fontSize: FS.micro, ...subtle }}>{fmtPct(v, 0)}</span>
    </div>
  );
  return (
    <ChartCard title="What each company returned" testId="mc-deal-buckets" table={table}
      info="Each company's value against everything the fund put into it. Companies still held at the end count at their last round's price."
      legend={[["Share of companies", GREY], ["Share of value", BLUE]]}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(80px, 110px) minmax(0, 1fr)", rowGap: 10, columnGap: 10, alignItems: "center" }}>
        {rows.map((r) => [
          <span key={`l${r.id}`} style={{ ...sans, fontSize: FS.small }}>{r.label}</span>,
          <div key={`b${r.id}`} data-testid={`mc-bucket-${r.id}`} style={{ display: "grid", gap: 2, position: "relative" }} onMouseEnter={() => setHi(r.id)} onMouseLeave={() => setHi(null)}>
            {bar(r.coShare, GREY, r.id)}{bar(r.share, BLUE, r.id)}
            {hi === r.id && <Tip left={50} title={r.label} rows={[["Companies per fund", r.companies.toFixed(1), GREY], ["Share of companies", fmtPct(r.coShare, 0), GREY], ["Share of value", fmtPct(r.share, 0), BLUE]]} />}
          </div>,
        ])}
      </div>
    </ChartCard>
  );
}

/** How much of a fund's value comes from its best few companies: the power law. */
export function Concentration({ concentration, companies }) {
  const [hi, setHi] = useState(null);
  const rows = concentration.filter((c) => c.top < companies || c.top === 1);
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>Best companies</th><th>Share of the fund's value</th></tr></thead>
      <tbody>{rows.map((c) => <tr key={c.top}><td>Top {c.top}</td><td style={num}>{fmtPct(c.share, 0)}</td></tr>)}</tbody>
    </table>
  );
  const H = 150, top = 18;
  return (
    <ChartCard title="Power law" testId="mc-concentration" table={table} legend={[]}
      info="The average share of a simulated fund's value from its best 1, 3, 5, 10 and 20 companies.">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, gap: 12, alignItems: "end", height: H }}>
        {rows.map((c) => (
          <div key={c.top} data-testid={`mc-top-${c.top}`} onMouseEnter={() => setHi(c.top)} onMouseLeave={() => setHi(null)}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", position: "relative" }}>
            <span style={{ ...inkNum, fontSize: FS.small, fontWeight: 700, marginBottom: 4 }}>{fmtPct(c.share, 0)}</span>
            <svg width="100%" height={(H - top - 22) * c.share + 2} preserveAspectRatio="none" viewBox={`0 0 40 ${(H - top - 22) * c.share + 2}`} style={{ display: "block" }}>
              <path d={topRounded(4, 0, 32, (H - top - 22) * c.share + 2, 4)} fill={BLUE} opacity={hi == null || hi === c.top ? 1 : 0.55} />
            </svg>
            <span style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 4 }}>Top {c.top}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

const PAGE = 25;

export function SimTable({ runs, metric, onOpen }) {
  const field = runField(metric);
  const order = useMemo(() => Array.from({ length: runs.n }, (_, i) => i).sort((a, b) => runs[field][b] - runs[field][a] || a - b), [runs, field]);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(order.length / PAGE);
  const jump = (rank) => setPage(Math.floor(rank / PAGE));
  const shown = order.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="card" data-testid="mc-sim-table" style={{ padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ ...sans, fontSize: FS.body, fontWeight: 700 }}>Every simulated fund</span>
        <span style={{ ...sans, fontSize: FS.micro, ...subtle }}>best first · {runs.n.toLocaleString("en-US")} funds</span>
        <span style={{ flex: 1 }} />
        <Btn kind="link" onClick={() => jump(0)} data-testid="mc-jump-best">Best</Btn>
        <Btn kind="link" onClick={() => jump(Math.floor(order.length / 2))} data-testid="mc-jump-median">Median</Btn>
        <Btn kind="link" onClick={() => jump(order.length - 1)} data-testid="mc-jump-worst">Worst</Btn>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="ledger" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Rank</th><th style={{ textAlign: "left" }}>Fund #</th>
              <th>{metric === "gross" ? "Gross MOIC" : "Net TVPI"}</th><th>Net IRR</th><th>Companies</th><th>Exits</th><th>Written off</th><th>Best company</th><th>Reserves</th><th />
            </tr>
          </thead>
          <tbody>
            {shown.map((i, k) => (
              <tr key={i} data-testid={`mc-sim-${i}`}>
                <td style={{ ...num, textAlign: "left" }}>{(page * PAGE + k + 1).toLocaleString("en-US")}</td>
                <td style={{ ...num, textAlign: "left" }}>{i + 1}</td>
                <td style={{ ...num, fontWeight: 700 }}>{fmtX(runs[field][i])}</td>
                <td style={num}>{fmtPct(runs.netIrr[i], 1)}</td>
                <td style={num}>{runs.companies[i]}</td>
                <td style={num}>{runs.exits[i]}</td>
                <td style={num}>{runs.fails[i]}</td>
                <td style={num}>{fmtPct(runs.top1[i], 0)} of value</td>
                <td style={num}>{runs.short[i] ? "Ran short" : "Enough"}</td>
                <td style={num}><Btn kind="link" onClick={() => onOpen(i)} data-testid={`mc-open-sim-${i}`}>View companies</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 10, ...sans, fontSize: FS.small }}>
        <Btn onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} data-testid="mc-page-prev">← Previous</Btn>
        <span data-testid="mc-page" style={subtle}>Page {page + 1} of {pages}</span>
        <Btn onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} data-testid="mc-page-next">Next →</Btn>
      </div>
    </div>
  );
}

const FILTERS = [{ id: "all", label: "All" }, { id: "exit", label: "Exited" }, { id: "fail", label: "Written off" }, { id: "held", label: "Still held" }];

export function DealTable({ fund, ccy, metric, onBack }) {
  const [filter, setFilter] = useState("all");
  const rows = fund.companies.filter((c) => filter === "all" || c.outcomeId === filter).sort((a, b) => b.value - a.value || a.id - b.id);
  const f = fund.fund;
  const stats = [
    [metric === "gross" ? "Gross MOIC" : "Net TVPI", fmtX(metric === "gross" ? f.grossMoic : f.netTvpi)],
    ["Net IRR", fmtPct(f.netIrr, 1)],
    ["Companies", f.companies],
    ["Invested", fmtMIn(f.invested, ccy)],
    ["Value", fmtMIn(f.value, ccy)],
    ["Follow-on checks", f.followOns],
  ];
  return (
    <div className="card" data-testid="mc-deals" style={{ padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Btn onClick={onBack} data-testid="mc-deals-back">← All funds</Btn>
        <span style={{ ...sans, fontSize: FS.body, fontWeight: 700 }}>Simulated fund #{fund.run + 1}</span>
        <span style={{ flex: 1 }} />
        <Segmented small value={filter} onChange={setFilter} options={FILTERS.map((x) => ({ ...x, label: `${x.label} (${x.id === "all" ? fund.companies.length : fund.companies.filter((c) => c.outcomeId === x.id).length})`, testId: `mc-deals-${x.id}` }))} />
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        {stats.map(([l, v]) => (
          <div key={l}><div style={{ ...inkNum, fontSize: FS.bodyLg, fontWeight: 700 }}>{v}</div><div style={{ ...sans, fontSize: FS.micro, ...subtle }}>{l}</div></div>
        ))}
      </div>
      <div style={{ overflowX: "auto", maxHeight: 420 }}>
        <table className="ledger" style={{ minWidth: 820 }}>
          <thead>
            <tr><th style={{ textAlign: "left" }}>Company</th><th style={{ textAlign: "left" }}>Allocation</th><th style={{ textAlign: "left" }}>Entry</th><th style={{ textAlign: "left" }}>Last round</th>
              <th style={{ textAlign: "left" }}>Outcome</th><th>Invested</th><th>Value</th><th>Multiple</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} data-testid={`mc-deal-${c.id}`}>
                <td>Company {c.id + 1}</td>
                <td>{c.allocation}</td>
                <td>{c.entryRound} · {years(c.entryMonth)}</td>
                <td>{c.finalRound}{c.followOns ? ` · ${c.followOns} follow-on${c.followOns > 1 ? "s" : ""}` : ""}</td>
                <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: OUTCOME_COLORS[c.outcomeId] }} />
                  {c.outcome}{c.endMonth != null ? ` · ${years(c.endMonth)}` : ""}
                </span></td>
                <td style={num}>{fmtCheckIn(c.cost, ccy)}</td>
                <td style={num}>{fmtCheckIn(c.value, ccy)}</td>
                <td style={{ ...num, fontWeight: 700 }}>{fmtX(c.moic, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Where each company stands at month `m`: its round then, and whether it has exited or been written off. */
function stateAt(c, m) {
  let k = 0;
  for (let s = 0; s < c.steps.length; s++) if (c.steps[s].month <= m) k = s;
  const done = c.endMonth != null && c.endMonth <= m;
  return { live: c.entryMonth <= m, round: c.steps[k].round, status: done ? c.outcomeId : "active", at: done ? c.endMonth : c.steps[k].month };
}

/** The median simulated fund, month by month. */
export function Replay({ fund, rounds, ccy }) {
  const [ref, W] = useWidth();
  const T = fund.months;
  const calm = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [m, setM] = useState(calm ? T : 0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  useEffect(() => {
    if (!playing) return undefined;
    let last = null;
    const tick = (now) => {
      if (last != null) setM((v) => { const nv = Math.min(T, v + ((now - last) / 1000) * 12); if (nv >= T) setPlaying(false); return nv; });
      last = now;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, T]);
  const month = Math.floor(m);
  const lanes = rounds.filter((r) => fund.companies.some((c) => c.steps.some((s) => s.round === r)));
  const H = Math.max(200, 40 + lanes.length * 52), PL = 84, PR = 16, PT = 16, PB = 26;
  const plotW = Math.max(10, W - PL - PR), laneH = (H - PT - PB) / Math.max(1, lanes.length);
  const x = (t) => PL + 18 + (t / (T || 1)) * (plotW - 36);
  const yOf = (round) => PT + (lanes.length - 1 - lanes.indexOf(round) + 0.5) * laneH;
  const cash = useMemo(() => {
    let inv = 0, back = 0;
    return fund.invest.map((v, t) => { inv += v; back += fund.proceeds[t]; return [inv, back]; });
  }, [fund]);
  const [inv, back] = cash[month];
  const states = fund.companies.map((c) => ({ c, s: stateAt(c, month) })).filter((x) => x.s.live);
  const count = (st) => states.filter((x) => x.s.status === st).length;
  const maxMoic = Math.max(1, ...fund.companies.map((c) => c.moic));
  const r = (c, st) => (st === "exit" ? 5 + 13 * Math.sqrt(c.moic / maxMoic) : st === "fail" ? 4 : 6);
  const color = (st) => (st === "active" ? OUTCOME_COLORS.graduated : OUTCOME_COLORS[st]);
  const counters = [
    ["Fund month", `${month} · ${years(month)}`],
    ["Deployed", fmtMIn(inv, ccy)],
    ["Returned", fmtMIn(back, ccy)],
    ["Running multiple", fmtX(inv > 0 ? back / inv : 0)],
    ["Active", count("active")],
    ["Exits", count("exit")],
    ["Written off", count("fail")],
  ];
  return (
    <div className="card" data-testid="mc-replay" style={{ padding: "16px 20px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ ...sans, fontSize: FS.body, fontWeight: 700 }}>Replay: the median fund</span>
        <span style={{ ...sans, fontSize: FS.micro, ...subtle }}>simulated fund #{fund.run + 1} · {fmtX(fund.fund.netTvpi)} net TVPI</span>
        <span style={{ flex: 1 }} />
        <Btn kind="primary" onClick={() => { if (m >= T) setM(0); setPlaying((p) => !p); }} data-testid="mc-replay-play">{playing ? "Pause" : m >= T ? "Play again" : "Play"}</Btn>
        <Btn onClick={() => { setPlaying(false); setM(0); }} data-testid="mc-replay-reset">Reset</Btn>
      </div>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 8 }}>
        {counters.map(([l, v]) => <div key={l} data-testid={`mc-replay-${l.toLowerCase().replace(/ /g, "-")}`}><div style={{ ...inkNum, fontSize: FS.bodyLg, fontWeight: 700 }}>{v}</div><div style={{ ...sans, fontSize: FS.micro, ...subtle }}>{l}</div></div>)}
      </div>
      <div ref={ref}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label={`Companies of the median simulated fund at month ${month}`}>
          {lanes.map((l, i) => (
            <g key={l}>
              <rect x={PL} y={PT + i * laneH} width={plotW} height={laneH} style={{ fill: i % 2 ? "transparent" : "var(--ink-color-global-surface-lightgray-default)" }} opacity="0.5" />
              <text x={PL - 8} y={yOf(l) + 4} textAnchor="end" style={lab}>{l}</text>
            </g>
          ))}
          {Array.from({ length: Math.floor(T / 12) + 1 }, (_, k) => k * 12).map((t) => <text key={t} x={x(t)} y={H - PB + 16} textAnchor="middle" style={lab}>{`Y${t / 12}`}</text>)}
          <line x1={x(m)} x2={x(m)} y1={PT} y2={H - PB} style={{ stroke: "var(--ink-color-global-text-subtle)" }} strokeDasharray="3 3" />
          {states.map(({ c, s }) => (
            <circle key={c.id} cx={x(s.at)} cy={yOf(s.round) + ((((c.id * 2654435761) >>> 0) % 1000) / 1000 - 0.5) * laneH * 0.7} r={r(c, s.status)}
              fill={s.status === "fail" ? "none" : color(s.status)} stroke={s.status === "fail" ? color("fail") : "var(--ink-color-global-surface-background-default)"}
              strokeWidth={2} opacity={s.status === "fail" ? 0.7 : 0.9} style={{ transition: calm ? "none" : "cx .35s ease, cy .35s ease, r .35s ease" }}>
              <title>{`Company ${c.id + 1} · ${c.allocation} · ${s.status === "active" ? `at ${s.round}` : s.status === "exit" ? `exited at ${fmtX(c.moic, 1)}` : "written off"}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <input type="range" min={0} max={T} step={1} value={month} onChange={(e) => { setPlaying(false); setM(Number(e.target.value)); }}
        aria-label="Fund month" data-testid="mc-replay-scrub" style={{ width: "100%", marginTop: 6 }} />
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
        <span>Each dot is a company at its latest event: it moves right and up as it raises rounds, then exits or is written off.</span>
        {[["active", "Still going"], ["exit", "Exited (bigger = higher multiple)"], ["fail", "Written off"]].map(([st, l]) => (
          <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: st === "fail" ? "none" : color(st), border: st === "fail" ? `2px solid ${color(st)}` : "none" }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "time", label: "Over time" },
  { id: "portfolio", label: "Portfolio" },
  { id: "sims", label: "Simulated funds" },
  { id: "replay", label: "Replay" },
];

/** The plan with a strategy applied, or the plan itself for "your plan today". */
const planFor = (plan, row) => (row.base || !row.variant ? plan : applyVariant(structuredClone(plan), row.variant));

export default function DeepDive({ plan, out, row, metric, label }) {
  const ccy = plan.general.currency;
  const [view, setView] = useState("overview");
  const [state, setState] = useState({ key: null, data: null });
  const [openRun, setOpenRun] = useState(null);
  const key = `${row.key}|${JSON.stringify(row.variant ?? {})}|${JSON.stringify(out.settings)}|${out.at}`;
  const strategyPlan = useMemo(() => planFor(plan, row), [plan, row]);
  useEffect(() => {
    let live = true;
    setOpenRun(null);
    // Off the click, so the spinner paints before a few hundred milliseconds of simulating.
    const id = setTimeout(() => {
      const data = simulateDetailed(strategyPlan, { settings: out.settings, target: out.target, objective: out.objective });
      if (live) setState({ key, data });
    }, 0);
    return () => { live = false; clearTimeout(id); };
  }, [key, strategyPlan, out.settings, out.target, out.objective]);
  const d = state.key === key ? state.data : null;
  const median = useMemo(() => (d ? dealsOfRun(strategyPlan, out.settings, runAt(d.runs, runField(metric), 0.5)) : null), [d, strategyPlan, out.settings, metric]);
  const opened = useMemo(() => (d && openRun != null ? dealsOfRun(strategyPlan, out.settings, openRun) : null), [d, openRun, strategyPlan, out.settings]);
  return (
    <section data-testid="mc-deep-dive" style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ ...sans, fontSize: FS.h3, fontWeight: 700 }}>Inside the simulation: {label}</span>
        <span style={{ flex: 1 }} />
        <Segmented value={view} onChange={setView} options={VIEWS.map((v) => ({ ...v, testId: `mc-view-${v.id}` }))} />
      </div>
      {!d ? (
        <div data-testid="mc-deep-loading" style={{ ...sans, fontSize: FS.small, ...subtle, padding: "28px 0", textAlign: "center" }}>Playing out {out.settings.runs.toLocaleString("en-US")} funds…</div>
      ) : (
        <div data-testid={`mc-view-body-${view}`}>
          {view === "overview" && <Overview d={d} metric={metric} target={out.target} facts={row.facts} />}
          {view === "time" && <FanChart bands={d.bands[metric]} metric={metric} liquidates={d.liquidates} />}
          {view === "portfolio" && (
            <>
              <FunnelChart funnel={d.funnel} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 16 }}>
                <DealBuckets deals={d.deals} />
                <Concentration concentration={d.concentration} companies={d.summary.companies} />
              </div>
            </>
          )}
          {view === "sims" && (opened ? <DealTable fund={opened} ccy={ccy} metric={metric} onBack={() => setOpenRun(null)} /> : <SimTable runs={d.runs} metric={metric} onOpen={setOpenRun} />)}
          {view === "replay" && median && <Replay fund={median} rounds={d.funnel.map((f) => f.name)} ccy={ccy} />}
          <div style={{ ...sans, fontSize: FS.micro, ...subtle }}>
            {fmtCount(d.summary.companies)} companies per fund on average · {d.summary.exits.toFixed(1)} exit, {d.summary.fails.toFixed(1)} are written off and {d.summary.held.toFixed(1)} are still held at the end.
          </div>
        </div>
      )}
    </section>
  );
}
