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

// A release can outlast the connector's wait: carta-mcp holds it for up to ten
// minutes. Until an answer lands, the queue is re-read this often, for this long.
const CCR_RELEASE_POLL_MS = 15000;
const CCR_RELEASE_WATCH_MS = 11 * 60 * 1000;

const CCR_UNCONFIRMED_NOTE = "Carta hasn't confirmed this release. Check the call in Carta before trying again.";

let _ccr = null;

// Releases this page sent, by activity id. They outlive the panel: closing and
// reopening it makes a new _ccr, and a late answer still has to land.
const _ccrReleasing = {};          // sent, no verdict yet: id -> when it was sent
const _ccrReleased = new Set();    // Carta released it
const _ccrUnconfirmed = new Set(); // no verdict within the watch
let _ccrWatching = false;

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
    // null, or "changes" while the request-changes modal is open.
    modal: null,
    activeTab: "alloc",
    renderedTab: null,
    autofocus: null,
    // The request-changes text while the modal is open; saved only by Save and continue.
    changeText: "",
    // Set when the modal is closed with unsaved edits, to ask before dropping them.
    confirmDiscard: false,
    caretAt: null,
    sending: false,
    releasing: false,
    // Why the last release did not go through, shown above Approve.
    releaseNote: null,
    noteOpen: false,
    blockersOpen: false,
    payShowSensitive: { acct: false, routing: false },
    showDetail: false,
    focusBucket: null,
    // Which investors the Allocations table lists: "part" or "np".
    allocView: "part",
    delivery: { filter: "all", q: "", sort: null, dir: 1 },
    deliveryOpen: false,
    wireView: { filter: "all" },
    lpIndex: 0,
    // The notice PDF opens first; the email stands in where no PDF can be
    // rendered (no bundled viewer, or demo mode).
    docTab: typeof window !== "undefined" && window.pdfjsLib && !CCR_IS_DEMO ? "pdf" : "email",
    email: null,
    emailError: null,
    pdf: null,
    pdfError: null,
    pdfLoading: false,
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

// A bare @dc_exposed hint emits MM/DD/YYYY, not ISO. Accept both. Local midnight.
function ccrParseDate(s) {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  let d = null;
  if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (us) d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  return d && !isNaN(d) ? d : null;
}

