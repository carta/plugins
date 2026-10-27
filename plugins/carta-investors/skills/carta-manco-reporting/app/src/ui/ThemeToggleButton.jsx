import { Sun, Moon } from "lucide-react";
import { HEADER_ICON_BTN } from "./theme.js";

// Icon-only 40x40 header button (HEADER_ICON_BTN in theme.js). Sits in the
// same export row, mirroring carta-fund-modeling's own topbar toggle.
export default function ThemeToggleButton({ dark, onToggle }) {
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      style={HEADER_ICON_BTN}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
