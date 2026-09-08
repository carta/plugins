import { useMemo } from "react";
import { fmtCurrencyShort, isPartialPeriod } from "./chartTheme.js";
import { InkBarChart, escapeHtml } from "../ui/components.jsx";

// Stacked bar chart: month × top-8 expense categories + "Other".
// When `dateRange={start,end}` + `entries[]` are provided, the chart is
// re-aggregated from raw entries so it visibly reacts to the range filter
// (labels are trimmed to months touched by the range; a partial month
// only includes entries whose date falls inside the range).
// Click a bar segment → dispatches onSelect({month, category}) to open the drawer.
export default function MonthlyExpensesByCategory({ monthlyCategories, entries, dateRange, onSelect, title, sub, headerControl }) {
  const filtered = useMemo(() => {
    if (!monthlyCategories?.categories?.length) return null;
    if (!dateRange?.start || !dateRange?.end || !entries?.length) return { ...monthlyCategories, startMo: 1 };

    const topNames = monthlyCategories.categories
      .filter(c => c.name !== "Other")
      .map(c => c.name);
    const topSet = new Set(topNames);
    const otherCat = monthlyCategories.categories.find(c => c.name === "Other");

    const [sy, sm] = dateRange.start.split("-").map(Number);
    const [ey, em] = dateRange.end.split("-").map(Number);
    // Only support the current snapshot year — labels remain Jan..Dec of that year
    const yr = sy;
    const startMo = sy === yr ? sm : 1;
    const endMo   = ey === yr ? em : 12;
    if (endMo < startMo) return { ...monthlyCategories, startMo: 1 };

    const monthCount = endMo - startMo + 1;
    const abbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const labels = Array.from({length: monthCount}, (_, i) => abbr[startMo - 1 + i]);

    const byCat = new Map();
    for (const name of topNames) byCat.set(name, new Array(monthCount).fill(0));
    byCat.set("Other", new Array(monthCount).fill(0));

    for (const e of entries) {
      if (e.kind !== "expense") continue;
      if (e.date < dateRange.start || e.date > dateRange.end) continue;
      const eMo = e.mo;
      if (eMo < startMo || eMo > endMo) continue;
      const idx = eMo - startMo;
      const bucket = topSet.has(e.account) ? e.account : "Other";
      const arr = byCat.get(bucket);
      arr[idx] += e.amount;
    }

    const categories = monthlyCategories.categories.map(c => ({
      name: c.name,
      color: c.color,
      data: byCat.get(c.name) || new Array(monthCount).fill(0),
    }));
    return { labels, categories, startMo };
  }, [monthlyCategories, entries, dateRange]);

  if (!filtered?.categories?.length) return null;
  const { labels, categories, startMo } = filtered;
  // dateRange.end already drove endMo above, so its month is the last label.
  const provisionalFrom = dateRange?.end && isPartialPeriod(dateRange.end) ? labels.length - 1 : undefined;

  return (
    <InkBarChart
      id="monthly-expenses-by-category"
      height={320}
      title={title}
      sub={sub}
      headerControl={headerControl}
      orientation="vertical"
      layout="stacked"
      series={categories.map((c) => ({ name: c.name, color: c.color, values: c.data }))}
      labels={labels}
      provisionalFrom={provisionalFrom}
      onSelect={onSelect ? (seriesIndex, i) => onSelect({ month: startMo + i, category: categories[seriesIndex]?.name }) : undefined}
      formatValue={fmtCurrencyShort}
      renderTooltip={(i, { series: s, formatValue: fmt }) => {
        const label = labels[i];
        const isProvisional = provisionalFrom != null && i >= provisionalFrom;
        const note = isProvisional ? " · in progress" : "";
        const segs = s
          .map((ser) => ({ name: ser.name, color: ser.color, v: Math.max(0, ser.values[i] || 0) }))
          .filter((seg) => seg.v > 0)
          .sort((a, b) => b.v - a.v);
        const total = segs.reduce((sum, seg) => sum + seg.v, 0);
        if (!total) return `<div class="ink-chart__tip-head">${escapeHtml(label + note)}</div>`;
        return (
          `<div class="ink-chart__tip-head">${escapeHtml(label + note)}</div>` +
          segs.map((seg) =>
            `<div class="ink-chart__tip-row"><span class="ink-chart__tip-sw" style="background:${seg.color}"></span>` +
            `<span class="ink-chart__tip-name">${escapeHtml(seg.name)}</span><span class="ink-chart__tip-val">${fmt(seg.v)}</span></div>`
          ).join("") +
          `<div class="ink-chart__tip-total"><span class="ink-chart__tip-name">Total</span>` +
          `<span class="ink-chart__tip-val">${fmt(total)}</span></div>`
        );
      }}
      ariaLabel="Monthly expenses by category, stacked."
    />
  );
}
