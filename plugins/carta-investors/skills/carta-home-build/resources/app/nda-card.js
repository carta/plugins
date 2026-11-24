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
// Words left out of the firm's initials.
const NDA_INITIALS_SKIP = new Set(["llc", "lp", "ltd", "inc", "the", "and", "of"]);

// The firm's name as lower-case words, as nda_data_model.md → Counterparty cleans it: no
// parentheticals; dots, wildcards and backslashes deleted ("L.P." → "lp"); other punctuation and
// regex characters split words; quotes doubled for the SQL literal.
function ndaNameWords(firmName) {
  return String(firmName || "")
    .replace(/\(.*?\)/g, " ")
    .toLowerCase()
    .replace(/[.%_\\]/g, "")
    .replace(/[,*+?^$(){}[\]|]/g, " ")
    .replace(/'/g, "''")
    .split(/\s+/)
    .filter(Boolean);
}

// The distinctive core of the firm's name: "Acme Capital Partners, LP" → "acme".
function ndaFirmToken(firmName) {
  return ndaNameWords(firmName).filter(word => !NDA_NAME_SUFFIXES.has(word)).join(" ");
}

// Initials that are really entity or legal abbreviations ("Lion Lake Capital" → LLC) would mark
// almost every counterparty as the firm, so they are never used.
const NDA_INITIALS_RESERVED = new Set([
  "LLC", "LLP", "PLC", "INC", "LTD", "CORP", "USA", "PLLC", "LLLP", "PTE", "PTY", "SAS", "SARL", "SRL", "SPA", "GMBH",
  "SDN", "BHD", "LTDA",
]);

// The firm's initials from its first word through each later one, three letters or more, in
// capitals: "Great Basin Capital Partners" → "GBC|GBCP". Only words that start with a letter count,
// so the result holds nothing but A-Z and "|".
function ndaFirmInitials(firmName) {
  const letters = ndaNameWords(firmName)
    .filter(word => /^[a-z]/.test(word) && !NDA_INITIALS_SKIP.has(word))
    .map(word => word[0].toUpperCase());
  const names = [];
  for (let n = 3; n <= letters.length; n++) {
    const name = letters.slice(0, n).join("");
    if (!NDA_INITIALS_RESERVED.has(name)) names.push(name);
  }
  return names.join("|");
}

// One `kpi` row (every NDA, and the companies under a restriction that binds the firm and is
// still in force, as the NDA dashboard counts them) and up to NDA_CARD_ROWS `expiring` rows. The
// Carta MCP scopes both tables to the active firm; the firm filter keeps the card on this firm
// even if pinning it with set_context failed.
function ndaSummarySql(firmName, firmId) {
  const token = ndaFirmToken(firmName);
  const initials = ndaFirmInitials(firmName);
  // An empty token or initials would match every party, so that test reads FALSE.
  const isFirm = party => `COALESCE(${token
    ? `REGEXP_INSTR(${party}, '(^|[^a-z0-9])(${token})($|[^a-z0-9])', 1, 1, 0, 'i') > 0` : "FALSE"}
      OR ${initials
    ? `REGEXP_INSTR(${party}, '(^|[^A-Za-z0-9])(${initials})($|[^A-Za-z0-9])', 1, 1, 0, 'c') > 0` : "FALSE"}, FALSE)`;
  return `WITH wi AS (SELECT DISTINCT document_id FROM FUND_ADMIN.DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM WHERE firm_id = '${firmId}'),
    nda AS (
      SELECT r.attributes:metadata:disclosing_party:name:value::string AS disc,
             r.attributes:metadata:receiving_party:name:value::string AS recv,
             r.attributes:metadata:confidentiality_direction:value::string AS nda_direction,
             COALESCE(TRY_TO_DATE(r.attributes:metadata:effective_date:value::string),
                      TRY_TO_DATE(r.attributes:metadata:executed_date:value::string)) AS start_date,
             TRY_TO_NUMBER(r.attributes:term:initial_term:value::string) AS term_num,
             r.attributes:term:initial_term:unit::string AS term_unit,
             r.attributes:term:initial_term_start:value::string AS term_start,
             COALESCE(r.attributes:transaction:non_solicitation:present:value::boolean, FALSE) AS non_solicitation,
             TRY_TO_NUMBER(r.attributes:transaction:non_solicitation:duration:value::string) AS non_solicitation_num,
             r.attributes:transaction:non_solicitation:duration:unit::string AS non_solicitation_unit,
             r.attributes:transaction:non_solicitation:duration_start:value::string AS non_solicitation_start,
             COALESCE(r.attributes:transaction:contact_restrictions:present:value::boolean, FALSE) AS contact_restrictions,
             COALESCE(r.attributes:transaction:standstill:present:value::boolean, FALSE) AS standstill,
             TRY_TO_NUMBER(r.attributes:transaction:standstill:duration:value::string) AS standstill_num,
             r.attributes:transaction:standstill:duration:unit::string AS standstill_unit,
             r.attributes:transaction:standstill:duration_start:value::string AS standstill_start,
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
      SELECT ${isFirm("disc")} AS disc_is_firm,
             ${isFirm("recv")} AS recv_is_firm,
             COALESCE(CASE WHEN disc_is_firm THEN recv WHEN recv_is_firm THEN disc ELSE COALESCE(disc, recv) END, 'Unknown') AS counterparty,
             DATEADD(month, CASE WHEN term_unit ILIKE 'year%' THEN term_num * 12
                                 WHEN term_unit ILIKE 'month%' THEN term_num
                                 WHEN term_unit ILIKE 'week%' THEN CEIL(term_num * 7 / 30)
                                 WHEN term_unit ILIKE 'day%' THEN CEIL(term_num / 30) END, start_date) AS expiry,
             NOT (COALESCE(nda_direction, '') ILIKE 'one%' AND disc_is_firm AND NOT recv_is_firm) AS binds_firm,
             CASE
               WHEN non_solicitation_unit ILIKE 'year%'  THEN non_solicitation_num * 12
               WHEN non_solicitation_unit ILIKE 'month%' THEN non_solicitation_num
               WHEN non_solicitation_unit ILIKE 'week%'  THEN CEIL(non_solicitation_num * 7 / 30)
               WHEN non_solicitation_unit ILIKE 'day%'   THEN CEIL(non_solicitation_num / 30)
             END AS non_solicitation_months,
             CASE
               WHEN standstill_unit ILIKE 'year%'  THEN standstill_num * 12
               WHEN standstill_unit ILIKE 'month%' THEN standstill_num
               WHEN standstill_unit ILIKE 'week%'  THEN CEIL(standstill_num * 7 / 30)
               WHEN standstill_unit ILIKE 'day%'   THEN CEIL(standstill_num / 30)
             END AS standstill_months,
             COALESCE(DATEADD(month, non_solicitation_months,
               IFF(non_solicitation_start = 'Termination Or Expiry', expiry, start_date)), expiry) AS non_solicitation_until,
             COALESCE(DATEADD(month, standstill_months,
               IFF(standstill_start = 'Termination Or Expiry', expiry, start_date)), expiry) AS standstill_until,
             COALESCE(term_start <> 'Effective Date', FALSE) AS expiry_estimated,
             (non_solicitation_months IS NOT NULL
               AND NOT COALESCE(non_solicitation_start IN ('Effective Date', 'Termination Or Expiry'), FALSE))
               OR (expiry_estimated AND (non_solicitation_months IS NULL
               OR non_solicitation_start = 'Termination Or Expiry')) AS non_solicitation_estimated,
             (standstill_months IS NOT NULL
               AND NOT COALESCE(standstill_start IN ('Effective Date', 'Termination Or Expiry'), FALSE))
               OR (expiry_estimated AND (standstill_months IS NULL
               OR standstill_start = 'Termination Or Expiry')) AS standstill_estimated,
             non_solicitation AND binds_firm
               AND (non_solicitation_until IS NULL OR non_solicitation_until >= CURRENT_DATE) AS non_solicitation_in_force,
             contact_restrictions AND binds_firm AND (expiry IS NULL OR expiry >= CURRENT_DATE) AS contact_restrictions_in_force,
             non_circumvention AND binds_firm AND (expiry IS NULL OR expiry >= CURRENT_DATE) AS non_circumvention_in_force,
             standstill AND binds_firm
               AND (standstill_until IS NULL OR standstill_until >= CURRENT_DATE) AS standstill_in_force,
             non_solicitation_in_force OR contact_restrictions_in_force OR non_circumvention_in_force
               OR standstill_in_force AS restriction_in_force
      FROM nda)
    SELECT 'kpi' AS kind, NULL AS counterparty, NULL AS expiry, COUNT(*) AS total_ndas,
           COUNT(DISTINCT IFF(restriction_in_force, counterparty, NULL)) AS restricted_companies
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
