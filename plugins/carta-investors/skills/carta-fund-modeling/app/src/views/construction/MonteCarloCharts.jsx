import { useState } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { fmtCheckIn, fmtX, fmtPct } from "../../ui/format.js";
import { ChartCard, Tip, topRounded, C_TVPI } from "./charts.jsx";

export const C_RANGE = C_TVPI;
export const C_PLAN = "var(--ink-color-global-data-viz-neutral-3)";
// Fixed order keeps an allocation's color across charts; color-blind-checked in both themes, labeled in ALLOC_INK.
export const ALLOC_COLORS = [
  "light-dark(#285DA3, #3987e5)",
  "light-dark(#eb6834, #d95926)",
  "light-dark(#1baf7a, #199e70)",
  "light-dark(#eda100, #c98500)",
  "light-dark(#e87ba4, #d55181)",
];
const ALLOC_INK = ["#ffffff", "#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a"];
export const allocColor = (i) => ALLOC_COLORS[i] ?? "var(--ink-color-global-data-viz-neutral-3)";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const lab = { ...sans, fontSize: FS.micro, fill: MICRO };
const num = { ...inkNum, textAlign: "right", whiteSpace: "nowrap" };

function ticks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const W = 640, H = 200, PL = 36, PR = 12, PT = 26, PB = 26;

/** Bars (chosen option) and outline (today's plan) are both share of funds per unit TVPI, so their bins can differ. */
export function Histogram({ hist, compare, target, label = "This option", title = "Net TVPI across simulated funds", metricLabel = "Net TVPI", marker = null }) {
  const [hi, setHi] = useState(null);
  if (!hist) return null;
  const end = (h) => h.lo + h.width * h.counts.length;
  const lo = Math.min(hist.lo, compare?.lo ?? Infinity), top = Math.max(end(hist), compare ? end(compare) : -Infinity);
  const dens = (h) => h.counts.map((c) => c / h.total / h.width);
  const d = dens(hist), dc = compare ? dens(compare) : [];
  const maxD = Math.max(...d, ...dc, 1e-9);
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const x = (v) => PL + ((v - lo) / (top - lo || 1)) * plotW;
  const y = (v) => PT + (1 - v / maxD) * plotH;
  const base = PT + plotH;
  const grid = ticks(lo, top, 6);
  const binLabel = (i) => `${fmtX(hist.lo + i * hist.width, 2)} – ${fmtX(hist.lo + (i + 1) * hist.width, 2)}`;
  const outline = compare ? [`M ${x(compare.lo)} ${base}`, ...dc.flatMap((v, i) => [`L ${x(compare.lo + i * compare.width)} ${y(v)}`, `L ${x(compare.lo + (i + 1) * compare.width)} ${y(v)}`]), `L ${x(end(compare))} ${base}`].join(" ") : null;
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>{metricLabel}</th><th>Share of funds</th></tr></thead>
      <tbody>{hist.counts.map((c, i) => <tr key={i}><td>{binLabel(i)}</td><td style={num}>{fmtPct(c / hist.total, 1)}</td></tr>)}</tbody>
    </table>
  );
  const legend = compare ? [[label, C_RANGE], ["Your plan today", C_PLAN]] : [];
  return (
    <ChartCard title={title} legend={legend} table={table} testId="mc-histogram">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label={`Distribution of ${metricLabel}: ${label}${compare ? " against your plan today" : ""}`}>
        <line x1={PL} x2={W - PR} y1={base} y2={base} style={{ stroke: "var(--ink-color-global-border-subtle)" }} />
        {grid.map((v) => <text key={v} x={x(v)} y={H - PB + 16} textAnchor="middle" style={lab}>{fmtX(v, 1)}</text>)}
        {d.map((v, i) => v > 0 && (
          <path key={i} d={topRounded(x(hist.lo + i * hist.width) + 1, y(v), Math.max(1, x(hist.lo + (i + 1) * hist.width) - x(hist.lo + i * hist.width) - 2), base - y(v), 3)}
            fill={C_RANGE} opacity={hi == null || hi === i ? 0.85 : 0.45} />
        ))}
        {outline && <path d={outline} fill="none" stroke={C_PLAN} strokeWidth="2" strokeLinejoin="round" />}
        {target != null && target >= lo && target <= top && (
          <g>
            <line x1={x(target)} x2={x(target)} y1={PT} y2={base} strokeDasharray="4 4" strokeWidth="1.5" style={{ stroke: "var(--ink-color-global-text-subtle)" }} />
            <text x={x(target) + 5} y={PT + 10} style={{ ...lab, fill: "var(--ink-color-global-text-subtle)", stroke: "var(--ink-color-global-surface-background-default)", strokeWidth: 3, paintOrder: "stroke" }}>{fmtX(target, 1)} target</text>
          </g>
        )}
        {marker != null && marker >= lo && marker <= top && (
          <g data-testid="mc-histogram-expected">
            <line x1={x(marker)} x2={x(marker)} y1={PT - 4} y2={base} strokeWidth="2" style={{ stroke: "var(--ink-color-global-text-default)" }} />
            <text x={x(marker) + (x(marker) > W * 0.7 ? -6 : 6)} y={PT - 8} textAnchor={x(marker) > W * 0.7 ? "end" : "start"}
              style={{ ...lab, fill: "var(--ink-color-global-text-default)", fontWeight: 600 }}>{fmtX(marker, 2)} expected case</text>
          </g>
        )}
        {d.map((_, i) => (
          <rect key={`h${i}`} x={x(hist.lo + i * hist.width)} y={PT} width={Math.max(1, x(hist.lo + (i + 1) * hist.width) - x(hist.lo + i * hist.width))} height={plotH}
            fill="transparent" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />
        ))}
      </svg>
      {hi != null && <Tip left={Math.max(10, Math.min(90, (x(hist.lo + (hi + 0.5) * hist.width) / W) * 100))} title={`${metricLabel} ${binLabel(hi)}`}
        rows={[["Share of funds", fmtPct(hist.counts[hi] / hist.total, 1), C_RANGE]]} />}
    </ChartCard>
  );
}

