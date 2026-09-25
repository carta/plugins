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
  contacts: [{ full_name: "Sarah Mitchell", email: "sarah.mitchell@example.com", type: "TO" }],
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
        is_participating: true, email_notice_enabled: true, pdf_notice_enabled: true, wire_instructions_enabled: true,
        amount_buckets: [{ bucket_id: 1, amount: "2000000", inside_commitment: true }],
      },
      {
        interest: { id: 102, name: "Ridgeline Family Office", partner_interest_group_name: "Ridgeline Family Office" },
        commitment: "5200000", due_to_fund: "1225000", net_absolute_amount: "1225000",
        post_call_percent: "0.4125", post_call_percent_inside_commitment: "0.4125",
        is_participating: true, email_notice_enabled: true, pdf_notice_enabled: true, wire_instructions_enabled: true,
        amount_buckets: [{ bucket_id: 1, amount: "1225000", inside_commitment: true }],
      },
      {
        interest: { id: 103, name: "Summit Partners IV Trust", partner_interest_group_name: "Summit Partners IV Trust" },
        commitment: "3000000", due_to_fund: "705000", net_absolute_amount: "705000",
        post_call_percent: "0.3950", post_call_percent_inside_commitment: "0.3950",
        is_participating: true, email_notice_enabled: true, pdf_notice_enabled: true, wire_instructions_enabled: true,
        amount_buckets: [{ bucket_id: 1, amount: "705000", inside_commitment: true }],
      },
      {
        interest: { id: 104, name: "Thornwood Capital Group", partner_interest_group_name: "Thornwood Capital Group" },
        commitment: "2500000", due_to_fund: "590000", net_absolute_amount: "590000",
        post_call_percent: "0.4160", post_call_percent_inside_commitment: "0.4160",
        is_participating: true, email_notice_enabled: true, pdf_notice_enabled: true, wire_instructions_enabled: true,
        amount_buckets: [{ bucket_id: 1, amount: "590000", inside_commitment: true }],
      },
      {
        interest: { id: 105, name: "Elkhorn Investment Partners", partner_interest_group_name: "Elkhorn Investment Partners" },
        commitment: "1000000", due_to_fund: "230000", net_absolute_amount: "230000",
        post_call_percent: "0.3800", post_call_percent_inside_commitment: "0.3800",
        is_participating: true, email_notice_enabled: true, pdf_notice_enabled: true, wire_instructions_enabled: true,
        amount_buckets: [{ bucket_id: 1, amount: "230000", inside_commitment: true }],
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

// The workflow row does not say whether the activity is a call or a
// distribution, so the card stays neutral until the summary names it.
const CCR_CARD_TITLE = "Capital activity — review and release";

const CCR_PAGE_SIZE = 12;   // carta-mcp's cap, measured against its 40k budget
const CCR_MAX_PAGES = 40;

// Health checks usually refuse within this time, so a refusal is not shown as a
// release in progress first.
const CCR_RELEASE_ACK_MS = 4000;

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
    showDetail: false,
    delivery: { filter: "all", q: "", sort: null, dir: 1 },
    lpIndex: 0,
    // The notice PDF opens first; the email stands in where no PDF can be
    // rendered (no bundled viewer, or demo mode).
    docTab: typeof window !== "undefined" && window.pdfjsLib && !CCR_IS_DEMO ? "pdf" : "email",
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
    // The fresh health-check run, requested alongside the summary.
    health: { loading: true, error: null, checks: [] },
    // The approver's own confirmations, ticked in the release step.
    consent: { call: false, payment: false, limit: false },
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

const ccrIsDistribution = (s) => !!s && s.activity_type === "distribution";

function ccrPanelTitle(s) {
  if (!s) return _ccr.title;
  return ccrIsDistribution(s) ? "Distribution — review and release" : "Capital call — review and release";
}

// Column order and labels come from the summary's bucket_totals, which names
// every bucket on the activity; a row lists only the buckets it moves.
function ccrBucketColumns(s) {
  const live = (s.bucket_totals || []).filter((b) => {
    const n = ccrNum(b.total);
    return n !== null && n !== 0;
  });
  return { main: live.filter((b) => !b.is_adjustment), adjustments: live.filter((b) => b.is_adjustment) };
}

// Column headers for the shared default buckets, keyed by slug. A default's
// display name is its canonical key, so this only shortens; a fund's own
// bucket keeps its display name.
const CCR_BUCKET_HEADERS = {
  contribution: "Contribution",
  contribution_management_fees: "Mgmt fees",
  contribution_management_fees_offset: "Mgmt fee offset",
  contribution_management_fees_waiver: "Mgmt fee waiver",
  contribution_management_fees_outside_commitment: "Mgmt fees outside commitment",
  contribution_outside_commitment: "Outside commitment",
  contribution_expenses: "Expenses",
  contribution_investments: "Investments",
  contribution_adjustments: "Adjustments",
  contribution_org_costs: "Org. costs",
  contribution_placement_agent_fees: "Placement agent fees",
  contribution_rolled: "Rolled",
  prepaid_contributions_applied: "Prepaid applied",
  outstanding_balances_applied: "Outstanding applied",
  distribution_payables_applied: "Dist. payables applied",
  subsequent_close_interest_due: "Sub-close interest",
  late_admission_fees_due: "Late admission fees",
  distribution: "Distribution",
  distribution_income: "Income",
  distribution_gain: "Gain",
  distribution_roc: "Return of capital",
  distribution_recallable: "Recallable",
  distribution_tax_withholding: "Tax withholding",
  distribution_gp_cash_carry: "GP cash carry",
  distribution_lp_carried_interest: "LP carried interest",
};

function ccrBucketHeader(b) {
  return (b.is_default && CCR_BUCKET_HEADERS[b.slug]) || b.display_name || b.slug || "Bucket";
}

// An adjustment moves what is owed without moving the call, so it reads with
// the sign of that movement: a credit applied is a reduction.
function ccrAdjSign(b) {
  return b.impact_on_owed === "decrease" ? -1 : 1;
}

function ccrSignedMoney(v, ccy, sign) {
  const n = ccrNum(v);
  if (n === null || n === 0) return "\u2014";
  const txt = ccrMoney(Math.abs(n), ccy);
  return (sign < 0 ? "\u2212" : "+") + txt;
}

// ── Release blockers ──────────────────────────────────────────────────────
// The states in which the web app disables approve; "Request changes" stays open.

// null + needed is the web app's "Bank account required"; closed is "Active
// bank account required"; a capital call has neither.
function ccrPayingFromState(s) {
  const account = s.paying_from_account;
  if (account) return { kind: account.is_active === false ? "closed" : "ok", account: account };
  return { kind: s.needs_distribution_paying_from_account ? "missing" : "none", account: null };
}

// What holds Approve and release, in the web app's words. The footer shows
// each entry beside the disabled button.
// Only Carta can name or change the account a distribution pays from, so both
// paying-from gaps route to Request changes rather than to a picker this page cannot offer.
function ccrBlockers(s) {
  const out = [];
  if (!s) return out;
  const paying = ccrPayingFromState(s).kind;
  if (paying === "missing") {
    out.push({
      key: "paying-from",
      text: "No paying-from bank account is named on this distribution. Ask your Carta team to add one with Request changes.",
    });
  } else if (paying === "closed") {
    out.push({
      key: "paying-from",
      text: "The paying-from bank account on this distribution is closed. Ask your Carta team to select another with Request changes.",
    });
  }
  // An AMM distribution is reviewed in Carta: choosing who is paid and
  // authorizing the payment are not offered here, so neither decision is.
  if (s.is_amm_distribution) {
    out.push({
      key: "amm",
      locks: true,
      text: "This distribution pays through Automated Money Movement and is reviewed in Carta. Open it there to choose who is paid, authorize the payment and release, or to request changes.",
    });
  }
  const h = ccrHealth();
  const event = ccrIsDistribution(s) ? "distribution" : "capital call";
  if (h.verdict === "blocking") {
    out.push({
      key: "health-checks",
      text: "Cannot send out this " + event + " due to failed blocking health checks" +
        (h.cartaOnly.length ? "; some of them only Carta can fix" : "") + ".",
    });
  } else if (h.verdict === "running") {
    out.push({ key: "health-checks", text: "Health checks are running." });
  } else if (h.verdict === "unknown") {
    out.push({
      key: "health-checks",
      text: "Health checks could not be run from here. Open the " + event + " in Carta to run them before releasing.",
    });
  }
  return out;
}

// The run, read the way the web app's approve gate reads it: a failing
// blocking check refuses release; a failing advisory one is shown and passed.
// A state that never requested a run (no health key at all) has nothing to
// say and holds nothing; only a run that is pending or failed does.
function ccrHealth() {
  const h = _ccr.health;
  if (!h) {
    return { loading: false, error: null, checks: [], failing: [], blocking: [], advisory: [],
             cartaOnly: [], passing: 0, verdict: "none" };
  }
  const checks = h.checks || [];
  const failing = checks.filter((c) => c.is_success === false);
  const blocking = failing.filter((c) => c.is_blocking);
  const advisory = failing.filter((c) => !c.is_blocking);
  return {
    loading: h.loading, error: h.error, checks: checks, failing: failing, blocking: blocking, advisory: advisory,
    cartaOnly: blocking.filter((c) => c.is_second_party_resolvable === false),
    passing: checks.length - failing.length,
    verdict: h.loading ? "running" : h.error ? "unknown"
      : blocking.length ? "blocking" : advisory.length ? "warnings" : "passing",
  };
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
    snap.health = { loading: false, error: null, checks: [] };
    if (!_ccrFundName) _ccrFundName = CCR_DEMO_SUMMARY.fund_name;
    ccrRender();
    renderFarSection();
    if (snap.activeTab === 'notice') ccrLoadActiveDoc();
    return;
  }

  try {
    const params = { fund_uuid: t.fundUuid, capital_activity_id: t.activityId };

    // The web app runs every check as its review page opens; so does this.
    // Not awaited: the summary must not wait on a run that can take a while.
    ccrLoadHealth(snap, params);

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
    // The summary's own link is the web app's page for this draft; the one
    // built from the workflow row only stands in until the summary answers.
    if (summary._links && summary._links.web_url) t.webUrl = summary._links.web_url;
    snap.rows = (summary.rows && summary.rows.results) || [];
    snap.loading = false;
    ccrRender();
    if (snap.activeTab === 'notice') ccrLoadActiveDoc();

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

async function ccrLoadHealth(snap, params) {
  try {
    const res = await _mcp("fetch", {
      command: "fa:get:capital-activity-health-check",
      params: Object.assign({ include_passing: true }, params),
    });
    if (_ccr !== snap) return;
    if (res.isError) throw new Error(res.content?.[0]?.text ?? "health checks failed");
    const page = ccrPayload(res, (c) => Array.isArray(c.results));
    if (!page) throw new Error("Carta answered, but not with health checks");
    snap.health = { loading: false, error: null, checks: page.results };
  } catch (err) {
    if (_ccr !== snap) return;
    console.error("[ccr] health checks failed —", err);
    snap.health = { loading: false, error: err && err.message ? err.message : "health checks failed", checks: [] };
  }
  ccrRender();
}

// Carta renders each document fresh on every call, so one render per activity and
// investor serves the page for its whole life. The promise is what is kept: a second
// ask while the first is in flight waits on it, and an answer that lands after the
// reader moved on is still there when they come back. A failure is dropped so the
// next ask retries. Memory only — a write clears the activity's entries, and a new
// page load starts clean, so a revised draft is never shown from an old render.
const _ccrDocCache = new Map();

function ccrDocKey(kind, activityId, id) {
  return kind + ":" + activityId + ":" + id;
}

// The resolved value, for render paths that must not flash a loading state.
function ccrDocHit(kind, activityId, id) {
  const e = _ccrDocCache.get(ccrDocKey(kind, activityId, id));
  return e && e.done ? e.value : null;
}

function ccrCachedDoc(kind, activityId, id, load) {
  const key = ccrDocKey(kind, activityId, id);
  const hit = _ccrDocCache.get(key);
  if (hit) return hit.promise;
  const entry = { done: false, value: null, promise: null };
  entry.promise = load().then(
    (value) => { entry.done = true; entry.value = value; return value; },
    (err) => { _ccrDocCache.delete(key); throw err; },
  );
  _ccrDocCache.set(key, entry);
  return entry.promise;
}

function ccrForgetDocs(activityId) {
  const mark = ":" + activityId + ":";
  for (const key of Array.from(_ccrDocCache.keys())) {
    if (key.includes(mark)) _ccrDocCache.delete(key);
  }
}

async function ccrFetchEmail(target, partnerId) {
  const res = await _mcp("fetch", {
    command: "fa:get:capital-activity-partner-email-preview",
    params: {
      fund_uuid: target.fundUuid,
      capital_activity_id: target.activityId,
      partner_id: partnerId,
      body_format: "html",
    },
  });
  let p = res.isError ? null : ccrPayload(res, (c) => "subject" in c || "body" in c);
  if (!p) {
    // The command's own oversize hint: markup can exceed the response budget.
    const alt = await _mcp("fetch", {
      command: "fa:get:capital-activity-partner-email-preview",
      params: {
        fund_uuid: target.fundUuid,
        capital_activity_id: target.activityId,
        partner_id: partnerId,
        body_format: "text",
      },
    });
    if (alt.isError) throw new Error(alt.content?.[0]?.text ?? "preview failed");
    p = ccrPayload(alt, (c) => "subject" in c || "body" in c);
  }
  if (!p) throw new Error("no preview in the response");
  return p;
}

async function ccrFetchPdf(target, interestId) {
  const res = await _mcp("fetch", {
    command: "fa:get:capital-activity-notice-pdf-preview",
    params: {
      fund_uuid: target.fundUuid,
      capital_activity_id: target.activityId,
      interest_id: interestId,
    },
  });
  if (res.isError) throw new Error(res.content?.[0]?.text ?? "the notice could not be rendered");
  const p = ccrPayload(res, (c) => "data_uri" in c);
  if (!p) throw new Error("no document in the response");
  return p;
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

  snap.emailError = null;

  if (CCR_IS_DEMO) {
    snap.email = ccrDemoEmail(row);
    ccrRenderNotice();
    return;
  }

  const partnerId = row.interest.id;
  snap.email = ccrDocHit("email", snap.target.activityId, partnerId);
  if (snap.email) {
    ccrRender();
    ccrRenderNotice();
    return;
  }
  ccrRenderNotice();

  // The investor on screen can change while this renders; the cache keeps the answer
  // either way, so only its display is dropped.
  const want = snap.lpIndex;
  try {
    const p = await ccrCachedDoc("email", snap.target.activityId, partnerId,
      () => ccrFetchEmail(snap.target, partnerId));
    if (_ccr !== snap || want !== snap.lpIndex) return;
    snap.email = p;
  } catch (err) {
    if (_ccr !== snap || want !== snap.lpIndex) return;
    snap.emailError = err && err.message ? err.message : "preview failed";
  }
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
    ccrForgetDocs(_ccr.target.activityId);
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

// A refusal names the health check that stopped the release. Long text is a stack
// trace or a wall of detail, which a toast cannot carry.
function ccrErrText(res) {
  const t = res && res.content && res.content[0] && res.content[0].text;
  return typeof t === "string" && t.length <= 240 ? t : "";
}

function ccrApprove() {
  const snap = _ccr;
  const btn = document.getElementById("ccr-do-approve");
  if (btn) { btn.disabled = true; btn.textContent = "Releasing…"; }
  trackWorkhub("click", "CartaWorkhub.CapitalCallReview.Release");

  if (CCR_IS_DEMO) {
    snap.phase = "released";
    ccrRender();
    return;
  }

  const params = {
    fund_uuid: snap.target.fundUuid,
    capital_activity_id: snap.target.activityId,
  };
  // The consent is the approver's authorization, so it is passed only as
  // ticked, and only where there is one to record: a plain call's account
  // confirmation is a gate on this page, not a consent the backend keeps.
  if (snap.consent.call && snap.summary && snap.summary.uses_fbo_contributions) params.amm_consent = true;
  _mcp("mutate", { command: "fa:mutate:approve-capital-activity", params: params }).then(
    (res) => ccrReleaseAnswered(snap, res, null),
    (err) => ccrReleaseAnswered(snap, null, err),
  );

  // Still on the confirm step means no reply yet: show the release as under way.
  setTimeout(() => {
    if (_ccr !== snap || snap.phase !== "confirm") return;
    snap.phase = "releasing";
    ccrRender();
    farFetchRequests();
  }, CCR_RELEASE_ACK_MS);
}

// Runs whenever the reply lands — before the panel gave up waiting, or well after.
function ccrReleaseAnswered(snap, res, err) {
  if (_ccr !== snap) return;

  if (err) {
    // No verdict reached us, so the release may still have run. Send the reviewer to
    // Carta rather than inviting a second press.
    console.error("[ccr] release did not confirm —", err);
    snap.phase = "review";
    // Not snap.error: that doubles as the body's message and would replace the call
    // the reviewer now has to go and check.
    snap.locked = true;
    ccrRender();
    showToast("Release did not confirm. Check the call in Carta before trying again.");
    return;
  }

  if (res && res.isError) {
    // Release runs its blocking health checks first and sends nothing when one fails,
    // so a refusal leaves the call as it was. Keep the panel usable.
    console.error("[ccr] release refused —", res);
    snap.phase = "review";
    ccrRender();
    showToast(ccrErrText(res) || "Carta did not release this call. Nothing was sent to investors.");
    return;
  }

  ccrForgetDocs(snap.target.activityId);
  snap.phase = "released";
  ccrRender();
  farFetchRequests();
}

// ── Render ────────────────────────────────────────────────────────────────

function ccrMainTabBar() {
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'notice', label: 'Notice' },
    { id: 'settings', label: 'Delivery' },
    { id: 'alloc', label: 'Allocations' },
    { id: 'pay', label: 'Payment information' },
  ];
  return '<div class="ccr-main-tabs">' +
    tabs.map((t) =>
      '<button class="ccr-main-tab' + (_ccr.activeTab === t.id ? ' ccr-main-tab-on' : '') +
      '" data-ccr-main-tab="' + t.id + '">' + t.label + '</button>').join('') +
  '</div>';
}

// Health checks run for everyone and gate release, but their roster is staff
// detail the web app hides from GPs. A GP sees only a failure Carta must fix.
function ccrCartaOnlyCallout(s) {
  const h = ccrHealth();
  if (!h.cartaOnly.length) return "";
  const event = ccrIsDistribution(s) ? "distribution" : "capital call";
  const titles = h.cartaOnly.map((c) => c.title || c.code).filter(Boolean);
  return ccrCallout("bad", "This " + event + " requires Carta's support",
    "A blocking check only Carta can clear has failed" +
    (titles.length ? ": " + titles.join("; ") : "") +
    ". Use Request changes to send it back to your Carta team; it cannot be released until they fix it.");
}

// How the cash leaves. is_amm_distribution is the gate the web app enforces,
// so it decides the label even where the fund's strategy says otherwise.
function ccrPaymentMethodRow(s) {
  if (!s.pays_investors_in_cash) return "";
  const amm = !!s.is_amm_distribution;
  return '<div class="ccr-kv"><span class="ccr-k">Payment method</span><span class="ccr-v">' +
    '<span class="ccr-strong">' + (amm ? "Automated Money Movement" : "Manual wires") + '</span><br>' +
    '<span class="ccr-muted">' + (amm
      ? "Carta wires each investor from the paying-from account on release."
      : "Your fund sends each wire from the paying-from account after release.") +
    '</span></span></div>';
}

// The web app's "Investor Distribution Summary" header: what can go out, to how
// many, and who is holding the rest up. Folded server-side, so it is exact.
function ccrReadinessCard(s) {
  const r = s.distribution_readiness;
  if (!r) return "";
  const ccy = s.currency;
  const count = (v) => (v === null || v === undefined ? "—" : String(v));
  const holds = [];
  if (r.missing_wire_count) holds.push(count(r.missing_wire_count) + " missing wire instructions");
  if (r.incomplete_wire_count) holds.push(count(r.incomplete_wire_count) + " with incomplete instructions");
  const path = s.is_amm_distribution
    ? "You choose who is paid when you approve it in Carta. Investors with confirmed wire instructions start selected; " +
      "instructions that are unconfirmed or over a year old can be added; missing or incomplete ones cannot be paid."
    : "Release goes ahead with the investors on hold left unpaid; your fund pays them once their details are in.";

  return '<div class="ccr-card">' +
    '<div class="ccr-card-label">Ready for transfer</div>' +
    '<div class="ccr-card-figure">' + escHtml(ccrMoney(r.ready_for_transfer_amount, ccy)) + '</div>' +
    '<div class="ccr-card-sub">' + escHtml(count(r.receiving_count) + " of " + count(r.unpaid_count) +
      " unpaid investors receiving payment") + '</div>' +
    '<div class="ccr-card-list">' +
      '<div class="ccr-kv"><span class="ccr-k">On hold</span><span class="ccr-v">' +
        (r.on_hold_count
          ? '<span class="ccr-strong">' + escHtml(count(r.on_hold_count) + " investors") + '</span><br>' +
            '<span class="ccr-muted">' + escHtml(holds.join(", ")) +
            ". Investors missing wire instructions will not receive a distribution until details are provided.</span>"
          : '<span class="ccr-muted">None. Every unpaid investor has wire instructions release can use.</span>') +
        '</span></div>' +
      '<div class="ccr-kv"><span class="ccr-k">How it pays</span><span class="ccr-v">' +
        '<span class="ccr-muted">' + escHtml(path) + '</span></span></div>' +
      (r.over_a_year_old_count
        ? '<div class="ccr-kv"><span class="ccr-k">Worth a second look</span><span class="ccr-v">' +
          '<span class="ccr-strong">' + escHtml(count(r.over_a_year_old_count) + " receiving") + '</span><br>' +
          '<span class="ccr-muted">Wire instructions added or confirmed more than a year ago. Usable, ' +
          'but worth confirming before a large wire.</span></span></div>'
        : '') +
      (r.manual_wire_count
        ? '<div class="ccr-kv"><span class="ccr-k">Manual wires</span><span class="ccr-v">' +
          '<span class="ccr-strong">' + escHtml(count(r.manual_wire_count)) + '</span><br>' +
          '<span class="ccr-muted">International wires to some bank countries will be processed manually ' +
          'via your bank portal.</span></span></div>'
        : '') +
    '</div>' +
  '</div>';
}

function ccrOverviewTabBody(s) {
  const ccy = s.currency;
  const dist = ccrIsDistribution(s);
  const headline = dist
    ? (ccrNum(s.net_distribution_amount) !== null ? s.net_distribution_amount : s.total_due_to_investor)
    : (ccrNum(s.gross_call_amount) !== null ? s.gross_call_amount : s.total_due_to_fund);
  const postPct = dist ? s.total_post_distribution_percent
    : ccrPick(s, "total_post_call_percent_inside_commitment", "total_post_call_percent");
  const postAmt = dist ? s.total_post_distribution_amount
    : ccrPick(s, "total_post_call_amount_inside_commitment", "total_post_call_amount");
  const ratio = ccrNum(postPct);
  const cols = ccrBucketColumns(s);
  const buckets = cols.main;
  const adj = cols.adjustments;

  return '<div class="ccr-card">' +
    '<div class="ccr-card-label">' + (dist ? "Total being distributed" : "Total being called") + '</div>' +
    '<div class="ccr-card-figure">' + escHtml(ccrMoney(headline, ccy)) + '</div>' +
    '<div class="ccr-card-list">' +
      '<div class="ccr-kv"><span class="ccr-k">' + (dist ? "Paid to investors" : "Due from investors") + '</span>' +
        '<span class="ccr-v ccr-strong">' + escHtml(ccrDate(s.due_date)) + '</span>' +
        '<span class="ccr-aside">' + escHtml(ccrDaysUntil(s.due_date)) + '</span></div>' +
      ccrNoticeDateRow(s) +
      ccrPaymentMethodRow(s) +
      '<div class="ccr-kv"><span class="ccr-k">' + (dist ? "Distributed as" : "Called for") + '</span><span class="ccr-v">' +
        (buckets.length
          ? buckets.map((b) => '<span class="ccr-split"><span>' + escHtml(b.display_name || b.slug || "Bucket") +
              '</span><span>' + escHtml(ccrMoney(b.total, ccy)) + '</span></span>').join('')
          : 'No buckets on this activity') +
        '</span></div>' +
      (adj.length
        ? '<div class="ccr-kv"><span class="ccr-k">Adjustments</span><span class="ccr-v">' +
          adj.map((b) => '<span class="ccr-split"><span>' + escHtml(b.display_name || b.slug || "Adjustment") +
            '</span><span class="ccr-adj">' + escHtml(ccrSignedMoney(b.total, ccy, ccrAdjSign(b))) + '</span></span>').join('') +
          '</span></div>' +
          '<div class="ccr-kv"><span class="ccr-k">' + (dist ? "Net paid to investors" : "Net due from investors") + '</span>' +
          '<span class="ccr-v ccr-strong">' + escHtml(ccrMoney(dist ? s.total_due_to_investor : s.total_due_to_fund, ccy)) + '</span></div>'
        : '') +
      '<div class="ccr-kv"><span class="ccr-k">' + (dist ? "Distributed after this" : "Called after this call") + '</span><span class="ccr-v">' +
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
  '</div>' +
  ccrReadinessCard(s);
}

function ccrNoticeDateRow(s) {
  return '<div class="ccr-kv"><span class="ccr-k">Notice to investors</span>' +
    '<span class="ccr-v ccr-strong">' + escHtml(ccrDate(s.date_of_notice)) + '</span>' +
    '<span class="ccr-aside">' + escHtml(ccrDaysUntil(s.date_of_notice)) + '</span></div>';
}

// ── Email settings ────────────────────────────────────────────────────────
// The "{Event} Details" settings that decide how the notice reaches investors.
// They apply to every investor on the activity, so they sit on the Delivery
// tab rather than in the per-investor preview. A setting the backend did not
// serve (an older deploy) is left out.

function ccrSettingRow(label, value, note) {
  return '<div class="ccr-kv"><span class="ccr-k">' + escHtml(label) + "</span>" +
    '<span class="ccr-v"><span class="ccr-strong">' + escHtml(value) + "</span>" +
    '<span class="ccr-note ccr-kv-note">' + escHtml(note) + "</span></span></div>";
}

function ccrSettingsRows(s) {
  const rows = [];
  if ("investor_login_required" in s) {
    // The notice code treats an unset value as No, so the row does too.
    rows.push(s.investor_login_required === true
      ? ccrSettingRow("Log in required", "Yes", "Investors open the notice through a Carta log-in.")
      : ccrSettingRow("Log in required", "No", "Investors get a direct link to the notice PDF; no Carta log-in needed."));
  }
  if ("cc_on_primary_contact_only" in s) {
    rows.push(s.cc_on_primary_contact_only === true
      ? ccrSettingRow("CC contacts", "Primary contacts only", "CC contacts are copied only on emails to each investor's primary contact.")
      : ccrSettingRow("CC contacts", "Every notice email", "CC contacts are copied on every notice email, including those to secondary contacts."));
  }
  if ("display_secondary_contacts_on_primary_email" in s) {
    rows.push(s.display_secondary_contacts_on_primary_email === true
      ? ccrSettingRow("Secondary contacts", "Listed in primary emails", "Primary contacts' emails list the other contacts who were notified.")
      : ccrSettingRow("Secondary contacts", "Not listed", "Primary contacts' emails do not list the other contacts who were notified."));
  }
  return rows;
}

// ── Delivery ──────────────────────────────────────────────────────────────
// How each participating investor is told: the web app's per-row Email
// notifications, PDF and Attach wire details toggles. The summary line reads
// notice_delivery, which counts every investor; the table reads the rows the
// panel has walked, the same list Allocations shows.

const CCR_DELIVERY_GROUPS = [
  { id: "emailpdf", email: true, pdf: true, label: "email with PDF" },
  { id: "email", email: true, pdf: false, label: "email only" },
  { id: "pdf", email: false, pdf: true, label: "PDF only" },
  { id: "none", email: false, pdf: false, label: "no notice" },
];

// Release treats an unset email or PDF toggle as on, but the notice carries
// wire details only when that toggle is true, so an unset one is off.
const ccrEmailOn = (r) => r.email_notice_enabled !== false;
const ccrPdfOn = (r) => r.pdf_notice_enabled !== false;
const ccrWireOn = (r) => r.wire_instructions_enabled === true;

const ccrDeliveryGroup = (email, pdf) =>
  CCR_DELIVERY_GROUPS.find((g) => g.email === !!email && g.pdf === !!pdf);

const CCR_DELIVERY_COLS = [
  { id: "name", label: "Investor" },
  { id: "email", label: "Email notifications", on: ccrEmailOn },
  { id: "pdf", label: "PDF", on: ccrPdfOn },
  { id: "wire", label: "Attach wire details", on: ccrWireOn },
];

function ccrDeliveryState() {
  if (!_ccr.delivery) _ccr.delivery = { filter: "all", q: "", sort: null, dir: 1 };
  return _ccr.delivery;
}

function ccrDeliverySummary(s) {
  const d = ccrDeliveryState();
  const groups = s.notice_delivery || [];
  if (!groups.length) return "No delivery detail";
  return groups.map((g) => {
    const n = g.count === null || g.count === undefined ? "—" : g.count;
    const grp = ccrDeliveryGroup(g.email_notice_enabled, g.pdf_notice_enabled);
    return '<button class="ccr-dlv-seg' + (d.filter === grp.id ? " ccr-dlv-seg-on" : "") +
      '" data-ccr-dlv-filter="' + grp.id + '">' + escHtml(n + " " + grp.label) + "</button>";
  }).join('<span class="ccr-dlv-dot">·</span>');
}

function ccrDeliveryRows() {
  const d = ccrDeliveryState();
  const q = d.q.trim().toLowerCase();
  const rows = _ccr.rows.filter((r) => r.is_participating !== false)
    .filter((r) => {
      if (d.filter === "all") return true;
      if (d.filter === "nowire") return !ccrWireOn(r);
      return ccrDeliveryGroup(ccrEmailOn(r), ccrPdfOn(r)).id === d.filter;
    })
    .filter((r) => !q || ccrRowLabel(r).toLowerCase().includes(q));
  const byName = (a, b) => ccrRowLabel(a).localeCompare(ccrRowLabel(b));
  const col = CCR_DELIVERY_COLS.find((c) => c.id === d.sort);
  if (!col) return rows.sort((a, b) => (ccrNum(b.commitment) || 0) - (ccrNum(a.commitment) || 0));
  if (col.id === "name") return rows.sort((a, b) => d.dir * byName(a, b));
  // A toggle column puts Off first on its first click.
  return rows.sort((a, b) => d.dir * (Number(col.on(a)) - Number(col.on(b))) || byName(a, b));
}

function ccrDeliveryTable(s) {
  const d = ccrDeliveryState();
  const participating = _ccr.rows.filter((r) => r.is_participating !== false);
  const partCount = s.participating_interests_count !== null && s.participating_interests_count !== undefined
    ? s.participating_interests_count
    : (_ccr.rowsDone ? participating.length : null);
  const short = _ccr.rowsDone && partCount !== null && participating.length < partCount;

  const chip = (id, label, count) =>
    '<button class="ccr-dlv-chip' + (d.filter === id ? " ccr-dlv-chip-on" : "") + '" data-ccr-dlv-filter="' + id + '">' +
    escHtml(label) + (count === null ? "" : "<b>" + count + "</b>") + "</button>";
  const chips = [chip("all", "All", partCount)].concat((s.notice_delivery || []).map((g) => {
    const grp = ccrDeliveryGroup(g.email_notice_enabled, g.pdf_notice_enabled);
    return chip(grp.id, grp.label.charAt(0).toUpperCase() + grp.label.slice(1), g.count === undefined ? null : g.count);
  }));
  // The summary has no wire count, so the chip waits for every row.
  const noWire = _ccr.rowsDone && !short ? participating.filter((r) => !ccrWireOn(r)).length : 0;
  if (noWire) chips.push(chip("nowire", "No wire details", noWire));

  const head = CCR_DELIVERY_COLS.map((c) => {
    const on = d.sort === c.id;
    return '<th class="' + (c.on ? "ccr-dlv-toggle" : "") + '"><button class="ccr-dlv-sort' + (on ? " ccr-dlv-sort-on" : "") +
      '" data-ccr-dlv-sort="' + c.id + '">' + escHtml(c.label) +
      '<span class="ccr-dlv-arrow">' + (on ? (d.dir > 0 ? "▲" : "▼") : "") + "</span></button></th>";
  }).join("");

  const rows = ccrDeliveryRows();
  const pill = (on) => on
    ? '<span class="ccr-pill ccr-pill-ok">On</span>'
    : '<span class="ccr-pill ccr-pill-off">Off</span>';
  let body;
  if (rows.length) {
    body = rows.map((r) =>
      "<tr><td>" + escHtml(ccrRowLabel(r)) + "</td>" +
      CCR_DELIVERY_COLS.filter((c) => c.on).map((c) => '<td class="ccr-dlv-toggle">' + pill(c.on(r)) + "</td>").join("") +
      "</tr>").join("");
  } else {
    const why = !participating.length && !_ccr.rowsDone ? "Loading investors…"
      : d.q.trim() ? 'No investors match "' + d.q.trim() + '".'
      : !_ccr.rowsDone ? "None of the investors loaded so far are in this group."
      : "No investors in this group.";
    body = '<tr><td colspan="' + CCR_DELIVERY_COLS.length + '" class="ccr-dlv-empty">' + escHtml(why) + "</td></tr>";
  }

  const narrowed = d.filter !== "all" || d.q.trim() || !_ccr.rowsDone || short;
  const count = partCount === null ? rows.length + " participating"
    : narrowed ? "Showing " + rows.length + " of " + partCount + " participating"
    : partCount + " participating";

  return '<div class="ccr-dlv-controls"><div class="ccr-dlv-chips">' + chips.join("") + "</div>" +
      '<input class="ccr-dlv-search" id="ccr-dlv-search" type="search" placeholder="Find an investor" aria-label="Find an investor" value="' +
      escHtml(d.q) + '"></div>' +
    '<div class="ccr-dlv-box"><table class="ccr-table ccr-dlv-table"><thead><tr>' + head + "</tr></thead><tbody>" + body +
      "</tbody></table></div>" +
    '<div class="ccr-dlv-foot"><span>' + escHtml(count) +
      (d.sort ? ' · <button class="ccr-dlv-seg" data-ccr-dlv-sort="reset">Reset</button>' : "") + "</span>" +
      "<span>" + (_ccr.rowsDone ? "To change a setting, use Request changes." : "Loading the rest…") + "</span></div>" +
    (short
      ? '<p class="ccr-note">Only ' + participating.length + " of " + partCount +
        " participating investors loaded. Open the call in Carta for the rest.</p>"
      : "");
}

// The Delivery tab: each investor's toggles, then the settings that apply to
// every notice email. Always shown, since every activity has investors.
function ccrSettingsTabBody(s) {
  const rows = ccrSettingsRows(s);
  return '<div class="ccr-dlv-head"><span class="ccr-dlv-title">Delivery</span>' +
      '<span class="ccr-dlv-summary">' + ccrDeliverySummary(s) + "</span></div>" +
    ccrDeliveryTable(s) +
    '<div class="ccr-dlv-head ccr-dlv-head-next"><span class="ccr-dlv-title">Email settings</span>' +
      '<span class="ccr-dlv-summary">Apply to every investor</span></div>' +
    (rows.length
      ? '<div class="ccr-card"><div class="ccr-card-list">' + rows.join("") + "</div></div>"
      : '<div class="ccr-empty"><p>Carta did not serve the email settings for this call.</p></div>');
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
    emailPane = '<div class="ccr-empty"><p>This email could not be previewed.</p>' +
      '<p class="ccr-note">' + escHtml(_ccr.emailError) + '</p></div>';
  } else if (!_ccr.email) {
    emailPane = '<div class="loading-row" style="padding:16px 0;">Rendering the email…</div>';
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
    (window.pdfjsLib
      ? '<button class="ccr-tab' + (_ccr.docTab === 'pdf' ? ' ccr-tab-on' : '') + '" data-ccr-inline-tab="pdf">PDF</button>'
      : '') +
    '<button class="ccr-tab' + (_ccr.docTab !== 'pdf' ? ' ccr-tab-on' : '') + '" data-ccr-inline-tab="email">Email</button>' +
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
  const isDist = s.activity_type === "distribution";
  const netLabel = isDist ? "Net distribution" : "Net contribution";
  const afterLabel = isDist ? "Distributed after" : "Called after";
  const rows = _ccr.rows.filter((r) => r.is_participating !== false);
  const excluded = _ccr.rows.filter((r) => r.is_participating === false);
  rows.sort((a, b) => (ccrNum(b.commitment) || 0) - (ccrNum(a.commitment) || 0));
  const shown = _ccr.showAllRows ? rows : rows.slice(0, 5);
  const ccy = s.currency;

  const cols = ccrBucketColumns(s);
  // The net is the whole story when one bucket makes it up. Anything more —
  // a second bucket or an adjustment — earns the breakdown toggle.
  const composed = cols.main.length > 1 || cols.adjustments.length > 0;
  const breakdown = composed && _ccr.showDetail;
  const buckets = breakdown ? cols.main.concat(cols.adjustments) : [];
  const pinL = breakdown ? " ccr-pin-l" : "";
  const pinN = breakdown ? " ccr-pin-net" : "";
  const pinA = breakdown ? " ccr-pin-after" : "";

  const head = (breakdown ? ["Investor"] : ["Investor", "Commitment"])
    .concat(buckets.map((b) => ccrBucketHeader(b)))
    .concat([netLabel, afterLabel]);

  const bucketCell = (amount, b) => {
    if (ccrNum(amount) === null) return '<td class="ccr-faint">\u2014</td>';
    return b.is_adjustment
      ? '<td class="ccr-adj">' + escHtml(ccrSignedMoney(amount, ccy, ccrAdjSign(b))) + "</td>"
      : "<td>" + escHtml(ccrMoney(amount, ccy)) + "</td>";
  };
  const rowCell = (r, b) => {
    const hit = (r.amount_buckets || []).find((ab) => String(ab.bucket_id) === String(b.bucket_id));
    return bucketCell(hit ? hit.amount : null, b);
  };

  const body = shown.map((r) =>
    '<tr><td class="' + pinL.trim() + '">' + escHtml(ccrRowLabel(r)) + "</td>" +
    (breakdown ? "" : '<td class="ccr-muted">' + escHtml(ccrMoney(r.commitment, ccy)) + "</td>") +
    buckets.map((b) => rowCell(r, b)).join("") +
    '<td class="ccr-strong' + pinN + '">' + escHtml(ccrMoney(isDist ? r.due_to_investor : r.due_to_fund, ccy)) + "</td>" +
    '<td class="ccr-muted' + pinA + '">' + escHtml(ccrPct(isDist
      ? r.post_distribution_percent
      : ccrPick(r, "post_call_percent_inside_commitment", "post_call_percent"))) + "</td></tr>"
  ).join("");

  const partCount = s.participating_interests_count !== null && s.participating_interests_count !== undefined
    ? s.participating_interests_count
    : (_ccr.rowsDone ? rows.length : null);

  const totals = ['<td class="' + pinL.trim() + '">' + (partCount === null ? "Totals" : partCount + " participating") + "</td>"]
    .concat(breakdown ? [] : ["<td></td>"])
    .concat(buckets.map((b) => bucketCell(b.total, b)))
    .concat([
      '<td class="' + pinN.trim() + '">' + escHtml(ccrMoney(isDist ? s.total_due_to_investor : s.total_due_to_fund, ccy)) + "</td>",
      '<td class="' + pinA.trim() + '">' + escHtml(ccrPct(isDist
        ? s.total_post_distribution_percent
        : ccrPick(s, "total_post_call_percent_inside_commitment", "total_post_call_percent"))) + "</td>",
    ]);

  const bar = composed
    ? '<div class="ccr-alloc-bar"><button class="ccr-detail-toggle" data-ccr-detail>' +
      (breakdown ? "Hide breakdown" : "Show breakdown") + "</button></div>"
    : "";

  // A walk that stopped short must not read as complete: the count the
  // summary folds is the truth, and the button says how many of them are here.
  const short = _ccr.rowsDone && partCount !== null && rows.length < partCount;
  const more = rows.length > 5 && _ccr.rowsDone
    ? '<button class="ccr-more" data-ccr-more>' +
      (_ccr.showAllRows
        ? "Show fewer"
        : "Show all " + rows.length + (short ? " of " + partCount + " loaded" : " participating")) + "</button>"
    : (_ccr.rowsDone ? "" : '<div class="ccr-more-loading">Loading the rest\u2026</div>');
  const shortNote = short
    ? '<p class="ccr-note ccr-pad">Only ' + rows.length + " of " + partCount +
      " participating investors loaded. Totals are the activity's; open the call in Carta for the rest.</p>"
    : "";

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
  // The fold names only its largest commitments; the rest are on the
  // activity but never paged, unlike participating rows.
  const npShown = fold && (fold.interests || []).length ? fold.interests.length : excluded.length;
  const npNote = fold && fold.truncated
    ? '<p class="ccr-note ccr-pad">Showing ' + npShown + " of " + npCount + ". " +
      ccrOpenInCarta("See the rest in Carta", "ccr-link-btn") + "</p>"
    : "";

  const complete = _ccr.rowsDone && !short;
  const unbacked = complete
    ? cols.main.concat(cols.adjustments).filter((b) =>
        !rows.some((r) => (r.amount_buckets || []).some((ab) => String(ab.bucket_id) === String(b.bucket_id))))
    : [];
  const unbackedNote = unbacked.length
    ? '<p class="ccr-note ccr-pad">' + escHtml(
        unbacked.map((b) => ccrBucketHeader(b)).join(", ") +
        (unbacked.length === 1 ? " has an activity total but no loaded investor carries it." :
          " have activity totals but no loaded investor carries them.") +
        " Check the call in Carta before releasing.") + "</p>"
    : "";

  return bar +
    '<div class="ccr-table-wrap"><table class="ccr-table"><thead><tr>' +
    head.map((h, i) => '<th class="' +
      (i === 0 ? pinL.trim() : i === head.length - 2 ? pinN.trim() : i === head.length - 1 ? pinA.trim() : "") +
      '">' + escHtml(h) + "</th>").join("") +
    "</tr></thead><tbody>" + body +
    '<tr class="ccr-total">' + totals.join("") + "</tr></tbody></table></div>" +
    more + shortNote + unbackedNote +
    (_ccr.truncated ? '<p class="ccr-note">Stopped after ' + CCR_MAX_PAGES + " pages; the rest are on the activity.</p>" : "") +
    (npCount
      ? '<div class="ccr-np-block"><div class="ccr-np-label">Not participating \u00b7 ' + npCount + "</div>" + npList + npNote + "</div>"
      : "");
}

function ccrKvRow(label, value) {
  if (!value) return '';
  return '<div class="ccr-kv"><span class="ccr-k">' + escHtml(label) + '</span>' +
    '<span class="ccr-v">' + escHtml(value) + '</span></div>';
}

function ccrCallout(kind, title, text, actionHtml) {
  return '<div class="ccr-callout ccr-callout-' + kind + '"><span>' +
    '<span class="ccr-callout-title">' + escHtml(title) + '</span>' + escHtml(text) + (actionHtml || "") + '</span></div>';
}

// Where a distribution pays out of. The consent an approver signs names this
// account, so it is the one block a distribution reviewer must see.
// A distribution's paying-from account is usually the fund's own account, which
// the summary also serves as the receiving account. The payments-platform
// reference identifies an account on both sides; without one on both, the same
// last four digits under the same account name do. Bank names are not compared:
// the two records can name the account's bank differently.
function ccrSameAccount(p, r) {
  if (!p || !r) return false;
  if (p.fpi_reference_id && r.fpi_reference_id) return p.fpi_reference_id === r.fpi_reference_id;
  const last4 = (x) => x.account_number_last_four || (x.account_number ? String(x.account_number).slice(-4) : null);
  const name = (x) => String(x.account_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  return !!last4(p) && last4(p) === last4(r) && !!name(p) && name(p) === name(r);
}

// `extraRows` are the receiving record's wire fields, appended when both
// records are one account so it is shown once, under the heading that carries
// its release hold.
function ccrPayingFromHtml(s, extraRows) {
  const state = ccrPayingFromState(s);
  if (state.kind === "none") return "";
  const pill = state.kind === "ok" ? '<span class="ccr-pill ccr-pill-ok">Active</span>'
    : state.kind === "closed" ? '<span class="ccr-pill ccr-pill-bad">Closed</span>'
    : '<span class="ccr-pill ccr-pill-bad">Missing</span>';
  const a = state.account;
  const rows = a
    ? ccrKvRow('Bank name', a.bank_name) +
      ccrKvRow('Account name', a.account_name) +
      ccrKvRow('Account number', a.account_number_last_four ? '····' + a.account_number_last_four : null) +
      (extraRows || '')
    : '';
  const callout = state.kind === "closed"
    ? ccrCallout("bad", "Active bank account required",
        "The bank account selected for this distribution is closed. Release is held until your Carta team selects " +
        "another: use Request changes and say which account to pay from.")
    : state.kind === "missing"
    ? ccrCallout("bad", "Bank account required",
        "No paying-from account is named on this distribution. Release is held until your Carta team adds one: " +
        "use Request changes and say which account to pay from.")
    : "";
  // The message sits under the title whether or not an account follows, so a
  // missing and a closed account read in the same place.
  return '<div class="ccr-pay-group-title">Paying from ' + pill + '</div>' + callout + rows;
}

function ccrPayBody(s) {
  const a = s.receiving_account;
  const oneAccount = ccrSameAccount(ccrPayingFromState(s).account, a);
  let payingFrom = ccrPayingFromHtml(s);

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
    // A distribution collects nothing, so an absent receiving account is not
    // a gap there; the paying-from block above is what it shows instead.
    if (!payingFrom) {
      const fallback = s.uses_fbo_contributions ? "Per-partner virtual accounts" : "No account named on this activity";
      wireHtml = '<div class="ccr-kv"><span class="ccr-k">Receiving account</span><span class="ccr-v">' + escHtml(fallback) + "</span></div>";
    }
  } else {
    const showAcct = _ccr.payShowSensitive.acct;
    const showRouting = _ccr.payShowSensitive.routing;
    const kvRow = ccrKvRow;

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

    if (payingFrom && oneAccount) {
      // The same account under one heading: the paying-from rows, plus the wire
      // fields only the receiving record carries. A mixed activity says why
      // those fields matter on a distribution.
      const collects = Number(s.total_due_to_fund) > 0;
      payingFrom = ccrPayingFromHtml(s,
        kvRow('Bank address', a.bank_address) +
        kvRowReveal('Routing number', routingNum, showRouting, 'routing', !!a.routing_number) +
        kvRow('OBI / Memo', a.obi_memo) +
        (collects ? '<p class="ccr-row-note">Contributions on this activity are paid into this same account.</p>' : ''));
      wireHtml = '';
    } else {
      wireHtml =
        (payingFrom ? '<div class="ccr-pay-group-title">Receiving account</div>' : '') +
        kvRow('Bank name', a.bank_name) +
        kvRow('Bank address', a.bank_address) +
        kvRow('Beneficiary', a.account_name) +
        kvRowReveal('Account number', acctNum, showAcct, 'acct', !!a.account_number) +
        kvRowReveal('Routing number', routingNum, showRouting, 'routing', !!a.routing_number) +
        kvRow('OBI / Memo', a.obi_memo);
    }
  }

  // The allocations table is full-bleed because its cells carry their own
  // inset. These rows do not, so the inset lives on the wrapper.
  return '<div class="ccr-pad">' +
    payingFrom +
    wireHtml +
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
      "<p class='ccr-note'>The workflow row carries no fund and activity id the review commands accept. Open the call in Carta to review it. " +
      ccrOpenInCarta() + "</p></div>";
  }
  if (_ccr.error || !s) {
    return '<div class="ccr-empty"><p>Could not read this capital call.</p>' +
      '<p class="ccr-note">' + escHtml(_ccr.error || "") + " " + ccrOpenInCarta("Review it in Carta") + "</p></div>";
  }

  const p = s.preparation;

  return (p && p.note
    ? '<div class="ccr-note-box"><span class="ccr-note-icon">→</span><span class="ccr-note-main">' +
      '<span class="ccr-note-head">' + escHtml((p.note_author || p.prepared_by || "Your Carta team") + " left a note") +
      '<button class="ccr-note-toggle" data-ccr-note>' + (_ccr.noteOpen ? "Show less" : "Read full note") + "</button></span>" +
      '<span class="' + (_ccr.noteOpen ? "ccr-note-full" : "ccr-note-clamp") + '">' + escHtml(p.note) + "</span>" +
      "</span></div>"
    : "") +

    ccrCartaOnlyCallout(s) +
    (s.is_amm_distribution
      ? ccrCallout("warn", "Review this distribution in Carta",
          "It pays through Automated Money Movement: Carta wires each investor from the paying-from account on release, " +
          "and the approver chooses who is paid and authorizes the payment. That review is not supported here, so this " +
          "page shows the distribution but cannot approve it or send it back. ",
          ccrOpenInCarta("Open in Carta", "ccr-callout-btn"))
      : "") +

    ccrMainTabBar() +

    '<div class="ccr-tab-pane">' +
      (_ccr.activeTab === 'overview' ? ccrOverviewTabBody(s)
        : _ccr.activeTab === 'alloc' ? ccrAllocTable(s)
        : _ccr.activeTab === 'pay' ? ccrPayBody(s)
        : _ccr.activeTab === 'settings' ? ccrSettingsTabBody(s)
        : ccrNoticeTabBody(s)) +
    "</div>";
}

