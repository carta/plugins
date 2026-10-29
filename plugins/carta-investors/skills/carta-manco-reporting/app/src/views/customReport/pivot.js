// The pivot behind a custom report: the fields it can lay out, the cut a save bakes in, the
// row tree and column grid built from the ledger entries, and how a source budget's figures
// join onto them. Pure functions only, so the view and its tests share one set of rules.
import { monthLabel, quarterLabel } from "../budgetPeriods.js";
import { INCOME_SECTION, EXPENSE_SECTION, accountPolarity } from "../accountSections.js";
import { fmtCurrencyWhole } from "../../charts/chartTheme.js";
import { varianceColor, fmtVarianceWhole } from "../../ui/variance.js";
import { MICRO } from "../../ui/theme.js";

export const SEP = " › "; // joins a composite column key's parts, e.g. "Vendor › Quarter"
export const TOTAL_KEY = "_total_";       // the lone column key when Columns is empty
export const ROW_TOTAL_KEY = "_row_total_"; // synthetic column key meaning "summed across all visible columns"

// Time fields, derived from the entry date rather than the census below. A time column is one
// calendar period, so its key carries the year ("2026-01", "2026-Q1"): the same month of two
// years stays two columns, and a key sorts in date order. `display` is the heading, worded as
// Budget vs Actuals' own period columns ("January 2026", "Q1 2026").
const yearOf = e => String(e.date || "").slice(0, 4);
const monthOf = e => e.mo || 1;
const quarterOf = e => Math.ceil(monthOf(e) / 3);
// A time key's period: { year, month } or { year, quarter }.
export function periodOfKey(key) {
  const [, year, month, quarter] = /^(\d{4})-(?:(\d{2})|Q(\d))$/.exec(key) || [];
  return year ? { year: Number(year), ...(month ? { month: Number(month) } : { quarter: Number(quarter) }) } : null;
}
// Date order: a year, then its month or quarter.
const orderOf = (key) => { const p = periodOfKey(key); return p ? p.year * 100 + (p.month || p.quarter) : 0; };
export const TIME_FIELDS = {
  month:   { label: "Month",   source: "reporting_tag", category: "Month",
             get: e => `${yearOf(e)}-${String(monthOf(e)).padStart(2, "0")}`, order: orderOf,
             display: e => monthLabel(monthOf(e), yearOf(e)) },
  quarter: { label: "Quarter", source: "reporting_tag", category: "Quarter",
             get: e => `${yearOf(e)}-Q${quarterOf(e)}`, order: orderOf,
             display: e => quarterLabel(quarterOf(e), yearOf(e)) },
  kind:    { label: "Type",    source: "reporting_tag", category: "Type",
             get: e => e.kind === "income" ? "Income" : "Expense" },
};

// Droppable only into Values. Budget/Variance aren't summed from entries —
// they're resolved per-row from the source budget (see budgetInfoFor).
export const VALUE_FIELDS = {
  actual:   { label: "Actual",  isValue: true, get: e => e.amount || 0 },
  budget:   { label: "Budget",  isValue: true },
  variance: { label: "Var $",   isValue: true },
};

