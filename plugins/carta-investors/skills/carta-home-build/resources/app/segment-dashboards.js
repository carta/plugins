// ── Segment dashboards: which cards show, and the LP summary card ──
// Depends on core.js (carta-home.app.js): _mcp(), dwhRows(), fmtCurrency(), escHtml(), trackHome().
// SOI and Fund performance are built for every firm, LP summary for Fund Admin firms. A card
// whose query answers with no rows is hidden instead of showing a blank, and the grid sizes
// itself to the cards left; with none left the whole section goes. A card whose query fails
// stays, showing its note.
// fundAdmin is null until get_current_user answers, so the LP query can start before then.
const _segment = { fundAdmin: null, firmId: null, profileDone: false };

const LP_CARD_ROWS = 3;

// One entry per dashboard card: its element id and the name its empty event carries.
const DASHBOARD_CARDS = {
  soi:  { id: "soi-card",  event: "SOI" },
  perf: { id: "perf-card", event: "Perf" },
  lp:   { id: "lp-card",   event: "LP" },
};
// "loading" until the card's query settles, then "data", "empty" or "error".
const _cardState = Object.fromEntries(Object.keys(DASHBOARD_CARDS).map(key => [key, "loading"]));
let _cardsReported = false;

// The cards this firm gets: LP summary only for a Fund Admin firm.
function firmCards(seg) {
  return Object.keys(DASHBOARD_CARDS).filter(key => key !== "lp" || seg.fundAdmin === true);
}

function dashboardLayout(seg, state) {
  const shown = firmCards(seg).filter(key => state[key] !== "empty");
  return { shown, count: shown.length };
}

function layoutDashboards() {
  const grid = document.getElementById("dashboard-grid");
  if (!grid) return;
  const layout = dashboardLayout(_segment, _cardState);
  grid.dataset.cards = String(layout.count);
  Object.entries(DASHBOARD_CARDS).forEach(([key, card]) => {
    const el = document.getElementById(card.id);
    if (el) el.hidden = !layout.shown.includes(key);
  });
  const section = document.getElementById("dashboards-section");
  // Once the reconnect panel replaces the Carta-data sections, nothing brings them back.
  if (section) section.hidden = _reconnectShown || layout.count === 0;
  // The tour is not loaded in every test page.
  if (section?.hidden && typeof tourSectionHidden === "function") tourSectionHidden("dashboards-section");
  reportDashboardCards();
}

// A card's query has settled. Empty hides the card; data keeps it. A failed card can still
// settle when a later retry gets its data.
function settleDashboardCard(key, hasData) {
  if (!(key in _cardState) || !["loading", "error"].includes(_cardState[key])) return;
  _cardState[key] = hasData ? "data" : "empty";
  if (!hasData) trackHome("render", `CartaHome.${DASHBOARD_CARDS[key].event}.Empty`);
  layoutDashboards();
}

// A card's query failed. The card stays with its note, so it counts as shown.
function failDashboardCard(key) {
  if (!(key in _cardState) || _cardState[key] !== "loading") return;
  _cardState[key] = "error";
  trackHome("render", `CartaHome.${DASHBOARD_CARDS[key].event}.LoadError`);
  layoutDashboards();
}

// Once every card this firm gets has settled (data, empty or error), record which ones it
// saw (e.g. "soi,perf" or "none"): every card but the empty ones, so a card showing its note
// counts. Sent as a click because a render event can't carry a value.
function reportDashboardCards() {
  if (_cardsReported || !_segment.profileDone || _reconnectShown) return;
  if (firmCards(_segment).some(key => _cardState[key] === "loading")) return;
  _cardsReported = true;
  const shown = dashboardLayout(_segment, _cardState).shown;
  trackHome("click", "CartaHome.View.Cards", { value: shown.length ? shown.join(",") : "none" });
}

// Wording for a firm whose holdings are all in SPVs, so the cards don't call them funds. The
// card titles stay as they are: they name the dashboards the cards open.
const SPV_WORDING = {
  "soi-card-desc":  "Every SPV's holding, with cost, value and gain/loss.",
  "soi-fund-label": "SPVS",
  "soi-col-name":   "SPV",
  "lp-card-desc":   "Every investor's commitments and returns across your SPVs.",
  "lp-col-name":    "LARGEST INVESTORS",
};

// True when every entity the SOI card lists is an SPV. Mixed or unknown keeps fund wording.
function isSpvOnly(rows) {
  return rows.length > 0 && rows.every(r => String(r.ENTITY_TYPE_NAME || "").toLowerCase() === "spv");
}

// Wording for a fund of funds, whose SOI card lists the outside funds it invests in.
const FOF_WORDING = {
  "soi-card-desc":  "Your largest fund investments, with value and gain/loss.",
  "soi-fund-label": "FUNDS YOU INVEST IN",
  "soi-col-name":   "UNDERLYING FUND",
};

// Writes each id's text; an id missing from the page is skipped.
function applyWording(map) {
  Object.entries(map).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
}