const CCR_PAYMENT_TERMS_URL = "https://carta.com/legal/terms-agreements/fund-administration-payment-terms-conditions/";

function ccrCheck(key, checked, labelHtml) {
  return '<label class="ccr-check"><input type="checkbox" data-ccr-consent="' + key + '"' +
    (checked ? " checked" : "") + '><span>' + labelHtml + "</span></label>";
}

const ccrTermsLink = () =>
  '<a href="' + CCR_PAYMENT_TERMS_URL + '" target="_blank" rel="noopener">Carta Fund Administration Payment Terms and Conditions</a>';

// The web app's capital call checkbox, one of two: the Automated Money
// Movement authorization agreement when Carta collects the money (an AMM call
// fails its release health check without it), otherwise the payment account
// confirmation. Both gate release; only the agreement is recorded server-side.
function ccrCallConsentHtml(s) {
  if (ccrIsDistribution(s)) return "";
  const a = s.receiving_account || {};
  const last4 = a.account_number_last_four || (a.account_number ? String(a.account_number).slice(-4) : null);
  if (s.uses_fbo_contributions) {
    return '<div class="ccr-consent"><div class="ccr-consent-title">Capital call authorization agreement</div>' +
      ccrCheck("call", _ccr.consent.call,
        "I agree to the " + ccrTermsLink() + " and authorize Carta to initiate receipt of funds on my behalf " +
        "and credit the " + escHtml(a.bank_name || "bank") + " account" + (last4 ? " ending in " + escHtml(last4) : "") +
        " for purposes of this capital call.") +
      "</div>";
  }
  return '<div class="ccr-consent"><div class="ccr-consent-title">Capital call payment account confirmation</div>' +
    ccrCheck("call", _ccr.consent.call,
      "I confirm that funds are to be sent to the payment account" + (last4 ? " ending in " + escHtml(last4) : "") + ".") +
    "</div>";
}

