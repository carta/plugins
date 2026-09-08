import { dimensionValue } from "../ui/dimension.js";
import { glNameMap } from "../ui/glNames.js";

// Spend carrying no value for the chosen breakout. Named once: both tables
// show it, and a reader comparing them should see the same words.
export const UNLABELLED = "Not specified";

// Opening a GL account row up. The workbook is the anchor: a firm that
// already breaks their budget out one way is asking that question, and
// anything else is a breakout they have to be offered before they want it.

// Picker order. The GL account leads because it is the one breakout every
// firm has, so the control reads the same on every report; which breakout
// OPENS is still the workbook's own (see budgetBreakout).
const USEFULNESS = ["account", "sub_account", "reporting_tag", "vendor"];

// Every reporting tag is one control. A firm can keep several categories,
// and a button per category read as several unrelated breakouts rather
// than one question — which tag? — with several answers.
export function groupBreakouts(breakouts) {
  const tags = (breakouts || []).filter(b => b.source === "reporting_tag");
  const rest = (breakouts || []).filter(b => b.source !== "reporting_tag");
  return { tags, rest };
}

/** Breakouts this firm's data supports, GL account first.
 *  An unpopulated source is not offered: an empty breakout reads as an
 *  account with nothing under it, which is a different claim.
 */
export function rowBreakouts(data, budget) {
  const census = data?.rowDimensions || [];
  const opts = census
    .filter(d => d.value_count > 0)
    // Where sub-accounts nest, the account breakout names them and a
    // second control asks the same question in another word.
    .filter(d => !(d.source === "sub_account" && d.nested))
    .map(d => ({
      key: keyOf(d),
      source: d.source,
      category: d.category || null,
      label: d.label || d.category || d.source,
      valueCount: d.value_count,
      withSub: d.source === "account" && !!d.with_sub,
    }))
    .filter(o => !bakedIn(o, budget, data))
    // Census order is by spend, which ranks within a source — two tag
    // categories keep the busier one first.
    .sort((a, b) => USEFULNESS.indexOf(a.source) - USEFULNESS.indexOf(b.source));

  return opts;
}

export function keyOf(d) {
  return d.source === "reporting_tag" ? `reporting_tag:${d.category}` : d.source;
}

/** The dimension a budget's own columns are broken out by, or null.
 *
 *  Adapters emit `dimensions` as bare axis keys ("tag_value") rather than
 *  the {source, category} shape, and a bare hit means the firm's own
 *  scoped category.
 */
export function declaredDimension(budget, data) {
  for (const d of budget?.dimensions || []) {
    if (typeof d === "string") {
      const cat = d === "tag_value" ? data?.dimension?.category : null;
      if (cat) return { source: "reporting_tag", category: cat };
      continue;
    }
    const source = d.source || "reporting_tag";
    if (source === "reporting_tag" && d.category) return { source, category: d.category };
    if (source !== "reporting_tag") return { source };
  }
  return null;
}

/** Whether a scope names the same thing a breakout would open a row by. */
export function sameDimension(scope, breakout) {
  if (!scope || !breakout) return false;
  const source = scope.source || "reporting_tag";
  if (source !== breakout.source) return false;
  return source !== "reporting_tag" || scope.category === breakout.category;
}

/** A breakout the budget already shows, so opening a row repeats the page.
 *
 *  Two ways a workbook bakes one in: its columns ARE that dimension, or
 *  every value of it is already a line of its own.
 */
export function bakedIn(breakout, budget, data) {
  if (!budget) return false;
  const rows = budget.rows || [];
  const columns = declaredDimension(budget, data);
  if (columns && sameDimension(columns, breakout)) return true;
  const scoped = new Set();
  let anyLine = false;
  for (const r of rows) {
    if (r.row_kind !== "line" || r.void) continue;
    anyLine = true;
    for (const sc of r.scopes || []) {
      if (sameDimension(sc, breakout)) scoped.add(sc.value);
    }
  }
  if (!anyLine || !scoped.size) return false;
  // Every value already has its own line: opening any row by this can only
  // restate that row's label. Some values spoken for still leaves the rest.
  return scoped.size >= (breakout.valueCount || 0);
}

