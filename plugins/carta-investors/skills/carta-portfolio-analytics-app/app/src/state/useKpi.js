import { useEffect, useState } from "react";
import { setTrackingFirm } from "../analytics.js";

export default function useKpi(firm) {
  const q = firm ? `?firm=${encodeURIComponent(firm)}` : "";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(null);

  useEffect(() => {
    let live = true;
    // Switching firms mid-load abandons the old stream. Without the abort the
    // Worker runs every SQL stem to completion for data nobody will see.
    const controller = new AbortController();
    setData(null);
    setError(null);
    setStep(null);

    (async () => {
      try {
        const res = await fetch(`/api/report/kpi.json${q}`, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // The Worker streams progress as SSE; serve.py, the local path, answers
        // with the finished dataset as plain JSON.
        if (!(res.headers.get("Content-Type") || "").includes("text/event-stream")) {
          const d = await res.json();
          if (!live) return;
          if (!d || d.error) setError(d?.message || d?.error || "not_ready");
          else { setData(d); setTrackingFirm(d.source?.firmId); }
          return;
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        // Cloudflare kills a Worker over its CPU limit mid-stream: the body just
        // ends, with no `complete` or `error` frame.
        let finished = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const msg = JSON.parse(line.slice(6));
            if (!live) return;
            if (msg.type === "step") {
              setStep({ label: msg.label, index: msg.index, total: msg.total });
            } else if (msg.type === "complete") {
              finished = true;
              setStep(null);
              setData(msg.data);
              setTrackingFirm(msg.data?.source?.firmId);
            } else if (msg.type === "error") {
              finished = true;
              setStep(null);
              setError(msg.message || msg.error || "unknown");
            }
          }
        }
        if (live && !finished) {
          setStep(null);
          setError("stream_ended");
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    })();

    return () => { live = false; controller.abort(); };
  }, [q]);

  return { data, error, step };
}
