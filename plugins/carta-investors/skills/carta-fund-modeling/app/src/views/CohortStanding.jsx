// Cohort Standing — every fund shows all three multiples (TVPI, DPI, Gross
// MOIC) at once, each on its own compact percentile bar with the cohort's
// p50/p75/p90/p95 marks printed under their ticks. A stat strip under the
// fund name carries Net TVPI + Net IRR (primary) — DPI/RVPI/Distributed/
// S&P-equivalent (secondary) used to live here too; removed for quick
// side-by-side scanning — no click-to-expand, no metric toggle. LV predates
// Carta's cohorts (dashed estimate); a pre-deployment fund shows a quiet
// empty row.
import { FS, sans, inkNum, MICRO } from "../ui/theme.js";
import { fmtM, fmtX, fmtPct } from "../ui/format.js";
import { H1, H3, MethodNote, SourceNote, fundNameOnly, Eyebrow, StatTile } from "../ui/components.jsx";
import { cohortPercentile } from "../model/benchmarks.js";

const TICKS = [50, 75, 90, 95];
const METRICS = [{ id: "tvpi", label: "TVPI" }, { id: "dpi", label: "DPI" }, { id: "moic", label: "Gross MOIC" }];

const RAIL_H = 52;

/** One metric's compact percentile bar — a flat meter, not a slider: quiet
 *  track, hairline cohort ticks, a filled bar to the fund's percentile, and a
 *  flush flat marker (no circular thumb, no drop shadow — nothing that reads
 *  as draggable) at the fund's own position, labeled with the fund's own
 *  standing right above it. Each cohort mark's percentile key prints ABOVE
 *  its value, larger and darker, since the percentile is the point of the
 *  bar and the raw multiple is supporting detail. Fill and marker are green
 *  above the p50 median, red below it. */
