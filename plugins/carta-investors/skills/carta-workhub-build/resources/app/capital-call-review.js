// Capital call review panel: the drafted call a GP approves, opened from its
// task card. Depends on carta-workhub.app.js for _mcp, escHtml, showToast.

// A build can name one activity so the panel is reachable without a live review
// task to open it from. Empty is the normal case.
// An unsubstituted {{...}} means this source is being read outside a build, and
// must read as unset — never as an activity id.
const ccrBuildValue = (v) => (/^\{\{.*\}\}$/.test(v) ? "" : v);
const CCR_TARGET = {
  fundUuid: ccrBuildValue("{{CCR_FUND_UUID}}"),
  activityId: ccrBuildValue("{{CCR_ACTIVITY_ID}}"),
};

// Activated when the build seeds activityId "demo"; API calls are bypassed so
// the full workflow is explorable without a CCR-enabled firm.
const CCR_IS_DEMO = CCR_TARGET.activityId === "demo";

const CCR_DEMO_SUMMARY = {
  fund_name: "Great Basin Capital Partners Fund II",
  currency: "USD",
  gross_call_amount: "4750000",
  total_due_to_fund: "4750000",
  net_amount: "4750000",
  total_commitment: "20200000",
  total_post_call_percent: "0.4312",
  total_post_call_amount: "8710240",
  participating_interests_count: 5,
  interests_count: 6,
  due_date: "2026-10-15",
  date_of_notice: "2026-10-01",
  metrics_effective_date: "2026-09-01",
  bucket_totals: [
    {
      bucket_id: 1, slug: "capital_contributions",
      display_name: "Capital contributions",
      total: "4750000", inside_commitment: true, is_adjustment: false,
    },
  ],
  preparation: {
    prepared_by: "Sarah Mitchell",
    note_author: "Sarah Mitchell",
    prepared_on: "2026-08-28",
    note: "This is a pro-rata capital call for the Series B follow-on investment in Meridian Tech. Please review the allocations and confirm the due date works for each LP. I've already reflected Thornwood's side letter cap (10% below pro-rata) in their allocation.\n\nWire instructions are unchanged from the prior call.",
  },
  receiving_account: {
    bank_name: "First Republic Bank",
    bank_address: "San Francisco, CA, US",
    account_name: "Great Basin Capital Partners Fund II, L.P.",
    account_number: "4400124821",
    account_number_last_four: "4821",
    routing_number: "321081669",
    obi_memo: "FFC Great Basin Capital Partners Fund II, L.P.",
  },
  notice_delivery: [{ email_notice_enabled: true, pdf_notice_enabled: true, count: 5 }],
  contacts: [{ full_name: "Sarah Mitchell", email: "sarah.mitchell@example.com", type: "preparer" }],
  contact_phone: "+1 (415) 555-0147",
  non_participating: {
    count: 1,
    interests: [{ interest: { name: "Advisor Carry Pool" }, is_on_activity: false }],
  },
  rows: {
    results: [
      {
        interest: { id: 101, name: "Cascade Peak Ventures LLC", partner_interest_group_name: "Cascade Peak Ventures LLC" },
        commitment: "8500000", due_to_fund: "2000000", net_absolute_amount: "2000000",
        post_call_percent: "0.4588", post_call_percent_inside_commitment: "0.4588",
        is_participating: true, amount_buckets: [{ bucket_id: 1, amount: "2000000", inside_commitment: true }],
      },
      {
        interest: { id: 102, name: "Ridgeline Family Office", partner_interest_group_name: "Ridgeline Family Office" },
        commitment: "5200000", due_to_fund: "1225000", net_absolute_amount: "1225000",
        post_call_percent: "0.4125", post_call_percent_inside_commitment: "0.4125",
        is_participating: true, amount_buckets: [{ bucket_id: 1, amount: "1225000", inside_commitment: true }],
      },
      {
        interest: { id: 103, name: "Summit Partners IV Trust", partner_interest_group_name: "Summit Partners IV Trust" },
        commitment: "3000000", due_to_fund: "705000", net_absolute_amount: "705000",
        post_call_percent: "0.3950", post_call_percent_inside_commitment: "0.3950",
        is_participating: true, amount_buckets: [{ bucket_id: 1, amount: "705000", inside_commitment: true }],
      },
      {
        interest: { id: 104, name: "Thornwood Capital Group", partner_interest_group_name: "Thornwood Capital Group" },
        commitment: "2500000", due_to_fund: "590000", net_absolute_amount: "590000",
        post_call_percent: "0.4160", post_call_percent_inside_commitment: "0.4160",
        is_participating: true, amount_buckets: [{ bucket_id: 1, amount: "590000", inside_commitment: true }],
      },
      {
        interest: { id: 105, name: "Elkhorn Investment Partners", partner_interest_group_name: "Elkhorn Investment Partners" },
        commitment: "1000000", due_to_fund: "230000", net_absolute_amount: "230000",
        post_call_percent: "0.3800", post_call_percent_inside_commitment: "0.3800",
        is_participating: true, amount_buckets: [{ bucket_id: 1, amount: "230000", inside_commitment: true }],
      },
    ],
  },
};

function ccrDemoEmail(row) {
  const s = CCR_DEMO_SUMMARY;
  const name = ccrRowLabel(row);
  const amt = ccrMoney(row.due_to_fund, s.currency);
  const due = ccrDate(s.due_date);
  const body = "<!DOCTYPE html><html><head><meta charset='utf-8'><style>" +
    "body{font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;padding:24px}" +
    "p{margin:0 0 14px;line-height:1.5}.amount{font-size:20px;font-weight:bold;margin:16px 0}" +
    ".box{background:#f7f7f7;border:1px solid #ddd;border-radius:4px;padding:14px;margin:14px 0}" +
    ".row{display:flex;justify-content:space-between;margin:5px 0;font-size:13px}" +
    ".label{color:#666}.footer{margin-top:24px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:12px}" +
    "</style></head><body>" +
    "<p>Dear " + escHtml(name) + ",</p>" +
    "<p>Great Basin Capital Partners Fund II, L.P. (the “Fund”) is calling capital. Your contribution details:</p>" +
    "<div class='amount'>" + escHtml(amt) + " due " + escHtml(due) + "</div>" +
    "<div class='box'>" +
    "<div class='row'><span class='label'>Fund</span><span>Great Basin Capital Partners Fund II, L.P.</span></div>" +
    "<div class='row'><span class='label'>Your commitment</span><span>" + escHtml(ccrMoney(row.commitment, s.currency)) + "</span></div>" +
    "<div class='row'><span class='label'>Amount due</span><span><strong>" + escHtml(amt) + "</strong></span></div>" +
    "<div class='row'><span class='label'>Due date</span><span>" + escHtml(due) + "</span></div>" +
    "<div class='row'><span class='label'>Purpose</span><span>Capital contributions — Series B follow-on (Meridian Tech)</span></div>" +
    "</div>" +
    "<p>Please wire funds by " + escHtml(due) + ":</p>" +
    "<div class='box'>" +
    "<div class='row'><span class='label'>Bank</span><span>First Republic Bank</span></div>" +
    "<div class='row'><span class='label'>Account name</span><span>Great Basin Capital Partners Fund II, L.P.</span></div>" +
    "<div class='row'><span class='label'>Account</span><span>·4821</span></div>" +
    "<div class='row'><span class='label'>Wire verification</span><span>+1 (415) 555-0147</span></div>" +
    "</div>" +
    "<p>To confirm wire details and view your capital account, log in at [/LINK_CARTA].</p>" +
    "<p>Questions? Reply to this email or contact your fund administrator.</p>" +
    "<div class='footer'>Great Basin Capital Partners · San Francisco, CA · Administered by Carta</div>" +
    "</body></html>";
  return {
    subject: "Capital Call Notice — Great Basin Capital Partners Fund II",
    recipients: [
      { addr_type: "TO", name: name, email: "investor@example.com" },
      { addr_type: "CC", name: "Sarah Mitchell", email: "sarah.mitchell@example.com" },
    ],
    body: body,
    body_format: "html",
  };
}

