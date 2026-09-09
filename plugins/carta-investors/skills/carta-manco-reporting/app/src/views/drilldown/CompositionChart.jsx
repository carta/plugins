import { fmtCurrencyShort } from "../../charts/chartTheme.js";
import { InkBarChart, escapeHtml } from "../../ui/components.jsx";

// Small chart at the top of the drilldown drawer: monthly time series or a
// horizontal top-N bar of vendors/tags/partners, per `kind`.
export default function CompositionChart({ kind, monthly, items, labelSingular, highlightIndex, color = "var(--ink-color-global-data-viz-lime-2)", height = 140 }) {
  if (kind === "monthly") {
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"];
    return (
      <InkBarChart
        id="composition-monthly"
        height={height}
        orientation="vertical"
        layout="single"
        series={[{ name: "Spend", values: monthly }]}
        labels={labels}
        formatValue={fmtCurrencyShort}
        colorFor={(_v, i) => (i === highlightIndex ? "var(--ink)" : color)}
        padding={{ top: 8, right: 8, bottom: 20, left: 56 }}
        ariaLabel="Monthly spend for this drill, January through July."
      />
    );
  }

  if (kind === "topN" && items?.length) {
    return (
      <InkBarChart
        id="composition-topn"
        height={height}
        orientation="horizontal"
        layout="single"
        series={[{ name: labelSingular || "entry", color: "var(--ink-color-global-data-viz-lime-3)", values: items.map((i) => i.amount) }]}
        labels={items.map((i) => i.name)}
        formatValue={fmtCurrencyShort}
        renderTooltip={(i) => {
          const it = items[i];
          const note = it ? `${it.count} ${labelSingular || "entry"}${it.count === 1 ? "" : "s"}` : "";
          return (
            `<div class="ink-chart__tip-compact"><span class="ink-chart__tip-sw" style="background:var(--ink-color-global-data-viz-lime-3)"></span>` +
            `<span class="ink-chart__tip-name">${escapeHtml(items[i].name)}</span>` +
            `<span class="ink-chart__tip-val">${fmtCurrencyShort(items[i].amount)}</span></div>` +
            (note ? `<div class="ink-chart__tip-row"><span class="ink-chart__tip-name">${escapeHtml(note)}</span></div>` : "")
          );
        }}
        padding={{ top: 8, right: 16, bottom: 8, left: 140 }}
        ariaLabel={`Top ${labelSingular || "entries"} by amount.`}
      />
    );
  }

  return null;
}
