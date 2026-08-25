function renderOptionPoolLoading() {
  const el = document.getElementById("option-pool-card-body");
  if (el) el.innerHTML = `<div class="loading-row">Loading option pool detail…</div>`;
}
function renderOptionPoolError(kind) {
  const el = document.getElementById("option-pool-card-body");
  if (!el) return;
  // A non-staff admin is the primary user here — a permission gap must read as an
  // explanation, never as a red error banner.
  el.innerHTML = kind === "forbidden"
    ? `<div class="empty-row">Option pool detail isn't available for your role.</div>`
    : `<div class="error-row">Couldn't load option pool detail.</div>`;
}
function renderOptionPoolEmpty() {
  const el = document.getElementById("option-pool-card-body");
  if (el) el.innerHTML = `<div class="empty-row">No option plans for this company.</div>`;
}

// Utilization is a ratio against a fixed pool, so each plan reads as a meter: the
// fill is what's granted, the track is the whole pool.
function renderOptionPool(plans) {
  const el = document.getElementById("option-pool-card-body");
  if (!el) return;
  el.innerHTML = plans.map(plan => {
    const size = numOrZero(plan.size);
    const available = numOrZero(plan.available_quantity);
    const utilizedPct = size > 0 ? Math.max(0, Math.min(100, ((size - available) / size) * 100)) : null;
    const expiredTag = plan.is_expired
      ? ` <span class="neg">(expired${plan.expiration_date ? " " + escHtml(fmtDate(plan.expiration_date)) : ""})</span>`
      : "";
    return `
      <div class="meter-block">
        <div class="meter-head">
          <span class="meter-name">${escHtml(plan.name || "Option plan")}${expiredTag}</span>
          <span class="meter-val">${utilizedPct == null ? "—" : utilizedPct.toFixed(0) + "% used"}</span>
        </div>
        <div class="meter-track">${utilizedPct == null ? "" : `<div class="meter-fill" style="width:${utilizedPct.toFixed(1)}%"></div>`}</div>
        <div class="meter-sub">${escHtml(fmtSharesShort(available))} available of ${escHtml(fmtSharesShort(size))}</div>
      </div>
    `;
  }).join("");
}

async function fetchOptionPool(corporationId) {
  renderOptionPoolLoading();
  let res;
  try {
    res = await _mcp("call_tool", { name: "cap_table__get__option_plans", arguments: { corporation_id: corporationId } });
  } catch (e) {
    if (corporationId !== _selectedCorporationId) return;
    renderOptionPoolError(_isPermissionError(e && e.message) ? "forbidden" : "error");
    return;
  }
  if (corporationId !== _selectedCorporationId) return;
  const candidates = _mcpResultCandidates(res);
  const errText = _mcpErrorMessage(res, candidates);
  if (errText) { renderOptionPoolError(_isPermissionError(errText) ? "forbidden" : "error"); return; }
  const withResults = candidates.find(c => c && Array.isArray(c.results));
  if (!withResults) { renderOptionPoolError("error"); return; }
  if (!withResults.results.length) { renderOptionPoolEmpty(); return; }
  renderOptionPool(withResults.results);
}
