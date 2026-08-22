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
      }
    });
    if (res.isError) throw new Error("DWH failed");
    const rows = parseDWH(res);
    if (!rows.length) return;

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

    // Generic palette — cycles for any number of funds
    const DATA_VIZ_COLORS = ["#285DA3","#2D9E90","#DDB31F","#94B524","#B29990","#58B8BC","#656B6B"];
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

    const metricsEl = document.getElementById("benchmark-metrics");
    if (metricsEl && Object.keys(latestByFund).length) {
      const asOf = _fmtQtr(Object.values(latestByFund)[0].PERFORMANCE_QUARTER_START_DATE);
      metricsEl.innerHTML = `
        <div style="margin-top:10px;border-top:1px solid var(--ink-color-global-border-subtle);padding-top:8px;">
          <div style="display:flex;gap:4px;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-transform:uppercase;letter-spacing:.04em;flex:2;">Fund · ${asOf}</span>
            <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;">Net IRR</span>
            <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;">TVPI</span>
            <span style="font-size:9px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;">DPI</span>
          </div>
          ${Object.values(latestByFund).map(r => {
            const shortName = r.FUND_NAME.replace(/, L\.P\.$/, "").replace(/, LP$/, "").split(" ").slice(-2).join(" ");
            const color = _fundColorMap[r.FUND_NAME] || "#285DA3";
            return `<div style="display:flex;gap:4px;justify-content:space-between;padding:2px 0;">
              <span style="font-size:10px;color:var(--ink-color-global-text-default);flex:2;display:flex;align-items:center;gap:5px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>${shortName}
              </span>
              <span style="font-size:10px;color:var(--ink-color-global-text-default);text-align:right;flex:1;font-variant-numeric:tabular-nums;">${r.NET_IRR != null ? parseFloat(r.NET_IRR).toFixed(1)+"%" : "—"}</span>
              <span style="font-size:10px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;font-variant-numeric:tabular-nums;">${r.TVPI != null ? parseFloat(r.TVPI).toFixed(2)+"x" : "—"}</span>
              <span style="font-size:10px;color:var(--ink-color-global-text-subtle);text-align:right;flex:1;font-variant-numeric:tabular-nums;">${r.DPI != null ? parseFloat(r.DPI).toFixed(2)+"x" : "—"}</span>
            </div>`;
          }).join("")}
        </div>`;
    }
  } catch(e) {
    // silent fail — card stays blank rather than showing bad data
  }
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