// The workflow template a capital call under review carries, and the two tasks
// on it that mean the GP owes a decision.
const CCR_WORKFLOW_TEMPLATE = "request-capital-activity";
const CCR_REVIEW_TASK = "review-capital-activity";
const CCR_CHANGES_TASK = "review-capital-activity-changes";

// TaskStatus PENDING and ACTIVE. A resolved review is a decision already taken.
const CCR_OPEN_TASK_STATUSES = [0, 1];

const CCR_CARD_TITLE = "Capital call — review and release";

const CCR_PAGE_SIZE = 12;   // carta-mcp's cap, measured against its 40k budget
const CCR_MAX_PAGES = 40;

let _ccr = null;

// Held across opens so the seed card can name its fund before the panel is
// opened a second time.
let _ccrFundName = CCR_IS_DEMO ? CCR_DEMO_SUMMARY.fund_name : null;

function ccrReset(target, title) {
  _ccr = {
    target: target,
    title: title || CCR_CARD_TITLE,
    summary: null,
    rows: [],
    rowsDone: false,
    truncated: false,
    phase: "review",
    activeTab: 'overview',
    noticeOpen: false,
    noteOpen: false,
    payShowSensitive: { acct: false, routing: false },
    showAllRows: false,
    lpIndex: 0,
    docTab: "email",
    email: null,
    emailError: null,
    pdf: null,
    pdfError: null,
    pdfLoading: false,
    changeText: "",
    sentMessage: "",
    error: null,
    // Set once a release fails ambiguously; never cleared for this panel.
    locked: false,
    loading: true,
  };
}

// ── Formatting ────────────────────────────────────────────────────────────
// Amounts and percentages arrive as strings; percentages are ratios.

function ccrNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function ccrMoney(v, ccy) {
  const n = ccrNum(v);
  if (n === null) return "—";
  // No currency, no amount. A figure carrying a guessed currency misstates what
  // a fund is being called for, and this panel releases money.
  if (!ccy) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: ccy, currencyDisplay: "narrowSymbol",
    }).format(n);
  } catch (e) {
    return ccy + " " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

function ccrPct(v) {
  const n = ccrNum(v);
  return n === null ? "—" : (n * 100).toFixed(2) + "%";
}

// A bare @dc_exposed hint emits MM/DD/YYYY, not ISO. Accept both.
function ccrDate(s) {
  if (!s) return "—";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  let d = null;
  if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (us) d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  if (!d || isNaN(d)) return s;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

function ccrDaysUntil(s) {
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  let d = null;
  if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (us) d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  if (!d || isNaN(d)) return "";
  const days = Math.round((d - new Date()) / 86400000);
  if (days === 0) return "today";
  return days > 0 ? "in " + days + " days" : Math.abs(days) + " days ago";
}

// ── Field readers ─────────────────────────────────────────────────────────
// Track A renamed the post-call figures for the formula behind them. Read the
// specific name, fall back to the bare one.

function ccrPick(obj, specific, bare) {
  if (!obj) return null;
  return obj[specific] !== undefined && obj[specific] !== null ? obj[specific] : obj[bare];
}

const ccrRowLabel = (r) =>
  (r.interest && (r.interest.partner_interest_group_name || r.interest.name)) || "Unnamed interest";

// Partition a row's buckets on inside_commitment — never on a label a fund can
// rename. The flag reaches the MCP row via the summary's bucket_totals.
function ccrSplit(r, s) {
  const byId = new Map((s.bucket_totals || []).map((b) => [String(b.bucket_id), b]));
  let inside = 0, outside = 0, known = false;
  (r.amount_buckets || []).forEach((ab) => {
    const meta = byId.get(String(ab.bucket_id)) || {};
    const flag = ab.inside_commitment !== undefined && ab.inside_commitment !== null
      ? ab.inside_commitment : meta.inside_commitment;
    if (flag === undefined || flag === null) return;
    known = true;
    const amt = ccrNum(ab.amount) || 0;
    if (flag) inside += amt; else outside += amt;
  });
  return { inside: inside, outside: outside, known: known };
}

// ── Reads ─────────────────────────────────────────────────────────────────

function ccrPayload(res, has) {
  const cands = _mcpResultCandidates(res);
  for (const c of cands) { if (c && has(c)) return c; }
  return null;
}

async function ccrLoad() {
  // Own this load. Reopening swaps _ccr, and a read still in flight would
  // otherwise write one call's investors under another call's header.
  const snap = _ccr;
  const t = snap.target;
  if (!t || !t.fundUuid || !t.activityId) {
    snap.loading = false;
    snap.error = "unlinked";
    ccrRender();
    return;
  }

  if (CCR_IS_DEMO) {
    snap.summary = CCR_DEMO_SUMMARY;
    snap.rows = CCR_DEMO_SUMMARY.rows.results;
    snap.loading = false;
    snap.rowsDone = true;
    if (!_ccrFundName) _ccrFundName = CCR_DEMO_SUMMARY.fund_name;
    ccrRender();
    renderFarSection();
    if (snap.activeTab === 'notice') ccrLoadEmail();
    return;
  }

  try {
    const params = { fund_uuid: t.fundUuid, capital_activity_id: t.activityId };

    const sRes = await _mcp("fetch", {
      command: "fa:get:capital-activity-review-summary",
      params: params,
    });
    if (_ccr !== snap) return;
    if (sRes.isError) throw new Error(sRes.content?.[0]?.text ?? "review summary failed");

    const summary = ccrPayload(sRes, (c) =>
      "bucket_totals" in c || "interests_count" in c || "total_due_to_fund" in c);
    if (!summary) throw new Error("Carta answered, but not with a review summary");

    snap.summary = summary;
    snap.rows = (summary.rows && summary.rows.results) || [];
    snap.loading = false;
    ccrRender();
    if (snap.activeTab === 'notice') ccrLoadEmail();

    if (summary.fund_name && summary.fund_name !== _ccrFundName) {
      _ccrFundName = summary.fund_name;
      renderFarSection();
    }

    // The summary embeds a capped preview of the largest movers, never the
    // whole set, so the rows command is walked regardless.
    let walked = [];
    let page = 1;
    for (; page <= CCR_MAX_PAGES; page++) {
      const rRes = await _mcp("fetch", {
        command: "fa:list:capital-activity-review-row",
        params: Object.assign({ page: page, page_size: CCR_PAGE_SIZE }, params),
      });
      if (_ccr !== snap) return;
      if (rRes.isError) break;
      const pageData = ccrPayload(rRes, (c) => Array.isArray(c.results));
      if (!pageData) break;
      walked = walked.concat(pageData.results);
      if (walked.length >= snap.rows.length) snap.rows = walked;
      ccrRender();
      if (!pageData.has_next) break;
    }
    snap.truncated = page > CCR_MAX_PAGES;
    snap.rowsDone = true;
    ccrRender();
  } catch (err) {
    if (_ccr !== snap) return;
    console.error("[ccr] review read failed —", err);
    snap.loading = false;
    snap.error = err && err.message ? err.message : "read failed";
    ccrRender();
  }
}

// One preview per interest group, so the partner PK on the row is the key.
async function ccrLoadEmail() {
  // Same ownership rule as ccrLoad: a reopen must not receive this preview.
  const snap = _ccr;
  const row = snap.rows[snap.lpIndex];
  if (!row || !row.interest || row.interest.id == null) {
    snap.emailError = "This row carries no partner id, so its notice cannot be previewed.";
    ccrRenderNotice();
    return;
  }

  snap.email = null;
  snap.emailError = null;
  ccrRenderNotice();

  if (CCR_IS_DEMO) {
    snap.email = ccrDemoEmail(row);
    ccrRenderNotice();
    return;
  }

  try {
    const res = await _mcp("fetch", {
      command: "fa:get:capital-activity-partner-email-preview",
      params: {
        fund_uuid: snap.target.fundUuid,
        capital_activity_id: snap.target.activityId,
        partner_id: row.interest.id,
        body_format: "html",
      },
    });
    if (_ccr !== snap) return;
    let p = res.isError ? null : ccrPayload(res, (c) => "subject" in c || "body" in c);
    if (!p) {
      // The command's own oversize hint: markup can exceed the response budget.
      const alt = await _mcp("fetch", {
        command: "fa:get:capital-activity-partner-email-preview",
        params: {
          fund_uuid: snap.target.fundUuid,
          capital_activity_id: snap.target.activityId,
          partner_id: row.interest.id,
          body_format: "text",
        },
      });
      if (_ccr !== snap) return;
      if (alt.isError) throw new Error(alt.content?.[0]?.text ?? "preview failed");
      p = ccrPayload(alt, (c) => "subject" in c || "body" in c);
    }
    if (!p) throw new Error("no preview in the response");
    snap.email = p;
  } catch (err) {
    if (_ccr !== snap) return;
    snap.emailError = err && err.message ? err.message : "preview failed";
  }
  if (_ccr !== snap) return;
  ccrRender();
  ccrRenderNotice();
}

// ── Writes ────────────────────────────────────────────────────────────────

async function ccrSubmitChanges() {
  const text = (document.getElementById("ccr-change-text") || {}).value || "";
  if (!text.trim()) { showToast("Write what needs to change first."); return; }

  const btn = document.getElementById("ccr-send-changes");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  trackWorkhub("click", "CartaWorkhub.CapitalCallReview.RequestChanges");

  if (CCR_IS_DEMO) {
    _ccr.sentMessage = text;
    _ccr.phase = "sent";
    ccrRender();
    return;
  }

  try {
    const res = await _mcp("mutate", {
      command: "fa:mutate:request-capital-activity-changes",
      params: {
        fund_uuid: _ccr.target.fundUuid,
        capital_activity_id: _ccr.target.activityId,
        comment: text,
      },
    });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? "request failed");
    _ccr.sentMessage = text;
    _ccr.phase = "sent";
    ccrRender();
    farFetchRequests();
  } catch (err) {
    console.error("[ccr] request-changes failed —", err);
    showToast("Could not send that to your Carta team. Nothing changed.");
    if (btn) { btn.disabled = false; btn.textContent = "Send to Carta"; }
  }
}

async function ccrApprove() {
  const btn = document.getElementById("ccr-do-approve");
  if (btn) { btn.disabled = true; btn.textContent = "Releasing…"; }
  trackWorkhub("click", "CartaWorkhub.CapitalCallReview.Release");

  if (CCR_IS_DEMO) {
    _ccr.phase = "released";
    ccrRender();
    return;
  }

  try {
    const res = await _mcp("mutate", {
      command: "fa:mutate:approve-capital-activity",
      params: {
        fund_uuid: _ccr.target.fundUuid,
        capital_activity_id: _ccr.target.activityId,
      },
    });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? "release failed");
    _ccr.phase = "released";
    ccrRender();
    farFetchRequests();
  } catch (err) {
    console.error("[ccr] approve-and-release failed —", err);
    // An ambiguous failure must not read as "nothing happened": the release may
    // have run. Send the reviewer to Carta rather than inviting a second press.
    _ccr.phase = "review";
    // Not _ccr.error: that doubles as the body's message and would replace the
    // call the reviewer now has to go and check.
    _ccr.locked = true;
    ccrRender();
    showToast("Release did not confirm. Check the call in Carta before trying again.");
  }
}

