// "Assign to companies" panel: scope one custom metric and give any company its
// own roll-up expression when its accounts differ from the default.
import { useMemo, useState } from "react";
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { Modal, Dropdown, Btn, Badge } from "../ui/components.jsx";
import { fmtVal, shortDate } from "../ui/charts.jsx";
import { compile, resolveRefs } from "../model/formula.js";
import { metricOf, metricOptions } from "../model/kpi.js";
import { customMetricSeries, isAssigned, setScope, setOverride } from "../model/customMetrics.js";
import { withCommas } from "../ui/format.js";

const OPS = ["+", "−", "×", "÷", "(", ")"];
const MISSING_COLOR = "var(--ink-color-global-feedback-negative-strong)";

function fmtOut(v, unit, cur) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "Ratio") return v.toFixed(2) + "×";
  if (unit === "Percentage") return withCommas((v * 100).toFixed(1)) + "%";
  return fmtVal(v, unit, undefined, cur);
}

/** Evaluate one company's expression for the value + missing-input flag shown per row. */
function cellDetail(company, expr, metrics, unit) {
  const compiled = compile(expr);
  if (compiled.error) return { error: compiled.error };
  const resolved = resolveRefs(compiled.refs, metrics);
  if (resolved.unknown.length) return { error: `Unknown KPI: ${resolved.unknown.join(", ")}` };
  const { points, mixed } = customMetricSeries(company, compiled, resolved.map, metrics, unit);
  if (mixed) return { mixed: true };
  const last = points.length ? points[points.length - 1] : null;
  return { value: last ? last.v : null, cur: last ? last.cur : null, d: last ? last.d : null, empty: !last };
}

function RowStatus({ detail, unit }) {
  if (!detail) return <span style={{ color: MICRO }}>—</span>;
  if (detail.error) return <span style={{ color: MISSING_COLOR }}>⚠ {detail.error}</span>;
  if (detail.mixed) return <span style={{ color: MISSING_COLOR }}>⚠ mixed currency</span>;
  if (detail.empty) return <span style={{ color: MICRO }}>no complete period</span>;
  return (
    <span style={{ ...mono, color: "var(--ink-color-global-text-default)", fontWeight: 600 }}>
      {fmtOut(detail.value, unit, detail.cur)}
      <span style={{ ...sans, color: MICRO, fontWeight: 400, marginLeft: 6 }}>{shortDate(detail.d)}</span>
    </span>
  );
}

export default function AssignPanel({ data, dashboard, metrics, formula, onClose }) {
  const companies = useMemo(
    () => [...(data.companies || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const allIds = companies.map((c) => c.id);

  const [assigned, setAssigned] = useState(() => new Set(allIds.filter((id) => isAssigned(formula, id))));
  const [overrides, setOverrides] = useState(() => ({ ...(formula.overrides || {}) }));
  const [editingCo, setEditingCo] = useState(null);

  const toggle = (id) => setAssigned((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const setAll = (on) => setAssigned(on ? new Set(allIds) : new Set());
  const setOverrideExpr = (id, expr) => setOverrides((prev) => ({ ...prev, [id]: expr }));
  const useDefault = (id) => setOverrides((prev) => { const n = { ...prev }; delete n[id]; return n; });

  const save = () => {
    dashboard.update((d) => {
      setScope(d, formula.id, assigned.size === allIds.length ? "all" : [...assigned]);
      // Persist overrides only for assigned companies; clear the rest so unchecking
      // a company also drops its dead override.
      for (const c of companies) setOverride(d, formula.id, c.id, assigned.has(c.id) ? (overrides[c.id] || "").trim() : "");
      return d;
    });
    onClose();
  };

  const insert = (id, s) => setOverrideExpr(id, ((overrides[id] || "") + (overrides[id] && !/[\s(]$/.test(overrides[id]) ? " " : "") + s));

  return (
    <Modal open onClose={onClose} width={720} labelledById="assign-title"
      title={`Assign “${formula.name}”`}
      subtitle={formula.expr ? `Default: ${formula.expr}` : "No default expression — set one per company below."}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, ...sans, fontSize: FS.small }}>
        <span style={{ color: MICRO }}>
          Applies to <strong style={{ color: "var(--ink-color-global-text-default)" }}>{assigned.size}</strong> of {allIds.length} companies.
        </span>
        <span style={{ flex: 1 }} />
        <Btn onClick={() => setAll(true)} style={{ height: "auto", padding: "4px 10px", fontSize: FS.small }}>Select all</Btn>
        <Btn onClick={() => setAll(false)} style={{ height: "auto", padding: "4px 10px", fontSize: FS.small }}>None</Btn>
      </div>

      <div style={{ border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, overflow: "hidden" }}>
        {companies.map((c, i) => {
          const on = assigned.has(c.id);
          const expr = overrides[c.id] != null && overrides[c.id] !== "" ? overrides[c.id] : (formula.expr || "");
          const detail = on && expr ? cellDetail(c, expr, metrics, formula.unit) : null;
          const hasOverride = !!(overrides[c.id] && overrides[c.id].trim());
          const editing = editingCo === c.id;
          return (
            <div key={c.id} style={{ borderTop: i ? `1px solid var(--ink-color-global-border-subtle)` : "none",
              padding: "9px 12px", background: on ? "transparent" : "var(--ink-color-global-surface-lightgray-default)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={on} onChange={() => toggle(c.id)} aria-label={`Assign ${c.name}`}
                  style={{ width: 16, height: 16, cursor: "pointer", flex: "none" }} />
                <span style={{ ...sans, fontSize: FS.body, fontWeight: 600, minWidth: 150 }}>{c.name}</span>
                {hasOverride && <Badge tone="muted">custom</Badge>}
                <span style={{ flex: 1 }} />
                {on && <RowStatus detail={detail} unit={formula.unit} />}
                {on && (
                  <Btn onClick={() => setEditingCo(editing ? null : c.id)} style={{ height: "auto", padding: "4px 10px", fontSize: FS.small }}>
                    {editing ? "Done" : hasOverride ? "Edit formula" : "Custom formula"}
                  </Btn>
                )}
              </div>
              {on && editing && (
                <div style={{ marginTop: 10, paddingLeft: 26 }}>
                  <input value={overrides[c.id] || ""} onChange={(e) => setOverrideExpr(c.id, e.target.value)}
                    placeholder={formula.expr || "{Depreciation} + {Amortization}"}
                    style={{ width: "100%", fontFamily: mono.fontFamily, fontSize: FS.small, padding: "7px 9px",
                      border: `1px solid var(--ink-color-global-border-default)`, borderRadius: 6, marginBottom: 8,
                      background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <Dropdown options={metricOptions(metrics)} value={null} nullLabel="Insert KPI…" minWidth={160}
                      onChange={(key) => insert(c.id, `{${(metricOf(data, key) || {}).label}}`)} />
                    {OPS.map((op) => <button key={op} onClick={() => insert(c.id, op)} style={opBtn}>{op}</button>)}
                    <span style={{ flex: 1 }} />
                    {hasOverride && (
                      <Btn onClick={() => useDefault(c.id)} style={{ height: "auto", padding: "4px 10px", fontSize: FS.small }}>Use default</Btn>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <Btn kind="primary" onClick={save}>Save</Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

const opBtn = { ...mono, width: 32, height: 32, borderRadius: 6, border: `1px solid var(--ink-color-global-border-default)`,
  background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", cursor: "pointer", fontSize: FS.body, fontWeight: 600 };
