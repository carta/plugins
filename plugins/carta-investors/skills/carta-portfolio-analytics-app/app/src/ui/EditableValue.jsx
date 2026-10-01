import { useState, useRef, useEffect } from "react";
import { PencilIcon, TextInput } from "./components.jsx";
import { FS, mono, sans } from "./theme.js";
import { toInputValue, fromInputValue, toQualInput, fromQualInput } from "../model/pendingEdits.js";

/** A table figure that turns into an editor on click: a number input, or for a
 *  qualitative `kind` a Yes/No select ("boolean"), a date picker ("date") or a text
 *  input ("text"), where `value` is the reported string. Enter or blur commits the
 *  parsed value (an invalid one is ignored and the editor closes), Escape cancels. The
 *  caller decides what a commit means — this component only edits text. */
export default function EditableValue({ value, unit, kind, display, badge, onCommit, ariaLabel }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [width, setWidth] = useState(110);
  const ref = useRef(null);
  const spanRef = useRef(null);
  // Closing unmounts the editor, and the browser may blur it on the way out; that late
  // blur must not commit again (a select's stale text would undo the pick, and an
  // Escape would turn into a commit).
  const closed = useRef(false);
  // preventScroll: a focus-scroll fires the pivot's scroll listeners (sticky
  // clone, company band), whose setState re-renders the whole grid — the lag.
  useEffect(() => { if (editing) { ref.current?.focus({ preventScroll: true }); ref.current?.select?.(); } }, [editing]);

  const open = () => {
    // Fit the input inside the cell's content box for the same reason: an input
    // wider than the cell is clipped, and focusing a clipped input auto-scrolls.
    const cell = spanRef.current?.closest("td");
    let w = 110;
    if (cell) {
      const cs = getComputedStyle(cell);
      const inner = cell.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      if (inner > 0) w = Math.max(50, Math.min(kind === "date" ? 140 : 110, inner));
    }
    setWidth(w);
    setText(kind ? toQualInput(value, kind) : toInputValue(value, unit));
    closed.current = false;
    setEditing(true);
  };
  const commit = (raw = text) => {
    if (closed.current) return;
    closed.current = true;
    const n = kind ? fromQualInput(raw, kind) : fromInputValue(raw, unit);
    setEditing(false);
    if (n != null) onCommit(n);
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); closed.current = true; setEditing(false); }
  };

  if (editing && kind === "boolean") {
    // Picking an option is the commit — there is nothing further to type.
    return (
      <select ref={ref} className="ink-input" value={text} aria-label={ariaLabel}
        onChange={(e) => { setText(e.target.value); commit(e.target.value); }} onBlur={() => commit()} onKeyDown={onKeyDown}
        style={{ ...sans, width, height: 26, fontSize: FS.small, padding: "0 4px", boxSizing: "border-box",
          background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" }}>
        {text === "" && <option value="" disabled>—</option>}
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }
  if (editing) {
    const isDate = kind === "date";
    return (
      <TextInput ref={ref} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => commit()} onKeyDown={onKeyDown}
        type={isDate ? "date" : "text"} inputMode={kind ? undefined : "decimal"} aria-label={ariaLabel}
        style={{ ...(kind ? sans : mono), width, height: 26, fontSize: FS.small, textAlign: kind ? "left" : "right",
          ...(isDate && { padding: "0 4px" }) }} />
    );
  }
  return (
    // The value sits flush on the cell's edge; the status badge and pencil float just past
    // it (in the cell's right padding), so neither reserves space inside the value.
    <span ref={spanRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "flex-end",
      ...(kind === "text" && { maxWidth: "100%", minWidth: 0 }) }}>
      {kind === "text" ? <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span> : display}
      <span style={CELL_INDICATORS}>
        {badge}
        <button type="button" onClick={open} aria-label={`Edit ${ariaLabel}`} className="cell-edit"
          style={{ flex: "none", background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 0, color: "var(--ink-color-global-text-subtle)" }}>
          <PencilIcon size={11} strokeWidth={1.6} />
        </button>
      </span>
    </span>
  );
}

/** The status badge + pencil group, laid out to the right of the value it belongs to.
 *  Exported so non-editable cells float their status badge the same way. */
export const CELL_INDICATORS = { position: "absolute", left: "100%", top: "50%", transform: "translateY(-50%)",
  marginLeft: 4, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" };
