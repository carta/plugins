// Fee tier months are 1-based and inclusive (1 to 60 is the first five years); a tier with no end month runs until the fund ends.

// `null >= 0` is true in JavaScript, so a blank box would pass a bare comparison.
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const newId = () => `fee-${Math.random().toString(36).slice(2, 8)}`;

export function feeTier({ rate = 0.02, basis = "committed", startMonth = 1, endMonth = null } = {}) {
  return { id: newId(), rate, basis, startMonth, endMonth };
}

export const EVERGREEN_YEARS = 15;

export const termYearsOf = (general, fallback = 10) => (general?.evergreen ? EVERGREEN_YEARS : general?.termYears || fallback);

export const termMonthsOf = (general) => Math.round(termYearsOf(general) * 12);

/** A tier's months as [from, to) in the engine's 0-based months. Tiers saved in years still work. */
export function tierWindow(t, termMonths) {
  if (!isNum(t.startMonth) && isNum(t.startYear)) return [Math.round(t.startYear * 12), Math.min(Math.round((t.endYear ?? 0) * 12), termMonths)];
  // An end month can outlast a term shortened after it was set; the tier still stops with the fund.
  return [Math.max(0, (t.startMonth ?? 1) - 1), t.endMonth == null ? termMonths : Math.min(t.endMonth, termMonths)];
}

export function tierFromYears(t, termMonths) {
  const startMonth = Math.round((t.startYear ?? 0) * 12) + 1;
  const endMonth = Math.round((t.endYear ?? 0) * 12);
  return { id: t.id, rate: t.rate, basis: t.basis ?? "committed", startMonth, endMonth: endMonth >= termMonths ? null : endMonth };
}

export const normalizeTiers = (tiers, termMonths) => (tiers ?? []).map((t) => (isNum(t.startMonth) || !isNum(t.startYear) ? t : tierFromYears(t, termMonths)));

export function validateFeeTiers(tiers, termMonths = Infinity) {
  const e = {};
  for (const t of tiers ?? []) {
    if (!(isNum(t.rate) && t.rate >= 0 && t.rate < 0.2)) e[t.id] = "Fee rate must be between 0% and 20% a year.";
    else if (!(Number.isInteger(t.startMonth) && t.startMonth >= 1)) e[t.id] = "Enter the month the tier starts, a whole number from 1.";
    else if (t.startMonth > termMonths) e[t.id] = `This tier starts after the fund ends, in month ${termMonths}.`;
    else if (t.endMonth != null && !(Number.isInteger(t.endMonth) && t.endMonth >= t.startMonth)) e[t.id] = "The end month must be a whole number, no earlier than the start month.";
  }
  return e;
}

/** Runs of months covered by no tier, or by more than one, as 1-based [from, to] ranges. */
export function tierCoverage(tiers, termMonths) {
  const count = new Array(termMonths).fill(0);
  for (const t of tiers ?? []) {
    const [a, b] = tierWindow(t, termMonths);
    for (let m = Math.max(0, a); m < Math.min(b, termMonths); m++) count[m]++;
  }
  const runs = (test) => {
    const out = [];
    for (let m = 0; m < termMonths; m++) {
      if (!test(count[m])) continue;
      const from = m;
      while (m + 1 < termMonths && test(count[m + 1])) m++;
      out.push([from + 1, m + 1]);
    }
    return out;
  };
  return { gaps: runs((c) => c === 0), overlaps: runs((c) => c > 1) };
}

/** After an open-ended tier, a new tier is a step-down: cut at the investment period's end (or halfway), half a point less. */
export function nextFeeTier(tiers, general) {
  const T = termMonthsOf(general);
  const last = tiers?.at(-1);
  if (!last) return { cut: null, tier: feeTier() };
  const lastStart = last.startMonth ?? 1;
  if (last.endMonth == null) {
    const ip = Math.round((general?.investmentPeriodYears || 0) * 12);
    const split = ip > lastStart && ip < T ? ip : Math.max(lastStart, Math.floor((lastStart - 1 + T) / 2));
    return { cut: split, tier: feeTier({ rate: Math.max(0, Math.round(((last.rate ?? 0) - 0.005) * 1e4) / 1e4), basis: last.basis, startMonth: split + 1 }) };
  }
  return { cut: null, tier: feeTier({ rate: last.rate, basis: last.basis, startMonth: last.endMonth + 1 }) };
}

/** Every tier is charged on commitments, so fees don't depend on the portfolio. */
export const tiersOnCommitments = (tiers) => (tiers ?? []).every((t) => (t.basis ?? "committed") === "committed");

/** The calendar month ("2027-03") of a 1-based fund month: month 1 is the month the fund starts. */
export function monthToYm(startDate, month) {
  const a = /^(\d{4})-(\d{2})$/.exec(startDate ?? "");
  if (!a || !isNum(month)) return null;
  const idx = +a[1] * 12 + (+a[2] - 1) + (month - 1);
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** The 1-based fund month of a calendar month ("2027-03"), or null when either date isn't a month. */
export function ymToMonth(startDate, ym) {
  const a = /^(\d{4})-(\d{2})$/.exec(startDate ?? ""), b = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!a || !b) return null;
  return (+b[1] - +a[1]) * 12 + (+b[2] - +a[2]) + 1;
}

/** The day is ignored, so "2027-03-31" to "2027-04-01" counts as one month. */
export const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));

/** Fund expenses over the fund's whole life: an amount, or a share of commitments. */
export const expenseTotalOf = (f, general) => (f?.expenseMode === "pct" ? (f.expenseTotalPct || 0) * (general?.committed || 0) : f?.expenseTotal || 0);

export function expenseError(f) {
  const bad = f?.expenseMode === "pct" ? !isNum(f.expenseTotalPct) || f.expenseTotalPct < 0 || f.expenseTotalPct > 1 : !isNum(f?.expenseTotal) || f.expenseTotal < 0;
  return bad ? "Enter fund expenses of zero or more." : null;
}

/** Fund expenses a plan saved as separate lines, as the one total they add up to within the fund's term. */
export const totalOfExpenseLines = (lines, termYears = Infinity) => (lines ?? [])
  .reduce((s, x) => s + (x.annualAmount || 0) * Math.max(0, Math.min(x.endYear ?? 0, termYears) - (x.startYear ?? 0)), 0);

/** The total spread evenly across the term; settings saved as separate lines with no total are charged as those lines until next loaded. */
export function expenseSchedule(f, general) {
  if (Array.isArray(f?.expenses) && f.expenseTotal == null && f.expenseTotalPct == null) return f.expenses;
  const term = termYearsOf(general);
  return [{ id: "expenses", name: "Fund expenses", annualAmount: expenseTotalOf(f, general) / term, startYear: 0, endYear: term }];
}

