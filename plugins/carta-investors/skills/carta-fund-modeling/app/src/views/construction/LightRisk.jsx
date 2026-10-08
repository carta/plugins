import { useMemo, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Dropdown } from "../../ui/components.jsx";
import { lightOdds, peerCohorts, peerThresholds, planRecord, trackRecord, RECORD_BUCKETS } from "../../model/construction/riskMarket.js";
import { SensitivityGrid } from "./ResultsStep.jsx";
import { Pairs } from "./FaqCharts.jsx";

const subtle = "var(--ink-color-global-text-subtle)";
const pct = (v) => (v == null ? "—" : v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);

function TrackRecordCard({ plan, record }) {
  const mine = useMemo(() => planRecord(plan), [plan]);
  if (!record) return null;
  const rows = RECORD_BUCKETS.map((b) => ({ label: b.label, plan: mine[b.id], market: record.shares[b.id], planText: pct(mine[b.id]), marketText: pct(record.shares[b.id]) }));
  const failedPlan = mine.loss, failedPast = record.shares.loss;
  const topPlan = mine.top, topPast = record.shares.top;
  return (
    <div className="card" data-testid="track-record" style={{ padding: "14px 18px", marginBottom: 16 }}>
      <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, marginBottom: 6 }}>Versus your track record</div>
      <div data-testid="track-record-text" style={{ ...sans, fontSize: FS.bodyLg, lineHeight: 1.55, marginBottom: 12, maxWidth: "80ch" }}>
        The plan has {pct(failedPlan)} of companies returning under 0.25× and {pct(topPlan)} at 15× or more. Across the {record.n} companies in your funds so far, {pct(failedPast)} are marked under 0.25× and {pct(topPast)} at 15× or more.
        {" "}{failedPlan > failedPast + 0.1 ? "The plan assumes more failures than you've had so far." : failedPlan < failedPast - 0.1 ? "The plan assumes fewer failures than you've had so far." : "Failures are close to what you've seen."}
        {" "}{topPlan > topPast + 0.02 ? "It also expects more big winners than your funds have produced." : topPlan < topPast - 0.02 ? "It expects fewer big winners than your funds have produced." : ""}
      </div>
      <Pairs chart={{ kind: "pairs", planLabel: "This plan", marketLabel: "Your funds so far", rows }} />
      <div style={{ ...sans, fontSize: FS.micro, color: subtle, marginTop: 4 }}>
        Source: your portfolio's current values plus proceeds, over cost. Many are unrealized and the funds are young, so the record will still move.
      </div>
    </div>
  );
}

export default function LightRisk({ plan, snapshot, companies }) {
  const odds = useMemo(() => lightOdds(plan), [plan]);
  const cohorts = useMemo(() => peerCohorts(snapshot), [snapshot]);
  const [vintage, setVintage] = useState(null);
  const record = useMemo(() => trackRecord(companies, snapshot), [companies, snapshot]);
  const cohort = cohorts.find((c) => c.vintage === vintage) ?? cohorts[0] ?? null;
  const usd = plan.general.currency === "USD";
  const risk = useMemo(() => ({
    odds,
    peers: cohort ? {
      label: `${cohort.vintage}-vintage`,
      thresholds: Object.fromEntries(["tvpi", "netIrr", "grossMoic"].map((k) => [k, peerThresholds(cohort, k)]).filter(([, v]) => v)),
    } : null,
    spRate: usd ? snapshot?.marketRefs?.spLongRun ?? null : null,
  }), [odds, cohort, usd, snapshot]);
  return (
    <div data-testid="light-risk">
      <SensitivityGrid plan={plan} compact risk={odds ? risk : null} />
      {cohorts.length > 1 && risk.peers && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "-4px 0 16px" }}>
          <span style={{ ...sans, fontSize: FS.small, color: subtle }}>Compare peers from</span>
          <Dropdown testId="risk-vintage" minWidth={200} value={String(cohort.vintage)} options={cohorts.map((c) => ({ id: String(c.vintage), label: `${c.vintage} vintage, ${c.age} years in` }))} onChange={(v) => setVintage(+v)} />
        </div>
      )}
      <TrackRecordCard plan={plan} record={record} />
    </div>
  );
}
