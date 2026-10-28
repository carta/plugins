import { useState } from "react";
import { sans, INK, PAPER } from "../../ui/theme.js";
import { Chevron, POPOVER_SURFACE, TOOLBAR_CONTROL_STYLE } from "../../ui/components.jsx";
import { useOutsideClose } from "../../ui/useOutsideClose.js";
import { summarize } from "./pivot.js";

// A filter's values as Ink checkboxes: tick any number; "All" clears them, and is ticked
// while none is, since no value chosen means every value.
export function ValueChecklist({ options, selected, onChange }) {
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <div className="gf-check-list">
      <label className="gf-check-row">
        <input type="checkbox" checked={!selected.length} onChange={() => onChange([])} />
        All
      </label>
      {options.map(v => (
        <label key={v} className="gf-check-row">
          <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} />
          {v}
        </label>
      ))}
    </div>
  );
}

// Searching only pays off once a list runs past what fits at a glance.
const SEARCH_AFTER = 8;

// A filter in the builder: an Ink dropdown trigger naming what's chosen, opening a
// checklist of the field's values that applies as each one is ticked.
export function MultiSelect({ labelId, label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useOutsideClose(open, () => setOpen(false));
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter(v => String(v).toLowerCase().includes(q)) : options;
  return (
    <div ref={ref} style={styles.addWrap}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="dialog" aria-expanded={open}
              aria-labelledby={labelId} className={`dd-trigger${open ? " is-open" : ""}`} style={styles.multiTrigger}>
        <span style={styles.multiValue}>{selected.length ? summarize(selected) : "All"}</span>
        <Chevron rotate={open ? 180 : 0} />
      </button>
      {open && (
        <div role="dialog" aria-label={`Filter by ${label}`} className="popin" style={styles.multiMenu}>
          {options.length > SEARCH_AFTER && (
            <input type="search" className="numin" placeholder={`Search ${label.toLowerCase()}`} value={query}
                   onChange={e => setQuery(e.target.value)} aria-label={`Search ${label}`} style={styles.multiSearch} autoFocus />
          )}
          <div style={styles.multiList}>
            <ValueChecklist options={shown} selected={selected} onChange={onChange} />
          </div>
        </div>
      )}
    </div>
  );
}
const styles = {
  addWrap: { position: "relative" },
  multiTrigger: {
    ...sans, display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    ...TOOLBAR_CONTROL_STYLE, minWidth: 160, maxWidth: 280, boxSizing: "border-box", cursor: "pointer",
    color: INK, background: PAPER, borderRadius: 4,
    border: "1px solid var(--ink-color-global-border-default)",
  },
  multiValue: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  multiMenu: {
    ...POPOVER_SURFACE, position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 240, boxSizing: "border-box",
    padding: 12,
  },
  multiSearch: { ...sans, ...TOOLBAR_CONTROL_STYLE, width: "100%", boxSizing: "border-box", marginBottom: 10 },
  multiList: { maxHeight: 280, overflowY: "auto" },
};
