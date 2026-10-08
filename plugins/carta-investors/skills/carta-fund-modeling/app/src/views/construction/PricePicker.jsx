import { useRef, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { MenuItem, ChevronDownIcon, POPOVER_SHADOW, useDismissable } from "../../ui/components.jsx";
import { fmtMIn, fmtPct } from "../../ui/format.js";
import { defaultMarket, marketStages } from "../../model/construction/market.js";
import { findValuationBenchmark } from "../../model/construction/valuationBenchmarks.js";
import { cellNum } from "./fields.jsx";

const subtle = { color: "var(--ink-color-global-text-subtle)" };

/** Size, price and dilution of every round under one price choice ("default" or a benchmark id). */
export function priceRows(id) {
  const bench = findValuationBenchmark(id);
  return marketStages({ ...defaultMarket(), prices: id }).map((s) => {
    const b = bench?.rounds[s.name];
    const post = b ? b.postMoney : s.roundSize + s.preMoney;
    return { name: s.name, roundSize: s.roundSize, preMoney: s.preMoney, post, dilution: b ? b.dilution : s.roundSize / post, fromDefault: !!bench && !b };
  });
}

export function PreviewTable({ id, label, ccy, testId }) {
  const rows = priceRows(id);
  return (
    <div data-testid={testId} style={{ minWidth: 0 }}>
      <div style={{ ...sans, fontSize: FS.body, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <table className="ledger" style={{ width: "100%" }}>
        <thead><tr><th style={{ textAlign: "left" }}>Round</th><th>Round size</th><th>Pre-money</th><th>Post-money</th><th>Dilution</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}{r.fromDefault ? <span style={subtle}> *</span> : null}</td>
            <td style={cellNum}>{fmtMIn(r.roundSize, ccy)}</td>
            <td style={cellNum}>{fmtMIn(r.preMoney, ccy)}</td>
            <td style={cellNum}>{fmtMIn(r.post, ccy)}</td>
            <td style={cellNum}>{fmtPct(r.dilution, 1)}</td>
          </tr>
        ))}</tbody>
      </table>
      {rows.some((r) => r.fromDefault) && <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 6 }}>* Not in the benchmark, so it keeps the app's default.</div>}
    </div>
  );
}

/** `options` is [{ id, label }]; `canApply(id)` false greys a choice out (e.g. USD-only benchmarks on a euro plan). */
export default function PricePicker({ options, value, onChange, canApply = () => true, ccy, testId }) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(null);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  const shown = options.find((o) => o.id === (peek ?? value)) ?? options[0];
  const current = options.find((o) => o.id === value) ?? options[0];
  const close = () => { setOpen(false); setPeek(null); };
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
      <button type="button" onClick={() => (open ? close() : setOpen(true))} aria-haspopup="listbox" aria-expanded={open} data-testid={testId}
        className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...sans, display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 260, maxWidth: "100%", boxSizing: "border-box",
          minHeight: 36, padding: "0 12px", fontSize: 14, fontWeight: 500, cursor: "pointer", borderRadius: 4,
          border: "1px solid var(--ink-color-global-border-default)", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current.label}</span>
        <ChevronDownIcon size={16} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="popin" data-testid="price-popover" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50, display: "flex", flexWrap: "wrap", alignItems: "flex-start",
          width: "min(760px, 92vw)", maxHeight: 420, overflowY: "auto", background: "var(--ink-color-global-surface-background-default)",
          border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 6, boxShadow: POPOVER_SHADOW }}>
          <div role="listbox" aria-label="Round sizes and valuations" onMouseLeave={() => setPeek(null)} style={{ flex: "0 0 240px", padding: "4px 0" }}>
            {options.map((o) => {
              const ok = canApply(o.id);
              return (
                <div key={o.id} onMouseEnter={() => setPeek(o.id)} onFocus={() => setPeek(o.id)} title={ok ? undefined : "Benchmarks are in USD, so they can't be applied to this plan"}>
                  <MenuItem selected={o.id === value} checkmark style={{ opacity: ok ? 1 : 0.5, cursor: ok ? "pointer" : "not-allowed", whiteSpace: "normal" }}
                    onClick={() => { if (!ok) return; onChange(o.id); close(); }}>
                    {o.label}
                  </MenuItem>
                </div>
              );
            })}
          </div>
          <div style={{ flex: "1 1 360px", minWidth: 0, padding: "12px 16px", borderLeft: "1px solid var(--ink-color-global-border-subtle)" }}>
            <PreviewTable id={shown.id} label={`Preview: ${shown.label}`} ccy={ccy} testId="price-preview" />
            <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 8 }}>Click a choice to apply it to the table.</div>
          </div>
        </div>
      )}
    </div>
  );
}
