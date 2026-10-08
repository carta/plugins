import { useEffect } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn, Badge } from "../../ui/components.jsx";
import { PLAN_MODES, modeLabel } from "../../model/construction/plan.js";
import { fmtMIn } from "../../ui/format.js";

function ModeCard({ mode, onPick }) {
  const off = !mode.ready;
  return (
    <button type="button" data-testid={`mode-${mode.id}`} aria-disabled={off || undefined}
      onClick={off ? undefined : () => onPick(mode.id)}
      style={{ ...sans, display: "block", width: "100%", textAlign: "left", padding: "14px 16px", borderRadius: 8,
        border: "1px solid var(--ink-color-global-border-subtle)", background: "var(--ink-color-global-surface-background-default)",
        cursor: off ? "not-allowed" : "pointer", opacity: off ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>
        {mode.label}
        {off && <Badge tone="neutral">Coming soon</Badge>}
      </div>
      <div style={{ fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.5, marginTop: 4 }}>{mode.blurb}</div>
    </button>
  );
}

function CopyList({ plans, onCopy }) {
  const rows = [...plans].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  return (
    <div data-testid="copy-list" style={{ marginTop: 20 }}>
      <div style={{ ...sans, fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>Or copy a plan you already have</div>
      <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "2px 0 10px" }}>
        Starts with every assumption from that plan, so you only change what's different. The original stays as it is.
      </div>
      <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
        {rows.map((p) => (
          <button key={p.id} type="button" data-testid={`copy-plan-${p.id}`} onClick={() => onCopy(p)}
            style={{ ...sans, display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "10px 14px", borderRadius: 8, cursor: "pointer",
              border: "1px solid var(--ink-color-global-border-subtle)", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: FS.body, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            <Badge tone={p.mode === "light" ? "neutral" : "info"}>{modeLabel(p.mode)}</Badge>
            <span style={{ fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", minWidth: 60, textAlign: "right" }}>
              {p.general?.committed > 0 ? fmtMIn(p.general.committed, p.general.currency) : "—"}
            </span>
            <span style={{ fontSize: FS.small, color: "var(--ink-color-global-link-default)", whiteSpace: "nowrap" }}>Copy</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ModeChooser({ onPick, onCancel, plans = [], onCopy }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div role="dialog" aria-modal="true" aria-label="How do you want to build this fund?" onMouseDown={onCancel} data-testid="mode-chooser"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(16,24,40,.34)",
        backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 100%)", background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 12,
          boxShadow: "0 18px 50px rgba(16,24,40,.28)", padding: "22px 24px 20px" }}>
        <div style={{ ...sans, fontSize: FS.h3, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>How do you want to build this fund?</div>
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {PLAN_MODES.map((m) => <ModeCard key={m.id} mode={m} onPick={onPick} />)}
        </div>
        {onCopy && plans.length > 0 && <CopyList plans={plans} onCopy={onCopy} />}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <Btn size="comfortable" onClick={onCancel} data-testid="mode-cancel">Cancel</Btn>
        </div>
      </div>
    </div>
  );
}