// Keep renderSOI for the full SOI overlay page (company-level rows with shares)
function renderSOI(fundName, rows) {
  document.getElementById("soi-fund-label").textContent = fundName;
  document.getElementById("soi-rows").innerHTML = rows.map(r => {
    const glVal = r.gl ?? 0;
    const glCls = glVal > 0 ? "gl-pos" : glVal < 0 ? "gl-neg" : "";
    const glTxt = glVal === 0 ? "—" : (glVal > 0 ? "+" : "") + fmtShort(Math.abs(glVal));
    return `
    <div class="tbl-row">
      <span class="tbl-col-name">${r.name}</span>
      <span class="tbl-col-val">${r.value ?? "—"}</span>
      <span class="tbl-col-gl ${glCls}">${glTxt}</span>
    </div>`;
  }).join("");
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

function parseDWH(res) {
  const text = res?.content?.[0]?.text ?? "";
  const rows = parseMarkdownRows(text);
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
          sql: `SELECT f.FUND_UUID, f.FUND_NAME, f.REPORTING_CURRENCY, COUNT(*) AS N_HOLDINGS, SUM(ai.REMAINING_VALUE) AS TOTAL_VALUE, SUM(ai.TOTAL_UNREALIZED_GAIN_LOSS) AS TOTAL_GL FROM FUND_ADMIN.AGGREGATE_INVESTMENTS ai JOIN FUND_ADMIN.FUNDS f ON ai.FUND_UUID = f.FUND_UUID WHERE ai.IS_ACTIVE_INVESTMENT = TRUE AND f.FIRM_ID = '${firmId}' GROUP BY f.FUND_UUID, f.FUND_NAME, f.REPORTING_CURRENCY ORDER BY TOTAL_VALUE DESC NULLS LAST`,
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

      // nHoldings is free here and the paged SOI read needs it up front.
      soiFunds = dwhFundRows.map(r => ({
        name: r.FUND_NAME,
        uuid: r.FUND_UUID,
        nHoldings: parseInt(r.N_HOLDINGS ?? 0, 10) || 0,
        reportingCurrency: r.REPORTING_CURRENCY || null,
      }));
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
FROM FUND_ADMIN.STATEMENT_OF_OPS WHERE FIRM_ID = '${firmId}'`
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
ORDER BY MONTH_END_DATE DESC LIMIT 1`
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
          sql: `SELECT ISSUER_NAME, MIN(INVESTMENT_DATE) AS HELD_SINCE, SUM(REMAINING_VALUE) AS ITD_VALUE, SUM(TOTAL_UNREALIZED_GAIN_LOSS) AS GAIN_LOSS FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '${firmId}' AND IS_ACTIVE_INVESTMENT = TRUE GROUP BY ISSUER_NAME ORDER BY SUM(REMAINING_VALUE) DESC`
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
          sql: `SELECT ISSUER_NAME, DEAL_IRR FROM (SELECT ISSUER_NAME, DEAL_IRR, ROW_NUMBER() OVER (PARTITION BY ISSUER_NAME ORDER BY PERFORMANCE_QUARTER_END_DATE DESC) AS rn FROM FUND_ADMIN.TEMPORAL_DEAL_IRR WHERE FIRM_ID = '${firmId}') WHERE rn = 1`
        }
      });
      if (!tsIrrRes.isError) {
        parseDWH(tsIrrRes).forEach(r => { _tsIrrMap[r.ISSUER_NAME] = r.DEAL_IRR; });
      }

      // 409A values — latest per company
      const ts409aRes = await _mcp("fetch", {
        command: "dwh:execute:query",
        params: {
          sql: `SELECT b.CORPORATION_NAME, a.PRICE, a.CURRENCY_CODE, a.EFFECTIVE_DATE FROM (SELECT CORPORATION_UUID, PRICE, CURRENCY_CODE, EFFECTIVE_DATE, ROW_NUMBER() OVER (PARTITION BY CORPORATION_UUID ORDER BY EFFECTIVE_DATE DESC) AS rn FROM FUND_ADMIN.IRC409A_VALUE WHERE IS_COMMON = TRUE) a JOIN FUND_ADMIN.CORPORATION_BASIC_INFO_V2 b ON b.CORPORATION_UUID = a.CORPORATION_UUID WHERE b.FIRM_ID = '${firmId}' AND a.rn = 1`
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
LIMIT 5`
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
FROM FUND_ADMIN.STATEMENT_OF_OPS WHERE FIRM_ID = '${firmId}'`
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

      // Attempt 1: dedicated Form ADV table
      try {
        const advRes = await _mcp("fetch", {
          command: "dwh:execute:query",
          params: {
            sql: `SELECT
  SUM(DISCRETIONARY_AUM)     AS disc,
  SUM(NON_DISCRETIONARY_AUM) AS non_disc
FROM FUND_ADMIN.FORM_ADV_FUND_DETAIL WHERE FIRM_ID = '${firmId}'`
          }
        });
        if (!advRes.isError) {
          const ar = parseDWH(advRes)[0] ?? {};
          const d = parseFloat(ar.DISC ?? 0), nd = parseFloat(ar.NON_DISC ?? 0);
          if (d > 0 || nd > 0) { disc = d; nonDisc = nd; total = d + nd; source = 'formadv'; }
        }
      } catch (_) { /* table may not exist — fall through */ }

      // Fallback: total NAV from MONTHLY_NAV_CALCULATIONS (VC funds = effectively all discretionary)
      if (source === 'nav') {
        const navFallRes = await _mcp("fetch", {
          command: "dwh:execute:query",
          params: {
            sql: `SELECT ENDING_TOTAL_NAV
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE FIRM_ID = '${firmId}' AND IS_FIRM_ROLLUP = TRUE
ORDER BY MONTH_END_DATE DESC LIMIT 1`
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
function parseMarkdownRows(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const start = lines[0].startsWith('total_rows:') ? 1 : 0;
  if (lines.length <= start) return [];
  const headers = lines[start].split(' | ').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  let di = start + 1;
  if (lines[di] && /^[\s\-|]+$/.test(lines[di])) di++;
  const rows = [];
  for (let i = di; i < lines.length; i++) {
    const cells = lines[i].split(' | ').map(c => c.trim());
    if (cells.length !== headers.length) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = cells[j] === 'NULL' ? null : cells[j]; });
    rows.push(row);
  }
  return rows;
}
function fmtSharesShort(v) {
  if (v == null || v === '' || v === 'NULL') return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  if (n >= 1e6) return (n/1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n/1e3) + "K";
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}


// ── SOI overlay logic ──

const SOI_COLUMNS = [
  { key: 'name',     label: 'Investment',         num: false, headerAlign: 'left'  },
  { key: 'fund',     label: 'Fund',               num: false, headerAlign: 'left'  },
  { key: 'date',     label: 'Date',               num: false, headerAlign: 'right' },
  { key: 'shares',   label: 'Quantity',            num: true,  headerAlign: 'right'  },
  { key: 'cost',     label: 'Cost',               num: true  },
  { key: 'value',    label: 'Value',              num: true  },
  { key: 'lastDate', label: 'Last updated',       num: false },
  { key: 'gl',       label: 'Gain / Loss',        num: true  },
];

let soiPageCompanies = [];
let soiPageFilter = '';
let soiPageSortCol = null;
let soiPageSortDir = 'asc';
let soiPageAllExpanded = false;

function openSoiPage() {
  trackHome("click", "CartaHome.SOI.Open");
  document.getElementById('soi-page').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  soiInitMultiSelect();
  soiLoadAllFunds();
}

function closeSoiPage() {
  trackHome("click", "CartaHome.SOI.Close");
  document.getElementById('soi-page').style.display = 'none';
  document.body.style.overflow = '';
}

function soiInitMultiSelect() {
  const wrap = document.getElementById('soi-multi-wrap');
  if (soiFunds.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  // Default: all funds selected on first open
  if (soiSelectedFundUuids.size === 0) {
    soiFunds.forEach(f => soiSelectedFundUuids.add(f.uuid ?? f.entity_uuid ?? f.id ?? f.fund_uuid ?? ''));
  }
  soiRenderFundCheckboxes();
  soiUpdateFundBtn();
}

function soiRenderFundCheckboxes() {
  const container = document.getElementById('soi-fund-checkboxes');
  container.innerHTML = soiFunds.map(f => {
    const uuid = f.uuid ?? f.entity_uuid ?? f.id ?? f.fund_uuid ?? '';
    const checked = soiSelectedFundUuids.has(uuid) ? 'checked' : '';
    const name = escHtml(f.name ?? f.entity_name ?? 'Fund');
    return `<label style="display:flex; align-items:center; gap:8px; padding:7px 12px; cursor:pointer; font-size:13px; user-select:none;"
        onmouseenter="this.style.background='var(--ink-color-global-surface-lightgray-default)'"
        onmouseleave="this.style.background=''">
      <input type="checkbox" value="${uuid}" ${checked} onchange="soiCheckboxChanged()" style="cursor:pointer; width:14px; height:14px; flex-shrink:0;">
      <span>${name}</span>
    </label>`;
  }).join('');
}

function soiUpdateFundBtn() {
  const btn = document.getElementById('soi-fund-btn');
  const nSelected = soiSelectedFundUuids.size;
  const nTotal = soiFunds.length;
  let label;
  if (nSelected === nTotal) label = `All funds (${nTotal})`;
  else if (nSelected === 0) label = 'No funds selected';
  else if (nSelected === 1) {
    const sel = soiFunds.find(f => soiSelectedFundUuids.has(f.uuid ?? f.entity_uuid ?? f.id ?? f.fund_uuid ?? ''));
    label = escHtml(sel?.name ?? sel?.entity_name ?? '1 fund');
  } else {
    label = `${nSelected} of ${nTotal} funds`;
  }
  btn.innerHTML = `${label} <span style="position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:10px; pointer-events:none;">▼</span>`;
  const toggleBtn = document.getElementById('soi-toggle-all-btn');
  if (toggleBtn) toggleBtn.textContent = nSelected === nTotal ? 'Unselect all' : 'Select all';
}

function soiToggleMultiDrop(e) {
  e.stopPropagation();
  const drop = document.getElementById('soi-multi-drop');
  const isOpen = drop.style.display !== 'none';
  drop.style.display = isOpen ? 'none' : '';
  if (!isOpen) {
    setTimeout(() => document.addEventListener('click', soiCloseMultiDrop, { once: true }), 0);
  }
}

function soiCloseMultiDrop() {
  const drop = document.getElementById('soi-multi-drop');
  if (drop) drop.style.display = 'none';
}

function soiToggleAllFunds() {
  const allUuids = soiFunds.map(f => f.uuid ?? f.entity_uuid ?? f.id ?? f.fund_uuid ?? '');
  if (soiSelectedFundUuids.size === allUuids.length) {
    soiSelectedFundUuids.clear();
  } else {
    allUuids.forEach(u => soiSelectedFundUuids.add(u));
  }
  soiRenderFundCheckboxes();
  soiUpdateFundBtn();
  soiLoadAllFunds();
}

function soiCheckboxChanged() {
  const checkboxes = document.querySelectorAll('#soi-fund-checkboxes input[type="checkbox"]');
  soiSelectedFundUuids.clear();
  checkboxes.forEach(cb => { if (cb.checked) soiSelectedFundUuids.add(cb.value); });
  soiUpdateFundBtn();
  // Ticking several funds in a row is one intent, not one fetch each.
  clearTimeout(soiCheckboxTimer);
  soiCheckboxTimer = setTimeout(soiLoadAllFunds, 250);
}

// Paging exists because the MCP caps a response by token count. 400 rows of this
// projection measure ~17k tokens, roughly half the cap.
const SOI_PAGE_SIZE = 400;
const SOI_MAX_CONCURRENT_PAGES = 4;

// Two things here are load-bearing for paging, and both fail silently if changed:
// LIMIT/OFFSET must live in the SQL (passing them as `limit`/`offset` params
// discards the ORDER BY), and the sort key must be unique per holding
// (FUND_INVESTMENT_KEY is; ISSUER_NAME + ASSET_NAME is not).
function soiHoldingsSql(uuids, limit, offset) {
  const list = uuids.map(u => `'${u}'`).join(',');
  return `SELECT ISSUER_NAME, ASSET_NAME, FUND_UUID, INVESTMENT_DATE, COUNT_REMAINING_SHARES, TOTAL_COST_BASIS, REMAINING_VALUE, TOTAL_UNREALIZED_GAIN_LOSS, LATEST_FMV_EFFECTIVE_DATE FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FUND_UUID IN (${list}) AND IS_ACTIVE_INVESTMENT = TRUE ORDER BY FUND_INVESTMENT_KEY LIMIT ${limit} OFFSET ${offset}`;
}

async function soiFetchPage(uuids, offset, limit) {
  const res = await _mcp("fetch", {
    command: "dwh:execute:query",
    params: { sql: soiHoldingsSql(uuids, limit, offset) },
  });
  if (res.isError) throw new Error('DWH query failed');
  return parseDWH(res);
}

// Advances by rows actually returned, not by the size requested: an over-large
// response is truncated silently, so a short page is not the end of the data.
async function soiFetchRange(uuids, start, end, pageSize) {
  const out = [];
  let offset = start;
  let size = pageSize;
  while (offset < end) {
    const want = Math.min(size, end - offset);
    const rows = await soiFetchPage(uuids, offset, want);
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < want) size = Math.max(1, rows.length);
    offset += rows.length;
  }
  return out;
}

// `expected` comes from the fund-list query's per-fund counts, so the page count
// is known up front and every page can go out concurrently.
async function soiFetchHoldings(uuids, expected) {
  // Without a count, fall back to reading until a page comes back short — slower,
  // but never renders an empty SOI just because the count was missing.
  if (!(expected > 0)) return soiFetchRange(uuids, 0, Infinity, SOI_PAGE_SIZE);
  const nRanges = Math.min(Math.ceil(expected / SOI_PAGE_SIZE), SOI_MAX_CONCURRENT_PAGES);
  const per = Math.ceil(expected / nRanges);
  const ranges = [];
  for (let s = 0; s < expected; s += per) {
    ranges.push([s, Math.min(expected, s + per)]);
  }
  const chunks = await Promise.all(
    ranges.map(([s, e]) => soiFetchRange(uuids, s, e, Math.min(SOI_PAGE_SIZE, per)))
  );
  const rows = [].concat(...chunks);
  // Refuse to render a partial SOI: wrong totals are worse than a visible failure.
  if (rows.length < expected) {
    throw new Error(`SOI incomplete: got ${rows.length} of ${expected} holdings`);
  }
  return rows;
}

function soiRenderFromCache(uuids) {
  const selectedCurrencies = new Set(
    uuids.map(u => {
      const f = soiFunds.find(x => (x.uuid ?? x.entity_uuid ?? x.id ?? x.fund_uuid) === u);
      return f?.reportingCurrency;
    }).filter(Boolean)
  );
  soiViewMixedCurrency = selectedCurrencies.size > 1;
  const fundDataMap = {};
  uuids.forEach(u => { fundDataMap[u] = soiRawFundCache.get(u) ?? []; });
  soiPageCompanies = soiMergeAllFunds(fundDataMap);
  soiSetStatus(null);
  document.getElementById('soi-page-table').style.display = '';
  soiUpdateMetrics();
  soiPageRender();
}

async function soiLoadAllFunds() {
  const uuids = [...soiSelectedFundUuids];
  if (uuids.length === 0) {
    soiPageCompanies = [];
    soiViewMixedCurrency = false;
    soiSetStatus(null);
    document.getElementById('soi-page-table').style.display = '';
    soiUpdateMetrics();
    soiPageRender();
    return;
  }

  // Narrowing a selection is pure client-side filtering — no spinner, no refetch.
  const missing = uuids.filter(u => !soiRawFundCache.has(u));
  if (missing.length === 0) { soiRenderFromCache(uuids); return; }

  soiSetStatus('Loading…');
  document.getElementById('soi-page-table').style.display = 'none';

  if (!(await mcpAvailable())) { soiLoadFallback(); return; }

  const token = ++soiLoadToken;
  try {
    const expected = missing.reduce((n, u) => {
      const f = soiFunds.find(x => (x.uuid ?? x.entity_uuid ?? x.id ?? x.fund_uuid) === u);
      return n + (f?.nHoldings ?? 0);
    }, 0);
    const rows = await soiFetchHoldings(missing, expected);
    if (token !== soiLoadToken) return;  // a newer selection superseded this one
    // Seed every requested fund so one with no active holdings caches as empty
    // instead of being refetched on every toggle.
    missing.forEach(u => soiRawFundCache.set(u, []));
    rows.forEach(r => {
      const bucket = soiRawFundCache.get(r.FUND_UUID);
      if (bucket) bucket.push(r);
    });
    soiRenderFromCache(uuids);
  } catch(e) {
    if (token !== soiLoadToken) return;
    soiLoadFallback();
  }
}

function soiLoadFallback() {
  soiPageCompanies = [
    { name:'Cumulus', date:'03/2022', lastDate:'12/2025', cost:19800000, value:91500000, gl:71700000, fundGroups:[{
      fundName:'Sample Fund', fundUuid:'fallback', assets:[
        { name:'Series B', date:'03/2022', shares:14200, cost:19800000, value:91500000, gl:71700000, lastDate:'12/2025' }
      ]
    }]},
    { name:'Acme', date:'06/2021', lastDate:'12/2025', cost:28100000, value:48200000, gl:20100000, fundGroups:[{
      fundName:'Sample Fund', fundUuid:'fallback', assets:[
        { name:'Series C', date:'06/2021', shares:9800, cost:28100000, value:48200000, gl:20100000, lastDate:'12/2025' }
      ]
    }]},
    { name:'Harbor', date:'09/2021', lastDate:'11/2025', cost:26200000, value:35400000, gl:9200000, fundGroups:[{
      fundName:'Sample Fund', fundUuid:'fallback', assets:[
        { name:'Series B', date:'09/2021', shares:6500, cost:26200000, value:35400000, gl:9200000, lastDate:'11/2025' }
      ]
    }]},
    { name:'Bolt', date:'01/2023', lastDate:'12/2025', cost:26200000, value:22700000, gl:-3500000, fundGroups:[{
      fundName:'Sample Fund', fundUuid:'fallback', assets:[
        { name:'Series A', date:'01/2023', shares:4100, cost:26200000, value:22700000, gl:-3500000, lastDate:'12/2025' }
      ]
    }]},
  ];
  soiSetStatus(null);
  document.getElementById('soi-page-table').style.display = '';
  soiUpdateMetrics();
  soiPageRender();
}

// Merge raw rows from multiple funds into company objects with fundGroups.
// fundDataMap: { [uuid]: rawRows[] }
function soiMergeAllFunds(fundDataMap) {
  const byCompany = {};
  for (const uuid of Object.keys(fundDataMap)) {
    const fund = soiFunds.find(f => (f.uuid ?? f.entity_uuid ?? f.id ?? f.fund_uuid) === uuid);
    const fundName = fund?.name ?? fund?.entity_name ?? 'Unknown Fund';
    const rows = fundDataMap[uuid] ?? [];
    rows.forEach(inv => {
      const cn = inv.ISSUER_NAME ?? inv.issuer_name ?? 'Unknown';
      if (!byCompany[cn]) byCompany[cn] = { name: cn, cost:0, value:0, gl:0, shares:0, date:'', lastDate:'', fundGroups:[] };
      const c = byCompany[cn];
      let fg = c.fundGroups.find(g => g.fundUuid === uuid);
      if (!fg) { fg = { fundName, fundUuid: uuid, assets:[] }; c.fundGroups.push(fg); }
      const fmv    = parseFloat(inv.REMAINING_VALUE ?? inv.remaining_value ?? 0) || 0;
      const cost   = parseFloat(inv.TOTAL_COST_BASIS ?? inv.total_cost_basis ?? 0) || 0;
      const gl     = parseFloat(inv.TOTAL_UNREALIZED_GAIN_LOSS ?? inv.total_unrealized_gain_loss ?? 0) || 0;
      const shares = parseFloat(inv.COUNT_REMAINING_SHARES ?? inv.count_remaining_shares ?? 0) || 0;
      c.cost += cost; c.value += fmv; c.gl += gl; c.shares += shares;
      const acqDate  = soiFmtDate(inv.INVESTMENT_DATE ?? inv.investment_date);
      const lastDate = soiFmtDate(inv.LATEST_FMV_EFFECTIVE_DATE ?? inv.latest_fmv_effective_date);
      fg.assets.push({ name: inv.ASSET_NAME ?? inv.asset_name ?? 'Investment', date: acqDate, shares, cost, value: fmv, gl, lastDate });
    });
  }
  Object.values(byCompany).forEach(c => {
    const allAssets = c.fundGroups.flatMap(fg => fg.assets);
    const dates = allAssets.map(a => a.date).filter(Boolean);
    const lasts = allAssets.map(a => a.lastDate).filter(Boolean);
    if (dates.length) c.date = dates.reduce((m,d) => soiParseDt(d) < soiParseDt(m) ? d : m);
    if (lasts.length) c.lastDate = lasts.reduce((m,d) => soiParseDt(d) > soiParseDt(m) ? d : m);
  });
  return Object.values(byCompany).sort((a,b) => a.name.localeCompare(b.name));
}
function soiFmtDate(v) {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? m[2]+'/'+m[3]+'/'+m[1] : String(v);
}
function soiParseDt(s) {
  if (!s) return 0;
  const [mo,d,y] = s.split('/').map(Number);
  return new Date(y, mo-1, d).getTime();
}

function soiSetStatus(msg) {
  const el = document.getElementById('soi-page-status');
  if (msg) { el.textContent = msg; el.style.display = ''; }
  else { el.style.display = 'none'; }
}

function soiFmtCurrency(v) {
  if (v == null || isNaN(v)) return '—';
  return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', minimumFractionDigits:0, maximumFractionDigits:0 }).format(v);
}
function soiFmtShares(v) {
  if (!v) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(v));
}
function soiGlCell(v) {
  if (v === 0) return '<span style="color:var(--ink-color-global-text-subtle)">—</span>';
  const cls = v > 0 ? 'gl-pos' : 'gl-neg';
  const arrow = v > 0 ? '↑' : '↓';
  return `<span class="${cls}">${arrow} ${soiFmtCurrency(Math.abs(v))}</span>`;
}

function soiUpdateMetrics() {
  const t = soiPageCompanies.reduce((acc, c) => ({
    cost: acc.cost + c.cost, value: acc.value + c.value, gl: acc.gl + c.gl
  }), { cost:0, value:0, gl:0 });
  const mixedLabel = '<span class="soi-mixed-badge">Mixed</span>';
  const costDisplay = soiViewMixedCurrency ? mixedLabel : soiFmtCurrency(t.cost);
  const valueDisplay = soiViewMixedCurrency ? mixedLabel : soiFmtCurrency(t.value);
  const glDisplay = soiViewMixedCurrency ? mixedLabel : soiGlCell(t.gl);
  const moic = soiViewMixedCurrency ? '—' : (t.cost > 0 ? (t.value / t.cost).toFixed(2) + 'x' : '—');
  document.getElementById('soi-page-metrics').innerHTML = `
    <div style="flex:1; padding:12px 16px; border-right:1px solid var(--ink-color-global-border-subtle);">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-color-global-text-subtle); margin-bottom:4px;">Total Cost</div>
      <div style="font-size:16px; font-weight:600; font-variant-numeric:tabular-nums;">${costDisplay}</div>
    </div>
    <div style="flex:1; padding:12px 16px; border-right:1px solid var(--ink-color-global-border-subtle);">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-color-global-text-subtle); margin-bottom:4px;">Total Value</div>
      <div style="font-size:16px; font-weight:600; font-variant-numeric:tabular-nums;">${valueDisplay}</div>
    </div>
    <div style="flex:1; padding:12px 16px; border-right:1px solid var(--ink-color-global-border-subtle);">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-color-global-text-subtle); margin-bottom:4px;">Gain / Loss</div>
      <div style="font-size:16px; font-weight:600;">${glDisplay}</div>
    </div>
    <div style="flex:1; padding:12px 16px;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-color-global-text-subtle); margin-bottom:4px;">MOIC</div>
      <div style="font-size:16px; font-weight:600;">${moic}</div>
    </div>
  `;
}

function soiFilterCompanies(v) {
  soiPageFilter = v.toLowerCase();
  soiPageRender();
}

function soiSetSort(key) {
  if (soiPageSortCol === key) soiPageSortDir = soiPageSortDir === 'asc' ? 'desc' : 'asc';
  else { soiPageSortCol = key; soiPageSortDir = 'asc'; }
  soiPageRender();
}

function soiSorted(data) {
  if (!soiPageSortCol) return data;
  return [...data].sort((a, b) => {
    let va = a[soiPageSortCol], vb = b[soiPageSortCol];
    if (soiPageSortCol === 'name') return soiPageSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    if (soiPageSortCol === 'date' || soiPageSortCol === 'lastDate') {
      va = soiParseDt(va); vb = soiParseDt(vb);
    } else { va = va||0; vb = vb||0; }
    return soiPageSortDir === 'asc' ? va-vb : vb-va;
  });
}

function soiPageRender() {
  const data = soiSorted(soiPageFilter
    ? soiPageCompanies.filter(c => c.name.toLowerCase().includes(soiPageFilter))
    : soiPageCompanies);

  document.getElementById('soi-page-count').textContent = data.length + ' companies';

  const thead = document.getElementById('soi-page-thead');
  const thCells = SOI_COLUMNS.map(col => {
    const active = soiPageSortCol === col.key;
    const arrow = active ? (soiPageSortDir === 'asc' ? ' ↑' : ' ↓') : '';
    const numStyle = col.headerAlign ? `text-align:${col.headerAlign};` : (col.num ? 'text-align:right;' : '');
    return `<th onclick="soiSetSort('${col.key}')" style="padding:10px 12px; font-size:11px; font-weight:600; text-transform:none; letter-spacing:.06em; color:${active ? 'var(--ink-color-global-text-default)' : 'var(--ink-color-global-text-subtle)'}; border-bottom:1px solid var(--ink-color-global-border-subtle); cursor:pointer; white-space:nowrap; ${numStyle}">${col.label}${arrow}</th>`;
  }).join('');
  thead.innerHTML = `<tr>${thCells}</tr>`;

  const tbody = document.getElementById('soi-page-tbody');
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${SOI_COLUMNS.length}" style="padding:40px; text-align:center; color:var(--ink-color-global-text-subtle);">No companies match your filter.</td></tr>`;
    return;
  }

  let rows = '';
  data.forEach((c, i) => {
    const fundLabel = c.fundGroups.length === 1
      ? c.fundGroups[0].fundName
      : `${c.fundGroups.length} funds`;
    rows += `<tr class="soi-company-row" onclick="soiToggle('grp-${i}')" style="cursor:pointer; border-bottom:1px solid var(--ink-color-global-border-subtle); transition:background .1s;">
      <td style="padding:10px 12px; font-weight:500;">
        <span id="soi-icon-grp-${i}" style="display:inline-block; width:16px; font-size:10px; color:var(--ink-color-global-text-subtle);">▶</span>
        ${escHtml(c.name)}
      </td>
      <td style="padding:10px 12px; color:var(--ink-color-global-text-subtle); font-size:12px;">${escHtml(fundLabel)}</td>
      <td style="padding:10px 12px; color:var(--ink-color-global-text-subtle);">${c.date || '—'}</td>
      <td style="padding:10px 12px; text-align:right; font-variant-numeric:tabular-nums;">${soiFmtShares(c.shares)}</td>
      <td style="padding:10px 12px; text-align:right; font-variant-numeric:tabular-nums;">${soiFmtCurrency(c.cost)}</td>
      <td style="padding:10px 12px; text-align:right; font-variant-numeric:tabular-nums;">${soiFmtCurrency(c.value)}</td>
      <td style="padding:10px 12px; color:var(--ink-color-global-text-subtle);">${c.lastDate || '—'}</td>
      <td style="padding:10px 12px; text-align:right;">${soiGlCell(c.gl)}</td>
    </tr>`;
    c.fundGroups.forEach(fg => {
      fg.assets.forEach(a => {
        rows += `<tr class="soi-asset-row soi-asset-grp-${i}" style="display:none; background:var(--ink-color-global-surface-background-underlay); border-bottom:1px solid var(--ink-color-global-border-subtle);">
          <td style="padding:8px 12px 8px 40px; color:var(--ink-color-global-text-subtle);">${escHtml(a.name)}</td>
          <td style="padding:8px 12px; color:var(--ink-color-global-text-subtle); font-size:12px;">${escHtml(fg.fundName)}</td>
          <td style="padding:8px 12px; color:var(--ink-color-global-text-subtle);">${a.date || '—'}</td>
          <td style="padding:8px 12px; text-align:right; font-variant-numeric:tabular-nums;">${soiFmtShares(a.shares)}</td>
          <td style="padding:8px 12px; text-align:right; font-variant-numeric:tabular-nums;">${soiFmtCurrency(a.cost)}</td>
          <td style="padding:8px 12px; text-align:right; font-variant-numeric:tabular-nums;">${soiFmtCurrency(a.value)}</td>
          <td style="padding:8px 12px; color:var(--ink-color-global-text-subtle);">${a.lastDate || '—'}</td>
          <td style="padding:8px 12px; text-align:right;">${soiGlCell(a.gl)}</td>
        </tr>`;
      });
    });
  });

  // Totals row
  const t = data.reduce((acc, c) => ({ cost: acc.cost+c.cost, value: acc.value+c.value, gl: acc.gl+c.gl }), {cost:0,value:0,gl:0});
  const mixedLabel = '<span class="soi-mixed-badge">Mixed</span>';
  const totalCost  = soiViewMixedCurrency ? mixedLabel : soiFmtCurrency(t.cost);
  const totalValue = soiViewMixedCurrency ? mixedLabel : soiFmtCurrency(t.value);
  const totalGl    = soiViewMixedCurrency ? mixedLabel : soiGlCell(t.gl);
  rows += `<tr style="border-top:2px solid var(--ink-color-global-border-default); font-weight:600;">
    <td style="padding:10px 12px;">${data.length} companies</td>
    <td></td><td></td><td></td>
    <td style="padding:10px 12px; text-align:right; font-variant-numeric:tabular-nums;">${totalCost}</td>
    <td style="padding:10px 12px; text-align:right; font-variant-numeric:tabular-nums;">${totalValue}</td>
    <td></td>
    <td style="padding:10px 12px; text-align:right;">${totalGl}</td>
  </tr>`;

  tbody.innerHTML = rows;

  // Hover effect
  tbody.querySelectorAll('.soi-company-row').forEach(tr => {
    // lightgray-DEFAULT, not -hover: these rows carry text-subtle cells (date,
    // the placeholder dash, the disclosure triangle), and #656B6B on -hover's
    // light #DEDFDF is only 4.07:1. On -default's #F1F1F1 it clears at 4.81:1.
    tr.addEventListener('mouseenter', () => tr.style.background = 'var(--ink-color-global-surface-lightgray-default)');
    tr.addEventListener('mouseleave', () => tr.style.background = '');
  });
}

function soiToggle(grp) {
  trackHome("click", "CartaHome.SOI.Row.Toggle");
  const assetRows = document.querySelectorAll(`.soi-asset-${grp}`);
  const icon = document.getElementById(`soi-icon-${grp}`);
  const isOpen = assetRows.length > 0 && assetRows[0].style.display !== 'none';
  assetRows.forEach(r => r.style.display = isOpen ? 'none' : '');
  if (icon) icon.textContent = isOpen ? '▶' : '▼';
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── SOI page state ──
let soiFunds = [];
let soiSelectedFundUuids = new Set();
const soiRawFundCache = new Map(); // uuid -> raw DWH rows
let soiCheckboxTimer = null;
let soiLoadToken = 0;   // discards a load whose selection has since changed
let soiViewMixedCurrency = false;

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

function copyPrompt(btn) {
  trackHome("click", "CartaHome.Customize.CopyPrompt." + (customizeSource === "perf" ? "Perf" : "SOI"));
  const text = btn.dataset.prompt || '';
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
  const feedback = () => {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy';
      btn.classList.remove('copied');
    }, 2000);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(feedback).catch(() => {
      fallback(text) ? feedback() : showToast('Could not copy to clipboard');
    });
  } else {
    fallback(text) ? feedback() : showToast('Could not copy to clipboard');
  }
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
  const copySvg = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="margin-right:5px;vertical-align:middle;"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy this prompt';
  const feedback = () => {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = copySvg;
      btn.classList.remove('copied');
    }, 2000);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(feedback).catch(() => {
      fallback(text) ? feedback() : showToast('Could not copy to clipboard');
    });
  } else {
    fallback(text) ? feedback() : showToast('Could not copy to clipboard');
  }
}

