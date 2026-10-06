import { useEffect, useMemo, useRef, useState } from "react";
import { C, FS, RADIUS, SANS, SHADOW } from "./theme.js";
import { ChevronDown } from "./components.jsx";
import { searchOptions } from "../model/locations.js";

/** The Benchmarks location field: a searchable list, as the product's Benchmarks page
 *  has. A native <select> can't be typed into, and ~440 locations is too many to
 *  scroll for.
 *
 *  With the box empty it lists every option under its group heading; typing narrows
 *  to the best 15 matches. `options` are {value, label, name, group}.
 */
export default function LocationPicker({
  label = "Location", options, value, onChange, disabled, hint, minWidth = 320,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [focus, setFocus] = useState(false);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => o.value === value);
  const results = useMemo(() => searchOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the keyboard-highlighted row in view as the arrows move it.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const openList = () => {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (o) => {
    setOpen(false);
    setQuery("");
    if (o && o.value !== value) onChange(o.value);
  };
  const onKey = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      e.preventDefault();
      openList();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  const listId = "location-picker-list";
  return (
    <span ref={wrapRef} style={{
      display: "inline-flex", flexDirection: "column", gap: 4, position: "relative",
    }}>
      <label htmlFor="location-picker-input" style={{ fontSize: FS.sm, color: C.textSubtle }}>
        {label}
      </label>
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <input
          id="location-picker-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          title={hint}
          placeholder={open ? "Search locations" : undefined}
          value={open ? query : (selected?.label || "")}
          onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
          onClick={() => { if (!open) openList(); }}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={onKey}
          style={{
            height: 40,
            padding: "0 34px 0 12px",
            minWidth,
            font: `400 ${FS.md}px/1 ${SANS}`,
            color: disabled ? C.textQuiet : C.textDefault,
            background: disabled ? C.surfaceUnderlay : C.surfaceDefault,
            border: `1px solid ${focus || open ? C.linkDefault : C.borderDefault}`,
            borderRadius: RADIUS,
            boxShadow: focus ? `0 0 0 4px ${C.focusRing}` : "none",
            outline: "none",
            textOverflow: "ellipsis",
          }}
        />
        <span style={{
          position: "absolute", right: 11, display: "inline-flex",
          pointerEvents: "none", color: C.textSubtle,
        }}>
          <ChevronDown />
        </span>
      </span>

      {open && (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={`${label} options`}
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20,
            minWidth: Math.max(minWidth, 280), maxHeight: 360, overflowY: "auto",
            background: C.surfaceDefault, border: `1px solid ${C.borderDefault}`,
            borderRadius: RADIUS, boxShadow: SHADOW.medium, padding: 4,
          }}
        >
          {results.length === 0 && (
            <div style={{ padding: "8px", font: `400 ${FS.md}px/1.4 ${SANS}`, color: C.textSubtle }}>
              No location matches “{query.trim()}”.
            </div>
          )}
          {results.map((o, i) => (
            <div key={o.value}>
              {(i === 0 || results[i - 1].group !== o.group) && (
                <div style={{
                  padding: "8px 8px 4px", font: `600 ${FS.sm}px/1.4 ${SANS}`,
                  letterSpacing: 0.4, textTransform: "uppercase", color: C.textSubtle,
                }}>
                  {o.group}
                </div>
              )}
              <div
                role="option"
                data-index={i}
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: "6px 8px", borderRadius: RADIUS, cursor: "pointer",
                  // The field's own size, so the list reads as the same control.
                  font: `${o.value === value ? 600 : 400} ${FS.md}px/1.4 ${SANS}`,
                  color: C.textDefault,
                  background: i === active ? C.rowHover : "transparent",
                  whiteSpace: "nowrap",
                }}
              >
                {o.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
