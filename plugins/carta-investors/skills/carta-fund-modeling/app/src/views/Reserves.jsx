// Reserves & dry powder — how much capital is left to deploy, by fund.
// Committed capital splits into fees, invested-at-cost, and remaining dry
// powder; the dry powder is earmarked between follow-on reserves and new-deal
// capacity. Reported figures (committed, invested) are firm; the fee load and
// follow-on split are adjustable planning assumptions, set PER FUND and saved
// into the active scenario. Model: src/model/reserves.js.
import { useMemo, useState } from "react";
import { FS, sans, inkNum, NOTICE, MICRO } from "../ui/theme.js";
import { fmt$, fmtM, fmtX, fmtPct } from "../ui/format.js";
import { H1, H3, Eyebrow, MethodNote, SourceNote, Toggle, Slider, StatBar, Badge, SectionChips, fundLabel } from "../ui/components.jsx";
import { TableHead, useTableSort, TableScroll } from "../ui/table.jsx";
import { computeReserves, nearlyDeployed, optimalReserveAllocation, newDealCount } from "../model/reserves.js";
import { deploymentRunway } from "../model/runway.js";
import { useFirmData } from "../state/FirmData.jsx";
import { trackClick } from "../analytics.js";

/** A quarter count rendered as "3.0 qtrs · ~9 mo" for quick reading. */
const fmtRunway = (q) => `${q.toFixed(1)} qtrs · ~${Math.round(q * 3)} mo`;

/** Deployment runway — how long each fund's new-deal capacity lasts at its
 *  recent investment pace. Joins Reserves (capacity, avg check) with pacing. */
const RUNWAY_COLS = [
  { label: "Fund", align: "left", get: (f) => fundLabel(f.name) },
  { label: "New-deal capacity", get: (f) => f.newDeal },
  { label: "Avg check", get: (f) => f.avgCheck },
  { label: "New deals", get: (f) => f.newDeals },
  { label: "Pace / qtr", get: (f) => f.pacePerQtr },
  { label: "Runway", get: (f) => f.runwayQuarters },
  { label: "Exhausts", get: (f) => f.exhausts },
];
function RunwayCard({ reserves, pacing, avgChecks, mixed }) {
  const r = useMemo(() => deploymentRunway(reserves, pacing, { avgChecks }), [reserves, pacing, avgChecks]);
  const { sorted: runwayRows, sort: runwaySort, onSort: onRunwaySort } = useTableSort(r.funds, RUNWAY_COLS);
  if (!r.funds.length) return null;
  const cell = { ...inkNum, textAlign: "right", fontSize: FS.value, whiteSpace: "nowrap" };
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 4 }}>
        <H3>Deployment runway</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>new-deal capacity at the recent pace</span>
      </div>
      <MethodNote>
        New-deal capacity ÷ recent pace (new companies/qtr × average check at cost). A planning estimate; SPVs and inactive funds omitted.
      </MethodNote>
      <TableScroll>
      <table className="ledger" style={{ marginTop: 8 }}>
        <TableHead cols={RUNWAY_COLS} sort={runwaySort} onSort={onRunwaySort} sticky />
        <tbody>
          {runwayRows.map((f) => (
            <tr key={f.id}>
              <td style={{ fontWeight: 400, whiteSpace: "nowrap" }}>
                {fundLabel(f.name)}
                {f.nearlyDeployed && <Badge tone="warning" style={{ marginLeft: 6 }}>RESERVE-LIGHT</Badge>}
              </td>
              <td style={cell}>{fmtM(f.newDeal)}</td>
              <td style={{ ...cell, color: "var(--ink-color-global-text-subtle)" }}>{fmtM(f.avgCheck)}</td>
              <td style={{ ...cell, fontWeight: 700 }}>{f.newDeals}</td>
              <td style={cell}>{fmtM(f.pacePerQtr)}</td>
              <td style={{ ...cell, fontWeight: 700, color: f.runwayQuarters < 4 ? NOTICE : "var(--ink-color-global-feedback-positive-strong)" }}>{fmtRunway(f.runwayQuarters)}</td>
              <td style={{ ...cell, color: "var(--ink-color-global-text-subtle)" }}>{f.exhausts}</td>
            </tr>
          ))}
          {r.totals.runwayQuarters != null && (
            <tr className="totrow">
              <td>Count: {runwayRows.length}</td>
              <td style={cell}>{mixed ? "—" : fmtM(r.totals.newDeal)}</td>
              <td style={{ ...cell, color: "var(--ink-color-global-text-subtle)" }}>—</td>
              <td style={cell}>{mixed ? "—" : r.totals.newDeals}</td>
              <td style={cell}>{mixed ? "—" : fmtM(r.totals.pacePerQtr)}</td>
              <td style={cell}>{fmtRunway(r.totals.runwayQuarters)}</td>
              <td style={{ ...cell, color: "var(--ink-color-global-text-subtle)" }}>—</td>
            </tr>
          )}
        </tbody>
      </table>
      </TableScroll>
      <SourceNote>
        Source: Carta Fund Admin invested-at-cost + pacing. Average check (invested ÷ companies backed) is editable per fund below. New-deal capacity reflects the per-fund recycling assumption; excludes follow-ons and reserve top-ups.
      </SourceNote>
    </div>
  );
}

