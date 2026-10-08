// Loads the Carta snapshot (read-only) and the portfolio document (named slices;
// scenarios stored as edits deltas), and persists edits through the dev-server JSON
// store with a short debounce. All edits land in the ACTIVE slice; baseline is locked.
import { useState, useEffect, useRef, useCallback } from "react";
import { activeSlice, getSlice, makeSlice, sliceId, BASELINE_ID, hydrateDoc, dehydrateDoc } from "../model/slices.js";
import { setTrackingFirm } from "../analytics.js";
import useEtagAutosave from "./useEtagAutosave.js";

export default function usePortfolio(firm, { onLockedEdit } = {}) {
  const q = firm ? `?firm=${encodeURIComponent(firm)}` : "";
  const [snapshot, setSnapshot] = useState(null);
  const [doc, setDoc] = useState(null);
  const paused = useRef(false); // chat-turn soft lock: holds every autosave PUT
  // Latest doc + locked-edit callback, held in refs so `update` can read them
  // without landing in its useCallback deps (and so the callback fires OUTSIDE
  // the setDoc updater — updaters must stay pure; StrictMode double-invokes them).
  const docRef = useRef(null);
  const onLockedEditRef = useRef(onLockedEdit);
  useEffect(() => { onLockedEditRef.current = onLockedEdit; }, [onLockedEdit]);
  // A 409 means another tab or a refresh script rewrote the file: drop the stale edit and reload.
  const { schedule: persist, flush, reset, resume } = useEtagAutosave(`/api/portfolio${q}`, { encode: dehydrateDoc, onConflict: () => load(), paused });

  /** Re-fetch from disk as the new truth, DROPPING any pending stale PUT —
   *  callers that care about unsaved edits flush() first. */
  const load = useCallback(async () => {
    const [s, pr] = await Promise.all([
      fetch(`/api/snapshot${q}`).then((r) => r.json()),
      fetch(`/api/portfolio${q}`).then(async (r) => { reset(r.headers.get("etag")); return r.json(); }),
    ]);
    if (s?.error === "not_ready" || pr?.error === "not_ready" || !s?.funds || !Array.isArray(pr?.slices)) return;
    setSnapshot(s);
    setTrackingFirm(s?.source?.firmId);
    setDoc(hydrateDoc(pr));
  }, [q, reset]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { docRef.current = doc; }, [doc]);

  // Call flush() before set-basis/refresh rewrite portfolio.json, so no stale PUT lands after them.
  // While paused it sends nothing: the turn-end reload reconciles any during-turn edit.

  /** Chat-turn soft lock: land any pre-turn edit, then hold autosave so a debounced PUT
   *  can't clobber Claude's concurrent portfolio.json write. */
  const pauseAutosave = useCallback(async () => {
    await flush();
    paused.current = true;
  }, [flush]);
  /** Re-enable autosave, re-arming any edit held during the turn. Resume fires on turn-end,
   *  after Claude's write, so a PUT here can't race it. */
  const resumeAutosave = useCallback(() => {
    paused.current = false;
    resume();
  }, [resume]);

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
        const s = activeSlice(next);
        fn(s);
        // A local edit to a shared scenario is unpublished until "Update" — mark it
        // so a teammate's pull-in skips it and the UI can offer to push it.
        if (s.shared?.uuid) s.shared = { ...s.shared, dirty: true };
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
        if (s.shared?.uuid) s.shared = { ...s.shared, dirty: true };
        return d;
      }),
    [mutateDoc]
  );

  // Fork a scenario into an independent LOCAL copy. makeSlice copies only
  // assumptions+companies (never `shared`), so the fork drops the firm link.
  const forkSlice = useCallback(
    (id) =>
      mutateDoc((d) => {
        const src = getSlice(d, id);
        if (!src) return null;
        const s = makeSlice({ id: sliceId(src.name), name: `${src.name} (copy)`, from: src, color: src.color });
        d.slices.push(s);
        d.activeSliceId = s.id;
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

  // Hide a shared scenario from your list without deleting it — the firm's copy stays and a
  // pull keeps it hidden (share.py carries the flag). Not a content edit, so it never dirties.
  const hideShared = useCallback(
    (id) =>
      mutateDoc((d) => {
        const s = d.slices.find((x) => x.id === id);
        if (!s || !s.shared?.uuid) return null;
        s.shared = { ...s.shared, hidden: true };
        if (d.activeSliceId === id) d.activeSliceId = BASELINE_ID;
        return d;
      }),
    [mutateDoc]
  );

  const showHidden = useCallback(
    () =>
      mutateDoc((d) => {
        let changed = false;
        for (const s of d.slices) {
          if (s.shared?.hidden) { s.shared = { ...s.shared, hidden: false }; changed = true; }
        }
        return changed ? d : null;
      }),
    [mutateDoc]
  );

  // Drop the firm link, keeping the scenario as a private local copy (edits intact) — the
  // "Keep private" recovery when the shared row was deleted upstream.
  const unshareSlice = useCallback(
    (id) =>
      mutateDoc((d) => {
        const s = d.slices.find((x) => x.id === id);
        if (!s || !s.shared) return null;
        delete s.shared;
        return d;
      }),
    [mutateDoc]
  );

  const slice = doc?.slices ? activeSlice(doc) : null;

  return {
    snapshot,
    doc,
    slice, // {id, name, locked, assumptions, companies}
    selectSlice,
    createSlice,
    renameSlice,
    forkSlice,
    deleteSlice,
    hideShared,
    showHidden,
    unshareSlice,
    update,
    updateCompany,
    setAssumption,
    reload: load,
    flush,
    pauseAutosave,
    resumeAutosave,
  };
}
