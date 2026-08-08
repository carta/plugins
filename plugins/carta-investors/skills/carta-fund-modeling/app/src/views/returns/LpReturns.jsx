import { useMemo } from "react";
import { FS, sans, inkNum, MICRO } from "../../ui/theme.js";
import { fmtM, fmtX, fmtPct, fmtAsOf, fmt$ } from "../../ui/format.js";
import { H1, H2, H3, Eyebrow, Segmented, MethodNote, SourceNote, FundPicker, StatBar, Badge, fundLabel, SectionChips } from "../../ui/components.jsx";
import { TableHead, useTableSort, TableScroll } from "../../ui/table.jsx";
import { useFirmData } from "../../state/FirmData.jsx";
import { useScenarioModel } from "./useScenarioModel.js";
import Glidepath from "./Glidepath.jsx";

const RT = { ...inkNum, textAlign: "right", fontSize: FS.value };

// Expected profit at today's marks: residual value (NAV) + realized distributions,
// net of paid-in capital. Positive = the LP is above water on paid-in.
const expProfit = (l) => (l.nav || 0) + (l.distributed || 0) - (l.contributed || 0);

// LP-table columns — label + alignment + sort accessor (Ink sortable header).
const LP_COLS = [
  { label: "Limited partner", align: "left", get: (l) => l.name || "" },
  { label: "Partner class", align: "left", get: (l) => l.partnerClass || "" },
  { label: "Region", align: "left", get: (l) => l.region || "" },
  { label: "Commitment", align: "right", get: (l) => l.commitment },
  { label: "% of commits", align: "right", get: (l) => l.pct },
  { label: "Contributed", align: "right", get: (l) => l.contributed },
  { label: "Unfunded", align: "right", get: (l) => l.unfunded },
  { label: "Distributed", align: "right", get: (l) => l.distributed },
  { label: "NAV", align: "right", get: (l) => l.nav },
  { label: "Expected profit", align: "right", get: (l) => expProfit(l) },
  { label: "DPI", align: "right", get: (l) => l.dpi ?? -Infinity },
  { label: "Funds", align: "right", get: (l) => l.funds },
];

/** All-partners LP returns — every limited partner, aggregated firm-wide across
 *  funds, with a by-region bar chart above and an expected-profit column. This is
 *  the former Overview "LP base" table, uncapped (all LPs, not top-15) and moved
 *  here. Firm-wide (independent of the selected fund). Hidden if no LP data. */
