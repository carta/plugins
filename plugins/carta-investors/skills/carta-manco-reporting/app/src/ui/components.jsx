import { useEffect, useRef, useState } from "react";
import { sans, serif, INK, FAINT, LINE, PAPER, GRAD_DARK, CARD, FS, EYEBROW_TRACKING, SHADOW_HOVER } from "./theme.js";

/** Ink's real dark tooltip chip, matching `carta-fund-modeling`'s own
 *  `InfoTip`. Uses flat `brand-black`/`brand-white`, not
 *  `surface-darkgray-default` — that token is wrapped in
 *  `light-dark(#1A1A1A, #394040)` and rendered the wrong (slate-gray)
 *  branch here even on a light page. Positioning is the caller's job. */
export const TOOLTIP_BUBBLE = {
  ...sans,
  padding: "10px 14px",
  borderRadius: "var(--ink-size-global-radius-subtle)",
  background: "var(--ink-color-global-brand-black)",
  color: "var(--ink-color-global-brand-white)",
  fontSize: FS.body,
  lineHeight: "16px",
  boxShadow: SHADOW_HOVER,
  textAlign: "left",
};

/** The caret that pairs with TOOLTIP_BUBBLE, keyed by which side of the
 *  trigger the bubble opens on (InfoTip's own `placement` prop) — "bottom"
 *  (bubble below trigger) needs an upward-pointing caret sitting on the
 *  bubble's top edge, "top" the reverse. Same border-triangle trick as
 *  InfoTip: a zero-size box with two transparent sides and one colored
 *  side matching the bubble's own background. */
export const TOOLTIP_CARET = {
  bottom: {
    position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: "100%",
    borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
    borderBottom: "6px solid var(--ink-color-global-brand-black)",
  },
  top: {
    position: "absolute", left: "50%", transform: "translateX(-50%)", top: "100%",
    borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
    borderTop: "6px solid var(--ink-color-global-brand-black)",
  },
};

// Ink's real feedback-tone recipe (subtle bg + strong text/border), copied
// literally from Ink's `components.md` .ink-tag CSS. Not re-derived from a
// screenshot — that file's a versioned, mechanical extraction from Ink's actual
// source, more precise than what's achievable by eyeballing a rendered example.
// Values are Ink v35.2.0 (see the vendored Ink `tokens.css` snapshot).
const TAG_TONES = {
  neutral: { bg: "#F1F1F1", fg: "#1A1A1A", border: "#1A1A1A" },
  info: { bg: "#EAF0F8", fg: "#285DA3", border: "#285DA3" },
  positive: { bg: "#EBF7F6", fg: "#2D9E90", border: "#2D9E90" },
  negative: { bg: "#FFEEEF", fg: "#E52431", border: "#E52431" },
  warning: { bg: "#FFFCED", fg: "#B58A00", border: "#B58A00" }, // Ink brand-yellow-80 (feedback-notice text/border); bg is brand-yellow-20
};

/** Status/category pill — the exact recipe from Ink's components.md
 *  (`.ink-tag`), not re-derived from a screenshot: 400-weight (regular, NOT
 *  bold), radius-subtle (4px), border color MATCHES the semantic tone (not a
 *  neutral gray line), background is that tone's subtle tint, height fixed at
 *  28px per the real Ink spec. `tone` is one of neutral/info/positive/negative/
 *  warning (see TAG_TONES above); omit for the plain neutral default. Any call
 *  site that needs a more compact inline tag (e.g. a dense table cell) opts in
 *  via `style` — every current caller already does this, so the shared default
 *  stays at the real Ink size rather than assuming compactness for everyone. */
export const Tag = ({ tone = "neutral", children, style }) => {
  const t = TAG_TONES[tone] || TAG_TONES.neutral;
  return (
    <span style={{ ...sans, display: "inline-flex", alignItems: "center", height: 28, fontSize: FS.body, fontWeight: 400, lineHeight: 1,
      color: t.fg, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 4, padding: "0 8px",
      whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
};

/** Ink's real help-circle glyph — the HoverTip/InfoTip trigger icon, ported
 *  verbatim from carta-fund-modeling's own HelpCircleIcon. */
export const HelpCircleIcon = ({ size = 14, strokeWidth = 1.8, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", display: "block", ...style }}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7" />
    <path d="M12 17.5h.01" />
  </svg>
);

/** Ink's real Bubble — "highlights one or two words for more visibility."
 *  Same tone recipe as Tag (TAG_TONES above — Ink's feedback-tone bg/fg/border
 *  is one shared palette, not two), but Bubble's own shape: 18px tall, 0 8px
 *  padding, 12px/500-weight text, fully rounded (radius 999), sized to its
 *  content rather than a fixed control height. Not interactive — no
 *  hover/click. Docs: https://ink.carta.com/components/Bubble/usage */
export const Bubble = ({ tone = "info", children, style }) => {
  const t = TAG_TONES[tone] || TAG_TONES.info;
  return (
    <span style={{ ...sans, display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px",
      fontSize: FS.body, fontWeight: 500, lineHeight: 1, letterSpacing: "0.01em", whiteSpace: "nowrap", boxSizing: "border-box",
      borderRadius: 999, color: t.fg, background: t.bg, border: `1px solid ${t.border}`, ...style }}>
      {children}
    </span>
  );
};

export const Eyebrow = ({ children, color = FAINT, style }) => (
  <div style={{ ...sans, fontSize: FS.micro, letterSpacing: EYEBROW_TRACKING, textTransform: "uppercase", color, fontWeight: 600, ...style }}>
    {children}
  </div>
);

/** Ink's real table-header recipe: sentence case, 14px/500 weight — not an
 *  eyebrow. Shared by every drilldown section/chart title. */
export const ChartTitle = ({ children, as: Tag = "span", style }) => (
  <Tag style={{ ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 500, color: INK, ...style }}>
    {children}
  </Tag>
);

// Ink's real Heading 1 (28px/48 line-height/400-weight, prominent/serif family) —
// the page-level title. `right`/`actions` match carta-fund-modeling's own H1
// (and this app's H2 below), so a page-level control sits on the title's row.
export const H1 = ({ children, subhead, right, actions, id, style }) => (
  <div id={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 12, flexWrap: "wrap", scrollMarginTop: 20 }}>
    <div>
      <h1 style={{ ...serif, fontSize: FS.display, lineHeight: "48px", fontWeight: 400, margin: 0, color: INK, ...style }}>
        {children}
      </h1>
      {subhead && <h3 style={{ ...sans, fontSize: FS.h3, lineHeight: "28px", fontWeight: 500, margin: 0, color: INK }}>{subhead}</h3>}
    </div>
    <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      {right && <span style={{ ...sans, fontSize: FS.small, color: FAINT }}>{right}</span>}
      {actions}
    </span>
  </div>
);

// Matches Ink's real Heading 2 exactly (20px/36 line-height/500-weight, sans,
// sentence case) — per Ink's `heading-2-desktop` spec in tokens.css
// and carta-fund-modeling's own H2, not this app's own invented heading style.
export const H2 = ({ children, right, actions, id }) => (
  <div id={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 12, flexWrap: "wrap", scrollMarginTop: 20 }}>
    <h2 style={{ ...sans, fontSize: FS.h2, lineHeight: "36px", fontWeight: 500, margin: 0, color: INK }}>{children}</h2>
    <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      {right && <span style={{ ...sans, fontSize: FS.small, color: FAINT }}>{right}</span>}
      {actions}
    </span>
  </div>
);

/** Hover/focus card anchored to whatever it wraps.
 *
 *  Opens on focus as well as hover so the detail is reachable from the
 *  keyboard, which a `title` attribute is not.
 */
export const HoverCard = ({ children, card, align = "left", label }) => {
  const [open, setOpen] = useState(false);
  if (!card) return children;
  return (
    <span
      style={HOVER.anchor}
      tabIndex={0}
      aria-label={label}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          style={{ ...HOVER.card, ...(align === "right" ? { right: 0 } : { left: 0 }) }}
        >
          {card}
        </span>
      )}
    </span>
  );
};