// A field an entry may carry no value for: `none` is what its getter names that case
// ("No vendor"), shown as is in rows and filters, and left out of a nested row level (see
// buildRowTree).
export const dimension = (label, read, extra) => {
  const none = `No ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  return { label, none, get: e => read(e) || none, ...extra };
};

// Builds every droppable field from accountsData.rowDimensions — the same per-firm census
// (every reporting tag, vendor, sub-account) the real Budget vs Actuals "Break rows out by"
// panel reads. `source` is a buildBudgetLookup result, or null.
export function buildFields(accountsData, source) {
  const account = (label) => dimension(label || "GL Account", e => e.account, { source: "account" });
  const vendor = (label) => dimension(label || "Vendor", e => e.vendor, { source: "vendor" });
  const fields = {};
  for (const d of accountsData?.rowDimensions || []) {
    if (!d.value_count) continue;
    if (d.source === "account") {
      fields.account = account(d.label);
    } else if (d.source === "vendor") {
      fields.vendor = vendor(d.label);
    } else if (d.source === "sub_account") {
      fields.sub_account = dimension(d.label || "Sub-account", e => e.sub, { source: "sub_account" });
    } else if (d.source === "reporting_tag" && d.category) {
      fields[`tag:${d.category}`] = dimension(d.category,
        e => (e.tags || []).find(t => t.category === d.category)?.value,
        { source: "reporting_tag", category: d.category });
    }
  }
  if (!fields.account) fields.account = account();
  if (!fields.vendor) fields.vendor = vendor();
  // The source budget's own lines (a bucket of accounts, say), when it has any to offer.
  if (source?.lineOfGl.size) {
    fields.line = dimension("Budget line", e => source.lineOfGl.get(e.acct_type),
                            { source: "reporting_tag", category: "Budget line" });
  }
  return { ...fields, ...TIME_FIELDS, ...VALUE_FIELDS };
}

// A row's key: its parent's key, then this level's field and value.
const rowKey = (parentKey, field, value) => (parentKey ? `${parentKey}|${field}:${value}` : `${field}:${value}`);

// The column key an entry falls under for `colFields`: the lone TOTAL_KEY when there are none.
export const colKeyOf = (e, fields, colFields) =>
  (colFields.length ? colFields.map(f => fields[f].get(e)).join(SEP) : TOTAL_KEY);

// One level of the row outline: groups filtered entries by rowFields[level],
// recursing into rowFields[level+1] for each group's own children. Below the top level,
// entries with no value for the field get no row of their own — a line with no vendors
// shows no "No vendor" child; its own figures already count them.
// long-comment-ok: scopes must stay structured, not string-parsed from key
// `scopes` is the root-to-here (field, value) breadcrumb, kept structured
// rather than parsed out of `key` (a tag field's key already has a ":").
export function buildRowTree(entries, fields, rowFields, actualGetter, parentKey = null, parentScopes = [], level = 0) {
  if (level >= rowFields.length) return null;
  const fieldKey = rowFields[level];
  const getter = fields[fieldKey].get;
  const none = level > 0 ? fields[fieldKey].none : undefined;
  const buckets = new Map();
  for (const e of entries) {
    const v = getter(e);
    if (none !== undefined && v === none) continue;
    if (!buckets.has(v)) buckets.set(v, []);
    buckets.get(v).push(e);
  }
  const nodes = [...buckets.entries()].map(([value, subEntries]) => {
    const key = rowKey(parentKey, fieldKey, value);
    const scopes = [...parentScopes, { field: fieldKey, value }];
    return {
      key, field: fieldKey, value, depth: level, entries: subEntries, scopes,
      absTotal: subEntries.reduce((s, e) => s + Math.abs(actualGetter(e)), 0),
      children: buildRowTree(subEntries, fields, rowFields, actualGetter, key, scopes, level + 1),
    };
  });
  nodes.sort((a, b) => b.absTotal - a.absTotal);
  return nodes;
}

// Every node — group or leaf — aggregates its OWN full entry set by column,
// so a group's figures are a true subtotal regardless of what's collapsed.
export function attachColData(nodes, fields, colFields, actualGetter) {
  for (const node of nodes) {
    const data = new Map();
    for (const e of node.entries) {
      const colKey = colKeyOf(e, fields, colFields);
      data.set(colKey, (data.get(colKey) || 0) + actualGetter(e));
    }
    node.data = data;
    if (node.children) attachColData(node.children, fields, colFields, actualGetter);
  }
}

// The row keys an entry sits under for `rowFields`, the same keys buildRowTree gives its rows.
export function rowKeysOf(entry, fields, rowFields) {
  const out = [];
  for (const f of rowFields) {
    out.push(rowKey(out[out.length - 1], f, fields[f].get(entry)));
  }
  return out;
}

// A filter's chosen values; none chosen means all of them.
export const selectedValues = (v) => (Array.isArray(v) ? v : []);

// The chosen values as a short phrase: "Finance, IT", or "Finance, IT +3" for more.
export const summarize = (values) =>
  (values.length <= 2 ? values.join(", ") : `${values.slice(0, 2).join(", ")} +${values.length - 2}`);

// One save's cut: the filter values in force and the rows hidden at that moment.
export function cutOf(zones, filterSelections, hiddenRows) {
  const filters = Object.fromEntries(zones.filters
    .filter(f => selectedValues(filterSelections[f]).length)
    .map(f => [f, selectedValues(filterSelections[f])]));
  const keys = [...hiddenRows];
  return { ...(Object.keys(filters).length ? { filters } : null),
           ...(keys.length ? { hidden: { rows: zones.rows, keys } } : null) };
}

// The entries a report holds once its cut is applied — the data a saved custom report is,
// whatever else the ledger carries. A filter with no value chosen, or naming a field this
// firm no longer has, is skipped.
export function applyCut(entries, fields, cut) {
  if (!cut) return entries;
  const known = Object.entries(cut.filters || {}).filter(([f]) => fields[f])
    .map(([f, v]) => [f, selectedValues(v)]).filter(([, v]) => v.length);
  const hiddenKeys = new Set(cut.hidden?.keys || []);
  const rows = (cut.hidden?.rows || []).filter(f => fields[f]);
  return entries.filter(e => known.every(([f, v]) => v.includes(fields[f].get(e)))
    && !(hiddenKeys.size && rowKeysOf(e, fields, rows).some(k => hiddenKeys.has(k))));
}

// A field's values in Statement of Ops order, as the Carta app breaks them out: by date for a
// time field, otherwise alphabetically with the no-value bucket ("No events") after every real value.
export function compareFieldValues(f, a, b) {
  if (a === b) return 0;
  if (f?.order) return f.order(a) - f.order(b);
  if (f?.none !== undefined && (a === f.none) !== (b === f.none)) return a === f.none ? 1 : -1;
  return a < b ? -1 : 1;
}

// Column order: field by field, each by compareFieldValues.
function compareCols(a, b, colFields, fields) {
  const as = a.split(SEP), bs = b.split(SEP);
  for (let i = 0; i < colFields.length; i++) {
    const c = compareFieldValues(fields[colFields[i]], as[i], bs[i]);
    if (c) return c;
  }
  return 0;
}

export function buildReportGrid(entries, fields, savedZones, filterSelections) {
  // A saved zone may name a field this firm's data no longer carries (a since-removed tag).
  const keep = (list) => list.filter(f => fields[f]);
  const zones = { ...savedZones, rows: keep(savedZones.rows), columns: keep(savedZones.columns), filters: keep(savedZones.filters) };
  const rowFields = zones.rows;
  const colFields = zones.columns;
  const actualGetter = fields.actual.get;
  if (rowFields.length === 0) return { tree: [], cols: [], colLabels: new Map() };

  const filtered = applyCut(entries, fields,
    { filters: Object.fromEntries(zones.filters.map(f => [f, filterSelections[f]])) });

  const colLabels = new Map();
  const colSet = new Set();
  for (const e of filtered) {
    const colKey = colKeyOf(e, fields, colFields);
    if (!colLabels.has(colKey)) {
      colLabels.set(colKey, colFields.length
        ? colFields.map(f => (fields[f].display || fields[f].get)(e)).join(SEP) : "Total");
    }
    colSet.add(colKey);
  }
  const cols = [...colSet];
  cols.sort((a, b) => compareCols(a, b, colFields, fields));

  const tree = buildRowTree(filtered, fields, rowFields, actualGetter, null, [], 0) || [];
  attachColData(tree, fields, colFields, actualGetter);

  return { tree, cols, colLabels };
}

// Non-mutating re-sort of every level of the tree by one column's actual
// value — `tree` itself stays memoized independent of sort state.
export function sortedTree(nodes, colKey, dir) {
  if (!nodes) return nodes;
  const copy = nodes.map(n => ({ ...n, children: sortedTree(n.children, colKey, dir) }));
  copy.sort((a, b) => dir * ((a.data.get(colKey) || 0) - (b.data.get(colKey) || 0)));
  return copy;
}

// Depth-first list of visible nodes: a hidden node drops its whole subtree,
// a collapsed node keeps itself but skips its children.
export function flattenTree(nodes, collapsedKeys, hiddenKeys, out = []) {
  for (const node of nodes) {
    if (hiddenKeys.has(node.key)) continue;
    out.push(node);
    if (node.children?.length && !collapsedKeys.has(node.key)) {
      flattenTree(node.children, collapsedKeys, hiddenKeys, out);
    }
  }
  return out;
}

// A line-item budget (rows are its own lines), as against a by-account one.
const isLineItemBudget = (b) => !(b.view_kinds || []).includes("by-account");

// A source budget's figures, for the rows they describe exactly. Leaving a figure out never
// removes actuals: `covered` is every GL account any of the budget's line rows names, so a
// line-item source's report covers all of them (see scopeEntries).
// A figure attaches to a row only when the row's actuals are what the line budgets. Budget vs
// Actuals narrows a line's actuals by department tag, scope, fund or excluded claims, and
// withholds an unresolved or void one; this report has no such slice, so those lines give no
// figure (their accounts fall under "No budget line" and show "—"). A GL account belongs to at
// most one line: one that two lines name belongs to neither, so it has no per-account entry,
// no line, and no figure on a line that names it. Beyond that, an account row takes its figure
// only from a line budgeting that one account, and a row of the source's own lines takes the
// line's, by label.
// `lineOfGl` names each account's line; `scoped` is a line-item budget, whose report covers
// only the accounts its lines name (a by-account one shows every account, as its page does).
// `year` is the budget's period year: its months and quarters only describe that year.
export function buildBudgetLookup(snapshot, budgetId) {
  const budgets = snapshot?.budget?.budgets || [];
  const budget = budgets.find(b => b.id === budgetId) || null;
  if (!budget) return null;
  const sliced = (row) => row.void || row.scope_unresolved || row.fund_match || row.tag_value
    || row.scopes?.length || row.excluded_claims?.length;
  const named = (budget.rows || []).filter(row =>
    (!row.row_kind || row.row_kind === "line") && (row.gl_codes || []).length);
  const covered = new Set(named.flatMap(row => row.gl_codes));
  const lines = named.filter(row => !sliced(row));
  const linesOfGl = new Map();
  for (const row of lines) for (const gl of new Set(row.gl_codes)) linesOfGl.set(gl, (linesOfGl.get(gl) || 0) + 1);
  const shared = (gl) => linesOfGl.get(gl) > 1;

  const map = new Map(), byLine = new Map(), lineOfGl = new Map();
  for (const row of lines) {
    const codes = row.gl_codes;
    const entry = { monthly: Array.isArray(row.monthly) ? row.monthly : [], annual: row.annual || 0 };
    if (codes.length === 1 && !shared(codes[0])) map.set(codes[0], entry);
    if (row.label && !byLine.has(row.label) && !codes.some(shared)) byLine.set(row.label, { ...entry, order: byLine.size });
    for (const gl of codes) if (!shared(gl)) lineOfGl.set(gl, row.label);
  }
  const year = budget.period_year || budget.workbook_meta?.period_year
    || Number(String(snapshot?.asOf || "").slice(0, 4)) || null;
  return { id: budget.id, label: budget.label || budget.id, map, byLine, lineOfGl, covered, year, scoped: isLineItemBudget(budget) };
}

// The entries a source's report covers: every account a line-item source's lines name, or everything.
export const scopeEntries = (entries, lookup) =>
  (lookup?.scoped ? entries.filter(e => lookup.covered.has(e.acct_type)) : entries);

// A new report lays out its source as that source's own page does: by its lines for a
// line-item budget that leaves any line to group by, by GL account otherwise.
export const defaultRowsFor = (lookup) => (lookup?.scoped && lookup.lineOfGl.size ? ["line"] : ["account"]);

// A row's GL code: every entry under a GL account row shares it.
export const glOf = (node) => node.entries[0]?.acct_type ?? 0;

// Budget only carries a month-phased shape for its own year, so a slice only resolves when
// the column axis is none/month/quarter and the column is a period of `year`: anything else
// has no budget analog.
export function budgetAmountFor(entry, colKey, colFieldKey, year) {
  if (!entry) return null;
  if (!colFieldKey) return entry.annual;
  const p = periodOfKey(String(colKey));
  if (!year || p?.year !== year) return null;
  if (colFieldKey === "month" && p.month >= 1 && p.month <= 12) return entry.monthly[p.month - 1] || 0;
  if (colFieldKey === "quarter" && p.quarter >= 1 && p.quarter <= 4) {
    const from = (p.quarter - 1) * 3;
    return entry.monthly.slice(from, from + 3).reduce((s, v) => s + (v || 0), 0);
  }
  return null;
}

// A whole-account budget only compares with that account's whole actuals: a filter or a
// hidden row that cuts inside an account (a vendor, a tag, a sub-account) leaves it blank.
export function isBudgetComparable(cut) {
  const insideAccount = (f) => f !== "account" && f !== "line" && !TIME_FIELDS[f];
  return !(Object.keys(cut.filters || {}).some(insideAccount)
    || (cut.hidden?.keys || []).some(k => k.includes("|") || !/^(account|line):/.test(k)));
}

// The budget a row shows for one column: `{amt, polarity}`, or null when it has none.
// Budget resolves only for a row grouped by GL account or by the source's own line, and only
// when no row above it narrows its entries below what the budget covers: a Vendor sub-row
// under one, an account under a vendor, a line under an account, or a month slice against an
// annual budget has no matching budget. Only a Type ancestor (and a line above an account)
// leaves the slice whole. A line spanning several accounts has no per-account entry, so its
// accounts' rows show none rather than repeating the line's figure on each.
// `ctx`: `lookup` (buildBudgetLookup result, null for no budget), `colFieldKey`, `visibleCols`.
export function budgetInfoFor(node, colKey, { lookup, colFieldKey, visibleCols }) {
  if (!lookup) return null;
  const whole = node.field === "account" ? ["kind", "line"] : ["kind"];
  if (node.scopes.slice(0, -1).some(s => !whole.includes(s.field))) return null;
  const entry = node.field === "account" ? lookup.map.get(node.entries[0]?.acct_type)
              : node.field === "line" ? lookup.byLine.get(node.value) : null;
  if (!entry) return null;
  const polarity = accountPolarity(glOf(node));
  if (colKey === ROW_TOTAL_KEY) {
    let t = 0, any = false;
    for (const c of visibleCols) {
      const amt = budgetAmountFor(entry, c, colFieldKey, lookup.year);
      if (amt != null) { t += amt; any = true; }
    }
    return any ? { amt: t, polarity } : null;
  }
  const amt = budgetAmountFor(entry, colKey, colFieldKey, lookup.year);
  return amt == null ? null : { amt, polarity };
}

// A node's actual for one column; ROW_TOTAL_KEY sums the visible columns.
export function actualFor(node, colKey, visibleCols) {
  if (colKey === ROW_TOTAL_KEY) return visibleCols.reduce((s, c) => s + (node.data.get(c) || 0), 0);
  return node.data.get(colKey);
}

// One measure's cell for one actual and budget (`{amt, polarity}` or null): the unit each
// sub-column of the grid renders, for a row and a total alike. A null polarity (a total
// mixing income and expense) leaves the variance uncoloured.
export function valueCell(vf, actual, budgetInfo) {
  if (vf === "actual") return { text: actual != null ? fmtCurrencyWhole(actual) : "—" };
  if (vf === "budget") return { text: budgetInfo ? fmtCurrencyWhole(budgetInfo.amt) : "—" };
  if (vf === "variance") {
    if (!budgetInfo) return { text: "—", color: MICRO };
    const v = (actual || 0) - budgetInfo.amt;
    return { text: fmtVarianceWhole(v), ...(budgetInfo.polarity ? { color: varianceColor(v, budgetInfo.polarity) } : null) };
  }
  return { text: "—" };
}

// A total row's cells for one column. It sums only the top-level `nodes`: a child's figures
// are already in its parent's. Its budget is the sum of the budgets those rows show, and
// blank when none shows one.
export function totalCells(nodes, colKey, values, polarity, actualOf, budgetOf) {
  const actual = nodes.reduce((s, n) => s + (actualOf(n, colKey) || 0), 0);
  const shown = nodes.map(n => budgetOf(n, colKey)).filter(Boolean);
  const budgetInfo = shown.length ? { amt: shown.reduce((s, b) => s + b.amt, 0), polarity } : null;
  return values.map(vf => valueCell(vf, actual, budgetInfo));
}

// "income" or "expense" when every top-level row is on that side; a total mixing both has
// no single polarity.
export function footerPolarityOf(topRows) {
  const sides = new Set(topRows.flatMap(n => n.entries.map(e => accountPolarity(e.acct_type))));
  return sides.size === 1 ? [...sides][0] : null;
}

// Income, then Operating Expenses, each with its rows in tree order (a child follows its
// parent, whatever its own accounts); a section with no rows is left out.
export function sectionsOf(visibleRows) {
  return [INCOME_SECTION, EXPENSE_SECTION].map(sec => {
    const rows = [];
    let inSection = false;
    for (const n of visibleRows) {
      if (n.depth === 0) inSection = accountPolarity(glOf(n)) === sec.polarity;
      if (inSection) rows.push(n);
    }
    return { ...sec, rows };
  }).filter(sec => sec.rows.length);
}

// The raw entries behind one (node, column) cell — the same slice
// actualFor/node.data summed, so a drilldown can't drift from its figure.
export function entriesForCol(node, colFields, fields, colKey, visibleColSet) {
  if (!colFields.length) return node.entries; // TOTAL_KEY: nothing to slice by
  if (colKey === ROW_TOTAL_KEY) {
    return node.entries.filter(e => visibleColSet.has(colKeyOf(e, fields, colFields)));
  }
  return node.entries.filter(e => colKeyOf(e, fields, colFields) === colKey);
}

// A node's row-field breadcrumb, in the {source, category, value} shape
// DrilldownContent's scopeLabel already knows how to render.
export function drilldownScopes(node, fields) {
  return node.scopes.map(({ field, value }) => {
    const f = fields[field];
    return { source: f?.source || "reporting_tag", category: f?.category, value };
  });
}
