/* =========================================================================
   DESIGN SYSTEM — CHARTS
   -------------------------------------------------------------------------
   Three chart primitives that consume design-system tokens at render time.

   Usage:
     <div data-ds-chart="line"   data-config='{...}'></div>
     <div data-ds-chart="donut"  data-config='{...}'></div>
     <div data-ds-chart="hbar"   data-config='{...}'></div>

     DSCharts.renderAll();              // render every chart on the page
     DSCharts.render(rootElement);      // render charts inside a subtree
     DSCharts.refreshAll();              // re-read tokens & re-render

   Charts read tokens via getComputedStyle from the chart's nearest
   slide (or the chart node itself), so .ds-dark / .ds-alt sections theme
   correctly without per-chart configuration.
   ========================================================================= */

(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* --- token reader: walks up to find the slide context --- */
  function tokenContext(el) {
    // prefer the nearest ds-slide variant element so .ds-dark scoping works,
    // fall back to the chart node itself.
    return el.closest('.ds-dark, .ds-alt, .ds-slide, section') || el;
  }
  function tok(el, name, fallback) {
    const v = getComputedStyle(tokenContext(el)).getPropertyValue(name).trim();
    return v || fallback || '';
  }
  function fontFamily(el) {
    return tok(el, '--ds-font-body', 'sans-serif');
  }

  /* --- helpers --- */
  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function readConfig(host) {
    const raw = host.getAttribute('data-config') || '{}';
    try { return JSON.parse(raw); }
    catch (e) { console.warn('[DSCharts] bad data-config on', host, e); return {}; }
  }

  /* =====================================================================
     LINE CHART
     ---------------------------------------------------------------------
     config = {
       width, height,                     // svg viewBox (default 920x300)
       padding: {top,right,bottom,left},  // default {20,20,40,60}
       xLabels: ["2020","2021",...],      // strings on x axis
       yLabels: ["1.0×","1.5×",...],      // top→bottom strings on y axis
       gridLines: 4,                      // number of horizontal gridlines
       series: [
         {
           name: "Example Firm",
           color: "var(--ds-chart-series-1)",   // optional; defaults to series order
           values: [1.0, 1.1, 1.4, ...],        // length = xLabels.length
           dashed: false,                       // optional
           area: true,                          // optional fill under
           dots: true,                          // optional point dots
           highlightLast: true,                 // optional bigger end-dot
           endLabel: "2.4×"                     // optional callout at end
         },
         ...
       ],
       yDomain: [min, max]                // value range for scaling
     }
     ===================================================================== */

  function renderLine(host) {
    const cfg = Object.assign({
      width: 920,
      height: 300,
      padding: { top: 20, right: 20, bottom: 40, left: 60 },
      gridLines: 4,
      xLabels: [],
      yLabels: [],
      yDomain: [0, 1],
      series: []
    }, readConfig(host));

    const W = cfg.width, H = cfg.height;
    const P = Object.assign({ top: 20, right: 20, bottom: 40, left: 60 }, cfg.padding || {});
    const innerW = W - P.left - P.right;
    const innerH = H - P.top - P.bottom;
    const x0 = P.left, y0 = P.top;
    const xN = cfg.xLabels.length;

    const xAt = (i) => xN <= 1 ? x0 + innerW / 2 : x0 + (i / (xN - 1)) * innerW;
    const [yMin, yMax] = cfg.yDomain;
    const yAt = (v) => y0 + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    const seriesColors = [
      tok(host, '--ds-chart-series-1'),
      tok(host, '--ds-chart-series-2'),
      tok(host, '--ds-chart-series-3'),
      tok(host, '--ds-chart-series-4'),
      tok(host, '--ds-chart-series-5')
    ];

    const axisColor = tok(host, '--ds-chart-axis');
    const gridColor = tok(host, '--ds-chart-grid');
    const textColor = tok(host, '--ds-chart-text');
    const textStrong = tok(host, '--ds-chart-text-strong');
    const bgColor   = tok(host, '--ds-chart-bg');
    const ff        = fontFamily(host);

    clear(host);
    const svg = svgEl('svg', {
      class: 'ds-chart',
      viewBox: `0 0 ${W} ${H}`,
      width: '100%',
      height: H,
      preserveAspectRatio: 'xMidYMid meet'
    });

    // gridlines
    const nGrid = cfg.gridLines;
    for (let i = 0; i < nGrid; i++) {
      const y = y0 + (i / nGrid) * innerH;
      svg.appendChild(svgEl('line', {
        x1: x0, x2: x0 + innerW, y1: y, y2: y,
        stroke: gridColor, 'stroke-width': 1, 'stroke-dasharray': '2 4'
      }));
    }
    // axis line
    svg.appendChild(svgEl('line', {
      x1: x0, x2: x0 + innerW, y1: y0 + innerH, y2: y0 + innerH,
      stroke: axisColor, 'stroke-width': 1
    }));

    // y labels (top→bottom)
    cfg.yLabels.forEach((lbl, i) => {
      const t = svgEl('text', {
        x: x0 - 12,
        y: y0 + (i / Math.max(1, cfg.yLabels.length - 1)) * innerH + 4,
        'text-anchor': 'end',
        'font-family': ff, 'font-size': 13,
        fill: textColor, 'letter-spacing': '0.06em'
      });
      t.textContent = lbl;
      svg.appendChild(t);
    });

    // x labels
    cfg.xLabels.forEach((lbl, i) => {
      const t = svgEl('text', {
        x: xAt(i), y: y0 + innerH + 22,
        'text-anchor': 'middle',
        'font-family': ff, 'font-size': 13,
        fill: textColor, 'letter-spacing': '0.06em'
      });
      t.textContent = lbl;
      svg.appendChild(t);
    });

    // series
    cfg.series.forEach((s, idx) => {
      const color = s.color || seriesColors[idx % seriesColors.length];
      const points = s.values.map((v, i) => [xAt(i), yAt(v)]);

      // area
      if (s.area) {
        const d = `M ${points[0][0]} ${points[0][1]} ` +
                  points.slice(1).map(p => `L ${p[0]} ${p[1]}`).join(' ') +
                  ` L ${points[points.length-1][0]} ${y0 + innerH}` +
                  ` L ${points[0][0]} ${y0 + innerH} Z`;
        svg.appendChild(svgEl('path', {
          d, fill: color, opacity: 0.08
        }));
      }

      // line
      const lineD = `M ${points[0][0]} ${points[0][1]} ` +
                    points.slice(1).map(p => `L ${p[0]} ${p[1]}`).join(' ');
      const linePath = svgEl('path', {
        d: lineD, fill: 'none', stroke: color,
        'stroke-width': s.dashed ? 2 : 2.5,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      });
      if (s.dashed) linePath.setAttribute('stroke-dasharray', '4 4');
      svg.appendChild(linePath);

      // dots
      if (s.dots) {
        points.forEach(([x, y], i) => {
          const isLast = i === points.length - 1 && s.highlightLast;
          svg.appendChild(svgEl('circle', {
            cx: x, cy: y, r: isLast ? 6 : 4,
            fill: isLast ? color : bgColor,
            stroke: isLast ? bgColor : color,
            'stroke-width': isLast ? 3 : 2.5
          }));
        });
      }

      // end label
      if (s.endLabel) {
        const last = points[points.length - 1];
        const t = svgEl('text', {
          x: last[0], y: y0 + 14,
          'text-anchor': 'end',
          'font-family': ff, 'font-size': 16,
          'font-weight': 500, fill: textStrong,
          'letter-spacing': '-0.01em'
        });
        t.textContent = s.endLabel;
        svg.appendChild(t);
      }
    });

    host.appendChild(svg);
  }

  /* =====================================================================
     DONUT CHART
     ---------------------------------------------------------------------
     config = {
       size: 480,                      // svg viewBox (square)
       radius: 180,                    // donut center-line radius
       thickness: 68,                  // ring stroke width
       gap: 0.5,                       // separator-arc length in px
       segments: [
         { label: "Software",       value: 62, color: "var(--ds-cat-1)" },
         { label: "Sustainability", value: 28 },           // auto-color
         ...
       ],
       centerLabel: "Active companies",
       centerNumber: "142"
     }
     ===================================================================== */

  function renderDonut(host) {
    const cfg = Object.assign({
      size: 480,
      radius: 180,
      thickness: 68,
      gap: 0.5,
      segments: [],
      centerLabel: '',
      centerNumber: ''
    }, readConfig(host));

    const cx = cfg.size / 2, cy = cfg.size / 2;
    const C = 2 * Math.PI * cfg.radius;
    const total = cfg.segments.reduce((s, x) => s + x.value, 0) || 1;

    const cats = [
      tok(host, '--ds-cat-1'),
      tok(host, '--ds-cat-2'),
      tok(host, '--ds-cat-3'),
      tok(host, '--ds-cat-4'),
      tok(host, '--ds-cat-5')
    ];
    const bgColor    = tok(host, '--ds-chart-bg');
    const muteColor  = tok(host, '--ds-chart-text');
    const strongColor = tok(host, '--ds-chart-text-strong');
    const ff = fontFamily(host);

    clear(host);
    const svg = svgEl('svg', {
      class: 'ds-chart',
      viewBox: `0 0 ${cfg.size} ${cfg.size}`,
      width: '100%', height: 'auto',
      preserveAspectRatio: 'xMidYMid meet'
    });

    // ring group rotated so first segment starts at the top
    const g = svgEl('g', { transform: `rotate(-90 ${cx} ${cy})` });

    // arcs
    let offset = 0;
    cfg.segments.forEach((seg, i) => {
      const arcLen = (seg.value / total) * C;
      const color = seg.color || cats[i % cats.length];
      g.appendChild(svgEl('circle', {
        cx, cy, r: cfg.radius, fill: 'none',
        stroke: color, 'stroke-width': cfg.thickness,
        'stroke-dasharray': `${arcLen} ${C - arcLen}`,
        'stroke-dashoffset': -offset
      }));
      offset += arcLen;
    });

    // separator slivers between arcs (bg-colored)
    offset = 0;
    cfg.segments.forEach((seg) => {
      const arcLen = (seg.value / total) * C;
      g.appendChild(svgEl('circle', {
        cx, cy, r: cfg.radius, fill: 'none',
        stroke: bgColor, 'stroke-width': 3,
        'stroke-dasharray': `${cfg.gap} ${C - cfg.gap}`,
        'stroke-dashoffset': -offset
      }));
      offset += arcLen;
    });

    svg.appendChild(g);

    // center text — size to inner ring, center the two-line block around cy
    if (cfg.centerLabel || cfg.centerNumber) {
      const innerR  = cfg.radius - cfg.thickness / 2;
      const numSize = Math.min(60, Math.floor(innerR * 0.7));

      if (cfg.centerLabel && cfg.centerNumber) {
        // two-line block: label above, number below, visual centroid at cy
        const labelY = cy + 1 - Math.round(numSize * 0.36);
        const numY   = cy + 19 + Math.round(numSize * 0.36);

        const lbl = svgEl('text', {
          x: cx, y: labelY, 'text-anchor': 'middle',
          'font-family': ff, 'font-size': 13, 'font-weight': 500,
          'letter-spacing': '0.18em', fill: muteColor
        });
        lbl.style.textTransform = 'uppercase';
        lbl.textContent = cfg.centerLabel;
        svg.appendChild(lbl);

        const num = svgEl('text', {
          x: cx, y: numY, 'text-anchor': 'middle',
          'font-family': ff, 'font-size': numSize, 'font-weight': 200,
          'letter-spacing': '-0.04em', fill: strongColor
        });
        num.textContent = cfg.centerNumber;
        svg.appendChild(num);

      } else if (cfg.centerLabel) {
        const lbl = svgEl('text', {
          x: cx, y: cy + 5, 'text-anchor': 'middle',
          'font-family': ff, 'font-size': 14, 'font-weight': 500,
          'letter-spacing': '0.18em', fill: muteColor
        });
        lbl.style.textTransform = 'uppercase';
        lbl.textContent = cfg.centerLabel;
        svg.appendChild(lbl);

      } else {
        // number only — centered at cy
        const num = svgEl('text', {
          x: cx, y: cy + Math.round(numSize * 0.36), 'text-anchor': 'middle',
          'font-family': ff, 'font-size': numSize, 'font-weight': 200,
          'letter-spacing': '-0.04em', fill: strongColor
        });
        num.textContent = cfg.centerNumber;
        svg.appendChild(num);
      }
    }

    host.appendChild(svg);
  }

  /* =====================================================================
     HORIZONTAL BAR CHART
     ---------------------------------------------------------------------
     config = {
       rows: [
         { label: "AI & infrastructure", value: 118, valueLabel: "$118M", series: 1 },
         { label: "Sustainability",      value: 48,  valueLabel: "$48M",  series: 2 },
         ...
       ],
       max: 118,             // optional; auto = max(value)
       showRules: true       // hairline between rows
     }
     ===================================================================== */

  function renderHbar(host) {
    const cfg = Object.assign({
      rows: [],
      max: null,
      showRules: true
    }, readConfig(host));

    const max = cfg.max != null ? cfg.max : cfg.rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;

    clear(host);
    const frag = document.createDocumentFragment();
    cfg.rows.forEach((row, i) => {
      const pct = (row.value / max) * 100;
      const r = document.createElement('div');
      r.className = 'ds-hbar-row';
      r.innerHTML =
        `<div class="ds-hbar-row__label">${row.label}</div>` +
        `<div class="ds-hbar-track" data-series="${row.series || 1}"><div class="ds-hbar-track__fill" style="width:${pct}%"></div></div>` +
        `<div class="ds-hbar-row__value">${row.valueLabel != null ? row.valueLabel : row.value}</div>`;
      frag.appendChild(r);
      if (cfg.showRules && i < cfg.rows.length - 1) {
        const rule = document.createElement('div');
        rule.className = 'ds-rule';
        frag.appendChild(rule);
      }
    });
    host.appendChild(frag);
  }

  /* --- public dispatch --- */
  const KIND = {
    line:  renderLine,
    donut: renderDonut,
    hbar:  renderHbar
  };

  function renderOne(host) {
    const kind = host.getAttribute('data-ds-chart');
    const fn = KIND[kind];
    if (!fn) { console.warn('[DSCharts] unknown chart kind:', kind); return; }
    fn(host);
  }

  function render(root) {
    (root || document).querySelectorAll('[data-ds-chart]').forEach(renderOne);
  }
  function renderAll() { render(document); }
  function refreshAll() { renderAll(); }

  global.DSCharts = { render, renderAll, refreshAll, renderOne };

  // auto-render on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAll);
  } else {
    renderAll();
  }
})(window);
