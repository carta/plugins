import { Sun, Moon } from "lucide-react";
import { FAINT, PAPER, LINE } from "./theme.js";

// Icon-only, matches ExportButton/AskClaudeButton's 40x40 recipe. Sits in the
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
      style={styles.btn}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}

const styles = {
  btn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    padding: 0,
    background: PAPER,
    border: `1px solid ${LINE}`,
    borderRadius: 4,
    color: FAINT,
    cursor: "pointer",
    lineHeight: 0,
  },
};
