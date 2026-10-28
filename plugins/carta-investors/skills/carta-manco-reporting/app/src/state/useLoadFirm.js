import { useCallback, useEffect, useRef, useState } from "react";
import { deepLinkFirmSlug, setFirmParam } from "./firmParam.js";

// Status shown while waiting for the first real step; App.jsx uses it as the fallback
// for the same wait.
export const LOAD_FIRM_LABEL = "Loading firm data…";

// handleLoadFirm's own code (server/worker.js) for its one typed SSE error: the firm has no
// ManCo entity. App.jsx renders NoMancoEntity for it instead of the generic error line.
export const NO_MANCO_ENTITY = "no_manco_entity";

// The one firm a resolved, non-staff user may open with no extra click. `isStaff` must be
// the literal false Carta returned, not merely falsy: null (unknown or the lookup failed)
// must never auto-open a firm, same as carta-fund-modeling's FirmAccess.pinnedFirm.
function pinnedFirm(isStaff, firms) {
  return isStaff === false && firms.length === 1 ? firms[0]?.slug ?? null : null;
}

// The chooser's own data: who the signed-in user is and which firms they hold. Shared by the
// resolution effect and reopenChooser so the two can't drift on the fallbacks or the shape
// FirmChooser expects.
async function fetchChooser(signal) {
  const [me, firms] = await Promise.all([
    fetch("/api/me", { signal }).then((r) => r.json()).catch(() => ({ isStaff: null })),
    fetch("/api/firms", { signal }).then((r) => r.json()).catch(() => []),
  ]);
  return { isStaff: me?.isStaff ?? null, firms: Array.isArray(firms) ? firms : [] };
}

