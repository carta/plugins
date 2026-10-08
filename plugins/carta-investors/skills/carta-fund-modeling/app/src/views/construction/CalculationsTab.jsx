import { useMemo, useState } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { Btn, Segmented, TextInput } from "../../ui/components.jsx";
import { fmtFullIn, fmtX } from "../../ui/format.js";
import { calculations, ledger, CALC_CATEGORIES } from "../../model/construction/calculations.js";
import { trackClick } from "../../analytics.js";
import { cellNum } from "./fields.jsx";

const subtle = "var(--ink-color-global-text-subtle)";
const RULE = "1px solid var(--ink-color-global-border-subtle)";
const OP_W = 22;

function Working({ item }) {
  return (
    <div data-testid={`calc-${item.id}-working`} className="calc-working">
      <div style={{ ...sans, fontSize: FS.body, margin: "0 0 10px", maxWidth: "75ch" }}>{item.formula}</div>
      <div style={{ overflowX: "auto" }}>
        <div role="table" aria-label={`Working for ${item.title}`} style={{ display: "grid", gridTemplateColumns: `${OP_W}px minmax(0, 1fr) auto`, columnGap: 12, rowGap: 4, maxWidth: 760 }}>
          {item.steps.map((s, i) => (
            <div role="row" key={i} style={{ display: "contents" }}>
              <span role="cell" style={{ ...inkNum, fontSize: FS.bodyLg, fontWeight: 600, textAlign: "center" }}>{s.op}</span>
              <span role="cell" style={{ ...sans, fontSize: FS.body }}>{s.label}</span>
              <span role="cell" style={{ ...inkNum, fontSize: FS.body, textAlign: "right", whiteSpace: "nowrap" }}>{s.value}</span>
            </div>
          ))}
          <div role="row" style={{ display: "contents" }}>
            <span role="cell" style={{ ...inkNum, fontSize: FS.bodyLg, fontWeight: 700, textAlign: "center", borderTop: RULE, paddingTop: 6 }}>=</span>
            <span role="cell" style={{ ...sans, fontSize: FS.body, fontWeight: 600, borderTop: RULE, paddingTop: 6 }}>{item.resultLabel ?? item.title}</span>
            <span role="cell" data-testid={`calc-${item.id}-result`} style={{ ...inkNum, fontSize: FS.bodyLg, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", borderTop: RULE, paddingTop: 6 }}>{item.result}</span>
          </div>
        </div>
      </div>
      {item.note && <div style={{ ...sans, fontSize: FS.small, color: subtle, marginTop: 10, maxWidth: "75ch" }}>{item.note}</div>}
    </div>
  );
}

function Item({ item, open, onToggle }) {
  const id = `calc-${item.id}`;
  return (
    <div data-testid={id} className="card" style={{ padding: 0, marginBottom: 8, overflow: "hidden" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} data-testid={`${id}-toggle`}
        style={{ ...sans, display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer", border: "none", borderRadius: 0, padding: "12px 16px",
          background: "transparent", color: "var(--ink-color-global-text-default)", fontSize: FS.bodyLg, fontWeight: 600 }}>
        <span aria-hidden="true" style={{ flex: "none", display: "inline-block", fontSize: 10, color: subtle, transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
        <span style={{ flex: 1, minWidth: 0 }}>{item.question}</span>
        <span style={{ ...inkNum, fontSize: FS.body, fontWeight: 700, whiteSpace: "nowrap" }}>{item.result}</span>
      </button>
      {open && <Working item={item} />}
    </div>
  );
}

const COLS = [
  ["called", "Capital called"], ["initial", "First checks"], ["followOn", "Follow-ons"], ["fees", "Management fees"], ["expenses", "Fund expenses"],
  ["proceeds", "Exit proceeds"], ["lpDist", "Paid to LPs"], ["gpCarry", "GP carry"], ["nav", "Portfolio value (end)"],
];

function Ledger({ plan, res }) {
  const ccy = plan.general.currency;
  const [by, setBy] = useState("year");
  const [copied, setCopied] = useState(false);
  const { rows, totals } = useMemo(() => ledger(res, plan.general.startDate, by), [res, plan.general.startDate, by]);
  if (!rows.length) return null;
  const money = (v) => (Math.abs(v) < 0.5 ? "—" : fmtFullIn(v, ccy));
  const head = [by === "year" ? "Year" : "Quarter", ...COLS.map(([, l]) => l), "DPI", "TVPI"];
  const line = (r) => [r.label, ...COLS.map(([k]) => Math.round(r[k])), r.dpi == null ? "" : r.dpi.toFixed(4), r.tvpi == null ? "" : r.tvpi.toFixed(4)];
  const copy = async () => {
    trackClick("FundModeling.FundConstruction.Calculations.CopyLedger");
    const text = [head, ...rows.map(line), line({ ...totals, label: "Total" })].map((r) => r.join("\t")).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <div className="card" data-testid="calc-ledger" style={{ padding: "14px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <span style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>Cash-flow ledger</span>
        <span style={{ flex: 1 }} />
        <Segmented small value={by} onChange={setBy} options={[{ id: "year", label: "By year", testId: "ledger-by-year" }, { id: "quarter", label: "By quarter", testId: "ledger-by-quarter" }]} />
        <Btn onClick={copy} data-testid="ledger-copy">{copied ? "Copied" : "Copy table"}</Btn>
      </div>
      <div style={{ ...sans, fontSize: FS.small, color: subtle, marginBottom: 10, maxWidth: "75ch" }}>
        Every flow the model uses, in {ccy}. The totals row ties to the headline figures. Copy table pastes into a spreadsheet with full precision.
      </div>
      <div style={{ overflow: "auto", maxHeight: 460 }}>
        <table className="ledger" data-testid="calc-ledger-table" style={{ minWidth: 1100 }}>
          <thead><tr>{head.map((h, i) => <th key={h} style={{ textAlign: i ? undefined : "left", position: "sticky", top: 0, background: "var(--ink-color-global-surface-background-default)" }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}><td>{r.label}</td>{COLS.map(([k]) => <td key={k} style={cellNum}>{money(r[k])}</td>)}<td style={cellNum}>{fmtX(r.dpi)}</td><td style={cellNum}>{fmtX(r.tvpi)}</td></tr>
            ))}
            <tr data-testid="calc-ledger-total" style={{ fontWeight: 700 }}>
              <td>Total</td>{COLS.map(([k]) => <td key={k} style={cellNum}>{money(totals[k])}</td>)}<td style={cellNum}>{fmtX(totals.dpi)}</td><td style={cellNum}>{fmtX(totals.tvpi)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CSS = `
.calc-working { padding: 0 16px 14px 38px; }
@container (max-width: 520px) { .calc-working { padding: 0 12px 14px 12px; } }
`;

export default function CalculationsTab({ plan, res }) {
  const items = useMemo(() => calculations(plan, res), [plan, res]);
  const [view, setView] = useState("how");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set(["tvpi"]));
  const q = query.trim().toLowerCase();
  const text = (i) => `${i.title} ${i.question} ${i.formula} ${i.note ?? ""} ${i.steps.map((s) => s.label).join(" ")}`.toLowerCase();
  const shown = items.filter((i) => (category === "all" || i.category === category) && (!q || text(i).includes(q)));
  const counts = Object.fromEntries(CALC_CATEGORIES.map((c) => [c.id, items.filter((i) => i.category === c.id).length]));
  const allOpen = shown.length > 0 && shown.every((i) => open.has(i.id));
  const toggle = (id) => setOpen((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const chip = (id, label, n) => {
    const on = category === id;
    return (
      <button key={id} type="button" aria-pressed={on} onClick={() => setCategory(id)} data-testid={`calc-cat-${id}`}
        style={{ ...sans, fontSize: FS.body, padding: "5px 12px", borderRadius: 16, cursor: "pointer",
          border: `1px solid ${on ? "var(--ink-color-global-border-active)" : "var(--ink-color-global-border-subtle)"}`,
          background: on ? "var(--ink-color-global-surface-lightgray-default)" : "transparent", color: on ? "var(--ink-color-global-text-default)" : subtle }}>
        {label} <span style={{ opacity: 0.7 }}>{n}</span>
      </button>
    );
  };
  return (
    <div data-testid="mv-panel-math">
      <style>{CSS}</style>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ ...sans, fontSize: FS.body, color: subtle, flex: "1 1 320px", maxWidth: "75ch" }}>
          How every figure in this model is worked out, step by step with this plan's own numbers, so you can check any of it by hand.
        </div>
        <Segmented small value={view} onChange={(v) => { trackClick(`FundModeling.FundConstruction.Calculations.View.${v}`); setView(v); }}
          options={[{ id: "how", label: "How it's calculated", testId: "calc-view-how" }, { id: "ledger", label: "Cash-flow ledger", testId: "calc-view-ledger" }]} />
      </div>
      {view === "ledger" ? <Ledger plan={plan} res={res} /> : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            {chip("all", "All", items.length)}
            {CALC_CATEGORIES.filter((c) => counts[c.id] > 0).map((c) => chip(c.id, c.label, counts[c.id]))}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search, e.g. IRR, fees, ownership" aria-label="Search calculations" data-testid="calc-search" style={{ flex: "1 1 260px", maxWidth: 420 }} />
            <Btn onClick={() => setOpen(allOpen ? new Set([...open].filter((id) => !shown.some((i) => i.id === id))) : new Set([...open, ...shown.map((i) => i.id)]))} data-testid="calc-toggle-all">
              {allOpen ? "Collapse all" : "Expand all"}
            </Btn>
            <span data-testid="calc-count" style={{ ...sans, fontSize: FS.small, color: subtle }}>{shown.length} of {items.length} calculations</span>
          </div>
          {shown.length === 0
            ? <div data-testid="calc-empty" style={{ ...sans, color: subtle }}>No calculations match. Try a different word or category.</div>
            : shown.map((i) => <Item key={i.id} item={i} open={open.has(i.id)} onToggle={() => toggle(i.id)} />)}
        </>
      )}
    </div>
  );
}
