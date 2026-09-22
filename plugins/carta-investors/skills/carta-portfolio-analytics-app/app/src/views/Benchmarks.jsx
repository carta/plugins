// Benchmarks — a metric's median + quartile spread per cohort, and where each
// company lands against its cohort median (the "sensitivity" strip plot).
import { useMemo, useState } from "react";
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { withCommas } from "../ui/format.js";
import { trackClick } from "../analytics.js";
import { Dropdown, Segmented, StatBar, Badge, ExcludedNote, Eyebrow } from "../ui/components.jsx";
import { StripPlot, fmtVal } from "../ui/charts.jsx";
import { metricOf, metricOptions, numericMetrics } from "../model/kpi.js";
import { benchmark, GROUP_BYS } from "../model/benchmark.js";
import { openCompany } from "../state/focus.js";

const POS = "var(--ink-color-global-feedback-positive-strong)";
const NEG = "var(--ink-color-global-feedback-negative-strong)";
const nameBtn = { ...sans, border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: "inherit", color: "var(--ink-color-global-link-default)", textAlign: "left" };
const pct = (g) => (g == null ? "N/A" : (g >= 0 ? "+" : "−") + withCommas(Math.abs(g * 100).toFixed(0)) + "%");
const QUARTILE_TONE = { 1: "negative", 2: "muted", 3: "info", 4: "positive" };
// Which group-by needs which datum — drives the excluded-companies note.
const NO_GROUP_REASON = {
  stage: "no known round stage (needs latest-financing-round data)",
  vintage: "no recorded investment date (needs cap-table / returns data)",
  valuation: "no post-money valuation on record",
};

const STRIP_ID = "benchmarks-strip";

export default function Benchmarks({ data }) {
  const metrics = numericMetrics(data.metrics);
  const [metricKey, setMetricKey] = useState(() => (metrics.find((m) => /^revenue$/i.test(m.label)) || metrics[0] || {}).key);
  const [groupBy, setGroupBy] = useState("portfolio");
  const metric = metricOf(data, metricKey);
  const label = metric ? metric.label : "this KPI";

  const bench = useMemo(() => benchmark(data, metricKey, { groupBy }), [data, metricKey, groupBy]);
  const { unit, cur, overall, lanes, excluded } = bench;
  const grouped = groupBy !== "portfolio";

  // StripPlot reads p.label; the model returns p.name.
  const stripLanes = useMemo(() => lanes.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p, label: p.name })) })), [lanes]);

  const fmt = (v) => fmtVal(v, unit, undefined, cur);
  // Quartiles on a handful of companies are noise — only show them once the
  // whole population is big enough to bucket meaningfully.
  const showQuartiles = overall.n >= 4;
  const stats = [
    { label: "Reporters", value: String(overall.n) },
    { label: "Median", value: fmt(overall.median) },
    { label: "P25", value: showQuartiles ? fmt(overall.p25) : "—" },
    { label: "P75", value: showQuartiles ? fmt(overall.p75) : "—" },
    { label: "IQR spread", value: showQuartiles && overall.p75 != null && overall.p25 != null ? fmt(overall.p75 - overall.p25) : "—" },
    { label: "Range", value: overall.n ? `${fmt(overall.min)} – ${fmt(overall.max)}` : "—" },
  ];

  const metricOpts = metricOptions(metrics);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      {/* the intro prose explains the page heading (rendered by the parent view) and
          the control row drives everything below — one tight group. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0, maxWidth: 920 }}>
          The portfolio benchmark for a KPI — the <strong>median</strong> and quartile spread — and <strong>where each
          company lands</strong> against it. Switch the cohort to benchmark within round stage, vintage year, or
          valuation band. Each dot is a company (green above the cohort median, red below); click one to open it.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Dropdown options={metricOpts} value={metricKey} onChange={setMetricKey} triggerLabel="KPI" minWidth={230} />
          <Segmented options={GROUP_BYS} value={groupBy} onChange={(g) => { trackClick("PortfolioAnalytics.Benchmarks.SetGroupBy"); setGroupBy(g); }} />
        </div>
      </section>

      {overall.n === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center", color: MICRO, ...sans }}>No companies report {label}.</div>
      ) : (
        <>
          {/* the summary stats and the distribution they summarize read as one
              overview block, so they stay 20px apart rather than 36. */}
          <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <StatBar title={`${label} · ${grouped ? "whole portfolio" : "all reporters"}`} stats={stats} size="h3" basis={150} />

            <div className="card" style={{ padding: 18 }}>
              <Eyebrow style={{ marginBottom: 10 }}>
                {label} — company distribution{grouped ? ` by ${GROUP_BYS.find((g) => g.id === groupBy).label.toLowerCase()}` : ""}
              </Eyebrow>
              <StripPlot chartId={STRIP_ID} lanes={stripLanes} unit={unit} cur={cur} onPointClick={openCompany} showTitle={false}
                title={`${label} distribution`} subtitle={`Shaded band = middle 50% (P25–P75), line = median · ${overall.n} companies`} />
            </div>
          </section>

          <div style={{ overflow: "auto" }}>
            <table className="ledger sheet" style={{ width: "100%", borderCollapse: "collapse", ...sans }}>
              <thead>
                <tr style={{ textAlign: "left", color: MICRO, fontSize: FS.small }}>
                  <th style={{ padding: "10px 14px" }}>Company</th>
                  {grouped && <th style={{ padding: "10px 14px" }}>Cohort</th>}
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>{label}</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>vs median</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Percentile</th>
                  <th style={{ padding: "10px 14px", textAlign: "right" }}>Quartile</th>
                </tr>
              </thead>
              <tbody>
                {lanes.flatMap((lane) => lane.points.map((p) => (
                  <tr key={p.id} style={{ borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600 }}><button onClick={() => openCompany(p.id)} style={nameBtn}>{p.name}</button></td>
                    {grouped && <td style={{ padding: "10px 14px", color: MICRO }}>{lane.label}</td>}
                    <td style={{ padding: "10px 14px", textAlign: "right", ...mono, fontWeight: 600 }}>{fmtVal(p.value, unit, undefined, p.cur || cur)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", ...mono, fontWeight: 700, color: p.vsMedian == null ? MICRO : p.vsMedian >= 0 ? POS : NEG }}>{pct(p.vsMedian)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", ...mono, color: MICRO }}>{p.percentile == null ? "—" : withCommas(Math.round(p.percentile * 100)) + "%"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>{p.quartile ? <Badge tone={QUARTILE_TONE[p.quartile]}>Q{p.quartile}</Badge> : <span style={{ color: MICRO }}>—</span>}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* the two coverage notes are one footnote block — 36px between them would
          read as two unrelated sections. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ExcludedNote names={excluded.noMetric} reason={`no ${label} reported`} />
        {grouped && <ExcludedNote names={excluded.noGroup} reason={`report ${label} but have ${NO_GROUP_REASON[groupBy]}`} />}
      </section>
    </div>
  );
}
