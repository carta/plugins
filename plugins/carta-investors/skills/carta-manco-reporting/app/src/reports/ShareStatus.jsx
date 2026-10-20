import { useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, SHADE, FS } from "../ui/theme.js";
import { trackClick } from "../analytics.js";
import { Btn, POPOVER_SHADOW } from "../ui/components.jsx";
import { REPORT_ACTIONS } from "../state/useReports.js";

const RUNNING = {
  [REPORT_ACTIONS.PULL]: "Loading shared reports…",
  [REPORT_ACTIONS.SHARE]: "Sharing your report…",
  [REPORT_ACTIONS.PUBLISH_AS_NEW]: "Sharing your report…",
  [REPORT_ACTIONS.DELETE]: "Stopping sharing…",
};

// Floating status panel for sharing with Carta, the one carta-fund-modeling
// shows for shared scenarios: what is running and how far it got, then how it
// ended. `notice` is { status: "running"|"done"|"error", op, message }.
export default function ShareStatus({ notice, progress, firmName, hosted, onDismiss }) {
  if (!notice) return null;
  let body;
  if (notice.status === "running") {
    const title = RUNNING[notice.op] || "Working…";
    body = (
      <>
        <strong>{title}</strong>
        <div style={S.sub}>{progress && progress !== title ? progress : "This takes a moment."}</div>
      </>
    );
  } else {
    body = (
      <>
        <strong>{notice.status === "error" ? "Couldn't finish" : "Done"}</strong>
        {/* A failed pull's "ask Claude" fallback (`hosted` is App.jsx's useHostedApp()):
            locally, Load shared reports itself runs through a background Claude session
            (references/report-sharing.md), so the manual prompt is a real retry path when
            that session can't reach Carta. Hosted calls Carta directly from the Worker,
            with no Claude session to ask — the prompt would write into the user's own
            local report store, never this dashboard — so it falls to the plain error
            message and Dismiss below, same as any other failure. */}
        {notice.status === "error" && notice.op === REPORT_ACTIONS.PULL && !hosted ? (
          <>
            <div style={S.sub}>The app couldn’t load them from Carta. Try again, or ask Claude:</div>
            <ClaudePrompt text={pullPrompt(firmName)} />
          </>
        ) : (
          <div style={S.sub}>{notice.message || (notice.status === "error" ? "Something went wrong." : "")}</div>
        )}
        <div style={S.row}><Btn onClick={onDismiss}>Dismiss</Btn></div>
      </>
    );
  }
  return (
    <div style={S.panel} role={notice.status === "error" ? "alert" : "status"} aria-live="polite">
      {body}
    </div>
  );
}

// The prompt that runs the same load from the person's own Claude session,
// where their Carta connector is signed in (see references/report-sharing.md).
export function pullPrompt(firmName) {
  return `Load the budget reports shared with me into my ${firmName || "firm's"} ManCo reporting dashboard.`;
}

function ClaudePrompt({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    trackClick("MancoReporting.ShareStatus.CopyPrompt");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard permission: select the text so a manual copy is one keystroke.
      const range = document.createRange();
      const node = document.getElementById("share-status-prompt");
      if (!node) return;
      range.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={S.promptWrap}>
      <div style={S.prompt}>
        <span id="share-status-prompt" style={S.promptText}>{text}</span>
        <Btn small onClick={copy} aria-label="Copy prompt" style={S.copy}>{copied ? "Copied" : "Copy"}</Btn>
      </div>
    </div>
  );
}

export function pulledMessage(result) {
  const counts = result?.counts || {};
  const bits = [];
  if (counts.added) bits.push(`${counts.added} added`);
  if (counts.updated) bits.push(`${counts.updated} updated`);
  if (counts.kept_local) bits.push(`${counts.kept_local} kept with your changes`);
  if (counts.removed) bits.push(`${counts.removed} removed`);
  return bits.length ? `Shared reports loaded — ${bits.join(", ")}.` : "Nothing new shared with you.";
}

const S = {
  panel: {
    ...sans, position: "fixed", top: 64, right: 20, zIndex: 900, width: 320, boxSizing: "border-box",
    background: PAPER, color: INK, border: `1px solid ${LINE}`, borderRadius: 8, padding: 14,
    boxShadow: POPOVER_SHADOW, fontSize: FS.body, lineHeight: 1.5,
  },
  sub: { color: FAINT, marginTop: 4 },
  row: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" },
  promptWrap: { marginTop: 8 },
  prompt: {
    display: "flex", alignItems: "flex-start", gap: 8, background: SHADE,
    border: `1px solid ${LINE}`, borderRadius: 4, padding: "8px 8px 8px 10px",
  },
  promptText: { flex: 1, minWidth: 0, color: INK, fontSize: FS.body, lineHeight: 1.45, userSelect: "all" },
  copy: { flex: "none" },
};
