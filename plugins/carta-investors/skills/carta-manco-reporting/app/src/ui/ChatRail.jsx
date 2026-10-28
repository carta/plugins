import { createPortal } from "react-dom";
import { sans, INK, PAPER, LINE, EASE_OUT } from "./theme.js";
import ChatPanel from "./ChatPanel.jsx";

// Single source of truth for the rail's width and slide duration: App.jsx
// reflows the page content by this same width, over this same duration,
// while the rail is open, so the data a question is about is never hidden
// behind the panel asking about it, and the two never fall out of step.
export const CHAT_RAIL_WIDTH_PX = 360;
export const CHAT_RAIL_TRANSITION_MS = 220;

// Fixed right-docked chat panel, portaled to document.body (escapes any
// overflow-x scroll container, matches DrilldownDrawer's own pattern). Slides
// in from the right on open; closing never unmounts ChatPanel, which keeps
// its transcript, its model lock and its in-flight stream reader alive
// across a close/reopen. ChatPanel is keyed by `sessionId`, so its state
// lives exactly as long as that id does, matching the server session it's
// bound to: a new id ("New conversation") remounts it empty. `inert`
// additionally blocks keyboard/assistive-tech focus into the closed rail
// (pointerEvents/aria-hidden alone don't).
export default function ChatRail({ open, onClose, ...chatPanelProps }) {
  return createPortal(
    <aside
      style={{
        ...sans,
        ...S.rail,
        transform: open ? "translateX(0)" : "translateX(100%)",
        pointerEvents: open ? "auto" : "none",
      }}
      role="complementary"
      aria-label="Chat with Claude"
      aria-hidden={!open}
      inert={open ? undefined : ""}
    >
      <ChatPanel key={chatPanelProps.sessionId} {...chatPanelProps} onClose={onClose} />
    </aside>,
    document.body
  );
}

const S = {
  rail: {
    position: "fixed",
    top: 0, right: 0, bottom: 0,
    width: `min(${CHAT_RAIL_WIDTH_PX}px, 92vw)`,
    zIndex: 1000,
    background: PAPER,
    color: INK,
    borderLeft: `1px solid ${LINE}`,
    boxShadow: "-8px 0 24px rgba(0,0,0,0.08)",
    padding: "12px 10px",
    boxSizing: "border-box",
    transition: `transform ${CHAT_RAIL_TRANSITION_MS}ms ${EASE_OUT}`,
  },
};
