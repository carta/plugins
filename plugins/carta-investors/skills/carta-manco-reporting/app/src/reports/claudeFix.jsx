import { useEffect, useId, useRef, useState } from "react";
import { INK, FAINT, RED, SHADE, LINE, FS } from "../ui/theme.js";
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

// Polled while waiting for the browser's own redirect to finish signing in --
// scripts/serve.py's /api/claude-signin hands back the CLI's printed URL and
// leaves `claude auth login` running in the background; this is the only thing
// that later notices it worked. SIGNIN_WAIT_MS matches serve.py's own
// _SIGNIN_WINDOW: past it, the server kills that process itself, so polling
// longer than that would only ever time out on the server's own account, never
// on a sign-in that's still genuinely in progress.
export const SIGNIN_POLL_MS = 2000;
export const SIGNIN_WAIT_MS = 10 * 60 * 1000;

export function canSignIn(code, hosted) {
  return code === "not_logged_in" && claudeFixPrompt(code, hosted) !== null;
}

// A one-click alternative to ClaudePrompt's copy-and-paste, for the one code a
// button can actually fix here: signed out, not missing. A missing CLI needs
// installing (Step 0.5's AskUserQuestion flow), which this never offers to do on
// its own. Returns null outside that one case, so a caller can render it
// unconditionally next to ClaudePrompt. `event` is the caller's own analytics id
// for the button click — see references/analytics.md's catalogue.
export function ClaudeSignIn({ code, hosted, event }) {
  const [state, setState] = useState("idle"); // idle | opening | waiting | done | error
  const [message, setMessage] = useState(null);
  // Guards every state update made from inside an async callback (the POST's own
  // response, and each poll tick) against running after this component is gone --
  // the Share dialog that renders this can close, or the notice that renders it
  // can be dismissed, while either is still in flight.
  const mountedRef = useRef(true);
  const timeoutRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!canSignIn(code, hosted)) return null;

  // A setTimeout chain, not setInterval: the next tick is scheduled only once the
  // current one's fetch has settled, so a slow /api/claude-status probe (it runs
  // `claude auth status`, up to 15s server-side) can never overlap the next.
  const poll = (deadline) => {
    timeoutRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      let available = false;
      try {
        const res = await fetch("/api/claude-status");
        available = !!(await res.json()).available;
      } catch {
        // A blip in the poll itself, not a verdict on sign-in — keep polling.
      }
      if (!mountedRef.current) return;
      if (available) {
        setState("done");
      } else if (Date.now() >= deadline) {
        setState("idle");
        setMessage("Still not signed in — try again.");
      } else {
        poll(deadline);
      }
    }, SIGNIN_POLL_MS);
  };

  const start = async () => {
    trackClick(event);
    setState("opening");
    setMessage(null);
    let data;
    try {
      const res = await fetch("/api/claude-signin", { method: "POST" });
      data = await res.json();
      if (!res.ok || !data.url) throw new Error();
    } catch {
      if (!mountedRef.current) return;
      setState("error");
      setMessage("Couldn't start sign-in — try again, or run `claude auth login` from Claude Code.");
      return;
    }
    if (!mountedRef.current) return;
    window.open(data.url, "_blank", "noopener");
    setState("waiting");
    poll(Date.now() + SIGNIN_WAIT_MS);
  };

  if (state === "done") {
    return <div style={S.signinDone}>Signed in — try again.</div>;
  }
  return (
    <div style={S.signinWrap}>
      <Btn small onClick={start} disabled={state === "opening" || state === "waiting"}>
        {state === "waiting" ? "Waiting for sign-in…" : "Sign in to Claude"}
      </Btn>
      {message && <div style={S.signinError}>{message}</div>}
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
  signinWrap: { marginTop: 8 },
  signinDone: { marginTop: 8, color: FAINT, fontSize: FS.body },
  signinError: { marginTop: 6, color: RED, fontSize: FS.body },
};
