// Small hand-rolled SVG chart kit for the Portfolio Analytics app.
//
// There is no charting library in this app (the in-browser transpiler only
// handles .jsx, and CSS custom properties don't resolve as SVG `fill=`
// attributes) — so charts are plain <svg> with hand-written scales and an
// inlined hex PALETTE.
//
// <Chart type="line|bar|area" series=[{key,label,points:[{d,v}]}] .../> is the
// single entry point every view draws through.
import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { FS, sans, mono, SPARK_PANEL } from "./theme.js";
import { currencySymbol, withCommas } from "./format.js";
import { useChartPrefs } from "../state/chartPrefs.js";
import { median, quantile } from "../model/kpi.js";
import { paletteAt, boundOf, smoothPath, HEAT_PALETTES } from "../model/chartPrefs.js";
import { Dropdown, useStickyClone, HintIcon, Z } from "./components.jsx";

// Data-viz palette (hex — copied from Ink data-viz tokens).
export const PALETTE = [
  "#285DA3", "#2D9E90", "#DDB31F", "#58B8BC", "#94B524",
  "#B29990", "#656B6B", "#E52431", "#1A1A1A", "#CECFCF",
];
export const colorAt = (i) => PALETTE[i % PALETTE.length];

/** Color for series `i` under a resolved pref set: an explicit per-series
 *  override wins, else the chosen palette. */
export const seriesColor = (prefs, i) =>
  (prefs && prefs.colors && prefs.colors[i]) || paletteAt(prefs && prefs.palette, i);

const AXIS = "var(--ink-color-global-text-subtle)";
const GRID = "var(--ink-color-global-border-subtle)";

