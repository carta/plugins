// Cohort filters for the refresh planner.
//
// Pure — no React. Each predicate takes a row and returns whether it stays in the
// cohort. They are separated from the UI because the decisions here are the ones
// that matter: a filter that quietly passes everyone, or quietly drops someone, is
// a wrong refresh cycle rather than a rendering bug.
//
// Two rules run through all of them:
//
//   * A filter that CANNOT be evaluated must not silently pass. Where the data is
//     missing the caller disables the control and says why; where a single row is
//     missing the value, that row is excluded and counted, never assumed.
//   * "Unknown" is never "zero". An employee with no recorded hire date is not a
//     day-one hire, and one with no captured equity is not someone holding nothing.

import { parseDate } from "./tenure.js";

/** The canonical rank inside an annotated level, or null.
 *
 *  The report returns levels as "IC 3", "MGR 6", "EX 10" — a track prefix plus a
 *  number. That number is the CANONICAL rank and is shared across tracks: "IC 5"
 *  and "MGR 5" are both SENIOR2, and it increases monotonically from IC 1 to
 *  EX 12. So ordering by it is correct across the whole ladder, and no mapping
 *  through the level-code vocabulary is needed.
 *
 *  This is why the filter does not use LEVEL_RANK from taxonomy.js: that keys on
 *  codes like SENIOR1, which this payload does not carry.
 */
export function levelRank(annotated) {
  if (typeof annotated !== "string") return null;
  const m = /(\d+)\s*$/.exec(annotated.trim());
  return m ? Number(m[1]) : null;
}

/** Has at least one live equity grant.
 *
 *  Cancelled and forfeited awards are already excluded upstream — the service
 *  filters them when fetching securities — so this is a plain count check rather
 *  than a re-implementation of that exclusion.
 *
 *  null (no equity captured for this employee at all) is NOT a pass. It is a
 *  different fact from holding nothing, and a refresh cycle that granted to
 *  someone on the strength of an unknown is exactly what this returns false for.
 */
export function hasPriorGrants(row) {
  const n = row && row.live_award_count;
  return typeof n === "number" && n > 0;
}

/** Level falls within [min, max], compared by canonical rank.
 *
 *  Compares NUMBERS, never the label. "IC 10" sorts before "IC 9" as text, so a
 *  string comparison produces a filter that is right for single digits and wrong
 *  at exactly the executive levels a refresh cycle most needs to get right.
 *
 *  A row whose level has no parseable rank is excluded rather than passed: it
 *  cannot be placed relative to the bounds, and guessing either way is worse than
 *  leaving it out of a cycle a human is about to review.
 */
export function levelInRange(row, min, max) {
  const rank = levelRank(row && row.job_level);
  if (rank === null) return false;
  const lo = min === null || min === undefined ? -Infinity : min;
  const hi = max === null || max === undefined ? Infinity : max;
  return rank >= lo && rank <= hi;
}

/** Job area is one of the selected codes. An empty selection means no filter. */
export function jobAreaIn(row, selected) {
  if (!selected || !selected.length) return true;
  return selected.includes(row && row.job_area);
}

/** EXCLUDES employees whose vesting completes within `months` of `asOf`.
 *
 *  Deliberately the inverse of the CTC report's own "Completing vesting in"
 *  filter, which KEEPS them. This planner is looking for the people who still
 *  have runway, so the ones about to fully vest are the ones removed.
 *
 *  A completion date in the PAST counts as within the window — vesting that has
 *  already ended is the most complete case of "completing soon", and the report's
 *  own next-12-months flag treats it the same way.
 *
 *  A row with no completion date is KEPT. Unlike the eligibility gates, this
 *  filter's job is to remove a known group; removing someone because their date
 *  is unknown would silently shrink the cohort on missing data. The caller
 *  surfaces the count so the gap is visible rather than invisible.
 */
export function notVestingWithin(row, months, asOf) {
  if (!months) return true; // 0 or null disables the filter
  const end = parseDate(row && row.date_of_final_vest);
  if (!end) return true;
  const now = asOf instanceof Date ? asOf : new Date();
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()));
  return end > cutoff;
}

/** Total equity the employee holds: vested + unvested.
 *
 *  Matches how the CTC product's own table computes "Total Shares Granted" — the
 *  report exposes the two parts separately and the sum is done at render there
 *  too, so this is the product's number rather than a new derivation.
 *
 *  null when NEITHER part is present, so the caller renders an em dash instead of
 *  a zero. A present-but-zero part is real and contributes.
 */
