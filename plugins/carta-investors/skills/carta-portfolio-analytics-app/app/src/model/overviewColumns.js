// doc.columns: ordered specs { id, kind: "metric"|"position"|"builtin"|"fund"|"tag"|"favorite"|"signal", key, spark?, delta? }.
// doc.filters (model/overviewFilters.js) reads this same catalog — anything addable as a column is filterable.

import { metricOf, metricKeyByLabel, latest, changeOverMonths, numericMetrics, metricOptions } from "./kpi.js";
import { positionMetricOf, availablePositionMetrics, positionMetricOptions, POSITION_METRICS } from "./position.js";
import { buildOverviewRow } from "./overviewRow.js";
import { allTags, tagsFor } from "./tags.js";
import { isFavorite, favoriteCount } from "./favorites.js";
import { BUILTIN_SIGNALS } from "./signals.js";
import { ruleCondition } from "./rules.js";
import { fmtVal } from "../ui/charts.jsx";

// Static fallback (used when `data` isn't available to resolve EBITDA's key).
export const DEFAULT_COLUMNS = [
  { id: "moic", kind: "builtin", key: "moic" },
  { id: "value", kind: "builtin", key: "value" },
  { id: "invested", kind: "builtin", key: "invested" },
  { id: "lastResponded", kind: "builtin", key: "lastResponded" },
];

/** The recommended starting stack: EBITDA (with a QoQ delta) when the firm
 *  reports it, then MOIC, Value, Invested, Last responded. Data-aware because a
 *  metric column needs the dataset's actual EBITDA key. */
export function defaultColumns(data) {
  const ebitdaKey = data ? metricKeyByLabel(data, /^ebitda$/i) : null;
  const ebitda = ebitdaKey ? [{ id: "ebitda", kind: "metric", key: ebitdaKey, spark: true, delta: "qoq" }] : [];
  return [...ebitda, ...DEFAULT_COLUMNS];
}

const listRaw = (doc) => (doc && Array.isArray(doc.columns) ? doc.columns : []);

const CATEGORY_KINDS = new Set(["fund", "tag", "favorite", "signal"]);
const KINDS = new Set(["builtin", "metric", "position", ...CATEGORY_KINDS]);

/** A spec is valid if it's well-formed AND names something that still exists:
 *  a builtin in BUILTIN_LABELS, a tag category the data carries, a fund when the
 *  firm has any. metric/position specs are kept even if unreported (render "—").
 *  Without `data` the data-dependent kinds are kept — nothing to check against. */
function isValidSpec(c, data) {
  if (!c || !c.id || !c.kind || !c.key || !KINDS.has(c.kind)) return false;
  if (c.kind === "builtin") return Object.prototype.hasOwnProperty.call(BUILTIN_LABELS, c.key);
  if (!data) return true;
  if (c.kind === "tag") return allTags(data).some((g) => g.cat === c.key);
  if (c.kind === "fund") return (data.dimensions?.funds || []).length > 0;
  return true;
}

/** Configured columns (dropping stale specs), or the recommended default stack
 *  (data-aware, see defaultColumns) when none remain. */
export function readColumns(doc, data) {
  const list = listRaw(doc).filter((c) => isValidSpec(c, data));
  return list.length ? list : defaultColumns(data);
}

/** Rewrite `doc.columns` in place to only valid specs — the panel calls this
 *  before an index-based mutation so the stored array matches what `readColumns`
 *  displays (otherwise a drag index would point at a filtered-out spec). */
export function sanitizeColumns(doc, data) {
  doc.columns = listRaw(doc).filter((c) => isValidSpec(c, data));
  return doc;
}

/** Sanitize, then materialize the default stack when nothing valid remains — so
 *  the raw array the reducers act on matches what readColumns displays. Call
 *  before addColumn/removeColumn/moveColumn on a possibly never-customized doc. */
