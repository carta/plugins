// Landing page: pick a firm, then load its console. Lists the caller's firms (/api/firms).
// Carta staff start with only their active firm, so they get a search box (name, firm UUID or
// Carta ID, /api/firms?q=) and are never auto-opened into a firm. Anyone else never sees search:
// one firm opens directly (unless the user just left it), several show as cards. Who is staff comes from /api/me; until that
// is known (or if it fails) there is no search and no auto-open. Firm-agnostic — every card
// is data-driven, so adding a firm needs no code change.
import { useEffect, useState } from "react";
import { FS, tightSans, sans, inkNum, GLOBAL_CSS } from "./ui/theme.js";
import { Mark, H3 } from "./ui/components.jsx";
import { FirmAccess, getJson } from "./firm-access.js";

const SEARCH_DELAY_MS = 300;

export default function FundChooser({ onPick, autoOpen = true }) {
  const [isStaff, setIsStaff] = useState(undefined); // undefined: loading; null: unknown
  const [firms, setFirms] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const q = isStaff ? query.trim() : "";

  useEffect(() => {
    getJson("/api/me").then((me) => setIsStaff(FirmAccess.staffFlag(me))).catch(() => setIsStaff(null));
  }, []);

  // Wait for who the caller is. Staff: an empty search lists their active firm, otherwise search
  // after a pause in typing. Everyone else: their firms.
  useEffect(() => {
    if (isStaff === undefined) return;
    let live = true;
    const timer = setTimeout(() => {
      getJson(q ? `/api/firms?q=${encodeURIComponent(q)}` : "/api/firms")
        .then((list) => {
          if (!live) return;
          const found = Array.isArray(list) ? list : [];
          setFirms(found);
          setError(null);
          const pinned = new FirmAccess(isStaff, found).pinnedFirm;
          if (autoOpen && pinned) onPick(pinned);
        })
        .catch((e) => { if (live) setError(String(e)); });
    }, q ? SEARCH_DELAY_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [q, isStaff, onPick, autoOpen]);

  const shown = firms || [];
  return (
    <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", display: "flex", justifyContent: "center" }}>
      <style>{GLOBAL_CSS}</style>
      <style>{`.firm-card:hover{border-color:var(--ink-button-background-color-primary-base-default)!important;transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.06)}`}</style>
      <div style={{ width: "100%", maxWidth: 760, padding: "72px 28px 56px" }}>
        <div style={{ ...tightSans, fontSize: FS.display, fontWeight: 700, color: "var(--ink-color-global-text-default)", lineHeight: 1.1 }}>Carta Fund Modeling</div>
        <div style={{ ...sans, fontSize: FS.value, color: "var(--ink-color-global-text-subtle)", marginTop: 10, marginBottom: 36 }}>
          Pick a firm to open its funds, companies, and scenarios — built on Carta Fund Admin data.
        </div>

        {isStaff === true && <input type="search" data-testid="firm-search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by firm name, firm UUID, or Carta ID" aria-label="Search firms" autoFocus
          style={{ ...sans, fontSize: FS.bodyLg, width: "100%", boxSizing: "border-box", padding: "12px 14px", marginBottom: 24,
            color: "var(--ink-color-global-text-default)", background: "var(--ink-color-global-surface-background-default)",
            border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 0 }} />}

        {error && <div style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-feedback-negative-strong)" }}>Couldn’t load firms: {error}</div>}
        {!firms && !error && <div style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-text-subtle)" }}>Loading firms…</div>}
        {firms && firms.length === 0 && <div data-testid="no-firms" style={{ ...sans, fontSize: FS.bodyLg, color: "var(--ink-color-global-text-subtle)" }}>
          {q ? "No firms matched your search." : isStaff ? "No firms to show. Search by firm name, firm UUID, or Carta ID." : "No firms to show."}
        </div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {shown.map((f) => (
            <button key={f.slug} data-testid={`firm-${f.slug}`} onClick={() => onPick(f.slug)}
              className="firm-card"
              style={{ textAlign: "left", cursor: "pointer", background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`,
                borderRadius: 0, padding: "20px 20px 18px", display: "flex", flexDirection: "column", gap: 14,
                transition: "border-color .15s, transform .15s, box-shadow .15s" }}>
              <Mark branding={{ mark: f.mark }} size={42} />
              <div>
                <H3 as="div" style={{ lineHeight: 1.2 }}>{f.name}</H3>
                <div style={{ ...inkNum, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 6 }}>
                  {f.funds} fund{f.funds === 1 ? "" : "s"}{f.navAsOf ? ` · NAV ${f.navAsOf}` : ""}
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