const HOVER = {
  anchor: { position: "relative", display: "inline-block", cursor: "help", outline: "none" },
  card: {
    position: "absolute", top: "calc(100% + 6px)", zIndex: 40,
    minWidth: 260, maxWidth: 420, padding: "10px 12px",
    background: PAPER, border: `1px solid ${LINE}`, borderRadius: 4,
    boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
    textAlign: "left", whiteSpace: "normal", cursor: "default",
  },
};

/** Primary/secondary/danger button. Primary and hover/active states use ACCENT
 *  (brand-black) — never blue; blue is reserved for links/focus (see theme.js header
 *  note). Spacing/radius follow the canonical scale: 8/16px padding, 4px radius. */
export function MenuItem({ children, onClick, selected, small, style }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onClick}
      className="menu-item"
      style={{ ...sans, display: "flex", alignItems: "center", gap: 10, width: "100%",
        textAlign: "left", whiteSpace: "nowrap", border: "none", borderRadius: 4,
        cursor: "pointer", boxSizing: "border-box", fontWeight: 400, color: INK,
        padding: small ? "6px 10px" : "8px 12px",
        fontSize: small ? FS.body : FS.value,
        lineHeight: small ? "18px" : "20px",
        background: selected ? "var(--ink-color-global-surface-lightgray-hover)" : "transparent",
        ...style }}>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      {selected && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden
             style={{ flex: "none", color: INK }}>
          <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.75"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** Ink's real dropdown/menu popover elevation — two-layer, not a single
 *  generic shadow. */
export const POPOVER_SHADOW = "0 8px 24px rgba(20,24,24,.12), 0 2px 6px rgba(20,24,24,.08)";

/** Every control in a filter toolbar shares this chrome, so a Dropdown, a
 *  Btn and a date trigger sitting in one row can't drift apart. Ink's own
 *  small button (32px, 0 7px, 12px) reads too cramped for a toolbar and is
 *  deliberately not used here — carta-fund-modeling made the same call. */
export const TOOLBAR_CONTROL_STYLE = { height: 36, padding: "0 12px", fontSize: FS.value, lineHeight: "20px" };

/** Single-select dropdown — carta-fund-modeling's `Dropdown`, in this app's
 *  `small` toolbar size. `triggerLabel` makes the trigger self-labeling
 *  ("Period: Monthly"), Carta's convention instead of a separate label row. */
export function Dropdown({ options, value, onChange, triggerLabel, minWidth, style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const current = options.find((o) => o.id === value);
  const label = current ? current.label : options[0]?.label;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", ...style }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox" aria-expanded={open} aria-label={triggerLabel}
        className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...sans, display: "inline-flex", alignItems: "center", justifyContent: "space-between",
          gap: 8, boxSizing: "border-box", minWidth, ...TOOLBAR_CONTROL_STYLE,
          border: "1px solid var(--ink-color-global-border-default)", borderRadius: 4,
          background: PAPER, color: INK, cursor: "pointer", fontWeight: 500 }}>
        {/* One color for the whole trigger — Ink's .dd-trig sets a single
            text-default, with no label/value split. */}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {triggerLabel ? `${triggerLabel}: ${label}` : label}
        </span>
        <Chevron rotate={open ? 180 : 0} />
      </button>

      {open && (
        <div className="popin" role="listbox" aria-label={triggerLabel}
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%",
            maxHeight: 340, overflowY: "auto", background: PAPER,
            border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 6,
            boxShadow: POPOVER_SHADOW, zIndex: 50, padding: "4px 0", transformOrigin: "top left" }}>
          {options.map((o) => (
            <MenuItem key={o.id} selected={o.id === value}
                      onClick={() => { onChange(o.id); setOpen(false); }}>
              {o.label}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ink's `down-carat`, which the Ink theme contract maps to Lucide `chevron-down`
 *  (its Ink→Lucide table in brand.md). Geometry is Lucide's own: 24x24
 *  viewBox, path "M6 9l6 6 6-6", stroked not filled. `rotate` points it —
 *  180 for an open dropdown, -90 for a collapsed row. The defaults are what
 *  Ink renders on a dropdown trigger (`.dd-trig .carat`: 16px, stroke 1.5). */
export function Chevron({ size = 16, strokeWidth = 1.5, rotate = 0, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true" focusable="false"
         style={{ flex: "none", display: "block", transition: "transform 120ms ease-out",
                  transform: rotate ? `rotate(${rotate}deg)` : "none", ...style }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** The row-expand caret every budget table shares. */
export function CollapseCaret({ collapsed }) {
  return <Chevron size={14} strokeWidth={1.8} rotate={collapsed ? -90 : 0} />;
}

// ═══ Ink charts — InkLineChart / InkBarChart, shared by every chart here ═══
// Ported from Ink's charts.md (PR #17858). Styled from GLOBAL_CSS's
// .ink-chart* rules (theme.js), one copy for every chart in the app.
// `domain="signed"` on InkBarChart is this app's own extension, for a chart
// that genuinely goes negative (Cashflow.jsx) — out of scope for charts.md's
// zero-anchored recipes, which say to build that case "with the skill".

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(name, attrs = {}, style = "") {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  // A value containing var() must go through `style` — a var() inside an SVG
  // presentation attribute is silently dropped in older Safari.
  if (style) node.setAttribute("style", style);
  return node;
}

// Hidden on screen (theme.js); the HTML export reveals these to stand in
// for the hover tooltip it can't run.
function valueLabel(attrs, text) {
  const el = svgEl("text", { ...attrs, class: "ink-chart__value-label" });
  el.textContent = text;
  return el;
}

// Zero-anchored, rounded up to a readable step.
export function niceMax(max) {
  if (!(max > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8].find((s) => s * mag >= max) ?? 10) * mag;
}

// Halve the gaps while they stay wider than the target, so a dot lands on
// every tick and the field keeps an even density at any container width.
export function subdivide(positions, target) {
  let out = positions.slice().sort((a, b) => a - b);
  if (out.length === 0) return out;
  // Per-gap: grouped bars have a small within-group gap and a larger
  // between-group one, so checking only the smallest misses the larger.
  let changed = true;
  while (changed) {
    changed = false;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i + 1] - out[i] > target * 1.6) {
        next.push((out[i] + out[i + 1]) / 2);
        changed = true;
      }
      next.push(out[i + 1]);
    }
    out = next;
  }
  return out;
}

// A flat background grid across [min, max] at ~target spacing, with `points`
// (real bar/category centers, which are rarely evenly spaced themselves —
// grouped bars pack tighter within a group than between groups) merged in
// wherever one doesn't already sit near a grid line. subdivide+extend from
// the real points alone inherits their own irregular rhythm outward, which
// reads as a periodic gap wherever that rhythm repeats; a fixed-step grid
// underneath has no such period to inherit.
export function gridWithPoints(min, max, points, target) {
  if (max <= min) return points.slice().sort((a, b) => a - b);
  const steps = Math.max(1, Math.round((max - min) / target));
  const step = (max - min) / steps;
  const out = [];
  for (let x = min; x <= max + 1e-6; x += step) out.push(x);
  for (const p of points) {
    if (!out.some((g) => Math.abs(g - p) < step / 2)) out.push(p);
  }
  return out.sort((a, b) => a - b);
}

const DOT_GAP = 20;   // geometry: the density the field reads best at
const DOT_SIZE = 1.6; // square, matching hover markers and legend swatches

// Positional grid, not texture: a column on every category/point position, a
// row on every value tick. `skipAxis`/`skipVal` drop the one row (vertical
// charts) or column (horizontal charts) that lands exactly on the baseline —
// a dot straddling it would have half hidden under a bar's top edge.
function paintDots(svg, xs, ys, skipAxis, skipVal) {
  const g = svgEl("g", { class: "ink-chart__dots" });
  const cols = subdivide(xs, DOT_GAP);
  const rows = subdivide(ys, DOT_GAP);
  const half = DOT_SIZE / 2;
  cols.forEach((x) =>
    rows.forEach((y) => {
      if (skipAxis === "x" && Math.abs(skipVal - x) <= DOT_SIZE) return;
      if (skipAxis === "y" && Math.abs(skipVal - y) <= DOT_SIZE) return;
      g.append(svgEl("rect", {
        x: (x - half).toFixed(2), y: (y - half).toFixed(2),
        width: DOT_SIZE, height: DOT_SIZE,
      }));
    })
  );
  svg.append(g);
}

// Clamp the tooltip inside the plot, flipping below the anchor when there's
// no room above it — the card's overflow:hidden would otherwise slice off a
// tooltip anchored near the top of the plot.
//
// The plot is not the whole story. A panel fixed over the right of the page
// covers part of it without narrowing it, so a bar long enough to run under
// that panel had its tooltip land underneath — the reader hovers a bar and
// nothing appears. Anything marked [data-overlay-right] pulls the clamp in
// to where the page is still visible.
function placeTip(tip, x, y, plotWidth) {
  const below = y - tip.offsetHeight - 10 < 0;
  tip.classList.toggle("is-below", below);
  // Clamp y so the tooltip never overflows the plot's bottom edge when is-below.
  const plotH = tip.offsetParent ? tip.offsetParent.clientHeight : 9999;
  const clampedY = below ? Math.min(y, plotH - tip.offsetHeight - 10) : y;
  tip.style.top = `${clampedY}px`;
  const half = tip.offsetWidth / 2;
  let left = Math.max(half, Math.min(plotWidth - half, x));
  tip.style.left = `${Math.max(half, Math.min(left, visibleRight(tip) - half))}px`;
}

// Puts the tooltip beside the hovered bar rather than over it, tracking the
// cursor's Y. Used by every stacked breakdown, signed or not.
export function placeTipBeside(tip, { barL, barR, plotL, plotR, mouseY, W, H }) {
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  const GAP = 12;
  const roomRight = plotR - barR, roomLeft = barL - plotL;
  const placeRight = roomRight >= tipW + GAP || roomRight >= roomLeft;
  const half = tipW / 2;
  let centerX = placeRight ? barR + GAP + half : barL - GAP - half;
  centerX = Math.max(half, Math.min(W - half, centerX));
  centerX = Math.max(half, Math.min(centerX, visibleRight(tip) - half));
  tip.classList.remove("is-below");
  tip.style.transform = "translate(-50%, 0)";
  tip.style.left = `${centerX}px`;
  tip.style.top = `${Math.max(4, Math.min(H - tipH - 4, mouseY - tipH / 2))}px`;
}

// How far right the tooltip may reach, in the plot's own coordinates. The
// overlay is measured rather than assumed open: closed, it sits translated
// past the viewport and this returns a limit no tooltip can hit.
const TIP_GAP = 12;

function visibleRight(tip) {
  const host = tip.offsetParent;
  const overlay = typeof document !== "undefined"
    && document.querySelector("[data-overlay-right]");
  // A chart INSIDE the overlay (the drawer's own mini chart) isn't covered
  // by it — skip the clamp, or the reversed distance shoves the tip off-screen.
  if (!host || !overlay || overlay.contains(host)) return Infinity;
  return overlay.getBoundingClientRect().left
       - host.getBoundingClientRect().left - TIP_GAP;
}

// Rounds the TOP two corners only (vertical bars) — an `rx` on a <rect>
// rounds all four, which detaches the bar from its baseline.
function barPathV(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} ` +
         `L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

// Horizontal-bar counterpart: rounds the two corners furthest from the
// baseline (the right edge, since value grows rightward from x=pad.left).
function barPathH(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h / 2, w));
  return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} ` +
         `L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
}

// barPathV's mirror for a signed chart's downward (negative) bars, whose
// baseline sits at their TOP — rounds the bottom two corners instead.
function barPathVBottom(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y} L${x + w},${y} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} ` +
         `L${x + rr},${y + h} Q${x},${y + h} ${x},${y + h - rr} Z`;
}

// Diagonal hatch marking a period that has not closed. One pattern per
// series colour; ids are namespaced by chart so two charts on a page can't
// collide. The colour is passed in, never read back off the mark — a
// computed fill mid-transition returns the frame it is on, not the target.
function hatchPaint(svg, id, color) {
  let defs = svg.querySelector("defs");
  if (!defs) { defs = svgEl("defs"); svg.append(defs); }
  if (!defs.querySelector(`#${id}`)) {
    const pat = svgEl("pattern", {
      id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)",
    });
    pat.append(svgEl("rect", { width: 6, height: 6 }, `fill:${color};opacity:0.3`));
    pat.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 6 }, `stroke:${color};stroke-width:3`));
    defs.append(pat);
  }
  return `url(#${id})`;
}


