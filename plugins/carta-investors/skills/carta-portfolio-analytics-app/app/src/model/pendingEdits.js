// Staged KPI corrections: which cells can be edited, what reading a cell maps to,
// how edits overlay the dataset, and how they move through draft → publishing →
// published → confirmed / failed / conflict. Pure functions over kpi.json + the
// portfolio doc — no React, no I/O. Spec: ADR 020 (inline KPI corrections).
import { pointsFor, quarterEndOf } from "./kpi.js";

export const EDITABLE_UNITS = new Set(["Dollar", "Number", "Percentage", "Percent", "Ratio"]);
export const EDIT_STATUSES = ["draft", "publishing", "published", "failed", "conflict"];

/** A reported numeric reading — a Data Collection KPI or a financial-statement line
 *  item (Balance sheet / P&L / Cash flow), both of which store_kpis writes. Flags/dates/
 *  prose, formulas and derived companions have no single reading in Carta to correct. */
export function isEditableMetric(metric) {
  if (!metric || metric.kind || metric.custom || metric.derivedFrom) return false;
  return EDITABLE_UNITS.has(metric.unit);
}

/** The Carta entity a correction is stored against, derived from the identity faces the
 *  build stamps. Leaf-node rule: FA issuers are roots, corporations/LLCs are leaves, and
 *  an edit always writes to the leaf when one exists — the FA-issuer root is the target
 *  only for a standalone issuer. Financials addresses a CORPORATION by its numeric
 *  carta-web pk (LLC/FA_ISSUER by uuid), so a corporation without cartaCorporationId —
 *  including corp:-keyed uuid-only companies — has no writable target and returns null;
 *  it never falls back to the FA root. Mirrors publish.py's publish_target();
 *  keep the two identical. */
export function publishTarget(company) {
  if (!company) return null;
  const corpPk = company.cartaCorporationId;
  if (corpPk != null && /^[0-9]+$/.test(String(corpPk))) return { id: String(corpPk), type: "CORPORATION" };
  if (company.cartaCorporationUuid || company.keyType === "corporation") return null;
  const id = String(company.id || "");
  if (company.keyType === "llc" && id.startsWith("llc:")) return { id: id.slice(4), type: "LLC" };
  if (company.glIssuerId) return { id: String(company.glIssuerId), type: "FA_ISSUER" };
  if (company.keyType === "gl_issuer" && id.startsWith("gl:")) return { id: id.slice(3), type: "FA_ISSUER" };
  return null;
}

export const canEditCompany = (company) => !!publishTarget(company);

export const editId = ({ companyId, metricKey, period, freq }) => `${companyId}|${metricKey}|${period}|${freq}`;

const pad = (n) => String(n).padStart(2, "0");

