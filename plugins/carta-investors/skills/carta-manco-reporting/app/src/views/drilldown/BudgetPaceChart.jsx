import { fmtCurrencyShort } from "../../charts/chartTheme.js";
import { InkBarChart, InkLineChart } from "../../ui/components.jsx";
import { MICRO } from "../../ui/theme.js";

// Budget against actuals over time, at whatever resolution the workbook
// actually states — never finer.
//
// Three shapes, because firms author budgets a few ways:
//
//   monthly    The workbook gives real Jan–Dec figures. Plot them against
//              actuals summed into the same months — the finest real
//              comparison this chart can draw.
//
//   quarterly  The workbook gives Q1–Q4 figures. Plot them against actuals
//              summed into the same quarters. Real comparison, real periods.
//
//   pace       The workbook gives one YTD figure and no time axis at all.
//              Plot cumulative actuals against a straight line to that
//              figure. The line is an even-spread reference, not the firm's
//              phasing, and is labelled as such — a budget that lands in one
//              month (annual insurance) will cross it early and that is the
//              chart working, not a miss.
//
// A budget line never gets a finer axis than the workbook itself stated —
// interpolating quarters into months would be our arithmetic wearing the
// firm's name.

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                "Sep", "Oct", "Nov", "Dec"];

// Shared with DrilldownContent.jsx, which renders this as a (?) tooltip next
// to the "Budget vs actual over time" header instead of a paragraph here.
export function paceNote(mode, period) {
  return mode === "monthly"
    ? "Budget by month, as stated in the workbook. Actuals summed into the same months."
    : mode === "quarterly"
    ? "Budget by quarter, as stated in the workbook. Actuals summed into the same quarters."
    : `This budget is a single ${period?.label ? `${period.label} ` : ""}total with no monthly detail, so the dashed line spreads it evenly as a pace reference — it is not the firm's own phasing.`;
}

export function paceModeFor(monthlyBudget, quarterlyBudget) {
  return monthlyBudget?.length === 12 ? "monthly"
    : quarterlyBudget?.length === 4 ? "quarterly" : "pace";
}

export default function BudgetPaceChart({
  quarterlyBudget, monthlyBudget, monthlyActual, budget, period, height = 150,
  budgetColor = "var(--local-series-blue-tint)",
  actualColor = "var(--ink-color-global-data-viz-lime-2)",
}) {
  const mode = paceModeFor(monthlyBudget, quarterlyBudget);
  const actual = monthlyActual || [];
  // Trailing empty months are the year not reaching them yet, not zeros.
  let last = actual.length;
  while (last > 0 && !actual[last - 1]) last -= 1;
  const elapsed = Math.max(last, 1);

  if (mode === "monthly" || mode === "quarterly") {
    const isMonthly = mode === "monthly";
    const covered = isMonthly
      ? Array.from({ length: 12 }, (_, m) => m).filter((m) => m < elapsed)
      : [0, 1, 2, 3].filter((q) => q * 3 < elapsed);
    const labels = covered.map((p) => (isMonthly ? MONTHS[p] : QUARTERS[p]));
    const actualPer = isMonthly
      ? covered.map((m) => actual[m] || 0)
      : covered.map((q) => actual.slice(q * 3, q * 3 + 3).reduce((s, v) => s + (v || 0), 0));
    const budgetPer = isMonthly
      ? covered.map((m) => monthlyBudget[m] || 0)
      : covered.map((q) => quarterlyBudget[q] || 0);
    return (
      <InkBarChart
        id="pace-bar"
        height={height}
        orientation="vertical"
        layout="grouped"
        series={[
          { name: "Budget", color: budgetColor, values: budgetPer },
          { name: "Actual", color: actualColor, values: actualPer },
        ]}
        labels={labels}
        legend
        formatValue={fmtCurrencyShort}
        padding={{ top: 8, right: 8, bottom: 20, left: 56 }}
        valueTicks={3}
        ariaLabel={`Budget versus actual by ${isMonthly ? "month" : "quarter"}.`}
      />
    );
  }

  // Only the months the budget covers. A quarter's budget spread from
  // January would show three months of flat line before the period starts.
  const from = (period?.first_month ?? 1) - 1;
  const to = Math.min(period?.last_month ?? elapsed, elapsed);
  const labels = MONTHS.slice(from, to);
  let run = 0;
  const cumulative = labels.map((_, i) => (run += actual[from + i] || 0));
  const step = (budget || 0) / Math.max(labels.length, 1);
  return (
    <InkLineChart
      id="pace-line"
      height={height}
      series={[
        { name: "Actual to date", color: actualColor, values: cumulative },
        { name: "Even-spread pace", color: MICRO, dashed: true, width: 1.5,
          values: labels.map((_, i) => Math.round(step * (i + 1))) },
      ]}
      labels={labels}
      legend
      formatValue={fmtCurrencyShort}
      padding={{ top: 8, right: 8, bottom: 20, left: 56 }}
      valueTicks={3}
      ariaLabel="Cumulative actual spend against an even-spread pace reference."
    />
  );
}
