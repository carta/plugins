// ── Capital activity: pinned card + detail overlay ──
// Depends on core.js (carta-home.app.js): _mcp(), fmtShort(), fmtFull(),
// fmtDDMmmYYYY(), escHtml(), showToast(), trackHome(), and the shared _benchmarkFirmId.
let _capActivityData = null; // null = not fetched (or the fetch failed); [] = none active; [...rows] = active

// ── Capital activity: fetch active capital calls + distributions ──
// The transactional endpoint rather than the warehouse, so the cards agree with
// the detail overlay. Firm-scoped from the session context set during boot.
async function fetchCapitalActivity() {
  try {
    const res = await _mcp("read_tool", { name: "fa__list__active-capital-activity", arguments: {} });
    if (res.isError) {
      console.error('[capactivity] fa:list:active-capital-activity failed —',
        res.content?.[0]?.text ?? res);
      _capActivityData = null;
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
    _capActivityData = null;
  }
  renderCapActivitySection();
  loadDistributionProgress();
}

// Whether any capital activity pop-up (details, reminder confirmation, email preview) is open.
function caPopupOpen() {
  return !!document.querySelector('.ca-detail-visible, .ca-confirm-visible, .ca-preview-visible');
}

// Whether Carta answered with no pending capital activity. The viewer's dismissals don't count,
// and a distribution whose progress hasn't loaded yet counts as open.
function caNoneOpen() {
  return Array.isArray(_capActivityData) && _capActivityData.every(isPaidOutDistribution);
}

// Replaces a visible distribution card's backend counts with ones read from its
// tracker rows (see distributionProgress), and caches the rows for the overlay.
// Capital calls keep the backend counts, which already agree with their overlay.
// A failed walk leaves the card on the backend counts rather than blanking it.
// Repeats while it runs, because a paid-out distribution leaves the visible set
// and lets an unloaded one in behind it.
async function loadDistributionProgress() {
  for (;;) {
    const pending = visibleCapActivities().visible
      .filter(r => r.activityType === 'distribution' && !r.progressLoaded);
    if (pending.length === 0) return;
    await Promise.all(pending.map(async r => {
      const { rows, failed } = await partnerRowsFor(r.fundUuid, r.id, r.dueDate, false);
      if (!failed) r.progress = distributionProgress(rows);
      r.progressLoaded = true;
    }));
    renderCapActivitySection();
  }
}

// The backend lists a distribution until every row is reconciled, so one whose
// LPs have all been paid can still arrive here; Carta Home shows only pending
// activity, so it is left out.
function isPaidOutDistribution(activity) {
  const p = activity.progress;
  return activity.activityType === 'distribution' && p != null
    && p.total > 0 && p.paid === p.total;
}

// ── Render the Capital activity section above Starred ──
const _dismissedCapActivities = new Set();

function visibleCapActivities() {
  const allActive = (_capActivityData ?? [])
    .filter(r => !_dismissedCapActivities.has(r.id) && !isPaidOutDistribution(r))
    .sort((a, b) => {
      // Sort: furthest-future due date first → nearest future → due today → 1d overdue → 5d overdue
      // i.e. descending by date: Dec 31 first, most overdue last
      const dA = a.dueDate ? new Date(a.dueDate) : new Date(0);
      const dB = b.dueDate ? new Date(b.dueDate) : new Date(0);
      return dB - dA;
    });
  return { allActive, visible: allActive.slice(0, 6) };
}

function renderCapActivitySection() {
  const section   = document.getElementById('ca-section-v2');
  const container = document.getElementById('ca-section-cards');
  if (!section || !container) return;

  const { visible } = visibleCapActivities();
  if (visible.length === 0) {
    // A section the viewer emptied by dismissing folds away with its last card still
    // in it; one that never had a card stays hidden. Inert keeps the folded cards out of
    // the tab order and the accessibility tree.
    if (section.style.display !== 'none') {
      section.classList.add('ca-section--collapsed');
      section.inert = true;
    }
    return;
  }
  section.style.display = '';
  section.classList.remove('ca-section--collapsed');
  section.inert = false;
  container.innerHTML = '';

  visible.forEach(r => {
    const isCall     = r.activityType === 'capital_call';
    const totalAmt   = r.totalAmount;
    const paidCount  = r.progress ? r.progress.paid : r.paidInvestors;
    const totalLPs   = r.progress ? r.progress.total : r.investors;
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
      <button class="ca-v2-dismiss" title="Dismiss" aria-label="Dismiss">✕</button>
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

  renderCapActivityViewAll(container);
}

// "View all capital activity" — shown when there are more items than cards. Carta has
// no firm-wide capital activity list; the Firm Dashboard's Spotlight shows every fund's
// active calls and distributions. Its URL takes the firm's numeric id, so the link waits
// for that id, is left out when it is unknown, and re-checks the count because cards
// can be dismissed while it waits.
function renderCapActivityViewAll(container) {
  return fetchFirmCartaId().then(firmCartaId => {
    const { allActive, visible } = visibleCapActivities();
    if (firmCartaId == null || allActive.length <= visible.length) return;
    if (container.querySelector('.ca-view-all-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'ca-view-all-wrap';
    wrap.innerHTML = `<a class="ca-view-all-link" href="https://app.carta.com/investors/firm/${firmCartaId}/portfolio/gp-activity/" target="_blank" rel="noopener">View all capital activity →</a>`;
    container.appendChild(wrap);
  });
}

function dismissCapCard(activityId) {
  trackHome("click", "CartaHome.CapActivity.Dismiss");
  _dismissedCapActivities.add(activityId);
  renderCapActivitySection();
  loadDistributionProgress();
}

// ── Capital activity detail overlay ──
const _capDetailCache = {}; // activityId → fetched rows (in-memory cache)

// The walk sends no page_size, so carta-mcp serves its default page, which it sizes
// to fit its 40k response budget. A built artifact is frozen, while the command's
// page_size maximum moves with that budget: any size named here is rejected on
// page 1, for every activity, the day the maximum drops below it.
// The overlay is not a paging surface, so the walk stops at this many rows.
const CA_ROWS_MAX = 1000;

// An activity's partner rows, shared by its card and its overlay. A failed walk
// is not cached: the tracker is the overlay's only source, so holding onto its
// empty result would keep the table blank all session.
async function partnerRowsFor(fundUuid, activityId, dueDate, isCall) {
  const cached = _capDetailCache[activityId];
  if (cached) return { rows: cached, failed: false };
  const res = await fetchPartnerRows(fundUuid, activityId, dueDate, isCall);
  if (!res.failed) _capDetailCache[activityId] = res.rows;
  return res;
}

// The transactional tracker, not the warehouse: it is current the moment a
// reminder is sent or a payment lands, and it carries amount_pending /
// amount_received per row so a partial payment splits correctly rather than
// being inferred from payment_status.
//
// A row carries both sides of the activity. On a distribution the call-side
// amounts read zero and `payment_status` is the row's reconciliation flag, not
// whether the LP was paid: the payout lives in `net_distribution_amount` and
// `distribution_payment_status`.
async function fetchPartnerRows(fundUuid, activityId, dueDate, isCall) {
  if (!fundUuid || !activityId) return { rows: [], failed: true };
  const rows = [];
  let failed = false;
  try {
    for (let page = 1; rows.length < CA_ROWS_MAX; page++) {
      const res = await _mcp("read_tool", {
        name: "fa__list__capital-activity-partner",
        arguments: {
          fund_uuid: fundUuid,
          capital_activity_id: activityId,
          page,
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
        ...trackerRowPayment(r, isCall),
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

// Each payout state's pill: its label, the tone (`.ca-status-<tone>`) that
// colours it, and a tooltip where the label needs explaining. Labels follow the
// Carta web app's payment summary, except that only a reconciled payout reads
// "Settled" — one still awaiting reconciliation is money moving, like the
// in-progress states. `paid` marks the states where the money has left; every
// other state (ON_HOLD, PENDING_AUTHORIZATION, FAILED…) is still owed to the LP.
const CA_PAYOUT_STATUSES = {
  ON_HOLD:                      { label: 'On hold',                      tone: 'neutral' },
  BLOCKED:                      { label: 'Rolled over',                  tone: 'neutral' },
  PENDING_AUTHORIZATION:        { label: 'Pending authorization',        tone: 'pending' },
  PENDING_REAUTHORIZATION:      { label: 'Pending reauthorization',      tone: 'pending' },
  PENDING_BANK_PORTAL_APPROVAL: { label: 'Pending bank portal approval', tone: 'pending' },
  WIRE_SETUP_IN_PROGRESS:       { label: 'Wire setup in progress',       tone: 'progress' },
  IN_PROGRESS:                  { label: 'Payment in progress',          tone: 'progress' },
  // Sent but not yet matched to the bank; the backend's own investor count
  // still reports this LP as unpaid.
  PAID_PENDING_RECON:           { label: 'Paid · not reconciled',        tone: 'progress', paid: true,
    title: 'The payout went out, but the row has not been reconciled yet.' },
  PAID:                         { label: 'Settled',                      tone: 'settled',  paid: true },
  FAILED:                       { label: 'Failed',                       tone: 'failed' },
};

// A capital call's pill, coloured on the same scale as a payout's.
const CA_CALL_STATUSES = {
  paid:           { label: 'Paid',           tone: 'settled' },
  partially_paid: { label: 'Partially paid', tone: 'pending' },
  unpaid:         { label: 'Unpaid',         tone: 'neutral' },
};

// The overlay's amount and payment fields, read from whichever side of the
// tracker row the activity type fills in. A distribution has no partial payment,
// so its row is wholly received or wholly pending. `status` is the row's pill,
// which for a distribution keeps the payout state ("Pending authorization")
// that `paymentStatus` collapses.
function trackerRowPayment(r, isCall) {
  if (isCall) {
    const paymentStatus = r.payment_status ?? 'unpaid';
    return {
      amount: parseFloat(r.net_contribution ?? 0),
      amountPending: parseFloat(r.amount_pending ?? 0),
      amountReceived: parseFloat(r.amount_received ?? 0),
      paymentStatus,
      status: CA_CALL_STATUSES[paymentStatus] ?? CA_CALL_STATUSES.unpaid,
    };
  }
  const amount = parseFloat(r.net_distribution_amount ?? 0);
  const payout = r.distribution_payment_status ?? '';
  const status = payoutStatus(payout);
  const paid = status.paid === true;
  return {
    amount,
    amountPending: paid ? 0 : amount,
    amountReceived: paid ? amount : 0,
    paymentStatus: paid ? 'paid' : 'unpaid',
    status,
  };
}

// A payout state the table does not know yet still shows, worded from its
// enum value, in the neutral tone; a row with no payout state reads Unpaid.
function payoutStatus(payout) {
  if (CA_PAYOUT_STATUSES[payout]) return CA_PAYOUT_STATUSES[payout];
  if (!payout) return CA_CALL_STATUSES.unpaid;
  const words = payout.toLowerCase().replace(/_/g, ' ');
  return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: 'neutral' };
}

// A distribution card's progress, counted from the same tracker rows the overlay
// lists so the two agree. `completed_investors_count` cannot be used: it counts
// reconciled rows, so an LP whose payout landed but was never reconciled reads
// as "yet to receive". Null when the rows cannot vouch for the total — none came
// back, or the walk reached the cap and an unpaid LP past it would vanish — so
// the card keeps the backend counts.
function distributionProgress(rows) {
  if (rows.length === 0 || rows.length >= CA_ROWS_MAX) return null;
  return {
    total: rows.length,
    paid: rows.filter(r => r.paymentStatus === 'paid').length,
  };
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
// single email — listing rows would double-count a two-interest investor. Every
// row not yet fully paid can be reminded. A group reads "Partially paid", so the
// picker leaves it to the GP to opt in, only when every row in it is partly paid:
// one interest that has paid nothing makes the whole group a to-do.
function groupOutstandingRows(rows, include) {
  const byKey = new Map();
  (rows ?? []).forEach(r => {
    if (r.paymentStatus === 'paid' || !include(r)) return;
    // Mirrors the backend's own fallback key for a row with no group.
    const key = r.partnerInterestGroupUuid ?? `row_${r.rowId}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.rowIds.push(r.rowId);
      seen.amount += r.amount;
      seen.amountPending += r.amountPending;
      if (r.paymentStatus !== 'partially_paid') {
        seen.paymentStatus = r.paymentStatus;
        seen.status = r.status;
      }
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
      amountPending: r.amountPending,
      // A group reads like a row, so the row helpers (caStatusBadge,
      // amountCellInner, dateCellInner) draw its cells too.
      paymentStatus: r.paymentStatus,
      status: r.status,
      lastReminded: r.lastReminded,
      daysLate: r.daysLate,
    });
  });
  return Array.from(byKey.values());
}

function remindableGroups(rows) {
  return groupOutstandingRows(rows, canRemind);
}

// Listed but unselectable: an email-disabled investor reads as remindable from the
// detail table, so dropping them from the selection silently confuses.
function blockedRemindGroups(rows) {
  return groupOutstandingRows(rows, r => !canRemind(r));
}

// An email-disabled row reads "Email disabled" whatever it owes. Otherwise an
// already-reminded row offers "Resend" over its last-reminded date, so the GP
// can see which LPs have been chased. A partly paid row is never presented as a
// task — a fund can carry a few dollars' balance for years — so it only notes
// when it was last reminded; its reminder lives in the row menu.
function remindCellInner(r, activityId) {
  if (!canRemind(r)) {
    return `<span class="ca-remind-off"
      title="Email notices are disabled for this investor, so a reminder would not reach them."
      >Email disabled</span>`;
  }
  if (r.paymentStatus === 'partially_paid') {
    const remindedOn = r.lastReminded ? fmtRemindedOn(r.lastReminded) : null;
    return remindedOn ? `<div class="ca-remind-sub">Reminded ${remindedOn}</div>` : '';
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

// The preview needs the interest id, and a disabled row gets no email to preview
// or send, so it loses the menu. A partly paid row's menu also carries its
// reminder (see remindCellInner), so it keeps the menu without an interest id.
function rowMenuCellInner(r, activityId) {
  const remind = r.paymentStatus === 'partially_paid';
  if (!canRemind(r) || (r.partnerId == null && !remind)) return '';
  return `<button class="ca-row-menu-btn"
      aria-label="More actions"
      aria-haspopup="true"
      aria-expanded="false"
      data-row-id="${escHtml(r.rowId)}"
      data-partner-id="${escHtml(r.partnerId ?? '')}"
      data-activity-id="${escHtml(activityId)}"
      data-fund-uuid="${escHtml(r.fundUuid)}"
      data-partner-name="${escHtml(r.partnerName)}"
      data-remind="${remind ? '1' : ''}"
      data-resend="${remind && r.lastReminded ? '1' : ''}"
      onclick="toggleCaRowMenu(this)">&#8943;</button>`;
}

// A partly paid row's amount notes what is still unpaid under the total called.
function amountCellInner(r) {
  const unpaid = r.paymentStatus === 'partially_paid'
    ? `<div class="ca-amount-sub">${fmtFull(r.amountPending)} unpaid</div>` : '';
  return `${fmtFull(r.amount)}${unpaid}`;
}

// Paid rows report when; outstanding ones report how late — in red only for an
// LP who has paid nothing, so a small leftover balance does not read as urgent.
function dateCellInner(r) {
  if (r.daysLate > 0 && r.paymentStatus !== 'paid') {
    const quiet = r.paymentStatus === 'partially_paid' ? ' ca-late-quiet' : '';
    return `<span class="ca-late${quiet}">${r.daysLate}d late</span>`;
  }
  return r.paidDate ? r.paidDate.slice(0, 10) : '—';
}

// A label the column cannot fit is ellipsized (see `.ca-status`), so the pill
// carries the whole label as its tooltip.
function caStatusBadge(r) {
  const { label, tone, title = label } = r.status;
  return `<span class="ca-status ca-status-${escHtml(tone)}" title="${escHtml(title)}">${escHtml(label)}</span>`;
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

  const { rows, failed } = await partnerRowsFor(fundUuid, activityId, dueDate, isCall);

  const body = document.getElementById('ca-detail-body');
  if (!body) return;

  // A half-walked set is discarded rather than rendered: the summary below sums
  // whatever rows arrived, so drawing the table would understate the call.
  if (failed || rows.length === 0) {
    body.innerHTML = failed
      ? '<div class="loading-row" style="padding:16px 0;">Partner rows failed to load. Close and reopen to retry.</div>'
      : '<div class="loading-row" style="padding:16px 0;">No partner rows found.</div>';
    return;
  }

  const totalOwed     = rows.reduce((s, r) => s + r.amount, 0);
  const totalReceived = rows.reduce((s, r) => s + r.amountReceived, 0);
  const totalPending  = rows.reduce((s, r) => s + r.amountPending, 0);

  body.innerHTML = `
    <div class="ca-detail-summary">
      <div class="ca-detail-stat"><span class="ca-detail-stat-val">${fmtFull(totalOwed)}</span><span class="ca-detail-stat-lbl">Net Amount</span></div>
      <div class="ca-detail-stat"><span class="ca-detail-stat-val ca-unpaid-val">${fmtFull(totalPending)}</span><span class="ca-detail-stat-lbl">Amount Pending</span></div>
      <div class="ca-detail-stat"><span class="ca-detail-stat-val ca-paid-val">${fmtFull(totalReceived)}</span><span class="ca-detail-stat-lbl">Amount Received</span></div>
      ${isCall ? `<span class="ca-notify-slot" id="ca-notify-slot">${bulkRemindCta(activityId, rows)}</span>` : ''}
    </div>
    <div class="ca-detail-table-wrap">
      <table class="ca-detail-table${isCall ? '' : ' ca-detail-table-dist'}">
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
            // Remind is only meaningful for capital calls (fa:mutate:send-capital-call-reminder)
            // and only for partners who still owe part of the call.
            const remindCell = !isCall ? '' : (r.paymentStatus === 'paid'
              ? '<td class="ca-td-remind"></td>'
              : `<td class="ca-td-remind">${remindCellInner(r, activityId)}</td>`);
            const menuCell = !isCall ? '' : (r.paymentStatus === 'paid'
              ? '<td class="ca-td-actions"></td>'
              : `<td class="ca-td-actions">${rowMenuCellInner(r, activityId)}</td>`);
            return `<tr class="ca-detail-row ca-row-${r.paymentStatus}" data-row-id="${escHtml(r.rowId)}">
              <td class="ca-td-name">${escHtml(r.partnerName)}</td>
              <td class="ca-td-amount">${amountCellInner(r)}</td>
              <td class="ca-td-status">${caStatusBadge(r)}</td>
              <td class="ca-td-date">${dateCellInner(r)}</td>
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
  trackHome("click", "CartaHome.CapActivity.Remind", { value: isResend ? "resend" : "send" });
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

  // One await, right before the stale check, so nothing async sits between it and the render.
  const { view, error, logoDataUri } = await loadEmailPreview(fundUuid, activityId, partnerId);
  if (error) console.error('[remind preview error]', error);
  const body = document.getElementById('ca-remind-preview-body');
  // Dismissed, or a different row was opened, while the preview was in flight.
  if (!body || _pendingRemind?.partnerId !== partnerId) return;

  // A preview that failed to load still leaves a working confirmation — the send
  // does not depend on it.
  if (error) {
    body.innerHTML = '<div class="loading-row" style="padding:16px 0;">Preview failed to load. You can still send the reminder.</div>';
    return;
  }
  renderEmailPreview(body, view, logoDataUri);
}

// Both flows share the overlay, so a backdrop click has to clear either one.
function closeRemindConfirm() {
  const overlay = document.getElementById('ca-confirm-overlay');
  if (overlay) overlay.classList.remove('ca-confirm-visible');
  _pendingRemind = null;
  _pendingBulk = null;
}

// The cached row a reminder was sent for. The id came back through a data
// attribute, so it is a string whatever type the API sent.
function cachedRow(activityId, rowId) {
  return (_capDetailCache[activityId] ?? []).find(r => String(r.rowId) === String(rowId));
}

async function submitRemindConfirm() {
  if (!_pendingRemind) return;
  trackHome("click", "CartaHome.CapActivity.Remind.Send");
  const { rowId, activityId, fundUuid, partnerName, sourceBtn } = _pendingRemind;
  // A snoozed send skips the confirm step, so the row's own button looks busy —
  // unless the send came from the row menu, whose ⋯ button has no label to swap.
  const btn = document.getElementById('ca-confirm-submit-btn')
    ?? (sourceBtn.classList.contains('ca-remind-btn') ? sourceBtn : null);
  const label = btn ? btn.textContent : '';
  // Applied on send, not on cancel: cancelling means "never mind", and silently
  // changing a preference from it would surprise.
  if (document.getElementById('ca-snooze-preview')?.checked) snoozePreviewForOneDay();
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  // The row's own trigger stays disabled until the send settles, so a second
  // click (on the ⋯ menu too) cannot send the same reminder twice.
  sourceBtn.disabled = true;
  clearSendError();

  try {
    // Colons become `__` in the generated tool name; the hyphens stay.
    const res = await _mcp("call_tool", {
      name: "fa__mutate__send-capital-call-reminder",
      arguments: {
        fund_uuid: fundUuid,
        capital_activity_id: activityId,
        row_ids: [rowId]
      }
    });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? 'Unknown error');
    // Stamp the cache, not just the DOM: the overlay reopens off the cache.
    const row = cachedRow(activityId, rowId);
    row.lastReminded = new Date().toISOString();
    refreshRemindedRow(row, activityId);
    renderSentConfirm([partnerName]);
    _pendingRemind = null;
  } catch (e) {
    console.error('[remind error]', e);
    showSendError('Failed to send reminder — please try again.');
    if (btn) { btn.disabled = false; btn.textContent = label; }
    sourceBtn.disabled = false;
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

// Offered only while someone has paid nothing: partly paid partners are listed in
// the picker, but on their own they are not a job to be done.
function bulkRemindCta(activityId, rows) {
  if (!remindableGroups(rows).some(g => g.paymentStatus === 'unpaid')) return '';
  if (bulkRemindedRecently(activityId)) {
    return '<span class="ca-notify-sent">Sent just now</span>';
  }
  return `<button class="ca-notify-btn" data-activity-id="${escHtml(activityId)}"
      onclick="openBulkNotify(this)">Remind investors</button>`;
}

// A partly paid partner is listed but left unticked: they have already sent
// money, so chasing them is the GP's call.
function preselectedBulkKeys(groups) {
  return groups.filter(g => g.paymentStatus !== 'partially_paid').map(g => g.key);
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
    selected: new Set(preselectedBulkKeys(groups)),
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
      <td class="ca-td-amount">${amountCellInner(g)}</td>
      <td class="ca-td-status">${caStatusBadge(g)}</td>
      <td class="ca-td-date">${dateCellInner(g)}</td>
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
  trackHome("click", "CartaHome.CapActivity.BulkNotify.Continue", { value: selectedBulkGroups().length });
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

  const { view, error, logoDataUri } = await loadEmailPreview(g.fundUuid, activityId, g.partnerId);
  if (error) console.error('[bulk remind preview error]', error);
  // Dismissed, or another investor was picked, while the preview was in flight.
  if (_pendingBulk?.previewKey !== key) return;
  const body = document.getElementById('ca-bulk-preview-body');
  if (!body) return;

  // A preview that failed to load still leaves a working send.
  if (error) {
    body.innerHTML = '<div class="loading-row" style="padding:16px 0;">Preview failed to load. You can still send the reminders.</div>';
    return;
  }
  renderEmailPreview(body, view, logoDataUri);
}

async function submitBulkRemind() {
  if (!_pendingBulk?.selected.size) return;
  const { activityId } = _pendingBulk;
  const sel = selectedBulkGroups();
  trackHome("click", "CartaHome.CapActivity.BulkNotify.Send", { value: sel.length });
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
      name: "fa__mutate__send-capital-call-reminder",
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

// Redraws a just-reminded row's remind and menu cells as a fresh render from the
// cache would, so a partly paid row's menu offers a resend from here on.
function refreshRemindedRow(r, activityId) {
  const tr = document.querySelector(`#ca-detail-overlay tr[data-row-id="${CSS.escape(String(r.rowId))}"]`);
  if (!tr) return;
  tr.querySelector('.ca-td-remind').innerHTML = remindCellInner(r, activityId);
  tr.querySelector('.ca-td-actions').innerHTML = rowMenuCellInner(r, activityId);
}

// Stamps the cache, not just the DOM: the overlay reopens off the cache.
function stampRemindedRows(activityId, rowIds) {
  const now = new Date().toISOString();
  const ids = new Set(rowIds);
  (_capDetailCache[activityId] ?? []).forEach(r => {
    if (!ids.has(r.rowId)) return;
    r.lastReminded = now;
    refreshRemindedRow(r, activityId);
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
      `<button class="ca-row-menu-item" id="ca-row-menu-remind" role="menuitem" onclick="remindFromMenu()"></button>
       <button class="ca-row-menu-item" id="ca-row-menu-preview" role="menuitem" onclick="previewEmailFromMenu()">Preview email</button>`;
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
  const remindItem = menu.querySelector('#ca-row-menu-remind');
  remindItem.hidden = btn.dataset.remind !== '1';
  remindItem.textContent = btn.dataset.resend === '1' ? 'Resend reminder' : 'Send reminder';
  menu.querySelector('#ca-row-menu-preview').hidden = !btn.dataset.partnerId;
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

function remindFromMenu() {
  const btn = _caRowMenu?._sourceBtn;
  if (!btn) return;
  closeCaRowMenu();
  openRemindConfirm(btn);
}

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
  const res = await _mcp("read_tool", {
    name: "fa__get__capital-activity-partner-email-preview",
    arguments: {
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

// Starts the logo fetch alongside the preview fetch and resolves both together. A failed
// preview comes back as `error` (not thrown) so each caller keeps its own error UI.
async function loadEmailPreview(fundUuid, activityId, partnerId) {
  const key = `${activityId}:${partnerId}`;
  const logoPending = fetchFirmLogoDataUri();
  let view = _emailPreviewCache[key];
  let error = null;
  if (!view) {
    try { view = _emailPreviewCache[key] = await fetchEmailPreview(fundUuid, activityId, partnerId); }
    catch (e) { error = e; }
  }
  return { view, error, logoDataUri: await logoPending };
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
  const { view, error, logoDataUri } = await loadEmailPreview(fundUuid, activityId, partnerId);
  if (error) console.error('[email preview error]', error);
  // Closed, or a second row's preview was opened, while this one was in flight.
  if (reqId !== _previewRequestId) return;
  const body = document.getElementById('ca-preview-body');
  if (!body) return;

  if (error) {
    body.innerHTML = '<div class="loading-row" style="padding:16px 0;">Preview failed to load. Close and try again.</div>';
    return;
  }
  renderEmailPreview(body, view, logoDataUri);
}

// The firm's fa:get:firm_logo payload, or null. Cached for the session because every
// reminder in the firm carries the same logo, and it is also where a non-staff caller
// can read the firm's numeric id.
let _firmLogoPromise = null;
function fetchFirmLogo() {
  if (!_benchmarkFirmId) return Promise.resolve(null);
  if (!_firmLogoPromise) {
    _firmLogoPromise = _mcp("read_tool", {
      name: "fa__get__firm_logo",
      arguments: { firm_uuid: _benchmarkFirmId },
    }).then(res => {
      if (res.isError) return null;
      return JSON.parse(res.content?.[0]?.text ?? '{}');
    }).catch(e => {
      console.error('[firm logo error]', e);
      return null;
    });
  }
  return _firmLogoPromise;
}

// The firm's own logo as a data: URI, or null.
function fetchFirmLogoDataUri() {
  return fetchFirmLogo().then(logo => logo?.data_uri ?? null);
}

// The firm's numeric id that Carta's web URLs take (/investors/firm/<id>/), or null.
function fetchFirmCartaId() {
  return fetchFirmLogo().then(logo =>
    Number.isInteger(logo?.firm_carta_id) ? logo.firm_carta_id : null);
}

// The sandbox CSP is img-src 'self' data:, so an email image served from a URL shows
// as a broken icon. The firm's co-branding logo (alt="Logo" in fund-admin's email base
// template) is swapped for its data: URI; any other URL image is dropped and counted
// so the preview can say the sent email carries more than it shows.
function inlineEmailImages(html, logoDataUri) {
  let unresolved = 0;
  const out = String(html).replace(/<img\b[^>]*>/gi, tag => {
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (/^data:/i.test(src)) return tag;
    if (logoDataUri && /\balt\s*=\s*"Logo"/i.test(tag)) {
      return tag.replace(/\bsrc\s*=\s*"[^"]*"/i, `src="${logoDataUri}"`);
    }
    unresolved++;
    return '';
  });
  return { html: out, unresolved };
}

function renderEmailPreview(body, view, logoDataUri) {
  const { html, unresolved } = inlineEmailImages(view.body ?? '', logoDataUri);
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
    <iframe class="ca-preview-frame" sandbox="" title="Email preview" srcdoc="${escHtml(html)}"></iframe>
    ${html.includes('[/LINK_CARTA]')
      ? '<div class="ca-preview-note">The [/LINK_CARTA] placeholder is a preview artifact — the sent email carries a real link.</div>'
      : ''}
    ${unresolved > 0
      ? '<div class="ca-preview-note">Some images in the sent email can\'t be shown in this preview.</div>'
      : ''}`;
}

function closeEmailPreview() {
  _previewRequestId++;
  const overlay = document.getElementById('ca-preview-overlay');
  if (overlay) overlay.classList.remove('ca-preview-visible');
}
