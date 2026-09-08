import { fmtCurrencyShort } from "./chartTheme.js";
import { InkBarChart } from "../ui/components.jsx";

export default function BudgetVsActuals({ budget, ops, title, sub, compact }) {
  if (!budget || !ops) return null;
  const { total_income, total_expenses } = ops;
  const net_actual = total_income - total_expenses;

  const groups = ["Income", "Expenses", "Net Op. Income"];
  const annual = [budget.income.annual, budget.expenses.annual, budget.net.annual];
  const ytdBudget = [budget.income.ytd, budget.expenses.ytd, budget.net.ytd];
  const ytdActual = [total_income, total_expenses, net_actual];

  return (
    <InkBarChart
      id="budget-vs-actuals"
      height={compact ? 220 : 280}
      title={title}
      sub={sub}
      orientation="vertical"
      layout="grouped"
      series={[
        { name: "Annual budget", color: "var(--local-series-blue-l4)", values: annual },
        { name: "YTD budget", color: "var(--local-series-blue-l1)", values: ytdBudget },
        { name: "YTD actuals", color: "var(--blue)", values: ytdActual },
      ]}
      labels={groups}
      formatValue={fmtCurrencyShort}
      valueTicks={4}
      ariaLabel="Annual budget, year-to-date budget, and year-to-date actuals for income, expenses, and net operating income."
    />
  );
}
