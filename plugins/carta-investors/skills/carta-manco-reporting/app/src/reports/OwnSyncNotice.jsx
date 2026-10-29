import { sans, INK, FS } from "../ui/theme.js";
import { AlertIcon } from "./icons.jsx";
import { CLAUDE_FIX_STEP, ClaudePrompt, ClaudeSignIn } from "./claudeFix.jsx";

// Why the last sync after a build didn't reach Carta, keyed by own_sync.py's recorded
// reason (serve.py's /api/reports `own_sync.blocked_by`). The sweep runs after each build,
// so every fix ends with a refresh.
const REFRESH = "refresh my ManCo reporting dashboard so its reports sync to the hosted app.";
const BLOCKED = {
  no_user_id: {
    why: "this dashboard doesn't know which Carta user you are.",
    prompt: REFRESH[0].toUpperCase() + REFRESH.slice(1),
  },
  not_installed: {
    why: "syncing needs the Claude Code CLI on this computer.",
    prompt: `${CLAUDE_FIX_STEP.not_installed}, then ${REFRESH}`,
  },
  not_logged_in: {
    why: "syncing needs you signed in to Claude Code.",
    prompt: `${CLAUDE_FIX_STEP.not_logged_in}, then ${REFRESH}`,
  },
  unreachable: {
    why: "Claude Code can't reach your Carta connector. " +
      "A connector added only in the Claude desktop app isn't available to it.",
    prompt: `Connect Carta in Claude Code, then ${REFRESH}`,
  },
};
const UNKNOWN = { why: "the last sync couldn't reach Carta.", prompt: null };

// Shown on your own report in a local build only: the hosted Worker serves no own-sync status.
// A report an earlier sync already pushed has a hosted copy; its later changes can't reach it.
export default function OwnSyncNotice({ report, reportsApi, hosted }) {
  const reason = reportsApi?.ownSync?.blocked_by;
  if (hosted || !reason || !report || report.read_only) return null;
  const { why, prompt } = BLOCKED[reason] || UNKNOWN;
  const lead = report.own_sync?.uuid ? "Changes won't reach the hosted app" : "Not on the hosted app";
  return (
    <div role="status" data-export-exclude style={S.wrap}>
      <span style={S.line}><AlertIcon size={14} /><span>{`${lead}: ${why}`}</span></span>
      <ClaudeSignIn code={reason} hosted={hosted} event="MancoReporting.OwnSyncNotice.SignIn" />
      {prompt && <ClaudePrompt text={prompt} event="MancoReporting.OwnSyncNotice.CopyPrompt" />}
    </div>
  );
}

const S = {
  wrap: { ...sans, display: "flex", flexDirection: "column", gap: 6, margin: "-4px 0 14px", fontSize: FS.small, color: INK },
  line: { display: "inline-flex", alignItems: "center", gap: 6, lineHeight: "18px" },
};
