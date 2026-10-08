import { useEffect } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn } from "../../ui/components.jsx";
import { FEE_BASES } from "../../model/construction/plan.js";

export default function FeeBasisPicker({ value, rate, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="What is this fee charged on?" data-testid="fee-basis-picker" onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(16,24,40,.34)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 100%)", maxHeight: "90vh", overflow: "auto", background: "var(--ink-color-global-surface-background-default)",
          border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 12, boxShadow: "0 18px 50px rgba(16,24,40,.28)", padding: "22px 24px 20px" }}>
        <div style={{ ...sans, fontSize: FS.h3, fontWeight: 700 }}>What is this fee charged on?</div>
        <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "6px 0 14px" }}>
          Each month the fee is {rate != null ? `${+(rate * 100).toFixed(2)}%` : "the tier's rate"} a year, divided by 12, times the amount below.
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {FEE_BASES.map((b) => {
            const on = b.id === value;
            return (
              <button key={b.id} type="button" data-testid={`basis-option-${b.id}`} aria-pressed={on} onClick={() => onPick(b.id)}
                style={{ ...sans, textAlign: "left", padding: "12px 14px", borderRadius: 8, cursor: "pointer",
                  border: on ? "2px solid var(--ink-button-background-color-primary-base-default)" : "1px solid var(--ink-color-global-border-subtle)",
                  background: on ? "var(--accent-soft)" : "var(--ink-color-global-surface-background-default)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>
                  {b.label}{on && <span style={{ fontSize: FS.micro, fontWeight: 600, color: "var(--ink-button-background-color-primary-base-default)" }}>Selected</span>}
                </div>
                <div style={{ fontSize: FS.small, color: "var(--ink-color-global-text-default)", marginTop: 4, lineHeight: 1.45 }}>{b.blurb}</div>
                <div style={{ fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 2, lineHeight: 1.45 }}>{b.shape}</div>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Btn size="comfortable" onClick={onClose} data-testid="basis-cancel">Cancel</Btn>
        </div>
      </div>
    </div>
  );
}
