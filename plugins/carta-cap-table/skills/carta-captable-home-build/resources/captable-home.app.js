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

let activePopover = null;

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

function showPromptPopover(btn, prompt, skillId) {
  if (activePopover) { activePopover.remove(); activePopover = null; }

  const pop = document.createElement("div");
  pop.className = "prompt-popover";
  pop.innerHTML = `
    <p class="pop-subtitle">Paste this in chat to run the skill.</p>
    <div class="db-prompt-row">
      <span class="db-prompt-text">${escHtml(prompt)}</span>
      <button class="db-copy-btn" id="pop-copy"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>Copy</button>
    </div>
  `;
  document.body.appendChild(pop);
  activePopover = pop;

  const rect = btn.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.top  = (rect.bottom + 8) + "px";
  pop.style.left = Math.max(8, rect.left) + "px";
  pop.style.maxWidth = "calc(100vw - 16px)";

  const copyBtn = pop.querySelector("#pop-copy");
  copyBtn.addEventListener("click", () => {
    copyText(prompt, () => {
      copyBtn.textContent = "✓ Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => { if (activePopover === pop) { pop.remove(); activePopover = null; } }, 1200);
    });
  });

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

document.querySelectorAll(".run-btn[data-prompt]").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const skill = btn.dataset.skill;
    trackHome("click", "CaptableHome.RunPrompt" + (skill ? "." + skill.charAt(0).toUpperCase() + skill.slice(1) : ""));
    showPromptPopover(btn, resolvePrompt(btn.dataset.prompt), btn.dataset.skill);
  });
});

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

