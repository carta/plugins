// Forecast panels pinned to one company, rendered inside the Company page's Forecast tab.
// "Forecast" = the company's own reported estimates (Data Collection), not a GP mark.
import { useMemo, useState } from "react";
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { Dropdown, Segmented, Slider, SectionHeader, StatusLine } from "../ui/components.jsx";
import Chart, { fmtVal } from "../ui/charts.jsx";
import { currencySymbol, withCommas } from "../ui/format.js";
import {
  metricOf, forecastMetricsFor, pointsFor, forecastPoints, vintagesFor,
  metricsFor, numericMetrics, metricOptions,
} from "../model/kpi.js";
import { METHODS, projectSeries, bestMethod, biasAdjustedForecast } from "../model/forecast.js";
import { accuracyByCompany, accuracySummary } from "../model/accuracy.js";

const asPts = (arr) => (arr || []).map((p) => ({ d: p.d, v: p.v }));
// Default to the plain "Revenue" metric; a looser match ("Average Revenue Per User")
// is only the fallback, so the panel opens on the headline series.
const defaultMetric = (metrics) =>
  (metrics.find((m) => /^revenue$/i.test(m.label)) || metrics.find((m) => /revenue/i.test(m.label)) || metrics[0] || {}).key;
const pctWhole = (v) => withCommas(Math.abs(v * 100).toFixed(0)) + "%";
const signedPct = (v) => (v >= 0 ? "+" : "−") + pctWhole(v);
const mapeWord = (m) => (m == null ? "" : m < 0.1 ? "very accurate" : m < 0.25 ? "reasonable" : m < 0.5 ? "loose" : "unreliable");

