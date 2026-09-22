// ── Carta MCP bridge ──
// The artifact runtime addresses a connector by display name, so {{CARTA_MCP_SERVER}} is
// the name the build script stamps in — not a UUID and not a prefixed tool name.
const CARTA_MCP_SERVER = "{{CARTA_MCP_SERVER}}";

let _mcpNsPromise = null;
// For sync render paths: null while resolving, then true/false. Unknown behaves like
// live, since each such path re-renders once enrichment settles.
let _mcpLive = null;

// Wait up to timeoutMs for window.claude to appear (guards against the race where
// the script runs before the artifact runtime installs window.claude).
function _waitForClaude(timeoutMs) {
  if (window.claude?.use) return Promise.resolve(window.claude);
  // `claude` without `.use` is a surface that never serves MCP, so don't spend the full
  // budget there — a chat viewer would sit on loading state before the degraded view.
  const budget = window.claude ? Math.min(timeoutMs, 300) : timeoutMs;
  return new Promise(resolve => {
    const id = setInterval(() => {
      if (window.claude?.use) { clearInterval(id); clearTimeout(tid); resolve(window.claude); }
    }, 20);
    const tid = setTimeout(() => { clearInterval(id); resolve(null); }, budget);
  });
}

// null = mcp not granted, not served, or failed. Null is not cached — callers may retry.
function _mcpNamespace() {
  if (_mcpNsPromise) return _mcpNsPromise;
  _mcpNsPromise = _waitForClaude(5000)
    .then(claude => claude ? claude.use("mcp") : null)
    .catch(() => null)
    .then(ns => {
      _mcpLive = !!ns;
      if (!ns) _mcpNsPromise = null; // don't cache failure — allow retry
      return ns;
    });
  return _mcpNsPromise;
}

// Gate every data path on this instead of probing window.claude members.
async function mcpAvailable() {
  return !!(await _mcpNamespace());
}

_mcpNamespace();  // start resolving at load so the sync render paths see a settled answer

// Carta MCP wrapper: injects _instrumentation_v2 required since 2026-07-27
async function _mcp(tool, args) {
  const mcp = await _mcpNamespace();
  if (!mcp) throw new Error("Carta connector unavailable in this view");
  try {
    return await mcp.callTool(
      CARTA_MCP_SERVER,
      tool,
      Object.assign({}, args, { _instrumentation_v2: { skills: ['carta-investors:carta-home-build'], from_ui: true } })
    );
  } catch (err) {
    // A failed tool belongs to the card that asked, so return an envelope. Connector
    // codes (needs_reauth, server_not_connected) rethrow — those are page-level.
    if (err?.code === "tool_error") return { isError: true, code: err.code, result: err.result, content: [{ type: "text", text: err.message ?? "tool error" }] };
    throw err;
  }
}

// ── Snowplow UI-event tracking via @carta/mcp-ui-tracker (window.mcpUiTracker) ──
if (window.mcpUiTracker) {
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "artifact", interfaceId: "carta-home" },
    mcpServerId: CARTA_MCP_SERVER,
  });
}
function trackHome(action, elementId, options) {
  if (window.mcpUiTracker && window.mcpUiTracker.getTransport()) {
    window.mcpUiTracker.trackUiEvent(action, elementId, options);
  }
}

// ── Skill metadata ──
const SKILLS = {
  soi:        { name: "Schedule of investments",      desc: "Full holdings with cost, marks and MOIC." },
  benchmarks: { name: "Fund performance",       desc: "Net IRR against peer-group percentiles." },
  tearsheet:  { name: "Tear sheet download",          desc: "One-page tear sheet with metrics." },
  pnl:        { name: "Consolidating P&L",            desc: "Profit and loss across funds." },
  bs:         { name: "Consolidating balance sheet",  desc: "Consolidated balance sheet." },
};

// ── Run a skill ──
// ── Popover: show trigger phrase + copy button ──
let activePopover = null;

function showPromptPopover(btn, prompt, skillId) {
  // Close any existing popover
  if (activePopover) { activePopover.remove(); activePopover = null; }

  const pop = document.createElement("div");
  pop.className = "prompt-popover";
  pop.innerHTML = `
    <p class="pop-subtitle">Paste this in chat to run the skill.</p>
    <div class="db-prompt-row">
      <span class="db-prompt-text">${prompt}</span>
      <button class="db-copy-btn" id="pop-copy"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy</button>
    </div>
  `;
  document.body.appendChild(pop);
  activePopover = pop;

  // Position below the button
  const rect = btn.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.top  = (rect.bottom + 8) + "px";
  pop.style.left = Math.max(8, rect.left) + "px";
  pop.style.maxWidth = "calc(100vw - 16px)";

  // Copy action
  const copyBtn = pop.querySelector("#pop-copy");
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(prompt).then(() => {
      copyBtn.textContent = "✓ Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => { if (activePopover === pop) { pop.remove(); activePopover = null; } }, 1200);
    }).catch(() => {
      copyBtn.textContent = "✓ Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => { if (activePopover === pop) { pop.remove(); activePopover = null; } }, 1200);
    });
  });

  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener("click", function dismiss(e) {
      if (!pop.contains(e.target) && e.target !== btn) {
        pop.remove(); activePopover = null;
        document.removeEventListener("click", dismiss);
      }
    });
  }, 0);

}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

// ── Wire run buttons (only those with a data-prompt attribute) ──
document.querySelectorAll(".run-btn[data-prompt]").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const skill = btn.dataset.skill;
    trackHome("click", "CartaHome.RunPrompt" + (skill ? "." + skill.charAt(0).toUpperCase() + skill.slice(1) : ""));
    showPromptPopover(btn, btn.dataset.prompt, btn.dataset.skill);
  });
});

// ── Benchmark chart ──
let _benchmarkFirmId = null;
let _benchmarkChartInst = null;
let _soiFundRows = [];          // hoisted so starred card can read it
let _benchLabels = null;        // hoisted so starred perf card can draw
let _benchDatasets = null;
let _fundColorMap  = {};        // { fundName → hex } — populated in fetchBenchmarkData
// Generic palette — cycles for any number of funds. Shared by the benchmark chart
// path and the AGGREGATE_FUND_METRICS fallback so both colour funds identically.
const _BENCH_COLORS = ["#285DA3","#2D9E90","#DDB31F","#94B524","#B29990","#58B8BC","#656B6B"];
let _latestByFund  = {};        // { fundName → latest metrics row } — for starred perf card table
let _firmDisplayName = 'your firm'; // set by fetchLiveData once firm is resolved

// ── Resolve a CSS custom property to a concrete color Chart.js can paint ──
// getPropertyValue() on a custom property returns the *unsubstituted* token
// stream, so a light-dark() token comes back as the literal string
// "light-dark(#656B6B, #FFFFFF)" — canvas can't parse that and silently falls
// back to black, which made axis labels unreadable in dark mode. Reading the
// computed `color` of a probe element resolves light-dark() against the active
// color-scheme and yields an rgb() string.
function inkColor(token, fallback) {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${token})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}
const chartLabelColor = () => inkColor("--carta-chart-label-color", "#656B6B");
// Backstop for any canvas text not given an explicit color — Chart.js otherwise
// defaults to a hardcoded #666, which is unreadable on the dark surface.
if (window.Chart) Chart.defaults.color = chartLabelColor();