// From fetchUserEnrichment, once get_current_user answers.
function segmentSetFundAdmin(flag) {
  _segment.fundAdmin = flag === true;
  layoutDashboards();
  if (!_segment.fundAdmin) return;
  if (_lpResult) applyLpResult();
  else if (_segment.firmId) fetchLpSummary();
}

// From fetchUserEnrichment, once get_current_user has answered or failed, so whether the
// firm gets an LP card is known. Never from the 5s backstop: a slow profile can still add it.
function segmentProfileDone() {
  _segment.profileDone = true;
  reportDashboardCards();
}

// From fetchLiveData, once the firm is resolved and pinned with set_context.
// The LP query starts here, beside the other cards, unless the profile already said no: waiting
// for get_current_user would put it behind the profile call.
function segmentSetFirm(firmId) {
  _segment.firmId = firmId;
  if (_segment.fundAdmin !== false) fetchLpSummary();
}

// ── LP summary ──
// Largest LP families by commitment, per fund currency so no figure sums across
// currencies; net TVPI from each partner's latest month.
function lpSummarySql(firmId) {
  return `WITH lp AS (
      SELECT p.FUND_UUID, p.PARTNER_ID, p.FIRM_PARTNER_GROUP_ID AS family_id,
             p.FIRM_PARTNER_GROUP_NAME AS family_name, f.REPORTING_CURRENCY AS currency,
             p.TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT AS committed
      FROM FUND_ADMIN.PARTNER_DATA p JOIN FUND_ADMIN.FUNDS f ON f.FUND_UUID = p.FUND_UUID
      WHERE p.IS_LIMITED_PARTNER AND p.IS_ACTIVE AND p.FIRM_ID = '${firmId}'),
    latest AS (
      SELECT n.FUND_ID, n.PARTNER_ID, n.ENDING_TOTAL_NAV AS nav,
             n.CUMULATIVE_TOTAL_CONTRIBUTIONS AS paid_in, n.CUMULATIVE_TOTAL_DISTRIBUTIONS AS distributed
      FROM FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS n
      WHERE n.FIRM_ID = '${firmId}' AND n.IS_LIMITED_PARTNER AND n.MONTH_END_DATE <= LAST_DAY(CURRENT_DATE())
      QUALIFY ROW_NUMBER() OVER (PARTITION BY n.FUND_ID, n.PARTNER_ID ORDER BY n.MONTH_END_DATE DESC) = 1)
    SELECT lp.family_id, MAX(lp.family_name) AS family_name, lp.currency, SUM(lp.committed) AS committed,
           SUM(latest.nav) AS nav, SUM(latest.paid_in) AS paid_in, SUM(latest.distributed) AS distributed
    FROM lp LEFT JOIN latest ON latest.FUND_ID = lp.FUND_UUID AND latest.PARTNER_ID = lp.PARTNER_ID
    GROUP BY lp.family_id, lp.currency
    ORDER BY committed DESC NULLS LAST
    LIMIT ${LP_CARD_ROWS}`;
}

function lpTvpi(r) {
  const paidIn = parseFloat(r.PAID_IN);
  if (!(paidIn > 0)) return "—";
  return ((parseFloat(r.NAV || 0) + parseFloat(r.DISTRIBUTED || 0)) / paidIn).toFixed(2) + "x";
}

function renderLpRows(rows) {
  const el = document.getElementById("lp-rows");
  if (!el) return;
  el.innerHTML = rows.map(r => {
    return `<div class="tbl-row">
      <span class="tbl-col-name"><span class="lp-name" title="${escHtml(r.FAMILY_NAME)}">${escHtml(r.FAMILY_NAME || "LP")}</span></span>
      <span class="tbl-col-lp">${fmtCurrency(r.COMMITTED, r.CURRENCY)}<span class="lp-dot" aria-hidden="true">·</span>${lpTvpi(r)}</span>
    </div>`;
  }).join("");
}

// What the LP query answered: { rows } or { error }. It is shown only for a Fund Admin firm, so
// a query that finishes before the profile answers waits here instead of reaching the page.
let _lpResult = null;
let _lpLoading = false;
async function fetchLpSummary() {
  if (_lpLoading) return;
  _lpLoading = true;
  _lpResult = null;
  const firmId = _segment.firmId;
  try {
    const res = await _mcp("read_tool", { name: "dwh__execute__query", arguments: { sql: lpSummarySql(firmId), format: "ndjson" } });
    if (res.isError) throw new Error("LP summary query failed");
    _lpResult = { rows: dwhRows(res, "FAMILY_ID", "FAMILY_NAME") };
  } catch (e) {
    console.error("[carta-home] LP summary failed", e);
    _lpResult = { error: e };
  } finally {
    _lpLoading = false;
  }
  if (_segment.fundAdmin) applyLpResult();
}

function applyLpResult() {
  const { rows, error } = _lpResult;
  if (rows) {
    if (rows.length) renderLpRows(rows);
    settleDashboardCard("lp", rows.length > 0);
    return;
  }
  const el = document.getElementById("lp-rows");
  const note = renderConnectionFailure("lp", error?.code);
  if (el && note) el.innerHTML = note;
  failDashboardCard("lp");
}
