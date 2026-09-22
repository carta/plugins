// KPI-snapshot visibility config: doc.kpiSnapshot = { global: [key], byCompany: { [companyId]: [key] } }.
// An absent layer falls through; a present layer wins even when empty (so "hide all" sticks).

const cfgOf = (doc) => (doc && doc.kpiSnapshot) || {};

/** Resolved, ordered KPI key list for a company.
 *  Order (later wins, replace not merge): defaultKeys → global → per-company. */
export function resolveKpiKeys(doc, companyId, defaultKeys) {
  const cfg = cfgOf(doc);
  const own = companyId && cfg.byCompany && cfg.byCompany[companyId];
  if (Array.isArray(own)) return own;
  if (Array.isArray(cfg.global)) return cfg.global;
  return defaultKeys || [];
}

/** Is a scope currently overridden? Drives the "modified" dot and whether Reset
 *  is worth offering. Omit `scope` to ask "either layer". */
export function hasKpiOverride(doc, companyId, scope) {
  const cfg = cfgOf(doc);
  const global = Array.isArray(cfg.global);
  const own = !!(companyId && cfg.byCompany && Array.isArray(cfg.byCompany[companyId]));
  if (scope === "global") return global;
  if (scope === "company") return own;
  return global || own;
}

/* ---- reducers, mutating the caller's doc clone per dashboard.update ---- */

/** Write the selected key list to one scope, preserving the other layer. */
export function setKpiKeys(doc, companyId, keys, scope) {
  const cur = cfgOf(doc);
  const next = { global: cur.global, byCompany: { ...(cur.byCompany || {}) } };
  const list = Array.isArray(keys) ? [...keys] : [];
  if (scope === "global") next.global = list;
  else next.byCompany[companyId] = list;
  doc.kpiSnapshot = next;
  return doc;
}

/** Drop a scope's override. Returns null (no-op for update()) when there was
 *  nothing to reset. Cleans up empty containers so hasKpiOverride stays honest. */
export function resetKpiKeys(doc, companyId, scope) {
  if (!hasKpiOverride(doc, companyId, scope)) return null;
  const cur = cfgOf(doc);
  const next = { global: cur.global, byCompany: { ...(cur.byCompany || {}) } };
  if (scope === "global") delete next.global;
  else delete next.byCompany[companyId];
  if (!Array.isArray(next.global) && Object.keys(next.byCompany).length === 0) delete doc.kpiSnapshot;
  else doc.kpiSnapshot = next;
  return doc;
}
