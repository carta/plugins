/* ---------- vocabularies ---------- */
const REL = ["Employee", "Ex-Employee", "Advisor", "Ex-Advisor", "Board member",
  "Ex-Board member", "Consultant", "Ex-Consultant", "Executive", "Founder",
  "International Employee", "Ex-International Employee", "Investor", "Officer", "Other"];
const SO = { US: ["ISO", "NSO", "INTL"], UK: ["EMI", "CSOP", "Unapproved"],
  AU: ["Startup Concessions", "Non-Concessional", "ZEPO"] };
const SO_FILL = {
  ISO: ["USD", null], NSO: ["USD", null], INTL: ["USD", null],
  EMI: ["GBP", "Non-U.S."], CSOP: ["GBP", "Non-U.S."], Unapproved: ["GBP", null],
  "Startup Concessions": ["AUD", "Small Scale"], "Non-Concessional": ["AUD", "Small Scale"],
  ZEPO: ["AUD", "Small Scale"],
};
/** so_types that unlock a conditional field group. Memberships must stay identical to
    HMRC_SO_TYPES / ATO_SO_TYPES in plugins/carta-cap-table/lib/issuance_fields.py — the
    fields do not exist server-side for any other type. */
const HMRC_SO_TYPES = new Set(["EMI"]);
const ATO_SO_TYPES = new Set(["Non-Concessional", "Startup Concessions", "ZEPO"]);
const R144 = [["has_determined_144_date", "Has determined 144 date"],
  ["non_restricted_144", "Non-restricted 144"], ["relevance_provision", "Relevance provision"],
  ["affiliates", "Affiliates"], ["non_affiliates", "Non-affiliates"]];
const JUR = { US: "United States", UK: "United Kingdom", AU: "Australia" };
const NONE = "__none__";
/** A term of a resumed draft set the page could not read back. It is shown as what it is
    and never sent, so the value Carta holds is the one it issues. */
const AS_SAVED = "__as_saved__";
const AS_SAVED_LABEL = "As saved in Carta";

/** What Confirm actually does, which differs by type: a grant or a unit goes out for
    signature, a certificate lands on the cap table. Whoever confirms is entitled to
    know which. Shown in the review, beside the Issue button. */
const CONFIRM_LINE = {
  option_grant: "Confirming will send these grants to the signatory for signature.",
  certificate: "Confirming will issue these certificates to the cap table.",
  piu: "Confirming will send these profits interest units to the signatory for signature.",
};

/** The same commitment, in the fewest words the sheet can carry. The summary above it
    has already said who and how much, and the review said it in full. */
const SHEET_COMMIT = {
  option_grant: "Confirming issues these grants and sends them to the signatory for signature.",
  certificate: "Confirming issues these certificates to the cap table.",
  piu: "Confirming issues these PIU grants and sends them to the signatory for signature.",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const S = {
  stage: "edit",
  ready: false, corpId: null, corpName: "", type: "option_grant", token: null, today: "",
  counts: {}, prefill: {}, blockers: [], narrowed: null, thresholdNoun: "Threshold",
  roster: [], plans: [], classes: [], vesting: [], accel: [], docSets: [], legends: [], vals: [],
  intl: { active: [], history: [] }, intlOk: false, isLLC: null,
  manifest: {},
  termsLoading: true, rosterLoading: true, booted: false,
  loadErr: "", loadFailed: [], connErr: "", shared: {}, rows: [], seq: 0,
  searching: false, searchErr: false, searched: new Set(),
  errs: {}, srv: {}, banner: "", bannerBad: false, busy: false,
  draftSetId: null, drafts: {}, sheet: null, issued: 0, issuedRows: [],
  stuck: "", untold: false, bootFailed: false, docPicked: false, removed: [], savedNote: "",
  sent: {}, lastPayload: {}, removedGone: 0, hydrated: false, touchedShared: new Set(),
  rewriting: [],
};

/* ---------- helpers ---------- */
const el = (t) => document.querySelector(`[data-testid="${t}"]`);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "");
const pad2 = (n) => String(n).padStart(2, "0");
/** The browser's own calendar day. `toISOString()` reads UTC, which is a day ahead
    of anyone west of it for part of every day — and Carta's draft validator asks
    its own clock, so a UTC read prefills tomorrow and the save comes back "Issue
    date can't be in the future". */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** The day to date an issuance. The server's own, when the bootstrap sent one, because
    it is the day Carta compares against and so is always accepted. */
const today = () => S.today || localToday();
/** The latest day a picker offers, which is not the same day. Carta anchors a
    corporation ahead of its own clock — Australia, New Zealand — to that corporation's
    date, so capping at the server's would refuse those holders their real today. The
    server still has the last word on anything past this. */
const latestDate = () => {
  const local = localToday();
  return S.today && S.today > local ? S.today : local;
};
/** MM/DD/YYYY — required by the three CharField(10) date fields. */
function us(d) {
  const s = iso(d);
  return s ? `${s.slice(5, 7)}/${s.slice(8, 10)}/${s.slice(0, 4)}` : "";
}
/** Dates read back as words. A numeric date outside an input reads as the
    browser's locale, not the server's, so 05/01 becomes 5 January. */
function longDate(d) {
  const s = iso(d);
  if (!s) return "";
  return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
}
const money = (v, cur) => (v === "" || v == null ? "—"
  : `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}${cur ? ` ${cur}` : ""}`);
/** Pull an array out of whatever envelope the command used. */
function list(res, ...keys) {
  const p = payload(res);
  if (!p) return [];
  if (Array.isArray(p)) return p;
  for (const k of [...keys, "results", "items", "data"]) {
    if (Array.isArray(p[k])) return p[k];
  }
  for (const v of Object.values(p)) if (Array.isArray(v)) return v;
  return [];
}
/** A list, whatever arrived. Every server list this page maps over goes through here:
    `render()` draws them all, so one string where a list was expected throws inside the
    render that would have shown the error, and the form stays on its loading skeleton. */
const arr = (v) => (Array.isArray(v) ? v : []);
/** Drop the entries that would throw on a field read. */
const objs = (v) => arr(v).filter((x) => x && typeof x === "object");
const isPiuLike = () => S.type === "piu";
const classNoun = () => (isPiuLike() ? "Unit class" : "Share class");
/** The issuer's own noun at the head of a label. The server sends it lowercase —
    `hurdle` on UK growth shares — and a label starts with a capital. */
const capNoun = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

/* ---------- names the user can read ----------
   The keys the server uses ("vals", "issuance", "grant_expiration_date") are
   not words anyone read on the form. These map them back. */
const LOAD_LABEL = { roster: "the stakeholder list", init: "the shared terms",
  plans: "the equity plans", classes: "the share classes",
  vals: "the 409A valuations", bootstrap: "this issuance's starting point" };
/** Each line ends as a sentence. Carta punctuates some messages and not others, so
    without this a list mixes the two. */
const sentence = (s) => {
  const t = String(s == null ? "" : s).trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
};

/** Every error that is not one row's own, as one list in the server's own words. A
    payload key is never customer-facing, and the message already names its field. A row's
    own errors sit on that row instead. A shared term refused on only some rows leads
    with whose, because the same words on every row would not say which. */
function serverErrorLines() {
  const out = (S.srv.batch || []).map(sentence);
  for (const s of S.srv.shared || []) {
    const on = S.rows.filter((r) => s.keys.includes(r.key));
    const who = on.length < S.rows.length
      ? on.map((r) => (r.name || "").trim()).filter(Boolean).join(", ") : "";
    out.push(who ? `${who} — ${s.text}` : s.text);
  }
  return out;
}

/* ---------- boot ---------- */
function ingest(data) {
  if (!data || typeof data !== "object") return;
  const d = unwrap(data);
  S.corpId = d.corporationId ?? d.corporation_id ?? S.corpId;
  S.corpName = d.corporationName || d.corporation_name || S.corpName;
  S.type = d.securityType || d.security_type || S.type;
  S.token = d.panelToken || d.panel_token || S.token;
  // Before seedShared(), which anchors every date on it.
  S.today = iso(d.today) || S.today;
  // A resume: saveArgs() then updates this set instead of minting a second one.
  S.draftSetId = d.draftSetId ?? d.draft_set_id ?? S.draftSetId;
  S.counts = d.counts || {};
  S.prefill = d.prefill || {};
  S.blockers = objs(d.blockers);
  S.narrowed = d._narrowed || null;
  if (d.prefill && d.prefill.thresholdNoun) S.thresholdNoun = d.prefill.thresholdNoun;
  S.ready = true;
  seedShared();
  seedRows();
  render();
  // First meaningful paint: shell plus every term the seed already knew. Nothing
  // here waited on the transport.
  if (!S.painted) { S.painted = true; flag(); mark("paint"); }
}

function seedShared() {
  const p = S.prefill;
  // Every other date anchors on this one.
  const issue = iso(p.issueDate) || today();
  const sh = {
    issue_date: issue,
    currency: p.currency || "USD",
    notes: "",
    vesting_template: p.vestingTemplateId ? String(p.vestingTemplateId) : NONE,
    vesting_start_date: issue,
    acceleration_template: "",
  };
  if (S.type === "option_grant") {
    sh.option_plan_id = p.optionPlanId ? String(p.optionPlanId) : "";
    sh.jurisdiction = p.jurisdiction && SO[p.jurisdiction] ? p.jurisdiction : "";
    sh.so_type = p.soType || "";
    sh.exercise_price = p.exercisePrice != null ? String(p.exercisePrice) : "";
    sh.document_set_id = p.documentSetId ? String(p.documentSetId) : "";
    sh.grant_expiration_date = iso(p.grantExpirationDate) || "";
    sh.board_mode = p.boardApprovalDate ? "approved" : "pending";
    sh.board_approval_date = iso(p.boardApprovalDate) || issue;
    sh.early_exercise = false;
    sh.is_hmrc_notified = false;
    sh.hmrc_notified = "";
    sh.ato_notified = false;
    sh.employment_related = "";
  } else if (S.type === "certificate") {
    sh.prefix = p.shareClassPrefix || "";
    sh.law_firm_price = p.pricePerShare != null ? String(p.pricePerShare) : "";
    sh.board_approval_date = iso(p.boardApprovalDate) || issue;
    sh.legend_id = p.legendId ? String(p.legendId) : "";
    sh.rule_144_mode = "issue_date";
    sh.rule_144_date = issue;
    sh.rule_144_reason = "";
    sh.dividend_accrual_start_date = issue;
  } else {
    sh.prefix = p.shareClassPrefix || "";
    sh.threshold_value = p.thresholdValue != null ? String(p.thresholdValue) : "";
    sh.threshold_value_type = p.thresholdValueType || "";
    sh.option_plan = p.optionPlanId ? String(p.optionPlanId) : "";
    sh.board_approval_date = iso(p.boardApprovalDate) || "";
    sh.document_set_id = p.documentSetId ? String(p.documentSetId) : "";
    sh.corresponding_interest = false;
  }
  S.shared = sh;
  // Which so_type the currency was stamped for. A fresh seed has stamped none.
  S.curFor = null;
  // A set that came in with the seed was chosen already, in chat or on the saved draft.
  S.docPicked = !!p.documentSetId;
}

/** One row per person the user actually named. An `ambiguous` entry creates NO row. */
function seedRows() {
  S.rows = [];
  S.drafts = {};
  for (const r of objs(S.prefill.rows)) {
    // load_drafts rows arrive snake_case, the bootstrap's camelCase.
    const kind = r.stakeholderKind || r.stakeholder_kind || "";
    const row = mkRow({
      stakeholderId: r.stakeholderId ?? r.stakeholder_id ?? null,
      name: r.name || r.full_name || "", email: r.email || "",
      quantity: r.quantity != null ? String(r.quantity) : "",
      kind: kind || "INDIVIDUAL",
      relationship: r.issueDateRelationship || r.issue_date_relationship || "",
    });
    // A resumed row's kind and exemption are Carta's until this page is told otherwise.
    row.resumed = (r.draft_pk ?? r.draftPk) != null;
    row.kindUnknown = !kind && row.resumed;
    // Keyed by the key mkRow just minted, which is what rowPayload sends as temp_id, so
    // a resumed row updates in place. Keying by position instead threads the wrong pk.
    const pk = r.draft_pk ?? r.draftPk;
    if (pk != null && pk !== "") S.drafts[row.key] = pk;
    S.rows.push(row);
  }
  if (!S.rows.length) S.rows.push(mkRow({}));
}

function mkRow(o) {
  return {
    key: `r${S.seq++}`, stakeholderId: o.stakeholderId ?? null,
    name: o.name || "", email: o.email || "", quantity: o.quantity || "",
    kind: o.kind || "INDIVIDUAL", relationship: o.relationship || "",
    isNew: !!o.isNew, open: false, query: o.name || "", ov: {}, touched: new Set(),
  };
}

/* ---------- reference data ----------
   Two loads, started together and awaited separately. The seed has already
   painted the form, so neither gates first paint. The roster feeds one
   control, so it streams in behind the form and that control shows the wait. */
// Resolves when the eager roster page has landed, which is when a seeded name can be
// matched against it. The terms load still runs unawaited alongside.
function boot() {
  if (S.booted) return Promise.resolve();
  S.booted = true;
  loadTerms();
  return loadRoster();
}

/* ---------- the one-call path ----------
   `include_sections` returns the reference rows the bootstrap already fetched, so the
   whole form arrives in the same round trip that resolves the named people. The
   fan-out above stays as the fallback for an MCP that does not send them. */

/** A 409A row wears different names than an international one, and `fmvCandidates`
    reads the international shape. Same mapping the fan-out's `fmvRows` applies. */
const as409aRow = (r) => ({
  price: r.fair_market_value ?? r.price_per_share ?? null,
  expiration_date: r.expiration_date,
  support_reference_type: "409A", share_class_type: "COMMON",
});

/** True when the payload carried the reference data, so the fan-out can be skipped.
    False keeps the fan-out, which is the safe answer: a second read costs a round trip,
    where a wrongly skipped one leaves required dropdowns empty with nothing said. */
function ingestSections(d) {
  const sec = d && d.sections;
  if (!sec || typeof sec !== "object") return false;
  let landed = 0;
  const take = (key, apply) => {
    const rows = sect(sec[key]);
    if (!rows.length) return;
    apply(rows);
    landed += 1;
  };
  take("option_plans", (v) => { S.plans = v; });
  take("certificate_share_classes", (v) => { S.classes = v; });
  take("vesting_templates", (v) => { S.vesting = v; });
  take("acceleration_templates", (v) => { S.accel = v; });
  take("document_sets", (v) => { S.docSets = v; });
  take("legends", (v) => { S.legends = v; });
  // Chosen on which one has rows, not which key is present: a refused international
  // read arrives empty and would otherwise hide the 409A rows sitting beside it.
  const iv = sec.international_valuations || {};
  const intl = { active: sect(iv.active), history: sect(iv.history) };
  if (!intl.active.length && !intl.history.length) {
    const v409 = sec.valuations_409a || {};
    intl.active = sect(v409.active).map(as409aRow);
    intl.history = sect(v409.history).map(as409aRow);
  }
  if (intl.active.length || intl.history.length) {
    S.intl = intl;
    S.intlOk = true;
    landed += 1;
  }
  const init = sec.draft_set_init;
  if (init && typeof init === "object") {
    if (init.thresholdNoun) S.thresholdNoun = init.thresholdNoun;
    if (typeof init.isLLC === "boolean") S.isLLC = init.isLLC;
    landed += 1;
  }
  const fields = d.field_manifest && sect(d.field_manifest.fields);
  if (fields && fields.length) { S.manifest = mfIndex(fields); landed += 1; }
  const roster = sect(d.roster);
  if (roster.length) { mergeRoster(roster); landed += 1; }
  if (!landed) return false;
  S.termsLoading = false;
  S.rosterLoading = false;
  S.booted = true;
  return true;
}

/** What both paths do once the reference data is in. */
function settleTerms() {
  mfDefaults();
  applyDerived();
  render();
  mark("terms");
  flag();
}

function mark(name) {
  try { performance.mark(`carta-issuance:${name}`); } catch { /* no-op */ }
}

async function loadTerms() {
  const cid = S.corpId;
  const jobs = [["init", one("cap_table__get__issuance_init",
    { corporation_id: cid, security_type: S.type })]];
  // Concurrent with the loads already going out, so it costs no wall-clock and
  // nothing waits on it. The handler uppercases security_type for us.
  jobs.push(["manifest", one("cap_table__get__issuable_field_manifest",
    { corporation_id: cid, security_type: S.type })]);
  if (S.type !== "certificate") jobs.push(["plans", one("cap_table__get__option_plans", { corporation_id: cid })]);
  if (S.type !== "option_grant") jobs.push(["classes", one("cap_table__get__certificate_share_classes", { corporation_id: cid })]);
  if (S.type === "option_grant") {
    // Both: the international set covers every source including 409A and carries the
    // currency and status a 409A-only read cannot, but a US-only corp can be refused it.
    jobs.push(["intl", one("cap_table__get__valuations", { corporation_id: cid })]);
    jobs.push(["vals", one("cap_table__get__409a_valuations", { corporation_id: cid })]);
  }

  const out = await Promise.allSettled(jobs.map((j) => j[1]));
  const failed = [];
  let dead = null;
  out.forEach((res, i) => {
    const tag = jobs[i][0];
    if (res.status !== "fulfilled") {
      // Neither is a dependency: without the manifest each field keeps the label written
      // below, and a US-only corp is refused the international set, which 409A backs.
      if (tag === "manifest" || tag === "intl") return;
      if (res.reason && res.reason.noWrites) dead = dead || res.reason;
      else failed.push(tag);
      return;
    }
    if (tag === "init") {
      const p = payload(res.value) || {};
      const sec = unwrap(p) || {};
      S.vesting = sect(sec.vesting_templates);
      S.accel = sect(sec.acceleration_templates);
      S.docSets = sect(sec.document_sets);
      S.legends = sect(sec.legends);
      if (!S.plans.length) S.plans = sect(sec.option_plans);
      if (!S.classes.length) S.classes = sect(sec.certificate_share_classes);
      const ds = sec.draft_set_init || {};
      if (ds.thresholdNoun) S.thresholdNoun = ds.thresholdNoun;
      // A missing or null isLLC is UNKNOWN, never false.
      if (typeof ds.isLLC === "boolean") S.isLLC = ds.isLLC;
    } else if (tag === "manifest") S.manifest = mfIndex((payload(res.value) || {}).fields);
    else if (tag === "intl") {
      const p = payload(res.value) || {};
      S.intl = { active: sect(p.active), history: sect(p.history) };
      S.intlOk = true;
    }
    else if (tag === "plans") S.plans = list(res.value, "option_plans");
    else if (tag === "classes") S.classes = list(res.value, "certificate_share_classes", "share_classes");
    else if (tag === "vals") S.vals = list(res.value, "valuations", "409a_valuations");
  });
  S.termsLoading = false;
  // One message, not one per section: the connector notice already says what to do.
  if (!deadRead(dead)) noteFailures(failed);
  settleTerms();
}
/** Every issuance_init section arrives as its own command's `{count, results}`
    envelope, never a bare array. Reading one as an array yields an empty control
    with no error to show for it. */
const sect = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.results) ? v.results : []);

/** Accumulates: the loads finish independently, so the second must not
    erase what the first reported. */
function noteFailures(failed) {
  for (const f of failed) if (!S.loadFailed.includes(f)) S.loadFailed.push(f);
  const named = S.loadFailed.map((f) => LOAD_LABEL[f] || f);
  // No instruction here: the notice carries a Try again that runs the load in place,
  // which is a shorter path than leaving the page for the chat.
  S.loadErr = S.loadFailed.includes("bootstrap")
    ? "We couldn't load this company's issuance details from Carta."
    : named.length ? `We could not load ${named.join(" or ")}.` : "";
}

/** The one attribute the outside world reads: what stage the boot reached. */
function flag() {
  const v = S.termsLoading ? "shell" : S.rosterLoading ? "terms" : "ready";
  document.documentElement.setAttribute("data-boot", v);
}

/** No live data at all. The form stays readable so the user can see what was asked
    for, but a write cannot reach Carta, so the footer takes its buttons away. */
function degrade(kind) {
  S.connErr = connReason(kind);
  S.termsLoading = false;
  S.rosterLoading = false;
  render();
  flag();
}

/** A read that failed for a reason no retry can clear — a declined connector prompt is
    the common one, since the first call IS the prompt. That is the page's own condition
    rather than one section's gap: said once, and nothing else is called after it. */
function deadRead(err) {
  if (!err || !err.noWrites) return false;
  if (!S.connErr) degrade(err.code);
  return true;
}

/** 200 is the page the roster command documents as fitting its response cap at every
    row width. A larger page is refused outright, not shortened, which empties the
    typeahead on page 1. */
const PAGE = 200;
/** A search is one keystroke behind the user, not one call per keystroke. */
const SEARCH_MS = 250;
/** Exactly what suggest(), applyDerived() and rowPayload() read. Without this
    projection the serializer computes portfolio_email and termination_tooltip_message
    per row — 1-2 extra queries each — and the formatter then discards both. `fields`
    can only narrow, and an unknown name is ignored silently, so keep this list to the
    five that are actually read. */
const ROSTER_FIELDS = "id,full_name,email,event_relationship,kind";

/** One eager page, so the typeahead answers instantly and applyDerived() can
    back-fill the prefilled rows. Everyone past it arrives by search. */
