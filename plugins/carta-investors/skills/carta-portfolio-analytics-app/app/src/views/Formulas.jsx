// Custom metrics builder: define a metric from KPI arithmetic, preview it, and
// assign it to companies with per-company overrides. Saved metrics flow into
// every view as derived KPIs. Safe parser, no eval() — see model/formula.js.
import { useMemo, useState } from "react";
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { withCommas } from "../ui/format.js";
import { H2, Dropdown, Segmented, TextInput, Btn, Badge } from "../ui/components.jsx";
import Chart, { fmtVal } from "../ui/charts.jsx";
import { compile, resolveRefs, formulaSeries, formulaLatest } from "../model/formula.js";
import { metricOf, metricOptions, numericMetrics } from "../model/kpi.js";
import {
  listOf, addMetric, updateMetric, removeMetric, effectiveExpr, isAssigned, nextMetricId,
} from "../model/customMetrics.js";
import Covenants from "./Covenants.jsx";
import AssignPanel from "./AssignPanel.jsx";
import { trackClick } from "../analytics.js";

const UNITS = [{ id: "Number", label: "Number" }, { id: "Dollar", label: "$" }, { id: "Percentage", label: "%" }, { id: "Ratio", label: "×" }];
const OPS = ["+", "−", "×", "÷", "(", ")"];

const FUNC_TIPS = {
  "yoy(": "Change versus ~12 months earlier, as a fraction. Wrap a KPI: yoy({Revenue})",
  "prior(": "The value ~12 months earlier. Wrap a KPI: prior({Revenue})",
  "ltm(": "Last twelve months: the trailing year summed, for a flow KPI like Revenue or EBITDA. Blank until a full year is reported. Wrap a KPI: ltm({Revenue})",
};

/** One-click starting points, each offered only when the firm reports its inputs. */
const PRESETS = [
  { name: "Rule of 40", unit: "Percentage", expr: "yoy({Revenue}) + {EBITDA} ÷ {Revenue}",
    note: "Revenue growth % + EBITDA margin %. The classic test of whether growth is worth what it costs — 40% or better is the benchmark." },
  { name: "Gross margin", unit: "Percentage", expr: "{Gross Profit} ÷ {Revenue}",
    note: "What's left after the direct cost of delivering the product." },
  { name: "Revenue per employee", unit: "Dollar", expr: "{Revenue} ÷ {Headcount}",
    note: "Whether a company is scaling or just hiring." },
  { name: "Runway (months)", unit: "Number", expr: "{Cash and Cash Equivalents} ÷ −{Change in Cash}",
    note: "Cash on hand ÷ the rate it's being consumed. Negative or blank means the company isn't burning." },
];

function fmtOut(v, unit) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "Ratio") return v.toFixed(2) + "×";
  if (unit === "Percentage") return withCommas((v * 100).toFixed(1)) + "%";
  return fmtVal(v, unit);
}

/** How a metric's assignment reads at a glance. */
function scopeSummary(f, total) {
  const overrides = Object.keys(f.overrides || {}).length;
  const assigned = f.scope == null || f.scope === "all" ? total : (Array.isArray(f.scope) ? f.scope.length : 0);
  const base = assigned >= total ? "All companies" : `${assigned} of ${total} companies`;
  return overrides ? `${base} · ${overrides} custom` : base;
}

/** The custom-metric builder card: inputs, inserters, live validation, and Save.
 *  Shared by `CustomFormulas` (add/edit) and `NewFormulaModal` (add-only).
 *  With `initial`, Save updates that row instead of adding one — pass a `key`
 *  tied to its id so the caller gets fresh fields on a new edit target.
 *  `onSaved(id)` gets the new or updated row's id. */
