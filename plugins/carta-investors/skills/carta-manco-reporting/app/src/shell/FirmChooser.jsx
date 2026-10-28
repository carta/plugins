// Shown instead of the auto-load screen when useLoadFirm.js can't open a firm with no extra
// click. Who sees this, and who additionally gets search: DEPLOY.md's "Which firm opens".
import { useEffect, useState } from "react";
import { CartaLogo } from "../ui/components.jsx";
import { FS, INK, FAINT, LINE, PAPER, FULL_PAGE_COVER } from "../ui/theme.js";

const SEARCH_DELAY_MS = 300;

export default function FirmChooser({ isStaff, firms, onPick }) {
  // Only a confirmed non-staff user is limited to their own held firms with no way to look
  // further — the same resolved-false check pinnedFirm (useLoadFirm.js) uses for auto-select.
  // `null` (isStaff unknown, or the lookup failed) gets search too: search goes through
  // /api/firms?q=, Carta's own list_contexts, and every pick passes authorizedFirm(), so
  // showing it never widens access — while hiding it from someone who turns out to be staff
  // (who typically hold no firm of their own) would leave them with no way to continue.
  const canSearch = isStaff !== false;
  const [query, setQuery] = useState("");
  const [list, setList] = useState(firms);
  const q = canSearch ? query.trim() : "";

  useEffect(() => {
    if (!canSearch) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      fetch(`/api/firms?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((found) => { if (live) setList(Array.isArray(found) ? found : []); })
        .catch(() => { if (live) setList([]); });
    }, q ? SEARCH_DELAY_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [q, canSearch]);

  return (
    <div style={{ ...FULL_PAGE_COVER, display: "flex", justifyContent: "center", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 560, padding: "88px 28px 56px" }}>
        <CartaLogo size={32} style={{ marginBottom: 20 }} />
        <div style={{ fontSize: FS.h2, fontWeight: 500, marginBottom: 6 }}>Choose a firm</div>
        <div style={{ fontSize: FS.bodyLg, color: FAINT, marginBottom: 24 }}>
          {canSearch ? "Search by firm name to open its ManCo reporting." : "Pick which firm's ManCo reporting to open."}
        </div>

        {canSearch && (
          <input type="search" data-testid="firm-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by firm name" aria-label="Search firms" autoFocus
            style={{ fontSize: FS.bodyLg, width: "100%", boxSizing: "border-box", padding: "10px 12px", marginBottom: 20,
              color: INK, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 0, fontFamily: "inherit" }} />
        )}

        {list.length === 0 && (
          <div style={{ fontSize: FS.bodyLg, color: FAINT }}>
            {q ? "No firms matched your search." : "No firms to show."}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column" }}>
          {list.map((f) => (
            <button key={f.slug} data-testid={`firm-${f.slug}`} onClick={() => onPick(f.slug)}
              style={{ textAlign: "left", cursor: "pointer", background: PAPER, border: "none", borderBottom: `1px solid ${LINE}`,
                padding: "14px 2px", fontSize: FS.value, color: INK, fontFamily: "inherit" }}>
              {f.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