function drawBenchmarkChart(labels, datasets) {
  const canvasEl = document.getElementById("benchmark-chart");
  if (!canvasEl) return;
  if (_benchmarkChartInst) { _benchmarkChartInst.destroy(); _benchmarkChartInst = null; }
  const ctx = canvasEl.getContext("2d");
  const textColor = chartLabelColor();
  const crosshairPlugin = {
    id: "crosshair",
    afterDraw(chart) {
      if (!chart.tooltip._active?.length) return;
      const { ctx, scales: { x, y } } = chart;
      const xPos = chart.tooltip._active[0].element.x;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(xPos, y.top); ctx.lineTo(xPos, y.bottom);
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(128,128,128,0.25)";
      ctx.setLineDash([3,3]); ctx.stroke(); ctx.restore();
    }
  };
  _benchmarkChartInst = new Chart(ctx, {
    type: "line",
    plugins: [crosshairPlugin],
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false, labels: { color: textColor } },
        tooltip: {
          enabled: true, mode: "index", intersect: false,
          backgroundColor: "rgba(26,26,26,0.94)",
          titleColor: "#9C9F9F", titleFont: { size: 10, family: "Inter,system-ui,sans-serif" },
          bodyColor: "#FFFFFF", bodyFont: { size: 11, family: "Inter,system-ui,sans-serif" },
          borderColor: "rgba(255,255,255,0.08)", borderWidth: 1,
          padding: { top:8, bottom:8, left:12, right:12 },
          cornerRadius: 4, caretSize: 4,
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: {
            label(item) {
              if (item.parsed.y == null) return null;
              const v = item.parsed.y;
              return ` ${item.dataset.label}: ${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
            },
            labelColor(item) {
              return { borderColor: item.dataset.borderColor, backgroundColor: item.dataset.borderColor, borderWidth:2, borderRadius:2 };
            },
          },
        },
      },
      scales: {
        x: { ticks: { color:textColor, font:{ size:9, family:"Inter,system-ui,sans-serif" } }, grid:{ display:false }, border:{ display:false } },
        y: { ticks: { color:textColor, font:{ size:9, family:"Inter,system-ui,sans-serif" }, callback: v => v+"%" }, grid:{ color:"rgba(128,128,128,0.12)" }, border:{ display:false } },
      },
    },
  });
}


function _fmtQtr(dateStr) {
  const dt = new Date(dateStr + "T00:00:00");
  return `Q${Math.ceil((dt.getMonth()+1)/3)}’${String(dt.getFullYear()).slice(2)}`;
}

async function fetchBenchmarkData() {
  if (!(await mcpAvailable()) || !_benchmarkFirmId) return;

  try {
    const res = await _mcp("fetch", {
      command: "dwh:execute:query",
      params: {
        sql: `SELECT FUND_NAME, FUND_UUID, PERFORMANCE_QUARTER_START_DATE, NET_IRR, TVPI, DPI, MOIC,
                     NET_IRR_50TH, VINTAGE_YEAR, ENTITY_TYPE_NAME
              FROM FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS
              WHERE FIRM_ID = '${_benchmarkFirmId}'
              AND NET_IRR IS NOT NULL
              AND PERFORMANCE_QUARTER_START_DATE >= '2021-06-01'
              ORDER BY PERFORMANCE_QUARTER_START_DATE, FUND_NAME`,
        format: 'ndjson',
      }
    });
    if (res.isError) throw new Error("DWH failed");
    const rows = parseDWH(res);
    if (!rows.length) { await fetchBenchmarkFallback(); return; }

    // Build sorted date list
    const dateSet = new Set(rows.map(r => r.PERFORMANCE_QUARTER_START_DATE));
    const sortedDates = Array.from(dateSet).sort();
    const labels = sortedDates.map(_fmtQtr);

    // Per-fund IRR series
    const byFund = {};
    const byFundP50 = {};  // P50 peer cohort IRR per fund
    rows.forEach(r => {
      if (!byFund[r.FUND_NAME]) byFund[r.FUND_NAME] = {};
      byFund[r.FUND_NAME][r.PERFORMANCE_QUARTER_START_DATE] = r.NET_IRR;
      if (!byFundP50[r.FUND_NAME]) byFundP50[r.FUND_NAME] = {};
      if (r.NET_IRR_50TH != null) byFundP50[r.FUND_NAME][r.PERFORMANCE_QUARTER_START_DATE] = r.NET_IRR_50TH;
    });

    const DATA_VIZ_COLORS = _BENCH_COLORS;
    // Derive shortest unique label by stripping common prefix and ", L.P." suffix
    const fundNames = Object.keys(byFund).slice(0, 3); // show max 3 funds
    const commonPrefix = fundNames.reduce((pfx, n) => {
      let i = 0; while (i < pfx.length && i < n.length && pfx[i] === n[i]) i++;
      return pfx.slice(0, i);
    }, fundNames[0] ?? "");
    // Populate global color map so metrics table can use same colors
    fundNames.forEach((name, i) => { _fundColorMap[name] = DATA_VIZ_COLORS[i % DATA_VIZ_COLORS.length]; });
    const fundDatasets = fundNames.map((name, idx) => ({
      label: name.slice(commonPrefix.length).replace(/, L\.P\.$/, "").trim() || name,
      data: sortedDates.map(d => byFund[name][d] ?? null),
      borderColor: DATA_VIZ_COLORS[idx % DATA_VIZ_COLORS.length],
      borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5,
      fill: false, tension: 0.4,
    }));

    // Add dashed P50 benchmark lines for each fund (lighter, same color)
    const p50Datasets = fundNames
      .map((name, idx) => {
        const p50data = sortedDates.map(d => byFundP50[name]?.[d] ?? null);
        if (!p50data.some(v => v != null)) return null;
        return {
          label: (name.slice(commonPrefix.length).replace(/, L\.P\.$/, '').trim() || name) + ' P50',
          data: p50data,
          borderColor: DATA_VIZ_COLORS[idx % DATA_VIZ_COLORS.length],
          borderWidth: 1.2, borderDash: [4, 4],
          pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.4,
        };
      })
      .filter(Boolean);
    const allDatasets = [...fundDatasets, ...p50Datasets];
    _benchLabels = labels; _benchDatasets = allDatasets;
    drawBenchmarkChart(labels, allDatasets);

    // Metrics table — latest quarter, same 3 funds as chart
    const latestByFund = {};
    rows.forEach(r => {
      if (!fundNames.includes(r.FUND_NAME)) return; // respect the 3-fund cap
      if (!latestByFund[r.FUND_NAME] || r.PERFORMANCE_QUARTER_START_DATE > latestByFund[r.FUND_NAME].PERFORMANCE_QUARTER_START_DATE) {
        latestByFund[r.FUND_NAME] = r;
      }
    });
    _latestByFund = latestByFund;

    if (Object.keys(latestByFund).length) {
      const asOf = _fmtQtr(Object.values(latestByFund)[0].PERFORMANCE_QUARTER_START_DATE);
      _renderBenchMetricsTable(Object.values(latestByFund).map(r => ({
        name: r.FUND_NAME,
        color: _fundColorMap[r.FUND_NAME] || _BENCH_COLORS[0],
        irr: r.NET_IRR, tvpi: r.TVPI, dpi: r.DPI,
      })), asOf);
    }
  } catch(e) {
    // Benchmark query failed (not just empty) — try the same AGGREGATE_FUND_METRICS
    // fallback the empty-rows path uses, so a benchmark-pipeline hiccup doesn't blank
    // the card when the firm has real fund metrics.
    try { await fetchBenchmarkFallback(); } catch(_) {}
  }
}

// Card's per-fund returns table. items: [{ name, color, irr, tvpi, dpi }] — irr in
// percent, tvpi/dpi as multiples (raw or null). Same markup for both card paths.
function _renderBenchMetricsTable(items, asOf) {
  const metricsEl = document.getElementById("benchmark-metrics");
  if (!metricsEl || !items.length) return;
  metricsEl.innerHTML = `
    <div style="margin-top:10px;border-top:1px solid var(--ink-color-global-border-subtle);padding-top:8px;">
      <div style="display:flex;gap:4px;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-transform:uppercase;letter-spacing:.04em;flex:2;">Fund · ${asOf}</span>
        <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;">Net IRR</span>
        <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;">TVPI</span>
        <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;">DPI</span>
      </div>
      ${items.map(it => {
        const shortName = String(it.name).replace(/, L\.P\.$/, "").replace(/, LP$/, "").split(" ").slice(-2).join(" ");
        return `<div style="display:flex;gap:4px;justify-content:space-between;padding:2px 0;">
          <span style="font-size:10px;color:var(--ink-color-global-text-default);flex:2;display:flex;align-items:center;gap:5px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${it.color};flex-shrink:0;"></span>${shortName}
          </span>
          <span style="font-size:10px;color:var(--ink-color-global-text-default);text-align:right;flex:1;font-variant-numeric:tabular-nums;">${it.irr != null ? parseFloat(it.irr).toFixed(1)+"%" : "—"}</span>
          <span style="font-size:10px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;font-variant-numeric:tabular-nums;">${it.tvpi != null ? parseFloat(it.tvpi).toFixed(2)+"x" : "—"}</span>
          <span style="font-size:10px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;font-variant-numeric:tabular-nums;">${it.dpi != null ? parseFloat(it.dpi).toFixed(2)+"x" : "—"}</span>
        </div>`;
      }).join("")}
    </div>`;
}

// Replace the trend chart with a short note (used when there's no peer-benchmark
// series to plot but the card still has fund metrics to show below it).
function _benchShowChartNote(msg) {
  const canvas = document.getElementById("benchmark-chart");
  const wrap = canvas ? canvas.closest(".chart-wrap") : document.querySelector(".card-preview .chart-wrap");
  if (!wrap) return;
  if (_benchmarkChartInst) { _benchmarkChartInst.destroy(); _benchmarkChartInst = null; }
  wrap.innerHTML = `<div class="bench-chart-note">${msg}</div>`;
}

// When the benchmarks table has no qualifying rows, preview the detail page's
// source (AGGREGATE_FUND_METRICS) instead of blanking. Returns false when no fund
// data exists anywhere, leaving the card blank as before.
async function fetchBenchmarkFallback() {
  if (!(await mcpAvailable()) || !_benchmarkFirmId) return false;
  // IRR/TVPI/DPI are almost always null for these firms; TOTAL_VALUE is populated,
  // so the card previews that (with per-fund currency — never assume USD).
  const res = await _mcp("fetch", {
    command: "dwh:execute:query",
    params: {
      sql: `SELECT FUND_NAME, FUND_UUID, TOTAL_VALUE, FUND_REPORTING_CURRENCY, ENDING_TOTAL_NAV, MONTH_END_DATE
            FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
            WHERE FIRM_ID = '${_benchmarkFirmId}'
            QUALIFY ROW_NUMBER() OVER (PARTITION BY FUND_UUID ORDER BY MONTH_END_DATE DESC NULLS LAST) = 1
            ORDER BY ENDING_TOTAL_NAV DESC NULLS LAST
            LIMIT 3`,
      format: 'ndjson',
      response_mode: 'inline',
    }
  });
  if (res.isError) throw new Error("DWH fallback failed");
  const rows = parseDWH(res).filter(r => r.FUND_UUID);
  if (!rows.length) return false;  // no fund data at all — leave the card blank

  rows.forEach((r, i) => { _fundColorMap[r.FUND_NAME] = _BENCH_COLORS[i % _BENCH_COLORS.length]; });
  // AGGREGATE_FUND_METRICS is a latest-month snapshot per fund, not a quarterly
  // series — derive the "as of" label from MONTH_END_DATE when present.
  const asOf = rows[0].MONTH_END_DATE ? _fmtQtr(String(rows[0].MONTH_END_DATE).substring(0, 10)) : "latest";
  _benchShowChartNote("No peer-benchmark trend for this firm yet");
  _renderBenchValueTable(rows.map(r => ({
    name: r.FUND_NAME,
    color: _fundColorMap[r.FUND_NAME],
    value: r.TOTAL_VALUE, currency: r.FUND_REPORTING_CURRENCY,
  })), asOf);
  return true;
}

// Fallback card table: fund + Total Value (currency-correct per fund). Mirrors the
// benchmark table's dot + short-name layout but with one value column.
function _renderBenchValueTable(items, asOf) {
  const metricsEl = document.getElementById("benchmark-metrics");
  if (!metricsEl || !items.length) return;
  metricsEl.innerHTML = `
    <div style="margin-top:10px;border-top:1px solid var(--ink-color-global-border-subtle);padding-top:8px;">
      <div style="display:flex;gap:4px;justify-content:space-between;margin-bottom:4px;">
        <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-transform:uppercase;letter-spacing:.04em;flex:2;">Fund · ${asOf}</span>
        <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;">Total Value</span>
      </div>
      ${items.map(it => {
        const shortName = String(it.name).replace(/, L\.P\.$/, "").replace(/, LP$/, "").split(" ").slice(-2).join(" ");
        return `<div style="display:flex;gap:4px;justify-content:space-between;padding:2px 0;">
          <span style="font-size:10px;color:var(--ink-color-global-text-default);flex:2;display:flex;align-items:center;gap:5px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${it.color};flex-shrink:0;"></span>${shortName}
          </span>
          <span style="font-size:10px;color:var(--ink-color-global-text-default);text-align:right;flex:1;font-variant-numeric:tabular-nums;">${fmtCurrency(it.value, it.currency)}</span>
        </div>`;
      }).join("")}
    </div>`;
}

// ── Static fallback data ──
function populateFallback(reason) {
  const noConnectorMsg = "Can't load your portfolio — add or allow Carta in Settings → Connectors, then reload.";
  renderSOIError(reason || noConnectorMsg);

  const benchMsg = reason || "Can't load fund performance — add or allow Carta in Settings → Connectors, then reload.";
  const benchMetrics = document.getElementById("benchmark-metrics");
  if (benchMetrics && !benchMetrics.textContent.trim()) {
    benchMetrics.innerHTML = `<div style="font-size:11px;color:var(--ink-color-global-feedback-negative-strong);padding-top:8px;">${benchMsg}</div>`;
  }

  const tsLbl = document.getElementById("ts-company-label");
  if (tsLbl) { tsLbl.textContent = "— no data —"; }
}

// Render fund-level summary rows in the home card (value + gain/loss only, no shares)
function renderFundSummaryCard(fundRows) {
  document.getElementById("soi-fund-label").textContent = "FUNDS";
  document.getElementById("soi-rows").innerHTML = fundRows.slice(0, 3).map(f => {
    const glVal = typeof f.gl === 'number' ? f.gl : parseFloat(f.gl ?? 0);
    const glCls = glVal > 0 ? "gl-pos" : glVal < 0 ? "gl-neg" : "";
    const glTxt = glVal === 0 ? "—" : (glVal > 0 ? "+" : "") + fmtShort(Math.abs(glVal));
    const valFmt = typeof f.value === 'number' ? fmtShort(f.value) : (f.value ?? "—");
    return `
    <div class="tbl-row">
      <span class="tbl-col-name">${f.name}</span>
      <span class="tbl-col-val">${valFmt}</span>
      <span class="tbl-col-gl ${glCls}">${glTxt}</span>
    </div>`;
  }).join("");
}

function renderSOIError(msg) {
  document.getElementById("soi-fund-label").textContent = "—";
  document.getElementById("soi-rows").innerHTML =
    `<div class="loading-row" style="color:var(--ink-color-global-feedback-negative-strong); font-size:11px;">${msg}</div>`;
}

function fmtShort(v) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1e9) return "$" + (v/1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v/1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v/1e3).toFixed(0) + "K";
  return "$" + Math.round(v);
}

// ── Tearsheet card state ──
let _tsFirmId = null;
let _tsCompanies = {};  // { issuerName: { heldSince, itdValue, gainLoss, issuerId } }
let _tsIrrMap   = {};   // { issuerName: dealIrr (decimal) }
let _ts409aMap  = {};   // { corpName: { price, currency, date } }

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d).slice(0, 10);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtFull(v) {
  const num = parseFloat(v ?? 0);
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

function fmtDDMmmYYYY(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt)) return String(d).slice(0, 10);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(dt.getDate()).padStart(2,'0')} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

function fmtCurrency(v, curr) {
  if (v == null) return "—";
  const num = parseFloat(v);
  if (isNaN(num)) return "—";
  const abs = Math.abs(num);
  const sym = curr === "USD" || !curr ? "$" : curr + " ";
  const fmt = abs >= 1e6 ? (sym + (abs / 1e6).toFixed(1) + "M")
             : abs >= 1e3 ? (sym + (abs / 1e3).toFixed(1) + "K")
             : (sym + abs.toFixed(2));
  return num < 0 ? "(" + fmt + ")" : fmt;
}

function unwrapEnvelope(text) {
  const s = (text || '').trimStart();
  if (!s.startsWith('{')) return text;
  try { const o = JSON.parse(s); if (o && typeof o.result === 'string') return o.result; } catch (_) {}
  return text;
}

function parseDWH(res) {
  const text = unwrapEnvelope(res?.content?.[0]?.text ?? "");
  const rows = parseNdjson(text).rows;
  return rows.map(r => {
    const out = {};
    Object.keys(r).forEach(k => { out[k.toUpperCase()] = r[k]; });
    return out;
  });
}

// Tearsheet DWH queries are now run inside fetchLiveData (see below).

function selectTSCompany(name) {
  // Update the run-btn prompt
  const runBtn = document.getElementById("ts-run-btn");
  if (runBtn && name) runBtn.dataset.prompt = `Download tear sheets for my investments`;

  if (!name) {
    const heldEl = document.getElementById("ts-held");
    const itdEl  = document.getElementById("ts-itd");
    const glEl2  = document.getElementById("ts-gl");
    const irrEl2 = document.getElementById("ts-irr");
    if (heldEl) heldEl.textContent = "—";
    if (itdEl)  itdEl.textContent  = "—";
    if (glEl2)  glEl2.textContent  = "—";
    if (irrEl2) irrEl2.textContent = "—";
    const r409 = document.getElementById("ts-409a-row");
    if (r409) r409.style.display = "none";
    return;
  }

  const co = _tsCompanies[name];

  // Held since
  const heldEl = document.getElementById("ts-held");
  if (heldEl) heldEl.textContent = co ? fmtDate(co.heldSince) : "—";

  // ITD value
  const itdEl = document.getElementById("ts-itd");
  if (itdEl) itdEl.textContent = co ? fmtCurrency(co.itdValue, "USD") : "—";

  // Gain / loss
  const glEl = document.getElementById("ts-gl");
  if (glEl) {
    if (co) {
      const gl = co.gainLoss;
      glEl.textContent = fmtCurrency(gl, "USD");
      glEl.className = "ts-kpi-val" + (gl > 0 ? " pos" : gl < 0 ? " neg" : "");
    } else {
      glEl.textContent = "—";
      glEl.className = "ts-kpi-val";
    }
  }

  // Deal IRR (stored as decimal, e.g. 0.111 = 11.1%)
  const irrRaw = _tsIrrMap[name];
  const irrEl  = document.getElementById("ts-irr");
  if (irrEl) {
    if (irrRaw != null) {
      const irrPct = (parseFloat(irrRaw) * 100).toFixed(1) + "%";
      irrEl.textContent = irrPct;
      irrEl.className = "ts-kpi-val" + (irrRaw > 0 ? " pos" : irrRaw < 0 ? " neg" : "");
    } else {
      irrEl.textContent = "—";
      irrEl.className = "ts-kpi-val";
    }
  }

  // 409A — match issuerName to corporationName (fuzzy: try exact, then includes)
  const match409a = _ts409aMap[name]
    ?? Object.entries(_ts409aMap).find(([k]) => k.toLowerCase().includes(name.toLowerCase().split(/[,\s]/)[0]))?.[1];
  const row409a = document.getElementById("ts-409a-row");
  if (row409a) {
    if (match409a) {
      const sym = match409a.currency === "USD" || !match409a.currency ? "$" : (match409a.currency + " ");
      const valEl  = document.getElementById("ts-409a-val");
      const dateEl = document.getElementById("ts-409a-date");
      if (valEl)  valEl.textContent  = sym + parseFloat(match409a.price).toFixed(2) + " / sh";
      if (dateEl) dateEl.textContent = fmtDate(match409a.date);
      row409a.style.display = "flex";
    } else {
      row409a.style.display = "none";
    }
  }
}

// ── Live data fetch from Carta MCP ──
async function fetchLiveData() {
  if (!(await mcpAvailable())) {
    // No live connector in this view — use fallback
    populateFallback();
    return;
  }

  try {
    // Step 1: auto-detect the active firm
    // Try list_contexts first — most servers work immediately without welcome.
    // If the server requires welcome() first, call it then retry.
    let ctxRes = await _mcp("list_contexts", {});
    if (ctxRes.isError) {
      // Server requires welcome() initialization — call it, then retry
      try {
        await _mcp("welcome", {});
      } catch (e) { /* safe to ignore if welcome doesn't exist */ }
      await new Promise(r => setTimeout(r, 500));
      ctxRes = await _mcp("list_contexts", {});
    }
    if (ctxRes.isError) throw new Error("context lookup failed");

    let firmId = null;
    let firmName = null;
    // Prefer structured_content (carta-mcp list_contexts) — the prose text
    // format differs between staff and non-staff callers and isn't meant to
    // be parsed. Fall back to regex-parsing the text only for older carta-mcp
    // servers that don't send structured_content yet.
    const payload = extractContextsPayload(ctxRes);
    if (payload) {
      const active = payload.firms.find(f => f && f.is_active) ?? payload.firms[0];
      if (active) {
        firmId = active.firm_id != null ? String(active.firm_id) : null;
        firmName = active.firm_name ?? null;
      }
    } else {
      const ctxText = ctxRes.content?.[0]?.text ?? "";
      // Prefer active firm; fall back to first firm listed
      const activeMatch = ctxText.match(/- ([^\n(]+?)\s*\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\s*\(active\)/i);
      if (activeMatch) {
        firmName = activeMatch[1].trim();
        firmId   = activeMatch[2];
      } else {
        const firstMatch = ctxText.match(/- ([^\n(]+?)\s*\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i);
        if (firstMatch) { firmName = firstMatch[1].trim(); firmId = firstMatch[2]; }
      }
    }
    // Update dashboard subtitle and dynamic prompts with resolved firm name
    if (firmName) {
      _firmDisplayName = firmName;
      const sub = document.getElementById("firm-subtitle");
      if (sub) sub.textContent = firmName;
      // Update any static run-btn prompts that have {{FIRM}} placeholder
      document.querySelectorAll('[data-prompt]').forEach(el => {
        if (el.dataset.prompt.includes('{{FIRM}}')) {
          el.dataset.prompt = el.dataset.prompt.replace(/\{\{FIRM\}\}/g, firmName);
        }
      });
    }

    if (!firmId) { populateFallback("Can't load your portfolio — no active firm in your Carta context."); return; }

    // Await set_context before firing DWH queries — the MCP server requires an active
    // firm context even when FIRM_ID is embedded directly in the SQL.
    try {
      await _mcp("set_context", { firm_id: firmId });
    } catch (_) {}

    _benchmarkFirmId = firmId;  // expose for benchmark fetch
    fetchBenchmarkData();       // kick off in parallel — no await, independent card
    fetchCapitalActivity();     // kick off in parallel — no await, pinned card

    // Step 2: single DWH query — fund names + portfolio values (no set_context or fa:list:entities needed)
    let dwhFundRows = [];
    try {
      const dwhRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT f.FUND_UUID, f.FUND_NAME, SUM(ai.REMAINING_VALUE) AS TOTAL_VALUE, SUM(ai.TOTAL_UNREALIZED_GAIN_LOSS) AS TOTAL_GL FROM FUND_ADMIN.AGGREGATE_INVESTMENTS ai JOIN FUND_ADMIN.FUNDS f ON ai.FUND_UUID = f.FUND_UUID WHERE ai.IS_ACTIVE_INVESTMENT = TRUE AND f.FIRM_ID = '${firmId}' GROUP BY f.FUND_UUID, f.FUND_NAME ORDER BY TOTAL_VALUE DESC NULLS LAST`,
          format: 'ndjson',
          }
      });
      if (!dwhRes.isError) {
        dwhFundRows = parseDWH(dwhRes);
        _soiFundRows = dwhFundRows.map(r => ({
          name:  r.FUND_NAME ?? "Fund",
          value: parseFloat(r.TOTAL_VALUE ?? 0),
          gl:    parseFloat(r.TOTAL_GL ?? 0),
        }));
      }
    } catch (e) { console.error('[DWH error]', e); }

    // Render SOI card
    if (dwhFundRows.length > 0) {
      renderFundSummaryCard(dwhFundRows.map(r => ({
        name:  r.FUND_NAME ?? "Fund",
        value: parseFloat(r.TOTAL_VALUE ?? 0),
        gl:    parseFloat(r.TOTAL_GL ?? 0),
      })));

      // Update section headers from DWH fund names
      const f1 = shortName(dwhFundRows[0]?.FUND_NAME ?? "Fund I");
      const f2 = shortName(dwhFundRows[1]?.FUND_NAME ?? "Fund II");
      const _p1 = document.getElementById("pnl-h1");   if (_p1) _p1.textContent = f1;
      const _p2 = document.getElementById("pnl-h2");   if (_p2) _p2.textContent = f2;
      const _b1 = document.getElementById("bs-h1");    if (_b1) _b1.textContent = f1;
      const _b2 = document.getElementById("bs-h2");    if (_b2) _b2.textContent = f2;
      const _pl = document.getElementById("pnl-label"); if (_pl) _pl.textContent = "CONSOLIDATING P&L · " + (dwhFundRows[0]?.FUND_NAME ?? "");
      const _bl = document.getElementById("bs-label");  if (_bl) _bl.textContent = "BALANCE SHEET · " + (dwhFundRows[0]?.FUND_NAME ?? "");
    } else {
      renderSOIError("No fund data");
    }

    // ── P&L from pre-aggregated STATEMENT_OF_OPS (fast — no journal entry scan) ──
    try {
      const opsRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT
  SUM(UNREALIZED_GAIN_LOSS) AS unrealized_gl,
  SUM(COALESCE(COST_MANAGEMENT_FEES,0)+COALESCE(COST_ALL_OTHER_EXPENSES,0)+COALESCE(COST_LEGAL_FEES,0)+COALESCE(COST_FA_FEES,0)+COALESCE(COST_AUDIT,0)+COALESCE(COST_TAX_PREP_FEES,0)+COALESCE(COST_FILING_FEES,0)+COALESCE(COST_OTHER_PROFESSIONAL_FEES,0)+COALESCE(COST_ORGANIZATION_COSTS,0)+COALESCE(COST_INSURANCE_EXPENSE,0)+COALESCE(COST_TRAVEL,0)+COALESCE(COST_SYNDICATION_COSTS,0)+COALESCE(COST_SOFTWARE_AND_TECHNOLOGY,0)+COALESCE(COST_DUES_AND_SUBSCRIPTIONS,0)+COALESCE(COST_MEAL,0)+COALESCE(COST_ACCOUNTING_EXPENSE,0)+COALESCE(COST_PAYROLL_SALARY,0)+COALESCE(COST_EVENTS,0)) AS total_expenses
FROM FUND_ADMIN.STATEMENT_OF_OPS WHERE FIRM_ID = '${firmId}'`,
          format: 'ndjson',
          }
      });
      if (!opsRes.isError) {
        const r = parseDWH(opsRes)[0] ?? {};
        const gl  = parseFloat(r.UNREALIZED_GL ?? 0);
        const exp = parseFloat(r.TOTAL_EXPENSES ?? 0);
        const net = gl - exp;
        const netFmt   = net < 0 ? '(' + fmtShort(Math.abs(net)) + ')' : fmtShort(net);
        const netColor = net >= 0 ? 'var(--ink-color-global-feedback-positive-strong)' : 'var(--ink-color-global-feedback-negative-strong)';
        const glFmt    = gl < 0  ? '(' + fmtShort(Math.abs(gl))  + ')' : fmtShort(gl);
        const pnlRows = document.getElementById('pnl-rows');
        const pnlFoot = document.getElementById('pnl-foot');
        if (pnlRows) pnlRows.innerHTML = `
          <tr><td>Unrealized Gain/Loss</td><td>${glFmt}</td></tr>
          <tr><td>Total Expenses</td><td>(${fmtShort(exp)})</td></tr>`;
        if (pnlFoot) pnlFoot.innerHTML = `
          <tr><td>Net</td><td style="color:${netColor}">${netFmt}</td></tr>`;
        const _pl = document.getElementById("pnl-label"); if (_pl) _pl.style.display = 'block';
      }
    } catch(e) { console.error('[P&L DWH error]', e); }

    // ── Balance Sheet from pre-aggregated MONTHLY_NAV_CALCULATIONS (fast — single row) ──
    try {
      const navRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT ENDING_TOTAL_NAV, ENDING_LP_NAV, ENDING_GP_NAV, TOTAL_VALUE
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE FIRM_ID = '${firmId}' AND IS_FIRM_ROLLUP = TRUE
ORDER BY MONTH_END_DATE DESC LIMIT 1`,
          format: 'ndjson',
          }
      });
      if (!navRes.isError) {
        const r = parseDWH(navRes)[0] ?? {};
        const portVal  = parseFloat(r.TOTAL_VALUE       ?? 0);
        const lpNav    = parseFloat(r.ENDING_LP_NAV     ?? 0);
        const gpNav    = parseFloat(r.ENDING_GP_NAV     ?? 0);
        const totalNav = parseFloat(r.ENDING_TOTAL_NAV  ?? 0);
        const bsRows = document.getElementById('bs-rows');
        const bsFoot = document.getElementById('bs-foot');
        if (bsRows) bsRows.innerHTML = `
          <tr><td>Portfolio Value</td><td>${fmtShort(portVal)}</td></tr>
          <tr><td>LP NAV</td><td>${fmtShort(lpNav)}</td></tr>
          <tr><td>GP NAV</td><td>${fmtShort(gpNav)}</td></tr>`;
        if (bsFoot) bsFoot.innerHTML = `
          <tr><td>Total NAV</td><td>${fmtShort(totalNav)}</td></tr>`;
        const _bl = document.getElementById("bs-label"); if (_bl) _bl.style.display = 'block';
      }
    } catch(e) { console.error('[BS DWH error]', e); }

    // Tear sheet: run company / IRR / 409A queries sequentially in this same try block
    // (avoids Electron IPC bridge validation errors that occur from a nested async function)
    _tsFirmId = firmId;
    const tsLabelEl = document.getElementById("ts-company-label");
    try {
      // Top company by portfolio value
      const tsCompRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT ISSUER_NAME, MIN(INVESTMENT_DATE) AS HELD_SINCE, SUM(REMAINING_VALUE) AS ITD_VALUE, SUM(TOTAL_UNREALIZED_GAIN_LOSS) AS GAIN_LOSS FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '${firmId}' AND IS_ACTIVE_INVESTMENT = TRUE GROUP BY ISSUER_NAME ORDER BY SUM(REMAINING_VALUE) DESC`,
          format: 'ndjson',
          }
      });
      let topName = null;
      if (!tsCompRes.isError) {
        const compRows = parseDWH(tsCompRes).slice(0, 1); // top-1 only
        _tsCompanies = {};
        compRows.forEach(r => {
          _tsCompanies[r.ISSUER_NAME] = {
            heldSince: r.HELD_SINCE,
            itdValue:  parseFloat(r.ITD_VALUE ?? 0),
            gainLoss:  parseFloat(r.GAIN_LOSS ?? 0)
          };
        });
        topName = compRows[0]?.ISSUER_NAME ?? null;
        if (tsLabelEl) tsLabelEl.textContent = topName ?? "—";
        if (topName) selectTSCompany(topName);
      }

      // Deal IRR — latest per company
      const tsIrrRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT ISSUER_NAME, DEAL_IRR FROM (SELECT ISSUER_NAME, DEAL_IRR, ROW_NUMBER() OVER (PARTITION BY ISSUER_NAME ORDER BY PERFORMANCE_QUARTER_END_DATE DESC) AS rn FROM FUND_ADMIN.TEMPORAL_DEAL_IRR WHERE FIRM_ID = '${firmId}') WHERE rn = 1`,
          format: 'ndjson',
          }
      });
      if (!tsIrrRes.isError) {
        parseDWH(tsIrrRes).forEach(r => { _tsIrrMap[r.ISSUER_NAME] = r.DEAL_IRR; });
      }

      // 409A values — latest per company
      const ts409aRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT b.CORPORATION_NAME, a.PRICE, a.CURRENCY_CODE, a.EFFECTIVE_DATE FROM (SELECT CORPORATION_UUID, PRICE, CURRENCY_CODE, EFFECTIVE_DATE, ROW_NUMBER() OVER (PARTITION BY CORPORATION_UUID ORDER BY EFFECTIVE_DATE DESC) AS rn FROM FUND_ADMIN.IRC409A_VALUE WHERE IS_COMMON = TRUE) a JOIN FUND_ADMIN.CORPORATION_BASIC_INFO_V2 b ON b.CORPORATION_UUID = a.CORPORATION_UUID WHERE b.FIRM_ID = '${firmId}' AND a.rn = 1`,
          format: 'ndjson',
          }
      });
      if (!ts409aRes.isError) {
        parseDWH(ts409aRes).forEach(r => {
          _ts409aMap[r.CORPORATION_NAME] = { price: r.PRICE, currency: r.CURRENCY_CODE, date: r.EFFECTIVE_DATE };
        });
      }

      // Re-render with IRR/409A now populated
      if (topName) selectTSCompany(topName);

    } catch(e) {
      if (tsLabelEl) tsLabelEl.textContent = "— unavailable —";
      console.error("Tearsheet fetch error:", e);
    }

    // ── Valuations: top holdings by MOIC ──
    try {
      const valRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT ISSUER_NAME, SUM(REMAINING_VALUE) AS FMV, SUM(TOTAL_COST) AS COST
FROM FUND_ADMIN.AGGREGATE_INVESTMENTS
WHERE IS_ACTIVE_INVESTMENT = TRUE AND FIRM_ID = '${firmId}'
GROUP BY ISSUER_NAME
HAVING SUM(TOTAL_COST) > 0
ORDER BY SUM(REMAINING_VALUE) / NULLIF(SUM(TOTAL_COST), 0) DESC NULLS LAST
LIMIT 5`,
          format: 'ndjson',
          }
      });
      if (!valRes.isError) {
        const valRows = parseDWH(valRes);
        const valTbl = document.getElementById('val-rows');
        if (valTbl && valRows.length) {
          valTbl.innerHTML = valRows.map(r => {
            const fmv  = parseFloat(r.FMV  ?? 0);
            const cost = parseFloat(r.COST ?? 1);
            const moic = cost > 0 ? fmv / cost : 0;
            const mColor = moic >= 2 ? 'var(--ink-color-global-feedback-positive-strong)' : moic >= 1 ? 'var(--ink-color-global-link-default)' : 'var(--ink-color-global-feedback-negative-strong)';
            const label = (r.ISSUER_NAME ?? '').length > 20
              ? (r.ISSUER_NAME ?? '').slice(0, 20) + '…'
              : (r.ISSUER_NAME ?? '—');
            return `<tr>
              <td title="${r.ISSUER_NAME ?? ''}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px;">${label}</td>
              <td style="text-align:right">${fmtShort(fmv)}</td>
              <td style="text-align:right;font-weight:600;color:${mColor}">${moic.toFixed(2)}x</td>
            </tr>`;
          }).join('');
        } else if (valTbl) {
          valTbl.innerHTML = '<tr><td colspan="3" style="color:var(--ink-color-global-text-subtle);font-style:italic">No portfolio data</td></tr>';
        }
      }
    } catch(e) { console.error('[Valuations error]', e); }

    // ── ManCo & budgeting: expense actuals by category from STATEMENT_OF_OPS ──
    try {
      const mancoRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT
  SUM(COALESCE(COST_MANAGEMENT_FEES,0))           AS mgmt_fees,
  SUM(COALESCE(COST_LEGAL_FEES,0))                AS legal,
  SUM(COALESCE(COST_FA_FEES,0))                   AS fa_fees,
  SUM(COALESCE(COST_AUDIT,0))                     AS audit,
  SUM(COALESCE(COST_TAX_PREP_FEES,0))             AS tax_prep,
  SUM(COALESCE(COST_PAYROLL_SALARY,0))            AS payroll,
  SUM(COALESCE(COST_SOFTWARE_AND_TECHNOLOGY,0))   AS software,
  SUM(COALESCE(COST_ALL_OTHER_EXPENSES,0))        AS other_exp
FROM FUND_ADMIN.STATEMENT_OF_OPS WHERE FIRM_ID = '${firmId}'`,
          format: 'ndjson',
          }
      });
      if (!mancoRes.isError) {
        const mr = parseDWH(mancoRes)[0] ?? {};
        const cats = [
          { label: 'Management fees', val: parseFloat(mr.MGMT_FEES  ?? 0) },
          { label: 'Legal',           val: parseFloat(mr.LEGAL      ?? 0) },
          { label: 'Fund admin fees', val: parseFloat(mr.FA_FEES    ?? 0) },
          { label: 'Audit',           val: parseFloat(mr.AUDIT      ?? 0) },
          { label: 'Tax prep',        val: parseFloat(mr.TAX_PREP   ?? 0) },
          { label: 'Payroll/salary',  val: parseFloat(mr.PAYROLL    ?? 0) },
          { label: 'Software/tech',   val: parseFloat(mr.SOFTWARE   ?? 0) },
          { label: 'Other',           val: parseFloat(mr.OTHER_EXP  ?? 0) },
        ].filter(c => c.val > 0).sort((a, b) => b.val - a.val).slice(0, 5);
        const total = cats.reduce((s, c) => s + c.val, 0);
        const mancoRowsEl = document.getElementById('manco-rows');
        const mancoFootEl = document.getElementById('manco-foot');
        if (mancoRowsEl) {
          if (cats.length) {
            mancoRowsEl.innerHTML = cats.map(c =>
              `<tr><td>${c.label}</td><td>${fmtShort(c.val)}</td></tr>`
            ).join('');
            if (mancoFootEl) mancoFootEl.innerHTML = `<tr><td><strong>Total actuals</strong></td><td><strong>${fmtShort(total)}</strong></td></tr>`;
          } else {
            mancoRowsEl.innerHTML = '<tr><td colspan="2" style="color:var(--ink-color-global-text-subtle);font-style:italic">No expense data</td></tr>';
          }
        }
      }
    } catch(e) { console.error('[ManCo error]', e); }

    // ── Compliance: Form ADV regulatory AUM ──
    // Tries FORM_ADV_FUND_DETAIL first; falls back to MONTHLY_NAV_CALCULATIONS total NAV as proxy
    try {
      let disc = 0, nonDisc = 0, total = 0, source = 'nav';

      // NOTE (2026-08-27): FUND_ADMIN.FORM_ADV_FUND_DETAIL does not exist in the warehouse.
      // Disabled, not removed — this always falls through to the NAV fallback below.
      // // Attempt 1: dedicated Form ADV table
      // try {
      //   const advRes = await _mcp("fetch", {
      //     command: "dwh:execute:query",
      //     params: {
      //       sql: `SELECT
      //   SUM(DISCRETIONARY_AUM)     AS disc,
      //   SUM(NON_DISCRETIONARY_AUM) AS non_disc
      // FROM FUND_ADMIN.FORM_ADV_FUND_DETAIL WHERE FIRM_ID = '${firmId}'`
      //     }
      //   });
      //   if (!advRes.isError) {
      //     const ar = parseDWH(advRes)[0] ?? {};
      //     const d = parseFloat(ar.DISC ?? 0), nd = parseFloat(ar.NON_DISC ?? 0);
      //     if (d > 0 || nd > 0) { disc = d; nonDisc = nd; total = d + nd; source = 'formadv'; }
      //   }
      // } catch (_) { /* table may not exist — fall through */ }

      // Fallback: total NAV from MONTHLY_NAV_CALCULATIONS (VC funds = effectively all discretionary)
      if (source === 'nav') {
        const navFallRes = await _mcp("fetch", {
          command: "dwh:execute:query",
          params: {
            sql: `SELECT ENDING_TOTAL_NAV
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE FIRM_ID = '${firmId}' AND IS_FIRM_ROLLUP = TRUE
ORDER BY MONTH_END_DATE DESC LIMIT 1`,
            format: 'ndjson',
              }
        });
        if (!navFallRes.isError) {
          const nr = parseDWH(navFallRes)[0] ?? {};
          total = parseFloat(nr.ENDING_TOTAL_NAV ?? 0);
          disc = total; nonDisc = 0; // typical VC: all discretionary
        }
      }

      const advRowsEl = document.getElementById('formadv-rows');
      const advFootEl = document.getElementById('formadv-foot');
      if (advRowsEl && total > 0) {
        advRowsEl.innerHTML = `
          <tr><td>Discretionary AUM</td><td>${fmtShort(disc)}</td></tr>
          <tr><td>Non-discretionary AUM</td><td>${fmtShort(nonDisc)}</td></tr>`;
        if (advFootEl) advFootEl.innerHTML = `<tr><td><strong>Total Regulatory AUM</strong></td><td><strong>${fmtShort(total)}</strong></td></tr>`;
        if (source === 'nav') {
          const preview = document.getElementById('formadv-preview');
          if (preview) {
            const note = document.createElement('div');
            note.style.cssText = 'font-size:9px;color:var(--ink-color-global-text-subtle);margin-top:6px;';
            note.textContent = 'Derived from fund NAV · run Form ADV skill for official filing figures';
            preview.appendChild(note);
          }
        }
      } else if (advRowsEl) {
        advRowsEl.innerHTML = '<tr><td colspan="2" style="color:var(--ink-color-global-text-subtle);font-style:italic">No regulatory AUM data</td></tr>';
      }
    } catch(e) { console.error('[FormADV error]', e); }

  } catch (err) {
    console.error("Carta MCP fetch error:", err);
    // Connector-level codes rethrow from _mcp and land here. Each has a different fix,
    // so name it — one generic banner hides the action that would repair the page.
    renderSOIError(SOI_ERROR_BY_CODE[err?.code]
      || "Can't load your portfolio — something went wrong reaching Carta.");
  }
}

