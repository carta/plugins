// ── Capital activity: pinned card + detail overlay ──
// Depends on core.js (carta-home.app.js): _mcp(), fmtShort(), fmtFull(),
// fmtDDMmmYYYY(), escHtml(), showToast(), and the shared _benchmarkFirmId.
let _capActivityData = null; // null = not yet fetched; [] = none active; [...rows] = active

// ── Capital activity: fetch active capital calls + distributions ──
// The transactional endpoint rather than the warehouse, so the cards agree with
// the detail overlay. Firm-scoped from the session context set during boot.
async function fetchCapitalActivity() {
  try {
    const res = await _mcp("fetch", { command: "fa:list:active-capital-activity", params: {} });
    if (res.isError) {
      console.error('[capactivity] fa:list:active-capital-activity failed —',
        res.content?.[0]?.text ?? res);
      _capActivityData = [];
    } else {
      const payload = JSON.parse(res.content?.[0]?.text ?? '{}');
      _capActivityData = (payload.results ?? []).map(a => {
        const isCall = (a.activity_type ?? '') === 'capital_call';
        return {
          id: a.id,
          fundUuid: a.fund_uuid,
          fundName: a.fund_name ?? 'Fund',
          activityType: a.activity_type ?? '',
          dueDate: a.due_date ?? '',
          // One side carries the total and the other is zero, keyed by type.
          totalAmount: parseFloat((isCall ? a.call_amount : a.distribution_amount) ?? 0),
          investors: parseInt(a.investors_count ?? 0, 10),
          paidInvestors: parseInt(a.completed_investors_count ?? 0, 10),
        };
      });
    }
  } catch (e) {
    console.error('[capactivity error]', e);
    _capActivityData = [];
  }
  renderCapActivitySection();
}

// ── Render the Capital activity section above Starred ──
const _dismissedCapActivities = new Set();

function renderCapActivitySection() {
  const section   = document.getElementById('ca-section-v2');
  const container = document.getElementById('ca-section-cards');
  if (!section || !container) return;

  const allActive = (_capActivityData ?? [])
    .filter(r => !_dismissedCapActivities.has(r.id))
    .sort((a, b) => {
      // Sort: furthest-future due date first → nearest future → due today → 1d overdue → 5d overdue
      // i.e. descending by date: Dec 31 first, most overdue last
      const dA = a.dueDate ? new Date(a.dueDate) : new Date(0);
      const dB = b.dueDate ? new Date(b.dueDate) : new Date(0);
      return dB - dA;
    });
  const visible = allActive.slice(0, 6);
  section.style.display = visible.length > 0 ? '' : 'none';
  container.innerHTML = '';

  visible.forEach(r => {
    const isCall     = r.activityType === 'capital_call';
    const totalAmt   = r.totalAmount;
    const paidCount  = r.paidInvestors;
    const totalLPs   = r.investors;
    const unpaidCnt  = Math.max(0, totalLPs - paidCount);
    // Progress is investor count, the measure the platform models — and the one
    // the "N/M investors paid" line under it already reports.
    const pct        = totalLPs > 0 ? Math.min(100, (paidCount / totalLPs) * 100) : 0;
    const fullFund   = r.fundName;
    const actId      = r.id ?? '';

    const typeLabel = isCall ? 'Capital call' : 'Distribution';
    const title     = isCall
      ? `Capital call for ${fmtShort(totalAmt)}`
      : `Distribution of ${fmtShort(totalAmt)}`;

    let dueText = 'No due date', isOverdue = false, dueSoon = false, dueFar = false;
    if (r.dueDate) {
      const dMs  = new Date(r.dueDate + 'T12:00:00') - new Date();
      const days = Math.ceil(dMs / 86400000);
      isOverdue  = days < 0;
      dueSoon    = !isOverdue && days <= 14;
      dueFar     = !isOverdue && days > 14;
      dueText = days > 0
        ? `Due in ${days} day${days !== 1 ? 's' : ''}`
        : days === 0 ? 'Due today' : `${Math.abs(days)}d overdue`;
    }

    const hasWarn    = unpaidCnt > 0;
    const statusText = isCall
      ? `${paidCount}/${totalLPs} investors paid`
      : (unpaidCnt > 0
          ? `${unpaidCnt} LP${unpaidCnt !== 1 ? 's' : ''} yet to receive`
          : `${paidCount}/${totalLPs} investors paid`);

    const card = document.createElement('div');
    card.className = 'ca-card-v2';
    card.dataset.caId = actId;
    card.innerHTML = `
      <button class="ca-v2-dismiss" title="Dismiss">✕</button>
      <div class="ca-v2-title">${title}</div>
      <div class="ca-v2-fund">${escHtml(fullFund)}</div>
      <div class="ca-v2-progress-track">
        <div class="ca-v2-progress-fill" style="width:${pct.toFixed(1)}%"></div>
      </div>
      <div class="ca-v2-status-row">
        <span class="ca-v2-pct">${pct.toFixed(0)}%</span>
        ${hasWarn ? '<span class="ca-v2-warn-dot"></span>' : ''}
        <span class="ca-v2-status-text">${statusText}</span>
      </div>
      <div class="ca-v2-footer">
        <button class="ca-v2-view-btn">
          View details →
        </button>
        <span class="ca-v2-due-badge${isOverdue ? ' ca-v2-due-overdue' : dueSoon ? ' ca-v2-due-soon' : dueFar ? ' ca-v2-due-far' : ''}">${dueText}</span>
      </div>`;
    // Bound via closures (not inline onclick + string-quoting) so fund/activity
    // names with quotes can't break out of a JS string literal.
    card.querySelector('.ca-v2-dismiss').addEventListener('click', () => dismissCapCard(actId));
    card.querySelector('.ca-v2-view-btn').addEventListener('click', () => openCapActivityDetail(actId, fullFund, typeLabel, r.dueDate, totalAmt, r.fundUuid));
    container.appendChild(card);
  });

  // "View all capital activity" link — shown when there are more than 6 items
  if (allActive.length > 6) {
    const wrap = document.createElement('div');
    wrap.className = 'ca-view-all-wrap';
    wrap.innerHTML = `<a class="ca-view-all-link" href="https://app.carta.com/investors/${_benchmarkFirmId}/fund-admin/capital-activity/" target="_blank">View all capital activity →</a>`;
    container.appendChild(wrap);
  }
}