export function ensureColumns(doc, data) {
  sanitizeColumns(doc, data);
  if (doc.columns.length === 0) doc.columns = defaultColumns(data).map((c) => ({ ...c }));
  return doc;
}

/** Add or remove the column for a catalog field. Returns the doc, or null when
 *  nothing changed (already present / absent, or removing the last column). */
export function setColumnVisible(doc, data, { kind, key }, on) {
  ensureColumns(doc, data);
  if (on) return addColumn(doc, { kind, key });
  const col = doc.columns.find((c) => c.kind === kind && c.key === key);
  return col ? removeColumn(doc, col.id) : null;
}

let _seq = 0;
const newId = (kind, key) => `col-${kind}-${key}-${++_seq}`.replace(/[^a-zA-Z0-9:_-]/g, "");

/** Append a column; null if a spec with the same kind+key already exists. */
export function addColumn(doc, { kind, key, spark, delta } = {}) {
  if (!kind || !key) return null;
  const list = listRaw(doc);
  if (list.some((c) => c.kind === kind && c.key === key)) return null;
  doc.columns = [...list, { id: newId(kind, key), kind, key, ...(spark ? { spark: true } : {}), ...(delta ? { delta } : {}) }];
  return doc;
}

export function removeColumn(doc, id) {
  const list = listRaw(doc);
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length || next.length === 0) return null; // unknown id, or would empty → no-op
  doc.columns = next;
  return doc;
}

