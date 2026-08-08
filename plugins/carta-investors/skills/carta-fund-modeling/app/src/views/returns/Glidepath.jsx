// LP Glidepath — one fund's DPI / RVPI / TVPI traced over its life, rendered as a
// section inside the LP Returns tab. Historical years (from the fund's cashflows +
// NAV marks) sit left of the "today" line; projected years roll forward under the
// scenario's pacing knobs. RVPI (the unrealized band) runs off into DPI (the
// realized band) as capital comes back; the two stack to TVPI. It is TIED TO THE
// SCENARIO: the anchor is the live repriced fund state (fundState from
// computeFundStates), so repricing a company or toggling an exit moves the whole
// path. Model: src/model/glidepath.js. Knobs persist per fund into the active scenario.
import { useMemo, useState } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { fmtM, fmtX, fmtPct } from "../../ui/format.js";
import { H2, H3, Eyebrow, MethodNote, SourceNote, Segmented, Slider, StatBar, Badge, fundLabel } from "../../ui/components.jsx";
import { fundGlidepath } from "../../model/glidepath.js";

// realized (DPI) vs unrealized (RVPI) band colors; TVPI is the ink line on top.
const C_DPI = "var(--ink-color-global-data-viz-positive-3)";  // realized — teal/green
const C_RVPI = "var(--ink-color-global-data-viz-blue-3)";     // unrealized — blue
const C_TVPI = "var(--ink-color-global-text-default)";

const SHAPES = [
  { id: "declining", label: "Front-loaded" },
  { id: "even", label: "Even" },
  { id: "backloaded", label: "Back-loaded" },
];

/** Labelled shape toggle (call / realization pacing). */
function ShapeKnob({ label, value, onChange, locked }) {
  return (
    <div style={{ flex: "1 1 240px", minWidth: 220 }}>
      <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 4 }}>{label}</div>
      <Segmented options={SHAPES} value={value} onChange={onChange} small locked={locked} />
    </div>
  );
}

