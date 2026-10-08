import { useMemo, useState } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { Btn, Checkbox, Dropdown, InfoTip, TextInput } from "../../ui/components.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { fmtMIn, fmtPct, fmtX } from "../../ui/format.js";
import { deriveGeneral, gpCommitPctOf, lpLabels, uid, validateLps } from "../../model/construction/plan.js";
import { perLp } from "../../model/construction/engine.js";
import { lpSources, lpsFromBase } from "../../model/construction/history.js";
import { useFirmData } from "../../state/FirmData.jsx";
import { trackClick } from "../../analytics.js";
import { StepHeader, AmountInput, errStyle, cellNum } from "./fields.jsx";

export default function LpsStep({ plan, update, result }) {
  const ccy = plan.general.currency;
  const { lpCommitted } = deriveGeneral(plan.general);
  const lps = plan.lps;
  const errors = validateLps(lps, lpCommitted);
  const total = lps.reduce((s, lp) => s + (lp.commitment || 0), 0);
  const gpPct = gpCommitPctOf(plan.general);
  const rows = useMemo(() => perLp(result, lps, gpPct), [result, lps, gpPct]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const anon = !!plan.lpsAnonymized;
  const labels = lpLabels(plan);
  const edit = (id, patch) => update((p) => { Object.assign(p.lps.find((x) => x.id === id), patch); });
  const add = () => update((p) => {
    const left = Math.max(0, lpCommitted - p.lps.reduce((s, lp) => s + (lp.commitment || 0), 0));
    p.lps.push({ id: uid("lp"), name: `LP ${p.lps.length + 1}`, commitment: left || null });
  });

  const { lpBase } = useFirmData();
  const [confirm, setConfirm] = useState(false);
  const [undo, setUndo] = useState(null);
  const sources = useMemo(() => lpSources(lpBase), [lpBase]);
  const [sourceId, setSourceId] = useState(() => plan.lpsSource?.fundId ?? sources[0]?.id ?? null);
  const source = sources.find((f) => f.id === sourceId) ?? sources[0];
  const fromBase = !!source && lpCommitted > 0;
  const canUndo = undo && JSON.stringify(plan.lps) === undo.after;
  const build = () => {
    trackClick("FundModeling.FundConstruction.LpsFromBase");
    const next = lpsFromBase(lpBase, lpCommitted, { fundId: source.id });
    const before = { lps: structuredClone(plan.lps), source: plan.lpsSource ?? null };
    update((p) => { p.lps = next; p.lpsSource = { fundId: source.id, name: source.name, commitment: source.commitment, asOf: lpBase.asOf ?? null }; });
    setUndo({ before, after: JSON.stringify(next) });
    setConfirm(false);
  };
  // The list came from a fund's LP mix: each LP keeps its share of that fund, so its commitment is share × this fund's LP commitments.
  const built = plan.lpsSource && lps.some((lp) => lp.share != null) ? plan.lpsSource : null;
  const offShare = built ? lps.filter((lp) => lp.share != null && Math.abs(lp.share * lpCommitted - (lp.commitment || 0)) > Math.max(1, lpCommitted * 1e-6) * 2) : [];
  const rescale = () => update((p) => {
    for (const lp of p.lps) if (lp.share != null) lp.commitment = Math.round(lp.share * lpCommitted);
    const top = p.lps.filter((lp) => lp.share != null).sort((a, b) => b.share - a.share)[0];
    if (top) top.commitment += lpCommitted - p.lps.reduce((t, lp) => t + (lp.commitment || 0), 0);
  });
  return (
    <div data-testid="lps-step">
      <StepHeader title="Limited partners (optional)">
        List the fund's LPs to see each one's projected capital calls and distributions. Without a list, all LPs are shown together. Profits are split in proportion to commitments.
      </StepHeader>
      {fromBase && (
        <div className="card" data-testid="lps-from-base" style={{ padding: "12px 16px", marginBottom: 14, ...sans, fontSize: FS.body }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, marginBottom: 2 }}>
            Build from your existing LPs
            <InfoTip portal width={300} label="About building from your LPs">
              A hypothetical list: no LP has agreed to anything. Edit, add or remove any LP afterwards.{lpBase.asOf ? ` LP data as of ${lpBase.asOf}.` : ""}
            </InfoTip>
          </div>
          <div data-testid="lps-from-base-how" style={{ color: "var(--ink-color-global-text-subtle)", marginBottom: 10, maxWidth: "75ch" }}>
            Each LP keeps its share of {source.id ? source.name : "all your funds combined"}: 10% there is 10% of this fund's {fmtMIn(lpCommitted, ccy)}, so {fmtMIn(lpCommitted * 0.1, ccy)}.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {sources.length > 1 && (
              <Dropdown testId="lps-source" triggerLabel="Copy from" minWidth={0} maxWidth={360} value={source.id}
                onChange={(id) => { trackClick("FundModeling.FundConstruction.LpsSource"); setSourceId(id); }}
                options={sources.map((f) => ({ id: f.id, label: `${f.name} · ${fmtMIn(f.commitment, f.currency)} · ${f.count} LPs`, separatorBefore: f.id == null }))} />
            )}
            <Btn onClick={() => (lps.length ? setConfirm(true) : build())} data-testid="lps-build">Build LP list ({source.count})</Btn>
            {canUndo && <Btn kind="link" onClick={() => { update((p) => { p.lps = undo.before.lps; p.lpsSource = undo.before.source; }); setUndo(null); }} data-testid="lps-undo">Undo</Btn>}
          </div>
        </div>
      )}
      {confirm && <ConfirmDialog title="Replace the LP list?" message="Your current list is replaced by one built from your existing LPs." confirmLabel="Replace list" onConfirm={build} onCancel={() => setConfirm(false)} />}
      {lps.length > 0 && (
        <div data-testid="lps-anonymize" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "0 0 10px", ...sans, fontSize: FS.body }}>
          <Checkbox checked={anon} label="Anonymize LP names"
            onChange={(v) => { trackClick(`FundModeling.FundConstruction.LpsAnonymize.${v ? "On" : "Off"}`); update((p) => { p.lpsAnonymized = v; }); }} />
          <span style={{ fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
            {anon ? "Shown as LP 1, LP 2… here and in the report. Names are kept." : "Hides names here and in the report, for sharing."}
          </span>
        </div>
      )}
      {built && (
        <div data-testid="lps-method" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "0 0 10px", maxWidth: "80ch" }}>
          Commitment = share of {built.name ?? "all your funds combined"} × {fmtMIn(lpCommitted, ccy)}.
          {offShare.length > 0 && <> {offShare.length === 1 ? "One commitment no longer matches its share" : `${offShare.length} commitments no longer match their shares`}, because it was edited or the fund size changed.{" "}
            <Btn kind="link" onClick={rescale} data-testid="lps-rescale">Recalculate from shares</Btn></>}
        </div>
      )}
      {lps.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="ledger" style={{ minWidth: 760 }}>
            <thead><tr><th style={{ textAlign: "left" }}>LP</th>{built && <th title={`Share of ${built.name ?? "all funds"}`}>Share of source</th>}<th>Commitment{ccy ? ` (${ccy})` : ""}</th><th>Called</th><th>Distributed</th><th>Remaining value</th><th>TVPI</th><th /></tr></thead>
            <tbody>
              {lps.map((lp, i) => {
                const r = byId[lp.id];
                return [
                  <tr key={lp.id} data-testid={`lp-${i}`}>
                    <td>{anon
                      ? <span data-testid={`lp-${i}-label`} style={{ ...sans, fontSize: FS.body, display: "inline-block", width: 200 }}>{labels[i]}</span>
                      : <TextInput value={lp.name} onChange={(e) => edit(lp.id, { name: e.target.value })} aria-label={`LP ${i + 1} name`} style={{ width: 200 }} />}</td>
                    {built && <td style={cellNum} data-testid={`lp-${i}-share`} title={lp.share != null ? `${fmtPct(lp.share, 2)} × ${fmtMIn(lpCommitted, ccy)} = ${fmtMIn(lp.share * lpCommitted, ccy)}` : "Added by hand"}>{lp.share != null ? fmtPct(lp.share, 2) : "—"}</td>}
                    <td><AmountInput width={140} value={lp.commitment} onChange={(v) => edit(lp.id, { commitment: v })} ariaLabel={`${labels[i]} commitment`} /></td>
                    <td style={cellNum}>{r ? fmtMIn(r.called, ccy) : "—"}</td>
                    <td style={cellNum}>{r ? fmtMIn(r.distributed, ccy) : "—"}</td>
                    <td style={cellNum}>{r ? fmtMIn(r.nav, ccy) : "—"}</td>
                    <td style={cellNum}>{r ? fmtX(r.tvpi) : "—"}</td>
                    <td><Btn kind="link" onClick={() => update((p) => { p.lps = p.lps.filter((x) => x.id !== lp.id); })} aria-label={`Remove ${labels[i]}`}>Remove</Btn></td>
                  </tr>,
                  errors[lp.id] && <tr key={`${lp.id}-e`}><td colSpan={built ? 8 : 7} style={errStyle} role="alert">{errors[lp.id]}</td></tr>,
                ];
              })}
              <tr className="totrow">
                <td>Total</td>
                {built && <td style={cellNum} data-testid="lps-share-total">{fmtPct(lps.reduce((t, lp) => t + (lp.share ?? 0), 0), 1)}</td>}
                <td style={cellNum}>{fmtMIn(total, ccy)}</td>
                <td colSpan={5} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 8 }}><Btn onClick={add} data-testid="add-lp">+ Add LP</Btn></div>
      {errors.total && (
        <div style={{ ...errStyle, marginTop: 8 }} role="alert" data-testid="lp-mismatch">
          LP commitments total {fmtMIn(total, ccy)}, but the General step has {fmtMIn(lpCommitted, ccy)} of LP commitments. Figures are split in proportion to the list either way.
        </div>
      )}
      <div style={{ ...sans, ...inkNum, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", marginTop: 10 }}>
        Each LP's figures are its share of all LP-side results. Separate fee profiles by LP class aren't modeled yet.
      </div>
    </div>
  );
}
