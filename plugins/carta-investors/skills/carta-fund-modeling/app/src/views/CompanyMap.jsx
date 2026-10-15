import { useState } from "react";
import { sans, inkNum, FS } from "../ui/theme.js";
import { fmtM } from "../ui/format.js";
import { DeltaCaret, fundLabel, InfoTip } from "../ui/components.jsx";
import { layoutTreemap } from "../model/treemap.js";

// The map is laid out in this fixed space and drawn as percentages inside a box
// of the same aspect ratio, so it scales with the page without being measured.
const MAP_W = 1000, MAP_H = 560, GROUP_GAP = 6;
// A box smaller than this (in layout units) skips its label outright; its hover
// tooltip still names it. Above it, a label line the box can't fit at the current
// pixel size wraps into a column past the box's edge, where it's clipped whole.
const LABEL_MIN_W = 56, LABEL_MIN_H = 38;
const pct = (v, of) => `${(v / of) * 100}%`;
// opacity of the boxes that aren't the hovered company's
const FADED = 0.35;

// Fund fills: the Ink data-viz hues at tint 2 in this order, then tint 1, then
// tint 3. Green and red stay out because on this page they mean up and down.
// Each fill carries the text and change colors that stay readable on it.
const ON_LIGHT = { text: "var(--ink-color-global-brand-black)", up: "var(--local-data-viz-positive-4)", down: "var(--local-data-viz-negative-4)" };
const ON_DARK = { text: "var(--ink-color-global-brand-white)", up: "var(--local-data-viz-positive-1)", down: "var(--local-data-viz-negative-1)" };
const HUES = ["blue", "turquoise", "lime", "yellow", "brown"];
const FUND_COLORS = [2, 1, 3].flatMap((tint) => HUES.map((hue) => ({
  // Ink tokenizes level 3; levels 1-2 are the app's --local-data-viz-* (theme.js)
  fill: tint === 3 ? `var(--ink-color-global-data-viz-${hue}-3)` : `var(--local-data-viz-${hue}-${tint})`,
  ...(hue === "blue" && tint !== 1 ? ON_DARK : ON_LIGHT),
})));

// Value with its change vs the Carta mark on the same line, the change smaller
// and colored by direction.
const ValueLine = ({ value, delta, colors }) => (
  <span style={{ ...inkNum, whiteSpace: "nowrap" }}>
    {fmtM(value)}
    {delta != null && (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2, marginLeft: 6, fontSize: FS.small, color: delta >= 0 ? colors.up : colors.down }}>
        <DeltaCaret up={delta >= 0} />{fmtM(Math.abs(delta))}
      </span>
    )}
  </span>
);

