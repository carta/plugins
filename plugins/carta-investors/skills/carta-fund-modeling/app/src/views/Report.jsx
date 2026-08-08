// Scenario Report — a side-by-side comparison of selected scenarios' outputs and a
// printable ("Save as PDF") report. All figures come from the pure report model
// (src/model/report.js), computed for each selected slice with no active-scenario
// switch. The printable version is a #print-report subtree portaled to
// document.body (a sibling of #app-screen) so the @media print CSS reveals it
// while hiding the app chrome.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { tightSans, sans, inkNum, FS, MICRO } from "../ui/theme.js";
import { fmtM, fmtX, fmtPct, fmtAsOf, displayCurrency } from "../ui/format.js";
import { H1, H3, Btn, Eyebrow, MethodNote, SourceNote, LockIcon, fundLabel, MultiFundPicker } from "../ui/components.jsx";
import { buildReport } from "../model/report.js";
import { BASELINE_ID } from "../model/slices.js";
import { trackClick } from "../analytics.js";

// Comparison metric rows. `delta:true` → show the vs-Baseline change beneath the
// value (skipped for the Baseline column). `money` rows blank to "—" for a
// mixed-currency firm; x/count rows are currency-neutral and always shown.
const METRICS = [
  { key: "lpNav", label: "LP NAV", kind: "money", delta: true },
  { key: "tvpi", label: "TVPI", kind: "x", delta: true },
  { key: "dpi", label: "DPI", kind: "x", delta: true },
  { key: "gpCarry", label: "GP carry", kind: "money", delta: true },
  { key: "lpDistributed", label: "LP distributions", kind: "money", delta: true },
  { key: "dryPowder", label: "Dry powder", kind: "money", delta: false },
  { key: "newDealCapacity", label: "New-deal capacity", kind: "money", delta: false },
  { key: "newDeals", label: "New deals fundable", kind: "count", delta: false },
];

// Per-entity metrics the by-entity breakdown can show, user-selectable. `money`
// rows blank to "—" for a mixed-currency firm; x/pct/count are currency-neutral.
const FUND_METRICS = [
  { key: "lpNav", label: "LP NAV", kind: "money" },
  { key: "grossMoic", label: "MOIC", kind: "x" },
  { key: "tvpi", label: "TVPI", kind: "x" },
  { key: "dpi", label: "DPI", kind: "x" },
  { key: "netLpIrr", label: "Net IRR", kind: "pct" },
  { key: "gpCarry", label: "GP carry", kind: "money" },
  { key: "committed", label: "Committed", kind: "money" },
  { key: "lpDistributed", label: "LP distributions", kind: "money" },
];
const DEFAULT_FUND_METRICS = ["lpNav", "grossMoic", "dpi"];

const fmtVal = (v, kind, mixed) => {
  if (kind === "count") return String(v);
  if (v == null) return "—";
  if (mixed && kind === "money") return "—";
  if (kind === "x") return fmtX(v);
  if (kind === "pct") return fmtPct(v);
  return fmtM(v);
};
const fmtDelta = (d, kind) => {
  const sign = d >= 0 ? "+" : "−";
  const mag = Math.abs(d);
  return kind === "x" ? `${sign}${mag.toFixed(2)}×` : `${sign}${fmtM(mag)}`;
};
// epsilon below which a delta is treated as no-change (per metric kind)
const EPS = { money: 0.5, x: 0.005 };

function ScenarioHead({ s }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
      {s.locked ? <LockIcon size={11} strokeWidth={2} />
        : s.color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flex: "none" }} />}
      {s.name}
    </span>
  );
}

