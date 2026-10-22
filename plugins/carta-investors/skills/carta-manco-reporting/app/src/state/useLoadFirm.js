import { useEffect, useRef, useState } from "react";

// Drives /api/load-firm's SSE progress stream when the hosted app has no cached snapshot
// for this firm yet. Mirrors carta-portfolio-analytics-app's useKpi.js: an AbortController
// tied to the trigger/unmount (so switching away mid-load doesn't leave the Worker running
// every DWH query for a page nobody is watching), and explicit detection of a Worker
// CPU-limit kill — the stream's body just ends, with no terminal `done`/`error` frame —
// instead of leaving the caller stuck on its last step label forever.
export default function useLoadFirm(trigger, onDone) {
  const [loadStatus, setLoadStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // onDone is re-created every render in App.jsx (it closes over fetchData/reportsApi);
  // a ref lets the effect read the latest one without re-running on every render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!trigger) return undefined;
    let live = true;
    const controller = new AbortController();
    setLoadError(null);

    (async () => {
      try {
        const cfg = await fetch("/api/app-config", { signal: controller.signal }).then((r) => r.json());
        let slug = cfg?.defaultFirm;
        if (!slug) {
          const firms = await fetch("/api/firms", { signal: controller.signal })
            .then((r) => r.json())
            .catch(() => []);
          if (Array.isArray(firms) && firms.length > 0) slug = firms[0].slug;
        }
        if (!slug || !live) return;

        setLoadStatus("Loading firm data…");
        const resp = await fetch("/api/load-firm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const reader = resp.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buf = "";
        let finished = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!live) return;
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
        if (live && !finished) {
          setLoadStatus(null);
          setLoadError("The firm load stopped before it finished. Reload the page to try again.");
        }
      } catch (e) {
        if (live) setLoadError(e?.message || String(e));
      }
    })();

    return () => { live = false; controller.abort(); };
  }, [trigger]);

  return { loadStatus, loadError };
}