// compact number for axis ticks / tooltips, unit-aware. `str` is a qualitative
// KPI's reported text ("Yes", "Sep 01, 2026") and always wins over the number.
// `cur` is the ISO currency code of THIS value (e.g. "GBP") — a Dollar-unit KPI
// renders in its own currency's symbol, not a hardcoded "$". With no `cur`, the
// firm's display currency is used (never assumed USD).
export function fmtVal(v, unit, str, cur) {
  if (str != null && str !== "") return String(str);
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "Percentage" || unit === "Percent") return withCommas((v * 100).toFixed(1)) + "%";
  if (unit === "Ratio") return (v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "×";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  const pre = unit === "Dollar" ? currencySymbol(cur) : "";
  let s;
  if (abs >= 1e9) s = (abs / 1e9).toFixed(abs >= 1e10 ? 1 : 2) + "B";
  else if (abs >= 1e6) s = (abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + "M";
  else if (abs >= 1e3) s = (abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + "K";
  else s = abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return sign + pre + s;
}

/** Non-abbreviated figures for a "Full figures" toggle ($380,000 vs $380K).
 *  Shared so the Dashboard pivot and the Company KPI table can't format the same
 *  number two different ways. `cur` picks the currency symbol exactly as fmtVal. */
export function fmtFull(v, unit, str, cur) {
  if (str != null && str !== "") return String(str);
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "Percentage" || unit === "Percent") return withCommas((v * 100).toFixed(1)) + "%";
  if (unit === "Ratio") return (v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "×";
  const pre = unit === "Dollar" ? currencySymbol(cur) : "";
  return (v < 0 ? "−" : "") + pre + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** The single currency code shared by every plotted point, or undefined when
 *  they disagree (a mixed-currency axis) or none carry one. Used for axis ticks,
 *  which span a whole series and so can't belong to one point. Mixed → undefined
 *  (the axis falls back to the fund's display currency; each point still labels
 *  in its own via its `cur`) rather than silently picking one currency's symbol
 *  for values in another. */
export function seriesCurrency(series) {
  let cur;
  for (const s of series || []) {
    for (const p of (s && s.points) || []) {
      if (p && p.cur) {
        if (cur === undefined) cur = p.cur;
        else if (cur !== p.cur) return undefined;
      }
    }
  }
  return cur;
}

export const shortDate = (d, quarterly = true) => {
  // Quarter view labels a quarter-end "Q4 '24"; monthly view labels it by month,
  // so a month value never shows under a quarter header.
  const m = /^(\d{4})-(\d{2})/.exec(String(d));
  if (!m) return String(d);
  const yy = m[1].slice(2);
  const mo = +m[2];
  const q = { 3: "Q1", 6: "Q2", 9: "Q3", 12: "Q4" }[mo];
  if (q && quarterly) return `${q} '${yy}`;
  const mon = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo];
  return `${mon} '${yy}`;
};

// ---- chart export (download as PNG / SVG) ----
const slug = (s) => (String(s || "chart").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "chart");

// Firm + as-of stamp, set once by App when the dashboard data loads. Charts don't
// receive `data`, but every EXPORTED chart needs to say whose numbers it is and
// when they were pulled — otherwise a PNG in a deck is an anonymous line.
let CHART_CTX = { firm: "", asOf: "" };
export const setChartContext = (ctx) => { CHART_CTX = { ...CHART_CTX, ...(ctx || {}) }; };
const SVG_NS = "http://www.w3.org/2000/svg";
const clip = (s, max) => (s && s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);
const contextLine = (company) =>
  [clip(company, 40), clip(CHART_CTX.firm, 40), CHART_CTX.asOf ? `data as of ${CHART_CTX.asOf}` : ""]
    .filter(Boolean).join("  ·  ");

/** Stamp a title / subtitle band above the chart and a firm·as-of line below it,
 *  INSIDE the cloned <svg>, so the downloaded PNG or SVG is self-explanatory on
 *  its own. On-screen headings are HTML and don't survive serialization. */
function stampCaption(clone, W, H, meta = {}) {
  const title = clip(meta.title ? String(meta.title) : "", 84);
  const subtitle = clip(meta.subtitle ? String(meta.subtitle) : "", 104);
  const foot = contextLine(meta.company);
  const top = title || subtitle ? 12 + (title ? 20 : 0) + (subtitle ? 15 : 0) : 0;
  const bot = foot ? 22 : 0;
  if (!top && !bot) return { W, H };

  // push the existing chart down to make room for the header band
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", `translate(0 ${top})`);
  while (clone.firstChild) g.appendChild(clone.firstChild);
  clone.appendChild(g);

  const put = (s, y, size, weight, fill, anchor = "start", x = 8) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", x); t.setAttribute("y", y);
    t.setAttribute("font-size", size); t.setAttribute("font-weight", weight);
    t.setAttribute("fill", fill); t.setAttribute("text-anchor", anchor);
    t.setAttribute("font-family", "Inter,'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif");
    t.textContent = s;
    clone.appendChild(t);
  };
  let y = 4;
  if (title) { y += 16; put(title, y, 15, 700, "var(--ink-color-global-text-default)"); }
  if (subtitle) { y += title ? 15 : 16; put(subtitle, y, 11, 400, "var(--ink-color-global-text-subtle)"); }
  if (foot) put(foot, H + top + 15, 10, 400, "var(--ink-color-global-text-subtle)");
  const H2 = H + top + bot;
  clone.setAttribute("viewBox", `0 0 ${W} ${H2}`);
  return { W, H: H2 };
}
const triggerDownload = (url, name) => { const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); };
// Resolve CSS custom properties (var(--…)) to their computed values so the
// standalone SVG/PNG renders with the right colors outside the app's DOM.
const resolveVars = (str) => {
  const cs = getComputedStyle(document.documentElement);
  return str.replace(/var\((--[a-zA-Z0-9-]+)\)/g, (_, v) => cs.getPropertyValue(v).trim() || "#000");
};
/** Serialize an <svg> element to a downloaded PNG or SVG file. */
export function exportChart(svgEl, name, format = "png", meta = {}) {
  if (!svgEl) return;
  const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  const W0 = Math.round(vb && vb.width ? vb.width : svgEl.clientWidth || 720);
  const H0 = Math.round(vb && vb.height ? vb.height : svgEl.clientHeight || 240);
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const { W, H } = stampCaption(clone, W0, H0, meta);
  clone.setAttribute("width", W);
  clone.setAttribute("height", H);
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--ink-color-global-surface-background-default").trim() || "#ffffff";
  let str = resolveVars(new XMLSerializer().serializeToString(clone))
    .replace(/(<svg[^>]*>)/, `$1<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  if (format === "svg") {
    triggerDownload(URL.createObjectURL(new Blob([str], { type: "image/svg+xml;charset=utf-8" })), `${name}.svg`);
    return;
  }
  const img = new Image();
  img.onload = () => {
    const scale = 2, canvas = document.createElement("canvas");
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, W, H);
    canvas.toBlob((b) => b && triggerDownload(URL.createObjectURL(b), `${name}.png`));
  };
  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(str)));
}

const EXPORT_OPTS = [{ id: "png", label: "PNG" }, { id: "svg", label: "SVG" }];

/** Compact toolbar for a chart: a single Export menu (PNG/SVG), built on the
 *  app's shared `Dropdown` — `value` stays null so the trigger always reads
 *  "Export" rather than settling on whichever format was last downloaded. */
function ChartTools({ svgRef, name, meta, compact = true }) {
  return (
    <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
      <Dropdown options={EXPORT_OPTS} value={null} nullLabel="Export" compact={compact}
        onChange={(format) => exportChart(svgRef.current, name, format, meta)}
        minWidth={compact ? 80 : 130} maxWidth={compact ? 100 : 160} />
    </div>
  );
}

/** On-screen chart heading. Views that already print their own heading right above
 *  the chart pass showTitle={false} — the title still reaches the export, the
 *  expand modal and the download filename, it just isn't repeated on the page. */
// Ink's real chart title recipe (theme-with-ink/charts.md): `.ink-chart__title`
// is 500/14px/24px, and a 12px/20px subtitle needs zero added margin — the
// leading of both lines already carries the gap between them.
// `wrap` lets a subtitle run to a full paragraph (e.g. a chart-preset blurb)
// instead of the default single-line ellipsis truncation.
function ChartHeading({ title, subtitle, wrap, subtitleTestId }) {
  if (!title && !subtitle) return <span />;
  return (
    <div style={{ minWidth: 0 }}>
      {title && <div style={{ ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 500, color: "var(--ink-color-global-text-default)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>}
      {subtitle && <div data-testid={subtitleTestId} style={{ ...sans, fontSize: FS.body, lineHeight: "20px", color: AXIS, marginTop: 0,
        ...(wrap ? null : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }) }}>{subtitle}</div>}
    </div>
  );
}


/**
 * series: [{ key, label, points: [{ d: "YYYY-MM-DD", v: number }] }]
 * type:   "line" | "area" | "bar"
 * unit:   "Dollar" | "Number" | "Percentage" (for value formatting)
 * The x-axis is the union of all periods across series (categorical, ordered).
 */
export default function Chart({ series = [], bands = [], gainLoss = null, lineSplit = null, marks = [], realized = null, type = "line", unit = "Number", height = 240, title, subtitle, showTitle = true, controls = true, chartId }) {
  const [hover, setHover] = useState(null); // {xi, sx, sy}
  const svgRef = useRef(null);
  // width="100%" stretches the viewBox, scaling text with the container. Measure
  // the container so 1 viewBox unit stays 1 real pixel at any width.
  const [W, setW] = useState(720);
  const wrapRef = useRef(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setW(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // display prefs (global defaults + this chart's overrides); the view's own
  // `type` is the fallback default so nothing changes until a user opts in.
  const { prefs } = useChartPrefs(chartId, { type });
  const labels = prefs.labels;
  const clean = (series || []).filter((s) => s && s.points && s.points.length);
  const cbands = (bands || []).filter((b) => b && b.lo && b.hi && b.lo.length);
  // Currency for the (series-spanning) axis ticks; per-point labels use each
  // point's own `cur` below.
  const axisCur = seriesCurrency(clean);
  if (!clean.length) {
    return (
      <div style={{ ...sans }}>
        {showTitle && (title || subtitle) && (
          <div style={{ marginBottom: 6 }}><ChartHeading title={title} subtitle={subtitle} /></div>
        )}
        <div style={{ height, display: "grid", placeItems: "center",
          color: "var(--ink-color-global-text-subtle)", fontSize: FS.small,
          border: `1px dashed ${GRID}`, borderRadius: 8 }}>
          No data for this selection
        </div>
      </div>
    );
  }

  // union of periods, ordered (include band periods so future forecast columns show)
  const bandPts = cbands.flatMap((b) => [...b.lo, ...b.hi]);
  const periods = Array.from(new Set([...clean.flatMap((s) => s.points.map((p) => p.d)), ...bandPts.map((p) => p.d)])).sort();
  const idxOf = new Map(periods.map((p, i) => [p, i]));

  const vals = [...clean.flatMap((s) => s.points.map((p) => p.v)), ...bandPts.map((p) => p.v)].filter(Number.isFinite);
  // y-domain: zeroBase pins 0 into the range (the historic behavior); explicit
  // yMin/yMax from the settings panel win over both.
  const uMin = boundOf(prefs.yMin), uMax = boundOf(prefs.yMax);
  let lo = prefs.zeroBase ? Math.min(0, ...vals) : Math.min(...vals);
  let hi = prefs.zeroBase ? Math.max(...vals, 0) : Math.max(...vals);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { hi = hi || 1; lo = Math.min(0, hi - 1); }
  hi += (hi - lo) * 0.08;
  if (uMin != null) lo = uMin;
  if (uMax != null) hi = uMax;
  if (lo === hi) hi = lo + 1; // guard a degenerate manual range

  const H = height;
  // axis titles need a little extra room when present
  const PL = 58 + (prefs.yTitle ? 14 : 0), PR = 16, PT = 14, PB = 30 + (prefs.xTitle ? 16 : 0);
  const iw = W - PL - PR, ih = H - PT - PB;
  const n = periods.length;
  const x = (i) => PL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const xBand = (i) => PL + ((i + 0.5) / Math.max(1, n)) * iw;
  const y = (v) => PT + ih - ((v - lo) / (hi - lo)) * ih;

  // y ticks
  const ticks = Math.max(1, prefs.ticks || 4);
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);

  // x label thinning
  const stepLbl = Math.ceil(n / 8);

  const isBar = (prefs.type || type) === "bar";
  const isArea = (prefs.type || type) === "area";
  const strokeW = Number(prefs.thickness) || 2;
  // bars/areas sit on zero, or on the visible floor when a manual range excludes it
  const barBase = y(Math.max(lo, Math.min(hi, 0)));
  const barGroupW = (iw / Math.max(1, n)) * 0.7;
  const barW = barGroupW / clean.length;

  // legend/hover swatch: a series' own color, else its "above" tint when split-
  // colored (green is the primary read), else the palette slot.
  const legendColor = (s, si) => s.color
    || (lineSplit && lineSplit.series === s.key ? (lineSplit.above || "#2D9E90") : seriesColor(prefs, si));

  return (
    <div ref={wrapRef} style={{ ...sans, width: "100%" }}>
      {((showTitle && (title || subtitle)) || controls) && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          {showTitle ? <ChartHeading title={title} subtitle={subtitle} /> : <span />}
          {controls && <ChartTools svgRef={svgRef}
            name={slug(title || (clean[0] && clean[0].label) || "chart")}
            meta={{ title, subtitle }} />}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}
        onMouseLeave={() => setHover(null)}>
        {/* diagonal hatch marking a realized (banked-cash) region */}
        {realized && (
          <defs>
            <pattern id={`soi-hatch-${chartId || "x"}`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="6" stroke={realized.color || "#2D9E90"} strokeWidth="1.1" strokeOpacity="0.5" />
            </pattern>
          </defs>
        )}
        {/* gridlines + y ticks */}
        {tickVals.map((tv, i) => (
          <g key={i}>
            {prefs.gridY && <line x1={PL} x2={W - PR} y1={y(tv)} y2={y(tv)} style={{ stroke: GRID }} strokeWidth="1" />}
            <text x={PL - 8} y={y(tv) + 3} textAnchor="end" fontSize={FS.micro} style={{ ...mono, fill: AXIS }}>
              {fmtVal(tv, unit, undefined, axisCur)}
            </text>
          </g>
        ))}
        {/* vertical gridlines (opt-in) */}
        {prefs.gridX && periods.map((p, i) => (i % stepLbl === 0 || i === n - 1) && (
          <line key={`gx-${p}`} x1={isBar ? xBand(i) : x(i)} x2={isBar ? xBand(i) : x(i)} y1={PT} y2={H - PB}
            style={{ stroke: GRID }} strokeWidth="1" />
        ))}
        {/* x labels */}
        {periods.map((p, i) => (i % stepLbl === 0 || i === n - 1) && (
          <text key={p} x={isBar ? xBand(i) : x(i)} y={H - PB + 16} textAnchor="middle" fontSize={FS.micro} style={{ ...mono, fill: AXIS }}>
            {shortDate(p)}
          </text>
        ))}
        {/* axis titles (opt-in) */}
        {prefs.xTitle && (
          <text x={PL + iw / 2} y={H - 2} textAnchor="middle" fontSize={FS.micro} style={{ ...sans, fill: AXIS }}>{prefs.xTitle}</text>
        )}
        {prefs.yTitle && (
          <text x={12} y={PT + ih / 2} textAnchor="middle" fontSize={FS.micro} style={{ ...sans, fill: AXIS }}
            transform={`rotate(-90 12 ${PT + ih / 2})`}>{prefs.yTitle}</text>
        )}

        {/* confidence bands (behind series) */}
        {cbands.map((b, bi) => {
          const hi = b.hi.filter((p) => idxOf.has(p.d)).map((p) => `${x(idxOf.get(p.d))} ${y(p.v)}`);
          const lo = b.lo.filter((p) => idxOf.has(p.d)).map((p) => `${x(idxOf.get(p.d))} ${y(p.v)}`).reverse();
          if (!hi.length) return null;
          // A band belongs to a series, so it follows that series' resolved color
          // (`seriesIndex`). An explicit `color` still wins, and the gray is the
          // last resort for a band tied to no series at all.
          const bfill = b.color
            || (b.seriesIndex != null ? seriesColor(prefs, b.seriesIndex) : null)
            || "#8894A0";
          return <polygon key={`band-${bi}`} points={[...hi, ...lo].join(" ")} fill={bfill} opacity="0.14" />;
        })}

        {/* gain/loss shading between two series (behind the lines): green where
            `upper` sits above `lower`, red where it dips below. Segments that
            cross split at the interpolated crossover so the color flips exactly
            where the lines meet. Straight-edged even under smoothing. */}
        {gainLoss && (() => {
          const up = clean.find((s) => s.key === gainLoss.upper);
          const dn = clean.find((s) => s.key === gainLoss.lower);
          if (!up || !dn) return null;
          const uMap = new Map(up.points.map((p) => [p.d, p.v]));
          const dMap = new Map(dn.points.map((p) => [p.d, p.v]));
          // periods where both series report a finite value, in axis order
          const shared = periods.filter((d) =>
            Number.isFinite(uMap.get(d)) && Number.isFinite(dMap.get(d)));
          // Ink data-viz palette: --ink-color-global-data-viz-positive-3 / -negative-3.
          // Literal hex (not var()) — CSS custom properties don't resolve as an SVG fill.
          const gain = gainLoss.gainColor || "#2D9E90";
          const loss = gainLoss.lossColor || "#E52431";
          const op = gainLoss.opacity != null ? gainLoss.opacity : 0.13;
          const quad = (xa, ua, la, xb, ub, lb) =>
            `${xa} ${y(ua)} ${xb} ${y(ub)} ${xb} ${y(lb)} ${xa} ${y(la)}`;
          const polys = [];
          for (let k = 0; k < shared.length - 1; k++) {
            const da = shared[k], db = shared[k + 1];
            const xa = x(idxOf.get(da)), xb = x(idxOf.get(db));
            const ua = uMap.get(da), la = dMap.get(da);
            const ub = uMap.get(db), lb = dMap.get(db);
            const sa = ua - la, sb = ub - lb; // >0 gain, <0 loss
            if (sa >= 0 === sb >= 0) {
              polys.push({ pts: quad(xa, ua, la, xb, ub, lb), fill: sa >= 0 ? gain : loss });
            } else {
              // lines cross inside this segment — split at the crossover
              const t = sa / (sa - sb);
              const xc = xa + t * (xb - xa);
              const vc = ua + t * (ub - ua); // upper == lower here
              polys.push({ pts: quad(xa, ua, la, xc, vc, vc), fill: sa >= 0 ? gain : loss });
              polys.push({ pts: quad(xc, vc, vc, xb, ub, lb), fill: sb >= 0 ? gain : loss });
            }
          }
          return polys.map((p, pi) => (
            <polygon key={`gl-${pi}`} points={p.pts} fill={p.fill} opacity={op} />
          ));
        })()}

        {/* realized region: hatch the area between the value line and its baseline
            from the exit onward, so post-exit value reads as banked cash, not a mark */}
        {realized && (() => {
          const up = clean.find((s) => s.key === realized.series);
          const dn = clean.find((s) => s.key === realized.against);
          if (!up || !dn) return null;
          const uMap = new Map(up.points.map((p) => [p.d, p.v]));
          const dMap = new Map(dn.points.map((p) => [p.d, p.v]));
          const per = periods.filter((d) => d >= realized.from && Number.isFinite(uMap.get(d)) && Number.isFinite(dMap.get(d)));
          if (per.length < 2) return null;
          const top = per.map((d) => `${x(idxOf.get(d))} ${y(uMap.get(d))}`);
          const bot = per.slice().reverse().map((d) => `${x(idxOf.get(d))} ${y(dMap.get(d))}`);
          return <polygon points={[...top, ...bot].join(" ")} fill={`url(#soi-hatch-${chartId || "x"})`} />;
        })()}

        {/* series */}
        {clean.map((s, si) => {
          // a series may pin its own stroke color (e.g. cost basis as black)
          const c = s.color || seriesColor(prefs, si);
          const pts = s.points.filter((p) => idxOf.has(p.d)).map((p) => ({ i: idxOf.get(p.d), v: p.v, cur: p.cur }));
          if (isBar) {
            return pts.map((p) => {
              const bx = xBand(p.i) - barGroupW / 2 + si * barW;
              const showLbl = labels && (p.i % stepLbl === 0 || p.i === n - 1);
              return (
                <g key={`${si}-${p.i}`}>
                  <rect x={bx} y={Math.min(y(p.v), barBase)} width={Math.max(1, barW - 1)} height={Math.abs(y(p.v) - barBase)} fill={c} rx="1" />
                  {showLbl && (
                    <text x={bx + Math.max(1, barW - 1) / 2} y={p.v >= 0 ? Math.max(9, y(p.v) - 3) : y(p.v) + 9}
                      textAnchor="middle" fontSize="9" fill={c} style={mono}>{fmtVal(p.v, unit, undefined, p.cur)}</text>
                  )}
                </g>
              );
            });
          }
          const screen = pts.map((p) => ({ x: x(p.i), y: y(p.v) }));
          const path = prefs.smooth ? smoothPath(screen)
            : screen.map((p, k) => `${k ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
          // close the area back along the zero line (or the floor, if 0 is off-scale)
          const area = isArea && pts.length
            ? `${path} L ${x(pts[pts.length - 1].i)} ${barBase} L ${x(pts[0].i)} ${barBase} Z` : null;
          // color a series green/red by sign of (value − reference series), split
          // straight at the crossover; falls back to `c` where reference is missing.
          const split = lineSplit && lineSplit.series === s.key ? lineSplit : null;
          const refMap = split
            ? new Map(((clean.find((z) => z.key === split.against) || {}).points || []).map((p) => [p.d, p.v]))
            : null;
          const above = (split && split.above) || "#2D9E90"; // Ink data-viz-positive-3
          const below = (split && split.below) || "#E52431"; // Ink data-viz-negative-3
          const segColorAt = (i, v) => {
            const rv = refMap && refMap.get(periods[i]);
            return Number.isFinite(rv) ? (v - rv >= 0 ? above : below) : c;
          };
          const segs = [];
          if (split) {
            for (let k = 0; k < pts.length - 1; k++) {
              const p0 = pts[k], p1 = pts[k + 1];
              const x0 = x(p0.i), y0 = y(p0.v), x1 = x(p1.i), y1 = y(p1.v);
              const r0 = refMap.get(periods[p0.i]), r1 = refMap.get(periods[p1.i]);
              if (!Number.isFinite(r0) || !Number.isFinite(r1)) { segs.push({ d: `M ${x0} ${y0} L ${x1} ${y1}`, stroke: c }); continue; }
              const s0 = p0.v - r0, s1 = p1.v - r1;
              if (s0 >= 0 === s1 >= 0) { segs.push({ d: `M ${x0} ${y0} L ${x1} ${y1}`, stroke: s0 >= 0 ? above : below }); continue; }
              const t = s0 / (s0 - s1); // y is linear in v, so screen interp lands on the crossover
              const xc = x0 + t * (x1 - x0), yc = y0 + t * (y1 - y0);
              segs.push({ d: `M ${x0} ${y0} L ${xc} ${yc}`, stroke: s0 >= 0 ? above : below });
              segs.push({ d: `M ${xc} ${yc} L ${x1} ${y1}`, stroke: s1 >= 0 ? above : below });
            }
          }
          return (
            <g key={si}>
              {area && <path d={area} fill={c} opacity={prefs.areaOpacity} />}
              {split
                ? segs.map((sg, gi) => <path key={gi} d={sg.d} fill="none" stroke={sg.stroke}
                    strokeWidth={strokeW} strokeLinejoin="round" strokeLinecap="round" />)
                : <path d={path} fill="none" stroke={c} strokeWidth={s.faint ? strokeW * 0.6 : strokeW} opacity={s.faint ? 0.5 : 1}
                    strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dash || (s.dashed ? "5 4" : undefined)} />}
              {prefs.markers && pts.map((p) => {
                const mc = split ? segColorAt(p.i, p.v) : c;
                return <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={s.faint ? 1.6 : Math.max(2, strokeW + 0.5)} opacity={s.faint ? 0.5 : 1} style={{ fill: (!split && (s.dashed || s.dash)) ? "var(--ink-color-global-surface-background-default)" : mc }} stroke={mc} strokeWidth={(!split && (s.dashed || s.dash)) ? 1.5 : 0} />;
              })}
              {labels && !s.faint && pts.map((p) => (p.i % stepLbl === 0 || p.i === n - 1) && (
                <text key={`l-${p.i}`} x={x(p.i)} y={Math.max(9, y(p.v) - 6)} textAnchor="middle" fontSize="9" fill={c} style={mono}>{fmtVal(p.v, unit, undefined, p.cur)}</text>
              ))}
            </g>
          );
        })}

        {/* point annotations (e.g. a realization/exit marker): a ringed dot on the
            named series with a short label above. Detail belongs in the tooltip. */}
        {marks.map((m, mi) => {
          const i = idxOf.get(m.d);
          if (i == null) return null;
          const s = clean.find((z) => z.key === m.series) || clean[0];
          const pt = s && s.points.find((p) => p.d === m.d);
          if (!pt || !Number.isFinite(pt.v)) return null;
          const cx = x(i), cy = y(pt.v), col = m.color || AXIS;
          return (
            <g key={`mk-${mi}`}>
              <circle cx={cx} cy={cy} r="5" style={{ fill: "var(--ink-color-global-surface-background-default)" }} stroke={col} strokeWidth="2.5" />
              {m.label && (
                <text x={cx} y={Math.max(10, cy - 10)} textAnchor={i >= n - 2 ? "end" : "middle"}
                  fontSize={FS.micro} style={{ ...sans, fill: col }}>{m.label}</text>
              )}
            </g>
          );
        })}

        {/* rolling-distribution ticks: a small dot at each later proceeds step-up */}
        {realized && (realized.ticks || []).map((d, ti) => {
          const i = idxOf.get(d);
          if (i == null) return null;
          const up = clean.find((s) => s.key === realized.series);
          const pt = up && up.points.find((p) => p.d === d);
          if (!pt || !Number.isFinite(pt.v)) return null;
          return <circle key={`tk-${ti}`} cx={x(i)} cy={y(pt.v)} r="3"
            style={{ fill: "var(--ink-color-global-surface-background-default)" }}
            stroke={realized.color || "#2D9E90"} strokeWidth="1.75" />;
        })}

        {/* hover column */}
        {periods.map((p, i) => {
          const cx = isBar ? xBand(i) : x(i);
          return (
            <rect key={`h-${i}`} x={cx - iw / Math.max(1, n) / 2} y={PT} width={iw / Math.max(1, n)} height={ih}
              fill="transparent" onMouseEnter={() => setHover(i)} />
          );
        })}
        {hover != null && (
          <line x1={isBar ? xBand(hover) : x(hover)} x2={isBar ? xBand(hover) : x(hover)} y1={PT} y2={PT + ih}
            style={{ stroke: AXIS }} strokeWidth="1" strokeDasharray="3 3" />
        )}
      </svg>

      {/* legend */}
      {prefs.legend && clean.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 8 }}>
          {clean.map((s, si) => {
            const lc = legendColor(s, si);
            return (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FS.small, color: AXIS }}>
              {(s.dashed || s.dash)
                ? <span style={{ width: 14, height: 0, flex: "none", borderTop: `2px dashed ${lc}`, opacity: s.faint ? 0.5 : 1 }} />
                : <span style={{ width: 10, height: 10, borderRadius: 2, background: lc, flex: "none", opacity: s.faint ? 0.5 : 1 }} />}
              {s.label}
            </span>
          ); })}
          {realized && (
            // Hatched swatch mirroring the chart's realized (banked-cash) region.
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FS.small, color: AXIS }}>
              <span style={{ width: 10, height: 10, flex: "none", borderRadius: 2,
                border: `1px solid ${realized.color || "#2D9E90"}`,
                backgroundImage: `repeating-linear-gradient(45deg, ${realized.color || "#2D9E90"} 0 1.1px, transparent 1.1px 4px)` }} />
              Realized cash
            </span>
          )}
        </div>
      )}

      {/* hover readout */}
      {hover != null && (
        <div style={{ marginTop: 6, fontSize: FS.small, color: "var(--ink-color-global-text-default)", ...mono }}>
          <strong>{shortDate(periods[hover])}</strong>{"  "}
          {clean.map((s, si) => {
            const pt = s.points.find((p) => p.d === periods[hover]);
            return pt ? (
              <span key={s.key} style={{ marginLeft: 12 }}>
                <span style={{ color: legendColor(s, si) }}>●</span> {s.label}: {fmtVal(pt.v, unit, undefined, pt.cur)}
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

/** Round a domain max up to a readable step (1/2/5/10 × a power of ten), per the
 *  Ink chart recipe — a gridless chart still needs an honest, round-numbered axis. */
function niceMax(v) {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** Halve evenly-spaced positions past 1.6× the target gap, so the dot matrix
 *  holds an even density regardless of point count (theme-with-ink/charts.md). */
function subdivide(positions, target = 20) {
  let out = positions.slice().sort((a, b) => a - b);
  while (out.length > 1 && out[1] - out[0] > target * 1.6) {
    const next = [];
    for (let i = 0; i < out.length - 1; i++) next.push(out[i], (out[i] + out[i + 1]) / 2);
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** Drop a trailing ".00"/".0" across a whole tick set, but only when NONE of
 *  them actually needs it — a set with one real decimal keeps them all, so
 *  neighboring ticks stay comparable (theme-with-ink/charts.md). */
function trimAxisPrecision(strs) {
  const trivialDecimal = /\.0+([%×A-Za-z]*)$/;
  const allTrivial = strs.every((s) => !/\.\d/.test(s) || trivialDecimal.test(s));
  return allTrivial ? strs.map((s) => s.replace(trivialDecimal, "$1")) : strs;
}

const LIME = "var(--ink-color-global-data-viz-lime-3)"; // #94B524 — the house pick for a single series

// Domain-framing thresholds, named so every Ink chart reads as the same rule.
const BOUND_PAD_RATIO = 0.15; // percentage/ratio KPI: pad a tight band by this fraction of its span
const MEANINGFUL_NEG_RATIO = 0.1; // a magnitude KPI's dip must clear this fraction of its max to earn its own axis tier

/** Shared Ink y-domain framing for InkKpiChart: a bounded
 *  metric (%, ratio) has no meaningful zero floor, so it frames to its own
 *  data range; everything else zero-anchors with a rounded ceiling, only
 *  extending below zero when the dip is large enough to earn its own tier. */
function yDomain(vals, unit) {
  const dataMin = Math.min(...vals), dataMax = Math.max(...vals);
  const isBounded = unit === "Percentage" || unit === "Percent" || unit === "Ratio";
  let loV, hiV;
  if (isBounded && dataMin < 0 && dataMax > 0) {
    loV = -niceMax(-dataMin); hiV = niceMax(dataMax);
  } else if (isBounded) {
    const span = dataMax - dataMin;
    const pad = span > 0 ? span * BOUND_PAD_RATIO : (Math.abs(dataMax) * MEANINGFUL_NEG_RATIO || 1);
    loV = dataMin - pad; hiV = dataMax + pad;
  } else {
    const negMag = dataMin < 0 ? -dataMin : 0;
    const meaningfulNeg = negMag > 0 && (dataMax <= 0 || negMag >= dataMax * MEANINGFUL_NEG_RATIO);
    loV = meaningfulNeg ? -niceMax(negMag) : 0;
    hiV = dataMax > 0 ? niceMax(dataMax) : 0; // niceMax(0) is 1, not a real ceiling — an all-negative series just tops out at 0
    if (loV === hiV) hiV = loV + 1;
  }
  return { loV, hiV };
}

/** Ink's canonical single-series chart recipe (theme-with-ink/charts.md), used
 *  only by the Company KPI chart wall — not a replacement for `Chart` above. */
export function InkKpiChart({ id, title, badge, company, unit = "Number", points = [], quarterly = true, height = 150 }) {
  const [hover, setHover] = useState(null);
  // A fixed viewBox width gets stretched by width="100%", scaling text with it.
  // Measure the real container width so 1 viewBox unit stays 1 real pixel.
  const [W, setW] = useState(300);
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setW(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clean = (points || []).filter((p) => p && p.d != null && Number.isFinite(p.v));

  if (!clean.length) {
    return (
      <div ref={wrapRef} style={{ height, display: "grid", placeItems: "center", color: AXIS, ...sans, fontSize: FS.body,
        border: `1px dashed ${GRID}` }}>
        No data for this selection
      </div>
    );
  }

  const cur = seriesCurrency([{ points: clean }]);
  const n = clean.length;
  const last = clean[n - 1];
  const prev = n > 1 ? clean[n - 2] : null;
  const delta = prev ? last.v - prev.v : null;
  // A stale index from a longer series (e.g. before a quarterly/as-reported
  // toggle shrinks `points`) must not index past the current array.
  const hoverPt = hover != null && hover < n ? clean[hover] : null;

  const H = height;
  // Left gutter wide enough for a right-aligned compact value (e.g. "-$530.5M")
  // to sit flush against the plot's left edge, per the Ink chart recipe.
  const PAD = { left: 62, right: 8, top: 4, bottom: 22 };
  const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
  const vals = clean.map((p) => p.v);
  const { loV, hiV } = yDomain(vals, unit);
  const X = (i) => PAD.left + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const Y = (v) => PAD.top + ih - ((v - loV) / (hiV - loV || 1)) * ih;
  // Clamp a point below the floor (an insignificant dip that lost its own tier
  // above) so it reads as sitting on the axis instead of poking past the plot.
  const YV = (v) => Y(Math.max(v, loV));
  // The area/baseline reference sits at zero when zero is in range, else
  // clamps to whichever edge is closer — same rule the general Chart uses.
  const zeroV = Math.max(loV, Math.min(hiV, 0));
  const baseline = Y(zeroV);

  // Y label values — the domain's own floor and ceiling, plus their midpoint.
  const yTickVals = [loV, (loV + hiV) / 2, hiV];
  const dotRows = yTickVals.filter((tv) => Math.abs(Y(tv) - baseline) >= 1);
  // Halve gaps wider than ~32px so few points/a tall card still get an even field.
  // A single point has no gap to halve — subdivide the full plot width instead.
  const dotCols = subdivide(n > 1 ? clean.map((_, i) => X(i)) : [PAD.left, PAD.left + iw]);
  const dotRowsPx = subdivide(dotRows.map((tv) => Y(tv))).filter((y) => Math.abs(baseline - y) > 1.6);
  const dots = [];
  for (const x of dotCols) for (const y of dotRowsPx) dots.push({ x, y });

  // Precision decided once for the whole axis (zero label included), not per tick.
  const yLabelRows = [zeroV, ...dotRows].map((tv) => ({ y: Y(tv), raw: fmtVal(tv, unit, undefined, last.cur || cur) }));
  const yLabelTexts = trimAxisPrecision(yLabelRows.map((r) => r.raw));

  const stepLbl = Math.max(1, Math.ceil(n / 5));
  const path = clean.map((p, i) => `${i ? "L" : "M"} ${X(i)} ${YV(p.v)}`).join(" ");
  const areaPath = `${path} L ${X(n - 1)} ${baseline} L ${X(0)} ${baseline} Z`;
  // In-progress period dashed, starting one point early so the runs join with no gap.
  const dashTail = !!last.partial && n > 1;
  const solidPath = dashTail ? clean.slice(0, n - 1).map((p, i) => `${i ? "L" : "M"} ${X(i)} ${YV(p.v)}`).join(" ") : path;
  const dashSeg = dashTail ? `M ${X(n - 2)} ${YV(clean[n - 2].v)} L ${X(n - 1)} ${YV(last.v)}` : null;

  const gid = `ink-kpi-grad-${id || "chart"}`;

  // Carried into the export caption only — the unit/basis a downloaded chart
  // needs to be self-explanatory, same as the general Chart's own subtitle.
  const captionSubtitle = `${unit} · ${quarterly ? "quarterly basis" : "as reported"}`;

  return (
    <div ref={wrapRef} style={{ ...sans, position: "relative" }}>
      {/* title row — reads as one stacked headline with the value below it, so
          no added margin here; only the type's own leading separates them. */}
      {title && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: FS.bodyLg, lineHeight: "20px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
            {badge}
          </div>
          <ChartTools svgRef={svgRef} name={slug(title)} meta={{ title, subtitle: captionSubtitle, company }} />
        </div>
      )}

      {/* headline — lead with the value, per the Ink chart recipe */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ ...mono, fontSize: FS.h3, lineHeight: "24px", fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>
          {fmtVal(last.v, unit, undefined, last.cur || cur)}
        </span>
        {delta != null && (
          <span style={{ ...mono, fontSize: FS.small, color: delta >= 0 ? POS : NEG }}>
            {delta >= 0 ? "▲" : "▼"} {fmtVal(Math.abs(delta), unit, undefined, last.cur || cur)}
          </span>
        )}
        {last.partial && <span style={{ ...sans, fontSize: FS.micro, color: AXIS }}>· in progress</span>}
        {!title && <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>{badge}<ChartTools svgRef={svgRef} name={slug("chart")} meta={{ subtitle: captionSubtitle, company }} /></span>}
      </div>

      <div style={{ position: "relative" }}>
      <svg ref={svgRef} role="img" width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}
        aria-label={`Line chart of ${unit} from ${shortDate(clean[0].d, quarterly)} to ${shortDate(last.d, quarterly)}. Latest ${fmtVal(last.v, unit, undefined, last.cur || cur)}${delta != null ? `, ${delta >= 0 ? "up" : "down"} ${fmtVal(Math.abs(delta), unit, undefined, last.cur || cur)} vs the prior period` : ""}.`}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LIME} stopOpacity="0.28" />
            <stop offset="100%" stopColor={LIME} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* dot matrix — confined to the plot, no gridlines anywhere on this chart */}
        {dots.map((d, i) => (
          <rect key={i} x={d.x - 0.8} y={d.y - 0.8} width="1.6" height="1.6" style={{ fill: GRID }} />
        ))}

        {/* Single-series area, then the line. A lone point has no line to draw —
            mark it with the hover-marker square instead of an empty plot. */}
        {n === 1 ? (
          <rect x={X(0) - 3} y={YV(clean[0].v) - 3} width="6" height="6" style={{ fill: LIME }} />
        ) : (
          <>
            <path d={areaPath} fill={`url(#${gid})`} />
            <path d={solidPath} fill="none" stroke={LIME} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {dashSeg && <path d={dashSeg} fill="none" stroke={LIME} strokeWidth="2" strokeLinecap="round" strokeDasharray="5 3" />}
          </>
        )}

        {/* Drawn after the marks so a negative series' area fill can't wash out
            the baseline; labels thinned so they don't collide. */}
        <line x1={PAD.left} x2={W - PAD.right} y1={baseline} y2={baseline} style={{ stroke: GRID }} strokeWidth="1" />
        {yLabelRows.map((r, i) => (
          <text key={i} x={PAD.left - 8} y={r.y + 3} textAnchor="end" fontSize="12" style={{ ...mono, fill: AXIS }}>
            {yLabelTexts[i]}
          </text>
        ))}
        {clean.map((p, i) => {
          // Drop a regular-interval tick that would crowd the final one instead
          // of letting their labels run into each other.
          const labeled = i === n - 1 || (i % stepLbl === 0 && n - 1 - i > stepLbl / 2);
          return (
            <g key={p.d}>
              <line x1={X(i)} x2={X(i)} y1={baseline} y2={baseline + (labeled ? 6 : 3)} style={{ stroke: GRID }} strokeWidth="1" />
              {labeled && (
                <text x={X(i)} y={H - 4} textAnchor="middle" fontSize="12" style={{ ...mono, fill: AXIS }}>
                  {shortDate(p.d, quarterly)}
                </text>
              )}
            </g>
          );
        })}

        {/* hover: crosshair + a square marker (Ink's series shape) */}
        {hoverPt && (
          <>
            <line x1={X(hover)} x2={X(hover)} y1={PAD.top} y2={PAD.top + ih} style={{ stroke: AXIS }} strokeWidth="1" strokeDasharray="3 3" />
            <rect x={X(hover) - 3} y={YV(hoverPt.v) - 3} width="6" height="6" style={{ fill: LIME }} />
          </>
        )}

        {/* hit targets — one per period, clamped to the plot so a band at either
            end doesn't reach into the axis-label gutter. */}
        {n === 1 ? (
          <rect x={PAD.left} y={PAD.top} width={iw} height={ih} fill="transparent" onMouseEnter={() => setHover(0)} />
        ) : clean.map((p, i) => {
          const lo = Math.max(PAD.left, X(i) - iw / (2 * (n - 1)));
          const hi = Math.min(W - PAD.right, X(i) + iw / (2 * (n - 1)));
          return (
            <rect key={`h-${p.d}`} x={lo} y={PAD.top} width={hi - lo} height={ih}
              fill="transparent" onMouseEnter={() => setHover(i)} />
          );
        })}
      </svg>

      {/* tooltip — anchored to the hovered point itself, clamped horizontally
          and flipped below when there's no room above it (charts.md's placeTip) */}
      {hoverPt && (() => {
        const hx = X(hover), hy = YV(hoverPt.v);
        const leftPct = (hx / W) * 100;
        const topPct = (hy / H) * 100;
        const flipBelow = hy - PAD.top < 40;
        // Near an edge, centering pushes the box off the card — anchor to that edge instead.
        const nearRight = hx > W - PAD.right - 40;
        const nearLeft = hx < PAD.left + 40;
        const translateX = nearRight ? "-100%" : nearLeft ? "0%" : "-50%";
        return (
          // Ink's compact tooltip mode (theme-with-ink/charts.md): 12px/20px body,
          // a flat 10x10 swatch, subtle date, tabular-nums value.
          <div aria-hidden="true" style={{ position: "absolute", left: `${leftPct}%`, top: `${topPct}%`,
            transform: flipBelow ? `translate(${translateX}, 8px)` : `translate(${translateX}, calc(-100% - 8px))`,
            whiteSpace: "nowrap", pointerEvents: "none", display: "flex", alignItems: "center", gap: 8,
            background: "var(--ink-color-global-surface-background-default)", border: `1px solid ${GRID}`,
            borderRadius: 4, padding: "4px 8px", ...sans, fontSize: FS.body, lineHeight: "20px", color: "var(--ink-color-global-text-default)" }}>
            <span style={{ width: 10, height: 10, flex: "none", background: LIME }} />
            <span style={{ color: "var(--ink-color-global-text-subtle)" }}>{shortDate(hoverPt.d, quarterly)}</span>
            <strong style={{ ...mono, marginLeft: 12, fontWeight: 600 }}>{fmtVal(hoverPt.v, unit, undefined, hoverPt.cur || cur)}</strong>
          </div>
        );
      })()}
      </div>
    </div>
  );
}

/** Build a value→[0,1] projection for one scatter axis under a scale mode.
 *  Returns { lo, hi, t, at, isEdge }: lo/hi are the domain endpoints in data
 *  units; t clamps into [0,1] so robust-mode outliers pin to the edge; at is the
 *  inverse, for evenly spaced gridlines. Small samples fall back to linear. */
export function makeAxis(vals, mode) {
  const clean = vals.filter(Number.isFinite);
  const lin = () => {
    let lo = clean.length ? Math.min(...clean) : 0, hi = clean.length ? Math.max(...clean) : 1;
    if (lo === hi) { hi += 1; lo -= 1; }
    const m = (hi - lo) * 0.1; lo -= m; hi += m;
    return { lo, hi, t: (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo))),
      at: (f) => lo + f * (hi - lo), isEdge: () => false };
  };
  if (clean.length < 5 || mode === "linear") return lin();

  if (mode === "robust") {
    const q1 = quantile(clean, 0.25), q3 = quantile(clean, 0.75), iqr = q3 - q1;
    if (!(iqr > 0)) return lin();  // degenerate spread → no clamping
    let lo = Math.max(Math.min(...clean), q1 - 3 * iqr);
    let hi = Math.min(Math.max(...clean), q3 + 3 * iqr);
    if (lo === hi) { hi += 1; lo -= 1; }
    const m = (hi - lo) * 0.1, plo = lo - m, phi = hi + m;
    return { lo: plo, hi: phi, t: (v) => Math.max(0, Math.min(1, (v - plo) / (phi - plo))),
      at: (f) => plo + f * (phi - plo), isEdge: (v) => v < lo || v > hi };
  }

  // symlog: sign(v)*log1p(|v|/lt). lt (p75 of |v|) sizes the near-zero linear
  // span so the bulk stays readable while heavy tails compress.
  const abs = clean.map(Math.abs).filter((a) => a > 0);
  const lt = Math.max(quantile(abs, 0.75) || 1, 1e-9);
  const f = (v) => Math.sign(v) * Math.log1p(Math.abs(v) / lt);
  const fInv = (u) => Math.sign(u) * lt * Math.expm1(Math.abs(u));
  let flo = f(Math.min(...clean)), fhi = f(Math.max(...clean));
  if (flo === fhi) { fhi += 1; flo -= 1; }
  const m = (fhi - flo) * 0.1; flo -= m; fhi += m;
  return { lo: fInv(flo), hi: fInv(fhi), t: (v) => Math.max(0, Math.min(1, (f(v) - flo) / (fhi - flo))),
    at: (fr) => fInv(flo + fr * (fhi - flo)), isEdge: () => false };
}

