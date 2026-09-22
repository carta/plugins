// Conditional formatting for the Dashboard pivot — Excel-style "color scales" and
// "color-code rules" applied per metric. A format config is stored per metric key:
//   { type: "scale", palette: "gyr" }                     ← gradient across the metric's range
//   { type: "rules", rules: [{ op, value, color }, …] }   ← first matching rule wins
// A `basis` picks what the format applies to: "value" (the figure, default) or
// "growth" (its period-over-period % change — QoQ on the quarter grid, MoM on the
// as-reported grid). A `scope` (color scales only) picks what the gradient
// normalizes over: "portfolio" (min/max across every company's cells, default) or
// "row" (each company's own range, so the colors read as that company's trend).
// cellFormat is basis/scope-agnostic: the caller feeds it the chosen number and
// the matching stats. cellFormat(value, fmt, stats) → { bg, fg } | null.
import { opOf } from "./rules.js";

// 3-stop gradients (low → mid → high). Tints stay light so the cell text reads.
export const SCALES = {
  gyr:  { label: "Red → Green (higher = better)", stops: ["#E5736B", "#F3D779", "#7FC377"] },
  ryg:  { label: "Green → Red (higher = worse)", stops: ["#7FC377", "#F3D779", "#E5736B"] },
  blue: { label: "Sequential blue", stops: ["#EDF3FC", "#9BBDE8", "#285DA3"] },
  gray: { label: "Sequential gray", stops: ["#F2F3F3", "#BFC3C3", "#6B7070"] },
};

// Solid highlight colors for threshold rules (light bg + readable fg).
export const RULE_COLORS = {
  red:   { label: "Red",   bg: "#F7D2CE", fg: "#7A241D" },
  amber: { label: "Amber", bg: "#FBE7B0", fg: "#79560A" },
  green: { label: "Green", bg: "#CFE8C7", fg: "#245A1C" },
  blue:  { label: "Blue",  bg: "#D2E2F7", fg: "#1B3E70" },
  gray:  { label: "Gray",  bg: "#E7E9E9", fg: "#3A3F3F" },
};

const hx = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
function scaleColor(t, stops) {
  const [lo, mid, hi] = stops.map(hx);
  return css(t <= 0.5 ? mix(lo, mid, t * 2) : mix(mid, hi, (t - 0.5) * 2));
}

/** Cell fill for a value under a metric's format, or null.
 *  `stats` = { min, max } across that metric's visible cells (for scales). */
export function cellFormat(value, fmt, stats) {
  if (value == null || !Number.isFinite(value) || !fmt) return null;
  if (fmt.type === "scale") {
    const stops = (SCALES[fmt.palette] || SCALES.gyr).stops;
    const t = !stats || stats.max === stats.min ? 0.5 : Math.max(0, Math.min(1, (value - stats.min) / (stats.max - stats.min)));
    return { bg: scaleColor(t, stops), fg: "#1A1A1A" };
  }
  if (fmt.type === "rules") {
    for (const r of fmt.rules || []) {
      const thr = Number(r.value);
      if (!Number.isFinite(thr)) continue;
      if (opOf(r.op).fn(value, thr)) {
        const c = RULE_COLORS[r.color] || RULE_COLORS.red;
        return { bg: c.bg, fg: c.fg };
      }
    }
  }
  return null;
}

/** True when the format targets the % change rather than the raw figure. */
export const isGrowthBasis = (fmt) => (fmt?.basis || "value") === "growth";

/** True when a color scale normalizes over each company's own row, not the
 *  whole portfolio. Only color scales carry a scope; rules ignore it. */
export const isRowScope = (fmt) => (fmt?.scope || "portfolio") === "row";

/** min/max over one row's period map (each value × `mult`), for the "row" scope.
 *  Returns null when the row has no finite values, which cellFormat treats as a
 *  neutral mid-tone. */
export function statsOf(byPeriod, mult = 1) {
  let min = Infinity, max = -Infinity;
  for (const p in byPeriod) {
    const v = byPeriod[p];
    if (v == null || !Number.isFinite(v)) continue;
    const x = v * mult;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return min === Infinity ? null : { min, max };
}

/** Short human summary of a format config (for the configured-list chips). */
export function formatSummary(fmt) {
  if (!fmt) return "";
  const basis = isGrowthBasis(fmt) ? " · on % change" : "";
  if (fmt.type === "scale") {
    const scope = isRowScope(fmt) ? " · per company" : "";
    return `Color scale · ${(SCALES[fmt.palette] || SCALES.gyr).label}${scope}${basis}`;
  }
  const n = (fmt.rules || []).length;
  return `Color rules · ${n} rule${n === 1 ? "" : "s"}${basis}`;
}
