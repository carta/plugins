import { fmtCurrencyShort, isPartialPeriod } from "./chartTheme.js";
import { InkBarChart, escapeHtml } from "../ui/components.jsx";

export default function Cashflow({ monthlyCashflow, onSelect, title, sub, asOf }) {
  if (!monthlyCashflow) return null;
  const { labels, income, expenses } = monthlyCashflow;
  const net = income.map((inc, i) => inc - expenses[i]);
  const expNeg = expenses.map((e) => -e);
  const provisionalFrom = asOf && isPartialPeriod(asOf) ? labels.length - 1 : undefined;

  return (
    <InkBarChart
      id="cashflow"
      height={280}
      title={title}
      sub={sub}
      orientation="vertical"
      layout="stacked"
      domain="signed"
      // Cool/warm pairing, not full red/green — blue-3 wrapped locally
      // for dark-mode legibility, brown-3 as-is.
      series={[
        { name: "Income", color: "var(--local-series-blue-l1)", values: income },
        { name: "Expenses", color: "var(--ink-color-global-data-viz-brown-3)", values: expNeg },
      ]}
      lineOverlay={[{ name: "Monthly net", color: "var(--ink)", values: net }]}
      labels={labels}
      provisionalFrom={provisionalFrom}
      onSelect={
        onSelect
          ? (seriesIndex, i) => onSelect({ month: i + 1, side: seriesIndex === 0 ? "income" : "expense" })
          : undefined
      }
      formatValue={fmtCurrencyShort}
      valueTicks={4}
      // Same shape as the fee-income and monthly-expenses tooltips: a
      // header, the contributing series largest-first with their swatches,
      // and the figure they resolve to on its own total row. Here that
      // bottom line is the month's net, which is what this chart is for —
      // it was previously a third ordinary row, reading as a peer of the
      // two figures it is derived from.
      renderTooltip={(i, { series, lineOverlay: overlay, formatValue: fmt }) => {
        const rows = series
          .map((s) => ({ name: s.name, color: s.color, v: s.values[i] || 0 }))
          // Expenses are held negative so they draw below the axis; rank on
          // magnitude, or the larger of the two always sorts last.
          .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
          .map((s) => {
            // Negatives in parentheses, per Carta's number conventions.
            const shown = s.v < 0 ? `(${fmt(Math.abs(s.v))})` : fmt(s.v);
            return `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:${s.color}"></span>` +
                   `<span class="ink-chart__tip-name">${escapeHtml(s.name)}</span>` +
                   `<span class="ink-chart__tip-val">${shown}</span></div>`;
          }).join("");
        const netTotals = (overlay || []).map((s) => {
          const v = s.values[i] || 0;
          const shown = v < 0 ? `(${fmt(Math.abs(v))})` : fmt(v);
          return `<div class="ink-chart__tip-total"><span class="ink-chart__tip-name">${escapeHtml(s.name)}</span>` +
                 `<span class="ink-chart__tip-val">${shown}</span></div>`;
        }).join("");
        const provNote = provisionalFrom != null && i >= provisionalFrom ? " · in progress" : "";
        return `<div class="ink-chart__tip-head">${escapeHtml(labels[i] + provNote)}</div>${rows}${netTotals}`;
      }}
      ariaLabel="Monthly income and expenses, with a net cash line."
    />
  );
}