document.addEventListener('click', function(e) {
  const popover = document.getElementById('customize-popover');
  if (popover?.classList.contains('open') &&
      !popover.contains(e.target) &&
      !e.target.closest('[onclick*="openCustomize"]')) {
    closeCustomize();
  }
});

// ── Fund Performance page ──
let perfFunds = [];
let perfCurrentFundUuid = null;
let perfIrrChartInst = null;
let perfTvpiChartInst = null;
let perfDpiChartInst = null;
let perfMoicChartInst = null;

function openPerfPage() {
  trackHome("click", "CartaHome.Perf.Open");
  document.getElementById('perf-page').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _perfShowListView();
}

function _perfShowListView() {
  document.getElementById('perf-list-view').style.display = 'block';
  document.getElementById('perf-detail-view').style.display = 'none';
  const backBtn = document.getElementById('perf-back-btn');
  if (backBtn) backBtn.onclick = closePerfPage;
  const backText = document.getElementById('perf-back-text');
  if (backText) backText.textContent = 'Back';
  document.getElementById('perf-page-label').textContent = 'Fund Performance';
  const chevron = document.getElementById('perf-fund-chevron');
  if (chevron) chevron.style.display = 'none';
  const titleBtn = document.getElementById('perf-fund-title-btn');
  if (titleBtn) titleBtn.style.cursor = 'default';
  perfLoadAllFunds();
}