const ellipsis = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
// full column width, never shrunk: a line that doesn't fit wraps rather than squashes
const labelLine = { fontSize: FS.body, lineHeight: "16px", width: "100%", flexShrink: 0 };
// a line of explanation under the map
const footnote = { ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", marginTop: 8 };

/** Treemap of the Companies list: a box per company per fund holding it, sized
 *  by that stake's current scenario value and colored by fund.
 *  `entries` is [{ company, funds: [{ fundId, value, delta }], total }] where
 *  `delta` is the change vs the Carta mark, or null when the stake isn't
 *  repriced, and `total` is the company's value across every fund holding it,
 *  shown in the tooltip (null when one fund holds it, or its funds' currencies differ).
 *  `funds` is the snapshot's fund list, which fixes each fund's color. */
export default function CompanyMap({ entries, funds, onOpen }) {
  // the company under the pointer (or keyboard focus): its boxes stay, the rest fade
  const [hoveredId, setHoveredId] = useState(null);
  const colorOf = (fundId) => FUND_COLORS[Math.max(0, funds.findIndex((f) => f.id === fundId)) % FUND_COLORS.length];
  const nameOf = (fundId) => fundLabel(funds.find((f) => f.id === fundId)?.name || fundId);
  const groups = layoutTreemap(
    funds.map((f) => ({
      id: f.id,
      items: entries.flatMap(({ company, funds: stakes, total }) => stakes
        .filter((s) => s.fundId === f.id)
        .map((s) => ({ id: `${company.id}:${f.id}`, company, fundId: f.id, value: s.value, delta: s.delta, total }))),
    })),
    { x: 0, y: 0, w: MAP_W, h: MAP_H },
    { gap: GROUP_GAP },
  );
  const notShown = entries.filter((e) => !e.funds.some((s) => s.value > 0)).length;
  const legend = groups.length > 1 ? funds.filter((f) => groups.some((g) => g.id === f.id)) : [];

  return (
    <div>
      {groups.length > 0 ? (
        <div role="group" aria-label="Companies map" data-testid="company-map"
          style={{ position: "relative", width: "100%", aspectRatio: `${MAP_W} / ${MAP_H}` }}>
          {groups.flatMap((g) => g.items).map((t) => {
            const c = colorOf(t.fundId);
            const labelled = t.w >= LABEL_MIN_W && t.h >= LABEL_MIN_H;
            const tile = (
              <button type="button" className="map-tile" data-testid={`map-tile-${t.company.slug}`}
                aria-label={`${t.company.name}, ${nameOf(t.fundId)}: ${fmtM(t.value)}`}
                onClick={() => onOpen(t.company.id)}
                onMouseEnter={() => setHoveredId(t.company.id)} onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(t.company.id)} onBlur={() => setHoveredId(null)}
                // a border-box can't shrink below its padding, so an unlabelled box has
                // none; the wrapper clips the box, so its focus ring is an inset
                // shadow (.map-tile in theme.js)
                style={{ ...sans, width: "100%", height: "100%",
                  boxSizing: "border-box", margin: 0, padding: labelled ? "6px 8px" : 0, border: "1px solid var(--ink-color-global-surface-background-default)",
                  background: c.fill, color: c.text, textAlign: "left",
                  opacity: hoveredId && hoveredId !== t.company.id ? FADED : 1, transition: "opacity 120ms ease-out", verticalAlign: "top", overflow: "hidden", cursor: "pointer",
                  // columnGap beats the 8px right padding, so a wrapped line is fully clipped
                  display: "flex", flexDirection: "column", flexWrap: "wrap", alignContent: "flex-start", columnGap: 16,
                  justifyContent: "flex-start", alignItems: "stretch" }}>
                {labelled && (
                  <>
                    {/* a flex column always keeps its first item, so this empty spacer goes
                        first: then the name, too, can wrap out of sight when it doesn't fit */}
                    <span aria-hidden="true" style={{ width: "100%", height: 0, flexShrink: 0 }} />
                    <span style={{ ...ellipsis, ...labelLine, fontWeight: 500 }}>{t.company.name}</span>
                    <span style={{ ...ellipsis, ...labelLine }}>
                      <ValueLine value={t.value} delta={t.delta} colors={c} />
                    </span>
                  </>
                )}
              </button>
            );
            // the app's dark Ink tooltip, pointing at the box's centre (portaled, so
            // the map can't clip it); the tooltip's wrapper is the positioned box,
            // clipping it to its exact place in the layout
            return (
              <InfoTip key={t.id} portal placement="top" anchor="center" width={240} trigger={tile}
                style={{ position: "absolute", left: pct(t.x, MAP_W), top: pct(t.y, MAP_H), width: pct(t.w, MAP_W), height: pct(t.h, MAP_H), overflow: "hidden" }}>
                <div style={{ fontWeight: 500 }}>{t.company.name}</div>
                {groups.length > 1 && <div style={{ opacity: 0.7 }}>{nameOf(t.fundId)}</div>}
                <div style={{ marginTop: 2 }}><ValueLine value={t.value} delta={t.delta} colors={ON_DARK} /></div>
                {t.total != null && <div style={{ opacity: 0.7 }}>Total holdings: <span style={inkNum}>{fmtM(t.total)}</span></div>}
              </InfoTip>
            );
          })}
        </div>
      ) : entries.length === 0 && (
        <div style={{ ...sans, color: "var(--ink-color-global-text-subtle)", padding: "16px 12px" }}>No operating companies match.</div>
      )}
      {legend.length > 0 && (
        <div data-testid="company-map-legend" style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginTop: 12 }}>
          {legend.map((f) => (
            <span key={f.id} style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>
              <span aria-hidden="true" style={{ width: 24, height: 8, borderRadius: 2, background: colorOf(f.id).fill }} />
              {nameOf(f.id)}
            </span>
          ))}
        </div>
      )}
      {notShown > 0 && (
        <div style={footnote}>
          {notShown} {notShown === 1 ? "company has" : "companies have"} no current value (exited or written off) and {notShown === 1 ? "isn't" : "aren't"} on the map.
        </div>
      )}
    </div>
  );
}
