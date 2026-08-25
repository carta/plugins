// ── Dashboards: two tiles, each opening a full-page view ──

let _roundHistory = null;      // [{round, date, pricePerShare, priceCurrency, shares, postMoney, cashByCurrency}]
let _roundHistoryChart = null;

function setDashboardBody(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// ── Cap table tile: share class + option pool from the cap_table_chart response ──

// One row per share class and option plan, largest fully diluted first.
function capTableRows(chartData) {
  const shareClasses = Array.isArray(chartData.share_classes) ? chartData.share_classes : [];
  const optionPlans = Array.isArray(chartData.option_plans) ? chartData.option_plans : [];
  return shareClasses
    .map(sc => ({
      name: sc.name || "Share class",
      outstanding: numOrZero(sc.outstanding_shares),
      fullyDiluted: numOrZero(sc.fully_diluted_shares),
    }))
    .concat(optionPlans.map(p => ({
      name: p.name || "Option plan",
      outstanding: numOrZero(p.outstanding_shares),
      fullyDiluted: numOrZero(p.fully_diluted_shares),
    })))
    .filter(r => r.fullyDiluted > 0 || r.outstanding > 0)
    .sort((a, b) => b.fullyDiluted - a.fullyDiluted);
}

const CAP_TABLE_TILE_ROWS = 4;

function renderCapTableTile() {
  if (!_capTableChartData) {
    setDashboardBody("captable-dash-body", `<div class="empty-row">Select a company to see this.</div>`);
    return;
  }
  const rows = capTableRows(_capTableChartData);
  if (!rows.length) {
    setDashboardBody("captable-dash-body", `<div class="empty-row">No share classes on this cap table.</div>`);
    return;
  }
  const shown = rows.slice(0, CAP_TABLE_TILE_ROWS);
  const remaining = rows.length - shown.length;
  setDashboardBody("captable-dash-body", `
    <div class="tbl-row tbl-header">
      <span class="tbl-col-name">SHARE CLASS</span>
      <span class="tbl-col-val">FULLY DILUTED</span>
    </div>
    ${shown.map(r => `
      <div class="tbl-row">
        <div class="tbl-col-name">${escHtml(r.name)}</div>
        <div class="tbl-col-val">${escHtml(fmtSharesShort(r.fullyDiluted))}</div>
      </div>`).join("")}
    ${remaining > 0 ? `<div class="tbl-more">+ ${remaining} more</div>` : ""}
  `);
}

function renderCapTableTileError() {
  setDashboardBody("captable-dash-body", `<div class="error-row">Couldn't load the cap table.</div>`);
}

function renderCapTablePage() {
  const body = document.getElementById("captable-page-body");
  if (!body) return;
  const rows = _capTableChartData ? capTableRows(_capTableChartData) : [];
  if (!rows.length) {
    body.innerHTML = `<div class="empty-row">No share classes on this cap table.</div>`;
    return;
  }
  const totalFd = rows.reduce((sum, r) => sum + r.fullyDiluted, 0);
  body.innerHTML = `
    <table class="fp-table">
      <thead>
        <tr><th>Share class</th><th class="num">Outstanding</th><th class="num">Fully diluted</th><th class="num">% fully diluted</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${escHtml(r.name)}</td>
            <td class="num">${escHtml(fmtSharesShort(r.outstanding))}</td>
            <td class="num">${escHtml(fmtSharesShort(r.fullyDiluted))}</td>
            <td class="num">${totalFd > 0 ? (r.fullyDiluted / totalFd * 100).toFixed(1) + "%" : "—"}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// ── Round history tile ──

// A per-share price needs its currency and full precision — fmtShort's compact notation
// would render 3.40 as "3".
function fmtPricePerShare(value, currencyCode) {
  if (value == null || isNaN(value)) return "—";
  if (currencyCode) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: currencyCode,
        minimumFractionDigits: 2, maximumFractionDigits: 4,
      }).format(value);
    } catch (e) { /* unknown code from the caller — fall through to a bare number */ }
  }
  return String(value);
}

// One row per share class, already aggregated and date-sorted by the post-money
// endpoint. Cash stays keyed by currency and is never added across currencies, so a
// company that raised in two shows two figures rather than one meaningless sum.
function buildFinancingRounds(financings) {
  return financings.map(f => {
    const cashByCurrency = new Map();
    Object.keys(f.cash_raised_by_currency || {}).forEach(code => {
      const amount = numOrZero(f.cash_raised_by_currency[code]);
      if (amount > 0) cashByCurrency.set(code, amount);
    });
    return {
      round: f.name || "Unnamed round",
      date: f.closing_date || null,
      pricePerShare: f.original_issue_price == null ? null : parseFloat(f.original_issue_price),
      priceCurrency: f.currency || null,
      shares: numOrZero(f.shares_issued),
      postMoney: f.post_money == null ? null : parseFloat(f.post_money),
      cashByCurrency,
    };
  });
}

function roundCashLabel(cashByCurrency) {
  if (!cashByCurrency.size) return "—";
  return Array.from(cashByCurrency.entries())
    .map(([code, amount]) => fmtShort(amount, code))
    .join(" + ");
}

// The chart plots one currency only — bars of mixed currencies would read as a total.
function singleChartCurrency(rounds) {
  const codes = new Set();
  rounds.forEach(r => r.cashByCurrency.forEach((_amount, code) => codes.add(code)));
  return codes.size === 1 ? Array.from(codes)[0] : null;
}

function renderRoundHistoryTile() {
  if (_roundHistory === null) {
    setDashboardBody("rounds-dash-body", `<div class="empty-row">Select a company to see this.</div>`);
    return;
  }
  if (!_roundHistory.length) {
    setDashboardBody("rounds-dash-body", `<div class="empty-row">No priced rounds on this cap table.</div>`);
    return;
  }
  const funded = _roundHistory.filter(r => r.cashByCurrency.size);
  const currency = singleChartCurrency(funded);
  if (!currency || !funded.length || !window.Chart) {
    renderRoundHistoryTileTable(funded);
    return;
  }
  setDashboardBody("rounds-dash-body", `<div class="chart-wrap"><canvas id="rounds-chart"></canvas></div>`);
  drawRoundHistoryChart(funded, currency);
}

// Fallback for a mixed-currency cap table (or no Chart.js): the newest rounds as rows,
// each labelled with its own currency.
function renderRoundHistoryTileTable(rounds) {
  const shown = rounds.slice(-CAP_TABLE_TILE_ROWS).reverse();
  if (!shown.length) {
    setDashboardBody("rounds-dash-body", `<div class="empty-row">No cash raised on record.</div>`);
    return;
  }
  setDashboardBody("rounds-dash-body", shown.map(r => `
    <div class="tbl-row">
      <div class="tbl-col-name">${escHtml(r.round)}</div>
      <div class="tbl-col-val">${escHtml(roundCashLabel(r.cashByCurrency))}</div>
    </div>`).join(""));
}

function drawRoundHistoryChart(rounds, currency) {
  const canvas = document.getElementById("rounds-chart");
  if (!canvas) return;
  const labelColor = chartLabelColor();
  if (_roundHistoryChart) { _roundHistoryChart.destroy(); _roundHistoryChart = null; }
  _roundHistoryChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: rounds.map(r => r.round),
      datasets: [{
        data: rounds.map(r => r.cashByCurrency.get(currency) || 0),
        backgroundColor: ownershipPalette()[0],
        borderWidth: 0,
        // Rounded data-end, square at the baseline; bars never fill their slot.
        borderRadius: { topLeft: 4, topRight: 4 },
        maxBarThickness: 24,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => fmtShort(ctx.parsed.y, currency) } },
      },
      scales: {
        x: { ticks: { color: labelColor, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: { ticks: { color: labelColor, font: { size: 10 }, callback: (v) => fmtShort(v, currency) }, grid: { display: false } },
      },
    },
  });
}

function renderRoundHistoryPage() {
  const body = document.getElementById("rounds-page-body");
  if (!body) return;
  if (!_roundHistory || !_roundHistory.length) {
    body.innerHTML = `<div class="empty-row">No priced rounds on this cap table.</div>`;
    return;
  }
  body.innerHTML = `
    <table class="fp-table">
      <thead>
        <tr><th>Round</th><th>Close date</th><th class="num">Price / share</th><th class="num">Shares issued</th><th class="num">Post-money</th><th class="num">Cash raised</th></tr>
      </thead>
      <tbody>
        ${_roundHistory.map(r => `
          <tr>
            <td>${escHtml(r.round)}</td>
            <td>${escHtml(fmtDate(r.date))}</td>
            <td class="num">${escHtml(fmtPricePerShare(r.pricePerShare, r.priceCurrency))}</td>
            <td class="num">${escHtml(fmtSharesShort(r.shares))}</td>
            <td class="num">${escHtml(r.postMoney == null ? "—" : fmtShort(r.postMoney, r.priceCurrency))}</td>
            <td class="num">${escHtml(roundCashLabel(r.cashByCurrency))}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// The post-money list is authoritative for round totals and matches the Carta UI.
// It also carries the currency the Fully diluted summary needs, so one call feeds both.
async function fetchRoundHistory(corporationId) {
  _roundHistory = null;
  setDashboardBody("rounds-dash-body", `<div class="loading-row">Loading the round history…</div>`);
  let res;
  try {
    res = await _mcp("call_tool", {
      name: "cap_table__list__financing_history",
      arguments: { corporation_id: corporationId },
    });
  } catch (e) {
    if (corporationId !== _selectedCorporationId) return;
    setDashboardBody("rounds-dash-body", `<div class="error-row">Couldn't load the round history.</div>`);
    return;
  }
  if (corporationId !== _selectedCorporationId) return;
  const candidates = _mcpResultCandidates(res);
  const errText = _mcpErrorMessage(res, candidates);
  if (errText) {
    setDashboardBody("rounds-dash-body", _isPermissionError(errText)
      ? `<div class="empty-row">You don't have access to the financing history for this company.</div>`
      : `<div class="error-row">Couldn't load the round history.</div>`);
    return;
  }
  const withData = candidates.find(c => c && Array.isArray(c.share_class_financings));
  const financings = withData ? withData.share_class_financings : [];
  _roundHistory = buildFinancingRounds(financings);
  renderRoundHistoryTile();
  applyAmountRaised(withData ? withData.total_cash_raised_by_currency : null);
}

// ── Full-page views ──

function openDashboardPage(pageId, render, trackId) {
  trackHome("click", trackId);
  render();
  const page = document.getElementById(pageId);
  if (page) page.style.display = "block";
  document.body.style.overflow = "hidden";
}

function closeDashboardPage(pageId) {
  const page = document.getElementById(pageId);
  if (page) page.style.display = "none";
  document.body.style.overflow = "";
}

function openCapTablePage() {
  openDashboardPage("captable-page", renderCapTablePage, "CaptableHome.Dashboards.CapTable.Open");
}
function openRoundsPage() {
  openDashboardPage("rounds-page", renderRoundHistoryPage, "CaptableHome.Dashboards.Rounds.Open");
}

function renderDashboardTiles() {
  renderCapTableTile();
  renderRoundHistoryTile();
}

function resetDashboardState() {
  _roundHistory = null;
}
