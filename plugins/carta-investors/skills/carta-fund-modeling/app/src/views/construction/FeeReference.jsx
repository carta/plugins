import { useMemo, useState } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { Btn, Badge, Dropdown, Segmented } from "../../ui/components.jsx";
import { fmtFullIn, fmtMIn, fmtPct } from "../../ui/format.js";
import { FEE_BASES } from "../../model/construction/plan.js";
import { termMonthsOf, termYearsOf } from "../../model/construction/feeTiers.js";
import { describeTier, expenseLinesFromLedger, expenseRunRate, feeTiersFromHistory, marketCohort, placeIn, shareThrough } from "../../model/construction/history.js";
import { useFirmData } from "../../state/FirmData.jsx";
import { trackClick } from "../../analytics.js";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const baseLabel = (id) => FEE_BASES.find((b) => b.id === id)?.label ?? id;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const WHERE = { below: ["Below the middle half", "neutral"], within: ["Within the middle half", "info"], above: ["Above the middle half", "warning"] };
const POINTS = [["p25", "25th percentile"], ["p50", "Median"], ["p75", "75th percentile"]];

const panel = { padding: "12px 14px", marginBottom: 12, borderRadius: 8, border: "1px solid var(--ink-color-global-border-subtle)", background: "var(--ink-color-global-surface-lightgray-default)" };

/** The fee settings a plan keeps: its own for Advanced, the Light section's for Simple. */
export const feesOf = (plan) => (plan.mode === "light" ? plan.light.fees : plan.fees);
const setFeesOn = (p, next) => { if (p.mode === "light") p.light.fees = next; else p.fees = next; };

/** The undo holds only while the plan is as the change left it. */
function useApply(plan, update, track) {
  const [undo, setUndo] = useState(null);
  const apply = (label, next, note) => {
    trackClick(`FundModeling.FundConstruction.${track}.${label}`);
    const before = structuredClone(feesOf(plan));
    update((p) => { setFeesOn(p, next); });
    setUndo({ before, after: JSON.stringify(next), note });
  };
  const canUndo = undo && JSON.stringify(feesOf(plan)) === undo.after;
  return { apply, canUndo, note: undo?.note, revert: () => { update((p) => { setFeesOn(p, undo.before); }); setUndo(null); } };
}

function Applied({ ctl, testId, undoId }) {
  if (!ctl.canUndo) return null;
  return (
    <div role="status" data-testid={testId} style={{ ...sans, fontSize: FS.small, marginTop: 10 }}>
      {ctl.note} <Btn kind="link" onClick={ctl.revert} data-testid={undoId}>Undo</Btn>
    </div>
  );
}

/** A range with the plan marked on it: the shaded stretch is the middle half of funds, the tick is the median. */
export function BandBar({ band, value, label }) {
  const top = Math.max(band.p75 * 1.35, (value ?? 0) * 1.15, 0.0001);
  const at = (v) => `${clamp(v / top, 0, 1) * 100}%`;
  return (
    <div role="img" aria-label={label} style={{ position: "relative", height: 22, margin: "6px 0 2px", maxWidth: 520 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 9, height: 4, borderRadius: 2, background: "var(--ink-color-global-border-subtle)" }} />
      <div style={{ position: "absolute", left: at(band.p25), width: `calc(${at(band.p75)} - ${at(band.p25)})`, top: 6, height: 10, borderRadius: 3, background: "var(--ink-color-global-data-viz-blue-3)", opacity: 0.35 }} />
      <div style={{ position: "absolute", left: at(band.p50), top: 3, width: 2, height: 16, background: "var(--ink-color-global-data-viz-blue-3)" }} />
      {value != null && <div style={{ position: "absolute", left: at(value), top: 4, width: 14, height: 14, marginLeft: -7, borderRadius: 7, background: "var(--ink-color-global-text-default)", border: "2px solid var(--ink-color-global-surface-background-default)" }} />}
    </div>
  );
}

