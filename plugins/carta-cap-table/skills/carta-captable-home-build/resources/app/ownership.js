// ── Ownership composition bar + Fully diluted summary — one cap_table_chart fetch
// feeds the summary strip, the Cap table tile, and the bar on the Cap table page. ──

// Pre-validated 8-hue categorical order (dataviz skill palette.md); canvas can't
// read light-dark(), so pick the mode's column directly instead of a CSS token.
// `--carta-chart-series-N` mirrors these slot for slot for the HTML legend swatches.
const OWNERSHIP_PALETTE_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OWNERSHIP_PALETTE_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
function prefersDarkScheme() {
  return !!(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}
function ownershipPalette() {
  return prefersDarkScheme() ? OWNERSHIP_PALETTE_DARK : OWNERSHIP_PALETTE_LIGHT;
}

// Stack segments touch, so a gap in the surface color separates them. Cached per
// theme because the scriptable option that reads it runs on every redraw.
const _surfaceByScheme = {};
function chartSurfaceColor() {
  const dark = prefersDarkScheme();
  if (!_surfaceByScheme[dark]) {
    _surfaceByScheme[dark] = inkColor("--ink-color-global-surface-background-default", dark ? "#121212" : "#FFFFFF");
  }
  return _surfaceByScheme[dark];
}

// A value set inside a colored fill is the one place text leaves the text tokens.
// Whichever of white or ink contrasts more with the fill wins: a mid-lightness
// categorical hue clears AA against exactly one of them, and which one flips by hue.
const ON_FILL_LIGHT = "#FFFFFF";
const ON_FILL_DARK = "#1A1A1A";
function relativeLuminance(hex) {
  const n = parseInt(hex, 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function onFillTextColor(fill) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(fill).trim());
  if (!match) return ON_FILL_LIGHT;
  const lum = relativeLuminance(match[1]);
  const againstLight = 1.05 / (lum + 0.05);
  const againstDark = (lum + 0.05) / (relativeLuminance(ON_FILL_DARK.slice(1)) + 0.05);
  return againstDark > againstLight ? ON_FILL_DARK : ON_FILL_LIGHT;
}

let _ownershipChart = null;

function numOrZero(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function destroyOwnershipChart() {
  if (_ownershipChart) { _ownershipChart.destroy(); _ownershipChart = null; }
}

// Caps at 6 segments — past that, adjacent slices of one stacked bar stop reading
// apart. A 7th+ class folds into "Other"; the table below still lists every row.
function buildOwnershipSegments(chartData) {
  const shareClasses = Array.isArray(chartData.share_classes) ? chartData.share_classes : [];
  const optionPlans = Array.isArray(chartData.option_plans) ? chartData.option_plans : [];
  const segments = shareClasses.map(sc => ({ label: sc.name || "Share class", value: numOrZero(sc.fully_diluted_shares) }))
    .concat(optionPlans.map(p => ({ label: p.name || "Option plan", value: numOrZero(p.fully_diluted_shares) })))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const MAX_SEGMENTS = 6;
  if (segments.length <= MAX_SEGMENTS) return segments;
  const kept = segments.slice(0, MAX_SEGMENTS - 1);
  const otherTotal = segments.slice(MAX_SEGMENTS - 1).reduce((sum, s) => sum + s.value, 0);
  if (otherTotal > 0) kept.push({ label: "Other", value: otherTotal });
  return kept;
}

// A value rides inside its own segment, but only where it fits: a clipped label is
// worse than none, and the legend, tooltip and table carry whatever is skipped.
const IN_SEGMENT_LABEL_PADDING = 6;
const ownershipValueLabels = {
  id: "ownershipValueLabels",
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = "600 11px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((dataset, i) => {
      const bar = chart.getDatasetMeta(i).data[0];
      if (!bar) return;
      const { x, y, base } = bar.getProps(["x", "y", "base"], true);
      const text = fmtSharesShort(dataset.data[0]);
      if (ctx.measureText(text).width + IN_SEGMENT_LABEL_PADDING * 2 > Math.abs(x - base)) return;
      ctx.fillStyle = onFillTextColor(bar.options.backgroundColor);
      ctx.fillText(text, (x + base) / 2, y);
    });
    ctx.restore();
  },
};