function Rail({ pctl, val, cohortMarks, estimated, below, belowP, noValueLabel }) {
  // cohortMarks carries p5/p10/p25/p50/p75/p90/p95 (whatever Carta published),
  // so pctl is a real interpolated rank for almost every fund, plotted at its
  // actual position on the 0-100 scale below just like above. Only a fund
  // under the lowest published mark (usually p5) has no data point to
  // interpolate against — that case is flagged `below`, pinned flush-left, and
  // labeled "below pN" instead of a fabricated number, matching how fund
  // benchmarking providers (Cambridge Associates, PitchBook, Preqin) report a
  // bucket instead of a precise rank once actual peer data runs out.
  //
  // A literal 0 (e.g. DPI for a fund that hasn't distributed) ties with a
  // cohort mark that's also 0, which the interpolation resolves to a real
  // rank (e.g. p50) — mathematically correct (half the cohort is also at 0,
  // so the fund is AT LEAST at that rank), but printing a precise "(p50)"
  // next to an unfilled bar reads as contradictory ("why isn't this filled if
  // it's at the median?"). Since ties mean the fund's true rank could be
  // anywhere within the tied group, not exactly that point, label it as a
  // bucket ("≤p50") the same way the `below` case avoids a fabricated precise
  // rank — consistent phrasing, and it reads correctly next to the empty bar.
  const atZero = val === 0;
  const pinLeft = below || atZero;
  const x = val == null ? 0 : pinLeft ? 0 : Math.min(98, Math.max(2, pctl));
  // The flush position marker stays centered on its exact x (it IS the point
  // on the scale). The text label is centered on that same x by default, but
  // clamped to the RAIL'S bounding-box edge (0%/100%) — not to the mark's own
  // x — whenever centering would overhang: pinned flush-left at the box's
  // left edge near 0%, flush-right at the box's right edge near 100%.
  const markerTransform = pinLeft ? "none" : "translateX(-50%)";
  const labelPos =
    x <= 15 ? { left: 0, transform: "none" }
    : x >= 85 ? { left: "auto", right: 0, transform: "none" }
    : { left: `${x}%`, transform: "translateX(-50%)" };
  const fill = below || atZero
    ? "var(--ink-color-global-feedback-negative-strong)"
    : pctl >= 50 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)";
  return (
    <div style={{ position: "relative", height: RAIL_H }}>
      {val != null ? (
        <div style={{ position: "absolute", top: 0, ...labelPos,
          ...sans, fontSize: FS.micro, fontWeight: 700, color: fill, whiteSpace: "nowrap" }}>
          {val.toFixed(2)}× {below ? `(below p${belowP})` : atZero ? `(≤p${Math.round(pctl)})` : `(p${Math.round(pctl)})`}
        </div>
      ) : noValueLabel ? (
        // The fund's own value isn't recorded, but Carta HAS published a real
        // cohort for this metric — still show the cohort ticks below (so a
        // user who knows their own number by heart can eyeball where it'd
        // land) with a plain unfilled/grey track instead of a colored fill,
        // since there's no fund position to plot.
        <div style={{ position: "absolute", top: 0, left: 0, ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>
          {noValueLabel}
        </div>
      ) : null}
      <div style={{ position: "absolute", top: 20, left: 0, right: 0, height: 3, borderRadius: 2, background: "var(--ink-color-global-border-subtle)" }} />
      {TICKS.map((t) => (
        <div key={t} style={{ position: "absolute", top: 16, left: `${t}%`, width: 1, height: 8, background: MICRO }} />
      ))}
      {val != null && (
        <>
          <div data-testid="fill-bar" style={{ position: "absolute", top: 20, left: 0, width: `${x}%`, height: 3, borderRadius: 2, transition: "width .25s ease, background .15s ease",
            background: estimated
              ? `repeating-linear-gradient(90deg, ${fill} 0 7px, transparent 7px 12px)`
              : fill }} />
          <div style={{ position: "absolute", top: 14.5, left: `${x}%`, transform: markerTransform, transition: "left .25s ease, background .15s ease",
            width: 3, height: 13, borderRadius: 1, background: fill }} />
        </>
      )}
      {TICKS.map((t) => {
        // p95's tick line still renders (above), but its label is hidden —
        // matches the original single-rail version, which only ever labeled
        // up through p90.
        if (t === 95) return null;
        const v = cohortMarks?.[`p${t}`];
        if (v == null) return null;
        return (
          <div key={t} style={{ position: "absolute", top: 28, left: `${t}%`, transform: "translateX(-50%)", textAlign: "center" }}>
            <div style={{ ...sans, fontSize: FS.micro, fontWeight: 700, color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap" }}>p{t}</div>
            <div style={{ ...inkNum, fontSize: FS.micro, color: MICRO, whiteSpace: "nowrap" }}>{v.toFixed(2)}×</div>
          </div>
        );
      })}
    </div>
  );
}

/** Short, metric-and-reason-specific replacement for the old flat "no cohort"
 *  label. DPI is the metric most often uncohorted because it requires
 *  realized distributions — many peer funds in younger vintages haven't
 *  distributed anything yet, which is a different (and more explainable)
 *  situation than a fund's own value simply never being recorded. */
const NO_COHORT_TEXT = {
  dpi: { degenerate_cohort: "Not enough data in cohort", no_value: "No DPI recorded" },
  tvpi: { degenerate_cohort: "Not enough data in cohort", no_value: "No value recorded" },
  moic: { degenerate_cohort: "Not enough data in cohort", no_value: "No value recorded" },
};

/** One metric's caption + bar, or a quiet placeholder when Carta hasn't
 *  published a cohort for this fund on this specific metric. */
function MiniRail({ metricId, metricLabel, state }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Eyebrow color={MICRO} style={{ fontSize: FS.micro, fontWeight: 650, letterSpacing: ".04em", marginBottom: 2 }}>{metricLabel}</Eyebrow>
      {state.kind === "benchmarked" ? (
        <Rail pctl={state.pctl} val={state.val} cohortMarks={state.cohortMarks} estimated={false} below={state.below} belowP={state.belowP} />
      ) : state.kind === "no_value" ? (
        // Cohort ticks are real (Carta published this metric's cohort) — only
        // the fund's own value is missing, so show the ticks with the reason
        // text in place of a fund marker, not the fully-empty placeholder.
        <Rail val={null} cohortMarks={state.cohortMarks} noValueLabel={NO_COHORT_TEXT[metricId]?.no_value ?? "No value recorded"} />
      ) : (
        <div style={{ position: "relative", height: RAIL_H }}>
          {/* Above the line, same position as the "no_value" case's noValueLabel
              (top: 0) — so the reason text always reads in the same spot
              regardless of which "no cohort" variant is showing. */}
          <span style={{ position: "absolute", top: 0, left: 0, ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)" }}>
            {NO_COHORT_TEXT[metricId]?.[state.reason] ?? "No cohort"}
          </span>
          <div style={{ position: "absolute", top: 20, left: 0, right: 0, height: 3, borderRadius: 2, background: "var(--ink-color-global-border-subtle)" }} />
        </div>
      )}
    </div>
  );
}

/** Stat strip under the fund name: just the two primary headline figures —
 *  Net TVPI and Net IRR. (DPI/RVPI/Distributed/S&P-equivalent/IRR-vs-cohort
 *  used to live here as secondary detail; removed to keep this strip to
 *  the two numbers that matter most at a glance.) */
function StatStrip({ f }) {
  return (
    <div style={{ display: "flex", gap: 20 }}>
      <StatTile value={fmtX(f.tvpi)} label="Net TVPI" labelPos="bottom" size="h3" serif labelTone="muted" />
      <StatTile value={f.netLpIrr == null ? "—" : fmtPct(f.netLpIrr)} label="Net IRR" labelPos="bottom" size="h3" serif labelTone="muted" />
    </div>
  );
}

export default function CohortStanding({ snapshot, fundStates }) {
  // the fund's value for each metric — all three reprice with the scenario
  // (gross MOIC is the fund-total gross-of-carry multiple, repriced in fundStates);
  // the cohort percentile marks stay at Carta's published peer values.
  const metricVal = (f, id) => (id === "tvpi" ? f.tvpi : id === "dpi" ? f.dpi : f.grossMoic);

  // Sorted oldest vintage first (funds with no vintage recorded sort last).
  // Each fund evaluates ALL THREE metrics independently — a fund can be
  // benchmarked on TVPI but uncohorted on DPI, so this is a map, not one value.
  const rows = fundStates.map((f) => {
    if (f.lpPaidIn === 0) return { f, kind: "deploying", metrics: null };
    const metrics = {};
    for (const m of METRICS) {
      const cohortMarks = snapshot.benchmarks[f.id]?.[m.id];
      // A cohort is usable as soon as ANY published mark is nonzero — even if
      // the median (p50) is 0 (common for DPI mid-J-curve, where the bottom
      // half of the cohort hasn't distributed yet), a nonzero p75/p90/p95
      // still gives a real spread to place this fund against. Only a cohort
      // where EVERY published mark is 0/absent is truly degenerate (no spread
      // to compare against at all).
      const hasMarks = cohortMarks && ["p5", "p10", "p25", "p50", "p75", "p90", "p95"].some((k) => (cohortMarks[k] ?? 0) > 0);
      const val = metricVal(f, m.id);
      if (!hasMarks) {
        metrics[m.id] = { kind: "uncohorted", val, cohortMarks: null, reason: "degenerate_cohort" };
        continue;
      }
      if (val == null) {
        // Cohort IS real — only the fund's own value is missing. Keep the
        // cohort marks so MiniRail can still show the ticks (see "no_value" kind).
        metrics[m.id] = { kind: "no_value", val: null, cohortMarks, reason: "no_value" };
        continue;
      }
      // cohortMarks carries p5/p10/p25/p50/p75/p90/p95 (whatever Carta published),
      // so cohortPercentile interpolates a real rank for almost every fund — only
      // a fund below the very lowest published mark (usually p5) has no data
      // point to interpolate against.
      const pc = cohortPercentile(val, cohortMarks);
      const below = pc?.below === true;
      const belowP = pc?.belowP ?? 50;
      const pctl = pc?.pctl ?? 0; // sentinel when below — never a real rank
      metrics[m.id] = { kind: "benchmarked", pctl, val, cohortMarks, below, belowP };
    }
    // "no_value" still counts as cohort coverage for this row-level classification
    // (Carta published a real cohort; only this fund's own value is missing) —
    // only "uncohorted" (no usable cohort at all) should hide/gray the row.
    const anyBenched = METRICS.some((m) => metrics[m.id].kind !== "uncohorted");
    return { f, kind: anyBenched ? "benchmarked" : "uncohorted", metrics };
  }).sort((a, b) => (a.f.vintage ?? Infinity) - (b.f.vintage ?? Infinity));

  // No published Carta cohort for ANY fund on ANY metric (no vintage/size/entity-type
  // peer set in TEMPORAL_FUND_COHORT_BENCHMARKS) — show a single honest empty state
  // rather than fabricating a rail. Data-driven: fires whenever snapshot.benchmarks is bare.
  const anyBenchmarked = rows.some((r) => r.kind === "benchmarked");
  if (!anyBenchmarked) {
    // Explain *why* the rail is empty, keyed off the builder's coverage classification
    // (snapshot.benchmarksMeta.reason). "no_cohort_file" = benchmarks weren't loaded
    // (not fetched, or the fund role can't read the table); otherwise the funds are
    // present but Carta has published no peer cohort for their vintage/size yet.
    const firm = snapshot.source?.firm || "this firm";
    const emptyBody =
      snapshot.benchmarksMeta?.reason === "no_cohort_file"
        ? `Cohort benchmarks weren't loaded for ${firm}. This is usually a data-access limitation — the fund's role may not have read access to TEMPORAL_FUND_COHORT_BENCHMARKS. It is not a firm-context narrowing issue (the cohort table is pre-aggregated across firms).`
        : `Carta has not published peer cohort benchmarks for ${firm}'s funds (no vintage / AUM / entity-type cohort in TEMPORAL_FUND_COHORT_BENCHMARKS across their recent quarters). When cohort data becomes available it will appear here automatically.`;
    return (
      <div>
        <H1>Benchmarks</H1>
        <div className="card" style={{ padding: "52px 24px", textAlign: "center" }}>
          <H3 as="div" style={{ marginBottom: 8 }}>
            Benchmarking is not available currently.
          </H3>
          <div style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-text-subtle)", maxWidth: 540, margin: "0 auto", lineHeight: 1.5 }}>
            {emptyBody}
          </div>
        </div>
        <SourceNote style={{ fontSize: FS.small, marginTop: 14 }}>
          Source: Carta TEMPORAL_FUND_COHORT_BENCHMARKS — bars render only when a fund's vintage/size
          cohort has published marks.
        </SourceNote>
      </div>
    );
  }

  // Hide funds with no published Carta peer cohort on ANY metric for their vintage/size
  // (the "uncohorted" rows). Still-deploying funds stay — they'll get a cohort once
  // they call capital. Driven off the row classification above.
  const visibleRows = rows.filter((r) => r.kind !== "uncohorted");
  const hiddenUncohorted = rows.length - visibleRows.length;

  return (
    <div>
      <H1>Benchmarks</H1>
      <MethodNote>
        Every fund shows TVPI, DPI, and Gross MOIC on its own compact percentile bar against Carta's same-vintage
        venture cohorts — the only scale that compares across vintages. Net TVPI and Net IRR are shown under each fund name.
      </MethodNote>
      <div>
        <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", marginBottom: 10 }}>
          {(() => {
            const bench = rows.filter((r) => r.kind === "benchmarked" && r.metrics.tvpi.kind === "benchmarked");
            if (!bench.length)
              return "Carta has not published peer cohorts for these vintages and fund sizes on TVPI — showing each fund's multiples and IRR without a percentile bar.";
            const aboveMedian = bench.filter((r) => r.metrics.tvpi.pctl >= 50).length;
            return aboveMedian === bench.length
              ? "Every benchmarked fund sits above its cohort median on TVPI."
              : `${aboveMedian} of ${bench.length} benchmarked funds sit above their cohort median on TVPI.`;
          })()}
        </div>

        {visibleRows.map(({ f, kind, metrics }, i) => {
          return (
            <div key={f.id} style={{ borderTop: i ? `1px solid var(--ink-color-global-border-subtle)` : "none", padding: "24px 8px" }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 16px" }}>
                  {/* fundNameOnly drops fundLabel's "(vintage)" suffix — it already
                      shows in the muted line to the right ("2022 · 49 funds") */}
                  <span style={{ ...sans, fontSize: FS.value, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>
                    {fundNameOnly(f.name || f.id)}
                  </span>
                  <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginLeft: 8 }}>
                    {kind === "deploying"
                      ? `${f.vintage ?? "—"} · deploying · committed ${fmtM(f.committed)} · winds down ${snapshot.windDownYear[f.id]}`
                      : `${f.vintage ?? "—"} · ${f.cohortSize ?? "—"} funds in cohort`}
                  </span>
                </div>
                {kind !== "deploying" && <div style={{ marginTop: 8 }}><StatStrip f={f} /></div>}
              </div>
              {kind === "deploying" ? (
                <div style={{ position: "relative", height: RAIL_H }}>
                  <div style={{ position: "absolute", top: 20, left: 0, right: 0, height: 3, borderRadius: 2, background: "var(--ink-color-global-border-subtle)" }} />
                  <span style={{ position: "absolute", top: 26, left: 0, ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
                    capital not yet called — standing begins with deployment
                  </span>
                </div>
              ) : (
                <div className="bench-bars">
                  {METRICS.map((m) => (
                    <MiniRail key={m.id} metricId={m.id} metricLabel={m.label} state={metrics[m.id]} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {hiddenUncohorted > 0 && (
        <div style={{ ...sans, fontSize: FS.small, color: MICRO, marginTop: 10 }}>
          {hiddenUncohorted} fund{hiddenUncohorted === 1 ? "" : "s"} hidden — no Carta peer cohort published for their vintage on any metric.
        </div>
      )}
      <SourceNote style={{ fontSize: FS.small, marginTop: 14 }}>
        Source: Carta TEMPORAL_FUND_COHORT_BENCHMARKS. When a fund's vintage/size cohort has published marks, each bar
        interpolates the fund's percentile between them so positions compare across vintages — the value and percentile
        key are printed under each tick. Carta has not published peer cohorts for every fund, so some bars show "no
        cohort"; Net TVPI and Net IRR under the fund name are always shown regardless of cohort coverage.
      </SourceNote>
    </div>
  );
}