const SOI_ERROR_BY_CODE = {
  needs_reauth:         "Can't load your portfolio — reconnect Carta in Settings → Connectors.",
  server_not_connected: "Can't load your portfolio — add the Carta connector in Settings → Connectors.",
  selection_required:   "Can't load your portfolio — choose which Carta connector to use.",
  server_unavailable:   "Can't load your portfolio — Carta didn't respond. Reload to retry.",
  blocked_by_policy:    "Can't load your portfolio — your organization's policy blocks this.",
  approval_required:    "Can't load your portfolio — this needs approval from your organization.",
};

// ── Helpers ──
function tryParse(str) { try { return JSON.parse(str); } catch { return null; } }
function fmtMark(val) {
  if (val == null) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  if (n >= 1e9) return "$" + (n/1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n/1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n/1e3).toFixed(0) + "K";
  return "$" + n.toFixed(0);
}
function fmtMoic(val) {
  if (val == null) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : n.toFixed(1) + "x";
}
function shortName(name) {
  if (!name) return "Fund";
  // e.g. "your firm" → "Fund III"
  const m = name.match(/(Fund\s+(?:I{1,3}|IV|V{1,3}|\d+))/i);
  return m ? m[1] : name.split(" ").slice(-2).join(" ");
}

// ── Helpers ──
function parseNdjson(text) {
  const rows = [];
  let nextOffset = null;
  if (!text) return { rows, nextOffset };

  let body = text;
  const stripped = text.trimStart();
  const firstLine = stripped.split('\n')[0] || '';
  if (firstLine.startsWith('total_rows:') && text.includes('\n\n')) {
    const m = firstLine.match(/next_offset:\s*(\d+)/);
    if (m) nextOffset = parseInt(m[1], 10);
    body = text.slice(text.indexOf('\n\n') + 2);
  }

  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('(Result truncated')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) rows.push(obj);
    } catch (e) {
      console.warn('parseNdjson: skipping malformed line', e);
    }
  }
  return { rows, nextOffset };
}
function fmtSharesShort(v) {
  if (v == null || v === '' || v === 'NULL') return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  if (n >= 1e6) return (n/1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n/1e3) + "K";
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}


