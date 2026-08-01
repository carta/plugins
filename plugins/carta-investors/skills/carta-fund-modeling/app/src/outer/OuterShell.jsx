import { useEffect, useRef, useState } from "react";
import ChatPanel from "../ui/ChatPanel.jsx";
import { onFromApp, postToApp } from "./bridge.js";

export function reloadApp() {
  const f = document.getElementById("fm-app");
  if (f && f.contentWindow) f.contentWindow.location.reload();
}

// The rail starts closed so the dashboard gets the full viewport on load, and
// the user's choice is remembered thereafter (a pin still force-opens it).
const CHAT_OPEN_KEY = "fm.chatOpen";

function readChatOpen() {
  try {
    return localStorage.getItem(CHAT_OPEN_KEY) === "1";
  } catch {
    return false; // private mode / storage disabled
  }
}

export default function OuterShell() {
  const [chatOpen, setChatOpen] = useState(readChatOpen);
  const [anchor, setAnchor] = useState(null);
  const [pinMode, setPinMode] = useState(false);
  const [models, setModels] = useState(null);
  const [defaultModel, setDefaultModel] = useState(null);
  // The iframe's onLoad handler fires after every reload (including the
  // post-turn reloadApp() call), outside of React's render cycle, so it
  // can't close over fresh state. Refs mirror `anchor` and `chatOpen` for it
  // to read.
  const anchorRef = useRef(null);
  const chatOpenRef = useRef(chatOpen);
  // Mirror our URL into the iframe + ?frame=1 so serve.py serves app.html here and
  // index.html to the shell (shared path). Frozen: recomputing on re-render would
  // reload the iframe and drop in-app state.
  const [src] = useState(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("frame", "1");
    return u.pathname + u.search;
  });
  // One serve.py serves one firm's data dir, so a single stable session id is
  // correct here; per-firm/per-tab scoping is a later concern.
  const sessionId = "default";

  useEffect(() => onFromApp("pinpoint", (a) => {
    setAnchor(a);
    setChatOpen(true);   // a pin should surface the chat even if it was closed
    setPinMode(false);   // the iframe already exited inspect mode; keep the button in sync
  }), []);

  // The open-chat toggle now lives in the app's own topbar (postToOuter);
  // this is its outer-side handler.
  useEffect(() => onFromApp("toggle-chat", () => setChatOpen((v) => !v)), []);

  // Mirror the iframe's route into the browser bar (replaceState: no re-render, so
  // the frozen src is untouched). Drop ?frame= — the top URL is the shell.
  useEffect(() => onFromApp("route", ({ firm, tab } = {}) => {
    const url = new URL(window.location.href);
    url.pathname = firm ? `/firm/${encodeURIComponent(firm)}${tab ? `/${tab}` : ""}` : "/";
    url.searchParams.delete("frame");
    if (url.href !== window.location.href) window.history.replaceState({}, "", url);
  }), []);

  // The app iframe computes the firm name but setting document.title inside
  // an iframe never updates the visible browser tab — only the outer shell's
  // top-level document does that, so the app forwards the name here.
  useEffect(() => onFromApp("title", ({ firmName } = {}) => {
    document.title = firmName ? `${firmName} | Carta Fund Modeling` : "Carta Fund Modeling";
  }), []);

  // Fetch the curated model catalog once on mount. Resilient: any failure
  // leaves models/defaultModel null, so ChatPanel falls back to its own
  // built-in list.
  useEffect(() => {
    let live = true;
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d && Array.isArray(d.models)) {
          setModels(d.models);
          setDefaultModel(d.default || null);
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Explicit 📍 Pinpoint toggle: post the mode change into the iframe so its
  // inspect controller can attach/detach the hover-overlay + click-to-pin
  // listeners.
  function togglePinMode() {
    setPinMode((on) => {
      const next = !on;
      postToApp(document.getElementById("fm-app"), "pinpoint-mode", { on: next });
      return next;
    });
  }

  // Keep the ref in sync and re-send the active anchor as a "highlight" any
  // time it changes, so the app draws (or clears) the mark immediately.
  useEffect(() => {
    anchorRef.current = anchor;
    postToApp(document.getElementById("fm-app"), "highlight", anchor);
  }, [anchor]);

  // The rail's open/closed state lives here, but the toggle button lives in the
  // app's topbar and labels itself from it — push every change (and re-push on
  // load, below) so the button never disagrees with what's on screen.
  useEffect(() => {
    chatOpenRef.current = chatOpen;
    try { localStorage.setItem(CHAT_OPEN_KEY, chatOpen ? "1" : "0"); } catch { /* private mode */ }
    postToApp(document.getElementById("fm-app"), "chat-state", { open: chatOpen });
  }, [chatOpen]);

  return (
    <div style={{ display: "flex", height: "100vh", margin: 0,
                  // Establish an explicit base color: tokens.css sets
                  // `color-scheme: light dark`, so without this the chat text
                  // falls to the UA default (white under OS dark mode) and
                  // vanishes on the light rail. The app sets its own; the outer
                  // shell must too.
                  color: "var(--ink-color-global-text-default)",
                  background: "var(--ink-color-global-surface-background-default)" }}>
      <iframe id="fm-app" title="Fund Modeling app" src={src}
              onLoad={() => {
                const el = document.getElementById("fm-app");
                postToApp(el, "highlight", anchorRef.current);
                postToApp(el, "chat-state", { open: chatOpenRef.current });
              }}
              style={{ flex: 1, border: 0, height: "100vh" }} />
      {/* Always rendered (never unmounted) so ChatPanel's message/anchor state
          persists across open/close — only visibility toggles. The open-chat
          control itself now lives in the app's topbar (see toggle-chat above). */}
      <div data-testid="chat-rail"
           style={{ display: chatOpen ? "flex" : "none", flexDirection: "column",
                    width: 360, height: "100vh", boxSizing: "border-box", padding: 12,
                    borderLeft: "1px solid var(--ink-color-global-border-subtle)",
                    color: "var(--ink-color-global-text-default)",
                    background: "var(--ink-color-global-surface-background-default)" }}>
        <ChatPanel sessionId={sessionId}
                   onTurnStart={() => postToApp(document.getElementById("fm-app"), "autosave", { paused: true })}
                   onTurnEnd={() => {
                     // Resume before reload — belt-and-suspenders in case the
                     // reload no-ops; the reload itself resets the instance.
                     postToApp(document.getElementById("fm-app"), "autosave", { paused: false });
                     reloadApp();
                   }}
                   anchor={anchor} onAnchorConsumed={() => setAnchor(null)}
                   pinMode={pinMode} onTogglePinMode={togglePinMode}
                   models={models} defaultModel={defaultModel}
                   onClose={() => setChatOpen(false)} />
      </div>
    </div>
  );
}
