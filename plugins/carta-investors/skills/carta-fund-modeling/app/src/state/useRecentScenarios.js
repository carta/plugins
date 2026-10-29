import { useEffect, useState } from "react";

// The scenarios the user opened in a firm, most recent first, kept in this browser so
// the scenario menu can show the ones they work in. Only ids: a deleted or hidden
// scenario simply drops out where the list is read.
const KEY = (firm) => `recent-scenarios:${firm}`;
const KEEP = 20;

function read(firm) {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY(firm)) ?? "[]");
    return Array.isArray(ids) ? ids : [];
  } catch {
    return []; // no localStorage (private mode) or a corrupt entry
  }
}

/** The ids of the scenarios opened in `firm`, most recent first. `activeId` is the
 *  scenario open now: each new one moves to the front. */
export default function useRecentScenarios(firm, activeId) {
  const [recent, setRecent] = useState(() => read(firm));
  useEffect(() => {
    if (!activeId) return;
    const next = [activeId, ...read(firm).filter((id) => id !== activeId)].slice(0, KEEP);
    try { localStorage.setItem(KEY(firm), JSON.stringify(next)); } catch { /* private mode */ }
    setRecent(next);
  }, [firm, activeId]);
  return recent;
}
