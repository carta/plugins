// Reprice control — a clean flat slider (cobalt fill, square thumb) with a
// tabular value you can click to type, quick preset chips, and a live uplift
// readout. No serif value, no anchor labels, no write-off/exit scale, no Reset
// button (the Carta chip resets) — a minimal Swiss take, not the legacy tape. One
// component, two sizes: `compact` (inline table cell) and full (expanded, with
// preset chips). Mode-agnostic — the caller passes a resolved config.
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { FS, sans, mono, MICRO, TAPE_THUMB } from "./theme.js";
import { fmtM } from "./format.js";
import { useAnimated } from "./components.jsx";

const clampTo = (v, min, max) => Math.min(max, Math.max(min, v));
const near = (a, b, eps) => Math.abs(a - b) < eps;

/** @param presets [{v, label}]  @param fmtVal (v)=>string  @param compact bool
 *  @param hidePresets bool — skip the preset chips and draw a Carta-mark tick on the track instead
 *  @param showTick bool — force the Carta-mark tick even when preset chips are shown (expanded view) */
// `disabled` is truly inert. `locked` keeps the control interactive-but-muted:
// the slider/presets/value-input still fire onChange so the parent setter can
// no-op and surface a "Baseline is read-only" warning — and because the parent
// never updates `value`, the control stays put / snaps back on its own.
export default function RepriceControl({ value, onChange, onReset, fmtVal, min = 0, max, step = 0.05, presets = [], resetValue, uplift = 0, disabled, locked, compact, hidePresets, hideReadout, showTick, onDragStart, onDragEnd }) {
  const v = value ?? 0;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  const rangeRef = useRef(null);
  const aUplift = useAnimated(uplift);
  const moved = Math.abs(uplift) >= 0.5;

  // Local drag value — overrides the prop-driven `v` while the pointer is held
  // so the controlled input never "bounces back" when a parent re-render lags
  // behind fast pointer events. onChange is still called on every slide for live
  // table updates; this just keeps the slider's own position stable during drag.
  const [dragVal, setDragVal] = useState(null);
  const draggingRef = useRef(false);

  // When v changes from outside (parent state sync after release, external reset),
  // clear the local override — but only when not actively dragging.
  useEffect(() => {
    if (!draggingRef.current) setDragVal(null);
  }, [v]);

  const displayed = dragVal ?? clampTo(v, min, max);
  const fill = max > min ? ((displayed - min) / (max - min)) * 100 : 0;

  const tickPct = (compact || hidePresets || showTick) && resetValue != null && max > min
    ? ((clampTo(resetValue, min, max) - min) / (max - min)) * 100
    : null;

  // Tick position in px relative to the wrapping div. An overlay can't inherit
  // webkit's thumb math, so mirror it from the measured track: the thumb center
  // travels TAPE_THUMB/2 → trackWidth − TAPE_THUMB/2 (span trackWidth − TAPE_THUMB);
  // offsetLeft absorbs any UA margin. useLayoutEffect sets it pre-paint (no flash).
  const [tickLeft, setTickLeft] = useState(null);
  useLayoutEffect(() => {
    const el = rangeRef.current;
    if (tickPct == null || !el) { setTickLeft(null); return; }
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      const t = tickPct / 100;
      setTickLeft(el.offsetLeft + TAPE_THUMB / 2 + (w - TAPE_THUMB) * t);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tickPct]);

  // snapWindow: preset snap (narrow — a few tenths of a pixel on compact)
  // cartaSnapWindow: Carta-mark snap, calibrated to ~3px physical on both sizes
  const snapWindow = (max - min) / 160;
  const cartaSnapWindow = (max - min) / (compact ? 25 : 80);

  const onSlide = (raw) => {
    // Locked: fire onChange so the parent can warn, but DON'T take the local drag
    // override — the value stays pinned to `v`, so the thumb snaps back.
    if (locked) { onChange(parseFloat(raw)); return; }
    let next = parseFloat(raw);
    for (const p of presets) if (near(next, p.v, snapWindow)) next = p.v;
    // Carta mark snap is handled on pointerUp only (not during drag) so the
    // full range below the mark stays reachable when the mark is near the min.
    const clamped = clampTo(next, min, max);
    setDragVal(clamped);
    onChange(clamped);
  };

  const handlePointerDown = () => {
    if (locked) return; // no drag override on a read-only slider
    draggingRef.current = true;
    setDragVal(clampTo(v, min, max));
    onDragStart?.();
  };

  const handlePointerUp = () => {
    if (locked) return;
    draggingRef.current = false;
    // Snap to Carta mark on release if the thumb lands close. Shrink the snap
    // window when the mark is near an endpoint so the zone never extends past
    // min or max — prevents snapping when the user dragged all the way to 0.
    if (resetValue != null && tickPct != null) {
      const cur = dragVal ?? clampTo(v, min, max);
      const distToNearestEnd = Math.min(resetValue - min, max - resetValue);
      const effectiveWindow = Math.min(cartaSnapWindow, Math.max(0, distToNearestEnd - step));
      if (effectiveWindow > 0 && near(cur, resetValue, effectiveWindow)) {
        setDragVal(resetValue);
        onChange(resetValue);
      }
    }
    onDragEnd?.();
  };

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const startEdit = () => { if (disabled) return; setText(String(+displayed.toFixed(2))); setEditing(true); };
  const commit = () => {
    const n = parseFloat(text);
    if (!isNaN(n)) onChange(clampTo(n, min, max));
    setEditing(false);
  };

  const numSize = compact ? FS.value : FS.display;
  const valueEl = editing ? (
    <input ref={inputRef} className="numin" type="text" inputMode="decimal" value={text} disabled={disabled}
      onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(clampTo(n, min, max)); }}
      onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{ ...mono, width: compact ? 60 : 110, fontSize: numSize, fontWeight: 700, padding: "1px 6px", background: "transparent", color: "var(--ink-color-global-text-default)", textAlign: compact ? "right" : "left", letterSpacing: "-0.02em" }} />
  ) : (
    <button onClick={locked ? () => onChange(displayed) : startEdit}
      title={locked ? "Locked — duplicate into a scenario to edit" : "Click to type an exact value"} disabled={disabled}
      style={{ ...mono, fontSize: numSize, fontWeight: 700, color: "var(--ink-color-global-text-default)", letterSpacing: "-0.02em", lineHeight: 1,
        background: "transparent", border: "none", padding: 0, cursor: locked ? "not-allowed" : disabled ? "default" : "text",
        minWidth: compact ? 52 : 96, textAlign: compact ? "right" : "left" }}>
      {fmtVal(displayed)}
    </button>
  );
  // Inline (compact) FV-change tag — labeled "FV" so it's clear this is the
  // change in the COMPANY's fair value vs its Carta mark (not LP NAV). In the
  // expanded view the split line below the control carries this instead.
  const upliftEl = (
    <span title="Change in this company's fair value vs its Carta mark"
      style={{ ...mono, fontSize: FS.micro, fontWeight: 600, width: 82, textAlign: "right", whiteSpace: "nowrap",
        color: !moved ? "var(--ink-color-global-text-subtle)" : uplift >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>
      {!moved ? "FV —" : `FV ${uplift >= 0 ? "▲" : "▼"} ${fmtM(Math.abs(aUplift))}`}
    </span>
  );
  const slider = (
    <div style={{ position: "relative", ...(compact ? { width: 92 } : { width: "100%" }) }}>
      <input ref={rangeRef} className="tape" type="range" min={min} max={max} step={step} value={displayed} disabled={disabled}
        aria-label="reprice" title={locked ? "Locked — duplicate into a scenario to edit" : undefined}
        style={{ "--fill": fill + "%", height: compact ? 20 : 28, width: "100%", cursor: locked ? "not-allowed" : undefined }}
        onChange={(e) => onSlide(e.target.value)}
        onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} />
      {tickLeft != null && (
        <span aria-hidden title="Carta mark" style={{ position: "absolute",
          left: tickLeft,
          top: "50%", transform: "translate(-50%, -50%)",
          width: 2, height: "70%",
          background: "var(--ink-color-global-surface-background-default)", boxShadow: `0 0 0 1px var(--ink-button-background-color-primary-base-default)`,
          pointerEvents: "none" }} />
      )}
    </div>
  );

  if (compact) {
    // hideReadout → slider only; the FV / MOIC columns now carry the value +
    // the green/red change, so the inline value + "FV ▲" tag would duplicate them
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 9, opacity: locked ? 0.5 : 1 }}>
        {slider}{!hideReadout && valueEl}{!hideReadout && upliftEl}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: locked ? 0.5 : 1 }}>
      {/* expanded view: value only — the company-FV / LP / carry split is shown
          on the detail line in Companies.jsx, so no duplicate FV figure here */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>{valueEl}</div>
      {slider}
      {!hidePresets && presets.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {presets.map((p) => {
            const on = near(displayed, p.v, Math.max(step / 2, (max - min) / 400));
            // Sentiment presets carry a red→green `tone`: color the chip with it
            // (filled when active). Toneless presets keep the neutral Ink style.
            const border = p.tone ?? (on ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-border-subtle)");
            const bg = p.tone ? (on ? p.tone : "transparent") : (on ? "var(--accent-soft)" : "transparent");
            const color = p.tone ? (on ? "#fff" : p.tone) : (on ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-text-subtle)");
            return (
              <button key={p.label} onClick={() => !disabled && onChange(p.v)} disabled={disabled}
                title={p.tone ? "Set this company's mark as a multiple of the Carta mark" : undefined}
                style={{ ...sans, fontSize: FS.small, fontWeight: on ? 700 : 500, padding: "5px 11px", borderRadius: 4, whiteSpace: "nowrap",
                  border: `1px solid ${border}`, cursor: disabled ? "default" : "pointer",
                  background: bg, color }}>
                {p.label}
              </button>
            );
          })}
          {onReset && (
            <button onClick={() => !disabled && onReset()} disabled={disabled} title="Reset this company to its Carta mark"
              style={{ ...sans, fontSize: FS.small, fontWeight: 500, padding: "5px 11px", borderRadius: 4, whiteSpace: "nowrap",
                border: `1px solid var(--ink-color-global-border-subtle)`, cursor: disabled ? "default" : "pointer",
                background: "transparent", color: "var(--ink-color-global-text-subtle)" }}>
              ↺ Reset to Carta
            </button>
          )}
          <span style={{ ...sans, fontSize: FS.micro, color: MICRO, marginLeft: 4 }}>drag the slider, click the value to type, or pick a multiple of the Carta mark</span>
        </div>
      )}
    </div>
  );
}