// The canvas only exists while the Cap table page is open, so this runs on open and
// again on every reopen — never at fetch time.
function drawOwnershipChart() {
  const canvas = document.getElementById("ownership-chart");
  if (!canvas || !window.Chart || !_capTableChartData) return;
  const segments = buildOwnershipSegments(_capTableChartData);
  if (!segments.length) return;

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const lastIndex = segments.length - 1;
  destroyOwnershipChart();
  // One stacked bar: fully diluted shares is the whole, each share class or option
  // plan a slice of it. Horizontal so the long names sit in a legend, not on an axis.
  _ownershipChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: [""],
      datasets: segments.map((segment, i) => ({
        label: segment.label,
        data: [segment.value],
        backgroundColor: () => ownershipPalette()[i],
        // 1px of surface on each side of two neighbours is the 2px gap that separates
        // them — never a stroke drawn around the segment.
        borderColor: () => chartSurfaceColor(),
        borderWidth: { left: 1, right: 1 },
        borderSkipped: false,
        // Rounded only where the stack ends; interior joins stay square.
        borderRadius: {
          topLeft: i === 0 ? 4 : 0, bottomLeft: i === 0 ? 4 : 0,
          topRight: i === lastIndex ? 4 : 0, bottomRight: i === lastIndex ? 4 : 0,
        },
        maxBarThickness: 24,
      })),
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        // The legend is HTML below the canvas, so it wraps and keeps the text tokens.
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: () => [],
            label: (ctx) => {
              const pct = total > 0 ? (ctx.parsed.x / total * 100).toFixed(1) : "0.0";
              return `${ctx.dataset.label}: ${fmtSharesShort(ctx.parsed.x)} (${pct}% fully diluted)`;
            },
          },
        },
      },
      // No axis: the total above the bar states the whole and the legend names the parts.
      scales: {
        x: { stacked: true, display: false },
        y: { stacked: true, display: false },
      },
    },
    plugins: [ownershipValueLabels],
  });
}

// Identity never rests on color alone, so every segment is named here. The swatch
// reads its hue from the CSS token that mirrors the canvas palette.
function ownershipLegendHtml(segments) {
  return `
    <ul class="chart-legend">
      ${segments.map((segment, i) => `
        <li class="chart-legend-item">
          <span class="chart-legend-swatch" style="background:var(--carta-chart-series-${i + 1})"></span>
          ${escHtml(segment.label)}
        </li>`).join("")}
    </ul>`;
}

function renderFdSummaryLoading() {
  const el = document.getElementById("fd-summary-strip");
  if (el) el.innerHTML = `<div class="loading-row">Loading the fully diluted summary…</div>`;
}
function renderFdSummaryError() {
  const el = document.getElementById("fd-summary-strip");
  if (el) el.innerHTML = `<div class="error-row">Couldn't load the fully diluted summary.</div>`;
}
function renderFdSummaryEmpty() {
  const el = document.getElementById("fd-summary-strip");
  if (el) el.innerHTML = `<div class="empty-row">No fully diluted summary for this company.</div>`;
}

// Two independent fetches feed the amount-raised row and can resolve in either
// order — both write here and re-render, so neither clobbers the other.
let _fdShareTotals = null;
let _fdAmountRaisedRows = null;
// The whole cap_table_chart payload, kept so the Cap table dashboard can render its
// per-share-class breakdown without a second fetch.
let _capTableChartData = null;
function resetFdSummaryState() { _fdShareTotals = null; _fdAmountRaisedRows = null; _capTableChartData = null; }