export function FormulaEditor({ data, dashboard, onSaved, initial = null, onCancel }) {
  const metrics = numericMetrics(data.metrics);
  const formulas = listOf(dashboard.doc);
  const editingId = initial ? initial.id : null;

  const [name, setName] = useState(initial ? initial.name : "");
  const [expr, setExpr] = useState(initial ? (initial.expr || "") : "");
  const [unit, setUnit] = useState(initial ? (initial.unit || "Number") : "Number");
  const [attempted, setAttempted] = useState(false); // a Save click happened while the form was invalid

  const compiled = useMemo(() => compile(expr), [expr]);
  const resolved = useMemo(() => resolveRefs(compiled.refs, metrics), [compiled, metrics]);
  const nameTaken = useMemo(
    () => formulas.some((f) => f.id !== editingId && f.name.trim().toLowerCase() === name.trim().toLowerCase()),
    [formulas, editingId, name],
  );
  const valid = !compiled.error && compiled.fn && resolved.unknown.length === 0 && name.trim().length > 0 && !nameTaken;

  // Per-field errors: filled-but-wrong states show live; empty required fields
  // only flag after a Save attempt, so an untouched form doesn't open with errors.
  const nameError = nameTaken ? `A KPI named “${name.trim()}” already exists.`
    : attempted && !name.trim() ? "Name is required" : null;
  const exprError = compiled.error ? compiled.error
    : resolved.unknown.length ? `Unknown KPI: ${resolved.unknown.join(", ")}`
    : attempted && !expr.trim() ? "Formula is required" : null;

  const preview = useMemo(() => {
    if (compiled.error || !compiled.fn || resolved.unknown.length) return null;
    const rows = [];
    for (const c of data.companies || []) {
      const l = formulaLatest(c, compiled, resolved.map);
      if (l) rows.push({ name: c.name, v: l.v, d: l.d });
    }
    rows.sort((a, b) => b.v - a.v);
    return rows;
  }, [data, compiled, resolved]);

  const presets = useMemo(() => PRESETS.filter((p) => {
    const c = compile(p.expr);
    return !c.error && resolveRefs(c.refs, metrics).unknown.length === 0;
  }), [metrics]);

  const insert = (s) => setExpr((e) => e + (e && !/[\s(]$/.test(e) ? " " : "") + s);
  const loadPreset = (p) => { setName(p.name); setExpr(p.expr); setUnit(p.unit); };
  const save = () => {
    if (!valid) { setAttempted(true); return; }
    setAttempted(false);
    if (editingId) {
      dashboard.update((d) => updateMetric(d, editingId, { name: name.trim(), expr, unit }));
      onSaved?.(editingId);
      return;
    }
    const id = nextMetricId(dashboard.doc, name.trim());
    let ok = false;
    dashboard.update((d) => {
      const next = addMetric(d, { name: name.trim(), expr, unit });
      if (next) ok = true;
      return next;
    });
    setName(""); setExpr(""); setUnit("Number");
    if (ok) onSaved?.(id);
  };

  return (
    <div className="card" style={{ padding: 18 }}>
      {presets.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>Start from:</span>
          {presets.map((p, i) => (
            <button key={p.name} onClick={() => loadPreset(p)} data-tip={`${p.note}\n\n${p.expr}`}
              style={{ ...sans, fontSize: FS.small, fontWeight: i === 0 ? 700 : 500, padding: "5px 11px", borderRadius: 6,
                cursor: "pointer", border: `1px solid var(--ink-color-global-border-default)`,
                background: i === 0 ? "var(--accent-soft)" : "var(--ink-color-global-surface-background-default)",
                color: "var(--ink-color-global-text-default)" }}>{p.name}</button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <TextInput placeholder="KPI name (e.g. EBITDA)" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 240 }} />
          {nameError && <span style={errText}>* {nameError}</span>}
        </div>
        <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>Result format:</span>
        <Segmented small options={UNITS} value={unit} onChange={setUnit} />
      </div>

      <TextInput placeholder="yoy({Revenue}) + {EBITDA} ÷ {Revenue}" value={expr} onChange={(e) => setExpr(e.target.value)}
        style={{ width: "100%", fontFamily: mono.fontFamily, marginBottom: exprError ? 4 : 10 }} />
      {exprError && <div style={{ ...errText, marginBottom: 10 }}>* {exprError}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <Dropdown options={metricOptions(metrics)} value={null} nullLabel="Insert KPI…" minWidth={190}
          onChange={(key) => insert(`{${(metricOf(data, key) || {}).label}}`)} />
        {OPS.map((op) => (
          <button key={op} onClick={() => insert(op)} style={opBtn}>{op}</button>
        ))}
        {["yoy(", "prior(", "ltm("].map((f) => (
          <button key={f} onClick={() => insert(f)} data-tip={FUNC_TIPS[f]}
            style={{ ...opBtn, width: "auto", padding: "0 10px", fontSize: FS.small }}>{f} )</button>
        ))}
        <button onClick={() => setExpr((e) => e.replace(/\s*\S+\s*$/, ""))} style={{ ...opBtn, width: "auto", padding: "0 10px" }}>⌫</button>
        <button onClick={() => setExpr("")} style={{ ...opBtn, width: "auto", padding: "0 10px" }}>Clear</button>
      </div>

      <div style={{ minHeight: 22, marginBottom: 10 }}>
        {preview && (
          <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>
            Evaluates for <strong style={{ color: "var(--ink-color-global-text-default)" }}>{preview.length}</strong> companies
            {preview.length > 0 && (() => { const m = preview[Math.floor(preview.length / 2)]; return (
              <> · typical value {m.name}: <strong style={{ color: "var(--ink-color-global-text-default)", ...mono }}>{fmtOut(m.v, unit)}</strong></>
            ); })()}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Btn kind="primary" onClick={() => { trackClick("PortfolioAnalytics.Formulas.SaveMetric"); save(); }}>{editingId ? "Update KPI" : "Save KPI"}</Btn>
        {editingId && onCancel && <Btn onClick={onCancel}>Cancel</Btn>}
        {attempted && !valid && <span style={errText}>⚠ Fix the highlighted fields to save</span>}
      </div>
    </div>
  );
}

function CustomFormulas({ data, dashboard }) {
  const metrics = numericMetrics(data.metrics);
  const formulas = listOf(dashboard.doc);
  const total = (data.companies || []).length;

  const [editing, setEditing] = useState(null); // the row being edited, or null while creating
  const [assignId, setAssignId] = useState(null);

  const remove = (id) => dashboard.update((d) => removeMetric(d, id));
  const assignFormula = formulas.find((f) => f.id === assignId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <FormulaEditor key={editing ? editing.id : "new"} data={data} dashboard={dashboard} initial={editing}
        onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />

      {/* saved metrics */}
      {formulas.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center", color: MICRO, ...sans }}>No saved KPIs yet. Build one above and hit Save.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {formulas.map((f) => (
            <FormulaCard key={f.id} f={f} data={data} metrics={metrics} total={total}
              onEdit={() => setEditing(f)} onAssign={() => setAssignId(f.id)} onDelete={() => remove(f.id)} />
          ))}
        </div>
      )}

      {assignFormula && (
        <AssignPanel data={data} dashboard={dashboard} metrics={metrics} formula={assignFormula} onClose={() => setAssignId(null)} />
      )}
    </div>
  );
}

function FormulaCard({ f, data, metrics, total, onEdit, onAssign, onDelete }) {
  const unit = f.unit || "Number";
  const [chartCo, setChartCo] = useState(null);
  const companies = data.companies || [];

  // Evaluate every assigned company with its OWN effective expression (override or default).
  const rows = useMemo(() => {
    const out = [];
    for (const c of companies) {
      if (!isAssigned(f, c.id)) continue;
      const ex = effectiveExpr(f, c.id);
      if (!ex) continue;
      const compiled = compile(ex);
      if (compiled.error || !compiled.fn) continue;
      const resolved = resolveRefs(compiled.refs, metrics);
      if (resolved.unknown.length) continue;
      const l = formulaLatest(c, compiled, resolved.map);
      if (l) out.push({ id: c.id, name: c.name, v: l.v, d: l.d, custom: !!(f.overrides || {})[c.id] });
    }
    return out.sort((a, b) => b.v - a.v);
  }, [companies, f, metrics]);

  const coId = chartCo || (rows[0] && rows[0].id);
  const company = companies.find((c) => c.id === coId);
  const series = useMemo(() => {
    if (!company) return [];
    const ex = effectiveExpr(f, company.id);
    const compiled = compile(ex);
    const resolved = resolveRefs(compiled.refs, metrics);
    if (compiled.error || resolved.unknown.length) return [];
    return formulaSeries(company, compiled, resolved.map);
  }, [company, f, metrics]);

  // The card and the table it belongs to are one unit, so they sit closer together
  // (12) than the 20px gap that separates one saved metric from the next.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ ...sans, fontSize: FS.h3, fontWeight: 600 }}>{f.name}</div>
          {f.expr ? <code style={code}>{f.expr}</code> : <span style={{ ...sans, fontSize: FS.small, color: MICRO, fontStyle: "italic" }}>per-company formulas</span>}
          <Badge tone="muted">{UNITS.find((u) => u.id === unit)?.label || unit}</Badge>
          <Badge tone="muted">{scopeSummary(f, total)}</Badge>
          <span style={{ flex: 1 }} />
          <Btn onClick={onAssign} style={{ height: "auto", padding: "5px 11px", fontSize: FS.small }}>Assign to companies</Btn>
          <Btn onClick={onEdit} style={{ height: "auto", padding: "5px 11px", fontSize: FS.small }}>Edit</Btn>
          <Btn kind="danger" onClick={onDelete} style={{ height: "auto", padding: "5px 11px", fontSize: FS.small }}>Delete</Btn>
        </div>
        {rows.length === 0 ? (
          <div style={{ ...sans, fontSize: FS.small, color: MICRO, marginTop: 8 }}>No assigned company has all inputs for this KPI yet. Use “Assign to companies” to scope it or add per-company formulas.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Chart chartId="formula-preview" type="line" unit={unit === "Ratio" ? "Number" : unit} height={230}
              title={`${f.name}${company ? ` — ${company.name}` : ""}`}
              subtitle={`Custom KPI · ${effectiveExpr(f, coId) || f.expr}`}
              series={series.length ? [{ key: f.id, label: f.name, points: series }] : []} />
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 4 }}>
          <table className="ledger sheet" style={{ width: "100%", borderCollapse: "collapse", ...sans, fontSize: FS.small }}>
            <thead>
              <tr style={{ textAlign: "left", color: MICRO }}>
                <th style={{ padding: "8px 12px", position: "sticky", top: 0, background: "var(--ink-color-global-surface-lightgray-default)" }}>Company</th>
                <th style={{ padding: "8px 12px", textAlign: "right", position: "sticky", top: 0, background: "var(--ink-color-global-surface-lightgray-default)" }}>{f.name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setChartCo(r.id)}
                  style={{ borderBottom: `1px solid var(--ink-color-global-border-subtle)`, cursor: "pointer", background: r.id === coId ? "var(--accent-soft)" : "transparent" }}>
                  <td style={{ padding: "7px 12px", fontWeight: 600 }}>{r.name}{r.custom && <Badge tone="muted" style={{ marginLeft: 6 }}>custom</Badge>}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right", ...mono, fontWeight: 600 }}>{fmtOut(r.v, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const errText = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)" };
const code = { fontFamily: mono.fontFamily, fontSize: FS.small, background: "var(--ink-color-global-surface-lightgray-default)", padding: "2px 6px", borderRadius: 4, color: "var(--ink-color-global-text-default)" };
const opBtn = { ...mono, width: 34, height: 34, borderRadius: 4, border: `1px solid var(--ink-color-global-border-default)`, background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", cursor: "pointer", fontSize: FS.bodyLg, fontWeight: 600 };

export default function Formulas({ data, dashboard }) {
  const [section, setSection] = useState("formulas");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <H2>Custom formulas</H2>
        <Segmented value={section} onChange={setSection}
          options={[{ id: "formulas", label: "Custom KPIs" }, { id: "covenants", label: "Covenants" }]} />
      </div>
      {section === "formulas" && <CustomFormulas data={data} dashboard={dashboard} />}
      {section === "covenants" && <Covenants data={data} dashboard={dashboard} />}
    </div>
  );
}
