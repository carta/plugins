// ── NDA insights card: the firm's NDAs that expire soonest ──
// Depends on core.js (carta-home.app.js): _mcp(), parseDWH(), escHtml(), fmtDate(), firmOwnName();
// app/segment-dashboards.js: settleDashboardCard(), failDashboardCard().
// Reads the NDAs Carta Law has extracted, with the rules carta-nda-dashboard's
// references/queries.md and nda_data_model.md set out: drop deleted documents, one row per
// agreement, the counterparty is the party that isn't the firm, expiry is start date + term.
const NDA_CARD_ROWS = 3;
// How far ahead the card looks for expiring NDAs, as the NDA dashboard's Expiring tab does.
const NDA_EXPIRING_MONTHS = 24;
// Entity words dropped from the firm's name to get the token that finds its side of an NDA.
const NDA_NAME_SUFFIXES = new Set(["llc", "lp", "ltd", "partners", "management", "capital", "advisors", "inc"]);

// The distinctive core of the firm's name, lower-cased: "Acme Capital Partners, LP" → "acme".
// Safe inside a quoted ILIKE pattern: quotes doubled, wildcards and backslashes dropped.
function ndaFirmToken(firmName) {
  return String(firmName || "")
    .replace(/\(.*?\)/g, " ")
    .toLowerCase()
    .replace(/[%_\\]/g, "")
    .replace(/[,.]/g, " ")
    .split(/\s+/)
    .filter(word => word && !NDA_NAME_SUFFIXES.has(word))
    .join(" ")
    .replace(/'/g, "''");
}

// One `kpi` row (every NDA, and the companies under a non-solicit, no-contact or
// non-circumvention clause still in force, as the NDA dashboard counts them) and up to
// NDA_CARD_ROWS `expiring` rows. The Carta MCP scopes both tables to the active firm; the
// firm filter keeps the card on this firm even if pinning it with set_context failed.
function ndaSummarySql(firmName, firmId) {
  const token = ndaFirmToken(firmName);
  // With no token, no party can be told apart from the firm, so take whichever is named.
  const counterparty = token
    ? `CASE WHEN disc ILIKE '%${token}%' THEN recv WHEN recv ILIKE '%${token}%' THEN disc ELSE COALESCE(disc, recv) END`
    : "COALESCE(disc, recv)";
  return `WITH wi AS (SELECT DISTINCT document_id FROM FUND_ADMIN.DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM WHERE firm_id = '${firmId}'),
    nda AS (
      SELECT r.attributes:metadata:disclosing_party:name:value::string AS disc,
             r.attributes:metadata:receiving_party:name:value::string AS recv,
             COALESCE(TRY_TO_DATE(r.attributes:metadata:effective_date:value::string),
                      TRY_TO_DATE(r.attributes:metadata:executed_date:value::string)) AS start_date,
             TRY_TO_NUMBER(r.attributes:term:initial_term:value::string) AS term_num,
             r.attributes:term:initial_term:unit::string AS term_unit,
             COALESCE(r.attributes:transaction:non_solicitation:present:value::boolean, FALSE) AS non_solicitation,
             COALESCE(r.attributes:transaction:contact_restrictions:present:value::boolean, FALSE) AS contact_restrictions,
             COALESCE(r.attributes:specialized:non_circumvention:value::boolean, FALSE) AS non_circumvention
      FROM FUND_ADMIN.DOCUMENT_AI_RECORD r
      WHERE r.document_type = 'nda' AND r.firm_id = '${firmId}'
        AND (NOT EXISTS (SELECT 1 FROM wi) OR r.document_id IN (SELECT document_id FROM wi))
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY COALESCE(r.attributes:metadata:disclosing_party:name:value::string, '')
          || '|' || COALESCE(r.attributes:metadata:receiving_party:name:value::string, '')
          || '|' || COALESCE(r.attributes:metadata:effective_date:value::string, '')
          || '|' || COALESCE(r.attributes:metadata:executed_date:value::string, '')
          || '|' || COALESCE(r.attributes:term:initial_term:text::string, '')
          || '|' || COALESCE(r.attributes:governing:governing_law:value::string, '')
        ORDER BY r.document_id) = 1),
    calc AS (
      SELECT COALESCE(${counterparty}, 'Unknown') AS counterparty,
             DATEADD(month, CASE WHEN term_unit ILIKE 'year%' THEN term_num * 12
                                 WHEN term_unit ILIKE 'month%' THEN term_num
                                 WHEN term_unit ILIKE 'day%' THEN CEIL(term_num / 30) END, start_date) AS expiry,
             (non_solicitation OR contact_restrictions OR non_circumvention) AS restricts
      FROM nda)
    SELECT 'kpi' AS kind, NULL AS counterparty, NULL AS expiry, COUNT(*) AS total_ndas,
           COUNT(DISTINCT IFF(restricts AND (expiry IS NULL OR expiry >= CURRENT_DATE), counterparty, NULL)) AS restricted_companies
    FROM calc
    UNION ALL
    SELECT * FROM (
      SELECT 'expiring', counterparty, expiry, NULL, NULL FROM calc
      WHERE expiry >= CURRENT_DATE AND expiry < DATEADD(month, ${NDA_EXPIRING_MONTHS}, CURRENT_DATE)
      ORDER BY expiry LIMIT ${NDA_CARD_ROWS})`;
}

const ndaCount = (n, one, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function renderNdaCard(kpi, expiring) {
  const rows = document.getElementById("nda-rows");
  if (rows) {
    rows.innerHTML = expiring.length
      ? expiring.map(r => `<div class="tbl-row">
          <span class="tbl-col-name"><span class="lp-name" title="${escHtml(r.COUNTERPARTY)}">${escHtml(r.COUNTERPARTY)}</span></span>
          <span class="tbl-col-lp">${escHtml(fmtDate(String(r.EXPIRY).slice(0, 10)))}</span>
        </div>`).join("")
      : `<div class="loading-row">None of your NDAs expire in the next ${NDA_EXPIRING_MONTHS / 12} years.</div>`;
  }
  const note = document.getElementById("nda-note");
  if (note) {
    note.textContent = `${ndaCount(kpi.total, "NDA")} · ${ndaCount(kpi.restricted, "company", "companies")} under an active restriction`;
    note.hidden = false;
  }
}

let _ndaLoading = false;
async function fetchNdaSummary(firmId = _segment.firmId) {
  if (_ndaLoading) return;
  _ndaLoading = true;
  try {
    const res = await _mcp("read_tool", {
      name: "dwh__execute__query",
      arguments: { sql: ndaSummarySql(firmOwnName(), firmId), format: "ndjson", response_mode: "inline" },
    });
    if (res.isError) throw new Error("NDA summary query failed");
    const rows = parseDWH(res);
    const kpiRow = rows.find(r => r.KIND === "kpi") || {};
    const kpi = {
      total: parseInt(kpiRow.TOTAL_NDAS, 10) || 0,
      restricted: parseInt(kpiRow.RESTRICTED_COMPANIES, 10) || 0,
    };
    if (kpi.total > 0) renderNdaCard(kpi, rows.filter(r => r.KIND === "expiring"));
    settleDashboardCard("nda", kpi.total > 0);
  } catch (e) {
    console.error("[carta-home] NDA summary failed", e);
    failDashboardCard("nda");
  } finally {
    _ndaLoading = false;
  }
}