function radiusSubtle() {
  return parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue("--ink-size-global-radius-subtle")) || 4;
}

// Clips a <text> node to `maxWidth` with an ellipsis. Keeps the full label
// on a data attribute, so a resize re-measures from the original string.
function truncateText(node, maxWidth) {
  if (maxWidth <= 0) return;
  const full = node.getAttribute("data-full-text") ?? node.textContent;
  node.setAttribute("data-full-text", full);
  if (node.getComputedTextLength() <= maxWidth) { node.textContent = full; return; }
  let lo = 0, hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    node.textContent = full.slice(0, mid) + "…";
    if (node.getComputedTextLength() <= maxWidth) lo = mid; else hi = mid - 1;
  }
  node.textContent = lo > 0 ? full.slice(0, lo) + "…" : "…";
}

// Every tooltip/legend string below lands via innerHTML, and every name in
// it — a vendor, a GL account, a category — is data, not a literal. Escape
// it, or a memo field containing markup renders as markup in the viewer.
export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The one shared `<div class="ink-chart__tip-head">` line every tooltip
// mode opens with, so the escaping lives in one place.
const tipHead = (label) => `<div class="ink-chart__tip-head">${escapeHtml(label)}</div>`;

// `color` falsy or "transparent" means this row keys nothing (a plain note,
// a total) — drop the swatch entirely rather than reserving its width, or
// the text indents to align with an invisible chip.
const tipRow = (color, name, value) =>
  `<div class="ink-chart__tip-row">` +
    (color && color !== "transparent" ? `<span class="ink-chart__tip-sw" style="background:${color}"></span>` : "") +
    `<span class="ink-chart__tip-name">${escapeHtml(name)}</span>` +
    (value != null ? `<span class="ink-chart__tip-val">${escapeHtml(value)}</span>` : "") +
  `</div>`;