function perfOpenFundDetail(uuid, name) {
  trackHome("click", "CartaHome.Perf.FundRow.Open");
  document.getElementById('perf-list-view').style.display = 'none';
  document.getElementById('perf-detail-view').style.display = 'block';
  const backBtn = document.getElementById('perf-back-btn');
  if (backBtn) backBtn.onclick = _perfShowListView;
  const backText = document.getElementById('perf-back-text');
  if (backText) backText.textContent = 'All funds';
  document.getElementById('perf-page-label').textContent = name || 'Fund';
  const chevron = document.getElementById('perf-fund-chevron');
  if (chevron) chevron.style.display = '';
  const titleBtn = document.getElementById('perf-fund-title-btn');
  if (titleBtn) titleBtn.style.cursor = 'pointer';
  perfCurrentFundUuid = uuid;
  if (perfFunds.length === 0 && soiFunds.length > 0) {
    perfFunds = soiFunds;
  }
  perfInitFundSelect();
  perfLoadFund(uuid);
}

let _perfAllFundsLoaded = false;

async function perfLoadAllFunds() {
  const listEl = document.getElementById('perf-list-view');
  if (!listEl) return;
  if (_perfAllFundsLoaded && listEl.querySelector('table.perf-funds-table')) return;
  listEl.innerHTML = '<div class="perf-list-status">Loading fund performance…</div>';
  if (!(await mcpAvailable())) {
    listEl.innerHTML = '<div class="perf-list-status">Live data not available in preview mode.</div>';
    return;
  }
  try {
    const r = await _mcp("fetch", {
      command: 'dwh:execute:query',
      params: {
        sql: `SELECT
          FUND_NAME, FUND_UUID,
          NET_LP_IRR, TOTAL_TVPI, LP_DPI, TOTAL_RVPI, TOTAL_MOIC,
          TOTAL_VALUE,
          ENDING_TOTAL_NAV,
          FUND_SIZE,
          TOTAL_DISTRIBUTION,
          TOTAL_CAP_CONTRIBUTION,
          DRY_POWDER,
          MONTH_END_DATE
        FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
        WHERE FUND_UUID IS NOT NULL
        QUALIFY ROW_NUMBER() OVER (PARTITION BY FUND_UUID ORDER BY MONTH_END_DATE DESC NULLS LAST) = 1
        ORDER BY ENDING_TOTAL_NAV DESC NULLS LAST
        LIMIT 50`,
      },
    });
    if (!r.isError) {
      const rows = parseDWH(r).filter(row => row.FUND_UUID);
      if (rows.length > 0) {
        perfFunds = rows.map(row => ({ name: row.FUND_NAME, uuid: row.FUND_UUID }));
        if (!perfCurrentFundUuid && rows[0]) perfCurrentFundUuid = rows[0].FUND_UUID;
        _perfAllFundsLoaded = true;
        _perfRenderFundsTable(rows, listEl);
        return;
      }
    }
  } catch (_) {}
  listEl.innerHTML = '<div class="perf-list-status">No performance data available.</div>';
}

