import { useState } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { H3, Btn, InfoTip } from "../../ui/components.jsx";
import { fmtMIn, fmtX } from "../../ui/format.js";
import { fmtYm } from "./fields.jsx";
import { calendarPeriods } from "../../model/construction/analysis.js";

export const C_TVPI = "var(--ink-color-global-data-viz-blue-3)";
export const C_DPI = "var(--ink-color-global-data-viz-positive-3)";
export const C_INITIAL = "var(--ink-color-global-data-viz-blue-3)";
export const C_FOLLOW = "var(--ink-color-global-data-viz-positive-3)";

const W = 960, H = 260, PL = 46, PR = 64, PT = 16, PB = 32;
const lab = { ...sans, fontSize: FS.micro, fill: MICRO };

/** Bar with only its top corners rounded, so the flat end sits on the baseline. */
export function topRounded(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M ${x} ${y + h} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} Z`;
}

export function Legend({ items }) {
  return items.map(([t, c]) => (
    <span key={t} style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{t}
    </span>
  ));
}

export function Tip({ left, title, rows }) {
  return (
    <div style={{ position: "absolute", top: 0, left: `${left}%`, transform: "translateX(-50%)", pointerEvents: "none",
      background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8,
      padding: "8px 12px", boxShadow: "0 6px 18px rgba(16,24,40,.14)", whiteSpace: "nowrap", zIndex: 2 }}>
      <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 3 }}>{title}</div>
      {rows.map(([t, v, c]) => (
        <div key={t} style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
          <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{t}
          </span>
          <span style={{ ...inkNum, fontSize: FS.micro, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** `info` puts the explanation in a tooltip by the title. */
export function ChartCard({ title, legend, table, children, testId, info, flat = false }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className={flat ? undefined : "card"} style={flat ? { padding: "8px 0 4px", marginBottom: 8 } : { padding: "16px 20px 12px", marginBottom: 16 }} data-testid={testId}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><H3>{title}</H3>{info && <InfoTip label={`About ${title}`} portal>{info}</InfoTip>}</span>
        <span style={{ flex: 1 }} />
        <Legend items={legend} />
        <Btn kind="link" onClick={() => setShowTable((v) => !v)} style={{ fontSize: FS.small }}>{showTable ? "Show chart" : "Show table"}</Btn>
      </div>
      {showTable ? <div style={{ overflowX: "auto", maxHeight: 320 }}>{table}</div> : <div style={{ position: "relative" }}>{children}</div>}
    </div>
  );
}

export function ReturnsChart({ quarterly, ccy, flat }) {
  const [hi, setHi] = useState(null);
  const rows = quarterly.filter((q) => q.tvpi != null);
  const n = rows.length;
  if (n < 2) return null;
  const maxY = Math.max(1, ...rows.map((r) => r.tvpi)) * 1.08;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const x = (i) => PL + (i / (n - 1)) * plotW;
  const y = (v) => PT + (1 - v / maxY) * plotH;
  const path = (key) => rows.map((r, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(r[key]).toFixed(1)}`).join(" ");
  const grid = [0, 1, 2, 3, 4, 5].filter((v) => v <= maxY);
  const years = rows.map((r, i) => ({ i, y: r.date.slice(0, 4), m: r.date.slice(5) })).filter((t) => t.m === rows[0].date.slice(5));
  const step = Math.ceil(years.length / 8);
  const h = hi != null ? rows[hi] : null;
  const last = rows[n - 1];
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>Quarter</th><th>Called</th><th>Distributed</th><th>DPI</th><th>TVPI</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.month}><td>{fmtYm(r.date)}</td><td style={{ textAlign: "right" }}>{fmtMIn(r.called, ccy)}</td><td style={{ textAlign: "right" }}>{fmtMIn(r.lpDist, ccy)}</td><td style={{ textAlign: "right" }}>{fmtX(r.dpi)}</td><td style={{ textAlign: "right" }}>{fmtX(r.tvpi)}</td></tr>
      ))}</tbody>
    </table>
  );
  return (
    <ChartCard title="Net returns over the fund's life" legend={[["TVPI", C_TVPI], ["DPI", C_DPI]]} table={table} testId="returns-chart" flat={flat}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Net TVPI and DPI by quarter">
        {grid.map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeDasharray={v === 0 ? "" : "2 3"} />
            <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{v}×</text>
          </g>
        ))}
        {years.filter((_, k) => k % step === 0).map((t) => <text key={t.i} x={x(t.i)} y={H - PB + 20} textAnchor="middle" style={lab}>{t.y}</text>)}
        <path d={path("tvpi")} fill="none" stroke={C_TVPI} strokeWidth="2" strokeLinejoin="round" />
        <path d={path("dpi")} fill="none" stroke={C_DPI} strokeWidth="2" strokeLinejoin="round" />
        <text x={W - PR + 6} y={y(last.tvpi) + 4} style={{ ...inkNum, fontSize: 12, fontWeight: 700, fill: "var(--ink-color-global-text-default)" }}>TVPI {fmtX(last.tvpi)}</text>
        {Math.abs(y(last.tvpi) - y(last.dpi)) > 14 && (
          <text x={W - PR + 6} y={y(last.dpi) + 4} style={{ ...inkNum, fontSize: 12, fontWeight: 700, fill: "var(--ink-color-global-text-subtle)" }}>DPI {fmtX(last.dpi)}</text>
        )}
        {h && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={y(0)} style={{ stroke: "var(--ink-color-global-text-subtle)" }} opacity="0.35" />}
        {h && [["tvpi", C_TVPI], ["dpi", C_DPI]].map(([k, c]) => (
          <circle key={k} cx={x(hi)} cy={y(h[k])} r="4" fill={c} style={{ stroke: "var(--ink-color-global-surface-background-default)" }} strokeWidth="2" />
        ))}
        {rows.map((r, i) => (
          <rect key={r.month} x={x(i) - plotW / (n - 1) / 2} y={PT} width={plotW / (n - 1)} height={plotH} fill="transparent"
            onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />
        ))}
      </svg>
      {h && <Tip left={Math.max(8, Math.min(92, (x(hi) / W) * 100))} title={fmtYm(h.date)}
        rows={[["TVPI", fmtX(h.tvpi), C_TVPI], ["DPI", fmtX(h.dpi), C_DPI], ["Called", fmtMIn(h.called, ccy), "transparent"]]} />}
    </ChartCard>
  );
}