function legendHtml(series, extras = []) {
  return [
    ...series.map((s) =>
      `<li><span class="ink-chart__legend-sw" style="background:${s.color}"></span>${escapeHtml(s.name)}</li>`),
    // A reference is a line, not an area, so its key is a dashed rule —
    // naming it here is what lets it drop its own in-plot label.
    ...extras.map((e) =>
      `<li><span class="ink-chart__legend-sw ink-chart__legend-sw--rule"></span>${escapeHtml(e.name)}</li>`),
  ].join("");
}

// Runs `draw` after every render and again on a real width change, without
// the resize observer closing over a stale render's props/state.
function useChartDraw(plotRef, draw) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => { drawRef.current(); });
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === lastWidth) return; // our own render changed the height
      lastWidth = w;
      requestAnimationFrame(() => drawRef.current());
    });
    ro.observe(el);
    return () => ro.disconnect();
    // plotRef is a stable ref object; drawRef.current always holds the latest draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// A headline value+delta where the chart has one, else a plain title — per
// charts.md's rule, never both: the headline's label already IS the title.
function ChartHeadline({ headline, title }) {
  if (!headline) return title ? <p className="ink-chart__title">{title}</p> : null;
  const { label, value, delta, deltaLabel } = headline;
  const sign = delta == null ? null : delta >= 0 ? "positive" : "negative";
  return (
    <div className="ink-chart__headline">
      <p className="ink-chart__title">{label}</p>
      <div className="ink-chart__headline-row">
        <span className="ink-chart__headline-value">{value}</span>
        {sign && (
          <span className={`ink-chart__headline-delta ink-num--${sign}`}>
            {delta >= 0 ? "▲" : "▼"} {deltaLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/** Single- or multi-series line chart. Per-series `dashed: true` draws that
 *  whole line dashed (a pace reference); `provisionalFrom` dashes only the
 *  tail of the other series (an in-progress period). */
export function InkLineChart({
  id, height = 240, series, labels, xTick, reference, headline, title, sub,
  directLabels = false, legend = false, legendExtras = [],
  formatValue = String, ariaLabel = "", provisionalFrom,
  valueTicks = 4, padding,
}) {
  const rootRef = useRef(null);
  const plotRef = useRef(null);
  const tipRef = useRef(null);

  const draw = () => {
    const plot = plotRef.current, tip = tipRef.current, root = rootRef.current;
    if (!plot || !tip || !root) return;
    const W = plot.clientWidth;
    if (!W) return;
    root.classList.remove("is-hovering");
    plot.querySelector("svg")?.remove();

    const pad = padding || { top: 16, right: directLabels ? 108 : 16, bottom: 28, left: 64 };
    const H = height;
    const iw = W - pad.left - pad.right, ih = H - pad.top - pad.bottom;
    const svg = svgEl("svg", { width: W, height: H, role: "img", "aria-label": ariaLabel });
    const n = labels.length;
    // The reference belongs in the domain, or a baseline above the data gets
    // clipped by the container.
    const maxV = niceMax(Math.max(...series.flatMap((s) => s.values), reference?.value ?? 0));
    const X = (i) => pad.left + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const Y = (v) => pad.top + ih - (v / maxV) * ih;
    const baselineY = pad.top + ih;

    // Gradient area is a single-series device — stacked translucent fills
    // composite into a muddy wash. A dashed (pace) line skips it too: an
    // area under a reference line reads as real spend, not a guide.
    const withArea = series.length === 1 && !series[0].dashed;
    if (withArea) {
      const defs = svgEl("defs");
      series.forEach((s, si) => {
        const g = svgEl("linearGradient", { id: `${id}-g${si}`, x1: "0", y1: "0", x2: "0", y2: "1" });
        g.append(
          svgEl("stop", { offset: "0%", "stop-opacity": "0.28" }, `stop-color:${s.color}`),
          svgEl("stop", { offset: "100%", "stop-opacity": "0" }, `stop-color:${s.color}`)
        );
        defs.append(g);
      });
      svg.append(defs);
    }

    const yTickVals = Array.from({ length: valueTicks + 1 }, (_, t) => (maxV * t) / valueTicks);
    const yTickPos = yTickVals.map(Y);
    paintDots(svg, labels.map((_, i) => X(i)), yTickPos, "y", baselineY);

    yTickVals.forEach((v) => {
      const el = svgEl("text", { x: pad.left - 12, y: Y(v) + 4, "text-anchor": "end", class: "ink-chart__axis" });
      el.textContent = formatValue(v, 1);
      svg.append(el);
    });

    // A time series is continuous: baseline + a tick per band. Ticks locate a
    // point along a continuum, and only earn their keep with a baseline to
    // hang from.
    svg.append(svgEl("line", { x1: pad.left, x2: pad.left + iw, y1: baselineY, y2: baselineY, class: "ink-chart__axis-line" }));
    labels.forEach((lab, i) => {
      const text = xTick ? xTick(lab, i) : lab;
      const x = X(i);
      svg.append(svgEl("line", { x1: x, x2: x, y1: baselineY, y2: baselineY + (text ? 6 : 3), class: "ink-chart__tick" }));
      if (!text) return;
      const t = svgEl("text", { x, y: H - 8, "text-anchor": "middle", class: "ink-chart__axis" });
      t.textContent = text;
      svg.append(t);
    });

    if (reference) {
      const y = Y(reference.value);
      svg.append(svgEl("line", { x1: pad.left, x2: pad.left + iw, y1: y, y2: y, class: "ink-chart__reference" }));
      if (reference.label) {
        const t = svgEl("text", { x: pad.left + iw + 8, y: y + 4, "text-anchor": "start", class: "ink-chart__reference-label" });
        t.textContent = reference.label;
        svg.append(t);
      }
    }

    const cross = svg.appendChild(svgEl("line", { y1: pad.top, y2: pad.top + ih, class: "ink-chart__cross" }));

    series.forEach((s, si) => {
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
      if (withArea) {
        svg.append(svgEl("path",
          { d: `${d} L${X(n - 1).toFixed(1)},${baselineY.toFixed(1)} L${X(0).toFixed(1)},${baselineY.toFixed(1)} Z` },
          `fill:url(#${id}-g${si})`));
      }
      if (s.dashed) {
        svg.append(svgEl("path",
          { d, "stroke-linecap": "round", "stroke-linejoin": "round", class: "ink-chart__provisional" },
          `fill:none;stroke:${s.color};stroke-width:${s.width ?? 1.5}`));
        return;
      }
      // Closed periods solid; the in-progress tail dashed, starting one point
      // early so the two segments join rather than leaving a visual gap.
      const prov = provisionalFrom ?? n;
      const seg = (from, to, cls) => {
        const pts = s.values.slice(from, to).map((v, k) =>
          `${k ? "L" : "M"}${X(from + k).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
        svg.append(svgEl("path",
          { d: pts, "stroke-linecap": "round", "stroke-linejoin": "round", class: cls },
          `fill:none;stroke:${s.color};stroke-width:2`));
      };
      if (prov >= n) seg(0, n, "");
      else { seg(0, prov, ""); seg(Math.max(0, prov - 1), n, "ink-chart__provisional"); }
    });

    const marks = series.map((s) =>
      svg.appendChild(svgEl("rect", { width: 8, height: 8, class: "ink-chart__mark" }, `fill:${s.color}`)));

    if (directLabels) {
      const ends = series.map((s) => ({ name: s.name, color: s.color, y: Y(s.values[n - 1]) }));
      const MIN_GAP = 16; // geometry, not a spacing step: one label's own height
      ends.sort((a, b) => a.y - b.y).forEach((e, i, arr) => {
        if (i && e.y - arr[i - 1].y < MIN_GAP) e.y = arr[i - 1].y + MIN_GAP;
      });
      ends.forEach((e) => {
        const t = svgEl("text", { x: X(n - 1) + 8, y: e.y + 4, class: "ink-chart__series-label" }, `fill:${e.color}`);
        t.textContent = e.name;
        svg.append(t);
      });
    }

    plot.append(svg);

    function showAt(i, mouseY = null) {
      root.classList.add("is-hovering");
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      series.forEach((s, si) => {
        marks[si].setAttribute("x", X(i) - 4);
        marks[si].setAttribute("y", Y(s.values[i]) - 4);
      });
      const prov = provisionalFrom ?? n;
      const provNote = i >= prov ? " · in progress" : "";
      // One series needs no header row — the label and the value are the
      // whole story.
      const compact = series.length === 1;
      tip.classList.toggle("ink-chart__tip--compact", compact);
      const one = series[0];
      tip.innerHTML = compact
        ? `<div class="ink-chart__tip-compact">` +
            `<span class="ink-chart__tip-sw" style="background:${one.color}"></span>` +
            `<span class="ink-chart__tip-name">${escapeHtml(labels[i] + provNote)}</span>` +
            `<span class="ink-chart__tip-val">${formatValue(one.values[i])}</span></div>`
        : tipHead(labels[i] + provNote) +
          series.map((s) => tipRow(s.color, s.name, formatValue(s.values[i]))).join("");
      // Tracks the cursor's Y, matching InkBarChart's hover placement.
      const tipH = tip.offsetHeight;
      const tipY = mouseY != null ? Math.max(tipH + 10, mouseY) : Math.min(...series.map((s) => Y(s.values[i])));
      placeTip(tip, X(i), tipY, W);
    }

    svg.addEventListener("pointermove", (e) => {
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const band = n === 1 ? iw : iw / (n - 1);
      showAt(Math.max(0, Math.min(n - 1, Math.round((px - pad.left) / band))), py);
    });
    svg.addEventListener("pointerleave", () => root.classList.remove("is-hovering"));
  };

  useChartDraw(plotRef, draw);

  return (
    <div className="ink-chart" ref={rootRef}>
      <ChartHeadline headline={headline} title={title} />
      {sub && <p className="ink-chart__sub">{sub}</p>}
      <div className="ink-chart__plot" ref={plotRef} style={{ height }}>
        <div className="ink-chart__tip" ref={tipRef} aria-hidden="true" />
      </div>
      {legend && (
        <ul className="ink-chart__legend" dangerouslySetInnerHTML={{ __html: legendHtml(series, legendExtras) }} />
      )}
    </div>
  );
}

/** Bar chart: `layout` picks single/grouped/stacked, `orientation` picks
 *  vertical/horizontal, `domain="signed"` (vertical+stacked only) diverges
 *  from a shared zero baseline. `renderTooltip(i, helpers)` overrides the
 *  built-in compact/full/total+breakdown tooltip when none of those fit. */
export function InkBarChart({
  id, height = 240, orientation = "vertical", layout = "single", domain = "zero",
  series, labels, xTick, reference, headline, title, sub, headerControl,
  legend = false, legendExtras = [], formatValue = String, ariaLabel = "",
  provisionalFrom, projectedFrom, valueTicks = 4, padding, onSelect, colorFor,
  renderTooltip, stackedTooltip = "breakdown", lineOverlay,
}) {
  const rootRef = useRef(null);
  const plotRef = useRef(null);
  const tipRef = useRef(null);
  const vertical = orientation !== "horizontal";
  const clickable = typeof onSelect === "function";

  const draw = () => {
    const plot = plotRef.current, tip = tipRef.current, root = rootRef.current;
    if (!plot || !tip || !root) return;
    const W = plot.clientWidth;
    if (!W) return;
    root.classList.remove("is-hovering");
    plot.querySelector("svg")?.remove();

    const pad = padding || (vertical
      ? { top: 16, right: 16, bottom: 28, left: 64 }
      : { top: 8, right: 16, bottom: 28, left: 140 });
    const H = height;
    const iw = W - pad.left - pad.right, ih = H - pad.top - pad.bottom;
    const svg = svgEl("svg", { width: W, height: H, role: "img", "aria-label": ariaLabel });
    const n = labels.length;
    const catLen = vertical ? iw : ih;
    const band = catLen / n;
    const RADIUS = radiusSubtle();
    const barPath = vertical ? barPathV : barPathH;

    // Live in the DOM before content is built: truncation below needs
    // getComputedTextLength(), which needs the page's own font-size resolved.
    plot.append(svg);

    if (domain === "signed") {
      drawSignedStacked({ svg, pad, iw, ih, band, n, vertical, RADIUS, barPath });
    } else {
      drawZero({ svg, pad, iw, ih, band, n, vertical, RADIUS, barPath });
    }

    // ── zero-anchored: single / grouped / stacked ──────────────────────
    function drawZero({ svg, pad, iw, ih, band, n, vertical, RADIUS, barPath }) {
      const totals = layout === "stacked"
        ? labels.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.values[i] || 0), 0))
        : null;
      const flatVals = totals || series.flatMap((s) => s.values);
      const maxV = niceMax(Math.max(...flatVals, reference?.value ?? 0));
      const baseline = vertical ? pad.top + ih : pad.left;
      const valLen = vertical ? ih : iw;
      const valPos = (v) => vertical ? baseline - (v / maxV) * valLen : baseline + (v / maxV) * valLen;

      const catBase = (i) => (vertical ? pad.left : pad.top) + band * i;
      const catMid = (i) => catBase(i) + band / 2;
      const groupW = band * 0.8;
      const subW = layout === "grouped" ? (groupW / series.length) * 0.85 : band * 0.62;
      const catStart = (i, si = 0) => layout === "grouped"
        ? catBase(i) + (band - groupW) / 2 + si * (groupW / series.length) + (groupW / series.length - subW) / 2
        : catBase(i) + (band - subW) / 2;

      const valTickVals = Array.from({ length: valueTicks + 1 }, (_, t) => (maxV * t) / valueTicks);
      const valTickPos = valTickVals.map(valPos);
      // Grouped bars: one dot column per sub-bar, matching single/stacked.
      const realCatPositions = layout === "grouped"
        ? labels.flatMap((_, i) => series.map((_, si) => catStart(i, si) + subW / 2))
        : labels.map((_, i) => catMid(i));
      const catPositions = gridWithPoints(
        vertical ? pad.left : pad.top,
        vertical ? pad.left + iw : pad.top + ih,
        realCatPositions,
        DOT_GAP,
      );
      if (vertical) {
        paintDots(svg, catPositions, valTickPos, "y", baseline);
      } else {
        paintDots(svg, valTickPos, catPositions, "x", baseline);
      }

      // Value axis: continuous, baseline + a tick per band.
      if (vertical) {
        svg.append(svgEl("line", { x1: pad.left, x2: pad.left + iw, y1: baseline, y2: baseline, class: "ink-chart__axis-line" }));
        valTickVals.forEach((v) => {
          const el = svgEl("text", { x: pad.left - 12, y: valPos(v) + 4, "text-anchor": "end", class: "ink-chart__axis" });
          el.textContent = formatValue(v, 1);
          svg.append(el);
        });
      } else {
        svg.append(svgEl("line", { x1: pad.left, x2: pad.left, y1: pad.top, y2: pad.top + ih, class: "ink-chart__axis-line" }));
        valTickVals.forEach((v) => {
          const x = valPos(v);
          svg.append(svgEl("line", { x1: x, x2: x, y1: pad.top + ih, y2: pad.top + ih + 6, class: "ink-chart__tick" }));
          const t = svgEl("text", { x, y: H - 8, "text-anchor": "middle", class: "ink-chart__axis" });
          t.textContent = formatValue(v, 1);
          svg.append(t);
        });
      }

      // Category axis: labels only, never ticks — a bar already occupies its position.
      labels.forEach((lab, i) => {
        const text = xTick ? xTick(lab, i) : lab;
        if (!text) return;
        const t = vertical
          ? svgEl("text", { x: catMid(i), y: H - 8, "text-anchor": "middle", class: "ink-chart__axis" })
          : svgEl("text", { x: pad.left - 12, y: catMid(i) + 4, "text-anchor": "end", class: "ink-chart__axis" });
        t.textContent = text;
        svg.append(t);
        // Clip a long vendor/account name to its budgeted gutter width.
        if (!vertical) truncateText(t, pad.left - 20);
      });

      if (reference) {
        const v = valPos(reference.value);
        const line = vertical
          ? svgEl("line", { x1: pad.left, x2: pad.left + iw, y1: v, y2: v, class: "ink-chart__reference" })
          : svgEl("line", { x1: v, x2: v, y1: pad.top, y2: pad.top + ih, class: "ink-chart__reference" });
        svg.append(line);
        if (reference.label) {
          const t = vertical
            ? svgEl("text", { x: pad.left + iw + 8, y: v + 4, "text-anchor": "start", class: "ink-chart__reference-label" })
            : svgEl("text", { x: v + 4, y: pad.top - 6, "text-anchor": "start", class: "ink-chart__reference-label" });
          t.textContent = reference.label;
          svg.append(t);
        }
      }

      // Guard on a real threshold — an unset budget of 0 would flag every category.
      const isOver = (v) => (reference?.value ?? 0) > 0 && v > reference.value;
      const marks = [];   // flat list of {el, i, si} for hover/click hit-testing
      const cols = [];    // per-category group, for stacked hover-dim

      if (layout === "stacked") {
        labels.forEach((_, i) => {
          const g = svgEl("g", { class: "ink-chart__col" });
          const projected  = projectedFrom != null && i >= projectedFrom;
          const provisional = !projected && provisionalFrom != null && i >= provisionalFrom;
          const topIdx = series.reduce((last, s, si) => ((s.values[i] || 0) > 0 ? si : last), -1);
          let acc = 0;
          series.forEach((s, si) => {
            const v = Math.max(0, s.values[i] || 0);
            if (v <= 0) return;
            const a = valPos(acc), b = valPos(acc + v);
            acc += v;
            const top = Math.min(a, b), len = Math.max(0.6, Math.abs(b - a));
            const rect = vertical
              ? { x: catStart(i), y: top, w: subW, h: len }
              : { x: top, y: catStart(i), w: len, h: subW };
            const paint = projected    ? hatchPaint(svg, `${id}-p${si}`, s.color)
                       : provisional ? hatchPaint(svg, `${id}-h${si}`, s.color)
                       : s.color;
            const style = `fill:${paint}`;
            const el = svgEl(si === topIdx ? "path" : "rect",
              si === topIdx
                ? { d: barPath(rect.x, rect.y, rect.w, rect.h, RADIUS) }
                : { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
              style);
            g.append(el);
            marks.push({ el, i, si });
          });
          if (totals[i] > 0) g.append(valueLabel(vertical
            ? { x: catMid(i), y: valPos(totals[i]) - 6, "text-anchor": "middle" }
            : { x: valPos(totals[i]) + 6, y: catMid(i) + 4, "text-anchor": "start" },
            formatValue(totals[i])));
          svg.append(g);
          cols.push(g);
        });
      } else {
        labels.forEach((_, i) => {
          series.forEach((s, si) => {
            const v = s.values[i] || 0;
            const provisional = i >= (provisionalFrom ?? n);
            const fill = s.colorFor ? s.colorFor(v, i) : colorFor ? colorFor(v, i, si)
              : (isOver(v) && series.length === 1 ? "var(--local-mark-negative)" : s.color);
            const style = provisional ? `fill:${hatchPaint(svg, `${id}-h${si}`, fill)}` : `fill:${fill}`;
            const a = valPos(0), b = valPos(v);
            const top = Math.min(a, b), len = Math.max(0.6, Math.abs(b - a));
            const rect = vertical
              ? { x: catStart(i, si), y: top, w: subW, h: len }
              : { x: baseline, y: catStart(i, si), w: len, h: subW };
            const el = svg.appendChild(svgEl("path",
              { d: barPath(rect.x, rect.y, rect.w, rect.h, RADIUS), class: `ink-chart__bar${isOver(v) ? " is-over" : ""}` },
              style));
            marks.push({ el, i, si });
            cols[i] = cols[i] || [];
            cols[i].push(el);
            if (v !== 0) svg.append(valueLabel(vertical
              ? { x: rect.x + rect.w / 2, y: v >= 0 ? rect.y - 6 : rect.y + rect.h + 14, "text-anchor": "middle" }
              : { x: v >= 0 ? rect.x + rect.w + 6 : rect.x - 6, y: rect.y + rect.h / 2 + 4,
                  "text-anchor": v >= 0 ? "start" : "end" },
              formatValue(v)));
          });
        });
      }

      function dimSiblings(activeI) {
        if (layout === "stacked") cols.forEach((c, ci) => c.classList.toggle("is-dim", ci !== activeI));
        else marks.forEach((m) => m.el.classList.toggle("is-dim", m.i !== activeI));
      }
      function clearDim() {
        marks.forEach((m) => m.el.classList.remove("is-dim"));
        cols.forEach((c) => c?.classList?.remove?.("is-dim"));
      }
      // Darkens the exact segment under the cursor, so a stacked column's
      // individually-clickable pieces don't all read as one bar.
      function setActiveSegment(target) {
        marks.forEach((m) => m.el.classList.toggle("is-active-seg", m.el === target));
      }
      function clearActiveSegment() {
        marks.forEach((m) => m.el.classList.remove("is-active-seg"));
      }

      function showAt(i, mouseY = null) {
        root.classList.add("is-hovering");
        dimSiblings(i);
        const anchorCat = catMid(i);
        let anchorVal;
        let html;
        if (renderTooltip) {
          html = renderTooltip(i, { series, labels, totals, formatValue, isOver });
          anchorVal = valPos(totals ? totals[i] : Math.max(...series.map((s) => s.values[i] || 0)));
        } else if (layout === "stacked") {
          const segs = series
            .map((s) => ({ name: s.name, color: s.color, v: Math.max(0, s.values[i] || 0) }))
            .filter((s) => s.v > 0)
            .sort((a, b) => b.v - a.v); // largest first — reads like a ranking
          anchorVal = valPos(totals[i]);
          const provNote = projectedFrom != null && i >= projectedFrom ? " · projected"
                        : i >= (provisionalFrom ?? n) ? " · in progress" : "";
          if (stackedTooltip === "total") {
            html = tipHead(labels[i] + provNote) +
              tipRow("transparent", "Total", formatValue(totals[i]));
          } else {
            html = tipHead(labels[i] + provNote) +
              `<div class="ink-chart__tip-total"><span class="ink-chart__tip-name">Total</span>` +
              `<span class="ink-chart__tip-val">${formatValue(totals[i])}</span></div>` +
              segs.map((s) => tipRow(s.color, s.name, formatValue(s.v))).join("");
          }
        } else if (series.length === 1) {
          const v = series[0].values[i] || 0;
          anchorVal = valPos(v);
          const sw = series[0].colorFor ? series[0].colorFor(v, i) : colorFor ? colorFor(v, i, 0) : series[0].color;
          tip.classList.toggle("ink-chart__tip--compact", !reference);
          html = !reference
            ? `<div class="ink-chart__tip-compact"><span class="ink-chart__tip-sw" style="background:${sw}"></span>` +
              `<span class="ink-chart__tip-name">${escapeHtml(labels[i])}</span>` +
              `<span class="ink-chart__tip-val">${formatValue(v)}</span></div>`
            : tipHead(labels[i]) +
              tipRow(sw, series[0].name, formatValue(v)) +
              tipRow("transparent", reference.label, formatValue(reference.value)) +
              tipRow("transparent", isOver(v) ? "Over budget" : "Within budget", null);
        } else {
          anchorVal = valPos(Math.max(...series.map((s) => s.values[i] || 0)));
          html = tipHead(labels[i]) +
            series.map((s, si) => tipRow(
              s.colorFor ? s.colorFor(s.values[i], i) : colorFor ? colorFor(s.values[i], i, si) : s.color,
              s.name, formatValue(s.values[i]))).join("");
        }
        if (layout !== "stacked" && series.length !== 1) tip.classList.remove("ink-chart__tip--compact");
        tip.innerHTML = html;
        const tipH = tip.offsetHeight;
        // A multi-bar tooltip, and a lone bar per category, sit beside the
        // bar(s) and track the cursor's Y, so hovering never covers them.
        if (mouseY != null && vertical && (layout === "stacked" || layout === "grouped" || series.length === 1)) {
          const barL = catStart(i);
          const barR = layout === "grouped" ? catStart(i, series.length - 1) + subW : barL + subW;
          placeTipBeside(tip, { barL, barR, plotL: pad.left, plotR: pad.left + iw, mouseY, W, H });
        } else {
          tip.style.transform = "";
          const tipY = mouseY != null && vertical ? Math.max(tipH + 10, mouseY) : (vertical ? anchorVal : anchorCat);
          const tipX = vertical ? anchorCat : anchorVal;
          placeTip(tip, tipX, tipY, W);
        }
      }

      const hitTest = (px, py) => {
        const alongCat = vertical ? px - pad.left : py - pad.top;
        return Math.max(0, Math.min(n - 1, Math.floor(alongCat / band)));
      };
      // A plain single-series trend chart has nothing to say about a
      // category with no data — skip the hover instead of showing "$0".
      const skipEmpty = !renderTooltip && !reference && series.length === 1 && layout !== "stacked";
      const segmentHover = clickable && layout === "stacked";
      svg.addEventListener("pointermove", (e) => {
        const rect = svg.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const i = hitTest(px, py);
        if (skipEmpty && !series[0].values[i]) {
          root.classList.remove("is-hovering");
          clearDim();
          if (segmentHover) clearActiveSegment();
          return;
        }
        showAt(i, py);
        if (segmentHover) setActiveSegment(e.target);
      });
      svg.addEventListener("pointerleave", () => {
        root.classList.remove("is-hovering");
        clearDim();
        if (segmentHover) clearActiveSegment();
      });
      if (clickable) {
        svg.addEventListener("click", (e) => {
          const rect = svg.getBoundingClientRect();
          const px = e.clientX - rect.left, py = e.clientY - rect.top;
          const i = hitTest(px, py);
          const hit = marks.find((m) => m.i === i && m.el.contains(e.target)) || marks.find((m) => m.i === i);
          onSelect(hit ? hit.si : 0, i);
        });
      }
    }

    // ── signed, stacked (Cashflow's income-up / expenses-down + net line) ──
    function drawSignedStacked({ svg, pad, iw, ih }) {
      const posTotals = labels.map((_, i) => series.reduce((s, ser) => s + Math.max(0, ser.values[i] || 0), 0));
      const negTotals = labels.map((_, i) => series.reduce((s, ser) => s + Math.max(0, -(ser.values[i] || 0)), 0));
      // Split by sign, or one deep-negative month inflates BOTH domain sides.
      const overlayPos = (lineOverlay || []).flatMap((s) => s.values.filter((v) => v > 0));
      const overlayNeg = (lineOverlay || []).flatMap((s) => s.values.filter((v) => v < 0).map((v) => -v));
      const rawMaxPos = Math.max(...posTotals, ...overlayPos, 0);
      const rawMaxNeg = Math.max(...negTotals, ...overlayNeg, 0);
      // One shared tick step for both sides, so a smaller negative range
      // gets fewer ticks at the same pixel spacing, not the same tick count.
      const step = niceMax(Math.max(rawMaxPos, rawMaxNeg, 1) / valueTicks);
      const maxPos = Math.ceil(rawMaxPos / step) * step || step;
      const maxNeg = rawMaxNeg > 0 ? Math.ceil(rawMaxNeg / step) * step : 0;
      const span = maxPos + maxNeg || 1;
      const baselineY = pad.top + ih * (maxPos / span);
      const Y = (v) => v >= 0
        ? baselineY - (v / (maxPos || 1)) * (baselineY - pad.top)
        : baselineY + (-v / (maxNeg || 1)) * (pad.top + ih - baselineY);
      const band = iw / labels.length;
      const barW = band * 0.62;
      const X = (i) => pad.left + band * i + (band - barW) / 2;
      const RADIUS = radiusSubtle();

      const valTickVals = [];
      for (let v = 0; v <= maxPos + step / 2; v += step) valTickVals.push(v);
      for (let v = step; v <= maxNeg + step / 2; v += step) valTickVals.push(-v);
      const barCenters = labels.map((_, i) => X(i) + barW / 2);
      paintDots(svg, gridWithPoints(pad.left, pad.left + iw, barCenters, DOT_GAP), valTickVals.map(Y), "y", baselineY);
      svg.append(svgEl("line", { x1: pad.left, x2: pad.left + iw, y1: baselineY, y2: baselineY, class: "ink-chart__axis-line" }));
      [...new Set(valTickVals)].forEach((v) => {
        const el = svgEl("text", { x: pad.left - 12, y: Y(v) + 4, "text-anchor": "end", class: "ink-chart__axis" });
        el.textContent = formatValue(v, 1);
        svg.append(el);
      });
      labels.forEach((lab, i) => {
        const text = xTick ? xTick(lab, i) : lab;
        if (!text) return;
        const t = svgEl("text", { x: X(i) + barW / 2, y: H - 8, "text-anchor": "middle", class: "ink-chart__axis" });
        t.textContent = text;
        svg.append(t);
      });

      const marks = [];
      labels.forEach((_, i) => {
        let accPos = 0, accNeg = 0;
        const provisional = i >= (provisionalFrom ?? labels.length);
        series.forEach((s, si) => {
          const v = s.values[i] || 0;
          if (!v) return;
          const from = v > 0 ? accPos : accNeg;
          const to = from + v;
          if (v > 0) accPos = to; else accNeg = to;
          const a = Y(from), b = Y(to);
          const top = Math.min(a, b), len = Math.max(0.6, Math.abs(b - a));
          const paint = provisional ? hatchPaint(svg, `${id}-h${si}`, s.color) : s.color;
          // Round the end away from the baseline, up or down by sign.
          const path = v > 0
            ? barPathV(X(i), top, barW, len, RADIUS)
            : barPathVBottom(X(i), top, barW, len, RADIUS);
          const el = svg.appendChild(svgEl("path", { d: path, class: "ink-chart__bar" }, `fill:${paint}`));
          marks.push({ el, i, si });
        });
        if (posTotals[i] > 0) svg.append(valueLabel(
          { x: X(i) + barW / 2, y: Y(posTotals[i]) - 6, "text-anchor": "middle" }, formatValue(posTotals[i])));
        if (negTotals[i] > 0) svg.append(valueLabel(
          { x: X(i) + barW / 2, y: Y(-negTotals[i]) + 14, "text-anchor": "middle" }, formatValue(-negTotals[i])));
      });

      if (lineOverlay?.length) {
        const prov = provisionalFrom ?? labels.length;
        lineOverlay.forEach((s) => {
          // Closed periods solid; the in-progress tail dashed, starting one
          // point early so the two segments join rather than leaving a gap.
          const seg = (from, to, cls) => {
            const pts = s.values.slice(from, to).map((v, k) =>
              `${k ? "L" : "M"}${(X(from + k) + barW / 2).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
            svg.append(svgEl("path",
              { d: pts, "stroke-linecap": "round", "stroke-linejoin": "round", class: cls },
              `fill:none;stroke:${s.color};stroke-width:2`));
          };
          if (prov >= labels.length) seg(0, labels.length, "");
          else { seg(0, prov, ""); seg(Math.max(0, prov - 1), labels.length, "ink-chart__provisional"); }
          s.values.forEach((v, i) => {
            svg.append(svgEl("rect", {
              x: (X(i) + barW / 2 - 3).toFixed(1), y: (Y(v) - 3).toFixed(1), width: 6, height: 6,
            }, `fill:${s.color}`));
            // A near-zero net value can land on the same-sign bar total's
            // own label; push clear instead of stacking both labels.
            const barLabelY = v >= 0 && posTotals[i] > 0 ? Y(posTotals[i]) - 6
                            : v < 0 && negTotals[i] > 0 ? Y(-negTotals[i]) + 14
                            : null;
            const defaultY = Y(v) + 4;
            const MIN_GAP = 14;
            const labelY = barLabelY != null && Math.abs(defaultY - barLabelY) < MIN_GAP
              ? (v >= 0 ? barLabelY - MIN_GAP : barLabelY + MIN_GAP)
              : defaultY;
            svg.append(valueLabel(
              { x: X(i) + barW / 2 + 8, y: labelY, "text-anchor": "start" }, formatValue(v)));
          });
        });
      }

      function showAt(i, mouseY = null) {
        root.classList.add("is-hovering");
        marks.forEach((m) => m.el.classList.toggle("is-dim", m.i !== i));
        const html = renderTooltip
          ? renderTooltip(i, { series, labels, lineOverlay, formatValue })
          : tipHead(labels[i]) +
            series.map((s) => tipRow(s.color, s.name, formatValue(s.values[i] || 0))).join("") +
            (lineOverlay || []).map((s) => tipRow(s.color, s.name, formatValue(s.values[i] || 0))).join("");
        tip.innerHTML = html;
        // Income sits above the axis and expenses below, so a bar can occupy
        // the full plot height — beside the column is the only clear spot.
        if (mouseY != null) {
          placeTipBeside(tip, {
            barL: X(i), barR: X(i) + barW, plotL: pad.left, plotR: pad.left + iw, mouseY, W, H,
          });
        } else {
          tip.style.transform = "";
          placeTip(tip, X(i) + barW / 2, baselineY, W);
        }
      }
      svg.addEventListener("pointermove", (e) => {
        const rect = svg.getBoundingClientRect();
        showAt(
          Math.max(0, Math.min(labels.length - 1, Math.floor((e.clientX - rect.left - pad.left) / band))),
          e.clientY - rect.top,
        );
        if (clickable) marks.forEach((m) => m.el.classList.toggle("is-active-seg", m.el === e.target));
      });
      svg.addEventListener("pointerleave", () => {
        root.classList.remove("is-hovering");
        marks.forEach((m) => m.el.classList.remove("is-dim", "is-active-seg"));
      });
      if (clickable) {
        svg.addEventListener("click", (e) => {
          const px = e.clientX - svg.getBoundingClientRect().left;
          const i = Math.max(0, Math.min(labels.length - 1, Math.floor((px - pad.left) / band)));
          const hit = marks.find((m) => m.i === i && m.el.contains(e.target)) || marks.find((m) => m.i === i);
          onSelect(hit ? hit.si : 0, i);
        });
      }
    }
  };

  useChartDraw(plotRef, draw);

  return (
    <div className={`ink-chart${clickable ? " ink-chart--clickable" : ""}`} ref={rootRef}>
      {headerControl ? (
        <div className="ink-chart__header-row">
          <div className="ink-chart__header-text">
            <ChartHeadline headline={headline} title={title} />
            {sub && <p className="ink-chart__sub">{sub}</p>}
          </div>
          <div className="ink-chart__header-control">{headerControl}</div>
        </div>
      ) : (
        <>
          <ChartHeadline headline={headline} title={title} />
          {sub && <p className="ink-chart__sub">{sub}</p>}
        </>
      )}
      <div className="ink-chart__plot" ref={plotRef} style={{ height }}>
        <div className="ink-chart__tip" ref={tipRef} aria-hidden="true" />
      </div>
      {legend && (
        <ul className="ink-chart__legend" dangerouslySetInnerHTML={{ __html: legendHtml(series, legendExtras) }} />
      )}
    </div>
  );
}

export const Btn = ({ children, onClick, kind = "ghost", small, size, className, style, disabled, ...rest }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={[kind === "primary" ? "btn-primary" : "btn-ghost",
                size === "toolbar" ? "btn-toolbar" : null,
                className].filter(Boolean).join(" ")}
    {...rest}
    style={{
      // `small` is Ink's real `.ink-btn--small` (32px, 0 7px, 12px);
      // `toolbar` is the filter-row chrome every control in that row shares.
      ...sans, fontWeight: 500,
      ...(size === "toolbar"
        ? TOOLBAR_CONTROL_STYLE
        : { fontSize: small ? FS.body : FS.bodyLg,
            height: small ? 32 : 40,
            padding: small ? "0 7px" : "8px 16px" }),
      borderRadius: 4, cursor: disabled ? "default" : "pointer",
      border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
      background: kind === "primary" ? GRAD_DARK : CARD,
      boxShadow: "none",
      color: kind === "primary" ? "var(--grad-dark-text)" : kind === "danger" ? "var(--red)" : INK,
      opacity: disabled ? 0.45 : 1,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </button>
);
