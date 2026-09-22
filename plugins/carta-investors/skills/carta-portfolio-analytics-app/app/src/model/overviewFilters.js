// doc.filters: { id, kind, key, cond }[] over the column catalog — one per kind:key, AND across filters.
// cond is { op, a, b?, blanks? } for number/date columns or { any: [value] } (OR within) for category columns.
import { columnValueType, columnUnit, columnLabel, columnFilterValue, columnCategoryOptions, columnCatalog, catalogToOptions } from "./overviewColumns.js";
import { buildOverviewRow } from "./overviewRow.js";
import { fmtVal } from "../ui/charts.jsx";

export const FILTER_OPS = [
  { id: "lt", sym: "<", dateWord: "before" },
  { id: "lte", sym: "≤", dateWord: "on or before" },
  { id: "eq", sym: "=", dateWord: "on" },
  { id: "gte", sym: "≥", dateWord: "on or after" },
  { id: "gt", sym: ">", dateWord: "after" },
  { id: "between", sym: "between", dateWord: "between" },
];
const opOf = (id) => FILTER_OPS.find((o) => o.id === id) || FILTER_OPS[0];

export const specKey = (s) => `${s.kind}:${s.key}`;

const listRaw = (doc) => (doc && Array.isArray(doc.filters) ? doc.filters : []);
const isBlankBound = (x) => x == null || x === "";

/** True when the condition constrains nothing — the editor's "Apply" with no
 *  input, or every checkbox unticked. `blanks` alone is not a filter. */
export function isEmptyCond(valueType, cond) {
  if (!cond) return true;
  if (valueType === "category") return !(cond.any && cond.any.length);
  return isBlankBound(cond.a);
}

/** Does one value satisfy one condition? `value` is a scalar for number/date
 *  (null = blank) or a Set for category (empty = blank). */
export function condMatches(valueType, cond, value) {
  if (isEmptyCond(valueType, cond)) return true;
  if (valueType === "category") {
    if (!value || value.size === 0) return false;
    return cond.any.some((v) => value.has(v));
  }
  if (value == null) return !!cond.blanks;
  const coerce = valueType === "number" ? Number : String;
  const a = coerce(cond.a), b = isBlankBound(cond.b) ? a : coerce(cond.b);
  switch (cond.op) {
    case "lt": return value < a;
    case "lte": return value <= a;
    case "eq": return value === a;
    case "gte": return value >= a;
    case "gt": return value > a;
    case "between": return value >= a && value <= b;
    default: return true;
  }
}

/** Stored filters whose column is still in the catalog. A stale one (a KPI the
 *  firm stopped reporting, a tag category that vanished) is dropped, the same
 *  self-heal readColumns does. A category *value* nobody carries any more is
 *  kept — dropping it would silently change what the filter means. */
export function readFilters(doc, data, ctx = {}) {
  const inCatalog = new Set(catalogToOptions(columnCatalog(data, [], ctx)).map((o) => o.id));
  return listRaw(doc).filter((f) => f && f.id && f.kind && f.key && f.cond && inCatalog.has(specKey(f)));
}

export const filterFor = (filters, kind, key) => (filters || []).find((f) => f.kind === kind && f.key === key);

let _seq = 0;
const newId = (kind, key) => `flt-${kind}-${key}-${++_seq}`.replace(/[^a-zA-Z0-9:_-]/g, "");

/** Upsert the one filter for a column. An empty cond removes it instead, so the
 *  editor has a single "Apply" path. Mutates and returns the caller's doc. */
export function setFilter(doc, { kind, key, cond }) {
  if (!kind || !key) return null;
  const list = listRaw(doc);
  const rest = list.filter((f) => !(f.kind === kind && f.key === key));
  if (isEmptyCond(columnValueType({ kind, key }), cond)) { doc.filters = rest; return doc; }
  const existing = list.find((f) => f.kind === kind && f.key === key);
  doc.filters = [...rest, { id: existing?.id || newId(kind, key), kind, key, cond }];
  return doc;
}

export function removeFilter(doc, kind, key) {
  const list = listRaw(doc);
  const next = list.filter((f) => !(f.kind === kind && f.key === key));
  if (next.length === list.length) return null;
  doc.filters = next;
  return doc;
}

export function clearFilters(doc) { doc.filters = []; return doc; }

/** `(company) => boolean` over every filter. The health row `h` is built once
 *  per company since several builtins read it. */
export function filterPredicate(filters, data, ctx = {}) {
  const active = (filters || []).filter((f) => !isEmptyCond(columnValueType(f), f.cond));
  if (!active.length) return () => true;
  return (company) => {
    const h = buildOverviewRow(data, company.id);
    return active.every((f) => condMatches(columnValueType(f), f.cond, columnFilterValue(f, data, company, h, ctx)));
  };
}

const fmtBound = (spec, data, x) => {
  const unit = columnUnit(spec, data);
  if (unit === "Months") return `${Number(x)}mo`;
  return fmtVal(Number(x), unit, null, unit === "Dollar" ? data.source?.currency : undefined);
};

/** Chip text: "Industry: SaaS" / "Industry (3)" / "MOIC ≥ 2.00×" /
 *  "ARR €1.00M–€5.00M" / "Last responded before 2026-06-30". */
export function filterLabel(filter, data, ctx = {}) {
  const label = columnLabel(filter, data);
  const vt = columnValueType(filter);
  const c = filter.cond;
  if (vt === "category") {
    const any = c.any || [];
    if (any.length !== 1) return `${label} (${any.length})`;
    const opt = columnCategoryOptions(filter, data, ctx).find((o) => o.value === any[0]);
    return `${label}: ${opt ? opt.label : any[0]}`;
  }
  const op = opOf(c.op);
  const blanks = c.blanks ? " (or blank)" : "";
  if (vt === "date") {
    return op.id === "between" ? `${label} ${c.a}–${c.b}${blanks}` : `${label} ${op.dateWord} ${c.a}${blanks}`;
  }
  return op.id === "between"
    ? `${label} ${fmtBound(filter, data, c.a)}–${fmtBound(filter, data, c.b)}${blanks}`
    : `${label} ${op.sym} ${fmtBound(filter, data, c.a)}${blanks}`;
}
