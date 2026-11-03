// Shown instead of the auto-load screen when useLoadFirm.js can't open a firm with no extra
// click. Who sees this, and who additionally gets search: DEPLOY.md's "Which firm opens".
// Card grid (not ChooserPage's own ChooserButton rows) to match carta-fund-modeling's
// FundChooser — the two apps' "pick a firm" screens should read as the same page.
import { useEffect, useState } from "react";
import { ChooserPage } from "./ChooserPage.jsx";
import { cartaIdLabel } from "./cartaIdLabel.js";
import { FirmMark } from "../ui/components.jsx";
import { FS, INK, FAINT, LINE, PAPER, BLUE, inkNum } from "../ui/theme.js";

const SEARCH_DELAY_MS = 300;

export default function FirmChooser({ isStaff, firms, onPick, onCancel }) {
  // Only a confirmed non-staff user is limited to their own held firms with no way to look
  // further — the same resolved-false check pinnedFirm (useLoadFirm.js) uses for auto-select.
  // `null` (isStaff unknown, or the lookup failed) gets search too: search goes through
  // /api/firms?q=, Carta's own list_contexts, and every pick passes authorizedFirm(), so
  // showing it never widens access — while hiding it from someone who turns out to be staff
  // (who typically hold no firm of their own) would leave them with no way to continue.
  const canSearch = isStaff !== false;
  const [query, setQuery] = useState("");
  const [list, setList] = useState(firms);
  // True only while a non-empty query is debouncing or its fetch is in flight — not for the
  // initial no-query load, which has nothing a user is waiting on mid-keystroke.
  const [searching, setSearching] = useState(false);
  const q = canSearch ? query.trim() : "";

  useEffect(() => {
    if (!canSearch) return undefined;
    let live = true;
    if (q) setSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/firms?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((found) => { if (live) setList(Array.isArray(found) ? found : []); })
        .catch(() => { if (live) setList([]); })
        .finally(() => { if (live) setSearching(false); });
    }, q ? SEARCH_DELAY_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [q, canSearch]);

  return (
    <ChooserPage title="Carta ManCo Reporting" onCancel={onCancel}
      subtitle="Pick which firm's ManCo microapp to open.">
      {canSearch && (
        <div style={{ position: "relative", marginBottom: 20 }}>
          {/* The native type=search clear (x) button would otherwise sit under the status
              label at the same right edge — hidden here only, not app-wide. */}
          <style>{".firm-search-input::-webkit-search-cancel-button{display:none}"}</style>
          <input type="search" className="firm-search-input" data-testid="firm-search" value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by firm name, firm UUID, or Carta ID" aria-label="Search firms" autoFocus
            style={{ fontSize: FS.bodyLg, width: "100%", boxSizing: "border-box", padding: "10px 80px 10px 12px",
              color: INK, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 0, fontFamily: "inherit" }} />
          {searching && (
            <span data-testid="firm-search-status" aria-live="polite"
              style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                fontSize: FS.body, color: FAINT, fontFamily: "inherit", pointerEvents: "none" }}>
              Searching…
            </span>
          )}
        </div>
      )}

      {list.length === 0 && (
        <div style={{ fontSize: FS.bodyLg, color: FAINT }}>
          {q ? "No firms matched your search." : "No firms to show."}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {list.map((f) => (
          <button key={f.firmUuid || f.slug} data-testid={`firm-${f.slug}`} onClick={() => onPick(f.slug, f.firmUuid)}
            className="firm-card"
            style={{ textAlign: "left", cursor: "pointer", padding: "20px 20px 18px",
              display: "flex", flexDirection: "column", gap: 14, fontFamily: "inherit" }}>
            <FirmMark name={f.name} />
            <div>
              <div style={{ fontSize: FS.h3, fontWeight: 500, color: INK, lineHeight: 1.2 }}>{f.name}</div>
              {cartaIdLabel(f) && (
                // No eligibility pre-filter narrows this list (see handleFirms' own comment), so
                // two results can share a name — the Carta ID is what tells them apart.
                <div data-testid={`firm-facts-${f.slug}`} style={{ ...inkNum, fontSize: FS.small, color: FAINT, marginTop: 6 }}>
                  {cartaIdLabel(f)}
                </div>
              )}
            </div>
            <span style={{ fontSize: FS.value, fontWeight: 600, color: BLUE }}>Open workspace →</span>
          </button>
        ))}
      </div>
    </ChooserPage>
  );
}
