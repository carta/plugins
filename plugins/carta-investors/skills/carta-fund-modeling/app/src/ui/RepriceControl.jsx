// Reprice control — a clean flat slider (cobalt fill, square thumb) with a
// tabular value you can click to type, quick preset chips, and a live uplift
// readout. No serif value, no anchor labels, no write-off/exit scale, no Reset
// button (the Carta chip resets) — a minimal Swiss take, not the legacy tape. One
// component, two sizes: `compact` (inline table cell) and full (expanded, with
// preset chips). Mode-agnostic — the caller passes a resolved config.
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { FS, sans, inkNum, MICRO, TAPE_THUMB } from "./theme.js";
import { fmtM } from "./format.js";
import { useAnimated } from "./components.jsx";
import { trackClick } from "../analytics.js";

const clampTo = (v, min, max) => Math.min(max, Math.max(min, v));
const near = (a, b, eps) => Math.abs(a - b) < eps;

/** @param presets [{v, label}]  @param fmtVal (v)=>string  @param compact bool
 *  @param hidePresets bool — skip the preset chips and draw a Carta-mark tick on the track instead
 *  @param showTick bool — force the Carta-mark tick even when preset chips are shown (expanded view)
 *  @param trackId elementId for a committed value change — the caller names it (one component, four
 *    sliders); omit it to track nothing
 *  @param hideTick bool — suppress the Carta-mark tick outright, overriding hidePresets/showTick/compact
 *   (e.g. Companies.jsx's Dilution slider, whose resetValue sits at 0 — the track's own left edge, where
 *   a tick is redundant)
 *  @param railWidth number — fixed px width for the slider track (expanded view only); omit for the
 *   default full-width (100%) track. Lets two side-by-side controls (e.g. Companies.jsx's Mark and
 *   Dilution sliders) match rail length regardless of what each one carries as `trailing` content.
 *   Independent of the preset-chip row (if any), which always renders in its own row below.
 *  @param trailing node — extra content rendered beside the slider, in the same row (e.g. Companies.jsx's
 *   "Realize at this mark" toggle next to the Mark slider, or its "Reserve earmarked" readout next to
 *   the Dilution slider).
 *  @param resetLabel string — text for the Reset action, default "Reset to Carta". When a preset's
 *   value lands exactly on `resetValue` (e.g. sentimentPresets' "1×" entry), Reset merges INTO that
 *   preset's chip (no icon, no separate trailing button, no redundant same-destination chip) — pass
 *   a plainer label like "Carta mark" for that merged case, since "↺ Reset to Carta" reads oddly
 *   next to a chip row of bare multiples.
 *  @param inlineValue bool — value readout sits beside the slider (small, like `compact`'s numSize)
 *   instead of in its own row above it at full display size. Unlike `compact`, the slider keeps its
 *   full `railWidth` and no uplift tag renders — for full-width sliders whose value is secondary to
 *   the control itself (e.g. Companies.jsx's exit-timing quarter slider). Ignores `trailing`.
 *  @param presetTicks bool — render every preset as a thin tick mark on the track (Reserves.jsx's
 *   AllocBar base-commitment line) instead of its own chip button below the slider. Presets stay
 *   reachable by dragging near a tick (the existing snap-on-drag logic already snaps to preset
 *   values) — this only changes how they're surfaced, not whether they're clickable as chips. */
