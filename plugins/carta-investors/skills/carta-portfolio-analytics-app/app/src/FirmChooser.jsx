// Minimal firm picker — the skill launches one firm per session, so this is a
// fallback (shown only if /api/firms returns more than one, or auto-select is
// skipped). Lists firms from /api/firms.
import { useEffect, useState } from "react";
import { FS, sans, serif } from "./ui/theme.js";
import { Mark } from "./ui/components.jsx";

export default function FirmChooser({ onPick }) {
  const [firms, setFirms] = useState(null);
  useEffect(() => {
    fetch("/api/firms").then((r) => r.json()).then((l) => setFirms(Array.isArray(l) ? l : [])).catch(() => setFirms([]));
  }, []);
  // Two firms can share a name; those get their Carta ID underneath so the user can tell them apart.
  const names = (firms || []).map((f) => f.name);
  const sharedNames = new Set(names.filter((n, i) => names.indexOf(n) !== i));

  return (
    <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "min(440px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <Mark size={34} />
          <div style={{ ...serif, fontSize: FS.h2, fontWeight: 700 }}>Portfolio Analytics</div>
        </div>
        {firms == null && <div style={{ color: "var(--ink-color-global-text-subtle)" }}>Loading firms…</div>}
        {firms && firms.length === 0 && (
          <div style={{ color: "var(--ink-color-global-text-subtle)", fontSize: FS.bodyLg }}>
            No firm data found. Ask Claude to build portfolio analytics for a firm first.
          </div>
        )}
        {firms && firms.map((f) => (
          <button key={f.slug} onClick={() => onPick(f.slug)} style={{ ...sans, display: "block", width: "100%", textAlign: "left",
            padding: "14px 16px", marginBottom: 8, borderRadius: 8, cursor: "pointer",
            border: `1px solid var(--ink-color-global-border-default)`, background: "var(--ink-color-global-surface-background-default)",
            color: "var(--ink-color-global-text-default)", fontSize: FS.bodyLg, fontWeight: 600 }}>
            {f.name}
            {sharedNames.has(f.name) && (
              <div style={{ color: "var(--ink-color-global-text-subtle)", fontSize: FS.body, fontWeight: 400 }}>
                Carta ID {f.firmId}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
