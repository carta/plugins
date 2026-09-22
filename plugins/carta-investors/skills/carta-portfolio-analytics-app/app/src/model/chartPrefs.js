// Per-chart display preferences — the "make this chart look how I want" layer.
// Mirrors the shape of cellFormat.js / doc.cellFormats: a keyed map at the doc
// root, a pure resolver, and defaults-when-absent so an unconfigured chart costs
// nothing and renders exactly as it always has.
//
// Stored as:
//   doc.chartPrefs = { global: {…partial}, byChart: { [chartId]: {…partial} } }
// Resolution order (later wins):
//   DEFAULTS  →  the view's own prop defaults  →  global  →  this chart
//
// COLORS MUST BE HEX (or a var(--…) token). exportChart() serializes the SVG and
// only resolves var() references, so anything else would render fine in-app but
// break the PNG/SVG download.

// Series palettes. `default` is the app's existing data-viz palette (charts.jsx
// PALETTE) — keeping it first means nothing changes until a user picks another.
export const PALETTES = {
  default: { label: "Carta", colors: ["#285DA3", "#2D9E90", "#DDB31F", "#58B8BC", "#94B524", "#B29990", "#656B6B", "#E52431", "#1A1A1A", "#CECFCF"] },
  vivid:   { label: "Vivid", colors: ["#2563EB", "#DC2626", "#16A34A", "#EA580C", "#7C3AED", "#0891B2", "#CA8A04", "#DB2777"] },
  cool:    { label: "Cool", colors: ["#1E3A8A", "#0E7490", "#0F766E", "#4338CA", "#5B21B6", "#075985", "#155E75", "#1E40AF"] },
  warm:    { label: "Warm", colors: ["#9A3412", "#B91C1C", "#A16207", "#BE185D", "#C2410C", "#92400E", "#831843", "#7C2D12"] },
  mono:    { label: "Monochrome", colors: ["#1A1A1A", "#4A4F4F", "#6B7070", "#8E9393", "#B0B4B4", "#CECFCF"] },
};

/** Nth series color for a palette (wraps). */
export const paletteAt = (name, i) => {
  const p = PALETTES[name] || PALETTES.default;
  return p.colors[i % p.colors.length];
};

// Diverging palettes for the Heatmap (low → mid → high).
export const HEAT_PALETTES = {
  redGreen:  { label: "Red → Green", lo: [229, 36, 49], mid: [242, 244, 245], hi: [45, 158, 144] },
  greenRed:  { label: "Green → Red", lo: [45, 158, 144], mid: [242, 244, 245], hi: [229, 36, 49] },
  blueOrange:{ label: "Blue → Orange", lo: [40, 93, 163], mid: [242, 244, 245], hi: [234, 88, 12] },
  grayscale: { label: "Grayscale", lo: [60, 64, 64], mid: [242, 244, 245], hi: [26, 26, 26] },
};

// Baseline = exactly how charts render today, so this whole feature is additive.
export const DEFAULTS = {
  type: null,          // null = use the view's own `type` prop
  palette: "default",
  colors: {},          // { [seriesIndex]: "#hex" } — per-series overrides
  thickness: 2,        // stroke width (px)
  smooth: false,       // curved (Catmull-Rom) vs straight segments
  markers: true,       // point dots on line/area
  labels: false,       // data labels on points/bars
  legend: true,
  areaOpacity: 0.12,
  gridY: true,         // horizontal gridlines (today's behavior)
  gridX: false,        // vertical gridlines (new)
  ticks: 4,            // y gridline/tick count
  zeroBase: true,      // force 0 into the y-domain (today's behavior)
  yMin: "",            // "" = auto, else a number
  yMax: "",
  xTitle: "",
  yTitle: "",
  // Scatter axis scale. "symlog" keeps every bubble on-canvas when one company
  // has an extreme value, instead of collapsing the rest into a corner.
  scatterScale: "symlog",  // "linear" | "robust" | "symlog"
  scatterSizeCap: true,    // cap bubble-radius reference at the p95 size (only bites when a giant exists)
  // Heatmap-only
  heatPalette: "redGreen",
  heatValues: true,    // show the number inside each cell
};

/** Merge the layers into one flat settings object for a given chart. */
export function resolveChartPrefs(doc, chartId, propDefaults) {
  const cp = (doc && doc.chartPrefs) || {};
  const global = cp.global || {};
  const own = (chartId && cp.byChart && cp.byChart[chartId]) || {};
  const merged = { ...DEFAULTS, ...(propDefaults || {}), ...global, ...own };
  // colors merge by key rather than being replaced wholesale, so a global
  // series-1 color survives a per-chart series-2 override.
  merged.colors = { ...(DEFAULTS.colors), ...(global.colors || {}), ...(own.colors || {}) };
  return merged;
}

/** Numeric y-bound from a pref field ("" / bad input → null = auto). */
export function boundOf(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Does this chart (or the global layer) have any user overrides? */
export function hasOverrides(doc, chartId) {
  const cp = (doc && doc.chartPrefs) || {};
  const own = (chartId && cp.byChart && cp.byChart[chartId]) || {};
  return Object.keys(own).length > 0;
}

/** Smooth path through points via Catmull-Rom → cubic Bézier. `pts` are already
 *  in screen space [{x,y}]. Falls back to straight segments for < 3 points. */
export function smoothPath(pts) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    // tension 1/6 is the standard Catmull-Rom → Bézier conversion
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