async function loadRoster() {
  let res;
  try {
    res = await one("cap_table__get__stakeholders",
      { corporation_id: S.corpId, page_size: PAGE, page: 1, fields: ROSTER_FIELDS });
  } catch (err) {
    S.rosterLoading = false;
    if (deadRead(err)) return;
    noteFailures(["roster"]);
    applyDerived(); softRender(); flag();
    return;
  }
  mergeRoster(list(res, "stakeholders"));
  S.rosterLoading = false;
  applyDerived();
  softRender();
  mark("roster");
  flag();
}

/** Merged by stakeholder id, so a search widens the roster rather than replacing it
    and a name already on screen never disappears. S.roster is replaced, never
    mutated, so a mid-search render sees a whole list. */
function mergeRoster(rows) {
  const by = new Map(S.roster.map((s) => [String(s.id), s]));
  for (const r of rows) {
    const id = r.id ?? r.stakeholder_id;
    if (id == null) continue;
    by.set(String(id), {
      id, name: r.name || r.full_name || "",
      email: r.email || "", kind: r.kind || r.stakeholder_kind || "INDIVIDUAL",
      relationship: r.event_relationship || r.relationship || "",
    });
  }
  S.roster = [...by.values()];
}

let searchTimer = null, searchSeq = 0, searchSettle = null;
/** `search` AND-s its terms and is meant to match one person, so one query is one
    person's name — never several names joined together. Returns a promise so a caller
    that needs the answer can await it; a keystroke that supersedes a pending search
    settles its promise rather than leaving an await hanging. */
function searchRoster(q) {
  const term = (q || "").trim();
  clearTimeout(searchTimer);
  if (searchSettle) { searchSettle(); searchSettle = null; }
  // A page with no live Carta has nothing to search, and each keystroke would ask again.
  if (S.connErr || term.length < 2 || S.searched.has(term.toLowerCase())) return Promise.resolve();
  return new Promise((settle) => {
    searchSettle = settle;
    searchTimer = setTimeout(async () => {
      searchSettle = null;
      const seq = ++searchSeq;
      S.searching = true;
      softRender();
      try {
        const res = await one("cap_table__get__stakeholders",
          { corporation_id: S.corpId, search: term, page_size: 25, fields: ROSTER_FIELDS });
        S.searched.add(term.toLowerCase());
        S.searchErr = false;
        mergeRoster(list(res, "stakeholders"));
      } catch (err) {
        // The names already loaded still answer; the notice says search is degraded.
        if (!deadRead(err)) S.searchErr = true;
      }
      if (seq === searchSeq) S.searching = false;
      applyDerived();
      softRender();
      settle();
    }, SEARCH_MS);
  });
}

/** Fill everything derivable so the user is never asked for it. */
function applyDerived() {
  const sh = S.shared;
  // A resumed set's terms are what Carta holds, blanks included: nothing is picked for it.
  if (!S.hydrated) {
    fillDefaults(sh);
    dropStaleSoType();
    applySoFill();
    dropUnofferedChoices();
  }
  backfillRows();
}

function fillDefaults(sh) {
  // Sole option plan / document set / legend / vesting-free class default silently.
  const plans = selectablePlans();
  if (S.type === "option_grant" && !sh.option_plan_id && plans.length === 1) sh.option_plan_id = String(plans[0].id);
  pickDocSet();
  if (S.type === "certificate" && !sh.legend_id && S.legends.length === 1) sh.legend_id = String(S.legends[0].id);
  // A class is preselected ONLY when there is exactly one. Two or more and none
  // named stays unselected — which class a holder lands in is the user's decision.
  if (S.type !== "option_grant" && !sh.prefix && S.classes.length === 1) sh.prefix = S.classes[0].prefix || "";
  if (S.type === "option_grant" && !sh.exercise_price) {
    const v = fmv();
    if (v.price != null) sh.exercise_price = String(v.price);
  }
  // Only fill a blank here. The field is editable now, and a roster search keeps
  // calling this — recomputing would overwrite what the user just typed. `commit`
  // owns the recompute when the plan or issue date actually changes.
  if (S.type === "option_grant" && !sh.grant_expiration_date) sh.grant_expiration_date = grantExpiry();
}

function backfillRows() {
  // Existing stakeholders carry their own kind + relationship.
  for (const r of S.rows) {
    // A resumed row's identity is what Carta holds, blanks included, until the user re-picks.
    if (r.stakeholderId == null || (r.resumed && !r.touched.has("stakeholder"))) continue;
    const m = S.roster.find((x) => String(x.id) === String(r.stakeholderId));
    if (!m) continue;
    if (!r.email) r.email = m.email;
    if (!r.name) r.name = m.name;
    if (!r.relationship) r.relationship = m.relationship || "";
    r.kind = m.kind || r.kind;
  }
}

/** A grant type only means anything inside its own jurisdiction. */
function dropStaleSoType() {
  if (S.type !== "option_grant" || !S.shared.so_type || S.shared.so_type === AS_SAVED) return;
  const rg = region();
  if (!rg || !SO[rg].includes(S.shared.so_type)) S.shared.so_type = "";
}

/** A required choice this form cannot offer is not an answer. The control renders
    unselected whatever S holds, so a prefilled value missing from its own option list
    would go out as a value nobody picked — cleared here so validate() asks for it.
    Waits for the terms load, which is what fills those lists. */
function dropUnofferedChoices() {
  if (S.termsLoading) return;
  for (const d of spec()) {
    const v = S.shared[d.k];
    if (d.kind !== "sel" || !d.req || "val" in d || v === "" || v == null || v === AS_SAVED) continue;
    if (!(d.opts || []).some((o) => String(o[0]) === String(v))) S.shared[d.k] = "";
  }
}

function applySoFill() {
  if (S.type !== "option_grant" || S.shared.so_type === AS_SAVED) return;
  const so = S.shared.so_type;
  const f = SO_FILL[so];
  // A default, not a lock: applyDerived() runs on every roster search, so
  // re-stamping the currency here would undo what the user just typed.
  if (f && S.curFor !== so) S.shared.currency = f[0];
  S.curFor = so;
  if (S.shared.so_type === "ZEPO") { S.shared.exercise_price = "0"; S.shared.early_exercise = false; }
  // Cleared, not just hidden: a notification recorded against a previous option type
  // must not survive into rowPayload once the type no longer has the field.
  if (!HMRC_SO_TYPES.has(S.shared.so_type)) {
    S.shared.is_hmrc_notified = false;
    S.shared.hmrc_notified = "";
  }
  if (!ATO_SO_TYPES.has(S.shared.so_type)) S.shared.ato_notified = false;
}

// Mirrors the server's _selectable_plans: unexpired AND with pool left. An
// empty pool is why the server emits option_plan.none_selectable.
const selectablePlans = () => S.plans.filter((p) =>
  !p.is_expired && Number(p.available_quantity ?? Infinity) > 0);
/** The live valuation rows to price from. `active` is already filtered server-side, so
    it is never re-derived from dates. A 409A row carries no share class, so it is tagged
    COMMON — an option is the only thing a 409A prices. */
function fmvRows() {
  if (S.intlOk && S.intl.active.length) return S.intl.active;
  return S.vals.filter((x) => x.is_active || x.active).map((v) => ({
    price: v.fair_market_value ?? v.price_per_share ?? null,
    support_reference_type: "409A", share_class_type: "COMMON",
  }));
}
const fmvCovers = (r) => [r.share_class_name].concat(r.additional_share_class_names || [])
  .filter(Boolean).map((s) => String(s).toLowerCase());

/** An option prices off its plan's common share class, so a live preferred FMV belongs
    to another class and is dropped — a corp with an Ordinary share price of 0.75 and a
    Seed Preferred FMV of 1.00 prices its options at 0.75. Class type decides; the plan's
    common class name narrows further only when the type leaves more than one. */
function fmvCandidates() {
  const rows = fmvRows().filter((r) => {
    const t = String(r.share_class_type || "").toUpperCase();
    return !t || t === "COMMON";
  });
  const p = plan();
  const name = String((p && p.common_share_class_name) || "").toLowerCase();
  if (!name || rows.length < 2) return rows;
  const byName = rows.filter((r) => fmvCovers(r).includes(name));
  return byName.length ? byName : rows;
}

/** 409A / EMI / CSOP / share price. The wire spells a valuation report on either
    side of the source — `EMI_VALUATION_REPORT` and `valuation_report_409a`. */
const FMV_SOURCE = { "409A": "409A", EMI: "EMI", CSOP: "CSOP", SHARE_PRICE: "share price" };
function fmvSource(r) {
  const raw = String((r && (r.support_reference_type || r.valuation_type)) || "")
    .toUpperCase().replace(/^VALUATION_REPORT_/, "")
    .replace(/_VALUATION_REPORT$/, "").replace(/_REPORT$/, "");
  return FMV_SOURCE[raw] || (raw ? raw.replace(/_/g, " ").toLowerCase() : "");
}

/** Two live valuations on the same class — an HMRC report yields both an AMV and a UMV —
    is the admin's decision: nothing in the payload says which a grant prices from, and
    the difference moves the holder's tax position. So the page does not pick. */
function fmv() {
  const rows = fmvCandidates();
  if (rows.length === 1) return { price: rows[0].price ?? null, source: fmvSource(rows[0]) };
  if (rows.length > 1) return { price: null, source: "", ambiguous: rows };
  return { price: null, source: "" };
}
/** Either wire format: international rows are ISO, 409A rows MM/DD/YYYY. Kept local —
    `iso()` feeds the payload and must stay strict. */
function anyDateIso(d) {
  const s = String(d || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
}

/** No live valuation but history behind it means one lapsed, rather than never existing.
    A blank price with no reason reads as a broken form. */
function fmvLapsed() {
  if (fmvCandidates().length) return "";
  const rows = (S.intlOk ? S.intl.history : S.vals) || [];
  const dates = rows.map((r) => anyDateIso(r && r.expiration_date)).filter(Boolean).sort();
  if (!dates.length) return "";
  return `No valuation is live — the last one expired ${longDate(dates[dates.length - 1])}. Set the price this grant uses.`;
}

/** Why the page could not price this grant, when it could not. */
function fmvWarning() {
  const v = fmv();
  if (v.ambiguous) return "More than one valuation is live on this share class — set the price this grant uses.";
  if (v.price != null && v.source) return "";
  return fmvLapsed();
}
function plan() { return S.plans.find((p) => String(p.id) === String(S.shared.option_plan_id)); }
function chosenClass() { return S.classes.find((c) => c.prefix === S.shared.prefix); }
function tmpl() { return S.vesting.find((t) => String(t.id) === String(S.shared.vesting_template)); }
const isMilestone = () => { const t = tmpl(); return !!t && /milestone/i.test(t.vesting_type || ""); };

/** min(issue_date + plan term [- 1 day], plan.expiration_date). Silent default.
    `from` is the row's own issue date where it overrode the batch's. */
function grantExpiry(from) {
  const p = plan(); const base = from || S.shared.issue_date;
  if (!p || !base) return S.shared.grant_expiration_date || "";
  // A non-numeric term makes the Date invalid, and `toISOString` on an invalid Date
  // throws — inside `spec()`, which every render walks.
  const term = Number(p.expiration_years ?? p.option_term_years ?? 10);
  const yrs = Number.isFinite(term) ? term : 10;
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + yrs);
  if (p.minus_one_day !== false) d.setUTCDate(d.getUTCDate() - 1);
  if (Number.isNaN(d.getTime())) return S.shared.grant_expiration_date || "";
  let end = d.toISOString().slice(0, 10);
  const cap = iso(p.expiration_date);
  if (cap && cap < end) end = cap;
  return end;
}

const candidates = () => arr(S.prefill.jurisdictionCandidates).filter((c) => SO[c]);
/** The server reported competing signals and returned no verdict. The choice
    stays on screen after the user makes it, so they can change it. */
const regionAmbiguous = () =>
  !(S.prefill.jurisdiction && SO[S.prefill.jurisdiction]) && candidates().length > 1;
const regionUndecided = () => regionAmbiguous() && !S.shared.jurisdiction;
/** null means "not decided yet" — never a guess. A ranked default here would
    set a real holder's tax treatment from a signal the server refused to rank. */
function region() {
  if (S.shared.jurisdiction && SO[S.shared.jurisdiction]) return S.shared.jurisdiction;
  if (regionUndecided()) return null;
  const c1 = candidates();
  if (c1.length === 1) return c1[0];
  if (S.plans.some((x) => /^(EMI|CSOP)$/i.test(x.scheme_type || ""))) return "UK";
  const cur = S.shared.currency || S.prefill.currency;
  return cur === "GBP" ? "UK" : cur === "AUD" ? "AU" : "US";
}

/* ---------- field builders ---------- */
/** Carta's own refusal of one row's field, drawn on that field. */
function srvFieldErr(id) {
  const m = /^row-(\d+)-(.+)$/.exec(id);
  const r = m && S.rows[Number(m[1])];
  const own = r && S.srv.fields && S.srv.fields[r.key];
  return (own && own[m[2]]) || "";
}
function fld(id, label, body, o) {
  o = o || {};
  const e = S.errs[id] || srvFieldErr(id);
  // Outlined for a refusal the banner above already words, so it is not said twice.
  const flagged = arr(S.srv.marks).includes(id);
  const hint = o.hint && !e ? `<div class="hint${o.hintCls ? ` ${o.hintCls}` : ""}" id="hint-${id}">${esc(o.hint)}</div>` : "";
  const said = e ? `err-${id}` : hint ? `hint-${id}` : "";
  // The control is named by the field, so it is the one tag that carries the state.
  const aria = `${e || flagged ? ' aria-invalid="true"' : ""}${said ? ` aria-describedby="${said}"` : ""}`;
  return `<div class="f${o.wide ? " wide" : ""}${e || flagged ? " bad" : ""}" data-f="${id}">
    <label for="${id}">${esc(label)}${o.req ? ' <span class="req">*</span>' : ""}</label>
    ${aria ? body.replace(`id="${id}"`, `id="${id}"${aria}`) : body}
    ${hint}
    ${e ? `<div class="err" id="err-${id}" data-testid="err-${id}">${esc(e)}</div>` : ""}
  </div>`;
}
/** The input keeps what was typed; grouping it live fights the caret. The
    grouped figure goes underneath, where a long number is read back. */
const grouped = (v) => (/^\d{5,}$/.test(String(v == null ? "" : v).trim())
  ? Number(String(v).trim()).toLocaleString() : "");
function txt(id, v, o) {
  o = o || {};
  return `<input id="${id}" data-testid="${id}" data-k="${o.k || id}" data-scope="${o.scope || "shared"}"
    type="${o.type || "text"}" value="${esc(v)}" class="${o.num ? "num" : ""}"
    ${o.ro ? "readonly" : ""} ${o.dis ? "disabled" : ""} ${o.ph ? `placeholder="${esc(o.ph)}"` : ""}
    ${o.max ? `max="${esc(o.max)}"` : ""}>`;
}
function sel(id, v, opts, o) {
  o = o || {};
  const items = (opts || []).map(([val, lab]) =>
    `<option value="${esc(val)}"${String(val) === String(v) ? " selected" : ""}>${esc(lab)}</option>`).join("");
  // .ctl is the positioning context for the caret drawn in ::after. The title
  // is the selected label in full, so an ellipsised choice stays recoverable.
  const picked = (opts || []).find((x) => String(x[0]) === String(v));
  const tip = picked ? ` title="${esc(picked[1])}"` : "";
  return `<span class="ctl"><select id="${id}" data-testid="${id}" data-k="${o.k || id}" data-scope="${o.scope || "shared"}"${tip}
    ${o.dis ? "disabled" : ""}>${o.placeholder !== false
    ? `<option value=""${v ? "" : " selected"}>${esc(o.placeholder || "Select…")}</option>` : ""}${items}</select></span>`;
}
function chk(id, v, label, o) {
  o = o || {};
  return `<div class="f chk"><input id="${id}" data-testid="${id}" data-k="${o.k || id}"
    data-scope="${o.scope || "shared"}" type="checkbox"${v ? " checked" : ""}>
    <label for="${id}">${esc(label)}</label>
    ${o.hint ? `<div class="hint">${esc(o.hint)}</div>` : ""}</div>`;
}
/** `foot` is the sentence that says what to do about it — a stop has a fix, not
    another bullet. */
function noteBox(t, stop, title, items, foot, action, attrs) {
  return `<div class="note${stop ? " stop" : ""}" data-testid="${t}"${attrs || ""}>
    <div class="note-t"><span class="dot"></span>${esc(title)}</div>
    ${items.length ? `<ul>${items.join("")}</ul>` : ""}
    ${foot ? `<p>${esc(foot)}</p>` : ""}
    ${action || ""}</div>`;
}

/** The selectable plans, plus the set's own plan when it is no longer selectable itself —
    a fixed plan still has to read as what it is. */
const planOpts = () => {
  const opts = selectablePlans().map((p) => [String(p.id), p.name || "Unnamed plan"]);
  const cur = S.type === "option_grant" ? S.shared.option_plan_id : "";
  const p = cur && cur !== AS_SAVED && !opts.some((o) => o[0] === String(cur))
    && objs(S.plans).find((x) => String(x.id) === String(cur));
  return p ? opts.concat([[String(p.id), p.name || "Unnamed plan"]]) : opts;
};
const classOpts = () => S.classes.map((c) => [c.prefix, `${c.name || c.prefix} (${c.prefix})`]);
const vestOpts = () => [[NONE, "No vesting"], ...S.vesting.map((t) => [String(t.id), t.name])];
/* ---------- which documents a set carries ----------
   Carta refuses a draft whose document set lacks a document the corporation requires,
   and says so only once the draft is validated. The bootstrap says which slots each set
   fills and the field manifest which slots are required, so the page can say it first.
   Either one unreported and the page says nothing, as it did before either existed. */
const DOC_SLOT = {
  form_of_option_doc: ["has_form_of_option", "Form of Option Agreement"],
  form_of_exercise_doc: ["has_form_of_exercise", "Form of Exercise Agreement"],
  purchase_agreement_doc: ["has_purchase_agreement", "Form of Grant Agreement"],
  equity_incentive_plan_doc: ["has_equity_incentive_plan", "Equity Incentive Plan"],
};
/** The slots each type's draft validator checks. A certificate carries no document set. */
const TYPE_DOC_SLOTS = {
  option_grant: ["form_of_option_doc", "form_of_exercise_doc", "equity_incentive_plan_doc"],
  piu: ["purchase_agreement_doc", "equity_incentive_plan_doc"],
};
const EIP = "equity_incentive_plan_doc";
const docFlagsKnown = () => S.docSets.some((d) => d
  && Object.values(DOC_SLOT).some(([flag]) => typeof d[flag] === "boolean"));
/** The slots Carta requires a set to fill here. A PIU needs the plan document only when
    it is issued from a plan. */
function docsRequired(plan) {
  if (!docFlagsKnown()) return [];
  return arr(TYPE_DOC_SLOTS[S.type]).filter((slot) => {
    const m = mfField(slot);
    return !!m && m.required === true && !(S.type === "piu" && slot === EIP && !plan);
  });
}
/** The required slots one set leaves empty. A flag that is absent is not a gap. */
const docGaps = (set, plan) => (set
  ? docsRequired(plan).filter((slot) => set[DOC_SLOT[slot][0]] === false) : []);