// capital-allocation segment colors (deployed → reserved → free → fees)
const SEG = {
  deployed: { c: "var(--ink-color-global-data-viz-positive-3)",  label: "Called & deployed" },
  followOn: { c: "var(--ink-color-global-data-viz-turquoise-3)", label: "Follow-on reserve" },
  newDeal:  { c: "var(--ink-color-global-data-viz-yellow-3)",    label: "New-deal capacity" },
  fees:     { c: "var(--ink-color-global-data-viz-neutral-3)",   label: "Fees & expenses" },
};

// Recycling accent — deliberately the one data-viz hue NOT used elsewhere in
// this view (brown), so the recycling slider and its "headroom" tile don't read
// as the dry-powder blue. Shared so the slider and the tile stay in sync.
const RECYCLING_C = "var(--ink-color-global-data-viz-brown-3)";

// Micro column-label, sentence case — matches Ink's table-header spec
// (theme-with-ink/brand.md: uppercase is reserved for eyebrows, not column heads).
const COL_HEAD = { ...sans, fontSize: FS.micro, fontWeight: 600, color: MICRO, whiteSpace: "nowrap" };

/** Stacked capital-allocation bar for one fund (segments sum across committed).
 *  With a recycling uplift the segments sum to committed × (1 + recycling), so
 *  the denominator grows to fit; a tick marks the base-commitment (100%) line. */
function AllocBar({ f }) {
  const recycling = f.recycling || 0;
  const denom = Math.max(f.committed * (1 + recycling), f.deployed + f.feeReserve) || 1;
  const segs = [
    ["deployed", f.deployed],
    ["followOn", f.followOn],
    ["newDeal", f.newDeal],
    ["fees", f.feeReserve],
  ].filter(([, v]) => v > 0);
  return (
    <div style={{ position: "relative", display: "flex", height: 22, borderRadius: 6, overflow: "hidden", background: "var(--ink-color-global-surface-lightgray-default)" }}>
      {segs.map(([k, v]) => (
        <div key={k} title={`${SEG[k].label}: ${fmt$(v)}`}
          style={{ width: `${(v / denom) * 100}%`, background: SEG[k].c }} />
      ))}
      {recycling > 0 && (
        // base-commitment line: everything to its right is recycling headroom
        <div title={`Committed: ${fmt$(f.committed)} · recycling headroom beyond`}
          style={{ position: "absolute", top: 0, bottom: 0, left: `${(f.committed / denom) * 100}%`,
            width: 2, background: "var(--ink-color-global-text-default)", opacity: 0.55 }} />
      )}
    </div>
  );
}

// Fund ledger columns — label + alignment + sort accessor. Fund name is
// fundLabel(f.name) (the readable "Fund IV (2021)" form, not the raw ALL-CAPS
// id); the rest are the reported/derived reserve figures.
const LEDGER_COLS = [
  { label: "Fund", align: "left", get: (f) => fundLabel(f.name) },
  { label: "Committed", get: (f) => f.committed },
  // NOTE: this is LP cash actually contributed (snapshot lpPaidIn / DWH
  // cumulative_lp_contributions), NOT gross capital called via call notices.
  // Labeled "Paid-in / Contributed" to reflect that. A true gross-"Called"
  // column would need a capital-call source wired through the pipeline (TODO).
  { label: "Paid-in / Contributed", get: (f) => f.paidIn },
  { label: "Dry powder", get: (f) => f.reserves },
  {
    label: "Deployed",
    get: (f) => f.deployedPct,
    help:
      "Deployed = max(invested at cost, paid-in) ÷ investable, capped at 100%. " +
      "Investable = committed − fee/expense reserve. Floored at paid-in because " +
      "realized exits leave the book, so cost alone understates deployment.",
  },
  { label: "Uncalled", get: (f) => f.uncalled },
];

