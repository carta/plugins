import { useId, useState } from "react";
import { INK, SHADE, LINE, FS } from "../ui/theme.js";
import { Btn } from "../ui/components.jsx";
import { trackClick } from "../analytics.js";

// What to ask Claude to do when a ShareError's `code` names the `claude` CLI itself
// as the reason report sharing couldn't run (scripts/preflight_claude.py's two
// recoverable statuses, which scripts/serve.py's _CLAUDE_FIX_MESSAGES short-circuits
// a share op with instead of letting it fail generically). Any other code gets no
// prompt — asking Claude can't fix a Carta permissions error, a conflict, and so on.
// The hosted Worker runs with no local `claude` session at all (it calls Carta
// directly), so every caller passes `hosted`, and this is the one place that rule
// lives rather than being repeated at each call site.
const PROMPTS = {
  not_installed: "Install the Claude Code CLI (the `claude` command) so I can share " +
    "reports from the ManCo reporting dashboard.",
  not_logged_in: "Sign in to Claude Code (`claude auth login`) so I can share reports " +
    "from the ManCo reporting dashboard.",
};

export function claudeFixPrompt(code, hosted) {
  return hosted ? null : PROMPTS[code] || null;
}

// A prompt the operator copies into their own Claude session, where their Carta
// connector is signed in (references/report-sharing.md). `event` is the caller's own
// analytics id for the Copy click — see references/analytics.md's catalogue.
export function ClaudePrompt({ text, event }) {
  const [copied, setCopied] = useState(false);
  const textId = useId();
  const copy = async () => {
    trackClick(event);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard permission: select the text so a manual copy is one keystroke.
      const range = document.createRange();
      const node = document.getElementById(textId);
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
        <span id={textId} style={S.promptText}>{text}</span>
        <Btn small onClick={copy} aria-label="Copy prompt" style={S.copy}>{copied ? "Copied" : "Copy"}</Btn>
      </div>
    </div>
  );
}

const S = {
  promptWrap: { marginTop: 8 },
  prompt: {
    display: "flex", alignItems: "flex-start", gap: 8, background: SHADE,
    border: `1px solid ${LINE}`, borderRadius: 4, padding: "8px 8px 8px 10px",
  },
  promptText: { flex: 1, minWidth: 0, color: INK, fontSize: FS.body, lineHeight: 1.45, userSelect: "all" },
  copy: { flex: "none" },
};