const _PERF_COLS = [
  // Net IRR is signed, so it carries the positive/negative feedback color and an
  // explicit + on gains (Ink rule 6). Exact zero stays neutral text-default.
  { key: 'NET_LP_IRR',           label: 'Net IRR',              group: 'returns', fmt: v => {
      if (v == null) return '—';
      const n = parseFloat(v);
      if (!isFinite(n)) return '—';
      const txt = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
      if (n === 0) return txt;
      return `<span class="${n > 0 ? 'gl-pos' : 'gl-neg'}">${txt}</span>`;
    }, tip: 'Net IRR is the internal rate of return based on LP contributions and distributions to the partners, and the terminal value. Terminal value being defined as the Net Asset Value (NAV) of the fund as of the selected dates, updated through the last financial reporting date, net of GP carry.' },
  { key: 'TOTAL_TVPI',           label: 'TVPI',                 group: 'returns', fmt: v => v != null ? parseFloat(v).toFixed(2) + 'x' : '—', tip: 'TVPI is the ratio of Total Value to Paid-in Capital. Total value is equal to the sum of distributions and the residual value of the fund (also known as Net Asset Value). Paid-in capital is equal to the capital contributions to the fund.' },
  { key: 'LP_DPI',               label: 'DPI',                  group: 'returns', fmt: v => v != null ? parseFloat(v).toFixed(2) + 'x' : '—', tip: 'DPI is the ratio of distributions paid out to Paid-in Capital. Paid-in capital is equal to the capital contributions to the fund.' },
  { key: 'TOTAL_RVPI',           label: 'RVPI',                 group: 'returns', fmt: v => v != null ? parseFloat(v).toFixed(2) + 'x' : '—', tip: 'RVPI is the ratio of Residual Value (also known as Net Asset Value) to Paid-in Capital. Paid-in capital is equal to the capital contributions to the fund.' },
  { key: 'TOTAL_MOIC',           label: 'MOIC',                 group: 'returns', fmt: v => v != null ? parseFloat(v).toFixed(2) + 'x' : '—', tip: 'Multiple on Invested Capital is the total value (gross) relative to invested capital, before fees and carry.' },
  { key: 'TOTAL_VALUE',          label: 'Total Value',          group: 'capital', fmt: v => v != null ? fmtFull(parseFloat(v)) : '—',        tip: 'Total value is equal to the sum of distributions to date and the net asset value of the fund.' },
  { key: 'ENDING_TOTAL_NAV',     label: 'NAV',                  group: 'capital', fmt: v => v != null ? fmtFull(parseFloat(v)) : '—',        tip: 'Net Asset Value is the sum of all the assets minus the liabilities (also known as ending partners\' capital).' },
  { key: 'TOTAL_CAP_CONTRIBUTION',label: 'Contributions',        group: 'capital', fmt: v => v != null ? fmtFull(parseFloat(v)) : '—',        tip: 'The amount of capital called from investors. Capital contributions are on a GAAP basis and are fully recognized on the capital call due date, regardless of cash being received.' },
  { key: 'TOTAL_DISTRIBUTION',   label: 'Distributions',        group: 'capital', fmt: v => v != null ? fmtFull(parseFloat(v)) : '—',        tip: 'The amount of capital returned to investors, inclusive of cash and non-cash considerations.' },
];