const docLabel = (slot) => {
  const m = mfField(slot);
  return (m && typeof m.label === "string" && m.label.trim()) || DOC_SLOT[slot][1];
};
const orList = (xs) => (xs.length < 2 ? xs.join("")
  : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const docSetOf = (id) => objs(S.docSets).find((d) => String(d.id) === String(id));
const sharedPlan = () => (S.type === "piu" ? S.shared.option_plan : S.shared.option_plan_id);

/** Why a set cannot carry this issuance, in the words a reader acts on, or "". */
function docSetProblem(set, plan) {
  const gaps = docGaps(set, plan);
  if (!gaps.length) return "";
  const forPlan = S.type === "piu" && gaps.includes(EIP);
  const who = (S.corpName || "").trim() || "This company";
  const head = `This set has no ${orList(gaps.map(docLabel))}, which ${who} requires${
    forPlan ? " for units issued from an equity plan" : ""}.`;
  const noPlan = forPlan ? ", or choose No plan" : "";
  if (objs(S.docSets).some((d) => !docGaps(d, plan).length)) return `${head} Pick another set${noPlan}.`;
  return `${head} No document set here has ${gaps.length > 1 ? "them all" : "one"} — add it to a `
    + `set in Carta${noPlan}, then ask Claude to open this page again.`;
}

/** Sets that would be refused go last and say what they lack, so the list itself reads
    which one to pick. */
const docOpts = () => {
  const plan = sharedPlan();
  const opts = objs(S.docSets).map((d) => {
    const gaps = docGaps(d, plan).map(docLabel);
    const name = d.name || "Unnamed document set";
    return [String(d.id), gaps.length ? `${name} — no ${orList(gaps)}` : name, gaps.length > 0];
  });
  return opts.filter((o) => !o[2]).concat(opts.filter((o) => o[2])).map((o) => [o[0], o[1]]);
};

/** The set the page picks for itself: the only one there is, or the only one carrying
    every required document. Never over a set the user chose, and never a pick between
    two that would both do — which legal documents a holder signs is theirs to say. */
function pickDocSet() {
  const sh = S.shared;
  if (!TYPE_DOC_SLOTS[S.type] || S.hydrated) return;
  const sets = objs(S.docSets);
  if (sets.length === 1) {
    if (!sh.document_set_id) sh.document_set_id = String(sets[0].id);
    return;
  }
  if (S.docPicked) return;
  const plan = sharedPlan();
  const cur = docSetOf(sh.document_set_id);
  if (cur && !docGaps(cur, plan).length) return;
  const good = sets.filter((d) => !docGaps(d, plan).length);
  if (good.length === 1) sh.document_set_id = String(good[0].id);
  else if (cur && good.length) sh.document_set_id = "";
}
const legendOpts = () => S.legends.map((l) => [String(l.id), l.name || "Unnamed legend"]);
const accelOpts = () => S.accel.map((t) => [String(t.id), t.name]);

/* ---------- the server's field manifest, laid over the inline spec ----------
   long-comment-ok: the overlay contract, which the code below cannot state.
   cap_table:get:issuable_field_manifest is carta-web's own description of this
   form, so the declarative facts — label, requiredness, static enum values,
   blank defaults — come from there and stop drifting. Everything derived stays
   below in JS. The overlay is an enhancement: no manifest, no entry for a field,
   or no key on an entry all leave that field exactly as written here. */

/** Form key → manifest field name, where the two spell it differently. */
const MF_ALIAS = { rule_144_reason: "rule_144_difference_reason" };
/** Fields the server fills from a dynamic source. Their option lists are the
    form's own (richer labels, and already loaded); their label and requiredness
    are still the server's. `dynamic_source` is not on the wire, so it is named
    here — see field_manifest/service.py's _DYNAMIC_SOURCE_RESOLVERS. */
const MF_DYNAMIC = new Set(["option_plan", "prefix", "vesting_template",
  "acceleration_template", "legend", "exercise_legend", "convertible_note",
  "share_class", "form_of_option_doc", "form_of_exercise_doc",
  "equity_incentive_plan_doc", "purchase_agreement_doc"]);

/** What the manifest may NOT overlay, and why. Everything unnamed is the
    server's to own. long-comment-ok: one recorded decision per exception. */
const MF_SKIP = {
  /* Product decisions taken deliberately in this form. */
  // "No vesting" is the default here and vesting is optional; the manifest's
  // requiredness and template default would reverse both.
  vesting_template: { req: 1, default: 1 },
  // grantExpiry() derives this from the plan's term and the issue date; it is
  // editable, not fixed, so a static default must not land on top of it.
  grant_expiration_date: { default: 1 },
  // One word for all three security types. A row control rather than a spec
  // field, named here so the decision is recorded where it is enforced.
  quantity: { label: 1, req: 1, values: 1, default: 1 },

  /* Derived values and cross-field rules that stay in JS. */
  // region() decides which jurisdiction's grant types are legal; the manifest
  // lists every type the corporation could ever use (and omits the AU set), and
  // its label drops the "(US)" this form computes.
  so_type: { label: 1, values: 1 },
  // S.thresholdNoun is the issuer's own equity language — "Hurdle" on an LLC,
  // and "Overall — once for the whole grant" says what the bare word means.
  threshold_value: { label: 1 },
  threshold_value_type: { label: 1, values: 1 },
  // The label says what the checkbox does to the linked operating company; the
  // manifest's is the column name.
  corresponding_interest: { label: 1 },
  // Required because of a choice made elsewhere on this form. The manifest says
  // so in validation.conditionalRules, which is out of scope here, so its flat
  // `required: false` must not switch this form's own rule off.
  rule_144_date: { req: 1 },
  rule_144_reason: { req: 1 },
  employment_related: { req: 1 },
  dividend_accrual_start_date: { req: 1 },
  // A grant's issue date is required once the board has approved it and
  // rejected before then, so the manifest's flat `false` is the safe half of
  // a rule this form states in full below.
  issue_date: { req: 1 },
  // Required whenever a real vesting template is chosen, which is the only
  // time the field renders at all.
  vesting_start_date: { req: 1 },
};
const mfSkip = (k, what) => !!(MF_SKIP[k] && MF_SKIP[k][what]);
const mfName = (k) => MF_ALIAS[k] || k;
const mfField = (k) => S.manifest[mfName(k)];

/** Index by field name. `hidden` is always false on the wire — the server drops
    a suppressed field from the list entirely — but an entry that ever arrives
    hidden describes a control nobody types into, so it speaks for nothing. */
function mfIndex(fields) {
  const out = {};
  for (const f of sect(fields)) {
    if (f && typeof f.name === "string" && !f.hidden) out[f.name] = f;
  }
  return out;
}

/** One inline descriptor with whatever the manifest actually covers laid over it.
    Applied inside spec()'s F, so a manifest `required` for a field this form does
    not render can never reach validation and make the form unsatisfiable. */
function mfApply(d) {
  const m = mfField(d.k);
  if (!m) return d;
  if (m.label && !mfSkip(d.k, "label")) d.label = m.label;
  if (typeof m.required === "boolean" && !mfSkip(d.k, "req")) {
    // `req` doubles as the footer's phrase, so the server's answer switches the
    // inline phrase on or off rather than replacing it with a bare boolean.
    d.req = m.required ? d.req || `a ${String(d.label).toLowerCase()}` : false;
  }
  if (d.kind === "sel" && !MF_DYNAMIC.has(mfName(d.k)) && !mfSkip(d.k, "values")) {
    const opts = mfOpts(m);
    if (opts) d.opts = opts;
  }
  return d;
}
/** A static enum is taken only when the manifest names every value it lists.
    The form's lists read as English ("Has determined 144 date"); the bare wire
    values do not, so a values-only overlay would trade one for the other. */
/** Carta's currency list, from the field manifest — ISO codes, each its own label, so
    mfOpts() cannot build them. No manifest means no list worth trusting: the control
    stays free text rather than offering one that might omit the right currency. */
function curOpts() {
  const m = S.manifest && S.manifest.currency;
  const vals = m && Array.isArray(m.values) ? m.values.filter(Boolean).map(String) : [];
  if (!vals.length) return [];
  const cur = String(S.shared.currency || "").trim();
  return (cur && !vals.includes(cur) ? [cur, ...vals] : vals).map((v) => [v, v]);
}

function mfOpts(m) {
  const vals = Array.isArray(m.values) ? m.values : [];
  const L = m.enum_labels;
  if (!vals.length || !L) return null;
  const lab = (v, i) => (Array.isArray(L) ? L[i] : L[v]);
  if (vals.some((v, i) => lab(v, i) == null || lab(v, i) === "")) return null;
  return vals.map((v, i) => [v, lab(v, i)]);
}

/** Manifest defaults fill a blank, never an answer. They land with the rest of
    the terms load, and applyDerived() keeps every value this form computes for
    itself — including the sole-plan, sole-class, sole-legend and sole-docset
    picks, which is why a dynamic field's default is not taken here either. */
function mfDefaults() {
  if (S.hydrated) return;
  for (const d of spec()) {
    if (d.kind === "check" || "val" in d) continue;
    if (MF_DYNAMIC.has(mfName(d.k)) || mfSkip(d.k, "default")) continue;
    const m = mfField(d.k);
    if (!m || m.default_value == null || m.default_value === "") continue;
    const cur = S.shared[d.k];
    if (cur === "" || cur == null) S.shared[d.k] = String(m.default_value);
  }
}

/* ---------- one field spec drives render, per-row overrides and validation ---------- */
// `req` doubles as the footer's phrase, `over` marks a row-overridable field, and
// `noFuture` caps a date the server refuses past today. Conditional fields are absent.
function spec() {
  const sh = S.shared, t = S.type, s = [];
  const F = (k, label, kind, x) => s.push(mfApply(Object.assign({ k, label, kind }, x || {})));
  const vest = () => {
    // "No vesting" is a real option and the default, so a blank one above it would
    // be a second way to say the same thing.
    F("vesting_template", "Vesting", "sel", { opts: vestOpts(), over: 1, noPh: 1 });
    const real = sh.vesting_template && sh.vesting_template !== NONE;
    if (real && !isMilestone()) {
      F("vesting_start_date", "Vesting start", "date", { over: 1, req: "a vesting start date" });
    }
    if (real && accelOpts().length) {
      F("acceleration_template", "Acceleration", "sel",
        { opts: accelOpts(), over: 1, ph: "No acceleration" });
    }
  };
  const cls = () => F("prefix", classNoun(), "sel", { opts: classOpts(), over: 1,
    req: `a ${classNoun().toLowerCase()}` });

  if (t === "option_grant") {
    const zepo = sh.so_type === "ZEPO";
    // The plan is the draft set's, not the row's — carta-web locks equity_plan_id
    // once the set exists — so this one term stays shared.
    // Carta fixes a set's plan when it creates it (cw_resources sends it only then, and
    // carta-web takes no plan on a save), so once the set exists the plan is read-only.
    const fixed = S.draftSetId != null && S.draftSetId !== "";
    F("option_plan_id", "Option plan", "sel", { opts: planOpts(), req: "an option plan", dis: fixed,
      hint: fixed ? "The plan is fixed once the draft set is saved." : "" });
    if (regionAmbiguous()) {
      // Scopes which grant types are legal rather than reaching the payload; so_type
      // itself is the per-row answer.
      F("jurisdiction", "Jurisdiction", "sel", { req: "a jurisdiction",
        opts: candidates().map((c) => [c, JUR[c] || c]),
        hint: "We cannot tell which country's rules apply. Your answer sets the holder's tax treatment." });
    }
    const rg = region();
    F("so_type", rg ? `Grant type (${rg})` : "Grant type", "sel",
      { opts: rg ? SO[rg].map((v) => [v, v]) : [], over: 1, req: "a grant type",
        hint: rg ? "" : "Choose a jurisdiction first." });
    F("exercise_price", "Exercise price", "num", { over: 1, min: 0, dis: zepo,
      val: zepo ? "0" : sh.exercise_price, req: !zepo && "an exercise price",
      hint: zepo ? "ZEPO — fixed at 0" : fmvWarning() });
    F("currency", "Currency", curOpts().length ? "sel" : "text", { over: 1, opts: curOpts() });
    F("board_mode", "Board approval", "sel", { over: 1, noPh: 1,
      opts: [["approved", "Approved"], ["pending", "Pending board approval"]] });
    // A grant gets its issue date from the board's approval, so the server
    // refuses one before then: "Issue date is not applicable for grants that
    // are not board approved." Pending grants therefore have no issue date to
    // collect, and `rowPayload` leaves the key off.
    if (sh.board_mode === "approved") {
      F("issue_date", "Issue date", "date", { over: 1, req: "an issue date", noFuture: 1 });
      F("board_approval_date", "Board approval date", "date",
        { over: 1, req: "a board approval date", noFuture: 1 });
    }
    // Editable, but still derived: choosing another plan or issue date recomputes it.
    F("grant_expiration_date", "Grant expiration", "date", { over: 1 });
    vest();
    F("document_set_id", "Document set", "sel", { opts: docOpts(), req: "a document set",
      over: 1, hint: docSetProblem(docSetOf(sh.document_set_id), sharedPlan()), hintCls: "warn" });
    if (!zepo) F("early_exercise", "Early exercise", "check", { over: 1 });
    if (sh.so_type === "Unapproved") {
      F("employment_related", "Employment related", "sel", { over: 1,
        req: "an employment-related answer",
        opts: [["true", "Yes"], ["false", "No"]], hint: "Unapproved grants at a UK company need this." });
    }
    // Both optional, and both exist server-side only for their own option types.
    if (HMRC_SO_TYPES.has(sh.so_type)) {
      F("is_hmrc_notified", "HMRC has been notified", "check", { over: 1 });
      F("hmrc_notified", "Date HMRC was notified", "date",
        { over: 1, hint: "Optional — leave blank if you have not notified HMRC yet." });
    }
    if (ATO_SO_TYPES.has(sh.so_type)) {
      F("ato_notified", "ATO has been notified", "check", { over: 1 });
    }
  } else if (t === "certificate") {
    cls();
    F("law_firm_price", "Price per share", "num", { over: 1, min: 0, req: "a price per share" });
    F("currency", "Currency", curOpts().length ? "sel" : "text", { over: 1, opts: curOpts() });
    F("issue_date", "Issue date", "date", { over: 1, req: "an issue date", noFuture: 1 });
    F("board_approval_date", "Board approval date", "date",
      { over: 1, req: "a board approval date", noFuture: 1 });
    F("legend_id", "Legend", "sel", { opts: legendOpts(), req: "a legend", over: 1 });
    F("rule_144_mode", "Rule 144 date", "sel", { over: 1, noPh: 1,
      opts: [["issue_date", "Same as issue date"], ["other", "A different date"]] });
    if (sh.rule_144_mode === "other") {
      F("rule_144_date", "Rule 144 date", "date", { over: 1, req: "a Rule 144 date" });
      F("rule_144_reason", "Reason it differs", "sel",
        { opts: R144, over: 1, req: "a Rule 144 reason" });
    }
    const cc = chosenClass();
    if (cc && cc.dividend === "Non-cash") {
      F("dividend_accrual_start_date", "Dividend accrual start", "date",
        { over: 1, req: "a dividend accrual date", hint: `${cc.name || cc.prefix} pays non-cash dividends.` });
    }
    vest();
  } else {
    const noun = String(S.thresholdNoun || "Threshold"), Noun = capNoun(noun);
    cls();
    F("threshold_value_type", `${Noun} type`, "sel", { over: 1, req: `a ${noun.toLowerCase()} type`,
      opts: [["Unit", "Unit — per unit"], ["Overall", "Overall — once for the whole grant"]] });
    F("threshold_value", `${Noun} value`, "num", { over: 1, min: 0, dp: 12,
      req: `a ${noun.toLowerCase()} value` });
    F("option_plan", "Equity plan", "sel", { opts: planOpts(), over: 1, ph: "No plan" });
    F("currency", "Currency", curOpts().length ? "sel" : "text", { over: 1, opts: curOpts() });
    F("issue_date", "Issue date", "date", { over: 1, req: "an issue date", noFuture: 1 });
    F("board_approval_date", "Board approval date", "date", { over: 1, noFuture: 1 });
    if (S.docSets.length) {
      // Optional until Carta requires a document of it: then no set is refused too.
      F("document_set_id", "Document set", "sel", { opts: docOpts(), over: 1,
        req: docsRequired(sharedPlan()).length ? "a document set" : false,
        hint: docSetProblem(docSetOf(sh.document_set_id), sharedPlan()), hintCls: "warn" });
    }
    vest();
    const cc = chosenClass();
    const LINK = "Also issue the matching interest in the linked operating company";
    if (cc && cc.has_corresponding_interest) {
      F("corresponding_interest", LINK, "check", { over: 1 });
    } else if (cc && !("has_corresponding_interest" in cc)) {
      // An absent key is UNKNOWN, never "no": carta-web pops the field when the feature
      // is off, so "no link" and "could not see links" arrive identically.
      F("corresponding_interest", LINK, "check",
        { over: 1, hint: "Carta did not report whether this unit class has a link. Tick it if you "
          + "know it does — Carta refuses it if not." });
    }
  }
  F("notes", "Notes", "text", { over: 1, wide: 1, ph: "Optional" });
  return s;
}

const specVal = (d) => ("val" in d ? d.val : S.shared[d.k]);
function control(d, id, v, scope, ph) {
  if (d.kind === "sel") {
    // Offered so the control can show it; choosing anything else replaces it.
    if (v === AS_SAVED) d = Object.assign({}, d, { opts: [[AS_SAVED, AS_SAVED_LABEL]].concat(d.opts || []) });
    const empty = S.termsLoading && !(d.opts || []).length;
    // `noPh` drops the blank option: a shared control whose default is a real choice,
    // or an override already holding the value it inherits.
    return sel(id, v, d.opts, { k: d.k, scope, dis: d.dis,
      placeholder: ph || (d.noPh ? false : (empty ? "Loading…" : d.ph)) });
  }
  // `max` on a date Carta refuses past today: the picker stops offering the day that
  // would come back rejected, instead of the form learning it from a round trip.
  const kept = v === AS_SAVED;
  return txt(id, kept ? "" : v, { k: d.k, scope, num: d.kind === "num", ro: d.ro, dis: d.dis,
    type: d.kind === "date" ? "date" : "text", ph: kept ? AS_SAVED_LABEL : ph || d.ph,
    max: d.noFuture ? latestDate() : "" });
}
/** Placeholders in the shape the real controls will take, so the card does not
    resize under the reader when the terms arrive. */
const SKELETON_FIELDS = { option_grant: 8, certificate: 8, piu: 7 };
function skeletonHtml() {
  const n = SKELETON_FIELDS[S.type] || 8;
  return Array.from({ length: n }, () =>
    '<div class="f" aria-hidden="true"><div class="sk-l"></div><div class="sk"></div></div>').join("");
}

function specHtml() {
  return spec().map((d) => {
    const id = `shared-${d.k}`;
    const v = specVal(d);
    if (v === AS_SAVED && (d.kind === "check" || d.kind === "date")) d = Object.assign({}, d, { hint: AS_SAVED_LABEL });
    if (d.kind === "check") return chk(id, v === true, d.label, { k: d.k, hint: d.hint });
    const g = d.kind === "num" ? grouped(v) : "";
    return fld(id, d.label, control(d, id, v, "shared"),
      { req: !!d.req, hint: g || d.hint, hintCls: g ? "echo" : d.hintCls || "", wide: d.wide });
  }).join("");
}

/* ---------- render ---------- */
// Drawn from the seed on the first pass, before any transport call returns. Every
// value lives in S, so a later re-render cannot overwrite the user's answer.
/** Name the Carta this page writes to. A corporation id is not unique across
    environments, so this is the only place a viewer can catch the wrong one. */
function subtitleHtml() {
  const via = T.server ? ` · via ${esc(T.server)}` : "";
  const who = `<b>${esc(S.corpName)}</b> · ${esc(typeLabel())}${via}`;
  return S.connErr ? `${who} · no live data` : who;
}
/** Blockers the page decides for itself. Derived at render time rather than stored, so
    an ingest cannot drop them and a changed plan or unit class cannot leave one stale. */
function localBlockers() {
  const out = [];
  // Only when the boot answered. A boot that failed learned nothing about the company,
  // so blaming its name sends the user to fix a name that was never wrong.
  if (noCorporation() && !S.bootFailed && !S.connErr) {
    out.push({ key: "corporation.unresolved", severity: "hard_stop",
      message: `Carta could not tell which company "${S.corpName}" is. Tell Claude the `
        + "company's full legal name, then open this page again." });
  }
  if (S.type === "option_grant" && fmv().ambiguous) {
    out.push({ key: "valuation.multiple_active_same_class", severity: "needs_decision",
      message: "More than one valuation is live on this plan's share class. An HMRC report "
        + "gives both an AMV and a UMV, and which one a grant prices from changes the "
        + "holder's tax position — set the exercise price yourself." });
  }
  // Nothing server-side refuses a PIU on a company that is not an LLC, so this is the
  // only place it is said. An absent isLLC is unknown, and says nothing.
  if (S.type === "piu" && S.isLLC === false) {
    out.push({ key: "piu.not_an_llc", severity: "warn",
      message: "Profits interest units are an LLC instrument and this company is not an LLC." });
  }
  return out;
}
const allBlockers = () => objs(S.blockers).concat(localBlockers());
/** Every command is addressed by corporation id, so without one nothing can be read
    or written — whatever left it missing. A page with no connection never asked, so it
    says that instead. */
const noCorporation = () => S.ready && S.corpId == null && !S.termsLoading && !S.connErr;
/** A hard stop means nothing on this form can be issued, so the form does not
    render around it — the problems and their fix are the whole page. */
const hardStops = () => allBlockers().filter((b) => b.severity === "hard_stop");
const pageStopped = () => hardStops().length > 0 || noCorporation();
/** Replacing a focused, edited control makes the browser fire `change` on it while
    it is still in the tree. That event carries the value from before this render, so
    commit() has to ignore everything raised inside this window. */
let rendering = false;
function render() {
  if (!S.ready) return;
  rendering = true;
  try {
    const keep = grabFocus();
    el("subtitle").innerHTML = subtitleHtml();
    renderBlockers();
    renderNotices();
    const done = S.stage === "issued";
    const stopped = !done && pageStopped();
    const reviewing = S.stage === "review";
    // After the fact the page names what happened, not what to do.
    const h1 = el("title");
    const noun = unitNoun()[1];
    if (h1) h1.textContent = done ? `${noun[0].toUpperCase()}${noun.slice(1)} issued` : `Issue ${noun}`;
    el("shared-card").hidden = done || reviewing || stopped;
    el("rows-card").hidden = done || reviewing || stopped;
    el("review-card").hidden = done || !reviewing || stopped;
    el("issued-card").hidden = !done;
    if (done) {
      el("review").innerHTML = "";
      el("issued").innerHTML = issuedHtml();
    } else if (stopped) { /* nothing to draw: the notes above are the page */
    } else if (reviewing) {
      el("review").innerHTML = reviewHtml();
    } else {
      // Cleared, not just hidden: a stale review must not outlive the stage it belongs
      // to, least of all the sentence saying what confirming commits to.
      el("review").innerHTML = "";
      // Until the terms land every select here is empty, which reads as a form with
      // no answers rather than a form still loading.
      el("shared-grid").innerHTML = S.termsLoading && !S.connErr
        ? skeletonHtml() : specHtml();
      el("rows").innerHTML = S.rows.map((r, i) => rowHtml(r, i)).join("");
    }
    const rh = el("review-heading");
    if (rh) rh.textContent = S.stuck ? "What was sent to Carta" : "Review before issuing";
    // Nothing typed here can be saved, so nothing here takes typing.
    if (S.connErr) {
      document.querySelectorAll('[data-testid="shared-card"] input, [data-testid="shared-card"] select,'
        + ' [data-testid="rows-card"] input, [data-testid="rows-card"] select,'
        + ' [data-testid="rows-card"] button').forEach((n) => { n.disabled = true; });
    }
    renderFooter();
    renderSheet();
    const load = el("loading");
    if (load) load.hidden = !!S.connErr || !(S.termsLoading || S.rosterLoading);
    const st = el("status");
    st.hidden = !S.banner;
    st.className = `status${S.bannerBad ? " bad" : ""}`;
    st.textContent = S.banner;
    putFocus(keep);
  } finally { rendering = false; }
}

/** A background load can land mid-field, and innerHTML drops the focused
    node, so the caret is captured and put back. */
function grabFocus() {
  const a = document.activeElement;
  if (!a || !a.getAttribute || !a.getAttribute("data-testid")) return null;
  let sel = null;
  // selectionStart throws on date inputs; there is nothing to keep there.
  try { sel = a.selectionStart == null ? null : [a.selectionStart, a.selectionEnd]; } catch { sel = null; }
  return { t: a.getAttribute("data-testid"), sel, combo: a.getAttribute("data-combo") };
}
function putFocus(keep) {
  if (!keep) return;
  const n = el(keep.t);
  if (!n || n === document.activeElement) return;
  n.focus();
  if (keep.sel && n.setSelectionRange) {
    try { n.setSelectionRange(keep.sel[0], keep.sel[1]); } catch { /* not a text field */ }
  }
  // The suggestion list lives outside S, so it is rebuilt rather than kept.
  if (keep.combo != null) suggest(n, Number(keep.combo));
}
/** Mid-typeahead, the correct update is no re-render: touch only what a new
    search result changes. */
function softRender() {
  const a = document.activeElement;
  if (a && a.getAttribute && a.getAttribute("data-combo") != null && S.stage !== "review") {
    el("subtitle").innerHTML = subtitleHtml();
    for (const n of document.querySelectorAll("[data-combo]")) {
      n.setAttribute("placeholder", comboPlaceholder());
    }
    suggest(a, Number(a.getAttribute("data-combo")));
    renderFooter();
    return;
  }
  render();
}
const typeLabel = () => ({ option_grant: "Option grant", certificate: "Certificate",
  piu: "Profits interest units" }[S.type] || S.type);
// draft_set_name is capped at 30 chars server-side; keep the date whole.
const shortLabel = () => ({ option_grant: "Option grant", certificate: "Certificate",
  piu: "PIU" }[S.type] || S.type);
const headcount = () => S.roster.length;
/** The roster's wait belongs to this one control, not to the whole form. */
const comboPlaceholder = () => (S.rosterLoading ? "Loading stakeholders…"
  : S.searching ? "Searching Carta…"
  : "Type a name or email to search Carta…");

function renderBlockers() {
  const stops = hardStops();
  // `needs_decision` means the server deliberately would not pick. Grouped with
  // the advisory notes it reads as "worth a look" and gets skipped.
  const all = allBlockers();
  const decide = all.filter((b) => b.severity === "needs_decision");
  const warns = all.filter(
    (b) => b.severity !== "hard_stop" && b.severity !== "needs_decision");
  const li = (b) => `<li data-testid="blocker-${esc(b.key)}">${esc(b.message || b.key)}</li>`;
  el("blockers").innerHTML =
    (stops.length ? noteBox("blockers-stop", true, "Nothing can be issued from this page yet",
      stops.map(li)) : "")
    + (decide.length ? noteBox("blockers-decide", false,
      decide.length === 1 ? "Your call — nothing was chosen for you"
        : `${decide.length} choices are yours — nothing was chosen for you`, decide.map(li),
      "Carta holds competing answers here, so picking one for you could set the wrong terms. Choose below before you review.") : "")
    + (warns.length ? noteBox("blockers-warn", false,
      warns.length === 1 ? "Worth checking first"
        : `${warns.length} things worth checking first`, warns.map(li)) : "");
}

/** Runs the load again in place, which is reads only. Without it the only way out of a
    failed load is to leave the page for the chat. */
const RETRY_BUTTON = '<button id="retry-load" data-testid="retry-load" type="button">Try again</button>';

const nameKey = (s) => String(s == null ? "" : s).trim().toLowerCase();
/** A name notice asks for something on a row. It says nothing more once that row has it,
    and never over a stop, a review or a sheet, where there is no row to act on. */
function nameNoticesLive() {
  return S.stage === "edit" && !S.sheet && !hardStops().length;
}
/** Unmatched names come in as new-stakeholder rows; each still needs its email. */
const unmatchedOpen = (n) => S.rows.some((r) => r.isNew && nameKey(r.name) === nameKey(n)
  && !r.email.trim());
/** An ambiguous name comes in as a row still to be picked from the list. */
const ambiguousOpen = (term) => S.rows.some((r) => !r.isNew && r.stakeholderId == null
  && nameKey(r.query) === nameKey(term));

/** The one thing a sealed page must say at the top: whether anything landed is unknown,
    and which draft set to have checked. */
function outcomeNote() {
  if (!S.stuck || S.issued) return "";
  const set = draftSetPhrase();
  const title = S.stuckTitle || "Outcome unknown";
  return noteBox("notice-outcome-unknown", true, set ? `${title} — ${set}` : title, [],
    S.stuckTitle ? S.stuck
      : set ? `Ask Claude to check ${set} in Carta. Don't issue again from here.`
      : "Ask Claude to check this issuance in Carta. Don't issue again from here.");
}

function renderNotices() {
  const p = S.prefill, out = [];
  // Every notice below the connector's says "fix this on the form below", and on the
  // issued stage there is no form and nothing left to fix.
  const done = S.stage === "issued";
  const live = nameNoticesLive();
  const amb = live ? objs(p.ambiguous).filter((a) => ambiguousOpen(a.term)) : [];
  const un = live
    ? arr(p.unmatched).filter((n) => typeof n === "string" && unmatchedOpen(n)) : [];
  out.push(outcomeNote());
  if (S.connErr) {
    out.push(noteBox("notice-no-live-data", true,
      "This page has no live Carta data", [], S.connErr));
  }
  if (amb.length) {
    out.push(noteBox("notice-ambiguous", false,
      `${amb.length} name${amb.length > 1 ? "s" : ""} matched more than one stakeholder`,
      amb.map((a) => `<li data-testid="ambiguous-${esc(a.term)}">“${esc(a.term)}” matches ${Number(a.count)} stakeholders — pick the right one below; nothing was chosen for you.</li>`)));
  }
  if (un.length) {
    out.push(noteBox("notice-unmatched", false,
      `${un.length} name${un.length > 1 ? "s" : ""} not on the cap table`,
      un.map((n) => `<li data-testid="unmatched-${esc(n)}">${esc(n)} — set up below as a new stakeholder. Add their email, or pick them from the list if they are on the cap table under another name.</li>`)));
  }
  if (S.narrowed && !done) {
    // Carta caps the bootstrap's size and says what it gave up. Clipped rows
    // mean recipients are missing from the form — never leave that unsaid.
    const applied = arr(S.narrowed.applied).map(String);
    const lostRows = applied.some((a) => /row/i.test(a));
    out.push(noteBox("notice-narrowed", lostRows,
      lostRows ? "Not every recipient reached this form"
        : "Carta shortened some of the detail below",
      applied.map((a) => `<li>${esc(a)}</li>`),
      lostRows
        ? "Add the missing people below, or ask Claude to split this into smaller batches."
        : "The terms and the recipients are unaffected."));
  }
  // Stacked under the connector notice this reads as a second, different problem.
  if (S.loadErr && !S.connErr) {
    out.push(noteBox("notice-load-error", true, S.loadErr, [],
      "Nothing has been saved. If trying again does not help, ask Claude to open this page again.",
      RETRY_BUTTON));
  }
  if (S.searchErr && !done) {
    out.push(noteBox("notice-search-error", false,
      "Searching Carta for more stakeholders failed", [],
      `Only the ${headcount().toLocaleString()} names already loaded can be picked. Check before creating anyone new.`));
  }
  const all = serverErrorLines();
  if (all.length) {
    out.push(noteBox("notice-server-errors", true, "Carta couldn't accept these terms",
      all.map((m) => `<li>${esc(m)}</li>`), "", "", ' tabindex="-1"'));
  }
  el("notices").innerHTML = out.join("");
}

/** Who the row is, as opposed to what terms they get. These belong to the row itself,
    so they sit on it rather than inside the shared-terms override panel. */
function identityHtml(r, i) {
  const p = `row-${i}`;
  return fld(`${p}-kind`, "Stakeholder type",
    sel(`${p}-kind`, r.kind, [["INDIVIDUAL", "Individual"], ["NON-INDIVIDUAL", "Entity"]],
      { k: "kind", scope: p, placeholder: false }), { req: true })
    + fld(`${p}-relationship`, "Relationship",
      sel(`${p}-relationship`, r.relationship, REL.map((x) => [x, x]), { k: "relationship", scope: p }),
      { req: true });
}

function ovHtml(r, i) {
  const p = `row-${i}`, o = [];
  for (const d of spec()) {
    if (!d.over) continue;
    const id = `${p}-ov-${d.k}`;
    const v = d.k in r.ov ? r.ov[d.k] : inheritedVal(d, r);
    // A row answers a checkbox with a Yes / No of its own, so it reads as a choice.
    const yn = [["true", "Yes"], ["false", "No"]];
    const cv = v === AS_SAVED || v === "" ? v : String(v === true || v === "true");
    const body = d.kind === "check"
      ? sel(id, cv, v === AS_SAVED ? [[AS_SAVED, AS_SAVED_LABEL]].concat(yn) : yn,
        { k: d.k, scope: `ov-${i}`, placeholder: cv === "" ? "Select…" : false })
      : control(Object.assign({}, d, { noPh: d.noPh || (v !== "" && v != null) }), id, v, `ov-${i}`);
    o.push(fld(id, d.label, body));
  }
  return o.join("");
}
/** What a row shows for a term it has not overridden: the shared value, except a term
    the load could not read, which a row added to a resumed set does not inherit. */
function inheritedVal(d, r) {
  const v = specVal(d);
  return v === AS_SAVED && !r.resumed ? "" : v;
}
/** One term's value as a reader sees it. A row's override of a checkbox is the string
    "false", which is truthy, so a tick is read by value rather than by truthiness. */
function disp(d, v) {
  if (v === AS_SAVED) return AS_SAVED_LABEL;
  if (d.kind === "check") return v === true || v === "true" ? "Yes" : "No";
  if (v === "" || v == null) return "—";
  if (d.kind === "date") return longDate(v);
  const m = (d.opts || []).find((x) => String(x[0]) === String(v));
  return m ? m[1] : String(v);
}
const shDisp = (d) => disp(d, specVal(d));

/* ---------- review ---------- */
// Reads rowValues(), the row as the form holds it — the same values a save derives its
// payload from, so the review cannot drift from what is written.
function unitPrice(d) {
  return S.type === "option_grant" ? d.exercise_price
    : S.type === "certificate" ? d.law_firm_price : null;
}
/** What the review's own price column already renders, per type — the mirror of
    unitPrice() and priceHead. Repeating them in the details block reads as two prices. */
const PRICE_KEYS = { option_grant: ["exercise_price"], certificate: ["law_firm_price"],
  piu: ["threshold_value", "threshold_value_type"] };
/** Grouped by the row's own currency. A batch can mix so_types, so it can mix
    currencies, and a cross-currency total would be meaningless. A PIU carries no price,
    so its units add up across every row. */
function totals(byCurrency) {
  const by = new Map();
  for (const r of S.rows) {
    const d = rowValues(r);
    const cur = S.type === "piu" && !byCurrency ? "" : d.currency || "—";
    const t = by.get(cur) || { qty: 0, value: 0, priced: false };
    t.qty += Number(d.quantity || 0);
    const p = unitPrice(d);
    if (p !== null && p !== "" && p != null) {
      t.priced = true;
      t.value += Number(p) * Number(d.quantity || 0);
    }
    by.set(cur, t);
  }
  return by;
}
/** What a money total is the total of. A price per share times shares is what the
    holder pays; per option, what exercising every option would cost. */
const VALUE_OF = { option_grant: "total exercise cost" };
/** The quantity inside each row, which is not the count of rows. */
const QTY_NOUN = { option_grant: ["option", "options"], certificate: ["share", "shares"],
  piu: ["unit", "units"] };
const qtyNoun = () => QTY_NOUN[S.type] || ["unit", "units"];
const qtyHead = () => capNoun(qtyNoun()[1]);
/** "Total" alone when one currency covers the batch, which is the usual case. */
const totalLabel = (cur, n) => (S.type === "piu" ? "Total units"
  : n > 1 ? `Total — ${cur}` : "Total");

function reviewHtml() {
  const priceHead = S.type === "option_grant" ? "Exercise price"
    : S.type === "certificate" ? "Price / share" : capNoun(S.thresholdNoun);
  const rows = S.rows.map((r, i) => {
    const d = rowValues(r);
    // Who the row is. Every shared term the sub-line used to carry is in the details
    // block below, so repeating it here said the same thing twice per recipient.
    const who = [r.email, d.issue_date_relationship].filter(Boolean).join(" · ");
    const ovKeys = Object.keys(r.ov);
    // The values, not just the field names: the details block states the batch's
    // answer, so a row that overrode one has it nowhere else.
    const ovLabels = ovKeys.length
      ? spec().filter((x) => ovKeys.includes(x.k))
        .map((x) => `${x.label}: ${disp(x, r.ov[x.k])}`)
      : [];
    // A row added to a resumed set gets none of the terms shown "As saved in Carta".
    const unset = r.resumed ? [] : spec().filter((x) => x.over && S.shared[x.k] === AS_SAVED
      && !(x.k in r.ov)).map((x) => x.label);
    // A row's own issue date moves its expiry, which goes out with it; say so here.
    if (S.type === "option_grant" && "issue_date" in r.ov && !("grant_expiration_date" in r.ov)
      && (!r.resumed || r.touched.has("issue_date")) && d.grant_expiration_date) ovLabels.push(`Grant expiration: ${longDate(anyDateIso(d.grant_expiration_date))}`);
    const priceKey = PRICE_KEYS[S.type][0];
    const kept = (priceKey in r.ov ? r.ov[priceKey] : S.shared[priceKey]) === AS_SAVED;
    const price = kept ? AS_SAVED_LABEL : S.type === "piu"
      ? `${money(d.threshold_value, d.currency)} ${d.threshold_value_type === "Overall" ? "overall" : "/ unit"}`
      : money(unitPrice(d), d.currency);
    return `<div class="rv-r" data-testid="review-row-${i}">
      <div><b>${esc(r.name)}</b>${r.stakeholderId == null && (!r.resumed || r.touched.has("stakeholder")) ? " <span class=\"rv-tag\">(new)</span>" : ""}
        <div class="rv-s">${esc(who)}</div>
        ${ovLabels.length ? `<div class="rv-tag" data-testid="review-row-${i}-override">Overridden — ${esc(ovLabels.join(" · "))}</div>` : ""}
        ${unset.length ? `<div class="rv-tag" data-testid="review-row-${i}-unset">Not set on this row: ${esc(unset.join(", "))}</div>` : ""}</div>
      <div class="rv-n">${Number(d.quantity).toLocaleString()}</div>
      <div class="rv-n">${esc(price)}</div>
    </div>`;
  }).join("");

  const groups = [...totals().entries()];
  const tot = groups.map(([cur, t]) =>
    `<div class="rv-t" data-testid="review-total-${esc(cur || "units")}">
      <div>${esc(totalLabel(cur, groups.length))}</div>
      <div class="rv-n" data-testid="review-total-qty-${esc(cur || "units")}">${t.qty.toLocaleString()}</div>
      <div class="rv-n" data-testid="review-total-value-${esc(cur || "units")}">${t.priced
        ? `${esc(money(t.value, cur))}${VALUE_OF[S.type] ? `<div class="rv-cap">${esc(VALUE_OF[S.type])}</div>` : ""}` : ""}</div>
    </div>`).join("");

  const priced = PRICE_KEYS[S.type] || [];
  const terms = spec().filter((d) => d.k !== "notes" && !priced.includes(d.k)
    && specVal(d) !== "" && specVal(d) != null
    && specVal(d) !== false).map((d) => `<div data-testid="review-term-${d.k}">
      <dt>${esc(d.label)}</dt>
      <dd>${esc(shDisp(d))}</dd>
    </div>`).join("");

  // Once the page is sealed it will confirm nothing more, so it does not say what
  // confirming would do.
  const sealed = !!(S.stuck || S.issued);
  return `<div class="rv-h"><div>Stakeholder</div><div class="rv-n">${esc(qtyHead())}</div>
      <div class="rv-n">${esc(priceHead)}</div></div>
    <div data-testid="review-rows">${rows}</div>
    ${tot}
    <dl class="rv-terms" data-testid="review-terms">${terms}</dl>
    ${S.shared.notes ? `<p class="rv-s" data-testid="review-notes">Notes: ${esc(disp({}, S.shared.notes))}</p>` : ""}
    ${legendHtml()}
    ${sealed ? "" : `<p class="rv-commit" data-testid="review-commit">${esc(CONFIRM_LINE[S.type] || "")}</p>`}`;
}
/** The holder attests to the legend's words, not its template name, so the full body is
    readable here before Confirm. `legend_body` is review-only and never sent — the
    server resolves the body from legend_id. */
function legendHtml() {
  if (S.type !== "certificate") return "";
  const l = S.legends.find((x) => String(x.id) === String(S.shared.legend_id));
  if (!l) return "";
  const body = l.text || l.body || "";
  return `<details class="legend" data-testid="review-legend">
    <summary>View legend — ${esc(l.name || "Legend")}</summary>
    ${body ? `<pre data-testid="review-legend-body">${esc(body)}</pre>`
      : `<p class="rv-s" data-testid="review-legend-missing">Carta did not return this legend's text. Open the legend in Carta and read it before you issue.</p>`}
  </details>`;
}

/* ---------- issued ----------
   long-comment-ok: the two shapes `issued[]` arrives in, and why the page reads both.
   It has carried `{id}` alone, with no label and no key back to a row. An enriched
   entry names the security, its quantity and its holder, and that is the server's own
   record of what it wrote — so it wins whenever every entry has one. Falling back to
   the form's rows is only honest when the counts match: nothing promises the order,
   and a positional join over a partial answer would name the wrong holder. A raw id is
   never shown; it is not something a reader can use. */
const txtOf = (v) => (typeof v === "string" ? v.trim()
  : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
/** Field names on an enriched entry are still settling, so each is read by meaning. */
const issuedLabel = (x) => txtOf(x.label) || txtOf(x.security_label) || txtOf(x.securityLabel);
/** The row an entry was issued from, when that is provable: its draft_pk, or the one row
    of a one-row issue. A name is not proof — one holder can hold two rows of a batch. */
function issuedFrom(x) {
  const pk = x.draft_pk ?? x.draftPk;
  if (pk != null) return S.rows.find((r) => String(S.drafts[r.key]) === String(pk)) || null;
  return S.rows.length === 1 && objs(S.issuedRows).length === 1 ? S.rows[0] : null;
}
/** Carta names the security and its holder, but its quantity comes off the rows a call
    sent, and issuing a saved set sends none — so the submitted row fills the gap. */
const issuedWho = (x) => txtOf(x.stakeholder_name) || txtOf(x.stakeholderName)
  || txtOf(x.holder_name) || txtOf(x.holderName) || ((issuedFrom(x) || {}).name || "").trim();
const issuedEmail = (x) => txtOf(x.stakeholder_email) || txtOf(x.email)
  || ((issuedFrom(x) || {}).email || "").trim();
const issuedQty = (x) => {
  const q = x.quantity != null ? x.quantity : x.shares;
  return q != null ? q : (issuedFrom(x) || {}).quantity;
};
const qtyText = (v) => (v === "" || v == null || !Number.isFinite(Number(v))
  ? "—" : Number(v).toLocaleString());

/** A certificate lands on the cap table; a grant or a unit goes to the signatory. */
function issuedSentence(n) {
  const [sing, many] = unitNoun();
  const what = esc(plural(n, sing, many));
  return S.type === "certificate"
    ? `${what} ${n === 1 ? "is" : "are"} on <b>${esc(S.corpName)}</b>'s cap table.`
    : `${what} ${n === 1 ? "was" : "were"} issued on <b>${esc(S.corpName)}</b> and sent for signature.`;
}

function issuedHtml() {
  const entries = objs(S.issuedRows);
  const n = S.issued || entries.length;
  // The page is the only record when Claude was never told, so it says so here, where it
  // stays, rather than on a sheet the reader can dismiss.
  const head = `<p class="rv-s rv-lead" data-testid="issued-summary">${issuedSentence(n)}</p>`
    + toldHtml({ told: !S.untold }, "");
  const named = entries.length > 0 && entries.every((x) => issuedLabel(x));
  let cells;
  if (named) cells = entries.map((x) => [issuedWho(x), issuedLabel(x), issuedQty(x), issuedEmail(x)]);
  else if (entries.length === S.rows.length) cells = S.rows.map((r) => [(r.name || "").trim(), "", r.quantity, (r.email || "").trim()]);
  else return head;
  const rows = cells.map(([who, sec, q, mail], i) => `<div class="rv-r iss" data-testid="issued-row-${i}">
      <div class="rv-w">${esc(who)}${mail ? `<div class="hint" data-testid="issued-row-${i}-email">${esc(mail)}</div>` : ""}</div>
      <div>${esc(sec)}</div>
      <div class="rv-n">${esc(qtyText(q))}</div>
    </div>`).join("");
  return `${head}
    <div class="rv-h iss"><div>Stakeholder</div><div>${named ? "Security" : ""}</div>
      <div class="rv-n">${esc(qtyHead())}</div></div>
    <div data-testid="issued-rows">${rows}</div>`;
}

function rowHtml(r, i) {
  const p = `row-${i}`;
  const top = r.isNew
    ? fld(`${p}-new-name`, "Name",
        txt(`${p}-new-name`, r.name, { k: "name", scope: p }), { req: true })
    : fld(`${p}-stakeholder`, "Name",
        `<div class="combo"><input id="${p}-stakeholder" data-testid="${p}-stakeholder"
          data-k="query" data-scope="${p}" data-combo="${i}" type="text" autocomplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded="false"
          aria-controls="${p}-suggestions" value="${esc(r.query)}" placeholder="${esc(comboPlaceholder())}">
          <ul class="sug" id="${p}-suggestions" role="listbox" data-testid="${p}-suggestions" hidden></ul></div>`,
        { req: true, hint: r.stakeholderId != null ? `${esc(r.email)} · ${esc(r.relationship || "—")}` : "" });
  // `wide` puts the email on its own line under the whole row, and the grid's own
  // gap is what separates it from the name above.
  const email = r.isNew
    ? fld(`${p}-new-email`, "Email",
        txt(`${p}-new-email`, r.email, { k: "email", scope: p, type: "email" }),
        { req: true, wide: true })
    : "";
  const named = r.isNew || r.stakeholderId != null;
  const refused = Object.keys((S.srv.rows || {})[r.key] || {}).length
    || Object.keys((S.srv.fields || {})[r.key] || {}).length;
  return `<div class="row${refused ? " refused" : ""}" data-testid="${p}" data-row-key="${r.key}">
    <div class="row-top">
      <div>${top}</div>
      <div class="qty-f">${fld(`${p}-quantity`, "Quantity",
        txt(`${p}-quantity`, r.quantity, { k: "quantity", scope: p, num: true }),
        { req: true, hint: grouped(r.quantity), hintCls: "echo" })}</div>
      <button class="x" id="${p}-remove" data-testid="${p}-remove" data-act="remove" data-i="${i}" type="button" aria-label="Remove this stakeholder">✕</button>
      ${email}
    </div>
    ${named ? `<div class="grid" data-testid="${p}-identity">${identityHtml(r, i)}</div>` : ""}
    <div class="ov">
      ${!r.isNew ? `<button class="link" id="${p}-new-toggle" data-testid="${p}-new-toggle" data-act="new" data-i="${i}" type="button">Not on the cap table? Create a new stakeholder</button>`
        : `<button class="link" id="${p}-new-toggle" data-testid="${p}-new-toggle" data-act="existing" data-i="${i}" type="button">Pick an existing stakeholder</button>`}
      <button class="link" id="${p}-override-toggle" data-testid="${p}-override-toggle" data-act="ov" data-i="${i}" type="button">
        ${r.open ? "▾" : "▸"} Override shared terms${Object.keys(r.ov).length ? ` (${Object.keys(r.ov).length})` : ""}</button>
      ${r.open ? `<div class="grid" data-testid="${p}-overrides">${ovHtml(r, i)}</div>` : ""}
      ${rowErrHtml(r, p)}
    </div></div>`;
}

/** Carta's refusals of this row that no field of the row can carry. */
function rowErrHtml(r, p) {
  const msgs = S.srv.rows && S.srv.rows[r.key];
  if (!msgs || !Object.keys(msgs).length) return "";
  return `<div class="err" tabindex="-1" data-testid="${p}-server-errors">${Object.values(msgs)
    .map((m) => esc([].concat(m).join("; "))).join(" · ")}</div>`;
}

function renderFooter() {
  // Only a write in flight, a form with no options to show yet, a hard stop or a
  // dead transport disables a button. An incomplete form does not: a dead greyed-out
  // button says nothing about what is wrong, whereas a click paints the offending
  // fields, and the server has the last word on the rest.
  // Nothing may be written again over a set that has committed, or one whose outcome
  // nobody here can establish — so every action goes away rather than sitting live.
  const done = S.issued > 0 || S.stage === "issued" || !!S.stuck;
  const stopped = !done && pageStopped();
  const dead = !!S.connErr;
  const blocked = S.termsLoading || S.busy || dead;
  const reviewing = S.stage === "review";
  el("confirm-issue").hidden = done || reviewing || stopped;
  el("issue").hidden = done || !reviewing || stopped;
  el("back-to-edit").hidden = done || !reviewing || stopped;
  el("save-draft").hidden = done || stopped;
  el("confirm-issue").disabled = blocked;
  el("issue").disabled = blocked;
  el("back-to-edit").disabled = S.busy;
  el("save-draft").disabled = blocked;
  const why = el("blocked-reason");
  why.className = "why";
  // Not `one`: that name is the transport's single call site, one scope away.
  // A sealed, issued or stopped page says why in the note at its top, once.
  why.textContent = done || stopped ? ""
    : dead ? "No live connection to Carta — nothing can be saved from here."
    : S.termsLoading ? "Loading…"
    : problemLine() || S.savedNote;
}

/** One line beside the buttons after Carta refused the terms, naming where to look. */
function problemLine() {
  if (S.stage !== "edit" || !S.srv) return "";
  const set = serverErrorLines().length;
  const owned = S.rows.filter((r) => Object.keys((S.srv.fields || {})[r.key] || {}).length
    || Object.keys((S.srv.rows || {})[r.key] || {}).length);
  const count = set + owned.reduce((n, r) => n + Object.keys((S.srv.fields || {})[r.key] || {}).length
    + Object.keys((S.srv.rows || {})[r.key] || {}).length, 0);
  if (!count) return "";
  const where = set && owned.length ? "the list at the top and the rows marked below"
    : set ? "the list at the top" : (owned[0].name || "").trim() || "the row marked below";
  return `Carta found ${plural(count, "problem", "problems")} — see ${where}.`;
}

/* ---------- validation ---------- */
function validate(write) {
  const e = {}, missing = [];
  const need = (id, lab, ok, msg) => { if (!ok) { e[id] = msg || "Required"; missing.push(lab); } };
  for (const d of spec()) {
    const id = `shared-${d.k}`, v = specVal(d);
    if (v === AS_SAVED) continue;
    const blank = v === "" || v == null;
    if (d.req) need(id, d.req, !blank);
    if (blank) continue;
    // Through `need`, not `e` alone: `missing` is what the footer counts, so a
    // field left out of it paints red and lets Issue through anyway.
    if (d.noFuture && iso(v) > latestDate()) need(id, d.label, false, "Can't be in the future");
    if (d.kind !== "num") continue;
    if (d.min != null && !(Number(v) >= d.min)) need(id, d.label, false, `Must be ${d.min} or more`);
    else if (d.dp && (String(v).split(".")[1] || "").length > d.dp) {
      need(id, d.label, false, `At most ${d.dp} decimal places`);
    }
  }
  for (const [id, msg] of docSetErrors()) {
    need(id, "a document set with every required document", false, msg);
    const row = /^row-(\d+)-/.exec(id);
    // An override's error sits inside its panel, which a closed panel would hide.
    if (write && row && S.rows[Number(row[1])]) S.rows[Number(row[1])].open = true;
  }
  if (!S.rows.length) missing.push("a stakeholder");
  const inherited = spec().filter((d) => d.req && d.over && S.shared[d.k] === AS_SAVED);
  S.rows.forEach((r, i) => {
    const p = `row-${i}`;
    // A row added to a resumed set inherits nothing from terms the load could not read.
    if (!r.resumed) {
      for (const d of inherited.filter((x) => !(x.k in r.ov))) {
        need(`${p}-ov-${d.k}`, d.req, false, newRowNeeds());
        if (write) r.open = true;
      }
    }
    if (r.isNew) {
      need(`${p}-new-name`, "a name", !!r.name.trim());
      need(`${p}-new-email`, "an email", /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(r.email.trim()), "Enter a valid email");
    } else if (!r.resumed || r.touched.has("stakeholder")) {
      // A resumed row names its holder in Carta already, until the user unlinks it here.
      need(`${p}-stakeholder`, "a stakeholder", r.stakeholderId != null, "Pick someone from the list");
    }
    if (S.type === "option_grant" && r.resumed && touchedFor(r).has("document_set_id")) {
      need(r.touched.has("document_set_id") ? `${p}-ov-document_set_id` : "shared-document_set_id",
        "a document set Carta already holds", false, SAVED_SET_LOCKED);
      if (write && r.touched.has("document_set_id")) r.open = true;
    }
    const q = String(r.quantity == null ? "" : r.quantity).trim();
    need(`${p}-quantity`, "a quantity", q !== "" && Number(q) > 0,
      q === "" ? "Enter a quantity" : "Must be greater than 0");
    // Asked for only once the row names someone — that is also when the row renders
    // the select to answer it in.
    if (!r.isNew && r.stakeholderId == null) return;
    need(`${p}-relationship`, "a relationship", !!r.relationship);
  });
  if (write) S.errs = e;
  return [...new Set(missing)];
}

/** Each set, shared or a row's own, that Carta would refuse for a missing document. A row
    answers for itself only when it overrode the set, or — on a PIU — the plan. */
const newRowNeeds = () => `Set this for the new row — the saved ${unitNoun()[1]}' value isn't loaded.`;

/** A saved grant's documents are files on the draft, not a set Carta can swap. */
const SAVED_SET_LOCKED = "Changing the document set of a saved grant isn't supported here — "
  + "set it back, or finish this grant in Carta.";

function docSetErrors() {
  if (!TYPE_DOC_SLOTS[S.type] || !S.docSets.length) return [];
  const out = [];
  const shared = docSetProblem(docSetOf(S.shared.document_set_id), sharedPlan());
  if (shared) out.push(["shared-document_set_id", shared]);
  S.rows.forEach((r, i) => {
    const ownSet = "document_set_id" in r.ov;
    const ownPlan = S.type === "piu" && "option_plan" in r.ov;
    if (!ownSet && !ownPlan) return;
    const set = docSetOf(ownSet ? r.ov.document_set_id : S.shared.document_set_id);
    const msg = docSetProblem(set, ownPlan ? r.ov.option_plan : sharedPlan());
    if (msg) out.push([`row-${i}-ov-document_set_id`, msg]);
  });
  return out;
}

/* ---------- payload ----------
   A draft can be half-finished, so every field a user might not have reached yet is
   left out rather than sent as 0, NaN or the string "undefined" — the server names a
   missing field, but reads a coerced one as the user's answer. */
function put(o, k, v) {
  if (v === "" || v == null || v === NONE || v === AS_SAVED) return;
  if (typeof v === "number" && !Number.isFinite(v)) return;
  o[k] = v;
}
const num = (v) => (v === "" || v == null ? "" : Number(v));
const str = (v) => (v === "" || v == null ? "" : String(v));
/** An update patches: a key a payload leaves out keeps what Carta stored. So a term this
    page sent before and the user has since emptied goes out empty — and only such a term:
    a resumed row's stored terms the page never loaded are left exactly as they are. */
const NEVER_CLEAR = new Set(["temp_id", "draft_pk", "delete", "document_set_id", "legend_id",
  "stakeholder_kind", "should_validate_duplicate_stakeholder"]);
/** What an emptied term goes out as, where a plain null is not the answer. An option
    grant's exemption falls back to the model's own default. */
const CLEAR_TO = { exemption: "Rule 701" };
const blankish = (v) => v === null || v === undefined || v === "" || v === false;
/** A PIU's documents come from its set, resolved client-side and dropped when null, so
    leaving a set — or moving to one with fewer documents — clears the slots themselves. */
const PIU_DOC_SLOTS = ["purchase_agreement_doc", "equity_incentive_plan_doc", "attachments_uuid"];
function clearDropped(r, d) {
  const was = S.sent[r.key];
  if (!d.draft_pk) return;
  if (!was) { if (!("stakeholder_id" in d)) d.should_validate_duplicate_stakeholder = true; return; }
  for (const [k, v] of Object.entries(was)) {
    if (k in d || blankish(v) || NEVER_CLEAR.has(k)) continue;
    d[k] = k in CLEAR_TO ? CLEAR_TO[k] : typeof v === "boolean" ? false : null;
  }
  if (S.type === "piu" && !blankish(was.document_set_id)
    && String(was.document_set_id) !== String(d.document_set_id ?? "")) {
    for (const k of PIU_DOC_SLOTS) d[k] = null;
  }
  // A saved row that names nobody on the cap table: without the flag, cw_resources skips
  // the duplicate check it runs on any update that names someone new.
  if (d.stakeholder_id == null) d.should_validate_duplicate_stakeholder = true;
}

/** The document set a row goes out with. */
const docSetOfRow = (r) => ("document_set_id" in r.ov && r.ov.document_set_id !== ""
  ? r.ov.document_set_id : S.shared.document_set_id);
/** Saved option-grant rows whose document set changed since this page sent it. Carta
    cannot clear an option grant's document slots by name, so the old set's documents
    would stay behind a set that lacks them. A row whose set the page never sent — a
    resumed one — is not known to have changed. */
const staleDocRows = () => (S.type !== "option_grant" ? [] : S.rows.filter((r) => {
  const pk = S.drafts[r.key], was = S.sent[r.key];
  if (r.resumed) return false;
  return pk != null && was && "document_set_id" in was
    && String(was.document_set_id) !== String(docSetOfRow(r) || "");
}));
const LOCKED_SET = "Carta kept this row locked, so its document set can't change. Finish this issue in Carta.";
/** Delete those rows before anything else is written, so the save that follows writes
    them afresh. Only a delete Carta confirms lets that happen: a locked row keeps its
    draft and its set, and never gets a second copy beside it. True when the page may go on. */
async function dropStaleDocRows() {
  const stale = staleDocRows();
  if (!stale.length) return true;
  let res;
  try {
    res = payload(await one("cap_table__mutate__save_drafts", {
      corporation_id: S.corpId, security_type: S.type, draft_set_id: S.draftSetId,
      drafts: stale.map((r) => ({ draft_pk: S.drafts[r.key], delete: true })) })) || {};
  } catch (err) { S.busy = false; await sheetError(err, "save"); return false; }
  const gone = new Set(objs(res.drafts).filter((d) => d.status === "deleted").map((d) => String(d.draft_pk)));
  const kept = stale.filter((r) => !gone.has(String(S.drafts[r.key])));
  for (const r of stale) if (!kept.includes(r)) { delete S.drafts[r.key]; delete S.sent[r.key]; }
  // Out of the set until the save that follows writes them again.
  S.rewriting = stale.filter((r) => !kept.includes(r)).map((r) => r.key);
  if (!kept.length) return true;
  S.busy = false;
  S.srv = { rows: {}, fields: {}, batch: [], shared: [], marks: [] };
  for (const r of kept) S.srv.rows[r.key] = { save: [LOCKED_SET] };
  backToFields();
  return false;
}

/** A row as the form holds it, every term included — what the review and the totals read.
    What a save sends is rowPayload(). */
function rowValues(r) {
  const sh = S.shared;
  const g = (k) => (k in r.ov && r.ov[k] !== "" ? r.ov[k] : sh[k]);
  // Whether this row answered a term itself, which is what makes a derived value
  // the row's own rather than the batch's.
  const own = (k) => k in r.ov && r.ov[k] !== "";
  // A shared checkbox is a boolean; a row's override of one is "true" / "false".
  const yes = (k) => g(k) === true || g(k) === "true";
  // `temp_id` is the wire name for r.key: the server echoes it beside draft_pk.
  const d = { temp_id: r.key };
  // A resumed row whose kind the load did not carry keeps the one Carta stored.
  if (!r.kindUnknown) d.stakeholder_kind = r.kind;
  put(d, "name", r.name.trim());
  put(d, "email", r.email.trim());
  put(d, "issue_date_relationship", r.relationship);
  put(d, "quantity", num(r.quantity));
  // A grant awaiting board approval has no issue date yet, and the server
  // rejects the row outright if one is sent. Per row: one batch can mix the two.
  const pending = S.type === "option_grant" && g("board_mode") === "pending";
  const boardKnown = g("board_mode") !== AS_SAVED;
  if (!pending) put(d, "issue_date", g("issue_date"));
  if (r.stakeholderId != null) d.stakeholder_id = Number(r.stakeholderId);
  if (S.drafts[r.key]) d.draft_pk = S.drafts[r.key];
  const vt = g("vesting_template");
  const realVest = vt && vt !== NONE && vt !== AS_SAVED;
  if (realVest) {
    d.vesting_template = Number(vt);
    const t = S.vesting.find((x) => String(x.id) === String(vt));
    // A resumed row's stored start date stands, blank included.
    const start = g("vesting_start_date") || (r.stored ? "" : d.issue_date);
    if (!(t && /milestone/i.test(t.vesting_type || ""))) put(d, "vesting_start_date", us(start));
    put(d, "acceleration_template", num(g("acceleration_template")));
  }
  put(d, "notes", g("notes"));

  if (S.type === "option_grant") {
    const so = g("so_type");
    put(d, "so_type", so);
    put(d, "exercise_price", so === "ZEPO" ? "0" : str(g("exercise_price")));
    // A row on its own grant type takes that type's currency, not the batch's;
    // a currency the row states outright outranks both.
    const retarget = !own("currency") && own("so_type") ? (SO_FILL[so] || [])[0] : "";
    put(d, "currency", retarget || g("currency"));
    if (boardKnown) d.needs_board_approval = pending;
    if (!pending) put(d, "board_approval_date", g("board_approval_date"));
    // The term runs from the issue date, so a row that moved its own needs its own.
    // Derived only when the row itself moved its issue date: a resumed row's own date was
    // read back with the expiry Carta stored beside it.
    const expiry = !own("grant_expiration_date") && own("issue_date") && (!r.resumed || r.touched.has("issue_date"))
      ? grantExpiry(g("issue_date")) : g("grant_expiration_date");
    put(d, "grant_expiration_date", us(expiry));
    put(d, "document_set_id", num(g("document_set_id")));
    const ex = (SO_FILL[so] || [])[1];
    if (ex) d.exemption = ex;
    if (so === "ZEPO") d.early_exercise = false;
    else if (yes("early_exercise")) d.early_exercise = true;
    if (so === "Unapproved") d.employment_related = yes("employment_related");
    // Explicit, so unticking one and re-saving the same draft_pk clears it.
    // `hmrc_notified` is a DateTimeField: ISO as-is, not the us() family.
    if (HMRC_SO_TYPES.has(so)) {
      d.is_hmrc_notified = yes("is_hmrc_notified");
      put(d, "hmrc_notified", g("hmrc_notified"));
    }
    if (ATO_SO_TYPES.has(so)) d.ato_notified = yes("ato_notified");
  } else if (S.type === "certificate") {
    put(d, "prefix", g("prefix"));
    put(d, "law_firm_price", str(g("law_firm_price")));
    put(d, "currency", g("currency"));
    put(d, "board_approval_date", g("board_approval_date"));
    put(d, "legend_id", num(g("legend_id")));
    if (!r.resumed) d.exemption = "Section 4(a)(2)";
    const other = g("rule_144_mode") === "other";
    const r144 = other ? g("rule_144_date") : d.issue_date;
    if (g("rule_144_mode") !== AS_SAVED) put(d, "rule_144_date", us(r144));
    if (other && iso(r144) !== iso(d.issue_date)) {
      put(d, "rule_144_difference_reason", g("rule_144_reason"));
    }
    const cc = S.classes.find((c) => c.prefix === d.prefix);
    if (cc && cc.dividend === "Non-cash") put(d, "dividend_accrual_start_date", g("dividend_accrual_start_date"));
  } else {
    put(d, "prefix", g("prefix"));
    put(d, "threshold_value", str(g("threshold_value")));
    put(d, "threshold_value_type", g("threshold_value_type"));
    put(d, "currency", g("currency"));
    if (!r.resumed) d.exemption = "Section 4(a)(2)";
    put(d, "option_plan", str(g("option_plan")));
    put(d, "board_approval_date", g("board_approval_date"));
    put(d, "document_set_id", num(g("document_set_id")));
    const cc = g("corresponding_interest") === AS_SAVED ? null
      : S.classes.find((c) => c.prefix === d.prefix);
    if (cc && cc.has_corresponding_interest) d.corresponding_interest = yes("corresponding_interest");
    // The read is not the authority when it cannot see the link — the server is. An
    // explicit tick goes out as true and DraftCorrespondingInterestValidator rules on it.
    else if (cc && !("has_corresponding_interest" in cc) && yes("corresponding_interest")) {
      d.corresponding_interest = true;
    }
  }
  return d;
}

/** What a save sends for one row. A row this page created goes out whole, with an empty
    for each term it sent before and the user has since emptied. A resumed row — Carta's
    own draft — goes out as its draft_pk and only the keys the user changed here: every
    derived value the form computes for itself would otherwise overwrite what Carta holds. */
function rowPayload(r) {
  const d = rowValues(r);
  if (r.resumed && d.draft_pk) return resumedPayload(r, d);
  clearDropped(r, d);
  return d;
}

/** The payload keys each form input drives. An input not listed drives its own key. */
const DRIVES = {
  stakeholder: ["stakeholder_id", "name", "email", "stakeholder_kind", "issue_date_relationship"],
  name: ["name"], email: ["email"], kind: ["stakeholder_kind"],
  relationship: ["issue_date_relationship"], quantity: ["quantity"],
  issue_date: ["issue_date", "grant_expiration_date", "rule_144_date"],
  board_mode: ["needs_board_approval", "issue_date", "board_approval_date"],
  so_type: ["so_type", "currency", "exemption", "exercise_price", "early_exercise",
    "employment_related", "is_hmrc_notified", "hmrc_notified", "ato_notified"],
  option_plan_id: [],
  vesting_template: ["vesting_template", "vesting_start_date", "acceleration_template"],
  document_set_id: ["document_set_id", ...PIU_DOC_SLOTS],
  rule_144_mode: ["rule_144_date", "rule_144_difference_reason"],
  rule_144_date: ["rule_144_date", "rule_144_difference_reason"],
  rule_144_reason: ["rule_144_difference_reason"],
  legend_id: ["legend_id"],
  prefix: ["prefix", "dividend_accrual_start_date", "corresponding_interest"],
};
/** Keys that clear to false, not null, when the input that drives them leaves them out. */
const BOOL_KEYS = new Set(["early_exercise", "is_hmrc_notified", "ato_notified",
  "corresponding_interest", "needs_board_approval"]);
/** The inputs the user changed that reach this row: its own, and each shared term it
    does not override. */
function touchedFor(r) {
  const out = new Set(r.touched || []);
  for (const k of S.touchedShared) if (!(k in r.ov)) out.add(k);
  return out;
}
/** A saved row known to name nobody on the cap table: Carta's duplicate check has to run
    on it, and the flag is what asks for it once stakeholder_id goes unsent. */
const knownUnlinked = (r) => r.stakeholderId == null && (r.isNew || !r.resumed
  || (r.touched && r.touched.has("stakeholder")) || (r.stored && r.stored.stakeholder_id == null));

/** Keys only one security type carries. */
const TYPE_ONLY = { grant_expiration_date: "option_grant", so_type: "option_grant",
  exercise_price: "option_grant", early_exercise: "option_grant", employment_related: "option_grant",
  is_hmrc_notified: "option_grant", hmrc_notified: "option_grant", ato_notified: "option_grant",
  needs_board_approval: "option_grant", exemption: "option_grant",
  rule_144_date: "certificate", rule_144_difference_reason: "certificate",
  dividend_accrual_start_date: "certificate", corresponding_interest: "piu",
  purchase_agreement_doc: "piu", equity_incentive_plan_doc: "piu", attachments_uuid: "piu" };
/** Inputs whose knock-on keys go out when the form derives them, and are never emptied
    on their account: an issue date moves an expiry or a Rule 144 date only where the form
    carries one. */
const NO_KNOCK_ON_CLEAR = new Set(["issue_date", "prefix"]);

function resumedPayload(r, d) {
  const out = { temp_id: d.temp_id, draft_pk: d.draft_pk };
  for (const k of touchedFor(r)) {
    // A saved grant's documents cannot change here; validate() says so on the field.
    if (S.type === "option_grant" && k === "document_set_id") continue;
    for (const pk of DRIVES[k] || [k]) {
      if (TYPE_ONLY[pk] && TYPE_ONLY[pk] !== S.type) continue;
      if (pk in d) out[pk] = d[pk];
      else if (NEVER_CLEAR.has(pk) || (pk !== k && NO_KNOCK_ON_CLEAR.has(k))) continue;
      // Nothing to empty where Carta already holds it empty.
      else if (r.stored && pk in r.stored && blankish(r.stored[pk])) continue;
      else out[pk] = pk in CLEAR_TO ? CLEAR_TO[pk] : BOOL_KEYS.has(pk) ? false : null;
    }
  }
  if (out.stakeholder_id == null && knownUnlinked(r)) out.should_validate_duplicate_stakeholder = true;
  return out;
}

/** Every row on the form, plus a delete for each saved row the user removed since: the
    set is what gets issued, so a row gone from the form has to go from the set too. */
function saveArgs(rows, part) {
  const drafts = (rows || S.rows).map((r) => rowPayload(r));
  S.lastPayload = {};
  for (const d of drafts) {
    S.lastPayload[d.temp_id] = d;
    // A save that may have landed and then threw still counts: its keys are what a
    // later clear has to answer to.
    const was = S.sent[d.temp_id] || {};
    for (const [k, v] of Object.entries(d)) if (!blankish(v)) was[k] = v;
    S.sent[d.temp_id] = was;
  }
  // The deletes go with the first of two calls, never the second.
  const deletes = part === "new" ? [] : S.removed.map((pk) => ({ draft_pk: pk, delete: true }));
  const a = { corporation_id: S.corpId, security_type: S.type, drafts: drafts.concat(deletes) };
  if (S.draftSetId) a.draft_set_id = S.draftSetId;
  else a.draft_set_name = `${shortLabel()} ${iso(S.shared.issue_date) || today()}`.slice(0, 30);
  // cw_resources fills every row's exercise periods from the plan named here, so a row
  // added after the first save needs it too. Never over a resumed row: its periods may be
  // its own, and the plan's would replace them.
  const own = part === "new" || (part !== "saved" && !(rows || S.rows).some((r) => r.resumed));
  if (S.type === "option_grant" && S.shared.option_plan_id && S.shared.option_plan_id !== AS_SAVED && own) {
    a.equity_plan_id = Number(S.shared.option_plan_id);
  }
  return a;
}

/* ---------- the issue sheet ---------- */
const SAVE_STEPS = ["Saving and validating the draft set"];
/** A draft is saved and nothing else: validating is what Review and issue does. */
const DRAFT_STEPS = ["Saving the draft set"];

const WAITING = new Set(["saving", "issuing"]);

function openSheet(phase, extra) {
  // Where focus goes back to when the reader dismisses the sheet.
  if (!S.sheet) S.opener = document.activeElement || null;
  S.sheet = Object.assign({ phase, step: 0 }, extra || {});
  renderSheet();
  focusSheet();
}
function closeSheet() {
  S.sheet = null;
  renderSheet();
}

/** The confirm button when there is a decision to make, the dismiss button when the
    sheet only reports, and the title while a wait has nothing to press. */
function focusSheet() {
  const m = S.sheet;
  if (!m) return;
  const go = el("modal-go"), close = el("modal-close"), title = el("modal-title");
  const n = m.phase === "confirm" ? go : WAITING.has(m.phase) ? title : close;
  if (n && n.focus) n.focus();
}

/** The sheet's own controls that can take focus, for Tab to cycle through. */
function sheetStops() {
  return ["modal-close", "modal-go"].map(el).filter((n) => n && !n.hidden && !n.disabled);
}

/** One line per step, so a wait names what it is waiting on rather than spinning. */
const stepsHtml = (labels, at) => labels.map((l, i) => {
  const now = i === at;
  const mark = i < at ? "✓" : now ? '<span class="spin"></span>' : "·";
  const cls = i < at ? "done" : now ? "now" : "";
  return `<div class="step ${cls}"><span class="mark">${mark}</span>${esc(l)}</div>`;
}).join("");

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
/** What one row is: a certificate, an option grant, a PIU grant. */
const unitNoun = () => ({ option_grant: ["option grant", "option grants"],
  certificate: ["certificate", "certificates"],
  piu: ["PIU grant", "PIU grants"] }[S.type] || ["security", "securities"]);
/** Counts securities, not quantity: one row is one grant, certificate or award, and
    the quantity inside it is shares or units. The totals line carries that. */
function issueVerb() {
  const [sing, many] = unitNoun();
  return `Issue ${plural(S.rows.length, sing, many)}`;
}

/** 130,000 options · 305,500.00 USD total exercise cost. */
function totalLine(t, cur) {
  const [one, many] = qtyNoun();
  const q = plural(t.qty, one, many);
  return t.priced && VALUE_OF[S.type] ? `${q} · ${money(t.value, cur)} ${VALUE_OF[S.type]}` : q;
}

function sheetSummary() {
  const who = S.rows.length === 1
    ? esc((S.rows[0].name || "").trim() || "1 stakeholder")
    : `${S.rows.length} stakeholders`;
  const groups = [...totals().entries()];
  const rows = groups.map(([cur, t]) =>
    `<div class="tot"><span>${esc(groups.length > 1 && cur ? `Total — ${cur}` : "Total")}</span><span>${
      esc(totalLine(t, cur))}</span></div>`).join("");
  const on = iso(S.shared.issue_date) ? `, dated ${esc(longDate(S.shared.issue_date))}` : "";
  return `<p>For <b>${who}</b> on <b>${esc(S.corpName)}</b>${on}.</p>${rows}`;
}

function renderSheet() {
  const box = el("modal");
  if (!box) return;
  const m = S.sheet;
  box.hidden = !m;
  // The page behind a sheet takes no clicks and no focus, so Tab stays in the sheet.
  const page = document.querySelector(".container");
  if (page) page.inert = !!m;
  if (!m) return;
  const title = el("modal-title"), body = el("modal-body");
  const go = el("modal-go"), close = el("modal-close");
  go.hidden = true; close.hidden = true; go.disabled = false;
  if (m.phase === "saving") {
    title.textContent = m.mode === "draft" ? "Saving your draft" : "Checking these terms";
    body.innerHTML = stepsHtml(m.steps || SAVE_STEPS, m.step);
  } else if (m.phase === "confirm") {
    const warned = (m.warnings || []).length;
    title.textContent = warned ? "Carta flagged something first" : "Ready to issue";
    body.innerHTML = (warned
      ? `<div class="warn-note"><ul>${m.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
      : "")
      + sheetSummary()
      + `<p>${esc(SHEET_COMMIT[S.type] || "")}</p>`;
    go.hidden = false;
    go.textContent = warned ? `${issueVerb()} anyway` : issueVerb();
    close.hidden = false; close.textContent = "Back";
  } else if (m.phase === "issuing") {
    title.textContent = "Issuing on Carta";
    body.innerHTML = stepsHtml(["Writing these securities to the cap table"], 0)
      + '<p data-testid="modal-keep-open">Keep this page open until it finishes.</p>';
  } else if (m.phase === "saved") {
    title.textContent = "Draft saved";
    const lost = arr(m.unsaved);
    const set = draftSetPhrase();
    body.innerHTML = `<p>Draft saved${set ? ` (${esc(set)})` : ""} — ${
      esc(plural(m.count == null ? S.rows.length : m.count, ...unitNoun()))}. Nothing has been issued `
      + "yet; Review and issue checks it with Carta first.</p>"
      + (lost.length ? `<p class="fail-note" data-testid="draft-rows-unsaved">Carta did not save ${
        esc(lost.join(", "))}.</p>` : "")
      + (arr(m.kept).length ? `<p class="fail-note" data-testid="draft-rows-kept">Carta kept ${
        esc(m.kept.join(", "))} unchanged — locked in Carta, so the saved values stand. Finish `
        + "this issue in Carta.</p>" : "")
      + (m.gone ? `<p class="fail-note" data-testid="draft-rows-gone">${esc(m.gone)}</p>` : "")
      + (m.stale ? `<p class="fail-note" data-testid="draft-rows-not-removed">${esc(m.stale)}</p>` : "")
      + toldHtml(m, "<p>Claude can pick it up from here, or you can come back to this page.</p>");
    close.hidden = false; close.textContent = "Done";
  } else {
    title.textContent = m.title || "That did not go through";
    body.innerHTML = (m.dup
      ? `<p class="fail-note">Carta found ${esc(plural(Number(m.dup.count) || 1, "stakeholder", "stakeholders"))
        } here who may already be on the cap table, so nothing was issued.</p>`
        + "<p>Ask Claude to sort the duplicates out — it can merge them or create the new records, then issue.</p>"
      : `<p class="fail-note">${esc(m.message || "")}</p>`) + toldHtml(m, "");
    close.hidden = false; close.textContent = "Close";
  }
}

/** The draft set as the reader gives it to Claude. It is the recovery path whenever the
    page could not hand over by itself, so it is a number on screen and nothing else. */
const draftSetPhrase = () => (S.draftSetId == null || S.draftSetId === ""
  ? "" : `draft set ${S.draftSetId}`);

/** Whether Claude was told. A hand-off that did not land leaves this page as the only
    record of what happened here, so it has to be legible on its own. */
function toldHtml(m, ok) {
  if (m.told !== false) return ok;
  const set = draftSetPhrase();
  const where = set
    ? `This is ${esc(set)} on ${esc(S.corpName)} — give Claude that number to pick it up.`
    : "Ask Claude to check this issuance in Carta.";
  const again = S.issued > 0 ? " Do not issue again from here." : "";
  return `<p class="fail-note" data-testid="handoff-not-recorded">We could not tell Claude `
    + `automatically. ${where}${again}</p>`;
}

/* ---------- submit ---------- */
/** True when the form cannot go forward, having said so on the fields and in the
    banner. Both buttons stay live, so a click is the only place left to say it. */
function incomplete() {
  const missing = validate(true);
  if (!missing.length) return false;
  S.banner = `Fix ${missing.length} field${missing.length > 1 ? "s" : ""} before issuing.`;
  S.bannerBad = true; render();
  const first = document.querySelector(".bad input, .bad select");
  if (first) first.focus();
  return true;
}

/** A combined call that failed after reaching Carta, over rows with no draft_pk yet: the
    save may have written them, and a retry would write them again. */
const blindSave = (err) => mayHaveWritten(err) && S.rows.some((r) => !S.drafts[r.key]);
/** The combined call saves before it checks, so any failure after it reached Carta may sit
    over a save that landed — a refused check reads the same as a refused save from here. */
const blindCombined = (err) => !!err && !err.noWrites && err.code !== "cancelled"
  && err.code !== "rate_limited" && !!(err.fromServer || err.unknownOutcome)
  && S.rows.some((r) => !S.drafts[r.key]);
/** No answer, a 5xx or a timeout: the write may have landed before the failure. A refusal
    in words — a 4xx, a missing field — was turned down before anything was written. */
function mayHaveWritten(err) {
  if (!err) return false;
  if (err.unknownOutcome) return true;
  const m = String(err.message || "");
  return !!err.fromServer && (/\bcarta-web 5\d\d\b/.test(m) || /tim(?:ed|e)[ -]?out/i.test(m));
}

/** Record what the save returned, whichever call made it. A save Carta refused wrote
    nothing, deletes included, so those stay queued for the next one. */
function absorbSaved(res) {
  S.draftSetId = res.draft_set_id ?? res.draftSetId ?? S.draftSetId;
  const changes = objs(res.drafts || res.rows);
  for (const d of changes) {
    if (d.temp_id && d.draft_pk) S.drafts[d.temp_id] = d.draft_pk;
    if (d.temp_id && d.status === "created") S.rewriting = S.rewriting.filter((k) => k !== d.temp_id);
    // What Carta now holds for the row, and so what a later save may need to empty.
    if (d.temp_id && (d.status === "created" || d.status === "updated") && d.temp_id in S.lastPayload) {
      S.sent[d.temp_id] = Object.assign({}, S.sent[d.temp_id], S.lastPayload[d.temp_id]);
    }
  }
  // A delete is done only when Carta says so for that row. A refused one comes back as
  // its own row status inside a save that otherwise succeeded. `skipped` is a locked row,
  // still issuable, so it keeps blocking; `errored` is one already issued or gone, which
  // no later issue can pick up again, so it is said once and let go.
  const status = new Map(changes.filter((d) => !d.temp_id && d.draft_pk != null)
    .map((d) => [String(d.draft_pk), d.status]));
  const errored = S.removed.filter((pk) => status.get(String(pk)) === "errored");
  S.removedGone += errored.length;
  S.removed = S.removed.filter((pk) => !["deleted", "errored"].includes(status.get(String(pk))));
}
/** Removed rows Carta could not delete because they are already issued or no longer
    exist. Nothing to block on, but the reader removed them and should know. */
const goneLine = () => (S.removedGone
  ? `Carta could not remove ${plural(S.removedGone, "row", "rows")} you took off this form — `
    + `already issued or no longer in the set, so ${S.removedGone === 1 ? "it" : "they"} will not be issued again.`
  : "");

/** What each row the save answered but did not write says to the reader. `skipped` is a
    draft Carta has locked — under a board approval, say — whose stored values stand. */
const KEPT = { skipped: "Carta kept this row unchanged — it's locked in Carta. Finish this issue in Carta." };
const NOT_SAVED = "Carta did not save this row.";
/** The rows a save answered with anything but a write, each with its status. A row the
    answer does not mention says nothing either way. */
function refusedRows(res, rows) {
  const changes = objs(res && (res.drafts || res.rows));
  const out = [];
  for (const r of rows || S.rows) {
    const pk = S.drafts[r.key];
    const c = changes.find((d) => (d.temp_id && d.temp_id === r.key)
      || (pk != null && d.draft_pk != null && String(d.draft_pk) === String(pk) && !d.temp_id));
    if (c && c.status && c.status !== "created" && c.status !== "updated") {
      out.push({ row: r, status: c.status });
    }
  }
  return out;
}
const refusalLine = (status) => KEPT[status] || NOT_SAVED;
const rowName = (r) => (r.name || "").trim() || "a row with no name";
/** Removed rows Carta still holds, which confirming would issue with the rest. */
const removedLine = () => (S.removed.length
  ? `Carta did not remove ${plural(S.removed.length, "row", "rows")} you took off this form, so `
    + `issuing now would issue ${S.removed.length === 1 ? "it" : "them"} too. Try again, or ask `
    + `Claude to check ${draftSetPhrase() || "this draft set"}.`
  : "");

/** Save and check in one round trip. `prepare_drafts` calls the save and the validate
    directly and never reaches the issuing code, so nothing on its path can issue. */
async function prepareDrafts(rows, part) {
  const res = payload(await one("cap_table__mutate__prepare_drafts", saveArgs(rows, part))) || {};
  absorbSaved(res);
  return res;
}

/** Write the rows to a draft set and record what came back. */
async function saveDrafts(rows, part) {
  const res = payload(await one("cap_table__mutate__save_drafts", saveArgs(rows, part))) || {};
  absorbSaved(res);
  const m = S.sheet;
  if (m && m.step < arr(m.steps || SAVE_STEPS).length - 1) { m.step += 1; renderSheet(); }
  return res;
}

/** Carta's verdict on the saved rows — validation errors and duplicates.
 *
 * `issue_securities` can do this in one call with `validate_only`, and deliberately is
 * not used for it: that would put a second call to the issuing command in this page,
 * one boolean away from issuing rows nobody had confirmed. A round trip is cheaper
 * than that risk, and it happens behind the sheet's own progress.
 */
async function checkDrafts() {
  return payload(await one("cap_table__mutate__validate_drafts", {
    corporation_id: S.corpId, security_type: S.type, draft_set_id: S.draftSetId,
  })) || {};
}

/** A row the user never touched. Carta's Drafts UI keeps no such row, so a draft does
    not send one either; a row a save already wrote is always sent, so it updates. */
const untouched = (r) => !S.drafts[r.key] && r.stakeholderId == null
  && ![r.name, r.email, r.quantity].some((v) => String(v == null ? "" : v).trim());

/** What a draft save cannot do without, and nothing more: a draft may be half-finished.
    Carta files every option-grant draft set under its plan, and refuses to create one
    without it in words written for a developer. */
function draftBlocked(rows) {
  if (!rows.length && !S.removed.length) {
    return { msg: "Add a stakeholder or a quantity before saving a draft." };
  }
  if (S.type === "option_grant" && !S.draftSetId && !S.shared.option_plan_id) {
    return { id: "shared-option_plan_id", err: "Needed to save a draft",
      msg: "Choose an option plan to save this draft — Carta files every option-grant draft under its plan." };
  }
  return null;
}

/** An option-grant save over resumed rows that also adds new ones, as two calls. The plan
    named on a save stamps its exercise periods onto every row of that call, which a
    resumed row may hold its own of — so the saved rows go first with no plan, and the new
    ones after, with it. Null when one call will do. */
function planSplit(rows) {
  if (S.type !== "option_grant" || !S.shared.option_plan_id || S.shared.option_plan_id === AS_SAVED) return null;
  const fresh = rows.filter((r) => !S.drafts[r.key]);
  const saved = rows.filter((r) => S.drafts[r.key]);
  return fresh.length && saved.some((r) => r.resumed) ? { saved, fresh } : null;
}
/** The first of the two calls: the saved rows and any deletes. The page's answer when it
    fails, or null when the second call may go ahead. */
async function saveFirst(split) {
  let res;
  try { res = payload(await one("cap_table__mutate__save_drafts", saveArgs(split.saved, "saved"))) || {}; }
  catch (err) { S.busy = false; await sheetError(err, "save", { blind: blindSave(err) }); return { stop: true }; }
  absorbSaved(res);
  if (res.success === false) { S.busy = false; notSaved(); return { stop: true }; }
  return { drafts: objs(res.drafts) };
}

/** Save as draft: the rows go to Carta as they stand, and nothing checks them. Only
    Review and issue validates, so a draft can be saved at any point of filling it in. */
async function saveDraft() {
  const rows = S.rows.filter((r) => !untouched(r));
  const stop = draftBlocked(rows);
  if (stop) {
    S.errs = stop.id ? { [stop.id]: stop.err } : {};
    S.banner = stop.msg; S.bannerBad = true; render();
    const first = stop.id && document.querySelector(".bad input, .bad select");
    if (first) first.focus();
    return;
  }
  S.banner = ""; S.bannerBad = false; S.srv = {}; S.errs = {};
  S.busy = true;
  openSheet("saving", { mode: "draft", step: 0, steps: DRAFT_STEPS });
  render();
  if (!(await dropStaleDocRows())) return;
  const split = planSplit(rows);
  const first = split ? await saveFirst(split) : { drafts: [] };
  if (first.stop) return;
  let res;
  try {
    res = payload(await one("cap_table__mutate__save_drafts",
      split ? saveArgs(split.fresh, "new") : saveArgs(rows))) || {};
  } catch (err) { S.busy = false; await sheetError(err, "save", { blind: blindSave(err) }); return; }
  S.busy = false;
  absorbSaved(res);
  res = Object.assign({}, res, { drafts: first.drafts.concat(objs(res.drafts)) });
  // Carta answers a set it will not write — gone, or already issued — with a refusal
  // that names neither, and saves nothing.
  if (res.success === false) {
    openSheet("failed", { message: "Carta did not save this draft. Nothing is issued — "
      + `ask Claude to check ${draftSetPhrase() || "this draft set"} before trying again.` });
    render();
    return;
  }
  const refused = refusedRows(res, rows);
  const unsaved = refused.filter((x) => !KEPT[x.status]).map((x) => rowName(x.row));
  const kept = refused.filter((x) => KEPT[x.status]).map((x) => rowName(x.row));
  const count = rows.length - refused.length;
  const set = draftSetPhrase();
  S.savedNote = set ? `Draft saved — ${set}.` : "Draft saved.";
  const gone = goneLine();
  S.removedGone = 0;
  openSheet("saved", { count, unsaved, kept, stale: removedLine(), gone }); render();
  noteHandoff(S.sheet, await handoff("draft", { recipients: count }));
}

/** Save, then check, then confirm, then issue — all inside the sheet, so the click
    that commits is the one taken against terms Carta has just accepted. */
async function submit(mode) {
  // Ours to guard, not the footer's attributes: a second save in flight mints a second
  // draft set, and an issued or unestablished set must take no further write.
  if (S.busy || S.sheet || S.issued || S.stuck) return;
  if (mode === "draft") { await saveDraft(); return; }
  if (incomplete()) return;
  S.banner = ""; S.bannerBad = false; S.srv = {};
  S.busy = true;
  openSheet("saving", { mode, step: 0, steps: SAVE_STEPS });
  render();
  if (!(await dropStaleDocRows())) return;
  const split = planSplit(S.rows);
  const first = split ? await saveFirst(split) : { drafts: [] };
  if (first.stop) return;
  // The call that checks is the last one, so Carta validates the whole set once.
  const rows = split ? split.fresh : S.rows, part = split ? "new" : undefined;
  let checked;
  try { checked = await prepareDrafts(rows, part); }
  catch (err) {
    // A refusal is not an absent command, and the fallback would only earn the same
    // refusal a round trip later. isMissingCommand is narrow on purpose.
    if (!isMissingCommand(err)) {
      // One call did both, so which half landed is exactly what cannot be established.
      // That is the save branch's own case, and its copy already states it.
      S.busy = false; await sheetError(err, "save", { blind: blindCombined(err) }); return;
    }
    // Two calls, two tags. A check that fails over a save that worked leaves a clean
    // saved draft set, and sealing the page over it is how that set gets lost.
    let saved;
    try { saved = await saveDrafts(rows, part); }
    catch (e) { S.busy = false; await sheetError(e, "save", { blind: blindSave(e) }); return; }
    if (saved.success === false) { S.busy = false; notSaved(); return; }
    try { checked = Object.assign({}, await checkDrafts(), { drafts: saved.drafts }); }
    catch (e) { S.busy = false; await sheetError(e, "check"); return; }
  }
  S.busy = false;
  checked = Object.assign({}, checked, { drafts: first.drafts.concat(objs(checked.drafts)) });
  // A set Carta will not write — gone, or already issued — saved nothing to check.
  if (checked.success === false) { notSaved(); return; }
  // The save landed and the check behind it did not finish: the fallback's own case.
  if (checked.check_error) { await sheetError(new Error(String(checked.check_error)), "check"); return; }
  const bad = absorb(checked);
  // A row Carta would not save is not in the set, so confirming would issue fewer than
  // the sheet names. It goes back to the row, whatever the check said.
  const lost = refusedRows(checked);
  for (const { row, status } of lost) {
    (S.srv.rows[row.key] = S.srv.rows[row.key] || {}).save = [refusalLine(status)];
  }
  // A row taken off the form but still in the set would be issued with the rest.
  const stale = removedLine();
  if (stale) S.srv.batch = S.srv.batch.filter((l) => l !== UNNAMED_REFUSAL).concat(stale);
  if (bad || lost.length || stale) { backToFields(); return; }
  // The check reports duplicates too, so they surface before the confirmation rather
  // than as a failed issue after it.
  const dup = checked.duplicates && checked.duplicates.has_duplicates
    ? checked.duplicates : null;
  if (dup) {
    openSheet("failed", { dup }); render();
    noteHandoff(S.sheet, await handoff("needs_claude",
      { reason: "duplicates", duplicates: dup.count || null }));
    return;
  }
  const gone = goneLine();
  S.removedGone = 0;
  openSheet("confirm", { warnings: warnLines(checked).concat(gone ? [gone] : []) }); render();
}

/** A save Carta answered with `success: false`: a set that is gone or already issued. */
function notSaved() {
  openSheet("failed", { message: "Carta did not save these rows. Nothing is issued — ask Claude "
    + `to check ${draftSetPhrase() || "this issuance"} before trying again.` });
  render();
}

/** The irreversible write. The human confirmed it in the sheet against a checked
    draft set, which is this flow's one gate — so nothing here re-asks, and a call
    whose outcome is unknown is never retried.

    The phase is the one-shot guard, and it has to be: `renderSheet` re-enables its own
    buttons on every draw, and that draw happens synchronously inside this function, so
    a disabled attribute is already false again by the second click of a double-click.
    Leaving the confirm phase is what closes the door, and it happens before any await. */
async function issueNow() {
  if (!S.sheet || S.sheet.phase !== "confirm") return;
  S.busy = true; S.srv = {};
  openSheet("issuing"); render();
  let r;
  try {
    // "true", not true: the gateway drops a JSON boolean on a top-level argument.
    // is_retry reads the set's rows first and returns what an earlier attempt already
    // issued rather than issuing it again — a second page or a resumed set is exactly
    // that earlier attempt, and one read is all it costs.
    r = payload(await one("cap_table__mutate__issue_securities", {
      corporation_id: S.corpId, security_type: S.type, draft_set_id: S.draftSetId,
      is_retry: "true",
    })) || {};
  } catch (err) {
    S.busy = false;
    await sheetError(err, "issue");
    return;
  }
  S.busy = false;
  const issued = Array.isArray(r.issued) ? r.issued : [];
  if (issued.length) {
    // The result goes on screen before the hand-off is recorded, not after: a sheet
    // still reading "Issuing on Carta" offers no way out, and the write has landed.
    // No sheet to dismiss: the page itself now lists what was written, and says there
    // whether Claude was told.
    S.issued = issued.length;
    S.issuedRows = issued;
    S.stage = "issued";
    closeSheet(); render();
    const h1 = el("title");
    if (h1 && h1.focus) h1.focus();
    noteHandoff(null, await handoff("issued", { issued: issued.length }));
    render();
    return;
  }
  // Some rows have securities and some do not; re-issuing would duplicate the first.
  // Matched on Carta's words until the response carries a flag for it.
  const partly = setLines(r.validation).find((l) => /partly issued/i.test(l));
  if (partly) {
    await seal("Some of these securities were issued", `${sentence(partly)} Do not issue `
      + "again from here — ask Claude to check it in Carta.", "partly_issued");
    return;
  }
  if (absorb(r)) { backToFields(); return; }
  const dup = r.duplicates && r.duplicates.has_duplicates ? r.duplicates : null;
  if (dup) {
    // Retryable on purpose: the server refuses a duplicate rather than half-issuing, so
    // nothing landed, and the batch can go again once the duplicates are sorted out.
    openSheet("failed", { dup }); render();
    noteHandoff(S.sheet, await handoff("needs_claude",
      { reason: "duplicates", duplicates: dup.count || null }));
    return;
  }
  // A grant awaiting its board comes back issued: [] with where to send the consent.
  const url = typeof r.redirect_url === "string" ? r.redirect_url : "";
  if (/\/board(?:room)?\//.test(url)) {
    await seal("Waiting on board approval", "Nothing is issued yet: these grants need their "
      + `board's approval first. Ask Claude to send the board consent for ${draftSetPhrase()
        || "this draft set"} — the grants are issued once every board member signs.`,
      "nothing_issued", { board_approval: true, redirect_url: url });
    return;
  }
  // After an issue call nothing goes back to a confirm: a second press is a second issue.
  // Accepted and nothing reported is the same unestablished outcome as a timeout.
  const warns = warnLines(r);
  await seal("Outcome unknown", "Carta accepted the request and reported nothing issued"
    + `${warns.length ? ` (${warns.join(" ")})` : ""} — ask Claude to check `
    + `${draftSetPhrase() || "this issuance"} in Carta. Do not issue again from here.`, "nothing_issued");
}

/** End the page on an issue whose result is not a clean list: nothing more is written from
    here, and Claude is told why. */
async function seal(title, message, reason, extra) {
  S.stuck = message;
  S.stuckTitle = title;
  openSheet("failed", { title, message }); render();
  noteHandoff(S.sheet, await handoff("needs_claude", Object.assign({ reason }, extra || {})));
}

/** Carta refused a value. Those messages belong to the fields that own them, so the
    sheet closes and the form takes over, scrolled to the first of them. */
function backToFields() {
  closeSheet();
  S.stage = "edit";
  render();
  // Set-level first, since it is the list at the top; otherwise the first field refused.
  const first = el("notice-server-errors")
    || document.querySelector('[aria-invalid="true"], [data-testid$="-server-errors"]');
  if (!first) return;
  if (first.scrollIntoView) first.scrollIntoView({ block: "center", behavior: "smooth" });
  if (first.focus) first.focus();
}

/** Batch-level warnings, whatever shape they arrive in. */
/** Batch-level warnings, whatever shape they arrive in — the real one is keyed like the
    errors, `{draft_pk: {field: [messages]}}`, and a row's line leads with its name. */
function warnLines(r) {
  const w = (r.validation && r.validation.warnings) || r.warnings || {};
  if (Array.isArray(w)) return msgs(w).map(sentence);
  const byPk = {}; for (const [k, pk] of Object.entries(S.drafts)) byPk[String(pk)] = k;
  const out = [];
  for (const [k, v] of Object.entries(w)) {
    const lines = v && typeof v === "object" && !Array.isArray(v)
      ? Object.values(v).flatMap(msgs) : msgs(v);
    const row = S.rows.find((x) => x.key === byPk[String(k)]);
    const who = row ? (row.name || "").trim() : "";
    for (const l of lines) out.push(who ? `${who} — ${sentence(l)}` : sentence(l));
  }
  return [...new Set(out)];
}

/** `blind`: the call may have written rows that had no draft_pk, so a retry would
    insert them a second time — an older prepare_drafts raises after its save landed. */
async function sheetError(err, when, opts) {
  console.error("issuance artifact: Carta call failed", err);
  // The viewer said no to the host's own prompt, so the call never left the page.
  if (err && err.code === "cancelled") {
    openSheet("failed", { title: "Nothing was sent", message: connReason("cancelled") });
    render();
    return;
  }
  // No write can reach Carta from here any more, so the page says so everywhere, not
  // only on this sheet.
  if (err && (err.noWrites || err.needsConnector)) {
    degrade(err.code);
    openSheet("failed", { message: connReason(err.code) });
    render();
    return;
  }
  const raw = !!(err && err.fromServer && rawException(err.message));
  const set = draftSetPhrase() || "this issuance";
  // The check writes nothing, so its failure can never be an unknown outcome — the rows
  // are saved either way, and sealing the page here would throw that set away. An issue
  // that broke on Carta's side may have issued some of the set before it did.
  // An issue that failed in any way but those two may have issued some or all of the set
  // first — a timeout, a 502 and a failed workflow all read the same from here.
  const unknown = when === "issue"
    || (when !== "check" && (!!(err && err.unknownOutcome) || !!(opts && opts.blind)));
  const lead = err && err.unknownOutcome ? "Carta did not answer."
    : raw ? "Carta hit an error partway through."
    : when === "issue" ? "Carta did not confirm the issue."
    : `Carta stopped partway: ${sentence(err && err.message)}`;
  const message = unknown && when === "issue"
    ? `${lead} These securities may or may not have been issued — ask Claude to check ${set} `
      + "in Carta. Do not issue again from here."
    : unknown
    ? `${lead} The save may or may not have landed — ask Claude to check ${set} before trying again.`
    : err && err.fromServer ? (raw ? RAW_REFUSAL[when] || RAW_REFUSAL.save : sentence(err.message))
    : when === "check"
    ? "These rows are saved and nothing is issued. Carta did not finish checking them — "
      + "try again."
    // "Nothing was sent" holds only while there is no draft set. And an issue whose
    // outcome is open took the unknown branch above, so here nothing is issued.
    : S.draftSetId
    ? "Could not reach Carta. The rows are saved and nothing is issued — try again."
    : "Could not reach Carta. Nothing was sent — try again.";
  // Nothing more may be written from this page. The rows may already be on the cap
  // table, and the sheet is about to say so — a live Issue button contradicts it.
  if (unknown) S.stuck = message;
  // The failure goes on screen before the hand-off is recorded, not after: an unserved
  // store answers only after ~10s, and the page already knows what it is going to say.
  const out = rewriteLine();
  openSheet("failed", { message: out ? `${message} ${out}` : message, title: unknown ? "Outcome unknown" : "" });
  render();
  if (unknown || out) {
    noteHandoff(S.sheet, await handoff("needs_claude", Object.assign(
      { reason: out ? "rows_removed" : "unknown_outcome", at: when },
      out ? { rows: rewriteNames() } : {})));
  }
}

/** Rows deleted to change their document set that no save has written back yet. */
const rewriteNames = () => S.rows.filter((r) => S.rewriting.includes(r.key)).map(rowName);
function rewriteLine() {
  const names = rewriteNames();
  if (!names.length) return "";
  return `${names.join(", ")} ${names.length === 1 ? "was" : "were"} taken out of the draft set to `
    + `change ${names.length === 1 ? "its" : "their"} document set and ${names.length === 1 ? "is" : "are"} `
    + "not back yet — try again before closing this page.";
}

/** A Python exception that reached the wire as Carta's answer: its class name in
    brackets, or a traceback. Narrow on purpose — Carta's own refusals are sentences, and
    those are the reader's to see verbatim. */
const RAW_SHAPES = [
  /\([A-Z][A-Za-z]*(?:Error|Exception)\)/,
  /Traceback \(most recent call last\)/,
  /(?:^|:\s)[A-Z][A-Za-z]*(?:Error|Exception): /,
  /\b[A-Z][A-Za-z]*(?:Error|Exception)\(['"]/,
  /'[A-Za-z_]+' object (?:has no attribute|is not (?:subscriptable|iterable|callable))/,
];
const rawException = (m) => RAW_SHAPES.some((re) => re.test(String(m || "")));
const RAW_REFUSAL = {
  save: "Carta couldn't save this draft set. Nothing was issued — try again, or ask Claude to check it.",
  check: "Carta couldn't check this draft set. Nothing was issued — try again, or ask Claude to check it.",
};

/** A figure the document can carry. JSON holds no NaN, and `submit("draft")` does not
    run incomplete() — so one unchecked price would take the whole write down. */
const fin = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** One write, with one retry. `unavailable` is the store's own transient code; a refusal
    is not, and repeating one only holds up the sheet the reader is already looking at. */
async function putHandoff(db, doc, retry) {
  try {
    await db.doc("issuance/handoff").set(doc);
    return true;
  } catch (err) {
    if (!retry || String(err && err.code) !== "unavailable") throw err;
    await sleep(300 + Math.random() * 500);
    return putHandoff(db, doc, false);
  }
}

/** Say that Claude was not told: on S, because the page is then the only record and the
    reader can dismiss the sheet — and on that sheet, if it is still the one on screen. */
function noteHandoff(sheet, told) {
  // The document is one path, so a later hand-off that lands replaces what an earlier
  // one could not say, and the page stops saying it too.
  S.untold = !told;
  renderFooter();
  if (told || !sheet || S.sheet !== sheet) return;
  sheet.told = false;
  renderSheet();
}

/** What the model reads to close the loop in chat. It never throws: a hand-off that
    does not land must not be reported as a write that did not land. Every caller reads
    the answer — an untold page is the only record of what it did. */
async function handoff(status, extra) {
  try {
    // Inside the try: `totals()` re-serializes every row, so it can throw for the same
    // reasons a save can, and this runs after the write it is recording.
    const by = {};
    for (const [cur, t] of totals(true).entries()) {
      by[cur] = { quantity: fin(t.qty), value: t.priced ? fin(t.value) : null };
    }
    const db = await store();
    if (!db) return false;
    return await putHandoff(db, Object.assign({
      status,
      draft_set_id: S.draftSetId,
      corporation_id: S.corpId,
      security_type: S.type,
      recipients: S.rows.length,
      holders: S.rows.map((r) => (r.name || "").trim()).filter(Boolean),
      totals: by,
      issue_date: iso(S.shared.issue_date) || null,
      summary: issueMessage(status),
      confirmed_at: new Date().toISOString(),
    }, extra || {}), true);
  } catch (err) {
    console.error("issuance artifact: hand-off write failed", err);
    return false;
  }
}

const msgs = (v) => [].concat(v == null ? [] : v).filter((m) => typeof m === "string" && m);

/** Every refusal that belongs to the whole set rather than to one row.
    long-comment-ok: the four wire shapes, because only one of them is obvious.
    `banner_errors` carries a refused or vanished draft set and a validator that would
    not build; `corporation_errors` is the missing-signatory refusal issue raises and
    validate does not; `issuance_errors` is the rest of the set-level text. All three sit
    BESIDE `errors`, never inside it — so an empty `errors` map is not a pass. */
function setLines(validation) {
  if (!validation) return [];
  return [
    ...msgs(validation.banner_errors),
    ...Object.values(validation.corporation_errors || {}).flatMap(msgs),
    ...msgs(validation.issuance_errors),
  ];
}

/** Server fields that describe the row itself, in snake case. Every other field is a
    term the batch shares — a document set, a plan, a date — and Carta repeats its
    refusal on every row that inherits it. */
const ROW_OWNED = new Set(["name", "email", "stakeholder", "stakeholder_id", "stakeholder_kind",
  "issue_date_relationship", "quantity", "fund_structure", "prefix_number", "custom_label",
  "salary", "state_of_residency", "cash_paid"]);
/** Server field → the form key a row overrides it through, where the two differ. */
const SRV_TERM = { document_set: "document_set_id", documents: "document_set_id",
  share_class: "prefix", vesting_acceleration_name: "acceleration_template",
  legend_name: "legend_id", rule144_date: "rule_144_date",
  rule144_difference_reason: "rule_144_reason", needs_board_approval: "board_mode",
  expiration_date: "grant_expiration_date" };
const snake = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
/** A row owns an error on its own identity and quantity, and on a term it overrode. */
function rowOwns(r, field) {
  const f = snake(field);
  return ROW_OWNED.has(f) || (SRV_TERM[f] || f) in r.ov;
}

/** The control on the row that a refused field belongs to, as rowHtml() ids it, or ""
    when the row draws no control for it — the message then sits under the row. */
function rowSlot(r, field) {
  const f = snake(field);
  const named = r.isNew || r.stakeholderId != null;
  if (f === "quantity") return "quantity";
  if (["name", "email", "stakeholder", "stakeholder_id"].includes(f)) {
    return r.isNew ? (f === "email" ? "new-email" : "new-name") : "stakeholder";
  }
  if (f === "issue_date_relationship") return named ? "relationship" : "";
  if (f === "stakeholder_kind") return named ? "kind" : "";
  const k = formKey(f);
  // Only a term the override panel draws: an override the form no longer shows — a
  // Rule 144 date left over from "a different date" — has no control to carry it.
  return k in r.ov && spec().some((d) => d.over && d.k === k) ? `ov-${k}` : "";
}

/** The form's own key for a server field. An option grant's plan belongs to the set. */
function formKey(field) {
  const k = SRV_TERM[snake(field)] || snake(field);
  return k === "option_plan" && S.type === "option_grant" ? "option_plan_id" : k;
}

/** Words for a refusal that arrived with none a reader can use. */
function refusedField(field) {
  const k = SRV_TERM[snake(field)] || snake(field);
  const d = spec().find((x) => x.k === k);
  return `Carta did not accept the ${d ? String(d.label).toLowerCase() : k.replace(/_/g, " ")}.`;
}

/** A refusal with no words to show for it still has to say something happened. */
const UNNAMED_REFUSAL = "Carta did not accept these rows and named no field. Nothing is "
  + "issued — try again, or ask Claude to check this draft set.";

/** validate_drafts errors are keyed by draft_pk; map them back to the row. An error on a
    shared term goes to the banner once, however many rows Carta repeated it on. */
function absorb(v) {
  const validation = (v && v.validation) || null;
  const errs = (validation && validation.errors) || (v && v.errors) || {};
  const byPk = {}; for (const [k, pk] of Object.entries(S.drafts)) byPk[String(pk)] = k;
  const rows = {}; const fields = {}; const batch = []; const shared = new Map();
  const marks = new Set();
  let bad = false;
  const set = setLines(validation);
  if (set.length) { batch.push(...set); bad = true; }
  // A verdict that is present and not `true` is a refusal even when it names nothing —
  // a failed workflow reports exactly that, and reading `errors` alone called it clean.
  if (validation && validation.success !== true) bad = true;
  for (const [k, val] of Object.entries(errs)) {
    // The nested form, for a caller that hands the strategy's own errors through
    // unmerged. The merged form arrives in setLines() above.
    if (k === "issuance") { if (val && val.length) { batch.push(...msgs(val)); bad = true; } continue; }
    if (k === "corporation") {
      const m = Object.values(val || {}).flatMap(msgs);
      if (m.length) { batch.push(...m); bad = true; } continue;
    }
    bad = true;
    const r = S.rows.find((x) => x.key === byPk[String(k)]);
    if (!r) { batch.push(...Object.values(val || {}).flatMap(msgs)); continue; }
    for (const [f, m] of Object.entries(val || {})) {
      const text = msgs(m).map(sentence).join(" ") || refusedField(f);
      if (rowOwns(r, f)) {
        const slot = rowSlot(r, f);
        if (slot) {
          (fields[r.key] = fields[r.key] || {})[slot] = text;
          // An override's field sits inside its panel, which a closed panel would hide.
          if (slot.startsWith("ov-")) r.open = true;
        } else (rows[r.key] = rows[r.key] || {})[f] = msgs(m).length ? m : [text];
        continue;
      }
      const s = shared.get(text) || { keys: [], fields: [] };
      s.keys.push(r.key);
      const k = formKey(f);
      if (!s.fields.includes(k)) s.fields.push(k);
      shared.set(text, s);
      // Outlined where the shared field is drawn; the words stay in the banner, once.
      if (spec().some((d) => d.k === k)) marks.add(`shared-${k}`);
    }
  }
  const lines = [...new Set(batch)];
  if (bad && !lines.length && !shared.size && !Object.keys(rows).length
    && !Object.keys(fields).length) lines.push(UNNAMED_REFUSAL);
  S.srv = { rows, fields, batch: lines,
    shared: [...shared].map(([text, s]) => ({ text, keys: s.keys, fields: s.fields })), marks: [...marks] };
  return bad;
}

/** The one sentence the model reads back to the user. It reports what happened here;
    it never asks for a write, because by this point the page has already made it. */
function issueMessage(status) {
  // A draft can hold a quantity nobody checked, and "NaN option grants" is worse than
  // a sentence that leaves the figure out.
  const q = fin(S.rows.reduce((a, r) => a + Number(r.quantity || 0), 0));
  const who = S.rows.length === 1 ? (S.rows[0].name || "1 stakeholder") : `${S.rows.length} stakeholders`;
  const what = `${q == null ? "" : `${q.toLocaleString()} `}${typeLabel().toLowerCase()} across ${who} on ${S.corpName}`;
  if (status === "issued") return `Issued ${what} from the issuance form. Nothing further to write.`;
  if (status === "draft") return `Saved ${what} as a draft set from the issuance form, not yet validated and not issued.`;
  return `Saved ${what} as a draft set from the issuance form. The issue did not complete.`;
}

/* ---------- a resumed draft set ----------
   long-comment-ok: the contract, which spans the load, the form and the payload.
   A resume reads the set back with load_drafts. A term every row holds the same becomes
   the shared term; one that differs becomes that row's override, so the review shows
   exactly what is stored. What load_drafts does not return stays AS_SAVED — shown as
   such and never sent — and the rows as loaded become the last-sent baseline, so a save
   with no edits changes nothing and an edit empties only what the user emptied. */

/** A stored row's value for each shared term the page can read back, as the form holds it. */
function storedTerms(x) {
  // A key load_drafts did not return is not a blank: it is Carta's, shown as such.
  const from = (k, f) => (k in x ? f(x[k]) : AS_SAVED);
  const date = (v) => anyDateIso(v);
  const txtv = (v) => (v == null ? "" : String(v));
  const bool = (v) => v === true;
  const out = {
    issue_date: from("issue_date", date), board_approval_date: from("board_approval_date", date),
    currency: from("currency", txtv), notes: from("notes", txtv),
    vesting_template: from("vesting_template", (v) => (v == null || v === "" ? NONE : String(v))),
    vesting_start_date: from("vesting_start_date", date),
    acceleration_template: from("acceleration_template", txtv),
  };
  if (S.type === "certificate") {
    const r144 = from("rule_144_date", date);
    const legend = objs(S.legends).find((l) => (l.text || l.body || "") === (x.legend || ""));
    Object.assign(out, { prefix: from("prefix", txtv), law_firm_price: from("law_firm_price", txtv),
      legend_id: !("legend" in x) ? AS_SAVED : !x.legend ? "" : legend ? String(legend.id) : AS_SAVED,
      // A blank stored date is neither "same as issue" nor a date of its own.
      rule_144_mode: !r144 || r144 === AS_SAVED ? AS_SAVED : r144 === out.issue_date ? "issue_date" : "other",
      rule_144_date: r144 || AS_SAVED, rule_144_reason: from("rule_144_difference_reason", txtv),
      dividend_accrual_start_date: from("dividend_accrual_start_date", date) });
  } else if (S.type === "piu") {
    Object.assign(out, { prefix: from("prefix", txtv), threshold_value: from("threshold_value", txtv),
      threshold_value_type: from("threshold_value_type", txtv), option_plan: from("option_plan", txtv),
      document_set_id: from("document_set_id", txtv),
      corresponding_interest: from("corresponding_interest", bool) });
  } else {
    // needs_board_approval when Carta sends it; otherwise a stored board date, which is
    // refused on a pending grant, means approved.
    const nba = x.needs_board_approval;
    Object.assign(out, {
      board_mode: nba === true ? "pending" : nba === false ? "approved"
        : out.board_approval_date && out.board_approval_date !== AS_SAVED ? "approved" : AS_SAVED,
      so_type: from("so_type", txtv), exercise_price: from("exercise_price", txtv),
      grant_expiration_date: from("grant_expiration_date", date),
      early_exercise: from("early_exercise", bool), is_hmrc_notified: from("is_hmrc_notified", bool),
      hmrc_notified: from("hmrc_notified", (v) => (v ? String(v).slice(0, 10) : "")),
      ato_notified: from("ato_notified", bool),
      employment_related: from("employment_related", (v) => (v == null ? "" : String(!!v))) });
  }
  return out;
}
/** Option-grant terms load_drafts cannot return: its documents are files on the draft. */
const NOT_LOADED = { option_grant: ["document_set_id"] };

function storedRow(x) {
  const kind = x.stakeholder_kind || "";
  const row = mkRow({ stakeholderId: x.stakeholder_id ?? null, name: x.name || "", email: x.email || "",
    quantity: x.quantity != null ? String(x.quantity) : "", kind: kind || "INDIVIDUAL",
    relationship: x.issue_date_relationship || "",
    isNew: x.stakeholder_id == null && !!(x.name || x.email) });
  row.kindUnknown = !kind;
  row.stored = x;
  row.resumed = true;
  return row;
}

/** Take a load_drafts answer as the page's state. False when it carried no rows. */
function hydrateFromDrafts(res) {
  const stored = objs(res && res.drafts).filter((x) => x.draft_pk != null);
  if (!stored.length) return false;
  S.hydrated = true;
  S.rows = stored.map(storedRow);
  S.drafts = {};
  S.sent = {};
  S.rows.forEach((r, i) => { S.drafts[r.key] = stored[i].draft_pk; });
  const terms = stored.map(storedTerms);
  for (const k of Object.keys(terms[0])) {
    S.shared[k] = terms[0][k];
    S.rows.forEach((r, i) => { if (terms[i][k] !== terms[0][k]) r.ov[k] = terms[i][k]; });
  }
  for (const k of NOT_LOADED[S.type] || []) S.shared[k] = AS_SAVED;
  if (S.type === "option_grant") {
    const plan = res.equity_plan_id ?? res.equity_class_id;
    S.shared.option_plan_id = plan == null ? AS_SAVED : String(plan);
  }
  S.docPicked = true;
  S.curFor = S.shared.so_type;
  return true;
}

/** No load: every shared term is what Carta holds, and none is sent until the user sets it. */
function markUnhydrated() {
  S.hydrated = true;
  for (const k of Object.keys(S.shared)) if (k !== "jurisdiction") S.shared[k] = AS_SAVED;
  S.curFor = AS_SAVED;
}

/* ---------- events ---------- */
function commit(ev) {
  const t = ev.target;
  // An event a render raised on the control it replaces carries the pre-render
  // value. Writing it back undoes the update that caused the render.
  if (rendering || !t.isConnected) return;
  const k = t.getAttribute("data-k");
  if (!k || t.readOnly) return;
  const scope = t.getAttribute("data-scope");
  const val = t.type === "checkbox" ? t.checked : t.value;
  // An edit answers Carta's refusal of that field, and makes the saved draft stale.
  clearSrvField(t.id, scope, k);
  S.savedNote = "";
  if (scope === "shared") {
    S.touchedShared.add(k);
    S.shared[k] = val;
    if (k === "jurisdiction") { dropStaleSoType(); applySoFill(); }
    if (k === "so_type") applySoFill();
    if (k === "issue_date" || (k === "option_plan_id" && S.draftSetId == null)) {
      const was = S.shared.grant_expiration_date;
      S.shared.grant_expiration_date = grantExpiry();
      // A resumed row on its own issue date keeps the expiry Carta stored for it.
      for (const r of S.rows) {
        if (r.resumed && "issue_date" in r.ov && !("grant_expiration_date" in r.ov)) r.ov.grant_expiration_date = was;
      }
    }
    if (k === "document_set_id") {
      S.docPicked = true;
      S.srv.marks = arr(S.srv.marks).filter((m) => m !== "shared-document_set_id");
    }
    // A PIU's plan decides whether its set needs the plan document.
    if (k === "option_plan" || k === "option_plan_id") pickDocSet();
    if (k === "issue_date") {
      if (S.shared.rule_144_mode === "issue_date") S.shared.rule_144_date = val;
    }
  } else if (scope.startsWith("ov-")) {
    const r = S.rows[Number(scope.slice(3))];
    if (!r) return;
    r.touched.add(k);
    // Matching the shared value, or cleared, is inheriting it: the row follows the batch.
    const d = spec().find((x) => x.k === k);
    const inherited = d ? inheritedVal(d, r) : "";
    if (val === "" || val === false || String(val) === String(inherited)) delete r.ov[k];
    else r.ov[k] = val;
    // A row's own expiry, read back for its old issue date, moves with the new one.
    if (k === "issue_date" && S.type === "option_grant" && "grant_expiration_date" in r.ov
      && !r.touched.has("grant_expiration_date")) r.ov.grant_expiration_date = grantExpiry(val);
  } else if (scope.startsWith("row-")) {
    const r = S.rows[Number(scope.slice(4))];
    if (!r) return;
    r[k] = val;
    r.touched.add(k === "query" ? "stakeholder" : k);
    if (k === "kind") r.kindUnknown = false;
    if (k === "query") { r.stakeholderId = null; resolveExact(r); }
  }
}

function clearSrvField(id, scope, k) {
  const srv = S.srv || {};
  if (scope === "shared") {
    srv.shared = arr(srv.shared).filter((s) => !arr(s.fields).includes(k));
    srv.marks = arr(srv.marks).filter((m) => m !== `shared-${k}`);
    return;
  }
  const m = /^row-(\d+)-(.+)$/.exec(id || "");
  const r = m && S.rows[Number(m[1])];
  if (!r) return;
  const own = srv.fields && srv.fields[r.key];
  if (own) delete own[m[2]];
  const left = srv.rows && srv.rows[r.key];
  if (left) for (const f of Object.keys(left)) if (formKey(f) === k) delete left[f];
}

/** Picks only when exactly one stakeholder answers to the name: two people called Chris
    Lee are the user's to tell apart, never the first one the roster happened to list. */
function resolveExact(r) {
  const q = (r.query || "").trim().toLowerCase();
  if (!q) return;
  const hits = S.roster.filter((x) => (x.name || "").toLowerCase() === q || (x.email || "").toLowerCase() === q);
  if (hits.length === 1) pick(r, hits[0]);
}
function pick(r, m) {
  S.savedNote = "";
  r.touched.add("stakeholder");
  r.stakeholderId = m.id; r.name = m.name; r.email = m.email;
  r.kind = m.kind || "INDIVIDUAL"; r.kindUnknown = false;
  r.relationship = m.relationship || r.relationship || "";
  r.query = m.name; r.isNew = false;
}

function suggest(input, i) {
  const r = S.rows[i]; const box = input.parentNode.querySelector(".sug");
  const q = (input.value || "").trim().toLowerCase();
  if (!q || !r) {
    box.hidden = true; box.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    return;
  }
  const hits = [];
  for (const s of S.roster) {
    if ((s.name || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q)) {
      hits.push(s);
      if (hits.length >= 25) break;
    }
  }
  box.innerHTML = hits.length
    ? hits.map((s, j) => `<li role="option" aria-selected="false" id="row-${i}-opt-${j}" data-pick="${esc(s.id)}" data-i="${i}">${esc(s.name)} <span class="e">${esc(s.email)}</span></li>`).join("")
    : `<li role="option" aria-disabled="true" data-none="1">${S.rosterLoading
        ? "Still loading the stakeholder list…"
        : S.searching
        ? "Searching Carta…"
        : "No match — use “Create a new stakeholder”."}</li>`;
  box.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
}

// `input` never re-renders: rebuilding the DOM mid-keystroke would drop focus
// and the caret. Conditional fields all hang off <select>s, which fire `change`.
document.addEventListener("input", (ev) => {
  if (rendering) return;
  const combo = ev.target.getAttribute && ev.target.getAttribute("data-combo");
  commit(ev);
  if (combo != null) { searchRoster(ev.target.value); suggest(ev.target, Number(combo)); }
  renderFooter();
});
// `rendering` also stops the re-entrant render: this event came from the render
// already in flight, which is about to finish drawing the right thing anyway.
// The draw waits a frame. `change` fires mid-focus-transfer, so replacing the control
// focus is heading for abandons it — focus lands on the page body and every keystroke
// after it is lost, typed notes included, which then reach the wire missing. A frame
// later the transfer has finished and grabFocus() sees the control the user moved to.
// A microtask is too early: it drains before the focus events. Coalesced, so one
// gesture draws once.
// long-comment-ok: records why the timing is load-bearing and why a microtask fails.
let pendingRender = 0;
document.addEventListener("change", (ev) => {
  if (rendering) return;
  commit(ev);
  cancelAnimationFrame(pendingRender);
  pendingRender = requestAnimationFrame(() => render());
});

// Hold the caret in the combobox while a suggestion is pressed: focus leaving a
// dirty input fires `change`, which re-renders the rows and destroys the
// suggestion before the click reaches it. Only the suggestion, so the list's own
// scrollbar still drags.
document.addEventListener("mousedown", (ev) => {
  if (ev.target.closest && ev.target.closest(".sug li[data-pick]")) ev.preventDefault();
});

document.addEventListener("click", (ev) => {
  const li = ev.target.closest && ev.target.closest(".sug li[data-pick]");
  if (li) {
    const i = Number(li.getAttribute("data-i"));
    const m = S.roster.find((x) => String(x.id) === li.getAttribute("data-pick"));
    if (m && S.rows[i]) pick(S.rows[i], m);
    render();
    // The caret survived the press, so putFocus() has just reopened the list on
    // the name it resolved to. Close it: the pick is made.
    closeSuggestions();
    return;
  }
  if (ev.target.closest && ev.target.closest('[data-testid="retry-load"]')) {
    // Absent whenever the form runs without its bring-up, as the test harnesses do.
    if (typeof retryBoot === "function") retryBoot();
    return;
  }
  const b = ev.target.closest && ev.target.closest("[data-act]");
  if (b) {
    const act = b.getAttribute("data-act"); const i = Number(b.getAttribute("data-i"));
    if (act === "remove") removeRow(i);
    else if (act === "ov") S.rows[i].open = !S.rows[i].open;
    else if (act === "new") {
      const r = S.rows[i];
      // A row that already resolved to someone starts blank: reusing their
      // name here is how a duplicate record gets created for a person who
      // is already on the cap table.
      if (r.stakeholderId != null) { r.name = ""; r.email = ""; r.query = ""; }
      r.isNew = true; r.stakeholderId = null; r.touched.add("stakeholder");
      if (!r.relationship) r.relationship = "Employee";
    }
    else if (act === "existing") { const r = S.rows[i]; r.isNew = false; r.query = r.name; r.touched.add("stakeholder"); }
    if (act !== "ov") S.savedNote = "";
    S.errs = {}; render(); return;
  }
  if (ev.target.closest && ev.target.closest('[data-testid="add-stakeholder"]')) {
    S.rows.push(mkRow({})); S.errs = {}; S.savedNote = ""; render(); return;
  }
  if (ev.target.closest && ev.target.closest('[data-testid="save-draft"]')) { submit("draft"); return; }
  // Confirm & Issue opens the review; only the review's Issue hands over.
  if (ev.target.closest && ev.target.closest('[data-testid="confirm-issue"]')) {
    // The button is live whatever state the form is in, so a click that cannot go
    // forward has to say why — nothing else does now.
    if (incomplete()) return;
    S.stage = "review"; S.banner = ""; render();
    return;
  }
  if (ev.target.closest && ev.target.closest('[data-testid="back-to-edit"]')) {
    S.stage = "edit"; S.banner = ""; render(); return;
  }
  if (ev.target.closest && ev.target.closest('[data-testid="issue"]')) { submit("issue"); return; }
  if (ev.target.closest && ev.target.closest('[data-testid="modal-go"]')) {
    // `issueNow` owns the one-shot guard; this only has to not swallow the click.
    issueNow();
    return;
  }
  if (ev.target.closest && ev.target.closest('[data-testid="modal-close"]')) { dismissSheet(); return; }
  closeSuggestions();
});

/** A saved row that leaves the form leaves the set with the next save, or confirming
    would issue it anyway. */
function removeRow(i) {
  const r = S.rows[i];
  if (!r) return;
  const pk = S.drafts[r.key];
  if (pk != null && pk !== "") { S.removed.push(pk); delete S.drafts[r.key]; }
  if (S.rows.length > 1) S.rows.splice(i, 1); else S.rows[0] = mkRow({});
  S.savedNote = "";
}

/** Back, Close, Done and Escape. A terminal page keeps the stage it committed to: the
    issued list, or the review a failed write never left. Only a recoverable refusal
    returns to one the user can act on. */
function dismissSheet() {
  if (!S.sheet || WAITING.has(S.sheet.phase)) return;
  const terminal = S.issued || S.stuck || S.sheet.phase === "saved";
  const opener = S.opener;
  closeSheet();
  if (!terminal) S.stage = "review";
  render();
  if (opener && opener.isConnected && opener.focus && !opener.hidden) opener.focus();
}

function closeSuggestions() {
  document.querySelectorAll(".sug").forEach((n) => { n.hidden = true; });
  document.querySelectorAll("[data-combo]").forEach((n) => {
    n.setAttribute("aria-expanded", "false");
    n.removeAttribute("aria-activedescendant");
  });
}

/** Up and Down walk the list, Enter picks, Escape closes it. */
function comboKey(ev, input) {
  const box = input.parentNode && input.parentNode.querySelector(".sug");
  // Down reopens a list Escape closed.
  if (ev.key === "ArrowDown" && box && box.hidden) suggest(input, Number(input.getAttribute("data-combo")));
  const opts = box && !box.hidden ? [...box.querySelectorAll("li[data-pick]")] : [];
  const at = opts.findIndex((o) => o.getAttribute("aria-selected") === "true");
  if (ev.key === "Escape" && box && !box.hidden) { ev.preventDefault(); closeSuggestions(); return; }
  if (ev.key === "Enter" && at >= 0) {
    ev.preventDefault();
    const i = Number(input.getAttribute("data-combo"));
    const m = S.roster.find((x) => String(x.id) === opts[at].getAttribute("data-pick"));
    if (m && S.rows[i]) pick(S.rows[i], m);
    render();
    closeSuggestions();
    return;
  }
  if ((ev.key !== "ArrowDown" && ev.key !== "ArrowUp") || !opts.length) return;
  ev.preventDefault();
  const next = ev.key === "ArrowDown" ? Math.min(at + 1, opts.length - 1) : Math.max(at - 1, 0);
  opts.forEach((o, j) => o.setAttribute("aria-selected", String(j === next)));
  input.setAttribute("aria-activedescendant", opts[next].id);
  if (opts[next].scrollIntoView) opts[next].scrollIntoView({ block: "nearest" });
}

/** Tab stays inside an open sheet, and Escape dismisses one that is not mid-write. */
function sheetKey(ev) {
  if (ev.key === "Escape") { ev.preventDefault(); dismissSheet(); return; }
  if (ev.key !== "Tab") return;
  const stops = sheetStops();
  ev.preventDefault();
  if (!stops.length) { const title = el("modal-title"); if (title && title.focus) title.focus(); return; }
  const at = stops.indexOf(document.activeElement);
  const next = ev.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
  stops[next].focus();
}

document.addEventListener("keydown", (ev) => {
  if (S.sheet) { sheetKey(ev); return; }
  const t = ev.target;
  if (t && t.getAttribute && t.getAttribute("data-combo") != null) comboKey(ev, t);
});
