// Carta lists only a staff user's active firm, so staff get search and are never auto-opened.
// Anyone else has no search, and their one firm opens itself unless it is `leftFirm`.
import { useEffect, useState } from "react";
import { FS, sans, serif, mono, GLOBAL_CSS } from "./ui/theme.js";
import { FirmTile } from "./ui/components.jsx";
import useIsWorker from "./state/useIsWorker.js";
import { FirmAccess, getJson } from "./firm-access.js";

const SEARCH_DELAY_MS = 300;

// A search answer carries no fund count, so a count shows only when the firm has one.
function cardFacts(f) {
  return [
    f.firmId && `Carta ID ${f.firmId}`,
    f.funds != null && `${f.funds} fund${f.funds === 1 ? "" : "s"}`,
  ].filter(Boolean).join(" · ");
}

function emptyMessage(q, isStaff, worker) {
  if (q) return "No firms matched your search.";
  if (isStaff) return "No firms to show. Search by firm name, firm UUID, or Carta ID.";
  // The local app is launched by Claude, which builds a firm's data; the Worker has no Claude.
  if (worker === false) return "No firm data found. Ask Claude to build portfolio analytics for a firm first.";
  return "Carta lists no firms for your account.";
}

export default function FirmChooser({ onPick, leftFirm = null, autoOpen = true }) {
  const [isStaff, setIsStaff] = useState(undefined); // undefined: loading; null: unknown
  const [firms, setFirms] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const worker = useIsWorker();
  const q = isStaff ? query.trim() : "";

  useEffect(() => {
    getJson("/api/me").then((me) => setIsStaff(FirmAccess.staffFlag(me))).catch(() => setIsStaff(null));
  }, []);

  // Wait for who the caller is. Staff: an empty search lists their active firm, otherwise search
  // after a pause in typing. Everyone else: their firms.
  useEffect(() => {
    if (isStaff === undefined) return;
    let live = true;
    // Covers the typing pause too, so the box shows it is working from the first keystroke.
    setSearching(!!q);
    const timer = setTimeout(() => {
      getJson(q ? `/api/firms?q=${encodeURIComponent(q)}` : "/api/firms")
        .then((list) => {
          if (!live) return;
          const found = Array.isArray(list) ? list : [];
          setFirms(found);
          setError(null);
          const pinned = new FirmAccess(isStaff, found).pinnedFirm;
          if (autoOpen && pinned && pinned !== leftFirm) onPick(pinned);
        })
        .catch((e) => { if (live) setError(String(e)); })
        .finally(() => { if (live) setSearching(false); });
    }, q ? SEARCH_DELAY_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [q, isStaff, onPick, leftFirm, autoOpen]);

  return (
    <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", display: "flex", justifyContent: "center" }}>
      <style>{GLOBAL_CSS}</style>
      <style>{`.firm-card:hover{border-color:var(--ink-button-background-color-primary-base-default)!important;transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.06)}`}</style>
      <div style={{ width: "100%", maxWidth: 760, padding: "72px 28px 56px" }}>
        <div style={{ ...serif, fontSize: FS.display, fontWeight: 700, lineHeight: 1.1 }}>Carta Portfolio Analytics</div>
        <div style={{ fontSize: FS.value, color: "var(--ink-color-global-text-subtle)", marginTop: 10, marginBottom: 36 }}>
          Pick a firm to open its companies, KPIs, and benchmarks — built on Carta Fund Admin data.
        </div>

        {isStaff === true && <div style={{ position: "relative", marginBottom: 24 }}>
          <input type="search" data-testid="firm-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by firm name, firm UUID, or Carta ID" aria-label="Search firms" aria-busy={searching} autoFocus
            style={{ ...sans, fontSize: FS.bodyLg, width: "100%", boxSizing: "border-box", padding: "12px 44px 12px 14px",
              color: "var(--ink-color-global-text-default)", background: "var(--ink-color-global-surface-background-default)",
              border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 0 }} />
          {searching && <span data-testid="firm-search-spinner" role="status" aria-label="Searching"
            style={{ position: "absolute", right: 14, top: "50%", width: 16, height: 16, marginTop: -8, boxSizing: "border-box",
              border: "2px solid var(--ink-color-global-border-subtle)", borderTopColor: "var(--ink-color-global-text-default)",
              borderRadius: "50%", animation: "pa-spin 0.8s linear infinite" }} />}
        </div>}

        {error && <div style={{ fontSize: FS.bodyLg, color: "var(--ink-color-global-feedback-negative-strong)" }}>Couldn’t load firms: {error}</div>}
        {!firms && !error && <div style={{ fontSize: FS.bodyLg, color: "var(--ink-color-global-text-subtle)" }}>Loading firms…</div>}
        {firms && firms.length === 0 && <div data-testid="no-firms" style={{ fontSize: FS.bodyLg, color: "var(--ink-color-global-text-subtle)" }}>
          {emptyMessage(q, isStaff, worker)}
        </div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {(firms || []).map((f) => (
            <button key={f.slug} data-testid={`firm-${f.slug}`} onClick={() => onPick(f.slug)} className="firm-card"
              style={{ ...sans, textAlign: "left", cursor: "pointer", background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)",
                borderRadius: 0, padding: "20px 20px 18px", display: "flex", flexDirection: "column", gap: 14,
                transition: "border-color .15s, transform .15s, box-shadow .15s" }}>
              <FirmTile size={42} />
              <div>
                <div style={{ ...serif, fontSize: FS.h3, fontWeight: 600, lineHeight: 1.2, color: "var(--ink-color-global-text-default)" }}>{f.name}</div>
                <div data-testid={`firm-facts-${f.slug}`} style={{ ...mono, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: 6 }}>
                  {cardFacts(f)}
                </div>
              </div>
              <span style={{ fontSize: FS.body, fontWeight: 600, color: "var(--ink-button-background-color-primary-base-default)", marginTop: 2 }}>Open workspace →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
