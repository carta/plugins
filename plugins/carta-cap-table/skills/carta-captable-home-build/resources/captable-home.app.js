// ── Carta MCP bridge ──
// The artifact runtime addresses a connector by display name, so {{CARTA_MCP_SERVER}} is
// the name the build script stamps in — not a UUID and not a prefixed tool name.
const CARTA_MCP_SERVER = "{{CARTA_MCP_SERVER}}";

let _mcpNsPromise = null;
// null means this view cannot run mcp — not granted, not served, or failed to load.
function _mcpNamespace() {
  if (!_mcpNsPromise) {
    _mcpNsPromise = Promise.resolve(window.claude?.use?.("mcp") ?? null).catch(() => null);
  }
  return _mcpNsPromise;
}

// Gate every data path on this instead of probing window.claude members.
async function mcpAvailable() {
  return !!(await _mcpNamespace());
}

// Carta MCP wrapper: injects _instrumentation_v2 required since 2026-07-27
async function _mcp(tool, args) {
  const mcp = await _mcpNamespace();
  if (!mcp) throw new Error("Carta connector unavailable in this view");
  try {
    return await mcp.callTool(
      CARTA_MCP_SERVER,
      tool,
      Object.assign({}, args, { _instrumentation_v2: { skills: ['carta-cap-table:carta-captable-home-build'], from_ui: true } })
    );
  } catch (err) {
    // A failed tool belongs to the card that asked, so return an envelope. Connector
    // codes (needs_reauth, server_not_connected) rethrow — those are page-level.
    if (err?.code === "tool_error") return { isError: true, code: err.code, result: err.result, content: [{ type: "text", text: err.message ?? "tool error" }] };
    throw err;
  }
}

if (window.mcpUiTracker) {
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "artifact", interfaceId: "captable-home" },
    mcpServerId: CARTA_MCP_SERVER,
  });
}
function trackHome(action, elementId, options) {
  if (window.mcpUiTracker && window.mcpUiTracker.getTransport()) {
    window.mcpUiTracker.trackUiEvent(action, elementId, options);
  }
}

// The artifact sandbox can deny clipboard-write, and navigator.clipboard is absent in
// some hosts — so confirm a copy only once one of the two paths actually succeeded.
function copyTextFallback(str) {
  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

function copyText(str, onCopied) {
  const viaFallback = () => {
    if (copyTextFallback(str)) { onCopied(); } else { showToast('Could not copy to clipboard'); }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(str).then(onCopied).catch(viaFallback);
  } else {
    viaFallback();
  }
}

const COPY_ICON_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

// Closes a drill-down page: the user has just read the data, so this is where the
// same question carries into chat. Unresolved prompt on the button, resolved on screen.
function fullPagePrompt(pageId) {
  const prompt = DASHBOARD_PROMPTS[pageId];
  if (!prompt) return "";
  return `
    <div class="fp-prompt">
      <p class="fp-prompt-label">Ask about this in chat</p>
      <div class="db-prompt-row">
        <span class="db-prompt-text">${escHtml(resolvePrompt(prompt))}</span>
        <button class="db-copy-btn" data-prompt="${escHtml(prompt)}" onclick="fpCopyPrompt(this)">${COPY_ICON_SVG}Copy</button>
      </div>
    </div>`;
}

function fpCopyPrompt(btn) {
  trackHome("click", "CaptableHome.Dashboards.CopyPrompt");
  copyText(resolvePrompt(btn.dataset.prompt), () => {
    btn.textContent = "✓ Copied";
    btn.classList.add("copied");
    setTimeout(() => { btn.innerHTML = COPY_ICON_SVG + "Copy"; btn.classList.remove("copied"); }, 2000);
  });
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

// A copied prompt lands in a chat that has no idea what the page is showing, so
// name the company in it. Resolved at copy time, never written back to the DOM.
function resolvePrompt(text) {
  return String(text || "").replace(/\{\{COMPANY\}\}/g, _selectedCompanyName || "this company");
}

// getComputedStyle() resolves light-dark() to the color in effect; getPropertyValue()
// would return the unsubstituted token string instead — Chart.js needs the former.
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

function tryParse(str) { try { return JSON.parse(str); } catch { return null; } }

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Some names arrive already entity-escaped ("Drafts - 10&#x2F;31&#x2F;2017"), which
// escHtml would then show verbatim. A textarea parses its content as text, never markup.
function decodeHtmlEntities(str) {
  if (str == null) return '';
  const ta = document.createElement('textarea');
  ta.innerHTML = String(str);
  return ta.value;
}

// UPPER_SNAKE from the API is not label text: IN_PROGRESS → "In progress".
function humanizeEnum(value) {
  const text = String(value == null ? '' : value).replace(/_/g, ' ').trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

// Dig every plausible payload shape out of a callTool result — the server can
// return a structured object, a JSON string, or an MCP content-block array.
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

// currencyCode is an ISO 4217 code (e.g. "EUR"); omit it when the source has none —
// never default to USD. Intl renders the correct symbol/placement for whatever
// code is passed, so we never hardcode a symbol ourselves.
function fmtShort(v, currencyCode) {
  if (v == null || isNaN(v)) return "—";
  if (currencyCode) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode, notation: 'compact', maximumFractionDigits: 1 }).format(v);
    } catch (e) { /* unknown/invalid code from caller — fall back to a unitless number */ }
  }
  if (v >= 1e9) return (v/1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v/1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v/1e3).toFixed(0) + "K";
  return String(Math.round(v));
}

