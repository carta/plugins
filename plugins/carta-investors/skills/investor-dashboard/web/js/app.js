/*
 * app.js — investor-dashboard front-end.
 * Renders the budget (Carta baseline), the per-deal scenario editor, and the
 * scenario view (waterfall + budget-vs-forecast). All numbers come from JSON the
 * skill wrote; recalc runs in calc.js. The browser never calls the Carta MCP.
 *
 * SECURITY: every value that originates from data is HTML-escaped before it
 * touches the DOM (esc()). Never set innerHTML with raw data.
 */
(function () {
  'use strict';

  // ---------- token + API ----------
  var TOKEN = new URLSearchParams(location.search).get('t') || '';
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: Object.assign({ 'X-Dash-Token': TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) throw new Error('unauthorized (missing/invalid token)');
      return r.json();
    });
  }

  // ---------- state ----------
  var META = null, MODEL = null, CURRENCY = 'USD';
  var store = new ScenarioStore(api);
  var charts = {};
  var currentView = 'overview';

  // ---------- formatting + escaping ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var SYM = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$' };
  function sym() { return SYM[CURRENCY] || (CURRENCY + ' '); }
  function money(v) {
    if (v == null || isNaN(v)) return '—';
    var neg = v < 0; v = Math.abs(v);
    var s = sym() + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return neg ? '(' + s + ')' : s;
  }
  function moneyShort(v) {
    if (v == null || isNaN(v)) return '—';
    var neg = v < 0, a = Math.abs(v), s;
    if (a >= 1e9) s = (a / 1e9).toFixed(2) + 'B';
    else if (a >= 1e6) s = (a / 1e6).toFixed(1) + 'M';
    else if (a >= 1e3) s = (a / 1e3).toFixed(0) + 'K';
    else s = a.toFixed(0);
    s = sym() + s;
    return neg ? '(' + s + ')' : s;
  }
  function pct(v) { return (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(2) + '%'; }
  function mult(v) { return (v == null || isNaN(v)) ? '—' : v.toFixed(2) + 'x'; }

  function fmt(v, format) {
    if (format === 'currency') return moneyShort(v);
    if (format === 'currencyFull') return money(v);
    if (format === 'percent') return pct(v);
    if (format === 'multiple') return mult(v);
    if (format === 'int') return (v == null || isNaN(v)) ? '—' : Math.round(v).toLocaleString('en-US');
    return esc(v);
  }

  function deltaSpan(delta, format, goodIsUp) {
    if (delta == null || isNaN(delta) || Math.abs(delta) < 1e-9) return '<span class="sub delta-flat">no change</span>';
    var up = delta > 0;
    var good = goodIsUp === false ? !up : up;
    var arrow = up ? '▲' : '▼';
    var txt = (format === 'percent') ? (Math.abs(delta) * 100).toFixed(2) + ' pts'
            : (format === 'multiple') ? Math.abs(delta).toFixed(2) + 'x'
            : moneyShort(Math.abs(delta));
    return '<span class="sub ' + (good ? 'delta-up' : 'delta-down') + '">' + arrow + ' ' + esc(txt) + ' vs budget</span>';
  }

  // ---------- chart helper ----------
  function chart(id, cfg) {
    var el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) { charts[id].destroy(); }
    Chart.defaults.color = '#9aa7b4';
    Chart.defaults.borderColor = '#2a3140';
    Chart.defaults.font.family = '-apple-system, "Segoe UI", Roboto, sans-serif';
    charts[id] = new Chart(el.getContext('2d'), cfg);
  }
  function destroyCharts() { for (var k in charts) charts[k].destroy(); charts = {}; }

  // ---------- DOM helpers ----------
  function el(id) { return document.getElementById(id); }
  function cardHTML(c) {
    return '<div class="card ' + (c.hero ? 'kpi-hero' : '') + '">' +
      '<div class="label">' + esc(c.label) + '</div>' +
      '<div class="value">' + (c.raw ? c.value : esc(c.value)) + '</div>' +
      (c.sub ? '<div class="sub">' + (c.subRaw ? c.sub : esc(c.sub)) + '</div>' : '') +
      '</div>';
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, 2600);
  }

  // ---------- nav ----------
  var SECTIONS = [
    { id: 'overview', title: 'Overview' },
    { id: 'investments', title: 'Investments & Plan' },
    { id: 'scenario', title: 'Scenario' }
  ];
  function buildNav() {
    var nav = el('nav');
    nav.innerHTML = SECTIONS.map(function (s) {
      return '<div class="nav-item" data-view="' + s.id + '"><span class="dot"></span>' + esc(s.title) + '</div>';
    }).join('');
    Array.prototype.forEach.call(nav.querySelectorAll('.nav-item'), function (n) {
      n.addEventListener('click', function () { go(n.getAttribute('data-view')); });
    });
  }
  function setActiveNav() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (n) {
      n.classList.toggle('active', n.getAttribute('data-view') === currentView);
    });
    var sec = SECTIONS.filter(function (s) { return s.id === currentView; })[0];
    el('view-title').textContent = sec ? sec.title : '';
  }
  function updateModeUI() {
    var on = store.active;
    el('mode-badge').className = 'badge ' + (on ? 'badge-forecast' : 'badge-budget');
    el('mode-badge').textContent = on ? 'Forecast' : 'Budget';
    var pill = el('scenario-pill');
    pill.className = 'pill ' + (on ? 'pill-forecast' : 'pill-muted');
    pill.textContent = on ? ('Forecast' + (store.name ? ': ' + store.name : '')) : 'Budget (Carta baseline)';
  }

  function go(view) { currentView = view; destroyCharts(); setActiveNav(); render(); }

  // ---------- views ----------
  function render() {
    if (currentView === 'overview') return renderOverview();
    if (currentView === 'investments') return renderInvestments();
    if (currentView === 'scenario') return renderScenario();
  }

  function renderOverview() {
    var diff = Calc.computeDiff(MODEL, store.toScenario());
    var active = store.active;
    var view = active ? diff.forecast : diff.budget;
    var cap = MODEL.capital || {};
    var m = view.metrics, wf = view.waterfall, capac = view.capacity;

    var cards = [
      { label: 'Committed', value: moneyShort(cap.committedCapital) },
      { label: 'Called', value: moneyShort(cap.contributedCapital) },
      { label: 'Distributions', value: moneyShort(cap.cumulativeDistributions) },
      { label: 'Dry Powder', value: moneyShort(capac.dryPowder) },
      { label: active ? 'Net TVPI (proj.)' : 'Net TVPI', value: mult(m.netTVPI), sub: active ? deltaSpan(diff.deltas.netTVPI.delta, 'multiple') : '', subRaw: true },
      { label: 'Gross MOIC', value: mult(m.grossMOIC), sub: active ? deltaSpan(diff.deltas.grossMOIC.delta, 'multiple') : '', subRaw: true },
      { label: 'Net IRR' + (m.netIRRApproximate ? ' *' : ''), value: pct(m.netIRR), sub: active ? deltaSpan(diff.deltas.netIRR.delta, 'percent') : (m.netIRRApproximate ? '* approximate' : ''), subRaw: active },
      { label: 'New deals possible', value: String(capac.dealsRemaining), sub: '@ ' + moneyShort(capac.avgCheckSize) + ' avg check', hero: true }
    ];

    var html = '';
    if (active) html += '<div class="banner">Showing <b>Forecast</b>' + (store.name ? ' "' + esc(store.name) + '"' : '') + ' — your scenario vs the Carta budget. Estimate only.</div>';
    html += '<div class="cards">' + cards.map(cardHTML).join('') + '</div>';
    html += '<div class="grid-2">' +
      '<div class="chart-card"><h4>Capital</h4><div class="chart-wrap"><canvas id="c-capital"></canvas></div></div>' +
      '<div class="chart-card"><h4>Value composition</h4><div class="chart-wrap"><canvas id="c-value"></canvas></div></div>' +
      '</div>';
    el('content').innerHTML = html;

    chart('c-capital', {
      type: 'bar',
      data: {
        labels: ['Committed', 'Called', 'Dry powder', 'Distributions'],
        datasets: [{ label: CURRENCY, data: [cap.committedCapital, cap.contributedCapital, capac.dryPowder, cap.cumulativeDistributions], backgroundColor: ['#3b82f6', '#22c55e', '#f59e0b', '#a78bfa'] }]
      },
      options: chartOpts(true)
    });
    chart('c-value', {
      type: 'doughnut',
      data: {
        labels: ['Distributions', 'Residual NAV'],
        datasets: [{ data: [view.totals.totalDistributions, view.totals.residualNAV], backgroundColor: ['#22c55e', '#3b82f6'] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }

  function chartOpts(money) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: function (v) { return money ? moneyShort(v) : v; } }, grid: { color: '#2a3140' } }, x: { grid: { display: false } } }
    };
  }

  // ---------- Investments & Plan (the editor) ----------
  function renderInvestments() {
    var res = Calc.compute(MODEL, store.toScenario());
    var projById = {}; res.perDeal.forEach(function (p) { projById[p.id] = p; });
    var deals = MODEL.deals || [];

    var head = '<div class="editor-note">Edit <b>follow-on reserve</b>, <b>exit valuation</b> (company equity value), and <b>exit date</b> for any active company. ' +
      'Metrics and the waterfall update live — see the <b>Scenario</b> tab. Leave blank to hold at current mark.</div>';

    var rows = deals.map(function (d) {
      var p = projById[d.id] || {};
      var sc = store.deals[d.id] || {};
      var isActive = (d.status || '').toLowerCase() !== 'realized';
      var inputs = isActive ?
        ('<td><input class="inp" type="number" min="0" step="100000" data-deal="' + esc(d.id) + '" data-field="followOnReserve" value="' + (sc.followOnReserve != null ? esc(sc.followOnReserve) : '') + '" placeholder="—"></td>' +
         '<td><input class="inp" type="number" min="0" step="1000000" data-deal="' + esc(d.id) + '" data-field="exitValuation" value="' + (sc.exitValuation != null ? esc(sc.exitValuation) : '') + '" placeholder="—"></td>' +
         '<td><input class="inp" type="date" data-deal="' + esc(d.id) + '" data-field="exitDate" value="' + (sc.exitDate ? esc(sc.exitDate) : '') + '"></td>')
        : '<td colspan="3" style="text-align:center;color:var(--muted)">realized</td>';
      return '<tr>' +
        '<td>' + esc(d.name) + '</td>' +
        '<td><span class="status-chip ' + (isActive ? 'status-active' : 'status-realized') + '">' + esc(d.status || '—') + '</span></td>' +
        '<td>' + money(d.invested) + '</td>' +
        '<td>' + money(d.fmv) + '</td>' +
        '<td>' + pct(d.ownershipPct) + '</td>' +
        inputs +
        '<td><b>' + mult(p.moic) + '</b></td>' +
        '</tr>';
    }).join('');

    var html = head +
      '<div class="cards">' +
        cardHTML({ label: 'Reserves planned', value: moneyShort(res.capacity.reservesPlanned) }) +
        cardHTML({ label: 'Capital for new deals', value: moneyShort(res.capacity.capitalForNewDeals) }) +
        cardHTML({ label: 'New deals possible', value: String(res.capacity.dealsRemaining), sub: '@ ' + moneyShort(res.capacity.avgCheckSize) + ' avg check', hero: true }) +
      '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        '<th>Company</th><th>Status</th><th>Invested</th><th>FMV</th><th>Own. %</th>' +
        '<th>Follow-on ' + esc(sym()) + '</th><th>Exit valuation</th><th>Exit date</th><th>Proj. MOIC</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    el('content').innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll('.inp[data-deal]'), function (inp) {
      inp.addEventListener('change', function () {
        var v = inp.value;
        var field = inp.getAttribute('data-field');
        if (field !== 'exitDate') v = (v === '' ? '' : parseFloat(v));
        store.setDealInput(inp.getAttribute('data-deal'), field, v);
        updateModeUI();
        renderInvestments(); // refresh proj MOIC + capacity cards
      });
    });
  }

  // ---------- Scenario ----------
  function renderScenario() {
    var diff = Calc.computeDiff(MODEL, store.toScenario());
    var b = diff.budget, f = diff.forecast;
    var terms = f.terms;

    var banner = '<div class="banner"><b>Estimate — transparent European whole-fund model, not Carta’s official waterfall (Niagara).</b>' +
      '<ul>' +
      '<li>Follow-on reserves &amp; exit assumptions are your inputs (not Carta data).</li>' +
      '<li>Excludes: per-LP carry terms/exemptions, liquidation preferences &amp; preferred stack, dilution to exit, fee recycling, American (deal-by-deal) carry.</li>' +
      '<li>Proceeds modeled as ownership %% × exit equity value.</li>' +
      '</ul></div>';

    var termsSrc = (MODEL.termsSource || {});
    function termBox(field, label, val, step, isPct) {
      var shown = isPct ? (val * 100) : val;
      return '<div class="term"><label>' + esc(label) + '</label>' +
        '<input class="inp" type="number" step="' + step + '" data-term="' + field + '" data-pct="' + (isPct ? '1' : '0') + '" value="' + esc(shown) + '">' +
        '<div class="src">' + esc(termsSrc[field] ? ('from Carta: ' + termsSrc[field]) : 'default / edited') + '</div></div>';
    }
    var termsHtml = '<div class="section-title">Fund terms</div><div class="terms-grid">' +
      termBox('carryPct', 'Carried interest %', terms.carryPct, '0.5', true) +
      termBox('hurdlePct', 'Preferred return %', terms.hurdlePct, '0.5', true) +
      termBox('gpCommitPct', 'GP commitment %', terms.gpCommitPct, '0.5', true) +
      '</div>';

    var kpis = [
      { label: 'Net TVPI (LP)', b: b.metrics.netTVPI, f: f.metrics.netTVPI, fmt: 'multiple' },
      { label: 'Gross MOIC', b: b.metrics.grossMOIC, f: f.metrics.grossMOIC, fmt: 'multiple' },
      { label: 'Net IRR (LP)', b: b.metrics.netIRR, f: f.metrics.netIRR, fmt: 'percent' },
      { label: 'Net proceeds to LP', b: b.waterfall.netProceedsLP, f: f.waterfall.netProceedsLP, fmt: 'currency' },
      { label: 'GP carry', b: b.waterfall.gpCarry, f: f.waterfall.gpCarry, fmt: 'currency' },
      { label: 'New deals possible', b: b.capacity.dealsRemaining, f: f.capacity.dealsRemaining, fmt: 'int' }
    ];
    var kpiCards = kpis.map(function (k) {
      return cardHTML({ label: k.label, value: fmt(k.f, k.fmt), sub: 'budget ' + fmt(k.b, k.fmt) + ' &nbsp; ' + deltaSpan(k.f - k.b, k.fmt), subRaw: true });
    }).join('');

    var wf = f.waterfall.tiers;
    var wfHtml = '<div class="section-title">Waterfall (forecast, at liquidation)</div><div class="chart-card">' +
      wfRow('Return of capital', wf.returnOfCapital) +
      wfRow('Preferred return (hurdle)', wf.preferredReturn) +
      wfRow('GP catch-up', wf.gpCatchUp) +
      wfRow('Carry split — LP', wf.lpSplit) +
      wfRow('Carry split — GP', wf.gpSplit) +
      '<div class="wf-row lp"><span>Net proceeds to LP</span><span>' + money(f.waterfall.netProceedsLP) + '</span></div>' +
      '<div class="wf-row gp"><span>GP carry (promote)</span><span>' + money(f.waterfall.gpCarry) + '</span></div>' +
      '</div>';

    var actions = '<div class="actions">' +
      '<input class="inp" id="sc-name" type="text" style="width:220px;text-align:left" placeholder="Scenario name" value="' + esc(store.name || '') + '">' +
      '<button class="btn" id="sc-save">Save scenario</button>' +
      '<select class="inp" id="sc-list" style="width:200px;text-align:left"><option value="">Reload scenario…</option></select>' +
      '<button class="btn secondary" id="sc-reset">Reset to budget</button>' +
      '</div>';

    var html = banner + actions +
      '<div class="cards">' + kpiCards + '</div>' +
      termsHtml +
      '<div class="grid-2">' +
        '<div class="chart-card"><h4>Multiples — budget vs forecast</h4><div class="chart-wrap"><canvas id="c-mult"></canvas></div></div>' +
        '<div class="chart-card"><h4>LP vs GP split (forecast)</h4><div class="chart-wrap"><canvas id="c-split"></canvas></div></div>' +
      '</div>' + wfHtml;
    el('content').innerHTML = html;

    // charts
    chart('c-mult', {
      type: 'bar',
      data: {
        labels: ['Net TVPI', 'Gross MOIC'],
        datasets: [
          { label: 'Budget', data: [b.metrics.netTVPI, b.metrics.grossMOIC], backgroundColor: '#64748b' },
          { label: 'Forecast', data: [f.metrics.netTVPI, f.metrics.grossMOIC], backgroundColor: '#3b82f6' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: function (v) { return v + 'x'; } } } } }
    });
    chart('c-split', {
      type: 'doughnut',
      data: {
        labels: ['Net proceeds to LP', 'GP carry'],
        datasets: [{ data: [f.waterfall.netProceedsLP, f.waterfall.gpCarry], backgroundColor: ['#3b82f6', '#ef4444'] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    // wire actions
    Array.prototype.forEach.call(document.querySelectorAll('.inp[data-term]'), function (inp) {
      inp.addEventListener('change', function () {
        var pctField = inp.getAttribute('data-pct') === '1';
        var v = inp.value === '' ? '' : (pctField ? parseFloat(inp.value) / 100 : parseFloat(inp.value));
        store.setTerm(inp.getAttribute('data-term'), v);
        updateModeUI(); renderScenario();
      });
    });
    el('sc-reset').addEventListener('click', function () { store.reset(); updateModeUI(); renderScenario(); toast('Reset to budget'); });
    el('sc-save').addEventListener('click', function () {
      var name = (el('sc-name').value || '').trim();
      if (!name) { toast('Enter a scenario name first'); return; }
      store.save(name, META.fundId).then(function (r) { toast('Saved "' + name + '"'); refreshScenarioList(); }).catch(function (e) { toast('Save failed: ' + e.message); });
    });
    el('sc-list').addEventListener('change', function () {
      var id = el('sc-list').value; if (!id) return;
      store.load(id, META.fundId).then(function (r) { updateModeUI(); renderScenario(); toast('Loaded "' + r.name + '"' + (r.warning ? ' — ' + r.warning : '')); });
    });
    refreshScenarioList();
  }

  function wfRow(label, val) { return '<div class="wf-row"><span>' + esc(label) + '</span><span>' + money(val) + '</span></div>'; }

  function refreshScenarioList() {
    var sel = el('sc-list'); if (!sel) return;
    store.list().then(function (r) {
      var opts = '<option value="">Reload scenario…</option>';
      (r.scenarios || []).forEach(function (s) { opts += '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; });
      sel.innerHTML = opts;
    }).catch(function () {});
  }

  // ---------- boot ----------
  function heartbeat() { api('GET', '/api/heartbeat').catch(function () {}); }

  function boot() {
    Promise.all([
      api('GET', '/api/meta.json'),
      api('GET', '/api/baseline/model.json')
    ]).then(function (res) {
      META = res[0]; MODEL = res[1];
      if (MODEL && MODEL.error === 'not_ready') { el('content').innerHTML = '<div class="empty">No baseline data found. Re-run <code>/investor-dashboard</code> to populate it.</div>'; return; }
      CURRENCY = (MODEL.fund && MODEL.fund.currency) || (META.fund && META.fund.currency) || 'USD';
      el('fund-name').textContent = (MODEL.fund && MODEL.fund.name) || (META.fund && META.fund.name) || 'Fund';
      if (META.generatedAt) el('as-of').textContent = 'As of ' + META.generatedAt;
      buildNav(); setActiveNav(); updateModeUI(); render();
      heartbeat(); setInterval(heartbeat, 30000);
    }).catch(function (e) {
      el('content').innerHTML = '<div class="empty">Could not load dashboard data: ' + esc(e.message) + '</div>';
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
