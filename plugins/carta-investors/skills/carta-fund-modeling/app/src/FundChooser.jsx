// Landing page: pick a firm, then load its console. Reads the firm registry
// (/api/firms) written by scripts/ingest-firm.mjs. Firm-agnostic — every card
// is data-driven from the registry, so adding a firm needs no code change.
import { useEffect, useState } from "react";
import { FS, tightSans, sans, inkNum, GLOBAL_CSS } from "./ui/theme.js";
import { Mark, H3 } from "./ui/components.jsx";

export default function FundChooser({ onPick }) {
  const [firms, setFirms] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/firms")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 401 ? "Not authorized" : `HTTP ${r.status}`))))
      .then(setFirms)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", display: "flex", justifyContent: "center" }}>
      <style>{GLOBAL_CSS}</style>
      <style>{`.firm-card:hover{border-color:var(--ink-button-background-color-primary-base-default)!important;transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.06)}`}</style>
      <div style={{ width: "100%", maxWidth: 760, padding: "72px 28px 56px" }}>
        <div style={{ ...tightSans, fontSize: FS.display, fontWeight: 700, color: "var(--ink-color-global-text-default)", lineHeight: 1.1 }}>Carta Fund Modeling</div>
        <div style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-subtle)", marginTop: 10, marginBottom: 36 }}>
          Pick a firm to open its funds, companies, and scenarios — built on Carta Fund Admin data.
        </div>

        {error && <div style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-feedback-negative-strong)" }}>Couldn’t load firms: {error}</div>}
        {!firms && !error && <div style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-text-subtle)" }}>Loading firms…</div>}
        {firms && firms.length === 0 && <div style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-text-subtle)" }}>No firms installed yet.</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {(firms || []).map((f) => (
            <button key={f.slug} data-testid={`firm-${f.slug}`} onClick={() => onPick(f.slug)}
              className="firm-card"
              style={{ textAlign: "left", cursor: "pointer", background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`,
                borderRadius: 0, padding: "20px 20px 18px", display: "flex", flexDirection: "column", gap: 14,
                transition: "border-color .15s, transform .15s, box-shadow .15s" }}>
              <Mark branding={{ mark: f.mark }} size={42} />
              <div>
                <H3 as="div" style={{ lineHeight: 1.2 }}>{f.name}</H3>
                <div style={{ ...inkNum, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 6 }}>
                  {f.funds} fund{f.funds === 1 ? "" : "s"} · NAV {f.navAsOf}
                </div>
              </div>
              <span style={{ ...sans, fontSize: FS.body, fontWeight: 600, color: "var(--ink-button-background-color-primary-base-default)", marginTop: 2 }}>Open workspace →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
