// Financial Reporting Tracker: one card per reporting period that needs the GP.
// Depends on carta-workhub.app.js (_mcp, escHtml, trackWorkhub) and fund-admin-requests.js (overlay, queue).

// A build can name one period so the panel is reachable for a demo. Empty is normal;
// an unsubstituted {{...}} means this source is read outside a build.
const frtBuildValue = (v) => (/^\{\{.*\}\}$/.test(v) ? "" : v);
const FRT_SEED_PERIOD = frtBuildValue("{{FRT_SEED_PERIOD}}");   // e.g. "Q2 2026"

const FRT_COMMAND = "fa:get:reporting-status";
const FRT_CARD_TITLE = "Financial reporting";

// The page's window: the active quarter plus the three before it, never earlier
// than Q3 2023. Same rule as fund-admin's getReportingPeriods().
const FRT_FIRST_PERIOD = { period: "Q3", year: 2023 };
const FRT_LEAD_UP_DAYS = 15;   // a quarter becomes reportable this many days before the next starts

const FRT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function frtQuarterOf(period) { return { Q1: 1, Q2: 2, Q3: 3, Q4: 4, YEARLY: 4 }[period] ?? 4; }
function frtPeriodOf(quarter) { return ["Q1", "Q2", "Q3", "Q4"][quarter - 1]; }
function frtQuarterEnd(quarter, year) {
  return new Date(Date.UTC(year, [2, 5, 8, 11][quarter - 1], [31, 30, 30, 31][quarter - 1]));
}
function frtPreviousPeriod({ period, year }) {
  const q = frtQuarterOf(period);
  return q === 1 ? { period: "Q4", year: year - 1 } : { period: frtPeriodOf(q - 1), year };
}

// The quarter in progress once it is within FRT_LEAD_UP_DAYS of ending, else the one before.
function frtActivePeriod(now) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const quarter = Math.floor(today.getUTCMonth() / 3) + 1;
  const year = today.getUTCFullYear();
  const availability = frtQuarterEnd(quarter, year);
  availability.setUTCDate(availability.getUTCDate() + 1 - FRT_LEAD_UP_DAYS);
  const current = { period: frtPeriodOf(quarter), year };
  return today < availability ? frtPreviousPeriod(current) : current;
}

function frtPeriodWindow(now) {
  let cursor = frtActivePeriod(now || new Date());
  const out = [cursor];
  for (let i = 0; i < 3; i += 1) {
    if (cursor.period === FRT_FIRST_PERIOD.period && cursor.year === FRT_FIRST_PERIOD.year) break;
    cursor = frtPreviousPeriod(cursor);
    out.unshift(cursor);
  }
  return out;
}

// "Q4-YE 2025": the page names the fourth quarter as the year-end one.
function frtPeriodLabel({ period, year }) {
  return (period === "Q4" || period === "YEARLY") ? `Q4-YE ${year}` : `${period} ${year}`;
}
function frtPeriodKey({ period, year }) { return `${year}-${period}`; }
function frtParsePeriodLabel(label) {
  const m = /^(Q[1-4])(?:-YE)?\s+(\d{4})$/.exec(String(label || "").trim());
  return m ? { period: m[1], year: Number(m[2]) } : null;
}