function useCohort(plan, snapshot, ops) {
  const g = plan.general;
  const asOfYear = +(snapshot?.source?.navAsOf ?? "").slice(0, 4) || new Date().getFullYear();
  return marketCohort(ops, { committed: g.committed, currency: g.currency }, asOfYear);
}

function PastFundPicker({ snapshot, ok, value, onChange }) {
  const funds = (snapshot?.funds ?? []).filter(ok);
  const fund = funds.find((f) => f.id === value) ?? funds[0];
  return { funds, fund, picker: fund && (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      <span style={{ ...sans, fontSize: FS.small, fontWeight: 600 }}>Fund</span>
      <Dropdown testId="past-fund-pick" minWidth={260} value={fund.id} options={funds.map((f) => ({ id: f.id, label: f.name }))} onChange={onChange} />
    </div>
  ) };
}

function FeesFromPastFund({ plan, update, snapshot, feeHistory }) {
  const g = plan.general;
  const [pick, setPick] = useState(null);
  const ctl = useApply(plan, update, "FromPastFund");
  const { fund, picker } = PastFundPicker({ snapshot, ok: (f) => feeHistory?.funds?.[f.id]?.length, value: pick, onChange: setPick });
  const fees = useMemo(() => (fund ? feeTiersFromHistory(feeHistory?.funds?.[fund.id] ?? [], termMonthsOf(g)) : null), [fund, feeHistory, g.termYears, g.evergreen]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fund) return <div style={{ ...sans, fontSize: FS.body, ...subtle }}>None of your funds has a fee schedule to start from.</div>;
  return (
    <div data-testid="past-fund-fees" style={panel}>
      {picker}
      {fees.tiers.length === 0
        ? <div style={{ ...sans, fontSize: FS.body, ...subtle }}>No tiers to carry over.</div>
        : <ul style={{ ...sans, fontSize: FS.body, margin: 0, paddingLeft: 18 }}>{fees.tiers.map((t) => <li key={t.id}>{describeTier(t, baseLabel(t.basis))}</li>)}</ul>}
      {fees.skipped.length > 0 && <div data-testid="past-fund-skipped" style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 4 }}>Not carried over: {fees.skipped.join("; ")}.</div>}
      <div style={{ marginTop: 8 }}>
        <Btn onClick={() => ctl.apply("Tiers", { ...feesOf(plan), tiers: structuredClone(fees.tiers) }, `Applied from ${fund.name}. Edit anything below.`)} disabled={fees.tiers.length === 0} data-testid="use-fee-history">Use these fee tiers</Btn>
      </div>
      <Applied ctl={ctl} testId="past-fund-applied" undoId="past-fund-undo" />
    </div>
  );
}