/** First day of the calendar quarter a quarter-end falls in. */
export function quarterStartOf(qEnd) {
  const [y, m] = String(qEnd).split("-").map(Number);
  return `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
}

/** Period start derived from a period end and cadence, for a point whose row carried no
 *  period_start. Calendar periods — the same assumption rollUpQuarters makes. */
export function periodStart(periodEnd, freq) {
  const [y, m] = String(periodEnd).split("-").map(Number);
  if (freq === "M") return `${y}-${pad(m)}-01`;
  if (freq === "Q") return quarterStartOf(periodEnd);
  if (freq === "S") return `${y}-${m <= 6 ? "01" : "07"}-01`;
  return `${y}-01-01`;
}

/** The exact Carta reading a table cell corresponds to, or null when the cell has no
 *  single reading behind it (a quarter summed from months, a blank, a pre-upgrade point).
 *  `cell` is a point from seriesPoints(company, key, metric, quarterly). */
export function editTarget(company, metric, cell, quarterly) {
  // An `added` cell is a staged addition's own overlay point — its baseline must stay
  // null, so its pencil goes back through addTarget, never here.
  if (!cell || cell.v == null || cell.added || !isEditableMetric(metric) || !canEditCompany(company)) return null;
  const raw = pointsFor(company, metric.key);
  if (!quarterly) {
    const p = raw.find((x) => x.d === cell.d);
    if (!p || !p.f) return null;
    return { companyId: company.id, metricKey: metric.key, period: p.d, freq: p.f,
      fromDate: p.ps || periodStart(p.d, p.f), appliesTo: "v", prevValue: p.v, cur: p.cur ?? null };
  }
  if (!cell.parts || cell.parts.length !== 1) return null;
  const p = raw.find((x) => x.d === cell.parts[0]);
  if (!p || !p.f) return null;
  if (cell.reportedQuarterly && p.f !== "Q") {
    // The quarter shows the company's own quarterly figure that rides on a monthly point.
    return { companyId: company.id, metricKey: metric.key, period: quarterEndOf(p.d), freq: "Q",
      fromDate: quarterStartOf(p.d), appliesTo: "q", prevValue: p.q, cur: p.cur ?? null };
  }
  return { companyId: company.id, metricKey: metric.key, period: p.d, freq: p.f,
    fromDate: p.ps || periodStart(p.d, p.f), appliesTo: "v", prevValue: p.v, cur: p.cur ?? null };
}

/** Currency for a reading the company never filed: its latest same-metric currency,
 *  else its latest on any metric, else null (publish falls back to the firm's). */
export function inferCur(company, metricKey) {
  const own = pointsFor(company, metricKey).filter((x) => x.cur);
  if (own.length) return own[own.length - 1].cur;
  let best = null;
  for (const pts of Object.values((company && company.series) || {}))
    for (const x of pts) if (x.cur && (!best || x.d > best.d)) best = x;
  return best ? best.cur : null;
}

/** A target for a cell with no reading behind it (the grid's dashes) — prevValue null
 *  is what marks the correction an addition. The reading is cut at the grid's cadence,
 *  except a quarter-end column for a quarterly reporter stays "Q" in the monthly grid.
 *  A period that hasn't started yet gets no target: an actual can't predate its period. */
export function addTarget(company, metric, period, quarterly, todayIso) {
  if (!period || !isEditableMetric(metric) || !canEditCompany(company)) return null;
  let freq = quarterly ? "Q" : "M";
  if (!quarterly && quarterEndOf(period) === period) {
    const own = pointsFor(company, metric.key);
    if (own.length && own.filter((x) => x.f === "Q").length * 2 > own.length) freq = "Q";
  }
  const fromDate = periodStart(period, freq);
  if (todayIso && fromDate > todayIso) return null;
  return { companyId: company.id, metricKey: metric.key, period, freq, fromDate,
    appliesTo: "v", prevValue: null, cur: inferCur(company, metric.key) };
}

const isPct = (unit) => unit === "Percentage" || unit === "Percent";

/** What the inline input shows: percentages as percent, everything else raw. */
export function toInputValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return "";
  const n = isPct(unit) ? v * 100 : v;
  return String(+n.toPrecision(12));
}

/** Parse what the user typed back to a stored value, or null when it isn't a number. */
export function fromInputValue(text, unit) {
  const s = String(text ?? "").trim().replace(/,/g, "").replace(/−/g, "-").replace(/%$/, "");
  if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return isPct(unit) ? n / 100 : n;
}

const PUBLISHABLE = new Set(["draft", "failed"]);
const OVERLAID = new Set(["draft", "publishing", "published", "failed", "conflict"]);
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9);

/** Upsert a draft for the cell `target` names. Typing the original value back removes it. */
export function stageEdit(doc, target, value, nowIso) {
  const id = editId(target);
  const list = (doc.pendingEdits || []).filter((e) => e.id !== id);
  if (!near(value, target.prevValue)) {
    list.push({ id, ...target, value, status: "draft", createdAt: nowIso, publishedAt: null, runId: null, error: null, upstreamValue: null });
  }
  doc.pendingEdits = list;
  return doc;
}

export function discardEdit(doc, id) {
  doc.pendingEdits = (doc.pendingEdits || []).filter((e) => e.id !== id);
  return doc;
}

export const publishableEdits = (doc) => (doc?.pendingEdits || []).filter((e) => PUBLISHABLE.has(e.status));

export const conflictEdits = (doc) => (doc?.pendingEdits || []).filter((e) => e.status === "conflict");

/** Resolve a conflict by keeping the user's number: the correction becomes a fresh draft
 *  whose baseline is what Carta holds now, so the next publish and reconcile compare
 *  against the right value. */
export const keepMine = (doc, e, nowIso) => stageEdit(discardEdit(doc, e.id),
  { companyId: e.companyId, metricKey: e.metricKey, period: e.period, freq: e.freq,
    fromDate: e.fromDate, appliesTo: e.appliesTo, prevValue: e.upstreamValue }, e.value, nowIso);

/** Resolve a conflict by taking Carta's number: the edit simply goes away. */
export const takeCartas = discardEdit;

export function markPublishing(doc, ids, runId) {
  const set = new Set(ids);
  doc.pendingEdits = (doc.pendingEdits || []).map((e) => (set.has(e.id) ? { ...e, status: "publishing", runId, error: null } : e));
  return doc;
}

/** Fold the server's per-edit results into the doc. Only edits stamped with `runId`
 *  move, so a stale poll from an earlier run can't touch a newer batch. */
export function applyPublishResults(doc, runId, results, nowIso) {
  const byId = new Map((results || []).map((r) => [r.id, r]));
  let changed = false;
  const next = (doc.pendingEdits || []).map((e) => {
    if (e.runId !== runId || e.status !== "publishing") return e;
    const r = byId.get(e.id);
    if (!r) return e;
    changed = true;
    return r.status === "published"
      ? { ...e, status: "published", publishedAt: nowIso, error: null }
      : { ...e, status: "failed", error: r.error || "Carta rejected this correction." };
  });
  if (!changed) return null;
  doc.pendingEdits = next;
  return doc;
}

/** A whole-run publish error (nothing was written) strands every edit it stamped
 *  publishing; move just that run's publishing edits to failed so they're publishable
 *  again. Same idiom as applyPublishResults — null when nothing moved. */
export function failRun(doc, runId, message) {
  let changed = false;
  const next = (doc.pendingEdits || []).map((e) => {
    if (e.runId !== runId || e.status !== "publishing") return e;
    changed = true;
    return { ...e, status: "failed", error: message || "The publish didn't finish." };
  });
  if (!changed) return null;
  doc.pendingEdits = next;
  return doc;
}

/** Overlay staged corrections onto the dataset so every view shows the corrected
 *  figure. Same shape as withCurrency: same object back when there is nothing to do,
 *  never mutates the input. Points gain `edit: {id, status}` for the badge. */
export function withPendingEdits(data, edits) {
  const live = (edits || []).filter((e) => OVERLAID.has(e.status));
  if (!data || !live.length) return data;
  const byCompany = new Map();
  for (const e of live) {
    if (!byCompany.has(e.companyId)) byCompany.set(e.companyId, []);
    byCompany.get(e.companyId).push(e);
  }
  const companies = (data.companies || []).map((c) => {
    const mine = byCompany.get(c.id);
    if (!mine || !c.series) return c;
    const series = { ...c.series };
    for (const e of mine) {
      const isAdd = e.appliesTo !== "q" && e.prevValue == null;
      const pts = series[e.metricKey];
      if (!pts && !isAdd) continue;
      let hit = false;
      const mapped = (pts || []).map((p) => {
        const match = e.appliesTo === "q" ? quarterEndOf(p.d) === e.period && p.q != null && p.f !== "Q" : p.d === e.period;
        if (!match) return p;
        hit = true;
        const np = { ...p, edit: { id: e.id, status: e.status } };
        if (e.appliesTo === "q") np.q = e.value;
        else { np.v = e.value; if (p.f === "Q" && p.q != null) np.q = e.value; }
        return np;
      });
      if (!hit && isAdd) {
        // An addition has no reading to decorate — materialize one where the grid
        // expects it. `added` reroutes its pencil through addTarget (baseline null).
        mapped.push({ d: e.period, f: e.freq, ps: e.fromDate, v: e.value,
          ...(e.cur ? { cur: e.cur } : {}), added: true, edit: { id: e.id, status: e.status } });
        mapped.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
      }
      series[e.metricKey] = mapped;
    }
    return { ...c, series };
  });
  return { ...data, companies };
}

function kpiFetchedAt(data) {
  const ds = (data?.source?.datasets || []).find((d) => d.key === "kpis");
  return ds && ds.present ? ds.fetchedAt : null;
}

/** After a refresh, settle every published edit against the fresh raw data:
 *  fresh == correction → confirmed (drop); fresh == original → still lagging (keep);
 *  anything else → conflict. Edits published after the fetch are left alone. */
export function reconcileEdits(doc, rawData) {
  const fetched = kpiFetchedAt(rawData);
  if (!fetched || !doc?.pendingEdits?.length) return null;
  let changed = false;
  const next = [];
  for (const e of doc.pendingEdits) {
    if (e.status !== "published" || !e.publishedAt || e.publishedAt >= fetched) { next.push(e); continue; }
    const co = (rawData.companies || []).find((c) => c.id === e.companyId);
    const p = co && pointsFor(co, e.metricKey).find((x) => (e.appliesTo === "q" ? quarterEndOf(x.d) === e.period && x.q != null : x.d === e.period));
    const fresh = p ? (e.appliesTo === "q" ? p.q : p.v) : null;
    if (fresh == null) { next.push(e); continue; }
    if (near(fresh, e.value)) { changed = true; continue; }
    if (near(fresh, e.prevValue)) { next.push(e); continue; }
    changed = true;
    // conflictAt = the fetch that revealed the divergence — the Conflicts view dates
    // "Carta now" with it.
    next.push({ ...e, status: "conflict", upstreamValue: fresh, conflictAt: fetched });
  }
  if (!changed) return null;
  doc.pendingEdits = next;
  return doc;
}