// Why the release button is disabled in the release step, or null.
function ccrReleaseHold() {
  const s = _ccr.summary || {};
  if (!ccrIsDistribution(s) && !_ccr.consent.call) {
    return s.uses_fbo_contributions ? "Agree to the payment terms to release." : "Confirm the payment account to release.";
  }
  return null;
}

function ccrConfirmBody() {
  const s = _ccr.summary || {};
  const ccy = s.currency;
  const n = s.participating_interests_count;
  const who = n !== null && n !== undefined ? n : "the participating";
  const dist = ccrIsDistribution(s);
  const r = dist ? s.distribution_readiness : null;
  const steps = [
    "Posts the journal entries to " + (s.fund_name || "the fund") + ".",
    "Generates a notice PDF for each of the " + who + " participating investors.",
    "Emails all " + who + " investors" + (s.date_of_notice ? " on " + ccrDate(s.date_of_notice) : "") + ".",
    dist
      ? "Pays " + ccrMoney(r ? r.ready_for_transfer_amount : s.total_due_to_investor, ccy) + " to " +
        (r && r.receiving_count !== null && r.receiving_count !== undefined ? r.receiving_count + " " : "") +
        "investors" + (s.due_date ? " on " + ccrDate(s.due_date) : "") + "."
      : "Makes " + ccrMoney(s.total_due_to_fund, ccy) + " due from investors" +
        (s.due_date ? " on " + ccrDate(s.due_date) : "") + ".",
  ];
  if (r && r.on_hold_count) {
    const held = (ccrNum(s.total_due_to_investor) || 0) - (ccrNum(r.ready_for_transfer_amount) || 0);
    steps.push("Holds " + ccrMoney(held, ccy) + " for " + r.on_hold_count +
      " investors until their wire instructions are provided.");
  }
  if ("share_commitment" in s) {
    // Release shares only on an exact true; the web app's staff checkbox
    // starts checked whatever is stored, so the stored value is spelled out.
    steps.push(s.share_commitment === true
      ? "Invites and notifies the investors who are not yet on Carta, and shares their commitment with them."
      : s.share_commitment === false
        ? "Records the call silently for investors not yet on Carta: no invitations and no new-partner notices."
        : "Records the call silently for investors not yet on Carta: inviting them was never set on this call, and release treats that as off.");
  }
  return '<p class="ccr-confirm-banner">Releasing runs all of this in Carta immediately. Read it before you release.</p>' +
    '<div class="ccr-steps">' + steps.map((t, i) =>
      '<div class="ccr-step"><span class="ccr-step-n">' + (i + 1) + "</span><span>" + escHtml(t) + "</span></div>").join("") +
    "</div>" +
    ccrCallConsentHtml(s) +
    "<p style='margin-top:14px;font-size:13px;line-height:20px'>Released " + (dist ? "distributions" : "capital calls") +
    " cannot be recalled. A correction after release means a new notice to every investor.</p>";
}

