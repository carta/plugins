import { useState } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { fmtMIn, fmtX } from "../../ui/format.js";
import { ChartCard, Tip, C_TVPI, C_DPI, topRounded } from "./charts.jsx";

const W = 960, PL = 56, PR = 24, PT = 20, PB = 34;
const lab = { ...sans, fontSize: FS.micro, fill: MICRO };
const GOOD = "var(--ink-color-global-data-viz-positive-3)";
const BAD = "var(--ink-color-global-data-viz-negative-3)";
const NEUTRAL = "var(--ink-color-global-data-viz-neutral-3)";
const AXIS = { stroke: "var(--ink-color-global-border-subtle)" };

/** Gross MOIC stepping down through fees and carry to net TVPI. */
export function BridgeChart({ bridge, flat }) {
  const [hi, setHi] = useState(null);
  const H = 280;
  const steps = bridge.steps;
  const top = Math.max(...steps.map((s) => s.value)) * 1.12;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const band = plotW / steps.length, bw = Math.min(96, band * 0.6);
  const y = (v) => PT + (1 - v / top) * plotH;
  let run = 0;
  const bars = steps.map((s, i) => {
    const from = s.total ? 0 : run, to = s.total ? s.value : run + s.value;
    if (s.total) run = s.value; else run += s.value;
    return { ...s, i, lo: Math.min(from, to), hi: Math.max(from, to), end: to };
  });
  const color = (b) => (b.total ? (b.id === "net" ? C_TVPI : NEUTRAL) : BAD);
  const table = (
    <table className="ledger"><thead><tr><th style={{ textAlign: "left" }}>Step</th><th>Turns of paid-in</th></tr></thead>
      <tbody>{steps.map((s) => <tr key={s.id}><td>{s.label}</td><td style={{ textAlign: "right" }}>{s.total ? fmtX(s.value, 2) : `−${fmtX(Math.abs(s.value), 2)}`}</td></tr>)}</tbody></table>
  );
  return (
    <ChartCard title="From gross to net" legend={[["Return", NEUTRAL], ["Cost to LPs", BAD], ["Net TVPI", C_TVPI]]} table={table} testId="bridge-chart" flat={flat}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Gross MOIC to net TVPI bridge">
        {[0, 1, 2, 3, 4, 5].filter((v) => v <= top).map((v) => (
          <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={AXIS} strokeDasharray={v ? "2 3" : ""} /><text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{v}×</text></g>
        ))}
        {bars.map((b, i) => {
          const cx = PL + band * i + band / 2;
          const h = Math.max(1, y(b.lo) - y(b.hi));
          return (
            <g key={b.id} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} opacity={hi == null || hi === i ? 1 : 0.55}>
              <rect x={PL + band * i} y={PT} width={band} height={plotH} fill="transparent" />
              <path d={topRounded(cx - bw / 2, y(b.hi), bw, h, 4)} fill={color(b)} />
              {i < bars.length - 1 && <line x1={cx + bw / 2} x2={cx + band - bw / 2} y1={y(b.end)} y2={y(b.end)} style={AXIS} strokeDasharray="3 3" />}
              <text x={cx} y={y(b.hi) - 6} textAnchor="middle" style={{ ...inkNum, fontSize: 12, fontWeight: 700, fill: "var(--ink-color-global-text-default)" }}>
                {b.total ? fmtX(b.value, 2) : `−${fmtX(Math.abs(b.value), 2)}`}
              </text>
              <text x={cx} y={H - PB + 20} textAnchor="middle" style={lab}>{b.label}</text>
            </g>
          );
        })}
      </svg>
    </ChartCard>
  );
}

