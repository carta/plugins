import { isCustomReportBudget } from "./reportNav.js";

// A budget with figures of its own: a department crosstab, or a by-line-item/by-account
// budget (including a Carta-sourced one, which has no dimension) with rows.
const hasBudgetFigures = (b) =>
  (Array.isArray(b.by_tag_value) && b.by_tag_value.length > 0)
  || (((b.view_kinds || []).includes("by-line-item")
       || (b.view_kinds || []).includes("by-account"))
      && Array.isArray(b.rows) && b.rows.length > 0);

// Single source of truth for which budgets[] entries have something to show — shared by
// every nav gate that needs it. A plain budget counts only with figures of its own
// (hasBudgetFigures); a custom report always counts, even one cut to zero budget rows (an
// actuals-only report, with nothing to compare against): its own Actual figures come
// straight from the ledger, never from its own rows — see
// views/customReport/pivot.js's VALUE_FIELDS.actual.
//
// Handles both snapshot shapes: hosted (`snapshot.budget` is `null` with no
// budget) and local (`snapshot.budget.budgets` is `[]`). Never test
// `snapshot.budget` for truthiness directly — see build_manco_datadir.py's
// read_budgets vs. worker.js's buildBudget.
export function renderableBudgets(snapshot) {
  const budgets = snapshot?.budget?.budgets;
  if (!Array.isArray(budgets)) return [];
  return budgets.filter((b) => isCustomReportBudget(b) || hasBudgetFigures(b));
}

// Whether this firm has an actual budget to show Budget vs Actuals for. Budget vs Actuals
// stays a valid parent whenever an entry with budget figures of its own routes under it —
// a plain budget, or a custom report (yours or one shared with you) that still has budget
// rows to show alongside its ledger-driven Actual. A custom report cut to zero budget rows
// (an actuals-only report) fails this: Budget vs Actuals drops out of the nav (Monthly
// Actuals shows instead for the firm's own books), but the report itself still opens on
// its own page — see App.jsx's customPageOpens, which never gates on this.
export function hasBudget(snapshot) {
  return renderableBudgets(snapshot).some(hasBudgetFigures);
}
