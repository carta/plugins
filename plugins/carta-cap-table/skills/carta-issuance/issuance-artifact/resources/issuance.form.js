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

/** What Confirm actually does, which differs by type: a grant or a unit goes out for
    signature, a certificate lands on the cap table. Whoever confirms is entitled to
    know which. Shown in the review, beside the Issue button. */
const CONFIRM_LINE = {
  option_grant: "Confirming will save these grants to Carta and send them to the signatory for signature.",
  certificate: "Confirming will save these certificates to Carta and issue them to the cap table.",
  piu: "Confirming will save these profits interest units to Carta and send them to the signatory for signature.",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const S = {
  stage: "edit",
  ready: false, corpId: null, corpName: "", type: "option_grant", token: null,
  counts: {}, prefill: {}, blockers: [], narrowed: null, thresholdNoun: "Threshold",
  roster: [], plans: [], classes: [], vesting: [], accel: [], docSets: [], legends: [], vals: [],
  intl: { active: [], history: [] }, intlOk: false, isLLC: null,
  manifest: {},
  termsLoading: true, rosterLoading: true, booted: false,
  loadErr: "", loadFailed: [], connErr: "", shared: {}, rows: [], seq: 0,
  searching: false, searchErr: false, searched: new Set(),
  errs: {}, srv: {}, banner: "", bannerBad: false, busy: false,
  draftSetId: null, drafts: {},
};

/* ---------- helpers ---------- */
const el = (t) => document.querySelector(`[data-testid="${t}"]`);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "");
const today = () => new Date().toISOString().slice(0, 10);
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
/** Every server error as one list, in the server's own words. A payload key is never
    customer-facing, and the message already names its field; a row's line leads with the
    recipient, because "Quantity exceeds…" alone does not say whose row it is. */
