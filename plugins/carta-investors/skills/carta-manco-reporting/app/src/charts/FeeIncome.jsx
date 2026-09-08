import { fmtCurrencyShort } from "./chartTheme.js";
import { InkBarChart, escapeHtml } from "../ui/components.jsx";

// Strip " YTD" so the label fits the bar's band width without SVG clipping.
function cleanLabel(lab) {
  return lab.replace(/\s+YTD$/i, "");
}

// `yearStartIdx` slices labels/data so the chart shows only the requested years.
// `onSelect` receives the raw label (with "YTD") for drill-down routing.
// `showProjections` extends the chart with future-year estimates from the fee schedule.
export default function FeeIncome({
  feeSchedule, selectedFunds, yearStartIdx = 0,
  showProjections = false, onSelect, title, sub, headerControl,
}) {
  if (!feeSchedule) return null;
  const { labels: actualLabels, funds, projectedLabels = [], projectedFunds = [] } = feeSchedule;

  const allLabels = showProjections ? [...actualLabels, ...projectedLabels] : actualLabels;
  const labels = allLabels.slice(yearStartIdx);
  const offset = yearStartIdx;
  const actualCount = actualLabels.length;  // where projected data begins in allLabels

  const visible = selectedFunds ? funds.filter((f) => selectedFunds.has(f.name)) : funds;
  if (!visible.length) return null;

  // When projections are on, extend each fund's values with projected amounts.
  const series = visible.map((f) => {
    const projFund = showProjections ? projectedFunds.find((pf) => pf.name === f.name) : null;
    const projData = projFund
      ? projFund.data.map((v) => v ?? 0)
      : new Array(projectedLabels.length).fill(0);
    const combined = showProjections ? [...f.data, ...projData] : f.data;
    return { name: f.name, color: f.color, values: combined.slice(offset) };
  });

  const provisionalIdx = labels.findIndex((l) => /YTD/i.test(l));
  const provisionalFrom = provisionalIdx >= 0 ? provisionalIdx : undefined;

  const projectedFrom = showProjections && projectedLabels.length > 0
    ? Math.max(0, actualCount - offset)
    : undefined;

  return (
    <InkBarChart
      id="fee-income"
      height={340}
      title={title}
      sub={sub}
      headerControl={headerControl}
      orientation="vertical"
      layout="stacked"
      series={series}
      labels={labels.map(cleanLabel)}
      provisionalFrom={provisionalFrom}
      projectedFrom={projectedFrom}
      legend
      onSelect={onSelect
        ? (seriesIndex, i) => onSelect({
            fund: visible[seriesIndex].name,
            yearLabel: allLabels[offset + i],
            isProjected: projectedFrom != null && i >= projectedFrom,
          })
        : undefined}
      formatValue={fmtCurrencyShort}
      valueTicks={4}
      renderTooltip={(i, { series: s, formatValue: fmt }) => {
        const rawLabel = allLabels[offset + i];
        const isProjected = projectedFrom != null && i >= projectedFrom;
        const isProvisional = !isProjected && provisionalFrom != null && i >= provisionalFrom;
        const note = isProjected ? " · projected" : isProvisional ? " · in progress" : "";
        const segs = s
          .map((ser) => ({ name: ser.name, color: ser.color, v: ser.values[i] || 0 }))
          .filter((seg) => seg.v > 0)
          .sort((a, b) => b.v - a.v);
        const total = segs.reduce((sum, seg) => sum + seg.v, 0);
        if (!total) return `<div class="ink-chart__tip-head">${escapeHtml(rawLabel + note)}</div>`;
        return (
          `<div class="ink-chart__tip-head">${escapeHtml(rawLabel + note)}</div>` +
          segs.map((seg) =>
            `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:${seg.color}"></span>` +
            `<span class="ink-chart__tip-name">${escapeHtml(seg.name)}</span><span class="ink-chart__tip-val">${fmt(seg.v, 2)}</span></div>`
          ).join("") +
          `<div class="ink-chart__tip-total"><span class="ink-chart__tip-name">Total</span>` +
          `<span class="ink-chart__tip-val">${fmt(total, 2)}</span></div>`
        );
      }}
      ariaLabel="Management fee income by fund, by year."
    />
  );
}
