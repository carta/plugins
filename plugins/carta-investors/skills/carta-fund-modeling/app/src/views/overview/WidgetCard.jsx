import { FS, sans } from "../../ui/theme.js";
import { H3, Btn, StatTile } from "../../ui/components.jsx";
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

// Delta colours on the dashboard: UP for a rise, DOWN for a fall.
export const UP = "var(--ink-color-global-feedback-positive-strong)";
export const DOWN = "var(--ink-color-global-feedback-negative-strong)";