function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Dashboard launchers ──
// A dashboard published during the build gets a link; one that was skipped falls back to
// its prompt, which is the same copy affordance the skill directory uses.
// The link navigates in place, so the artifact switcher and the browser's own back control
// both lead back here — the dashboards need no back link of their own.
function renderDashboardLaunchers() {
  DASHBOARDS.forEach(d => {
    const footer = document.getElementById(d.footerId);
    if (!footer) return;
    const url = DASHBOARD_URLS[d.key];
    footer.innerHTML = url
      ? `<a class="run-btn" href="${escHtml(url)}"
            onclick="trackHome('click','CartaHome.Dashboard.Open.${escHtml(d.key)}')">${escHtml(d.label)} →</a>`
      : `<button class="run-btn" data-prompt="${escHtml(d.prompt)}" data-skill="${escHtml(d.key)}"
            onclick="dashShowPrompt(this)">${escHtml(d.label)}</button>`;
  });
}

// Launchers are built after the .run-btn[data-prompt] binding pass has run, so they
// carry their own handler into the same popover every other run button uses.
function dashShowPrompt(btn) {
  trackHome("click", "CartaHome.Dashboard.CopyPrompt." + (btn.dataset.skill || ''));
  showPromptPopover(btn, btn.dataset.prompt, btn.dataset.skill);
}

