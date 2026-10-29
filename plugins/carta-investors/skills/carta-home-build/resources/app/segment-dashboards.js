// ── Segment dashboards: LP summary card ──
// Depends on core.js (carta-home.app.js): _mcp(), parseDWH(), fmtCurrency(), escHtml().
// Every firm gets the SOI and Fund performance cards; a Fund Admin firm adds LP summary,
// so the grid holds 2 or 3. The profile (fund admin) and the firm arrive separately;
// the LP rows load once both are in.
const _segment = { fundAdmin: false, firmId: null };

const LP_CARD_ROWS = 3;

function dashboardLayout(seg) {
  const lp = seg.fundAdmin === true;
  return { lp, count: lp ? 3 : 2 };
}

function layoutDashboards() {
  const grid = document.getElementById("dashboard-grid");
  if (!grid) return;
  const layout = dashboardLayout(_segment);
  grid.dataset.cards = String(layout.count);
  document.getElementById("lp-card").hidden = !layout.lp;
}

// From fetchUserEnrichment, once get_current_user answers.
function segmentSetFundAdmin(flag) {
  _segment.fundAdmin = flag === true;
  layoutDashboards();
  if (_segment.fundAdmin && _segment.firmId) fetchLpSummary();
}

// From fetchLiveData, once the firm is resolved and pinned with set_context.
function segmentSetFirm(firmId) {
  _segment.firmId = firmId;
  if (_segment.fundAdmin) fetchLpSummary();
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
  if (!rows.length) { el.innerHTML = `<div class="loading-row">No LPs yet</div>`; return; }
  el.innerHTML = rows.map(r => {
    return `<div class="tbl-row">
      <span class="tbl-col-name"><span class="lp-name" title="${escHtml(r.FAMILY_NAME)}">${escHtml(r.FAMILY_NAME || "LP")}</span></span>
      <span class="tbl-col-lp">${fmtCurrency(r.COMMITTED, r.CURRENCY)}<span class="lp-dot" aria-hidden="true">·</span>${lpTvpi(r)}</span>
    </div>`;
  }).join("");
}

let _lpLoading = false;
async function fetchLpSummary() {
  if (_lpLoading) return;
  _lpLoading = true;
  const firmId = _segment.firmId;
  try {
    const res = await _mcp("read_tool", { name: "dwh__execute__query", arguments: { sql: lpSummarySql(firmId), format: "ndjson" } });
    if (res.isError) throw new Error("LP summary query failed");
    renderLpRows(parseDWH(res));
  } catch (e) {
    console.error("[carta-home] LP summary failed", e);
    const el = document.getElementById("lp-rows");
    if (el) el.innerHTML = `<div class="loading-row">Can't load your LPs right now.</div>`;
  }
}