function _perfRenderFundsTable(rows, container) {
  // Column header row
  // The info affordance is a real <button> (keyboard-reachable) described by the
  // shared #perf-tip live tooltip; focusin/focusout mirror the mouse handlers.
  const colHeaderCells = _PERF_COLS.map(c =>
    `<th style="border-bottom:1px solid var(--ink-color-global-border-subtle);"><div class="perf-th-wrap">${c.label}<button type="button" class="perf-th-info" aria-label="About ${escHtml(c.label)}" aria-describedby="perf-tip" data-tip="${escHtml(c.tip)}">i</button></div></th>`
  ).join('');

  // Body rows
  const bodyRows = rows.map(row => {
    const rawName = row.FUND_NAME ?? 'Fund';
    const name = escHtml(rawName);
    const uuid = (row.FUND_UUID ?? '').replace(/'/g, '');
    // Double-escaped on purpose: backslash-escape the JS string literal first,
    // then HTML-escape for the attribute. The parser decodes &#39; back to a
    // plain quote before the JS is parsed, so a fund name like "O'Brien I, LP"
    // would otherwise break out of the string argument.
    const argName = escHtml(String(rawName).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
    const cells = _PERF_COLS.map(c =>
      `<td>${c.fmt(row[c.key], row)}</td>`
    ).join('');
    // No handler on the <tr>: a row isn't focusable and a <span> isn't announced
    // as a control, so the fund name itself is the button.
    return `<tr>
      <td><button type="button" class="perf-fund-name-link" onclick="perfOpenFundDetail('${uuid}','${argName}')">${name}</button></td>${cells}
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="perf-table-scroll">
      <table class="perf-funds-table">
        <thead><tr><th style="border-bottom:1px solid var(--ink-color-global-border-subtle);width:220px;min-width:220px;">Fund</th>${colHeaderCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

// ── Fixed-position tooltip manager for .perf-th-info (escapes overflow:hidden containers) ──
(function() {
  let tip = null;
  function ensureTip() {
    // The template ships a #perf-tip; fall back to creating one so this keeps
    // working if the markup ever drops it.
    if (!tip) {
      tip = document.getElementById('perf-tip');
    }
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'perf-tip';
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(el) {
    const t = ensureTip();
    t.textContent = el.getAttribute('data-tip') || '';
    const r = el.getBoundingClientRect();
    // Position below the icon, clamped to viewport
    let top = r.bottom + 6;
    let left = r.right - 220; // right-align the 220px tooltip with the icon
    if (left < 8) left = 8;
    if (left + 220 > window.innerWidth - 8) left = window.innerWidth - 228;
    if (top + 120 > window.innerHeight) top = r.top - 120 - 6; // flip above if near bottom
    t.style.top  = top + 'px';
    t.style.left = left + 'px';
    t.classList.add('visible');
  }
  function hideTip() {
    if (tip) tip.classList.remove('visible');
  }
  function onEnter(e) {
    const el = e.target.closest?.('.perf-th-info');
    if (!el) return;
    showTip(el);
  }
  function onLeave(e) {
    const el = e.target.closest?.('.perf-th-info');
    if (!el) return;
    hideTip();
  }
  document.addEventListener('mouseover', onEnter);
  document.addEventListener('mouseout', onLeave);
  // Keyboard parity: the definitions must be reachable without a pointer.
  document.addEventListener('focusin', onEnter);
  document.addEventListener('focusout', onLeave);
})();

async function perfFetchFundsAndLoad() {
  perfSetStatus('Loading funds…');
  try {
    const r = await _mcp("fetch", {
      command: 'dwh:execute:query',
      params: {
        sql: `SELECT FUND_NAME, FUND_UUID, ENDING_TOTAL_NAV
              FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
              QUALIFY ROW_NUMBER() OVER (PARTITION BY FUND_UUID ORDER BY MONTH_END_DATE DESC NULLS LAST) = 1
              ORDER BY ENDING_TOTAL_NAV DESC NULLS LAST
              LIMIT 20`,
      },
    });
    if (!r.isError) {
      const rows = parseDWH(r).filter(row => row.FUND_UUID);
      if (rows.length > 0) {
        perfFunds = rows.map(row => ({ name: row.FUND_NAME, uuid: row.FUND_UUID }));
        if (!perfCurrentFundUuid) perfCurrentFundUuid = rows[0].FUND_UUID;
        perfInitFundSelect();
      }
    }
  } catch (_) {}
  perfSetStatus(null);
  perfLoadFund(perfCurrentFundUuid);
}

function closePerfPage() {
  trackHome("click", "CartaHome.Perf.Close");
  document.getElementById('perf-page').style.display = 'none';
  document.body.style.overflow = '';
}

function perfInitFundSelect() {
  // Populate custom dropdown
  const dd = document.getElementById('perf-fund-dropdown');
  if (dd) {
    dd.innerHTML = perfFunds.map(f => {
      const name = f.name ?? f.entity_name ?? f.fund_name ?? 'Fund';
      const uuid = f.fund_uuid ?? f.entity_uuid ?? f.uuid ?? '';
      const active = uuid === perfCurrentFundUuid;
      return `<button type="button" class="perf-fund-dropdown-item${active ? ' active' : ''}" onclick="perfSwitchFund('${escHtml(uuid)}');document.getElementById('perf-fund-dropdown').style.display='none';">${escHtml(name)}</button>`;
    }).join('');
  }
}

function perfToggleFundDropdown(e) {
  if (e) e.stopPropagation();
  const chevron = document.getElementById('perf-fund-chevron');
  if (!chevron || chevron.style.display === 'none') return; // list view — not interactive
  const dd = document.getElementById('perf-fund-dropdown');
  if (!dd) return;
  if (dd.style.display === 'none') {
    dd.style.display = 'block';
    setTimeout(() => document.addEventListener('click', _perfCloseFundDropdown, { once: true }), 0);
  } else {
    dd.style.display = 'none';
  }
}

function _perfCloseFundDropdown() {
  const dd = document.getElementById('perf-fund-dropdown');
  if (dd) dd.style.display = 'none';
}

function perfSwitchFund(uuid) {
  trackHome("change", "CartaHome.Perf.FundSelect");
  perfCurrentFundUuid = uuid;
  // Update title label to the selected fund's name
  const fund = perfFunds.find(f => (f.fund_uuid ?? f.entity_uuid ?? f.uuid ?? '') === uuid);
  if (fund) {
    const name = fund.name ?? fund.entity_name ?? fund.fund_name ?? 'Fund';
    const label = document.getElementById('perf-page-label');
    if (label) label.textContent = name;
  }
  // Re-render dropdown so active highlight moves to the new selection
  perfInitFundSelect();
  perfLoadFund(uuid);
}

function perfSetStatus(msg) {
  const el = document.getElementById('perf-page-status');
  if (!el) return;
  if (msg) { el.textContent = msg; el.style.display = ''; }
  else { el.style.display = 'none'; }
}

async function perfLoadFund(uuid) {
  perfSetStatus('Loading performance data…');
  // Destroy old charts
  if (perfIrrChartInst) { perfIrrChartInst.destroy(); perfIrrChartInst = null; }
  if (perfTvpiChartInst) { perfTvpiChartInst.destroy(); perfTvpiChartInst = null; }
  if (perfDpiChartInst) { perfDpiChartInst.destroy(); perfDpiChartInst = null; }
  if (perfMoicChartInst) { perfMoicChartInst.destroy(); perfMoicChartInst = null; }
  // Show skeleton structure (labels/headers visible, values blank) while new fund loads
  const _metricsStrip = document.getElementById('perf-page-metrics');
  if (_metricsStrip) _metricsStrip.innerHTML = `
    <div class="perf-metric"><div class="perf-metric-label">Fund Size</div><div class="perf-metric-val">—</div></div>
    <div class="perf-metric"><div class="perf-metric-label">Total Value</div><div class="perf-metric-val">—</div></div>
    <div class="perf-metric"><div class="perf-metric-label">Total Invested</div><div class="perf-metric-val">—</div></div>
    <div class="perf-metric"><div class="perf-metric-label">Dry Powder</div><div class="perf-metric-val">—</div></div>
  `;
  const _metricsTable = document.getElementById('perf-detail-metrics-table');
  if (_metricsTable) _metricsTable.innerHTML = `
    <table class="perf-detail-table">
      <thead><tr><th>Metric</th><th>LP Only</th><th>Total Fund</th></tr></thead>
      <tbody>
        <tr><td>Total Value to Paid-in Capital (TVPI)</td><td>—</td><td>—</td></tr>
        <tr><td>Distributions to Paid-in Capital (DPI)</td><td>—</td><td>—</td></tr>
        <tr><td>Residual Value to Paid-in Capital (RVPI)</td><td>—</td><td>—</td></tr>
        <tr><td>Net Internal Rate of Return (Net IRR)</td><td>—</td><td>—</td></tr>
        <tr><td>Multiple on Invested Capital (MOIC)</td><td>—</td><td>—</td></tr>
        <tr><td>Total Value</td><td>—</td><td>—</td></tr>
        <tr><td>Net Asset Value (NAV)</td><td>—</td><td>—</td></tr>
        <tr><td>Contributions</td><td>—</td><td>—</td></tr>
        <tr><td>Distributions</td><td>—</td><td>—</td></tr>
      </tbody>
    </table>
  `;

  let seriesData = null;
  let snapshotRow = null;

  if (uuid && await mcpAvailable()) {
    // ── Helper: parse series rows ──
    const _parseSeriesRows = (rows) => rows.map(row => ({
      QUARTER_END_DATE: _fmtQtr(row.PERFORMANCE_QUARTER_START_DATE),
      NET_IRR: row.NET_IRR != null ? row.NET_IRR / 100 : null,
      TVPI: row.TVPI != null ? parseFloat(row.TVPI) : null,
      DPI: row.DPI != null ? parseFloat(row.DPI) : null,
      MOIC: row.MOIC != null ? parseFloat(row.MOIC) : null,
      BENCHMARK_P25_NET_IRR: row.NET_IRR_25TH != null ? row.NET_IRR_25TH / 100 : null,
      BENCHMARK_P50_NET_IRR: row.NET_IRR_50TH != null ? row.NET_IRR_50TH / 100 : null,
      BENCHMARK_P75_NET_IRR: row.NET_IRR_75TH != null ? row.NET_IRR_75TH / 100 : null,
      BENCHMARK_P25_TVPI: row.TVPI_25 != null ? parseFloat(row.TVPI_25) : null,
      BENCHMARK_P50_TVPI: row.TVPI_50 != null ? parseFloat(row.TVPI_50) : null,
      BENCHMARK_P75_TVPI: row.TVPI_75 != null ? parseFloat(row.TVPI_75) : null,
      BENCHMARK_P25_DPI: row.DPI_25 != null ? parseFloat(row.DPI_25) : null,
      BENCHMARK_P50_DPI: row.DPI_50 != null ? parseFloat(row.DPI_50) : null,
      BENCHMARK_P75_DPI: row.DPI_75 != null ? parseFloat(row.DPI_75) : null,
      BENCHMARK_P25_MOIC: row.MOIC_25 != null ? parseFloat(row.MOIC_25) : null,
      BENCHMARK_P50_MOIC: row.MOIC_50 != null ? parseFloat(row.MOIC_50) : null,
      BENCHMARK_P75_MOIC: row.MOIC_75 != null ? parseFloat(row.MOIC_75) : null,
    }));

    // ── Fire both queries in parallel ──
    // Include MONTH_END_DATE so we can use the snapshot as a trailing data point
    // on charts when TEMPORAL_FUND_COHORT_BENCHMARKS lags behind.
    const snapPromise = _mcp("fetch", {
      command: 'dwh:execute:query',
      params: {
        sql: `SELECT
          MONTH_END_DATE,
          FUND_SIZE, TOTAL_MOIC, TOTAL_TVPI, TOTAL_RVPI, NET_LP_IRR, LP_DPI,
          TOTAL_VALUE, ENDING_TOTAL_NAV, TOTAL_CAP_CONTRIBUTION, TOTAL_DISTRIBUTION,
          TOTAL_COST_OF_INVESTMENTS, DRY_POWDER, DEAL_IRR,
          LP_TVPI, LP_RVPI, LP_MOIC,
          LP_VALUE, ENDING_LP_NAV, TOTAL_LP_CAP_CONTRIBUTION, TOTAL_LP_DISTRIBUTION
        FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
        WHERE FUND_UUID = '${uuid}'
        ORDER BY MONTH_END_DATE DESC NULLS LAST
        LIMIT 1`,
      },
    });

    const seriesPromise = _mcp("fetch", {
      command: 'dwh:execute:query',
      params: {
        sql: `SELECT
          PERFORMANCE_QUARTER_START_DATE,
          NET_IRR, TVPI, DPI, MOIC,
          NET_IRR_25TH, NET_IRR_50TH, NET_IRR_75TH,
          TVPI_25, TVPI_50, TVPI_75,
          DPI_25, DPI_50, DPI_75,
          MOIC_25, MOIC_50, MOIC_75,
          VINTAGE_YEAR, ENTITY_TYPE_NAME, FUND_AUM_BUCKET, FUND_COUNT
        FROM FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS
        WHERE FUND_UUID = '${uuid}'
        ORDER BY PERFORMANCE_QUARTER_START_DATE ASC`,
      },
    });

    // ── Render snapshot (metrics strip + table) as soon as it resolves ──
    try {
      const rS = await snapPromise;
      if (rS && !rS.isError) {
        const rows = parseDWH(rS);
        if (rows.length > 0) snapshotRow = rows[0];
      } else {
        // Fallback to confirmed-only columns
        const rFallback = await _mcp("fetch", {
          command: 'dwh:execute:query',
          params: {
            sql: `SELECT
              FUND_SIZE, TOTAL_MOIC, TOTAL_TVPI, TOTAL_RVPI, NET_LP_IRR, LP_DPI,
              TOTAL_VALUE, ENDING_TOTAL_NAV, TOTAL_CAP_CONTRIBUTION, TOTAL_DISTRIBUTION
            FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
            WHERE FUND_UUID = '${uuid}'
            LIMIT 1`,
          },
        });
        if (!rFallback.isError) {
          const rows = parseDWH(rFallback);
          if (rows.length > 0) snapshotRow = rows[0];
        }
      }
    } catch (_) {}

    // Render metrics strip + table immediately — don't wait for charts
    if (snapshotRow) {
      perfSetStatus(null);
      perfRenderMetrics(snapshotRow);
      perfRenderMetricsTable(snapshotRow);
    }

    // ── Now await the series query and render charts ──
    try {
      let r = await seriesPromise;
      if (!r || r.isError) {
        r = await _mcp("fetch", {
          command: 'dwh:execute:query',
          params: {
            sql: `SELECT
              PERFORMANCE_QUARTER_START_DATE,
              NET_IRR, TVPI, DPI, MOIC,
              NET_IRR_25TH, NET_IRR_50TH, NET_IRR_75TH,
              TVPI_25, TVPI_50, TVPI_75,
              DPI_25, DPI_50, DPI_75,
              MOIC_25, MOIC_50, MOIC_75,
              VINTAGE_YEAR, ENTITY_TYPE_NAME, FUND_AUM_BUCKET, FUND_COUNT
            FROM FUND_ADMIN.TEMPORAL_FUND_COHORT_BENCHMARKS
            WHERE FUND_UUID = '${uuid}'
            ORDER BY PERFORMANCE_QUARTER_START_DATE ASC`,
          },
        });
      }
      if (r && !r.isError) {
        const rows = parseDWH(r);
        if (rows.length > 0) {
          seriesData = _parseSeriesRows(rows);
          const lastRow = rows[rows.length - 1];
          seriesData._cohort = {
            vintageYear: lastRow.VINTAGE_YEAR,
            entityType: lastRow.ENTITY_TYPE_NAME,
            aumBucket: lastRow.FUND_AUM_BUCKET,
            fundCount: lastRow.FUND_COUNT,
          };
        }
      }
    } catch (_) {}

    // ── Extend charts to the current quarter using the snapshot ──
    // TEMPORAL_FUND_COHORT_BENCHMARKS is a batch-computed product and may lag
    // several quarters behind.  Use the browser's current date to derive "today's
    // quarter" — this avoids any dependency on MONTH_END_DATE being present in the
    // snapshot result (e.g. when the fallback query ran without that column).
    if (snapshotRow) {
      const now = new Date();
      const curQStart = new Date(Date.UTC(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1));
      const snapQLabel = _fmtQtr(curQStart.toISOString().substring(0, 10));
      // Convert "Q3'26" → sortable integer 202603.
      // Use string indexing instead of regex to avoid apostrophe character-encoding issues
      // (the curly-quote U+2019 used in _fmtQtr templates doesn't match a straight-quote regex).
      const qToNum = s => {
        if (!s || s.length < 5) return 0;
        const q = parseInt(s[1], 10);      // s = "Q3'26" → s[1] = '3'
        const y = parseInt(s.slice(-2), 10); // s.slice(-2) = '26'
        return (!isNaN(q) && !isNaN(y)) ? (2000 + y) * 10 + q : 0;
      };
      const lastLabel = seriesData && seriesData.length > 0
        ? seriesData[seriesData.length - 1].QUARTER_END_DATE
        : null;
      if (qToNum(snapQLabel) > qToNum(lastLabel)) {
        const snapPoint = {
          QUARTER_END_DATE: snapQLabel,
          NET_IRR:  snapshotRow.NET_LP_IRR  != null ? snapshotRow.NET_LP_IRR  / 100 : null,
          TVPI:     snapshotRow.TOTAL_TVPI   != null ? parseFloat(snapshotRow.TOTAL_TVPI)   : null,
          DPI:      snapshotRow.LP_DPI       != null ? parseFloat(snapshotRow.LP_DPI)       : null,
          MOIC:     snapshotRow.TOTAL_MOIC   != null ? parseFloat(snapshotRow.TOTAL_MOIC)   : null,
          BENCHMARK_P25_NET_IRR: null, BENCHMARK_P50_NET_IRR: null, BENCHMARK_P75_NET_IRR: null,
          BENCHMARK_P25_TVPI:    null, BENCHMARK_P50_TVPI:    null, BENCHMARK_P75_TVPI:    null,
          BENCHMARK_P25_DPI:     null, BENCHMARK_P50_DPI:     null, BENCHMARK_P75_DPI:     null,
          BENCHMARK_P25_MOIC:    null, BENCHMARK_P50_MOIC:    null, BENCHMARK_P75_MOIC:    null,
        };
        if (!seriesData) {
          // No benchmark history at all — create series from snapshot only
          seriesData = [snapPoint];
          seriesData._cohort = null;
        } else {
          seriesData.push(snapPoint);
        }
      }
    }
  }

  if (!seriesData && !snapshotRow) {
    perfSetStatus(null);
    const container = document.getElementById('perf-page-metrics');
    if (container) container.innerHTML = '<div style="color:var(--ink-color-global-text-subtle);font-size:13px;padding:20px 0;">Select a fund above to view performance data.</div>';
    return;
  }

  // Snapshot already rendered eagerly above; clear loading status and draw charts
  perfSetStatus(null);
  if (!snapshotRow) {
    // No snapshot data at all — still render empty state
    perfRenderMetrics(null);
    perfRenderMetricsTable(null);
  }
  if (seriesData) {
    perfDrawCharts(seriesData);
    // Show cohort label below metrics strip
    const cohortEl = document.getElementById('perf-cohort-label');
    if (cohortEl && seriesData._cohort) {
    const c = seriesData._cohort;
    const hasBenchmarkData = seriesData.some(d => d.BENCHMARK_P50_NET_IRR != null);
    const parts = [];
    if (c.vintageYear) parts.push(c.vintageYear);
    if (c.entityType)  parts.push(c.entityType);
    if (c.aumBucket)   parts.push(c.aumBucket.replace(/-/g, '\u2013') + ' AUM');
    if (c.fundCount)   parts.push(c.fundCount + ' funds in cohort');
    if (hasBenchmarkData) {
      cohortEl.textContent = parts.length ? 'Benchmarks: ' + parts.join(' \u00b7 ') : '';
      cohortEl.style.display = parts.length ? 'block' : 'none';
    } else if (parts.length) {
      cohortEl.innerHTML = 'Cohort: ' + parts.join(' \u00b7 ') + ' &mdash; <em>peer benchmark data not yet available for this cohort</em>';
      cohortEl.style.display = 'block';
    } else {
      cohortEl.style.display = 'none';
    }
  }
  } // end if (seriesData)
}

function perfRenderMetrics(s) {
  const strip = document.getElementById('perf-page-metrics');
  if (!strip) return;
  if (!s) { strip.innerHTML = ''; return; }
  const fmtPct = v => v != null ? parseFloat(v).toFixed(1) + '%' : '—';
  const fmtX   = v => v != null ? parseFloat(v).toFixed(2) + 'x' : '—';
  const fmtDlr = v => v != null ? fmtFull(parseFloat(v)) : '—';
  const fundSize    = fmtDlr(s.FUND_SIZE);
  const totalValue  = fmtDlr(s.TOTAL_VALUE);
  const totalInv    = fmtDlr(s.TOTAL_COST_OF_INVESTMENTS);
  const dryPowder   = fmtDlr(s.DRY_POWDER);
  strip.innerHTML = `
    <div class="perf-metric"><div class="perf-metric-label">Fund Size</div><div class="perf-metric-val">${fundSize}</div></div>
    <div class="perf-metric"><div class="perf-metric-label">Total Value</div><div class="perf-metric-val">${totalValue}</div></div>
    <div class="perf-metric"><div class="perf-metric-label">Total Invested</div><div class="perf-metric-val">${totalInv}</div></div>
    <div class="perf-metric"><div class="perf-metric-label">Dry Powder</div><div class="perf-metric-val">${dryPowder}</div></div>
  `;
}

function perfRenderMetricsTable(s) {
  const container = document.getElementById('perf-detail-metrics-table');
  if (!container) return;
  if (!s) { container.innerHTML = ''; return; }
  const fmtPct = v => v != null ? parseFloat(v).toFixed(1) + '%' : '—';
  const fmtX   = v => v != null ? parseFloat(v).toFixed(2) + 'x' : '—';
  const fmtDlr = v => v != null ? fmtFull(parseFloat(v)) : '—';
  // [label, LP key, Total key, formatter]
  const rows = [
    ['Total Value to Paid-in Capital (TVPI)',   'LP_TVPI',                   'TOTAL_TVPI',             fmtX],
    ['Distributions to Paid-in Capital (DPI)',  'LP_DPI',                    null,                     fmtX],
    ['Residual Value to Paid-in Capital (RVPI)','LP_RVPI',                   'TOTAL_RVPI',             fmtX],
    ['Net Internal Rate of Return (Net IRR)',   'NET_LP_IRR',                null,                     fmtPct],
    ['Multiple on Invested Capital (MOIC)',     'LP_MOIC',                   'TOTAL_MOIC',             fmtX],
    ['Total Value',                             'LP_VALUE',                  'TOTAL_VALUE',            fmtDlr],
    ['Net Asset Value (NAV)',                   'ENDING_LP_NAV',             'ENDING_TOTAL_NAV',       fmtDlr],
    ['Contributions',                           'TOTAL_LP_CAP_CONTRIBUTION', 'TOTAL_CAP_CONTRIBUTION', fmtDlr],
    ['Distributions',                           'TOTAL_LP_DISTRIBUTION',     'TOTAL_DISTRIBUTION',     fmtDlr],
  ];
  const bodyRows = rows.map(([label, lpKey, totalKey, fmt]) =>
    `<tr><td>${label}</td><td>${fmt(s[lpKey])}</td><td>${totalKey ? fmt(s[totalKey]) : '—'}</td></tr>`
  ).join('');
  container.innerHTML = `
    <table class="perf-detail-table">
      <thead><tr><th>Metric</th><th>LP Only</th><th>Total Fund</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function perfDrawCharts(data) {
  const labels = data.map(d => d.QUARTER_END_DATE);
  const textClr = chartLabelColor();


  const baseOpts = (yFmt) => ({
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false, labels: { color: textClr } },
      tooltip: {
        enabled: true, mode: 'index', intersect: false,
        backgroundColor: 'rgba(26,26,26,0.94)',
        titleColor: '#9C9F9F', titleFont: { size: 10, family: 'Inter,system-ui,sans-serif' },
        bodyColor: '#FFFFFF', bodyFont: { size: 11, family: 'Inter,system-ui,sans-serif' },
        borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1,
        padding: { top: 8, bottom: 8, left: 12, right: 12 }, cornerRadius: 4, caretSize: 4,
        itemSort: (a, b) => b.parsed.y - a.parsed.y,
        callbacks: {
          label(item) { return ` ${item.dataset.label}: ${yFmt(item.parsed.y)}`; },
          labelColor(item) { return { borderColor: item.dataset.borderColor, backgroundColor: item.dataset.borderColor, borderWidth: 2, borderRadius: 2 }; },
        },
      },
    },
    scales: {
      x: { ticks: { color: textClr, font: { size: 9, family: 'Inter,system-ui,sans-serif' } }, grid: { display: false }, border: { display: false } },
      y: { ticks: { color: textClr, font: { size: 9, family: 'Inter,system-ui,sans-serif' }, callback: yFmt }, grid: { color: 'rgba(128,128,128,0.12)' }, border: { display: false } },
    },
  });

  const crosshair = {
    id: 'crosshair',
    afterDraw(chart) {
      if (!chart.tooltip._active?.length) return;
      const { ctx, scales: { x, y } } = chart;
      const xPos = chart.tooltip._active[0].element.x;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(xPos, y.top); ctx.lineTo(xPos, y.bottom);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(128,128,128,0.25)';
      ctx.setLineDash([3, 3]); ctx.stroke(); ctx.restore();
    },
  };

  const xFmt = v => v.toFixed(2) + 'x';

  // ── TVPI chart ──
  const tvpiCtx = document.getElementById('perf-tvpi-chart').getContext('2d');
  perfTvpiChartInst = new Chart(tvpiCtx, {
    type: 'line', plugins: [crosshair],
    data: { labels, datasets: [
      { label: 'P75',  data: data.map(d => d.BENCHMARK_P75_TVPI), borderColor: '#DEDFDF', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#DEDFDF', fill: false, tension: 0.4 },
      { label: 'P50',  data: data.map(d => d.BENCHMARK_P50_TVPI), borderColor: '#A7AAAA', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#A7AAAA', fill: false, tension: 0.4 },
      { label: 'Fund', data: data.map(d => d.TVPI),               borderColor: '#285DA3', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#285DA3', fill: false, tension: 0.4 },
      { label: 'P25',  data: data.map(d => d.BENCHMARK_P25_TVPI), borderColor: '#DEDFDF', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#DEDFDF', fill: false, tension: 0.4 },
    ].filter(ds => ds.data.some(v => v != null))},
    options: { ...baseOpts(xFmt) },
  });

  // ── DPI chart ──
  const dpiCtx = document.getElementById('perf-dpi-chart').getContext('2d');
  perfDpiChartInst = new Chart(dpiCtx, {
    type: 'line', plugins: [crosshair],
    data: { labels, datasets: [
      { label: 'P75',  data: data.map(d => d.BENCHMARK_P75_DPI), borderColor: '#DEDFDF', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#DEDFDF', fill: false, tension: 0.4 },
      { label: 'P50',  data: data.map(d => d.BENCHMARK_P50_DPI), borderColor: '#A7AAAA', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#A7AAAA', fill: false, tension: 0.4 },
      { label: 'Fund', data: data.map(d => d.DPI),               borderColor: '#285DA3', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#285DA3', fill: false, tension: 0.4 },
      { label: 'P25',  data: data.map(d => d.BENCHMARK_P25_DPI), borderColor: '#DEDFDF', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#DEDFDF', fill: false, tension: 0.4 },
    ].filter(ds => ds.data.some(v => v != null))},
    options: { ...baseOpts(xFmt) },
  });

  // ── Net IRR chart ──
  const irrPct = v => (v * 100).toFixed(1) + '%';
  const irrCtx = document.getElementById('perf-irr-chart').getContext('2d');
  const irrLegend = document.getElementById('perf-irr-legend');
  const hasBenchmarkIrr = data.some(d => d.BENCHMARK_P50_NET_IRR != null);
  const irrDatasets = [
    { label: 'P75',  data: data.map(d => d.BENCHMARK_P75_NET_IRR), borderColor: '#DEDFDF', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#DEDFDF', fill: false, tension: 0.4 },
    { label: 'P50',  data: data.map(d => d.BENCHMARK_P50_NET_IRR), borderColor: '#A7AAAA', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#A7AAAA', fill: false, tension: 0.4 },
    { label: 'Fund', data: data.map(d => d.NET_IRR),               borderColor: '#285DA3', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#285DA3', fill: false, tension: 0.4 },
    { label: 'P25',  data: data.map(d => d.BENCHMARK_P25_NET_IRR), borderColor: '#DEDFDF', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#DEDFDF', fill: false, tension: 0.4 },
  ].filter(ds => ds.data.some(v => v != null));
  perfIrrChartInst = new Chart(irrCtx, { type: 'line', plugins: [crosshair], data: { labels, datasets: irrDatasets }, options: { ...baseOpts(irrPct) } });
  if (irrLegend) {
    const legendItems = [{ color: '#285DA3', label: 'Fund' }];
    if (hasBenchmarkIrr) {
      legendItems.push({ color: '#A7AAAA', label: 'P50 benchmark' }, { color: '#DEDFDF', label: 'P25 / P75' });
    }
    irrLegend.innerHTML = legendItems.map(i => `<span class="perf-legend-item"><span class="perf-legend-dot" style="background:${i.color}"></span>${i.label}</span>`).join('');
  }

  // ── MOIC chart ──
  const moicEl = document.getElementById('perf-moic-chart');
  if (moicEl) {
    const moicCtx = moicEl.getContext('2d');
    perfMoicChartInst = new Chart(moicCtx, {
      type: 'line', plugins: [crosshair],
      data: { labels, datasets: [
        { label: 'P75',  data: data.map(d => d.BENCHMARK_P75_MOIC), borderColor: '#DEDFDF', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#DEDFDF', fill: false, tension: 0.4 },
        { label: 'P50',  data: data.map(d => d.BENCHMARK_P50_MOIC), borderColor: '#A7AAAA', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#A7AAAA', fill: false, tension: 0.4 },
        { label: 'Fund', data: data.map(d => d.MOIC),               borderColor: '#285DA3', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: '#285DA3', fill: false, tension: 0.4 },
        { label: 'P25',  data: data.map(d => d.BENCHMARK_P25_MOIC), borderColor: '#DEDFDF', borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: '#DEDFDF', fill: false, tension: 0.4 },
      ].filter(ds => ds.data.some(v => v != null))},
      options: { ...baseOpts(xFmt) },
    });
  }
}

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
  const feedback = () => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'; btn.classList.remove('copied'); }, 2000);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(feedback).catch(() => {
      fallback(text) ? feedback() : showToast('Could not copy to clipboard');
    });
  } else {
    fallback(text) ? feedback() : showToast('Could not copy to clipboard');
  }
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
