import { useCallback, useEffect, useRef, useState } from "react";
import { deepLinkFirmSlug, setFirmParam } from "./firmParam.js";

// Status shown while waiting for the first real step; App.jsx uses it as the fallback
// for the same wait.
export const LOAD_FIRM_LABEL = "Loading firm data…";

// The one firm a resolved, non-staff user may open with no extra click. `isStaff` must be
// the literal false Carta returned, not merely falsy: null (unknown or the lookup failed)
// must never auto-open a firm, same as carta-fund-modeling's FirmAccess.pinnedFirm.
function pinnedFirm(isStaff, firms) {
  return isStaff === false && firms.length === 1 ? firms[0]?.slug ?? null : null;
}

// Drives /api/load-firm's SSE progress stream when the hosted app has no cached snapshot
// for this firm yet. Mirrors carta-portfolio-analytics-app's useKpi.js: an AbortController
// tied to the trigger/unmount (so switching away mid-load doesn't leave the Worker running
// every DWH query for a page nobody is watching), and explicit detection of a Worker
// CPU-limit kill — the stream's body just ends, with no terminal `done`/`error` frame —
// instead of leaving the caller stuck on its last step label forever.
//
// Which firm to load, and who sees `chooser` instead: DEPLOY.md's "Which firm opens".
export default function useLoadFirm(trigger, onDone) {
  const [loadStatus, setLoadStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [chooser, setChooser] = useState(null);
  // onDone is re-created every render in App.jsx (it closes over fetchData/reportsApi);
  // a ref lets the effect read the latest one without re-running on every render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // Shared with `choose`, which runs outside the effect that created them: `choose` reuses
  // this run's own controller (so a trigger/unmount cleanup still aborts it) and its own
  // liveness flag (so a response that lands after the user navigated away is dropped).
  const controllerRef = useRef(null);
  const liveRef = useRef(false);

  const runLoad = useCallback(async (slug, controller) => {
    setLoadStatus(LOAD_FIRM_LABEL);
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
        if (!liveRef.current) return;
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
              return;
            }
          } catch { /* skip */ }
        }
      }
      if (liveRef.current && !finished) {
        setLoadStatus(null);
        setLoadError("The firm load stopped before it finished. Reload the page to try again.");
      }
    } catch (e) {
      if (liveRef.current) setLoadError(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!trigger) return undefined;
    liveRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoadError(null);
    setChooser(null);

    (async () => {
      try {
        const cfg = await fetch("/api/app-config", { signal: controller.signal }).then((r) => r.json());
        let slug = cfg?.defaultFirm || deepLinkFirmSlug();
        if (!slug) {
          const [me, firms] = await Promise.all([
            fetch("/api/me", { signal: controller.signal }).then((r) => r.json()).catch(() => ({ isStaff: null })),
            fetch("/api/firms", { signal: controller.signal }).then((r) => r.json()).catch(() => []),
          ]);
          const list = Array.isArray(firms) ? firms : [];
          slug = pinnedFirm(me?.isStaff, list);
          if (!slug) {
            if (liveRef.current) setChooser({ isStaff: me?.isStaff ?? null, firms: list });
            return;
          }
        }
        if (!slug || !liveRef.current) return;
        await runLoad(slug, controller);
      } catch (e) {
        if (liveRef.current) setLoadError(e?.message || String(e));
      }
    })();

    return () => { liveRef.current = false; controller.abort(); };
  }, [trigger, runLoad]);

  // The chooser's onPick: runs the same load the auto-select path would have, reusing this
  // trigger run's controller so it still aborts if the trigger turns off (e.g. the snapshot
  // became ready from another tab) while the user is picking. Writes the pick into ?firm=
  // first, so a later run of the resolution effect — a retry when the load finishes but a
  // refetch still reads not_ready, or a page reload — resolves straight back to it instead
  // of showing the chooser again mid-load.
  const choose = useCallback((slug) => {
    setFirmParam(slug);
    setChooser(null);
    liveRef.current = true;
    runLoad(slug, controllerRef.current || new AbortController());
  }, [runLoad]);

  return { loadStatus, loadError, chooser, choose };
}
