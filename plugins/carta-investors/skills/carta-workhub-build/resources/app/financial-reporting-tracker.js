// Financial Reporting Tracker: one card per reporting period that needs the GP.
// Depends on carta-workhub.app.js (_mcp, escHtml, trackWorkhub, mcpCommandAvailable, openClaudeChat)
// and fund-admin-requests.js (overlay, queue).

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
    case "approved_carta_publishes": return frtDone("Approved");
    // A covered fund-family member reads this whatever the combined package's state; the
    // family row carries that state and any button.
    case "covered_by_family_package": return frtInactive("In combined package");
    case "published": { const w = frtDate(o.published_on); return frtDone(w ? `Published on ${w}` : "Published"); }
    case "approved_wont_publish": { const w = frtDate(o.published_on); return frtDone(w ? `Approved on ${w} but not to be published` : "Approved - not publishing"); }
    default: break;
  }
  return frtWithCarta("Carta preparing");
}

// A row with two or more packages beneath it reads a status instead of a button: the
// buttons belong to the package children. Every other code reads as it would alone.
function frtMapFinancialReportRollup(o) {
  if (o.code === "awaiting_gp_review") return frtStatusCell("Awaiting your review", "needs_action", "notice");
  if (o.code === "awaiting_gp_publish") return frtStatusCell("Ready to publish", "needs_action", "notice");
  return frtMapFinancialReport(o);
}

const FRT_VIEW_REPORT_CODES = ["published", "approved_wont_publish"];

// A View report button takes the cell and its text moves to the trailing note.
function frtMapFinancialReportColumns(o) {
  const cell = frtMapFinancialReport(o);
  const action = (o.href && FRT_VIEW_REPORT_CODES.includes(o.code)) ? { text: "View report", href: o.href } : null;
  if (action) return { cell: frtHidden(cell.state), action, trailingNote: cell.text };
  return { cell, action: null, trailingNote: null };
}

function frtDeadlineNote(days, source, period) {
  if (days == null || source === "workflow") return null;
  const annual = period === "Q4" || period === "YEARLY";
  return `${days} ${days === 1 ? "day" : "days"} from ${annual ? "year-end" : "qtr-end"}`;
}

// ── Rows, as the page's service builds them ────────────────────────────────
//
// The rollup read and the package label ladder are both server-computed
// (family.financial_report reads over combined + members' own; every package
// carries display_label), so this only decides single- vs multi-package.

const FRT_FUND_TYPES = ["FUND", "SPV", "SYNDICATE_SPV"];

// A package as a row of its own: blank deadline and cash/SOI, its own read.
function frtPackageChild(pkg, rowId) {
  const cols = frtMapFinancialReportColumns(pkg.financial_report || {});
  return {
    id: `${rowId}:${pkg.package_id}`, name: pkg.display_label,
    due: null, note: null, cash: FRT_EMPTY_CELL, soi: FRT_EMPTY_CELL,
    fr: cols.cell, action: cols.action, trailing: cols.trailingNote,
    isPackage: true, isFamilyPackage: !!pkg.is_family_package, packages: [], children: [],
  };
}

// The Financial Report columns for a row over the packages beneath it, and the
// package children it lists when there are two or more.
function frtLeafColumns(financialReport, packages, rowId) {
  const list = packages || [];
  if (list.length >= 2) {
    return {
      fr: frtMapFinancialReportRollup(financialReport || {}), action: null, trailing: null,
      tag: `${list.length} packages`, packageChildren: list.map(p => frtPackageChild(p, rowId)),
    };
  }
  const cols = frtMapFinancialReportColumns(financialReport || {});
  return { fr: cols.cell, action: cols.action, trailing: cols.trailingNote, tag: null, packageChildren: [] };
}

// ── Task MCP Apps ──────────────────────────────────────────────────────────
//
// carta-mcp names the tracker columns whose tasks open in an MCP App for this viewer, and
// which entity field fills each of the app's params. The read is gated server-side, so a
// viewer it refuses gets none, and every cell keeps its Carta link.

const FRT_TASK_APPS_COMMAND = "fa:list:workhub-task-app";
// Row cell -> the tracker column it shows.
const FRT_CELL_COLUMNS = { cash: "cash_reconciliation", soi: "soi_review", fr: "financial_report" };

