import { useEffect, useMemo, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn, Badge, Checkbox, Dropdown } from "../../ui/components.jsx";
import { fmtFullIn, fmtPct } from "../../ui/format.js";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { latestFund } from "../../model/construction/plan.js";
import { fundBenchmark, combineFunds, parallelFunds, applyBenchmark, usableEntries } from "../../model/construction/benchmark.js";
import { trackClick } from "../../analytics.js";
import { fmtYm, cellNum, sourceLabel } from "./fields.jsx";

// A fund this young hasn't had time to follow on yet, so its rates understate reserves.
const YOUNG_YEARS = 4;

export function useInvestmentHistory(firm) {
  const [history, setHistory] = useState(undefined); // undefined = loading, null = none
  useEffect(() => {
    let live = true;
    const q = firm ? `?firm=${encodeURIComponent(firm)}` : "";
    fetch(`/api/report/investment-history.json${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => { if (live) setHistory(h && !h.error && Object.keys(h).length ? h : null); })
      .catch(() => { if (live) setHistory(null); });
    return () => { live = false; };
  }, [firm]);
  return history;
}

export default function BenchmarkPanel({ plan, update, snapshot, firm, defaultOpen = false, onClose }) {
  const history = useInvestmentHistory(firm);
  const [open, setOpen] = useState(defaultOpen);
  const [fundId, setFundId] = useState(null);
  const [withParallel, setWithParallel] = useState(true);
  const [sectorId, setSectorId] = useState(plan.sectors[0]?.id);
  const [confirm, setConfirm] = useState(false);

  const funds = useMemo(() => (snapshot?.funds ?? []).filter((f) => history?.[f.id]?.length), [snapshot, history]);
  const chosen = funds.find((f) => f.id === fundId) ?? latestFund({ funds }) ?? funds[0];
  const parallels = useMemo(() => {
    if (!history || !chosen) return [];
    const currencyOf = (id) => funds.find((f) => f.id === id)?.currency ?? null;
    return parallelFunds(history, chosen.id, currencyOf);
  }, [history, chosen, funds]);
  const bench = useMemo(() => {
    if (!history || !chosen) return null;
    const ids = withParallel ? [chosen.id, ...parallels] : [chosen.id];
    return fundBenchmark(ids.length > 1 ? combineFunds(history, ids) : history[chosen.id], snapshot?.source?.navAsOf);
  }, [history, chosen, parallels, withParallel, snapshot]);

  const sector = plan.sectors.find((s) => s.id === sectorId) ?? plan.sectors[0];
  const usable = bench && sector ? usableEntries(bench, sector) : [];
  const fundCcy = chosen?.currency ?? snapshot?.source?.currency ?? null;
  const ccyMismatch = !!(fundCcy && plan.general.currency && fundCcy !== plan.general.currency);
  const label = chosen ? sourceLabel(chosen.name) : "";
  const sourceName = withParallel && parallels.length ? `${label} + ${parallels.length} parallel` : label;

  const apply = () => {
    trackClick("FundModeling.FundConstruction.ApplyBenchmark");
    update((p) => { applyBenchmark(p, bench, { sectorId: sector.id, source: sourceName }); });
    setConfirm(false);
  };

  return (
    <div className="card" data-testid="benchmark-panel" style={{ padding: "14px 18px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>Benchmark from one of your funds</div>
          <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
            See the check sizes and follow-ons a fund actually made, and use them as starting assumptions.
          </div>
        </div>
        {onClose
          ? <Btn onClick={onClose} data-testid="close-benchmark">Close</Btn>
          : <Btn onClick={() => { setOpen((o) => !o); if (!open) trackClick("FundModeling.FundConstruction.OpenBenchmark"); }} data-testid="toggle-benchmark">
              {open ? "Hide" : "Benchmark a fund"}
            </Btn>}
      </div>

      {open && history === undefined && <div style={{ ...sans, fontSize: FS.small, marginTop: 12 }}>Loading investment history…</div>}
      {open && history === null && (
        <div style={{ ...sans, fontSize: FS.small, marginTop: 12, color: "var(--ink-color-global-text-subtle)" }} data-testid="benchmark-empty">
          This dashboard doesn't have investment history yet. Click Update data (or say "refresh") to pull it from Carta.
        </div>
      )}

      {open && history && chosen && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <Dropdown testId="benchmark-fund" minWidth={260} value={chosen.id}
              options={funds.map((f) => ({ id: f.id, label: sourceLabel(f.name) }))} onChange={setFundId} />
            {parallels.length > 0 && (
              <Checkbox checked={withParallel} onChange={setWithParallel}
                label={`Include parallel funds (${parallels.map((id) => sourceLabel(snapshot.funds.find((f) => f.id === id)?.name ?? id)).join(", ")})`} />
            )}
            {plan.sectors.length > 1 && (
              <Dropdown minWidth={180} value={sector.id} options={plan.sectors.map((s) => ({ id: s.id, label: s.name }))} onChange={setSectorId} triggerLabel="Sector profile" />
            )}
          </div>

          {bench && (
            <>
              <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginBottom: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span data-testid="benchmark-summary">
                  {bench.companies} companies · first checks {fmtYm(bench.firstCheck.slice(0, 7))} to {fmtYm(bench.lastFirstCheck.slice(0, 7))} ({bench.horizonMonths} months)
                  {bench.ageYears != null && ` · ${bench.ageYears.toFixed(1)} years since first check`}
                </span>
                {bench.ageYears != null && bench.ageYears < YOUNG_YEARS && (
                  <Badge tone="warning" title="Young funds haven't had time to follow on, so follow-on rates and reserves read low.">YOUNG FUND</Badge>
                )}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="ledger" style={{ minWidth: 720 }}>
                  <thead><tr>
                    <th style={{ textAlign: "left" }}>Entry round</th><th>Companies</th><th>Typical first check</th>
                    <th>Followed on</th><th>Typical follow-on</th><th>Held for follow-ons</th><th>Share of capital</th>
                  </tr></thead>
                  <tbody>
                    {bench.byEntry.map((e) => {
                      const used = usable.includes(e);
                      return (
                        <tr key={e.round} style={{ opacity: used ? 1 : 0.55 }} title={used ? undefined : "Not turned into an allocation: fewer than 3 companies or 5% of companies, or not a round in the sector profile."}>
                          <td style={{ whiteSpace: "nowrap" }}>{e.round}{!used && <span style={{ fontSize: FS.micro, marginLeft: 6 }}>(not used)</span>}</td>
                          <td style={cellNum}>{e.companies} <span style={{ color: "var(--ink-color-global-text-subtle)" }}>({fmtPct(e.share, 0)})</span></td>
                          <td style={cellNum}>{fmtFullIn(e.medianCheck, fundCcy)}</td>
                          <td style={cellNum}>{fmtPct(e.followOnRate, 0)}</td>
                          <td style={cellNum}>{e.medianFollowOn == null ? "—" : fmtFullIn(e.medianFollowOn, fundCcy)}</td>
                          <td style={cellNum}>{fmtPct(e.reserveShare, 0)}</td>
                          <td style={cellNum}>{fmtPct(e.capitalShare, 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", marginTop: 6, maxWidth: 780 }}>
                Typical = median. The first check is everything a company received on its first investment date; later investments are follow-ons. Carta records one cost per security, so a top-up into the same SAFE or round isn't counted separately. Follow-ons are applied to the next round with a fixed amount.
              </div>
              {ccyMismatch && (
                <div role="alert" style={{ ...sans, fontSize: FS.small, marginTop: 10, color: "var(--ink-color-global-feedback-negative-strong)" }}>
                  This fund reports in {fundCcy} and the plan is in {plan.general.currency}. Pick a fund in {plan.general.currency}, or change the plan's currency on the General step, to apply it.
                </div>
              )}
              <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Btn kind="primary" data-testid="apply-benchmark" disabled={!usable.length || ccyMismatch} onClick={() => setConfirm(true)}>
                  Apply as {usable.length} allocation{usable.length === 1 ? "" : "s"}
                </Btn>
                <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
                  One allocation per entry round: {usable.map((e) => e.round).join(", ") || "none usable"}.
                </span>
              </div>
            </>
          )}
        </div>
      )}
      {confirm && (
        <ConfirmDialog title="Apply benchmark"
          message={`Replace your ${plan.allocations.length} allocation${plan.allocations.length === 1 ? "" : "s"} with ${usable.length} based on ${sourceName}?`}
          confirmLabel="Replace allocations" onConfirm={apply} onCancel={() => setConfirm(false)} />
      )}
    </div>
  );
}
