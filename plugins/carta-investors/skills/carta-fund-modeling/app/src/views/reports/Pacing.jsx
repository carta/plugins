import { useMemo } from "react";
import { FS, inkNum, sans, MICRO } from "../../ui/theme.js";
import { shortFund } from "../../ui/format.js";
import { H3 } from "../../ui/components.jsx";
import { quarterlySeries, trailingAvg } from "../../model/pacing.js";
import { useFirmData } from "../../state/FirmData.jsx";

const W = 960, H = 300, PL = 34, PR = 12, PB = 34;
export const PT = 34;
// Fund colours: Ink's data-viz Level 2 rung (the app's --local-data-viz-*-2, theme.js), in Ink's series order.
const FUND_TINTS = ["blue", "turquoise", "brown", "yellow", "lime", "positive", "negative"].map((hue) => `var(--local-data-viz-${hue}-2)`);

/** Y-axis labels for a chart topped at `yMax` companies: every whole step up to it
 *  (1, 2, 3 … on a small chart, wider steps past five), always ending at the max.
 *  A step that would crowd the max label is dropped. */
export function yAxisTicks(yMax) {
  const step = Math.max(1, Math.ceil(yMax / 5));
  const ticks = [];
  for (let n = step; n < yMax - step / 2; n += step) ticks.push(n);
  return [...ticks, yMax];
}

function CadenceChart({ quarters, trail, FUNDS, FUND_TINT }) {
  // Tallest stack reaches the plot top.
  const yMax = Math.max(1, ...quarters.map((r) => r.total));
  const slot = (W - PL - PR) / quarters.length;
  const bw = Math.min(16, slot * 0.62);
  const x = (i) => PL + i * slot + slot / 2;
  const y = (n) => PT + (1 - n / yMax) * (H - PT - PB);
  const years = quarters.map((r, i) => ({ i, yr: r.q.slice(0, 4), q: r.q.slice(5) })).filter((t) => t.q === "Q1");
  const trailPath = trail.map((t, i) => `${i ? "L" : "M"} ${x(i)} ${y(t.avg)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img"
      aria-label="New companies backed per quarter, by fund">
      {yAxisTicks(yMax).map((n) => (
        <g key={n}>
          <line x1={PL} x2={W - PR} y1={y(n)} y2={y(n)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
          <text x={PL - 7} y={y(n) + 4} textAnchor="end" style={{ ...inkNum, fontSize: FS.body, fill: MICRO }}>{n}</text>
        </g>
      ))}
      <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
      {years.map((t) => (
        <g key={t.yr}>
          <line x1={x(t.i)} x2={x(t.i)} y1={y(0)} y2={y(0) + 6} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
          <text x={x(t.i)} y={H - PB + 20} textAnchor="middle" style={{ ...sans, fontSize: FS.body, fill: MICRO }}>{t.yr}</text>
        </g>
      ))}
      {quarters.map((r, i) => {
        let acc = 0;
        return (
          <g key={r.q}>
            <title>{`${r.q.replace("-", " ")} · ${r.total} new compan${r.total === 1 ? "y" : "ies"}`}</title>
            {FUNDS.map((fid) => {
              const n = r.byFund[fid] || 0;
              if (!n) return null;
              const y1 = y(acc + n), h = y(acc) - y(acc + n);
              acc += n;
              return <rect key={fid} x={x(i) - bw / 2} y={y1} width={bw} height={Math.max(h - 1, 1.5)} style={{ fill: FUND_TINT[fid] }} />;
            })}
          </g>
        );
      })}
      <path d={trailPath} fill="none" style={{ stroke: "var(--ink-color-global-text-default)" }} strokeWidth="1.8" strokeLinejoin="round" opacity="0.75" strokeDasharray="1 0" />
      {(() => {
        const last = trail[trail.length - 1];
        if (!last) return null;
        const cx = x(trail.length - 1), cy = y(last.avg);
        const label = `${last.avg.toFixed(1)}/qtr · trailing yr`;
        // Just above the latest point, kept inside the SVG.
        const lw = label.length * 7.2 + 14, lx = Math.min(cx + 9, W - PR - lw), ly = Math.max(cy - 27, 2);
        return (
          <g>
            <circle cx={cx} cy={cy} r="5" style={{ fill: "var(--ink-color-global-surface-background-default)", stroke: "var(--ink-color-global-text-default)" }} strokeWidth="2" />
            <rect x={lx} y={ly} width={lw} height="22" rx="11" style={{ fill: "var(--ink-color-global-text-default)" }} />
            <text x={lx + lw / 2} y={ly + 15} textAnchor="middle"
              style={{ ...inkNum, fontSize: FS.body, fontWeight: 600, fill: "var(--ink-color-global-surface-background-default)" }}>{label}</text>
          </g>
        );
      })()}
    </svg>
  );
}

/** The quarters PacingCard charts, up to the pull date; [] when there is nothing to draw. */
export const pacingQuarters = (pacing) =>
  pacing?.monthly ? quarterlySeries(pacing.monthly, (pacing.pulledAt || "").slice(0, 7)) : [];
export const hasPacingChart = (pacing) => pacingQuarters(pacing).length > 0;

/** Investment pacing — new companies per quarter, by fund. Renders nothing
 *  when there are no quarters to chart. */
export default function PacingCard({ funds = [] }) {
  const { pacing: pacingData } = useFirmData();
  const nameOf = Object.fromEntries(funds.map((f) => [f.id, f.name]));
  const monthly = pacingData?.monthly;
  const newCount = (fid) => (monthly[fid] || []).reduce((s, [, c]) => s + c, 0);
  const FUNDS = monthly ? Object.keys(monthly).filter((fid) => monthly[fid]?.length).sort((a, b) => newCount(b) - newCount(a)) : [];
  const FUND_TINT = Object.fromEntries(FUNDS.map((fid, i) => [fid, FUND_TINTS[i % FUND_TINTS.length]]));
  const quarters = useMemo(() => pacingQuarters(pacingData), [pacingData]);
  const trail = useMemo(() => trailingAvg(quarters), [quarters]);
  if (!quarters.length) return null;
  const legendText = { ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 8 };
  return (
    <div style={{ marginTop: 18, marginBottom: 16 }}>
      {/* Sub-head stacked under the title with no gap; its own 20px leading spaces them. */}
      <H3>Investment pacing</H3>
      <p style={{ ...sans, fontSize: FS.body, lineHeight: "20px", color: "var(--ink-color-global-text-subtle)", margin: "0 0 12px" }}>New companies per quarter</p>
      <CadenceChart quarters={quarters} trail={trail} FUNDS={FUNDS} FUND_TINT={FUND_TINT} />
      {/* Under the plot, no rule; indented to the plot's left gutter (PL). */}
      <div data-testid="pacing-legend" style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 12, paddingLeft: PL }}>
        {FUNDS.map((fid) => (
          <span key={fid} style={legendText}>
            <span style={{ width: 10, height: 10, background: FUND_TINT[fid], display: "inline-block" }} />
            {shortFund(nameOf[fid] || fid)}
          </span>
        ))}
        <span style={legendText}>
          <span style={{ width: 18, borderTop: `2px solid var(--ink-color-global-text-default)`, display: "inline-block", opacity: 0.75 }} />
          trailing-year pace
        </span>
      </div>
    </div>
  );
}
