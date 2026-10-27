import { useState } from "react";
import { FS, inkNum, sans, MICRO } from "../../ui/theme.js";
import { Num, Eyebrow, H3, InfoTip, MultiFundPicker, MixedCurrencyText } from "../../ui/components.jsx";
import { fmtM, fmtTick, fmtX } from "../../ui/format.js";
import { WidgetCard, SUBTLE, fundColors, widgetFundName, byVintage } from "./WidgetCard.jsx";
import { useWidth } from "../construction/ModelCharts.jsx";

/** A trend needs at least two quarter-ends of NAV history. */
export const hasTrend = (snapshot) => (snapshot.navSeries || []).length >= 2;

// The summary card's type, as the GP partner dashboard's summary panel sets it: an
// uppercase eyebrow over a 24px semibold headline, then label/value rows at 14px.
const HEADLINE_LABEL = { fontSize: FS.body, lineHeight: "16px", fontWeight: 500, letterSpacing: "0.08em" };
const HEADLINE = { ...inkNum, fontSize: 24, lineHeight: "44px", fontWeight: 600, color: "var(--ink-color-global-text-default)" };
const ROW_LABEL = { ...sans, fontSize: FS.value, lineHeight: "20px", color: "var(--ink-color-global-text-subtle)" };
const ROW_VALUE = { ...inkNum, fontSize: FS.value, lineHeight: "20px", fontWeight: 600, color: "var(--ink-color-global-text-default)" };

