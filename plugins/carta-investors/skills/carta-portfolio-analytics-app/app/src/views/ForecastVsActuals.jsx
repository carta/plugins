// Insights → Forecast vs actuals: how every company landed against its own latest forecast.
import { useMemo, useState } from "react";
import { FS, sans, MICRO } from "../ui/theme.js";
import { Dropdown, StatBar, BasisToggle, Eyebrow } from "../ui/components.jsx";
import { Heatmap, fmtVal, shortDate } from "../ui/charts.jsx";
import { metricOptions, numericMetrics, companiesWithForecast } from "../model/kpi.js";
import { portfolioVariance, lowerIsBetter, TRAILING_PERIODS, HEAT_SATURATION } from "../model/variance.js";
import { openCompany, setCompanySubtab } from "../state/focus.js";
import { trackClick } from "../analytics.js";
import { fmtGap, fmtRate, StatusBadge, STATUS_INK, th, td, linkBtn, BAND_TEXT } from "./ForecastPanels.jsx";

const nameBtn = { ...linkBtn, textAlign: "left" };

const openForecast = (id) => {
  trackClick("PortfolioAnalytics.ForecastVsActuals.OpenCompany");
  openCompany(id);
  setCompanySubtab("forecast", id, { replace: true });
};

export default function ForecastVsActuals({ data }) {
  // Only KPIs some company both forecasts and reports can be graded.
  const metrics = useMemo(() => numericMetrics(data.metrics).filter((m) => companiesWithForecast(data, m.key, true).length), [data]);
  const [metricKey, setMetricKey] = useState(() => (metrics.find((m) => /^revenue$/i.test(m.label)) || metrics[0] || {}).key);
  const activeKey = metrics.some((m) => m.key === metricKey) ? metricKey : (metrics[0] || {}).key;
  const [quarterly, setQuarterly] = useState(true);
  const [period, setPeriod] = useState(null);

  const res = useMemo(() => (activeKey ? portfolioVariance(data, activeKey, { quarterly, period }) : null), [data, activeKey, quarterly, period]);
  const metric = res?.metric;
  const label = metric ? metric.label : "this KPI";
  const unit = metric ? metric.unit : "Number";
  const kind = res?.gapKind || "pct";
  const s = res?.summary;
  const lowerBetter = lowerIsBetter(metric);
  const periodWord = quarterly ? "quarter" : "period";
  // A % KPI's variance is in points, which run far smaller than a % change, so it saturates sooner.
  const heatMax = HEAT_SATURATION[kind];

  const intro = (
    <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0, maxWidth: 920 }}>
      How each company's <strong>reported actuals</strong> landed against the <strong>latest forecast it logged</strong> for the
      same {periodWord}. Variance is (actual − forecast) ÷ forecast; within {BAND_TEXT} counts as on forecast.
      {lowerBetter ? <> For {label}, coming in <em>under</em> forecast is the good outcome.</> : null} Click a company to open its Forecast tab.
    </p>
  );
  const pickPeriod = (p) => { trackClick("PortfolioAnalytics.ForecastVsActuals.SetPeriod"); setPeriod(p); };
  const controls = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Dropdown options={metricOptions(metrics)} value={activeKey} onChange={(k) => { setMetricKey(k); setPeriod(null); }} triggerLabel="KPI" minWidth={230} />
      <BasisToggle quarterly={quarterly} onChange={(q) => { setQuarterly(q); setPeriod(null); }} />
      {res && res.periods.length > 0 && (
        <Dropdown options={[...res.periods].reverse().map((p) => ({ id: p, label: shortDate(p, quarterly) }))} value={res.period} onChange={pickPeriod} triggerLabel="Period" minWidth={150} />
      )}
    </div>
  );

  if (!res || !s || s.compared === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>{intro}{metrics.length > 0 && controls}</section>
        <div className="card" style={{ padding: 28, textAlign: "center", color: MICRO, ...sans }}>
          {metrics.length ? `No company has a ${label} forecast for a ${periodWord} that has also reported an actual.` : "No company has logged a forecast for a KPI it also reports."}
        </div>
      </div>
    );
  }

  const stats = [
    { label: "Companies compared", value: String(s.compared) },
    { label: "Ahead of forecast", value: String(s.ahead), color: STATUS_INK.ahead },
    { label: "On forecast", value: String(s.on) },
    { label: "Behind forecast", value: String(s.behind), color: STATUS_INK.behind },
    { label: "Median variance", value: fmtGap(s.medianGap, kind),
      hint: "The middle company's variance. Amounts are never added across companies, so mixed currencies stay comparable." },
  ];
  const heatRows = res.rows.filter((r) => res.cols.some((c) => r.byPeriod[c] != null))
    .map((r) => ({ id: r.id, label: r.name, cells: r.byPeriod }));
  const heatCols = res.cols.map((c) => ({ key: c, label: shortDate(c, quarterly) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>{intro}{controls}</section>

      <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <StatBar title={`${label} · ${shortDate(res.period, quarterly)}`} stats={stats} size="h3" basis={150} />
        <div className="card" style={{ padding: 18 }}>
          <Eyebrow style={{ marginBottom: 10 }}>{label} — variance vs forecast, last {heatCols.length} {periodWord}{heatCols.length === 1 ? "" : "s"}</Eyebrow>
          <Heatmap chartId="forecast-variance-heatmap" rows={heatRows} cols={heatCols} invert={lowerBetter} onRowClick={openForecast}
            valueFmt={(v) => fmtGap(v, kind)} absMax={heatMax}
            cellTip={(row, c, v) => (v == null ? `${row.label} · ${c.label}: not graded` : `${row.label} · ${c.label}: ${fmtGap(v, kind)} vs forecast`)}
            title={`${label}: variance vs forecast by company`}
            subtitle={`Green = ${lowerBetter ? "under" : "over"} forecast, red = ${lowerBetter ? "over" : "under"} · color saturates at ±${Math.round(heatMax * 100)}${kind === "pp" ? " pts" : "%"} · blank = not graded`} />
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ overflow: "auto" }}>
          <table className="ledger sheet" data-testid="portfolio-variance-table" style={{ width: "100%", ...sans }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Company</th>
                <th style={th}>Actual</th>
                <th style={th}>Forecast</th>
                <th style={th}>Variance</th>
                <th style={{ ...th, textAlign: "left" }}>Status</th>
                <th style={th} data-tip={`Share of the last ${TRAILING_PERIODS} graded ${periodWord}s (up to the selected one) at or ahead of forecast.`}>Hit rate</th>
              </tr>
            </thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.id}>
                  <td><button onClick={() => openForecast(r.id)} style={nameBtn}>{r.name}</button></td>
                  <td style={td}>{r.at ? fmtVal(r.at.actual, unit, undefined, r.at.cur) : "—"}</td>
                  <td style={td}>{r.at ? fmtVal(r.at.forecast, unit, undefined, r.at.fcCur || r.at.cur) : "—"}</td>
                  <td style={{ ...td, fontWeight: 600, color: STATUS_INK[r.at?.status] || "var(--ink-color-global-text-default)" }}>{r.at ? fmtGap(r.at.gap, kind) : "—"}</td>
                  <td>{r.at ? <StatusBadge status={r.at.status} /> : <span style={{ color: MICRO, fontSize: FS.small }}>Not reported for {shortDate(res.period, quarterly)}</span>}</td>
                  <td style={td}>{fmtRate(r.hitRate)} <span style={{ color: MICRO }}>({r.n})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...sans, fontSize: FS.small, color: MICRO }}>
          <strong>{s.compared}</strong> compan{s.compared === 1 ? "y" : "ies"} compared for {shortDate(res.period, quarterly)}. <strong>{s.ahead}</strong> ahead, <strong>{s.on}</strong> on forecast, <strong>{s.behind}</strong> behind
          {s.mismatched ? <>, <strong>{s.mismatched}</strong> not compared (forecast and actual in different currencies)</> : null}.
          {" "}Each amount is in that company's own currency. Worst variance first.
        </div>
      </section>
    </div>
  );
}
