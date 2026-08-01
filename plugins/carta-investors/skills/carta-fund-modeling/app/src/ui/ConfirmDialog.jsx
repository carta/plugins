// Styled confirmation modal — replaces the browser's window.confirm(). Same
// backdrop / card / button chrome as ScenarioDialog so every dialog in the app
// reads as one system. Escape or a backdrop click cancels; the confirm button
// must be clicked (Enter is intentionally NOT bound, so a destructive action is
// never one stray keystroke away). Pass `danger` for destructive actions to get
// the red confirm button.
import { useEffect } from "react";
import { FS, sans } from "./theme.js";
import { Btn } from "./components.jsx";

export default function ConfirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(16,24,40,.34)",
        backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(440px, 100%)", background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 12,
          boxShadow: "0 18px 50px rgba(16,24,40,.28)", padding: "22px 24px 20px" }}>
        <div style={{ ...sans, fontSize: FS.h3, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{title}</div>
        {message && (
          <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.55, marginTop: 10, whiteSpace: "pre-line" }}>
            {message}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
          <Btn size="comfortable" onClick={onCancel}>{cancelLabel}</Btn>
          <Btn size="comfortable" kind={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
    </div>
  );
}
