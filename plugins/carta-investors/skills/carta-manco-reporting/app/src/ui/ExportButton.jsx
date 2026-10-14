import { useState } from "react";
import { Download, Check, TriangleAlert } from "lucide-react";
import { exportElementAsHtml } from "./exportHtml.js";
import { Btn } from "./components.jsx";
import { trackClick } from "../analytics.js";

// What an export in progress or just finished says, and its icon. Idle has none:
// each control words its own resting state.
export const EXPORT_STATUS = {
  busy: { label: "Exporting…", Icon: Download },
  done: { label: "Downloaded", Icon: Check },
  error: { label: "Export failed", Icon: TriangleAlert },
};

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
  const { label, Icon } = EXPORT_STATUS[state] || { label: "Export", Icon: Download };

  return (
    <Btn kind="ghost" onClick={run} disabled={state === "busy"} aria-label={label}>
      <Icon size={16} strokeWidth={2} />
      {label}
    </Btn>
  );
}