export function DeploymentChart({ initialInv, followInv, startDate, ccy, flat }) {
  const [hi, setHi] = useState(null);
  const years = calendarPeriods(startDate, initialInv.length).map(({ from, to, year }) => {
    const sum = (a) => a.slice(from, to).reduce((s, v) => s + v, 0);
    return { year, initial: sum(initialInv), follow: sum(followInv) };
  });
  while (years.length > 1 && years.at(-1).initial + years.at(-1).follow < 1) years.pop();
  const n = years.length;
  if (!n) return null;
  const maxY = Math.max(...years.map((r) => r.initial + r.follow)) * 1.1 || 1;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const band = plotW / n;
  const bw = Math.min(56, band * 0.62);
  const y = (v) => PT + (1 - v / maxY) * plotH;
  const ticks = [0, 0.5, 1].map((f) => f * maxY / 1.1);
  const h = hi != null ? years[hi] : null;
  const GAP = 2;
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>Year</th><th>Initial</th><th>Follow-on</th><th>Total</th></tr></thead>
      <tbody>{years.map((r) => (
        <tr key={r.year}><td>{r.year}</td><td style={{ textAlign: "right" }}>{fmtMIn(r.initial, ccy)}</td><td style={{ textAlign: "right" }}>{fmtMIn(r.follow, ccy)}</td><td style={{ textAlign: "right" }}>{fmtMIn(r.initial + r.follow, ccy)}</td></tr>
      ))}</tbody>
    </table>
  );
  return (
    <ChartCard title="Capital deployed by year" legend={[["Initial checks", C_INITIAL], ["Follow-ons", C_FOLLOW]]} table={table} testId="deployment-chart" flat={flat}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Initial and follow-on capital deployed by year">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeDasharray={v === 0 ? "" : "2 3"} />
            <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtMIn(v, ccy)}</text>
          </g>
        ))}
        {years.map((r, i) => {
          const cx = PL + band * i + band / 2;
          const x0 = cx - bw / 2;
          const hInit = y(0) - y(r.initial);
          const hFollow = y(0) - y(r.follow);
          return (
            <g key={r.year} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
              <rect x={PL + band * i} y={PT} width={band} height={plotH} fill="transparent" />
              {r.initial > 0 && (r.follow > 0
                ? <rect x={x0} y={y(r.initial)} width={bw} height={Math.max(0, hInit)} fill={C_INITIAL} opacity={hi == null || hi === i ? 1 : 0.55} />
                : <path d={topRounded(x0, y(r.initial), bw, Math.max(0, hInit), 4)} fill={C_INITIAL} opacity={hi == null || hi === i ? 1 : 0.55} />)}
              {r.follow > 0 && <path d={topRounded(x0, y(r.initial) - hFollow - (r.initial > 0 ? GAP : 0), bw, Math.max(0, hFollow), 4)} fill={C_FOLLOW} opacity={hi == null || hi === i ? 1 : 0.55} />}
              <text x={cx} y={H - PB + 20} textAnchor="middle" style={lab}>{r.year}</text>
            </g>
          );
        })}
      </svg>
      {h && <Tip left={Math.max(8, Math.min(92, ((PL + band * hi + band / 2) / W) * 100))} title={String(h.year)}
        rows={[["Initial checks", fmtMIn(h.initial, ccy), C_INITIAL], ["Follow-ons", fmtMIn(h.follow, ccy), C_FOLLOW], ["Total", fmtMIn(h.initial + h.follow, ccy), "transparent"]]} />}
    </ChartCard>
  );
}
