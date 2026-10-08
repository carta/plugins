import { useCallback, useEffect, useRef } from "react";

export const SAVE_DELAY_MS = 400;
// Browsers cap a keepalive request's body at 64 KB; a bigger one is sent plainly and may not finish.
const KEEPALIVE_MAX_BYTES = 64 * 1024;

/** `onConflict` runs on a 409 and should reload; nothing is sent while `paused.current` is true. */
export default function useEtagAutosave(url, { encode = (d) => d, onConflict, paused, onState } = {}) {
  const timer = useRef(null);
  const pending = useRef(null);
  const inflight = useRef(null);
  const etag = useRef(null);
  // Read at call time, so a save always uses the caller's latest callbacks without re-creating `save`.
  const latest = useRef({});
  latest.current = { encode, onConflict, onState };
  const held = () => !!paused?.current;

  const save = useCallback(async ({ unloading = false } = {}) => {
    if (held()) return;
    // One PUT at a time: the next must carry the ETag this one gets back, or it 409s against its own save.
    while (inflight.current) await inflight.current;
    if (held()) return; // the pause can start while the earlier PUT lands
    const body = pending.current;
    if (body == null) return;
    pending.current = null;
    const { encode, onConflict, onState } = latest.current;
    onState?.("saving");
    const run = (async () => {
      try {
        const text = JSON.stringify(encode(body));
        const r = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...(etag.current ? { "If-Match": etag.current } : {}) },
          body: text,
          keepalive: unloading && text.length < KEEPALIVE_MAX_BYTES,
        });
        if (r.status === 409) {
          await onConflict?.();
          onState?.("idle");
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        etag.current = r.headers.get("etag") ?? etag.current;
        onState?.("saved");
      } catch {
        pending.current = pending.current ?? body; // the next edit or flush sends it again
        onState?.("error");
      }
    })();
    inflight.current = run;
    try { await run; } finally { inflight.current = null; }
  }, [url]);

  // Closing the tab inside the debounce would otherwise drop the last edit.
  useEffect(() => {
    const onHide = () => {
      if (pending.current == null || inflight.current) return;
      clearTimeout(timer.current);
      save({ unloading: true });
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [save]);

  const schedule = useCallback((doc) => {
    clearTimeout(timer.current);
    pending.current = doc;
    if (!held()) timer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    await save();
    if (inflight.current) await inflight.current;
  }, [save]);

  /** Call after a load, so a held edit can't overwrite what was just loaded. */
  const reset = useCallback((tag) => {
    clearTimeout(timer.current);
    pending.current = null;
    if (tag !== undefined) etag.current = tag;
  }, []);

  const resume = useCallback(() => { if (pending.current != null) schedule(pending.current); }, [schedule]);

  const hasPending = useCallback(() => pending.current != null, []);

  return { schedule, flush, reset, resume, hasPending };
}
