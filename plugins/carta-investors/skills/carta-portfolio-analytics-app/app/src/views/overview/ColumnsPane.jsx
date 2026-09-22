// The "Columns" pane of the Filters & columns panel: the table's stack, edited in place.
import { useRef, useState } from "react";
import { FS, sans, MICRO } from "../../ui/theme.js";
import { Btn, Segmented, Toggle, MarqueeLabel } from "../../ui/components.jsx";
import { readColumns, removeColumn, moveColumn, updateColumn, ensureColumns, columnLabel } from "../../model/overviewColumns.js";
import { navigate, parseRoute } from "../../route.js";
import { trackClick } from "../../analytics.js";

const heading = { ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: 0 };
const rowLbl = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-default)" };
const note = { ...sans, fontSize: FS.small, color: MICRO, lineHeight: 1.5 };

const DELTA_OPTIONS = [{ id: "none", label: "None" }, { id: "qoq", label: "QoQ" }, { id: "yoy", label: "YoY" }];

/** Drag-to-reorder list of the table's columns with per-column sparkline/delta
 *  and Remove. Every edit writes to the doc at once (unlike the filter drafts
 *  around it); writes go through ensureColumns since the reducers read the raw
 *  array. Adding a column happens from a field's own pane ("+ Add to columns"). */
export default function ColumnsPane({ data, dashboard }) {
  const columns = readColumns(dashboard.doc, data);
  const commit = (fn) => dashboard.update((d) => fn(ensureColumns(d, data)));
  const onRemove = (id) => { trackClick("PortfolioAnalytics.Overview.ColumnRemove"); commit((d) => removeColumn(d, id)); };
  const onPatch = (id, patch) => { trackClick("PortfolioAnalytics.Overview.ColumnFormat"); commit((d) => updateColumn(d, id, patch)); };
  // An empty array means "never customized": readColumns falls back to the default stack.
  const reset = () => { trackClick("PortfolioAnalytics.Overview.ColumnsReset"); dashboard.update((d) => { d.columns = []; return d; }); };
  // Formulas are built on their own tab — a modal here would open on top of this panel.
  const goToFormulas = () => {
    trackClick("PortfolioAnalytics.Overview.NewFormula");
    const r = parseRoute();
    if (r.firm) navigate({ firm: r.firm, tab: "formulas" });
  };

  // Drag-to-reorder: source index in a ref (read in drop, immune to stale
  // closures); dragIndex/overIndex are state for the dim + drop indicator only.
  const dragFrom = useRef(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const endDrag = () => { dragFrom.current = null; setDragIndex(null); setOverIndex(null); };
  const move = (from, to) => {
    if (from == null || to == null || from === to) return;
    trackClick("PortfolioAnalytics.Overview.ColumnsReorder");
    commit((d) => moveColumn(d, from, to));
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h3 style={heading}>Columns</h3>
        <Btn kind="link" style={{ fontSize: FS.small, whiteSpace: "nowrap" }} onClick={reset}>Reset to default</Btn>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {columns.map((col, i) => {
          const label = columnLabel(col, data);
          const isMetric = col.kind === "metric";
          return (
            <div key={col.id} draggable
              onDragStart={(e) => { dragFrom.current = i; setDragIndex(i);
                if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch { /* happy-dom */ } } }}
              onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; if (overIndex !== i) setOverIndex(i); }}
              onDrop={(e) => { e.preventDefault(); move(dragFrom.current, i); endDrag(); }}
              onDragEnd={endDrag}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6,
                background: "var(--ink-color-global-surface-lightgray-default)",
                opacity: dragIndex === i ? 0.5 : 1,
                boxShadow: overIndex === i && dragIndex !== i ? "inset 0 2px 0 0 var(--ink-color-global-border-focus-default)" : "none" }}>
              <span aria-label={`Drag to reorder ${label}`} title="Drag to reorder"
                style={{ ...sans, cursor: "grab", color: "var(--ink-color-global-text-subtle)", padding: "0 2px", userSelect: "none", lineHeight: 1 }}>⠿</span>
              <MarqueeLabel hoverParent style={{ ...rowLbl, flex: 1 }}>{label}</MarqueeLabel>
              {isMetric && (
                <>
                  <Toggle small checked={!!col.spark} labels={["Spark", "Spark"]}
                    title="Show a sparkline for this column" onChange={(v) => onPatch(col.id, { spark: v || undefined })} />
                  <Segmented small options={DELTA_OPTIONS} value={col.delta || "none"}
                    onChange={(v) => onPatch(col.id, { delta: v === "none" ? undefined : v })} />
                </>
              )}
              <Btn kind="link" style={{ fontSize: FS.small }} onClick={() => onRemove(col.id)}>Remove</Btn>
            </div>
          );
        })}
      </div>
      <p style={{ ...note, margin: "14px 0 0" }}>
        Add a column from any section on the left. Need a new formula?{" "}
        <Btn kind="link" style={{ fontSize: FS.small }} onClick={goToFormulas}>Build it on the Formulas tab</Btn>
      </p>
    </>
  );
}