/** One supporting figure: its label on the left, its value on the right. */
function SummaryRow({ testId, label, value }) {
  return (
    <div data-testid={testId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={ROW_LABEL}>{label}</span>
      <span style={ROW_VALUE}>{value}</span>
    </div>
  );
}

/** LP NAV as the headline, then LP distributions, TVPI and GP carry as rows held to
 *  the foot of the card, under a rule. */
function HeroFigures({ firm }) {
  return (
    <div data-testid="ov-kpis" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div data-testid="ov-kpi-nav">
        <Eyebrow style={HEADLINE_LABEL}>LP NAV</Eyebrow>
        <div style={HEADLINE}><Num value={firm.lpNav} fmt={fmtM} /></div>
      </div>
      <div style={{ flex: 1, minHeight: 24 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--ink-color-global-border-subtle)", paddingTop: 18 }}>
        <SummaryRow testId="ov-kpi-dist" label="LP distributions" value={<Num value={firm.lpDistributed} fmt={fmtM} />} />
        <SummaryRow testId="ov-kpi-tvpi" label="TVPI" value={<Num value={firm.tvpi} fmt={fmtX} />} />
        <SummaryRow testId="ov-kpi-carry" label="GP carry" value={<Num value={firm.gpCarry} fmt={fmtM} />} />
      </div>
    </div>
  );
}

// The NAV chart's height and padding in pixels; it draws at its column's measured
// width, so its labels stay at real pixel size however wide the column gets.
const TH = 214, TPL = 44, TPR = 8, TPT = 10, TPB = 26;
const GAP = 2; // surface gap between stacked segments

/** Round step for about three gridlines up to `max`. */
function niceStep(max) {
  const raw = max / 3, mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
}

/** A column segment: square at every corner, whichever funds are shown. */
const segPath = (x, y, w, h) => `M${x} ${y + h}V${y}H${x + w}V${y + h}Z`;

/** LP NAV over time, stacked by fund, oldest fund at the base. Columns come from
 *  snapshot.navSeries[].byFund (per-fund ending LP NAV per quarter); the LATEST column
 *  reacts to the active scenario — each fund's segment shifts by its own reprice.
 *  History stays booked. The fund picker sits in the header and the fund key under
 *  the chart. The hero's second card, beside the summary card. */
export function NavByFundCard({ snapshot, fundStates, firmLpNav, firmName, span }) {
  const [hoverI, setHoverI] = useState(null);
  const [ref, TW] = useWidth(640);
  const fundList = [...(snapshot.funds || [])].sort(byVintage);
  const colorOf = fundColors(fundList);
  const nameOf = Object.fromEntries(fundList.map((f) => [f.id, widgetFundName(f.name, firmName)]));
  // Entity multi-select — default all shown. Which fund segments the chart stacks.
  const [shownIds, setShownIds] = useState(() => new Set(fundList.map((f) => f.id)));
  const rawSeries = snapshot.navSeries || [];
  const shown = fundList.filter((f) => shownIds.has(f.id));
  const allShown = shown.length === fundList.length;
  const fsById = Object.fromEntries((fundStates || []).map((f) => [f.id, f]));

  const lastIdx = rawSeries.length - 1;
  // One column per quarter. Negative fund NAVs can't stack, so segments clamp at 0.
  // The LAST column is the live scenario: per-fund scenario LP NAV, and with every
  // fund shown its tooltip total is the firm rollup, so it ties out to the hero and table.
  const cols = rawSeries.map((p, idx) => {
    const isLast = idx === lastIdx;
    const per = (f) => (isLast && fsById[f.id]) ? fsById[f.id].lpNav : (p.byFund?.[f.id] || 0);
    const segs = shown.map((f) => ({ id: f.id, v: Math.max(0, per(f)) })).filter((s) => s.v > 0);
    const total = segs.reduce((s, x) => s + x.v, 0);
    const firmFull = isLast ? firmLpNav : p.nav;
    return { date: p.date, segs, total, firmNav: allShown ? firmFull : total };
  });

  const peak = Math.max(1e3, ...cols.map((c) => c.total)); // a $0–$1K axis when nothing is shown
  const step = niceStep(peak);
  const top = Math.max(step, Math.ceil(peak / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const n = cols.length;
  const slot = (TW - TPL - TPR) / n;
  const bw = Math.min(16, slot * 0.6);
  const cx = (i) => TPL + i * slot + slot / 2;
  const y = (v) => TPT + (1 - v / top) * (TH - TPT - TPB);
  const rawYearTicks = cols.map((c, i) => ({ i, yr: c.date.slice(0, 4) })).filter((t, idx, arr) => idx === 0 || t.yr !== arr[idx - 1].yr);
  // Drop a partial leading year's label when it would collide with the next year's.
  const yearTicks = rawYearTicks.length > 1 && cx(rawYearTicks[1].i) - cx(rawYearTicks[0].i) < 26 ? rawYearTicks.slice(1) : rawYearTicks;

  const hc = hoverI != null ? cols[hoverI] : null;
  const tipLeft = hc ? Math.max(12, Math.min(88, (cx(hoverI) / TW) * 100)) : 0;
  const lab = { ...inkNum, fontSize: FS.small, fill: MICRO };
  return (
    <WidgetCard testId="ov-chart-card" span={span}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, columnGap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <H3>LP NAV by fund</H3>
        <InfoTip label="About this chart" portal width={320}>
          Source: Carta Fund Admin, per-fund LP NAV at quarter-ends. The latest column reflects this scenario's marks; earlier columns are booked history. Totals follow the fund selection.
        </InfoTip>
        <span style={{ flex: 1 }} />
        <MultiFundPicker funds={fundList} selected={shownIds} onChange={setShownIds} colorOf={colorOf} />
      </div>
      <div ref={ref} style={{ position: "relative" }}>
        <svg width={TW} height={TH} viewBox={`0 0 ${TW} ${TH}`} style={{ display: "block", overflow: "visible" }} role="img" aria-label="LP NAV by fund over time">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={TPL} x2={TW - TPR} y1={y(t)} y2={y(t)} strokeWidth="1"
                style={{ stroke: t === 0 ? "var(--ink-color-global-border-default)" : "var(--ink-color-global-border-subtle)" }} />
              <text x={TPL - 8} y={y(t) + 4} textAnchor="end" style={lab}>{fmtTick(t)}</text>
            </g>
          ))}
          {yearTicks.map((t) => (
            <text key={t.yr + t.i} x={cx(t.i)} y={TH - 6} textAnchor="middle" style={lab}>{t.yr}</text>
          ))}
          {cols.map((c, i) => {
            let acc = 0;
            const dim = hoverI != null && hoverI !== i;
            return (
              <g key={c.date} style={{ cursor: "pointer" }} onMouseEnter={() => setHoverI(i)} onMouseLeave={() => setHoverI(null)}>
                <rect x={cx(i) - slot / 2} y={TPT} width={slot} height={TH - TPT - TPB} fill="transparent" />
                {c.segs.map((s, si) => {
                  const yTop = y(acc + s.v), yBot = y(acc) - (si ? GAP : 0);
                  acc += s.v;
                  const h = Math.max(0.8, yBot - yTop);
                  return (
                    <path key={s.id} d={segPath(cx(i) - bw / 2, yTop, bw, h)}
                      style={{ fill: colorOf[s.id] }} opacity={dim ? 0.35 : 1}>
                      <title>{`${nameOf[s.id]} · ${fmtM(s.v)} (${c.date})`}</title>
                    </path>
                  );
                })}
              </g>
            );
          })}
        </svg>
        {hc && (
          <div style={{ position: "absolute", top: 0, left: `${tipLeft}%`, transform: "translateX(-50%)", pointerEvents: "none",
            background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8, padding: "8px 12px", boxShadow: "0 6px 18px rgba(16,24,40,.14)", whiteSpace: "nowrap" }}>
            <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 3 }}>{hc.date}</div>
            <div style={{ ...inkNum, fontSize: FS.bodyLg, fontWeight: 500, color: "var(--ink-color-global-text-default)" }}>{fmtM(hc.firmNav)} <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)" }}>LP NAV</span></div>
            {hc.segs.length > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--ink-color-global-border-subtle)", display: "flex", flexDirection: "column", gap: 3 }}>
                {[...hc.segs].reverse().map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
                    <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf[s.id], display: "inline-block", flex: "none" }} />
                      {nameOf[s.id]}
                    </span>
                    <span style={{ ...inkNum, fontSize: FS.micro, fontWeight: 500, color: "var(--ink-color-global-text-default)" }}>{fmtM(s.v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div data-testid="ov-hero-legend" style={{ display: "flex", flexWrap: "wrap", gap: 6, columnGap: 16, marginTop: 10 }}>
        {shown.map((f) => (
          <span key={f.id} style={{ ...SUBTLE, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf[f.id], display: "inline-block", flex: "none" }} />
            {nameOf[f.id]}
          </span>
        ))}
      </div>
    </WidgetCard>
  );
}

/** Firm Overview's summary card, the hero's first card: the firm's figures. `firm` is
 *  App's live firm rollup. A mixed-currency firm gets the shared notice in place of
 *  the figures, since they sum across funds, under a "Firm figures" title that says
 *  what isn't shown. */
export default function PerformanceHero({ firm, span }) {
  return (
    <WidgetCard testId="ov-hero" span={span} pad="24px" className="ov-summary-card" title={firm.mixedCurrency ? "Firm figures" : undefined}>
      {firm.mixedCurrency ? (
        <div data-testid="ov-kpis"><MixedCurrencyText /></div>
      ) : (
        <HeroFigures firm={firm} />
      )}
    </WidgetCard>
  );
}