// "2026-08-12" -> "Aug 12", the page's DISPLAY_DATE_FORMAT. ISO dates only, so no zone shift.
function frtDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${FRT_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : String(iso);
}
function frtSuffix(iso) { const d = frtDate(iso); return d ? `· ${d}` : null; }
// "2026-08-14" -> "14 Aug", the card footer's day-first form. A bare date never goes through
// Date, which would read it as UTC midnight and shift it a day in western zones.
function frtDayMonth(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${Number(m[3])} ${FRT_MONTHS[Number(m[2]) - 1]}` : null;
}

// ── Cell rules, ported from fund_admin/gpx/financial_reporting_tracker/mappers/ ──
// Only a needs-action cell is a link; an unknown code falls to the column's Carta-side label.

const frtStatusCell = (text, state, variant, suffix) => ({ kind: "status", state, variant, text, suffix: suffix || null });
const frtDone = (text, suffix) => frtStatusCell(text, "done", "positive", suffix);
const frtWithCarta = (text) => frtStatusCell(text, "with_carta", "neutral");
const frtAction = (text, href, isPrimary = false, variant = "notice") => ({ kind: "action", state: "needs_action", variant, text, href, isPrimary });
const frtInactive = (text) => ({ kind: "inactive", state: "not_applicable", variant: "neutral", text });
const FRT_EMPTY_CELL = { kind: "empty", state: "not_applicable", variant: "neutral", text: "" };
const frtHidden = (state) => ({ kind: "hidden", state, variant: "neutral", text: "" });

function frtMapCashReconciliation(o) {
  switch (o.code) {
    case "missing_info":
      if (o.href) return frtAction("Add missing info", o.href, false, "negative");
      return (o.unreconciled_txn_count > 0) ? frtWithCarta("Carta reconciling") : frtDone("Reconciled", frtSuffix(o.last_reconciled_on));
    case "carta_reconciling":
    case "unreconciled_untracked":
      return frtWithCarta("Carta reconciling");
    default:
      return frtDone("Reconciled", frtSuffix(o.last_reconciled_on));
  }
}

function frtMapSoiReview(o) {
  switch (o.code) {
    case "entity_ineligible": return frtInactive("N/A");
    case "awaiting_gp_valuations": if (o.href) return frtAction("Update valuations", o.href); break;
    case "approved": return frtDone("Approved", frtSuffix(o.approved_on));
    default: break;
  }
  return frtWithCarta("Carta reviewing changes");
}

function frtMapFinancialReport(o) {
  switch (o.code) {
    case "not_started": return frtInactive("Not started");
    case "awaiting_gp_review": if (o.href) return frtAction("Review draft", o.href, true); break;
    case "carta_actioning_gp_changes": return frtWithCarta("Carta reviewing changes");
    case "with_auditor": return frtWithCarta("With auditor");
    case "awaiting_gp_publish": return o.href ? frtAction("Schedule publish", o.href, true) : frtDone("Approved");
    case "approved_scheduled": { const w = frtDate(o.scheduled_publish_on); return frtDone(w ? `Approved - publishing ${w}` : "Approved"); }
    case "approved_carta_publishes":
    case "covered_by_family_package": return frtDone("Approved");
    case "published": { const w = frtDate(o.published_on); return frtDone(w ? `Published on ${w}` : "Published"); }
    case "approved_wont_publish": { const w = frtDate(o.published_on); return frtDone(w ? `Approved on ${w} but not to be published` : "Approved - not publishing"); }
    default: break;
  }
  return frtWithCarta("Carta preparing");
}

const FRT_VIEW_REPORT_CODES = ["published", "approved_wont_publish"];

// A View report button takes the cell and its text moves to the trailing note.
// A family member never carries the button.
function frtMapFinancialReportColumns(o, isFamilyChild) {
  const cell = frtMapFinancialReport(o);
  const action = (!isFamilyChild && o.href && FRT_VIEW_REPORT_CODES.includes(o.code)) ? { text: "View report", href: o.href } : null;
  if (action) return { cell: frtHidden(cell.state), action, trailingNote: cell.text };
  return { cell, action: null, trailingNote: null };
}

function frtDeadlineNote(days, source, period) {
  if (days == null || source === "workflow") return null;
  const annual = period === "Q4" || period === "YEARLY";
  return `${days} ${days === 1 ? "day" : "days"} from ${annual ? "year-end" : "qtr-end"}`;
}

// ── Rows, as the page's service builds them ────────────────────────────────

const FRT_FUND_TYPES = ["FUND", "SPV", "SYNDICATE_SPV"];

function frtBuildRows(p) {
  const byFamily = {};
  (p.entities || []).forEach(e => {
    if (e.family_id) (byFamily[e.family_id] = byFamily[e.family_id] || []).push(e);
  });
  const rows = [];
  (p.entities || []).filter(e => !e.family_id).forEach(e => {
    const fr = frtMapFinancialReportColumns(e.financial_report || {}, false);
    rows.push({
      id: String(e.entity_id), name: e.entity_name, sub: null,
      group: FRT_FUND_TYPES.includes(e.entity_type) ? "funds" : "gp",
      due: e.due_date, note: frtDeadlineNote(e.due_date_days, e.due_date_source, p.reporting_period),
      cash: frtMapCashReconciliation(e.cash_reconciliation || {}),
      soi: frtMapSoiReview(e.soi_review || {}),
      fr: fr.cell, action: fr.action, trailing: fr.trailingNote, children: [],
    });
  });
  (p.families || []).forEach(f => {
    const members = byFamily[f.family_id] || [];
    const fr = frtMapFinancialReportColumns(f.financial_report || {}, false);
    rows.push({
      id: `family-${f.family_id}`, name: f.family_name,
      sub: `Fund family · ${members.length} ${members.length === 1 ? "fund" : "funds"}`,
      group: "funds", isFamily: true,
      due: f.due_date, note: frtDeadlineNote(f.due_date_days, f.due_date_source, p.reporting_period),
      // Cash reconciliation and the SOI exist per member fund only.
      cash: FRT_EMPTY_CELL, soi: FRT_EMPTY_CELL,
      fr: fr.cell, action: fr.action, trailing: fr.trailingNote,
      children: members.map(m => ({
        id: String(m.entity_id), name: m.entity_name,
        due: m.due_date, note: frtDeadlineNote(m.due_date_days, m.due_date_source, p.reporting_period),
        cash: frtMapCashReconciliation(m.cash_reconciliation || {}),
        soi: frtMapSoiReview(m.soi_review || {}),
        fr: frtMapFinancialReportColumns(m.financial_report || {}, true).cell,
      })),
    });
  });
  return rows;
}

const FRT_RANK = { needs_action: 0, with_carta: 1, done: 2, not_applicable: 3 };
const FRT_SORTS = [
  { key: "due_date", label: "Reporting Deadline", caption: d => `Sorted by reporting deadline, ${d === "ascending" ? "soonest" : "latest"} first.` },
  { key: "entity_name", label: "Entity name", caption: d => `Sorted by entity name, ${d === "ascending" ? "A–Z" : "Z–A"}.` },
  { key: "cash_reconciliation", label: "Cash Reconciliation", caption: () => "Sorted by cash reconciliation." },
  { key: "soi_review", label: "SOI Review", caption: () => "Sorted by SOI review." },
  { key: "financial_report", label: "Financial Report", caption: () => "Sorted by financial report." },
];
const frtNatCmp = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
function frtRowState(row, key) {
  const c = { cash_reconciliation: row.cash, soi_review: row.soi, financial_report: row.fr }[key];
  return c ? c.state : "not_applicable";
}

// Mirrors the page's ordering.py: undated rows, not-applicable cells and family parents
// stay at the end in BOTH directions, so a reversal never lifts them to the top.
function frtSortRows(rows, sort) {
  const dir = sort.direction === "ascending" ? 1 : -1;
  const byName = rows.slice().sort((a, b) => frtNatCmp(a.name, b.name));
  if (sort.key === "entity_name") return dir === 1 ? byName : byName.reverse();
  if (sort.key === "due_date") {
    const dated = byName.filter(r => r.due).sort((a, b) => dir * String(a.due).localeCompare(String(b.due)) || frtNatCmp(a.name, b.name));
    return dated.concat(byName.filter(r => !r.due));
  }
  const parents = byName.filter(r => r.isFamily);
  const members = byName.filter(r => !r.isFamily);
  const notApplicable = members.filter(r => FRT_RANK[frtRowState(r, sort.key)] === FRT_RANK.not_applicable);
  const ranked = members.filter(r => FRT_RANK[frtRowState(r, sort.key)] !== FRT_RANK.not_applicable)
    .sort((a, b) => dir * (FRT_RANK[frtRowState(a, sort.key)] - FRT_RANK[frtRowState(b, sort.key)]) || frtNatCmp(a.name, b.name));
  return ranked.concat(notApplicable, parents);
}

function frtNeedsAction(r) {
  return [r.cash, r.soi, r.fr].some(c => c && c.state === "needs_action") || (r.children || []).some(frtNeedsAction);
}

function frtFilterRows(rows, st) {
  const q = String(st.search || "").trim().toLowerCase();
  return rows.filter(r =>
    (!st.statusFilter || frtNeedsAction(r)) &&
    (!q || String(r.name).toLowerCase().includes(q) || (r.children || []).some(c => String(c.name).toLowerCase().includes(q))));
}

// ── Reading ────────────────────────────────────────────────────────────────

const _frtPayloads = {};   // period key -> payload; a period is read once per session

function frtPayload(res) {
  for (const c of _mcpResultCandidates(res)) {
    if (c && Array.isArray(c.entities) && c.rollup) return c;
  }
  return null;
}

function frtErrorText(res) {
  const text = res && Array.isArray(res.content) ? res.content.find(c => c && c.type === "text")?.text : null;
  return text || "Carta did not return the tracker for this period.";
}

// A refused period (flag off, firm unreadable) resolves to null, so it never hides the others.
async function frtFetchPeriod(p) {
  const key = frtPeriodKey(p);
  if (_frtPayloads[key]) return _frtPayloads[key];
  if (!_benchmarkFirmId) return null;
  const res = await _mcp("fetch", {
    command: FRT_COMMAND,
    params: { firm_uuid: _benchmarkFirmId, period: p.period, year: p.year },
  });
  if (!res || res.isError) {
    console.error("[frt] tracker read failed —", frtErrorText(res));
    return null;
  }
  const payload = frtPayload(res);
  if (!payload) {
    console.error("[frt] tracker read carried no payload —", res);
    return null;
  }
  _frtPayloads[key] = payload;
  return payload;
}

// What the card's second line says: the GP's open items by column.
function frtNeedsSummary(payload) {
  const rows = frtBuildRows(payload);
  const flat = rows.flatMap(r => [r].concat(r.children || []));
  const count = (pick) => flat.filter(r => { const c = pick(r); return c && c.state === "needs_action"; }).length;
  const packages = count(r => r.fr);
  const cash = count(r => r.cash);
  const soi = count(r => r.soi);
  const parts = [];
  if (packages) parts.push(`${packages} ${packages === 1 ? "package" : "packages"} to review`);
  if (cash) parts.push(`${cash} cash reconciliation ${cash === 1 ? "item" : "items"}`);
  if (soi) parts.push(`${soi} SOI ${soi === 1 ? "review" : "reviews"}`);
  return parts.join(" · ");
}

// The soonest deadline among the rows that need the GP, for the card footer.
function frtNextDue(payload) {
  const due = frtBuildRows(payload)
    .flatMap(r => [r].concat(r.children || []))
    .filter(r => frtNeedsAction(r) && r.due)
    .map(r => String(r.due))
    .sort();
  return due[0] || null;
}

function frtFirmCartaId(payload) {
  if (payload && payload.firm_carta_id != null) return String(payload.firm_carta_id);
  const m = JSON.stringify(payload || {}).match(/\/investors\/firm\/(\d+)\//);
  return m ? m[1] : null;
}

// The tracker page for one period, on the same host the row hrefs point at.
function frtDeepLink(payload, p) {
  const firm = frtFirmCartaId(payload);
  const hrefs = JSON.stringify(payload || {}).match(/https?:\/\/[^/"]+/);
  if (!firm || !hrefs) return null;
  const quarter = p.period === "YEARLY" ? "Q4" : p.period;
  return `${hrefs[0]}/investors/firm/${firm}/portfolio/gp-activity/financial-report-tracker/${p.year}/${quarter}`;
}

function frtCardFor(p, payload, seeded) {
  const label = frtPeriodLabel(p);
  const summary = payload ? frtNeedsSummary(payload) : "";
  const nextDue = payload ? frtNextDue(payload) : null;
  return {
    id: `frt-${frtPeriodKey(p)}`,
    title: `${FRT_CARD_TITLE} — ${label}`,
    subtitle: summary || (seeded ? "Nothing needs your action" : null),
    firm: null,
    group: "todo",
    // The GP owes a step on at least one row.
    state: "pending-customer",
    canceled: false,
    needsTitle: false,
    requested: null,
    lastActivity: null,
    footnote: nextDue ? `Due ${frtDayMonth(nextDue)}` : null,
    webUrl: payload ? frtDeepLink(payload, p) : null,
    frt: { period: p.period, year: p.year, label },
  };
}

// A card exists for each period that owes the GP a step, plus the build seed.
async function frtFetchPeriodRows(now) {
  if (!_benchmarkFirmId) return [];
  const periods = frtPeriodWindow(now);
  const seed = frtParsePeriodLabel(FRT_SEED_PERIOD);
  if (seed && !periods.some(p => frtPeriodKey(p) === frtPeriodKey(seed))) periods.push(seed);
  const payloads = await Promise.all(periods.map(p => frtFetchPeriod(p).catch(e => {
    console.error("[frt] tracker read threw —", e);
    return null;
  })));
  const rows = [];
  periods.forEach((p, i) => {
    const payload = payloads[i];
    const seeded = !!seed && frtPeriodKey(seed) === frtPeriodKey(p);
    const owed = payload && payload.rollup && Number(payload.rollup.needs_action) > 0;
    if (owed || seeded) rows.push(frtCardFor(p, payload, seeded));
  });
  return rows;
}

// Newest period first; a card the queue already carries is not duplicated.
function frtWithPeriodRows(rows, periodRows) {
  const have = new Set((rows || []).map(r => r.id));
  const fresh = (periodRows || []).filter(r => !have.has(r.id))
    .sort((a, b) => (b.frt.year - a.frt.year) || (frtQuarterOf(b.frt.period) - frtQuarterOf(a.frt.period)));
  return fresh.concat(rows || []);
}

async function frtAttachPeriodRows() {
  const periodRows = await frtFetchPeriodRows();
  if (!periodRows.length) return false;
  _farRows = frtWithPeriodRows(_farRows || [], periodRows);
  return true;
}

// ── Panel state ────────────────────────────────────────────────────────────

let _frt = null;

function frtReset(target, title) {
  _frt = {
    period: { period: target.period, year: target.year },
    title: title || FRT_CARD_TITLE,
    window: frtPeriodWindow(),
    payload: null,
    loading: true,
    error: null,
    search: "",
    statusFilter: null,
    sort: { key: "due_date", direction: "ascending" },
    openFamilies: {},
    menu: null,
  };
  const key = frtPeriodKey(_frt.period);
  if (!_frt.window.some(p => frtPeriodKey(p) === key)) _frt.window.push(_frt.period);
}

async function frtLoad() {
  const snap = _frt;
  if (!snap) return;
  snap.loading = true; snap.error = null; snap.payload = null;
  frtRender();
  let payload = null;
  try {
    payload = await frtFetchPeriod(snap.period);
  } catch (e) {
    console.error("[frt] tracker read threw —", e);
  }
  if (_frt !== snap) return;
  snap.loading = false;
  if (payload) snap.payload = payload;
  else snap.error = "We could not load the tracker for this period. Try again, or pick another period.";
  frtRender();
}

function frtSelectPeriod(p) {
  if (!_frt) return;
  _frt.period = { period: p.period, year: p.year };
  _frt.openFamilies = {};
  _frt.menu = null;
  frtLoad();
}

// ── Rendering ──────────────────────────────────────────────────────────────

const FRT_DOC_ICON = '<svg class="frt-doc-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6 8h4M6 10.5h4"/></svg>';

function frtLink(href, cls, inner) {
  return `<a class="${cls}" href="${escHtml(href)}" target="_blank" rel="noopener" data-frt-action>${inner}</a>`;
}

function frtRenderCell(c) {
  if (!c || c.kind === "hidden") return "";
  if (c.kind === "empty") return '<span class="frt-em">—</span>';
  if (c.kind === "inactive") return `<span class="frt-gray">${escHtml(c.text)}</span>`;
  const suffix = c.suffix ? ` <span class="frt-suffix">${escHtml(c.suffix)}</span>` : "";
  if (c.kind === "action") {
    const inner = c.isPrimary ? escHtml(c.text) : `<span class="frt-dot frt-dot-${c.variant}"></span>${escHtml(c.text)}`;
    return frtLink(c.href, `frt-btn${c.isPrimary ? " frt-btn-primary" : ""}`, inner);
  }
  const textCls = c.state === "with_carta" ? "frt-cell-text frt-gray" : "frt-cell-text";
  return `<span class="frt-cell"><span class="frt-dot frt-dot-${c.variant}"></span><span class="${textCls}">${escHtml(c.text)}${suffix}</span></span>`;
}

function frtRenderFinancialReport(row) {
  const btn = row.action ? frtLink(row.action.href, "frt-btn", `${FRT_DOC_ICON}&nbsp;${escHtml(row.action.text)}`) : "";
  return `<div class="frt-fr">${frtRenderCell(row.fr)}${btn}</div>`;
}

function frtRenderRow(row, isChild) {
  const open = !!_frt.openFamilies[row.id];
  const twiddle = row.isFamily
    ? `<button class="frt-twiddle" type="button" data-frt-family="${escHtml(row.id)}" aria-label="${open ? "Collapse" : "Expand"} ${escHtml(row.name)}">${open ? "▾" : "▸"}</button>`
    : "";
  const due = row.due ? `<div class="frt-due">${escHtml(frtDate(row.due))}</div>` : '<div class="frt-em">—</div>';
  return `<tr class="${isChild ? "frt-child" : ""}">
    <td class="frt-c-twiddle">${isChild ? "" : twiddle}</td>
    <td class="frt-c-entity"><div class="frt-ent">${escHtml(row.name)}</div>${row.sub ? `<div class="frt-sub">${escHtml(row.sub)}</div>` : ""}</td>
    <td class="frt-c-due">${due}${row.note ? `<div class="frt-sub">${escHtml(row.note)}</div>` : ""}</td>
    <td class="frt-c-cash">${frtRenderCell(row.cash)}</td>
    <td class="frt-c-soi">${frtRenderCell(row.soi)}</td>
    <td class="frt-c-fr">${isChild ? frtRenderCell(row.fr) : frtRenderFinancialReport(row)}</td>
    <td class="frt-c-act">${row.trailing ? `<span class="frt-sub">${escHtml(row.trailing)}</span>` : ""}</td>
  </tr>`;
}

const FRT_COLUMN_HELP = {
  due_date: "The date this entity’s financial package is due to be published to investors, and the term that sets it — the fund’s own preference, or its LPA.",
  cash_reconciliation: "Whether the entity’s bank activity for the period has been reconciled.",
  soi_review: "Where the schedule of investments review stands.",
  financial_report: "Where the financial package stands, and the next step.",
};

function frtHeader(key, label) {
  const on = _frt.sort.key === key;
  const arrow = on ? `<span class="frt-chev">${_frt.sort.direction === "ascending" ? "↑" : "↓"}</span>` : "";
  const help = FRT_COLUMN_HELP[key] ? `<span class="frt-help" title="${escHtml(FRT_COLUMN_HELP[key])}">?</span>` : "";
  return `<th><button class="frt-sort" type="button" data-frt-sort="${key}">${escHtml(label)}${arrow}</button>${help}</th>`;
}

function frtRenderTable() {
  const all = frtBuildRows(_frt.payload);
  const shown = frtSortRows(frtFilterRows(all, _frt), _frt.sort);
  if (!shown.length) return '<div class="frt-empty">No entities match your filters.</div>';
  const families = shown.filter(r => r.isFamily);
  const allOpen = families.length > 0 && families.every(r => _frt.openFamilies[r.id]);
  let html = `<div class="frt-table-wrap"><table class="frt-table"><thead><tr>
    <th class="frt-c-twiddle"><button class="frt-twiddle" type="button" data-frt-expand-all aria-label="${allOpen ? "Collapse rows" : "Expand rows"}">${allOpen ? "⊟" : "⊞"}</button></th>
    ${frtHeader("entity_name", "Entity")}
    ${frtHeader("due_date", "Reporting Deadline")}
    ${frtHeader("cash_reconciliation", "Cash Reconciliation")}
    ${frtHeader("soi_review", "SOI Review")}
    ${frtHeader("financial_report", "Financial Report")}
    <th class="frt-c-act"></th></tr></thead><tbody>`;
  [["funds", "Funds & SPVs"], ["gp", "GP Entities & Management Companies"]].forEach(([g, title]) => {
    const rows = shown.filter(r => r.group === g);
    if (!rows.length) return;
    html += `<tr class="frt-group"><td colspan="7">${escHtml(title)} (${rows.length})</td></tr>`;
    rows.forEach(r => {
      html += frtRenderRow(r, false);
      if (r.isFamily && _frt.openFamilies[r.id]) r.children.forEach(c => { html += frtRenderRow(c, true); });
    });
  });
  return html + "</tbody></table></div>";
}

function frtRenderToolbar() {
  const activeSort = FRT_SORTS.find(s => s.key === _frt.sort.key) || FRT_SORTS[0];
  const trigger = _frt.statusFilter ? "Needs action" : `Sort by ${activeSort.label}`;
  const canReset = _frt.search || _frt.statusFilter || _frt.sort.key !== "due_date" || _frt.sort.direction !== "ascending";
  const periods = _frt.window.slice().reverse();
  return `<div class="frt-toolbar">
    <div class="frt-toolbar-left">
      <div class="frt-menu${_frt.menu === "sort" ? " frt-menu-open" : ""}">
        <button class="frt-btn frt-btn-md" type="button" data-frt-menu="sort" aria-haspopup="menu" aria-expanded="${_frt.menu === "sort"}">${escHtml(trigger)} <span class="frt-chev">▾</span></button>
        <div class="frt-menu-list" role="menu">
          <button class="frt-menu-item${!_frt.statusFilter ? " frt-menu-on" : ""}" type="button" data-frt-filter="all">View all</button>
          <button class="frt-menu-item${_frt.statusFilter ? " frt-menu-on" : ""}" type="button" data-frt-filter="needs">Needs action</button>
          <div class="frt-menu-sep"></div>
          ${FRT_SORTS.map(s => `<button class="frt-menu-item${_frt.sort.key === s.key ? " frt-menu-on" : ""}" type="button" data-frt-sort-key="${s.key}">${escHtml(s.label)}</button>`).join("")}
        </div>
      </div>
      <label class="frt-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search entities" placeholder="Search entities" value="${escHtml(_frt.search)}" data-frt-search></label>
      <button class="frt-btn frt-btn-link" type="button" data-frt-reset ${canReset ? "" : "disabled"}>Reset</button>
    </div>
    <div class="frt-menu${_frt.menu === "period" ? " frt-menu-open" : ""}">
      <button class="frt-btn frt-btn-md" type="button" data-frt-menu="period" aria-haspopup="menu" aria-expanded="${_frt.menu === "period"}">${escHtml(frtPeriodLabel(_frt.period))} <span class="frt-chev">▾</span></button>
      <div class="frt-menu-list frt-menu-right" role="menu">
        ${periods.map(p => `<button class="frt-menu-item${frtPeriodKey(p) === frtPeriodKey(_frt.period) ? " frt-menu-on" : ""}" type="button" data-frt-period="${frtPeriodKey(p)}">${escHtml(frtPeriodLabel(p))}</button>`).join("")}
      </div>
    </div>
  </div>
  <div class="frt-caption">${escHtml(activeSort.caption(_frt.sort.direction))}</div>`;
}

function frtRenderBody() {
  if (_frt.loading) return `<div class="loading-row">Reading the tracker for ${escHtml(frtPeriodLabel(_frt.period))}…</div>`;
  if (_frt.error || !_frt.payload) {
    return `<div class="frt-empty"><span>${escHtml(_frt.error || "We could not load the tracker for this period. Try again, or pick another period.")}</span><button class="frt-btn frt-btn-md" type="button" data-frt-retry>Try again</button></div>`;
  }
  return frtRenderTable();
}

function frtRender() {
  const overlay = document.getElementById("frt-overlay");
  if (!overlay || !_frt) return;
  const firm = _frt.payload ? _frt.payload.firm_name : "";
  const deep = _frt.payload ? frtDeepLink(_frt.payload, _frt.period) : null;
  overlay.innerHTML = `
    <div class="far-panel frt-panel" role="dialog" aria-label="Financial Reporting Tracker">
      <div class="far-panel-header frt-header">
        <span class="far-panel-title">Financial Reporting Tracker</span>
        ${firm ? `<span class="frt-firm">${escHtml(firm)}</span>` : ""}
        ${deep ? `<a class="frt-open-carta" href="${escHtml(deep)}" target="_blank" rel="noopener" data-frt-open-carta>Open in Carta ↗</a>` : ""}
        <button class="far-panel-close" type="button" aria-label="Close" data-frt-close>✕</button>
      </div>
      <div class="frt-body">
        <div class="frt-banner">
          <div class="frt-vignette" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/></svg></div>
          <div>
            <p class="frt-banner-head">Carta will prepare draft financial packages for you to review and approve prior to publishing to your investors.</p>
            <p class="frt-banner-body">To ensure timely and accurate completion please <b>take action</b> on the items below. This allows Carta to run an in-depth Internal Review and Auditor Review prior to making financials available for you to publish to your investors.</p>
          </div>
        </div>
        ${frtRenderToolbar()}
        ${frtRenderBody()}
      </div>
    </div>`;
  frtBind(overlay);
}

function frtBind(root) {
  root.querySelectorAll("[data-frt-close]").forEach(b => b.addEventListener("click", frtClose));
  root.querySelectorAll("[data-frt-open-carta]").forEach(a => a.addEventListener("click", () =>
    trackWorkhub("click", "CartaWorkhub.FinancialReportingTracker.OpenInCarta")));
  root.querySelectorAll("[data-frt-action]").forEach(a => a.addEventListener("click", () =>
    trackWorkhub("click", "CartaWorkhub.FinancialReportingTracker.Action")));
  root.querySelectorAll("[data-frt-menu]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    _frt.menu = _frt.menu === b.dataset.frtMenu ? null : b.dataset.frtMenu;
    frtRender();
  }));
  root.querySelectorAll("[data-frt-filter]").forEach(b => b.addEventListener("click", () => {
    _frt.statusFilter = b.dataset.frtFilter === "needs" ? "needs_action" : null;
    _frt.menu = null;
    frtRender();
  }));
  root.querySelectorAll("[data-frt-sort-key]").forEach(b => b.addEventListener("click", () => {
    _frt.sort = { key: b.dataset.frtSortKey, direction: "ascending" };
    _frt.menu = null;
    frtRender();
  }));
  root.querySelectorAll("[data-frt-sort]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.frtSort;
    _frt.sort = _frt.sort.key === k
      ? { key: k, direction: _frt.sort.direction === "ascending" ? "descending" : "ascending" }
      : { key: k, direction: "ascending" };
    frtRender();
  }));
  root.querySelectorAll("[data-frt-period]").forEach(b => b.addEventListener("click", () => {
    const p = _frt.window.find(w => frtPeriodKey(w) === b.dataset.frtPeriod);
    if (p) frtSelectPeriod(p);
  }));
  root.querySelectorAll("[data-frt-family]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.frtFamily;
    if (_frt.openFamilies[id]) delete _frt.openFamilies[id]; else _frt.openFamilies[id] = true;
    frtRender();
  }));
  root.querySelectorAll("[data-frt-expand-all]").forEach(b => b.addEventListener("click", () => {
    const fams = frtBuildRows(_frt.payload).filter(r => r.isFamily).map(r => r.id);
    const allOpen = fams.every(f => _frt.openFamilies[f]);
    _frt.openFamilies = {};
    if (!allOpen) fams.forEach(f => { _frt.openFamilies[f] = true; });
    frtRender();
  }));
  root.querySelectorAll("[data-frt-reset]").forEach(b => b.addEventListener("click", () => {
    _frt.search = ""; _frt.statusFilter = null; _frt.sort = { key: "due_date", direction: "ascending" };
    frtRender();
  }));
  root.querySelectorAll("[data-frt-retry]").forEach(b => b.addEventListener("click", () => frtLoad()));
  const input = root.querySelector("[data-frt-search]");
  if (input) {
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!_frt) return;
        _frt.search = input.value;
        const pos = input.selectionStart;
        frtRender();
        const again = root.querySelector("[data-frt-search]");
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* not a text input in every host */ } }
      }, 300);
    });
  }
  // A click inside the panel outside a menu only closes the menu.
  root.querySelectorAll(".frt-panel").forEach(panel => panel.addEventListener("click", ev => {
    if (_frt && _frt.menu && !ev.target.closest(".frt-menu")) { _frt.menu = null; frtRender(); }
  }));
}

// ── Open / close ───────────────────────────────────────────────────────────

function frtClose() {
  const o = document.getElementById("frt-overlay");
  if (o) o.classList.remove("far-overlay-visible");
  _frt = null;
  // The GP may have acted in Carta meanwhile, so the cards are re-read.
  Object.keys(_frtPayloads).forEach(k => { delete _frtPayloads[k]; });
  farFetchRequests();
}

function openFinancialReportingTracker(target, title) {
  trackWorkhub("click", "CartaWorkhub.FinancialReportingTracker.Open");
  frtReset(target, title);
  const overlay = farEnsureOverlay("frt-overlay", "far-overlay");
  overlay.classList.add("far-overlay-visible");
  frtRender();
  frtLoad();
}
