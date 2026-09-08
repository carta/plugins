import { useState } from "react";
import { Download, Check, TriangleAlert } from "lucide-react";
import { exportElementAsHtml } from "./exportHtml.js";
import { FAINT, PAPER, LINE } from "./theme.js";
import { trackClick } from "../analytics.js";
import HoverTip from "./HoverTip.jsx";

// Icon-only, wrapped by the caller in a data-export-exclude row.
export default function ExportButton({ targetId, entityName, pageLabel, asOf, filenameBase, events }) {
  const [state, setState] = useState("idle"); // idle | busy | done | error

  const onClick = async () => {
    if (events) trackClick(events.click);
    const el = document.getElementById(targetId);
    if (!el) return;
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

  const label = state === "busy" ? "Exporting…"
              : state === "done" ? "Downloaded"
              : state === "error" ? "Export failed"
              : "Export";
  const Icon = state === "done" ? Check : state === "error" ? TriangleAlert : Download;

  return (
    <HoverTip text={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={state === "busy"}
        aria-label={label}
        style={styles.btn}
      >
        <Icon size={16} strokeWidth={2} />
      </button>
    </HoverTip>
  );
}

// Matches carta-fund-modeling's own topbar icon-button recipe (theme toggle,
// chat toggle): 40x40, border-subtle, text-subtle icon color, no line-height.
const styles = {
  btn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    padding: 0,
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    color: FAINT,
    cursor: "pointer",
    lineHeight: 0,
  },
};