function ccrFooter() {
  const s = _ccr.summary;
  const p = s && s.preparation;
  const prepared = p && p.prepared_on ? "Prepared " + ccrDate(p.prepared_on) + ". " : "";

  if (_ccr.phase === "review") {
    const blocked = !s || _ccr.error || _ccr.locked;
    const blockers = blocked ? [] : ccrBlockers(s);
    return '<div class="far-panel-footer ccr-footer">' +
      '<span class="ccr-note">' + escHtml(prepared) + "Nothing has been sent to investors yet. " + ccrOpenInCarta() + "</span>" +
      blockers.map((b) => '<span class="ccr-blocker">' + escHtml(b.text) + "</span>").join("") +
      '<span class="ccr-footer-actions">' +
        '<button class="far-btn-secondary" data-ccr-phase="changes"' + (blocked || blockers.some((b) => b.locks) ? " disabled" : "") + ">Request changes</button>" +
        '<button class="far-btn-primary" data-ccr-phase="confirm"' + (blocked || blockers.length ? " disabled" : "") + ">Approve and release</button>" +
      "</span></div>";
  }
  if (_ccr.phase === "confirm") {
    const n = s && s.participating_interests_count;
    const hold = ccrReleaseHold();
    return '<div class="far-panel-footer ccr-footer-end">' +
      (hold ? '<span class="ccr-note ccr-hold">' + escHtml(hold) + "</span>" : "") +
      '<button class="far-btn-secondary" data-ccr-phase="review">Back to review</button>' +
      '<button class="far-btn-primary" id="ccr-do-approve" data-ccr-approve' + (hold ? " disabled" : "") + ">Release" +
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

// Reached without a reply, so whether the journal posted is unknown. Say only what
// is certain: the release is running and leaving does not stop it.
function ccrReleasingBody() {
  return '<div class="ccr-done">' +
    '<div class="ccr-done-title">Release in progress</div>' +
    '<div class="ccr-done-body">' +
      escHtml("Carta is generating notices and posting journals for this capital activity.") +
    "</div>" +
    '<div class="ccr-note">It\'ll show up under Completed when it\'s done. ' +
    "Come back anytime to check.</div></div>";
}

function ccrDoneBody(released) {
  const s = _ccr.summary || {};
  const dist = ccrIsDistribution(s);
  return '<div class="ccr-done"><div class="ccr-done-tick">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></div>' +
    '<div class="ccr-done-title">' + (released ? (dist ? "Distribution released" : "Capital call released") : "Your Carta team is on it") + "</div>" +
    '<div class="ccr-done-body">' +
      (released
        ? escHtml("Journal entries are posted and the notice PDFs are generated." +
            (s.date_of_notice ? " The notices email on " + ccrDate(s.date_of_notice) + "." : ""))
        : "Nothing has been sent to investors. They pick this up, redo the work, and put it back in front of you to review.") +
    "</div>" +
    (released
      ? '<div class="ccr-note">' + escHtml(ccrMoney(dist ? s.total_due_to_investor : s.total_due_to_fund, s.currency)) +
        (dist ? " is due to investors" : " is due from investors") + (s.due_date ? " on " + escHtml(ccrDate(s.due_date)) : "") +
        (dist ? ". Your Carta team tracks the wires as they go out.</div>" : ". Your Carta team tracks payments as they arrive.</div>")
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
  else if (_ccr.phase === "releasing") body = ccrReleasingBody();
  else if (_ccr.phase === "released") body = ccrDoneBody(true);
  else if (_ccr.phase === "sent") body = ccrDoneBody(false);
  else body = ccrReviewBody();

  // Every walked page re-renders the panel, so the Delivery search keeps its
  // caret and the investor box its scroll across the swap.
  const focused = document.activeElement;
  const searching = focused && focused.id === "ccr-dlv-search";
  const caret = searching ? focused.selectionStart : null;
  const prevBox = overlay.querySelector(".ccr-dlv-box");
  const boxTop = prevBox ? prevBox.scrollTop : 0;

  overlay.innerHTML =
    '<div class="far-panel far-panel-thread ccr-panel">' +
      '<div class="far-panel-header">' +
        '<span class="far-panel-title">' + escHtml(ccrPanelTitle(s)) + "</span>" +
        (s && s.fund_name ? '<span class="ccr-panel-sub">' + escHtml(s.fund_name) + "</span>" : "") +
        '<button class="far-panel-close" data-ccr-close aria-label="Close">✕</button>' +
      "</div>" +
      '<div class="far-panel-body ccr-body">' + body + "</div>" +
      ccrFooter() +
    "</div>";

  const t = document.getElementById("ccr-change-text");
  if (t) t.addEventListener("input", (e) => { _ccr.changeText = e.target.value; });
  ccrBind(overlay);
  const box = overlay.querySelector(".ccr-dlv-box");
  if (box) box.scrollTop = boxTop;
  const search = searching ? document.getElementById("ccr-dlv-search") : null;
  if (search) {
    search.focus();
    search.setSelectionRange(caret, caret);
  }
  const wrap = overlay.querySelector(".ccr-table-wrap");
  if (wrap) {
    const last = wrap.querySelector("th.ccr-pin-after");
    if (last) wrap.style.setProperty("--ccr-pin-after-w", last.offsetWidth + "px");
    wrap.classList.toggle("ccr-overflow", wrap.scrollWidth > wrap.clientWidth + 1);
  }
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
      if (_ccr.activeTab === "notice" && prev !== "notice") ccrLoadActiveDoc();
    }));
  root.querySelectorAll("[data-ccr-more]").forEach((el) =>
    el.addEventListener("click", () => { _ccr.showAllRows = !_ccr.showAllRows; ccrRender(); }));
  root.querySelectorAll("[data-ccr-dlv-filter]").forEach((el) =>
    el.addEventListener("click", () => {
      const d = ccrDeliveryState();
      const id = el.getAttribute("data-ccr-dlv-filter");
      d.filter = d.filter === id && id !== "all" ? "all" : id;
      ccrRender();
    }));
  root.querySelectorAll("[data-ccr-dlv-sort]").forEach((el) =>
    el.addEventListener("click", () => {
      const d = ccrDeliveryState();
      const id = el.getAttribute("data-ccr-dlv-sort");
      if (id === "reset") { d.sort = null; d.dir = 1; }
      else if (d.sort === id) d.dir = -d.dir;
      else { d.sort = id; d.dir = 1; }
      ccrRender();
    }));
  const dlvSearch = root.querySelector("#ccr-dlv-search");
  if (dlvSearch) dlvSearch.addEventListener("input", (ev) => {
    ccrDeliveryState().q = ev.target.value;
    ccrRender();
  });
  root.querySelectorAll("[data-ccr-detail]").forEach((el) =>
    el.addEventListener("click", () => { _ccr.showDetail = !_ccr.showDetail; ccrRender(); }));
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
      ccrLoadActiveDoc();
      if (_ccr.docTab === "pdf" && _ccr.pdf) ccrPaintPdf();
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
  root.querySelectorAll("[data-ccr-consent]").forEach((el) =>
    el.addEventListener("change", () => {
      _ccr.consent[el.getAttribute("data-ccr-consent")] = !!el.checked;
      ccrRender();
    }));
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
  if (_ccr.activeTab === "notice" || _ccr.noticeOpen) ccrLoadActiveDoc();
}

