import { CartaLogo } from "./components.jsx";
import { sans, FAINT, FS } from "./theme.js";

// Centered brand mark + status line, matching carta-fund-modeling's and
// carta-portfolio-analytics-app's own hosted loading screens. `step` ({index, total} from
// loadFirmSteps.js's loadFirmStepProgress) is optional — omit it to show the label alone.
export default function LoadingScreen({ label, step }) {
  return (
    <div style={{ minHeight: "40vh", display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <CartaLogo size={40} style={{ margin: "0 auto", opacity: 0.9 }} />
        <div style={{ ...sans, marginTop: 12, fontSize: FS.bodyLg, color: FAINT }}>{label}</div>
        {step && (
          <div role="progressbar" aria-valuenow={step.index + 1} aria-valuemax={step.total}
            style={{ marginTop: 10, display: "flex", gap: 3, justifyContent: "center" }}>
            {Array.from({ length: step.total }, (_, i) => (
              <div key={i} style={{
                width: 20, height: 3, borderRadius: 1.5,
                background: i < step.index ? "var(--ink-color-global-text-default)"
                  : i === step.index ? "var(--ink-color-global-text-subtle)"
                  : "var(--ink-color-global-border-subtle)",
                transition: "background 0.2s",
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
