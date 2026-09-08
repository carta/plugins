import { useEffect, useRef, useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, FS } from "../ui/theme.js";
import { trackClick } from "../analytics.js";

// Controlled start-year picker for the FeeIncome chart.
export default function FeeYearFilter({ labels, startIdx, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!labels?.length) return null;

  const options = labels.map((lab, i) => ({ idx: i, label: lab.replace(/\s+YTD$/i, "") }));
  const selected = options.find((o) => o.idx === startIdx) || options[0];
  const buttonLabel = startIdx === 0 ? "All years" : `From ${selected?.label}`;

  return (
    <div ref={wrapRef} style={S.wrap}>
      <button
        style={{ ...S.button, ...(open ? S.buttonOpen : {}) }}
        onClick={() => { trackClick("MancoReporting.Dashboard.FeeYearFilterOpen"); setOpen((v) => !v); }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {buttonLabel}
        <Caret open={open} />
      </button>

      {open && (
        <div style={S.panel} role="listbox" aria-label="Select start year">
          <ul style={S.list}>
            {options.map(({ idx, label }) => {
              const active = idx === startIdx;
              return (
                <li key={idx}>
                  <button
                    role="option"
                    aria-selected={active}
                    style={{ ...S.row, ...(active ? S.rowActive : {}) }}
                    onClick={() => { trackClick("MancoReporting.Dashboard.FeeYearFilter"); onChange(idx); setOpen(false); }}
                  >
                    {idx === 0 ? "All years" : `From ${label}`}
                    {active && <span style={S.check}>✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

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
  wrap: { ...sans, position: "relative", display: "inline-block" },
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
    minWidth: 110,
    justifyContent: "space-between",
  },
  buttonOpen: { borderColor: INK },
  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    minWidth: 160,
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    boxShadow: "0 8px 24px -6px rgba(0, 16, 76, 0.12)",
    zIndex: 100,
    overflow: "hidden",
  },
  list: { listStyle: "none", margin: 0, padding: "4px 0" },
  row: {
    ...sans,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: "7px 14px",
    fontSize: FS.body,
    color: INK,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  },
  rowActive: { fontWeight: 600 },
  check: { color: INK, fontSize: FS.micro, fontWeight: 600, marginLeft: 8 },
};
