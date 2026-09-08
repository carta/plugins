import { useEffect, useMemo, useRef, useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, MICRO, BLUE, FS } from "../ui/theme.js";
import { trackClick, trackRender } from "../analytics.js";

// Carta-style date range picker: a compact trigger button
// ("YTD 2026: Jan 1 – Jul 15, 2026" with a calendar icon + caret) that
// opens a popover with a preset dropdown and From/To date inputs.
//
// Controlled: parent owns `value = {start, end}` and receives updates via
// `onChange({start, end, preset})`. Manual date edits emit preset "custom".
//
// Presets are computed from `asOf` (snapshot data-cutoff, ISO YYYY-MM-DD)
// so YTD / This Quarter don't reach past the last day with data.

// -- Presets ----------------------------------------------------------------
function buildPresets(asOf) {
  const [ys, ms, ds] = asOf.split("-").map(Number);
  const asOfMonth = ms;              // 1..12
  const yr = ys;
  const prevYr = yr - 1;

  // Current quarter (based on asOf month). Q1=Jan-Mar, Q2=Apr-Jun, etc.
  const curQIdx = Math.floor((asOfMonth - 1) / 3);           // 0..3
  const curQStartMonth = curQIdx * 3 + 1;                    // 1,4,7,10
  const thisQStart = `${yr}-${pad(curQStartMonth)}-01`;
  const thisQEnd = asOf;                                     // "to date"

  // Last quarter — walk back one quarter, potentially into prior year
  let lastQIdx = curQIdx - 1;
  let lastQYear = yr;
  if (lastQIdx < 0) { lastQIdx = 3; lastQYear = prevYr; }
  const lastQStartMonth = lastQIdx * 3 + 1;
  const lastQEndMonth   = lastQStartMonth + 2;
  const lastQStart = `${lastQYear}-${pad(lastQStartMonth)}-01`;
  const lastQEnd   = `${lastQYear}-${pad(lastQEndMonth)}-${lastDayOfMonth(lastQYear, lastQEndMonth)}`;

  return [
    { id: "ytd",         label: "Year to Date (YTD)", start: `${yr}-01-01`,     end: asOf },
    { id: "last-year",   label: "Last Year",          start: `${prevYr}-01-01`, end: `${prevYr}-12-31` },
    { id: "last-quarter",label: "Last Quarter",       start: lastQStart,        end: lastQEnd },
    { id: "this-quarter",label: "This Quarter",       start: thisQStart,        end: thisQEnd },
    { id: "custom",      label: "Custom Period",      start: null,              end: null },
  ];
}

function pad(n) { return String(n).padStart(2, "0"); }
function lastDayOfMonth(y, m) { return new Date(y, m, 0).getDate(); }

// -- Formatting helpers ----------------------------------------------------
const ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatSummary(dr) {
  if (!dr?.start || !dr?.end) return "—";
  const [sy, sm, sd] = dr.start.split("-").map(Number);
  const [ey, em, ed] = dr.end.split("-").map(Number);
  if (sy === ey) {
    return `${ABBR[sm - 1]} ${sd} – ${ABBR[em - 1]} ${ed}, ${ey}`;
  }
  return `${ABBR[sm - 1]} ${sd}, ${sy} – ${ABBR[em - 1]} ${ed}, ${ey}`;
}

// -- Component --------------------------------------------------------------
export default function DateRangeControls({ value, onChange, asOf = "2026-07-15" }) {
  const presets = useMemo(() => buildPresets(asOf), [asOf]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Match current value to a preset id (or "custom" if manual)
  const activePreset = useMemo(() => {
    if (!value?.start || !value?.end) return "ytd";
    const match = presets.find(p => p.id !== "custom" && p.start === value.start && p.end === value.end);
    return match?.id || "custom";
  }, [value, presets]);

  const activeLabel = presets.find(p => p.id === activePreset)?.label || "Custom Period";

  // Close on outside click / ESC
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => { if (open) trackRender("MancoReporting.DateRangePanel.View"); }, [open]);

  const handlePreset = (id) => {
    const p = presets.find(x => x.id === id);
    if (!p) return;
    trackClick("MancoReporting.Dashboard.DateRangePreset");
    if (id === "custom") {
      onChange({ start: value?.start || presets[0].start, end: value?.end || presets[0].end, preset: "custom" });
    } else {
      onChange({ start: p.start, end: p.end, preset: id });
    }
  };

  const handleDate = (which, iso) => {
    trackClick("MancoReporting.Dashboard.DateRangeCustom");
    onChange({
      start: which === "start" ? iso : value?.start,
      end:   which === "end"   ? iso : value?.end,
      preset: "custom",
    });
  };

  return (
    <div ref={wrapRef} style={S.wrap}>
      <button
        type="button"
        style={{ ...S.trigger, ...(open ? S.triggerOpen : {}) }}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarIcon />
        <span style={S.triggerText}>
          <span style={S.triggerLabel}>{activeLabel}:</span>{" "}
          <span style={S.triggerRange}>{formatSummary(value)}</span>
        </span>
        <Caret open={open} />
      </button>

      {open && (
        <div style={S.popover} role="dialog" aria-label="Date range">
          <label style={S.fieldLabel}>Date range</label>
          <select
            style={S.select}
            value={activePreset}
            onChange={(e) => handlePreset(e.target.value)}
          >
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>

          <div style={S.row}>
            <div style={S.field}>
              <label style={S.fieldLabel}>From</label>
              <input
                type="date"
                style={S.dateInput}
                value={value?.start || ""}
                onChange={(e) => handleDate("start", e.target.value)}
              />
            </div>
            <div style={S.field}>
              <label style={S.fieldLabel}>To</label>
              <input
                type="date"
                style={S.dateInput}
                value={value?.end || ""}
                onChange={(e) => handleDate("end", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="10.5" rx="1.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function Caret({ open }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}
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
  trigger: {
    ...sans,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    background: PAPER,
    color: INK,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    fontSize: FS.body,
    fontWeight: 500,
    cursor: "pointer",
    fontVariantNumeric: "tabular-nums",
  },
  triggerOpen: {
    borderColor: BLUE,
    boxShadow: `0 0 0 3px rgba(40, 93, 163, 0.15)`, // Ink link/focus blue (#285DA3) — was the wrong chart cobalt (#2a78d6)
  },
  triggerText: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 4,
  },
  triggerLabel: {
    color: INK,
    fontWeight: 500,
  },
  triggerRange: {
    color: FAINT,
    fontWeight: 500,
  },
  popover: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    zIndex: 40,
    minWidth: 340,
    padding: 14,
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 6,
    boxShadow: "0 8px 24px -6px rgba(0, 16, 76, 0.14)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  fieldLabel: {
    ...sans,
    fontSize: FS.small,
    fontWeight: 600,
    color: INK,
    marginBottom: 4,
    display: "block",
  },
  select: {
    ...sans,
    padding: "6px 8px",
    fontSize: FS.bodyLg,
    color: INK,
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    cursor: "pointer",
    appearance: "auto",
    width: "100%",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  field: {
    display: "flex",
    flexDirection: "column",
  },
  dateInput: {
    ...sans,
    padding: "6px 8px",
    fontSize: FS.bodyLg,
    color: INK,
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    fontVariantNumeric: "tabular-nums",
    width: "100%",
    boxSizing: "border-box",
  },
};