function ccrDate(s) {
  if (!s) return "—";
  const d = ccrParseDate(s);
  return d ? d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : s;
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

// A bucket reads by its full name, never an abbreviation.
function ccrBucketHeader(b) {
  // "Contribution - Expenses" keeps its dash with the word before it when the header wraps.
  return String(b.display_name || b.slug || "Bucket").replace(/ - /g, "\u00a0- ");
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
      text: "No paying-from bank account is named. Ask your Carta team to add one with Request changes.",
    });
  } else if (paying === "closed") {
    out.push({
      key: "paying-from",
      text: "The paying-from bank account is closed. Ask your Carta team to select another with Request changes.",
    });
  }
  // An AMM distribution is reviewed in Carta: choosing who is paid and
  // authorizing the payment are not offered here, so neither decision is.
  if (s.is_amm_distribution) {
    out.push({
      key: "amm",
      locks: true,
      text: "This distribution pays through Automated Money Movement, so it is reviewed and released in Carta.",
      // "in Carta" opens the activity there, when the panel knows its address.
      html: escHtml("This distribution pays through Automated Money Movement, so it is reviewed and released ") +
        (ccrOpenInCarta("in Carta", "ccr-blocker-link") || "in Carta") + ".",
    });
  }
  const h = ccrHealth();
  const event = ccrIsDistribution(s) ? "distribution" : "capital call";
  // The check roster is staff detail the web app hides from GPs, so no check is named;
  // Carta clears a failure once the reviewer sends the activity back.
  if (h.verdict === "blocking") {
    out.push({
      key: "health-checks",
      text: "Health checks are failing. Use Request changes to send this " + event + " back to your Carta team.",
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
             passing: 0, verdict: "none" };
  }
  const checks = h.checks || [];
  const failing = checks.filter((c) => c.is_success === false);
  const blocking = failing.filter((c) => c.is_blocking);
  const advisory = failing.filter((c) => !c.is_blocking);
  return {
    loading: h.loading, error: h.error, checks: checks, failing: failing, blocking: blocking, advisory: advisory,
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
    ccrLoadActiveDoc();
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
    ccrLoadActiveDoc();

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

// ── Wire instructions ─────────────────────────────────────────────────────
// Each investor group's wire instructions, served on the review rows for an activity
// that pays out. A deploy whose rows carry no wire_status shows no Wires tab.

const ccrPays = (s) => !!s && (ccrIsDistribution(s) || ccrPayingFromState(s).kind !== "none");

// fund-admin's statuses, most serious first. Missing and incomplete instructions hold a
// payment; added is on file but never confirmed; over a year old is past its confirmation.
const CCR_WIRE_STATUSES = [
  { id: "missing", label: "Missing", pill: "bad" },
  { id: "incomplete", label: "Incomplete", pill: "bad" },
  { id: "added", label: "Not confirmed", pill: "warn" },
  { id: "over_a_year_old", label: "Over a year old", pill: "warn" },
  { id: "confirmed", label: "Confirmed", pill: "ok" },
];
// An FFC tag the bank needs and the instructions lack is one way of being incomplete.
const ccrWireStatusOf = (r) => (r.wire_status === "incomplete_ffc_missing" ? "incomplete" : r.wire_status || null);

// Instructions are held at the interest group, so every row of a group carries the same wire
// fields. One entry per group, in first-row order, with the group's rows for anything summed.
function ccrWireGroups(rows) {
  const groups = new Map();
  rows.forEach((r) => {
    const i = r.interest || {};
    const key = String(i.partner_interest_group_uuid || i.uuid || ccrRowLabel(r));
    if (!groups.has(key)) {
      groups.set(key, { uuid: key, name: ccrRowLabel(r), rows: [], wire_status: r.wire_status || null,
        wire_confirmed: r.wire_confirmed ?? null, wire_setup: r.wire_setup || null,
        wire_confirmed_on: r.wire_confirmed_on || null, wire_added_on: r.wire_added_on || null });
    }
    groups.get(key).rows.push(r);
  });
  return [...groups.values()];
}

// Waits for every row, so a partly walked table never shows a short count.
const ccrWiresReady = () => !!_ccr.rowsDone && ccrPays(_ccr.summary) && ccrLpRows().some((r) => r.wire_status);
const ccrWiresMissing = () => (ccrWiresReady() ? ccrWireGroups(ccrLpRows()).filter((g) => g.wire_status === "missing").length : 0);

function ccrWiresTabBody(s) {
  if (!s) return '<div class="loading-row" style="padding:20px 0;">Reading the capital call\u2026</div>';
  const v = _ccr.wireView;
  const rank = (g) => { const i = CCR_WIRE_STATUSES.findIndex((st) => st.id === ccrWireStatusOf(g)); return i < 0 ? CCR_WIRE_STATUSES.length : i; };
  const all = ccrWireGroups(ccrLpRows());
  const count = (id) => all.filter((g) => ccrWireStatusOf(g) === id).length;
  const chip = (id, label, n) =>
    '<button class="ccr-dlv-chip' + (v.filter === id ? " ccr-dlv-chip-on" : "") + '" data-ccr-wire-filter="' + id + '">' +
    escHtml(label) + "<b>" + n + "</b></button>";
  const chips = [chip("all", "All", all.length)].concat(CCR_WIRE_STATUSES.filter((st) => count(st.id)).map((st) => chip(st.id, st.label, count(st.id))));
  const groups = all.filter((g) => v.filter === "all" || ccrWireStatusOf(g) === v.filter)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const pill = (g) => {
    const st = CCR_WIRE_STATUSES.find((o) => o.id === ccrWireStatusOf(g));
    return st ? '<span class="ccr-pill ccr-pill-' + st.pill + '">' + escHtml(st.label) + "</span>" : '<span class="ccr-faint">\u2014</span>';
  };
  const date = (g) => g.wire_confirmed_on ? escHtml(ccrDate(String(g.wire_confirmed_on).slice(0, 10))) : '<span class="ccr-faint">\u2014</span>';
  const body = groups.length
    ? groups.map((g) => "<tr><td>" + escHtml(g.name) + "</td>" +
        '<td class="ccr-wire-status">' + pill(g) + "</td>" +
        '<td class="ccr-wire-date">' + date(g) + "</td></tr>").join("")
    : '<tr><td colspan="3" class="ccr-dlv-empty">No investors in this group.</td></tr>';
  const narrowed = v.filter !== "all";
  return '<div class="ccr-dlv-head"><span class="ccr-dlv-title">Wire instructions</span></div>' +
    '<div class="ccr-dlv-controls"><div class="ccr-dlv-chips">' + chips.join("") + "</div></div>" +
    '<div class="ccr-dlv-box ccr-wire-box"><table class="ccr-table ccr-dlv-table ccr-wire-table"><thead><tr>' +
      "<th>Investor</th><th>Status</th><th>Last confirmed</th>" +
    "</tr></thead><tbody>" + body + "</tbody></table></div>" +
    '<div class="ccr-dlv-foot"><span>' + escHtml(narrowed ? "Showing " + groups.length + " of " + ccrInvestors(all.length) : ccrInvestors(all.length)) + "</span>" +
      "<span>Missing and incomplete instructions hold an investor's payment; unconfirmed and year-old ones are still paid.</span></div>";
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
  const row = ccrLpRows(snap)[snap.lpIndex];
  if (!row || !row.interest || row.interest.id == null) {
    snap.emailError = "This row carries no partner id, so its notice cannot be previewed.";
    ccrRender();
    return;
  }

  snap.emailError = null;

  if (CCR_IS_DEMO) {
    snap.email = ccrDemoEmail(row);
    ccrRender();
    return;
  }

  const partnerId = row.interest.id;
  snap.email = ccrDocHit("email", snap.target.activityId, partnerId);
  if (snap.email) {
    ccrRender();
    return;
  }
  ccrRender();

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
}

// ── Writes ────────────────────────────────────────────────────────────────

async function ccrSubmitChanges() {
  const snap = _ccr;
  const text = ccrChangeContent(snap.changeText);
  if (!text) { showToast("Write what needs to change first."); return; }
  snap.sending = true;
  ccrRender();
  trackWorkhub("click", "CartaWorkhub.CapitalCallReview.RequestChanges");

  // Sent means the review is over for now, so the panel closes back to the queue.
  const done = () => {
    ccrSetDraft(snap.target.activityId, "");
    snap.sending = false;
    snap.modal = null;
    ccrClose();
    showToast("Sent to your Carta team. This task is In progress until it comes back to you.");
  };
  if (CCR_IS_DEMO) { done(); return; }

  try {
    const res = await _mcp("mutate", {
      command: "fa:mutate:request-capital-activity-changes",
      params: {
        fund_uuid: snap.target.fundUuid,
        capital_activity_id: snap.target.activityId,
        comment: text,
      },
    });
    if (_ccr !== snap) return;
    if (res.isError) throw new Error(res.content?.[0]?.text ?? "request failed");
    ccrForgetDocs(snap.target.activityId);
    done();
  } catch (err) {
    console.error("[ccr] request-changes failed —", err);
    if (_ccr !== snap) return;
    snap.sending = false;
    ccrRender();
    showToast("Could not send that to your Carta team. Nothing changed, and your text is still here.");
  }
}

// A refusal names the health check that stopped the release. Long text is a stack
// trace or a wall of detail, which the footer's one line cannot carry.
function ccrErrText(res) {
  const t = res && res.content && res.content[0] && res.content[0].text;
  return typeof t === "string" && t.length <= 240 ? t : "";
}

const ccrOpenOn = (activityId) => !!_ccr && !!_ccr.target && _ccr.target.activityId === activityId;

function ccrApprove() {
  const snap = _ccr;
  const id = snap.target.activityId;
  if (snap.releasing || _ccrReleasing[id]) return;
  // Held in state rather than on the button, so a re-render cannot re-enable it mid-release.
  snap.releasing = true;
  snap.releaseNote = null;
  ccrRender();
  trackWorkhub("click", "CartaWorkhub.CapitalCallReview.Release");

  if (CCR_IS_DEMO) {
    snap.releasing = false;
    snap.phase = "released";
    ccrRender();
    return;
  }

  const params = {
    fund_uuid: snap.target.fundUuid,
    capital_activity_id: id,
  };
  // The consent is the approver's authorization, so it is passed only as
  // ticked, and only where there is one to record: a plain call's account
  // confirmation is a gate on this page, not a consent the backend keeps.
  if (snap.consent.call && snap.summary && snap.summary.uses_fbo_contributions) params.amm_consent = true;
  _ccrReleasing[id] = Date.now();
  _ccrUnconfirmed.delete(id);
  _mcp("mutate", { command: "fa:mutate:approve-capital-activity", params: params }).then(
    (res) => ccrReleaseAnswered(id, res, null),
    (err) => ccrReleaseAnswered(id, null, err),
  );

  // No reply yet: show the release as under way, and move its card out of To do.
  setTimeout(() => {
    if (!_ccrReleasing[id]) return;
    ccrShowReleasing(id);
    farFetchRequests();
    ccrWatchReleases();
  }, CCR_RELEASE_ACK_MS);
}

function ccrShowReleasing(activityId) {
  if (!ccrOpenOn(activityId) || _ccr.phase !== "confirm") return;
  _ccr.releasing = false;
  _ccr.phase = "releasing";
  ccrRender();
}

// Runs whenever the reply lands, for whichever panel is open by then.
function ccrReleaseAnswered(activityId, res, err) {
  if (err) {
    // No verdict reached us, but the release runs on Carta's clock, not the
    // connector's, so it may yet land. The queue says when it does.
    console.error("[ccr] release did not answer —", err);
    ccrShowReleasing(activityId);
    ccrWatchReleases();
    return;
  }

  if (res && res.isError) {
    // Release runs its blocking health checks first and sends nothing when one fails,
    // so a refusal leaves the call as it was. Keep the panel usable, and say why.
    console.error("[ccr] release refused —", res);
    delete _ccrReleasing[activityId];
    _ccrUnconfirmed.delete(activityId);
    if (ccrOpenOn(activityId)) {
      _ccr.releasing = false;
      _ccr.locked = false;
      _ccr.phase = "review";
      _ccr.releaseNote = ccrErrText(res) || "Carta did not release this call. Nothing was sent to investors.";
      ccrRender();
    }
    farFetchRequests();
    return;
  }

  ccrMarkReleased(activityId);
  farFetchRequests();
}

function ccrMarkReleased(activityId) {
  delete _ccrReleasing[activityId];
  _ccrUnconfirmed.delete(activityId);
  _ccrReleased.add(activityId);
  ccrForgetDocs(activityId);
  if (!ccrOpenOn(activityId) || (_ccr.phase !== "confirm" && _ccr.phase !== "releasing")) return;
  _ccr.releasing = false;
  _ccr.phase = "released";
  ccrRender();
}

// The release may still have run: journals posted, notices generated, investors
// emailed. Send the reviewer to Carta rather than inviting a second press.
function ccrLockUnconfirmed() {
  _ccr.releasing = false;
  _ccr.phase = "review";
  _ccr.locked = true;
  _ccr.releaseNote = CCR_UNCONFIRMED_NOTE;
}

function ccrWatchReleases() {
  if (_ccrWatching) return;
  _ccrWatching = true;
  setTimeout(ccrPollReleases, CCR_RELEASE_POLL_MS);
}

// fa:list:workflow lists a review only while its task is open, and release closes
// that task in the same transaction that posts the journal, so a sent release
// missing from the list has landed.
async function ccrPollReleases() {
  const now = Date.now();
  const expired = Object.keys(_ccrReleasing).filter((id) => now - _ccrReleasing[id] >= CCR_RELEASE_WATCH_MS);
  expired.forEach((id) => {
    delete _ccrReleasing[id];
    _ccrUnconfirmed.add(id);
    if (ccrOpenOn(id) && (_ccr.phase === "confirm" || _ccr.phase === "releasing")) {
      ccrLockUnconfirmed();
      ccrRender();
    }
  });

  const ids = Object.keys(_ccrReleasing);
  let landed = [];
  if (ids.length) {
    const rows = farResults(await _mcp("fetch", { command: "fa:list:workflow", params: {} }).catch(() => null));
    if (rows) landed = ids.filter((id) => !rows.some((w) => ccrIsReviewTask(w) && String(w.object_id) === id));
  }
  landed.forEach(ccrMarkReleased);
  if (landed.length || expired.length) farFetchRequests();

  if (Object.keys(_ccrReleasing).length) setTimeout(ccrPollReleases, CCR_RELEASE_POLL_MS);
  else _ccrWatching = false;
}

// ── Shared pieces ─────────────────────────────────────────────────────────

// ── Email settings ────────────────────────────────────────────────────────
// The "{Event} Details" settings and contacts that decide how the notice reaches investors.
// They apply to every investor on the activity, so they sit on the Delivery
// tab rather than in the per-investor preview. A setting the backend did not
// serve (an older deploy) is left out.

function ccrSettingRow(label, value, note) {
  return '<div class="ccr-kv"><span class="ccr-k">' + escHtml(label) + "</span>" +
    '<span class="ccr-v"><span class="ccr-strong">' + escHtml(value) + "</span>" +
    '<span class="ccr-note ccr-kv-note">' + escHtml(note) + "</span></span></div>";
}

// A contact reads as its name over its address, the way the app's pickers list them.
function ccrContactRow(label, contacts) {
  const lines = contacts.map((c) => '<span class="ccr-contact">' +
    '<span class="ccr-strong">' + escHtml(c.full_name || c.email) + "</span>" +
    (c.full_name && c.email ? '<span class="ccr-note ccr-kv-note">' + escHtml(c.email) + "</span>" : "") + "</span>");
  return '<div class="ccr-kv"><span class="ccr-k">' + escHtml(label) + '</span><span class="ccr-v">' +
    (lines.length ? lines.join("") : '<span class="ccr-strong">None</span>') + "</span></div>";
}

function ccrSettingsRows(s) {
  const rows = [];
  // REVIEW contacts are the fund's own approvers, not people the notice names.
  const contacts = Array.isArray(s.contacts) ? s.contacts.filter((c) => c && (c.full_name || c.email)) : null;
  const ofType = (type) => (contacts || []).filter((c) => c.type === type);
  if ("investor_login_required" in s) {
    // The notice code treats an unset value as No, so the row does too.
    rows.push(s.investor_login_required === true
      ? ccrSettingRow("Log in required", "Yes", "Investors open the notice through a Carta log-in.")
      : ccrSettingRow("Log in required", "No", "Investors get a direct link to the notice PDF; no Carta log-in needed."));
  }
  if (contacts) {
    rows.push(ccrContactRow("Contact for investor inquiries", ofType("TO")));
    rows.push(ccrContactRow("Contacts to CC", ofType("CC")));
  }
  // Which emails carry the CC contacts only matters when there are some.
  if ("cc_on_primary_contact_only" in s && !(contacts && !ofType("CC").length)) {
    rows.push(s.cc_on_primary_contact_only === true
      ? ccrSettingRow("CC'd on", "Emails to primary contacts only", "CC contacts are copied only on emails to each investor's primary contact.")
      : ccrSettingRow("CC'd on", "Every notice email", "CC contacts are copied on every notice email, including those to secondary contacts."));
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
  { id: "emailpdf", email: true, pdf: true, label: "Email with PDF" },
  { id: "email", email: true, pdf: false, label: "No PDF" },
  { id: "pdf", email: false, pdf: true, label: "No Email" },
  { id: "none", email: false, pdf: false, label: "No notice" },
];

// Release treats an unset email or PDF toggle as on, but the notice carries
// wire details only when that toggle is true, so an unset one is off.
const ccrEmailOn = (r) => r.email_notice_enabled !== false;
const ccrPdfOn = (r) => r.pdf_notice_enabled !== false;
const ccrWireOn = (r) => r.wire_instructions_enabled === true;
// Wire instructions print only on the PDF, and only for an investor who owes the fund money,
// so a missing toggle matters only there.
const ccrWireMissing = (r) => ccrPdfOn(r) && (ccrNum(r.due_to_fund) || 0) > 0 && !ccrWireOn(r);

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


function ccrDeliveryRows() {
  const d = ccrDeliveryState();
  const q = d.q.trim().toLowerCase();
  const rows = _ccr.rows.filter((r) => r.is_participating !== false)
    .filter((r) => {
      if (d.filter === "all") return true;
      if (d.filter === "nowire") return ccrWireMissing(r);
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
    return chip(grp.id, grp.label, g.count === undefined ? null : g.count);
  }));
  // The summary has no wire count, so the chip waits for every row.
  const noWire = _ccr.rowsDone && !short ? participating.filter(ccrWireMissing).length : 0;
  if (noWire) chips.push(chip("nowire", "No Wire details", noWire));

  // Wire details print only on a capital call's notice, so a distribution has no such toggle to review.
  const cols = CCR_DELIVERY_COLS.filter((c) => c.id !== "wire" || !ccrIsDistribution(s));
  const head = cols.map((c) => {
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
      cols.filter((c) => c.on).map((c) => '<td class="ccr-dlv-toggle">' + pill(c.on(r)) + "</td>").join("") +
      "</tr>").join("");
  } else {
    const why = !participating.length && !_ccr.rowsDone ? "Loading investors…"
      : d.q.trim() ? 'No investors match "' + d.q.trim() + '".'
      : !_ccr.rowsDone ? "None of the investors loaded so far are in this group."
      : "No investors in this group.";
    body = '<tr><td colspan="' + cols.length + '" class="ccr-dlv-empty">' + escHtml(why) + "</td></tr>";
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

// The net is the whole story when one bucket makes it up. Anything more —
// a second bucket or an adjustment — earns the breakdown toggle.
function ccrAllocComposed(s) {
  const cols = ccrBucketColumns(s);
  return cols.main.length > 1 || cols.adjustments.length > 0;
}

// The breakdown takes the panel's full width: the sidebar steps aside while it is open.
function ccrWideLayout() {
  const s = _ccr.summary;
  return _ccr.phase === "review" && _ccr.activeTab === "alloc" && _ccr.showDetail && !!s && ccrAllocComposed(s);
}

function ccrAllocPane(s) {
  if (!s) return '<div class="loading-row" style="padding:20px 14px;">Reading the capital call\u2026</div>';
  const isDist = s.activity_type === "distribution";
  const netLabel = isDist ? "Net distribution" : "Net contribution";
  const afterLabel = isDist ? "Distributed after" : "Called after";
  const rows = _ccr.rows.filter((r) => r.is_participating !== false);
  const excluded = _ccr.rows.filter((r) => r.is_participating === false);
  rows.sort((a, b) => (ccrNum(b.commitment) || 0) - (ccrNum(a.commitment) || 0));
  const ccy = s.currency;

  const cols = ccrBucketColumns(s);
  const composed = ccrAllocComposed(s);
  const breakdown = composed && _ccr.showDetail;
  const buckets = breakdown ? cols.main.concat(cols.adjustments) : [];
  const pinL = breakdown ? " ccr-pin-l" : "";
  const pinN = breakdown ? " ccr-pin-net" : "";
  const pinA = breakdown ? " ccr-pin-after" : "";

  const cols_head = (breakdown ? ["Investor", "Partner class"] : ["Investor", "Commitment"])
    .concat(buckets.map((b) => ccrBucketHeader(b)))
    .concat([netLabel, afterLabel]);

  const focus = (b) => (_ccr.focusBucket && String(b.bucket_id) === _ccr.focusBucket ? " ccr-col-focus" : "");
  const bucketCell = (amount, b) => {
    if (ccrNum(amount) === null) return '<td class="ccr-faint' + focus(b) + '">\u2014</td>';
    return b.is_adjustment
      ? '<td class="ccr-adj' + focus(b) + '">' + escHtml(ccrSignedMoney(amount, ccy, ccrAdjSign(b))) + "</td>"
      : '<td class="' + focus(b).trim() + '">' + escHtml(ccrMoney(amount, ccy)) + "</td>";
  };
  const rowCell = (r, b) => {
    const hit = (r.amount_buckets || []).find((ab) => String(ab.bucket_id) === String(b.bucket_id));
    return bucketCell(hit ? hit.amount : null, b);
  };

  const partRows = rows.map((r) =>
    '<tr><td class="' + pinL.trim() + '">' + escHtml(ccrRowLabel(r)) + "</td>" +
    (breakdown
      ? '<td class="ccr-muted ccr-cls ccr-pin-cls">' + escHtml((r.interest && r.interest.class_name) || "") + "</td>"
      : '<td class="ccr-muted">' + escHtml(ccrMoney(r.commitment, ccy)) + "</td>") +
    buckets.map((b) => rowCell(r, b)).join("") +
    '<td class="ccr-strong' + pinN + '">' + escHtml(ccrMoney(isDist ? r.due_to_investor : r.due_to_fund, ccy)) + "</td>" +
    '<td class="ccr-muted' + pinA + '">' + escHtml(ccrPct(isDist
      ? r.post_distribution_percent
      : ccrPick(r, "post_call_percent_inside_commitment", "post_call_percent"))) + "</td></tr>"
  ).join("");

  const partCount = s.participating_interests_count !== null && s.participating_interests_count !== undefined
    ? s.participating_interests_count
    : (_ccr.rowsDone ? rows.length : null);

  const totals = ['<td class="' + pinL.trim() + '">Totals</td>', '<td class="' + (breakdown ? "ccr-pin-cls" : "") + '"></td>']
    .concat(buckets.map((b) => bucketCell(b.total, b)))
    .concat([
      '<td class="' + pinN.trim() + '">' + escHtml(ccrMoney(isDist ? s.total_due_to_investor : s.total_due_to_fund, ccy)) + "</td>",
      '<td class="' + pinA.trim() + '">' + escHtml(ccrPct(isDist
        ? s.total_post_distribution_percent
        : ccrPick(s, "total_post_call_percent_inside_commitment", "total_post_call_percent"))) + "</td>",
    ]);


  // A walk that stopped short must not read as complete: the count the
  // summary folds is the truth, and the note under the table says how many are here.
  const short = _ccr.rowsDone && partCount !== null && rows.length < partCount;
  const shortNote = short
    ? '<p class="ccr-note ccr-pad">Only ' + rows.length + " of " + partCount +
      " participating investors loaded. Totals are the activity's; open the call in Carta for the rest.</p>"
    : "";

  // The fold names fund interests with no row at all; loaded rows can only ever
  // add the zero-amount kind.
  const fold = s.non_participating;
  const npItems = fold && (fold.interests || []).length
    ? fold.interests.map((n) => {
        const i = n.interest || {};
        return { name: i.partner_interest_group_name || i.name || "Unnamed", cls: i.class_name || "",
          commitment: n.commitment, called: n.percent_called_inside_commitment };
      })
    : excluded.map((r) => ({ name: ccrRowLabel(r), cls: (r.interest && r.interest.class_name) || "",
        commitment: r.commitment, called: ccrPick(r, "post_call_percent_inside_commitment", "post_call_percent") }));
  const npCount = fold && fold.count !== null && fold.count !== undefined ? fold.count : excluded.length;
  // The two counts are the table's navigation: which investors it lists.
  const np = _ccr.allocView === "np" && npCount > 0;
  const view = (id, label, n) => '<button class="ccr-dlv-chip' + ((id === "np") === np ? " ccr-dlv-chip-on" : "") +
    '" data-ccr-alloc-view="' + id + '" aria-pressed="' + ((id === "np") === np) + '"' + (n === 0 ? " disabled" : "") + ">" +
    escHtml(label) + (n === null ? "" : "<b>" + n + "</b>") + "</button>";
  const head = '<div class="ccr-alloc-head"><span class="ccr-alloc-views" role="group" aria-label="Investors">' +
      view("part", "Participating", partCount) + view("np", "Non-participating", npCount) +
      (_ccr.rowsDone ? "" : '<span class="ccr-alloc-loading">Loading the rest\u2026</span>') + "</span>" +
    (composed ? '<button class="ccr-detail-toggle" data-ccr-detail>' + (breakdown ? "Hide breakdown" : "Show breakdown") + "</button>" : "") +
    "</div>";

  const width = cols_head.length;
  const npRows = npItems.map((n) =>
    '<tr><td class="' + pinL.trim() + '">' + escHtml(n.name) + "</td>" +
    (breakdown
      ? '<td class="ccr-muted ccr-cls ccr-pin-cls">' + escHtml(n.cls) + "</td>"
      : '<td class="ccr-muted">' + escHtml(ccrMoney(n.commitment, ccy)) + "</td>") +
    buckets.map(() => '<td class="ccr-faint">\u2014</td>').join("") +
    '<td class="ccr-faint' + pinN + '">\u2014</td>' +
    '<td class="ccr-muted' + pinA + '">' + (isDist || ccrNum(n.called) === null ? '<span class="ccr-faint">\u2014</span>' : escHtml(ccrPct(n.called))) + "</td></tr>").join("") +
    (fold && fold.truncated
      ? '<tr><td colspan="' + width + '" class="ccr-note">Showing ' + npItems.length + " of " + npCount + ". " +
        ccrOpenInCarta("See the rest in Carta", "ccr-link-btn") + "</td></tr>"
      : "");
  const body = np ? npRows : partRows;

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

  return '<div class="ccr-alloc">' + head +
    '<div class="ccr-table-wrap"><table class="ccr-table' + (breakdown ? " ccr-table-breakdown" : "") + '"><thead><tr>' +
    cols_head.map((h, i) => {
      const b = buckets[i - 2];
      return '<th class="' +
        (i === 0 ? pinL.trim() : i === 1 && breakdown ? "ccr-pin-cls" : i === cols_head.length - 2 ? pinN.trim()
          : i === cols_head.length - 1 ? pinA.trim() : b ? focus(b).trim() : "") +
        '"' + (b ? ' data-ccr-col="' + escHtml(String(b.bucket_id)) + '"' : "") + ">" + escHtml(h) + "</th>";
    }).join("") +
    "</tr></thead><tbody>" + body +
    (np ? "" : '<tr class="ccr-total">' + totals.join("") + "</tr>") + "</tbody></table></div>" +
    (np ? "" : shortNote + unbackedNote) +
    (_ccr.truncated ? '<p class="ccr-note ccr-pad">Stopped after ' + CCR_MAX_PAGES + " pages; the rest are on the activity.</p>" : "") +
    "</div>";
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

// Only a problem gets a badge. The summary marks only a closed account (is_active
// false), so any other account named on the activity is taken as active.
function ccrAccountPill(kind) {
  return kind === "ok" ? ""
    : kind === "closed" ? '<span class="ccr-pill ccr-pill-bad">Closed</span>'
    : '<span class="ccr-pill ccr-pill-bad">Missing</span>';
}

function ccrAccountGroup(title, pill, body) {
  return '<div class="ccr-pay-group"><div class="ccr-pay-group-title">' + escHtml(title) + (pill ? " " + pill : "") +
    "</div>" + body + "</div>";
}

// Investors owe money on every capital call, and on a distribution that also calls from some of them.
const ccrCollects = (s) => !ccrIsDistribution(s) || (ccrNum(s.total_due_to_fund) || 0) > 0;

// The message sits under the title whether or not an account follows, so a
// missing and a closed account read in the same place.
function ccrPayingFromCallout(kind) {
  return kind === "closed"
    ? ccrCallout("bad", "Active bank account required",
        "The bank account selected for this distribution is closed. Release is held until your Carta team selects " +
        "another: use Request changes and say which account to pay from.")
    : kind === "missing"
    ? ccrCallout("bad", "Bank account required",
        "No paying-from account is named on this distribution. Release is held until your Carta team adds one: " +
        "use Request changes and say which account to pay from.")
    : "";
}

// What a distribution can pay out on release, as [label, value] pairs.
// Folded server-side, so the counts are exact.
function ccrReadinessRows(s) {
  const r = s.distribution_readiness;
  if (!r) return [];
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  return [
    ccrNum(r.ready_for_transfer_amount) === null ? null : ["Ready for transfer", ccrMoney(r.ready_for_transfer_amount, s.currency)],
    n(r.receiving_count) !== null && n(r.unpaid_count) !== null
      ? ["Receiving payment", r.receiving_count + " of " + ccrInvestors(n(r.unpaid_count))] : null,
    // The Wires tab lists these once the rows carry wire status.
    n(r.over_a_year_old_count) && !ccrWiresReady()
      ? ["Instructions over a year old", ccrInvestors(n(r.over_a_year_old_count))] : null,
    n(r.manual_wire_count) ? ["Manual wires", ccrInvestors(n(r.manual_wire_count))] : null,
  ].filter(Boolean);
}

function ccrPayBody(s) {
  const to = ccrCollects(s) ? s.receiving_account : null;
  const from = ccrPayingFromState(s);
  const kvRow = ccrKvRow;

  const maskStr = (v, keepLast) => {
    if (!v) return null;
    const str = String(v);
    return '·'.repeat(Math.max(0, str.length - keepLast)) + str.slice(-keepLast);
  };
  const inlineReveal = (show, key) =>
    '<button class="ccr-pay-inline-reveal" data-ccr-pay-reveal="' + key + '">' +
    (show ? 'Hide details' : 'Show details') + '</button>';
  const kvRowReveal = (label, value, show, key, hasFullNumber) => {
    if (!value) return '';
    return '<div class="ccr-kv"><span class="ccr-k">' + escHtml(label) + '</span>' +
      '<span class="ccr-v">' + escHtml(value) + '</span>' +
      (hasFullNumber ? inlineReveal(show, key) : '') + '</div>';
  };
  const last4 = (a) => a.account_number_last_four ? '····' + a.account_number_last_four : null;
  // The receiving record carries the wire fields investors pay with.
  const wireRows = (a, nameLabel) => {
    const showAcct = _ccr.payShowSensitive.acct;
    const showRouting = _ccr.payShowSensitive.routing;
    return kvRow('Bank name', a.bank_name) +
      kvRow('Bank address', a.bank_address) +
      kvRow(nameLabel, a.account_name) +
      kvRowReveal('Account number', a.account_number ? (showAcct ? a.account_number : maskStr(a.account_number, 4)) : last4(a),
        showAcct, 'acct', !!a.account_number) +
      kvRowReveal('Routing number', a.routing_number ? (showRouting ? a.routing_number : maskStr(a.routing_number, 4)) : null,
        showRouting, 'routing', !!a.routing_number) +
      kvRow('OBI / Memo', a.obi_memo);
  };

  let groups;
  if (to && from.account && ccrSameAccount(from.account, to)) {
    const kind = to.is_active === false || from.kind === "closed" ? "closed" : "ok";
    groups = [ccrAccountGroup("Paying to and from", ccrAccountPill(kind), ccrPayingFromCallout(from.kind) + wireRows(to, "Account name"))];
  } else {
    const toGroup = !ccrCollects(s) ? ""
      : to ? ccrAccountGroup("Paying to", ccrAccountPill(to.is_active === false ? "closed" : "ok"), wireRows(to, "Beneficiary"))
      : s.uses_fbo_contributions ? ccrAccountGroup("Paying to", "", kvRow("Accounts", "Per-partner virtual accounts"))
      : ccrAccountGroup("Paying to", ccrAccountPill("missing"), '<p class="ccr-note">No account is named on this activity.</p>');
    const fromGroup = from.kind === "none" ? ""
      : ccrAccountGroup("Paying from", ccrAccountPill(from.kind), ccrPayingFromCallout(from.kind) +
          (from.account ? kvRow('Bank name', from.account.bank_name) + kvRow('Account name', from.account.account_name) +
            kvRow('Account number', last4(from.account)) : ""));
    // A mixed activity leads with its main direction.
    groups = ccrIsDistribution(s) ? [fromGroup, toGroup] : [toGroup, fromGroup];
  }

  // The allocations table is full-bleed because its cells carry their own
  // inset. These rows do not, so the inset lives on the wrapper.
  return '<div class="ccr-pad">' + groups.join("") + "</div>";
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

const ccrInvestors = (n) => n + (n === 1 ? " investor" : " investors");

// Participating investors who get an email and a PDF, from the delivery toggles; null when not served.
function ccrNoticeCounts(s) {
  const groups = (s && s.notice_delivery) || [];
  if (!groups.length) return null;
  const sum = (on) => groups.reduce((t, g) => t + (on(g) ? Number(g.count) || 0 : 0), 0);
  return { email: sum((g) => g.email_notice_enabled !== false), pdf: sum((g) => g.pdf_notice_enabled !== false) };
}

function ccrConfirmBody() {
  const s = _ccr.summary || {};
  const ccy = s.currency;
  const n = s.participating_interests_count;
  const who = n !== null && n !== undefined ? n : "the participating";
  const dist = ccrIsDistribution(s);
  const r = dist ? s.distribution_readiness : null;
  const sent = ccrNoticeCounts(s);
  const on = s.date_of_notice ? " on " + ccrDate(s.date_of_notice) : "";
  const steps = [
    "Posts the journal entries to " + (s.fund_name || "the fund").replace(/\.$/, "") + ".",
    !sent || sent.pdf === n ? "Generates a notice PDF for each of the " + who + " participating investors."
      : "Generates a notice PDF for " + sent.pdf + " of the " + who + " participating investors.",
    !sent || sent.email === n ? "Emails all " + who + " investors" + on + "."
      : sent.email ? "Emails " + sent.email + " of the " + who + " investors" + on + "."
      : "Emails no investors: email is off for every one.",
    dist
      ? "Pays " + ccrMoney(r ? r.ready_for_transfer_amount : s.total_due_to_investor, ccy) + " to " +
        (r && r.receiving_count !== null && r.receiving_count !== undefined
          ? ccrInvestors(Number(r.receiving_count)) : "investors") +
        (s.due_date ? " on " + ccrDate(s.due_date) : "") + "."
      : "Makes " + ccrMoney(s.total_due_to_fund, ccy) + " due from investors" +
        (s.due_date ? " on " + ccrDate(s.due_date) : "") + ".",
  ];
  if (r && r.on_hold_count) {
    const held = (ccrNum(s.total_due_to_investor) || 0) - (ccrNum(r.ready_for_transfer_amount) || 0);
    steps.push("Holds " + ccrMoney(held, ccy) + " for " + ccrInvestors(Number(r.on_hold_count)) +
      " until their wire instructions are provided.");
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

// Reached without a reply, so whether the journal posted is unknown. Say only what
// is certain: the release is running and leaving does not stop it.
function ccrReleasingBody() {
  return '<div class="ccr-done">' +
    '<div class="ccr-done-title">Release in progress</div>' +
    '<div class="ccr-done-body">' +
      escHtml("Carta is generating notices and posting journals for this capital activity.") +
    "</div>" +
    '<div class="ccr-note">This updates when Carta finishes. You can close it: ' +
    "the task waits under In progress until then.</div></div>";
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
    '<div class="ccr-note">' + (released ? "It's off your task list." : "This task has moved to In progress.") + "</div></div>";
}

// ── Change request ────────────────────────────────────────────────────────
// What the reviewer has written for Carta but not yet sent, per activity. It is
// kept on this computer where storage allows, so closing the panel or reloading
// the page does not lose it.

const CCR_DRAFTS_KEY = "cartaWorkhub.ccrChangeDrafts";
const _ccrMemDrafts = {};

function ccrDrafts() {
  if (!farStorageOk()) return _ccrMemDrafts;
  try { return JSON.parse(localStorage.getItem(CCR_DRAFTS_KEY) ?? "{}") || {}; } catch (e) { return {}; }
}

const ccrDraft = (activityId) => ccrDrafts()[activityId] || "";

// The line a Request change link starts, keyed by where it sits; "tab" follows the open tab.
const CCR_CHANGE_LABELS = {
  payment: "Payment account",
  alloc: "Allocations",
  notice: "Notice/Email customizations",
  delivery: "Delivery settings",
  wires: "Wire instructions",
};

// A label with nothing after it is a prompt, not content: it neither sends nor counts as an edit.
function ccrChangeContent(text) {
  return String(text || "").split("\n").filter((l) => !/^[^:\n]{1,40}:\s*$/.test(l.trim())).join("\n").trim();
}

// Adds the label on its own line, once; returns the text and where the caret goes.
function ccrWithLabel(text, label) {
  const lines = String(text || "").replace(/\s+$/, "").split("\n");
  const at = lines.findIndex((l) => l.trim().toLowerCase().startsWith(label.toLowerCase() + ":"));
  if (at >= 0) {
    const caret = lines.slice(0, at + 1).join("\n").length;
    return { text: lines.join("\n"), caret: caret };
  }
  const base = lines.join("\n").trim() ? lines.join("\n") + "\n" : "";
  const out = base + label + ": ";
  return { text: out, caret: out.length };
}

const ccrChangesDirty = () => ccrChangeContent(_ccr.changeText) !== ccrChangeContent(ccrDraft(_ccr.target.activityId));

function ccrSetDraft(activityId, text) {
  const all = ccrDrafts();
  if (String(text || "").trim()) all[activityId] = text; else delete all[activityId];
  if (!farStorageOk()) return;
  try { localStorage.setItem(CCR_DRAFTS_KEY, JSON.stringify(all)); } catch (e) { /* storage full: this draft lasts the session */ }
}

// Release or a request is only offered while nothing holds the panel.
function ccrCanRequest() {
  const s = _ccr.summary;
  if (!s || _ccr.error || _ccr.locked) return false;
  return !ccrBlockers(s).some((b) => b.locks);
}

function ccrHeadline(s) {
  return ccrIsDistribution(s)
    ? (ccrNum(s.net_distribution_amount) !== null ? s.net_distribution_amount : s.total_due_to_investor)
    : (ccrNum(s.gross_call_amount) !== null ? s.gross_call_amount : s.total_due_to_fund);
}

// A pencil for every way into Request changes.
const CCR_EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
  '<path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9a2 2 0 0 1-.85.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85Z"></path></svg>';

// ── Right-hand subpages ───────────────────────────────────────────────────

const ccrLpRows = (snap) => (snap || _ccr).rows.filter((r) => r.is_participating !== false);

// A tab with something to look at says so: Delivery with a dot, Wires with how
// many investors' instructions are missing.
function ccrSubnav() {
  const s = _ccr.summary;
  const missing = ccrWiresMissing();
  const tabs = [
    { id: "alloc", label: "Allocations" },
    { id: "notice", label: "Notice" },
    { id: "delivery", label: "Delivery", dot: !!s && ccrDeliveryFlagged(s) },
  ].concat(ccrWiresReady() ? [{ id: "wires", label: "Wires", count: missing }] : []);
  return '<div class="ccr-subnav" role="tablist">' + tabs.map((t) => {
    const on = _ccr.activeTab === t.id;
    const badge = t.count ? '<span class="ccr-tab-count" aria-label="' + ccrInvestors(t.count) + ' missing wire instructions">' + t.count + "</span>"
      : t.dot ? '<span class="ccr-tab-dot" aria-label="needs a look"></span>' : "";
    return '<button class="ccr-subtab' + (on ? " ccr-subtab-on" : "") + '" role="tab" aria-selected="' + on +
      '" data-ccr-tab="' + t.id + '">' + escHtml(t.label) + badge + "</button>";
  }).join("") +
    '<span class="ccr-subnav-end"><button class="ccr-edit ccr-edit-icon" data-ccr-modal="changes" data-ccr-prefix="tab"' +
      ' aria-label="Request change" title="Request change"' + (ccrCanRequest() ? "" : " disabled") + ">" + CCR_EDIT_ICON + "</button></span>" +
    "</div>";
}

// One investor on screen, and which of their two documents is showing.
function ccrDocBar() {
  const pdf = _ccr.docTab === "pdf";
  return '<div class="ccr-notice-bar"><select id="ccr-lp" aria-label="Investor">' +
    ccrLpRows().map((r, i) => '<option value="' + i + '"' + (i === _ccr.lpIndex ? " selected" : "") + ">" +
      escHtml(ccrRowLabel(r)) + "</option>").join("") +
    "</select>" +
    '<span class="ccr-tabs">' +
      (window.pdfjsLib ? '<button class="ccr-tab' + (pdf ? " ccr-tab-on" : "") + '" data-ccr-doc="pdf">PDF</button>' : "") +
      '<button class="ccr-tab' + (pdf ? "" : " ccr-tab-on") + '" data-ccr-doc="email">Email</button>' +
    "</span></div>";
}

function ccrNoticeTabBody() {
  if (!ccrLpRows().length) return ccrNoInvestors();
  return _ccr.docTab === "pdf" ? ccrNoticeDoc() : ccrEmailPane();
}

function ccrNoInvestors() {
  return _ccr.loading || !_ccr.rowsDone
    ? '<div class="loading-row" style="padding:20px 0;">Loading investors…</div>'
    : '<div class="ccr-empty"><p>No participating investors on this call.</p></div>';
}

function ccrEmailPane() {
  if (_ccr.emailError) {
    return '<div class="ccr-empty"><p>This email could not be previewed.</p>' +
      '<p class="ccr-note">' + escHtml(_ccr.emailError) + "</p></div>";
  }
  if (!_ccr.email) return '<div class="loading-row" style="padding:16px 0;">Rendering the email…</div>';
  const e = _ccr.email;
  const label = (d) => d.name ? d.name + " <" + d.email + ">" : d.email;
  const addrs = (kind) => (e.recipients || []).filter((d) => d.addr_type === kind).map(label).join(", ");
  // The body is the email's own document; a scriptless frame shows it as the
  // investor receives it and keeps it out of this page's DOM and styles.
  return '<div class="ccr-mail-head">' +
      '<div class="ccr-mail-subject">' + escHtml(e.subject || "") + "</div>" +
      '<div class="ccr-mail-addr">To: ' + escHtml(addrs("TO")) + "</div>" +
      '<div class="ccr-mail-addr">CC: ' + escHtml(addrs("CC")) + "</div>" +
    "</div>" +
    (e.body_format === "html"
      ? '<iframe class="ccr-mail-frame" sandbox="" title="Email preview" srcdoc="' + escHtml(e.body || "") + '"></iframe>'
      : '<div class="ccr-mail-body">' + escHtml(e.body || "").replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") + "</div>") +
    ((e.body || "").indexOf("[/LINK_CARTA]") !== -1
      ? '<div class="ccr-caveat"><span class="ccr-caveat-arrow">&#8593;</span>' +
        "<span>Preview only: the address ends in the placeholder [/LINK_CARTA] instead of a " +
        "link. Each investor's sent email carries a working link to their own capital call. " +
        "Everything else here is final.</span></div>"
      : "");
}

// ── Review body ───────────────────────────────────────────────────────────

// Adjustments past this many fold into "+N more", so the box never outgrows its column.
const CCR_SUMMARY_ADJ_MAX = 3;

// The call at a glance: what it asks for, when, and what is credited against it.
function ccrSummaryBox(s) {
  if (!s) {
    return '<section class="ccr-sheet ccr-sum" aria-label="Summary"><p class="ccr-note">' +
      escHtml(_ccr.error ? "Could not read this capital call." : "Reading the capital call…") + "</p></section>";
  }
  const ccy = s.currency;
  const dist = ccrIsDistribution(s);
  const dateRow = (label, v) => '<div class="ccr-sum-row"><span class="ccr-sum-k">' + escHtml(label) + "</span>" +
    '<span class="ccr-sum-v ccr-sum-date">' + escHtml(ccrDate(v)) + "</span></div>";
  const sumRow = ([label, v]) => '<div class="ccr-sum-row"><span class="ccr-sum-k">' + escHtml(label) + "</span>" +
    '<span class="ccr-sum-v">' + escHtml(v) + "</span></div>";
  const readiness = ccrReadinessRows(s);
  const adjLine = (b) => (b.display_name || b.slug || "Adjustment") + " " + ccrSignedMoney(b.total, ccy, ccrAdjSign(b));

  const adj = ccrBucketColumns(s).adjustments;
  const rest = adj.slice(CCR_SUMMARY_ADJ_MAX);
  const adjustments = adj.length
    ? '<div class="ccr-sum-group"><span class="ccr-sum-k">Adjustments</span>' +
      adj.slice(0, CCR_SUMMARY_ADJ_MAX).map((b) =>
        '<button class="ccr-sum-item ccr-sum-adj" data-ccr-adj="' + escHtml(String(b.bucket_id)) + '">' +
        "<span>" + escHtml(b.display_name || b.slug || "Adjustment") + "</span>" +
        "<span>" + escHtml(ccrSignedMoney(b.total, ccy, ccrAdjSign(b))) + "</span></button>").join("") +
      (rest.length
        ? '<button class="ccr-sum-more" data-ccr-adj="" title="' + escHtml(rest.map(adjLine).join("\n")) + '">+' + rest.length + " more</button>"
        : "") +
      "</div>"
    : "";

  return '<section class="ccr-sheet ccr-sum" aria-label="Summary">' +
    '<div><span class="ccr-card-label">' + (dist ? "Total being distributed" : "Total being called") + "</span>" +
    '<div class="ccr-card-figure">' + escHtml(ccrMoney(ccrHeadline(s), ccy)) + "</div></div>" +
    '<div class="ccr-sum-list">' +
      '<div class="ccr-sum-rows">' + dateRow("Notice date", s.date_of_notice) +
        dateRow(dist ? "Payment date" : "Due date", s.due_date) + "</div>" +
      adjustments +
      (readiness.length ? '<div class="ccr-sum-rows">' + readiness.map(sumRow).join("") + "</div>" : "") +
    "</div>" +
    "</section>";
}

// The Delivery tab: each investor's toggles, then the settings that apply to
// every notice email. Always shown, since every activity has investors.
function ccrSettingsTabBody(s) {
  if (!s) return '<div class="loading-row" style="padding:20px 0;">Reading the capital call\u2026</div>';
  const rows = ccrSettingsRows(s);
  return '<div class="ccr-dlv-head"><span class="ccr-dlv-title">Delivery</span></div>' +
    ccrDeliveryTable(s) +
    '<div class="ccr-dlv-head ccr-dlv-head-next"><span class="ccr-dlv-title">Email settings</span>' +
      '<span class="ccr-dlv-summary">Apply to every investor</span></div>' +
    (rows.length
      ? '<div class="ccr-card ccr-settings"><div class="ccr-card-list">' + rows.join("") + "</div></div>"
      : '<div class="ccr-empty"><p>Carta did not serve the email settings for this call.</p></div>');
}

// Whether any investor misses part of the notice: no notice, no email, no PDF, or a
// call's notice without the wire details they need. The wire check waits for every row.
function ccrDeliveryFlagged(s) {
  if ((s.notice_delivery || []).some((g) => g.count && !(g.email_notice_enabled !== false && g.pdf_notice_enabled !== false))) return true;
  const rows = ccrLpRows();
  const all = s.participating_interests_count;
  return _ccr.rowsDone && all !== null && all !== undefined && rows.length === all && rows.some(ccrWireMissing);
}

// Where the money goes, and for a distribution where it comes from.
function ccrPaymentCard(s) {
  return '<section class="ccr-sheet ccr-pay-card" aria-label="Payment information">' +
    '<div class="ccr-sheet-head"><span class="ccr-card-label">Payment information</span>' +
      '<button class="ccr-edit ccr-edit-icon" data-ccr-modal="changes" data-ccr-prefix="payment"' +
        ' aria-label="Request change" title="Request change"' + (ccrCanRequest() ? "" : " disabled") + ">" + CCR_EDIT_ICON + "</button></div>" +
    (s ? ccrPayBody(s) : '<p class="ccr-note">Reading the capital call\u2026</p>') +
    "</section>";
}

// The preparer's note, read before the tabs.
function ccrReviewCallouts(s) {
  const p = s && s.preparation;
  if (!p || !p.note) return "";
  return '<div class="ccr-callouts"><div class="ccr-note-box"><span class="ccr-note-icon">→</span><span class="ccr-note-main">' +
    '<span class="ccr-note-head">' + escHtml((p.note_author || p.prepared_by || "Your Carta team") + " left a note") +
    '<button class="ccr-note-toggle" data-ccr-note>' + (_ccr.noteOpen ? "Show less" : "Read full note") + "</button></span>" +
    '<span class="' + (_ccr.noteOpen ? "ccr-note-full" : "ccr-note-clamp") + '">' + escHtml(p.note) + "</span>" +
    "</span></div></div>";
}

function ccrReviewBody() {
  if (_ccr.error === "unlinked") {
    return '<div class="ccr-layout"><div class="ccr-empty"><p>This task is not linked to a capital activity that this page can read.</p>' +
      "<p class='ccr-note'>The workflow row carries no fund and activity id the review commands accept. Open the call in Carta to review it. " +
      ccrOpenInCarta() + "</p></div></div>";
  }
  if (_ccr.error) {
    return '<div class="ccr-layout"><div class="ccr-empty"><p>Could not read this capital call.</p>' +
      '<p class="ccr-note">' + escHtml(_ccr.error) + " " + ccrOpenInCarta("Review it in Carta") + "</p></div></div>";
  }
  const pane = _ccr.activeTab === "notice" ? ccrNoticeTabBody()
    : _ccr.activeTab === "alloc" ? ccrAllocPane(_ccr.summary)
    : _ccr.activeTab === "wires" ? ccrWiresTabBody(_ccr.summary)
    : ccrSettingsTabBody(_ccr.summary);
  const bar = _ccr.activeTab === "notice" && ccrLpRows().length ? ccrDocBar() : "";
  // Drawn in the state it was last shown in; ccrRender moves it to the new one, so the change animates.
  const wide = _ccr.layoutFrom;
  return '<div class="ccr-layout' + (wide ? " ccr-layout-wide" : "") + '">' +
    '<aside class="ccr-side"' + (wide ? ' aria-hidden="true"' : "") + '><div class="ccr-side-inner">' +
      ccrSummaryBox(_ccr.summary) + ccrPaymentCard(_ccr.summary) + "</div></aside>" +
    '<section class="ccr-main">' + ccrReviewCallouts(_ccr.summary) + ccrSubnav() + bar +
      '<div class="ccr-main-body' + (_ccr.activeTab === "alloc" ? " ccr-main-alloc" : "") + '">' + pane + "</div></section>" +
    "</div>";
}

// ── Footer and modals ─────────────────────────────────────────────────────

function ccrFooter() {
  const s = _ccr.summary;
  if (_ccr.phase === "confirm") {
    const sent = ccrNoticeCounts(s);
    const n = sent ? sent.email : s && s.participating_interests_count;
    const hold = ccrReleaseHold();
    return '<div class="far-panel-footer ccr-footer-end">' +
      (hold ? '<span class="ccr-note ccr-hold">' + escHtml(hold) + "</span>" : "") +
      '<button class="far-btn-secondary" data-ccr-phase="review"' + (_ccr.releasing ? " disabled" : "") + ">Back to review</button>" +
      '<button class="far-btn-primary" id="ccr-do-approve" data-ccr-approve' + (hold || _ccr.releasing ? " disabled" : "") + ">" +
        (_ccr.releasing ? "Releasing…" : "Release" + (n ? " and email " + ccrInvestors(n) : "")) +
      "</button></div>";
  }
  if (_ccr.phase !== "review") {
    return '<div class="far-panel-footer far-panel-footer-center">' +
      '<button class="far-btn-primary" data-ccr-close>Back to tasks</button></div>';
  }
  const blocked = !s || _ccr.error || _ccr.locked;
  // A reason that locks the panel leads, so the one line shows what the reviewer must do first.
  const blockers = blocked ? [] : ccrBlockers(s).sort((x, y) => (y.locks ? 1 : 0) - (x.locks ? 1 : 0));
  const pending = !!ccrDraft(_ccr.target.activityId).trim();
  const lines = (_ccr.releaseNote ? [escHtml(_ccr.releaseNote)] : [])
    .concat(blockers.map((b) => b.html || escHtml(b.text)))
    .concat(pending ? [escHtml("Send or cancel your request for changes to approve.")] : []);
  return '<div class="far-panel-footer ccr-foot">' +
    '<div class="ccr-foot-side"><button class="ccr-changes-btn" data-ccr-modal="changes"' + (ccrCanRequest() ? "" : " disabled") + ">" +
      CCR_EDIT_ICON + "Request changes" + (pending ? '<span class="ccr-dot" aria-label="a request is waiting to send"></span>' : "") + "</button></div>" +
    '<div class="ccr-foot-main">' +
      // One line by default, never cut: further reasons open in place.
      (_ccr.blockersOpen ? lines : lines.slice(0, 1)).map((t, i) =>
        '<span class="ccr-blocker">' + t +
        (i === 0 && lines.length > 1
          ? ' <button class="ccr-blocker-more" data-ccr-blockers>' + (_ccr.blockersOpen ? "Show less" : "+" + (lines.length - 1) + " more") + "</button>"
          : "") + "</span>").join("") +
      '<button class="far-btn-primary ccr-approve" data-ccr-phase="confirm"' + (blocked || blockers.length || pending ? " disabled" : "") +
        ">Approve and release</button>" +
    "</div></div>";
}

function ccrModal(title, bodyHtml, footHtml, wide) {
  return '<div class="ccr-scrim" data-ccr-scrim>' +
    '<div class="ccr-modal' + (wide ? " ccr-modal-wide" : "") + '" role="dialog" aria-modal="true" aria-labelledby="ccr-modal-title">' +
      '<div class="ccr-modal-head"><span class="ccr-modal-title" id="ccr-modal-title">' + escHtml(title) + "</span>" +
        '<button class="far-panel-close" data-ccr-modal-close aria-label="Close">✕</button></div>' +
      '<div class="ccr-modal-body">' + bodyHtml + "</div>" +
      '<div class="ccr-modal-foot">' + footHtml + "</div>" +
    "</div></div>";
}

function ccrCloseChanges() {
  _ccr.modal = null;
  _ccr.confirmDiscard = false;
  _ccr.changeText = "";
  ccrRender();
}

// Back to the text, with the caret at its end where the reader was most likely typing.
function ccrKeepEditing() {
  _ccr.confirmDiscard = false;
  _ccr.autofocus = "ccr-change-text";
  _ccr.caretAt = (_ccr.changeText || "").length;
  ccrRender();
}

function ccrTryCloseChanges() {
  if (_ccr.sending) return;
  if (ccrChangesDirty()) { _ccr.confirmDiscard = true; ccrRender(); return; }
  ccrCloseChanges();
}

function ccrChangesModal() {
  const has = !!ccrChangeContent(_ccr.changeText);
  const body =
    '<p class="ccr-modal-lede">This goes to your Carta fund admin team as written. ' +
    "They redo the work and send it back for review. Nothing reaches investors.</p>" +
    '<textarea id="ccr-change-text" class="far-textarea" rows="7" aria-label="Changes to request">' +
      escHtml(_ccr.changeText || "") + "</textarea>" +
    '<p class="ccr-note">This task moves to In progress until it comes back to you.</p>';
  const foot = _ccr.confirmDiscard
    ? '<span class="ccr-grow ccr-discard-note">Discard your unsaved changes?</span>' +
      '<button class="far-btn-secondary" data-ccr-keep>Keep editing</button>' +
      '<button class="far-btn-primary ccr-btn-danger" data-ccr-discard>Discard changes</button>'
    : '<span class="ccr-grow"></span>' +
      '<button class="far-btn-secondary" data-ccr-save-continue>Save and continue</button>' +
      '<button class="far-btn-primary" id="ccr-send-changes" data-ccr-send' + (has && !_ccr.sending ? "" : " disabled") + ">" +
        (_ccr.sending ? "Sending…" : "Send to Carta") + "</button>";
  return ccrModal("Request changes", body, foot, false);
}

// ── Render ────────────────────────────────────────────────────────────────

function ccrRender() {
  const overlay = document.getElementById("ccr-overlay");
  if (!overlay) return;
  const s = _ccr.summary;
  const reviewing = _ccr.phase === "review";
  // Settled before the body is built: the body draws the layout in the state it starts from.
  const wide = ccrWideLayout();
  _ccr.layoutFrom = _ccr.renderedWide === undefined ? wide : _ccr.renderedWide;
  _ccr.renderedWide = wide;

  const body = _ccr.phase === "confirm" ? ccrConfirmBody()
    : _ccr.phase === "releasing" ? ccrReleasingBody()
    : _ccr.phase === "released" ? ccrDoneBody(true)
    : _ccr.phase === "sent" ? ccrDoneBody(false)
    : ccrReviewBody();

  // Every walked page of rows re-renders the panel, so whatever the reader is
  // typing into keeps its caret, and each scroller its position, across the swap.
  const focused = document.activeElement;
  const focusId = focused && overlay.contains(focused) && focused.id ? focused.id : null;
  const caret = focusId && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;
  const keep = {};
  [".ccr-side", ".ccr-main-body", ".ccr-dlv-box", ".ccr-modal-body", ".ccr-table-wrap"].forEach((sel) => {
    const el = overlay.querySelector(sel);
    if (el) keep[sel] = [el.scrollTop, el.scrollLeft];
  });
  const view = [_ccr.activeTab, _ccr.docTab, _ccr.lpIndex].join("|");
  const sameTab = _ccr.renderedTab === view;
  _ccr.renderedTab = view;

  const sub = [s && s.fund_name, s && s.preparation && s.preparation.prepared_by
    ? "Prepared by " + s.preparation.prepared_by + (s.preparation.prepared_on ? ", " + ccrDate(s.preparation.prepared_on) : "")
    : null].filter(Boolean).join(" · ");

  overlay.innerHTML =
    '<div class="far-panel ccr-panel">' +
      '<div class="far-panel-header">' +
        '<span class="far-panel-title">' + escHtml(ccrPanelTitle(s)) + "</span>" +
        '<span class="ccr-panel-sub">' + escHtml(sub) + (sub && ccrOpenInCarta() ? " · " : "") + ccrOpenInCarta() + "</span>" +
        '<button class="far-panel-close" data-ccr-close aria-label="Close">✕</button>' +
      "</div>" +
      '<div class="far-panel-body ccr-body' + (reviewing ? " ccr-body-split" : "") + '">' + body + "</div>" +
      ccrFooter() +
      (reviewing && _ccr.modal === "changes" ? ccrChangesModal() : "") +
    "</div>";

  Object.keys(keep).forEach((sel) => {
    if (sel === ".ccr-main-body" && !sameTab) return;
    const el = overlay.querySelector(sel);
    if (el) { el.scrollTop = keep[sel][0]; el.scrollLeft = keep[sel][1]; }
  });
  ccrBind(overlay);

  const want = _ccr.autofocus || focusId;
  _ccr.autofocus = null;
  const target = want ? document.getElementById(want) : null;
  if (target) {
    target.focus();
    if (_ccr.caretAt !== null && want === "ccr-change-text") {
      target.setSelectionRange(_ccr.caretAt, _ccr.caretAt);
      _ccr.caretAt = null;
    } else if (caret && want === focusId && typeof target.setSelectionRange === "function" && target.type !== "date") {
      try { target.setSelectionRange(caret[0], caret[1]); } catch (e) { /* inputs without a selection */ }
    }
  }

  const layout = overlay.querySelector(".ccr-layout");
  if (layout && _ccr.layoutFrom !== wide) {
    void layout.offsetWidth;  // commit the old state first, or the browser skips the transition
    layout.classList.toggle("ccr-layout-wide", wide);
    const side = layout.querySelector(".ccr-side");
    if (wide) side.setAttribute("aria-hidden", "true"); else side.removeAttribute("aria-hidden");
    side.addEventListener("transitionend", (e) => { if (e.target === side && e.propertyName === "width") ccrMeasureTable(overlay); });
  }
  ccrMeasureTable(overlay);
  if (reviewing && _ccr.activeTab === "notice" && _ccr.docTab === "pdf" && _ccr.pdf) ccrPaintPdf();
}

// Pinned columns need the rendered width of the last one, and the scroll shadow
// needs to know whether the table overflows. Both change when the layout widens.
function ccrMeasureTable(root) {
  const wrap = root.querySelector(".ccr-table-wrap");
  if (!wrap) return;
  const first = wrap.querySelector("th.ccr-pin-l");
  if (first) wrap.style.setProperty("--ccr-pin-l-w", first.offsetWidth + "px");
  const last = wrap.querySelector("th.ccr-pin-after");
  if (last) wrap.style.setProperty("--ccr-pin-after-w", last.offsetWidth + "px");
  wrap.classList.toggle("ccr-overflow", wrap.scrollWidth > wrap.clientWidth + 1);
}

// Brings a bucket column into view between the pinned columns on either side.
function ccrScrollToColumn(bucketId) {
  const o = document.getElementById("ccr-overlay");
  const wrap = o && o.querySelector(".ccr-table-wrap");
  const th = wrap && [...wrap.querySelectorAll("th[data-ccr-col]")].find((el) => el.getAttribute("data-ccr-col") === bucketId);
  if (!th) return;
  const width = (sel) => [...wrap.querySelectorAll(sel)].reduce((w, el) => w + el.offsetWidth, 0);
  const left = th.offsetLeft - width("th.ccr-pin-l, th.ccr-pin-cls");
  const right = th.offsetLeft + th.offsetWidth - (wrap.clientWidth - width("th.ccr-pin-net, th.ccr-pin-after"));
  if (wrap.scrollLeft > left) wrap.scrollLeft = left;
  else if (wrap.scrollLeft < right) wrap.scrollLeft = right;
}

function ccrBind(root) {
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));

  on("[data-ccr-close]", "click", () => ccrClose());
  on("[data-ccr-phase]", "click", (el) => {
    const phase = el.getAttribute("data-ccr-phase");
    if (phase === "confirm") trackWorkhub("click", "CartaWorkhub.CapitalCallReview.OpenRelease");
    _ccr.phase = phase;
    ccrRender();
  });
  on("[data-ccr-tab]", "click", (el) => {
    const id = el.getAttribute("data-ccr-tab");
    if (id === _ccr.activeTab) return;
    trackWorkhub("click", "CartaWorkhub.CapitalCallReview.Tab." + id);
    _ccr.activeTab = id;
    ccrRender();
    ccrLoadActiveDoc();
  });
  on("[data-ccr-modal]", "click", (el) => {
    const key = el.getAttribute("data-ccr-prefix");
    trackWorkhub("click", "CartaWorkhub.CapitalCallReview.OpenChanges" + (key ? "." + key : ""));
    const saved = ccrDraft(_ccr.target.activityId);
    const label = CCR_CHANGE_LABELS[key === "tab" ? _ccr.activeTab : key];
    const start = label ? ccrWithLabel(saved, label) : { text: saved, caret: saved.length };
    _ccr.changeText = start.text;
    _ccr.caretAt = start.caret;
    _ccr.autofocus = "ccr-change-text";
    _ccr.confirmDiscard = false;
    _ccr.modal = "changes";
    ccrRender();
  });
  on("[data-ccr-modal-close]", "click", () => ccrTryCloseChanges());
  on("[data-ccr-scrim]", "click", (el, e) => { if (e.target === el) ccrTryCloseChanges(); });
  on("#ccr-change-text", "input", (el) => {
    _ccr.changeText = el.value;
    const send = root.querySelector("#ccr-send-changes");
    if (send && !_ccr.sending) send.disabled = !ccrChangeContent(el.value);
  });
  on("[data-ccr-save-continue]", "click", () => {
    trackWorkhub("click", "CartaWorkhub.CapitalCallReview.SaveChanges");
    // A draft holding only labels is no draft: saving it clears the saved request.
    ccrSetDraft(_ccr.target.activityId, ccrChangeContent(_ccr.changeText) ? _ccr.changeText.replace(/\s+$/, "") : "");
    ccrCloseChanges();
  });
  on("[data-ccr-keep]", "click", () => ccrKeepEditing());
  on("[data-ccr-discard]", "click", () => {
    trackWorkhub("click", "CartaWorkhub.CapitalCallReview.DiscardChanges");
    ccrCloseChanges();
  });
  on("[data-ccr-send]", "click", () => ccrSubmitChanges());
  on("[data-ccr-approve]", "click", () => ccrApprove());
  on("[data-ccr-consent]", "change", (el) => {
    _ccr.consent[el.getAttribute("data-ccr-consent")] = !!el.checked;
    ccrRender();
  });

  on("[data-ccr-detail]", "click", () => { _ccr.showDetail = !_ccr.showDetail; ccrRender(); });
  // An adjustment in the summary opens the breakdown at its column; the sidebar
  // slides away first, so the scroll waits for that.
  on("[data-ccr-adj]", "click", (el) => {
    const id = el.getAttribute("data-ccr-adj") || null;
    trackWorkhub("click", "CartaWorkhub.CapitalCallReview.SummaryAdjustment");
    _ccr.activeTab = "alloc";
    _ccr.allocView = "part";
    _ccr.showDetail = true;
    _ccr.focusBucket = id;
    ccrRender();
    if (!id) return;
    const snap = _ccr;
    setTimeout(() => { if (_ccr === snap) ccrScrollToColumn(id); }, 320);
    setTimeout(() => { if (_ccr === snap && _ccr.focusBucket === id) _ccr.focusBucket = null; }, 2000);
  });
  on("[data-ccr-alloc-view]", "click", (el) => { _ccr.allocView = el.getAttribute("data-ccr-alloc-view"); ccrRender(); });

  on("[data-ccr-note]", "click", () => { _ccr.noteOpen = !_ccr.noteOpen; ccrRender(); });
  on("[data-ccr-blockers]", "click", () => { _ccr.blockersOpen = !_ccr.blockersOpen; ccrRender(); });
  on("[data-ccr-pay-reveal]", "click", (el) => {
    const key = el.getAttribute("data-ccr-pay-reveal");
    _ccr.payShowSensitive[key] = !_ccr.payShowSensitive[key];
    ccrRender();
  });
  on("[data-ccr-dlv-fold]", "click", () => { _ccr.deliveryOpen = !_ccr.deliveryOpen; ccrRender(); });
  on("[data-ccr-dlv-filter]", "click", (el) => {
    const d = ccrDeliveryState();
    const id = el.getAttribute("data-ccr-dlv-filter");
    d.filter = d.filter === id && id !== "all" ? "all" : id;
    ccrRender();
  });
  on("[data-ccr-dlv-sort]", "click", (el) => {
    const d = ccrDeliveryState();
    const id = el.getAttribute("data-ccr-dlv-sort");
    if (id === "reset") { d.sort = null; d.dir = 1; }
    else if (d.sort === id) d.dir = -d.dir;
    else { d.sort = id; d.dir = 1; }
    ccrRender();
  });
  on("#ccr-dlv-search", "input", (el) => { ccrDeliveryState().q = el.value; ccrRender(); });
  on("#ccr-lp", "change", (el) => ccrSelectLp(Number(el.value)));

  on("[data-ccr-wire-filter]", "click", (el) => {
    const id = el.getAttribute("data-ccr-wire-filter");
    _ccr.wireView.filter = _ccr.wireView.filter === id && id !== "all" ? "all" : id;
    ccrRender();
  });

  on("[data-ccr-doc]", "click", (el) => {
    const doc = el.getAttribute("data-ccr-doc");
    if (doc === _ccr.docTab) return;
    if (doc === "pdf") trackWorkhub("click", "CartaWorkhub.CapitalCallReview.NoticePdf");
    _ccr.docTab = doc;
    ccrRender();
    ccrLoadActiveDoc();
  });

  const frame = root.querySelector(".ccr-mail-frame");
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
}

// Escape backs out one step: the discard question, else the modal itself.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !_ccr || _ccr.phase !== "review") return;
  const overlay = document.getElementById("ccr-overlay");
  if (!overlay || !overlay.classList.contains("far-overlay-visible")) return;
  if (!_ccr.modal) return;
  if (_ccr.confirmDiscard) ccrKeepEditing();
  else ccrTryCloseChanges();
});

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
  ccrLoadActiveDoc();
}

// Each document costs a render on Carta's side, so only the one on screen is fetched.
function ccrLoadActiveDoc() {
  if (_ccr.activeTab !== "notice") return;
  if (_ccr.docTab === "pdf") {
    if (window.pdfjsLib && !_ccr.pdf && !_ccr.pdfLoading && !_ccr.pdfError) ccrLoadPdf();
  } else if (!_ccr.email && !_ccr.emailError) {
    ccrLoadEmail();
  }
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
  const row = ccrLpRows()[_ccr.lpIndex];
  if (!row || !row.interest || row.interest.id == null) {
    _ccr.pdfError = "This row carries no interest id, so its notice cannot be rendered.";
    ccrRender();
    return;
  }

  if (CCR_IS_DEMO) {
    _ccr.pdfError = "PDF preview is not available in demo mode.";
    ccrRender();
    return;
  }

  const snap = _ccr;
  const interestId = row.interest.id;
  snap.pdfError = null;
  snap.pdf = ccrDocHit("pdf", snap.target.activityId, interestId);
  if (snap.pdf) {
    snap.pdfLoading = false;
    ccrRender();
    return;
  }
  snap.pdfLoading = true;

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
    ccrRender();
  }
}

function ccrNoticeDoc() {
  if (!window.pdfjsLib) {
    return '<div class="ccr-empty"><p>This build carries no PDF renderer, so the notice cannot be shown here.</p>' +
      '<p class="ccr-note">Open the capital call in Carta and use Preview notice. The email on the Delivery tab is unaffected.</p></div>';
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
  const o = document.getElementById("ccr-overlay");
  if (o) o.classList.remove("far-overlay-visible");
  farFetchRequests();
}

function openCapitalCallReview(target, title) {
  trackWorkhub("click", "CartaWorkhub.CapitalCallReview.Open");
  ccrReset(target, title);
  const id = target.activityId;
  if (_ccrReleasing[id]) _ccr.phase = "releasing";
  else if (_ccrReleased.has(id)) _ccr.phase = "released";
  else if (_ccrUnconfirmed.has(id)) ccrLockUnconfirmed();
  const overlay = farEnsureOverlay("ccr-overlay", "far-overlay");
  // The shared overlay closes on any backdrop click. With the change-request modal open
  // that would drop unsaved text, so the click goes through the modal's own close first.
  if (!overlay.dataset.ccrGuard) {
    overlay.dataset.ccrGuard = "1";
    overlay.addEventListener("click", (e) => {
      if (e.target !== overlay || !_ccr || !_ccr.modal) return;
      e.stopImmediatePropagation();
      ccrTryCloseChanges();
    }, true);
  }
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

// The queue's review cards as this page knows them. A released call leaves the
// queue even when a list read before the release committed still carries it; one
// still releasing is Carta's work, not the reviewer's. A build that names an
// activity gets one card for it, so the panel is reachable without a live review
// task to open it from.
function ccrQueueRows(rows) {
  const out = (rows || []).filter((r) => !(r.ccr && _ccrReleased.has(r.ccr.activityId)));
  const seed = CCR_TARGET.activityId;
  if (CCR_TARGET.fundUuid && seed && !_ccrReleased.has(seed) && !out.some((r) => r.ccr && r.ccr.activityId === seed)) {
    out.unshift({
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
      ccr: { fundUuid: CCR_TARGET.fundUuid, activityId: seed },
    });
  }
  return out.map((r) => r.ccr && _ccrReleasing[r.ccr.activityId]
    ? Object.assign({}, r, { group: "progress", state: "pending-carta" })
    : r);
}