function ExpensesFromPastFund({ plan, update, snapshot, expenseHistory }) {
  const g = plan.general;
  const [pick, setPick] = useState(null);
  const [scale, setScale] = useState("size");
  const ctl = useApply(plan, update, "FromPastFund");
  const { fund, picker } = PastFundPicker({ snapshot, ok: (f) => expenseHistory?.funds?.[f.id]?.length || snapshot?.fundMetrics?.[f.id], value: pick, onChange: setPick });
  if (!fund) return <div style={{ ...sans, fontSize: FS.body, ...subtle }}>None of your funds has expense history to start from.</div>;
  const run = expenseRunRate({ fund, metrics: snapshot.fundMetrics?.[fund.id], asOf: snapshot.source?.navAsOf });
  const sameCurrency = !fund.currency || !g.currency || fund.currency === g.currency;
  const canExpenses = run?.pctOfCommitted != null && sameCurrency && g.committed > 0;
  const asOfYear = +(snapshot.source?.navAsOf ?? "").slice(0, 4) || new Date().getFullYear();
  const termYears = termYearsOf(g);
  const ledger = expenseHistory?.funds?.[fund.id];
  const itemized = ledger && sameCurrency && g.committed > 0
    ? expenseLinesFromLedger(ledger, { asOfYear, pastCommitted: fund.committed, committed: g.committed, termYears, scale: scale === "size" })
    : null;
  // Each line over the years it runs; the plan keeps only their total.
  const lines = (itemized?.lines ?? []).map((l) => ({ name: l.oneTime ? `${l.name} (one-time)` : l.name, amount: Math.round(l.annualAmount * Math.max(0, l.endYear - l.startYear)), perYear: l.oneTime ? null : l.annualAmount }));
  const linesTotal = lines.reduce((t, l) => t + l.amount, 0);
  const annual = canExpenses ? Math.round(run.pctOfCommitted * g.committed) : null;
  const note = `Applied from ${fund.name}. Edit the total below.`;
  const use = (label, total, basisLines) => ctl.apply(label, { ...feesOf(plan), expenseMode: "amount", expenseTotal: Math.round(total), expenseBasis: { source: fund.name, lines: basisLines } }, note);
  return (
    <div data-testid="past-fund-expenses" style={panel}>
      {picker}
      {lines.length > 0 ? (
        <>
          <div style={{ ...sans, fontSize: FS.small, ...subtle, marginBottom: 4 }}>Breakdown, for reference. The plan uses the total.</div>
          <ul data-testid="past-fund-expense-lines" style={{ ...sans, fontSize: FS.body, margin: 0, paddingLeft: 18 }}>
            {lines.map((l) => <li key={l.name}>{l.name}: <strong>{fmtFullIn(l.amount, g.currency)}</strong>{l.perYear != null ? <span style={subtle}> ({fmtFullIn(l.perYear, g.currency)} a year)</span> : null}</li>)}
          </ul>
          <div data-testid="past-fund-expense-total" style={{ ...sans, fontSize: FS.body, marginTop: 6 }}>
            Total over {termYears} years: <strong>{fmtFullIn(linesTotal, g.currency)}</strong>
          </div>
          <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 4 }}>
            Running costs are the average of each account's last three full years{itemized.factor !== 1 ? `, scaled ×${itemized.factor.toFixed(2)} to this fund's size` : ""}.
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Segmented small value={scale} onChange={setScale} options={[{ id: "size", label: "Scale to this fund's size", testId: "expense-scale-size" }, { id: "same", label: "Same amounts", testId: "expense-scale-same" }]} />
            <Btn onClick={() => use("ExpenseTotal", linesTotal, lines.map((l) => ({ name: l.name, amount: l.amount })))} data-testid="use-expense-lines">Use this total</Btn>
          </div>
        </>
      ) : (
        <>
          {run ? (
            <div style={{ ...sans, fontSize: FS.body }}>
              About <strong>{fmtMIn(run.perYear, fund.currency || g.currency)}</strong> a year over {run.years.toFixed(1)} years
              {run.pctOfCommitted != null ? <> ({fmtPct(run.pctOfCommitted, 2)} of its commitments a year)</> : null}.
              {canExpenses && <> For this fund that is <strong>{fmtMIn(annual, g.currency)}</strong> a year, <strong>{fmtMIn(annual * termYears, g.currency)}</strong> over {termYears} years.</>}
            </div>
          ) : <div style={{ ...sans, fontSize: FS.body, ...subtle }}>No expense history for this fund.</div>}
          {!sameCurrency && <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 4 }}>This fund reports in {fund.currency}, this plan in {g.currency}, so amounts can't be carried over.</div>}
          <div style={{ marginTop: 8 }}>
            <Btn onClick={() => use("ExpenseTotal", annual * termYears, null)} disabled={!canExpenses} data-testid="use-expense-history">Use this total</Btn>
          </div>
        </>
      )}
      <Applied ctl={ctl} testId="past-fund-applied" undoId="past-fund-undo" />
    </div>
  );
}

function Unavailable({ plan }) {
  const ccy = plan.general.currency;
  return (
    <div data-testid="market-unavailable" style={{ ...sans, fontSize: FS.body, ...subtle, marginBottom: 12 }}>
      {ccy && ccy !== "USD" ? `Market ranges are in USD, and this plan is in ${ccy}.` : "There are no market ranges for a fund this size yet."}
    </div>
  );
}

function CohortLine({ cohort }) {
  return (
    <div data-testid="market-check-cohort" style={{ ...sans, fontSize: FS.small, ...subtle, marginBottom: 8 }}>
      Carta fund-ops benchmarks: funds of {cohort.bucket.replace(/m/g, "M").replace("-", " to ")} from {cohort.vintage} ({cohort.mgmtFees.n ?? "?"} funds), {cohort.age} years in.
      {!cohort.exactSize && " No ranking exists yet for a fund your size, so this is the nearest size."} Your plan is shown over the same {cohort.age} years, as a share of commitments.
    </div>
  );
}

function Placement({ kind, label, planShare, band, cohort, onSet, disabledHint, ctl }) {
  const where = placeIn(planShare, band);
  return (
    <div data-testid={`market-row-${kind}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...sans, fontSize: FS.body, fontWeight: 600 }}>{label}</span>
        <span style={{ ...inkNum, fontSize: FS.value, fontWeight: 700 }}>{planShare == null ? "—" : fmtPct(planShare, 1)}</span>
        <span style={{ ...sans, fontSize: FS.small, ...subtle }}>of commitments through year {cohort.age}</span>
        {where && <Badge tone={WHERE[where][1]}>{WHERE[where][0]}</Badge>}
      </div>
      <BandBar band={band} value={planShare} label={`${label}: plan ${planShare == null ? "none" : fmtPct(planShare, 1)}; 25th ${fmtPct(band.p25, 1)}, median ${fmtPct(band.p50, 1)}, 75th ${fmtPct(band.p75, 1)}`} />
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {POINTS.map(([k, name]) => <span key={k}>{name.replace(" percentile", "")} <span style={inkNum}>{fmtPct(band[k], 1)}</span></span>)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span style={{ ...sans, fontSize: FS.small, fontWeight: 600 }}>Move to</span>
        {POINTS.map(([k, name]) => <Btn key={k} onClick={() => onSet(k, name)} disabled={!!disabledHint} data-testid={`set-${kind}-${k}`}>{name}</Btn>)}
      </div>
      {disabledHint && <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 6 }}>{disabledHint}</div>}
      <Applied ctl={ctl} testId="market-applied" undoId="market-undo" />
    </div>
  );
}

