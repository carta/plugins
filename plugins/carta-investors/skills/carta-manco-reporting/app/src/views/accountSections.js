// Narrower than the other budget tables' shared LABEL_MIN_WIDTH (320): GL
// account names here run short ("Audit fees", "Management fee income"), so
// the full-width column was mostly blank space.
export const ACCOUNT_LABEL_MIN_WIDTH = 220;

// The one rule every GL-account table in this app sorts and sections by:
// income is a 4xxx account, everything else is an operating expense.
// Shared by BudgetActualsAccounts (budgeted rows) and MonthlyActualsView
// (actuals-only rows) so the split can't drift between the two.

export function isIncomeAccountType(accountType) {
  return String(accountType ?? "")[0] === "4";
}

// The two sections of an income statement, and the side of it an account is on.
export const INCOME_SECTION = { title: "Income", polarity: "income" };
export const EXPENSE_SECTION = { title: "Operating Expenses", polarity: "expense" };
export const accountPolarity = (accountType) =>
  (isIncomeAccountType(accountType) ? INCOME_SECTION.polarity : EXPENSE_SECTION.polarity);

// GL code ascending, the order an income statement is read in.
export function byAccountCode(a, b) {
  return (a.account_type ?? 0) - (b.account_type ?? 0) || a.label.localeCompare(b.label);
}

/** Splits rows with an `account_type` into Income / Operating Expenses
 *  sections, each sorted by GL code, empty sections dropped. */
export function accountSections(rows) {
  const income = rows.filter((r) => isIncomeAccountType(r.account_type));
  const expense = rows.filter((r) => !isIncomeAccountType(r.account_type));
  return [
    { ...INCOME_SECTION, rows: income.sort(byAccountCode) },
    { ...EXPENSE_SECTION, rows: expense.sort(byAccountCode) },
  ].filter((s) => s.rows.length);
}

/** The label for a GL account: its name where Carta gave it one, else
 *  `GL <code>`. Shared so a reader sees the same text for an unnamed account
 *  wherever it shows up. */
export function accountLabel(gl, nameByGl) {
  return nameByGl.get(gl) || `GL ${gl}`;
}

/** Actuals per GL account per month, as a Map<gl, number[12]>. Shared by
 *  BudgetActualsAccounts (summed over a budget's gl_codes) and
 *  MonthlyActualsView (one row per GL code directly). */
export function actualByGlByMonth(entries) {
  const out = new Map();
  for (const e of entries || []) {
    const gl = e.acct_type;
    if (gl == null || typeof e.mo !== "number") continue;
    if (e.mo < 1 || e.mo > 12) continue;
    if (!out.has(gl)) out.set(gl, new Array(12).fill(0));
    out.get(gl)[e.mo - 1] += e.amount || 0;
  }
  return out;
}
