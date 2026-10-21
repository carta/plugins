// Saved dashboards key per-company state by company id. A company in kpi.json may list
// `legacyIds`: other ids a saved doc can hold for it: the slugs of the names its rows carry,
// and the ids its rows key to when any one identity stem comes back empty (the typed ids
// their identity columns form, and an entity link the directory folds onto another). This
// moves a doc's references from those ids onto the company's id.
//
// An id several companies list stays put: picking one would attach a note or a correction
// to the wrong company.
import { editId } from "./pendingEdits.js";

/** legacy id -> company id, for every legacy id exactly one company lists. */
export function legacyIdMap(companies) {
  const current = new Set(companies.map((c) => c.id));
  const owners = new Map();
  for (const c of companies) {
    for (const legacy of c.legacyIds || []) {
      if (current.has(legacy)) continue;
      if (!owners.has(legacy)) owners.set(legacy, new Set());
      owners.get(legacy).add(c.id);
    }
  }
  const map = new Map();
  for (const [legacy, ids] of owners) if (ids.size === 1) map.set(legacy, [...ids][0]);
  return map;
}

function remapList(list, map) {
  if (!Array.isArray(list) || !list.some((id) => map.has(id))) return list;
  return [...new Set(list.map((id) => map.get(id) || id))];
}

// An entry already under the company id wins; otherwise the first legacy entry moves over.
// `merge` combines two entries instead, for state where both are worth keeping.
function remapKeys(obj, map, merge) {
  if (!obj || typeof obj !== "object" || !Object.keys(obj).some((k) => map.has(k))) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!map.has(k)) out[k] = v;
  for (const [k, v] of Object.entries(obj)) {
    if (!map.has(k)) continue;
    const to = map.get(k);
    if (!(to in out)) out[to] = v;
    else if (merge) out[to] = merge(out[to], v);
  }
  return out;
}

const joinNotes = (a, b) => (!b || a === b ? a : !a ? b : `${a}\n\n${b}`);

function remapEdit(e, map) {
  const to = map.get(e.companyId);
  return to ? { ...e, companyId: to, id: editId({ ...e, companyId: to }) } : e;
}

/** The doc with every legacy id moved onto its company's id, or null when nothing
 *  changed (so dashboard.update skips the write). Mutates and returns the caller's clone. */
export function migrateCompanyIds(doc, companies) {
  const map = legacyIdMap(companies || []);
  if (!doc || !map.size) return null;
  const before = JSON.stringify(doc);
  doc.favorites = remapList(doc.favorites, map);
  doc.notes = remapKeys(doc.notes, map, joinNotes);
  for (const list of [doc.views, doc.reportingViews, doc.covenants]) {
    for (const item of Array.isArray(list) ? list : []) item.companyIds = remapList(item.companyIds, map);
  }
  for (const m of Array.isArray(doc.customMetrics) ? doc.customMetrics : []) {
    m.scope = remapList(m.scope, map);
    m.overrides = remapKeys(m.overrides, map);
  }
  if (doc.kpiSnapshot) doc.kpiSnapshot.byCompany = remapKeys(doc.kpiSnapshot.byCompany, map);
  if (Array.isArray(doc.pendingEdits)) doc.pendingEdits = doc.pendingEdits.map((e) => remapEdit(e, map));
  return JSON.stringify(doc) === before ? null : doc;
}