function dismissCapCard(activityId) {
  trackHome("click", "CartaHome.CapActivity.Dismiss");
  _dismissedCapActivities.add(activityId);
  renderCapActivitySection();
}

// ── Capital activity detail overlay ──
const _capDetailCache = {}; // activityId → fetched rows (in-memory cache)

const CA_ROWS_PAGE_SIZE = 75; // the command's ceiling
const CA_ROWS_MAX_PAGES = 10; // 750 rows; the overlay is not a paging surface

// The transactional tracker, not the warehouse: it is current the moment a
// reminder is sent or a payment lands, and it carries amount_pending /
// amount_received per row so a partial payment splits correctly rather than
// being inferred from payment_status.
async function fetchPartnerRows(fundUuid, activityId, dueDate) {
  if (!fundUuid || !activityId) return { rows: [], failed: true };
  const rows = [];
  let failed = false;
  try {
    for (let page = 1; page <= CA_ROWS_MAX_PAGES; page++) {
      const res = await _mcp("fetch", {
        command: "fa:list:capital-activity-partner",
        params: {
          fund_uuid: fundUuid,
          capital_activity_id: activityId,
          page,
          page_size: CA_ROWS_PAGE_SIZE,
        }
      });
      if (res.isError) {
        console.error('[ca detail] fa:list:capital-activity-partner failed —',
          res.content?.[0]?.text ?? res);
        failed = true;
        break;
      }
      const payload = JSON.parse(res.content?.[0]?.text ?? '{}');
      (payload.results ?? []).forEach(r => rows.push({
        rowId: r.id,
        // The email preview keys off the interest's numeric id, not rowId.
        partnerId: r.partner?.id ?? null,
        partnerName: r.partner?.name || '—',
        amount: parseFloat(r.net_contribution ?? 0),
        amountPending: parseFloat(r.amount_pending ?? 0),
        amountReceived: parseFloat(r.amount_received ?? 0),
        paymentStatus: r.payment_status ?? 'unpaid',
        paidDate: r.paid_date,
        // No `?? false`: canRemind needs unset kept distinct from false.
        emailNoticeEnabled: r.email_notice_enabled,
        partnerInterestGroupUuid: r.partner_interest_group_uuid ?? null,
        partnerInterestGroupName: r.partner_interest_group_name ?? null,
        lastReminded: r.last_reminded_date ?? null,
        daysLate: daysPastDue(dueDate),
        fundUuid,
      }));
      if (!payload.has_next) break;
    }
  } catch (e) {
    failed = true;
    console.error('[ca detail error]', e);
  }
  // The tracker returns the backend's order; the overlay reads paid-first, then
  // largest owed.
  rows.sort((a, b) =>
    a.paymentStatus.localeCompare(b.paymentStatus) || b.amount - a.amount);
  return { rows, failed };
}

// Days past the due date, floored at 0 — the tracker carries no days-late field.
function daysPastDue(dueDate) {
  if (!dueDate) return 0;
  const days = Math.ceil((new Date(dueDate + 'T12:00:00') - new Date()) / 86400000);
  return days < 0 ? Math.abs(days) : 0;
}

// MM/DD/YY — short enough to sit under the action link without wrapping.
function fmtRemindedOn(ts) {
  const dt = new Date(ts);
  if (isNaN(dt)) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getMonth() + 1)}/${p(dt.getDate())}/${String(dt.getFullYear()).slice(-2)}`;
}

// The send silently drops email-disabled rows, so a button there would lie. Only
// an explicit false disqualifies — the backend reads unset as enabled.
function canRemind(r) {
  return r.emailNoticeEnabled !== false;
}

// One entry per interest group, because the send collapses a group's rows into a
// single email — listing rows would double-count a two-interest investor.
function groupUnpaidRows(rows, include) {
  const byKey = new Map();
  (rows ?? []).forEach(r => {
    if (r.paymentStatus !== 'unpaid' || !include(r)) return;
    // Mirrors the backend's own fallback key for a row with no group.
    const key = r.partnerInterestGroupUuid ?? `row_${r.rowId}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.rowIds.push(r.rowId);
      seen.amount += r.amount;
      // The group's chase date is its latest row's.
      if (r.lastReminded && (!seen.lastReminded || r.lastReminded > seen.lastReminded)) {
        seen.lastReminded = r.lastReminded;
      }
      return;
    }
    byKey.set(key, {
      key,
      name: r.partnerInterestGroupName || r.partnerName,
      partnerId: r.partnerId,
      fundUuid: r.fundUuid,
      rowIds: [r.rowId],
      amount: r.amount,
      lastReminded: r.lastReminded,
      daysLate: r.daysLate,
    });
  });
  return Array.from(byKey.values());
}

function remindableGroups(rows) {
  return groupUnpaidRows(rows, canRemind);
}

// Listed but unselectable: an email-disabled investor reads as remindable from the
// detail table, so dropping them from the selection silently confuses.
function blockedRemindGroups(rows) {
  return groupUnpaidRows(rows, r => !canRemind(r));
}