/** The breakout the workbook itself already uses, or null.
 *
 *  Three ways a sheet states one: it declares a reporting-tag dimension,
 *  its lines carry tag values, or a line rolls several Carta GL accounts
 *  into one of the firm's own categories.
 */
export function budgetBreakout(budget, available, data) {
  const opts = available || rowBreakouts(data);
  const pick = key => opts.find(o => o.key === key) || null;
  const rows = budget?.rows || [];

  const declared = declaredDimension(budget, data);
  if (declared) {
    const hit = pick(keyOf(declared));
    if (hit) return hit;
  }

  // Lines carrying a tag value break out by whichever category scopes this
  // firm — the sheet names the values, the firm's Carta data names the
  // category they belong to.
  const scoped = data?.dimension;
  if (scoped?.category && rows.some(r => r.tag_value || r.dept)) {
    const hit = pick(`reporting_tag:${scoped.category}`);
    if (hit) return hit;
  }

  // A line covering several Carta accounts USED to default this to the
  // account breakout — "Payroll" over three codes renders as one figure,
  // and opening it says which. But on a sheet of the firm's own categories
  // that is a question the reader might ask, not the axis the sheet is
  // built on, and answering it unasked opens a report they came to read as
  // their own words. They can still pick it; it just is not chosen for
  // them. (A sheet whose rows ARE accounts is the other case — below.)

  // A sheet whose every line IS one Carta account is already broken out by
  // account, so the control has nothing to add at that level — but it also
  // opens SUB-accounts, which such a sheet never states. Default to it so
  // they are there without being asked for. Only where the firm keeps
  // sub-accounts at all: without them every row would open onto itself,
  // which breakoutBuckets now refuses anyway.
  const account = pick("account");
  if (account?.withSub && rowsAreAccounts(budget, data)) return account;
  return null;
}

// How much of a sheet has to be named after the ledger before it counts as
// listing the ledger. The same bar the ingest-side row_axis uses on the
// workbook itself (_ROW_AXIS_MIN), and it lands in the same place: on two
// real sheets of one firm this reads 97% and 26%.
const ROWS_ARE_ACCOUNTS_MIN = 0.85;

/** Whether a budget's rows ARE Carta accounts rather than the firm's own
 *  categories.
 *
 *  Counting GL codes is the obvious test and the wrong one: a sheet that
 *  lists the ledger still has a line or two covering several codes
 *  ("Travel" over airfare, lodging and cab), and one unmapped line would
 *  flip the answer. What separates the two is what the rows are NAMED
 *  after — "Travel" is an account, "Retirement Plan (401k)" is the firm's
 *  own word for two of them.
 *
 *  A bucket sheet can still open by account; that is a question the reader
 *  asks, not the point of the view, so it does not open itself.
 */
export function rowsAreAccounts(budget, data) {
  const names = data instanceof Map ? data : glNameMap(data?.entries);
  const norm = v => String(v ?? "").trim().toLowerCase();
  const lines = (budget?.rows || []).filter(
    r => r.row_kind === "line" && !r.void && (r.gl_codes || []).length);
  if (!lines.length) return false;
  const named = lines.filter(
    r => (r.gl_codes || []).some(c => norm(names.get(c)) === norm(r.label))).length;
  return named / lines.length >= ROWS_ARE_ACCOUNTS_MIN;
}

/** Which breakout opens first, or null to open none.
 *
 *  Null is the honest answer for a budget with no breakout of its own: the
 *  reader is offered one after the dashboard is up, rather than the report
 *  picking a dimension they never asked for.
 */
export function defaultBreakout(data, available, budget) {
  const opts = available || rowBreakouts(data, budget);
  if (!opts.length) return null;
  const configured = data?.rowDimension;
  if (configured) {
    const hit = opts.find(o => o.key === keyOf(configured));
    if (hit) return hit;
  }
  return budget ? budgetBreakout(budget, opts, data) : null;
}

/** Child rows for one budget line, broken out by `dimension`. Actuals only:
 *  prorating an account-level budget puts a variance on each child that the
 *  firm never budgeted.
 */
