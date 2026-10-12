// Saved-views picker shared by the tabs that keep named filter snapshots
// (Company KPIs, Reporting health) — one control, so the two can't drift apart.
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FS, sans, MICRO } from "./theme.js";
import { Btn, TextInput, ddTriggerStyle, ChevronDownIcon, useDismissable, usePortalAnchor, Z, POPOVER_SHADOW } from "./components.jsx";

const NEG = "var(--ink-color-global-feedback-negative-strong)";

/** Ribbon "View: <name>" trigger and its saved-views panel. The tab owns what a
 *  view stores and says so in `hint`. `dirty` shows the • and offers Revert.
 *  `radioName` keeps two tabs' radio groups apart. */
export default function ViewControl({ views, viewId, dirty, onApply, onUpdate, onDelete, saving, setSaving, newName, setNewName, onSave, radioName, hint }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const panelRef = useRef(null);
  useDismissable(open, setOpen, [ref, panelRef]);
  // Portals to <body> — the sticky ribbon above traps a nested popover otherwise.
  const anchorRect = usePortalAnchor(open, ref);
  const pos = anchorRect && { top: anchorRect.bottom + 4, left: anchorRect.left };
  const current = views.find((v) => v.id === viewId);
  const label = current ? current.name : "Default";
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((o) => !o)} className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...ddTriggerStyle({ minWidth: 170 }), cursor: "pointer" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          View: {label}{dirty && <span title="Unsaved changes" style={{ fontWeight: 700 }}> •</span>}
        </span>
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>
      {open && createPortal(
        <div ref={panelRef} className="popin" style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0,
          visibility: pos ? "visible" : "hidden", ...sans, width: 280,
          background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`,
          borderRadius: 6, boxShadow: POPOVER_SHADOW, zIndex: Z.popover, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
            <div style={{ ...sans, fontWeight: 600, fontSize: FS.bodyLg }}>Select from your Saved Views</div>
            {viewId && (
              <span style={{ display: "flex", gap: 8, flex: "none" }}>
                {dirty && <Btn kind="link" style={{ fontSize: FS.small }} onClick={() => onApply(viewId)} title="Discard changes and restore the saved view">Revert</Btn>}
                <Btn kind="link" style={{ fontSize: FS.small }} onClick={onUpdate} title="Overwrite this view with the current filters">Update</Btn>
                <Btn kind="link" style={{ fontSize: FS.small, color: NEG }} onClick={onDelete}>Delete</Btn>
              </span>
            )}
          </div>
          {viewId && dirty && (
            <div style={{ ...sans, fontSize: FS.micro, color: MICRO, marginBottom: 8 }}>
              Unsaved changes — Update saves them to this view, Revert discards them.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
            {/* onClick (not just onChange) — a radio already checked fires no change
                event, so re-picking the current view/Default must still re-apply it
                and discard any manual edits made since. */}
            <label style={{ ...sans, display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: FS.value, cursor: "pointer" }}
              onClick={() => onApply(null)}>
              <input type="radio" name={radioName} checked={viewId == null} readOnly /> Default
            </label>
            {views.map((v) => (
              <label key={v.id} style={{ ...sans, display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", fontSize: FS.value, cursor: "pointer" }}
                onClick={() => onApply(v.id)}>
                <input type="radio" name={radioName} checked={viewId === v.id} readOnly /> {v.name}
              </label>
            ))}
          </div>
          {saving ? (
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <TextInput placeholder="View name…" value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onSave(); }} autoFocus style={{ flex: 1, minWidth: 120 }} />
              <Btn kind="primary" onClick={onSave} disabled={!newName.trim()}>Save</Btn>
              <Btn onClick={() => { setSaving(false); setNewName(""); }}>Cancel</Btn>
            </span>
          ) : (
            <Btn onClick={() => setSaving(true)}>+ Add View</Btn>
          )}
          <div style={{ ...sans, fontSize: FS.micro, color: MICRO, marginTop: 8 }}>
            {hint} Add a view first and configure after — edits flag it (•) until you Update or Revert.
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
