// Company tags from Fund Admin, in the firm's own categories. READ-ONLY: no MCP
// write path exists, so the app must never imply it saves back.
// Pure functions over kpi.json, like model/rules.js.

import { STATUS_CAT, statusOf, statusValues } from "./status.js";

// A category can contain a space ("My tags"), so the id needs a separator that
// cannot occur in either half. Unit Separator is not typeable into a tag.
const SEP = "";

/** A stable identity for one tag, used as a Set key and a React key. */
export const tagId = (cat, value) => `${cat}${SEP}${value}`;
const catOf = (id) => id.slice(0, id.indexOf(SEP));

/** Carta tags for a company, falling back to the two fields an older cache has.
 *
 *  A kpi.json built before tags existed carries only returns.sector/country. Reading
 *  those keeps a stale cache showing what it always showed, instead of going blank
 *  until the user re-runs the fetch. */
function cartaTagsOf(company) {
  const out = [];
  // Derived, not fetched — see model/status.js. Read-only like the rest here.
  const status = statusOf(company);
  if (status) out.push({ cat: STATUS_CAT, value: status, src: "carta" });
  if (company?.tags?.length) {
    for (const t of company.tags) out.push({ cat: t.cat, value: t.value, src: "carta" });
    return out;
  }
  const ret = company?.returns || {};
  if (ret.sector) out.push({ cat: "Industry", value: ret.sector, src: "carta" });
  if (ret.country) out.push({ cat: "Country", value: ret.country, src: "carta" });
  return out;
}

/** Tag list for a company: Status first, then the firm's Carta categories.
 *  Each entry is { cat, value, src }. */
export function tagsFor(company) {
  return cartaTagsOf(company);
}

/** Every tag in the portfolio, grouped for the filter menu. Carta categories in
 *  the order the build emitted them. */
export function allTags(data) {
  let dims = data?.dimensions?.tags;
  if (!dims?.length) {
    // Older cache: no tag dimension was built, so derive the menu from whatever
    // the companies carry (including the sector/country fallback).
    const byCat = new Map();
    for (const c of data?.companies || []) {
      for (const t of cartaTagsOf(c)) {
        if (!byCat.has(t.cat)) byCat.set(t.cat, new Set());
        byCat.get(t.cat).add(t.value);
      }
    }
    dims = [...byCat.keys()].sort().map((cat) => ({ cat, values: [...byCat.get(cat)].sort() }));
  }
  // Status is computed, so it is never in a prebuilt `dimensions` blob and is
  // dropped from the derived path too — both get the same STATUS_ORDER group
  // below rather than an alphabetised one.
  const groups = dims
    .filter((g) => g.cat !== STATUS_CAT)
    .map((g) => ({ cat: g.cat, src: "carta", values: [...(g.values || [])] }));
  const statuses = statusValues(data);
  if (statuses.length) groups.unshift({ cat: STATUS_CAT, src: "carta", values: statuses });
  return groups;
}

/** True when the firm has no Carta tags at all. A firm without Fund Admin
 *  holdings has no tag source, and the UI says so rather than looking broken. */
export const hasCartaTags = (data) =>
  (data?.dimensions?.tags || []).length > 0 ||
  (data?.companies || []).some((c) => cartaTagsOf(c).length > 0);

/** Does a company pass the tag filter?
 *
 *  OR within a category, AND across categories — two industries widens the set,
 *  an industry AND a country narrows it. An empty selection matches everything.
 */
export function companyMatchesTags(company, selectedIds) {
  if (!selectedIds || selectedIds.size === 0) return true;
  const have = new Set(tagsFor(company).map((t) => tagId(t.cat, t.value)));
  const wantByCat = new Map();
  for (const id of selectedIds) {
    const cat = catOf(id);
    if (!wantByCat.has(cat)) wantByCat.set(cat, []);
    wantByCat.get(cat).push(id);
  }
  for (const ids of wantByCat.values()) {
    if (!ids.some((id) => have.has(id))) return false;
  }
  return true;
}