// ── Customize popover ──
let customizeSource = null; // 'soi' | 'perf'

const CUSTOMIZE_PROMPTS = {
  soi: {
    data: [
      "Show only investments where unrealized gain / loss is negative, sorted by largest loss first. Update the Schedule of Investments dashboard with this.",
      "Group holdings by sector and show sector-level subtotals for cost basis and current value. Update the Schedule of Investments dashboard with this.",
      "Add a 'Days held' column and sort the table by oldest investment first. Update the Schedule of Investments dashboard with this.",
    ],
    ui: [
      "Color each row green when gain/loss is positive and red when negative, with a subtle row tint. Update the Schedule of Investments dashboard with this.",
      "Add a mini sparkline column showing value trend over the last 4 quarters for each company. Update the Schedule of Investments dashboard with this.",
      "Export this table to Excel with a separate tab per fund. Update the Schedule of Investments dashboard with this.",
    ],
  },
  perf: {
    data: [
      "Show Net IRR, TVPI, and DPI for all my funds in a single side-by-side comparison table. Update the Fund Performance dashboard with this.",
      "Add a scatter plot of MOIC vs holding period for each portfolio company. Update the Fund Performance dashboard with this.",
      "Compare my fund's DPI progression against the P50 benchmark, quarter by quarter. Update the Fund Performance dashboard with this.",
    ],
    ui: [
      "Shade the area between P25 and P75 as a benchmark band behind the IRR line. Update the Fund Performance dashboard with this.",
      "Show only the last 8 quarters in each chart and add a toggle to view all time. Update the Fund Performance dashboard with this.",
      "Make the legend interactive — click a line label to show or hide that series. Update the Fund Performance dashboard with this.",
    ],
  },
};