/* ---------- Auto-forecast (project actuals with a chosen method) ---------- */
export function Auto({ data, company }) {
  // Only numeric metrics project; qualitative ones (which sort first) have no series to fit.
  const metricList = numericMetrics(metricsFor(data, company));
  const [metricKey, setMetricKey] = useState(() => defaultMetric(metricList));
  const activeKey = metricList.some((m) => m.key === metricKey) ? metricKey : (metricList[0] || {}).key;
  const [method, setMethod] = useState("holt");
  const [horizon, setHorizon] = useState(6);
  const [weight, setWeight] = useState(100);

  const metric = metricOf(data, activeKey);
  const label = metric ? metric.label : "this KPI";
  const unit = metric ? metric.unit : "Number";
  const actual = asPts(pointsFor(company, activeKey));
  const gp = asPts(forecastPoints(company, activeKey));
  const proj = useMemo(() => projectSeries(actual, method, horizon), [actual, method, horizon]);
  const best = useMemo(() => bestMethod(actual), [actual]);

  // How the company's own forecast of this KPI has scored: its graded misses, ranked
  // among the portfolio's forecasters. The bias-adjusted line falls back to the
  // portfolio's bias when this company has nothing graded yet.
  const hasOwn = gp.length > 0;
  const scored = useMemo(() => (hasOwn && activeKey ? accuracyByCompany(data, activeKey) : []), [data, activeKey, hasOwn]);
  const summary = useMemo(() => (hasOwn && activeKey ? accuracySummary(data, activeKey) : null), [data, activeKey, hasOwn]);
  const mine = scored.find((r) => r.id === company.id) || null;
  // accuracyByCompany() orders worst-first; the rank here reads most accurate first.
  const ranked = [...scored].sort((a, b) => (a.mape ?? Infinity) - (b.mape ?? Infinity));
  const rank = mine ? ranked.findIndex((r) => r.id === company.id) + 1 : null;
  const bias = mine && mine.bias != null ? mine.bias : (summary && summary.bias != null ? summary.bias : null);
  const biasSource = mine && mine.bias != null ? "this company" : "the portfolio";
  const adjusted = hasOwn && bias != null ? asPts(biasAdjustedForecast(gp, bias, weight / 100)) : [];
  const factor = bias == null ? null : 1 / (1 + (weight / 100) * bias);

  const series = [
    { key: "actual", label: "Actual", points: actual },
    ...(hasOwn ? [{ key: "gp", label: "Company forecast", points: gp, dashed: true }] : []),
    ...(adjusted.length ? [{ key: "adj", label: "Bias-adjusted forecast", points: adjusted, dash: "2 3" }] : []),
    ...(proj ? [{ key: "auto", label: `Auto-forecast · ${METHODS.find((m) => m.id === method).label}`, points: proj.line, dash: "2 3" }] : []),
  ];
  // The band is the uncertainty around the auto-forecast line, so it tracks that
  // series' color through the chart's palette rather than pinning a fixed hex.
  const bands = proj ? [{ lo: proj.band.lo, hi: proj.band.hi, seriesIndex: series.length - 1 }] : [];
  const next = proj && proj.line.length > 1 ? proj.line[1] : null;

  const accuracyItems = !hasOwn ? [] : mine ? [
    { text: `Typical error (MAPE) ${pctWhole(mine.mape)} · ${mapeWord(mine.mape)}`,
      hint: "Mean absolute percentage error of the company's past forecasts against the actuals that landed." },
    { text: `Bias ${signedPct(mine.bias)} · ${mine.bias >= 0 ? "over" : "under"}-forecasts`,
      hint: "The average direction of past misses. Positive means the company habitually forecasts too high." },
    { text: `${mine.n} forecast${mine.n === 1 ? "" : "s"} scored` },
    rank ? { text: `Rank ${rank} of ${scored.length} on ${label}`, hint: "Among the portfolio's forecasters of this KPI, most accurate first." } : null,
    factor != null ? { text: `Bias-adjusted line ×${factor.toFixed(2)} at ${withCommas(weight)}% weight` } : null,
  ] : [
    { text: `${label} forecast not yet scoreable — no forecast period has reported.` },
    factor != null ? { text: `Bias-adjusted line uses the portfolio's bias (${signedPct(bias)}) · ×${factor.toFixed(2)} at ${withCommas(weight)}% weight` } : null,
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      {/* Explainer + the control rows it describes are one group. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.55, margin: 0, maxWidth: 920 }}>
        Your <em>own</em> forecast, built from the company's reported history rather than from what they told you. Pick a
        projection method and how far out to run it. The <strong>shaded band</strong> is the uncertainty range: the model is
        re-run against history to see how far off it would have been, and the band is one standard deviation of that error —
        it widens further out because forecasts get less certain with distance.
        {best && <> Best fit on recent history: <button onClick={() => setMethod(best.id)} style={linkBtn}>{best.label}</button> — missed by {withCommas((best.mape * 100).toFixed(0))}% on average when backtested.</>}
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Dropdown options={metricOptions(metricList)} value={activeKey} onChange={setMetricKey} triggerLabel="KPI" minWidth={200} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Segmented options={METHODS.map((m) => ({ id: m.id, label: m.label }))} value={method} onChange={setMethod} />
        <Segmented options={[{ id: 4, label: "4q" }, { id: 6, label: "6q" }, { id: 8, label: "8q" }]} value={horizon} onChange={setHorizon} />
      </div>
      {bias != null && (
        <div style={{ maxWidth: 360 }}>
          <Slider label="Bias weight" value={weight} min={0} max={100} step={5} onChange={setWeight} fmt={(v) => withCommas(v) + "%"}
            hint="How much of the company's historical forecast bias to strip out of its current forecast. 0% shows the forecast as logged; 100% removes the full average past miss. The bias comes from the graded forecasts scored under the chart." />
        </div>
      )}
      </section>
      {!proj ? (
        <Empty>Not enough actual history to forecast this KPI (need ≥ 3 periods).</Empty>
      ) : (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card" style={{ padding: 18 }}>
            <Chart chartId="forecast-projection" type="line" unit={unit} height={320} series={series} bands={bands}
              title={`${company.name} — ${label}: history and auto-forecast`}
              subtitle={`${METHODS.find((m) => m.id === method).label} · ${horizon} quarters ahead · shaded band = ±1 std dev of backtest error${adjusted.length ? ` · bias-adjusted at ${withCommas(weight)}% (${signedPct(bias)} from ${biasSource})` : ""}`} />
          </div>
          {next && (
            <div style={{ ...mono, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
              Next projected period <strong style={{ color: "var(--ink-color-global-text-default)" }}>{next.d}</strong>:
              <strong style={{ color: "var(--ink-color-global-text-default)" }}> {fmtVal(next.v, unit)}</strong>
              {proj.sigma ? <> (±{fmtVal(proj.sigma, unit)})</> : null}
              {hasOwn ? <>  ·  Company's own forecast for that period: {fmtVal((gp.find((p) => p.d === next.d) || {}).v, unit)}</> : null}
            </div>
          )}
          {accuracyItems.length > 0 && <StatusLine items={accuracyItems} style={{ marginBottom: 0 }} />}
        </section>
      )}
    </div>
  );
}

const fmtPeriod = (d) => { const m = /^(\d{4})-(\d{2})/.exec(String(d)); return m ? `${m[2]}/${m[1]}` : String(d); };
const fmtAsOf = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d)); return m ? `${m[2]}/${m[3]}/${m[1]}` : String(d); };
function fmtNum(val, unit, cur) {
  if (val == null || !Number.isFinite(val)) return "";
  if (unit === "Percentage" || unit === "Percent") return withCommas((val * 100).toFixed(1)) + "%";
  if (unit === "Ratio") return val.toFixed(2) + "×";
  return (val < 0 ? "−" : "") + (unit === "Dollar" ? currencySymbol(cur) : "") + Math.abs(val).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Forecast vintages for one KPI. Standalone it carries its own KPI picker; given
 *  `metricKey` it follows the caller's selection (the Actuals vs forecast chart's). */
export function Revisions({ data, company, metricKey }) {
  const metricsForCo = forecastMetricsFor(data, company);
  const embedded = metricKey != null;
  const [ownKey, setOwnKey] = useState(() => (metricsForCo[0] || {}).key);
  const chosen = embedded ? metricKey : ownKey;
  const activeKey = metricsForCo.some((m) => m.key === chosen) ? chosen : (metricsForCo[0] || {}).key;

  const metric = metricOf(data, activeKey);
  const unit = metric ? metric.unit : "Number";
  const vintages = vintagesFor(company, activeKey);
  const actual = pointsFor(company, activeKey);

  // columns = sorted union of every period seen across vintages + actuals
  const { periods, rows, actualByP } = useMemo(() => {
    const set = new Set();
    vintages.forEach((v) => v.points.forEach((p) => set.add(p.d)));
    actual.forEach((p) => set.add(p.d));
    const periods = [...set].sort();
    const rows = [...vintages].sort((a, b) => a.asOf.localeCompare(b.asOf))
      .map((v) => ({ asOf: v.asOf, byP: new Map(v.points.map((p) => [p.d, p.v])) }));
    const actualByP = new Map(actual.map((p) => [p.d, p.v]));
    return { periods, rows, actualByP };
  }, [vintages, actual]);
  // One company + metric → one currency across the whole matrix.
  const cur = useMemo(() => {
    for (const p of actual) if (p.cur) return p.cur;
    for (const v of vintages) for (const p of v.points) if (p.cur) return p.cur;
    return undefined;
  }, [actual, vintages]);

  const TINT = "var(--accent-soft)";
  const cell = { padding: "9px 14px", textAlign: "right", whiteSpace: "nowrap", borderBottom: `1px solid var(--ink-color-global-border-subtle)`, ...mono };
  const stick = { position: "sticky", left: 0, zIndex: 1, background: "var(--ink-color-global-surface-background-default)", textAlign: "left", ...sans, fontWeight: 600, minWidth: 170 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: embedded ? 8 : 36 }}>
      {embedded ? <SectionHeader>Forecast revisions</SectionHeader> : (
        /* Explainer + the metric picker it describes are one group. */
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>
          Every time a company logs a forecast, the old one is kept. Each row here is one of those{" "}
          <em>vintages</em> — the estimate exactly as it stood on that date — and the highlighted cells are the future periods
          it covered. The bottom row is what actually happened. <strong>Read down a column</strong> to see how the estimate for
          a single quarter drifted as that quarter approached: a number quietly walking downward is a company managing
          expectations, and a late jump toward the actual is a forecast being back-fitted rather than predicted.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Dropdown options={metricOptions(metricsForCo)} value={activeKey} onChange={setOwnKey} triggerLabel="KPI" minWidth={200} />
        </div>
        </section>
      )}
      {vintages.length === 0 ? (
        <Empty>No forecast history for this selection.</Empty>
      ) : (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: 0, overflow: "auto" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: FS.small }}>
              <thead>
                <tr>
                  <th style={{ ...stick, zIndex: 3, top: 0, background: "var(--ink-color-global-surface-background-default)", padding: "9px 14px", fontSize: 14, color: "var(--ink-color-global-text-default)", fontWeight: 500, borderBottom: `1px solid var(--ink-color-global-border-default)` }}>Reporting period</th>
                  {periods.map((p) => (
                    <th key={p} style={{ ...sans, position: "sticky", top: 0, zIndex: 2, background: "var(--ink-color-global-surface-background-default)", padding: "9px 14px", textAlign: "right", fontSize: 14, color: "var(--ink-color-global-text-default)", fontWeight: 500, borderBottom: `1px solid var(--ink-color-global-border-default)`, whiteSpace: "nowrap" }}>{fmtPeriod(p)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.asOf}>
                    <td style={{ ...stick, padding: "9px 14px", borderBottom: `1px solid var(--ink-color-global-border-subtle)`, color: "var(--ink-color-global-text-default)" }}>As of {fmtAsOf(r.asOf)}</td>
                    {periods.map((p) => {
                      const v = r.byP.get(p);
                      return <td key={p} style={{ ...cell, background: v != null ? TINT : undefined, color: "var(--ink-color-global-text-default)" }}>{fmtNum(v, unit, cur)}</td>;
                    })}
                  </tr>
                ))}
                <tr>
                  <td style={{ ...stick, padding: "9px 14px", borderTop: `2px solid var(--ink-color-global-border-default)`, borderBottom: "none" }}>Actuals</td>
                  {periods.map((p) => (
                    <td key={p} style={{ ...cell, borderTop: `2px solid var(--ink-color-global-border-default)`, borderBottom: "none", fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{fmtNum(actualByP.get(p), unit, cur)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ ...sans, fontSize: FS.small, color: MICRO }}>
            {rows.length} forecast vintage{rows.length === 1 ? "" : "s"} on record. Highlighted cells are the periods each vintage forecast.
            {embedded && <> Each row is the estimate as it stood on that date; the bottom row is what happened. Read down a column to see how the estimate for one quarter drifted as it approached.</>}
          </div>
        </section>
      )}
    </div>
  );
}

const linkBtn = { border: "none", background: "transparent", color: "var(--ink-color-global-link-default)", cursor: "pointer", fontSize: "inherit", padding: 0, fontWeight: 600, fontFamily: "inherit" };
const Empty = ({ children }) => (
  <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--ink-color-global-text-subtle)", ...sans }}>{children}</div>
);