function frtTaskAppsByColumn(res) {
  if (!res || res.isError) return {};
  for (const c of _mcpResultCandidates(res)) {
    if (c && Array.isArray(c.apps)) {
      return Object.fromEntries(c.apps.filter(a => a && a.column && a.view).map(a => [a.column, a]));
    }
  }
  return {};
}

let _frtTaskApps = null;   // read once per page: the viewer's flags do not change while it is open
function frtTaskApps() {
  return _frtTaskApps ??= mcpCommandAvailable(FRT_TASK_APPS_COMMAND)
    .then(ok => (ok ? _mcp("fetch", { command: FRT_TASK_APPS_COMMAND, params: {} }) : null))
    .then(frtTaskAppsByColumn)
    .catch(() => ({}));
}

function frtColumnLabel(column) {
  return (FRT_SORTS.find(s => s.key === column) || {}).label || FRT_CARD_TITLE;
}

// Each view param filled from the field `paramMap` names on `source`; null when the source
// lacks one, since the view cannot be addressed without it.
function appParamsFrom(paramMap, source) {
  const params = {};
  for (const [param, field] of Object.entries(paramMap || {})) {
    if (source[field] == null) return null;
    params[param] = String(source[field]);
  }
  return params;
}

// Only a needs-action button opens an app, and only when the entity carries every field
// the app's params come from; anything else stays as it is.
function frtWithApp(cell, column, app, row, source) {
  if (!app || !cell || cell.kind !== "action") return cell;
  const params = appParamsFrom(app.params, source);
  if (!params) return cell;
  return Object.assign({}, cell, { app: { view: app.view, params, label: frtColumnLabel(column), entity: row.name } });
}

// Gives each cell its column's app, reading params off the row's own entity. A family row
// has no entity of its own, so it opens none; a package row reads its entity's fields.
function frtAttachApps(rows, payload, apps) {
  if (!apps || !Object.keys(apps).length) return rows;
  const entities = new Map((payload.entities || []).map(e => [String(e.entity_id), e]));
  const visit = (row, source) => {
    Object.entries(FRT_CELL_COLUMNS).forEach(([key, column]) => {
      row[key] = frtWithApp(row[key], column, apps[column], row, source);
    });
    (row.packages || []).forEach(p => visit(p, source));
    (row.children || []).forEach(c => visit(c, entities.get(c.id) || {}));
  };
  rows.forEach(r => visit(r, entities.get(r.id) || {}));
  return rows;
}

// What the new chat is prefilled with. It names the tool, view and params verbatim so
// Claude opens the app rather than answering in prose; the firm lets Claude switch to it
// if the chat's Carta context differs.
function frtAppPrompt(app, firm) {
  const where = firm ? ` (${firm})` : "";
  return `Open the Carta ${app.label} app for ${app.entity}${where}: call view_remote with name "${app.view}" and params ${JSON.stringify(app.params)}.`;
}

function frtIsExpandable(row) {
  return !!row.isFamily || (row.packages && row.packages.length > 0);
}

// Every expandable row is open; the button reads "collapse" only then.
function frtAllOpen(openRows, ids) {
  return ids.length > 0 && ids.every(id => openRows[id]);
}

// Expand-all toggles every expandable row together: open them all, or close
// them all when they already are.
function frtToggleAllRows(openRows, ids) {
  if (frtAllOpen(openRows, ids)) return {};
  const next = {};
  ids.forEach(id => { next[id] = true; });
  return next;
}

function frtSearchLabels(packages) {
  return (packages || []).map(p => p.display_label);
}

function frtEntityRow(e, period) {
  const lc = frtLeafColumns(e.financial_report, e.packages, String(e.entity_id));
  return {
    id: String(e.entity_id), name: e.entity_name, sub: null,
    group: FRT_FUND_TYPES.includes(e.entity_type) ? "funds" : "gp",
    due: e.due_date, note: frtDeadlineNote(e.due_date_days, e.due_date_source, period),
    cash: frtMapCashReconciliation(e.cash_reconciliation || {}),
    soi: frtMapSoiReview(e.soi_review || {}),
    fr: lc.fr, action: lc.action, trailing: lc.trailing, tag: lc.tag,
    packages: lc.packageChildren, children: [], isFamily: false,
    searchLabels: frtSearchLabels(e.packages),
  };
}

