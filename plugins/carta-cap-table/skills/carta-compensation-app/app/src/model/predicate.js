// A declarative predicate over cohort rows, and its interpreter.
//
// WHY A DSL AND NOT CODE
// This exists so a filter can be authored from a typed sentence. That input is
// untrusted, so it never becomes executable: no `eval`, no `new Function`, no
// property path resolved from a string against a live object. A predicate is
// plain JSON over a closed set of ops and a closed set of field names, and this
// file is the only thing that interprets it.
//
// AN INVALID PREDICATE EXCLUDES NOBODY
// `validate` is the gate, and callers must run it before `evaluate`. A malformed
// predicate is NOT APPLIED — it never degrades to "matches everything", because
// that would silently add people to a grant cycle. `evaluate` throws on anything
// unvalidated rather than guessing.
//
// FIELDS ARE PROJECTED, NEVER READ OFF THE ROW
// Every field is a named entry in FIELDS with its own accessor. A predicate can
// only name those keys, so `__proto__`, `constructor` and any other inherited
// property are unreachable by construction rather than by a blocklist.

import { levelRank } from "./cohort.js";
import { parseDate } from "./tenure.js";
import { tenureMonths } from "./tenure.js";

/** The ops an authored predicate may use. Anything else is rejected. */
export const OPS = Object.freeze([
  "and", "or", "not",
  "eq", "neq", "lt", "lte", "gt", "gte",
  "in", "nin",
  "isNull", "notNull",
]);

const LOGICAL = new Set(["and", "or"]);
const COMPARISON = new Set(["eq", "neq", "lt", "lte", "gt", "gte"]);
const MEMBERSHIP = new Set(["in", "nin"]);
const UNARY_FIELD = new Set(["isNull", "notNull"]);

/** How deep a predicate tree may nest.
 *
 *  A bound rather than a preference: an authored predicate is untrusted input, and
 *  a deeply nested one would recurse this evaluator until the stack gave out.
 */
export const MAX_DEPTH = 8;

/** The fields a predicate may name, and how each is read.
 *
 *  `kind` drives both validation and the plain-English rendering:
 *    text     — compared as a case-insensitive string
 *    ordinal  — compared numerically, but displayed as the label ("IC 5")
 *    number   — compared numerically
 *    date     — compared as a date
 *    months   — derived: whole months between a date and `asOf`
 */
export const FIELDS = Object.freeze({
  job_area: { kind: "text", label: "job area", get: (r) => r.job_area },
  job_focus: { kind: "text", label: "specialization", get: (r) => r.job_focus },
  job_track: { kind: "text", label: "track", get: (r) => r.job_track },
  job_title: { kind: "text", label: "job title", get: (r) => r.job_title },
  location: { kind: "text", label: "location", get: (r) => r.location },
  full_name: { kind: "text", label: "name", get: (r) => r.full_name },
  // Ordinal, not text: "IC 10" sorts before "IC 2" as a string. levelRank reads
  // the canonical number off the annotated label, and it is shared across tracks
  // so IC 5 and MGR 5 compare equal.
  job_level: { kind: "ordinal", label: "level", get: (r) => levelRank(r.job_level),
    display: (r) => r.job_level },
  tenure_months: { kind: "months", label: "tenure", get: (r, ctx) =>
    tenureMonths({ tenure: { start_date: r.hire_date } }, ctx && ctx.asOf) },
  hire_date: { kind: "date", label: "hire date", get: (r) => r.hire_date },
  date_of_final_vest: { kind: "date", label: "vesting end", get: (r) => r.date_of_final_vest },
  total_vested_shares: { kind: "number", label: "vested shares",
    get: (r) => r.total_vested_shares },
  total_unvested_shares: { kind: "number", label: "unvested shares",
    get: (r) => r.total_unvested_shares },
  live_award_count: { kind: "number", label: "prior grants",
    get: (r) => r.live_award_count },
  four_year_grant_benchmark_num_shares: { kind: "number", label: "equity benchmark",
    get: (r) => r.four_year_grant_benchmark_num_shares },
  refresh_grant_num_shares: { kind: "number", label: "refresh grant",
    get: (r) => r.refresh_grant_num_shares },
});

/** Validate a predicate. Returns `{ ok: true }` or `{ ok: false, error }`.
 *
 *  Callers MUST run this before `evaluate`. The error is written for a person to
 *  read on screen, because a rejected filter has to explain itself — a silent
 *  failure here is a filter that looks applied and is not.
 */
export function validate(node, depth = 0) {
  if (depth > MAX_DEPTH) {
    return { ok: false, error: `Filter is nested more than ${MAX_DEPTH} levels deep.` };
  }
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return { ok: false, error: "Each filter step must be an object." };
  }

  const keys = Object.keys(node);
  if (keys.length !== 1) {
    return { ok: false, error: "Each filter step must name exactly one operator." };
  }
  const op = keys[0];
  if (!OPS.includes(op)) {
    return { ok: false, error: `Unknown filter operator ${JSON.stringify(op)}.` };
  }
  const arg = node[op];

  if (LOGICAL.has(op)) {
    if (!Array.isArray(arg) || arg.length === 0) {
      return { ok: false, error: `"${op}" needs a list of at least one condition.` };
    }
    for (const child of arg) {
      const r = validate(child, depth + 1);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  if (op === "not") return validate(arg, depth + 1);

  if (UNARY_FIELD.has(op)) {
    if (typeof arg !== "string") return { ok: false, error: `"${op}" needs a field name.` };
    return fieldExists(arg);
  }

  // Comparison and membership both take [field, value].
  if (!Array.isArray(arg) || arg.length !== 2) {
    return { ok: false, error: `"${op}" needs a field and a value.` };
  }
  const [field, value] = arg;
  const exists = fieldExists(field);
  if (!exists.ok) return exists;

  if (MEMBERSHIP.has(op)) {
    if (!Array.isArray(value) || value.length === 0) {
      return { ok: false, error: `"${op}" needs a non-empty list of values.` };
    }
    return { ok: true };
  }

  if (value === null || typeof value === "object") {
    return { ok: false, error: `"${op}" needs a plain value, not a list or object.` };
  }
  if (COMPARISON.has(op) && op !== "eq" && op !== "neq" && typeof value !== "number") {
    const f = FIELDS[field];
    // Dates compare as strings in ISO form, which sorts correctly.
    if (f.kind !== "date") {
      return { ok: false, error: `"${op}" on ${f.label} needs a number.` };
    }
  }
  return { ok: true };
}

function fieldExists(name) {
  // Own-property check: a predicate naming "__proto__" or "constructor" finds
  // nothing here, so the projection cannot reach anything inherited.
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(FIELDS, name)) {
    return { ok: false, error: `Unknown field ${JSON.stringify(name)}.` };
  }
  return { ok: true };
}

