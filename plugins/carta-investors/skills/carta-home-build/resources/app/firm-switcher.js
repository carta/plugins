// Firm switcher: a login that opens several firms (an outsourced CFO's clients) picks the
// firm Home shows. The choice is the connector's active firm, the same one fetchLiveData reads
// on open, so switching sets it and reloads the page to rebuild every card for that firm.
// Carta staff are listed only their active firm, so for them the switcher adds a search box
// that asks list_contexts for firms by name.
// Depends on core.js (carta-home.app.js): _mcp(), trackHome(), _homeLoad, extractContextsPayload(),
// _mcpResultCandidates();
// app/connection-states.js: reloadHome().

// How set_context's reply starts when the firm was set; a refusal comes back as text, not an error.
const FIRM_CONTEXT_SET_PREFIX = "Context set to firm:";
const FIRM_SEARCH_DELAY_MS = 300;

let _firmSwitcherFirms = [];
let _firmSwitcherActiveId = null;
let _firmSwitcherIsStaff = false;
let _firmSearchSeq = 0;
let _firmSearchTimer = null;

// The firms Home can switch between: those with an id and a name, one entry per id.
function switchableFirms(firms) {
  const seen = new Set();
  return (firms || []).filter(f => {
    if (!f || f.firm_id == null || !f.firm_name || seen.has(String(f.firm_id))) return false;
    seen.add(String(f.firm_id));
    return true;
  });
}

function fillFirmSelect(select, firms, activeId) {
  select.replaceChildren(...firms.map(f => {
    const opt = document.createElement("option");
    opt.value = String(f.firm_id);
    opt.textContent = f.firm_name;
    return opt;
  }));
  select.value = activeId ?? "";
  select.dataset.activeFirm = activeId ?? "";
}

// Draws the header's firm control from the last firms and active firm Home was given. A login
// with a single firm has nothing to switch, so the control stays hidden, except for staff, who
// get the search box. A loaded firm missing from the list leaves nothing selected, so every
// listed firm can be picked.
function drawFirmSwitcher() {
  const wrap = document.getElementById("firm-switcher");
  const select = document.getElementById("firm-switcher-select");
  const search = document.getElementById("firm-switcher-search");
  if (!wrap || !select) return;
  const options = switchableFirms(_firmSwitcherFirms);
  if (!_firmSwitcherIsStaff && options.length < 2) {
    wrap.hidden = true;
    return;
  }
  fillFirmSelect(select, options, _firmSwitcherActiveId);
  if (search) search.hidden = !_firmSwitcherIsStaff;
  wrap.hidden = false;
}

// Called with list_contexts' firms and the firm fetchLiveData loaded as the current one.
function renderFirmSwitcher(firms, activeId) {
  _firmSwitcherFirms = firms || [];
  _firmSwitcherActiveId = activeId ?? null;
  drawFirmSwitcher();
}

// Called with the profile's staff flag, which can arrive before or after the firms.
function setFirmSwitcherStaff(isStaff) {
  _firmSwitcherIsStaff = isStaff === true;
  drawFirmSwitcher();
}

// Lists the firms whose name matches `query`, or Home's own list when the box is empty. Only
// the latest search draws: an older answer that lands late is dropped.
function searchFirms(query) {
  clearTimeout(_firmSearchTimer);
  const seq = ++_firmSearchSeq;
  _firmSearchTimer = setTimeout(async () => {
    const select = document.getElementById("firm-switcher-select");
    if (!select) return;
    let firms = _firmSwitcherFirms;
    if (query) {
      try {
        const res = await _mcp("list_contexts", { firm_name: query });
        if (res?.isError) return;
        firms = extractContextsPayload(res)?.firms ?? [];
      } catch (_) {
        return;
      }
    }
    if (seq !== _firmSearchSeq) return;
    fillFirmSelect(select, switchableFirms(firms), _firmSwitcherActiveId);
  }, FIRM_SEARCH_DELAY_MS);
}

async function switchFirm(select) {
  const firmId = select.value;
  const previous = select.dataset.activeFirm;
  if (!firmId || firmId === previous) return;
  select.disabled = true;
  trackHome("click", "CartaHome.FirmSwitcher.Changed");
  // A load in flight ends by setting the firm it opened on; the viewer's choice must be the last one sent.
  if (_homeLoad) await _homeLoad.catch(() => {});
  let ok = false;
  try {
    const res = await _mcp("set_context", { firm_id: firmId });
    // The reply is plain text, or that text wrapped as {result: "..."}; a refusal is text too.
    const texts = [res?.content?.[0]?.text, ..._mcpResultCandidates(res).map(c => c?.result)];
    ok = !res?.isError && texts.some(t => typeof t === "string" && t.startsWith(FIRM_CONTEXT_SET_PREFIX));
  } catch (_) {}
  if (ok) {
    reloadHome();
    return;
  }
  // The firm did not change, so the page still shows the previous one: say so by restoring it.
  select.value = previous;
  select.disabled = false;
  trackHome("click", "CartaHome.FirmSwitcher.Failed");
}

document.getElementById("firm-switcher-select")?.addEventListener("change", e => switchFirm(e.target));
document.getElementById("firm-switcher-search")?.addEventListener("input", e => searchFirms(e.target.value.trim()));
