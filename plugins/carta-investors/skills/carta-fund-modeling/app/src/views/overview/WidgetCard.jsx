import { FS, sans } from "../../ui/theme.js";
import { H3, Btn, StatTile, fundNameOnly } from "../../ui/components.jsx";
import { trackClick } from "../../analytics.js";

/** A dashboard card's classes: its width in the 12-column grid. */
export const widgetClass = (span) => `card ov-span-${span}`;

/** Secondary text on the dashboard: small and subtle. */
export const SUBTLE = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" };

/** Every card's inner padding, so the page reads as one grid; the hero's summary card alone is roomier. */
const PAD = "18px 20px";

/** One Firm Overview widget: a card with a title, an optional subtitle, a "View →"
 *  link to the tab that owns the full analysis, and the widget body. `view` is
 *  `{ tab, name, fundId?, section? }` — `name` is the analytics suffix
 *  (`FundModeling.Overview.Widget.<name>`), `fundId` lands a per-fund tab on that fund,
 *  `section` is the id of the element on that tab to scroll to.
 *  A card with none of the three has no header row.
 *  `span` is the widget's width in the dashboard's 12-column grid (see `.ov-bento`);
 *  `className` adds classes, `pad` overrides PAD. */
export function WidgetCard({ title, subtitle, view, onNavigate, testId, span = 4, pad = PAD, className, children }) {
  return (
    <section className={className ? `${widgetClass(span)} ${className}` : widgetClass(span)} data-testid={testId}
      style={{ padding: pad, display: "flex", flexDirection: "column", minWidth: 0 }}>
      {(title || subtitle || view) && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          {title && <H3>{title}</H3>}
          {subtitle && <span style={SUBTLE}>{subtitle}</span>}
          <span style={{ flex: 1 }} />
          {view && (
            <Btn kind="link" data-testid={`${testId}-view`}
              onClick={() => { trackClick(`FundModeling.Overview.Widget.${view.name}`); onNavigate(view.tab, view.fundId, view.section); }}>
              View →
            </Btn>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** A widget's headline figure: a StatTile, a label over a large regular-weight value. */
export function WidgetStat({ label, value }) {
  return <StatTile label={label} value={value} labelTone="plain" serif={false} size="h2" weight={500} style={{ minWidth: 0 }} />;
}

// The dashboard's data colors: one blue accent, the per-fund series colors (CSS vars
// in ui/theme.js, in Ink's series order) and the light gray "remaining" track. UP and
// DOWN colour deltas.
const SERIES_HUES = ["blue", "turquoise", "brown", "yellow", "lime", "positive", "negative"];
export const SERIES = [2, 4].flatMap((level) => SERIES_HUES.map((hue) => `var(--ov-series-${hue}-${level})`));
export const ACCENT = "var(--ov-accent)";
export const UP = "var(--ink-color-global-feedback-positive-strong)";
export const DOWN = "var(--ink-color-global-feedback-negative-strong)";
export const TRACK = "var(--ov-track)";

/** Fund id → series color, oldest vintage first; past fourteen funds the colors repeat.
 *  The color follows the fund, so it is the same in every chart and survives filtering. */
export function fundColors(funds) {
  const ordered = [...funds].sort(byVintage);
  return Object.fromEntries(ordered.map((f, i) => [f.id, SERIES[i % SERIES.length]]));
}

/** A fund's readable name without the firm's own name in front ("Northwind Ventures
 *  Fund III" → "Fund III"): on the firm's own dashboard that prefix repeats on every
 *  row and crowds out the part that tells the funds apart. */
export function widgetFundName(name, firmName) {
  const n = fundNameOnly(name) || "";
  return firmName && n.toLowerCase().startsWith(firmName.toLowerCase() + " ") ? n.slice(firmName.length + 1) : n;
}

/** Funds oldest vintage first — the order every fund list on the dashboard shares. */
export const byVintage = (a, b) => (a.vintage ?? Infinity) - (b.vintage ?? Infinity);
