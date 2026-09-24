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
  const { labels: actualLabels, funds, projectedLabels = [], projectedFunds = [],
          expectedRemaining = [] } = feeSchedule;

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

  // What the year still expects, stacked on the in-progress column. The YTD
  // bar otherwise reads as a collapse against every prior year, when what it
  // shows is a year that has not finished billing.
  const expectedByFund = new Map(expectedRemaining.map((f) => [f.name, f.amount]));
  const expectedTotal = visible.reduce((sum, f) => sum + (expectedByFund.get(f.name) || 0), 0);

  // "Hide projections" hides every estimate, including this year's. The
  // quarters it has yet to bill are a projection like any other.
  const showExpected = showProjections && provisionalFrom != null && expectedTotal > 0;

  // Every estimate sits above every booked figure, in the fund's own
  // colour: the bar reads as what the ledger holds, then what is to come.
  const plotted = showExpected
    ? [...series, ...series.map((s, si) => ({
        name: `${s.name} — expected`,
        color: s.color,
        estimated: true,
        legendHidden: true,
        values: labels.map((_, i) =>
          (i === provisionalFrom ? (expectedByFund.get(visible[si].name) || 0) : 0)),
      }))]
    : series;

  // The estimates are the second half of the list, one per fund in order.
  const fundAt = (seriesIndex) => visible[seriesIndex % visible.length];

  return (
    <InkBarChart
      id="fee-income"
      height={340}
      title={title}
      sub={sub}
      headerControl={headerControl}
      orientation="vertical"
      layout="stacked"
      series={plotted}
      labels={labels.map(cleanLabel)}
      provisionalFrom={provisionalFrom}
      // Booked is booked, whether or not the estimate above it is shown.
      // Hatching the column would fade the ledger's own figures.
      provisionalPaint={false}
      projectedFrom={projectedFrom}
      legend
      onSelect={onSelect
        ? (seriesIndex, i) => {
            const fund = fundAt(seriesIndex);
            return fund && onSelect({
              fund: fund.name,
              yearLabel: allLabels[offset + i],
              isProjected: projectedFrom != null && i >= projectedFrom,
            });
          }
        : undefined}
      formatValue={fmtCurrencyShort}
      valueTicks={4}
      renderTooltip={(i, { series: s, formatValue: fmt }) => {
        const rawLabel = allLabels[offset + i];
        const isProjected = projectedFrom != null && i >= projectedFrom;
        const isProvisional = !isProjected && provisionalFrom != null && i >= provisionalFrom;
        const note = isProjected ? " · projected" : isProvisional ? " · in progress" : "";
        // Read in the order the bar stacks: what is still expected on top,
        // what the ledger holds beneath it, each biggest first.
        const segs = s
          .map((ser) => ({ name: ser.name, color: ser.color,
                           v: ser.values[i] || 0, estimated: !!ser.estimated }))
          .filter((seg) => seg.v > 0)
          .sort((a, b) => (b.estimated - a.estimated) || (b.v - a.v));
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
