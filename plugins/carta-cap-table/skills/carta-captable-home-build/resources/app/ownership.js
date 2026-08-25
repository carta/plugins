// ── Ownership + Fully diluted summary — one fetch (cap_table_chart), two renders ──

// Pre-validated 8-hue categorical order (dataviz skill palette.md); canvas can't
// read light-dark(), so pick the mode's column directly instead of a CSS token.
const OWNERSHIP_PALETTE_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const OWNERSHIP_PALETTE_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
function ownershipPalette() {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? OWNERSHIP_PALETTE_DARK : OWNERSHIP_PALETTE_LIGHT;
}

let _ownershipChart = null;

function numOrZero(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function renderOwnershipLoading() {
  const el = document.getElementById("ownership-card-body");
  if (el) el.innerHTML = `<div class="chart-wrap tall"><canvas id="ownership-chart"></canvas></div><div class="loading-row">Loading the ownership breakdown…</div>`;
}
function renderOwnershipError() {
  if (_ownershipChart) { _ownershipChart.destroy(); _ownershipChart = null; }
  const el = document.getElementById("ownership-card-body");
  if (el) el.innerHTML = `<div class="error-row">Couldn't load the ownership breakdown.</div>`;
}
function renderOwnershipEmpty() {
  if (_ownershipChart) { _ownershipChart.destroy(); _ownershipChart = null; }
  const el = document.getElementById("ownership-card-body");
  if (el) el.innerHTML = `<div class="empty-row">No ownership data for this company.</div>`;
}

// Caps at 8 slots (the validated palette's size) — a 9th+ segment folds into
// "Other" rather than cycling or generating a new hue.
function buildOwnershipSegments(chartData) {
  const shareClasses = Array.isArray(chartData.share_classes) ? chartData.share_classes : [];
  const optionPlans = Array.isArray(chartData.option_plans) ? chartData.option_plans : [];
  const segments = shareClasses.map(sc => ({ label: sc.name || "Share class", value: numOrZero(sc.fully_diluted_shares) }))
    .concat(optionPlans.map(p => ({ label: p.name || "Option plan", value: numOrZero(p.fully_diluted_shares) })))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const MAX_SEGMENTS = 8;
  if (segments.length <= MAX_SEGMENTS) return segments;
  const kept = segments.slice(0, MAX_SEGMENTS - 1);
  const otherTotal = segments.slice(MAX_SEGMENTS - 1).reduce((sum, s) => sum + s.value, 0);
  if (otherTotal > 0) kept.push({ label: "Other", value: otherTotal });
  return kept;
}

function renderOwnershipChart(chartData) {
  const segments = buildOwnershipSegments(chartData);
  const el = document.getElementById("ownership-card-body");
  if (!segments.length) { renderOwnershipEmpty(); return; }
  if (el) el.innerHTML = `<div class="chart-wrap tall"><canvas id="ownership-chart"></canvas></div>`;
  const canvas = document.getElementById("ownership-chart");
  if (!canvas || !window.Chart) return;

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const labelColor = chartLabelColor();
  if (_ownershipChart) { _ownershipChart.destroy(); _ownershipChart = null; }
  _ownershipChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: segments.map(s => s.label),
      datasets: [{
        data: segments.map(s => s.value),
        backgroundColor: ownershipPalette().slice(0, segments.length),
        borderWidth: 2,
        borderColor: getComputedStyle(document.body).backgroundColor,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: labelColor, boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : "0.0";
              return `${ctx.label}: ${fmtSharesShort(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function renderFdSummaryLoading() {
  const el = document.getElementById("fd-summary-card-body");
  if (el) el.innerHTML = `<div class="loading-row">Loading the fully diluted summary…</div>`;
}
function renderFdSummaryError() {
  const el = document.getElementById("fd-summary-card-body");
  if (el) el.innerHTML = `<div class="error-row">Couldn't load the fully diluted summary.</div>`;
}
function renderFdSummaryEmpty() {
  const el = document.getElementById("fd-summary-card-body");
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
  const el = document.getElementById("fd-summary-card-body");
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
  renderOwnershipLoading();
  renderFdSummaryLoading();
  let res;
  try {
    res = await _mcp("cap_table_chart", { corporation_id: corporationId });
  } catch (e) {
    if (corporationId !== _selectedCorporationId) return;
    renderOwnershipError();
    renderFdSummaryError();
    renderCapTableTileError();
    return;
  }
  if (corporationId !== _selectedCorporationId) return;
  const candidates = _mcpResultCandidates(res);
  const errText = _mcpErrorMessage(res, candidates);
  if (errText) { renderOwnershipError(); renderFdSummaryError(); renderCapTableTileError(); return; }
  const withChart = candidates.find(c => c && c.chart_data);
  if (!withChart) { renderOwnershipError(); renderFdSummaryError(); renderCapTableTileError(); return; }
  _capTableChartData = withChart.chart_data;
  renderOwnershipChart(withChart.chart_data);
  renderCapTableTile();
  const totals = withChart.chart_data.totals;
  if (fdTotalsAreEmpty(totals)) { renderFdSummaryEmpty(); return; }
  _fdShareTotals = totals;
  renderFdSummaryFromState();
}