// Optimal-reserve ranking columns. Natural order is the top-15-by-next-dollar slice;
// sorting reorders that slice (it doesn't re-pick from the full list). The
// "Last round → your mark" column sorts on your mark value (the endpoint shown).
const OPTIMAL_COLS = [
  { label: "Company", align: "left", get: (r) => r.name },
  { label: "Fund", align: "left", get: (r) => fundLabel(r.fundName) },
  { label: "Next dollar return", get: (r) => r.marginal },
  { label: "Last round → your mark", get: (r) => r.markVal },
  { label: "Suggested reserve", get: (r) => r.suggested },
];

export default function Reserves({ snapshot, portfolio, setAssumption, readOnly }) {
  const { pacing, ownership } = useFirmData();
  // never sum across currencies: firm-level $ totals are invalid for a mixed-currency firm
  const mixed = !!snapshot.source?.mixedCurrency;
  const feeLoads = portfolio.assumptions.feeLoads || {};
  const followOnRatios = portfolio.assumptions.followOnRatios || {};
  const recyclingRatios = portfolio.assumptions.recyclingRatios || {};
  const avgChecks = portfolio.assumptions.avgChecks || {};

  const { funds, totals } = useMemo(
    () => computeReserves(snapshot, portfolio, { feeLoads, followOnRatios, recyclingRatios }),
    [snapshot, portfolio, feeLoads, followOnRatios, recyclingRatios]
  );
  // core funds first (by vintage), SPVs after — the display order from the snapshot
  // Hide funds with no committed capital — anything that renders as "$0.0M
  // committed" (< $50k, incl. GP shells / uninitialized vehicles) has nothing to
  // allocate and just clutters the reserves view. fmtM rounds to one $M decimal,
  // so < 50_000 is exactly the set that shows "$0.0M".
  const ordered = useMemo(
    () => funds.filter((f) => Math.abs(f.committed) >= 50_000)
               .sort((a, b) => (a.isSpv - b.isSpv) || (a.vintage - b.vintage)),
    [funds]);
  const flags = useMemo(() => nearlyDeployed({ funds }), [funds]);
  const optimal = useMemo(
    () => optimalReserveAllocation(snapshot, portfolio, { feeLoads, followOnRatios, recyclingRatios, ownership }),
    [snapshot, portfolio, feeLoads, followOnRatios, recyclingRatios, ownership]
  );
  // Holdings in a fully-deployed fund can never receive a suggested reserve (their
  // fund's follow-on pool is $0), so offer to hide them and rank only the actionable
  // rows. Count is over the FULL list, not just the top slice, so the toggle label
  // reflects everything it would remove.
  const [hideNoPool, setHideNoPool] = useState(true);
  const noPoolCount = useMemo(() => optimal.companies.filter((r) => !(r.fundFollowOn > 0)).length, [optimal]);
  // Filter (when hiding no-pool funds) BEFORE the top-15 slice, so the slice fills
  // with the strongest holdings that can actually take a reserve.
  const optimalTop = useMemo(() => {
    const pool = hideNoPool ? optimal.companies.filter((r) => r.fundFollowOn > 0) : optimal.companies;
    return pool.slice(0, 15);
  }, [optimal, hideNoPool]);
  const { sorted: optimalRows, sort: optimalSort, onSort: onOptimalSort } = useTableSort(optimalTop, OPTIMAL_COLS);
  const sections = [
    ["rv-summary", "Dry powder"],
    ["rv-alloc", "Allocation"],
    optimal.companies.length ? ["rv-optimal", "Optimal reserves"] : null,
    ["rv-runway", "Runway"],
    ["rv-ledger", "Funds"],
  ].filter(Boolean);

  // A fund is "fully called" (per the row label) once it has no dry powder left
  // to deploy — i.e. reserves ≤ 0. Hide those by default; matching the label's
  // own test keeps the list and the per-row status consistent.
  const hasRoom = (f) => f.reserves > 0;
  const [showCalled, setShowCalled] = useState(false);
  // SPVs are single-deal, fee-light vehicles that clutter the fund view — hide
  // them by default behind a toggle, like the fully-called funds.
  const [showSpv, setShowSpv] = useState(false);
  const spvCount = ordered.filter((f) => f.isSpv).length;
  // SPV filter first, then the fully-called filter — so the "fully called"
  // count reflects only the funds currently in scope.
  const scoped = showSpv ? ordered : ordered.filter((f) => !f.isSpv);
  const visible = showCalled ? scoped : scoped.filter(hasRoom);
  const hiddenCount = scoped.length - scoped.filter(hasRoom).length;
  // ledger sort — natural order (vintage, SPVs last) until a header is clicked
  const { sorted: ledgerRows, sort: ledgerSort, onSort: onLedgerSort } = useTableSort(visible, LEDGER_COLS);

  // Average check size: a fund's own invested ÷ companies where it has a
  // deployment history, else the firm-wide average across funds that have
  // deployed, else a sensible floor. Editable per fund via the slider below.
  const withHistory = funds.filter((f) => !f.isSpv && f.companies > 0 && f.invested > 0);
  const firmAvgCheck = withHistory.length
    ? withHistory.reduce((s, f) => s + f.invested, 0) / withHistory.reduce((s, f) => s + f.companies, 0)
    : 0;
  const derivedCheck = (f) => (f.companies > 0 ? f.invested / f.companies : 0);
  const defaultCheck = (f) => derivedCheck(f) || firmAvgCheck || 2_000_000;
  const effCheck = (f) => avgChecks[f.id] ?? defaultCheck(f);
  // adaptive slider ceiling so a large default isn't clipped
  const checkMax = (f) => Math.max(20_000_000, Math.ceil((defaultCheck(f) * 2) / 1e6) * 1e6);

  // Firm-wide new-deal count: the sum, across every entity, of floor(new-deal
  // capacity ÷ that fund's average check) — the same per-fund figure shown in the
  // allocation section below, rolled up (shared with the scenario report via
  // newDealCount). A count of within-fund ratios, so it's valid even for a
  // MIXED-CURRENCY firm (unlike the $ header totals, which blank to "—").
  const totalNewDeals = newDealCount({ funds }, avgChecks);

  // per-fund knob writers — persist into the active scenario's assumptions
  const setFundFee = (id, v) => setAssumption("feeLoads", { ...feeLoads, [id]: v });
  const setFundFollowOn = (id, v) => setAssumption("followOnRatios", { ...followOnRatios, [id]: v });
  const setFundCheck = (id, v) => setAssumption("avgChecks", { ...avgChecks, [id]: v });
  const setFundRecycling = (id, v) => setAssumption("recyclingRatios", { ...recyclingRatios, [id]: v });

  return (
    <div>
      <H1>Reserves &amp; dry powder</H1>
      <MethodNote>
        Dry powder = committed × (1 + recycling) − fee/expense reserve − invested-at-cost. Committed/invested are from Carta; fee load, follow-on split, check size and recycling (LPA reinvestment headroom) are planning assumptions you set per fund below.
      </MethodNote>
      <SectionChips sections={sections} />

      {/* the headline read — investable capital still available */}
      <section id="rv-summary" style={{ scrollMarginTop: 64 }}>
      <StatBar basis={210} itemStyle={{ padding: "0 22px" }} style={{ marginBottom: 16 }} stats={[
        { label: "Total dry powder", value: mixed ? "—" : fmtM(totals.reserves), sub: `across ${ordered.filter((f) => !f.isSpv).length} funds + ${ordered.filter((f) => f.isSpv).length} SPVs`, color: "var(--ink-color-global-data-viz-blue-3)" },
        { label: "New-deal capacity", value: mixed ? "—" : fmtM(totals.newDeal), sub: `after per-fund follow-on reserves` },
        { label: "New deals fundable", value: String(totalNewDeals), sub: `across all entities at current check sizes`, color: "var(--ink-color-global-data-viz-yellow-3)" },
        { label: "Follow-on reserves", value: mixed ? "—" : fmtM(totals.followOn), sub: `earmarked for the book` },
        { label: "Uncalled from LPs", value: mixed ? "—" : fmtM(totals.uncalled), sub: mixed ? "funds span multiple currencies" : `${fmtPct(totals.committed ? totals.uncalled / totals.committed : 0, 0)} of committed` },
        // recycling tile only when a recycling assumption is in play — keeps the
        // default (no-recycling) view uncluttered
        totals.recyclable > 0
          ? { label: "Recycling headroom", value: mixed ? "—" : fmtM(totals.recyclable), sub: `LPA reinvestment above committed`, color: RECYCLING_C }
          : null,
      ].filter(Boolean)} />
      </section>

      {/* the hero: per-fund committed-capital allocation, each with its own
          fee-load + follow-on sliders (saved into the active scenario) */}
      <section id="rv-alloc" style={{ scrollMarginTop: 64 }}>
      <div className="card" style={{ padding: "18px 22px 16px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
          <span style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 650, color: "var(--ink-color-global-text-default)" }}>Committed capital, allocated</span>
          <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>fee, follow-on &amp; recycling set per fund{readOnly ? " · locked" : ""}</span>
          {spvCount > 0 && (
            <Toggle checked={showSpv} onChange={(v) => { trackClick("FundModeling.Reserves.ToggleShowSpvs"); setShowSpv(v); }}
              labels={[`Show SPVs (${spvCount})`, `Show SPVs (${spvCount})`]} />
          )}
          {hiddenCount > 0 && (
            <Toggle checked={showCalled} onChange={(v) => { trackClick("FundModeling.Reserves.ToggleShowCalledFunds"); setShowCalled(v); }}
              labels={[`Show fully called funds (${hiddenCount})`, `Show fully called funds (${hiddenCount})`]} />
          )}
          <span style={{ flex: 1 }} />
          {Object.entries(SEG).map(([k, s]) => (
            <span key={k} style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.c, display: "inline-block" }} />
              {s.label}
            </span>
          ))}
        </div>
        {/* column headers for the fund allocation grid below — the right-hand
            figure is easy to misread without a label (it's remaining dry powder) */}
        <div style={{ display: "grid", gridTemplateColumns: "184px 1fr 92px", gap: 12, alignItems: "baseline",
          padding: "0 0 8px", borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
          <span style={COL_HEAD}>Fund · committed</span>
          <span style={COL_HEAD}>Allocation of committed capital</span>
          <span style={{ ...COL_HEAD, textAlign: "right" }}>Dry powder</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {visible.map((f, i) => (
            <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 0",
              borderTop: i > 0 ? `1px solid var(--ink-color-global-border-subtle)` : "none" }}>
              <div style={{ display: "grid", gridTemplateColumns: "184px 1fr 92px", gap: 12, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: FS.body, fontWeight: 600, color: "var(--ink-color-global-text-default)", lineHeight: 1.2, overflowWrap: "anywhere" }}>
                    {f.id}{f.isSpv && <Badge style={{ marginLeft: 6 }}>SPV</Badge>}
                  </div>
                  <div style={{ ...inkNum, fontSize: FS.micro, color: MICRO }}>{fmtM(f.committed)} committed</div>
                </div>
                <AllocBar f={f} />
                <div style={{ ...inkNum, fontSize: FS.body, fontWeight: 700, color: f.reserves > 0 ? "var(--ink-color-global-data-viz-blue-3)" : "var(--ink-color-global-text-subtle)", textAlign: "right" }}>
                  {f.reserves > 0 ? fmtM(f.reserves) : "fully called"}
                </div>
              </div>
              {/* slider order matches the bar's left-to-right segment order (deployed has no slider) */}
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", paddingLeft: 196 }}>
                <Slider label="Follow-on reserve" value={f.followOnRatio} min={0} max={1} step={0.05}
                  onChange={(v) => setFundFollowOn(f.id, v)} fmt={(v) => fmtPct(v, 0)} locked={readOnly}
                  accent={SEG.followOn.c} style={{ flex: "1 1 200px", minWidth: 170 }} />
                <Slider label="Average check" value={effCheck(f)} min={250000} max={checkMax(f)} step={250000}
                  onChange={(v) => setFundCheck(f.id, v)} fmt={(v) => fmtM(v)} locked={readOnly}
                  accent={SEG.newDeal.c} style={{ flex: "1 1 200px", minWidth: 170 }} />
                <Slider label="Fee & expense load" value={f.feeLoad} min={0} max={0.3} step={0.01}
                  onChange={(v) => setFundFee(f.id, v)} fmt={(v) => fmtPct(v, 0)} locked={readOnly}
                  accent={SEG.fees.c} style={{ flex: "1 1 200px", minWidth: 170 }} />
                {/* recycling provision (LPA): uplift on committed that raises the
                    investable ceiling — the % IS the cap. 0 = no recycling. */}
                <Slider label="Recycling" value={f.recycling} min={0} max={0.5} step={0.05}
                  onChange={(v) => setFundRecycling(f.id, v)} fmt={(v) => fmtPct(v, 0)} locked={readOnly}
                  accent={RECYCLING_C} style={{ flex: "1 1 200px", minWidth: 170 }} />
              </div>
              {(() => {
                const check = effCheck(f);
                if (!(check > 0) || !(f.newDeal > 0)) return null;
                const n = Math.floor(f.newDeal / check);
                return (
                  <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", paddingLeft: 196 }}>
                    ≈ <strong style={{ color: "var(--ink-color-global-feedback-positive-strong)", fontWeight: 700 }}>{n} new {n === 1 ? "deal" : "deals"} can be done</strong>
                    {" "}· {fmtM(f.newDeal)} new-deal capacity ÷ {fmtM(check)} average check
                    {avgChecks[f.id] == null && derivedCheck(f) === 0 ? " (firm average)" : ""}
                  </div>
                );
              })()}
              {snapshot.fundMetrics?.[f.id] && (snapshot.fundMetrics[f.id].mgmtFees > 0 || snapshot.fundMetrics[f.id].opex > 0) && (
                <div style={{ ...sans, fontSize: FS.micro, color: MICRO, paddingLeft: 196 }}>
                  Actual to date: {fmtM(snapshot.fundMetrics[f.id].mgmtFees)} mgmt fees · {fmtM(snapshot.fundMetrics[f.id].opex)} other expenses
                  {f.committed > 0 ? ` · ${fmtPct((snapshot.fundMetrics[f.id].mgmtFees + snapshot.fundMetrics[f.id].opex) / f.committed, 1)} of committed (your slider models the full fund life)` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      </section>

      {/* reserve-discipline flags */}
      {flags.length > 0 && (
        <div className="card" style={{ padding: "14px 20px", marginBottom: 16, borderLeft: `3px solid ${NOTICE}` }}>
          <Eyebrow color={NOTICE}>Reserve-light funds</Eyebrow>
          <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-default)", marginTop: 8, lineHeight: 1.55 }}>
            {flags.map((f) => `${f.id} (${fmtPct(f.deployedPct, 0)} deployed)`).join(" · ")}
            <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 4 }}>
              ≥ 85% of investable capital is committed — tighten follow-on discipline or plan the next fund.
            </div>
          </div>
        </div>
      )}

      {/* optimal reserve allocation — expected return on the next dollar */}
      <section id="rv-optimal" style={{ scrollMarginTop: 64 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
            <H3>Optimal reserve allocation</H3>
            <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>where the next dollar works hardest</span>
            <span style={{ flex: 1 }} />
            {noPoolCount > 0 && (
              <Toggle checked={hideNoPool} onChange={(v) => { trackClick("FundModeling.Reserves.ToggleHideNoPool"); setHideNoPool(v); }}
                labels={[`Hide funds with no reserve pool (${noPoolCount})`, `Hide funds with no reserve pool (${noPoolCount})`]} />
            )}
          </div>
          <MethodNote>
            Expected return on the next dollar = your valuation mark ÷ the last priced round (× 1 − expected dilution) — reserve where it's
            highest. The suggested split spreads each fund's follow-on reserve by upside; realized / written-off holdings are excluded.
          </MethodNote>
          {optimal.companies.length === 0 ? (
            <span style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>No live holdings with a valuation to rank.</span>
          ) : (
            <TableScroll>
            <table className="ledger sheet">
              <TableHead cols={OPTIMAL_COLS} sort={optimalSort} onSort={onOptimalSort} sticky />
              <tbody>
                {optimalRows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</td>
                    <td style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{fundLabel(r.fundName)}</td>
                    <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, fontWeight: 700, color: r.marginal > 1 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-text-subtle)" }}>{fmtX(r.marginal)}</td>
                    <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, color: "var(--ink-color-global-text-subtle)" }}>{fmtM(r.entryVal)} → {fmtM(r.markVal)}</td>
                    <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, fontWeight: 700, color: r.suggested > 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-text-subtle)" }}>
                      {r.suggested > 0 ? fmtM(r.suggested)
                        : r.fundFollowOn > 0 ? "—"
                          : (
                            <Badge title="This fund is fully deployed — it has no follow-on reserve pool to allocate, so no holding in it can receive a suggested reserve.">
                              No pool available
                            </Badge>
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          )}
          <SourceNote>
            Source: Carta Fund Admin holdings. Entry = last priced round (else the Carta mark-basis); mark = your scenario valuation; both
            dilution-adjusted. Suggested reserve splits each fund's follow-on pool ({mixed ? "—" : fmtM(optimal.totalFollowOn)} firm-wide) by
            upside; $0 when the next dollar isn't accretive. Holdings in a fully-deployed fund show "No pool available" — that fund
            has no follow-on reserve to split, so no repricing can earn a reserve there. Reacts to your marks. Company names confidential.
          </SourceNote>
        </div>
      </section>

      {/* deployment runway — capacity ÷ recent pace */}
      <section id="rv-runway" style={{ scrollMarginTop: 64 }}>
      <RunwayCard reserves={{ funds, totals }} pacing={pacing} avgChecks={avgChecks} mixed={mixed} />
      </section>

      {/* the ledger */}
      <section id="rv-ledger" style={{ scrollMarginTop: 64 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 4 }}>
        <H3>Fund ledger</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>committed, paid-in, and remaining dry powder by fund</span>
      </div>
      <TableScroll>
        <table className="ledger" style={{ marginTop: 8 }}>
          <TableHead cols={LEDGER_COLS} sort={ledgerSort} onSort={onLedgerSort} sticky />
          <tbody>
            {ledgerRows.map((f) => (
              <tr key={f.id}>
                <td style={{ fontWeight: 400, whiteSpace: "nowrap" }}>
                  {fundLabel(f.name)}
                  {f.isSpv && <Badge style={{ marginLeft: 6 }}>SPV</Badge>}
                </td>
                <td style={{ ...inkNum, textAlign: "right" }}>{fmt$(f.committed)}</td>
                <td style={{ ...inkNum, textAlign: "right" }}>{fmt$(f.paidIn)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontWeight: 700, color: f.reserves > 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-text-subtle)" }}>{f.reserves > 0 ? fmt$(f.reserves) : "—"}</td>
                <td style={{ ...inkNum, textAlign: "right" }}
                  title={`Deployed ${fmt$(f.deployed)} of ${fmt$(f.investable)} investable${f.deployed > f.investable ? " (capped at 100%)" : ""}. Basis = max(invested at cost ${fmt$(f.invested)}, paid-in ${fmt$(f.paidIn)}); investable = committed − fee/expense reserve.`}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, justifyContent: "flex-end" }}>
                    <span style={{ width: 46, height: 5, borderRadius: 3, background: "var(--ink-color-global-surface-lightgray-default)", overflow: "hidden", display: "inline-block" }}>
                      <span style={{ display: "block", height: "100%", width: `${f.deployedPct * 100}%`, background: f.deployedPct >= 0.85 ? NOTICE : "var(--ink-color-global-feedback-positive-strong)" }} />
                    </span>
                    {fmtPct(f.deployedPct, 0)}
                  </span>
                </td>
                <td style={{ ...inkNum, textAlign: "right", color: "var(--ink-color-global-text-subtle)" }}>{f.uncalled > 0 ? fmt$(f.uncalled) : "—"}</td>
              </tr>
            ))}
            <tr className="totrow">
              <td>Count: {ledgerRows.length}</td>
              <td style={{ ...inkNum, textAlign: "right" }}>{mixed ? "—" : fmt$(totals.committed)}</td>
              <td style={{ ...inkNum, textAlign: "right" }}>{mixed ? "—" : fmt$(totals.paidIn)}</td>
              <td style={{ ...inkNum, textAlign: "right", color: "var(--ink-color-global-feedback-positive-strong)" }}>{mixed ? "—" : fmt$(totals.reserves)}</td>
              <td style={{ ...inkNum, textAlign: "right" }}>{mixed ? "—" : fmtPct(totals.deployedPct, 0)}</td>
              <td style={{ ...inkNum, textAlign: "right", color: "var(--ink-color-global-text-subtle)" }}>{mixed ? "—" : fmt$(totals.uncalled)}</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>
      </section>

      <SourceNote>
        Source: Carta Fund Admin (committed, invested cost). Dry powder = committed × (1 + recycling) − fee/expense reserve − invested; the fee load, follow-on split and recycling headroom are your planning assumptions, saved into the scenario.
      </SourceNote>
    </div>
  );
}
