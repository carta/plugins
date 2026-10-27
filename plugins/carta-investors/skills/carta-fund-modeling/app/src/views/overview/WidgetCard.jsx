import { FS, inkNum, sans } from "../../ui/theme.js";
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

/** A widget's closing line of context, held to the foot of the card so the lines in a row line up. */
export function WidgetNote({ children, testId }) {
  return <div data-testid={testId} style={{ ...SUBTLE, marginTop: "auto", paddingTop: 12 }}>{children}</div>;
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

/** A thin horizontal bar of `parts` ({ value, color }) on the light gray track,
 *  `max` wide; a 2px gap separates the parts. */
export function ThinBar({ parts, max, height = 6, title }) {
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div title={title} style={{ flex: 1, minWidth: 0, height, display: "flex", gap: 2, background: TRACK, borderRadius: height / 2, overflow: "hidden" }}>
      {shown.map((p, i) => (
        <div key={i} style={{ width: `${max > 0 ? Math.min(100, (p.value / max) * 100) : 0}%`, background: p.color }} />
      ))}
    </div>
  );
}

/** The bar-list style Concentration and Dry powder share: one row per item with its
 *  name, an accent bar on the gray track and its value, in one three-column grid. */
const BAR_HEIGHT = 8;
const TEXT = "var(--ink-color-global-text-default)";

/** The grid that holds BarRows; `style` adds spacing around it. */
export function BarRows({ testId, style, ...rest }) {
  return <div data-testid={testId} {...rest} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr) auto", alignItems: "center", gap: "8px 10px", ...style }} />;
}

/** One BarRows row: `name` (cut short with an ellipsis, `nameTitle` on hover), a bar
 *  `amount` long against `max`, then `value`. Other props, like data-datum-*, go on the row. */
export function BarRow({ name, nameTitle, amount, max, barTitle, value, ...rest }) {
  return (
    <div {...rest} style={{ display: "contents" }}>
      <span title={nameTitle} style={{ ...sans, fontSize: FS.small, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: TEXT }}>{name}</span>
      <ThinBar parts={[{ value: amount, color: ACCENT }]} max={max} height={BAR_HEIGHT} title={barTitle} />
      <span style={{ ...inkNum, fontSize: FS.small, fontWeight: 500, textAlign: "right", whiteSpace: "nowrap", color: TEXT }}>{value}</span>
    </div>
  );
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
