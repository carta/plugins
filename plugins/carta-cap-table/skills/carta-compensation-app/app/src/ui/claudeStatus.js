// Whether this console's Claude features (the ask box and the cohort filter) can
// run on this machine.
//
// Both need the `claude` CLI, installed and logged in, behind the local server.
// When it is missing or broken the user gets ONE message, the same everywhere,
// and never a stuck "Working…" or a raw error. The specific cause is the
// server's business: it goes to chat-errors.log in the data dir.
//
// The status is asked for once per page load and shared by every box. Only an
// explicit "unavailable" disables anything: while the check is in flight, or if
// an older server has no status endpoint, the boxes stay usable and a failed
// request still lands on the same message.

import { useEffect, useState } from "react";

export const CHAT_UNAVAILABLE =
  "An error occurred. The Claude chat isn't supported in this setup for now.";

// Server error code meaning "the Claude features can't run here".
export const UNAVAILABLE_CODE = "claude_unavailable";

let pending = null;
let known = null;

async function fetchStatus(token) {
  try {
    const headers = token ? { "X-Dash-Token": token } : {};
    const res = await fetch(`/api/claude-status${window.location.search}`, { headers });
    if (!res.ok) return "available";
    const body = await res.json();
    return body && body.available === false ? "unavailable" : "available";
  } catch {
    return "available";
  }
}

/** "checking" | "available" | "unavailable". An `override` (tests, or a caller
 *  that already knows) is returned as-is and nothing is requested. */
export function useClaudeStatus(token, override) {
  const [status, setStatus] = useState(known || "checking");
  useEffect(() => {
    if (override || known) return undefined;
    let live = true;
    pending = pending || fetchStatus(token).then((s) => { known = s; return s; });
    pending.then((s) => { if (live) setStatus(s); });
    return () => { live = false; };
  }, [token, override]);
  return override || status;
}

export function __resetClaudeStatus() {
  pending = null;
  known = null;
}