function serverErrorLines() {
  const out = [...(S.srv.batch || [])];
  for (const r of S.rows) {
    const msgs = S.srv.rows && S.srv.rows[r.key];
    if (!msgs) continue;
    const who = (r.name || "").trim();
    for (const m of Object.values(msgs)) {
      const text = [].concat(m).join("; ");
      out.push(who ? `${who} — ${text}` : text);
    }
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
  // A resume: saveArgs() then updates this set instead of minting a second one.
  S.draftSetId = d.draftSetId ?? d.draft_set_id ?? S.draftSetId;
  S.counts = d.counts || {};
  S.prefill = d.prefill || {};
  S.blockers = Array.isArray(d.blockers) ? d.blockers : [];
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
  // The only client-clock read left: a last-resort default for the issue
  // date itself when the server sent none. Every other date anchors to it.
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
    sh.is_ato_notified = false;
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
}

/** One row per person the user actually named. An `ambiguous` entry creates NO row. */
function seedRows() {
  S.rows = [];
  S.drafts = {};
  for (const r of S.prefill.rows || []) {
    const row = mkRow({
      stakeholderId: r.stakeholderId ?? r.stakeholder_id ?? null,
      name: r.name || "", email: r.email || "",
      quantity: r.quantity != null ? String(r.quantity) : "",
      kind: r.stakeholderKind || "INDIVIDUAL",
      relationship: r.issueDateRelationship || "",
    });
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
    isNew: !!o.isNew, open: false, query: o.name || "", ov: {},
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
  out.forEach((res, i) => {
    const tag = jobs[i][0];
    // Neither is a dependency. Without the manifest every field keeps the label and
    // requiredness written below; the international valuations are permissioned apart
    // and a US-only corp is refused them by design, with the 409A set as the fallback.
    if (res.status !== "fulfilled") { if (tag !== "manifest" && tag !== "intl") failed.push(tag); return; }
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
    } else if (tag === "manifest") S.manifest = mfIndex(res.value);
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
  noteFailures(failed);
  mfDefaults();
  applyDerived();
  render();
  mark("terms");
  flag();
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
  S.loadErr = named.length
    ? `We could not load ${named.join(" or ")}. Ask Claude to open this page again.`
    : "";
}

/** The one attribute the outside world reads: what stage the boot reached. */
function flag() {
  const v = S.termsLoading ? "shell" : S.rosterLoading ? "terms" : "ready";
  document.documentElement.setAttribute("data-boot", v);
}

/** No live data at all. The form stays readable so the user can see what was asked
    for, but a write cannot reach Carta, so the footer takes its buttons away. */
function degrade() {
  S.connErr = connReason();
  S.termsLoading = false;
  S.rosterLoading = false;
  render();
  flag();
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
  } catch {
    S.rosterLoading = false;
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
  if (term.length < 2 || S.searched.has(term.toLowerCase())) return Promise.resolve();
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
      } catch {
        // The names already loaded still answer; the notice says search is degraded.
        S.searchErr = true;
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
  // Sole option plan / document set / legend / vesting-free class default silently.
  const plans = selectablePlans();
  if (S.type === "option_grant" && !sh.option_plan_id && plans.length === 1) sh.option_plan_id = String(plans[0].id);
  if (S.type !== "certificate" && !sh.document_set_id && S.docSets.length === 1) sh.document_set_id = String(S.docSets[0].id);
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
  dropStaleSoType();
  applySoFill();
  dropUnofferedChoices();
  // Existing stakeholders carry their own kind + relationship.
  for (const r of S.rows) {
    if (r.stakeholderId == null) continue;
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
  if (S.type !== "option_grant" || !S.shared.so_type) return;
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
    if (d.kind !== "sel" || !d.req || "val" in d || v === "" || v == null) continue;
    if (!(d.opts || []).some((o) => String(o[0]) === String(v))) S.shared[d.k] = "";
  }
}

function applySoFill() {
  if (S.type !== "option_grant") return;
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
  if (!ATO_SO_TYPES.has(S.shared.so_type)) S.shared.is_ato_notified = false;
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

/** Why the page could not price this grant, when it could not. A price it did find
    is provenance, and the review carries it. */
function fmvWarning() {
  const v = fmv();
  if (v.ambiguous) return "More than one valuation is live on this share class — set the price this grant uses.";
  if (v.price != null && v.source) return "";
  return fmvLapsed();
}
function fmvProv() {
  const v = fmv();
  return v.price != null && v.source ? `default — current ${v.source}` : "";
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
  const yrs = Number(p.expiration_years ?? p.option_term_years ?? 10);
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + yrs);
  if (p.minus_one_day !== false) d.setUTCDate(d.getUTCDate() - 1);
  let end = d.toISOString().slice(0, 10);
  const cap = iso(p.expiration_date);
  if (cap && cap < end) end = cap;
  return end;
}

const candidates = () => (S.prefill.jurisdictionCandidates || []).filter((c) => SO[c]);
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
function fld(id, label, body, o) {
  o = o || {};
  const e = S.errs[id];
  return `<div class="f${o.wide ? " wide" : ""}${e ? " bad" : ""}" data-f="${id}">
    <label for="${id}">${esc(label)}${o.req ? ' <span class="req">*</span>' : ""}</label>
    ${body}
    ${o.hint && !e ? `<div class="hint${o.hintCls ? ` ${o.hintCls}` : ""}">${esc(o.hint)}</div>` : ""}
    ${e ? `<div class="err" data-testid="err-${id}">${esc(e)}</div>` : ""}
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
    ${o.ro ? "readonly" : ""} ${o.dis ? "disabled" : ""} ${o.ph ? `placeholder="${esc(o.ph)}"` : ""}>`;
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
function noteBox(t, stop, title, items, foot) {
  return `<div class="note${stop ? " stop" : ""}" data-testid="${t}">
    <div class="note-t"><span class="dot"></span>${esc(title)}</div>
    ${items.length ? `<ul>${items.join("")}</ul>` : ""}
    ${foot ? `<p>${esc(foot)}</p>` : ""}</div>`;
}

const planOpts = () => selectablePlans().map((p) => [String(p.id), p.name || "Unnamed plan"]);
const classOpts = () => S.classes.map((c) => [c.prefix, `${c.name || c.prefix} (${c.prefix})`]);
const vestOpts = () => [[NONE, "No vesting"], ...S.vesting.map((t) =>
  [String(t.id), t.summary_short ? `${t.name} — ${t.summary_short}` : t.name])];
const docOpts = () => S.docSets.map((d) => [String(d.id), d.name || "Unnamed document set"]);
const legendOpts = () => S.legends.map((l) => [String(l.id), l.name || "Unnamed legend"]);
const accelOpts = () => S.accel.map((t) => [String(t.id), t.name]);

/* ---------- the server's field manifest, laid over the inline spec ----------
   long-comment-ok: the overlay contract, which the code below cannot state.
   cap_table:get:issuable_field_manifest is carta-web's own description of this
   form, so the declarative facts — label, requiredness, static enum values,
   blank defaults — come from there and stop drifting. Everything derived stays
   below in JS. The overlay is an enhancement: no manifest, no entry for a field,
   or no key on an entry all leave that field exactly as written here. */

/** Panel key → manifest field name, where the two spell it differently. */
const MF_ALIAS = { rule_144_reason: "rule_144_difference_reason" };
/** Fields the server fills from a dynamic source. Their option lists are the
    panel's own (richer labels, and already loaded); their label and requiredness
    are still the server's. `dynamic_source` is not on the wire, so it is named
    here — see field_manifest/service.py's _DYNAMIC_SOURCE_RESOLVERS. */
const MF_DYNAMIC = new Set(["option_plan", "prefix", "vesting_template",
  "acceleration_template", "legend", "exercise_legend", "convertible_note",
  "share_class", "form_of_option_doc", "form_of_exercise_doc",
  "equity_incentive_plan_doc", "purchase_agreement_doc"]);

/** What the manifest may NOT overlay, and why. Everything unnamed is the
    server's to own. long-comment-ok: one recorded decision per exception. */
const MF_SKIP = {
  /* Product decisions taken deliberately in this panel. */
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
  // its label drops the "(US)" the panel computes.
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
  // `required: false` must not switch the panel's own rule off.
  rule_144_date: { req: 1 },
  rule_144_reason: { req: 1 },
  employment_related: { req: 1 },
  dividend_accrual_start_date: { req: 1 },
  // A grant's issue date is required once the board has approved it and
  // rejected before then, so the manifest's flat `false` is the safe half of
  // a rule the panel states in full below.
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
function mfIndex(res) {
  const out = {};
  for (const f of sect((payload(res) || {}).fields)) {
    if (f && typeof f.name === "string" && !f.hidden) out[f.name] = f;
  }
  return out;
}

/** One inline descriptor with whatever the manifest actually covers laid over it.
    Applied inside spec()'s F, so a manifest `required` for a field the panel does
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
    The panel's lists read as English ("Has determined 144 date"); the bare wire
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
    the terms load, and applyDerived() keeps every value the panel computes for
    itself — including the sole-plan, sole-class, sole-legend and sole-docset
    picks, which is why a dynamic field's default is not taken here either. */
function mfDefaults() {
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
// `prov` tags the review with what the page chose. Conditional fields are absent.
function spec() {
  const sh = S.shared, t = S.type, s = [];
  const F = (k, label, kind, x) => s.push(mfApply(Object.assign({ k, label, kind }, x || {})));
  const soleProv = (n, what) => (n === 1 ? `default — only ${what}` : "");
  const vest = () => {
    const grant = t === "option_grant";
    const chosen = tmpl();
    // "No vesting" is a real option and the default, so a blank one above it would
    // be a second way to say the same thing.
    F("vesting_template", "Vesting", "sel", { opts: vestOpts(), over: 1, noPh: 1,
      // A grant that does not vest is accepted and atypical, so the review says so.
      prov: grant && sh.vesting_template === NONE ? "default — no vesting" : "",
      // The closed control truncates a long template name, and what it drops
      // is the schedule itself — the only way to tell two templates apart.
      hint: (chosen && chosen.summary_short) || "" });
    const real = sh.vesting_template && sh.vesting_template !== NONE;
    if (real && !isMilestone()) {
      F("vesting_start_date", "Vesting start", "date",
        { over: 1, req: "a vesting start date", prov: "default — the issue date" });
    }
    if (real && accelOpts().length) {
      F("acceleration_template", "Acceleration", "sel",
        { opts: accelOpts(), over: 1, ph: "No acceleration" });
    }
  };
  const cls = () => F("prefix", classNoun(), "sel", { opts: classOpts(), over: 1,
    req: `a ${classNoun().toLowerCase()}`, prov: soleProv(S.classes.length, "class") });

  if (t === "option_grant") {
    const zepo = sh.so_type === "ZEPO";
    // The plan is the draft set's, not the row's — carta-web locks equity_plan_id
    // once the set exists — so this one term stays shared.
    F("option_plan_id", "Option plan", "sel", { opts: planOpts(), req: "an option plan",
      prov: soleProv(selectablePlans().length, "plan") });
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
      prov: zepo ? "autofill — ZEPO rule" : fmvProv(),
      hint: zepo ? "ZEPO — fixed at 0" : fmvWarning() });
    F("currency", "Currency", curOpts().length ? "sel" : "text", { over: 1,
      opts: curOpts(), prov: sh.so_type ? `autofill — ${sh.so_type} rule` : "" });
    F("board_mode", "Board approval", "sel", { over: 1, noPh: 1,
      opts: [["approved", "Approved"], ["pending", "Pending board approval"]] });
    // A grant gets its issue date from the board's approval, so the server
    // refuses one before then: "Issue date is not applicable for grants that
    // are not board approved." Pending grants therefore have no issue date to
    // collect, and `rowPayload` leaves the key off.
    if (sh.board_mode === "approved") {
      F("issue_date", "Issue date", "date", { over: 1, req: "an issue date" });
      F("board_approval_date", "Board approval date", "date",
        { over: 1, req: "a board approval date" });
    }
    // Editable, but still derived: choosing another plan or issue date recomputes it.
    F("grant_expiration_date", "Grant expiration", "date", { over: 1,
      prov: plan() ? "default — plan term" : "" });
    vest();
    F("document_set_id", "Document set", "sel", { opts: docOpts(), req: "a document set",
      over: 1, prov: soleProv(S.docSets.length, "document set") });
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
      F("is_ato_notified", "ATO has been notified", "check", { over: 1 });
    }
  } else if (t === "certificate") {
    cls();
    F("law_firm_price", "Price per share", "num", { over: 1, min: 0, req: "a price per share" });
    F("currency", "Currency", curOpts().length ? "sel" : "text", { over: 1, opts: curOpts() });
    F("issue_date", "Issue date", "date", { over: 1, req: "an issue date" });
    F("board_approval_date", "Board approval date", "date",
      { over: 1, req: "a board approval date" });
    F("legend_id", "Legend", "sel", { opts: legendOpts(), req: "a legend",
      over: 1, prov: soleProv(S.legends.length, "legend") });
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
    const noun = S.thresholdNoun, Noun = capNoun(noun);
    cls();
    F("threshold_value_type", `${Noun} type`, "sel", { over: 1, req: `a ${noun.toLowerCase()} type`,
      opts: [["Unit", "Unit — per unit"], ["Overall", "Overall — once for the whole grant"]] });
    F("threshold_value", `${Noun} value`, "num", { over: 1, min: 0, dp: 12,
      req: `a ${noun.toLowerCase()} value` });
    F("option_plan", "Equity plan", "sel", { opts: planOpts(), over: 1, ph: "No plan" });
    F("currency", "Currency", curOpts().length ? "sel" : "text", { over: 1, opts: curOpts() });
    F("issue_date", "Issue date", "date", { over: 1, req: "an issue date" });
    F("board_approval_date", "Board approval date", "date", { over: 1 });
    if (S.docSets.length) {
      F("document_set_id", "Document set", "sel", { opts: docOpts(), over: 1,
        prov: soleProv(S.docSets.length, "document set") });
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
    const empty = S.termsLoading && !(d.opts || []).length;
    // `ph` is the override's "Shared: …", which a row always needs to fall back on,
    // so it outranks `noPh` — that only suppresses the shared control's blank option.
    return sel(id, v, d.opts, { k: d.k, scope,
      placeholder: ph || (d.noPh ? false : (empty ? "Loading…" : d.ph)) });
  }
  return txt(id, v, { k: d.k, scope, num: d.kind === "num", ro: d.ro, dis: d.dis,
    type: d.kind === "date" ? "date" : "text", ph: ph || d.ph });
}
function specHtml() {
  return spec().map((d) => {
    const id = `shared-${d.k}`;
    const v = specVal(d);
    if (d.kind === "check") return chk(id, v, d.label, { k: d.k, hint: d.hint });
    const g = d.kind === "num" ? grouped(v) : "";
    return fld(id, d.label, control(d, id, v, "shared"),
      { req: !!d.req, hint: g || d.hint, hintCls: g ? "echo" : "", wide: d.wide });
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
  if (S.connErr) return `${who} · no live data`;
  if (S.rosterLoading) return `${who} · loading stakeholders…`;
  return who;
}
/** Blockers the page decides for itself. Derived at render time rather than stored, so
    an ingest cannot drop them and a changed plan or unit class cannot leave one stale. */
function localBlockers() {
  const out = [];
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
const allBlockers = () => S.blockers.concat(localBlockers());
/** A hard stop means nothing on this form can be issued, so the form does not
    render around it — the problems and their fix are the whole page. */
const hardStops = () => allBlockers().filter((b) => b.severity === "hard_stop");
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
    const stopped = hardStops().length > 0;
    const reviewing = S.stage === "review";
    el("shared-card").hidden = reviewing || stopped;
    el("rows-card").hidden = reviewing || stopped;
    el("review-card").hidden = !reviewing || stopped;
    if (stopped) { /* nothing to draw: the notes above are the page */ }
    else if (reviewing) {
      el("review").innerHTML = reviewHtml();
    } else {
      // Cleared, not just hidden: a stale review must not outlive the stage it belongs
      // to, least of all the sentence saying what confirming commits to.
      el("review").innerHTML = "";
      el("shared-grid").innerHTML = specHtml();
      el("rows").innerHTML = S.rows.map((r, i) => rowHtml(r, i)).join("");
    }
    renderFooter();
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
    (stops.length ? noteBox("blockers-stop", true,
      stops.length === 1 ? "Fix this before you can issue"
        : `Fix these ${stops.length} things before you can issue`, stops.map(li),
      "Nothing can be issued from here until this is fixed. Fix it in Carta, then ask Claude to open this page again.") : "")
    + (decide.length ? noteBox("blockers-decide", false,
      decide.length === 1 ? "Your call — nothing was chosen for you"
        : `${decide.length} choices are yours — nothing was chosen for you`, decide.map(li),
      "Carta holds competing answers here, so picking one for you could set the wrong terms. Choose below before you review.") : "")
    + (warns.length ? noteBox("blockers-warn", false,
      warns.length === 1 ? "Worth checking first"
        : `${warns.length} things worth checking first`, warns.map(li)) : "");
}

function renderNotices() {
  const p = S.prefill, out = [];
  const amb = p.ambiguous || [], un = p.unmatched || [];
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
      un.map((n) => `<li data-testid="unmatched-${esc(n)}">${esc(n)} — add them as a new stakeholder below.</li>`)));
  }
  if (S.narrowed) {
    // Carta caps the bootstrap's size and says what it gave up. Clipped rows
    // mean recipients are missing from the form — never leave that unsaid.
    const applied = (S.narrowed.applied || []).map(String);
    const lostRows = applied.some((a) => /row/i.test(a));
    out.push(noteBox("notice-narrowed", lostRows,
      lostRows ? "Not every recipient reached this form"
        : "Carta shortened some of the detail below",
      applied.map((a) => `<li>${esc(a)}</li>`),
      lostRows
        ? "Add the missing people below, or ask Claude to split this into smaller batches."
        : "The terms and the recipients are unaffected."));
  }
  if (S.loadErr) out.push(noteBox("notice-load-error", true, S.loadErr, []));
  if (S.searchErr) {
    out.push(noteBox("notice-search-error", false,
      "Searching Carta for more stakeholders failed", [],
      `Only the ${headcount().toLocaleString()} names already loaded can be picked. Check before creating anyone new.`));
  }
  const all = serverErrorLines();
  if (all.length) {
    out.push(noteBox("notice-server-errors", true,
      all.length === 1 ? "Carta would not save this"
        : `Carta would not save this — ${all.length} things to fix`,
      all.map((m) => `<li>${esc(m)}</li>`)));
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
    const v = d.k in r.ov ? r.ov[d.k] : "";
    // A date input ignores `placeholder`, so the shared value it would fall
    // back to goes in the hint instead. Every override says what it inherits.
    const inherits = `Shared: ${shDisp(d)}`;
    // A tick has no third state, and blank is what "inherit" is made of, so a
    // row answers a checkbox with a Yes / No of its own.
    const body = d.kind === "check"
      ? sel(id, v, [["true", "Yes"], ["false", "No"]],
        { k: d.k, scope: `ov-${i}`, placeholder: inherits })
      : control(d, id, v, `ov-${i}`, inherits);
    o.push(fld(id, d.label, body, d.kind === "date" && !v ? { hint: inherits } : {}));
  }
  return o.join("");
}
function shDisp(d) {
  const v = specVal(d);
  if (d.kind === "check") return v ? "Yes" : "No";
  if (v === "" || v == null) return "—";
  if (d.kind === "date") return longDate(v);
  const m = (d.opts || []).find((x) => String(x[0]) === String(v));
  return m ? m[1] : String(v);
}

/* ---------- review ---------- */
// Reads the same rowPayload() the mutate sends, so the review cannot drift
// from what is actually written.
const nameOf = (list, v, key) => {
  const m = list.find((x) => String(x[key || "id"]) === String(v));
  return m ? m.name : "";
};
function unitPrice(d) {
  return S.type === "option_grant" ? d.exercise_price
    : S.type === "certificate" ? d.law_firm_price : null;
}
/** Grouped by the row's own currency. A batch can mix so_types, so it can mix
    currencies, and a cross-currency total would be meaningless. */
function totals() {
  const by = new Map();
  for (const r of S.rows) {
    const d = rowPayload(r);
    const cur = d.currency || "—";
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
function reviewHtml() {
  const priceHead = S.type === "option_grant" ? "Exercise price"
    : S.type === "certificate" ? "Price / share" : S.thresholdNoun;
  const rows = S.rows.map((r, i) => {
    const d = rowPayload(r);
    const terms = [d.issue_date_relationship];
    if (S.type === "option_grant") {
      terms.push(d.so_type, nameOf(S.plans, S.shared.option_plan_id));
    } else {
      const cc = S.classes.find((c) => c.prefix === d.prefix);
      terms.push(cc ? cc.name || cc.prefix : d.prefix);
      if (S.type === "piu" && d.option_plan) terms.push(nameOf(S.plans, d.option_plan));
    }
    terms.push(d.vesting_template ? nameOf(S.vesting, d.vesting_template) : "No vesting");
    const ovKeys = Object.keys(r.ov);
    const ovLabels = ovKeys.length
      ? spec().filter((x) => ovKeys.includes(x.k)).map((x) => x.label)
      : [];
    const price = S.type === "piu"
      ? `${money(d.threshold_value, "")} ${d.threshold_value_type === "Overall" ? "overall" : "/ unit"}`
      : money(unitPrice(d), d.currency);
    return `<div class="rv-r" data-testid="review-row-${i}">
      <div><b>${esc(r.name)}</b>${r.stakeholderId == null ? " <span class=\"rv-tag\">(new)</span>" : ""}
        <div class="rv-s">${esc(terms.filter(Boolean).join(" · "))}</div>
        ${ovLabels.length ? `<div class="rv-tag" data-testid="review-row-${i}-override">Overridden: ${esc(ovLabels.join(", "))}</div>` : ""}</div>
      <div class="rv-n">${Number(d.quantity).toLocaleString()}</div>
      <div class="rv-n">${esc(price)}</div>
    </div>`;
  }).join("");

  const tot = [...totals().entries()].map(([cur, t]) =>
    `<div class="rv-t" data-testid="review-total-${esc(cur)}">
      <div>Total — ${esc(cur)}</div>
      <div class="rv-n" data-testid="review-total-qty-${esc(cur)}">${t.qty.toLocaleString()}</div>
      <div class="rv-n" data-testid="review-total-value-${esc(cur)}">${t.priced ? esc(money(t.value, cur)) : "—"}</div>
    </div>`).join("");

  const terms = spec().filter((d) => d.k !== "notes" && specVal(d) !== "" && specVal(d) != null
    && specVal(d) !== false).map((d) => `<div data-testid="review-term-${d.k}">
      <dt>${esc(d.label)}</dt>
      <dd>${esc(d.kind === "check" ? "Yes" : shDisp(d))}</dd>
      ${d.prov ? `<dt class="rv-tag" data-testid="review-prov-${d.k}">${esc(d.prov)}</dt>` : ""}
    </div>`).join("");

  return `<div class="rv-h"><div>Stakeholder</div><div class="rv-n">Quantity</div>
      <div class="rv-n">${esc(priceHead)}</div></div>
    <div data-testid="review-rows">${rows}</div>
    ${tot}
    <dl class="rv-terms" data-testid="review-terms">${terms}</dl>
    ${S.shared.notes ? `<p class="rv-s" data-testid="review-notes">Notes: ${esc(S.shared.notes)}</p>` : ""}
    ${legendHtml()}
    <p class="rv-commit" data-testid="review-commit">${esc(CONFIRM_LINE[S.type] || "")}</p>`;
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

function rowHtml(r, i) {
  const p = `row-${i}`;
  const top = r.isNew
    ? fld(`${p}-new-name`, "Name",
        txt(`${p}-new-name`, r.name, { k: "name", scope: p }), { req: true })
    : fld(`${p}-stakeholder`, "Name",
        `<div class="combo"><input id="${p}-stakeholder" data-testid="${p}-stakeholder"
          data-k="query" data-scope="${p}" data-combo="${i}" type="text" autocomplete="off"
          role="combobox" value="${esc(r.query)}" placeholder="${esc(comboPlaceholder())}">
          <ul class="sug" data-testid="${p}-suggestions" hidden></ul></div>`,
        { req: true, hint: r.stakeholderId != null ? `${esc(r.email)} · ${esc(r.relationship || "—")}` : "" });
  // `wide` puts the email on its own line under the whole row, and the grid's own
  // gap is what separates it from the name above.
  const email = r.isNew
    ? fld(`${p}-new-email`, "Email",
        txt(`${p}-new-email`, r.email, { k: "email", scope: p, type: "email" }),
        { req: true, wide: true })
    : "";
  const named = r.isNew || r.stakeholderId != null;
  return `<div class="row" data-testid="${p}" data-row-key="${r.key}">
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

function rowErrHtml(r, p) {
  const msgs = S.srv.rows && S.srv.rows[r.key];
  if (!msgs) return "";
  return `<div class="err" data-testid="${p}-server-errors">${Object.values(msgs)
    .map((m) => esc([].concat(m).join("; "))).join(" · ")}</div>`;
}

function renderFooter() {
  // Only a write in flight, a form with no options to show yet, a hard stop or a
  // dead transport disables a button. An incomplete form does not: a dead greyed-out
  // button says nothing about what is wrong, whereas a click paints the offending
  // fields, and the server has the last word on the rest.
  const stopped = hardStops().length > 0;
  const dead = !!S.connErr;
  const blocked = S.termsLoading || S.busy || dead;
  const reviewing = S.stage === "review";
  el("confirm-issue").hidden = reviewing || stopped;
  el("issue").hidden = !reviewing || stopped;
  el("back-to-edit").hidden = !reviewing || stopped;
  el("save-draft").hidden = stopped;
  el("confirm-issue").disabled = blocked;
  el("issue").disabled = blocked;
  el("back-to-edit").disabled = S.busy;
  el("save-draft").disabled = blocked;
  const why = el("blocked-reason");
  why.className = "why";
  why.textContent = stopped ? "Nothing can be issued until the problems above are fixed."
    : dead ? "No live connection to Carta — nothing can be saved from here."
    : S.termsLoading ? "Loading…"
    : "";
}

/* ---------- validation ---------- */
function validate(write) {
  const e = {}, missing = [];
  const need = (id, lab, ok, msg) => { if (!ok) { e[id] = msg || "Required"; missing.push(lab); } };
  for (const d of spec()) {
    const id = `shared-${d.k}`, v = specVal(d);
    const blank = v === "" || v == null;
    if (d.req) need(id, d.req, !blank);
    if (blank || d.kind !== "num") continue;
    if (d.min != null && !(Number(v) >= d.min)) e[id] = `Must be ${d.min} or more`;
    else if (d.dp && (String(v).split(".")[1] || "").length > d.dp) e[id] = `At most ${d.dp} decimal places`;
  }
  if (!S.rows.length) missing.push("a stakeholder");
  S.rows.forEach((r, i) => {
    const p = `row-${i}`;
    if (r.isNew) {
      need(`${p}-new-name`, "a name", !!r.name.trim());
      need(`${p}-new-email`, "an email", /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(r.email.trim()), "Enter a valid email");
    } else {
      need(`${p}-stakeholder`, "a stakeholder", r.stakeholderId != null, "Pick someone from the list");
    }
    need(`${p}-quantity`, "a quantity", r.quantity !== "" && Number(r.quantity) > 0, "Must be greater than 0");
    // Asked for only once the row names someone — that is also when the row renders
    // the select to answer it in.
    if (!r.isNew && r.stakeholderId == null) return;
    need(`${p}-relationship`, "a relationship", !!r.relationship);
  });
  if (write) S.errs = e;
  return [...new Set(missing)];
}

/* ---------- payload ----------
   A draft can be half-finished, so every field a user might not have reached yet is
   left out rather than sent as 0, NaN or the string "undefined" — the server names a
   missing field, but reads a coerced one as the user's answer. */
function put(o, k, v) {
  if (v === "" || v == null || v === NONE) return;
  if (typeof v === "number" && !Number.isFinite(v)) return;
  o[k] = v;
}
const num = (v) => (v === "" || v == null ? "" : Number(v));
const str = (v) => (v === "" || v == null ? "" : String(v));
function rowPayload(r, i) {
  const sh = S.shared;
  const g = (k) => (k in r.ov && r.ov[k] !== "" ? r.ov[k] : sh[k]);
  // Whether this row answered a term itself, which is what makes a derived value
  // the row's own rather than the batch's.
  const own = (k) => k in r.ov && r.ov[k] !== "";
  // A shared checkbox is a boolean; a row's override of one is "true" / "false".
  const yes = (k) => g(k) === true || g(k) === "true";
  // `temp_id` is the wire name for r.key: the server echoes it beside draft_pk.
  const d = { temp_id: r.key, stakeholder_kind: r.kind };
  put(d, "name", r.name.trim());
  put(d, "email", r.email.trim());
  put(d, "issue_date_relationship", r.relationship);
  put(d, "quantity", num(r.quantity));
  // A grant awaiting board approval has no issue date yet, and the server
  // rejects the row outright if one is sent. Per row: one batch can mix the two.
  const pending = S.type === "option_grant" && g("board_mode") === "pending";
  if (!pending) put(d, "issue_date", g("issue_date"));
  if (r.stakeholderId != null) d.stakeholder_id = Number(r.stakeholderId);
  if (S.drafts[r.key]) d.draft_pk = S.drafts[r.key];
  const vt = g("vesting_template");
  const realVest = vt && vt !== NONE;
  if (realVest) {
    d.vesting_template = Number(vt);
    const t = S.vesting.find((x) => String(x.id) === String(vt));
    if (!(t && /milestone/i.test(t.vesting_type || ""))) put(d, "vesting_start_date", us(g("vesting_start_date") || d.issue_date));
    put(d, "acceleration_template", num(g("acceleration_template")));
  } else if (S.type === "option_grant") {
    // save_drafts patches: omitting the key leaves an earlier schedule in place, so the
    // change to "No vesting" never lands. Vesting is opt-in on a certificate and a PIU.
    d.vesting_template = null;
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
    d.needs_board_approval = pending;
    if (!pending) put(d, "board_approval_date", g("board_approval_date"));
    // The term runs from the issue date, so a row that moved its own needs its own.
    const expiry = !own("grant_expiration_date") && own("issue_date")
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
    if (ATO_SO_TYPES.has(so)) d.is_ato_notified = yes("is_ato_notified");
  } else if (S.type === "certificate") {
    put(d, "prefix", g("prefix"));
    put(d, "law_firm_price", str(g("law_firm_price")));
    put(d, "currency", g("currency"));
    put(d, "board_approval_date", g("board_approval_date"));
    put(d, "legend_id", num(g("legend_id")));
    d.exemption = "Section 4(a)(2)";
    const other = g("rule_144_mode") === "other";
    const r144 = other ? g("rule_144_date") : d.issue_date;
    put(d, "rule_144_date", us(r144));
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
    d.exemption = "Section 4(a)(2)";
    put(d, "option_plan", str(g("option_plan")));
    put(d, "board_approval_date", g("board_approval_date"));
    put(d, "document_set_id", num(g("document_set_id")));
    const cc = S.classes.find((c) => c.prefix === d.prefix);
    if (cc && cc.has_corresponding_interest) d.corresponding_interest = yes("corresponding_interest");
    // The read is not the authority when it cannot see the link — the server is. An
    // explicit tick goes out as true and DraftCorrespondingInterestValidator rules on it.
    else if (cc && !("has_corresponding_interest" in cc) && yes("corresponding_interest")) {
      d.corresponding_interest = true;
    }
  }
  return d;
}

function saveArgs() {
  const a = { corporation_id: S.corpId, security_type: S.type,
    drafts: S.rows.map((r, i) => rowPayload(r, i)) };
  if (S.draftSetId) a.draft_set_id = S.draftSetId;
  else {
    const on = S.shared.issue_date || today();
    a.draft_set_name = `${shortLabel()} ${on}`.slice(0, 30);
    if (S.type === "option_grant" && S.shared.option_plan_id) a.equity_plan_id = Number(S.shared.option_plan_id);
  }
  return a;
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

async function submit(mode) {
  // A draft is a place to put work in progress, so it goes to the server as it
  // stands and comes back with the server's own per-field errors. Issuing is the
  // irreversible one, so it still asks the form first.
  if (mode === "issue" && incomplete()) return;
  S.busy = true; S.banner = mode === "issue" ? "Saving and checking…" : "Saving draft…";
  S.bannerBad = false; S.srv = {}; render();
  try {
    const saved = payload(await one("cap_table__mutate__save_drafts", saveArgs())) || {};
    S.draftSetId = saved.draft_set_id ?? saved.draftSetId ?? S.draftSetId;
    for (const d of saved.drafts || saved.rows || []) {
      if (d.temp_id && d.draft_pk) S.drafts[d.temp_id] = d.draft_pk;
    }
    const v = payload(await one("cap_table__mutate__validate_drafts", {
      corporation_id: S.corpId, security_type: S.type, draft_set_id: S.draftSetId,
    })) || {};
    const bad = absorb(v);
    S.busy = false;
    if (bad) {
      // Server errors anchor to form fields, so go back where those fields are.
      S.stage = "edit";
      S.banner = "Some details need fixing — see the fields below. Nothing has been issued.";
      S.bannerBad = true; render(); return;
    }
    // The hand-off never throws, so a hand-off that does not land cannot be
    // reported as a save that did not land.
    const landed = await handoff(mode === "issue" ? "ready" : "draft");
    if (mode === "draft") {
      S.banner = `Saved as draft set ${S.draftSetId} — ${S.rows.length} stakeholder${S.rows.length > 1 ? "s" : ""}, no problems found.`
        + (landed ? " Claude can pick it up from here."
                  : ` Nothing is issued. Tell Claude: resume draft set ${S.draftSetId}.`);
      render(); return;
    }
    S.banner = landed
      ? `Draft set ${S.draftSetId} is saved and checked, and Claude has it — confirm in the chat to issue it. Nothing is issued yet.`
      : `Draft set ${S.draftSetId} is saved and checked. Nothing is issued. Tell Claude: issue draft set ${S.draftSetId}.`;
    render();
  } catch (err) {
    console.error("issuance artifact: Carta call failed", err);
    S.busy = false;
    S.banner = err && err.fromServer
      ? `Carta would not save this: ${err.message}`
      : err && err.needsConnector
      ? connReason(err.code)
      : err && err.unknownOutcome
      ? (S.draftSetId
        ? `Carta did not answer. Draft set ${S.draftSetId} may or may not have saved — ask Claude to check it before trying again.`
        : "Carta did not answer. The save may or may not have landed — ask Claude to check for a new draft set before trying again.")
      : "Could not reach Carta. Nothing was saved — try again.";
    S.bannerBad = true; render();
  }
}

/** The page stops at a saved-and-validated draft set and hands it over; the model
    runs the irreversible write, so the host's own confirmation prompt still fires.
    This page never calls cap_table:mutate:issue_securities. */
async function handoff(status) {
  const by = {};
  for (const [cur, t] of totals().entries()) {
    by[cur] = { quantity: t.qty, value: t.priced ? t.value : null };
  }
  try {
    const db = await store();
    if (!db) return false;
    await db.doc("issuance/handoff").set({
      status,
      draft_set_id: S.draftSetId,
      corporation_id: S.corpId,
      security_type: S.type,
      recipients: S.rows.length,
      totals: by,
      summary: issueMessage(),
      confirmed_at: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.error("issuance artifact: hand-off write failed", err);
    return false;
  }
}

/** validate_drafts errors are keyed by draft_pk; map them back to the row. */
function absorb(v) {
  const errs = (v.validation && v.validation.errors) || v.errors || {};
  const byPk = {}; for (const [k, pk] of Object.entries(S.drafts)) byPk[String(pk)] = k;
  const rows = {}; const batch = []; let bad = false;
  for (const [k, val] of Object.entries(errs)) {
    if (k === "issuance") { if (val && val.length) { batch.push(...[].concat(val)); bad = true; } continue; }
    if (k === "corporation") {
      const m = Object.values(val || {}).flatMap((ms) => [].concat(ms));
      if (m.length) { batch.push(...m); bad = true; } continue;
    }
    const rk = byPk[String(k)];
    if (rk) rows[rk] = val;
    else batch.push(...Object.values(val || {}).flatMap((ms) => [].concat(ms)));
    bad = true;
  }
  S.srv = { rows, batch };
  return bad;
}

function issueMessage() {
  const q = S.rows.reduce((a, r) => a + Number(r.quantity || 0), 0);
  const who = S.rows.length === 1 ? (S.rows[0].name || "1 stakeholder") : `${S.rows.length} stakeholders`;
  return `Issue draft set ${S.draftSetId} for ${S.corpName}: ${q.toLocaleString()} ${typeLabel().toLowerCase()} ` +
    `across ${who}, saved and validated clean from the issuance panel. ` +
    `Run cap_table:mutate:issue_securities with corporation_id ${S.corpId}, ` +
    `security_type ${S.type}, draft_set_id ${S.draftSetId}. Do not re-collect any terms.`;
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
  if (scope === "shared") {
    S.shared[k] = val;
    if (k === "jurisdiction") { dropStaleSoType(); applySoFill(); }
    if (k === "so_type") applySoFill();
    if (k === "option_plan_id" || k === "issue_date") S.shared.grant_expiration_date = grantExpiry();
    if (k === "issue_date") {
      if (S.shared.rule_144_mode === "issue_date") S.shared.rule_144_date = val;
    }
  } else if (scope.startsWith("ov-")) {
    const r = S.rows[Number(scope.slice(3))];
    if (!r) return;
    if (val === "" || val === false) delete r.ov[k]; else r.ov[k] = val;
  } else if (scope.startsWith("row-")) {
    const r = S.rows[Number(scope.slice(4))];
    if (!r) return;
    r[k] = val;
    if (k === "query") { r.stakeholderId = null; resolveExact(r); }
  }
}

function resolveExact(r) {
  const q = (r.query || "").trim().toLowerCase();
  if (!q) return;
  const m = S.roster.find((x) => (x.name || "").toLowerCase() === q || (x.email || "").toLowerCase() === q);
  if (m) pick(r, m);
}
function pick(r, m) {
  r.stakeholderId = m.id; r.name = m.name; r.email = m.email;
  r.kind = m.kind || "INDIVIDUAL"; r.relationship = m.relationship || r.relationship || "";
  r.query = m.name; r.isNew = false;
}

function suggest(input, i) {
  const r = S.rows[i]; const box = input.parentNode.querySelector(".sug");
  const q = (input.value || "").trim().toLowerCase();
  if (!q || !r) { box.hidden = true; box.innerHTML = ""; return; }
  const hits = [];
  for (const s of S.roster) {
    if ((s.name || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q)) {
      hits.push(s);
      if (hits.length >= 25) break;
    }
  }
  box.innerHTML = hits.length
    ? hits.map((s) => `<li data-pick="${esc(s.id)}" data-i="${i}">${esc(s.name)} <span class="e">${esc(s.email)}</span></li>`).join("")
    : `<li data-none="1">${S.rosterLoading
        ? "Still loading the stakeholder list…"
        : S.searching
        ? "Searching Carta…"
        : "No match — use “Create a new stakeholder”."}</li>`;
  box.hidden = false;
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
    document.querySelectorAll(".sug").forEach((n) => { n.hidden = true; });
    return;
  }
  const b = ev.target.closest && ev.target.closest("[data-act]");
  if (b) {
    const act = b.getAttribute("data-act"); const i = Number(b.getAttribute("data-i"));
    if (act === "remove") { if (S.rows.length > 1) S.rows.splice(i, 1); else S.rows[0] = mkRow({}); }
    else if (act === "ov") S.rows[i].open = !S.rows[i].open;
    else if (act === "new") {
      const r = S.rows[i];
      // A row that already resolved to someone starts blank: reusing their
      // name here is how a duplicate record gets created for a person who
      // is already on the cap table.
      if (r.stakeholderId != null) { r.name = ""; r.email = ""; r.query = ""; }
      r.isNew = true; r.stakeholderId = null;
      if (!r.relationship) r.relationship = "Employee";
    }
    else if (act === "existing") { const r = S.rows[i]; r.isNew = false; r.query = r.name; }
    S.errs = {}; render(); return;
  }
  if (ev.target.closest && ev.target.closest('[data-testid="add-stakeholder"]')) {
    S.rows.push(mkRow({})); S.errs = {}; render(); return;
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
  document.querySelectorAll(".sug").forEach((n) => { n.hidden = true; });
});