// Absent chart_data.totals, or one with nothing to show, gets its own empty
// state rather than three dash rows.
function fdTotalsAreEmpty(totals) {
  if (!totals) return true;
  return numOrZero(totals.total_fully_diluted) === 0 && numOrZero(totals.total_outstanding) === 0;
}

// No currency on totals.total_cash_raised — render the magnitude and say so, never guess.
function defaultAmountRaisedRows(totals) {
  return [["Amount raised (currency unknown)", fmtShort(totals.total_cash_raised)]];
}

function statTile(label, value) {
  return `
    <div class="stat-tile">
      <div class="stat-label">${escHtml(label)}</div>
      <div class="stat-value">${escHtml(value)}</div>
    </div>`;
}

// Outstanding as a share of fully diluted: one ratio against a limit, so it reads
// as a meter rather than two numbers the user has to divide in their head.
function dilutionMeter(outstanding, fullyDiluted) {
  if (!(fullyDiluted > 0) || !(outstanding > 0)) return "";
  const pct = Math.max(0, Math.min(100, (outstanding / fullyDiluted) * 100));
  return `
    <div class="meter-block">
      <div class="meter-head">
        <span class="meter-name">Issued and outstanding</span>
        <span class="meter-val">${pct.toFixed(1)}% of fully diluted</span>
      </div>
      <div class="meter-track"><div class="meter-fill" style="width:${pct.toFixed(1)}%"></div></div>
    </div>`;
}

function renderFdSummaryFromState() {
  const el = document.getElementById("fd-summary-strip");
  if (!el || !_fdShareTotals) return;
  const raised = _fdAmountRaisedRows || defaultAmountRaisedRows(_fdShareTotals);
  el.innerHTML = `
    <div class="stat-row">
      ${statTile("Fully diluted", fmtSharesShort(_fdShareTotals.total_fully_diluted))}
      ${statTile("Outstanding", fmtSharesShort(_fdShareTotals.total_outstanding))}
      ${raised.map(([name, val]) => statTile(name, val)).join("")}
    </div>
    ${dilutionMeter(numOrZero(_fdShareTotals.total_outstanding), numOrZero(_fdShareTotals.total_fully_diluted))}`;
}

// Fed by the round-history fetch, which owns the one financing_history call.
// Never sums across currencies — a mixed-currency company gets one tile per currency.
function applyAmountRaised(totalsByCurrency) {
  const totals = totalsByCurrency || {};
  const currencies = Object.keys(totals).filter(code => totals[code] != null);
  if (!currencies.length) return;
  _fdAmountRaisedRows = currencies.length === 1
    ? [["Amount raised", fmtShort(totals[currencies[0]], currencies[0])]]
    : currencies.map(code => [`Amount raised (${code})`, fmtShort(totals[code], code)]);
  renderFdSummaryFromState();
}

async function fetchOwnershipAndFdSummary(corporationId) {
  resetFdSummaryState();
  destroyOwnershipChart();
  renderFdSummaryLoading();
  let res;
  try {
    res = await _mcp("cap_table_chart", { corporation_id: corporationId });
  } catch (e) {
    if (corporationId !== _selectedCorporationId) return;
    renderFdSummaryError();
    renderCapTableTileError();
    reportCardFailure(e && e.message);
    return;
  }
  if (corporationId !== _selectedCorporationId) return;
  const candidates = _mcpResultCandidates(res);
  const errText = _mcpErrorMessage(res, candidates);
  if (errText) { renderFdSummaryError(); renderCapTableTileError(); reportCardFailure(errText); return; }
  const withChart = candidates.find(c => c && c.chart_data);
  if (!withChart) {
    renderFdSummaryError();
    renderCapTableTileError();
    reportCardFailure("cap_table_chart returned no chart data for this corporation.");
    return;
  }
  _capTableChartData = withChart.chart_data;
  renderCapTableTile();
  const totals = withChart.chart_data.totals;
  if (fdTotalsAreEmpty(totals)) { renderFdSummaryEmpty(); return; }
  _fdShareTotals = totals;
  renderFdSummaryFromState();
}