function FeesMarket({ plan, update, result, snapshot, ops }) {
  const g = plan.general;
  const cohort = useCohort(plan, snapshot, ops);
  const ctl = useApply(plan, update, "MarketCheck");
  if (!cohort?.mgmtFees) return <Unavailable plan={plan} />;
  if (!result?.ok) return <div style={{ ...sans, fontSize: FS.body, ...subtle, marginBottom: 12 }}>Finish the other steps to see where these fees sit in the market.</div>;
  const share = shareThrough(result.series.fees, cohort.age, g.committed);
  const set = (point, name) => {
    if (!share || !cohort.mgmtFees[point]) return;
    const k = cohort.mgmtFees[point] / share;
    const next = structuredClone(feesOf(plan));
    for (const t of next.tiers) t.rate = clamp(Math.round(t.rate * k * 1e4) / 1e4, 0, 0.19);
    ctl.apply(`Set.${point}`, next, `Fee rates scaled so fees reach the ${name.toLowerCase()} (${fmtPct(cohort.mgmtFees[point], 1)}).`);
  };
  return (
    <div data-testid="market-check" style={panel}>
      <CohortLine cohort={cohort} />
      <Placement kind="fees" label="Management fees" planShare={share} band={cohort.mgmtFees} cohort={cohort} onSet={set} ctl={ctl}
        disabledHint={share ? null : "Add a fee tier first; this scales the tiers you have."} />
    </div>
  );
}