export function breakoutRows(entries, row, dimension, period) {
  if (!dimension) return [];
  const codes = new Set(row?.gl_codes || []);
  if (!codes.size) return [];
  const first = period?.first_month ?? 1;
  const last = period?.last_month ?? 12;

  const sums = new Map();
  let unlabelled = 0;
  for (const e of entries || []) {
    if (!codes.has(e.acct_type)) continue;
    if (typeof e.mo === "number" && (e.mo < first || e.mo > last)) continue;
    const amount = e.amount || 0;
    const value = dimensionValue(e, dimension);
    if (!value) { unlabelled += amount; continue; }
    sums.set(value, (sums.get(value) || 0) + amount);
  }

  const out = [...sums.entries()]
    .map(([label, actual]) => ({ label, actual }))
    .sort((a, b) => Math.abs(b.actual) - Math.abs(a.actual));

  // Spend on this account that carries no value for the chosen breakout.
  // Dropping it would leave the children short of the row they sit under,
  // which reads as the parent being wrong rather than the breakout partial.
  if (unlabelled) out.push({ label: UNLABELLED, actual: unlabelled, unlabelled: true });
  return withUnlabelled(out, c => c.actual);
}

/** Child rows bucketed into a caller's own columns — the outline reports by
 *  quarter, so a flat total would leave its children unreadable beside it.
 *
 *  `tagFilter` is the parent line's own scope: a line reported against one
 *  tag value must break out only the spend inside it, or the children
 *  overshoot the row they sit under.
 */
export function breakoutBuckets(entries, row, breakout, opts = {}) {
  const { tagFilter = null, dimension = null, bucketOf, bucketKeys = [],
          excludeClaims = null } = opts;
  const claims = excludeClaims || [];
  // The row's non-tag scopes; tagFilter covers the tag. Without them a line
  // for one office opens into every office, past the figure above it.
  const narrow = (row?.scopes || []).filter(sc => (sc.source || "reporting_tag") !== "reporting_tag");
  if (!breakout || typeof bucketOf !== "function") return [];
  const codes = new Set(row?.gl_codes || []);
  if (!codes.size) return [];

  const empty = () => {
    const o = { Total: 0 };
    for (const k of bucketKeys) o[k] = 0;
    return o;
  };
  const byValue = new Map();
  for (const e of entries || []) {
    if (!codes.has(e.acct_type)) continue;
    if (narrow.length && !narrow.every(sc => dimensionValue(e, sc) === sc.value)) continue;
    if (tagFilter) {
      const v = dimensionValue(e, dimension);
      if (v == null || !tagFilter.has(v)) continue;
    } else if (claims.length
               && claims.some(c => dimensionValue(e, c) === c.value)) {
      // Children of a remainder line cover the remainder, or they sum past
      // the row above them.
      continue;
    }
    const bucket = bucketOf(e.mo);
    if (!bucket) continue;
    const label = dimensionValue(e, breakout) || UNLABELLED;
    if (!byValue.has(label)) byValue.set(label, empty());
    const b = byValue.get(label);
    const amt = Number(e.amount ?? 0) || 0;
    b[bucket] += amt;
    if (bucket !== "Total") b.Total += amt;
  }

  const out = [...byValue.entries()]
    .map(([label, buckets]) => ({ label, buckets, unlabelled: label === UNLABELLED }))
    // Unlabelled last: it is a gap in the data, not a peer of the values.
    .sort((a, b) => (a.unlabelled ? 1 : 0) - (b.unlabelled ? 1 : 0)
                 || Math.abs(b.buckets.Total) - Math.abs(a.buckets.Total));

  const kept = withUnlabelled(out, c => c.buckets.Total);
  if (!kept.length) return [];

  // A lone child wearing the row's own name says nothing the row does not.
  // On a sheet whose rows ARE Carta accounts, opening by account gives
  // every row without sub-accounts exactly that — "Bank interest income"
  // under "Bank interest income" — which on one real firm was 33 rows of
  // 36. A child named differently is kept however few there are: "Gusto"
  // under a payroll line, or "Audit fees" under a firm's own "Audit & Tax
  // Fees" bucket, both say something the row does not.
  if (kept.length === 1 && sameLabel(kept[0].label, row?.label)) return [];
  return kept;
}