export function moveColumn(doc, from, to) {
  const list = listRaw(doc);
  if (from == null || to == null || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return null;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  doc.columns = next;
  return doc;
}

export function updateColumn(doc, id, patch) {
  const list = listRaw(doc);
  if (!list.some((c) => c.id === id)) return null;
  doc.columns = list.map((c) => (c.id === id ? { ...c, ...patch } : c));
  return doc;
}

export const BUILTIN_LABELS = {
  burn: "Burn/mo", runway: "Runway", band: "Band",
  invested: "Invested", value: "Value", moic: "MOIC", lastResponded: "Last responded",
  entityKind: "Issuer type",
};

// kpi.json companies[].entityKind → label. Order here is the option order.
const ENTITY_KIND_OPTIONS = [
  { value: "carta-customer", label: "Carta customer" },
  { value: "gl-issuer", label: "GL issuer" },
  { value: "paper", label: "Paper company" },
];
export const entityKindLabel = (kind) => ENTITY_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? null;

const FACT_LABELS = { fund: "Fund", favorite: "Favorite", signal: "Signals" };

const isCustom = (key) => String(key).startsWith("custom:");

/** Display label for a spec. A tag column is labelled by its category. */
export function columnLabel(spec, data) {
  if (spec.kind === "builtin") return BUILTIN_LABELS[spec.key] || spec.key;
  if (spec.kind === "position") return positionMetricOf(spec.key)?.label || spec.key;
  if (spec.kind === "tag") return spec.key;
  if (FACT_LABELS[spec.kind]) return FACT_LABELS[spec.kind];
  return metricOf(data, spec.key)?.label || spec.key;
}

const NUMBER_BUILTINS = { invested: "Dollar", value: "Dollar", moic: "Ratio", burn: "Dollar", runway: "Months" };

/** How a column's values compare — drives the filter editor and predicate. */
export function columnValueType(spec) {
  if (CATEGORY_KINDS.has(spec.kind)) return "category";
  if (spec.kind === "builtin") {
    if (spec.key === "lastResponded") return "date";
    if (spec.key === "band") return "category";
    if (spec.key === "entityKind") return "category";
  }
  return "number";
}

/** Unit for a number column — what `fmtVal` needs to render a threshold. "Months"
 *  is local to Runway (fmtVal has no such unit; callers append "mo"). */
export function columnUnit(spec, data) {
  if (columnValueType(spec) !== "number") return null;
  if (spec.kind === "builtin") return NUMBER_BUILTINS[spec.key] || "Number";
  if (spec.kind === "position") return positionMetricOf(spec.key)?.unit || "Number";
  return metricOf(data, spec.key)?.unit || "Number";
}

const BAND_VALUES = ["critical", "caution", "healthy", "strong"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const FAVORITE_VALUE = "Starred";

/** The category values one company carries for a category column. Empty Set =
 *  blank. `ctx` is { dashDoc, hitsByCompany }; see model/overviewFilters.js. */
export function columnCategories(spec, data, company, h, ctx = {}) {
  switch (spec.kind) {
    case "fund": return new Set(company?.funds || []);
    case "tag": return new Set(tagsFor(company).filter((t) => t.cat === spec.key).map((t) => t.value));
    case "favorite": return new Set(company && isFavorite(ctx.dashDoc, company.id) ? [FAVORITE_VALUE] : []);
    case "signal": return new Set(((ctx.hitsByCompany || {})[company?.id] || []).map((hit) => hit.ruleId));
    case "builtin":
      if (spec.key === "entityKind") return new Set(company?.entityKind ? [company.entityKind] : []);
      return new Set(spec.key === "band" && h?.band ? [h.band] : []);
    default: return new Set();
  }
}

const byLabel = (a, b) => a.label.localeCompare(b.label);

/** Every value a category column can take, alphabetical by label, with labels.
 *  Signals are keyed by ruleId but shown by name. Band keeps its severity order. */
export function columnCategoryOptions(spec, data, ctx = {}) {
  switch (spec.kind) {
    case "fund": return (data.dimensions?.funds || []).map((f) => ({ value: f, label: f })).sort(byLabel);
    case "tag": return (allTags(data).find((g) => g.cat === spec.key)?.values || []).map((v) => ({ value: v, label: v })).sort(byLabel);
    case "favorite": return [{ value: FAVORITE_VALUE, label: FAVORITE_VALUE }];
    case "signal": return [
      ...BUILTIN_SIGNALS.map((s) => ({ value: `builtin:${s.id}`, label: s.tag })),
      ...(ctx.dashDoc?.rules || []).map((r) => ({ value: r.id, label: r.name || ruleCondition(data, r) })),
    ].sort(byLabel);
    case "builtin":
      if (spec.key === "entityKind") return ENTITY_KIND_OPTIONS;
      return spec.key === "band" ? BAND_VALUES.map((v) => ({ value: v, label: cap(v) })) : [];
    default: return [];
  }
}

/** The comparable value the filter predicate reads: a scalar (number | ISO
 *  date | null) for number/date columns, a Set of category values otherwise. */
export function columnFilterValue(spec, data, company, h, ctx = {}) {
  return columnValueType(spec) === "category"
    ? columnCategories(spec, data, company, h, ctx)
    : columnSortValue(spec, data, company, h, ctx);
}

// The two reported periods the delta compares: ~3 months back for QoQ, ~12 for
// YoY. Returns {g, cur, prev} so the sparkline can plot the very same pair.
function changeFor(company, key, mode) {
  return mode === "yoy" ? changeOverMonths(company, key, 12, 2) : changeOverMonths(company, key, 3, 1);
}

function deltaOf(company, key, mode) {
  const r = changeFor(company, key, mode);
  if (!r || !Number.isFinite(r.g)) return null;
  return { dir: r.g >= 0 ? "up" : "down", pct: Math.abs(r.g) * 100 };
}

/** Resolved value for a KPI/formula column: latest formatted value, plus an
 *  optional sparkline series and QoQ/YoY delta when the spec asks for them. */
export function metricColumnValue(data, company, spec) {
  const metric = metricOf(data, spec.key);
  const label = metric?.label || spec.key;
  const l = metric ? latest(company, spec.key) : null;
  const text = l && l.v != null ? fmtVal(l.v, metric.unit, l.s, l.cur) : "—";
  // One quarter's worth of change: the previously reported period and the latest.
  // Drawn from the same changeFor() result as the delta, so the shape and the
  // percentage beside it can never describe different periods.
  const ch = spec.spark && metric ? changeFor(company, spec.key, spec.delta) : null;
  const series = ch ? [{ d: ch.prev.d, v: ch.prev.v }, { d: ch.cur.d, v: ch.cur.v }] : null;
  const delta = spec.delta && metric ? deltaOf(company, spec.key, spec.delta) : null;
  return { label, unit: metric?.unit, text, cur: l?.cur, series, delta };
}

/** Resolved value for a position-fact column (single point-in-time fact, no
 *  history) — Dollar-unit facts render in the firm's own currency. */
export function positionColumnValue(data, company, spec) {
  const pm = positionMetricOf(spec.key);
  const v = pm ? pm.value(company) : null;
  const cur = pm && pm.unit === "Dollar" ? data.source?.currency : undefined;
  return { label: pm?.label || spec.key, unit: pm?.unit, text: v == null ? "—" : fmtVal(v, pm.unit, null, cur) };
}

/** Grouped options for the column chooser and the Filters nav, excluding specs
 *  already present (matched by kind+key); every group is alphabetical by label.
 *  "Company facts" holds the categorical firm metadata: Fund (multi-fund firms),
 *  one entry per Carta tag category, Favorites (once anything is starred),
 *  Signals (always — the built-in rule exists whether or not it fires). */
export function columnCatalog(data, presentSpecs = [], ctx = {}) {
  const present = new Set(presentSpecs.map((c) => `${c.kind}:${c.key}`));
  const has = (kind, key) => present.has(`${kind}:${key}`);
  const builtins = Object.keys(BUILTIN_LABELS)
    .filter((k) => k !== "entityKind" && !has("builtin", k)).map((k) => ({ kind: "builtin", key: k, label: BUILTIN_LABELS[k] }));
  const numeric = numericMetrics(data.metrics || []);
  const kpis = metricOptions(numeric.filter((m) => !isCustom(m.key) && !m.injected))
    .filter((o) => !has("metric", o.id)).map((o) => ({ kind: "metric", key: o.id, label: o.label }));
  const formulas = numeric.filter((m) => isCustom(m.key) && !has("metric", m.key))
    .map((m) => ({ kind: "metric", key: m.key, label: m.label }));
  const positions = positionMetricOptions(availablePositionMetrics(data))
    .filter((o) => !has("position", o.id)).map((o) => ({ kind: "position", key: o.id, label: o.label.replace(/ · \d+$/, "") }));
  const facts = [];
  if ((data.dimensions?.funds || []).length > 1) facts.push({ kind: "fund", key: "fund", label: FACT_LABELS.fund });
  for (const g of allTags(data)) facts.push({ kind: "tag", key: g.cat, label: g.cat });
  if ((data.companies || []).some((c) => c.entityKind)) facts.push({ kind: "builtin", key: "entityKind", label: BUILTIN_LABELS.entityKind });
  if (favoriteCount(ctx.dashDoc) > 0) facts.push({ kind: "favorite", key: "favorite", label: FACT_LABELS.favorite });
  facts.push({ kind: "signal", key: "signal", label: FACT_LABELS.signal });
  return [
    { group: "Company facts", options: facts.filter((o) => !has(o.kind, o.key)).sort(byLabel) },
    { group: "Formulas", options: formulas.sort(byLabel) },
    { group: "Position facts", options: positions.sort(byLabel) },
    { group: "KPIs", options: kpis.sort(byLabel) },
    { group: "Computed", options: builtins.sort(byLabel) },
  ].filter((g) => g.options.length);
}

const BAND_RANK = { critical: 0, caution: 1, healthy: 2, strong: 3 };

/** Comparable sort key for a column cell. number | ISO-string | null (nulls
 *  sort last, both directions). `h` is buildOverviewRow(data, company.id).
 *  Category kinds sort by their alphabetically-first label. */
export function columnSortValue(spec, data, company, h, ctx = {}) {
  if (spec.kind === "builtin" && spec.key === "entityKind") return entityKindLabel(company?.entityKind);
  if (spec.kind === "position") { const pm = positionMetricOf(spec.key); const v = pm ? pm.value(company) : null; return v == null ? null : v; }
  if (spec.kind === "metric") { const m = metricOf(data, spec.key); const l = m ? latest(company, spec.key) : null; return l && l.v != null ? l.v : null; }
  if (CATEGORY_KINDS.has(spec.kind)) {
    const labelOf = new Map(columnCategoryOptions(spec, data, ctx).map((o) => [o.value, o.label]));
    const labels = [...columnCategories(spec, data, company, h, ctx)].map((v) => labelOf.get(v) || v).sort();
    return labels[0] ?? null;
  }
  switch (spec.key) { // builtin
    case "invested": return h?.invested?.value ?? null;
    case "value": return h?.value?.value ?? null;
    case "moic": return h?.moic ?? null;
    case "burn": return h?.burn?.value ?? null;
    case "runway": return h?.runway?.months ?? null;
    case "band": return h?.band != null ? BAND_RANK[h.band] : null;
    case "lastResponded": return h?.lastResponded || null;
    default: return null;
  }
}

// Numeric computed values (not position facts) exposed as formula inputs.
const CALC_INPUTS = [
  { key: "CALC_BURN", label: "Burn/mo", unit: "Dollar", get: (h) => (h?.burn ? { v: h.burn.value, cur: h.burn.cur } : null) },
  { key: "CALC_RUNWAY", label: "Runway", unit: "Number", get: (h) => (h?.runway?.months != null ? { v: h.runway.months } : null) },
];

/** Inject numeric position facts + computed values as single-point pseudo-metrics
 *  (one point at the data's as-of date) so the formula engine can reference them
 *  by label. Overview-only; runs BEFORE withCustomMetrics. `injected: true` keeps
 *  them out of the KPI picker (they're offered as formula inputs, not KPI columns). */
export function injectFormulaInputs(data) {
  if (!data || !data.companies) return data;
  const asOf = (data.source && data.source.asOf) || "latest";
  const fundCur = data.source && data.source.currency;
  const present = {};
  const companies = data.companies.map((c) => {
    const h = buildOverviewRow(data, c.id);
    const extra = {};
    for (const pm of POSITION_METRICS) {
      const v = pm.value(c);
      if (v == null) continue;
      present[pm.key] = true;
      extra[pm.key] = [{ d: asOf, v, ...(pm.unit === "Dollar" ? { cur: fundCur } : {}) }];
    }
    for (const ci of CALC_INPUTS) {
      const got = ci.get(h);
      if (!got) continue;
      present[ci.key] = true;
      extra[ci.key] = [{ d: asOf, v: got.v, ...(got.cur ? { cur: got.cur } : {}) }];
    }
    return Object.keys(extra).length ? { ...c, series: { ...(c.series || {}), ...extra } } : c;
  });
  const pseudo = [
    ...POSITION_METRICS.filter((pm) => present[pm.key]).map((pm) => ({ key: pm.key, label: pm.label, unit: pm.unit, injected: true })),
    ...CALC_INPUTS.filter((ci) => present[ci.key]).map((ci) => ({ key: ci.key, label: ci.label, unit: ci.unit, injected: true })),
  ];
  if (!pseudo.length) return data;
  return { ...data, metrics: [...(data.metrics || []), ...pseudo], companies };
}

/** Flatten a columnCatalog into MultiSelect options ({id:"kind:key", label, group}). */
export function catalogToOptions(catalog) {
  const out = [];
  for (const g of catalog) for (const o of g.options) out.push({ id: `${o.kind}:${o.key}`, label: o.label, group: g.group });
  return out;
}
