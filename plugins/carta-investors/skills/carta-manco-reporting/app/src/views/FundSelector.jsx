import { useEffect, useRef, useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, BLUE, FS } from "../ui/theme.js";
import { trackClick } from "../analytics.js";

// Multi-select dropdown for filtering which fund entities show in the
// Management Fee Income chart. Mirrors the fund-modeling UI pattern:
// a "All funds ▲" button that toggles a panel with Clear all + per-fund
// checkbox rows with color swatches.
//
// Controlled: parent owns `selected` (Set of fund names) and receives
// updates via `onChange(nextSelected)`.
export default function FundSelector({ funds, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Unchecking the last remaining fund is a no-op — an empty chart has
  // no clicked bar left to recover from.
  const toggle = (name) => {
    const next = new Set(selected);
    if (next.has(name)) {
      if (next.size <= 1) return;
      next.delete(name);
    } else {
      next.add(name);
    }
    onChange(next);
  };

  const allSelected = selected.size === funds.length;

  const buttonLabel = allSelected ? "All funds" : `${selected.size} of ${funds.length}`;

  return (
    <div ref={wrapRef} style={S.wrap}>
      <button
        style={{ ...S.button, ...(open ? S.buttonOpen : {}) }}
        onClick={() => { trackClick("MancoReporting.Dashboard.FundSelectorOpen"); setOpen(v => !v); }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {buttonLabel}
        <Caret open={open} />
      </button>

      {open && (
        <div style={S.panel} role="listbox" aria-label="Filter funds">
          <div style={S.panelHeader}>
            <button
              style={{ ...S.linkBtn, ...(allSelected ? S.linkBtnDisabled : {}) }}
              onClick={() => { trackClick("MancoReporting.Dashboard.SelectAllFunds"); onChange(new Set(funds.map(f => f.name))); }}
              disabled={allSelected}
            >
              Select all
            </button>
          </div>
          <ul style={S.list}>
            {funds.map((f) => {
              const checked = selected.has(f.name);
              const locked = checked && selected.size <= 1;
              return (
                <li key={f.name}>
                  <label
                    style={{ ...S.row, ...(checked ? {} : S.rowMuted) }}
                    title={locked ? "At least one fund must stay selected" : undefined}
                  >
                    <span style={S.checkbox}>
                      {checked && <span style={S.check}>✓</span>}
                    </span>
                    <span style={{ ...S.swatch, background: f.color }} />
                    <span style={S.name}>{f.name}</span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => { trackClick("MancoReporting.Dashboard.SelectFunds"); toggle(f.name); }}
                      style={{ display: "none" }}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Chevron matching DateRangeControls' — an SVG the browser will smooth-rotate
// on open/close, replacing the previous Unicode ▲/▼ (which didn't animate and
// rendered slightly differently across fonts).
function Caret({ open }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
      style={{ color: FAINT, transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease", flexShrink: 0 }}
    >
      <path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const S = {
  wrap: {
    ...sans,
    position: "relative",
    display: "inline-block",
  },
  button: {
    ...sans,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    fontSize: FS.body,
    fontWeight: 500,
    color: INK,
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    cursor: "pointer",
    minWidth: 120,
    justifyContent: "space-between",
  },
  buttonOpen: {
    borderColor: INK,
  },
  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,             // anchor to button's LEFT edge; panel grows rightward
    right: "auto",
    minWidth: 320,
    maxWidth: 460,
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    boxShadow: "0 8px 24px -6px rgba(0, 16, 76, 0.12)",
    zIndex: 100,
    overflow: "hidden",
  },
  panelHeader: {
    padding: "10px 14px",
    borderBottom: `1px solid ${LINE}`,
    background: PAPER,
  },
  linkBtn: {
    ...sans,
    fontSize: FS.body,
    fontWeight: 600,
    color: INK,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
  },
  linkBtnDisabled: {
    color: FAINT,
    cursor: "default",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: "4px 0",
    maxHeight: 380,
    overflowY: "auto",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 14px",
    fontSize: FS.body,
    color: INK,
    cursor: "pointer",
    userSelect: "none",
  },
  rowMuted: {
    color: FAINT,
  },
  checkbox: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    border: `1px solid ${INK}`,
    borderRadius: 2,
    flexShrink: 0,
  },
  check: {
    color: INK,
    fontSize: FS.micro,
    fontWeight: 600, // Ink's type scale never exceeds weight 600 (was 900)
    lineHeight: 1,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
    flexShrink: 0,
  },
  name: {
    fontWeight: 500,
    color: "inherit",
  },
};