const CARD_IDS = ["captable-dash-body", "rounds-dash-body", "ownership-card-body", "fd-summary-card-body", "option-pool-card-body", "stakeholders-card-body", "drafts-card-body"];
const CARD_LOADING_LABELS = {
  "captable-dash-body": "the cap table",
  "rounds-dash-body": "the round history",
  "ownership-card-body": "the ownership breakdown",
  "fd-summary-card-body": "the fully diluted summary",
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
function setAllCardsSelectCompany() {
  CARD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div class="empty-row">Select a company to see this.</div>`;
  });
}

const LS_SELECTED_CORP_KEY = "captableHome.selectedCorporationId";
const LS_SELECTED_NAME_KEY = "captableHome.selectedCompanyName";
const CORP_ID_PREFIX = "corporation_pk:";
// list_accounts returns one entity-switcher page, capped at 200 accounts ordered
// by legal name. Search is the only way to reach a company past that page.
const ACCOUNTS_PAGE_CAP = 200;
const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 300;

// Some artifact hosts provide no web storage at all — every read/write is
// wrapped so a broken storage backend degrades to "choice not remembered".
function lsGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) {} }

// `search` is matched server-side across every account the user can reach, so it
// finds companies the unsearched first page leaves out.
async function fetchEligibleCompanies(search) {
  const args = { detail: "full" };
  if (search) args.search = search;
  const res = await _mcp("list_accounts", args);
  const candidates = _mcpResultCandidates(res);
  const errText = _mcpErrorMessage(res, candidates);
  if (errText) throw new Error(errText);
  const withAccounts = candidates.find(c => c && Array.isArray(c.accounts));
  const accounts = withAccounts ? withAccounts.accounts : [];
  // Filter on the id prefix, not `type`: a corporation under a parent org is
  // typed "fund" and still has a cap table.
  const companies = accounts
    .filter(a => a && typeof a.id === "string" && a.id.indexOf(CORP_ID_PREFIX) === 0)
    .map(a => ({ corporationId: a.id.slice(CORP_ID_PREFIX.length), name: a.name || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { companies, atPageCap: accounts.length >= ACCOUNTS_PAGE_CAP };
}

function renderCompanySelectorMessage(message) {
  const slot = document.getElementById("company-selector-slot");
  if (slot) slot.innerHTML = `<div class="company-selector-error">${escHtml(message)}</div>`;
}

// The single source of truth for "which company is selected right now" — set
// synchronously (never inside an await) so every in-flight fetch can compare
// against it after each await and discard its result if it no longer matches.
let _selectedCorporationId = null;
let _selectedCompanyName = "";
let _companyOptions = [];
let _searchSeq = 0;
let _companyQuery = "";
let _activeOptionIndex = -1;
let _comboboxOpen = false;

function selectCompany(corporationId, name) {
  _selectedCorporationId = corporationId;
  _selectedCompanyName = name || "";
  lsSet(LS_SELECTED_CORP_KEY, corporationId);
  lsSet(LS_SELECTED_NAME_KEY, _selectedCompanyName);
  document.getElementById("company-subtitle").textContent = _selectedCompanyName || "Cap table for this company.";
  // Repaint every surface holding a {{COMPANY}} prompt so it names the new company.
  renderDirectory();
  renderCapabilities();
  renderWhatsNew();
  resetDashboardState();
  setAllCardsLoading();
  loadCompanyData(corporationId);
}

function setSelectorHint(message) {
  const hint = document.getElementById("company-selector-hint");
  if (hint) hint.textContent = message || "";
}

function renderCompanyOptions(companies) {
  // Keep the current company selectable even when it is absent from the newest
  // result set, so a search never silently drops what the cards are showing.
  const list = companies.slice();
  if (_selectedCorporationId && !list.some(c => c.corporationId === _selectedCorporationId)) {
    list.unshift({ corporationId: _selectedCorporationId, name: _selectedCompanyName });
  }
  _companyOptions = list;
  renderCompanyMenu();
}

// The typed term filters the loaded options immediately; the debounced
// list_accounts search then widens the set past the first page.
function visibleCompanyOptions() {
  const term = _companyQuery.trim().toLowerCase();
  if (!term) return _companyOptions;
  return _companyOptions.filter(c => (c.name || c.corporationId).toLowerCase().includes(term));
}

function renderCompanyMenu() {
  const menu = document.getElementById("company-menu");
  if (!menu) return;
  const options = visibleCompanyOptions();
  if (_activeOptionIndex >= options.length) _activeOptionIndex = options.length - 1;
  menu.innerHTML = options.length
    ? options.map((c, i) => `
        <li class="company-option${i === _activeOptionIndex ? " active" : ""}${c.corporationId === _selectedCorporationId ? " selected" : ""}"
            id="company-option-${escHtml(c.corporationId)}" role="option"
            aria-selected="${c.corporationId === _selectedCorporationId ? "true" : "false"}"
            data-corporation-id="${escHtml(c.corporationId)}">${escHtml(c.name || c.corporationId)}</li>`).join("")
    : `<li class="company-option-empty">No companies match — keep typing to search Carta.</li>`;
}

function setComboboxOpen(open) {
  const combo = document.getElementById("company-combobox");
  const input = document.getElementById("company-search");
  if (!combo || !input) return;
  _comboboxOpen = open;
  combo.classList.toggle("open", open);
  input.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) renderCompanyMenu();
}

// Closing without a pick restores the selected company's name, so the input never
// sits on a half-typed term that no longer matches what the cards show.
function resetCompanyQuery() {
  _companyQuery = "";
  _activeOptionIndex = -1;
  const input = document.getElementById("company-search");
  if (input) input.value = _selectedCompanyName || "";
}

function commitActiveOption() {
  const options = visibleCompanyOptions();
  const chosen = options[_activeOptionIndex] || (options.length === 1 ? options[0] : null);
  if (!chosen) return false;
  chooseCompanyOption(chosen.corporationId);
  return true;
}

function chooseCompanyOption(corporationId) {
  const chosen = _companyOptions.find(c => c.corporationId === corporationId);
  if (!chosen) return;
  trackHome("click", "CaptableHome.CompanySelector.Change");
  setComboboxOpen(false);
  selectCompany(chosen.corporationId, chosen.name);
  resetCompanyQuery();
  setSelectorHint("");
}

function moveActiveOption(delta) {
  const options = visibleCompanyOptions();
  if (!options.length) return;
  const next = _activeOptionIndex + delta;
  _activeOptionIndex = next < 0 ? options.length - 1 : next % options.length;
  renderCompanyMenu();
  const active = document.querySelector(".company-option.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

async function runCompanySearch(term) {
  const seq = ++_searchSeq;
  setSelectorHint(term ? `Searching for "${term}"…` : "Loading companies…");
  let result;
  try {
    result = await fetchEligibleCompanies(term);
  } catch (e) {
    if (seq === _searchSeq) setSelectorHint("Search failed — try again.");
    return;
  }
  if (seq !== _searchSeq) return;
  renderCompanyOptions(result.companies);
  // The open list already shows the matches, so the hint only speaks up when it
  // has something the list cannot say.
  if (!result.companies.length) {
    setSelectorHint(term ? `No companies match "${term}".` : "No eligible companies found.");
  } else if (term) {
    setSelectorHint("");
  } else if (result.atPageCap) {
    setSelectorHint(`Showing the first ${result.companies.length} companies by name — search to find any other.`);
  } else {
    setSelectorHint("");
  }
}

function renderCompanySelector() {
  const slot = document.getElementById("company-selector-slot");
  if (!slot) return;
  slot.innerHTML = `
    <div class="company-combobox" id="company-combobox">
      <label class="sr-only" for="company-search">Company</label>
      <input class="company-selector-search" id="company-search" type="text" autocomplete="off"
             role="combobox" aria-controls="company-menu" aria-expanded="false" aria-autocomplete="list"
             placeholder="Search companies by name…" />
      <span class="company-combobox-caret" aria-hidden="true">▾</span>
      <ul class="company-menu" id="company-menu" role="listbox" aria-label="Companies"></ul>
    </div>
    <div class="company-selector-hint" id="company-selector-hint"></div>
  `;

  const input = document.getElementById("company-search");
  const combo = document.getElementById("company-combobox");

  let debounce = null;
  input.addEventListener("input", (e) => {
    _companyQuery = e.target.value;
    _activeOptionIndex = -1;
    setComboboxOpen(true);
    const term = _companyQuery.trim();
    if (term && term.length < SEARCH_MIN_CHARS) { setSelectorHint(`Type at least ${SEARCH_MIN_CHARS} characters.`); return; }
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      trackHome("click", "CaptableHome.CompanySelector.Search");
      runCompanySearch(term);
    }, SEARCH_DEBOUNCE_MS);
  });

  // Focus opens the list and clears the shown name, so the first keystroke starts a
  // fresh search instead of appending to the company already selected.
  input.addEventListener("focus", () => {
    input.value = "";
    _companyQuery = "";
    setComboboxOpen(true);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!_comboboxOpen) setComboboxOpen(true);
      moveActiveOption(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      if (_comboboxOpen && commitActiveOption()) e.preventDefault();
    } else if (e.key === "Escape") {
      setComboboxOpen(false);
      resetCompanyQuery();
    }
  });

  // Tabbing away fires no document click, so the blur has to restore the name too.
  // A pick can't land here: the menu's mousedown prevents the focus loss.
  input.addEventListener("blur", () => {
    if (!_comboboxOpen) return;
    setComboboxOpen(false);
    resetCompanyQuery();
  });

  document.getElementById("company-menu").addEventListener("mousedown", (e) => {
    const option = e.target.closest("[data-corporation-id]");
    if (!option) return;
    e.preventDefault();
    chooseCompanyOption(option.dataset.corporationId);
  });

  document.addEventListener("click", (e) => {
    if (!_comboboxOpen || combo.contains(e.target)) return;
    setComboboxOpen(false);
    resetCompanyQuery();
  });
}

async function initCompanySelector() {
  setAllCardsSelectCompany();
  renderCompanySelector();
  setSelectorHint("Loading companies…");

  let result;
  try {
    result = await fetchEligibleCompanies();
  } catch (e) {
    // Leave the selector in place — search can still succeed after one bad load.
    setSelectorHint("Couldn't load companies — search by name or reload.");
    setAllCardsSelectCompany();
    return;
  }

  // Restore from storage before rendering options: a company found through
  // search may not be on the first page, and its name lives only in storage.
  const persistedId = lsGet(LS_SELECTED_CORP_KEY);
  const persisted = persistedId
    ? { corporationId: persistedId, name: result.companies.find(c => c.corporationId === persistedId)?.name || lsGet(LS_SELECTED_NAME_KEY) || "" }
    : null;
  const selected = persisted || (result.companies.length === 1 ? result.companies[0] : null);
  if (selected) {
    _selectedCorporationId = selected.corporationId;
    _selectedCompanyName = selected.name || "";
  }

  renderCompanyOptions(result.companies);
  if (!result.companies.length && !selected) {
    setSelectorHint("No companies found — search by name to find one.");
  } else if (result.atPageCap) {
    setSelectorHint(`Showing the first ${result.companies.length} companies by name — search to find any other.`);
  }

  if (!selected) { setAllCardsSelectCompany(); return; }
  selectCompany(selected.corporationId, selected.name);
  resetCompanyQuery();
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
    renderCompanySelectorMessage("Not connected to Carta — company data isn't available.");
  } else {
    initCompanySelector();
  }
});