function sameLabel(a, b) {
  const norm = v => String(v ?? "").trim().toLowerCase();
  return !!a && norm(a) === norm(b);
}

/** Children with the unlabelled bucket handled the way a reader reads it.
 *
 *  Two rules, both about a row whose spend carries no value for the chosen
 *  breakout:
 *
 *  Nothing is labelled → there is no breakout to show. The row would open
 *  onto a single "No associated vendor" child holding the whole figure,
 *  which restates the row and answers nothing. On one real firm that was 14
 *  rows of a 35-row sheet.
 *
 *  Everything is labelled → the remainder is zero, and a "No associated
 *  vendor — 0" line is a row about the absence of an absence.
 *
 *  A genuine remainder alongside named values is kept, and is the reason
 *  the bucket exists: without it the children sum short of the row above
 *  them, which reads as the parent being wrong rather than the breakout
 *  partial.
 */
function withUnlabelled(children, totalOf) {
  const kept = children.filter(c => !c.unlabelled || Math.abs(totalOf(c)) > 0.005);
  return kept.every(c => c.unlabelled) ? [] : kept;
}

/** Child rows spread over a caller's period columns.
 *
 *  Unlike breakoutBuckets, a month may belong to several columns at once —
 *  March sits in both "March 2026" and YTD — so each entry is added to every
 *  column that covers it rather than to one bucket.
 */
export function breakoutByColumns(entries, row, breakout, columns) {
  if (!breakout || !columns?.length) return [];
  const codes = new Set(row?.gl_codes || []);
  if (!codes.size) return [];
  // A child outside the scope its parent reports is not that row's child.
  const narrow = row?.scopes || [];

  const byValue = new Map();
  for (const e of entries || []) {
    if (!codes.has(e.acct_type)) continue;
    if (typeof e.mo !== "number") continue;
    if (narrow.length && !narrow.every(sc => dimensionValue(e, sc) === sc.value)) continue;
    const label = dimensionValue(e, breakout) || UNLABELLED;
    if (!byValue.has(label)) byValue.set(label, new Map());
    const cells = byValue.get(label);
    const amount = Number(e.amount ?? 0) || 0;
    for (const col of columns) {
      if (!col.months.includes(e.mo)) continue;
      cells.set(col.key, (cells.get(col.key) || 0) + amount);
    }
  }

  const total = (cells) => [...cells.values()].reduce((s, v) => s + Math.abs(v), 0);
  const out = [...byValue.entries()]
    .map(([label, cells]) => ({ label, cells, unlabelled: label === UNLABELLED }))
    // A value with nothing inside the window is not a child of this row.
    .filter(c => c.cells.size)
    // Unlabelled last: it is a gap in the data, not a peer of the values.
    .sort((a, b) => (a.unlabelled ? 1 : 0) - (b.unlabelled ? 1 : 0)
                 || total(b.cells) - total(a.cells));
  return withUnlabelled(out, c => total(c.cells));
}

/** Whether a row can be opened by the active breakout.
 *
 *  A single child was refused on the grounds that one child equal to its
 *  parent tells the reader nothing they can't see. It tells them one thing:
 *  that the line has exactly one vendor. Without the caret a reader cannot
 *  tell "this row has one vendor" from "the breakout doesn't reach this
 *  row" — a real firm's payroll line, one Gusto entry, read as the second
 *  and sent someone looking for a bug.
 *
 *  Consistency is the other half: every other line under the same breakout
 *  opens, so the one that doesn't looks broken rather than singular.
 */
export function worthBreakingOut(children) {
  return (children || []).length > 0;
}

/** Whether opening this row by this breakout can say anything new.
 *
 *  A line already reported for one value of a dimension has one child by
 *  it, wearing the row's own label. The caret is refused before the
 *  children are counted, so the answer does not depend on the data
 *  happening to hold one value today.
 */
export function opensAnything(row, breakout) {
  if (!breakout) return false;
  return !(row?.scopes || []).some(sc => sameDimension(sc, breakout));
}