// Drives /api/load-firm's SSE progress stream when the hosted app has no cached snapshot
// for this firm yet. Mirrors carta-portfolio-analytics-app's useKpi.js: the effect's own
// load runs on an AbortController tied to the trigger/unmount (so switching away mid-load
// doesn't leave the Worker running every DWH query for a page nobody is watching), and
// explicit detection of a Worker CPU-limit kill — the stream's body just ends, with no
// terminal `done`/`error` frame — instead of leaving the caller stuck on its last step
// label forever.
//
// Which firm to load, and who sees `chooser` instead: DEPLOY.md's "Which firm opens".
export default function useLoadFirm(trigger, onDone) {
  const [loadStatus, setLoadStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // handleLoadFirm's own `code` on its SSE error frame (NO_MANCO_ENTITY) — null for every
  // other error (a thrown fetch, a non-2xx response, the stream ending early), which
  // App.jsx renders as the generic error line.
  const [errorCode, setErrorCode] = useState(null);
  const [chooser, setChooser] = useState(null);
  // onDone is re-created every render in App.jsx (it closes over fetchData/reportsApi);
  // a ref lets the effect read the latest one without re-running on every render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // liveRef: "this hook still cares about a response" — shared by the effect, `choose` and
  // `reopenChooser` alike, so a result that lands after the user navigated away is dropped
  // everywhere. controllerRef: the one load currently allowed to report anything — shared
  // by the effect and `choose` only (`reopenChooser` fetches the chooser's own data on no
  // controller at all, see below — it checks controllerRef hasn't changed instead). The
  // effect aborts whatever controllerRef holds — its own last run's, or one `choose` created
  // while the trigger was off — before replacing it; `choose` replaces a missing or already-
  // aborted one with a fresh one before loading. See `choose`'s own comment for why a stored
  // controller can already be aborted.
  const controllerRef = useRef(null);
  const liveRef = useRef(false);

  const runLoad = useCallback(async (slug, controller) => {
    setLoadStatus(LOAD_FIRM_LABEL);
    setErrorCode(null);
    try {
      const resp = await fetch("/api/load-firm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        // handleLoadFirm answers a refusal (403 forbiddenFirm, 400, 401) with a JSON body
        // naming why, same as every other route — show that, not a bare status code, when
        // the response actually carries one.
        let message = `HTTP ${resp.status}`;
        try {
          const body = await resp.json();
          if (body?.message) message = body.message;
        } catch { /* no JSON body */ }
        throw new Error(message);
      }
      const reader = resp.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buf = "";
      let finished = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!liveRef.current || controller.signal.aborted) return;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            setLoadStatus(msg.step || "Loading…");
            if (msg.done) {
              finished = true;
              setLoadStatus(null);
              onDoneRef.current?.();
              return;
            }
            if (msg.error) {
              finished = true;
              setLoadStatus(null);
              setLoadError(msg.error);
              setErrorCode(msg.code || null);
              return;
            }
          } catch { /* skip */ }
        }
      }
      if (liveRef.current && !controller.signal.aborted && !finished) {
        setLoadStatus(null);
        setLoadError("The firm load stopped before it finished. Reload the page to try again.");
      }
    } catch (e) {
      if (liveRef.current && !controller.signal.aborted) setLoadError(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!trigger) return undefined;
    liveRef.current = true;
    const controller = new AbortController();
    // Aborts whatever controllerRef still holds before replacing it: a chooser pick
    // (choose, below) from the no-ManCo screen runs while this effect's own trigger is
    // still 0, so its load is still in flight when a resurface refetch reads not_ready
    // again and starts a new run of this same effect — without this, that earlier load
    // would keep running and could still set status or call onDone alongside this one.
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setLoadError(null);
    setErrorCode(null);
    setChooser(null);

    (async () => {
      try {
        const cfg = await fetch("/api/app-config", { signal: controller.signal }).then((r) => r.json());
        let slug = cfg?.defaultFirm || deepLinkFirmSlug();
        if (!slug) {
          const resolved = await fetchChooser(controller.signal);
          slug = pinnedFirm(resolved.isStaff, resolved.firms);
          if (!slug) {
            if (liveRef.current && !controller.signal.aborted) setChooser(resolved);
            return;
          }
        }
        if (!slug || !liveRef.current || controller.signal.aborted) return;
        await runLoad(slug, controller);
      } catch (e) {
        if (liveRef.current && !controller.signal.aborted) setLoadError(e?.message || String(e));
      }
    })();

    return () => { liveRef.current = false; controller.abort(); };
  }, [trigger, runLoad]);

  // The chooser's onPick (from the auto-select path's own chooser, or from the one
  // reopenChooser shows after an error): writes the pick into ?firm= first, so a page
  // reload resolves straight back to it instead of showing the chooser again. Runs the load
  // on controllerRef's controller, replacing it first if it is missing or already aborted:
  // the resolution effect's own cleanup aborts that controller the moment an error (e.g. no
  // ManCo entity) drops `notReady`, which tears down the effect well before the user has
  // had a chance to pick from the chooser this very error put on screen — reusing that
  // aborted controller would fail every such pick with an AbortError. If a resurface
  // refetch does restart the effect before this load finishes, that run's own
  // `controllerRef.current?.abort()` supersedes it, so only one load is ever allowed to
  // report anything.
  const choose = useCallback((slug) => {
    setFirmParam(slug);
    setChooser(null);
    liveRef.current = true;
    if (!controllerRef.current || controllerRef.current.signal.aborted) controllerRef.current = new AbortController();
    runLoad(slug, controllerRef.current);
  }, [runLoad]);

  // The way back from an error (e.g. the loaded firm has no ManCo entity): drops the error
  // and fetches a fresh chooser, the same data the resolution effect would have fetched had
  // it needed one. Always re-fetches rather than reusing an earlier resolution — a deep
  // link or an auto-selected single firm never populated `chooser` in the first place. Never
  // creates or aborts a controller — choose() is the one place that starts a load, and it
  // replaces a stale controller itself before doing so. Records controllerRef's current
  // owner before fetching and drops the result if it has changed by the time the fetch
  // resolves: a resurface refetch can restart the resolution effect (a new owner) while
  // this fetch is still in flight, and that effect's own chooser (or its load) must win,
  // not a now-stale result from before it started.
  const reopenChooser = useCallback(async () => {
    liveRef.current = true;
    setLoadError(null);
    setErrorCode(null);
    const owner = controllerRef.current;
    try {
      const resolved = await fetchChooser();
      if (liveRef.current && controllerRef.current === owner) setChooser(resolved);
    } catch (e) {
      if (liveRef.current && controllerRef.current === owner) setLoadError(e?.message || String(e));
    }
  }, []);

  return { loadStatus, loadError, errorCode, chooser, choose, reopenChooser };
}
