// Period columns for a Budget vs Actuals grid, and the toolbar state above it.

export const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const MONTH_NAME = ["January", "February", "March", "April", "May", "June",
                           "July", "August", "September", "October", "November", "December"];

export const FREQUENCIES = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "annually", label: "Annually" },
];

// The three sub-columns the Filters menu can hide, in the order they render.
export const COLUMN_TYPES = ["actual", "budget", "variance"];

// One has to survive: a period column showing none of the three says nothing.
export const MAX_HIDDEN_COLUMNS = 2;

export const DEFAULT_FILTERS = Object.freeze({
  frequency: "monthly",
  hidden: [],
  showYtd: true,
});

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** The calendar month the dashboard's own as-of date falls in, 1-12 — the
 *  true cutoff for what Carta actually has data for, independent of what
 *  any one budget claims to cover. Falls back to December when `asOf` is
 *  absent so a snapshot without one still renders a full year. */
export function trueAsOfMonth(asOf) {
  return Number(String(asOf || "").slice(5, 7)) || 12;
}

/** A month window clamped into the calendar, ordered low to high. */
export function normalizeRange(range) {
  const first = clamp(Math.round(range?.first ?? 1) || 1, 1, 12);
  const last = clamp(Math.round(range?.last ?? 12) || 12, 1, 12);
  return first <= last ? { first, last } : { first: last, last: first };
}

function monthsBetween(first, last) {
  const out = [];
  for (let m = first; m <= last; m += 1) out.push(m);
  return out;
}

/** The window a budget states for itself, as a range. */
export function rangeOfPeriod(period) {
  return normalizeRange({ first: period?.first_month ?? 1, last: period?.last_month ?? 12 });
}

function rangeLabel(range, year) {
  const { first, last } = range;
  if (first === last) return `${MONTH_NAME[first - 1]} ${year}`;
  if (first === 1 && last === 12) return String(year);
  return `${MONTH_ABBR[first - 1]} – ${MONTH_ABBR[last - 1]} ${year}`;
}

/** The period columns one frequency draws over one month range.
 *
 *  A partly covered quarter keeps only the months in range: snapping it out
 *  to the boundary would add a month with no actuals and read as underspend.
 *  `future` marks a column past `asOfMonth`, which can have no actual at all.
 */
export function periodColumns(frequency, range, year, asOfMonth) {
  const win = normalizeRange(range);
  const cutoff = clamp(Math.round(asOfMonth ?? 12) || 12, 0, 12);
  const mark = (col) => ({ ...col, future: col.months.every((m) => m > cutoff) });

  if (frequency === "annually") {
    return [mark({ key: `y${year}`, label: rangeLabel(win, year),
                   months: monthsBetween(win.first, win.last) })];
  }

  if (frequency === "quarterly") {
    const out = [];
    for (let q = 0; q < 4; q += 1) {
      const months = monthsBetween(q * 3 + 1, q * 3 + 3)
        .filter((m) => m >= win.first && m <= win.last);
      if (months.length) out.push(mark({ key: `q${q + 1}`, label: `Q${q + 1} ${year}`, months }));
    }
    return out;
  }

  return monthsBetween(win.first, win.last).map((m) =>
    mark({ key: `m${m}`, label: `${MONTH_NAME[m - 1]} ${year}`, months: [m] }));
}

/** January through the end of the window, never past the last month with
 *  actuals. Year to date means the year, not the window — a reader who
 *  narrows to Q2 still wants the figure the KPI strip shows. Null when it
 *  would only repeat the single period column beside it. */
export function ytdColumn(range, year, asOfMonth, columns) {
  const win = normalizeRange(range);
  const last = Math.min(win.last, clamp(Math.round(asOfMonth ?? 12) || 12, 0, 12));
  if (last < 1) return null;
  const months = monthsBetween(1, last);
  if (columns?.length === 1 && sameMonths(columns[0].months, months)) return null;
  return { key: "ytd", label: "YTD", months, ytd: true, future: false };
}