// Each tab costs a render on Carta's side, so only the visible one is fetched.
function ccrLoadActiveDoc() {
  if (_ccr.docTab === "pdf") {
    if (!_ccr.pdf && !_ccr.pdfLoading && !_ccr.pdfError) ccrLoadPdf();
  } else if (!_ccr.email && !_ccr.emailError) {
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
    pane = '<div class="ccr-empty"><p>This email could not be previewed.</p><p class="ccr-note">' +
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
          '<button class="ccr-tab' + (_ccr.docTab === "pdf" ? " ccr-tab-on" : "") + '" data-ccr-tab="pdf">Notice PDF</button>' +
          '<button class="ccr-tab' + (_ccr.docTab !== "pdf" ? " ccr-tab-on" : "") + '" data-ccr-tab="email">Email</button>' +
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
    ccrRender();
    ccrRenderNotice();
    return;
  }

  if (CCR_IS_DEMO) {
    _ccr.pdfError = "PDF preview is not available in demo mode.";
    ccrRender();
    ccrRenderNotice();
    return;
  }

  const snap = _ccr;
  const interestId = row.interest.id;
  snap.pdfError = null;
  snap.pdf = ccrDocHit("pdf", snap.target.activityId, interestId);
  if (snap.pdf) {
    snap.pdfLoading = false;
    ccrRender();
    ccrRenderNotice();
    return;
  }
  snap.pdfLoading = true;
  ccrRenderNotice();

  // Slow enough that the reader can pick another investor first. The cache keeps
  // this render for when they come back; only its display is dropped.
  const want = snap.lpIndex;
  try {
    const p = await ccrCachedDoc("pdf", snap.target.activityId, interestId,
      () => ccrFetchPdf(snap.target, interestId));
    if (_ccr !== snap || want !== snap.lpIndex) return;
    snap.pdf = p;
  } catch (err) {
    if (_ccr !== snap || want !== snap.lpIndex) return;
    snap.pdfError = err && err.message ? err.message : "the notice could not be rendered";
  }
  snap.pdfLoading = false;
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
  const fund = (w.fund && w.fund.uuid) ? w.fund : ((w.funds || []).find(f => f && f.uuid) || null);
  const fundUuid = fund ? fund.uuid : null;
  const activityId = w.object_id ?? null;
  if (!fundUuid || !activityId) return null;
  return {
    fundUuid: String(fundUuid),
    activityId: String(activityId),
    webUrl: ccrReviewUrl(w.firm, fund, String(activityId)),
  };
}

