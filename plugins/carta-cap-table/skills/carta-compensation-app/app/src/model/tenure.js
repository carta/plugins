// Tenure arithmetic for the refresh planner.
//
// Pure — no React. Everything here is DERIVED: the API returns a start date and an
// end date, and the months-at-company figure is computed in the browser against
// today. That is why it is isolated in one module with tests, and why every
// surface displaying one of these numbers has to label it (see SKILL.md's
// derived-value rule).
//
// Deriving rather than capturing is deliberate. A month count baked in at capture
// time silently ages: a dashboard built in January would still claim January's
// tenure in June, and the eligibility gate it feeds would quietly admit the wrong
// people. Dates do not age; the arithmetic against "now" has to happen at render.

/** ISO date string -> Date at UTC midnight, or null if unparseable.
 *
 *  Parsed component-wise rather than via `new Date(str)`. A bare "2019-03-05" is
 *  treated as UTC by the spec but "2019-03-05T00:00:00" as LOCAL, and the roster
 *  carries both shapes depending on which capture path wrote it — so string
 *  parsing alone would shift a date by up to a day either side of the epoch
 *  depending on the reader's timezone. Month boundaries are exactly where a
 *  tenure gate flips, so that shift is not cosmetic.
 */
export function parseDate(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // Rejects real-looking but invalid dates (2019-02-30): Date.UTC rolls those
  // over to March, so round-tripping the day is what catches them.
  return date.getUTCDate() === Number(d) ? date : null;
}

/** Whole months between two dates, or null when either is missing.
 *
 *  WHOLE months, not a rounded fraction: "24 months tenure" in a comp policy means
 *  the 24th monthly anniversary has passed, so someone at 23 months and 29 days is
 *  not yet eligible. Rounding would admit them a day early, which is the kind of
 *  error a policy is written to prevent.
 */
export function monthsBetween(from, to) {
  const a = from instanceof Date ? from : parseDate(from);
  const b = to instanceof Date ? to : parseDate(to);
  if (!a || !b) return null;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  // Not yet reached this month's anniversary day — back off one.
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

/** Months this employee has been at the company as of `asOf`, or null if unknown.
 *
 *  Null is a distinct answer from 0 and must stay that way all the way to the
 *  cell: an employee whose start date was never recorded is UNKNOWN, not a
 *  day-one hire. Collapsing the two would silently exclude them from a refresh
 *  cycle under any non-zero tenure requirement.
 */
export function tenureMonths(row, asOf) {
  const start = (row && row.tenure && row.tenure.start_date) || null;
  if (!start) return null;
  return monthsBetween(start, asOf || new Date());
}

/** True when the employee has left, false when active, null when unknowable.
 *
 *  An end_date in the FUTURE still reads as active today — a recorded leaving date
 *  is not a departure until it arrives, and someone serving notice is still on the
 *  roster and still eligible for a refresh cycle that grants before they go.
 */
export function isActive(row, asOf) {
  const tenure = (row && row.tenure) || null;
  // No tenure node at all: this build never captured it, so employment status is
  // unknown rather than active. Callers must not treat null as a pass.
  if (!tenure) return null;
  const end = parseDate(tenure.end_date);
  if (!end) return true;
  const now = asOf instanceof Date ? asOf : (parseDate(asOf) || new Date());
  return end > now;
}

/** Months as a short human label: 30 -> "2y 6m". Null -> null, so callers em-dash it. */
export function formatTenure(months) {
  if (months === null || months === undefined || !isFinite(months)) return null;
  // Negative means a start date in the future — a data error rather than a
  // tenure. Surfaced as-is rather than clamped to 0, which would hide it.
  if (months < 0) return `${months}m`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return `${rest}m`;
  if (!rest) return `${years}y`;
  return `${years}y ${rest}m`;
}
