// Firm switcher: a login that opens several firms (an outsourced CFO's clients) picks the
// firm Home shows. The choice is the connector's active firm, the same one fetchLiveData reads
// on open, so switching sets it and reloads the page to rebuild every card for that firm.
// Depends on core.js (carta-home.app.js): _mcp(), trackHome(), _homeLoad; app/connection-states.js: reloadHome().

// The firms Home can switch between: those with an id and a name, one entry per id.
function switchableFirms(firms) {
  const seen = new Set();
  return (firms || []).filter(f => {
    if (!f || f.firm_id == null || !f.firm_name || seen.has(String(f.firm_id))) return false;
    seen.add(String(f.firm_id));
    return true;
  });
}

// Fills the header's firm select from list_contexts' firms and shows it, with `activeId` (the
// firm fetchLiveData loaded) as the current one. A login with a single firm has nothing to
// switch, so the control stays hidden. A loaded firm missing from the list leaves nothing
// selected, so every listed firm can be picked.
function renderFirmSwitcher(firms, activeId) {
  const wrap = document.getElementById("firm-switcher");
  const select = document.getElementById("firm-switcher-select");
  if (!wrap || !select) return;
  const options = switchableFirms(firms);
  if (options.length < 2) {
    wrap.hidden = true;
    return;
  }
  select.replaceChildren(...options.map(f => {
    const opt = document.createElement("option");
    opt.value = String(f.firm_id);
    opt.textContent = f.firm_name;
    return opt;
  }));
  select.value = activeId ?? "";
  select.dataset.activeFirm = activeId ?? "";
  wrap.hidden = false;
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
    ok = !res?.isError;
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
