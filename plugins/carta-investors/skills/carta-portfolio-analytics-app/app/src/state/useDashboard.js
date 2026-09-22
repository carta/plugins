// Persists the user's app state (formulas, rules, notes, layouts…) through the dev
// server's single writable document (/api/portfolio -> portfolio.json), using an
// ETag + debounced-PUT pattern so serve.py needs no change.
//
// Doc shape: see EMPTY below. `widgets` is kept so files saved by older builds
// still load. A missing/unwritten file (server returns {error:"not_ready"} with no
// ETag) starts from EMPTY, saved on the first edit.
import { useCallback, useEffect, useRef, useState } from "react";

const EMPTY = { version: 1, widgets: [], customMetrics: [], notes: {}, rules: [], views: [], cellFormats: {},
  // ids of DEFAULT_FORMULAS already offered — keeps a deleted default deleted
  seededFormulas: [],
  // covenant tests: saved formula + direction + threshold schedule + basis
  covenants: [],
  // per-chart display settings: { global: {…}, byChart: { [chartId]: {…} } }
  chartPrefs: { global: {}, byChart: {} },
  // Overview table's configurable column stack — see model/overviewColumns.js.
  columns: [],
  // Overview table's persisted filters — see model/overviewFilters.js.
  filters: [],
  // starred company ids (model/favorites.js); seededFavorites gates the one-time
  // top-quartile-by-cost-basis auto-star so an un-starred pick never returns.
  favorites: [], seededFavorites: false };

export default function useDashboard(firm) {
  const q = firm ? `?firm=${encodeURIComponent(firm)}` : "";
  const [doc, setDoc] = useState(null);
  const timer = useRef(null);
  const pending = useRef(null);
  const etag = useRef(null);

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    pending.current = null;
    try {
      const r = await fetch(`/api/portfolio${q}`);
      etag.current = r.headers.get("etag");
      const d = await r.json();
      const ok = d && !d.error && (Array.isArray(d.widgets) || Array.isArray(d.customMetrics) || Array.isArray(d.rules) || Array.isArray(d.views) || (d.notes && typeof d.notes === "object"));
      setDoc(ok ? { ...EMPTY, ...d } : { ...EMPTY });
    } catch {
      setDoc({ ...EMPTY });
    }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const doSave = useCallback(async () => {
    const body = pending.current;
    if (body == null) return;
    pending.current = null;
    try {
      const r = await fetch(`/api/portfolio${q}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(etag.current ? { "If-Match": etag.current } : {}) },
        body: JSON.stringify(body),
      });
      if (r.status === 409) { await load(); return; }
      if (r.ok) etag.current = r.headers.get("etag") ?? etag.current;
    } catch {
      /* network error — the edit stays in state; the next edit retries */
    }
  }, [load, q]);

  const persist = useCallback((next) => {
    clearTimeout(timer.current);
    pending.current = next;
    timer.current = setTimeout(doSave, 400);
  }, [doSave]);

  // update(fn): fn mutates a clone of the doc; result is persisted (debounced).
  const update = useCallback((fn) => {
    setDoc((prev) => {
      const next = fn(structuredClone(prev || EMPTY));
      if (next == null) return prev;
      persist(next);
      return next;
    });
  }, [persist]);

  return { doc, update };
}