export function SplitChart({ rows, allocations }) {
  const [hi, setHi] = useState(null);
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>Strategy</th>{allocations.map((a) => <th key={a.id}>{a.name}</th>)}</tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.key}><td>{r.label}</td>{allocations.map((a) => <td key={a.id} style={num}>{fmtPct(r.facts.allocations.find((x) => x.id === a.id)?.share ?? 0, 0)}</td>)}</tr>
      ))}</tbody>
    </table>
  );
  return (
    <ChartCard title="Share of capital" legend={allocations.map((a, i) => [a.name, allocColor(i)])} table={table} testId="mc-split-chart">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) 1fr", rowGap: 8, columnGap: 12, alignItems: "center" }}>
        {rows.map((r) => [
          <span key={`l-${r.key}`} style={{ ...sans, fontSize: FS.small }}>{r.label}</span>,
          <div key={`b-${r.key}`} style={{ display: "flex", gap: 2, height: 22, position: "relative" }}>
            {allocations.map((a, i) => {
              const share = r.facts.allocations.find((x) => x.id === a.id)?.share ?? 0;
              if (!(share > 0)) return null;
              const id = `${r.key}-${a.id}`;
              return (
                <span key={a.id} onMouseEnter={() => setHi(id)} onMouseLeave={() => setHi(null)}
                  style={{ flex: `${share} 0 0`, background: allocColor(i), borderRadius: 4, display: "grid", placeItems: "center", minWidth: 2,
                    opacity: hi == null || hi === id ? 1 : 0.7, position: "relative" }}>
                  {share >= 0.12 && <span style={{ ...inkNum, fontSize: FS.micro, fontWeight: 700, color: ALLOC_INK[i] ?? "#1a1a1a" }}>{fmtPct(share, 0)}</span>}
                  {hi === id && <Tip left={50} title={r.label} rows={[[a.name, fmtPct(share, 0), allocColor(i)]]} />}
                </span>
              );
            })}
          </div>,
        ])}
      </div>
    </ChartCard>
  );
}