// ── Render ────────────────────────────────────────────────────────────────

function ccrMainTabBar() {
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'notice', label: 'Notice' },
    { id: 'alloc', label: 'Allocations' },
    { id: 'pay', label: 'Payment information' },
  ];
  return '<div class="ccr-main-tabs">' +
    tabs.map((t) =>
      '<button class="ccr-main-tab' + (_ccr.activeTab === t.id ? ' ccr-main-tab-on' : '') +
      '" data-ccr-main-tab="' + t.id + '">' + t.label + '</button>').join('') +
  '</div>';
}

function ccrOverviewTabBody(s) {
  const ccy = s.currency;
  const called = ccrNum(s.gross_call_amount) !== null ? s.gross_call_amount : s.total_due_to_fund;
  const postPct = ccrPick(s, "total_post_call_percent_inside_commitment", "total_post_call_percent");
  const postAmt = ccrPick(s, "total_post_call_amount_inside_commitment", "total_post_call_amount");
  const ratio = ccrNum(postPct);
  const buckets = (s.bucket_totals || []).filter((b) => !b.is_adjustment);

  return '<div class="ccr-card">' +
    '<div class="ccr-card-label">Total being called</div>' +
    '<div class="ccr-card-figure">' + escHtml(ccrMoney(called, ccy)) + '</div>' +
    '<div class="ccr-card-list">' +
      '<div class="ccr-kv"><span class="ccr-k">Due from investors</span>' +
        '<span class="ccr-v ccr-strong">' + escHtml(ccrDate(s.due_date)) + '</span>' +
        '<span class="ccr-aside">' + escHtml(ccrDaysUntil(s.due_date)) + '</span></div>' +
      '<div class="ccr-kv"><span class="ccr-k">Purpose</span><span class="ccr-v">' +
        (buckets.length
          ? buckets.map((b) => '<span class="ccr-split"><span>' + escHtml(b.display_name || b.slug || "Bucket") +
              '</span><span>' + escHtml(ccrMoney(b.total, ccy)) + '</span></span>').join('')
          : 'No buckets on this activity') +
        '</span></div>' +
      '<div class="ccr-kv"><span class="ccr-k">Called after this call</span><span class="ccr-v">' +
        (ratio === null
          ? '<span class="ccr-muted">Not available</span>'
          : '<span class="ccr-split"><span class="ccr-strong">' + escHtml(ccrPct(postPct)) + '</span>' +
            '<span class="ccr-muted">' + escHtml(ccrMoney(postAmt, ccy)) +
            '<span style="padding:0 5px">of</span>' +
            escHtml(ccrMoney(s.total_commitment, ccy)) + '</span></span>' +
            '<span class="ccr-meter"><span style="width:' +
            Math.max(0, Math.min(100, ratio * 100)).toFixed(2) + '%"></span></span>') +
        (s.metrics_effective_date
          ? '<span class="ccr-note">As of ' + escHtml(ccrDate(s.metrics_effective_date)) + '.</span>'
          : '') +
        '</span></div>' +
    '</div>' +
  '</div>';
}