// A member beneath its family's row: covered (no packages) reads "In combined
// package"; one publishing its own reads and owes them, packages included.
function frtMemberRow(m, period) {
  const lc = frtLeafColumns(m.financial_report, m.packages, String(m.entity_id));
  return {
    id: String(m.entity_id), name: m.entity_name,
    due: m.due_date, note: frtDeadlineNote(m.due_date_days, m.due_date_source, period),
    cash: frtMapCashReconciliation(m.cash_reconciliation || {}),
    soi: frtMapSoiReview(m.soi_review || {}),
    fr: lc.fr, action: lc.action, trailing: lc.trailing, tag: lc.tag,
    packages: lc.packageChildren, children: [],
    searchLabels: frtSearchLabels(m.packages),
  };
}

// families[].financial_report already reads over everything beneath the
// family; this only counts packages to decide single-package vs rollup.
function frtFamilyRow(f, members, period) {
  const ownPackages = f.packages || [];
  const total = ownPackages.length + members.reduce((n, m) => n + (m.packages || []).length, 0);
  const rowId = `family-${f.family_id}`;
  let fr, action, trailing, tag = null, packageChildren = [];
  if (total >= 2) {
    fr = frtMapFinancialReportRollup(f.financial_report || {});
    action = null; trailing = null; tag = `${total} packages`;
    packageChildren = ownPackages.map(p => frtPackageChild(p, rowId));
  } else {
    const cols = frtMapFinancialReportColumns(f.financial_report || {});
    fr = cols.cell; action = cols.action; trailing = cols.trailingNote;
  }
  return {
    id: rowId, name: f.family_name,
    sub: `Fund family · ${members.length} ${members.length === 1 ? "fund" : "funds"}`,
    group: "funds", isFamily: true,
    due: f.due_date, note: frtDeadlineNote(f.due_date_days, f.due_date_source, period),
    // Cash reconciliation and the SOI exist per member fund only.
    cash: FRT_EMPTY_CELL, soi: FRT_EMPTY_CELL,
    fr, action, trailing, tag,
    packages: packageChildren, children: members.map(m => frtMemberRow(m, period)),
    searchLabels: frtSearchLabels(ownPackages),
  };
}

