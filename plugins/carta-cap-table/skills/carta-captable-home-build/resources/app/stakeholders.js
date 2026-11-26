// Stakeholders card: the summary counts only. One row of ids is read, so no name or email reaches the page.

// Kept so the drill-down page can render on open without a second fetch.
let _stakeholderSummary = null;

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

// Relationship names are dynamic per corporation — never hardcode an enum, just iterate.
// One measure across nominal categories, so every bar wears the same hue: bar length
// already carries the magnitude, and a per-category color would double-encode it.
function renderStakeholders(count, byType) {
  const el = document.getElementById("stakeholders-card-body");
  if (!el) return;
  const types = stakeholderTypeRows(byType);
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

// A stakeholder with no relationship has `relationship: null`; the card names it "Other".
function countsByRelationship(rows) {
  const byType = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const type = row && row.relationship ? row.relationship : "Other";
    byType[type] = (byType[type] || 0) + numOrZero(row && row.count);
  }
  return byType;
}

function stakeholderTypeRows(byType) {
  return Object.keys(byType || {})
    .map(type => ({ type, value: numOrZero(byType[type]) }))
    .filter(t => t.value > 0)
    .sort((a, b) => b.value - a.value);
}

function renderStakeholdersPage() {
  const body = document.getElementById("stakeholders-page-body");
  if (!body) return;
  if (!_stakeholderSummary) {
    body.innerHTML = `<div class="empty-row">No stakeholders for this company.</div>`;
    return;
  }
  const rows = stakeholderTypeRows(_stakeholderSummary.byType);
  const total = _stakeholderSummary.count;
  body.innerHTML = `
    <table class="fp-table">
      <thead>
        <tr><th>Stakeholder type</th><th class="num">Stakeholders</th><th class="num">% of total</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${escHtml(r.type)}</td>
            <td class="num">${escHtml(new Intl.NumberFormat("en-US").format(r.value))}</td>
            <td class="num">${total > 0 ? (r.value / total * 100).toFixed(1) + "%" : "—"}</td>
          </tr>`).join("")}
        <tr>
          <td><strong>Total</strong></td>
          <td class="num"><strong>${escHtml(new Intl.NumberFormat("en-US").format(total))}</strong></td>
          <td class="num"></td>
        </tr>
      </tbody>
    </table>
    ${fullPagePrompt("stakeholders-page")}`;
}

async function fetchStakeholders(corporationId) {
  _stakeholderSummary = null;
  renderStakeholdersLoading();
  let res;
  try {
    res = await _mcp("call_tool", {
      name: "cap_table__list__stakeholders",
      arguments: { corporation_id: corporationId, size: 1, fields: ["id"] },
    });
  } catch (e) {
    if (corporationId !== _selectedCorporationId) return;
    renderStakeholdersError();
    reportCardFailure(e && e.message);
    return;
  }
  if (corporationId !== _selectedCorporationId) return;
  const candidates = _mcpResultCandidates(res);
  const errText = _mcpErrorMessage(res, candidates);
  if (errText) { renderStakeholdersError(); reportCardFailure(errText); return; }
  const withSummary = candidates.find(c => c && c.summary && typeof c.summary.count === "number");
  if (!withSummary) {
    renderStakeholdersError();
    reportCardFailure("cap_table__list__stakeholders returned no stakeholder count.");
    return;
  }
  const { count, by_relationship: byRelationship } = withSummary.summary;
  if (count === 0) { renderStakeholdersEmpty(); return; }
  _stakeholderSummary = { count, byType: countsByRelationship(byRelationship) };
  renderStakeholders(_stakeholderSummary.count, _stakeholderSummary.byType);
}