function ExpensesMarket({ plan, update, result, snapshot, ops }) {
  const g = plan.general;
  const cohort = useCohort(plan, snapshot, ops);
  const ctl = useApply(plan, update, "MarketCheck");
  if (!cohort?.opex) return <Unavailable plan={plan} />;
  if (!result?.ok) return <div style={{ ...sans, fontSize: FS.body, ...subtle, marginBottom: 12 }}>Finish the other steps to see where these expenses sit in the market.</div>;
  const share = shareThrough(result.series.expenses, cohort.age, g.committed);
  const termYears = termYearsOf(g);
  const set = (point, name) => {
    const target = cohort.opex[point];
    if (target == null) return;
    // The market share is cumulative through the cohort's age; the plan takes the whole-life total at that yearly pace.
    const next = { ...structuredClone(feesOf(plan)), expenseMode: "amount", expenseTotal: Math.round((target * g.committed / cohort.age) * termYears) };
    delete next.expenseBasis;
    ctl.apply(`Set.${point}`, next, `Expenses set to the ${name.toLowerCase()} (${fmtPct(target, 1)} of commitments through year ${cohort.age}).`);
  };
  const other = [["legal", "Legal"], ["tech", "Software and technology"], ["payroll", "Payroll"]].filter(([k]) => cohort[k]);
  return (
    <div data-testid="market-check-expenses" style={panel}>
      <CohortLine cohort={cohort} />
      <Placement kind="opex" label="Operating expenses" planShare={share} band={cohort.opex} cohort={cohort} onSet={set} ctl={ctl} />
      {other.length > 0 && (
        <div data-testid="market-check-other" style={{ ...sans, fontSize: FS.small, ...subtle, marginTop: 12 }}>
          By category, as a share of contributions (25th, median, 75th): {other.map(([k, label]) => `${label} ${fmtPct(cohort[k].p25, 1)}, ${fmtPct(cohort[k].p50, 1)}, ${fmtPct(cohort[k].p75, 1)}`).join(" · ")}.
        </div>
      )}
    </div>
  );
}

/** `kind` is "fees" or "expenses"; renders nothing when the firm has no data to offer. */
export default function FeeSource({ kind, plan, update, result, snapshot }) {
  const { feeHistory, expenseHistory, opsBenchmarks } = useFirmData();
  const [source, setSource] = useState("manual");
  const history = kind === "fees" ? feeHistory : expenseHistory;
  const options = [
    { id: "manual", label: "Enter manually", testId: `${kind}-source-manual` },
    ...(history ? [{ id: "history", label: "From one of your funds", testId: `${kind}-source-history` }] : []),
    ...(opsBenchmarks ? [{ id: "market", label: "Market benchmarks", testId: `${kind}-source-market` }] : []),
  ];
  if (options.length < 2) return null;
  return (
    <div data-testid={`${kind}-source`} style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ ...sans, fontSize: FS.small, fontWeight: 600 }}>Start from</span>
        <Segmented small value={source} onChange={setSource} options={options} />
      </div>
      {source === "history" && (kind === "fees"
        ? <FeesFromPastFund plan={plan} update={update} snapshot={snapshot} feeHistory={feeHistory} />
        : <ExpensesFromPastFund plan={plan} update={update} snapshot={snapshot} expenseHistory={expenseHistory} />)}
      {source === "market" && (kind === "fees"
        ? <FeesMarket plan={plan} update={update} result={result} snapshot={snapshot} ops={opsBenchmarks} />
        : <ExpensesMarket plan={plan} update={update} result={result} snapshot={snapshot} ops={opsBenchmarks} />)}
    </div>
  );
}
