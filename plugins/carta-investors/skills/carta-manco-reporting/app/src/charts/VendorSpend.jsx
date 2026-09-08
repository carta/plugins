import { fmtCurrencyShort } from "./chartTheme.js";
import { InkBarChart, escapeHtml } from "../ui/components.jsx";

// Vendors the ledger names, biggest first, with any approved description
// inferences stacked in a lighter shade beside them.
export default function VendorSpend({ vendorSpend, onSelect, title, sub, compact }) {
  const allVendors = vendorSpend?.vendors || [];
  if (!allVendors.length) return null;
  // Compact half-width placement: show only the top few vendors.
  const vendors = compact ? allVendors.slice(0, 7) : allVendors;
  const truncated = vendors.length < allVendors.length;
  const chartSub = truncated
    ? `${sub} Showing top ${vendors.length} of ${allVendors.length} vendors.`
    : sub;

  const labels = vendors.map((v) => v.vendor);
  const ledger = vendors.map((v) => v.amount - v.inferred_amount);
  const inferred = vendors.map((v) => v.inferred_amount);
  const anyInferred = inferred.some((v) => v > 0);

  const series = [{ name: "From Carta", color: "var(--ink-color-global-data-viz-lime-3)", values: ledger }];
  if (anyInferred) series.push({ name: "Inferred from description", color: "var(--local-series-lime-tint)", values: inferred });

  return (
    <InkBarChart
      id="vendor-spend"
      height={compact ? 220 : Math.max(220, vendors.length * 28 + 60)}
      title={title}
      sub={chartSub}
      orientation="horizontal"
      layout="stacked"
      series={series}
      labels={labels}
      onSelect={onSelect ? (_seriesIndex, i) => onSelect({ vendor: vendors[i].vendor }) : undefined}
      formatValue={fmtCurrencyShort}
      renderTooltip={(i, { formatValue: fmt }) => {
        const v = vendors[i];
        const ledgerAmt = v.amount - v.inferred_amount;
        let rows =
          `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:var(--ink-color-global-data-viz-lime-3)"></span>` +
          `<span class="ink-chart__tip-name">From Carta</span><span class="ink-chart__tip-val">${fmt(ledgerAmt, 2)}</span></div>`;
        if (v.inferred_amount > 0) {
          rows += `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:var(--local-series-lime-tint)"></span>` +
            `<span class="ink-chart__tip-name">Inferred from description</span><span class="ink-chart__tip-val">${fmt(v.inferred_amount, 2)}</span></div>`;
        }
        const note = [`${v.count} ${v.count === 1 ? "entry" : "entries"}`];
        if (v.aggregated) note.push("Grouped by account — individuals not named");
        return `<div class="ink-chart__tip-head">${escapeHtml(v.vendor)}</div>${rows}` +
          note.map((n) => `<div class="ink-chart__tip-row"><span class="ink-chart__tip-name">${escapeHtml(n)}</span></div>`).join("");
      }}
      padding={{ top: 8, right: 16, bottom: 28, left: 160 }}
      ariaLabel="Spend by vendor, largest first."
    />
  );
}