// The web app's review page for the activity. The workflow list carries the
// firm's and fund's Carta ids; the connector's name says which environment
// they belong to, the same way the CLI resolves its base URL.
function ccrReviewUrl(firm, fund, activityId) {
  const firmId = firm && (firm.cw_firm_id ?? firm.carta_id ?? null);
  const fundId = fund && (fund.cw_fund_id ?? fund.carta_id ?? null);
  if (firmId === null || firmId === undefined || fundId === null || fundId === undefined) return null;
  const server = typeof CARTA_MCP_SERVER === "string" ? CARTA_MCP_SERVER : "";
  const host = /sandbox/i.test(server) ? "https://app.sandbox.carta.team" : "https://app.carta.com";
  return host + "/investors/firm/" + encodeURIComponent(String(firmId)) + "/portfolio/fund/" +
    encodeURIComponent(String(fundId)) + "/fund-capital-activity/?capitalActivityId=" +
    encodeURIComponent(activityId);
}

function ccrOpenInCarta(label, cls) {
  const url = _ccr.target && _ccr.target.webUrl;
  if (!url) return "";
  return '<a class="' + (cls || "ccr-link-btn") + '" href="' + escHtml(url) + '" target="_blank" rel="noopener">' +
    escHtml(label || "Open in Carta") + "</a>";
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
