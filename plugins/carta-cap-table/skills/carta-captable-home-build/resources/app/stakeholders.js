// Stakeholders card: summary mode only, no names — avoids exposing PII.

function renderStakeholdersLoading() {
  const el = document.getElementById("stakeholders-card-body");
  if (el) el.innerHTML = `<div class="loading-row">Loading the stakeholder list…</div>`;
}
function renderStakeholdersError() {
  const el = document.getElementById("stakeholders-card-body");
  if (el) el.innerHTML = `<div class="error-row">Couldn't load stakeholder data.</div>`;
}
function renderStakeholdersEmpty() {
  const el = document.getElementById("stakeholders-card-body");
  if (el) el.innerHTML = `<div class="empty-row">No stakeholders for this company.</div>`;
}

// by_type keys are dynamic per corporation — never hardcode an enum, just iterate.
// One measure across nominal categories, so every bar wears the same hue: bar length
// already carries the magnitude, and a per-category color would double-encode it.
function renderStakeholders(count, byType) {
  const el = document.getElementById("stakeholders-card-body");
  if (!el) return;
  const types = Object.keys(byType || {})
    .map(type => ({ type, value: numOrZero(byType[type]) }))
    .filter(t => t.value > 0)
    .sort((a, b) => b.value - a.value);
  const max = types.reduce((m, t) => Math.max(m, t.value), 0);
  el.innerHTML = `
    <div class="stat-row">
      ${statTile("Total stakeholders", new Intl.NumberFormat("en-US").format(count))}
    </div>
    ${types.length ? `<div class="bar-list">${types.map(t => `
      <div class="bar-row">
        <span class="bar-label">${escHtml(t.type)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${max > 0 ? (t.value / max * 100).toFixed(1) : 0}%"></span></span>
        <span class="bar-value">${escHtml(new Intl.NumberFormat("en-US").format(t.value))}</span>
      </div>`).join("")}</div>` : ""}`;
}

async function fetchStakeholders(corporationId) {
  renderStakeholdersLoading();
  let res;
  try {
    res = await _mcp("call_tool", { name: "cap_table__get__stakeholders", arguments: { corporation_id: corporationId } });
  } catch (e) {
    if (corporationId !== _selectedCorporationId) return;
    renderStakeholdersError();
    return;
  }
  if (corporationId !== _selectedCorporationId) return;
  const candidates = _mcpResultCandidates(res);
  const errText = _mcpErrorMessage(res, candidates);
  if (errText) { renderStakeholdersError(); return; }
  const withCount = candidates.find(c => c && typeof c.count === "number");
  if (!withCount) { renderStakeholdersError(); return; }
  if (withCount.count === 0) { renderStakeholdersEmpty(); return; }
  renderStakeholders(withCount.count, withCount.by_type || {});
}