function openCustomize(source) {
  trackHome("click", "CartaHome.Customize.Open." + (source === "soi" ? "SOI" : "Perf"));
  customizeSource = source;
  const popover = document.getElementById('customize-popover');
  const body = document.getElementById('customize-body');
  const prompts = CUSTOMIZE_PROMPTS[source] || CUSTOMIZE_PROMPTS.soi;

  body.innerHTML = Object.entries(prompts).map(([group, items]) => `
    <div class="cust-section-label">${group === 'data' ? 'Data' : 'Layout &amp; UI'}</div>
    ${items.map(p => `
      <div class="cust-prompt-card">
        <div class="cust-prompt-text">${escHtml(p.split('. Update the ')[0] + '.')}</div>
        <button class="cust-copy-btn" data-prompt="${escHtml(p)}" onclick="copyPrompt(this)"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy</button>
      </div>
    `).join('')}
  `).join('');

  popover.classList.add('open');
}

function closeCustomize() {
  const popover = document.getElementById('customize-popover');
  if (popover) popover.classList.remove('open');
}

// Clipboard write with an execCommand fallback: some hosts block the async API.
function writeClipboard(text, feedback) {
  const fallback = (str) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch(e) { return false; }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(feedback).catch(() => {
      fallback(text) ? feedback() : showToast('Could not copy to clipboard');
    });
  } else {
    fallback(text) ? feedback() : showToast('Could not copy to clipboard');
  }
}

