import { fmtCurrencyShort } from "./chartTheme.js";
import { InkBarChart, escapeHtml } from "../ui/components.jsx";

export default function SpendByGL({ spendByGL, onSelect, title, sub }) {
  if (!spendByGL?.accounts?.length) return null;
  const sorted = [...spendByGL.accounts].sort((a, b) => b.actual - a.actual);
  const labels = sorted.map((a) => a.name);
  const actuals = sorted.map((a) => a.actual);
  const budgets = sorted.map((a) => a.budget ?? 0);
  const hasBudget = budgets.some((b) => b > 0);

  const series = [];
  if (hasBudget) series.push({ name: "YTD Budget", color: "var(--local-series-blue-pale)", values: budgets });
  series.push({
    name: "YTD Actual",
    values: actuals,
    colorFor: (v, i) => (sorted[i].budget > 0 && v > sorted[i].budget ? "var(--local-mark-negative)" : "var(--ink-color-global-data-viz-lime-3)"),
  });

  return (
    <InkBarChart
      id="spend-by-gl"
      height={380}
      title={title}
      sub={sub}
      orientation="horizontal"
      layout="grouped"
      series={series}
      labels={labels}
      onSelect={onSelect ? (_seriesIndex, i) => onSelect({ name: sorted[i].name }) : undefined}
      formatValue={fmtCurrencyShort}
      renderTooltip={(i, { formatValue: fmt }) => {
        const a = sorted[i];
        const rows = hasBudget
          ? `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:var(--local-series-blue-pale)"></span>` +
            `<span class="ink-chart__tip-name">YTD Budget</span><span class="ink-chart__tip-val">${fmt(a.budget || 0, 2)}</span></div>`
          : "";
        const over = a.budget > 0 && a.actual > a.budget;
        const actualColor = over ? "var(--local-mark-negative)" : "var(--ink-color-global-data-viz-lime-3)";
        const actualRow =
          `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:${actualColor}"></span>` +
          `<span class="ink-chart__tip-name">YTD Actual</span><span class="ink-chart__tip-val">${fmt(a.actual, 2)}</span></div>`;
        let note = "";
        if (a.budget) {
          const diff = a.actual - a.budget;
          const pct = Math.round((diff / a.budget) * 100);
          const fmtDiff = fmt(Math.abs(diff), 0);
          note = `<div class="ink-chart__tip-row"><span class="ink-chart__tip-name">` +
            (diff > 0 ? `⚠ Over by ${fmtDiff} (+${pct}%)` : `✓ Under by ${fmtDiff} (${pct}%)`) +
            `</span></div>`;
        }
        return `<div class="ink-chart__tip-head">${escapeHtml(a.name)}</div>${rows}${actualRow}${note}`;
      }}
      padding={{ top: 8, right: 16, bottom: 28, left: 160 }}
      ariaLabel="Year-to-date spend by GL account, versus budget where one exists."
    />
  );
}
