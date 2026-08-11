// Loads the Carta snapshot (read-only) and the portfolio document (named slices;
// scenarios stored as edits deltas), and persists edits through the dev-server JSON
// store with a short debounce. All edits land in the ACTIVE slice; baseline is locked.
import { useState, useEffect, useRef, useCallback } from "react";
import { activeSlice, getSlice, makeSlice, sliceId, BASELINE_ID, hydrateDoc, dehydrateDoc } from "../model/slices.js";
import { setTrackingFirm } from "../analytics.js";

export default function usePortfolio(firm, { onLockedEdit } = {}) {
  const q = firm ? `?firm=${encodeURIComponent(firm)}` : "";
  const [snapshot, setSnapshot] = useState(null);
  const [doc, setDoc] = useState(null);
  const timer = useRef(null);
  const pending = useRef(null); // latest unsaved doc awaiting the debounced PUT
  const inflight = useRef(null); // the PUT currently on the wire, if any
  const etag = useRef(null); // optimistic-concurrency token from the last GET/PUT
  const paused = useRef(false); // chat-turn soft lock: suppresses autosave PUTs
  // Latest doc + locked-edit callback, held in refs so `update` can read them
  // without landing in its useCallback deps (and so the callback fires OUTSIDE
  // the setDoc updater — updaters must stay pure; StrictMode double-invokes them).
  const docRef = useRef(null);
  const onLockedEditRef = useRef(onLockedEdit);
  useEffect(() => { onLockedEditRef.current = onLockedEdit; }, [onLockedEdit]);

  /** Re-fetch from disk as the new truth, DROPPING any pending stale PUT —
   *  callers that care about unsaved edits flush() first. */
  const load = useCallback(async () => {
    clearTimeout(timer.current);
    pending.current = null;
    const [s, pr] = await Promise.all([
      fetch(`/api/snapshot${q}`).then((r) => r.json()),
      fetch(`/api/portfolio${q}`).then(async (r) => { etag.current = r.headers.get("etag"); return r.json(); }),
    ]);
    setSnapshot(s);
    // Runs on post-refresh reloads too, so a late-resolved id lands without a relaunch.
    setTrackingFirm(s?.source?.firmId);
    setDoc(hydrateDoc(pr)); // resolve on-disk edits deltas to full slices for the in-memory model
  }, [q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const doSave = useCallback(async () => {
    // Suppresses ALL saves while a chat turn holds the soft lock — including
    // flush()-initiated ones — so a mid-turn caller can't PUT and clobber
    // Claude's concurrent portfolio.json write. Do NOT special-case flush()
    // here: the pre-turn edit was already flushed by pauseAutosave() before
    // paused was set, and any during-turn edit is reconciled by the
    // turn-end reload (see resumeAutosave below).
    if (paused.current) return;
    const body = pending.current;
    if (body == null) return;
    pending.current = null;
    const run = (async () => {
      try {
        const r = await fetch(`/api/portfolio${q}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...(etag.current ? { "If-Match": etag.current } : {}) },
          body: JSON.stringify(dehydrateDoc(body)), // persist non-baseline slices as edits deltas
        });
        if (r.status === 409) {
          // the file changed underneath this tab (another tab saved, or a
          // refresh script rewrote it) — drop the stale edit and reload truth
          await load();
          return;
        }
        if (r.ok) etag.current = r.headers.get("etag") ?? etag.current;
      } catch {
        /* network error — the edit stays in doc state and the next edit retries */
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
  }, [load, q]);

  /** Land ALL edits NOW — the debounced one and any PUT already on the wire.
   *  Call before server-side scripts rewrite portfolio.json (set-basis,
   *  refresh) so a stale PUT can never land after them.
   *  NOTE: while a chat turn holds the soft lock (paused), doSave's guard
   *  suppresses saves outright — flush() included — so calling flush()
   *  mid-turn is a no-op, not a bypass. The pre-turn edit was already
   *  flushed by pauseAutosave() before the lock engaged, and any
   *  during-turn edit is reconciled by the turn-end reload. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    await doSave();
    if (inflight.current) await inflight.current;
  }, [doSave]);

  /** Chat-turn soft lock: land any pre-turn edit, then suppress autosave so
   *  the debounced PUT can't clobber Claude's concurrent portfolio.json write.
   *  flush() runs BEFORE paused is set, so its own doSave isn't blocked. */
  const pauseAutosave = useCallback(async () => {
    await flush();
    paused.current = true;
  }, [flush]);
  /** Re-enable autosave. If a during-turn edit is still held (pending, never
   *  scheduled while paused), reschedule its debounced PUT now — otherwise it
   *  would strand until the next edit/flush. Safe: resume fires on turn-end,
   *  after Claude's write, so a PUT here can't race the concurrent disk write. */
  const resumeAutosave = useCallback(() => {
    paused.current = false;
    if (pending.current != null) { clearTimeout(timer.current); timer.current = setTimeout(doSave, 400); }
  }, [doSave]);

  const persist = useCallback((next) => {
    clearTimeout(timer.current);
    pending.current = next;
    if (paused.current) return; // chat turn active: hold, don't autosave
    timer.current = setTimeout(doSave, 400);
  }, [doSave]);

  const mutateDoc = useCallback(
    (fn) => {
      setDoc((prev) => {
        const next = fn(structuredClone(prev));
        if (next == null) return prev; // fn signalled a no-op: no write, no re-render
        persist(next);
        return next;
      });
    },
    [persist]
  );

  /** Apply a transform to the active slice body. Locked slices are immutable —
   *  the edit is dropped and onLockedEdit (e.g. a "Baseline is read-only" toast)
   *  fires so the attempt isn't silently swallowed. */
  const update = useCallback(
    (fn) => {
      const cur = docRef.current;
      if (cur && activeSlice(cur).locked) { onLockedEditRef.current?.(); return; }
      setDoc((prev) => {
        if (activeSlice(prev).locked) return prev; // defensive backstop: no clone, no persist
        const next = structuredClone(prev);
        fn(activeSlice(next));
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const updateCompany = useCallback(
    (id, patch) =>
      update((s) => {
        const c = s.companies.find((x) => x.id === id);
        if (c) Object.assign(c, typeof patch === "function" ? patch(c) : patch);
      }),
    [update]
  );

  const setAssumption = useCallback(
    (key, value) => update((s) => { s.assumptions[key] = value; }),
    [update]
  );

  // ---- slice operations ----
  const selectSlice = useCallback((id) => mutateDoc((d) => ({ ...d, activeSliceId: id })), [mutateDoc]);

  const createSlice = useCallback(
    (name, { fromId, color } = {}) =>
      mutateDoc((d) => {
        const from = getSlice(d, fromId ?? d.activeSliceId);
        const s = makeSlice({ id: sliceId(name), name, from, color });
        d.slices.push(s);
        d.activeSliceId = s.id;
        return d;
      }),
    [mutateDoc]
  );

  const renameSlice = useCallback(
    (id, name, color) =>
      mutateDoc((d) => {
        const s = d.slices.find((x) => x.id === id);
        if (!s || s.locked) return null;
        s.name = name;
        if (color !== undefined) s.color = color; // undefined = leave unchanged; null = clear
        return d;
      }),
    [mutateDoc]
  );

  const deleteSlice = useCallback(
    (id) =>
      mutateDoc((d) => {
        const s = d.slices.find((x) => x.id === id);
        if (id === BASELINE_ID || !s || s.locked) return null;
        d.slices = d.slices.filter((x) => x.id !== id);
        if (d.activeSliceId === id) d.activeSliceId = BASELINE_ID;
        return d;
      }),
    [mutateDoc]
  );

  const slice = doc ? activeSlice(doc) : null;

  return {
    snapshot,
    doc,
    slice, // {id, name, locked, assumptions, companies}
    selectSlice,
    createSlice,
    renameSlice,
    deleteSlice,
    update,
    updateCompany,
    setAssumption,
    reload: load,
    flush,
    pauseAutosave,
    resumeAutosave,
  };
}