function ccrNoticeTabBody(s) {
  const rows = _ccr.rows.filter((r) => r.is_participating !== false);
  if (!rows.length) {
    return _ccr.loading
      ? '<div class="loading-row" style="padding:20px 0;">Loading investors…</div>'
      : '<div class="ccr-empty"><p>No participating investors on this call.</p></div>';
  }

  const options = rows.map((r, i) =>
    '<option value="' + i + '"' + (i === _ccr.lpIndex ? ' selected' : '') + '>' +
    escHtml(ccrRowLabel(r)) + '</option>').join('');

  let emailPane;
  if (_ccr.emailError) {
    emailPane = '<div class="ccr-empty"><p>This notice could not be previewed.</p>' +
      '<p class="ccr-note">' + escHtml(_ccr.emailError) + '</p></div>';
  } else if (!_ccr.email) {
    emailPane = '<div class="loading-row" style="padding:16px 0;">Rendering the notice…</div>';
  } else {
    const e = _ccr.email;
    const label = (d) => d.name ? d.name + ' <' + d.email + '>' : d.email;
    const addrs = (kind) => (e.recipients || []).filter((d) => d.addr_type === kind).map(label).join(', ');
    emailPane = '<div class="ccr-mail-head">' +
      '<div class="ccr-mail-subject">' + escHtml(e.subject || '') + '</div>' +
      '<div class="ccr-mail-addr">To: ' + escHtml(addrs('TO')) + '</div>' +
      '<div class="ccr-mail-addr">CC: ' + escHtml(addrs('CC')) + '</div>' +
      '</div>' +
      (e.body_format === 'html'
        ? '<iframe class="ccr-mail-frame" sandbox="" title="Email preview" srcdoc="' +
          escHtml(e.body || '') + '"></iframe>'
        : '<div class="ccr-mail-body">' +
          escHtml(e.body || '').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</div>') +
      ((e.body || '').indexOf('[/LINK_CARTA]') !== -1
        ? '<div class="ccr-caveat"><span class="ccr-caveat-arrow">&#8593;</span>' +
          "<span>Preview only: the address ends in the placeholder [/LINK_CARTA] instead of a " +
          "link. Each investor's sent email carries a working link to their own capital call. " +
          "Everything else here is final.</span></div>"
        : '');
  }

  const docTabs = '<span class="ccr-tabs">' +
    '<button class="ccr-tab' + (_ccr.docTab !== 'pdf' ? ' ccr-tab-on' : '') + '" data-ccr-inline-tab="email">Email</button>' +
    (window.pdfjsLib
      ? '<button class="ccr-tab' + (_ccr.docTab === 'pdf' ? ' ccr-tab-on' : '') + '" data-ccr-inline-tab="pdf">PDF</button>'
      : '') +
    '</span>';

  const contentPane = _ccr.docTab === 'pdf' ? ccrNoticeDoc() : emailPane;

  return '<div class="ccr-notice-bar">' +
    '<select id="ccr-inline-lp">' + options + '</select>' +
    docTabs +
    '</div>' +
    contentPane;
}

function ccrSection(id, title, summary, open, bodyHtml) {
  return '<button class="ccr-row-btn" data-ccr-toggle="' + id + '">' +
    '<span class="ccr-row-title">' + escHtml(title) + "</span>" +
    '<span class="ccr-row-sum">' + escHtml(summary) + "</span>" +
    '<span class="ccr-chev' + (open ? " ccr-chev-open" : "") + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>' +
    "</span></button>" +
    (open ? '<div class="ccr-row-body">' + bodyHtml + "</div>" : "");
}

function ccrAllocTable(s) {
  const rows = _ccr.rows.filter((r) => r.is_participating !== false);
  const excluded = _ccr.rows.filter((r) => r.is_participating === false);
  rows.sort((a, b) => (ccrNum(b.commitment) || 0) - (ccrNum(a.commitment) || 0));

  const shown = _ccr.showAllRows ? rows : rows.slice(0, 5);
  const split = rows.some((r) => ccrSplit(r, s).known);
  const ccy = s.currency;

  const head = split
    ? ["Investor", "Commitment", "This call", "Late int.", "Called after"]
    : ["Investor", "Commitment", "Due to fund", "Net", "Called after"];

  const body = shown.map((r) => {
    const sp = ccrSplit(r, s);
    const cells = [
      "<td>" + escHtml(ccrRowLabel(r)) + "</td>",
      '<td class="ccr-muted">' + escHtml(ccrMoney(r.commitment, ccy)) + "</td>",
    ];
    if (split) {
      cells.push('<td class="ccr-strong">' + escHtml(ccrMoney(sp.inside, ccy)) + "</td>");
      cells.push("<td" + (sp.outside ? ">" : ' class="ccr-faint">') +
        (sp.outside ? escHtml(ccrMoney(sp.outside, ccy)) : "—") + "</td>");
    } else {
      cells.push('<td class="ccr-strong">' + escHtml(ccrMoney(r.due_to_fund, ccy)) + "</td>");
      cells.push("<td>" + escHtml(ccrMoney(r.net_absolute_amount, ccy)) + "</td>");
    }
    cells.push('<td class="ccr-muted">' +
      escHtml(ccrPct(ccrPick(r, "post_call_percent_inside_commitment", "post_call_percent"))) + "</td>");
    return "<tr>" + cells.join("") + "</tr>";
  }).join("");

  const partCount = s.participating_interests_count !== null && s.participating_interests_count !== undefined
    ? s.participating_interests_count
    : (_ccr.rowsDone ? rows.length : null);

  const insideTotal = (s.bucket_totals || []).filter((b) => b.inside_commitment === true)
    .reduce((a, b) => a + (ccrNum(b.total) || 0), 0);
  const outsideTotal = (s.bucket_totals || []).filter((b) => b.inside_commitment === false)
    .reduce((a, b) => a + (ccrNum(b.total) || 0), 0);

  const totals = ["<td>" + (partCount === null ? "Totals" : partCount + " participating") + "</td>",
                  "<td></td>"];
  if (split) {
    totals.push("<td>" + escHtml(ccrMoney(insideTotal, ccy)) + "</td>");
    totals.push("<td>" + (outsideTotal ? escHtml(ccrMoney(outsideTotal, ccy)) : "—") + "</td>");
  } else {
    totals.push("<td>" + escHtml(ccrMoney(s.total_due_to_fund, ccy)) + "</td>");
    totals.push("<td>" + escHtml(ccrMoney(s.net_amount, ccy)) + "</td>");
  }
  totals.push("<td>" +
    escHtml(ccrPct(ccrPick(s, "total_post_call_percent_inside_commitment", "total_post_call_percent"))) + "</td>");

  const more = rows.length > 5 && _ccr.rowsDone
    ? '<button class="ccr-more" data-ccr-more>' +
      (_ccr.showAllRows ? "Show fewer" : "Show all " + rows.length + " participating") + "</button>"
    : (_ccr.rowsDone ? "" : '<div class="ccr-more-loading">Loading the rest…</div>');

  // The summary's fold sees fund interests with no row at all; loaded rows
  // can only ever show the zero-amount kind.
  const fold = s.non_participating;
  const npList = fold && (fold.interests || []).length
    ? (fold.interests || []).map((n) => {
        const i = n.interest || {};
        return '<div class="ccr-np"><span>' +
          escHtml(i.partner_interest_group_name || i.name || "Unnamed") + "</span><span>" +
          escHtml(n.is_on_activity === false ? "not on this activity" : "nothing to pay or receive") +
          "</span></div>";
      }).join("")
    : excluded.map((r) =>
        '<div class="ccr-np"><span>' + escHtml(ccrRowLabel(r)) +
        "</span><span>nothing to pay or receive</span></div>").join("");
  const npCount = fold && fold.count !== null && fold.count !== undefined ? fold.count : excluded.length;

  return '<table class="ccr-table"><thead><tr>' +
    head.map((h) => "<th>" + escHtml(h) + "</th>").join("") +
    "</tr></thead><tbody>" + body +
    '<tr class="ccr-total">' + totals.join("") + "</tr></tbody></table>" +
    more +
    (_ccr.truncated ? '<p class="ccr-note">Stopped after ' + CCR_MAX_PAGES + " pages; the rest are on the activity.</p>" : "") +
    (npCount
      ? '<div class="ccr-np-block"><div class="ccr-np-label">Not participating · ' + npCount + "</div>" + npList + "</div>"
      : "");
}

function ccrPayBody(s) {
  const a = s.receiving_account;
  const groups = s.notice_delivery || [];
  const noticeLabel = (g) => g.email_notice_enabled && g.pdf_notice_enabled ? "email with PDF"
    : g.email_notice_enabled ? "email only"
    : g.pdf_notice_enabled ? "PDF only" : "no notice";

  const delivery = groups.length
    ? groups.map((g) => (g.count === null || g.count === undefined ? "—" : g.count) + " " + noticeLabel(g)).join(" · ")
    : "No delivery detail";

  const maskStr = (v, keepLast) => {
    if (!v) return null;
    const s = String(v);
    return '·'.repeat(Math.max(0, s.length - keepLast)) + s.slice(-keepLast);
  };

  const inlineReveal = (show, key) =>
    '<button class="ccr-pay-inline-reveal" data-ccr-pay-reveal="' + key + '">' +
    (show ? 'Hide details' : 'Show details') + '</button>';

  let wireHtml = '';
  if (!a) {
    const fallback = s.uses_fbo_contributions ? "Per-partner virtual accounts" : "No account named on this activity";
    wireHtml = '<div class="ccr-kv"><span class="ccr-k">Receiving account</span><span class="ccr-v">' + escHtml(fallback) + "</span></div>";
  } else {
    const showAcct = _ccr.payShowSensitive.acct;
    const showRouting = _ccr.payShowSensitive.routing;

    const kvRow = (label, value) => {
      if (!value) return '';
      return '<div class="ccr-kv"><span class="ccr-k">' + escHtml(label) + '</span>' +
        '<span class="ccr-v">' + escHtml(value) + '</span></div>';
    };

    const kvRowReveal = (label, value, show, key, hasFullNumber) => {
      if (!value) return '';
      return '<div class="ccr-kv"><span class="ccr-k">' + escHtml(label) + '</span>' +
        '<span class="ccr-v">' + escHtml(value) + '</span>' +
        (hasFullNumber ? inlineReveal(show, key) : '') + '</div>';
    };

    const acctNum = a.account_number
      ? (showAcct ? a.account_number : maskStr(a.account_number, 4))
      : (a.account_number_last_four ? '····' + a.account_number_last_four : null);

    const routingNum = a.routing_number
      ? (showRouting ? a.routing_number : maskStr(a.routing_number, 4))
      : null;

    wireHtml =
      kvRow('Bank name', a.bank_name) +
      kvRow('Bank address', a.bank_address) +
      kvRow('Beneficiary', a.account_name) +
      kvRowReveal('Account number', acctNum, showAcct, 'acct', !!a.account_number) +
      kvRowReveal('Routing number', routingNum, showRouting, 'routing', !!a.routing_number) +
      kvRow('OBI / Memo', a.obi_memo);
  }

  // The allocations table is full-bleed because its cells carry their own
  // inset. These rows do not, so the inset lives on the wrapper.
  return '<div class="ccr-pad">' +
    wireHtml +
    '<div class="ccr-kv"><span class="ccr-k">Delivery</span><span class="ccr-v">' + escHtml(delivery) +
    (s.contacts && s.contacts.length
      ? "<br><span class='ccr-muted'>" +
        escHtml(s.contacts.map((c) => (c.full_name || c.email || "") + " (" + (c.type || "?") + ")").join(", ")) +
        "</span>"
      : "") + "</span></div>" +
    (s.contact_phone ? '<div class="ccr-kv"><span class="ccr-k">Wire verification</span><span class="ccr-v">' + escHtml(s.contact_phone) + "</span></div>" : "") +
    '<p class="ccr-row-note">Bank details are shown for confirmation. Your Carta team changes them ' +
    "through a separate verification, never here.</p>" +
  "</div>";
}

function ccrReviewBody() {
  const s = _ccr.summary;
  if (_ccr.loading) return '<div class="loading-row" style="padding:20px 0;">Reading the capital call…</div>';

  if (_ccr.error === "unlinked") {
    return '<div class="ccr-empty"><p>This task is not linked to a capital activity that this page can read.</p>' +
      "<p class='ccr-note'>The workflow row carries no fund and activity id the review commands accept. Open the call in Carta to review it.</p></div>";
  }
  if (_ccr.error || !s) {
    return '<div class="ccr-empty"><p>Could not read this capital call.</p>' +
      '<p class="ccr-note">' + escHtml(_ccr.error || "") + "</p></div>";
  }

  const p = s.preparation;

  return (p && p.note
    ? '<div class="ccr-note-box"><span class="ccr-note-icon">→</span><span class="ccr-note-main">' +
      '<span class="ccr-note-head">' + escHtml((p.note_author || p.prepared_by || "Your Carta team") + " left a note") +
      '<button class="ccr-note-toggle" data-ccr-note>' + (_ccr.noteOpen ? "Show less" : "Read full note") + "</button></span>" +
      '<span class="' + (_ccr.noteOpen ? "ccr-note-full" : "ccr-note-clamp") + '">' + escHtml(p.note) + "</span>" +
      "</span></div>"
    : "") +

    ccrMainTabBar() +

    '<div class="ccr-tab-pane">' +
      (_ccr.activeTab === 'overview' ? ccrOverviewTabBody(s)
        : _ccr.activeTab === 'alloc' ? ccrAllocTable(s)
        : _ccr.activeTab === 'pay' ? ccrPayBody(s)
        : ccrNoticeTabBody(s)) +
    "</div>";
}

function ccrConfirmBody() {
  const s = _ccr.summary || {};
  const ccy = s.currency;
  const n = s.participating_interests_count;
  const who = n !== null && n !== undefined ? n : "the participating";
  const steps = [
    "Posts the journal entries to " + (s.fund_name || "the fund") + ".",
    "Generates a notice PDF for each of the " + who + " participating investors.",
    "Emails all " + who + " investors" + (s.date_of_notice ? " on " + ccrDate(s.date_of_notice) : "") + ".",
    "Makes " + ccrMoney(s.total_due_to_fund, ccy) + " due from investors" +
      (s.due_date ? " on " + ccrDate(s.due_date) : "") + ".",
  ];
  return '<p class="ccr-confirm-banner">Releasing runs all of this in Carta immediately. Read it before you release.</p>' +
    '<div class="ccr-steps">' + steps.map((t, i) =>
      '<div class="ccr-step"><span class="ccr-step-n">' + (i + 1) + "</span><span>" + escHtml(t) + "</span></div>").join("") +
    "</div>" +
    "<p style='margin-top:14px;font-size:13px;line-height:20px'>Released capital calls cannot be recalled. A correction after release means a new notice to every investor.</p>";
}

function ccrFooter() {
  const s = _ccr.summary;
  const p = s && s.preparation;
  const prepared = p && p.prepared_on ? "Prepared " + ccrDate(p.prepared_on) + ". " : "";

  if (_ccr.phase === "review") {
    const blocked = !s || _ccr.error || _ccr.locked;
    return '<div class="far-panel-footer ccr-footer">' +
      '<span class="ccr-note">' + escHtml(prepared) + "Nothing has been sent to investors yet.</span>" +
      '<span class="ccr-footer-actions">' +
        '<button class="far-btn-secondary" data-ccr-phase="changes"' + (blocked ? " disabled" : "") + ">Request changes</button>" +
        '<button class="far-btn-primary" data-ccr-phase="confirm"' + (blocked ? " disabled" : "") + ">Approve and release</button>" +
      "</span></div>";
  }
  if (_ccr.phase === "confirm") {
    const n = s && s.participating_interests_count;
    return '<div class="far-panel-footer ccr-footer-end">' +
      '<button class="far-btn-secondary" data-ccr-phase="review">Back to review</button>' +
      '<button class="far-btn-primary" id="ccr-do-approve" data-ccr-approve>Release' +
      (n !== null && n !== undefined ? " and email " + n + " investors" : "") + "</button></div>";
  }
  if (_ccr.phase === "changes") {
    return '<div class="far-panel-footer ccr-footer-end">' +
      '<button class="far-btn-secondary" data-ccr-phase="review">Back to review</button>' +
      '<button class="far-btn-primary" id="ccr-send-changes" data-ccr-send>Send to Carta</button></div>';
  }
  return '<div class="far-panel-footer far-panel-footer-center">' +
    '<button class="far-btn-primary" data-ccr-close>Back to tasks</button></div>';
}

function ccrDoneBody(released) {
  const s = _ccr.summary || {};
  return '<div class="ccr-done"><div class="ccr-done-tick">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></div>' +
    '<div class="ccr-done-title">' + (released ? "Capital call released" : "Your Carta team is on it") + "</div>" +
    '<div class="ccr-done-body">' +
      (released
        ? escHtml("Journal entries are posted and the notice PDFs are generated." +
            (s.date_of_notice ? " The notices email on " + ccrDate(s.date_of_notice) + "." : ""))
        : "Nothing has been sent to investors. They pick this up, redo the work, and put it back in front of you to review.") +
    "</div>" +
    (released
      ? '<div class="ccr-note">' + escHtml(ccrMoney(s.total_due_to_fund, s.currency)) +
        " is due from investors" + (s.due_date ? " on " + escHtml(ccrDate(s.due_date)) : "") +
        ". Your Carta team tracks payments as they arrive.</div>"
      : '<div class="ccr-sent-msg">' + escHtml(_ccr.sentMessage) + "</div>") +
    '<div class="ccr-note">This task has moved to ' + (released ? "Completed" : "In progress") + ".</div></div>";
}

function ccrRender() {
  const overlay = document.getElementById("ccr-overlay");
  if (!overlay) return;
  const s = _ccr.summary;

  let body;
  if (_ccr.phase === "confirm") body = ccrConfirmBody();
  else if (_ccr.phase === "changes") {
    body = '<p class="ccr-note" style="margin-bottom:10px">Write what you want different, in your own words. ' +
      "This goes to your Carta fund admin team as written. They redo the work and send it back for review. " +
      "Nothing reaches investors.</p>" +
      '<textarea id="ccr-change-text" class="far-textarea" rows="5" placeholder="Push the due date to the 25th.">' +
      escHtml(_ccr.changeText) + "</textarea>" +
      '<p class="ccr-note" style="margin-top:8px">This task moves to In progress until it comes back to you.</p>';
  }
  else if (_ccr.phase === "released") body = ccrDoneBody(true);
  else if (_ccr.phase === "sent") body = ccrDoneBody(false);
  else body = ccrReviewBody();

  overlay.innerHTML =
    '<div class="far-panel far-panel-thread ccr-panel">' +
      '<div class="far-panel-header">' +
        '<span class="far-panel-title">' + escHtml(_ccr.title) + "</span>" +
        (s && s.fund_name ? '<span class="ccr-panel-sub">' + escHtml(s.fund_name) + "</span>" : "") +
        '<button class="far-panel-close" data-ccr-close aria-label="Close">✕</button>' +
      "</div>" +
      '<div class="far-panel-body ccr-body">' + body + "</div>" +
      ccrFooter() +
    "</div>";

  const t = document.getElementById("ccr-change-text");
  if (t) t.addEventListener("input", (e) => { _ccr.changeText = e.target.value; });
  ccrBind(overlay);
  if (_ccr.phase === "review" && _ccr.activeTab === "notice" && _ccr.docTab === "pdf" && _ccr.pdf) {
    ccrPaintPdf();
  }
}

function ccrBind(root) {
  root.querySelectorAll("[data-ccr-close]").forEach((el) =>
    el.addEventListener("click", ccrClose));
  root.querySelectorAll("[data-ccr-phase]").forEach((el) =>
    el.addEventListener("click", () => { _ccr.phase = el.getAttribute("data-ccr-phase"); ccrRender(); }));
  root.querySelectorAll("[data-ccr-main-tab]").forEach((el) =>
    el.addEventListener("click", () => {
      const prev = _ccr.activeTab;
      _ccr.activeTab = el.getAttribute("data-ccr-main-tab");
      ccrRender();
      if (_ccr.activeTab === "notice" && prev !== "notice" && !_ccr.email && !_ccr.emailError) {
        ccrLoadEmail();
      }
    }));
  root.querySelectorAll("[data-ccr-more]").forEach((el) =>
    el.addEventListener("click", () => { _ccr.showAllRows = !_ccr.showAllRows; ccrRender(); }));
  root.querySelectorAll("[data-ccr-note]").forEach((el) =>
    el.addEventListener("click", () => { _ccr.noteOpen = !_ccr.noteOpen; ccrRender(); }));
  root.querySelectorAll("[data-ccr-pay-reveal]").forEach((el) =>
    el.addEventListener("click", () => {
      const key = el.getAttribute("data-ccr-pay-reveal");
      _ccr.payShowSensitive[key] = !_ccr.payShowSensitive[key];
      ccrRender();
    }));
  root.querySelectorAll("[data-ccr-notice]").forEach((el) =>
    el.addEventListener("click", ccrOpenNotice));
  root.querySelectorAll("[data-ccr-inline-tab]").forEach((el) =>
    el.addEventListener("click", () => {
      _ccr.docTab = el.getAttribute("data-ccr-inline-tab");
      if (_ccr.docTab === "pdf") trackWorkhub("click", "CartaWorkhub.CapitalCallReview.NoticePdf");
      ccrRender();
      if (_ccr.docTab === "pdf") {
        if (!_ccr.pdf && !_ccr.pdfLoading && !_ccr.pdfError) ccrLoadPdf();
        else if (_ccr.pdf) ccrPaintPdf();
      }
    }));
  const inlineSel = root.querySelector("#ccr-inline-lp");
  if (inlineSel) inlineSel.addEventListener("change", (ev) => ccrSelectLp(Number(ev.target.value)));
  const inlineFrame = root.querySelector(".ccr-mail-frame");
  if (inlineFrame) {
    const fit = () => {
      try {
        const d = inlineFrame.contentDocument;
        const h = d && d.documentElement && d.documentElement.scrollHeight;
        if (h > 0) inlineFrame.style.height = h + "px";
      } catch (err) { /* opaque origin — CSS height stands */ }
    };
    inlineFrame.addEventListener("load", fit);
    fit();
    requestAnimationFrame(fit);
  }
  root.querySelectorAll("[data-ccr-send]").forEach((el) =>
    el.addEventListener("click", ccrSubmitChanges));
  root.querySelectorAll("[data-ccr-approve]").forEach((el) =>
    el.addEventListener("click", ccrApprove));
}

// ── Notice sub-panel ──────────────────────────────────────────────────────

function ccrOpenNotice() {
  trackWorkhub("click", "CartaWorkhub.CapitalCallReview.OpenNotice");
  _ccr.noticeOpen = true;
  ccrRenderNotice();
  ccrLoadActiveDoc();
}

// Both documents belong to the investor on screen, so switching drops them —
// pdfLoading included, or the guard below refuses to start the new render while
// the answer in flight, which ccrLoadPdf discards, never clears the flag.
function ccrSelectLp(index) {
  _ccr.lpIndex = index;
  _ccr.email = null;
  _ccr.emailError = null;
  _ccr.pdf = null;
  _ccr.pdfError = null;
  _ccr.pdfLoading = false;
  ccrRender();
  ccrRenderNotice();
  if (_ccr.activeTab === "notice") ccrLoadActiveDoc();
}

// Each tab costs a render on Carta's side, so only the visible one is fetched.
function ccrLoadActiveDoc() {
  if (_ccr.docTab === "pdf") {
    if (!_ccr.pdf && !_ccr.pdfLoading) ccrLoadPdf();
  } else if (!_ccr.email) {
    ccrLoadEmail();
  }
}

function ccrCloseNotice() {
  _ccr.noticeOpen = false;
  const o = document.getElementById("ccr-notice-overlay");
  if (o) o.classList.remove("far-overlay-visible");
}

function ccrRenderNotice() {
  if (!_ccr.noticeOpen) return;
  const overlay = farEnsureOverlay("ccr-notice-overlay", "far-overlay");
  overlay.classList.add("ccr-overlay-top");
  const s = _ccr.summary || {};
  const rows = _ccr.rows.filter((r) => r.is_participating !== false);

  const count = s.participating_interests_count !== null && s.participating_interests_count !== undefined
    ? s.participating_interests_count
    : (rows.length || null);

  const options = rows.map((r, i) =>
    '<option value="' + i + '"' + (i === _ccr.lpIndex ? " selected" : "") + ">" +
    escHtml(ccrRowLabel(r) + " — " + ccrMoney(r.commitment, s.currency) + " committed") + "</option>").join("");

  let pane;
  if (_ccr.docTab === "pdf") {
    pane = ccrNoticeDoc();
  } else if (_ccr.emailError) {
    pane = '<div class="ccr-empty"><p>This notice could not be previewed.</p><p class="ccr-note">' +
      escHtml(_ccr.emailError) + "</p></div>";
  } else if (!_ccr.email) {
    pane = '<div class="loading-row" style="padding:20px 0;">Rendering the email…</div>';
  } else {
    const e = _ccr.email;
    const label = (d) => d.name ? d.name + " <" + d.email + ">" : d.email;
    const addrs = (kind) => (e.recipients || [])
      .filter((d) => d.addr_type === kind).map(label).join(", ");

    // The body is the email's own HTML document. A scriptless iframe shows it
    // as the LP receives it and keeps it out of this page's DOM and styles.
    pane = '<div class="ccr-mail-head">' +
        '<div class="ccr-mail-subject">' + escHtml(e.subject || "") + "</div>" +
        '<div class="ccr-mail-addr">To: ' + escHtml(addrs("TO")) + "</div>" +
        '<div class="ccr-mail-addr">CC: ' + escHtml(addrs("CC")) + "</div>" +
      "</div>" +
      (e.body_format === "html"
        ? '<iframe class="ccr-mail-frame" sandbox="" title="Email preview" srcdoc="' +
          escHtml(e.body || "") + '"></iframe>'
        : '<div class="ccr-mail-body">' +
          escHtml(e.body || "").replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") + "</div>") +
      ((e.body || "").indexOf("[/LINK_CARTA]") !== -1
        ? '<div class="ccr-caveat"><span class="ccr-caveat-arrow">&#8593;</span>' +
          "<span>Preview only: the address ends in the placeholder [/LINK_CARTA] instead of a " +
          "link. Each investor's sent email carries a working link to their own capital call. " +
          "Everything else here is final.</span></div>"
        : "");
  }

  overlay.innerHTML =
    '<div class="far-panel ccr-notice-panel">' +
      '<div class="far-panel-header">' +
        '<span class="far-panel-title">What each investor receives</span>' +
        '<span class="ccr-panel-sub">' +
          escHtml(s.date_of_notice ? "Exactly as it will arrive on " + ccrDate(s.date_of_notice) : "As it will arrive") +
        "</span>" +
        '<button class="far-panel-close" data-ccr-notice-close aria-label="Close">✕</button>' +
      "</div>" +
      '<div class="ccr-notice-bar">' +
        '<select id="ccr-lp">' + options + "</select>" +
        '<span class="ccr-tabs">' +
          '<button class="ccr-tab' + (_ccr.docTab !== "pdf" ? " ccr-tab-on" : "") + '" data-ccr-tab="email">Email</button>' +
          '<button class="ccr-tab' + (_ccr.docTab === "pdf" ? " ccr-tab-on" : "") + '" data-ccr-tab="pdf">Notice PDF</button>' +
        "</span>" +
      "</div>" +
      '<div class="far-panel-body ccr-notice-body">' + pane + "</div>" +
      '<div class="far-panel-footer ccr-notice-footer">' +
        '<span class="ccr-note">' + escHtml(
          (count !== null ? count + " recipient" + (count === 1 ? "" : "s") + " · " : "") +
          "showing " + ccrRowLabel(rows[_ccr.lpIndex] || {})) + "</span>" +
        '<button class="far-btn-secondary" data-ccr-notice-close>Back to review</button>' +
      "</div>" +
    "</div>";
  overlay.classList.add("far-overlay-visible");

  // allow-same-origin lets the height be measured; without allow-scripts the
  // email's own markup still cannot execute anything. A srcdoc frame often
  // finishes loading before a listener can attach, so measure now as well.
  const frame = document.getElementById("ccr-mail-frame");
  if (frame) {
    const fit = () => {
      try {
        const d = frame.contentDocument;
        const h = d && d.documentElement && d.documentElement.scrollHeight;
        if (h > 0) frame.style.height = h + "px";
      } catch (err) { /* opaque origin — the CSS height stands */ }
    };
    frame.addEventListener("load", fit);
    fit();
    requestAnimationFrame(fit);
  }

  overlay.querySelectorAll("[data-ccr-notice-close]").forEach((el) =>
    el.addEventListener("click", ccrCloseNotice));
  overlay.querySelectorAll("[data-ccr-tab]").forEach((el) =>
    el.addEventListener("click", () => {
      _ccr.docTab = el.getAttribute("data-ccr-tab");
      if (_ccr.docTab === "pdf") trackWorkhub("click", "CartaWorkhub.CapitalCallReview.NoticePdf");
      ccrRenderNotice();
      ccrLoadActiveDoc();
    }));
  const sel = document.getElementById("ccr-lp");
  if (sel) sel.addEventListener("change", (ev) => ccrSelectLp(Number(ev.target.value)));

  if (_ccr.docTab === "pdf") ccrPaintPdf();
}


// ── Notice PDF ────────────────────────────────────────────────────────────
//
// The bytes ride inline in the response because nothing else reaches this page:
// the CSP blocks every external host, so neither the authenticated Carta link
// nor a presigned S3 URL loads, and the sandbox renders no PDF natively —
// <object>, <iframe src="data:"> and <embed src="blob:"> all show nothing. So
// pdf.js, vendored into this artifact, paints the real document to canvas. What
// the reader sees is the file itself, never a redrawing of it from figures.

async function ccrLoadPdf() {
  const row = _ccr.rows[_ccr.lpIndex];
  if (!row || !row.interest || row.interest.id == null) {
    _ccr.pdfError = "This row carries no interest id, so its notice cannot be rendered.";
    ccrRenderNotice();
    return;
  }

  if (CCR_IS_DEMO) {
    _ccr.pdfError = "PDF preview is not available in demo mode.";
    ccrRenderNotice();
    return;
  }

  _ccr.pdf = null;
  _ccr.pdfError = null;
  _ccr.pdfLoading = true;
  ccrRenderNotice();

  // Carta renders the document on every call, which is slow enough that the
  // reader can pick another investor first; that answer is no longer wanted.
  const want = _ccr.lpIndex;
  try {
    const res = await _mcp("fetch", {
      command: "fa:get:capital-activity-notice-pdf-preview",
      params: {
        fund_uuid: _ccr.target.fundUuid,
        capital_activity_id: _ccr.target.activityId,
        interest_id: row.interest.id,
      },
    });
    if (want !== _ccr.lpIndex) return;
    if (res.isError) throw new Error(res.content?.[0]?.text ?? "the notice could not be rendered");
    const p = ccrPayload(res, (c) => "data_uri" in c);
    if (!p) throw new Error("no document in the response");
    _ccr.pdf = p;
  } catch (err) {
    if (want !== _ccr.lpIndex) return;
    _ccr.pdfError = err && err.message ? err.message : "the notice could not be rendered";
  }
  _ccr.pdfLoading = false;
  ccrRender();
  ccrRenderNotice();
}

function ccrB64Bytes(b64) {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Every render rewrites the panel's innerHTML, so canvases are painted after it
// rather than in it. The token drops a paint whose panel has already moved on.
let _ccrPaintToken = 0;

async function ccrPaintPdf() {
  const host = document.getElementById("ccr-pdf-pages");
  if (!host || !_ccr.pdf || !window.pdfjsLib) return;
  const token = ++_ccrPaintToken;
  const uri = _ccr.pdf.data_uri || "";
  const width = Math.max(240, host.clientWidth || 560);

  try {
    const doc = await pdfjsLib.getDocument({ data: ccrB64Bytes(uri.slice(uri.indexOf(",") + 1)) }).promise;
    for (let n = 1; n <= doc.numPages; n++) {
      if (token !== _ccrPaintToken) return;
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // Width drives the scale, so height follows the page's own ratio and a
      // portrait page can never widen the panel.
      const vp = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
      const canvas = document.createElement("canvas");
      canvas.className = "ccr-pdf-page";
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Notice page " + n + " of " + doc.numPages);
      host.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }
  } catch (err) {
    if (token !== _ccrPaintToken) return;
    _ccr.pdfError = "The document arrived but could not be rendered: " +
      ((err && err.message) || "unknown error");
    ccrRenderNotice();
  }
}

function ccrNoticeDoc() {
  if (!window.pdfjsLib) {
    return '<div class="ccr-empty"><p>This build carries no PDF renderer, so the notice cannot be shown here.</p>' +
      '<p class="ccr-note">Open the capital call in Carta and use Preview notice. The Email tab is unaffected.</p></div>';
  }
  if (_ccr.pdfError) {
    return '<div class="ccr-empty"><p>This notice could not be rendered.</p>' +
      '<p class="ccr-note">' + escHtml(_ccr.pdfError) + "</p>" +
      '<p class="ccr-note">Carta renders the document fresh on each request, so trying again is worth a shot. ' +
      "Otherwise open the capital call in Carta and use Preview notice.</p></div>";
  }
  if (_ccr.pdfLoading || !_ccr.pdf) {
    return '<div class="loading-row" style="padding:20px 0;">Carta is rendering this investor\'s notice…</div>';
  }
  return '<div class="ccr-pdf" id="ccr-pdf-pages"></div>' +
    '<div class="ccr-caveat"><span class="ccr-caveat-arrow">&#8593;</span><span>' +
    "This is the document itself, not a redrawing of it — the same PDF this investor " +
    "receives on release." +
    "</span></div>";
}

// ── Open / close ──────────────────────────────────────────────────────────

function ccrClose() {
  ccrCloseNotice();
  const o = document.getElementById("ccr-overlay");
  if (o) o.classList.remove("far-overlay-visible");
  farFetchRequests();
}

function openCapitalCallReview(target, title) {
  trackWorkhub("click", "CartaWorkhub.CapitalCallReview.Open");
  ccrReset(target, title);
  const overlay = farEnsureOverlay("ccr-overlay", "far-overlay");
  overlay.classList.add("far-overlay-visible");
  ccrRender();
  ccrLoad();
}

// object_id on this template is the activity's ShortUUID, which is what every
// review command takes as capital_activity_id.
function ccrTargetFor(w) {
  if (!w) return null;
  const fundUuid = (w.fund && w.fund.uuid) ||
    ((w.funds || []).find(f => f && f.uuid) || {}).uuid || null;
  const activityId = w.object_id ?? null;
  if (!fundUuid || !activityId) return null;
  return { fundUuid: String(fundUuid), activityId: String(activityId) };
}

// The fund the call belongs to, for the card's second line.
function ccrFundLabel(w) {
  const named = (w.fund && w.fund.name) || ((w.funds || []).find(f => f && f.name) || {}).name;
  return String(named ?? '').trim() || null;
}

// carta-mcp filters to these too. Re-checked here so a wider list, from an
// older server or a future filter change, still cannot mis-route a card.
function ccrIsReviewTask(w) {
  if (!w || w.template !== CCR_WORKFLOW_TEMPLATE) return false;
  return (w.tasks || []).some(t =>
    t && (t.template === CCR_REVIEW_TASK || t.template === CCR_CHANGES_TASK) &&
    CCR_OPEN_TASK_STATUSES.includes(t.status));
}

// A build that names an activity gets one card for it, so the panel is
// reachable without a live review task to open it from.
function ccrWithSeedRow(rows) {
  if (!CCR_TARGET.fundUuid || !CCR_TARGET.activityId) return rows;
  if ((rows || []).some((r) => r.ccr && r.ccr.activityId === CCR_TARGET.activityId)) return rows;
  return [{
    id: "ccr-seed",
    title: CCR_CARD_TITLE,
    subtitle: _ccrFundName,
    firm: null,
    group: "todo",
    // The GP owes the decision, so the card reads as waiting on them.
    state: "pending-customer",
    canceled: false,
    needsTitle: false,
    requested: null,
    lastActivity: null,
    webUrl: null,
    ccr: { fundUuid: CCR_TARGET.fundUuid, activityId: CCR_TARGET.activityId },
  }].concat(rows || []);
}
