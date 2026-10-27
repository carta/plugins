import { fundNameOnly } from "../../ui/components.jsx";
import { isBenchmarkable } from "../../model/benchmarks.js";
import { reportsSectionId } from "../reports/sections.js";
import { Rail } from "../CohortStanding.jsx";
import { WidgetCard, WidgetStat, widgetFundName, SUBTLE } from "./WidgetCard.jsx";

const SHOWN = 3; // rails drawn; the Benchmarks report has every fund

// A fund below the lowest published mark has no rank, so it sorts as 0.
const pctlOf = (f) => (f.percentile.below ? 0 : f.percentile.pctl);

/** Peer benchmarks — where each fund's TVPI sits in its Carta vintage cohort (the fund
 *  state's `percentile`, the same interpolation the Benchmarks report uses): the three
 *  highest-ranked funds on the report's percentile rail, drawn compact; "View →" has
 *  the rest. Funds that haven't called capital or closed a NAV month, or whose cohort
 *  has no mark above zero, aren't ranked; with none ranked the card says so. */
export default function BenchmarksWidget({ fundStates, firmName, onNavigate, span }) {
  const all = fundStates.filter((f) => isBenchmarkable(f) && f.percentile);
  const top = [...all].sort((a, b) => pctlOf(b) - pctlOf(a)).slice(0, SHOWN);
  return (
    <WidgetCard title="Peer benchmarks" span={span} view={{ tab: "reports", name: "Benchmarks", section: reportsSectionId("benchmarks") }} onNavigate={onNavigate} testId="ov-widget-bench">
      {all.length ? (
        <>
          <WidgetStat value="TVPI" />
          <div data-testid="ov-bench-rails" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {top.map((f) => (
              <div key={f.id} data-datum-id={f.id} data-datum-type="fund" data-datum-label={fundNameOnly(f.name)}>
                <Rail compact name={widgetFundName(f.name, firmName)} pctl={pctlOf(f)} val={f.tvpi} cohortMarks={f.cohort}
                  below={f.percentile.below} belowP={f.percentile.belowP} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div data-testid="ov-bench-empty" style={SUBTLE}>Benchmarking isn't available for these funds yet.</div>
      )}
    </WidgetCard>
  );
}
