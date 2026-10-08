import { useEffect, useRef, useState } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { InfoTip } from "../../ui/components.jsx";
import { fmtMIn, fmtPct, fmtX } from "../../ui/format.js";
import { ChartCard, Legend, Tip, topRounded } from "./charts.jsx";
import { cellNum, fmtCount, fmtYm } from "./fields.jsx";
import { EXIT_FACTORS } from "../../model/construction/analysis.js";

const subtle = "var(--ink-color-global-text-subtle)";
const BLUE = "var(--ink-color-global-data-viz-blue-3)";
const GREEN = "var(--ink-color-global-data-viz-positive-3)";
const YELLOW = "var(--ink-color-global-data-viz-yellow-3)";
const BROWN = "var(--ink-color-global-data-viz-brown-3)";
const GREY = "var(--ink-color-global-data-viz-neutral-3)";
const INK = "var(--ink-color-global-text-default)";
const lab = { ...sans, fontSize: FS.micro, fill: MICRO };
const AXIS = { stroke: "var(--ink-color-global-border-subtle)" };

/** Rendered width, so an SVG draws at real pixels and its text stays sharp. */
export function useWidth(fallback = 800) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => { const v = Math.round(e.contentRect.width); if (v > 0) setW(v); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function StatStrip({ items, testId }) {
  return (
    <div className="card mv-strip" data-testid={testId} data-n={items.length} style={{ "--n": items.length }}>
      {items.map((it) => (
        <div key={it.key} data-testid={it.testId} className="mv-strip-cell">
          <div style={{ ...sans, fontSize: FS.small, color: subtle, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
            {it.label}{it.info && <InfoTip label={`About ${it.label}`} portal width={260}>{it.info}</InfoTip>}
          </div>
          <div style={{ ...inkNum, fontSize: FS.h3 ?? 20, fontWeight: 700, lineHeight: "28px", whiteSpace: "nowrap" }}>{it.value}</div>
          {it.sub && (
            <div style={{ ...sans, fontSize: FS.micro, fontWeight: 600, whiteSpace: "nowrap",
              color: it.tone === "good" ? "var(--ink-color-global-feedback-positive-strong)" : it.tone === "bad" ? "var(--ink-color-global-feedback-negative-strong)" : subtle }}>{it.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/** What LPs have been paid and still hold, stacked, against what they've paid in. */
export function ValueBuildChart({ quarterly, ccy, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const rows = quarterly.filter((q) => q.called > 0);
  const n = rows.length;
  if (n < 2) return null;
  const H = 240, PL = 56, PR = 16, PT = 12, PB = 26;
  const max = Math.max(...rows.map((r) => Math.max(r.lpDist + r.lpNav, r.called))) * 1.08 || 1;
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const x = (i) => PL + (i / (n - 1)) * plotW;
  const y = (v) => PT + (1 - v / max) * plotH;
  const area = (lo, hiF) => `${rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(hiF(r)).toFixed(1)}`).join(" ")} ${rows.map((r, i) => i).reverse().map((i) => `L${x(i).toFixed(1)},${y(lo(rows[i])).toFixed(1)}`).join(" ")} Z`;
  const paid = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.called).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1].map((f) => (f * max) / 1.08);
  const years = rows.map((r, i) => ({ i, y: r.date.slice(0, 4), m: r.date.slice(5) })).filter((t) => t.m === rows[0].date.slice(5));
  const step = Math.ceil(years.length / Math.max(2, Math.floor(plotW / 70)));
  const h = hi != null ? rows[hi] : null;
  const table = (
    <table className="ledger" data-testid="value-build-table">
      <thead><tr><th style={{ textAlign: "left" }}>Quarter</th><th>Paid in</th><th>Distributed</th><th>Still held</th><th>TVPI</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.month}><td>{fmtYm(r.date)}</td><td style={cellNum}>{fmtMIn(r.called, ccy)}</td><td style={cellNum}>{fmtMIn(r.lpDist, ccy)}</td><td style={cellNum}>{fmtMIn(r.lpNav, ccy)}</td><td style={cellNum}>{fmtX(r.tvpi)}</td></tr>
      ))}</tbody>
    </table>
  );
  return (
    <ChartCard title="How LP value builds" testId="value-build" info={info} table={table}
      legend={[["Distributed", GREEN], ["Still held (NAV)", BLUE], ["Paid in", INK]]}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="LP distributions and remaining value against capital paid in, by quarter"
          onMouseLeave={() => setHi(null)}>
          {ticks.map((v) => (
            <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={AXIS} strokeDasharray={v ? "2 3" : ""} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtMIn(v, ccy)}</text></g>
          ))}
          {years.filter((_, k) => k % step === 0).map((t) => <text key={t.i} x={x(t.i)} y={H - 6} textAnchor="middle" style={lab}>{t.y}</text>)}
          <path d={area(() => 0, (r) => r.lpDist)} fill={GREEN} opacity="0.85" />
          <path d={area((r) => r.lpDist, (r) => r.lpDist + r.lpNav)} fill={BLUE} opacity="0.55" />
          <path d={paid} fill="none" stroke={INK} strokeWidth="2" strokeDasharray="5 4" />
          {h && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={y(0)} style={{ stroke: subtle }} opacity="0.5" />}
          {h && <circle cx={x(hi)} cy={y(h.lpDist + h.lpNav)} r="4" fill={BLUE} style={{ stroke: "var(--ink-color-global-surface-background-default)" }} strokeWidth="2" />}
          {rows.map((r, i) => (
            <rect key={r.month} x={x(i) - plotW / (n - 1) / 2} y={PT} width={plotW / (n - 1)} height={plotH} fill="transparent" onMouseEnter={() => setHi(i)} />
          ))}
        </svg>
        {h && <Tip left={Math.max(12, Math.min(88, (x(hi) / W) * 100))} title={fmtYm(h.date)}
          rows={[["Distributed", fmtMIn(h.lpDist, ccy), GREEN], ["Still held", fmtMIn(h.lpNav, ccy), BLUE], ["Paid in", fmtMIn(h.called, ccy), INK], ["TVPI", fmtX(h.tvpi), "transparent"]]} />}
      </div>
    </ChartCard>
  );
}

export function IrrChart({ points, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const rows = points.filter((p) => p.net != null || p.gross != null);
  const n = rows.length;
  if (n < 2) return null;
  const H = 240, PL = 48, PR = 96, PT = 14, PB = 26;
  const vals = rows.flatMap((r) => [r.net, r.gross]).filter((v) => v != null);
  const step = 0.1;
  const lo = Math.min(0, Math.floor(Math.min(...vals) / step) * step), top = Math.max(step, Math.ceil(Math.max(...vals) / step) * step);
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const x = (i) => PL + (i / (n - 1)) * plotW;
  const y = (v) => PT + (1 - (v - lo) / (top - lo)) * plotH;
  const line = (k) => rows.map((r, i) => (r[k] == null ? null : `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`)).filter(Boolean).map((pt, i) => `${i ? "L" : "M"}${pt}`).join(" ");
  const ticks = [];
  const tStep = (top - lo) / step > 6 ? step * 2 : step;
  for (let v = Math.ceil(lo / tStep) * tStep; v <= top + 1e-9; v += tStep) ticks.push(Math.round(v * 100) / 100);
  const years = rows.map((r, i) => ({ i, y: r.date.slice(0, 4), m: r.date.slice(5) })).filter((t) => t.m === rows[0].date.slice(5));
  const yStep = Math.ceil(years.length / Math.max(2, Math.floor(plotW / 70)));
  const last = rows[n - 1];
  const h = hi != null ? rows[hi] : null;
  const pct = (v) => (v == null ? "—" : fmtPct(v, 1));
  const table = (
    <table className="ledger" data-testid="irr-table">
      <thead><tr><th style={{ textAlign: "left" }}>Quarter</th><th>Net IRR</th><th>Gross IRR</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.month}><td>{fmtYm(r.date)}</td><td style={cellNum}>{pct(r.net)}</td><td style={cellNum}>{pct(r.gross)}</td></tr>)}</tbody>
    </table>
  );
  const endLabels = [["Net", last.net, BLUE], ["Gross", last.gross, GREY]].filter(([, v]) => v != null);
  // Keep the two end labels apart when the lines finish close together.
  const ly = endLabels.map(([, v]) => y(v) + 4);
  if (ly.length === 2 && Math.abs(ly[0] - ly[1]) < 14) { const mid = (ly[0] + ly[1]) / 2; const up = ly[0] < ly[1] ? 0 : 1; ly[up] = mid - 7; ly[1 - up] = mid + 7; }
  return (
    <ChartCard title="IRR over time" testId="irr-chart" info={info} table={table} legend={[["Net IRR (LPs)", BLUE], ["Gross IRR (portfolio)", GREY]]}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="Net and gross IRR to date by quarter" onMouseLeave={() => setHi(null)}>
          {ticks.map((v) => (
            <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={v === 0 ? { stroke: "var(--ink-color-global-border-default)" } : AXIS} strokeDasharray={v === 0 ? "" : "2 3"} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtPct(v, 0)}</text></g>
          ))}
          {years.filter((_, k) => k % yStep === 0).map((t) => <text key={t.i} x={x(t.i)} y={H - 6} textAnchor="middle" style={lab}>{t.y}</text>)}
          <path d={line("gross")} fill="none" stroke={GREY} strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
          <path d={line("net")} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
          {endLabels.map(([l, v, c], k) => (
            <g key={l}>
              <circle cx={x(n - 1)} cy={y(v)} r="4" fill={c} style={{ stroke: "var(--ink-color-global-surface-background-default)" }} strokeWidth="2" />
              <text x={x(n - 1) + 8} y={ly[k]} style={{ ...lab, fill: INK, fontWeight: 700 }}>{l} {fmtPct(v, 1)}</text>
            </g>
          ))}
          {h && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={PT + plotH} style={{ stroke: subtle }} opacity="0.5" />}
          {h && [["net", BLUE], ["gross", GREY]].map(([k, c]) => h[k] != null && <circle key={k} cx={x(hi)} cy={y(h[k])} r="4" fill={c} style={{ stroke: "var(--ink-color-global-surface-background-default)" }} strokeWidth="2" />)}
          {rows.map((r, i) => (
            <rect key={r.month} x={x(i) - plotW / (n - 1) / 2} y={PT} width={plotW / (n - 1)} height={plotH} fill="transparent" onMouseEnter={() => setHi(i)} />
          ))}
        </svg>
        {h && <Tip left={Math.max(12, Math.min(88, (x(hi) / W) * 100))} title={fmtYm(h.date)} rows={[["Net IRR", pct(h.net), BLUE], ["Gross IRR", pct(h.gross), GREY]]} />}
      </div>
    </ChartCard>
  );
}

/** Each group's share of the capital against its share of the gross proceeds. */
export function ProceedsBreakdown({ rows, ccy, title = "Where returns come from", info, testId = "proceeds-breakdown" }) {
  const [hi, setHi] = useState(null);
  const capital = rows.reduce((s, r) => s + r.capital, 0), proceeds = rows.reduce((s, r) => s + r.proceeds, 0);
  if (!(capital > 0)) return null;
  const items = rows.map((r) => ({ ...r, capShare: r.capital / capital, procShare: proceeds > 0 ? r.proceeds / proceeds : 0 }));
  const max = Math.max(...items.map((r) => Math.max(r.capShare, r.procShare)), 0.01);
  const table = (
    <table className="ledger" data-testid={`${testId}-table`}>
      <thead><tr><th style={{ textAlign: "left" }}>Group</th><th>Companies</th><th>Capital</th><th>Multiple</th><th>Proceeds</th><th>Share of proceeds</th></tr></thead>
      <tbody>{items.map((r) => (
        <tr key={r.id}><td>{r.label}</td><td style={cellNum}>{fmtCount(r.companies)}</td><td style={cellNum}>{fmtMIn(r.capital, ccy)}</td><td style={cellNum}>{fmtX(r.moic)}</td><td style={cellNum}>{fmtMIn(r.proceeds, ccy)}</td><td style={cellNum}>{fmtPct(r.procShare, 0)}</td></tr>
      ))}</tbody>
    </table>
  );
  const h = hi != null ? items[hi] : null;
  return (
    <ChartCard title={title} testId={testId} info={info} table={table} legend={[]}>
      <div style={{ display: "flex", gap: 12, marginBottom: 10 }}><Legend items={[["Share of capital", GREY], ["Share of proceeds", BLUE]]} /></div>
      <div style={{ display: "grid", gap: 10, position: "relative" }} onMouseLeave={() => setHi(null)}>
        {items.map((r, i) => (
          <div key={r.id} data-testid={`${testId}-${r.id}`} onMouseEnter={() => setHi(i)}
            style={{ display: "grid", gridTemplateColumns: "minmax(70px, 22%) 1fr 52px", gap: 10, alignItems: "center", opacity: hi == null || hi === i ? 1 : 0.55 }}>
            <span style={{ ...sans, fontSize: FS.small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <span style={{ display: "grid", gap: 2 }} aria-hidden="true">
              <span style={{ height: 6, width: `${Math.max(0.5, (r.capShare / max) * 100)}%`, background: GREY, borderRadius: "0 3px 3px 0" }} />
              <span style={{ height: 10, width: `${Math.max(0.5, (r.procShare / max) * 100)}%`, background: BLUE, borderRadius: "0 4px 4px 0" }} />
            </span>
            <span style={{ ...inkNum, fontSize: FS.small, fontWeight: 700, textAlign: "right" }}>{fmtPct(r.procShare, 0)}</span>
          </div>
        ))}
        {h && <Tip left={50} title={h.label} rows={[["Capital", `${fmtMIn(h.capital, ccy)} · ${fmtPct(h.capShare, 0)}`, GREY], ["Proceeds", `${fmtMIn(h.proceeds, ccy)} · ${fmtPct(h.procShare, 0)}`, BLUE], ["Multiple", fmtX(h.moic), "transparent"]]} />}
      </div>
    </ChartCard>
  );
}

/** Light plans: per outcome, the share of companies beside the share of proceeds. */
export function OutcomeMix({ rows, ccy, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const companies = rows.reduce((s, r) => s + r.companies, 0), proceeds = rows.reduce((s, r) => s + r.proceeds, 0);
  if (!(companies > 0)) return null;
  const items = rows.map((r) => ({ ...r, coShare: r.companies / companies, procShare: proceeds > 0 ? r.proceeds / proceeds : 0 }));
  const H = 230, PL = 8, PR = 8, PT = 22, PB = 40;
  const max = Math.max(...items.map((r) => Math.max(r.coShare, r.procShare)), 0.01) * 1.05;
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const band = plotW / items.length, bw = Math.min(40, band * 0.3);
  const y = (v) => PT + (1 - v / max) * plotH;
  const h = hi != null ? items[hi] : null;
  const table = (
    <table className="ledger" data-testid="outcome-mix-table">
      <thead><tr><th style={{ textAlign: "left" }}>Outcome</th><th>Companies</th><th>Share</th><th>Invested</th><th>Multiple</th><th>Proceeds</th><th>Share</th></tr></thead>
      <tbody>{items.map((r) => (
        <tr key={r.id}><td>{r.label}</td><td style={cellNum}>{fmtCount(r.companies)}</td><td style={cellNum}>{fmtPct(r.coShare, 0)}</td><td style={cellNum}>{fmtMIn(r.capital, ccy)}</td><td style={cellNum}>{fmtX(r.moic)}</td><td style={cellNum}>{fmtMIn(r.proceeds, ccy)}</td><td style={cellNum}>{fmtPct(r.procShare, 0)}</td></tr>
      ))}</tbody>
    </table>
  );
  return (
    <ChartCard title="Outcome mix" testId="outcome-mix" info={info} table={table} legend={[["Share of companies", GREY], ["Share of proceeds", BLUE]]}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="Share of companies and share of proceeds by outcome" onMouseLeave={() => setHi(null)}>
          <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} style={AXIS} />
          {items.map((r, i) => {
            const cx = PL + band * i + band / 2;
            return (
              <g key={r.id} data-testid={`outcome-mix-${r.id}`} onMouseEnter={() => setHi(i)} opacity={hi == null || hi === i ? 1 : 0.55}>
                <rect x={PL + band * i} y={0} width={band} height={H} fill="transparent" />
                <path d={topRounded(cx - bw - 1, y(r.coShare), bw, Math.max(0, y(0) - y(r.coShare)), 4)} fill={GREY} />
                <path d={topRounded(cx + 1, y(r.procShare), bw, Math.max(0, y(0) - y(r.procShare)), 4)} fill={BLUE} />
                <text x={cx - bw / 2 - 1} y={y(r.coShare) - 6} textAnchor="middle" style={{ ...inkNum, fontSize: 11, fill: subtle }}>{fmtPct(r.coShare, 0)}</text>
                <text x={cx + bw / 2 + 1} y={y(r.procShare) - 6} textAnchor="middle" style={{ ...inkNum, fontSize: 11, fontWeight: 700, fill: INK }}>{fmtPct(r.procShare, 0)}</text>
                <text x={cx} y={H - PB + 16} textAnchor="middle" style={{ ...sans, fontSize: FS.small, fill: INK }}>{r.label}</text>
                <text x={cx} y={H - PB + 31} textAnchor="middle" style={lab}>{fmtCount(r.companies)} · {fmtX(r.moic, r.moic % 1 ? 1 : 0)}</text>
              </g>
            );
          })}
        </svg>
        {h && <Tip left={Math.max(14, Math.min(86, ((PL + band * hi + band / 2) / W) * 100))} title={h.label}
          rows={[["Companies", `${fmtCount(h.companies)} · ${fmtPct(h.coShare, 0)}`, GREY], ["Proceeds", `${fmtMIn(h.proceeds, ccy)} · ${fmtPct(h.procShare, 0)}`, BLUE], ["Gross multiple", fmtX(h.moic), "transparent"]]} />}
      </div>
    </ChartCard>
  );
}

// Each kind of milestone has its own marker, so the type reads without color alone.
const MARK = {
  fund: { borderRadius: 6, background: "var(--ink-color-global-surface-background-default)", border: `2px solid ${BLUE}` },
  build: { borderRadius: 2, background: BLUE, border: `2px solid ${BLUE}`, transform: "rotate(45deg) scale(0.8)" },
  value: { borderRadius: 6, background: "var(--ink-color-global-surface-background-default)", border: `2px solid ${GREEN}` },
  cash: { borderRadius: 6, background: GREEN, border: `2px solid ${GREEN}` },
};
const TRACKS = [
  { id: "fund", label: "Fund", kinds: ["fund"] },
  { id: "build", label: "Companies backed", kinds: ["build"] },
  { id: "cash", label: "LP returns", kinds: ["value", "cash"] },
];

export function Milestones({ items }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  if (items.length < 2) return null;
  const toM = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m - 1; };
  const a = toM(items[0].date), b = toM(items.at(-1).date);
  const GUT = 118, PAD = 14, plot = Math.max(10, W - GUT - 2 * PAD);
  const xOf = (ym) => GUT + PAD + (b > a ? ((toM(ym) - a) / (b - a)) * plot : 0);
  const ROW = 96, LINE = 46;
  const rows = TRACKS.map((t) => ({ ...t, items: items.filter((it) => t.kinds.includes(it.kind ?? "fund")) })).filter((t) => t.items.length);
  // Within a row, a label goes above its marker unless that would touch the previous one above; then below.
  const laid = rows.map((r) => {
    const ends = { up: -Infinity, down: -Infinity };
    return { ...r, items: r.items.map((it) => {
      const x = xOf(it.date);
      const w = Math.max((it.short ?? it.label).length * 7.4, fmtYm(it.date).length * 6.2) + 12;
      const left = Math.max(GUT, Math.min(W - w, x - w / 2));
      const side = ends.up <= left ? "up" : ends.down <= left ? "down" : ends.up <= ends.down ? "up" : "down";
      ends[side] = left + w;
      return { ...it, x, w, left, side };
    }) };
  });
  const build = laid.find((r) => r.id === "build")?.items ?? [];
  const H = laid.length * ROW + 24;
  const years = [];
  for (let y = Math.ceil(a / 12); y * 12 <= b; y++) years.push(y);
  const step = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor(plot / 70))));
  const h = hi && items.find((it) => it.id === hi);
  return (
    <div className="card" data-testid="milestones" style={{ padding: "14px 20px 10px", marginBottom: 16 }}>
      <div ref={ref} style={{ position: "relative", height: H }} onMouseLeave={() => setHi(null)}>
        {years.filter((_, i) => i % step === 0).map((y) => {
          const x = GUT + PAD + ((y * 12 - a) / (b - a || 1)) * plot;
          return (
            <span key={y}>
              <span style={{ position: "absolute", left: x, top: 0, bottom: 20, width: 1, background: "var(--ink-color-global-border-subtle)" }} />
              <span style={{ ...inkNum, position: "absolute", left: x, bottom: 0, transform: "translateX(-50%)", fontSize: FS.micro, color: subtle }}>{y}</span>
            </span>
          );
        })}
        {laid.map((r, ri) => {
          const y = ri * ROW + LINE;
          return (
            <div key={r.id} data-testid={`milestone-row-${r.id}`}>
              <span style={{ ...sans, position: "absolute", left: 0, top: y - 9, width: GUT - 12, fontSize: FS.small, fontWeight: 600, color: subtle }}>{r.label}</span>
              <span style={{ position: "absolute", left: GUT + PAD, right: PAD, top: y - 1, height: 2, background: "var(--ink-color-global-border-default)" }} />
              {r.id === "build" && build.length > 0 && (
                <span style={{ position: "absolute", left: xOf(items[0].date), width: Math.max(2, build.at(-1).x - xOf(items[0].date)), top: y - 4, height: 8, borderRadius: 4,
                  background: `color-mix(in srgb, ${BLUE} 25%, transparent)` }} />
              )}
              {r.items.map((p) => {
                const top = p.side === "up" ? y - 40 : y + 9;
                const on = hi == null || hi === p.id;
                return (
                  <div key={p.id} data-testid={`milestone-${p.id}`} onMouseEnter={() => setHi(p.id)} style={{ opacity: on ? 1 : 0.45 }}>
                    <span data-kind={p.kind ?? "fund"} style={{ position: "absolute", left: p.x - 6, top: y - 6, width: 12, height: 12, boxSizing: "border-box", ...MARK[p.kind ?? "fund"] }} />
                    <span style={{ position: "absolute", left: p.left, top, width: p.w, textAlign: p.left <= GUT ? "left" : p.left + p.w >= W ? "right" : "center", whiteSpace: "nowrap", cursor: "default" }}>
                      <span style={{ ...inkNum, fontSize: FS.small, fontWeight: 700, display: "block", lineHeight: "16px" }}>{p.short ?? p.label}</span>
                      <span style={{ ...sans, fontSize: FS.micro, color: subtle, display: "block", lineHeight: "14px" }}>{fmtYm(p.date)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {h && (() => {
          const x = xOf(h.date);
          const ri = laid.findIndex((r) => r.items.some((it) => it.id === h.id));
          return (
            <div role="tooltip" data-testid="milestone-tip" style={{ position: "absolute", left: Math.max(GUT, Math.min(W - 230, x - 115)), top: ri * ROW + LINE + (laid[ri].items.find((it) => it.id === h.id).side === "up" ? 12 : -64),
              width: 230, padding: "8px 10px", borderRadius: 8, background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)",
              boxShadow: "0 6px 18px rgba(16,24,40,.14)", zIndex: 2, pointerEvents: "none", ...sans, fontSize: FS.small }}>
              <div style={{ fontWeight: 700 }}>{h.label}</div>
              <div style={{ color: subtle }}>{fmtYm(h.date)}{h.value != null ? ` · TVPI ${fmtX(h.value)}` : h.detail ? ` · ${h.detail}` : ""}</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export function WaterfallBar({ tiers, ccy, info }) {
  const [hi, setHi] = useState(null);
  if (!tiers.length) return null;
  const max = Math.max(...tiers.map((t) => Math.max(0, t.lp) + Math.max(0, t.gp)), 1);
  const lp = tiers.reduce((s, t) => s + t.lp, 0), gp = tiers.reduce((s, t) => s + t.gp, 0);
  const table = (
    <table className="ledger" data-testid="mv-waterfall-table">
      <thead><tr><th style={{ textAlign: "left" }}>Tier</th><th>To LPs</th><th>To GP</th></tr></thead>
      <tbody>
        {tiers.map((t) => <tr key={t.id}><td>{t.label}</td><td style={cellNum}>{Math.abs(t.lp) < 0.5 ? "—" : fmtMIn(t.lp, ccy)}</td><td style={cellNum}>{Math.abs(t.gp) < 0.5 ? "—" : fmtMIn(t.gp, ccy)}</td></tr>)}
        <tr style={{ fontWeight: 700 }}><td>Total</td><td style={cellNum}>{fmtMIn(lp, ccy)}</td><td style={cellNum}>{fmtMIn(gp, ccy)}</td></tr>
      </tbody>
    </table>
  );
  const h = hi != null ? tiers[hi] : null;
  return (
    <ChartCard title="Waterfall split" testId="mv-waterfall" info={info} table={table} legend={[["To LPs", BLUE], ["To GP", YELLOW]]}>
      <div style={{ display: "grid", gap: 10, position: "relative" }} onMouseLeave={() => setHi(null)}>
        {tiers.map((t, i) => (
          <div key={t.id} data-testid={`mv-wf-${t.id}`} onMouseEnter={() => setHi(i)}
            style={{ display: "grid", gridTemplateColumns: "minmax(110px, 28%) 1fr 84px", gap: 10, alignItems: "center", opacity: hi == null || hi === i ? 1 : 0.55 }}>
            <span style={{ ...sans, fontSize: FS.small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
            <span style={{ display: "flex", gap: 2, height: 14 }} aria-hidden="true">
              {t.lp > 0.5 && <span style={{ flex: `0 0 ${(t.lp / max) * 100}%`, background: BLUE, borderRadius: t.gp > 0.5 ? "3px 0 0 3px" : 3 }} />}
              {t.gp > 0.5 && <span style={{ flex: `0 0 ${(t.gp / max) * 100}%`, background: YELLOW, borderRadius: t.lp > 0.5 ? "0 3px 3px 0" : 3 }} />}
            </span>
            <span style={{ ...inkNum, fontSize: FS.small, fontWeight: 700, textAlign: "right" }}>{fmtMIn(t.lp + t.gp, ccy)}</span>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 28%) 1fr 84px", gap: 10, borderTop: "1px solid var(--ink-color-global-border-subtle)", paddingTop: 8, ...sans, fontSize: FS.small }}>
          <span style={{ fontWeight: 700 }}>Total</span>
          <span style={{ color: subtle }}>LPs {fmtMIn(lp, ccy)} · GP {fmtMIn(gp, ccy)}{lp + gp > 0 ? ` (${fmtPct(gp / (lp + gp), 0)})` : ""}</span>
          <span style={{ ...inkNum, fontWeight: 700, textAlign: "right" }}>{fmtMIn(lp + gp, ccy)}</span>
        </div>
        {h && <Tip left={50} title={h.label} rows={[["To LPs", fmtMIn(h.lp, ccy), BLUE], ["To GP", fmtMIn(h.gp, ccy), YELLOW]]} />}
      </div>
    </ChartCard>
  );
}

const TURQ = "var(--ink-color-global-data-viz-turquoise-3)";
const RED = "var(--ink-color-global-data-viz-negative-3)";
const SURFACE = "var(--ink-color-global-surface-background-default)";
const yearTicks = (rows, plotW, at) => {
  const step = Math.ceil(rows.length / Math.max(2, Math.floor(plotW / 56)));
  return rows.map((r, i) => ({ i, label: String(r.year), x: at(i) })).filter((t) => t.i % step === 0);
};

const FLOW_COLORS = {
  initial: BLUE, followOn: BLUE, fees: YELLOW, expenses: BROWN, returned: GREY, uncalled: GREY,
  cost: BLUE, gain: GREEN, lp: BLUE, gp: TURQ, recycled: GREY,
};
const FLOW_FADE = { followOn: 0.55, uncalled: 0.35, recycled: 0.55 };

/** Commitments used, what the invested part becomes, and who is paid, as three bars on one scale. */
export function DollarFlow({ flow, ccy, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  if (!flow || !(flow.raised > 0)) return null;
  const narrow = W < 560;
  // Room for the band under the first bar; the last two bars sit closer.
  const GUT = narrow ? 0 : 150, PR = 8, BAR = 26, LABEL = narrow ? 18 : 0, GAPS = narrow ? [56, 18] : [54, 18];
  const total = (rows) => rows.reduce((s, r) => s + r.value, 0);
  const rows = [
    { id: "uses", title: "Commitments", sub: fmtMIn(flow.raised, ccy), segs: flow.uses },
    { id: "outcome", title: "What it becomes", sub: flow.multiple != null ? `${fmtX(flow.multiple)} on invested` : "", segs: flow.outcome },
    { id: "payout", title: "Who gets it", sub: fmtMIn(total(flow.payout), ccy), segs: flow.payout },
  ];
  const span = Math.max(...rows.map((r) => total(r.segs) + (r.id === "outcome" ? flow.lost : 0)), 1);
  const plotW = Math.max(10, W - GUT - PR);
  const k = plotW / span;
  const H = rows.length * (BAR + LABEL) + GAPS[0] + GAPS[1] + 4;
  const top = (i) => i * (BAR + LABEL) + GAPS.slice(0, i).reduce((a, b) => a + b, 0) + LABEL;
  const placed = rows.map((r, i) => {
    let x = GUT;
    const segs = r.segs.map((s) => { const out = { ...s, x, w: s.value * k }; x += s.value * k; return out; });
    return { ...r, y: top(i), segs, end: x };
  });
  const seg = (ri, id) => placed[ri].segs.find((s) => s.id === id);
  const ribbon = (x0, x1, y0, x2, x3, y1, key, color) => {
    const m = (y0 + y1) / 2;
    return <path key={key} d={`M${x0},${y0} C${x0},${m} ${x2},${m} ${x2},${y1} L${x3},${y1} C${x3},${m} ${x1},${m} ${x1},${y0} Z`} fill={color} opacity="0.16" />;
  };
  const inv0 = seg(0, "initial")?.x ?? GUT, inv1 = (seg(0, "followOn") ?? seg(0, "initial"))?.x + ((seg(0, "followOn") ?? seg(0, "initial"))?.w ?? 0);
  const cost = seg(1, "cost"), back = seg(1, "returned"), cash = seg(0, "returned");
  const bands = [
    cost && ribbon(inv0, inv1, placed[0].y + BAR, cost.x, cost.x + cost.w + flow.lost * k, placed[1].y, "inv", BLUE),
    cash && back && ribbon(cash.x, cash.x + cash.w, placed[0].y + BAR, back.x, back.x + back.w, placed[1].y, "cash", GREY),
  ].filter(Boolean);
  const all = placed.flatMap((r, ri) => r.segs.map((s) => ({ ...s, row: ri })));
  const h = hi != null ? all.find((s) => `${s.row}-${s.id}` === hi) : null;
  const shareOf = (s) => { const t = total(rows[s.row].segs); return t > 0 ? s.value / t : 0; };
  const table = (
    <table className="ledger" data-testid="dollar-flow-table">
      <thead><tr><th style={{ textAlign: "left" }}>Stage</th><th style={{ textAlign: "left" }}>Part</th><th>Amount</th><th>Share</th></tr></thead>
      <tbody>
        {flow.sources.length > 1 && flow.sources.map((s) => <tr key={`src-${s.id}`}><td>Money in</td><td>{s.label}</td><td style={cellNum}>{fmtMIn(s.value, ccy)}</td><td style={cellNum}>{fmtPct(s.value / flow.raised, 1)}</td></tr>)}
        {rows.map((r) => r.segs.map((s) => (
          <tr key={`${r.id}-${s.id}`}><td>{r.title}</td><td>{s.label}</td><td style={cellNum}>{fmtMIn(s.value, ccy)}</td><td style={cellNum}>{fmtPct(s.value / total(r.segs), 1)}</td></tr>
        )))}
        {flow.lost > 0.5 && <tr><td>What it becomes</td><td>Lost on investments</td><td style={cellNum}>{fmtMIn(flow.lost, ccy)}</td><td style={cellNum}>—</td></tr>}
      </tbody>
    </table>
  );
  return (
    <ChartCard title="Where the money goes" testId="dollar-flow" info={info} table={table} legend={[]}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img"
          aria-label="Commitments split into investments, fees and expenses, what the investments become, and how it is paid to LPs and the GP" onMouseLeave={() => setHi(null)}>
          {bands}
          {placed.map((r, ri) => (
            <g key={r.id} data-testid={`dollar-flow-${r.id}`}>
              {narrow
                ? <text x={0} y={r.y - 6} style={{ ...sans, fontSize: FS.small, fontWeight: 600, fill: INK }}>{r.title} <tspan style={{ ...lab, fontWeight: 400 }}>{r.sub}</tspan></text>
                : <>
                    <text x={0} y={r.y + 11} style={{ ...sans, fontSize: FS.small, fontWeight: 600, fill: INK }}>{r.title}</text>
                    <text x={0} y={r.y + 25} style={lab}>{r.sub}</text>
                  </>}
              {r.segs.map((s, si) => {
                const key = `${ri}-${s.id}`;
                const last = si === r.segs.length - 1 && !(r.id === "outcome" && flow.lost > 0.5);
                return (
                  <g key={s.id} data-testid={`dollar-flow-${r.id}-${s.id}`} onMouseEnter={() => setHi(key)} opacity={hi == null || hi === key ? 1 : 0.55}>
                    <rect x={s.x} y={r.y} width={Math.max(1, s.w - (last ? 0 : 2))} height={BAR} rx={si === 0 || last ? 4 : 0} fill={FLOW_COLORS[s.id] ?? GREY} fillOpacity={FLOW_FADE[s.id] ?? 1} />
                    {s.w > 74 && <text x={s.x + 8} y={r.y + 17} style={{ ...sans, fontSize: FS.micro, fontWeight: 600, fill: s.id === "gain" || s.id === "cost" || s.id === "lp" || s.id === "initial" ? "#fff" : INK }}>{s.w > 150 ? `${s.label} ` : ""}{fmtMIn(s.value, ccy)}</text>}
                  </g>
                );
              })}
              {r.id === "outcome" && flow.lost > 0.5 && (
                <g data-testid="dollar-flow-lost">
                  <rect x={r.end} y={r.y} width={flow.lost * k} height={BAR} rx={4} fill="none" stroke={RED} strokeDasharray="4 3" />
                  {flow.lost * k > 70 && <text x={r.end + 8} y={r.y + 17} style={{ ...lab, fill: INK }}>Lost {fmtMIn(flow.lost, ccy)}</text>}
                </g>
              )}
            </g>
          ))}
        </svg>
        {h && <Tip left={Math.max(14, Math.min(86, ((h.x + h.w / 2) / W) * 100))} title={`${rows[h.row].title}: ${h.label}`}
          rows={[["Amount", fmtMIn(h.value, ccy), FLOW_COLORS[h.id] ?? GREY], ["Share", fmtPct(shareOf(h), 1), "transparent"]]} />}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        <Legend items={[["Invested", BLUE], ["Management fees", YELLOW], ["Fund expenses", BROWN], ["Gain", GREEN], ["GP carry", TURQ], ["Uninvested or uncalled", GREY]]} />
      </div>
    </ChartCard>
  );
}

export function RoundOutcomes({ rows, info }) {
  const [hi, setHi] = useState(null);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.reached), 1);
  const PARTS = [["exited", "Exit here", GREEN], ["failed", "Fail here", RED], ["graduated", "Raise the next round", BLUE]];
  const table = (
    <table className="ledger" data-testid="round-outcomes-table">
      <thead><tr><th style={{ textAlign: "left" }}>Round</th><th>Companies reaching it</th><th>Exit here</th><th>Fail here</th><th>Raise the next round</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.round}><td>{r.round}</td><td style={cellNum}>{fmtCount(r.reached)}</td><td style={cellNum}>{fmtCount(r.exited)}</td><td style={cellNum}>{fmtCount(r.failed)}</td><td style={cellNum}>{fmtCount(r.graduated)}</td></tr>
      ))}</tbody>
    </table>
  );
  const h = hi != null ? rows[hi] : null;
  return (
    <ChartCard title="What happens to the companies" testId="round-outcomes" info={info} table={table} legend={PARTS.map(([, l, c]) => [l, c])}>
      <div style={{ display: "grid", gap: 10, position: "relative" }} onMouseLeave={() => setHi(null)}>
        {rows.map((r, i) => {
          const parts = PARTS.map(([k, , c]) => [k, r[k], c]).filter(([, v]) => v > 1e-6);
          return (
            <div key={r.round} data-testid={`round-outcomes-${i}`} onMouseEnter={() => setHi(i)}
              style={{ display: "grid", gridTemplateColumns: "minmax(70px, 18%) 1fr minmax(96px, auto)", gap: 10, alignItems: "center", opacity: hi == null || hi === i ? 1 : 0.55 }}>
              <span style={{ ...sans, fontSize: FS.small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.round}</span>
              <span style={{ display: "flex", gap: 2, height: 16, width: `${Math.max(1, (r.reached / max) * 100)}%` }} aria-hidden="true">
                {parts.map(([k, v, c], j) => (
                  <span key={k} style={{ flex: `${v} 0 0`, minWidth: 2, background: c, borderRadius: parts.length === 1 ? 4 : j === 0 ? "4px 0 0 4px" : j === parts.length - 1 ? "0 4px 4px 0" : 0 }} />
                ))}
              </span>
              <span style={{ ...inkNum, fontSize: FS.small, textAlign: "right", whiteSpace: "nowrap" }}><b>{fmtCount(r.reached)}</b> <span style={{ color: subtle }}>· {fmtCount(r.exited)} exit</span></span>
            </div>
          );
        })}
        {h && <Tip left={50} title={`${h.round}: ${fmtCount(h.reached)} companies`}
          rows={PARTS.map(([k, l, c]) => [l, `${fmtCount(h[k])} · ${fmtPct(h.reached > 0 ? h[k] / h.reached : 0, 0)}`, c])} />}
      </div>
    </ChartCard>
  );
}

// Allocations take hues in this order, so an allocation keeps its color whatever else is shown.
const SERIES = [BLUE, YELLOW, TURQ, BROWN, "var(--ink-color-global-data-viz-lime-3)", GREY];

export function OwnershipPath({ paths, ccy, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const rounds = [];
  for (const p of paths) for (const pt of p.points) if (!rounds.some((r) => r.name === pt.round)) rounds.push({ name: pt.round, stage: pt.stage });
  rounds.sort((a, b) => a.stage - b.stage);
  const n = rounds.length;
  if (!paths.length || n < 2) return null;
  const H = 230, PL = 48, PR = paths.length > 1 ? 120 : 64, PT = 14, PB = 28;
  const maxO = Math.max(...paths.flatMap((p) => p.points.map((pt) => pt.ownership)), 0.01);
  const top = Math.ceil((maxO * 1.1) / 0.01) * 0.01;
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const x = (name) => PL + (rounds.findIndex((r) => r.name === name) / (n - 1)) * plotW;
  const y = (v) => PT + (1 - v / top) * plotH;
  const tStep = top > 0.2 ? 0.1 : top > 0.08 ? 0.02 : 0.01;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += tStep) ticks.push(Math.round(v * 1000) / 1000);
  const own = (v) => fmtPct(v, v < 0.1 ? 2 : 1);
  const table = (
    <table className="ledger" data-testid="ownership-path-table">
      <thead><tr><th style={{ textAlign: "left" }}>Allocation</th>{rounds.map((r) => <th key={r.name}>{r.name}</th>)}</tr></thead>
      <tbody>{paths.map((p) => (
        <tr key={p.id}><td>{p.name}</td>{rounds.map((r) => { const pt = p.points.find((q) => q.round === r.name); return <td key={r.name} style={cellNum}>{pt ? own(pt.ownership) : "—"}</td>; })}</tr>
      ))}</tbody>
    </table>
  );
  const hr = hi != null ? rounds[hi] : null;
  // End labels in value order, nudged apart when lines finish close together.
  const order = paths.map((p, i) => [i, y(p.points.at(-1).ownership) + 4]).sort((a, b) => a[1] - b[1]);
  for (let k = 1; k < order.length; k++) if (order[k][1] - order[k - 1][1] < 14) order[k][1] = order[k - 1][1] + 14;
  const endY = Object.fromEntries(order);
  return (
    <ChartCard title="Ownership through the rounds" testId="ownership-path" info={info} table={table}
      legend={paths.length > 1 ? paths.map((p, i) => [p.name, SERIES[i % SERIES.length]]) : []}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="Ownership by round for each allocation" onMouseLeave={() => setHi(null)}>
          {ticks.map((v) => (
            <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={AXIS} strokeDasharray={v ? "2 3" : ""} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtPct(v, 0)}</text></g>
          ))}
          {rounds.map((r) => <text key={r.name} x={x(r.name)} y={H - 8} textAnchor="middle" style={lab}>{r.name}</text>)}
          {hr && <line x1={x(hr.name)} x2={x(hr.name)} y1={PT} y2={PT + plotH} style={{ stroke: subtle }} opacity="0.5" />}
          {paths.map((p, i) => {
            const c = SERIES[i % SERIES.length];
            const d = p.points.map((pt, j) => `${j ? "L" : "M"}${x(pt.round).toFixed(1)},${y(pt.ownership).toFixed(1)}`).join(" ");
            const last = p.points.at(-1);
            return (
              <g key={p.id} data-testid={`ownership-path-${p.id}`}>
                <path d={d} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
                {p.points.map((pt) => <circle key={pt.round} cx={x(pt.round)} cy={y(pt.ownership)} r="4" fill={c} style={{ stroke: SURFACE }} strokeWidth="2" />)}
                <text x={x(last.round) + 8} y={endY[i]} style={{ ...lab, fill: INK, fontWeight: 700 }}>
                  {paths.length > 1 ? `${p.name} ` : ""}{own(last.ownership)}
                </text>
              </g>
            );
          })}
          {rounds.map((r, i) => (
            <rect key={r.name} x={x(r.name) - plotW / (n - 1) / 2} y={PT} width={plotW / (n - 1)} height={plotH} fill="transparent" onMouseEnter={() => setHi(i)} />
          ))}
        </svg>
        {hr && <Tip left={Math.max(14, Math.min(86, (x(hr.name) / W) * 100))} title={hr.name}
          rows={paths.flatMap((p, i) => {
            const pt = p.points.find((q) => q.round === hr.name);
            if (!pt) return [];
            return [[paths.length > 1 ? p.name : "Ownership", own(pt.ownership), SERIES[i % SERIES.length]],
              ...(pt.check ? [[`${paths.length > 1 ? `${p.name} f` : "F"}ollow-on check`, fmtMIn(pt.check, ccy), "transparent"]] : [])];
          })} />}
      </div>
    </ChartCard>
  );
}

const COSTS = [["fees", "Management fees", YELLOW], ["expenses", "Fund expenses", BROWN], ["carry", "GP carry", TURQ]];

export function CostsByYear({ years, ccy, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const rows = years.filter((r, i) => i < years.length - 1 || r.fees + r.expenses + r.carry > 0.5);
  const n = rows.length;
  if (!n) return null;
  const H = 240, PL = 56, PR = 12, PT = 12, PB = 26;
  const max = Math.max(...rows.map((r) => r.fees + r.expenses + r.carry), 1) * 1.08;
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const band = plotW / n, bw = Math.max(4, Math.min(34, band * 0.62));
  const y = (v) => PT + (1 - v / max) * plotH;
  const ticks = [0, 0.5, 1].map((f) => (f * max) / 1.08);
  const totals = Object.fromEntries(COSTS.map(([k]) => [k, rows.reduce((s, r) => s + r[k], 0)]));
  const h = hi != null ? rows[hi] : null;
  const table = (
    <table className="ledger" data-testid="costs-by-year-table">
      <thead><tr><th style={{ textAlign: "left" }}>Year</th>{COSTS.map(([, l]) => <th key={l}>{l}</th>)}<th>Total</th></tr></thead>
      <tbody>
        {rows.map((r) => <tr key={r.year}><td>{r.year}</td>{COSTS.map(([k]) => <td key={k} style={cellNum}>{fmtMIn(r[k], ccy)}</td>)}<td style={cellNum}>{fmtMIn(r.fees + r.expenses + r.carry, ccy)}</td></tr>)}
        <tr style={{ fontWeight: 700 }}><td>Total</td>{COSTS.map(([k]) => <td key={k} style={cellNum}>{fmtMIn(totals[k], ccy)}</td>)}<td style={cellNum}>{fmtMIn(totals.fees + totals.expenses + totals.carry, ccy)}</td></tr>
      </tbody>
    </table>
  );
  return (
    <ChartCard title="Fees, expenses and carry by year" testId="costs-by-year" info={info} table={table} legend={COSTS.map(([, l, c]) => [l, c])}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="Management fees, fund expenses and GP carry paid in each year" onMouseLeave={() => setHi(null)}>
          {ticks.map((v) => (
            <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={AXIS} strokeDasharray={v ? "2 3" : ""} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtMIn(v, ccy)}</text></g>
          ))}
          {yearTicks(rows, plotW, (i) => PL + band * i + band / 2).map((t) => <text key={t.i} x={t.x} y={H - 6} textAnchor="middle" style={lab}>{t.label}</text>)}
          {rows.map((r, i) => {
            const cx = PL + band * i + band / 2;
            let at = 0;
            const parts = COSTS.filter(([k]) => r[k] > 0.5);
            return (
              <g key={r.year} onMouseEnter={() => setHi(i)} opacity={hi == null || hi === i ? 1 : 0.55} data-testid={`costs-by-year-${r.year}`}>
                <rect x={PL + band * i} y={PT} width={band} height={plotH} fill="transparent" />
                {parts.map(([k, , c], j) => {
                  const y0 = y(at), y1 = y(at + r[k]);
                  at += r[k];
                  const hgt = Math.max(0, y0 - y1 - (j < parts.length - 1 ? 2 : 0));
                  return j === parts.length - 1
                    ? <path key={k} d={topRounded(cx - bw / 2, y1, bw, Math.max(0, y0 - y1), 4)} fill={c} />
                    : <rect key={k} x={cx - bw / 2} y={y0 - hgt} width={bw} height={hgt} fill={c} />;
                })}
              </g>
            );
          })}
        </svg>
        {h && <Tip left={Math.max(12, Math.min(88, ((PL + band * hi + band / 2) / W) * 100))} title={String(h.year)}
          rows={[...COSTS.map(([k, l, c]) => [l, fmtMIn(h[k], ccy), c]), ["Total", fmtMIn(h.fees + h.expenses + h.carry, ccy), "transparent"]]} />}
      </div>
    </ChartCard>
  );
}

/** LP profit is distributions less paid in. */
export function ProfitSplit({ years, ccy, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const n = years.length;
  if (n < 2) return null;
  const H = 230, PL = 56, PR = 104, PT = 14, PB = 26;
  const vals = years.flatMap((r) => [r.lpProfit, r.cumCarry]);
  const lo = Math.min(0, ...vals), hiV = Math.max(...vals, 1);
  const pad = (hiV - lo) * 0.06;
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const x = (i) => PL + (i / (n - 1)) * plotW;
  const y = (v) => PT + (1 - (v - (lo - (lo < 0 ? pad : 0))) / (hiV + pad - (lo - (lo < 0 ? pad : 0)))) * plotH;
  const line = (k) => years.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
  const ticks = [lo, 0, hiV / 2, hiV].filter((v, i, a) => a.indexOf(v) === i && (v === 0 || Math.abs(v) > (hiV - lo) * 0.15));
  const last = years[n - 1];
  const h = hi != null ? years[hi] : null;
  const table = (
    <table className="ledger" data-testid="profit-split-table">
      <thead><tr><th style={{ textAlign: "left" }}>Year</th><th>LP profit to date</th><th>GP carry to date</th></tr></thead>
      <tbody>{years.map((r) => <tr key={r.year}><td>{r.year}</td><td style={cellNum}>{fmtMIn(r.lpProfit, ccy)}</td><td style={cellNum}>{fmtMIn(r.cumCarry, ccy)}</td></tr>)}</tbody>
    </table>
  );
  const ends = [["LPs", last.lpProfit, BLUE], ["GP", last.cumCarry, TURQ]];
  const ly = ends.map(([, v]) => y(v) + 4);
  if (Math.abs(ly[0] - ly[1]) < 14) { const mid = (ly[0] + ly[1]) / 2; const up = ly[0] < ly[1] ? 0 : 1; ly[up] = mid - 7; ly[1 - up] = mid + 7; }
  return (
    <ChartCard title="Profit to LPs and carry to the GP" testId="profit-split" info={info} table={table} legend={[["LP profit (paid out less paid in)", BLUE], ["GP carry", TURQ]]}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="Cumulative LP profit and GP carry by year" onMouseLeave={() => setHi(null)}>
          {ticks.map((v) => (
            <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={v === 0 ? { stroke: "var(--ink-color-global-border-default)" } : AXIS} strokeDasharray={v === 0 ? "" : "2 3"} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtMIn(v, ccy)}</text></g>
          ))}
          {yearTicks(years, plotW, x).map((t) => <text key={t.i} x={t.x} y={H - 6} textAnchor="middle" style={lab}>{t.label}</text>)}
          <path d={line("cumCarry")} fill="none" stroke={TURQ} strokeWidth="2" strokeLinejoin="round" strokeDasharray="6 4" />
          <path d={line("lpProfit")} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
          {ends.map(([l, v, c], k) => (
            <g key={l}>
              <circle cx={x(n - 1)} cy={y(v)} r="4" fill={c} style={{ stroke: SURFACE }} strokeWidth="2" />
              <text x={x(n - 1) + 8} y={ly[k]} style={{ ...lab, fill: INK, fontWeight: 700 }}>{l} {fmtMIn(v, ccy)}</text>
            </g>
          ))}
          {h && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={PT + plotH} style={{ stroke: subtle }} opacity="0.5" />}
          {years.map((r, i) => <rect key={r.year} x={x(i) - plotW / (n - 1) / 2} y={PT} width={plotW / (n - 1)} height={plotH} fill="transparent" onMouseEnter={() => setHi(i)} />)}
        </svg>
        {h && <Tip left={Math.max(12, Math.min(88, (x(hi) / W) * 100))} title={String(h.year)} rows={[["LP profit to date", fmtMIn(h.lpProfit, ccy), BLUE], ["GP carry to date", fmtMIn(h.cumCarry, ccy), TURQ]]} />}
      </div>
    </ChartCard>
  );
}

/** Net TVPI as every exit value is scaled, with the point where LPs stop getting their money back. */
export function ExitCurve({ points, breakeven, note, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const n = points.length;
  if (n < 2) return null;
  const H = 240, PL = 48, PR = 80, PT = 14, PB = 40;
  const f0 = points[0].factor, f1 = points[n - 1].factor;
  const top = Math.max(1.5, Math.ceil(Math.max(...points.map((p) => p.tvpi ?? 0)) * 2) / 2);
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const x = (f) => PL + ((f - f0) / (f1 - f0)) * plotW;
  const y = (v) => PT + (1 - v / top) * plotH;
  const line = (k) => points.filter((p) => p[k] != null).map((p, i) => `${i ? "L" : "M"}${x(p.factor).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const tStep = top > 6 ? 2 : top > 3 ? 1 : 0.5;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += tStep) ticks.push(v);
  const plan = points.find((p) => p.factor === 1);
  const be = breakeven?.factor != null && !breakeven.already && breakeven.factor >= f0 ? breakeven.factor : null;
  const h = hi != null ? points[hi] : null;
  const pctPlan = (f) => `${Math.round(f * 100)}% of plan`;
  const table = (
    <table className="ledger" data-testid="exit-curve-table">
      <thead><tr><th style={{ textAlign: "left" }}>Exit values</th><th>Net TVPI</th><th>DPI</th><th>Net IRR</th></tr></thead>
      <tbody>{points.filter((p) => EXIT_FACTORS.includes(p.factor)).map((p) => <tr key={p.factor} style={{ fontWeight: p.factor === 1 ? 700 : 400 }}><td>{pctPlan(p.factor)}</td><td style={cellNum}>{fmtX(p.tvpi)}</td><td style={cellNum}>{fmtX(p.dpi)}</td><td style={cellNum}>{p.netIrr == null ? "—" : fmtPct(p.netIrr, 1)}</td></tr>)}</tbody>
    </table>
  );
  return (
    <ChartCard title="How far exits can fall" testId="exit-curve" info={info} table={table} legend={[]}>
      {note && <div data-testid="exit-curve-note" style={{ ...sans, fontSize: FS.small, margin: "0 0 8px" }}>{note}</div>}
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="Net TVPI as exit values range from a tenth of plan to double" onMouseLeave={() => setHi(null)}>
          {ticks.map((v) => (
            <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={AXIS} strokeDasharray={v ? "2 3" : ""} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtX(v, v % 1 ? 1 : 0)}</text></g>
          ))}
          <line x1={PL} x2={W - PR} y1={y(1)} y2={y(1)} style={{ stroke: "var(--ink-color-global-border-default)" }} />
          {points.filter((p) => EXIT_FACTORS.includes(p.factor)).map((p) => <text key={p.factor} x={x(p.factor)} y={PT + plotH + 16} textAnchor="middle" style={{ ...lab, fontWeight: p.factor === 1 ? 700 : 400 }}>{Math.round(p.factor * 100)}%</text>)}
          <text x={PL + plotW / 2} y={H - 4} textAnchor="middle" style={lab}>Exit values as a share of plan</text>
          {be != null && (
            <g data-testid="exit-curve-breakeven">
              <rect x={PL} y={PT} width={Math.max(0, x(be) - PL)} height={plotH} fill={RED} opacity="0.06" />
              <line x1={x(be)} x2={x(be)} y1={PT} y2={PT + plotH} stroke={RED} strokeDasharray="4 3" />
              <text x={x(be) + 6} y={PT + 12} style={{ ...lab, fill: INK, fontWeight: 700 }}>LPs break even at {Math.round(be * 100)}%</text>
            </g>
          )}
          <text x={W - PR + 6} y={y(1) + 4} style={{ ...lab, fill: INK }}>Money back</text>
          <path d={line("tvpi")} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" />
          {plan && <g data-testid="exit-curve-plan">
            <circle cx={x(1)} cy={y(plan.tvpi)} r="5" fill={BLUE} style={{ stroke: SURFACE }} strokeWidth="2" />
            <text x={x(1) + 8} y={y(plan.tvpi) + 18} style={{ ...lab, fill: INK, fontWeight: 700 }}>Plan {fmtX(plan.tvpi)}</text>
          </g>}
          {h && <line x1={x(h.factor)} x2={x(h.factor)} y1={PT} y2={PT + plotH} style={{ stroke: subtle }} opacity="0.5" />}
          {points.map((p, i) => {
            const half = plotW / (n - 1) / 2;
            return <rect key={p.factor} x={x(p.factor) - half} y={PT} width={half * 2} height={plotH} fill="transparent" onMouseEnter={() => setHi(i)} />;
          })}
        </svg>
        {h && <Tip left={Math.max(12, Math.min(88, (x(h.factor) / W) * 100))} title={`Exits at ${pctPlan(h.factor)}`}
          rows={[["Net TVPI", fmtX(h.tvpi), BLUE], ["DPI", fmtX(h.dpi), "transparent"], ["Net IRR", h.netIrr == null ? "—" : fmtPct(h.netIrr, 1), "transparent"]]} />}
      </div>
    </ChartCard>
  );
}

const SCEN_STYLE = { down: [BROWN, "2 4"], base: [BLUE, ""], up: [GREEN, "7 4"] };

export function ScenarioLines({ series, info }) {
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  const base = series.find((s) => s.id === "base") ?? series[0];
  const rows = base?.quarterly.filter((q) => q.tvpi != null) ?? [];
  const n = rows.length;
  if (series.length < 2 || n < 2) return null;
  const at = (s, month) => s.quarterly.find((q) => q.month === month)?.tvpi ?? null;
  const H = 240, PL = 48, PR = 110, PT = 14, PB = 26;
  const top = Math.max(1.5, Math.ceil(Math.max(...series.flatMap((s) => s.quarterly.map((q) => q.tvpi ?? 0))) * 2) / 2);
  const plotW = Math.max(10, W - PL - PR), plotH = H - PT - PB;
  const x = (i) => PL + (i / (n - 1)) * plotW;
  const y = (v) => PT + (1 - v / top) * plotH;
  const tStep = top > 6 ? 2 : top > 3 ? 1 : 0.5;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += tStep) ticks.push(v);
  const years = rows.map((r, i) => ({ i, y: r.date.slice(0, 4), m: r.date.slice(5) })).filter((t) => t.m === rows[0].date.slice(5));
  const yStep = Math.ceil(years.length / Math.max(2, Math.floor(plotW / 70)));
  const ends = series.map((s) => [s, at(s, rows[n - 1].month)]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
  const ly = ends.map(([, v]) => y(v) + 4);
  for (let i = 1; i < ly.length; i++) if (ly[i] - ly[i - 1] < 14) ly[i] = ly[i - 1] + 14;
  const h = hi != null ? rows[hi] : null;
  const table = (
    <table className="ledger" data-testid="scenario-lines-table">
      <thead><tr><th style={{ textAlign: "left" }}>Quarter</th>{series.map((s) => <th key={s.id}>{s.label}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.month}><td>{fmtYm(r.date)}</td>{series.map((s) => <td key={s.id} style={cellNum}>{fmtX(at(s, r.month))}</td>)}</tr>)}</tbody>
    </table>
  );
  return (
    <ChartCard title="Net TVPI by scenario" testId="scenario-lines" info={info} table={table} legend={series.map((s) => [s.label, SCEN_STYLE[s.id]?.[0] ?? GREY])}>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }} role="img" aria-label="Net TVPI by quarter for the downside, base and upside scenarios" onMouseLeave={() => setHi(null)}>
          {ticks.map((v) => (
            <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={v === 1 ? { stroke: "var(--ink-color-global-border-default)" } : AXIS} strokeDasharray={v === 1 ? "" : "2 3"} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{fmtX(v, v % 1 ? 1 : 0)}</text></g>
          ))}
          {years.filter((_, k) => k % yStep === 0).map((t) => <text key={t.i} x={x(t.i)} y={H - 6} textAnchor="middle" style={lab}>{t.y}</text>)}
          {series.map((s) => {
            const [c, dash] = SCEN_STYLE[s.id] ?? [GREY, ""];
            const d = rows.map((r, i) => [i, at(s, r.month)]).filter(([, v]) => v != null).map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
            return <path key={s.id} data-testid={`scenario-line-${s.id}`} d={d} fill="none" stroke={c} strokeWidth="2" strokeDasharray={dash} strokeLinejoin="round" />;
          })}
          {ends.map(([s, v], k) => (
            <g key={s.id}>
              <circle cx={x(n - 1)} cy={y(v)} r="4" fill={SCEN_STYLE[s.id]?.[0] ?? GREY} style={{ stroke: SURFACE }} strokeWidth="2" />
              <text x={x(n - 1) + 8} y={ly[k]} style={{ ...lab, fill: INK, fontWeight: 700 }}>{s.label} {fmtX(v)}</text>
            </g>
          ))}
          {h && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={PT + plotH} style={{ stroke: subtle }} opacity="0.5" />}
          {rows.map((r, i) => <rect key={r.month} x={x(i) - plotW / (n - 1) / 2} y={PT} width={plotW / (n - 1)} height={plotH} fill="transparent" onMouseEnter={() => setHi(i)} />)}
        </svg>
        {h && <Tip left={Math.max(12, Math.min(88, (x(hi) / W) * 100))} title={fmtYm(h.date)} rows={series.map((s) => [s.label, fmtX(at(s, h.month)), SCEN_STYLE[s.id]?.[0] ?? GREY])} />}
      </div>
    </ChartCard>
  );
}

/** What LPs and the GP each get at every distribution level, under this plan's waterfall terms. */
export function DpiSensitivity({ data, ccy, info }) {
  if (!data?.rows.length) return null;
  const money = (v) => (Math.abs(v) < 0.5 ? "—" : fmtMIn(v, ccy));
  const max = Math.max(...data.rows.map((r) => r.total), 1);
  const head = ["Distributions (× paid in)", "Total paid out", "To LPs", "LP DPI", "To GP (carry)", "GP share of profit", "Split"];
  return (
    <div className="card" data-testid="dpi-sensitivity" style={{ padding: "16px 20px 12px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>
          Waterfall sensitivity by DPI{info && <InfoTip label="About Waterfall sensitivity by DPI" portal>{info}</InfoTip>}
        </span>
        <span style={{ flex: 1 }} />
        <Legend items={[["To LPs", BLUE], ["To GP", YELLOW]]} />
      </div>
      <div style={{ ...sans, fontSize: FS.small, color: subtle, marginBottom: 10, maxWidth: "80ch" }}>
        Each row pays out that multiple of the {fmtMIn(data.paidIn, ccy)} partners paid in and runs it through the plan's waterfall, as if it came back {data.years.toFixed(1)} years after going in (this plan's average). The highlighted row is this plan's own result.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="ledger" data-testid="dpi-sensitivity-table" style={{ minWidth: 720 }}>
          <thead><tr>{head.map((h, i) => <th key={h} style={{ textAlign: i === 0 || i === head.length - 1 ? "left" : undefined }}>{h}</th>)}</tr></thead>
          <tbody>
            {data.rows.map((r) => {
              const mine = !!r.plan;
              return (
                <tr key={mine ? "plan" : r.multiple} data-testid={mine ? "dpi-row-plan" : `dpi-row-${r.multiple}`} data-plan={mine || undefined}
                  style={mine ? { background: "var(--ink-color-global-surface-lightgray-default)", fontWeight: 600 } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{mine ? fmtX(r.multiple) : fmtX(r.multiple, 1)}{mine && <span style={{ ...sans, fontSize: FS.micro, color: subtle, fontWeight: 400, marginLeft: 6 }}>this plan</span>}</td>
                  <td style={cellNum}>{money(r.total)}</td>
                  <td style={cellNum}>{money(r.lp)}</td>
                  <td style={cellNum}>{fmtX(r.lpDpi)}</td>
                  <td style={cellNum}>{money(r.gp)}</td>
                  <td style={cellNum}>{r.gpShareOfProfit == null ? "—" : fmtPct(r.gpShareOfProfit, 1)}</td>
                  <td style={{ width: "22%", minWidth: 120 }}>
                    <span style={{ display: "flex", gap: 2, height: 10 }} aria-hidden="true">
                      {r.lp > 0.5 && <span style={{ flex: `0 0 ${(r.lp / max) * 100}%`, background: BLUE, borderRadius: r.gp > 0.5 ? "3px 0 0 3px" : 3 }} />}
                      {r.gp > 0.5 && <span style={{ flex: `0 0 ${(r.gp / max) * 100}%`, background: YELLOW, borderRadius: r.lp > 0.5 ? "0 3px 3px 0" : 3 }} />}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
