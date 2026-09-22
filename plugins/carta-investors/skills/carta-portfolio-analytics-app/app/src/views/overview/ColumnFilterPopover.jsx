// One condition editor for one Overview column, shared by the header funnel
// (ColumnFilterPopover) and the Filters panel's right pane (ColumnFilterBody).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FS, sans, MICRO } from "../../ui/theme.js";
import { Btn, SearchInput, TextInput, Dropdown, MarqueeLabel, useDismissable, POPOVER_SHADOW, Z } from "../../ui/components.jsx";
import { columnValueType, columnUnit, columnLabel, columnCategoryOptions, columnCategories } from "../../model/overviewColumns.js";
import { buildOverviewRow } from "../../model/overviewRow.js";
import { FILTER_OPS } from "../../model/overviewFilters.js";

export const PANEL_WIDTH = 300;
const SEARCH_MIN = 6; // a handful of options scan faster than they'd search

const h3 = { ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 12px" };
const row = { ...sans, display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--ink-color-global-text-default)", cursor: "pointer" };
const box = { width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" };
const hint = { ...sans, fontSize: FS.small, color: MICRO };

/** The blank draft for a value type — what "Clear" applies. */
export function emptyCond(valueType) {
  return valueType === "category" ? { any: [] } : { op: "gte", a: "", b: "", blanks: false };
}

/** Controlled editor body. `otherCompanies` are the rows passing every filter
 *  except this column's, so a category count answers "how many would I keep".
 *  `action` is an optional control rendered on the heading row (e.g. add/remove column). */
export function ColumnFilterBody({ spec, data, ctx, draft, onDraft, otherCompanies, action }) {
  const vt = columnValueType(spec);
  const label = columnLabel(spec, data);
  const [search, setSearch] = useState("");
  const heading = (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
      <h3 style={{ ...h3, flex: 1, minWidth: 0 }}><MarqueeLabel hoverParent>Filter by {label}</MarqueeLabel></h3>
      {action}
    </div>
  );

  if (vt === "category") {
    const options = columnCategoryOptions(spec, data, ctx);
    const counts = new Map();
    for (const c of otherCompanies || []) {
      for (const v of columnCategories(spec, data, c, buildOverviewRow(data, c.id), ctx)) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const q = search.toLowerCase();
    const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    const any = draft.any || [];
    const toggle = (v) => onDraft({ any: any.includes(v) ? any.filter((x) => x !== v) : [...any, v] });
    return (
      <>
        {heading}
        {options.length > SEARCH_MIN && (
          <SearchInput placeholder={`Search ${label.toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
        )}
        {options.length === 0 && <p style={{ ...hint, margin: 0 }}>Nothing to filter by yet.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((o) => (
            <label key={o.value} style={row}>
              <input type="checkbox" aria-label={o.label} checked={any.includes(o.value)} onChange={() => toggle(o.value)} style={box} />
              <MarqueeLabel hoverParent style={{ flex: 1 }}>{o.label}</MarqueeLabel>
              <span style={{ color: "var(--ink-color-global-text-subtle)", fontSize: 12 }}>{counts.get(o.value) || 0}</span>
            </label>
          ))}
        </div>
      </>
    );
  }

  const isDate = vt === "date";
  const unit = columnUnit(spec, data);
  const opOptions = FILTER_OPS.map((o) => ({ id: o.id, label: isDate ? o.dateWord : o.sym }));
  const set = (patch) => onDraft({ ...draft, ...patch });
  const input = (field) => (
    <TextInput type={isDate ? "date" : "number"} step={isDate ? undefined : "any"} inputMode={isDate ? undefined : "decimal"}
      aria-label={field === "a" ? (draft.op === "between" ? "From" : "Value") : "To"}
      value={draft[field] ?? ""} onChange={(e) => set({ [field]: e.target.value })} style={{ width: isDate ? 150 : 110 }} />
  );
  // Percentage KPIs are stored as fractions; say so, or "25" silently means 2,500%.
  const unitHint = unit === "Months" ? "months" : unit === "Percentage" ? "as a fraction (0.25 = 25%)" : unit === "Dollar" ? data.source?.currency : unit;
  return (
    <>
      {heading}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Dropdown options={opOptions} value={draft.op} onChange={(id) => set({ op: id })} minWidth={isDate ? 130 : 90} compact portal />
        {input("a")}
        {draft.op === "between" && <><span style={hint}>and</span>{input("b")}</>}
        {unitHint && !isDate && <span style={hint}>{unitHint}</span>}
      </div>
      <label style={{ ...row, marginTop: 12 }}>
        <input type="checkbox" checked={!!draft.blanks} onChange={(e) => set({ blanks: e.target.checked })} style={box} />
        Include blanks
      </label>
    </>
  );
}

/** The header-anchored popover: fixed under `anchorRect` (a DOMRect from the
 *  funnel button), portaled to <body> so the table's overflow can't clip it.
 *  Draft-then-Apply, like the Filters panel — the page has one commit model. */
export default function ColumnFilterPopover({ spec, data, ctx, filter, otherCompanies, anchorRect, onApply, onClose }) {
  const vt = columnValueType(spec);
  const [draft, setDraft] = useState(() => filter?.cond || emptyCond(vt));
  const ref = useRef(null);
  useDismissable(true, (open) => { if (!open) onClose(); }, ref, { insideSelector: ".popin" });
  // Keep the panel on-screen: slide left when it would spill past the right edge.
  const left = useMemo(() => Math.max(8, Math.min(anchorRect.left, window.innerWidth - PANEL_WIDTH - 8)), [anchorRect.left]);
  useEffect(() => { setDraft(filter?.cond || emptyCond(vt)); }, [filter, vt]);
  return createPortal(
    <div ref={ref} className="popin" style={{ ...sans, position: "fixed", top: anchorRect.bottom + 4, left, width: PANEL_WIDTH,
      background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)",
      borderRadius: 8, boxShadow: POPOVER_SHADOW, zIndex: Z.popover, display: "flex", flexDirection: "column", maxHeight: 420 }}>
      <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1 }}>
        <ColumnFilterBody spec={spec} data={data} ctx={ctx} draft={draft} onDraft={setDraft} otherCompanies={otherCompanies} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 18px", borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
        <Btn onClick={() => { onApply(emptyCond(vt)); onClose(); }}>Clear</Btn>
        <Btn kind="primary" onClick={() => { onApply(draft); onClose(); }}>Apply</Btn>
      </div>
    </div>,
    document.body,
  );
}