// An already-reminded row offers "Resend" over its last-reminded date, so the
// GP can see which LPs have been chased.
function remindCellInner(r, activityId) {
  if (!canRemind(r)) {
    return `<span class="ca-remind-off"
      title="Email notices are disabled for this investor, so a reminder would not reach them."
      >Email disabled</span>`;
  }
  const remindedOn = r.lastReminded ? fmtRemindedOn(r.lastReminded) : null;
  return `<button class="ca-remind-btn"
      data-row-id="${escHtml(r.rowId)}"
      data-activity-id="${escHtml(activityId)}"
      data-fund-uuid="${escHtml(r.fundUuid)}"
      data-partner-id="${escHtml(r.partnerId ?? '')}"
      data-partner-name="${escHtml(r.partnerName)}"
      data-resend="${remindedOn ? '1' : ''}"
      onclick="openRemindConfirm(this)">${remindedOn ? 'Resend' : 'Send Reminder'}</button>${
    remindedOn ? `<div class="ca-remind-sub">Reminded ${remindedOn}</div>` : ''}`;
}

// The preview needs the interest id, and previews an email a disabled row will
// never get, so both cases lose the menu.
function rowMenuCellInner(r, activityId) {
  if (r.partnerId == null || !canRemind(r)) return '';
  return `<button class="ca-row-menu-btn"
      aria-label="More actions"
      aria-haspopup="true"
      aria-expanded="false"
      data-partner-id="${escHtml(r.partnerId)}"
      data-activity-id="${escHtml(activityId)}"
      data-fund-uuid="${escHtml(r.fundUuid)}"
      data-partner-name="${escHtml(r.partnerName)}"
      onclick="toggleCaRowMenu(this)">&#8943;</button>`;
}