function frtBuildRows(p) {
  const byFamily = {};
  (p.entities || []).forEach(e => {
    if (e.family_id) (byFamily[e.family_id] = byFamily[e.family_id] || []).push(e);
  });
  const rows = [];
  (p.entities || []).filter(e => !e.family_id).forEach(e => { rows.push(frtEntityRow(e, p.reporting_period)); });
  (p.families || []).forEach(f => {
    rows.push(frtFamilyRow(f, byFamily[f.family_id] || [], p.reporting_period));
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
  const cellKey = Object.keys(FRT_CELL_COLUMNS).find(k => FRT_CELL_COLUMNS[k] === key);
  const c = cellKey && row[cellKey];
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
  return [r.cash, r.soi, r.fr].some(c => c && c.state === "needs_action")
    || (r.packages || []).some(p => p.fr && p.fr.state === "needs_action")
    || (r.children || []).some(frtNeedsAction);
}

// A row matches on its own name, a package's label (a member's own included),
// or a member's name.
function frtRowMatchesSearch(r, q) {
  if (String(r.name).toLowerCase().includes(q)) return true;
  if ((r.searchLabels || []).some(l => String(l).toLowerCase().includes(q))) return true;
  return (r.children || []).some(c => frtRowMatchesSearch(c, q));
}

// A selected row, or a family nesting a selected member: a member stays under
// its family row, so the family has to answer for it.
function frtRowMatchesEntities(r, ids) {
  return ids.includes(r.id) || (r.children || []).some(c => ids.includes(c.id));
}

function frtFilterRows(rows, st) {
  const q = String(st.search || "").trim().toLowerCase();
  const ids = st.entityFilters || [];
  return rows.filter(r => (!st.statusFilter || frtNeedsAction(r))
    && (!q || frtRowMatchesSearch(r, q))
    && (!ids.length || frtRowMatchesEntities(r, ids)));
}

// ── Entity filter ──────────────────────────────────────────────────────────

const FRT_ALL_ENTITIES = "All entities";
// A selection with no row this period: the entity may simply have nothing to report.
const FRT_UNRESOLVED_ENTITY = "Entity: unresolved";
const FRT_GROUPS = [["funds", "Funds & SPVs"], ["gp", "GP Entities & Management Companies"]];

// The trigger reads "All entities" while loading, so a kept selection never
// flashes as unresolved before the period's rows arrive.
function frtEntityFilterLabel(rows, ids, loading) {
  if (loading || !ids.length) return FRT_ALL_ENTITIES;
  if (ids.length > 1) return `${ids.length} entities`;
  const named = rows.flatMap(r => [r].concat(r.children || [])).find(r => r.id === ids[0]);
  return named ? `Entity: ${named.name}` : FRT_UNRESOLVED_ENTITY;
}

function frtToggleEntities(ids, toggled, on) {
  return on ? [...new Set(ids.concat(toggled))] : ids.filter(id => !toggled.includes(id));
}

// A family's own box reflects every member, even one the menu's search hides.
function frtFamilyCheckState(row, ids) {
  const picked = row.children.filter(c => ids.includes(c.id)).length;
  return { checked: picked === row.children.length, indeterminate: picked > 0 && picked < row.children.length };
}

// Every expandable row open: what the table shows once a filter narrows it.
function frtOpenAll(rows) {
  const open = {};
  rows.filter(frtIsExpandable).forEach(r => { open[r.id] = true; });
  return open;
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

// What the card's second line says: the GP's open items by column. Packages
// are counted directly off the payload, not rows -- a two-package entity
// awaiting review on both reads "2 packages to review", not one.
function frtNeedsSummary(payload) {
  const entities = payload.entities || [];
  const needsAction = c => c && c.state === "needs_action";
  const cash = entities.filter(e => needsAction(e.cash_reconciliation)).length;
  const soi = entities.filter(e => needsAction(e.soi_review)).length;
  const packages = entities.flatMap(e => e.packages || [])
    .concat((payload.families || []).flatMap(f => f.packages || []))
    .filter(p => needsAction(p.financial_report)).length;
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
    category: TASK_CATEGORY_REPORTING,
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

// Only a build seed gets a period card of its own: the queue's reporting work
// arrives as tasks, and each package task opens the tracker for its period.
async function frtFetchPeriodRows() {
  const seed = frtParsePeriodLabel(FRT_SEED_PERIOD);
  if (!_benchmarkFirmId || !seed) return [];
  const payload = await frtFetchPeriod(seed).catch(e => {
    console.error("[frt] tracker read threw —", e);
    return null;
  });
  return [frtCardFor(seed, payload, true)];
}

// A package task's title ends in its period, as fund-admin writes it: "Review
// financials for Q2 2026", or a bare year ("Review financials for 2025") for the
// year end, which the tracker reads as Q4. Other templates' titles name periods
// loosely, so only the package template is read this way.
const FRT_PACKAGE_TEMPLATE = TASK_TEMPLATE_PACKAGE;
function frtPeriodOfTitle(title) {
  const text = String(title || "").trim();
  const q = /\bQ([1-4])\s+(\d{4})$/.exec(text);
  if (q) return { period: `Q${q[1]}`, year: Number(q[2]) };
  const y = /\bfor\s+(\d{4})$/.exec(text);
  return y ? { period: "Q4", year: Number(y[1]) } : null;
}

// The tracker target for a package task: its period, labelled as the panel names it. A title
// that names no period opens the current one, so a package task always opens the tracker.
function frtTargetFor(t) {
  if (!t || t.workflow_template !== FRT_PACKAGE_TEMPLATE) return null;
  const p = frtPeriodOfTitle(t.display_name) ?? frtPeriodOfTitle(t.workflow_display_name)
    ?? frtActivePeriod(new Date());
  return { period: p.period, year: p.year, label: frtPeriodLabel(p) };
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
    apps: {},
    loading: true,
    error: null,
    search: "",
    statusFilter: null,
    entityFilters: [],
    entitySearch: "",
    sort: { key: "due_date", direction: "ascending" },
    openRows: {},
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
  let apps = {};
  try {
    [payload, apps] = await Promise.all([frtFetchPeriod(snap.period), frtTaskApps()]);
  } catch (e) {
    console.error("[frt] tracker read threw —", e);
  }
  if (_frt !== snap) return;
  snap.loading = false;
  snap.apps = apps || {};
  if (payload) {
    snap.payload = payload;
    // The selection survives a period change, and a narrowed table opens up.
    if (snap.entityFilters.length) snap.openRows = frtOpenAll(frtBuildRows(payload));
  } else snap.error = "We could not load the tracker for this period. Try again, or pick another period.";
  frtRender();
}

function frtSelectPeriod(p) {
  if (!_frt) return;
  _frt.period = { period: p.period, year: p.year };
  _frt.openRows = {};
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
    const cls = `frt-btn${c.isPrimary ? " frt-btn-primary" : ""}`;
    if (c.app) {
      // The app opens in a new chat; Carta stays one click away beside it.
      const btn = `<button class="${cls}" type="button" data-frt-app="${escHtml(JSON.stringify(c.app))}" title="Open in a new Claude chat">${inner}</button>`;
      const carta = `<a class="frt-carta-link" href="${escHtml(c.href)}" target="_blank" rel="noopener" title="Open in Carta" aria-label="Open in Carta" data-frt-action>↗</a>`;
      return `<span class="frt-app-cell">${btn}${carta}</span>`;
    }
    return frtLink(c.href, cls, inner);
  }
  const textCls = c.state === "with_carta" ? "frt-cell-text frt-gray" : "frt-cell-text";
  return `<span class="frt-cell"><span class="frt-dot frt-dot-${c.variant}"></span><span class="${textCls}">${escHtml(c.text)}${suffix}</span></span>`;
}

function frtRenderFinancialReport(row) {
  const btn = row.action ? frtLink(row.action.href, "frt-btn", `${FRT_DOC_ICON}&nbsp;${escHtml(row.action.text)}`) : "";
  return `<div class="frt-fr">${frtRenderCell(row.fr)}${btn}</div>`;
}

// depth 0 is a top-level entity or family row; 1 is a member or a package
// child of one; 2 is a member's own package, nested one level further.
function frtRenderRow(row, depth) {
  const open = frtIsExpandable(row) && !!_frt.openRows[row.id];
  const twiddle = (depth === 0 && frtIsExpandable(row))
    ? `<button class="frt-twiddle" type="button" data-frt-row="${escHtml(row.id)}" aria-label="${open ? "Collapse" : "Expand"} ${escHtml(row.name)}">${open ? "▾" : "▸"}</button>`
    : "";
  const due = row.due ? `<div class="frt-due">${escHtml(frtDate(row.due))}</div>` : '<div class="frt-em">—</div>';
  const cls = [depth > 0 ? "frt-child" : "", depth > 1 ? "frt-depth-2" : ""].filter(Boolean).join(" ");
  const nameCls = row.isPackage ? "frt-ent frt-pkg-label" : "frt-ent";
  return `<tr class="${cls}">
    <td class="frt-c-twiddle">${twiddle}</td>
    <td class="frt-c-entity"><div class="${nameCls}">${escHtml(row.name)}</div>${row.sub ? `<div class="frt-sub">${escHtml(row.sub)}</div>` : ""}${row.tag ? `<div class="frt-tag">${escHtml(row.tag)}</div>` : ""}</td>
    <td class="frt-c-due">${due}${row.note ? `<div class="frt-sub">${escHtml(row.note)}</div>` : ""}</td>
    <td class="frt-c-cash">${frtRenderCell(row.cash)}</td>
    <td class="frt-c-soi">${frtRenderCell(row.soi)}</td>
    <td class="frt-c-fr">${frtRenderFinancialReport(row)}</td>
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
  const all = frtAttachApps(frtBuildRows(_frt.payload), _frt.payload, _frt.apps);
  const shown = frtSortRows(frtFilterRows(all, _frt), _frt.sort);
  if (!shown.length) return '<div class="frt-empty">No entities match your filters.</div>';
  const expandable = shown.filter(frtIsExpandable);
  const allOpen = frtAllOpen(_frt.openRows, expandable.map(r => r.id));
  let html = `<div class="frt-table-wrap"><table class="frt-table"><thead><tr>
    <th class="frt-c-twiddle"><button class="frt-twiddle" type="button" data-frt-expand-all aria-label="${allOpen ? "Collapse rows" : "Expand rows"}">${allOpen ? "⊟" : "⊞"}</button></th>
    ${frtHeader("entity_name", "Entity")}
    ${frtHeader("due_date", "Reporting Deadline")}
    ${frtHeader("cash_reconciliation", "Cash Reconciliation")}
    ${frtHeader("soi_review", "SOI Review")}
    ${frtHeader("financial_report", "Financial Report")}
    <th class="frt-c-act"></th></tr></thead><tbody>`;
  FRT_GROUPS.forEach(([g, title]) => {
    const rows = shown.filter(r => r.group === g);
    if (!rows.length) return;
    html += `<tr class="frt-group"><td colspan="7">${escHtml(title)} (${rows.length})</td></tr>`;
    rows.forEach(r => {
      html += frtRenderRow(r, 0);
      if (frtIsExpandable(r) && _frt.openRows[r.id]) {
        r.packages.forEach(pkg => { html += frtRenderRow(pkg, 1); });
        r.children.forEach(m => {
          html += frtRenderRow(m, 1);
          (m.packages || []).forEach(pkg => { html += frtRenderRow(pkg, 2); });
        });
      }
    });
  });
  return html + "</tbody></table></div>";
}

function frtEntityCheck(id, label, checked, attr, extra) {
  return `<label class="frt-check${extra || ""}"><input type="checkbox" ${attr}="${escHtml(id)}"${checked ? " checked" : ""}><span>${escHtml(label)}</span></label>`;
}

// The menu's own search narrows the options, never the table.
function frtRenderEntityOptions(rows) {
  const ids = _frt.entityFilters;
  const q = _frt.entitySearch.trim().toLowerCase();
  const matches = name => !q || String(name).toLowerCase().includes(q);
  let html = "";
  FRT_GROUPS.forEach(([g, title]) => {
    const visible = rows.filter(r => r.group === g && (matches(r.name) || r.children.some(c => matches(c.name))));
    if (!visible.length) return;
    html += `<div class="frt-check-head">${escHtml(title)}</div>`;
    visible.forEach(r => {
      if (!r.children.length) { html += frtEntityCheck(r.id, r.name, ids.includes(r.id), "data-frt-entity"); return; }
      const fam = frtFamilyCheckState(r, ids);
      html += frtEntityCheck(r.id, r.name, fam.checked, "data-frt-entity-family");
      (matches(r.name) ? r.children : r.children.filter(c => matches(c.name))).forEach(c => {
        html += frtEntityCheck(c.id, c.name, ids.includes(c.id), "data-frt-entity", " frt-check-member");
      });
    });
  });
  return html || '<div class="frt-check-head">No entities match your search.</div>';
}

function frtRenderEntityMenu() {
  const rows = _frt.payload ? frtBuildRows(_frt.payload) : [];
  const label = frtEntityFilterLabel(rows, _frt.entityFilters, _frt.loading);
  const open = _frt.menu === "entity";
  return `<div class="frt-menu${open ? " frt-menu-open" : ""}">
    <button class="frt-btn frt-btn-md frt-entity-trigger" type="button" data-frt-menu="entity" aria-haspopup="true" aria-expanded="${open}">${escHtml(label)} <span class="frt-chev">▾</span></button>
    <div class="frt-menu-list frt-entity-menu">
      <input class="frt-entity-search" type="search" aria-label="Filter entities" placeholder="Filter entities" value="${escHtml(_frt.entitySearch)}" data-frt-entity-search>
      <div class="frt-entity-scroll">
        ${frtEntityCheck("all", FRT_ALL_ENTITIES, !_frt.entityFilters.length, "data-frt-entity-all")}
        <div class="frt-menu-sep"></div>
        ${frtRenderEntityOptions(rows)}
      </div>
    </div>
  </div>`;
}

// The table opens every row once a filter narrows it, and folds back when cleared.
function frtSetEntityFilters(ids) {
  const wasScoped = _frt.entityFilters.length > 0;
  _frt.entityFilters = ids;
  if (wasScoped !== (ids.length > 0)) {
    _frt.openRows = ids.length && _frt.payload ? frtOpenAll(frtBuildRows(_frt.payload)) : {};
  }
  frtRender();
}

function frtRenderToolbar() {
  const activeSort = FRT_SORTS.find(s => s.key === _frt.sort.key) || FRT_SORTS[0];
  const trigger = _frt.statusFilter ? "Needs action" : `Sort by ${activeSort.label}`;
  const canReset = _frt.search || _frt.statusFilter || _frt.entityFilters.length || _frt.sort.key !== "due_date" || _frt.sort.direction !== "ascending";
  const periods = _frt.window.slice().reverse();
  return `<div class="frt-toolbar">
    <div class="frt-toolbar-left">
      ${frtRenderEntityMenu()}
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

const FRT_SCROLLERS = [".frt-table-wrap", ".frt-entity-scroll"];

function frtRender() {
  const overlay = document.getElementById("frt-overlay");
  if (!overlay || !_frt) return;
  const firm = _frt.payload ? _frt.payload.firm_name : "";
  const deep = _frt.payload ? frtDeepLink(_frt.payload, _frt.period) : null;
  // Every interaction rebuilds the panel, so the table and the entity menu keep their
  // scroll positions and the menu's search keeps focus.
  const scrolls = FRT_SCROLLERS.map(sel => {
    const el = overlay.querySelector(sel);
    return el ? [el.scrollTop, el.scrollLeft] : null;
  });
  const prevSearch = overlay.querySelector("[data-frt-entity-search]");
  const caret = prevSearch && document.activeElement === prevSearch ? prevSearch.selectionStart : null;
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
  FRT_SCROLLERS.forEach((sel, i) => {
    const el = overlay.querySelector(sel);
    if (el && scrolls[i]) [el.scrollTop, el.scrollLeft] = scrolls[i];
  });
  const search = overlay.querySelector("[data-frt-entity-search]");
  if (search && caret != null) {
    search.focus();
    try { search.setSelectionRange(caret, caret); } catch (e) { /* not a text input in every host */ }
  }
}

function frtBind(root) {
  root.querySelectorAll("[data-frt-close]").forEach(b => b.addEventListener("click", frtClose));
  root.querySelectorAll("[data-frt-open-carta]").forEach(a => a.addEventListener("click", () =>
    trackWorkhub("click", "CartaWorkhub.FinancialReportingTracker.OpenInCarta")));
  root.querySelectorAll("[data-frt-action]").forEach(a => a.addEventListener("click", () =>
    trackWorkhub("click", "CartaWorkhub.FinancialReportingTracker.Action")));
  root.querySelectorAll("[data-frt-app]").forEach(b => b.addEventListener("click", () => {
    const app = tryParse(b.dataset.frtApp);
    if (!app) return;
    trackWorkhub("click", "CartaWorkhub.FinancialReportingTracker.OpenAppInChat");
    openClaudeChat(frtAppPrompt(app, _frt.payload && _frt.payload.firm_name));
  }));
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
  root.querySelectorAll("[data-frt-row]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.frtRow;
    if (_frt.openRows[id]) delete _frt.openRows[id]; else _frt.openRows[id] = true;
    frtRender();
  }));
  root.querySelectorAll("[data-frt-expand-all]").forEach(b => b.addEventListener("click", () => {
    const ids = frtBuildRows(_frt.payload).filter(frtIsExpandable).map(r => r.id);
    _frt.openRows = frtToggleAllRows(_frt.openRows, ids);
    frtRender();
  }));
  root.querySelectorAll("[data-frt-reset]").forEach(b => b.addEventListener("click", () => {
    _frt.search = ""; _frt.statusFilter = null; _frt.sort = { key: "due_date", direction: "ascending" };
    _frt.entitySearch = "";
    frtSetEntityFilters([]);
  }));
  root.querySelectorAll("[data-frt-entity-all]").forEach(b => b.addEventListener("change", () => frtSetEntityFilters([])));
  root.querySelectorAll("[data-frt-entity]").forEach(b => b.addEventListener("change", () =>
    frtSetEntityFilters(frtToggleEntities(_frt.entityFilters, [b.dataset.frtEntity], b.checked))));
  root.querySelectorAll("[data-frt-entity-family]").forEach(b => {
    const row = frtBuildRows(_frt.payload).find(r => r.id === b.dataset.frtEntityFamily);
    if (!row) return;
    b.indeterminate = frtFamilyCheckState(row, _frt.entityFilters).indeterminate;
    b.addEventListener("change", () =>
      frtSetEntityFilters(frtToggleEntities(_frt.entityFilters, row.children.map(c => c.id), b.checked)));
  });
  const entitySearch = root.querySelector("[data-frt-entity-search]");
  if (entitySearch) {
    entitySearch.addEventListener("input", () => { _frt.entitySearch = entitySearch.value; frtRender(); });
  }
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