// `disabled` is truly inert. `locked` keeps the control interactive-but-muted:
// the slider/presets/value-input still fire onChange so the parent setter can
// no-op and surface a "Baseline is read-only" warning — and because the parent
// never updates `value`, the control stays put / snaps back on its own.
export default function RepriceControl({ value, onChange, onReset, fmtVal, min = 0, max, step = 0.05, presets = [], resetValue, uplift = 0, disabled, locked, compact, hidePresets, hideReadout, showTick, trackId, hideTick, railWidth, trailing, resetLabel = "Reset to Carta", onDragStart, onDragEnd, onDraggingChange, hideValueEdit, inlineValue, presetTicks }) {
  const v = value ?? 0;
  const trackCommit = () => { if (trackId) trackClick(trackId); };
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
  const dragStartRef = useRef(null);

  // When v changes from outside (parent state sync after release, external reset),
  // clear the local override — but only when not actively dragging.
  useEffect(() => {
    if (!draggingRef.current) setDragVal(null);
  }, [v]);

  const displayed = dragVal ?? clampTo(v, min, max);
  const fill = max > min ? ((displayed - min) / (max - min)) * 100 : 0;

  // Single Carta-mark tick (existing behavior) vs. one tick per preset
  // (presetTicks — Reserves.jsx's AllocBar base-commitment-line style, swapped
  // in for the chip row entirely). Either way this resolves to a list of
  // {v, label, pct} so the measurement effect below only has one shape to handle.
  const tickEnabled = !hideTick && (compact || hidePresets || showTick || presetTicks) && resetValue != null && max > min;
  const showSingleTick = tickEnabled && !presetTicks;
  const tickList = !hideTick && presetTicks && max > min
    ? presets.map((p) => ({ v: p.v, label: p.label, pct: ((clampTo(p.v, min, max) - min) / (max - min)) * 100 }))
    : showSingleTick
    ? [{ v: resetValue, label: "Carta mark", pct: ((clampTo(resetValue, min, max) - min) / (max - min)) * 100 }]
    : [];

  // Tick position(s) in px relative to the wrapping div. An overlay can't inherit
  // webkit's thumb math, so mirror it from the measured track: the thumb center
  // travels TAPE_THUMB/2 → trackWidth − TAPE_THUMB/2 (span trackWidth − TAPE_THUMB);
  // offsetLeft absorbs any UA margin. useLayoutEffect sets it pre-paint (no flash).
  const [tickLefts, setTickLefts] = useState(null);
  const tickPctsKey = tickList.map((t) => t.pct).join(",");
  useLayoutEffect(() => {
    const el = rangeRef.current;
    if (!tickList.length || !el) { setTickLefts(null); return; }
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      setTickLefts(tickList.map((t) => el.offsetLeft + TAPE_THUMB / 2 + (w - TAPE_THUMB) * (t.pct / 100)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tickPctsKey]);

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

  // The window shrinks near an endpoint so the zone can't extend past min/max — otherwise
  // a drag all the way to 0 snaps back.
  const snapToCartaMark = (val) => {
    if (!tickEnabled) return val;
    const distToNearestEnd = Math.min(resetValue - min, max - resetValue);
    const effectiveWindow = Math.min(cartaSnapWindow, Math.max(0, distToNearestEnd - step));
    return effectiveWindow > 0 && near(val, resetValue, effectiveWindow) ? resetValue : val;
  };

  const handlePointerDown = () => {
    if (locked) return; // no drag override on a read-only slider
    draggingRef.current = true;
    dragStartRef.current = clampTo(v, min, max);
    setDragVal(dragStartRef.current);
    onDragStart?.();
    // Separate from onDragStart/onDragEnd above (which also fire from instant
    // chip/reset clicks, by design — see the chip click comment below): this
    // one reflects a REAL pointer-down-drag-pointer-up gesture only, so
    // callers (e.g. the Returns-preview fade-unchanged-rows feature) can tell
    // "actively dragging" from "just jumped to a preset" and never get stuck.
    onDraggingChange?.(true);
  };

  const handlePointerUp = () => {
    if (locked) return;
    draggingRef.current = false;
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const held = dragVal ?? clampTo(v, min, max);
    const committed = snapToCartaMark(held);
    if (committed !== held) {
      setDragVal(committed);
      onChange(committed);
    }
    // Commit-only: tracking onSlide would emit one event per pointer-move.
    if (start != null && committed !== start) trackCommit();
    onDragEnd?.();
    onDraggingChange?.(false);
  };

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const startEdit = () => { if (disabled) return; setText(String(+displayed.toFixed(2))); setEditing(true); };
  const commit = () => {
    const n = parseFloat(text);
    if (!isNaN(n)) { trackCommit(); onChange(clampTo(n, min, max)); }
    setEditing(false);
  };

  const numSize = compact || inlineValue ? FS.value : FS.display;
  const valueEl = hideValueEdit ? (
    // A raw typed number here would mean the underlying step count (e.g. a
    // quarter offset), not the readable label shown — much harder for users
    // to get right than dragging or typing a percentage/dollar value, so this
    // readout skips the click-to-type affordance entirely.
    <span style={{ ...inkNum, fontSize: numSize, fontWeight: 700, color: "var(--ink-color-global-text-default)", letterSpacing: "-0.02em", lineHeight: 1,
      minWidth: compact ? 52 : 96, display: "inline-block", textAlign: compact ? "right" : "left" }}>
      {fmtVal(displayed)}
    </span>
  ) : editing ? (
    <input ref={inputRef} className="numin" type="text" inputMode="decimal" value={text} disabled={disabled}
      onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(clampTo(n, min, max)); }}
      onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{ ...inkNum, width: compact ? 60 : 110, fontSize: numSize, fontWeight: 700, padding: "1px 6px", background: "transparent", color: "var(--ink-color-global-text-default)", textAlign: compact ? "right" : "left", letterSpacing: "-0.02em" }} />
  ) : (
    <button onClick={locked ? () => onChange(displayed) : startEdit}
      title={locked ? "Locked — duplicate into a scenario to edit" : "Click to type an exact value"} disabled={disabled}
      style={{ ...inkNum, fontSize: numSize, fontWeight: 700, color: "var(--ink-color-global-text-default)", letterSpacing: "-0.02em", lineHeight: 1,
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
      style={{ ...inkNum, fontSize: FS.micro, fontWeight: 600, width: 82, textAlign: "right", whiteSpace: "nowrap",
        color: !moved ? "var(--ink-color-global-text-subtle)" : uplift >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>
      {!moved ? "FV —" : `FV ${uplift >= 0 ? "▲" : "▼"} ${fmtM(Math.abs(aUplift))}`}
    </span>
  );
  const slider = (
    <div style={{ position: "relative", ...(compact ? { width: 92 } : { width: railWidth ?? "100%" }) }}>
      <input ref={rangeRef} className="tape" type="range" min={min} max={max} step={step} value={displayed} disabled={disabled}
        aria-label="reprice" title={locked ? "Locked — duplicate into a scenario to edit" : undefined}
        style={{ "--fill": fill + "%", height: compact ? 20 : 28, width: "100%", cursor: locked ? "not-allowed" : undefined }}
        onChange={(e) => onSlide(e.target.value)}
        onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} />
      {tickLefts != null && tickLefts.map((left, i) => (
        presetTicks ? (
          // Hairline cohort-tick style, matching CohortStanding.jsx's Rail —
          // thin (1px), short, MICRO grey — a quiet reference mark, not a
          // boundary/snap indicator (that's the single-tick style below).
          <span key={tickList[i].v} aria-hidden title={tickList[i].label} style={{ position: "absolute",
            left, top: "50%", transform: "translate(-50%, -50%)",
            width: 1, height: "55%",
            background: MICRO,
            pointerEvents: "none" }} />
        ) : (
          <span key={tickList[i].v} aria-hidden title={tickList[i].label} style={{ position: "absolute",
            left,
            top: "50%", transform: "translate(-50%, -50%)",
            width: 2, height: "70%",
            background: "var(--ink-color-global-surface-background-default)", boxShadow: `0 0 0 1px var(--ink-button-background-color-primary-base-default)`,
            pointerEvents: "none" }} />
        )
      ))}
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
  // Preset chips + Reset button — always their own row below the slider. A
  // preset whose value lands exactly on `resetValue` (e.g. the sentiment ramp's
  // "1×" entry) IS the Carta mark, so it merges with the Reset action instead of
  // rendering both a redundant preset chip AND a separate trailing Reset button.
  const resetEps = Math.max(step / 2, (max - min) / 400);
  const resetSlotShown = onReset && resetValue != null && presets.some((p) => near(p.v, resetValue, resetEps));
  const chipButtons = !hidePresets && !presetTicks && presets.length > 0 && (
    <>
      {presets.map((p) => {
        const isResetSlot = onReset && resetValue != null && near(p.v, resetValue, resetEps);
        const on = near(displayed, p.v, resetEps);
        // Sentiment presets carry a red→green `tone`: color the chip with it
        // (filled when active). Toneless presets keep the neutral Ink style. The
        // merged reset slot is styled EXACTLY like any other preset, so it shows
        // selected the same way any other active preset chip does — only its
        // label and click target (full Reset, not just this value) differ.
        const border = p.tone ?? (on ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-border-subtle)");
        const bg = p.tone ? (on ? p.tone : "transparent") : (on ? "var(--accent-soft)" : "transparent");
        const color = p.tone ? (on ? "#fff" : p.tone) : (on ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-text-subtle)");
        // Chip clicks are an instant jump, not a drag — but the table's row-order
        // freeze (Companies.jsx's `frozenOrder`) only engages on `onDragStart`, so
        // without this a chip click reprices the company AND re-sorts the table in
        // the same tick, jumping the row. Firing onDragStart here (no matching
        // onDragEnd — the same as a real drag, order stays frozen until a header
        // click) makes a chip click freeze order exactly like dragging the slider.
        if (isResetSlot) {
          return (
            <button key={p.label} onClick={() => { if (disabled) return; onDragStart?.(); trackClick("FundModeling.Reprice.Reset"); onReset(); }} disabled={disabled}
              title="Reset this company to its Carta mark"
              style={{ ...sans, fontSize: FS.small, fontWeight: on ? 700 : 500, padding: "5px 11px", borderRadius: 4, whiteSpace: "nowrap",
                border: `1px solid ${border}`, cursor: disabled ? "default" : "pointer",
                background: bg, color }}>
              {resetLabel}
            </button>
          );
        }
        return (
          <button key={p.label} onClick={() => { if (disabled) return; onDragStart?.(); trackClick("FundModeling.Reprice.Preset"); onChange(p.v); }} disabled={disabled}
            title={p.tone ? "Set this company's mark as a multiple of the Carta mark" : undefined}
            style={{ ...sans, fontSize: FS.small, fontWeight: on ? 700 : 500, padding: "5px 11px", borderRadius: 4, whiteSpace: "nowrap",
              border: `1px solid ${border}`, cursor: disabled ? "default" : "pointer",
              background: bg, color }}>
            {p.label}
          </button>
        );
      })}
      {onReset && !resetSlotShown && (
        <button onClick={() => { if (disabled) return; onDragStart?.(); trackClick("FundModeling.Reprice.Reset"); onReset(); }} disabled={disabled} title="Reset this company to its Carta mark"
          style={{ ...sans, fontSize: FS.small, fontWeight: 500, padding: "5px 11px", borderRadius: 4, whiteSpace: "nowrap",
            border: `1px solid var(--ink-color-global-border-subtle)`, cursor: disabled ? "default" : "pointer",
            background: "transparent", color: "var(--ink-color-global-text-subtle)" }}>
          ↺ {resetLabel}
        </button>
      )}
    </>
  );
  // presetTicks drops the numeric chip row, but the Reset action still needs a
  // click target — ticks are non-interactive (Reserves.jsx's AllocBar line is
  // purely visual too), so this is the one preset-adjacent control that survives.
  const resetButton = presetTicks && onReset && (
    <button onClick={() => { if (disabled) return; onDragStart?.(); trackClick("FundModeling.Reprice.Reset"); onReset(); }} disabled={disabled} title="Reset this company to its Carta mark"
      style={{ ...sans, fontSize: FS.small, fontWeight: 500, padding: "5px 11px", borderRadius: 4, whiteSpace: "nowrap",
        border: `1px solid var(--ink-color-global-border-subtle)`, cursor: disabled ? "default" : "pointer",
        background: "transparent", color: "var(--ink-color-global-text-subtle)" }}>
      ↺ {resetLabel}
    </button>
  );
  if (inlineValue) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: locked ? 0.5 : 1 }}>
        {valueEl}
        {slider}
        {(chipButtons || resetButton) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {chipButtons}{resetButton}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: locked ? 0.5 : 1 }}>
      {/* expanded view: value only — the company-FV / LP / carry split is shown
          on the detail line in Companies.jsx, so no duplicate FV figure here */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>{valueEl}</div>
      {/* slider + its preset-chip row stay paired in their own column so `trailing`
          (which can grow tall, e.g. Companies.jsx's Realize toggle + exit-timing
          detail) never pushes the chips away from the slider they belong to. */}
      {trailing ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {slider}
            {(chipButtons || resetButton) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {chipButtons}{resetButton}
              </div>
            )}
          </div>
          {trailing}
        </div>
      ) : (
        <>
          {slider}
          {(chipButtons || resetButton) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {chipButtons}{resetButton}
              <span style={{ ...sans, fontSize: FS.micro, color: MICRO, marginLeft: 4 }}>drag the slider, click the value to type, or pick a multiple of the Carta mark</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
