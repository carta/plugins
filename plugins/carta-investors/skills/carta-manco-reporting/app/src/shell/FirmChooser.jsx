// Shown instead of the auto-load screen when useLoadFirm.js can't open a firm with no extra
// click. Who sees this, and who additionally gets search: DEPLOY.md's "Which firm opens".
import { useEffect, useState } from "react";
import { ChooserPage, ChooserButton } from "./ChooserPage.jsx";
import { FS, INK, FAINT, LINE, PAPER } from "../ui/theme.js";

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
    <ChooserPage title="Choose a firm"
      subtitle="Pick which firm's ManCo microapp to open.">
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
          <ChooserButton key={f.slug} data-testid={`firm-${f.slug}`} onClick={() => onPick(f.slug)}>
            {f.name}
          </ChooserButton>
        ))}
      </div>
    </ChooserPage>
  );
}