export function totalEquity(row) {
  const v = row && row.total_vested_shares;
  const u = row && row.total_unvested_shares;
  if (v == null && u == null) return null;
  return Number(v || 0) + Number(u || 0);
}

/** Shares vesting in the NEXT twelve months, or null when not captured.
 *
 *  `ntm_vesting` — the CTC product's own term and its own figure, which the planner
 *  must not re-derive. A plausible approximation is available here (total grant over
 *  a four-year schedule from the hire date), and it is deliberately NOT computed:
 *  this column sits beside Carta's figures in a table a user reads as Carta's, so
 *  a guess wearing the same styling would be indistinguishable from a fact. An em
 *  dash says "we do not have this"; a modelled number says something false.
 *
 *  ZERO IS A REAL ANSWER and must survive: an employee fully vested has nothing
 *  vesting next year, which is a finding, not missing data. Hence the `== null`
 *  test rather than a falsy one.
 *
 *  AS-OF-TODAY, unlike total_vested_shares: the service computes it from the fetch
 *  date, so two captures of an unchanged cap table can legitimately differ. Not a
 *  data error, and the cell's title says so.
 */
export function vestingNext12(row) {
  const v = row && row.ntm_vesting;
  return v == null ? null : Number(v);
}

/** Shares that vested in the LAST twelve months, or null when not captured.
 *
 *  `ttm_vesting`, the trailing mirror of vestingNext12. Same rule on zero: an
 *  employee past their final vest has zero here, which is exactly the signal a
 *  refresh cycle is looking for.
 *
 *  NARROWER THAN IT READS. The service counts vesting events on the securities the
 *  employee still HOLDS — cancelled awards are filtered upstream — so this is not
 *  "everything that ever vested". A label promising the broader meaning would
 *  overclaim it, which is why the column header says only "Last 12 Months".
 */
export function vestingLast12(row) {
  const v = row && row.ttm_vesting;
  return v == null ? null : Number(v);
}

/** Apply the whole filter set to a list of rows.
 *
 *  Returns { rows, removed } so a caller can show what a filter took out rather
 *  than only what it left — "N excluded by filters" is the difference between a
 *  cohort a user trusts and one they have to reverse-engineer.
 *
 *  A filter whose data this build never captured is skipped entirely rather than
 *  applied against nulls; `availability` comes from the build, and the UI disables
 *  the corresponding control with a visible reason.
 */
/** The prior-grants filter's three states.
 *
 *  A checkbox could only say "has some" or "don't care", and the state it could
 *  not express — has NONE — is the one a refresh cycle most often wants: people
 *  who have never been granted.
 *
 *  ANY is the false-y value on purpose. Scenarios saved before this was a
 *  tri-state store `hasPriorGrants: false` meaning "no filter", and it has to keep
 *  meaning that — reading a stored `false` as HAS_NONE would silently re-filter
 *  every saved plan on load.
 */
export const PRIOR_GRANTS = Object.freeze({
  ANY: "",
  HAS: "has",
  NONE: "none",
});

/** A stored value as one of the three states, tolerating the old boolean. */
export function priorGrantsMode(value) {
  if (value === PRIOR_GRANTS.HAS || value === true) return PRIOR_GRANTS.HAS;
  if (value === PRIOR_GRANTS.NONE) return PRIOR_GRANTS.NONE;
  return PRIOR_GRANTS.ANY;
}

export function applyFilters(rows, filters, availability, asOf) {
  const all = rows || [];
  const f = filters || {};
  const avail = availability || {};
  const mode = priorGrantsMode(f.hasPriorGrants);
  const kept = all.filter((row) => {
    // Skipped entirely when this build captured no equity: with nothing to judge,
    // "has none" would match everyone and "has some" nobody, and both would be an
    // answer about our data rather than about the employees.
    if (mode !== PRIOR_GRANTS.ANY && avail.grants !== false) {
      const has = hasPriorGrants(row);
      if (mode === PRIOR_GRANTS.HAS && !has) return false;
      if (mode === PRIOR_GRANTS.NONE && has) return false;
    }
    if (!jobAreaIn(row, f.jobAreas)) return false;
    if ((f.levelMin || f.levelMax) && !levelInRange(row, f.levelMin, f.levelMax)) return false;
    if (f.excludeVestingWithinMonths && avail.vesting !== false
        && !notVestingWithin(row, f.excludeVestingWithinMonths, asOf)) return false;
    return true;
  });
  return { rows: kept, removed: all.length - kept.length };
}