function copyPrompt(btn) {
  trackHome("click", "CartaHome.Customize.CopyPrompt." + (customizeSource === "perf" ? "Perf" : "SOI"));
  const text = btn.dataset.prompt || '';
  const feedback = () => {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy';
      btn.classList.remove('copied');
    }, 2000);
  };
  writeClipboard(text, feedback);
}

function renderCapabilities(recs) {
  const dynamic = document.getElementById("cap-grid-dynamic");
  const fallback = document.getElementById("cap-grid-static");
  if (!dynamic) return;

  const live = Array.isArray(recs) ? recs.filter(r => !r.is_skill_gap && r.recommended_prompt) : [];
  if (!live.length) {
    // No personalized recs — keep static fallback visible (default state)
    return;
  }

  const colors = ["cap-card-blue", "cap-card-teal", "cap-card-amber", "cap-card-violet"];
  const copySvg = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="margin-right:5px;vertical-align:middle;"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy this prompt';

  // Static prompts used to pad when user has fewer than 4 personalized recs.
  // `topics` drive de-duplication: a pad is skipped when a personalized prompt
  // already covers the same subject, so we never show two cards about one thing.
  const staticPad = [
    {
      text: "Use my firm's tear sheet template and generate tear sheets for this quarter",
      topics: ["tear sheet", "tearsheet"],
    },
    {
      text: "Show me my firm's balance sheet as of this month",
      topics: ["balance sheet"],
    },
    {
      text: "What is our regulatory AUM",
      topics: ["regulatory aum", "aum", "assets under management"],
    },
    {
      text: "Compare YTD actuals against the budget",
      topics: ["budget", "actuals"],
    },
  ];

  const prompts = live.slice(0, 4).map(r => r.recommended_prompt);
  const haystack = prompts.join(" ").toLowerCase();
  const covered = pad => pad.topics.some(t => haystack.includes(t));

  // Pad to 4, preferring prompts on subjects the personalized set doesn't cover.
  // Each duplicate filtered here is a rec already occupying a card, so the
  // preferred pass alone fills the grid in every case except one prompt matching
  // two pads. The second pass backfills from what was skipped so the grid is
  // always 4 cards.
  for (const pad of staticPad) {
    if (prompts.length >= 4) break;
    if (!covered(pad) && !prompts.includes(pad.text)) prompts.push(pad.text);
  }
  for (const pad of staticPad) {
    if (prompts.length >= 4) break;
    if (!prompts.includes(pad.text)) prompts.push(pad.text);
  }

  dynamic.innerHTML = prompts.map((prompt, i) => {
    const escaped = prompt.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<div class="cap-card ${colors[i % colors.length]}" onclick="this.querySelector('.cap-card-icon').click()">
      <div class="cap-card-text">${escaped}</div>
      <button class="cap-card-icon" data-prompt="${escaped}" onclick="event.stopPropagation(); capCopy(this)">${copySvg}</button>
    </div>`;
  }).join("");

  dynamic.style.display = "";
  if (fallback) fallback.style.display = "none";
}

function capCopy(btn) {
  trackHome("click", "CartaHome.Capabilities.CopyPrompt");
  const text = btn.dataset.prompt || '';
  const copySvg = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="margin-right:5px;vertical-align:middle;"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy this prompt';
  const feedback = () => {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = copySvg;
      btn.classList.remove('copied');
    }, 2000);
  };
  writeClipboard(text, feedback);
}

document.addEventListener('click', function(e) {
  const popover = document.getElementById('customize-popover');
  if (popover?.classList.contains('open') &&
      !popover.contains(e.target) &&
      !e.target.closest('[onclick*="openCustomize"]')) {
    closeCustomize();
  }
});

// ── User enrichment (get_current_user) → entitlement-gated skill directory ──
// Fetch the signed-in user's Carta profile, log the FULL payload where the LLM client
// can read it (Cowork surfaces artifact console output), and keep the product flags
// that decide which Skill Directory categories are shown.
let _userEntitlements = {};  // product flags (manco, tactyc); true/false/null-unknown
let _enrichmentDone = false; // flips true once get_current_user resolves/fails/times out
let _dirTabOpened = false;   // has the user opened the Skill directory tab this session
// Collect every plausible "actual payload" object out of a callTool result: `payload`,
// `structuredContent`, content[].text as a JSON string, or a {result:"<json>"} wrapper.
// Order is candidate-priority, not confidence — callers apply their own predicate.
function _mcpResultCandidates(res) {
  const cands = [];
  const add = v => {
    if (typeof v === "string") { const p = tryParse(v); if (p) cands.push(p); }
    else if (v && typeof v === "object") { cands.push(v); if (typeof v.result === "string") { const p = tryParse(v.result); if (p) cands.push(p); } }
  };
  if (res && typeof res === "object") {
    add(res.payload);
    add(res);
    add(res.structuredContent);
    add(res.result);
    if (Array.isArray(res.content)) res.content.forEach(c => { if (c && c.type === "text") add(c.text); });
  }
  return cands;
}

// Dig the user-profile object out of the result. Returns the first candidate that has
// firm_ui_categories, else the first object-shaped candidate, else {}.
function extractUserProfile(res) {
  const cands = _mcpResultCandidates(res);
  const norm = c => (c && (c.user || c.profile)) || c;
  const isProfile = p => p && typeof p === "object" && ("pk" in p || "firm_ui_categories" in p || "recommendations" in p || "has_fund_admin" in p);
  for (const c of cands) { const p = norm(c); if (p && Array.isArray(p.firm_ui_categories)) return p; }
  for (const c of cands) { const p = norm(c); if (isProfile(p)) return p; }
  return {};
}

// Extract the {firms, active_firm_id} structured payload from a list_contexts
// result (see carta-mcp's list_contexts structured_content). Returns null if
// no candidate carries a firms array — an older carta-mcp server that hasn't
// picked up structured_content yet, or a transport hiccup — callers should
// fall back to parsing the prose text.
function extractContextsPayload(res) {
  const cands = _mcpResultCandidates(res);
  for (const c of cands) { if (c && Array.isArray(c.firms)) return c; }
  return null;
}

// Read one boolean product flag off the profile. carta-mcp lowercases the warehouse
// column names on the way out (FIRM_UI_CATEGORIES → firm_ui_categories), so accept
// either spelling. Anything that isn't a real boolean — key absent, null, a staff
// account whose enrichment was stripped — returns null meaning "unknown", which the
// directory filter treats as "show", never as "deny".
function readProductFlag(profile, key) {
  const v = profile[key] !== undefined ? profile[key] : profile[key.toUpperCase()];
  return typeof v === "boolean" ? v : null;
}

async function fetchUserEnrichment() {
  // No poll needed: claude.use("mcp") settles on its own once the view knows.
  if (!(await mcpAvailable())) { markEnrichmentDone(); return; }
  try {
    const res = await _mcp("get_current_user", {});
    console.log("[carta-home][debug] get_current_user full payload:\n" + JSON.stringify(res, null, 2));
    if (res && res.isError) return;

    // The result comes back in one of several shapes: the profile object directly,
    // an MCP envelope with content[].text holding the profile JSON string, or a
    // structuredContent wrapper like {result:"<json>"}. Collect every candidate and
    // pick the one that actually carries firm_ui_categories — don't assume a shape.
    const profile = extractUserProfile(res);
    console.log("[carta-home][debug] firm_ui_categories:", JSON.stringify(profile.firm_ui_categories));

    _userEntitlements = {
      manco:  readProductFlag(profile, "has_active_manco"),
      tactyc: readProductFlag(profile, "has_tactyc"),
    };
    console.log("[carta-home][debug] resolved entitlements:", JSON.stringify(_userEntitlements));

    renderCapabilities(profile.recommendations);
  } catch (e) {
    console.error("[carta-home][debug] get_current_user error:", e);
  } finally {
    markEnrichmentDone();
  }
}

// Enrichment is finished (resolved, failed, or absent): re-render the directory if
// the user is already looking at it, so the first render is always the filtered one.
function markEnrichmentDone() {
  if (_enrichmentDone) return;
  _enrichmentDone = true;
  if (_dirTabOpened) renderDirectory();
}

// ── Init ──
console.log("[carta-home] build {{BUILD_ID}}");
trackHome("render", "CartaHome.View");
renderDashboardLaunchers();  // static — no firm context needed, so it paints before any fetch
fetchLiveData();       // also triggers fetchBenchmarkData() once firmId is resolved
fetchUserEnrichment(); // get_current_user → debug log + entitlement directory filter
// Safety net: never leave the directory stuck on "Personalizing…" if enrichment hangs.
setTimeout(markEnrichmentDone, 5000);

// ── Re-tint canvas text when the OS theme flips mid-session ──
// CSS handles itself via light-dark(); canvas text is baked in at draw time.
// Guard the result too — `matchMedia?.(…)` short-circuits to undefined when
// matchMedia is absent, so chaining .addEventListener off it would still throw.
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
  if (!window.Chart) return;
  const color = chartLabelColor();
  Chart.defaults.color = color;
  document.querySelectorAll("canvas").forEach(cv => {
    const chart = Chart.getChart(cv);
    if (!chart) return;
    Object.values(chart.options.scales || {}).forEach(scale => {
      if (scale.ticks) scale.ticks.color = color;
    });
    const legendLabels = chart.options.plugins?.legend?.labels;
    if (legendLabels) legendLabels.color = color;
    chart.update("none");
  });
});

// ── Banner dismiss (in-memory — sandbox blocks localStorage) ──
// ── Tab switcher ──
function switchTab(id) {
  trackHome("click", "CartaHome.Tab." + (id === "recommended" ? "Recommended" : "Directory"));
  ['recommended', 'directory'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === id);
    document.getElementById('tab-btn-' + t).classList.toggle('active', t === id);
  });
  if (id === 'directory') {
    _dirTabOpened = true;
    renderDirectory();
  }
}


function dirCopyPrompt(btn) {
  trackHome("click", "CartaHome.Directory.Copy");
  const text = btn.dataset.prompt || '';
  const feedback = () => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'; btn.classList.remove('copied'); }, 2000);
  };
  writeClipboard(text, feedback);
}

function renderDirectory() {
  const firm = _firmDisplayName;
  const grid = document.getElementById('dir-grid');
  if (!grid) return;
  // First-render guard: while get_current_user is still in flight, show a brief
  // personalizing state instead of the unfiltered full list — markEnrichmentDone()
  // re-renders this with the role filter applied. (Skipped with no MCP, e.g. local
  // preview, where enrichment can't run and we just show everything.)
  if (!_enrichmentDone && _mcpLive !== false) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:24px 0;color:var(--ink-color-global-text-subtle);font-size:13px;">Personalizing your directory…</div>';
    return;
  }
  // Gates categories and skills alike: drop either only on an explicit false, so an
  // unknown flag still shows it. A category left with no skills drops out too.
  const entitled = x => !x.requires || _userEntitlements[x.requires] !== false;
  const cats = DIR_CATEGORIES
    .filter(entitled)
    .map(cat => Object.assign({}, cat, { skills: cat.skills.filter(entitled) }))
    .filter(cat => cat.skills.length > 0);
  grid.innerHTML = cats.map(cat => `
    <div class="dir-cat-card">
      <div class="dir-cat-header">
        <div>
          <span class="dir-cat-name">${cat.name}</span>
        </div>
      </div>
      <div class="dir-cat-tagline">${cat.tagline}</div>
      <ul class="dir-skill-list">
        ${cat.skills.map(s => {
          // A `note` skill is guidance, not something to paste into chat — render the
          // text plain, with no quotes and no copy button.
          const body = s.prompt
            ? `<div class="dir-skill-prompt">
              <span class="dir-skill-prompt-text">"${escHtml(s.prompt.replace(/\{\{FIRM\}\}/g, firm))}"</span>
              <button class="dir-copy-btn" data-prompt="${escHtml(s.prompt.replace(/\{\{FIRM\}\}/g, firm))}" onclick="dirCopyPrompt(this)"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
            </div>`
            : `<div class="dir-skill-note">${escHtml((s.note || '').replace(/\{\{FIRM\}\}/g, firm))}</div>`;
          return `
          <li class="dir-skill-item">
            <div class="dir-skill-name">${escHtml(s.name)}</div>
            ${body}
          </li>`;
        }).join('')}
      </ul>
    </div>
  `).join('');
}

// ── Guided Tour ──
const TOUR_KEY = 'carta-home-tour-v1';

const TOUR_STEPS = [
  {
    id:    'tab-btn-recommended',
    title: 'Welcome to Carta Home',
    desc:  'Carta home is the place to customize Carta data into any way you would like to see it. We have pre-populated it with a few stubs to get you started.',
  },
  {
    id:        'ca-section-v2',
    title:     'Capital activity',
    desc:      'See active capital activity right here without having to open Carta.com',
    forceShow: true,
  },
  {
    id:    'dashboards-section',
    title: 'Pre-built dashboards',
    desc:  'Live views of Schedule of investments and Fund performance data from your firm.',
  },
  {
    id:    'tab-btn-directory',
    title: 'Skill directory',
    desc:  'Skill directory contains all the skills available in the Carta plugin so you can keep up to date with the latest functionality.',
  },
];

let _tourIdx = 0;
let _tourRestoreEl = null;
let _tourRestoreVal = '';
// Element that had focus when the tour opened, so focus can be handed back on
// exit. The tour currently auto-starts, so this is usually <body>.
let _tourReturnFocusEl = null;

function tourStart() {
  trackHome("click", "CartaHome.Tour.Start");
  if (localStorage.getItem(TOUR_KEY)) return;
  _tourReturnFocusEl = document.activeElement;
  _tourIdx = 0;
  _tourPaint();
}

function _tourIsOpen() {
  // The overlay is the earliest signal: _tourPaint shows it synchronously,
  // whereas the tooltip only appears after the 80ms layout-settle timeout.
  const overlay = document.getElementById('tour-overlay');
  return !!overlay && overlay.style.display === 'block';
}

function _tourGetEl(step) {
  if (step.id)  return document.getElementById(step.id);
  if (step.sel) return document.querySelector(step.sel);
  return null;
}

function _tourRestore() {
  if (_tourRestoreEl) {
    _tourRestoreEl.style.display = _tourRestoreVal;
    _tourRestoreEl  = null;
    _tourRestoreVal = '';
  }
}

function _tourPaint() {
  const step      = TOUR_STEPS[_tourIdx];
  const overlay   = document.getElementById('tour-overlay');
  const spotlight = document.getElementById('tour-spotlight');
  const tooltip   = document.getElementById('tour-tooltip');

  _tourRestore();

  let el = _tourGetEl(step);

  // Temporarily show hidden elements (e.g. capital activity section)
  if (el && step.forceShow && window.getComputedStyle(el).display === 'none') {
    _tourRestoreEl  = el;
    _tourRestoreVal = el.style.display;
    el.style.display = 'block';
  }

  // Scroll into view instantly so getBoundingClientRect is accurate
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'instant' });

  overlay.style.display = 'block';

  // Small delay to let layout settle after scroll/display change
  setTimeout(() => {
    if (!el) {
      spotlight.style.display = 'none';
      spotlight.style.boxShadow = '';
    } else {
      const r = el.getBoundingClientRect();
      const p = 8;
      spotlight.style.display  = 'block';
      spotlight.style.top      = (r.top  - p) + 'px';
      spotlight.style.left     = (r.left - p) + 'px';
      spotlight.style.width    = (r.width  + p*2) + 'px';
      spotlight.style.height   = (r.height + p*2) + 'px';
      // Scrim + focus ring both come from Ink tokens. Orange is notification-only,
      // so the ring is border-active, not #FF7D55. The scrim darkens from 0.52 to
      // the token's 0.8 alpha — intentional: surface-background-overlay is canonical.
      spotlight.style.boxShadow =
        '0 0 0 9999px var(--ink-color-global-surface-background-overlay), '
        + '0 0 0 2.5px var(--ink-color-global-border-active)';
    }

    // Tooltip content
    document.getElementById('tour-title').textContent   = step.title;
    document.getElementById('tour-desc').textContent    = step.desc;
    document.getElementById('tour-counter').textContent = `${_tourIdx + 1} of ${TOUR_STEPS.length}`;
    document.getElementById('tour-next-btn').textContent =
      _tourIdx < TOUR_STEPS.length - 1 ? 'Next →' : 'Get started';

    // Progress dots — the container is role="group" aria-label="Tour progress"
    // in the template, so the active dot marks itself as the current step.
    document.getElementById('tour-dots').innerHTML = TOUR_STEPS
      .map((_, i) => `<div class="tour-dot${i === _tourIdx ? ' active' : ''}"${i === _tourIdx ? ' aria-current="step"' : ''}></div>`).join('');

    // Position tooltip relative to spotlight
    tooltip.style.display = 'block';
    if (el) {
      const r   = el.getBoundingClientRect();
      const p   = 8;
      const ttw = 308;
      const gap = 14;
      const mv  = 12;
      const vw  = window.innerWidth;
      const vh  = window.innerHeight;
      let top  = r.bottom + p + gap;
      let left = r.left + r.width / 2 - ttw / 2;

      // If below goes off-screen, flip above
      if (top + 230 > vh) top = r.top - p - gap - 200;

      // Clamp horizontally
      left = Math.max(mv, Math.min(left, vw - ttw - mv));
      top  = Math.max(mv, top);

      tooltip.style.top       = top  + 'px';
      tooltip.style.left      = left + 'px';
      tooltip.style.transform = '';
    } else {
      tooltip.style.top       = '50%';
      tooltip.style.left      = '50%';
      tooltip.style.transform = 'translate(-50%,-50%)';
    }

    // Hand focus to the primary action so the dialog is keyboard-operable and
    // announced on open. preventScroll: the tooltip is position:fixed, so there
    // is nothing to scroll to and scrolling would fight the spotlight.
    document.getElementById('tour-next-btn')?.focus({ preventScroll: true });
  }, 80);
}

function tourNext() {
  trackHome("click", "CartaHome.Tour.Next");
  _tourIdx++;
  if (_tourIdx >= TOUR_STEPS.length) tourEnd();
  else _tourPaint();
}

function tourSkip() { trackHome("click", "CartaHome.Tour.Skip"); tourEnd(); }

function tourEnd() {
  _tourRestore();
  localStorage.setItem(TOUR_KEY, '1');
  ['tour-overlay','tour-spotlight','tour-tooltip'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  // Return focus to whatever opened the tour; skip <body> and detached nodes.
  const back = _tourReturnFocusEl;
  _tourReturnFocusEl = null;
  if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') {
    back.focus({ preventScroll: true });
  }
}

// Click the dark overlay to advance
document.getElementById('tour-overlay').addEventListener('click', tourNext);

// Escape ends the tour (dialog semantics — the tooltip is role="dialog").
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape' && e.key !== 'Esc') return;
  if (!_tourIsOpen()) return;
  e.preventDefault();
  tourEnd();
});

// Launch on first load after data fetch begins
setTimeout(tourStart, 800);