/** Read one field off a row through its declared accessor.
 *
 *  A `number` field is coerced to an actual number. The report serialises share
 *  counts as decimal STRINGS ("0.00", "11914.00"), and comparing those as text
 *  made `"0.00" > 0` true — every employee with zero unvested shares counted as
 *  still vesting. Coercing here rather than in `cmp` keeps the rule at the one
 *  place that knows a field's declared kind.
 *
 *  A value that is not a number at all becomes null, which no comparison
 *  satisfies — the same treatment as a missing value, rather than a silent 0.
 */
function read(row, field, ctx) {
  const raw = FIELDS[field].get(row, ctx);
  if (FIELDS[field].kind !== "number" || raw == null || typeof raw === "number") {
    return raw;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function cmp(a, b) {
  if (a == null || b == null) return null;
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : (a < b ? -1 : 1);
  const as = String(a);
  const bs = String(b);
  return as === bs ? 0 : (as < bs ? -1 : 1);
}

/** Does this row satisfy the predicate?
 *
 *  Throws on an unvalidated predicate rather than guessing — see the file header.
 *
 *  A MISSING VALUE NEVER SATISFIES A COMPARISON. An employee with no hire date
 *  does not pass "tenure over 24 months", and does not pass "tenure under 24"
 *  either: unknown is not zero, and a row the filter cannot judge is excluded
 *  rather than assumed. `isNull` is how a caller asks for those rows on purpose.
 */
export function evaluate(node, row, ctx) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("evaluate called on an unvalidated predicate");
  }
  const op = Object.keys(node)[0];
  const arg = node[op];

  switch (op) {
    case "and": return arg.every((c) => evaluate(c, row, ctx));
    case "or": return arg.some((c) => evaluate(c, row, ctx));
    case "not": return !evaluate(arg, row, ctx);
    case "isNull": return read(row, arg, ctx) == null;
    case "notNull": return read(row, arg, ctx) != null;
    default: break;
  }

  const [field, value] = arg;
  const actual = read(row, field, ctx);

  if (op === "in" || op === "nin") {
    // Case-insensitive for text so "engineering" matches "Engineering".
    const isText = FIELDS[field].kind === "text";
    const norm = (v) => (isText && typeof v === "string" ? v.toLowerCase() : v);
    if (actual == null) return false;
    const hit = value.some((v) => norm(v) === norm(actual));
    return op === "in" ? hit : !hit;
  }

  if (actual == null) return false;

  if (op === "eq" || op === "neq") {
    const isText = FIELDS[field].kind === "text";
    const same = isText
      ? String(actual).toLowerCase() === String(value).toLowerCase()
      : cmp(actual, value) === 0;
    return op === "eq" ? same : !same;
  }

  const c = FIELDS[field].kind === "date"
    ? cmp(parseDate(actual)?.getTime() ?? null, parseDate(value)?.getTime() ?? null)
    : cmp(actual, value);
  if (c == null) return false;
  switch (op) {
    case "lt": return c < 0;
    case "lte": return c <= 0;
    case "gt": return c > 0;
    case "gte": return c >= 0;
    default: throw new Error(`unreachable op ${op}`);
  }
}

/** Rows that satisfy the predicate. Validate first; this does not re-check. */
export function applyPredicate(rows, node, ctx) {
  return rows.filter((r) => evaluate(node, r, ctx));
}

const OP_WORDS = {
  eq: "is", neq: "is not",
  lt: "is under", lte: "is at most", gt: "is over", gte: "is at least",
  in: "is one of", nin: "is not one of",
  isNull: "is not recorded", notNull: "is recorded",
};

/** The predicate as a sentence, so a committed filter can be read back.
 *
 *  A filter someone cannot read is a filter they cannot audit, and this one may
 *  have been authored from a typed phrase rather than chosen from a menu.
 */
export function describe(node) {
  if (node === null || typeof node !== "object") return "(invalid filter)";
  const op = Object.keys(node)[0];
  const arg = node[op];

  if (op === "and" || op === "or") {
    return arg.map(describe).join(op === "and" ? " and " : " or ");
  }
  if (op === "not") return `not (${describe(arg)})`;
  if (op === "isNull" || op === "notNull") {
    return `${FIELDS[arg]?.label ?? arg} ${OP_WORDS[op]}`;
  }
  const [field, value] = arg;
  const label = FIELDS[field]?.label ?? field;
  const shown = Array.isArray(value) ? value.join(", ") : value;
  const unit = FIELDS[field]?.kind === "months" ? " months" : "";
  return `${label} ${OP_WORDS[op]} ${shown}${unit}`;
}
