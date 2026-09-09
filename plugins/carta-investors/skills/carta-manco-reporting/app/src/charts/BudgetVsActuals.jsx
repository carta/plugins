import { fmtCurrencyShort } from "./chartTheme.js";
import { InkBarChart, escapeHtml } from "../ui/components.jsx";
import { fmtVariance, varianceColor } from "../ui/variance.js";

export default function BudgetVsActuals({ budget, ops, title, sub, compact }) {
  if (!budget || !ops) return null;
  const { total_income, total_expenses } = ops;
  const net_actual = total_income - total_expenses;

  const groups = ["Income", "Expenses", "Net Op. Income"];
  // Which side of the P&L each group sits on: spending under an expense
  // budget is favourable, earning under an income one is not.
  const POLARITY = ["income", "expense", "income"];
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
      // Same shape as the other three: a header, the bars with their
      // swatches, and the figure they resolve to on its own total row.
      renderTooltip={(i, { series: s, formatValue: fmt }) => {
        // Negatives in parentheses, per Carta's number conventions — a net
        // operating loss is the one figure here that can go below zero.
        const shown = (v) => (v < 0 ? `(${fmt(Math.abs(v))})` : fmt(v));
        const rows = s.map((ser) =>
          `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:${ser.color}"></span>` +
          `<span class="ink-chart__tip-name">${escapeHtml(ser.name)}</span>` +
          `<span class="ink-chart__tip-val">${shown(ser.values[i])}</span></div>`).join("");
        // Against the YTD budget, not the annual one. Sign and colour follow
        // the BvA table's rule, so the same number reads the same way there.
        const variance = ytdActual[i] - ytdBudget[i];
        return `<div class="ink-chart__tip-head">${escapeHtml(groups[i])}</div>${rows}` +
          `<div class="ink-chart__tip-total"><span class="ink-chart__tip-name">YTD variance</span>` +
          `<span class="ink-chart__tip-val" style="color:${varianceColor(variance, POLARITY[i])}">` +
          `${fmtVariance(variance)}</span></div>`;
      }}
      ariaLabel="Annual budget, year-to-date budget, and year-to-date actuals for income, expenses, and net operating income."
    />
  );
}