function sameMonths(a, b) {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

/** Ranges worth offering, bounded to the one year this dashboard holds.
 *  Prior and next year would each draw an empty grid, so neither is offered. */
export function rangePresets(year, asOfMonth) {
  const cutoff = clamp(Math.round(asOfMonth ?? 12) || 12, 1, 12);
  const qIndex = Math.floor((cutoff - 1) / 3);
  const out = [
    { id: "ytd", label: "Year to date", first: 1, last: cutoff },
    { id: "full-year", label: "Full year", first: 1, last: 12 },
    { id: "this-quarter", label: "This quarter", first: qIndex * 3 + 1, last: cutoff },
  ];
  // Only when the prior quarter is a quarter of this year — the ledger
  // behind this page is one year deep.
  if (qIndex > 0) {
    out.push({ id: "last-quarter", label: "Last quarter",
               first: (qIndex - 1) * 3 + 1, last: (qIndex - 1) * 3 + 3 });
  }
  out.push({ id: "custom", label: "Custom range", first: null, last: null });
  return out;
}

/** Which preset a window is, or "custom" once it stops being any of them. */
export function detectPreset(range, presets) {
  const win = normalizeRange(range);
  const hit = (presets || []).find(
    (p) => p.id !== "custom" && p.first === win.first && p.last === win.last);
  return hit?.id || "custom";
}

/** The sub-columns left after the Filters menu has had its say.
 *
 *  Var % rides with Var $ — one question in two units. It shows against a
 *  single period only: per month a small budget swings it to three figures.
 */
export function subColumns(hidden, withPct) {
  const h = new Set(hidden || []);
  const out = [];
  if (!h.has("actual")) out.push({ label: "Actual", type: "actual" });
  if (!h.has("budget")) out.push({ label: "Budget", type: "budget" });
  if (!h.has("variance")) {
    out.push({ label: "Var $", type: "var" });
    if (withPct) out.push({ label: "Var %", type: "pct" });
  }
  return out;
}

/** Every month a window covers. */
export function monthsInRange(range) {
  const win = normalizeRange(range);
  return monthsBetween(win.first, win.last);
}

/** Whether a hide-columns checkbox can still be ticked. */
export function canHide(hidden, type) {
  const h = hidden || [];
  return h.includes(type) || h.length < MAX_HIDDEN_COLUMNS;
}

const CHIP_NAME = { actual: "Actual", budget: "Budget", variance: "Variance" };

/** The chips beside the Filters button, naming what is on. */
export function filterChips(filters) {
  const hidden = filters?.hidden || [];
  const out = [];
  if (hidden.length === 1) {
    out.push({ id: "hidden", label: `Hide column: ${CHIP_NAME[hidden[0]] || hidden[0]}` });
  } else if (hidden.length > 1) {
    out.push({ id: "hidden", label: `Hide columns: (${hidden.length})` });
  }
  if (filters?.showYtd) out.push({ id: "showYtd", label: "YTD: On" });
  return out;
}

/** Whether anything has moved from the state the page opens in. */
export function isDefaultFilters(filters, defaults = DEFAULT_FILTERS) {
  return filters?.frequency === defaults.frequency
    && !!filters?.showYtd === !!defaults.showYtd
    && (filters?.hidden || []).length === (defaults.hidden || []).length;
}

/** One row's budget, actual and variance over one column's months.
 *
 *  A row with no monthly array has only a year-end figure, and splitting
 *  that across periods would invent a plan the firm never wrote.
 */
export function cellFor(row, column, actualsByMonth) {
  const monthly = Array.isArray(row?.monthly) ? row.monthly : null;
  const codes = row?.gl_codes || [];
  let budget = 0;
  let actual = 0;
  for (const m of column.months) {
    if (monthly) budget += monthly[m - 1] || 0;
    for (const gl of codes) {
      actual += (actualsByMonth.get(gl) || [])[m - 1] || 0;
    }
  }
  // A period still to come cannot have an actual. Zero would read as an
  // underspend the firm has not had the chance to make.
  if (column.future) return { budget, actual: null, variance: null };
  return { budget, actual, variance: actual - budget };
}

/** Sums cells into the section-total row beneath them. */
export function sumCells(cells) {
  let budget = 0;
  let actual = 0;
  let anyActual = false;
  for (const c of cells) {
    budget += c.budget || 0;
    if (c.actual !== null) { actual += c.actual; anyActual = true; }
  }
  if (!anyActual) return { budget, actual: null, variance: null };
  return { budget, actual, variance: actual - budget };
}
