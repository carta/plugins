import { useMemo } from "react";
import { FS, inkNum, sans, MICRO, PALETTE } from "../../ui/theme.js";
import { shortFund } from "../../ui/format.js";
import { H3 } from "../../ui/components.jsx";
import { quarterlySeries, trailingAvg } from "../../model/pacing.js";
import { useFirmData } from "../../state/FirmData.jsx";

const W = 960, H = 300, PL = 34, PR = 12, PT = 18, PB = 30;

function CadenceChart({ quarters, trail, FUNDS, FUND_TINT }) {
  const yMax = Math.max(4, ...quarters.map((r) => r.total)) + 1;
  const slot = (W - PL - PR) / quarters.length;
  const bw = Math.min(16, slot * 0.62);
  const x = (i) => PL + i * slot + slot / 2;
  const y = (n) => PT + (1 - n / yMax) * (H - PT - PB);
  const years = quarters.map((r, i) => ({ i, yr: r.q.slice(0, 4), q: r.q.slice(5) })).filter((t) => t.q === "Q1");
  const trailPath = trail.map((t, i) => `${i ? "L" : "M"} ${x(i)} ${y(t.avg)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img"
      aria-label="New companies backed per quarter, by fund">
      {[3, 6, 9].filter((n) => n < yMax).map((n) => (
        <g key={n}>
          <line x1={PL} x2={W - PR} y1={y(n)} y2={y(n)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
          <text x={PL - 7} y={y(n) + 3} textAnchor="end" style={{ ...inkNum, fontSize: FS.micro, fill: MICRO }}>{n}</text>
        </g>
      ))}
      <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
      {years.map((t) => (
        <text key={t.yr} x={x(t.i)} y={H - PB + 17} textAnchor="middle" style={{ ...sans, fontSize: FS.micro, fill: MICRO }}>{t.yr}</text>
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
              return <rect key={fid} x={x(i) - bw / 2} y={y1} width={bw} height={Math.max(h - 1, 1.5)} rx="2.5" fill={FUND_TINT[fid]} />;
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
        const lw = label.length * 6.2 + 14;
        return (
          <g>
            <circle cx={cx} cy={cy} r="5" style={{ fill: "var(--ink-color-global-surface-background-default)", stroke: "var(--ink-color-global-text-default)" }} strokeWidth="2" />
            <rect x={Math.min(cx + 9, W - PR - lw)} y={Math.max(cy - 25, PT)} width={lw} height="19" rx="9.5" style={{ fill: "var(--ink-color-global-text-default)" }} />
            <text x={Math.min(cx + 9, W - PR - lw) + lw / 2} y={Math.max(cy - 25, PT) + 13} textAnchor="middle"
              style={{ ...inkNum, fontSize: FS.micro, fontWeight: 600, fill: "var(--ink-color-global-surface-background-default)" }}>{label}</text>
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
  const FUND_TINT = Object.fromEntries(FUNDS.map((fid, i) => [fid, PALETTE[i % PALETTE.length]]));
  const quarters = useMemo(() => pacingQuarters(pacingData), [pacingData]);
  const trail = useMemo(() => trailingAvg(quarters), [quarters]);
  if (!quarters.length) return null;
  return (
    <div className="card" style={{ padding: "18px 22px 14px", marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <H3>Investment pacing</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>new companies per quarter</span>
        <span style={{ flex: 1 }} />
        {FUNDS.map((fid) => (
          <span key={fid} style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: FUND_TINT[fid], display: "inline-block" }} />
            {shortFund(nameOf[fid] || fid)}
          </span>
        ))}
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 18, borderTop: `2px solid var(--ink-color-global-text-default)`, display: "inline-block", opacity: 0.75 }} />
          trailing-year pace
        </span>
      </div>
      <CadenceChart quarters={quarters} trail={trail} FUNDS={FUNDS} FUND_TINT={FUND_TINT} />
    </div>
  );
}