export const fmtScore = (objective, v) => (v == null ? "—" : objective === "target" ? fmtPct(v, 0) : fmtX(v));

/** Strategy 1 on the edge of the grid means the answer may lie beyond what was tried. */
function edgeNote(map, [r, c]) {
  const parts = [];
  if (c === 0) parts.push("the smallest first check tried");
  if (c === map.checks.length - 1) parts.push("the largest first check tried");
  if (r === map.reserves.length - 1 && map.reserves.length > 1) parts.push("the most held for follow-ons that was tried");
  return parts.length ? `The best option is at ${parts.join(" and ")}; the answer may lie further out.` : null;
}

/** One allocation's first check (columns) against the share of its capital held for follow-ons (rows). */
export function CheckReserveMap({ map, objective, ccy, current, screenRuns }) {
  const scores = map.cells.flat().filter(Boolean).map((c) => c.score).filter((v) => v != null);
  const lo = Math.min(...scores), top = Math.max(...scores);
  const mark = map.strategy1;
  const shade = (v) => (top > lo ? (v - lo) / (top - lo) : 1);
  return (
    <div className="card" style={{ padding: "16px 20px 12px", marginBottom: 16 }} data-testid={`mc-heatmap-${map.id}`}>
      <div style={{ ...sans, fontSize: FS.body, fontWeight: 700, marginBottom: 2 }}>{map.name}: first check vs. held for follow-ons</div>
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginBottom: 10 }}>
        Darker scores better{mark ? "; the best option is outlined" : ""}. Screening scores on {screenRuns ? screenRuns.toLocaleString("en-US") : "a few hundred"} funds. — means out of reach.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="ledger" style={{ borderCollapse: "separate", borderSpacing: 2, minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", fontSize: FS.micro }}>Held for follow-ons ↓ · First check →</th>
              {map.checks.map((c) => <th key={c} style={{ ...num, fontSize: FS.micro, fontWeight: Math.abs(c - current.check) < 1 ? 700 : 500 }}>{fmtCheckIn(c, ccy)}</th>)}
            </tr>
          </thead>
          <tbody>
            {map.reserves.map((r, ri) => (
              <tr key={r}>
                <th style={{ textAlign: "left", fontSize: FS.micro, fontWeight: Math.abs(r - current.reserve) < 0.006 ? 700 : 500 }}>{fmtPct(r, 0)}</th>
                {map.checks.map((c, ci) => {
                  const cell = map.cells[ri][ci];
                  if (!cell || cell.score == null) return <td key={c} style={{ ...num, ...subtle }}>—</td>;
                  const s = shade(cell.score);
                  const isMarked = mark && mark[0] === ri && mark[1] === ci;
                  return (
                    <td key={c} title={`${fmtCheckIn(c, ccy)} first check, ${fmtPct(r, 0)} held: ${fmtScore(objective, cell.score)}, ${Math.round(cell.companies)} companies`}
                      style={{ ...num, padding: "6px 8px", borderRadius: 4,
                        background: `color-mix(in srgb, ${C_RANGE} ${Math.round(8 + s * 80)}%, var(--ink-color-global-surface-background-default))`,
                        color: s > 0.55 ? "var(--ink-color-global-brand-white)" : "var(--ink-color-global-text-default)",
                        outline: isMarked ? "2px solid var(--ink-color-global-text-default)" : "none", outlineOffset: -2 }}>
                      <div style={{ fontWeight: 700, fontSize: FS.small }}>{fmtScore(objective, cell.score)}</div>
                      <div style={{ fontSize: FS.micro, opacity: 0.85 }}>{Math.round(cell.companies)} cos</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mark && edgeNote(map, mark) && <div data-testid={`mc-heatmap-edge-${map.id}`} style={{ ...sans, fontSize: FS.small, marginTop: 8 }}>{edgeNote(map, mark)}</div>}
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 6 }}>Bold headings: today's check and reserve.</div>
    </div>
  );
}

/** Median and P10–P90 net TVPI for the best strategy at each company count. */
export function CompaniesChart({ points, target, splitChanged }) {
  const [hi, setHi] = useState(null);
  const pts = [...points].sort((a, b) => a.companies - b.companies);
  if (pts.length < 2) {
    return (
      <div data-testid="mc-companies-chart-empty" style={{ ...sans, fontSize: FS.small, ...subtle }}>
        Too few nearby company counts are within reach to draw a comparison: around {Math.round(target)} companies, most of the counts tried need first checks bigger than the round.
      </div>
    );
  }
  const minX = pts[0].companies, maxX = pts[pts.length - 1].companies;
  const maxY = Math.max(...pts.map((p) => p.summary.net.p90)) * 1.08;
  const minY = Math.max(0, Math.min(...pts.map((p) => p.summary.net.p10)) * 0.9);
  const plotW = W - PL - PR - 40, plotH = H - PT - PB;
  const x = (v) => PL + 20 + ((v - minX) / (maxX - minX || 1)) * plotW;
  const y = (v) => PT + (1 - (v - minY) / (maxY - minY || 1)) * plotH;
  const band = `M ${pts.map((p) => `${x(p.companies)} ${y(p.summary.net.p90)}`).join(" L ")} L ${[...pts].reverse().map((p) => `${x(p.companies)} ${y(p.summary.net.p10)}`).join(" L ")} Z`;
  const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(p.companies)} ${y(p.summary.net.p50)}`).join(" ");
  const table = (
    <table className="ledger">
      <thead><tr><th style={{ textAlign: "left" }}>Companies</th><th>P10</th><th>Median</th><th>P90</th></tr></thead>
      <tbody>{pts.map((p) => <tr key={p.companies}><td>{Math.round(p.companies)}</td><td style={num}>{fmtX(p.summary.net.p10)}</td><td style={num}>{fmtX(p.summary.net.p50)}</td><td style={num}>{fmtX(p.summary.net.p90)}</td></tr>)}</tbody>
    </table>
  );
  const h = hi != null ? pts[hi] : null;
  return (
    <ChartCard title="What if you backed more or fewer companies?" legend={[["Median", C_RANGE], ["P10–P90", `color-mix(in srgb, ${C_RANGE} 22%, transparent)`]]} table={table} testId="mc-companies-chart">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Net TVPI by number of companies">
        {ticks(minY, maxY, 4).map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} strokeDasharray="2 3" style={{ stroke: "var(--ink-color-global-border-subtle)" }} />
            <text x={PL - 6} y={y(v) + 4} textAnchor="end" style={lab}>{fmtX(v, 1)}</text>
          </g>
        ))}
        <path d={band} style={{ fill: `color-mix(in srgb, ${C_RANGE} 18%, transparent)` }} />
        <path d={line} fill="none" stroke={C_RANGE} strokeWidth="2" />
        {pts.map((p, i) => (
          <g key={p.companies}>
            <circle cx={x(p.companies)} cy={y(p.summary.net.p50)} r={Math.abs(p.target - target) < 0.5 ? 6 : 4} fill={C_RANGE}
              style={{ stroke: "var(--ink-color-global-surface-background-default)" }} strokeWidth="2" />
            <text x={x(p.companies)} y={H - PB + 18} textAnchor="middle" style={{ ...lab, fontWeight: Math.abs(p.target - target) < 0.5 ? 700 : 400 }}>{Math.round(p.companies)}</text>
            <rect x={x(p.companies) - 24} y={PT} width={48} height={plotH} fill="transparent" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />
          </g>
        ))}
      </svg>
      {h && <Tip left={Math.max(10, Math.min(90, (x(h.companies) / W) * 100))} title={`${Math.round(h.companies)} companies`}
        rows={[["Good case (P90)", fmtX(h.summary.net.p90), C_RANGE], ["Median", fmtX(h.summary.net.p50), C_RANGE], ["Bad case (P10)", fmtX(h.summary.net.p10), C_RANGE]]} />}
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 4 }}>
        Best checks and reserves at each count, with today's split{splitChanged ? " (options above could also change the split)" : ""}. Larger dot: your target.
      </div>
    </ChartCard>
  );
}

