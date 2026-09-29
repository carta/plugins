import { useState, useRef, useEffect } from "react";
import { PencilIcon, TextInput } from "./components.jsx";
import { FS, mono } from "./theme.js";
import { toInputValue, fromInputValue } from "../model/pendingEdits.js";

/** A table figure that turns into a number input on click. Enter or blur commits the
 *  parsed value (a non-number is ignored and the input closes), Escape cancels. The
 *  caller decides what a commit means — this component only edits text. */
export default function EditableValue({ value, unit, display, onCommit, ariaLabel }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [width, setWidth] = useState(110);
  const ref = useRef(null);
  const spanRef = useRef(null);
  // preventScroll: a focus-scroll fires the pivot's scroll listeners (sticky
  // clone, company band), whose setState re-renders the whole grid — the lag.
  useEffect(() => { if (editing) { ref.current?.focus({ preventScroll: true }); ref.current?.select(); } }, [editing]);

  const open = () => {
    // Fit the input inside the cell's content box for the same reason: an input
    // wider than the cell is clipped, and focusing a clipped input auto-scrolls.
    const cell = spanRef.current?.closest("td");
    let w = 110;
    if (cell) {
      const cs = getComputedStyle(cell);
      const inner = cell.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      if (inner > 0) w = Math.max(50, Math.min(110, inner));
    }
    setWidth(w);
    setText(toInputValue(value, unit));
    setEditing(true);
  };
  const commit = () => {
    const n = fromInputValue(text, unit);
    setEditing(false);
    if (n != null) onCommit(n);
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
  };

  if (editing) {
    return (
      <TextInput ref={ref} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKeyDown}
        inputMode="decimal" aria-label={ariaLabel} style={{ ...mono, width, height: 26, fontSize: FS.small, textAlign: "right" }} />
    );
  }
  return (
    <span ref={spanRef} style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
      {display}
      <button type="button" onClick={open} aria-label={`Edit ${ariaLabel}`} className="cell-edit"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 0, color: "var(--ink-color-global-text-subtle)" }}>
        <PencilIcon size={11} strokeWidth={1.6} />
      </button>
    </span>
  );
}