/** Each assumption nudged down and up on its own, biggest swing on top. */
export function TornadoChart({ data, label, fmt, flat }) {
  const [hi, setHi] = useState(null);
  const rows = data.rows;
  const rowH = 38, LW = 250;
  const H = PT + rows.length * rowH + 30;
  const span = Math.max(...rows.map((r) => Math.max(Math.abs(r.low - data.base), Math.abs(r.high - data.base)))) * 1.15 || 1;
  const plotW = W - LW - PR;
  const x = (v) => LW + ((v - data.base) / span / 2 + 0.5) * plotW;
  const table = (
    <table className="ledger"><thead><tr><th style={{ textAlign: "left" }}>Assumption</th><th>Lower</th><th>{label} (lower)</th><th>Higher</th><th>{label} (higher)</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{r.label}</td><td style={{ textAlign: "right" }}>{r.lowLabel}</td><td style={{ textAlign: "right" }}>{fmt(r.low)}</td><td style={{ textAlign: "right" }}>{r.highLabel}</td><td style={{ textAlign: "right" }}>{fmt(r.high)}</td></tr>)}</tbody></table>
  );
  const h = hi != null ? rows[hi] : null;
  return (
    <ChartCard title={`What moves ${label}`} legend={[["Assumption lowered", BAD], ["Assumption raised", GOOD]]} table={table} testId="tornado-chart" flat={flat}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label={`${label} when each assumption is lowered and raised`}>
        <line x1={x(data.base)} x2={x(data.base)} y1={PT - 6} y2={H - 24} style={{ stroke: "var(--ink-color-global-text-subtle)" }} />
        <text x={x(data.base)} y={H - 8} textAnchor="middle" style={{ ...lab, fontWeight: 700 }}>Plan {fmt(data.base)}</text>
        {rows.map((r, i) => {
          const yy = PT + i * rowH;
          const a = x(r.low), b = x(r.high);
          return (
            <g key={r.id} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} opacity={hi == null || hi === i ? 1 : 0.5}>
              <rect x={0} y={yy} width={W} height={rowH} fill="transparent" />
              <text x={LW - 12} y={yy + rowH / 2 + 4} textAnchor="end" style={{ ...sans, fontSize: FS.body, fill: "var(--ink-color-global-text-default)" }}>{r.label}</text>
              <rect x={Math.min(a, x(data.base))} y={yy + 8} width={Math.abs(a - x(data.base))} height={rowH - 16} fill={r.low < data.base ? BAD : GOOD} rx="2" />
              <rect x={Math.min(b, x(data.base))} y={yy + 8} width={Math.abs(b - x(data.base))} height={rowH - 16} fill={r.high < data.base ? BAD : GOOD} rx="2" />
              <text x={Math.min(a, b) - 6} y={yy + rowH / 2 + 4} textAnchor="end" style={{ ...inkNum, fontSize: 11, fill: "var(--ink-color-global-text-subtle)" }}>{fmt(Math.min(r.low, r.high))}</text>
              <text x={Math.max(a, b) + 6} y={yy + rowH / 2 + 4} style={{ ...inkNum, fontSize: 11, fill: "var(--ink-color-global-text-subtle)" }}>{fmt(Math.max(r.low, r.high))}</text>
            </g>
          );
        })}
      </svg>
      {h && <Tip left={Math.max(18, Math.min(82, (x(data.base) / W) * 100))} title={h.label}
        rows={[[`${h.lowLabel}`, fmt(h.low), h.low < data.base ? BAD : GOOD], [`${h.highLabel}`, fmt(h.high), h.high < data.base ? BAD : GOOD], ["Plan", fmt(data.base), "transparent"]]} />}
    </ChartCard>
  );
}

export function PacingChart({ years, ccy, flat }) {
  const [hi, setHi] = useState(null);
  const H = 280;
  const n = years.length;
  if (!n) return null;
  const maxV = Math.max(...years.map((r) => Math.max(r.called, r.distributed, r.cumulative)), 1) * 1.1;
  const minV = Math.min(0, ...years.map((r) => r.cumulative)) * 1.1;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const band = plotW / n, bw = Math.min(30, band * 0.34);
  const y = (v) => PT + (1 - (v - minV) / (maxV - minV)) * plotH;
  const line = years.map((r, i) => `${i ? "L" : "M"} ${(PL + band * i + band / 2).toFixed(1)} ${y(r.cumulative).toFixed(1)}`).join(" ");
  const ticks = [minV, 0, maxV / 1.1].filter((v, i, a) => a.indexOf(v) === i);
  const h = hi != null ? years[hi] : null;
  const table = (
    <table className="ledger"><thead><tr><th style={{ textAlign: "left" }}>Year</th><th>Called</th><th>Distributed</th><th>Net cash to date</th></tr></thead>
      <tbody>{years.map((r) => <tr key={r.year}><td>{r.year}</td><td style={{ textAlign: "right" }}>{fmtMIn(r.called, ccy)}</td><td style={{ textAlign: "right" }}>{fmtMIn(r.distributed, ccy)}</td><td style={{ textAlign: "right" }}>{fmtMIn(r.cumulative, ccy)}</td></tr>)}</tbody></table>
  );
  return (
    <ChartCard title="Capital calls and distributions" legend={[["Called", C_TVPI], ["Distributed", C_DPI], ["Net cash to date", "var(--ink-color-global-text-default)"]]} table={table} testId="pacing-chart" flat={flat}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Capital called and distributed by year">
        {ticks.map((v) => (
          <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={AXIS} strokeDasharray={v === 0 ? "" : "2 3"} /><text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtMIn(v, ccy)}</text></g>
        ))}
        {years.map((r, i) => {
          const cx = PL + band * i + band / 2;
          return (
            <g key={r.year} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} opacity={hi == null || hi === i ? 1 : 0.55}>
              <rect x={PL + band * i} y={PT} width={band} height={plotH} fill="transparent" />
              <path d={topRounded(cx - bw - 1, y(r.called), bw, Math.max(0, y(0) - y(r.called)), 3)} fill={C_TVPI} />
              <path d={topRounded(cx + 1, y(r.distributed), bw, Math.max(0, y(0) - y(r.distributed)), 3)} fill={C_DPI} />
              <text x={cx} y={H - PB + 20} textAnchor="middle" style={lab}>{r.year}</text>
            </g>
          );
        })}
        <path d={line} fill="none" stroke="var(--ink-color-global-text-default)" strokeWidth="2" strokeLinejoin="round" />
        {years.map((r, i) => <circle key={r.year} cx={PL + band * i + band / 2} cy={y(r.cumulative)} r="3" fill="var(--ink-color-global-text-default)" />)}
      </svg>
      {h && <Tip left={Math.max(8, Math.min(92, ((PL + band * hi + band / 2) / W) * 100))} title={String(h.year)}
        rows={[["Called", fmtMIn(h.called, ccy), C_TVPI], ["Distributed", fmtMIn(h.distributed, ccy), C_DPI], ["Net cash to date", fmtMIn(h.cumulative, ccy), "transparent"]]} />}
    </ChartCard>
  );
}
