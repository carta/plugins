import { HEADER_ICON_BTN } from "./theme.js";

// Single-stroke speech bubble, matching carta-fund-modeling's own chat
// toggle icon (app/src/ui/components.jsx's ChatIcon) so the two apps draw
// the same glyph for the same action.
function ChatIcon({ size = 16, strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: "none", display: "block" }} aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 01-8.5 8.5H8l-4 3v-4.6A8.5 8.5 0 1121 11.5z" />
    </svg>
  );
}

// Icon-only 40x40 header button (HEADER_ICON_BTN in theme.js). Sits in the
// same export row; one button opens and closes the rail, like
// carta-fund-modeling's topbar toggle.
export default function AskClaudeButton({ open, onToggle }) {
  const label = open ? "Close chat panel" : "Ask Claude";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={open}
      title={label}
      style={HEADER_ICON_BTN}
    >
      <ChatIcon />
    </button>
  );
}