function fmtSharesShort(v) {
  if (v == null || v === '' || v === 'NULL') return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  if (n >= 1e6) return (n/1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n/1e3) + "K";
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

// The headline a composition bar is a share of — compact notation would restate the
// rounded segment labels instead of naming the whole.
function fmtSharesFull(v) {
  const n = parseFloat(v);
  if (v == null || v === '' || isNaN(n)) return "—";
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function fmtDate(d) {
  if (!d) return "—";
  // A date-only string parses as UTC midnight, which renders as the day before in any
  // negative-offset timezone. Timestamps keep the default parse — they need their time.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d).trim());
  const dt = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(d);
  if (isNaN(dt)) return String(d).slice(0, 10);
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ── Shared MCP error/permission detection (used by every card fetch) ──
// The transport can resolve with an in-band error instead of rejecting, so both
// paths (thrown exception and resolved-but-errored payload) need checking.
function _mcpErrorMessage(res, candidates) {
  if (res && res.isError) {
    const textBlock = Array.isArray(res.content) ? res.content.find(c => c && c.type === "text") : null;
    return (textBlock && textBlock.text) || "MCP tool returned an error.";
  }
  const withError = (candidates || []).find(c => c && typeof c.error === "string");
  return withError ? withError.error : null;
}
function _isPermissionError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("403") || text.includes("forbidden") || text.includes("permission");
}

// The connector name and the corporation are both frozen at build time, so a page
// built against the wrong pair fails every card for every viewer. Name the pair once.
let _connectionBannerShown = false;
const _DETAIL_MAX = 200;

function reportCardFailure(detail) {
  if (_connectionBannerShown) return;
  _connectionBannerShown = true;
  renderConnectionBanner(detail);
}

function renderConnectionBanner(detail) {
  const slot = document.getElementById("connection-banner-slot");
  if (!slot) return;
  const raw = String(detail == null ? "" : detail).trim();
  const text = raw.length > _DETAIL_MAX ? raw.slice(0, _DETAIL_MAX).trimEnd() + "…" : raw;
  const company = BAKED_COMPANY_NAME || "this company";
  slot.innerHTML = `
    <div class="ink-banner ink-banner--negative" role="alert" id="connection-banner">
      <div class="ink-banner__body">
        <p class="ink-banner__title">Carta returned an error for this company</p>
        <p class="ink-banner__message">
          This page asks the <strong>${escHtml(CARTA_MCP_SERVER)}</strong> connection for
          corporation <strong>${escHtml(BAKED_CORPORATION_ID)}</strong>. If ${escHtml(company)}
          is on a different Carta environment, rebuild this page against that connection.
          ${text ? `<span class="ink-banner__detail">${escHtml(text)}</span>` : ""}
        </p>
      </div>
    </div>`;
  trackHome("render", "CaptableHome.ConnectionBanner.Shown");
}

const CARD_IDS = ["fd-summary-strip", "captable-dash-body", "rounds-dash-body", "option-pool-card-body", "stakeholders-card-body", "drafts-card-body"];
const CARD_LOADING_LABELS = {
  "fd-summary-strip": "the fully diluted summary",
  "captable-dash-body": "the cap table",
  "rounds-dash-body": "the round history",
  "option-pool-card-body": "option pool detail",
  "stakeholders-card-body": "the stakeholder list",
  "drafts-card-body": "draft issuances",
};

function setAllCardsLoading() {
  CARD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="loading-row">Loading ${escHtml(CARD_LOADING_LABELS[id])}…</div>`;
  });
}
// Baked at build time so the page can never disagree with the title that names
// the same company. A second company means a second build.
const BAKED_CORPORATION_ID = "{{CORPORATION_ID}}";
const BAKED_COMPANY_NAME = {{COMPANY_NAME_JSON}};

// Every in-flight fetch compares against this after each await and discards its
// result if it no longer matches.
let _selectedCorporationId = null;
let _selectedCompanyName = "";

function selectCompany(corporationId, name) {
  _selectedCorporationId = corporationId;
  _selectedCompanyName = name || "";
  document.getElementById("company-subtitle").textContent = _selectedCompanyName || "Cap table for this company.";
  // Repaint every surface holding a {{COMPANY}} prompt so it names the new company.
  renderDirectory();
  renderCapabilities();
  renderWhatsNew();
  resetDashboardState();
  setAllCardsLoading();
  loadCompanyData(corporationId);
}

// Fire-and-forget: one slow or failing card must never block another's render.
function loadCompanyData(corporationId) {
  fetchOwnershipAndFdSummary(corporationId);
  fetchOptionPool(corporationId);
  fetchStakeholders(corporationId);
  fetchDrafts(corporationId);
  fetchRoundHistory(corporationId);
}

function switchTab(id) {
  trackHome("click", "CaptableHome.Tab." + (id === "dashboard" ? "Dashboard" : "Directory"));
  ['dashboard', 'directory'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === id);
    document.getElementById('tab-btn-' + t).classList.toggle('active', t === id);
  });
}

function renderDirectory() {
  const grid = document.getElementById('dir-grid');
  if (!grid) return;
  grid.innerHTML = DIR_CATEGORIES.map(cat => `
    <div class="dir-cat-card">
      <div class="dir-cat-header">
        <div>
          <span class="dir-cat-name">${escHtml(cat.name)}</span>
        </div>
      </div>
      <div class="dir-cat-tagline">${escHtml(cat.tagline)}</div>
      <ul class="dir-skill-list">
        ${cat.skills.map(s => {
          const body = (s.prompts && s.prompts.length)
            ? s.prompts.map(p => `<div class="dir-skill-prompt">
              <span class="dir-skill-prompt-text">"${escHtml(resolvePrompt(p))}"</span>
              <button class="dir-copy-btn" data-prompt="${escHtml(p)}" onclick="dirCopyPrompt(this)"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>
            </div>`).join('')
            : `<div class="dir-skill-note">${escHtml(s.note || '')}</div>`;
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

function dirCopyPrompt(btn) {
  trackHome("click", "CaptableHome.Directory.Copy");
  const text = resolvePrompt(btn.dataset.prompt);
  const feedback = () => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'; btn.classList.remove('copied'); }, 2000);
  };
  copyText(text, feedback);
}

// No live connector (e.g. previewing outside Carta) — broken loading must show, never a blank card.
function populateFallback() {
  CARD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `<div class="loading-row">Can't load ${escHtml(CARD_LOADING_LABELS[id])} — this page isn't connected to Carta.</div>`;
    }
  });
}

console.log("[captable-home] build {{BUILD_ID}}");
trackHome("render", "CaptableHome.View");
renderDirectory();
// The capabilities, what's-new, banner and news sections init from their own files:
// the bundle is one script, so their consts are still in the temporal dead zone here.
mcpAvailable().then(live => {
  if (!live) {
    populateFallback();
  } else {
    selectCompany(BAKED_CORPORATION_ID, BAKED_COMPANY_NAME);
  }
});