// ── the chart ───────────────────────────────────────────────────────────────
const W = 960, H = 260, PL = 46, PR = 58, PT = 16, PB = 32;
function GlidepathChart({ g }) {
  const [hoverI, setHoverI] = useState(null);
  const rows = g.years;
  const n = rows.length;
  if (n < 2) return null;

  // last actual index — the "today" boundary the actual/projected split hinges on
  let anchorIdx = 0;
  rows.forEach((r, i) => { if (r.actual) anchorIdx = i; });

  const maxY = Math.max(1, ...rows.map((r) => r.tvpi)) * 1.08;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const x = (i) => PL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PT + (1 - v / maxY) * plotH;
  const y0 = y(0);

  // area between two series over a contiguous index range [i0..i1]
  const area = (i0, i1, topFn, botFn) => {
    let d = "";
    for (let i = i0; i <= i1; i++) d += `${i === i0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(topFn(rows[i])).toFixed(1)} `;
    for (let i = i1; i >= i0; i--) d += `L ${x(i).toFixed(1)} ${y(botFn(rows[i])).toFixed(1)} `;
    return d + "Z";
  };
  const line = (i0, i1, fn) => {
    let d = "";
    for (let i = i0; i <= i1; i++) d += `${i === i0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(fn(rows[i])).toFixed(1)} `;
    return d;
  };
  const dpiTop = (r) => r.dpi, zero = () => 0;
  const tvpiTop = (r) => r.tvpi, dpiBot = (r) => r.dpi;

  const gridVals = [0, 1, Math.round(maxY)].filter((v, i, a) => v <= maxY && a.indexOf(v) === i);
  const yearTicks = rows.map((r, i) => ({ i, yr: r.year })).filter((t, idx) => idx === 0 || idx === n - 1 || t.i === anchorIdx || rows[t.i].year % (n > 12 ? 2 : 1) === 0);
  const hc = hoverI != null ? rows[hoverI] : null;
  const tipLeft = hc ? Math.max(8, Math.min(92, (x(hoverI) / W) * 100)) : 0;
  const lab = { ...sans, fontSize: FS.micro, fill: MICRO };

  return (
    <div className="card" style={{ padding: "16px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
        <H3>DPI · RVPI · TVPI over the fund's life</H3>
        <span style={{ flex: 1 }} />
        {[["Realized (DPI)", C_DPI], ["Unrealized (RVPI)", C_RVPI]].map(([t, c]) => (
          <span key={t} style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{t}
          </span>
        ))}
        <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 0, borderTop: `2px dashed ${C_TVPI}` }} />TVPI
        </span>
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="DPI, RVPI and TVPI over the fund's life">
          {/* y gridlines */}
          {gridVals.map((v) => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" strokeDasharray={v === 0 ? "" : "2 3"} />
              <text x={PL - 8} y={y(v) + 4} textAnchor="end" style={lab}>{v}×</text>
            </g>
          ))}
          {/* actual bands (solid) then projected bands (lighter) */}
          <path d={area(0, anchorIdx, dpiTop, zero)} fill={C_DPI} opacity="0.9" />
          <path d={area(0, anchorIdx, tvpiTop, dpiBot)} fill={C_RVPI} opacity="0.85" />
          {anchorIdx < n - 1 && <>
            <path d={area(anchorIdx, n - 1, dpiTop, zero)} fill={C_DPI} opacity="0.4" />
            <path d={area(anchorIdx, n - 1, tvpiTop, dpiBot)} fill={C_RVPI} opacity="0.35" />
          </>}
          {/* TVPI line — solid over actual, dashed over projected */}
          <path d={line(0, anchorIdx, tvpiTop)} fill="none" stroke={C_TVPI} strokeWidth="2" strokeLinejoin="round" opacity="0.9" />
          {anchorIdx < n - 1 && <path d={line(anchorIdx, n - 1, tvpiTop)} fill="none" stroke={C_TVPI} strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" opacity="0.9" />}
          {/* "today" marker */}
          <line x1={x(anchorIdx)} x2={x(anchorIdx)} y1={PT} y2={y0} style={{ stroke: "var(--ink-color-global-text-subtle)" }} strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
          <text x={x(anchorIdx)} y={PT - 4} textAnchor="middle" style={{ ...sans, fontSize: FS.micro, fontWeight: 700, fill: "var(--ink-color-global-text-subtle)" }}>Today</text>
          {/* x-axis year ticks */}
          <line x1={PL} x2={W - PR} y1={y0} y2={y0} style={{ stroke: "var(--ink-color-global-border-subtle)" }} strokeWidth="1" />
          {yearTicks.map((t) => (
            <text key={t.yr} x={x(t.i)} y={H - PB + 20} textAnchor="middle" style={lab}>{t.yr}</text>
          ))}
          {/* TVPI endpoint dot + label */}
          <circle cx={x(n - 1)} cy={y(rows[n - 1].tvpi)} r="3.5" style={{ fill: C_TVPI }} />
          <text x={W - PR + 6} y={y(rows[n - 1].tvpi) + 4} style={{ ...inkNum, fontSize: 12, fontWeight: 700, fill: C_TVPI }}>{fmtX(rows[n - 1].tvpi)}</text>
          {/* hover hit-columns */}
          {rows.map((r, i) => (
            <rect key={r.year} x={x(i) - (plotW / (n - 1)) / 2} y={PT} width={plotW / (n - 1)} height={plotH} fill="transparent"
              onMouseEnter={() => setHoverI(i)} onMouseLeave={() => setHoverI(null)} style={{ cursor: "pointer" }} />
          ))}
          {hc && <line x1={x(hoverI)} x2={x(hoverI)} y1={PT} y2={y0} style={{ stroke: "var(--ink-color-global-text-subtle)" }} strokeWidth="1" opacity="0.35" />}
        </svg>
        {hc && (
          <div style={{ position: "absolute", top: 0, left: `${tipLeft}%`, transform: "translateX(-50%)", pointerEvents: "none",
            background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, padding: "8px 12px", boxShadow: "0 6px 18px rgba(16,24,40,.14)", whiteSpace: "nowrap" }}>
            <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 3 }}>{hc.year}{hc.actual ? "" : " · projected"}</div>
            {[["TVPI", hc.tvpi, C_TVPI], ["DPI", hc.dpi, C_DPI], ["RVPI", hc.rvpi, C_RVPI]].map(([t, v, c]) => (
              <div key={t} style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{t}
                </span>
                <span style={{ ...inkNum, fontSize: FS.micro, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{fmtX(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Rendered as a section inside LP Returns. `fundState` is the live (repriced)
 *  per-fund state; the parent owns fund selection. */
export default function Glidepath({ snapshot, fundState, portfolio, setAssumption, readOnly }) {
  const fundId = fundState?.id;
  const asOfYear = +String(snapshot.source?.navAsOf).slice(0, 4);
  const wd = snapshot.windDownYear?.[fundId];
  const defaults = useMemo(() => ({
    investmentPeriodYears: 4,
    callShape: "declining",
    realizationShape: "backloaded",
    navGrowthPct: 0,
    horizonEndYear: Number.isFinite(wd) && wd > asOfYear ? wd : asOfYear + 8,
  }), [wd, asOfYear]);

  const gpAll = portfolio.assumptions.glidepath || {};
  const knobs = { ...defaults, ...(gpAll[fundId] || {}) };
  const setKnob = (patch) => setAssumption("glidepath", { ...gpAll, [fundId]: { ...knobs, ...patch } });

  const g = useMemo(
    () => (fundState ? fundGlidepath(snapshot, fundState, { ...knobs, navGrowth: knobs.navGrowthPct / 100 }) : null),
    // live fund-state fields (repricing/exits move these) + the pacing knobs
    [snapshot, fundId, fundState?.lpNav, fundState?.dpi, fundState?.rvpi, fundState?.tvpi, fundState?.lpPaidIn, fundState?.lpDistributed,
     knobs.investmentPeriodYears, knobs.callShape, knobs.realizationShape, knobs.navGrowthPct, knobs.horizonEndYear]
  );

  return (
    <div>
      <H2 id="lp-glidepath">LP glidepath</H2>
      <MethodNote>
        {fundState ? fundLabel(fundState.name) : "The fund"}'s LP multiples over its life, at this scenario's marks. Left of “Today” is actual (from Carta cashflows + NAV marks); right is a projection: remaining uncalled commitment is called over the investment period and deployed at the fund's current multiple, and the resulting value is realized over the horizon. At 0% NAV growth today's TVPI is held flat — RVPI simply converts into DPI over time; raise NAV growth to model further appreciation. Repricing companies or toggling exits moves the Today anchor and the whole path.
      </MethodNote>

      {!g ? (
        <div className="card" style={{ padding: "22px 24px", ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>
          No paid-in capital yet for {fundState ? fundLabel(fundState.name) : "this fund"} — a glidepath needs called capital to anchor a multiple.
        </div>
      ) : (
        <>
          {/* current multiples (this scenario's live marks) */}
          <StatBar itemStyle={{ minWidth: 130 }} style={{ marginBottom: 16 }} stats={[
            { label: "TVPI today", value: fmtX(g.current.tvpi), color: C_TVPI, sub: "total value / paid-in" },
            { label: "DPI today", value: fmtX(g.current.dpi), color: C_DPI, sub: "realized / paid-in" },
            { label: "RVPI today", value: fmtX(g.current.rvpi), color: C_RVPI, sub: "unrealized / paid-in" },
            { label: `Projected TVPI ${g.horizonEndYear}`, value: fmtX(g.years[g.years.length - 1].tvpi), sub: `at wind-down` },
            { label: "Uncalled", value: fmtM(g.uncalled), sub: `${fmtPct(g.committed ? g.uncalled / g.committed : 0, 0)} of committed` },
          ]} />

          <GlidepathChart g={g} />

          {/* pacing knobs — persist per fund into the active scenario */}
          <div className="card" style={{ padding: "16px 20px", margin: "16px 0" }}>
            <Eyebrow>Projection assumptions{readOnly ? " · Baseline is read-only" : ""}</Eyebrow>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginTop: 10 }}>
              <Slider label="Investment period" value={knobs.investmentPeriodYears} min={1} max={8} step={1}
                onChange={(v) => setKnob({ investmentPeriodYears: v })} fmt={(v) => `${v} yr${v > 1 ? "s" : ""}`} locked={readOnly}
                style={{ flex: "1 1 200px", minWidth: 180 }} />
              <Slider label="Wind-down year" value={knobs.horizonEndYear} min={asOfYear + 1} max={asOfYear + 15} step={1}
                onChange={(v) => setKnob({ horizonEndYear: v })} fmt={(v) => String(v)} locked={readOnly}
                style={{ flex: "1 1 200px", minWidth: 180 }} />
              <Slider label="NAV growth / yr" value={knobs.navGrowthPct} min={0} max={25} step={1}
                onChange={(v) => setKnob({ navGrowthPct: v })} fmt={(v) => `${v}%`} locked={readOnly}
                style={{ flex: "1 1 200px", minWidth: 180 }} />
              <ShapeKnob label="Call pacing" value={knobs.callShape} onChange={(v) => setKnob({ callShape: v })} locked={readOnly} />
              <ShapeKnob label="Distribution pacing" value={knobs.realizationShape} onChange={(v) => setKnob({ realizationShape: v })} locked={readOnly} />
            </div>
          </div>

          {/* per-year ledger */}
          <table className="ledger">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Year</th>
                {["Paid-in", "Distributions", "NAV", "DPI", "RVPI", "TVPI"].map((h) => (
                  <th key={h} style={{ textAlign: "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.years.map((r) => {
                const cell = { ...inkNum, textAlign: "right", fontSize: FS.value, whiteSpace: "nowrap" };
                return (
                  <tr key={r.year}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {r.year}
                      {!r.actual && <Badge tone="muted" style={{ marginLeft: 6 }}>PROJ</Badge>}
                    </td>
                    <td style={cell}>{fmtM(r.paidIn)}</td>
                    <td style={cell}>{fmtM(r.cumDist)}</td>
                    <td style={{ ...cell, color: "var(--ink-color-global-text-subtle)" }}>{fmtM(r.nav)}</td>
                    <td style={{ ...cell, color: C_DPI, fontWeight: 700 }}>{fmtX(r.dpi)}</td>
                    <td style={{ ...cell, color: C_RVPI }}>{fmtX(r.rvpi)}</td>
                    <td style={{ ...cell, fontWeight: 700 }}>{fmtX(r.tvpi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <SourceNote>
            Source: Carta Fund Admin — paid-in, distributions and LP NAV; the “today” multiples are this scenario's live marks (they move with repricing and exit toggles). Amounts are in the fund's reporting currency. The forward path is a planning projection driven by the assumptions above, not a Carta forecast.
          </SourceNote>
        </>
      )}
    </div>
  );
}
