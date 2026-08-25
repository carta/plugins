// ── Drafts card — draft_sets needs one call per security_type, merged. Read-only. ──

const DRAFT_SECURITY_TYPES = [["certificate", "Certificate"], ["option_grant", "Option grant"]];

function renderDraftsLoading() {
  const el = document.getElementById("drafts-card-body");
  if (el) el.innerHTML = `<div class="loading-row">Loading draft issuances…</div>`;
}
function renderDraftsError() {
  const el = document.getElementById("drafts-card-body");
  if (el) el.innerHTML = `<div class="error-row">Couldn't load draft issuances.</div>`;
}
function renderDraftsEmpty() {
  const el = document.getElementById("drafts-card-body");
  if (el) el.innerHTML = `<div class="empty-row">No draft issuances for this company.</div>`;
}

function draftCountLabel(count) {
  if (count == null) return null;
  return count === 1 ? "1 draft" : `${count} drafts`;
}

// Name, then one meta line: the status pill is the only thing on the right, so a
// long set name can no longer push a three-part value column into three rows.
function renderDrafts(drafts, partialFailureNote) {
  const el = document.getElementById("drafts-card-body");
  if (!el) return;
  const note = partialFailureNote ? `<div class="loading-row">${escHtml(partialFailureNote)}</div>` : "";
  el.innerHTML = note + drafts.map(d => {
    const meta = [d.securityTypeLabel, draftCountLabel(d.draft_count), fmtDate(d.updated || d.created)]
      .filter(Boolean).join(" · ");
    return `
    <div class="draft-row">
      <div class="draft-main">
        <div class="draft-name">${escHtml(decodeHtmlEntities(d.name) || "Draft set")}</div>
        <div class="draft-meta">${escHtml(meta)}</div>
      </div>
      ${d.status ? `<span class="draft-status">${escHtml(humanizeEnum(d.status))}</span>` : ""}
    </div>`;
  }).join("");
}

async function fetchDrafts(corporationId) {
  renderDraftsLoading();
  const settled = await Promise.allSettled(DRAFT_SECURITY_TYPES.map(([securityType]) =>
    _mcp("call_tool", { name: "cap_table__list__draft_sets", arguments: { corporation_id: corporationId, security_type: securityType } })
  ));
  if (corporationId !== _selectedCorporationId) return;

  const merged = [];
  let succeededTypes = 0;
  let failedLabels = [];
  settled.forEach((outcome, idx) => {
    const label = DRAFT_SECURITY_TYPES[idx][1];
    if (outcome.status !== "fulfilled") { failedLabels.push(label); return; }
    const candidates = _mcpResultCandidates(outcome.value);
    const errText = _mcpErrorMessage(outcome.value, candidates);
    const withResults = !errText && candidates.find(c => c && Array.isArray(c.results));
    if (!withResults) { failedLabels.push(label); return; }
    succeededTypes += 1;
    withResults.results.forEach(row => merged.push(Object.assign({ securityTypeLabel: label }, row)));
  });

  if (succeededTypes === 0) { renderDraftsError(); return; }
  if (!merged.length) { renderDraftsEmpty(); return; }
  merged.sort((a, b) => new Date(b.updated || b.created || 0) - new Date(a.updated || a.created || 0));
  const note = failedLabels.length ? `${failedLabels.join(", ")} drafts unavailable right now.` : null;
  renderDrafts(merged, note);
}
