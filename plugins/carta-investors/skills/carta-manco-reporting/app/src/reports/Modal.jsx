import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { sans, INK, PAPER, LINE, FS } from "../ui/theme.js";
import { POPOVER_SHADOW } from "../ui/components.jsx";

// A centred dialog over a dimmed page. Escape or a click outside closes it
// unless `busy` — a share in flight shouldn't be dismissed by a stray click.
export default function Modal({ title, onClose, children, footer, width = 520, busy = false }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  // The panel takes focus only when nothing inside it has (an autoFocus input, say).
  useEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
  }, []);

  return createPortal(
    <div
      style={S.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
           style={{ ...S.panel, width: `min(${width}px, 94vw)` }}>
        <header style={S.header}>
          <h2 style={S.title}>{title}</h2>
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose} style={S.close}>×</button>
        </header>
        <div style={S.body}>{children}</div>
        {footer && <footer style={S.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

const S = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 1100,
    background: "rgba(20, 24, 24, 0.32)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  panel: {
    ...sans, background: PAPER, color: INK, borderRadius: 4,
    boxShadow: POPOVER_SHADOW, maxHeight: "86vh", display: "flex", flexDirection: "column",
    outline: "none",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 20px 12px", borderBottom: `1px solid ${LINE}`,
  },
  title: { ...sans, margin: 0, fontSize: FS.h3, fontWeight: 600, lineHeight: 1.3 },
  close: {
    ...sans, border: "none", background: "transparent", color: INK,
    fontSize: 22, lineHeight: 1, cursor: "pointer", padding: 4,
  },
  body: { padding: "16px 20px", overflowY: "auto", fontSize: FS.bodyLg, lineHeight: 1.5 },
  footer: {
    display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8,
    padding: "12px 20px 16px", borderTop: `1px solid ${LINE}`,
  },
};
