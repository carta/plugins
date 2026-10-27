import { createPortal } from "react-dom";
import { sans, INK, PAPER, LINE, EASE_OUT } from "./theme.js";
import ChatPanel from "./ChatPanel.jsx";

// Fixed right-docked chat panel, portaled to document.body (escapes any
// overflow-x scroll container, matches DrilldownDrawer's own pattern). Slides
// in from the right on open; closing never unmounts ChatPanel, which keeps
// its transcript, its model lock and its in-flight stream reader alive
// across a close/reopen — ChatPanel's state lives exactly as long as
// `sessionId` does, matching the server session it's bound to. `inert`
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
      <ChatPanel {...chatPanelProps} onClose={onClose} />
    </aside>,
    document.body
  );
}

const S = {
  rail: {
    position: "fixed",
    top: 0, right: 0, bottom: 0,
    width: "min(420px, 92vw)",
    zIndex: 1000,
    background: PAPER,
    color: INK,
    borderLeft: `1px solid ${LINE}`,
    boxShadow: "-8px 0 24px rgba(0,0,0,0.08)",
    padding: "12px 10px",
    boxSizing: "border-box",
    transition: `transform 220ms ${EASE_OUT}`,
  },
};
