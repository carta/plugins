import { sans, INK, PAPER, LINE, FAINT, FS } from "../ui/theme.js";
import { Btn, POPOVER_SHADOW } from "../ui/components.jsx";
import { REPORT_ACTIONS } from "../state/useReports.js";
import { ClaudePrompt, ClaudeSignIn, claudeFixPrompt } from "./claudeFix.jsx";

const RUNNING = {
  [REPORT_ACTIONS.PULL]: "Loading shared reports…",
  [REPORT_ACTIONS.SHARE]: "Sharing your report…",
  [REPORT_ACTIONS.PUBLISH_AS_NEW]: "Sharing your report…",
  [REPORT_ACTIONS.DELETE]: "Stopping sharing…",
};

// Floating status panel for sharing with Carta, the one carta-fund-modeling
// shows for shared scenarios: what is running and how far it got, then how it
// ended. `notice` is { status: "running"|"done"|"error", op, message, code }.
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
    // A failed pull whose code names the `claude` CLI itself as the problem
    // (scripts/serve.py's _CLAUDE_FIX_MESSAGES) gets the matching install/sign-in
    // prompt instead of the generic one below. Only pull notices ever carry this
    // code here: share, publish-as-new, delete and the people lookup show their own
    // error inline in ShareDialog instead of reaching this panel. A failed pull with
    // no such code still gets its own generic prompt: Load shared reports itself
    // runs through a background Claude session (references/report-sharing.md), so
    // the manual prompt is a real retry path for whatever else stopped that session
    // from reaching Carta. `hosted` (App.jsx's useHostedApp()) drops both: hosted
    // calls Carta directly from the Worker, with no Claude session to ask.
    const fixPrompt = notice.status === "error" && notice.op === REPORT_ACTIONS.PULL
      ? claudeFixPrompt(notice.code, hosted) : null;
    body = (
      <>
        <strong>{notice.status === "error" ? "Couldn't finish" : "Done"}</strong>
        {fixPrompt ? (
          <>
            <div style={S.sub}>{notice.message}</div>
            <ClaudeSignIn code={notice.code} hosted={hosted} event="MancoReporting.ShareStatus.SignIn" />
            <ClaudePrompt text={fixPrompt} event="MancoReporting.ShareStatus.CopyFixPrompt" />
          </>
        ) : notice.status === "error" && notice.op === REPORT_ACTIONS.PULL && !hosted ? (
          <>
            <div style={S.sub}>The app couldn’t load them from Carta. Try again, or ask Claude:</div>
            <ClaudePrompt text={pullPrompt(firmName)} event="MancoReporting.ShareStatus.CopyPrompt" />
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
};