async function openCapActivityDetail(activityId, fundName, typeLabel, dueDate, totalAmt = 0, fundUuid = '') {
  trackHome("click", "CartaHome.CapActivity.ViewDetail");
  // Build or reuse overlay
  let overlay = document.getElementById('ca-detail-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ca-detail-overlay';
    overlay.className = 'ca-detail-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeCapActivityDetail(); });
    document.body.appendChild(overlay);
  }
  const isCall = typeLabel === 'Capital call';

  overlay.innerHTML = `
    <div class="ca-detail-panel">
      <div class="ca-detail-header">
        <div class="ca-detail-title-row">
          <span class="ca-detail-fund">${isCall ? `Capital call for ${fmtFull(totalAmt)}` : `Distribution of ${fmtFull(totalAmt)}`}</span>
        </div>
        <div class="ca-detail-meta">${escHtml(fundName)} &bull; Due ${fmtDDMmmYYYY(dueDate)}</div>
        <button class="ca-detail-close" onclick="closeCapActivityDetail()" aria-label="Close">✕</button>
      </div>
      <div class="ca-detail-body" id="ca-detail-body">
        <div class="loading-row" style="padding:20px 0;">Loading partners…</div>
      </div>
    </div>`;
  overlay.classList.add('ca-detail-visible');

  // Fetch or use cache
  let rows = _capDetailCache[activityId];
  let failed = false;
  if (!rows) {
    // A failed call is not cached: the tracker is the overlay's only source, so
    // holding onto its empty result would keep the table blank all session.
    ({ rows, failed } = await fetchPartnerRows(fundUuid, activityId, dueDate));
    if (!failed) _capDetailCache[activityId] = rows;
  }

  const body = document.getElementById('ca-detail-body');
  if (!body) return;

  if (rows.length === 0) {
    body.innerHTML = failed
      ? '<div class="loading-row" style="padding:16px 0;">Partner rows failed to load. Close and reopen to retry.</div>'
      : '<div class="loading-row" style="padding:16px 0;">No partner rows found.</div>';
    return;
  }

  const totalOwed     = rows.reduce((s, r) => s + r.amount, 0);
  const totalReceived = rows.reduce((s, r) => s + r.amountReceived, 0);
  const totalPending  = rows.reduce((s, r) => s + r.amountPending, 0);

  const statusBadge = (status) => {
    if (status === 'paid')           return `<span class="ca-status ca-status-paid">Paid</span>`;
    if (status === 'partially_paid') return `<span class="ca-status ca-status-partial">Partial</span>`;
    return `<span class="ca-status ca-status-unpaid">Unpaid</span>`;
  };

  body.innerHTML = `
    <div class="ca-detail-summary">
      <div class="ca-detail-stat"><span class="ca-detail-stat-val">${fmtFull(totalOwed)}</span><span class="ca-detail-stat-lbl">Net Amount</span></div>
      <div class="ca-detail-stat"><span class="ca-detail-stat-val ca-unpaid-val">${fmtFull(totalPending)}</span><span class="ca-detail-stat-lbl">Amount Pending</span></div>
      <div class="ca-detail-stat"><span class="ca-detail-stat-val ca-paid-val">${fmtFull(totalReceived)}</span><span class="ca-detail-stat-lbl">Amount Received</span></div>
      ${isCall ? `<span class="ca-notify-slot" id="ca-notify-slot">${bulkRemindCta(activityId, rows)}</span>` : ''}
    </div>
    <div class="ca-detail-table-wrap">
      <table class="ca-detail-table">
        <thead>
          <tr>
            <th class="ca-th-name">Partner</th>
            <th class="ca-th-amount">Amount</th>
            <th class="ca-th-status">Status</th>
            <th class="ca-th-date">Date</th>
            ${isCall ? '<th class="ca-th-remind"></th>' : ''}
            ${isCall ? '<th class="ca-th-actions"></th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            // Paid rows report when; outstanding ones report how late.
            const dateCell = r.daysLate > 0 && r.paymentStatus !== 'paid'
              ? `<span class="ca-late">${r.daysLate}d late</span>`
              : (r.paidDate ? r.paidDate.slice(0, 10) : '—');
            // Remind is only meaningful for capital calls (fa:send:capital-call-reminder)
            // and only for partners who haven't paid yet.
            const remindCell = !isCall ? '' : (r.paymentStatus !== 'unpaid'
              ? '<td class="ca-td-remind"></td>'
              : `<td class="ca-td-remind">${remindCellInner(r, activityId)}</td>`);
            const menuCell = !isCall ? '' : (r.paymentStatus !== 'unpaid'
              ? '<td class="ca-td-actions"></td>'
              : `<td class="ca-td-actions">${rowMenuCellInner(r, activityId)}</td>`);
            return `<tr class="ca-detail-row ca-row-${r.paymentStatus}">
              <td class="ca-td-name">${escHtml(r.partnerName)}</td>
              <td class="ca-td-amount">${fmtFull(r.amount)}</td>
              <td class="ca-td-status">${statusBadge(r.paymentStatus)}</td>
              <td class="ca-td-date">${dateCell}</td>
              ${remindCell}
              ${menuCell}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function closeCapActivityDetail() {
  trackHome("click", "CartaHome.CapActivity.CloseDetail");
  closeCaRowMenu();
  const overlay = document.getElementById('ca-detail-overlay');
  if (overlay) overlay.classList.remove('ca-detail-visible');
}

// ── Remind confirmation dialog ──
let _pendingRemind = null;

// Suppressing the preview is a convenience, so a host without web storage just
// keeps showing it — see readDismissed() in version-check.js for the same shape.
const CA_PREVIEW_SNOOZE_KEY = 'caReminderPreviewSnoozedUntil';

function isPreviewSnoozed() {
  try {
    return parseInt(localStorage.getItem(CA_PREVIEW_SNOOZE_KEY) ?? '0', 10) > Date.now();
  } catch (e) {
    return false;
  }
}

function snoozePreviewForOneDay() {
  try {
    localStorage.setItem(CA_PREVIEW_SNOOZE_KEY, String(Date.now() + 86400000));
  } catch (e) {
    /* best-effort */
  }
}

function ensureRemindOverlay() {
  let overlay = document.getElementById('ca-confirm-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ca-confirm-overlay';
    overlay.className = 'ca-confirm-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeRemindConfirm(); });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function openRemindConfirm(btn) {
  const isResend = btn.dataset.resend === '1';
  _pendingRemind = {
    rowId: btn.dataset.rowId,
    activityId: btn.dataset.activityId,
    fundUuid: btn.dataset.fundUuid,
    partnerId: btn.dataset.partnerId,
    partnerName: btn.dataset.partnerName,
    isResend,
    label: isResend ? 'Resend reminder' : 'Send reminder',
    sourceBtn: btn,
  };
  // The preview is the confirmation, so opting out of it sends on this click.
  if (isPreviewSnoozed()) { submitRemindConfirm(); return; }
  // No interest id means no preview to confirm against, so it takes the short path.
  if (!_pendingRemind.partnerId) renderShortRemindConfirm();
  else renderPreviewRemindConfirm();
}

function renderShortRemindConfirm() {
  const { partnerName, isResend } = _pendingRemind;
  const overlay = ensureRemindOverlay();
  overlay.innerHTML = `
    <div class="ca-confirm-panel">
      <div class="ca-confirm-title">${isResend ? 'Resend reminder' : 'Send reminder'}</div>
      <div class="ca-confirm-text">Send a reminder email to ${escHtml(partnerName)} reminding them of their contribution.</div>
      <div class="ca-confirm-actions">
        <button class="ca-confirm-cancel-btn" onclick="closeRemindConfirm()">Cancel</button>
        <button class="ca-confirm-primary-btn" id="ca-confirm-submit-btn" onclick="submitRemindConfirm()">${isResend ? 'Resend reminder' : 'Send reminder'}</button>
      </div>
    </div>`;
  overlay.classList.add('ca-confirm-visible');
}

async function renderPreviewRemindConfirm() {
  const { activityId, fundUuid, partnerId, partnerName, label } = _pendingRemind;
  const overlay = ensureRemindOverlay();
  overlay.innerHTML = `
    <div class="ca-preview-panel">
      <div class="ca-preview-header">
        <span class="ca-preview-title">Investor reminder email</span>
        <button class="ca-preview-close" onclick="closeRemindConfirm()" aria-label="Close">✕</button>
      </div>
      <div class="ca-preview-body" id="ca-remind-preview-body">
        <div class="loading-row" style="padding:20px 0;">Loading preview for ${escHtml(partnerName)}…</div>
      </div>
      <div class="ca-preview-footer ca-preview-footer-confirm">
        <label class="ca-snooze-label">
          <input type="checkbox" id="ca-snooze-preview"> Do not show preview for one day
        </label>
        <div class="ca-preview-footer-actions">
          <button class="ca-preview-close-btn" onclick="closeRemindConfirm()">Cancel</button>
          <button class="ca-confirm-primary-btn" id="ca-confirm-submit-btn" onclick="submitRemindConfirm()">${label}</button>
        </div>
      </div>
    </div>`;
  overlay.classList.add('ca-confirm-visible');

  const key = `${activityId}:${partnerId}`;
  let view = _emailPreviewCache[key];
  let error = null;
  if (!view) {
    try {
      view = await fetchEmailPreview(fundUuid, activityId, partnerId);
      _emailPreviewCache[key] = view;
    } catch (e) {
      console.error('[remind preview error]', e);
      error = e;
    }
  }
  const body = document.getElementById('ca-remind-preview-body');
  // Dismissed, or a different row was opened, while the preview was in flight.
  if (!body || _pendingRemind?.partnerId !== partnerId) return;

  // A preview that failed to load still leaves a working confirmation — the send
  // does not depend on it.
  if (error) {
    body.innerHTML = '<div class="loading-row" style="padding:16px 0;">Preview failed to load. You can still send the reminder.</div>';
    return;
  }
  renderEmailPreview(body, view);
}

// Both flows share the overlay, so a backdrop click has to clear either one.
function closeRemindConfirm() {
  const overlay = document.getElementById('ca-confirm-overlay');
  if (overlay) overlay.classList.remove('ca-confirm-visible');
  _pendingRemind = null;
  _pendingBulk = null;
}

async function submitRemindConfirm() {
  if (!_pendingRemind) return;
  const { rowId, activityId, fundUuid, partnerName, sourceBtn } = _pendingRemind;
  // A snoozed send skips the confirm step, so the row's own button looks busy.
  const btn = document.getElementById('ca-confirm-submit-btn') ?? sourceBtn;
  const label = btn ? btn.textContent : '';
  // Applied on send, not on cancel: cancelling means "never mind", and silently
  // changing a preference from it would surprise.
  if (document.getElementById('ca-snooze-preview')?.checked) snoozePreviewForOneDay();
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  clearSendError();

  try {
    // Colons become `__` in the generated tool name; the hyphens stay.
    const res = await _mcp("call_tool", {
      name: "fa__send__capital-call-reminder",
      arguments: {
        fund_uuid: fundUuid,
        capital_activity_id: activityId,
        row_ids: [rowId]
      }
    });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? 'Unknown error');
    // Stamp the cache, not just the DOM: the overlay reopens off the cache.
    const row = _capDetailCache[activityId].find(r => r.rowId === rowId);
    row.lastReminded = new Date().toISOString();
    sourceBtn.closest('.ca-td-remind').innerHTML = remindCellInner(row, activityId);
    renderSentConfirm([partnerName]);
    _pendingRemind = null;
  } catch (e) {
    console.error('[remind error]', e);
    showSendError('Failed to send reminder — please try again.');
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

// ── Bulk remind ──
let _pendingBulk = null;

// A day, matching the preview snooze; row-level Resend covers anyone missed.
const CA_BULK_SENT_KEY = 'caBulkRemindedAt';
const CA_BULK_SENT_MS = 86400000;

function readBulkSent() {
  try {
    return JSON.parse(localStorage.getItem(CA_BULK_SENT_KEY) ?? '{}');
  } catch (e) {
    return {};
  }
}

function bulkRemindedRecently(activityId) {
  return Date.now() - (readBulkSent()[activityId] ?? 0) < CA_BULK_SENT_MS;
}

function stampBulkSent(activityId) {
  const now = Date.now();
  // Pruned on write, or the map keeps every activity the firm ever chased.
  const kept = Object.fromEntries(
    Object.entries(readBulkSent()).filter(([, ts]) => now - ts < CA_BULK_SENT_MS));
  kept[activityId] = now;
  try {
    localStorage.setItem(CA_BULK_SENT_KEY, JSON.stringify(kept));
  } catch (e) {
    /* best-effort */
  }
}

function bulkRemindCta(activityId, rows) {
  if (!remindableGroups(rows).length) return '';
  if (bulkRemindedRecently(activityId)) {
    return '<span class="ca-notify-sent">Sent just now</span>';
  }
  return `<button class="ca-notify-btn" data-activity-id="${escHtml(activityId)}"
      onclick="openBulkNotify(this)">Remind investors</button>`;
}

function openBulkNotify(btn) {
  trackHome("click", "CartaHome.CapActivity.BulkNotify");
  const activityId = btn.dataset.activityId;
  const rows = _capDetailCache[activityId];
  const groups = remindableGroups(rows);
  if (!groups.length) return;
  _pendingBulk = {
    activityId,
    groups,
    blocked: blockedRemindGroups(rows),
    selected: new Set(groups.map(g => g.key)),
    previewKey: null,
  };
  renderBulkSelect();
}

function selectedBulkGroups() {
  return _pendingBulk.groups.filter(g => _pendingBulk.selected.has(g.key));
}

// The detail table's columns, so names line up with what the GP just read.
function bulkSelectRow(g, cells) {
  return `
    <tr class="ca-detail-row ca-row-unpaid">
      <td class="ca-td-check">${cells}</td>
      <td class="ca-td-name" title="${escHtml(g.name)}">${escHtml(g.name)}${
        g.blocked ? '<div class="ca-remind-sub">Email disabled</div>' : ''}</td>
      <td class="ca-td-amount">${fmtFull(g.amount)}</td>
      <td class="ca-td-status"><span class="ca-status ca-status-unpaid">Unpaid</span></td>
      <td class="ca-td-date">${g.daysLate > 0 ? `<span class="ca-late">${g.daysLate}d late</span>` : '—'}</td>
      <td class="ca-td-reminded">${g.lastReminded ? (fmtRemindedOn(g.lastReminded) ?? '—') : '—'}</td>
    </tr>`;
}

function renderBulkSelect() {
  const { groups, blocked, selected } = _pendingBulk;
  const overlay = ensureRemindOverlay();
  overlay.innerHTML = `
    <div class="ca-preview-panel">
      <div class="ca-preview-header">
        <span class="ca-preview-title">Remind investors</span>
        <button class="ca-preview-close" onclick="closeRemindConfirm()" aria-label="Close">✕</button>
      </div>
      <div class="ca-preview-body">
        <div class="ca-preview-note">Select the partners you want to send a reminder email to.</div>
        <div class="ca-detail-table-wrap">
          <table class="ca-detail-table">
            <thead>
              <tr>
                <th class="ca-th-check">
                  <input type="checkbox" id="ca-bulk-all"
                    onchange="toggleBulkSelectAll(this)" aria-label="Select all partners">
                </th>
                <th class="ca-th-name">Partner</th>
                <th class="ca-th-amount">Amount</th>
                <th class="ca-th-status">Status</th>
                <th class="ca-th-date">Date</th>
                <th class="ca-th-reminded">Last reminded</th>
              </tr>
            </thead>
            <tbody>
              ${groups.map(g => bulkSelectRow(g,
                `<input type="checkbox" class="ca-bulk-check" ${selected.has(g.key) ? 'checked' : ''}
                   data-key="${escHtml(g.key)}" onchange="toggleBulkSelect(this)"
                   aria-label="Remind ${escHtml(g.name)}">`)).join('')}
              ${blocked.map(g => bulkSelectRow({ ...g, blocked: true }, '')).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="ca-preview-footer ca-preview-footer-confirm">
        <span class="ca-bulk-count" id="ca-bulk-count"></span>
        <div class="ca-preview-footer-actions">
          <button class="ca-preview-close-btn" onclick="closeRemindConfirm()">Cancel</button>
          <button class="ca-confirm-primary-btn" id="ca-bulk-continue" onclick="bulkNotifyContinue()">Continue</button>
        </div>
      </div>
    </div>`;
  overlay.classList.add('ca-confirm-visible');
  syncBulkFooter();
}

function toggleBulkSelect(input) {
  if (input.checked) _pendingBulk.selected.add(input.dataset.key);
  else _pendingBulk.selected.delete(input.dataset.key);
  syncBulkFooter();
}

function toggleBulkSelectAll(input) {
  const { groups, selected } = _pendingBulk;
  selected.clear();
  if (input.checked) groups.forEach(g => selected.add(g.key));
  document.querySelectorAll('.ca-bulk-check').forEach(cb => { cb.checked = input.checked; });
  syncBulkFooter();
}

function syncBulkFooter() {
  const n = _pendingBulk.selected.size;
  const total = _pendingBulk.groups.length;
  const count = document.getElementById('ca-bulk-count');
  if (count) count.textContent = `${n} of ${total} selected`;
  const all = document.getElementById('ca-bulk-all');
  if (all) {
    all.checked = n === total;
    all.indeterminate = n > 0 && n < total;
  }
  const cont = document.getElementById('ca-bulk-continue');
  if (cont) {
    // Snoozing removes the step this button leads to, so it stops promising one.
    cont.textContent = isPreviewSnoozed() ? bulkSendLabel(n) : 'Continue';
    cont.disabled = n === 0;
  }
}

function bulkNotifyContinue() {
  if (!_pendingBulk?.selected.size) return;
  // The preview is the confirmation, so opting out of it sends on this click.
  if (isPreviewSnoozed()) { submitBulkRemind(); return; }
  // No interest id means no preview to confirm against, so it takes the short path.
  if (!selectedBulkGroups().some(g => g.partnerId != null)) renderBulkShortConfirm();
  else renderBulkPreviewConfirm();
}

function renderBulkShortConfirm() {
  const n = selectedBulkGroups().length;
  const overlay = ensureRemindOverlay();
  overlay.innerHTML = `
    <div class="ca-confirm-panel">
      <div class="ca-confirm-title">Send reminder${n === 1 ? '' : 's'}</div>
      <div class="ca-confirm-text">Send a reminder email to ${n === 1 ? 'this partner' : `these ${n} partners`} reminding them of their contribution.</div>
      <div class="ca-confirm-actions">
        <button class="ca-confirm-cancel-btn" onclick="renderBulkSelect()">Back</button>
        <button class="ca-confirm-primary-btn" id="ca-bulk-submit-btn" onclick="submitBulkRemind()">${bulkSendLabel(n)}</button>
      </div>
    </div>`;
  overlay.classList.add('ca-confirm-visible');
}

function bulkSendLabel(n) {
  return n === 1 ? 'Send reminder' : `Send ${n} reminders`;
}

// Every selected investor's own email is reachable from the picker: a batch the GP
// cannot read is a batch they cannot check.
function renderBulkPreviewConfirm() {
  const sel = selectedBulkGroups();
  const previewable = sel.filter(g => g.partnerId != null);
  _pendingBulk.previewKey = previewable.some(g => g.key === _pendingBulk.previewKey)
    ? _pendingBulk.previewKey
    : previewable[0].key;
  const overlay = ensureRemindOverlay();
  overlay.innerHTML = `
    <div class="ca-preview-panel">
      <div class="ca-preview-header">
        <span class="ca-preview-title">Investor reminder email</span>
        <button class="ca-preview-close" onclick="closeRemindConfirm()" aria-label="Close">✕</button>
      </div>
      <div class="ca-preview-body">
        ${previewable.length > 1 ? `
          <div class="ca-preview-picker-row">
            <label for="ca-bulk-preview-pick">Previewing</label>
            <select class="ca-preview-picker" id="ca-bulk-preview-pick"
              onchange="switchBulkPreview(this.value)">
              ${previewable.map(g => `
                <option value="${escHtml(g.key)}" ${g.key === _pendingBulk.previewKey ? 'selected' : ''}
                  >${escHtml(g.name)}</option>`).join('')}
            </select>
            <span class="ca-preview-note" id="ca-bulk-preview-pos"></span>
          </div>` : ''}
        <div class="ca-preview-slot" id="ca-bulk-preview-body"></div>
      </div>
      <div class="ca-preview-footer ca-preview-footer-confirm">
        <label class="ca-snooze-label">
          <input type="checkbox" id="ca-snooze-preview"> Do not show preview for one day
        </label>
        <div class="ca-preview-footer-actions">
          <button class="ca-preview-close-btn" onclick="renderBulkSelect()">Back</button>
          <button class="ca-confirm-primary-btn" id="ca-bulk-submit-btn" onclick="submitBulkRemind()">${bulkSendLabel(sel.length)}</button>
        </div>
      </div>
    </div>`;
  overlay.classList.add('ca-confirm-visible');
  renderBulkPreviewFor(_pendingBulk.previewKey);
}

function switchBulkPreview(key) {
  if (!_pendingBulk) return;
  _pendingBulk.previewKey = key;
  renderBulkPreviewFor(key);
}

async function renderBulkPreviewFor(key) {
  const { activityId } = _pendingBulk;
  const g = _pendingBulk.groups.find(x => x.key === key);
  const slot = document.getElementById('ca-bulk-preview-body');
  if (!g || !slot) return;
  const pos = document.getElementById('ca-bulk-preview-pos');
  if (pos) {
    const previewable = selectedBulkGroups().filter(x => x.partnerId != null);
    pos.textContent = `${previewable.findIndex(x => x.key === key) + 1} of ${previewable.length}`;
  }
  slot.innerHTML = `<div class="loading-row" style="padding:20px 0;">Loading preview for ${escHtml(g.name)}…</div>`;

  const cacheKey = `${activityId}:${g.partnerId}`;
  let view = _emailPreviewCache[cacheKey];
  let error = null;
  if (!view) {
    try {
      view = await fetchEmailPreview(g.fundUuid, activityId, g.partnerId);
      _emailPreviewCache[cacheKey] = view;
    } catch (e) {
      console.error('[bulk remind preview error]', e);
      error = e;
    }
  }
  // Dismissed, or another investor was picked, while the preview was in flight.
  if (_pendingBulk?.previewKey !== key) return;
  const body = document.getElementById('ca-bulk-preview-body');
  if (!body) return;

  // A preview that failed to load still leaves a working send.
  if (error) {
    body.innerHTML = '<div class="loading-row" style="padding:16px 0;">Preview failed to load. You can still send the reminders.</div>';
    return;
  }
  renderEmailPreview(body, view);
}

async function submitBulkRemind() {
  if (!_pendingBulk?.selected.size) return;
  const { activityId } = _pendingBulk;
  const sel = selectedBulkGroups();
  const rowIds = sel.flatMap(g => g.rowIds);
  // A snoozed send skips the confirm step, so the selection footer looks busy.
  const btn = document.getElementById('ca-bulk-submit-btn')
    ?? document.getElementById('ca-bulk-continue');
  const label = btn ? btn.textContent : '';
  if (document.getElementById('ca-snooze-preview')?.checked) snoozePreviewForOneDay();
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  clearSendError();

  try {
    // force_send is not on this tool, so a non-staff caller's batch becomes a
    // staff review request rather than an immediate send.
    const res = await _mcp("call_tool", {
      name: "fa__send__capital-call-reminder",
      arguments: {
        fund_uuid: sel[0].fundUuid,
        capital_activity_id: activityId,
        row_ids: rowIds
      }
    });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? 'Unknown error');
    // Runs behind the sent pane, so Close lands on a summary already reading
    // "Sent just now".
    stampRemindedRows(activityId, rowIds);
    stampBulkSent(activityId);
    const slot = document.getElementById('ca-notify-slot');
    if (slot) slot.innerHTML = bulkRemindCta(activityId, _capDetailCache[activityId] ?? []);
    renderSentConfirm(sel.map(g => g.name));
    _pendingBulk = null;
  } catch (e) {
    console.error('[bulk remind error]', e);
    showSendError('Failed to send reminders — please try again.');
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

// A send closes its modal over the table, so the only proof it fired was a toast
// that fades. This waits to be dismissed instead.
function renderSentConfirm(names) {
  const n = names.length;
  const overlay = ensureRemindOverlay();
  overlay.innerHTML = `
    <div class="ca-confirm-panel ca-confirm-panel-sent">
      <div class="ca-confirm-mark" aria-hidden="true">✓</div>
      <div class="ca-confirm-title">Reminder${n === 1 ? '' : 's'} sent</div>
      <div class="ca-confirm-text">${n === 1
        ? `${escHtml(names[0])} has been sent a reminder email.`
        : `${n} investors have been sent a reminder email.`}</div>
      <div class="ca-confirm-actions ca-confirm-actions-center">
        <button class="ca-confirm-primary-btn" id="ca-sent-close"
          onclick="closeRemindConfirm()">Close</button>
      </div>
    </div>`;
  overlay.classList.add('ca-confirm-visible');
  document.getElementById('ca-sent-close').focus();
}

// A failed send keeps the panel and its retry button, so the reason belongs there.
// Falls back to the toast on the snoozed path, which opens no panel.
function showSendError(msg) {
  // Closing leaves the last panel in the DOM, so a hidden overlay still matches —
  // an error written into it would be invisible.
  const overlay = document.getElementById('ca-confirm-overlay');
  const panel = overlay?.classList.contains('ca-confirm-visible')
    ? overlay.querySelector('.ca-preview-panel, .ca-confirm-panel')
    : null;
  if (!panel) { showToast(msg); return; }
  let el = panel.querySelector('.ca-send-error');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ca-send-error';
    el.setAttribute('role', 'alert');
    panel.insertBefore(el, panel.querySelector('.ca-preview-footer, .ca-confirm-actions'));
  }
  el.textContent = msg;
}

function clearSendError() {
  document.querySelector('#ca-confirm-overlay .ca-send-error')?.remove();
}

// Stamps the cache, not just the DOM: the overlay reopens off the cache.
function stampRemindedRows(activityId, rowIds) {
  const now = new Date().toISOString();
  const ids = new Set(rowIds);
  (_capDetailCache[activityId] ?? []).forEach(r => {
    if (!ids.has(r.rowId)) return;
    r.lastReminded = now;
    const cell = document
      .querySelector(`.ca-remind-btn[data-row-id="${CSS.escape(r.rowId)}"]`)
      ?.closest('.ca-td-remind');
    if (cell) cell.innerHTML = remindCellInner(r, activityId);
  });
}

// ── Row overflow menu ──
// The menu lives on <body>, not in the cell: the table wrap's `overflow-x`
// clips an in-cell menu on the last rows.
let _caRowMenu = null;

function ensureCaRowMenu() {
  if (!_caRowMenu) {
    _caRowMenu = document.createElement('div');
    _caRowMenu.id = 'ca-row-menu';
    _caRowMenu.className = 'ca-row-menu';
    _caRowMenu.setAttribute('role', 'menu');
    _caRowMenu.innerHTML =
      `<button class="ca-row-menu-item" role="menuitem" onclick="previewEmailFromMenu()">Preview email</button>`;
    document.body.appendChild(_caRowMenu);
  }
  return _caRowMenu;
}

function toggleCaRowMenu(btn) {
  const menu = ensureCaRowMenu();
  const isOpenForThisRow = menu.classList.contains('ca-row-menu-open') && menu._sourceBtn === btn;
  closeCaRowMenu();
  if (isOpenForThisRow) return;

  menu._sourceBtn = btn;
  menu.classList.add('ca-row-menu-open');
  btn.setAttribute('aria-expanded', 'true');

  // Measured after the class lands, so offsetWidth is the shown width.
  const rect = btn.getBoundingClientRect();
  menu.style.top  = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - menu.offsetWidth)}px`;

  // Fixed positioning detaches from the row once the table scrolls under it.
  document.getElementById('ca-detail-body')
    ?.addEventListener('scroll', closeCaRowMenu, { once: true });
}

function closeCaRowMenu() {
  if (!_caRowMenu) return;
  _caRowMenu.classList.remove('ca-row-menu-open');
  _caRowMenu._sourceBtn?.setAttribute('aria-expanded', 'false');
  _caRowMenu._sourceBtn = null;
}

document.addEventListener('click', (e) => {
  if (!_caRowMenu?.classList.contains('ca-row-menu-open')) return;
  if (_caRowMenu.contains(e.target) || e.target.closest('.ca-row-menu-btn')) return;
  closeCaRowMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (_caRowMenu?.classList.contains('ca-row-menu-open')) { closeCaRowMenu(); return; }
  if (document.getElementById('ca-preview-overlay')?.classList.contains('ca-preview-visible')) {
    closeEmailPreview();
  }
});

function previewEmailFromMenu() {
  const btn = _caRowMenu?._sourceBtn;
  if (!btn) return;
  const { partnerId, activityId, fundUuid, partnerName } = btn.dataset;
  closeCaRowMenu();
  openEmailPreview(fundUuid, activityId, partnerId, partnerName);
}

// ── Email preview modal ──
const _emailPreviewCache = {}; // `${activityId}:${partnerId}` → rendered preview
let _previewRequestId = 0;     // discards a response whose modal has moved on

// is_reminder renders the chase email that Resend would send, not the release
// notice. The backend renders reminders for capital calls only.
async function fetchEmailPreview(fundUuid, activityId, partnerId) {
  const res = await _mcp("fetch", {
    command: "fa:get:capital-activity-partner-email-preview",
    params: {
      fund_uuid: fundUuid,
      capital_activity_id: activityId,
      partner_id: parseInt(partnerId, 10),
      is_reminder: true,
      body_format: "html",
    }
  });
  if (res.isError) throw new Error(res.content?.[0]?.text ?? 'Unknown error');
  return JSON.parse(res.content?.[0]?.text ?? '{}');
}

async function openEmailPreview(fundUuid, activityId, partnerId, partnerName) {
  trackHome("click", "CartaHome.CapActivity.PreviewEmail");
  let overlay = document.getElementById('ca-preview-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ca-preview-overlay';
    overlay.className = 'ca-preview-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeEmailPreview(); });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="ca-preview-panel">
      <div class="ca-preview-header">
        <span class="ca-preview-title">Preview email</span>
        <button class="ca-preview-close" onclick="closeEmailPreview()" aria-label="Close">✕</button>
      </div>
      <div class="ca-preview-body" id="ca-preview-body">
        <div class="loading-row" style="padding:20px 0;">Loading preview for ${escHtml(partnerName)}…</div>
      </div>
      <div class="ca-preview-footer">
        <button class="ca-preview-close-btn" onclick="closeEmailPreview()">Close</button>
      </div>
    </div>`;
  overlay.classList.add('ca-preview-visible');

  const reqId = ++_previewRequestId;
  const key = `${activityId}:${partnerId}`;
  let view = _emailPreviewCache[key];
  let error = null;
  if (!view) {
    try {
      view = await fetchEmailPreview(fundUuid, activityId, partnerId);
      _emailPreviewCache[key] = view;
    } catch (e) {
      console.error('[email preview error]', e);
      error = e;
    }
  }
  // Closed, or a second row's preview was opened, while this one was in flight.
  if (reqId !== _previewRequestId) return;
  const body = document.getElementById('ca-preview-body');
  if (!body) return;

  if (error) {
    body.innerHTML = '<div class="loading-row" style="padding:16px 0;">Preview failed to load. Close and try again.</div>';
    return;
  }
  renderEmailPreview(body, view);
}

function renderEmailPreview(body, view) {
  const recipients = view.recipients ?? [];
  const label = (d) => d.name ? `${d.name} <${d.email}>` : d.email;
  const line = (heading, list) => list.length === 0 ? '' :
    `<div class="ca-preview-field"><span class="ca-preview-field-lbl">${heading}</span>${escHtml(list.map(label).join(', '))}</div>`;

  // The body is the email's own HTML document. A scriptless iframe shows it as
  // the LP receives it and keeps it out of the artifact's DOM and styles.
  body.innerHTML = `
    <div class="ca-preview-envelope">
      ${line('To:', recipients.filter(d => d.addr_type === 'TO'))}
      ${line('Cc:', recipients.filter(d => d.addr_type === 'CC'))}
      <div class="ca-preview-field"><span class="ca-preview-field-lbl">Subject:</span>${escHtml(view.subject ?? '')}</div>
    </div>
    <iframe class="ca-preview-frame" sandbox="" title="Email preview" srcdoc="${escHtml(view.body ?? '')}"></iframe>
    ${(view.body ?? '').includes('[/LINK_CARTA]')
      ? '<div class="ca-preview-note">The [/LINK_CARTA] placeholder is a preview artifact — the sent email carries a real link.</div>'
      : ''}`;
}

function closeEmailPreview() {
  _previewRequestId++;
  const overlay = document.getElementById('ca-preview-overlay');
  if (overlay) overlay.classList.remove('ca-preview-visible');
}