/** Reference size for bubble radius. Caps at the p95 when one company dwarfs the
 *  rest (>3× p95), so a single giant doesn't shrink every other bubble. */
export function scatterSizeRef(sizes, cap) {
  if (!sizes.length) return 1;
  const smax = Math.max(...sizes);
  if (!cap) return smax;
  const p95 = quantile(sizes, 0.95) || smax;
  return smax > 3 * p95 ? p95 : smax;
}

/* ---------- Strip plot (metric distribution within cohorts) ---------- */

// Above/below-median semantic colors — same tokens the Benchmarks view uses.
const POS = "var(--ink-color-global-feedback-positive-strong)";
const NEG = "var(--ink-color-global-feedback-negative-strong)";
const fmtPct = (g) => (g == null ? "" : (g >= 0 ? "+" : "−") + withCommas(Math.abs(g * 100).toFixed(0)) + "%");

// Deterministic jitter in [-1, 1] from a company id, so dots don't jump on
// re-render the way Math.random would (FNV-1a hash, normalized).
function jitterOf(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Horizontal strip plot: one lane per cohort. A shaded band marks the middle
 *  50% (P25–P75) with labeled P25 / median / P75 markers, and every company is a
 *  jittered dot over it (green above / red below the cohort median).
 *  `lanes` = [{ key,label,n,median,p25,p75,min,max,
 *              points:[{id,label,value,cur,vsMedian,quartile}] }].
 *  Lanes with n<2 draw the single dot only (no band — no benchmark to draw). */
export function StripPlot({ lanes = [], unit = "Number", cur, height, chartId, onPointClick, title, subtitle, showTitle = true, controls = true }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  // Robust scale spreads the IQR bulk and pins outliers to the edge — a few
  // giants on a linear/symlog axis crush everyone else into a blob.
  const { prefs } = useChartPrefs(chartId, { scatterScale: "robust" });
  const labels = prefs.labels;

  const clean = lanes.filter((l) => l && l.points && l.points.length);
  if (!clean.length) return (
    <div style={{ ...sans }}>
      {showTitle && (title || subtitle) && <div style={{ marginBottom: 6 }}><ChartHeading title={title} subtitle={subtitle} /></div>}
      <div style={{ height: height || 200, display: "grid", placeItems: "center", color: AXIS, fontSize: FS.small, border: `1px dashed ${GRID}`, borderRadius: 8 }}>Not enough data to plot</div>
    </div>
  );

  // Each lane scales to its OWN cohort range, not a portfolio-wide axis, so one
  // outlier cohort can't crush another into a few pixels (see legend + min/max).
  const W = 720, PL = 104, PR = 20, PT = 16, PB = 14;
  const H = height || PT + PB + clean.length * 72;
  const laneH = (H - PT - PB) / clean.length;
  const tip = (l, p) => [p.label, fmtVal(p.value, unit, undefined, p.cur || cur),
    p.vsMedian != null ? `${fmtPct(p.vsMedian)} vs median` : null, p.quartile ? `Q${p.quartile}` : null]
    .filter(Boolean).join(" · ");

  return (
    <div style={{ ...sans }}>
      {((showTitle && (title || subtitle)) || controls) && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          {showTitle ? <ChartHeading title={title} subtitle={subtitle} /> : <span />}
          {controls && <ChartTools svgRef={svgRef}
            name={slug(title || "distribution")} meta={{ title, subtitle }} />}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
        {clean.map((lane, li) => {
          const top = PT + li * laneH, mid = top + laneH / 2;
          const hasBench = lane.n >= 2 && Number.isFinite(lane.median);
          const band = hasBench && Number.isFinite(lane.p25) && Number.isFinite(lane.p75) && lane.p75 > lane.p25;
          const pad = Math.min(11, laneH * 0.16);
          const jit = laneH * 0.30;
          const INK = "var(--ink-color-global-text-default)";
          // Per-lane axis: fit this cohort's own dots plus its P25/median/P75.
          const laneVals = lane.points.map((p) => p.value).filter(Number.isFinite);
          const ax = makeAxis(laneVals.concat([lane.p25, lane.median, lane.p75].filter(Number.isFinite)), prefs.scatterScale);
          const X = (v) => PL + ax.t(v) * (W - PL - PR);
          const lo = laneVals.length ? Math.min(...laneVals) : 0;
          const hi = laneVals.length ? Math.max(...laneVals) : 0;
          // Only label the P25/P75 edges when they're far enough apart to read.
          const wide = band && X(lane.p75) - X(lane.p25) > 48;
          return (
            <g key={lane.key || li}>
              {li > 0 && <line x1={PL} x2={W - PR} y1={top} y2={top} style={{ stroke: GRID }} strokeWidth="1" />}
              {/* lane label */}
              <text x={PL - 10} y={mid - 3} textAnchor="end" fontSize="11" fontWeight="600" style={{ fill: INK }}>{clip(String(lane.label), 14)}</text>
              <text x={PL - 10} y={mid + 11} textAnchor="end" fontSize="9" style={{ ...mono, fill: AXIS }}>{lane.n === 1 ? "n=1" : `n=${lane.n}`}</text>
              {/* middle-50% band (P25–P75) with crisp edges + labeled percentile markers */}
              {band && (<>
                <rect x={X(lane.p25)} y={top + pad} width={Math.max(1, X(lane.p75) - X(lane.p25))} height={laneH - 2 * pad}
                  style={{ fill: "var(--ink-color-global-surface-lightgray-default)" }} opacity="0.75" rx="2" />
                <line x1={X(lane.p25)} x2={X(lane.p25)} y1={top + pad} y2={top + laneH - pad} style={{ stroke: AXIS }} strokeWidth="1" opacity="0.6" />
                <line x1={X(lane.p75)} x2={X(lane.p75)} y1={top + pad} y2={top + laneH - pad} style={{ stroke: AXIS }} strokeWidth="1" opacity="0.6" />
                {wide && <text x={X(lane.p25)} y={top + pad - 3} textAnchor="middle" fontSize="8" style={{ ...sans, fill: AXIS }}>P25</text>}
                {wide && <text x={X(lane.p75)} y={top + pad - 3} textAnchor="middle" fontSize="8" style={{ ...sans, fill: AXIS }}>P75</text>}
              </>)}
              {/* median line — the 50th percentile — labeled and valued */}
              {hasBench && <line x1={X(lane.median)} x2={X(lane.median)} y1={top + pad} y2={top + laneH - pad} style={{ stroke: INK }} strokeWidth="2" />}
              {hasBench && <text x={X(lane.median)} y={top + pad - 3} textAnchor="middle" fontSize="8" fontWeight="600" style={{ ...sans, fill: INK }}>median</text>}
              {hasBench && <text x={X(lane.median)} y={top + laneH - pad + 11} textAnchor="middle" fontSize="9" fontWeight="600" style={{ ...mono, fill: INK }}>{fmtVal(lane.median, unit, undefined, cur)}</text>}
              {!hasBench && <text x={X(lane.points[0].value)} y={mid + 3} textAnchor="middle" fontSize="9" style={{ ...sans, fill: AXIS }}>no benchmark (n=1)</text>}
              {/* this lane's own scale endpoints — the row is scaled to [min, max] */}
              {hasBench && hi > lo && (<>
                <text x={PL} y={top + laneH - pad + 11} textAnchor="start" fontSize="9" style={{ ...mono, fill: AXIS }}>{fmtVal(lo, unit, undefined, cur)}</text>
                <text x={W - PR} y={top + laneH - pad + 11} textAnchor="end" fontSize="9" style={{ ...mono, fill: AXIS }}>{fmtVal(hi, unit, undefined, cur)}</text>
              </>)}
              {/* company dots (each a percentile position within the cohort) */}
              {lane.points.map((p) => {
                const cy = mid + jitterOf(p.id || p.label) * jit;
                const c = hasBench ? (p.value >= lane.median ? POS : NEG) : AXIS;
                const on = !hover || hover.id === (p.id || p.label);
                return (
                  <g key={p.id || p.label} onMouseEnter={() => setHover({ id: p.id || p.label, lane, p })}
                    onClick={() => onPointClick && onPointClick(p.id)} data-tip={tip(lane, p)} style={{ cursor: onPointClick ? "pointer" : "default" }}>
                    <circle cx={X(p.value)} cy={cy} r="5" fill={c} opacity={on ? 0.72 : 0.26} stroke={c} strokeWidth={on ? 0.5 : 0}
                      strokeDasharray={ax.isEdge(p.value) ? "3 2" : undefined} />
                    {labels && <text x={X(p.value)} y={cy - 8} textAnchor="middle" fontSize="9" style={{ ...mono, fill: INK }}>{p.label}</text>}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {/* legend — spells out how the percentile bands read */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 8, alignItems: "center", ...sans, fontSize: FS.micro, color: AXIS }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 22, height: 11, borderRadius: 2, background: "var(--ink-color-global-surface-lightgray-default)", border: `1px solid ${GRID}`, flex: "none" }} />
          middle 50% of companies (P25–P75)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 2, height: 13, background: "var(--ink-color-global-text-default)", flex: "none" }} />
          median (50th percentile)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: POS, flex: "none" }} />
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: NEG, flex: "none" }} />
          company — above / below the cohort median
        </span>
        <span style={{ fontStyle: "italic" }}>each row scaled to its own cohort range (min–max labeled per row)</span>
      </div>
      {hover && (
        <div style={{ ...mono, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 4 }}>
          <strong style={{ color: "var(--ink-color-global-text-default)" }}>{hover.p.label}</strong> · {fmtVal(hover.p.value, unit, undefined, hover.p.cur || cur)}
          {hover.p.vsMedian != null && <> · {fmtPct(hover.p.vsMedian)} vs {hover.lane.label} median</>}
          {hover.p.quartile && <> · Q{hover.p.quartile}</>}
        </div>
      )}
    </div>
  );
}

/* ---------- Heatmap (company × period, colored by value) ---------- */
/** Diverging low→neutral→high around zero, scaled by `absMax`. `palette` names a
 *  HEAT_PALETTES entry (defaults to the historic red→green). */
export function divergeColor(v, absMax, palette) {
  if (v == null || !Number.isFinite(v) || !absMax) return "var(--ink-color-global-surface-lightgray-default)";
  const t = Math.max(-1, Math.min(1, v / absMax));
  const p = HEAT_PALETTES[palette] || HEAT_PALETTES.redGreen;
  const mix = (a, b, k) => a.map((c, i) => Math.round(c + (b[i] - c) * k));
  const c = t >= 0 ? mix(p.mid, p.hi, t) : mix(p.mid, p.lo, -t);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * rows: [{ id, label, cells: { <colKey>: number } }]   cols: [{key,label}]
 * valueFmt(v) formats a cell; absMax caps the color scale (default = data max).
 */
export function Heatmap({ rows = [], cols = [], valueFmt = (v) => fmtVal(v, "Number"), absMax, cellW = 92, labelW = 190, rowHeader = "Company", rowHeaderHint, title, subtitle, chartId, ribbonOffset = 0 }) {
  const { prefs } = useChartPrefs(chartId);
  const wrapRef = useRef(null);
  const tableRef = useRef(null);
  const clone = useStickyClone(wrapRef, tableRef, ribbonOffset);
  const vals = rows.flatMap((r) => cols.map((c) => r.cells[c.key])).filter(Number.isFinite).map(Math.abs);
  const scale = absMax || (vals.length ? Math.max(...vals) : 1);
  if (!rows.length) return <div style={{ ...sans, padding: 24, textAlign: "center", color: AXIS, fontSize: FS.small }}>No data</div>;

  const colWidths = [labelW, ...cols.map(() => cellW)];
  // Shared between the real <thead> and its floating clone so the two markups can't drift apart.
  // Set directly on each <th>, not the <tr> — border-collapse stays "separate"
  // below, where a <tr>'s own border never renders.
  const HEADER_DIVIDER = "1px solid var(--ink-color-global-border-default)";
  const renderHead = () => (
    <tr>
      <th className="frozen-col" style={{ position: "sticky", left: 0, top: 0, zIndex: 4, textAlign: "left", borderBottom: HEADER_DIVIDER }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{rowHeader}{rowHeaderHint && <HintIcon hint={rowHeaderHint} />}</span>
      </th>
      {cols.map((c) => <th key={c.key} style={{ position: "sticky", top: 0, zIndex: 3, background: "var(--ink-color-global-surface-background-default)", textAlign: "center", borderBottom: HEADER_DIVIDER }}>{c.label}</th>)}
    </tr>
  );

  return (
    <div style={{ ...sans }}>
      {(title || subtitle) && (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <ChartHeading title={title} subtitle={subtitle} />
        </div>
      )}
      <div ref={wrapRef} style={{ overflowX: "auto" }}>
        {/* "separate" avoids a Chrome seam artifact between adjacent solid-color
            cells that border-collapse:collapse introduces at fractional widths. */}
        <table ref={tableRef} className="ledger no-row-lines" style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", ...sans }}>
          <colgroup>{colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>{renderHead()}</thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="no-row-hover">
                <td className="frozen-col" style={{ position: "sticky", left: 0, zIndex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</td>
                {cols.map((c) => {
                  const v = row.cells[c.key];
                  return (
                    <td key={c.key} style={{ background: divergeColor(v, scale, prefs.heatPalette), textAlign: "center", color: "var(--ink-color-global-text-default)", ...mono }}>
                      {v == null || !prefs.heatValues ? "" : valueFmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {clone && createPortal(
        // Portaled to document.body, outside the app root's inline font-family — must
        // set its own or it silently falls back to the browser's serif default.
        <div ref={clone.scrollRef} style={{ position: "fixed", top: clone.top, left: clone.left, width: clone.width, overflow: "hidden", zIndex: Z.stickyClone, ...sans }}>
          <table className="ledger sticky-clone" style={{ position: "static" }}>
            <colgroup>{clone.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>{renderHead()}</thead>
          </table>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ---------- Sparkline (minimal inline trend glance) ---------- */

// Month-ordinal of a "YYYY-MM-DD" period-end, for positioning a sparkline point
// on a shared date axis — NOT array index, so an actual and its overlaid
// forecast for the same period always land at the same x.
const sparkOrd = (d) => { const [y, m] = String(d).split("-").map(Number); return y * 12 + (m - 1); };

// `table.ledger td` in theme.js: 12px vertical padding around a 24px line box.
const CELL_PAD_Y = 12, CELL_LINE_H = 24;
// Svg edge to row divider. Added as padding, cancelled by an equal negative
// margin, so the grey reaches the divider without changing the row's height.
const panelBleed = (height) => CELL_PAD_Y + Math.max(0, (CELL_LINE_H - height) / 2);
// Keeps the line off the panel's left and right edges. Callers sizing a fixed
// slot for a sparkline must add it twice to the svg width.
export const SPARK_PANEL_PAD_X = 8;
const SPARK_PANEL_INSET_Y = 2;

/** Minimal inline SVG polyline — no axes, no labels, just "how's it trending".
 *  `points`/`overlay` are [{d,v}]. `overlay` shares both scales with `points`,
 *  so the same period lands at the same x in each. `dir` ("up"/"down") colours
 *  the line to match the caret beside it. Renders nothing under 2 finite points. */
export function Sparkline({ points = [], overlay = [], width = 120, height = 28, dir, panel = true }) {
  const clean = (points || []).filter((p) => p && Number.isFinite(p.v));
  const cleanOverlay = (overlay || []).filter((p) => p && Number.isFinite(p.v));
  if (clean.length < 2) return null;
  // Same tokens DeltaText uses, so a line and the caret beside it never disagree.
  const stroke = dir === "up" ? "var(--ink-color-global-feedback-positive-strong)"
    : dir === "down" ? "var(--ink-color-global-feedback-negative-strong)"
    : "var(--ink-color-global-link-default)";
  const allVals = [...clean, ...cleanOverlay].map((p) => p.v);
  let lo = Math.min(...allVals), hi = Math.max(...allVals);
  if (lo === hi) { hi += 1; lo -= 1; }
  const pad = 2, iw = width - pad * 2, ih = height - pad * 2;
  // shared date domain across both series, so they align period-to-period
  const allOrds = [...clean, ...cleanOverlay].map((p) => sparkOrd(p.d));
  const minOrd = Math.min(...allOrds), maxOrd = Math.max(...allOrds);
  const xOf = (d) => pad + (maxOrd === minOrd ? 0 : (sparkOrd(d) - minOrd) / (maxOrd - minOrd)) * iw;
  const yAt = (v) => pad + ih - ((v - lo) / (hi - lo)) * ih;
  const toPoints = (pts) => pts.map((p) => `${xOf(p.d)},${yAt(p.v)}`).join(" ");
  const svg = (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible" }}>
      <polyline points={toPoints(clean)} fill="none" stroke={stroke}
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {cleanOverlay.length >= 2 && (
        <polyline points={toPoints(cleanOverlay)} fill="none" stroke="var(--ink-color-global-text-subtle)"
          strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
      )}
    </svg>
  );
  if (!panel) return svg;
  // Inset from both row dividers. This is a child element's background, so unlike
  // a cell background it paints ON TOP of the collapsed <tr> border — it has to
  // stop short of the grid line at both ends or the row rule looks broken.
  const padY = Math.max(0, panelBleed(height) - SPARK_PANEL_INSET_Y);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", background: SPARK_PANEL,
      marginTop: -padY, marginBottom: -padY, paddingTop: padY, paddingBottom: padY,
      paddingLeft: SPARK_PANEL_PAD_X, paddingRight: SPARK_PANEL_PAD_X }}>
      {svg}
    </span>
  );
}

// ── Inline trend sparkline (area + line) ─────────────────────────────────────
// Fixed box, never measured, so every row's sparkline starts on the same x.
export const TREND_SPARK_W = 72, TREND_SPARK_H = 26;
// TS_TOP and the 0.5 x-inset keep the 1.8 stroke inside the box.
const TS_BASE = 25, TS_TOP = 1, TS_X0 = 0.5, TS_X1 = 71.5;
// Shared-scale geometry: 0% sits mid-box, so every row starts at the same y.
const TS_MID = (TS_BASE + TS_TOP) / 2, TS_HALF = (TS_BASE - TS_TOP) / 2;
// Raw hex, not Ink tokens — a fixed data palette, like QUADRANTS. The gradients
// cannot adapt to dark mode, so the % and caret carry the signal, not the shape.
export const TREND_UP = "#3BA570", TREND_DOWN = "#D8432A";
export const TREND_GRAD_UP = "pa-trend-grad-up", TREND_GRAD_DOWN = "pa-trend-grad-down";

/** The two area gradients, defined once per page and referenced by id. Mount
 *  near the app root — a <defs> per sparkline restates these on every row. */
export function TrendSparklineDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <linearGradient id={TREND_GRAD_UP} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TREND_UP} stopOpacity="0.34" />
          <stop offset="100%" stopColor={TREND_UP} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={TREND_GRAD_DOWN} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TREND_DOWN} stopOpacity="0.32" />
          <stop offset="100%" stopColor={TREND_DOWN} stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// 2dp is plenty at this size, and keeps path strings short and diffable.
const tsRound = (n) => Math.round(n * 100) / 100;

/** Largest move away from a series' own first value, as a percent. null when it
 *  cannot be indexed — under 2 points, or a zero base with no ratio to take. */
export function indexedSwing(points) {
  const clean = (points || []).filter((p) => p && Number.isFinite(p.v));
  if (clean.length < 2) return null;
  const v0 = clean[0].v;
  if (v0 === 0) return null;
  return Math.max(...clean.map((p) => Math.abs((p.v - v0) / Math.abs(v0)) * 100));
}

/** One domain for a whole column of sparklines, so their heights are comparable.
 *  Linear: these are all one quarter's change in percent, so the span is tight
 *  and a root would misstate it. Null falls back to per-row scaling. */
export function sharedScaleRef(swings) {
  const v = (swings || []).filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? Math.max(...v) : null;
}

/** Inline trend sparkline: a gradient area under a hard, angular line.
 *  Straight segments only — a spline would round off the quarter-to-quarter
 *  moves the shape exists to show. Decorative (aria-hidden): colour alone is not
 *  an accessible signal, so the % and caret beside it carry the meaning.
 *  Renders nothing under 2 finite points, leaving its grid column empty. */
export function TrendSparkline({ points = [], dir, scaleRef }) {
  const clean = (points || []).filter((p) => p && Number.isFinite(p.v));
  if (clean.length < 2) return null;
  const ords = clean.map((p) => sparkOrd(p.d));
  const minOrd = Math.min(...ords), maxOrd = Math.max(...ords);
  const xOf = (d) => TS_X0 + (maxOrd === minOrd ? 0 : (sparkOrd(d) - minOrd) / (maxOrd - minOrd)) * (TS_X1 - TS_X0);
  const v0 = clean[0].v;
  // A shared reference makes height mean something across the column. Without
  // one each row fills its own box, so a 1% and an 18% move draw identically.
  const shared = Number.isFinite(scaleRef) && scaleRef > 0 && v0 !== 0;
  let ys;
  if (shared) {
    ys = clean.map((p) => {
      const pct = ((p.v - v0) / Math.abs(v0)) * 100;
      const y = TS_MID - (pct / scaleRef) * TS_HALF;
      // Clip an outlier rather than let it flatten every other row.
      return Math.min(TS_BASE, Math.max(TS_TOP, y));
    });
  } else {
    const vals = clean.map((p) => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { hi += 1; lo -= 1; }   // a flat series draws through the middle
    ys = clean.map((p) => TS_BASE - ((p.v - lo) / (hi - lo)) * (TS_BASE - TS_TOP));
  }
  const xy = clean.map((p, i) => [tsRound(xOf(p.d)), tsRound(ys[i])]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  // Same path closed to the baseline, so area and line never disagree.
  const area = `${line} L${xy[xy.length - 1][0]} ${TS_BASE} L${xy[0][0]} ${TS_BASE} Z`;
  // No direction means no trend to colour: draw neutral and unfilled rather
  // than pick a hue the data does not support.
  const known = dir === "up" || dir === "down";
  return (
    <svg width={TREND_SPARK_W} height={TREND_SPARK_H} viewBox={`0 0 ${TREND_SPARK_W} ${TREND_SPARK_H}`}
      aria-hidden="true" focusable="false" style={{ display: "block", overflow: "visible" }}>
      {known && <path d={area} stroke="none"
        fill={`url(#${dir === "up" ? TREND_GRAD_UP : TREND_GRAD_DOWN})`} />}
      <path d={line} fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
        className={known ? (dir === "up" ? "spark-line-up" : "spark-line-down") : undefined}
        stroke={known ? undefined : "var(--ink-color-global-text-subtle)"} />
    </svg>
  );
}

// ── Portfolio quadrant scatter ───────────────────────────────────────────────
// Plot box in viewBox units. Height derives from width, so the plot column must
// never share a flex row with a fixed-width sibling or the chart collapses.
const Q_X0 = 20, Q_X1 = 1180, Q_Y0 = 14, Q_Y1 = 566, Q_VB_H = 580, Q_VB_W = 1200;
// Dash : gap in viewBox units. Tighter than the handoff's "8 7" — at render width
// that near-1:1 ratio read as a dotted line rather than a median rule.
const Q_MEDIAN_DASH = "8 4";
// Ink's real data-viz tokens (theme-with-ink/tokens.css) — good/bad quadrants
// take the semantic positive/negative series colors; the two mixed quadrants
// take two of the remaining categorical hues. Ink has no pink data-viz token.
export const QUADRANTS = [
  { key: "hh", label: "High / High",    color: "var(--ink-color-global-data-viz-positive-3)" },
  { key: "hl", label: "High X / Low Y", color: "var(--ink-color-global-data-viz-turquoise-3)" },
  { key: "lh", label: "Low X / High Y", color: "var(--ink-color-global-data-viz-blue-3)" },
  { key: "ll", label: "Low / Low",      color: "var(--ink-color-global-data-viz-negative-3)" },
];

/** Round tick steps so the grid reads like graph paper. The returned bounds also
 *  define the plotted domain, so no bubble ever sits on an axis edge. */
export function niceTicks(lo, hi, target) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const raw = (hi - lo) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step * 0.001; v += step) {
    out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  }
  return out;
}

// Deterministic so the layout is identical across renders — a random jitter would
// make bubbles twitch on every keystroke elsewhere in the page.
const qHash = (i, salt) => { const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); };

/** Portfolio triage scatter: every company a bubble, dashed lines at the portfolio
 *  medians, colour by quadrant and area by `size`. `points` is
 *  [{id,label,x,y,size,cur}] where x is already a growth ratio. */
export function QuadrantScatter({ points = [], xLabel = "", yLabel = "", yMode = "value",
  yUnit = "Number", yCur, sizeLabel = "", sizeUnit = "Dollar", sizeCur, title, subtitle, filters,
  totalCandidates, excludedNote, onSelect, onRemove }) {
  const [quad, setQuad] = useState(null);
  const [hover, setHover] = useState(-1);
  // Whether the pointer is on the × badge vs the bubble body — the two clicks do
  // different things (remove vs open), so each target gets its own hover feedback.
  const [onBadge, setOnBadge] = useState(false);
  const svgRef = useRef(null);
  const SUBTLE = "var(--ink-color-global-text-subtle)";
  const GRID = "var(--ink-color-global-border-subtle)";

  const plot = useMemo(() => {
    const clean = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    // No early bail on empty — niceTicks/median() fall back, so the frame still draws with zero dots.
    // Display-only jitter so exact ties don't stack; tooltips report true values.
    const xs = clean.map((p, i) => p.x + (qHash(i, 41) - 0.5) * 0.005);
    const ys = clean.map((p, i) => p.y * (1 + (qHash(i, 57) - 0.5) * 0.02));
    // Finite dummy bounds (not Infinity/-Infinity from an empty min/max) so
    // niceTicks draws a real multi-line grid instead of its 2-point fallback.
    const xT = clean.length ? niceTicks(Math.min(...xs), Math.max(...xs), 6) : niceTicks(0, 1, 6);
    const yT = clean.length ? niceTicks(Math.min(...ys), Math.max(...ys), 5) : niceTicks(0, 1, 5);
    const xMin = xT[0], xMax = xT[xT.length - 1], yMin = yT[0], yMax = yT[yT.length - 1];
    const sx = (v) => Q_X0 + ((v - xMin) / (xMax - xMin || 1)) * (Q_X1 - Q_X0);
    const sy = (v) => Q_Y1 - ((v - yMin) / (yMax - yMin || 1)) * (Q_Y1 - Q_Y0);
    const xMed = median(xs), yMed = median(ys);
    const quadOf = (i) => (xs[i] >= xMed ? (ys[i] >= yMed ? "hh" : "hl") : (ys[i] >= yMed ? "lh" : "ll"));
    const sizes = clean.map((p) => (Number.isFinite(p.size) && p.size > 0 ? p.size : 0));
    const sizeMax = Math.max(...sizes, 0);
    // Area-proportional, floored so the smallest company stays clickable. `size`
    // is always one of `sizes`, so it can never exceed sizeMax — no clamp needed.
    const rOf = (size) => 10 + (sizeMax > 0 && Number.isFinite(size) && size > 0 ? Math.sqrt(size / sizeMax) : 0) * 40;
    const counts = { hh: 0, hl: 0, lh: 0, ll: 0 };
    const dots = clean.map((p, i) => {
      const q = quadOf(i);
      counts[q]++;
      return { i, p, q, cx: sx(xs[i]), cy: sy(ys[i]), r: rOf(sizes[i]),
        color: QUADRANTS.find((qq) => qq.key === q).color };
    });
    // Dot-grid background (theme-with-ink/charts.md): keyed to the same axis
    // positions as the ticks, so the grid and axis can never disagree.
    const gridDots = [];
    for (const gx of subdivide(xT.map(sx))) for (const gy of subdivide(yT.map(sy))) gridDots.push({ x: gx, y: gy });
    return { dots: dots.slice().sort((a, b) => b.r - a.r), xT, yT, sx, sy, sizeMax, gridDots,
      medianX: sx(xMed), medianY: sy(yMed), counts, total: clean.length, isEmpty: !clean.length };
  }, [points, yMode]);

  // Right-aligns to the plot's own data area (Q_X1), not the full card width —
  // the axis gutter (98px ≈ the y-tick column + gap) means the two differ.
  const plotRightPad = `calc((100% - 98px) * ${(Q_VB_W - Q_X1) / Q_VB_W})`;

  const header = (
    <div style={{ padding: "4px 0 20px" }}>
      <ChartHeading title={title} subtitle={subtitle} wrap subtitleTestId="quadrant-subtitle" />
    </div>
  );

  const { dots, xT, yT, sx, sy, sizeMax, gridDots, medianX, medianY, counts, total, isEmpty } = plot;
  const yFmt = (v) => (yMode === "growth" ? fmtVal(v, "Percentage") : fmtVal(v, yUnit, null, yCur));
  const shown = quad ? counts[quad] : total;
  const excluded = Number.isFinite(totalCandidates) ? Math.max(0, totalCandidates - total) : 0;
  const hovered = hover > -1 ? dots.find((d) => d.i === hover) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {header}

      {filters && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 20 }}>
          {filters}
          <ChartTools svgRef={svgRef} name={slug(title || "portfolio-triage")} meta={{ title, subtitle }} compact={false} />
        </div>
      )}

      {/* Y-axis title, right-aligned to the tick-number column directly below it. */}
      <div style={{ display: "flex", gap: 8, paddingBottom: 6 }}>
        <div style={{ flex: "0 0 82px", textAlign: "right", ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-text-default)" }}>
          {yLabel}{yMode === "growth" ? " — QoQ growth" : ""}
        </div>
        <div style={{ flex: "1 1 auto" }} />
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
        <div style={{ flex: "0 0 82px", position: "relative" }}>
          {/* Placeholder [0,1] ticks in the empty state have no real values to
              show — the grid still draws, just without misleading numbers. */}
          {!isEmpty && yT.map((v) => (
            <div key={v} style={{ ...sans, position: "absolute", right: 0, top: `${(sy(v) / Q_VB_H) * 100}%`,
              transform: "translateY(-50%)", fontSize: FS.bodyLg, color: SUBTLE, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {yFmt(v)}
            </div>
          ))}
        </div>
        <div style={{ flex: "1 1 auto", minWidth: 0, position: "relative" }}>
          <svg ref={svgRef} data-testid="quadrant-plot-svg" viewBox={`0 0 ${Q_VB_W} ${Q_VB_H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
            {/* Dot grid stands in for gridlines (theme-with-ink/charts.md) — paints first, everything else on top. */}
            {gridDots.map((d, i) => <rect key={i} x={d.x - 0.8} y={d.y - 0.8} width="1.6" height="1.6" style={{ fill: GRID }} />)}
            {/* X is continuous, so it keeps a baseline + a tick per band; Y never gets a line, labels only. */}
            <line x1={Q_X0} y1={Q_Y1} x2={Q_X1} y2={Q_Y1} stroke={GRID} strokeWidth="1" />
            {xT.map((v) => <line key={`t${v}`} x1={sx(v)} y1={Q_Y1} x2={sx(v)} y2={Q_Y1 + 6} stroke={GRID} strokeWidth="1" />)}
            {!isEmpty && (
              <>
                <line x1={Q_X0} y1={medianY} x2={Q_X1} y2={medianY} stroke="var(--ink-color-global-text-very-subtle, var(--ink-color-global-text-subtle))" strokeWidth="1.5" strokeDasharray={Q_MEDIAN_DASH} />
                <line x1={medianX} y1={Q_Y0} x2={medianX} y2={Q_Y1} stroke="var(--ink-color-global-text-very-subtle, var(--ink-color-global-text-subtle))" strokeWidth="1.5" strokeDasharray={Q_MEDIAN_DASH} />
              </>
            )}
            {/* Largest first, so a small bubble is never buried under a big one.
                Circle + remove badge share one <g> that owns the hover handlers, so
                moving the pointer from bubble to badge never trips a mouseleave. */}
            {dots.map((d) => {
              const showRemove = onRemove && hover === d.i;
              // Ring the bubble only while the body is the click target — it drops
              // the moment the pointer crosses onto the × so the two never both cue.
              const bodyActive = hover === d.i && !onBadge;
              // Badge sits on the bubble's top-right edge (45° out from center).
              const bx = d.cx + d.r * 0.7071, by = d.cy - d.r * 0.7071;
              const bR = onBadge ? 11 : 9;
              return (
                <g key={d.p.id} onMouseEnter={() => setHover(d.i)}
                  onMouseLeave={() => { setHover(-1); setOnBadge(false); }}>
                  <circle cx={d.cx} cy={d.cy} r={d.r}
                    stroke={bodyActive ? "var(--ink-color-global-link-default)" : "none"}
                    strokeWidth={bodyActive ? 2.5 : 0}
                    style={{ fill: d.color, cursor: "pointer", transition: "opacity .12s ease, stroke-width .1s ease" }}
                    opacity={(quad && quad !== d.q) || (hover > -1 && hover !== d.i) ? 0.16 : 0.62}
                    onClick={() => onSelect && onSelect(d.p.id)}
                    role="img" aria-label={d.p.label} />
                  {showRemove && (
                    <g role="button" tabIndex={0} aria-label={`Remove ${d.p.label} from chart`}
                      data-testid={`quadrant-remove-${d.p.id}`} style={{ cursor: "pointer" }}
                      onMouseEnter={() => setOnBadge(true)} onMouseLeave={() => setOnBadge(false)}
                      onClick={(e) => { e.stopPropagation(); onRemove(d.p.id); }}>
                      <title>{`Remove ${d.p.label} from chart`}</title>
                      <circle cx={bx} cy={by} r={bR}
                        style={{ fill: onBadge ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-button-background-color-primary-base-default)", transition: "r .1s ease" }} />
                      <line x1={bx - 3.5} y1={by - 3.5} x2={bx + 3.5} y2={by + 3.5}
                        stroke="var(--ink-button-font-color-primary-base)" strokeWidth="1.6" strokeLinecap="round" />
                      <line x1={bx + 3.5} y1={by - 3.5} x2={bx - 3.5} y2={by + 3.5}
                        stroke="var(--ink-button-font-color-primary-base)" strokeWidth="1.6" strokeLinecap="round" />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {hovered && (
            <div style={{ position: "absolute", left: `${(hovered.cx / Q_VB_W) * 100}%`, top: `${((hovered.cy - hovered.r - 6) / Q_VB_H) * 100}%`,
              transform: "translate(-50%, -100%)", pointerEvents: "none", zIndex: 5, padding: "8px 10px", borderRadius: 4,
              background: "var(--ink-button-background-color-primary-base-default)", boxShadow: "0 2px 8px rgba(26,26,26,.18)", whiteSpace: "nowrap" }}>
              <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, color: "var(--ink-button-font-color-primary-base)" }}>{hovered.p.label}</div>
              <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-button-font-color-primary-base)", opacity: 0.78, fontVariantNumeric: "tabular-nums" }}>
                {xLabel} growth {fmtVal(hovered.p.x, "Percentage")} · {yLabel} {yFmt(hovered.p.y)}
                {Number.isFinite(hovered.p.size) ? ` · ${sizeLabel} ${fmtVal(hovered.p.size, sizeUnit, null, sizeCur)}` : ""}
              </div>
              {/* Name the action for whichever target the pointer is on — the × and the
                  bubble body do different things, so the hint changes with the target. */}
              {(onRemove || onSelect) && (
                <div style={{ ...sans, fontSize: FS.small, fontWeight: 600, marginTop: 4,
                  color: onBadge ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-button-font-color-primary-base)" }}>
                  {onBadge ? "Click ✕ to remove from chart" : (onSelect ? "Click to open company →" : "")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ paddingLeft: 90 }}>
        {/* Left-positioned only, never percentage `top` — that is what stops the
            labels colliding when the chart is short. */}
        <div style={{ position: "relative", height: 20 }}>
          {!isEmpty && xT.map((v) => (
            <div key={v} style={{ ...sans, position: "absolute", left: `${(sx(v) / Q_VB_W) * 100}%`, transform: "translateX(-50%)",
              fontSize: FS.bodyLg, color: SUBTLE, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {fmtVal(v, "Percentage")}
            </div>
          ))}
        </div>
      </div>
      {/* X-axis title, right-aligned to the plot's own right edge (same padding
          formula as the y-axis title's column width, mirrored for x). */}
      <div style={{ display: "flex", justifyContent: "flex-end", paddingRight: plotRightPad, paddingTop: 2 }}>
        <div style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-text-default)" }}>{xLabel} — QoQ growth</div>
      </div>

      {/* Legend — quadrant colors, the median-line convention, and the bubble-size
          key — all live below the chart, not competing with it for headroom above. */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "10px 24px", paddingTop: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 20px", ...sans, fontSize: FS.small, color: SUBTLE }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="18" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="17" y2="5" style={{ stroke: SUBTLE }} strokeWidth="1.5" strokeDasharray={Q_MEDIAN_DASH} />
            </svg>
            Portfolio median
          </span>
          {/* Gated on sizeLabel (a metric was chosen), not sizeMax > 0 — a chosen
              metric that's all-zero for the current filter still names itself. */}
          {sizeLabel && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <svg width="10" height="10" aria-hidden="true">
                <circle cx="5" cy="5" r="4.5" fill="none" style={{ stroke: SUBTLE }} strokeWidth="1" />
              </svg>
              Bubble size = {sizeLabel}
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: 4, borderRadius: 6,
          background: "var(--ink-color-global-surface-lightgray-default)" }}>
          {QUADRANTS.map((q) => (
            <button key={q.key} className="toolbar-btn" onClick={() => setQuad(quad === q.key ? null : q.key)}
              aria-pressed={quad === q.key} title={`${counts[q.key]} companies — click to isolate`}
              style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px",
                border: "none", borderRadius: 4, fontSize: FS.bodyLg, cursor: "pointer",
                background: quad === q.key ? "var(--ink-color-global-surface-lightgray-default)" : "transparent",
                color: "var(--ink-color-global-text-default)" }}>
              <span style={{ width: 11, height: 11, borderRadius: "50%", background: q.color, flex: "none",
                opacity: quad && quad !== q.key ? 0.35 : 1 }} />
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* Says outright how many companies never make it onto the chart. A plot
          that silently drops most of the book reads as the whole book. */}
      <div data-testid="quadrant-plotted" style={{ ...sans, fontSize: FS.small, color: SUBTLE, paddingTop: 14 }}
        title={excluded > 0 ? "A company needs a current and a prior period on both metrics to be plotted." : undefined}>
        {quad ? `${shown} of ${total} companies plotted`
          : excluded > 0 ? `${total} of ${totalCandidates} companies plotted`
          : `${total} companies plotted`}
        {excluded > 0 && excludedNote ? ` — ${excludedNote}` : ""}
      </div>
    </div>
  );
}
