import { useState } from "react";
import { Download, Check, TriangleAlert } from "lucide-react";
import { exportElementAsHtml } from "./exportHtml.js";
import { Btn } from "./components.jsx";
import { trackClick } from "../analytics.js";

// One HTML export of the element `targetId`, with its click and outcome tracked.
// state: idle | busy | done | error — done and error fall back to idle after a moment.
export function useHtmlExport({ targetId, entityName, pageLabel, asOf, filenameBase, events }) {
  const [state, setState] = useState("idle");

  const run = async () => {
    if (events) trackClick(events.click);
    const el = document.getElementById(targetId);
    if (!el) {
      // Without this the click is counted with no outcome after it.
      if (events) trackClick(events.failed);
      return;
    }
    setState("busy");
    try {
      await exportElementAsHtml(el, { entityName, pageLabel, asOf, filenameBase });
      setState("done");
      if (events) trackClick(events.succeeded);
    } catch (e) {
      console.error(e);
      setState("error");
      if (events) trackClick(events.failed);
    } finally {
      setTimeout(() => setState("idle"), 1600);
    }
  };

  return { state, run };
}

// Renders via the shared Btn (kind="ghost"), not a hand-rolled button.
export default function ExportButton(props) {
  const { state, run } = useHtmlExport(props);
  const label = state === "busy" ? "Exporting…"
              : state === "done" ? "Downloaded"
              : state === "error" ? "Export failed"
              : "Export";
  const Icon = state === "done" ? Check : state === "error" ? TriangleAlert : Download;

  return (
    <Btn kind="ghost" onClick={run} disabled={state === "busy"} aria-label={label}>
      <Icon size={16} strokeWidth={2} />
      {label}
    </Btn>
  );
}