function LpPartnersTable({ funds }) {
  const { lpBase } = useFirmData();
  // depends on build_datadir's display() format: "<ID> (<Name>[, YYYY])"
  const fundNames = useMemo(() => {
    const map = {};
    for (const f of (funds || [])) {
      const m = (f.name || "").match(/\(([^)]+)\)/);
      map[f.id] = m ? m[1].replace(/,\s*\d{4}$/, "") : f.id;
    }
    return map;
  }, [funds]);
  // natural order is commitment-descending until a header click reorders it
  const allLps = useMemo(() => (lpBase?.lps ? [...lpBase.lps].sort((a, b) => b.commitment - a.commitment) : []), [lpBase]);
  const { sorted: sortedLps, sort: lpSort, onSort: onLpSort } = useTableSort(allLps, LP_COLS);
  if (!lpBase || !(lpBase.lps || []).length) return null;
  const unfundedTotal = Math.max(0, lpBase.totalCommitment - lpBase.totalContributed);
  const dpiTotal = lpBase.totalContributed > 0 ? lpBase.totalDistributed / lpBase.totalContributed : null;
  const expProfitTotal = lpBase.totalNav + lpBase.totalDistributed - lpBase.totalContributed;
  const regions = (lpBase.byRegion || []).slice(0, 6);
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <H3>Partner returns · all LPs</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
          {fmtM(lpBase.totalCommitment)} committed · all {lpBase.lps.length} LPs · firm-wide across funds
        </span>
      </div>
      {/* by-region bars (the "chart") */}
      <div style={{ padding: "10px 22px 6px" }}>
        {(() => {
          const ch = { ...sans, fontSize: FS.micro, fontWeight: 600, color: MICRO, whiteSpace: "nowrap" };
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
              <span style={{ ...ch, width: 140, flex: "none" }}>Region</span>
              <span aria-hidden style={{ flex: 1 }} />
              <span style={{ ...ch, width: 44, textAlign: "right", flex: "none" }} title="Share of total commitment">Share</span>
              <span style={{ ...ch, width: 76, textAlign: "right", flex: "none" }}>Commitment</span>
              <span style={{ ...ch, width: 60, textAlign: "right", flex: "none" }}>LPs</span>
            </div>
          );
        })()}
        {regions.map((r) => (
          <div key={r.region} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 9 }}>
            <span style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-default)", width: 140, flex: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.region}</span>
            <div style={{ flex: 1, height: 10, background: "var(--ink-color-global-surface-lightgray-default)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(2, r.pct * 100)}%`, height: "100%", background: "var(--ink-color-global-text-default)", borderRadius: 2 }} />
            </div>
            <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", width: 44, textAlign: "right", flex: "none" }}>{fmtPct(r.pct, 0)}</span>
            <span style={{ ...inkNum, fontSize: FS.small, color: "var(--ink-color-global-text-default)", width: 76, textAlign: "right", flex: "none" }}>{fmtM(r.commitment)}</span>
            <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", width: 60, textAlign: "right", flex: "none" }}>{r.count} LPs</span>
          </div>
        ))}
      </div>
      {/* per-LP table — scrolls in place via .table-scroll (theme.js), see that
          rule's comment for why the sticky header still works */}
      <TableScroll style={{ padding: "6px 0 4px" }}>
        <table className="ledger sheet">
          <TableHead cols={LP_COLS} sort={lpSort} onSort={onLpSort} sticky />
          <tbody>
            {sortedLps.map((l, i) => {
              const ep = expProfit(l);
              const byFund = l.partnerClassByFund;
              const pcTooltip = byFund && Object.keys(byFund).length > 1
                ? Object.entries(byFund).map(([fid, cls]) => `${fundNames[fid] || fid}: ${cls}`).join("\n")
                : l.partnerClass || "";
              return (
                <tr key={i}>
                  <td style={{ ...sans, fontSize: FS.value, fontWeight: 400, color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis" }} title={l.name}>{l.name}</td>
                  <td style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={pcTooltip}>{byFund && new Set(Object.values(byFund)).size > 1 ? "Multiple" : (l.partnerClass || "—")}</td>
                  <td style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{l.region}</td>
                  <td style={{ ...RT, fontWeight: 700 }}>{fmtM(l.commitment)}</td>
                  <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>{fmtPct(l.pct, 1)}</td>
                  <td style={RT}>{fmtM(l.contributed)}</td>
                  <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>{l.unfunded > 0 ? fmtM(l.unfunded) : "—"}</td>
                  <td style={RT}>{l.distributed > 0 ? fmtM(l.distributed) : "—"}</td>
                  <td style={RT}>{fmtM(l.nav)}</td>
                  <td style={{ ...RT, fontWeight: 700, color: ep >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>{fmtM(ep)}</td>
                  <td style={RT}>{l.dpi == null ? "—" : fmtX(l.dpi)}</td>
                  <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>{l.funds}</td>
                </tr>
              );
            })}
            <tr className="totrow">
              <td style={{ ...sans, color: "var(--ink-color-global-text-default)" }}>Count: {sortedLps.length}</td>
              <td />
              <td />
              <td style={RT}>{fmtM(lpBase.totalCommitment)}</td>
              <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>100.0%</td>
              <td style={RT}>{fmtM(lpBase.totalContributed)}</td>
              <td style={{ ...RT, color: "var(--ink-color-global-text-subtle)" }}>{fmtM(unfundedTotal)}</td>
              <td style={RT}>{fmtM(lpBase.totalDistributed)}</td>
              <td style={RT}>{fmtM(lpBase.totalNav)}</td>
              <td style={{ ...RT, color: expProfitTotal >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>{fmtM(expProfitTotal)}</td>
              <td style={RT}>{dpiTotal == null ? "—" : fmtX(dpiTotal)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </TableScroll>
      <SourceNote style={{ margin: "8px 22px 14px" }}>
        Source: Carta Fund Admin (PARTNER_DATA), LPs aggregated across the firm's funds. Partner class as configured in Fund Admin. Expected profit = NAV + distributions − contributed. LP names and classes confidential.
      </SourceNote>
    </div>
  );
}

/** LP Returns tab — LP-facing scorecard, S&P comparator, the per-multiple LP
 *  scenario grid, and the all-partners returns table. */
export default function LpReturns(props) {
  const { snapshot, fundScope, setFundScope, setAssumption, readOnly } = props;
  const m = useScenarioModel(props);
  const { fund, fs, fundId, sliceRows, spRate, hotRate, exitDate } = m;
  const exitYr = exitDate ? exitDate.slice(0, 4) : "—";
  // Public-market benchmark options — the hurdle LP cash flows are indexed into
  // (PME-style). S&P long-run + recent, plus Nasdaq and the 10-yr Treasury as a
  // risk-free floor. `hotRate` is the fund's actual-decade S&P from the snapshot.
  const BENCHMARKS = [
    { r: 0.102, label: "S&P 10.2%" },
    { r: hotRate, label: `S&P ${(hotRate * 100).toFixed(0)}% ('13–'26)` },
    { r: 0.17, label: "Nasdaq 17%" },
    { r: 0.044, label: "10-yr Treasury 4.4%" },
  ];
  // per-multiple LP grid — the benchmark column label carries the live rate. Net
  // TVPI sorts on the exit multiple (the value the row is keyed by).
  const EXIT_COLS = useMemo(() => [
    { label: "Net TVPI", align: "left", get: (r) => r.multiple },
    { label: "LP dist.", get: (r) => r.lpDistributions },
    { label: "LP profit", get: (r) => r.lpNetProfit },
    { label: "Net LP IRR", get: (r) => r.netLpIrr },
    { label: `Bench @${(spRate * 100).toFixed(1)}%`, get: (r) => r.spIrr },
    { label: "Edge", get: (r) => r.edge },
  ], [spRate]);
  const { sorted: exitRows, sort: exitSort, onSort: onExitSort } = useTableSort(sliceRows, EXIT_COLS);
  // Exit horizon is set on the Companies tab now (shared assumption); the grid
  // and scorecard below still read the resulting terminal date via `exitDate`.
  const { lpBase } = useFirmData();
  const sections = [
    ["lp-scorecard", "Scorecard"],
    ["lp-sp", "Benchmark"],
    ["lp-grid", "LP returns"],
    ["lp-glidepath", "Glidepath"],
    lpBase && (lpBase.lps || []).length ? ["lp-partners", "Partners"] : null,
  ].filter(Boolean);
  // full-row tint for the "current marks" row — Ink blue (distinct from --accent-soft,
  // which is reserved for nav/side-rail active state), not the "repriced" stripe pattern:
  // this row means "selected scenario," not "edited."
  const SLICE_BG = "var(--row-selected)";
  // fmt$(0), not "$0" — the zero must carry the fund's currency, not a hardcoded $
  const c$ = (n) => (n === 0 ? fmt$(0) : fmtM(n));
  const markLabel = readOnly ? "current marks" : "scenario mark";

  const subStyle = { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", marginTop: 5, whiteSpace: "nowrap" };
  const cmpSub = (cur, base, fmt, eps) => {
    if (readOnly) return <div style={subStyle}>Baseline</div>;
    if (base == null || cur == null) return <div style={subStyle}>vs baseline · n/m</div>;
    const d = cur - base;
    const col = Math.abs(d) < eps ? "var(--ink-color-global-text-subtle)" : d > 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)";
    return (
      <div style={subStyle}>
        vs {fmt(base)} · <span style={{ color: col, fontWeight: 600 }}>{(d >= 0 ? "+" : "−") + fmt(Math.abs(d))}</span>
      </div>
    );
  };
  const scoreStats = [
    { label: "Net TVPI", value: <span style={{ color: "var(--ink-color-global-text-default)" }}>{fmtX(m.implied)}</span>,
      sub: cmpSub(m.implied, m.baseNet, (n) => fmtX(n), 0.005) },
    { label: "Gross MOIC · before carry", value: <span style={{ color: "var(--ink-color-global-text-default)" }}>{fs.grossMoic == null ? "—" : fmtX(fs.grossMoic)}</span>,
      sub: cmpSub(fs.grossMoic, fs.baseGrossMoic, (n) => fmtX(n), 0.005) },
    { label: `Net LP IRR · exit ${exitYr}`, value: <span style={{ color: "var(--ink-color-global-text-default)" }}>{m.todayIrr == null ? "—" : fmtPct(m.todayIrr)}</span>,
      sub: cmpSub(m.todayIrr, m.baseIrr, (n) => fmtPct(n), 0.0005) },
    {
      label: `Edge vs benchmark · ${exitYr}`,
      value: m.todayEdge == null
        ? <span style={{ color: "var(--ink-color-global-text-subtle)" }}>n/m</span>
        : <span style={{ color: m.todayEdge >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>{(m.todayEdge >= 0 ? "+" : "−") + fmtPct(Math.abs(m.todayEdge))}</span>,
      sub: cmpSub(m.todayEdge, m.baseEdge, (n) => fmtPct(n), 0.0005),
    },
  ];

  return (
    <div>
      <H1 actions={<FundPicker funds={snapshot.funds} value={fundId} onChange={setFundScope} includeAll={false} />}>LP Returns</H1>
      <p style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "0 0 16px" }}>
        At Carta marks: {fmtX(m.cartaNet)} Net TVPI on total incl. future calls
      </p>

      <SectionChips sections={sections} />
      {/* ── scorecard ── */}
      <section id="lp-scorecard" style={{ scrollMarginTop: 64 }}>
      <div className="card" style={{ padding: "22px 10px 18px", marginBottom: 16 }}>
        <StatBar bare serif={false} basis={0} itemStyle={{ minWidth: 0, padding: "0 18px" }} stats={scoreStats} />
        <div style={{ marginTop: 14, padding: "0 18px" }}>
          <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
            {fundLabel(fs.name)} · net to LPs on {fmtM(fund.paidInTotal)} paid-in incl. future calls, at current marks.
          </span>
        </div>
      </div>
      </section>

      {/* ── assumption: public-market benchmark (exit horizon lives on Companies) ── */}
      <section id="lp-sp" style={{ marginBottom: 26, scrollMarginTop: 64 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <Eyebrow>Assumption · Public-market benchmark{readOnly ? " · locked" : ""}</Eyebrow>
          <div style={{ marginTop: 10 }}>
            <Segmented small locked={readOnly}
              options={BENCHMARKS.map((b) => ({ id: b.label, label: b.label }))}
              value={BENCHMARKS.find((b) => Math.abs(spRate - b.r) < 1e-9)?.label}
              onChange={(id) => setAssumption("spRate", BENCHMARKS.find((b) => b.label === id).r)} />
          </div>
          <p style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "8px 0 0" }}>
            The hurdle from indexing the same LP cash flows into a public-market benchmark (a PME-style comparison) — the annual return you'd have to beat by staying in the fund. Exit horizon (currently {fmtAsOf(exitDate)}) is set on the <strong>Companies</strong> tab.
          </p>
        </div>
      </section>

      <section id="lp-grid" style={{ scrollMarginTop: 64 }}>
      <H2 id="lp-returns">LP returns</H2>
      <MethodNote>
        Net to LPs across exit multiples — distributions, profit and net LP IRR vs the benchmark; current marks highlighted.
      </MethodNote>
      {/* scrolls in place via .table-scroll (theme.js) — no sticky here, this
          grid is only ~10-15 rows, too short to ever need a pinned header. */}
      <TableScroll style={{ marginBottom: 10 }}>
        <table className="ledger sheet">
          <TableHead cols={EXIT_COLS} sort={exitSort} onSort={onExitSort} />
          <tbody>
            {exitRows.map((r) => (
              <tr key={r.isSlice ? "slice" : r.multiple} style={r.isSlice ? { background: SLICE_BG } : undefined}>
                <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                  {r.isSlice ? (
                    <span style={{ color: "var(--ink-color-global-link-default)" }}>
                      {r.multiple.toFixed(2)}×
                      <Badge tone="info" style={{ marginLeft: 7 }}>{markLabel}</Badge>
                    </span>
                  ) : (
                    `${r.multiple}×`
                  )}
                </td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}>{c$(r.lpDistributions)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}>{c$(r.lpNetProfit)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}>{fmtPct(r.netLpIrr)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, color: "var(--ink-color-global-text-subtle)" }}>{fmtPct(r.spIrr)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, color: r.edge == null ? "var(--ink-color-global-text-subtle)" : r.edge >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>
                  {r.edge == null ? "n/m" : (r.edge >= 0 ? "+" : "−") + fmtPct(Math.abs(r.edge))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <SourceNote style={{ marginBottom: 28 }}>
        Source: Carta Fund Admin LP cash flows. The <span style={{ color: "var(--ink-color-global-link-default)", fontWeight: 600 }}>highlighted row</span> is current marks. IRR: XIRR on
        Carta LP flows with one terminal distribution on {fmtAsOf(exitDate)} (assumed exit horizon). <span style={{ color: "var(--ink-color-global-feedback-positive-strong)" }}>Green</span> edge beats indexing into the benchmark at {(spRate * 100).toFixed(1)}%/yr.
      </SourceNote>
      </section>

      <section id="lp-glidepath" style={{ scrollMarginTop: 64 }}>
      <Glidepath snapshot={snapshot} fundState={fs} portfolio={props.portfolio}
        setAssumption={setAssumption} readOnly={readOnly} />
      </section>

      <section id="lp-partners" style={{ scrollMarginTop: 64 }}>
      <LpPartnersTable funds={snapshot.funds} />
      </section>
    </div>
  );
}