// The comparison grid + per-fund breakdown + what-differs — shared verbatim by the
// on-screen view and the printable subtree so they can never drift.
function ReportBody({ report, funds, metrics }) {
  const { summaries, diffs, fundOrder } = report;
  const mixed = summaries.some((s) => s.mixedCurrency);
  const numTd = { ...inkNum, textAlign: "right", fontSize: FS.value, whiteSpace: "nowrap" };
  // fall back to the full set when the caller doesn't drive the selectors (e.g. tests)
  const showFunds = funds ?? fundOrder;
  const showMetrics = metrics ?? FUND_METRICS.filter((m) => DEFAULT_FUND_METRICS.includes(m.key));
  const moneyMetricHidden = mixed && showMetrics.some((m) => m.kind === "money");

  return (
    <div>
      {/* ── firm-level totals: scenarios as columns, metrics as rows ── */}
      <H3 as="div" style={{ marginBottom: 6 }}>Firm-level totals</H3>
      <table className="ledger" style={{ marginTop: 4 }}>
        <thead>
          <tr>
            <th style={{ ...sans, textAlign: "left" }}>Metric</th>
            {summaries.map((s) => (
              <th key={s.id} style={{ ...sans, textAlign: "right" }}><ScenarioHead s={s} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m.key}>
              <td style={{ whiteSpace: "nowrap" }}>{m.label}</td>
              {summaries.map((s) => {
                const d = m.delta ? s[`${m.key}Delta`] : null;
                const showD = m.delta && !s.locked && d != null && Math.abs(d) > (EPS[m.kind] ?? 0) && !(mixed && m.kind === "money");
                return (
                  <td key={s.id} style={numTd}>
                    <div style={{ fontWeight: 600 }}>{fmtVal(s[m.key], m.kind, mixed)}</div>
                    {showD && (
                      <div style={{ ...inkNum, fontSize: FS.micro, fontWeight: 600, color: d >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>{fmtDelta(d, m.kind)}</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ ...sans, fontSize: FS.micro, color: MICRO, marginTop: 6 }}>
        Deltas are vs the Baseline scenario. {mixed ? "Firm $ totals are hidden — this firm's funds report in multiple currencies (TVPI/DPI/deal counts are currency-neutral)." : `Amounts in ${displayCurrency()}.`}
      </div>

      {/* ── per-entity breakdown: caller picks which entities + which metrics ── */}
      {showFunds.length > 0 && showMetrics.length > 0 && (
        <div className="report-block" style={{ marginTop: 20, breakInside: "avoid" }}>
          <H3 as="div" style={{ marginBottom: 6 }}>By entity</H3>
          <table className="ledger">
            <thead>
              <tr>
                <th style={{ ...sans, textAlign: "left" }}>Entity</th>
                <th style={{ ...sans, textAlign: "left" }}>Metric</th>
                {summaries.map((s) => <th key={s.id} style={{ ...sans, textAlign: "right" }}><ScenarioHead s={s} /></th>)}
              </tr>
            </thead>
            <tbody>
              {showFunds.map((f) =>
                showMetrics.map((m, mi) => {
                  const last = mi === showMetrics.length - 1;
                  return (
                    // no inter-metric rules; one divider per entity group (last sub-row)
                    <tr key={`${f.id}:${m.key}`} style={{ borderBottom: last ? `1px solid var(--ink-color-global-border-subtle)` : "none" }}>
                      {mi === 0 && (
                        <td rowSpan={showMetrics.length} style={{ whiteSpace: "nowrap", verticalAlign: "top", fontWeight: 600 }}>
                          {fundLabel(f.name)}
                        </td>
                      )}
                      {/* pin left padding: on rows after LP NAV this cell becomes
                          :first-child, which .ledger pads to 2px — that would misalign
                          the metric labels under the header. Keep it constant. */}
                      <td style={{ whiteSpace: "nowrap", color: "var(--ink-color-global-text-subtle)", paddingLeft: 12 }}>{m.label}</td>
                      {summaries.map((s) => {
                        const pf = s.perFund.find((x) => x.id === f.id);
                        return <td key={s.id} style={numTd}>{pf ? fmtVal(pf[m.key], m.kind, mixed) : "—"}</td>;
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div style={{ ...sans, fontSize: FS.micro, color: MICRO, marginTop: 6 }}>
            {moneyMetricHidden ? "Currency ($) metrics are hidden — this firm's funds report in multiple currencies. " : ""}
            Per-entity metrics across the selected scenarios.
          </div>
        </div>
      )}

      {/* ── what differs vs Baseline ── */}
      {summaries.some((s) => !s.locked) && (
        <div className="report-block" style={{ marginTop: 20, breakInside: "avoid" }}>
          <H3 as="div" style={{ marginBottom: 6 }}>What differs</H3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {summaries.filter((s) => !s.locked).map((s) => (
              <div key={s.id} style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-default)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                  {s.color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flex: "none" }} />}
                  {s.name}
                </span>
                <span style={{ color: "var(--ink-color-global-text-subtle)" }}> — {(diffs[s.id] || []).join(" · ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// scenario chip — a click toggles it in/out of the report
function ScenarioChip({ s, on, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      style={{ ...sans, fontSize: FS.body, fontWeight: on ? 600 : 500, padding: "6px 12px", borderRadius: 4,
        border: `1px solid ${on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-border-subtle)"}`, cursor: "pointer", whiteSpace: "nowrap",
        background: on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-surface-background-default)", color: on ? "var(--ink-color-global-surface-background-default)" : "var(--ink-color-global-text-subtle)",
        display: "inline-flex", alignItems: "center", gap: 6 }}>
      {s.locked ? <LockIcon size={11} strokeWidth={2} />
        : s.color && <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flex: "none" }} />}
      {s.name}
    </button>
  );
}

export default function Report({ doc, snapshot, baseSlice }) {
  // Baseline (locked) first, then the rest in doc order.
  const slices = useMemo(() => {
    const list = doc.slices || [];
    const base = list.filter((s) => s.locked || s.id === BASELINE_ID);
    const rest = list.filter((s) => !(s.locked || s.id === BASELINE_ID));
    return [...base, ...rest];
  }, [doc.slices]);

  const [selected, setSelected] = useState(() => new Set(slices.map((s) => s.id))); // default: all
  const chosen = slices.filter((s) => selected.has(s.id));
  const toggle = (id) => {
    trackClick("FundModeling.Export.ToggleScenario");
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const allOn = chosen.length === slices.length;

  const report = useMemo(
    () => (chosen.length ? buildReport(snapshot, chosen, baseSlice) : null),
    [snapshot, chosen, baseSlice]
  );

  // ── by-entity controls ── which entities + which metrics the breakdown shows.
  // `entitySel === null` means "all" (survives fundOrder changing as scenarios toggle);
  // once the user picks, it becomes a concrete Set. Metrics default to a small core set.
  const funds = report?.fundOrder ?? [];
  const [entitySel, setEntitySel] = useState(null);
  const [metricSel, setMetricSel] = useState(() => new Set(DEFAULT_FUND_METRICS));
  const entitySelSet = entitySel ?? new Set(funds.map((f) => f.id));
  const shownFunds = entitySel ? funds.filter((f) => entitySel.has(f.id)) : funds;
  const shownMetrics = FUND_METRICS.filter((m) => metricSel.has(m.key));
  const metricOpts = FUND_METRICS.map((m) => ({ id: m.key, name: m.label }));

  const firmName = snapshot.branding?.firmName ?? snapshot.source.firm;
  const asOf = fmtAsOf(snapshot.source.navAsOf);

  return (
    <div>
      <H1>Export scenarios</H1>
      <MethodNote>
        Compare scenarios side by side and export a PDF. Pick the scenarios to include, then <strong>Download PDF</strong> (choose “Save as PDF” in the print dialog). Metrics are computed per scenario from Carta Fund Admin data; deltas are vs the Baseline.
      </MethodNote>

      {/* scenario selector + download */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "4px 0 18px" }}>
        <Eyebrow color={MICRO} style={{ marginRight: 2 }}>Scenarios</Eyebrow>
        {slices.map((s) => <ScenarioChip key={s.id} s={s} on={selected.has(s.id)} onClick={() => toggle(s.id)} />)}
        {!allOn && (
          <Btn kind="link" onClick={() => { trackClick("FundModeling.Export.SelectAllScenarios"); setSelected(new Set(slices.map((s) => s.id))); }}
            style={{ fontSize: FS.small, color: "var(--ink-button-background-color-primary-base-default)" }}>
            Select all
          </Btn>
        )}
        <span style={{ flex: 1 }} />
        <Btn kind="primary" onClick={() => { trackClick("FundModeling.Export.DownloadPdfClick"); window.print(); }} data-testid="download-pdf"
          disabled={!report}>Download PDF</Btn>
      </div>

      {/* by-entity breakdown controls — which entities + which metrics to show */}
      {report && funds.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 16px" }}>
          <Eyebrow color={MICRO} style={{ marginRight: 2 }}>By entity</Eyebrow>
          <MultiFundPicker funds={funds} selected={entitySelSet} onChange={setEntitySel} label="entities" align="left" />
          <MultiFundPicker funds={metricOpts} selected={metricSel} onChange={setMetricSel} label="metrics" align="left" />
        </div>
      )}

      {report ? <ReportBody report={report} funds={shownFunds} metrics={shownMetrics} />
        : <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", padding: "16px 0" }}>Select at least one scenario to compare.</div>}

      <SourceNote>
        Source: Carta Fund Admin. LP NAV / TVPI / DPI / GP carry from the per-fund waterfall at each scenario's marks; dry powder and new-deal capacity from committed − fees − invested. A planning estimate — not Carta's official books.
      </SourceNote>

      {/* Printable report — portaled to document.body so it's a sibling of
          #app-screen; the @media print CSS hides the chrome and reveals this. */}
      {report && createPortal(
        <div id="print-report">
          <div style={{ marginBottom: 14, borderBottom: `2px solid var(--ink-color-global-text-default)`, paddingBottom: 10 }}>
            <div style={{ ...tightSans, fontSize: FS.h2, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{firmName} — Fund modeling</div>
            <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", marginTop: 3 }}>
              Data as of {asOf} · {chosen.length} scenario{chosen.length === 1 ? "" : "s"}: {chosen.map((s) => s.name).join(", ")}
            </div>
          </div>
          <ReportBody report={report} funds={shownFunds} metrics={shownMetrics} />
          <div style={{ ...sans, fontSize: FS.micro, color: MICRO, marginTop: 18, borderTop: `1px solid var(--ink-color-global-border-subtle)`, paddingTop: 8 }}>
            Carta Fund Modeling · scenario planning estimate, not official books · generated from Carta Fund Admin data.
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
