import { FS, inkNum, sans } from "../../ui/theme.js";
import { Num, Eyebrow, MixedCurrencyText } from "../../ui/components.jsx";
import { fmtM, fmtX } from "../../ui/format.js";
import { WidgetCard } from "./WidgetCard.jsx";

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
